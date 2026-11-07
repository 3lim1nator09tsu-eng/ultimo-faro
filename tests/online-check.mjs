// Collaudo di bilanciamento pubblicato e premi ai giocatori, con un server finto al posto di Supabase.
// Controlla le richieste che il gioco fa davvero (percorsi, metodi, filtri) e il loro effetto.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const body = readFileSync("dist/ultimo-faro.html", "utf8");
const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>${body}</body></html>`;
let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}`);
  if (!c) fails++;
};

// ---------- server finto ----------
const ADMIN = "00000000-0000-4000-8000-00000000000a";
const LUCA = "00000000-0000-4000-8000-00000000000b";
const users = { admin: { id: ADMIN, pw: "segreta1", admin: true }, luca: { id: LUCA, pw: "lucaluca", admin: false } };
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

const browser = await chromium.launch();
async function open() {
  const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("https://jhbzszfglgetrcipaene.supabase.co/**", handle);
  await page.route("https://fonts*/**", (r) => r.abort());
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(() => window.__faro);
  await page.waitForTimeout(400);
  return { page, errors, context };
}
async function login(page, name, pw) {
  await page.fill("#olUser", name);
  await page.fill("#olPass", pw);
  await page.click("#olLogin");
  await page.waitForSelector("#olLogout", { timeout: 5000 });
  await page.waitForTimeout(400);
}

// ---------- l'admin pubblica e regala ----------
const A = await open();
await login(A.page, "admin", "segreta1");
await A.page.evaluate(() => window.__faro.debug.openAdmin());
await A.page.waitForTimeout(100);
const tabs = await A.page.locator(".adTabs button").allTextContents();
ok(tabs.includes("Giocatori") && tabs.includes("Stanze online"), `con l'account admin ci sono tutte le schede (${tabs.join(", ")})`);
await A.page.locator('.adTabs button:has-text("Bilancia modalità")').click();
await A.page.locator("#adBalMode").selectOption("easy");
await A.page.locator('#adModeForm input[data-mfield="hpBp"]').fill("150");
await A.page.locator('#adModeForm .adRow:has(input[data-mfield="hpBp"]) button').click();
await A.page.waitForTimeout(80);
await A.page.fill("#adPubTitle", "Easy più dura");
await A.page.click("#adPublish");
await A.page.waitForTimeout(500);
ok(db.balance.rev === 1 && JSON.stringify(db.balance.data.modes) === JSON.stringify([{ mode: "easy", field: "hpBp", value: 15000 }]), `pubblicato sul server: ${JSON.stringify(db.balance)}`);
ok(db.log.length === 1 && db.log[0].title === "Easy più dura" && db.log[0].items[0].includes("80% → 150%"), `annotato in bacheca: ${JSON.stringify(db.log)}`);
const draftAfter = await A.page.evaluate(() => window.__faro.debug.meta.draft);
ok(draftAfter.modes.length === 0, "dopo la pubblicazione le prove sono vuote");
ok((await A.page.locator("#adPubList li").count()) === 1, "la scheda mostra il valore pubblicato");
await A.page.screenshot({ path: "dist/shots/50-admin-published.png", fullPage: false });
// Un secondo admin ha pubblicato nel frattempo: la pubblicazione riparte dalla sua versione.
db.balance = { data: { towers: [], modes: [{ mode: "easy", field: "hpBp", value: 15000 }], maps: [{ map: "porto", field: "startCash", value: 400 }] }, rev: 2, updated_at: "2026-11-07T12:30:00Z" };
await A.page.locator('#adMapForm input[data-pfield="startCash"]').fill("500");
await A.page.locator("#adBalMap").selectOption("foce");
await A.page.locator('#adMapForm input[data-pfield="startCash"]').fill("450");
await A.page.locator('#adMapForm .adRow:has(input[data-pfield="startCash"]) button').click();
await A.page.waitForTimeout(80);
await A.page.click("#adPublish");
await A.page.waitForTimeout(500);
ok(db.balance.rev === 3 && db.balance.data.maps.length === 2 && db.balance.data.modes.length === 1, `non cancella le modifiche di un altro admin: ${JSON.stringify(db.balance.data)}`);
// Togliere un valore pubblicato.
await A.page.locator('#adPubList li:has-text("Doppia Foce") button').click();
await A.page.waitForTimeout(500);
ok(db.balance.rev === 4 && db.balance.data.maps.length === 1 && db.balance.data.maps[0].map === "porto", `togliere un valore lo riporta all'originale per tutti: ${JSON.stringify(db.balance.data.maps)}`);

// Premio a luca, che non ha ancora un salvataggio.
await A.page.locator('.adTabs button:has-text("Giocatori")').click();
await A.page.fill("#adGUser", "nessuno");
await A.page.click("#adGFind");
await A.page.waitForTimeout(200);
ok((await A.page.locator("#adGOut").textContent()).includes("Nessun giocatore"), "nome sconosciuto: lo dice");
await A.page.fill("#adGUser", "Luca");
await A.page.click("#adGFind");
await A.page.waitForSelector("#adPeek");
await A.page.fill("#adGSchegge", "500");
await A.page.fill("#adGPerle", "40");
await A.page.locator('input[data-unlock="kingpin"]').check();
await A.page.locator('select[data-rank="balestra"]').selectOption("3");
ok((await A.page.locator('input[data-unlock="custode"]').count()) === 0, "le torri admin non si regalano");
await A.page.fill("#adGNote", "Grazie per i test");
await A.page.screenshot({ path: "dist/shots/51-admin-grant.png" });
await A.page.click("#adGSend");
await A.page.waitForTimeout(400);
ok(db.grants.length === 1 && JSON.stringify(db.grants[0].payload) === JSON.stringify({ schegge: 500, perle: 40, unlock: ["kingpin"], ranks: { balestra: 3 } }) && db.grants[0].user_id === LUCA, `premio sul server: ${JSON.stringify(db.grants)}`);
ok((await A.page.locator("#adPeek").textContent()).includes("1 premi in attesa"), "dopo l'invio si vede il premio in attesa");
ok(A.errors.length === 0, `nessun errore nella pagina admin ${A.errors.join(" | ")}`);

// ---------- luca apre il gioco ----------
const L = await open();
const bal = await L.page.evaluate(() => window.__faro.debug.balance());
ok(JSON.stringify(bal.modes) === JSON.stringify([{ mode: "easy", field: "hpBp", value: 15000 }]) && bal.maps[0]?.value === 400, `il bilanciamento pubblicato arriva anche senza account: ${JSON.stringify(bal)}`);
const cash = await L.page.evaluate(() => {
  window.__faro.debug.restart(4, { mode: "easy", level: "porto" });
  return window.__faro.state.cash;
});
ok(cash === 400, `vale in partita (cash del Porto ${cash})`);
await L.page.evaluate(() => window.__faro.debug.openAdmin && document.getElementById("menu").hidden && null);
const newsText = await L.page.evaluate(() => document.getElementById("news").textContent);
ok(newsText.includes("Easy più dura"), "la bacheca mostra la modifica pubblicata");
await L.page.reload().catch(() => {});
await L.context.close();
const L2 = await open();
await login(L2.page, "luca", "lucaluca");
await L2.page.waitForTimeout(600);
const meta = await L2.page.evaluate(() => window.__faro.debug.meta);
ok(meta.schegge === 500 && meta.perle === 40 && meta.unlocked.includes("kingpin") && meta.ranks.balestra === 3, `premio riscosso: ${meta.schegge} Schegge, ${meta.perle} Perle, kingpin ${meta.unlocked.includes("kingpin")}, balestra ${meta.ranks.balestra}`);
ok(!!db.grants[0].claimed_at, "il premio risulta riscosso sul server");
await L2.page.waitForTimeout(3000);
ok(db.saves[LUCA]?.meta?.schegge === 500, "il salvataggio online di luca contiene il premio");
// Un secondo dispositivo non lo riscuote di nuovo.
const L3 = await open();
await login(L3.page, "luca", "lucaluca");
await L3.page.waitForTimeout(600);
const meta3 = await L3.page.evaluate(() => window.__faro.debug.meta);
ok(meta3.schegge === 500, `nessuna doppia riscossione (${meta3.schegge})`);
ok(L2.errors.length + L3.errors.length === 0, `nessun errore nelle pagine del giocatore ${[...L2.errors, ...L3.errors].join(" | ")}`);
// Un giocatore normale non vede le schede da admin online.
await L3.page.evaluate(() => window.__faro.debug.openAdmin());
const tabsL = await L3.page.locator(".adTabs button").allTextContents();
ok(!tabsL.includes("Stanze online") && !(await L3.page.locator("#adPublish").count()), "senza ruolo admin niente pubblicazione né stanze");

await browser.close();
console.log(fails ? `${fails} prove fallite` : "Online: tutte le prove superate");
process.exit(fails ? 1 : 0);
