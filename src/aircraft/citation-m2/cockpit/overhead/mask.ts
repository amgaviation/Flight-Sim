/**
 * Crew quick-donning oxygen mask in its stowage container.
 *
 * S&D15 §9.6: "Quick-donning pressure demand masks with microphones are
 * provided at each crew seat"; S&D21 §10.1 / dossier §9.0: stowed above each
 * crew member's shoulder. EST (type not public): EROS-class inflatable-harness
 * mask in a hanging stowage cup. Taking the mask out (squeeze the red harness
 * inflation tabs and pull) opens the container doors and turns its oxygen
 * supply on (`inUse` var = 1 -> OxygenSystem crew mask); stowing it closes
 * the doors and shuts the flow off.
 *
 * Mouse: left click takes the mask out / stows it; wheel up = out, down = stow.
 * Frame: the control's panel frame (x right, y up along the mounting plate, z out of the plate).
 */
import * as THREE from 'three';
import type { ControlPointer } from '../../../../cockpit/types';
import type { CockpitEnv } from '../../../../cockpit/env';
import { ControlBase, type ControlOptions } from '../../../../cockpit/controls/ControlBase';
import { roundedBox } from '../../../../cockpit/geometry/primitives';
import { smoothTo } from '../../../../cockpit/anim';

export interface M2MaskOptions extends ControlOptions {
  /** 1 = mask out of the container and in use. */
  var: string;
  /** Container size (m): width x height x depth. EST from EROS stowage-box photographs. */
  size?: [number, number, number];
  /** Direction (panel x sign) the mask swings toward when taken out (toward the crew member's face). */
  toward?: 1 | -1;
}

const DEFAULT_SIZE: [number, number, number] = [0.11, 0.13, 0.06];

export class M2MaskStowage extends ControlBase {
  private readonly o: M2MaskOptions;
  private readonly mask = new THREE.Group();
  private readonly doorA = new THREE.Group();
  private readonly doorB = new THREE.Group();
  private pos = 0;

  constructor(env: CockpitEnv, o: M2MaskOptions) {
    super(env, o);
    this.o = o;
    this.initVar(o.var, 0);
    const [w, h, d] = o.size ?? DEFAULT_SIZE;
    // Container body (grey plastic, as the M2 interior trim), stands on the plate (z 0..d).
    this.mesh(this.geo(`m2.maskbox.${w}.${h}.${d}`, () => roundedBox(w, h, d, 0.008).translate(0, 0, d / 2)), 'plasticGrey', this.object, true);
    // Two doors on the open face, hinged on the long edges.
    const doorG = this.geo(`m2.maskdoor.${w}.${h}`, () => new THREE.BoxGeometry(w / 2 - 0.003, h - 0.008, 0.003).translate((w / 2 - 0.003) / 2, 0, 0));
    this.doorA.position.set(-w / 2 + 0.002, 0, d + 0.0016);
    this.doorB.position.set(w / 2 - 0.002, 0, d + 0.0016);
    this.doorB.rotation.z = Math.PI;
    this.mesh(doorG, 'plasticBlack', this.doorA);
    this.mesh(doorG, 'plasticBlack', this.doorB);
    this.object.add(this.doorA, this.doorB);
    // Red harness tabs (squeeze to inflate) sticking out between the doors, and the "OXYGEN" legend.
    const tabG = this.geo('m2.masktab', () => new THREE.BoxGeometry(0.02, 0.007, 0.012));
    for (const s of [-1, 1]) this.mesh(tabG, 'knobRed', this.mask).position.set(s * 0.024, -0.03, 0.012);
    // Mask: oro-nasal cup, inflatable harness ring and hose (EST shapes).
    const cupG = this.geo('m2.maskcup', () => new THREE.SphereGeometry(0.036, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.2, 0.9));
    const ringG = this.geo('m2.maskring', () => new THREE.TorusGeometry(0.044, 0.006, 8, 24));
    const regG = this.geo('m2.maskreg', () => new THREE.CylinderGeometry(0.014, 0.016, 0.03, 16).rotateX(Math.PI / 2).translate(0, 0, -0.005));
    const hoseG = this.geo('m2.maskhose', () => new THREE.CylinderGeometry(0.007, 0.007, 0.16, 10).rotateX(Math.PI / 2).translate(0, 0, -0.08));
    this.mesh(cupG, 'rubber', this.mask);
    this.mesh(ringG, 'guardRed', this.mask).position.z = 0.012;
    this.mesh(regG, 'plasticBlack', this.mask).position.set(0, -0.02, 0.0);
    this.mesh(hoseG, 'rubber', this.mask);
    this.mask.position.set(0, 0, d - 0.025);
    this.object.add(this.mask);
    this.addHitBox(w, h, d + 0.02, 0, 0, (d + 0.02) / 2);
    this.pos = this.readVar(o.var) !== 0 ? 1 : 0;
    this.apply();
  }

  protected stateText(): string {
    return this.readVar(this.o.var) !== 0 ? 'ON (in use, click to stow)' : 'STOWED (click to don)';
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
    const [, , d] = this.o.size ?? DEFAULT_SIZE;
    const s = this.o.toward ?? 1;
    // Out of the container toward the crew member's face: along the plate normal, sideways, cup turned to the face.
    this.mask.position.set(s * 0.1 * k, -0.08 * k, d - 0.025 + 0.2 * k);
    this.mask.rotation.set(-0.9 * k, s * 0.5 * k, 0);
    const open = Math.min(1, k * 3) * 1.8;
    this.doorA.rotation.y = -open;
    this.doorB.rotation.y = open;
  }
}
