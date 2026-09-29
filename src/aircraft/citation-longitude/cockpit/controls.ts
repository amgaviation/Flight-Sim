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
import { cylinderZ, extrude, roundedBox, sphere, torusZ } from '../../../cockpit/geometry/primitives';

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

/**
 * GMC 710 SPD knob FMS / MAN ring (AOPA 2021 photograph c_gs21: "FMS" and "MAN" either side of the SPD knob, the
 * knob itself "PUSH IAS MACH"). A two-position ring round the knob; selecting the other position emits the suite's
 * FMS/MAN toggle event (`G3K_EVENTS.spdPush`) and the ring follows `g3k.spd_fms`. Mouse: click / wheel = other side.
 */
export interface SpdModeRingOptions extends ControlOptions {
  event: string;
  stateVar: string;
  diameter?: number;
}

export class SpdModeRing extends ControlBase {
  private readonly o: SpdModeRingOptions;
  private readonly ring = new THREE.Group();
  private angle = 0;

  constructor(env: CockpitEnv, o: SpdModeRingOptions) {
    super(env, o);
    this.o = o;
    const d = o.diameter ?? 0.026;
    this.object.add(this.ring);
    this.mesh(this.geo(`lon.spdring.${d}`, () => torusZ(d / 2 - 0.0015, 0.0016, 10, 40)), 'knobGrey', this.ring);
    // Pointer tab at the top of the ring.
    this.mesh(this.geo(`lon.spdring.tab.${d}`, () => roundedBox(0.003, 0.004, 0.003, 0.0006, 1).translate(0, d / 2 + 0.0015, 0.0015)), 'knobGrey', this.ring);
    const hb = this.addHitBox(d + 0.006, d + 0.006, 0.004, 0, 0, 0.001);
    hb.userData.hitPriority = -1; // the SPD knob in the middle wins
  }

  protected stateText(): string {
    return this.env.vars.get(this.o.stateVar) >= 0.5 ? 'FMS' : 'MAN';
  }

  onPointerDown(p: ControlPointer): void {
    if (p.button === 1) return;
    this.emit(this.o.event);
    this.playSound(COCKPIT_SOUNDS.knobDetent);
  }

  onWheel(): void {
    this.emit(this.o.event);
    this.playSound(COCKPIT_SOUNDS.knobDetent);
  }

  override update(dt: number): void {
    const target = this.env.vars.get(this.o.stateVar) >= 0.5 ? 0.45 : -0.45; // FMS left, MAN right
    this.angle += (target - this.angle) * (1 - Math.exp(-dt * 20));
    this.ring.rotation.z = this.angle;
  }
}

/**
 * PITCH/ROLL DISCONNECT handle (AOPA 2021 photograph a21_006): a red triangular flag engraved "PULL", NORM with the
 * flag pointing right. Pull = both axes split (1); rotate up = PITCH RECONNECT (2); rotate down = ROLL RECONNECT (3);
 * push in = "PITCH/ROLL RECONNECT PUSH-RESET" (0). Mouse: left click at NORM pulls; with the handle out, wheel up /
 * down rotates to PITCH / ROLL RECONNECT; right click (or Ctrl+click) pushes it back in.
 */
export interface PitchRollHandleOptions extends ControlOptions {
  var: string;
}

export class PitchRollHandle extends ControlBase {
  private readonly o: PitchRollHandleOptions;
  private readonly flag = new THREE.Group();
  private out = 0;
  private rot = 0;

  constructor(env: CockpitEnv, o: PitchRollHandleOptions) {
    super(env, o);
    this.o = o;
    this.initVar(o.var, 0);
    this.object.add(this.flag);
    const shape = new THREE.Shape();
    shape.moveTo(-0.012, 0.013);
    shape.lineTo(0.042, 0.004);
    shape.quadraticCurveTo(0.046, 0, 0.042, -0.004);
    shape.lineTo(-0.012, -0.013);
    shape.quadraticCurveTo(-0.018, 0, -0.012, 0.013);
    this.mesh(this.geo('lon.prflag', () => extrude(shape, { depth: 0.006, bevel: 0.0012, bevelSegments: 2, curveSegments: 4, anchor: 'back0' })), 'knobRed', this.flag);
    this.mesh(this.geo('lon.prshaft', () => cylinderZ(0.005, 0.005, -0.03, 0.001, 16)), 'steel', this.flag);
    const pull = this.engrave('PULL', 0.012, 0, { height: 0.0075, weight: 800, color: '#ffffff', zone: null }, this.flag, true);
    pull.position.z = 0.0075;
    this.mesh(this.geo('lon.prbezel', () => cylinderZ(0.011, 0.011, 0, 0.0015, 24)), 'bezel', this.object, true);
    this.addHitBox(0.064, 0.03, 0.02, 0.014, 0, 0.008, this.flag);
  }

  protected stateText(): string {
    return ['NORM', 'PULLED (PITCH + ROLL DISCONNECTED)', 'PITCH RECONNECT', 'ROLL RECONNECT'][this.readVar(this.o.var)] ?? '';
  }

  private set(v: number): void {
    if (v === this.readVar(this.o.var)) return;
    this.writeVar(this.o.var, v);
    this.playSound(COCKPIT_SOUNDS.handleRotate);
  }

  onPointerDown(p: ControlPointer): void {
    const st = this.readVar(this.o.var);
    if (p.button === 2 || p.ctrl) this.set(0);
    else if (p.button === 0 && st === 0) this.set(1);
    else if (p.button === 0) this.set(st === 1 ? 2 : st === 2 ? 3 : 1);
  }

  onWheel(delta: number): void {
    const st = this.readVar(this.o.var);
    if (st === 0) return;
    this.set(delta > 0 ? 2 : 3);
  }

  override update(dt: number): void {
    const st = this.readVar(this.o.var);
    const k = 1 - Math.exp(-dt * 15);
    this.out += ((st === 0 ? 0 : 0.02) - this.out) * k;
    this.rot += ((st === 2 ? Math.PI / 2 : st === 3 ? -Math.PI / 2 : 0) - this.rot) * k;
    this.flag.position.z = this.out;
    this.flag.rotation.z = this.rot;
  }
}

/**
 * Eyeball air outlet (gasper) at the upper outboard corner of each PFD (Textron panel photograph, a21_004).
 * `var` 0 closed .. 1 open. Mouse: click toggles closed / open; wheel opens / closes in 25 % steps; drag aims the
 * eyeball (visual).
 */
export interface GasperOptions extends ControlOptions {
  var: string;
  diameter?: number;
}

export class Gasper extends ControlBase {
  private readonly o: GasperOptions;
  private readonly ball = new THREE.Group();
  private readonly vane = new THREE.Group();
  private aimX = 0;
  private aimY = 0;

  constructor(env: CockpitEnv, o: GasperOptions) {
    super(env, o);
    this.o = o;
    const d = o.diameter ?? 0.06;
    this.mesh(this.geo(`lon.gasper.ring.${d}`, () => torusZ(d / 2 - 0.004, 0.004, 10, 36)), 'bezelGloss', this.object, true);
    this.mesh(this.geo(`lon.gasper.well.${d}`, () => cylinderZ(d / 2 - 0.004, d / 2 - 0.004, -0.012, -0.002, 32)), 'panelDark', this.object, true);
    this.object.add(this.ball);
    this.mesh(this.geo(`lon.gasper.ball.${d}`, () => sphere(d * 0.36, 20, 14)), 'knob', this.ball);
    this.ball.add(this.vane);
    this.vane.position.z = d * 0.33;
    this.mesh(this.geo(`lon.gasper.vane.${d}`, () => cylinderZ(d * 0.2, d * 0.2, 0, 0.004, 20)), 'bezel', this.vane);
    this.addHitBox(d, d, 0.02, 0, 0, 0.004);
  }

  protected stateText(): string {
    const v = this.readVar(this.o.var);
    return v <= 0.001 ? 'CLOSED' : `OPEN ${Math.round(v * 100)} %`;
  }

  onPointerDown(p: ControlPointer): void {
    if (p.button === 1) return;
    this.writeVar(this.o.var, this.readVar(this.o.var) > 0.001 ? 0 : 1);
    this.playSound(COCKPIT_SOUNDS.knobDetent, 0.5);
  }

  onWheel(delta: number): void {
    const v = Math.max(0, Math.min(1, this.readVar(this.o.var) + (delta > 0 ? 0.25 : -0.25)));
    this.writeVar(this.o.var, v);
  }

  onDrag(dx: number, dy: number): void {
    this.aimX = Math.max(-0.5, Math.min(0.5, this.aimX + dx * 0.004));
    this.aimY = Math.max(-0.5, Math.min(0.5, this.aimY + dy * 0.004));
  }

  override update(): void {
    this.ball.rotation.set(this.aimY, this.aimX, 0);
    this.vane.rotation.z = this.readVar(this.o.var) * Math.PI * 0.5; // the outlet vane turns open
  }
}

/**
 * Sun visor on its rail above the side window (a18_002). SCOPE: shading state only (`var` 0 stowed / 1 deployed,
 * read by the crew-controls block). Mouse: click toggles; the tinted panel slides down / aft.
 */
export interface SunVisorOptions extends ControlOptions {
  var: string;
  width?: number;
  height?: number;
  material: THREE.Material;
}

export class SunVisor extends ControlBase {
  private readonly o: SunVisorOptions;
  private readonly panel = new THREE.Group();
  private pos = 0;

  constructor(env: CockpitEnv, o: SunVisorOptions) {
    super(env, o);
    this.o = o;
    const w = o.width ?? 0.26;
    const h = o.height ?? 0.14;
    this.object.add(this.panel);
    this.mesh(this.geo(`lon.visor.${w}.${h}`, () => roundedBox(w, h, 0.004, 0.01, 2).translate(0, -h / 2, 0.003)), o.material, this.panel);
    this.addHitBox(w, h, 0.02, 0, -h / 2, 0.005, this.panel);
  }

  protected stateText(): string {
    return this.readVar(this.o.var) >= 0.5 ? 'DEPLOYED' : 'STOWED';
  }

  onPointerDown(p: ControlPointer): void {
    if (p.button === 1) return;
    this.writeVar(this.o.var, this.readVar(this.o.var) >= 0.5 ? 0 : 1);
    this.playSound(COCKPIT_SOUNDS.toggle, 0.4);
  }

  override update(dt: number): void {
    const t = this.readVar(this.o.var) >= 0.5 ? 1 : 0;
    this.pos += (t - this.pos) * (1 - Math.exp(-dt * 8));
    this.panel.position.y = -this.pos * (this.o.height ?? 0.14) * 0.8;
  }
}
