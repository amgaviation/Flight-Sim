/**
 * Physical cabin fittings of the steam 172S that are operated by hand but whose whole function is
 * their own position (POH 172SPHUS Sec 7 "Cabin doors, windows and exits" / "Interior lighting"):
 *
 *  - SunVisor: the padded sun visors hinged on the headliner at the windshield top edge. Click
 *    swings the visor down / up, drag or wheel sets any angle in between. The position is kept in
 *    a var (ST.visorLeft / Right, 0 stowed .. 1 down) and shown by the visor itself, which blocks the
 *    view it is lowered into.
 *  - FloodEyeball: the two front flood lights in the overhead console are "individually
 *    rotatable" (POH Sec 7 "Interior lighting"). Drag aims the lamp (eyeball housing) and moves the
 *    flood light's beam with it; the ON/OFF push switch beside each lamp is a separate control.
 *
 * SCOPE: both are mechanical fittings with no system consumer; their state is the geometry itself
 * (visor angle, lamp aim), which the tooltip reports. Allocation-free per frame.
 */
import * as THREE from 'three';
import type { CockpitEnv } from '../../../cockpit/env';
import type { ControlPointer } from '../../../cockpit/types';
import { ControlBase, type ControlOptions } from '../../../cockpit/controls/ControlBase';
import { cylinderZ, roundedBox } from '../../../cockpit/geometry/primitives';

/** Hand-positioned cabin fitting (no system consumer; the state is its own geometry, see header). */
export abstract class CabinFitting extends ControlBase {
  /** Human-readable position (used by the tooltip and the coverage test). */
  abstract physicalState(): string;
  protected stateText(): string {
    return this.physicalState();
  }
}

export interface SunVisorOptions extends ControlOptions {
  /** Position var: 0 stowed against the headliner .. 1 fully down. */
  var: string;
  width: number;
  height: number;
  material: THREE.Material;
  /** Swing from stowed to fully down (deg). EST 80. */
  swingDeg?: number;
}

/** Sun visor hinged along its forward edge; placed with facing 'down' (local +y = aft, +z = down). */
export class SunVisor extends CabinFitting {
  private readonly hinge = new THREE.Group();
  private readonly o: SunVisorOptions;
  private angle = 0;
  private moved = 0;

  constructor(env: CockpitEnv, o: SunVisorOptions) {
    super(env, o);
    this.o = o;
    this.initVar(o.var, 0);
    this.hinge.userData.cockpitDynamic = true;
    this.object.add(this.hinge);
    const g = this.geo(`c172s.visor.${o.width}.${o.height}`, () => {
      const b = roundedBox(o.width, o.height, 0.008, 0.02, 2);
      b.translate(0, o.height / 2, 0.006);
      return b;
    });
    this.mesh(g, o.material, this.hinge);
    this.addHitBox(o.width, o.height, 0.02, 0, o.height / 2, 0.006, this.hinge);
    this.angle = this.target();
    this.hinge.rotation.x = this.angle;
  }

  private target(): number {
    const v = Math.max(0, Math.min(1, this.readVar(this.o.var)));
    return (v * (this.o.swingDeg ?? 80) * Math.PI) / 180;
  }

  physicalState(): string {
    const v = this.readVar(this.o.var);
    return v < 0.03 ? 'STOWED' : v > 0.97 ? 'DOWN' : `${Math.round(v * 100)}% DOWN`;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || p.button === 1) return;
    this.moved = 0;
  }

  onDrag(_dx: number, dy: number): void {
    this.moved += Math.abs(dy);
    this.set(this.readVar(this.o.var) + dy / 200);
  }

  onPointerUp(p?: ControlPointer): void {
    if (this.moved < 3) {
      const down = p?.button === 2 ? false : this.readVar(this.o.var) < 0.5;
      this.set(down ? 1 : 0);
    }
  }

  onWheel(delta: number): void {
    if (!this.enabled) return;
    this.set(this.readVar(this.o.var) + delta * 0.1);
  }

  private set(v: number): void {
    this.writeVar(this.o.var, Math.max(0, Math.min(1, v)));
  }

  override update(dt: number): void {
    const t = this.target();
    if (t === this.angle) return;
    const k = Math.min(1, dt * 10);
    this.angle += (t - this.angle) * k;
    if (Math.abs(t - this.angle) < 1e-3) this.angle = t;
    this.hinge.rotation.x = this.angle;
  }
}

export interface FloodEyeballOptions extends ControlOptions {
  /** Flood light (a spot light whose target is moved by the eyeball). */
  light: THREE.SpotLight;
  /** Aim range each way (deg). EST 30. */
  rangeDeg?: number;
  lensMaterial: THREE.Material;
  housingMaterial: THREE.Material;
}

/** Rotatable flood-light eyeball in the overhead console; placed with facing 'down'. */
export class FloodEyeball extends CabinFitting {
  private readonly ball = new THREE.Group();
  private readonly o: FloodEyeballOptions;
  private readonly light: THREE.SpotLight;
  private readonly lightPos = new THREE.Vector3();
  private readonly baseDir = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private yaw = 0;
  private pitch = 0;
  private dirty = true;

  constructor(env: CockpitEnv, o: FloodEyeballOptions) {
    super(env, o);
    this.o = o;
    this.light = o.light;
    this.ball.userData.cockpitDynamic = true;
    this.object.add(this.ball);
    const housing = this.geo('c172s.flood_ball', () => new THREE.SphereGeometry(0.017, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2));
    this.mesh(housing, o.housingMaterial, this.ball);
    const lens = this.geo('c172s.flood_ball_lens', () => cylinderZ(0.011, 0.011, 0.015, 0.0175, 20));
    this.mesh(lens, o.lensMaterial, this.ball);
    const bezel = this.geo('c172s.flood_ball_bezel', () => cylinderZ(0.022, 0.022, -0.001, 0.003, 24));
    this.mesh(bezel, o.housingMaterial, this.object, true);
    this.addHitBox(0.036, 0.036, 0.02, 0, 0, 0.008);
    this.lightPos.copy(this.light.position);
    this.baseDir.copy(this.light.target.position).sub(this.lightPos);
    this.light.target.userData.cockpitDynamic = true;
  }

  physicalState(): string {
    return `aimed ${this.yaw >= 0 ? 'R' : 'L'} ${Math.abs(Math.round(this.yaw))} deg, ${this.pitch >= 0 ? 'AFT' : 'FWD'} ${Math.abs(Math.round(this.pitch))} deg`;
  }

  onDrag(dx: number, dy: number): void {
    if (!this.enabled) return;
    const r = this.o.rangeDeg ?? 30;
    this.yaw = Math.max(-r, Math.min(r, this.yaw + dx * 0.25));
    this.pitch = Math.max(-r, Math.min(r, this.pitch + dy * 0.25));
    this.dirty = true;
  }

  onWheel(delta: number): void {
    if (!this.enabled) return;
    const r = this.o.rangeDeg ?? 30;
    this.pitch = Math.max(-r, Math.min(r, this.pitch + delta * 3));
    this.dirty = true;
  }

  override update(_dt: number): void {
    if (!this.dirty) return;
    this.dirty = false;
    const d2r = Math.PI / 180;
    // Eyeball: local x across the console, local y aft (facing 'down').
    this.e.set(this.pitch * d2r, this.yaw * d2r, 0, 'XYZ');
    this.ball.rotation.copy(this.e);
    // Beam: rotate the rest direction in the cockpit frame (x right, y up, z aft).
    this.dir.copy(this.baseDir);
    this.q.setFromAxisAngle(this.axisY, -this.yaw * d2r);
    this.dir.applyQuaternion(this.q);
    this.q.setFromAxisAngle(this.axisX, -this.pitch * d2r);
    this.dir.applyQuaternion(this.q);
    const t = this.light.target;
    t.position.copy(this.lightPos).add(this.dir);
    t.updateMatrix();
    t.updateMatrixWorld(true);
  }
}
