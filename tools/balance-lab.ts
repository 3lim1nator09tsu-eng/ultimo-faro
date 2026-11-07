// Simula molte partite con i bot e stampa esiti, tempi e Schegge.
import { STARTER_TOWERS, TOWER_ORDER, TowerKind } from "../src/sim-core/content";
const ATTACK6: TowerKind[] = ["balestra", "mortaio", "soffio", "cecchino", "bobina", "officina"];
const SUPPORT6: TowerKind[] = ["balestra", "mortaio", "bobina", "cecchino", "capitano", "medico"];
import { BotPolicy, playBot } from "../src/sim-core/bot";
import { GameOptions } from "../src/sim-core/sim";

const runs = Number(process.argv[2] ?? 100);
const allRank = (r: number) => Object.fromEntries(TOWER_ORDER.map((k) => [k, r])) as Record<TowerKind, number>;
const setups: Array<[string, BotPolicy, GameOptions]> = [
  ["Porto, solo Balestre", "balestreBase", { allowed: STARTER_TOWERS }],
  ["Porto, 3 torri", "mirato", { allowed: STARTER_TOWERS }],
  ["Porto, 6 torri", "mirato", { allowed: ATTACK6 }],
  ["Foce, 3 torri", "mirato", { level: "foce", allowed: STARTER_TOWERS }],
  ["Foce, 6 attacco", "mirato", { level: "foce", allowed: ATTACK6 }],
  ["Foce, con supporto", "mirato", { level: "foce", allowed: SUPPORT6 }],
  ["Foce, supporto rango 3", "mirato", { level: "foce", allowed: SUPPORT6, ranks: allRank(3) }],
  ["Marea, 6 attacco", "mirato", { level: "marea", allowed: ATTACK6 }],
  ["Marea, con supporto", "mirato", { level: "marea", allowed: SUPPORT6 }],
  ["Marea, supporto rango 3", "mirato", { level: "marea", allowed: SUPPORT6, ranks: allRank(3) }],
  ["Hardcore Porto, rango 3", "mirato", { mode: "hardcore", allowed: ATTACK6, ranks: allRank(3) }],
  ["Hardcore Porto, HC rango 3", "mirato", { mode: "hardcore", allowed: ["balestra", "mortaio", "bobina", "mitragliera", "arpione", "purificatore"], ranks: allRank(3) }],
  ["Hardcore Porto, HC rango 5", "mirato", { mode: "hardcore", allowed: ["balestra", "mortaio", "bobina", "mitragliera", "arpione", "purificatore"], ranks: allRank(5) }],
  ["Hardcore Foce, HC rango 5", "mirato", { mode: "hardcore", level: "foce", allowed: ["balestra", "mortaio", "medico", "mitragliera", "arpione", "purificatore"], ranks: allRank(5) }],
  ["Infinita Foce, rango 3", "mirato", { mode: "infinita", level: "foce", allowed: SUPPORT6, ranks: allRank(3) }],
];
for (const [label, policy, opts] of setups) {
  let wins = 0;
  let waves = 0;
  let lives = 0;
  let ticks = 0;
  let reward = 0;
  const stars = [0, 0, 0, 0];
  for (let seed = 1; seed <= runs; seed++) {
    const r = playBot(policy, seed * 7919, 200000, undefined, opts);
    if (r.phase === "won") wins++;
    waves += r.wave;
    lives += r.phase === "won" ? r.lives : 0;
    ticks += r.ticks;
    reward += r.reward;
    stars[r.stars]++;
  }
  console.log(
    `${label.padEnd(26)} vittorie ${String(Math.round((wins / runs) * 100)).padStart(3)}%  ondata media ${(waves / runs).toFixed(1).padStart(4)}  vite se vince ${(wins ? lives / wins : 0).toFixed(1).padStart(4)}  stelle 0/1/2/3 ${stars.join("/").padEnd(12)} Schegge ${Math.round(reward / runs)}  durata ${(ticks / runs / 600).toFixed(1)} min`,
  );
}
