/**
 * WorldQuery core: ground elevation, normal and surface type from loaded
 * terrain tiles plus airport surfaces. Pure (no Three.js, no DOM) so it can be
 * unit tested and used from any thread.
 *
 * Performance: one Mercator transform, 1-3 Map lookups and a bilinear
 * interpolation; runway/airport surfaces are found through a lat/lon grid
 * index. Typical cost well under 5 microseconds. No allocation.
 */
import type { GroundSample, WorldQuery } from './types';
import { ElevationStore, createElevationSample, type ElevationSample } from './terrain/ElevationStore';
import { SurfaceIndex, createFlattenHit, evalFlatten, type FlattenHit } from './airports/surfaces';
import { snowLineM, SNOW_MAX_SLOPE_RAD } from './terrain/biome';
import { metresPerDegree } from './geo';

/** Zoom at or above which terrain counts as "precise" (z12 ~ 38 m pixels at the equator). */
export const PRECISE_ZOOM = 12;
/** Number of GroundSample objects cycled by `sampleGround` (see its doc). */
export const GROUND_SAMPLE_RING = 32;

export function createGroundSample(): GroundSample {
  return { elevation_m: 0, normal: [0, 0, 1], surface: 'unknown', precise: false };
}

export class GroundQuery implements Pick<WorldQuery, 'sampleGround' | 'elevationAt'> {
  private readonly es = createElevationSample();
  private readonly es2 = createElevationSample();
  private readonly hit = createFlattenHit();
  private readonly hit2 = createFlattenHit();
  private readonly ring: GroundSample[] = [];
  private ringPos = 0;
  private readonly mpd = { lat: 0, lon: 0 };
  /** Day of year used for seasonal snow classification. */
  dayOfYear = 172;
  /**
   * Elevation (m) returned when no terrain is loaded at all (e.g. before the
   * first tiles arrive). The World sets it to the nearest airport elevation.
   */
  fallbackElevation = 0;

  constructor(
    readonly store: ElevationStore,
    readonly surfaces: SurfaceIndex,
  ) {
    for (let i = 0; i < GROUND_SAMPLE_RING; i++) this.ring.push(createGroundSample());
  }

  /**
   * WorldQuery.sampleGround. Returns an object from a 32-entry ring buffer
   * (no allocation): it stays valid for the next 31 calls. Copy the fields if
   * you keep them longer, or use `sampleGroundInto`.
   */
  sampleGround(latDeg: number, lonDeg: number): GroundSample {
    const out = this.ring[this.ringPos];
    this.ringPos = (this.ringPos + 1) % GROUND_SAMPLE_RING;
    return this.sampleGroundInto(latDeg, lonDeg, out);
  }

  /** Terrain height (m) with airport flattening, and whether a tile was used. */
  private blendedElevation(lat: number, lon: number, es: ElevationSample, hit: FlattenHit): number {
    const has = this.store.sample(lat, lon, es);
    let e = has ? es.elevation : this.fallbackElevation;
    const list = this.surfaces.query(lat, lon);
    if (list.length > 0) {
      evalFlatten(list, lat, lon, hit);
      if (hit.weight > 0) return e + (hit.planeElev - e) * hit.weight;
    } else hit.weight = 0;
    if (e < 0) e = 0; // sea surface
    return e;
  }

  /** Allocation-free ground sample into a caller-owned object. Never throws. */
  sampleGroundInto(latDeg: number, lonDeg: number, out: GroundSample): GroundSample {
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
      out.elevation_m = this.fallbackElevation;
      out.normal[0] = 0;
      out.normal[1] = 0;
      out.normal[2] = 1;
      out.surface = 'unknown';
      out.precise = false;
      return out;
    }
    const es = this.es;
    const hit = this.hit;
    const hasTerrain = this.store.sample(latDeg, lonDeg, es);
    const terrain = hasTerrain ? es.elevation : this.fallbackElevation;
    let dzdE = hasTerrain ? es.dzdE : 0;
    let dzdN = hasTerrain ? es.dzdN : 0;
    let elev = terrain;
    let precise = hasTerrain && es.zoom >= PRECISE_ZOOM;
    let surface: GroundSample['surface'];

    const list = this.surfaces.query(latDeg, lonDeg);
    let w = 0;
    if (list.length > 0) {
      evalFlatten(list, latDeg, lonDeg, hit);
      w = hit.weight;
    }
    if (w >= 1) {
      elev = hit.planeElev;
      dzdE = hit.slopeE;
      dzdN = hit.slopeN;
      surface = hit.paved ?? 'grass';
      if (hit.paved) precise = true;
    } else if (w > 0) {
      // Blend band: gradient of the blended field by finite differences (1 m).
      elev = terrain + (hit.planeElev - terrain) * w;
      metresPerDegree(latDeg, this.mpd);
      const dLat = 1 / this.mpd.lat;
      const dLon = 1 / this.mpd.lon;
      const eN = this.blendedElevation(latDeg + dLat, lonDeg, this.es2, this.hit2);
      const eE = this.blendedElevation(latDeg, lonDeg + dLon, this.es2, this.hit2);
      dzdN = eN - elev;
      dzdE = eE - elev;
      surface = 'grass';
    } else if (terrain <= 0 && hasTerrain) {
      elev = 0;
      dzdE = 0;
      dzdN = 0;
      surface = 'water';
    } else {
      const slope = Math.atan(Math.hypot(dzdE, dzdN));
      surface = terrain > snowLineM(latDeg, this.dayOfYear) && slope < SNOW_MAX_SLOPE_RAD ? 'snow' : hasTerrain ? 'grass' : 'unknown';
    }
    if (!hasTerrain && w < 1) surface = w > 0 ? 'grass' : 'unknown';

    const nx = -dzdE;
    const ny = -dzdN;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    out.elevation_m = elev;
    out.normal[0] = nx * inv;
    out.normal[1] = ny * inv;
    out.normal[2] = inv;
    out.surface = surface;
    out.precise = precise;
    return out;
  }

  /** WorldQuery.elevationAt: terrain/runway elevation (m MSL), sea surface at 0. */
  elevationAt(latDeg: number, lonDeg: number): number {
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return this.fallbackElevation;
    return this.blendedElevation(latDeg, lonDeg, this.es, this.hit);
  }
}
