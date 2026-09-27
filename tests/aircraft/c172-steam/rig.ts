/**
 * Headless Cessna 172S steam-gauge rig: real FlightModel, the complete c172-steam systems list
 * (c172s-common core + Bendix/King NAV II + KAP 140) through the real SimLoop and CommandRouter.
 * World: flat (FlatWorld) or two fields (TwoFieldWorld) for the check ride. Nav database: a stub
 * (`ready: false`) unless a loaded NavDatabaseImpl is passed.
 */
import { vi } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../src/core/SimLoop';
import type { SimContext } from '../../../src/core/SimContext';
import { ENV, FUEL } from '../../../src/core/vars';
import type { InitialState } from '../../../src/aircraft/types';
import type { NavDatabase } from '../../../src/nav/types';
import type { WorldQuery } from '../../../src/world/types';
import { FlightModel } from '../../../src/physics/FlightModel';
import { CommandRouter } from '../../../src/input/CommandRouter';
import { C172S_FDM } from '../../../src/aircraft/c172s-common/fdm';
import { createC172SteamSystems, type C172SteamSystems } from '../../../src/aircraft/c172-steam/createSystems';
import { applyC172SteamState } from '../../../src/aircraft/c172-steam/states';
import { C172_STEAM_INPUT_MAP } from '../../../src/aircraft/c172-steam/inputMap';
import { FlatWorld } from '../../physics/helpers';
import { GAL_KG, payloadFor } from '../c172s-common/helpers';

vi.setConfig({ testTimeout: 300000 });

export interface AudioLog {
  tones: Map<string, boolean>;
  toneOn: string[];
  callouts: string[];
  plays: string[];
}

export function recordingAudio(): { audio: SimContext['audio']; log: AudioLog } {
  const log: AudioLog = { tones: new Map(), toneOn: [], callouts: [], plays: [] };
  const audio: SimContext['audio'] = {
    play: (id: string) => void log.plays.push(id),
    loop: () => ({ setGain: () => undefined, setRate: () => undefined, stop: () => undefined }),
    callout: (text: string) => void log.callouts.push(text),
    tone: (id: string, on: boolean) => {
      if (on && !log.tones.get(id)) log.toneOn.push(id);
      log.tones.set(id, on);
    },
  };
  return { audio, log };
}

/** Nav database stub: every query is guarded by `ready`. */
export const NO_DB = { ready: false } as unknown as NavDatabase;

export interface SteamRigOptions {
  state: InitialState;
  field?: { lat: number; lon: number; elevFt: number; courseTrue: number };
  air?: { altFtMsl: number; iasKt: number; headingTrue?: number };
  fuelGalPerTank?: number;
  grossLb?: number;
  db?: NavDatabase;
  world?: WorldQuery;
  utcH?: number;
  wind?: { dir: number; kt: number };
}

export interface SteamRig {
  vars: SimVars;
  events: EventBus;
  fdm: FlightModel;
  sys: C172SteamSystems;
  ctx: SimContext;
  router: CommandRouter;
  log: AudioLog;
  run(seconds: number, each?: (t: number) => boolean | void): number;
  t(): number;
}

export const FIELD = { lat: 40.0, lon: -100.0, elevFt: 0, courseTrue: 0 };

export function makeSteamRig(o: SteamRigOptions): SteamRig {
  const field = o.field ?? FIELD;
  const vars = new SimVars();
  const events = new EventBus();
  const world = o.world ?? new FlatWorld(field.elevFt * 0.3048, 'asphalt', 0, field.lat);
  vars.set(ENV.qnhInHg, 29.92);
  vars.set(ENV.oatSeaLevelC, 15);
  vars.set(ENV.ambientLight, 1);
  vars.set(ENV.surfaceWindDir, o.wind?.dir ?? 0);
  vars.set(ENV.surfaceWindKt, o.wind?.kt ?? 0);
  vars.set('env.time_utc_h', o.utcH ?? 16);
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
  const { audio, log } = recordingAudio();
  const store = new Map<string, unknown>();
  const ctx: SimContext = {
    vars,
    events,
    world,
    nav: o.db ?? NO_DB,
    audio,
    fdm,
    storage: { get: <T>(k: string, fb: T) => (store.has(k) ? (store.get(k) as T) : fb), set: (k, x) => void store.set(k, x) },
  };
  const sys = createC172SteamSystems(ctx);
  const a = o.air;
  if (a) fdm.reposition({ lat: field.lat, lon: field.lon, altFtMsl: a.altFtMsl, iasKt: a.iasKt, headingTrue: a.headingTrue ?? field.courseTrue });
  else fdm.reposition({ lat: field.lat, lon: field.lon, onGround: true, headingTrue: field.courseTrue });
  applyC172SteamState(ctx, sys, o.state);
  const router = new CommandRouter(vars, events);
  router.setMap(C172_STEAM_INPUT_MAP);
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
  return { vars, events, fdm, sys, ctx, router, log, run, t: () => simT };
}

/** Presses a momentary button var for `s` seconds. */
export function press(rig: SteamRig, name: string, s = 0.2): void {
  rig.vars.set(name, 1);
  rig.run(s);
  rig.vars.set(name, 0);
  rig.run(1 / 30);
}
