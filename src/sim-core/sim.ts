// Sim.Core del prototipo: stessa partita su ogni dispositivo a parità di seed e comandi.
// Regole: solo numeri interi nello stato, nessun Math.random, nessun orologio, nessuna funzione
// trigonometrica. Le divisioni tra interi passano sempre da Math.floor.
import {
  ABILITIES,
  APEX_COST_BP,
  APEX_RANK,
  MOD_ORDER,
  MOD_RULES,
  Mod,
  apexStats,
  ARMOR_K,
  AbilityId,
  Branch,
  CHAIN_JUMP,
  ENEMIES,
  EnemyKind,
  GameMode,
  LEVELS,
  LevelDef,
  MAP_H,
  MAP_W,
  MAX_RANK,
  RANK_STEP_BP,
  REWARDS,
  RULES,
  TILE,
  TOWERS,
  TOWER_ORDER,
  TYPE_BP,
  TowerKind,
  TowerStats,
  DamageType,
  Track,
  WaveGroup,
  levelById,
} from "./content";
import { hpMulFor, modeDef, waveFor, waveTotal } from "./modes";

export interface Enemy {
  id: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  lane: number;
  dist: number;
  x: number;
  y: number;
  offset: number; // scarto solo grafico, deciso dal seed
  stun: number;
  speedBp: number;
  fragileBp: number;
  lifeDamage: number;
  boss: boolean;
  act: number; // tick al prossimo sabotaggio
  mods: number; // modificatori, un bit per voce di MOD_ORDER
  shield: number;
  mark: number; // tick di marchio dell'Arpione
  markBp: number;
  sacred: number; // tick senza rigenerazione
  summonCd: number;
  songCd: number;
  phase: number;
  skillCd: number; // furto o scatto
  chargeLeft: number;
}

export interface Tower {
  id: number;
  kind: TowerKind;
  cx: number;
  cy: number;
  x: number;
  y: number;
  level: number; // 1-3, 4 = specializzata
  branch: Branch | null;
  cooldown: number;
  invested: number;
  builtInPrep: number; // numero della preparazione in cui è nata, per il rimborso pieno
  damageDone: number;
  stun: number; // stordita da un Sabotatore
  immune: number; // protetta dal Medico
  track: Track; // disco del Grammofono
  abilityCd: number;
  abilityLeft: number;
  bufDamage: number;
  bufRange: number;
  bufHaste: number;
  bufDetect: number; // 1 se un Capitano vicino gli fa vedere gli invisibili
  owner: number; // giocatore che l'ha costruita (0 in solitaria)
  rank: number; // rango permanente del proprietario per questa torre
}

export interface Shell {
  id: number;
  towerId: number;
  x: number;
  y: number;
  land: number;
  fired: number;
  fromX: number;
  fromY: number;
}

export interface Spawn {
  tick: number;
  enemy: EnemyKind;
  lane: number;
  mods: number;
  hpMulBp: number;
  lifeDamage: number;
  boss: boolean;
}

export type Phase = "prep" | "wave" | "won" | "lost";

export interface GameState {
  seed: number;
  rng: number;
  mode: GameMode;
  levelId: string;
  tick: number;
  phase: Phase;
  wave: number; // ondate avviate
  cleared: number; // ondate concluse
  prepLeft: number;
  prepCount: number;
  cash: number;
  lives: number;
  nextId: number;
  kills: number;
  leaks: number;
  adminTouched: boolean;
  sandbox: boolean;
  god: boolean;
  combos: number;
  abilitiesUsed: number;
  apexBuilt: number;
  bossKills: number;
  night: number; // Notte di Natale, 0 fuori dall'evento
  others: PlayerPurse[]; // giocatori dal secondo in poi: ognuno ha il suo cash, le sue abilità e la sua squadra
  hpScaleBp: number; // nemici più resistenti quando i giocatori sono più di uno
  eventBp: number; // forza dell'evento (Disgelo)
  allowed: TowerKind[];
  ranks: Record<TowerKind, number>;
  abilityCd: Record<AbilityId, number>;
  enemies: Enemy[];
  towers: Tower[];
  shells: Shell[];
  spawns: Spawn[];
}

export interface PlayerPurse {
  cash: number;
  abilityCd: Record<AbilityId, number>;
  allowed: TowerKind[];
  ranks: Record<TowerKind, number>;
}

export interface GameOptions {
  mode?: GameMode;
  level?: string;
  allowed?: TowerKind[];
  ranks?: Partial<Record<TowerKind, number>>;
  sandbox?: boolean;
  night?: number;
  eventBp?: number;
  /** Multigiocatore: squadra e ranghi di ogni giocatore, il primo è chi ospita. */
  players?: Array<{ allowed: TowerKind[]; ranks: Partial<Record<TowerKind, number>> }>;
}

export type Command = CommandBody & { p?: number }; // p: giocatore che manda il comando (0 in solitaria)
type CommandBody =
  | { t: "build"; kind: TowerKind; cx: number; cy: number }
  | { t: "upgrade"; id: number }
  | { t: "spec"; id: number; branch: Branch }
  | { t: "sell"; id: number }
  | { t: "skip" }
  | { t: "track"; id: number; track: Track }
  | { t: "towerAbility"; id: number }
  | { t: "ability"; id: "fascio"; x: number; y: number }
  | { t: "ability"; id: "gelata" }
  | { t: "apex"; id: number }
  | { t: "adminCash"; amount: number; to?: number }
  | { t: "adminSpawn"; enemy: EnemyKind; count: number; lane?: number; mods?: Mod[]; boss?: boolean; hpMulBp?: number }
  | { t: "adminLives"; lives: number }
  | { t: "adminGod"; on: boolean }
  | { t: "adminWave"; wave: number }
  | { t: "adminClear" }
  | { t: "adminRecharge" };

export type GameEvent =
  | { e: "shot"; from: number; to: number; x: number; y: number; tx: number; ty: number }
  | { e: "zap"; from: number; points: number[] }
  | { e: "shell"; from: number; id: number }
  | { e: "blast"; x: number; y: number; radius: number }
  | { e: "beam"; x: number; y: number; radius: number }
  | { e: "freeze" }
  | { e: "sabotage"; x: number; y: number; tx: number; ty: number }
  | { e: "heal"; x: number; y: number; radius: number; all: boolean }
  | { e: "rally"; x: number; y: number; radius: number }
  | { e: "combo"; x: number; y: number; name: string }
  | { e: "apex"; x: number; y: number; name: string }
  | { e: "song"; x: number; y: number; radius: number }
  | { e: "roar"; x: number; y: number; radius: number }
  | { e: "summon"; x: number; y: number }
  | { e: "frost"; x: number; y: number; radius: number }
  | { e: "steal"; x: number; y: number; amount: number }
  | { e: "charge"; x: number; y: number }
  | { e: "split"; x: number; y: number }
  | { e: "kill"; x: number; y: number; bounty: number; boss: boolean }
  | { e: "leak"; damage: number }
  | { e: "income"; amount: number; lives: number; amounts?: number[] }
  | { e: "wave"; wave: number }
  | { e: "laneOpen"; lane: number }
  | { e: "emerge" }
  | { e: "built"; id: number; kind: TowerKind }
  | { e: "upgraded"; id: number }
  | { e: "sold"; refund: number }
  | { e: "reject"; reason: string; p?: number }
  | { e: "end"; phase: "won" | "lost" };

// ---------- geometria delle mappe ----------

interface Seg {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  len: number;
  start: number;
}

interface Geometry {
  lanes: Seg[][];
  lengths: number[];
  blocked: Set<number>;
  emerge: Map<number, number>; // casella → ondata in cui emerge
}

const centre = (c: number) => c * TILE + Math.floor(TILE / 2);
const cellKey = (cx: number, cy: number) => cy * MAP_W + cx;
const geoCache = new Map<string, Geometry>();

export function geometry(level: LevelDef): Geometry {
  const hit = geoCache.get(level.id);
  if (hit) return hit;
  const lanes: Seg[][] = [];
  const lengths: number[] = [];
  const blocked = new Set<number>();
  for (const cells of level.map.lanes) {
    const segs: Seg[] = [];
    let total = 0;
    for (let i = 0; i + 1 < cells.length; i++) {
      const [ax, ay] = cells[i];
      const [bx, by] = cells[i + 1];
      const len = (Math.abs(bx - ax) + Math.abs(by - ay)) * TILE;
      segs.push({ x0: centre(ax), y0: centre(ay), dx: Math.sign(bx - ax), dy: Math.sign(by - ay), len, start: total });
      total += len;
      const steps = Math.abs(bx - ax) + Math.abs(by - ay);
      for (let s = 0; s <= steps; s++) {
        const cx = ax + Math.sign(bx - ax) * s;
        const cy = ay + Math.sign(by - ay) * s;
        if (cx >= 0 && cy >= 0 && cx < MAP_W && cy < MAP_H) blocked.add(cellKey(cx, cy));
      }
    }
    lanes.push(segs);
    lengths.push(total);
  }
  for (const [cx, cy] of level.map.rocks) blocked.add(cellKey(cx, cy));
  blocked.add(cellKey(level.map.faro[0], level.map.faro[1]));
  const emerge = new Map<number, number>();
  for (const e of level.map.emerge) for (const [cx, cy] of e.cells) emerge.set(cellKey(cx, cy), e.wave);
  const geo = { lanes, lengths, blocked, emerge };
  geoCache.set(level.id, geo);
  return geo;
}

export const levelOf = (state: GameState) => levelById(state.levelId);

// ---------- giocatori ----------

export const playerCount = (s: GameState) => 1 + s.others.length;
export const cashOf = (s: GameState, p = 0) => (p <= 0 ? s.cash : (s.others[p - 1]?.cash ?? 0));
export const abilityCdOf = (s: GameState, p = 0) => (p <= 0 || !s.others[p - 1] ? s.abilityCd : s.others[p - 1].abilityCd);
export const allowedOf = (s: GameState, p = 0) => (p <= 0 || !s.others[p - 1] ? s.allowed : s.others[p - 1].allowed);
export const ranksOf = (s: GameState, p = 0) => (p <= 0 || !s.others[p - 1] ? s.ranks : s.others[p - 1].ranks);
function addCash(s: GameState, p: number, v: number) {
  if (p <= 0) s.cash = Math.max(0, s.cash + v);
  else if (s.others[p - 1]) s.others[p - 1].cash = Math.max(0, s.others[p - 1].cash + v);
}
/** Taglie e premi d'ondata: ogni giocatore riceve l'intera somma, come in TDS. */
function payAll(s: GameState, v: number) {
  s.cash += v;
  for (const o of s.others) o.cash += v;
}
const cleanRanks = (r?: Partial<Record<TowerKind, number>>) => {
  const out = {} as Record<TowerKind, number>;
  for (const k of TOWER_ORDER) out[k] = Math.max(1, Math.min(MAX_RANK, r?.[k] ?? 1));
  return out;
};

export function lanePoint(level: LevelDef, lane: number, dist: number): { x: number; y: number } {
  const geo = geometry(level);
  const segs = geo.lanes[lane] ?? geo.lanes[0];
  const d = Math.max(0, Math.min(dist, geo.lengths[lane] ?? geo.lengths[0]));
  for (const s of segs) {
    if (d <= s.start + s.len) {
      const along = d - s.start;
      return { x: s.x0 + s.dx * along, y: s.y0 + s.dy * along };
    }
  }
  const last = segs[segs.length - 1];
  return { x: last.x0 + last.dx * last.len, y: last.y0 + last.dy * last.len };
}

export function laneIsOpen(state: GameState, lane: number): boolean {
  return state.wave >= (levelOf(state).map.laneOpen[lane] ?? 1);
}

export function cellEmerged(state: GameState, cx: number, cy: number): boolean {
  const w = geometry(levelOf(state)).emerge.get(cellKey(cx, cy));
  return w === undefined || state.wave >= w;
}

export function isBuildable(state: GameState, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) return false;
  const geo = geometry(levelOf(state));
  if (geo.blocked.has(cellKey(cx, cy))) return false;
  if (!cellEmerged(state, cx, cy)) return false;
  return !state.towers.some((t) => t.cx === cx && t.cy === cy);
}

// ---------- modificatori ----------

export const modBit = (m: Mod) => 1 << MOD_ORDER.indexOf(m);
export const hasMod = (e: { mods: number }, m: Mod) => (e.mods & modBit(m)) !== 0;
export const modsOf = (bits: number): Mod[] => MOD_ORDER.filter((m) => (bits & modBit(m)) !== 0);
export const modsToBits = (list: Mod[] = []) => list.reduce((acc, m) => acc | modBit(m), 0);

// ---------- casualità con seed (xorshift32) ----------

function nextRandom(state: GameState): number {
  let x = state.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.rng = x | 0;
  return x >>> 0;
}

function randomInt(state: GameState, maxExclusive: number): number {
  return nextRandom(state) % maxExclusive;
}

// ---------- statistiche e costi ----------

/** Valori della torre al suo livello, senza rango. */
export function towerStats(t: Pick<Tower, "kind" | "level" | "branch">): TowerStats {
  const def = TOWERS[t.kind];
  if (t.level >= 5 && t.branch) return apexStats(def.branches[t.branch]);
  if (t.level >= 4 && t.branch) return def.branches[t.branch];
  return def.levels[t.level - 1];
}

export function apexPrice(state: GameState, t: Tower): number {
  if (!t.branch) return 0;
  const base = Math.floor((TOWERS[t.kind].branches[t.branch].cost * APEX_COST_BP) / 100000) * 10;
  return discounted(base, discountAt(state, t.x, t.y, t.id));
}

/** Motivo per cui l'Apex non si può costruire, oppure null se si può. */
export function apexBlock(state: GameState, t: Tower): string | null {
  if (t.level !== 4) return "Serve la specializzazione";
  if ((t.rank ?? 1) < APEX_RANK) return `Serve il rango ${APEX_RANK} nell'Arsenale`;
  if (state.towers.some((o) => o.kind === t.kind && o.level >= 5)) return "Un solo Apex per tipo";
  return null;
}

/** Valori con il rango permanente: +10% di danno, rallentamento, rendita e supporto per ogni rango. */
export function rankedStats(t: Pick<Tower, "kind" | "level" | "branch">, rank: number): TowerStats {
  const s = towerStats(t);
  const r = Math.max(1, Math.min(MAX_RANK, rank | 0));
  if (r === 1) return s;
  const mul = 10000 + RANK_STEP_BP * (r - 1);
  const scale = (v: number) => Math.floor((v * mul) / 10000);
  return {
    ...s,
    damage: scale(s.damage),
    slowBp: s.slowBp < 10000 ? 10000 - scale(10000 - s.slowBp) : s.slowBp,
    income: scale(s.income),
    auraBp: scale(s.auraBp),
    hasteBp: scale(s.hasteBp),
  };
}

export function statsIn(state: GameState, t: Tower): TowerStats {
  return rankedStats(t, t.rank ?? state.ranks[t.kind] ?? 1);
}

/** Valori in partita: rango più i bonus delle torri di supporto vicine. */
export function effStats(state: GameState, t: Tower): TowerStats {
  const s = statsIn(state, t);
  if (!t.bufDamage && !t.bufRange && !t.bufHaste && !t.bufDetect) return s;
  return {
    ...s,
    detect: s.detect || t.bufDetect > 0,
    damage: Math.floor((s.damage * (10000 + t.bufDamage)) / 10000),
    range: Math.floor((s.range * (10000 + t.bufRange)) / 10000),
    cooldown: s.cooldown > 0 ? Math.max(1, Math.floor((s.cooldown * 10000) / (10000 + t.bufHaste))) : 0,
  };
}

/** Sconto del Grammofono sul disco Sconto, nel punto indicato. */
export function discountAt(state: GameState, x: number, y: number, except = -1): number {
  let best = 0;
  for (const g of state.towers) {
    if (g.kind !== "grammofono" || g.track !== "sconto" || g.stun > 0 || g.id === except) continue;
    const s = statsIn(state, g);
    if (inRange(g.x, g.y, x, y, s.range)) best = Math.max(best, s.auraBp);
  }
  return Math.min(best, 5000);
}

const discounted = (cost: number, bp: number) => Math.floor((cost * (10000 - bp)) / 10000);

export function buildCost(state: GameState, kind: TowerKind, cx: number, cy: number): number {
  return discounted(TOWERS[kind].levels[0].cost, discountAt(state, centre(cx), centre(cy)));
}

export function upgradeCost(t: Pick<Tower, "kind" | "level">): number | null {
  const def = TOWERS[t.kind];
  return t.level < 3 ? def.levels[t.level].cost : null;
}

export function upgradePrice(state: GameState, t: Tower): number | null {
  const c = upgradeCost(t);
  return c === null ? null : discounted(c, discountAt(state, t.x, t.y, t.id));
}

export function specPrice(state: GameState, t: Tower, branch: Branch): number {
  return discounted(TOWERS[t.kind].branches[branch].cost, discountAt(state, t.x, t.y, t.id));
}

export function sellValue(state: GameState, t: Tower): number {
  if (t.builtInPrep === state.prepCount && state.phase === "prep") return t.invested;
  return Math.floor((t.invested * RULES.sellBp) / 10000);
}

export function damageAgainst(base: number, type: DamageType, kind: EnemyKind, fragileBp: number, pierce: boolean): number {
  const def = ENEMIES[kind];
  const typeBp = pierce ? 10000 : TYPE_BP[type][def.cls];
  const armor = pierce ? 0 : def.armor;
  const raw = Math.floor((base * typeBp * fragileBp * ARMOR_K) / (100000000 * (ARMOR_K + armor)));
  return Math.max(raw, Math.max(1, Math.floor(base / RULES.minDamageDivisor)));
}

export function hpForWave(hp: number, wave: number, hpMulBp: number): number {
  const growth = 10000 + RULES.hpGrowthA * wave + RULES.hpGrowthB * wave * wave;
  return Math.floor((Math.floor((hp * growth) / 10000) * hpMulBp) / 10000);
}

export function wavePreview(state: GameState, waveIndex: number): Array<{ enemy: EnemyKind; count: number; boss: boolean; mods: Mod[] }> {
  return waveFor(state.mode, levelOf(state), waveIndex, state.night).map((g) => ({ enemy: g.enemy, count: g.count, boss: !!g.boss, mods: g.mods ?? [] }));
}

export function waveCount(state: GameState): number {
  return waveTotal(state.mode, levelOf(state), state.night);
}

export function fascioDamage(state: GameState): number {
  return (ABILITIES.fascio.damageBase as number) + (ABILITIES.fascio.damagePerWave as number) * state.wave;
}

/** Schegge guadagnate: dipendono solo dallo stato finale, quindi ogni dispositivo ottiene lo stesso valore. */
export function rewardFor(state: GameState): number {
  if (state.sandbox) return 0;
  const length = waveCount(state);
  const m = modeDef(state.mode, state.night);
  if (m) return state.cleared * m.schegge.perWave + (state.phase === "won" ? m.schegge.win + REWARDS.perStar * starsFor(state.lives) : 0);
  let r = state.cleared * REWARDS.perWave;
  if (state.mode === "infinita") r += Math.max(0, state.cleared - length) * REWARDS.infinitePerWaveBonus;
  if (state.phase === "won") r += REWARDS.win + REWARDS.perStar * starsFor(state.lives);
  return r;
}

/** Perle Nere: solo in Hardcore. */
export function perleFor(state: GameState): number {
  const m = modeDef(state.mode, state.night);
  if (state.sandbox || !m || !m.perle.perWave) return 0;
  return state.cleared * m.perle.perWave + state.bossKills * m.perle.boss + (state.phase === "won" ? m.perle.win : 0);
}

// ---------- creazione ----------

export function createGame(seed: number, opts: GameOptions = {}): GameState {
  const clean = seed | 0 || 0x5eed1234;
  const team = opts.players?.length ? opts.players : null;
  const ranks = cleanRanks(team ? team[0].ranks : opts.ranks);
  const pick = (list?: TowerKind[]) => TOWER_ORDER.filter((k) => opts.sandbox || !list || list.includes(k));
  const mode = opts.mode ?? "campagna";
  const nightN = mode === "natale" ? Math.max(1, Math.min(5, opts.night ?? 1)) : 0;
  const m = modeDef(mode, nightN || 1);
  const levelId = mode === "natale" && m && "map" in m ? (m as { map: string }).map : opts.level;
  const level = levelById(levelId ?? "porto");
  const startCash = opts.sandbox ? 100000 : level.startCash + (m ? m.bonusCash : 0);
  const others: PlayerPurse[] = (team ?? []).slice(1, 4).map((pl) => ({ cash: startCash, abilityCd: { fascio: 0, gelata: 0 }, allowed: pick(pl.allowed), ranks: cleanRanks(pl.ranks) }));
  return {
    seed: clean,
    rng: clean,
    mode,
    levelId: level.id,
    tick: 0,
    phase: "prep",
    wave: 0,
    cleared: 0,
    prepLeft: RULES.firstPrepTicks,
    prepCount: 1,
    cash: startCash,
    lives: m ? m.lives : RULES.startLives,
    nextId: 1,
    kills: 0,
    leaks: 0,
    adminTouched: !!opts.sandbox,
    sandbox: !!opts.sandbox,
    god: false,
    combos: 0,
    abilitiesUsed: 0,
    apexBuilt: 0,
    bossKills: 0,
    night: nightN,
    others,
    hpScaleBp: 10000 + 6000 * others.length,
    eventBp: mode === "natale" ? Math.max(1000, Math.min(30000, opts.eventBp ?? 10000)) : 10000,
    allowed: pick(team ? team[0].allowed : opts.allowed),
    ranks,
    abilityCd: { fascio: 0, gelata: 0 },
    enemies: [],
    towers: [],
    shells: [],
    spawns: [],
  };
}

// ---------- comandi ----------

function applyCommand(state: GameState, cmd: Command, events: GameEvent[]): void {
  if (state.phase === "won" || state.phase === "lost") return;
  const p = Math.max(0, Math.min(state.others.length, cmd.p ?? 0));
  const reject = (reason: string): void => {
    events.push({ e: "reject", reason, p });
  };
  const cash = () => cashOf(state, p);
  // Solo chi ha costruito una torre la può migliorare, vendere o comandare.
  const mine = (id: number) => {
    const t = state.towers.find((x) => x.id === id);
    if (t && t.owner !== p) {
      reject("Questa torre è di un altro giocatore");
      return undefined;
    }
    if (!t) reject("Torre non trovata");
    return t;
  };
  switch (cmd.t) {
    case "build": {
      const def = TOWERS[cmd.kind];
      if (!def) return reject("Torre sconosciuta");
      if (!allowedOf(state, p).includes(cmd.kind)) return reject("Torre non in squadra");
      if (!isBuildable(state, cmd.cx, cmd.cy)) return reject("Qui non si può costruire");
      const cost = buildCost(state, cmd.kind, cmd.cx, cmd.cy);
      if (cash() < cost) return reject("Cash insufficiente");
      addCash(state, p, -cost);
      const id = state.nextId++;
      state.towers.push({
        id,
        kind: cmd.kind,
        cx: cmd.cx,
        cy: cmd.cy,
        x: centre(cmd.cx),
        y: centre(cmd.cy),
        level: 1,
        branch: null,
        cooldown: 0,
        invested: cost,
        builtInPrep: state.phase === "prep" ? state.prepCount : 0,
        damageDone: 0,
        stun: 0,
        immune: 0,
        track: "danno",
        abilityCd: 0,
        abilityLeft: 0,
        bufDamage: 0,
        bufRange: 0,
        bufHaste: 0,
        bufDetect: 0,
        owner: p,
        rank: ranksOf(state, p)[cmd.kind] ?? 1,
      });
      events.push({ e: "built", id, kind: cmd.kind });
      return;
    }
    case "upgrade": {
      const t = mine(cmd.id);
      if (!t) return;
      const cost = upgradePrice(state, t);
      if (cost === null) return reject("Scegli una specializzazione");
      if (cash() < cost) return reject("Cash insufficiente");
      addCash(state, p, -cost);
      t.invested += cost;
      t.level += 1;
      events.push({ e: "upgraded", id: t.id });
      return;
    }
    case "spec": {
      const t = mine(cmd.id);
      if (!t) return;
      if (t.level !== 3) return reject("Serve il livello 3");
      if (!TOWERS[t.kind].branches[cmd.branch]) return reject("Specializzazione sconosciuta");
      const cost = specPrice(state, t, cmd.branch);
      if (cash() < cost) return reject("Cash insufficiente");
      addCash(state, p, -cost);
      t.invested += cost;
      t.level = 4;
      t.branch = cmd.branch;
      events.push({ e: "upgraded", id: t.id });
      return;
    }
    case "sell": {
      const t = mine(cmd.id);
      if (!t) return;
      const idx = state.towers.indexOf(t);
      const refund = sellValue(state, t);
      addCash(state, p, refund);
      state.towers.splice(idx, 1);
      events.push({ e: "sold", refund });
      return;
    }
    case "skip": {
      if (state.phase !== "prep") return;
      const seconds = Math.floor(state.prepLeft / 10);
      payAll(state, seconds * RULES.skipBonusPerSecond);
      state.prepLeft = 0;
      return;
    }
    case "apex": {
      const t = mine(cmd.id);
      if (!t) return;
      const block = apexBlock(state, t);
      if (block) return reject(block);
      const cost = apexPrice(state, t);
      if (cash() < cost) return reject("Cash insufficiente");
      addCash(state, p, -cost);
      t.invested += cost;
      t.level = 5;
      state.apexBuilt += 1;
      events.push({ e: "apex", x: t.x, y: t.y, name: TOWERS[t.kind].apex });
      return;
    }
    case "track": {
      const t = mine(cmd.id);
      if (!t) return;
      if (t.kind !== "grammofono") return reject("Solo il Grammofono cambia disco");
      if (cmd.track !== "danno" && cmd.track !== "gittata" && cmd.track !== "sconto") return reject("Disco sconosciuto");
      t.track = cmd.track;
      return;
    }
    case "towerAbility": {
      const t = mine(cmd.id);
      if (!t) return;
      const s = statsIn(state, t);
      if (!s.abilityCooldown) return reject("Questa torre non ha abilità");
      if (state.phase !== "wave") return reject("Usala durante un'ondata");
      if (t.stun > 0) return reject("La torre è stordita");
      if (t.abilityCd > 0) return reject(`Pronta tra ${Math.ceil(t.abilityCd / 10)} s`);
      t.abilityCd = s.abilityCooldown;
      state.abilitiesUsed += 1;
      if (t.kind === "capitano") {
        t.abilityLeft = s.abilityTicks;
        events.push({ e: "rally", x: t.x, y: t.y, radius: s.range });
      } else if (t.kind === "medico") {
        for (const o of state.towers) {
          o.stun = 0;
          o.immune = Math.max(o.immune, s.abilityTicks);
        }
        events.push({ e: "heal", x: t.x, y: t.y, radius: 0, all: true });
      }
      return;
    }
    case "ability": {
      if (state.phase !== "wave") return reject("Usala durante un'ondata");
      const cds = abilityCdOf(state, p);
      if (cds[cmd.id] > 0) return reject(`${ABILITIES[cmd.id].name} non è ancora pronto`);
      cds[cmd.id] = ABILITIES[cmd.id].cooldown;
      state.abilitiesUsed += 1;
      if (cmd.id === "gelata") {
        for (const e of state.enemies) e.stun = Math.max(e.stun, e.boss ? (ABILITIES.gelata.bossStun as number) : (ABILITIES.gelata.stun as number));
        events.push({ e: "freeze" });
        return;
      }
      const radius = ABILITIES.fascio.radius as number;
      const dmg = fascioDamage(state);
      for (const e of state.enemies) {
        if (e.hp > 0 && inRange(cmd.x, cmd.y, e.x, e.y, radius)) applyDamage(e, enemyDamage(e, dmg, "nessuno", true, 10000));
      }
      events.push({ e: "beam", x: cmd.x, y: cmd.y, radius });
      return;
    }
    case "adminCash": {
      // Il cash va a un solo giocatore: a quello indicato, altrimenti a chi manda il comando.
      addCash(state, Math.max(0, Math.min(state.others.length, cmd.to ?? p)), cmd.amount | 0);
      state.adminTouched = true;
      return;
    }
    case "adminSpawn": {
      if (!ENEMIES[cmd.enemy]) return reject("Nemico sconosciuto");
      const count = Math.max(1, Math.min(cmd.count | 0, 200));
      const lanes = levelOf(state).map.lanes.length;
      const mods = modsToBits(cmd.mods);
      for (let i = 0; i < count; i++) {
        const lane = cmd.lane !== undefined && cmd.lane >= 0 ? Math.min(cmd.lane, lanes - 1) : i % lanes;
        state.spawns.push({ tick: state.tick + 1 + i * 5, enemy: cmd.enemy, lane, mods, hpMulBp: Math.max(1000, Math.min(cmd.hpMulBp ?? 10000, 1000000)), lifeDamage: ENEMIES[cmd.enemy].lifeDamage, boss: !!cmd.boss });
      }
      state.spawns.sort((a, b) => a.tick - b.tick || a.lane - b.lane);
      state.adminTouched = true;
      return;
    }
    case "adminLives": {
      state.lives = Math.max(1, Math.min(999, cmd.lives | 0));
      state.adminTouched = true;
      return;
    }
    case "adminGod": {
      state.god = !!cmd.on;
      state.adminTouched = true;
      return;
    }
    case "adminWave": {
      const target = Math.max(1, Math.min(waveCount(state) + (state.mode === "infinita" ? 1000 : 0), cmd.wave | 0));
      state.enemies = [];
      state.spawns = [];
      state.shells = [];
      state.wave = target - 1;
      state.cleared = target - 1;
      state.phase = "prep";
      state.prepCount += 1;
      state.prepLeft = 30;
      state.adminTouched = true;
      return;
    }
    case "adminClear": {
      state.enemies = [];
      state.spawns = [];
      state.shells = [];
      state.adminTouched = true;
      return;
    }
    case "adminRecharge": {
      for (const cd of [state.abilityCd, ...state.others.map((o) => o.abilityCd)]) {
        cd.fascio = 0;
        cd.gelata = 0;
      }
      for (const t of state.towers) {
        t.abilityCd = 0;
        t.stun = 0;
      }
      state.adminTouched = true;
      return;
    }
  }
}

function startWave(state: GameState, events: GameEvent[]): void {
  const level = levelOf(state);
  const groups: WaveGroup[] = waveFor(state.mode, level, state.wave, state.night);
  state.wave += 1;
  level.map.laneOpen.forEach((w, lane) => {
    if (w === state.wave && w > 1) events.push({ e: "laneOpen", lane });
  });
  if (level.map.emerge.some((e) => e.wave === state.wave)) events.push({ e: "emerge" });
  for (const g of groups) {
    const lane = g.lane < level.map.lanes.length && laneIsOpen(state, g.lane) ? g.lane : 0;
    for (let i = 0; i < g.count; i++) {
      state.spawns.push({
        tick: state.tick + g.delay + i * g.interval,
        enemy: g.enemy,
        lane,
        mods: modsToBits(g.mods),
        hpMulBp: Math.floor(((g.hpMulBp ?? 10000) * state.eventBp) / 10000),
        lifeDamage: g.lifeDamage ?? ENEMIES[g.enemy].lifeDamage,
        boss: !!g.boss,
      });
    }
  }
  state.spawns.sort((a, b) => a.tick - b.tick || a.lane - b.lane);
  state.phase = "wave";
  events.push({ e: "wave", wave: state.wave });
}

function spawnDue(state: GameState): void {
  const level = levelOf(state);
  let n = 0;
  while (n < state.spawns.length && state.spawns[n].tick <= state.tick) n++;
  for (const s of state.spawns.slice(0, n)) {
    const def = ENEMIES[s.enemy];
    let hp = hpForWave(def.hp, Math.max(1, state.wave), s.hpMulBp);
    if (state.hpScaleBp !== 10000) hp = Math.floor((hp * state.hpScaleBp) / 10000);
    if (s.mods & modBit("gonfio")) hp *= 2;
    const p = lanePoint(level, s.lane, 0);
    state.enemies.push({
      id: state.nextId++,
      kind: s.enemy,
      hp,
      maxHp: hp,
      lane: s.lane,
      dist: 0,
      x: p.x,
      y: p.y,
      offset: randomInt(state, 361) - 180,
      stun: 0,
      speedBp: 10000,
      fragileBp: 10000,
      lifeDamage: s.lifeDamage,
      boss: s.boss,
      act: def.sabotage ? Math.floor(def.sabotage.every / 2) : 0,
      mods: s.mods,
      shield: s.mods & modBit("schermato") ? Math.floor((hp * MOD_RULES.shieldBp) / 10000) : 0,
      mark: 0,
      markBp: 10000,
      sacred: 0,
      summonCd: def.summon ? def.summon.every : 0,
      songCd: def.song ? Math.floor(def.song.every / 2) : 0,
      phase: 0,
      skillCd: def.steal ? def.steal.every : def.charge ? def.charge.every : 0,
      chargeLeft: 0,
    });
  }
  if (n > 0) state.spawns.splice(0, n);
}

function inRange(ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy <= r * r;
}

/** Danno contro un nemico vero: armatura con i modificatori, fragilità, marchio, boss. */
function enemyDamage(e: Enemy, base: number, type: DamageType, pierce: boolean, bossBp: number): number {
  const def = ENEMIES[e.kind];
  const typeBp = pierce ? 10000 : TYPE_BP[type][def.cls];
  const armor = pierce ? 0 : def.armor + (e.mods & modBit("corazzato") ? MOD_RULES.armor : 0);
  const fragile = Math.floor((e.fragileBp * (e.mark > 0 ? e.markBp : 10000)) / 10000);
  let raw = Math.floor((base * typeBp * fragile * ARMOR_K) / (100000000 * (ARMOR_K + armor)));
  if (e.boss && bossBp !== 10000) raw = Math.floor((raw * bossBp) / 10000);
  return Math.max(raw, Math.max(1, Math.floor(base / RULES.minDamageDivisor)));
}

function applyDamage(e: Enemy, dmg: number): number {
  if (e.shield > 0) {
    const taken = Math.min(e.shield, dmg);
    e.shield -= taken;
    dmg -= taken;
  }
  e.hp -= dmg;
  return dmg;
}

function hit(state: GameState, enemy: Enemy, t: Tower, stats: TowerStats, amount: number, events?: GameEvent[]): void {
  const type = TOWERS[t.kind].damageType;
  // Combo tra torri: colpi cinetici su nemici fermi, fulmini su nemici rallentati dal gelo.
  let combo = "";
  if (type === "cinetico" && enemy.stun > 0) {
    amount = Math.floor((amount * 15000) / 10000);
    combo = "Frantumazione";
  } else if (type === "elettrico" && enemy.speedBp < 10000) {
    amount = Math.floor((amount * 14000) / 10000);
    combo = "Scossa";
  }
  if (combo) {
    state.combos += 1;
    events?.push({ e: "combo", x: enemy.x, y: enemy.y, name: combo });
  }
  const dmg = applyDamage(enemy, enemyDamage(enemy, amount, type, stats.pierce, stats.bossBp));
  t.damageDone += dmg;
  if (stats.markTicks > 0) {
    for (const o of state.enemies) {
      if (o === enemy || (stats.markRadius > 0 && o.hp > 0 && inRange(o.x, o.y, enemy.x, enemy.y, stats.markRadius))) {
        o.mark = Math.max(o.mark, stats.markTicks);
        o.markBp = Math.max(o.markBp, stats.markBp);
      }
    }
  }
  if (stats.sacred) enemy.sacred = 20;
  if (stats.stunTicks > 0 && randomInt(state, 10000) < stats.stunChanceBp) {
    enemy.stun = Math.max(enemy.stun, enemy.boss ? Math.floor(stats.stunTicks / 3) : stats.stunTicks);
  }
}

/** Vita dei rinforzi evocati o nati da una divisione, sulla curva della modalità. */
function minionHp(state: GameState, kind: EnemyKind): number {
  const m = modeDef(state.mode, state.night);
  const w = Math.max(1, state.wave);
  const mul = m ? hpMulFor(m, w, 10000) : 10000;
  return Math.floor((hpForWave(ENEMIES[kind].hp, w, Math.floor((mul * state.eventBp) / 10000)) * state.hpScaleBp) / 10000);
}

function newEnemy(state: GameState, kind: EnemyKind, lane: number, dist: number, hp: number, mods: number, offset: number): Enemy {
  const p = lanePoint(levelOf(state), lane, dist);
  const def = ENEMIES[kind];
  return {
    id: state.nextId++, kind, hp, maxHp: hp, lane, dist, x: p.x, y: p.y, offset,
    stun: 0, speedBp: 10000, fragileBp: 10000, lifeDamage: def.lifeDamage, boss: false, act: def.sabotage ? Math.floor(def.sabotage.every / 2) : 0,
    mods, shield: 0, mark: 0, markBp: 10000, sacred: 0, summonCd: def.summon ? def.summon.every : 0, songCd: def.song ? Math.floor(def.song.every / 2) : 0, phase: 0,
    skillCd: def.steal ? def.steal.every : def.charge ? def.charge.every : 0, chargeLeft: 0,
  };
}

function clearDead(state: GameState, events: GameEvent[]): void {
  const alive: Enemy[] = [];
  const born: Enemy[] = [];
  for (const e of state.enemies) {
    if (e.hp > 0) {
      alive.push(e);
      continue;
    }
    const def = ENEMIES[e.kind];
    if (def.split) {
      // Dai minori nasce un gruppo sulla stessa curva; da un boss, pezzi che insieme valgono metà della sua vita.
      const hp = e.boss ? Math.max(1, Math.floor(e.maxHp / (def.split.count * 2))) : minionHp(state, def.split.kind);
      for (let i = 0; i < def.split.count; i++) {
        born.push(newEnemy(state, def.split.kind, e.lane, Math.max(0, e.dist - 200 * i), hp, e.mods & (modBit("agile") | modBit("corazzato")), ((i * 97) % 361) - 180));
      }
      events.push({ e: "split", x: e.x, y: e.y });
    }
    if (def.deathFreeze) {
      stunTowersNear(state, e.x, e.y, def.deathFreeze.range, def.deathFreeze.stun);
      events.push({ e: "frost", x: e.x, y: e.y, radius: def.deathFreeze.range });
    }
    const bounty = def.bounty * (e.boss ? 15 : 1);
    payAll(state, bounty);
    state.kills += 1;
    if (e.boss) state.bossKills += 1;
    events.push({ e: "kill", x: e.x, y: e.y, bounty, boss: e.boss });
  }
  state.enemies = born.length ? alive.concat(born) : alive;
}

/** Una torre vede il nemico? Gli invisibili si vedono solo con il rilevamento. */
export const canSee = (e: Enemy, s: TowerStats) => s.detect || !ENEMIES[e.kind].hidden;

function pickTarget(state: GameState, t: Tower, s: TowerStats): Enemy | null {
  // Un Provocatore nel raggio obbliga la torre a colpire lui.
  let taunt: Enemy | null = null;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !(e.mods & modBit("provocatore")) || !canSee(e, s) || !inRange(t.x, t.y, e.x, e.y, s.range)) continue;
    if (!taunt || e.dist > taunt.dist || (e.dist === taunt.dist && e.id < taunt.id)) taunt = e;
  }
  if (taunt) return taunt;
  const strong = TOWERS[t.kind].target === "strong";
  let target: Enemy | null = null;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !canSee(e, s) || !inRange(t.x, t.y, e.x, e.y, s.range)) continue;
    if (!target) {
      target = e;
      continue;
    }
    const better = strong
      ? e.hp > target.hp || (e.hp === target.hp && (e.dist > target.dist || (e.dist === target.dist && e.id < target.id)))
      : e.dist > target.dist || (e.dist === target.dist && e.id < target.id);
    if (better) target = e;
  }
  return target;
}

function waveIncome(state: GameState, events: GameEvent[]): void {
  // Rendita e interessi vanno a chi possiede l'Officina; le vite sono di tutti.
  const amounts = new Array(playerCount(state)).fill(0) as number[];
  let lives = 0;
  for (const t of state.towers) {
    const s = statsIn(state, t);
    const o = Math.min(t.owner ?? 0, amounts.length - 1);
    if (s.income > 0) amounts[o] += s.income;
    if (s.interestBp > 0) amounts[o] += Math.min(s.interestCap, Math.floor((cashOf(state, o) * s.interestBp) / 10000));
    if (s.lifePerWave > 0) lives += s.lifePerWave;
  }
  const before = state.lives;
  state.lives = Math.min(RULES.startLives, state.lives + lives);
  amounts.forEach((a, o) => addCash(state, o, a));
  const total = amounts.reduce((a, b) => a + b, 0);
  if (total > 0 || state.lives > before) events.push({ e: "income", amount: amounts[0], lives: state.lives - before, amounts });
}

function updateSupport(state: GameState, events: GameEvent[]): void {
  for (const t of state.towers) {
    if (t.stun > 0) t.stun -= 1;
    if (t.immune > 0) t.immune -= 1;
    if (t.abilityCd > 0) t.abilityCd -= 1;
    if (t.abilityLeft > 0) t.abilityLeft -= 1;
    t.bufDamage = 0;
    t.bufRange = 0;
    t.bufHaste = 0;
    t.bufDetect = 0;
  }
  for (const sup of state.towers) {
    if (sup.stun > 0) continue;
    const s = statsIn(state, sup);
    if (sup.kind === "grammofono") {
      if (sup.track === "sconto") continue;
      for (const o of state.towers) {
        if (o === sup || !inRange(sup.x, sup.y, o.x, o.y, s.range)) continue;
        if (sup.track === "danno") o.bufDamage = Math.max(o.bufDamage, s.auraBp);
        else o.bufRange = Math.max(o.bufRange, s.auraBp);
      }
    } else if (sup.kind === "capitano") {
      const haste = s.hasteBp + (sup.abilityLeft > 0 ? s.abilityBp : 0);
      for (const o of state.towers) {
        if (o === sup || !inRange(sup.x, sup.y, o.x, o.y, s.range)) continue;
        o.bufHaste = Math.max(o.bufHaste, haste);
        o.bufDetect = 1;
        if (s.rangeBuffBp) o.bufRange = Math.max(o.bufRange, s.rangeBuffBp);
      }
    } else if (sup.kind === "campana") {
      // Campana del Custode: tutto insieme, e le torri vicine non vengono stordite.
      for (const o of state.towers) {
        if (o === sup || !inRange(sup.x, sup.y, o.x, o.y, s.range)) continue;
        o.bufDamage = Math.max(o.bufDamage, s.auraBp);
        o.bufHaste = Math.max(o.bufHaste, s.hasteBp);
        o.bufRange = Math.max(o.bufRange, s.rangeBuffBp);
        o.bufDetect = 1;
        o.immune = Math.max(o.immune, s.immune);
        o.stun = 0;
      }
    } else if (sup.kind === "medico") {
      if (sup.cooldown > 0) {
        sup.cooldown -= 1;
        continue;
      }
      let healed = false;
      for (const o of state.towers) {
        if (o.stun > 0 && inRange(sup.x, sup.y, o.x, o.y, s.range)) {
          o.stun = 0;
          o.immune = Math.max(o.immune, s.immune);
          healed = true;
        }
      }
      if (healed) {
        sup.cooldown = s.pulse;
        events.push({ e: "heal", x: sup.x, y: sup.y, radius: s.range, all: false });
      }
    }
  }
}

function sabotage(state: GameState, events: GameEvent[]): void {
  for (const e of state.enemies) {
    const sab = ENEMIES[e.kind].sabotage;
    if (!sab || e.stun > 0) continue;
    if (e.act > 0) {
      e.act -= 1;
      continue;
    }
    let target: Tower | null = null;
    let best = 0;
    for (const t of state.towers) {
      if (t.stun > 0 || t.immune > 0) continue;
      const dx = t.x - e.x;
      const dy = t.y - e.y;
      const d = dx * dx + dy * dy;
      if (d > sab.range * sab.range) continue;
      if (!target || d < best || (d === best && t.id < target.id)) {
        target = t;
        best = d;
      }
    }
    if (!target) {
      e.act = 5;
      continue;
    }
    target.stun = sab.stun;
    e.act = sab.every;
    events.push({ e: "sabotage", x: e.x, y: e.y, tx: target.x, ty: target.y });
  }
}

function stunTowersNear(state: GameState, x: number, y: number, range: number, ticks: number): void {
  for (const t of state.towers) {
    if (t.immune > 0 || !inRange(x, y, t.x, t.y, range)) continue;
    t.stun = Math.max(t.stun, ticks);
  }
}

function enemyActs(state: GameState, events: GameEvent[]): void {
  const level = levelOf(state);
  const born: Enemy[] = [];
  for (const e of state.enemies) {
    const def = ENEMIES[e.kind];
    if (e.mark > 0) e.mark -= 1;
    if (e.mark === 0) e.markBp = 10000;
    const steps = def.phases ?? [5000];
    if (def.phaseShieldBp && e.phase < steps.length && e.hp * 10000 <= e.maxHp * steps[e.phase]) {
      e.phase += 1;
      e.shield += Math.floor((e.maxHp * def.phaseShieldBp) / 10000);
      stunTowersNear(state, e.x, e.y, 4000, 40);
      events.push({ e: "roar", x: e.x, y: e.y, radius: 4000 });
    }
    // Rigenerazione: Benedetto o boss, bloccata dai Proiettili sacri.
    const regen = (e.mods & modBit("benedetto") ? MOD_RULES.regenBp : 0) + (def.regenBp ?? 0);
    if (e.sacred > 0) e.sacred -= 1;
    else if (regen > 0 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + Math.max(1, Math.floor((e.maxHp * regen) / 10000)));
    if (e.stun > 0) continue;
    if (def.summon) {
      if (e.summonCd > 0) e.summonCd -= 1;
      else {
        e.summonCd = def.summon.every;
        for (let i = 0; i < def.summon.count; i++) {
          const kind = def.summon.kind;
          const dist = Math.max(0, e.dist - 250 * (i + 1));
          const child = newEnemy(state, kind, e.lane, dist, minionHp(state, kind), e.mods & (modBit("agile") | modBit("corazzato")), (i * 120) % 361 - 180);
          // I boss evocati da un boss non contano come boss.
          child.summonCd = ENEMIES[kind].summon ? ENEMIES[kind].summon!.every * 2 : 0;
          born.push(child);
        }
        events.push({ e: "summon", x: e.x, y: e.y });
      }
    }
    if (def.steal || def.charge) {
      if (e.skillCd > 0) e.skillCd -= 1;
      else if (def.steal) {
        e.skillCd = def.steal.every;
        const amount = Math.min(state.cash, def.steal.amount);
        state.cash -= amount;
        for (const o of state.others) o.cash -= Math.min(o.cash, def.steal.amount);
        events.push({ e: "steal", x: e.x, y: e.y, amount });
      } else if (def.charge) {
        e.skillCd = def.charge.every;
        e.chargeLeft = def.charge.ticks;
        events.push({ e: "charge", x: e.x, y: e.y });
      }
    }
    if (e.chargeLeft > 0) e.chargeLeft -= 1;
    if (def.song) {
      if (e.songCd > 0) e.songCd -= 1;
      else {
        e.songCd = def.song.every;
        stunTowersNear(state, e.x, e.y, def.song.range, def.song.stun);
        events.push({ e: "song", x: e.x, y: e.y, radius: def.song.range });
      }
    }
  }
  if (born.length) state.enemies.push(...born);
}

/** Applica comandi senza avanzare il tempo: equivale a passarli al prossimo step. */
export function applyCommands(state: GameState, commands: Command[]): GameEvent[] {
  const events: GameEvent[] = [];
  for (const c of commands) applyCommand(state, c, events);
  return events;
}

/** Avanza di un tick. I comandi vengono applicati prima di tutto il resto, nell'ordine ricevuto. */
export function step(state: GameState, commands: Command[] = []): GameEvent[] {
  const events: GameEvent[] = [];
  for (const c of commands) applyCommand(state, c, events);
  if (state.phase === "won" || state.phase === "lost") return events;
  const level = levelOf(state);
  const geo = geometry(level);

  state.tick += 1;
  for (const cd of state.others.length ? [state.abilityCd, ...state.others.map((o) => o.abilityCd)] : [state.abilityCd]) {
    if (cd.fascio > 0) cd.fascio -= 1;
    if (cd.gelata > 0) cd.gelata -= 1;
  }

  if (state.phase === "prep") {
    state.prepLeft -= 1;
    if (state.prepLeft <= 0) startWave(state, events);
  }

  spawnDue(state);
  updateSupport(state, events);
  sabotage(state, events);
  enemyActs(state, events);

  // Aure: rallentamento e fragilità vengono ricalcolati a ogni tick.
  for (const e of state.enemies) {
    e.speedBp = 10000;
    e.fragileBp = 10000;
  }
  for (const t of state.towers) {
    if (t.stun > 0) continue;
    const s = effStats(state, t);
    if (s.purify) {
      for (const e of state.enemies) {
        if (!inRange(t.x, t.y, e.x, e.y, s.range) || e.boss) continue;
        e.mods &= modBit("gonfio");
        e.shield = 0;
      }
    }
    if (s.slowBp === 10000 && s.fragileBp === 10000) continue;
    for (const e of state.enemies) {
      if (!inRange(t.x, t.y, e.x, e.y, s.range)) continue;
      if (!ENEMIES[e.kind].slowImmune) e.speedBp = Math.min(e.speedBp, e.boss ? Math.floor((s.slowBp + 10000) / 2) : s.slowBp);
      e.fragileBp = Math.max(e.fragileBp, s.fragileBp);
    }
  }

  // Movimento dei nemici.
  const survivors: Enemy[] = [];
  for (const e of state.enemies) {
    if (e.stun > 0) {
      e.stun -= 1;
    } else {
      let speed = e.mods & modBit("agile") ? Math.floor((ENEMIES[e.kind].speed * MOD_RULES.speedBp) / 10000) : ENEMIES[e.kind].speed;
      if (e.chargeLeft > 0) speed = Math.floor((speed * ENEMIES[e.kind].charge!.speedBp) / 10000);
      e.dist += Math.floor((speed * e.speedBp) / 10000);
    }
    if (e.dist >= geo.lengths[e.lane]) {
      if (!state.god) state.lives = Math.max(0, state.lives - e.lifeDamage);
      state.leaks += 1;
      events.push({ e: "leak", damage: e.lifeDamage });
      continue;
    }
    const p = lanePoint(level, e.lane, e.dist);
    e.x = p.x;
    e.y = p.y;
    survivors.push(e);
  }
  state.enemies = survivors;

  // Attacco delle torri.
  for (const t of state.towers) {
    if (t.cooldown > 0 && t.kind !== "medico") t.cooldown -= 1;
    if (t.stun > 0) continue;
    const s = effStats(state, t);
    if (s.cooldown === 0 || t.cooldown > 0) continue;
    if (s.pulseAll) {
      let any = false;
      for (const e of state.enemies) {
        if (e.hp > 0 && canSee(e, s) && inRange(t.x, t.y, e.x, e.y, s.range)) {
          hit(state, e, t, s, s.damage, events);
          any = true;
        }
      }
      if (any) {
        t.cooldown = s.cooldown;
        events.push({ e: "blast", x: t.x, y: t.y, radius: s.range });
      }
      continue;
    }
    const target = pickTarget(state, t, s);
    if (!target) continue;
    t.cooldown = s.cooldown;
    if (s.radius > 0) {
      // Il colpo cade dove sarà il bersaglio all'atterraggio.
      const lead = Math.floor((ENEMIES[target.kind].speed * target.speedBp) / 10000) * RULES.shellFlightTicks;
      const p = lanePoint(level, target.lane, target.dist + (target.stun > 0 ? 0 : lead));
      const id = state.nextId++;
      state.shells.push({ id, towerId: t.id, x: p.x, y: p.y, land: state.tick + RULES.shellFlightTicks, fired: state.tick, fromX: t.x, fromY: t.y });
      events.push({ e: "shell", from: t.id, id });
    } else if (s.chains > 0) {
      // Fulmine: salta sul nemico più vicino non ancora colpito, perdendo forza a ogni salto.
      const hitIds = new Set<number>([target.id]);
      const points = [t.x, t.y, target.x, target.y];
      let amount = s.damage;
      hit(state, target, t, s, amount, events);
      let current = target;
      for (let j = 0; j < s.chains; j++) {
        let next: Enemy | null = null;
        let bestD = 0;
        for (const e of state.enemies) {
          if (e.hp <= 0 || hitIds.has(e.id) || !canSee(e, s)) continue;
          const dx = e.x - current.x;
          const dy = e.y - current.y;
          const d = dx * dx + dy * dy;
          if (d > CHAIN_JUMP * CHAIN_JUMP) continue;
          if (!next || d < bestD || (d === bestD && e.id < next.id)) {
            next = e;
            bestD = d;
          }
        }
        if (!next) break;
        amount = Math.floor((amount * s.chainBp) / 10000);
        hit(state, next, t, s, amount, events);
        hitIds.add(next.id);
        points.push(next.x, next.y);
        current = next;
      }
      events.push({ e: "zap", from: t.id, points });
    } else {
      hit(state, target, t, s, s.damage, events);
      events.push({ e: "shot", from: t.id, to: target.id, x: t.x, y: t.y, tx: target.x, ty: target.y });
    }
  }

  // Atterraggio dei colpi di mortaio.
  const flying: Shell[] = [];
  for (const shell of state.shells) {
    if (shell.land > state.tick) {
      flying.push(shell);
      continue;
    }
    const t = state.towers.find((x) => x.id === shell.towerId);
    // Se la torre è stata venduta, il colpo in volo cade comunque a vuoto.
    if (!t) continue;
    const s = effStats(state, t);
    for (const e of state.enemies) {
      if (e.hp > 0 && inRange(shell.x, shell.y, e.x, e.y, s.radius)) hit(state, e, t, s, s.damage, events);
    }
    events.push({ e: "blast", x: shell.x, y: shell.y, radius: s.radius });
  }
  state.shells = flying;

  clearDead(state, events);

  // Fine ondata, fine partita.
  if (state.lives <= 0) {
    state.phase = "lost";
    events.push({ e: "end", phase: "lost" });
    return events;
  }
  if (state.phase === "wave" && state.enemies.length === 0 && state.spawns.length === 0) {
    state.cleared = state.wave;
    payAll(state, Math.floor(((RULES.waveBonusBase + RULES.waveBonusStep * state.wave) * level.waveBonusBp) / 10000));
    waveIncome(state, events);
    if (state.mode !== "infinita" && state.wave >= waveCount(state)) {
      state.phase = "won";
      events.push({ e: "end", phase: "won" });
      return events;
    }
    state.phase = "prep";
    state.prepCount += 1;
    state.prepLeft = RULES.prepTicks;
  }
  return events;
}

export function starsFor(lives: number): number {
  if (lives >= 18) return 3;
  if (lives >= 10) return 2;
  return lives > 0 ? 1 : 0;
}

// ---------- hash e snapshot ----------

/** Impronta FNV-1a dello stato: due dispositivi sincronizzati devono ottenere lo stesso valore. */
export function hashState(state: GameState): string {
  let h = 0x811c9dc5 | 0;
  const mix = (v: number) => {
    h = Math.imul(h ^ (v | 0), 16777619);
  };
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  mix(state.rng);
  str(state.mode);
  str(state.levelId);
  mix(state.tick);
  str(state.phase);
  mix(state.wave);
  mix(state.cleared);
  mix(state.prepLeft);
  mix(state.prepCount);
  mix(state.cash);
  mix(state.lives);
  mix(state.nextId);
  mix(state.kills);
  mix(state.leaks);
  mix(state.adminTouched ? 1 : 0);
  mix(state.sandbox ? 1 : 0);
  mix(state.god ? 1 : 0);
  mix(state.combos);
  mix(state.abilitiesUsed);
  mix(state.apexBuilt);
  mix(state.bossKills);
  mix(state.night);
  mix(state.eventBp);
  for (const k of state.allowed) str(k);
  for (const k of TOWER_ORDER) mix(state.ranks[k]);
  mix(state.abilityCd.fascio);
  mix(state.abilityCd.gelata);
  mix(state.hpScaleBp);
  for (const o of state.others) {
    mix(o.cash);
    mix(o.abilityCd.fascio);
    mix(o.abilityCd.gelata);
    for (const k of o.allowed) str(k);
    for (const k of TOWER_ORDER) mix(o.ranks[k]);
  }
  for (const e of state.enemies) {
    mix(e.id);
    str(e.kind);
    mix(e.hp);
    mix(e.lane);
    mix(e.dist);
    mix(e.stun);
    mix(e.act);
    mix(e.mods);
    mix(e.shield);
    mix(e.mark);
    mix(e.sacred);
    mix(e.summonCd);
    mix(e.songCd);
    mix(e.phase);
    mix(e.speedBp);
    mix(e.fragileBp);
    mix(e.skillCd);
    mix(e.chargeLeft);
  }
  for (const t of state.towers) {
    mix(t.id);
    str(t.kind);
    mix(t.cx);
    mix(t.cy);
    mix(t.level);
    str(t.branch ?? "-");
    mix(t.cooldown);
    mix(t.invested);
    mix(t.stun);
    mix(t.immune);
    str(t.track);
    mix(t.abilityCd);
    mix(t.abilityLeft);
    mix(t.owner);
    mix(t.rank);
  }
  for (const s of state.shells) {
    mix(s.id);
    mix(s.x);
    mix(s.y);
    mix(s.land);
  }
  for (const s of state.spawns) {
    mix(s.tick);
    str(s.enemy);
    mix(s.lane);
    mix(s.mods);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function snapshot(state: GameState): string {
  return JSON.stringify(state);
}

export function restore(data: string): GameState {
  return JSON.parse(data) as GameState;
}

/** Controllo di sicurezza usato dai test: lo stato non deve mai contenere numeri non interi. */
export function allIntegers(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.every(allIntegers);
  if (value && typeof value === "object") return Object.values(value).every(allIntegers);
  return true;
}
