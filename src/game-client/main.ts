// Client del prototipo: disegna lo stato, raccoglie i tocchi, non decide mai le regole.
import { ADMIN_ONLY, EVENT_TOWER, KINGPIN_QUEUE, SURVIVAL_MAPS, UNITS, UNIT_ORDER, ABILITIES, APEX_RANK, AbilityId, ENEMIES, GameMode, HARDCORE_TOWERS, LEVELS, MODS, LOADOUT_SIZE, MAP_H, MAP_W, MAX_RANK, RANK_COSTS, RULES, STARTER_TOWERS, TICKS_PER_SECOND, TILE, TOWERS, TOWER_ORDER, TRACKS, TowerKind, Track, Branch, levelById } from "../sim-core/content";
import { Command, Enemy, GameEvent, levelHpBp, sentrySpot, GameOptions, GameState, modBit, playerCount, hiddenWon, canPlace, covers, sizeOf, abilityCdOf, allowedOf, cashOf, apexBlock, apexPrice, applyCommands, modsOf, perleFor, cellEmerged, createGame, effStats, hashState, isBuildable, laneIsOpen, levelOf, rankedStats, restore, rewardFor, sellValue, specPrice, statsIn, snapshot, starsFor, step, upgradePrice, waveCount, wavePreview } from "../sim-core/sim";
import { playBot } from "../sim-core/bot";
import { drawTwist, qteKey, renderAim, renderChoice, renderQte, renderTwist, twistToast } from "./twist-ui";
import { HARDCORE, ModeDef, NIGHTS, SURVIVAL, disgeloFor, modeDef } from "../sim-core/modes";
import { GrantPayload, LocalTransport, Net, RealtimeTransport, Transport, roomCode } from "./net";
import { NetMatch, Player, Setup } from "./netplay";
import { renderLobby, renderOnline } from "./online-ui";
import { AdminApi, BalanceEntry, BalanceKind, describeAll, describeEntry, renderAdminDrawer, renderAdminPanel } from "./admin";
import { Balance, applyBalance, balanceSize, cleanBalance, emptyBalance, mergeBalance, pruneBalance } from "../sim-core/balance";
import { ChangeEntry, MEDALS, MISSIONS, MissionSlot, Totals, GAME_VERSION, VERSION_NOTES, emptyTotals, levelFromXp, levelReward, missionProgress, missionTarget, missionText, newSlot, WeeklyState, weekEndsIn, weekOf, weeklyCheck, weeklyFor } from "./progress";
import { sentryFigure } from "./figures";
import { sfx, sound } from "./sound";
import { COLORS, enemySize, applyMap, drawEnemy, drawEnemyBody, drawFaro, drawShoal, drawTide, drawTowerShape, mapToScreen, renderBackground, toPx } from "./draw";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString("it-IT");
const canvas = $<HTMLCanvasElement>("map");
const ctx = canvas.getContext("2d")!;
// Fondo pronto (carta e canali fermi) in una tela fuori schermo: un'unica copia per fotogramma.
// Misurato: su rendering software una tela sola è più veloce di due tele sovrapposte.
const bgCanvas = document.createElement("canvas");
const bgCtx = bgCanvas.getContext("2d", { alpha: false })!;
let bgDrawn = "";
let guestAcc = 0; // cosa c'è sulla tela di fondo: misura, mappa, canali aperti

// Qualità automatica: se i fotogrammi arrivano lenti si abbassano i pixel, se tornano veloci si rialzano.
let autoScale = 1;
let slowFrames = 0;
let fastFrames = 0;
let autoLock = false; // per le misure: qualità fissa
function adaptQuality(dt: number) {
  if (autoLock || inMenu || document.hidden || dt <= 0 || dt > 200) return;
  if (dt > 24) {
    slowFrames += 1;
    fastFrames = 0;
  } else if (dt < 18) {
    fastFrames += 1;
    slowFrames = Math.max(0, slowFrames - 1);
  }
  if (slowFrames > 45 && autoScale > 0.5) {
    autoScale = Math.max(0.5, Math.round((autoScale - 0.15) * 100) / 100);
    slowFrames = 0;
    layout();
  } else if (fastFrames > 600 && autoScale < 1) {
    autoScale = Math.min(1, Math.round((autoScale + 0.1) * 100) / 100);
    fastFrames = 0;
    layout();
  }
}
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
// Audio: tutto, solo effetti, muto.
{
  const saved = store.get("faro.audio");
  sound.setMode(saved === "off" ? "off" : saved === "fx" ? "fx" : "all");
}
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
let brazierMode = false; // Frost: il prossimo tocco sulla carta sposta un braciere
function toggleBrazier() {
  brazierMode = !brazierMode;
  if (brazierMode) {
    setPlacing(null);
    selectTower(null);
  }
}
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
/** Tipi di torre costruiti in questa partita, per le sfide della settimana. */
const matchKinds = new Set<string>();
/** Ultimo colpo di ogni torretta dell'Ingegnere (id torre * 8 + numero). */
const sentryShot = new Map<number, number>();
/** Quando ha sparato ogni torre (rinculo) e quando è stata costruita o migliorata (saltello). */
const fired = new Map<number, number>();
const popAt = new Map<number, number>();
/** Ultimo aspetto di ogni nemico: direzione, vita e posizione, per girarlo, farlo lampeggiare e farlo cadere. */
const shown = new Map<number, { e: Enemy; x: number; y: number; h: number; hp: number; hitAt: number }>();
const KICK_MS: Partial<Record<TowerKind, number>> = { piromante: 520, pistolero: 150, sledger: 340, mortaio: 320, starcannon: 520, executioner: 420, arpione: 380, cecchino: 240, balestra: 220 };

interface Fx {
  kind: "tracer" | "blast" | "float" | "zap" | "beam" | "ring" | "cone" | "axe" | "corpse" | "flame";
  en?: Enemy; // chi sta cadendo
  a?: number; // direzione del cono, in radianti
  w?: number; // ampiezza del cono, in radianti
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
  weekly?: WeeklyState; // sfide della settimana già riuscite
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
    if (d.weekly && typeof d.weekly === "object" && Array.isArray(d.weekly.done)) m.weekly = { week: n(d.weekly.week, 0, 1e6, 0), done: d.weekly.done.filter((x) => typeof x === "string").slice(0, 12) };
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

// ---------- audio ----------

const wakeAudio = () => sound.wake();

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
  dpr = Math.max(0.5, dpr * autoScale);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  const key = `${pw}x${ph}:${rot}:${state.levelId}:${state.mode === "natale"}`;
  if (key !== bgKey) {
    bgKey = key;
    canvas.width = pw;
    canvas.height = ph;
    bgCanvas.width = pw;
    bgCanvas.height = ph;
    bgDrawn = "";
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

// Riquadro della torre su telefono: si sposta trascinando la maniglia e si riduce col tasto.
let detailY: number | null = null;
function bindDetailHandle() {
  const detail = $("detail");
  const handle = $("dHandle");
  let grab: { dy: number; id: number } | null = null;
  handle.addEventListener("pointerdown", (ev) => {
    if ((ev.target as HTMLElement).closest("button")) return;
    const r = detail.getBoundingClientRect();
    grab = { dy: ev.clientY - r.top, id: ev.pointerId };
    handle.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  handle.addEventListener("pointermove", (ev) => {
    if (!grab || ev.pointerId !== grab.id) return;
    const stage = $("stage").getBoundingClientRect();
    const h = detail.getBoundingClientRect().height;
    const y = Math.max(6, Math.min(stage.height - h - 6, ev.clientY - stage.top - grab.dy));
    detailY = y;
    detail.classList.remove("top");
    detail.style.top = `${Math.round(y)}px`;
    detail.style.bottom = "auto";
  });
  const drop = () => (grab = null);
  handle.addEventListener("pointerup", drop);
  handle.addEventListener("pointercancel", drop);
  // Doppio tocco sulla maniglia: torna alla posizione automatica.
  handle.addEventListener("dblclick", () => {
    detailY = null;
    detail.style.top = "";
    detail.style.bottom = "";
  });
  $("dMin").addEventListener("click", () => {
    const min = !detail.classList.contains("min");
    detail.classList.toggle("min", min);
    $("dMin").setAttribute("aria-pressed", String(min));
    $("dMin").textContent = min ? "Apri" : "Riduci";
    // Riaperto è più alto: se era stato spostato, rientra tutto nella carta.
    if (detailY !== null) {
      const stage = $("stage").getBoundingClientRect();
      detailY = Math.max(6, Math.min(stage.height - detail.getBoundingClientRect().height - 6, detailY));
      detail.style.top = `${Math.round(detailY)}px`;
    }
  });
}

/** Misura delle scritte sulla carta: segue la casella ma resta leggibile su telefono e non enorme su PC. */
function textPx(tile: number, bp: number): number {
  return Math.round(Math.max(11 * dpr, Math.min(20 * dpr, tile * bp)));
}

// Il tocco che apre il riquadro non deve premere anche i suoi tasti (succedeva con lo Star Cannon:
// il riquadro compariva proprio sotto il dito e il rilascio premeva "Vendi").
let selectedAt = 0;
let sellArmed: { id: number; at: number } | null = null;
function selectTower(id: number | null) {
  if (id !== null && id !== selectedId) selectedAt = performance.now();
  selectedId = id;
  sellArmed = null;
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
  if (kind === "sledger") {
    const ice = s.freezeTicks ? ` Oltre il ${pct(s.chillMax)} di rallentamento congela per ${num(s.freezeTicks / TICKS_PER_SECOND)} s (non i boss né chi resiste al gelo).` : "";
    return `Martellata a cono: ${s.damage} danni a ${s.maxTargets} nemici, ${num(TICKS_PER_SECOND / s.cooldown)} colpi/s, portata ${range}. Ogni colpo rallenta del ${pct(s.chillBp)} fino al ${pct(s.chillMax)}.${ice}${s.iceBreaker ? " Danno doppio a chi è gelato." : ""}${s.aftershockBp ? ` Seconda scossa del ${pct(s.aftershockBp)}.` : ""}`;
  }
  if (kind === "ingegnere") return `Chiodi: ${s.damage} danni, ${num(TICKS_PER_SECOND / s.cooldown)} colpi/s, gittata ${range}. Costruisce una torretta ogni ${num(s.sentryEvery / TICKS_PER_SECOND)} s, fino a ${s.sentryMax}: ognuna fa ${s.sentryDamage} danni, ${num(TICKS_PER_SECOND / s.sentryCooldown)} colpi/s. Le torrette restano tra un'ondata e l'altra.${s.pierce ? " Ignora l'armatura." : ""}${s.detect ? " Vede gli invisibili." : ""}`;
  if (kind === "pistolero") return `Revolver: ${s.damage} danni, ${num(TICKS_PER_SECOND / s.cooldown)} colpi/s, gittata ${range}. Ogni ${s.cashEvery} colpi a segno incassa ${s.cashAmount} cash.`;
  if (kind === "piromante") return `Fiammata a cono: ${s.damage} danni a ${s.maxTargets} nemici, ${num(TICKS_PER_SECOND / s.cooldown)} fiammate/s, portata ${range}. Chi è colpito brucia per ${num(s.burnTicks / TICKS_PER_SECOND)} s: ${s.burnDamage * 2} danni al secondo che ignorano l'armatura. Non brucia i nemici di brace.`;
  if (kind === "starcannon") return `Si carica in ${num(s.chargeTicks / TICKS_PER_SECOND)} s: a carica piena ${fmt(s.cannonMax)} danni e ${num(s.cannonStun / TICKS_PER_SECOND)} s di stordimento in un'area di ${num(s.radius / TILE)}; se spari prima, da ${fmt(s.cannonMin)} in su. Poi ${num(s.cooldown / TICKS_PER_SECOND)} s di pausa. Gittata ${range}. Occupa 4 caselle.`;
  if (kind === "accelerator") return `Carica ${num(s.accCharge / TICKS_PER_SECOND)} s, poi raffica di ${num(s.accBurst / TICKS_PER_SECOND)} s: ${s.damage} danni ogni ${num(s.accTick / TICKS_PER_SECOND)} s sullo stesso bersaglio finché vive. Gittata ${range}.${s.detect ? " Vede gli invisibili." : ""}`;
  if (kind === "executioner") return `Ascia: ${s.damage} danni, ${num(TICKS_PER_SECOND / s.cooldown)} lanci/s, gittata ${range}; rimbalza su ${s.chains} nemici senza perdere forza.${s.detect ? " Vede gli invisibili." : ""}${s.executeBp ? ` Finisce chi scende sotto il ${pct(s.executeBp)} di vita.` : ""}`;
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
  renderChoice($("choice"), state, send, playerCount(state) > 1);
  renderQte($("qte"), state, send);
  if (brazierMode && state.phase !== "prep") brazierMode = false;
  renderTwist($("twist"), $("twbar"), state, send, brazierMode, toggleBrazier);
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
  if (t && below && detailY === null) {
    // Il riquadro non deve coprire la torre scelta (se chi gioca non l'ha spostato a mano).
    detail.classList.toggle("top", S(t.x, t.y).y / dpr > stage.clientHeight / 2);
  }
  if (!t && detailY !== null) {
    detailY = null;
    detail.style.top = "";
    detail.style.bottom = "";
  }
  if (t) {
    const def = TOWERS[t.kind];
    const two = def.branches2 && t.branch ? def.branches2[t.branch] : null;
    setText($("dName"), t.level >= 5 ? (two ? two.name : def.apex) : t.branch ? def.branches[t.branch].name : def.name);
    const rank = t.rank ?? 1;
    const foreign = t.owner !== myP;
    setText($("dLevel"), `${t.level >= 5 && !two ? "Apex" : `Livello ${t.level}`}${rank > 1 ? ` · Rango ${rank}` : ""}`);
    setText($("dStats"), statsLine(t.kind, t.level, t.branch, rank));
    renderAim($("dAim"), state, t, !foreign, send);
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
    const armed = !!sellArmed && sellArmed.id === t.id && performance.now() - sellArmed.at < 3000;
    if (sellArmed && !armed) sellArmed = null;
    setText($("btnSell"), foreign ? `Torre di ${ownerName(t.owner)}` : armed ? `Conferma: vendi +${fmt(sellValue(state, t))}` : `Vendi +${fmt(sellValue(state, t))}`);
    $("btnSell").classList.toggle("armed", armed);
    $<HTMLButtonElement>("btnSell").disabled = foreign;
    updateExtra(t);
  }

  $<HTMLButtonElement>("pause").setAttribute("aria-pressed", String(paused));
  setText($("pause"), paused ? "Riprendi" : "Pausa");
  $("speed").setAttribute("aria-pressed", String(speed === 2));
  $("sound").setAttribute("aria-pressed", String(sound.mode !== "off"));
  setText($("sound"), sound.mode === "all" ? "Audio" : sound.mode === "fx" ? "Solo effetti" : "Muto");
}

// Controlli delle torri di supporto: dischi del Grammofono e abilità di Capitano e Medico.
function updateExtra(t: GameState["towers"][number]) {
  const host = $("dExtra");
  const def = TOWERS[t.kind];
  const sig = t.kind === "kingpin" ? `${t.id}:${t.level}:${t.branch}:${t.queue.join(",")}:${t.owner === myP}:${statsIn(state, t).queueSlots}` : t.kind === "starcannon" ? `${t.id}:${t.auto !== false}:${t.owner === myP}` : `${t.id}:${t.kind}`;
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
    } else if (t.kind === "starcannon") {
      // Star Cannon: barra della carica, sparo a mano, sparo automatico a carica piena.
      const mineT = t.owner === myP;
      const fire = document.createElement("button");
      fire.className = "ab towerAb cannonFire";
      fire.id = "cannonFire";
      fire.innerHTML = `Spara<small></small>`;
      fire.disabled = !mineT;
      fire.addEventListener("click", () => send({ t: "cannon", id: t.id }));
      const auto = document.createElement("button");
      auto.id = "cannonAuto";
      auto.setAttribute("aria-pressed", String(t.auto !== false));
      auto.textContent = t.auto !== false ? "Automatico: sì" : "Automatico: no";
      auto.title = "Spara da solo quando la carica è piena";
      auto.disabled = !mineT;
      auto.addEventListener("click", () => send({ t: "cannonAuto", id: t.id, on: t.auto === false }));
      host.append(fire, auto);
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
  if (t.kind !== "starcannon") for (const b of host.querySelectorAll<HTMLButtonElement>(".track")) b.setAttribute("aria-pressed", String(b.dataset.track === t.track));
  const cf = host.querySelector<HTMLElement>(".cannonFire");
  if (cf) {
    const s = effStats(state, t);
    const c = Math.min(t.charge ?? 0, s.chargeTicks);
    const dmg = s.cannonMin + Math.floor(((s.cannonMax - s.cannonMin) * c) / s.chargeTicks);
    cf.style.setProperty("--p", String(c / s.chargeTicks));
    cf.classList.toggle("ready", c >= s.chargeTicks);
    setText(cf.querySelector("small")!, `carica ${Math.floor((c * 100) / s.chargeTicks)}% · ${fmt(dmg)} danni${t.cooldown > 0 ? " · si riassesta" : ""}`);
  }
  const ab = host.querySelector<HTMLElement>(".towerAb:not(.cannonFire)");
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
      if (net.session?.isAdmin) void remoteAdmin(match.code, cmd);
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
        if (ev.from === -1) {
          // Colpo di una torretta dell'Ingegnere: la riconosco dalla posizione.
          for (const t of state.towers) {
            for (let i = 0; i < (t.sentries?.length ?? 0); i++) {
              const at = sentrySpot(t, i);
              if (at.x === ev.x && at.y === ev.y) sentryShot.set(t.id * 8 + i, now);
            }
          }
          sfx.tick();
          break;
        }
        setAim(ev.from, ev.x, ev.y, ev.tx, ev.ty);
        if (ev.from > 0) sfx.gun(state.towers.find((t) => t.id === ev.from)?.kind ?? "");
        else sfx.tick();
        break;
      case "zap":
        fx.push({ kind: "zap", x: ev.points[0], y: ev.points[1], pts: ev.points, born: now, life: 160 });
        if (ev.points.length >= 4) setAim(ev.from, ev.points[0], ev.points[1], ev.points[2], ev.points[3]);
        sfx.zap();
        break;
      case "axe":
        fx.push({ kind: "axe", x: ev.points[0], y: ev.points[1], pts: ev.points, born: now, life: 140 + 70 * (ev.points.length / 2 - 1) });
        if (ev.points.length >= 4) setAim(ev.from, ev.points[0], ev.points[1], ev.points[2], ev.points[3]);
        sfx.axe();
        break;
      case "swing":
        fx.push({ kind: ev.fire ? "flame" : "cone", x: ev.x, y: ev.y, r: ev.range, a: Math.atan2(ev.ty - ev.y, ev.tx - ev.x), w: (ev.cone * Math.PI) / 180, born: now, life: ev.fire ? 620 : 240 });
        setAim(ev.from, ev.x, ev.y, ev.tx, ev.ty);
        (ev.fire ? sfx.flame : sfx.hammer)();
        break;
      case "sentry": {
        const tw = state.towers.find((t) => t.id === ev.from);
        if (tw) {
          const at = sentrySpot(tw, ev.n - 1);
          fx.push({ kind: "ring", x: at.x, y: at.y, r: 350, color: "#f0c93a", born: now, life: 320 });
          sentryShot.set(tw.id * 8 + ev.n - 1, -1e9);
        }
        sfx.ratchet();
        break;
      }
      case "tip":
        fx.push({ kind: "float", x: ev.x, y: ev.y - 500, text: `+${ev.amount}`, color: COLORS.brass, born: now, life: 700 });
        sfx.tip();
        break;
      case "cannon":
        fx.push({ kind: "beam", x: ev.x, y: ev.y, r: ev.radius * 1.4, born: now, life: 700 + ev.power * 6 });
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: ev.radius, color: "#ffd86b", born: now, life: 600 });
        if (ev.power >= 100) fx.push({ kind: "float", x: ev.x, y: ev.y - 600, text: "Carica piena!", color: "#ffd86b", born: now, life: 1100 });
        fired.set(ev.from, now);
        sfx.cannon();
        break;
      case "laser":
        fx.push({ kind: "zap", x: ev.x, y: ev.y, pts: [ev.x, ev.y, ev.tx, ev.ty], color: "#7fe3ff", born: now, life: 90 });
        setAim(ev.from, ev.x, ev.y, ev.tx, ev.ty);
        break;
      case "iced":
        fx.push({ kind: "ring", x: ev.x, y: ev.y, r: 600, color: "#bfe8ff", born: now, life: 420 });
        break;
      case "execute":
        fx.push({ kind: "float", x: ev.x, y: ev.y - 400, text: "Giustiziato", color: COLORS.coral, born: now, life: 900 });
        break;
      case "hidden":
        startCinematic("ONDA NASCOSTA", "Il Re si risveglia", "#ff5a5a");
        openDialog(HIDDEN_LINES);
        break;
      case "hiddenStage":
        startCinematic("THE CREATOR", "e Jack o Bot", "#ffd86b");
        openDialog(CREATOR_LINES);
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
      case "offer":
      case "chosen":
      case "contract":
      case "eruption":
      case "blizzard":
      case "qteEnd": {
        const text = twistToast(ev, state);
        if (text) toast(text);
        if (ev.e === "offer" || ev.e === "chosen") sfx.coin();
        else if (ev.e === "eruption") sfx.blast();
        else if (ev.e === "blizzard" && ev.on) sfx.freeze();
        else if (ev.e === "contract") (ev.ok ? sfx.coin : sfx.deny)();
        else if (ev.e === "qteEnd") (ev.ok ? sfx.apex : sfx.roar)();
        if (ev.e === "qteEnd" && ev.x) fx.push({ kind: "float", x: ev.x, y: ev.y - 500, text: ev.ok ? "Spezzate!" : "Rinforzi!", color: ev.ok ? COLORS.brass : COLORS.coral, born: now, life: 1200 });
        break;
      }
      case "qte":
        sfx.horn();
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
        sfx.waveClear();
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
        (ev.boss ? sfx.bossDown : sfx.kill)();
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
      case "upgraded": {
        popAt.set(ev.id, now);
        const tw = state.towers.find((t) => t.id === ev.id);
        if (tw) matchKinds.add(tw.kind);
        if (tw && ev.e === "upgraded") fx.push({ kind: "ring", x: tw.x, y: tw.y, r: 700, color: COLORS.brass, born: now, life: 380 });
        (ev.e === "upgraded" ? sfx.upgrade : sfx.build)();
        break;
      }
      case "sold":
        sfx.sell();
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
  fired.set(id, performance.now());
}

function tick() {
  prevPos.clear();
  for (const e of state.enemies) prevPos.set(e.id, { x: e.x, y: e.y });
  if (match && match.isHost && match.state === state) handleEvents(match.hostTick());
  else handleEvents(step(state, []));
}

// ---------- dialoghi e fine partita ----------

/** Onda nascosta di Fallen: dialoghi che si vedono solo lì. */
const HIDDEN_LINES: Line[] = [
  { who: "???", text: "Il Re è caduto troppo in fretta. Nessuno, prima di voi, ci era mai riuscito." },
  { who: "Re Risvegliato", text: "Una corona non cade due volte. Mi avete svegliato, guardiani del Faro." },
  { who: "Re Risvegliato", text: "Che la luce si spenga. Venite a me, mie Ombre: nessuno torna a casa stanotte." },
  { who: "Anselma", text: "Il cielo si è fatto nero, le torri non vedono lontano come prima. Tenete il Faro acceso!" },
];
const CREATOR_LINES: Line[] = [
  { who: "The Creator", text: "Interessante. Avete abbattuto il mio Re. Era il mio lavoro migliore." },
  { who: "The Creator", text: "Allora questo mondo lo riscrivo io. Riga per riga, torre per torre." },
  { who: "Jack o Bot", text: "SISTEMA ZUCCA ONLINE. BERSAGLI: TUTTI. HA. HA. HA." },
  { who: "Rin", text: "The Creator stordisce le torri vicine e si fa scortare dagli Araldi. Jack o Bot scatta, ruba cash e quando cade si spacca in zucchette!" },
  { who: "Anselma", text: "Due insieme? Questa non è più una notte, è la fine del mondo. Fuoco con tutto quello che avete!" },
];

/** Scena teatrale: la carta trema, lampeggia e mostra un titolo grande. */
let cinematic: { start: number; title: string; sub: string; color: string } | null = null;
function startCinematic(title: string, sub: string, color: string) {
  cinematic = { start: performance.now(), title, sub, color };
  sfx.roar();
  window.setTimeout(() => sfx.horn(), 500);
}
function drawCinematic(now: number) {
  if (!cinematic) return;
  const k = (performance.now() - cinematic.start) / 3200;
  if (k >= 1) {
    cinematic = null;
    canvas.style.transform = "";
    return;
  }
  // Tremore che si spegne, solo se l'utente non ha chiesto meno movimento.
  if (!reducedMotion) {
    const amp = 8 * (1 - k);
    const dx = (((now * 7) % 13) / 6.5 - 1) * amp;
    const dy = (((now * 11) % 17) / 8.5 - 1) * amp;
    canvas.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const flick = reducedMotion ? 0.35 : 0.25 + 0.2 * Math.abs(Math.sin(now * 0.03));
  ctx.fillStyle = `rgba(0,0,0,${(1 - k) * flick + 0.15})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Titolo grande, misurato sulla tela: resta leggibile su telefono e su PC.
  const w = canvas.width;
  const h = canvas.height;
  const size = Math.max(18, Math.min(w / 9, h / 5));
  const alpha = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1;
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `400 ${Math.round(size)}px "IM Fell English", Georgia, serif`;
  ctx.fillStyle = cinematic.color;
  ctx.shadowColor = "#000";
  ctx.shadowBlur = size * 0.3;
  ctx.fillText(cinematic.title, w / 2, h * 0.38, w * 0.92);
  ctx.font = `italic ${Math.round(size * 0.42)}px "IM Fell English", Georgia, serif`;
  ctx.fillStyle = "#eee4cb";
  ctx.fillText(cinematic.sub, w / 2, h * 0.38 + size * 0.75, w * 0.9);
  ctx.restore();
}

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
    if (hiddenWon(state)) {
      meta.modeWins.nascosta = (meta.modeWins.nascosta ?? 0) + 1;
      out.medals.push("Onda nascosta superata: +1.500 Schegge e +25 Perle");
    }
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
  // Sfide della settimana: Perle in più, una volta per sfida.
  {
    const kinds = [...matchKinds];
    const run = {
      mode: state.mode,
      won,
      cleared: state.cleared,
      lives: state.lives,
      startLives: modeDef(state.mode, state.night)?.lives ?? RULES.startLives,
      seconds: Math.floor(state.tick / TICKS_PER_SECOND),
      kinds,
      families: [...new Set(kinds.map((k) => TOWERS[k as TowerKind].family))],
      towers: state.towers.length,
      players: playerCount(state),
    };
    const res = weeklyCheck(meta.weekly, run, Date.now());
    meta.weekly = res.state;
    for (const w of res.won) {
      meta.perle += w.perle;
      out.perle += w.perle;
      out.medals.push(`Sfida della settimana riuscita: ${w.text} (+${w.perle} Perle)`);
    }
  }
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
  (won ? sfx.win : sfx.lose)();
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
  // I nemici crescono con il livello del giocatore, fino al tetto.
  if (!o.players && o.plevel === undefined) o.plevel = levelFromXp(meta.xp).level;
  lastOpts = o;
  beginState(createGame(seed, o));
}

/** Prepara l'interfaccia per una partita già creata (in solitaria o ricevuta da chi ospita). */
function beginState(st: GameState) {
  state = st;
  myP = match && match.state === st ? Math.max(0, match.order.indexOf(match.me.id)) : 0;
  builtAt.clear();
  popAt.clear();
  matchKinds.clear();
  sentryShot.clear();
  fired.clear();
  shown.clear();
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
  const tough = levelHpBp({ plevel: lv.level }) / 100;
  setText($("mXp"), `${fmt(lv.into)} / ${fmt(lv.need)} XP${tough ? ` · nemici +${tough}% vita` : ""}`);
  $("mXpBar").style.setProperty("--p", String(lv.into / lv.need));
  $("adminOpen").hidden = !isAdmin();
  if (!isAdmin()) $("adminPanel").hidden = true;
  setText($("gfxToggle"), `Grafica: ${gfx === "alta" ? "alta" : "leggera"}`);
  renderOnlineSection();
  renderWeekly();
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
    row.className = `row${inSquad ? " inSquad" : ""}${HARDCORE_TOWERS.includes(kind) ? " hardcore" : ""}${def.exclusive ? ` excl-${def.exclusive}` : ""}`;
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
    role.textContent = owned ? `${def.role} · Rango ${rank}/${MAX_RANK}${apexNote}` : HARDCORE_TOWERS.includes(kind) ? `Torre Hardcore. ${def.role}` : def.role;
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
    const price = unlockPrice(kind);
    let need: string | null = null;
    if (def.exclusive === "evento" && !owned) {
      btn.textContent = "Vinci la Notte 5";
      btn.disabled = true;
      btn.title = "Premio per chi vince l'ultima Notte di Natale";
    } else if (!owned) {
      btn.textContent = `Sblocca · ${priceText(price)}`;
      btn.dataset.action = "unlock";
      if (price.perle) btn.classList.add("pearl");
      if (meta.schegge < price.schegge || meta.perle < price.perle) need = `Servono ${priceText(price)}`;
    } else if (rank < MAX_RANK) {
      const r = RANK_COSTS[rank];
      btn.textContent = `Rango ${rank + 1} · ${fmt(r)}`;
      btn.dataset.action = "rank";
      if (meta.schegge < r) need = `Servono ${fmt(r)} Schegge`;
    } else {
      btn.textContent = "Rango massimo";
      btn.disabled = true;
    }
    if (need) {
      btn.disabled = true;
      btn.title = need;
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
  return { id: net.session?.userId ?? `ospite-${newSeed() >>> 0}`, name: net.session?.username ?? "ospite", loadout: [...meta.loadout], ranks: { ...meta.ranks }, level: levelFromXp(meta.xp).level, seen: Date.now() };
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

/** Comando admin a una stanza: lo manda e controlla che chi ospita lo applichi davvero. */
async function remoteAdmin(code: string, cmd: Command): Promise<void> {
  let id = 0;
  try {
    id = await net.adminCommand(code, cmd);
  } catch (e) {
    toast((e as Error).message);
    return;
  }
  toast("Comando inviato: aspetto la conferma di chi ospita…");
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const room = await net.room(code).catch(() => null);
    const info = (room?.info ?? {}) as { ack?: number; ver?: string; phase?: string };
    if (room?.status === "ended") return toast(`La stanza ${code} è chiusa: il comando non è arrivato`);
    if (room?.status !== "playing") return toast(`La stanza ${code} non è ancora in partita: i comandi valgono solo durante la partita`);
    if ((info.ack ?? 0) >= id) {
      if (info.ver && info.ver !== GAME_VERSION) return toast(`Arrivato, ma chi ospita ha la versione ${info.ver} (tu la ${GAME_VERSION}): i comandi nuovi potrebbero non funzionare. Deve ricaricare la pagina.`);
      return toast("Comando applicato nella stanza");
    }
  }
  toast("Chi ospita non ha confermato: forse ha una versione vecchia del gioco o la connessione è lenta. Fagli ricaricare la pagina.");
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
        // Conferma subito all'admin che i comandi sono entrati.
        if (rows.length) beat = 0;
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
        ack: lastAdminCmd, // ultimo comando admin applicato
        ver: GAME_VERSION, // versione del gioco di chi ospita
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

function renderWeekly() {
  const host = $("weekly");
  host.innerHTML = "";
  const now = Date.now();
  const done = meta.weekly && meta.weekly.week === weekOf(now) ? meta.weekly.done : [];
  const left = weekEndsIn(now);
  const days = Math.floor(left / 86400000);
  const hours = Math.floor((left % 86400000) / 3600000);
  setText($("weeklyLeft"), days ? `cambiano tra ${days} g e ${hours} h` : `cambiano tra ${hours} h`);
  for (const w of weeklyFor(weekOf(now))) {
    const ok = done.includes(w.id);
    const row = document.createElement("div");
    row.className = `mission${ok ? " done" : ""}`;
    const text = document.createElement("div");
    text.className = "rowText";
    const b = document.createElement("b");
    b.textContent = w.text;
    const small = document.createElement("small");
    small.textContent = `premio ${w.perle} Perle`;
    text.append(b, small);
    const tag = document.createElement("span");
    tag.className = "weeklyTag";
    tag.textContent = ok ? "Fatta" : "Da fare";
    row.append(text, tag);
    host.append(row);
  }
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

/** Prezzo di sblocco: Schegge, Perle o tutte e due insieme. */
function unlockPrice(kind: TowerKind) {
  return { schegge: TOWERS[kind].unlock, perle: TOWERS[kind].perle ?? 0 };
}
function priceText(p: { schegge: number; perle: number }) {
  const parts = [p.schegge ? `${fmt(p.schegge)} Schegge` : "", p.perle ? `${fmt(p.perle)} Perle` : ""].filter(Boolean);
  return parts.join(" + ") || "gratis";
}

function buyFromArsenal(kind: TowerKind) {
  wakeAudio();
  const owned = meta.unlocked.includes(kind);
  if (!owned && TOWERS[kind].exclusive) return;
  if (owned) {
    const r = RANK_COSTS[meta.ranks[kind]];
    if (meta.ranks[kind] >= MAX_RANK || !r || meta.schegge < r) return;
    meta.schegge -= r;
    meta.ranks[kind] += 1;
  } else {
    const p = unlockPrice(kind);
    if (meta.schegge < p.schegge || meta.perle < p.perle) return;
    meta.schegge -= p.schegge;
    meta.perle -= p.perle;
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
      command: (code: string, cmd: Command) => remoteAdmin(code, cmd),
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
      if (!net.session?.isAdmin) logChange("Valori originali ripristinati", describeAll(meta.draft));
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
      const items = describeAll(meta.draft);
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
  // Le torri grandi si piazzano col dito al centro del quadrato: si parte dalla casella in alto a sinistra.
  const n = placing ? sizeOf(placing) : 1;
  if (n > 1) return { cx: Math.round(mx / T) - n / 2, cy: Math.round(my / T) - n / 2 };
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
  if (!canPlace(state, placing, ghost.cx, ghost.cy)) {
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
    if (brazierMode) {
      const c = pointerCell(ev, false);
      send({ t: "brazier", cx: c.cx, cy: c.cy });
      brazierMode = false;
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
    const hit = state.towers.find((t) => covers(t, c.cx, c.cy));
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
  // Ogni pulsante fa un piccolo clic.
  document.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement | null)?.closest?.("button")) sfx.click();
  }, true);
  $("sound").addEventListener("click", () => {
    // Tutto → solo effetti → muto → tutto.
    const next = sound.mode === "all" ? "fx" : sound.mode === "fx" ? "off" : "all";
    sound.setMode(next);
    store.set("faro.audio", next === "all" ? "on" : next);
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
  // Per vendere servono due tocchi: il primo chiede conferma per 3 secondi.
  $("btnSell").addEventListener("click", () => {
    if (selectedId === null) return;
    if (!sellArmed || sellArmed.id !== selectedId || performance.now() - sellArmed.at > 3000) {
      sellArmed = { id: selectedId, at: performance.now() };
      return;
    }
    send({ t: "sell", id: selectedId });
    selectTower(null);
  });
  // Il tocco che ha aperto il riquadro non vale come tocco sui suoi tasti: su telefono il "click" arriva
  // al rilascio, quando sotto il dito c'è già il riquadro. Vale solo un tocco iniziato sul riquadro.
  let detailDownAt = 0;
  $("detail").addEventListener("pointerdown", () => (detailDownAt = performance.now()), true);
  $("detail").addEventListener(
    "click",
    (ev) => {
      if (detailDownAt < selectedAt) {
        ev.stopPropagation();
        ev.preventDefault();
      }
    },
    true,
  );
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
    if (!inMenu && qteKey(state, ev.key, send)) {
      ev.preventDefault();
      return;
    }
    if (ev.key === "Escape") brazierMode = false;
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
  const level = levelOf(state);
  const open = level.map.lanes.map((_, i) => laneIsOpen(state, i) || (state.phase === "prep" && state.wave + 1 >= (level.map.laneOpen[i] ?? 1)));
  // Il fondo (carta e canali) cambia di rado: si ridisegna solo sulla tela di sotto, quando serve.
  const bgNow = `${bgKey}|${open.join(",")}`;
  if (bgDrawn !== bgNow && background) {
    bgDrawn = bgNow;
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.drawImage(background, 0, 0);
    applyMap(bgCtx, rot, pxT);
    drawTide(bgCtx, pxT, 0, true, level.map, open, "base");
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bgCanvas, 0, 0);
  const alpha = paused || dialogQueue.length || isOver() ? 1 : Math.min(1, accumulator / 100);
  applyMap(ctx, rot, pxT);
  drawTide(ctx, pxT, now, reducedMotion || light() || state.enemies.length > 80, level.map, open, "flow");
  for (const e of level.map.emerge) for (const [cx, cy] of e.cells) drawShoal(ctx, pxT, cx, cy, cellEmerged(state, cx, cy), reducedMotion ? 0 : now);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawTwist({ ctx, cellRect, S, px: (u) => toPx(u, pxT), now, calm: reducedMotion || light() }, state, brazierMode);
  if (state.hidden?.on && state.phase === "wave") {
    // Eclissi dell'onda nascosta: la carta si fa scura e rossa.
    ctx.fillStyle = `rgba(40,0,12,${reducedMotion ? 0.3 : 0.26 + 0.06 * Math.sin(now * 0.004)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

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
    const shotAgo = now - (fired.get(t.id) ?? -1e9);
    // Gli orologi del disegno e degli eventi possono non coincidere: fuori dall'intervallo non si anima.
    const kick = reducedMotion || shotAgo < 0 ? 0 : Math.max(0, 1 - shotAgo / (KICK_MS[t.kind] ?? 170));
    // Appena costruita o migliorata la torre fa un saltello.
    const born = (now - (popAt.get(t.id) ?? -1e9)) / 320;
    const pop = reducedMotion || born >= 1 || born < 0 ? 1 : 1 + 0.22 * Math.sin(born * Math.PI) * (1 - born * 0.5);
    drawTowerShape(ctx, t.kind, p.x, p.y, pxT * sizeOf(t.kind) * pop, angle, t.level, t.branch, reducedMotion ? 0 : now, t.track, kick);
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

  // Con tanti nemici (o su dispositivi lenti) si usano le copie già disegnate.
  const many = state.enemies.length > 50 || autoScale < 1 || light();
  for (const e of state.enemies) {
    const prev = prevPos.get(e.id);
    const ux = prev ? prev.x + (e.x - prev.x) * alpha : e.x;
    const uy = prev ? prev.y + (e.y - prev.y) * alpha : e.y;
    const lane = e.boss ? 0 : e.offset;
    const p = S(ux + lane * 0.5, uy + lane);
    // Il nemico guarda dove cammina e lampeggia quando perde vita.
    let look = shown.get(e.id);
    if (!look) shown.set(e.id, (look = { e, x: 0, y: 0, h: turn(), hp: e.hp, hitAt: -1e9 }));
    if (prev && (e.x !== prev.x || e.y !== prev.y)) {
      const want = Math.atan2(e.y - prev.y, e.x - prev.x) + turn();
      const diff = Math.atan2(Math.sin(want - look.h), Math.cos(want - look.h));
      look.h += diff * 0.3;
    }
    if (e.hp < look.hp) look.hitAt = now;
    look.hp = e.hp;
    look.e = e;
    look.x = ux + lane * 0.5;
    look.y = uy + lane;
    drawEnemy(ctx, e, p.x, p.y, pxT, now, reducedMotion, many, look.h, !reducedMotion && now - look.hitAt < 70);
    if (e.frozen || e.chill) {
      // Gelo dello Sledger: velo azzurro, pieno se congelato.
      ctx.save();
      ctx.fillStyle = e.frozen ? "rgba(200,238,255,.55)" : `rgba(170,215,255,${Math.min(0.35, (e.chill ?? 0) / 20000)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pxT * (e.boss ? 0.6 : 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Nelle folle enormi i segni dei modificatori restano solo sui boss: la barra della vita basta.
    if ((e.mods || e.shield || e.mark || e.bounty) && (e.boss || state.enemies.length < 150)) enemyMarks(e, p.x, p.y, pxT, now);
    drawnAt.set(e.id, p);
  }
  // Chi non c'è più ed è stato abbattuto cade a pezzi; chi è arrivato al Faro sparisce e basta.
  if (shown.size > state.enemies.length) {
    const live = new Set<number>();
    for (const e of state.enemies) live.add(e.id);
    for (const [id, v] of shown) {
      if (live.has(id)) continue;
      shown.delete(id);
      if (v.e.hp <= 0 && !reducedMotion && (!many || v.e.boss)) fx.push({ kind: "corpse", x: v.x, y: v.y, a: v.h, en: v.e, born: performance.now(), life: v.e.boss ? 900 : 420 });
    }
  }
  // Torrette dell'Ingegnere, attorno a lui.
  for (const t of state.towers) {
    if (!t.sentries?.length) continue;
    const heavy = t.branch === "A";
    const ang = aim.has(t.id) ? aim.get(t.id)! + turn() : -0.6;
    for (let i = 0; i < t.sentries.length; i++) {
      const at = sentrySpot(t, i);
      const q = S(at.x, at.y);
      const ago = now - (sentryShot.get(t.id * 8 + i) ?? -1e9);
      ctx.save();
      ctx.translate(q.x, q.y);
      sentryFigure(ctx, pxT * 1.35, ang, heavy, reducedMotion || ago < 0 ? 0 : Math.max(0, 1 - ago / 140));
      ctx.restore();
    }
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
  // Tetto agli effetti: con centinaia di nemici restano i più recenti.
  const fxMax = many ? 90 : 220;
  if (fx.length > fxMax) fx.splice(0, fx.length - fxMax);
  for (const f of fx) {
    const k = (clock - f.born) / f.life;
    const p = S(f.x, f.y);
    ctx.save();
    if (f.kind === "corpse") {
      // Caduta: la figura si rimpicciolisce e svanisce, i pezzi volano via.
      const en = f.en!;
      const r = pxT * enemySize(en);
      ctx.globalAlpha = 1 - k;
      ctx.translate(p.x, p.y);
      ctx.save();
      ctx.scale(1 - 0.4 * k, 1 - 0.4 * k);
      drawEnemyBody(ctx, en, 0, 0, pxT, f.a ?? 0, 0, k < 0.3);
      ctx.restore();
      const n = en.boss ? 12 : 6;
      for (let i = 0; i < n; i++) {
        const a = en.id * 1.7 + (i * Math.PI * 2) / n;
        const d = r * (0.5 + 1.9 * k * (0.7 + (i % 3) * 0.2));
        const q = r * (en.boss ? 0.16 : 0.22) * (1 - k * 0.5);
        ctx.fillStyle = i % 2 ? "#eee4cb" : "#0d1418";
        ctx.fillRect(Math.cos(a) * d - q / 2, Math.sin(a) * d - q / 2 - Math.sin(k * Math.PI) * r * 0.5, q, q);
      }
    } else if (f.kind === "zap") {
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
    } else if (f.kind === "flame") {
      // Getto del Piromante: sbuffi che partono dall'ugello, si allargano e sfumano dal bianco al rosso.
      const reach = toPx(f.r!, pxT);
      const dir = f.a! + turn();
      const seed = f.born * 0.37;
      const puffs = light() ? 12 : 24;
      const nozzle = pxT * 0.46;
      // Due passate: fuori l'arancio che vira al rosso, dentro il cuore giallo.
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < puffs; i++) {
          // Ogni sbuffo parte un po' dopo il precedente: il getto esce, resta teso, poi la coda si stacca.
          const q = k * 1.6 - (i / puffs) * 0.9;
          if (q <= 0 || q >= 1 || (pass === 1 && q > 0.7)) continue;
          const h = Math.sin(seed + i * 12.9898) * 43758.5453;
          const spread = (h - Math.floor(h) - 0.5) * f.w! * 0.9;
          const d = nozzle + (reach - nozzle) * (1 - (1 - q) * (1 - q) * 0.6 - 0.4 * (1 - q));
          const x = p.x + Math.cos(dir + spread * q) * d;
          const y = p.y + Math.sin(dir + spread * q) * d;
          const r = pxT * (0.1 + 0.25 * q) * (pass ? 0.55 : 1);
          ctx.globalAlpha = (q > 0.75 ? (1 - q) / 0.25 : 1) * (pass ? 0.95 : 0.8);
          ctx.fillStyle = pass ? (q < 0.3 ? "#fff6d6" : "#ffd86b") : q < 0.45 ? "#ff9a3a" : q < 0.75 ? "#f0662a" : "#b8321a";
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (f.kind === "cone") {
      // Martellata dello Sledger: un ventaglio di ghiaccio che svanisce.
      const r = toPx(f.r!, pxT);
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.fillStyle = f.color ?? "#cfeeff";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, r * (0.6 + 0.4 * k), f.a! - f.w! / 2, f.a! + f.w! / 2);
      ctx.closePath();
      ctx.fill();
    } else if (f.kind === "axe") {
      // L'ascia vola da un bersaglio all'altro girando su sé stessa.
      const pts = f.pts!;
      const legs = pts.length / 2 - 1;
      const pos = Math.min(legs - 0.001, k * legs);
      const i = Math.floor(pos);
      const a = S(pts[i * 2], pts[i * 2 + 1]);
      const b = S(pts[i * 2 + 2], pts[i * 2 + 3]);
      const u = pos - i;
      ctx.translate(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
      ctx.rotate(clock * 0.03);
      ctx.fillStyle = "#d6dde0";
      ctx.beginPath();
      ctx.moveTo(0, -pxT * 0.05);
      ctx.quadraticCurveTo(pxT * 0.28, -pxT * 0.22, pxT * 0.18, 0);
      ctx.quadraticCurveTo(pxT * 0.28, pxT * 0.22, 0, pxT * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#6b4a2e";
      ctx.fillRect(-pxT * 0.16, -pxT * 0.02, pxT * 0.18, pxT * 0.04);
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
      ctx.font = `700 ${textPx(pxT, 0.34)}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(f.text!, p.x, p.y - pxT * (0.3 + k * 0.5));
    }
    ctx.restore();
  }

  if (placing && ghost) {
    const ok = canPlace(state, placing, ghost.cx, ghost.cy);
    // Le torri grandi coprono un quadrato di caselle: si unisce il primo e l'ultimo rettangolo.
    const n = sizeOf(placing);
    const r0 = cellRect(ghost.cx, ghost.cy);
    const r1 = cellRect(ghost.cx + n - 1, ghost.cy + n - 1);
    const r = { x: Math.min(r0.x, r1.x), y: Math.min(r0.y, r1.y), w: Math.max(r0.x + r0.w, r1.x + r1.w) - Math.min(r0.x, r1.x), h: Math.max(r0.y + r0.h, r1.y + r1.h) - Math.min(r0.y, r1.y) };
    const x = r.x + r.w / 2;
    const y = r.y + r.h / 2;
    rangeRing(x, y, toPx(TOWERS[placing].levels[0].range, pxT), ok ? COLORS.brass : COLORS.coral);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = ok ? "rgba(224,179,84,.25)" : "rgba(226,113,79,.35)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    drawTowerShape(ctx, placing, x, y, pxT * n, -0.6);
    ctx.restore();
  }

  drawCinematic(now);

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
    ctx.font = `700 ${textPx(T, 0.26)}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
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

/** La musica segue quello che succede: menu, tema della modalità, calma tra le ondate, spinta con un boss in campo. */
let musicCheck = 0;
function syncMusic(now: number) {
  if (now - musicCheck < 400) return;
  musicCheck = now;
  if (!$("menu").hidden) return sound.music("menu", 0);
  if (endShown) return sound.music(null);
  const name = state.mode === "natale" ? "natale" : state.mode;
  const boss = state.phase === "wave" && state.enemies.some((e) => e.boss);
  sound.music(name, paused ? 0 : boss ? 2 : state.phase === "wave" ? 1 : 0);
}

function frame(now: number) {
  syncMusic(now);
  const dt = Math.min(250, now - (lastFrame || now));
  lastFrame = now;
  adaptQuality(dt);
  const guest = match && !match.isHost && match.state === state && !inMenu;
  if (guest) {
    // Chi partecipa segue chi ospita a passo regolare (10 tick al secondo, di più se è indietro),
    // così il movimento si può interpolare come per chi ospita, senza scatti né raffiche di calcolo.
    const m = match!;
    const rate = Math.min(6, 1 + Math.floor(m.behind / 4));
    guestAcc += dt * rate;
    if (m.behind === 0) guestAcc = Math.min(guestAcc, 100);
    let ev: GameEvent[] = [];
    const t0 = performance.now();
    let n = 0;
    while (guestAcc >= 100 && m.behind > 0 && n < 8 && (n === 0 || performance.now() - t0 < 6)) {
      if (n === 0) {
        prevPos.clear();
        for (const e of state.enemies) prevPos.set(e.id, { x: e.x, y: e.y });
      }
      ev = ev.concat(m.guestTicks(1));
      guestAcc -= 100;
      n++;
    }
    if (guestAcc > 300) guestAcc = 100;
    if (ev.length) handleEvents(ev);
    accumulator = Math.max(0, Math.min(100, guestAcc));
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
  bindDetailHandle();
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
      sound,
      sfx,
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
      quality: (lock?: boolean) => {
        if (lock !== undefined) {
          autoLock = lock;
          if (lock && autoScale !== 1) {
            autoScale = 1;
            layout();
          }
        }
        return { autoScale, lock: autoLock };
      },
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
