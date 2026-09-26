/**
 * Headless Citation M2 rig: real FlightModel + the complete M2 systems list
 * (incl. the headless G3000 suite and AFCS) through the real SimLoop and
 * CommandRouter, on a flat world (docs/modules/qa.md §6 pattern).
 */
import { vi } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../src/core/SimLoop';
import type { SimContext } from '../../../src/core/SimContext';
import { ENV, FUEL } from '../../../src/core/vars';
import { FlightModel } from '../../../src/physics/FlightModel';
import { CITATION_M2_FDM } from '../../../src/aircraft/citation-m2/fdm';
import { createSystems, type M2Systems } from '../../../src/aircraft/citation-m2/createSystems';
import { applyM2State } from '../../../src/aircraft/citation-m2/states';
import { M2_INPUT_MAP } from '../../../src/aircraft/citation-m2/inputMap';
import { CommandRouter } from '../../../src/input/CommandRouter';
import { ScriptedPilot } from '../../../src/input/ScriptedPilot';
import type { InitialState } from '../../../src/aircraft/types';
import type { NavDatabase } from '../../../src/nav/types';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';
import { FlatWorld } from '../../physics/helpers';

export const LB = 0.45359237;

// Full-systems runs take seconds each; keep them clear of the 5 s default under parallel load.
vi.setConfig({ testTimeout: 120000 });

let db: NavDatabaseImpl | null = null;
export async function loadNav(): Promise<NavDatabaseImpl> {
  if (!db) {
    db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
  }
  return db;
}

const noop = () => undefined;
export const AUDIO: SimContext['audio'] = { play: noop, loop: () => ({ setGain: noop, setRate: noop, stop: noop }), callout: noop, tone: noop };

/** KTEB-like field: 9 ft, runway 01 true course 6 deg (as the test jet integration test). */
export const FIELD = { lat: 40.8501, lon: -74.0608, elevFt: 9, courseTrue: 6 };

export interface RigOptions {
  state: InitialState;
  /** Total fuel (lb), split evenly; default 2,000 lb. */
  fuelLb?: number;
  /** Extra payload in the club seats (lb). Default 0 (single pilot 200 lb from the FDM defaults). */
  payloadLb?: number;
  air?: { altFtMsl: number; iasKt: number; headingTrue?: number; lat?: number; lon?: number };
  field?: { lat: number; lon: number; elevFt: number; courseTrue: number };
  nav?: NavDatabase;
  oatSeaLevelC?: number;
  wind?: { dir: number; kt: number };
  /** Hook run after the systems are created and before the state is applied (e.g. tune radios). */
  beforeState?: (ctx: SimContext, sys: M2Systems) => void;
}

export interface Rig {
  vars: SimVars;
  events: EventBus;
  fdm: FlightModel;
  sys: M2Systems;
  pilot: ScriptedPilot;
  ctx: SimContext;
  /** Runs `seconds` of sim time in 60 Hz frames; `each` after every frame (return true to stop early). */
  run(seconds: number, each?: () => boolean | void): number;
}

export function makeM2(o: RigOptions): Rig {
  const field = o.field ?? FIELD;
  const vars = new SimVars();
  const events = new EventBus();
  const world = new FlatWorld(field.elevFt * 0.3048, 'asphalt', 0, field.lat);
  vars.set(ENV.qnhInHg, 29.92);
  vars.set(ENV.oatSeaLevelC, o.oatSeaLevelC ?? 15);
  vars.set(ENV.ambientLight, 1);
  vars.set(ENV.surfaceWindDir, o.wind?.dir ?? 0);
  vars.set(ENV.surfaceWindKt, o.wind?.kt ?? 0);
  const fuel = (o.fuelLb ?? 2000) * LB;
  vars.set(FUEL.tankKg(0), fuel / 2);
  vars.set(FUEL.tankKg(1), fuel / 2);
  const fdm = new FlightModel(CITATION_M2_FDM, vars, world, { seed: 5, magneticYear: 2026.7 });
  if (o.payloadLb) {
    // Club seats first (600 lb each), then the side-facing and lavatory seats (300 lb each).
    let rest = o.payloadLb * LB;
    for (const [st, maxLb] of [[3, 600], [4, 600], [2, 300], [5, 300]] as const) {
      const m = Math.min(rest, maxLb * LB);
      fdm.setStationMass(st, m);
      rest -= m;
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
  const sys = createSystems(ctx, { noDisplays: true });
  const a = o.air;
  if (a) fdm.reposition({ lat: a.lat ?? field.lat, lon: a.lon ?? field.lon, altFtMsl: a.altFtMsl, iasKt: a.iasKt, headingTrue: a.headingTrue ?? field.courseTrue });
  else fdm.reposition({ lat: field.lat, lon: field.lon, onGround: true, headingTrue: field.courseTrue });
  o.beforeState?.(ctx, sys);
  applyM2State(ctx, sys, o.state);
  const router = new CommandRouter(vars, events);
  router.setMap(M2_INPUT_MAP);
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
  const run = (seconds: number, each?: () => boolean | void): number => {
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) {
      loop.advance(1 / 60);
      if (each?.()) return (i + 1) / 60;
    }
    return seconds;
  };
  return { vars, events, fdm, sys, pilot, ctx, run };
}

/** Holds a value until `seconds` (tests set momentary buttons this way). */
export function press(rig: Rig, v: string, seconds = 0.3): void {
  rig.vars.set(v, 1);
  rig.run(seconds);
  rig.vars.set(v, 0);
}
