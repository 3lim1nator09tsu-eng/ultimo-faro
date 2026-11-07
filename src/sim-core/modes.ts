// Modalità di sopravvivenza, Hardcore e Notti di Natale: le ondate sono generate da una ricetta
// fissa, quindi ogni dispositivo ottiene le stesse ondate senza scaricarle.
import { ENEMIES, EnemyKind, GameMode, LEVELS, LevelDef, Mod, RULES, WaveGroup, hardcoreWaves, levelById, waveAt } from "./content";

export interface PoolEntry {
  kind: EnemyKind;
  from: number; // prima ondata (da 1)
  count: number; // quanti alla prima ondata
  step: number; // quanti in più a ogni ondata, in centesimi
  interval: number; // tick tra uno e l'altro
}

export interface BossStep {
  wave: number;
  kind: EnemyKind;
  hpBp: number; // vita rispetto alla curva della modalità
  mods?: Mod[];
}

export interface ModeDef {
  id: GameMode;
  name: string;
  sub: string;
  color: string;
  waves: number;
  lives: number;
  bonusCash: number;
  curveA: number; // crescita della vita: 10000 + A·w + B·w², in punti base
  curveB: number;
  hpBp: number;
  pool: PoolEntry[];
  maxGroups: number;
  modsFrom: number; // 0 = nessun modificatore
  modList: Mod[][];
  doubleModsFrom: number;
  minis: BossStep[];
  boss: BossStep; // boss finale, nell'ultima ondata
  schegge: { perWave: number; win: number };
  perle: { perWave: number; win: number; boss: number };
  unlock: GameMode | null; // modalità da vincere prima
  maps: string[];
}

export interface NightDef extends ModeDef {
  night: number;
  map: string;
}

const e = (kind: EnemyKind, from: number, count: number, step: number, interval: number): PoolEntry => ({ kind, from, count, step, interval });
const ALL_MAPS = LEVELS.map((l) => l.id);
const NO_PERLE = { perWave: 0, win: 0, boss: 0 };

const MODS_MILD: Mod[][] = [["agile"], ["corazzato"], ["gonfio"], ["schermato"]];
const MODS_HARD: Mod[][] = [["agile"], ["gonfio"], ["corazzato"], ["benedetto"], ["provocatore"], ["schermato"], ["agile", "gonfio"], ["benedetto", "corazzato"], ["provocatore", "schermato"]];

export const SURVIVAL: ModeDef[] = [
  {
    id: "easy",
    name: "Easy",
    sub: "20 ondate. Il Grande Bruto alla fine.",
    color: "#9fd28b",
    waves: 20,
    lives: 20,
    bonusCash: 0,
    curveA: 700,
    curveB: 25,
    hpBp: 8000,
    pool: [e("risacca", 1, 8, 80, 10), e("corridore", 3, 6, 60, 8), e("bruto", 5, 2, 35, 22), e("sabotatore", 12, 2, 15, 30)],
    maxGroups: 3,
    modsFrom: 0,
    modList: [],
    doubleModsFrom: 0,
    minis: [{ wave: 10, kind: "bruto", hpBp: 40000 }],
    boss: { wave: 20, kind: "bruto", hpBp: 100000 },
    schegge: { perWave: 6, win: 80 },
    perle: NO_PERLE,
    unlock: null,
    maps: ALL_MAPS,
  },
  {
    id: "medium",
    name: "Medium",
    sub: "25 ondate. I primi modificatori. Il Capitano Annegato.",
    color: "#ffe296",
    waves: 25,
    lives: 20,
    bonusCash: 0,
    curveA: 900,
    curveB: 35,
    hpBp: 9000,
    pool: [e("risacca", 1, 9, 90, 9), e("corridore", 2, 6, 70, 8), e("bruto", 4, 2, 40, 20), e("sabotatore", 6, 2, 20, 28)],
    maxGroups: 3,
    modsFrom: 15,
    modList: MODS_MILD,
    doubleModsFrom: 0,
    minis: [
      { wave: 12, kind: "bruto", hpBp: 60000 },
      { wave: 20, kind: "sirena", hpBp: 45000 },
    ],
    boss: { wave: 25, kind: "annegato", hpBp: 110000 },
    schegge: { perWave: 8, win: 120 },
    perle: NO_PERLE,
    unlock: "easy",
    maps: ALL_MAPS,
  },
  {
    id: "molten",
    name: "Molten",
    sub: "30 ondate di fuoco. I Tizzoni non si rallentano. Il Colosso di Brace.",
    color: "#e2714f",
    waves: 30,
    lives: 20,
    bonusCash: 100,
    curveA: 1000,
    curveB: 40,
    hpBp: 10000,
    pool: [e("risacca", 1, 8, 80, 9), e("tizzone", 1, 5, 70, 8), e("corridore", 3, 6, 60, 8), e("magmatico", 6, 2, 30, 24), e("bruto", 8, 2, 35, 20), e("sabotatore", 10, 2, 20, 26)],
    maxGroups: 3,
    modsFrom: 12,
    modList: MODS_MILD,
    doubleModsFrom: 0,
    minis: [
      { wave: 15, kind: "annegato", hpBp: 70000 },
      { wave: 25, kind: "colosso", hpBp: 40000 },
    ],
    boss: { wave: 30, kind: "colosso", hpBp: 140000 },
    schegge: { perWave: 10, win: 180 },
    perle: NO_PERLE,
    unlock: "medium",
    maps: ALL_MAPS,
  },
  {
    id: "fallen",
    name: "Fallen",
    sub: "35 ondate. Spettri invisibili: servono Cecchino, Capitano o torri Hardcore. Il Re Caduto.",
    color: "#c9b8ff",
    waves: 35,
    lives: 20,
    bonusCash: 150,
    curveA: 1100,
    curveB: 45,
    hpBp: 10500,
    pool: [e("risacca", 1, 9, 80, 9), e("spettro", 3, 3, 50, 12), e("cavaliere", 6, 2, 30, 24), e("bruto", 5, 2, 35, 20), e("sabotatore", 8, 2, 20, 26), e("tizzone", 10, 5, 60, 8), e("magmatico", 14, 2, 25, 24)],
    maxGroups: 3,
    modsFrom: 8,
    modList: MODS_HARD,
    doubleModsFrom: 0,
    minis: [
      { wave: 17, kind: "colosso", hpBp: 45000 },
      { wave: 28, kind: "recaduto", hpBp: 40000 },
    ],
    boss: { wave: 35, kind: "recaduto", hpBp: 150000 },
    schegge: { perWave: 12, win: 250 },
    perle: NO_PERLE,
    unlock: "molten",
    maps: ALL_MAPS,
  },
  {
    id: "frost",
    name: "Frost",
    sub: "40 ondate di gelo. I Brinati congelano le torri quando muoiono. La Regina dell'Inverno.",
    color: "#a5e4ec",
    waves: 40,
    lives: 20,
    bonusCash: 200,
    curveA: 1200,
    curveB: 50,
    hpBp: 11800,
    pool: [e("risacca", 1, 9, 80, 9), e("brinato", 2, 3, 50, 14), e("corridore", 3, 6, 60, 8), e("orso", 6, 1, 25, 30), e("spettro", 8, 3, 45, 12), e("sabotatore", 10, 2, 20, 26), e("cavaliere", 12, 2, 25, 24)],
    maxGroups: 3,
    modsFrom: 6,
    modList: MODS_HARD,
    doubleModsFrom: 25,
    minis: [
      { wave: 20, kind: "recaduto", hpBp: 35000 },
      { wave: 32, kind: "regina", hpBp: 45000 },
    ],
    boss: { wave: 40, kind: "regina", hpBp: 160000 },
    schegge: { perWave: 14, win: 350 },
    perle: NO_PERLE,
    unlock: "fallen",
    maps: ALL_MAPS,
  },
];

export const HARDCORE: ModeDef = {
  id: "hardcore",
  name: "Hardcore",
  sub: "50 ondate, modificatori ovunque, 10 vite. Il Leviatano. Dà le Perle Nere.",
  color: "#e2714f",
  waves: 50,
  lives: RULES.hardcoreLives,
  bonusCash: RULES.hardcoreCash,
  curveA: 1300,
  curveB: 55,
  hpBp: 11500,
  pool: [
    e("risacca", 1, 9, 80, 9), e("corridore", 2, 6, 60, 8), e("bruto", 4, 2, 35, 20), e("sabotatore", 6, 2, 20, 26),
    e("tizzone", 8, 5, 60, 8), e("magmatico", 12, 2, 25, 24), e("spettro", 16, 3, 45, 12), e("cavaliere", 20, 2, 25, 24),
    e("brinato", 24, 3, 40, 14), e("orso", 28, 1, 20, 30),
  ],
  maxGroups: 3,
  modsFrom: 2,
  modList: MODS_HARD,
  doubleModsFrom: 15,
  minis: [
    { wave: 10, kind: "bruto", hpBp: 80000, mods: ["benedetto"] },
    { wave: 20, kind: "colosso", hpBp: 55000 },
    { wave: 30, kind: "recaduto", hpBp: 55000 },
    { wave: 40, kind: "regina", hpBp: 60000 },
  ],
  boss: { wave: 50, kind: "leviatano", hpBp: 180000 },
  schegge: { perWave: 10, win: 400 },
  perle: { perWave: 1, win: 50, boss: 5 },
  unlock: "molten",
  maps: ALL_MAPS,
};

// Notti di Natale. Volutamente quasi impossibili: il Disgelo le ammorbidisce durante dicembre.
const NIGHT_POOL: PoolEntry[] = [
  e("elfo", 1, 6, 70, 7), e("pupazzetto", 1, 3, 45, 16), e("brinato", 3, 3, 45, 14), e("corridore", 4, 6, 60, 7),
  e("orso", 6, 1, 25, 28), e("spettro", 8, 3, 45, 11), e("cavaliere", 10, 2, 25, 22), e("sabotatore", 12, 2, 20, 24),
];
const night = (n: number, map: string, waves: number, boss: BossStep, minis: BossStep[], name: string, sub: string): NightDef => ({
  id: "natale",
  night: n,
  map,
  name,
  sub,
  color: "#ff9a9a",
  waves,
  lives: 10,
  bonusCash: 250,
  curveA: 800 + 40 * n,
  curveB: 70 + 8 * n,
  hpBp: 10500 + 300 * n,
  pool: NIGHT_POOL,
  maxGroups: 3 + (n >= 4 ? 1 : 0),
  modsFrom: 3,
  modList: MODS_HARD,
  doubleModsFrom: 12,
  minis,
  boss,
  schegge: { perWave: 15, win: 300 + 100 * n },
  perle: { perWave: 1, win: 20 + 10 * n, boss: 5 },
  unlock: null,
  maps: [map],
});

export const NIGHTS: NightDef[] = [
  night(1, "porto", 20, { wave: 20, kind: "folletto", hpBp: 150000 }, [{ wave: 10, kind: "pupazzetto", hpBp: 50000 }], "Notte 1 · La Vigilia Rubata", "Il Folletto Ladro ruba il cash mentre avanza."),
  night(2, "foce", 25, { wave: 25, kind: "renna", hpBp: 65000 }, [{ wave: 12, kind: "folletto", hpBp: 60000 }], "Notte 2 · Zoccoli sul Ghiaccio", "La Renna Nera scatta all'improvviso."),
  night(3, "marea", 30, { wave: 30, kind: "pupazzo", hpBp: 480000 }, [{ wave: 15, kind: "renna", hpBp: 70000 }], "Notte 3 · Neve che Cammina", "Il Pupazzo Colossale si spezza in sei."),
  night(4, "foce", 35, { wave: 35, kind: "befana", hpBp: 620000 }, [{ wave: 17, kind: "pupazzo", hpBp: 70000 }, { wave: 28, kind: "folletto", hpBp: 90000 }], "Notte 4 · Scope nel Buio", "La Befana vola invisibile: serve chi la vede."),
  night(5, "crocevia", 40, { wave: 40, kind: "krampus", hpBp: 600000 }, [
    { wave: 10, kind: "folletto", hpBp: 80000 },
    { wave: 20, kind: "renna", hpBp: 90000 },
    { wave: 28, kind: "pupazzo", hpBp: 90000 },
    { wave: 34, kind: "befana", hpBp: 100000 },
  ], "Notte 5 · Il Gran Finale", "Krampus, e tutti quelli che lo hanno preceduto."),
];

export const SURVIVAL_IDS: GameMode[] = SURVIVAL.map((m) => m.id);
export const isSurvival = (mode: GameMode) => SURVIVAL_IDS.includes(mode);

/** La ricetta della modalità; null per Campagna e Infinita, che usano le ondate scritte a mano. */
export function modeDef(mode: GameMode, nightN = 1): ModeDef | null {
  if (mode === "hardcore") return HARDCORE;
  if (mode === "natale") return NIGHTS[Math.max(1, Math.min(NIGHTS.length, nightN)) - 1];
  return SURVIVAL.find((m) => m.id === mode) ?? null;
}

// ---------- Disgelo ----------

/** Quanto è dura l'evento in una data: piena forza fino a novembre, poi cala ogni settimana di dicembre. */
export const DISGELO_STEPS: Array<{ day: number; bp: number; label: string }> = [
  { day: 0, bp: 10000, label: "Gelo pieno" },
  { day: 1, bp: 8800, label: "Primo disgelo" },
  { day: 8, bp: 7800, label: "Secondo disgelo" },
  { day: 15, bp: 6800, label: "Terzo disgelo" },
  { day: 22, bp: 6000, label: "Disgelo di Natale" },
];

export function disgeloFor(year: number, month: number, day: number): { bp: number; label: string; next: string | null } {
  // Prima di dicembre 2026: gelo pieno. Da gennaio 2027 resta al livello più basso.
  let idx = 0;
  if (year > 2026 || (year === 2026 && month === 12)) {
    const d = year > 2026 ? 99 : day;
    for (let i = 0; i < DISGELO_STEPS.length; i++) if (d >= DISGELO_STEPS[i].day && DISGELO_STEPS[i].day > 0) idx = i;
  }
  const nextStep = DISGELO_STEPS[idx + 1];
  return { bp: DISGELO_STEPS[idx].bp, label: DISGELO_STEPS[idx].label, next: nextStep ? `${nextStep.day} dicembre` : null };
}

// ---------- generatore di ondate ----------

const growth = (w: number) => 10000 + RULES.hpGrowthA * w + RULES.hpGrowthB * w * w;
const target = (m: ModeDef, w: number) => 10000 + m.curveA * w + m.curveB * w * w;
/** Moltiplicatore da dare allo spawn perché la vita segua la curva della modalità. */
export const hpMulFor = (m: ModeDef, w: number, bp: number) => Math.max(1000, Math.floor((Math.floor((bp * target(m, w)) / growth(w)) * m.hpBp) / 10000));

const cache = new Map<string, WaveGroup[][]>();

export function modeWaves(m: ModeDef, level: LevelDef): WaveGroup[][] {
  const key = `${m.id}:${(m as NightDef).night ?? 0}:${level.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const lanes = level.map.lanes.length;
  const out: WaveGroup[][] = [];
  for (let w = 1; w <= m.waves; w++) {
    const avail = m.pool.filter((p) => p.from <= w);
    // Il nemico appena arrivato compare per tre ondate di fila, gli altri a rotazione.
    const fresh = avail.filter((p) => w - p.from < 3).sort((a, b) => b.from - a.from);
    const chosen: PoolEntry[] = [...fresh.slice(0, 1)];
    const k = Math.min(avail.length, m.maxGroups + Math.floor(w / 20));
    for (let j = 0; chosen.length < k && j < avail.length; j++) {
      const p = avail[(w * 7 + j) % avail.length];
      if (!chosen.includes(p)) chosen.push(p);
    }
    const groups: WaveGroup[] = chosen.map((p, j) => ({
      enemy: p.kind,
      count: Math.max(1, p.count + Math.floor((p.step * (w - p.from)) / 100)),
      interval: p.interval,
      delay: j * 40,
      lane: (w + j) % lanes,
      hpMulBp: hpMulFor(m, w, 10000),
    }));
    if (m.modsFrom && w >= m.modsFrom) {
      const i = (w - m.modsFrom) % m.modList.length;
      const a = w % groups.length;
      groups[a] = { ...groups[a], mods: m.modList[i] };
      if (m.doubleModsFrom && w >= m.doubleModsFrom && groups.length > 1) {
        const b = (a + 1) % groups.length;
        groups[b] = { ...groups[b], mods: m.modList[(i + 4) % m.modList.length] };
      }
    }
    for (const b of [...m.minis.filter((x) => x.wave === w), ...(m.boss.wave === w ? [m.boss] : [])]) {
      groups.push({
        enemy: b.kind,
        count: 1,
        interval: 1,
        delay: 160 + 60 * groups.filter((x) => x.boss).length,
        lane: w % lanes,
        hpMulBp: hpMulFor(m, w, b.hpBp),
        lifeDamage: b === m.boss ? Math.max(ENEMIES[b.kind].lifeDamage, 20) : Math.min(ENEMIES[b.kind].lifeDamage, 6),
        boss: true,
        mods: b.mods,
      });
    }
    out.push(groups);
  }
  cache.set(key, out);
  return out;
}

/** Ondata n (da 0) della partita. */
export function waveFor(mode: GameMode, level: LevelDef, n: number, nightN = 1): WaveGroup[] {
  const m = modeDef(mode, nightN);
  if (!m) return waveAt(level, n, mode);
  const list = modeWaves(m, level);
  return list[Math.min(n, list.length - 1)];
}

export function waveTotal(mode: GameMode, level: LevelDef, nightN = 1): number {
  const m = modeDef(mode, nightN);
  return m ? m.waves : level.waves.length;
}

/** Nemici che possono comparire, per i bot e per l'interfaccia. */
export function enemiesIn(mode: GameMode, level: LevelDef, nightN = 1): Set<EnemyKind> {
  const m = modeDef(mode, nightN);
  const out = new Set<EnemyKind>();
  const waves = m ? modeWaves(m, level) : mode === "hardcore" ? hardcoreWaves(level) : level.waves;
  for (const w of waves) for (const g of w) {
    out.add(g.enemy);
    const def = ENEMIES[g.enemy];
    if (def.summon) out.add(def.summon.kind);
    if (def.split) out.add(def.split.kind);
  }
  return out;
}

export { levelById };

/** Svuota le ondate calcolate: serve al pannello admin e ai test dopo una modifica alle ricette. */
export function clearModeCache(): void {
  cache.clear();
}
