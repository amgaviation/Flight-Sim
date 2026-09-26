import type { GroundSample, WorldQuery } from '../../src/world/types';
import { SimVars } from '../../src/core/SimVars';
import { ENG, FUEL, GEAR, SURF } from '../../src/core/vars';
import { FlightModel } from '../../src/physics/FlightModel';
import type { FdmConfig } from '../../src/physics/types';
import { EARTH_RADIUS_M } from '../../src/core/geo';

/** Flat, uniform test world (optionally sloped along +north). */
export class FlatWorld implements WorldQuery {
  private readonly s: GroundSample;
  calls = 0;
  constructor(
    public elevation_m = 100,
    surface: GroundSample['surface'] = 'asphalt',
    /** Rise per metre northward (0 = level). */
    public slopeNorth = 0,
    private readonly refLat = 47.45,
  ) {
    const k = Math.hypot(slopeNorth, 1);
    this.s = { elevation_m, normal: [0, -slopeNorth / k, 1 / k], surface, precise: true };
  }
  sampleGround(lat: number, _lon: number): GroundSample {
    this.calls++;
    this.s.elevation_m = this.elevationAt(lat, _lon);
    return this.s;
  }
  elevationAt(lat: number, _lon: number): number {
    const north = ((lat - this.refLat) * Math.PI * EARTH_RADIUS_M) / 180;
    return this.elevation_m + this.slopeNorth * north;
  }
  async ensureLoaded(): Promise<void> {}
}

export const SEA_TAC = { lat: 47.45, lon: -122.31 };

/** Creates vars + FDM with full fuel and default payload. */
export function makeFdm(config: FdmConfig, world: WorldQuery = new FlatWorld(), fuelFraction = 1) {
  const vars = new SimVars();
  config.mass.tanks.forEach((t, i) => vars.set(FUEL.tankKg(i), t.capacity_kg * fuelFraction));
  const fdm = new FlightModel(config, vars, world, { seed: 1, magneticYear: 2026.7 });
  return { vars, fdm, world };
}

export function run(fdm: FlightModel, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds * 120);
  for (let i = 0; i < n; i++) {
    fdm.step(1 / 120);
    each?.(i / 120);
  }
}

/** Horizontal distance (m) between two lat/lon points (local flat approximation). */
export function horizDist(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dn = ((b.lat - a.lat) * Math.PI * EARTH_RADIUS_M) / 180;
  const de = ((b.lon - a.lon) * Math.PI * EARTH_RADIUS_M * Math.cos((a.lat * Math.PI) / 180)) / 180;
  return Math.hypot(dn, de);
}

/** Jet engines ready: fuel on, n1 command (0 = idle). */
export function jetEnginesOn(vars: SimVars, fdm: FlightModel, n1Cmd = 0): void {
  for (const i of [1, 2]) {
    vars.set(ENG.fuelOn(i), 1);
    vars.set(ENG.n1Cmd(i), n1Cmd);
  }
  fdm.setEnginesRunning(true);
}

export function pistonEngineOn(vars: SimVars, fdm: FlightModel, throttle = 0): void {
  vars.set(ENG.fuelOn(1), 1);
  vars.set(ENG.magLeft(1), 1);
  vars.set(ENG.magRight(1), 1);
  vars.set(ENG.mixture(1), 1);
  vars.set(ENG.throttle(1), throttle);
  fdm.setEnginesRunning(true);
}

export function setBrakes(vars: SimVars, v: number): void {
  vars.set(GEAR.brakeLeft, v);
  vars.set(GEAR.brakeRight, v);
}

export function setFlaps(vars: SimVars, deg: number): void {
  vars.set(SURF.flapsDeg, deg);
}
