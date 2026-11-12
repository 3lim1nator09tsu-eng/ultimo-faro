// Suoni e musica, tutti sintetizzati al momento: nessun file da scaricare.
// Ogni effetto è fatto di pochi strati (toni e rumore filtrato); la musica è un piccolo sequencer a tema.

export type SoundMode = "all" | "fx" | "off";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let fxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let meter: AnalyserNode | null = null;
let mode: SoundMode = "all";
let voices = 0;
const last: Record<string, number> = {};

function build() {
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
    return;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 6;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  master = ctx.createGain();
  master.gain.value = 0.9;
  meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  master.connect(comp).connect(meter).connect(ctx.destination);
  fxBus = ctx.createGain();
  fxBus.gain.value = 1;
  fxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(master);
  // Due secondi di rumore bianco, riusati da tutti gli effetti.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1664525 + 1013904223) | 0;
    d[i] = (seed >>> 8) / 8388608 - 1;
  }
}

const ready = () => !!ctx && ctx.state === "running" && mode !== "off";

interface ToneOpts {
  at?: number; // ritardo in secondi
  attack?: number;
  detune?: number;
  lp?: number; // filtro passa-basso
  bus?: GainNode | null;
}

/** Un tono che scivola da f0 a f1 e si spegne. */
function tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, o: ToneOpts = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + (o.at ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, f0), t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (o.detune) osc.detune.value = o.detune;
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = osc;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.lp;
    node = osc.connect(f);
  }
  node.connect(g).connect(o.bus ?? fxBus!);
  osc.start(t);
  osc.stop(t + dur + 0.03);
  voices++;
  osc.onended = () => voices--;
}

interface NoiseOpts extends ToneOpts {
  type?: BiquadFilterType;
  q?: number;
}

/** Rumore filtrato: il filtro scivola da f0 a f1. Serve per spari, soffi, esplosioni. */
function noise(f0: number, f1: number, dur: number, gain: number, o: NoiseOpts = {}) {
  if (!ctx || !noiseBuf) return;
  const t = ctx.currentTime + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.Q.value = o.q ?? 0.8;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = ctx.createGain();
  const a = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(o.bus ?? fxBus!);
  src.start(t, (t * 0.37) % 1.5);
  src.stop(t + dur + 0.03);
  voices++;
  src.onended = () => voices--;
}

/** Limita le ripetizioni: lo stesso suono non parte due volte entro gapMs, e mai con troppe voci aperte. */
function gate(name: string, gapMs: number, important = false): boolean {
  if (!ready()) return false;
  if (!important && voices > 64) return false;
  const now = performance.now();
  if (now - (last[name] ?? -1e9) < gapMs) return false;
  last[name] = now;
  return true;
}

const fx = (name: string, gap: number, make: () => void, important = false) => () => {
  if (gate(name, gap, important)) make();
};

// Variazione leggera d'intonazione: mille colpi uguali stancano.
const vary = (f: number) => f * (0.94 + ((performance.now() * 7.13) % 100) / 833);

/** Lo sparo di ogni torre. */
const GUNS: Record<string, () => void> = {
  balestra: fx("g-balestra", 70, () => {
    tone("triangle", vary(520), 180, 0.09, 0.05);
    noise(2400, 900, 0.07, 0.035, { type: "bandpass", q: 1.2 });
  }),
  cecchino: fx("g-cecchino", 120, () => {
    noise(5200, 900, 0.22, 0.11, { type: "highpass", q: 0.4 });
    tone("sine", 160, 48, 0.2, 0.12);
    noise(900, 300, 0.5, 0.025, { at: 0.06, type: "lowpass" });
  }),
  mitragliera: fx("g-mitra", 45, () => {
    noise(vary(1900), 700, 0.045, 0.06, { q: 1.4 });
    tone("square", vary(150), 90, 0.04, 0.03);
  }),
  kingpin: fx("g-kingpin", 60, () => {
    noise(vary(1300), 500, 0.06, 0.065, { q: 1 });
    tone("square", vary(120), 70, 0.06, 0.04);
  }),
  pistolero: fx("g-pistolero", 80, () => {
    noise(3400, 1200, 0.09, 0.08, { type: "highpass", q: 0.5 });
    tone("triangle", vary(240), 90, 0.1, 0.06);
    tone("sine", 2300, 2100, 0.12, 0.012, { at: 0.03 });
  }),
  arpione: fx("g-arpione", 120, () => {
    noise(700, 2600, 0.16, 0.05, { q: 2 });
    tone("triangle", 900, 400, 0.09, 0.03, { at: 0.12 });
  }),
  ingegnere: fx("g-ingegnere", 70, () => {
    noise(6000, 3000, 0.035, 0.05, { type: "highpass" });
    tone("square", vary(700), 500, 0.025, 0.02);
  }),
  accelerator: fx("g-acc", 60, () => {
    tone("sawtooth", vary(900), 1700, 0.07, 0.022, { lp: 3500 });
    tone("sine", 1800, 2600, 0.07, 0.015);
  }),
  cometa: fx("g-cometa", 90, () => {
    tone("sine", 1300, 2400, 0.16, 0.03);
    noise(5000, 9000, 0.14, 0.015, { type: "highpass" });
  }),
  custode: fx("g-custode", 90, () => {
    tone("triangle", 700, 1400, 0.14, 0.04);
    tone("sine", 1400, 2100, 0.18, 0.02, { at: 0.03 });
  }),
};
const defaultGun = fx("g-default", 70, () => {
  tone("triangle", vary(820), 380, 0.05, 0.035);
  noise(2000, 800, 0.04, 0.02);
});

const note = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Una frase di note brevi, per fanfare e segnali. */
function phrase(notes: number[], step: number, dur: number, gain: number, type: OscillatorType = "triangle") {
  notes.forEach((n, i) => {
    tone(type, note(n), note(n), dur, gain, { at: i * step, attack: 0.008 });
    tone("sine", note(n + 12), note(n + 12), dur * 0.7, gain * 0.35, { at: i * step });
  });
}

export const sfx = {
  /** Sparo di una torre, col suo timbro. */
  gun: (kind: string) => (GUNS[kind] ?? defaultGun)(),
  shot: defaultGun,
  /** Colpo di un'unità o di una torretta: un ticchettio secco. */
  tick: fx("tick", 60, () => noise(3200, 1800, 0.03, 0.03, { q: 2 })),
  thump: fx("thump", 90, () => {
    tone("sine", 170, 55, 0.2, 0.16);
    noise(500, 150, 0.12, 0.05, { type: "lowpass" });
  }),
  blast: fx("blast", 90, () => {
    noise(1400, 90, 0.42, 0.13, { type: "lowpass", q: 0.7 });
    tone("sine", 95, 34, 0.38, 0.16);
    noise(3000, 600, 0.12, 0.04, { type: "bandpass" });
  }),
  hammer: fx("hammer", 110, () => {
    tone("sine", 130, 42, 0.26, 0.2);
    noise(700, 120, 0.16, 0.08, { type: "lowpass" });
    // Ghiaccio che si incrina.
    noise(6500, 3800, 0.2, 0.035, { at: 0.03, type: "highpass" });
    tone("sine", vary(2900), 2500, 0.16, 0.015, { at: 0.04 });
  }),
  flame: fx("flame", 260, () => {
    noise(500, 1100, 0.36, 0.06, { type: "bandpass", q: 0.5, attack: 0.05 });
    noise(2400, 1500, 0.3, 0.02, { type: "highpass", attack: 0.06 });
  }),
  axe: fx("axe", 140, () => {
    noise(500, 2200, 0.2, 0.05, { q: 3, attack: 0.03 });
    tone("triangle", 1500, 700, 0.07, 0.03, { at: 0.17 });
  }),
  zap: fx("zap", 90, () => {
    tone("sawtooth", vary(1700), 260, 0.1, 0.03, { lp: 5000 });
    noise(7000, 4000, 0.09, 0.03, { type: "highpass" });
    tone("square", 90, 60, 0.08, 0.02);
  }),
  cannon: fx("cannon", 300, () => {
    tone("sawtooth", 180, 1500, 0.22, 0.05, { lp: 4000 });
    noise(2000, 60, 1.1, 0.2, { at: 0.2, type: "lowpass", q: 0.6 });
    tone("sine", 80, 28, 0.9, 0.22, { at: 0.2 });
    phrase([81, 88, 93], 0.07, 0.5, 0.025, "sine");
  }, true),
  beam: fx("beam", 200, () => {
    tone("triangle", 520, 1500, 0.34, 0.07);
    tone("sawtooth", 260, 760, 0.34, 0.025, { lp: 2400 });
    noise(4000, 8000, 0.3, 0.02, { type: "highpass", attack: 0.1 });
  }),
  freeze: fx("freeze", 300, () => {
    [96, 93, 89, 84].forEach((n, i) => tone("sine", note(n), note(n), 0.3, 0.035, { at: i * 0.05 }));
    noise(8000, 5000, 0.4, 0.02, { type: "highpass", attack: 0.05 });
  }),
  kill: fx("kill", 55, () => {
    tone("sine", vary(540), 820, 0.06, 0.03);
    noise(1800, 900, 0.04, 0.015);
  }),
  bossDown: fx("bossDown", 800, () => {
    noise(900, 50, 1.4, 0.2, { type: "lowpass" });
    tone("sine", 70, 26, 1.2, 0.22);
    phrase([60, 64, 67, 72], 0.11, 0.5, 0.05);
  }, true),
  leak: fx("leak", 220, () => {
    tone("square", 196, 196, 0.16, 0.05, { lp: 1200 });
    tone("square", 147, 147, 0.26, 0.05, { at: 0.16, lp: 1200 });
    tone("sine", 70, 40, 0.3, 0.1);
  }, true),
  build: fx("build", 60, () => {
    noise(900, 400, 0.05, 0.07, { q: 3 });
    noise(1200, 500, 0.05, 0.06, { at: 0.09, q: 3 });
    tone("triangle", 330, 660, 0.14, 0.05, { at: 0.1 });
  }),
  upgrade: fx("upgrade", 80, () => phrase([67, 71, 74, 79], 0.055, 0.16, 0.045)),
  sell: fx("sell", 80, () => {
    tone("sine", 1320, 1320, 0.09, 0.04);
    tone("sine", 990, 990, 0.14, 0.04, { at: 0.07 });
  }),
  coin: fx("coin", 60, () => {
    tone("sine", 1180, 1180, 0.07, 0.04);
    tone("sine", 1570, 1570, 0.16, 0.045, { at: 0.06 });
  }),
  tip: fx("tip", 140, () => {
    tone("square", 2100, 2100, 0.03, 0.012);
    tone("sine", 1760, 1760, 0.12, 0.03, { at: 0.03 });
  }),
  ratchet: fx("ratchet", 120, () => {
    for (let i = 0; i < 4; i++) noise(2600, 1800, 0.025, 0.045, { at: i * 0.045, q: 4 });
    tone("triangle", 440, 880, 0.12, 0.04, { at: 0.2 });
  }),
  horn: fx("horn", 500, () => {
    for (const [n, d] of [[45, 0], [45, 7], [52, -6]] as const) tone("sawtooth", note(n), note(n), 0.95, 0.035, { attack: 0.08, detune: d, lp: 900 });
    tone("sine", note(33), note(33), 0.95, 0.07, { attack: 0.06 });
  }, true),
  waveClear: fx("waveClear", 500, () => phrase([69, 73, 76], 0.08, 0.22, 0.04)),
  win: fx("win", 2000, () => {
    phrase([60, 64, 67, 72, 76, 79], 0.12, 0.4, 0.06);
    [60, 64, 67].forEach((n) => tone("sawtooth", note(n), note(n), 1.6, 0.02, { at: 0.75, attack: 0.1, lp: 1400 }));
  }, true),
  lose: fx("lose", 2000, () => {
    phrase([64, 60, 57, 52], 0.22, 0.5, 0.06, "sawtooth");
    tone("sine", note(28), note(26), 1.6, 0.14, { at: 0.7 });
  }, true),
  deny: fx("deny", 120, () => {
    tone("square", 190, 150, 0.1, 0.03, { lp: 900 });
    tone("square", 150, 120, 0.12, 0.03, { at: 0.09, lp: 900 });
  }),
  click: fx("click", 40, () => noise(2400, 1400, 0.02, 0.025, { q: 3 })),
  sabotage: fx("sabotage", 150, () => {
    tone("square", 300, 900, 0.16, 0.035, { lp: 2000 });
    noise(3000, 6000, 0.12, 0.02, { type: "highpass" });
  }),
  heal: fx("heal", 200, () => phrase([72, 76, 79], 0.07, 0.22, 0.035, "sine")),
  rally: fx("rally", 400, () => {
    for (const n of [57, 64]) tone("sawtooth", note(n), note(n), 0.6, 0.035, { attack: 0.05, lp: 1300 });
  }),
  apex: fx("apex", 600, () => {
    phrase([57, 64, 69, 73, 76, 81], 0.07, 0.5, 0.05);
    noise(3000, 9000, 0.8, 0.02, { type: "highpass", attack: 0.2 });
  }, true),
  combo: fx("combo", 120, () => {
    tone("square", 1250, 1250, 0.04, 0.015);
    tone("square", 1870, 1870, 0.06, 0.015, { at: 0.04 });
  }),
  song: fx("song", 500, () => {
    tone("sine", 880, 660, 0.8, 0.06, { attack: 0.1 });
    tone("sine", 1320, 990, 0.8, 0.025, { attack: 0.15 });
  }),
  roar: fx("roar", 800, () => {
    for (const d of [-14, 0, 11]) tone("sawtooth", 88, 38, 1.2, 0.06, { detune: d, attack: 0.05, lp: 700 });
    noise(400, 120, 1.1, 0.09, { type: "lowpass", attack: 0.08 });
  }, true),
};

// ---------- musica ----------

interface Theme {
  bpm: number;
  root: number; // nota MIDI della tonica, registro del basso
  scale: number[];
  chords: number[]; // grado della scala per ognuna delle quattro battute
  lead: OscillatorType;
  bell?: boolean; // arpeggio a campanelli, un'ottava sopra
  dark?: boolean; // basso più pesante
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const THEMES: Record<string, Theme> = {
  menu: { bpm: 74, root: 38, scale: MINOR, chords: [0, 5, 3, 4], lead: "sine" },
  campagna: { bpm: 86, root: 45, scale: [0, 2, 3, 5, 7, 9, 10], chords: [0, 3, 6, 4], lead: "triangle" },
  easy: { bpm: 96, root: 36, scale: MAJOR, chords: [0, 4, 5, 3], lead: "triangle" },
  medium: { bpm: 102, root: 40, scale: MINOR, chords: [0, 5, 2, 6], lead: "triangle" },
  molten: { bpm: 112, root: 38, scale: [0, 1, 3, 5, 7, 8, 10], chords: [0, 1, 0, 6], lead: "sawtooth", dark: true },
  fallen: { bpm: 100, root: 36, scale: [0, 2, 3, 5, 7, 8, 11], chords: [0, 3, 4, 0], lead: "square", dark: true },
  frost: { bpm: 90, root: 42, scale: [0, 2, 4, 6, 7, 9, 11], chords: [0, 1, 4, 0], lead: "sine", bell: true },
  hardcore: { bpm: 124, root: 33, scale: MINOR, chords: [0, 6, 5, 4], lead: "sawtooth", dark: true },
  natale: { bpm: 104, root: 43, scale: MAJOR, chords: [0, 3, 4, 0], lead: "sine", bell: true },
  infinita: { bpm: 108, root: 40, scale: MINOR, chords: [0, 3, 5, 4], lead: "triangle" },
};

let theme: Theme | null = null;
let themeName = "";
let intensity = 0; // 0 preparazione, 1 ondata, 2 boss
let step = 0;
let nextAt = 0;
let timer = 0;
const ARP = [0, 2, 4, 2, 7, 4, 2, 4];

const degree = (t: Theme, d: number) => t.root + t.scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);

function playStep(t: Theme, s: number, when: number) {
  if (!ctx || !musicBus) return;
  const at = Math.max(0, when - ctx.currentTime);
  const bar = Math.floor(s / 16) % 4;
  const i = s % 16;
  const chord = t.chords[bar];
  const spb = 60 / t.bpm;
  const bus = musicBus;
  if (i === 0) {
    // Tappeto: l'accordo della battuta, morbido e lungo.
    for (const k of [0, 2, 4]) {
      const f = note(degree(t, chord + k) + 12);
      tone("sawtooth", f, f, spb * 4.2, 0.016, { at, attack: spb * 0.9, lp: 650, bus, detune: k * 3 - 4 });
    }
  }
  const bassHits = intensity >= 2 ? i % 2 === 0 : intensity === 1 ? i === 0 || i === 6 || i === 8 || i === 14 : i === 0 || i === 8;
  if (bassHits) {
    const f = note(degree(t, chord) - (t.dark ? 0 : 0));
    tone(t.dark ? "sawtooth" : "triangle", f, f, spb * (intensity >= 2 ? 0.4 : 0.8), t.dark ? 0.05 : 0.06, { at, lp: t.dark ? 380 : 900, bus });
  }
  const arpEvery = intensity === 0 ? 4 : 2;
  if (i % arpEvery === 0) {
    const k = ARP[(i / 2) % ARP.length | 0];
    const n = degree(t, chord + k) + (t.bell ? 36 : 24);
    const f = note(n);
    if (t.bell) {
      tone("sine", f, f, spb * 1.2, 0.03, { at, bus });
      tone("sine", f * 2.01, f * 2.01, spb * 0.5, 0.008, { at, bus });
    } else tone(t.lead, f, f, spb * 0.45, t.lead === "sine" ? 0.035 : 0.02, { at, lp: 2200, bus });
  }
  if (intensity >= 1) {
    if (i === 0 || i === 8 || (intensity >= 2 && i === 10)) tone("sine", 120, 42, 0.16, 0.12, { at, bus });
    if (i % 4 === 2) noise(8000, 6000, 0.04, 0.018, { at, type: "highpass", bus });
    if (intensity >= 2 && (i === 4 || i === 12)) noise(1800, 900, 0.12, 0.05, { at, q: 0.8, bus });
  }
}

function pump() {
  if (!ctx || !theme || mode !== "all" || ctx.state !== "running" || document.hidden) return;
  const spb16 = 60 / theme.bpm / 4;
  if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05;
  while (nextAt < ctx.currentTime + 0.35) {
    playStep(theme, step, nextAt);
    step = (step + 1) % 64;
    nextAt += spb16;
  }
}

export const sound = {
  /** Da chiamare a un tocco dell'utente: i browser non fanno partire l'audio prima. */
  wake() {
    if (!ctx) {
      build();
      sound.setMode(mode);
    }
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    if (!timer) timer = window.setInterval(pump, 110);
  },
  get mode() {
    return mode;
  },
  setMode(m: SoundMode) {
    mode = m;
    if (ctx && musicBus) musicBus.gain.setTargetAtTime(m === "all" && theme ? 1 : 0, ctx.currentTime, 0.3);
  },
  /** Tema in corso (null = silenzio) e quanto spinge: 0 calma, 1 ondata, 2 boss. */
  music(name: string | null, level = 0) {
    intensity = level;
    if (name === themeName) return;
    themeName = name ?? "";
    theme = name ? THEMES[name] ?? THEMES.campagna : null;
    step = 0;
    nextAt = 0;
    if (ctx && musicBus) {
      // Breve dissolvenza tra un tema e l'altro.
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      musicBus.gain.setTargetAtTime(mode === "all" && theme ? 1 : 0, ctx.currentTime + 0.4, 0.5);
    }
  },
  /** Per i collaudi: cosa sta suonando. */
  debug: () => {
    let peak = 0;
    if (meter) {
      const buf = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
    }
    return { mode, theme: themeName, intensity, running: !!ctx && ctx.state === "running", voices, peak };
  },
};
