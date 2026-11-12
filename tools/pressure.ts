// Pressione per ondata: vita che entra, soldi investiti in torri, vite perse. npx tsx tools/pressure.ts [partite] [filtro]
import { TOWER_ORDER, TowerKind } from "../src/sim-core/content";
import { decide } from "../src/sim-core/bot";
import { GameOptions, createGame, step } from "../src/sim-core/sim";

const runs = Number(process.argv[2] ?? 4);
const filter = process.argv[3] ?? "";
const allRank = (r: number) => Object.fromEntries(TOWER_ORDER.map((k) => [k, r])) as Record<TowerKind, number>;
const MID: TowerKind[] = ["balestra", "mortaio", "soffio", "cecchino", "bobina", "officina"];
const SUPK: TowerKind[] = ["balestra", "mortaio", "bobina", "cecchino", "capitano", "kingpin"];
const HCK: TowerKind[] = ["mortaio", "bobina", "capitano", "mitragliera", "arpione", "kingpin"];
const setups: Array<[string, GameOptions]> = [
  ["easy r1", { mode: "easy", allowed: MID }],
  ["easy r3", { mode: "easy", allowed: MID, ranks: allRank(3) }],
  ["medium r3", { mode: "medium", allowed: MID, ranks: allRank(3) }],
  ["molten r4", { mode: "molten", allowed: SUPK, ranks: allRank(4) }],
  ["fallen r5", { mode: "fallen", allowed: SUPK, ranks: allRank(5) }],
  ["frost r5", { mode: "frost", allowed: SUPK, ranks: allRank(5) }],
  ["hardcore r5", { mode: "hardcore", allowed: HCK, ranks: allRank(5) }],
];
const maps = ["porto", "foce", "marea", "lungomare"];
for (const [label, opts] of setups) {
  if (filter && !label.includes(filter)) continue;
  const hp: number[] = [], inv: number[] = [], lost: number[] = [], n: number[] = [];
  const ends: string[] = [];
  for (let i = 0; i < runs; i++) {
    const s = createGame((i + 1) * 7919, { ...opts, level: maps[i % 4] });
    const seen = new Set<number>();
    let lives = s.lives;
    while (s.phase !== "won" && s.phase !== "lost" && s.tick < 400000) {
      step(s, decide(s, "mirato"));
      const w = s.wave;
      for (const e of s.enemies) if (!seen.has(e.id)) {
        seen.add(e.id);
        hp[w] = (hp[w] ?? 0) + e.maxHp + e.shield;
      }
      if (s.lives < lives) { lost[w] = (lost[w] ?? 0) + lives - s.lives; lives = s.lives; }
      if (s.lives > lives) lives = s.lives;
      inv[w] = Math.max(inv[w] ?? 0, 0);
      (inv as number[])[w] = s.towers.reduce((a, t) => a + t.invested, 0) + (inv[w] && false ? 0 : 0);
      n[w] = (n[w] ?? 0);
    }
    ends.push(`${s.phase === "won" ? "V" : "x"}${s.wave}`);
  }
  console.log(`\n${label}  esiti: ${ends.join(" ")}`);
  const rows: string[] = [];
  for (let w = 1; w < hp.length; w++) {
    if (!hp[w]) continue;
    if (w % 5 && !(lost[w] > 0) && w !== hp.length - 1) continue;
    rows.push(`o${w}: vita ${(hp[w] / runs / 1000).toFixed(1)}k  torri ${(inv[w] / 1000).toFixed(1)}k  vita/torri ${(hp[w] / runs / Math.max(1, inv[w])).toFixed(2)}  vite perse ${((lost[w] ?? 0) / runs).toFixed(1)}`);
  }
  console.log(rows.join("\n"));
}
