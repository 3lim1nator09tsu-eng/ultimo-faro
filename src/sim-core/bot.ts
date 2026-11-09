// Bot di collaudo: giocano la partita usando gli stessi comandi di una persona.
import { ABILITIES, ENEMIES, LevelDef, MAP_H, MAP_W, TILE, TOWERS, TowerKind, Branch } from "./content";
import { enemiesIn } from "./modes";
import { QTE } from "./twists";
import { Command, GameOptions, brazierMax, apexBlock, apexPrice, GameState, createGame, geometry, hashState, isBuildable, lanePoint, levelOf, rewardFor, starsFor, statsIn, step, towerStats, upgradePrice } from "./sim";

export type BotPolicy = "idle" | "balestreBase" | "soloSoffio" | "mirato";

// Copertura del percorso per casella, calcolata una volta per ogni gittata.
const coverCache = new Map<string, Array<{ cx: number; cy: number; cover: number }>>();
function coverage(level: LevelDef, range: number) {
  const key = `${level.id}:${range}`;
  let list = coverCache.get(key);
  if (list) return list;
  list = [];
  const geo = geometry(level);
  for (let cy = 0; cy < MAP_H; cy++) {
    for (let cx = 0; cx < MAP_W; cx++) {
      const x = cx * TILE + 500;
      const y = cy * TILE + 500;
      let cover = 0;
      geo.lengths.forEach((len, lane) => {
        for (let d = 0; d < len; d += 250) {
          const p = lanePoint(level, lane, d);
          const dx = p.x - x;
          const dy = p.y - y;
          if (dx * dx + dy * dy <= range * range) cover += 1;
        }
      });
      list.push({ cx, cy, cover });
    }
  }
  list.sort((a, b) => b.cover - a.cover || a.cy - b.cy || a.cx - b.cx);
  coverCache.set(key, list);
  return list;
}

function cellFor(state: GameState, kind: TowerKind): { cx: number; cy: number } | null {
  const stats = TOWERS[kind].levels[0];
  if (TOWERS[kind].family === "supporto") {
    // Il supporto va dove copre più torri d'attacco.
    let best: { cx: number; cy: number } | null = null;
    let bestN = -1;
    for (let cy = 0; cy < MAP_H; cy++) {
      for (let cx = 0; cx < MAP_W; cx++) {
        if (!isBuildable(state, cx, cy)) continue;
        const x = cx * TILE + 500;
        const y = cy * TILE + 500;
        let n = 0;
        for (const t of state.towers) {
          if (TOWERS[t.kind].family !== "attacco") continue;
          const dx = t.x - x;
          const dy = t.y - y;
          if (dx * dx + dy * dy <= stats.range * stats.range) n++;
        }
        if (n > bestN) {
          bestN = n;
          best = { cx, cy };
        }
      }
    }
    return best;
  }
  const list = coverage(levelOf(state), stats.range || 1);
  // L'Officina non spara: prende la casella peggiore, lasciando le migliori alle torri.
  const ordered = stats.range ? list : [...list].reverse();
  return ordered.find((c) => isBuildable(state, c.cx, c.cy)) ?? null;
}

function useAbilities(state: GameState): Command | null {
  if (state.phase !== "wave" || state.enemies.length === 0) return null;
  const lengths = geometry(levelOf(state)).lengths;
  const danger = state.enemies.some((e) => e.dist > lengths[e.lane] * 0.8);
  const stunned = state.towers.filter((t) => t.stun > 0).length;
  for (const t of state.towers) {
    if (t.abilityCd > 0 || t.stun > 0 || !statsIn(state, t).abilityCooldown) continue;
    if (t.kind === "medico" && stunned >= 2) return { t: "towerAbility", id: t.id };
    if (t.kind === "capitano" && state.enemies.length >= 10) return { t: "towerAbility", id: t.id };
  }
  if (state.abilityCd.gelata === 0 && (state.enemies.length >= 14 || danger)) return { t: "ability", id: "gelata" };
  if (state.abilityCd.fascio === 0 && state.enemies.length >= 6) {
    const r = ABILITIES.fascio.radius as number;
    let best = state.enemies[0];
    let bestN = -1;
    for (const a of state.enemies.slice(0, 60)) {
      let n = 0;
      for (const b of state.enemies) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy <= r * r) n++;
      }
      if (n > bestN) {
        bestN = n;
        best = a;
      }
    }
    return { t: "ability", id: "fascio", x: best.x, y: best.y };
  }
  return null;
}

export function decide(state: GameState, policy: BotPolicy): Command[] {
  if (policy === "idle") return [];
  if (state.phase !== "prep" && state.phase !== "wave") return [];

  const can = (k: TowerKind) => state.allowed.includes(k);
  const buy = (kind: TowerKind): Command | null => {
    if (!can(kind) || state.cash < TOWERS[kind].levels[0].cost) return null;
    const cell = cellFor(state, kind);
    return cell ? { t: "build", kind, cx: cell.cx, cy: cell.cy } : null;
  };

  if (policy === "balestreBase") {
    const c = buy("balestra");
    return c ? [c] : [];
  }
  if (policy === "soloSoffio") {
    const c = buy("soffio");
    return c ? [c] : [];
  }

  // "mirato": giocatore attento. Risponde alle scelte della modalità, usa le abilità, mescola torri.
  const twist = twistMoves(state);
  if (twist.length) return twist;
  // "mirato": giocatore attento. Usa le abilità, mescola torri e sale di livello quando conviene.
  const ability = useAbilities(state);
  if (ability) return [ability];
  // Kingpin: coda piena di Buttafuori (e un Portavalori), Taglia quando ci sono molti nemici.
  for (const t of state.towers) {
    if (t.kind !== "kingpin") continue;
    const st = statsIn(state, t);
    if (st.abilityCooldown && t.abilityCd === 0 && state.phase === "wave" && state.enemies.length >= 8) return [{ t: "towerAbility", id: t.id }];
    const slots = Math.min(4, st.queueSlots || 1);
    if (t.queue.length < slots) {
      const want = (st.unitSet & 4 ? ["buttafuori", "buttafuori", st.unitSet & 8 ? "sicario" : "buttafuori", "portavalori"] : ["scagnozzo", "portavalori", "scagnozzo", "scagnozzo"])[t.queue.length];
      if (st.unitSet & (1 << ["scagnozzo", "portavalori", "buttafuori", "sicario"].indexOf(want))) return [{ t: "queue", id: t.id, unit: want as "scagnozzo" }];
    }
    if (st.unitSet & 4 && t.queue[0] === "scagnozzo") return [{ t: "unqueue", id: t.id, index: 0 }];
  }
  const count = (k: TowerKind) => state.towers.filter((t) => t.kind === k).length;
  const kinds = enemiesIn(state.mode, levelOf(state), state.night);
  const saboteurs = kinds.has("sabotatore") || [...kinds].some((k) => ENEMIES[k].song || ENEMIES[k].deathFreeze);
  const hidden = [...kinds].some((k) => ENEMIES[k].hidden) || state.mode === "hardcore";
  const w = state.wave;
  const upto = (cap: number, v: number) => Math.min(cap, v);
  const wants: Array<[TowerKind, number]> = [
    ["kingpin", w >= 3 ? upto(TOWERS.kingpin.maxPerPlayer ?? 4, 1 + Math.floor(w / 8)) : 0],
    ["cecchino", hidden && w >= 2 ? upto(4, 2 + Math.floor(w / 8)) : 0],
    ["capitano", hidden && w >= 2 ? upto(3, 1 + Math.floor(w / 12)) : 0],
    ["medico", saboteurs && w >= 5 ? upto(3, 1 + Math.floor(w / 15)) : 0],
    ["capitano", w >= 5 ? upto(3, 1 + Math.floor(w / 15)) : 0],
    ["grammofono", w >= 6 ? upto(2, 1 + Math.floor(w / 20)) : 0],
    ["mitragliera", w >= 3 ? upto(5, 1 + Math.floor(w / 5)) : 0],
    ["arpione", w >= 4 ? upto(3, 1 + Math.floor(w / 15)) : 0],
    ["purificatore", w >= 4 ? upto(3, 1 + Math.floor(w / 7)) : 0],
    ["balestra", 2],
    ["officina", w >= 2 ? upto(2, 1 + Math.floor(w / 15)) : 0],
    ["mortaio", upto(6, 1 + Math.floor(w / 3))],
    ["bobina", w >= 2 ? upto(5, 1 + Math.floor(w / 4)) : 0],
    ["cecchino", w >= 3 ? upto(4, 1 + Math.floor(w / 5)) : 0],
    ["soffio", w >= 4 ? upto(3, 1 + Math.floor(w / 5)) : 0],
  ];
  // Nelle partite lunghe, prima di aggiungere torri si migliorano quelle che ci sono.
  const unfinished = state.towers.filter((t) => TOWERS[t.kind].family === "attacco" && t.level < 3).length;
  const growFirst = w >= 10 && unfinished >= 3;
  const pick: Record<TowerKind, Branch> = { balestra: "B", mortaio: "A", soffio: "B", cecchino: "B", bobina: "A", officina: "A", grammofono: "A", capitano: "B", medico: "B", arpione: "B", mitragliera: "B", purificatore: "A", cometa: "A", custode: "A", campana: "A", sledger: "A", executioner: "B", starcannon: "A", accelerator: "A", kingpin: (globalThis as { BOT_KP?: Branch }).BOT_KP ?? "B" };
  const ordered = [...state.towers].sort((a, b) => a.level - b.level || a.id - b.id);
  // Prima porta ogni torre almeno al livello 2: meglio poche torri forti che tante deboli.
  if (state.towers.length >= 3) {
    const weak = ordered.find((t) => t.level < 2 && TOWERS[t.kind].family === "attacco");
    if (weak) {
      const cost = upgradePrice(state, weak)!;
      return state.cash >= cost ? [{ t: "upgrade", id: weak.id }] : [];
    }
  }
  for (const [kind, n] of growFirst ? [] : wants) {
    if (!can(kind) || count(kind) >= n) continue;
    const c = buy(kind);
    return c ? [c] : [];
  }
  for (const t of ordered) {
    if (t.level === 4 && !apexBlock(state, t) && state.cash >= apexPrice(state, t)) return [{ t: "apex", id: t.id }];
  }
  for (const t of ordered) {
    const cost = upgradePrice(state, t);
    if (cost !== null && state.cash >= cost) return [{ t: "upgrade", id: t.id }];
    if (t.level === 3) {
      const branch = pick[t.kind];
      if (state.cash >= TOWERS[t.kind].branches[branch].cost) return [{ t: "spec", id: t.id, branch }];
    }
  }
  if (state.towers.length < (state.sandbox ? 60 : 30) && state.cash >= 300) {
    const c = buy(state.towers.length % 3 === 0 ? "mortaio" : can("bobina") ? "bobina" : "balestra");
    return c ? [c] : [];
  }
  return [];
}

export interface BotResult {
  policy: BotPolicy;
  seed: number;
  phase: string;
  wave: number;
  lives: number;
  stars: number;
  towers: number;
  ticks: number;
  reward: number;
  hash: string;
}

/** Scelte della modalità per il bot: risponde ai momenti rapidi dopo un secondo, sceglie offerte prudenti. */
function twistMoves(state: GameState): Command[] {
  const tw = state.tw;
  if (tw.qte && state.tick >= tw.qte.until - QTE.window + 10) {
    const q = tw.qte;
    return q.kind === "simbolo" ? [{ t: "qte", id: q.id, pick: q.answer }] : [0, 1, 2].map(() => ({ t: "qte", id: q.id, pick: -1 }) as Command);
  }
  const o = tw.offer;
  if (o && o.kind !== "contratto") {
    const pref = o.kind === "mercante" ? ["oro", "sconto", "vite", "taglie"] : o.kind === "reliquia" ? ["lama", "furia", "occhio", "vigore", "clessidra", "avidita"] : [];
    let pick = 0;
    for (const id of pref) {
      const i = o.options.indexOf(id);
      if (i >= 0) {
        pick = i;
        break;
      }
    }
    return [{ t: "choose", offer: o.id, pick }];
  }
  if (state.mode === "frost" && state.phase === "prep" && tw.braziers.length < brazierMax(state) && state.towers.length) {
    // Braciere vicino al centro delle torri non ancora scaldate.
    const geo = geometry(levelOf(state));
    const far = state.towers.filter((t) => !tw.braziers.some((k) => Math.abs((k % MAP_W) - t.cx) <= 3 && Math.abs(Math.floor(k / MAP_W) - t.cy) <= 3));
    if (!far.length) return [];
    const cx = Math.round(far.reduce((a, t) => a + t.cx, 0) / far.length);
    const cy = Math.round(far.reduce((a, t) => a + t.cy, 0) / far.length);
    let best: { cx: number; cy: number } | null = null;
    let bestD = 1e9;
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        if (geo.blocked.has(y * MAP_W + x) || tw.braziers.includes(y * MAP_W + x)) continue;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { cx: x, cy: y };
        }
      }
    return best ? [{ t: "brazier", cx: best.cx, cy: best.cy }] : [];
  }
  return [];
}

export function playBot(policy: BotPolicy, seed: number, maxTicks = 80000, log?: Array<[number, Command[]]>, opts: GameOptions = {}): BotResult {
  const state = createGame(seed, opts);
  while (state.phase !== "won" && state.phase !== "lost" && state.tick < maxTicks) {
    const commands = decide(state, policy);
    if (log && commands.length) log.push([state.tick, commands]);
    step(state, commands);
  }
  return {
    policy,
    seed,
    phase: state.phase,
    wave: state.wave,
    lives: state.lives,
    stars: starsFor(state.lives),
    towers: state.towers.length,
    ticks: state.tick,
    reward: rewardFor(state),
    hash: hashState(state),
  };
}

export { towerStats };
