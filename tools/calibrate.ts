// Taratura: per ogni modalità cerca la vita dei nemici a cui il bot vince metà delle partite,
// poi la moltiplica per quanto un giocatore vero è più bravo del bot (fattore F).
// Uso: npx tsx tools/calibrate.ts [partite per punto] [filtro]
import { TOWER_ORDER, TowerKind } from "../src/sim-core/content";
import { playBot } from "../src/sim-core/bot";
import { HARDCORE, NIGHTS, SURVIVAL, ModeDef, clearModeCache } from "../src/sim-core/modes";
import { GameOptions } from "../src/sim-core/sim";

const runs = Number(process.argv[2] ?? 8);
const filter = process.argv[3] ?? "";
const allRank = (r: number) => Object.fromEntries(TOWER_ORDER.map((k) => [k, r])) as Record<TowerKind, number>;
const MID: TowerKind[] = ["balestra", "mortaio", "soffio", "cecchino", "bobina", "officina"];
const SUPK: TowerKind[] = ["balestra", "mortaio", "bobina", "cecchino", "capitano", "kingpin"];
const HCK: TowerKind[] = ["mortaio", "bobina", "capitano", "mitragliera", "arpione", "kingpin"];

interface Target {
  label: string;
  def: ModeDef;
  opts: GameOptions;
  maps: Array<string | undefined>;
  F: number; // quanto il giocatore supera il bot
}
const byId = (id: string) => [...SURVIVAL, HARDCORE].find((m) => m.id === id)!;
const surv = ["porto", "foce", "marea", "lungomare"];
const targets: Target[] = [
  { label: "easy", def: byId("easy"), opts: { mode: "easy", allowed: MID, ranks: allRank(2) }, maps: surv, F: 1.4 },
  { label: "medium", def: byId("medium"), opts: { mode: "medium", allowed: MID, ranks: allRank(2) }, maps: surv, F: 1.6 },
  { label: "molten", def: byId("molten"), opts: { mode: "molten", allowed: SUPK, ranks: allRank(3) }, maps: surv, F: 1.7 },
  { label: "fallen", def: byId("fallen"), opts: { mode: "fallen", allowed: SUPK, ranks: allRank(4) }, maps: surv, F: 1.7 },
  { label: "frost", def: byId("frost"), opts: { mode: "frost", allowed: SUPK, ranks: allRank(4) }, maps: surv, F: 1.8 },
  { label: "hardcore", def: HARDCORE, opts: { mode: "hardcore", allowed: HCK, ranks: allRank(5) }, maps: surv, F: 1.8 },
  ...NIGHTS.map((n) => ({ label: `notte${n.night}`, def: n as ModeDef, opts: { mode: "natale" as const, night: n.night, eventBp: 10000, allowed: HCK, ranks: allRank(5) }, maps: [undefined], F: 1.6 })),
];

function winRate(t: Target, mul: number): { rate: number; wave: number } {
  const base = t.def.hpBp;
  t.def.hpBp = Math.round(base * mul);
  clearModeCache();
  let wins = 0;
  let waves = 0;
  for (let i = 0; i < runs; i++) {
    const r = playBot("mirato", (i + 1) * 7919, 600000, undefined, { ...t.opts, level: t.maps[i % t.maps.length] });
    if (r.phase === "won") wins++;
    waves += r.wave;
  }
  t.def.hpBp = base;
  clearModeCache();
  return { rate: wins / runs, wave: waves / runs };
}

const out: Record<string, { hpBp: number; m50: number; next: number }> = {};
for (const t of targets) {
  if (filter && !t.label.includes(filter)) continue;
  const t0 = Date.now();
  // Bisezione sul moltiplicatore (scala logaritmica) tra 0.25 e 4.
  let lo = 0.25;
  let hi = 4;
  const at1 = winRate(t, 1);
  if (at1.rate >= 0.5) lo = 1;
  else hi = 1;
  for (let i = 0; i < 6; i++) {
    const mid = Math.sqrt(lo * hi);
    if (winRate(t, mid).rate >= 0.5) lo = mid;
    else hi = mid;
  }
  const m50 = Math.sqrt(lo * hi);
  const next = Math.round((t.def.hpBp * m50 * t.F) / 100) * 100;
  out[t.label] = { hpBp: t.def.hpBp, m50: Number(m50.toFixed(2)), next };
  console.log(`${t.label.padEnd(9)} oggi ${t.def.hpBp}  bot vince a 1.0: ${Math.round(at1.rate * 100)}% (ondata ${at1.wave.toFixed(1)})  bot al 50% con vita ×${m50.toFixed(2)}  → proposta ${next} (×${((m50 * t.F)).toFixed(2)})  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
}
console.log(JSON.stringify(out));
