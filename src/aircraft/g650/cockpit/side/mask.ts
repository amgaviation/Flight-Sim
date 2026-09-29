/**
 * Crew quick-donning oxygen mask in its stowage box (G650: EROS-class inflatable-harness masks, LUC oxygen
 * "EROS MLD 20"; dossier §9.10: `ac.g650.oxy.mask_l/_r` 0 stowed / 1 in use). Lifting the mask out opens the
 * box doors and starts the mask supply (OxygenSystem crew mask `inUse`: flow per the regulator N / 100 % /
 * EMERGENCY); stowing it shuts it off. Box and mask shapes are EST from photographs of EROS stowage boxes.
 *
 * Panel frame: x right, y toward the nose (console panels face up), z up.
 */
import * as THREE from 'three';
import type { ControlPointer } from '../../../../cockpit/types';
import type { CockpitEnv } from '../../../../cockpit/env';
import { ControlBase, type ControlOptions } from '../../../../cockpit/controls/ControlBase';
import { roundedBox } from '../../../../cockpit/geometry/primitives';
import { smoothTo } from '../../../../cockpit/anim';

export interface G650MaskOptions extends ControlOptions {
  /** 1 = mask out and in use. */
  var: string;
  /** Box size (m): width x length x height. EST. */
  size?: [number, number, number];
}

export class G650MaskStowage extends ControlBase {
  private readonly o: G650MaskOptions;
  private readonly mask = new THREE.Group();
  private readonly doorL = new THREE.Group();
  private readonly doorR = new THREE.Group();
  private pos = 0;
  private readonly h: number;

  constructor(env: CockpitEnv, o: G650MaskOptions) {
    super(env, o);
    this.o = o;
    this.initVar(o.var, 0);
    const [w, l, h] = o.size ?? [0.1, 0.12, 0.05];
    this.h = h;
    this.mesh(this.geo(`g650.maskbox.${w}.${l}.${h}`, () => roundedBox(w, l, h, 0.006)), 'plasticBlack', this.object, true).position.z = h / 2;
    const doorG = this.geo(`g650.maskdoor.${w}.${l}`, () => new THREE.BoxGeometry(w / 2 - 0.002, l - 0.006, 0.003).translate((w / 2 - 0.002) / 2, 0, 0));
    this.doorL.position.set(-w / 2 + 0.001, 0, h + 0.0015);
    this.doorR.position.set(w / 2 - 0.001, 0, h + 0.0015);
    this.doorR.rotation.z = Math.PI;
    this.doorL.userData.cockpitDynamic = true;
    this.doorR.userData.cockpitDynamic = true;
    this.mesh(doorG, 'plasticGrey', this.doorL);
    this.mesh(doorG, 'plasticGrey', this.doorR);
    this.object.add(this.doorL, this.doorR);
    // Red release tabs at the forward edge ("PRESS TO RELEASE" / squeeze tabs, EST).
    const tabG = this.geo('g650.masktab', () => new THREE.BoxGeometry(0.018, 0.006, 0.008));
    for (const s of [-1, 1]) this.mesh(tabG, 'knobRed', this.object, true).position.set(s * 0.022, l / 2 - 0.003, h + 0.006);
    // Mask: oro-nasal cup, red inflatable harness, hose.
    this.mesh(this.geo('g650.maskcup', () => new THREE.SphereGeometry(0.036, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.2, 0.9)), 'rubber', this.mask);
    this.mesh(this.geo('g650.maskring', () => new THREE.TorusGeometry(0.043, 0.006, 8, 24)), 'guardRed', this.mask).position.z = 0.012;
    this.mesh(this.geo('g650.maskhose', () => new THREE.CylinderGeometry(0.007, 0.007, 0.12, 10).rotateX(Math.PI / 2).translate(0, 0, -0.06)), 'rubber', this.mask);
    this.mask.position.set(0, 0, h - 0.02);
    this.mask.userData.cockpitDynamic = true;
    this.object.add(this.mask);
    this.engrave('OXYGEN MASK', 0, -l / 2 - 0.006, { height: 0.0022 });
    this.addHitBox(w, l, h + 0.02, 0, 0, (h + 0.02) / 2);
    this.pos = this.readVar(o.var) !== 0 ? 1 : 0;
    this.apply();
  }

  protected stateText(): string {
    return this.readVar(this.o.var) !== 0 ? 'IN USE - oxygen flowing (click to stow)' : 'STOWED (click to don)';
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
    // In use: the mask is lifted out toward the pilot's face (shown 0.25 m up).
    this.mask.position.z = this.h - 0.02 + t * 0.25;
    this.mask.rotation.x = t * 0.9;
  }
}
