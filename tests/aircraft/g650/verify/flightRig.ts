/**
 * Full-flight verification rig for the Gulfstream G650: real FlightModel, the
 * complete G650 systems list with the Primus Epic PlaneView II suite (radios,
 * FMS, three pedestal MCDUs on fake canvases), the real navigation database,
 * the real SimLoop (systems 60 Hz, FDM 120 Hz) and a two-airport world whose
 * ground is flat at the origin and destination field elevations (linear blend
 * between them).
 *
 * The helpers act as the crew: only cockpit control vars (G650_VARS), the
 * guidance-panel events (epic.gp.*), MCDU key presses (Mcdu.key, what the 3D
 * MCDU keys call) and the yoke / pedal / toe-brake / tiller inputs. Never
 * system internals.
 */
import { SimVars } from '../../../../src/core/SimVars';
import { EventBus } from '../../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../../src/core/SimLoop';
import type { SimContext } from '../../../../src/core/SimContext';
import { ENV, FDM, FUEL } from '../../../../src/core/vars';
import { distanceNm, initialBearing } from '../../../../src/core/geo';
import type { GroundSample, WorldQuery } from '../../../../src/world/types';
import { FlightModel } from '../../../../src/physics/FlightModel';
import { G650_FDM } from '../../../../src/aircraft/g650/fdm';
import { createSystems, type G650Systems } from '../../../../src/aircraft/g650/createSystems';
import { applyG650State } from '../../../../src/aircraft/g650/states';
import { G650_INPUT_MAP } from '../../../../src/aircraft/g650/inputMap';
import { CommandRouter } from '../../../../src/input/CommandRouter';
import { ScriptedPilot } from '../../../../src/input/ScriptedPilot';
import type { NavDatabase, Airport } from '../../../../src/nav/types';
import type { Mcdu } from '../../../../src/avionics/honeywell-epic/fms';
import { fakeCanvas } from '../../../avionics/honeywell-epic/helpers';
import { AUDIO, LB } from '../helpers';

const FT = 0.3048;

/** Ground at `a` within `flatNm` of it, at `b` near it, blended linearly (by distance) in between. */
export class TwoFieldWorld implements WorldQuery {
  private readonly s: GroundSample = { elevation_m: 0, normal: [0, 0, 1], surface: 'asphalt', precise: true };
  constructor(
    private readonly a: { lat: number; lon: number; elevFt: number },
    private readonly b: { lat: number; lon: number; elevFt: number },
    private readonly flatNm = 8,
  ) {}
  elevationAt(lat: number, lon: number): number {
    const da = Math.max(0, distanceNm(lat, lon, this.a.lat, this.a.lon) - this.flatNm);
    const db = Math.max(0, distanceNm(lat, lon, this.b.lat, this.b.lon) - this.flatNm);
    const w = da + db > 0 ? da / (da + db) : 0;
    return (this.a.elevFt + (this.b.elevFt - this.a.elevFt) * w) * FT;
  }
  sampleGround(lat: number, lon: number): GroundSample {
    this.s.elevation_m = this.elevationAt(lat, lon);
    return this.s;
  }
  async ensureLoaded(): Promise<void> {}
}

export interface FlightRig {
  vars: SimVars;
  events: EventBus;
  fdm: FlightModel;
  sys: G650Systems;
  ctx: SimContext;
  loop: SimLoop;
  router: CommandRouter;
  pilot: ScriptedPilot;
  /** Elapsed sim time (s). */
  t: number;
  /** Advances `seconds` of sim time; `each` returning true stops early. Returns the time actually run. */
  run(seconds: number, each?: (t: number) => boolean | void): number;
}

export function makeFlightRig(o: {
  db: NavDatabase;
  origin: Airport;
  dest: Airport;
  start: { lat: number; lon: number; headingTrue: number };
  fuelLb: number;
  /** Cabin payload (lb) beyond the 2 crew in the BOW. */
  payloadLb: number;
}): FlightRig {
  const vars = new SimVars();
  const events = new EventBus();
  const world = new TwoFieldWorld(
    { lat: o.origin.lat, lon: o.origin.lon, elevFt: o.origin.elevationFt },
    { lat: o.dest.lat, lon: o.dest.lon, elevFt: o.dest.elevationFt },
  );
  vars.set(ENV.qnhInHg, 29.92);
  vars.set(ENV.qnhRefElevFt, 0);
  vars.set(ENV.oatSeaLevelC, 15);
  vars.set(ENV.ambientLight, 1);
  vars.set(ENV.surfaceWindDir, 0);
  vars.set(ENV.surfaceWindKt, 0);
  vars.set('env.time_utc_h', 16);
  const tanks = G650_FDM.mass.tanks;
  const fuelKg = o.fuelLb * LB;
  tanks.forEach((t, i) => vars.set(FUEL.tankKg(i), Math.min(t.capacity_kg, fuelKg / 2 + t.unusable_kg)));
  const fdm = new FlightModel(G650_FDM, vars, world, { seed: 17, magneticYear: 2026.7 });
  // Cabin stations 2..6 (forward club .. baggage), same split as tests/aircraft/g650/helpers.ts.
  let payload = o.payloadLb * LB;
  for (const [st, maxLb] of [[2, 800], [3, 1200], [4, 1200], [5, 600], [6, 2500]] as const) {
    const m = Math.min(payload, maxLb * LB);
    fdm.setStationMass(st, m);
    payload -= m;
  }
  const store = new Map<string, unknown>();
  const ctx: SimContext = {
    vars,
    events,
    world,
    nav: o.db,
    audio: AUDIO,
    fdm,
    storage: { get: <T>(k: string, f: T) => (store.has(k) ? (store.get(k) as T) : f), set: (k, x) => void store.set(k, x) },
  };
  const sys = createSystems(ctx, { canvas: fakeCanvas });
  fdm.reposition({ lat: o.start.lat, lon: o.start.lon, onGround: true, headingTrue: o.start.headingTrue });
  applyG650State(ctx, sys, 'cold_dark');
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
  const rig: FlightRig = {
    vars,
    events,
    fdm,
    sys,
    ctx,
    loop,
    router,
    pilot,
    t: 0,
    run(seconds, each) {
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) {
        loop.advance(1 / 60);
        rig.t += 1 / 60;
        if (each && each(i / 60) === true) return i / 60;
      }
      return seconds;
    },
  };
  return rig;
}

/** Active CAS message texts. */
export function casActive(r: FlightRig, level?: 'warning' | 'caution' | 'advisory' | 'status'): string[] {
  return r.sys.cas.list.filter((e) => e.active && (!level || e.level === level)).map((e) => e.text);
}

/** FMA snapshot: "lat[armed] / vert[armed] / AT". */
export function fma(r: FlightRig): string {
  const v = r.vars;
  return `${v.getString('ap.lat_active')}[${v.getString('ap.lat_armed')}] / ${v.getString('ap.vert_active')}[${v.getString('ap.vert_armed')}] / ${v.getString('ap.at_mode')}${v.get('ap.engaged') ? ' AP' : ''}`;
}

/** A momentary control: pressed for `s` seconds then released. */
export function press(r: FlightRig, name: string, s = 0.3): void {
  r.vars.set(name, 1);
  r.run(s);
  r.vars.set(name, 0);
}

/** A guidance panel key. */
export function gp(r: FlightRig, key: string): void {
  r.events.emit(`epic.gp.${key}`);
  r.run(0.2);
}

/** Types a string into an MCDU scratchpad. */
export function type(m: Mcdu, s: string): void {
  for (const ch of s) m.key(ch === ' ' ? 'SP' : ch);
}

/** Runs the sim while letting asynchronous procedure loads resolve. */
export async function settle(r: FlightRig, ms = 200): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((res) => setTimeout(res, ms / 10));
    r.run(0.1);
  }
}

export function bearingTo(r: FlightRig, lat: number, lon: number): number {
  return initialBearing(r.vars.get(FDM.lat), r.vars.get(FDM.lon), lat, lon);
}

export const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
