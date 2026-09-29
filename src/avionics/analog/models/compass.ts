/**
 * Magnetic (wet) compass physics.
 *
 * The card carries bar magnets and hangs pendulously on a pivot in a
 * liquid-filled bowl. It hangs perpendicular to the APPARENT gravity
 * (specific force), limited by the bowl to `tiltLimitDeg` from the case
 * axis, and its magnets align with the component of the Earth's field that
 * lies in the card plane. Because the field dips (inclination I from the
 * WMM), any card tilt lets the vertical field component pull the card:
 * this single mechanism produces
 *  - northerly turning error: in a coordinated bank the card tilts with the
 *    aircraft; turning from a northerly heading the card first swings the
 *    wrong way / lags, turning through south it leads
 *    (FAA-H-8083-15B IFH ch.3 "Magnetic Compass Errors"),
 *  - acceleration error: accelerating on an east/west heading tilts the
 *    card aft and it shows a turn toward north, deceleration toward south
 *    ("ANDS"),
 *  - no error on a level, unaccelerated heading.
 * The card is a damped oscillator (liquid damping ratio EST 0.35: "card
 * oscillation" / swinging in turbulence), stiffer where the horizontal field
 * is stronger. Deviation (a per-aircraft correction card, every 30 deg) and
 * an extra deviation input (electrical loads) are added.
 */
import { DEG2RAD, RAD2DEG, clamp, wrap180, wrap360 } from '../../../core/math';

export interface CompassOptions {
  /** Card tilt freedom from the case axis (deg). EST 18 (typical bowl clearance). */
  tiltLimitDeg?: number;
  /** Natural frequency of the card at a horizontal field fraction of 0.45 (rad/s). EST 1.9 (period ~3.3 s). */
  omega?: number;
  /** Liquid damping ratio. EST 0.35. */
  zeta?: number;
  /**
   * Deviation (deg, add to the magnetic heading) at 0, 30, ..., 330 deg
   * magnetic, as on the compass correction card. EST default: a typical
   * swung light-aircraft card within +/-3 deg.
   */
  deviation?: readonly number[];
}

/** EST: typical swung-compass residual deviations, headings 0..330 by 30. */
export const TYPICAL_DEVIATION: readonly number[] = [0, 2, 3, 2, 0, -1, -2, -3, -2, 0, 1, 1];

/** Scratch vectors (module-level, the model is single-threaded). */
const B = new Float64Array(3);
const D = new Float64Array(3);
const N = new Float64Array(3);

export class CompassModel {
  /** Card reading at the lubber line (deg). */
  reading = 0;
  /** Card tilt relative to the case (deg): + nose-up tilt of the card plane, + right-wing-down tilt. */
  tiltPitchDeg = 0;
  tiltRollDeg = 0;
  /** Latest equilibrium reading (deg) the card is swinging toward. */
  equilibrium = 0;
  private rate = 0;
  private initialized = false;
  private readonly tiltLimit: number;
  private readonly omega: number;
  private readonly zeta: number;
  readonly deviation: readonly number[];

  constructor(opts: CompassOptions = {}) {
    this.tiltLimit = (opts.tiltLimitDeg ?? 18) * DEG2RAD;
    this.omega = opts.omega ?? 1.9;
    this.zeta = opts.zeta ?? 0.35;
    this.deviation = opts.deviation ?? TYPICAL_DEVIATION;
  }

  /** Deviation (deg) for a magnetic heading, interpolated from the 30-deg card. */
  deviationAt(headingMag: number): number {
    const d = this.deviation;
    if (d.length === 0) return 0;
    const step = 360 / d.length;
    const h = wrap360(headingMag) / step;
    const i = Math.floor(h);
    const f = h - i;
    return d[i % d.length] * (1 - f) + d[(i + 1) % d.length] * f;
  }

  /**
   * Equilibrium card reading (deg) for the given attitude, specific force
   * and dip. Pure apart from writing `tiltPitchDeg`/`tiltRollDeg`; excludes
   * deviation.
   *   headingMag, pitch, bank: aircraft attitude (deg)
   *   nx, ny, nz: specific force (g), fdm conventions (nz = +1 level)
   *   dipDeg: magnetic inclination (+ = field points down, northern hemisphere)
   * Returns NaN if the horizontal field in the card plane vanishes.
   */
  equilibriumReading(headingMag: number, pitch: number, bank: number, nx: number, ny: number, nz: number, dipDeg: number): number {
    // Earth field in NED (magnetic north frame): (cos I, 0, sin I).
    const ci = Math.cos(dipDeg * DEG2RAD);
    const si = Math.sin(dipDeg * DEG2RAD);
    // NED -> body (ZYX Euler: heading psi, pitch theta, bank phi).
    const ps = headingMag * DEG2RAD;
    const th = pitch * DEG2RAD;
    const ph = bank * DEG2RAD;
    const cps = Math.cos(ps);
    const sps = Math.sin(ps);
    const cth = Math.cos(th);
    const sth = Math.sin(th);
    const cph = Math.cos(ph);
    const sph = Math.sin(ph);
    const bn = ci;
    const be = 0;
    const bd = si;
    // Rows of the NED->body DCM.
    B[0] = cth * cps * bn + cth * sps * be - sth * bd;
    B[1] = (sph * sth * cps - cph * sps) * bn + (sph * sth * sps + cph * cps) * be + sph * cth * bd;
    B[2] = (cph * sth * cps + sph * sps) * bn + (cph * sth * sps - sph * cps) * be + cph * cth * bd;
    // Apparent "down" in body axes = -(specific force) = (-nx, -ny, +nz).
    D[0] = -nx;
    D[1] = -ny;
    D[2] = nz;
    let dl = Math.hypot(D[0], D[1], D[2]);
    if (dl < 1e-6) {
      D[0] = 0;
      D[1] = 0;
      D[2] = 1;
      dl = 1;
    }
    D[0] /= dl;
    D[1] /= dl;
    D[2] /= dl;
    // Card normal: apparent down, limited to tiltLimit from the case z axis.
    const ang = Math.acos(clamp(D[2], -1, 1));
    if (ang > this.tiltLimit) {
      const hl = Math.hypot(D[0], D[1]) || 1;
      const s = Math.sin(this.tiltLimit);
      N[0] = (D[0] / hl) * s;
      N[1] = (D[1] / hl) * s;
      N[2] = Math.cos(this.tiltLimit);
    } else {
      N[0] = D[0];
      N[1] = D[1];
      N[2] = D[2];
    }
    this.tiltPitchDeg = Math.asin(clamp(-N[0], -1, 1)) * RAD2DEG;
    this.tiltRollDeg = Math.atan2(N[1], N[2]) * RAD2DEG;
    // Project field and the fore-aft axis (1, 0, 0) into the card plane.
    const bdot = B[0] * N[0] + B[1] * N[1] + B[2] * N[2];
    const px = B[0] - bdot * N[0];
    const py = B[1] - bdot * N[1];
    const pz = B[2] - bdot * N[2];
    const fx = 1 - N[0] * N[0];
    const fy = -N[0] * N[1];
    const fz = -N[0] * N[2];
    const hmag = Math.hypot(px, py, pz);
    if (hmag < 1e-6) return NaN;
    // Signed angle from the field (card north) to the nose, about the card normal.
    const cx = py * fz - pz * fy;
    const cy = pz * fx - px * fz;
    const cz = px * fy - py * fx;
    const sinA = cx * N[0] + cy * N[1] + cz * N[2];
    const cosA = px * fx + py * fy + pz * fz;
    this.fieldStrength = hmag;
    return wrap360(Math.atan2(sinA, cosA) * RAD2DEG);
  }

  /** Horizontal-in-card-plane field magnitude (fraction of total) from the last evaluation. */
  fieldStrength = 1;

  reset(reading: number): void {
    this.reading = wrap360(reading);
    this.rate = 0;
    this.initialized = true;
  }

  /**
   * Advances the card. `extraDeviationDeg` adds to the deviation card
   * (electrical-load deviation).
   */
  update(headingMag: number, pitch: number, bank: number, nx: number, ny: number, nz: number, dipDeg: number, extraDeviationDeg: number, dt: number): number {
    const eq = this.equilibriumReading(headingMag, pitch, bank, nx, ny, nz, dipDeg);
    if (Number.isNaN(eq)) return this.reading; // card wanders freely at the magnetic pole
    const target = wrap360(eq + this.deviationAt(headingMag) + extraDeviationDeg);
    this.equilibrium = target;
    if (!this.initialized) this.reset(target);
    if (!(dt > 0)) return this.reading;
    const w = this.omega * Math.sqrt(clamp(this.fieldStrength / 0.45, 0.05, 3));
    const n = Math.max(1, Math.ceil((w * dt) / 0.2));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const err = wrap180(target - this.reading);
      this.rate += (w * w * err - 2 * this.zeta * w * this.rate) * h;
      this.reading = wrap360(this.reading + this.rate * h);
    }
    return this.reading;
  }
}
