/**
 * In-memory store of decoded terrarium elevation tiles with LRU eviction and
 * fast point sampling for physics (WorldQuery.sampleGround / elevationAt).
 *
 * Sampling picks the highest-zoom loaded tile covering the point, bilinearly
 * interpolates between pixel centres (seamlessly reading neighbour tiles at
 * the same zoom across edges) and returns the gradient (dz/dEast, dz/dNorth)
 * for surface normals. No allocation on the sampling path.
 */
import { DEG2RAD, MERCATOR_CIRCUMFERENCE_M } from '../geo';
import { MAX_MERCATOR_LAT, MAX_TILE_ZOOM, TILE_SIZE, tileKey } from './tileMath';

export interface ElevationTile {
  readonly key: number;
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** Row-major TILE_SIZE x TILE_SIZE elevations (m MSL), row 0 = north edge. */
  readonly data: Float32Array;
  readonly min: number;
  readonly max: number;
  /** Monotonic use stamp for LRU. */
  lastUsed: number;
  /** Pin count; pinned tiles are never evicted. */
  pins: number;
}

export interface ElevationSample {
  /** Elevation (m MSL). */
  elevation: number;
  /** Gradient: metres of rise per metre east / north. */
  dzdE: number;
  dzdN: number;
  /** Zoom of the tile used, or -1 when nothing was loaded. */
  zoom: number;
}

export function createElevationSample(): ElevationSample {
  return { elevation: 0, dzdE: 0, dzdN: 0, zoom: -1 };
}

const N = TILE_SIZE;

export class ElevationStore {
  private readonly tiles = new Map<number, ElevationTile>();
  private readonly zoomCounts = new Int32Array(MAX_TILE_ZOOM + 1);
  private clock = 0;
  private _generation = 0;
  /** Maximum unpinned tiles kept before LRU eviction. */
  maxTiles: number;
  /** Called with each evicted tile key (lets owners drop dependent state). */
  onEvict: ((key: number) => void) | null = null;

  constructor(maxTiles = 320) {
    this.maxTiles = maxTiles;
  }

  /** Changes whenever tiles are added or removed. */
  get generation(): number {
    return this._generation;
  }

  get size(): number {
    return this.tiles.size;
  }

  has(key: number): boolean {
    return this.tiles.has(key);
  }

  get(key: number): ElevationTile | undefined {
    return this.tiles.get(key);
  }

  /** Adds (or replaces) a tile. Evicts least-recently-used unpinned tiles beyond `maxTiles`. */
  add(z: number, x: number, y: number, data: Float32Array, min: number, max: number): ElevationTile {
    const key = tileKey(z, x, y);
    const prev = this.tiles.get(key);
    const tile: ElevationTile = { key, z, x, y, data, min, max, lastUsed: ++this.clock, pins: prev ? prev.pins : 0 };
    if (!prev) this.zoomCounts[z]++;
    this.tiles.set(key, tile);
    this._generation++;
    this.evict();
    return tile;
  }

  remove(key: number): void {
    const t = this.tiles.get(key);
    if (!t) return;
    this.tiles.delete(key);
    this.zoomCounts[t.z]--;
    this._generation++;
    this.onEvict?.(key);
  }

  pin(key: number): void {
    const t = this.tiles.get(key);
    if (t) t.pins++;
  }

  unpin(key: number): void {
    const t = this.tiles.get(key);
    if (t && t.pins > 0) t.pins--;
  }

  /** Marks a tile as recently used. */
  touch(key: number): void {
    const t = this.tiles.get(key);
    if (t) t.lastUsed = ++this.clock;
  }

  private evict(): void {
    if (this.tiles.size <= this.maxTiles) return;
    // Collect unpinned tiles sorted by age. Eviction is rare (tile arrival
    // rate), so the O(n log n) sort here is off the per-step hot path.
    const candidates: ElevationTile[] = [];
    for (const t of this.tiles.values()) if (t.pins === 0) candidates.push(t);
    candidates.sort((a, b) => a.lastUsed - b.lastUsed);
    let excess = this.tiles.size - this.maxTiles;
    for (let i = 0; i < candidates.length && excess > 0; i++, excess--) this.remove(candidates[i].key);
  }

  clear(): void {
    const keys = [...this.tiles.keys()];
    for (const k of keys) this.remove(k);
  }

  /** Highest zoom that currently has any tile. */
  private maxZoomPresent(): number {
    for (let z = MAX_TILE_ZOOM; z >= 0; z--) if (this.zoomCounts[z] > 0) return z;
    return -1;
  }

  /**
   * Finds the highest-zoom tile covering a point, at or below `maxZoom`.
   * Returns null when nothing is loaded there.
   */
  findTile(latDeg: number, lonDeg: number, maxZoom = MAX_TILE_ZOOM): ElevationTile | null {
    const mx = mercX(lonDeg);
    const my = mercY(latDeg);
    const top = Math.min(maxZoom, this.maxZoomPresent());
    for (let z = top; z >= 0; z--) {
      if (this.zoomCounts[z] === 0) continue;
      const n = 1 << z;
      const tx = Math.min(n - 1, Math.floor(mx * n));
      const ty = Math.min(n - 1, Math.floor(my * n));
      const t = this.tiles.get(tileKey(z, tx, ty));
      if (t) return t;
    }
    return null;
  }

  /**
   * Samples elevation and gradient at a point. Returns false (and leaves
   * `out.zoom = -1`) when no tile covers the point.
   */
  sample(latDeg: number, lonDeg: number, out: ElevationSample, maxZoom = MAX_TILE_ZOOM): boolean {
    const mx = mercX(lonDeg);
    const my = mercY(latDeg);
    const top = Math.min(maxZoom, this.maxZoomPresent());
    for (let z = top; z >= 0; z--) {
      if (this.zoomCounts[z] === 0) continue;
      const n = 1 << z;
      const fx = mx * n;
      const fy = my * n;
      const tx = Math.min(n - 1, Math.floor(fx));
      const ty = Math.min(n - 1, Math.floor(fy));
      const tile = this.tiles.get(tileKey(z, tx, ty));
      if (!tile) continue;
      tile.lastUsed = ++this.clock;
      // Pixel-centre coordinates: pixel i covers [i, i+1), centre at i + 0.5.
      const px = (fx - tx) * N - 0.5;
      const py = (fy - ty) * N - 0.5;
      const i0 = Math.floor(px);
      const j0 = Math.floor(py);
      const ax = px - i0;
      const ay = py - j0;
      const e00 = this.pixel(tile, i0, j0);
      const e10 = this.pixel(tile, i0 + 1, j0);
      const e01 = this.pixel(tile, i0, j0 + 1);
      const e11 = this.pixel(tile, i0 + 1, j0 + 1);
      const top0 = e00 + (e10 - e00) * ax;
      const bot0 = e01 + (e11 - e01) * ax;
      out.elevation = top0 + (bot0 - top0) * ay;
      // Gradient in pixel units, then metres (Mercator is conformal: the
      // ground pixel size is the same in x and y).
      const dpx = (e10 - e00) * (1 - ay) + (e11 - e01) * ay;
      const dpy = bot0 - top0;
      const pix = (MERCATOR_CIRCUMFERENCE_M * Math.cos(latDeg * DEG2RAD)) / (n * N);
      out.dzdE = dpx / pix;
      out.dzdN = -dpy / pix; // pixel rows increase southward
      out.zoom = z;
      return true;
    }
    out.zoom = -1;
    return false;
  }

  /** Elevation only; NaN when nothing is loaded. */
  elevation(latDeg: number, lonDeg: number, scratch: ElevationSample): number {
    return this.sample(latDeg, lonDeg, scratch) ? scratch.elevation : NaN;
  }

  /**
   * Reads pixel (i, j) of `tile`, reaching into same-zoom neighbours when the
   * index falls outside the tile (clamping when the neighbour is missing).
   */
  private pixel(tile: ElevationTile, i: number, j: number): number {
    if (i >= 0 && i < N && j >= 0 && j < N) return tile.data[j * N + i];
    const n = 1 << tile.z;
    let tx = tile.x;
    let ty = tile.y;
    let ii = i;
    let jj = j;
    if (ii < 0) {
      tx--;
      ii += N;
    } else if (ii >= N) {
      tx++;
      ii -= N;
    }
    if (jj < 0) {
      ty--;
      jj += N;
    } else if (jj >= N) {
      ty++;
      jj -= N;
    }
    if (ty >= 0 && ty < n) {
      tx = ((tx % n) + n) % n;
      const nb = this.tiles.get(tileKey(tile.z, tx, ty));
      if (nb) return nb.data[jj * N + ii];
    }
    const ci = i < 0 ? 0 : i >= N ? N - 1 : i;
    const cj = j < 0 ? 0 : j >= N ? N - 1 : j;
    return tile.data[cj * N + ci];
  }
}

function mercX(lonDeg: number): number {
  const x = (lonDeg + 180) / 360;
  return x - Math.floor(x);
}

function mercY(latDeg: number): number {
  const lat = (latDeg > MAX_MERCATOR_LAT ? MAX_MERCATOR_LAT : latDeg < -MAX_MERCATOR_LAT ? -MAX_MERCATOR_LAT : latDeg) * DEG2RAD;
  return (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2;
}
