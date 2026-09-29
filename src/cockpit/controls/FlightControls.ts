/**
 * Yoke (control column + wheel) and rudder pedals.
 *
 * Both are animated from SimVars every frame (by default the pilot input
 * vars, so they also show hardware joystick/pedal input) and can be flown
 * with the mouse:
 *  - Yoke: drag the grips (pointer lock). Mouse right = roll right, mouse
 *    down = pull (nose up). While dragging, writes COCKPIT_VARS.yokeActive = 1
 *    and yokePitch / yokeRoll (-1..1); the input module uses these as the
 *    pitch/roll source (see docs/modules/cockpit.md). Released: all back to 0.
 *  - Pedals: drag sideways = rudder (COCKPIT_VARS.pedalsActive / pedalsYaw);
 *    press and hold the upper part of a pedal = toe brake
 *    (COCKPIT_VARS.toeBrakeLeft / Right = 1 while held).
 *
 * Yoke sub-controls (AP disconnect, trim rocker, PTT, CWS, chrono, ...) are
 * ordinary controls parented to anchor frames on the wheel so they move with
 * it; they are listed in `subControls`, registered by CockpitBuilder (so they
 * appear in build.controls) and updated by the host like any other control.
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
import { yokeColumnGeometry, yokeParts, type YokeAnchorName, type YokeStyle, type YokeStyleOpts } from '../geometry/yokes';
import { pedalGeometry, pedalTreadGeometry } from '../geometry/structure';
import { hitBox } from '../geometry/primitives';
import { smoothTo } from '../anim';

/** Controls that own other controls (registered together by the builder/runtime). */
export interface CompositeControl extends CockpitControl {
  readonly subControls: CockpitControl[];
  /** Meshes that should block pointer rays (columns, hubs). */
  readonly occluders?: THREE.Object3D[];
}

export type YokeSwitchSpec = { anchor: YokeAnchorName; offset?: [number, number, number]; rotDeg?: number } & (
  | { kind: 'button'; options: PushButtonOptions }
  | { kind: 'rocker'; options: RockerSwitchOptions }
  | { kind: 'toggle'; options: ToggleSwitchOptions }
);

export interface YokeOptions extends ControlOptions {
  style: YokeStyle;
  scale?: number;
  /** (Appended by citation-m2, additive.) Per-aircraft profile tweaks for the wheel geometry; omitted = unchanged. */
  styleOpts?: YokeStyleOpts;
  column?: {
    kind: 'translate' | 'pivot';
    /** Visible shaft length (translate) or hub-to-pivot distance (pivot), m. */
    length?: number;
    /** Translate: aft/forward travel (m). EST defaults 0.1 / 0.08 (Cessna 172 column). */
    travelAft?: number;
    travelFwd?: number;
    /** Pivot: aft/forward rotation (deg). EST defaults 12 / 10. */
    aftDeg?: number;
    fwdDeg?: number;
    radius?: number;
  };
  /** Wheel rotation at full roll input (deg). EST default 45 (cessna), 90 (jets). */
  rollDeg?: number;
  /** Animation sources (default input.pitch / input.roll). */
  pitchVar?: string;
  rollVar?: string;
  /** Pixels of drag for full deflection (default 220). */
  dragPxFull?: number;
  /** Also write input.pitch / input.roll directly while dragging. */
  writeInput?: boolean;
  switches?: YokeSwitchSpec[];
}

export class Yoke extends ControlBase implements CompositeControl {
  readonly pointerLock = true;
  readonly subControls: CockpitControl[] = [];
  readonly occluders: THREE.Object3D[] = [];
  readonly anchors: Record<YokeAnchorName, THREE.Object3D>;
  /** Wheel group (rotates with roll); add extra parts here. */
  readonly wheel = new THREE.Group();
  private readonly o: YokeOptions;
  private readonly columnPivot = new THREE.Group();
  private readonly rollRad: number;
  private readonly col: NonNullable<YokeOptions['column']>;
  private dragging = false;
  private dragPitch = 0;
  private dragRoll = 0;
  private pitch = 0;
  private roll = 0;

  constructor(env: CockpitEnv, o: YokeOptions) {
    super(env, o);
    this.o = o;
    // Moves as a whole: keep its parts (and sub-controls' static parts) out of static consolidation.
    this.object.userData.cockpitDynamic = true;
    const s = o.scale ?? 1;
    this.rollRad = THREE.MathUtils.degToRad(o.rollDeg ?? (o.style === 'cessna' ? 45 : 90));
    const col = o.column ?? { kind: o.style === 'cessna' ? 'translate' : 'pivot' };
    this.col = col;
    const colLen = col.length ?? (col.kind === 'translate' ? 0.25 : 0.55);
    const colR = col.radius ?? (col.kind === 'translate' ? 0.014 : 0.022);
    // Hierarchy: object -> columnPivot -> offset -> [column, wheel].
    const offset = new THREE.Group();
    if (col.kind === 'pivot') {
      this.columnPivot.position.set(0, -colLen, -colR * 1.5);
      offset.position.set(0, colLen, colR * 1.5);
    }
    this.object.add(this.columnPivot);
    this.columnPivot.add(offset);
    const colMesh = this.mesh(this.geo(`yoke.col.${col.kind}.${colLen}.${colR}`, () => yokeColumnGeometry(col.kind, colLen, colR)), col.kind === 'translate' ? 'chrome' : 'yoke', offset);
    this.occluders.push(colMesh);
    offset.add(this.wheel);
    // One parts build; the geometry cache adopts the meshes on first use.
    const pp = yokeParts(o.style, s, o.styleOpts);
    const adopted = new Set<THREE.BufferGeometry>();
    const adopt = (g: THREE.BufferGeometry) => () => {
      adopted.add(g);
      return g;
    };
    // styleOpts joins the cache key so a tweaked profile never collides with the default one.
    const key = `yoke.${o.style}.${s}` + (o.styleOpts ? `.${o.styleOpts.gripTop ?? 'd'}.${o.styleOpts.gripLean ?? 'd'}` : '');
    this.mesh(this.geo(`${key}.frame`, adopt(pp.frame)), 'yoke', this.wheel);
    this.mesh(this.geo(`${key}.grips`, adopt(pp.grips)), 'yokeGrip', this.wheel);
    const hub = this.mesh(this.geo(`${key}.hub`, adopt(pp.hub)), 'yoke', this.wheel);
    this.occluders.push(hub);
    for (const g of [pp.frame, pp.grips, pp.hub]) if (!adopted.has(g)) g.dispose();
    for (const b of pp.gripBoxes) {
      const hbx = hitBox(env.materials.get('hitbox'), b.w, b.h, b.d, b.x, b.y, b.z);
      hbx.rotation.z = b.rz;
      hbx.userData.hitPriority = -1;
      this.wheel.add(hbx);
      this.hitTargets.push(hbx);
    }
    // Anchors.
    const anchors = {} as Record<YokeAnchorName, THREE.Object3D>;
    const x = new THREE.Vector3();
    const y = new THREE.Vector3();
    const z = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (const [name, a] of Object.entries(pp.anchors) as [YokeAnchorName, (typeof pp.anchors)[YokeAnchorName]][]) {
      const obj = new THREE.Object3D();
      obj.name = `yokeAnchor:${name}`;
      obj.position.set(a.position[0], a.position[1], a.position[2]);
      z.set(a.normal[0], a.normal[1], a.normal[2]).normalize();
      y.set(...(a.up ?? [0, 1, 0]));
      if (Math.abs(y.dot(z)) > 0.95) y.set(0, 0, -1);
      x.crossVectors(y, z).normalize();
      y.crossVectors(z, x).normalize();
      m.makeBasis(x, y, z);
      obj.quaternion.setFromRotationMatrix(m);
      this.wheel.add(obj);
      anchors[name] = obj;
    }
    this.anchors = anchors;
    for (const sw of o.switches ?? []) this.addSwitch(sw);
  }

  protected stateText(): string {
    return `pitch ${(this.pitch * 100).toFixed(0)}%, roll ${(this.roll * 100).toFixed(0)}%`;
  }

  /** Adds a control on a grip anchor (moves with the wheel). Returns it. */
  addSwitch(sw: YokeSwitchSpec): CockpitControl {
    let c: CockpitControl;
    if (sw.kind === 'button') c = new PushButton(this.env, { style: 'small', ...sw.options });
    else if (sw.kind === 'rocker') c = new RockerSwitch(this.env, { width: 0.007, height: 0.014, ...sw.options });
    else c = new ToggleSwitch(this.env, { scale: 0.7, ...sw.options });
    const a = this.anchors[sw.anchor];
    c.object.position.set(...(sw.offset ?? [0, 0, 0]));
    c.object.rotation.z = THREE.MathUtils.degToRad(sw.rotDeg ?? 0);
    a.add(c.object);
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
    const tp = this.dragging ? this.dragPitch : v.get(this.o.pitchVar ?? INPUT.pitch);
    const tr = this.dragging ? this.dragRoll : v.get(this.o.rollVar ?? INPUT.roll);
    this.pitch = smoothTo(this.pitch, Math.max(-1, Math.min(1, tp)), dt, 0.04, 1e-5);
    this.roll = smoothTo(this.roll, Math.max(-1, Math.min(1, tr)), dt, 0.04, 1e-5);
    const col = this.col;
    if (col.kind === 'translate') {
      const travel = this.pitch >= 0 ? (col.travelAft ?? 0.1) : (col.travelFwd ?? 0.08);
      this.columnPivot.position.z = this.pitch * travel;
    } else {
      const deg = this.pitch >= 0 ? (col.aftDeg ?? 12) : (col.fwdDeg ?? 10);
      this.columnPivot.rotation.x = THREE.MathUtils.degToRad(this.pitch * deg);
    }
    this.wheel.rotation.z = -this.roll * this.rollRad;
    // Sub-controls are listed in build.controls and updated by the host.
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

export interface RudderPedalsOptions extends ControlOptions {
  /** 'hanging' (pivot above, transports/bizjets) or 'floor' (pivot at the floor, Cessna). */
  style: 'hanging' | 'floor';
  /** Distance between the left and right pedal centres (m). EST default 0.3. */
  spacing?: number;
  /** Fore/aft pedal travel at full rudder (m). EST default 0.09. */
  travel?: number;
  /** Toe-brake tilt at full brake (deg). Default 18. */
  toeTiltDeg?: number;
  /** Animation sources (defaults: input.yaw, input.brake_left/right). */
  yawVar?: string;
  brakeLeftVar?: string;
  brakeRightVar?: string;
  /** Pixels of sideways drag for full rudder (default 220). */
  dragPxFull?: number;
  padWidth?: number;
  padHeight?: number;
}

/** A pair of rudder pedals with toe brakes (one crew station). */
export class RudderPedals extends ControlBase {
  private readonly o: RudderPedalsOptions;
  private readonly pedals: { group: THREE.Group; pad: THREE.Group; hit: THREE.Mesh; side: -1 | 1 }[] = [];
  private yaw = 0;
  private brakeL = 0;
  private brakeR = 0;
  private dragging = false;
  private dragYaw = 0;
  private toe: -1 | 1 | 0 = 0;
  private moved = 0;

  constructor(env: CockpitEnv, o: RudderPedalsOptions) {
    super(env, o);
    this.o = o;
    this.object.userData.cockpitDynamic = true;
    const w = o.padWidth ?? 0.085;
    const h = o.padHeight ?? 0.16;
    const parts = this.geoCached(o.style, w, h);
    const spacing = o.spacing ?? 0.3;
    for (const side of [-1, 1] as const) {
      const group = new THREE.Group();
      group.position.x = (side * spacing) / 2;
      this.object.add(group);
      this.mesh(parts.arm, 'steel', group);
      const pad = new THREE.Group();
      // Pad pivots at its lower edge for toe braking.
      const padBottomY = o.style === 'hanging' ? -0.2 - h + 0.03 : 0;
      pad.position.y = padBottomY;
      group.add(pad);
      const padMesh = this.mesh(parts.pad, 'rubber', pad);
      padMesh.position.y = -padBottomY;
      const tread = this.mesh(parts.tread, 'aluminium', pad);
      tread.position.y = -padBottomY + (o.style === 'hanging' ? -0.2 - h / 2 + 0.03 : h / 2);
      const hit = hitBox(env.materials.get('hitbox'), w + 0.01, h + 0.01, 0.04, 0, -padBottomY + (o.style === 'hanging' ? -0.2 - h / 2 + 0.03 : h / 2), 0.01);
      pad.add(hit);
      this.hitTargets.push(hit);
      this.pedals.push({ group, pad, hit, side });
    }
  }

  protected stateText(): string {
    return `rudder ${(this.yaw * 100).toFixed(0)}%, brakes L ${(this.brakeL * 100).toFixed(0)}% R ${(this.brakeR * 100).toFixed(0)}%`;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || p.button !== 0) return;
    const ped = this.pedals.find((q) => q.hit === p.object);
    this.dragging = true;
    this.dragYaw = this.yaw;
    this.moved = 0;
    // Upper part of the pad = toe brake.
    if (ped) {
      const lp = this.localPoint(p, ped.hit);
      const h = this.o.padHeight ?? 0.16;
      if (lp.y > h * 0.1) {
        this.toe = ped.side;
        this.env.vars.set(ped.side < 0 ? COCKPIT_VARS.toeBrakeLeft : COCKPIT_VARS.toeBrakeRight, 1);
      }
    }
  }

  onDrag(dx: number, dy: number, _p?: ControlPointer): void {
    if (!this.dragging) return;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.moved < 4) return;
    this.dragYaw = Math.max(-1, Math.min(1, this.dragYaw + dx / (this.o.dragPxFull ?? 220)));
    this.env.vars.set(COCKPIT_VARS.pedalsActive, 1);
    this.env.vars.set(COCKPIT_VARS.pedalsYaw, this.dragYaw);
  }

  onPointerUp(_p?: ControlPointer): void {
    this.end();
  }

  onCancel(): void {
    this.end();
  }

  cursor(p: ControlPointer): string {
    const ped = this.pedals.find((q) => q.hit === p.object);
    if (ped && this.localPoint(p, ped.hit).y > (this.o.padHeight ?? 0.16) * 0.1) return 'pointer';
    return 'ew-resize';
  }

  override update(dt: number): void {
    const v = this.env.vars;
    const ty = this.dragging && v.get(COCKPIT_VARS.pedalsActive) ? this.dragYaw : v.get(this.o.yawVar ?? INPUT.yaw);
    const bl = Math.max(v.get(this.o.brakeLeftVar ?? INPUT.brakeLeft), v.get(COCKPIT_VARS.toeBrakeLeft));
    const br = Math.max(v.get(this.o.brakeRightVar ?? INPUT.brakeRight), v.get(COCKPIT_VARS.toeBrakeRight));
    this.yaw = smoothTo(this.yaw, Math.max(-1, Math.min(1, ty)), dt, 0.05, 1e-5);
    this.brakeL = smoothTo(this.brakeL, bl, dt, 0.05, 1e-4);
    this.brakeR = smoothTo(this.brakeR, br, dt, 0.05, 1e-4);
    const travel = this.o.travel ?? 0.09;
    const tilt = THREE.MathUtils.degToRad(this.o.toeTiltDeg ?? 18);
    for (const p of this.pedals) {
      // Right rudder: right pedal forward (-Z), left pedal aft (+Z).
      const disp = -p.side * this.yaw * travel;
      if (this.o.style === 'hanging') p.group.rotation.x = -Math.asin(Math.max(-0.9, Math.min(0.9, disp / 0.2)));
      else p.group.position.z = disp;
      p.pad.rotation.x = -tilt * (p.side < 0 ? this.brakeL : this.brakeR);
    }
  }

  private end(): void {
    if (!this.dragging) return;
    this.dragging = false;
    const v = this.env.vars;
    if (this.toe) v.set(this.toe < 0 ? COCKPIT_VARS.toeBrakeLeft : COCKPIT_VARS.toeBrakeRight, 0);
    this.toe = 0;
    v.set(COCKPIT_VARS.pedalsActive, 0);
    v.set(COCKPIT_VARS.pedalsYaw, 0);
  }

  private geoCached(style: 'hanging' | 'floor', w: number, h: number): { pad: THREE.BufferGeometry; arm: THREE.BufferGeometry; tread: THREE.BufferGeometry } {
    const key = `pedal.${style}.${w}.${h}`;
    const parts = pedalGeometry(style, w, h);
    const adopted = new Set<THREE.BufferGeometry>();
    const adopt = (g: THREE.BufferGeometry) => () => {
      adopted.add(g);
      return g;
    };
    const pad = this.geo(`${key}.pad`, adopt(parts.pad));
    const arm = this.geo(`${key}.arm`, adopt(parts.arm));
    const tread = this.geo(`${key}.tread`, () => pedalTreadGeometry(w, h));
    for (const g of [parts.pad, parts.arm]) if (!adopted.has(g)) g.dispose();
    return { pad, arm, tread };
  }
}
