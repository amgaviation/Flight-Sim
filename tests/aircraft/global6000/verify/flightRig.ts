/**
 * Full-flight verification rig for the Bombardier Global 6000: real
 * FlightModel, the complete Global 6000 systems list with the Collins Pro Line
 * Fusion suite (four AFDs, CTPs, IESI, FMS windows on fake canvases), the real
 * navigation database, the real SimLoop (systems 60 Hz, FDM 120 Hz) and a
 * two-airport world whose ground is flat at the origin and destination field
 * elevations (linear blend between them).
 *
 * The helpers act as the crew: only cockpit control vars (G6K_VARS), the FCP /
 * CTP / MKP events the 3D panels emit (fusion.*), FMS-window line selects
 * (what the CCP cursor ENTER on a line calls) and the yoke / pedal / toe-brake /
 * tiller inputs. Never system internals.
 */
import { SimVars } from '../../../../src/core/SimVars';
import { EventBus } from '../../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../../src/core/SimLoop';
import type { SimContext } from '../../../../src/core/SimContext';
import { ENV, FDM, FUEL } from '../../../../src/core/vars';
import { distanceNm, initialBearing } from '../../../../src/core/geo';
import type { GroundSample, WorldQuery } from '../../../../src/world/types';
import { FlightModel } from '../../../../src/physics/FlightModel';
import { GLOBAL6000_FDM } from '../../../../src/aircraft/global6000/fdm';
import { createSystems, type G6kSystems } from '../../../../src/aircraft/global6000/createSystems';
import { applyG6kState } from '../../../../src/aircraft/global6000/states';
import { G6K_INPUT_MAP } from '../../../../src/aircraft/global6000/inputMap';
import { CommandRouter } from '../../../../src/input/CommandRouter';
import { ScriptedPilot } from '../../../../src/input/ScriptedPilot';
import type { NavDatabase, Airport } from '../../../../src/nav/types';
import { FUSION_EVENTS } from '../../../../src/avionics/collins-fusion/vars';
import type { LskId } from '../../../../src/avionics/collins-fusion/fms';
import { fakeCanvas } from '../../../avionics/collins-fusion/helpers';
import { AUDIO, LB, fuelSplitKg } from '../helpers';

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
  sys: G6kSystems;
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
  /** Cabin payload (lb) beyond the crew in the BOW. */
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
  const tanks = GLOBAL6000_FDM.mass.tanks;
  fuelSplitKg(o.fuelLb).forEach((kg, i) => vars.set(FUEL.tankKg(i), kg + tanks[i].unusable_kg));
  const fdm = new FlightModel(GLOBAL6000_FDM, vars, world, { seed: 60, magneticYear: 2026.7 });
  // Cabin stations 2..6, same split as tests/aircraft/global6000/helpers.ts.
  let payload = o.payloadLb * LB;
  for (const [st, maxLb] of [[2, 900], [3, 1300], [4, 900], [5, 600], [6, 1000]] as const) {
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
  applyG6kState(ctx, sys, 'cold_dark');
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

/** An FCP button / knob event (FUSION_EVENTS.fcp). */
export function fcp(r: FlightRig, id: string, payload?: unknown): void {
  r.events.emit(FUSION_EVENTS.fcp(id), payload);
  r.run(0.2);
}

/** A CTP event of side `s` (e.g. baro_push). */
export function ctp(r: FlightRig, s: 1 | 2, id: string): void {
  r.events.emit(FUSION_EVENTS.ctp(s, id));
  r.run(0.1);
}

/** An MKP key of side `s`. */
export function mkp(r: FlightRig, k: string, s: 1 | 2 = 1): void {
  r.events.emit(FUSION_EVENTS.mkpKey(s), k);
}

/** Types a string on the side-`s` MKP. */
export function type(r: FlightRig, text: string, s: 1 | 2 = 1): void {
  for (const ch of text) mkp(r, ch === ' ' ? 'SP' : ch === '.' ? 'DOT' : ch === '/' ? 'SLASH' : ch, s);
}

/** Line select on the side-`s` FMS window (the CCP cursor ENTER on that line). */
export function lsk(r: FlightRig, k: LskId, s: 1 | 2 = 1): void {
  r.sys.suite!.fmsWin[s - 1].lsk(k);
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
