/**
 * Thumbwheels and trim wheels.
 *
 * Thumbwheel: a ribbed wheel protruding through a slot (dimmer thumbwheels,
 * cabin altitude/rate selectors, pitch-trim thumbwheels). Wheel/drag rolls
 * it; binds to a var (continuous or detented) and/or inc/dec events via
 * KnobLogic, like a knob channel.
 *
 * TrimWheel: large wheel whose rotation is proportional to the trim
 * position, so it spins whenever trim moves (manual or electric/autopilot),
 * with spoke "clack" sounds and an optional position indicator. Manual input
 * writes the trim var (or emits `manualEvent` with the delta instead).
 * Mouse: drag rolls the rim (drag down = top of the wheel toward you);
 * wheel notch = 1/24 rev (up = top of the wheel away from you); holding the
 * left/right button rolls continuously away/toward.
 */
import * as THREE from 'three';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { MaterialName } from '../materials';
import { ControlBase, type ControlOptions } from './ControlBase';
import { KnobLogic } from './logic/KnobLogic';
import { TrimWheelLogic } from './logic/MiscLogic';
import type { KnobChannelOptions } from './RotaryKnob';
import { cylinderZ, merge, revolve, roundedBox, transform } from '../geometry/primitives';
import { rockerFrameGeometry } from '../geometry/switches';
import { nowS, smoothTo } from '../anim';

export interface ThumbwheelOptions extends ControlOptions {
  channel: KnobChannelOptions;
  /** Wheel diameter / width (m). Defaults 0.022 / 0.008. */
  diameter?: number;
  width?: number;
  /** Protrusion above the surface as a fraction of the diameter (default 0.3). */
  exposure?: number;
  /** 'vertical' rolls up/down (axis along X); 'horizontal' rolls left/right. */
  orientation?: 'vertical' | 'horizontal';
  ribs?: number;
  material?: MaterialName | THREE.Material;
}

export class Thumbwheel extends ControlBase {
  readonly logic: KnobLogic;
  private readonly o: ThumbwheelOptions;
  private readonly wheel = new THREE.Group();
  private angle = 0;
  private target = 0;
  private dragAcc = 0;
  private lastVar: number;
  private spinGroup!: THREE.Group;

  constructor(env: CockpitEnv, o: ThumbwheelOptions) {
    super(env, o);
    this.o = o;
    const c = o.channel;
    this.logic =
      !c.var && !c.positions
        ? new KnobLogic({ min: 0, max: 1e6, step: 1, wrap: true })
        : new KnobLogic({ positions: c.positions, wrap: c.wrap, min: c.min, max: c.max, step: c.step, accel: c.accel, initial: c.initial });
    this.initVar(c.var, this.logic.value);
    if (c.var) this.logic.sync(env.vars.get(c.var));
    this.lastVar = c.var ? env.vars.get(c.var) : NaN;
    const d = o.diameter ?? 0.022;
    const w = o.width ?? 0.008;
    const exp = (o.exposure ?? 0.3) * d;
    const vertical = (o.orientation ?? 'vertical') === 'vertical';
    // Slot frame.
    this.mesh(this.geo(`thumb.frame.${w}.${d}.${vertical}`, () => (vertical ? rockerFrameGeometry(w + 0.001, d * 0.75) : rockerFrameGeometry(d * 0.75, w + 0.001))), 'bezel', this.object, true);
    this.wheel.position.z = exp - d / 2;
    if (!vertical) this.wheel.rotation.z = Math.PI / 2;
    this.object.add(this.wheel);
    const spin = new THREE.Group();
    this.wheel.add(spin);
    const ribs = o.ribs ?? 30;
    const g = this.geo(`thumb.wheel.${d}.${w}.${ribs}`, () => {
      // Revolve about Z, then turn the axis to X.
      const r = d / 2;
      const geom = revolve(
        [
          [0, -w / 2],
          [r * 0.97, -w / 2],
          [r, -w / 2 + w * 0.1],
          [r, w / 2 - w * 0.1],
          [r * 0.97, w / 2],
          [0, w / 2],
        ],
        ribs * 4,
        { count: ribs, depth: 0.06, zMin: -w / 2 + w * 0.12, zMax: w / 2 - w * 0.12, kind: 'ridge', blend: w * 0.05 },
      );
      geom.rotateY(Math.PI / 2);
      return geom;
    });
    const mat = o.material ?? 'knob';
    this.mesh(g, typeof mat === 'string' ? env.materials.get(mat) : mat, spin);
    // White index mark on the rim (shows rotation).
    const mark = this.mesh(this.geo(`thumb.mark.${d}.${w}`, () => roundedBox(w * 0.5, 0.0012, 0.0006, 0.0002, 1)), 'paintWhite', spin);
    mark.position.set(0, 0, d / 2 + 0.0001);
    this.spinGroup = spin;
    this.addHitBox(vertical ? w + 0.004 : d, vertical ? d : w + 0.004, 0.01, 0, 0, exp / 2);
  }

  protected stateText(): string {
    const c = this.o.channel;
    const v = this.logic.detented ? this.logic.label || String(this.logic.value) : c.var ? (c.format ? c.format(this.logic.value) : this.logic.value.toFixed(this.logic.step >= 1 ? 0 : 2)) : '';
    return c.label ? `${c.label} ${v}`.trim() : v;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled) return;
    this.dragAcc = 0;
    if (p.button === 0) this.roll(1, true);
    else if (p.button === 2) this.roll(-1, true);
  }

  onDrag(dx: number, dy: number): void {
    const vertical = (this.o.orientation ?? 'vertical') === 'vertical';
    this.dragAcc += vertical ? -dy : dx;
    while (Math.abs(this.dragAcc) >= 10) {
      const dir = this.dragAcc > 0 ? 1 : -1;
      this.dragAcc -= dir * 10;
      this.roll(dir, false);
    }
  }

  onWheel(delta: number): void {
    if (!this.enabled || delta === 0) return;
    this.roll(delta > 0 ? 1 : -1, false);
  }

  override update(dt: number): void {
    const c = this.o.channel;
    if (c.var) {
      const v = this.env.vars.get(c.var);
      if (v !== this.lastVar) {
        this.lastVar = v;
        this.logic.sync(v);
      }
    }
    this.angle = smoothTo(this.angle, this.target, dt, 0.03, 1e-5);
    this.spinGroup.rotation.x = -this.angle;
  }

  private roll(clicks: number, deliberate: boolean): void {
    const r = this.logic.turn(clicks, nowS(), { deliberate });
    if (r.clicks === 0) return;
    const c = this.o.channel;
    const signed = Math.sign(clicks) * r.clicks;
    if (c.var) {
      this.lastVar = this.logic.value;
      this.writeVar(c.var, this.logic.value);
    }
    if (signed > 0) this.emit(c.incEvent, signed);
    else this.emit(c.decEvent, -signed);
    this.target += THREE.MathUtils.degToRad((c.degPerClick ?? 12) * signed);
    this.playSound(c.sound === undefined ? COCKPIT_SOUNDS.knobDetent : c.sound, 0.6);
  }
}

export interface TrimWheelOptions extends ControlOptions {
  /** Trim position var (read to spin the wheel; written on manual input unless manualEvent is set). */
  var: string;
  min?: number;
  max?: number;
  /** Trim value change per wheel revolution. */
  perRev: number;
  /** Emit `{ delta }` on this event for manual input instead of writing the var. */
  manualEvent?: string;
  /** Rolling the top of the wheel away from the pilot (+Y) decreases the value (nose down). Default true. */
  forwardDecreases?: boolean;
  diameter?: number;
  thickness?: number;
  /** Protrusion above the mounting surface as a fraction of the diameter (default 0.5). */
  exposure?: number;
  /** Spokes (visible and counted for clack sounds). Default 5. */
  spokes?: number;
  /** White stripes painted on the rim (Boeing stabilizer trim wheels). */
  stripes?: boolean;
  /** Fold-out crank handle on the wheel face (Boeing). */
  handle?: boolean;
  material?: MaterialName | THREE.Material;
  /** Continuous roll rate while a button is held (rev/s). Default 0.8. */
  holdRevPerS?: number;
  /** Position indicator beside the wheel. */
  indicator?: {
    /** Indicator scale length (m) along Y and its offset (x, y, z) from the wheel centre on the surface. */
    length: number;
    offset: [number, number, number];
    /** Scale marks. */
    marks?: { value: number; label?: string }[];
    /** Green band (e.g. takeoff trim range). */
    band?: [number, number];
    /** Pointer moves toward +Y as the value increases (default true). */
    increasingUp?: boolean;
  };
}

export class TrimWheel extends ControlBase {
  readonly logic: TrimWheelLogic;
  private readonly o: TrimWheelOptions;
  private readonly spin = new THREE.Group();
  private pointer: THREE.Object3D | null = null;
  private toY: (v: number) => number = () => 0;
  private angle: number;
  private clackAngle: number;
  private hold: 0 | 1 | -1 = 0;
  private dragged = 0;
  private lastClack = 0;
  private readonly sign: number;

  constructor(env: CockpitEnv, o: TrimWheelOptions) {
    super(env, o);
    this.o = o;
    const min = o.min ?? -1;
    const max = o.max ?? 1;
    this.logic = new TrimWheelLogic({ min, max, perRev: o.perRev, initial: env.vars.has(o.var) ? env.vars.get(o.var) : 0 });
    this.initVar(o.var, this.logic.value);
    this.sign = o.forwardDecreases === false ? 1 : -1;
    this.angle = this.logic.angleOf(this.logic.value) * this.sign;
    this.clackAngle = this.angle;
    const d = o.diameter ?? 0.26;
    const t = o.thickness ?? 0.03;
    const exp = (o.exposure ?? 0.5) * d;
    // Wheel axis along X; centre below the surface.
    this.spin.position.z = exp - d / 2;
    this.object.add(this.spin);
    const spokes = o.spokes ?? 5;
    const g = this.geo(`trim.wheel.${d}.${t}.${spokes}`, () => trimWheelGeometry(d, t, spokes));
    const mat = o.material ?? 'plasticBlack';
    this.mesh(g, typeof mat === 'string' ? env.materials.get(mat) : mat, this.spin);
    if (o.stripes) {
      const sg = this.geo(`trim.stripes.${d}.${t}`, () => {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 4; i++) {
          const b = roundedBox(t * 1.02, 0.018, 0.0015, 0.0005, 1);
          transform(b, 0, 0, d / 2 + 0.0002);
          b.rotateX((i / 4) * Math.PI * 2);
          parts.push(b);
        }
        const m = merge(parts);
        for (const p of parts) p.dispose();
        return m;
      });
      this.mesh(sg, 'paintWhite', this.spin);
    }
    if (o.handle) {
      const hg = this.geo(`trim.handle.${d}.${t}`, () => {
        const arm = roundedBox(0.012, 0.01, d * 0.32, 0.004, 2);
        transform(arm, t / 2 + 0.008, 0, d * 0.22);
        const grip = cylinderZ(0.009, 0.009, 0, 0.05, 16);
        grip.rotateY(Math.PI / 2);
        transform(grip, t / 2 + 0.01, 0, d * 0.38);
        const m = merge([arm, grip]);
        arm.dispose();
        grip.dispose();
        return m;
      });
      this.mesh(hg, 'plasticGrey', this.spin);
    }
    // Hit box over the exposed rim.
    this.addHitBox(t + 0.02, d * 0.9, exp + 0.01, 0, 0, exp / 2);
    // Indicator.
    const ind = o.indicator;
    if (ind) {
      const grp = new THREE.Group();
      grp.position.set(ind.offset[0], ind.offset[1], ind.offset[2]);
      this.object.add(grp);
      const plate = this.mesh(this.geo(`trim.ind.plate.${ind.length}`, () => {
        const p = roundedBox(0.018, ind.length + 0.012, 0.003, 0.002, 2);
        p.translate(0, 0, 0.0015);
        return p;
      }), 'panelDark', grp, true);
      plate.name = 'trimIndicatorPlate';
      const toY = (v: number) => ((v - min) / (max - min) - 0.5) * ind.length * (ind.increasingUp === false ? -1 : 1);
      if (ind.band) {
        const y0 = toY(ind.band[0]);
        const y1 = toY(ind.band[1]);
        const b = this.env.labels.rect(0.004, Math.abs(y1 - y0), null, '#2fbf4a');
        b.position.set(-0.004, (y0 + y1) / 2, 0.0031);
        grp.add(b);
      }
      for (const m of ind.marks ?? []) {
        const y = toY(m.value);
        const tick = this.env.labels.rect(0.004, 0.0006);
        tick.position.set(-0.004, y, 0.0031);
        grp.add(tick);
        if (m.label) {
          const l = this.env.labels.text(m.label, { height: 0.0022, align: 'left' });
          l.position.set(0.0005, y, 0.0031);
          grp.add(l);
        }
      }
      const ptr = this.mesh(this.geo('trim.ind.ptr', () => {
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.lineTo(-0.005, 0.0025);
        s.lineTo(-0.005, -0.0025);
        s.closePath();
        const gg = new THREE.ShapeGeometry(s);
        return gg;
      }), 'paintWhite', grp);
      ptr.position.set(-0.0015, toY(this.logic.value), 0.0034);
      this.pointer = ptr;
      this.toY = toY;
    }
    this.applyVisual();
  }

  protected stateText(): string {
    return this.logic.value.toFixed(3);
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled) return;
    this.dragged = 0;
    if (p.button === 0) this.hold = 1;
    else if (p.button === 2) this.hold = -1;
  }

  onPointerUp(): void {
    this.hold = 0;
  }

  onCancel(): void {
    this.hold = 0;
  }

  onDrag(_dx: number, dy: number): void {
    this.dragged += Math.abs(dy);
    if (this.dragged > 4) this.hold = 0;
    // Drag down (dy > 0) pulls the top of the rim toward the pilot (-forward).
    const d = this.o.diameter ?? 0.26;
    const revs = -(dy * 0.00035) / (Math.PI * d); // ~0.35 mm of rim per pixel
    this.manual(revs);
  }

  onWheel(delta: number): void {
    if (!this.enabled || delta === 0) return;
    this.manual(delta / 24);
  }

  cursor(): string {
    return 'ns-resize';
  }

  override update(dt: number): void {
    if (this.hold !== 0) this.manual(this.hold * (this.o.holdRevPerS ?? 0.8) * dt);
    // Electric trim / autopilot moves spin the wheel too.
    this.logic.sync(this.env.vars.get(this.o.var));
    const target = this.logic.angleOf(this.logic.value) * this.sign;
    this.angle = smoothTo(this.angle, target, dt, 0.04, 1e-5);
    // Clack sounds per spoke passage (max one per frame, rate-limited).
    const spokes = this.o.spokes ?? 5;
    const n = TrimWheelLogic.spokesPassed(this.clackAngle, this.angle, spokes);
    this.lastClack += dt;
    if (n > 0) {
      this.clackAngle = this.angle;
      if (this.lastClack > 0.04) {
        this.lastClack = 0;
        this.playSound(COCKPIT_SOUNDS.trimWheel, Math.min(1, 0.5 + n * 0.25));
      }
    }
    this.applyVisual();
  }

  /** Manual input in wheel revolutions, positive = top of the wheel rolled away (+Y). */
  manual(revsForward: number): void {
    const dv = revsForward * this.o.perRev * this.sign;
    if (dv === 0) return;
    if (this.o.manualEvent) {
      this.emit(this.o.manualEvent, { delta: dv });
      return;
    }
    const applied = this.logic.turn(dv / this.o.perRev);
    if (applied !== 0) this.writeVar(this.o.var, this.logic.value);
  }

  private applyVisual(): void {
    // Positive `angle` rolls the top of the rim toward +Y (away from the pilot).
    this.spin.rotation.x = -this.angle;
    if (this.pointer) this.pointer.position.y = this.toY(this.logic.value);
  }
}

/** Trim wheel: rim torus-like band, hub and spokes, axis along X, centred at the origin. */
function trimWheelGeometry(d: number, t: number, spokes: number): THREE.BufferGeometry {
  const r = d / 2;
  const rim = revolve(
    [
      [r * 0.86, -t / 2],
      [r * 0.97, -t / 2],
      [r, -t * 0.3],
      [r, t * 0.3],
      [r * 0.97, t / 2],
      [r * 0.86, t / 2],
      [r * 0.84, 0],
      [r * 0.86, -t / 2],
    ],
    96,
    { count: 48, depth: 0.012, zMin: -t * 0.28, zMax: t * 0.28, kind: 'ridge' },
  );
  const hub = cylinderZ(r * 0.16, r * 0.16, -t * 0.6, t * 0.6, 24);
  const parts: THREE.BufferGeometry[] = [rim, hub];
  for (let i = 0; i < spokes; i++) {
    const s = roundedBox(t * 0.35, r * 0.72, t * 0.5, t * 0.12, 2);
    s.translate(0, r * 0.5, 0);
    s.rotateZ((i / spokes) * Math.PI * 2);
    parts.push(s);
  }
  const g = merge(parts);
  for (const p of parts) p.dispose();
  // Axis Z -> X.
  g.rotateY(Math.PI / 2);
  return g;
}
