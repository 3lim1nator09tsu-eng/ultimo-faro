// Personaggi a blocchi visti dall'alto, in stile cartone: torri e nemici usano lo stesso omino.
// Tutto è disegnato con il personaggio rivolto verso destra (asse x); chi chiama ruota prima.
import { Branch, TowerKind } from "../sim-core/content";

type C = CanvasRenderingContext2D;
const INK = "#0d1418";
const TAU = Math.PI * 2;
const BRASS = "#e0b354";
const CORAL = "#e2714f";
const SKIN = "#f2c79b";
const WOOD = "#8a5a33";
const DARK = "#2b3236";

// ---------- mattoni ----------

function rrPath(c: C, x: number, y: number, w: number, h: number, r: number) {
  const q = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + q, y);
  c.arcTo(x + w, y, x + w, y + h, q);
  c.arcTo(x + w, y + h, x, y + h, q);
  c.arcTo(x, y + h, x, y, q);
  c.arcTo(x, y, x + w, y, q);
  c.closePath();
}

function box(c: C, x: number, y: number, w: number, h: number, r: number, fill: string, lw: number, stroke = INK) {
  rrPath(c, x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  if (lw) {
    c.strokeStyle = stroke;
    c.lineWidth = lw;
    c.stroke();
  }
}

function dot(c: C, x: number, y: number, r: number, fill: string, lw = 0, stroke = INK) {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fillStyle = fill;
  c.fill();
  if (lw) {
    c.strokeStyle = stroke;
    c.lineWidth = lw;
    c.stroke();
  }
}

function oval(c: C, x: number, y: number, rx: number, ry: number, fill: string, lw = 0, rot = 0) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, TAU);
  c.fillStyle = fill;
  c.fill();
  if (lw) {
    c.strokeStyle = INK;
    c.lineWidth = lw;
    c.stroke();
  }
}

/** Un arto o un'asta: tratto colorato con il contorno scuro. */
function limb(c: C, x0: number, y0: number, x1: number, y1: number, w: number, fill: string, lw: number) {
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.strokeStyle = INK;
  c.lineWidth = w + lw * 2;
  c.stroke();
  c.strokeStyle = fill;
  c.lineWidth = w;
  c.stroke();
}

function shape(c: C, pts: number[], fill: string, lw: number, stroke = INK) {
  c.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) c.moveTo(pts[i], pts[i + 1]);
    else c.lineTo(pts[i], pts[i + 1]);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (lw) {
    c.lineJoin = "round";
    c.strokeStyle = stroke;
    c.lineWidth = lw;
    c.stroke();
  }
}

function star(c: C, x: number, y: number, r: number, fill: string, n = 4, inner = 0.4, spin = 0) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = spin + (i * Math.PI) / n;
    const q = i % 2 ? r * inner : r;
    c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

// ---------- l'omino ----------

interface Look {
  skin: string;
  shirt: string;
  sleeve?: string;
  head?: "round" | "block";
  arms?: "hold" | "zombie" | "side" | "none";
  reach?: number;
  eyes?: string | null;
  step?: number; // -1..1: passo
  bulk?: number;
  headSize?: number;
  feet?: string | null;
  pull?: number; // rinculo: le mani arretrano
}

interface Parts {
  back?: (lw: number) => void; // sotto il busto: mantelli, zaini
  chest?: (lw: number) => void; // sopra il busto
  held?: (lw: number) => void; // tra le braccia e le mani
  hat?: (hx: number, hr: number, lw: number) => void;
}

function person(c: C, s: number, k: Look, p: Parts = {}) {
  const lw = Math.max(1, s * 0.11);
  const step = k.step ?? 0;
  const bulk = k.bulk ?? 1;
  c.lineJoin = "round";
  if (k.feet !== null) {
    for (const side of [-1, 1]) oval(c, side * step * 0.55 * s + 0.05 * s, side * 0.45 * s, 0.36 * s, 0.25 * s, k.feet ?? "#1b2226", lw);
  }
  p.back?.(lw);
  box(c, -0.44 * s * bulk, -s * bulk, 0.88 * s * bulk, 2 * s * bulk, 0.32 * s, k.shirt, lw);
  p.chest?.(lw);
  const sl = k.sleeve ?? k.shirt;
  const pull = (k.pull ?? 0) * s;
  const mode = k.arms ?? "hold";
  const reach = (k.reach ?? (mode === "hold" ? 1.3 : 1)) * s;
  const sh = 0.84 * s * bulk;
  let hands: number[] = [];
  if (mode === "hold") hands = [reach - pull, -0.14 * s, reach * 0.5 - pull, 0.22 * s];
  else if (mode === "zombie") hands = [reach * 1.2 + step * 0.12 * s, -0.5 * s, reach * 1.2 - step * 0.12 * s, 0.5 * s];
  else if (mode === "side") hands = [-step * 0.5 * s + 0.1 * s, -1.12 * s * bulk, step * 0.5 * s + 0.1 * s, 1.12 * s * bulk];
  if (mode !== "none") {
    limb(c, 0.05 * s, -sh, hands[0], hands[1], 0.34 * s, sl, lw);
    limb(c, 0.05 * s, sh, hands[2], hands[3], 0.34 * s, sl, lw);
  }
  p.held?.(lw);
  if (mode !== "none") {
    dot(c, hands[0], hands[1], 0.25 * s, k.skin, lw);
    dot(c, hands[2], hands[3], 0.25 * s, k.skin, lw);
  }
  const hx = 0.12 * s;
  const hr = 0.58 * s * (k.headSize ?? 1);
  if (k.head === "block") box(c, hx - hr, -hr, hr * 2, hr * 2, hr * 0.35, k.skin, lw);
  else dot(c, hx, 0, hr, k.skin, lw);
  if (k.eyes !== null) {
    const col = k.eyes ?? INK;
    for (const side of [-1, 1]) {
      if (col !== INK) dot(c, hx + hr * 0.48, side * hr * 0.4, hr * 0.24, INK);
      dot(c, hx + hr * 0.48, side * hr * 0.4, hr * (col === INK ? 0.15 : 0.16), col);
    }
  }
  p.hat?.(hx, hr, lw);
}

// ---------- cappelli ----------

const helmet = (c: C, hx: number, hr: number, lw: number, col: string, band?: string) => {
  dot(c, hx - hr * 0.3, 0, hr * 0.98, col, lw);
  if (band) {
    c.strokeStyle = band;
    c.lineWidth = hr * 0.2;
    c.beginPath();
    c.arc(hx - hr * 0.3, 0, hr * 0.55, 0, TAU);
    c.stroke();
  }
};
const hood = (c: C, hx: number, hr: number, lw: number, col: string) => {
  c.beginPath();
  c.arc(hx - hr * 0.1, 0, hr * 1.12, 0.75, TAU - 0.75);
  c.lineTo(hx - hr * 1.45, 0);
  c.closePath();
  c.fillStyle = col;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = lw;
  c.stroke();
};
const brim = (c: C, hx: number, hr: number, lw: number, col: string, band: string, wide = 1.35) => {
  dot(c, hx - hr * 0.38, 0, hr * wide * 0.86, col, lw);
  dot(c, hx - hr * 0.38, 0, hr * 0.62, col, lw * 0.8);
  c.strokeStyle = band;
  c.lineWidth = hr * 0.16;
  c.beginPath();
  c.arc(hx - hr * 0.38, 0, hr * 0.72, 0, TAU);
  c.stroke();
};
const crown = (c: C, hx: number, hr: number, lw: number, col: string, gem?: string) => {
  c.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const q = i % 2 ? hr * 0.72 : hr * 1.05;
    c.lineTo(hx + Math.cos(a) * q, Math.sin(a) * q);
  }
  c.closePath();
  c.fillStyle = col;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = lw;
  c.stroke();
  dot(c, hx, 0, hr * 0.42, gem ?? INK, lw * 0.7);
};
const horns = (c: C, hx: number, hr: number, lw: number, col: string, len = 1) => {
  for (const side of [-1, 1]) {
    shape(c, [hx - hr * 0.1, side * hr * 0.55, hx + hr * 0.35, side * hr * 0.95, hx + hr * (0.5 + 0.9 * len), side * hr * (1.1 + 0.5 * len), hx + hr * 0.2, side * hr * 1.4], col, lw);
  }
};
const cross = (c: C, x: number, y: number, r: number, col: string) => {
  c.fillStyle = col;
  c.fillRect(x - r, y - r * 0.32, r * 2, r * 0.64);
  c.fillRect(x - r * 0.32, y - r, r * 0.64, r * 2);
};

// ---------- armi ----------

function flash(c: C, x: number, s: number, kick: number, col = "#ffe08a") {
  if (kick < 0.55) return;
  const q = (kick - 0.55) / 0.45;
  star(c, x, 0, s * (0.35 + 0.55 * q), "#fff6d6", 4, 0.35, 0.4);
  star(c, x, 0, s * (0.22 + 0.35 * q), col, 4, 0.4, 0.4 + Math.PI / 4);
}

/** Arma da fuoco generica: calcio, corpo, canna. Torna la x della bocca. */
function gun(c: C, s: number, lw: number, o: { len: number; w?: number; body?: string; barrel?: string; stock?: string; scope?: boolean; drum?: string }) {
  const w = (o.w ?? 0.3) * s;
  c.save();
  c.translate(0.4 * s, 0);
  if (o.stock) box(c, -0.1 * s, -w * 0.55 + 0.04 * s, 0.6 * s, w * 1.1, w * 0.3, o.stock, lw);
  box(c, 0.75 * s, -w * 0.32, (o.len - 0.75) * s, w * 0.64, w * 0.2, o.barrel ?? "#3a4247", lw);
  box(c, 0.3 * s, -w / 2, 0.75 * s, w, w * 0.25, o.body ?? DARK, lw);
  if (o.scope) box(c, 0.4 * s, -w * 0.95, 0.55 * s, w * 0.5, w * 0.2, "#7fe3ff", lw * 0.8);
  if (o.drum) dot(c, 0.72 * s, w * 0.75, w * 0.6, o.drum, lw);
  c.restore();
  return (o.len + 0.4) * s;
}

// ---------- torri ----------

const FAMILY_PAD: Partial<Record<TowerKind, string>> = {
  officina: "#3b3324", grammofono: "#2c2440", capitano: "#22304a", medico: "#243a34", soffio: "#213744", purificatore: "#3b3524", campana: "#3b3324",
};

export function towerFigure(c: C, kind: TowerKind, T: number, angle: number, level: number, branch: Branch | null, time: number, kick: number, trackColor: string) {
  const accent = branch === "B" ? CORAL : branch === "A" ? BRASS : null;
  const gold = level >= 5;
  const lwB = Math.max(1, T * 0.03);
  // Pedana: staccata dal terreno, con il bordo d'oro per le torri Apex.
  c.fillStyle = "rgba(0,0,0,.35)";
  rrPath(c, -T * 0.4, -T * 0.36, T * 0.86, T * 0.84, T * 0.16);
  c.fill();
  box(c, -T * 0.42, -T * 0.42, T * 0.84, T * 0.84, T * 0.16, FAMILY_PAD[kind] ?? "#27313a", gold ? lwB * 1.7 : lwB, gold ? BRASS : "rgba(238,228,203,.5)");
  c.strokeStyle = "rgba(255,255,255,.06)";
  c.lineWidth = lwB;
  rrPath(c, -T * 0.34, -T * 0.34, T * 0.68, T * 0.68, T * 0.11);
  c.stroke();

  const s = T * 0.225;
  const lw = Math.max(1, s * 0.11);
  const pads = (col: string) => (q: number) => {
    if (level < 2) return;
    dot(c, 0, -s * 0.95, s * 0.3, col, q);
    dot(c, 0, s * 0.95, s * 0.3, col, q);
  };
  const pack = (col: string) => (q: number) => {
    if (level >= 3) box(c, -s * 0.85, -s * 0.5, s * 0.5, s, s * 0.15, col, q);
  };
  const pull = kick * 0.35;

  switch (kind) {
    case "balestra": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#3f8f5a", pull }, {
        back: pack("#6b4a2a"),
        chest: pads("#57b377"),
        held: (q) => {
          c.save();
          c.translate(-pull * s, 0);
          box(c, 0.2 * s, -0.11 * s, 1.6 * s, 0.22 * s, 0.08 * s, WOOD, q);
          const bow = (x: number) => {
            c.beginPath();
            c.moveTo(x, -0.85 * s);
            c.quadraticCurveTo(x + 0.6 * s, 0, x, 0.85 * s);
            c.strokeStyle = INK;
            c.lineWidth = 0.2 * s + q * 2;
            c.stroke();
            c.strokeStyle = accent ?? "#d9d2c0";
            c.lineWidth = 0.2 * s;
            c.stroke();
            c.strokeStyle = "rgba(238,228,203,.8)";
            c.lineWidth = Math.max(1, q * 0.6);
            c.beginPath();
            c.moveTo(x, -0.85 * s);
            c.lineTo(x - (0.45 - kick * 0.4) * s, 0);
            c.lineTo(x, 0.85 * s);
            c.stroke();
          };
          bow(1.35 * s);
          if (branch === "A") bow(1.0 * s);
          if (kick < 0.3) shape(c, [2.1 * s, 0, 1.75 * s, -0.14 * s, 1.75 * s, 0.14 * s], branch === "B" ? CORAL : "#eee4cb", q * 0.6);
          c.restore();
        },
        hat: (hx, hr, q) => hood(c, hx, hr, q, "#2f6f45"),
      });
      break;
    }
    case "cecchino": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#6f8a62", pull }, {
        back: pack("#39452f"),
        chest: pads("#6c7d62"),
        held: (q) => {
          c.save();
          c.translate(-pull * s, 0);
          const tip = gun(c, s, q, { len: 2.25, w: 0.22, body: "#2f3a33", barrel: accent ?? "#30383c", stock: WOOD, scope: true });
          flash(c, tip + 0.15 * s, s, kick);
          c.restore();
        },
        hat: (hx, hr, q) => brim(c, hx, hr, q, "#55683f", "#39452f", 1.25),
      });
      break;
    }
    case "mitragliera": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#5d6b3a", pull: pull * 0.5 }, {
        back: pack("#c9a23a"),
        chest: pads("#7d8c55"),
        held: (q) => {
          c.save();
          c.translate(-pull * 0.5 * s + (kick > 0 ? Math.sin(time * 0.09) * 0.03 * s : 0), 0);
          box(c, 0.25 * s, -0.3 * s, 0.9 * s, 0.6 * s, 0.12 * s, "#3a4247", q);
          const spin = time * (branch === "A" ? 0.03 : 0.014);
          for (let i = 0; i < 3; i++) {
            const y = Math.sin(spin + (i * TAU) / 3) * 0.2 * s;
            box(c, 1.1 * s, y - 0.07 * s, 0.95 * s, 0.14 * s, 0.05 * s, branch === "B" ? "#fff1b0" : "#aab4ba", q * 0.7);
          }
          box(c, 1.85 * s, -0.3 * s, 0.14 * s, 0.6 * s, 0.05 * s, DARK, q * 0.7);
          flash(c, 2.2 * s, s, kick);
          c.restore();
        },
        hat: (hx, hr, q) => helmet(c, hx, hr, q, "#48542c", "#39431f"),
      });
      break;
    }
    case "arpione": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#e8c23a", pull }, {
        back: pack("#3a6a86"),
        chest: pads("#f5dc7a"),
        held: (q) => {
          c.save();
          c.translate(-pull * s, 0);
          gun(c, s, q, { len: 1.5, w: 0.3, body: "#4a5a63", barrel: "#6b7a82", stock: WOOD });
          if (kick < 0.4) {
            limb(c, 1.4 * s, 0, 2.0 * s, 0, 0.1 * s, "#eee4cb", q * 0.6);
            shape(c, [2.35 * s, 0, 1.9 * s, -0.26 * s, 2.0 * s, 0, 1.9 * s, 0.26 * s], branch === "B" ? CORAL : "#c9b8ff", q * 0.7);
          }
          c.restore();
        },
        hat: (hx, hr, q) => brim(c, hx, hr, q, "#d1a92a", "#a8851c", 1.3),
      });
      break;
    }
    case "kingpin": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#565a68", pull: pull * 0.6 }, {
        chest: (q) => {
          c.strokeStyle = "rgba(238,228,203,.25)";
          c.lineWidth = Math.max(1, q * 0.5);
          for (const y of [-0.6, -0.2, 0.2, 0.6]) {
            c.beginPath();
            c.moveTo(-0.38 * s, y * s);
            c.lineTo(0.38 * s, y * s);
            c.stroke();
          }
          if (level >= 2) dot(c, 0.3 * s, 0.55 * s, 0.14 * s, CORAL, q * 0.6);
        },
        held: (q) => {
          c.save();
          c.translate(-pull * 0.6 * s, 0);
          const tip = gun(c, s, q, { len: 1.85, w: 0.24, body: "#3a3f45", barrel: "#565e66", stock: WOOD, drum: accent ?? "#565e66" });
          flash(c, tip + 0.15 * s, s, kick);
          c.restore();
        },
        hat: (hx, hr, q) => brim(c, hx, hr, q, "#2e3038", BRASS, 1.4),
      });
      break;
    }
    case "ingegnere": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#e8862a", pull: pull * 0.6 }, {
        back: (q) => {
          // Chiave inglese a tracolla; dal livello 3 anche la cassetta degli attrezzi.
          limb(c, -0.75 * s, -0.7 * s, -0.75 * s, 0.6 * s, 0.14 * s, "#aab4ba", q * 0.6);
          if (level >= 3) box(c, -1.2 * s, -0.45 * s, 0.5 * s, 0.9 * s, 0.1 * s, "#c0392b", q);
        },
        chest: (q) => {
          c.fillStyle = "#fff1b0";
          c.fillRect(-0.4 * s, -0.55 * s, 0.8 * s, 0.14 * s);
          c.fillRect(-0.4 * s, 0.41 * s, 0.8 * s, 0.14 * s);
          pads("#f5a653")(q);
        },
        held: (q) => {
          c.save();
          c.translate(-pull * 0.6 * s, 0);
          const tip = gun(c, s, q, { len: 1.35, w: 0.36, body: "#f0c93a", barrel: accent ?? "#565e66" });
          flash(c, tip + 0.1 * s, s * 0.7, kick);
          c.restore();
        },
        hat: (hx, hr, q) => helmet(c, hx, hr, q, "#f0c93a", "#c9a52a"),
      });
      break;
    }
    case "pistolero": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#a8442f", sleeve: "#d9c9a8", pull, reach: 1.15 }, {
        back: pack("#6b4a2a"),
        chest: (q) => {
          // Poncho a strisce e stella da sceriffo dal livello 2.
          c.fillStyle = "#e0b354";
          c.fillRect(-0.42 * s, -0.25 * s, 0.84 * s, 0.14 * s);
          c.fillRect(-0.42 * s, 0.12 * s, 0.84 * s, 0.14 * s);
          if (level >= 2) star(c, 0.2 * s, -0.6 * s, 0.2 * s, "#ffe08a", 5, 0.45);
          void q;
        },
        held: (q) => {
          c.save();
          c.translate(-pull * s, 0);
          c.rotate(-kick * 0.5);
          const tip = gun(c, s, q, { len: 1.25, w: 0.3, body: WOOD, barrel: accent ?? "#aab4ba", drum: "#8f9ca3" });
          flash(c, tip + 0.12 * s, s * 0.8, kick);
          c.restore();
        },
        hat: (hx, hr, q) => brim(c, hx, hr, q, "#7a5230", "#3b2a1a", 1.75),
      });
      break;
    }
    case "piromante": {
      c.rotate(angle);
      person(c, s, { skin: "#3a3f45", shirt: "#8a2a22", sleeve: "#6a1f1a", eyes: "#ffb347" }, {
        back: (q) => {
          // Bombole sulla schiena.
          box(c, -1.0 * s, -0.75 * s, 0.6 * s, 0.65 * s, 0.25 * s, "#c9a23a", q);
          box(c, -1.0 * s, 0.1 * s, 0.6 * s, 0.65 * s, 0.25 * s, level >= 3 ? "#e2714f" : "#c9a23a", q);
        },
        chest: pads("#b8452f"),
        held: (q) => {
          gun(c, s, q, { len: 1.6, w: 0.28, body: "#3a4247", barrel: accent ?? "#6b7a82" });
          const lick = 0.7 + 0.3 * Math.sin(time * 0.03);
          // Fiammella pilota sempre accesa; quando spara, la vampata.
          shape(c, [2.0 * s, -0.1 * s, 2.3 * s * lick + 0.1 * s, 0, 2.0 * s, 0.1 * s], "#ffb347", 0);
          // Mentre spara l'ugello è incandescente; il getto vero lo disegna la carta.
          if (kick > 0.05) dot(c, 2.05 * s, 0, s * (0.2 + 0.12 * lick), "#fff3c4");
        },
        hat: (hx, hr, q) => {
          helmet(c, hx, hr, q, "#5a1a16");
          // Filtro della maschera.
          dot(c, hx + hr * 0.75, 0, hr * 0.3, "#aab4ba", q * 0.7);
        },
      });
      break;
    }
    case "accelerator": {
      c.rotate(angle);
      const glow = 0.6 + 0.4 * Math.sin(time * 0.008);
      person(c, s, { skin: "#3a2a66", shirt: "#3a2a66", sleeve: "#4c3a86", pull: pull * 0.4, eyes: null }, {
        back: (q) => box(c, -s * 0.9, -s * 0.55, s * 0.55, s * 1.1, s * 0.15, "#2a1e4d", q),
        chest: pads("#6a54b8"),
        held: (q) => {
          box(c, 0.3 * s, -0.36 * s, 1.25 * s, 0.72 * s, 0.16 * s, "#2a1e4d", q);
          box(c, 1.45 * s, -0.22 * s, 0.6 * s, 0.44 * s, 0.08 * s, accent ?? "#6a54b8", q);
          c.globalAlpha = glow;
          dot(c, 0.95 * s, 0, 0.2 * s, "#e3b3ff");
          c.globalAlpha = 1;
          if (kick > 0.1) {
            c.globalAlpha = kick;
            dot(c, 2.2 * s, 0, s * (0.2 + 0.25 * kick), "#e3b3ff");
            c.globalAlpha = 1;
          }
        },
        hat: (hx, hr, q) => {
          helmet(c, hx, hr, q, "#4c3a86");
          box(c, hx + hr * 0.25, -hr * 0.6, hr * 0.5, hr * 1.2, hr * 0.2, "#c06bff", q * 0.7);
        },
      });
      break;
    }
    case "mortaio": {
      // Sacchi di sabbia tutt'intorno, il servente dietro il tubo.
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        oval(c, Math.cos(a) * T * 0.31, Math.sin(a) * T * 0.31, T * 0.1, T * 0.065, "#a8946a", lw * 0.8, a + Math.PI / 2);
      }
      c.rotate(angle);
      person(c, s * 0.9, { skin: SKIN, shirt: "#5d6b3a", arms: "hold", reach: 0.9 }, {
        chest: pads("#7d8c55"),
        held: (q) => {
          c.save();
          c.translate(-kick * 0.3 * s, 0);
          box(c, 0.5 * s, -0.42 * s, 1.15 * s, 0.84 * s, 0.2 * s, "#3a4247", q);
          box(c, 1.45 * s, -0.48 * s, 0.26 * s, 0.96 * s, 0.1 * s, accent ?? "#eee4cb", q);
          dot(c, 1.58 * s, 0, 0.26 * s, "#0a0f11");
          c.restore();
          if (kick > 0.5) {
            c.globalAlpha = (kick - 0.5) * 2;
            dot(c, 2.1 * s, 0, s * (0.9 - kick * 0.5), "rgba(220,220,210,.8)");
            c.globalAlpha = 1;
          }
        },
        hat: (hx, hr, q) => helmet(c, hx, hr, q, "#48542c", "#39431f"),
      });
      break;
    }
    case "bobina": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#e9eef0", pull: pull * 0.3 }, {
        back: pack("#3a4247"),
        chest: pads("#ffffff"),
        held: (q) => {
          limb(c, 0.3 * s, 0, 1.5 * s, 0, 0.2 * s, "#6b7a82", q);
          for (const x of [0.8, 1.1, 1.4]) box(c, x * s, -0.26 * s, 0.14 * s, 0.52 * s, 0.05 * s, accent ?? "#c98a3a", q * 0.7);
          dot(c, 1.8 * s, 0, 0.3 * s, "#c9b8ff", q);
          c.strokeStyle = "#f2ecff";
          c.lineWidth = Math.max(1, q * 0.7);
          const n = kick > 0.2 ? 5 : 2;
          for (let i = 0; i < n; i++) {
            const a = time * 0.02 + i * 2.4;
            c.beginPath();
            c.moveTo(1.8 * s, 0);
            c.lineTo(1.8 * s + Math.cos(a) * 0.35 * s, Math.sin(a) * 0.35 * s);
            c.lineTo(1.8 * s + Math.cos(a + 0.6) * (0.55 + kick * 0.3) * s, Math.sin(a + 0.6) * (0.55 + kick * 0.3) * s);
            c.stroke();
          }
        },
        hat: (hx, hr, q) => {
          helmet(c, hx, hr, q, "#f0c93a", "#c9a52a");
          box(c, hx + hr * 0.3, -hr * 0.7, hr * 0.45, hr * 1.4, hr * 0.2, "#7fe3ff", q * 0.7);
        },
      });
      break;
    }
    case "sledger": {
      c.rotate(angle);
      person(c, s * 1.08, { skin: SKIN, shirt: "#3c6fa8", reach: 0.9 }, {
        back: pack("#2a4f7a"),
        chest: pads("#e9f4ff"),
        held: (q) => {
          c.save();
          c.rotate(-1.5 * kick * kick + 0.25);
          limb(c, 0.2 * s, 0, 1.75 * s, 0, 0.16 * s, WOOD, q);
          box(c, 1.5 * s, -0.62 * s, 0.62 * s, 1.24 * s, 0.12 * s, accent ?? "#bfe8ff", q);
          c.fillStyle = "rgba(255,255,255,.55)";
          c.fillRect(1.58 * s, -0.5 * s, 0.14 * s, 1.0 * s);
          c.restore();
        },
        hat: (hx, hr, q) => {
          dot(c, hx - hr * 0.1, 0, hr * 1.2, "#f3ead2", q);
          dot(c, hx, 0, hr * 0.82, "#2a4f7a", q * 0.8);
        },
      });
      break;
    }
    case "executioner": {
      c.rotate(angle);
      person(c, s * 1.05, { skin: "#e0b08a", shirt: "#3a2326", sleeve: "#e0b08a", reach: 0.95 }, {
        back: pack("#5a1a1f"),
        chest: (q) => {
          limb(c, -0.3 * s, -0.8 * s, 0.3 * s, 0.8 * s, 0.16 * s, "#6b4a2a", q * 0.5);
          pads("#7a1f25")(q);
        },
        held: (q) => {
          if (kick > 0.25) return; // l'ascia è in volo
          c.save();
          c.rotate(0.2);
          limb(c, 0.2 * s, 0, 1.5 * s, 0, 0.14 * s, WOOD, q);
          c.beginPath();
          c.arc(1.45 * s, 0, 0.62 * s, -1.25, 1.25);
          c.quadraticCurveTo(1.55 * s, 0, 1.45 * s + Math.cos(-1.25) * 0.62 * s, Math.sin(-1.25) * 0.62 * s);
          c.fillStyle = accent ?? "#cfd6dc";
          c.fill();
          c.strokeStyle = INK;
          c.lineWidth = q;
          c.stroke();
          c.restore();
        },
        hat: (hx, hr, q) => hood(c, hx, hr, q, "#7a1f25"),
      });
      break;
    }
    case "capitano": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#27406b", reach: 1.05 }, {
        back: (q) => {
          if (branch === "B") {
            limb(c, -0.7 * s, -0.9 * s, -0.7 * s, 0.9 * s, 0.1 * s, WOOD, q * 0.6);
            const w = Math.sin(time * 0.005) * 0.12 * s;
            shape(c, [-0.7 * s, -0.9 * s, -1.6 * s, -0.7 * s + w, -1.5 * s, -0.1 * s - w, -0.7 * s, -0.1 * s], CORAL, q);
          }
        },
        chest: (q) => {
          dot(c, 0, -s * 0.95, s * 0.3, BRASS, q);
          dot(c, 0, s * 0.95, s * 0.3, BRASS, q);
          if (level >= 3) dot(c, 0.25 * s, 0.5 * s, 0.13 * s, BRASS, q * 0.6);
        },
        held: (q) => {
          limb(c, 0.9 * s, -0.14 * s, 2.1 * s, -0.5 * s + Math.sin(time * 0.004) * 0.08 * s, 0.12 * s, "#e9eef0", q);
          box(c, 0.85 * s, -0.36 * s, 0.14 * s, 0.44 * s, 0.05 * s, BRASS, q * 0.7);
        },
        hat: (hx, hr, q) => {
          oval(c, hx - hr * 0.1, 0, hr * 0.85, hr * 1.5, "#16233d", q);
          c.strokeStyle = BRASS;
          c.lineWidth = hr * 0.14;
          c.beginPath();
          c.ellipse(hx - hr * 0.1, 0, hr * 0.55, hr * 1.15, 0, 0, TAU);
          c.stroke();
        },
      });
      break;
    }
    case "medico": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#f4f6f4", reach: 0.85 }, {
        back: pack("#d94a4a"),
        chest: pads("#ffffff"),
        held: (q) => {
          const pulse = 1 + 0.06 * Math.sin(time * 0.006);
          box(c, 0.6 * s, -0.42 * s * pulse, 0.84 * s, 0.84 * s * pulse, 0.14 * s, branch === "B" ? "#ffd9d9" : "#ffffff", q);
          cross(c, 1.02 * s, 0, 0.26 * s, "#d94a4a");
        },
        hat: (hx, hr, q) => {
          helmet(c, hx, hr, q, "#ffffff");
          cross(c, hx - hr * 0.12, 0, hr * 0.5, branch === "A" ? "#3aa35a" : "#d94a4a");
        },
      });
      break;
    }
    case "soffio": {
      // Il mago del gelo non mira: gira piano su se stesso con i fiocchi intorno.
      c.strokeStyle = "rgba(200,238,255,.7)";
      c.lineWidth = Math.max(1, lw * 0.7);
      for (let i = 0; i < 6; i++) {
        const a = time * 0.0012 + (i * TAU) / 6;
        const x = Math.cos(a) * T * 0.36;
        const y = Math.sin(a) * T * 0.36;
        c.beginPath();
        c.moveTo(x - T * 0.035, y);
        c.lineTo(x + T * 0.035, y);
        c.moveTo(x, y - T * 0.035);
        c.lineTo(x, y + T * 0.035);
        c.stroke();
      }
      c.rotate(-0.6 + Math.sin(time * 0.0015) * 0.25);
      person(c, s, { skin: "#dff3ff", shirt: "#5fb3dc", arms: "side" }, {
        back: (q) => shape(c, [-0.3 * s, -0.9 * s, -1.25 * s, -0.6 * s, -1.25 * s, 0.6 * s, -0.3 * s, 0.9 * s], "#3f8fb8", q),
        chest: pads("#e9fbff"),
        held: (q) => {
          limb(c, 0.1 * s, -1.12 * s, 1.5 * s, -1.12 * s, 0.12 * s, "#e9fbff", q);
          star(c, 1.6 * s, -1.12 * s, 0.42 * s, accent ?? "#a5e4ec", 6, 0.45, time * 0.002);
        },
        hat: (hx, hr, q) => {
          dot(c, hx - hr * 0.1, 0, hr * 1.2, "#f3fbff", q);
          dot(c, hx, 0, hr * 0.8, "#5fb3dc", q * 0.8);
        },
      });
      break;
    }
    case "purificatore": {
      const pulse = 1 + 0.08 * Math.sin(time * 0.006);
      star(c, 0, 0, T * 0.4 * pulse, branch === "B" ? "rgba(226,113,79,.55)" : "rgba(255,241,176,.5)", 10, 0.6, time * 0.0006);
      c.rotate(Math.PI / 2);
      person(c, s, { skin: SKIN, shirt: "#f3ead2", arms: "side" }, {
        chest: (q) => {
          box(c, -0.1 * s, -s, 0.2 * s, 2 * s, 0, BRASS, 0);
          pads(BRASS)(q);
        },
        held: () => {
          for (const y of [-1.12, 1.12]) dot(c, 0.1 * s, y * s, 0.36 * s * pulse, "rgba(255,246,214,.9)");
        },
        hat: (hx, hr, q) => {
          hood(c, hx, hr, q, "#f3ead2");
          dot(c, hx - hr * 0.2, 0, hr * 0.3, branch === "B" ? CORAL : BRASS, q * 0.6);
        },
      });
      break;
    }
    case "grammofono": {
      // Il DJ dietro la consolle: i dischi girano, la maglia ha il colore del disco scelto.
      c.rotate(Math.PI / 2);
      person(c, s * 0.95, { skin: SKIN, shirt: trackColor, arms: "hold", reach: 0.95 }, {
        chest: pads("#ffffff"),
        held: (q) => {
          box(c, 0.7 * s, -1.5 * s, 1.0 * s, 3.0 * s, 0.18 * s, "#1a1424", q);
          for (const y of [-0.8, 0.8]) {
            dot(c, 1.2 * s, y * s, 0.42 * s, "#0a0f11", q * 0.7);
            c.strokeStyle = "rgba(238,228,203,.5)";
            c.lineWidth = Math.max(1, q * 0.5);
            c.beginPath();
            c.arc(1.2 * s, y * s, 0.28 * s, time * 0.005 + y, time * 0.005 + y + 3.4);
            c.stroke();
            dot(c, 1.2 * s, y * s, 0.12 * s, trackColor);
          }
          if (accent) box(c, 1.05 * s, -0.16 * s, 0.3 * s, 0.32 * s, 0.05 * s, accent, q * 0.6);
        },
        hat: (hx, hr, q) => {
          c.strokeStyle = INK;
          c.lineWidth = hr * 0.42;
          c.beginPath();
          c.moveTo(hx - hr * 0.1, -hr);
          c.lineTo(hx - hr * 0.1, hr);
          c.stroke();
          dot(c, hx - hr * 0.1, -hr * 1.02, hr * 0.42, trackColor, q);
          dot(c, hx - hr * 0.1, hr * 1.02, hr * 0.42, trackColor, q);
        },
      });
      break;
    }
    case "officina": {
      // Una bottega vista dall'alto: tetto a due falde, comignolo che fuma, ingranaggio che gira.
      box(c, -T * 0.33, -T * 0.33, T * 0.66, T * 0.66, T * 0.05, "#b5553a", lw);
      c.fillStyle = "rgba(0,0,0,.18)";
      c.fillRect(-T * 0.33, 0, T * 0.66, T * 0.33);
      c.strokeStyle = INK;
      c.lineWidth = lw * 0.8;
      c.beginPath();
      c.moveTo(-T * 0.33, 0);
      c.lineTo(T * 0.33, 0);
      c.stroke();
      box(c, T * 0.12, -T * 0.27, T * 0.13, T * 0.13, T * 0.02, "#6b4a3a", lw * 0.8);
      for (let i = 0; i < 3; i++) {
        const q = ((time * 0.0006 + i / 3) % 1 + 1) % 1;
        c.globalAlpha = 0.5 * (1 - q);
        dot(c, T * (0.185 + q * 0.12), -T * (0.205 + q * 0.2), T * (0.04 + q * 0.05), "#e9eef0");
      }
      c.globalAlpha = 1;
      c.save();
      c.translate(-T * 0.1, T * 0.1);
      c.rotate(time * 0.0015);
      star(c, 0, 0, T * 0.17, accent ?? BRASS, 8, 0.72);
      c.strokeStyle = INK;
      c.lineWidth = lw * 0.8;
      c.stroke();
      dot(c, 0, 0, T * 0.055, "#3b3324", lw * 0.6);
      c.restore();
      break;
    }
    case "starcannon": {
      // Macchina grande quattro caselle: torretta d'acciaio, canna con anelli d'oro, nucleo a stella.
      const pulse = 0.7 + 0.3 * Math.sin(time * 0.005);
      star(c, 0, 0, T * 0.4, "#39434b", 8, 0.92, Math.PI / 8);
      c.strokeStyle = INK;
      c.lineWidth = lw;
      c.stroke();
      c.rotate(angle);
      c.translate(-kick * T * 0.06, 0);
      box(c, -T * 0.05, -T * 0.085, T * 0.44, T * 0.17, T * 0.03, "#56626b", lw);
      for (const x of [0.1, 0.2, 0.3]) box(c, T * x, -T * 0.1, T * 0.035, T * 0.2, T * 0.01, BRASS, lw * 0.7);
      box(c, T * 0.37, -T * 0.11, T * 0.05, T * 0.22, T * 0.015, accent ?? "#2b3236", lw * 0.8);
      box(c, -T * 0.24, -T * 0.17, T * 0.3, T * 0.34, T * 0.06, "#6b7a85", lw);
      c.globalAlpha = pulse;
      dot(c, -T * 0.09, 0, T * 0.1, "rgba(255,216,107,.45)");
      c.globalAlpha = 1;
      star(c, -T * 0.09, 0, T * 0.085, "#ffd86b", 5, 0.45, time * 0.002);
      if (kick > 0.3) star(c, T * 0.48, 0, T * 0.2 * kick, "#fff6d6", 6, 0.4, 0.3);
      break;
    }
    case "campana": {
      const sw = Math.sin(time * 0.004) * 0.12;
      limb(c, -T * 0.3, -T * 0.3, -T * 0.3, T * 0.3, T * 0.07, WOOD, lw);
      limb(c, T * 0.3, -T * 0.3, T * 0.3, T * 0.3, T * 0.07, WOOD, lw);
      limb(c, -T * 0.3, 0, T * 0.3, 0, T * 0.06, "#6b4a2a", lw);
      c.rotate(sw);
      dot(c, 0, 0, T * 0.22, BRASS, lw);
      dot(c, 0, 0, T * 0.13, "#c9973a", lw * 0.7);
      dot(c, Math.sin(time * 0.004) * T * 0.07, 0, T * 0.05, "#3b3324", lw * 0.6);
      break;
    }
    case "custode": {
      c.rotate(angle);
      person(c, s * 1.05, { skin: BRASS, shirt: "#f3ead2", sleeve: BRASS, eyes: "#ffffff", reach: 1 }, {
        back: (q) => shape(c, [-0.3 * s, -0.95 * s, -1.4 * s, -0.7 * s, -1.2 * s, 0, -1.4 * s, 0.7 * s, -0.3 * s, 0.95 * s], "#ffffff", q),
        chest: pads(BRASS),
        held: (q) => {
          const g = 0.75 + 0.25 * Math.sin(time * 0.006);
          box(c, 1.0 * s, -0.4 * s, 0.7 * s, 0.8 * s, 0.14 * s, "#ffffff", q);
          c.globalAlpha = g;
          dot(c, 1.35 * s, 0, 0.24 * s, "#ffd86b");
          c.globalAlpha = 1;
          dot(c, 1.35 * s, 0, 0.1 * s, INK);
        },
        hat: (hx, hr, q) => crown(c, hx, hr, q, BRASS, "#ffffff"),
      });
      break;
    }
    case "cometa": {
      c.rotate(angle);
      person(c, s, { skin: SKIN, shirt: "#27356e", reach: 1 }, {
        back: (q) => shape(c, [-0.3 * s, -0.9 * s, -1.3 * s, -0.55 * s, -1.3 * s, 0.55 * s, -0.3 * s, 0.9 * s], "#1b2550", q),
        chest: pads("#ffd86b"),
        held: (q) => {
          limb(c, 0.3 * s, 0, 1.6 * s, 0, 0.12 * s, "#c9b8ff", q);
          c.globalAlpha = 0.5;
          shape(c, [1.7 * s, -0.28 * s, 0.9 * s, 0, 1.7 * s, 0.28 * s], "#a5e4ec", 0);
          c.globalAlpha = 1;
          star(c, 1.85 * s, 0, s * (0.42 + kick * 0.3), "#fff6d6", 5, 0.45, time * 0.004);
        },
        hat: (hx, hr, q) => {
          dot(c, hx - hr * 0.1, 0, hr * 1.3, "#1b2550", q);
          shape(c, [hx + hr * 0.55, -hr * 0.6, hx - hr * 1.7, 0, hx + hr * 0.55, hr * 0.6], "#27356e", q);
          star(c, hx - hr * 0.1, 0, hr * 0.4, "#ffd86b", 5, 0.45);
        },
      });
      break;
    }
  }
}

/** Torretta dell'Ingegnere: treppiede, corpo e canna, rivolta dove spara. */
export function sentryFigure(c: C, T: number, angle: number, heavy: boolean, kick: number) {
  const lw = Math.max(1, T * 0.025);
  for (let i = 0; i < 3; i++) {
    const a = (i * TAU) / 3 + 0.5;
    limb(c, 0, 0, Math.cos(a) * T * 0.17, Math.sin(a) * T * 0.17, T * 0.04, "#565e66", lw * 0.6);
  }
  c.save();
  c.rotate(angle);
  box(c, T * 0.02 - kick * T * 0.03, -T * 0.035, T * 0.2, T * 0.07, T * 0.02, "#3a4247", lw);
  box(c, -T * 0.1, -T * 0.09, T * 0.18, T * 0.18, T * 0.04, heavy ? "#8f9ca3" : "#f0c93a", lw);
  dot(c, -T * 0.01, 0, T * 0.03, heavy ? CORAL : "#e8862a");
  if (kick > 0.5) star(c, T * 0.26, 0, T * 0.07, "#fff6d6", 4, 0.4, 0.4);
  c.restore();
}

// ---------- nemici ----------

type Draw = (c: C, s: number, step: number, frame: number, boss: boolean) => void;

const zombie = (k: Look, p: (s: number, step: number, frame: number, boss: boolean) => Parts = () => ({})): Draw =>
  (c, s, step, frame, boss) => person(c, s, { arms: "zombie", head: "block", eyes: "#f4fff8", ...k, step }, p(s, step, frame, boss));

function cape(c: C, s: number, step: number, col: string, lw: number, len = 1.5) {
  shape(c, [-0.2 * s, -0.95 * s, -len * s, -0.8 * s + step * 0.15 * s, -(len + 0.25) * s, step * 0.2 * s, -len * s, 0.8 * s + step * 0.15 * s, -0.2 * s, 0.95 * s], col, lw);
}

function flames(c: C, x: number, y: number, r: number, frame: number) {
  for (let i = 0; i < 3; i++) {
    const a = Math.PI + (i - 1) * 0.6 + (frame % 2 ? 0.15 : -0.15);
    const len = r * (1.5 + ((frame + i) % 3) * 0.3);
    shape(c, [x + Math.cos(a + 1.3) * r * 0.5, y + Math.sin(a + 1.3) * r * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len, x + Math.cos(a - 1.3) * r * 0.5, y + Math.sin(a - 1.3) * r * 0.5], i === 1 ? "#ffe08a" : "#ff8a3a", 0);
  }
}

const ENEMY: Record<string, Draw> = {
  risacca: zombie({ skin: "#86c9a8", shirt: "#3a6a86" }, (s) => ({
    chest: () => {
      // Maglia strappata.
      c0.fillStyle = "#2c5268";
      c0.fillRect(-0.2 * s, 0.25 * s, 0.4 * s, 0.4 * s);
    },
  })),
  corridore: zombie({ skin: "#e0d88a", shirt: "#b8452f", arms: "side", bulk: 0.9 }, () => ({
    hat: (hx, hr, lw) => {
      box(c0, hx - hr * 0.5, -hr * 1.05, hr * 0.6, hr * 2.1, hr * 0.2, "#d93a2f", lw * 0.8);
      shape(c0, [hx - hr * 0.5, -hr * 0.2, hx - hr * 1.6, -hr * 0.5, hx - hr * 1.5, hr * 0.3], "#d93a2f", lw * 0.7);
    },
  })),
  bruto: zombie({ skin: "#8fae8a", shirt: "#5a6470", bulk: 1.18, headSize: 0.9 }, (s, _st, _f, boss) => ({
    chest: (lw) => {
      dot(c0, 0, -s * 1.1, s * 0.42, boss ? BRASS : "#77828c", lw);
      dot(c0, 0, s * 1.1, s * 0.42, boss ? BRASS : "#77828c", lw);
      for (const [x, y] of [[-0.2, -0.5], [0.15, 0.3], [-0.15, 0.7]]) dot(c0, x * s, y * s, s * 0.11, CORAL);
    },
    hat: (hx, hr, lw) => {
      helmet(c0, hx, hr, lw, boss ? "#8a7340" : "#6b7680");
      box(c0, hx + hr * 0.35, -hr * 0.55, hr * 0.3, hr * 1.1, hr * 0.1, INK, 0);
    },
  })),
  sabotatore: zombie({ skin: "#b7a4e8", shirt: "#2a2140", arms: "hold", reach: 0.9 }, (s, _st, frame) => ({
    held: (lw) => {
      dot(c0, 1.15 * s, 0, 0.42 * s, "#15121c", lw);
      limb(c0, 1.4 * s, -0.25 * s, 1.6 * s, -0.5 * s, 0.07 * s, "#c9b8a0", 0);
      star(c0, 1.65 * s, -0.55 * s, s * (frame % 2 ? 0.3 : 0.2), "#ffe296");
    },
    hat: (hx, hr, lw) => hood(c0, hx, hr, lw, "#5a3fa0"),
  })),
  annegato: zombie({ skin: "#9fd9c4", shirt: "#1f5a55", arms: "hold", reach: 1 }, (s, step) => ({
    back: (lw) => cape(c0, s, step, "#143f3b", lw, 1.1),
    chest: (lw) => {
      dot(c0, 0, -s * 0.95, s * 0.28, BRASS, lw);
      dot(c0, 0, s * 0.95, s * 0.28, BRASS, lw);
    },
    held: (lw) => {
      limb(c0, 0.9 * s, -0.14 * s, 2.0 * s, -0.55 * s, 0.14 * s, "#dfe7ea", lw);
      box(c0, 0.82 * s, -0.4 * s, 0.14 * s, 0.5 * s, 0.05 * s, BRASS, lw * 0.7);
    },
    hat: (hx, hr, lw) => {
      shape(c0, [hx + hr * 1.25, 0, hx - hr * 0.9, -hr * 1.35, hx - hr * 0.9, hr * 1.35], "#0b1110", lw);
      c0.strokeStyle = BRASS;
      c0.lineWidth = hr * 0.14;
      c0.beginPath();
      c0.moveTo(hx + hr * 0.8, 0);
      c0.lineTo(hx - hr * 0.6, -hr * 0.85);
      c0.lineTo(hx - hr * 0.6, hr * 0.85);
      c0.closePath();
      c0.stroke();
    },
  })),
  sirena: zombie({ skin: "#7fd8dc", shirt: "#2a8f8a", arms: "side", feet: null, head: "round" }, (s, step, frame) => ({
    back: (lw) => {
      // Coda e capelli che ondeggiano dietro.
      shape(c0, [-0.3 * s, -0.6 * s, -1.3 * s, step * 0.3 * s, -1.9 * s, -0.5 * s + step * 0.3 * s, -1.6 * s, step * 0.3 * s, -1.9 * s, 0.5 * s + step * 0.3 * s, -1.3 * s, step * 0.3 * s, -0.3 * s, 0.6 * s], "#1c7f8a", lw);
      for (let i = -2; i <= 2; i++) limb(c0, -0.2 * s, i * 0.22 * s, -(0.9 + (i + frame) % 2 * 0.15) * s, i * 0.42 * s - step * 0.12 * s, 0.14 * s, "#bfeef2", 0);
    },
    hat: (hx, hr, lw) => crown(c0, hx - hr * 0.15, hr * 0.7, lw * 0.8, "#ffe296", "#ff9ac0"),
  })),
  leviatano: (c, s, step, frame) => {
    const lw = Math.max(1.5, s * 0.08);
    // Coda che sferza, pinne, corpo e fauci.
    shape(c, [-0.8 * s, -0.35 * s, -1.7 * s, step * 0.45 * s, -2.0 * s, -0.4 * s + step * 0.5 * s, -1.85 * s, step * 0.5 * s, -2.0 * s, 0.4 * s + step * 0.5 * s, -1.7 * s, step * 0.45 * s, -0.8 * s, 0.35 * s], "#0f3a33", lw);
    for (const side of [-1, 1]) shape(c, [0.2 * s, side * 0.7 * s, -0.5 * s + step * side * 0.2 * s, side * 1.5 * s, -0.7 * s, side * 0.75 * s], "#17544a", lw);
    oval(c, -0.1 * s, 0, 1.05 * s, 0.82 * s, "#1c6a5c", lw);
    for (let i = 0; i < 5; i++) shape(c, [(-0.9 + i * 0.36) * s, -0.12 * s, (-0.75 + i * 0.36) * s, 0, (-0.9 + i * 0.36) * s, 0.12 * s], CORAL, lw * 0.5);
    oval(c, 0.95 * s, 0, 0.62 * s, 0.58 * s, "#238573", lw);
    const jaw = frame % 2 ? 0.16 : 0.08;
    shape(c, [1.25 * s, -jaw * s, 1.75 * s, -0.3 * s, 1.45 * s, -0.02 * s], "#f3ead2", lw * 0.6);
    shape(c, [1.25 * s, jaw * s, 1.75 * s, 0.3 * s, 1.45 * s, 0.02 * s], "#f3ead2", lw * 0.6);
    for (const side of [-1, 1]) {
      dot(c, 1.05 * s, side * 0.32 * s, 0.15 * s, "#ff8a5c", lw * 0.6);
      dot(c, 1.09 * s, side * 0.32 * s, 0.06 * s, INK);
    }
  },
  tizzone: zombie({ skin: "#ff9a4a", shirt: "#3a2018", eyes: "#fff6d6" }, (_s, _st, frame) => ({
    hat: (hx, hr) => flames(c0, hx - hr * 0.3, 0, hr * 0.8, frame),
  })),
  magmatico: zombie({ skin: "#6b4a40", shirt: "#3a2a26", bulk: 1.15, eyes: "#ffb347" }, (s) => ({
    chest: () => {
      c0.strokeStyle = "#ff8a3a";
      c0.lineWidth = Math.max(1, s * 0.1);
      c0.beginPath();
      c0.moveTo(-0.3 * s, -0.8 * s);
      c0.lineTo(0.1 * s, -0.3 * s);
      c0.lineTo(-0.2 * s, 0.2 * s);
      c0.lineTo(0.2 * s, 0.8 * s);
      c0.stroke();
    },
  })),
  colosso: zombie({ skin: "#5a3a32", shirt: "#33221e", bulk: 1.25, eyes: "#ffd86b", headSize: 0.85 }, (s, _st, frame) => ({
    chest: (lw) => {
      for (const side of [-1, 1]) shape(c0, [-0.5 * s, side * 0.9 * s, 0.1 * s, side * 1.75 * s, 0.6 * s, side * 1.1 * s], "#6b4a40", lw);
      c0.strokeStyle = frame % 2 ? "#ffb347" : "#ff8a3a";
      c0.lineWidth = Math.max(1, s * 0.1);
      c0.beginPath();
      c0.moveTo(-0.3 * s, -0.9 * s);
      c0.lineTo(0.15 * s, -0.3 * s);
      c0.lineTo(-0.25 * s, 0.25 * s);
      c0.lineTo(0.2 * s, 0.9 * s);
      c0.stroke();
    },
    hat: (hx, hr, lw) => horns(c0, hx, hr, lw, "#33221e", 1),
  })),
  spettro: (c, s, step, frame) => {
    const lw = Math.max(1, s * 0.11);
    c.globalAlpha = 0.85;
    shape(c, [0.3 * s, -0.85 * s, -0.8 * s, -0.8 * s, -1.6 * s, -0.5 * s + step * 0.2 * s, -1.1 * s, -0.15 * s, -1.75 * s, step * 0.25 * s, -1.1 * s, 0.2 * s, -1.6 * s, 0.55 * s + step * 0.2 * s, -0.8 * s, 0.8 * s, 0.3 * s, 0.85 * s], "#cfd6ff", lw);
    for (const side of [-1, 1]) limb(c, 0.1 * s, side * 0.8 * s, (1.0 + (frame % 2) * 0.08) * s, side * 0.6 * s, 0.26 * s, "#e6eaff", lw);
    dot(c, 0.25 * s, 0, 0.62 * s, "#e6eaff", lw);
    c.globalAlpha = 1;
    for (const side of [-1, 1]) oval(c, 0.55 * s, side * 0.24 * s, 0.1 * s, 0.16 * s, INK);
  },
  cavaliere: zombie({ skin: "#39424b", shirt: "#4b5560", arms: "hold", reach: 0.95, eyes: null, bulk: 1.08 }, (s) => ({
    chest: (lw) => {
      dot(c0, 0, -s * 1.02, s * 0.36, "#6b7680", lw);
      dot(c0, 0, s * 1.02, s * 0.36, "#6b7680", lw);
    },
    held: (lw) => {
      limb(c0, 0.9 * s, -0.2 * s, 2.05 * s, -0.75 * s, 0.16 * s, "#dfe7ea", lw);
      shape(c0, [0.5 * s, 0.1 * s, 1.25 * s, 0.25 * s, 1.35 * s, 0.85 * s, 0.6 * s, 1.05 * s], "#2f4a7a", lw);
    },
    hat: (hx, hr, lw) => {
      helmet(c0, hx, hr, lw, "#39424b");
      box(c0, hx + hr * 0.35, -hr * 0.6, hr * 0.25, hr * 1.2, hr * 0.1, "#0a0f11", 0);
      limb(c0, hx - hr * 0.2, 0, hx - hr * 1.5, 0, hr * 0.3, "#c03a3a", lw * 0.6);
    },
  })),
  recaduto: king("#3a2a55", "#6a3fa0", BRASS, "#c9b8ff", "#b9a4ff"),
  risvegliato: king("#5a1420", "#b0202c", "#ffd86b", "#ff5a5a", "#ff8a8a"),
  regina: zombie({ skin: "#e3f4ff", shirt: "#9fd0ee", arms: "hold", reach: 1, head: "round", eyes: "#2a6a9a" }, (s, step, frame) => ({
    back: (lw) => cape(c0, s, step, "#f3fbff", lw, 1.6),
    held: (lw) => {
      limb(c0, 0.4 * s, -0.14 * s, 1.9 * s, -0.14 * s, 0.12 * s, "#e9fbff", lw);
      star(c0, 2.0 * s, -0.14 * s, s * (frame % 2 ? 0.5 : 0.42), "#a5e4ec", 6, 0.45);
    },
    hat: (hx, hr, lw) => crown(c0, hx - hr * 0.35, hr * 0.78, lw, "#e9fbff", "#7cc7e8"),
  })),
  brinato: zombie({ skin: "#a8dcf0", shirt: "#4a7a9a", eyes: "#ffffff" }, (s) => ({
    chest: (lw) => {
      for (const side of [-1, 1]) for (const x of [-0.25, 0.15]) shape(c0, [(x - 0.14) * s, side * 0.9 * s, x * s, side * 1.5 * s, (x + 0.14) * s, side * 0.9 * s], "#f3fbff", lw * 0.7);
    },
  })),
  orso: (c, s, step) => {
    const lw = Math.max(1, s * 0.1);
    for (const [x, side] of [[0.7, -1], [0.7, 1], [-0.7, -1], [-0.7, 1]]) oval(c, (x + step * side * (x > 0 ? 0.25 : -0.25)) * s, side * 0.72 * s, 0.34 * s, 0.26 * s, "#dfe7ea", lw);
    oval(c, -0.15 * s, 0, 1.05 * s, 0.8 * s, "#f6f8f8", lw);
    dot(c, -1.15 * s, 0, 0.16 * s, "#f6f8f8", lw);
    for (const side of [-1, 1]) dot(c, 0.75 * s, side * 0.48 * s, 0.2 * s, "#dfe7ea", lw);
    dot(c, 0.95 * s, 0, 0.55 * s, "#f6f8f8", lw);
    oval(c, 1.38 * s, 0, 0.24 * s, 0.2 * s, "#dfe7ea", lw * 0.8);
    dot(c, 1.52 * s, 0, 0.09 * s, INK);
    for (const side of [-1, 1]) dot(c, 1.12 * s, side * 0.24 * s, 0.07 * s, INK);
  },
  elfo: zombie({ skin: "#b5e08a", shirt: "#b02a2a", head: "round", bulk: 0.9 }, (_s, step) => ({
    hat: (hx, hr, lw) => {
      dot(c0, hx - hr * 0.1, 0, hr * 1.02, "#2f8f4a", lw);
      shape(c0, [hx + hr * 0.3, -hr * 0.6, hx - hr * 1.9, step * hr * 0.4, hx + hr * 0.3, hr * 0.6], "#2f8f4a", lw);
      dot(c0, hx - hr * 1.9, step * hr * 0.4, hr * 0.3, "#ffd86b", lw * 0.7);
    },
  })),
  pupazzetto: snowman(false),
  pupazzo: snowman(true),
  folletto: zombie({ skin: "#7ab85a", shirt: "#6a3a8a", head: "round", arms: "side" }, (s, step) => ({
    back: (lw) => {
      oval(c0, -1.0 * s, step * 0.1 * s, 0.75 * s, 0.85 * s, "#8a6a3a", lw);
      for (const [x, y] of [[-1.2, -0.3], [-0.9, 0.25], [-1.25, 0.2]]) dot(c0, x * s, y * s, 0.16 * s, "#ffd86b", lw * 0.5);
    },
    hat: (hx, hr, lw) => {
      for (const side of [-1, 1]) shape(c0, [hx - hr * 0.2, side * hr * 0.8, hx - hr * 0.7, side * hr * 1.7, hx + hr * 0.4, side * hr * 0.9], "#7ab85a", lw);
      dot(c0, hx - hr * 0.25, 0, hr * 0.8, "#4a2a6a", lw);
    },
  })),
  renna: (c, s, step, frame) => {
    const lw = Math.max(1, s * 0.1);
    for (const [x, side] of [[0.55, -1], [0.55, 1], [-0.7, -1], [-0.7, 1]]) oval(c, (x + step * side * (x > 0 ? 0.28 : -0.28)) * s, side * 0.6 * s, 0.3 * s, 0.2 * s, "#15100d", lw);
    oval(c, -0.15 * s, 0, 1.05 * s, 0.62 * s, "#3a2a22", lw);
    dot(c, -1.2 * s, 0, 0.16 * s, "#f3ead2", lw * 0.7);
    for (const side of [-1, 1]) {
      c.strokeStyle = INK;
      c.lineWidth = 0.16 * s + lw;
      const antler = () => {
        c.beginPath();
        c.moveTo(0.8 * s, side * 0.3 * s);
        c.lineTo(0.55 * s, side * 1.15 * s);
        c.lineTo(0.2 * s, side * 1.5 * s);
        c.moveTo(0.55 * s, side * 1.15 * s);
        c.lineTo(1.0 * s, side * 1.45 * s);
        c.moveTo(0.68 * s, side * 0.75 * s);
        c.lineTo(1.1 * s, side * 0.9 * s);
        c.stroke();
      };
      antler();
      c.strokeStyle = "#c9b08a";
      c.lineWidth = 0.14 * s;
      antler();
    }
    oval(c, 1.0 * s, 0, 0.55 * s, 0.42 * s, "#4a362c", lw);
    dot(c, 1.55 * s, 0, s * (frame % 2 ? 0.2 : 0.16), "#ff3a3a", lw * 0.6);
    for (const side of [-1, 1]) dot(c, 1.15 * s, side * 0.22 * s, 0.08 * s, "#ffd0d0");
  },
  befana: zombie({ skin: "#b8c79a", shirt: "#3a2a4a", arms: "hold", reach: 0.9, head: "round" }, (s, step) => ({
    back: (lw) => {
      limb(c0, 1.3 * s, 0.5 * s, -1.4 * s, 0.5 * s, 0.12 * s, WOOD, lw * 0.7);
      shape(c0, [-1.3 * s, 0.25 * s, -2.0 * s, 0.1 * s + step * 0.1 * s, -2.0 * s, 0.9 * s + step * 0.1 * s, -1.3 * s, 0.75 * s], "#c9a23a", lw);
      cape(c0, s, step, "#2a1e38", lw, 1.1);
    },
    hat: (hx, hr, lw) => {
      dot(c0, hx - hr * 0.1, 0, hr * 1.55, "#1c1428", lw);
      shape(c0, [hx + hr * 0.5, -hr * 0.7, hx - hr * 2.0, step * hr * 0.3, hx + hr * 0.5, hr * 0.7], "#2a1e38", lw);
      c0.strokeStyle = "#8a5ac0";
      c0.lineWidth = hr * 0.18;
      c0.beginPath();
      c0.arc(hx - hr * 0.1, 0, hr * 0.85, 0, TAU);
      c0.stroke();
    },
  })),
  krampus: zombie({ skin: "#5a2a2a", shirt: "#2a1616", bulk: 1.25, eyes: "#ff3a3a", headSize: 0.9 }, (s, step, frame) => ({
    back: (lw) => {
      box(c0, -1.35 * s, -0.6 * s, 0.8 * s, 1.2 * s, 0.2 * s, "#6b4a2a", lw);
      c0.strokeStyle = "#3a2a1a";
      c0.lineWidth = lw * 0.7;
      for (const y of [-0.3, 0, 0.3]) {
        c0.beginPath();
        c0.moveTo(-1.35 * s, y * s);
        c0.lineTo(-0.55 * s, y * s);
        c0.stroke();
      }
    },
    held: (lw) => {
      // Catene ai polsi.
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) dot(c0, (1.2 - i * 0.28) * s, side * (0.85 + i * 0.22 + ((frame + i) % 2) * 0.06) * s + step * 0.05 * s, 0.11 * s, "#aab4ba", lw * 0.6);
    },
    hat: (hx, hr, lw) => horns(c0, hx, hr, lw, "#e9dcc0", 1.3),
  })),
  creator: zombie({ skin: "#f6f2e6", shirt: "#17181c", arms: "side", head: "round", eyes: "#ffd86b", bulk: 1.1 }, (s, step, frame) => ({
    back: (lw) => {
      cape(c0, s, step, "#0d0e12", lw, 1.6);
      // Cubi che gli orbitano intorno: i mattoni con cui costruisce.
      for (let i = 0; i < 4; i++) {
        const a = (frame * Math.PI) / 8 + (i * TAU) / 4;
        box(c0, Math.cos(a) * 1.75 * s - 0.17 * s, Math.sin(a) * 1.75 * s - 0.17 * s, 0.34 * s, 0.34 * s, 0.06 * s, i % 2 ? "#ffd86b" : "#f6f2e6", lw * 0.7);
      }
    },
    chest: (lw) => {
      c0.strokeStyle = "#ffd86b";
      c0.lineWidth = Math.max(1, lw * 0.9);
      c0.beginPath();
      c0.moveTo(0, -s);
      c0.lineTo(0, s);
      c0.moveTo(-0.4 * s, -0.5 * s);
      c0.lineTo(0.4 * s, -0.5 * s);
      c0.moveTo(-0.4 * s, 0.5 * s);
      c0.lineTo(0.4 * s, 0.5 * s);
      c0.stroke();
    },
    hat: (hx, hr, lw) => {
      c0.strokeStyle = "#ffd86b";
      c0.lineWidth = hr * 0.2;
      c0.setLineDash([hr * 0.5, hr * 0.3]);
      c0.lineDashOffset = frame * hr * 0.2;
      c0.beginPath();
      c0.arc(hx, 0, hr * 1.45, 0, TAU);
      c0.stroke();
      c0.setLineDash([]);
      void lw;
    },
  })),
  jackobot: zombie({ skin: "#f08a2a", shirt: "#6b7680", sleeve: "#8f9ca3", head: "round", eyes: null, bulk: 1.15, headSize: 1.15 }, (s, _st, frame) => ({
    chest: (lw) => {
      for (const [x, y] of [[-0.25, -0.75], [-0.25, 0.75], [0.25, -0.75], [0.25, 0.75]]) dot(c0, x * s, y * s, 0.08 * s, "#39434b");
      box(c0, -0.2 * s, -0.3 * s, 0.4 * s, 0.6 * s, 0.08 * s, frame % 2 ? "#ffe08a" : "#ffb347", lw * 0.7);
    },
    held: (lw) => {
      for (const side of [-1, 1]) for (const d of [-0.2, 0.2]) limb(c0, 1.2 * s, side * 0.5 * s, 1.55 * s, side * (0.5 + d) * s, 0.1 * s, "#39434b", lw * 0.5);
    },
    hat: (hx, hr, lw) => {
      c0.strokeStyle = "#b85f14";
      c0.lineWidth = lw * 0.8;
      for (const k of [-0.5, 0, 0.5]) {
        c0.beginPath();
        c0.ellipse(hx, 0, hr * 0.98, hr * Math.abs(k || 0.02), 0, 0, TAU);
        c0.stroke();
      }
      dot(c0, hx - hr * 0.1, 0, hr * 0.22, "#3f8f4a", lw * 0.7);
      const glow = frame % 2 ? "#fff6d6" : "#ffe08a";
      for (const side of [-1, 1]) shape(c0, [hx + hr * 0.3, side * hr * 0.2, hx + hr * 0.75, side * hr * 0.3, hx + hr * 0.45, side * hr * 0.6], glow, lw * 0.5);
    },
  })),
  zucchetta: (c, s, step, frame) => {
    const lw = Math.max(1, s * 0.12);
    for (const side of [-1, 1]) oval(c, side * step * 0.5 * s, side * 0.6 * s, 0.36 * s, 0.24 * s, "#39434b", lw);
    dot(c, 0, 0, s, "#f08a2a", lw);
    c.strokeStyle = "#b85f14";
    c.lineWidth = lw * 0.8;
    for (const k of [0.35, 0.7]) {
      c.beginPath();
      c.ellipse(0, 0, s * 0.98, s * k, 0, 0, TAU);
      c.stroke();
    }
    dot(c, -0.15 * s, 0, 0.2 * s, "#3f8f4a", lw * 0.7);
    for (const side of [-1, 1]) shape(c, [0.3 * s, side * 0.2 * s, 0.8 * s, side * 0.28 * s, 0.5 * s, side * 0.6 * s], frame % 2 ? "#fff6d6" : "#ffe08a", lw * 0.5);
  },
  ombra: (c, s, step, frame) => {
    c.globalAlpha = 0.82;
    person(c, s, { skin: "#15101f", shirt: "#15101f", arms: "zombie", eyes: "#c06bff", step, feet: null }, {
      back: (lw) => {
        for (let i = -1; i <= 1; i++) shape(c, [-0.3 * s, i * 0.5 * s - 0.2 * s, -(1.3 + ((frame + i + 4) % 2) * 0.3) * s, i * 0.6 * s, -0.3 * s, i * 0.5 * s + 0.2 * s], "#2a1e3d", lw * 0.5);
      },
      hat: (hx, hr, lw) => {
        c.globalAlpha = 1;
        crown(c, hx - hr * 0.45, hr * 0.55, lw * 0.6, "#6a3fa0", "#15101f");
      },
    });
    c.globalAlpha = 1;
  },
  araldo: zombie({ skin: "#22202a", shirt: "#2f2c3a", arms: "hold", reach: 0.9, eyes: "#ff5a5a", bulk: 1.1 }, (s, step) => ({
    back: (lw) => {
      limb(c0, -0.6 * s, -1.0 * s, -0.6 * s, 1.0 * s, 0.1 * s, "#6b4a2a", lw * 0.6);
      shape(c0, [-0.6 * s, -1.0 * s, -1.9 * s, -0.8 * s + step * 0.15 * s, -1.6 * s, -0.35 * s, -1.9 * s, 0.1 * s + step * 0.15 * s, -0.6 * s, 0.1 * s], "#7a1f25", lw);
    },
    held: (lw) => {
      // Il corno con cui disturba le torri.
      shape(c0, [0.7 * s, -0.12 * s, 1.7 * s, -0.5 * s, 1.85 * s, 0.35 * s, 0.75 * s, 0.14 * s], "#c9973a", lw);
    },
    hat: (hx, hr, lw) => {
      helmet(c0, hx, hr, lw, "#17151d");
      limb(c0, hx + hr * 0.3, 0, hx - hr * 1.3, 0, hr * 0.34, "#7a1f25", lw * 0.6);
    },
  })),
  lancia: zombie({ skin: "#2a2a33", shirt: "#3a3a46", arms: "hold", reach: 1, eyes: "#ff8a5c" }, (s) => ({
    held: (lw) => {
      limb(c0, -0.6 * s, -0.14 * s, 1.75 * s, -0.14 * s, 0.12 * s, "#6b4a2a", lw * 0.7);
      shape(c0, [2.25 * s, -0.14 * s, 1.6 * s, -0.42 * s, 1.6 * s, 0.14 * s], "#dfe7ea", lw * 0.8);
      shape(c0, [0.45 * s, 0.2 * s, 1.1 * s, 0.3 * s, 1.1 * s, 0.85 * s, 0.5 * s, 1.0 * s], "#5a1a1f", lw);
    },
    hat: (hx, hr, lw) => {
      helmet(c0, hx, hr, lw, "#17151d");
      box(c0, hx + hr * 0.35, -hr * 0.55, hr * 0.25, hr * 1.1, hr * 0.1, "#ff8a5c", 0);
    },
  })),
};

/** I tre re: stessa sagoma, colori diversi. */
function king(armor: string, capeCol: string, gold: string, eye: string, blade: string): Draw {
  return zombie({ skin: armor, shirt: armor, arms: "hold", reach: 1, eyes: eye, bulk: 1.15, headSize: 0.9 }, (s, step) => ({
    back: (lw) => cape(c0, s, step, capeCol, lw, 1.5),
    chest: (lw) => {
      for (const side of [-1, 1]) shape(c0, [-0.35 * s, side * 0.95 * s, 0, side * 1.6 * s, 0.4 * s, side * 0.95 * s], gold, lw);
    },
    held: (lw) => {
      limb(c0, 0.85 * s, -0.14 * s, 2.15 * s, -0.14 * s, 0.26 * s, blade, lw);
      box(c0, 0.8 * s, -0.55 * s, 0.16 * s, 0.82 * s, 0.05 * s, gold, lw * 0.7);
    },
    hat: (hx, hr, lw) => crown(c0, hx - hr * 0.35, hr * 0.78, lw, gold, eye),
  }));
}

function snowman(big: boolean): Draw {
  return (c, s, step, frame) => {
    const lw = Math.max(1, s * 0.1);
    for (const side of [-1, 1]) {
      const y = side * (1.55 + step * side * 0.1) * s;
      limb(c, 0, side * 0.8 * s, 0.5 * s, y, 0.1 * s, "#6b4a2a", lw * 0.5);
      limb(c, 0.35 * s, side * 1.3 * s, 0.75 * s, side * 1.35 * s, 0.07 * s, "#6b4a2a", 0);
    }
    dot(c, -0.25 * s, 0, 1.0 * s, "#f6fbff", lw);
    if (big) {
      c.strokeStyle = "#d93a2f";
      c.lineWidth = 0.22 * s;
      c.beginPath();
      c.arc(0.35 * s, 0, 0.72 * s, 0.6, TAU - 0.6);
      c.stroke();
    }
    for (const y of [-0.45, 0, 0.45]) dot(c, -0.65 * s, y * s, 0.09 * s, INK);
    dot(c, 0.4 * s, 0, 0.62 * s, "#ffffff", lw);
    shape(c, [0.85 * s, -0.12 * s, 1.5 * s + (frame % 2) * 0.04 * s, 0, 0.85 * s, 0.12 * s], "#ff8a3a", lw * 0.6);
    for (const side of [-1, 1]) dot(c, 0.72 * s, side * 0.26 * s, 0.08 * s, INK);
    if (big) {
      dot(c, 0.25 * s, 0, 0.55 * s, "#15181c", lw);
      dot(c, 0.25 * s, 0, 0.36 * s, "#15181c", lw * 0.7, "#d93a2f");
    }
  };
}

// Il contesto in uso: le tabelle qui sopra sono funzioni brevi e lo leggono da qui.
let c0: C;

/** Disegna un nemico rivolto a destra, centrato nell'origine. r è il raggio in pixel; frame 0..3 è il passo. */
export function enemyFigure(c: C, kind: string, boss: boolean, r: number, frame: number) {
  c0 = c;
  const s = r * 0.8;
  const step = [0, 1, 0, -1][frame & 3];
  c.lineCap = "round";
  c.lineJoin = "round";
  (ENEMY[kind] ?? ENEMY.risacca)(c, s, step, frame, boss);
}

export const hasFigure = (kind: string) => kind in ENEMY;
