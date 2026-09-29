/**
 * Headless Cessna 172S rig: real FlightModel + the shared c172s-common systems core through
 * the real SimLoop and CommandRouter on a flat world (docs/modules/qa.md §6 pattern). The
 * variant avionics / autopilot are not part of the core, so they are absent here.
 */
import { vi } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../src/core/SimLoop';
import type { SimContext } from '../../../src/core/SimContext';
import { ENV, FUEL, FDM, INPUT, SURF } from '../../../src/core/vars';
import { FlightModel } from '../../../src/physics/FlightModel';
import type { Subsystem, InitialState } from '../../../src/aircraft/types';
import type { NavDatabase } from '../../../src/nav/types';
import { CommandRouter } from '../../../src/input/CommandRouter';
import { ScriptedPilot } from '../../../src/input/ScriptedPilot';
import { C172S_FDM } from '../../../src/aircraft/c172s-common/fdm';
import { createC172Core, type C172Core } from '../../../src/aircraft/c172s-common/createSystems';
import { applyC172State } from '../../../src/aircraft/c172s-common/states';
import { C172_INPUT_MAP } from '../../../src/aircraft/c172s-common/inputMap';
import type { C172Variant } from '../../../src/aircraft/c172s-common/systems/electrical';
import { FlatWorld } from '../../physics/helpers';

export const LB = 0.45359237;
export const GAL_KG = 6 * LB;

vi.setConfig({ testTimeout: 180000 });

const noop = () => undefined;
export const AUDIO: SimContext['audio'] = { play: noop, loop: () => ({ setGain: noop, setRate: noop, stop: noop }), callout: noop, tone: noop };

/** Sea-level field, runway true course 360. */
export const FIELD = { lat: 40.0, lon: -100.0, elevFt: 0, courseTrue: 0 };

export interface RigOptions {
  variant: C172Variant;
  state: InitialState;
  /** Fuel per tank (gal). Default 26.5 + 1.5 unusable = full. */
  fuelGalPerTank?: number;
  /** Total weight (lb): pilot 170 lb + front passenger + rear seat payload to reach it. Default pilot only. */
  grossLb?: number;
  air?: { altFtMsl: number; iasKt: number; headingTrue?: number };
  field?: { lat: number; lon: number; elevFt: number; courseTrue: number };
  oatSeaLevelC?: number;
  wind?: { dir: number; kt: number };
  extra?: (ctx: SimContext, core: C172Core) => Subsystem[];
}

export interface Rig {
  vars: SimVars;
  events: EventBus;
  fdm: FlightModel;
  core: C172Core;
  list: Subsystem[];
  pilot: ScriptedPilot;
  ctx: SimContext;
  /** Runs `seconds` of sim time in 60 Hz frames; `each(t)` after every frame (return true to stop early). */
  run(seconds: number, each?: (t: number) => boolean | void): number;
  t(): number;
}

export function payloadFor(grossLb: number, fuelKg: number): [number, number, number] {
  const pay = grossLb * LB - C172S_FDM.mass.emptyMass_kg - fuelKg;
  const pilot = 170 * LB;
  const front = Math.max(0, Math.min(170 * LB, pay - pilot));
  const rear = Math.max(0, pay - pilot - front);
  return [pilot, front, rear];
}

export function make172(o: RigOptions): Rig {
  const field = o.field ?? FIELD;
  const vars = new SimVars();
  const events = new EventBus();
  const world = new FlatWorld(field.elevFt * 0.3048, 'asphalt', 0, field.lat);
  vars.set(ENV.qnhInHg, 29.92);
  vars.set(ENV.oatSeaLevelC, o.oatSeaLevelC ?? 15);
  vars.set(ENV.ambientLight, 1);
  vars.set(ENV.surfaceWindDir, o.wind?.dir ?? 0);
  vars.set(ENV.surfaceWindKt, o.wind?.kt ?? 0);
  const fuelKg = (o.fuelGalPerTank ?? 28) * GAL_KG;
  vars.set(FUEL.tankKg(0), fuelKg);
  vars.set(FUEL.tankKg(1), fuelKg);
  const fdm = new FlightModel(C172S_FDM, vars, world, { seed: 7, magneticYear: 2026.7 });
  if (o.grossLb) {
    const [p, f, r] = payloadFor(o.grossLb, 2 * fuelKg);
    fdm.setStationMass(0, p);
    fdm.setStationMass(1, f);
    fdm.setStationMass(2, r);
  }
  const store = new Map<string, unknown>();
  const ctx: SimContext = {
    vars,
    events,
    world,
    nav: {} as NavDatabase,
    audio: AUDIO,
    fdm,
    storage: { get: <T>(k: string, fb: T) => (store.has(k) ? (store.get(k) as T) : fb), set: (k, x) => void store.set(k, x) },
  };
  const core = createC172Core(ctx, { variant: o.variant, fuel: { initialKgPerTank: fuelKg } });
  const list = core.compose({ late: o.extra?.(ctx, core) });
  const a = o.air;
  if (a) fdm.reposition({ lat: field.lat, lon: field.lon, altFtMsl: a.altFtMsl, iasKt: a.iasKt, headingTrue: a.headingTrue ?? field.courseTrue });
  else fdm.reposition({ lat: field.lat, lon: field.lon, onGround: true, headingTrue: field.courseTrue });
  applyC172State(ctx, core, o.state);
  const router = new CommandRouter(vars, events);
  router.setMap(C172_INPUT_MAP);
  const pilot = new ScriptedPilot(vars, events);
  let simT = 0;
  const loop = new SimLoop(
    vars,
    {
      input: (dt) => router.update(dt),
      systems: (dt) => {
        pilot.update(dt);
        for (const s of list) s.update(dt);
      },
      physics: (dt) => fdm.step(dt),
    },
    { scheduler: new ManualScheduler(), events },
  );
  const run = (seconds: number, each?: (t: number) => boolean | void): number => {
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) {
      loop.advance(1 / 60);
      simT += 1 / 60;
      if (each?.(simT)) return (i + 1) / 60;
    }
    return seconds;
  };
  return { vars, events, fdm, core, list, pilot, ctx, run, t: () => simT };
}

/** Holds a var at `value` for `seconds` (momentary positions: ignition START, STBY BATT TEST). */
export function hold(rig: Rig, name: string, value: number, seconds: number, after: number): void {
  rig.vars.set(name, value);
  rig.run(seconds);
  rig.vars.set(name, after);
}

export function ias(rig: Rig): number {
  return rig.vars.get('adc1.ias_kt');
}
export function kcas(rig: Rig): number {
  return rig.vars.get(FDM.cas);
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/**
 * Hand-flying test pilot for the 172 rigs: simple PI loops on the pilot inputs
 * (`input.pitch/roll/yaw`), reading attitude truth the way a pilot looks outside, and an
 * airspeed indicator var for speed (default `adc1.ias_kt`: the steam ASI, the G1000 PFD).
 * Call the loop methods once per frame from `rig.run(..., each)`.
 */
export class HandPilot {
  private pitchI = 0;
  private spdI = NaN;
  private altI = NaN;
  private yawI = 0;
  constructor(
    private readonly r: Rig,
    private readonly dt = 1 / 60,
  ) {}

  /** Elevator to hold a pitch attitude (deg). */
  pitch(targetDeg: number): void {
    const v = this.r.vars;
    const e = targetDeg - v.get(FDM.pitch);
    this.pitchI = clamp(this.pitchI + e * this.dt, -25, 25);
    v.set(INPUT.pitch, clamp(0.08 * e + 0.03 * this.pitchI - 0.03 * v.get(FDM.q), -1, 1));
  }

  /** Pitch attitude to hold an indicated airspeed (kt) on `iasVar` (default the ASI). */
  speed(targetKt: number, iasVar = 'adc1.ias_kt'): void {
    const v = this.r.vars;
    if (Number.isNaN(this.spdI)) this.spdI = v.get(FDM.pitch);
    const e = v.get(iasVar) - targetKt;
    this.spdI = clamp(this.spdI + 0.03 * e * this.dt, -10, 20);
    this.pitch(clamp(this.spdI + 0.4 * e, -10, 20));
  }

  /** Pitch attitude to hold an altitude (ft MSL, truth). */
  altitude(targetFt: number): void {
    const v = this.r.vars;
    if (Number.isNaN(this.altI)) this.altI = v.get(FDM.pitch);
    const vsCmd = clamp(3 * (targetFt - v.get(FDM.altMsl)), -500, 500);
    const e = vsCmd - v.get(FDM.vs);
    this.altI = clamp(this.altI + 0.0004 * e * this.dt, -10, 15);
    this.pitch(clamp(this.altI + 0.004 * e, -10, 15));
  }

  /** Ailerons to hold a bank angle (deg, default wings level). */
  bank(targetDeg = 0): void {
    const v = this.r.vars;
    v.set(INPUT.roll, clamp(0.05 * (targetDeg - v.get(FDM.bank)) - 0.02 * v.get(FDM.p), -1, 1));
  }

  /** Rudder pedals to centre the ball (slowly: a pilot trims the sideslip out, he does not chase the Dutch roll). */
  ball(): void {
    const v = this.r.vars;
    this.yawI = clamp(this.yawI + 0.01 * v.get(FDM.beta) * this.dt, -1, 1);
    v.set(INPUT.yaw, clamp(this.yawI - 0.004 * v.get(FDM.r), -1, 1));
  }

  /** Elevator trim wheel: rolls the trim (the cockpit position var) to take out the held elevator. */
  trim(): void {
    const v = this.r.vars;
    // Cm_trim / Cm_de = 0.18 / 0.45: 2.5 trim units per unit of elevator; ~4 s time constant.
    v.set('trim.pitch_units', clamp(v.get('trim.pitch_units') + 2.5 * v.get(SURF.elevator) * (this.dt / 4), -1, 1));
  }

  /** Pedals (nosewheel steering + rudder) to hold a true heading on the ground. */
  steer(headingTrue: number): void {
    const v = this.r.vars;
    const err = ((((v.get(FDM.headingTrue) - headingTrue + 540) % 360) + 360) % 360) - 180;
    v.set(INPUT.yaw, clamp(-0.12 * err - 0.25 * v.get(FDM.r), -1, 1));
  }

  /** Hands and feet off. */
  release(): void {
    const v = this.r.vars;
    v.set(INPUT.pitch, 0);
    v.set(INPUT.roll, 0);
    v.set(INPUT.yaw, 0);
  }

  /** Current pedal integrator (for handing over from ground steering to the ball). */
  setYaw(x: number): void {
    this.yawI = x;
  }
}
