/**
 * Atmosphere, air data and wind for the flight model.
 *
 *  - U.S. Standard Atmosphere 1976 / ISA (identical below 86 km): seven
 *    layers to 84.852 km geopotential. Constants from NOAA/NASA/USAF,
 *    "U.S. Standard Atmosphere, 1976" (NASA-TM-X-74335), Tables 1-4:
 *    R* = 8.31432 J/(mol K), M0 = 28.9644 g/mol, g0 = 9.80665 m/s^2,
 *    r0 = 6,356,766 m, P0 = 101,325 Pa, T0 = 288.15 K.
 *  - Non-standard day: a constant temperature deviation dT = env.sl_temp_c - 15
 *    applied at all pressure levels (ICAO convention used for altimeter
 *    temperature error). QNH is an altimeter setting: at the reporting
 *    station (elevation env.qnh_ref_elev_ft, default MSL) the pressure
 *    altitude is Hp(QNH) + elevation, so an altimeter set to QNH reads the
 *    station elevation on the ground (ICAO Annex 3 / Doc 8896 QNH definition;
 *    FAA-H-8083-15B ch. 5: altimeter within 75 ft of field elevation with the
 *    current setting). True (geopotential) altitude away from the station is
 *    the hydrostatic integral dz = (T_std + dT)/T_std dHp from that anchor,
 *    which is why the temperature error grows with height above the altimeter
 *    setting source (ICAO Doc 8168 Vol I cold-temperature correction).
 *  - Airspeed: compressible pitot relations (subsonic isentropic, Rayleigh
 *    pitot formula above M 1), gamma = 1.4.
 *  - Winds: surface wind at 10 m, logarithmic surface layer, boundary-layer
 *    shear and veer to the gradient/aloft wind, winds-aloft layers, gusts.
 *  - Turbulence: Dryden model per MIL-F-8785C section 3.7 (scale lengths,
 *    intensities, transfer functions incl. rotational components); the
 *    medium/high-altitude intensity table is MIL-F-8785C Figure 7 (values as
 *    tabulated in JSBSim FGWinds.cpp). Deterministic (seeded PRNG) and
 *    allocation-free per step.
 */
import { clamp, interp1, lerp, Prng, DEG2RAD, RAD2DEG, wrap360 } from '../core/math';
import { FT_TO_M, INHG_TO_PA, KT_TO_MS, M_TO_FT, ZERO_C_IN_K } from '../core/units';
import type { Vec3 } from '../core/linalg';
import type { Table1D } from './types';

// ------------------------------------------------------------------ constants

export const R_STAR = 8.31432; // J/(mol K), USSA-1976
export const M0 = 0.0289644; // kg/mol
export const G0 = 9.80665;
/** Specific gas constant of dry air (J/(kg K)) = R* / M0. */
export const R_AIR = R_STAR / M0; // 287.0531...
export const GAMMA = 1.4;
export const P0 = 101325;
export const T0 = 288.15;
export const RHO0 = P0 / (R_AIR * T0); // 1.2250 kg/m^3
export const A0 = Math.sqrt(GAMMA * R_AIR * T0); // 340.294 m/s
/** Effective earth radius for geopotential altitude (USSA-1976). */
export const R0_GEOPOTENTIAL = 6356766;
const GMR = (G0 * M0) / R_STAR; // K/m -> exponent helper (0.0341632)

/** Layer bases (geopotential m), base temperatures (K) and lapse rates (K/m). */
const LAYER_H = [0, 11000, 20000, 32000, 47000, 51000, 71000, 84852];
const LAYER_L = [-0.0065, 0, 0.001, 0.0028, 0, -0.0028, -0.002];
const LAYER_T = new Float64Array(8);
const LAYER_P = new Float64Array(8);
/** Cumulative integral F(Hb) = int_0^Hb dx / T_std(x), used for non-standard altimetry. */
const LAYER_F = new Float64Array(8);
(function initLayers(): void {
  LAYER_T[0] = T0;
  LAYER_P[0] = P0;
  LAYER_F[0] = 0;
  for (let i = 0; i < 7; i++) {
    const dh = LAYER_H[i + 1] - LAYER_H[i];
    const L = LAYER_L[i];
    const Tb = LAYER_T[i];
    const Tt = Tb + L * dh;
    LAYER_T[i + 1] = Tt;
    if (L === 0) {
      LAYER_P[i + 1] = LAYER_P[i] * Math.exp((-GMR * dh) / Tb);
      LAYER_F[i + 1] = LAYER_F[i] + dh / Tb;
    } else {
      LAYER_P[i + 1] = LAYER_P[i] * Math.pow(Tb / Tt, GMR / L);
      LAYER_F[i + 1] = LAYER_F[i] + Math.log(Tt / Tb) / L;
    }
  }
})();

function layerOf(h: number): number {
  if (h < LAYER_H[1]) return 0;
  for (let i = 1; i < 7; i++) if (h < LAYER_H[i + 1]) return i;
  return 6;
}

// ------------------------------------------------------------------ ISA (pure)

/** Geometric -> geopotential altitude (m). */
export function geometricToGeopotential(h: number): number {
  return (R0_GEOPOTENTIAL * h) / (R0_GEOPOTENTIAL + h);
}

/** Geopotential -> geometric altitude (m). */
export function geopotentialToGeometric(H: number): number {
  return (R0_GEOPOTENTIAL * H) / (R0_GEOPOTENTIAL - H);
}

/** ISA temperature (K) at geopotential altitude H (m). Extrapolates below 0 with the tropospheric lapse. */
export function isaTemperature(H: number): number {
  const i = layerOf(H);
  return LAYER_T[i] + LAYER_L[i] * (H - LAYER_H[i]);
}

/** ISA static pressure (Pa) at geopotential altitude H (m). */
export function isaPressure(H: number): number {
  const i = layerOf(H);
  const L = LAYER_L[i];
  const Tb = LAYER_T[i];
  const dh = H - LAYER_H[i];
  if (L === 0) return LAYER_P[i] * Math.exp((-GMR * dh) / Tb);
  return LAYER_P[i] * Math.pow(Tb / (Tb + L * dh), GMR / L);
}

/** ISA density (kg/m^3) at geopotential altitude H (m). */
export function isaDensity(H: number): number {
  return isaPressure(H) / (R_AIR * isaTemperature(H));
}

/** Speed of sound (m/s) at temperature T (K). */
export function speedOfSound(T: number): number {
  return Math.sqrt(GAMMA * R_AIR * T);
}

/** Pressure altitude (geopotential m) for a static pressure (Pa): the inverse of isaPressure. */
export function pressureAltitude(p: number): number {
  let i = 0;
  while (i < 6 && p < LAYER_P[i + 1]) i++;
  const L = LAYER_L[i];
  const Tb = LAYER_T[i];
  const ratio = p / LAYER_P[i];
  if (L === 0) return LAYER_H[i] - (Math.log(ratio) * Tb) / GMR;
  return LAYER_H[i] + (Tb / L) * (Math.pow(ratio, -L / GMR) - 1);
}

/** Density altitude (geopotential m): ISA altitude with the same density. */
export function densityAltitude(rho: number): number {
  // Troposphere closed form: rho/rho0 = (T/T0)^(GMR/-L - 1).
  const rhoTrop = isaDensity(11000);
  if (rho >= rhoTrop) {
    const n = GMR / 0.0065 - 1;
    const T = T0 * Math.pow(rho / RHO0, 1 / n);
    return (T0 - T) / 0.0065;
  }
  const rho20 = isaDensity(20000);
  if (rho >= rho20) {
    const T = LAYER_T[1];
    return 11000 - (Math.log(rho / rhoTrop) * T) / GMR;
  }
  // Rare (above 20 km): bisection on the monotonic density profile.
  let lo = 20000;
  let hi = 84000;
  for (let k = 0; k < 60; k++) {
    const mid = 0.5 * (lo + hi);
    if (isaDensity(mid) > rho) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** F(H) = int_0^H dx / T_std(x) (geopotential m, K). */
function isaTempIntegral(H: number): number {
  const i = layerOf(H);
  const L = LAYER_L[i];
  const Tb = LAYER_T[i];
  const dh = H - LAYER_H[i];
  if (L === 0) return LAYER_F[i] + dh / Tb;
  return LAYER_F[i] + Math.log((Tb + L * dh) / Tb) / L;
}

// ------------------------------------------------------------------ airspeed (pure)

const RAYLEIGH_K = 166.92158; // ((gamma+1)^2/(4 gamma))^(gamma/(gamma-1)) * (gamma+1)/2 for gamma = 1.4
const QC_RATIO_AT_M1 = Math.pow(1.2, 3.5) - 1; // 0.892929

/** Impact pressure ratio qc/p for a Mach number (isentropic below M1, Rayleigh pitot above). */
export function impactPressureRatio(mach: number): number {
  const m = Math.max(0, mach);
  if (m <= 1) return Math.pow(1 + 0.2 * m * m, 3.5) - 1;
  return (RAYLEIGH_K * Math.pow(m, 7)) / Math.pow(7 * m * m - 1, 2.5) - 1;
}

/** Mach number from qc/p (inverse of impactPressureRatio; Newton iteration above M1). */
export function machFromImpactPressureRatio(ratio: number): number {
  if (!(ratio > 0)) return 0;
  if (ratio <= QC_RATIO_AT_M1) return Math.sqrt(5 * (Math.pow(ratio + 1, 2 / 7) - 1));
  let m = 1.2;
  for (let k = 0; k < 30; k++) {
    const f = impactPressureRatio(m) - ratio;
    const h = 1e-6;
    const d = (impactPressureRatio(m + h) - impactPressureRatio(m - h)) / (2 * h);
    const dm = f / d;
    m -= dm;
    if (m < 1) m = 1;
    if (Math.abs(dm) < 1e-12) break;
  }
  return m;
}

/** Impact pressure qc (Pa) from Mach and static pressure p (Pa). */
export function impactPressureFromMach(mach: number, p: number): number {
  return impactPressureRatio(mach) * p;
}

/** Mach from impact pressure qc (Pa) and static pressure p (Pa). */
export function machFromImpactPressure(qc: number, p: number): number {
  return machFromImpactPressureRatio(qc / p);
}

/** Impact pressure (Pa) corresponding to a calibrated airspeed (m/s). */
export function impactPressureFromCas(cas: number): number {
  return impactPressureRatio(cas / A0) * P0;
}

/** Calibrated airspeed (m/s) from impact pressure (Pa). */
export function casFromImpactPressure(qc: number): number {
  return machFromImpactPressureRatio(qc / P0) * A0;
}

/** Calibrated airspeed (m/s) from Mach and static pressure. */
export function casFromMach(mach: number, p: number): number {
  return casFromImpactPressure(impactPressureFromMach(mach, p));
}

/** Mach from calibrated airspeed (m/s) and static pressure. */
export function machFromCas(cas: number, p: number): number {
  return machFromImpactPressure(impactPressureFromCas(cas), p);
}

/** True airspeed (m/s) from calibrated airspeed, static pressure (Pa) and static temperature (K). */
export function tasFromCas(cas: number, p: number, T: number): number {
  return machFromCas(cas, p) * speedOfSound(T);
}

/** Calibrated airspeed (m/s) from true airspeed, static pressure and temperature. */
export function casFromTas(tas: number, p: number, T: number): number {
  return casFromMach(tas / speedOfSound(T), p);
}

/** Equivalent airspeed (m/s) from true airspeed and density. */
export function easFromTas(tas: number, rho: number): number {
  return tas * Math.sqrt(rho / RHO0);
}

/**
 * Total air temperature (K): T * (1 + r * (gamma-1)/2 * M^2). `recovery` = 1
 * gives the true stagnation temperature; real probes read with r ~0.97-1.0.
 */
export function totalTemperature(T: number, mach: number, recovery = 1): number {
  return T * (1 + recovery * 0.2 * mach * mach);
}

// ------------------------------------------------------------------ Atmosphere (non-standard day)

/** Mutable air-data sample written by `Atmosphere.sample`. */
export interface AirState {
  /** Geometric altitude MSL (m) the sample was taken at. */
  altitude_m: number;
  pressure_Pa: number;
  temperature_K: number;
  density_kgm3: number;
  speedOfSound_ms: number;
  /** Pressure altitude (geopotential m, 29.92 inHg datum). */
  pressureAltitude_m: number;
  densityAltitude_m: number;
  /** p/P0, T/T0, rho/RHO0 */
  delta: number;
  theta: number;
  sigma: number;
  /** Temperature deviation from ISA at this pressure level (K). */
  isaDeviation_K: number;
}

export function createAirState(): AirState {
  return {
    altitude_m: 0,
    pressure_Pa: P0,
    temperature_K: T0,
    density_kgm3: RHO0,
    speedOfSound_ms: A0,
    pressureAltitude_m: 0,
    densityAltitude_m: 0,
    delta: 1,
    theta: 1,
    sigma: 1,
    isaDeviation_K: 0,
  };
}

/** A winds-aloft layer: altitude MSL (ft), direction the wind blows FROM (deg true), speed (kt). */
export interface WindLayer {
  altitudeFt: number;
  directionDeg: number;
  speedKt: number;
}

/** Turbulence output in body axes (m/s, rad/s). */
export interface TurbulenceSample {
  u: number;
  v: number;
  w: number;
  p: number;
  q: number;
  r: number;
}

export function createTurbulenceSample(): TurbulenceSample {
  return { u: 0, v: 0, w: 0, p: 0, q: 0, r: 0 };
}

/**
 * Non-standard atmosphere defined by QNH and ISA deviation. Stateless apart
 * from its conditions; `sample()` is allocation-free.
 */
export class Atmosphere {
  /** Altimeter setting QNH, Pa (the MSL pressure on an ISA day). */
  qnh_Pa = P0;
  /** Temperature deviation from ISA (K), constant with altitude. */
  deltaT_K = 0;
  /** Elevation (m MSL, geometric) of the station the QNH refers to. */
  refElevation_m = 0;
  /** Pressure altitude of the QNH datum, Hp(QNH) (geopotential m); negative when QNH > 1013.25 hPa. */
  private hp0 = 0;
  /** ISA temperature integral at the station's pressure level (anchor of the true-altitude integral). */
  private f0 = 0;
  private lastQnhInHg = NaN;
  private lastSlTempC = NaN;
  private lastRefElevFt = NaN;

  constructor(qnhInHg = 29.92126, seaLevelTempC = 15, refElevFt = 0) {
    this.setConditions(qnhInHg, seaLevelTempC, refElevFt);
  }

  /**
   * Sets QNH (inHg), sea-level temperature (degC; ISA deviation = T_sl - 15
   * degC) and the elevation (ft MSL) of the station that reported them.
   * At that elevation the pressure is the QNH-implied station pressure
   * isaPressure(Hp(QNH) + elevation) whatever the temperature, and the
   * temperature is `seaLevelTempC` reduced by the ISA lapse rate.
   */
  setConditions(qnhInHg: number, seaLevelTempC: number, refElevFt = 0): void {
    if (qnhInHg === this.lastQnhInHg && seaLevelTempC === this.lastSlTempC && refElevFt === this.lastRefElevFt) return;
    this.lastQnhInHg = qnhInHg;
    this.lastSlTempC = seaLevelTempC;
    this.lastRefElevFt = refElevFt;
    const qnh = Number.isFinite(qnhInHg) && qnhInHg > 20 && qnhInHg < 35 ? qnhInHg * INHG_TO_PA : P0;
    const tsl = Number.isFinite(seaLevelTempC) ? seaLevelTempC : 15;
    const ref = Number.isFinite(refElevFt) ? clamp(refElevFt * FT_TO_M, -500, 9000) : 0;
    this.qnh_Pa = qnh;
    this.refElevation_m = ref;
    this.hp0 = pressureAltitude(qnh);
    // ISA deviation is referenced to the standard temperature at the QNH
    // datum's pressure level, so env.sl_temp_c is the (virtual) MSL
    // temperature and the station temperature is env.sl_temp_c - lapse * elevation.
    this.deltaT_K = tsl + ZERO_C_IN_K - isaTemperature(this.hp0);
    // z(Hp) = Hp - hp0 + dT * (F(Hp) - F(hp0 + z_ref)): exact at the station
    // (z = z_ref where Hp = hp0 + z_ref), temperature error grows away from it.
    this.f0 = isaTempIntegral(this.hp0 + geometricToGeopotential(ref));
  }

  /** True geopotential altitude (m MSL) of a pressure altitude (geopotential m). */
  geopotentialFromPressureAltitude(hp: number): number {
    return hp - this.hp0 + this.deltaT_K * (isaTempIntegral(hp) - this.f0);
  }

  /** Pressure altitude (geopotential m) at a true geopotential altitude (Newton, converges in 2-4 iterations). */
  pressureAltitudeAt(zGeopotential: number): number {
    let hp = this.hp0 + zGeopotential;
    const dT = this.deltaT_K;
    if (dT === 0) return hp;
    for (let k = 0; k < 6; k++) {
      const g = this.geopotentialFromPressureAltitude(hp) - zGeopotential;
      const d = 1 + dT / isaTemperature(hp);
      const step = g / d;
      hp -= step;
      if (Math.abs(step) < 1e-4) break;
    }
    return hp;
  }

  /** Fills `out` with air data at geometric altitude `alt_m` MSL. */
  sample(alt_m: number, out: AirState): AirState {
    const z = geometricToGeopotential(alt_m);
    const hp = this.pressureAltitudeAt(z);
    const p = isaPressure(hp);
    const Tstd = isaTemperature(hp);
    const T = Math.max(150, Tstd + this.deltaT_K);
    const rho = p / (R_AIR * T);
    out.altitude_m = alt_m;
    out.pressure_Pa = p;
    out.temperature_K = T;
    out.density_kgm3 = rho;
    out.speedOfSound_ms = speedOfSound(T);
    out.pressureAltitude_m = hp;
    out.densityAltitude_m = densityAltitude(rho);
    out.delta = p / P0;
    out.theta = T / T0;
    out.sigma = rho / RHO0;
    out.isaDeviation_K = T - Tstd;
    return out;
  }

  /** Geometric altitude (m MSL) at which an altimeter set to `baroInHg` reads `indicatedFt` (ignoring instrument error). */
  trueAltitudeForIndicated(indicatedFt: number, baroInHg: number): number {
    // Altimeter: indicated = Hp(p) - Hp(baro). So Hp = indicated + Hp(baro).
    const hp = indicatedFt * FT_TO_M + pressureAltitude(baroInHg * INHG_TO_PA);
    return geopotentialToGeometric(this.geopotentialFromPressureAltitude(hp));
  }
}

// ------------------------------------------------------------------ wind

/** Default boundary-layer depth (m AGL). EST: typical daytime mixed layer ~600 m (2000 ft) over land. */
const DEFAULT_BL_DEPTH_M = 600;
/** Surface roughness length (m). EST: WMO "open flat terrain, grass" class z0 = 0.03 m. */
const SURFACE_Z0_M = 0.03;
/** Surface wind reference height (m) — METAR winds are measured at 10 m (WMO standard). */
const SURFACE_REF_M = 10;
/**
 * Gradient wind vs 10 m wind when no aloft winds are defined. EST: over land
 * the 10 m wind is typically 50-70% of the gradient wind and backed 20-30 deg
 * (Ekman turning); we use x1.5 and 20 deg veer with height (NH; backing in SH).
 */
const GRADIENT_RATIO = 1.5;
const GRADIENT_VEER_DEG = 20;

/**
 * Steady wind field + gusts. Wind vectors are the air-mass velocity in NED
 * (m/s), i.e. the direction the air moves TO.
 */
export class WindModel {
  private sfcN = 0;
  private sfcE = 0;
  private gust_ms = 0;
  private layerAlt = new Float64Array(0);
  private layerN = new Float64Array(0);
  private layerE = new Float64Array(0);
  /** Boundary-layer depth (m AGL). */
  boundaryLayer_m = DEFAULT_BL_DEPTH_M;

  // gust state
  private readonly rng: Prng;
  private gustT = 0; // elapsed in current gust or gap
  private gustDur = 0;
  private gustPeak = 0;
  private gustActive = false;
  private gustLat = 0;
  /** Current gust magnitude along the mean wind (m/s). */
  gustValue = 0;

  constructor(seed = 12345) {
    this.rng = new Prng(seed);
    this.gustDur = 2;
  }

  /** Surface (10 m) wind: direction FROM (deg true), speed and gust increment (kt). */
  setSurfaceWind(directionDeg: number, speedKt: number, gustKt = 0): void {
    const s = Math.max(0, speedKt) * KT_TO_MS;
    const d = directionDeg * DEG2RAD;
    this.sfcN = -s * Math.cos(d);
    this.sfcE = -s * Math.sin(d);
    this.gust_ms = Math.max(0, gustKt) * KT_TO_MS;
  }

  /** Replaces the winds-aloft layers (copied and sorted by altitude). Pass [] to clear. */
  setWindsAloft(layers: readonly WindLayer[]): void {
    const sorted = [...layers].filter((l) => Number.isFinite(l.altitudeFt)).sort((a, b) => a.altitudeFt - b.altitudeFt);
    const n = sorted.length;
    this.layerAlt = new Float64Array(n);
    this.layerN = new Float64Array(n);
    this.layerE = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.max(0, sorted[i].speedKt) * KT_TO_MS;
      const d = sorted[i].directionDeg * DEG2RAD;
      this.layerAlt[i] = sorted[i].altitudeFt * FT_TO_M;
      this.layerN[i] = -s * Math.cos(d);
      this.layerE[i] = -s * Math.sin(d);
    }
  }

  get windsAloftCount(): number {
    return this.layerAlt.length;
  }

  /** Interpolated aloft wind at altitude MSL (m); clamped outside the layer range. */
  private aloftAt(alt: number, out: Vec3): void {
    const a = this.layerAlt;
    const n = a.length;
    if (alt <= a[0]) {
      out.x = this.layerN[0];
      out.y = this.layerE[0];
    } else if (alt >= a[n - 1]) {
      out.x = this.layerN[n - 1];
      out.y = this.layerE[n - 1];
    } else {
      let i = 0;
      while (i < n - 2 && alt > a[i + 1]) i++;
      const f = (alt - a[i]) / (a[i + 1] - a[i]);
      out.x = lerp(this.layerN[i], this.layerN[i + 1], f);
      out.y = lerp(this.layerE[i], this.layerE[i + 1], f);
    }
    out.z = 0;
  }

  /** Gradient wind at the top of the boundary layer. */
  private gradientAt(groundMsl: number, latDeg: number, out: Vec3): void {
    if (this.layerAlt.length > 0) {
      this.aloftAt(groundMsl + this.boundaryLayer_m, out);
      return;
    }
    const veer = (latDeg >= 0 ? GRADIENT_VEER_DEG : -GRADIENT_VEER_DEG) * DEG2RAD;
    const c = Math.cos(veer);
    const s = Math.sin(veer);
    // Veering = clockwise rotation of the wind vector seen from above (N->E).
    out.x = GRADIENT_RATIO * (this.sfcN * c - this.sfcE * s);
    out.y = GRADIENT_RATIO * (this.sfcN * s + this.sfcE * c);
    out.z = 0;
  }

  /**
   * Steady wind (no gust/turbulence) at a point: NED air velocity (m/s).
   * Log-law below 10 m, log-height interpolation from the 10 m wind to the
   * gradient wind through the boundary layer, aloft layers above it.
   */
  steadyWind(altMsl_m: number, agl_m: number, latDeg: number, out: Vec3): Vec3 {
    const z = Math.max(0, agl_m);
    const groundMsl = altMsl_m - agl_m;
    const bl = this.boundaryLayer_m;
    if (z >= bl) {
      if (this.layerAlt.length > 0) this.aloftAt(altMsl_m, out);
      else this.gradientAt(groundMsl, latDeg, out);
      return out;
    }
    if (z <= SURFACE_REF_M) {
      const zz = Math.max(z, SURFACE_Z0_M * 1.0001);
      const f = Math.log(zz / SURFACE_Z0_M) / Math.log(SURFACE_REF_M / SURFACE_Z0_M);
      out.x = this.sfcN * f;
      out.y = this.sfcE * f;
      out.z = 0;
      return out;
    }
    this.gradientAt(groundMsl, latDeg, out);
    const w = Math.log(z / SURFACE_REF_M) / Math.log(bl / SURFACE_REF_M);
    out.x = this.sfcN + (out.x - this.sfcN) * w;
    out.y = this.sfcE + (out.y - this.sfcE) * w;
    out.z = 0;
    return out;
  }

  /**
   * Advances the gust process and adds the current gust to `wind` (NED,
   * in-place). Gusts are random 1-cosine events (2-6 s long, 60-100% of the
   * gust increment, 1-8 s apart) along the mean wind with a small lateral
   * component; full strength within the boundary layer, 30% above it.
   */
  applyGust(dt: number, agl_m: number, wind: Vec3): void {
    if (this.gust_ms <= 0) {
      this.gustValue = 0;
      this.gustActive = false;
      return;
    }
    this.gustT += dt;
    if (this.gustT >= this.gustDur) {
      this.gustT = 0;
      this.gustActive = !this.gustActive;
      if (this.gustActive) {
        this.gustDur = this.rng.range(2, 6);
        this.gustPeak = this.rng.range(0.6, 1.0);
        this.gustLat = this.rng.range(-0.3, 0.3);
      } else {
        this.gustDur = this.rng.range(1, 8);
      }
    }
    const shape = this.gustActive ? 0.5 * (1 - Math.cos((2 * Math.PI * this.gustT) / this.gustDur)) : 0;
    const heightFactor = agl_m < this.boundaryLayer_m ? 1 : 0.3;
    const g = this.gust_ms * this.gustPeak * shape * heightFactor;
    this.gustValue = g;
    const sn = this.sfcN;
    const se = this.sfcE;
    const s = Math.sqrt(sn * sn + se * se);
    if (s < 1e-6) return;
    const un = sn / s;
    const ue = se / s;
    wind.x += g * (un - this.gustLat * ue);
    wind.y += g * (ue + this.gustLat * un);
  }

  /** Resets the gust process (deterministic from `seed`). */
  reset(seed?: number): void {
    if (seed !== undefined) this.rng.seed(seed);
    this.gustT = 0;
    this.gustDur = 2;
    this.gustActive = false;
    this.gustValue = 0;
  }
}

/** Wind direction FROM (deg true, 0..360) and speed (kt) of a NED air-velocity vector. */
export function windFromVector(n: number, e: number, out: { dir: number; kt: number }): { dir: number; kt: number } {
  const s = Math.sqrt(n * n + e * e);
  out.kt = s / KT_TO_MS;
  out.dir = s < 1e-6 ? 0 : wrap360(Math.atan2(-e, -n) * RAD2DEG);
  return out;
}

// ------------------------------------------------------------------ Dryden turbulence

const FTPS_PER_KT = 1.6878098571; // ft/s per knot
/** MIL-F-8785C Fig. 7 altitude breakpoints (ft). */
const POE_ALT: number[] = [500, 1750, 3750, 7500, 15000, 25000, 35000, 45000, 55000, 65000, 75000, 80000];
/**
 * RMS intensity (ft/s) curves by probability of exceedance: light = 1e-2,
 * moderate = 1e-3, severe = 1e-5 (JSBSim severity indices 3, 4 and 6).
 */
const POE_LIGHT: Table1D = { x: POE_ALT, y: [6.6, 6.9, 7.4, 6.7, 4.6, 2.7, 0.4, 0, 0, 0, 0, 0] };
const POE_MODERATE: Table1D = { x: POE_ALT, y: [8.6, 9.6, 10.6, 10.1, 8.0, 6.6, 5.0, 4.2, 2.7, 0, 0, 0] };
const POE_SEVERE: Table1D = { x: POE_ALT, y: [15.6, 17.6, 23.0, 23.6, 22.1, 20.0, 16.0, 15.1, 12.1, 7.9, 6.2, 5.1] };
/** W20 (wind at 20 ft) for severe turbulence: 45 kt (MIL-F-8785C Fig. 9; light 15, moderate 30). */
const W20_SEVERE_KT = 45;

/**
 * Medium/high-altitude RMS intensity (ft/s) for a continuous severity
 * `t` in 0..1: 1/3 = light, 2/3 = moderate, 1 = severe.
 */
export function highAltitudeSigmaFps(altFt: number, t: number): number {
  const s = clamp(t, 0, 1) * 3;
  if (s <= 1) return s * interp1(POE_LIGHT, altFt);
  if (s <= 2) return lerp(interp1(POE_LIGHT, altFt), interp1(POE_MODERATE, altFt), s - 1);
  return lerp(interp1(POE_MODERATE, altFt), interp1(POE_SEVERE, altFt), s - 2);
}

/**
 * Dryden continuous turbulence (MIL-F-8785C). Linear components use the
 * spec transfer functions driven by seeded Gaussian white noise; `u` uses an
 * exact Gauss-Markov discretisation, `v`/`w` a two-stage lag realisation of
 * (1 + sqrt(3) T s)/(1 + T s)^2 (variance-correct as dt/T -> 0). Rotational
 * gusts p (Hp), q = w-gradient, r = v-gradient per the spec.
 * Output axes: body (u along x, v along y, w along z).
 */
export class DrydenTurbulence {
  private readonly rng: Prng;
  private xu = 0;
  private v1 = 0;
  private v2 = 0;
  private w1 = 0;
  private w2 = 0;
  private xp = 0;
  private wq = 0;
  private vr = 0;
  /** Last computed intensities (m/s) for diagnostics. */
  sigmaU = 0;
  sigmaW = 0;

  constructor(seed = 4242) {
    this.rng = new Prng(seed);
  }

  reset(seed?: number): void {
    if (seed !== undefined) this.rng.seed(seed);
    this.xu = this.v1 = this.v2 = this.w1 = this.w2 = this.xp = this.wq = this.vr = 0;
  }

  /**
   * @param dt step (s)
   * @param V airspeed (m/s); clamped to >= 3 m/s (spatial model needs a convection speed)
   * @param agl height above ground (m)
   * @param intensity 0..1 (env.turbulence): 1/3 light, 2/3 moderate, 1 severe
   * @param span wingspan (m) for the rotational terms
   */
  step(dt: number, V: number, agl: number, intensity: number, span: number, out: TurbulenceSample): TurbulenceSample {
    if (!(intensity > 0) || dt <= 0) {
      this.reset();
      out.u = out.v = out.w = out.p = out.q = out.r = 0;
      this.sigmaU = this.sigmaW = 0;
      return out;
    }
    const t = Math.min(1, intensity);
    const hFt = Math.max(10, agl * M_TO_FT);
    const w20 = W20_SEVERE_KT * t * FTPS_PER_KT; // ft/s
    let Lu: number;
    let Lw: number;
    let su: number;
    let sw: number;
    if (hFt <= 1000) {
      const k = 0.177 + 0.000823 * hFt;
      Lu = hFt / Math.pow(k, 1.2);
      Lw = hFt;
      sw = 0.1 * w20;
      su = sw / Math.pow(k, 0.4);
    } else if (hFt <= 2000) {
      const f = (hFt - 1000) / 1000;
      Lu = Lw = 1000 + f * 750;
      su = sw = 0.1 * w20 + f * (highAltitudeSigmaFps(hFt, t) - 0.1 * w20);
    } else {
      Lu = Lw = 1750;
      su = sw = highAltitudeSigmaFps(hFt, t);
    }
    // SI
    Lu *= FT_TO_M;
    Lw *= FT_TO_M;
    su *= FT_TO_M;
    sw *= FT_TO_M;
    const Lv = Lu;
    const sv = su;
    this.sigmaU = su;
    this.sigmaW = sw;
    const Vc = Math.max(3, V);
    const b = Math.max(1, span);
    const rng = this.rng;
    const noiseScale = Math.sqrt(Math.PI / dt);

    // u: exact first-order Gauss-Markov with variance su^2.
    const au = Math.exp((-Vc * dt) / Lu);
    this.xu = au * this.xu + su * Math.sqrt(1 - au * au) * rng.gaussian();

    // v: K (sqrt3 z1 + (1 - sqrt3) z2), z1 = lag(noise), z2 = lag(z1).
    const Tv = Lv / Vc;
    const av = 1 - Math.exp(-dt / Tv);
    const nv = noiseScale * rng.gaussian();
    this.v1 += av * (nv - this.v1);
    this.v2 += av * (this.v1 - this.v2);
    const Kv = sv * Math.sqrt(Tv / Math.PI);
    const vg = Kv * (1.7320508075688772 * this.v1 + (1 - 1.7320508075688772) * this.v2);

    const Tw = Lw / Vc;
    const aw = 1 - Math.exp(-dt / Tw);
    const nw = noiseScale * rng.gaussian();
    this.w1 += aw * (nw - this.w1);
    this.w2 += aw * (this.w1 - this.w2);
    const Kw = sw * Math.sqrt(Tw / Math.PI);
    const wg = Kw * (1.7320508075688772 * this.w1 + (1 - 1.7320508075688772) * this.w2);

    // p: first order, gain sw*sqrt(0.8/V)*(pi/4b)^(1/6)/Lw^(1/3), tau 4b/(pi V).
    const Tp = (4 * b) / (Math.PI * Vc);
    const Kp = (sw * Math.sqrt(0.8 / Vc) * Math.pow(Math.PI / (4 * b), 1 / 6)) / Math.pow(Lw, 1 / 3);
    const sp = Kp * Math.sqrt(Math.PI / (2 * Tp));
    const ap = Math.exp(-dt / Tp);
    this.xp = ap * this.xp + sp * Math.sqrt(1 - ap * ap) * rng.gaussian();

    // q = (s/V)/(1 + Tq s) w_g ; r = -(s/V)/(1 + Tr s) v_g
    const Tq = (4 * b) / (Math.PI * Vc);
    const Tr = (3 * b) / (Math.PI * Vc);
    this.wq += (1 - Math.exp(-dt / Tq)) * (wg - this.wq);
    this.vr += (1 - Math.exp(-dt / Tr)) * (vg - this.vr);

    out.u = this.xu;
    out.v = vg;
    out.w = wg;
    out.p = this.xp;
    out.q = (wg - this.wq) / (Vc * Tq);
    out.r = -(vg - this.vr) / (Vc * Tr);
    return out;
  }
}
