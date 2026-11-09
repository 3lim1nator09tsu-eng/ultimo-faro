// Collegamento con Supabase senza librerie: account, salvataggio, classifiche, stanze e canali in tempo reale.
// Se il server non è raggiungibile il gioco continua a funzionare da solo.

export const SUPA = {
  url: "https://jhbzszfglgetrcipaene.supabase.co",
  key: "sb_publishable_IxMgnvfzb_jpLI25sdgOwQ_eNzuRQ_r",
};
const DOMAIN = "giocatori.ultimofaro.invalid";
const SESSION_KEY = "faro.session.v1";

export interface Session {
  access: string;
  refresh: string;
  expires: number; // secondi Unix
  userId: string;
  username: string;
  isAdmin: boolean;
}

export interface SaveRow {
  meta: unknown;
  rev: number;
  updated_at: string;
}

export interface RoomRow {
  code: string;
  host: string;
  status: "lobby" | "playing" | "ended";
  mode: string;
  level: string;
  night: number;
  info: Record<string, unknown>;
  updated_at: string;
}

export interface LeaderRow {
  username: string;
  earned: number;
  wins: number;
  perle_earned: number;
}

const storage = {
  get(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  set(s: Session | null) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* senza memoria locale si resta collegati solo finché la pagina è aperta */
    }
  },
};

export class NetError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

const usernameOk = (u: string) => /^[a-z0-9_]{3,20}$/.test(u);
export const cleanUsername = (u: string) => u.trim().toLowerCase();

export class Net {
  session: Session | null = storage.get();
  /** Il ruolo admin è stato confermato dal server durante questa apertura del gioco. */
  verified = false;
  private refreshing: Promise<void> | null = null;

  get online(): boolean {
    return !!this.session;
  }

  private async raw(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("apikey", SUPA.key);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (init.auth !== false && this.session) {
      await this.ensureFresh();
      headers.set("Authorization", `Bearer ${this.session!.access}`);
    }
    let res: Response;
    try {
      res = await fetch(SUPA.url + path, { ...init, headers });
    } catch {
      throw new NetError("Server non raggiungibile", 0);
    }
    return res;
  }

  private async json<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
    const res = await this.raw(path, init);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const d = data as Record<string, string> | null;
      const msg = d?.error_description || d?.error || d?.msg || d?.message || `Errore ${res.status}`;
      throw new NetError(translate(String(msg)), res.status);
    }
    return data as T;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.raw("/auth/v1/health", { auth: false });
      return res.ok;
    } catch {
      return false;
    }
  }

  async register(username: string, password: string, invite: string): Promise<void> {
    const u = cleanUsername(username);
    if (!usernameOk(u)) throw new NetError("Il nome utente va da 3 a 20 caratteri: lettere minuscole, numeri e _");
    await this.json("/functions/v1/register", { method: "POST", auth: false, body: JSON.stringify({ username: u, password, invite }) });
    await this.login(u, password);
  }

  async login(username: string, password: string): Promise<Session> {
    const u = cleanUsername(username);
    if (!usernameOk(u)) throw new NetError("Nome utente non valido");
    const t = await this.json<{ access_token: string; refresh_token: string; expires_at?: number; expires_in: number; user: { id: string } }>(
      "/auth/v1/token?grant_type=password",
      { method: "POST", auth: false, body: JSON.stringify({ email: `${u}@${DOMAIN}`, password }) },
    );
    this.session = { access: t.access_token, refresh: t.refresh_token, expires: t.expires_at ?? Math.floor(Date.now() / 1000) + t.expires_in, userId: t.user.id, username: u, isAdmin: false };
    const prof = await this.json<Array<{ username: string; is_admin: boolean }>>(`/rest/v1/profiles?select=username,is_admin&id=eq.${t.user.id}`);
    if (prof[0]) {
      this.session.username = prof[0].username;
      this.session.isAdmin = !!prof[0].is_admin;
    }
    this.verified = !!prof[0];
    storage.set(this.session);
    return this.session;
  }

  /** Rilegge nome e ruolo dal server: il ruolo salvato sul dispositivo non vale da solo. */
  async refreshProfile(): Promise<void> {
    if (!this.session) return;
    const id = this.session.userId;
    const prof = await this.json<Array<{ username: string; is_admin: boolean }>>(`/rest/v1/profiles?select=username,is_admin&id=eq.${id}`);
    if (!this.session || this.session.userId !== id) return;
    this.session.isAdmin = !!prof[0]?.is_admin;
    if (prof[0]) this.session.username = prof[0].username;
    this.verified = !!prof[0];
    storage.set(this.session);
  }

  logout() {
    const s = this.session;
    this.verified = false;
    this.session = null;
    storage.set(null);
    if (s) fetch(SUPA.url + "/auth/v1/logout", { method: "POST", headers: { apikey: SUPA.key, Authorization: `Bearer ${s.access}` } }).catch(() => {});
  }

  async changePassword(password: string): Promise<void> {
    if (password.length < 6 || password.length > 72) throw new NetError("La password va da 6 a 72 caratteri");
    await this.json("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password }) });
  }

  private async ensureFresh(): Promise<void> {
    if (!this.session) return;
    if (this.session.expires - 60 > Date.now() / 1000) return;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const s = this.session!;
        try {
          const res = await fetch(SUPA.url + "/auth/v1/token?grant_type=refresh_token", {
            method: "POST",
            headers: { apikey: SUPA.key, "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: s.refresh }),
          });
          if (res.status === 400 || res.status === 401) {
            // Sessione scaduta o revocata: serve un nuovo accesso.
            this.session = null;
            this.verified = false;
            storage.set(null);
            return;
          }
          if (!res.ok) return;
          const t = (await res.json()) as { access_token: string; refresh_token: string; expires_at?: number; expires_in: number };
          s.access = t.access_token;
          s.refresh = t.refresh_token;
          s.expires = t.expires_at ?? Math.floor(Date.now() / 1000) + t.expires_in;
          storage.set(s);
        } catch {
          /* offline: si riprova alla prossima richiesta */
        } finally {
          this.refreshing = null;
        }
      })();
    }
    await this.refreshing;
  }

  /** Token valido per il canale in tempo reale. */
  async token(): Promise<string> {
    await this.ensureFresh();
    if (!this.session) throw new NetError("Serve l'accesso");
    return this.session.access;
  }

  // ---------- salvataggio ----------

  async loadSave(): Promise<SaveRow | null> {
    const rows = await this.json<SaveRow[]>(`/rest/v1/saves?select=meta,rev,updated_at&user_id=eq.${this.session!.userId}`);
    return rows[0] ?? null;
  }

  async pushSave(meta: unknown, rev: number, earned: number, wins: number, perle: number): Promise<void> {
    await this.json("/rest/v1/saves?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: this.session!.userId, meta, rev, earned, wins, perle_earned: perle, updated_at: new Date().toISOString() }),
    });
  }

  /** Quali di questi account sono admin (i profili sono leggibili da chi ha un account). */
  async adminIds(ids: string[]): Promise<string[]> {
    const safe = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (!safe.length) return [];
    const rows = await this.json<Array<{ id: string; is_admin: boolean }>>(`/rest/v1/profiles?select=id,is_admin&id=in.(${safe.join(",")})`);
    return rows.filter((r) => r.is_admin).map((r) => r.id);
  }

  async leaderboard(lim = 20): Promise<LeaderRow[]> {
    return this.json<LeaderRow[]>("/rest/v1/rpc/leaderboard", { method: "POST", body: JSON.stringify({ lim }) });
  }

  // ---------- stanze ----------

  async createRoom(code: string, mode: string, level: string, night: number): Promise<void> {
    await this.json("/rest/v1/rooms", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ code, mode, level, night, host: this.session!.userId }) });
  }

  async updateRoom(code: string, patch: Partial<RoomRow>): Promise<void> {
    await this.json(`/rest/v1/rooms?code=eq.${code}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
  }

  async deleteRoom(code: string): Promise<void> {
    await this.json(`/rest/v1/rooms?code=eq.${code}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }

  async room(code: string): Promise<RoomRow | null> {
    const rows = await this.json<RoomRow[]>(`/rest/v1/rooms?select=*&code=eq.${encodeURIComponent(code)}`);
    return rows[0] ?? null;
  }

  async activeRooms(): Promise<RoomRow[]> {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    return this.json<RoomRow[]>(`/rest/v1/rooms?select=*&status=neq.ended&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.desc`);
  }

  /** Manda un comando admin a una stanza; restituisce il numero del comando, per sapere quando chi ospita l'ha applicato. */
  async adminCommand(room: string, cmd: unknown): Promise<number> {
    const rows = await this.json<Array<{ id: number }>>("/rest/v1/admin_commands?select=id", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ room, cmd }) });
    return rows[0]?.id ?? 0;
  }

  async commandsAfter(room: string, afterId: number): Promise<Array<{ id: number; cmd: unknown }>> {
    return this.json(`/rest/v1/admin_commands?select=id,cmd&room=eq.${room}&id=gt.${afterId}&order=id.asc`);
  }

  async lastCommandId(room: string): Promise<number> {
    const rows = await this.json<Array<{ id: number }>>(`/rest/v1/admin_commands?select=id&room=eq.${room}&order=id.desc&limit=1`);
    return rows[0]?.id ?? 0;
  }

  // ---------- bilanciamento globale ----------

  /** Leggibile anche senza account: vale per tutti i giocatori. */
  async fetchBalance(): Promise<BalanceRow | null> {
    const rows = await this.json<BalanceRow[]>("/rest/v1/balance?select=data,rev,updated_at&id=eq.1", { auth: !!this.session });
    return rows[0] ?? null;
  }

  /** Salva solo se nessun altro admin ha salvato nel frattempo (rev uguale). */
  async saveBalance(data: unknown, rev: number): Promise<number> {
    const rows = await this.json<Array<{ rev: number }>>(`/rest/v1/balance?id=eq.1&rev=eq.${rev}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ data, rev: rev + 1, updated_at: new Date().toISOString(), updated_by: this.session!.userId }),
    });
    if (!rows.length) throw new NetError("Il bilanciamento è stato cambiato da un altro admin: ricarico e riprova", 409);
    return rows[0].rev;
  }

  async logBalance(title: string, items: string[]): Promise<void> {
    await this.json("/rest/v1/balance_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ title: title.slice(0, 200), items }) });
  }

  async fetchBalanceLog(lim = 10): Promise<BalanceLogRow[]> {
    return this.json<BalanceLogRow[]>(`/rest/v1/balance_log?select=id,title,items,created_at&order=id.desc&limit=${lim}`, { auth: !!this.session });
  }

  // ---------- premi ai giocatori ----------

  async adminPeek(username: string): Promise<PeekRow | null> {
    return this.json<PeekRow | null>("/rest/v1/rpc/admin_peek", { method: "POST", body: JSON.stringify({ uname: cleanUsername(username) }) });
  }

  async adminGrant(userId: string, payload: GrantPayload, note: string): Promise<void> {
    await this.json("/rest/v1/grants", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: userId, payload, note: note.slice(0, 200) || null }) });
  }

  async myGrants(): Promise<GrantRow[]> {
    return this.json<GrantRow[]>(`/rest/v1/grants?select=id,payload,note&user_id=eq.${this.session!.userId}&claimed_at=is.null&order=id.asc`);
  }

  /** Segna il premio come riscosso; true solo se era ancora in attesa (niente doppie riscossioni tra dispositivi). */
  async claimGrant(id: number): Promise<boolean> {
    const rows = await this.json<Array<{ id: number }>>(`/rest/v1/grants?id=eq.${id}&claimed_at=is.null&select=id`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ claimed_at: new Date().toISOString() }),
    });
    return rows.length > 0;
  }
}

export interface BalanceRow {
  data: unknown;
  rev: number;
  updated_at: string;
}
export interface BalanceLogRow {
  id: number;
  title: string;
  items: string[];
  created_at: string;
}
export interface PeekRow {
  id: string;
  username: string;
  schegge: number;
  perle: number;
  unlocked: string[];
  ranks: Record<string, number>;
  saved: boolean;
  pending: number;
}
/** Un premio: valuta da aggiungere, torri da sbloccare, ranghi minimi da garantire. */
export interface GrantPayload {
  schegge?: number;
  perle?: number;
  unlock?: string[];
  ranks?: Record<string, number>;
}
export interface GrantRow {
  id: number;
  payload: GrantPayload;
  note: string | null;
}

function translate(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "Nome utente o password sbagliati";
  if (/password should be|weak password/i.test(msg)) return "Password troppo debole";
  if (/row-level security/i.test(msg)) return "Permesso negato";
  if (/duplicate key/i.test(msg)) return "Esiste già";
  if (/jwt expired/i.test(msg)) return "Accesso scaduto: entra di nuovo";
  return msg;
}

// ---------- canale in tempo reale ----------

export interface Transport {
  send(event: string, payload: unknown): void;
  on(event: string, fn: (payload: any) => void): void;
  onStatus(fn: (status: "open" | "closed" | "error", detail?: string) => void): void;
  close(): void;
}

/** Canale privato Supabase Realtime "room:CODICE", protocollo Phoenix 1.0.0. */
export class RealtimeTransport implements Transport {
  private ws: WebSocket | null = null;
  private ref = 0;
  private joinRef = "";
  private handlers = new Map<string, Array<(p: any) => void>>();
  private statusFns: Array<(s: "open" | "closed" | "error", d?: string) => void> = [];
  private beat = 0;
  private queue: string[] = [];
  private joined = false;
  private closed = false;
  private retries = 0;
  private topic: string;

  constructor(
    private net: Net,
    code: string,
  ) {
    this.topic = `realtime:room:${code}`;
    void this.connect();
  }

  private async connect() {
    if (this.closed) return;
    let token = "";
    try {
      token = await this.net.token();
    } catch (e) {
      this.emitStatus("error", (e as Error).message);
      return;
    }
    const url = `${SUPA.url.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPA.key)}&vsn=1.0.0`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.joinRef = String(++this.ref);
      ws.send(
        JSON.stringify({
          topic: this.topic,
          event: "phx_join",
          payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, private: true }, access_token: token },
          ref: this.joinRef,
          join_ref: this.joinRef,
        }),
      );
      clearInterval(this.beat);
      this.beat = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++this.ref) }));
        // Rinnovo del token prima che scada.
        this.net.token().then((t) => {
          if (t !== token && ws.readyState === WebSocket.OPEN) {
            token = t;
            ws.send(JSON.stringify({ topic: this.topic, event: "access_token", payload: { access_token: t }, ref: String(++this.ref), join_ref: this.joinRef }));
          }
        }, () => {});
      }, 25000);
    };
    ws.onmessage = (ev) => {
      let m: { topic: string; event: string; payload: any; ref?: string };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.event === "phx_reply" && m.ref === this.joinRef) {
        if (m.payload?.status === "ok") {
          this.joined = true;
          this.retries = 0;
          for (const q of this.queue.splice(0)) ws.send(q);
          this.emitStatus("open");
        } else {
          // Ingresso rifiutato (per esempio il canale si sta ancora preparando): si chiude e si riprova.
          this.emitStatus("error", m.payload?.response?.reason ?? "Accesso al canale negato");
          ws.close();
        }
        return;
      }
      if ((m.event === "phx_error" || m.event === "phx_close") && m.topic === this.topic) {
        ws.close();
        return;
      }
      if (m.event === "system" && m.payload?.status === "error") {
        this.emitStatus("error", m.payload?.message ?? "Errore del canale");
        ws.close();
        return;
      }
      if (m.event === "broadcast" && m.payload?.event) {
        for (const fn of this.handlers.get(m.payload.event) ?? []) fn(m.payload.payload);
      }
    };
    ws.onclose = () => {
      this.joined = false;
      clearInterval(this.beat);
      if (this.closed) return;
      this.emitStatus("closed");
      // Riconnessione con attesa crescente.
      const wait = Math.min(10000, 500 * 2 ** this.retries++);
      setTimeout(() => void this.connect(), wait);
    };
    ws.onerror = () => {
      /* onclose segue sempre */
    };
  }

  private emitStatus(s: "open" | "closed" | "error", d?: string) {
    for (const fn of this.statusFns) fn(s, d);
  }

  send(event: string, payload: unknown) {
    const msg = JSON.stringify({ topic: this.topic, event: "broadcast", payload: { type: "broadcast", event, payload }, ref: String(++this.ref), join_ref: this.joinRef });
    if (this.ws && this.joined && this.ws.readyState === WebSocket.OPEN) this.ws.send(msg);
    else if (this.queue.length < 200) this.queue.push(msg);
  }

  on(event: string, fn: (p: any) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
  }

  onStatus(fn: (s: "open" | "closed" | "error", d?: string) => void) {
    this.statusFns.push(fn);
  }

  close() {
    this.closed = true;
    clearInterval(this.beat);
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ topic: this.topic, event: "phx_leave", payload: {}, ref: String(++this.ref), join_ref: this.joinRef }));
      this.ws?.close();
    } catch {
      /* già chiuso */
    }
  }
}

/** Canale tra schede dello stesso browser: serve ai test e a provare il multigiocatore senza server. */
export class LocalTransport implements Transport {
  private bc: BroadcastChannel;
  private handlers = new Map<string, Array<(p: any) => void>>();
  private statusFns: Array<(s: "open" | "closed" | "error", d?: string) => void> = [];
  constructor(code: string) {
    this.bc = new BroadcastChannel(`faro-room-${code}`);
    this.bc.onmessage = (ev) => {
      const { event, payload } = ev.data as { event: string; payload: unknown };
      for (const fn of this.handlers.get(event) ?? []) fn(payload);
    };
    setTimeout(() => this.statusFns.forEach((f) => f("open")), 0);
  }
  send(event: string, payload: unknown) {
    this.bc.postMessage({ event, payload: JSON.parse(JSON.stringify(payload)) });
  }
  on(event: string, fn: (p: any) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
  }
  onStatus(fn: (s: "open" | "closed" | "error", d?: string) => void) {
    this.statusFns.push(fn);
  }
  close() {
    this.bc.close();
  }
}

/** Codice stanza leggibile: niente 0/O e 1/I. */
export function roomCode(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const r = new Uint32Array(5);
  crypto.getRandomValues(r);
  for (const v of r) s += abc[v % abc.length];
  return s;
}
