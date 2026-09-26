/**
 * WGS84 geodesy helpers used by the world renderer and WorldQuery.
 *
 * Everything here is pure, double precision and allocation-free when an `out`
 * argument is supplied. Heights are metres above the ellipsoid, which the sim
 * treats as MSL everywhere (terrain tiles are MSL; geoid separation is ignored
 * consistently, see `world/types.ts`).
 *
 * Source for the ellipsoid constants: NIMA TR8350.2 "Department of Defense
 * World Geodetic System 1984", 3rd ed., Table 3.1 (a = 6378137 m,
 * 1/f = 298.257223563).
 */

export const WGS84_A = 6378137.0; // NIMA TR8350.2 Table 3.1: semi-major axis (m)
export const WGS84_F = 1 / 298.257223563; // NIMA TR8350.2 Table 3.1: flattening
export const WGS84_B = WGS84_A * (1 - WGS84_F); // semi-minor axis (m)
export const WGS84_E2 = WGS84_F * (2 - WGS84_F); // first eccentricity squared
/** IUGG mean Earth radius R1 = (2a + b) / 3 (m), used for spherical approximations. */
export const EARTH_MEAN_RADIUS_M = 6371008.8;
/** Equatorial circumference used by the Web Mercator tiling scheme (EPSG:3857), metres. */
export const MERCATOR_CIRCUMFERENCE_M = 2 * Math.PI * WGS84_A;

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const FT_TO_M = 0.3048; // exact, international foot
export const M_TO_FT = 1 / FT_TO_M;
export const NM_TO_M = 1852; // exact, international nautical mile

export interface LatLon {
  lat: number;
  lon: number;
}

export interface GeodeticOut {
  lat: number;
  lon: number;
  alt_m: number;
}

/** Wraps a longitude to [-180, 180). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Wraps an angle to [0, 360). */
export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed smallest longitude difference b - a in (-180, 180]. */
export function lonDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** Prime-vertical radius of curvature N(phi) (m). */
export function primeVerticalRadius(latRad: number): number {
  const s = Math.sin(latRad);
  return WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
}

/** Meridian radius of curvature M(phi) (m). */
export function meridianRadius(latRad: number): number {
  const s = Math.sin(latRad);
  const w = 1 - WGS84_E2 * s * s;
  return (WGS84_A * (1 - WGS84_E2)) / (w * Math.sqrt(w));
}

/**
 * Metres per degree of latitude and longitude at a latitude (ellipsoidal).
 * Used for small-area local tangent-plane math (runways, airports).
 */
export function metresPerDegree(latDeg: number, out: { lat: number; lon: number }): { lat: number; lon: number } {
  const phi = latDeg * DEG2RAD;
  out.lat = meridianRadius(phi) * DEG2RAD;
  out.lon = primeVerticalRadius(phi) * Math.cos(phi) * DEG2RAD;
  return out;
}

/** Geodetic (deg, deg, m) to Earth-centred Earth-fixed (m). */
export function geodeticToEcef<T extends { [i: number]: number }>(latDeg: number, lonDeg: number, h: number, out: T): T {
  const phi = latDeg * DEG2RAD;
  const lam = lonDeg * DEG2RAD;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sp * sp);
  out[0] = (n + h) * cp * Math.cos(lam);
  out[1] = (n + h) * cp * Math.sin(lam);
  out[2] = (n * (1 - WGS84_E2) + h) * sp;
  return out;
}

/**
 * ECEF (m) to geodetic. Fixed-point iteration on
 * phi = atan2(z + e^2 N sin(phi), p), with the height from the
 * pole-safe form h = p cos(phi) + z sin(phi) - a sqrt(1 - e^2 sin^2 phi).
 * Five iterations converge far below 1e-12 rad for |h| < 1000 km.
 */
export function ecefToGeodetic(x: number, y: number, z: number, out: GeodeticOut): GeodeticOut {
  const p = Math.hypot(x, y);
  let phi = Math.atan2(z, p * (1 - WGS84_E2));
  for (let i = 0; i < 5; i++) {
    const s = Math.sin(phi);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
    phi = Math.atan2(z + WGS84_E2 * n * s, p);
  }
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  out.lat = phi * RAD2DEG;
  out.lon = p > 0 ? Math.atan2(y, x) * RAD2DEG : 0;
  out.alt_m = p * c + z * s - WGS84_A * Math.sqrt(1 - WGS84_E2 * s * s);
  return out;
}

/**
 * Local ENU basis at a geodetic point, as a row-major 3x3 matrix whose rows are
 * the East, North and Up unit vectors in ECEF. `basis * (ecef - origin)` gives
 * (e, n, u).
 */
export function enuBasis<T extends { [i: number]: number }>(latDeg: number, lonDeg: number, out: T): T {
  const phi = latDeg * DEG2RAD;
  const lam = lonDeg * DEG2RAD;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const sl = Math.sin(lam);
  const cl = Math.cos(lam);
  // East
  out[0] = -sl;
  out[1] = cl;
  out[2] = 0;
  // North
  out[3] = -sp * cl;
  out[4] = -sp * sl;
  out[5] = cp;
  // Up
  out[6] = cp * cl;
  out[7] = cp * sl;
  out[8] = sp;
  return out;
}

/** Great-circle distance (m) on the mean-radius sphere (haversine). */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dp = p2 - p1;
  const dl = lonDelta(lon1, lon2) * DEG2RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing (deg true, 0..360) from point 1 to point 2. */
export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dl = lonDelta(lon1, lon2) * DEG2RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) * RAD2DEG);
}

/** Destination point along a great circle on the mean-radius sphere. */
export function destinationPoint(latDeg: number, lonDeg: number, bearingDeg: number, distM: number, out: LatLon): LatLon {
  const d = distM / EARTH_MEAN_RADIUS_M;
  const b = bearingDeg * DEG2RAD;
  const p1 = latDeg * DEG2RAD;
  const sp2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b);
  const p2 = Math.asin(Math.max(-1, Math.min(1, sp2)));
  const l2 = Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sp2);
  out.lat = p2 * RAD2DEG;
  out.lon = wrapLon(lonDeg + l2 * RAD2DEG);
  return out;
}

/**
 * Distance (m) to the geometric horizon from a height above a sphere of mean
 * radius: sqrt(2 R h + h^2). Ignores refraction (standard refraction adds ~8%).
 */
export function horizonDistanceM(heightM: number): number {
  const h = Math.max(0, heightM);
  return Math.sqrt(2 * EARTH_MEAN_RADIUS_M * h + h * h);
}

/** Scalar smoothstep, identical to GLSL's. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
