import { describe, expect, it } from 'vitest';
import type { Airport, Runway } from '../../src/nav/types';
import type { AircraftMeta } from '../../src/aircraft/types';
import { bestRunway, destination, FINAL_NM, findRunway, LINEUP_M, normalizeRunwayIdent, planStart, TCH_FT } from '../../src/ui/startPosition';
import { daysInYear, defaultLaunch, launchFromQuery, resolveTime, sanitizeLaunch } from '../../src/ui/launch';

const NM_M = 1852;

function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// A two-runway airport shaped like KTEB (rwy 1/19 and 6/24); geometry approximate.
function rwy(ident: string, opposite: string, lat: number, lon: number, hdg: number, lengthFt: number, ils?: Runway['ils']): Runway {
  return { ident, oppositeIdent: opposite, lat, lon, elevationFt: 9, headingTrue: hdg, lengthFt, widthFt: 150, displacedFt: 0, surface: 'asphalt', lighted: true, ils };
}
const r01 = rwy('1', '19', 40.8435, -74.0617, 7, 6997);
const end01 = destination(r01.lat, r01.lon, 7, 6997 * 0.3048);
const r19 = rwy('19', '1', end01.lat, end01.lon, 187, 6997, { ident: 'ITEB', freqMhz: 108.9, courseTrue: 187, locLat: r01.lat, locLon: r01.lon, gsAngleDeg: 3 });
const r06 = rwy('6', '24', 40.8499, -74.0697, 47, 6014, { ident: 'IXYZ', freqMhz: 111.75, courseTrue: 47, locLat: 40.86, locLon: -74.05, gsAngleDeg: 3.1 });
const end06 = destination(r06.lat, r06.lon, 47, 6014 * 0.3048);
const r24 = rwy('24', '6', end06.lat, end06.lon, 227, 6014);
const AIRPORT: Airport = {
  icao: 'KTST',
  name: 'Test Field',
  lat: 40.85,
  lon: -74.06,
  elevationFt: 9,
  type: 'medium_airport',
  country: 'US',
  municipality: 'Test',
  runways: [r01, r19, r06, r24],
  frequencies: [],
  magVar: -13,
};
const META: AircraftMeta = {
  id: 'x',
  name: 'x',
  manufacturer: 'x',
  icaoType: 'ZZZZ',
  engines: 2,
  engineType: 'turbofan',
  avionics: 'x',
  description: '',
  typical: { cruiseAltFt: 31000, cruiseKtas: 400, approachKias: 125, rotateKias: 110, maxAltFt: 41000 },
  chaseDistance_m: 30,
};

describe('runway selection', () => {
  it('normalizes designators', () => {
    expect(normalizeRunwayIdent('01')).toBe('1');
    expect(normalizeRunwayIdent('RW06L')).toBe('6L');
    expect(normalizeRunwayIdent('rwy 24')).toBe('24');
    expect(normalizeRunwayIdent('10')).toBe('10');
    expect(findRunway(AIRPORT, '01')).toBe(r01);
    expect(findRunway(AIRPORT, '6')).toBe(r06);
    expect(findRunway(AIRPORT, '33')).toBeUndefined();
  });

  it('picks the runway most into the wind; calm picks the longest', () => {
    expect(bestRunway(AIRPORT, 190, 12)).toBe(r19);
    expect(bestRunway(AIRPORT, 230, 12)).toBe(r24);
    expect(bestRunway(AIRPORT, 0, 0)?.lengthFt).toBe(6997);
  });

  it('prefers an ILS runway for approaches unless it has a tailwind', () => {
    // Wind 280/08: runway 24 has the most headwind (4.8 kt), 19 (ILS) is nearly crosswind but in use.
    expect(bestRunway(AIRPORT, 280, 8)).toBe(r24);
    expect(bestRunway(AIRPORT, 280, 8, true)).toBe(r19);
    // Only 19 has an ILS; wind 010/08 gives it an 8 kt tailwind -> not used.
    const oneIls: Airport = { ...AIRPORT, runways: [r01, r19, { ...r06, ils: undefined }, r24] };
    expect(bestRunway(oneIls, 10, 8, true)).toBe(r01);
  });
});

describe('planStart', () => {
  it('lines up on the requested runway', () => {
    const p = planStart(AIRPORT, { kind: 'runway', runway: '01' }, 'takeoff', META, { dir: 0, kt: 0 });
    expect(p.onGround).toBe(true);
    expect(p.runway).toBe(r01);
    expect(p.headingTrue).toBe(7);
    expect(distM(p, r01)).toBeCloseTo(LINEUP_M, 0);
  });

  it('places a 10 nm final on the glidepath and auto-tunes the ILS', () => {
    const p = planStart(AIRPORT, { kind: 'runway', runway: '19' }, 'approach', META, { dir: 0, kt: 0 });
    expect(p.onGround).toBe(false);
    expect(p.headingTrue).toBe(187);
    expect(p.ils?.freqMhz).toBeCloseTo(108.9, 3);
    // Distance from the threshold ~10 nm (landing threshold = runway end without displacement).
    expect(distM(p, r19) / NM_M).toBeCloseTo(FINAL_NM, 1);
    // 3 deg path: 50 ft TCH + tan(3 deg) * 10 nm = 50 + 3187 ft, + threshold elevation.
    const expected = 9 + TCH_FT + Math.tan((3 * Math.PI) / 180) * FINAL_NM * (NM_M / 0.3048);
    expect(p.altFtMsl).toBeCloseTo(expected, -1);
    expect(p.iasKt).toBe(META.typical.approachKias + 15);
  });

  it('starts cruise at the typical altitude away from the airport', () => {
    const p = planStart(AIRPORT, { kind: 'auto' }, 'cruise', META, { dir: 0, kt: 0 });
    expect(p.onGround).toBe(false);
    expect(p.altFtMsl).toBe(31000);
    expect(distM(p, AIRPORT) / NM_M).toBeGreaterThan(30);
  });

  it('falls back to the airport reference point without runways', () => {
    const p = planStart({ ...AIRPORT, runways: [] }, { kind: 'auto' }, 'ready_to_taxi', META, { dir: 0, kt: 0 });
    expect(p.onGround).toBe(true);
    expect(p.lat).toBe(AIRPORT.lat);
  });
});

describe('launch config', () => {
  it('parses query strings', () => {
    const base = defaultLaunch('_test-jet');
    const c = launchFromQuery('?aircraft=b737-800&airport=kteb&runway=01&state=approach&time=15:30&date=2026-06-21&weather=live:KJFK&autotest=1', base)!;
    expect(c.aircraftId).toBe('b737-800');
    expect(c.airport).toBe('KTEB');
    expect(c.spot).toEqual({ kind: 'runway', runway: '01' });
    expect(c.state).toBe('approach');
    expect(c.time).toEqual({ mode: 'custom', date: '2026-06-21', utcHours: 15.5 });
    expect(c.weather).toEqual({ mode: 'live', station: 'KJFK' });
    expect(c.autotest).toBe(true);
    expect(launchFromQuery('?foo=1', base)).toBeNull();
    const p = launchFromQuery('?airport=KSEA&parking=3&weather=storm&state=bogus', base)!;
    expect(p.spot).toEqual({ kind: 'parking', index: 2 });
    expect(p.weather).toEqual({ mode: 'preset', preset: 'storm' });
    expect(p.state).toBe(base.state);
  });

  it('sanitizes stored configs', () => {
    const c = sanitizeLaunch({ aircraftId: 42, airport: 'kjfk', state: 'nonsense' }, '_test-jet');
    expect(c.aircraftId).toBe('_test-jet');
    expect(typeof c.airport).toBe('string');
    expect(['cold_dark', 'ready_to_taxi', 'takeoff', 'approach', 'cruise']).toContain(c.state);
  });

  it('resolves day of year and UTC hours', () => {
    expect(resolveTime({ mode: 'custom', date: '2026-03-01', utcHours: 12 })).toEqual({ year: 2026, dayOfYear: 60, utcHours: 12 });
    // The UTC clock wraps day 365 (366 in leap years) to day 1.
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2028)).toBe(366);
    expect(daysInYear(2100)).toBe(365);
    expect(daysInYear(2000)).toBe(366);
    expect(resolveTime({ mode: 'custom', date: '2026-12-31', utcHours: 23 }).dayOfYear).toBe(daysInYear(2026));
    const now = new Date(Date.UTC(2024, 11, 31, 6, 30, 0));
    expect(resolveTime({ mode: 'now', date: '2000-01-01', utcHours: 0 }, now)).toEqual({ year: 2024, dayOfYear: 366, utcHours: 6.5 });
  });
});
