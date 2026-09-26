import { describe, expect, it } from 'vitest';
import {
  EnuFrame,
  EARTH_RADIUS_NM,
  WGS84_A,
  WGS84_B,
  alongTrackNm,
  centralAngle,
  courseIntersection,
  crossTrackNm,
  destinationPoint,
  distanceNm,
  ecefToGeodetic,
  finalBearing,
  geodeticToEcef,
  initialBearing,
  intermediatePoint,
  meridianRadius,
  offsetNorthEast,
  primeVerticalRadius,
} from '../../src/core/geo';

const R2D = 180 / Math.PI;
// Ed Williams, Aviation Formulary V1.47 worked examples (west-positive radians
// converted to east-positive degrees).
const LAX = { lat: 0.592539 * R2D, lon: -2.06647 * R2D };
const JFK = { lat: 0.709186 * R2D, lon: -1.287762 * R2D };

describe('great-circle navigation (Aviation Formulary examples)', () => {
  it('LAX-JFK distance and initial course', () => {
    expect(centralAngle(LAX.lat, LAX.lon, JFK.lat, JFK.lon)).toBeCloseTo(0.623585, 5);
    expect(distanceNm(LAX.lat, LAX.lon, JFK.lat, JFK.lon)).toBeCloseTo(0.623585 * EARTH_RADIUS_NM, 0);
    expect(initialBearing(LAX.lat, LAX.lon, JFK.lat, JFK.lon)).toBeCloseTo(1.150035 * R2D, 3);
  });

  it('point 100 nm (formulary: 0.0290888 rad) from LAX along the course', () => {
    const p = destinationPoint(LAX.lat, LAX.lon, 1.150035 * R2D, 0.0290888 * EARTH_RADIUS_NM);
    expect(p.lat).toBeCloseTo(0.60418 * R2D, 3);
    expect(p.lon).toBeCloseTo(-2.034206 * R2D, 3);
  });

  it('cross-track and along-track of D (N34:30 W116:30): 7.4512 nm right, 99.588 nm along', () => {
    const D = { lat: 34.5, lon: -116.5 };
    const k = EARTH_RADIUS_NM / ((180 * 60) / Math.PI); // formulary uses 1 nm = 1 arc-minute
    expect(crossTrackNm(LAX.lat, LAX.lon, JFK.lat, JFK.lon, D.lat, D.lon)).toBeCloseTo(7.4512 * k, 2);
    expect(alongTrackNm(LAX.lat, LAX.lon, JFK.lat, JFK.lon, D.lat, D.lon)).toBeCloseTo(99.588 * k, 1);
    // Mirror point on the other side must be negative (left).
    expect(crossTrackNm(LAX.lat, LAX.lon, JFK.lat, JFK.lon, 35.2, -117.2)).toBeLessThan(0);
  });

  it('intersection of radials REO 051 / BKE 137 lies at Boise (43.572N 116.189W)', () => {
    const out = { lat: 0, lon: 0 };
    const ok = courseIntersection(42.6, -117.866, 51, 44.84, -117.806, 137, out);
    expect(ok).toBe(true);
    expect(out.lat).toBeCloseTo(43.572, 2);
    expect(out.lon).toBeCloseTo(-116.189, 2);
    // Diverging courses have no forward intersection.
    expect(courseIntersection(42.6, -117.866, 231, 44.84, -117.806, 317, out)).toBe(false);
  });

  it('intermediate point 40% LAX-JFK: 38 deg 40.167 N, 101 deg 37.570 W', () => {
    const p = intermediatePoint(LAX.lat, LAX.lon, JFK.lat, JFK.lon, 0.4);
    expect(p.lat).toBeCloseTo(38 + 40.167 / 60, 3);
    expect(p.lon).toBeCloseTo(-(101 + 37.57 / 60), 3);
  });

  it('final bearing differs from initial on long routes and equals reverse+180', () => {
    const fb = finalBearing(LAX.lat, LAX.lon, JFK.lat, JFK.lon);
    const rev = initialBearing(JFK.lat, JFK.lon, LAX.lat, LAX.lon);
    expect(fb).toBeCloseTo((rev + 180) % 360, 9);
    expect(fb).toBeGreaterThan(75);
  });

  it('cardinal bearings and 1 deg of latitude = 60 nm on the sphere', () => {
    expect(initialBearing(0, 0, 1, 0)).toBeCloseTo(0, 9);
    expect(initialBearing(0, 0, 0, 1)).toBeCloseTo(90, 9);
    expect(initialBearing(0, 0, -1, 0)).toBeCloseTo(180, 9);
    expect(initialBearing(0, 0, 0, -1)).toBeCloseTo(270, 9);
    expect(distanceNm(0, 0, 1, 0)).toBeCloseTo((Math.PI / 180) * EARTH_RADIUS_NM, 9);
  });
});

describe('WGS84 ECEF / ENU', () => {
  it('known ECEF points', () => {
    const p = geodeticToEcef(0, 0, 0);
    expect(p.x).toBeCloseTo(WGS84_A, 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
    const n = geodeticToEcef(90, 0, 0);
    expect(n.z).toBeCloseTo(WGS84_B, 6);
    const e = geodeticToEcef(0, 90, 1000);
    expect(e.y).toBeCloseTo(WGS84_A + 1000, 6);
  });

  it('geodetic <-> ECEF round trip is sub-millimetre', () => {
    const cases = [
      [47.6062, -122.3321, 56],
      [-33.9, 151.2, 12000],
      [89.9, 45, 100],
      [-89.99, -170, 3000],
      [0.0001, 179.9999, -50],
      [40.6398, -73.7789, 11887],
    ];
    for (const [lat, lon, h] of cases) {
      const x = geodeticToEcef(lat, lon, h);
      const g = ecefToGeodetic(x.x, x.y, x.z);
      expect(g.lat).toBeCloseTo(lat, 9);
      expect(g.lon).toBeCloseTo(lon, 9);
      expect(g.alt).toBeCloseTo(h, 4);
    }
  });

  it('ENU axes at a reference point', () => {
    const f = new EnuFrame(45, 10, 100);
    const up = f.geodeticToEnu(45, 10, 1100);
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(0, 6);
    expect(up.z).toBeCloseTo(1000, 6);
    // 0.01 deg north ~= meridian radius * 0.01 deg
    const n = f.geodeticToEnu(45.01, 10, 100);
    expect(n.y).toBeCloseTo((meridianRadius(45.005) + 100) * 0.01 * (Math.PI / 180), 0);
    expect(n.x).toBeCloseTo(0, 3);
    const e = f.geodeticToEnu(45, 10.01, 100);
    expect(e.x).toBeGreaterThan(780);
    expect(e.z).toBeLessThan(0); // earth curvature: points along the surface drop below the tangent plane
    const back = f.enuToGeodetic(e.x, e.y, e.z);
    expect(back.lat).toBeCloseTo(45, 9);
    expect(back.lon).toBeCloseTo(10.01, 9);
    expect(back.alt).toBeCloseTo(100, 4);
  });

  it('radii of curvature at equator and pole', () => {
    expect(meridianRadius(0)).toBeCloseTo(6335439.327, 2);
    expect(primeVerticalRadius(0)).toBeCloseTo(WGS84_A, 6);
    expect(meridianRadius(90)).toBeCloseTo(primeVerticalRadius(90), 6);
    expect(primeVerticalRadius(90)).toBeCloseTo(6399593.626, 2);
  });

  it('offsetNorthEast moves by metres', () => {
    const p = offsetNorthEast(45, 10, 1000, 1000);
    const f = new EnuFrame(45, 10, 0);
    const enu = f.geodeticToEnu(p.lat, p.lon, 0);
    expect(enu.x).toBeCloseTo(1000, 0);
    expect(enu.y).toBeCloseTo(1000, 0);
  });
});
