/**
 * Inclinometer (slip/skid ball): a ball in a curved, liquid-filled glass
 * tube. The ball settles where the tube is perpendicular to the apparent
 * gravity (specific force), so it shows the lateral component of the
 * specific force: tan(theta) = -ny / nz with fdm.ny = body-y specific force
 * in g (a side force pushing the aircraft right moves the ball left) and
 * nz = +1 in level flight. Physics: a bead on a circular arc of radius R
 * below its centre,
 *     R theta'' = g (ay cos(theta) - az sin(theta)) - c R theta',
 * with ay = -ny, az = nz (g units), viscous damping c from the fluid and
 * end stops at the tube ends (small bounce).
 *
 * Geometry is EST (no public drawing): tube radius 60 mm, +/-16 deg of
 * travel, damping ratio 1.3 (the ball in its fluid is slightly
 * over-damped and settles in about half a second).
 */
import { G0 } from '../../../core/units';
import { DEG2RAD, RAD2DEG } from '../../../core/math';

export interface InclinometerOptions {
  tubeRadiusM?: number;
  limitDeg?: number;
  dampingRatio?: number;
  restitution?: number;
}

export class InclinometerBall {
  /** Ball angle from the tube centre (deg, + = right). */
  angleDeg = 0;
  private theta = 0;
  private rate = 0;
  private readonly radius: number;
  private readonly limit: number;
  private readonly zeta: number;
  private readonly restitution: number;

  constructor(opts: InclinometerOptions = {}) {
    this.radius = opts.tubeRadiusM ?? 0.06;
    this.limit = (opts.limitDeg ?? 16) * DEG2RAD;
    this.zeta = opts.dampingRatio ?? 1.3;
    this.restitution = opts.restitution ?? 0.15;
  }

  /** Equilibrium angle (deg) for a steady specific force (pure). */
  static equilibriumDeg(ny: number, nz: number): number {
    return Math.atan2(-ny, nz) * RAD2DEG;
  }

  /** Ball deflection normalised to the travel (-1..1) — the `ahrs.slip` convention. */
  get normalized(): number {
    return this.theta / this.limit;
  }

  reset(ny = 0, nz = 1): void {
    const eq = Math.atan2(-ny, nz);
    this.theta = Math.max(-this.limit, Math.min(this.limit, eq));
    this.rate = 0;
    this.angleDeg = this.theta * RAD2DEG;
  }

  update(ny: number, nz: number, dt: number): number {
    if (!(dt > 0)) return this.angleDeg;
    const ay = -ny;
    const az = nz;
    const k = G0 / this.radius;
    // Damping referenced to the small-angle natural frequency at 1 g.
    const c = 2 * this.zeta * Math.sqrt(k);
    const n = Math.max(1, Math.ceil(dt / 0.002));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const acc = k * (ay * Math.cos(this.theta) - az * Math.sin(this.theta)) - c * this.rate;
      this.rate += acc * h;
      this.theta += this.rate * h;
      if (this.theta > this.limit) {
        this.theta = this.limit;
        if (this.rate > 0) this.rate = -this.rate * this.restitution;
      } else if (this.theta < -this.limit) {
        this.theta = -this.limit;
        if (this.rate < 0) this.rate = -this.rate * this.restitution;
      }
    }
    this.angleDeg = this.theta * RAD2DEG;
    return this.angleDeg;
  }
}
