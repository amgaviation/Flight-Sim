/**
 * Rotary knobs: single or concentric (outer + inner), detented selectors or
 * continuous knobs/encoders, optional push function.
 *
 * Mouse:
 *  - wheel: rotate (up = clockwise). Over the inner knob, or with Shift held,
 *    the inner knob turns. Fast spinning accelerates continuous knobs.
 *  - left click: one detent clockwise; right click: one detent counter-
 *    clockwise (on the ring or cap that was clicked).
 *  - middle click or Ctrl+left click: push (PUSH SYNC / PUSH CRS / BARO STD).
 *  - drag: horizontal or vertical drag turns the knob (14 px per detent).
 *
 * Each channel binds to a var (absolute value, clamped or wrapped) and/or
 * inc/dec events (encoders; the event payload is the number of clicks,
 * always positive). Spring-return and gated detents are supported via
 * KnobLogic.
 */
import * as THREE from 'three';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { MaterialName } from '../materials';
import { ControlBase, type ControlOptions } from './ControlBase';
import { KnobLogic, type KnobAccel, type KnobPosition } from './logic/KnobLogic';
import { escutcheon, knobGeometry, type KnobCap } from '../geometry/knobs';
import { nowS, smoothTo } from '../anim';

export interface KnobChannelOptions {
  /** Var holding the absolute value. */
  var?: string;
  /** Encoder events (payload = clicks, > 0). */
  incEvent?: string;
  decEvent?: string;
  /** Detent positions (selector mode). */
  positions?: KnobPosition[];
  /** Visual angle per detent position (deg clockwise from 12 o'clock). Default 30 deg spacing centred on 12 o'clock. */
  angles?: number[];
  /** Continuous range and step (ignored with positions). */
  min?: number;
  max?: number;
  step?: number;
  wrap?: boolean;
  accel?: KnobAccel;
  initial?: number;
  /** Visual rotation per click for continuous knobs / encoders (deg, default 15 = 24 detents/rev). */
  degPerClick?: number;
  /** Continuous knob with a pointer: map [min, max] to these angles (deg), e.g. dimmers [-150, 150]. */
  angleRange?: [number, number];
  /** Tooltip value formatter. */
  format?: (v: number) => string;
  /** Channel name in the tooltip (e.g. 'HDG'). */
  label?: string;
  /** Detent sound override (null = silent). */
  sound?: string | null;
}

export interface KnobPushOptions {
  event?: string;
  /** Var = 1 while pushed (momentary) or toggled on each push. */
  var?: string;
  mode?: 'momentary' | 'toggle';
  label?: string;
}

export interface RotaryKnobOptions extends ControlOptions {
  outer: KnobChannelOptions;
  inner?: KnobChannelOptions;
  push?: KnobPushOptions;
  cap?: KnobCap;
  innerCap?: KnobCap;
  /** Outer knob diameter / height (m). Defaults 0.019 / 0.012 (0.023 / 0.009 when concentric). */
  diameter?: number;
  height?: number;
  innerDiameter?: number;
  innerHeight?: number;
  material?: MaterialName | THREE.Material;
  innerMaterial?: MaterialName | THREE.Material;
  /** Index mark on the cap (backlit engraved line/dot). Default 'line' for detent/angleRange knobs, 'none' otherwise. */
  pointer?: 'line' | 'dot' | 'none';
  /** Lighting zone of the index mark. */
  zone?: string | null;
  /** Pixels of drag per detent. Default 14. */
  dragPxPerClick?: number;
}

/** Runtime state of one knob channel (outer or inner). */
export interface Channel {
  o: KnobChannelOptions;
  logic: KnobLogic;
  group: THREE.Group;
  hit: THREE.Mesh | null;
  /** Visual angle (rad, clockwise positive) and its target. */
  angle: number;
  target: number;
  lastVar: number;
}

export class RotaryKnob extends ControlBase {
  readonly outer: Channel;
  readonly inner: Channel | null;
  protected readonly o: RotaryKnobOptions;
  private pushAnim = 0;
  private pushed = false;
  private pushToggled = false;
  private dragAcc = 0;
  private dragChannel: Channel | null = null;
  private held: Channel | null = null;
  private readonly chList: Channel[];

  constructor(env: CockpitEnv, o: RotaryKnobOptions) {
    super(env, o);
    this.o = o;
    const concentric = !!o.inner;
    const d = o.diameter ?? (concentric ? 0.023 : 0.019);
    const h = o.height ?? (concentric ? 0.009 : 0.012);
    const outerCap: KnobCap = o.cap ?? (concentric ? 'ring' : 'fluted');
    const outerGroup = new THREE.Group();
    this.object.add(outerGroup);
    const outerMat = this.matOf(o.material ?? (outerCap === 'knurled' ? 'knobKnurled' : outerCap === 'key' ? 'steel' : 'knob'));
    if (outerCap === 'key') {
      // Lock cylinder: escutcheon ring and keyway face (static).
      this.mesh(this.geo(`knob.keyesc.${d}`, () => escutcheon(d * 0.62, d * 0.3, 0.004)), 'chrome', this.object, true);
      this.mesh(this.geo(`knob.keyface.${d}`, () => knobGeometry({ style: 'smooth', diameter: d * 0.62, height: 0.0035 })), 'steel', this.object, true);
    }
    const innerD = o.innerDiameter ?? d * 0.6;
    const outerMesh = this.mesh(
      this.geo(`knob.${outerCap}.${d}.${h}.${concentric ? innerD : 0}`, () => knobGeometry({ style: outerCap, diameter: d, height: h, innerRadius: innerD / 2 + 0.0008 })),
      outerMat,
      outerGroup,
    );
    if (outerCap === 'key') outerMesh.position.z = 0.0035;
    this.outer = this.makeChannel(o.outer, outerGroup);
    let innerCh: Channel | null = null;
    if (o.inner) {
      const ih = o.innerHeight ?? h * 1.25;
      const ic: KnobCap = o.innerCap ?? 'fluted';
      const g = new THREE.Group();
      this.object.add(g);
      // Shaft between the rings.
      this.mesh(this.geo(`knob.shaft.${innerD}`, () => knobGeometry({ style: 'smooth', diameter: innerD * 0.55, height: h + 0.001 })), 'steel', this.object, true);
      const cap = this.mesh(this.geo(`knob.${ic}.${innerD}.${ih}`, () => knobGeometry({ style: ic, diameter: innerD, height: ih })), this.matOf(o.innerMaterial ?? (ic === 'knurled' ? 'knobKnurled' : 'knob')), g);
      cap.position.z = h + 0.0005;
      innerCh = this.makeChannel(o.inner, g);
      innerCh.hit = this.addHitBox(innerD + 0.002, innerD + 0.002, ih + 0.003, 0, 0, h + ih / 2 + 0.001);
      this.addPointer(o, innerCh, innerD, h + 0.0005 + ih * 1.01);
    } else {
      const long = outerCap === 'pointer' || outerCap === 'chicken-head' || outerCap === 'wing' || outerCap === 'bar';
      this.addPointer(o, this.outer, d, h * 1.02, long);
    }
    this.inner = innerCh;
    this.chList = innerCh ? [this.outer, innerCh] : [this.outer];
    // Outer hit box (below the inner one when concentric).
    const span = outerCap === 'chicken-head' ? d * 2.4 : outerCap === 'wing' ? d * 2.6 : outerCap === 'pointer' ? d * 1.6 : d;
    this.outer.hit = this.addHitBox(span + 0.002, span + 0.002, h + 0.003, 0, 0, h / 2);
    if (o.push?.var) this.initVar(o.push.var, 0);
    this.applyVisual();
  }

  protected stateText(): string {
    const parts: string[] = [this.channelText(this.outer)];
    if (this.inner) parts.push(this.channelText(this.inner));
    if (this.o.push?.mode === 'toggle' && this.o.push.var) parts.push(`${this.o.push.label ?? 'PUSH'} ${this.env.vars.get(this.o.push.var) ? 'ON' : 'OFF'}`);
    return parts.filter((s) => s).join(' | ');
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled) return;
    const ch = this.channelFor(p);
    this.dragAcc = 0;
    this.dragChannel = ch;
    if (p.button === 1 || (p.button === 0 && p.ctrl)) {
      this.doPush(true);
      return;
    }
    if (p.button === 0) this.turn(ch, 1, true, true);
    else if (p.button === 2) this.turn(ch, -1, true, true);
    this.held = ch;
  }

  onPointerUp(_p?: ControlPointer): void {
    this.endPress();
  }

  onCancel(): void {
    this.endPress();
  }

  onDrag(dx: number, dy: number, _p: ControlPointer): void {
    if (!this.enabled || !this.dragChannel || this.pushed) return;
    // Right/up = clockwise.
    this.dragAcc += Math.abs(dx) > Math.abs(dy) ? dx : -dy;
    const px = this.o.dragPxPerClick ?? 14;
    while (Math.abs(this.dragAcc) >= px) {
      const dir = this.dragAcc > 0 ? 1 : -1;
      this.dragAcc -= dir * px;
      this.turn(this.dragChannel, dir, false, true);
    }
  }

  onWheel(delta: number, p: ControlPointer): void {
    if (!this.enabled || delta === 0) return;
    const ch = this.channelFor(p);
    this.turn(ch, Math.round(delta) || Math.sign(delta), false, false);
  }

  cursor(p: ControlPointer): string {
    return this.inner && this.channelFor(p) === this.inner ? 'cell' : 'pointer';
  }

  /** Turns a channel programmatically (+ = clockwise clicks). */
  turnBy(clicks: number, inner = false): void {
    const ch = inner && this.inner ? this.inner : this.outer;
    this.turn(ch, clicks, true, false);
  }

  override update(dt: number): void {
    const list = this.chList;
    for (let i = 0; i < list.length; i++) {
      const ch = list[i];
      if (ch.logic.tick(dt)) this.publish(ch, 0);
      // Follow external var writes.
      if (ch.o.var) {
        const v = this.env.vars.get(ch.o.var);
        if (v !== ch.lastVar) {
          ch.lastVar = v;
          if (ch.logic.sync(v)) ch.target = this.targetAngle(ch, 0);
        }
      }
      ch.angle = smoothTo(ch.angle, ch.target, dt, 0.03, 1e-5);
    }
    this.pushAnim = smoothTo(this.pushAnim, this.pushed ? 1 : 0, dt, 0.015, 1e-4);
    this.applyVisual();
  }

  // ---------------------------------------------------------------------------

  /** Outer (and inner) channel states. */
  channels(): readonly Channel[] {
    return this.chList;
  }

  private matOf(m: MaterialName | THREE.Material): THREE.Material {
    return typeof m === 'string' ? this.env.materials.get(m) : m;
  }

  private makeChannel(o: KnobChannelOptions, group: THREE.Group): Channel {
    // Pure encoders (events only) count clicks on an unbounded wrapping scale.
    const encoder = !o.var && !o.positions;
    const logic = encoder
      ? new KnobLogic({ min: 0, max: 1e6, step: 1, wrap: true })
      : new KnobLogic({ positions: o.positions, wrap: o.wrap, min: o.min, max: o.max, step: o.step, accel: o.accel, initial: o.initial });
    if (o.var) {
      this.initVar(o.var, logic.value);
      logic.sync(this.env.vars.get(o.var));
    }
    const ch: Channel = { o, logic, group, hit: null, angle: 0, target: 0, lastVar: o.var ? this.env.vars.get(o.var) : NaN };
    ch.target = this.targetAngle(ch, 0);
    ch.angle = ch.target;
    return ch;
  }

  private addPointer(o: RotaryKnobOptions, ch: Channel, d: number, z: number, long = false): void {
    const hasAbsolute = !!ch.o.positions || !!ch.o.angleRange;
    const kind = o.pointer ?? (hasAbsolute ? 'line' : 'none');
    if (kind === 'none' || d <= 0) return;
    const zone = o.zone === undefined ? 'panel' : o.zone;
    const len = long ? d * 0.55 : d * 0.36;
    const m =
      kind === 'line'
        ? this.env.labels.rect(Math.max(0.0008, d * 0.07), len, zone, '#f4f4ee')
        : this.env.labels.rect(d * 0.12, d * 0.12, zone, '#f4f4ee');
    m.position.set(0, kind === 'line' ? (long ? d * 0.42 : d * 0.26) : d * 0.32, z);
    m.userData.cockpitStatic = false;
    ch.group.add(m);
  }

  private channelFor(p: ControlPointer): Channel {
    if (!this.inner) return this.outer;
    if (p.shift) return this.inner;
    return p.object === this.inner.hit ? this.inner : this.outer;
  }

  private channelText(ch: Channel): string {
    const o = ch.o;
    let v: string;
    if (ch.logic.detented) v = ch.logic.label || String(ch.logic.value);
    else if (o.var) v = o.format ? o.format(ch.logic.value) : formatStep(ch.logic.value, ch.logic.step);
    else v = '';
    return o.label ? `${o.label} ${v}`.trim() : v;
  }

  private turn(ch: Channel, clicks: number, deliberate: boolean, hold: boolean): void {
    const r = ch.logic.turn(clicks, nowS(), { deliberate, hold });
    if (r.clicks === 0) {
      if (r.blocked === 'gate') this.playSound(COCKPIT_SOUNDS.leverGate, 0.6);
      return;
    }
    const signed = Math.sign(clicks) * r.clicks;
    this.publish(ch, signed);
  }

  private publish(ch: Channel, clicks: number): void {
    const o = ch.o;
    if (o.var) {
      ch.lastVar = ch.logic.value;
      this.writeVar(o.var, ch.logic.value);
    }
    if (clicks > 0) this.emit(o.incEvent, clicks);
    else if (clicks < 0) this.emit(o.decEvent, -clicks);
    ch.target = this.targetAngle(ch, clicks);
    if (clicks !== 0 || ch.logic.detented) {
      const snd = o.sound === undefined ? (ch.logic.detented ? COCKPIT_SOUNDS.knobSelector : COCKPIT_SOUNDS.knobDetent) : o.sound;
      if (snd) this.playSound(snd, ch.logic.detented ? 1 : 0.7);
    }
  }

  private targetAngle(ch: Channel, clicks: number): number {
    const o = ch.o;
    const L = ch.logic;
    if (L.detented) {
      const n = L.positions.length;
      const deg = o.angles?.[L.index] ?? (L.index - (n - 1) / 2) * 30;
      if (L.wrap && o.angles === undefined) {
        // Continuous-rotation selector: accumulate so it never spins backwards.
        return ch.target + THREE.MathUtils.degToRad(clicks * (360 / n));
      }
      return THREE.MathUtils.degToRad(deg);
    }
    if (o.angleRange && o.var) {
      const f = L.fraction();
      return THREE.MathUtils.degToRad(o.angleRange[0] + (o.angleRange[1] - o.angleRange[0]) * f);
    }
    return ch.target + THREE.MathUtils.degToRad(clicks * (o.degPerClick ?? 15));
  }

  private doPush(down: boolean): void {
    const p = this.o.push;
    if (!p) return;
    if (down) {
      this.pushed = true;
      this.emit(p.event);
      if (p.var) {
        if (p.mode === 'toggle') {
          this.pushToggled = this.env.vars.get(p.var) === 0;
          this.writeVar(p.var, this.pushToggled ? 1 : 0);
        } else this.writeVar(p.var, 1);
      }
      this.playSound(COCKPIT_SOUNDS.knobPush);
    } else {
      this.pushed = false;
      if (p.var && p.mode !== 'toggle') this.writeVar(p.var, 0);
    }
  }

  private endPress(): void {
    if (this.pushed) this.doPush(false);
    if (this.held && this.held.logic.release()) this.publish(this.held, 0);
    this.held = null;
    this.dragChannel = null;
  }

  private applyVisual(): void {
    this.outer.group.rotation.z = -this.outer.angle;
    if (this.inner) this.inner.group.rotation.z = -this.inner.angle;
    const dz = -this.pushAnim * 0.0015;
    this.outer.group.position.z = dz;
    if (this.inner) this.inner.group.position.z = dz;
  }
}

function formatStep(v: number, step: number): string {
  const dec = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return v.toFixed(dec);
}

export interface SelectorKnobOptions extends Omit<RotaryKnobOptions, 'outer' | 'inner'> {
  var?: string;
  /**
   * Positions clockwise with labels; angles default to 30 deg spacing centred
   * on 12 o'clock. `display` overrides the engraved text (may contain '\n').
   */
  positions: (KnobPosition & { label: string; angle?: number; display?: string })[];
  initial?: number;
  wrap?: boolean;
  /** Label ring radius (m). Default diameter * 0.95. */
  labelRadius?: number;
  labelHeight?: number;
  /** Engraved tick marks between knob and labels. Default true. */
  ticks?: boolean;
  /** Label zone (default 'panel'). */
  labelZone?: string | null;
  /** Engraved title below the knob. */
  title?: string;
  incEvent?: string;
  decEvent?: string;
}

/**
 * Rotary selector with engraved position labels around it (e.g. magneto
 * OFF-R-L-BOTH-START, pressurization mode, wiper, ADF/VOR selectors).
 */
export class SelectorKnob extends RotaryKnob {
  constructor(env: CockpitEnv, o: SelectorKnobOptions) {
    const angles = o.positions.map((p, i) => p.angle ?? (i - (o.positions.length - 1) / 2) * 30);
    super(env, {
      ...o,
      cap: o.cap ?? 'pointer',
      outer: {
        var: o.var,
        positions: o.positions,
        angles,
        initial: o.initial,
        wrap: o.wrap,
        incEvent: o.incEvent,
        decEvent: o.decEvent,
      },
    });
    const d = o.diameter ?? 0.019;
    const radius = o.labelRadius ?? d * 0.95;
    const th = o.labelHeight ?? 0.0024;
    const zone = o.labelZone === undefined ? 'panel' : o.labelZone;
    const ring = env.labels.arc(
      o.positions.map((p, i) => ({ text: p.display ?? p.label, angleDeg: angles[i] })),
      radius + th * 0.4,
      { height: th, zone },
      o.ticks === false ? undefined : { inner: d * 0.62, outer: radius - th * 0.2, width: th * 0.16 },
    );
    ring.traverse((c) => (c.userData.cockpitStatic = true));
    this.object.add(ring);
    if (o.title) this.engrave(o.title, 0, -(radius + th * 2.2), { height: th, zone, weight: 700 });
  }
}
