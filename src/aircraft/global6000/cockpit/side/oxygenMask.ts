/**
 * Crew quick-donning oxygen mask in its side-console stowage box.
 *
 * The Global 6000 has crew quick-donning masks with N / 100 % 
 * regulators (FCOM 01-10-37 / -46 "Oxygen Mask/Regulator"; EST type: EROS-class inflatable-harness mask in a
 * stowage box on each side console). Squeezing the red release tabs and lifting
 * the mask out opens the box doors and turns the mask's oxygen supply on
 * (`inUse` var = 1, OxygenSystem crew mask); stowing it and closing the doors
 * shuts it off.
 *
 * Mouse: left click takes the mask out / stows it; wheel up = out, down = stow.
 * Panel frame: x right, y toward the nose (console panel facing up), z up.
 */
import * as THREE from 'three';
import type { ControlPointer } from '../../../../cockpit/types';
import type { CockpitEnv } from '../../../../cockpit/env';
import { ControlBase, type ControlOptions } from '../../../../cockpit/controls/ControlBase';
import { roundedBox } from '../../../../cockpit/geometry/primitives';
import { smoothTo } from '../../../../cockpit/anim';

export interface MaskStowageOptions extends ControlOptions {
  /** 1 = mask out and in use. */
  var: string;
  /** Box size (m): width x length x height. */
  size?: [number, number, number];
  /** +1: the mask comes out toward +x (inboard for the pilot box on the left console), -1 toward -x. */
  inboard?: 1 | -1;
  /** Sink the box body this far into the console so only the lid shows (m). Default 0 (box proud of the panel). */
  recess?: number;
  /** Lid (door) material (default 'plasticGrey'). Tan leather on the Vision consoles (photo e_lconsole). */
  doorMaterial?: THREE.Material | 'plasticGrey';
}

const DEFAULT_SIZE: [number, number, number] = [0.105, 0.125, 0.05]; // EST from photographs of EROS MC20 stowage boxes

export class MaskStowage extends ControlBase {
  private readonly o: MaskStowageOptions;
  private readonly mask = new THREE.Group();
  private readonly doorL = new THREE.Group();
  private readonly doorR = new THREE.Group();
  private pos = 0;

  constructor(env: CockpitEnv, o: MaskStowageOptions) {
    super(env, o);
    this.o = o;
    this.initVar(o.var, 0);
    const [w, l, hRaw] = o.size ?? DEFAULT_SIZE;
    // Recessed: the body sinks into the console and only the lid sits at panel level (Vision consoles are flush
    // tan leather with the mask under a leather lid, photo e_lconsole).
    const sunk = o.recess ?? 0;
    const h = hRaw - sunk;
    this.mesh(this.geo(`g6k.maskbox.${w}.${l}.${hRaw}.${sunk}`, () => roundedBox(w, l, hRaw, 0.006)), 'plasticBlack', this.object, true).position.z = hRaw / 2 - sunk;
    // Doors on top, hinged along the outer long edges; open while the mask is out.
    const doorG = this.geo(`g6k.maskdoor.${w}.${l}`, () => new THREE.BoxGeometry(w / 2 - 0.002, l - 0.006, 0.003).translate((w / 2 - 0.002) / 2, 0, 0));
    this.doorL.position.set(-w / 2 + 0.001, 0, h + 0.0015);
    this.doorR.position.set(w / 2 - 0.001, 0, h + 0.0015);
    this.doorR.rotation.z = Math.PI;
    const doorM = o.doorMaterial ?? 'plasticGrey';
    this.mesh(doorG, doorM, this.doorL);
    this.mesh(doorG, doorM, this.doorR);
    this.object.add(this.doorL, this.doorR);
    // Red release tabs at the front edge.
    const tabG = this.geo('g6k.masktab', () => new THREE.BoxGeometry(0.018, 0.006, 0.008));
    for (const s of [-1, 1]) this.mesh(tabG, 'knobRed', this.object, true).position.set(s * 0.022, l / 2 - 0.003, h + 0.004);
    // Mask: oro-nasal cup + inflatable harness ring (EST shapes).
    const cupG = this.geo('g6k.maskcup', () => new THREE.SphereGeometry(0.038, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.2, 0.9));
    const ringG = this.geo('g6k.maskring', () => new THREE.TorusGeometry(0.045, 0.006, 8, 24));
    const hoseG = this.geo('g6k.maskhose', () => new THREE.CylinderGeometry(0.007, 0.007, 0.12, 10).rotateX(Math.PI / 2).translate(0, 0, -0.06));
    this.mesh(cupG, 'rubber', this.mask);
    const ring = this.mesh(ringG, 'guardRed', this.mask);
    ring.position.z = 0.012;
    this.mesh(hoseG, 'rubber', this.mask);
    this.mask.position.set(0, 0, h - 0.02);
    this.object.add(this.mask);
    this.addHitBox(w, l, h + 0.02, 0, 0, (h + 0.02) / 2);
    this.pos = this.readVar(o.var) !== 0 ? 1 : 0;
    this.apply();
  }

  protected stateText(): string {
    return this.readVar(this.o.var) !== 0 ? 'IN USE (click to stow)' : 'STOWED (click to don)';
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || p.button === 1) return;
    this.set(this.readVar(this.o.var) !== 0 ? 0 : 1);
  }

  onWheel(delta: number): void {
    if (!this.enabled || delta === 0) return;
    this.set(delta > 0 ? 1 : 0);
  }

  private set(v: 0 | 1): void {
    if (this.readVar(this.o.var) === v) return;
    this.writeVar(this.o.var, v);
    this.playSound(v ? 'handle.pull' : 'handle.push');
  }

  override update(dt: number): void {
    this.pos = smoothTo(this.pos, this.readVar(this.o.var) !== 0 ? 1 : 0, dt, 0.15, 1e-4);
    this.apply();
  }

  private apply(): void {
    const k = this.pos;
    const h = (this.o.size ?? DEFAULT_SIZE)[2] - (this.o.recess ?? 0);
    const s = this.o.inboard ?? 1;
    // Lifted up and toward the crew member (toward -y = aft, and inboard), tipped toward the face.
    this.mask.position.set(s * 0.12 * k, -0.06 * k, h - 0.02 + 0.3 * k);
    this.mask.rotation.set(1.3 * k, 0, 0);
    const open = Math.min(1, k * 3) * 1.9;
    this.doorL.rotation.y = -open;
    this.doorR.rotation.y = open;
  }
}
