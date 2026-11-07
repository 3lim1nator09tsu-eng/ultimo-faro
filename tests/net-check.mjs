// Collaudo del multigiocatore in lockstep: due pagine, canale locale, stesse partite.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
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
await A.click("#lobbyStart");
await B.waitForFunction(() => window.__faro.debug.match?.status === "playing" && !window.__faro.state.sandbox, null, { timeout: 4000 });
ok(true, "la partita parte anche per chi partecipa");
// Chi ospita costruisce, chi partecipa costruisce e migliora.
await A.evaluate(() => window.__faro.debug.send({ t: "build", kind: "balestra", cx: 2, cy: 2 }));
await B.evaluate(() => window.__faro.debug.send({ t: "build", kind: "mortaio", cx: 4, cy: 2 }));
await A.waitForTimeout(1500);
await B.evaluate(() => window.__faro.debug.send({ t: "skip" }));
await A.waitForTimeout(6000);
const towersA = await A.evaluate(() => window.__faro.state.towers.map((t) => t.kind).join(","));
const towersB = await B.evaluate(() => window.__faro.state.towers.map((t) => t.kind).join(","));
ok(towersA === "balestra,mortaio" && towersB === towersA, `torri uguali: ${towersA} / ${towersB}`);
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
ok(errs.length === 0, `nessun errore di pagina ${errs.join(" | ")}`);
await b.close();
server.kill();
console.log(fails ? `${fails} prove fallite` : "Multigiocatore: tutte le prove superate");
process.exit(fails ? 1 : 0);
