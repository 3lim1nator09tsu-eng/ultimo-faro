// Danno vero delle torri, misurato nella simulazione: un bersaglio e una folla di 6. npx tsx tools/tower-dps.ts [torre]
import { ENEMIES, TILE, TOWERS, TOWER_ORDER, TowerKind, levelById } from "../src/sim-core/content";
import { canPlace, createGame, lanePoint, step, towerStats } from "../src/sim-core/sim";

const only = process.argv[2];
const SECONDS = 60;
function measure(kind: TowerKind, stage: number, branch: "A" | "B" | null, crowd: number) {
  const s = createGame(77, { mode: "campagna", level: "porto", allowed: [kind], sandbox: true });
  s.cash = 9e6;
  // La casella edificabile più vicina al sentiero: così anche le torri a corto raggio arrivano.
  const lvl0 = levelById("porto");
  let spot: [number, number] | null = null, near = Infinity;
  for (let cy = 0; cy < 9; cy++) for (let cx = 0; cx < 16; cx++) {
    if (!canPlace(s, kind, cx, cy)) continue;
    const half = kind === "starcannon" ? TILE : TILE / 2;
    const c = { x: cx * TILE + half, y: cy * TILE + half };
    for (let d = 3000; d < 30000; d += 100) {
      const p = lanePoint(lvl0, 0, d);
      const q = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
      if (q < near) { near = q; spot = [cx, cy]; }
    }
  }
  if (!spot) return null;
  step(s, [{ t: "build", kind, cx: spot[0], cy: spot[1] }]);
  const t = s.towers[0];
  if (!t) return null;
  for (let i = 1; i < stage; i++) step(s, [{ t: "upgrade", id: t.id }]);
  if (branch) step(s, [{ t: "spec", id: t.id, branch }]);
  step(s, [{ t: "skip" }]);
  for (let i = 0; i < 60 && s.phase !== "wave"; i++) step(s, []);
  s.spawns = [];
  s.enemies = [];
  const lvl = levelById("porto");
  let at = 0, best = Infinity;
  for (let d = 0; d < 40000; d += 50) {
    const p = lanePoint(lvl, 0, d);
    const q = (p.x - t.x) ** 2 + (p.y - t.y) ** 2;
    if (q < best) { best = q; at = d; }
  }
  const es = [];
  for (let i = 0; i < crowd; i++) {
    const d = at + (i - (crowd - 1) / 2) * 220;
    const p = lanePoint(lvl, 0, d);
    const e = { id: s.nextId++, kind: "risacca", hp: 1e9, maxHp: 1e9, shield: 0, dist: d, lane: 0, x: p.x, y: p.y, offset: 0, speedBp: 10000, stun: 999999, boss: false, bountyBp: 0, mods: [], act: 99999, fragileBp: 0, armor: 0 } as never;
    s.enemies.push(e);
    es.push(e);
  }
  const hold = es.map((e: any) => ({ dist: e.dist, x: e.x, y: e.y }));
  // Un minuto di riscaldamento (torrette, cariche), poi un minuto di misura.
  for (let i = 0; i < 600; i++) { es.forEach((e: any, j) => Object.assign(e, hold[j], { stun: 999999 })); step(s, []); if (!s.enemies.length) s.enemies.push(...es); }
  const before = es.reduce((a, e: any) => a + e.hp, 0) + s.cash;
  const cash0 = s.cash;
  for (let i = 0; i < SECONDS * 10; i++) { es.forEach((e: any, j) => Object.assign(e, hold[j], { stun: 999999 })); step(s, []); }
  const dmg = before - s.cash - es.reduce((a, e: any) => a + e.hp, 0);
  void cash0;
  return { dps: dmg / SECONDS, cost: t.invested, range: towerStats(t).range };
}
console.log("torre         stadio  costo   1 bersaglio (dps | per 100c)   folla di 6 (dps | per 100c)");
for (const k of TOWER_ORDER as TowerKind[]) {
  if (only && k !== only) continue;
  if (!TOWERS[k].levels[0].damage && !TOWERS[k].levels[0].cannonMax && !TOWERS[k].levels[0].sentryMax) continue;
  for (const [name, stage, br] of [["L1", 1, null], ["L2", 2, null], ["L3", 3, null], ["A", 3, "A"], ["B", 3, "B"]] as const) {
    const one = measure(k, stage, br, 1);
    const six = measure(k, stage, br, 6);
    if (!one || !six) continue;
    console.log(`${k.padEnd(13)} ${name.padEnd(3)} ${String(one.cost).padStart(6)}c  ${one.dps.toFixed(0).padStart(6)} | ${((one.dps * 100) / one.cost).toFixed(1).padStart(5)}        ${six.dps.toFixed(0).padStart(7)} | ${((six.dps * 100) / six.cost).toFixed(1).padStart(5)}`);
  }
}
void ENEMIES;
