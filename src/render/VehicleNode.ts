/**
 * The aircraft object in the floating-origin scene graph.
 *
 * `object` is placed every frame at the FDM datum (fdm.getDatumPosition)
 * with the FDM attitude (body->NED quaternion), converted by the world's
 * ReferenceFrame into scene coordinates. Its local axes are the cockpit-local
 * frame (x right, y up, z aft; nose = -z), so `CockpitBuild.root` and the
 * exterior model are added to it at identity (their origin is the datum).
 *
 * Because it is re-placed from geodetic coordinates each frame, it needs no
 * recenter handling; call `place()` after any `frame.maybeRecenter()`.
 *
 * Render interpolation: physics runs at a fixed 120 Hz while displays run
 * at 60/75/90/144/165 Hz, so a frame advances by 0, 1 or 2 physics steps.
 * Drawing the latest step makes the aircraft (and the cockpit camera riding
 * on it) judder on every display that is not 60 or 120 Hz. `capture()`
 * records the state before each physics step and `readSource(src, alpha)`
 * draws between that and the latest state with the SimLoop's leftover
 * fraction `alpha` (Glenn Fiedler, "Fix Your Timestep!": the standard
 * remedy; the picture lags the physics by < 1 step = 8.3 ms). Teleports
 * (reposition, slew, state presets) snap instead of sweeping.
 */
import * as THREE from 'three';
import type { ReferenceFrame } from '../world/ReferenceFrame';
import type { GeoPosition } from '../world/types';

/** What the node needs from the flight model (FlightModel satisfies it). */
export interface VehicleSource {
  readonly q: { w: number; x: number; y: number; z: number };
  getDatumPosition(out: { lat: number; lon: number; alt: number }): { lat: number; lon: number; alt: number };
}

/** Snapshot of a placement (datum position + body->NED attitude). */
interface Pose {
  lat: number;
  lon: number;
  alt: number;
  qw: number;
  qx: number;
  qy: number;
  qz: number;
}

/** A frame whose state moved more than this from the pre-step capture is a teleport, not motion (m). EST: > 80 steps at Mach 1. */
const TELEPORT_M = 200;
/** ...or turned more than this (quaternion dot below cos(10 deg / 2)): no aircraft rotates 10 deg in one 8 ms step. */
const TELEPORT_DOT = Math.cos((10 * Math.PI) / 180 / 2);
const M_PER_DEG_LAT = 111_320;

function newPose(): Pose {
  return { lat: 0, lon: 0, alt: 0, qw: 1, qx: 0, qy: 0, qz: 0 };
}

export class VehicleNode {
  readonly object = new THREE.Group();
  /** Datum position of the last placement (alt_m MSL), interpolated between physics steps. */
  readonly geo: GeoPosition = { lat: 0, lon: 0, alt_m: 0 };
  /** Attitude (body->NED) of the last placement, interpolated between physics steps. */
  readonly attitude = { w: 1, x: 0, y: 0, z: 0 };
  private readonly datum = { lat: 0, lon: 0, alt: 0 };
  private readonly prev: Pose = newPose();
  private readonly cur: Pose = newPose();
  private hasPrev = false;
  private exterior: THREE.Object3D | null = null;
  private cockpit: THREE.Object3D | null = null;
  private inCockpit = true;

  constructor() {
    this.object.name = 'aircraft';
  }

  /** Records the pre-step placement. Call right before every physics step. Allocation-free. */
  capture(src: VehicleSource): void {
    this.snapshot(src, this.prev);
    this.hasPrev = true;
  }

  /** Forgets the pre-step capture (the next frame draws the latest state), e.g. after a reposition. */
  resetInterpolation(): void {
    this.hasPrev = false;
  }

  /**
   * Reads the placement to draw this frame (call before recentering so the
   * origin follows the aircraft). `alpha` (0..1, SimLoop FrameInfo.alpha) is
   * the fraction of a physics step accumulated since the last step: the
   * pose is `prev + (latest - prev) * alpha`. Omit it (or pass 1) to draw
   * the latest state. Allocation-free.
   */
  readSource(src: VehicleSource, alpha = 1): GeoPosition {
    const c = this.cur;
    this.snapshot(src, c);
    let a = alpha >= 1 || !(alpha >= 0) || !this.hasPrev ? 1 : alpha;
    const p = this.prev;
    let dot = p.qw * c.qw + p.qx * c.qx + p.qy * c.qy + p.qz * c.qz;
    if (a < 1) {
      const dn = (c.lat - p.lat) * M_PER_DEG_LAT;
      const de = (c.lon - p.lon) * M_PER_DEG_LAT * Math.cos((c.lat * Math.PI) / 180);
      if (Math.abs(c.lon - p.lon) > 180 || dn * dn + de * de > TELEPORT_M * TELEPORT_M || Math.abs(c.alt - p.alt) > TELEPORT_M || Math.abs(dot) < TELEPORT_DOT) a = 1;
    }
    const g = this.geo;
    const q = this.attitude;
    if (a >= 1) {
      g.lat = c.lat;
      g.lon = c.lon;
      g.alt_m = c.alt;
      q.w = c.qw;
      q.x = c.qx;
      q.y = c.qy;
      q.z = c.qz;
      return g;
    }
    g.lat = p.lat + (c.lat - p.lat) * a;
    g.lon = p.lon + (c.lon - p.lon) * a;
    g.alt_m = p.alt + (c.alt - p.alt) * a;
    // Normalised lerp on the shorter arc (steps turn < 10 deg: indistinguishable from slerp).
    const s = dot < 0 ? -1 : 1;
    dot = 1 - a;
    let w = p.qw * s * dot + c.qw * a;
    let x = p.qx * s * dot + c.qx * a;
    let y = p.qy * s * dot + c.qy * a;
    let z = p.qz * s * dot + c.qz * a;
    const n = 1 / Math.sqrt(w * w + x * x + y * y + z * z);
    w *= n;
    x *= n;
    y *= n;
    z *= n;
    q.w = w;
    q.x = x;
    q.y = y;
    q.z = z;
    return g;
  }

  /** Places the object for this frame (after readSource and any recenter) with the pose `readSource` chose. */
  place(_src: VehicleSource, frame: ReferenceFrame): void {
    frame.toLocal(this.geo.lat, this.geo.lon, this.geo.alt_m, this.object.position);
    const q = this.attitude;
    frame.nedQuaternionToLocal(this.geo.lat, this.geo.lon, q.w, q.x, q.y, q.z, this.object.quaternion);
    this.object.updateMatrixWorld(true);
  }

  private snapshot(src: VehicleSource, out: Pose): void {
    src.getDatumPosition(this.datum);
    out.lat = this.datum.lat;
    out.lon = this.datum.lon;
    out.alt = this.datum.alt;
    const q = src.q;
    out.qw = q.w;
    out.qx = q.x;
    out.qy = q.y;
    out.qz = q.z;
  }

  /** Attaches the aircraft's cockpit root and exterior model (replacing previous ones). */
  setModels(cockpit: THREE.Object3D | null, exterior: THREE.Object3D | null): void {
    if (this.cockpit && this.cockpit.parent === this.object) this.object.remove(this.cockpit);
    if (this.exterior && this.exterior.parent === this.object) this.object.remove(this.exterior);
    this.cockpit = cockpit;
    this.exterior = exterior;
    if (cockpit) this.object.add(cockpit);
    if (exterior) this.object.add(exterior);
    this.setViewInside(this.inCockpit);
  }

  /**
   * Cockpit view: the cockpit is shown and the exterior hidden, except
   * exterior parts flagged `userData.visibleFromCockpit = true` (e.g. wings
   * and engines seen through the side windows). External views show the
   * exterior; the cockpit interior is hidden (performance), except parts
   * flagged `userData.visibleFromOutside = true`.
   */
  setViewInside(inside: boolean): void {
    this.inCockpit = inside;
    if (this.cockpit) {
      this.cockpit.visible = true;
      for (const c of this.cockpit.children) c.visible = inside || c.userData.visibleFromOutside === true;
    }
    if (this.exterior) {
      this.exterior.visible = true;
      for (const c of this.exterior.children) c.visible = !inside || c.userData.visibleFromCockpit === true;
    }
  }

  get cockpitRoot(): THREE.Object3D | null {
    return this.cockpit;
  }

  get exteriorRoot(): THREE.Object3D | null {
    return this.exterior;
  }
}
