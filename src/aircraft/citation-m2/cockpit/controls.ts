/**
 * Citation M2 specific cockpit control: the GTC 570 map knob with its
 * joystick (Garmin G3000 PG §1.3: "Map knob: turn for map range, push for
 * the map pointer, joystick pans the pointer").
 *
 * Mouse: wheel = range (inc / dec encoder events); left click (no drag) =
 * push; drag = joystick deflection (emits the joystick event with
 * { x, y } in -1..1 while dragging, { 0, 0 } on release; 60 px = full
 * deflection).
 */
import * as THREE from 'three';
import type { ControlPointer } from '../../../cockpit/types';
import { COCKPIT_SOUNDS } from '../../../cockpit/types';
import type { CockpitEnv } from '../../../cockpit/env';
import { ControlBase, type ControlOptions } from '../../../cockpit/controls/ControlBase';
import { knobGeometry } from '../../../cockpit/geometry/knobs';
import { smoothTo } from '../../../cockpit/anim';

export interface MapJoystickOptions extends ControlOptions {
  incEvent: string;
  decEvent: string;
  pushEvent: string;
  joystickEvent: string;
  diameter?: number;
}

export class MapJoystickKnob extends ControlBase {
  private readonly o: MapJoystickOptions;
  private readonly tilt = new THREE.Group();
  private readonly spin = new THREE.Group();
  private dragging = false;
  private moved = 0;
  private jx = 0;
  private jy = 0;
  private shownX = 0;
  private shownY = 0;
  private angle = 0;

  constructor(env: CockpitEnv, o: MapJoystickOptions) {
    super(env, o);
    this.o = o;
    const d = o.diameter ?? 0.017;
    this.object.add(this.tilt);
    this.tilt.add(this.spin);
    this.mesh(this.geo(`m2.mapknob.${d}`, () => knobGeometry({ style: 'knurled', diameter: d, height: 0.011 })), 'knobKnurled', this.spin);
    this.addHitBox(d * 1.2, d * 1.2, 0.02, 0, 0, 0.008);
  }

  protected stateText(): string {
    return this.dragging ? `PAN ${this.jx.toFixed(1)}, ${this.jy.toFixed(1)}` : 'turn RANGE, push POINTER, drag PAN';
  }

  onPointerDown(_p: ControlPointer): void {
    this.dragging = true;
    this.moved = 0;
    this.jx = 0;
    this.jy = 0;
  }

  onDrag(dx: number, dy: number): void {
    if (!this.dragging) return;
    this.moved += Math.abs(dx) + Math.abs(dy);
    this.jx = Math.max(-1, Math.min(1, this.jx + dx / 60));
    this.jy = Math.max(-1, Math.min(1, this.jy - dy / 60));
    if (this.moved >= 3) this.emit(this.o.joystickEvent, { x: this.jx, y: this.jy });
  }

  onPointerUp(_p: ControlPointer): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.moved < 3) {
      this.emit(this.o.pushEvent);
      this.playSound(COCKPIT_SOUNDS.knobPush);
    } else this.emit(this.o.joystickEvent, { x: 0, y: 0 });
    this.jx = 0;
    this.jy = 0;
  }

  onCancel(): void {
    if (this.dragging) this.emit(this.o.joystickEvent, { x: 0, y: 0 });
    this.dragging = false;
    this.jx = this.jy = 0;
  }

  onWheel(delta: number): void {
    if (delta === 0) return;
    const n = Math.round(Math.abs(delta)) || 1;
    this.emit(delta > 0 ? this.o.incEvent : this.o.decEvent, n);
    this.angle += Math.sign(delta) * n * (Math.PI / 12);
    this.playSound(COCKPIT_SOUNDS.knobDetent);
  }

  cursor(): string {
    return 'move';
  }

  override update(dt: number): void {
    this.shownX = smoothTo(this.shownX, this.jx, dt, 0.04, 1e-4);
    this.shownY = smoothTo(this.shownY, this.jy, dt, 0.04, 1e-4);
    this.tilt.rotation.set(-this.shownY * 0.25, this.shownX * 0.25, 0);
    this.spin.rotation.z = -this.angle;
  }
}
