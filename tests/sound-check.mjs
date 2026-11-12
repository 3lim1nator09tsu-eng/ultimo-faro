// Collaudo dell'audio: parte senza errori, ogni effetto produce segnale, la musica segue la partita, niente saturazione.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const body = readFileSync("dist/ultimo-faro.html", "utf8");
const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>${body}</body></html>`;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 640 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/*", (r) => (r.request().url().startsWith("https://fonts") ? r.abort() : r.continue()));
await page.setContent(html, { waitUntil: "load" });
await page.waitForFunction(() => window.__faro);
await page.mouse.click(5, 5);
await page.evaluate(() => window.__faro.debug.sound.wake());
await page.waitForTimeout(600);
const d0 = await page.evaluate(() => window.__faro.debug.sound.debug());
ok(d0.running && d0.mode === "all" && d0.theme === "menu", `l'audio parte e nel menu suona il tema del menu: ${JSON.stringify(d0)}`);
// Ogni effetto, uno alla volta: deve uscire segnale, senza saturare.
await page.evaluate(() => window.__faro.debug.sound.setMode("fx"));
await page.waitForTimeout(900);
const names = await page.evaluate(() => Object.keys(window.__faro.debug.sfx).filter((k) => k !== "gun"));
const guns = ["balestra", "cecchino", "mitragliera", "kingpin", "pistolero", "arpione", "ingegnere", "accelerator", "cometa", "custode", "altro"];
const quiet = [], loud = [];
let top = 0;
for (const n of [...names, ...guns.map((g) => `gun:${g}`)]) {
  const peak = await page.evaluate(async (n) => {
    const f = window.__faro.debug;
    if (n.startsWith("gun:")) f.sfx.gun(n.slice(4));
    else f.sfx[n]();
    let peak = 0;
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 25));
      peak = Math.max(peak, f.sound.debug().peak);
    }
    await new Promise((r) => setTimeout(r, 260));
    return peak;
  }, n);
  top = Math.max(top, peak);
  if (peak < 0.004) quiet.push(`${n} ${peak.toFixed(4)}`);
  if (peak > 0.6) loud.push(`${n} ${peak.toFixed(2)}`);
}
ok(quiet.length === 0, `tutti i ${names.length + guns.length} effetti si sentono ${quiet.join(", ")}`);
ok(loud.length === 0, `nessun effetto è troppo forte (massimo ${top.toFixed(2)}) ${loud.join(", ")}`);
// Raffica di tutto insieme: il compressore tiene il livello sotto la saturazione.
const burst = await page.evaluate(async () => {
  const f = window.__faro.debug;
  let peak = 0;
  for (let i = 0; i < 30; i++) {
    for (const k of ["blast", "hammer", "zap", "thump", "kill", "coin"]) f.sfx[k]();
    for (const g of ["cecchino", "mitragliera", "kingpin", "pistolero"]) f.sfx.gun(g);
    await new Promise((r) => setTimeout(r, 60));
    peak = Math.max(peak, f.sound.debug().peak);
  }
  return peak;
});
ok(burst < 0.98, `in piena battaglia non satura (picco ${burst.toFixed(2)})`);
// Musica: tema della modalità, più spinta in ondata.
await page.evaluate(() => {
  const f = window.__faro.debug;
  f.sound.setMode("all");
  f.restart(5, { mode: "molten", level: "porto", sandbox: true });
});
await page.waitForTimeout(700);
while (await page.locator("#dialog").isVisible()) await page.locator("#dialog").click();
await page.waitForTimeout(600);
const m1 = await page.evaluate(() => window.__faro.debug.sound.debug());
ok(m1.theme === "molten" && m1.intensity === 0, `in partita suona il tema della modalità, calmo in preparazione: ${JSON.stringify(m1)}`);
await page.click("#go");
await page.waitForTimeout(1500);
const m2 = await page.evaluate(async () => {
  const f = window.__faro.debug;
  let peak = 0;
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 50)); peak = Math.max(peak, f.sound.debug().peak); }
  return { ...f.sound.debug(), peak };
});
ok(m2.intensity === 1 && m2.peak > 0.005 && m2.peak < 0.9, `durante l'ondata la musica spinge e si sente: ${JSON.stringify(m2)}`);
// Pulsante Audio: tutto → solo effetti → muto.
await page.click("#sound");
await page.waitForTimeout(150);
const t1 = await page.locator("#sound").textContent();
await page.click("#sound");
await page.waitForTimeout(600);
const t2 = await page.locator("#sound").textContent();
const muted = await page.evaluate(async () => {
  const f = window.__faro.debug;
  f.sfx.blast();
  let peak = 0;
  for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 40)); peak = Math.max(peak, f.sound.debug().peak); }
  return peak;
});
ok(t1 === "Solo effetti" && t2 === "Muto" && muted < 0.002, `il pulsante passa a "${t1}" e poi a "${t2}", e da muto tace (${muted.toFixed(4)})`);
ok(errors.length === 0, `nessun errore ${errors.join(" | ")}`);
await browser.close();
console.log(fails ? `${fails} prove fallite` : "Audio: tutte le prove superate");
process.exit(fails ? 1 : 0);
