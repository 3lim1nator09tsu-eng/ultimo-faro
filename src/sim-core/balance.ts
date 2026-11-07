// Bilanciamento modificabile dal pannello admin: torri, modalità e mappe.
// Si parte sempre dai valori scritti nel codice, poi si applicano i livelli in ordine
// (globale dal server, poi le prove locali dell'admin). Lo stesso insieme di valori
// va dato a tutti i dispositivi di una partita, altrimenti la simulazione diverge.
import { Branch, EVENT_LEVELS, LEVELS, TOWERS, TOWER_ORDER, TowerKind, TowerStats } from "./content";
import { HARDCORE, ModeDef, NIGHTS, NightDef, SURVIVAL, clearModeCache } from "./modes";

export type LevelKey = "1" | "2" | "3" | Branch | "A2" | "B2";
export interface TowerOv {
  kind: TowerKind;
  lvl: LevelKey;
  field: keyof TowerStats | "cost";
  value: number;
}
export interface ModeOv {
  mode: string; // "easy", "hardcore", "natale:3"
  field: string; // uno di MODE_FIELDS, oppure "mapHp:<mappa>"
  value: number;
}
export interface MapOv {
  map: string;
  field: "survivalHpBp" | "startCash";
  value: number;
}
export interface Balance {
  towers: TowerOv[];
  modes: ModeOv[];
  maps: MapOv[];
}

export const emptyBalance = (): Balance => ({ towers: [], modes: [], maps: [] });

export type Unit = "n" | "tile" | "tick" | "pct" | "slow" | "bp";

/** Campi delle torri, con unità leggibili. */
export const TOWER_FIELDS: Array<{ field: TowerOv["field"]; label: string; unit: Unit }> = [
  { field: "cost", label: "Costo", unit: "n" },
  { field: "damage", label: "Danno", unit: "n" },
  { field: "cooldown", label: "Ricarica (tick, 10 = 1 s)", unit: "tick" },
  { field: "range", label: "Gittata (caselle)", unit: "tile" },
  { field: "radius", label: "Area (caselle)", unit: "tile" },
  { field: "chains", label: "Salti del fulmine", unit: "n" },
  { field: "slowBp", label: "Rallentamento (%)", unit: "slow" },
  { field: "income", label: "Rendita", unit: "n" },
  { field: "auraBp", label: "Bonus disco (%)", unit: "pct" },
  { field: "hasteBp", label: "Cadenza in più (%)", unit: "pct" },
  { field: "pulse", label: "Cura ogni (tick)", unit: "tick" },
  { field: "immune", label: "Protezione (tick)", unit: "tick" },
  { field: "markBp", label: "Marchio (% danno subito)", unit: "pct" },
  { field: "stunChanceBp", label: "Probabilità stordimento (%)", unit: "pct" },
  { field: "spawnEvery", label: "Scagnozzo ogni (tick)", unit: "tick" },
  { field: "spawnMax", label: "Scagnozzi in campo", unit: "n" },
  { field: "unitBp", label: "Forza scagnozzi (%)", unit: "pct" },
];

/** Campi delle modalità. "bp" si mostra in percentuale (10000 = 100%). */
export const MODE_FIELDS: Array<{ field: string; label: string; unit: Unit; max: number }> = [
  { field: "hpBp", label: "Vita dei nemici (%)", unit: "bp", max: 1000000 },
  { field: "countBp", label: "Quantità di nemici (%)", unit: "bp", max: 100000 },
  { field: "curveA", label: "Crescita lineare della vita", unit: "n", max: 100000 },
  { field: "curveB", label: "Crescita quadratica della vita", unit: "n", max: 10000 },
  { field: "bossHpBp", label: "Vita del boss finale (%)", unit: "bp", max: 10000000 },
  { field: "minisBp", label: "Vita dei mini-boss (% dei valori base)", unit: "bp", max: 1000000 },
  { field: "maxGroups", label: "Gruppi per ondata", unit: "n", max: 8 },
  { field: "modsFrom", label: "Modificatori dall'ondata (0 = mai)", unit: "n", max: 100 },
  { field: "doubleModsFrom", label: "Doppi modificatori dall'ondata (0 = mai)", unit: "n", max: 100 },
  { field: "lives", label: "Vite iniziali", unit: "n", max: 999 },
  { field: "bonusCash", label: "Cash iniziale in più", unit: "n", max: 100000 },
  { field: "scheggeWave", label: "Schegge per ondata", unit: "n", max: 10000 },
  { field: "scheggeWin", label: "Schegge per la vittoria", unit: "n", max: 100000 },
  { field: "perleWave", label: "Perle per ondata", unit: "n", max: 1000 },
  { field: "perleWin", label: "Perle per la vittoria", unit: "n", max: 10000 },
  { field: "perleBoss", label: "Perle per boss", unit: "n", max: 1000 },
];

export const MAP_FIELDS: Array<{ field: MapOv["field"]; label: string; unit: Unit; max: number }> = [
  { field: "survivalHpBp", label: "Vita dei nemici su questa mappa (%)", unit: "bp", max: 100000 },
  { field: "startCash", label: "Cash iniziale della mappa", unit: "n", max: 100000 },
];

export function toShown(unit: Unit, v: number): number {
  if (unit === "tile") return v / 1000;
  if (unit === "pct" || unit === "bp") return Math.round(v) / 100;
  if (unit === "slow") return Math.round(10000 - v) / 100;
  return v;
}

export function fromShown(unit: Unit, v: number): number {
  if (unit === "tile") return Math.round(v * 1000);
  if (unit === "pct" || unit === "bp") return Math.round(v * 100);
  if (unit === "slow") return 10000 - Math.round(v * 100);
  return Math.round(v);
}

// ---------- modalità ----------

export const ALL_MODES: ModeDef[] = [...SURVIVAL, HARDCORE, ...NIGHTS];
export const modeKey = (m: ModeDef) => (m.id === "natale" ? `natale:${(m as NightDef).night}` : m.id);
export const modeByKey = (k: string) => ALL_MODES.find((m) => modeKey(m) === k) ?? null;
const ALL_MAPS = [...LEVELS, ...EVENT_LEVELS];

// Alcuni oggetti sono condivisi tra modalità (le Perle a zero): ognuna deve avere i suoi.
for (const m of ALL_MODES) {
  m.schegge = { ...m.schegge };
  m.perle = { ...m.perle };
  m.boss = { ...m.boss };
  m.minis = m.minis.map((x) => ({ ...x }));
}

interface ModeSnap {
  scalars: Record<string, number | undefined>;
  boss: number;
  minis: number[];
  schegge: { perWave: number; win: number };
  perle: { perWave: number; win: number; boss: number };
  mapHpBp?: Record<string, number>;
}
const SCALARS = ["hpBp", "countBp", "curveA", "curveB", "maxGroups", "modsFrom", "doubleModsFrom", "lives", "bonusCash"] as const;
const MODE_BASE = new Map<ModeDef, ModeSnap>(
  ALL_MODES.map((m) => [
    m,
    {
      scalars: Object.fromEntries(SCALARS.map((k) => [k, (m as unknown as Record<string, number | undefined>)[k]])),
      boss: m.boss.hpBp,
      minis: m.minis.map((x) => x.hpBp),
      schegge: { ...m.schegge },
      perle: { ...m.perle },
      mapHpBp: m.mapHpBp ? { ...m.mapHpBp } : undefined,
    },
  ]),
);
const MAP_BASE = new Map(ALL_MAPS.map((l) => [l, { survivalHpBp: l.survivalHpBp, startCash: l.startCash }]));
const TOWER_BASE = JSON.parse(JSON.stringify(TOWERS)) as typeof TOWERS;

/** Valore di un campo della modalità come lo vede il gioco adesso. */
export function modeValue(m: ModeDef, field: string): number {
  if (field.startsWith("mapHp:")) return m.mapHpBp?.[field.slice(6)] ?? 10000;
  switch (field) {
    case "bossHpBp":
      return m.boss.hpBp;
    case "minisBp": {
      const base = MODE_BASE.get(m)!.minis;
      return base.length && base[0] ? Math.round((m.minis[0].hpBp * 10000) / base[0]) : 10000;
    }
    case "scheggeWave":
      return m.schegge.perWave;
    case "scheggeWin":
      return m.schegge.win;
    case "perleWave":
      return m.perle.perWave;
    case "perleWin":
      return m.perle.win;
    case "perleBoss":
      return m.perle.boss;
    case "countBp":
      return m.countBp ?? 10000;
    default:
      return (m as unknown as Record<string, number>)[field] ?? 0;
  }
}

/** Valore originale scritto nel codice. */
export function modeBaseValue(m: ModeDef, field: string): number {
  const b = MODE_BASE.get(m)!;
  if (field.startsWith("mapHp:")) return b.mapHpBp?.[field.slice(6)] ?? 10000;
  switch (field) {
    case "bossHpBp":
      return b.boss;
    case "minisBp":
      return 10000;
    case "scheggeWave":
      return b.schegge.perWave;
    case "scheggeWin":
      return b.schegge.win;
    case "perleWave":
      return b.perle.perWave;
    case "perleWin":
      return b.perle.win;
    case "perleBoss":
      return b.perle.boss;
    case "countBp":
      return b.scalars.countBp ?? 10000;
    default:
      return b.scalars[field] ?? 0;
  }
}

function setMode(m: ModeDef, field: string, v: number) {
  if (field.startsWith("mapHp:")) {
    m.mapHpBp = { ...(m.mapHpBp ?? {}), [field.slice(6)]: v };
    return;
  }
  const base = MODE_BASE.get(m)!;
  switch (field) {
    case "bossHpBp":
      m.boss.hpBp = v;
      break;
    case "minisBp":
      m.minis.forEach((x, i) => (x.hpBp = Math.max(1000, Math.floor((base.minis[i] * v) / 10000))));
      break;
    case "scheggeWave":
      m.schegge.perWave = v;
      break;
    case "scheggeWin":
      m.schegge.win = v;
      break;
    case "perleWave":
      m.perle.perWave = v;
      break;
    case "perleWin":
      m.perle.win = v;
      break;
    case "perleBoss":
      m.perle.boss = v;
      break;
    default:
      (m as unknown as Record<string, number>)[field] = v;
  }
}

// ---------- torri ----------

export function levelRef(kind: TowerKind, lvl: LevelKey, defs: typeof TOWERS = TOWERS): Record<string, number> | null {
  const def = defs[kind];
  if (!def) return null;
  if (lvl === "A2" || lvl === "B2") return (def.branches2?.[lvl[0] as Branch] as unknown as Record<string, number>) ?? null;
  if (lvl === "A" || lvl === "B") return def.branches[lvl] as unknown as Record<string, number>;
  return (def.levels[Number(lvl) - 1] as unknown as Record<string, number>) ?? null;
}
export const towerBaseValue = (o: Pick<TowerOv, "kind" | "lvl" | "field">) => levelRef(o.kind, o.lvl, TOWER_BASE)?.[o.field as string] ?? 0;

// ---------- validazione e applicazione ----------

const LEVEL_KEYS: LevelKey[] = ["1", "2", "3", "A", "B", "A2", "B2"];
const TOWER_FIELD_SET = new Set(TOWER_FIELDS.map((f) => f.field as string));
const MODE_FIELD_MAX = new Map(MODE_FIELDS.map((f) => [f.field, f.max]));
const fin = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

/** Tiene solo voci valide: i dati arrivano dal server o dal salvataggio. */
export function cleanBalance(raw: unknown): Balance {
  const out = emptyBalance();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (Array.isArray(r.towers))
    for (const o of r.towers as TowerOv[]) {
      if (!o || !TOWER_ORDER.includes(o.kind) || !LEVEL_KEYS.includes(o.lvl) || !TOWER_FIELD_SET.has(o.field as string) || !fin(o.value, 0, 10_000_000)) continue;
      if (!levelRef(o.kind, o.lvl, TOWER_BASE)) continue;
      out.towers.push({ kind: o.kind, lvl: o.lvl, field: o.field, value: Math.round(o.value) });
    }
  if (Array.isArray(r.modes))
    for (const o of r.modes as ModeOv[]) {
      if (!o || typeof o.mode !== "string" || !modeByKey(o.mode) || typeof o.field !== "string") continue;
      const mapField = o.field.startsWith("mapHp:") && ALL_MAPS.some((l) => l.id === o.field.slice(6));
      const max = mapField ? 100000 : MODE_FIELD_MAX.get(o.field);
      if (max === undefined || !fin(o.value, 0, max)) continue;
      out.modes.push({ mode: o.mode, field: o.field, value: Math.round(o.value) });
    }
  if (Array.isArray(r.maps))
    for (const o of r.maps as MapOv[]) {
      if (!o || !ALL_MAPS.some((l) => l.id === o.map) || !MAP_FIELDS.some((f) => f.field === o.field) || !fin(o.value, 0, 100000)) continue;
      out.maps.push({ map: o.map, field: o.field, value: Math.round(o.value) });
    }
  return out;
}

/** Unisce più livelli: a parità di campo vince l'ultimo. */
export function mergeBalance(...layers: Balance[]): Balance {
  const t = new Map<string, TowerOv>();
  const m = new Map<string, ModeOv>();
  const p = new Map<string, MapOv>();
  for (const b of layers) {
    for (const o of b.towers) t.set(`${o.kind}|${o.lvl}|${String(o.field)}`, o);
    for (const o of b.modes) m.set(`${o.mode}|${o.field}`, o);
    for (const o of b.maps) p.set(`${o.map}|${o.field}`, o);
  }
  return { towers: [...t.values()], modes: [...m.values()], maps: [...p.values()] };
}

/** Toglie le voci uguali al valore originale: restano solo le modifiche vere. */
export function pruneBalance(b: Balance): Balance {
  return {
    towers: b.towers.filter((o) => towerBaseValue(o) !== o.value),
    modes: b.modes.filter((o) => modeBaseValue(modeByKey(o.mode)!, o.field) !== o.value),
    maps: b.maps.filter((o) => {
      const base = MAP_BASE.get(ALL_MAPS.find((l) => l.id === o.map)!)!;
      return (base[o.field] ?? (o.field === "survivalHpBp" ? 10000 : 0)) !== o.value;
    }),
  };
}

export const mapBaseValue = (map: string, field: MapOv["field"]) => {
  const l = ALL_MAPS.find((x) => x.id === map);
  const b = l ? MAP_BASE.get(l) : undefined;
  return (b?.[field] ?? (field === "survivalHpBp" ? 10000 : 0)) as number;
};
export const mapValue = (map: string, field: MapOv["field"]) => {
  const l = ALL_MAPS.find((x) => x.id === map);
  return (l?.[field] ?? (field === "survivalHpBp" ? 10000 : 0)) as number;
};

/** Riporta tutto ai valori del codice e applica i livelli dati, in ordine. */
export function applyBalance(...layers: Balance[]): void {
  for (const k of TOWER_ORDER) {
    const b = TOWER_BASE[k];
    const t = TOWERS[k];
    t.levels.forEach((l, i) => Object.assign(l, b.levels[i]));
    Object.assign(t.branches.A, b.branches.A);
    Object.assign(t.branches.B, b.branches.B);
    if (t.branches2 && b.branches2) {
      Object.assign(t.branches2.A, b.branches2.A);
      Object.assign(t.branches2.B, b.branches2.B);
    }
  }
  for (const [m, s] of MODE_BASE) {
    for (const k of SCALARS) {
      if (s.scalars[k] === undefined) delete (m as unknown as Record<string, unknown>)[k];
      else (m as unknown as Record<string, number>)[k] = s.scalars[k]!;
    }
    m.boss.hpBp = s.boss;
    m.minis.forEach((x, i) => (x.hpBp = s.minis[i]));
    Object.assign(m.schegge, s.schegge);
    Object.assign(m.perle, s.perle);
    m.mapHpBp = s.mapHpBp ? { ...s.mapHpBp } : undefined;
  }
  for (const [l, s] of MAP_BASE) {
    l.startCash = s.startCash;
    if (s.survivalHpBp === undefined) delete l.survivalHpBp;
    else l.survivalHpBp = s.survivalHpBp;
  }
  const all = mergeBalance(...layers);
  for (const o of all.towers) {
    const ref = levelRef(o.kind, o.lvl);
    if (ref) ref[o.field as string] = o.value;
  }
  for (const o of all.modes) {
    const m = modeByKey(o.mode);
    if (m) setMode(m, o.field, o.value);
  }
  for (const o of all.maps) {
    const l = ALL_MAPS.find((x) => x.id === o.map);
    if (l) (l as unknown as Record<string, number>)[o.field] = o.value;
  }
  clearModeCache();
}

/** Firma breve dell'insieme di valori: due dispositivi con la stessa firma giocano la stessa partita. */
export function balanceSig(b: Balance): string {
  const s = JSON.stringify(mergeBalance(b));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

export const balanceSize = (b: Balance) => b.towers.length + b.modes.length + b.maps.length;
