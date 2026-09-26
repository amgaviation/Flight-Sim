/**
 * Airport ground surfaces: runway/taxiway/apron planes that flatten terrain
 * and give physics an exact runway surface.
 *
 * A `FlattenSurface` is plain serializable data (it is posted to the terrain
 * worker). Geometry lives in a local tangent-plane frame anchored at a runway
 * end: s = metres along the runway axis (end A -> end B), t = metres to the
 * right of the centreline looking from A to B. The surface plane's elevation
 * varies linearly with s between the two runway-end elevations and is level
 * across the runway (runway transverse grade ignored, see SCOPE note in
 * docs/modules/world.md).
 */
import type { GroundSample } from '../types';
import { lonDelta, smoothstep } from '../geo';

export type SurfaceType = GroundSample['surface'];

/** Rectangle in (s, t) runway coordinates (metres). */
export interface SurfaceRect {
  s0: number;
  s1: number;
  t0: number;
  t1: number;
}

/** A paved (or explicitly surfaced) rectangle with an exact plane for physics. */
export interface PavedRect extends SurfaceRect {
  surface: SurfaceType;
  /** Render-only depression of the terrain under this rect (m) so the pavement mesh never z-fights. */
  sinkM: number;
}

export interface FlattenSurface {
  /** Identifier for debugging, e.g. "KDEN 16R/34L". */
  id: string;
  /** Local frame anchor (runway end A pavement end), degrees. */
  lat0: number;
  lon0: number;
  /** Metres per degree of latitude/longitude used by this frame. */
  mLat: number;
  mLon: number;
  /** Unit vector of the +s axis in (east, north). */
  dirE: number;
  dirN: number;
  /** Plane definition: elev(s) = elevA + (elevB - elevA) * clamp(s / lengthM, 0, 1), metres MSL. */
  lengthM: number;
  elevA: number;
  elevB: number;
  /** Area flattened completely to the plane. */
  pad: SurfaceRect;
  /** Distance over which terrain blends back to the DEM outside `pad` (m). */
  blendM: number;
  /** Surfaces with exact physics (runway, shoulders, taxiway, apron). */
  paved: PavedRect[];
  /** Geographic bounds including the blend band (deg), for quick rejection. */
  south: number;
  north: number;
  west: number;
  east: number;
}

/** Result of evaluating the flatten field at a point (reused, allocation-free). */
export interface FlattenHit {
  /** 0 = pure terrain, 1 = fully on the surface plane. */
  weight: number;
  /** Plane elevation at the point (m MSL); valid when weight > 0. */
  planeElev: number;
  /** Plane slope along the surface frame (dz/dE, dz/dN). */
  slopeE: number;
  slopeN: number;
  /** Surface type when inside a paved rect, otherwise null. */
  paved: SurfaceType | null;
  /** Render sink (m) to apply (already weighted by the paved-rect mask). */
  sinkM: number;
  /** The winning surface, or null. */
  surface: FlattenSurface | null;
  /** Local runway coordinates of the point in the winning surface. */
  s: number;
  t: number;
}

export function createFlattenHit(): FlattenHit {
  return { weight: 0, planeElev: 0, slopeE: 0, slopeN: 0, paved: null, sinkM: 0, surface: null, s: 0, t: 0 };
}

/** Projects (lat, lon) into a surface's (s, t) frame. Writes into `out[0..1]`. */
export function toSurfaceCoords(sf: FlattenSurface, lat: number, lon: number, out: { s: number; t: number }): void {
  const e = lonDelta(sf.lon0, lon) * sf.mLon;
  const n = (lat - sf.lat0) * sf.mLat;
  out.s = e * sf.dirE + n * sf.dirN;
  out.t = e * sf.dirN - n * sf.dirE;
}

/** Inverse of `toSurfaceCoords`. */
export function fromSurfaceCoords(sf: FlattenSurface, s: number, t: number, out: { lat: number; lon: number }): void {
  const e = s * sf.dirE + t * sf.dirN;
  const n = s * sf.dirN - t * sf.dirE;
  out.lat = sf.lat0 + n / sf.mLat;
  out.lon = sf.lon0 + e / sf.mLon;
}

/** Plane elevation at runway coordinate s. */
export function planeElevation(sf: FlattenSurface, s: number): number {
  const L = sf.lengthM;
  if (L <= 0) return sf.elevA;
  const f = s <= 0 ? 0 : s >= L ? 1 : s / L;
  return sf.elevA + (sf.elevB - sf.elevA) * f;
}

function rectDistance(r: SurfaceRect, s: number, t: number): number {
  const ds = s < r.s0 ? r.s0 - s : s > r.s1 ? s - r.s1 : 0;
  const dt = t < r.t0 ? r.t0 - t : t > r.t1 ? t - r.t1 : 0;
  return ds === 0 ? dt : dt === 0 ? ds : Math.hypot(ds, dt);
}

const _st = { s: 0, t: 0 };

/**
 * Evaluates the combined flatten field of `surfaces` at a point. The surface
 * with the highest weight wins (ties: paved first, then list order). A point
 * inside a paved rect always gets weight 1 and that rect's surface type.
 */
export function evalFlatten(surfaces: readonly FlattenSurface[], lat: number, lon: number, out: FlattenHit): FlattenHit {
  out.weight = 0;
  out.paved = null;
  out.sinkM = 0;
  out.surface = null;
  out.planeElev = 0;
  out.slopeE = 0;
  out.slopeN = 0;
  let bestPaved = false;
  for (let i = 0; i < surfaces.length; i++) {
    const sf = surfaces[i];
    if (lat < sf.south || lat > sf.north) continue;
    const dw = lonDelta(sf.west, lon);
    if (dw < 0 || dw > lonDelta(sf.west, sf.east)) continue;
    toSurfaceCoords(sf, lat, lon, _st);
    const s = _st.s;
    const t = _st.t;
    let paved: PavedRect | null = null;
    for (let k = 0; k < sf.paved.length; k++) {
      const p = sf.paved[k];
      if (s >= p.s0 && s <= p.s1 && t >= p.t0 && t <= p.t1) {
        paved = p;
        break;
      }
    }
    let w: number;
    if (paved) w = 1;
    else {
      const d = rectDistance(sf.pad, s, t);
      w = d <= 0 ? 1 : 1 - smoothstep(0, sf.blendM, d);
    }
    if (w <= 0) continue;
    const better = w > out.weight || (w === out.weight && paved !== null && !bestPaved);
    if (!better) continue;
    bestPaved = paved !== null;
    out.weight = w;
    out.surface = sf;
    out.s = s;
    out.t = t;
    out.planeElev = planeElevation(sf, s);
    const g = s > 0 && s < sf.lengthM && sf.lengthM > 0 ? (sf.elevB - sf.elevA) / sf.lengthM : 0;
    out.slopeE = g * sf.dirE;
    out.slopeN = g * sf.dirN;
    out.paved = paved ? paved.surface : null;
    if (paved && paved.sinkM > 0) {
      // Fade the sink out over the last metre at the rect edge so the
      // terrain rises smoothly to meet the pavement edge.
      const edge = Math.min(s - paved.s0, paved.s1 - s, t - paved.t0, paved.t1 - t);
      out.sinkM = paved.sinkM * Math.min(1, edge / 1.0);
    } else out.sinkM = 0;
  }
  return out;
}

/**
 * Render clearance for coarse terrain grids: the highest elevation a terrain
 * vertex may have when it lies within `radiusM` of any rendered paved rect
 * (sinkM > 0), i.e. the lowest (plane - sinkM) over those rects, or
 * +Infinity when no pavement is that close.
 *
 * A terrain triangle whose vertices all respect this bound lies entirely
 * below the pavement. With `radiusM` = the grid-cell diagonal, every cell
 * that overlaps pavement has all its corners cleared, whatever the tile's
 * resolution, so a coarse LOD tile can never draw over a runway (the
 * vertex-based flatten weight alone cannot guarantee that once the grid is
 * coarser than the flattened pad). Allocation-free.
 */
export function evalClearance(surfaces: readonly FlattenSurface[], lat: number, lon: number, radiusM: number): number {
  let limit = Infinity;
  for (let i = 0; i < surfaces.length; i++) {
    const sf = surfaces[i];
    const rLat = radiusM / sf.mLat;
    if (lat < sf.south - rLat || lat > sf.north + rLat) continue;
    const rLon = radiusM / sf.mLon;
    const dw = lonDelta(sf.west, lon) + rLon;
    if (dw < 0 || dw > lonDelta(sf.west, sf.east) + 2 * rLon) continue;
    toSurfaceCoords(sf, lat, lon, _st);
    const s = _st.s;
    const t = _st.t;
    for (let k = 0; k < sf.paved.length; k++) {
      const p = sf.paved[k];
      if (p.sinkM <= 0 || rectDistance(p, s, t) > radiusM) continue;
      const sc = s < p.s0 ? p.s0 : s > p.s1 ? p.s1 : s;
      const e = planeElevation(sf, sc) - p.sinkM;
      if (e < limit) limit = e;
    }
  }
  return limit;
}

/**
 * Uniform lat/lon grid of surfaces for O(1) lookups from physics. Cells are
 * `cellDeg` square; each cell lists the surfaces whose bounds overlap it.
 */
export class SurfaceIndex {
  private readonly cells = new Map<number, FlattenSurface[]>();
  private list: FlattenSurface[] = [];
  private _version = 0;
  static readonly EMPTY: readonly FlattenSurface[] = [];

  constructor(readonly cellDeg = 0.02) {}

  /** Increments whenever the surface set changes. */
  get version(): number {
    return this._version;
  }

  get surfaces(): readonly FlattenSurface[] {
    return this.list;
  }

  private cellKey(iy: number, ix: number): number {
    return iy * 100000 + ix;
  }

  /** Replaces the whole set of surfaces. */
  set(surfaces: FlattenSurface[]): void {
    this.list = surfaces.slice();
    this.cells.clear();
    const c = this.cellDeg;
    const nx = Math.round(360 / c);
    for (const sf of this.list) {
      const iy0 = Math.floor((sf.south + 90) / c);
      const iy1 = Math.floor((sf.north + 90) / c);
      const ix0 = Math.floor((sf.west + 180) / c);
      let ix1 = Math.floor((sf.east + 180) / c);
      if (ix1 < ix0) ix1 += nx;
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const k = this.cellKey(iy, ((ix % nx) + nx) % nx);
          let arr = this.cells.get(k);
          if (!arr) this.cells.set(k, (arr = []));
          arr.push(sf);
        }
      }
    }
    this._version++;
  }

  /** Surfaces that may affect (lat, lon). Never allocates. */
  query(lat: number, lon: number): readonly FlattenSurface[] {
    const c = this.cellDeg;
    const nx = Math.round(360 / c);
    const iy = Math.floor((lat + 90) / c);
    let ix = Math.floor((lon + 180) / c);
    ix = ((ix % nx) + nx) % nx;
    return this.cells.get(this.cellKey(iy, ix)) ?? SurfaceIndex.EMPTY;
  }

  /** Surfaces whose bounds intersect a lat/lon box (allocates the result). */
  inBox(south: number, west: number, north: number, east: number): FlattenSurface[] {
    const out: FlattenSurface[] = [];
    for (const sf of this.list) {
      if (sf.north < south || sf.south > north) continue;
      // Longitude overlap on the circle.
      const w1 = sf.west;
      const span1 = lonDelta(sf.west, sf.east);
      const span2 = lonDelta(west, east);
      const d = lonDelta(west, w1);
      const overlaps = (d >= 0 && d <= span2) || (d < 0 && -d <= span1);
      if (overlaps) out.push(sf);
    }
    return out;
  }
}
