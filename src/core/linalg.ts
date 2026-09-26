/**
 * Minimal double-precision 3-vector, quaternion and 3x3 matrix types for the
 * flight model. Independent of Three.js so physics runs headless in tests.
 *
 * All operations mutate `this` (or an explicit `out`) and return it, so hot
 * paths can preallocate and reuse instances without garbage.
 *
 * Quaternion convention: `Quat` rotates vectors from the BODY frame to the
 * local NED frame (`v_ned = q * v_body * q^-1`). Euler angles are the
 * aerospace ZYX sequence: heading/yaw psi, pitch theta, bank/roll phi.
 */

export class Vec3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  setArray(a: ArrayLike<number>): this {
    this.x = a[0];
    this.y = a[1];
    this.z = a[2];
    return this;
  }

  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  zero(): this {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    return this;
  }

  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  /** this += v * s */
  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  /** this = a - b */
  subVectors(a: Vec3, b: Vec3): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  /** this = a + b */
  addVectors(a: Vec3, b: Vec3): this {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    return this;
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /** this = a x b (safe when out aliases a or b). */
  crossVectors(a: Vec3, b: Vec3): this {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  normalize(): this {
    const l = this.length();
    if (l > 0) this.scale(1 / l);
    return this;
  }
}

export class Quat {
  w: number;
  x: number;
  y: number;
  z: number;

  constructor(w = 1, x = 0, y = 0, z = 0) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(w: number, x: number, y: number, z: number): this {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(q: Quat): this {
    this.w = q.w;
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    return this;
  }

  identity(): this {
    return this.set(1, 0, 0, 0);
  }

  normalize(): this {
    const n = Math.sqrt(this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z);
    if (n > 0) {
      const s = 1 / n;
      this.w *= s;
      this.x *= s;
      this.y *= s;
      this.z *= s;
    } else {
      this.identity();
    }
    return this;
  }

  /** Body-to-NED quaternion from ZYX Euler angles (radians). */
  setFromEuler(psi: number, theta: number, phi: number): this {
    const cy = Math.cos(psi * 0.5);
    const sy = Math.sin(psi * 0.5);
    const cp = Math.cos(theta * 0.5);
    const sp = Math.sin(theta * 0.5);
    const cr = Math.cos(phi * 0.5);
    const sr = Math.sin(phi * 0.5);
    this.w = cr * cp * cy + sr * sp * sy;
    this.x = sr * cp * cy - cr * sp * sy;
    this.y = cr * sp * cy + sr * cp * sy;
    this.z = cr * cp * sy - sr * sp * cy;
    return this;
  }

  /** Heading psi (rad, -PI..PI). */
  getPsi(): number {
    const { w, x, y, z } = this;
    return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  }

  /** Pitch theta (rad, -PI/2..PI/2). */
  getTheta(): number {
    const { w, x, y, z } = this;
    const s = 2 * (w * y - z * x);
    return Math.asin(s > 1 ? 1 : s < -1 ? -1 : s);
  }

  /** Bank phi (rad, -PI..PI). */
  getPhi(): number {
    const { w, x, y, z } = this;
    return Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  }

  /** out = R(q) v  (body -> NED). `out` may alias `v`. */
  rotate(v: Vec3, out: Vec3): Vec3 {
    const { w, x, y, z } = this;
    // t = 2 * (q.xyz x v)
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    const ox = v.x + w * tx + (y * tz - z * ty);
    const oy = v.y + w * ty + (z * tx - x * tz);
    const oz = v.z + w * tz + (x * ty - y * tx);
    out.x = ox;
    out.y = oy;
    out.z = oz;
    return out;
  }

  /** out = R(q)^T v  (NED -> body). `out` may alias `v`. */
  rotateInverse(v: Vec3, out: Vec3): Vec3 {
    const w = this.w;
    const x = -this.x;
    const y = -this.y;
    const z = -this.z;
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    const ox = v.x + w * tx + (y * tz - z * ty);
    const oy = v.y + w * ty + (z * tx - x * tz);
    const oz = v.z + w * tz + (x * ty - y * tx);
    out.x = ox;
    out.y = oy;
    out.z = oz;
    return out;
  }

  /**
   * Integrates body angular rate `w` (rad/s, body axes) over dt using the
   * exact exponential map (q <- q * exp(w dt / 2)), then renormalises.
   */
  integrateBodyRate(wb: Vec3, dt: number): this {
    const wx = wb.x;
    const wy = wb.y;
    const wz = wb.z;
    const mag = Math.sqrt(wx * wx + wy * wy + wz * wz);
    const half = 0.5 * mag * dt;
    let s: number;
    let c: number;
    if (half < 1e-8) {
      c = 1;
      s = 0.5 * dt; // sin(half)/mag -> dt/2
    } else {
      c = Math.cos(half);
      s = Math.sin(half) / mag;
    }
    const dw = c;
    const dx = wx * s;
    const dy = wy * s;
    const dz = wz * s;
    const { w, x, y, z } = this;
    this.w = w * dw - x * dx - y * dy - z * dz;
    this.x = w * dx + x * dw + y * dz - z * dy;
    this.y = w * dy - x * dz + y * dw + z * dx;
    this.z = w * dz + x * dy - y * dx + z * dw;
    return this.normalize();
  }

  /** Writes the 3x3 body->NED rotation matrix (row-major) into `m`. */
  toMatrix(m: Mat3): Mat3 {
    const { w, x, y, z } = this;
    const e = m.e;
    e[0] = 1 - 2 * (y * y + z * z);
    e[1] = 2 * (x * y - w * z);
    e[2] = 2 * (x * z + w * y);
    e[3] = 2 * (x * y + w * z);
    e[4] = 1 - 2 * (x * x + z * z);
    e[5] = 2 * (y * z - w * x);
    e[6] = 2 * (x * z - w * y);
    e[7] = 2 * (y * z + w * x);
    e[8] = 1 - 2 * (x * x + y * y);
    return m;
  }
}

/** Row-major 3x3 matrix backed by a Float64Array. */
export class Mat3 {
  readonly e = new Float64Array(9);

  constructor() {
    this.identity();
  }

  identity(): this {
    const e = this.e;
    e.fill(0);
    e[0] = e[4] = e[8] = 1;
    return this;
  }

  set(a00: number, a01: number, a02: number, a10: number, a11: number, a12: number, a20: number, a21: number, a22: number): this {
    const e = this.e;
    e[0] = a00;
    e[1] = a01;
    e[2] = a02;
    e[3] = a10;
    e[4] = a11;
    e[5] = a12;
    e[6] = a20;
    e[7] = a21;
    e[8] = a22;
    return this;
  }

  copy(m: Mat3): this {
    this.e.set(m.e);
    return this;
  }

  /** out = M v (out may alias v). */
  mulVec(v: Vec3, out: Vec3): Vec3 {
    const e = this.e;
    const x = e[0] * v.x + e[1] * v.y + e[2] * v.z;
    const y = e[3] * v.x + e[4] * v.y + e[5] * v.z;
    const z = e[6] * v.x + e[7] * v.y + e[8] * v.z;
    out.x = x;
    out.y = y;
    out.z = z;
    return out;
  }

  /** out = M^T v (out may alias v). */
  mulVecTransposed(v: Vec3, out: Vec3): Vec3 {
    const e = this.e;
    const x = e[0] * v.x + e[3] * v.y + e[6] * v.z;
    const y = e[1] * v.x + e[4] * v.y + e[7] * v.z;
    const z = e[2] * v.x + e[5] * v.y + e[8] * v.z;
    out.x = x;
    out.y = y;
    out.z = z;
    return out;
  }

  determinant(): number {
    const e = this.e;
    return (
      e[0] * (e[4] * e[8] - e[5] * e[7]) - e[1] * (e[3] * e[8] - e[5] * e[6]) + e[2] * (e[3] * e[7] - e[4] * e[6])
    );
  }

  /** this = inverse(m). Returns false (and leaves identity) if singular. */
  invertFrom(m: Mat3): boolean {
    const a = m.e;
    const det = m.determinant();
    if (Math.abs(det) < 1e-300) {
      this.identity();
      return false;
    }
    const id = 1 / det;
    const b0 = (a[4] * a[8] - a[5] * a[7]) * id;
    const b1 = (a[2] * a[7] - a[1] * a[8]) * id;
    const b2 = (a[1] * a[5] - a[2] * a[4]) * id;
    const b3 = (a[5] * a[6] - a[3] * a[8]) * id;
    const b4 = (a[0] * a[8] - a[2] * a[6]) * id;
    const b5 = (a[2] * a[3] - a[0] * a[5]) * id;
    const b6 = (a[3] * a[7] - a[4] * a[6]) * id;
    const b7 = (a[1] * a[6] - a[0] * a[7]) * id;
    const b8 = (a[0] * a[4] - a[1] * a[3]) * id;
    this.set(b0, b1, b2, b3, b4, b5, b6, b7, b8);
    return true;
  }
}
