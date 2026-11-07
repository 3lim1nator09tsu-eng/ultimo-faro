// Server finto al posto di Supabase, per i collaudi: stessi percorsi, filtri e permessi delle tabelle vere.
export const ADMIN = "00000000-0000-4000-8000-00000000000a";
export const LUCA = "00000000-0000-4000-8000-00000000000b";
export const SUPA_GLOB = "https://jhbzszfglgetrcipaene.supabase.co/**";

export function fakeSupabase() {
const users = { admin: { id: ADMIN, pw: "segreta1", admin: true }, luca: { id: LUCA, pw: "lucaluca", admin: false }, nuovo: { id: "00000000-0000-4000-8000-00000000000c", pw: "nuovonuovo", admin: false } };
  const db = { balance: { data: {}, rev: 0, updated_at: "2026-11-07T10:00:00Z" }, log: [], grants: [], saves: {}, nextId: 1 };
  const who = (req) => {
    const a = req.headers()["authorization"] || "";
    const id = a.replace("Bearer tok-", "");
    return Object.values(users).find((u) => u.id === id) ?? null;
  };
  const q = (url, k) => new URL(url).searchParams.get(k);
  async function handle(route) {
    const req = route.request();
    const url = req.url();
    const path = new URL(url).pathname;
    const m = req.method();
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*", "Content-Type": "application/json" };
    const send = (status, data) => route.fulfill({ status, headers: cors, body: data === undefined ? "" : JSON.stringify(data) });
    if (m === "OPTIONS") return send(204);
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const u = who(req);
    if (path === "/auth/v1/health") return send(200, {});
    if (path === "/auth/v1/token") {
      const name = body.email.split("@")[0];
      const usr = users[name];
      if (!usr || usr.pw !== body.password) return send(400, { error_description: "Invalid login credentials" });
      return send(200, { access_token: `tok-${usr.id}`, refresh_token: "r", expires_in: 3600, user: { id: usr.id } });
    }
    if (path === "/rest/v1/profiles") {
      const id = q(url, "id")?.replace("eq.", "");
      const usr = Object.entries(users).find(([, x]) => x.id === id);
      return send(200, usr ? [{ username: usr[0], is_admin: usr[1].admin }] : []);
    }
    if (path === "/rest/v1/saves") {
      if (m === "GET") return send(200, db.saves[u?.id] ? [db.saves[u.id]] : []);
      db.saves[u.id] = { meta: body.meta, rev: body.rev, updated_at: body.updated_at };
      return send(201);
    }
    if (path === "/rest/v1/balance") {
      if (m === "GET") return send(200, [db.balance]);
      if (!u?.admin) return send(200, []);
      if (q(url, "rev") !== `eq.${db.balance.rev}`) return send(200, []);
      db.balance = { data: body.data, rev: body.rev, updated_at: body.updated_at };
      return send(200, [{ rev: db.balance.rev }]);
    }
    if (path === "/rest/v1/balance_log") {
      if (m === "GET") return send(200, [...db.log].reverse());
      if (!u?.admin) return send(403, { message: "new row violates row-level security policy" });
      db.log.push({ id: db.nextId++, title: body.title, items: body.items, created_at: "2026-11-07T12:00:00Z" });
      return send(201);
    }
    if (path === "/rest/v1/rpc/admin_peek") {
      if (!u?.admin) return send(400, { message: "Solo per gli admin" });
      const usr = users[body.uname];
      if (!usr) return send(200, null);
      const meta = db.saves[usr.id]?.meta;
      return send(200, { id: usr.id, username: body.uname, schegge: meta?.schegge ?? 0, perle: meta?.perle ?? 0, unlocked: meta?.unlocked ?? [], ranks: meta?.ranks ?? {}, saved: !!meta, pending: db.grants.filter((g) => g.user_id === usr.id && !g.claimed_at).length });
    }
    if (path === "/rest/v1/grants") {
      if (m === "POST") {
        if (!u?.admin) return send(403, { message: "new row violates row-level security policy" });
        db.grants.push({ id: db.nextId++, user_id: body.user_id, payload: body.payload, note: body.note, claimed_at: null });
        return send(201);
      }
      if (m === "GET") return send(200, db.grants.filter((g) => g.user_id === u?.id && !g.claimed_at).map(({ id, payload, note }) => ({ id, payload, note })));
      if (m === "PATCH") {
        const id = Number(q(url, "id").replace("eq.", ""));
        const g = db.grants.find((x) => x.id === id && x.user_id === u?.id && !x.claimed_at);
        if (!g) return send(200, []);
        g.claimed_at = body.claimed_at;
        return send(200, [{ id }]);
      }
    }
    return send(200, []);
  }
  
  return { db, users, handle };
}

/** Accesso dalla sezione Online del menu. */
export async function login(page, name, pw) {
  await page.fill("#olUser", name);
  await page.fill("#olPass", pw);
  await page.click("#olLogin");
  await page.waitForSelector("#olLogout", { timeout: 5000 });
  await page.waitForTimeout(400);
}
