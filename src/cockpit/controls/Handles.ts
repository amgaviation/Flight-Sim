/**
 * Pull handles, push-pull knobs and the 172-style fuel selector.
 *
 * TBarHandle - T-handles, D-rings, pull knobs and Boeing-style engine fire
 * handles: pull out, optionally rotate (lock, or discharge left/right while
 * held), optional pull lock (fire-warning solenoid) with an override var,
 * optional lamp inside the handle.
 *   Mouse: left click pulls (then, for 'lock' handles, rotates to lock); on a
 *   pulled handle left click pushes it back in, except 'discharge' handles
 *   where left press on the left/right half rotates that way while held;
 *   right click pushes in; wheel down pulls, wheel up pushes.
 *
 * PushPullKnob - Cessna-style push-pull controls (throttle, mixture with
 * lock button and vernier, carb heat, cabin heat/air). Drag down pulls out,
 * drag up pushes in; the wheel turns the vernier (up = in by `vernierStep`).
 *
 * FuelSelector - large rotary selector handle over a printed placard.
 */
import * as THREE from 'three';
import { INPUT } from '../../core/vars';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { LampColor, MaterialName } from '../materials';
import { ControlBase, type ControlOptions } from './ControlBase';
import { PullHandleLogic, type PullHandleOptions } from './logic/MiscLogic';
import { LeverLogic, type LeverDetent } from './logic/LeverLogic';
import { LegendFace } from './Annunciator';
import { SelectorKnob, type SelectorKnobOptions } from './RotaryKnob';
import { cylinderZ, merge, revolve, roundedBox, torusZ, transform } from '../geometry/primitives';
import { escutcheon, knobGeometry, type KnobCap } from '../geometry/knobs';
import { nowS, smoothTo } from '../anim';

export type TBarStyle = 'tbar' | 'ring' | 'fire' | 'knob' | 'lever';

export interface TBarHandleOptions extends ControlOptions {
  /** Var: valueIn when in, valueOut when pulled. */
  var: string;
  valueIn?: number;
  valueOut?: number;
  /** Rotation var: -1 / 0 / +1. */
  rotateVar?: string;
  style?: TBarStyle;
  rotate?: PullHandleOptions['rotate'];
  springIn?: boolean;
  /** Pull-out distance (m). Default 0.045 (0.022 for fire handles). */
  pullLength?: number;
  /** Rotation angle (deg). Default 90 (lock) / 40 (discharge). */
  rotateDeg?: number;
  /** Pulling is allowed only while this var is non-zero (or overrideVar is non-zero). */
  unlockVar?: string;
  overrideVar?: string;
  /** Lamp inside the handle (fire warning). */
  lightVar?: string;
  lightColor?: LampColor;
  /** Legend on the handle face. */
  legend?: string;
  /**
   * (Appended by g800, additive.) 'fire' style cap shape: 'stalk' = shaped stalk grip with a rounded
   * grip face (Gulfstream engine fire handles, G600 crop p_pedmid); default 'block' keeps the original box.
   * (Appended by global6000, additive.) 'round' = cylindrical round-grip T-handle on a narrow neck with the
   * lamp legend in the grip face (Bombardier FIRE DISCH handles, GX PTG 9-12).
   */
  fireCap?: 'block' | 'stalk' | 'round';
  /**
   * (Appended by g800, additive.) Explicit legend-face segments replacing the default single
   * `legend`/`lightVar` segment (e.g. a white L / R letter lit from annunciator power while the red
   * fire flood lights from the fire warning).
   */
  segments?: import('./Annunciator').LegendSegment[];
  material?: MaterialName | THREE.Material;
  scale?: number;
  /** 'tbar' style: grip bar width (m, before `scale`). Default 0.056. Appended (Cessna 172S wide parking-brake bar). */
  barWidth?: number;
}

export class TBarHandle extends ControlBase {
  readonly logic: PullHandleLogic;
  private readonly o: TBarHandleOptions;
  private readonly slide = new THREE.Group();
  private readonly turn = new THREE.Group();
  private pullAnim = 0;
  private rotAnim = 0;
  private face: LegendFace | null = null;
  private lastVar = NaN;
  private lastRot = NaN;

  constructor(env: CockpitEnv, o: TBarHandleOptions) {
    super(env, o);
    this.o = o;
    const style = o.style ?? 'tbar';
    this.logic = new PullHandleLogic({ rotate: o.rotate ?? (style === 'fire' ? 'discharge' : 'none'), springIn: o.springIn });
    if (o.unlockVar) {
      const u = o.unlockVar;
      const ov = o.overrideVar;
      this.logic.canPull = () => env.vars.get(u) !== 0 || (!!ov && env.vars.get(ov) !== 0);
    }
    const vin = o.valueIn ?? 0;
    this.initVar(o.var, vin);
    if (o.rotateVar) this.initVar(o.rotateVar, 0);
    this.syncFromVars();
    this.pullAnim = this.logic.pulled ? 1 : 0;
    this.rotAnim = this.logic.rotation;
    this.build(style);
    this.applyVisual();
  }

  protected stateText(): string {
    const L = this.logic;
    let s = L.pulled ? 'PULLED' : 'IN';
    if (L.rotateMode === 'lock' && L.locked) s += ', LOCKED';
    if (L.rotateMode === 'discharge' && L.rotation !== 0) s += L.rotation < 0 ? ', ROTATED L' : ', ROTATED R';
    if (!L.pulled && L.canPull && !L.canPull()) s += ' (locked)';
    return s;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || p.button === 1) return;
    const L = this.logic;
    if (p.button === 2) {
      this.push();
      return;
    }
    if (!L.pulled) {
      const r = L.pull(true);
      if (r === 'blocked') {
        this.playSound(COCKPIT_SOUNDS.leverGate);
        return;
      }
      if (r === 'pulled') {
        this.playSound(COCKPIT_SOUNDS.handlePull);
        if (L.rotateMode === 'lock') {
          L.rotate(1);
          this.playSound(COCKPIT_SOUNDS.handleRotate, 0.7);
        }
        this.publish();
      }
      return;
    }
    if (L.rotateMode === 'discharge') {
      const dir = this.localPoint(p).x < 0 ? -1 : 1;
      if (L.rotate(dir, true)) {
        this.playSound(COCKPIT_SOUNDS.handleRotate);
        this.publish();
      }
      return;
    }
    this.push();
  }

  onPointerUp(_p?: ControlPointer): void {
    if (this.logic.release()) {
      this.playSound(COCKPIT_SOUNDS.handlePush, 0.6);
      this.publish();
    }
  }

  onCancel(): void {
    this.onPointerUp();
  }

  onWheel(delta: number, _p?: ControlPointer): void {
    if (!this.enabled || delta === 0) return;
    if (delta < 0 && !this.logic.pulled) {
      if (this.logic.pull() === 'pulled') {
        this.playSound(COCKPIT_SOUNDS.handlePull);
        this.publish();
      }
    } else if (delta > 0) this.push();
  }

  override update(dt: number): void {
    this.syncFromVars();
    this.pullAnim = smoothTo(this.pullAnim, this.logic.pulled ? 1 : 0, dt, 0.05, 1e-4);
    this.rotAnim = smoothTo(this.rotAnim, this.logic.rotation, dt, 0.05, 1e-4);
    if (this.face) {
      const lit = this.o.lightVar ? this.env.vars.get(this.o.lightVar) !== 0 : false;
      this.face.update(dt, lit);
    }
    this.applyVisual();
  }

  override dispose(): void {
    this.face?.dispose();
    super.dispose();
  }

  private push(): void {
    if (this.logic.push()) {
      this.playSound(COCKPIT_SOUNDS.handlePush);
      this.publish();
    }
  }

  private publish(): void {
    const o = this.o;
    const v = this.logic.pulled ? (o.valueOut ?? 1) : (o.valueIn ?? 0);
    this.lastVar = v;
    this.writeVar(o.var, v);
    if (o.rotateVar) {
      this.lastRot = this.logic.rotation;
      this.writeVar(o.rotateVar, this.logic.rotation);
    }
  }

  private syncFromVars(): void {
    const o = this.o;
    const v = this.env.vars.get(o.var);
    const r = o.rotateVar ? this.env.vars.get(o.rotateVar) : this.logic.rotation;
    if (v === this.lastVar && r === this.lastRot) return;
    this.lastVar = v;
    this.lastRot = r;
    const vin = o.valueIn ?? 0;
    const vout = o.valueOut ?? 1;
    const pulled = Math.abs(v - vout) < Math.abs(v - vin) ? 1 : 0;
    this.logic.sync(pulled, r);
  }

  private applyVisual(): void {
    const style = this.o.style ?? 'tbar';
    const len = this.o.pullLength ?? (style === 'fire' ? 0.022 : 0.045);
    this.slide.position.z = this.pullAnim * len;
    const deg = this.o.rotateDeg ?? (this.logic.rotateMode === 'lock' ? 90 : 40);
    this.turn.rotation.z = -THREE.MathUtils.degToRad(deg) * this.rotAnim;
  }

  private build(style: TBarStyle): void {
    const s = this.o.scale ?? 1;
    const env = this.env;
    this.mesh(this.geo(`tbar.esc.${s}`, () => escutcheon(0.012 * s, 0.0045 * s, 0.003 * s)), 'steel', this.object, true);
    this.object.add(this.slide);
    this.slide.add(this.turn);
    const shaftLen = (this.o.pullLength ?? 0.045) + 0.012;
    this.mesh(this.geo(`tbar.shaft.${s}.${shaftLen}`, () => cylinderZ(0.0035 * s, 0.0035 * s, -shaftLen, 0.012 * s, 16)), 'chrome', this.turn);
    const mat = this.o.material ?? (style === 'fire' ? 'guardRed' : 'plasticBlack');
    const m = typeof mat === 'string' ? env.materials.get(mat) : mat;
    let faceZ = 0.03 * s;
    let faceW = 0.03 * s;
    let faceH = 0.012 * s;
    switch (style) {
      case 'tbar': {
        const bw = this.o.barWidth ?? 0.056;
        this.mesh(this.geo(`tbar.bar.${s}${bw === 0.056 ? '' : `.${bw}`}`, () => {
          const bar = roundedBox(bw * s, 0.013 * s, 0.014 * s, 0.006 * s, 3);
          transform(bar, 0, 0, 0.02 * s);
          return bar;
        }), m, this.turn);
        faceZ = 0.027 * s;
        faceW = 0.04 * s;
        faceH = 0.008 * s;
        break;
      }
      case 'ring': {
        this.mesh(this.geo(`tbar.ring.${s}`, () => {
          const t = torusZ(0.018 * s, 0.0035 * s, 10, 36);
          t.rotateX(Math.PI / 2);
          transform(t, 0, 0, 0.03 * s);
          const neck = cylinderZ(0.004 * s, 0.004 * s, 0.01 * s, 0.013 * s, 12);
          const g = merge([t, neck]);
          t.dispose();
          neck.dispose();
          return g;
        }), m, this.turn);
        faceZ = 0;
        break;
      }
      case 'fire': {
        if (this.o.fireCap === 'stalk') {
          // Shaped stalk grip: narrow neck rising into a rounded grip head with a slightly domed face.
          this.mesh(this.geo(`tbar.firestalk.${s}`, () => {
            const neck = roundedBox(0.03 * s, 0.02 * s, 0.02 * s, 0.006 * s, 2);
            transform(neck, 0, 0, 0.01 * s);
            const head = roundedBox(0.06 * s, 0.032 * s, 0.024 * s, 0.011 * s, 3);
            transform(head, 0, 0, 0.028 * s);
            const g = merge([neck, head]);
            neck.dispose();
            head.dispose();
            return g;
          }), m, this.turn);
          faceZ = 0.0402 * s;
          faceW = 0.046 * s;
          faceH = 0.02 * s;
          break;
        }
        if (this.o.fireCap === 'round') {
          // Round-grip T: a lateral cylinder grip on a narrow neck; the lamp legend sits in the grip face.
          this.mesh(this.geo(`tbar.fireround.${s}`, () => {
            const neck = roundedBox(0.022 * s, 0.018 * s, 0.016 * s, 0.005 * s, 2);
            transform(neck, 0, 0, 0.008 * s);
            const grip = cylinderZ(0.014 * s, 0.014 * s, -0.026 * s, 0.026 * s, 24);
            grip.rotateY(Math.PI / 2); // axis lateral (grip bar across the pull direction)
            transform(grip, 0, 0, 0.028 * s);
            const g = merge([neck, grip]);
            neck.dispose();
            grip.dispose();
            return g;
          }), m, this.turn);
          faceZ = 0.0422 * s;
          faceW = 0.044 * s;
          faceH = 0.019 * s;
          break;
        }
        this.mesh(this.geo(`tbar.fire.${s}`, () => {
          const body = roundedBox(0.072 * s, 0.03 * s, 0.026 * s, 0.006 * s, 3);
          transform(body, 0, 0, 0.018 * s);
          return body;
        }), m, this.turn);
        faceZ = 0.0312 * s;
        faceW = 0.062 * s;
        faceH = 0.022 * s;
        break;
      }
      case 'knob': {
        this.mesh(this.geo(`tbar.knob.${s}`, () => {
          const k = knobGeometry({ style: 'smooth', diameter: 0.028 * s, height: 0.014 * s });
          transform(k, 0, 0, 0.012 * s);
          return k;
        }), m, this.turn);
        faceZ = 0.0263 * s;
        faceW = 0.022 * s;
        faceH = 0.008 * s;
        break;
      }
      case 'lever': {
        this.mesh(this.geo(`tbar.lever.${s}`, () => {
          const a = roundedBox(0.012 * s, 0.05 * s, 0.012 * s, 0.005 * s, 2);
          transform(a, 0, -0.02 * s, 0.018 * s);
          const hub = cylinderZ(0.009 * s, 0.009 * s, 0.008 * s, 0.024 * s, 20);
          const g = merge([a, hub]);
          a.dispose();
          hub.dispose();
          return g;
        }), m, this.turn);
        faceZ = 0;
        break;
      }
    }
    if (this.o.segments || this.o.lightVar || (style === 'fire' && this.o.legend)) {
      this.face = new LegendFace(env, this.o.segments ?? [{ text: this.o.legend ?? '', color: this.o.lightColor ?? 'red', whenOn: true, style: 'field' }], faceW, faceH, 'stack', {
        intensity: 1.6,
        own: (mm) => this.own(mm),
      });
      this.face.group.position.z = faceZ;
      this.turn.add(this.face.group);
    } else if (this.o.legend && faceZ > 0) {
      const l = this.engrave(this.o.legend, 0, 0, { height: Math.min(0.0028, faceH * 0.45), weight: 700, zone: 'panel' }, this.turn, true);
      l.position.z = faceZ;
    }
    const hbW = style === 'fire' ? 0.078 : style === 'tbar' ? Math.max(0.06, (this.o.barWidth ?? 0.056) + 0.004) : 0.04;
    this.addHitBox(hbW * s, 0.04 * s, 0.04 * s, 0, 0, 0.02 * s, this.slide);
  }
}

export type PushPullStyle = 'throttle' | 'mixture' | 'carbheat' | 'cabin' | 'plain';

export interface PushPullKnobOptions extends ControlOptions {
  var: string;
  /** Var value fully in / fully out. Defaults 1 / 0 (throttle & mixture: in = more). */
  valueIn?: number;
  valueOut?: number;
  /** Travel (m). EST default 0.07. */
  travel?: number;
  style?: PushPullStyle;
  /** Wheel = vernier fine adjust (fraction of travel per notch, default 0.01). */
  vernierStep?: number;
  /** Mixture-style centre lock button (animated when moved coarsely). */
  lockButton?: boolean;
  /** Click toggles fully in/out (default true for carbheat/cabin/plain). */
  clickToggles?: boolean;
  detents?: LeverDetent[];
  /** Hardware axis (0..1, 1 = fully in by default). */
  axis?: { var: string; boundVar?: string; map?: (axis: number) => number };
  legend?: string;
  material?: MaterialName | THREE.Material;
  /** Pixels of drag for full travel (default 250). */
  dragPxFull?: number;
  /** Number of flutes on a 'throttle' / 'mixture' (fluted) cap (default: knob library default). Appended. */
  ridges?: number;
  /** Knob cap geometry override (default: 'fluted' for throttle / mixture, 'smooth' otherwise). Appended. */
  cap?: KnobCap;
}

/** Cessna-style push-pull control. Internally `logic.value` = fraction pulled out (0 = in, 1 = out). */
export class PushPullKnob extends ControlBase {
  readonly logic: LeverLogic;
  private readonly o: PushPullKnobOptions;
  private readonly slide = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly button: THREE.Object3D | null = null;
  private visual: number;
  private spinAngle = 0;
  private dragging = false;
  private moved = 0;
  private buttonAnim = 0;
  private lastVar: number;

  constructor(env: CockpitEnv, o: PushPullKnobOptions) {
    super(env, o);
    this.o = o;
    this.logic = new LeverLogic({ min: 0, max: 1, initial: 0, detents: o.detents });
    this.initVar(o.var, this.valueAt(0));
    this.logic.sync(this.fractionOf(env.vars.get(o.var)));
    this.lastVar = env.vars.get(o.var);
    this.visual = this.logic.value;
    const style = o.style ?? 'plain';
    const d = style === 'throttle' ? 0.032 : style === 'mixture' ? 0.028 : style === 'carbheat' ? 0.024 : 0.019;
    this.mesh(this.geo(`pp.esc.${d}`, () => escutcheon(d * 0.42, 0.0035, 0.0025)), 'steel', this.object, true);
    this.object.add(this.slide);
    this.slide.add(this.spin);
    const travel = o.travel ?? 0.07;
    this.mesh(this.geo(`pp.shaft.${travel}`, () => cylinderZ(0.0032, 0.0032, -travel, 0.006, 16)), 'chrome', this.spin);
    const mat = o.material ?? (style === 'mixture' ? 'knobRed' : 'knob');
    const ridges = o.ridges ?? 20;
    const cap: KnobCap = o.cap ?? (style === 'throttle' || style === 'mixture' ? 'fluted' : 'smooth');
    const knob = this.mesh(this.geo(`pp.knob.${style}.${d}${ridges === 20 ? '' : `.r${ridges}`}${o.cap ? `.${o.cap}` : ''}`, () => knobGeometry({ style: cap, diameter: d, height: d * 0.55, ridges })), typeof mat === 'string' ? env.materials.get(mat) : mat, this.spin);
    knob.position.z = 0.005;
    const faceZ = 0.005 + d * 0.55 * 1.02 + 0.0001;
    if (o.lockButton ?? style === 'mixture') {
      const b = this.mesh(this.geo(`pp.btn.${d}`, () => cylinderZ(d * 0.17, d * 0.16, 0, 0.003, 20)), 'knobGrey', this.spin);
      b.position.z = faceZ - 0.0012;
      this.button = b;
    }
    if (o.legend) {
      const l = this.engrave(o.legend, 0, this.button ? d * 0.3 : 0, { height: Math.min(0.0022, d * 0.1), weight: 700, zone: null }, this.spin, true);
      l.position.z = faceZ;
    }
    this.addHitBox(d * 1.15, d * 1.15, d * 0.7, 0, 0, 0.005 + d * 0.3, this.slide);
    this.applyVisual();
  }

  protected stateText(): string {
    return `${(100 * (1 - this.logic.value)).toFixed(0)}% in`;
  }

  get pointerLock(): boolean {
    return false;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || this.axisBound() || p.button === 1) return;
    this.dragging = true;
    this.moved = 0;
    this.logic.beginMotion(nowS());
  }

  onDrag(dx: number, dy: number, _p?: ControlPointer): void {
    if (!this.dragging) return;
    this.moved += Math.abs(dx) + Math.abs(dy);
    this.buttonAnim = 1;
    const r = this.logic.moveBy(dy / (this.o.dragPxFull ?? 250), nowS());
    if (r.entered) this.playSound(COCKPIT_SOUNDS.leverDetent, 0.6);
    this.publish();
  }

  onPointerUp(p: ControlPointer): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.logic.endMotion();
    this.buttonAnim = 0;
    const style = this.o.style ?? 'plain';
    const toggles = this.o.clickToggles ?? (style === 'carbheat' || style === 'cabin' || style === 'plain');
    if (this.moved < 3 && toggles) {
      const out = p.button === 2 ? false : this.logic.value < 0.5;
      this.logic.sync(out ? 1 : 0);
      this.playSound(out ? COCKPIT_SOUNDS.handlePull : COCKPIT_SOUNDS.handlePush);
    } else if (this.moved >= 3) this.playSound(COCKPIT_SOUNDS.leverSlide, 0.5);
    this.publish();
  }

  onCancel(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.logic.endMotion();
    this.buttonAnim = 0;
    this.publish();
  }

  onWheel(delta: number, _p?: ControlPointer): void {
    if (!this.enabled || this.axisBound() || delta === 0) return;
    const step = this.o.vernierStep ?? 0.01;
    this.logic.beginMotion(nowS());
    this.logic.moveBy(-Math.sign(delta) * step, nowS());
    this.logic.endMotion();
    this.spinAngle += Math.sign(delta) * THREE.MathUtils.degToRad(30);
    this.playSound(COCKPIT_SOUNDS.knobDetent, 0.4);
    this.publish();
  }

  cursor(_p?: ControlPointer): string {
    return this.axisBound() ? 'not-allowed' : 'ns-resize';
  }

  override update(dt: number): void {
    const o = this.o;
    if (this.axisBound() && o.axis) {
      const a = this.env.vars.get(o.axis.var);
      const f = o.axis.map ? o.axis.map(a) : 1 - Math.min(1, Math.max(0, a));
      if (this.logic.sync(f)) this.publish();
    } else if (!this.logic.moving) {
      const v = this.env.vars.get(o.var);
      if (v !== this.lastVar) {
        this.lastVar = v;
        this.logic.sync(this.fractionOf(v));
      }
    }
    this.visual = this.dragging ? this.logic.value : smoothTo(this.visual, this.logic.value, dt, 0.05, 1e-5);
    this.applyVisual();
    if (this.button) this.button.position.z = (this.button.userData.z0 ??= this.button.position.z) - this.buttonAnim * 0.0018;
  }

  private axisBound(): boolean {
    const a = this.o.axis;
    return !!a && this.env.vars.get(a.boundVar ?? INPUT.throttleBound) !== 0;
  }

  private valueAt(fraction: number): number {
    const vin = this.o.valueIn ?? 1;
    const vout = this.o.valueOut ?? 0;
    return vin + (vout - vin) * fraction;
  }

  private fractionOf(v: number): number {
    const vin = this.o.valueIn ?? 1;
    const vout = this.o.valueOut ?? 0;
    return vout === vin ? 0 : Math.min(1, Math.max(0, (v - vin) / (vout - vin)));
  }

  private publish(): void {
    const v = this.valueAt(this.logic.value);
    this.lastVar = v;
    this.writeVar(this.o.var, v);
  }

  private applyVisual(): void {
    this.slide.position.z = this.visual * (this.o.travel ?? 0.07);
    this.spin.rotation.z = -this.spinAngle;
  }
}

export interface FuelSelectorOptions extends Omit<SelectorKnobOptions, 'cap'> {
  /** Placard plate diameter (m). Default 0.12. */
  placardDiameter?: number;
  /** Sub-labels under each position label (e.g. '26.0 GAL'). */
  sublabels?: string[];
}

/**
 * Floor-mounted rotary fuel selector (Cessna 172S: LEFT / BOTH / RIGHT,
 * separate push-pull FUEL SHUTOFF; the POH positions are aircraft data).
 * Gated positions (e.g. OFF on some types) need a deliberate action.
 */
export class FuelSelector extends SelectorKnob {
  constructor(env: CockpitEnv, o: FuelSelectorOptions) {
    const pd = o.placardDiameter ?? 0.12;
    const subs = o.sublabels;
    super(env, {
      sound: COCKPIT_SOUNDS.fuelSelector,
      ...o,
      // Sub-labels (tank capacities) are engraved under each position name.
      positions: o.positions.map((p, i) => (subs?.[i] ? { ...p, display: `${p.display ?? p.label}\n${subs[i]}` } : p)),
      cap: 'wing',
      diameter: o.diameter ?? 0.05,
      height: o.height ?? 0.018,
      labelRadius: o.labelRadius ?? pd * 0.36,
      labelHeight: o.labelHeight ?? 0.0055,
      labelZone: o.labelZone ?? null,
      ticks: o.ticks ?? false,
      pointer: o.pointer ?? 'line',
    });
    // Placard disc (static) under the handle.
    const plate = this.mesh(
      this.geo(`fuelsel.plate.${pd}`, () =>
        revolve(
          [
            [0, 0.0015],
            [pd / 2 - 0.002, 0.0015],
            [pd / 2, 0.0008],
            [pd / 2, 0],
          ],
          64,
        ),
      ),
      'paintBlack',
      this.object,
      true,
    );
    plate.position.z = -0.0001;
    // Keep all labels above the placard.
    this.object.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.name.startsWith('label:')) c.position.z = Math.max(c.position.z, 0.0017);
    });
  }
}
