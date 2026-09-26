import { describe, expect, it } from 'vitest';
import {
  createVisibilityScratch,
  resolveVisibility,
  lodScreenFactor,
  rootTiles,
  screenSpaceErrorPx,
  selectTiles,
  shouldSplit,
  tileGeometricErrorM,
  tileHorizontalDistanceM,
  viewRadiusForAltitude,
  type LodParams,
} from '../../src/world/terrain/lod';
import {
  keyX,
  keyY,
  keyZ,
  latToTileY,
  lonToTileX,
  mercatorYToLat,
  mercatorY,
  tileKey,
  tileSizeM,
  tilesCoveringBox,
} from '../../src/world/terrain/tileMath';

const params = (over: Partial<LodParams> = {}): LodParams => ({
  rootZoom: 6,
  maxZoom: 14,
  segments: 64,
  viewRadiusM: 200_000,
  sseThresholdPx: 6,
  screenHeightPx: 1080,
  fovYDeg: 60,
  maxLeaves: 400,
  ...over,
});

describe('tile math', () => {
  it('packs and unpacks keys', () => {
    for (const [z, x, y] of [
      [0, 0, 0],
      [14, 3000, 6200],
      [15, 32767, 32767],
    ]) {
      const k = tileKey(z, x, y);
      expect([keyZ(k), keyX(k), keyY(k)]).toEqual([z, x, y]);
    }
  });

  it('matches the slippy-map formula (OSM wiki example)', () => {
    // Munich 48.1372 N 11.5756 E at z=10 -> x=544, y=355 (OSM Slippy map tilenames).
    expect(Math.floor(lonToTileX(11.5756, 10))).toBe(544);
    expect(Math.floor(latToTileY(48.1372, 10))).toBe(355);
    expect(mercatorYToLat(mercatorY(51.5))).toBeCloseTo(51.5, 10);
  });

  it('covers a box across the antimeridian', () => {
    const out: number[] = [];
    tilesCoveringBox(3, -10, 170, 10, -170, out);
    const xs = new Set(out.map(keyX));
    expect(xs.has(7)).toBe(true);
    expect(xs.has(0)).toBe(true);
  });
});

describe('LOD metrics', () => {
  it('screen factor K = h / (2 tan(fov/2))', () => {
    expect(lodScreenFactor(1000, 90)).toBeCloseTo(500, 9);
  });

  it('geometric error is the vertex spacing', () => {
    const y = Math.floor(latToTileY(0.1, 10));
    expect(tileGeometricErrorM(10, y, 64)).toBeCloseTo(tileSizeM(10, 0) / 64, -1);
  });

  it('SSE halves when distance doubles', () => {
    expect(screenSpaceErrorPx(10, 1000, 935)).toBeCloseTo(2 * screenSpaceErrorPx(10, 2000, 935), 9);
  });

  it('horizontal distance is zero inside the tile and grows outside', () => {
    const z = 12;
    const x = Math.floor(lonToTileX(-104.67, z));
    const y = Math.floor(latToTileY(39.86, z));
    expect(tileHorizontalDistanceM(z, x, y, 39.86, -104.67)).toBe(0);
    const d = tileHorizontalDistanceM(z, x + 3, y, 39.86, -104.67);
    expect(d).toBeGreaterThan(2 * tileSizeM(z, 39.86));
    expect(d).toBeLessThan(3 * tileSizeM(z, 39.86));
  });

  it('splits near tiles and keeps far tiles coarse', () => {
    const p = params();
    const k = lodScreenFactor(p.screenHeightPx, p.fovYDeg);
    const cam = { lat: 39.86, lon: -104.67, alt_m: 1700 };
    const z = 10;
    const x = Math.floor(lonToTileX(cam.lon, z));
    const y = Math.floor(latToTileY(cam.lat, z));
    expect(shouldSplit(z, x, y, cam, p, 1600, 1700, k)).toBe(true);
    expect(shouldSplit(z, x + 8, y, cam, p, 1600, 1700, k)).toBe(false);
    // Max zoom never splits.
    expect(shouldSplit(14, 0, 0, cam, p, 0, 0, k)).toBe(false);
  });

  it('view radius grows with altitude and is clamped', () => {
    expect(viewRadiusForAltitude(0, 60_000, 450_000)).toBeCloseTo(195_500, -3);
    expect(viewRadiusForAltitude(12_000, 60_000, 450_000)).toBe(450_000);
    expect(viewRadiusForAltitude(-50, 60_000, 450_000)).toBeGreaterThanOrEqual(60_000);
  });
});

describe('selectTiles', () => {
  it('produces a gap-free, non-overlapping cover of the view disc', () => {
    const p = params();
    const cam = { lat: 39.86, lon: -104.67, alt_m: 2000 };
    const leaves: number[] = [];
    selectTiles(cam, p, null, leaves);
    expect(leaves.length).toBeGreaterThan(20);
    expect(leaves.length).toBeLessThanOrEqual(p.maxLeaves);
    // No leaf is an ancestor of another.
    const set = new Set(leaves);
    for (const k of leaves) {
      let z = keyZ(k), x = keyX(k), y = keyY(k);
      while (z > p.rootZoom) {
        z--;
        x >>= 1;
        y >>= 1;
        expect(set.has(tileKey(z, x, y))).toBe(false);
      }
    }
    // The tile under the camera is at (or near) max zoom; far tiles are coarse.
    const under = leaves.find((k) => tileHorizontalDistanceM(keyZ(k), keyX(k), keyY(k), cam.lat, cam.lon) === 0)!;
    expect(keyZ(under)).toBeGreaterThanOrEqual(13);
    const far = leaves.filter((k) => tileHorizontalDistanceM(keyZ(k), keyX(k), keyY(k), cam.lat, cam.lon) > 150_000);
    expect(far.every((k) => keyZ(k) <= 9)).toBe(true);
  });

  it('zoom decreases monotonically with distance (coarse far, fine near)', () => {
    const p = params();
    const cam = { lat: 47.26, lon: 11.34, alt_m: 3000 };
    const leaves: number[] = [];
    selectTiles(cam, p, null, leaves);
    const byZoom = new Map<number, number[]>();
    for (const k of leaves) {
      const d = tileHorizontalDistanceM(keyZ(k), keyX(k), keyY(k), cam.lat, cam.lon);
      const arr = byZoom.get(keyZ(k)) ?? [];
      arr.push(d);
      byZoom.set(keyZ(k), arr);
    }
    const zooms = [...byZoom.keys()].sort((a, b) => a - b);
    for (let i = 1; i < zooms.length; i++) {
      const minCoarse = Math.min(...byZoom.get(zooms[i - 1])!);
      const minFine = Math.min(...byZoom.get(zooms[i])!);
      expect(minFine).toBeLessThanOrEqual(minCoarse);
    }
  });

  it('relaxes the threshold to stay within the leaf budget', () => {
    const p = params({ maxLeaves: 60 });
    const leaves: number[] = [];
    const used = selectTiles({ lat: 0, lon: 0, alt_m: 500 }, p, null, leaves);
    expect(leaves.length).toBeLessThanOrEqual(60);
    expect(used).toBeGreaterThan(p.sseThresholdPx);
  });

  it('uses tile elevation ranges for vertical distance', () => {
    const p = params();
    const cam = { lat: 27.99, lon: 86.93, alt_m: 9000 };
    const a: number[] = [];
    const b: number[] = [];
    selectTiles(cam, p, null, a);
    // Pretend every tile reaches 8800 m: tiles are vertically closer, so more splitting.
    selectTiles(cam, p, (_k, out) => ((out[0] = 4000), (out[1] = 8800), true), b);
    expect(b.length).toBeGreaterThan(a.length);
  });

  it('root tiles lie within the view radius', () => {
    const p = params({ viewRadiusM: 100_000 });
    const roots: number[] = [];
    rootTiles({ lat: 60, lon: 179.9, alt_m: 0 }, p, roots);
    expect(roots.length).toBeGreaterThan(0);
    for (const k of roots) expect(tileHorizontalDistanceM(keyZ(k), keyX(k), keyY(k), 60, 179.9)).toBeLessThanOrEqual(100_000);
    // Crosses the antimeridian: tiles on both sides.
    const xs = roots.map(keyX);
    expect(xs.includes(0) && xs.includes((1 << 6) - 1)).toBe(true);
  });
});

describe('resolveVisibility (terrain fallback coverage)', () => {
  const k = tileKey;
  it('shows every loaded candidate and the nearest ancestor for a missing leaf elsewhere', () => {
    // Candidates: two z11 tiles under z9 (300,383); fallback for a missing leaf in another z9 tile.
    const shown = new Set<number>();
    resolveVisibility([k(11, 1200, 1532), k(11, 1201, 1532)], [k(9, 301, 383)], shown, createVisibilityScratch());
    expect([...shown].sort()).toEqual([k(11, 1200, 1532), k(11, 1201, 1532), k(9, 301, 383)].sort());
  });

  it('never lets a coarse ancestor hide finer tiles that are already shown (airport regression)', () => {
    // z11 airport tiles are loaded; a distant z10 leaf is missing and its nearest loaded ancestor is the z6 root
    // containing the airport. Drawing the root would cover the flattened runway tiles: it must be skipped.
    const airport = [k(11, 601, 768), k(11, 602, 768)];
    const root6 = k(6, 18, 24); // contains z11 x 576..607, y 768..799
    const shown = resolveVisibility(airport, [root6], new Set<number>(), createVisibilityScratch());
    expect(shown.has(root6)).toBe(false);
    for (const t of airport) expect(shown.has(t)).toBe(true);
  });

  it('prefers the finest fallback and skips coarser nested fallbacks', () => {
    const fine = k(9, 150, 192); // inside z7 (37, 48)
    const coarse = k(7, 37, 48);
    const shown = resolveVisibility([], [coarse, fine], new Set<number>(), createVisibilityScratch());
    expect(shown.has(fine)).toBe(true);
    expect(shown.has(coarse)).toBe(false);
  });

  it('never shows overlapping tiles', () => {
    const cands = [k(12, 2404, 3072), k(12, 2405, 3072), k(13, 4812, 6146)];
    const fbs = [k(11, 1202, 1536), k(10, 601, 768), k(8, 150, 192), k(7, 75, 96), k(11, 1203, 1537)];
    const shown = [...resolveVisibility(cands, fbs, new Set<number>(), createVisibilityScratch())];
    const isAncestor = (a: number, b: number) => {
      const dz = keyZ(b) - keyZ(a);
      return dz > 0 && keyX(b) >> dz === keyX(a) && keyY(b) >> dz === keyY(a);
    };
    for (const a of shown) for (const b of shown) expect(isAncestor(a, b)).toBe(false);
    for (const c of cands) expect(shown).toContain(c);
  });
});
