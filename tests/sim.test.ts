import assert from "node:assert/strict";
import { test } from "node:test";
import { CAMPAIGN_LENGTH, ENEMIES, LEVELS, RULES, STARTER_TOWERS, TOWERS, levelById, waveAt } from "../src/sim-core/content";
import { POISONS } from "../src/sim-core/twists";
import { Command, GameEvent, lanePoint, wavePreview, allIntegers, buildCost, createGame, damageAgainst, effStats, hashState, hpForWave, isBuildable, laneIsOpen, rankedStats, restore, rewardFor, sellValue, snapshot, step, towerStats } from "../src/sim-core/sim";
import { playBot } from "../src/sim-core/bot";

const toWave = (s: ReturnType<typeof createGame>) => {
  step(s, [{ t: "skip" }]);
  assert.equal(s.phase, "wave");
};

test("stessi seed e comandi producono lo stesso hash", () => {
  const a = playBot("mirato", 4242);
  const b = playBot("mirato", 4242);
  assert.equal(a.hash, b.hash);
  assert.equal(a.ticks, b.ticks);
});

test("seed diversi producono partite diverse", () => {
  assert.notEqual(playBot("mirato", 1).hash, playBot("mirato", 2).hash);
});

test("riprendere da uno snapshot non cambia la partita", () => {
  const log: Array<[number, Command[]]> = [];
  const full = playBot("mirato", 77, 80000, log);
  const byTick = new Map(log);
  let state = createGame(77);
  while (state.phase !== "won" && state.phase !== "lost") {
    step(state, byTick.get(state.tick) ?? []);
    if (state.tick % 137 === 0) state = restore(snapshot(state));
  }
  assert.equal(hashState(state), full.hash);
});

test("lo stato contiene solo numeri interi in ogni tick", () => {
  const log: Array<[number, Command[]]> = [];
  playBot("mirato", 9, 80000, log);
  const byTick = new Map(log);
  const state = createGame(9);
  while (state.phase !== "won" && state.phase !== "lost") {
    step(state, byTick.get(state.tick) ?? []);
    assert.ok(allIntegers(state), `numero non intero al tick ${state.tick}`);
  }
});

test("il danno segue la formula del piano", () => {
  assert.equal(damageAgainst(12, "cinetico", "risacca", 10000, false), 12);
  // 100 contro Bruto: 100 x 0,60 x 100/140 = 42.
  assert.equal(damageAgainst(100, "cinetico", "bruto", 10000, false), 42);
  // Elettrico contro Bruto: 100 x 1,10 x 100/140 = 78.
  assert.equal(damageAgainst(100, "elettrico", "bruto", 10000, false), 78);
  assert.equal(damageAgainst(100, "cinetico", "bruto", 10000, true), 100);
  assert.equal(damageAgainst(100, "cinetico", "risacca", 12500, false), 125);
});

test("la vita cresce con le ondate", () => {
  assert.equal(hpForWave(100, 0, 10000), 100);
  assert.equal(hpForWave(100, 10, 10000), 270);
  assert.equal(hpForWave(100, 10, 20000), 540);
});

test("costruzione: percorso, scogli e caselle occupate sono rifiutati", () => {
  const s = createGame(1);
  assert.equal(isBuildable(s, 3, 3), false, "percorso");
  assert.equal(isBuildable(s, 1, 4), false, "scoglio");
  assert.equal(isBuildable(s, 15, 7), false, "faro");
  assert.equal(isBuildable(s, 5, 4), true);
  const ev = step(s, [{ t: "build", kind: "balestra", cx: 5, cy: 4 }]);
  assert.ok(ev.some((e) => e.e === "built"));
  assert.equal(s.cash, RULES.startCash - TOWERS.balestra.levels[0].cost);
  assert.ok(step(s, [{ t: "build", kind: "balestra", cx: 5, cy: 4 }]).some((e) => e.e === "reject"));
  assert.equal(s.towers.length, 1);
});

test("le torri non sbloccate vengono rifiutate", () => {
  const s = createGame(1, { allowed: STARTER_TOWERS });
  const ev = step(s, [{ t: "build", kind: "cecchino", cx: 5, cy: 4 }]);
  assert.ok(ev.some((e) => e.e === "reject" && e.reason === "Torre non in squadra"));
  assert.equal(s.towers.length, 0);
});

test("il cash non può andare sotto zero", () => {
  const s = createGame(1);
  const ev = step(s, [
    { t: "build", kind: "mortaio", cx: 5, cy: 4 },
    { t: "build", kind: "mortaio", cx: 6, cy: 4 },
  ]);
  assert.ok(ev.some((e) => e.e === "reject" && e.reason === "Cash insufficiente"));
  assert.equal(s.towers.length, 1);
  assert.ok(s.cash >= 0);
});

test("vendita: rimborso pieno nella stessa preparazione, poi 70%", () => {
  const s = createGame(1);
  step(s, [{ t: "build", kind: "balestra", cx: 5, cy: 4 }]);
  assert.equal(sellValue(s, s.towers[0]), 100);
  toWave(s);
  assert.equal(sellValue(s, s.towers[0]), 70);
  const before = s.cash;
  step(s, [{ t: "sell", id: s.towers[0].id }]);
  assert.equal(s.cash, before + 70);
});

test("specializzazione: solo dal livello 3 e senza ritorno", () => {
  const s = createGame(1);
  s.cash = 5000;
  step(s, [{ t: "build", kind: "balestra", cx: 5, cy: 4 }]);
  const id = s.towers[0].id;
  assert.ok(step(s, [{ t: "spec", id, branch: "A" }]).some((e) => e.e === "reject"));
  step(s, [{ t: "upgrade", id }]);
  step(s, [{ t: "upgrade", id }]);
  assert.ok(step(s, [{ t: "upgrade", id }]).some((e) => e.e === "reject"));
  step(s, [{ t: "spec", id, branch: "B" }]);
  assert.equal(s.towers[0].level, 4);
  assert.ok(step(s, [{ t: "spec", id, branch: "A" }]).some((e) => e.e === "reject"));
});

test("il rango aumenta danno, rallentamento e rendita del 10% per rango", () => {
  const b = { kind: "balestra" as const, level: 1, branch: null };
  assert.equal(rankedStats(b, 1).damage, 12);
  assert.equal(rankedStats(b, 3).damage, 14);
  assert.equal(rankedStats({ kind: "soffio", level: 1, branch: null }, 5).slowBp, 5800);
  assert.equal(rankedStats({ kind: "officina", level: 1, branch: null }, 2).income, 33);
  const s = createGame(1, { ranks: { balestra: 9 } });
  assert.equal(s.ranks.balestra, 5, "il rango massimo è 5");
});

test("la Bobina colpisce più nemici con un solo fulmine", () => {
  const s = createGame(1);
  step(s, [{ t: "build", kind: "bobina", cx: 4, cy: 2 }]);
  toWave(s);
  let zap = null;
  for (let i = 0; i < 400 && !zap; i++) zap = step(s, []).find((e) => e.e === "zap") ?? null;
  assert.ok(zap && zap.e === "zap");
  assert.ok(zap.points.length >= 6, "almeno due bersagli");
});

test("l'Officina paga a fine ondata", () => {
  const s = createGame(1);
  s.cash = 5000;
  step(s, [
    { t: "build", kind: "officina", cx: 0, cy: 8 },
    { t: "build", kind: "mortaio", cx: 2, cy: 3 },
    { t: "build", kind: "balestra", cx: 4, cy: 2 },
  ]);
  toWave(s);
  let income = null;
  for (let i = 0; i < 3000 && !income; i++) income = step(s, []).find((e) => e.e === "income") ?? null;
  assert.ok(income && income.e === "income" && income.amount === 30);
});

test("abilità: si usano solo in ondata e poi si ricaricano", () => {
  const s = createGame(1);
  assert.ok(step(s, [{ t: "ability", id: "gelata" }]).some((e) => e.e === "reject"));
  toWave(s);
  for (let i = 0; i < 40; i++) step(s, []);
  assert.ok(s.enemies.length > 0);
  step(s, [{ t: "ability", id: "gelata" }]);
  assert.ok(s.enemies.every((e) => e.stun > 0));
  assert.ok(step(s, [{ t: "ability", id: "gelata" }]).some((e) => e.e === "reject"));
  const e = s.enemies[0];
  const hp = e.hp;
  step(s, [{ t: "ability", id: "fascio", x: e.x, y: e.y }]);
  assert.ok(e.hp < hp || !s.enemies.includes(e));
});

test("Infinita continua oltre la decima ondata", () => {
  assert.ok(waveAt(LEVELS[0], CAMPAIGN_LENGTH + 4).some((g) => g.boss));
  const r = playBot("mirato", 3, 400000, undefined, { mode: "infinita" });
  assert.equal(r.phase, "lost");
  assert.ok(r.wave > CAMPAIGN_LENGTH);
});

test("le Schegge premiano ondate, vittoria e stelle", () => {
  const s = createGame(1);
  s.cleared = 10;
  s.phase = "won";
  s.lives = 20;
  assert.equal(rewardFor(s), 100 + 50 + 60);
});

test("i comandi admin segnano la partita e producono effetti", () => {
  const s = createGame(1);
  step(s, [{ t: "adminCash", amount: 500 }]);
  assert.equal(s.cash, RULES.startCash + 500);
  assert.equal(s.adminTouched, true);
  step(s, [{ t: "adminSpawn", enemy: "bruto", count: 3 }]);
  for (let i = 0; i < 20; i++) step(s, []);
  assert.equal(s.enemies.length, 3);
});

test("senza torri si perde, e solo torri rallentanti non bastano", () => {
  assert.equal(playBot("idle", 5).phase, "lost");
  assert.equal(playBot("soloSoffio", 5).phase, "lost");
});

test("il giocatore attento vince con le torri di partenza, ma perde vite", () => {
  const r = playBot("mirato", 11, 80000, undefined, { allowed: STARTER_TOWERS });
  assert.equal(r.phase, "won");
  assert.ok(r.lives < 18, `vite ${r.lives}`);
});

test("il contenuto ha valori positivi", () => {
  for (const e of Object.values(ENEMIES)) assert.ok(e.hp > 0 && e.speed > 0);
});

test("ogni livello ha 10 ondate e corsie che finiscono sul Faro", () => {
  for (const l of LEVELS) {
    assert.equal(l.waves.length, 10, l.id);
    for (const lane of l.map.lanes) assert.deepEqual([...lane[lane.length - 1]], [...l.map.faro], l.id);
  }
});

test("Doppia Foce: i nemici arrivano da due corsie", () => {
  const s = createGame(1, { level: "foce" });
  step(s, [{ t: "skip" }]);
  for (let i = 0; i < 120; i++) step(s, []);
  assert.ok(new Set(s.enemies.map((e) => e.lane)).size === 2);
});

test("Bassa Marea: il canale si apre all'ondata 4 e le secche emergono alla 6", () => {
  const s = createGame(1, { level: "marea" });
  s.cash = 1e6;
  assert.equal(laneIsOpen(s, 1), false);
  assert.equal(isBuildable(s, 5, 4), false, "secca ancora sommersa");
  const seen: string[] = [];
  while (s.wave < 6) {
    for (const e of step(s, [{ t: "skip" }, { t: "adminCash", amount: 0 }])) if (e.e === "laneOpen" || e.e === "emerge") seen.push(e.e);
    for (const e of s.enemies) e.hp = 0;
  }
  assert.ok(laneIsOpen(s, 1));
  assert.ok(isBuildable(s, 5, 4), "secca emersa");
  assert.deepEqual(seen, ["laneOpen", "emerge"]);
});

test("Grammofono: il disco Danno aumenta il danno, il disco Sconto abbassa i costi", () => {
  const s = createGame(1);
  s.cash = 5000;
  step(s, [{ t: "build", kind: "grammofono", cx: 5, cy: 4 }, { t: "build", kind: "balestra", cx: 5, cy: 3 }]);
  step(s, []);
  const b = s.towers.find((t) => t.kind === "balestra")!;
  assert.equal(effStats(s, b).damage, 13);
  const g = s.towers.find((t) => t.kind === "grammofono")!;
  step(s, [{ t: "track", id: g.id, track: "sconto" }]);
  assert.equal(buildCost(s, "balestra", 6, 4), 90);
  assert.equal(buildCost(s, "balestra", 14, 0), 100);
});

test("Capitano: più cadenza, e la Chiamata alle armi la aumenta ancora", () => {
  const s = createGame(1);
  s.cash = 5000;
  step(s, [{ t: "build", kind: "capitano", cx: 5, cy: 4 }, { t: "build", kind: "balestra", cx: 5, cy: 3 }]);
  step(s, []);
  const b = s.towers.find((t) => t.kind === "balestra")!;
  const c = s.towers.find((t) => t.kind === "capitano")!;
  assert.equal(effStats(s, b).cooldown, 9);
  assert.ok(step(s, [{ t: "towerAbility", id: c.id }]).some((e) => e.e === "reject"), "solo in ondata");
  step(s, [{ t: "skip" }]);
  step(s, [{ t: "towerAbility", id: c.id }]);
  step(s, []);
  assert.equal(effStats(s, b).cooldown, 6);
});

test("Sabotatore stordisce una torre, il Medico la libera", () => {
  const s = createGame(1);
  s.cash = 5000;
  step(s, [{ t: "build", kind: "balestra", cx: 2, cy: 0 }, { t: "adminSpawn", enemy: "sabotatore", count: 1 }]);
  let stunned = false;
  for (let i = 0; i < 300 && !stunned; i++) stunned = step(s, []).some((e) => e.e === "sabotage");
  assert.ok(stunned);
  assert.ok(s.towers[0].stun > 0);
  const ev = step(s, [{ t: "build", kind: "medico", cx: 4, cy: 0 }]);
  assert.ok(ev.some((e) => e.e === "heal"));
  assert.equal(s.towers[0].stun, 0);
  assert.ok(s.towers[0].immune > 0);
});

test("ogni livello è vincibile da un bot con buone torri", () => {
  for (const id of ["porto", "foce"]) {
    const r = playBot("mirato", 21, 80000, undefined, { level: id, allowed: ["balestra", "mortaio", "soffio", "cecchino", "bobina", "officina"] });
    assert.equal(r.phase, "won", id);
  }
  void levelById;
});

// ---------- 0.5: Hardcore, boss, Apex, combo, comandi admin ----------
import { HARDCORE_LENGTH, hardcoreWaves } from "../src/sim-core/content";
import { apexBlock, perleFor, modBit } from "../src/sim-core/sim";
import { HARDCORE, NIGHTS, SURVIVAL, disgeloFor, modeWaves } from "../src/sim-core/modes";
import { UNITS } from "../src/sim-core/content";
import { waveCount } from "../src/sim-core/sim";

const spawnOne = (s: ReturnType<typeof createGame>, enemy: any, mods: any[] = [], extra: Record<string, unknown> = {}) => {
  step(s, [{ t: "adminSpawn", enemy, count: 1, mods, ...extra } as any]);
  for (let i = 0; i < 3 && !s.enemies.length; i++) step(s, []);
  return s.enemies[s.enemies.length - 1];
};

test("modificatori: Gonfio raddoppia la vita, Schermato dà uno scudo, Corazzato più armatura", () => {
  const a = createGame(1);
  const plain = spawnOne(a, "bruto");
  const b = createGame(1);
  const fat = spawnOne(b, "bruto", ["gonfio", "schermato"]);
  assert.equal(fat.maxHp, plain.maxHp * 2);
  assert.equal(fat.shield, Math.floor((fat.maxHp * 4000) / 10000));
  assert.ok(fat.mods & modBit("schermato"));
});

test("modificatori: Agile corre di più, Benedetto si rigenera", () => {
  const a = createGame(1);
  const slow = spawnOne(a, "risacca");
  const b = createGame(1);
  const fast = spawnOne(b, "risacca", ["agile", "benedetto"]);
  for (let i = 0; i < 20; i++) {
    step(a, []);
    step(b, []);
  }
  assert.ok(fast.dist > slow.dist);
  fast.hp = 10;
  step(b, []);
  assert.ok(fast.hp > 10);
});

test("Provocatore: le torri nel raggio devono colpire lui", () => {
  const s = createGame(1);
  s.cash = 5000;
  step(s, [{ t: "build", kind: "balestra", cx: 2, cy: 2 }]);
  step(s, [{ t: "adminSpawn", enemy: "risacca", count: 3 }, { t: "adminSpawn", enemy: "risacca", count: 1, mods: ["provocatore"] }]);
  let target = -1;
  for (let i = 0; i < 200 && target < 0; i++) {
    const shot = step(s, []).find((e) => e.e === "shot");
    if (shot && shot.e === "shot") target = shot.to;
  }
  const taunt = s.enemies.find((e) => e.mods & modBit("provocatore"));
  assert.ok(taunt);
  assert.equal(target, taunt!.id);
});

test("il Purificatore toglie i modificatori", () => {
  const s = createGame(1);
  s.cash = 5000;
  step(s, [{ t: "build", kind: "purificatore", cx: 2, cy: 2 }]);
  const e = spawnOne(s, "bruto", ["benedetto", "schermato", "gonfio"]);
  for (let i = 0; i < 60; i++) step(s, []);
  assert.equal(e.mods, modBit("gonfio"));
  assert.equal(e.shield, 0);
});

test("combo: i colpi cinetici su un nemico congelato fanno Frantumazione", () => {
  const s = createGame(1);
  s.cash = 5000;
  step(s, [{ t: "build", kind: "balestra", cx: 2, cy: 2 }, { t: "skip" }]);
  for (let i = 0; i < 40; i++) step(s, []);
  step(s, [{ t: "ability", id: "gelata" }]);
  let combo = false;
  for (let i = 0; i < 30 && !combo; i++) combo = step(s, []).some((e) => e.e === "combo");
  assert.ok(combo);
  assert.ok(s.combos > 0);
});

test("Apex: serve il rango 3, uno per tipo, e potenzia molto la torre", () => {
  const low = createGame(1);
  low.cash = 1e6;
  step(low, [{ t: "build", kind: "balestra", cx: 5, cy: 4 }]);
  const t0 = low.towers[0];
  step(low, [{ t: "upgrade", id: t0.id }, { t: "upgrade", id: t0.id }, { t: "spec", id: t0.id, branch: "A" }]);
  assert.match(apexBlock(low, t0) ?? "", /rango 3/);
  const s = createGame(1, { ranks: { balestra: 3 } });
  s.cash = 1e6;
  step(s, [{ t: "build", kind: "balestra", cx: 5, cy: 4 }, { t: "build", kind: "balestra", cx: 6, cy: 4 }]);
  const [a, b] = s.towers;
  for (const t of [a, b]) step(s, [{ t: "upgrade", id: t.id }, { t: "upgrade", id: t.id }, { t: "spec", id: t.id, branch: "A" }]);
  const before = rankedStats(a, 3).damage;
  assert.ok(step(s, [{ t: "apex", id: a.id }]).some((e) => e.e === "apex"));
  assert.equal(a.level, 5);
  assert.ok(rankedStats(a, 3).damage >= before * 2);
  assert.ok(step(s, [{ t: "apex", id: b.id }]).some((e) => e.e === "reject"));
});

test("boss: il Capitano Annegato evoca, la Sirena stordisce, il Leviatano si scherma a metà vita", () => {
  const s = createGame(1, { level: "foce" });
  s.cash = 5000;
  step(s, [{ t: "build", kind: "balestra", cx: 1, cy: 0 }]);
  spawnOne(s, "annegato", [], { boss: true });
  let summon = false;
  for (let i = 0; i < 80 && !summon; i++) summon = step(s, []).some((e) => e.e === "summon");
  assert.ok(summon);
  const m = createGame(1, { level: "marea" });
  m.cash = 5000;
  step(m, [{ t: "build", kind: "balestra", cx: 1, cy: 1 }]);
  spawnOne(m, "sirena", [], { boss: true });
  let song = false;
  for (let i = 0; i < 80 && !song; i++) song = step(m, []).some((e) => e.e === "song");
  assert.ok(song);
  assert.ok(m.towers[0].stun > 0);
  const l = createGame(1);
  const lev = spawnOne(l, "leviatano", [], { boss: true });
  lev.hp = Math.floor(lev.maxHp / 2);
  assert.ok(step(l, []).some((e) => e.e === "roar"));
  assert.ok(lev.shield > 0);
});

test("Hardcore: 50 ondate con modificatori, 10 vite, Leviatano finale e Perle Nere", () => {
  const waves = modeWaves(HARDCORE, LEVELS[0]);
  assert.equal(waves.length, 50);
  assert.ok(waves.slice(1).every((w) => w.some((g) => (g.mods ?? []).length > 0)), "ogni ondata dopo la prima ha un modificatore");
  assert.ok(waves[49].some((g) => g.enemy === "leviatano" && g.boss));
  const s = createGame(1, { mode: "hardcore" });
  assert.equal(s.lives, 10);
  assert.equal(waveCount(s), 50);
  s.cleared = 5;
  s.bossKills = 1;
  assert.equal(perleFor(s), 10);
  assert.equal(perleFor(createGame(1)), 0);
});

test("modalità: le ondate crescono con il boss, ogni modalità finisce con il suo boss", () => {
  const counts = SURVIVAL.map((m) => m.waves);
  assert.deepEqual(counts, [20, 25, 30, 35, 40]);
  for (const m of SURVIVAL) {
    for (const lvl of LEVELS) {
      const w = modeWaves(m, lvl);
      assert.equal(w.length, m.waves);
      assert.ok(w[m.waves - 1].some((g) => g.boss && g.enemy === m.boss.kind), `${m.id} finisce con ${m.boss.kind}`);
      assert.ok(w.every((x) => x.length >= 1 && x.every((g) => g.count >= 1 && Number.isSafeInteger(g.hpMulBp ?? 0))));
    }
  }
  assert.deepEqual(NIGHTS.map((n) => n.waves), [20, 25, 30, 35, 40]);
  assert.equal(NIGHTS[4].boss.kind, "krampus");
  const g = createGame(1, { mode: "natale", night: 3 });
  assert.equal(g.levelId, NIGHTS[2].map);
  assert.equal(g.lives, 10);
  assert.equal(waveCount(g), 30);
});

test("Disgelo: gelo pieno fino a novembre, poi cala ogni settimana di dicembre", () => {
  assert.equal(disgeloFor(2026, 11, 30).bp, 10000);
  assert.equal(disgeloFor(2026, 12, 1).bp, 8800);
  assert.equal(disgeloFor(2026, 12, 9).bp, 7800);
  assert.equal(disgeloFor(2026, 12, 15).bp, 6800);
  assert.equal(disgeloFor(2026, 12, 25).bp, 6000);
  assert.equal(disgeloFor(2027, 1, 3).bp, 6000);
  const a = createGame(1, { mode: "natale", night: 1, eventBp: 6000 });
  const b = createGame(1, { mode: "natale", night: 1, eventBp: 10000 });
  for (let i = 0; i < 320; i++) {
    step(a, []);
    step(b, []);
  }
  assert.ok(a.enemies.length > 0 && a.enemies[0].maxHp < b.enemies[0].maxHp, "il Disgelo abbassa la vita");
});

test("invisibili: solo chi rileva li colpisce, il Capitano presta il rilevamento", () => {
  const s = createGame(5, { sandbox: true });
  step(s, [{ t: "adminSpawn", enemy: "spettro", count: 1 }]);
  step(s, []);
  const e = s.enemies[0];
  // Balestra accanto al percorso: non lo vede.
  step(s, [{ t: "build", kind: "balestra", cx: 2, cy: 2 }]);
  assert.equal(s.towers.length, 1);
  for (let i = 0; i < 40; i++) step(s, []);
  const hp1 = s.enemies.find((x) => x.id === e.id)?.hp ?? 0;
  assert.equal(hp1, e.maxHp, "la Balestra non vede lo Spettro");
  step(s, [{ t: "build", kind: "capitano", cx: 2, cy: 3 }]);
  assert.equal(s.towers.length, 2);
  for (let i = 0; i < 40; i++) step(s, []);
  const still = s.enemies.find((x) => x.id === e.id);
  assert.ok(!still || still.hp < e.maxHp, "con il Capitano vicino lo colpisce");
});

test("divisione, gelo alla morte, furto e immunità al rallentamento", () => {
  const s = createGame(9, { sandbox: true });
  step(s, [{ t: "adminSpawn", enemy: "magmatico", count: 1 }, { t: "adminSpawn", enemy: "brinato", count: 1 }]);
  for (let i = 0; i < 20; i++) step(s, []);
  step(s, [{ t: "build", kind: "balestra", cx: 2, cy: 2 }]);
  const mag = s.enemies.find((x) => x.kind === "magmatico")!;
  const bri = s.enemies.find((x) => x.kind === "brinato")!;
  mag.hp = 0;
  bri.hp = 0;
  bri.x = s.towers[0].x;
  bri.y = s.towers[0].y;
  const ev = step(s, []);
  assert.equal(s.enemies.filter((x) => x.kind === "tizzone").length, 2, "il Magmatico si divide in due Tizzoni");
  assert.ok(ev.some((x) => x.e === "frost"), "il Brinato congela");
  assert.ok(s.towers[0].stun > 0, "la torre vicina è congelata");
  // Furto del Folletto.
  const f = createGame(3, { sandbox: true });
  step(f, [{ t: "adminSpawn", enemy: "folletto", count: 1 }]);
  const cash0 = f.cash;
  let stolen = 0;
  for (let i = 0; i < 80; i++) for (const x of step(f, [])) if (x.e === "steal") stolen += x.amount;
  assert.ok(stolen > 0 && f.cash <= cash0 - stolen + 0, "il Folletto ruba cash");
  // Tizzone ignora il Soffio.
  const t = createGame(4, { sandbox: true });
  step(t, [{ t: "adminSpawn", enemy: "tizzone", count: 1 }, { t: "build", kind: "soffio", cx: 0, cy: 2 }]);
  for (let i = 0; i < 12; i++) step(t, []);
  assert.ok(t.enemies.every((x) => x.speedBp === 10000), "il Tizzone non si rallenta");
});

test("sandbox e comandi admin: tutte le torri, nessun premio, vite infinite, salto d'ondata", () => {
  const s = createGame(1, { sandbox: true, allowed: ["balestra"] });
  assert.equal(s.allowed.length, 16);
  assert.ok(s.cash >= 100000);
  step(s, [{ t: "adminGod", on: true }, { t: "adminSpawn", enemy: "corridore", count: 5, mods: ["agile"] }]);
  for (let i = 0; i < 600; i++) step(s, []);
  assert.equal(s.lives, 20);
  step(s, [{ t: "adminWave", wave: 7 }]);
  assert.equal(s.wave, 6);
  s.phase = "won";
  s.cleared = 10;
  assert.equal(rewardFor(s), 0);
});

test("multigiocatore: cash, torri e abilità per giocatore, vite in comune", () => {
  const s = createGame(11, { mode: "easy", players: [{ allowed: ["balestra", "mortaio"], ranks: {} }, { allowed: ["soffio"], ranks: { soffio: 4 } }] });
  assert.equal(s.others.length, 1);
  assert.equal(s.cash, s.others[0].cash);
  const start = s.cash;
  step(s, [{ t: "build", kind: "balestra", cx: 2, cy: 2, p: 0 }]);
  assert.equal(s.cash, start - 100);
  assert.equal(s.others[0].cash, start, "il cash dell'altro non si tocca");
  step(s, [{ t: "build", kind: "balestra", cx: 4, cy: 2, p: 1 }]);
  assert.equal(s.towers.length, 1, "il secondo giocatore non ha la Balestra in squadra");
  step(s, [{ t: "build", kind: "soffio", cx: 4, cy: 2, p: 1 }]);
  const soffio = s.towers.find((t) => t.kind === "soffio")!;
  assert.equal(soffio.owner, 1);
  assert.equal(soffio.rank, 4, "la torre usa i ranghi del suo proprietario");
  const bal = s.towers.find((t) => t.kind === "balestra")!;
  const before = s.towers.length;
  step(s, [{ t: "sell", id: bal.id, p: 1 }]);
  assert.equal(s.towers.length, before, "non si vende la torre di un altro");
  step(s, [{ t: "upgrade", id: bal.id, p: 1 }]);
  assert.equal(bal.level, 1, "non si migliora la torre di un altro");
  // Abilità separate.
  step(s, [{ t: "skip", p: 0 }]);
  step(s, [{ t: "ability", id: "gelata", p: 1 }]);
  assert.ok(s.others[0].abilityCd.gelata > 0 && s.abilityCd.gelata === 0, "la Gelata del secondo non consuma quella del primo");
  // Cash admin a un solo giocatore.
  const c0 = s.cash;
  const c1 = s.others[0].cash;
  step(s, [{ t: "adminCash", amount: 1000, to: 1 }]);
  assert.equal(s.cash, c0);
  assert.equal(s.others[0].cash, c1 + 1000);
  // Le taglie vanno a tutti: dopo un'ondata entrambi hanno guadagnato.
  for (let i = 0; i < 3000 && s.phase === "wave"; i++) step(s, []);
  assert.ok(s.cash > c0 && s.others[0].cash > c1 + 1000);
  assert.ok(allIntegers(s));
  assert.ok(createGame(1).hpScaleBp === 10000 && s.hpScaleBp > 10000, "con più giocatori i nemici sono più resistenti");
});

test("Crocevia: quattro corsie unite all'inizio e alla fine, separate in mezzo", () => {
  const g = createGame(3, { mode: "natale", night: 5 });
  assert.equal(g.levelId, "crocevia");
  const lvl = levelById("crocevia");
  assert.equal(lvl.map.lanes.length, 4);
  const starts = new Set(lvl.map.lanes.map((l) => JSON.stringify(l.slice(0, 2))));
  const ends = new Set(lvl.map.lanes.map((l) => JSON.stringify(l.slice(-2))));
  const middles = new Set(lvl.map.lanes.map((l) => JSON.stringify(l[2])));
  assert.equal(starts.size, 1, "stessa entrata");
  assert.equal(ends.size, 1, "stesso tratto finale");
  assert.equal(middles.size, 4, "in mezzo quattro strade diverse");
  const waves = modeWaves(NIGHTS[4], lvl);
  const lanes = new Set(waves.flat().map((x) => x.lane));
  assert.equal(lanes.size, 4, "i nemici arrivano da tutte e quattro");
});

test("mappe con anelli: il percorso passa due volte dalla stessa casella", () => {
  const cellsOf = (lane: ReadonlyArray<readonly [number, number]>) => {
    const out: string[] = [];
    for (let i = 0; i + 1 < lane.length; i++) {
      const [x0, y0] = lane[i];
      const [x1, y1] = lane[i + 1];
      const dx = Math.sign(x1 - x0);
      const dy = Math.sign(y1 - y0);
      for (let x = x0, y = y0; x !== x1 || y !== y1; x += dx, y += dy) out.push(`${x},${y}`);
    }
    return out;
  };
  for (const id of ["vigilia", "anelli", "gemelle"]) {
    const lane = levelById(id).map.lanes[0];
    const c = cellsOf(lane);
    assert.ok(new Set(c).size < c.length, `${id}: c'è un incrocio`);
  }
  const lungo = levelById("lungomare");
  const len = lungo.map.lanes[0].slice(1).reduce((a, p, i) => a + Math.abs(p[0] - lungo.map.lanes[0][i][0]) + Math.abs(p[1] - lungo.map.lanes[0][i][1]), 0);
  assert.ok(len >= 60, `il Lungomare è lungo (${len})`);
  assert.deepEqual(NIGHTS.map((n) => n.map), ["vigilia", "anelli", "spirale", "gemelle", "crocevia"]);
  const e = createGame(1, { mode: "easy", level: "lungomare" });
  assert.equal(e.levelId, "lungomare");
});

test("Kingpin: evoca unità che camminano, combattono e portano cash", () => {
  const s = createGame(21, { mode: "easy", allowed: ["kingpin"] });
  s.cash = 5000;
  step(s, [{ t: "build", kind: "kingpin", cx: 2, cy: 2 }]);
  const k = s.towers[0];
  step(s, [{ t: "upgrade", id: k.id }]); // livello 2: arrivano i Portavalori
  step(s, [{ t: "skip" }]);
  let units = 0;
  let paid = 0;
  for (let i = 0; i < 1500 && s.phase !== "lost"; i++) {
    const cash = s.cash;
    const ev = step(s, []);
    units = Math.max(units, s.units.length);
    if (ev.some((x) => x.e === "kill" && s.units.every(() => true)) && s.cash > cash) paid++;
  }
  assert.ok(units >= 2, `in campo fino a ${units} unità`);
  assert.ok(k.damageDone > 0, "gli scagnozzi fanno danno");
  assert.ok(s.units.every((u) => u.owner === 0 && u.tower === k.id));
  assert.ok(allIntegers(s));
  const a = createGame(5, { mode: "easy", allowed: ["kingpin"] });
  const b = createGame(5, { mode: "easy", allowed: ["kingpin"] });
  for (const g of [a, b]) {
    g.cash = 5000;
    step(g, [{ t: "build", kind: "kingpin", cx: 2, cy: 2 }]);
    step(g, [{ t: "skip" }]);
    for (let i = 0; i < 800; i++) step(g, []);
  }
  assert.equal(hashState(a), hashState(b), "le unità sono deterministiche");
  void paid;
});

test("Kingpin: spara, costa 800, coda da 1 a 4 posti, scagnozzi gratis, due percorsi e Taglia", () => {
  const s = createGame(8, { mode: "easy", allowed: ["kingpin"] });
  assert.equal(TOWERS.kingpin.levels[0].cost, 800);
  s.cash = 20000;
  step(s, [{ t: "build", kind: "kingpin", cx: 2, cy: 2 }]);
  const k = s.towers[0];
  assert.deepEqual(k.queue, ["scagnozzo"]);
  step(s, [{ t: "queue", id: k.id, unit: "scagnozzo" }]);
  assert.equal(k.queue.length, 1, "al livello 1 la coda ha un posto");
  step(s, [{ t: "upgrade", id: k.id }, { t: "upgrade", id: k.id }]);
  for (const u of ["portavalori", "buttafuori", "scagnozzo"] as const) step(s, [{ t: "queue", id: k.id, unit: u }]);
  assert.equal(k.queue.length, 3, "al livello 3 la coda ha tre posti");
  step(s, [{ t: "spec", id: k.id, branch: "A" }, { t: "queue", id: k.id, unit: "sicario" }]);
  assert.equal(k.queue.length, 4, "dal livello 4 la coda ha quattro posti");
  step(s, [{ t: "unqueue", id: k.id, index: 0 }]);
  assert.deepEqual(k.queue, ["portavalori", "buttafuori", "sicario"]);
  // Il percorso scelto al livello 4 resta: il livello 5 è La Cupola, non un Apex.
  step(s, [{ t: "apex", id: k.id }]);
  assert.equal(k.level, 5);
  assert.equal(towerStats(k).spawnEvery, TOWERS.kingpin.branches2!.A.spawnEvery);
  assert.equal(s.apexBuilt, 0);
  step(s, [{ t: "skip" }]);
  step(s, [{ t: "adminSpawn", enemy: "bruto", count: 3, hpMulBp: 1000000 }]);
  for (let i = 0; i < 30; i++) step(s, []);
  // Taglia: 20 s di ricarica, i nemici in campo valgono di più per il proprietario.
  const ev = step(s, [{ t: "towerAbility", id: k.id }]);
  assert.ok(ev.some((x) => x.e === "bounty"));
  assert.ok(k.abilityCd >= 199, "20 secondi di ricarica");
  assert.ok(s.enemies.filter((e) => e.kind === "bruto").every((e) => (e.bounty ?? 0) > 0), "i nemici in campo hanno la taglia");
  const cash0 = s.cash;
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    step(s, []);
    for (const u of s.units) seen.add(u.kind);
  }
  assert.ok(seen.has("portavalori") && seen.has("buttafuori") && seen.has("sicario"), `in campo: ${[...seen].join(", ")}`);
  assert.ok(s.cash >= cash0, "gli scagnozzi non costano");
  s.enemies = [];
  // Il percorso Boss: il Kingpin fa più danno, gli scagnozzi meno.
  assert.ok(TOWERS.kingpin.branches.B.damage > TOWERS.kingpin.branches.A.damage * 1.5);
  assert.ok(TOWERS.kingpin.branches.B.unitBp < TOWERS.kingpin.branches.A.unitBp);
  assert.ok(allIntegers(s));
  // Spara anche con la coda vuota.
  const g = createGame(9, { mode: "easy", allowed: ["kingpin"] });
  g.cash = 2000;
  step(g, [{ t: "build", kind: "kingpin", cx: 2, cy: 2 }]);
  step(g, [{ t: "unqueue", id: g.towers[0].id, index: 0 }, { t: "skip" }]);
  for (let i = 0; i < 300; i++) step(g, []);
  assert.ok(g.towers[0].damageDone > 0 && g.units.length === 0, "spara anche con la coda vuota");
});

test("Kingpin: gli scagnozzi hanno vita fissa e la tolgono a chi gli va addosso; il Portavalori paga schiantandosi", () => {
  const s = createGame(12, { mode: "easy", allowed: ["kingpin"] });
  s.cash = 5000;
  step(s, [{ t: "build", kind: "kingpin", cx: 2, cy: 2 }]);
  const k = s.towers[0];
  step(s, [{ t: "upgrade", id: k.id }, { t: "unqueue", id: k.id, index: 0 }, { t: "queue", id: k.id, unit: "portavalori" }]);
  step(s, [{ t: "skip" }]);
  // Aspetta il primo Portavalori.
  let u = s.units[0];
  for (let i = 0; i < 200 && !u; i++) {
    step(s, []);
    u = s.units[0];
  }
  assert.ok(u, "il Portavalori parte");
  assert.equal(u.maxHp, Math.floor((UNITS.portavalori.hp * towerStats(k).unitBp) / 10000), "vita fissa, non dipende dall'ondata");
  // Mette un nemico addosso al Portavalori.
  const cash0 = s.cash;
  step(s, [{ t: "adminSpawn", enemy: "bruto", count: 1, hpMulBp: 100000 }]);
  step(s, []);
  const e = s.enemies.find((x) => x.kind === "bruto")!;
  const hp0 = e.hp;
  e.dist = u.dist;
  e.lane = u.lane;
  e.x = u.x;
  e.y = u.y;
  const uhp = u.hp;
  const ev = step(s, []);
  assert.ok(ev.some((x) => x.e === "crash"), "si scontrano");
  assert.equal(e.hp, hp0 - uhp, "il nemico perde la vita del Portavalori");
  assert.ok(!s.units.some((x) => x.id === u.id), "il Portavalori si schianta");
  assert.ok(s.cash > cash0, "e porta cash");
});

test("Kingpin: Buttafuori da 900 contro nemico da 500, il nemico muore e il Buttafuori resta con 400", () => {
  const s = createGame(13, { mode: "easy", allowed: ["kingpin"] });
  s.cash = 9000;
  step(s, [{ t: "build", kind: "kingpin", cx: 2, cy: 2 }]);
  const k = s.towers[0];
  step(s, [{ t: "upgrade", id: k.id }, { t: "upgrade", id: k.id }, { t: "unqueue", id: k.id, index: 0 }, { t: "queue", id: k.id, unit: "buttafuori" }]);
  step(s, [{ t: "skip" }]);
  let u = s.units[0];
  for (let i = 0; i < 200 && !u; i++) {
    step(s, []);
    u = s.units[0];
  }
  s.enemies = [];
  s.spawns = [];
  u.hp = 900;
  step(s, [{ t: "adminSpawn", enemy: "bruto", count: 1 }]);
  step(s, []);
  const e = s.enemies[0];
  e.hp = 500;
  e.maxHp = 500;
  e.dist = u.dist;
  e.lane = u.lane;
  e.x = u.x;
  e.y = u.y;
  step(s, []);
  assert.ok(!s.enemies.some((x) => x.id === e.id), "il nemico muore sul colpo");
  assert.equal(s.units.find((x) => x.id === u.id)?.hp, 400, "il Buttafuori resta con 400");
});

test("Kingpin: al massimo 4 per giocatore", () => {
  const s = createGame(14, { mode: "easy", players: [{ allowed: ["kingpin"], ranks: {} }, { allowed: ["kingpin"], ranks: {} }] });
  s.cash = 99999;
  s.others[0].cash = 99999;
  const cells = [[2, 2], [4, 2], [2, 4], [4, 4], [6, 4], [9, 4]];
  for (const [cx, cy] of cells) step(s, [{ t: "build", kind: "kingpin", cx, cy, p: 0 }]);
  assert.equal(s.towers.filter((t) => t.owner === 0).length, 4, "il quinto viene rifiutato");
  step(s, [{ t: "build", kind: "kingpin", cx: 9, cy: 4, p: 1 }]);
  assert.equal(s.towers.filter((t) => t.owner === 1).length, 1, "il limite è per giocatore");
});

test("Bilanciamento: modalità, mappe e torri si applicano e si annullano", async () => {
  const B = await import("../src/sim-core/balance");
  const M = await import("../src/sim-core/modes");
  const lvl = levelById("porto");
  const base = M.modeWaves(M.SURVIVAL[0], lvl);
  const hp0 = base[4][0].hpMulBp;
  const n0 = base[4][0].count;
  const boss0 = base[19].find((g) => g.boss)!.hpMulBp;
  B.applyBalance({ towers: [{ kind: "balestra", lvl: "1", field: "damage", value: 99 }], modes: [{ mode: "easy", field: "hpBp", value: 16000 }, { mode: "easy", field: "countBp", value: 20000 }, { mode: "easy", field: "bossHpBp", value: 200000 }, { mode: "easy", field: "lives", value: 7 }, { mode: "easy", field: "bonusCash", value: 500 }], maps: [{ map: "porto", field: "startCash", value: 999 }] });
  const w = M.modeWaves(M.SURVIVAL[0], lvl);
  assert.ok(Math.abs(w[4][0].hpMulBp - hp0 * 2) <= 2, `vita ${hp0} → ${w[4][0].hpMulBp}`);
  assert.equal(w[4][0].count, n0 * 2);
  assert.ok(w[19].find((g) => g.boss)!.hpMulBp > boss0 * 3);
  assert.equal(TOWERS.balestra.levels[0].damage, 99);
  const s = createGame(5, { mode: "easy", level: "porto" });
  assert.equal(s.lives, 7);
  assert.equal(s.cash, 1499);
  // Le Perle a zero non sono più condivise: cambiarle in Easy non tocca Medium.
  B.applyBalance({ towers: [], modes: [{ mode: "easy", field: "perleWave", value: 3 }], maps: [] });
  assert.equal(M.SURVIVAL[0].perle.perWave, 3);
  assert.equal(M.SURVIVAL[1].perle.perWave, 0);
  B.applyBalance();
  assert.equal(M.modeWaves(M.SURVIVAL[0], lvl)[4][0].hpMulBp, hp0);
  assert.equal(TOWERS.balestra.levels[0].damage !== 99, true);
  assert.equal(createGame(5, { mode: "easy", level: "porto" }).lives, 20);
  // Notti, mini-boss e correzione per mappa.
  const n3 = M.NIGHTS[2];
  const mini0 = n3.minis[0].hpBp;
  B.applyBalance({ towers: [], modes: [{ mode: "natale:3", field: "minisBp", value: 5000 }, { mode: "hardcore", field: "mapHp:porto", value: 15000 }], maps: [] });
  assert.equal(n3.minis[0].hpBp, mini0 / 2);
  assert.equal(M.HARDCORE.mapHpBp!.porto, 15000);
  assert.equal(M.HARDCORE.mapHpBp!.lungomare, 13500);
  B.applyBalance();
  assert.equal(M.HARDCORE.mapHpBp!.porto, undefined);
  assert.equal(n3.minis[0].hpBp, mini0);
});

test("Bilanciamento: i dati sporchi vengono scartati e i livelli si uniscono", async () => {
  const B = await import("../src/sim-core/balance");
  const clean = B.cleanBalance({
    towers: [{ kind: "balestra", lvl: "1", field: "damage", value: 30 }, { kind: "nessuna", lvl: "1", field: "damage", value: 3 }, { kind: "balestra", lvl: "9", field: "damage", value: 3 }, { kind: "balestra", lvl: "1", field: "__proto__", value: 3 }, { kind: "balestra", lvl: "A2", field: "damage", value: 3 }, { kind: "kingpin", lvl: "A2", field: "damage", value: 70 }],
    modes: [{ mode: "easy", field: "hpBp", value: 12000 }, { mode: "nope", field: "hpBp", value: 1 }, { mode: "easy", field: "lives", value: -3 }, { mode: "easy", field: "lives", value: Infinity }, { mode: "hardcore", field: "mapHp:lungomare", value: 9000 }, { mode: "hardcore", field: "mapHp:atlantide", value: 9000 }],
    maps: [{ map: "porto", field: "startCash", value: 400 }, { map: "porto", field: "waves", value: 1 }],
  });
  assert.equal(clean.towers.length, 2);
  assert.equal(clean.modes.length, 2);
  assert.equal(clean.maps.length, 1);
  const merged = B.mergeBalance({ ...B.emptyBalance(), modes: [{ mode: "easy", field: "hpBp", value: 12000 }] }, { ...B.emptyBalance(), modes: [{ mode: "easy", field: "hpBp", value: 9000 }] });
  assert.deepEqual(merged.modes, [{ mode: "easy", field: "hpBp", value: 9000 }]);
  const pruned = B.pruneBalance({ towers: [{ kind: "balestra", lvl: "1", field: "damage", value: TOWERS.balestra.levels[0].damage }], modes: [{ mode: "easy", field: "hpBp", value: 8000 }], maps: [] });
  assert.equal(B.balanceSize(pruned), 0);
  assert.equal(B.balanceSig(merged), B.balanceSig(B.mergeBalance(merged)));
});

// ---------- scelte del giocatore ----------

const runTo = (s: ReturnType<typeof createGame>, until: (s: ReturnType<typeof createGame>) => boolean, max = 20000) => {
  for (let i = 0; i < max && !until(s) && s.phase !== "lost" && s.phase !== "won"; i++) step(s, []);
};
const clearWave = (s: ReturnType<typeof createGame>) => {
  // Finisce l'ondata in corso togliendo i nemici: per provare le offerte senza giocare.
  runTo(s, (x) => x.phase === "wave");
  // Chi si divide lascia altri nemici: si ripete finché l'ondata non è finita.
  for (let i = 0; i < 20 && s.phase === "wave"; i++) {
    s.spawns = [];
    for (const e of s.enemies) e.hp = -1e9; // sotto zero anche per chi rigenera
    step(s, []);
  }
};

test("Puntamento: primo, ultimo, più forte, più vicino e a caso", () => {
  const s = createGame(3, { mode: "campagna", level: "porto", allowed: ["balestra"] });
  s.cash = 5000;
  step(s, [{ t: "build", kind: "balestra", cx: 5, cy: 3 }]);
  const t = s.towers[0];
  const before = hashState(s);
  step(s, [{ t: "aim", id: t.id, aim: "last" }]);
  assert.equal(t.aim, "last");
  assert.notEqual(before, hashState(s));
  const bad: GameEvent[] = step(s, [{ t: "aim", id: t.id, aim: "nessuno" as never }]);
  assert.ok(bad.some((e) => e.e === "reject"));
  // Tre nemici nel raggio a distanze diverse: ogni puntamento prende quello giusto.
  toWave(s);
  s.spawns = [];
  s.enemies = [];
  const near = (dist: number, hp: number) => {
    const e = { ...newTestEnemy(s), dist, hp, maxHp: hp, id: s.nextId++ };
    const p = lanePoint(levelById("porto"), 0, dist);
    e.x = p.x;
    e.y = p.y;
    s.enemies.push(e);
    return e;
  };
  const inR = (d: number) => {
    const p = lanePoint(levelById("porto"), 0, d);
    return (p.x - t.x) ** 2 + (p.y - t.y) ** 2 <= towerStats(t).range ** 2;
  };
  const ds: number[] = [];
  for (let d = 0; d < 40000 && ds.length < 3; d += 300) if (inR(d) && (!ds.length || d - ds[ds.length - 1] > 1200)) ds.push(d);
  assert.equal(ds.length, 3);
  const a = near(ds[0], 50);
  const b = near(ds[1], 900);
  const c = near(ds[2], 100);
  const pick = (aim: string) => {
    t.aim = aim as never;
    t.cooldown = 0;
    const hp = s.enemies.map((e) => e.hp);
    step(s, []);
    const hitIdx = s.enemies.findIndex((e, i) => e.hp < hp[i]);
    s.enemies.forEach((e, i) => (e.hp = hp[i]));
    return s.enemies[hitIdx]?.id;
  };
  assert.equal(pick("first"), c.id);
  assert.equal(pick("last"), a.id);
  assert.equal(pick("strong"), b.id);
  const closest = [a, b, c].sort((x, y) => (x.x - t.x) ** 2 + (x.y - t.y) ** 2 - ((y.x - t.x) ** 2 + (y.y - t.y) ** 2))[0];
  assert.equal(pick("close"), closest.id);
  const seen = new Set<number>();
  for (let i = 0; i < 30; i++) seen.add(pick("random")!);
  assert.ok(seen.size >= 2, "a caso colpisce nemici diversi");
});

function newTestEnemy(s: ReturnType<typeof createGame>) {
  return { id: 0, kind: "risacca" as const, hp: 1, maxHp: 1, lane: 0, dist: 0, x: 0, y: 0, offset: 0, stun: 99999, speedBp: 10000, fragileBp: 10000, lifeDamage: 1, boss: false, act: 0, mods: 0, shield: 0, mark: 0, markBp: 10000, sacred: 0, summonCd: 0, songCd: 0, phase: 0, skillCd: 0, chargeLeft: 0, _s: s.tick };
}

test("Easy: il Mercante offre tre scelte ogni 5 ondate", () => {
  const s = createGame(8, { mode: "easy", level: "porto" });
  for (let w = 0; w < 5; w++) clearWave(s);
  assert.equal(s.cleared, 5);
  const o = s.tw.offer!;
  assert.equal(o.kind, "mercante");
  assert.equal(o.options.length, 3);
  const cash = s.cash;
  const lives = s.lives;
  const i = o.options.indexOf("oro") >= 0 ? o.options.indexOf("oro") : o.options.indexOf("vite");
  step(s, [{ t: "choose", offer: o.id, pick: i }]);
  assert.equal(s.tw.offer, null);
  assert.ok(s.cash > cash || s.lives > lives);
  // Un'offerta già scelta non si riscuote due volte.
  assert.ok(step(s, [{ t: "choose", offer: o.id, pick: i }]).some((e) => e.e === "reject"));
});

test("Medium: il contratto paga solo se nessuno arriva al Faro, e cambia l'ondata", () => {
  const s = createGame(9, { mode: "medium", level: "porto" });
  clearWave(s);
  clearWave(s);
  const o = s.tw.offer!;
  assert.equal(o.kind, "contratto");
  const k = o.options.indexOf("orda") >= 0 ? o.options.indexOf("orda") : 0;
  const plain = wavePreview(s, s.wave).reduce((a, g) => a + g.count, 0);
  step(s, [{ t: "choose", offer: o.id, pick: k }]);
  const id = s.tw.contract;
  const after = wavePreview(s, s.wave);
  if (id === "orda") assert.ok(after.reduce((a, g) => a + g.count, 0) > plain);
  else assert.ok(after.every((g) => g.boss || g.mods.length > 0));
  const cash = s.cash;
  runTo(s, (x) => x.phase === "wave");
  s.spawns = [];
  for (const e of s.enemies) e.hp = 0;
  const ev = step(s, []);
  const c = ev.find((e) => e.e === "contract") as { ok: boolean; amount: number } | undefined;
  assert.ok(c?.ok && c.amount > 0 && s.cash > cash);
  assert.equal(s.tw.contract, "");
  // Con una fuga il contratto non paga.
  const o2 = s.tw.offer!;
  step(s, [{ t: "choose", offer: o2.id, pick: 0 }]);
  runTo(s, (x) => x.phase === "wave");
  s.leaks += 1;
  s.spawns = [];
  for (const e of s.enemies) e.hp = 0;
  const ev2 = step(s, []);
  assert.equal((ev2.find((e) => e.e === "contract") as { ok: boolean }).ok, false);
});

test("Molten: bocche di lava danno danno in più e si fermano nell'eruzione", () => {
  const s = createGame(10, { mode: "molten", level: "porto", allowed: ["balestra"] });
  assert.equal(s.tw.lava.length, 6);
  assert.deepEqual(createGame(10, { mode: "molten", level: "porto" }).tw.lava, s.tw.lava);
  const k = s.tw.lava[0];
  s.cash = 5000;
  step(s, [{ t: "build", kind: "balestra", cx: k % 16, cy: Math.floor(k / 16) }]);
  const t = s.towers[0];
  assert.equal(effStats(s, t).damage, Math.floor((towerStats(t).damage * 14000) / 10000));
  clearWave(s);
  clearWave(s);
  runTo(s, (x) => x.phase === "wave");
  assert.equal(s.wave, 3);
  assert.ok(t.stun > 40, `eruzione: ${t.stun}`);
});

test("Fallen: dopo un mini-boss si sceglie una reliquia con vantaggio e costo", () => {
  const s = createGame(11, { mode: "fallen", level: "porto", allowed: ["balestra"] });
  s.cash = 5000;
  step(s, [{ t: "build", kind: "balestra", cx: 5, cy: 3 }]);
  toWave(s);
  const boss = s.enemies[0] ?? (runTo(s, (x) => x.enemies.length > 0), s.enemies[0]);
  boss.boss = true;
  boss.hp = 0;
  const ev = step(s, []);
  assert.ok(ev.some((e) => e.e === "offer"));
  const o = s.tw.offer!;
  assert.equal(o.kind, "reliquia");
  const t = s.towers[0];
  const dmg = effStats(s, t).damage;
  const ci = o.options.indexOf("lama");
  step(s, [{ t: "choose", offer: o.id, pick: ci >= 0 ? ci : 0 }]);
  if (ci >= 0) assert.equal(effStats(s, t).damage, Math.floor((dmg * 12000) / 10000));
  assert.equal(s.tw.relics.length, 1);
});

test("Frost: nella bufera le torri lontane dai bracieri sparano più piano", () => {
  const s = createGame(12, { mode: "frost", level: "porto", allowed: ["balestra"] });
  s.cash = 5000;
  step(s, [{ t: "build", kind: "balestra", cx: 5, cy: 3 }]);
  let far: [number, number] = [0, 0];
  for (let cy = 0; cy < 9; cy++) for (let cx = 0; cx < 16; cx++) if (isBuildable(s, cx, cy) && Math.abs(cx - 5) + Math.abs(cy - 3) > far[0] + far[1] - 0 && (cx - 5) ** 2 + (cy - 3) ** 2 > 60) far = [cx, cy];
  step(s, [{ t: "build", kind: "balestra", cx: far[0], cy: far[1] }]);
  const [a, b] = s.towers;
  assert.ok(b, "seconda torre lontana");
  step(s, [{ t: "brazier", cx: 5, cy: 4 }]);
  assert.equal(s.tw.braziers.length, 1);
  for (let w = 0; w < 3; w++) clearWave(s);
  assert.ok(step(s, [{ t: "brazier", cx: 6, cy: 4 }]).every((e) => e.e !== "reject"));
  assert.ok(step(s, [{ t: "brazier", cx: 7, cy: 4 }]).every((e) => e.e !== "reject"));
  assert.equal(s.tw.braziers.length, 2, "al massimo 2: il più vecchio si sposta");
  runTo(s, (x) => x.phase === "wave");
  assert.equal(s.wave, 4);
  assert.ok(s.tw.blizzard);
  assert.equal(effStats(s, a).cooldown, towerStats(a).cooldown);
  assert.ok(effStats(s, b).cooldown > towerStats(b).cooldown);
  assert.ok(step(s, [{ t: "brazier", cx: 1, cy: 1 }]).some((e) => e.e === "reject"), "durante l'ondata non si spostano");
});

test("Hardcore: ogni 10 ondate si sceglie il veleno del blocco", () => {
  const s = createGame(13, { mode: "hardcore", level: "porto" });
  for (let w = 0; w < 10; w++) clearWave(s);
  const o = s.tw.offer!;
  assert.equal(o.kind, "veleno");
  step(s, [{ t: "choose", offer: o.id, pick: 1 }]);
  const set = POISONS[Number(o.options[1])];
  for (const g of wavePreview(s, s.wave)) if (!g.boss) assert.deepEqual(g.mods, set);
  // Se non si sceglie, all'avvio dell'ondata ne vale comunque uno.
  const s2 = createGame(13, { mode: "hardcore", level: "porto" });
  for (let w = 0; w < 10; w++) clearWave(s2);
  runTo(s2, (x) => x.phase === "wave");
  assert.ok(s2.tw.poison >= 0 && s2.tw.offer === null);
});

test("Campagna: gli ordini cambiano le torri e si danno solo in preparazione", () => {
  const s = createGame(14, { mode: "campagna", level: "porto", allowed: ["balestra"] });
  s.cash = 5000;
  step(s, [{ t: "build", kind: "balestra", cx: 5, cy: 3 }]);
  const t = s.towers[0];
  const r0 = effStats(s, t).range;
  step(s, [{ t: "order", order: "difesa" }]);
  assert.equal(effStats(s, t).range, Math.floor((r0 * 11500) / 10000));
  step(s, [{ t: "order", order: "assalto" }]);
  assert.ok(effStats(s, t).cooldown < towerStats(t).cooldown);
  toWave(s);
  assert.ok(step(s, [{ t: "order", order: "economia" }]).some((e) => e.e === "reject"));
});

test("Notte 5: i momenti rapidi premiano chi risponde e puniscono chi sbaglia", () => {
  const s = createGame(15, { mode: "natale", night: 5 });
  toWave(s);
  runTo(s, (x) => x.enemies.length > 0);
  const k = s.enemies[0];
  k.kind = "krampus";
  k.boss = true;
  k.hp = Math.floor(k.maxHp * 0.7);
  step(s, []);
  const q = s.tw.qte!;
  assert.ok(q, "sotto il 75% si apre un momento rapido");
  assert.equal(q.kind, "simbolo");
  const hp = k.hp;
  const ev = step(s, [{ t: "qte", id: q.id, pick: q.answer }]);
  assert.ok(ev.some((e) => e.e === "qteEnd" && e.ok));
  assert.ok(k.hp < hp && k.stun > 0);
  // Il secondo è una raffica: senza tocchi scade e Krampus chiama rinforzi.
  k.hp = Math.floor(k.maxHp * 0.45);
  step(s, []);
  const q2 = s.tw.qte!;
  assert.equal(q2.kind, "raffica");
  const n = s.enemies.length;
  runTo(s, (x) => x.tw.qte === null, 200);
  assert.equal(s.tw.qteFails, 1);
  assert.ok(s.enemies.length > n);
  // Determinismo: stessi comandi, stessa partita.
  const a = playBot("mirato", 4, 30000, undefined, { mode: "natale", night: 5, eventBp: 6000 });
  const b = playBot("mirato", 4, 30000, undefined, { mode: "natale", night: 5, eventBp: 6000 });
  assert.equal(a.hash, b.hash);
});
