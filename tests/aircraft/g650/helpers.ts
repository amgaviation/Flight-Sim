/**
 * Headless Gulfstream G650 rig: real FlightModel + the aircraft's complete
 * systems list (with the Honeywell Epic suite on fake canvases, or without
 * it), driven by the real SimLoop with a ManualScheduler (systems 60 Hz, FDM
 * 120 Hz), on a flat world (docs/modules/qa.md §6).
 */
import { vi } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../src/core/SimLoop';
import type { SimContext } from '../../../src/core/SimContext';
import { ENV, FDM, FUEL } from '../../../src/core/vars';
import { FlightModel } from '../../../src/physics/FlightModel';
import { G650_FDM } from '../../../src/aircraft/g650/fdm';
import { createSystems, type G650Systems } from '../../../src/aircraft/g650/createSystems';
import { applyG650State } from '../../../src/aircraft/g650/states';
import { G650_INPUT_MAP } from '../../../src/aircraft/g650/inputMap';
import { G650_LIMITS } from '../../../src/aircraft/g650/data';
import { CommandRouter } from '../../../src/input/CommandRouter';
import { ScriptedPilot } from '../../../src/input/ScriptedPilot';
import type { InitialState } from '../../../src/aircraft/types';
import type { NavDatabase } from '../../../src/nav/types';
import { FlatWorld } from '../../physics/helpers';
import { fakeCanvas } from '../../avionics/honeywell-epic/helpers';

export const LB = 0.45359237;
vi.setConfig({ testTimeout: 180000 });

/** KSAV-like field (Gulfstream home base): 50 ft, runway 10 true course ~ 97 deg. */
export const FIELD = { lat: 32.1276, lon: -81.2021, elevFt: 50, courseTrue: 97 };

const noop = () => undefined;
export const AUDIO: SimContext['audio'] = { play: noop, loop: () => ({ setGain: noop, setRate: noop, stop: noop }), callout: noop, tone: noop };

export interface RigOptions {
  /** Gross weight target (lb): fuel split evenly (up to `fuelLb` or full), rest as cabin payload. */
  weightLb?: number;
  fuelLb?: number;
  air?: { altFtMsl: number; iasKt: number };
  field?: { lat: number; lon: number; elevFt: number; courseTrue: number };
  nav?: NavDatabase;
  /** Build the Epic suite on fake canvases (default false: faster). */
  avionics?: boolean;
  wind?: { dir: number; kt: number };
  seaLevelTempC?: number;
}

export interface Rig {
  vars: SimVars;
  events: EventBus;
  fdm: FlightModel;
  sys: G650Systems;
  ctx: SimContext;
  loop: SimLoop;
  pilot: ScriptedPilot;
  router: CommandRouter;
  run(seconds: number, each?: (t: number) => boolean | void): number;
}

export function makeRig(state: InitialState, o: RigOptions = {}): Rig {
  const field = o.field ?? FIELD;
  const vars = new SimVars();
  const events = new EventBus();
  const world = new FlatWorld(field.elevFt * 0.3048, 'asphalt', 0, field.lat);
  vars.set(ENV.qnhInHg, 29.92);
  vars.set(ENV.qnhRefElevFt, 0);
  vars.set(ENV.oatSeaLevelC, o.seaLevelTempC ?? 15);
  vars.set(ENV.ambientLight, 1);
  vars.set(ENV.surfaceWindDir, o.wind?.dir ?? 0);
  vars.set(ENV.surfaceWindKt, o.wind?.kt ?? 0);
  // Fuel and payload for the requested weight (BOW = empty + 2 crew in the default stations).
  const tanks = G650_FDM.mass.tanks;
  const bowKg = G650_FDM.mass.emptyMass_kg + 400 * LB + 2 * tanks[0].unusable_kg;
  const maxFuelLb = G650_LIMITS.usableFuelLb;
  // Payload is limited by the cabin stations (6,300 lb, MZFW 60,500 lb): any weight beyond goes into the tanks.
  const maxPayloadLb = 6300;
  const fuelLb = o.weightLb
    ? Math.min(maxFuelLb, Math.max(o.fuelLb ?? Math.max(4000, o.weightLb - bowKg / LB - 2000), o.weightLb - bowKg / LB - maxPayloadLb))
    : (o.fuelLb ?? 20000);
  const fuelKg = Math.min(maxFuelLb, fuelLb) * LB;
  tanks.forEach((t, i) => vars.set(FUEL.tankKg(i), Math.min(t.capacity_kg, fuelKg / 2 + t.unusable_kg)));
  const fdm = new FlightModel(G650_FDM, vars, world, { seed: 6, magneticYear: 2026.7 });
  if (o.weightLb) {
    // Payload in the cabin stations (forward to aft) and the baggage compartment.
    let payload = Math.max(0, o.weightLb * LB - bowKg - fuelKg);
    for (const [st, maxLb] of [[2, 800], [3, 1200], [4, 1200], [5, 600], [6, 2500]] as const) {
      const m = Math.min(payload, maxLb * LB);
      fdm.setStationMass(st, m);
      payload -= m;
    }
  }
  const store = new Map<string, unknown>();
  const ctx: SimContext = {
    vars,
    events,
    world,
    nav: o.nav ?? ({} as NavDatabase),
    audio: AUDIO,
    fdm,
    storage: { get: <T>(k: string, f: T) => (store.has(k) ? (store.get(k) as T) : f), set: (k, x) => void store.set(k, x) },
  };
  const sys = createSystems(ctx, { canvas: fakeCanvas, noAvionics: !o.avionics });
  if (o.air) fdm.reposition({ lat: field.lat, lon: field.lon, altFtMsl: o.air.altFtMsl, iasKt: o.air.iasKt, headingTrue: field.courseTrue });
  else fdm.reposition({ lat: field.lat, lon: field.lon, onGround: true, headingTrue: field.courseTrue });
  applyG650State(ctx, sys, state);
  const router = new CommandRouter(vars, events);
  router.setMap(G650_INPUT_MAP);
  const pilot = new ScriptedPilot(vars, events);
  const loop = new SimLoop(
    vars,
    {
      input: (dt) => router.update(dt),
      systems: (dt) => {
        pilot.update(dt);
        for (const s of sys.list) s.update(dt);
      },
      physics: (dt) => fdm.step(dt),
    },
    { scheduler: new ManualScheduler(), events },
  );
  return {
    vars,
    events,
    fdm,
    sys,
    ctx,
    loop,
    pilot,
    router,
    run(seconds, each) {
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) {
        loop.advance(1 / 60);
        if (each && each(i / 60) === true) return i / 60;
      }
      return seconds;
    },
  };
}

export const ias = (r: Rig) => r.vars.get(FDM.ias);

/** Holds a momentary control for `seconds`, then releases it. */
export function press(r: Rig, name: string, seconds = 0.3): void {
  r.vars.set(name, 1);
  r.run(seconds);
  r.vars.set(name, 0);
}

/** Active CAS messages as `level:text`. */
export const posted = (r: Rig) => r.sys.cas.list.filter((e) => e.active).map((e) => `${e.level}:${e.text}`);
