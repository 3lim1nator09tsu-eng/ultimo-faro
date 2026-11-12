// Il Piromante al lavoro, per guardare il getto di fiamme.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const body = readFileSync("dist/ultimo-faro.html", "utf8");
const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>${body}</body></html>`;
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1100, height: 620 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.route("**/*", (r) => (r.request().url().startsWith("https://fonts") ? r.abort() : r.continue()));
await page.setContent(html, { waitUntil: "load" });
await page.waitForFunction(() => window.__faro);
const spot = await page.evaluate(() => {
  const f = window.__faro;
  f.debug.restart(7, { mode: "easy", level: "porto", sandbox: true });
  for (const [cx, cy] of [[4, 2], [6, 6], [10, 4], [8, 2], [3, 5]]) f.debug.send({ t: "build", kind: "piromante", cx, cy });
  for (const t of f.state.towers) { f.debug.send({ t: "upgrade", id: t.id }); f.debug.send({ t: "upgrade", id: t.id }); }
  return f.state.towers.map((t) => [t.cx, t.cy]);
});
console.log(JSON.stringify(spot));
while (await page.locator("#dialog").isVisible()) await page.locator("#dialog").click();
await page.click("#go");
await page.evaluate(() => { const f = window.__faro; f.debug.send({ t: "adminSpawn", enemy: "bruto", count: 12, hpMulBp: 400000 }); });
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(i ? 130 : 5200);
  await page.screenshot({ path: `dist/shots/95-pyro-${i}.png`, clip: { x: 20, y: 60, width: 860, height: 500 } });
}
console.log(errs.length ? errs.join(" | ") : "nessun errore");
await b.close();
