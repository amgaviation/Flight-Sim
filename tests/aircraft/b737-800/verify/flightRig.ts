/**
 * Full-flight verification rig for the 737-800: real FlightModel, the complete
 * systems list with the headless 737NG suite (radios, FMS, FMC + 2 CDUs, MCP /
 * AFDS / A/T), the real navigation database, the real SimLoop (systems 60 Hz,
 * FDM 120 Hz) and a two-airport world whose ground is flat at the origin and
 * destination field elevations (linear blend in between).
 *
 * The helpers are the "crew": they act only through cockpit control vars, MCP
 * / EFIS events and CDU keys (event `ac.cdu<s>.key`, the same path as the 3D
 * CDU keyboard), never through system internals.
 */
import { SimVars } from '../../../../src/core/SimVars';
import { EventBus } from '../../../../src/core/EventBus';
import { SimLoop, ManualScheduler } from '../../../../src/core/SimLoop';
import type { SimContext } from '../../../../src/core/SimContext';
import { ENV, FDM, FUEL } from '../../../../src/core/vars';
import { distanceNm, initialBearing } from '../../../../src/core/geo';
import type { GroundSample, WorldQuery } from '../../../../src/world/types';
import { FlightModel } from '../../../../src/physics/FlightModel';
import { B738_FDM } from '../../../../src/aircraft/b737-800/fdm';
import { createSystems, type B738Systems } from '../../../../src/aircraft/b737-800/createSystems';
import { applyB738State } from '../../../../src/aircraft/b737-800/states';
import { B738_INPUT_MAP } from '../../../../src/aircraft/b737-800/inputMap';
import { CommandRouter } from '../../../../src/input/CommandRouter';
import type { NavDatabase, Airport } from '../../../../src/nav/types';
import { AUDIO } from '../helpers';

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
  sys: B738Systems;
  ctx: SimContext;
  loop: SimLoop;
  t: number;
  /** Advances `seconds` of sim time; `each` returning true stops early. Returns the time actually run. */
  run(seconds: number, each?: (t: number) => boolean | void): number;
}

export function makeFlightRig(o: {
  db: NavDatabase;
  origin: Airport;
  dest: Airport;
  start: { lat: number; lon: number; headingTrue: number };
  /** Fuel per tank (kg): [main 1, main 2, centre]. */
  fuelKg: [number, number, number];
  /** Scale of the default cabin / hold payload (1 = 14 t). */
  payloadScale?: number;
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
  vars.set('env.time_utc_h', o.utcH ?? 17);
  o.fuelKg.forEach((kg, i) => vars.set(FUEL.tankKg(i), kg));
  const fdm = new FlightModel(B738_FDM, vars, world, { seed: 11, magneticYear: 2026.7 });
  const scale = o.payloadScale ?? 1;
  B738_FDM.mass.stations.forEach((s, i) => fdm.setStationMass(i, s.defaultMass_kg * scale));
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
  const sys = createSystems(ctx, { noDisplays: true, nav: o.db });
  fdm.reposition({ lat: o.start.lat, lon: o.start.lon, onGround: true, headingTrue: o.start.headingTrue });
  applyB738State(ctx, sys, 'cold_dark');
  const router = new CommandRouter(vars, events);
  router.setMap(B738_INPUT_MAP);
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

/** FMA snapshot as the PFD shows it: "A/T | roll [armed] | pitch [armed] | status". */
export function fma(r: FlightRig): string {
  const v = r.vars;
  const s = (n: string) => v.getString(`ac.fma.${n}`);
  return `${s('at')} | ${s('roll')}[${s('roll_armed')}] | ${s('pitch')}[${s('pitch_armed')}] | ${s('status')}`;
}

/** A momentary control held for `s` seconds, then released to 0. */
export function press(r: FlightRig, name: string, s = 0.3, value = 1): void {
  r.vars.set(name, value);
  r.run(s);
  r.vars.set(name, 0);
}

/** An MCP push button (event `ac.mcp.<id>`). */
export function mcp(r: FlightRig, id: string): void {
  r.events.emit(`ac.mcp.${id}`);
  r.run(0.2);
}

/** CDU 1 key presses (the 3D keyboard emits the same event). */
export function cdu(r: FlightRig, ...keys: string[]): void {
  for (const k of keys) {
    r.events.emit('ac.cdu1.key', k);
    r.run(0.1);
  }
}

/** Types text into the CDU 1 scratchpad, then presses a line select key. */
export function cduEnter(r: FlightRig, text: string, lsk: string): void {
  for (const ch of text.toUpperCase()) r.events.emit('ac.cdu1.key', ch === ' ' ? 'SP' : ch === '-' ? '+/-' : ch);
  cdu(r, lsk);
}

/** CDU 1 screen lines as the crew reads them. */
export function cduScreen(r: FlightRig): string[] {
  return r.sys.suite.cdus[0].render().lines();
}

/**
 * Presses the line select key next to `text` on the current CDU page, paging
 * forward (NEXT PAGE) up to `pages` times. Returns false if not found.
 */
export function cduSelect(r: FlightRig, text: string, pages = 8): boolean {
  for (let p = 0; p <= pages; p++) {
    const lines = cduScreen(r);
    for (let row = 1; row <= 6; row++) {
      const line = lines[2 * row] ?? '';
      const at = line.indexOf(text);
      if (at < 0) continue;
      cdu(r, `${at < 12 ? 'L' : 'R'}${row}`);
      return true;
    }
    cdu(r, 'NEXT_PAGE');
  }
  return false;
}

export function bearingTo(r: FlightRig, lat: number, lon: number): number {
  return initialBearing(r.vars.get(FDM.lat), r.vars.get(FDM.lon), lat, lon);
}

export function distTo(r: FlightRig, lat: number, lon: number): number {
  return distanceNm(r.vars.get(FDM.lat), r.vars.get(FDM.lon), lat, lon);
}

export const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
