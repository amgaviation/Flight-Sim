/**
 * Climate heuristics shared by the terrain shader (GLSL mirror below) and the
 * physics surface classification, so what you see is what the wheels feel.
 *
 * Permanent snow line vs latitude: values after the classic compilation in
 * R. F. Flint, "Glacial and Quaternary Geology" (1971), as tabulated on
 * Wikipedia "Snow line" (approximate climatic snow line, metres):
 *   0-10 deg: ~4,800-5,000 (tropics); 20 deg: ~5,000-5,300 (dry subtropics);
 *   30-35 deg: ~4,000-4,600; 45 deg (Alps): ~2,700-3,000; 60 deg: ~1,500;
 *   70 deg: ~600-1,000; 78+ deg: ~0-300.
 * EST: 30-40 deg values biased to the dry-continental end (Rockies ~4,000 m at
 * 40 N, where only the highest summits hold snow in late summer).
 * Seasonal snow cover is added in the local winter at mid/high latitudes:
 * EST up to 1,500 m lower in mid-January (NH) / mid-July (SH), fading toward the tropics.
 */
import { DEG2RAD } from '../geo';

const SNOW_LAT = [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90];
const SNOW_ELEV = [4900, 4900, 5100, 4800, 3900, 3000, 2500, 1500, 700, 200, 0];

/** Climatic permanent snow line (m) at a latitude. */
export function permanentSnowLineM(latDeg: number): number {
  const a = Math.min(90, Math.abs(latDeg));
  for (let i = 1; i < SNOW_LAT.length; i++) {
    if (a <= SNOW_LAT[i]) {
      const t = (a - SNOW_LAT[i - 1]) / (SNOW_LAT[i] - SNOW_LAT[i - 1]);
      return SNOW_ELEV[i - 1] + (SNOW_ELEV[i] - SNOW_ELEV[i - 1]) * t;
    }
  }
  return 0;
}

/**
 * Winter factor 0..1 for a latitude and day of year: 1 in mid-winter at the
 * given hemisphere, 0 in summer; scaled by how seasonal the latitude is.
 */
export function winterFactor(latDeg: number, dayOfYear: number): number {
  // Cosine peaking on Jan 15 (day 15) for the northern hemisphere.
  const c = Math.cos(((dayOfYear - 15) / 365.25) * 2 * Math.PI);
  const hemi = latDeg >= 0 ? c : -c;
  const seasonal = Math.min(1, Math.max(0, (Math.abs(latDeg) - 25) / 25));
  return Math.max(0, hemi) * seasonal;
}

/** Effective snow line (m) including seasonal snow. */
export function snowLineM(latDeg: number, dayOfYear: number): number {
  return Math.max(0, permanentSnowLineM(latDeg) - 1500 * winterFactor(latDeg, dayOfYear));
}

/** Slope (rad) above which snow does not stick and rock shows (EST ~ 50 deg, avalanche angle). */
export const SNOW_MAX_SLOPE_RAD = 50 * DEG2RAD;

/**
 * Humid (sub)tropical regions inside the 10-40 deg "arid belt" the terrain shader assumes:
 * the eastern continental margins and monsoon lands (Koppen Cfa / Cwa / Am / Aw), after the
 * Koppen-Geiger map of Beck et al. (2018, Scientific Data 5:180214). Each entry is
 * [latMin, latMax, lonMin, lonMax] in degrees. EST: rectangles are coarse outlines of those
 * climate zones, with a 3 deg soft edge (the heuristic has no land-cover data).
 */
const HUMID_BOXES: readonly (readonly [number, number, number, number])[] = [
  [24, 39, -98, -74], // south-eastern United States (Cfa east of ~98 W: Atlanta, Savannah, Houston, Florida)
  [7, 24, -98, -59], // Gulf coast of Mexico, Central America, Caribbean
  [20, 40, 104, 142], // southern China, Taiwan, southern Korea and Japan
  [6, 22, 95, 127], // mainland South-East Asia, Philippines
  [16, 30, 79, 97], // eastern India, Bangladesh, Myanmar (monsoon)
  [-38, -15, 145, 154], // eastern Australia coast
  [-35, -15, -60, -38], // south-eastern Brazil, Paraguay, Uruguay, north-eastern Argentina
  [-32, -12, 29, 41], // south-east African coast
];

/** Humid-region weight 0..1 at a position (1 inside a humid box, fading over 3 deg outside). */
export function humidRegionWeight(latDeg: number, lonDeg: number): number {
  const EDGE = 3;
  let w = 0;
  for (const [la0, la1, lo0, lo1] of HUMID_BOXES) {
    const dLat = Math.max(la0 - latDeg, 0, latDeg - la1);
    const dLon = Math.max(lo0 - lonDeg, 0, lonDeg - lo1) * Math.cos(latDeg * DEG2RAD);
    const d = Math.hypot(dLat, dLon);
    w = Math.max(w, 1 - Math.min(1, d / EDGE));
  }
  return w;
}

/** GLSL mirror of `snowLineM` (keep in sync). Expects `uDayOfYear` uniform. */
export const GLSL_BIOME = /* glsl */ `
float permanentSnowLine(float latDeg) {
  float a = min(90.0, abs(latDeg));
  if (a <= 10.0) return 4900.0;
  if (a <= 20.0) return mix(4900.0, 5100.0, (a - 10.0) / 10.0);
  if (a <= 30.0) return mix(5100.0, 4800.0, (a - 20.0) / 10.0);
  if (a <= 40.0) return mix(4800.0, 3900.0, (a - 30.0) / 10.0);
  if (a <= 45.0) return mix(3900.0, 3000.0, (a - 40.0) / 5.0);
  if (a <= 50.0) return mix(3000.0, 2500.0, (a - 45.0) / 5.0);
  if (a <= 60.0) return mix(2500.0, 1500.0, (a - 50.0) / 10.0);
  if (a <= 70.0) return mix(1500.0, 700.0, (a - 60.0) / 10.0);
  if (a <= 80.0) return mix(700.0, 200.0, (a - 70.0) / 10.0);
  return mix(200.0, 0.0, (a - 80.0) / 10.0);
}
float winterFactor(float latDeg, float dayOfYear) {
  float c = cos((dayOfYear - 15.0) / 365.25 * 6.283185307);
  float hemi = latDeg >= 0.0 ? c : -c;
  float seasonal = clamp((abs(latDeg) - 25.0) / 25.0, 0.0, 1.0);
  return max(0.0, hemi) * seasonal;
}
float snowLine(float latDeg, float dayOfYear) {
  return max(0.0, permanentSnowLine(latDeg) - 1500.0 * winterFactor(latDeg, dayOfYear));
}
`;
