// Galleria di controllo: tutte le torri e tutti i nemici, in grande.
import { ENEMIES, TOWER_ORDER, TOWERS, TowerKind } from "../../src/sim-core/content";
import { drawEnemyBody, drawTowerShape, enemySize } from "../../src/game-client/draw";

const kinds = [...TOWER_ORDER] as TowerKind[];
const enemies = Object.keys(ENEMIES);
const T = Number(new URLSearchParams(location.search).get("t") ?? 96);
const cols = 10;
const cv = document.createElement("canvas");
const rowsT = Math.ceil(kinds.length / cols) * 3;
const big = T * 1.9;
const rowsE = Math.ceil(enemies.length / 8);
cv.width = cols * T * 1.25 + 20;
cv.height = rowsT * T * 1.3 + rowsE * big * 1.15 + T * 2.2 + 40;
document.body.style.margin = "0";
document.body.style.background = "#0a1418";
document.body.appendChild(cv);
const c = cv.getContext("2d")!;
c.fillStyle = "#16262b";
c.fillRect(0, 0, cv.width, cv.height);
const t = Number(new URLSearchParams(location.search).get("time") ?? 1234);
c.font = "11px sans-serif";
c.textAlign = "center";
kinds.forEach((k, i) => {
  const x = 10 + (i % cols) * T * 1.25 + T * 0.62;
  const row = Math.floor(i / cols) * 3;
  const sz = k === "starcannon" ? 1.25 : 1;
  drawTowerShape(c, k, x, 20 + row * T * 1.3 + T * 0.6, T * sz, -0.6, 1, null, t, "danno", 0);
  drawTowerShape(c, k, x, 20 + (row + 1) * T * 1.3 + T * 0.6, T * sz, 0.4, 4, "A", t, "gittata", 0.8);
  drawTowerShape(c, k, x, 20 + (row + 2) * T * 1.3 + T * 0.6, T * sz, 2.4, 5, "B", t, "sconto", 0.2);
  c.fillStyle = "#eee4cb";
  c.fillText(TOWERS[k].name, x, 20 + row * T * 1.3 + 8);
});
const y0 = 30 + rowsT * T * 1.3;
enemies.forEach((k, i) => {
  const x = 10 + (i % 8) * big * 0.82 + big * 0.45;
  const y = y0 + Math.floor(i / 8) * big * 1.15 + big * 0.55;
  const e = { id: i, kind: k, boss: false, hp: 1, maxHp: 1, mods: 0, stun: 0 } as never;
  const sc = Math.min(T * 1.5, (big * 0.25) / enemySize(e));
  drawEnemyBody(c, e, x, y, sc, 0, (i + 1) & 3);
  c.fillStyle = "#eee4cb";
  c.fillText(k, x, y + big * 0.52);
});
// Fila di dimensioni reali, in quattro direzioni.
const y1 = cv.height - T * 1.6;
enemies.forEach((k, i) => {
  const e = { id: i, kind: k, boss: false, hp: 1, maxHp: 1, mods: 0, stun: 0 } as never;
  drawEnemyBody(c, e, 30 + i * (cv.width - 60) / enemies.length, y1 + (i % 2) * 44, 44, (i % 4) * Math.PI / 2, i & 3);
});
kinds.forEach((k, i) => drawTowerShape(c, k, 30 + i * 46, y1 + 110, k === "starcannon" ? 60 : 44, 0.3, 3, null, t, "danno", 0));
(window as never as { done: boolean }).done = true;
