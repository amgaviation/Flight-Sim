/**
 * Quadtree LOD selection for terrain tiles (pure functions, unit tested).
 *
 * A tile is split when its screen-space geometric error exceeds a pixel
 * threshold: SSE = (vertex spacing) * K / distance, with
 * K = viewportHeight / (2 tan(fovY / 2)) (the standard perspective
 * screen-space error metric, e.g. Cesium/3D Tiles). Distance is from the
 * camera to the tile's bounding volume (lat/lon box x elevation range), so
 * selection depends only on camera position, never on view direction: looking
 * around the cockpit never triggers reloads.
 */
import { EARTH_MEAN_RADIUS_M, haversineM, horizonDistanceM, lonDelta } from '../geo';
import { keyX, keyY, keyZ, parentKey, tileKey, tileSizeM, tileXToLon, tileYToLat, wrapTileX, latToTileY, lonToTileX } from './tileMath';

export interface LodParams {
  /** Zoom of the root tiles that cover the view disc. */
  rootZoom: number;
  /** Deepest zoom rendered. */
  maxZoom: number;
  /** Grid segments per tile edge (vertex spacing = tile size / segments). */
  segments: number;
  /** Tiles farther than this (m, horizontal) are not drawn. */
  viewRadiusM: number;
  /** Maximum allowed screen-space error (px). */
  sseThresholdPx: number;
  screenHeightPx: number;
  fovYDeg: number;
  /** Leaf budget; the threshold is relaxed until the selection fits. */
  maxLeaves: number;
}

export interface LodCamera {
  lat: number;
  lon: number;
  /** Camera altitude (m MSL). */
  alt_m: number;
}

/** Elevation range lookup: fills out[0] = min, out[1] = max (m) and returns true when known. */
export type ElevRangeFn = (key: number, out: Float64Array) => boolean;

/** Perspective screen-space error factor K = h / (2 tan(fov/2)). */
export function lodScreenFactor(screenHeightPx: number, fovYDeg: number): number {
  return screenHeightPx / (2 * Math.tan(((fovYDeg * Math.PI) / 180) / 2));
}

/** Geometric error (m) of a tile mesh: its vertex spacing at the tile's centre latitude. */
export function tileGeometricErrorM(z: number, y: number, segments: number): number {
  const latC = tileYToLat(y + 0.5, z);
  return tileSizeM(z, latC) / segments;
}

/** Horizontal distance (m) from a point to the nearest point of a tile's lat/lon box (0 inside). */
export function tileHorizontalDistanceM(z: number, x: number, y: number, lat: number, lon: number): number {
  const west = tileXToLon(x, z);
  const east = tileXToLon(x + 1, z);
  const north = tileYToLat(y, z);
  const south = tileYToLat(y + 1, z);
  const cl = lat < south ? south : lat > north ? north : lat;
  const span = east - west;
  const dl = lonDelta(west, lon);
  let clon: number;
  if (dl >= 0 && dl <= span) clon = lon;
  else {
    // Nearer of the two edges, measured around the circle.
    const dWest = Math.abs(lonDelta(lon, west));
    const dEast = Math.abs(lonDelta(lon, east));
    clon = dWest < dEast ? west : east;
  }
  if (cl === lat && clon === lon) return 0;
  return haversineM(lat, lon, cl, clon);
}

/** 3D distance (m) from the camera to a tile's bounding volume. */
export function tileDistanceM(z: number, x: number, y: number, cam: LodCamera, minElev: number, maxElev: number): number {
  const h = tileHorizontalDistanceM(z, x, y, cam.lat, cam.lon);
  const v = cam.alt_m > maxElev ? cam.alt_m - maxElev : cam.alt_m < minElev ? minElev - cam.alt_m : 0;
  return Math.hypot(h, v);
}

export function screenSpaceErrorPx(errorM: number, distM: number, k: number): number {
  return (errorM * k) / Math.max(distM, 1);
}

/** Split decision for one tile. */
export function shouldSplit(
  z: number,
  x: number,
  y: number,
  cam: LodCamera,
  p: LodParams,
  minElev: number,
  maxElev: number,
  k: number,
  threshold = p.sseThresholdPx,
): boolean {
  if (z >= p.maxZoom) return false;
  const d = tileDistanceM(z, x, y, cam, minElev, maxElev);
  return screenSpaceErrorPx(tileGeometricErrorM(z, y, p.segments), d, k) > threshold;
}

/**
 * View radius (m) for a camera altitude: the geometric horizon plus the
 * horizon of 3,000 m terrain beyond it (mountains visible over the horizon),
 * clamped to [minM, maxM].
 */
export function viewRadiusForAltitude(altAboveTerrainM: number, minM: number, maxM: number): number {
  const r = horizonDistanceM(altAboveTerrainM) + horizonDistanceM(3000);
  return Math.min(maxM, Math.max(minM, r));
}

/** Root tiles at `p.rootZoom` intersecting the view disc around the camera. */
export function rootTiles(cam: LodCamera, p: LodParams, out: number[]): number[] {
  const z = p.rootZoom;
  const n = 1 << z;
  const dLat = (p.viewRadiusM / EARTH_MEAN_RADIUS_M) * (180 / Math.PI);
  const north = Math.min(85.05, cam.lat + dLat);
  const south = Math.max(-85.05, cam.lat - dLat);
  const cosLat = Math.max(0.02, Math.cos((Math.max(Math.abs(north), Math.abs(south)) * Math.PI) / 180));
  const dLon = Math.min(180, dLat / cosLat);
  const y0 = Math.max(0, Math.floor(latToTileY(north, z)));
  const y1 = Math.min(n - 1, Math.floor(latToTileY(south, z)));
  let x0 = Math.floor(lonToTileX(cam.lon - dLon, z));
  let x1 = Math.floor(lonToTileX(cam.lon + dLon, z));
  if (x1 < x0) x1 += n;
  if (x1 - x0 >= n) {
    x0 = 0;
    x1 = n - 1;
  }
  for (let y = y0; y <= y1; y++) {
    for (let xi = x0; xi <= x1; xi++) {
      const x = wrapTileX(xi, z);
      if (tileHorizontalDistanceM(z, x, y, cam.lat, cam.lon) <= p.viewRadiusM) out.push(tileKey(z, x, y));
    }
  }
  return out;
}

const _range = new Float64Array(2);
const _roots: number[] = [];

function visit(
  z: number,
  x: number,
  y: number,
  cam: LodCamera,
  p: LodParams,
  k: number,
  threshold: number,
  elevRange: ElevRangeFn | null,
  parentMin: number,
  parentMax: number,
  out: number[],
): void {
  if (tileHorizontalDistanceM(z, x, y, cam.lat, cam.lon) > p.viewRadiusM) return;
  let mn = parentMin;
  let mx = parentMax;
  if (elevRange && elevRange(tileKey(z, x, y), _range)) {
    mn = _range[0];
    mx = _range[1];
  }
  if (shouldSplit(z, x, y, cam, p, mn, mx, k, threshold)) {
    const cz = z + 1;
    const cx = x * 2;
    const cy = y * 2;
    visit(cz, cx, cy, cam, p, k, threshold, elevRange, mn, mx, out);
    visit(cz, cx + 1, cy, cam, p, k, threshold, elevRange, mn, mx, out);
    visit(cz, cx, cy + 1, cam, p, k, threshold, elevRange, mn, mx, out);
    visit(cz, cx + 1, cy + 1, cam, p, k, threshold, elevRange, mn, mx, out);
  } else {
    out.push(tileKey(z, x, y));
  }
}

/**
 * Selects the leaf tiles to render. Children outside the view radius are
 * dropped, so a split parent may leave gaps only beyond the horizon. When the
 * selection exceeds `p.maxLeaves`, the threshold is relaxed by 1.35x steps
 * (up to 24 times).
 * Returns the threshold actually used.
 */
export function selectTiles(cam: LodCamera, p: LodParams, elevRange: ElevRangeFn | null, out: number[]): number {
  const k = lodScreenFactor(p.screenHeightPx, p.fovYDeg);
  const roots = _roots;
  roots.length = 0;
  rootTiles(cam, p, roots);
  let threshold = p.sseThresholdPx;
  for (let attempt = 0; attempt < 24; attempt++) {
    out.length = 0;
    for (const key of roots) {
      const z = p.rootZoom;
      visit(z, keyX(key), keyY(key), cam, p, k, threshold, elevRange, 0, 0, out);
    }
    if (out.length <= p.maxLeaves) break;
    threshold *= 1.35;
  }
  return threshold;
}

/** Reusable scratch for `resolveVisibility` (kept for API stability; no per-frame allocation). */
export interface VisibilityScratch {
  /** Fallback keys (a copy, so `fallbacks` may be any iterable). */
  fallbacks: Set<number>;
}

export function createVisibilityScratch(): VisibilityScratch {
  return { fallbacks: new Set<number>() };
}

function hasAncestorIn(key: number, set: Set<number>): boolean {
  let k = key;
  while (keyZ(k) > 0) {
    k = parentKey(k);
    if (set.has(k)) return true;
  }
  return false;
}

/**
 * Chooses which loaded tiles to draw (fills `shown`) with no overlap and,
 * once the roots are loaded, no holes (the standard "refine only when the
 * children can be drawn" rule of chunked LOD):
 *
 *  - a fallback (the nearest loaded ancestor of a missing desired leaf) is
 *    shown unless another fallback contains it;
 *  - a candidate (a desired leaf with its own mesh, or the loaded children
 *    standing in for a missing coarse leaf) is shown unless a fallback
 *    contains it (the fallback already draws that area).
 *
 * Consequence: while a leaf is missing, its whole nearest-loaded-ancestor
 * area is drawn at that ancestor's resolution. That is only a small area
 * when the intermediate levels are loaded, which is why the renderer uploads
 * coarse tiles first; and airport pavement stays visible over any fallback
 * because every tile, at any resolution, is cleared below the pavement
 * (tileMesh.ts, surfaces.ts `evalClearance`).
 */
export function resolveVisibility(candidates: Iterable<number>, fallbacks: Iterable<number>, shown: Set<number>, scratch: VisibilityScratch): Set<number> {
  shown.clear();
  const fb = scratch.fallbacks;
  fb.clear();
  for (const key of fallbacks) fb.add(key);
  for (const key of candidates) if (!hasAncestorIn(key, fb)) shown.add(key);
  for (const key of fb) if (!hasAncestorIn(key, fb)) shown.add(key);
  return shown;
}
