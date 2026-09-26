import { describe, expect, it } from 'vitest';
import { buildTileMesh, sampleGrid, tileMeshCounts } from '../../src/world/terrain/tileMesh';
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
      if (m.flat[v] >= 1) {
        const g = localToGeo(m.centerLat, m.centerLon, m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]);
        expect(g.alt_m).toBeLessThanOrEqual(runwayElev + 1e-3);
        expect(g.alt_m).toBeGreaterThan(runwayElev - 0.36);
        onRunway++;
      }
    }
    expect(onRunway).toBeGreaterThan(20);
  });

  it('bilinear grid sampling interpolates between pixel centres', () => {
    const e = new Float32Array(TILE_SIZE * TILE_SIZE);
    for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) e[j * TILE_SIZE + i] = i;
    expect(sampleGrid(e, 10.25, 3)).toBeCloseTo(10.25, 6);
    expect(sampleGrid(e, -5, 3)).toBe(0);
    expect(sampleGrid(e, 300, 3)).toBe(255);
  });
});
