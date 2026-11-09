// Misura il costo della simulazione con tanti nemici e tante torri: millisecondi per tick.
import { TOWER_ORDER, TowerKind } from "../src/sim-core/content";
import { createGame, isBuildable, step } from "../src/sim-core/sim";

const enemies = Number(process.argv[2] ?? 300);
const s = createGame(9, { mode: "hardcore", level: "lungomare", sandbox: true, allowed: [...TOWER_ORDER] as TowerKind[] });
s.cash = 1e9;
s.god = true;
const kinds: TowerKind[] = ["balestra", "mortaio", "soffio", "cecchino", "bobina", "capitano", "grammofono", "sledger", "executioner", "accelerator", "kingpin", "mitragliera", "arpione", "purificatore"];
let k = 0;
for (let cy = 0; cy < 9; cy++)
  for (let cx = 0; cx < 16; cx++) {
    if (k >= 40 || !isBuildable(s, cx, cy)) continue;
    step(s, [{ t: "build", kind: kinds[k % kinds.length], cx, cy }]);
    k++;
  }
for (const t of s.towers) for (let i = 0; i < 3; i++) step(s, [{ t: "upgrade", id: t.id }]);
step(s, [{ t: "skip" }]);
for (let i = 0; i < Math.ceil(enemies / 50); i++) step(s, [{ t: "adminSpawn", enemy: (["bruto", "risacca", "spettro", "magmatico"] as const)[i % 4], count: 50, hpMulBp: 5000000 }]);
for (let i = 0; i < 80; i++) step(s, []);
const t0 = performance.now();
const N = 300;
for (let i = 0; i < N; i++) step(s, []);
const ms = (performance.now() - t0) / N;
console.log(`${s.towers.length} torri, ${s.enemies.length} nemici: ${ms.toFixed(2)} ms per tick`);
