/**
 * Sidestick (side-console control stick) for fly-by-wire aircraft
 * (Gulfstream G500/G600/G700/G800 active control sidesticks, Airbus-style
 * passive sticks).
 *
 * Frame: the control's `object` stands on the console top (X right, Y up,
 * Z aft toward the pilot), pivoting at the boot.
 *
 * Animated from SimVars every frame (default input.pitch / input.roll, so a
 * hardware joystick shows on the stick). Active sidesticks can be back-driven:
 * while `backDriveWhenVar` is non-zero (e.g. ap.engaged) the stick follows
 * `backDrivePitchVar` / `backDriveRollVar` instead, and the two sticks in the
 * cockpit move together when both use the same source vars (electronic
 * cross-coupling, Gulfstream "active control sidestick").
 *   // SCOPE: no force-feel model (breakout, gradient, soft stop); the
 *   // back-drive is a position display only.
 *
 * Mouse flying works like the Yoke: drag the grip (pointer lock), mouse right
 * = roll right, mouse down = pull (nose up). While dragging it writes
 * COCKPIT_VARS.yokeActive = 1 and yokePitch / yokeRoll (-1..1), which the
 * input module uses as the pitch/roll source.
 *
 * Grip switches (AP disconnect / trim sync, pitch-roll trim hat, PTT, HUD
 * rocker ...) are ordinary controls on the grip anchors, listed in
 * `subControls` and registered by the cockpit builder like the Yoke's.
 */
import * as THREE from 'three';
import { INPUT } from '../../core/vars';
import type { CockpitControl, ControlPointer } from '../types';
import { COCKPIT_VARS } from '../types';
import type { CockpitEnv } from '../env';
import { ControlBase, type ControlOptions } from './ControlBase';
import { PushButton, type PushButtonOptions } from './PushButton';
import { RockerSwitch, type RockerSwitchOptions } from './RockerSwitch';
import { ToggleSwitch, type ToggleSwitchOptions } from './ToggleSwitch';
import type { CompositeControl } from './FlightControls';
import { hitBox, merge, roundedBox, transform } from '../geometry/primitives';
import { smoothTo } from '../anim';

/** Grip anchor points: top face (trim hat), thumb side (AP disc), front (trigger / PTT), outboard side (rocker). */
export type SidestickAnchorName = 'top' | 'thumb' | 'trigger' | 'side';

export type SidestickSwitchSpec = { anchor: SidestickAnchorName; offset?: [number, number, number]; rotDeg?: number } & (
  | { kind: 'button'; options: PushButtonOptions }
  | { kind: 'rocker'; options: RockerSwitchOptions }
  | { kind: 'toggle'; options: ToggleSwitchOptions }
);

export interface SidestickOptions extends ControlOptions {
  /** Which hand flies it: 'left' (captain, stick on the left console) or 'right' (first officer). Mirrors the thumb side. */
  hand: 'left' | 'right';
  /** Stick deflection at full pitch / roll input (deg). EST default 16 / 16 (Airbus A320 FCOM: 16 deg pitch, 20 deg roll; Gulfstream similar). */
  pitchDeg?: number;
  rollDeg?: number;
  /** Boot-to-grip-base height (m). EST default 0.085. */
  shaftLength?: number;
  /** Grip height (m). EST default 0.12. */
  gripHeight?: number;
  /** Grip forward cant (deg, top leans forward). EST default 12. */
  gripCantDeg?: number;
  /** Animation sources (default input.pitch / input.roll). */
  pitchVar?: string;
  rollVar?: string;
  /** Active sidestick back-drive: when this var is non-zero, animate from the back-drive vars. */
  backDriveWhenVar?: string;
  backDrivePitchVar?: string;
  backDriveRollVar?: string;
  /** Pixels of drag for full deflection (default 220). */
  dragPxFull?: number;
  /** Also write input.pitch / input.roll directly while dragging. */
  writeInput?: boolean;
  switches?: SidestickSwitchSpec[];
}

export class Sidestick extends ControlBase implements CompositeControl {
  readonly pointerLock = true;
  readonly subControls: CockpitControl[] = [];
  readonly occluders: THREE.Object3D[] = [];
  readonly anchors: Record<SidestickAnchorName, THREE.Object3D>;
  /** Moving part (shaft + grip); add extra parts here. */
  readonly stick = new THREE.Group();
  private readonly o: SidestickOptions;
  private readonly pitchRad: number;
  private readonly rollRad: number;
  private dragging = false;
  private dragPitch = 0;
  private dragRoll = 0;
  private pitch = 0;
  private roll = 0;

  constructor(env: CockpitEnv, o: SidestickOptions) {
    super(env, o);
    this.o = o;
    this.object.userData.cockpitDynamic = true;
    this.pitchRad = THREE.MathUtils.degToRad(o.pitchDeg ?? 16);
    this.rollRad = THREE.MathUtils.degToRad(o.rollDeg ?? 16);
    const shaft = o.shaftLength ?? 0.085;
    const gh = o.gripHeight ?? 0.12;
    const cant = THREE.MathUtils.degToRad(o.gripCantDeg ?? 12);
    const mir = o.hand === 'left' ? 1 : -1; // left hand: thumb on the right (+x) side of the grip

    // Static boot / bezel on the console.
    const boot = this.mesh(this.geo('sidestick.boot', () => transform(new THREE.CylinderGeometry(0.03, 0.045, 0.03, 24), 0, 0.015, 0)), 'rubber');
    this.occluders.push(boot);
    this.mesh(this.geo('sidestick.bezel', () => roundedBox(0.11, 0.008, 0.13, 0.01)), 'plasticBlack');

    this.object.add(this.stick);
    this.mesh(this.geo(`sidestick.shaft.${shaft}`, () => transform(new THREE.CylinderGeometry(0.011, 0.014, shaft, 16), 0, shaft / 2, 0)), 'yoke', this.stick);

    // Grip: a canted, slightly flattened ergonomic body with a palm rest flare at the base.
    const gripGroup = new THREE.Group();
    gripGroup.position.y = shaft;
    gripGroup.rotation.x = -cant; // top leans forward (-z)
    this.stick.add(gripGroup);
    const gripKey = `sidestick.grip.${gh}`;
    this.mesh(
      this.geo(gripKey, () =>
        merge([
          transform(roundedBox(0.042, gh, 0.05, 0.018, 4), 0, gh / 2, 0),
          transform(roundedBox(0.07, 0.018, 0.075, 0.008, 2), 0.004 * mir, 0.009, 0.006),
        ]),
      ),
      'yokeGrip',
      gripGroup,
    );
    const hb = hitBox(env.materials.get('hitbox'), 0.06, gh + 0.03, 0.07, 0, gh / 2, 0);
    hb.userData.hitPriority = -1;
    gripGroup.add(hb);
    this.hitTargets.push(hb);

    // Anchors (normal = local +z of the anchor frame, pointing out of the grip surface).
    const thumbX = 0.021 * mir; // left hand: thumb on the right (inboard) side of the grip
    const mk = (name: SidestickAnchorName, pos: [number, number, number], normal: [number, number, number]): THREE.Object3D => {
      const a = new THREE.Object3D();
      a.name = `sidestickAnchor:${name}`;
      a.position.set(...pos);
      const z = new THREE.Vector3(...normal).normalize();
      const y = Math.abs(z.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
      const x = new THREE.Vector3().crossVectors(y, z).normalize();
      y.crossVectors(z, x).normalize();
      a.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      gripGroup.add(a);
      return a;
    };
    this.anchors = {
      top: mk('top', [0, gh, 0], [0, 1, 0]),
      thumb: mk('thumb', [thumbX, gh * 0.8, 0.004], [mir, 0, 0.3]),
      trigger: mk('trigger', [0, gh * 0.62, -0.025], [0, 0, -1]),
      side: mk('side', [-thumbX, gh * 0.7, 0], [-mir, 0, 0]),
    };
    for (const sw of o.switches ?? []) this.addSwitch(sw);
  }

  protected stateText(): string {
    return `pitch ${(this.pitch * 100).toFixed(0)}%, roll ${(this.roll * 100).toFixed(0)}%`;
  }

  /** Adds a control on a grip anchor (moves with the stick). Returns it. */
  addSwitch(sw: SidestickSwitchSpec): CockpitControl {
    let c: CockpitControl;
    if (sw.kind === 'button') c = new PushButton(this.env, { style: 'small', ...sw.options });
    else if (sw.kind === 'rocker') c = new RockerSwitch(this.env, { width: 0.007, height: 0.014, ...sw.options });
    else c = new ToggleSwitch(this.env, { scale: 0.6, ...sw.options });
    c.object.position.set(...(sw.offset ?? [0, 0, 0]));
    c.object.rotation.z = THREE.MathUtils.degToRad(sw.rotDeg ?? 0);
    this.anchors[sw.anchor].add(c.object);
    this.subControls.push(c);
    return c;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || p.button !== 0) return;
    this.dragging = true;
    this.dragPitch = this.pitch;
    this.dragRoll = this.roll;
    this.publishDrag();
  }

  onDrag(dx: number, dy: number, _p?: ControlPointer): void {
    if (!this.dragging) return;
    const px = this.o.dragPxFull ?? 220;
    this.dragRoll = Math.max(-1, Math.min(1, this.dragRoll + dx / px));
    this.dragPitch = Math.max(-1, Math.min(1, this.dragPitch + dy / px));
    this.publishDrag();
  }

  onPointerUp(_p?: ControlPointer): void {
    this.endDrag();
  }

  onCancel(): void {
    this.endDrag();
  }

  cursor(_p?: ControlPointer): string {
    return 'move';
  }

  override update(dt: number): void {
    const v = this.env.vars;
    const o = this.o;
    let tp: number;
    let tr: number;
    if (this.dragging) {
      tp = this.dragPitch;
      tr = this.dragRoll;
    } else if (o.backDriveWhenVar && v.get(o.backDriveWhenVar) !== 0) {
      tp = o.backDrivePitchVar ? v.get(o.backDrivePitchVar) : 0;
      tr = o.backDriveRollVar ? v.get(o.backDriveRollVar) : 0;
    } else {
      tp = v.get(o.pitchVar ?? INPUT.pitch);
      tr = v.get(o.rollVar ?? INPUT.roll);
    }
    if (!Number.isFinite(tp)) tp = 0;
    if (!Number.isFinite(tr)) tr = 0;
    this.pitch = smoothTo(this.pitch, Math.max(-1, Math.min(1, tp)), dt, 0.04, 1e-5);
    this.roll = smoothTo(this.roll, Math.max(-1, Math.min(1, tr)), dt, 0.04, 1e-5);
    // Pull (+pitch) tilts the top aft (+z); right roll tilts the top right (+x).
    this.stick.rotation.set(this.pitch * this.pitchRad, 0, -this.roll * this.rollRad, 'XZY');
  }

  override dispose(): void {
    for (const c of this.subControls) c.dispose?.();
    super.dispose();
  }

  private publishDrag(): void {
    const v = this.env.vars;
    v.set(COCKPIT_VARS.yokeActive, 1);
    v.set(COCKPIT_VARS.yokePitch, this.dragPitch);
    v.set(COCKPIT_VARS.yokeRoll, this.dragRoll);
    if (this.o.writeInput) {
      v.set(INPUT.pitch, this.dragPitch);
      v.set(INPUT.roll, this.dragRoll);
    }
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    const v = this.env.vars;
    v.set(COCKPIT_VARS.yokeActive, 0);
    v.set(COCKPIT_VARS.yokePitch, 0);
    v.set(COCKPIT_VARS.yokeRoll, 0);
    if (this.o.writeInput) {
      v.set(INPUT.pitch, 0);
      v.set(INPUT.roll, 0);
    }
  }
}
