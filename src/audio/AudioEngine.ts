/**
 * AudioEngine: the simulator's `AudioApi` (src/core/SimContext.ts),
 * implemented with WebAudio procedural synthesis only (no sample files).
 *
 *   const audio = new AudioEngine({ vars });
 *   audio.resume();                         // on the first user gesture (autoplay policy)
 *   audio.configure(profileFromFdm(module.fdm));
 *   // every frame:
 *   audio.update(dt, { view: 'cockpit', listener: { position_m, forward, up }, paused });
 *
 * Mix buses: exterior (engines, APU, rolling) -> cockpit insulation low-pass
 * -> master; interior (wind noise, rain, control clicks, alerts, voice) ->
 * master. Sounds with a `position` are spatialised with HRTF panners; the
 * listener and every source are expressed in the aircraft body frame
 * (x fwd, y right, z down, metres from the datum) mapped to WebAudio axes.
 *
 * Continuous sounds are driven from SimVars in `update()`: engines (eng*),
 * APU (apu.n_pct), airflow (fdm.ias_kt, fdm.buffet), rain (env.precip),
 * wheels (gear.wow*, fdm.gs_kt, surface), touchdown thumps, gear/flap
 * motors (gear.pos*, surf.flaps_deg).
 */
import type { AudioApi } from '../core/SimContext';
import type { SimVars } from '../core/SimVars';
import { ENG, ENV, FDM, GEAR, SURF } from '../core/vars';
import type { FdmConfig } from '../physics/types';
import { VoiceCallouts, type SpeechLike } from './Callouts';
import { LOOPS, ONE_SHOTS, TONE_IDS, brownNoise, makeLoopable, pinkNoise, whiteNoise } from './synth';
import {
  ApuVoice,
  PISTON_IO360,
  PistonVoice,
  TURBOFAN_BIZJET,
  TURBOFAN_LARGE,
  TurbofanVoice,
  createPanner,
  ramp,
  setPannerBody,
  type PistonSoundParams,
  type PistonState,
  type TurbofanSoundParams,
  type TurbofanState,
  type VoiceShared,
} from './voices';

export interface AudioVolumes {
  master: number;
  engines: number;
  environment: number;
  cockpit: number;
  alerts: number;
  voice: number;
}

export const DEFAULT_VOLUMES: AudioVolumes = { master: 0.8, engines: 0.9, environment: 0.8, cockpit: 0.9, alerts: 0.9, voice: 1 };

export interface EngineSound {
  kind: 'turbofan' | 'piston';
  position_m: [number, number, number];
  /** Maximum thrust (N) for the thrust fraction (turbofan). */
  maxThrust_N?: number;
  /** Rated power (hp) for the power fraction (piston). */
  ratedPower_hp?: number;
  turbofan?: TurbofanSoundParams;
  piston?: PistonSoundParams;
}

export interface AircraftSoundProfile {
  engines: EngineSound[];
  /** APU position (body m) when the aircraft has one (drives the APU voice from apu.n_pct). */
  apu?: [number, number, number] | null;
  /** Gear contact points (body m) for touchdown thumps: index -> position. */
  gear?: { index: number; position_m: [number, number, number] }[];
  /** Cockpit insulation: exterior bus low-pass (Hz) and gain while the listener is inside. */
  cockpitCutoffHz: number;
  cockpitGain: number;
  /** Airflow noise level in the cockpit at 250 KIAS (0..1). */
  windLevel: number;
}

/**
 * Builds a sound profile from an aircraft's FdmConfig: engine positions and
 * classes (turbofan > 60 kN = CFM56 class, else business-jet class; pistons
 * with >= 500 cu in are 6-cylinder), gear contact points and insulation.
 * Insulation values are EST (airliner/bizjet cockpits ~ -10 dB above 1 kHz
 * relative to a light single).
 */
export function profileFromFdm(fdm: FdmConfig, opts: { apu?: boolean } = {}): AircraftSoundProfile {
  const engines: EngineSound[] = fdm.engines.map((e) =>
    e.kind === 'turbofan'
      ? { kind: 'turbofan', position_m: e.position_m, maxThrust_N: e.maxThrust_N, turbofan: e.maxThrust_N > 60_000 ? TURBOFAN_LARGE : TURBOFAN_BIZJET }
      : { kind: 'piston', position_m: e.position_m, ratedPower_hp: e.ratedPower_hp, piston: e.displacement_cuin >= 500 ? { cylinders: 6, propBlades: 2 } : PISTON_IO360 },
  );
  const jet = engines.some((e) => e.kind === 'turbofan');
  const gear = fdm.gear.filter((g) => g.gearIndex >= 0 && !g.isStructure).map((g) => ({ index: g.gearIndex, position_m: g.position_m }));
  // APU: aft of the rearmost engine, on the centreline (tail cone) when requested.
  const aft = Math.min(...fdm.engines.map((e) => e.position_m[0]), 0);
  return {
    engines,
    apu: opts.apu ? [aft - 3, 0, -0.5] : null,
    gear,
    cockpitCutoffHz: jet ? 1100 : 2600,
    cockpitGain: jet ? 0.4 : 0.85,
    windLevel: jet ? 0.5 : 0.35,
  };
}

export interface ListenerPose {
  /** Listener (camera) position in body metres. */
  position_m: [number, number, number];
  /** Unit forward and up vectors in body axes. */
  forward: [number, number, number];
  up: [number, number, number];
}

export type ViewKind = 'cockpit' | 'chase' | 'orbit' | 'tower' | 'flyby';

export interface AudioFrame {
  view: ViewKind;
  listener: ListenerPose;
  paused: boolean;
  /** Listener speed toward the aircraft (m/s, + = closing) for Doppler in external views. */
  closingSpeed_ms?: number;
}

const SPEED_OF_SOUND_MS = 340;

interface ToneHandle {
  src: AudioBufferSourceNode | null;
  gain: GainNode | null;
  on: boolean;
}

/** Inert loop handle (no audio context, unknown id). */
const NULL_LOOP = { setGain: () => undefined, setRate: () => undefined, stop: () => undefined };

export class AudioEngine implements AudioApi {
  readonly volumes: AudioVolumes = { ...DEFAULT_VOLUMES };
  readonly callouts: VoiceCallouts;
  /** Latest callout text (for captions); cleared by the UI. */
  lastCallout = '';

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private extBus!: GainNode;
  private insulation!: BiquadFilterNode;
  private extOut!: GainNode;
  private intBus!: GainNode;
  private clickBus!: GainNode;
  private alertBus!: GainNode;
  private shared: VoiceShared | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly tones = new Map<string, ToneHandle>();
  private profile: AircraftSoundProfile | null = null;
  private turbofans: (TurbofanVoice | null)[] = [];
  private pistons: (PistonVoice | null)[] = [];
  private apu: ApuVoice | null = null;
  private windF!: BiquadFilterNode;
  private windG!: GainNode;
  private buffetG!: GainNode;
  private rainG!: GainNode;
  private rollF!: BiquadFilterNode;
  private rollG!: GainNode;
  private gearHumG!: GainNode;
  private flapHumG!: GainNode;
  private envSources: AudioScheduledSourceNode[] = [];
  private readonly vars: SimVars | null;
  private readonly tfState: TurbofanState = { n1: 0, n2: 0, thrust: 0, starter: false, ignition: false, running: false, reverser: 0, pitch: 1 };
  private readonly pState: PistonState = { rpm: 0, power: 0, rough: 0, running: false, starter: false, pitch: 1 };
  private engVars: { n1: string; n2: string; thrust: string; starter: string; ign: string; running: string; rev: string; rpm: string; rough: string; power: string }[] = [];
  private wowPrev: number[] = [];
  private gearPosPrev: number[] = [0, 0, 0];
  private flapsPrev = NaN;
  private jointDist = 0;
  private gearIdx: number[] = [];
  private gearVars: { wow: string; pos: string }[] = [];

  constructor(opts: { vars?: SimVars; speech?: SpeechLike | null } = {}) {
    this.vars = opts.vars ?? null;
    this.callouts = new VoiceCallouts(opts.speech);
    this.callouts.onSpeak = (t) => {
      this.lastCallout = t;
    };
    this.callouts.onFallback = () => this.play('chime', { volume: 0.4 });
  }

  /** True once an AudioContext exists (created by `resume()`). */
  get active(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Creates (first call) or resumes the AudioContext. Call from a user
   * gesture handler: browsers keep a context created without one suspended.
   */
  resume(): void {
    if (typeof window === 'undefined') return;
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build();
      if (this.profile) this.configure(this.profile);
      // Tones switched on before the context existed (e.g. a horn during loading).
      for (const [id, h] of this.tones) if (h.on) this.tone(id, true);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  private build(): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const mk = (data: Float32Array): AudioBuffer => {
      const b = ctx.createBuffer(1, data.length, sr);
      b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      return b;
    };
    this.shared = {
      ctx,
      pink: mk(makeLoopable(pinkNoise(sr, 4, 101), sr)),
      white: mk(makeLoopable(whiteNoise(sr, 3, 102), sr)),
      brown: mk(makeLoopable(brownNoise(sr, 4, 103), sr)),
    };
    for (const [id, r] of Object.entries(ONE_SHOTS)) this.buffers.set(id, mk(r(sr)));
    for (const [id, r] of Object.entries(LOOPS)) this.buffers.set(id, mk(r(sr)));

    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.extBus = ctx.createGain();
    this.insulation = ctx.createBiquadFilter();
    this.insulation.type = 'lowpass';
    this.insulation.frequency.value = 18000;
    this.extOut = ctx.createGain();
    this.extBus.connect(this.insulation).connect(this.extOut).connect(this.master);
    this.intBus = ctx.createGain();
    this.intBus.connect(this.master);
    this.clickBus = ctx.createGain();
    this.clickBus.connect(this.master);
    this.alertBus = ctx.createGain();
    this.alertBus.connect(this.master);

    const sh = this.shared;
    const loop = (buf: AudioBuffer, off: number) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(0, off);
      this.envSources.push(s);
      return s;
    };
    // Airflow noise over the fuselage/windshield.
    this.windF = ctx.createBiquadFilter();
    this.windF.type = 'bandpass';
    this.windF.Q.value = 0.5;
    this.windG = ctx.createGain();
    this.windG.gain.value = 0;
    loop(sh.pink, 1.3).connect(this.windF).connect(this.windG).connect(this.intBus);
    // Buffet rumble (stall, gear, speedbrake).
    const bf = ctx.createBiquadFilter();
    bf.type = 'lowpass';
    bf.frequency.value = 90;
    this.buffetG = ctx.createGain();
    this.buffetG.gain.value = 0;
    loop(sh.brown, 0.4).connect(bf).connect(this.buffetG).connect(this.intBus);
    // Rain on the windshield.
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 2500;
    this.rainG = ctx.createGain();
    this.rainG.gain.value = 0;
    loop(sh.white, 0.9).connect(rf).connect(this.rainG).connect(this.intBus);
    // Wheels rolling.
    this.rollF = ctx.createBiquadFilter();
    this.rollF.type = 'lowpass';
    this.rollF.frequency.value = 160;
    this.rollG = ctx.createGain();
    this.rollG.gain.value = 0;
    loop(sh.brown, 2.2).connect(this.rollF).connect(this.rollG).connect(this.extBus);
    // Gear and flap motors.
    this.gearHumG = ctx.createGain();
    this.gearHumG.gain.value = 0;
    loop(this.buffers.get('hum.hydraulic')!, 0).connect(this.gearHumG).connect(this.intBus);
    this.flapHumG = ctx.createGain();
    this.flapHumG.gain.value = 0;
    loop(this.buffers.get('hum.motor')!, 0).connect(this.flapHumG).connect(this.intBus);
    this.applyVolumes();
  }

  setVolumes(v: Partial<AudioVolumes>): void {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    this.callouts.volume = this.volumes.voice * this.volumes.master;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    ramp(this.master.gain, this.volumes.master, now, 0.05);
    ramp(this.extBus.gain, this.volumes.engines, now, 0.05);
    ramp(this.intBus.gain, this.volumes.environment, now, 0.05);
    ramp(this.clickBus.gain, this.volumes.cockpit, now, 0.05);
    ramp(this.alertBus.gain, this.volumes.alerts, now, 0.05);
  }

  /** Sets the aircraft sound profile (engine voices, APU, gear). */
  configure(profile: AircraftSoundProfile): void {
    this.disposeVoices();
    this.profile = profile;
    const v = this.vars;
    this.engVars = profile.engines.map((_, k) => {
      const i = k + 1;
      return {
        n1: ENG.n1(i),
        n2: ENG.n2(i),
        thrust: ENG.thrustN(i),
        starter: ENG.starter(i),
        ign: ENG.ignition(i),
        running: ENG.running(i),
        rev: ENG.reverserPos(i),
        rpm: ENG.rpm(i),
        rough: ENG.roughness(i),
        power: ENG.powerHp(i),
      };
    });
    this.gearIdx = [...new Set((profile.gear ?? []).map((g) => g.index))];
    this.gearVars = this.gearIdx.map((i) => ({ wow: GEAR.weightOnWheels(i), pos: GEAR.pos(i) }));
    this.wowPrev = this.gearIdx.map((i) => (v ? v.get(GEAR.weightOnWheels(i)) : 1));
    this.gearPosPrev = this.gearIdx.map((i) => (v ? v.get(GEAR.pos(i), 1) : 1));
    this.flapsPrev = NaN;
    if (!this.ctx || !this.shared) return;
    const sh = this.shared;
    this.turbofans = profile.engines.map((e, k) =>
      e.kind === 'turbofan' ? new TurbofanVoice(sh, this.extBus, e.turbofan ?? TURBOFAN_BIZJET, k + 1, () => this.play('relay.click', { volume: 0.25, position: e.position_m })) : null,
    );
    this.pistons = profile.engines.map((e, k) => (e.kind === 'piston' ? new PistonVoice(sh, this.extBus, e.piston ?? PISTON_IO360, k + 1) : null));
    const now = this.ctx.currentTime;
    profile.engines.forEach((e, k) => {
      const p = this.turbofans[k]?.panner ?? this.pistons[k]?.panner;
      if (p) setPannerBody(p, e.position_m[0], e.position_m[1], e.position_m[2], now);
      const t = this.turbofans[k];
      if (t) {
        // Exhaust roar radiates aft: cone along -x (body) with reduced level forward.
        t.panner.orientationX.value = 0;
        t.panner.orientationY.value = 0;
        t.panner.orientationZ.value = 1;
        t.panner.coneInnerAngle = 200;
        t.panner.coneOuterAngle = 320;
        t.panner.coneOuterGain = 0.45;
      }
    });
    if (profile.apu) {
      this.apu = new ApuVoice(sh, this.extBus);
      setPannerBody(this.apu.panner, profile.apu[0], profile.apu[1], profile.apu[2], now);
    }
  }

  private disposeVoices(): void {
    for (const t of this.turbofans) t?.dispose();
    for (const p of this.pistons) p?.dispose();
    this.apu?.dispose();
    this.turbofans = [];
    this.pistons = [];
    this.apu = null;
  }

  // ------------------------------------------------------------------ AudioApi

  play(id: string, opts: { volume?: number; rate?: number; position?: [number, number, number] } = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const buf = this.buffers.get(id) ?? this.buffers.get(fallbackFor(id));
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, opts.volume ?? 1);
    const bus = isAlert(id) ? this.alertBus : this.clickBus;
    if (opts.position) {
      const p = createPanner(ctx, 0.6);
      p.positionX.value = opts.position[1];
      p.positionY.value = -opts.position[2];
      p.positionZ.value = -opts.position[0];
      src.connect(g).connect(p).connect(bus);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
        p.disconnect();
      };
    } else {
      src.connect(g).connect(bus);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
      };
    }
    src.start();
  }

  loop(id: string): { setGain(g: number): void; setRate(r: number): void; stop(): void } {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !buf) return NULL_LOOP;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(isAlert(id) ? this.alertBus : this.intBus);
    src.start();
    let stopped = false;
    return {
      setGain: (v: number) => {
        if (!stopped) ramp(g.gain, Math.max(0, v), ctx.currentTime, 0.03);
      },
      setRate: (r: number) => {
        if (!stopped) ramp(src.playbackRate, Math.max(0.01, r), ctx.currentTime, 0.03);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          src.stop();
        } catch {
          // ignore
        }
        src.disconnect();
        g.disconnect();
      },
    };
  }

  callout(text: string, priority = 5): void {
    this.callouts.say(text, priority);
  }

  tone(id: string, on: boolean): void {
    let h = this.tones.get(id);
    if (!h) {
      if (!on) return;
      h = { src: null, gain: null, on: false };
      this.tones.set(id, h);
    }
    h.on = on;
    const ctx = this.ctx;
    if (!ctx) return;
    if (!h.gain) {
      h.gain = ctx.createGain();
      h.gain.gain.value = 0;
      h.gain.connect(this.alertBus);
    }
    const g = h.gain;
    if (on && !h.src) {
      const buf = this.buffers.get(id) ?? this.buffers.get('gear_horn')!;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(g);
      src.start();
      h.src = src;
    }
    ramp(g.gain, on ? 1 : 0, ctx.currentTime, on ? 0.005 : 0.03);
    if (!on && h.src) {
      const s = h.src;
      h.src = null;
      try {
        s.stop(ctx.currentTime + 0.15);
      } catch {
        // ignore
      }
    }
  }

  /** Tone ids currently on (debug HUD). */
  activeTones(): string[] {
    const out: string[] = [];
    for (const [k, h] of this.tones) if (h.on) out.push(k);
    return out;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, f: AudioFrame): void {
    this.callouts.update(dt);
    const ctx = this.ctx;
    const v = this.vars;
    if (!ctx || !v || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const L = ctx.listener;
    const lp = f.listener.position_m;
    const fw = f.listener.forward;
    const up = f.listener.up;
    if (L.positionX) {
      L.positionX.setTargetAtTime(lp[1], now, 0.02);
      L.positionY.setTargetAtTime(-lp[2], now, 0.02);
      L.positionZ.setTargetAtTime(-lp[0], now, 0.02);
      L.forwardX.setTargetAtTime(fw[1], now, 0.02);
      L.forwardY.setTargetAtTime(-fw[2], now, 0.02);
      L.forwardZ.setTargetAtTime(-fw[0], now, 0.02);
      L.upX.setTargetAtTime(up[1], now, 0.02);
      L.upY.setTargetAtTime(-up[2], now, 0.02);
      L.upZ.setTargetAtTime(-up[0], now, 0.02);
    }
    const inside = f.view === 'cockpit';
    const prof = this.profile;
    ramp(this.insulation.frequency, inside && prof ? prof.cockpitCutoffHz : 18000, now, 0.08);
    ramp(this.extOut.gain, f.paused ? 0 : inside && prof ? prof.cockpitGain : 1, now, f.paused ? 0.2 : 0.08);
    const doppler = f.view === 'tower' || f.view === 'flyby' ? SPEED_OF_SOUND_MS / Math.max(100, SPEED_OF_SOUND_MS - (f.closingSpeed_ms ?? 0)) : 1;

    // Engines.
    if (prof) {
      for (let k = 0; k < prof.engines.length; k++) {
        const ev = this.engVars[k];
        const e = prof.engines[k];
        const tv = this.turbofans[k];
        if (tv) {
          const s = this.tfState;
          s.n1 = v.get(ev.n1);
          s.n2 = v.get(ev.n2);
          s.thrust = Math.abs(v.get(ev.thrust)) / Math.max(1, e.maxThrust_N ?? 1);
          s.starter = v.get(ev.starter) !== 0;
          s.ignition = v.get(ev.ign) !== 0;
          s.running = v.get(ev.running) !== 0;
          s.reverser = v.get(ev.rev);
          s.pitch = doppler;
          tv.update(s, dt);
        }
        const pv = this.pistons[k];
        if (pv) {
          const s = this.pState;
          s.rpm = v.get(ev.rpm);
          s.power = v.get(ev.power) / Math.max(1, e.ratedPower_hp ?? 180);
          s.rough = v.get(ev.rough);
          s.running = v.get(ev.running) !== 0;
          s.starter = v.get(ev.starter) !== 0;
          s.pitch = doppler;
          pv.update(s);
        }
      }
      this.apu?.update(v.get('apu.n_pct'), doppler);
    }

    // Airflow over the airframe (interior noise rises roughly with dynamic pressure). EST shaping.
    const ias = Math.max(0, v.get(FDM.ias));
    const windScale = f.view === 'cockpit' ? 1 : f.view === 'chase' || f.view === 'orbit' ? 0.6 : 0;
    const q = Math.min(1.6, Math.pow(ias / 250, 2));
    ramp(this.windF.frequency, 250 + ias * 5, now, 0.2);
    ramp(this.windG.gain, f.paused ? 0 : (prof?.windLevel ?? 0.4) * q * windScale, now, 0.15);
    ramp(this.buffetG.gain, f.paused ? 0 : 0.8 * Math.min(1, v.get(FDM.buffet)) * (inside ? 1 : 0.4), now, 0.08);
    // Rain on the windshield (liquid only; the world renders snow below +1 C).
    const sat = v.get(FDM.sat, 15);
    const rain = sat > 1 ? v.get(ENV.precip) : 0;
    ramp(this.rainG.gain, f.paused ? 0 : 0.18 * rain * (inside ? 1 : 0.3) * (0.4 + Math.min(1, ias / 150)), now, 0.3);

    // Wheels.
    const onGround = v.get(FDM.onGround) !== 0;
    const gsMs = Math.max(0, v.get(FDM.gs)) * 0.514444;
    const roll = onGround ? Math.min(1, gsMs / 35) : 0;
    ramp(this.rollF.frequency, 90 + gsMs * 4, now, 0.1);
    ramp(this.rollG.gain, f.paused ? 0 : 0.5 * roll, now, 0.08);
    if (onGround && gsMs > 2 && !f.paused) {
      // Pavement joints: EST 7.5 m slab spacing (concrete runways).
      this.jointDist += gsMs * dt;
      if (this.jointDist >= 7.5) {
        this.jointDist -= 7.5;
        this.play('touchdown', { volume: 0.05 + 0.1 * roll, rate: 1.6 });
      }
    }

    // Touchdowns and gear lock clunks.
    for (let k = 0; k < this.gearIdx.length; k++) {
      const gv = this.gearVars[k];
      const w = v.get(gv.wow);
      if (w !== 0 && this.wowPrev[k] === 0 && !f.paused) {
        const sink = Math.max(0, -v.get(FDM.vs));
        const pos = prof?.gear?.find((g) => g.index === this.gearIdx[k])?.position_m;
        this.play('touchdown', { volume: Math.min(1, 0.25 + sink / 500), position: pos });
        if (gsMs > 25) this.play('tyre.squeal', { volume: Math.min(0.8, 0.2 + gsMs / 120), position: pos });
      }
      this.wowPrev[k] = w;
      const p = v.get(gv.pos, 1);
      const prev = this.gearPosPrev[k];
      if ((p >= 0.999 && prev < 0.999) || (p <= 0.001 && prev > 0.001)) this.play('gear.lock', { volume: 0.6 });
      this.gearPosPrev[k] = p;
    }
    let gearMoving = 0;
    for (let k = 0; k < this.gearIdx.length; k++) {
      const p = this.gearPosPrev[k];
      if (p > 0.001 && p < 0.999) gearMoving = 1;
    }
    ramp(this.gearHumG.gain, f.paused ? 0 : 0.25 * gearMoving * (inside ? 1 : 0.5), now, 0.15);
    const flaps = v.get(SURF.flapsDeg);
    const flapRate = Number.isFinite(this.flapsPrev) && dt > 0 ? Math.abs(flaps - this.flapsPrev) / dt : 0;
    this.flapsPrev = flaps;
    ramp(this.flapHumG.gain, f.paused ? 0 : flapRate > 0.05 ? 0.12 * (inside ? 1 : 0.5) : 0, now, 0.12);
  }

  dispose(): void {
    this.callouts.cancel();
    this.disposeVoices();
    for (const s of this.envSources) {
      try {
        s.stop();
      } catch {
        // ignore
      }
    }
    this.envSources = [];
    for (const h of this.tones.values()) {
      try {
        h.src?.stop();
      } catch {
        // ignore
      }
    }
    this.tones.clear();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

function isAlert(id: string): boolean {
  return (TONE_IDS as readonly string[]).includes(id) || id === 'master_caution' || id === 'alt_alert' || id === 'alert.altitude' || id.startsWith('chime');
}

/** Unknown ids fall back to a generic sound of the same family (aircraft may invent ids). */
function fallbackFor(id: string): string {
  if (id.startsWith('switch.')) return 'switch.toggle';
  if (id.startsWith('button.') || id.startsWith('key.')) return 'button.press';
  if (id.startsWith('knob.')) return 'knob.detent';
  if (id.startsWith('lever.')) return 'lever.detent';
  if (id.startsWith('handle.')) return 'handle.pull';
  if (id.startsWith('cb.')) return 'cb.pull';
  if (id.startsWith('alert.') || id.startsWith('chime')) return 'chime';
  return 'button.press';
}
