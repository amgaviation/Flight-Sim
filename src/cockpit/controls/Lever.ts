/**
 * Levers: thrust/power levers, flap handles, speedbrake handles, condition /
 * fuel cutoff levers, reverse levers.
 *
 * Mouse:
 *  - drag (left or right button): moves the lever; mouse up / forward =
 *    toward `max` (use `dragInvert` to flip). Soft detents are magnetic;
 *    gates stop the lever - release and drag again to lift it over.
 *  - click (press + release without dragging): left = next detent toward
 *    max, right = toward min (or one `step` when there is no detent that
 *    way). A click deliberately lifts over a gate.
 *  - wheel: one detent (or `step`) per notch; stops at gates, a pause and
 *    another notch passes.
 * Hardware axis: when `axis.boundVar` (default input.throttle_axis_bound) is
 * non-zero, the lever follows `axis.var` (mapped by `axis.map`) and ignores
 * the mouse.
 *
 * Vars: writes `var` = lever output (physical position, or the nearest
 * detent value for discrete levers). Follows external writes when not being
 * dragged (autothrottle back-driving, state presets).
 */
import * as THREE from 'three';
import type { SimVars } from '../../core/SimVars';
import { INPUT } from '../../core/vars';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { MaterialName } from '../materials';
import { ControlBase, type ControlOptions } from './ControlBase';
import { LeverLogic, type LeverDetent, type LeverMove } from './logic/LeverLogic';
import { leverArmGeometry, leverKnobGeometry, quadrantSlotGeometry, type LeverKnobStyle } from '../geometry/levers';
import { nowS, smoothTo } from '../anim';

export type LeverTravel = { kind: 'arc'; minDeg: number; maxDeg: number; pivotDepth?: number } | { kind: 'linear'; length: number };

export interface LeverAxisBinding {
  /** Hardware axis var (e.g. INPUT.throttle(1)), 0..1. */
  var: string;
  /** Var that is non-zero while the axis is bound (default input.throttle_axis_bound). */
  boundVar?: string;
  /** Axis (0..1) -> lever value. Default: linear to [min, max]. */
  map?: (axis: number) => number;
}

export interface LeverOptions extends ControlOptions {
  var: string;
  min?: number;
  max?: number;
  initial?: number;
  detents?: LeverDetent[];
  discrete?: boolean;
  softWidth?: number;
  /** Wheel step for continuous levers (value units). */
  step?: number;
  /** Travel geometry (default arc -30..+30 deg about a pivot 0.05 m below the surface). */
  travel?: LeverTravel;
  /** Arm length from the pivot to the knob (m). Default 0.11. */
  armLength?: number;
  armWidth?: number;
  armThickness?: number;
  knob?: LeverKnobStyle;
  knobScale?: number;
  /**
   * (Appended by g800, additive.) Custom knob geometry factory replacing the `knob` style geometry;
   * built centred on the arm tip, extending +Z, adopted by the environment cache under `key`
   * (must be unique per shape). Used for the Gulfstream piggy-back reverser paddles.
   */
  knobGeometry?: { key: string; build: () => THREE.BufferGeometry };
  knobMaterial?: MaterialName | THREE.Material;
  armMaterial?: MaterialName | THREE.Material;
  /** Quadrant slot cover around the lever (default true). */
  slot?: boolean | { width?: number; plateWidth?: number };
  /** Engraved detent labels beside the slot. */
  detentLabels?: 'left' | 'right' | false;
  labelHeight?: number;
  axis?: LeverAxisBinding;
  /** Dynamic travel limits (interlocks), evaluated every frame. */
  limit?: (vars: SimVars) => [number, number];
  /** Pixels of drag for full travel. Default 300. */
  dragPxFull?: number;
  dragInvert?: boolean;
  /** Use horizontal mouse motion instead of vertical. */
  dragAxis?: 'x' | 'y';
  pointerLock?: boolean;
  format?: (v: number) => string;
}

export class Lever extends ControlBase {
  readonly logic: LeverLogic;
  readonly pointerLock: boolean;
  private readonly o: LeverOptions;
  private readonly pivot = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly travel: LeverTravel;
  private visual: number;
  private lift = 0;
  private dragMoved = 0;
  private dragging = false;
  private blockedSounded = false;
  private lastVar: number;
  private liftUntil = 0;

  /**
   * The moving arm group (panel frame of the arm: +z along the arm toward the
   * knob at z = armLength). Aircraft attach handle-mounted controls here
   * (TO/GA, A/T disconnect buttons); give their hit targets a higher
   * `userData.hitPriority` than the lever's own hit boxes (0).
   */
  get handle(): THREE.Group {
    return this.arm;
  }

  constructor(env: CockpitEnv, o: LeverOptions) {
    super(env, o);
    this.o = o;
    this.pointerLock = o.pointerLock ?? false;
    const min = o.min ?? 0;
    const max = o.max ?? 1;
    this.logic = new LeverLogic({ min, max, initial: o.initial ?? min, detents: o.detents, discrete: o.discrete, softWidth: o.softWidth, step: o.step });
    this.travel = o.travel ?? { kind: 'arc', minDeg: -30, maxDeg: 30, pivotDepth: 0.05 };
    this.initVar(o.var, this.logic.output);
    this.logic.sync(env.vars.get(o.var));
    this.lastVar = env.vars.get(o.var);
    this.visual = this.logic.value;
    this.build();
    this.applyVisual();
  }

  protected stateText(): string {
    const L = this.logic;
    const d = L.label();
    const v = this.o.format ? this.o.format(L.output) : L.output.toFixed(2);
    const bound = this.axisBound() ? ' (hardware axis)' : '';
    return (d ? `${d}${this.o.format ? ` (${v})` : ''}` : v) + bound;
  }

  /** Current output value. */
  get value(): number {
    return this.logic.output;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || this.axisBound() || p.button === 1) return;
    this.dragging = true;
    this.dragMoved = 0;
    this.blockedSounded = false;
    this.logic.beginMotion(nowS());
    if (this.logic.detent?.kind === 'gate') this.liftUntil = nowS() + 0.25;
  }

  onDrag(dx: number, dy: number, _p: ControlPointer): void {
    if (!this.dragging) return;
    const along = (this.o.dragAxis ?? 'y') === 'y' ? -dy : dx;
    const px = this.o.dragPxFull ?? 300;
    const delta = ((this.logic.max - this.logic.min) * along * (this.o.dragInvert ? -1 : 1)) / px;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    if (delta === 0) return;
    this.handleMove(this.logic.moveBy(delta, nowS()));
  }

  onPointerUp(p: ControlPointer): void {
    if (!this.dragging) return;
    this.dragging = false;
    const L = this.logic;
    if (this.dragMoved < 3) {
      // A click: deliberate one-detent step.
      L.endMotion();
      this.handleMove(L.stepDetent(p.button === 2 ? -1 : 1, nowS(), true, true));
    } else {
      const before = L.output;
      L.endMotion();
      if (L.output !== before || this.env.vars.get(this.o.var) !== L.output) this.publish();
    }
  }

  onCancel(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.logic.endMotion();
    this.publish();
  }

  onWheel(delta: number, _p?: ControlPointer): void {
    if (!this.enabled || this.axisBound() || delta === 0) return;
    this.blockedSounded = false;
    this.handleMove(this.logic.stepDetent(delta > 0 ? 1 : -1, nowS(), false));
  }

  cursor(_p?: ControlPointer): string {
    return this.axisBound() ? 'not-allowed' : 'grab';
  }

  override update(dt: number): void {
    const L = this.logic;
    const o = this.o;
    if (o.limit) {
      const [lo, hi] = o.limit(this.env.vars);
      const before = L.output;
      L.setLimits(lo, hi);
      if (L.output !== before) this.publish();
    }
    if (this.axisBound() && o.axis) {
      const a = this.env.vars.get(o.axis.var);
      const target = o.axis.map ? o.axis.map(a) : L.min + (L.max - L.min) * Math.min(1, Math.max(0, a));
      if (L.sync(target)) this.publish();
    } else if (!L.moving) {
      const v = this.env.vars.get(o.var);
      if (v !== this.lastVar) {
        this.lastVar = v;
        L.sync(v);
      }
    }
    this.visual = this.dragging ? L.value : smoothTo(this.visual, L.value, dt, 0.05, 1e-5);
    const lifting = nowS() < this.liftUntil;
    this.lift = smoothTo(this.lift, lifting ? 1 : 0, dt, 0.03, 1e-4);
    this.applyVisual();
  }

  // ---------------------------------------------------------------------------

  private axisBound(): boolean {
    const a = this.o.axis;
    if (!a) return false;
    return this.env.vars.get(a.boundVar ?? INPUT.throttleBound) !== 0;
  }

  private handleMove(m: LeverMove): void {
    if (m.entered) {
      if (m.entered.kind === 'gate') this.liftUntil = nowS() + 0.2;
      this.playSound(COCKPIT_SOUNDS.leverDetent);
    }
    if (m.blockedBy && !this.blockedSounded) {
      this.blockedSounded = true;
      this.playSound(COCKPIT_SOUNDS.leverGate);
    }
    this.publish();
  }

  private publish(): void {
    const out = this.logic.output;
    this.lastVar = out;
    this.writeVar(this.o.var, out);
  }

  private angleOf(v: number): number {
    const t = this.travel;
    const f = (v - this.logic.min) / (this.logic.max - this.logic.min);
    if (t.kind === 'arc') return THREE.MathUtils.degToRad(t.minDeg + (t.maxDeg - t.minDeg) * f);
    return f;
  }

  private surfaceY(v: number): number {
    const t = this.travel;
    if (t.kind === 'arc') return (t.pivotDepth ?? 0.05) * Math.tan(this.angleOf(v));
    return -t.length / 2 + t.length * ((v - this.logic.min) / (this.logic.max - this.logic.min));
  }

  private applyVisual(): void {
    const t = this.travel;
    if (t.kind === 'arc') {
      this.pivot.rotation.x = -this.angleOf(this.visual);
      this.arm.position.z = this.lift * 0.004;
    } else {
      this.pivot.position.y = this.surfaceY(this.visual);
      this.arm.position.z = this.lift * 0.004;
    }
  }

  private build(): void {
    const o = this.o;
    const t = this.travel;
    const pivotDepth = t.kind === 'arc' ? (t.pivotDepth ?? 0.05) : 0;
    const armLen = o.armLength ?? 0.11;
    this.pivot.position.z = -pivotDepth;
    this.object.add(this.pivot);
    this.pivot.add(this.arm);
    const aw = o.armWidth ?? 0.011;
    const at = o.armThickness ?? 0.006;
    const am = o.armMaterial ?? 'aluminium';
    this.mesh(this.geo(`lever.arm.${armLen}.${aw}.${at}`, () => leverArmGeometry(armLen, aw, at)), typeof am === 'string' ? this.env.materials.get(am) : am, this.arm);
    const style = o.knob ?? 'throttle';
    const ks = o.knobScale ?? 1;
    const km = o.knobMaterial ?? (style === 'gear' ? 'knobWhite' : 'plasticBlack');
    const kg = o.knobGeometry;
    const knob = this.mesh(kg ? this.geo(kg.key, kg.build) : this.geo(`lever.knob.${style}.${ks}`, () => leverKnobGeometry(style, ks)), typeof km === 'string' ? this.env.materials.get(km) : km, this.arm);
    knob.position.z = armLen;
    // Hit box around the knob and the upper arm (moves with the lever).
    this.addHitBox(0.05 * ks, 0.04 * ks, 0.05 * ks, 0, 0, armLen + 0.012 * ks, this.arm);
    this.addHitBox(aw * 2, at * 3, armLen * 0.5, 0, 0, armLen * 0.7, this.arm);
    // Quadrant slot and labels (static).
    const y0 = this.surfaceY(this.logic.min);
    const y1 = this.surfaceY(this.logic.max);
    const slotLen = Math.abs(y1 - y0) + aw * 1.2;
    const cy = (y0 + y1) / 2;
    if (o.slot !== false) {
      const sw = (typeof o.slot === 'object' ? o.slot.width : undefined) ?? at * 1.6;
      const pw = (typeof o.slot === 'object' ? o.slot.plateWidth : undefined) ?? sw + 0.018;
      const plate = this.mesh(this.geo(`lever.slot.${slotLen.toFixed(4)}.${sw}.${pw}`, () => quadrantSlotGeometry(slotLen, sw, pw, 0.003)), 'panelDark', this.object, true);
      plate.position.y = cy;
    }
    if (o.detentLabels && o.detents) {
      const side = o.detentLabels === 'left' ? -1 : 1;
      const th = o.labelHeight ?? 0.0028;
      for (const d of o.detents) {
        if (!d.label) continue;
        this.engrave(d.label, side * (at * 0.8 + 0.014), this.surfaceY(d.value), { height: th, align: side < 0 ? 'right' : 'left', weight: 700 });
      }
    }
  }
}
