// Interfaccia delle scelte: puntamento, offerte tra le ondate, ordini, bracieri, momenti rapidi.
// Legge solo lo stato e manda comandi: le regole restano nella simulazione.
import { MAP_W, TICKS_PER_SECOND, TOWERS } from "../sim-core/content";
import { Command, GameEvent, GameState, blizzardNext, brazierMax, eruptionNext, hasAttack, isCold, onLava } from "../sim-core/sim";
import { AIMS, AIM_HELP, AIM_NAMES, BLIZZARD, CONTRACTS, MERCHANT, ORDERS, ORDER_IDS, POISONS, QTE, QTE_SYMBOLS, RELICS, contractReward, merchantGold } from "../sim-core/twists";
import { MODS } from "../sim-core/content";

type Send = (c: Command) => void;
const GLYPHS = ["🔔", "⭐", "❄️", "🎄", "🎁", "⛄"];

function btn(cls: string, html: string, onclick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.innerHTML = html;
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  b.addEventListener("click", onclick);
  return b;
}
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---------- puntamento ----------

export function renderAim(host: HTMLElement, state: GameState, t: GameState["towers"][number], mine: boolean, send: Send) {
  const show = hasAttack(t);
  host.hidden = !show;
  if (!show) return;
  const cur = t.aim ?? (TOWERS[t.kind].target === "strong" ? "strong" : "first");
  const sig = `${t.id}:${cur}:${mine}`;
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  host.innerHTML = "";
  for (const a of AIMS) {
    const b = btn("", AIM_NAMES[a], () => send({ t: "aim", id: t.id, aim: a }), { "data-aim": a, title: AIM_HELP[a], "aria-pressed": String(a === cur) });
    b.disabled = !mine;
    host.append(b);
  }
  void state;
}

// ---------- offerte ----------

const OFFER_TITLE: Record<string, string> = {
  mercante: "Il Mercante è passato dal Faro",
  contratto: "Contratti per la prossima ondata",
  reliquia: "Il Re Caduto ha lasciato delle reliquie",
  veleno: "Scegli il veleno delle prossime 10 ondate",
};
const OFFER_NOTE: Record<string, string> = {
  mercante: "Scegline una: le altre se ne vanno con lui.",
  contratto: "Pagano solo se nessun nemico arriva al Faro.",
  reliquia: "Una sola, e porta una maledizione.",
  veleno: "Se non scegli, vale la prima.",
};

let laterId = 0;
export function renderChoice(host: HTMLElement, state: GameState, send: Send, multi: boolean) {
  const o = state.tw?.offer;
  if (!o || state.phase === "won" || state.phase === "lost") {
    host.hidden = true;
    host.dataset.sig = "";
    return;
  }
  const sig = `${o.id}:${laterId === o.id}`;
  host.hidden = false;
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  host.innerHTML = "";
  if (laterId === o.id) {
    host.className = "mini";
    host.append(btn("later", "Scelta in sospeso: apri", () => {
      laterId = 0;
      renderChoice(host, state, send, multi);
    }));
    return;
  }
  host.className = "";
  const head = document.createElement("header");
  head.innerHTML = `<b>${OFFER_TITLE[o.kind]}</b><small>${OFFER_NOTE[o.kind]}${multi ? " Sceglie il primo che tocca." : ""}</small>`;
  const opts = document.createElement("div");
  opts.className = "opts";
  o.options.forEach((id, i) => {
    let html = "";
    if (o.kind === "mercante") {
      const m = MERCHANT[id];
      html = `<b>${m.name}</b><small>${id === "oro" ? `+${merchantGold(state.cleared)} cash a testa` : m.text}</small>`;
    } else if (o.kind === "contratto") {
      const c = CONTRACTS[id];
      html = `<b>${c.name}</b><small>${c.text}</small><small>Premio ${contractReward(state.wave + 1, c.rewardBp)} cash a testa</small>`;
    } else if (o.kind === "reliquia") {
      const r = RELICS[id];
      html = `<b>${r.name}</b><small>${r.good}</small><small class="bad">${r.bad}</small>`;
    } else {
      const set = POISONS[Number(id)];
      html = `<b>${set.map((m) => MODS[m].name).join(" + ")}</b><small>${set.map((m) => MODS[m].summary).join(" ")}</small>`;
    }
    opts.append(btn("opt", html, () => send({ t: "choose", offer: o.id, pick: i }), { "data-pick": String(i) }));
  });
  host.append(head, opts);
  if (o.kind !== "veleno")
    host.append(btn("later", o.kind === "contratto" ? "Nessun contratto" : "Dopo", () => {
      laterId = o.id;
      renderChoice(host, state, send, multi);
    }));
}

// ---------- momento rapido (Notte 5) ----------

export function renderQte(host: HTMLElement, state: GameState, send: Send) {
  const q = state.tw?.qte;
  if (!q) {
    host.hidden = true;
    host.dataset.sig = "";
    return;
  }
  host.hidden = false;
  const sig = String(q.id);
  if (host.dataset.sig !== sig) {
    host.dataset.sig = sig;
    host.innerHTML = "";
    const box = document.createElement("div");
    box.className = "box";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.innerHTML = "<i></i>";
    if (q.kind === "simbolo") {
      const want = q.symbols[q.answer];
      box.innerHTML = `<h3>Krampus lancia la catena!</h3><div>Tocca questo simbolo</div><div class="glyph" aria-label="${QTE_SYMBOLS[want]}">${GLYPHS[want]}</div>`;
      const row = document.createElement("div");
      row.className = "syms";
      q.symbols.forEach((sym, i) => row.append(btn("", GLYPHS[sym], () => send({ t: "qte", id: q.id, pick: i }), { "aria-label": QTE_SYMBOLS[sym], "data-sym": String(i) })));
      box.append(row, bar);
    } else {
      box.innerHTML = `<h3>Spezza le catene!</h3><div>Tocca più in fretta che puoi</div>`;
      const mash = btn("mash", `Colpisci! <span>0/${QTE.mash}</span>`, () => send({ t: "qte", id: q.id, pick: -1 }));
      // Su telefono il tocco va subito, senza aspettare il click.
      mash.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        send({ t: "qte", id: q.id, pick: -1 });
      });
      mash.addEventListener("click", (ev) => ev.stopImmediatePropagation(), true);
      box.append(mash, bar);
    }
    host.append(box);
  }
  const left = Math.max(0, q.until - state.tick);
  host.querySelector<HTMLElement>(".bar")?.style.setProperty("--p", String(left / QTE.window));
  const n = host.querySelector(".mash span");
  if (n) n.textContent = `${q.got}/${QTE.mash}`;
}

/** Tasti: 1, 2, 3 per i simboli, spazio per la raffica. */
export function qteKey(state: GameState, key: string, send: Send): boolean {
  const q = state.tw?.qte;
  if (!q) return false;
  if (q.kind === "simbolo" && ["1", "2", "3"].includes(key)) {
    send({ t: "qte", id: q.id, pick: Number(key) - 1 });
    return true;
  }
  if (q.kind === "raffica" && (key === " " || key === "Enter")) {
    send({ t: "qte", id: q.id, pick: -1 });
    return true;
  }
  return false;
}

// ---------- stato della modalità nella plancia ----------

export function renderTwist(host: HTMLElement, bar: HTMLElement, state: GameState, send: Send, brazierMode: boolean, toggleBrazier: () => void) {
  const tw = state.tw;
  if (!tw) {
    host.hidden = true;
    bar.hidden = true;
    return;
  }
  const chips: Array<[string, string, string]> = [];
  for (const r of tw.relics) chips.push([RELICS[r].name, "good", `${RELICS[r].good}. ${RELICS[r].bad}`]);
  if (tw.contract) chips.push([`Contratto: ${CONTRACTS[tw.contract].name}`, "bad", CONTRACTS[tw.contract].text]);
  if (tw.discountWaves) chips.push([`Sconto -25% (${tw.discountWaves})`, "good", "Torri e miglioramenti scontati"]);
  if (tw.bountyWaves) chips.push([`Taglie +50% (${tw.bountyWaves})`, "good", "Ogni nemico vale di più"]);
  if (tw.poison >= 0 && state.mode === "hardcore") chips.push([`Veleno: ${POISONS[tw.poison].map((m) => MODS[m].name).join(" + ")}`, "bad", "Modificatori di questo blocco"]);
  if (state.mode === "molten" && eruptionNext(state) && state.phase === "prep") chips.push(["Eruzione alla prossima ondata!", "bad", "Le torri sulle bocche di lava si fermeranno"]);
  if (state.mode === "frost" && (tw.blizzard || blizzardNext(state))) chips.push([tw.blizzard ? "Bufera in corso" : "Bufera alla prossima ondata!", "bad", "Nella bufera le torri lontane dai bracieri sparano più piano"]);
  if (state.mode === "natale" && state.night === 5 && tw.qteWins + tw.qteFails > 0) chips.push([`Momenti rapidi: ${tw.qteWins} vinti, ${tw.qteFails} persi`, "", "Ai mini-boss e a ogni quarto di vita di Krampus"]);
  const sigC = JSON.stringify(chips);
  host.hidden = !chips.length;
  if (host.dataset.sig !== sigC) {
    host.dataset.sig = sigC;
    host.innerHTML = "";
    const row = document.createElement("div");
    row.className = "chips";
    for (const [t, c, title] of chips) {
      const sp = document.createElement("span");
      sp.className = c;
      sp.textContent = t;
      sp.title = title;
      row.append(sp);
    }
    host.append(row);
  }
  // Barra sulla carta, solo in preparazione: ordini in Campagna, bracieri in Frost.
  const prep = state.phase === "prep" && !tw.offer;
  const camp = prep && state.mode === "campagna";
  const frost = prep && state.mode === "frost";
  bar.hidden = !camp && !frost;
  const sigB = JSON.stringify([camp && tw.order, frost && [tw.braziers.length, brazierMax(state), brazierMode]]);
  if (bar.hidden || bar.dataset.sig === sigB) return;
  bar.dataset.sig = sigB;
  bar.innerHTML = "";
  if (camp) {
    const lab = document.createElement("small");
    lab.textContent = "Ordine per l'ondata:";
    bar.append(lab);
    for (const o of ORDER_IDS) bar.append(btn("", `<b>${ORDERS[o].name}</b><small>${ORDERS[o].text}</small>`, () => send({ t: "order", order: tw.order === o ? "" : o }), { "data-order": o, "aria-pressed": String(tw.order === o), title: ORDERS[o].text }));
  }
  if (frost) {
    bar.append(btn(brazierMode ? "on" : "", brazierMode ? "<b>Tocca la carta</b><small>dove mettere il braciere</small>" : `<b>Bracieri ${tw.braziers.length}/${brazierMax(state)}</b><small>tocca per spostarne uno</small>`, toggleBrazier, { id: "brazierBtn" }));
  }
}

// ---------- disegno sulla carta ----------

export interface DrawApi {
  ctx: CanvasRenderingContext2D;
  cellRect(cx: number, cy: number): { x: number; y: number; w: number; h: number };
  S(x: number, y: number): { x: number; y: number };
  px(units: number): number;
  now: number;
  calm: boolean;
}

export function drawTwist(d: DrawApi, state: GameState, brazierMode: boolean) {
  const tw = state.tw;
  if (!tw) return;
  const { ctx } = d;
  const pulse = d.calm ? 0.5 : 0.5 + 0.5 * Math.sin(d.now / 260);
  if (tw.lava.length) {
    const hot = eruptionNext(state) && state.phase === "prep";
    for (const k of tw.lava) {
      const r = d.cellRect(k % MAP_W, Math.floor(k / MAP_W));
      const g = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 1, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.7);
      g.addColorStop(0, `rgba(255,140,50,${0.35 + (hot ? 0.35 : 0.15) * pulse})`);
      g.addColorStop(1, "rgba(120,30,10,0)");
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = `rgba(255,170,80,${0.45 + 0.3 * pulse})`;
      ctx.lineWidth = Math.max(1, r.w * 0.04);
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.2, r.y + r.h * 0.3);
      ctx.lineTo(r.x + r.w * 0.45, r.y + r.h * 0.5);
      ctx.lineTo(r.x + r.w * 0.38, r.y + r.h * 0.8);
      ctx.moveTo(r.x + r.w * 0.45, r.y + r.h * 0.5);
      ctx.lineTo(r.x + r.w * 0.8, r.y + r.h * 0.42);
      ctx.stroke();
    }
  }
  if (state.mode === "frost") {
    for (const k of tw.braziers) {
      const r = d.cellRect(k % MAP_W, Math.floor(k / MAP_W));
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      if (tw.blizzard || brazierMode || blizzardNext(state)) {
        ctx.strokeStyle = "rgba(255,176,102,.45)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, d.px(BLIZZARD.radius), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = "#5a3a24";
      ctx.fillRect(cx - r.w * 0.22, cy + r.h * 0.05, r.w * 0.44, r.h * 0.18);
      ctx.fillStyle = `rgba(255,${150 + 60 * pulse},60,.95)`;
      ctx.beginPath();
      ctx.moveTo(cx - r.w * 0.16, cy + r.h * 0.06);
      ctx.quadraticCurveTo(cx, cy - r.h * (0.3 + 0.08 * pulse), cx + r.w * 0.16, cy + r.h * 0.06);
      ctx.fill();
    }
    if (tw.blizzard) {
      ctx.fillStyle = "rgba(220,235,255,.10)";
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      for (const t of state.towers) {
        if (!isCold(state, t)) continue;
        const p = d.S(t.x, t.y);
        ctx.fillStyle = "rgba(170,210,255,.9)";
        ctx.font = `${Math.round(d.px(450))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("❄", p.x + d.px(350), p.y - d.px(250));
      }
    }
  }
  void onLava;
}

/** Testo da mostrare per gli eventi delle scelte; null se l'evento non ne ha. */
export function twistToast(ev: GameEvent, state: GameState): string | null {
  switch (ev.e) {
    case "offer":
      return ev.kind === "mercante" ? "Il Mercante è arrivato" : ev.kind === "contratto" ? "Nuovi contratti" : ev.kind === "reliquia" ? "Reliquie del Re Caduto" : "Scegli il veleno";
    case "chosen":
      return ev.kind === "mercante" ? `Preso: ${MERCHANT[ev.pick]?.name}` : ev.kind === "contratto" ? `Contratto accettato: ${CONTRACTS[ev.pick]?.name}` : ev.kind === "reliquia" ? `Reliquia: ${RELICS[ev.pick]?.name}` : "Veleno scelto";
    case "contract":
      return ev.ok ? `Contratto riuscito: +${ev.amount} cash` : "Contratto fallito: un nemico è arrivato al Faro";
    case "eruption":
      return "Eruzione! Le torri sulla lava si fermano";
    case "blizzard":
      return ev.on ? "Bufera: scaldati ai bracieri" : "La bufera si calma";
    case "qteEnd":
      return ev.ok ? "Catene spezzate!" : "Troppo lento: arrivano rinforzi";
    default:
      return null;
  }
  void state;
  void TICKS_PER_SECOND;
}

export { esc };
