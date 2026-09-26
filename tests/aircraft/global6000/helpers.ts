/**
 * Headless Bombardier Global 6000 rig: real FlightModel + the aircraft's
 * complete systems list (with the Collins Fusion suite on fake canvases, or
 * without it), driven by the real SimLoop with a ManualScheduler (systems
 * 60 Hz, FDM 120 Hz), on a flat world (docs/modules/qa.md 6).
 */
import { vi } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../src/core/SimLoop';
import type { SimContext } from '../../../src/core/SimContext';
import { ENV, FDM, FUEL } from '../../../src/core/vars';
import { FlightModel } from '../../../src/physics/FlightModel';
import { GLOBAL6000_FDM } from '../../../src/aircraft/global6000/fdm';
import { createSystems, type G6kSystems } from '../../../src/aircraft/global6000/createSystems';
import { applyG6kState } from '../../../src/aircraft/global6000/states';
import { G6K_INPUT_MAP } from '../../../src/aircraft/global6000/inputMap';
import { G6K_LIMITS } from '../../../src/aircraft/global6000/data';
import { CommandRouter } from '../../../src/input/CommandRouter';
import { ScriptedPilot } from '../../../src/input/ScriptedPilot';
import type { InitialState } from '../../../src/aircraft/types';
import type { NavDatabase } from '../../../src/nav/types';
import { FlatWorld } from '../../physics/helpers';
import { fakeCanvas } from '../../avionics/collins-fusion/helpers';

export const LB = 0.45359237;
vi.setConfig({ testTimeout: 300000 });

// The Fusion map / SVS terrain rasters create their own canvases (OffscreenCanvas in the browser): stub it in Node.
const g = globalThis as unknown as { OffscreenCanvas?: unknown };
if (typeof g.OffscreenCanvas === 'undefined') {
  g.OffscreenCanvas = class {
    constructor(w: number, h: number) {
      const c = fakeCanvas() as unknown as { width: number; height: number };
      c.width = w;
      c.height = h;
      return c;
    }
  };
}

/** CYUL-like field (Bombardier Montreal): 118 ft, runway 06L true course ~ 42 deg. */
export const FIELD = { lat: 45.4706, lon: -73.7408, elevFt: 118, courseTrue: 42 };

const noop = () => undefined;
export const AUDIO: SimContext['audio'] = { play: noop, loop: () => ({ setGain: noop, setRate: noop, stop: noop }), callout: noop, tone: noop };

export interface RigOptions {
  /** Gross weight target (lb): fuel (wings first, then centre, then aft) and the rest as cabin payload. */
  weightLb?: number;
  fuelLb?: number;
  air?: { altFtMsl: number; iasKt: number };
  field?: { lat: number; lon: number; elevFt: number; courseTrue: number };
  nav?: NavDatabase;
  /** Build the Fusion suite on fake canvases (default false: faster). */
  avionics?: boolean;
  wind?: { dir: number; kt: number };
  seaLevelTempC?: number;
}

export interface Rig {
  vars: SimVars;
  events: EventBus;
  fdm: FlightModel;
  sys: G6kSystems;
  ctx: SimContext;
  loop: SimLoop;
  pilot: ScriptedPilot;
  router: CommandRouter;
  run(seconds: number, each?: (t: number) => boolean | void): number;
}

/** Splits a fuel load (lb) wings first, then centre, then aft (Global loading sequence, GXFU). */
export function fuelSplitKg(fuelLb: number): number[] {
  const L = G6K_LIMITS;
  let rest = Math.min(fuelLb, L.usableFuelLb);
  const wing = Math.min(rest / 2, L.mainTankLb);
  rest -= 2 * wing;
  const ctr = Math.min(rest, L.centerTankLb);
  rest -= ctr;
  const aft = Math.min(rest, L.aftTankLb);
  return [wing, ctr, wing, aft].map((x) => x * LB);
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
  const tanks = GLOBAL6000_FDM.mass.tanks;
  const bowKg = GLOBAL6000_FDM.mass.emptyMass_kg + 400 * LB + tanks.reduce((a, t) => a + t.unusable_kg, 0);
  const maxPayloadLb = 5600;
  const fuelLb = o.weightLb
    ? Math.min(G6K_LIMITS.usableFuelLb, Math.max(o.fuelLb ?? Math.max(6000, o.weightLb - bowKg / LB - 1600), o.weightLb - bowKg / LB - maxPayloadLb))
    : (o.fuelLb ?? 20000);
  fuelSplitKg(fuelLb).forEach((kg, i) => vars.set(FUEL.tankKg(i), kg + tanks[i].unusable_kg));
  const fdm = new FlightModel(GLOBAL6000_FDM, vars, world, { seed: 6, magneticYear: 2026.7 });
  if (o.weightLb) {
    let payload = Math.max(0, o.weightLb * LB - bowKg - fuelLb * LB);
    for (const [st, maxLb] of [[2, 900], [3, 1300], [4, 900], [5, 600], [6, 1000]] as const) {
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
  applyG6kState(ctx, sys, state);
  const router = new CommandRouter(vars, events);
  router.setMap(G6K_INPUT_MAP);
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
