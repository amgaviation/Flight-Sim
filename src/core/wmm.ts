/**
 * World Magnetic Model WMM2025 (valid 2025.0 - 2030.0).
 *
 * Coefficients are embedded verbatim from the official NOAA NCEI file
 * `WMM2025.COF` (header "2025.0  WMM-2025  11/13/2024"), downloaded from
 * https://www.ncei.noaa.gov/products/world-magnetic-model/wmm-coefficients
 * (WMM2025COF.zip). The synthesis follows "The US/UK World Magnetic Model for
 * 2025-2030: Technical Report" (NOAA NCEI / BGS), sections 1.2-1.3:
 * geodetic -> geocentric spherical coordinates, time-adjusted Gauss
 * coefficients, Schmidt semi-normalised associated Legendre functions,
 * spherical-harmonic field synthesis, rotation back to geodetic axes.
 *
 * Verified in tests/core/wmm.test.ts against every row of the official
 * `WMM2025_TestValues.txt` shipped in the same archive.
 *
 * The functions are allocation-free (module-level scratch arrays); a full
 * evaluation costs roughly 0.5k floating-point ops, so callers on hot paths
 * should still cache declination and refresh it at a low rate.
 */
import { DEG2RAD, RAD2DEG } from './math';

/** Model epoch (decimal year). */
export const WMM_EPOCH = 2025.0;
/** End of validity (decimal year). */
export const WMM_VALID_UNTIL = 2030.0;
const N_MAX = 12;
/** Geomagnetic reference radius (m), WMM technical report Table 1. */
const A_REF = 6371200.0;
/** WGS84 semi-major axis and eccentricity squared (WMM technical report eq. 7). */
const WGS_A = 6378137.0;
const WGS_F = 1 / 298.257223563;
const WGS_E2 = WGS_F * (2 - WGS_F);

// n, m, g (nT), h (nT), g_dot (nT/yr), h_dot (nT/yr) — WMM2025.COF verbatim.
// prettier-ignore
const COF: readonly number[] = [
  1, 0, -29351.8, 0.0, 12.0, 0.0,
  1, 1, -1410.8, 4545.4, 9.7, -21.5,
  2, 0, -2556.6, 0.0, -11.6, 0.0,
  2, 1, 2951.1, -3133.6, -5.2, -27.7,
  2, 2, 1649.3, -815.1, -8.0, -12.1,
  3, 0, 1361.0, 0.0, -1.3, 0.0,
  3, 1, -2404.1, -56.6, -4.2, 4.0,
  3, 2, 1243.8, 237.5, 0.4, -0.3,
  3, 3, 453.6, -549.5, -15.6, -4.1,
  4, 0, 895.0, 0.0, -1.6, 0.0,
  4, 1, 799.5, 278.6, -2.4, -1.1,
  4, 2, 55.7, -133.9, -6.0, 4.1,
  4, 3, -281.1, 212.0, 5.6, 1.6,
  4, 4, 12.1, -375.6, -7.0, -4.4,
  5, 0, -233.2, 0.0, 0.6, 0.0,
  5, 1, 368.9, 45.4, 1.4, -0.5,
  5, 2, 187.2, 220.2, 0.0, 2.2,
  5, 3, -138.7, -122.9, 0.6, 0.4,
  5, 4, -142.0, 43.0, 2.2, 1.7,
  5, 5, 20.9, 106.1, 0.9, 1.9,
  6, 0, 64.4, 0.0, -0.2, 0.0,
  6, 1, 63.8, -18.4, -0.4, 0.3,
  6, 2, 76.9, 16.8, 0.9, -1.6,
  6, 3, -115.7, 48.8, 1.2, -0.4,
  6, 4, -40.9, -59.8, -0.9, 0.9,
  6, 5, 14.9, 10.9, 0.3, 0.7,
  6, 6, -60.7, 72.7, 0.9, 0.9,
  7, 0, 79.5, 0.0, -0.0, 0.0,
  7, 1, -77.0, -48.9, -0.1, 0.6,
  7, 2, -8.8, -14.4, -0.1, 0.5,
  7, 3, 59.3, -1.0, 0.5, -0.8,
  7, 4, 15.8, 23.4, -0.1, 0.0,
  7, 5, 2.5, -7.4, -0.8, -1.0,
  7, 6, -11.1, -25.1, -0.8, 0.6,
  7, 7, 14.2, -2.3, 0.8, -0.2,
  8, 0, 23.2, 0.0, -0.1, 0.0,
  8, 1, 10.8, 7.1, 0.2, -0.2,
  8, 2, -17.5, -12.6, 0.0, 0.5,
  8, 3, 2.0, 11.4, 0.5, -0.4,
  8, 4, -21.7, -9.7, -0.1, 0.4,
  8, 5, 16.9, 12.7, 0.3, -0.5,
  8, 6, 15.0, 0.7, 0.2, -0.6,
  8, 7, -16.8, -5.2, -0.0, 0.3,
  8, 8, 0.9, 3.9, 0.2, 0.2,
  9, 0, 4.6, 0.0, -0.0, 0.0,
  9, 1, 7.8, -24.8, -0.1, -0.3,
  9, 2, 3.0, 12.2, 0.1, 0.3,
  9, 3, -0.2, 8.3, 0.3, -0.3,
  9, 4, -2.5, -3.3, -0.3, 0.3,
  9, 5, -13.1, -5.2, 0.0, 0.2,
  9, 6, 2.4, 7.2, 0.3, -0.1,
  9, 7, 8.6, -0.6, -0.1, -0.2,
  9, 8, -8.7, 0.8, 0.1, 0.4,
  9, 9, -12.9, 10.0, -0.1, 0.1,
  10, 0, -1.3, 0.0, 0.1, 0.0,
  10, 1, -6.4, 3.3, 0.0, 0.0,
  10, 2, 0.2, 0.0, 0.1, -0.0,
  10, 3, 2.0, 2.4, 0.1, -0.2,
  10, 4, -1.0, 5.3, -0.0, 0.1,
  10, 5, -0.6, -9.1, -0.3, -0.1,
  10, 6, -0.9, 0.4, 0.0, 0.1,
  10, 7, 1.5, -4.2, -0.1, 0.0,
  10, 8, 0.9, -3.8, -0.1, -0.1,
  10, 9, -2.7, 0.9, -0.0, 0.2,
  10, 10, -3.9, -9.1, -0.0, -0.0,
  11, 0, 2.9, 0.0, 0.0, 0.0,
  11, 1, -1.5, 0.0, -0.0, -0.0,
  11, 2, -2.5, 2.9, 0.0, 0.1,
  11, 3, 2.4, -0.6, 0.0, -0.0,
  11, 4, -0.6, 0.2, 0.0, 0.1,
  11, 5, -0.1, 0.5, -0.1, -0.0,
  11, 6, -0.6, -0.3, 0.0, -0.0,
  11, 7, -0.1, -1.2, -0.0, 0.1,
  11, 8, 1.1, -1.7, -0.1, -0.0,
  11, 9, -1.0, -2.9, -0.1, 0.0,
  11, 10, -0.2, -1.8, -0.1, 0.0,
  11, 11, 2.6, -2.3, -0.1, 0.0,
  12, 0, -2.0, 0.0, 0.0, 0.0,
  12, 1, -0.2, -1.3, 0.0, -0.0,
  12, 2, 0.3, 0.7, -0.0, 0.0,
  12, 3, 1.2, 1.0, -0.0, -0.1,
  12, 4, -1.3, -1.4, -0.0, 0.1,
  12, 5, 0.6, -0.0, -0.0, -0.0,
  12, 6, 0.6, 0.6, 0.1, -0.0,
  12, 7, 0.5, -0.1, -0.0, -0.0,
  12, 8, -0.1, 0.8, 0.0, 0.0,
  12, 9, -0.4, 0.1, 0.0, -0.0,
  12, 10, -0.2, -1.0, -0.1, -0.0,
  12, 11, -1.3, 0.1, -0.0, 0.0,
  12, 12, -0.7, 0.2, -0.1, -0.1,
];

const SIZE = N_MAX + 1;
const idx = (n: number, m: number): number => n * SIZE + m;

// Schmidt-normalised main-field and secular-variation coefficients.
const G = new Float64Array(SIZE * SIZE);
const H = new Float64Array(SIZE * SIZE);
const GD = new Float64Array(SIZE * SIZE);
const HD = new Float64Array(SIZE * SIZE);
// Recursion constant K(n,m) for the Gauss-normalised Legendre functions.
const K = new Float64Array(SIZE * SIZE);
// Schmidt semi-normalisation factors S(n,m) that convert Gauss-normalised
// functions to Schmidt semi-normalised ones.
const S = new Float64Array(SIZE * SIZE);

(function init(): void {
  for (let i = 0; i < COF.length; i += 6) {
    const n = COF[i];
    const m = COF[i + 1];
    G[idx(n, m)] = COF[i + 2];
    H[idx(n, m)] = COF[i + 3];
    GD[idx(n, m)] = COF[i + 4];
    HD[idx(n, m)] = COF[i + 5];
  }
  S[idx(0, 0)] = 1;
  for (let n = 1; n <= N_MAX; n++) {
    S[idx(n, 0)] = (S[idx(n - 1, 0)] * (2 * n - 1)) / n;
    for (let m = 1; m <= n; m++) {
      const j = m === 1 ? 2 : 1;
      S[idx(n, m)] = S[idx(n, m - 1)] * Math.sqrt(((n - m + 1) * j) / (n + m));
    }
  }
  for (let n = 2; n <= N_MAX; n++) {
    for (let m = 0; m <= n; m++) {
      K[idx(n, m)] = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
    }
  }
})();

// Scratch (allocation-free evaluation).
const P = new Float64Array(SIZE * SIZE);
const DP = new Float64Array(SIZE * SIZE);
const COS_ML = new Float64Array(SIZE);
const SIN_ML = new Float64Array(SIZE);

export interface MagneticField {
  /** Declination (deg, + east): angle from true north to horizontal field. */
  declination: number;
  /** Inclination / dip (deg, + down). */
  inclination: number;
  /** Horizontal intensity (nT). */
  h: number;
  /** North component (nT). */
  x: number;
  /** East component (nT). */
  y: number;
  /** Vertical component (nT, + down). */
  z: number;
  /** Total intensity (nT). */
  f: number;
}

/** Decimal year of a JS Date (UTC), e.g. 2025-07-02T12:00Z -> ~2025.5. */
export function decimalYear(date: Date): number {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}

/**
 * Full WMM2025 field at a geodetic position.
 * @param latDeg geodetic latitude (deg)
 * @param lonDeg longitude (deg, east +)
 * @param altM height above the WGS84 ellipsoid (m)
 * @param year decimal year (clamped to the model validity window 2025.0-2030.0)
 * @param out optional reusable output object
 */
export function magneticField(latDeg: number, lonDeg: number, altM: number, year: number, out?: MagneticField): MagneticField {
  const o: MagneticField = out ?? { declination: 0, inclination: 0, h: 0, x: 0, y: 0, z: 0, f: 0 };
  const dt = Math.min(WMM_VALID_UNTIL, Math.max(WMM_EPOCH, year)) - WMM_EPOCH;

  // Geodetic -> geocentric spherical (technical report eq. 7-8).
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const rc = WGS_A / Math.sqrt(1 - WGS_E2 * sLat * sLat);
  const pxy = (rc + altM) * cLat;
  const pz = (rc * (1 - WGS_E2) + altM) * sLat;
  const r = Math.sqrt(pxy * pxy + pz * pz);
  const latC = Math.asin(pz / r); // geocentric latitude
  // Colatitude theta: cos(theta) = sin(latC), sin(theta) = cos(latC).
  const ct = Math.sin(latC);
  let st = Math.cos(latC);
  if (st < 1e-10) st = 1e-10; // avoid the pole singularity in Y

  // Gauss-normalised associated Legendre functions and theta-derivatives.
  P[0] = 1;
  DP[0] = 0;
  for (let n = 1; n <= N_MAX; n++) {
    for (let m = 0; m <= n; m++) {
      const k = idx(n, m);
      if (n === m) {
        const k1 = idx(n - 1, m - 1);
        P[k] = st * P[k1];
        DP[k] = st * DP[k1] + ct * P[k1];
      } else if (n === 1 && m === 0) {
        P[k] = ct * P[0];
        DP[k] = ct * DP[0] - st * P[0];
      } else {
        const k1 = idx(n - 1, m);
        const k2 = idx(n - 2, m);
        const p2 = m > n - 2 ? 0 : P[k2];
        const d2 = m > n - 2 ? 0 : DP[k2];
        P[k] = ct * P[k1] - K[k] * p2;
        DP[k] = ct * DP[k1] - st * P[k1] - K[k] * d2;
      }
    }
  }

  for (let m = 0; m <= N_MAX; m++) {
    COS_ML[m] = Math.cos(m * lon);
    SIN_ML[m] = Math.sin(m * lon);
  }

  // Spherical-harmonic synthesis in geocentric axes (report eq. 10-12).
  const ar = A_REF / r;
  let arn = ar * ar; // (a/r)^(n+2) starts at n=0 -> (a/r)^2; multiplied before use.
  let xp = 0;
  let yp = 0;
  let zp = 0;
  for (let n = 1; n <= N_MAX; n++) {
    arn *= ar; // (a/r)^(n+2)
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let m = 0; m <= n; m++) {
      const k = idx(n, m);
      const g = (G[k] + dt * GD[k]) * S[k];
      const h = (H[k] + dt * HD[k]) * S[k];
      const cm = COS_ML[m];
      const sm = SIN_ML[m];
      const gc = g * cm + h * sm;
      sx += gc * DP[k];
      sy += m * (g * sm - h * cm) * P[k];
      sz += gc * P[k];
    }
    xp += arn * sx;
    yp += arn * sy;
    zp -= (n + 1) * arn * sz;
  }
  yp /= st;

  // Rotate from geocentric to geodetic axes (report eq. 17).
  const psi = latC - lat;
  const cp = Math.cos(psi);
  const sp = Math.sin(psi);
  const x = xp * cp - zp * sp;
  const y = yp;
  const z = xp * sp + zp * cp;
  const hh = Math.sqrt(x * x + y * y);
  o.x = x;
  o.y = y;
  o.z = z;
  o.h = hh;
  o.f = Math.sqrt(hh * hh + z * z);
  o.declination = Math.atan2(y, x) * RAD2DEG;
  o.inclination = Math.atan2(z, hh) * RAD2DEG;
  return o;
}

const scratchField: MagneticField = { declination: 0, inclination: 0, h: 0, x: 0, y: 0, z: 0, f: 0 };

/** Magnetic declination / variation (deg, + east) at a geodetic position. */
export function magneticDeclination(latDeg: number, lonDeg: number, altM: number, year: number): number {
  return magneticField(latDeg, lonDeg, altM, year, scratchField).declination;
}

/** Magnetic inclination / dip (deg, + down). */
export function magneticInclination(latDeg: number, lonDeg: number, altM: number, year: number): number {
  return magneticField(latDeg, lonDeg, altM, year, scratchField).inclination;
}
