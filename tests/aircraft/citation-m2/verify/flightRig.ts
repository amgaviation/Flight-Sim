/**
 * Full-flight verification rig for the Citation M2: real FlightModel, the
 * complete M2 systems list with the headless G3000 suite (radios, FMS, G3000
 * system, GMC 710) and the GFC 700 AFCS, the real navigation database, the
 * real SimLoop (systems 60 Hz, FDM 120 Hz) and CommandRouter, and a
 * two-airport world whose ground is flat at the origin and destination field
 * elevations (linear blend in between).
 *
 * The helpers are the "crew": they act only through the cockpit control vars
 * (vars.ts), the pilot inputs (yoke / pedals / toe brakes), the GMC 710 keys
 * and the G3000 flight-plan / TOLD logic (FplEditor, the back end of the GTC
 * pages), never through system internals.
 */
import { SimVars } from '../../../../src/core/SimVars';
import { EventBus } from '../../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../../src/core/SimLoop';
import type { SimContext } from '../../../../src/core/SimContext';
import { ENV, FDM, FUEL } from '../../../../src/core/vars';
import { distanceNm, initialBearing } from '../../../../src/core/geo';
import type { GroundSample, WorldQuery } from '../../../../src/world/types';
import { FlightModel } from '../../../../src/physics/FlightModel';
import { CITATION_M2_FDM } from '../../../../src/aircraft/citation-m2/fdm';
import { createSystems, type M2Systems } from '../../../../src/aircraft/citation-m2/createSystems';
import { applyM2State } from '../../../../src/aircraft/citation-m2/states';
import { M2_INPUT_MAP } from '../../../../src/aircraft/citation-m2/inputMap';
import { M2_CHECKLISTS } from '../../../../src/aircraft/citation-m2/checklists';
import { CommandRouter } from '../../../../src/input/CommandRouter';
import type { NavDatabase, Airport } from '../../../../src/nav/types';
import { AUDIO, LB } from '../helpers';

const FT = 0.3048;

/** Ground at `a` within `flatNm` of it, at `b` near it, blended linearly (by distance) in between. */
export class TwoFieldWorld implements WorldQuery {
  private readonly s: GroundSample = { elevation_m: 0, normal: [0, 0, 1], surface: 'asphalt', precise: true };
  constructor(
    private readonly a: { lat: number; lon: number; elevFt: number },
    private readonly b: { lat: number; lon: number; elevFt: number },
    private readonly flatNm = 6,
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
  sys: M2Systems;
  ctx: SimContext;
  loop: SimLoop;
  router: CommandRouter;
  /** Sim time since the rig was built (s). */
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
  /** Passengers / bags in the cabin (lb), single pilot (FDM default 200 lb). */
  payloadLb: number;
  utcH?: number;
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
  vars.set('env.time_utc_h', o.utcH ?? 16);
  const tanks = CITATION_M2_FDM.mass.tanks;
  const fuelKg = o.fuelLb * LB;
  tanks.forEach((t, i) => vars.set(FUEL.tankKg(i), Math.min(t.capacity_kg, fuelKg / 2 + t.unusable_kg)));
  const fdm = new FlightModel(CITATION_M2_FDM, vars, world, { seed: 7, magneticYear: 2026.7 });
  // Club seats first (600 lb per pair), then the side-facing seat.
  let rest = o.payloadLb * LB;
  for (const [st, maxLb] of [[3, 600], [4, 600], [2, 300]] as const) {
    const m = Math.min(rest, maxLb * LB);
    fdm.setStationMass(st, m);
    rest -= m;
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
  const sys = createSystems(ctx, { noDisplays: true, checklists: M2_CHECKLISTS });
  fdm.reposition({ lat: o.start.lat, lon: o.start.lon, onGround: true, headingTrue: o.start.headingTrue });
  applyM2State(ctx, sys, 'cold_dark');
  const router = new CommandRouter(vars, events);
  router.setMap(M2_INPUT_MAP);
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
  const rig: FlightRig = {
    vars,
    events,
    fdm,
    sys,
    ctx,
    loop,
    router,
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

/** Active CAS message texts (optionally one level). */
export function casActive(r: FlightRig, level?: 'warning' | 'caution' | 'advisory' | 'status'): string[] {
  return r.sys.cas.list.filter((e) => e.active && (!level || e.level === level)).map((e) => e.text);
}

/** FMA snapshot: "lat[armed] / vert[armed] AP YD". */
export function fma(r: FlightRig): string {
  const v = r.vars;
  return `${v.getString('ap.lat_active')}[${v.getString('ap.lat_armed')}] / ${v.getString('ap.vert_active')}[${v.getString('ap.vert_armed')}]${v.get('ap.engaged') ? ' AP' : ''}${v.get('ap.yd_engaged') ? ' YD' : ''}`;
}

/** A momentary push button: pressed for `s` then released. */
export function press(r: FlightRig, name: string, s = 0.3): void {
  r.vars.set(name, 1);
  r.run(s);
  r.vars.set(name, 0);
}

/** GMC 710 key. */
export function gmc(r: FlightRig, key: string): void {
  r.events.emit(`g3k.gmc.key_${key}`);
  r.run(0.2);
}

export function bearingTo(r: FlightRig, lat: number, lon: number): number {
  return initialBearing(r.vars.get(FDM.lat), r.vars.get(FDM.lon), lat, lon);
}

export function distTo(r: FlightRig, lat: number, lon: number): number {
  return distanceNm(r.vars.get(FDM.lat), r.vars.get(FDM.lon), lat, lon);
}

export const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
