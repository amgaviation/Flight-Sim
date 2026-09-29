import { describe, expect, it } from 'vitest';
import {
  julianDay0h,
  julianDayFromDayOfYear,
  moonPosition,
  sunPosition,
  gmstDeg,
} from '../../src/world/sky/solar';

/**
 * Reference values produced by the NOAA Global Monitoring Laboratory solar
 * position calculator code (https://gml.noaa.gov/grad/solcalc/azel.html,
 * functions calcSunDeclination / calcEquationOfTime / calcSun, run with
 * time zone 0 and the stated UTC time; longitudes converted from NOAA's
 * west-positive convention).
 */
const NOAA_CASES = [
  { name: 'Boulder June solstice', y: 2024, m: 6, d: 21, utcH: 18, lat: 40.015, lon: -105.2705, decl: 23.4359, eqTime: -1.9791, elevation: 68.754, azimuth: 136.5496 },
  { name: 'Sydney December', y: 2024, m: 12, d: 21, utcH: 2, lat: -33.8688, lon: 151.2093, decl: -23.4382, eqTime: 1.8846, elevation: 79.4693, azimuth: 351.5368 },
  { name: 'London equinox', y: 2025, m: 3, d: 20, utcH: 12, lat: 51.5074, lon: -0.1278, decl: 0.0519, eqTime: -7.3619, elevation: 38.5378, azimuth: 177.4841 },
  { name: 'Reykjavik winter', y: 2025, m: 1, d: 15, utcH: 13, lat: 64.1466, lon: -21.9426, decl: -21.0152, eqTime: -9.5084, elevation: 4.7015, azimuth: 171.2777 },
  { name: 'Singapore', y: 2025, m: 8, d: 5, utcH: 4.5, lat: 1.3521, lon: 103.8198, decl: 16.9043, eqTime: -6.0316, elevation: 71.5019, azimuth: 32.2262 },
  { name: 'Denver night', y: 2024, m: 11, d: 1, utcH: 2, lat: 39.7392, lon: -104.9903, decl: -14.5423, eqTime: 16.4696, elevation: -23.8413, azimuth: 270.6065 },
  { name: 'Wichita dusk', y: 2026, m: 9, d: 26, utcH: 23.75, lat: 37.6872, lon: -97.3301, decl: -1.5508, eqTime: 8.8237, elevation: 6.193, azimuth: 263.319 },
];

describe('Julian day', () => {
  it('matches Meeus examples', () => {
    // Meeus, Astronomical Algorithms, Example 7.a: 1957 Oct 4.81 = JD 2436116.31
    expect(julianDay0h(1957, 10, 4) + 0.81).toBeCloseTo(2436116.31, 6);
    // J2000.0 = 2000 Jan 1.5 = JD 2451545.0
    expect(julianDay0h(2000, 1, 1) + 0.5).toBe(2451545.0);
    // Day-of-year form: 2024-06-21 is day 173 (leap year).
    expect(julianDayFromDayOfYear(2024, 173, 18)).toBeCloseTo(julianDay0h(2024, 6, 21) + 0.75, 9);
  });
});

describe('NOAA solar position', () => {
  for (const c of NOAA_CASES) {
    it(`${c.name}`, () => {
      const jd = julianDay0h(c.y, c.m, c.d) + c.utcH / 24;
      const s = sunPosition(jd, c.lat, c.lon);
      expect(s.declinationDeg).toBeCloseTo(c.decl, 3);
      expect(s.equationOfTimeMin).toBeCloseTo(c.eqTime, 3);
      expect(Math.abs(s.elevationDeg - c.elevation)).toBeLessThan(0.002);
      expect(Math.abs(s.azimuthDeg - c.azimuth)).toBeLessThan(0.002);
    });
  }

  it('Meeus Example 25.a declination (1992 Oct 13.0)', () => {
    // Meeus Example 25.a: apparent declination -7deg 47' 06" = -7.78507 deg (TD; UT differs by ~1 min).
    const s = sunPosition(2448908.5, 0, 0);
    expect(s.declinationDeg).toBeCloseTo(-7.78507, 2);
  });
});

describe('Moon', () => {
  it('Meeus Example 47.a ecliptic position within low-precision tolerance', () => {
    // Meeus Example 47.a: 1992 April 12 0h TD: lambda = 133.162655, beta = -3.229126 deg.
    const m = moonPosition(2448724.5, 0, 0);
    expect(Math.abs(m.eclLonDeg - 133.162655)).toBeLessThan(0.3);
    expect(Math.abs(m.eclLatDeg - -3.229126)).toBeLessThan(0.3);
  });

  it('is nearly full at a known full moon and nearly new at a known new moon', () => {
    // Full moon 2024-01-25 17:54 UTC; new moon 2024-01-11 11:57 UTC (USNO phases).
    const full = moonPosition(julianDay0h(2024, 1, 25) + 17.9 / 24, 0, 0);
    expect(full.illuminated).toBeGreaterThan(0.98);
    const nw = moonPosition(julianDay0h(2024, 1, 11) + 11.95 / 24, 0, 0);
    expect(nw.illuminated).toBeLessThan(0.02);
  });

  it('GMST at J2000 epoch', () => {
    // Meeus eq. 12.4 at JD 2451545.0 gives 280.46061837 deg.
    expect(gmstDeg(2451545.0)).toBeCloseTo(280.46061837, 6);
  });
});
