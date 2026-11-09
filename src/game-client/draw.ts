import { DOHOTER_FACE } from "./assets/dohoter";
// Disegno su canvas. Tutto è in coordinate della mappa: T è il lato di una casella in pixel.
import { Branch, ENEMIES, MAP_H, MAP_W, MapDef, TILE, TowerKind, Track } from "../sim-core/content";
import { Enemy, isHidden } from "../sim-core/sim";

export const COLORS = {
  brass: "#e0b354",
  coral: "#e2714f",
  ice: "#a5e4ec",
  cream: "#eee4cb",
  iron: "#8f9ca3",
  tide: "#04090b",
};

export const toPx = (u: number, T: number) => (u / TILE) * T;

// In verticale la carta ruota di 90 gradi: il mare entra dall'alto e il Faro sta in basso.
// mx, my sono pixel della carta orizzontale; il risultato è la posizione sullo schermo.
export function mapToScreen(rot: boolean, T: number, mx: number, my: number): { x: number; y: number } {
  return rot ? { x: MAP_H * T - my, y: mx } : { x: mx, y: my };
}

export function applyMap(ctx: CanvasRenderingContext2D, rot: boolean, T: number) {
  if (rot) ctx.setTransform(0, 1, -1, 0, MAP_H * T, 0);
  else ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- sfondo: carta nautica generata una volta sola ----------

function valueNoise(seed: number) {
  const size = 64;
  const grid = new Float64Array(size * size);
  let x = seed;
  for (let i = 0; i < grid.length; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    grid[i] = x / 4294967296;
  }
  const at = (ix: number, iy: number) => grid[((iy & 63) << 6) | (ix & 63)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (px: number, py: number) => {
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = smooth(px - ix);
    const fy = smooth(py - iy);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  };
  return (px: number, py: number) => (sample(px, py) * 4 + sample(px * 2.1, py * 2.1) * 2 + sample(px * 4.3, py * 4.3)) / 7;
}

function distanceToPath(map: MapDef, x: number, y: number): number {
  let best = 1e9;
  for (const cells of map.lanes) {
    for (let i = 0; i + 1 < cells.length; i++) {
      const ax = cells[i][0] + 0.5;
      const ay = cells[i][1] + 0.5;
      const bx = cells[i + 1][0] + 0.5;
      const by = cells[i + 1][1] + 0.5;
      const cx = Math.max(Math.min(ax, bx), Math.min(x, Math.max(ax, bx)));
      const cy = Math.max(Math.min(ay, by), Math.min(y, Math.max(ay, by)));
      const d = Math.hypot(x - cx, y - cy);
      if (d < best) best = d;
    }
  }
  return best;
}

const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const chartCache = new Map<string, HTMLCanvasElement>();

function chartBase(map: MapDef): HTMLCanvasElement {
  const hit = chartCache.get(map.name);
  if (hit) return hit;
  const w = 960;
  const h = 540;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const noise = valueNoise(20261225);
  const deep = [9, 20, 25];
  const shallow = [24, 66, 76];
  const sand = [121, 104, 66];
  const landLow = [66, 58, 39];
  const landHigh = [47, 46, 35];
  const contour = [106, 95, 67];
  let i = 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = (px / w) * MAP_W;
      const y = (py / h) * MAP_H;
      const n = noise(x * 0.42, y * 0.42);
      const f = distanceToPath(map, x, y) + (n - 0.5) * 0.55;
      let c: number[];
      if (f < 0.46) c = deep;
      else if (f < 0.6) c = mix(deep, shallow, (f - 0.46) / 0.14);
      else if (f < 0.68) c = sand;
      else {
        const e = Math.min(1, (f - 0.68) / 3.2 + (n - 0.5) * 0.5);
        c = mix(landLow, landHigh, Math.max(0, e));
        const band = f * 2.1 + n * 5;
        if (Math.abs(band - Math.round(band)) < 0.028) c = mix(c, contour, 0.6);
      }
      img.data[i++] = c[0];
      img.data[i++] = c[1];
      img.data[i++] = c[2];
      img.data[i++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  chartCache.set(map.name, cv);
  return cv;
}

export function pathPolyline(ctx: CanvasRenderingContext2D, T: number, cells: ReadonlyArray<readonly [number, number]>) {
  ctx.beginPath();
  cells.forEach(([cx, cy], i) => {
    const x = (cx + 0.5) * T;
    const y = (cy + 0.5) * T;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

function rock(ctx: CanvasRenderingContext2D, x: number, y: number, T: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#26231a";
  ctx.strokeStyle = "#8d8360";
  ctx.lineWidth = Math.max(1, T * 0.025);
  ctx.beginPath();
  const pts = [[-0.34, 0.12], [-0.2, -0.22], [0.05, -0.32], [0.3, -0.1], [0.34, 0.2], [0.02, 0.32], [-0.22, 0.28]];
  pts.forEach(([a, b], i) => (i ? ctx.lineTo(a * T, b * T) : ctx.moveTo(a * T, b * T)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Il segno degli scogli sulle carte: una croce con i punti.
  ctx.strokeStyle = COLORS.cream;
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  ctx.moveTo(-0.13 * T, 0);
  ctx.lineTo(0.13 * T, 0);
  ctx.moveTo(0, -0.13 * T);
  ctx.lineTo(0, 0.13 * T);
  ctx.stroke();
  ctx.restore();
}

function compass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "rgba(238,228,203,.3)";
  ctx.fillStyle = "rgba(238,228,203,.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0;
    ctx.save();
    ctx.rotate((i * Math.PI) / 4);
    ctx.beginPath();
    ctx.moveTo(0, -(long ? r * 0.95 : r * 0.55));
    ctx.lineTo(r * 0.09, 0);
    ctx.lineTo(-r * 0.09, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function renderBackground(map: MapDef, W: number, H: number, rot = false, winter = false): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  const T = rot ? W / MAP_H : W / MAP_W;
  const MW = MAP_W * T;
  const MH = MAP_H * T;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Tutto ciò che non è testo si disegna sulla carta, eventualmente ruotata.
  applyMap(ctx, rot, T);
  ctx.drawImage(chartBase(map), 0, 0, MW, MH);
  for (const [cx, cy] of map.rocks) rock(ctx, (cx + 0.5) * T, (cy + 0.5) * T, T);
  if (winter) {
    // Notti di Natale: la carta si copre di neve e brina.
    ctx.fillStyle = "rgba(214,232,244,.22)";
    ctx.fillRect(0, 0, MW, MH);
    let sd = map.name.length * 4099;
    for (let i = 0; i < 260; i++) {
      sd = (sd * 1103515245 + 12345) >>> 0;
      const x = ((sd >>> 6) % 10000) / 10000;
      sd = (sd * 1103515245 + 12345) >>> 0;
      const y = ((sd >>> 6) % 10000) / 10000;
      if (distanceToPath(map, x * MAP_W, y * MAP_H) < 0.55) continue;
      ctx.fillStyle = `rgba(245,250,255,${0.25 + ((sd >>> 3) % 50) / 100})`;
      ctx.beginPath();
      ctx.arc(x * MW, y * MH, T * (0.03 + ((sd >>> 9) % 5) / 100), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const compassR = T * 0.62;
  compass(ctx, map.compass[0] * T, map.compass[1] * T, compassR);

  // Cornice graduata con i tratti alterni di latitudine e longitudine.
  const bar = Math.max(3, Math.round(T * 0.08));
  for (let i = 0; i < MAP_W * 2; i++) {
    ctx.fillStyle = i % 2 ? "rgba(238,228,203,.75)" : "rgba(8,16,20,.9)";
    ctx.fillRect((i * T) / 2, 0, T / 2 + 0.5, bar);
    ctx.fillRect((i * T) / 2, MH - bar, T / 2 + 0.5, bar);
  }
  for (let i = 0; i < MAP_H * 2; i++) {
    ctx.fillStyle = i % 2 ? "rgba(238,228,203,.75)" : "rgba(8,16,20,.9)";
    ctx.fillRect(0, (i * T) / 2, bar, T / 2 + 0.5);
    ctx.fillRect(MW - bar, (i * T) / 2, bar, T / 2 + 0.5);
  }

  // Le scritte restano sempre dritte e dentro la cornice.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = (mx: number, my: number, text: string, dx = 0, dy = 0) => {
    const p = mapToScreen(rot, T, mx * T, my * T);
    const half = ctx.measureText(text).width / 2;
    const pad = T * 0.2;
    const x = Math.min(Math.max(p.x + dx, half + pad), W - half - pad);
    const y = Math.min(Math.max(p.y + dy, pad), H - pad);
    ctx.fillText(text, x, y);
  };
  ctx.font = `italic ${Math.round(T * 0.26)}px "IM Fell English", Georgia, serif`;
  ctx.fillStyle = "rgba(238,228,203,.55)";
  for (const l of map.labels) label(l.x, l.y, l.text);
  const faro = mapToScreen(rot, T, (map.faro[0] + 0.5) * T, (map.faro[1] + 0.5) * T);
  if (faro.y + T * 0.55 < H - T * 0.25) ctx.fillText("Faro", faro.x, faro.y + T * 0.55);
  else ctx.fillText("Faro", faro.x + T * 0.75, faro.y + T * 0.1);
  ctx.font = `${Math.round(T * 0.19)}px "IM Fell English", Georgia, serif`;
  ctx.fillStyle = "rgba(238,228,203,.42)";
  // Quote delle alture, nei punti di terra più lontani dall'acqua.
  const heights: Array<[number, number, string]> = [];
  let seed = map.name.length * 7919;
  for (let i = 0; i < 400 && heights.length < 8; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const x = 0.4 + ((seed >>> 8) % 1520) / 100;
    const y = 0.4 + ((seed >>> 4) % 820) / 100;
    if (distanceToPath(map, x, y) < 1.1) continue;
    if (map.rocks.some(([rx, ry]) => Math.hypot(rx + 0.5 - x, ry + 0.5 - y) < 0.8)) continue;
    if (Math.hypot(map.compass[0] - x, map.compass[1] - y) < 1) continue;
    if (heights.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < 2)) continue;
    heights.push([x, y, String(8 + ((seed >>> 12) % 40))]);
  }
  for (const [x, y, text] of heights) label(x, y, text);
  // La N indica il nord della carta: in verticale punta a destra.
  ctx.font = `${Math.round(compassR * 0.5)}px "IM Fell English", Georgia, serif`;
  ctx.fillStyle = "rgba(238,228,203,.6)";
  const north = mapToScreen(rot, T, map.compass[0] * T, map.compass[1] * T - compassR * 1.22);
  ctx.fillText("N", north.x, north.y);
  return cv;
}

// ---------- canale animato e faro ----------

/** part: "base" è la parte ferma (fondo del canale, argini chiusi), "flow" le correnti che si muovono. */
export function drawTide(ctx: CanvasRenderingContext2D, T: number, time: number, still: boolean, map: MapDef, open: boolean[], part: "all" | "base" | "flow" = "all") {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  map.lanes.forEach((cells, i) => {
    if (part === "flow") {
      if (!open[i] || still) return;
      ctx.lineCap = "butt";
      pathPolyline(ctx, T, cells);
      ctx.setLineDash([T * 0.22, T * 0.95]);
      ctx.lineDashOffset = -time * T * 0.0006;
      ctx.strokeStyle = "rgba(165,228,236,.2)";
      ctx.lineWidth = Math.max(1, T * 0.035);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = "round";
      return;
    }
    pathPolyline(ctx, T, cells);
    ctx.strokeStyle = open[i] ? "rgba(4,9,11,.72)" : "rgba(4,9,11,.3)";
    ctx.lineWidth = T * 0.5;
    ctx.stroke();
    if (!open[i]) {
      // Canale ancora chiuso: argine tratteggiato e sbarramento all'imbocco.
      pathPolyline(ctx, T, cells);
      ctx.setLineDash([T * 0.12, T * 0.16]);
      ctx.strokeStyle = "rgba(238,228,203,.35)";
      ctx.lineWidth = Math.max(1, T * 0.04);
      ctx.stroke();
      ctx.setLineDash([]);
      const [ax, ay] = cells[1];
      ctx.fillStyle = "rgba(226,113,79,.8)";
      ctx.fillRect((ax + 0.1) * T, (ay + 0.4) * T, T * 0.8, T * 0.2);
      return;
    }
    if (!still && part === "all") {
      // Correnti sottili che scorrono verso il Faro.
      ctx.lineCap = "butt";
      pathPolyline(ctx, T, cells);
      ctx.setLineDash([T * 0.22, T * 0.95]);
      ctx.lineDashOffset = -time * T * 0.0006;
      ctx.strokeStyle = "rgba(165,228,236,.2)";
      ctx.lineWidth = Math.max(1, T * 0.035);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = "round";
    }
  });
  ctx.restore();
}

/** Secca: sommersa prima di emergere, poi terra chiara. Disegnata nello spazio della carta. */
export function drawShoal(ctx: CanvasRenderingContext2D, T: number, cx: number, cy: number, emerged: boolean, time: number) {
  ctx.save();
  if (emerged) {
    ctx.fillStyle = "rgba(121,104,66,.55)";
    ctx.fillRect(cx * T + 1, cy * T + 1, T - 2, T - 2);
    ctx.strokeStyle = "rgba(238,228,203,.35)";
    ctx.strokeRect(cx * T + 2, cy * T + 2, T - 4, T - 4);
  } else {
    ctx.fillStyle = "rgba(24,66,76,.85)";
    ctx.fillRect(cx * T, cy * T, T, T);
    ctx.strokeStyle = "rgba(165,228,236,.25)";
    ctx.lineWidth = 1;
    const off = (time * 0.0004) % 1;
    for (let i = 0; i < 3; i++) {
      const y = cy * T + ((i + off) / 3) * T;
      ctx.beginPath();
      ctx.moveTo(cx * T + T * 0.15, y);
      ctx.quadraticCurveTo(cx * T + T * 0.5, y - T * 0.08, cx * T + T * 0.85, y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawFaro(ctx: CanvasRenderingContext2D, T: number, time: number, lives: number, still: boolean, x: number, y: number) {
  const danger = lives <= 6;
  const flicker = danger && !still ? 0.5 + 0.5 * Math.sin(time * 0.02) : 1;
  const angle = still ? -2.5 : time * 0.0007;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const a of [angle, angle + Math.PI]) {
    const reach = T * 6.5;
    const grad = ctx.createRadialGradient(x, y - T * 0.42, 0, x, y - T * 0.42, reach);
    const tone = danger ? "226,113,79" : "240,196,104";
    grad.addColorStop(0, `rgba(${tone},${0.3 * flicker})`);
    grad.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x, y - T * 0.42);
    ctx.arc(x, y - T * 0.42, reach, a - 0.13, a + 0.13);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#2a2a22";
  ctx.beginPath();
  ctx.ellipse(x, y + T * 0.26, T * 0.42, T * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  // Torre a fasce, stretta in cima.
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const w0 = T * (0.22 - t0 * 0.1);
    const w1 = T * (0.22 - t1 * 0.1);
    const y0 = y + T * 0.26 - t0 * T * 0.62;
    const y1 = y + T * 0.26 - t1 * T * 0.62;
    ctx.fillStyle = i % 2 ? "#b4412c" : COLORS.cream;
    ctx.beginPath();
    ctx.moveTo(x - w0, y0);
    ctx.lineTo(x + w0, y0);
    ctx.lineTo(x + w1, y1);
    ctx.lineTo(x - w1, y1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = danger ? COLORS.coral : "#ffdc8a";
  ctx.globalAlpha = flicker;
  ctx.beginPath();
  ctx.arc(x, y - T * 0.42, T * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------- torri ----------

export const TRACK_COLORS: Record<Track, string> = { danno: "#e2714f", gittata: "#a5e4ec", sconto: "#9fd28b" };

export function drawTowerShape(ctx: CanvasRenderingContext2D, kind: TowerKind, x: number, y: number, T: number, angle: number, level = 1, branch: Branch | null = null, time = 0, track: Track = "danno") {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Basamento comune: ombra, pietra scura con un bordo chiaro e un anello interno, per staccare la torre dalla terra.
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath();
  ctx.ellipse(T * 0.05, T * 0.08, T * 0.42, T * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a2124";
  ctx.strokeStyle = level >= 5 ? COLORS.brass : "rgba(238,228,203,.55)";
  ctx.lineWidth = Math.max(1, T * (level >= 5 ? 0.05 : 0.03));
  ctx.beginPath();
  ctx.arc(0, 0, T * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.07)";
  ctx.lineWidth = Math.max(1, T * 0.04);
  ctx.beginPath();
  ctx.arc(0, 0, T * 0.33, Math.PI * 1.05, Math.PI * 1.75);
  ctx.stroke();

  if (kind === "balestra") {
    ctx.rotate(angle);
    ctx.strokeStyle = branch === "B" ? COLORS.coral : COLORS.brass;
    ctx.lineWidth = T * 0.08;
    ctx.beginPath();
    ctx.arc(-T * 0.02, 0, T * 0.27, -1.05, 1.05);
    ctx.stroke();
    ctx.strokeStyle = COLORS.cream;
    ctx.lineWidth = T * 0.05;
    ctx.beginPath();
    ctx.moveTo(-T * 0.27, 0);
    ctx.lineTo(T * 0.33, 0);
    ctx.stroke();
    if (branch === "A") {
      ctx.beginPath();
      ctx.moveTo(-T * 0.17, -T * 0.11);
      ctx.lineTo(T * 0.24, -T * 0.11);
      ctx.moveTo(-T * 0.17, T * 0.11);
      ctx.lineTo(T * 0.24, T * 0.11);
      ctx.lineWidth = T * 0.03;
      ctx.stroke();
    }
  } else if (kind === "mortaio") {
    ctx.fillStyle = COLORS.iron;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + Math.PI / 8;
      const px = Math.cos(a) * T * 0.3;
      const py = Math.sin(a) * T * 0.3;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.rotate(angle);
    ctx.fillStyle = "#2b3236";
    ctx.fillRect(-T * 0.08, -T * 0.13, T * 0.36, T * 0.26);
    ctx.fillStyle = branch === "B" ? COLORS.coral : branch === "A" ? COLORS.brass : COLORS.cream;
    ctx.fillRect(T * 0.24, -T * 0.14, T * 0.07, T * 0.28);
  } else if (kind === "arpione") {
    ctx.rotate(angle);
    ctx.strokeStyle = "#8a7a58";
    ctx.lineWidth = Math.max(1, T * 0.03);
    ctx.beginPath();
    ctx.arc(-T * 0.1, 0, T * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = COLORS.cream;
    ctx.lineWidth = T * 0.06;
    ctx.beginPath();
    ctx.moveTo(-T * 0.3, 0);
    ctx.lineTo(T * 0.26, 0);
    ctx.stroke();
    ctx.fillStyle = branch === "B" ? COLORS.coral : "#c9b8ff";
    ctx.beginPath();
    ctx.moveTo(T * 0.4, 0);
    ctx.lineTo(T * 0.22, -T * 0.11);
    ctx.lineTo(T * 0.26, 0);
    ctx.lineTo(T * 0.22, T * 0.11);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "mitragliera") {
    ctx.rotate(angle);
    ctx.fillStyle = "#2b3236";
    ctx.fillRect(-T * 0.16, -T * 0.16, T * 0.26, T * 0.32);
    ctx.save();
    ctx.translate(T * 0.12, 0);
    ctx.rotate(branch === "A" ? time * 0.03 : time * 0.012);
    ctx.fillStyle = branch === "B" ? "#fff1b0" : "#c9b8ff";
    for (let i = 0; i < 3; i++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.fillRect(0, -T * 0.035, T * 0.24, T * 0.07);
    }
    ctx.restore();
  } else if (kind === "purificatore") {
    const pulse = 1 + 0.08 * Math.sin(time * 0.006);
    ctx.fillStyle = branch === "B" ? COLORS.coral : "#fff1b0";
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const r = (i % 2 ? T * 0.13 : T * 0.3) * pulse;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#c9b8ff";
    ctx.beginPath();
    ctx.arc(0, 0, T * 0.08, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "grammofono") {
    // Il DJ: un disco che gira e una tromba del colore del disco scelto.
    ctx.fillStyle = "#0a0f11";
    ctx.beginPath();
    ctx.arc(0, T * 0.05, T * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(238,228,203,.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, T * 0.05, T * 0.17, time * 0.004, time * 0.004 + 4);
    ctx.stroke();
    ctx.fillStyle = TRACK_COLORS[track];
    ctx.beginPath();
    ctx.arc(0, T * 0.05, T * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(T * 0.05, -T * 0.05);
    ctx.lineTo(T * 0.32, -T * 0.34);
    ctx.lineTo(T * 0.12, -T * 0.38);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "capitano") {
    ctx.strokeStyle = COLORS.cream;
    ctx.lineWidth = Math.max(1, T * 0.04);
    ctx.beginPath();
    ctx.moveTo(-T * 0.12, T * 0.28);
    ctx.lineTo(-T * 0.12, -T * 0.3);
    ctx.stroke();
    ctx.fillStyle = branch === "B" ? COLORS.coral : COLORS.brass;
    const wave = Math.sin(time * 0.006) * T * 0.03;
    ctx.beginPath();
    ctx.moveTo(-T * 0.12, -T * 0.3);
    ctx.quadraticCurveTo(T * 0.08, -T * 0.3 + wave, T * 0.28, -T * 0.2);
    ctx.lineTo(-T * 0.12, -T * 0.05);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "medico") {
    ctx.fillStyle = COLORS.cream;
    ctx.beginPath();
    ctx.arc(0, 0, T * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = branch === "A" ? COLORS.brass : "#3f9b6b";
    ctx.fillRect(-T * 0.06, -T * 0.17, T * 0.12, T * 0.34);
    ctx.fillRect(-T * 0.17, -T * 0.06, T * 0.34, T * 0.12);
  } else if (kind === "cecchino") {
    ctx.rotate(angle);
    ctx.fillStyle = "#2b3236";
    ctx.beginPath();
    ctx.arc(0, 0, T * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = branch === "B" ? COLORS.coral : branch === "A" ? COLORS.brass : COLORS.cream;
    ctx.fillRect(-T * 0.06, -T * 0.045, T * 0.44, T * 0.09);
    ctx.fillStyle = COLORS.iron;
    ctx.fillRect(-T * 0.02, -T * 0.13, T * 0.16, T * 0.06);
  } else if (kind === "bobina") {
    ctx.strokeStyle = branch === "B" ? COLORS.coral : "#c9b8ff";
    ctx.lineWidth = Math.max(1, T * 0.045);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, T * (0.12 - i * 0.12), T * (0.26 - i * 0.04), T * 0.08, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.cream;
    ctx.beginPath();
    ctx.arc(0, -T * 0.22, T * 0.07, 0, Math.PI * 2);
    ctx.fill();
    if (time && Math.floor(time / 120) % 3 === 0) {
      ctx.strokeStyle = "#e9e2ff";
      ctx.lineWidth = Math.max(1, T * 0.025);
      ctx.beginPath();
      ctx.moveTo(0, -T * 0.22);
      ctx.lineTo(T * 0.12, -T * 0.3);
      ctx.lineTo(T * 0.06, -T * 0.36);
      ctx.stroke();
    }
  } else if (kind === "officina") {
    ctx.rotate(time * 0.0003);
    ctx.fillStyle = branch === "B" ? COLORS.coral : COLORS.brass;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const r = i % 2 ? T * 0.22 : T * 0.3;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1a2124";
    ctx.beginPath();
    ctx.arc(0, 0, T * 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "sledger") {
    // Sledger: martello pesante con la testa di ghiaccio, girato verso il bersaglio.
    ctx.rotate(angle);
    ctx.fillStyle = "#5a4330";
    ctx.fillRect(-T * 0.26, -T * 0.035, T * 0.42, T * 0.07);
    ctx.fillStyle = branch === "A" ? "#bfe8ff" : branch === "B" ? "#8fd0ff" : "#c7d2d8";
    ctx.strokeStyle = "#e9f6ff";
    ctx.lineWidth = Math.max(1, T * 0.025);
    ctx.beginPath();
    ctx.rect(T * 0.12, -T * 0.2, T * 0.2, T * 0.4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillRect(T * 0.15, -T * 0.16, T * 0.05, T * 0.32);
  } else if (kind === "executioner") {
    // Executioner: ascia a mezzaluna sopra un ceppo scuro.
    ctx.fillStyle = "#2b2422";
    ctx.beginPath();
    ctx.ellipse(0, T * 0.18, T * 0.28, T * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(angle);
    ctx.fillStyle = "#6b4a2e";
    ctx.fillRect(-T * 0.2, -T * 0.03, T * 0.42, T * 0.06);
    ctx.fillStyle = branch === "A" ? COLORS.coral : branch === "B" ? "#c9b8ff" : "#d6dde0";
    ctx.beginPath();
    ctx.moveTo(T * 0.12, -T * 0.04);
    ctx.quadraticCurveTo(T * 0.42, -T * 0.32, T * 0.3, -T * 0.04);
    ctx.lineTo(T * 0.3, T * 0.04);
    ctx.quadraticCurveTo(T * 0.42, T * 0.32, T * 0.12, T * 0.04);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "starcannon") {
    // Star Cannon: canna larga puntata in alto, anelli dorati e una stella sulla bocca.
    ctx.rotate(angle);
    ctx.fillStyle = "#1f2a44";
    ctx.strokeStyle = branch === "A" ? "#ffd86b" : branch === "B" ? "#a5e4ec" : "#c9b8ff";
    ctx.lineWidth = Math.max(1, T * 0.03);
    ctx.beginPath();
    ctx.rect(-T * 0.18, -T * 0.12, T * 0.56, T * 0.24);
    ctx.fill();
    ctx.stroke();
    for (const k of [0.02, 0.18]) {
      ctx.fillStyle = "#ffd86b";
      ctx.fillRect(T * k, -T * 0.14, T * 0.05, T * 0.28);
    }
    ctx.fillStyle = "#fff1b0";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5;
      const rr = i % 2 ? T * 0.04 : T * 0.1;
      ctx.lineTo(T * 0.38 + Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  } else if (kind === "accelerator") {
    // Accelerator: anello con un nucleo che si accende e due elettrodi.
    ctx.rotate(angle);
    ctx.strokeStyle = branch === "B" ? COLORS.coral : "#7fe3ff";
    ctx.lineWidth = Math.max(1, T * 0.05);
    ctx.beginPath();
    ctx.arc(0, 0, T * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#d9fbff";
    ctx.beginPath();
    ctx.arc(0, 0, T * (0.07 + 0.02 * Math.sin(time * 0.02)), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2b3236";
    ctx.fillRect(T * 0.12, -T * 0.05, T * 0.28, T * 0.1);
    ctx.fillStyle = "#7fe3ff";
    ctx.fillRect(T * 0.34, -T * 0.035, T * 0.06, T * 0.07);
  } else if (kind === "kingpin") {
    // Kingpin: cilindro e fascia d'oro, gessato scuro.
    ctx.fillStyle = "#14181b";
    ctx.strokeStyle = branch === "A" ? "#9fd28b" : branch === "B" ? COLORS.coral : COLORS.brass;
    ctx.lineWidth = T * 0.035;
    ctx.beginPath();
    ctx.ellipse(0, T * 0.12, T * 0.3, T * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-T * 0.18, -T * 0.28, T * 0.36, T * 0.4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = branch === "A" ? "#9fd28b" : branch === "B" ? COLORS.coral : COLORS.brass;
    ctx.fillRect(-T * 0.18, T * 0.02, T * 0.36, T * 0.07);
    // Gessato.
    ctx.strokeStyle = "rgba(238,228,203,.25)";
    ctx.lineWidth = Math.max(1, T * 0.012);
    ctx.beginPath();
    for (const dx of [-0.09, 0, 0.09]) {
      ctx.moveTo(T * dx, -T * 0.26);
      ctx.lineTo(T * dx, T * 0.0);
    }
    ctx.stroke();
  } else if (kind === "custode") {
    // Lanterna del Custode: un occhio d'oro dentro una lanterna bianca.
    ctx.rotate(angle);
    ctx.fillStyle = "#f6efd8";
    ctx.strokeStyle = COLORS.brass;
    ctx.lineWidth = T * 0.04;
    ctx.beginPath();
    ctx.moveTo(-T * 0.2, -T * 0.24);
    ctx.lineTo(T * 0.2, -T * 0.24);
    ctx.lineTo(T * 0.26, T * 0.2);
    ctx.lineTo(-T * 0.26, T * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = branch === "B" ? COLORS.coral : COLORS.brass;
    ctx.beginPath();
    ctx.ellipse(0, -T * 0.02, T * 0.15, T * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a2124";
    ctx.beginPath();
    ctx.arc(0, -T * 0.02, T * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.brass;
    ctx.beginPath();
    ctx.moveTo(T * 0.26, 0);
    ctx.lineTo(T * 0.38, 0);
    ctx.stroke();
  } else if (kind === "campana") {
    const swing = Math.sin(time * 0.003) * 0.25;
    ctx.rotate(swing);
    ctx.fillStyle = COLORS.brass;
    ctx.strokeStyle = "#f6efd8";
    ctx.lineWidth = T * 0.035;
    ctx.beginPath();
    ctx.moveTo(-T * 0.08, -T * 0.28);
    ctx.quadraticCurveTo(-T * 0.2, -T * 0.25, -T * 0.2, T * 0.05);
    ctx.lineTo(-T * 0.29, T * 0.2);
    ctx.lineTo(T * 0.29, T * 0.2);
    ctx.lineTo(T * 0.2, T * 0.05);
    ctx.quadraticCurveTo(T * 0.2, -T * 0.25, T * 0.08, -T * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = branch === "B" ? COLORS.ice : "#1a2124";
    ctx.beginPath();
    ctx.arc(0, T * 0.25, T * 0.06, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "cometa") {
    ctx.rotate(angle);
    // Coda della cometa.
    ctx.strokeStyle = branch === "B" ? "rgba(165,228,236,.8)" : "rgba(255,226,150,.75)";
    ctx.lineWidth = T * 0.06;
    for (const dy of [-0.08, 0, 0.08]) {
      ctx.beginPath();
      ctx.moveTo(-T * 0.05, T * dy);
      ctx.lineTo(-T * 0.33, T * dy * 2.2);
      ctx.stroke();
    }
    ctx.fillStyle = "#fff6d6";
    ctx.strokeStyle = COLORS.brass;
    ctx.lineWidth = T * 0.03;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2 + time * 0.0008;
      const r = i % 2 ? T * 0.09 : T * 0.21;
      ctx.lineTo(T * 0.1 + Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    const spin = time * 0.0004;
    ctx.strokeStyle = branch === "B" ? COLORS.coral : COLORS.ice;
    ctx.lineWidth = T * 0.055;
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate(spin + (i * Math.PI) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(T * 0.3, 0);
      ctx.moveTo(T * 0.18, 0);
      ctx.lineTo(T * 0.26, T * 0.07);
      ctx.moveTo(T * 0.18, 0);
      ctx.lineTo(T * 0.26, -T * 0.07);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();

  // Tacche di livello sotto la torre.
  if (level > 1) {
    ctx.save();
    ctx.fillStyle = level >= 4 ? (branch === "B" ? COLORS.coral : COLORS.brass) : COLORS.cream;
    const n = Math.min(level, 4);
    const gap = T * 0.13;
    const start = x - ((n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(start + i * gap, y + T * 0.4, T * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------- nemici ----------

/** Raggio del nemico in caselle: serve al disegno, all'anello del rallentamento e alla barra della vita. */
export function enemySize(e: Pick<Enemy, "kind" | "boss">): number {
  const base: Partial<Record<string, number>> = {
    risacca: 0.22, corridore: 0.2, sabotatore: 0.25, bruto: 0.33, annegato: 0.52, sirena: 0.5, leviatano: 0.78,
    tizzone: 0.2, magmatico: 0.34, colosso: 0.66, spettro: 0.24, cavaliere: 0.34, recaduto: 0.62, risvegliato: 0.8, ombra: 0.22, araldo: 0.4, lancia: 0.34, brinato: 0.27, orso: 0.38, regina: 0.62,
    elfo: 0.19, pupazzetto: 0.28, folletto: 0.48, renna: 0.55, pupazzo: 0.7, befana: 0.56, krampus: 0.8,
    dohoter: 0.74,
  };
  const r = base[e.kind] ?? 0.3;
  return e.kind === "bruto" && e.boss ? 0.53 : r;
}

const NEW_KINDS = new Set(["tizzone", "magmatico", "colosso", "spettro", "cavaliere", "recaduto", "brinato", "orso", "regina", "elfo", "pupazzetto", "folletto", "renna", "pupazzo", "befana", "krampus", "dohoter", "risvegliato", "ombra", "araldo", "lancia"]);

function poly(ctx: CanvasRenderingContext2D, n: number, r: number, inner: number, spin: number) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n + spin;
    const rr = i % 2 ? r * inner : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
}

function eyes(ctx: CanvasRenderingContext2D, r: number, color: string, dy = -0.12, gap = 0.3, size = 0.12) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(-r * gap, r * dy, r * size, 0, Math.PI * 2);
  ctx.arc(r * gap, r * dy, r * size, 0, Math.PI * 2);
  ctx.fill();
}

let faceImg: HTMLImageElement | null = null;
/** Foto del Dohoter Gang, caricata una volta sola al primo disegno. */
function dohoterFace(): HTMLImageElement {
  if (!faceImg) {
    faceImg = new Image();
    faceImg.src = DOHOTER_FACE;
  }
  return faceImg;
}

function drawNewKind(ctx: CanvasRenderingContext2D, e: Enemy, T: number, time: number, still: boolean, phase: number) {
  const r = T * enemySize(e);
  const lw = Math.max(1.2, T * (e.boss ? 0.055 : 0.035));
  const t = still ? 0 : time;
  ctx.lineWidth = lw;
  const flick = still ? 1 : 1 + 0.08 * Math.sin(t * 0.02 + phase);
  switch (e.kind) {
    case "tizzone":
      ctx.fillStyle = "#3a1208";
      ctx.strokeStyle = "#ff8a3c";
      poly(ctx, 5, r * flick, 0.6, t * 0.004);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffd27a";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "magmatico":
    case "colosso":
      ctx.fillStyle = "#2a0f08";
      ctx.strokeStyle = e.kind === "colosso" ? "#ff7a3a" : "#e2714f";
      poly(ctx, e.kind === "colosso" ? 9 : 4, r, e.kind === "colosso" ? 0.78 : 0.86, Math.PI / 4 + (e.kind === "colosso" ? t * 0.0006 : 0));
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,170,80,${0.6 + 0.3 * Math.sin(t * 0.006 + phase)})`;
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.2);
      ctx.lineTo(-r * 0.1, r * 0.1);
      ctx.lineTo(r * 0.35, -r * 0.05);
      ctx.moveTo(-r * 0.1, r * 0.1);
      ctx.lineTo(0, r * 0.5);
      ctx.stroke();
      eyes(ctx, r, "#ffd27a", -0.3, 0.32, 0.1);
      break;
    case "spettro":
      ctx.fillStyle = "rgba(201,184,255,.22)";
      ctx.strokeStyle = "rgba(201,184,255,.8)";
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r * 0.8, Math.PI, 0);
      for (let i = 0; i <= 6; i++) ctx.lineTo(r * 0.8 - (i * r * 1.6) / 6, r * 0.7 + (i % 2 ? -r * 0.25 : 0) + (still ? 0 : Math.sin(t * 0.01 + i) * r * 0.06));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      eyes(ctx, r, "#f2ecff", -0.15, 0.3, 0.13);
      break;
    case "cavaliere":
      ctx.fillStyle = "#1e2328";
      ctx.strokeStyle = "#b9a88a";
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -r * 0.8);
      ctx.lineTo(r * 0.8, -r * 0.8);
      ctx.lineTo(r * 0.8, r * 0.1);
      ctx.quadraticCurveTo(r * 0.6, r * 0.8, 0, r);
      ctx.quadraticCurveTo(-r * 0.6, r * 0.8, -r * 0.8, r * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ff9a9a";
      ctx.fillRect(-r * 0.5, -r * 0.35, r, r * 0.14);
      break;
    case "recaduto":
    case "risvegliato":
    case "regina": {
      const ice = e.kind === "regina";
      const woke = e.kind === "risvegliato";
      if (woke) {
        // Il Re Risvegliato: alone rosso che pulsa.
        ctx.fillStyle = `rgba(255,70,70,${0.18 + 0.12 * Math.sin(t * 0.01)})`;
        ctx.beginPath();
        ctx.arc(0, r * 0.1, r * 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = ice ? "#123a46" : woke ? "#2a0d12" : "#1a1622";
      ctx.strokeStyle = ice ? COLORS.ice : woke ? "#ff6b6b" : "#c9b8ff";
      ctx.beginPath();
      if (ice) {
        ctx.moveTo(0, -r * 0.6);
        ctx.lineTo(r * 0.85, r * 0.9);
        ctx.lineTo(-r * 0.85, r * 0.9);
        ctx.closePath();
      } else ctx.arc(0, r * 0.1, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Corona.
      ctx.fillStyle = ice ? "#f2fbff" : COLORS.brass;
      ctx.beginPath();
      const cy = -r * (ice ? 0.55 : 0.6);
      ctx.moveTo(-r * 0.55, cy);
      for (let i = 0; i < 5; i++) {
        ctx.lineTo(-r * 0.55 + (i + 0.5) * r * 0.22, cy - r * (i % 2 ? 0.25 : 0.5));
        ctx.lineTo(-r * 0.55 + (i + 1) * r * 0.22, cy);
      }
      ctx.closePath();
      ctx.fill();
      eyes(ctx, r, ice ? "#e9fbff" : woke ? "#ff6b6b" : "#c9b8ff", ice ? 0.15 : 0, 0.28, 0.1);
      break;
    }
    case "brinato":
      ctx.fillStyle = "#10323c";
      ctx.strokeStyle = COLORS.ice;
      poly(ctx, 6, r, 0.88, t * 0.001);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(233,251,255,.85)";
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
        ctx.lineTo(-Math.cos(a) * r * 0.6, -Math.sin(a) * r * 0.6);
      }
      ctx.stroke();
      break;
    case "orso":
      ctx.fillStyle = "#e8f0f2";
      ctx.strokeStyle = COLORS.ice;
      ctx.beginPath();
      ctx.arc(-r * 0.55, -r * 0.6, r * 0.25, 0, Math.PI * 2);
      ctx.arc(r * 0.55, -r * 0.6, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      eyes(ctx, r, "#0b1316", -0.1, 0.3, 0.1);
      ctx.fillStyle = "#0b1316";
      ctx.beginPath();
      ctx.arc(0, r * 0.25, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "elfo":
      ctx.fillStyle = "#1d3a22";
      ctx.strokeStyle = "#ff9a9a";
      ctx.beginPath();
      ctx.arc(0, r * 0.2, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#c8323c";
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.2);
      ctx.lineTo(r * 0.7, -r * 0.2);
      ctx.lineTo(r * 0.2, -r * 1.25);
      ctx.closePath();
      ctx.fill();
      eyes(ctx, r, "#ffe296", 0.15, 0.3, 0.14);
      break;
    case "pupazzetto":
    case "pupazzo": {
      const big = e.kind === "pupazzo";
      ctx.fillStyle = "#eef6f9";
      ctx.strokeStyle = big ? "#ff9a9a" : COLORS.ice;
      ctx.beginPath();
      ctx.arc(0, r * 0.35, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -r * 0.42, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (big) {
        ctx.fillStyle = "#0b1316";
        ctx.fillRect(-r * 0.32, -r * 1.05, r * 0.64, r * 0.32);
        ctx.fillRect(-r * 0.45, -r * 0.78, r * 0.9, r * 0.08);
      }
      eyes(ctx, r, big ? "#e2714f" : "#0b1316", -0.48, 0.16, 0.07);
      ctx.fillStyle = "#ff8a3c";
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.38);
      ctx.lineTo(r * 0.3, -r * 0.32);
      ctx.lineTo(0, -r * 0.28);
      ctx.fill();
      break;
    }
    case "folletto":
      ctx.fillStyle = "#4a3a12";
      ctx.strokeStyle = COLORS.brass;
      ctx.beginPath();
      ctx.ellipse(r * 0.45, r * 0.25, r * 0.45, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#1d3a22";
      ctx.strokeStyle = "#9fd28b";
      ctx.beginPath();
      ctx.arc(-r * 0.15, 0, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#c8323c";
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.35);
      ctx.lineTo(r * 0.4, -r * 0.35);
      ctx.lineTo(-r * 0.6, -r * 1.2);
      ctx.closePath();
      ctx.fill();
      eyes(ctx, r * 0.8, "#ffe296", 0, 0.3, 0.13);
      break;
    case "renna":
      ctx.strokeStyle = "#ff9a9a";
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const s of [-1, 1]) {
        ctx.moveTo(s * r * 0.25, -r * 0.45);
        ctx.lineTo(s * r * 0.55, -r * 1.05);
        ctx.moveTo(s * r * 0.42, -r * 0.8);
        ctx.lineTo(s * r * 0.85, -r * 0.9);
      }
      ctx.stroke();
      ctx.fillStyle = e.chargeLeft > 0 ? "#4a1212" : "#2a1a12";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.75, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      eyes(ctx, r, "#ff4a4a", -0.1, 0.28, 0.1);
      break;
    case "befana":
      ctx.strokeStyle = "rgba(255,226,150,.7)";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(-r * 1.1, r * 0.55);
      ctx.lineTo(r * 1.1, r * 0.2);
      ctx.stroke();
      ctx.fillStyle = "rgba(26,20,24,.75)";
      ctx.strokeStyle = "rgba(255,226,150,.85)";
      ctx.beginPath();
      ctx.arc(0, r * 0.1, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.25);
      ctx.lineTo(r * 0.7, -r * 0.25);
      ctx.lineTo(r * 0.15, -r * 1.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      eyes(ctx, r, "#ffe296", 0.05, 0.22, 0.09);
      break;
    case "krampus":
      ctx.strokeStyle = "#c8b89a";
      ctx.lineWidth = lw * 1.4;
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, -r * 0.6);
      ctx.quadraticCurveTo(-r * 1.1, -r * 1.0, -r * 0.8, -r * 1.35);
      ctx.moveTo(r * 0.35, -r * 0.6);
      ctx.quadraticCurveTo(r * 1.1, -r * 1.0, r * 0.8, -r * 1.35);
      ctx.stroke();
      ctx.fillStyle = "#2a0808";
      ctx.strokeStyle = "#ff4a4a";
      ctx.lineWidth = lw;
      poly(ctx, 10, r * 0.9, 0.82, t * 0.0005);
      ctx.fill();
      ctx.stroke();
      eyes(ctx, r, "#ffd27a", -0.15, 0.3, 0.11);
      ctx.strokeStyle = "#ffd27a";
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, r * 0.3);
      ctx.lineTo(r * 0.35, r * 0.3);
      ctx.stroke();
      break;
    case "ombra": {
      // Ombra del Re: fiamma nera con occhi rossi, sfrangiata in basso.
      const wob = still ? 0 : Math.sin(t * 0.015 + phase) * r * 0.08;
      ctx.fillStyle = "rgba(14,6,12,.92)";
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.05);
      ctx.quadraticCurveTo(r * 0.95, -r * 0.2, r * 0.6 + wob, r * 0.9);
      ctx.lineTo(r * 0.2, r * 0.6);
      ctx.lineTo(-r * 0.15 + wob, r * 0.95);
      ctx.lineTo(-r * 0.45, r * 0.6);
      ctx.lineTo(-r * 0.7 - wob, r * 0.9);
      ctx.quadraticCurveTo(-r * 0.95, -r * 0.2, 0, -r * 1.05);
      ctx.fill();
      eyes(ctx, r, "#ff4d4d", 0, 0.25, 0.12);
      break;
    }
    case "araldo": {
      // Araldo Nero: corazza scura e stendardo rosso che stordisce le torri.
      ctx.fillStyle = "#1b1418";
      ctx.strokeStyle = "#8a2b2b";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, r * 0.85);
      ctx.lineTo(-r * 0.6, -r * 0.45);
      ctx.quadraticCurveTo(0, -r * 0.95, r * 0.6, -r * 0.45);
      ctx.lineTo(r * 0.75, r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#c9b8ff";
      ctx.beginPath();
      ctx.moveTo(r * 0.85, r * 0.9);
      ctx.lineTo(r * 0.85, -r * 1.2);
      ctx.stroke();
      ctx.fillStyle = "#b02a2a";
      const flap = still ? 0 : Math.sin(t * 0.01 + phase) * r * 0.1;
      ctx.beginPath();
      ctx.moveTo(r * 0.85, -r * 1.2);
      ctx.lineTo(r * 1.45, -r * 1.0 + flap);
      ctx.lineTo(r * 0.85, -r * 0.75);
      ctx.closePath();
      ctx.fill();
      eyes(ctx, r, "#ff6b6b", 0, 0.2, 0.09);
      break;
    }
    case "lancia": {
      // Lancia Nera: cavaliere sottile con una lancia lunga puntata avanti.
      ctx.fillStyle = "#16121a";
      ctx.strokeStyle = "#ff6b6b";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.ellipse(0, r * 0.1, r * 0.55, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#d6dde0";
      ctx.lineWidth = lw * 1.3;
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, r * 0.6);
      ctx.lineTo(r * 1.5, -r * 0.7);
      ctx.stroke();
      ctx.fillStyle = "#d6dde0";
      ctx.beginPath();
      ctx.moveTo(r * 1.5, -r * 0.7);
      ctx.lineTo(r * 1.15, -r * 0.62);
      ctx.lineTo(r * 1.32, -r * 0.4);
      ctx.closePath();
      ctx.fill();
      eyes(ctx, r, "#ff6b6b", 0, 0.15, 0.09);
      break;
    }
    case "dohoter": {
      const sway = still ? 0 : Math.sin(t * 0.006 + phase) * 0.08;
      if (dohoterFace().complete && dohoterFace().naturalWidth) {
        // Il volto del boss, in un medaglione viola con la catena d'oro.
        ctx.save();
        ctx.rotate(sway);
        ctx.beginPath();
        ctx.arc(0, -r * 0.05, r * 0.92, 0, Math.PI * 2);
        ctx.save();
        ctx.clip();
        ctx.drawImage(dohoterFace(), -r * 0.92, -r * 0.97, r * 1.84, r * 1.84);
        ctx.restore();
        ctx.strokeStyle = "#b07cff";
        ctx.lineWidth = lw * 1.6;
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = "#ffd24a";
        ctx.lineWidth = lw * 1.6;
        ctx.beginPath();
        ctx.moveTo(-r * 0.62, r * 0.62);
        ctx.quadraticCurveTo(sway * r * 4, r * 1.12, r * 0.62, r * 0.62);
        ctx.stroke();
        ctx.fillStyle = "#ffd24a";
        ctx.beginPath();
        ctx.arc(sway * r * 4, r * 1.03, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      // Finché la foto non è pronta: capo della gang con cappuccio e catena.
      ctx.fillStyle = "#1c1030";
      ctx.strokeStyle = "#b07cff";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, r * 0.85);
      ctx.quadraticCurveTo(-r * 1.0, -r * 0.55, 0, -r * 1.0);
      ctx.quadraticCurveTo(r * 1.0, -r * 0.55, r * 0.95, r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#3a2a20";
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.12, r * 0.48, r * 0.44, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(-r * 0.46, -r * 0.3, r * 0.92, r * 0.17);
      ctx.fillStyle = "rgba(176,124,255,.8)";
      ctx.fillRect(-r * 0.36, -r * 0.27, r * 0.14, r * 0.05);
      ctx.fillRect(r * 0.1, -r * 0.27, r * 0.14, r * 0.05);
      ctx.strokeStyle = "#ffd24a";
      ctx.lineWidth = lw * 1.6;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, r * 0.22);
      ctx.quadraticCurveTo(sway * r * 4, r * 0.75, r * 0.5, r * 0.22);
      ctx.stroke();
      ctx.fillStyle = "#ffd24a";
      ctx.beginPath();
      ctx.arc(sway * r * 4, r * 0.66, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1c1030";
      ctx.font = `700 ${Math.max(8, r * 0.18)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("D", sway * r * 4, r * 0.67);
      break;
    }
  }
}

/** Copie già disegnate dei nemici, per tipo e misura: con tanti nemici costano molto meno dei disegni a mano. */
const spriteCache = new Map<string, HTMLCanvasElement>();
let spriteT = 0;
function enemySprite(e: Enemy, T: number): HTMLCanvasElement {
  const t = Math.round(T);
  if (t !== spriteT) {
    spriteCache.clear();
    spriteT = t;
  }
  const key = `${e.kind}|${e.boss ? 1 : 0}`;
  let c = spriteCache.get(key);
  if (!c) {
    c = document.createElement("canvas");
    // Grande quanto basta: copie piccole costano poco anche da copiare.
    const size = Math.ceil(T * (enemySize(e) * 3.4 + 0.3)) + 4;
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    g.translate(size / 2, size / 2);
    enemyBody(g, { ...e, id: 0, mods: 0, hp: 1, maxHp: 1 }, T, 0, true, 0, true);
    spriteCache.set(key, c);
  }
  return c;
}

/** Corpo del nemico disegnato nell'origine: ombra e forma del tipo. */
function enemyBody(ctx: CanvasRenderingContext2D, e: Enemy, T: number, time: number, still: boolean, phase: number, solid = false) {
  const def = ENEMIES[e.kind];
  void def;
  // Ombra sul fondale: stacca il nemico dall'acqua nera.
  const sr = T * enemySize(e);
  ctx.fillStyle = "rgba(0,0,0,.4)";
  ctx.beginPath();
  ctx.ellipse(sr * 0.12, sr * 0.75, sr * 0.95, sr * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // Gli invisibili si vedono appena: il giocatore sa che ci sono, le torri senza rilevamento no.
  if (!solid && isHidden(e)) ctx.globalAlpha = 0.5;
  if (e.kind === "risacca") {
    const r = T * 0.2;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const wob = still ? 1 : 1 + 0.13 * Math.sin(time * 0.009 + phase + i * 2.1);
      const px = Math.cos(a) * r * wob;
      const py = Math.sin(a) * r * wob;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = "#050b0e";
    ctx.fill();
    ctx.strokeStyle = "rgba(165,228,236,.85)";
    ctx.lineWidth = Math.max(1, T * 0.03);
    ctx.stroke();
    ctx.fillStyle = "#e9f7f2";
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.15, r * 0.17, 0, Math.PI * 2);
    ctx.arc(r * 0.3, -r * 0.15, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === "annegato") {
    const r = T * 0.5;
    ctx.fillStyle = "#1d2a26";
    ctx.strokeStyle = "#7fb7a4";
    ctx.lineWidth = Math.max(1.5, T * 0.05);
    ctx.beginPath();
    ctx.arc(0, r * 0.1, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Tricorno del capitano.
    ctx.fillStyle = "#0b1110";
    ctx.strokeStyle = COLORS.brass;
    ctx.beginPath();
    ctx.moveTo(-r * 0.95, -r * 0.35);
    ctx.quadraticCurveTo(0, -r * 1.25, r * 0.95, -r * 0.35);
    ctx.quadraticCurveTo(0, -r * 0.6, -r * 0.95, -r * 0.35);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#c8f5e6";
    ctx.beginPath();
    ctx.arc(-r * 0.3, r * 0.05, r * 0.11, 0, Math.PI * 2);
    ctx.arc(r * 0.3, r * 0.05, r * 0.11, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === "sirena") {
    const r = T * 0.46;
    ctx.strokeStyle = "rgba(165,228,236,.7)";
    ctx.lineWidth = Math.max(1, T * 0.04);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.45;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.4);
      ctx.quadraticCurveTo(Math.cos(a) * r * 1.2, Math.sin(a) * r * 0.4 + (still ? 0 : Math.sin(time * 0.004 + i) * r * 0.2), Math.cos(a) * r * 1.3, r * 0.6);
      ctx.stroke();
    }
    ctx.fillStyle = "#123a40";
    ctx.strokeStyle = "#a5e4ec";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.55, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#ffe296";
    ctx.beginPath();
    ctx.arc(0, r * 0.15, r * 0.16, 0, Math.PI * 2);
    ctx.stroke();
  } else if (e.kind === "leviatano") {
    const r = T * 0.72;
    ctx.fillStyle = "#0c2420";
    ctx.strokeStyle = COLORS.coral;
    ctx.lineWidth = Math.max(2, T * 0.06);
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const a = (i * Math.PI) / 9 + (still ? 0 : time * 0.0008);
      const rr = i % 2 ? r * 0.78 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ff8a5c";
    ctx.beginPath();
    ctx.ellipse(-r * 0.28, -r * 0.1, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
    ctx.ellipse(r * 0.28, -r * 0.1, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === "sabotatore") {
    const r = T * 0.22;
    ctx.fillStyle = "#1c1630";
    ctx.strokeStyle = "#c9b8ff";
    ctx.lineWidth = Math.max(1, T * 0.035);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 + (still ? 0 : time * 0.002);
      const rr = i % 2 ? r * 0.75 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = e.act < 10 ? "#ffe296" : "#c9b8ff";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === "corridore") {
    const r = T * 0.17;
    const bob = still ? 0 : Math.sin(time * 0.03 + phase) * r * 0.15;
    ctx.fillStyle = "#0b1316";
    ctx.strokeStyle = COLORS.brass;
    ctx.lineWidth = Math.max(1, T * 0.03);
    ctx.beginPath();
    ctx.moveTo(-r * 1.3, bob);
    ctx.lineTo(0, -r);
    ctx.lineTo(r * 1.3, 0);
    ctx.lineTo(0, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff1c4";
    ctx.beginPath();
    ctx.arc(r * 0.35, -r * 0.2, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (NEW_KINDS.has(e.kind)) {
    drawNewKind(ctx, e, T, time, still, phase);
  } else {
    const r = T * (e.boss ? 0.5 : 0.3);
    ctx.fillStyle = "#3d1c14";
    ctx.strokeStyle = e.boss ? COLORS.brass : COLORS.coral;
    ctx.lineWidth = Math.max(1.5, T * (e.boss ? 0.06 : 0.04));
    ctx.beginPath();
    ctx.moveTo(-r, -r * 0.45);
    ctx.lineTo(-r * 0.45, -r);
    ctx.lineTo(r * 0.45, -r);
    ctx.lineTo(r, -r * 0.45);
    ctx.lineTo(r, r * 0.45);
    ctx.lineTo(r * 0.45, r);
    ctx.lineTo(-r * 0.45, r);
    ctx.lineTo(-r, r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Cirripedi sulla corazza.
    ctx.fillStyle = COLORS.coral;
    for (let i = 0; i < 5; i++) {
      const a = phase + i * 1.9;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd9a6";
    ctx.fillRect(-r * 0.42, -r * 0.2, r * 0.24, r * 0.12);
    ctx.fillRect(r * 0.18, -r * 0.2, r * 0.24, r * 0.12);
  }
}

/** Versione rapida per le folle: copia già pronta a coordinate intere e barra della vita essenziale. */
function drawEnemyFast(ctx: CanvasRenderingContext2D, e: Enemy, x: number, y: number, T: number) {
  const img = enemySprite(e, T);
  const hidden = isHidden(e);
  if (hidden) ctx.globalAlpha = 0.5;
  ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
  if (hidden) ctx.globalAlpha = 1;
  if (e.hp < e.maxHp) {
    const w = Math.round(T * (e.boss ? 1.1 : 0.5));
    const h = Math.max(2, Math.round(T * (e.boss ? 0.09 : 0.06)));
    const left = Math.round(x - w / 2);
    const top = Math.round(y - T * (enemySize(e) + 0.12));
    const f = Math.max(0, e.hp) / e.maxHp;
    ctx.fillStyle = "#1a0d0a";
    ctx.fillRect(left, top, w, h);
    ctx.fillStyle = f > 0.6 ? "#9fd28b" : f > 0.3 ? "#e8c35a" : COLORS.coral;
    ctx.fillRect(left, top, Math.max(1, Math.round(w * f)), h);
  }
}

export function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, x: number, y: number, T: number, time: number, still: boolean, cached = false) {
  if (cached) return drawEnemyFast(ctx, e, x, y, T);
  const def = ENEMIES[e.kind];
  const phase = e.id * 1.7;
  ctx.save();
  ctx.translate(x, y);
  ctx.save();
  enemyBody(ctx, e, T, time, still, phase);
  ctx.restore();
  if (e.speedBp < 10000 && e.kind) {
    ctx.strokeStyle = "rgba(165,228,236,.8)";
    ctx.lineWidth = Math.max(1, T * 0.02);
    ctx.setLineDash([T * 0.05, T * 0.05]);
    ctx.beginPath();
    ctx.arc(0, 0, T * (enemySize(e) + 0.05), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (e.stun > 0) {
    ctx.fillStyle = COLORS.brass;
    for (let i = 0; i < 3; i++) {
      const a = time * 0.008 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * T * 0.22, -T * 0.32 + Math.sin(a) * T * 0.06, T * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  if (e.hp < e.maxHp) {
    const w = T * (e.boss ? 1.1 : def.hp > 100 ? 0.6 : 0.42);
    const h = Math.max(3, T * (e.boss ? 0.09 : 0.07));
    const top = y - T * (enemySize(e) + 0.12);
    const f = Math.max(0, e.hp) / e.maxHp;
    ctx.fillStyle = "rgba(0,0,0,.8)";
    ctx.fillRect(x - w / 2 - 1.5, top - 1.5, w + 3, h + 3);
    ctx.fillStyle = "#3a1d16";
    ctx.fillRect(x - w / 2, top, w, h);
    // Dal verde al giallo al rosso man mano che scende.
    ctx.fillStyle = f > 0.6 ? "#9fd28b" : f > 0.3 ? "#e8c35a" : COLORS.coral;
    ctx.fillRect(x - w / 2, top, w * f, h);
    if (e.shield > 0) {
      ctx.fillStyle = "rgba(201,184,255,.9)";
      ctx.fillRect(x - w / 2, top, Math.min(w, (w * e.shield) / e.maxHp), Math.max(1.5, h * 0.4));
    }
  }
}
