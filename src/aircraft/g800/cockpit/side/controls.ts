/**
 * Side-console control classes for the G800 (cockpit-overhead agent; aircraft-local, not shared):
 *
 *  - `MaskStowage`: crew quick-donning oxygen mask in its stowage box on the outboard console
 *    (dossier §9.4: 0 stowed, 1 donned). Lifting the mask out opens the box doors and turns the
 *    mask supply on (OxygenSystem crew mask `inUse`), stowing it shuts it off. EST shapes from
 *    photographs of EROS-class inflatable-harness masks and boxes.
 *  - `Tiller`: nosewheel steering tiller (left console only, FSB GVIII-G700 §9.4 b), a small
 *    wheel with a crank knob rotated about the console normal. Spring-centred (dossier §9.4:
 *    "-1..1, spring to centre"): drag sideways to steer, release and it returns to centre;
 *    wheel notches nudge it and it re-centres after a short hold. Writes `ac.g800.tiller`
 *    (the logic gives it priority over the hardware tiller axis).
 *
 * Panel frame: x right, y toward the nose (console panels face up), z up.
 */
import * as THREE from 'three';
import type { ControlPointer } from '../../../../cockpit/types';
import type { CockpitEnv } from '../../../../cockpit/env';
import { ControlBase, type ControlOptions } from '../../../../cockpit/controls/ControlBase';
import { cylinderZ, roundedBox } from '../../../../cockpit/geometry/primitives';
import { smoothTo } from '../../../../cockpit/anim';

// ------------------------------------------------------------------------------------------ mask

export interface MaskStowageOptions extends ControlOptions {
  /** 1 = mask out and in use. */
  var: string;
  /** Box size (m): width x length x height. EST from EROS MC-series stowage boxes. */
  size?: [number, number, number];
}

export class MaskStowage extends ControlBase {
  private readonly o: MaskStowageOptions;
  private readonly mask = new THREE.Group();
  private readonly doorL = new THREE.Group();
  private readonly doorR = new THREE.Group();
  private pos = 0;
  private readonly h: number;

  constructor(env: CockpitEnv, o: MaskStowageOptions) {
    super(env, o);
    this.o = o;
    this.initVar(o.var, 0);
    const [w, l, h] = o.size ?? [0.105, 0.125, 0.05];
    this.h = h;
    this.mesh(this.geo(`g800.maskbox.${w}.${l}.${h}`, () => roundedBox(w, l, h, 0.006)), 'plasticBlack', this.object, true).position.z = h / 2;
    const doorG = this.geo(`g800.maskdoor.${w}.${l}`, () => new THREE.BoxGeometry(w / 2 - 0.002, l - 0.006, 0.003).translate((w / 2 - 0.002) / 2, 0, 0));
    this.doorL.position.set(-w / 2 + 0.001, 0, h + 0.0015);
    this.doorR.position.set(w / 2 - 0.001, 0, h + 0.0015);
    this.doorR.rotation.z = Math.PI;
    this.mesh(doorG, 'plasticGrey', this.doorL);
    this.mesh(doorG, 'plasticGrey', this.doorR);
    this.object.add(this.doorL, this.doorR);
    // Red release tabs at the forward edge ("SQUEEZE" tabs).
    const tabG = this.geo('g800.masktab', () => new THREE.BoxGeometry(0.018, 0.006, 0.008));
    for (const s of [-1, 1]) this.mesh(tabG, 'knobRed', this.object, true).position.set(s * 0.022, l / 2 - 0.003, h + 0.006);
    // Mask: oro-nasal cup, red inflatable harness ring, hose.
    this.mesh(this.geo('g800.maskcup', () => new THREE.SphereGeometry(0.038, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.2, 0.9)), 'rubber', this.mask);
    this.mesh(this.geo('g800.maskring', () => new THREE.TorusGeometry(0.045, 0.006, 8, 24)), 'guardRed', this.mask).position.z = 0.012;
    this.mesh(this.geo('g800.maskhose', () => new THREE.CylinderGeometry(0.007, 0.007, 0.12, 10).rotateX(Math.PI / 2).translate(0, 0, -0.06)), 'rubber', this.mask);
    this.mask.position.set(0, 0, h - 0.02);
    this.object.add(this.mask);
    this.addHitBox(w, l, h + 0.02, 0, 0, (h + 0.02) / 2);
    this.pos = this.readVar(o.var) !== 0 ? 1 : 0;
    this.apply();
  }

  protected stateText(): string {
    return this.readVar(this.o.var) !== 0 ? 'DONNED - O2 flowing (click to stow)' : 'STOWED (click to don)';
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || p.button === 1) return;
    this.set(this.readVar(this.o.var) !== 0 ? 0 : 1);
  }

  onWheel(notches: number): void {
    if (!this.enabled || notches === 0) return;
    this.set(notches > 0 ? 1 : 0);
  }

  private set(v: 0 | 1): void {
    if (this.readVar(this.o.var) === v) return;
    this.writeVar(this.o.var, v);
    this.playSound(v ? 'handle.pull' : 'handle.push');
  }

  override update(dt: number): void {
    const target = this.readVar(this.o.var) !== 0 ? 1 : 0;
    if (this.pos !== target) {
      this.pos = smoothTo(this.pos, target, dt, 0.08, 1e-3);
      this.apply();
    }
  }

  private apply(): void {
    const t = this.pos;
    this.doorL.rotation.y = -t * 1.9;
    this.doorR.rotation.y = t * 1.9;
    // Donned: the mask rises out of the box toward the pilot's face (shown lifted 0.25 m).
    this.mask.position.z = this.h - 0.02 + t * 0.25;
    this.mask.rotation.x = t * 0.9;
    this.mask.visible = true;
  }
}

// ------------------------------------------------------------------------------------------ tiller

export interface TillerOptions extends ControlOptions {
  /** -1 (full left) .. +1 (full right). */
  var: string;
  /** Nosewheel angle at full deflection (tooltip only). */
  maxDeg: number;
  /** Visual wheel rotation at full deflection (deg). EST 90 (dossier §9.4: +-90 deg rotation). */
  rotDeg?: number;
  diameter?: number;
  dragPxFull?: number;
}

export class Tiller extends ControlBase {
  private readonly o: TillerOptions;
  private readonly wheel = new THREE.Group();
  private dragging = false;
  private cmd = 0;
  private holdS = 0;
  private shown = 0;

  constructor(env: CockpitEnv, o: TillerOptions) {
    super(env, o);
    this.o = o;
    this.initVar(o.var, 0);
    const d = o.diameter ?? 0.09;
    const r = d / 2;
    // Fixed boss and escutcheon ring.
    this.mesh(this.geo('g800.tiller.boss', () => cylinderZ(0.022, 0.02, 0, 0.012, 24)), 'panelDark', this.object, true);
    // Wheel: rim, hub and a crank knob near the rim (pointer to the steering direction).
    const rimG = this.geo(`g800.tiller.rim.${d}`, () => new THREE.TorusGeometry(r - 0.006, 0.0065, 10, 36));
    const hubG = this.geo(`g800.tiller.hub.${d}`, () => cylinderZ(r - 0.006, r - 0.008, 0, 0.008, 36));
    const knobG = this.geo('g800.tiller.knob', () => cylinderZ(0.009, 0.008, 0, 0.03, 16));
    this.mesh(rimG, 'handleBlack', this.wheel).position.z = 0.006;
    this.mesh(hubG, 'plasticBlack', this.wheel);
    const knob = this.mesh(knobG, 'knobMetal', this.wheel);
    knob.position.set(0, r - 0.014, 0.008);
    this.wheel.position.z = 0.014;
    this.wheel.userData.cockpitDynamic = true;
    this.object.add(this.wheel);
    this.addHitBox(d + 0.01, d + 0.01, 0.05, 0, 0, 0.025);
    this.engrave('L', -r - 0.008, 0, { height: 0.003 });
    this.engrave('R', r + 0.008, 0, { height: 0.003 });
  }

  protected stateText(): string {
    const v = this.readVar(this.o.var);
    const deg = Math.round(v * this.o.maxDeg);
    return deg === 0 ? 'CENTRED (drag sideways to steer)' : `${Math.abs(deg)}° ${deg < 0 ? 'LEFT' : 'RIGHT'}`;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || p.button !== 0) return;
    this.dragging = true;
    this.cmd = this.readVar(this.o.var);
  }

  onDrag(dx: number): void {
    if (!this.dragging) return;
    const full = this.o.dragPxFull ?? 160;
    this.cmd = Math.max(-1, Math.min(1, this.cmd + dx / full));
    this.writeVar(this.o.var, this.cmd);
  }

  onPointerUp(): void {
    this.dragging = false;
  }

  onCancel(): void {
    this.dragging = false;
  }

  onWheel(notches: number): void {
    if (!this.enabled || notches === 0) return;
    this.cmd = Math.max(-1, Math.min(1, this.readVar(this.o.var) + 0.1 * notches));
    this.holdS = 0.8;
    this.writeVar(this.o.var, this.cmd);
  }

  override update(dt: number): void {
    let v = this.readVar(this.o.var);
    if (!this.dragging) {
      if (this.holdS > 0) this.holdS -= dt;
      else if (v !== 0) {
        // Spring return to centre (EST ~0.15 s time constant).
        v = smoothTo(v, 0, dt, 0.15, 0.01);
        this.writeVar(this.o.var, v);
      }
    }
    if (this.shown !== v) {
      this.shown = v;
      this.wheel.rotation.z = -THREE.MathUtils.degToRad((this.o.rotDeg ?? 90) * v);
    }
  }
}
