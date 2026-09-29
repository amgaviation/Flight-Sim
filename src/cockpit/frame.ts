/**
 * Coordinate frames for cockpit construction.
 *
 * Body frame (aircraft data, `CockpitBuild.eyePosition_m`, FDM): metres from
 * the aircraft datum, x forward, y right, z down.
 *
 * Cockpit-local frame (Three.js): the cockpit root group is a child of the
 * aircraft object, whose axes are x right, y up, z aft (the nose points along
 * -z). The root sits on the datum with identity rotation, so
 *
 *     local.x =  body.y
 *     local.y = -body.z
 *     local.z = -body.x
 *
 * which is a proper rotation (det +1), so the same mapping converts both
 * positions and directions.
 *
 * Panel frame: every panel (and every control on it) uses u = right, v = up
 * (reading direction of its labels), n = out of the panel toward the viewer.
 * In Three.js terms a panel group's local x = u, y = v, z = n, and the panel's
 * front surface is the plane z = 0. `placePanel` computes that group's
 * transform from a body-frame placement.
 */
import * as THREE from 'three';

/** A body-frame vector: [x fwd, y right, z down] (metres or unit direction). */
export type BodyVec = readonly [number, number, number];

/** Writes the cockpit-local (Three.js) equivalent of a body-frame vector into `out`. */
export function bodyToLocal(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(y, -z, -x);
}

/** Array form of {@link bodyToLocal}. Allocates a Vector3 when `out` is omitted. */
export function bodyToLocalV(b: BodyVec, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return out.set(b[1], -b[2], -b[0]);
}

/** Converts a cockpit-local vector back to body axes. */
export function localToBody(v: THREE.Vector3, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  out[0] = -v.z;
  out[1] = v.x;
  out[2] = -v.y;
  return out;
}

/**
 * Orientation of a camera (Three.js camera looks along its local -z) for a
 * pilot looking with `yawDeg` (+ right) and `pitchDeg` (+ up) relative to the
 * aircraft nose, in the cockpit-local frame.
 */
export function viewQuaternion(yawDeg: number, pitchDeg: number, out: THREE.Quaternion = new THREE.Quaternion()): THREE.Quaternion {
  // Camera default (identity) looks along local -z = body forward. Yaw right is a
  // negative rotation about +y (up); pitch up is a positive rotation about +x.
  _euler.set(THREE.MathUtils.degToRad(pitchDeg), THREE.MathUtils.degToRad(-yawDeg), 0, 'YXZ');
  return out.setFromEuler(_euler);
}

/** Preset panel orientations (normal and reading-up direction in body axes). */
export type PanelFacing = 'aft' | 'up' | 'down' | 'left' | 'right' | 'fwd';

const FACINGS: Record<PanelFacing, { n: BodyVec; v: BodyVec }> = {
  /** Main instrument panel / glareshield front: faces the pilot, labels read upright. */
  aft: { n: [-1, 0, 0], v: [0, 0, -1] },
  /** Pedestal / console top: faces up, label tops toward the nose. */
  up: { n: [0, 0, -1], v: [1, 0, 0] },
  /** Overhead panel: faces down, label tops toward the tail (as read when looking up). */
  down: { n: [0, 0, 1], v: [-1, 0, 0] },
  /** Right sidewall panel facing inboard (left). Label tops up. */
  left: { n: [0, -1, 0], v: [0, 0, -1] },
  /** Left sidewall panel facing inboard (right). Label tops up. */
  right: { n: [0, 1, 0], v: [0, 0, -1] },
  /** Aft bulkhead panel facing forward. */
  fwd: { n: [1, 0, 0], v: [0, 0, -1] },
};

/** Where a panel sits in the cockpit, in body metres. */
export interface PanelPlacement {
  /** Body-frame position of the panel origin (see PanelOptions.origin). */
  center_m: BodyVec;
  /** Preset orientation (default 'aft'). Ignored when `normal` and `up` are given. */
  facing?: PanelFacing;
  /** Explicit panel normal (toward the viewer) in body axes. */
  normal?: BodyVec;
  /** Explicit reading-up direction in body axes (orthogonalized against the normal). */
  up?: BodyVec;
  /**
   * Rotation about the panel's horizontal (u) axis, degrees. Positive tips the
   * normal toward the panel's own +v, i.e. leans the top edge away from the
   * viewer. Main panels are typically +5..+15 (face tilted up toward the eye);
   * a pedestal whose forward end is raised uses a negative value.
   */
  tiltDeg?: number;
  /** Rotation about the (tilted) v axis, degrees. Positive turns the normal toward +u (right). */
  yawDeg?: number;
  /** Rotation about the normal, degrees. Positive turns +u toward +v (counter-clockwise as seen by the viewer). */
  rollDeg?: number;
}

/** Orthonormal panel basis in the cockpit-local frame. */
export interface PanelBasis {
  u: THREE.Vector3;
  v: THREE.Vector3;
  n: THREE.Vector3;
  origin: THREE.Vector3;
}

/** Computes the panel basis (cockpit-local vectors) for a placement. */
export function panelBasis(p: PanelPlacement, out?: PanelBasis): PanelBasis {
  const b = out ?? { u: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3(), origin: new THREE.Vector3() };
  const preset = FACINGS[p.facing ?? 'aft'];
  const nb = p.normal ?? preset.n;
  const vb = p.up ?? preset.v;
  bodyToLocalV(nb, b.n).normalize();
  bodyToLocalV(vb, b.v);
  // Gram-Schmidt: remove the normal component from v.
  b.v.addScaledVector(b.n, -b.v.dot(b.n));
  if (b.v.lengthSq() < 1e-12) throw new Error('panelBasis: up is parallel to normal');
  b.v.normalize();
  // u = v x n gives a right-handed (u, v, n).
  b.u.crossVectors(b.v, b.n).normalize();

  const t = THREE.MathUtils.degToRad(p.tiltDeg ?? 0);
  if (t !== 0) {
    const c = Math.cos(t), s = Math.sin(t);
    _a.copy(b.n).multiplyScalar(c).addScaledVector(b.v, s); // n'
    _b.copy(b.v).multiplyScalar(c).addScaledVector(b.n, -s); // v'
    b.n.copy(_a);
    b.v.copy(_b);
  }
  const y = THREE.MathUtils.degToRad(p.yawDeg ?? 0);
  if (y !== 0) {
    const c = Math.cos(y), s = Math.sin(y);
    _a.copy(b.n).multiplyScalar(c).addScaledVector(b.u, s);
    _b.copy(b.u).multiplyScalar(c).addScaledVector(b.n, -s);
    b.n.copy(_a);
    b.u.copy(_b);
  }
  const r = THREE.MathUtils.degToRad(p.rollDeg ?? 0);
  if (r !== 0) {
    const c = Math.cos(r), s = Math.sin(r);
    _a.copy(b.u).multiplyScalar(c).addScaledVector(b.v, s);
    _b.copy(b.v).multiplyScalar(c).addScaledVector(b.u, -s);
    b.u.copy(_a);
    b.v.copy(_b);
  }
  bodyToLocalV(p.center_m, b.origin);
  return b;
}

/**
 * Sets `obj.position` / `obj.quaternion` so that its local x/y/z are the
 * panel's u/v/n and its origin is `center_m`. `obj` must be a direct child of
 * the cockpit root (or of any group with identity transform on the datum).
 */
export function placePanel<T extends THREE.Object3D>(obj: T, p: PanelPlacement): T {
  const b = panelBasis(p, _basis);
  _m.makeBasis(b.u, b.v, b.n);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(b.origin);
  return obj;
}

/** Options for placing an object on a panel surface. */
export interface PlaceOnPanelOptions {
  /** Height above the panel surface (m, along the normal). Default 0. */
  z?: number;
  /** Rotation about the panel normal (deg, + counter-clockwise as seen by the viewer). */
  rotDeg?: number;
  /**
   * Local tilt of the object about the panel u axis (deg, + tips the object's
   * +z toward +v). Used for controls on a sloped sub-surface of a panel.
   */
  tiltDeg?: number;
}

/** Positions `obj` (a child of a panel group) at panel coordinates (u, v) in metres. */
export function placeOnPanel<T extends THREE.Object3D>(obj: T, u: number, v: number, opts: PlaceOnPanelOptions = {}): T {
  obj.position.set(u, v, opts.z ?? 0);
  obj.rotation.set(-THREE.MathUtils.degToRad(opts.tiltDeg ?? 0), 0, THREE.MathUtils.degToRad(opts.rotDeg ?? 0), 'ZXY');
  return obj;
}

/**
 * Body-frame position (metres) of a point given in some object's local
 * coordinates, relative to `root` (the cockpit root). Allocation-free when
 * `out` is supplied.
 */
export function objectPointToBody(
  obj: THREE.Object3D,
  root: THREE.Object3D,
  local: THREE.Vector3 | null,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  obj.updateWorldMatrix(true, false);
  root.updateWorldMatrix(true, false);
  _v.set(0, 0, 0);
  if (local) _v.copy(local);
  _v.applyMatrix4(obj.matrixWorld);
  _m.copy(root.matrixWorld).invert();
  _v.applyMatrix4(_m);
  return localToBody(_v, out);
}

/** Converts a body-frame direction/position to cockpit-local and returns a new Vector3 (setup code only). */
export function bl(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(y, -z, -x);
}

const _euler = new THREE.Euler();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _basis: PanelBasis = { u: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3(), origin: new THREE.Vector3() };
