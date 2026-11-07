// Misura memoria e tempo di calcolo: menu fermo, partita pesante, memoria dopo molte ondate.
import { createRequire } from "node:module";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const b = await chromium.launch({ args: ["--enable-precise-memory-info"] });
const vp = { width: Number(process.env.W ?? 1600), height: Number(process.env.H ?? 900) };
const page = await b.newPage({ viewport: vp, deviceScaleFactor: Number(process.env.DPR ?? 2) });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
await page.goto("file:///home/claude/ultimo-faro/dist/web/index.html");
if (process.env.GFX) { await page.evaluate((g) => localStorage.setItem("faro.gfx", g), process.env.GFX); await page.reload(); }
await page.waitForTimeout(1000);
const span = async (label, ms) => {
  const a = await metrics();
  await page.waitForTimeout(ms);
  const z = await metrics();
  const cpu = ((z.TaskDuration - a.TaskDuration) / (ms / 1000)) * 100;
  console.log(`${label.padEnd(28)} CPU ${cpu.toFixed(0).padStart(3)}%  script ${(((z.ScriptDuration - a.ScriptDuration) / (ms / 1000)) * 100).toFixed(0).padStart(3)}%  heap ${(z.JSHeapUsedSize / 1e6).toFixed(1)} MB`);
};
await span("menu fermo", 3000);
await page.evaluate(() => {
  const d = window.__faro.debug;
  d.restart(9, { mode: "hardcore", sandbox: true, level: "foce" });
  const cells = [];
  for (let cy = 0; cy < 9; cy++) for (let cx = 0; cx < 16; cx++) cells.push([cx, cy]);
  const kinds = ["mortaio", "bobina", "mitragliera", "cecchino", "soffio", "balestra"];
  let i = 0;
  for (const [cx, cy] of cells) d.send({ t: "build", kind: kinds[i++ % kinds.length], cx, cy });
  for (const t of window.__faro.state.towers) { d.send({ t: "upgrade", id: t.id }); d.send({ t: "upgrade", id: t.id }); }
  d.send({ t: "adminWave", wave: 40 });
  d.send({ t: "adminGod", on: true });
});
await page.waitForTimeout(3500);
await page.evaluate(() => window.__faro.debug.send({ t: "adminSpawn", enemy: "risacca", count: 200 }));
await span("partita pesante x1", 5000);
await page.evaluate(() => window.__faro.debug.adminApi.setSpeed(4));
await span("partita pesante x4", 5000);
const st = await page.evaluate(() => ({ enemies: window.__faro.state.enemies.length, towers: window.__faro.state.towers.length, canvas: [document.getElementById("map").width, document.getElementById("map").height] }));
console.log(JSON.stringify(st));
for (let k = 0; k < 3; k++) await span(`dopo altri 10 s (${k + 1})`, 10000);
await b.close();
