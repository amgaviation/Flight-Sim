import * as THREE from 'three';
import {
  DEG2RAD,
  EARTH_MEAN_RADIUS_M,
  ecefToGeodetic,
  enuBasis,
  geodeticToEcef,
  haversineM,
  type GeodeticOut,
} from './geo';

/**
 * Payload of a recenter notification. `delta` maps a point expressed in the
 * previous scene frame to the new scene frame (`pNew = delta * pOld`); it is a
 * rigid transform (rotation of a fraction of a degree plus translation).
 */
export interface RecenterEvent {
  lat: number;
  lon: number;
  previousLat: number;
  previousLon: number;
  /** Monotonic counter, incremented on every recenter. */
  version: number;
  delta: THREE.Matrix4;
}

export type RecenterListener = (e: RecenterEvent) => void;

/** Default distance (m) from the origin at which the frame re-centres. ARCHITECTURE.md: 10 km. */
export const RECENTER_DISTANCE_M = 10_000;

const _ecef = new Float64Array(3);
const _basisP = new Float64Array(9);
const _m4 = new THREE.Matrix4();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * Constant rotation mapping local NED axes to the Three.js local-ENU axes
 * (x = east, y = up, z = south): x = E, y = -D, z = -N.
 */
const Q_NED_TO_THREE = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, -1, 0, -1, 0, 0, 0, 0, 0, 0, 1),
);
/**
 * Constant rotation mapping an aircraft object's Three.js local axes
 * (x right, y up, z aft; see ARCHITECTURE.md "Cockpit") into body axes
 * (x forward, y right, z down): right -> +y, up -> -z, aft -> -x.
 */
const Q_OBJECT_TO_BODY = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().set(0, 0, -1, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1),
);

/**
 * Floating-origin reference frame.
 *
 * Scene coordinates are the local ENU frame at a geodetic reference point on
 * the ellipsoid (height 0), mapped to Three.js as x = east, y = up, z = south
 * (ARCHITECTURE.md "Coordinate frames"). All conversions run in double
 * precision on the CPU; only final object transforms reach the GPU, so scene
 * coordinates near the camera keep full float32 precision.
 *
 * When the aircraft or camera gets more than 10 km from the origin, call
 * `maybeRecenter` (World.update does). Listeners then re-place their objects;
 * anything placed with `placeObject`/`enuQuaternion` from lat/lon each frame
 * needs no special handling.
 */
export class ReferenceFrame {
  private _lat = 0;
  private _lon = 0;
  private readonly origin = new Float64Array(3);
  /** Row-major ENU basis at the origin (rows E, N, U in ECEF). */
  private readonly basis = new Float64Array(9);
  private readonly listeners = new Set<RecenterListener>();
  private _version = 0;

  constructor(lat = 0, lon = 0) {
    this.setOrigin(lat, lon);
  }

  /** Latitude of the scene origin (deg). */
  get originLat(): number {
    return this._lat;
  }

  /** Longitude of the scene origin (deg). */
  get originLon(): number {
    return this._lon;
  }

  /** Increments on every recenter; cache keys can compare against it. */
  get version(): number {
    return this._version;
  }

  private setOrigin(lat: number, lon: number): void {
    this._lat = lat;
    this._lon = lon;
    geodeticToEcef(lat, lon, 0, this.origin);
    enuBasis(lat, lon, this.basis);
  }

  /** Scene position of a geodetic point (alt in metres MSL). Allocation-free. */
  toLocal(latDeg: number, lonDeg: number, altM: number, out: THREE.Vector3): THREE.Vector3 {
    geodeticToEcef(latDeg, lonDeg, altM, _ecef);
    return this.ecefToLocal(_ecef[0], _ecef[1], _ecef[2], out);
  }

  /** Scene position of an ECEF point. */
  ecefToLocal(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const b = this.basis;
    const dx = x - this.origin[0];
    const dy = y - this.origin[1];
    const dz = z - this.origin[2];
    const e = b[0] * dx + b[1] * dy + b[2] * dz;
    const n = b[3] * dx + b[4] * dy + b[5] * dz;
    const u = b[6] * dx + b[7] * dy + b[8] * dz;
    return out.set(e, u, -n);
  }

  /** ECEF coordinates (m) of a scene position. */
  localToEcef<T extends { [i: number]: number }>(x: number, y: number, z: number, out: T): T {
    const b = this.basis;
    const e = x;
    const n = -z;
    const u = y;
    out[0] = this.origin[0] + b[0] * e + b[3] * n + b[6] * u;
    out[1] = this.origin[1] + b[1] * e + b[4] * n + b[7] * u;
    out[2] = this.origin[2] + b[2] * e + b[5] * n + b[8] * u;
    return out;
  }

  /** Geodetic position of a scene point. Allocation-free when `out` is supplied. */
  toGeodetic(x: number, y: number, z: number, out: GeodeticOut): GeodeticOut {
    this.localToEcef(x, y, z, _ecef);
    return ecefToGeodetic(_ecef[0], _ecef[1], _ecef[2], out);
  }

  /** Geodetic position of a scene-space vector. */
  vectorToGeodetic(v: THREE.Vector3, out: GeodeticOut): GeodeticOut {
    return this.toGeodetic(v.x, v.y, v.z, out);
  }

  /**
   * Rotation that orients an object whose local frame is the Three.js ENU
   * frame at (lat, lon) (x = east, y = local up, z = south) in scene space.
   * Identity at the origin; tilts by the angle between the two verticals
   * elsewhere (~0.09 deg per 10 km).
   */
  enuQuaternion(latDeg: number, lonDeg: number, out: THREE.Quaternion): THREE.Quaternion {
    return out.setFromRotationMatrix(this.enuMatrix(latDeg, lonDeg, _m4));
  }

  /** Rotation matrix form of `enuQuaternion` (upper 3x3 set, translation zero). */
  enuMatrix(latDeg: number, lonDeg: number, out: THREE.Matrix4): THREE.Matrix4 {
    enuBasis(latDeg, lonDeg, _basisP);
    const r = this.basis;
    const p = _basisP;
    // M = B_ref * B_p^T maps ENU(p) components to ENU(ref) components.
    const m00 = r[0] * p[0] + r[1] * p[1] + r[2] * p[2];
    const m01 = r[0] * p[3] + r[1] * p[4] + r[2] * p[5];
    const m02 = r[0] * p[6] + r[1] * p[7] + r[2] * p[8];
    const m10 = r[3] * p[0] + r[4] * p[1] + r[5] * p[2];
    const m11 = r[3] * p[3] + r[4] * p[4] + r[5] * p[5];
    const m12 = r[3] * p[6] + r[4] * p[7] + r[5] * p[8];
    const m20 = r[6] * p[0] + r[7] * p[1] + r[8] * p[2];
    const m21 = r[6] * p[3] + r[7] * p[4] + r[8] * p[5];
    const m22 = r[6] * p[6] + r[7] * p[7] + r[8] * p[8];
    // Conjugate with C: (e, n, u) -> (x = e, y = u, z = -n).
    // R = C M C^T with C = [[1,0,0],[0,0,1],[0,-1,0]].
    return out.set(
      m00, m02, -m01, 0,
      m20, m22, -m21, 0,
      -m10, -m12, m11, 0,
      0, 0, 0, 1,
    );
  }

  /**
   * Orientation of an aircraft-style object (local x right, y up, z aft,
   * i.e. -z is the nose) from true heading, pitch (+ nose up) and bank
   * (+ right wing down), all degrees, at (lat, lon).
   */
  attitudeQuaternion(
    latDeg: number,
    lonDeg: number,
    headingDeg: number,
    pitchDeg: number,
    bankDeg: number,
    out: THREE.Quaternion,
  ): THREE.Quaternion {
    this.enuQuaternion(latDeg, lonDeg, _qA);
    _euler.set(pitchDeg * DEG2RAD, -headingDeg * DEG2RAD, -bankDeg * DEG2RAD, 'YXZ');
    _qB.setFromEuler(_euler);
    return out.multiplyQuaternions(_qA, _qB);
  }

  /**
   * Orientation of an aircraft-style object (local x right, y up, z aft) from
   * a physics body-to-NED quaternion (body x fwd, y right, z down), as the FDM
   * integrates it (ARCHITECTURE.md "Physics").
   */
  nedQuaternionToLocal(
    latDeg: number,
    lonDeg: number,
    qw: number,
    qx: number,
    qy: number,
    qz: number,
    out: THREE.Quaternion,
  ): THREE.Quaternion {
    this.enuQuaternion(latDeg, lonDeg, _qA);
    _qB.set(qx, qy, qz, qw);
    out.multiplyQuaternions(_qA, Q_NED_TO_THREE);
    out.multiply(_qB);
    return out.multiply(Q_OBJECT_TO_BODY);
  }

  /**
   * Places an object at a geodetic position with an attitude. With the
   * default zero angles the object's local frame is the local ENU frame at
   * that point (useful for airports, buildings and terrain tiles).
   */
  placeObject(
    obj: THREE.Object3D,
    latDeg: number,
    lonDeg: number,
    altM: number,
    headingDeg = 0,
    pitchDeg = 0,
    bankDeg = 0,
  ): void {
    this.toLocal(latDeg, lonDeg, altM, obj.position);
    if (headingDeg === 0 && pitchDeg === 0 && bankDeg === 0) this.enuQuaternion(latDeg, lonDeg, obj.quaternion);
    else this.attitudeQuaternion(latDeg, lonDeg, headingDeg, pitchDeg, bankDeg, obj.quaternion);
  }

  /** Local "up" unit vector at a geodetic point, in scene coordinates. */
  upAt(latDeg: number, lonDeg: number, out: THREE.Vector3): THREE.Vector3 {
    enuBasis(latDeg, lonDeg, _basisP);
    const r = this.basis;
    const ux = _basisP[6];
    const uy = _basisP[7];
    const uz = _basisP[8];
    const e = r[0] * ux + r[1] * uy + r[2] * uz;
    const n = r[3] * ux + r[4] * uy + r[5] * uz;
    const u = r[6] * ux + r[7] * uy + r[8] * uz;
    return out.set(e, u, -n);
  }

  /**
   * Approximate geodetic height (m) of a scene point without a full inverse:
   * y plus the curvature drop of the tangent plane (d^2 / 2R). Error < 1 m
   * within 100 km of the origin; use `toGeodetic` when exactness matters.
   */
  approxAltitude(x: number, y: number, z: number): number {
    return y + (x * x + z * z) / (2 * EARTH_MEAN_RADIUS_M);
  }

  /** Great-circle distance (m) from the origin to a point. */
  distanceFromOrigin(latDeg: number, lonDeg: number): number {
    return haversineM(this._lat, this._lon, latDeg, lonDeg);
  }

  /** Re-centres on (lat, lon) when it is farther than `thresholdM` from the origin. */
  maybeRecenter(latDeg: number, lonDeg: number, thresholdM = RECENTER_DISTANCE_M): boolean {
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return false;
    if (this.distanceFromOrigin(latDeg, lonDeg) <= thresholdM) return false;
    this.recenter(latDeg, lonDeg);
    return true;
  }

  /**
   * Moves the origin to (lat, lon) and synchronously notifies listeners with
   * the rigid transform from old to new scene coordinates.
   */
  recenter(latDeg: number, lonDeg: number): void {
    const prevLat = this._lat;
    const prevLon = this._lon;
    const oldOrigin = new Float64Array(this.origin);
    const oldBasis = new Float64Array(this.basis);
    this.setOrigin(latDeg, lonDeg);
    this._version++;

    // pNew = C B_new (ecef - O_new), ecef = O_old + B_old^T C^T pOld
    //  => R = C (B_new B_old^T) C^T, t = C B_new (O_old - O_new)
    const r = this.basis;
    const o = oldBasis;
    const m = (i: number, j: number) => r[i * 3] * o[j * 3] + r[i * 3 + 1] * o[j * 3 + 1] + r[i * 3 + 2] * o[j * 3 + 2];
    const m00 = m(0, 0), m01 = m(0, 1), m02 = m(0, 2);
    const m10 = m(1, 0), m11 = m(1, 1), m12 = m(1, 2);
    const m20 = m(2, 0), m21 = m(2, 1), m22 = m(2, 2);
    const dx = oldOrigin[0] - this.origin[0];
    const dy = oldOrigin[1] - this.origin[1];
    const dz = oldOrigin[2] - this.origin[2];
    const te = r[0] * dx + r[1] * dy + r[2] * dz;
    const tn = r[3] * dx + r[4] * dy + r[5] * dz;
    const tu = r[6] * dx + r[7] * dy + r[8] * dz;
    const delta = new THREE.Matrix4().set(
      m00, m02, -m01, te,
      m20, m22, -m21, tu,
      -m10, -m12, m11, -tn,
      0, 0, 0, 1,
    );
    const ev: RecenterEvent = {
      lat: latDeg,
      lon: lonDeg,
      previousLat: prevLat,
      previousLon: prevLon,
      version: this._version,
      delta,
    };
    for (const fn of [...this.listeners]) fn(ev);
  }

  /** Subscribes to recenter notifications; returns an unsubscribe function. */
  onRecenter(fn: RecenterListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Geodetic position of an object's world position (e.g. the camera). Allocation-free. */
  objectGeodetic(obj: THREE.Object3D, out: GeodeticOut): GeodeticOut {
    obj.getWorldPosition(_v);
    return this.toGeodetic(_v.x, _v.y, _v.z, out);
  }
}
