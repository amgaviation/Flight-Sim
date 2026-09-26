/**
 * Camera system: cockpit views (pilot eye + the aircraft's preset views) with
 * free look, zoom and subtle G-force/buffet head motion, and external views
 * (chase, free orbit, tower, fly-by).
 *
 * Frames: the cockpit camera is a child of the aircraft object (cockpit-local
 * axes x right, y up, z aft; positions given in body metres x fwd, y right,
 * z down and converted with `bodyToLocal`). External cameras are children of
 * the scene and are recomputed each frame from geodetic anchors, so the
 * floating-origin recenters need no special handling.
 *
 * Inputs: `look(dx, dy)` (mouse drag on empty space, px), `zoom(notches)`
 * (wheel on empty space), and per-frame `lookX/lookY/zoomRate` (-1..1 from
 * keys, hat switch or axes).
 */
import * as THREE from 'three';
import { bodyToLocal, viewQuaternion } from '../cockpit/frame';
import type { ReferenceFrame } from '../world/ReferenceFrame';
import type { GeoPosition } from '../world/types';
import type { NavDatabase, Airport } from '../nav/types';
import type { ListenerPose, ViewKind } from '../audio/AudioEngine';

export type CameraMode = ViewKind;

export interface CockpitViewDef {
  name: string;
  position_m: [number, number, number];
  yawDeg: number;
  pitchDeg: number;
  fovDeg?: number;
}

export interface CameraAircraftInfo {
  /** Pilot eye (body m). */
  eye_m: [number, number, number];
  views: CockpitViewDef[];
  /** Chase distance (AircraftMeta.chaseDistance_m). */
  chaseDistance_m: number;
}

/** Per-frame motion cues (from FDM vars). */
export interface CameraMotionInput {
  nx: number;
  ny: number;
  nz: number;
  buffet: number;
  onGround: boolean;
  gsKt: number;
  /** Track (deg true) and speed (m/s) over ground, for fly-by placement. */
  trackDeg: number;
  speed_ms: number;
  /** Vertical speed (m/s, + up). */
  vs_ms: number;
}

export interface CameraControlInput {
  lookX: number;
  lookY: number;
  zoomRate: number;
}

export const EXTERNAL_MODES: CameraMode[] = ['chase', 'orbit', 'tower', 'flyby'];

/** Head motion gains (m per g). EST: seat/harness compliance feel, deliberately subtle. */
const HEAD_Z_PER_G = 0.02;
const HEAD_Y_PER_G = 0.035;
const HEAD_X_PER_G = 0.045;
const HEAD_LIMIT_M = 0.06;
/** Tower cab height above the airport (m). EST: typical 30 m class towers. */
const TOWER_HEIGHT_M = 30;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _geo = { lat: 0, lon: 0, alt_m: 0 };

/** Simple seeded value noise for camera shake (no allocation). */
class Shake {
  private s = 12345;
  private a = 0;
  private b = 0;
  private t = 0;
  private rnd(): number {
    this.s = (this.s * 1103515245 + 12345) & 0x7fffffff;
    return this.s / 0x7fffffff - 0.5;
  }
  sample(dt: number, hz: number): number {
    this.t += dt * hz;
    while (this.t >= 1) {
      this.t -= 1;
      this.a = this.b;
      this.b = this.rnd();
    }
    const k = this.t * this.t * (3 - 2 * this.t);
    return this.a + (this.b - this.a) * k;
  }
}

/** Critically damped-ish spring (per axis) for head offsets. */
class Spring3 {
  readonly x = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  constructor(
    private readonly omega: number,
    private readonly zeta: number,
  ) {}
  update(target: THREE.Vector3, dt: number): THREE.Vector3 {
    const n = Math.max(1, Math.ceil((dt * this.omega) / 0.3));
    const h = dt / n;
    const w2 = this.omega * this.omega;
    const c = 2 * this.zeta * this.omega;
    const x = this.x;
    const v = this.v;
    for (let i = 0; i < n; i++) {
      v.x += (w2 * (target.x - x.x) - c * v.x) * h;
      v.y += (w2 * (target.y - x.y) - c * v.y) * h;
      v.z += (w2 * (target.z - x.z) - c * v.z) * h;
      x.x += v.x * h;
      x.y += v.y * h;
      x.z += v.z * h;
    }
    return x;
  }
  reset(): void {
    this.x.set(0, 0, 0);
    this.v.set(0, 0, 0);
  }
}

export interface CameraSystemOptions {
  scene: THREE.Scene;
  vehicle: THREE.Object3D;
  frame: ReferenceFrame;
  nav?: NavDatabase | null;
  /** Terrain elevation (m MSL) for keeping external cameras above ground. */
  groundAt?: (lat: number, lon: number) => number;
  cockpitFovDeg?: number;
}

export class CameraSystem {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'cockpit';
  /** Index into `views()` (0 = pilot eye). */
  viewIndex = 0;
  headMotion = true;
  /** Mode change listeners (UI label, audio, cockpit visibility). */
  onModeChange: ((mode: CameraMode, label: string) => void) | null = null;

  private readonly scene: THREE.Scene;
  private readonly vehicle: THREE.Object3D;
  private readonly frame: ReferenceFrame;
  private readonly nav: NavDatabase | null;
  private readonly groundAt: (lat: number, lon: number) => number;
  private info: CameraAircraftInfo = { eye_m: [0, 0, -1], views: [], chaseDistance_m: 30 };
  private baseFov: number;
  private fov: number;
  private yaw = 0;
  private pitch = 0;
  // Smoothed view transitions (cockpit presets).
  private readonly curPos = new THREE.Vector3();
  private curYaw = 0;
  private curPitch = 0;
  private transition = 1;
  private readonly fromPos = new THREE.Vector3();
  private fromYaw = 0;
  private fromPitch = 0;
  private readonly head = new Spring3(9, 0.55);
  private readonly headTarget = new THREE.Vector3();
  private readonly shakeX = new Shake();
  private readonly shakeY = new Shake();
  private readonly shakeZ = new Shake();
  // External.
  private orbitYaw = 0;
  private orbitPitch = 10;
  private distance = 30;
  private smoothHeading = NaN;
  private externalZoom = 1;
  private readonly anchor: GeoPosition = { lat: 0, lon: 0, alt_m: 0 };
  private anchorValid = false;
  private flybyStartDist = 0;
  private prevDist = NaN;
  /** Closing speed of the camera toward the aircraft (m/s), for Doppler. */
  closingSpeed_ms = 0;
  private towerName = '';

  constructor(o: CameraSystemOptions) {
    this.scene = o.scene;
    this.vehicle = o.vehicle;
    this.frame = o.frame;
    this.nav = o.nav ?? null;
    this.groundAt = o.groundAt ?? (() => 0);
    this.baseFov = o.cockpitFovDeg ?? 55;
    this.fov = this.baseFov;
    this.camera = new THREE.PerspectiveCamera(this.fov, 16 / 9, 0.05, 2e6);
    this.camera.name = 'camera';
    this.vehicle.add(this.camera);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setCockpitFov(deg: number): void {
    this.baseFov = deg;
    if (this.mode === 'cockpit') this.fov = this.views()[this.viewIndex]?.fovDeg ?? deg;
  }

  /** New aircraft: eye point, preset views, chase distance. Resets to the pilot eye. */
  setAircraft(info: CameraAircraftInfo): void {
    this.info = info;
    this.distance = info.chaseDistance_m;
    this.viewIndex = 0;
    this.setMode('cockpit');
    this.snapToView();
  }

  /** Pilot eye first, then the aircraft's presets. */
  views(): CockpitViewDef[] {
    return [{ name: 'Pilot', position_m: this.info.eye_m, yawDeg: 0, pitchDeg: -8 }, ...this.info.views];
  }

  get inCockpit(): boolean {
    return this.mode === 'cockpit';
  }

  label(): string {
    if (this.mode === 'cockpit') return `Cockpit: ${this.views()[this.viewIndex]?.name ?? 'Pilot'}`;
    if (this.mode === 'tower') return `Tower${this.towerName ? `: ${this.towerName}` : ''}`;
    return { chase: 'Chase', orbit: 'Orbit', flyby: 'Fly-by' }[this.mode] ?? this.mode;
  }

  setMode(mode: CameraMode): void {
    const changed = mode !== this.mode;
    this.mode = mode;
    if (mode === 'cockpit') {
      if (this.camera.parent !== this.vehicle) this.vehicle.add(this.camera);
      this.camera.near = 0.05;
      this.snapToView();
    } else {
      if (this.camera.parent !== this.scene) this.scene.add(this.camera);
      this.camera.near = 0.3;
      this.externalZoom = 1;
      this.anchorValid = false;
      this.prevDist = NaN;
      if (mode === 'chase') {
        this.orbitYaw = 0;
        this.orbitPitch = 10;
        this.smoothHeading = NaN;
      }
      this.fov = 50;
    }
    this.camera.updateProjectionMatrix();
    if (changed || mode === 'cockpit') this.onModeChange?.(mode, this.label());
  }

  /** 'view.cockpit': enter the cockpit, or step through the cockpit presets when already inside. */
  cockpitNext(): void {
    if (this.mode !== 'cockpit') {
      this.viewIndex = 0;
      this.setMode('cockpit');
      return;
    }
    this.selectView((this.viewIndex + 1) % this.views().length);
  }

  /** 'view.external': enter the chase view, or step through the external cameras. */
  externalNext(): void {
    if (this.mode === 'cockpit') this.setMode('chase');
    else this.setMode(EXTERNAL_MODES[(EXTERNAL_MODES.indexOf(this.mode) + 1) % EXTERNAL_MODES.length]);
  }

  /** Cycles through every view (cockpit presets then external cameras). */
  cycle(dir: 1 | -1): void {
    const list: { mode: CameraMode; idx: number }[] = [...this.views().map((_, i) => ({ mode: 'cockpit' as CameraMode, idx: i })), ...EXTERNAL_MODES.map((m) => ({ mode: m, idx: 0 }))];
    const cur = list.findIndex((e) => e.mode === this.mode && (this.mode !== 'cockpit' || e.idx === this.viewIndex));
    const next = list[(cur + dir + list.length) % list.length];
    if (next.mode === 'cockpit') {
      if (this.mode !== 'cockpit') {
        this.viewIndex = next.idx;
        this.setMode('cockpit');
      } else this.selectView(next.idx);
    } else this.setMode(next.mode);
  }

  selectView(i: number): void {
    const v = this.views()[i];
    if (!v) return;
    this.viewIndex = i;
    this.fromPos.copy(this.curPos);
    this.fromYaw = this.curYaw;
    this.fromPitch = this.curPitch;
    this.transition = 0;
    this.yaw = v.yawDeg;
    this.pitch = v.pitchDeg;
    this.fov = v.fovDeg ?? this.baseFov;
    this.onModeChange?.(this.mode, this.label());
  }

  private snapToView(): void {
    const v = this.views()[this.viewIndex] ?? this.views()[0];
    this.yaw = v.yawDeg;
    this.pitch = v.pitchDeg;
    this.fov = v.fovDeg ?? this.baseFov;
    bodyToLocal(v.position_m[0], v.position_m[1], v.position_m[2], this.curPos);
    this.curYaw = this.yaw;
    this.curPitch = this.pitch;
    this.transition = 1;
    this.head.reset();
  }

  /** Resets look direction and zoom for the current view. */
  reset(): void {
    if (this.mode === 'cockpit') {
      const v = this.views()[this.viewIndex];
      this.yaw = v.yawDeg;
      this.pitch = v.pitchDeg;
      this.fov = v.fovDeg ?? this.baseFov;
    } else {
      this.orbitYaw = 0;
      this.orbitPitch = 10;
      this.distance = this.info.chaseDistance_m;
      this.externalZoom = 1;
      this.anchorValid = false;
    }
  }

  /** Mouse free look (pixels). */
  look(dx: number, dy: number): void {
    const k = 0.12 * (this.fov / 55);
    if (this.mode === 'cockpit') {
      this.yaw = Math.max(-175, Math.min(175, this.yaw + dx * k));
      this.pitch = Math.max(-85, Math.min(85, this.pitch - dy * k));
    } else {
      this.orbitYaw = (this.orbitYaw + dx * 0.25) % 360;
      this.orbitPitch = Math.max(-5, Math.min(85, this.orbitPitch + dy * 0.2));
    }
  }

  /** Wheel zoom (notches, + = in). */
  zoom(notches: number): void {
    if (this.mode === 'cockpit') this.fov = Math.max(12, Math.min(95, this.fov * Math.pow(0.9, notches)));
    else if (this.mode === 'chase' || this.mode === 'orbit') this.distance = Math.max(this.info.chaseDistance_m * 0.3, Math.min(this.info.chaseDistance_m * 12, this.distance * Math.pow(0.88, notches)));
    else this.externalZoom = Math.max(0.2, Math.min(6, this.externalZoom * Math.pow(1.15, notches)));
  }

  /**
   * Per frame, after the aircraft object is placed for this frame.
   * `aircraft` is the datum position.
   */
  update(dt: number, ctl: CameraControlInput, m: CameraMotionInput, aircraft: GeoPosition): void {
    const d = Math.min(0.1, Math.max(0, dt));
    if (ctl.lookX || ctl.lookY) {
      const rate = 90 * (this.fov / 55); // deg/s at full deflection
      if (this.mode === 'cockpit') {
        this.yaw = Math.max(-175, Math.min(175, this.yaw + ctl.lookX * rate * d));
        this.pitch = Math.max(-85, Math.min(85, this.pitch + ctl.lookY * rate * d));
      } else {
        this.orbitYaw = (this.orbitYaw + ctl.lookX * 90 * d) % 360;
        this.orbitPitch = Math.max(-5, Math.min(85, this.orbitPitch + ctl.lookY * 60 * d));
      }
    }
    if (ctl.zoomRate) this.zoom(ctl.zoomRate * d * 8);
    if (this.mode === 'cockpit') this.updateCockpit(d, m);
    else this.updateExternal(d, m, aircraft);
    if (Math.abs(this.camera.fov - this.fov) > 1e-3) {
      this.camera.fov += (this.fov - this.camera.fov) * Math.min(1, d * 12);
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
  }

  private updateCockpit(d: number, m: CameraMotionInput): void {
    const v = this.views()[this.viewIndex] ?? this.views()[0];
    bodyToLocal(v.position_m[0], v.position_m[1], v.position_m[2], _v);
    if (this.transition < 1) {
      this.transition = Math.min(1, this.transition + d / 0.35);
      const t = this.transition * this.transition * (3 - 2 * this.transition);
      this.curPos.lerpVectors(this.fromPos, _v, t);
      this.curYaw = this.fromYaw + (this.yaw - this.fromYaw) * t;
      this.curPitch = this.fromPitch + (this.pitch - this.fromPitch) * t;
    } else {
      this.curPos.copy(_v);
      this.curYaw = this.yaw;
      this.curPitch = this.pitch;
    }
    // Head motion: the head lags the airframe's accelerations (body -> local axes: x=y_b, y=-z_b, z=-x_b).
    const ht = this.headTarget;
    if (this.headMotion) {
      const bx = clampAbs(-HEAD_X_PER_G * m.nx, HEAD_LIMIT_M);
      const by = clampAbs(-HEAD_Y_PER_G * m.ny, HEAD_LIMIT_M);
      const bz = clampAbs(HEAD_Z_PER_G * (m.nz - 1), HEAD_LIMIT_M);
      bodyToLocal(bx, by, bz, ht);
    } else ht.set(0, 0, 0);
    const head = this.head.update(ht, d);
    let shake = 0;
    if (this.headMotion) shake = 0.004 * Math.min(1, m.buffet) + (m.onGround ? 0.0012 * Math.min(1, m.gsKt / 60) : 0);
    this.camera.position.set(
      this.curPos.x + head.x + shake * this.shakeX.sample(d, 14),
      this.curPos.y + head.y + shake * this.shakeY.sample(d, 17),
      this.curPos.z + head.z + shake * 0.5 * this.shakeZ.sample(d, 11),
    );
    viewQuaternion(this.curYaw, this.curPitch, this.camera.quaternion);
    this.closingSpeed_ms = 0;
  }

  private basis(lat: number, lon: number): void {
    this.frame.enuQuaternion(lat, lon, _q);
    _east.set(1, 0, 0).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _north.set(0, 0, -1).applyQuaternion(_q);
  }

  private updateExternal(d: number, m: CameraMotionInput, ac: GeoPosition): void {
    const cam = this.camera;
    this.vehicle.getWorldPosition(_v2); // target (datum)
    this.basis(ac.lat, ac.lon);
    if (this.mode === 'chase' || this.mode === 'orbit') {
      let headingDeg: number;
      if (this.mode === 'chase') {
        // Aircraft nose direction projected on the horizontal plane.
        _fwd.set(0, 0, -1).applyQuaternion(this.vehicle.quaternion);
        const e = _fwd.dot(_east);
        const n = _fwd.dot(_north);
        const hdg = (Math.atan2(e, n) * 180) / Math.PI;
        if (!Number.isFinite(this.smoothHeading)) this.smoothHeading = hdg;
        let dh = hdg - this.smoothHeading;
        dh = ((dh + 540) % 360) - 180;
        this.smoothHeading += dh * Math.min(1, d / 0.6);
        headingDeg = this.smoothHeading + 180 + this.orbitYaw;
      } else headingDeg = this.orbitYaw + 180;
      const h = (headingDeg * Math.PI) / 180;
      const el = (this.orbitPitch * Math.PI) / 180;
      const dist = this.distance;
      _v.copy(_v2)
        .addScaledVector(_north, Math.cos(h) * Math.cos(el) * dist)
        .addScaledVector(_east, Math.sin(h) * Math.cos(el) * dist)
        .addScaledVector(_up, Math.sin(el) * dist + dist * 0.05);
      this.keepAboveGround(_v, 1.5);
      cam.position.copy(_v);
      cam.up.copy(_up);
      _v.copy(_v2).addScaledVector(_up, dist * 0.04);
      cam.lookAt(_v);
      this.fov = 50;
      this.closingSpeed_ms = 0;
      return;
    }
    // Fixed-point cameras (tower, fly-by): geodetic anchor, auto-zoom on the aircraft.
    if (!this.anchorValid) this.placeAnchor(m, ac);
    this.frame.toLocal(this.anchor.lat, this.anchor.lon, this.anchor.alt_m, _v);
    const dist = _v.distanceTo(_v2);
    if (this.mode === 'flyby' && dist > Math.max(this.flybyStartDist * 1.6, 500)) {
      // Aircraft has passed and gone: set up the next pass.
      this.placeAnchor(m, ac);
      this.frame.toLocal(this.anchor.lat, this.anchor.lon, this.anchor.alt_m, _v);
    }
    if (this.mode === 'tower' && dist > 25_000) {
      this.placeAnchor(m, ac);
      this.frame.toLocal(this.anchor.lat, this.anchor.lon, this.anchor.alt_m, _v);
    }
    const dNow = _v.distanceTo(_v2);
    this.closingSpeed_ms = Number.isFinite(this.prevDist) && d > 0 ? (this.prevDist - dNow) / d : 0;
    this.prevDist = dNow;
    cam.position.copy(_v);
    cam.up.copy(_up);
    cam.lookAt(_v2);
    // Auto-zoom: keep the aircraft about a third of the view height (size ~ chase distance / 2).
    const size = Math.max(10, this.info.chaseDistance_m * 0.6);
    const fov = (2 * Math.atan((size * 1.6) / Math.max(1, dNow)) * 180) / Math.PI / this.externalZoom;
    this.fov = Math.max(1.5, Math.min(70, fov));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }

  private keepAboveGround(p: THREE.Vector3, clearance: number): void {
    this.frame.toGeodetic(p.x, p.y, p.z, _geo);
    const g = this.groundAt(_geo.lat, _geo.lon);
    if (Number.isFinite(g) && _geo.alt_m < g + clearance) this.frame.toLocal(_geo.lat, _geo.lon, g + clearance, p);
  }

  private placeAnchor(m: CameraMotionInput, ac: GeoPosition): void {
    this.anchorValid = true;
    this.prevDist = NaN;
    const a = this.anchor;
    if (this.mode === 'tower') {
      const apt = this.nearestAirport(ac.lat, ac.lon);
      if (apt) {
        // Tower beside the longest runway: 300 m perpendicular from the reference point. EST.
        let hdg = 0;
        let len = -1;
        for (const r of apt.runways) {
          if (r.lengthFt > len) {
            len = r.lengthFt;
            hdg = r.headingTrue;
          }
        }
        const off = offset(apt.lat, apt.lon, hdg + 90, 300);
        a.lat = off.lat;
        a.lon = off.lon;
        const g = this.groundAt(a.lat, a.lon);
        a.alt_m = (Number.isFinite(g) ? g : apt.elevationFt * 0.3048) + TOWER_HEIGHT_M;
        this.towerName = apt.icao;
        this.onModeChange?.(this.mode, this.label());
        return;
      }
      this.towerName = '';
    }
    // Fly-by (or tower with no airport near): ahead of the aircraft along its track, offset to the side.
    const lead = Math.max(250, Math.min(1500, m.speed_ms * 6));
    const trk = Number.isFinite(m.trackDeg) ? m.trackDeg : 0;
    const p1 = offset(ac.lat, ac.lon, trk, lead);
    const p2 = offset(p1.lat, p1.lon, trk + 90, 30 + lead * 0.04);
    a.lat = p2.lat;
    a.lon = p2.lon;
    const g = this.groundAt(a.lat, a.lon);
    a.alt_m = Math.max((Number.isFinite(g) ? g : 0) + 2, ac.alt_m + m.vs_ms * (lead / Math.max(20, m.speed_ms)) + 8);
    this.flybyStartDist = Math.hypot(lead, 30 + lead * 0.04);
  }

  private nearestAirport(lat: number, lon: number): Airport | null {
    if (!this.nav?.ready) return null;
    const list = this.nav.airportsNear(lat, lon, 12, 5);
    return list.find((a) => a.type !== 'heliport' && a.type !== 'closed' && a.runways.length > 0) ?? null;
  }

  /** Listener pose (camera) in the aircraft body frame, for spatial audio. */
  listenerPose(out: ListenerPose): ListenerPose {
    this.camera.getWorldPosition(_v);
    _m.copy(this.vehicle.matrixWorld).invert();
    _v.applyMatrix4(_m);
    out.position_m[0] = -_v.z;
    out.position_m[1] = _v.x;
    out.position_m[2] = -_v.y;
    this.camera.getWorldDirection(_fwd);
    _fwd.transformDirection(_m);
    out.forward[0] = -_fwd.z;
    out.forward[1] = _fwd.x;
    out.forward[2] = -_fwd.y;
    _v.set(0, 1, 0).applyQuaternion(this.camera.getWorldQuaternion(_q)).transformDirection(_m);
    out.up[0] = -_v.z;
    out.up[1] = _v.x;
    out.up[2] = -_v.y;
    return out;
  }

  dispose(): void {
    this.camera.removeFromParent();
  }
}

function clampAbs(x: number, lim: number): number {
  return x > lim ? lim : x < -lim ? -lim : x;
}

/** Destination point on a sphere (short distances; R = 6,371 km). */
function offset(lat: number, lon: number, brgDeg: number, distM: number): { lat: number; lon: number } {
  const R = 6_371_000;
  const d = distM / R;
  const b = (brgDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lon: ((((l2 * 180) / Math.PI + 540) % 360) - 180) };
}
