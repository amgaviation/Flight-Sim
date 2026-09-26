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
 */
import * as THREE from 'three';
import type { ReferenceFrame } from '../world/ReferenceFrame';
import type { GeoPosition } from '../world/types';

/** What the node needs from the flight model (FlightModel satisfies it). */
export interface VehicleSource {
  readonly q: { w: number; x: number; y: number; z: number };
  getDatumPosition(out: { lat: number; lon: number; alt: number }): { lat: number; lon: number; alt: number };
}

export class VehicleNode {
  readonly object = new THREE.Group();
  /** Datum position of the last placement (alt_m MSL). */
  readonly geo: GeoPosition = { lat: 0, lon: 0, alt_m: 0 };
  private readonly datum = { lat: 0, lon: 0, alt: 0 };
  private exterior: THREE.Object3D | null = null;
  private cockpit: THREE.Object3D | null = null;
  private inCockpit = true;

  constructor() {
    this.object.name = 'aircraft';
  }

  /** Reads the datum position (call before recentering so the origin follows the aircraft). */
  readSource(src: VehicleSource): GeoPosition {
    src.getDatumPosition(this.datum);
    this.geo.lat = this.datum.lat;
    this.geo.lon = this.datum.lon;
    this.geo.alt_m = this.datum.alt;
    return this.geo;
  }

  /** Places the object for this frame (after readSource and any recenter). */
  place(src: VehicleSource, frame: ReferenceFrame): void {
    frame.toLocal(this.geo.lat, this.geo.lon, this.geo.alt_m, this.object.position);
    const q = src.q;
    frame.nedQuaternionToLocal(this.geo.lat, this.geo.lon, q.w, q.x, q.y, q.z, this.object.quaternion);
    this.object.updateMatrixWorld(true);
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
