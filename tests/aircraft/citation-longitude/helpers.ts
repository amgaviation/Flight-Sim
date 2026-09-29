/**
 * Headless Citation Longitude rig: real FlightModel + the aircraft's complete
 * systems list (optionally with the G5000 suite, headless), driven by the real
 * SimLoop with a ManualScheduler (systems 60 Hz, FDM 120 Hz), on a flat world.
 */
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../src/core/SimLoop';
import type { SimContext } from '../../../src/core/SimContext';
import { ENV, FDM, FUEL } from '../../../src/core/vars';
import { FlightModel } from '../../../src/physics/FlightModel';
import { CITATION_LONGITUDE_FDM } from '../../../src/aircraft/citation-longitude/fdm';
import { createLongitudeSystems, type LongitudeSystems } from '../../../src/aircraft/citation-longitude/createSystems';
import { applyLongitudeState } from '../../../src/aircraft/citation-longitude/states';
import { LONGITUDE_INPUT_MAP } from '../../../src/aircraft/citation-longitude/inputMap';
import { CommandRouter } from '../../../src/input/CommandRouter';
import { ScriptedPilot } from '../../../src/input/ScriptedPilot';
import type { InitialState } from '../../../src/aircraft/types';
import type { NavDatabase } from '../../../src/nav/types';
import { FlatWorld } from '../../physics/helpers';

export const LB = 0.45359237;
/** KICT runway 1R-like field (BCA flight): 1,333 ft elevation, runway true course ~ 15 deg. */
export const FIELD = { lat: 37.6499, lon: -97.4331, elevFt: 1333, courseTrue: 15 };

const noop = () => undefined;
export const AUDIO: SimContext['audio'] = { play: noop, loop: () => ({ setGain: noop, setRate: noop, stop: noop }), callout: noop, tone: noop };

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
  sys: LongitudeSystems;
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
  // Fuel and payload for the requested weight.
  const empty = CITATION_LONGITUDE_FDM.mass.emptyMass_kg + 400 * LB; // BOW (crew in the default stations)
  const fuelKg = Math.min(14500 * LB, (o.fuelLb ?? (o.weightLb ? Math.min(14500, o.weightLb - empty / LB) : 8000)) * LB);
  const tanks = CITATION_LONGITUDE_FDM.mass.tanks;
  tanks.forEach((t, i) => vars.set(FUEL.tankKg(i), Math.min(t.capacity_kg, fuelKg / 2 + t.unusable_kg)));
  const fdm = new FlightModel(CITATION_LONGITUDE_FDM, vars, world, { seed: 7, magneticYear: 2026.7 });
  if (o.weightLb) {
    const payload = Math.max(0, o.weightLb * LB - empty - fuelKg - 2 * tanks[0].unusable_kg);
    fdm.setStationMass(2, Math.min(800 * LB, payload));
    fdm.setStationMass(3, Math.max(0, Math.min(800 * LB, payload - 800 * LB)));
    fdm.setStationMass(5, Math.max(0, payload - 1600 * LB));
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
  const sys = createLongitudeSystems(ctx, { noDisplays: true, noAvionics: o.avionics === false });
  if (o.air) fdm.reposition({ lat: field.lat, lon: field.lon, altFtMsl: o.air.altFtMsl, iasKt: o.air.iasKt, headingTrue: field.courseTrue });
  else fdm.reposition({ lat: field.lat, lon: field.lon, onGround: true, headingTrue: field.courseTrue });
  applyLongitudeState(ctx, sys, state);
  const router = new CommandRouter(vars, events);
  router.setMap(LONGITUDE_INPUT_MAP);
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
  const rig: Rig = {
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
  return rig;
}

export const ias = (r: Rig) => r.vars.get(FDM.ias);
