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

import { ADMIN, LUCA, SUPA_GLOB, fakeSupabase, login } from "./fake-supa.mjs";
const fake = fakeSupabase();
const { db, handle } = fake;

const browser = await chromium.launch();
async function open() {
  const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(SUPA_GLOB, handle);
  await page.route("https://fonts*/**", (r) => r.abort());
  await page.route("https://faro.test/", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  await page.goto("https://faro.test/");
  await page.waitForFunction(() => window.__faro);
  await page.waitForTimeout(400);
  return { page, errors, context };
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
ok(db.log.length === 1 && db.log[0].title === "Easy più dura" && db.log[0].items[0].includes("136% → 150%"), `annotato in bacheca: ${JSON.stringify(db.log)}`);
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
// Un giocatore normale non apre il pannello, nemmeno dalla console.
await L3.page.evaluate(() => window.__faro.debug.openAdmin());
ok((await L3.page.locator("#adminPanel").isHidden()) && (await L3.page.locator("#adminOpen").isHidden()), "senza ruolo admin il pannello non si apre");

// ---------- stesso dispositivo: prima l'admin, poi un altro account ----------
const D = await open();
await login(D.page, "admin", "segreta1");
await D.page.evaluate(() => window.__faro.debug.adminApi.progress.schegge());
ok((await D.page.locator("#adminOpen").isVisible()) && (await D.page.evaluate(() => window.__faro.debug.meta.schegge)) >= 1000, "l'admin ha il pannello e si dà Schegge");
await D.page.click("#olLogout");
await D.page.waitForTimeout(200);
ok(await D.page.locator("#adminOpen").isHidden(), "dopo l'uscita il pannello sparisce");
await login(D.page, "nuovo", "nuovonuovo");
await D.page.waitForTimeout(400);
const dm = await D.page.evaluate(() => window.__faro.debug.meta);
ok(await D.page.locator("#adminOpen").isHidden(), "un altro account sullo stesso dispositivo non ha il pannello");
ok(dm.schegge === 0 && !dm.unlocked.includes("custode"), `l'account nuovo non eredita i progressi dell'admin (${dm.schegge} Schegge)`);
const before = await D.page.evaluate(() => {
  window.__faro.debug.restart(2, { mode: "easy", level: "porto" });
  const c = window.__faro.state.cash;
  window.__faro.debug.send({ t: "adminCash", amount: 50000 });
  window.__faro.debug.adminApi.startSandbox("porto", "easy");
  return [c, window.__faro.state.cash, !!window.__faro.state.sandbox];
});
ok(before[0] === before[1] && !before[2], `comandi admin e partita di prova rifiutati (${before.join(", ")})`);
// Riaprendo la pagina con la sessione salvata, il ruolo si ricontrolla sul server.
{
  const R = await open();
  await login(R.page, "admin", "segreta1");
  fake.users.admin.admin = false;
  const p2 = await R.context.newPage();
  await p2.route(SUPA_GLOB, handle);
  await p2.route("https://faro.test/", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  await p2.goto("https://faro.test/");
  await p2.waitForFunction(() => window.__faro);
  await p2.waitForTimeout(800);
  const still = true;
  ok(still && (await p2.locator("#adminOpen").isHidden()) && (await p2.locator("#olLogout").isVisible()), "se il server toglie il ruolo, al riavvio il pannello non c'è più (sessione ancora aperta)");
  fake.users.admin.admin = true;
}
ok(D.errors.length === 0, `nessun errore nel cambio di account ${D.errors.join(" | ")}`);

await browser.close();
console.log(fails ? `${fails} prove fallite` : "Online: tutte le prove superate");
process.exit(fails ? 1 : 0);
