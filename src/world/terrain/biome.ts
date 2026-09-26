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
