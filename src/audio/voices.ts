/**
 * Continuous engine voices built from WebAudio oscillators and noise loops.
 * Each voice owns a small node graph ending in a PannerNode placed at the
 * engine in the aircraft body frame (listener frame: see AudioEngine).
 * `update()` only schedules AudioParam targets (no node creation per frame).
 *
 * Frequencies follow the physics of the sources:
 *  - turbofan fan tone = blade-passing frequency (N1 shaft rate x fan blades),
 *    "buzz-saw" multiple pure tones at shaft harmonics when the fan tips go
 *    supersonic (high N1), core whine keyed to N2, broadband jet/combustion
 *    roar scaled by thrust;
 *  - piston: exhaust pulses at the firing frequency (4-stroke: cylinders/2
 *    per revolution) with the propeller blade-pass tone on top, misfire
 *    roughness from `eng.rough`.
 */

export interface TurbofanSoundParams {
  /** N1 shaft speed at 100 % (rpm). */
  n1MaxRpm: number;
  fanBlades: number;
  /** Frequency (Hz) of the characteristic core whine at 100 % N2. EST (perceptual, not a single blade row). */
  whineHzAt100: number;
  /** Relative loudness of fan tone vs roar (large high-bypass fans are tonal). */
  fanLevel: number;
  roarLevel: number;
}

/**
 * CFM56-7B class (737NG): 24 wide-chord fan blades, N1 100 % = 5,380 rpm
 * (EASA TCDS E.004 CFM56-7B). Whine/levels EST.
 */
export const TURBOFAN_LARGE: TurbofanSoundParams = { n1MaxRpm: 5380, fanBlades: 24, whineHzAt100: 3200, fanLevel: 0.22, roarLevel: 0.6 };
/**
 * Business-jet turbofan class (FJ44/PW500/HTF7000/BR700/PW800 families).
 * EST: fan ~20-24 blades, N1 100 % ~ 10,000 rpm typical of 20-60 kN fans.
 */
export const TURBOFAN_BIZJET: TurbofanSoundParams = { n1MaxRpm: 10000, fanBlades: 22, whineHzAt100: 4600, fanLevel: 0.18, roarLevel: 0.5 };

export interface PistonSoundParams {
  cylinders: number;
  propBlades: number;
}

/** Lycoming IO-360-L2A (172S POH section 1): 4 cylinders; 2-blade McCauley fixed-pitch propeller. */
export const PISTON_IO360: PistonSoundParams = { cylinders: 4, propBlades: 2 };

export interface VoiceShared {
  ctx: AudioContext;
  pink: AudioBuffer;
  white: AudioBuffer;
  brown: AudioBuffer;
}

function loopSource(ctx: AudioContext, buf: AudioBuffer, offset: number): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(0, offset % Math.max(0.001, buf.duration));
  return s;
}

function gain(ctx: AudioContext, g = 0): GainNode {
  const n = ctx.createGain();
  n.gain.value = g;
  return n;
}

/** Smoothly drives an AudioParam (time constant `tau` seconds). */
export function ramp(p: AudioParam, v: number, now: number, tau = 0.05): void {
  p.setTargetAtTime(Number.isFinite(v) ? v : 0, now, tau);
}

export function createPanner(ctx: AudioContext, refDistance: number): PannerNode {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = refDistance;
  p.rolloffFactor = 1;
  p.maxDistance = 20000;
  return p;
}

/** Sets a panner position from body metres (x fwd, y right, z down) -> audio frame (x right, y up, z aft). */
export function setPannerBody(p: PannerNode, x: number, y: number, z: number, now: number): void {
  p.positionX.setTargetAtTime(y, now, 0.02);
  p.positionY.setTargetAtTime(-z, now, 0.02);
  p.positionZ.setTargetAtTime(-x, now, 0.02);
}

export interface TurbofanState {
  n1: number;
  n2: number;
  /** 0..1 thrust fraction of max. */
  thrust: number;
  starter: boolean;
  ignition: boolean;
  running: boolean;
  reverser: number;
  /** Doppler / time-scale factor applied to frequencies (1 = none). */
  pitch: number;
}

export class TurbofanVoice {
  readonly panner: PannerNode;
  private readonly out: GainNode;
  private readonly fan: OscillatorNode;
  private readonly fanG: GainNode;
  private readonly buzz: OscillatorNode;
  private readonly buzzG: GainNode;
  private readonly whine: OscillatorNode;
  private readonly whine2: OscillatorNode;
  private readonly whineG: GainNode;
  private readonly roarF: BiquadFilterNode;
  private readonly roarG: GainNode;
  private readonly rumbleG: GainNode;
  private readonly starterF: BiquadFilterNode;
  private readonly starterG: GainNode;
  private readonly srcs: AudioScheduledSourceNode[] = [];
  private ignitionPhase = 0;
  private readonly ignitionClick: () => void;

  constructor(
    private readonly sh: VoiceShared,
    dest: AudioNode,
    private readonly p: TurbofanSoundParams,
    seed: number,
    ignitionClick: () => void,
  ) {
    const ctx = sh.ctx;
    this.ignitionClick = ignitionClick;
    this.panner = createPanner(ctx, 12);
    this.out = gain(ctx, 1);
    this.out.connect(this.panner).connect(dest);

    // Fan blade-passing tone: a few harmonics.
    const fanWave = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.35, 0.12]));
    this.fan = ctx.createOscillator();
    this.fan.setPeriodicWave(fanWave);
    this.fanG = gain(ctx);
    this.fan.connect(this.fanG).connect(this.out);

    // Buzz-saw: shaft-order harmonics (rich spectrum, band-limited).
    const n = 48;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (0.6 + 0.4 * Math.sin(k * 1.7 + seed)) / Math.pow(k, 0.6);
    this.buzz = ctx.createOscillator();
    this.buzz.setPeriodicWave(ctx.createPeriodicWave(re, im));
    const buzzF = ctx.createBiquadFilter();
    buzzF.type = 'bandpass';
    buzzF.frequency.value = 900;
    buzzF.Q.value = 0.5;
    this.buzzG = gain(ctx);
    this.buzz.connect(buzzF).connect(this.buzzG).connect(this.out);

    // Core whine (two slightly detuned partials).
    this.whine = ctx.createOscillator();
    this.whine2 = ctx.createOscillator();
    this.whine2.detune.value = 9;
    this.whineG = gain(ctx);
    this.whine.connect(this.whineG);
    this.whine2.connect(this.whineG);
    this.whineG.connect(this.out);

    // Roar: pink noise through a thrust-dependent low-pass.
    const roarSrc = loopSource(ctx, sh.pink, seed * 0.37);
    this.roarF = ctx.createBiquadFilter();
    this.roarF.type = 'lowpass';
    this.roarF.Q.value = 0.4;
    this.roarG = gain(ctx);
    roarSrc.connect(this.roarF).connect(this.roarG).connect(this.out);
    // Low rumble (combustion) from brown noise.
    const rumbleSrc = loopSource(ctx, sh.brown, seed * 0.61);
    const rumbleF = ctx.createBiquadFilter();
    rumbleF.type = 'lowpass';
    rumbleF.frequency.value = 140;
    this.rumbleG = gain(ctx);
    rumbleSrc.connect(rumbleF).connect(this.rumbleG).connect(this.out);

    // Air-turbine starter: rising whoosh (band-passed white noise).
    const stSrc = loopSource(ctx, sh.white, seed * 0.83);
    this.starterF = ctx.createBiquadFilter();
    this.starterF.type = 'bandpass';
    this.starterF.Q.value = 1.2;
    this.starterG = gain(ctx);
    stSrc.connect(this.starterF).connect(this.starterG).connect(this.out);

    for (const o of [this.fan, this.buzz, this.whine, this.whine2]) o.start();
    this.srcs.push(this.fan, this.buzz, this.whine, this.whine2, roarSrc, rumbleSrc, stSrc);
  }

  update(s: TurbofanState, dt: number): void {
    const now = this.sh.ctx.currentTime;
    const n1 = Math.max(0, s.n1) / 100;
    const n2 = Math.max(0, s.n2) / 100;
    const k = s.pitch;
    const shaft = (n1 * this.p.n1MaxRpm) / 60;
    ramp(this.fan.frequency, Math.max(1, shaft * this.p.fanBlades * k), now, 0.08);
    ramp(this.buzz.frequency, Math.max(1, shaft * k), now, 0.08);
    const wf = Math.max(20, n2 * this.p.whineHzAt100 * k);
    ramp(this.whine.frequency, wf, now, 0.08);
    ramp(this.whine2.frequency, wf * 1.5, now, 0.08);

    const spin = Math.min(1, n2 / 0.25);
    ramp(this.fanG.gain, this.p.fanLevel * n1 * n1 * spin, now, 0.1);
    const tip = Math.max(0, (n1 - 0.78) / 0.22); // supersonic fan tips near take-off N1
    ramp(this.buzzG.gain, 0.16 * tip * tip, now, 0.15);
    ramp(this.whineG.gain, 0.05 * Math.pow(n2, 1.4) * spin, now, 0.1);
    const lit = s.running ? 1 : Math.min(1, n2 / 0.5) * 0.3;
    const thrust = Math.max(0, Math.min(1.2, s.thrust)) + 0.8 * s.reverser * Math.max(0.2, s.thrust);
    ramp(this.roarF.frequency, 250 + 2200 * Math.min(1, thrust), now, 0.15);
    ramp(this.roarG.gain, this.p.roarLevel * (0.05 * lit + 0.9 * Math.pow(thrust, 1.2)), now, 0.15);
    ramp(this.rumbleG.gain, 0.35 * lit * (0.2 + thrust), now, 0.2);
    const st = s.starter ? 1 : 0;
    ramp(this.starterF.frequency, 800 + 3000 * Math.min(1, n2 / 0.5), now, 0.2);
    ramp(this.starterG.gain, 0.12 * st, now, s.starter ? 0.3 : 1.2);

    // Igniter "snap" ~ 1.5 per second (exciter discharge rate EST) while ignition is on and not yet lit.
    if (s.ignition && !s.running) {
      this.ignitionPhase += dt * 1.5;
      if (this.ignitionPhase >= 1) {
        this.ignitionPhase -= 1;
        this.ignitionClick();
      }
    } else this.ignitionPhase = 0;
  }

  dispose(): void {
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
      s.disconnect();
    }
    this.out.disconnect();
    this.panner.disconnect();
  }
}

export interface PistonState {
  rpm: number;
  /** 0..1 brake power fraction. */
  power: number;
  rough: number;
  running: boolean;
  starter: boolean;
  pitch: number;
}

export class PistonVoice {
  readonly panner: PannerNode;
  private readonly out: GainNode;
  private readonly exhaust: OscillatorNode;
  private readonly exF: BiquadFilterNode;
  private readonly exG: GainNode;
  private readonly prop: OscillatorNode;
  private readonly propF: BiquadFilterNode;
  private readonly propG: GainNode;
  private readonly roughG: GainNode;
  private readonly inductionF: BiquadFilterNode;
  private readonly inductionG: GainNode;
  private readonly starter: OscillatorNode;
  private readonly starterG: GainNode;
  private readonly srcs: AudioScheduledSourceNode[] = [];

  constructor(
    private readonly sh: VoiceShared,
    dest: AudioNode,
    private readonly p: PistonSoundParams,
    seed: number,
  ) {
    const ctx = sh.ctx;
    this.panner = createPanner(ctx, 6);
    this.out = gain(ctx, 1);
    this.out.connect(this.panner).connect(dest);

    // Exhaust: fundamental at one revolution; strong partials at multiples of the firing order
    // (cylinders/2 pulses per rev for a 4-stroke), weak partials in between (cylinder-to-cylinder variation).
    const firing = Math.max(1, Math.round(p.cylinders / 2));
    const n = 64;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      const onFiring = k % firing === 0;
      im[k] = (onFiring ? 1 : 0.22) / Math.pow(k / firing, 0.75);
      re[k] = onFiring ? 0 : 0.1 * Math.sin(k * 2.3 + seed);
    }
    this.exhaust = ctx.createOscillator();
    this.exhaust.setPeriodicWave(ctx.createPeriodicWave(re, im));
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.2 * x);
    }
    shaper.curve = curve;
    this.exF = ctx.createBiquadFilter();
    this.exF.type = 'lowpass';
    this.exF.Q.value = 0.8;
    this.exG = gain(ctx);
    // Roughness: slow noise modulating the exhaust gain (misfires).
    this.roughG = gain(ctx, 0);
    const lfoSrc = loopSource(ctx, sh.white, seed * 0.29);
    const lfoF = ctx.createBiquadFilter();
    lfoF.type = 'lowpass';
    lfoF.frequency.value = 12;
    lfoSrc.connect(lfoF).connect(this.roughG).connect(this.exG.gain);
    this.exhaust.connect(shaper).connect(this.exF).connect(this.exG).connect(this.out);

    // Propeller blade-pass buzz (sawtooth, band-passed).
    this.prop = ctx.createOscillator();
    this.prop.type = 'sawtooth';
    this.propF = ctx.createBiquadFilter();
    this.propF.type = 'bandpass';
    this.propF.Q.value = 0.9;
    this.propG = gain(ctx);
    this.prop.connect(this.propF).connect(this.propG).connect(this.out);

    // Induction/cooling-air noise.
    const indSrc = loopSource(ctx, sh.pink, seed * 0.53);
    this.inductionF = ctx.createBiquadFilter();
    this.inductionF.type = 'bandpass';
    this.inductionF.Q.value = 0.7;
    this.inductionG = gain(ctx);
    indSrc.connect(this.inductionF).connect(this.inductionG).connect(this.out);

    // Starter motor whine (DC motor + pinion). EST 12 poles-ish commutator tone.
    this.starter = ctx.createOscillator();
    this.starter.type = 'square';
    const stF = ctx.createBiquadFilter();
    stF.type = 'lowpass';
    stF.frequency.value = 1400;
    this.starterG = gain(ctx);
    this.starter.connect(stF).connect(this.starterG).connect(this.out);

    for (const o of [this.exhaust, this.prop, this.starter]) o.start();
    this.srcs.push(this.exhaust, this.prop, this.starter, lfoSrc, indSrc);
  }

  update(s: PistonState): void {
    const now = this.sh.ctx.currentTime;
    const rev = Math.max(0.5, (s.rpm / 60) * s.pitch);
    ramp(this.exhaust.frequency, rev, now, 0.04);
    ramp(this.exF.frequency, 500 + s.rpm * 0.9, now, 0.1);
    const turning = Math.min(1, s.rpm / 300);
    const firing = s.running ? 1 : 0;
    const exLevel = firing * (0.25 + 0.55 * s.power) + (1 - firing) * 0.03 * turning;
    ramp(this.exG.gain, exLevel * turning, now, 0.05);
    ramp(this.roughG.gain, firing * Math.min(1, s.rough) * exLevel * 1.6, now, 0.1);
    const bpf = rev * this.p.propBlades;
    ramp(this.prop.frequency, Math.max(1, bpf), now, 0.05);
    ramp(this.propF.frequency, Math.max(80, bpf * 6), now, 0.1);
    ramp(this.propG.gain, 0.1 * Math.pow(Math.min(1.1, s.rpm / 2700), 2.2), now, 0.1);
    ramp(this.inductionF.frequency, 300 + s.rpm * 0.6, now, 0.1);
    ramp(this.inductionG.gain, 0.12 * turning * (0.3 + s.power), now, 0.1);
    const st = s.starter ? 1 : 0;
    ramp(this.starter.frequency, 150 + s.rpm * 1.2, now, 0.05);
    ramp(this.starterG.gain, 0.08 * st, now, 0.03);
  }

  dispose(): void {
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
      s.disconnect();
    }
    this.out.disconnect();
    this.panner.disconnect();
  }
}

/** APU: small gas turbine whine + intake noise. Frequencies EST. */
export class ApuVoice {
  readonly panner: PannerNode;
  private readonly osc: OscillatorNode;
  private readonly g: GainNode;
  private readonly nf: BiquadFilterNode;
  private readonly ng: GainNode;
  private readonly srcs: AudioScheduledSourceNode[] = [];

  constructor(
    private readonly sh: VoiceShared,
    dest: AudioNode,
  ) {
    const ctx = sh.ctx;
    this.panner = createPanner(ctx, 8);
    const out = gain(ctx, 1);
    out.connect(this.panner).connect(dest);
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.3, 0.15])));
    this.g = gain(ctx);
    this.osc.connect(this.g).connect(out);
    const src = loopSource(ctx, sh.pink, 0.77);
    this.nf = ctx.createBiquadFilter();
    this.nf.type = 'bandpass';
    this.nf.Q.value = 0.6;
    this.ng = gain(ctx);
    src.connect(this.nf).connect(this.ng).connect(out);
    this.osc.start();
    this.srcs.push(this.osc, src);
  }

  update(nPct: number, pitch: number): void {
    const now = this.sh.ctx.currentTime;
    const n = Math.max(0, nPct) / 100;
    ramp(this.osc.frequency, Math.max(20, 2400 * n * pitch), now, 0.1);
    ramp(this.g.gain, 0.06 * n * n, now, 0.2);
    ramp(this.nf.frequency, 400 + 1800 * n, now, 0.2);
    ramp(this.ng.gain, 0.2 * n * n, now, 0.2);
  }

  dispose(): void {
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
      s.disconnect();
    }
    this.panner.disconnect();
  }
}
