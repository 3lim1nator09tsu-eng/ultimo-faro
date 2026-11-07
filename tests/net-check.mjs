// Collaudo del multigiocatore in lockstep: due pagine, canale locale, stesse partite.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
import { SUPA_GLOB, fakeSupabase, login } from "./fake-supa.mjs";
const server = spawn("python3", ["-m", "http.server", "8765", "--bind", "127.0.0.1"], { cwd: "dist", stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const A = await ctx.newPage();
const B = await ctx.newPage();
const errs = [];
for (const p of [A, B]) p.on("pageerror", (e) => errs.push(String(e)));
for (const p of [A, B]) {
  await p.goto("http://127.0.0.1:8765/web/index.html");
  await p.waitForTimeout(300);
}
// Chi ospita è l'admin (account confermato dal server finto): i comandi admin sono suoi.
const fake = fakeSupabase();
await A.route(SUPA_GLOB, fake.handle);
await login(A, "admin", "segreta1");
// Chi partecipa senza account non può usare i comandi admin né le prove di bilanciamento.
const guestTry = await B.evaluate(() => {
  window.__faro.debug.adminApi.balance.setDraft("modes", { mode: "easy", field: "lives", value: 999 });
  return JSON.stringify(window.__faro.debug.balance());
});
ok(guestTry === JSON.stringify({ towers: [], modes: [], maps: [] }), `senza admin le prove di bilanciamento sono ignorate (${guestTry})`);
const enter = async (p) => {
  await p.evaluate(() => { document.querySelector(".olLocal").open = true; });
  await p.fill("#olLocalCode", "PROVA");
  await p.click("#olLocalJoin");
  await p.waitForSelector("#lobby:not([hidden])");
};
await enter(A);
await enter(B);
await A.waitForTimeout(800);
const roleA = await A.evaluate(() => window.__faro.debug.match?.role);
const roleB = await B.evaluate(() => window.__faro.debug.match?.role);
ok(roleA === "host" && roleB === "guest", `ruoli: ${roleA} / ${roleB}`);
const nA = await A.evaluate(() => document.querySelectorAll("#lobbyBody .players li").length);
const nB = await B.evaluate(() => document.querySelectorAll("#lobbyBody .players li").length);
ok(nA === 2 && nB === 2, `entrambi vedono 2 giocatori (${nA}, ${nB})`);
// Prove di bilanciamento di chi ospita: devono valere anche per chi partecipa.
await A.evaluate(() => {
  const b = window.__faro.debug.adminApi.balance;
  b.setDraft("modes", { mode: "easy", field: "hpBp", value: 20000 });
  b.setDraft("towers", { kind: "balestra", lvl: "1", field: "damage", value: 3 });
});
const balB0 = await B.evaluate(() => JSON.stringify(window.__faro.debug.balance()));
await A.click("#lobbyStart");
await B.waitForFunction(() => window.__faro.debug.match?.status === "playing" && !window.__faro.state.sandbox, null, { timeout: 4000 });
ok(true, "la partita parte anche per chi partecipa");
const balA = await A.evaluate(() => JSON.stringify(window.__faro.debug.balance()));
const balB = await B.evaluate(() => JSON.stringify(window.__faro.debug.balance()));
ok(balB0 !== balA && balB === balA, `chi partecipa usa il bilanciamento di chi ospita (${balB0} → ${balB})`);
// Chi ospita costruisce, chi partecipa costruisce e migliora.
await A.evaluate(() => window.__faro.debug.send({ t: "build", kind: "balestra", cx: 2, cy: 2 }));
await B.evaluate(() => window.__faro.debug.send({ t: "build", kind: "mortaio", cx: 4, cy: 2 }));
await A.waitForTimeout(1500);
await B.evaluate(() => window.__faro.debug.send({ t: "skip" }));
await A.waitForTimeout(6000);
const towersA = await A.evaluate(() => window.__faro.state.towers.map((t) => t.kind).join(","));
const towersB = await B.evaluate(() => window.__faro.state.towers.map((t) => t.kind).join(","));
ok(towersA === "balestra,mortaio" && towersB === towersA, `torri uguali: ${towersA} / ${towersB}`);
await A.evaluate(() => window.__faro.debug.send({ t: "adminCash", amount: 777, to: 1 }));
await A.waitForTimeout(600);
// Ognuno il suo cash e le sue torri.
const own = await A.evaluate(() => window.__faro.state.towers.map((t) => `${t.kind}:${t.owner}`).join(","));
ok(own === "balestra:0,mortaio:1", `ogni torre ha il suo proprietario (${own})`);
const [cashA0, cashA1] = await A.evaluate(() => [window.__faro.state.cash, window.__faro.state.others[0].cash]);
ok(cashA1 - cashA0 === 677, `cash separati: Balestra 100 a chi ospita, Mortaio 200 e 777 di cash admin solo a chi partecipa (${cashA0} / ${cashA1})`);
const shownB = await B.evaluate(() => document.getElementById("cash").textContent.replace(/\D/g, ""));
ok(Number(shownB) === cashA1, `chi partecipa vede il suo cash (${shownB})`);
const balId = await A.evaluate(() => window.__faro.state.towers.find((t) => t.kind === "balestra").id);
await B.evaluate((id) => window.__faro.debug.send({ t: "sell", id }), balId);
await A.waitForTimeout(1200);
ok(await A.evaluate(() => window.__faro.state.towers.some((t) => t.kind === "balestra")), "chi partecipa non vende la torre di chi ospita");
// Pausa dell'host, poi confronto dell'impronta allo stesso tick.
await A.click("#pause");
await A.waitForTimeout(1500);
const [tA, hA] = await A.evaluate(() => [window.__faro.state.tick, window.__faro.hashState(window.__faro.state)]);
const [tB, hB] = await B.evaluate(() => [window.__faro.state.tick, window.__faro.hashState(window.__faro.state)]);
ok(tA === tB && tA > 40, `stesso tick (${tA}, ${tB})`);
ok(hA === hB, `stessa impronta (${hA}, ${hB})`);
ok(await B.evaluate(() => window.__faro.debug.match.desyncs === 0), "nessuna desincronizzazione");
// Un comando admin dal canale di chi partecipa viene rifiutato.
const cashBefore = await A.evaluate(() => window.__faro.state.cash);
await B.evaluate(() => window.__faro.debug.match.guestSubmit({ t: "adminCash", amount: 99999 }));
await A.click("#resume");
await A.waitForTimeout(1200);
const cashAfter = await A.evaluate(() => window.__faro.state.cash);
ok(cashAfter < cashBefore + 99999, "comando admin da chi partecipa ignorato");
// Pausa e velocità restano a chi ospita.
await B.click("#pause");
ok(await B.evaluate(() => document.getElementById("pauseLayer").hidden), "chi partecipa non mette in pausa");
// Riallineamento: si rompe lo stato di B e si chiede lo stato completo.
await B.evaluate(() => { window.__faro.state.cash += 5; });
await A.waitForTimeout(7000);
await A.click("#pause");
await A.waitForTimeout(1500);
const [t2A, h2A] = await A.evaluate(() => [window.__faro.state.tick, window.__faro.hashState(window.__faro.state)]);
const [t2B, h2B, ds] = await B.evaluate(() => [window.__faro.state.tick, window.__faro.hashState(window.__faro.state), window.__faro.debug.match.desyncs]);
ok(ds >= 1 && t2A === t2B && h2A === h2B, `desincronizzazione rilevata e riallineata (desync ${ds}, tick ${t2A}/${t2B})`);
await A.screenshot({ path: "dist/shots/40-coop-host.png" });
await B.screenshot({ path: "dist/shots/41-coop-guest.png" });
await B.evaluate(() => window.__faro.debug.match.onClosed("prova finita"));
await B.waitForTimeout(200);
const balBack = await B.evaluate(() => JSON.stringify(window.__faro.debug.balance()));
ok(balBack === balB0, `uscito dalla stanza, chi partecipa torna ai suoi valori (${balBack})`);
ok(errs.length === 0, `nessun errore di pagina ${errs.join(" | ")}`);
await b.close();
server.kill();
console.log(fails ? `${fails} prove fallite` : "Multigiocatore: tutte le prove superate");
process.exit(fails ? 1 : 0);
