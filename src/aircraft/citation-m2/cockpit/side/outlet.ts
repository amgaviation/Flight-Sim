/**
 * 110 V AC outlet in the copilot's sidewall (S&D15 §9.4, §11.1 "Single 110
 * volt AC outlet in copilot sidewall"), with a plug that can be inserted or
 * removed. CAE CJ-family differences p. 5-26: "An ON/OFF switch located in
 * the wall outlet turns the inverter ON when a plug is inserted into the wall
 * outlet and OFF when the plug is removed." The plug var enables the inverter
 * load (systems/electrical.ts).
 *
 * Mouse: left click plugs in / unplugs; wheel up = plug in, down = unplug.
 * Frame: panel frame (x right, y up, z out of the plate).
 */
import * as THREE from 'three';
import type { ControlPointer } from '../../../../cockpit/types';
import type { CockpitEnv } from '../../../../cockpit/env';
import { ControlBase, type ControlOptions } from '../../../../cockpit/controls/ControlBase';
import { roundedBox } from '../../../../cockpit/geometry/primitives';
import { smoothTo } from '../../../../cockpit/anim';

export interface OutletOptions extends ControlOptions {
  /** 1 = plug inserted. */
  var: string;
}

export class AcOutletPlug extends ControlBase {
  private readonly o: OutletOptions;
  private readonly plug = new THREE.Group();
  private pos = 0;

  constructor(env: CockpitEnv, o: OutletOptions) {
    super(env, o);
    this.o = o;
    this.initVar(o.var, 0);
    // Faceplate (NEMA 5-15 style receptacle, EST: US 110 V outlet) with two slots and a ground hole.
    this.mesh(this.geo('m2.outlet.face', () => roundedBox(0.036, 0.046, 0.004, 0.004).translate(0, 0, 0.002)), 'plasticGrey', this.object, true);
    const slotG = this.geo('m2.outlet.slot', () => new THREE.BoxGeometry(0.0022, 0.0072, 0.0006).translate(0, 0, 0.0042));
    for (const x of [-0.0064, 0.0064]) this.mesh(slotG, 'plasticBlack', this.object, true).position.set(x, 0.004, 0);
    this.mesh(this.geo('m2.outlet.gnd', () => new THREE.CylinderGeometry(0.0024, 0.0024, 0.0006, 12).rotateX(Math.PI / 2).translate(0, 0, 0.0042)), 'plasticBlack', this.object, true).position.set(0, -0.007, 0);
    // Plug with a short cord (visible when inserted).
    const bodyG = this.geo('m2.outlet.plug', () => roundedBox(0.026, 0.03, 0.02, 0.005).translate(0, 0, 0.01));
    const cordG = this.geo('m2.outlet.cord', () => new THREE.CylinderGeometry(0.003, 0.003, 0.12, 8).translate(0, -0.06 - 0.012, 0.012));
    this.mesh(bodyG, 'plasticBlack', this.plug);
    this.mesh(cordG, 'rubber', this.plug);
    this.object.add(this.plug);
    this.addHitBox(0.04, 0.05, 0.03, 0, 0, 0.015);
    this.pos = this.readVar(o.var) !== 0 ? 1 : 0;
    this.apply();
  }

  protected stateText(): string {
    return this.readVar(this.o.var) !== 0 ? 'PLUG IN (inverter on)' : 'EMPTY';
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
    this.playSound(v ? 'handle.push' : 'handle.pull');
  }

  override update(dt: number): void {
    this.pos = smoothTo(this.pos, this.readVar(this.o.var) !== 0 ? 1 : 0, dt, 0.06, 1e-4);
    this.apply();
  }

  private apply(): void {
    // Hidden (parked out of the way, scaled down) when unplugged; slides onto the face when inserted.
    const k = this.pos;
    this.plug.visible = k > 0.02;
    this.plug.position.set(0, 0, 0.004 + (1 - k) * 0.03);
  }
}
