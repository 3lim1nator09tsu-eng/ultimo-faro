// Client del prototipo: disegna lo stato, raccoglie i tocchi, non decide mai le regole.
import { ADMIN_ONLY, EVENT_TOWER, KINGPIN_QUEUE, SURVIVAL_MAPS, UNITS, UNIT_ORDER, ABILITIES, APEX_RANK, AbilityId, ENEMIES, GameMode, HARDCORE_TOWERS, LEVELS, MODS, LOADOUT_SIZE, MAP_H, MAP_W, MAX_RANK, RANK_COSTS, RULES, STARTER_TOWERS, TICKS_PER_SECOND, TILE, TOWERS, TOWER_ORDER, TRACKS, TowerKind, Track, Branch, levelById } from "../sim-core/content";
import { Command, GameEvent, GameOptions, GameState, modBit, abilityCdOf, allowedOf, cashOf, apexBlock, apexPrice, applyCommands, modsOf, perleFor, cellEmerged, createGame, effStats, hashState, isBuildable, laneIsOpen, levelOf, rankedStats, restore, rewardFor, sellValue, specPrice, statsIn, snapshot, starsFor, step, upgradePrice, waveCount, wavePreview } from "../sim-core/sim";
import { playBot } from "../sim-core/bot";
import { HARDCORE, ModeDef, NIGHTS, SURVIVAL, disgeloFor, modeDef } from "../sim-core/modes";
import { GrantPayload, LocalTransport, Net, RealtimeTransport, Transport, roomCode } from "./net";
import { NetMatch, Player, Setup } from "./netplay";
import { renderLobby, renderOnline } from "./online-ui";
import { AdminApi, BalanceEntry, BalanceKind, describeEntry, renderAdminDrawer, renderAdminPanel } from "./admin";
import { Balance, applyBalance, balanceSize, cleanBalance, emptyBalance, mergeBalance, pruneBalance } from "../sim-core/balance";
import { ChangeEntry, MEDALS, MISSIONS, MissionSlot, Totals, VERSION_NOTES, emptyTotals, levelFromXp, levelReward, missionProgress, missionTarget, missionText, newSlot } from "./progress";
import { COLORS, enemySize, applyMap, drawEnemy, drawFaro, drawShoal, drawTide, drawTowerShape, mapToScreen, renderBackground, toPx } from "./draw";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString("it-IT");
const canvas = $<HTMLCanvasElement>("map");
const ctx = canvas.getContext("2d")!;
const stage = $("stage");
const app = $("app");
const reducedMotion = (() => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
})();

// Grafica leggera: meno pixel, niente neve, carta ferma, al massimo 30 fotogrammi al secondo.
type Gfx = "alta" | "leggera";
function defaultGfx(): Gfx {
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.deviceMemory !== undefined && n.deviceMemory <= 4) || (navigator.hardwareConcurrency || 8) <= 4 ? "leggera" : "alta";
}
let gfx: Gfx = (() => {
  try {
    const v = localStorage.getItem("faro.gfx");
    return v === "alta" || v === "leggera" ? v : defaultGfx();
  } catch {
    return defaultGfx();
  }
})();
const light = () => gfx === "leggera";
let lastRender = 0;

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* il gioco funziona anche senza memoria locale */
    }
  },
};

// ---------- stato del client ----------

interface Line {
  who: string;
  text: string;
}

const INTRO: Line[] = [
  { who: "Anselma", text: "La Marea Nera risale il canale. Questo è l'ultimo faro acceso sulla costa di Valdena." },
  { who: "Tobia", text: "Ho tre progetti e poco legname. Trascina una torre su una riva libera, vicino all'acqua nera." },
  { who: "Anselma", text: "Tieni acceso il Faro per dieci ondate. Ogni nemico che passa gli toglie vite." },
];
const PORTO_LINES: Record<number, Line[]> = {
  1: [{ who: "Tobia", text: "Durante l'ondata hai il Fascio del Faro: toccalo, poi tocca il gruppo più fitto. Si ricarica da solo." }],
  2: [{ who: "Rin", text: "Corridori! Veloci ma fragili. Se ti sfuggono, la Gelata ferma tutti i nemici per tre secondi." }],
  3: [{ who: "Rin", text: "Arrivano i Bruti. Sono corazzati: una balestra semplice li graffia appena. Pensa al Mortaio, o al Dardo perforante." }],
  6: [{ who: "Tobia", text: "Un'intera marea di Risacche. Il Mortaio ne prende molte insieme, se le rallenti col Soffio." }],
  10: [{ who: "Anselma", text: "Quella sagoma in fondo è il Grande Bruto. Se raggiunge il Faro, porta via 8 vite. Preparati." }],
};

let state: GameState = createGame(newSeed(), { allowed: STARTER_TOWERS });
let log: Array<[number, Command[]]> = [];
let speed = 1;
let paused = false;
let accumulator = 0;
let lastFrame = 0;
let placing: TowerKind | null = null;
let ghost: { cx: number; cy: number } | null = null;
let dragFromCard = false;
let selectedId: number | null = null;
let dialogQueue: Line[] = [];
let soundOn = store.get("faro.audio") !== "off";
let endShown = false;
let flash = 0;
let background: HTMLCanvasElement | null = null;
let T = 40; // lato di una casella in pixel CSS
let dpr = 1;
let rot = false; // carta ruotata in verticale
let below = false; // plancia sotto la carta
let bgKey = "";
let inMenu = true;
let aiming = false;
let aimPoint: { x: number; y: number } | null = null;
let iceFlash = 0;
let lastReward = 0;
let lastCombo = 0;
let goldFlash = 0;
let dpsOn = false;
const builtAt = new Map<number, number>();
function towerDps(t: { id: number; damageDone: number }): number {
  if (!builtAt.has(t.id)) builtAt.set(t.id, state.tick);
  const secs = Math.max(1, (state.tick - builtAt.get(t.id)!) / TICKS_PER_SECOND);
  return t.damageDone / secs;
}
const prevPos = new Map<number, { x: number; y: number }>();
// Scheda del nemico: si apre toccandolo o passandoci sopra con il mouse.
let inspectId: number | null = null;
let hoverId: number | null = null;
const drawnAt = new Map<number, { x: number; y: number }>();
const aim = new Map<number, number>();

interface Fx {
  kind: "tracer" | "blast" | "float" | "zap" | "beam" | "ring";
  pts?: number[];
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  r?: number;
  text?: string;
  color?: string;
  born: number;
  life: number;
}
let fx: Fx[] = [];

function newSeed(): number {
  // Il seed nasce qui e poi entra nella simulazione: da quel punto la partita è deterministica.
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
}

const LEVEL_LINES: Record<string, Record<number, Line[]>> = {
  porto: PORTO_LINES,
  foce: {
    1: [{ who: "Rin", text: "Due foci, due file di nemici. Le corsie si uniscono a metà strada: lì una torre le copre entrambe." }],
    5: [{ who: "Tobia", text: "Quei congegni viola sono Sabotatori: stordiscono le torri vicine. Un Medico le libera, e la sua Cura totale le protegge tutte." }],
    10: [{ who: "Anselma", text: "Il Grande Bruto risale la foce nord. Se raggiunge il Faro, porta via 8 vite." }],
  },
  marea: {
    1: [{ who: "Anselma", text: "Con la bassa marea il fondale cambia. Guarda lo sbarramento a sud: prima o poi cederà." }],
    4: [{ who: "Rin", text: "Il canale di marea si è aperto! Adesso arrivano anche da sud." }],
    6: [{ who: "Tobia", text: "Le secche sono emerse: ora si può costruire in mezzo al canale. Un posto perfetto per un Mortaio." }],
    10: [{ who: "Anselma", text: "Il Grande Bruto arriva dal canale di marea. Ultima ondata." }],
  },
};

// Dialoghi delle modalità e delle Notti: compaiono una volta sola, come quelli della campagna.
const MODE_LINES: Record<string, Record<number, Line[]>> = {
  easy: {
    1: [{ who: "Anselma", text: "Sopravvivenza: niente storia, solo la marea. Venti ondate, poi il Grande Bruto." }],
    20: [{ who: "Tobia", text: "Eccolo. Il Grande Bruto non si ferma per niente: tutto il fuoco su di lui." }],
  },
  medium: {
    15: [{ who: "Rin", text: "Da qui la marea porta i primi modificatori. Leggi l'anteprima dell'ondata prima di partire." }],
    25: [{ who: "Anselma", text: "Il Capitano Annegato. Evoca Risacche mentre avanza: non lasciare che la corsia si riempia." }],
  },
  molten: {
    1: [{ who: "Tobia", text: "Brace nell'acqua nera. I Tizzoni non sentono il Soffio: rallentarli non serve, vanno colpiti." }],
    6: [{ who: "Rin", text: "Magmatici: quando cadono si spaccano in due Tizzoni. Il Mortaio prende tutti i pezzi." }],
    30: [{ who: "Anselma", text: "Il Colosso di Brace. Due volte si coprirà di roccia fusa. Tieni pronto il Fascio." }],
  },
  fallen: {
    3: [{ who: "Rin", text: "Spettri. Le torri normali non li vedono: servono il Cecchino, le torri Hardcore, o un Capitano accanto alle altre." }],
    35: [{ who: "Anselma", text: "Il Re Caduto. Tre volte si rialzerà con lo scudo, e i suoi Cavalieri gli aprono la strada." }],
  },
  frost: {
    2: [{ who: "Tobia", text: "Brinati. Quando muoiono vicino a una torre la congelano. Tienili lontani, o tieni vicino un Medico." }],
    40: [{ who: "Anselma", text: "La Regina dell'Inverno. Il suo canto ferma tutto ciò che tocca. Questa è la notte più fredda della costa." }],
  },
  hardcore: {
    1: [{ who: "Anselma", text: "Hardcore. Cinquanta ondate, dieci vite, ogni nemico con qualcosa in più. In fondo c'è il Leviatano." }],
    50: [{ who: "Rin", text: "Il Leviatano emerge. Si rigenera, evoca, ruggisce. Le Perle Nere che hai speso servono adesso." }],
  },
  "natale:1": {
    1: [{ who: "Anselma", text: "La vigilia. Qualcuno ha spento le luci della festa sulla costa, e la marea ha portato la neve." }],
    20: [{ who: "Tobia", text: "Il Folletto Ladro! Ruba il cash mentre avanza: spendi prima che lo prenda lui." }],
  },
  "natale:2": { 25: [{ who: "Rin", text: "La Renna Nera. Scatta all'improvviso: tieni la Gelata per quando corre." }] },
  "natale:3": { 30: [{ who: "Tobia", text: "Il Pupazzo Colossale. Se cade, si spezza in sei pupazzi più piccoli." }] },
  "natale:4": { 35: [{ who: "Anselma", text: "La Befana vola sulla scopa, e nessuno la vede. Solo chi rileva gli invisibili può colpirla." }] },
  "natale:5": {
    1: [{ who: "Anselma", text: "L'ultima notte. Tutti quelli che hai respinto torneranno, e dietro di loro c'è Krampus." }],
    40: [{ who: "Rin", text: "Krampus. Quattro scudi, ruba, evoca, stordisce. Se il Faro regge stanotte, regge per sempre." }],
  },
};
const lineKey = () => (state.mode === "natale" ? `natale:${state.night}` : state.mode);

// ---------- progressi permanenti ----------
// Per ora restano su questo dispositivo; con Supabase passeranno al ledger del server.

interface Meta {
  v: 2;
  schegge: number;
  earned: number;
  unlocked: TowerKind[];
  loadout: TowerKind[];
  ranks: Record<TowerKind, number>;
  stars: Record<string, number>;
  wins: Record<string, number>;
  bestWave: Record<string, number>;
  introSeen: boolean;
  seenLines: string[];
  perle: number;
  xp: number;
  totals: Totals;
  missions: MissionSlot[];
  missionNext: number;
  hcWins: Record<string, number>;
  medals: string[];
  draft: Balance; // prove di bilanciamento su questo dispositivo
  changes: ChangeEntry[];
  newsSeen: number;
  modeWins: Record<string, number>;
  modeBest: Record<string, number>;
  nightWins: Record<string, number>;
  nightBest: Record<string, number>;
  mapPick: string;
  account: string; // id dell'account a cui è legato questo salvataggio
  rev: number;
}

function freshMeta(): Meta {
  const ranks = {} as Record<TowerKind, number>;
  for (const k of TOWER_ORDER) ranks[k] = 1;
  const totals = emptyTotals();
  return {
    v: 2, schegge: 0, earned: 0, unlocked: [...STARTER_TOWERS], loadout: [...STARTER_TOWERS], ranks, stars: {}, wins: {}, bestWave: {}, introSeen: false, seenLines: [],
    perle: 0, xp: 0, totals, missions: [0, 1, 2].map((i) => newSlot(i, totals)), missionNext: 3, hcWins: {}, medals: [], draft: emptyBalance(), changes: [], newsSeen: 0,
    modeWins: {}, modeBest: {}, nightWins: {}, nightBest: {}, mapPick: "porto", account: "", rev: 0,
  };
}

function loadMeta(raw: string | null = store.get("faro.meta.v1")): Meta {
  const m = freshMeta();
  try {
    if (!raw) return m;
    const d = JSON.parse(raw) as Record<string, unknown> & Partial<Meta>;
    const n = (v: unknown, lo: number, hi: number, fb: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : fb);
    const record = (v: unknown, hi: number) => {
      const out: Record<string, number> = {};
      if (v && typeof v === "object") for (const l of LEVELS) if (l.id in (v as object)) out[l.id] = n((v as Record<string, unknown>)[l.id], 0, hi, 0);
      return out;
    };
    m.schegge = n(d.schegge, 0, 1e9, 0);
    m.earned = n(d.earned, 0, 1e9, 0);
    m.introSeen = !!d.introSeen;
    if (Array.isArray(d.unlocked)) for (const k of d.unlocked) if (TOWER_ORDER.includes(k) && !m.unlocked.includes(k)) m.unlocked.push(k);
    for (const k of TOWER_ORDER) m.ranks[k] = n(d.ranks?.[k], 1, MAX_RANK, 1);
    if (d.v === 2) {
      m.stars = record(d.stars, 3);
      m.wins = record(d.wins, 1e6);
      m.bestWave = record(d.bestWave, 1e6);
      if (Array.isArray(d.seenLines)) m.seenLines = d.seenLines.filter((x) => typeof x === "string");
      if (Array.isArray(d.loadout)) m.loadout = d.loadout.filter((k, i, all) => m.unlocked.includes(k) && all.indexOf(k) === i).slice(0, LOADOUT_SIZE);
    } else {
      // Progressi della versione 0.3: valgono per il Porto.
      m.stars.porto = n(d.bestStars, 0, 3, 0);
      m.wins.porto = n(d.campaignWins, 0, 1e6, 0);
      m.bestWave.porto = n(d.bestWave, 0, 1e6, 0);
      m.loadout = m.unlocked.slice(0, LOADOUT_SIZE);
    }
    if (!m.loadout.length) m.loadout = [...STARTER_TOWERS];
    m.perle = n(d.perle, 0, 1e9, 0);
    m.xp = n(d.xp, 0, 1e12, m.earned);
    if (d.totals && typeof d.totals === "object") for (const k of Object.keys(m.totals) as Array<keyof Totals>) m.totals[k] = n((d.totals as unknown as Record<string, unknown>)[k], 0, 1e12, 0);
    if (Array.isArray(d.missions) && d.missions.length === 3) {
      m.missions = d.missions.map((x: MissionSlot) => ({ pool: n(x?.pool, 0, MISSIONS.length - 1, 0), cycle: n(x?.cycle, 0, 1000, 0), base: n(x?.base, 0, 1e12, 0) }));
      m.missionNext = n(d.missionNext, 3, 1e6, 3);
    }
    m.hcWins = record(d.hcWins, 1e6);
    if (Array.isArray(d.medals)) m.medals = d.medals.filter((x) => typeof x === "string");
    // Le modifiche della 0.8 erano solo per le torri: diventano prove su questo dispositivo.
    const old = (d as { overrides?: unknown }).overrides;
    m.draft = cleanBalance(d.draft ?? (Array.isArray(old) ? { towers: old } : null));
    if (Array.isArray(d.changes)) m.changes = d.changes.filter((c) => c && typeof c.title === "string").slice(-50);
    m.newsSeen = n(d.newsSeen, 0, 1e6, 0);
    const keyed = (v: unknown, keys: string[]) => {
      const out: Record<string, number> = {};
      if (v && typeof v === "object") for (const k of keys) if (k in (v as object)) out[k] = n((v as Record<string, unknown>)[k], 0, 1e6, 0);
      return out;
    };
    const modeKeys = [...SURVIVAL.map((x) => x.id as string), "hardcore"];
    const nightKeys = NIGHTS.map((x) => String(x.night));
    m.modeWins = keyed(d.modeWins, modeKeys);
    m.modeBest = keyed(d.modeBest, modeKeys);
    m.nightWins = keyed(d.nightWins, nightKeys);
    m.nightBest = keyed(d.nightBest, nightKeys);
    if (typeof d.mapPick === "string" && SURVIVAL_MAPS.includes(d.mapPick)) m.mapPick = d.mapPick;
    if (typeof d.account === "string") m.account = d.account;
    m.rev = n(d.rev, 0, 1e9, 0);
  } catch {
    /* dati illeggibili: si riparte da zero */
  }
  return m;
}

const levelOpen = (i: number) => i === 0 || (meta.wins[LEVELS[i - 1].id] ?? 0) > 0;
const modeOpen = (m: ModeDef) => !m.unlock || (meta.modeWins[m.unlock] ?? 0) > 0;
const nightOpen = (n: number) => n === 1 || (meta.nightWins[String(n - 1)] ?? 0) > 0;
const modeName = (id: string) => (id === "hardcore" ? "Hardcore" : SURVIVAL.find((x) => x.id === id)?.name ?? id);
/** Il Disgelo dipende dalla data di questo dispositivo; in multigiocatore vale quella di chi ospita. */
function disgelo() {
  const d = new Date();
  return disgeloFor(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

let meta = loadMeta();
const net = new Net();
let match: NetMatch | null = null;
let cloudTimer = 0;
let cloudNote = "";
function saveMeta() {
  meta.rev += 1;
  store.set("faro.meta.v1", JSON.stringify(meta));
  // Con l'accesso fatto, il salvataggio va anche online (raggruppando le modifiche ravvicinate).
  if (net.session && meta.account === net.session.userId) {
    clearTimeout(cloudTimer);
    cloudTimer = window.setTimeout(pushCloud, 2500);
  }
}
async function pushCloud() {
  if (!net.session) return;
  const rest = meta;
  try {
    await net.pushSave(rest, meta.rev, meta.earned, meta.totals.wins, meta.totals.perle);
    cloudNote = `Salvato online alle ${new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (e) {
    cloudNote = `Salvataggio online non riuscito: ${(e as Error).message}`;
  }
  if (inMenu) renderOnlineSection();
}
/** Dopo l'accesso: il salvataggio online vince su quello del dispositivo, che resta come copia di riserva. */
async function syncAfterLogin() {
  if (!net.session) return;
  const id = net.session.userId;
  try {
    const row = await net.loadSave();
    if (row && row.meta && typeof row.meta === "object") {
      store.set("faro.meta.backup", JSON.stringify(meta));
      meta = loadMeta(JSON.stringify(row.meta));
      meta.account = id;
      store.set("faro.meta.v1", JSON.stringify(meta));
      cloudNote = "Progressi caricati dal salvataggio online";
    } else {
      // Account nuovo: prende i progressi del dispositivo solo se non erano già di un altro account.
      if (meta.account && meta.account !== id) {
        store.set("faro.meta.backup", JSON.stringify(meta));
        const keep = { introSeen: meta.introSeen, mapPick: meta.mapPick, newsSeen: meta.newsSeen };
        meta = { ...freshMeta(), ...keep };
        cloudNote = "Account nuovo: si parte da zero (i progressi dell'altro account restano suoi)";
      } else cloudNote = "Progressi di questo dispositivo salvati online";
      meta.account = id;
      await pushCloud();
    }
  } catch (e) {
    cloudNote = `Salvataggio online non disponibile: ${(e as Error).message}`;
  }
  store.set("faro.meta.v1", JSON.stringify(meta));
  applyAll();
  await claimGrants();
  if (inMenu) renderMenu();
}

// ---------- premi dell'admin ----------

let claiming = false;
/** Riscuote i premi in attesa: prima li segna come riscossi sul server, così un altro dispositivo non li prende due volte. */
async function claimGrants() {
  if (!net.session || meta.account !== net.session.userId || claiming) return;
  claiming = true;
  const got: string[] = [];
  const notes: string[] = [];
  try {
    for (const g of await net.myGrants()) {
      if (!(await net.claimGrant(g.id))) continue;
      got.push(...applyGrant(g.payload));
      if (g.note) notes.push(g.note);
      store.set("faro.meta.v1", JSON.stringify(meta));
    }
  } catch {
    /* si riprova al prossimo avvio */
  }
  claiming = false;
  if (!got.length) return;
  saveMeta();
  toast(`Dall'admin: ${got.join(", ")}${notes.length ? ` · "${notes.join('" · "')}"` : ""}`);
  if (inMenu) renderMenu();
}

function applyGrant(p: GrantPayload): string[] {
  const out: string[] = [];
  const int = (v: unknown, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.floor(v))) : 0);
  const sN = int(p?.schegge, 1_000_000);
  const pN = int(p?.perle, 100_000);
  if (sN) {
    meta.schegge += sN;
    out.push(`+${fmt(sN)} Schegge`);
  }
  if (pN) {
    meta.perle += pN;
    out.push(`+${fmt(pN)} Perle`);
  }
  const own = (k: TowerKind) => {
    if (meta.unlocked.includes(k)) return false;
    meta.unlocked.push(k);
    if (meta.loadout.length < LOADOUT_SIZE) meta.loadout.push(k);
    return true;
  };
  const ok = (k: unknown): k is TowerKind => typeof k === "string" && TOWER_ORDER.includes(k as TowerKind) && !ADMIN_ONLY.includes(k as TowerKind);
  if (Array.isArray(p?.unlock)) for (const k of p.unlock) if (ok(k) && own(k)) out.push(`${TOWERS[k].name} sbloccata`);
  if (p?.ranks && typeof p.ranks === "object")
    for (const [k, r] of Object.entries(p.ranks)) {
      if (!ok(k)) continue;
      const rank = Math.max(1, Math.min(MAX_RANK, int(r, MAX_RANK)));
      own(k);
      meta.ranks[k] = rank;
      out.push(`${TOWERS[k].name} al rango ${rank}`);
    }
  return out;
}

// Bilanciamento: valori del codice, poi quelli pubblicati sul server, poi le prove dell'admin su
// questo dispositivo. In multigiocatore chi partecipa usa quelli di chi ospita.
let published: Balance = emptyBalance();
let publishedRev = 0;
let publishedAt = "";
let publishedFresh = false;
let matchBalance: Balance | null = null;
let serverNews: ChangeEntry[] = [];
try {
  const c = JSON.parse(store.get("faro.balance.v1") || "null");
  if (c) {
    published = cleanBalance(c.data);
    publishedRev = Number(c.rev) || 0;
    publishedAt = String(c.at || "");
  }
} catch {
  /* copia illeggibile: si riparte dai valori del codice */
}
function applyAll() {
  if (matchBalance) applyBalance(matchBalance);
  else applyBalance(published, myDraft());
}
/** Le prove di bilanciamento valgono solo per l'admin confermato. */
function myDraft(): Balance {
  return isAdmin() ? meta.draft : emptyBalance();
}
applyAll();
const effectiveBalance = () => matchBalance ?? mergeBalance(published, myDraft());
function cachePublished() {
  store.set("faro.balance.v1", JSON.stringify({ data: published, rev: publishedRev, at: publishedAt }));
}
/** Scarica il bilanciamento pubblicato e la sua bacheca. */
async function loadPublished(withNews = true) {
  const row = await net.fetchBalance();
  if (row) {
    published = cleanBalance(row.data);
    publishedRev = row.rev;
    publishedAt = row.updated_at;
    publishedFresh = true;
    cachePublished();
    applyAll();
  }
  if (withNews) {
    const log = await net.fetchBalanceLog(15).catch(() => []);
    serverNews = log.map((r) => ({ date: r.created_at.slice(0, 10), title: r.title, items: Array.isArray(r.items) ? r.items.map(String) : [], kind: "bilanciamento" as const }));
  }
}
const news = () => [...meta.changes].reverse().concat(serverNews).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0)).concat(VERSION_NOTES);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---------- audio sintetizzato ----------

let audio: AudioContext | null = null;
const lastSound: Record<string, number> = {};

function wakeAudio() {
  if (audio) {
    if (audio.state === "suspended") audio.resume().catch(() => {});
    return;
  }
  try {
    audio = new AudioContext();
  } catch {
    audio = null;
  }
}

function tone(name: string, freq: number, to: number, dur: number, type: OscillatorType, gain: number, gapMs = 50) {
  if (!soundOn || !audio || audio.state !== "running") return;
  const now = performance.now();
  if (now - (lastSound[name] ?? -1e9) < gapMs) return;
  lastSound[name] = now;
  const t = audio.currentTime;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const sfx = {
  shot: () => tone("shot", 880, 420, 0.05, "triangle", 0.035, 70),
  thump: () => tone("thump", 150, 60, 0.16, "sine", 0.14, 90),
  blast: () => tone("blast", 110, 40, 0.28, "sawtooth", 0.05, 90),
  kill: () => tone("kill", 520, 760, 0.07, "sine", 0.03, 60),
  leak: () => tone("leak", 180, 70, 0.4, "square", 0.05, 200),
  build: () => tone("build", 330, 660, 0.14, "triangle", 0.08),
  coin: () => tone("coin", 980, 1320, 0.12, "sine", 0.06),
  horn: () => tone("horn", 110, 92, 0.9, "sawtooth", 0.045, 500),
  deny: () => tone("deny", 200, 150, 0.12, "square", 0.03, 120),
  zap: () => tone("zap", 1600, 300, 0.09, "sawtooth", 0.025, 90),
  sabotage: () => tone("sabotage", 300, 900, 0.18, "square", 0.04, 150),
  heal: () => tone("heal", 660, 990, 0.25, "sine", 0.05, 200),
  rally: () => tone("rally", 330, 440, 0.6, "sawtooth", 0.06, 400),
  apex: () => tone("apex", 220, 880, 0.9, "triangle", 0.1, 600),
  combo: () => tone("combo", 1200, 1800, 0.06, "square", 0.02, 120),
  song: () => tone("song", 880, 660, 0.8, "sine", 0.07, 500),
  roar: () => tone("roar", 90, 40, 1.2, "sawtooth", 0.12, 800),
  beam: () => tone("beam", 520, 1400, 0.35, "triangle", 0.09, 200),
  freeze: () => tone("freeze", 2200, 900, 0.5, "sine", 0.06, 300),
};

// ---------- impaginazione ----------

// Altezza della plancia compatta quando sta sotto la carta.
const BELOW_PANEL = 146;
const PANEL_W = 200;

function layout(measured = 0) {
  const box = app.getBoundingClientRect();
  const cs = getComputedStyle(app);
  const availW = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = box.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  // Tre disposizioni possibili: vince quella con le caselle più grandi.
  const side = Math.min((availW - PANEL_W - 8) / MAP_W, availH / MAP_H);
  // Ogni fila di 6 carte in più (partita di prova con 12 torri) aggiunge circa 57 px.
  const cardRows = Math.max(1, Math.ceil($("build").children.length / 6));
  const belowH = Math.max(measured, BELOW_PANEL + (cardRows - 1) * 57);
  const flat = Math.min(availW / MAP_W, (availH - belowH - 8) / MAP_H);
  const turned = Math.min(availW / MAP_H, (availH - belowH - 8) / MAP_W);
  let best = side;
  let mode: "side" | "flat" | "turned" = "side";
  if (flat > best * 1.04) {
    best = flat;
    mode = "flat";
  }
  if (turned > best * 1.04) {
    best = turned;
    mode = "turned";
  }
  rot = mode === "turned";
  below = mode !== "side";
  app.classList.toggle("landscape", !below);
  app.classList.toggle("portrait", below);
  const cols = rot ? MAP_H : MAP_W;
  const rows = rot ? MAP_W : MAP_H;
  const w = Math.max(cols * 14, Math.floor(best * cols));
  T = w / cols;
  const h = Math.round(T * rows);
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  // Tetto ai pixel della tela: su schermi grandi la densità scende, il disegno resta nitido ma costa molto meno.
  const budget = light() ? 1.1e6 : 2.4e6;
  dpr = Math.min(window.devicePixelRatio || 1, light() ? 1 : 2, Math.sqrt(budget / Math.max(1, w * h)));
  dpr = Math.max(0.5, dpr);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  const key = `${pw}x${ph}:${rot}:${state.levelId}:${state.mode === "natale"}`;
  if (key !== bgKey) {
    bgKey = key;
    canvas.width = pw;
    canvas.height = ph;
    background = renderBackground(levelOf(state).map, pw, ph, rot, state.mode === "natale");
  }
  // Con la plancia sotto, il dettaglio della torre si apre sopra la carta.
  const detail = $("detail");
  if (below && detail.parentElement !== stage) stage.append(detail);
  if (!below && detail.parentElement === stage) $("panel").insertBefore(detail, $("bar"));
  // La stima della plancia può sbagliare di qualche pixel: misura e ricalcola una volta.
  if (below && !measured) {
    const ph2 = Math.ceil($("panel").getBoundingClientRect().height);
    if (h + 8 + ph2 > availH) layout(ph2);
  }
}

/** Unità della simulazione → pixel del canvas. */
function S(ux: number, uy: number): { x: number; y: number } {
  const pxT = T * dpr;
  return mapToScreen(rot, pxT, (ux / TILE) * pxT, (uy / TILE) * pxT);
}

function cellRect(cx: number, cy: number) {
  const a = S(cx * TILE, cy * TILE);
  const b = S((cx + 1) * TILE, (cy + 1) * TILE);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

const turn = () => (rot ? Math.PI / 2 : 0);

// ---------- plancia ----------

const cards = new Map<TowerKind, HTMLButtonElement>();

function buildCards() {
  const host = $("build");
  host.innerHTML = "";
  host.classList.toggle("many", myAllowed().length > 6);
  cards.clear();
  for (const kind of myAllowed()) {
    const def = TOWERS[kind];
    const b = document.createElement("button");
    b.className = "card";
    b.dataset.kind = kind;
    b.setAttribute("aria-label", `${def.name}, costo ${def.levels[0].cost}. ${def.role}`);
    const icon = document.createElement("canvas");
    icon.width = 76;
    icon.height = 76;
    const ic = icon.getContext("2d")!;
    drawTowerShape(ic, kind, 38, 38, 76, -0.6);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = def.name;
    const cost = document.createElement("span");
    cost.className = "cost";
    cost.textContent = `${def.levels[0].cost}`;
    b.append(icon, name, cost);
    host.append(b);
    cards.set(kind, b);
    b.addEventListener("pointerdown", (ev) => {
      wakeAudio();
      if (dialogQueue.length || isOver()) return;
      if (!myAllowed().includes(kind)) {
        toast(`Sblocca ${def.name} nell'Arsenale`);
        sfx.deny();
        return;
      }
      if (myCash() < def.levels[0].cost) {
        toast(`Servono ${def.levels[0].cost} cash per ${def.name}`);
        sfx.deny();
        return;
      }
      ev.preventDefault();
      if (placing === kind && !dragFromCard) {
        setPlacing(null);
        return;
      }
      selectTower(null);
      setPlacing(kind);
      if (below) toast(`${def.name}: tocca una riva libera`);
      dragFromCard = true;
      dragMoved = false;
    });
    // Da tastiera il pulsante resta utilizzabile: Invio seleziona la torre.
    b.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        setPlacing(placing === kind ? null : kind);
      }
    });
  }
}

let dragMoved = false;
const isOver = () => state.phase === "won" || state.phase === "lost";

function setPlacing(kind: TowerKind | null) {
  if (kind) setAiming(false);
  placing = kind;
  ghost = null;
  dragFromCard = false;
  for (const [k, b] of cards) b.classList.toggle("on", k === kind);
}

function selectTower(id: number | null) {
  selectedId = id;
  if (id !== null) setPlacing(null);
}

function setAiming(on: boolean) {
  aiming = on;
  aimPoint = null;
  $("abFascio").classList.toggle("on", on);
}

let toastTimer = 0;
function toast(text: string) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 1800);
}

function statsLine(kind: TowerKind, level: number, branch: Branch | null, rank = 1): string {
  const s = rankedStats({ kind, level, branch }, rank);
  const num = (v: number) => v.toLocaleString("it-IT", { maximumFractionDigits: 1 });
  const range = num(s.range / TILE);
  const pct = (bp: number) => `${Math.round(bp / 100)}%`;
  if (kind === "grammofono") return `Il disco scelto dà +${pct(s.auraBp)} alle torri vicine. Raggio ${range}.`;
  if (kind === "capitano") return `+${pct(s.hasteBp)} di cadenza alle torri vicine${s.rangeBuffBp ? `, +${pct(s.rangeBuffBp)} gittata` : ""}. Raggio ${range}.`;
  if (kind === "medico") return `Libera le torri stordite, poi le protegge ${num(s.immune / TICKS_PER_SECOND)} s. Raggio ${range}.`;
  if (kind === "kingpin") {
    const who = UNIT_ORDER.filter((_, i) => s.unitSet & (1 << i)).map((u) => UNITS[u].name).join(", ");
    return `Spara: danno ${s.damage}, ${num(TICKS_PER_SECOND / s.cooldown)} colpi/s, gittata ${range}${s.pierce ? ", ignora l'armatura" : ""}. Coda di ${s.queueSlots} ${s.queueSlots === 1 ? "posto" : "posti"} (${who}), uno ogni ${num(s.spawnEvery / TICKS_PER_SECOND)} s, fino a ${s.spawnMax} in campo, vita x${num(s.unitBp / 10000)}. Chi si scontra con uno scagnozzo perde la sua vita.${s.abilityCooldown ? " Abilità Taglia." : ""}`;
  }
  if (kind === "campana") return `+${pct(s.auraBp)} danno, +${pct(s.hasteBp)} cadenza, +${pct(s.rangeBuffBp)} gittata, vista sugli invisibili e niente stordimenti. Raggio ${range}.`;
  if (s.pulseAll) return `Ogni secondo ${s.damage} danni a tutti i nemici nel raggio e toglie i modificatori${s.bossBp > 10000 ? `, x${s.bossBp / 10000} sui boss` : ""}. Raggio ${range}.`;
  if (s.markTicks) return `Danno ${s.damage} ogni ${num(s.cooldown / TICKS_PER_SECOND)} s, ignora l'armatura e marchia: +${pct(s.markBp - 10000)} di danno subito. Gittata ${range}.`;
  if (s.income > 0) {
    const extra = s.interestBp ? `, più il ${s.interestBp / 100}% del cash fino a ${s.interestCap}` : s.lifePerWave ? `, più ${s.lifePerWave} vita` : "";
    return `Rende ${s.income} cash a fine ondata${extra}.`;
  }
  if (s.cooldown === 0) {
    const slow = Math.round((10000 - s.slowBp) / 100);
    const extra = s.fragileBp > 10000 ? `, +${Math.round((s.fragileBp - 10000) / 100)}% danno subito` : "";
    return `Rallenta del ${slow}%${extra}. Raggio ${range}.`;
  }
  const rate = num(TICKS_PER_SECOND / s.cooldown);
  const area = s.radius ? `, area ${num(s.radius / TILE)}` : "";
  const chain = s.chains ? `, salta su ${s.chains} nemici` : "";
  const strong = TOWERS[kind].target === "strong" ? " Mira al più forte." : "";
  return `Danno ${s.damage}, ${rate} colpi/s, gittata ${range}${area}${chain}.${strong}`;
}

function setButton(el: HTMLButtonElement, title: string, cost: number | null, note: string) {
  const sig = `${title}|${cost}|${note}`;
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig;
    el.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = title;
    if (cost !== null) {
      const i = document.createElement("i");
      i.textContent = fmt(cost);
      b.append(i);
    }
    el.append(b);
    if (note) {
      const small = document.createElement("small");
      small.textContent = note;
      el.append(small);
    }
  }
}

function describeWave(index: number): string {
  const groups = wavePreview(state, index);
  const parts: string[] = [];
  for (const g of groups) {
    const tag = g.mods.length ? ` (${g.mods.map((m) => MODS[m].name).join(", ")})` : "";
    if (g.boss) parts.push((g.enemy === "bruto" ? "Grande Bruto" : ENEMIES[g.enemy].name) + tag);
    else parts.push(`${g.count} ${g.count === 1 ? ENEMIES[g.enemy].name : ENEMIES[g.enemy].plural}${tag}`);
  }
  return parts.join(", ");
}

function updatePanel() {
  const lives = $("lives");
  lives.textContent = String(state.lives);
  lives.classList.toggle("low", state.lives <= 6);
  $("cash").textContent = fmt(myCash());
  $("wave").textContent = state.mode !== "infinita" ? `${state.wave}/${waveCount(state)}` : String(state.wave);

  const next = $("next");
  const go = $<HTMLButtonElement>("go");
  if (state.phase === "prep") {
    const seconds = Math.ceil(state.prepLeft / TICKS_PER_SECOND);
    const md = modeDef(state.mode, state.night);
    const hc = state.sandbox ? "Prova · " : state.mode === "natale" ? `Notte ${state.night} · ` : md ? `${md.name} · ` : "";
    setHtml(next, `<strong>${hc}Ondata ${state.wave + 1} tra ${seconds} s</strong><br>${describeWave(state.wave)}`);
    go.hidden = false;
    const bonus = Math.floor(state.prepLeft / TICKS_PER_SECOND) * RULES.skipBonusPerSecond;
    setText(go, `Parti ora +${bonus} cash`);
  } else if (state.phase === "wave") {
    const left = state.enemies.length + state.spawns.length;
    setHtml(next, `<strong>Ondata ${state.wave} in corso</strong><br>${left} ${left === 1 ? "nemico" : "nemici"} ancora in arrivo`);
    go.hidden = true;
  } else {
    setHtml(next, "");
    go.hidden = true;
  }
  $("abilities").hidden = state.phase !== "wave";
  for (const [id, el] of [["fascio", $("abFascio")], ["gelata", $("abGelata")]] as Array<[AbilityId, HTMLElement]>) {
    const cd = abilityCdOf(state, myP)[id];
    const full = ABILITIES[id].cooldown;
    el.style.setProperty("--p", String(1 - cd / full));
    el.classList.toggle("ready", cd === 0);
    setText(el.querySelector("small")!, cd === 0 ? "pronto" : `${Math.ceil(cd / TICKS_PER_SECOND)} s`);
  }

  for (const kind of myAllowed()) {
    const b = cards.get(kind);
    if (!b) continue;
    const locked = !myAllowed().includes(kind);
    b.classList.toggle("locked", locked);
    setText(b.querySelector(".cost") as HTMLElement, locked ? "Bloccata" : String(TOWERS[kind].levels[0].cost));
    b.classList.toggle("poor", !locked && myCash() < TOWERS[kind].levels[0].cost);
    b.classList.toggle("hint", state.towers.length === 0 && !placing && kind === myAllowed()[0]);
  }

  const t = selectedId === null ? null : state.towers.find((x) => x.id === selectedId) ?? null;
  if (selectedId !== null && !t) selectedId = null;
  $("build").hidden = !!t && !below;
  const detail = $("detail");
  detail.hidden = !t;
  if (t && below) {
    // Il riquadro non deve coprire la torre scelta.
    detail.classList.toggle("top", S(t.x, t.y).y / dpr > stage.clientHeight / 2);
  }
  if (t) {
    const def = TOWERS[t.kind];
    const two = def.branches2 && t.branch ? def.branches2[t.branch] : null;
    setText($("dName"), t.level >= 5 ? (two ? two.name : def.apex) : t.branch ? def.branches[t.branch].name : def.name);
    const rank = t.rank ?? 1;
    const foreign = t.owner !== myP;
    setText($("dLevel"), `${t.level >= 5 && !two ? "Apex" : `Livello ${t.level}`}${rank > 1 ? ` · Rango ${rank}` : ""}`);
    setText($("dStats"), statsLine(t.kind, t.level, t.branch, rank));
    const up = $<HTMLButtonElement>("btnUp");
    const a = $<HTMLButtonElement>("btnA");
    const bb = $<HTMLButtonElement>("btnB");
    const cost = upgradePrice(state, t);
    up.hidden = cost === null;
    if (cost !== null) {
      setButton(up, `Migliora a livello ${t.level + 1}`, cost, statsLine(t.kind, t.level + 1, null, rank));
      up.disabled = foreign || myCash() < cost;
    }
    const showSpec = t.level === 3;
    a.hidden = !showSpec;
    bb.hidden = !showSpec;
    if (showSpec) {
      const A = def.branches.A;
      const B = def.branches.B;
      const pa = specPrice(state, t, "A");
      const pb = specPrice(state, t, "B");
      setButton(a, A.name, pa, A.summary);
      setButton(bb, B.name, pb, B.summary);
      a.disabled = foreign || myCash() < pa;
      bb.disabled = foreign || myCash() < pb;
    }
    const apexBtn = $<HTMLButtonElement>("btnApex");
    apexBtn.hidden = t.level !== 4;
    if (t.level === 4) {
      const block = apexBlock(state, t);
      const price = apexPrice(state, t);
      if (two) setButton(apexBtn, `Livello 5: ${two.name}`, price, two.summary);
      else setButton(apexBtn, `Apex: ${def.apex}`, block ? null : price, block ?? "Tutto più forte: danno x2,2, più gittata e area");
      apexBtn.disabled = foreign || !!block || myCash() < price;
    }
    const dmg = t.damageDone;
    setText($("dDps"), dmg > 0 ? `Danno inflitto: ${fmt(dmg)}${dpsOn ? ` · ${fmt(Math.round(towerDps(t)))} al secondo` : ""}` : "");
    setText($("btnSell"), foreign ? `Torre di ${ownerName(t.owner)}` : `Vendi +${fmt(sellValue(state, t))}`);
    $<HTMLButtonElement>("btnSell").disabled = foreign;
    updateExtra(t);
  }

  $<HTMLButtonElement>("pause").setAttribute("aria-pressed", String(paused));
  setText($("pause"), paused ? "Riprendi" : "Pausa");
  $("speed").setAttribute("aria-pressed", String(speed === 2));
  $("sound").setAttribute("aria-pressed", String(soundOn));
}

// Controlli delle torri di supporto: dischi del Grammofono e abilità di Capitano e Medico.
function updateExtra(t: GameState["towers"][number]) {
  const host = $("dExtra");
  const def = TOWERS[t.kind];
  const sig = t.kind === "kingpin" ? `${t.id}:${t.level}:${t.branch}:${t.queue.join(",")}:${t.owner === myP}:${statsIn(state, t).queueSlots}` : `${t.id}:${t.kind}`;
  if (host.dataset.sig !== sig) {
    host.dataset.sig = sig;
    host.innerHTML = "";
    if (t.kind === "kingpin") {
      // Coda degli scagnozzi: si ripete in ordine. Tocca un posto per toglierlo, un'unità sotto per aggiungerla.
      const s = statsIn(state, t);
      const mineT = t.owner === myP;
      const open = Math.min(KINGPIN_QUEUE, s.queueSlots || 1);
      const head = document.createElement("small");
      head.className = "kpHead";
      head.textContent = `Coda ${t.queue.length}/${open}: gli scagnozzi partono in ordine, gratis. Tocca un posto per toglierlo.`;
      const slots = document.createElement("div");
      slots.className = "kpSlots";
      for (let i = 0; i < KINGPIN_QUEUE; i++) {
        const u = t.queue[i];
        const locked = i >= open;
        const b = document.createElement("button");
        b.className = `kpSlot${u ? ` kp-${u}` : locked ? " locked" : " empty"}`;
        b.dataset.slot = String(i);
        b.textContent = u ? UNITS[u].name : locked ? `livello ${i + 1}` : "vuoto";
        b.disabled = !u || !mineT;
        if (u) b.addEventListener("click", () => send({ t: "unqueue", id: t.id, index: i }));
        slots.append(b);
      }
      const add = document.createElement("div");
      add.className = "kpAdd";
      UNIT_ORDER.forEach((u, i) => {
        const ok = (s.unitSet & (1 << i)) !== 0;
        const b = document.createElement("button");
        b.className = `kpUnit kp-${u}`;
        b.dataset.unit = u;
        const hpU = Math.floor((UNITS[u].hp * s.unitBp) / 10000);
        const note = !ok ? (u === "sicario" ? "La Famiglia" : "livello più alto") : UNITS[u].pay ? `vita ${hpU}, schianto: cash` : `vita ${hpU}`;
        b.innerHTML = `<b>${UNITS[u].name}</b><small>${note}</small>`;
        b.disabled = !ok || !mineT || t.queue.length >= open;
        b.addEventListener("click", () => send({ t: "queue", id: t.id, unit: u }));
        add.append(b);
      });
      host.append(head, slots, add);
      if (s.abilityCooldown) {
        const ab = document.createElement("button");
        ab.className = "ab towerAb";
        ab.innerHTML = `Taglia<small></small>`;
        ab.disabled = !mineT;
        ab.addEventListener("click", () => send({ t: "towerAbility", id: t.id }));
        host.append(ab);
      }
    } else if (t.kind === "grammofono") {
      for (const k of Object.keys(TRACKS) as Track[]) {
        const b = document.createElement("button");
        b.className = `track track-${k}`;
        b.dataset.track = k;
        b.textContent = TRACKS[k].name;
        b.addEventListener("click", () => send({ t: "track", id: t.id, track: k }));
        host.append(b);
      }
    } else if (def.ability) {
      const b = document.createElement("button");
      b.className = "ab towerAb";
      b.innerHTML = `${def.ability.name}<small></small>`;
      b.addEventListener("click", () => send({ t: "towerAbility", id: t.id }));
      host.append(b);
    }
  }
  host.hidden = !host.childElementCount;
  for (const b of host.querySelectorAll<HTMLButtonElement>(".track")) b.setAttribute("aria-pressed", String(b.dataset.track === t.track));
  const ab = host.querySelector<HTMLElement>(".towerAb");
  if (ab) {
    const full = statsIn(state, t).abilityCooldown;
    ab.style.setProperty("--p", String(1 - t.abilityCd / full));
    ab.classList.toggle("ready", t.abilityCd === 0);
    const summary = t.kind === "kingpin" ? `ogni nemico in campo vale x${statsIn(state, t).abilityBp / 10000} per te, ${statsIn(state, t).abilityTicks / TICKS_PER_SECOND} s` : def.ability?.summary ?? "";
    const note = t.abilityLeft > 0 ? `attiva, ${Math.ceil(t.abilityLeft / TICKS_PER_SECOND)} s` : t.abilityCd === 0 ? summary : `${Math.ceil(t.abilityCd / TICKS_PER_SECOND)} s`;
    setText(ab.querySelector("small")!, note);
  }
}

function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}
function setHtml(el: HTMLElement, html: string) {
  if (el.dataset.html !== html) {
    el.dataset.html = html;
    el.innerHTML = html;
  }
}

// ---------- comandi e tick ----------

function send(cmd: Command) {
  // Comandi admin: solo con l'account admin confermato, o nella partita di prova aperta dal pannello.
  if (cmd.t.startsWith("admin") && !isAdmin() && !state.sandbox) {
    toast("Solo l'admin");
    return;
  }
  if (match && match.status === "playing" && match.state === state) {
    const admin = cmd.t.startsWith("admin");
    if (admin && cmd.t === "adminCash" && cmd.to === undefined) cmd = { ...cmd, to: myP };
    if (match.isHost) match.hostSubmit({ ...cmd, p: 0 });
    else if (admin) {
      // Chi partecipa non può mandare comandi admin nel canale: passano dal database, che controlla il ruolo.
      if (net.session?.isAdmin) net.adminCommand(match.code, cmd).then(() => toast("Comando admin inviato"), (e) => toast((e as Error).message));
      else toast("Solo l'admin");
    } else match.guestSubmit(cmd);
    return;
  }
  const events = applyCommands(state, [cmd]);
  const last = log[log.length - 1];
  if (last && last[0] === state.tick) last[1].push(cmd);
  else log.push([state.tick, [cmd]]);
  handleEvents(events);
}

function handleEvents(events: GameEvent[]) {
  const now = performance.now();
  for (const ev of events) {
    switch (ev.e) {
      case "shot":
        fx.push({ kind: "tracer", x: ev.x, y: ev.y, x2: ev.tx, y2: ev.ty, born: now, life: 110 });
        setAim(ev.from, ev.x, ev.y, ev.tx, ev.ty);
        sfx.shot();
        break;
      case "zap":
        fx.push({ kind: "zap", x: ev.points[0], y: ev.points[1], pts: ev.points, born: now, life: 160 });
        sfx.zap();
        break;
      case "beam":
        fx.push({ kind: "beam", x: ev.x, y: ev.y, r: ev.radius, born: now, life: 520 });
        sfx.beam();
        break;
      case "freeze":
        iceFlash = 1;
        sfx.freeze();
        break;
      case "sabotage":
        fx.push({ kind: "zap", x: ev.x, y: ev.y, pts: [ev.x, ev.y, ev.tx, ev.ty], color: "#c9b8ff", born: now, life: 260 });
        sfx.sabotage();
        break;
      case "heal":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: ev.all ? 9000 : ev.radius, color: "#7fd8a0", born: now, life: 500 });
        sfx.heal();
        break;
      case "rally":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: ev.radius, color: COLORS.brass, born: now, life: 700 });
        toast("Chiamata alle armi!");
        sfx.rally();
        break;
      case "combo":
        if (now - lastCombo > 350) {
          lastCombo = now;
          fx.push({ kind: "float", x: ev.x, y: ev.y - 400, text: `${ev.name}!`, color: ev.name === "Scossa" ? "#c9b8ff" : COLORS.ice, born: now, life: 700 });
          sfx.combo();
        }
        break;
      case "apex":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: 5000, color: COLORS.brass, born: now, life: 900 });
        fx.push({ kind: "float", x: ev.x, y: ev.y - 500, text: ev.name, color: COLORS.brass, born: now, life: 1600 });
        flash = 0;
        goldFlash = 1;
        toast(`Apex: ${ev.name}!`);
        sfx.apex();
        break;
      case "song":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: ev.radius, color: "#c9b8ff", born: now, life: 800 });
        toast(`${bossLabel()}: un canto stordisce le torri`);
        sfx.song();
        break;
      case "roar":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: ev.radius, color: COLORS.coral, born: now, life: 900 });
        toast(`${bossLabel()} ruggisce e si copre di scudi`);
        flash = 0.8;
        sfx.roar();
        break;
      case "summon":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: 1200, color: COLORS.ice, born: now, life: 500 });
        break;
      case "frost":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: ev.radius, color: "#e9fbff", born: now, life: 600 });
        sfx.freeze();
        break;
      case "crash":
        fx.push({ kind: "blast", x: ev.x, y: ev.y, r: 500, born: now, life: 260 });
        sfx.thump();
        break;
      case "bounty":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: 9000, color: COLORS.brass, born: now, life: 700 });
        toast("Taglia sui nemici: valgono di più per te");
        sfx.coin();
        break;
      case "unit":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: 600, color: COLORS.brass, born: now, life: 350 });
        break;
      case "split":
        fx.push({ kind: "blast", x: ev.x, y: ev.y, r: 900, born: now, life: 300 });
        break;
      case "steal":
        if (ev.amount > 0) {
          fx.push({ kind: "float", x: ev.x, y: ev.y - 400, text: `-${ev.amount} cash`, color: COLORS.coral, born: now, life: 900 });
          sfx.deny();
        }
        break;
      case "charge":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: 1500, color: "#ff9a9a", born: now, life: 400 });
        toast("Carica!");
        break;
      case "laneOpen":
        toast("Si apre un nuovo canale!");
        flash = 0.6;
        sfx.horn();
        break;
      case "emerge":
        toast("Le secche sono emerse: ora si può costruire lì");
        sfx.build();
        break;
      case "income": {
        const faroCell = levelOf(state).map.faro;
        const fx0 = Math.max(2500, faroCell[0] * TILE + 500);
        const fy0 = faroCell[1] * TILE;
        const mineAmount = ev.amounts ? ev.amounts[myP] ?? 0 : ev.amount;
        if (!mineAmount && !ev.lives) break;
        const text = `${mineAmount ? `+${mineAmount} cash` : ""}${mineAmount && ev.lives ? ", " : ""}${ev.lives ? `+${ev.lives} vite` : ""}`;
        fx.push({ kind: "float", x: fx0 - 2000, y: fy0, text, color: "#9fd28b", born: now, life: 1400 });
        sfx.coin();
        break;
      }
      case "shell": {
        const shell = state.shells.find((s) => s.id === ev.id);
        if (shell) setAim(ev.from, shell.fromX, shell.fromY, shell.x, shell.y);
        sfx.thump();
        break;
      }
      case "blast":
        fx.push({ kind: "blast", x: ev.x, y: ev.y, r: ev.radius, born: now, life: 320 });
        sfx.blast();
        break;
      case "kill":
        fx.push({ kind: "float", x: ev.x, y: ev.y, text: `+${ev.bounty}`, color: COLORS.brass, born: now, life: 650 });
        sfx.kill();
        break;
      case "leak":
        flash = 1;
        sfx.leak();
        break;
      case "wave":
        sfx.horn();
        // Ogni dialogo d'ondata compare una volta sola: chi rigioca per il grind non viene interrotto.
        const camp = state.mode === "campagna";
        const lines = camp ? LEVEL_LINES[state.levelId]?.[ev.wave] : state.sandbox ? undefined : MODE_LINES[lineKey()]?.[ev.wave];
        const key = camp ? `${state.levelId}:${ev.wave}` : `${lineKey()}:${ev.wave}`;
        if (lines && !match && !meta.seenLines.includes(key)) {
          meta.seenLines.push(key);
          saveMeta();
          openDialog(lines);
        }
        break;
      case "built":
      case "upgraded":
        sfx.build();
        break;
      case "sold":
        sfx.coin();
        break;
      case "reject":
        if ((ev.p ?? 0) !== myP) break;
        toast(ev.reason);
        sfx.deny();
        break;
      case "end":
        finish(ev.phase);
        break;
    }
  }
  const maxFx = light() ? 40 : 90;
  if (fx.length > maxFx) fx = fx.slice(-maxFx);
}

function ownerName(i: number): string {
  if (!match) return "un altro giocatore";
  const id = match.order[i];
  return match.players.get(id)?.name ?? `giocatore ${i + 1}`;
}

function bossLabel(): string {
  const b = state.enemies.find((e) => e.boss);
  return !b ? "Il boss" : b.kind === "bruto" ? "Grande Bruto" : ENEMIES[b.kind].name;
}

function setAim(id: number, x: number, y: number, tx: number, ty: number) {
  aim.set(id, Math.atan2(ty - y, tx - x));
}

function tick() {
  prevPos.clear();
  for (const e of state.enemies) prevPos.set(e.id, { x: e.x, y: e.y });
  if (match && match.isHost && match.state === state) handleEvents(match.hostTick());
  else handleEvents(step(state, []));
}

// ---------- dialoghi e fine partita ----------

function openDialog(lines: Line[]) {
  dialogQueue = [...lines];
  showLine();
}

function showLine() {
  const el = $("dialog");
  const line = dialogQueue[0];
  el.hidden = !line;
  if (!line) return;
  setText($("dSpeaker"), line.who);
  setText($("dText"), line.text);
}

interface AwardResult {
  schegge: number;
  perle: number;
  levelUps: number[];
  medals: string[];
  missionsDone: number;
}

function medalView() {
  return { wins: meta.wins, stars: meta.stars, hcWins: meta.hcWins, unlocked: meta.unlocked, ranks: meta.ranks, totals: meta.totals, level: levelFromXp(meta.xp).level, modeWins: meta.modeWins, nightWins: meta.nightWins };
}

/** Assegna i premi della partita una volta sola. Le partite di prova non danno nulla. */
function award(): AwardResult {
  const out: AwardResult = { schegge: rewardFor(state), perle: perleFor(state), levelUps: [], medals: [], missionsDone: 0 };
  if (state.adminTouched && !state.sandbox) {
    // Partita toccata dall'admin: niente premi, niente classifiche.
    out.schegge = 0;
    out.perle = 0;
    lastReward = 0;
    return out;
  }
  lastReward = out.schegge;
  if (state.sandbox) return out;
  meta.schegge += out.schegge;
  meta.earned += out.schegge;
  meta.perle += out.perle;
  const id = state.levelId;
  const won = state.phase === "won";
  if (state.mode === "campagna" && won) {
    meta.wins[id] = (meta.wins[id] ?? 0) + 1;
    meta.stars[id] = Math.max(meta.stars[id] ?? 0, starsFor(state.lives));
  }
  if (state.mode === "hardcore" && won) meta.hcWins[id] = (meta.hcWins[id] ?? 0) + 1;
  if (modeDef(state.mode) && state.mode !== "natale") {
    meta.modeBest[state.mode] = Math.max(meta.modeBest[state.mode] ?? 0, state.cleared);
    if (won) meta.modeWins[state.mode] = (meta.modeWins[state.mode] ?? 0) + 1;
  }
  if (state.mode === "natale") {
    const k = String(state.night);
    meta.nightBest[k] = Math.max(meta.nightBest[k] ?? 0, state.cleared);
    if (won) meta.nightWins[k] = (meta.nightWins[k] ?? 0) + 1;
    if (won && state.night === NIGHTS.length && !meta.unlocked.includes(EVENT_TOWER)) {
      meta.unlocked.push(EVENT_TOWER);
      out.medals.push(`Torre ottenuta: ${TOWERS[EVENT_TOWER].name}`);
    }
  }
  if (state.mode === "infinita") meta.bestWave[id] = Math.max(meta.bestWave[id] ?? 0, state.cleared);
  const t = meta.totals;
  t.kills += state.kills;
  t.combos += state.combos;
  t.abilities += state.abilitiesUsed;
  t.apex += state.apexBuilt;
  t.bossKills += state.bossKills;
  t.perle += out.perle;
  if (won) t.wins += 1;
  if (won && starsFor(state.lives) === 3) t.stars3 += 1;
  if (state.mode === "hardcore") t.hcWaves = Math.max(t.hcWaves, state.cleared);
  if (state.mode === "infinita") t.infRun = Math.max(t.infRun, state.cleared);
  // Livello del giocatore: le Schegge guadagnate e le Perle (x10) diventano esperienza.
  const before = levelFromXp(meta.xp).level;
  meta.xp += out.schegge + out.perle * 10;
  const after = levelFromXp(meta.xp).level;
  for (let L = before + 1; L <= after; L++) {
    const r = levelReward(L);
    meta.schegge += r.schegge;
    meta.perle += r.perle;
    out.levelUps.push(L);
  }
  out.missionsDone = meta.missions.filter((m) => missionProgress(m, meta.totals) >= missionTarget(m)).length;
  for (const m of MEDALS) {
    if (!meta.medals.includes(m.id) && m.ok(medalView())) {
      meta.medals.push(m.id);
      out.medals.push(m.name);
    }
  }
  saveMeta();
  return out;
}

function finish(phase: "won" | "lost") {
  if (endShown) return;
  endShown = true;
  dialogQueue = [];
  $("dialog").hidden = true;
  setPlacing(null);
  selectTower(null);
  setAiming(false);
  const firstWin = phase === "won" && !(state.mode === "campagna" ? meta.wins[state.levelId] ?? 0 : 1);
  const idx = LEVELS.findIndex((l) => l.id === state.levelId);
  const res = award();
  const reward = res.schegge;
  const won = phase === "won";
  const stars = starsFor(state.lives);
  const infinite = state.mode === "infinita";
  const md = modeDef(state.mode, state.night);
  const bossName = md ? (md.boss.kind === "bruto" ? "Il Grande Bruto" : ENEMIES[md.boss.kind].name) : "";
  setText($("endTitle"), won ? (md ? `${bossName} è caduto` : "Il Faro resta acceso") : infinite ? `Travolto all'ondata ${state.wave}` : "Il Faro si è spento");
  setText($("endStars"), won ? "★".repeat(stars) + "☆".repeat(3 - stars) : "");
  $("endStars").hidden = !won;
  const summary = infinite
    ? `Hai superato ${state.cleared} ondate, con ${state.kills} nemici abbattuti. Il tuo record qui è l'ondata ${meta.bestWave[state.levelId] ?? 0}.`
    : `${won ? `${waveCount(state)} ondate respinte` : `Hai resistito fino all'ondata ${state.wave} di ${waveCount(state)}`}, con ${state.kills} nemici abbattuti e ${state.lives} ${state.lives === 1 ? "vita rimasta" : "vite rimaste"}.`;
  const next = LEVELS[idx + 1];
  const unlockedMode = won && md && state.mode !== "natale" ? SURVIVAL.concat(HARDCORE).filter((x) => x.unlock === state.mode).map((x) => x.name) : [];
  const tip =
    state.mode === "campagna" && firstWin
      ? ` Hai sbloccato Infinita${next ? ` e il livello ${next.name}` : ""}.`
      : unlockedMode.length && (meta.modeWins[state.mode] ?? 0) === 1
        ? ` Hai sbloccato ${unlockedMode.join(" e ")}.`
        : won && state.mode === "natale" && state.night < NIGHTS.length && (meta.nightWins[String(state.night)] ?? 0) === 1
          ? ` Si apre la Notte ${state.night + 1}.`
          : won && stars < 3 && !md
            ? " Per le tre stelle servono almeno 18 vite."
            : "";
  setText($("endText"), summary + tip);
  const extras = [
    res.perle ? `+${res.perle} Perle Nere` : "",
    ...res.levelUps.map((L) => `Livello ${L}!`),
    ...res.medals.map((m) => `Medaglia: ${m}`),
    res.missionsDone ? `${res.missionsDone === 1 ? "Una missione completata" : `${res.missionsDone} missioni completate`}: riscuoti nel menu` : "",
  ].filter(Boolean);
  setText($("endReward"), state.sandbox ? "Partita di prova: nessun premio" : state.adminTouched ? "Partita modificata dall'admin: nessun premio" : `+${reward} Schegge`);
  setText($("endExtra"), extras.join(" · "));
  $("end").hidden = false;
}

let lastOpts: GameOptions | null = null;
/** Indice di questo giocatore nella partita (0 in solitaria e per chi ospita). */
let myP = 0;
const myCash = () => cashOf(state, myP);
const myAllowed = () => allowedOf(state, myP);
function newMatch(mode: GameMode, level = state.levelId, seed = newSeed(), opts?: GameOptions) {
  const o = opts ?? { mode, level, allowed: meta.loadout, ranks: meta.ranks };
  lastOpts = o;
  beginState(createGame(seed, o));
}

/** Prepara l'interfaccia per una partita già creata (in solitaria o ricevuta da chi ospita). */
function beginState(st: GameState) {
  state = st;
  myP = match && match.state === st ? Math.max(0, match.order.indexOf(match.me.id)) : 0;
  builtAt.clear();
  goldFlash = 0;
  $("adminDrawer").hidden = true;
  buildCards();
  layout();
  log = [];
  fx = [];
  aim.clear();
  prevPos.clear();
  paused = false;
  speed = 1;
  accumulator = 0;
  endShown = false;
  flash = 0;
  iceFlash = 0;
  setPlacing(null);
  selectTower(null);
  setAiming(false);
  $("end").hidden = true;
  $("pauseLayer").hidden = true;
  $("dialog").hidden = true;
  dialogQueue = [];
  inMenu = false;
  $("menu").hidden = true;
  if (!meta.introSeen && !match) {
    meta.introSeen = true;
    saveMeta();
    openDialog(INTRO);
  }
}

function restart() {
  if (match) {
    showLobby();
    return;
  }
  // Rigioca con le stesse regole; in Natale il Disgelo si ricalcola dalla data di oggi.
  const o = lastOpts ? { ...lastOpts } : undefined;
  if (o && o.mode === "natale" && !o.sandbox) o.eventBp = disgelo().bp;
  newMatch(state.mode, state.levelId, newSeed(), o);
}

function playNight(n: number) {
  newMatch("natale", NIGHTS[n - 1].map, newSeed(), { mode: "natale", night: n, eventBp: disgelo().bp, allowed: meta.loadout, ranks: meta.ranks });
}

// ---------- menu e Arsenale ----------

function showMenu() {
  inMenu = true;
  paused = false;
  $("pauseLayer").hidden = true;
  $("end").hidden = true;
  $("menu").hidden = false;
  renderMenu();
}

function renderMenu() {
  setText($("mSchegge"), fmt(meta.schegge));
  setText($("mPerle"), fmt(meta.perle));
  const lv = levelFromXp(meta.xp);
  setText($("mLevel"), `Livello ${lv.level}`);
  setText($("mXp"), `${fmt(lv.into)} / ${fmt(lv.need)} XP`);
  $("mXpBar").style.setProperty("--p", String(lv.into / lv.need));
  $("adminOpen").hidden = !isAdmin();
  if (!isAdmin()) $("adminPanel").hidden = true;
  setText($("gfxToggle"), `Grafica: ${gfx === "alta" ? "alta" : "leggera"}`);
  renderOnlineSection();
  renderMissions();
  renderMedals();
  renderNews();
  const levels = $("levels");
  levels.innerHTML = "";
  LEVELS.forEach((l, i) => {
    const open = levelOpen(i);
    const won = (meta.wins[l.id] ?? 0) > 0;
    const card = document.createElement("div");
    card.className = `level${open ? "" : " closed"}`;
    const stars = meta.stars[l.id] ?? 0;
    const head = document.createElement("div");
    head.className = "levelHead";
    const name = document.createElement("b");
    name.textContent = `${i + 1}. ${l.name}`;
    const st = document.createElement("span");
    st.className = "stars";
    st.textContent = open ? "★".repeat(stars) + "☆".repeat(3 - stars) : "";
    head.append(name, st);
    const sub = document.createElement("small");
    sub.textContent = open ? l.sub : `Si apre vincendo ${LEVELS[i - 1].name}`;
    const row = document.createElement("div");
    row.className = "levelBtns";
    const play = document.createElement("button");
    play.className = "mode";
    play.dataset.play = l.id;
    if (i === 0) play.id = "mCampagna";
    play.textContent = "Gioca";
    play.disabled = !open;
    play.addEventListener("click", () => {
      wakeAudio();
      newMatch("campagna", l.id);
    });
    const inf = document.createElement("button");
    inf.dataset.endless = l.id;
    if (i === 0) inf.id = "mInfinita";
    const best = meta.bestWave[l.id] ?? 0;
    inf.textContent = won ? (best ? `Infinita · record ${best}` : "Infinita") : "Infinita";
    inf.disabled = !won;
    inf.title = won ? "" : "Si apre vincendo questo livello";
    inf.addEventListener("click", () => {
      wakeAudio();
      newMatch("infinita", l.id);
    });
    row.append(play, inf);
    card.append(head, sub, row);
    levels.append(card);
  });

  renderModes();
  renderNights();
  setText($("squadNote"), `Squadra ${meta.loadout.length}/${LOADOUT_SIZE}: solo queste torri entrano in partita.`);
  const host = $("arsenal");
  host.innerHTML = "";
  // Torri admin: compaiono e si usano solo con l'admin attivo.
  if (isAdmin()) for (const k of ADMIN_ONLY) if (!meta.unlocked.includes(k)) meta.unlocked.push(k);
  if (!isAdmin() && ADMIN_ONLY.some((k) => meta.unlocked.includes(k))) {
    meta.unlocked = meta.unlocked.filter((k) => !ADMIN_ONLY.includes(k));
    meta.loadout = meta.loadout.filter((k) => !ADMIN_ONLY.includes(k));
    if (!meta.loadout.length) meta.loadout = [...STARTER_TOWERS];
  }
  for (const kind of TOWER_ORDER) {
    if (ADMIN_ONLY.includes(kind) && !isAdmin()) continue;
    const def = TOWERS[kind];
    const row = document.createElement("div");
    const owned = meta.unlocked.includes(kind);
    const inSquad = meta.loadout.includes(kind);
    row.className = `row${inSquad ? " inSquad" : ""}${def.perle ? " hardcore" : ""}${def.exclusive ? ` excl-${def.exclusive}` : ""}`;
    const icon = document.createElement("canvas");
    icon.width = 76;
    icon.height = 76;
    drawTowerShape(icon.getContext("2d")!, kind, 38, 38, 76, -0.6);
    const text = document.createElement("div");
    text.className = "rowText";
    const rank = meta.ranks[kind];
    const name = document.createElement("b");
    name.textContent = def.name;
    const role = document.createElement("small");
    const apexNote = owned && rank < APEX_RANK ? ` · Apex dal rango ${APEX_RANK}` : "";
    role.textContent = owned ? `${def.role} · Rango ${rank}/${MAX_RANK}${apexNote}` : def.perle ? `Torre Hardcore. ${def.role}` : def.role;
    text.append(name, role);
    const pips = document.createElement("span");
    pips.className = "pips";
    pips.setAttribute("aria-hidden", "true");
    for (let i = 1; i <= MAX_RANK; i++) {
      const pip = document.createElement("i");
      if (owned && i <= rank) pip.className = "on";
      pips.append(pip);
    }
    text.append(pips);
    const btns = document.createElement("div");
    btns.className = "rowBtns";
    const btn = document.createElement("button");
    btn.dataset.kind = kind;
    let price = 0;
    const pearls = !!def.perle && !owned;
    if (def.exclusive === "evento" && !owned) {
      btn.textContent = "Vinci la Notte 5";
      btn.disabled = true;
      btn.title = "Premio per chi vince l'ultima Notte di Natale";
    } else if (pearls) {
      price = def.perle!;
      btn.textContent = `Sblocca · ${fmt(price)} Perle`;
      btn.dataset.action = "unlock";
      btn.classList.add("pearl");
    } else if (!owned) {
      price = def.unlock;
      btn.textContent = `Sblocca · ${fmt(price)}`;
      btn.dataset.action = "unlock";
    } else if (rank < MAX_RANK) {
      price = RANK_COSTS[rank];
      btn.textContent = `Rango ${rank + 1} · ${fmt(price)}`;
      btn.dataset.action = "rank";
    } else {
      btn.textContent = "Rango massimo";
      btn.disabled = true;
    }
    if (price && (pearls ? meta.perle : meta.schegge) < price) {
      btn.disabled = true;
      btn.title = `Servono ${fmt(price)} ${pearls ? "Perle Nere" : "Schegge"}`;
    }
    btn.addEventListener("click", () => buyFromArsenal(kind));
    btns.append(btn);
    if (owned) {
      const sq = document.createElement("button");
      sq.className = "squad";
      sq.dataset.squad = kind;
      sq.setAttribute("aria-pressed", String(inSquad));
      sq.textContent = inSquad ? "In squadra" : "Aggiungi";
      sq.disabled = !inSquad && meta.loadout.length >= LOADOUT_SIZE;
      if (inSquad && meta.loadout.length === 1) sq.disabled = true;
      sq.addEventListener("click", () => toggleSquad(kind));
      btns.append(sq);
    }
    row.append(icon, text, btns);
    host.append(row);
  }
}

function modeCard(m: ModeDef, host: HTMLElement) {
  const open = modeOpen(m);
  const wins = meta.modeWins[m.id] ?? 0;
  const best = meta.modeBest[m.id] ?? 0;
  const card = document.createElement("div");
  card.className = `level modeCard${open ? "" : " closed"}${m.id === "hardcore" ? " hcCard" : ""}`;
  card.style.setProperty("--accent", m.color);
  const head = document.createElement("div");
  head.className = "levelHead";
  const name = document.createElement("b");
  name.textContent = m.name;
  const st = document.createElement("span");
  st.className = "modeStatus";
  st.textContent = wins ? `Vinta ${wins === 1 ? "" : `${wins} volte`}`.trim() : best ? `Record: ondata ${best}/${m.waves}` : `${m.waves} ondate`;
  head.append(name, st);
  const sub = document.createElement("small");
  sub.textContent = open ? m.sub : `Si apre vincendo ${modeName(m.unlock!)}`;
  const row = document.createElement("div");
  row.className = "mapRow";
  for (const l of SURVIVAL_MAPS.map((id) => levelById(id))) {
    const b = document.createElement("button");
    b.className = "mapPick";
    b.textContent = l.name.replace(/^La |^Il |^Lo /, "");
    b.setAttribute("aria-pressed", String(meta.mapPick === l.id));
    b.disabled = !open;
    b.addEventListener("click", () => {
      meta.mapPick = l.id;
      saveMeta();
      renderMenu();
    });
    row.append(b);
  }
  const play = document.createElement("button");
  play.className = "mode";
  play.dataset.survival = m.id;
  play.textContent = "Gioca";
  play.disabled = !open;
  play.addEventListener("click", () => {
    wakeAudio();
    newMatch(m.id, meta.mapPick);
  });
  row.append(play);
  card.append(head, sub, row);
  host.append(card);
}

function renderModes() {
  const host = $("modes");
  host.innerHTML = "";
  for (const m of SURVIVAL) modeCard(m, host);
  modeCard(HARDCORE, host);
}

function renderNights() {
  const d = disgelo();
  setText($("disgelo"), `${d.label} · forza ${Math.round(d.bp / 100)}%${d.next ? ` · prossimo disgelo ${d.next}` : ""}`);
  const host = $("nights");
  host.innerHTML = "";
  for (const n of NIGHTS) {
    const open = nightOpen(n.night);
    const k = String(n.night);
    const wins = meta.nightWins[k] ?? 0;
    const best = meta.nightBest[k] ?? 0;
    const card = document.createElement("div");
    card.className = `level night${open ? "" : " closed"}${n.night === 5 ? " finale" : ""}`;
    const head = document.createElement("div");
    head.className = "levelHead";
    const name = document.createElement("b");
    name.textContent = n.name;
    const st = document.createElement("span");
    st.className = "modeStatus";
    st.textContent = wins ? "Vinta" : best ? `Record ${best}/${n.waves}` : `${n.waves} ondate`;
    head.append(name, st);
    const sub = document.createElement("small");
    sub.textContent = open ? `${n.sub} ${levelById(n.map).name}, 10 vite.` : `Si apre vincendo la Notte ${n.night - 1}`;
    const play = document.createElement("button");
    play.className = "mode";
    play.dataset.night = k;
    play.textContent = "Gioca";
    play.disabled = !open;
    play.addEventListener("click", () => {
      wakeAudio();
      playNight(n.night);
    });
    card.append(head, sub, play);
    host.append(card);
  }
}

// ---------- online ----------

let reachable: boolean | null = null;
let leaderboard: import("./net").LeaderRow[] | null = null;
let hostTimer = 0;
let lastAdminCmd = 0;

const onlineApi = {
  get net() {
    return net;
  },
  get reachable() {
    return reachable;
  },
  get cloudNote() {
    return cloudNote;
  },
  get leaderboard() {
    return leaderboard;
  },
  get mapPick() {
    return meta.mapPick;
  },
  toast: (t: string) => toast(t),
  rerender: () => renderMenu(),
  afterLogin: () => syncAfterLogin(),
  afterLogout: () => {
    applyAll();
    $("adminPanel").hidden = true;
  },
  createRoom: (mode: GameMode, level: string, night: number) => createRoom(mode, level, night),
  joinRoom: (code: string, local: boolean) => joinRoom(code, local),
  async loadLeaderboard() {
    try {
      leaderboard = await net.leaderboard(20);
    } catch (e) {
      toast((e as Error).message);
    }
    renderOnlineSection();
  },
};

function renderOnlineSection() {
  const host = document.getElementById("online");
  if (host) renderOnline(host, onlineApi);
}

async function checkServer() {
  reachable = await net.ping();
  if (reachable) {
    try {
      await loadPublished();
      if (inMenu) renderNews();
    } catch {
      /* resta la copia salvata sul dispositivo */
    }
  }
  if (net.session && reachable) {
    // All'avvio si ricarica il ruolo dal server: senza conferma il pannello admin resta chiuso.
    try {
      await net.refreshProfile();
    } catch {
      /* server non raggiunto: niente pannello admin */
    }
    applyAll();
    if (inMenu) renderMenu();
    if (meta.account !== net.session.userId) await syncAfterLogin();
    else await claimGrants();
  }
  if (inMenu) renderOnlineSection();
}

function me(): Player {
  return { id: net.session?.userId ?? `ospite-${newSeed() >>> 0}`, name: net.session?.username ?? "ospite", loadout: [...meta.loadout], ranks: { ...meta.ranks }, seen: Date.now() };
}

function transportFor(code: string, local: boolean): Transport {
  return local ? new LocalTransport(code) : new RealtimeTransport(net, code);
}

function wireMatch(m: NetMatch) {
  m.balance = () => effectiveBalance();
  m.onBalance = (b) => {
    // Messaggi in ritardo di una stanza già lasciata non devono cambiare i valori.
    if (!b || match !== m) return;
    matchBalance = cleanBalance(b);
    applyAll();
  };
  m.onLobby = () => {
    if (!$("lobby").hidden) renderLobby($("lobbyBody"), m, lobbyApi);
  };
  m.onStart = (st) => {
    if (match !== m) return;
    $("lobby").hidden = true;
    beginState(st);
    toast(m.isHost ? "Partita avviata" : "Partita iniziata");
  };
  m.onNote = (t) => toast(t);
  m.onClosed = (why) => {
    toast(why);
    leaveMatch();
    showMenu();
  };
}

const lobbyApi = {
  async start() {
    if (!match || !match.isHost) return;
    const m = match;
    // Le torri admin entrano in partita solo per chi il server conferma come admin.
    m.adminIds.clear();
    if (net.session?.isAdmin) m.adminIds.add(m.me.id);
    const ask = [...m.players.values()].filter((p) => p.id !== m.me.id && p.loadout.some((k) => ADMIN_ONLY.includes(k))).map((p) => p.id);
    if (ask.length && net.session) {
      try {
        for (const id of await net.adminIds(ask)) m.adminIds.add(id);
      } catch {
        /* senza risposta del server le torri admin restano fuori */
      }
    }
    if (match !== m) return;
    const st = m.hostStart(newSeed());
    $("lobby").hidden = true;
    beginState(st);
    lastOpts = null;
    if (net.session && match.code.length === 5 && !(match as NetMatch & { local?: boolean }).local) net.updateRoom(match.code, { status: "playing" }).catch(() => {});
  },
  leave() {
    leaveMatch();
    showMenu();
  },
};

function showLobby() {
  if (!match) return;
  inMenu = true;
  $("menu").hidden = true;
  $("end").hidden = true;
  $("lobby").hidden = false;
  renderLobby($("lobbyBody"), match, lobbyApi);
}

async function createRoom(mode: GameMode, level: string, night: number) {
  if (!net.session) return toast("Serve l'accesso");
  leaveMatch();
  const code = roomCode();
  const lvl = mode === "natale" ? NIGHTS[night - 1].map : level;
  const setup: Setup = { mode, level: lvl, night, eventBp: mode === "natale" ? disgelo().bp : 10000 };
  try {
    await net.createRoom(code, mode, lvl, night);
  } catch (e) {
    toast((e as Error).message);
    return;
  }
  match = new NetMatch("host", code, me(), transportFor(code, false), setup);
  wireMatch(match);
  lastAdminCmd = await net.lastCommandId(code).catch(() => 0);
  startHostTimers(match, false);
  showLobby();
}

async function joinRoom(code: string, local: boolean) {
  if (!/^[A-Z0-9]{3,5}$/.test(code)) return toast("Codice stanza non valido");
  leaveMatch();
  if (local) {
    // Prova senza server: chi entra per primo ospita.
    const probe = new BroadcastChannel(`faro-probe-${code}`);
    let hostSeen = false;
    probe.onmessage = (ev) => {
      if (ev.data === "host") hostSeen = true;
    };
    probe.postMessage("who");
    await new Promise((r) => setTimeout(r, 400));
    const role = hostSeen ? "guest" : "host";
    if (role === "host") probe.onmessage = (ev) => ev.data === "who" && probe.postMessage("host");
    else probe.close();
    match = new NetMatch(role, code, me(), transportFor(code, true), { mode: "easy", level: meta.mapPick, night: 0, eventBp: 10000 });
    (match as NetMatch & { local?: boolean; probe?: BroadcastChannel }).local = true;
    if (role === "host") (match as NetMatch & { probe?: BroadcastChannel }).probe = probe;
    wireMatch(match);
    showLobby();
    return;
  }
  if (!net.session) return toast("Serve l'accesso");
  let row;
  try {
    row = await net.room(code);
  } catch (e) {
    toast((e as Error).message);
    return;
  }
  if (!row || row.status === "ended") return toast("Stanza non trovata");
  if (row.host === net.session.userId) return toast("Questa stanza è tua: creane una nuova");
  // Modalità e mappa si leggono subito dalla stanza; il resto arriva da chi ospita.
  const setup: Setup = { mode: row.mode as GameMode, level: row.level, night: row.night, eventBp: 10000 };
  match = new NetMatch("guest", code, me(), transportFor(code, false), setup);
  wireMatch(match);
  showLobby();
}

function startHostTimers(m: NetMatch, local: boolean) {
  clearInterval(hostTimer);
  if (local) return;
  let beat = 0;
  hostTimer = window.setInterval(async () => {
    if (match !== m) return;
    // Comandi dell'admin arrivati dal database: entrano nel prossimo tick per tutti.
    if (m.status === "playing") {
      try {
        const rows = await net.commandsAfter(m.code, lastAdminCmd);
        for (const r of rows) {
          lastAdminCmd = Math.max(lastAdminCmd, r.id);
          const c = r.cmd as Command;
          if (c && typeof c.t === "string" && c.t.startsWith("admin")) {
            m.hostSubmit(c);
            toast("L'admin è intervenuto nella partita");
          }
        }
      } catch {
        /* si riprova al prossimo giro */
      }
    }
    if (beat++ % 3 === 0) {
      const st = m.state;
      const info = {
        players: m.order.length ? m.order.map((id, i) => m.players.get(id)?.name ?? `giocatore ${i + 1}`) : [...m.players.values()].map((p) => p.name),
        wave: st?.wave ?? 0,
        waves: st ? waveCount(st) : 0,
        lives: st?.lives ?? 0,
        cash: st?.cash ?? 0,
        phase: st?.phase ?? "lobby",
        tick: st?.tick ?? 0,
      };
      net.updateRoom(m.code, { status: m.status, info }).catch(() => {});
    }
  }, 2000);
}

function leaveMatch() {
  if (!match) return;
  const m = match;
  match = null;
  clearInterval(hostTimer);
  m.leave();
  (m as NetMatch & { probe?: BroadcastChannel }).probe?.close();
  if (m.isHost && net.session && !(m as NetMatch & { local?: boolean }).local) net.updateRoom(m.code, { status: "ended" }).catch(() => {});
  $("lobby").hidden = true;
  if (matchBalance) {
    matchBalance = null;
    applyAll();
  }
}

// ---------- accesso admin ----------

// Il pannello admin si apre solo con un account che il server conferma come admin in questa sessione
// del gioco: non basta un'impostazione salvata sul dispositivo, né una password scritta nel codice.
function isAdmin(): boolean {
  return net.verified && !!net.session?.isAdmin;
}

function renderMissions() {
  const host = $("missions");
  host.innerHTML = "";
  meta.missions.forEach((m, i) => {
    const def = MISSIONS[m.pool];
    const prog = Math.min(missionProgress(m, meta.totals), missionTarget(m));
    const done = prog >= missionTarget(m);
    const row = document.createElement("div");
    row.className = `mission${done ? " done" : ""}`;
    const text = document.createElement("div");
    text.className = "rowText";
    const b = document.createElement("b");
    b.textContent = missionText(m);
    const small = document.createElement("small");
    small.textContent = `${fmt(Math.max(0, prog))} / ${fmt(missionTarget(m))} · premio ${def.schegge} Schegge${def.perle ? ` e ${def.perle} Perle` : ""}`;
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.style.setProperty("--p", String(Math.max(0, prog) / missionTarget(m)));
    text.append(b, small, bar);
    const btn = document.createElement("button");
    btn.textContent = done ? "Riscuoti" : "In corso";
    btn.disabled = !done;
    btn.dataset.claim = String(i);
    btn.addEventListener("click", () => {
      meta.schegge += def.schegge;
      meta.perle += def.perle ?? 0;
      meta.missions[i] = newSlot(meta.missionNext++, meta.totals);
      saveMeta();
      sfx.coin();
      renderMenu();
    });
    row.append(text, btn);
    host.append(row);
  });
}

function renderMedals() {
  const host = $("medals");
  host.innerHTML = "";
  for (const m of MEDALS) {
    const got = meta.medals.includes(m.id);
    const d = document.createElement("div");
    d.className = `medal${got ? " got" : ""}`;
    d.title = m.text;
    const b = document.createElement("b");
    b.textContent = m.name;
    const small = document.createElement("small");
    small.textContent = m.text;
    d.append(b, small);
    host.append(d);
  }
  setText($("medalCount"), `${meta.medals.length}/${MEDALS.length}`);
}

function renderNews() {
  const all = news();
  const unread = Math.max(0, all.length - meta.newsSeen);
  setText($("newsBadge"), unread ? String(unread) : "");
  $("newsBadge").hidden = !unread;
  const host = $("news");
  host.innerHTML = "";
  for (const entry of all.slice(0, 12)) {
    const item = document.createElement("article");
    item.className = `newsItem ${entry.kind}`;
    const h = document.createElement("b");
    h.textContent = entry.title;
    const date = document.createElement("small");
    date.textContent = `${entry.date} · ${entry.kind === "versione" ? "Aggiornamento" : "Bilanciamento"}`;
    const ul = document.createElement("ul");
    for (const it of entry.items) {
      const li = document.createElement("li");
      li.textContent = it;
      ul.append(li);
    }
    item.append(h, date, ul);
    host.append(item);
  }
}

function toggleSquad(kind: TowerKind) {
  const i = meta.loadout.indexOf(kind);
  if (i >= 0) {
    if (meta.loadout.length > 1) meta.loadout.splice(i, 1);
  } else if (meta.loadout.length < LOADOUT_SIZE) meta.loadout.push(kind);
  saveMeta();
  renderMenu();
}

function buyFromArsenal(kind: TowerKind) {
  wakeAudio();
  const owned = meta.unlocked.includes(kind);
  if (!owned && TOWERS[kind].exclusive) return;
  const pearls = !owned && !!TOWERS[kind].perle;
  const price = owned ? RANK_COSTS[meta.ranks[kind]] : pearls ? TOWERS[kind].perle! : TOWERS[kind].unlock;
  const wallet = pearls ? meta.perle : meta.schegge;
  if (!price || wallet < price || (owned && meta.ranks[kind] >= MAX_RANK)) return;
  if (pearls) meta.perle -= price;
  else meta.schegge -= price;
  if (owned) meta.ranks[kind] += 1;
  else {
    meta.unlocked.push(kind);
    if (meta.loadout.length < LOADOUT_SIZE) meta.loadout.push(kind);
  }
  saveMeta();
  sfx.coin();
  renderMenu();
}

// ---------- pannello admin locale ----------

function logChange(title: string, items: string[]) {
  meta.changes.push({ date: today(), title, items, kind: "bilanciamento" });
  meta.changes = meta.changes.slice(-50);
}

const adminApi: AdminApi = {
  state: () => state,
  send: (cmd) => send(cmd),
  toast: (t) => toast(t),
  startSandbox(level, mode, night, eventBp) {
    if (!isAdmin()) return;
    $("adminPanel").hidden = true;
    newMatch(mode, level, newSeed(), { mode, level, sandbox: true, ranks: meta.ranks, night, eventBp });
    toast("Partita di prova: tutte le torri, nessun premio");
  },
  setSpeed(n) {
    speed = n;
  },
  dps(on) {
    if (on !== undefined) dpsOn = on;
    return dpsOn;
  },
  progress: {
    schegge: () => adminMeta(() => (meta.schegge += 1000), "+1.000 Schegge"),
    perle: () => adminMeta(() => (meta.perle += 100), "+100 Perle Nere"),
    xp: () => adminMeta(() => (meta.xp += 1000), "+1.000 XP"),
    unlockAll: () => adminMeta(() => (meta.unlocked = [...TOWER_ORDER]), "Tutte le torri sbloccate"),
    ranks5: () => adminMeta(() => TOWER_ORDER.forEach((k) => (meta.ranks[k] = MAX_RANK)), "Ranghi al massimo"),
    ranks1: () => adminMeta(() => TOWER_ORDER.forEach((k) => (meta.ranks[k] = 1)), "Ranghi a 1"),
    levels: () =>
      adminMeta(() => {
        LEVELS.forEach((l) => (meta.wins[l.id] = Math.max(1, meta.wins[l.id] ?? 0)));
        SURVIVAL.forEach((m) => (meta.modeWins[m.id] = Math.max(1, meta.modeWins[m.id] ?? 0)));
        NIGHTS.slice(0, 4).forEach((n) => (meta.nightWins[String(n.night)] = Math.max(1, meta.nightWins[String(n.night)] ?? 0)));
      }, "Livelli, modalità e Notti aperti"),
    missions: () => adminMeta(() => meta.missions.forEach((m) => {
      const def = MISSIONS[m.pool];
      if (def.best) meta.totals[def.key] = Math.max(meta.totals[def.key], missionTarget(m));
      else m.base = meta.totals[def.key] - missionTarget(m);
    }), "Missioni completate"),
    reset: () => {
      if (!isAdmin()) return;
      const keepDraft = meta.draft;
      const keepChanges = meta.changes;
      meta = freshMeta();
      meta.draft = keepDraft;
      meta.changes = keepChanges;
      meta.introSeen = true;
      saveMeta();
      toast("Progressi azzerati");
      renderMenu();
      openAdmin();
    },
  },
  players() {
    if (!match || match.state !== state) return [];
    return match.order.map((id, i) => match!.players.get(id)?.name ?? `giocatore ${i + 1}`);
  },
  get online() {
    if (!net.session?.isAdmin) return undefined;
    return {
      rooms: () => net.activeRooms(),
      command: (code: string, cmd: Command) => net.adminCommand(code, cmd),
    };
  },
  get grants() {
    if (!net.session?.isAdmin) return undefined;
    return {
      peek: (u: string) => net.adminPeek(u),
      grant: (id: string, payload: GrantPayload, note: string) => net.adminGrant(id, payload, note),
    };
  },
  balance: {
    draft: () => meta.draft,
    published: () => published,
    publishedNote: () =>
      publishedRev
        ? `Versione ${publishedRev}, del ${new Date(publishedAt).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${publishedFresh ? "" : " (copia salvata: server non raggiunto)"}.`
        : publishedFresh
          ? "Valori originali: niente di pubblicato."
          : "Server non raggiunto: valgono i valori originali o l'ultima copia salvata.",
    canPublish: () => !!net.session?.isAdmin,
    setDraft(kind: BalanceKind, entry: BalanceEntry) {
      if (!isAdmin()) return;
      const key = (o: BalanceEntry) => JSON.stringify({ ...o, value: 0 });
      const rest = (meta.draft[kind] as BalanceEntry[]).filter((o) => key(o) !== key(entry));
      // Una prova uguale al valore pubblicato (o all'originale, se non c'è nulla di pubblicato) non serve.
      const pub = (published[kind] as BalanceEntry[]).find((o) => key(o) === key(entry));
      const redundant = pub ? pub.value === entry.value : !(pruneBalance({ ...emptyBalance(), [kind]: [entry] })[kind] as BalanceEntry[]).length;
      (meta.draft[kind] as BalanceEntry[]) = redundant ? rest : [...rest, entry];
      if (!net.session?.isAdmin) logChange("Bilanciamento di prova", [describeEntry(kind, entry)]);
      applyAll();
      saveMeta();
      toast(net.session?.isAdmin ? "Prova applicata su questo dispositivo" : "Modifica applicata e registrata nella bacheca");
    },
    clearDraft() {
      if (!isAdmin()) return;
      if (!balanceSize(meta.draft)) return;
      if (!net.session?.isAdmin) logChange("Valori originali ripristinati", [...meta.draft.towers.map((o) => describeEntry("towers", o)), ...meta.draft.modes.map((o) => describeEntry("modes", o)), ...meta.draft.maps.map((o) => describeEntry("maps", o))]);
      meta.draft = emptyBalance();
      applyAll();
      saveMeta();
      toast("Prove annullate");
    },
    async publish(title: string) {
      if (!net.session?.isAdmin) throw new Error("Serve l'account admin");
      if (!balanceSize(meta.draft)) return;
      // Si riparte dall'ultima versione sul server, per non cancellare le modifiche di un altro admin.
      await loadPublished(false);
      const items = [...meta.draft.towers.map((o) => describeEntry("towers", o)), ...meta.draft.modes.map((o) => describeEntry("modes", o)), ...meta.draft.maps.map((o) => describeEntry("maps", o))];
      const next = pruneBalance(mergeBalance(published, meta.draft));
      await publishBalance(next, title || "Bilanciamento aggiornato", items);
      meta.draft = emptyBalance();
      saveMeta();
      applyAll();
    },
    async unpublish(kind: BalanceKind, entry: BalanceEntry) {
      if (!net.session?.isAdmin) throw new Error("Serve l'account admin");
      await loadPublished(false);
      const key = (o: BalanceEntry) => JSON.stringify({ ...o, value: 0 });
      const next: Balance = { ...published, [kind]: (published[kind] as BalanceEntry[]).filter((o) => key(o) !== key(entry)) };
      const item = describeEntry(kind, entry).replace(/: (.*) → .*$/, ": torna a $1");
      await publishBalance(next, "Valore riportato all'originale", [item]);
    },
    async resetPublished() {
      if (!net.session?.isAdmin) throw new Error("Serve l'account admin");
      await loadPublished(false);
      if (!balanceSize(published)) return;
      await publishBalance(emptyBalance(), "Bilanciamento riportato ai valori originali", [`${balanceSize(published)} modifiche tolte`]);
    },
    async reload() {
      await loadPublished();
      renderNews();
    },
  },
};

async function publishBalance(next: Balance, title: string, items: string[]) {
  publishedRev = await net.saveBalance(next, publishedRev);
  published = next;
  publishedAt = new Date().toISOString();
  cachePublished();
  applyAll();
  await net.logBalance(title, items).catch(() => {});
  await loadPublished().catch(() => {});
  renderNews();
}

function adminMeta(change: () => void, msg: string) {
  if (!isAdmin()) return;
  change();
  if (meta.loadout.length < LOADOUT_SIZE) for (const k of meta.unlocked) if (!meta.loadout.includes(k) && meta.loadout.length < LOADOUT_SIZE) meta.loadout.push(k);
  saveMeta();
  toast(msg);
  renderMenu();
}

function openAdmin() {
  if (!isAdmin()) return;
  $("adminPanel").hidden = false;
  renderAdminPanel($("adminBody"), adminApi, closeAdmin);
}

function closeAdmin() {
  $("adminPanel").hidden = true;
  renderMenu();
}

// ---------- tocchi sulla carta ----------

function pointerCell(ev: PointerEvent, lift: boolean): { cx: number; cy: number } {
  const r = canvas.getBoundingClientRect();
  // Trascinando col dito la torre appare sopra il polpastrello, così resta visibile.
  const lx = ev.clientX - r.left;
  const ly = ev.clientY - r.top - (lift && ev.pointerType === "touch" ? T * 0.9 : 0);
  const mx = rot ? ly : lx;
  const my = rot ? MAP_H * T - lx : ly;
  return { cx: Math.floor(mx / T), cy: Math.floor(my / T) };
}

function pointerUnits(ev: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const lx = ev.clientX - r.left;
  const ly = ev.clientY - r.top;
  const mx = rot ? ly : lx;
  const my = rot ? MAP_H * T - lx : ly;
  return { x: Math.round((mx / T) * TILE), y: Math.round((my / T) * TILE) };
}

/** Il nemico sotto il puntatore, con un margine comodo per le dita. */
function enemyAtClient(ev: PointerEvent): number | null {
  const r = canvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * dpr;
  const py = (ev.clientY - r.top) * dpr;
  const touch = ev.pointerType !== "mouse";
  let best: number | null = null;
  let bd = Infinity;
  for (const e of state.enemies) {
    const p = drawnAt.get(e.id);
    if (!p) continue;
    const rad = (enemySize(e) + (touch ? 0.35 : 0.15)) * T * dpr;
    const d = (p.x - px) ** 2 + (p.y - py) ** 2;
    if (d <= rad * rad && d < bd) {
      bd = d;
      best = e.id;
    }
  }
  return best;
}

function insideMap(ev: PointerEvent): boolean {
  const r = canvas.getBoundingClientRect();
  return ev.clientX >= r.left && ev.clientX < r.right && ev.clientY >= r.top && ev.clientY < r.bottom;
}

function tryPlace() {
  if (!placing || !ghost) return;
  if (!isBuildable(state, ghost.cx, ghost.cy)) {
    toast("Qui non si può costruire");
    sfx.deny();
    ghost = null;
    return;
  }
  send({ t: "build", kind: placing, cx: ghost.cx, cy: ghost.cy });
  setPlacing(null);
}

function bindPointer() {
  canvas.addEventListener("pointerdown", (ev) => {
    wakeAudio();
    if (dialogQueue.length || isOver()) return;
    ev.preventDefault();
    if (aiming) {
      const p = pointerUnits(ev);
      send({ t: "ability", id: "fascio", x: p.x, y: p.y });
      setAiming(false);
      return;
    }
    if (placing) {
      ghost = pointerCell(ev, false);
      return;
    }
    const eid = enemyAtClient(ev);
    if (eid !== null) {
      inspectId = eid;
      selectTower(null);
      return;
    }
    inspectId = null;
    const c = pointerCell(ev, false);
    const hit = state.towers.find((t) => t.cx === c.cx && t.cy === c.cy);
    selectTower(hit ? hit.id : null);
  });
  window.addEventListener("pointermove", (ev) => {
    if (aiming) aimPoint = insideMap(ev) ? pointerUnits(ev) : null;
    if (!placing && !aiming) {
      if (ev.pointerType === "mouse" && !ev.buttons) hoverId = insideMap(ev) ? enemyAtClient(ev) : null;
      // Con il dito premuto la scheda segue il nemico sotto il dito.
      else if (ev.buttons && inspectId !== null && insideMap(ev)) inspectId = enemyAtClient(ev) ?? inspectId;
    }
    if (!placing) return;
    if (dragFromCard) {
      if (insideMap(ev)) {
        dragMoved = true;
        ghost = pointerCell(ev, true);
      } else {
        ghost = null;
      }
    } else if (ev.buttons && insideMap(ev)) {
      ghost = pointerCell(ev, false);
    }
  });
  window.addEventListener("pointerup", (ev) => {
    if (!placing) return;
    if (dragFromCard) {
      dragFromCard = false;
      // Un semplice tocco sulla carta lascia la torre scelta: il prossimo tocco sulla mappa costruisce.
      if (dragMoved && insideMap(ev)) tryPlace();
      else if (dragMoved) setPlacing(null);
      return;
    }
    if (insideMap(ev) && ghost) tryPlace();
  });
  window.addEventListener("pointercancel", () => {
    if (dragFromCard) setPlacing(null);
  });
}

function bindButtons() {
  $("go").addEventListener("click", () => {
    wakeAudio();
    send({ t: "skip" });
  });
  $("pause").addEventListener("click", () => {
    wakeAudio();
    if (isOver()) return;
    if (match && !match.isHost) {
      toast("Pausa e velocità le decide chi ospita");
      return;
    }
    paused = !paused;
    $("pauseLayer").hidden = !paused;
    if (paused) setText($("quit"), `Esci e incassa ${rewardFor(state)} Schegge`);
  });
  $("resume").addEventListener("click", () => {
    paused = false;
    $("pauseLayer").hidden = true;
  });
  $("quit").addEventListener("click", () => {
    award();
    leaveMatch();
    showMenu();
  });
  $("abFascio").addEventListener("click", () => {
    wakeAudio();
    const fcd = abilityCdOf(state, myP).fascio;
    if (fcd > 0) {
      toast(`Fascio pronto tra ${Math.ceil(fcd / TICKS_PER_SECOND)} s`);
      return;
    }
    setPlacing(null);
    selectTower(null);
    setAiming(!aiming);
    if (aiming) toast("Tocca il punto da colpire");
  });
  $("abGelata").addEventListener("click", () => {
    wakeAudio();
    send({ t: "ability", id: "gelata" });
  });
  $("toMenu").addEventListener("click", () => {
    leaveMatch();
    showMenu();
  });
  $("speed").addEventListener("click", () => {
    wakeAudio();
    if (match && !match.isHost) {
      toast("Pausa e velocità le decide chi ospita");
      return;
    }
    speed = speed === 1 ? 2 : 1;
  });
  $("sound").addEventListener("click", () => {
    soundOn = !soundOn;
    store.set("faro.audio", soundOn ? "on" : "off");
    wakeAudio();
  });
  $("btnUp").addEventListener("click", () => {
    if (selectedId !== null) send({ t: "upgrade", id: selectedId });
  });
  $("btnA").addEventListener("click", () => {
    if (selectedId !== null) send({ t: "spec", id: selectedId, branch: "A" });
  });
  $("btnB").addEventListener("click", () => {
    if (selectedId !== null) send({ t: "spec", id: selectedId, branch: "B" });
  });
  $("btnSell").addEventListener("click", () => {
    if (selectedId !== null) {
      send({ t: "sell", id: selectedId });
      selectTower(null);
    }
  });
  $("btnClose").addEventListener("click", () => selectTower(null));
  $("again").addEventListener("click", restart);
  $("dialog").addEventListener("click", () => {
    wakeAudio();
    dialogQueue.shift();
    showLine();
  });
  $("btnApex").addEventListener("click", () => {
    if (selectedId !== null) send({ t: "apex", id: selectedId });
  });
  $("adminOpen").addEventListener("click", openAdmin);
  $("gfxToggle").addEventListener("click", () => {
    gfx = gfx === "alta" ? "leggera" : "alta";
    try {
      localStorage.setItem("faro.gfx", gfx);
    } catch {
      /* resta per questa sessione */
    }
    bgKey = "";
    layout();
    toast(gfx === "leggera" ? "Grafica leggera: meno pixel e animazioni, consuma molto meno" : "Grafica alta");
    renderMenu();
  });
  $("adminBtn").addEventListener("click", () => {
    const d = $("adminDrawer");
    d.hidden = !d.hidden;
    if (!d.hidden) renderAdminDrawer(d, adminApi);
  });
  $("newsToggle").addEventListener("click", () => {
    const n = $("news");
    n.hidden = !n.hidden;
    meta.newsSeen = news().length;
    saveMeta();
    renderNews();
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      setPlacing(null);
      selectTower(null);
      setAiming(false);
    }
  });
  window.addEventListener("hashchange", () => {
    if (inMenu) renderMenu();
  });
}

// ---------- disegno ----------

function render(now: number) {
  const pxT = T * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (background) ctx.drawImage(background, 0, 0);
  const alpha = paused || dialogQueue.length || isOver() ? 1 : Math.min(1, accumulator / 100);
  applyMap(ctx, rot, pxT);
  const level = levelOf(state);
  drawTide(ctx, pxT, now, reducedMotion || light(), level.map, level.map.lanes.map((_, i) => laneIsOpen(state, i) || (state.phase === "prep" && state.wave + 1 >= (level.map.laneOpen[i] ?? 1))));
  for (const e of level.map.emerge) for (const [cx, cy] of e.cells) drawShoal(ctx, pxT, cx, cy, cellEmerged(state, cx, cy), reducedMotion ? 0 : now);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (placing) {
    ctx.save();
    ctx.strokeStyle = "rgba(238,228,203,.2)";
    ctx.lineWidth = 1;
    for (let cy = 0; cy < MAP_H; cy++) {
      for (let cx = 0; cx < MAP_W; cx++) {
        if (!isBuildable(state, cx, cy)) continue;
        const r = cellRect(cx, cy);
        ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      }
    }
    ctx.restore();
  }

  const selected = selectedId === null ? null : state.towers.find((t) => t.id === selectedId);
  if (selected) {
    const p = S(selected.x, selected.y);
    rangeRing(p.x, p.y, toPx(effStats(state, selected).range, pxT), TOWERS[selected.kind].family === "supporto" ? "#7fd8a0" : COLORS.brass);
  }

  for (const t of state.towers) {
    const p = S(t.x, t.y);
    const s = statsIn(state, t);
    if (s.slowBp < 10000) {
      // Aura visibile: il giocatore vede dove arriva il freddo.
      ctx.save();
      ctx.fillStyle = "rgba(165,228,236,.05)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, toPx(s.range, pxT), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const angle = aim.has(t.id) ? aim.get(t.id)! + turn() : -0.6;
    drawTowerShape(ctx, t.kind, p.x, p.y, pxT, angle, t.level, t.branch, reducedMotion ? 0 : now, t.track);
    towerStatus(t, p.x, p.y, pxT, now);
    if (t.id === selectedId) {
      const r = cellRect(t.cx, t.cy);
      ctx.save();
      ctx.strokeStyle = COLORS.brass;
      ctx.lineWidth = Math.max(1.5, pxT * 0.04);
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.restore();
    }
  }

  for (const e of state.enemies) {
    const prev = prevPos.get(e.id);
    const ux = prev ? prev.x + (e.x - prev.x) * alpha : e.x;
    const uy = prev ? prev.y + (e.y - prev.y) * alpha : e.y;
    const lane = e.boss ? 0 : e.offset;
    const p = S(ux + lane * 0.5, uy + lane);
    drawEnemy(ctx, e, p.x, p.y, pxT, now, reducedMotion);
    if (e.mods || e.shield || e.mark || e.bounty) enemyMarks(e, p.x, p.y, pxT, now);
    drawnAt.set(e.id, p);
  }
  for (const u of state.units) drawUnit(u, pxT, now);

  const faro = S(level.map.faro[0] * TILE + TILE / 2, level.map.faro[1] * TILE + TILE / 2);
  drawFaro(ctx, pxT, now, state.lives, reducedMotion, faro.x, faro.y);

  // Colpi di mortaio in volo: un arco tra torre e punto d'impatto.
  for (const s of state.shells) {
    const span = s.land - s.fired;
    const prog = Math.min(1, (state.tick - s.fired + alpha) / span);
    const p = S(s.fromX + (s.x - s.fromX) * prog, s.fromY + (s.y - s.fromY) * prog);
    const y = p.y - Math.sin(prog * Math.PI) * pxT * 0.9;
    ctx.save();
    ctx.fillStyle = "#14191b";
    ctx.strokeStyle = COLORS.cream;
    ctx.lineWidth = Math.max(1, pxT * 0.025);
    ctx.beginPath();
    ctx.arc(p.x, y, pxT * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  const clock = performance.now();
  fx = fx.filter((f) => clock - f.born < f.life);
  for (const f of fx) {
    const k = (clock - f.born) / f.life;
    const p = S(f.x, f.y);
    ctx.save();
    if (f.kind === "zap") {
      const pts = f.pts!;
      ctx.strokeStyle = f.color ?? "#e9e2ff";
      // L'alone dei fulmini è l'effetto più costoso: in grafica leggera si toglie.
      if (!light()) {
        ctx.shadowColor = "#a48cff";
        ctx.shadowBlur = pxT * 0.25;
      }
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = Math.max(1.5, pxT * 0.05);
      ctx.beginPath();
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const q = S(pts[i], pts[i + 1]);
        if (i === 0) {
          ctx.moveTo(q.x, q.y);
          continue;
        }
        // Piccoli zig-zag tra un bersaglio e il successivo.
        const prev = S(pts[i - 2], pts[i - 1]);
        const mx = (prev.x + q.x) / 2 + ((i * 37) % 7 - 3) * pxT * 0.05;
        const my = (prev.y + q.y) / 2 + ((i * 53) % 7 - 3) * pxT * 0.05;
        ctx.lineTo(mx, my);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
    } else if (f.kind === "ring") {
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = f.color!;
      ctx.lineWidth = Math.max(2, pxT * 0.08 * (1 - k));
      ctx.beginPath();
      ctx.arc(p.x, p.y, toPx(f.r!, pxT) * (0.3 + 0.7 * k), 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.kind === "beam") {
      const r = toPx(f.r!, pxT);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 1 - k;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, "rgba(255,226,150,.9)");
      grad.addColorStop(1, "rgba(255,226,150,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (0.7 + 0.3 * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,236,180,.55)";
      ctx.fillRect(p.x - pxT * 0.18 * (1 - k), 0, pxT * 0.36 * (1 - k), p.y);
    } else if (f.kind === "tracer") {
      const q = S(f.x2!, f.y2!);
      ctx.strokeStyle = COLORS.cream;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = Math.max(1, pxT * 0.035);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    } else if (f.kind === "blast") {
      const r = toPx(f.r!, pxT) * (0.45 + 0.55 * k);
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = "#ffcf85";
      ctx.lineWidth = Math.max(2, pxT * 0.09 * (1 - k));
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(226,113,79,.2)";
      ctx.fill();
    } else {
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = f.color!;
      ctx.font = `700 ${Math.round(pxT * 0.34)}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(f.text!, p.x, p.y - pxT * (0.3 + k * 0.5));
    }
    ctx.restore();
  }

  if (placing && ghost) {
    const ok = isBuildable(state, ghost.cx, ghost.cy);
    const r = cellRect(ghost.cx, ghost.cy);
    const x = r.x + r.w / 2;
    const y = r.y + r.h / 2;
    rangeRing(x, y, toPx(TOWERS[placing].levels[0].range, pxT), ok ? COLORS.brass : COLORS.coral);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = ok ? "rgba(224,179,84,.25)" : "rgba(226,113,79,.35)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    drawTowerShape(ctx, placing, x, y, pxT, -0.6);
    ctx.restore();
  }

  if (state.towers.length === 0 && !placing && state.phase === "prep" && !dialogQueue.length) {
    const p = rot ? S(5500, 4500) : S(9000, 7900);
    ctx.save();
    ctx.font = `italic ${Math.round(pxT * 0.42)}px "IM Fell English", Georgia, serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.cream;
    ctx.shadowColor = "#000";
    ctx.shadowBlur = pxT * 0.2;
    ctx.fillText("Trascina una torre sulla riva", p.x, p.y);
    ctx.restore();
  }

  if (aiming) {
    ctx.save();
    ctx.fillStyle = "rgba(255,226,150,.06)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (aimPoint) {
      const p = S(aimPoint.x, aimPoint.y);
      rangeRing(p.x, p.y, toPx(ABILITIES.fascio.radius as number, pxT), "#ffe296");
    }
  }

  drawInspect();
  if (state.mode === "natale" && !reducedMotion && !light()) {
    // Neve che cade sulle Notti di Natale.
    ctx.fillStyle = "rgba(245,250,255,.7)";
    const W = canvas.width;
    const H = canvas.height;
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 137.5 + now * (0.012 + (i % 5) * 0.004)) % (W + 20)) - 10;
      const sy = ((i * 89.3 + now * (0.03 + (i % 7) * 0.006)) % (H + 20)) - 10;
      ctx.beginPath();
      ctx.arc(sx + Math.sin(now * 0.001 + i) * 6 * dpr, sy, (1 + (i % 3)) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (goldFlash > 0.01) {
    ctx.save();
    ctx.fillStyle = `rgba(224,179,84,${0.25 * goldFlash})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    goldFlash *= reducedMotion ? 0.5 : 0.93;
  }

  if (iceFlash > 0.01) {
    ctx.save();
    ctx.fillStyle = `rgba(165,228,236,${0.3 * iceFlash})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    iceFlash *= reducedMotion ? 0.5 : 0.94;
  }

  if (flash > 0.01) {
    ctx.save();
    ctx.fillStyle = `rgba(226,113,79,${0.28 * flash})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    flash *= 0.9;
  }
}

// Stato della torre: stordita, protetta, potenziata dal supporto.
function towerStatus(t: GameState["towers"][number], x: number, y: number, T: number, now: number) {
  ctx.save();
  // In multigiocatore un anello del colore del proprietario: le tue torri si riconoscono subito.
  if (state.others.length) {
    ctx.strokeStyle = OWNER_COLORS[(t.owner ?? 0) % 4];
    ctx.globalAlpha = t.owner === myP ? 0.95 : 0.55;
    ctx.lineWidth = Math.max(1.5, T * 0.045);
    ctx.beginPath();
    ctx.arc(x, y, T * 0.46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (t.stun > 0) {
    ctx.fillStyle = "rgba(20,14,40,.55)";
    ctx.beginPath();
    ctx.arc(x, y, T * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c9b8ff";
    ctx.lineWidth = Math.max(1, T * 0.04);
    const a = (now * 0.01) % (Math.PI * 2);
    ctx.beginPath();
    ctx.arc(x, y, T * 0.42, a, a + 1.2);
    ctx.arc(x, y, T * 0.42, a + Math.PI, a + Math.PI + 1.2);
    ctx.stroke();
  } else if (t.immune > 0) {
    ctx.strokeStyle = "rgba(127,216,160,.8)";
    ctx.lineWidth = Math.max(1, T * 0.03);
    ctx.setLineDash([T * 0.08, T * 0.06]);
    ctx.beginPath();
    ctx.arc(x, y, T * 0.46, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (t.level >= 5) {
    // Apex: anello d'ottone e tre punte di corona.
    ctx.strokeStyle = COLORS.brass;
    ctx.lineWidth = Math.max(2, T * 0.06);
    ctx.beginPath();
    ctx.arc(x, y, T * 0.47, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLORS.brass;
    ctx.beginPath();
    ctx.moveTo(x - T * 0.18, y - T * 0.42);
    ctx.lineTo(x - T * 0.12, y - T * 0.58);
    ctx.lineTo(x - T * 0.04, y - T * 0.46);
    ctx.lineTo(x, y - T * 0.62);
    ctx.lineTo(x + T * 0.04, y - T * 0.46);
    ctx.lineTo(x + T * 0.12, y - T * 0.58);
    ctx.lineTo(x + T * 0.18, y - T * 0.42);
    ctx.closePath();
    ctx.fill();
  }
  if (dpsOn && t.damageDone > 0) {
    ctx.font = `700 ${Math.round(T * 0.26)}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 4;
    ctx.fillText(`${Math.round(towerDps(t))}/s`, x, y + T * 0.68);
    ctx.shadowBlur = 0;
  }
  // Piccoli segni dei bonus attivi, in alto a destra.
  const marks: string[] = [];
  if (t.bufDamage) marks.push(COLORS.coral);
  if (t.bufRange) marks.push(COLORS.ice);
  if (t.bufHaste) marks.push(COLORS.brass);
  marks.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x + T * (0.28 + i * 0.12), y - T * 0.3);
    ctx.lineTo(x + T * (0.33 + i * 0.12), y - T * 0.4);
    ctx.lineTo(x + T * (0.38 + i * 0.12), y - T * 0.3);
    ctx.fill();
  });
  ctx.restore();
}

const UNIT_COLORS: Record<string, string> = { scagnozzo: "#e0b354", portavalori: "#9fd28b", buttafuori: "#e2714f", sicario: "#c9b8ff" };
const OWNER_COLORS = ["#e0b354", "#a5e4ec", "#9fd28b", "#c9b8ff"];

/** Scagnozzi del Kingpin: un omino col cappello, colore per ruolo, anello del proprietario. */
function drawUnit(u: GameState["units"][number], T: number, now: number) {
  const p = S(u.x, u.y);
  const r = T * (u.kind === "buttafuori" ? 0.2 : 0.16);
  const bob = reducedMotion ? 0 : Math.sin(now * 0.02 + u.id) * T * 0.015;
  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.9, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1b1f22";
  ctx.strokeStyle = OWNER_COLORS[u.owner % 4];
  ctx.lineWidth = Math.max(1, T * 0.025);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Cappello a falda.
  ctx.fillStyle = UNIT_COLORS[u.kind];
  ctx.fillRect(-r * 0.95, -r * 0.55, r * 1.9, r * 0.22);
  ctx.fillRect(-r * 0.55, -r * 1.05, r * 1.1, r * 0.55);
  if (u.kind === "portavalori") {
    ctx.fillStyle = "#e0b354";
    ctx.fillRect(r * 0.4, r * 0.1, r * 0.6, r * 0.45);
  }
  ctx.restore();
  if (u.hp < u.maxHp) {
    const w = T * 0.36;
    ctx.fillStyle = "rgba(0,0,0,.75)";
    ctx.fillRect(p.x - w / 2 - 1, p.y - r - T * 0.16 - 1, w + 2, Math.max(3, T * 0.05) + 2);
    ctx.fillStyle = "#a5e4ec";
    ctx.fillRect(p.x - w / 2, p.y - r - T * 0.16, (w * Math.max(0, u.hp)) / u.maxHp, Math.max(3, T * 0.05));
  }
}

function enemyTraits(e: GameState["enemies"][number]): string[] {
  const d = ENEMIES[e.kind];
  const out: string[] = [];
  if (d.hidden) out.push("Invisibile");
  if (d.slowImmune) out.push("Non si rallenta");
  if (d.regenBp) out.push("Si rigenera");
  if (d.summon) out.push(`Evoca ${ENEMIES[d.summon.kind].plural}`);
  if (d.song) out.push("Canto che stordisce");
  if (d.sabotage) out.push("Sabota le torri");
  if (d.split) out.push(`Si spezza in ${d.split.count}`);
  if (d.deathFreeze) out.push("Morendo congela le torri");
  if (d.steal) out.push("Ruba cash");
  if (d.charge) out.push("Scatta");
  if (d.phaseShieldBp) out.push(`${(d.phases ?? [5000]).length} scudi a fasi`);
  return out;
}

/** Scheda del nemico toccato o sotto il mouse: vita, scudo, armatura, modificatori e tratti. */
function drawInspect() {
  if (inspectId !== null && !state.enemies.some((e) => e.id === inspectId)) inspectId = null;
  if (hoverId !== null && !state.enemies.some((e) => e.id === hoverId)) hoverId = null;
  const id = hoverId ?? inspectId;
  const e = id === null ? null : state.enemies.find((x) => x.id === id);
  const p = e ? drawnAt.get(e.id) : null;
  if (!e || !p) return;
  const d = ENEMIES[e.kind];
  const k = dpr;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Anello sul nemico scelto.
  ctx.strokeStyle = COLORS.cream;
  ctx.lineWidth = 2 * k;
  ctx.setLineDash([5 * k, 4 * k]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, (enemySize(e) + 0.12) * T * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const mods = modsOf(e.mods);
  const traits = enemyTraits(e);
  const armor = d.armor + (e.mods & modBit("corazzato") ? 40 : 0);
  const status: string[] = [];
  if (armor) status.push(`Armatura ${armor}`);
  if (e.stun > 0) status.push("Stordito");
  else if (e.speedBp < 10000) status.push(`Rallentato al ${Math.round(e.speedBp / 100)}%`);
  if (e.mark > 0) status.push("Marchiato");
  const name = (e.kind === "bruto" && e.boss ? "Grande Bruto" : d.name) + (e.boss ? " · Boss" : "");
  const lines = 3 + (mods.length ? 1 : 0) + (traits.length ? Math.ceil(traits.length / 2) : 0);
  const W = 210 * k;
  const H = (30 + lines * 17) * k;
  let x = p.x + (enemySize(e) + 0.3) * T * k;
  let y = p.y - H / 2;
  if (x + W > canvas.width - 4 * k) x = p.x - (enemySize(e) + 0.3) * T * k - W;
  x = Math.max(4 * k, Math.min(canvas.width - W - 4 * k, x));
  y = Math.max(4 * k, Math.min(canvas.height - H - 4 * k, y));
  ctx.fillStyle = "rgba(11,23,29,.94)";
  ctx.strokeStyle = e.boss ? COLORS.coral : "rgba(238,228,203,.35)";
  ctx.lineWidth = 1 * k;
  ctx.fillRect(x, y, W, H);
  ctx.strokeRect(x + 0.5 * k, y + 0.5 * k, W - k, H - k);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  let ty = y + 8 * k;
  const pad = x + 10 * k;
  ctx.font = `600 ${14 * k}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
  ctx.fillStyle = e.boss ? "#ffb59c" : COLORS.cream;
  ctx.fillText(name, pad, ty);
  ty += 19 * k;
  // Vita e scudo.
  const bw = W - 20 * k;
  ctx.fillStyle = "#2a1712";
  ctx.fillRect(pad, ty, bw, 8 * k);
  ctx.fillStyle = e.hp / e.maxHp > 0.4 ? "#9fd28b" : COLORS.coral;
  ctx.fillRect(pad, ty, (bw * Math.max(0, e.hp)) / e.maxHp, 8 * k);
  if (e.shield > 0) {
    ctx.fillStyle = "rgba(201,184,255,.85)";
    ctx.fillRect(pad, ty + 5 * k, Math.min(bw, (bw * e.shield) / e.maxHp), 3 * k);
  }
  ty += 12 * k;
  ctx.font = `500 ${12.5 * k}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
  ctx.fillStyle = COLORS.cream;
  ctx.fillText(`Vita ${fmt(Math.max(0, e.hp))} / ${fmt(e.maxHp)}${e.shield > 0 ? ` · scudo ${fmt(e.shield)}` : ""}`, pad, ty);
  ty += 17 * k;
  ctx.fillStyle = "rgba(238,228,203,.7)";
  ctx.fillText(status.join(" · ") || `Toglie ${e.lifeDamage} ${e.lifeDamage === 1 ? "vita" : "vite"} se arriva al Faro`, pad, ty);
  ty += 17 * k;
  if (mods.length) {
    let mx = pad;
    for (const m of mods) {
      const label = MODS[m].name;
      const w = ctx.measureText(label).width + 10 * k;
      ctx.fillStyle = MODS[m].color;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(mx, ty - 1 * k, w, 15 * k);
      ctx.globalAlpha = 1;
      ctx.fillText(label, mx + 5 * k, ty);
      mx += w + 4 * k;
    }
    ty += 17 * k;
  }
  ctx.fillStyle = "rgba(238,228,203,.6)";
  for (let i = 0; i < traits.length; i += 2) {
    ctx.fillText(traits.slice(i, i + 2).join(" · "), pad, ty);
    ty += 17 * k;
  }
  ctx.restore();
}

function enemyMarks(e: GameState["enemies"][number], x: number, y: number, T: number, now: number) {
  ctx.save();
  const r = T * (enemySize(e) + 0.04);
  const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.008 + e.id);
  const has = (m: Parameters<typeof modBit>[0]) => (e.mods & modBit(m)) !== 0;
  // Scudo: anello viola, spesso quanto lo scudo che resta.
  if (e.shield > 0) {
    ctx.strokeStyle = "rgba(201,184,255,.9)";
    ctx.lineWidth = Math.max(1.5, T * (0.03 + Math.min(0.06, (0.08 * e.shield) / e.maxHp)));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Benedetto: aureola dorata sopra la testa.
  if (has("benedetto")) {
    ctx.strokeStyle = `rgba(255,241,176,${0.6 + 0.4 * pulse})`;
    ctx.lineWidth = Math.max(1.5, T * 0.04);
    ctx.beginPath();
    ctx.ellipse(x, y - r - T * 0.06, r * 0.55, r * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Gonfio: contorno verde tratteggiato, più largo.
  if (has("gonfio")) {
    ctx.strokeStyle = "rgba(159,210,139,.85)";
    ctx.lineWidth = Math.max(1, T * 0.03);
    ctx.setLineDash([T * 0.08, T * 0.06]);
    ctx.beginPath();
    ctx.arc(x, y, r + T * 0.07, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Agile: scie di velocità.
  if (has("agile")) {
    ctx.strokeStyle = "rgba(165,228,236,.8)";
    ctx.lineWidth = Math.max(1, T * 0.03);
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(x - r - T * 0.05, y + i * r * 0.45);
      ctx.lineTo(x - r - T * (0.22 + 0.06 * pulse), y + i * r * 0.45);
      ctx.stroke();
    }
  }
  // Provocatore: mirino rosso che pulsa.
  if (has("provocatore")) {
    ctx.strokeStyle = `rgba(226,113,79,${0.5 + 0.5 * pulse})`;
    ctx.lineWidth = Math.max(1.5, T * 0.035);
    ctx.beginPath();
    ctx.arc(x, y, r + T * 0.12, 0, Math.PI * 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(x + dx * (r + T * 0.06), y + dy * (r + T * 0.06));
      ctx.lineTo(x + dx * (r + T * 0.2), y + dy * (r + T * 0.2));
    }
    ctx.stroke();
  }
  // Corazzato: piastre d'acciaio ai quattro lati.
  if (has("corazzato")) {
    ctx.fillStyle = "#b9a88a";
    ctx.strokeStyle = "#1a2124";
    ctx.lineWidth = Math.max(1, T * 0.02);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const px = x + Math.cos(a) * r * 0.95;
      const py = y + Math.sin(a) * r * 0.95;
      ctx.beginPath();
      ctx.rect(px - T * 0.05, py - T * 0.05, T * 0.1, T * 0.1);
      ctx.fill();
      ctx.stroke();
    }
  }
  // Scisso: una crepa rosa che lo attraversa.
  if (has("scisso")) {
    ctx.strokeStyle = "rgba(255,154,154,.9)";
    ctx.lineWidth = Math.max(1, T * 0.03);
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x - r * 0.2, y - r * 0.3);
    ctx.lineTo(x + r * 0.15, y + r * 0.1);
    ctx.lineTo(x, y + r);
    ctx.stroke();
  }
  // Spettrale: alone lilla che va e viene.
  if (has("spettrale")) {
    ctx.strokeStyle = `rgba(217,210,255,${0.25 + 0.45 * pulse})`;
    ctx.lineWidth = Math.max(1, T * 0.025);
    ctx.setLineDash([T * 0.03, T * 0.05]);
    ctx.beginPath();
    ctx.arc(x, y, r + T * 0.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Taglia del Kingpin: moneta d'oro sopra la testa.
  if ((e.bounty ?? 0) > 0) {
    ctx.fillStyle = COLORS.brass;
    ctx.strokeStyle = "#5a3d0a";
    ctx.lineWidth = Math.max(1, T * 0.02);
    ctx.beginPath();
    ctx.arc(x + r * 0.7, y - r * 0.9, T * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Marchio dell'Arpione.
  if (e.mark > 0) {
    ctx.strokeStyle = COLORS.coral;
    ctx.lineWidth = Math.max(1, T * 0.03);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.6, y - r * 0.6);
    ctx.lineTo(x + r * 0.6, y + r * 0.6);
    ctx.moveTo(x + r * 0.6, y - r * 0.6);
    ctx.lineTo(x - r * 0.6, y + r * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

function rangeRing(x: number, y: number, r: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(1, T * dpr * 0.03);
  ctx.setLineDash([T * dpr * 0.14, T * dpr * 0.1]);
  ctx.stroke();
  ctx.restore();
}

// ---------- ciclo principale ----------

function updateBossBar() {
  const bar = $("bossBar");
  const b = state.enemies.find((e) => e.boss);
  bar.hidden = !b || inMenu;
  if (!b) return;
  setText($("bossName"), b.kind === "bruto" ? "Grande Bruto" : ENEMIES[b.kind].name);
  $("bossHp").style.setProperty("--p", String(Math.max(0, b.hp) / b.maxHp));
  $("bossShield").style.setProperty("--p", String(Math.min(1, b.shield / b.maxHp)));
  const mods = modsOf(b.mods).map((m) => MODS[m].name).join(", ");
  setText($("bossInfo"), mods ? `Modificatori: ${mods}` : "");
}

function frame(now: number) {
  const dt = Math.min(250, now - (lastFrame || now));
  lastFrame = now;
  const guest = match && !match.isHost && match.state === state && !inMenu;
  if (guest) {
    // Chi partecipa segue chi ospita: esegue i tick confermati, più in fretta se è rimasto indietro.
    prevPos.clear();
    for (const e of state.enemies) prevPos.set(e.id, { x: e.x, y: e.y });
    const ev = match!.guestTicks(match!.behind > 30 ? 30 : match!.behind > 4 ? 3 : 1);
    if (ev.length) handleEvents(ev);
    accumulator = 0;
  } else if (!inMenu && !paused && !dialogQueue.length && !isOver()) {
    accumulator += dt * speed;
    let guard = 0;
    while (accumulator >= 100 && guard < 12 && !dialogQueue.length && !isOver()) {
      accumulator -= 100;
      tick();
      guard++;
    }
  }
  if (match && match.isHost && match.state === state && (paused || isOver())) match.flush();
  // Sotto il menu o con la scheda nascosta non si disegna nulla; in grafica leggera al massimo 30 al secondo.
  const visible = !inMenu && !document.hidden;
  if (visible && (!light() || now - lastRender >= 32)) {
    lastRender = now;
    updatePanel();
    updateBossBar();
    $("adminBtn").hidden = inMenu || !(isAdmin() || state.sandbox);
    render(now);
  }
  requestAnimationFrame(frame);
}

function start(saved: { snap?: string; log?: Array<[number, Command[]]>; seen?: boolean }) {
  if (saved.snap) {
    state = restore(saved.snap);
    log = saved.log ?? [];
    paused = true;
  }
  buildCards();
  bindPointer();
  bindButtons();
  layout();
  new ResizeObserver(() => layout()).observe(app);
  window.addEventListener("orientationchange", () => layout());
  if (saved.snap) {
    inMenu = false;
    $("menu").hidden = true;
    $("pauseLayer").hidden = false;
  } else showMenu();
  updatePanel();
  requestAnimationFrame(frame);
  void checkServer();

  // Accesso per i test automatici e per chi collauda.
  (window as unknown as Record<string, unknown>).__faro = {
    get state() {
      return state;
    },
    get log() {
      return log;
    },
    hashState,
    createGame,
    step,
    playBot,
    get seed() {
      return state.seed;
    },
    debug: {
      restart(seed: number, opts: GameOptions = {}) {
        newMatch(opts.mode ?? "campagna", opts.level ?? "porto", seed, opts);
        dialogQueue = [];
        $("dialog").hidden = true;
      },
      get meta() {
        return meta;
      },
      setSchegge(n: number) {
        meta.schegge = n;
        saveMeta();
        if (inMenu) renderMenu();
      },
      get lastReward() {
        return lastReward;
      },
      adminApi,
      openAdmin,
      balance: () => effectiveBalance(),
      send,
      get match() {
        return match;
      },
      net,
      tick() {
        tick();
      },
      closeDialog() {
        dialogQueue = [];
        $("dialog").hidden = true;
      },
      cellCenter(cx: number, cy: number) {
        const r = canvas.getBoundingClientRect();
        const p = S(cx * TILE + TILE / 2, cy * TILE + TILE / 2);
        return { x: r.left + p.x / dpr, y: r.top + p.y / dpr };
      },
      get view() {
        return { rot, below, T };
      },
    },
  };
  try {
    (navigator as Navigator & { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request("screen").catch(() => {});
  } catch {
    /* facoltativo */
  }
}

const hot = (window as unknown as { claude?: { hot?: { snapshot?(f: () => unknown): void; ready?(f: (d: never) => void): void; data?: unknown } } }).claude?.hot;
hot?.snapshot?.(() => ({ snap: snapshot(state), log }));
if (hot?.ready) hot.ready(start as (d: never) => void);
else start((hot?.data as { snap?: string }) ?? {});
