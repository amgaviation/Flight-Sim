import { describe, expect, it } from 'vitest';
import type { Airport, Runway } from '../../src/nav/types';
import { buildAirportLayout, pairRunways, reciprocalIdent, runwayElevation, runwayToLatLon, splitDesignator } from '../../src/world/airports/runwayModel';
import { SurfaceIndex } from '../../src/world/airports/surfaces';
import { ElevationStore } from '../../src/world/terrain/ElevationStore';
import { GroundQuery } from '../../src/world/GroundQuery';
import { TILE_SIZE, latToTileY, lonToTileX, tileSizeM } from '../../src/world/terrain/tileMath';
import { FT_TO_M, haversineM, initialBearingDeg } from '../../src/world/geo';

// KDEN 16R/34L-like runway with a 60 ft elevation difference between ends
// (coordinates rounded from the FAA Chart Supplement; exact values do not matter).
function rwy(over: Partial<Runway>): Runway {
  return {
    ident: '16R',
    oppositeIdent: '34L',
    lat: 39.8951,
    lon: -104.6969,
    elevationFt: 5389,
    headingTrue: 180,
    lengthFt: 12000,
    widthFt: 150,
    displacedFt: 0,
    surface: 'concrete',
    lighted: true,
    ...over,
  };
}

const end16R = rwy({});
const end34L = rwy({ ident: '34L', oppositeIdent: '16R', lat: 39.8951 - 12000 * FT_TO_M / 111_030, lon: -104.6969, elevationFt: 5329, headingTrue: 0, ils: { ident: 'IDZG', freqMhz: 111.55, courseTrue: 0, locLat: 39.9, locLon: -104.6969, gsAngleDeg: 3.0 } });

const airport: Airport = {
  icao: 'KTST',
  name: 'Test Intl',
  lat: 39.87,
  lon: -104.68,
  elevationFt: 5400,
  type: 'large_airport',
  country: 'US',
  municipality: 'Test',
  runways: [end16R, end34L],
  frequencies: [],
};

/** Flat synthetic terrain tile at a given elevation covering a point. */
function flatStore(lat: number, lon: number, elev: number, z = 13): ElevationStore {
  const store = new ElevationStore();
  const x = Math.floor(lonToTileX(lon, z));
  const y = Math.floor(latToTileY(lat, z));
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
    store.add(z, x + dx, y + dy, new Float32Array(TILE_SIZE * TILE_SIZE).fill(elev), elev, elev);
  }
  return store;
}

describe('runway pairing', () => {
  it('pairs ends by opposite ident and computes reciprocal idents', () => {
    expect(pairRunways(airport).length).toBe(1);
    expect(reciprocalIdent('09L')).toBe('27R');
    expect(reciprocalIdent('18')).toBe('36');
    expect(reciprocalIdent('36C')).toBe('18C');
    expect(splitDesignator('09L')).toEqual({ digits: '9', letter: 'L' });
    expect(splitDesignator('34')).toEqual({ digits: '34', letter: '' });
  });

  it('synthesizes a missing far end from heading and length', () => {
    const lone: Airport = { ...airport, runways: [rwy({ oppositeIdent: '34L' })] };
    const [[a, b]] = pairRunways(lone);
    expect(b.ident).toBe('34L');
    // Ellipsoidal metres-per-degree vs the mean-sphere haversine differ by ~0.15% at 40 N.
    expect(Math.abs(haversineM(a.lat, a.lon, b.lat, b.lon) / (12000 * FT_TO_M) - 1)).toBeLessThan(0.003);
  });
});

describe('airport layout', () => {
  const layout = buildAirportLayout(airport)!;
  const rw = layout.runways[0];

  it('classifies the ILS end as precision with ALSF-2, TDZ lights and PAPI on the GS angle', () => {
    const [a, b] = rw.ends;
    expect(a.markings).toBe('nonprecision');
    expect(b.markings).toBe('precision');
    expect(b.approachLights).toBe('ALSF2');
    expect(b.tdzLights).toBe(true);
    expect(b.papi).toBe(true);
    expect(b.papiAngleDeg).toBe(3.0);
    // AC 150/5340-30J 7.5.4.3: D1 = TCH * cot(2deg50'), TCH 50 ft here.
    expect(b.papiDistM / FT_TO_M).toBeCloseTo(50 / Math.tan((2 + 50 / 60) * Math.PI / 180), 3);
    expect(rw.centerlineLights).toBe(true);
    expect(rw.headingTrue).toBeCloseTo(180, 1);
  });

  it('plans a parallel taxiway and an apron', () => {
    expect(layout.taxiway).not.toBeNull();
    expect(layout.taxiway!.offsetM).toBeCloseTo(500 * FT_TO_M, 6);
    expect(layout.beacon).not.toBeNull();
  });
});

describe('runway plane sampling (WorldQuery)', () => {
  const layout = buildAirportLayout(airport)!;
  const rw = layout.runways[0];
  const index = new SurfaceIndex();
  index.set(layout.surfaces);
  const ll = { lat: 0, lon: 0 };

  it('returns the runway plane, linear between threshold elevations, on the pavement', () => {
    // Terrain is 20 m below the runway: the runway plane must win.
    const q = new GroundQuery(flatStore(39.88, -104.6969, 1600), index);
    const eA = 5389 * FT_TO_M;
    const eB = 5329 * FT_TO_M;
    for (const f of [0.001, 0.25, 0.5, 0.75, 0.999]) {
      runwayToLatLon(rw, rw.lengthM * f, 5, ll);
      const s = q.sampleGround(ll.lat, ll.lon);
      expect(s.surface).toBe('concrete');
      expect(s.precise).toBe(true);
      expect(s.elevation_m).toBeCloseTo(eA + (eB - eA) * f, 3);
      // The runway descends to the south, so the surface normal leans south
      // (negative north component) and has no east component.
      const slope = (eA - eB) / rw.lengthM;
      expect(s.normal[1]).toBeCloseTo(-slope / Math.hypot(slope, 1), 6);
      expect(Math.abs(s.normal[0])).toBeLessThan(1e-9);
    }
  });

  it('blends back to terrain outside the graded area and is flat inside it', () => {
    const q = new GroundQuery(flatStore(39.88, -104.6969, 1600), index);
    runwayToLatLon(rw, rw.lengthM / 2 + 200, -50, ll); // grass beside the runway between connectors
    const inside = q.sampleGround(ll.lat, ll.lon);
    expect(inside.surface).toBe('grass');
    expect(inside.elevation_m).toBeCloseTo(runwayElevation(rw, rw.lengthM / 2 + 200), 3);
    runwayToLatLon(rw, rw.lengthM / 2, -2000, ll); // far away
    const far = q.sampleGround(ll.lat, ll.lon);
    expect(far.elevation_m).toBeCloseTo(1600, 3);
    // Midway through the blend band (west side: graded half-width 75 m + half of the 150 m blend).
    runwayToLatLon(rw, rw.lengthM / 2, 75 + 75, ll);
    const mid = q.sampleGround(ll.lat, ll.lon);
    expect(mid.elevation_m).toBeGreaterThan(1600);
    expect(mid.elevation_m).toBeLessThan(1640.5);
  });

  it('ring buffer keeps 31 previous samples valid and elevationAt agrees', () => {
    const q = new GroundQuery(flatStore(39.88, -104.6969, 1600), index);
    runwayToLatLon(rw, 100, 0, ll);
    const first = q.sampleGround(ll.lat, ll.lon);
    const e0 = first.elevation_m;
    for (let i = 0; i < 31; i++) q.sampleGround(39.5, -104.5);
    expect(first.elevation_m).toBe(e0);
    expect(q.elevationAt(ll.lat, ll.lon)).toBeCloseTo(e0, 6);
  });

  it('never throws and reports imprecise data when nothing is loaded', () => {
    const q = new GroundQuery(new ElevationStore(), new SurfaceIndex());
    q.fallbackElevation = 123;
    const s = q.sampleGround(10, 10);
    expect(s.precise).toBe(false);
    expect(s.elevation_m).toBe(123);
    expect(() => q.sampleGround(NaN, Infinity)).not.toThrow();
  });

  it('samples fast', () => {
    const q = new GroundQuery(flatStore(39.88, -104.6969, 1600), index);
    runwayToLatLon(rw, 1500, 3, ll);
    const n = 200_000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) q.sampleGround(ll.lat + i * 1e-9, ll.lon);
    const usPerCall = ((performance.now() - t0) * 1000) / n;
    expect(usPerCall).toBeLessThan(5);
  });
});

describe('terrain sampling', () => {
  it('bilinear interpolation reproduces a planar tilt exactly with the right gradient', () => {
    const z = 13;
    const lat = 46.5;
    const lon = 7.9;
    const x = Math.floor(lonToTileX(lon, z));
    const y = Math.floor(latToTileY(lat, z));
    const store = new ElevationStore();
    const pix = tileSizeM(z, lat) / TILE_SIZE;
    // Elevation rising 0.1 m per metre to the east: 0.1 * pix per pixel, continuous across tiles.
    for (let dx = -1; dx <= 1; dx++) {
      const data = new Float32Array(TILE_SIZE * TILE_SIZE);
      for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) data[j * TILE_SIZE + i] = 1000 + 0.1 * pix * ((dx + 1) * TILE_SIZE + i);
      store.add(z, x + dx, y, data, 0, 3000);
    }
    const q = new GroundQuery(store, new SurfaceIndex());
    const s = q.sampleGround(lat, lon);
    expect(s.normal[0]).toBeCloseTo(-0.1 / Math.hypot(0.1, 1), 2);
    expect(Math.abs(s.normal[1])).toBeLessThan(1e-3);
    // Across the tile seam (east edge of the centre tile) the sample stays continuous.
    const eastEdgeLon = ((x + 1) / (1 << z)) * 360 - 180;
    const a = q.elevationAt(lat, eastEdgeLon - 1e-6);
    const b = q.elevationAt(lat, eastEdgeLon + 1e-6);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
    // Initial bearing sanity for geo helpers used by the layout code.
    expect(initialBearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 9);
  });
});
