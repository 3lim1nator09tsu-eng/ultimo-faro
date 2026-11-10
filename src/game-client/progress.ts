// Progressi del giocatore: livello, missioni, medaglie e bacheca delle novità.
// Funzioni pure sui dati salvati, così si collaudano senza interfaccia.
import { LEVELS, MAX_RANK, TOWER_ORDER, TowerKind } from "../sim-core/content";

export interface Totals {
  kills: number;
  combos: number;
  abilities: number;
  apex: number;
  bossKills: number;
  wins: number;
  stars3: number;
  hcWaves: number;
  infRun: number; // miglior partita Infinita, in ondate
  perle: number; // Perle guadagnate in totale
}

export interface MissionSlot {
  pool: number; // indice nella lista
  cycle: number; // ogni giro la missione chiede di più
  base: number; // valore del contatore quando la missione è iniziata
}

export interface ChangeEntry {
  date: string;
  title: string;
  items: string[];
  kind: "versione" | "bilanciamento";
}

export const emptyTotals = (): Totals => ({ kills: 0, combos: 0, abilities: 0, apex: 0, bossKills: 0, wins: 0, stars3: 0, hcWaves: 0, infRun: 0, perle: 0 });

// ---------- livello del giocatore ----------

/** XP per passare dal livello L al successivo. */
export const xpStep = (level: number) => 120 * level;

export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (left >= xpStep(level)) {
    left -= xpStep(level);
    level++;
  }
  return { level, into: left, need: xpStep(level) };
}

/** Premio per aver raggiunto un livello: Schegge sempre, Perle ogni 5 livelli. */
export const levelReward = (level: number) => ({ schegge: 40 + 10 * level, perle: level % 5 === 0 ? 10 : 0 });

// ---------- missioni ----------

export interface MissionDef {
  text: string; // {n} = obiettivo
  key: keyof Totals;
  n: number;
  schegge: number;
  perle?: number;
  best?: boolean; // conta il valore migliore, non la somma
}

export const MISSIONS: MissionDef[] = [
  { text: "Abbatti {n} nemici", key: "kills", n: 400, schegge: 120 },
  { text: "Fai {n} combo tra torri", key: "combos", n: 60, schegge: 120 },
  { text: "Usa {n} abilità", key: "abilities", n: 12, schegge: 100 },
  { text: "Vinci {n} partite", key: "wins", n: 2, schegge: 150 },
  { text: "Sconfiggi {n} boss", key: "bossKills", n: 1, schegge: 150 },
  { text: "Costruisci {n} torre Apex", key: "apex", n: 1, schegge: 200 },
  { text: "Vinci {n} partita con 3 stelle", key: "stars3", n: 1, schegge: 180 },
  { text: "Supera {n} ondate in Hardcore", key: "hcWaves", n: 4, schegge: 120, perle: 5 },
  { text: "Supera {n} ondate in una partita Infinita", key: "infRun", n: 15, schegge: 200, best: true },
];

export const missionTarget = (slot: MissionSlot) => {
  const def = MISSIONS[slot.pool];
  return def.best ? def.n + 5 * slot.cycle : Math.ceil(def.n * (1 + 0.5 * slot.cycle));
};

export function missionProgress(slot: MissionSlot, totals: Totals): number {
  const def = MISSIONS[slot.pool];
  return def.best ? totals[def.key] : totals[def.key] - slot.base;
}

export function missionText(slot: MissionSlot): string {
  return MISSIONS[slot.pool].text.replace("{n}", String(missionTarget(slot)));
}

export function newSlot(next: number, totals: Totals): MissionSlot {
  const pool = next % MISSIONS.length;
  return { pool, cycle: Math.floor(next / MISSIONS.length), base: MISSIONS[pool].best ? 0 : totals[MISSIONS[pool].key] };
}

// ---------- medaglie ----------

export interface MedalView {
  wins: Record<string, number>;
  stars: Record<string, number>;
  hcWins: Record<string, number>;
  unlocked: TowerKind[];
  ranks: Record<TowerKind, number>;
  totals: Totals;
  level: number;
  modeWins: Record<string, number>;
  nightWins: Record<string, number>;
}

export const MEDALS: Array<{ id: string; name: string; text: string; ok: (m: MedalView) => boolean }> = [
  { id: "prima", name: "Prima luce", text: "Vinci un livello", ok: (m) => Object.values(m.wins).some((v) => v > 0) },
  { id: "stelle", name: "Faro perfetto", text: "Tre stelle in un livello", ok: (m) => Object.values(m.stars).some((v) => v >= 3) },
  { id: "custode", name: "Custode della costa", text: "Vinci tutti i livelli", ok: (m) => LEVELS.every((l) => (m.wins[l.id] ?? 0) > 0) },
  { id: "collezione", name: "Collezionista", text: "Sblocca 9 torri", ok: (m) => m.unlocked.length >= 9 },
  { id: "veterano", name: "Veterano", text: "Porta una torre al rango massimo", ok: (m) => TOWER_ORDER.some((k) => m.ranks[k] >= MAX_RANK) },
  { id: "apex", name: "Torre leggendaria", text: "Costruisci una torre Apex", ok: (m) => m.totals.apex > 0 },
  { id: "combo", name: "Maestro delle combo", text: "Fai 500 combo", ok: (m) => m.totals.combos >= 500 },
  { id: "marea", name: "Marea infinita", text: "Supera 25 ondate in Infinita", ok: (m) => m.totals.infRun >= 25 },
  { id: "abisso", name: "Abisso", text: "Supera 6 ondate in Hardcore in una partita", ok: (m) => m.totals.hcWaves >= 6 },
  { id: "leviatano", name: "Ammazzaleviatani", text: "Vinci in Hardcore", ok: (m) => Object.values(m.hcWins).some((v) => v > 0) },
  { id: "perle", name: "Pescatore di perle", text: "Guadagna 100 Perle Nere", ok: (m) => m.totals.perle >= 100 },
  { id: "ammiraglio", name: "Ammiraglio", text: "Raggiungi il livello 10", ok: (m) => m.level >= 10 },
  { id: "brace", name: "Brace spenta", text: "Vinci Molten", ok: (m) => (m.modeWins.molten ?? 0) > 0 },
  { id: "re", name: "Re deposto", text: "Vinci Fallen", ok: (m) => (m.modeWins.fallen ?? 0) > 0 },
  { id: "inverno", name: "Fine dell'inverno", text: "Vinci Frost", ok: (m) => (m.modeWins.frost ?? 0) > 0 },
  { id: "vigilia", name: "Spirito della Vigilia", text: "Vinci una Notte di Natale", ok: (m) => Object.values(m.nightWins).some((v) => v > 0) },
  { id: "krampus", name: "Krampusnacht", text: "Vinci la Notte 5", ok: (m) => (m.nightWins["5"] ?? 0) > 0 },
  { id: "nascosta", name: "Il Re si risveglia", text: "Batti il Re Caduto entro 45 secondi in Fallen e supera l'onda nascosta", ok: (m) => (m.modeWins.nascosta ?? 0) > 0 },
];

// ---------- bacheca ----------

/** Versione del gioco: chi ospita la comunica all'admin, che vede se i comandi nuovi possono funzionare. */
export const GAME_VERSION = "0.14.1";

export const VERSION_NOTES: ChangeEntry[] = [
  {
    date: "2026-11-10",
    title: "Versione 0.14.1: niente vendite per sbaglio",
    kind: "versione",
    items: [
      "Toccando una torre (soprattutto lo Star Cannon) il riquadro poteva aprirsi sotto il dito e vendere subito: ora il riquadro appena aperto ignora quel tocco",
      "Per vendere una torre servono due tocchi: il primo chiede conferma",
    ],
  },
  {
    date: "2026-11-10",
    title: "Versione 0.14: l'onda nascosta diventa un finale",
    kind: "versione",
    items: [
      "Onda nascosta più dura: scorta più forte e più numerosa, eclissi al -20% di gittata, Re Risvegliato con più vita",
      "Dopo il Re Risvegliato arrivano insieme The Creator e Jack o Bot, ognuno con poteri suoi",
      "Scene teatrali: la carta trema, titoli grandi e dialoghi che si vedono solo nell'onda nascosta",
      "Telefono: il riquadro della torre non esce più dalla carta, si scorre, si riduce col tasto e si sposta trascinando la maniglia (doppio tocco per rimetterlo a posto)",
      "Scritte sulla carta, barra del boss e dialoghi con misure che restano leggibili su telefono e non enormi su PC",
    ],
  },
  {
    date: "2026-11-10",
    title: "Versione 0.13.2: grafica più leggera",
    kind: "versione",
    items: [
      "Con tanti nemici in campo si disegnano copie già pronte: con 500 nemici, su un PC lento, da 7 a oltre 30 fotogrammi al secondo",
      "Qualità automatica: se i fotogrammi rallentano, la carta usa meno pixel; quando tornano veloci, li riprende",
      "Fondo della carta e canali preparati una volta sola invece che a ogni fotogramma",
      "In multigiocatore chi partecipa avanza a passo regolare con movimento fluido, senza raffiche di calcolo quando recupera",
      "Tetto agli effetti visivi quando la scena è affollata",
    ],
  },
  {
    date: "2026-11-10",
    title: "Versione 0.13.1: Boia più giusto",
    kind: "versione",
    items: ["Executioner, ramo Boia: finisce i nemici sotto il 5% di vita (prima 12%), anche da Apex. Mai i boss"],
  },
  {
    date: "2026-11-09",
    title: "Versione 0.13: Star Cannon, Accelerator e una vera onda nascosta",
    kind: "versione",
    items: [
      "Star Cannon (torre, 4 caselle): si carica col tempo e spari quando vuoi. Più carica, più danno e stordimento; dopo ogni colpo 2,5 s di pausa. Al massimo (Apex di Supernova) 160.000 danni e 5 s di stordimento a carica piena, 6.000 se spari subito",
      "Accelerator (torre Hardcore): si carica, poi spara un raggio continuo sullo stesso bersaglio finché vive",
      "Tolto il Cannone Stellare a pezzi della versione 0.12",
      "Onda nascosta di Fallen rifatta: eclissi (gittata -15%), Ombre del Re invisibili, Araldi Neri che stordiscono le torri, Lance Nere che scattano e si dividono, e il Re Risvegliato",
    ],
  },
  {
    date: "2026-11-09",
    title: "Versione 0.12: Sledger, Executioner, Cannone Stellare e onda nascosta",
    kind: "versione",
    items: [
      "Sledger: martellate a cono che rallentano; dal livello 3 congela chi non resiste al gelo (i boss no). Rami Rompighiaccio e Scossa artica",
      "Executioner: un'ascia che rimbalza tra i nemici senza perdere forza; il ramo Boia finisce chi resta sotto il 12% di vita",
      "Cannone Stellare: dall'ondata 7 lo monti pezzo per pezzo, raccogli 3 stelle che cadono sulla carta e spari al nemico più grosso",
      "Fallen: batti il Re Caduto entro 45 secondi e arriva l'onda nascosta con il Re Risvegliato. Premio: 1.500 Schegge e 25 Perle",
      "Vita dei nemici -10% in tutte le modalità e le Notti",
      "Comandi dell'admin alle stanze: ora l'admin vede se chi ospita li ha applicati e con quale versione del gioco",
    ],
  },
  {
    date: "2026-11-09",
    title: "Versione 0.11.1: Dohoter Gang",
    kind: "versione",
    items: [
      "Nuovo boss che solo l'admin può evocare in partita: Dohoter Gang, con 67.000 di vita",
      "Se l'admin lo evoca, la partita resta valida: premi, missioni e classifica non si perdono",
    ],
  },
  {
    date: "2026-11-08",
    title: "Versione 0.11: modalità molto più dure",
    kind: "versione",
    items: [
      "Vita dei nemici rifatta in tutte le modalità: prima era tarata sui bot, che giocano peggio delle persone",
      "La vita sale ondata dopo ondata: le ultime ondate sono le più dure (fino a +80% in Frost e Hardcore)",
      "Easy ×1,9 all'inizio; Medium ×2; Molten ×1,5; Fallen ×1,2; Frost ×1,4, poi la crescita",
      "Notte 1 molto più dura, Notti 2–5 più dure verso la fine",
      "La Campagna resta com'era",
    ],
  },
  {
    date: "2026-11-07",
    title: "Versione 0.10.1: prezzi dell'Arsenale",
    kind: "versione",
    items: [
      "Il Kingpin ora si sblocca con 1000 Schegge e 40 Perle insieme",
      "L'admin può cambiare dal pannello i prezzi di sblocco (Schegge e Perle) e i costi dei ranghi, per tutti",
    ],
  },
  {
    date: "2026-11-07",
    title: "Versione 0.10: le tue scelte contano",
    kind: "versione",
    items: [
      "Puntamento: per ogni torre scegli chi colpire, cioè il primo, l'ultimo, il più forte, il più vicino o uno a caso",
      "Easy, il Mercante: ogni 5 ondate scegli un'offerta su tre",
      "Medium, i Contratti: accetti un'ondata più dura e vieni pagato solo se nessuno arriva al Faro",
      "Molten, le Bocche di lava: +40% danno, ma ogni 3 ondate le torri sopra si fermano",
      "Fallen, le Reliquie: dopo ogni mini-boss un vantaggio con la sua maledizione",
      "Frost, i Bracieri: nella bufera solo le torri vicine al fuoco sparano a pieno ritmo",
      "Hardcore, Scegli il veleno: ogni 10 ondate decidi tu i modificatori del blocco (vita dei nemici +4%)",
      "Campagna, gli Ordini del Capitano: Difesa, Assalto o Economia prima di ogni ondata",
      "Notte 5, i momenti rapidi: ai mini-boss e a ogni quarto di vita di Krampus, tocca il simbolo giusto o spezza le catene",
    ],
  },
  {
    date: "2026-11-07",
    title: "Versione 0.9.1: pannello admin solo per l'admin",
    kind: "versione",
    items: [
      "Il pannello admin si apre solo con l'account admin, confermato dal server a ogni avvio: niente più password sul dispositivo",
      "Cambiando account sullo stesso telefono o PC il pannello non resta aperto",
      "Un account nuovo non eredita più i progressi dell'account usato prima sullo stesso dispositivo",
      "Comandi admin e partite di prova rifiutati a chi non è admin",
    ],
  },
  {
    date: "2026-11-07",
    title: "Versione 0.9: bilanciamento dal server e premi dell'admin",
    kind: "versione",
    items: [
      "L'admin può cambiare vita, quantità e crescita dei nemici, boss, mini-boss, vite, cash e premi di ogni modalità e di ogni Notte",
      "Correzioni per mappa: vita dei nemici e cash iniziale",
      "Le modifiche si provano sul dispositivo dell'admin e poi si pubblicano: arrivano a tutti all'avvio del gioco e compaiono qui in bacheca",
      "In multigiocatore valgono i valori di chi ospita, per tutti i giocatori della stanza",
      "L'admin può mandare a un giocatore Schegge, Perle, torri sbloccate o ranghi: li ricevi al prossimo avvio, su qualunque dispositivo",
    ],
  },
  {
    date: "2026-11-07",
    title: "Versione 0.8.1: Kingpin rifatto",
    kind: "versione",
    items: [
      "Kingpin: 800 per piazzarlo, spara con il suo mitra e vede gli invisibili; si pagano solo i miglioramenti",
      "Gli scagnozzi sono gratis: la coda parte da 1 posto e cresce fino a 4 con i livelli, e decidi tu chi mandare",
      "Due percorsi per gli ultimi due miglioramenti, la scelta al livello 4 resta per il livello 5",
      "La Famiglia, poi La Cupola: scagnozzi molto più frequenti, arriva il Sicario, abilità Taglia (20 s di ricarica)",
      "Il Boss, poi Il Don: il Kingpin spara molto più forte, gli scagnozzi valgono meno",
      "Gli scagnozzi hanno una vita fissa: chi gli va addosso la perde tutta; il Portavalori dà cash quando si schianta",
      "Kingpin ribilanciato: mitra più debole ai livelli 3-5 (Il Boss 100, Il Don 160), La Cupola più lenta, Buttafuori con 500 di vita",
      "Al massimo 4 Kingpin per giocatore",
    ],
  },
  {
    date: "2026-11-07",
    title: "Versione 0.8: Kingpin, scheda dei nemici, Hardcore più duro",
    kind: "versione",
    items: [
      "Kingpin: manda Scagnozzi, Portavalori, Buttafuori e Sicari sul percorso; rami Racket (cash) e La Famiglia (combattimento)",
      "Tocca un nemico, o passaci sopra col mouse, per vederne vita, scudo, armatura, modificatori e tratti",
      "Hardcore più duro: più vita, crescita più ripida, mappe facili corrette",
      "Due modificatori nuovi in Hardcore: Spettrale (invisibile) e Scisso (si divide in due quando cade)",
      "Ogni modificatore ha il suo segno sul nemico: aureola, mirino, piastre, scie, crepa",
      "Ombre, barre della vita a colori, basamenti delle torri e interfaccia rifiniti; anello del proprietario in multigiocatore",
    ],
  },
  {
    date: "2026-11-07",
    title: "Versione 0.7.1: mappe nuove",
    kind: "versione",
    items: [
      "Notti 1–4 su mappe nuove con anelli: il percorso torna su sé stesso",
      "Notte 1 La Vigilia, Notte 2 I Due Anelli, Notte 3 La Spirale (Faro al centro), Notte 4 Le Gemelle",
      "Il Crocevia rifatto: quattro corsie entrano unite, si separano, le interne si incrociano, si riuniscono davanti al Faro",
      "Il Lungomare: la mappa lunga (61 caselle) per tutte le modalità da Easy a Hardcore, con nemici più resistenti del 40%",
      "Notti ritarate: ognuna si sblocca con il suo Disgelo",
    ],
  },
  {
    date: "2026-11-07",
    title: "Versione 0.7: multigiocatore per giocatore e Crocevia",
    kind: "versione",
    items: [
      "In multigiocatore ognuno ha il suo cash, le sue torri e le sue abilità; le vite restano in comune",
      "Taglie e premi d'ondata vanno a ogni giocatore; i nemici sono più resistenti quando si gioca in più",
      "Il cash dato dall'admin va a un solo giocatore, scelto dal pannello",
      "Due torri riservate agli admin: Lanterna del Custode e Campana del Custode",
      "Stella Cometa: la torre premio per chi vince la Notte 5",
      "La Notte 5 si gioca sul Crocevia: quattro corsie unite che si separano e si ricongiungono",
      "Grafica leggera e meno lavoro quando il menu è aperto: il gioco consuma molto meno",
    ],
  },
  {
    date: "2026-11-07",
    title: "Versione 0.6: modalità, Natale e online",
    kind: "versione",
    items: [
      "Cinque modalità di sopravvivenza: Easy (20 ondate), Medium (25), Molten (30), Fallen (35), Frost (40), ognuna con il suo boss",
      "Hardcore ora dura 50 ondate e si apre vincendo Molten",
      "Evento di Natale: cinque Notti con Folletto Ladro, Renna Nera, Pupazzo Colossale, Befana e Krampus",
      "Disgelo: l'evento è al massimo della forza fino a dicembre, poi cala ogni settimana",
      "Nemici nuovi: Tizzoni, Magmatici, Spettri invisibili, Cavalieri, Brinati, Orsi Bianchi",
      "Rilevamento: Cecchino, Arpione e Purificatore vedono gli invisibili; il Capitano lo presta alle torri vicine",
      "Account con nome utente e password, salvataggio online, classifiche, stanze multigiocatore",
    ],
  },
  {
    date: "2026-11-06",
    title: "Versione 0.5: Hardcore, boss e Apex",
    kind: "versione",
    items: [
      "Nuova modalità Hardcore: 12 ondate con modificatori, 10 vite, il Leviatano alla fine",
      "Perle Nere e tre torri Hardcore: Arpione, Mitragliera, Purificatore",
      "Boss nuovi: Capitano Annegato alla Foce, Sirena Cava alla Marea",
      "Torri Apex al livello 6, dal rango 3, una per tipo",
      "Combo: Frantumazione e Scossa",
      "Livello del giocatore, missioni e medaglie",
    ],
  },
  {
    date: "2026-11-06",
    title: "Versione 0.4: mappe e supporto",
    kind: "versione",
    items: ["Tre livelli, mappe a due corsie e mappa che cambia", "Grammofono, Capitano, Medico e Sabotatore", "Squadra da 6 torri"],
  },
  {
    date: "2026-11-06",
    title: "Versione 0.3: abilità e Arsenale",
    kind: "versione",
    items: ["Fascio del Faro e Gelata", "Cecchino, Bobina, Officina", "Schegge, ranghi e modalità Infinita"],
  },
];
