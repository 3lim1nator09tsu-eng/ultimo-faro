// Prova le modalità con i bot: npx tsx tools/mode-lab.ts [partite] [filtro]
import { TOWER_ORDER, TowerKind } from "../src/sim-core/content";
import { playBot } from "../src/sim-core/bot";
import { GameOptions } from "../src/sim-core/sim";
const runs = Number(process.argv[2] ?? 6);
const filter = process.argv[3] ?? "";
const allRank = (r: number) => Object.fromEntries(TOWER_ORDER.map((k) => [k, r])) as Record<TowerKind, number>;
const STARTER: TowerKind[] = ["balestra", "mortaio", "soffio"];
const MID: TowerKind[] = ["balestra", "mortaio", "soffio", "cecchino", "bobina", "officina"];
const SUP: TowerKind[] = ["balestra", "mortaio", "bobina", "cecchino", "capitano", "medico"];
const HC: TowerKind[] = ["mortaio", "cecchino", "capitano", "medico", "mitragliera", "arpione"];
const HC2: TowerKind[] = ["mortaio", "bobina", "capitano", "mitragliera", "arpione", "purificatore"];
const setups: Array<[string, GameOptions]> = [
  ["easy, 3 torri r1", { mode: "easy", allowed: STARTER }],
  ["easy, 6 torri r1", { mode: "easy", allowed: MID }],
  ["medium, 6 torri r1", { mode: "medium", allowed: MID }],
  ["medium, 6 torri r2", { mode: "medium", allowed: MID, ranks: allRank(2) }],
  ["molten, 6 torri r2", { mode: "molten", allowed: MID, ranks: allRank(2) }],
  ["molten, supp r3", { mode: "molten", allowed: SUP, ranks: allRank(3) }],
  ["fallen, supp r3", { mode: "fallen", allowed: SUP, ranks: allRank(3) }],
  ["fallen, supp r4", { mode: "fallen", allowed: SUP, ranks: allRank(4) }],
  ["frost, supp r4", { mode: "frost", allowed: SUP, ranks: allRank(4) }],
  ["frost, HC r5", { mode: "frost", allowed: HC, ranks: allRank(5) }],
  ["hardcore, supp r5", { mode: "hardcore", allowed: SUP, ranks: allRank(5) }],
  ["hardcore, HC r5", { mode: "hardcore", allowed: HC, ranks: allRank(5) }],
  ["hardcore, HC2 r5", { mode: "hardcore", allowed: HC2, ranks: allRank(5) }],
  ["frost, supp r5", { mode: "frost", allowed: SUP, ranks: allRank(5) }],
  ["hardcore, supp r3", { mode: "hardcore", allowed: SUP, ranks: allRank(3) }],
];
const maps = ["porto", "foce", "marea"];
for (const [label, opts] of setups) {
  if (filter && !label.includes(filter)) continue;
  let wins = 0, waves = 0;
  const t0 = Date.now();
  for (let i = 0; i < runs; i++) {
    const level = opts.mode === "natale" ? undefined : maps[i % 3];
    const r = playBot("mirato", (i + 1) * 7919, 400000, undefined, { ...opts, level });
    if (r.phase === "won") wins++;
    waves += r.wave;
  }
  console.log(`${label.padEnd(24)} vittorie ${String(Math.round((wins / runs) * 100)).padStart(3)}%  ondata media ${(waves / runs).toFixed(1).padStart(5)}  (${((Date.now() - t0) / runs / 1000).toFixed(1)} s/partita)`);
}
