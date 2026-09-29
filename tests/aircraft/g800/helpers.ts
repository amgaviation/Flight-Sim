/**
 * Headless Gulfstream G800 rig: real FlightModel + the aircraft's complete
 * systems list (optionally with radios, FMS and the Symmetry suite on fake
 * canvases), driven by the real SimLoop with a ManualScheduler (systems 60 Hz,
 * FDM 120 Hz) on a flat world (docs/modules/qa.md §6).
 */
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../src/core/SimLoop';
import type { SimContext } from '../../../src/core/SimContext';
import { ENV, FDM, FUEL } from '../../../src/core/vars';
import { FlightModel } from '../../../src/physics/FlightModel';
import { G800_FDM } from '../../../src/aircraft/g800/fdm';
import { createG800Systems, type G800Systems } from '../../../src/aircraft/g800/createSystems';
import { applyG800State } from '../../../src/aircraft/g800/states';
import { G800_INPUT_MAP } from '../../../src/aircraft/g800/inputMap';
import { CommandRouter } from '../../../src/input/CommandRouter';
import { ScriptedPilot } from '../../../src/input/ScriptedPilot';
import type { InitialState } from '../../../src/aircraft/types';
import type { NavDatabase } from '../../../src/nav/types';
import type { DisplayCanvas } from '../../../src/avionics/common/CanvasDisplay';
import { FlatWorld } from '../../physics/helpers';

export const LB = 0.45359237;
/** KSAV runway 10 (Gulfstream's home field): 50 ft elevation, runway true course ~ 94 deg. */
export const FIELD = { lat: 32.1276, lon: -81.2021, elevFt: 50, courseTrue: 94 };

const noop = () => undefined;
export const AUDIO: SimContext['audio'] = { play: noop, loop: () => ({ setGain: noop, setRate: noop, stop: noop }), callout: noop, tone: noop };

/** A canvas stand-in with a no-op 2D context (the Epic displays construct and draw into it). */
export function fakeCanvas(): DisplayCanvas {
  const c: Record<string, unknown> = { width: 1, height: 1 };
  const grad = { addColorStop() {} };
  const state: Record<string | symbol, unknown> = {
    canvas: c,
    measureText: (s: string) => ({ width: String(s).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createConicGradient: () => grad,
    createPattern: () => ({}),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    getLineDash: () => [],
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
  };
  const ctx = new Proxy(state, {
    get(t, p) {
      if (p in t) return t[p];
      return () => undefined;
    },
    set(t, p, val) {
      t[p] = val;
      return true;
    },
  });
  c.getContext = () => ctx;
  c.toDataURL = () => '';
  return c as unknown as DisplayCanvas;
}

export interface RigOptions {
  /** Gross weight target (lb): fuel split evenly (up to full), rest as cabin payload. */
  weightLb?: number;
  fuelLb?: number;
  air?: { altFtMsl: number; iasKt: number };
  field?: { lat: number; lon: number; elevFt: number; courseTrue: number };
  nav?: NavDatabase;
  avionics?: boolean;
  wind?: { dir: number; kt: number };
  seaLevelTempC?: number;
}

export interface Rig {
  vars: SimVars;
  events: EventBus;
  fdm: FlightModel;
  sys: G800Systems;
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
  const empty = G800_FDM.mass.emptyMass_kg + 400 * LB; // BOW (2 crew in the default stations)
  const tanks = G800_FDM.mass.tanks;
  const fuelLb = Math.min(49400, o.fuelLb ?? (o.weightLb ? Math.min(49400, o.weightLb - empty / LB) : 20000));
  const fuelKg = fuelLb * LB;
  tanks.forEach((t, i) => vars.set(FUEL.tankKg(i), Math.min(t.capacity_kg, fuelKg / 2 + t.unusable_kg)));
  const fdm = new FlightModel(G800_FDM, vars, world, { seed: 7, magneticYear: 2026.7 });
  if (o.weightLb) {
    let payload = Math.max(0, o.weightLb * LB - empty - fuelKg - 2 * tanks[0].unusable_kg);
    // Stations 2..6: forward club, conference, aft lounge, stateroom, baggage.
    for (const st of [3, 4, 2, 5, 6]) {
      const cap = G800_FDM.mass.stations[st].maxMass_kg;
      const m = Math.min(cap, payload);
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
  const sys = createG800Systems(ctx, { noAvionics: o.avionics !== true, canvas: fakeCanvas });
  if (o.air) fdm.reposition({ lat: field.lat, lon: field.lon, altFtMsl: o.air.altFtMsl, iasKt: o.air.iasKt, headingTrue: field.courseTrue });
  else fdm.reposition({ lat: field.lat, lon: field.lon, onGround: true, headingTrue: field.courseTrue });
  applyG800State(ctx, sys, state);
  const router = new CommandRouter(vars, events);
  router.setMap(G800_INPUT_MAP);
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

/** Currently posted CAS texts at a level. */
export function casTexts(r: Rig, level?: 'warning' | 'caution' | 'advisory' | 'status'): string[] {
  return r.sys.cas.list.filter((e) => e.active && (!level || e.level === level)).map((e) => e.text);
}
