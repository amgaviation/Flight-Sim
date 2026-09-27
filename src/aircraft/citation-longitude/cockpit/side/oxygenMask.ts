/**
 * Crew quick-donning oxygen mask in its side-console stowage box.
 *
 * The Longitude has crew quick-donning masks with NORM / 100 % / EMER
 * regulators (dossier §4.8, EST type: EROS-class inflatable-harness mask in a
 * stowage box beside each seat). Squeezing the red release tabs and lifting
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
import { cylinderZ, tube } from '../../../../cockpit/geometry/primitives';
import { smoothTo } from '../../../../cockpit/anim';

export interface MaskStowageOptions extends ControlOptions {
  /** 1 = mask out and in use. */
  var: string;
  /** Box size (m): width x length x height. */
  size?: [number, number, number];
  /** +1: the mask comes out toward +x (inboard for the pilot box on the left console), -1 toward -x. */
  inboard?: 1 | -1;
}

const DEFAULT_SIZE: [number, number, number] = [0.1, 0.1, 0.05]; // cup diameter x (unused) x depth, EST from c_lcon

/**
 * Layout audit L52 (c_lcon): the quick-donning mask stows in a round console cup; its red squeeze tabs stand up out of
 * the cup and the white supply hose loops over the cup rim. No stowage-box doors.
 */
export class MaskStowage extends ControlBase {
  private readonly o: MaskStowageOptions;
  private readonly mask = new THREE.Group();
  private pos = 0;

  constructor(env: CockpitEnv, o: MaskStowageOptions) {
    super(env, o);
    this.o = o;
    this.initVar(o.var, 0);
    const [d, , h] = o.size ?? DEFAULT_SIZE;
    const r = d / 2;
    // Cup: black rim ring on the console and a dark well.
    this.mesh(this.geo(`lon.maskcup.rim.${r}`, () => new THREE.TorusGeometry(r, 0.006, 10, 36)), 'plasticBlack', this.object, true).position.z = 0.002;
    this.mesh(this.geo(`lon.maskcup.well.${r}.${h}`, () => cylinderZ(r, r * 0.92, -h, 0.001, 32)), 'panelDark', this.object, true);
    // White supply hose loop over the rim (c_lcon), from the cup's inboard rim up and back into the console.
    const inb = o.inboard ?? 1;
    const hoseG = this.geo(`lon.maskhose.loop.${inb}`, () => {
      const pts = [
        new THREE.Vector3(inb * r * 0.6, -r * 0.2, -0.01),
        new THREE.Vector3(inb * r * 0.8, -r * 0.4, 0.07),
        new THREE.Vector3(inb * r * 0.9, -r * 1.0, 0.1),
        new THREE.Vector3(inb * r * 0.95, -r * 1.6, 0.06),
        new THREE.Vector3(inb * r * 1.0, -r * 1.9, 0.0),
      ];
      return tube(pts, 0.0065, 32, 10);
    });
    this.mesh(hoseG, 'knobWhite', this.object, true);
    // Mask: oro-nasal cup (black) with the red squeeze tabs on top (EST shapes).
    const cupG = this.geo('lon.maskcup.mask', () => new THREE.SphereGeometry(0.036, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.2, 0.9));
    this.mesh(cupG, 'rubber', this.mask);
    const tabG = this.geo('lon.masktab2', () => new THREE.BoxGeometry(0.022, 0.012, 0.02));
    for (const s2 of [-1, 1]) this.mesh(tabG, 'knobRed', this.mask).position.set(s2 * 0.016, 0, 0.03);
    this.mask.position.set(0, 0, -0.012);
    this.object.add(this.mask);
    this.addHitBox(d, d, 0.06, 0, 0, 0.02);
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
    const s = this.o.inboard ?? 1;
    // Lifted out of the cup up and toward the crew member (aft and inboard), tipped toward the face.
    this.mask.position.set(s * 0.12 * k, -0.06 * k, -0.012 + 0.32 * k);
    this.mask.rotation.set(1.3 * k, 0, 0);
  }
}
