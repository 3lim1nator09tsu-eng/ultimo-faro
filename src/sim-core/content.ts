// Dati di gioco del prototipo. Solo numeri interi: 1 casella = 1000 unità, 1 tick = 100 ms.
// Le percentuali sono in punti base (10000 = 100%).

export const TILE = 1000;
export const TICKS_PER_SECOND = 10;
export const MAP_W = 16;
export const MAP_H = 9;

export type EnemyKind =
  | "risacca" | "corridore" | "bruto" | "sabotatore" | "annegato" | "sirena" | "leviatano"
  | "tizzone" | "magmatico" | "colosso"
  | "spettro" | "cavaliere" | "recaduto"
  | "brinato" | "orso" | "regina"
  | "elfo" | "pupazzetto" | "folletto" | "renna" | "pupazzo" | "befana" | "krampus";
export type TowerKind =
  | "balestra" | "mortaio" | "soffio" | "cecchino" | "bobina" | "officina" | "grammofono" | "capitano" | "medico" | "arpione" | "mitragliera" | "purificatore"
  | "custode" | "campana" | "cometa" | "kingpin";
export type Branch = "A" | "B";
export type EnemyClass = "carne" | "corazza" | "meccanico";
export type DamageType = "cinetico" | "gelo" | "elettrico" | "nessuno";
export type AbilityId = "fascio" | "gelata";
export type GameMode = "campagna" | "infinita" | "hardcore" | "easy" | "medium" | "molten" | "fallen" | "frost" | "natale";
export type Mod = "benedetto" | "gonfio" | "agile" | "provocatore" | "corazzato" | "schermato" | "spettrale" | "scisso";
export type Track = "danno" | "gittata" | "sconto";
export type Cell = readonly [number, number];

export interface EnemyDef {
  name: string;
  plural: string;
  cls: EnemyClass;
  hp: number;
  speed: number; // unità per tick
  armor: number;
  bounty: number;
  lifeDamage: number;
  sabotage?: { range: number; every: number; stun: number };
  // Comportamenti dei boss
  summon?: { kind: EnemyKind; count: number; every: number };
  song?: { range: number; every: number; stun: number };
  regenBp?: number; // vita recuperata per tick, in punti base della vita massima
  phaseShieldBp?: number; // a ogni soglia di vita: scudo e ruggito che stordisce le torri
  phases?: number[]; // soglie di vita in punti base (predefinita: metà vita)
  hidden?: boolean; // invisibile: lo colpiscono solo le torri che lo rilevano
  slowImmune?: boolean; // ignora il rallentamento (non lo stordimento)
  split?: { kind: EnemyKind; count: number }; // alla morte si divide
  deathFreeze?: { range: number; stun: number }; // alla morte congela le torri vicine
  steal?: { every: number; amount: number }; // ruba cash
  charge?: { every: number; ticks: number; speedBp: number }; // scatto periodico
}

// Modificatori dei nemici in Hardcore. I punti base sono per tick o una volta sola, come indicato.
export const MODS: Record<Mod, { name: string; summary: string; color: string }> = {
  benedetto: { name: "Benedetto", summary: "Recupera il 3% di vita al secondo: serve tanto danno", color: "#fff1b0" },
  gonfio: { name: "Gonfio", summary: "Vita doppia", color: "#9fd28b" },
  agile: { name: "Agile", summary: "35% più veloce", color: "#a5e4ec" },
  provocatore: { name: "Provocatore", summary: "Le torri vicine devono colpire lui", color: "#e2714f" },
  corazzato: { name: "Corazzato", summary: "+40 armatura", color: "#b9a88a" },
  schermato: { name: "Schermato", summary: "Scudo pari al 40% della vita", color: "#c9b8ff" },
  spettrale: { name: "Spettrale", summary: "Invisibile: lo colpisce solo chi rileva", color: "#d9d2ff" },
  scisso: { name: "Scisso", summary: "Quando cade si divide in due copie più deboli", color: "#ff9a9a" },
};
export const MOD_ORDER: Mod[] = ["benedetto", "gonfio", "agile", "provocatore", "corazzato", "schermato", "spettrale", "scisso"];
export const MOD_RULES = { regenBp: 30, armor: 40, speedBp: 13500, shieldBp: 4000 };

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  risacca: { name: "Risacca", plural: "Risacche", cls: "carne", hp: 42, speed: 95, armor: 0, bounty: 6, lifeDamage: 1 },
  corridore: { name: "Corridore", plural: "Corridori", cls: "carne", hp: 30, speed: 165, armor: 0, bounty: 5, lifeDamage: 1 },
  bruto: { name: "Bruto", plural: "Bruti", cls: "corazza", hp: 150, speed: 58, armor: 40, bounty: 20, lifeDamage: 3 },
  sabotatore: {
    name: "Sabotatore",
    plural: "Sabotatori",
    cls: "meccanico",
    hp: 90,
    speed: 78,
    armor: 10,
    bounty: 15,
    lifeDamage: 2,
    sabotage: { range: 2400, every: 70, stun: 40 },
  },
  annegato: {
    name: "Capitano Annegato",
    plural: "Capitani Annegati",
    cls: "corazza",
    hp: 150,
    speed: 48,
    armor: 30,
    bounty: 20,
    lifeDamage: 8,
    summon: { kind: "risacca", count: 3, every: 60 },
  },
  sirena: {
    name: "Sirena Cava",
    plural: "Sirene Cave",
    cls: "carne",
    hp: 150,
    speed: 55,
    armor: 10,
    bounty: 20,
    lifeDamage: 8,
    song: { range: 3000, every: 90, stun: 30 },
  },
  leviatano: {
    name: "Il Leviatano",
    plural: "Leviatani",
    cls: "corazza",
    hp: 150,
    speed: 38,
    armor: 50,
    bounty: 40,
    lifeDamage: 20,
    regenBp: 4,
    summon: { kind: "corridore", count: 4, every: 80 },
    song: { range: 3500, every: 120, stun: 30 },
    phaseShieldBp: 3000,
  },
  // ---- Molten ----
  tizzone: { name: "Tizzone", plural: "Tizzoni", cls: "carne", hp: 48, speed: 125, armor: 0, bounty: 6, lifeDamage: 1, slowImmune: true },
  magmatico: { name: "Magmatico", plural: "Magmatici", cls: "corazza", hp: 210, speed: 52, armor: 30, bounty: 22, lifeDamage: 3, split: { kind: "tizzone", count: 2 } },
  colosso: {
    name: "Colosso di Brace", plural: "Colossi di Brace", cls: "corazza", hp: 150, speed: 34, armor: 45, bounty: 40, lifeDamage: 15,
    slowImmune: true, summon: { kind: "magmatico", count: 1, every: 90 }, phases: [6600, 3300], phaseShieldBp: 2000,
  },
  // ---- Fallen ----
  spettro: { name: "Spettro", plural: "Spettri", cls: "carne", hp: 58, speed: 112, armor: 0, bounty: 9, lifeDamage: 1, hidden: true },
  cavaliere: { name: "Cavaliere Caduto", plural: "Cavalieri Caduti", cls: "corazza", hp: 250, speed: 55, armor: 55, bounty: 26, lifeDamage: 3 },
  recaduto: {
    name: "Re Caduto", plural: "Re Caduti", cls: "corazza", hp: 150, speed: 32, armor: 50, bounty: 50, lifeDamage: 20, regenBp: 2,
    summon: { kind: "cavaliere", count: 1, every: 120 }, song: { range: 3200, every: 140, stun: 30 }, phases: [7500, 5000, 2500], phaseShieldBp: 2000,
  },
  // ---- Frost ----
  brinato: { name: "Brinato", plural: "Brinati", cls: "corazza", hp: 115, speed: 66, armor: 20, bounty: 13, lifeDamage: 2, deathFreeze: { range: 1800, stun: 25 } },
  orso: { name: "Orso Bianco", plural: "Orsi Bianchi", cls: "carne", hp: 400, speed: 46, armor: 25, bounty: 32, lifeDamage: 4, slowImmune: true },
  regina: {
    name: "Regina dell'Inverno", plural: "Regine dell'Inverno", cls: "carne", hp: 150, speed: 31, armor: 40, bounty: 60, lifeDamage: 25, regenBp: 3,
    slowImmune: true, summon: { kind: "brinato", count: 3, every: 100 }, song: { range: 4500, every: 120, stun: 40 }, phases: [6600, 3300], phaseShieldBp: 3000,
  },
  // ---- Natale ----
  elfo: { name: "Elfo Corrotto", plural: "Elfi Corrotti", cls: "carne", hp: 44, speed: 145, armor: 0, bounty: 6, lifeDamage: 1 },
  pupazzetto: { name: "Pupazzetto", plural: "Pupazzetti", cls: "corazza", hp: 150, speed: 50, armor: 30, bounty: 14, lifeDamage: 2, deathFreeze: { range: 1400, stun: 15 } },
  folletto: {
    name: "Il Folletto Ladro", plural: "Folletti Ladri", cls: "carne", hp: 150, speed: 66, armor: 10, bounty: 40, lifeDamage: 12,
    steal: { every: 50, amount: 25 }, summon: { kind: "elfo", count: 3, every: 70 },
  },
  renna: {
    name: "La Renna Nera", plural: "Renne Nere", cls: "carne", hp: 150, speed: 56, armor: 20, bounty: 45, lifeDamage: 15,
    charge: { every: 80, ticks: 20, speedBp: 30000 }, summon: { kind: "elfo", count: 4, every: 90 },
  },
  pupazzo: {
    name: "Il Pupazzo Colossale", plural: "Pupazzi Colossali", cls: "corazza", hp: 150, speed: 29, armor: 40, bounty: 50, lifeDamage: 20,
    slowImmune: true, split: { kind: "pupazzetto", count: 6 }, phases: [5000], phaseShieldBp: 4000,
  },
  befana: {
    name: "La Befana", plural: "Befane", cls: "carne", hp: 150, speed: 44, armor: 20, bounty: 55, lifeDamage: 22, hidden: true, regenBp: 3,
    song: { range: 4000, every: 110, stun: 35 }, summon: { kind: "brinato", count: 2, every: 90 },
  },
  krampus: {
    name: "Krampus", plural: "Krampus", cls: "corazza", hp: 150, speed: 29, armor: 60, bounty: 80, lifeDamage: 40, regenBp: 4, slowImmune: true,
    summon: { kind: "orso", count: 1, every: 100 }, song: { range: 4500, every: 100, stun: 40 }, steal: { every: 60, amount: 40 },
    phases: [8000, 6000, 4000, 2000], phaseShieldBp: 2500,
  },
};

/** Nemici che fanno da boss (anche se compaiono come rinforzi). */
export const BOSS_KINDS: EnemyKind[] = ["annegato", "sirena", "leviatano", "colosso", "recaduto", "regina", "folletto", "renna", "pupazzo", "befana", "krampus"];

// Moltiplicatori di tipo, come nella tabella del piano.
export const TYPE_BP: Record<DamageType, Record<EnemyClass, number>> = {
  cinetico: { carne: 10000, corazza: 6000, meccanico: 9000 },
  gelo: { carne: 10000, corazza: 8000, meccanico: 11000 },
  elettrico: { carne: 9000, corazza: 11000, meccanico: 15000 },
  nessuno: { carne: 10000, corazza: 10000, meccanico: 10000 },
};
export const ARMOR_K = 100;
export const CHAIN_JUMP = 1600;

export type Targeting = "first" | "strong";

export interface TowerStats {
  damage: number;
  cooldown: number; // tick tra un colpo e l'altro; 0 = nessun attacco
  range: number;
  radius: number; // area del colpo; 0 = bersaglio singolo
  slowBp: number; // velocità residua dei nemici nell'aura; 10000 = nessun rallentamento
  fragileBp: number; // danno subito dai nemici nell'aura
  stunTicks: number;
  stunChanceBp: number;
  pierce: boolean;
  chains: number; // salti del fulmine dopo il primo bersaglio
  chainBp: number; // danno conservato a ogni salto
  income: number; // cash a fine ondata
  interestBp: number;
  interestCap: number;
  lifePerWave: number;
  // Torri di supporto
  auraBp: number; // forza del disco del Grammofono
  hasteBp: number; // cadenza in più data dal Capitano
  rangeBuffBp: number; // gittata in più data dal Capitano
  pulse: number; // tick tra una cura e l'altra del Medico
  immune: number; // tick di immunità dopo la cura
  abilityCooldown: number; // abilità della torre; 0 = nessuna
  abilityTicks: number;
  abilityBp: number;
  // Torri Hardcore
  markTicks: number; // marchio dell'Arpione
  markBp: number;
  markRadius: number;
  pulseAll: boolean; // colpisce tutti i nemici nel raggio
  purify: boolean; // toglie i modificatori nel raggio
  sacred: boolean; // blocca la rigenerazione
  bossBp: number; // danno contro i boss
  detect: boolean; // vede i nemici invisibili (Spettri, Elfi, la Befana)
  // Kingpin: unità evocate che camminano sul percorso
  spawnEvery: number; // tick tra un'evocazione e l'altra
  spawnMax: number; // unità in campo al massimo
  unitSet: number; // quali unità: un bit per voce di UNIT_ORDER
  unitBp: number; // forza delle unità
  queueSlots: number; // posti nella coda del Kingpin
}

export interface TowerLevel extends TowerStats {
  cost: number;
}

export interface BranchDef extends TowerLevel {
  name: string;
  summary: string;
}

export type Family = "attacco" | "economia" | "supporto";

export interface TowerDef {
  name: string;
  role: string;
  family: Family;
  damageType: DamageType;
  target: Targeting;
  unlock: number; // prezzo in Schegge; 0 = disponibile da subito
  ability?: { name: string; summary: string };
  perle?: number; // torre Hardcore: si compra con le Perle Nere
  exclusive?: "admin" | "evento"; // solo per gli admin, oppure premio dell'evento
  apex: string; // nome della torre al livello 6
  levels: TowerLevel[]; // livelli 1-3
  branches: Record<Branch, BranchDef>; // livello 4
  branches2?: Record<Branch, BranchDef>; // livello 5 per percorso, al posto dell'Apex (Kingpin)
}

const base: TowerStats = {
  damage: 0,
  cooldown: 0,
  range: 0,
  radius: 0,
  slowBp: 10000,
  fragileBp: 10000,
  stunTicks: 0,
  stunChanceBp: 0,
  pierce: false,
  chains: 0,
  chainBp: 7000,
  income: 0,
  interestBp: 0,
  interestCap: 0,
  lifePerWave: 0,
  auraBp: 0,
  hasteBp: 0,
  rangeBuffBp: 0,
  pulse: 0,
  immune: 0,
  abilityCooldown: 0,
  abilityTicks: 0,
  abilityBp: 0,
  markTicks: 0,
  markBp: 10000,
  markRadius: 0,
  pulseAll: false,
  purify: false,
  sacred: false,
  bossBp: 10000,
  detect: false,
  spawnEvery: 0,
  spawnMax: 0,
  unitSet: 0,
  unitBp: 10000,
  queueSlots: 0,
};

export const TOWERS = {
  balestra: {
    apex: "Balista Reale",
    name: "Balestra",
    role: "Colpi rapidi su un bersaglio",
    family: "attacco",
    damageType: "cinetico",
    target: "first",
    unlock: 0,
    levels: [
      { ...base, cost: 100, damage: 12, cooldown: 10, range: 3400 },
      { ...base, cost: 80, damage: 20, cooldown: 10, range: 3400 },
      { ...base, cost: 150, damage: 32, cooldown: 9, range: 3800 },
    ],
    branches: {
      A: { ...base, name: "Raffica", summary: "Spara al doppio della velocità", cost: 260, damage: 28, cooldown: 4, range: 3800 },
      B: { ...base, name: "Dardo perforante", summary: "Ignora l'armatura dei Bruti", cost: 280, damage: 75, cooldown: 11, range: 4400, pierce: true },
    },
  },
  mortaio: {
    apex: "Bombarda del Faro",
    name: "Mortaio",
    role: "Colpi lenti ad area",
    family: "attacco",
    damageType: "cinetico",
    target: "first",
    unlock: 0,
    levels: [
      { ...base, cost: 200, damage: 30, cooldown: 28, range: 4200, radius: 1000 },
      { ...base, cost: 150, damage: 52, cooldown: 28, range: 4200, radius: 1000 },
      { ...base, cost: 250, damage: 85, cooldown: 26, range: 4600, radius: 1200 },
    ],
    branches: {
      A: { ...base, name: "Grappolo", summary: "Esplosione molto più ampia", cost: 380, damage: 110, cooldown: 26, range: 4600, radius: 1800 },
      B: { ...base, name: "Concussione", summary: "Può stordire chi viene colpito", cost: 360, damage: 120, cooldown: 26, range: 4600, radius: 1200, stunTicks: 10, stunChanceBp: 5000 },
    },
  },
  soffio: {
    apex: "Inverno Eterno",
    name: "Soffio",
    role: "Rallenta i nemici vicini",
    family: "attacco",
    damageType: "gelo",
    target: "first",
    unlock: 0,
    levels: [
      { ...base, cost: 150, range: 2400, slowBp: 7000 },
      { ...base, cost: 120, range: 2600, slowBp: 6200 },
      { ...base, cost: 200, range: 3000, slowBp: 5500 },
    ],
    branches: {
      A: { ...base, name: "Aura ampia", summary: "Rallenta da molto più lontano", cost: 300, range: 4200, slowBp: 5500 },
      B: { ...base, name: "Fragilità", summary: "I nemici nell'aura subiscono +25% di danno", cost: 320, range: 3000, slowBp: 6000, fragileBp: 12500 },
    },
  },
  cecchino: {
    apex: "Occhio del Faro",
    name: "Cecchino",
    role: "Colpisce il più forte, da lontano. Vede gli invisibili",
    family: "attacco",
    damageType: "cinetico",
    target: "strong",
    unlock: 150,
    levels: [
      { ...base, cost: 175, damage: 55, cooldown: 24, range: 6000 },
      { ...base, cost: 130, damage: 85, cooldown: 23, range: 6500 },
      { ...base, cost: 220, damage: 135, cooldown: 22, range: 7000 },
    ],
    branches: {
      A: { ...base, name: "Colpo pesante", summary: "Colpi enormi, ancora più lenti", cost: 340, damage: 300, cooldown: 28, range: 7500 },
      B: { ...base, name: "Spezza-corazza", summary: "Ignora l'armatura e spara più spesso", cost: 320, damage: 150, cooldown: 16, range: 7000, pierce: true },
    },
  },
  bobina: {
    apex: "Tempesta Viva",
    name: "Bobina",
    role: "Fulmine che salta tra i nemici",
    family: "attacco",
    damageType: "elettrico",
    target: "first",
    unlock: 200,
    levels: [
      { ...base, cost: 160, damage: 16, cooldown: 12, range: 3000, chains: 3 },
      { ...base, cost: 120, damage: 24, cooldown: 12, range: 3000, chains: 4 },
      { ...base, cost: 200, damage: 34, cooldown: 11, range: 3300, chains: 5 },
    ],
    branches: {
      A: { ...base, name: "Catena lunga", summary: "Il fulmine salta su 10 nemici", cost: 320, damage: 40, cooldown: 11, range: 3300, chains: 10, chainBp: 8500 },
      B: { ...base, name: "Sovraccarico", summary: "Ogni salto può stordire", cost: 340, damage: 50, cooldown: 11, range: 3300, chains: 5, stunTicks: 6, stunChanceBp: 3500 },
    },
  },
  officina: {
    apex: "Cantiere Reale",
    name: "Officina",
    role: "Cash a fine ondata",
    family: "economia",
    damageType: "nessuno",
    target: "first",
    unlock: 250,
    levels: [
      { ...base, cost: 175, income: 30 },
      { ...base, cost: 140, income: 50 },
      { ...base, cost: 200, income: 75 },
    ],
    branches: {
      A: { ...base, name: "Interessi", summary: "+6% del cash a fine ondata, fino a 150", cost: 350, income: 75, interestBp: 600, interestCap: 150 },
      B: { ...base, name: "Riparazioni", summary: "+1 vita a fine ondata, fino a 20", cost: 300, income: 60, lifePerWave: 1 },
    },
  },
  grammofono: {
    apex: "Orchestra di Bordo",
    name: "Grammofono",
    role: "Il DJ: un disco per danno, gittata o sconto",
    family: "supporto",
    damageType: "nessuno",
    target: "first",
    unlock: 300,
    levels: [
      { ...base, cost: 200, range: 2500, auraBp: 1000 },
      { ...base, cost: 160, range: 2800, auraBp: 1500 },
      { ...base, cost: 240, range: 3200, auraBp: 2000 },
    ],
    branches: {
      A: { ...base, name: "Remix", summary: "Il disco vale il 30%", cost: 380, range: 3200, auraBp: 3000 },
      B: { ...base, name: "Casse potenti", summary: "Arriva molto più lontano", cost: 360, range: 4600, auraBp: 2000 },
    },
  },
  capitano: {
    apex: "Ammiraglio",
    name: "Capitano",
    role: "Più cadenza alle torri vicine, e le fa vedere gli invisibili",
    family: "supporto",
    damageType: "nessuno",
    target: "first",
    unlock: 350,
    ability: { name: "Chiamata alle armi", summary: "+50% di cadenza per 10 s nell'area" },
    levels: [
      { ...base, cost: 225, range: 2500, hasteBp: 1000, abilityCooldown: 450, abilityTicks: 100, abilityBp: 5000 },
      { ...base, cost: 175, range: 2800, hasteBp: 1500, abilityCooldown: 450, abilityTicks: 100, abilityBp: 5000 },
      { ...base, cost: 250, range: 3200, hasteBp: 2000, abilityCooldown: 420, abilityTicks: 100, abilityBp: 5000 },
    ],
    branches: {
      A: { ...base, name: "Chiamata lunga", summary: "La Chiamata alle armi dura 18 s", cost: 380, range: 3200, hasteBp: 2000, abilityCooldown: 420, abilityTicks: 180, abilityBp: 6000 },
      B: { ...base, name: "Stendardo", summary: "+25% cadenza e +15% gittata sempre", cost: 400, range: 3400, hasteBp: 2500, rangeBuffBp: 1500, abilityCooldown: 420, abilityTicks: 100, abilityBp: 5000 },
    },
  },
  medico: {
    apex: "Primario",
    name: "Medico",
    role: "Libera le torri stordite dai Sabotatori",
    family: "supporto",
    damageType: "nessuno",
    target: "first",
    unlock: 200,
    ability: { name: "Cura totale", summary: "Libera ogni torre della mappa e la protegge per 6 s" },
    levels: [
      { ...base, cost: 150, range: 2500, pulse: 40, immune: 20, abilityCooldown: 600, abilityTicks: 60 },
      { ...base, cost: 120, range: 3000, pulse: 30, immune: 30, abilityCooldown: 600, abilityTicks: 60 },
      { ...base, cost: 180, range: 3500, pulse: 25, immune: 40, abilityCooldown: 550, abilityTicks: 60 },
    ],
    branches: {
      A: { ...base, name: "Vaccino", summary: "Le torri curate restano protette 12 s", cost: 300, range: 3500, pulse: 25, immune: 120, abilityCooldown: 550, abilityTicks: 90 },
      B: { ...base, name: "Primo soccorso", summary: "Cura ogni secondo, da più lontano", cost: 280, range: 4500, pulse: 10, immune: 30, abilityCooldown: 550, abilityTicks: 60 },
    },
  },
} as Record<TowerKind, TowerDef>;

TOWERS.arpione = {
  apex: "Baleniera",
  name: "Arpione",
  role: "Marchia il più forte: subisce +30% di danno",
  family: "attacco",
  damageType: "cinetico",
  target: "strong",
  unlock: 0,
  perle: 30,
  levels: [
    { ...base, cost: 250, damage: 110, cooldown: 30, range: 5000, pierce: true, markTicks: 30, markBp: 13000 },
    { ...base, cost: 180, damage: 170, cooldown: 30, range: 5300, pierce: true, markTicks: 35, markBp: 13000 },
    { ...base, cost: 260, damage: 250, cooldown: 28, range: 5600, pierce: true, markTicks: 40, markBp: 13500 },
  ],
  branches: {
    A: { ...base, name: "Arpione a catena", summary: "Marchia anche i nemici vicini", cost: 420, damage: 280, cooldown: 28, range: 5600, pierce: true, markTicks: 45, markBp: 13500, markRadius: 1500 },
    B: { ...base, name: "Fiocina pesante", summary: "Colpo enorme, doppio sui boss", cost: 450, damage: 600, cooldown: 36, range: 6000, pierce: true, markTicks: 40, markBp: 13500, bossBp: 20000 },
  },
};
TOWERS.mitragliera = {
  apex: "Tempesta di Piombo",
  name: "Mitragliera",
  role: "Tantissimi colpi: il danno che serve contro i Benedetti",
  family: "attacco",
  damageType: "cinetico",
  target: "first",
  unlock: 0,
  perle: 45,
  levels: [
    { ...base, cost: 275, damage: 8, cooldown: 2, range: 3200 },
    { ...base, cost: 200, damage: 12, cooldown: 2, range: 3200 },
    { ...base, cost: 300, damage: 17, cooldown: 2, range: 3500 },
  ],
  branches: {
    A: { ...base, name: "Canne rotanti", summary: "Spara a ogni tick", cost: 480, damage: 16, cooldown: 1, range: 3500 },
    B: { ...base, name: "Proiettili sacri", summary: "Blocca la rigenerazione di chi colpisce", cost: 450, damage: 24, cooldown: 2, range: 3500, sacred: true },
  },
};
TOWERS.purificatore = {
  apex: "Luce Assoluta",
  name: "Purificatore",
  role: "Toglie i modificatori e brucia chi è vicino",
  family: "attacco",
  damageType: "nessuno",
  target: "first",
  unlock: 0,
  perle: 60,
  levels: [
    { ...base, cost: 300, damage: 8, cooldown: 10, range: 2400, pulseAll: true, purify: true },
    { ...base, cost: 220, damage: 13, cooldown: 10, range: 2700, pulseAll: true, purify: true },
    { ...base, cost: 320, damage: 20, cooldown: 10, range: 3100, pulseAll: true, purify: true },
  ],
  branches: {
    A: { ...base, name: "Luce bianca", summary: "Rallenta del 25% chi purifica", cost: 450, damage: 24, cooldown: 10, range: 3100, pulseAll: true, purify: true, slowBp: 7500 },
    B: { ...base, name: "Esorcismo", summary: "Triplo danno sui boss", cost: 480, damage: 30, cooldown: 10, range: 3100, pulseAll: true, purify: true, bossBp: 30000 },
  },
};

// Torri riservate: due per gli admin, una per chi vince la Notte 5.
TOWERS.custode = {
  apex: "Occhio del Creatore",
  name: "Lanterna del Custode",
  role: "Solo admin. Colpi enormi sul più forte, vede gli invisibili",
  family: "attacco",
  damageType: "nessuno",
  target: "strong",
  unlock: 0,
  exclusive: "admin",
  levels: [
    { ...base, cost: 500, damage: 420, cooldown: 15, range: 7000, pierce: true },
    { ...base, cost: 400, damage: 700, cooldown: 14, range: 7500, pierce: true },
    { ...base, cost: 600, damage: 1100, cooldown: 13, range: 8000, pierce: true },
  ],
  branches: {
    A: { ...base, name: "Luce che giudica", summary: "Un colpo devastante, doppio sui boss", cost: 900, damage: 2600, cooldown: 20, range: 9000, pierce: true, bossBp: 20000 },
    B: { ...base, name: "Raggio continuo", summary: "Un raggio che non smette mai", cost: 900, damage: 260, cooldown: 2, range: 6500, pierce: true },
  },
};
TOWERS.campana = {
  apex: "Campana del Giudizio",
  name: "Campana del Custode",
  role: "Solo admin. Più danno, cadenza e gittata, vista sugli invisibili e niente stordimenti",
  family: "supporto",
  damageType: "nessuno",
  target: "first",
  unlock: 0,
  exclusive: "admin",
  levels: [
    { ...base, cost: 450, range: 3000, auraBp: 2000, hasteBp: 1500, rangeBuffBp: 1000, immune: 10 },
    { ...base, cost: 350, range: 3500, auraBp: 3000, hasteBp: 2000, rangeBuffBp: 1500, immune: 10 },
    { ...base, cost: 500, range: 4000, auraBp: 4000, hasteBp: 2500, rangeBuffBp: 2000, immune: 10 },
  ],
  branches: {
    A: { ...base, name: "Rintocco profondo", summary: "Bonus fortissimi da vicino", cost: 800, range: 4000, auraBp: 6000, hasteBp: 3500, rangeBuffBp: 2500, immune: 10 },
    B: { ...base, name: "Eco lontana", summary: "Copre mezza mappa", cost: 800, range: 7000, auraBp: 3500, hasteBp: 2500, rangeBuffBp: 2000, immune: 10 },
  },
};
TOWERS.cometa = {
  apex: "Cometa di Natale",
  name: "Stella Cometa",
  role: "Premio della Notte 5. Stelle ad area che vedono gli invisibili",
  family: "attacco",
  damageType: "gelo",
  target: "first",
  unlock: 0,
  exclusive: "evento",
  levels: [
    { ...base, cost: 350, damage: 95, cooldown: 18, range: 5500, radius: 1500 },
    { ...base, cost: 280, damage: 160, cooldown: 17, range: 5800, radius: 1500 },
    { ...base, cost: 420, damage: 250, cooldown: 16, range: 6200, radius: 1700 },
  ],
  branches: {
    A: { ...base, name: "Pioggia di stelle", summary: "Esplosioni molto più ampie", cost: 650, damage: 320, cooldown: 16, range: 6500, radius: 2600 },
    B: { ...base, name: "Coda di ghiaccio", summary: "Spesso congela chi colpisce", cost: 650, damage: 360, cooldown: 16, range: 6200, radius: 1700, stunTicks: 15, stunChanceBp: 6000 },
  },
};
// Kingpin: spara con il suo mitra e manda sul percorso gli scagnozzi che scegli nella coda (gratis).
// Gli ultimi due miglioramenti sono su due percorsi: la scelta al livello 4 resta per il livello 5.
TOWERS.kingpin = {
  apex: "Il Padrino",
  name: "Kingpin",
  role: "Spara, e manda gratis gli scagnozzi che scegli tu; la coda cresce fino a 4",
  family: "attacco",
  damageType: "cinetico",
  target: "first",
  unlock: 600,
  levels: [
    { ...base, cost: 800, damage: 30, cooldown: 4, range: 4200, detect: true, spawnEvery: 110, spawnMax: 2, unitSet: 1, unitBp: 10000, queueSlots: 1 },
    { ...base, cost: 550, damage: 44, cooldown: 4, range: 4400, detect: true, spawnEvery: 100, spawnMax: 3, unitSet: 3, unitBp: 12000, queueSlots: 2 },
    { ...base, cost: 800, damage: 62, cooldown: 3, range: 4700, detect: true, spawnEvery: 90, spawnMax: 4, unitSet: 7, unitBp: 14500, queueSlots: 3 },
  ],
  branches: {
    A: {
      ...base, name: "La Famiglia", summary: "Scagnozzi più spesso, arriva il Sicario, abilità Taglia", cost: 1200,
      damage: 62, cooldown: 3, range: 4700, detect: true, spawnEvery: 60, spawnMax: 5, unitSet: 15, unitBp: 18000, queueSlots: 4,
      abilityCooldown: 200, abilityTicks: 100, abilityBp: 30000,
    },
    B: {
      ...base, name: "Il Boss", summary: "Il Kingpin spara molto più forte, gli scagnozzi meno", cost: 1200,
      damage: 150, cooldown: 3, range: 5300, detect: true, spawnEvery: 110, spawnMax: 3, unitSet: 7, unitBp: 11000, queueSlots: 4,
    },
  },
  branches2: {
    A: {
      ...base, name: "La Cupola", summary: "Uno scagnozzo ogni 4 s, fino a 7, Taglia più lunga e più ricca", cost: 2000,
      damage: 72, cooldown: 3, range: 4900, detect: true, spawnEvery: 40, spawnMax: 7, unitSet: 15, unitBp: 24000, queueSlots: 4,
      abilityCooldown: 200, abilityTicks: 150, abilityBp: 40000,
    },
    B: {
      ...base, name: "Il Don", summary: "Raffiche che ignorano l'armatura", cost: 2000,
      damage: 280, cooldown: 2, range: 5900, detect: true, pierce: true, spawnEvery: 120, spawnMax: 3, unitSet: 7, unitBp: 10000, queueSlots: 4,
    },
  },
};

export type UnitKind = "scagnozzo" | "portavalori" | "buttafuori" | "sicario";
export const UNIT_ORDER: UnitKind[] = ["scagnozzo", "portavalori", "buttafuori", "sicario"];
export const KINGPIN_QUEUE = 4;
export interface UnitDef {
  name: string;
  hp: number; // vita fissa: è anche il danno che fa al nemico che gli va addosso
  speed: number; // unità per tick, verso il mare
  range: number;
  damage: number;
  cooldown: number;
  strong?: boolean; // mira al nemico più forte
  pay?: number; // cash al proprietario quando esce di scena
}
export const UNITS: Record<UnitKind, UnitDef> = {
  scagnozzo: { name: "Scagnozzo", hp: 160, speed: 40, range: 2200, damage: 16, cooldown: 4 },
  portavalori: { name: "Portavalori", hp: 120, speed: 55, range: 0, damage: 0, cooldown: 0, pay: 35 },
  buttafuori: { name: "Buttafuori", hp: 650, speed: 34, range: 700, damage: 80, cooldown: 8 },
  sicario: { name: "Sicario", hp: 220, speed: 30, range: 6000, damage: 210, cooldown: 25, strong: true },
};

export const ADMIN_ONLY: TowerKind[] = ["custode", "campana"];
export const EVENT_TOWER: TowerKind = "cometa";

// Rilevamento: queste torri vedono gli invisibili; il Capitano lo presta alle torri vicine.
export const DETECTORS: TowerKind[] = ["cecchino", "arpione", "purificatore", "custode", "cometa", "kingpin"];
for (const k of DETECTORS) {
  TOWERS[k].levels = TOWERS[k].levels.map((l) => ({ ...l, detect: true }));
  TOWERS[k].branches = { A: { ...TOWERS[k].branches.A, detect: true }, B: { ...TOWERS[k].branches.B, detect: true } };
}

export const TOWER_ORDER: TowerKind[] = ["balestra", "mortaio", "soffio", "cecchino", "bobina", "officina", "grammofono", "capitano", "medico", "kingpin", "arpione", "mitragliera", "purificatore", "cometa", "custode", "campana"];
export const HARDCORE_TOWERS: TowerKind[] = TOWER_ORDER.filter((k) => TOWERS[k].perle);

// Apex: il livello 6 della torre, uno per tipo e per partita, con il rango permanente almeno 3.
export const APEX_RANK = 3;
export const APEX_COST_BP = 25000; // costo rispetto alla specializzazione scelta
export function apexStats(s: TowerStats): TowerStats {
  const up = (v: number, bp: number) => Math.floor((v * bp) / 10000);
  return {
    ...s,
    damage: up(s.damage, 22000),
    cooldown: s.cooldown > 0 ? Math.max(1, up(s.cooldown, 8000)) : 0,
    range: up(s.range, 11500),
    radius: up(s.radius, 12000),
    chains: s.chains ? s.chains + 4 : 0,
    slowBp: s.slowBp < 10000 ? Math.max(3000, 10000 - up(10000 - s.slowBp, 14000)) : s.slowBp,
    income: up(s.income, 20000),
    auraBp: up(s.auraBp, 15000),
    hasteBp: up(s.hasteBp, 15000),
    pulse: s.pulse ? Math.max(5, up(s.pulse, 5000)) : 0,
    immune: up(s.immune, 15000),
    markBp: s.markBp > 10000 ? s.markBp + 1000 : s.markBp,
    spawnEvery: s.spawnEvery ? Math.max(20, up(s.spawnEvery, 8000)) : 0,
    spawnMax: s.spawnMax ? s.spawnMax + 2 : 0,
    unitSet: s.unitSet ? s.unitSet | 1 : 0,
    unitBp: s.unitSet ? up(s.unitBp, 22000) : s.unitBp,
  };
}
export const STARTER_TOWERS: TowerKind[] = TOWER_ORDER.filter((k) => TOWERS[k].unlock === 0 && !TOWERS[k].perle && !TOWERS[k].exclusive);
export const LOADOUT_SIZE = 6;
export const TRACKS: Record<Track, { name: string; summary: string }> = {
  danno: { name: "Danno", summary: "più danno" },
  gittata: { name: "Gittata", summary: "più gittata" },
  sconto: { name: "Sconto", summary: "costruire e migliorare costa meno" },
};

// Rango permanente, comprato con le Schegge: +10% di effetto per rango.
export const MAX_RANK = 5;
export const RANK_STEP_BP = 1000;
export const RANK_COSTS = [0, 100, 200, 400, 800]; // costo per salire al rango indice+1

export interface AbilityDef {
  name: string;
  summary: string;
  cooldown: number;
}

export const ABILITIES: Record<AbilityId, AbilityDef & Record<string, number | string>> = {
  fascio: { name: "Fascio", summary: "Colpisce il punto che tocchi", cooldown: 250, radius: 1500, damageBase: 70, damagePerWave: 18 },
  gelata: { name: "Gelata", summary: "Congela tutti i nemici per 3 s", cooldown: 500, stun: 30, bossStun: 10 },
};

// ---------- mappe e livelli ----------

export interface MapDef {
  name: string;
  lanes: Cell[][]; // caselle d'angolo, dal mare aperto al Faro; la prima è fuori dalla carta
  laneOpen: number[]; // ondata (da 1) in cui ogni corsia si apre
  faro: Cell;
  rocks: Cell[];
  emerge: Array<{ wave: number; cells: Cell[] }>; // secche che diventano terra
  labels: Array<{ x: number; y: number; text: string }>;
  compass: Cell;
}

export interface WaveGroup {
  enemy: EnemyKind;
  count: number;
  interval: number; // tick tra uno spawn e il successivo
  delay: number; // tick dall'inizio dell'ondata
  lane: number;
  hpMulBp?: number;
  lifeDamage?: number;
  boss?: boolean;
  mods?: Mod[];
}

export interface LevelDef {
  id: string;
  name: string;
  sub: string;
  map: MapDef;
  startCash: number;
  waveBonusBp: number; // premio di fine ondata rispetto al Porto
  waves: WaveGroup[][];
  survivalHpBp?: number; // nelle modalità di sopravvivenza: nemici più duri sulle mappe che aiutano le torri
}

const g = (enemy: EnemyKind, count: number, interval: number, delay = 0, lane = 0): WaveGroup => ({ enemy, count, interval, delay, lane });
const boss = (hpMulBp: number, delay: number, lane = 0, enemy: EnemyKind = "bruto"): WaveGroup => ({ enemy, count: 1, interval: 1, delay, lane, hpMulBp, lifeDamage: ENEMIES[enemy]?.lifeDamage ?? 8, boss: true });

const PORTO: MapDef = {
  name: "Porto di Valdena",
  lanes: [
    [
      [-1, 1],
      [3, 1],
      [3, 6],
      [8, 6],
      [8, 2],
      [13, 2],
      [13, 7],
      [15, 7],
    ],
  ],
  laneOpen: [1],
  faro: [15, 7],
  rocks: [
    [0, 7],
    [1, 4],
    [6, 2],
    [10, 8],
    [11, 4],
    [15, 3],
  ],
  emerge: [],
  labels: [{ x: 5.9, y: 0.5, text: "Costa di Valdena" }],
  compass: [1.5, 7.6],
};

const FOCE: MapDef = {
  name: "Doppia Foce",
  lanes: [
    [
      [-1, 1],
      [4, 1],
      [4, 4],
      [8, 4],
      [8, 7],
      [12, 7],
      [12, 2],
      [15, 2],
    ],
    [
      [-1, 8],
      [6, 8],
      [6, 6],
      [8, 6],
      [8, 7],
      [12, 7],
      [12, 2],
      [15, 2],
    ],
  ],
  laneOpen: [1, 1],
  faro: [15, 2],
  rocks: [
    [2, 3],
    [10, 4],
    [14, 6],
    [0, 4],
    [7, 2],
  ],
  emerge: [],
  labels: [
    { x: 2, y: 2.4, text: "Foce nord" },
    { x: 2.6, y: 7.2, text: "Foce sud" },
  ],
  compass: [14.4, 7.9],
};

const MAREA: MapDef = {
  name: "Bassa Marea",
  lanes: [
    [
      [-1, 2],
      [3, 2],
      [3, 6],
      [7, 6],
      [7, 2],
      [11, 2],
      [11, 5],
      [15, 5],
    ],
    [
      [1, 9],
      [1, 8],
      [13, 8],
      [13, 5],
      [15, 5],
    ],
  ],
  laneOpen: [1, 4],
  faro: [15, 5],
  rocks: [
    [9, 4],
    [14, 2],
    [0, 6],
    [10, 7],
  ],
  emerge: [
    {
      wave: 6,
      cells: [
        [4, 3],
        [5, 3],
        [6, 3],
        [4, 4],
        [5, 4],
        [6, 4],
        [4, 5],
        [5, 5],
        [6, 5],
      ],
    },
  ],
  labels: [
    { x: 5.5, y: 0.6, text: "Bassa Marea" },
    { x: 7, y: 7.35, text: "Canale di marea" },
  ],
  compass: [14.6, 0.9],
};

// Riduce il numero di nemici di un livello mantenendo la forma delle ondate.
const FOCE_BP = 6000;
const MAREA_BP = 5000;
const thin = (waves: WaveGroup[][], bp: number): WaveGroup[][] =>
  waves.map((w) => w.map((x) => (x.boss ? x : { ...x, count: Math.max(1, Math.floor((x.count * bp) / 10000)), interval: Math.floor((x.interval * 10000) / bp) })));

export const LEVELS: LevelDef[] = [
  {
    id: "porto",
    name: "Il Porto",
    sub: "Una corsia. Impara le basi.",
    map: PORTO,
    startCash: 320,
    waveBonusBp: 10000,
    waves: [
      [g("risacca", 10, 12)],
      [g("risacca", 16, 9), g("corridore", 8, 14, 50)],
      [g("risacca", 14, 9), g("bruto", 4, 24, 40)],
      [g("corridore", 22, 6), g("risacca", 16, 8, 30)],
      [g("bruto", 8, 16), g("risacca", 24, 6, 30)],
      [g("risacca", 46, 4), g("corridore", 18, 7, 60)],
      [g("bruto", 14, 12), g("corridore", 22, 6, 40)],
      [g("risacca", 50, 4), g("bruto", 14, 13, 40), g("corridore", 18, 7, 120)],
      [g("bruto", 24, 9), g("corridore", 28, 5, 30)],
      [g("risacca", 50, 4), g("corridore", 26, 5, 40), g("bruto", 16, 12, 60), boss(90000, 220)],
    ],
  },
  {
    id: "foce",
    name: "La Doppia Foce",
    sub: "Due corsie che si uniscono. Arrivano i Sabotatori.",
    map: FOCE,
    startCash: 380,
    waveBonusBp: 14000,
    waves: thin([
      [g("risacca", 10, 12, 0, 0), g("risacca", 8, 14, 40, 1)],
      [g("risacca", 12, 10, 0, 0), g("corridore", 10, 10, 30, 1)],
      [g("bruto", 4, 24, 0, 0), g("risacca", 16, 8, 0, 1)],
      [g("corridore", 16, 6, 0, 0), g("corridore", 16, 6, 20, 1)],
      [g("sabotatore", 3, 30, 0, 0), g("risacca", 20, 6, 0, 1), g("bruto", 4, 24, 60, 0)],
      [g("risacca", 30, 4, 0, 0), g("risacca", 30, 4, 0, 1), g("sabotatore", 3, 30, 50, 1)],
      [g("bruto", 10, 14, 0, 1), g("corridore", 20, 6, 0, 0), g("sabotatore", 4, 25, 40, 0)],
      [g("bruto", 12, 12, 0, 0), g("bruto", 12, 12, 0, 1), g("sabotatore", 5, 20, 30, 1)],
      [g("risacca", 40, 4, 0, 0), g("corridore", 24, 5, 0, 1), g("sabotatore", 6, 18, 40, 0), g("bruto", 10, 14, 60, 1)],
      [g("risacca", 40, 5, 0, 1), g("corridore", 20, 6, 0, 0), g("bruto", 14, 13, 40, 0), g("sabotatore", 6, 20, 60, 1), boss(85000, 220, 0, "annegato")],
    ], FOCE_BP),
  },
  {
    id: "marea",
    name: "La Bassa Marea",
    sub: "La mappa cambia: si apre un canale, emergono le secche.",
    map: MAREA,
    startCash: 500,
    waveBonusBp: 18000,
    waves: thin([
      [g("risacca", 12, 10)],
      [g("risacca", 14, 9), g("corridore", 10, 12, 50)],
      [g("bruto", 5, 22), g("risacca", 14, 8, 30), g("sabotatore", 2, 40, 60)],
      [g("risacca", 16, 8, 0, 1), g("corridore", 16, 7, 0, 0)],
      [g("bruto", 8, 16, 0, 0), g("sabotatore", 4, 25, 0, 0), g("risacca", 20, 6, 30, 1)],
      [g("risacca", 34, 4, 0, 0), g("corridore", 18, 6, 30, 1), g("sabotatore", 4, 24, 40, 1)],
      [g("bruto", 12, 13, 0, 0), g("bruto", 8, 16, 20, 1), g("sabotatore", 5, 20, 50, 0)],
      [g("risacca", 44, 4, 0, 1), g("corridore", 22, 5, 0, 0), g("sabotatore", 6, 18, 40, 1)],
      [g("bruto", 18, 10, 0, 0), g("corridore", 24, 5, 0, 1), g("sabotatore", 6, 18, 40, 0)],
      [g("risacca", 44, 4, 0, 0), g("corridore", 24, 5, 0, 1), g("bruto", 14, 12, 40, 1), g("sabotatore", 8, 16, 60, 0), boss(90000, 240, 1, "sirena")],
    ], MAREA_BP),
  },
];

// ---------- mappe dell'evento e mappa lunga ----------

const simpleMap = (name: string, lanes: Cell[][], faro: Cell, rocks: Cell[], labels: MapDef["labels"], compass: Cell): MapDef => ({
  name,
  lanes,
  laneOpen: lanes.map(() => 1),
  faro,
  rocks,
  emerge: [],
  labels,
  compass,
});

// Notte 1: un anello. Il percorso torna indietro e incrocia sé stesso: una torre nell'isola lo copre due volte.
const VIGILIA = simpleMap(
  "La Vigilia",
  [[[-1, 4], [10, 4], [10, 1], [6, 1], [6, 7], [13, 7], [13, 4], [15, 4]]],
  [15, 4],
  [[0, 1], [1, 7], [12, 2], [15, 0], [9, 8]],
  [{ x: 8, y: 0.45, text: "La Vigilia" }, { x: 3, y: 6.2, text: "Neve sul porto" }],
  [2.6, 1.9],
);
// Notte 2: due anelli in fila.
const ANELLI = simpleMap(
  "I Due Anelli",
  [[[-1, 2], [5, 2], [5, 6], [2, 6], [2, 4], [9, 4], [9, 1], [12, 1], [12, 6], [15, 6]]],
  [15, 6],
  [[0, 7], [7, 7], [14, 2], [10, 7], [7, 0]],
  [{ x: 3.5, y: 0.6, text: "Zoccoli sul ghiaccio" }, { x: 10.5, y: 8.4, text: "I Due Anelli" }],
  [14.3, 3.4],
);
// Notte 3: una spirale verso il Faro, al centro della carta.
const SPIRALE = simpleMap(
  "La Spirale",
  [[[-1, 1], [14, 1], [14, 7], [1, 7], [1, 3], [12, 3], [12, 5], [4, 5], [4, 4], [8, 4]]],
  [8, 4],
  [[0, 8], [15, 8], [15, 0]],
  [{ x: 7.5, y: 0.45, text: "Neve che cammina" }, { x: 7.5, y: 8.45, text: "La Spirale" }],
  [2.6, 5.1],
);
// Notte 4: due corsie, ognuna con il suo anello, che si incrociano prima di unirsi.
const GEMELLE = simpleMap(
  "Le Gemelle",
  [
    [[3, -1], [3, 3], [1, 3], [1, 1], [7, 1], [7, 4], [15, 4]],
    [[3, 9], [3, 5], [1, 5], [1, 7], [11, 7], [11, 2], [13, 2], [13, 4], [15, 4]],
  ],
  [15, 4],
  [[9, 2], [9, 6], [15, 1], [15, 7], [5, 4]],
  [{ x: 10, y: 0.5, text: "Scope nel buio" }, { x: 6.5, y: 8.5, text: "Le Gemelle" }],
  [14.3, 6.3],
);
// Notte 5: il Crocevia. Quattro correnti entrano unite dall'alto, si separano una alla volta,
// le due interne si incrociano, e tutte si ricongiungono davanti al Faro.
const CROCEVIA = simpleMap(
  "Il Crocevia",
  [
    [[7, -1], [7, 1], [1, 1], [1, 7], [7, 7], [7, 8]],
    [[7, -1], [7, 1], [4, 1], [4, 3], [11, 3], [11, 6], [8, 6], [8, 7], [7, 7], [7, 8]],
    [[7, -1], [7, 1], [10, 1], [10, 5], [4, 5], [4, 6], [6, 6], [6, 7], [7, 7], [7, 8]],
    [[7, -1], [7, 1], [14, 1], [14, 7], [7, 7], [7, 8]],
  ],
  [7, 8],
  [[0, 0], [15, 0], [0, 8], [15, 8]],
  [{ x: 3.6, y: 0.4, text: "Il Crocevia" }, { x: 11.6, y: 0.4, text: "Quattro correnti" }],
  [12.6, 4.6],
);
// Il Lungomare: la mappa lunga, per tutte le modalità di sopravvivenza.
const LUNGOMARE = simpleMap(
  "Il Lungomare",
  [[[-1, 1], [14, 1], [14, 3], [1, 3], [1, 5], [14, 5], [14, 7], [0, 7]]],
  [0, 7],
  [[15, 0], [0, 4], [15, 8], [7, 8]],
  [{ x: 7.5, y: 0.45, text: "Il Lungomare" }, { x: 7.5, y: 4.05, text: "Sessanta caselle di costa" }],
  [15.1, 4.0],
);

const eventLevel = (id: string, map: MapDef, sub: string): LevelDef => ({ id, name: map.name, sub, map, startCash: 450, waveBonusBp: 15000, waves: LEVELS[2].waves });

export const EVENT_LEVELS: LevelDef[] = [
  eventLevel("vigilia", VIGILIA, "Un anello: il percorso torna su sé stesso."),
  eventLevel("anelli", ANELLI, "Due anelli in fila."),
  eventLevel("spirale", SPIRALE, "Una spirale verso il Faro, al centro."),
  eventLevel("gemelle", GEMELLE, "Due corsie con un anello ciascuna."),
  eventLevel("crocevia", CROCEVIA, "Quattro corsie unite che si separano e si ricongiungono."),
  { id: "lungomare", name: "Il Lungomare", sub: "Sessanta caselle di costa, per le modalità di sopravvivenza.", map: LUNGOMARE, startCash: 320, waveBonusBp: 9000, waves: LEVELS[0].waves, survivalHpBp: 14000 },
];
/** Mappe giocabili nelle modalità di sopravvivenza e in Hardcore. */
export const SURVIVAL_MAPS = ["porto", "foce", "marea", "lungomare"];

export function levelById(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? EVENT_LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}

export const CAMPAIGN_LENGTH = 10;

/** Ondata n (da 0) di un livello. Oltre la decima, la modalità Infinita genera ondate crescenti su tutte le corsie. */
// Hardcore: le ondate del livello, più resistenti, con i modificatori distribuiti un'ondata alla volta,
// due ondate in più e il Leviatano alla fine.
export const HARDCORE_LENGTH = 12;
const HC_PATTERN: Mod[][] = [[], ["agile"], ["gonfio"], ["corazzato"], ["benedetto"], ["agile", "provocatore"], ["schermato"], ["gonfio", "agile"], ["benedetto", "corazzato"], ["provocatore", "schermato"], ["benedetto", "gonfio"]];
const hcCache = new Map<string, WaveGroup[][]>();
export function hardcoreWaves(level: LevelDef): WaveGroup[][] {
  const hit = hcCache.get(level.id);
  if (hit) return hit;
  const lanes = level.map.lanes.length;
  const out: WaveGroup[][] = [];
  for (let i = 0; i < 10; i++) {
    const groups = level.waves[i].map((x) => ({ ...x, hpMulBp: Math.floor(((x.hpMulBp ?? 10000) * 11500) / 10000) }));
    const target = i % groups.length;
    groups[target] = { ...groups[target], mods: HC_PATTERN[i] };
    if (groups[target].boss) groups[target] = { ...groups[target], mods: ["benedetto"] };
    out.push(groups);
  }
  out.push([
    { ...g("risacca", 40, 4, 0, 0), hpMulBp: 16000, mods: HC_PATTERN[10] },
    { ...g("bruto", 14, 12, 40, (1 % lanes) as number), hpMulBp: 16000, mods: ["corazzato"] },
    { ...g("corridore", 24, 5, 80, 0), hpMulBp: 16000, mods: ["agile"] },
  ]);
  out.push([
    { ...g("corridore", 20, 6, 0, 0), hpMulBp: 16000, mods: ["agile"] },
    { ...g("bruto", 10, 16, 40, (1 % lanes) as number), hpMulBp: 16000, mods: ["schermato"] },
    boss(170000, 160, 0, "leviatano"),
  ]);
  hcCache.set(level.id, out);
  return out;
}

export function waveAt(level: LevelDef, n: number, mode: GameMode = "campagna"): WaveGroup[] {
  if (mode === "hardcore") return hardcoreWaves(level)[Math.min(n, HARDCORE_LENGTH - 1)];
  if (n < level.waves.length) return level.waves[n];
  const k = n - level.waves.length + 1;
  const lanes = level.map.lanes.length;
  const tough = (w: WaveGroup): WaveGroup => ({ ...w, hpMulBp: 10000 + 1500 * k });
  const hasSaboteurs = level.waves.some((w) => w.some((x) => x.enemy === "sabotatore"));
  const groups = [
    tough(g("risacca", 30 + 6 * k, 4, 0, n % lanes)),
    tough(g("corridore", 12 + 3 * k, 6, 30, (n + 1) % lanes)),
    tough(g("bruto", 8 + 3 * k, Math.max(6, 14 - k), 60, n % lanes)),
  ];
  if (hasSaboteurs) groups.push(tough(g("sabotatore", 4 + k, 18, 80, (n + 1) % lanes)));
  if ((n + 1) % 5 === 0) groups.push(boss(120000 + 40000 * k, 220, n % lanes));
  return groups;
}

export const RULES = {
  startCash: 320,
  startLives: 20,
  hardcoreLives: 10,
  hardcoreCash: 200, // cash iniziale in più in Hardcore
  prepTicks: 200,
  firstPrepTicks: 300,
  skipBonusPerSecond: 2,
  sellBp: 7000,
  waveBonusBase: 35,
  waveBonusStep: 6,
  hpGrowthA: 1100, // 0,11 per ondata, in punti base
  hpGrowthB: 60, // 0,006 per ondata al quadrato, in punti base
  shellFlightTicks: 6,
  minDamageDivisor: 10,
};

// Schegge guadagnate a fine partita.
export const REWARDS = {
  perWave: 10,
  infinitePerWaveBonus: 5, // in Infinita, +5 per ogni ondata oltre la decima
  win: 50,
  perStar: 20,
  perlePerWave: 2,
  perleWin: 30,
  perleBoss: 5,
};
