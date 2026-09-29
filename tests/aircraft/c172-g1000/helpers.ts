/**
 * Headless Cessna 172S G1000 NXi rig: real FlightModel + the complete c172-g1000 systems list
 * (shared 172S core, headless G1000 suite, GFC 700 Afcs) through the real SimLoop and
 * CommandRouter on a flat world (docs/modules/qa.md §6 pattern). An optional navigation
 * database (the real one for the check ride) is passed through `SimContext.nav`.
 */
import { vi } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../src/core/SimLoop';
import type { SimContext } from '../../../src/core/SimContext';
import { ENV, FUEL } from '../../../src/core/vars';
import { FlightModel } from '../../../src/physics/FlightModel';
import type { InitialState } from '../../../src/aircraft/types';
import type { NavDatabase } from '../../../src/nav/types';
import type { WorldQuery } from '../../../src/world/types';
import { CommandRouter } from '../../../src/input/CommandRouter';
import { C172S_FDM } from '../../../src/aircraft/c172s-common/fdm';
import { createC172G1000Systems, type C172G1000Systems } from '../../../src/aircraft/c172-g1000/createSystems';
import { applyC172G1000State } from '../../../src/aircraft/c172-g1000/states';
import { C172G_INPUT_MAP } from '../../../src/aircraft/c172-g1000/inputMap';
import { C172G_CHECKLISTS } from '../../../src/aircraft/c172-g1000/checklists';
import { FlatWorld } from '../../physics/helpers';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';

export const LB = 0.45359237;
export const GAL_KG = 6 * LB;

vi.setConfig({ testTimeout: 180000 });

const noop = () => undefined;

/** A navigation database with no data (unit tests that do not fly procedures). */
export const EMPTY_NAV: NavDatabase = {
  ready: true,
  load: async () => undefined,
  airport: () => undefined,
  airportsNear: () => [],
  searchAirports: () => [],
  navaidsByIdent: () => [],
  navaidsNear: () => [],
  navaidsOnFreq: () => [],
  fixesByIdent: () => [],
  fixesNear: () => [],
  resolve: () => [],
  airway: () => [],
};

let navDb: NavDatabaseImpl | null = null;
/** The real navigation database from public/data (loaded once). */
export async function loadNav(): Promise<NavDatabaseImpl> {
  if (!navDb) {
    navDb = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await navDb.load();
  }
  return navDb;
}
export const AUDIO: SimContext['audio'] = { play: noop, loop: () => ({ setGain: noop, setRate: noop, stop: noop }), callout: noop, tone: noop };

export interface G1kRigOptions {
  state: InitialState;
  fuelGalPerTank?: number;
  air?: { altFtMsl: number; iasKt: number; headingTrue?: number };
  field?: { lat: number; lon: number; elevFt: number; courseTrue: number };
  nav?: NavDatabase;
  world?: WorldQuery;
  /** Start position on the ground (default the field). */
  start?: { lat: number; lon: number; headingTrue: number };
  audio?: SimContext['audio'];
}

export interface G1kRig {
  vars: SimVars;
  events: EventBus;
  fdm: FlightModel;
  sys: C172G1000Systems;
  ctx: SimContext;
  router: CommandRouter;
  run(seconds: number, each?: (t: number) => boolean | void): number;
  t(): number;
}

export const FIELD = { lat: 40.0, lon: -100.0, elevFt: 0, courseTrue: 0 };

export function makeG1k(o: G1kRigOptions): G1kRig {
  const field = o.field ?? FIELD;
  const vars = new SimVars();
  const events = new EventBus();
  const world = o.world ?? new FlatWorld(field.elevFt * 0.3048, 'asphalt', 0, field.lat);
  vars.set(ENV.qnhInHg, 29.92);
  vars.set(ENV.oatSeaLevelC, 15);
  vars.set(ENV.ambientLight, 1);
  vars.set(ENV.surfaceWindDir, 0);
  vars.set(ENV.surfaceWindKt, 0);
  vars.set('env.time_utc_h', 16);
  const fuelKg = (o.fuelGalPerTank ?? 28) * GAL_KG;
  vars.set(FUEL.tankKg(0), fuelKg);
  vars.set(FUEL.tankKg(1), fuelKg);
  const fdm = new FlightModel(C172S_FDM, vars, world, { seed: 7, magneticYear: 2026.7 });
  const store = new Map<string, unknown>();
  const ctx: SimContext = {
    vars,
    events,
    world,
    nav: o.nav ?? EMPTY_NAV,
    audio: o.audio ?? AUDIO,
    fdm,
    storage: { get: <T>(k: string, fb: T) => (store.has(k) ? (store.get(k) as T) : fb), set: (k, x) => void store.set(k, x) },
  };
  const sys = createC172G1000Systems(ctx, { noDisplays: true, checklists: C172G_CHECKLISTS });
  const a = o.air;
  const st = o.start ?? { lat: field.lat, lon: field.lon, headingTrue: field.courseTrue };
  if (a) fdm.reposition({ lat: st.lat, lon: st.lon, altFtMsl: a.altFtMsl, iasKt: a.iasKt, headingTrue: a.headingTrue ?? st.headingTrue });
  else fdm.reposition({ lat: st.lat, lon: st.lon, onGround: true, headingTrue: st.headingTrue });
  applyC172G1000State(ctx, sys, o.state);
  const router = new CommandRouter(vars, events);
  router.setMap(C172G_INPUT_MAP);
  let simT = 0;
  const loop = new SimLoop(
    vars,
    {
      input: (dt) => router.update(dt),
      systems: (dt) => {
        for (const s of sys.list) s.update(dt);
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
  return { vars, events, fdm, sys, ctx, router, run, t: () => simT };
}

/** Holds a var at `value` for `seconds`, then writes `after` (momentary positions). */
export function hold(rig: G1kRig, name: string, value: number, seconds: number, after: number): void {
  rig.vars.set(name, value);
  rig.run(seconds);
  rig.vars.set(name, after);
}

/** Active CAS texts of the G1000 (CasModel entries). */
export function cas(rig: G1kRig): string[] {
  const m = rig.sys.suite.casModel as unknown as { list?: { active: boolean; text: string }[]; entries?: { active: boolean; text: string }[] };
  const list = m.list ?? m.entries ?? [];
  return list.filter((e) => e.active).map((e) => e.text);
}
