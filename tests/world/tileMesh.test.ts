import { describe, expect, it } from 'vitest';
import { BEACH_WIDTH_M, COAST_FLAG, buildTileMesh, coastMask, sampleGrid, tileMeshCounts } from '../../src/world/terrain/tileMesh';
import { TILE_SIZE, latToTileY, lonToTileX, tileBounds } from '../../src/world/terrain/tileMath';
import { ecefToGeodetic, enuBasis, geodeticToEcef } from '../../src/world/geo';
import { buildAirportLayout } from '../../src/world/airports/runwayModel';
import type { Airport } from '../../src/nav/types';

function flat(elev: number): Float32Array {
  return new Float32Array(TILE_SIZE * TILE_SIZE).fill(elev);
}

/** Tile-local ENU (three axes) back to geodetic, for checking vertex placement. */
function localToGeo(lat0: number, lon0: number, x: number, y: number, z: number) {
  const o = geodeticToEcef(lat0, lon0, 0, [0, 0, 0]);
  const b = enuBasis(lat0, lon0, new Float64Array(9));
  const e = x;
  const n = -z;
  const u = y;
  const X = o[0] + b[0] * e + b[3] * n + b[6] * u;
  const Y = o[1] + b[1] * e + b[4] * n + b[7] * u;
  const Z = o[2] + b[2] * e + b[5] * n + b[8] * u;
  return ecefToGeodetic(X, Y, Z, { lat: 0, lon: 0, alt_m: 0 });
}

describe('tile mesh builder', () => {
  const z = 12;
  const x = Math.floor(lonToTileX(8.5, z));
  const y = Math.floor(latToTileY(47.3, z));
  const params = { z, x, y, segments: 16, skirtDepthM: 50, surfaces: [], noisePeriodM: 262144 };

  it('has the expected vertex/index counts', () => {
    const m = buildTileMesh(flat(500), params);
    const c = tileMeshCounts(16);
    expect(m.vertexCount).toBe(c.vertices);
    expect(m.index.length).toBe(c.indices);
    expect(m.index).toBeInstanceOf(Uint16Array);
  });

  it('places vertices exactly on the geodetic grid (curvature included)', () => {
    const m = buildTileMesh(flat(500), params);
    const b = tileBounds(z, x, y, { west: 0, east: 0, north: 0, south: 0 });
    // Corner vertex 0 = NW corner.
    const g = localToGeo(m.centerLat, m.centerLon, m.positions[0], m.positions[1], m.positions[2]);
    // float32 vertex storage: ~1e-9 deg (0.1 mm) resolution.
    expect(g.lat).toBeCloseTo(b.north, 7);
    expect(g.lon).toBeCloseTo(b.west, 7);
    expect(g.alt_m).toBeCloseTo(500, 2);
    // Corners of a ~6 km tile drop below the centre's tangent plane (~0.7 m at 3 km).
    expect(m.positions[1]).toBeLessThan(500);
  });

  it('normals point up on flat ground and skirts face outward', () => {
    const m = buildTileMesh(flat(500), params);
    const row = 17;
    const centre = (8 * row + 8) * 3;
    expect(m.normals[centre + 1]).toBeGreaterThan(0.999);
    // Every triangle's geometric normal: top faces up, skirt faces away from the tile centre.
    const P = m.positions;
    for (let t = 0; t < m.index.length; t += 3) {
      const a = m.index[t] * 3, bb = m.index[t + 1] * 3, c = m.index[t + 2] * 3;
      const e1 = [P[bb] - P[a], P[bb + 1] - P[a + 1], P[bb + 2] - P[a + 2]];
      const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const cx = (P[a] + P[bb] + P[c]) / 3;
      const cz = (P[a + 2] + P[bb + 2] + P[c + 2]) / 3;
      const isSkirt = Math.abs(n[1]) < 1e-3 * Math.hypot(n[0], n[1], n[2]);
      if (isSkirt) expect(n[0] * cx + n[2] * cz).toBeGreaterThan(0);
      else expect(n[1]).toBeGreaterThan(0);
    }
  });

  it('keeps the sea flat at 0 m while shading keeps the depth', () => {
    const m = buildTileMesh(flat(-40), params);
    const g = localToGeo(m.centerLat, m.centerLon, m.positions[0], m.positions[1], m.positions[2]);
    expect(g.alt_m).toBeCloseTo(0, 2);
    expect(m.terrain[2]).toBeCloseTo(-40, 5);
  });

  it('flattens terrain under a runway to the runway plane minus the pavement sink', () => {
    const ap: Airport = {
      icao: 'LSZH', name: 'Test', lat: 47.3, lon: 8.5, elevationFt: 1400, type: 'large_airport', country: 'CH', municipality: 'Z', frequencies: [],
      runways: [
        { ident: '09', oppositeIdent: '27', lat: 47.3, lon: 8.49, elevationFt: 1400, headingTrue: 90, lengthFt: 8000, widthFt: 150, displacedFt: 0, surface: 'concrete', lighted: true },
        { ident: '27', oppositeIdent: '09', lat: 47.3, lon: 8.49 + 2438 / (111_320 * Math.cos((47.3 * Math.PI) / 180)), elevationFt: 1400, headingTrue: 270, lengthFt: 8000, widthFt: 150, displacedFt: 0, surface: 'concrete', lighted: true },
      ],
    };
    const layout = buildAirportLayout(ap)!;
    const zz = 14;
    const xx = Math.floor(lonToTileX(8.5, zz));
    const yy = Math.floor(latToTileY(47.3, zz));
    const m = buildTileMesh(flat(600), { z: zz, x: xx, y: yy, segments: 64, skirtDepthM: 10, surfaces: layout.surfaces, noisePeriodM: 262144 });
    const runwayElev = 1400 * 0.3048;
    let onRunway = 0;
    for (let v = 0; v < 65 * 65; v++) {
      if (m.flat[v] % COAST_FLAG >= 1) {
        const g = localToGeo(m.centerLat, m.centerLon, m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]);
        expect(g.alt_m).toBeLessThanOrEqual(runwayElev + 1e-3);
        expect(g.alt_m).toBeGreaterThan(runwayElev - 0.36);
        onRunway++;
      }
    }
    expect(onRunway).toBeGreaterThan(20);
  });

  it('keeps coarse tiles below the pavement everywhere on the runway (fallback LOD regression)', () => {
    // Terrain 3 m above the runway plane (KTEB-like DEM noise), z10 tile with 32 segments (~900 m cells):
    // the pad-based flatten weight misses most cells, the grid-aware clearance must still clear the pavement.
    const ap: Airport = {
      icao: 'KTST', name: 'Test', lat: 40.85, lon: -74.06, elevationFt: 9, type: 'medium_airport', country: 'US', municipality: 'T', frequencies: [],
      runways: [
        { ident: '1', oppositeIdent: '19', lat: 40.84, lon: -74.061, elevationFt: 9, headingTrue: 6, lengthFt: 7000, widthFt: 150, displacedFt: 0, surface: 'asphalt', lighted: true },
        { ident: '19', oppositeIdent: '1', lat: 40.84 + (2134 * Math.cos((6 * Math.PI) / 180)) / 111_194, lon: -74.061 + (2134 * Math.sin((6 * Math.PI) / 180)) / (111_194 * Math.cos((40.85 * Math.PI) / 180)), elevationFt: 9, headingTrue: 186, lengthFt: 7000, widthFt: 150, displacedFt: 0, surface: 'asphalt', lighted: true },
      ],
    };
    const layout = buildAirportLayout(ap)!;
    const runwayElev = 9 * 0.3048;
    for (const zz of [8, 10, 12]) {
      const xx = Math.floor(lonToTileX(-74.06, zz));
      const yy = Math.floor(latToTileY(40.85, zz));
      const seg = 32;
      const m = buildTileMesh(flat(runwayElev + 3), { z: zz, x: xx, y: yy, segments: seg, skirtDepthM: 10, surfaces: layout.surfaces, noisePeriodM: 262144 });
      // Every grid cell overlapping the runway: all four corners below the pavement plane.
      const row = seg + 1;
      const geo = (v: number) => localToGeo(m.centerLat, m.centerLon, m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]);
      // Sample points along the runway centre line and edges; the triangle under each must be below the plane.
      const b = tileBounds(zz, xx, yy, { west: 0, east: 0, north: 0, south: 0 });
      let checked = 0;
      for (let f = 0.02; f <= 0.98; f += 0.04) {
        for (const off of [-20, 0, 20]) {
          const s = 2134 * f;
          const lat = 40.84 + (s * Math.cos((6 * Math.PI) / 180) - off * Math.sin((6 * Math.PI) / 180)) / 111_194;
          const lon = -74.061 + (s * Math.sin((6 * Math.PI) / 180) + off * Math.cos((6 * Math.PI) / 180)) / (111_194 * Math.cos((40.85 * Math.PI) / 180));
          if (lat < b.south || lat > b.north || lon < b.west || lon > b.east) continue;
          const u = ((lon - b.west) / (b.east - b.west)) * seg;
          // Mercator rows: find by bisection over vertex latitudes.
          let j = 0;
          while (j < seg && geo((j + 1) * row).lat > lat) j++;
          const i = Math.min(seg - 1, Math.floor(u));
          for (const v of [j * row + i, j * row + i + 1, (j + 1) * row + i, (j + 1) * row + i + 1]) {
            expect(geo(v).alt_m).toBeLessThan(runwayElev);
          }
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(20);
    }
  });

  it('marks only the land within the beach width of water as coast (low-lying inland ground is not beach)', () => {
    // West half: sea (-5 m). East half: marsh at 1.5 m (the beach elevation band), far from the sea beyond the strip.
    const e = new Float32Array(TILE_SIZE * TILE_SIZE);
    for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) e[j * TILE_SIZE + i] = i < 100 ? -5 : 1.5;
    const mask = coastMask(e, 3);
    expect(mask[10 * TILE_SIZE + 50]).toBe(1); // water itself
    expect(mask[10 * TILE_SIZE + 102]).toBe(1); // 3 px inland
    expect(mask[10 * TILE_SIZE + 104]).toBe(0); // 5 px inland
    expect(mask[10 * TILE_SIZE + 200]).toBe(0);

    const zz = 13;
    const xx = Math.floor(lonToTileX(-74.06, zz));
    const yy = Math.floor(latToTileY(40.85, zz));
    const seg = 32;
    const m = buildTileMesh(e, { z: zz, x: xx, y: yy, segments: seg, skirtDepthM: 10, surfaces: [], noisePeriodM: 262144 });
    const row = seg + 1;
    const pxPerCell = TILE_SIZE / seg;
    const tileM = (40_075_016.7 * Math.cos((40.85 * Math.PI) / 180)) / (1 << zz);
    const beachPx = BEACH_WIDTH_M / (tileM / TILE_SIZE);
    for (let i = 0; i < row; i++) {
      const px = i * pxPerCell - 0.5;
      const flagged = m.flat[5 * row + i] >= COAST_FLAG;
      if (px < 99) expect(flagged).toBe(true); // over the water
      else if (px > 100 + beachPx + 1) expect(flagged).toBe(false); // inland marsh: no beach
    }
  });

  it('bilinear grid sampling interpolates between pixel centres', () => {
    const e = new Float32Array(TILE_SIZE * TILE_SIZE);
    for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) e[j * TILE_SIZE + i] = i;
    expect(sampleGrid(e, 10.25, 3)).toBeCloseTo(10.25, 6);
    expect(sampleGrid(e, -5, 3)).toBe(0);
    expect(sampleGrid(e, 300, 3)).toBe(255);
  });
});
