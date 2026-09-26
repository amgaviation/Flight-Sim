/**
 * Cockpit controls specific to the Longitude build that the shared control
 * library does not provide.
 *
 * `GtcMapKnob`: the GTC 570 map knob with its joystick (Garmin G5000 CRG,
 * "GTC 570 controls": the lower-left knob turns for map range, pushes to
 * toggle the map pointer and deflects as a joystick to pan it). Mouse:
 * wheel / left-right click = range (inc / dec events), middle or Ctrl+left
 * click = push, drag = joystick deflection ({ x, y } in -1..1, re-centres
 * with { 0, 0 } on release).
 */
import * as THREE from 'three';
import type { ControlPointer } from '../../../cockpit/types';
import { COCKPIT_SOUNDS } from '../../../cockpit/types';
import type { CockpitEnv } from '../../../cockpit/env';
import { ControlBase, type ControlOptions } from '../../../cockpit/controls/ControlBase';
import { knobGeometry } from '../../../cockpit/geometry/knobs';

export interface GtcMapKnobOptions extends ControlOptions {
  incEvent: string;
  decEvent: string;
  pushEvent?: string;
  joystickEvent?: string;
  diameter?: number;
  /** Pixels of drag for full joystick deflection. */
  dragPxFull?: number;
}

export class GtcMapKnob extends ControlBase {
  private readonly o: GtcMapKnobOptions;
  private readonly cap = new THREE.Group();
  private angle = 0;
  private jx = 0;
  private jy = 0;
  private dragging = false;
  private dragged = false;
  private pressButton: 0 | 1 | 2 = 0;
  private ctrl = false;

  constructor(env: CockpitEnv, o: GtcMapKnobOptions) {
    super(env, o);
    this.o = o;
    const d = o.diameter ?? 0.017;
    this.object.add(this.cap);
    this.mesh(this.geo(`lon.gtcknob.${d}`, () => knobGeometry({ style: 'knurled', diameter: d, height: 0.014 })), 'knobKnurled', this.cap);
    this.addHitBox(d * 1.4, d * 1.4, 0.022, 0, 0, 0.011);
  }

  protected stateText(): string {
    return this.dragging && this.dragged ? `joystick ${this.jx.toFixed(1)}, ${this.jy.toFixed(1)}` : 'turn: range, push: pointer, drag: pan';
  }

  onPointerDown(p: ControlPointer): void {
    this.dragging = true;
    this.dragged = false;
    this.pressButton = p.button;
    this.ctrl = p.ctrl;
    this.jx = 0;
    this.jy = 0;
  }

  onPointerUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.dragged) {
      this.jx = 0;
      this.jy = 0;
      this.emit(this.o.joystickEvent, { x: 0, y: 0 });
      return;
    }
    if (this.pressButton === 1 || (this.pressButton === 0 && this.ctrl)) {
      this.emit(this.o.pushEvent);
      this.playSound(COCKPIT_SOUNDS.knobPush);
    } else this.turn(this.pressButton === 2 ? -1 : 1);
  }

  onCancel(): void {
    this.onPointerUp();
  }

  onDrag(dx: number, dy: number): void {
    const full = this.o.dragPxFull ?? 60;
    this.jx = Math.max(-1, Math.min(1, this.jx + dx / full));
    this.jy = Math.max(-1, Math.min(1, this.jy - dy / full));
    if (Math.abs(this.jx) + Math.abs(this.jy) > 0.05) this.dragged = true;
    if (this.dragged) this.emit(this.o.joystickEvent, { x: this.jx, y: this.jy });
  }

  onWheel(delta: number): void {
    this.turn(delta > 0 ? 1 : -1, Math.abs(Math.round(delta)) || 1);
  }

  /** One or more detent clicks (+ = clockwise, range increase). */
  turn(dir: 1 | -1, clicks = 1): void {
    this.emit(dir > 0 ? this.o.incEvent : this.o.decEvent, clicks);
    this.angle -= dir * clicks * (15 * Math.PI) / 180;
    this.playSound(COCKPIT_SOUNDS.knobDetent);
  }

  override update(dt: number): void {
    const k = 1 - Math.exp(-dt * 25);
    this.cap.rotation.z += (this.angle - this.cap.rotation.z) * k;
    // Joystick tilt while deflected.
    this.cap.rotation.x += (-this.jy * 0.25 - this.cap.rotation.x) * k;
    this.cap.rotation.y += (this.jx * 0.25 - this.cap.rotation.y) * k;
  }
}
