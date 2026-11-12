// Scatti di una partita vera, per guardare modelli e animazioni in gioco.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const body = readFileSync("dist/ultimo-faro.html", "utf8");
const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>${body}</body></html>`;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1100, height: 620 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.route("**/*", (r) => (r.request().url().startsWith("https://fonts") ? r.abort() : r.continue()));
await page.setContent(html, { waitUntil: "load" });
await page.waitForFunction(() => window.__faro);
await page.locator("#mCampagna").click();
const mode = process.argv[2] ?? "easy";
const n = await page.evaluate((mode) => {
  const f = window.__faro;
  f.debug.restart(7, { mode, level: "porto", sandbox: true });
  const kinds = ["ingegnere", "pistolero", "piromante", "balestra", "mortaio", "soffio", "cecchino", "bobina", "officina", "grammofono", "capitano", "medico", "kingpin", "sledger", "executioner", "arpione", "mitragliera", "purificatore", "accelerator", "starcannon"];
  let i = 0;
  for (let cy = 0; cy < 9 && i < kinds.length; cy++) for (let cx = 1; cx < 15 && i < kinds.length; cx += 2) {
    const before = f.state.towers.length;
    f.debug.send({ t: "build", kind: kinds[i], cx, cy });
    if (f.state.towers.length > before) i++;
  }
  return f.state.towers.map((t) => t.kind).join(",");
}, mode);
console.log(n);
while (await page.locator("#dialog").isVisible()) await page.locator("#dialog").click();
await page.screenshot({ path: "dist/shots/90-revamp-prep.png" });
await page.click("#go");
  await page.evaluate(() => { const f = window.__faro; for (const k of ["risacca","corridore","bruto","tizzone","cavaliere","orso","spettro","elfo","pupazzetto","brinato","magmatico","zucchetta","lancia","araldo","annegato","krampus"]) f.debug.send({ t: "adminSpawn", enemy: k, count: 2, hpMulBp: 200000 }); });
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(Number(process.argv[3] ?? 5000));
  await page.screenshot({ path: `dist/shots/91-revamp-fight-${i}.png` });
}
console.log(errs.length ? errs.join(" | ") : "nessun errore");
await b.close();
