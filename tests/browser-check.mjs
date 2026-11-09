// Collaudo nel browser: formato telefono, tocchi reali, partita fino in fondo, confronto degli hash.
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/opt/npm-tools/node_modules/");
import { SUPA_GLOB, fakeSupabase, login } from "./fake-supa.mjs";
const { chromium } = require("playwright");
const outDir = process.argv[2] ?? "dist/shots";
mkdirSync(outDir, { recursive: true });

const body = readFileSync("dist/ultimo-faro.html", "utf8");
const page_html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style></head><body>${body}</body></html>`;

const browser = await chromium.launch();
const failures = [];
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failures.push(name);
};

async function open(viewport, { menu = false } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("ERR_") && !m.text().includes("Failed to load resource")) errors.push(m.text());
  });
  await page.route("**/*", (r) => (r.request().url().startsWith("https://fonts") ? r.abort() : r.continue()));
  await page.setContent(page_html, { waitUntil: "load" });
  await page.waitForFunction(() => window.__faro);
  if (!menu) await page.locator("#mCampagna").tap();
  return { page, errors, context };
}

// Tocca una casella della mappa.
async function tapCell(page, cx, cy) {
  const p = await page.evaluate(([a, b]) => window.__faro.debug.cellCenter(a, b), [cx, cy]);
  await page.touchscreen.tap(p.x, p.y);
}

// ---------- telefono orizzontale ----------
{
  const { page, errors, context } = await open({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/01-intro.png` });
  check("il dialogo iniziale compare", await page.locator("#dialog").isVisible());
  const tick0 = await page.evaluate(() => window.__faro.state.tick);
  await page.waitForTimeout(400);
  check("il dialogo ferma il tempo", (await page.evaluate(() => window.__faro.state.tick)) === tick0);
  for (let i = 0; i < 3; i++) await page.locator("#dialog").tap();
  check("il dialogo si chiude", await page.locator("#dialog").isHidden());
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${outDir}/02-map.png` });

  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight);
  check("nessuno scorrimento della pagina in orizzontale", noScroll);
  const panelFits = await page.evaluate(() => {
    const p = document.getElementById("panel");
    return p.scrollHeight <= p.clientHeight + 1;
  });
  check("la plancia entra senza scorrere", panelFits);

  // Tocco sulla carta e poi sulla mappa.
  await page.locator('.card[data-kind="balestra"]').tap();
  check("la carta risulta selezionata", await page.locator('.card[data-kind="balestra"].on').count() === 1);
  await page.waitForTimeout(100);
  await tapCell(page, 5, 3);
  await page.waitForTimeout(100);
  let st = await page.evaluate(() => window.__faro.state);
  check("toccare carta e casella costruisce la torre", st.towers.length === 1 && st.towers[0].cx === 5 && st.towers[0].cy === 3, JSON.stringify(st.towers.map((t) => [t.cx, t.cy])));
  check("il costo viene scalato", st.cash === 220, String(st.cash));

  // Casella proibita: nessuna costruzione.
  await page.locator('.card[data-kind="balestra"]').tap();
  await tapCell(page, 3, 3);
  await page.waitForTimeout(100);
  st = await page.evaluate(() => window.__faro.state);
  check("sul canale non si costruisce", st.towers.length === 1);
  check("appare il messaggio di errore", await page.locator("#toast").isVisible());
  await page.keyboard.press("Escape");

  // Trascinamento dalla carta alla mappa, con il dito.
  const card = await page.locator('.card[data-kind="balestra"]').boundingBox();
  const box = await page.locator("#map").boundingBox();
  const T = box.width / 16;
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", card.x + 40, card.y + 20);
  await touch("touchMove", box.x + 6.5 * T, box.y + 6 * T);
  await touch("touchMove", box.x + 6.5 * T, box.y + 5.4 * T);
  await page.waitForTimeout(60);
  await page.screenshot({ path: `${outDir}/03-placing.png` });
  await touch("touchEnd");
  await page.waitForTimeout(100);
  st = await page.evaluate(() => window.__faro.state);
  check("trascinare dalla carta costruisce sotto il dito sollevato", st.towers.length === 2 && st.towers[1].cx === 6 && st.towers[1].cy === 4, JSON.stringify(st.towers.map((t) => [t.cx, t.cy])));

  // Menu torre, miglioramento, vendita.
  await tapCell(page, 5, 3);
  await page.waitForTimeout(80);
  check("toccare una torre apre il dettaglio", await page.locator("#detail").isVisible());
  await page.screenshot({ path: `${outDir}/04-detail.png` });
  await page.locator("#btnUp").tap();
  await page.waitForTimeout(80);
  st = await page.evaluate(() => window.__faro.state);
  check("il miglioramento funziona", st.towers[0].level === 2 && st.cash === 40, `${st.towers[0].level}/${st.cash}`);
  await page.locator("#btnClose").tap();

  // Pausa: si può costruire, il tempo resta fermo.
  await page.locator("#pause").tap();
  const t1 = await page.evaluate(() => window.__faro.state.tick);
  await page.waitForTimeout(300);
  check("la pausa ferma il tempo", (await page.evaluate(() => window.__faro.state.tick)) === t1);
  await page.screenshot({ path: `${outDir}/05-paused.png` });
  await page.locator("#pause").tap();

  // Partenza anticipata, combattimento.
  await page.locator("#go").tap();
  await page.locator("#speed").tap();
  await page.waitForTimeout(400);
  while (await page.locator("#dialog").isVisible()) await page.locator("#dialog").tap();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${outDir}/06-combat.png` });
  st = await page.evaluate(() => window.__faro.state);
  check("l'ondata parte e la partita avanza", st.wave === 1 && st.tick > 100, `ondata ${st.wave}, tick ${st.tick}`);

  // Rigioco del registro comandi: ciò che ha fatto l'interfaccia deve dare lo stesso hash.
  const replay = await page.evaluate(() => {
    const f = window.__faro;
    const log = new Map(f.log);
    const s = f.createGame(f.state.seed, { mode: f.state.mode, allowed: f.state.allowed, ranks: f.state.ranks });
    while (s.tick < f.state.tick) f.step(s, log.get(s.tick) ?? []);
    const extra = log.get(s.tick);
    if (extra) f.applyCommands?.(s, extra);
    return { ok: f.hashState(s), live: f.hashState(f.state), a: s.tick, b: f.state.tick };
  });
  check("il registro comandi riproduce la partita dell'interfaccia", replay.ok === replay.live && replay.a === replay.b, JSON.stringify(replay));

  check("nessun errore di pagina in orizzontale", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- telefono verticale, come dentro l'app di Claude ----------
for (const vp of [{ width: 390, height: 700 }, { width: 390, height: 844 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const { page, errors, context } = await open(vp);
  await page.waitForTimeout(250);
  for (let i = 0; i < 3; i++) await page.locator("#dialog").tap();
  await page.waitForTimeout(120);
  const view = await page.evaluate(() => window.__faro.debug.view);
  check(`${tag}: la carta ruota in verticale`, view.rot === true && view.below === true, JSON.stringify(view));
  check(`${tag}: caselle grandi almeno 30 px`, view.T >= 30, view.T.toFixed(1));
  await page.screenshot({ path: `${outDir}/07-portrait-${tag}.png` });
  const fit = await page.evaluate(() => {
    const d = document.documentElement;
    const p = document.getElementById("panel").getBoundingClientRect();
    return { h: d.scrollHeight <= innerHeight && d.scrollWidth <= innerWidth, bottom: p.bottom <= innerHeight };
  });
  check(`${tag}: tutto entra nello schermo`, fit.h && fit.bottom, JSON.stringify(fit));
  await page.locator('.card[data-kind="mortaio"]').tap();
  await tapCell(page, 5, 3);
  await page.waitForTimeout(100);
  let st = await page.evaluate(() => window.__faro.state);
  check(`${tag}: toccare carta e casella costruisce nella casella giusta`, st.towers.length === 1 && st.towers[0].cx === 5 && st.towers[0].cy === 3, JSON.stringify(st.towers.map((t) => [t.cx, t.cy])));
  await tapCell(page, 5, 3);
  await page.waitForTimeout(100);
  check(`${tag}: il dettaglio si apre sopra la carta`, await page.locator("#stage #detail").isVisible());
  await page.screenshot({ path: `${outDir}/07b-portrait-detail-${tag}.png` });
  await page.locator("#btnClose").tap();
  await page.locator("#go").tap();
  await page.locator("#speed").tap();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${outDir}/07c-portrait-combat-${tag}.png` });
  check(`${tag}: nessun errore di pagina`, errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- telefono piccolo ----------
{
  const { page, errors, context } = await open({ width: 640, height: 360 });
  await page.waitForTimeout(250);
  for (let i = 0; i < 3; i++) await page.locator("#dialog").tap();
  await page.locator('.card[data-kind="soffio"]').tap();
  await tapCell(page, 4, 4);
  await page.waitForTimeout(100);
  await tapCell(page, 4, 4);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${outDir}/08-small.png` });
  const fits = await page.evaluate(() => {
    const p = document.getElementById("panel");
    return { fits: p.scrollHeight <= p.clientHeight + 1, sh: p.scrollHeight, ch: p.clientHeight };
  });
  check("su schermo piccolo la plancia resta raggiungibile", fits.fits || fits.ch > 200, JSON.stringify(fits));
  check("nessun errore di pagina su schermo piccolo", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- determinismo Chrome contro Node ----------
{
  const { page, context } = await open({ width: 844, height: 390 });
  const chromeHashes = await page.evaluate(() => [1, 2, 3, 4242].map((s) => window.__faro.playBot("mirato", s).hash));
  await context.close();
  const expected = JSON.parse(readFileSync("dist/node-hashes.json", "utf8"));
  check("Chrome e Node ottengono gli stessi hash", JSON.stringify(chromeHashes) === JSON.stringify(expected), `${chromeHashes} / ${expected}`);
}

// ---------- fine partita ----------
{
  const { page, errors, context } = await open({ width: 844, height: 390 });
  for (let i = 0; i < 3; i++) await page.locator("#dialog").tap();
  // Senza difese si perde: il Faro deve spegnersi e il tasto Rigioca ripartire da capo.
  await page.locator("#speed").tap();
  await page.locator("#go").tap();
  await page.waitForFunction(
    () => {
      const d = document.getElementById("dialog");
      if (!d.hidden) d.click();
      const go = document.getElementById("go");
      if (!go.hidden) go.click();
      return window.__faro.state.phase === "lost";
    },
    undefined,
    { timeout: 120000, polling: 200 },
  );
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${outDir}/09-end.png` });
  check("la sconfitta mostra la schermata finale", await page.locator("#end").isVisible());
  await page.locator("#again").tap();
  await page.waitForTimeout(100);
  const st = await page.evaluate(() => window.__faro.state);
  check("Rigioca riparte da una partita nuova", st.tick < 20 && st.lives === 20 && (await page.locator("#end").isHidden()));
  check("nessun errore di pagina fino alla fine", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- vittoria completa attraverso il client ----------
{
  const { page, errors, context } = await open({ width: 844, height: 390 });
  const result = await page.evaluate(() => {
    const f = window.__faro;
    const log = [];
    const opts = { allowed: ["balestra", "mortaio", "soffio", "cecchino", "bobina", "officina"] };
    const expected = f.playBot("mirato", 4242, 80000, log, opts);
    f.debug.restart(4242, opts);
    const byTick = new Map(log);
    let guard = 0;
    while (f.state.phase !== "won" && f.state.phase !== "lost" && guard++ < 60000) {
      for (const c of byTick.get(f.state.tick) ?? []) f.debug.send(c);
      f.debug.tick();
      f.debug.closeDialog();
    }
    return { phase: f.state.phase, hash: f.hashState(f.state), expected: expected.hash, stars: expected.stars, lives: f.state.lives };
  });
  check("il client ripete la stessa partita del bot", result.hash === result.expected, JSON.stringify(result));
  check("il bot attento vince anche attraverso il client", result.phase === "won");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/10-won.png` });
  check("la vittoria mostra la schermata finale", await page.locator("#end").isVisible() && (await page.locator("#endTitle").textContent()) === "Il Faro resta acceso");
  check("nessun errore di pagina nella vittoria", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- pannello admin locale ----------
for (const vp of [{ width: 390, height: 700 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const { page, errors, context } = await open(vp, { menu: true });
  check(`${tag}: il pannello admin è nascosto all'inizio`, await page.locator("#adminOpen").isHidden());
  // Senza account admin non si apre in nessun modo, nemmeno dalla console o con i tocchi sul titolo.
  for (let i = 0; i < 5; i++) await page.locator("#menuTitle").click();
  await page.evaluate(() => window.__faro.debug.openAdmin());
  check(`${tag}: senza account admin il pannello non si apre`, (await page.locator("#adminPanel").isHidden()) && (await page.locator("#adminOpen").isHidden()));
  const fake = fakeSupabase();
  await page.route(SUPA_GLOB, fake.handle);
  await login(page, "admin", "segreta1");
  check(`${tag}: con l'account admin compare il pannello admin`, await page.locator("#adminOpen").isVisible());
  await page.locator("#adminOpen").click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${outDir}/19-admin-${tag}.png` });
  check(`${tag}: il pannello ha sei schede`, (await page.locator(".adTabs button").count()) === 6);
  // Bilanciamento: danno della Balestra al livello 1.
  await page.locator('.adTabs button:has-text("Bilancia torri")').click();
  await page.locator('#adminPanel input[data-field="damage"]').fill("20");
  await page.locator('#adminPanel .adRow:has(input[data-field="damage"]) button').click();
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${outDir}/20-admin-balance-${tag}.png` });
  const meta = await page.evaluate(() => window.__faro.debug.meta);
  check(`${tag}: la modifica di bilanciamento viene salvata e annotata`, meta.draft.towers.length === 1 && meta.draft.towers[0].value === 20, JSON.stringify(meta.draft));
  check(`${tag}: la riga modificata mostra il valore originale`, (await page.locator('#adminPanel .adRow.changed:has(input[data-field="damage"]) small').textContent()).includes("originale"));
  // Modalità: vita dei nemici di Easy al 150% e cash del Porto.
  await page.locator('.adTabs button:has-text("Bilancia modalità")').click();
  await page.locator("#adBalMode").selectOption("easy");
  await page.locator('#adModeForm input[data-mfield="hpBp"]').fill("150");
  await page.locator('#adModeForm .adRow:has(input[data-mfield="hpBp"]) button').click();
  await page.waitForTimeout(60);
  await page.locator("#adBalMap").selectOption("porto");
  await page.locator('#adMapForm input[data-pfield="startCash"]').fill("700");
  await page.locator('#adMapForm .adRow:has(input[data-pfield="startCash"]) button').click();
  await page.waitForTimeout(60);
  await page.screenshot({ path: `${outDir}/20b-admin-modes-${tag}.png` });
  const m2 = await page.evaluate(() => window.__faro.debug.meta.draft);
  check(`${tag}: le modifiche di modalità e mappa finiscono nelle prove`, m2.modes.length === 1 && m2.modes[0].value === 15000 && m2.maps.length === 1 && m2.maps[0].value === 700, JSON.stringify(m2));
  check(`${tag}: le tre prove sono elencate e si possono pubblicare`, (await page.locator("#adPublish").count()) === 1 && (await page.locator("#adDraftList li").count()) === 3);
  const easy = await page.evaluate(() => {
    window.__faro.debug.restart(3, { mode: "easy", level: "porto" });
    return window.__faro.state.cash;
  });
  check(`${tag}: il cash di mappa modificato vale in partita`, easy === 700, String(easy));
  await page.evaluate(() => window.__faro.debug.openAdmin());
  await page.waitForTimeout(60);
  await page.locator('.adTabs button:has-text("Giocatori")').click();
  check(`${tag}: la scheda Giocatori ha la ricerca per nome`, await page.locator("#adGUser").isVisible());
  // Annullare le prove riporta i valori originali (due tocchi).
  await page.locator('.adTabs button:has-text("Bilancia modalità")').click();
  await page.locator('.adBalance button.danger:has-text("Annulla le prove")').click();
  await page.locator('.adBalance button.danger:has-text("Tocca di nuovo")').click();
  await page.waitForTimeout(60);
  const m3 = await page.evaluate(() => window.__faro.debug.meta.draft);
  check(`${tag}: annullare le prove svuota le modifiche`, m3.towers.length + m3.modes.length + m3.maps.length === 0, JSON.stringify(m3));
  // Prova torri.
  await page.locator('.adTabs button:has-text("Prova torri")').click();
  await page.locator("#adStart").click();
  await page.waitForTimeout(200);
  while (await page.locator("#dialog").isVisible()) await page.locator("#dialog").tap();
  let st = await page.evaluate(() => window.__faro.state);
  check(`${tag}: la prova ha tutte le 16 torri e niente premi`, st.sandbox && st.allowed.length === 16 && (await page.locator(".card").count()) === 16);
  const dmg = await page.evaluate(() => {
    const f = window.__faro;
    f.debug.send({ t: "build", kind: "balestra", cx: 5, cy: 3 });
    return f.state.towers.length;
  });
  check(`${tag}: si costruisce nella prova`, dmg === 1);
  check(`${tag}: il tasto Admin compare sulla carta`, await page.locator("#adminBtn").isVisible());
  await page.locator("#adminBtn").click();
  await page.waitForTimeout(80);
  await page.locator('#adminDrawer button:has-text("+10.000 cash")').click();
  await page.locator("#adEnemy").selectOption("leviatano");
  await page.locator("#adCount").fill("1");
  await page.locator("#adBoss").check();
  await page.locator('#adminDrawer .adMods input[value="schermato"]').check();
  await page.screenshot({ path: `${outDir}/21-admin-drawer-${tag}.png` });
  await page.locator("#adSpawnGo").click();
  await page.locator('#adminDrawer button[data-boss="dohoter"]').click();
  await page.locator('#adminDrawer button:has-text("DPS")').click();
  await page.locator('#adminDrawer button:has-text("Chiudi")').click();
  await page.waitForTimeout(1500);
  st = await page.evaluate(() => window.__faro.state);
  const lev = st.enemies.find((e) => e.kind === "leviatano");
  check(`${tag}: il pannello genera un boss con modificatori`, !!lev && lev.boss && lev.shield > 0 && st.cash >= 109000, JSON.stringify({ n: st.enemies.length, cash: st.cash }));
  check(`${tag}: la barra del boss compare`, await page.locator("#bossBar").isVisible());
  const doh = st.enemies.find((e) => e.kind === "dohoter");
  check(`${tag}: Dohoter Gang arriva con 67.000 di vita`, !!doh && doh.maxHp === 67000 && doh.boss, JSON.stringify(doh && { hp: doh.maxHp }));
  await page.screenshot({ path: `${outDir}/22-sandbox-boss-${tag}.png` });
  check(`${tag}: nessun errore di pagina nel pannello admin`, errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- scelte del giocatore ----------
for (const vp of [{ width: 390, height: 760 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const { page, errors, context } = await open(vp);
  while (await page.locator("#dialog").isVisible()) await page.locator("#dialog").tap();
  // Puntamento dalla scheda della torre.
  await page.evaluate(() => {
    const f = window.__faro;
    f.debug.restart(21, { mode: "campagna", level: "porto", allowed: ["balestra", "officina"] });
    f.state.cash = 5000;
    f.debug.send({ t: "build", kind: "balestra", cx: 5, cy: 3 });
    f.debug.send({ t: "build", kind: "officina", cx: 7, cy: 3 });
  });
  await tapCell(page, 5, 3);
  await page.waitForTimeout(120);
  check(`${tag}: la torre mostra i cinque puntamenti`, (await page.locator("#dAim button").count()) === 5 && (await page.locator('#dAim button[aria-pressed="true"]').textContent()) === "Primo");
  await page.locator('#dAim button[data-aim="strong"]').click();
  await page.waitForTimeout(120);
  check(`${tag}: il puntamento scelto vale sulla torre`, (await page.evaluate(() => window.__faro.state.towers[0].aim)) === "strong" && (await page.locator('#dAim button[aria-pressed="true"]').textContent()) === "Più forte");
  await page.screenshot({ path: `${outDir}/60-aim-${tag}.png` });
  await tapCell(page, 7, 3);
  await page.waitForTimeout(120);
  check(`${tag}: l'Officina non ha puntamento`, await page.locator("#dAim").isHidden());
  // Campagna: ordini del Capitano.
  await page.locator('#twbar button[data-order="difesa"]').click();
  await page.waitForTimeout(80);
  check(`${tag}: l'ordine Difesa si attiva`, (await page.evaluate(() => window.__faro.state.tw.order)) === "difesa" && (await page.locator('#twbar button[data-order="difesa"]').getAttribute("aria-pressed")) === "true");
  await page.screenshot({ path: `${outDir}/61-orders-${tag}.png` });
  // Easy: il Mercante.
  await page.evaluate(() => {
    const f = window.__faro;
    f.debug.restart(22, { mode: "easy", level: "porto" });
    f.state.tw.offer = { id: 9999, kind: "mercante", options: ["oro", "sconto", "vite"] };
  });
  await page.waitForTimeout(150);
  check(`${tag}: l'offerta del Mercante compare sulla carta`, (await page.locator("#choice .opt").count()) === 3);
  await page.screenshot({ path: `${outDir}/62-merchant-${tag}.png` });
  const cash0 = await page.evaluate(() => window.__faro.state.cash);
  await page.locator('#choice .opt[data-pick="0"]').click();
  await page.waitForTimeout(150);
  const cash1 = await page.evaluate(() => window.__faro.state.cash);
  check(`${tag}: scegliere il Sacco d'oro dà cash e chiude l'offerta`, cash1 > cash0 && (await page.locator("#choice").isHidden()), `${cash0} → ${cash1}`);
  // Frost: braciere.
  await page.evaluate(() => window.__faro.debug.restart(23, { mode: "frost", level: "porto" }));
  await page.waitForTimeout(100);
  await page.locator("#brazierBtn").click();
  await tapCell(page, 6, 4);
  await page.waitForTimeout(120);
  check(`${tag}: il braciere si piazza toccando la carta`, (await page.evaluate(() => window.__faro.state.tw.braziers.length)) === 1);
  // Notte 5: momento rapido.
  await page.evaluate(() => {
    const f = window.__faro;
    f.debug.restart(24, { mode: "natale", night: 5 });
    f.debug.send({ t: "skip" });
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const f = window.__faro;
    const e = f.state.enemies[0];
    f.state.tw.qte = { id: 8888, kind: "simbolo", symbols: [0, 3, 5], answer: 1, got: 0, until: f.state.tick + 400, target: e ? e.id : 0 };
  });
  await page.waitForTimeout(150);
  check(`${tag}: il momento rapido mostra tre simboli`, (await page.locator("#qte .syms button").count()) === 3);
  await page.screenshot({ path: `${outDir}/63-qte-${tag}.png` });
  await page.locator('#qte button[data-sym="1"]').click();
  await page.waitForTimeout(150);
  check(`${tag}: toccare il simbolo giusto vince il momento rapido`, (await page.evaluate(() => window.__faro.state.tw.qteWins)) === 1 && (await page.locator("#qte").isHidden()));
  await page.evaluate(() => {
    const f = window.__faro;
    f.state.tw.qte = { id: 8889, kind: "raffica", symbols: [0, 1, 2], answer: 0, got: 0, until: f.state.tick + 400, target: 0 };
  });
  await page.waitForTimeout(150);
  for (let i = 0; i < 12; i++) await page.locator("#qte .mash").click();
  await page.waitForTimeout(200);
  check(`${tag}: la raffica di tocchi spezza le catene`, (await page.evaluate(() => window.__faro.state.tw.qteWins)) === 2, String(await page.evaluate(() => window.__faro.state.tw.qte?.got)));
  check(`${tag}: nessun errore di pagina nelle scelte`, errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- Hardcore e Apex ----------
{
  const { page, errors, context } = await open({ width: 844, height: 390 });
  while (await page.locator("#dialog").isVisible()) await page.locator("#dialog").tap();
  await page.evaluate(() => window.__faro.debug.restart(9, { mode: "hardcore", allowed: ["balestra", "mortaio", "mitragliera", "arpione", "purificatore", "bobina"], ranks: { balestra: 3 } }));
  await page.waitForTimeout(100);
  let st = await page.evaluate(() => window.__faro.state);
  check("Hardcore: 10 vite e 50 ondate", st.lives === 10 && (await page.locator("#wave").textContent()) === "0/50");
  await page.evaluate(() => window.__faro.step(window.__faro.state, [{ t: "adminWave", wave: 2 }]));
  await page.waitForTimeout(150);
  check("Hardcore: l'anteprima mostra i modificatori", /Agile/.test((await page.locator("#next").textContent()) ?? ""));
  await page.evaluate(() => {
    const f = window.__faro;
    f.state.cash = 1e6;
    f.debug.send({ t: "build", kind: "balestra", cx: 5, cy: 3 });
    const id = f.state.towers[0].id;
    f.debug.send({ t: "upgrade", id });
    f.debug.send({ t: "upgrade", id });
    f.debug.send({ t: "spec", id, branch: "A" });
  });
  await tapCell(page, 5, 3);
  await page.waitForTimeout(120);
  check("Apex: il pulsante compare dopo la specializzazione", await page.locator("#btnApex").isVisible() && !(await page.locator("#btnApex").isDisabled()));
  await page.locator("#btnApex").tap();
  await page.waitForTimeout(300);
  st = await page.evaluate(() => window.__faro.state);
  check("Apex: la torre arriva al livello Apex", st.towers[0].level === 5 && st.apexBuilt === 1);
  await page.screenshot({ path: `${outDir}/23-apex.png` });
  check("nessun errore di pagina in Hardcore", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- menu, Arsenale, Schegge ----------
{
  const { page, errors, context } = await open({ width: 390, height: 700 }, { menu: true });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/12-menu.png` });
  check("il menu compare all'avvio", await page.locator("#menu").isVisible());
  check("Infinita è chiusa finché non si vince", await page.locator("#mInfinita").isDisabled());
  check("l'Arsenale elenca 14 torri (le 2 admin restano nascoste)", (await page.locator("#arsenal .row").count()) === 14);
  check("la Stella Cometa si ottiene solo vincendo la Notte 5", (await page.locator('#arsenal button[data-kind="cometa"]').textContent()) === "Vinci la Notte 5");
  check("ci sono tre missioni attive", (await page.locator("#missions .mission").count()) === 3);
  check("le medaglie sono 17", (await page.locator("#medals .medal").count()) === 17);
  check("Easy aperta, Medium e Hardcore chiuse", !(await page.locator('[data-survival="easy"]').isDisabled()) && (await page.locator('[data-survival="medium"]').isDisabled()) && (await page.locator('[data-survival="hardcore"]').isDisabled()));
  check("Notte 1 aperta, Notte 2 chiusa", !(await page.locator('[data-night="1"]').isDisabled()) && (await page.locator('[data-night="2"]').isDisabled()));
  check("il Disgelo è indicato nel menu", /forza \d+%/.test(await page.locator("#disgelo").textContent()));
  check("la sezione Online mostra l'accesso", await page.locator("#olLogin").isVisible());
  check("torri Hardcore e Kingpin chiedono Perle", (await page.locator("#arsenal button.pearl").count()) === 4);
  check("i livelli 2 e 3 sono chiusi all'inizio", (await page.locator('[data-play="foce"]').isDisabled()) && (await page.locator('[data-play="marea"]').isDisabled()));
  check("senza Schegge non si sblocca", await page.locator('#arsenal button[data-kind="cecchino"]').isDisabled());
  check("il menu non scorre di lato", await page.evaluate(() => document.getElementById("menu").scrollWidth <= innerWidth));
  // Una partita persa dà Schegge.
  await page.locator("#mCampagna").tap();
  for (let i = 0; i < 3; i++) if (await page.locator("#dialog").isVisible()) await page.locator("#dialog").tap();
  check("in partita ci sono solo le torri della squadra", (await page.locator(".card").count()) === 3);
  await page.locator("#speed").tap();
  await page.locator("#go").tap();
  await page.waitForFunction(
    () => {
      const d = document.getElementById("dialog");
      if (!d.hidden) d.click();
      const go = document.getElementById("go");
      if (!go.hidden) go.click();
      return window.__faro.state.phase === "lost";
    },
    undefined,
    { timeout: 120000, polling: 200 },
  );
  await page.waitForTimeout(150);
  const meta1 = await page.evaluate(() => window.__faro.debug.meta.schegge);
  check("una sconfitta dà Schegge", meta1 > 0 && (await page.locator("#endReward").textContent()) === `+${meta1} Schegge`, String(meta1));
  await page.screenshot({ path: `${outDir}/13-end-portrait.png` });
  await page.locator("#toMenu").tap();
  check("dal finale si torna al menu", await page.locator("#menu").isVisible());
  // Sblocco e rango.
  await page.evaluate(() => window.__faro.debug.setSchegge(1000));
  await page.locator('#arsenal button[data-kind="cecchino"]').tap();
  await page.locator('#arsenal button[data-kind="balestra"]').tap();
  const meta2 = await page.evaluate(() => window.__faro.debug.meta);
  check("l'Arsenale sblocca e alza di rango", meta2.unlocked.includes("cecchino") && meta2.ranks.balestra === 2 && meta2.schegge === 1000 - 150 - 100, JSON.stringify(meta2));
  await page.screenshot({ path: `${outDir}/14-arsenal.png` });
  // Il Kingpin vuole Schegge e Perle insieme.
  await page.evaluate(() => {
    window.__faro.debug.setSchegge(2000);
    window.__faro.debug.meta.perle = 0;
    window.__faro.debug.setSchegge(2000);
  });
  const kp = page.locator('#arsenal button[data-kind="kingpin"]');
  check("il Kingpin chiede Schegge e Perle", /1\.?000 Schegge \+ 40 Perle/.test(await kp.textContent()) && (await kp.isDisabled()), await kp.textContent());
  await page.evaluate(() => {
    window.__faro.debug.meta.perle = 50;
    window.__faro.debug.setSchegge(2000);
  });
  await kp.tap();
  const meta3 = await page.evaluate(() => window.__faro.debug.meta);
  check("con entrambe le valute il Kingpin si sblocca", meta3.unlocked.includes("kingpin") && meta3.schegge === 1000 && meta3.perle === 10, `${meta3.schegge} ${meta3.perle}`);
  if (meta3.loadout.includes("kingpin")) await page.locator('#arsenal button[data-squad="kingpin"]').tap();
  await page.locator("#mCampagna").tap();
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => window.__faro.state);
  check("la nuova partita usa sblocchi, squadra e ranghi", st.allowed.includes("cecchino") && st.ranks.balestra === 2 && (await page.locator(".card").count()) === 4);
  // Abilità in ondata.
  await page.locator("#go").tap();
  await page.waitForTimeout(2500);
  while (await page.locator("#dialog").isVisible()) await page.locator("#dialog").tap();
  check("le abilità compaiono durante l'ondata", await page.locator("#abilities").isVisible());
  await page.locator("#abGelata").tap();
  const frozen = await page.evaluate(() => window.__faro.state.enemies.length > 0 && window.__faro.state.enemies.every((e) => e.stun > 0));
  check("la Gelata congela i nemici", frozen);
  await page.locator("#abFascio").tap();
  const e0 = await page.evaluate(() => window.__faro.state.enemies[0]);
  const cell = { cx: Math.floor(e0.x / 1000), cy: Math.floor(e0.y / 1000) };
  const pt = await page.evaluate(([a, b]) => window.__faro.debug.cellCenter(a, b), [cell.cx, cell.cy]);
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${outDir}/15-abilities.png` });
  const cd = await page.evaluate(() => window.__faro.state.abilityCd);
  check("il Fascio colpisce dove si tocca e si ricarica", cd.fascio > 0 && cd.gelata > 0, JSON.stringify(cd));
  // Pausa ed uscita.
  await page.locator("#pause").tap();
  check("la pausa mostra Riprendi ed Esci", await page.locator("#pauseLayer").isVisible());
  await page.locator("#quit").tap();
  check("Esci riporta al menu", await page.locator("#menu").isVisible());
  check("nessun errore di pagina nel menu", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- livelli nuovi e torri di supporto ----------
for (const vp of [{ width: 844, height: 390 }, { width: 390, height: 700 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const { page, errors, context } = await open(vp);
  while (await page.locator("#dialog").isVisible()) await page.locator("#dialog").tap();
  await page.evaluate(() => window.__faro.debug.restart(5, { level: "foce", allowed: ["balestra", "mortaio", "bobina", "grammofono", "capitano", "medico"] }));
  await page.waitForTimeout(150);
  check(`${tag}: la Doppia Foce mostra 6 carte di squadra`, (await page.locator(".card").count()) === 6);
  await page.evaluate(() => {
    const f = window.__faro;
    f.state.cash = 3000;
    f.debug.send({ t: "build", kind: "grammofono", cx: 6, cy: 3 });
    f.debug.send({ t: "build", kind: "balestra", cx: 5, cy: 3 });
    f.debug.send({ t: "build", kind: "capitano", cx: 7, cy: 5 });
    f.debug.send({ t: "build", kind: "medico", cx: 9, cy: 5 });
  });
  await tapCell(page, 6, 3);
  await page.waitForTimeout(120);
  check(`${tag}: il Grammofono mostra i tre dischi`, (await page.locator("#dExtra .track").count()) === 3);
  await page.locator('#dExtra [data-track="sconto"]').tap();
  const track = await page.evaluate(() => window.__faro.state.towers.find((t) => t.kind === "grammofono").track);
  check(`${tag}: toccare un disco lo cambia`, track === "sconto", track);
  await page.screenshot({ path: `${outDir}/16-foce-dj-${tag}.png` });
  await page.locator("#btnClose").tap();
  await page.locator("#go").tap();
  await page.waitForTimeout(300);
  while (await page.locator("#dialog").isVisible()) await page.locator("#dialog").tap();
  await tapCell(page, 7, 5);
  await page.waitForTimeout(120);
  await page.locator("#dExtra .towerAb").tap();
  await page.waitForTimeout(150);
  const cap = await page.evaluate(() => window.__faro.state.towers.find((t) => t.kind === "capitano"));
  check(`${tag}: la Chiamata alle armi parte dal dettaglio`, cap.abilityLeft > 0, JSON.stringify({ left: cap.abilityLeft, cd: cap.abilityCd }));
  await page.locator("#btnClose").tap();
  await page.locator("#speed").tap();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${outDir}/17-foce-combat-${tag}.png` });
  // Bassa Marea: canale chiuso e secche sommerse.
  await page.evaluate(() => window.__faro.debug.restart(6, { level: "marea" }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/18-marea-${tag}.png` });
  check(`${tag}: sulle secche sommerse non si costruisce`, await page.evaluate(() => {
    const f = window.__faro;
    f.debug.send({ t: "build", kind: "balestra", cx: 5, cy: 4 });
    return f.state.towers.length === 0;
  }));
  check(`${tag}: nessun errore di pagina nei livelli nuovi`, errors.length === 0, errors.join(" | "));
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} prove fallite` : "\nTutte le prove superate");
process.exit(failures.length ? 1 : 0);
