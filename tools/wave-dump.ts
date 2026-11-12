// Composizione di un'ondata: npx tsx tools/wave-dump.ts modalità ondata [mappa]
import { ENEMIES, LEVELS } from "../src/sim-core/content";
import { waveFor } from "../src/sim-core/modes";
import { hpForWave } from "../src/sim-core/sim";
const [mode, w, map = "porto"] = process.argv.slice(2);
const level = LEVELS.find((l) => l.id === map)!;
for (const ws of w.split(",")) {
  const n = Number(ws);
  const g = waveFor(mode as never, level, n - 1);
  let tot = 0;
  const parts = g.map((x) => {
    const hp = hpForWave(ENEMIES[x.enemy].hp, n, x.hpMulBp ?? 10000);
    tot += hp * x.count;
    return `${x.count}×${x.enemy}${x.boss ? "(boss)" : ""} ${hp}${x.mods ? " [" + x.mods.join(",") + "]" : ""}`;
  });
  console.log(`${mode} o${n}: totale ${(tot / 1000).toFixed(1)}k — ${parts.join(" · ")}`);
}
