/**
 * Procedural sample synthesis (no sample files). Every function renders
 * mono PCM into a Float32Array at a given sample rate; the AudioEngine wraps
 * the results in AudioBuffers once at start-up. Pure and deterministic
 * (seeded PRNG), so it runs in node tests too.
 *
 * Cockpit control sounds are modelled as short impulsive transients (noise
 * burst + one or two damped resonances, the way a snap-action switch or a
 * detent spring rings); alert tones follow the published aural characteristics
 * where they exist (marker beacons: AIM 1-1-9) and are marked EST otherwise.
 */

/** Deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function whiteNoise(sr: number, seconds: number, seed = 1): Float32Array {
  const n = Math.max(1, Math.round(sr * seconds));
  const out = new Float32Array(n);
  const r = prng(seed);
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
  return out;
}

/** Pink (1/f) noise, Paul Kellet's refined filter; normalised to about +-1 peak. */
export function pinkNoise(sr: number, seconds: number, seed = 2): Float32Array {
  const n = Math.max(1, Math.round(sr * seconds));
  const out = new Float32Array(n);
  const r = prng(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return normalize(out, 0.9);
}

/** Brown (1/f^2) noise: leaky integrated white noise. */
export function brownNoise(sr: number, seconds: number, seed = 3): Float32Array {
  const n = Math.max(1, Math.round(sr * seconds));
  const out = new Float32Array(n);
  const r = prng(seed);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
    out[i] = last;
  }
  return normalize(out, 0.9);
}

/** Scales so the peak magnitude equals `peak`. */
export function normalize(buf: Float32Array, peak = 1): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}

/** Makes a looped buffer seamless by cross-fading its last `fadeS` into its start. */
export function makeLoopable(buf: Float32Array, sr: number, fadeS = 0.05): Float32Array {
  const f = Math.min(Math.floor(buf.length / 4), Math.round(fadeS * sr));
  if (f < 2) return buf;
  const out = buf.slice(0, buf.length - f);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = out[i] * t + buf[buf.length - f + i] * (1 - t);
  }
  return out;
}

/** One-pole low-pass in place. */
function lowpass(buf: Float32Array, sr: number, fc: number): void {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += a * (buf[i] - y);
    buf[i] = y;
  }
}

/** One-pole high-pass in place. */
function highpass(buf: Float32Array, sr: number, fc: number): void {
  const a = Math.exp((-2 * Math.PI * fc) / sr);
  let x1 = 0;
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    y = a * (y + x - x1);
    x1 = x;
    buf[i] = y;
  }
}

export interface TransientSpec {
  /** Total length (s). */
  length: number;
  /** Noise burst: duration (s), level, high-pass corner (Hz). */
  noiseS?: number;
  noiseLevel?: number;
  noiseHp?: number;
  noiseLp?: number;
  /** Damped resonances: frequency (Hz), level, decay time constant (s), start delay (s). */
  modes?: { f: number; a: number; tau: number; at?: number }[];
  /** A second noise burst (e.g. a switch reaching its stop), delay (s) and level. */
  second?: { at: number; level: number; noiseS: number };
  seed?: number;
}

/** Renders an impulsive mechanical transient (switch snap, detent, clunk). */
export function transient(sr: number, s: TransientSpec): Float32Array {
  const n = Math.max(1, Math.round(sr * s.length));
  const out = new Float32Array(n);
  const r = prng(s.seed ?? 7);
  const noise = new Float32Array(n);
  const addBurst = (at: number, dur: number, lvl: number) => {
    const i0 = Math.round(at * sr);
    const len = Math.max(1, Math.round(dur * sr));
    for (let i = 0; i < len && i0 + i < n; i++) {
      const env = Math.exp((-5 * i) / len);
      noise[i0 + i] += (r() * 2 - 1) * lvl * env;
    }
  };
  if (s.noiseS && s.noiseLevel) addBurst(0, s.noiseS, s.noiseLevel);
  if (s.second) addBurst(s.second.at, s.second.noiseS, s.second.level);
  if (s.noiseHp) highpass(noise, sr, s.noiseHp);
  if (s.noiseLp) lowpass(noise, sr, s.noiseLp);
  for (let i = 0; i < n; i++) out[i] = noise[i];
  for (const m of s.modes ?? []) {
    const i0 = Math.round((m.at ?? 0) * sr);
    const w = (2 * Math.PI * m.f) / sr;
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / sr;
      out[i] += m.a * Math.exp(-t / m.tau) * Math.sin(w * (i - i0));
    }
  }
  // 1 ms fade-in / 5 ms fade-out against clicks at the buffer edges.
  const fi = Math.min(n, Math.round(0.001 * sr));
  for (let i = 0; i < fi; i++) out[i] *= i / fi;
  const fo = Math.min(n, Math.round(0.005 * sr));
  for (let i = 0; i < fo; i++) out[n - 1 - i] *= i / fo;
  return normalize(out, 0.95);
}

/** Additive tone with harmonics, attack/release envelope. */
export function tone(sr: number, seconds: number, f: number, harmonics: number[] = [1], attackS = 0.005, releaseS = 0.02): Float32Array {
  const n = Math.max(1, Math.round(sr * seconds));
  const out = new Float32Array(n);
  const w = (2 * Math.PI * f) / sr;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) v += harmonics[h] * Math.sin(w * (h + 1) * i);
    const t = i / sr;
    const env = Math.min(1, t / Math.max(1e-4, attackS), (seconds - t) / Math.max(1e-4, releaseS));
    out[i] = v * Math.max(0, env);
  }
  return out;
}

/** Bell/chime: inharmonic partials with exponential decay (struck-bar ratios 1, 2.76, 5.40). */
export function bell(sr: number, seconds: number, f: number, decayS = 0.6): Float32Array {
  const n = Math.max(1, Math.round(sr * seconds));
  const out = new Float32Array(n);
  const partials = [
    [1, 1, 1],
    [2.0, 0.35, 0.7],
    [2.76, 0.5, 0.5],
    [5.4, 0.25, 0.3],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (const [ratio, amp, dk] of partials) v += amp * Math.exp(-t / (decayS * dk)) * Math.sin(2 * Math.PI * f * ratio * t);
    out[i] = v * Math.min(1, t / 0.002);
  }
  return normalize(out, 0.9);
}

/** Mixes `src` into `dst` at time `atS` with gain. */
export function mixInto(dst: Float32Array, src: Float32Array, sr: number, atS: number, gain = 1): void {
  const i0 = Math.round(atS * sr);
  for (let i = 0; i < src.length && i0 + i < dst.length; i++) if (i0 + i >= 0) dst[i0 + i] += src[i] * gain;
}

/** Brass-like note (sawtooth-ish harmonics, soft attack) for the cavalry charge. */
function brass(sr: number, seconds: number, f: number): Float32Array {
  return tone(sr, seconds, f, [1, 0.7, 0.45, 0.3, 0.18, 0.1], 0.025, 0.04);
}

const NOTE = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// --------------------------------------------------------------------------
// Named recipes
// --------------------------------------------------------------------------

export type Recipe = (sr: number) => Float32Array;

/** One-shot sounds (AudioApi.play ids). COCKPIT_SOUNDS ids come first. */
export const ONE_SHOTS: Record<string, Recipe> = {
  // Bat-handle toggle (MS24523): sharp snap of the over-centre spring + small metallic ring.
  'switch.toggle': (sr) => transient(sr, { length: 0.07, noiseS: 0.004, noiseLevel: 1, noiseHp: 1800, modes: [{ f: 3400, a: 0.45, tau: 0.006 }, { f: 1700, a: 0.3, tau: 0.01 }], seed: 11 }),
  'switch.toggle_heavy': (sr) =>
    transient(sr, { length: 0.12, noiseS: 0.006, noiseLevel: 1, noiseHp: 900, modes: [{ f: 1500, a: 0.55, tau: 0.012 }, { f: 620, a: 0.4, tau: 0.02 }], second: { at: 0.035, level: 0.6, noiseS: 0.004 }, seed: 12 }),
  'switch.rocker': (sr) => transient(sr, { length: 0.06, noiseS: 0.005, noiseLevel: 1, noiseHp: 1200, noiseLp: 6000, modes: [{ f: 2100, a: 0.35, tau: 0.006 }], seed: 13 }),
  'switch.guard_open': (sr) => transient(sr, { length: 0.1, noiseS: 0.006, noiseLevel: 0.9, noiseHp: 1500, modes: [{ f: 2600, a: 0.3, tau: 0.01 }, { f: 900, a: 0.2, tau: 0.02, at: 0.02 }], seed: 14 }),
  'switch.guard_close': (sr) => transient(sr, { length: 0.08, noiseS: 0.004, noiseLevel: 1, noiseHp: 1000, modes: [{ f: 1900, a: 0.4, tau: 0.008 }], seed: 15 }),
  'button.press': (sr) => transient(sr, { length: 0.05, noiseS: 0.004, noiseLevel: 1, noiseHp: 700, noiseLp: 4500, modes: [{ f: 1300, a: 0.35, tau: 0.006 }], seed: 16 }),
  'button.release': (sr) => transient(sr, { length: 0.04, noiseS: 0.003, noiseLevel: 0.7, noiseHp: 900, noiseLp: 5000, modes: [{ f: 1600, a: 0.25, tau: 0.004 }], seed: 17 }),
  'key.press': (sr) => transient(sr, { length: 0.035, noiseS: 0.003, noiseLevel: 0.8, noiseHp: 1500, noiseLp: 7000, modes: [{ f: 2400, a: 0.2, tau: 0.003 }], seed: 18 }),
  'knob.detent': (sr) => transient(sr, { length: 0.025, noiseS: 0.002, noiseLevel: 0.8, noiseHp: 2500, modes: [{ f: 4200, a: 0.3, tau: 0.002 }], seed: 19 }),
  'knob.selector': (sr) => transient(sr, { length: 0.07, noiseS: 0.004, noiseLevel: 1, noiseHp: 800, modes: [{ f: 1100, a: 0.45, tau: 0.01 }, { f: 2900, a: 0.2, tau: 0.004 }], seed: 20 }),
  'knob.push': (sr) => transient(sr, { length: 0.05, noiseS: 0.004, noiseLevel: 0.9, noiseHp: 1100, modes: [{ f: 1800, a: 0.3, tau: 0.006 }], seed: 21 }),
  'lever.detent': (sr) => transient(sr, { length: 0.1, noiseS: 0.006, noiseLevel: 0.9, noiseHp: 500, modes: [{ f: 880, a: 0.5, tau: 0.02 }, { f: 2300, a: 0.2, tau: 0.008 }], seed: 22 }),
  'lever.gate': (sr) => transient(sr, { length: 0.14, noiseS: 0.008, noiseLevel: 1, noiseHp: 250, noiseLp: 3000, modes: [{ f: 420, a: 0.6, tau: 0.03 }, { f: 1250, a: 0.25, tau: 0.012 }], seed: 23 }),
  'lever.slide': (sr) => {
    const b = whiteNoise(sr, 0.18, 24);
    lowpass(b, sr, 1800);
    highpass(b, sr, 300);
    for (let i = 0; i < b.length; i++) b[i] *= Math.sin((Math.PI * i) / b.length) * 0.5;
    return normalize(b, 0.4);
  },
  'gear.handle': (sr) =>
    transient(sr, { length: 0.25, noiseS: 0.01, noiseLevel: 1, noiseHp: 200, noiseLp: 2500, modes: [{ f: 320, a: 0.7, tau: 0.05 }, { f: 1100, a: 0.25, tau: 0.02 }], second: { at: 0.12, level: 0.8, noiseS: 0.008 }, seed: 25 }),
  'cb.pull': (sr) => transient(sr, { length: 0.06, noiseS: 0.004, noiseLevel: 1, noiseHp: 1400, modes: [{ f: 2200, a: 0.3, tau: 0.006 }], seed: 26 }),
  'cb.push': (sr) => transient(sr, { length: 0.06, noiseS: 0.004, noiseLevel: 1, noiseHp: 1100, modes: [{ f: 1700, a: 0.35, tau: 0.008 }], seed: 27 }),
  'cb.trip': (sr) => transient(sr, { length: 0.08, noiseS: 0.003, noiseLevel: 1, noiseHp: 2200, modes: [{ f: 2800, a: 0.4, tau: 0.005 }], second: { at: 0.02, level: 0.5, noiseS: 0.003 }, seed: 28 }),
  'handle.pull': (sr) => transient(sr, { length: 0.18, noiseS: 0.05, noiseLevel: 0.6, noiseHp: 400, noiseLp: 3000, modes: [{ f: 700, a: 0.4, tau: 0.03, at: 0.06 }], second: { at: 0.07, level: 0.8, noiseS: 0.006 }, seed: 29 }),
  'handle.push': (sr) => transient(sr, { length: 0.14, noiseS: 0.04, noiseLevel: 0.5, noiseHp: 400, noiseLp: 3000, modes: [{ f: 640, a: 0.45, tau: 0.03, at: 0.05 }], second: { at: 0.05, level: 0.8, noiseS: 0.006 }, seed: 30 }),
  'handle.rotate': (sr) => transient(sr, { length: 0.12, noiseS: 0.03, noiseLevel: 0.6, noiseHp: 800, noiseLp: 4000, modes: [{ f: 1400, a: 0.3, tau: 0.01, at: 0.04 }], seed: 31 }),
  'fuel.selector': (sr) => transient(sr, { length: 0.16, noiseS: 0.01, noiseLevel: 1, noiseHp: 300, noiseLp: 3000, modes: [{ f: 520, a: 0.55, tau: 0.03 }, { f: 1600, a: 0.2, tau: 0.01 }], seed: 32 }),
  'trim.wheel': (sr) => transient(sr, { length: 0.05, noiseS: 0.003, noiseLevel: 1, noiseHp: 900, modes: [{ f: 1250, a: 0.4, tau: 0.006 }], seed: 33 }),
  'yoke.button': (sr) => transient(sr, { length: 0.04, noiseS: 0.003, noiseLevel: 0.8, noiseHp: 1200, modes: [{ f: 2000, a: 0.25, tau: 0.004 }], seed: 34 }),
  // Gear/door mechanical events.
  'gear.lock': (sr) => transient(sr, { length: 0.35, noiseS: 0.02, noiseLevel: 1, noiseHp: 60, noiseLp: 900, modes: [{ f: 90, a: 0.9, tau: 0.08 }, { f: 240, a: 0.3, tau: 0.05 }], seed: 35 }),
  // Tyre touchdown: low thump plus a short rubber squeal.
  touchdown: (sr) => {
    const b = transient(sr, { length: 0.6, noiseS: 0.05, noiseLevel: 1, noiseHp: 30, noiseLp: 500, modes: [{ f: 55, a: 1, tau: 0.12 }, { f: 110, a: 0.4, tau: 0.08 }], seed: 36 });
    return normalize(b, 0.95);
  },
  'tyre.squeal': (sr) => {
    const n = Math.round(sr * 0.35);
    const b = new Float32Array(n);
    const r = prng(37);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 1500 + 400 * Math.sin(2 * Math.PI * 23 * t);
      b[i] = (Math.sin(2 * Math.PI * f * t) * 0.6 + (r() * 2 - 1) * 0.4) * Math.exp(-t / 0.12);
    }
    highpass(b, sr, 800);
    return normalize(b, 0.7);
  },
  // Alerts (one-shot).
  // Caution: single chime. EST: bell-like ~1 kHz ding (Boeing/Garmin caution chimes are single tones of this character).
  master_caution: (sr) => bell(sr, 1.2, 1047, 0.5),
  // Altitude alert: C-chord (C5 E5 G5) about 1 s (Boeing "C-chord" altitude alert; duration EST).
  alt_alert: (sr) => {
    const out = new Float32Array(Math.round(sr * 1.1));
    for (const m of [72, 76, 79]) mixInto(out, tone(sr, 1.05, NOTE(m), [1, 0.35, 0.12], 0.01, 0.3), sr, 0, 0.35);
    return normalize(out, 0.8);
  },
  'alert.altitude': (sr) => ONE_SHOTS.alt_alert(sr),
  // Generic single chime used by aircraft (Garmin "chime" / "ding").
  chime: (sr) => bell(sr, 1.0, 880, 0.45),
  'chime.triple': (sr) => {
    const out = new Float32Array(Math.round(sr * 1.6));
    for (let k = 0; k < 3; k++) mixInto(out, bell(sr, 0.9, 1175, 0.35), sr, k * 0.28, 0.6);
    return normalize(out, 0.85);
  },
  // Relay/solenoid click (starter contactor, battery relay).
  'relay.click': (sr) => transient(sr, { length: 0.05, noiseS: 0.003, noiseLevel: 1, noiseHp: 600, modes: [{ f: 950, a: 0.35, tau: 0.008 }], seed: 38 }),
};

/** Loop buffers for continuous tones (AudioApi.tone ids) and generic loops (AudioApi.loop ids). */
export const LOOPS: Record<string, Recipe> = {
  // Reed-type stall warning horn (Cessna pneumatic horn). EST: ~1.7 kHz reed with vibrato.
  stall_horn: (sr) => {
    const n = Math.round(sr * 1);
    const b = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 1700 + 30 * Math.sin(2 * Math.PI * 7 * t);
      ph += (2 * Math.PI * f) / sr;
      b[i] = Math.sin(ph) * 0.6 + Math.sin(2 * ph) * 0.25 + Math.sin(3 * ph) * 0.12;
    }
    return makeLoopable(normalize(b, 0.7), sr);
  },
  // Stick shaker: eccentric-mass motor rattling the column (EST ~25 Hz knocking, broadband).
  stick_shaker: (sr) => {
    const n = Math.round(sr * 1);
    const b = new Float32Array(n);
    const r = prng(41);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const knock = Math.pow(Math.max(0, Math.sin(2 * Math.PI * 25 * t)), 8);
      b[i] = knock * (r() * 2 - 1) + 0.5 * Math.sin(2 * Math.PI * 25 * t) * knock;
    }
    lowpass(b, sr, 1200);
    return normalize(b, 0.9);
  },
  // Overspeed clacker (Boeing): rapid mechanical clacks. EST ~8 per second.
  overspeed: (sr) => {
    const out = new Float32Array(Math.round(sr * 1));
    const c = transient(sr, { length: 0.05, noiseS: 0.004, noiseLevel: 1, noiseHp: 700, modes: [{ f: 1600, a: 0.5, tau: 0.008 }], seed: 42 });
    for (let k = 0; k < 8; k++) mixInto(out, c, sr, k / 8, 0.9);
    return out;
  },
  // Autopilot disconnect "cavalry charge" (Boeing). Melody G4 C5 E5 G5 - E5 G5 (bugle call); timing EST.
  ap_disconnect: (sr) => {
    const out = new Float32Array(Math.round(sr * 1.5));
    const notes: [number, number, number][] = [
      [67, 0.0, 0.1],
      [72, 0.12, 0.1],
      [76, 0.24, 0.1],
      [79, 0.36, 0.28],
      [76, 0.68, 0.1],
      [79, 0.8, 0.45],
    ];
    for (const [m, at, d] of notes) mixInto(out, brass(sr, d, NOTE(m)), sr, at, 0.5);
    return normalize(out, 0.8);
  },
  // Autothrottle disconnect: repeating triple chime (bizjet style; EST).
  at_disconnect: (sr) => {
    const out = new Float32Array(Math.round(sr * 1.2));
    for (let k = 0; k < 2; k++) mixInto(out, bell(sr, 0.6, 1319, 0.25), sr, k * 0.25, 0.6);
    return normalize(out, 0.8);
  },
  // Master warning: repeating two-tone chime / fire bell character (EST).
  master_warning: (sr) => {
    const out = new Float32Array(Math.round(sr * 0.8));
    mixInto(out, bell(sr, 0.4, 1047, 0.2), sr, 0, 0.7);
    mixInto(out, bell(sr, 0.4, 784, 0.2), sr, 0.2, 0.6);
    return normalize(out, 0.85);
  },
  // Landing gear warning horn: steady horn (EST 250 Hz, square-ish).
  gear_horn: (sr) => makeLoopable(normalize(tone(sr, 1, 250, [1, 0, 0.33, 0, 0.2, 0, 0.14], 0.001, 0.001), 0.7), sr, 0.02),
  // Takeoff configuration warning: intermittent horn (EST 0.25 s on / 0.25 s off).
  takeoff_config: (sr) => {
    const out = new Float32Array(Math.round(sr * 0.5));
    mixInto(out, tone(sr, 0.25, 440, [1, 0, 0.33, 0, 0.2], 0.005, 0.01), sr, 0, 0.8);
    return out;
  },
  // Marker beacons (AIM 1-1-9): OM 400 Hz dashes 2/s; MM 1300 Hz alternating dots and dashes; IM 3000 Hz dots 6/s.
  marker_outer: (sr) => {
    const out = new Float32Array(Math.round(sr * 0.5));
    mixInto(out, tone(sr, 0.375, 400, [1], 0.004, 0.004), sr, 0, 0.6);
    return out;
  },
  marker_middle: (sr) => {
    const out = new Float32Array(Math.round(sr * 0.632)); // 95 dot-dash pairs per minute
    mixInto(out, tone(sr, 0.1, 1300, [1], 0.003, 0.003), sr, 0, 0.6);
    mixInto(out, tone(sr, 0.3, 1300, [1], 0.003, 0.003), sr, 0.2, 0.6);
    return out;
  },
  marker_inner: (sr) => {
    const out = new Float32Array(Math.round(sr / 6));
    mixInto(out, tone(sr, 0.08, 3000, [1], 0.002, 0.002), sr, 0, 0.5);
    return out;
  },
  // Generic loops for aircraft use.
  'noise.white': (sr) => makeLoopable(whiteNoise(sr, 2, 51), sr),
  'noise.pink': (sr) => makeLoopable(pinkNoise(sr, 3, 52), sr),
  'noise.brown': (sr) => makeLoopable(brownNoise(sr, 3, 53), sr),
  // Electric/hydraulic motor hum (gear pump, flap motor, trim motor). EST: 400 Hz line-frequency hum with motor whine.
  'hum.motor': (sr) => {
    const t = tone(sr, 1, 400, [0.6, 1, 0.4, 0.3, 0.15], 0.001, 0.001);
    const nz = pinkNoise(sr, 1, 54);
    for (let i = 0; i < t.length; i++) t[i] = t[i] * 0.5 + nz[i] * 0.15;
    return makeLoopable(normalize(t, 0.6), sr, 0.02);
  },
  'hum.hydraulic': (sr) => {
    const t = tone(sr, 1, 110, [1, 0.5, 0.3, 0.2, 0.1, 0.1], 0.001, 0.001);
    const nz = brownNoise(sr, 1, 55);
    for (let i = 0; i < t.length; i++) t[i] = t[i] * 0.4 + nz[i] * 0.4;
    return makeLoopable(normalize(t, 0.6), sr, 0.02);
  },
  // Gyro spin-up/whine (instrument gyros, electric attitude indicators): 3 kHz-ish whine. EST.
  'gyro.whine': (sr) => makeLoopable(normalize(tone(sr, 1, 3100, [1, 0.2], 0.001, 0.001), 0.3), sr, 0.02),
  // Avionics cooling fan / cabin air: soft broadband noise.
  'fan.avionics': (sr) => {
    const b = pinkNoise(sr, 2, 56);
    highpass(b, sr, 400);
    return makeLoopable(normalize(b, 0.4), sr);
  },
  // ELT homing signal as heard on 121.5 MHz (FAA AIM 6-2-4 / TSO-C91a: audio tone swept downward
  // 1600 -> 300 Hz, 2-4 sweeps per second). 3 sweeps/s here, loop of 1 s.
  'elt.sweep': (sr) => {
    const n = Math.round(sr);
    const b = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const k = ((i / sr) * 3) % 1;
      const f = 1600 - 1300 * k;
      ph += (2 * Math.PI * f) / sr;
      b[i] = Math.sin(ph) * 0.8 + Math.sin(2 * ph) * 0.1;
    }
    return normalize(b, 0.6);
  },
  // Navaid identification tone (appended for the c172-steam receiver audio): steady 1020 Hz, keyed in Morse by the
  // aircraft through the loop gain. VOR/LOC/DME idents are 1020 Hz (FAA Order 6820.10 / AIM 1-1-3, 1-1-9); NDBs
  // commonly use 1020 Hz (or 400 Hz) keyed modulation.
  'ident.1020': (sr) => makeLoopable(normalize(tone(sr, 1, 1020, [1], 0.001, 0.001), 0.5), sr, 0.02),
  // ELT remote aural warning buzzer (EST: ~2.9 kHz piezo beeping 0.5 s on / 0.5 s off).
  'elt.buzzer': (sr) => {
    const out = new Float32Array(Math.round(sr));
    mixInto(out, tone(sr, 0.5, 2900, [1, 0.1], 0.005, 0.005), sr, 0, 0.5);
    return out;
  },
};

/** Tone ids handled by AudioApi.tone (continuous, on/off). */
export const TONE_IDS = ['stall_horn', 'stick_shaker', 'overspeed', 'ap_disconnect', 'at_disconnect', 'master_warning', 'gear_horn', 'takeoff_config', 'marker_outer', 'marker_middle', 'marker_inner'] as const;
