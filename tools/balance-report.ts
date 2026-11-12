// Rapporto di bilanciamento: resa delle torri e vita delle ondate. npx tsx tools/balance-report.ts
import { ENEMIES, LEVELS, TOWERS, TOWER_ORDER, TowerKind, TowerStats } from "../src/sim-core/content";
import { waveFor } from "../src/sim-core/modes";

const dps = (s: TowerStats) => {
  if (s.cannonMax) return (s.cannonMax * 10) / (s.chargeTicks + s.cooldown);
  if (s.accBurst) return (s.damage * (s.accBurst / Math.max(1, s.accTick)) * 10) / (s.accCharge + s.accBurst);
  if (!s.cooldown || !s.damage) return 0;
  return (s.damage * 10) / s.cooldown;
};
// Bersagli colpiti in media in una folla: stima dichiarata, non misurata.
const hits = (s: TowerStats) => (s.cannonMax ? 8 : s.radius ? Math.min(8, 1 + (s.radius / 600) ** 1.3) : s.chains ? 1 + Math.min(s.chains, 6) * ((s.chainBp || 10000) / 10000) * 0.8 : s.maxTargets ? Math.min(s.maxTargets, 4) : 1);
console.log("TORRI: costo cumulato, DPS su un bersaglio, DPS/100 cash, DPS in folla/100 cash, gittata");
for (const k of TOWER_ORDER as TowerKind[]) {
  const d = TOWERS[k];
  let cost = 0;
  const rows: string[] = [];
  d.levels.forEach((s, i) => {
    cost += s.cost;
    rows.push(`L${i + 1} ${cost}c ${dps(s).toFixed(0)} | ${((dps(s) * 100) / cost).toFixed(1)} | ${((dps(s) * hits(s) * 100) / cost).toFixed(1)} | ${s.range}`);
  });
  for (const b of ["A", "B"] as const) {
    const s = d.branches[b];
    const c = cost + s.cost;
    rows.push(`${b} ${c}c ${dps(s).toFixed(0)} | ${((dps(s) * 100) / c).toFixed(1)} | ${((dps(s) * hits(s) * 100) / c).toFixed(1)} | ${s.range}`);
  }
  console.log(`${k.padEnd(13)} ${rows.join("   ")}`);
}
console.log("\nONDATE: vita totale dell'ondata (migliaia), Porto");
const level = LEVELS.find((l) => l.id === "porto")!;
for (const mode of ["easy", "medium", "molten", "fallen", "frost", "hardcore"] as const) {
  const out: string[] = [];
  for (let n = 0; n < 60; n++) {
    let g;
    try { g = waveFor(mode, level, n); } catch { break; }
    if (!g || !g.length) break;
    const hp = g.reduce((a, x) => a + ENEMIES[x.enemy].hp * x.count * ((x.hpMulBp ?? 10000) / 10000), 0);
    if (n % 5 === 4 || n === 0) out.push(`${n + 1}:${(hp / 1000).toFixed(1)}`);
  }
  console.log(`${mode.padEnd(9)} ${out.join("  ")}`);
}
