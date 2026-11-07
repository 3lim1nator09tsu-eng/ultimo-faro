// Pannello admin: prova delle torri, comandi in partita, progressi, bilanciamento e premi ai giocatori.
// Le prove di bilanciamento valgono su questo dispositivo; pubblicate, valgono per tutti dal server.
import { NIGHTS, SURVIVAL } from "../sim-core/modes";
import { ADMIN_ONLY, EVENT_LEVELS, levelById, ENEMIES, EnemyKind, GameMode, LEVELS, MAX_RANK, MOD_ORDER, MODS, Mod, SURVIVAL_MAPS, TOWERS, TOWER_ORDER, TowerKind } from "../sim-core/content";
import { ShopOv, shopValue } from "../sim-core/balance";
import { ALL_MODES, Balance, LevelKey, MAP_FIELDS, MODE_FIELDS, MapOv, ModeOv, TOWER_FIELDS, TowerOv, Unit, balanceSize, fromShown, levelRef, mapBaseValue, mapValue, modeBaseValue, modeByKey, modeKey, modeValue, toShown, towerBaseValue } from "../sim-core/balance";
import { Command, GameState } from "../sim-core/sim";
import type { GrantPayload, PeekRow } from "./net";

export type BalanceKind = "towers" | "modes" | "maps" | "shop";
export type BalanceEntry = TowerOv | ModeOv | MapOv | ShopOv;

const shopLabel = (key: string) => {
  const [a, b] = key.split(".");
  if (a === "rank") return `Arsenale · Rango ${b} (tutte le torri), Schegge`;
  return `${TOWERS[a as TowerKind].name} · Sblocco in ${b === "perle" ? "Perle" : "Schegge"}`;
};

export interface AdminApi {
  state(): GameState;
  send(cmd: Command): void;
  toast(text: string): void;
  startSandbox(level: string, mode: GameMode, night?: number, eventBp?: number): void;
  setSpeed(n: number): void;
  dps(on?: boolean): boolean;
  progress: Record<string, () => void>;
  balance: {
    /** Prove su questo dispositivo, non ancora pubblicate. */
    draft(): Balance;
    /** Valori pubblicati sul server, validi per tutti. */
    published(): Balance;
    publishedNote(): string;
    /** Serve l'account admin collegato. */
    canPublish(): boolean;
    setDraft(kind: BalanceKind, entry: BalanceEntry): void;
    clearDraft(): void;
    publish(title: string): Promise<void>;
    unpublish(kind: BalanceKind, entry: BalanceEntry): Promise<void>;
    resetPublished(): Promise<void>;
    reload(): Promise<void>;
  };
  /** Nomi dei giocatori della partita, nell'ordine della simulazione: il cash admin va a uno solo. */
  players?(): string[];
  /** Premi ai giocatori: presente solo con l'account admin collegato. */
  grants?: {
    peek(username: string): Promise<PeekRow | null>;
    grant(userId: string, payload: GrantPayload, note: string): Promise<void>;
  };
  /** Stanze online: presenti solo con l'account admin collegato. */
  online?: {
    rooms(): Promise<Array<{ code: string; status: string; mode: string; level: string; night: number; info: Record<string, unknown>; updated_at: string }>>;
    command(code: string, cmd: Command): Promise<void>;
  };
}

const LEVEL_KEYS: LevelKey[] = ["1", "2", "3", "A", "B", "A2", "B2"];
export function levelName(kind: TowerKind, lvl: LevelKey): string {
  const def = TOWERS[kind];
  if (lvl === "A" || lvl === "B") return `4${lvl} ${def.branches[lvl].name}`;
  if (lvl === "A2" || lvl === "B2") return `5${lvl[0]} ${def.branches2?.[lvl[0] as "A" | "B"]?.name ?? ""}`;
  return `livello ${lvl}`;
}
export const modeLabel = (k: string) => {
  const m = modeByKey(k);
  if (!m) return k;
  return m.id === "natale" ? m.name.split(" · ")[0] : m.id === "hardcore" ? "Hardcore" : m.name;
};
const mapName = (id: string) => {
  try {
    return levelById(id).name;
  } catch {
    return id;
  }
};
const shown = (unit: Unit, v: number) => `${toShown(unit, v).toLocaleString("it-IT")}${unit === "bp" || unit === "pct" || unit === "slow" ? "%" : ""}`;

/** Una riga leggibile per la bacheca: "Kingpin, livello 2 · Danno 30 → 40". */
export function describeEntry(kind: BalanceKind, o: BalanceEntry): string {
  if (kind === "towers") {
    const t = o as TowerOv;
    const f = TOWER_FIELDS.find((x) => x.field === t.field)!;
    return `${TOWERS[t.kind].name}, ${levelName(t.kind, t.lvl)} · ${f.label.replace(/ \(.*\)$/, "")}: ${shown(f.unit, towerBaseValue(t))} → ${shown(f.unit, t.value)}`;
  }
  if (kind === "shop") {
    const o2 = o as ShopOv;
    return `${shopLabel(o2.key)}: ${shopValue(o2.key, true).toLocaleString("it-IT")} → ${o2.value.toLocaleString("it-IT")}`;
  }
  if (kind === "modes") {
    const m = o as ModeOv;
    const def = modeByKey(m.mode)!;
    const f = m.field.startsWith("mapHp:") ? { label: `Vita su ${mapName(m.field.slice(6))}`, unit: "bp" as Unit } : MODE_FIELDS.find((x) => x.field === m.field)!;
    return `${modeLabel(m.mode)} · ${f.label.replace(/ \(.*\)$/, "")}: ${shown(f.unit, modeBaseValue(def, m.field))} → ${shown(f.unit, m.value)}`;
  }
  const p = o as MapOv;
  const f = MAP_FIELDS.find((x) => x.field === p.field)!;
  return `${mapName(p.map)} · ${f.label.replace(/ \(.*\)$/, "")}: ${shown(f.unit, mapBaseValue(p.map, p.field))} → ${shown(f.unit, p.value)}`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Array<Node | string>) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = String(v);
    else if (k === "text") e.textContent = String(v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v as EventListener);
    else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? "" : String(v));
  }
  e.append(...kids);
  return e;
};

// ---------- pannello del menu ----------

export function renderAdminPanel(host: HTMLElement, api: AdminApi, close: () => void) {
  host.innerHTML = "";
  const tabs: Array<[string, (body: HTMLElement) => void]> = [
    ["Prova torri", (b) => sandboxTab(b, api)],
    ["Progressi", (b) => progressTab(b, api)],
    ["Bilancia torri", (b) => towerBalanceTab(b, api, () => show(current))],
    ["Bilancia modalità", (b) => modeBalanceTab(b, api, () => show(current))],
    ["Giocatori", (b) => playersTab(b, api)],
    ...(api.online ? [["Stanze online", (b: HTMLElement) => onlineTab(b, api)] as [string, (body: HTMLElement) => void]] : []),
  ];
  let current = 0;
  try {
    current = Math.min(tabs.length - 1, Number(sessionStorage.getItem("faro.adminTab")) || 0);
  } catch {
    /* facoltativo */
  }
  const head = el("header", { class: "adHead" }, el("h2", { text: "Pannello admin" }), el("button", { class: "adClose", text: "Chiudi", onclick: close }));
  const bar = el("div", { class: "adTabs", role: "tablist" });
  const body = el("div", { class: "adBody" });
  const show = (i: number) => {
    current = i;
    try {
      sessionStorage.setItem("faro.adminTab", String(i));
    } catch {
      /* facoltativo */
    }
    for (const [j, b] of [...bar.children].entries()) b.setAttribute("aria-selected", String(j === i));
    const y = body.scrollTop;
    body.innerHTML = "";
    tabs[i][1](body);
    body.scrollTop = y;
  };
  tabs.forEach(([t], i) => bar.append(el("button", { role: "tab", text: t, onclick: () => show(i) })));
  host.append(head, el("p", { class: "note", text: "Le partite di prova non danno premi e non contano per classifiche e missioni." }), bar, body);
  show(current);
}

function sandboxTab(body: HTMLElement, api: AdminApi) {
  const level = el("select", { id: "adLevel" }, ...[...LEVELS, ...EVENT_LEVELS].map((l) => el("option", { value: l.id, text: l.name })));
  const options: Array<[string, string]> = [
    ["campagna", "Campagna"],
    ["infinita", "Infinita"],
    ...SURVIVAL.map((m): [string, string] => [m.id, `${m.name} · ${m.waves} ondate`]),
    ["hardcore", "Hardcore · 50 ondate"],
    ...NIGHTS.map((n): [string, string] => [`natale:${n.night}`, `${n.name} (mappa fissa)`]),
  ];
  const mode = el("select", { id: "adMode" }, ...options.map(([value, text]) => el("option", { value, text })));
  const gelo = el("select", { id: "adGelo" }, ...[10000, 8800, 7800, 6800, 6000].map((v) => el("option", { value: String(v), text: `${v / 100}%` })));
  body.append(
    el("p", { text: "Partita di prova con tutte le torri, 100.000 cash e i comandi admin sempre a portata. Il tasto Admin sulla carta apre i comandi durante la partita." }),
    el("label", { class: "adField" }, "Mappa", level),
    el("label", { class: "adField" }, "Modalità", mode),
    el("label", { class: "adField" }, "Forza dell'evento (solo Notti)", gelo),
    el("button", {
      class: "mode",
      id: "adStart",
      text: "Avvia la prova",
      onclick: () => {
        const [m, n] = mode.value.split(":");
        api.startSandbox(level.value, m as GameMode, n ? Number(n) : undefined, Number(gelo.value));
      },
    }),
  );
}

function progressTab(body: HTMLElement, api: AdminApi) {
  const actions: Array<[string, string]> = [
    ["schegge", "+1.000 Schegge"],
    ["perle", "+100 Perle Nere"],
    ["xp", "+1.000 XP"],
    ["unlockAll", "Sblocca tutte le torri"],
    ["ranks5", "Ranghi al massimo"],
    ["ranks1", "Ranghi a 1"],
    ["levels", "Apri tutti i livelli e l'Hardcore"],
    ["missions", "Completa le missioni attive"],
  ];
  const grid = el("div", { class: "adGrid" });
  for (const [k, label] of actions) grid.append(el("button", { "data-admin": k, text: label, onclick: () => api.progress[k]?.() }));
  // Azzerare chiede una conferma nella pagina stessa.
  const reset = el("button", { class: "danger", "data-admin": "reset", text: "Azzera tutti i progressi" });
  reset.addEventListener("click", () => {
    if (reset.dataset.armed) {
      api.progress.reset?.();
      return;
    }
    reset.dataset.armed = "1";
    reset.textContent = "Tocca di nuovo per azzerare";
    setTimeout(() => {
      delete reset.dataset.armed;
      reset.textContent = "Azzera tutti i progressi";
    }, 3000);
  });
  body.append(grid, reset);
}

// ---------- bilanciamento ----------

/** Riga con valore attuale, originale e tasto Applica. */
function numberRow(label: string, unit: Unit, value: number, base: number, attrs: Record<string, string>, onApply: (v: number) => void, toast: (t: string) => void) {
  const input = el("input", { type: "number", step: unit === "tile" ? "0.1" : unit === "bp" || unit === "pct" || unit === "slow" ? "1" : "1", value: String(toShown(unit, value)), ...attrs }) as HTMLInputElement;
  const apply = el("button", {
    text: "Applica",
    onclick: () => {
      const n = Number(input.value);
      if (input.value.trim() === "" || !Number.isFinite(n) || n < 0) return toast("Inserisci un numero valido");
      onApply(fromShown(unit, n));
    },
  });
  input.addEventListener("keydown", (ev) => (ev as KeyboardEvent).key === "Enter" && apply.click());
  const changed = value !== base;
  return el("label", { class: `adRow${changed ? " changed" : ""}` }, el("span", { text: label }, el("small", { text: changed ? `originale ${shown(unit, base)}` : "" })), input, apply);
}

function towerBalanceTab(body: HTMLElement, api: AdminApi, redraw: () => void) {
  let pick: { kind: TowerKind; lvl: LevelKey } = { kind: "balestra", lvl: "1" };
  try {
    const saved = JSON.parse(sessionStorage.getItem("faro.adTower") || "null");
    if (saved && TOWER_ORDER.includes(saved.kind) && LEVEL_KEYS.includes(saved.lvl)) pick = saved;
  } catch {
    /* facoltativo */
  }
  const remember = () => {
    try {
      sessionStorage.setItem("faro.adTower", JSON.stringify(pick));
    } catch {
      /* facoltativo */
    }
  };
  const kind = el("select", { id: "adTower" }, ...TOWER_ORDER.map((k) => el("option", { value: k, text: TOWERS[k].name, selected: k === pick.kind }))) as HTMLSelectElement;
  const lvl = el("select", { id: "adLvl" }) as HTMLSelectElement;
  const form = el("div", { class: "adForm" });
  const refreshLevels = () => {
    lvl.innerHTML = "";
    for (const L of LEVEL_KEYS) if (levelRef(pick.kind, L)) lvl.append(el("option", { value: L, text: levelName(pick.kind, L), selected: L === pick.lvl }));
    if (!levelRef(pick.kind, pick.lvl)) pick.lvl = "1";
  };
  const refreshForm = () => {
    form.innerHTML = "";
    const ref = levelRef(pick.kind, pick.lvl)!;
    for (const f of TOWER_FIELDS) {
      const value = ref[f.field as string];
      if (value === undefined) continue;
      const base = towerBaseValue({ kind: pick.kind, lvl: pick.lvl, field: f.field });
      const relevant = f.field === "cost" || value !== base || (f.field === "slowBp" ? value < 10000 : f.field === "markBp" ? value > 10000 : value > 0);
      if (!relevant) continue;
      form.append(numberRow(f.label, f.unit, value, base, { "data-field": f.field as string }, (v) => {
        api.balance.setDraft("towers", { kind: pick.kind, lvl: pick.lvl, field: f.field, value: v });
        redraw();
      }, api.toast));
    }
  };
  kind.addEventListener("change", () => {
    pick = { kind: kind.value as TowerKind, lvl: "1" };
    remember();
    refreshLevels();
    refreshForm();
  });
  lvl.addEventListener("change", () => {
    pick.lvl = lvl.value as LevelKey;
    remember();
    refreshForm();
  });
  // Arsenale: prezzi di sblocco della torre scelta e dei ranghi (uguali per tutte le torri).
  const shop = el("div", { class: "adForm", id: "adShopForm" });
  const refreshShop = () => {
    shop.innerHTML = "";
    const def = TOWERS[pick.kind];
    if (def.exclusive) shop.append(el("p", { class: "note", text: def.exclusive === "admin" ? "Torre admin: non si compra." : "Premio della Notte 5: non si compra." }));
    else
      for (const [field, label] of [["unlock", "Sblocco: Schegge"], ["perle", "Sblocco: Perle Nere"]] as const) {
        const key = `${pick.kind}.${field}`;
        shop.append(numberRow(label, "n", shopValue(key), shopValue(key, true), { "data-shop": key }, (v) => {
          api.balance.setDraft("shop", { key, value: v });
          redraw();
        }, api.toast));
      }
    shop.append(el("h4", { text: "Ranghi, per tutte le torri (Schegge)" }));
    for (let r = 2; r <= MAX_RANK; r++) {
      const key = `rank.${r}`;
      shop.append(numberRow(`Salire al rango ${r}`, "n", shopValue(key), shopValue(key, true), { "data-shop": key }, (v) => {
        api.balance.setDraft("shop", { key, value: v });
        redraw();
      }, api.toast));
    }
  };
  kind.addEventListener("change", refreshShop);
  refreshLevels();
  refreshForm();
  refreshShop();
  body.append(
    el("p", { text: "Le modifiche valgono subito su questo dispositivo, così le provi. Quando ti convincono, pubblicale: arrivano a tutti i giocatori al prossimo avvio del gioco." }),
    el("label", { class: "adField" }, "Torre", kind),
    el("h3", { text: "Arsenale: prezzo di sblocco" }),
    el("p", { class: "note", text: "Se metti sia Schegge sia Perle, servono tutte e due. 0 = niente di quella valuta." }),
    shop,
    el("h3", { text: "In partita" }),
    el("label", { class: "adField" }, "Livello", lvl),
    form,
  );
  balanceFooter(body, api, redraw);
}

function modeBalanceTab(body: HTMLElement, api: AdminApi, redraw: () => void) {
  let modeK = "easy";
  let mapK = "porto";
  try {
    modeK = modeByKey(sessionStorage.getItem("faro.adMode") || "") ? sessionStorage.getItem("faro.adMode")! : "easy";
    mapK = sessionStorage.getItem("faro.adMap") || "porto";
  } catch {
    /* facoltativo */
  }
  const mapIds = [...SURVIVAL_MAPS, ...EVENT_LEVELS.filter((l) => !SURVIVAL_MAPS.includes(l.id)).map((l) => l.id)];
  if (!mapIds.includes(mapK)) mapK = "porto";
  const modeSel = el("select", { id: "adBalMode" }, ...ALL_MODES.map((m) => el("option", { value: modeKey(m), text: m.id === "natale" ? m.name : `${modeLabel(modeKey(m))} · ${m.waves} ondate`, selected: modeKey(m) === modeK }))) as HTMLSelectElement;
  const mapSel = el("select", { id: "adBalMap" }, ...mapIds.map((id) => el("option", { value: id, text: mapName(id), selected: id === mapK }))) as HTMLSelectElement;
  const modeForm = el("div", { class: "adForm", id: "adModeForm" });
  const mapForm = el("div", { class: "adForm", id: "adMapForm" });
  const fillMode = () => {
    modeForm.innerHTML = "";
    const m = modeByKey(modeK)!;
    for (const f of MODE_FIELDS) {
      if (f.field === "minisBp" && !m.minis.length) continue;
      modeForm.append(numberRow(f.label, f.unit, modeValue(m, f.field), modeBaseValue(m, f.field), { "data-mfield": f.field }, (v) => {
        if (v > f.max) return api.toast(`Al massimo ${shown(f.unit, f.max)}`);
        api.balance.setDraft("modes", { mode: modeK, field: f.field, value: v });
        redraw();
      }, api.toast));
    }
    modeForm.append(el("h4", { text: "Correzione per mappa, solo in questa modalità" }));
    for (const id of m.maps) {
      const field = `mapHp:${id}`;
      modeForm.append(numberRow(`Vita su ${mapName(id)} (%)`, "bp", modeValue(m, field), modeBaseValue(m, field), { "data-mfield": field }, (v) => {
        if (v > 100000) return api.toast("Al massimo 1000%");
        api.balance.setDraft("modes", { mode: modeK, field, value: v });
        redraw();
      }, api.toast));
    }
  };
  const fillMap = () => {
    mapForm.innerHTML = "";
    for (const f of MAP_FIELDS) {
      mapForm.append(numberRow(f.label, f.unit, mapValue(mapK, f.field), mapBaseValue(mapK, f.field), { "data-pfield": f.field }, (v) => {
        if (v > f.max) return api.toast(`Al massimo ${shown(f.unit, f.max)}`);
        api.balance.setDraft("maps", { map: mapK, field: f.field, value: v });
        redraw();
      }, api.toast));
    }
  };
  modeSel.addEventListener("change", () => {
    modeK = modeSel.value;
    try {
      sessionStorage.setItem("faro.adMode", modeK);
    } catch {
      /* facoltativo */
    }
    fillMode();
  });
  mapSel.addEventListener("change", () => {
    mapK = mapSel.value;
    try {
      sessionStorage.setItem("faro.adMap", mapK);
    } catch {
      /* facoltativo */
    }
    fillMap();
  });
  fillMode();
  fillMap();
  body.append(
    el("p", { text: "La vita reale di un nemico è: vita base × curva dell'ondata × vita della modalità × correzione della mappa. Sotto ogni campo cambiato vedi il valore originale. La Campagna e l'Infinita hanno ondate scritte a mano: per loro contano solo le mappe." }),
    el("label", { class: "adField" }, "Modalità", modeSel),
    modeForm,
    el("h3", { text: "Mappa" }),
    el("p", { class: "note", text: "La vita su mappa vale in tutte le modalità a ricetta (sopravvivenza, Hardcore, Notti); il cash iniziale vale ovunque, Campagna compresa." }),
    el("label", { class: "adField" }, "Mappa", mapSel),
    mapForm,
  );
  balanceFooter(body, api, redraw);
}

function entries(b: Balance): Array<[BalanceKind, BalanceEntry]> {
  return [
    ...b.towers.map((o): [BalanceKind, BalanceEntry] => ["towers", o]),
    ...b.modes.map((o): [BalanceKind, BalanceEntry] => ["modes", o]),
    ...b.maps.map((o): [BalanceKind, BalanceEntry] => ["maps", o]),
    ...(b.shop ?? []).map((o): [BalanceKind, BalanceEntry] => ["shop", o]),
  ];
}
/** Tutte le voci in righe leggibili, per la bacheca. */
export const describeAll = (b: Balance) => entries(b).map(([k, o]) => describeEntry(k, o));

/** Prove locali, pubblicazione e valori già pubblicati: in fondo alle due schede di bilanciamento. */
function balanceFooter(body: HTMLElement, api: AdminApi, redraw: () => void) {
  const B = api.balance;
  const draft = B.draft();
  const pub = B.published();
  const box = el("section", { class: "adBalance" });
  box.append(el("h3", { text: `Prove su questo dispositivo (${balanceSize(draft)})` }));
  if (!balanceSize(draft)) box.append(el("p", { class: "note", text: "Nessuna prova in corso." }));
  else {
    box.append(el("ul", { class: "adList", id: "adDraftList" }, ...entries(draft).map(([k, o]) => el("li", { text: describeEntry(k, o) }))));
    if (B.canPublish()) {
      const title = el("input", { id: "adPubTitle", placeholder: "Titolo per la bacheca (facoltativo)", maxlength: "120" }) as HTMLInputElement;
      const go = el("button", {
        class: "mode",
        id: "adPublish",
        text: "Pubblica per tutti",
        onclick: async () => {
          go.disabled = true;
          try {
            await B.publish(title.value.trim());
            api.toast("Pubblicato: vale per tutti dal prossimo avvio del gioco");
          } catch (e) {
            api.toast((e as Error).message);
          }
          redraw();
        },
      }) as HTMLButtonElement;
      box.append(el("div", { class: "olRoom two" }, title, go));
    } else box.append(el("p", { class: "note", text: "Per pubblicarle per tutti entra con l'account admin nella sezione Online." }));
    box.append(armed("Annulla le prove", "Tocca di nuovo per annullare", () => {
      B.clearDraft();
      redraw();
    }));
  }
  box.append(el("h3", { text: `Pubblicato per tutti (${balanceSize(pub)})` }), el("p", { class: "note", text: B.publishedNote() }));
  if (balanceSize(pub)) {
    const ul = el("ul", { class: "adList adPub", id: "adPubList" });
    for (const [k, o] of entries(pub))
      ul.append(
        el(
          "li",
          {},
          el("span", { text: describeEntry(k, o) }),
          ...(B.canPublish()
            ? [
                el("button", {
                  text: "Togli",
                  title: "Riporta questo valore all'originale per tutti",
                  onclick: async () => {
                    try {
                      await B.unpublish(k, o);
                      api.toast("Valore riportato all'originale per tutti");
                    } catch (e) {
                      api.toast((e as Error).message);
                    }
                    redraw();
                  },
                }),
              ]
            : []),
        ),
      );
    box.append(ul);
    if (B.canPublish())
      box.append(armed("Riporta tutto all'originale per tutti", "Tocca di nuovo: vale per tutti", async () => {
        try {
          await B.resetPublished();
          api.toast("Bilanciamento originale ripristinato per tutti");
        } catch (e) {
          api.toast((e as Error).message);
        }
        redraw();
      }));
  }
  box.append(el("button", {
    text: "Ricarica dal server",
    onclick: async () => {
      try {
        await B.reload();
        api.toast("Bilanciamento aggiornato");
      } catch (e) {
        api.toast((e as Error).message);
      }
      redraw();
    },
  }));
  body.append(box);
}

/** Tasto che chiede un secondo tocco prima di agire. */
function armed(text: string, confirm: string, act: () => void): HTMLButtonElement {
  const b = el("button", { class: "danger", text }) as HTMLButtonElement;
  b.addEventListener("click", () => {
    if (b.dataset.armed) return act();
    b.dataset.armed = "1";
    b.textContent = confirm;
    setTimeout(() => {
      delete b.dataset.armed;
      b.textContent = text;
    }, 3000);
  });
  return b;
}

// ---------- premi ai giocatori ----------

function playersTab(body: HTMLElement, api: AdminApi) {
  const g = api.grants;
  body.append(el("p", { text: "Scrivi il nome utente di un giocatore: puoi dargli Schegge e Perle, sbloccargli torri o portarle a un rango. Il premio resta sul server e lo riceve la prossima volta che apre il gioco, su qualunque dispositivo." }));
  if (!g) {
    body.append(el("p", { class: "note", text: "Serve l'account admin: entra dalla sezione Online del menu." }));
    return;
  }
  const user = el("input", { id: "adGUser", placeholder: "Nome utente", maxlength: "20", autocapitalize: "none", spellcheck: "false" }) as HTMLInputElement;
  const out = el("div", { id: "adGOut" });
  const find = async () => {
    out.innerHTML = "";
    out.append(el("p", { class: "note", text: "Cerco…" }));
    try {
      const p = await g.peek(user.value);
      out.innerHTML = "";
      if (!p) return out.append(el("p", { class: "note", text: "Nessun giocatore con questo nome." }));
      grantForm(out, p, api, find);
    } catch (e) {
      out.innerHTML = "";
      out.append(el("p", { class: "note", text: (e as Error).message }));
    }
  };
  user.addEventListener("keydown", (ev) => (ev as KeyboardEvent).key === "Enter" && void find());
  body.append(el("div", { class: "olRoom two" }, user, el("button", { id: "adGFind", class: "mode", text: "Cerca", onclick: () => void find() })), out);
}

function grantForm(out: HTMLElement, p: PeekRow, api: AdminApi, refresh: () => Promise<void>) {
  const unlocked = new Set(Array.isArray(p.unlocked) ? p.unlocked : []);
  const ranks = (p.ranks && typeof p.ranks === "object" ? p.ranks : {}) as Record<string, number>;
  out.append(
    el("div", { class: "adPeek", id: "adPeek" },
      el("b", { text: p.username }),
      el("span", { text: `${Number(p.schegge).toLocaleString("it-IT")} Schegge · ${Number(p.perle).toLocaleString("it-IT")} Perle · ${unlocked.size} torri sbloccate` }),
      el("span", { text: p.pending ? `${p.pending} premi in attesa di essere riscossi` : "Nessun premio in attesa" }),
      ...(p.saved ? [] : [el("small", { text: "Non ha ancora un salvataggio online: i numeri si aggiornano dopo la sua prima partita con l'account." })]),
    ),
  );
  const schegge = el("input", { id: "adGSchegge", type: "number", min: "0", max: "1000000", value: "0" }) as HTMLInputElement;
  const perle = el("input", { id: "adGPerle", type: "number", min: "0", max: "100000", value: "0" }) as HTMLInputElement;
  const rows = el("div", { class: "adGTowers" });
  const pickable = TOWER_ORDER.filter((k) => !ADMIN_ONLY.includes(k));
  for (const k of pickable) {
    const has = unlocked.has(k);
    const cur = has ? Math.max(1, Math.min(MAX_RANK, ranks[k] ?? 1)) : 0;
    const unlock = el("input", { type: "checkbox", "data-unlock": k, checked: has, disabled: has }) as HTMLInputElement;
    const rank = el("select", { "data-rank": k }, el("option", { value: "", text: has ? `rango ${cur}` : "—" }), ...Array.from({ length: MAX_RANK }, (_, i) => i + 1).filter((r) => r !== cur).map((r) => el("option", { value: String(r), text: `→ rango ${r}` })));
    rows.append(el("label", { class: "adGRow" }, unlock, el("span", { text: TOWERS[k].name }), rank));
  }
  const note = el("input", { id: "adGNote", placeholder: "Messaggio per il giocatore (facoltativo)", maxlength: "120" }) as HTMLInputElement;
  const send = el("button", {
    class: "mode",
    id: "adGSend",
    text: "Invia il premio",
    onclick: async () => {
      const payload: GrantPayload = {};
      const sN = Math.floor(Number(schegge.value) || 0);
      const pN = Math.floor(Number(perle.value) || 0);
      if (sN < 0 || pN < 0 || sN > 1000000 || pN > 100000) return api.toast("Valuta fuori dai limiti (Schegge fino a 1.000.000, Perle fino a 100.000)");
      if (sN) payload.schegge = sN;
      if (pN) payload.perle = pN;
      const un = [...rows.querySelectorAll<HTMLInputElement>("input[data-unlock]:checked:not([disabled])")].map((i) => i.dataset.unlock!);
      if (un.length) payload.unlock = un;
      const rk: Record<string, number> = {};
      for (const s of rows.querySelectorAll<HTMLSelectElement>("select[data-rank]")) if (s.value) rk[s.dataset.rank!] = Number(s.value);
      if (Object.keys(rk).length) payload.ranks = rk;
      if (!Object.keys(payload).length) return api.toast("Il premio è vuoto");
      send.disabled = true;
      try {
        await api.grants!.grant(p.id, payload, note.value.trim());
        api.toast(`Premio inviato a ${p.username}`);
        await refresh();
      } catch (e) {
        api.toast((e as Error).message);
        send.disabled = false;
      }
    },
  }) as HTMLButtonElement;
  out.append(
    el("div", { class: "adForm" },
      el("label", { class: "adRow" }, el("span", { text: "Schegge da aggiungere" }), schegge),
      el("label", { class: "adRow" }, el("span", { text: "Perle da aggiungere" }), perle),
    ),
    el("h4", { text: "Torri: spunta per sbloccare, scegli un rango per portarla lì" }),
    el("p", { class: "note", text: "Il rango si imposta esattamente (anche più basso, per correggere un errore) e sblocca la torre se non l'ha. Le torri admin non si regalano." }),
    rows,
    note,
    send,
  );
}

// ---------- comandi in partita ----------

export function renderAdminDrawer(host: HTMLElement, api: AdminApi, remote = false) {
  host.innerHTML = "";
  const s = api.state();
  const btn = (text: string, onclick: () => void, extra: Record<string, unknown> = {}) => el("button", { text, onclick, ...extra });
  const enemy = el("select", { id: "adEnemy" }, ...(Object.keys(ENEMIES) as EnemyKind[]).map((k) => el("option", { value: k, text: ENEMIES[k].name })));
  const count = el("input", { id: "adCount", type: "number", value: "5", min: "1", max: "200" }) as HTMLInputElement;
  const lanes = levelById(s.levelId).map.lanes.length;
  const lane = el("select", { id: "adLane" }, el("option", { value: "-1", text: "Tutte le corsie" }), ...Array.from({ length: lanes }, (_, i) => el("option", { value: String(i), text: `Corsia ${i + 1}` })));
  const hp = el("select", { id: "adHp" }, ...[1, 2, 5, 10].map((m) => el("option", { value: String(m * 10000), text: `Vita x${m}` })));
  const boss = el("input", { type: "checkbox", id: "adBoss" }) as HTMLInputElement;
  const mods = el("div", { class: "adMods" });
  for (const m of MOD_ORDER) mods.append(el("label", { title: MODS[m].summary }, el("input", { type: "checkbox", value: m }), MODS[m].name));
  const wave = el("input", { id: "adWaveN", type: "number", value: String(Math.max(1, s.wave + 1)), min: "1" }) as HTMLInputElement;
  const names = api.players?.() ?? [];
  const to = el("select", { id: "adTo" }, ...names.map((n, i) => el("option", { value: String(i), text: `Cash a ${n}` }))) as HTMLSelectElement;
  const target = () => (names.length > 1 ? Number(to.value) : undefined);
  host.append(
    remote ? el("b", { text: "Comandi per questa stanza" }) : el("div", { class: "adHead" }, el("b", { text: "Comandi admin" }), btn("Chiudi", () => (host.hidden = true))),
    ...(names.length > 1 ? [el("label", { class: "adField" }, "Il cash va a un solo giocatore", to)] : []),
    el(
      "div",
      { class: "adGrid" },
      btn("+1.000 cash", () => api.send({ t: "adminCash", amount: 1000, to: target() })),
      btn("+10.000 cash", () => api.send({ t: "adminCash", amount: 10000, to: target() })),
      btn("Vite a 20", () => api.send({ t: "adminLives", lives: 20 })),
      ...(remote
        ? [btn("Vite infinite: sì", () => api.send({ t: "adminGod", on: true })), btn("Vite infinite: no", () => api.send({ t: "adminGod", on: false }))]
        : [
            btn(s.god ? "Vite infinite: sì" : "Vite infinite: no", () => {
              api.send({ t: "adminGod", on: !api.state().god });
              renderAdminDrawer(host, api);
            }),
          ]),
      btn("Pulisci nemici", () => api.send({ t: "adminClear" })),
      btn("Ricarica abilità", () => api.send({ t: "adminRecharge" })),
      ...(remote
        ? []
        : [
            btn(api.dps() ? "DPS: visibile" : "DPS: nascosto", () => {
              api.dps(!api.dps());
              renderAdminDrawer(host, api);
            }),
            btn("Velocità x4", () => api.setSpeed(4)),
          ]),
    ),
    el("div", { class: "adRowWave" }, el("span", { text: "Vai all'ondata" }), wave, btn("Vai", () => api.send({ t: "adminWave", wave: Number(wave.value) || 1 }))),
    el("h3", { text: "Genera nemici" }),
    el("div", { class: "adSpawn" }, enemy, count, lane, hp, el("label", {}, boss, "Boss")),
    mods,
    btn("Genera", () => {
      const chosen = [...mods.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value as Mod);
      api.send({ t: "adminSpawn", enemy: enemy.value as EnemyKind, count: Number(count.value) || 1, lane: Number(lane.value), mods: chosen, boss: boss.checked, hpMulBp: Number(hp.value) });
      api.toast(`Generati ${Number(count.value) || 1} ${ENEMIES[enemy.value as EnemyKind].plural}`);
    }, { class: "mode", id: "adSpawnGo" }),
  );
}

// ---------- stanze degli altri ----------

function onlineTab(body: HTMLElement, api: AdminApi) {
  const on = api.online!;
  const list = el("div", { class: "adRooms" });
  const controls = el("div", { class: "adRemote" });
  const load = async () => {
    list.innerHTML = "";
    list.append(el("p", { class: "note", text: "Carico le stanze…" }));
    try {
      const rooms = await on.rooms();
      list.innerHTML = "";
      if (!rooms.length) list.append(el("p", { class: "note", text: "Nessuna stanza attiva negli ultimi 15 minuti." }));
      for (const r of rooms) {
        const i = r.info as { players?: string[]; wave?: number; waves?: number; lives?: number; cash?: number };
        const what = r.mode === "natale" ? `Notte ${r.night}` : `${r.mode} · ${r.level}`;
        const line = `${r.code} · ${what} · ${r.status === "playing" ? `ondata ${i.wave ?? 0}/${i.waves ?? "?"}, ${i.lives ?? "?"} vite, ${i.cash ?? "?"} cash` : "in attesa"}`;
        list.append(
          el("button", {
            class: "adRoom",
            "data-room": r.code,
            text: `${line}\n${(i.players ?? []).join(", ")}`,
            onclick: () => {
              controls.innerHTML = "";
              const fake: AdminApi = {
                ...api,
                state: () => ({ levelId: r.level, wave: i.wave ?? 0, god: false }) as unknown as GameState,
                players: () => i.players ?? [],
                send: (cmd) => {
                  on.command(r.code, cmd).then(
                    () => api.toast(`Inviato alla stanza ${r.code}`),
                    (e) => api.toast((e as Error).message),
                  );
                },
              };
              renderAdminDrawer(controls, fake, true);
            },
          }),
        );
      }
    } catch (e) {
      list.innerHTML = "";
      list.append(el("p", { class: "note", text: `Non riesco a leggere le stanze: ${(e as Error).message}` }));
    }
  };
  body.append(
    el("p", { text: "Le partite in multigiocatore degli altri. Scegli una stanza: i comandi arrivano a chi ospita entro un paio di secondi e valgono per tutti i giocatori. Le partite toccate non danno premi." }),
    el("button", { id: "adRoomsReload", text: "Aggiorna l'elenco", onclick: () => void load() }),
    list,
    controls,
  );
  void load();
}
