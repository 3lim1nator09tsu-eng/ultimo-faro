// Scelte del giocatore: puntamento delle torri e una meccanica propria per ogni modalità.
// Solo dati e testi: le regole stanno nella simulazione, così ogni dispositivo decide uguale.
import { Mod } from "./content";

// ---------- puntamento ----------

export type Aim = "first" | "last" | "strong" | "close" | "random";
export const AIMS: Aim[] = ["first", "last", "strong", "close", "random"];
export const AIM_NAMES: Record<Aim, string> = { first: "Primo", last: "Ultimo", strong: "Più forte", close: "Più vicino", random: "A caso" };
export const AIM_HELP: Record<Aim, string> = {
  first: "Il nemico più vicino al Faro",
  last: "Il nemico appena entrato",
  strong: "Quello con più vita",
  close: "Il più vicino alla torre",
  random: "Uno a caso nel raggio",
};

// ---------- offerte tra le ondate ----------

export type OfferKind = "mercante" | "contratto" | "reliquia" | "veleno";

export interface Offer {
  id: number;
  kind: OfferKind;
  options: string[]; // id delle voci; per il veleno l'indice nell'elenco POISONS
}

/** Easy: il Mercante passa ogni 5 ondate. */
export const MERCHANT: Record<string, { name: string; text: string }> = {
  oro: { name: "Sacco d'oro", text: "Cash subito per ogni giocatore" },
  sconto: { name: "Attrezzi buoni", text: "Torri e miglioramenti -25% per 2 ondate" },
  vite: { name: "Lanterne di scorta", text: "+3 vite" },
  taglie: { name: "Lista delle taglie", text: "Taglie +50% per 2 ondate" },
};
export const MERCHANT_IDS = Object.keys(MERCHANT);
export const merchantGold = (wave: number) => 120 + 15 * wave;

/** Medium: contratti per l'ondata successiva. Pagano solo se nessun nemico arriva al Faro. */
export const CONTRACTS: Record<string, { name: string; text: string; mods?: Mod[]; countBp?: number; noAbility?: boolean; rewardBp: number }> = {
  corazza: { name: "Corazze", text: "Tutti i nemici sono Corazzati", mods: ["corazzato"], rewardBp: 10000 },
  fretta: { name: "Di corsa", text: "Tutti i nemici sono Agili", mods: ["agile"], rewardBp: 10000 },
  orda: { name: "Orda", text: "Il 50% di nemici in più", countBp: 15000, rewardBp: 15000 },
  silenzio: { name: "Silenzio", text: "Niente abilità del Faro", noAbility: true, rewardBp: 8000 },
  scudi: { name: "Scudi", text: "Tutti i nemici sono Schermati", mods: ["schermato"], rewardBp: 12000 },
};
export const CONTRACT_IDS = Object.keys(CONTRACTS);
export const contractReward = (wave: number, bp: number) => Math.floor(((60 + 10 * wave) * bp) / 10000);

/** Fallen: reliquie dopo ogni mini-boss. Ognuna aiuta e costa. */
export const RELICS: Record<string, { name: string; good: string; bad: string }> = {
  lama: { name: "Lama del Re", good: "+20% danno a tutte le torri", bad: "Nemici +15% vita" },
  occhio: { name: "Occhio Vuoto", good: "Tutte le torri vedono gli invisibili", bad: "Gittata -15%" },
  avidita: { name: "Corona Avida", good: "+40% cash a fine ondata", bad: "-1 vita a fine ondata" },
  clessidra: { name: "Clessidra Rotta", good: "Abilità del Faro ricaricano il doppio più in fretta", bad: "Torri e miglioramenti +20%" },
  vigore: { name: "Cuore Caduto", good: "+6 vite subito", bad: "Nemici +10% velocità" },
  furia: { name: "Stendardo Nero", good: "Torri +20% cadenza", bad: "Boss +25% vita" },
};
export const RELIC_IDS = Object.keys(RELICS);

/** Hardcore: ogni 10 ondate scegli i modificatori del blocco successivo. */
export const POISONS: Mod[][] = [
  ["agile"], ["gonfio"], ["spettrale"], ["corazzato"], ["benedetto"], ["scisso"], ["provocatore"], ["schermato"],
  ["agile", "gonfio"], ["benedetto", "corazzato"], ["spettrale", "agile"], ["provocatore", "schermato"], ["scisso", "gonfio"],
];

// ---------- Campagna: ordini del Capitano ----------

export type Order = "difesa" | "assalto" | "economia";
export const ORDERS: Record<Order, { name: string; text: string }> = {
  difesa: { name: "Difesa", text: "Gittata +15%" },
  assalto: { name: "Assalto", text: "Cadenza +15%" },
  economia: { name: "Economia", text: "Premio d'ondata +50%, danno -10%" },
};
export const ORDER_IDS = Object.keys(ORDERS) as Order[];

// ---------- Molten e Frost ----------

export const LAVA = { cells: 6, damageBp: 14000, every: 3, stun: 60 };
export const BLIZZARD = { every: 4, radius: 3000, slowBp: 14000, braziers: 2, extraFrom: 20 };

// ---------- Cannone Stellare ----------

/** Si monta a pezzi dall'ondata 7, si carica con 3 stelle cadute, poi spara al nemico più grosso. */
export const STAR = { parts: 8, partCost: 150, from: 7, dropEvery: 120, dropLife: 100, cd: 600, charges: 3, bpOfMax: 1200, minDamage: 3000, splash: 1500, splashBp: 2500, stun: 30 };

// ---------- Fallen: onda nascosta ----------

/** Se il Re Caduto cade entro 45 secondi dalla sua comparsa, si risveglia. */
export const HIDDEN = { window: 450, hpMul: 3, schegge: 1500, perle: 25 };

// ---------- Notte 5: momenti rapidi ----------

export const QTE_SYMBOLS = ["Campana", "Stella", "Fiocco", "Albero", "Pacco", "Pupazzo"];
export const QTE = { window: 45, mash: 12, stun: 40, bossHitBp: 600, miniHitBp: 1500, failSummon: 4, failHaste: 60 };

export interface Qte {
  id: number;
  kind: "simbolo" | "raffica";
  symbols: number[]; // tre simboli mostrati
  answer: number; // indice in symbols
  got: number; // tocchi della raffica
  until: number; // tick di scadenza
  target: number; // id del nemico che l'ha provocato
}

export interface Twist {
  offer: Offer | null;
  contract: string; // contratto accettato per l'ondata in arrivo o in corso
  contractLeaks: number; // fughe all'inizio dell'ondata col contratto
  relics: string[];
  poison: number; // indice in POISONS per il blocco in corso, -1 nessuno
  order: Order | "";
  discountWaves: number;
  bountyWaves: number;
  lava: number[]; // caselle (cy * MAP_W + cx)
  braziers: number[];
  blizzard: boolean;
  qte: Qte | null;
  qteMarks: number; // bit delle soglie già usate (Krampus 75/50/25)
  qteWins: number;
  qteFails: number;
}

export const newTwist = (): Twist => ({
  offer: null,
  contract: "",
  contractLeaks: 0,
  relics: [],
  poison: -1,
  order: "",
  discountWaves: 0,
  bountyWaves: 0,
  lava: [],
  braziers: [],
  blizzard: false,
  qte: null,
  qteMarks: 0,
  qteWins: 0,
  qteFails: 0,
});
