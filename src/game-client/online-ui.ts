// Interfaccia online: accesso, salvataggio, classifica, stanze e sala d'attesa.
import { GameMode } from "../sim-core/content";
import { NIGHTS, SURVIVAL } from "../sim-core/modes";
import { LeaderRow, Net } from "./net";
import { NetMatch } from "./netplay";

type Attrs = Record<string, string | ((ev: Event) => void) | boolean | undefined>;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") e.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "text") e.textContent = String(v);
    else if (k === "class") e.className = String(v);
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, String(v));
  }
  for (const k of kids) e.append(k);
  return e;
}

export interface OnlineApi {
  net: Net;
  reachable: boolean | null;
  cloudNote: string;
  toast(t: string): void;
  rerender(): void;
  afterLogin(): Promise<void>;
  createRoom(mode: GameMode, level: string, night: number): Promise<void>;
  joinRoom(code: string, local: boolean): Promise<void>;
  leaderboard: LeaderRow[] | null;
  loadLeaderboard(): Promise<void>;
  mapPick: string;
}

export const MATCH_MODES: Array<[string, string]> = [
  ...SURVIVAL.map((m): [string, string] => [m.id, m.name]),
  ["hardcore", "Hardcore"],
  ...NIGHTS.map((n): [string, string] => [`natale:${n.night}`, `Notte ${n.night}`]),
  ["campagna", "Campagna"],
];

export function renderOnline(host: HTMLElement, api: OnlineApi) {
  host.innerHTML = "";
  const s = api.net.session;
  const status = el("p", {
    class: "note onlineStatus",
    text: api.reachable === false ? "Server non raggiungibile da questa pagina: si gioca da soli, i progressi restano qui." : api.reachable ? "Server raggiungibile." : "Controllo il server…",
  });
  if (!s) {
    const user = el("input", { id: "olUser", autocomplete: "username", placeholder: "Nome utente", maxlength: "20", autocapitalize: "none", spellcheck: "false" });
    const pass = el("input", { id: "olPass", type: "password", autocomplete: "current-password", placeholder: "Password", maxlength: "72" });
    const invite = el("input", { id: "olInvite", placeholder: "Codice d'invito (solo per registrarsi)", maxlength: "12", autocapitalize: "characters" });
    const busy = (b: HTMLButtonElement, on: boolean) => {
      b.disabled = on;
    };
    const login = el("button", {
      class: "mode",
      id: "olLogin",
      text: "Entra",
      onclick: async (ev) => {
        const b = ev.currentTarget as HTMLButtonElement;
        busy(b, true);
        try {
          await api.net.login(user.value, pass.value);
          await api.afterLogin();
          api.toast(`Ciao ${api.net.session?.username}`);
        } catch (e) {
          api.toast((e as Error).message);
        }
        busy(b, false);
        api.rerender();
      },
    });
    const reg = el("button", {
      id: "olRegister",
      text: "Registrati",
      onclick: async (ev) => {
        const b = ev.currentTarget as HTMLButtonElement;
        busy(b, true);
        try {
          await api.net.register(user.value, pass.value, invite.value);
          await api.afterLogin();
          api.toast(`Account creato: ciao ${api.net.session?.username}`);
        } catch (e) {
          api.toast((e as Error).message);
        }
        busy(b, false);
        api.rerender();
      },
    });
    host.append(
      el("p", { class: "note", text: "Con un account i progressi passano da un dispositivo all'altro, compari in classifica e giochi in stanza con gli amici." }),
      el("div", { class: "olForm" }, user, pass, invite, el("div", { class: "olBtns" }, login, reg)),
      status,
      localRoomRow(api),
    );
    return;
  }
  const out = el("button", {
    id: "olLogout",
    text: "Esci",
    onclick: () => {
      api.net.logout();
      api.toast("Disconnesso: i progressi restano su questo dispositivo");
      api.rerender();
    },
  });
  const pw = el("input", { id: "olNewPass", type: "password", placeholder: "Nuova password", autocomplete: "new-password" });
  const change = el("button", {
    text: "Cambia password",
    onclick: async () => {
      try {
        await api.net.changePassword(pw.value);
        pw.value = "";
        api.toast("Password cambiata");
      } catch (e) {
        api.toast((e as Error).message);
      }
    },
  });
  host.append(
    el("div", { class: "olWho" }, el("b", { text: `Connesso come ${s.username}${s.isAdmin ? " · admin" : ""}` }), out),
    el("p", { class: "note", id: "olCloud", text: api.cloudNote || "Il salvataggio online si aggiorna da solo dopo ogni partita." }),
    status,
  );
  // Stanze.
  const modeSel = el("select", { id: "olMode" }, ...MATCH_MODES.map(([v, t]) => el("option", { value: v, text: t })));
  const mapSel = el("select", { id: "olMap" }, ...["porto", "foce", "marea"].map((v) => el("option", { value: v, text: v === "porto" ? "Il Porto" : v === "foce" ? "La Doppia Foce" : "La Bassa Marea", selected: v === api.mapPick })));
  const sync = () => (mapSel.disabled = modeSel.value.startsWith("natale"));
  modeSel.addEventListener("change", sync);
  sync();
  const code = el("input", { id: "olCode", placeholder: "Codice stanza", maxlength: "5", autocapitalize: "characters" });
  host.append(
    el("h3", { text: "Multigiocatore" }),
    el("div", { class: "olRoom" }, modeSel, mapSel, el("button", {
      class: "mode",
      id: "olCreate",
      text: "Crea stanza",
      onclick: () => {
        const [m, n] = modeSel.value.split(":");
        void api.createRoom(m as GameMode, mapSel.value, n ? Number(n) : 0);
      },
    })),
    el("div", { class: "olRoom two" }, code, el("button", { id: "olJoin", text: "Entra", onclick: () => void api.joinRoom(code.value.trim().toUpperCase(), false) })),
    el("p", { class: "note", text: "Fino a 4 giocatori. Cash e vite sono in comune, ognuno porta la sua squadra: in partita ci sono tutte le torri delle squadre, al rango più alto." }),
  );
  // Classifica.
  const board = el("div", { id: "olBoard" });
  if (api.leaderboard) {
    const t = el("table", { class: "board" }, el("tr", {}, el("th", { text: "#" }), el("th", { text: "Giocatore" }), el("th", { text: "Schegge" }), el("th", { text: "Vittorie" })));
    api.leaderboard.forEach((r, i) => t.append(el("tr", { class: r.username === s.username ? "me" : "" }, el("td", { text: String(i + 1) }), el("td", { text: r.username }), el("td", { text: r.earned.toLocaleString("it-IT") }), el("td", { text: String(r.wins) }))));
    board.append(t);
  }
  host.append(
    el("h3", { text: "Classifica" }),
    el("button", { id: "olBoardBtn", text: api.leaderboard ? "Aggiorna la classifica" : "Mostra la classifica", onclick: () => void api.loadLeaderboard() }),
    board,
    el("div", { class: "olPass" }, pw, change),
  );
}

// Stanza tra schede dello stesso browser: utile per provare il multigiocatore anche senza server.
function localRoomRow(api: OnlineApi): HTMLElement {
  const code = el("input", { id: "olLocalCode", placeholder: "Codice prova", maxlength: "5", autocapitalize: "characters" });
  return el(
    "details",
    { class: "olLocal" },
    el("summary", { text: "Prova il multigiocatore in due schede (senza server)" }),
    el("div", { class: "olRoom two" }, code, el("button", { id: "olLocalJoin", text: "Entra", onclick: () => void api.joinRoom(code.value.trim().toUpperCase() || "PROVA", true) })),
  );
}

export interface LobbyApi {
  start(): void;
  leave(): void;
}

export function renderLobby(host: HTMLElement, m: NetMatch, api: LobbyApi) {
  host.innerHTML = "";
  const modeName = MATCH_MODES.find(([v]) => v === (m.setup.mode === "natale" ? `natale:${m.setup.night}` : m.setup.mode))?.[1] ?? m.setup.mode;
  const list = el("ul", { class: "players" }, ...[...m.players.values()].map((p) => el("li", { text: `${p.name}${p.host ? " · ospita" : ""}${p.id === m.me.id ? " (tu)" : ""}` })));
  host.append(
    el("h2", { text: "Stanza" }),
    el("div", { class: "roomCode", id: "lobbyCode", text: m.code }),
    el("p", { class: "note", text: `${modeName}${m.setup.mode === "natale" ? "" : ` · ${m.setup.level}`}. Dai il codice agli amici: lo scrivono in "Entra".` }),
    list,
    m.isHost
      ? el("button", { class: "mode", id: "lobbyStart", text: m.status === "playing" ? "Partita in corso" : "Avvia la partita", disabled: m.status === "playing", onclick: () => api.start() })
      : el("p", { class: "note", text: m.status === "playing" ? "Partita in corso: ti unisci tra un attimo." : "In attesa che chi ospita avvii la partita." }),
    el("button", { id: "lobbyLeave", text: "Esci dalla stanza", onclick: () => api.leave() }),
  );
}
