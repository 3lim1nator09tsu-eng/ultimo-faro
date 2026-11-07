// Pannello admin locale: prova delle torri, comandi in partita, progressi e bilanciamento.
// Vive solo su questo dispositivo; la versione online passerà dal server con ruoli e registro.
import { NIGHTS, SURVIVAL } from "../sim-core/modes";
import { EVENT_LEVELS, levelById, Branch, ENEMIES, EnemyKind, GameMode, LEVELS, MOD_ORDER, MODS, Mod, TOWERS, TOWER_ORDER, TowerKind, TowerStats } from "../sim-core/content";
import { Command, GameState } from "../sim-core/sim";

export type LevelKey = "1" | "2" | "3" | Branch;

export interface Override {
  kind: TowerKind;
  lvl: LevelKey;
  field: keyof TowerStats | "cost";
  value: number;
}

export interface AdminApi {
  state(): GameState;
  send(cmd: Command): void;
  toast(text: string): void;
  startSandbox(level: string, mode: GameMode, night?: number, eventBp?: number): void;
  setSpeed(n: number): void;
  dps(on?: boolean): boolean;
  progress: Record<string, () => void>;
  overrides(): Override[];
  applyOverride(o: Override): void;
  resetOverrides(): void;
  /** Nomi dei giocatori della partita, nell'ordine della simulazione: il cash admin va a uno solo. */
  players?(): string[];
  /** Stanze online: presenti solo con l'account admin collegato. */
  online?: {
    rooms(): Promise<Array<{ code: string; status: string; mode: string; level: string; night: number; info: Record<string, unknown>; updated_at: string }>>;
    command(code: string, cmd: Command): Promise<void>;
  };
}

// Campi modificabili, con unità leggibili.
export const FIELDS: Array<{ field: Override["field"]; label: string; unit: "n" | "tile" | "tick" | "pct" | "slow" }> = [
  { field: "cost", label: "Costo", unit: "n" },
  { field: "damage", label: "Danno", unit: "n" },
  { field: "cooldown", label: "Ricarica (tick, 10 = 1 s)", unit: "tick" },
  { field: "range", label: "Gittata (caselle)", unit: "tile" },
  { field: "radius", label: "Area (caselle)", unit: "tile" },
  { field: "chains", label: "Salti del fulmine", unit: "n" },
  { field: "slowBp", label: "Rallentamento (%)", unit: "slow" },
  { field: "income", label: "Rendita", unit: "n" },
  { field: "auraBp", label: "Bonus disco (%)", unit: "pct" },
  { field: "hasteBp", label: "Cadenza in più (%)", unit: "pct" },
  { field: "pulse", label: "Cura ogni (tick)", unit: "tick" },
  { field: "immune", label: "Protezione (tick)", unit: "tick" },
  { field: "markBp", label: "Marchio (% danno subito)", unit: "pct" },
  { field: "stunChanceBp", label: "Probabilità stordimento (%)", unit: "pct" },
];

export function levelRef(kind: TowerKind, lvl: LevelKey): Record<string, number> {
  const def = TOWERS[kind];
  return (lvl === "A" || lvl === "B" ? def.branches[lvl] : def.levels[Number(lvl) - 1]) as unknown as Record<string, number>;
}

export function toShown(unit: string, v: number): number {
  if (unit === "tile") return v / 1000;
  if (unit === "pct") return Math.round(v / 100);
  if (unit === "slow") return Math.round((10000 - v) / 100);
  return v;
}

export function fromShown(unit: string, v: number): number {
  if (unit === "tile") return Math.round(v * 1000);
  if (unit === "pct") return Math.round(v * 100);
  if (unit === "slow") return 10000 - Math.round(v * 100);
  return Math.round(v);
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
  const tabs = ["Prova torri", "Progressi", "Bilanciamento", ...(api.online ? ["Stanze online"] : [])];
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
    body.innerHTML = "";
    if (i === 0) sandboxTab(body, api);
    else if (i === 1) progressTab(body, api);
    else if (i === 2) balanceTab(body, api);
    else onlineTab(body, api);
  };
  tabs.forEach((t, i) => bar.append(el("button", { role: "tab", text: t, onclick: () => show(i) })));
  host.append(head, el("p", { class: "note", text: "Solo su questo dispositivo. Le partite di prova non danno premi e non contano per classifiche e missioni." }), bar, body);
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
    el("p", { text: "Partita di prova con tutte le 12 torri, 100.000 cash e i comandi admin sempre a portata. Il tasto Admin sulla carta apre i comandi durante la partita." }),
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

function balanceTab(body: HTMLElement, api: AdminApi) {
  const kind = el("select", { id: "adTower" }, ...TOWER_ORDER.map((k) => el("option", { value: k, text: TOWERS[k].name })));
  const lvl = el("select", { id: "adLvl" });
  const form = el("div", { class: "adForm" });
  const refreshLevels = () => {
    const def = TOWERS[kind.value as TowerKind];
    lvl.innerHTML = "";
    lvl.append(el("option", { value: "1", text: "Livello 1" }), el("option", { value: "2", text: "Livello 2" }), el("option", { value: "3", text: "Livello 3" }), el("option", { value: "A", text: `4A ${def.branches.A.name}` }), el("option", { value: "B", text: `4B ${def.branches.B.name}` }));
  };
  const refreshForm = () => {
    form.innerHTML = "";
    const k = kind.value as TowerKind;
    const L = lvl.value as LevelKey;
    const ref = levelRef(k, L);
    for (const f of FIELDS) {
      const value = ref[f.field as string];
      const relevant = f.field === "cost" || (f.field === "slowBp" ? value < 10000 : f.field === "markBp" ? value > 10000 : value > 0);
      if (!relevant) continue;
      const input = el("input", { type: "number", step: f.unit === "tile" ? "0.1" : "1", value: String(toShown(f.unit, value)), "data-field": f.field as string }) as HTMLInputElement;
      const apply = el("button", {
        text: "Applica",
        onclick: () => {
          const n = Number(input.value);
          if (!Number.isFinite(n) || n < 0) {
            api.toast("Inserisci un numero valido");
            return;
          }
          api.applyOverride({ kind: k, lvl: L, field: f.field, value: fromShown(f.unit, n) });
          refreshForm();
        },
      });
      form.append(el("label", { class: "adRow" }, el("span", { text: f.label }), input, apply));
    }
  };
  kind.addEventListener("change", () => {
    refreshLevels();
    refreshForm();
  });
  lvl.addEventListener("change", refreshForm);
  refreshLevels();
  refreshForm();
  const list = el("ul", { class: "adList" });
  for (const o of api.overrides()) list.append(el("li", { text: `${TOWERS[o.kind].name} ${o.lvl}: ${String(o.field)} = ${o.value}` }));
  body.append(
    el("p", { text: "Ogni modifica vale subito, resta salvata su questo dispositivo e compare nella bacheca Novità." }),
    el("label", { class: "adField" }, "Torre", kind),
    el("label", { class: "adField" }, "Livello", lvl),
    form,
    el("h3", { text: "Modifiche attive" }),
    api.overrides().length ? list : el("p", { class: "note", text: "Nessuna modifica." }),
    el("button", { class: "danger", text: "Ripristina i valori originali", onclick: () => api.resetOverrides() }),
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
