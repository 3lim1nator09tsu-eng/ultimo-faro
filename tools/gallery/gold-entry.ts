import { GOLDEN_KINDS } from "../../src/sim-core/content";
import { drawTowerShape } from "../../src/game-client/draw";
const T = 110;
const cv = document.createElement("canvas");
cv.width = GOLDEN_KINDS.length * T * 1.3 + 20;
cv.height = T * 2.8;
document.body.style.margin = "0";
document.body.appendChild(cv);
const c = cv.getContext("2d")!;
c.fillStyle = "#4a3b25";
c.fillRect(0, 0, cv.width, cv.height);
GOLDEN_KINDS.forEach((k, i) => {
  const x = 10 + i * T * 1.3 + T * 0.65;
  drawTowerShape(c, k, x, T * 0.7, T, -0.6, 3, null, 1234, "danno", 0.6, 1, false);
  drawTowerShape(c, k, x, T * 2.0, T, -0.6, 3, null, 1234, "danno", 0.6, 1, true);
});
(window as never as { done: boolean }).done = true;
