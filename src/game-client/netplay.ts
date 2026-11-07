// Multigiocatore in lockstep: chi ospita fa avanzare la simulazione e trasmette, tick per tick, i comandi
// di tutti. Gli altri eseguono gli stessi tick con gli stessi comandi e ottengono la stessa partita.
import { MAX_RANK, TOWER_ORDER, TowerKind } from "../sim-core/content";
import { Command, GameEvent, GameOptions, GameState, createGame, hashState, restore, snapshot, step } from "../sim-core/sim";
import { Transport } from "./net";

export interface Player {
  id: string;
  name: string;
  loadout: TowerKind[];
  ranks: Record<TowerKind, number>;
  seen: number;
  host?: boolean;
}

export interface Setup {
  mode: GameOptions["mode"];
  level: string;
  night: number;
  eventBp: number;
}

type Frame = [number, Command[]];

// Comandi che un giocatore può mandare: quelli admin passano solo da chi ospita o dal database.
const PLAYER_CMDS = new Set(["build", "upgrade", "spec", "sell", "skip", "track", "towerAbility", "ability", "apex"]);
const HASH_EVERY = 50;
const FLUSH_EVERY = 2;

export class NetMatch {
  players = new Map<string, Player>();
  state: GameState | null = null;
  status: "lobby" | "playing" | "ended" = "lobby";
  setup: Setup;
  lastFrameAt = 0;
  desyncs = 0;
  /** Chi partecipa ha ricevuto almeno una volta la sala d'attesa da chi ospita. */
  gotLobby = false;
  /** Tick confermato da chi ospita: gli altri non possono andare oltre. */
  confirmed = 0;
  onLobby: () => void = () => {};
  onStart: (state: GameState) => void = () => {};
  onEvents: (events: GameEvent[]) => void = () => {};
  onNote: (text: string) => void = () => {};
  onClosed: (why: string) => void = () => {};

  private pending: Command[] = [];
  private out: Frame[] = [];
  private hashes: Array<[number, string]> = [];
  private frames = new Map<number, Command[]>();
  private expectHash = new Map<number, string>();
  private pingTimer = 0;
  private syncing = false;

  constructor(
    public role: "host" | "guest",
    public code: string,
    public me: Player,
    private t: Transport,
    setup?: Setup,
  ) {
    this.setup = setup ?? { mode: "easy", level: "porto", night: 0, eventBp: 10000 };
    me.host = role === "host";
    this.players.set(me.id, { ...me, seen: Date.now() });
    t.on("ping", (p: { id: string }) => this.touch(p.id));
    t.on("leave", (p: { id: string }) => {
      if (this.players.delete(p.id)) {
        if (this.role === "host") this.broadcastLobby();
        this.onLobby();
      }
    });
    if (role === "host") {
      t.on("join", (p: { p: Player }) => this.hostJoin(p.p));
      t.on("cmd", (p: { id: string; c: Command }) => this.hostCmd(p.id, p.c));
      t.on("sync", (p: { id: string }) => this.hostSync(p.id));
    } else {
      t.on("lobby", (p: { players: Player[]; setup: Setup; status: NetMatch["status"] }) => this.guestLobby(p));
      t.on("start", (p: { seed: number; opts: GameOptions }) => this.guestStart(p.seed, p.opts));
      t.on("f", (p: { a: number; b: number; c: Frame[]; h: Array<[number, string]> }) => this.guestFrames(p));
      t.on("snap", (p: { to: string; tick: number; data: string; confirmed: number }) => this.guestSnap(p));
      t.on("bye", () => {
        this.status = "ended";
        this.onClosed("Chi ospitava ha chiuso la stanza");
      });
    }
    t.onStatus((s, d) => {
      if (s === "open") {
        if (this.role === "guest") this.t.send("join", { p: this.me });
        else this.broadcastLobby();
      } else if (s === "error") this.onNote(d ?? "Errore del canale");
      else this.onNote("Connessione persa, riprovo…");
    });
    this.pingTimer = window.setInterval(() => {
      this.t.send("ping", { id: this.me.id });
      this.touch(this.me.id);
      if (this.role === "host") {
        this.prune();
        // In sala d'attesa la si ritrasmette: chi è appena entrato la riceve anche se ha perso il primo messaggio.
        if (this.status === "lobby") this.broadcastLobby();
      } else if (!this.gotLobby) this.t.send("join", { p: this.me });
      // Chi ospita tace da troppo: si chiede lo stato completo.
      if (this.role === "guest" && this.status === "playing" && Date.now() - this.lastFrameAt > 8000) this.requestSync();
    }, 3000);
  }

  get isHost() {
    return this.role === "host";
  }

  private touch(id: string) {
    const p = this.players.get(id);
    if (p) p.seen = Date.now();
  }

  private prune() {
    let changed = false;
    for (const [id, p] of this.players) {
      if (id !== this.me.id && Date.now() - p.seen > 15000) {
        this.players.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.broadcastLobby();
      this.onLobby();
    }
  }

  // ---------- chi ospita ----------

  setSetup(s: Setup) {
    this.setup = s;
    this.broadcastLobby();
    this.onLobby();
  }

  private broadcastLobby() {
    this.t.send("lobby", { players: [...this.players.values()], setup: this.setup, status: this.status });
  }

  private hostJoin(p: Player) {
    if (!p || typeof p.id !== "string") return;
    const clean: Player = {
      id: p.id.slice(0, 64),
      name: String(p.name ?? "?").slice(0, 20),
      loadout: (Array.isArray(p.loadout) ? p.loadout : []).filter((k) => TOWER_ORDER.includes(k)).slice(0, 6),
      ranks: Object.fromEntries(TOWER_ORDER.map((k) => [k, Math.max(1, Math.min(MAX_RANK, Number(p.ranks?.[k]) || 1))])) as Record<TowerKind, number>,
      seen: Date.now(),
    };
    if (this.players.size >= 4 && !this.players.has(clean.id)) return; // massimo quattro giocatori
    this.players.set(clean.id, clean);
    this.broadcastLobby();
    this.onLobby();
    // Chi arriva a partita iniziata riceve lo stato completo.
    if (this.status === "playing") this.hostSync(clean.id);
  }

  /** Regole comuni: tutte le torri delle squadre dei giocatori, al rango più alto tra chi le porta. */
  matchOptions(): GameOptions {
    const allowed = new Set<TowerKind>();
    const ranks = {} as Record<TowerKind, number>;
    for (const p of this.players.values()) {
      for (const k of p.loadout) {
        allowed.add(k);
        ranks[k] = Math.max(ranks[k] ?? 1, p.ranks[k] ?? 1);
      }
    }
    return {
      mode: this.setup.mode,
      level: this.setup.level,
      night: this.setup.night || undefined,
      eventBp: this.setup.eventBp,
      allowed: TOWER_ORDER.filter((k) => allowed.has(k)),
      ranks,
    };
  }

  hostStart(seed: number): GameState {
    const opts = this.matchOptions();
    this.state = createGame(seed, opts);
    this.status = "playing";
    this.pending = [];
    this.out = [];
    this.hashes = [];
    this.t.send("start", { seed, opts });
    this.broadcastLobby();
    return this.state;
  }

  private hostCmd(id: string, c: Command) {
    if (!this.players.has(id) || !c || !PLAYER_CMDS.has((c as { t: string }).t)) return;
    this.pending.push(c);
  }

  /** Comandi di chi ospita, del pannello admin locale o arrivati dal database: entrano nel prossimo tick. */
  hostSubmit(c: Command) {
    this.pending.push(c);
  }

  /** Un tick della partita condivisa: lo esegue chi ospita e lo trasmette. */
  hostTick(): GameEvent[] {
    const s = this.state!;
    const tick = s.tick;
    const cmds = this.pending.splice(0);
    const events = step(s, cmds);
    this.out.push([tick, cmds]);
    if (s.tick % HASH_EVERY === 0) this.hashes.push([s.tick, hashState(s)]);
    if (this.out.length >= FLUSH_EVERY || s.phase === "won" || s.phase === "lost") this.flush();
    if (s.phase === "won" || s.phase === "lost") this.status = "ended";
    return events;
  }

  /** Applica comandi subito, fuori dal tick (partita in pausa o finita): restano comunque nel registro. */
  flush() {
    if (!this.out.length) return;
    const a = this.out[0][0];
    const b = this.state!.tick;
    const c = this.out.filter(([, cmds]) => cmds.length);
    this.t.send("f", { a, b, c, h: this.hashes.splice(0) });
    this.out = [];
  }

  private async hostSync(to: string) {
    if (!this.state) return;
    this.flush();
    const data = await pack(snapshot(this.state));
    this.t.send("snap", { to, tick: this.state.tick, data, confirmed: this.state.tick });
  }

  // ---------- chi partecipa ----------

  private guestLobby(p: { players: Player[]; setup: Setup; status: NetMatch["status"] }) {
    this.players = new Map(p.players.map((x) => [x.id, { ...x, seen: Date.now() }]));
    this.setup = p.setup;
    this.gotLobby = true;
    if (!this.players.has(this.me.id)) this.t.send("join", { p: this.me });
    if (p.status === "playing" && !this.state) this.requestSync();
    this.onLobby();
  }

  private guestStart(seed: number, opts: GameOptions) {
    this.state = createGame(seed, opts);
    this.status = "playing";
    this.frames.clear();
    this.expectHash.clear();
    this.confirmed = 0;
    this.lastFrameAt = Date.now();
    this.onStart(this.state);
  }

  private guestFrames(p: { a: number; b: number; c: Frame[]; h: Array<[number, string]> }) {
    if (!this.state || this.syncing) return;
    this.lastFrameAt = Date.now();
    if (p.a > this.confirmed) {
      // Mancano dei tick: meglio ricevere lo stato completo che indovinare.
      this.requestSync();
      return;
    }
    for (const [k, cmds] of p.c) this.frames.set(k, cmds);
    for (const [k, h] of p.h) this.expectHash.set(k, h);
    this.confirmed = Math.max(this.confirmed, p.b);
  }

  /** Esegue i tick già confermati, al massimo `max` per fotogramma. */
  guestTicks(max: number): GameEvent[] {
    const s = this.state;
    if (!s || this.syncing) return [];
    const all: GameEvent[] = [];
    let n = 0;
    while (s.tick < this.confirmed && n < max) {
      const cmds = this.frames.get(s.tick) ?? [];
      this.frames.delete(s.tick);
      all.push(...step(s, cmds));
      n++;
      const want = this.expectHash.get(s.tick);
      if (want) {
        this.expectHash.delete(s.tick);
        if (want !== hashState(s)) {
          this.desyncs++;
          this.onNote("Partita fuori sincrono: riallineo");
          this.requestSync();
          break;
        }
      }
    }
    if (s.phase === "won" || s.phase === "lost") this.status = "ended";
    return all;
  }

  /** Quanti tick mancano per raggiungere chi ospita. */
  get behind(): number {
    return this.state ? Math.max(0, this.confirmed - this.state.tick) : 0;
  }

  guestSubmit(c: Command) {
    this.t.send("cmd", { id: this.me.id, c });
  }

  private requestSync() {
    if (this.syncing) return;
    this.syncing = true;
    this.t.send("sync", { id: this.me.id });
    setTimeout(() => (this.syncing = false), 6000);
  }

  private async guestSnap(p: { to: string; tick: number; data: string; confirmed: number }) {
    if (p.to !== this.me.id) return;
    const first = !this.state;
    this.state = restore(await unpack(p.data));
    this.status = this.state.phase === "won" || this.state.phase === "lost" ? "ended" : "playing";
    this.frames.clear();
    this.expectHash.clear();
    this.confirmed = p.confirmed;
    this.syncing = false;
    this.lastFrameAt = Date.now();
    void first;
    this.onStart(this.state);
  }

  leave() {
    clearInterval(this.pingTimer);
    if (this.role === "host") this.t.send("bye", {});
    else this.t.send("leave", { id: this.me.id });
    setTimeout(() => this.t.close(), 200);
  }
}

// Lo stato completo può superare le decine di kB: si comprime quando il browser lo permette.
async function pack(text: string): Promise<string> {
  try {
    const CS = (globalThis as { CompressionStream?: new (f: string) => GenericTransformStream }).CompressionStream;
    if (!CS) return "j:" + text;
    const stream = new Blob([text]).stream().pipeThrough(new CS("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return "g:" + btoa(bin);
  } catch {
    return "j:" + text;
  }
}

async function unpack(data: string): Promise<string> {
  if (data.startsWith("j:")) return data.slice(2);
  const DS = (globalThis as { DecompressionStream?: new (f: string) => GenericTransformStream }).DecompressionStream!;
  const bin = atob(data.slice(2));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const stream = new Blob([buf]).stream().pipeThrough(new DS("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Response(stream).text();
}
