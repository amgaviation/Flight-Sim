/**
 * Natural illumination (pure functions).
 *
 * Clear-sky horizontal illuminance vs solar elevation, piecewise-linear in
 * log10(lux). Anchor values from the commonly cited photometric table
 * (Wikipedia "Lux", after Schlyter "Radiometry and photometry in astronomy"):
 *   direct sunlight + sky 32,000-100,000+ lux; sunrise/sunset on a clear day
 *   ~400 lux; dark limit of civil twilight (-6 deg) 3.4 lux; moonless clear
 *   night with airglow ~0.002 lux; full moon 0.05-0.3 lux.
 * Intermediate points (-12, -3, +5, +10, +20, +40 deg) interpolate the
 * published twilight/daylight curves (U.S. Naval Observatory; Bond & Henderson
 * 1963) and are marked EST.
 */
import { DEG2RAD } from '../geo';

const TABLE: [number, number][] = [
  [-18, -2.7], // moonless clear night with airglow ~0.002 lux
  [-12, -1.9], // EST nautical twilight end ~0.01 lux
  [-6, 0.53], // civil twilight dark limit 3.4 lux
  [-3, 1.6], // EST ~40 lux
  [0, 2.6], // sunrise/sunset ~400 lux
  [5, 3.6], // EST ~4,000 lux
  [10, 4.15], // EST ~14,000 lux
  [20, 4.6], // EST ~40,000 lux
  [40, 4.9], // EST ~80,000 lux
  [90, 5.05], // ~110,000 lux
];

/** Clear-sky horizontal illuminance (lux) for a solar elevation (deg). */
export function clearSkyIlluminanceLux(sunElevDeg: number): number {
  if (sunElevDeg <= TABLE[0][0]) return 10 ** TABLE[0][1];
  for (let i = 1; i < TABLE.length; i++) {
    const [e1, l1] = TABLE[i];
    if (sunElevDeg <= e1) {
      const [e0, l0] = TABLE[i - 1];
      return 10 ** (l0 + ((l1 - l0) * (sunElevDeg - e0)) / (e1 - e0));
    }
  }
  return 10 ** TABLE[TABLE.length - 1][1];
}

/**
 * Moonlight illuminance (lux): full moon at high elevation ~0.25 lux,
 * scaled by the illuminated fraction^1.5 (opposition surge makes the full
 * moon disproportionately bright, EST) and sin(elevation).
 */
export function moonIlluminanceLux(moonElevDeg: number, illuminated: number): number {
  if (moonElevDeg <= -1) return 0;
  const s = Math.max(0, Math.sin(Math.max(0, moonElevDeg + 1) * DEG2RAD));
  return 0.25 * Math.pow(Math.max(0, illuminated), 1.5) * Math.pow(s, 0.8);
}

/**
 * Fraction of global daylight reaching the ground below a cloud layer of
 * fractional cover. EST: a typical stratocumulus/stratus overcast transmits
 * ~20-40% of clear-sky global irradiance (dense overcast ~1,000 lux in the Lux
 * table is the dark end); 0.3 at full cover, quadratic in cover so scattered
 * cloud barely dims the scene.
 */
export function cloudTransmission(cover: number): number {
  const c = Math.min(1, Math.max(0, cover));
  return 1 - 0.7 * c * c;
}

/**
 * Ambient light level 0..1 for display auto-dimming (env.ambient_light):
 * log-scaled like a photocell, 0.1 lux -> 0, 100,000 lux -> 1.
 */
export function ambientLevel(lux: number): number {
  const l = Math.log10(Math.max(1e-6, lux));
  return Math.min(1, Math.max(0, (l + 1) / 6));
}

/** B-V colour index to approximate linear RGB (Ballesteros 2012 temperature + blackbody fit). */
export function bvToRgb(bv: number, out: [number, number, number]): [number, number, number] {
  const b = Math.min(2, Math.max(-0.4, bv));
  const T = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  // Tanner Helland blackbody approximation (sRGB 0..255), converted to linear 0..1.
  const t = T / 100;
  let r: number;
  let g: number;
  let bl: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    bl = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    bl = 255;
  }
  const lin = (v: number) => {
    const c = Math.min(255, Math.max(0, v)) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  out[0] = lin(r);
  out[1] = lin(g);
  out[2] = lin(bl);
  return out;
}
