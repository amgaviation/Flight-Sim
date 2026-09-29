/**
 * Cessna-style dual indicator: two independent half-scales in one 2-1/4 in
 * case, each needle pivoting near its side edge and sweeping up/down across
 * its own arc (172S: FUEL QTY L|R, OIL TEMP|OIL PRESS, SUCTION|AMPS,
 * EGT|FUEL FLOW; 172S POH §7 Figure 7-2 instrument panel items 1-4).
 * Either side may carry an adjustable reference needle (EGT peak index,
 * POH §7: "An index pointer which can be positioned manually is provided
 * for the pilot to mark the location of the peak").
 */
import type { SimVars } from '../../../core/SimVars';
import { NeedleDynamics, type NeedleDynamicsOptions } from '../../common/dynamics';
import { dialAngle } from '../../common/math';
import { AnalogGauge, cornerKnobPosition, type AnalogGaugeOptions } from '../AnalogGauge';
import { DIAL_BLACK, DIAL_WHITE, MARK_RED, type FaceCanvas } from '../face';
import { INSTRUMENT_SIZE } from '../geometry';
import type { ScaleBand } from './RoundGauge';

export interface TwinSide {
  /** Caption at the side (e.g. 'L', 'OIL TEMP'). */
  caption: string;
  /** Unit caption under the side scale ('°F', 'PSI', 'GAL'). */
  unit?: string;
  min: number;
  max: number;
  /** Tick values with optional labels (same length or empty). */
  ticks: readonly number[];
  labels?: readonly string[];
  minorStep?: number;
  bands?: readonly ScaleBand[];
  redlines?: readonly number[];
  /** Input: var * scale + offset, or a reader. */
  inputVar?: string;
  inputScale?: number;
  inputOffset?: number;
  read?: (vars: SimVars) => number;
  /** Needle rest value when unpowered (default slightly below min). */
  restValue?: number;
  /** Self-powered (thermocouple EGT, direct-reading suction/oil gauges): ignores the power var. */
  selfPowered?: boolean;
  dynamics?: NeedleDynamicsOptions;
  /** Adjustable reference needle driven by a var (knob in the lower corner of this side). */
  reference?: { var: string; step: number; name: string };
}

export interface TwinGaugeOptions extends AnalogGaugeOptions {
  left: TwinSide;
  right: TwinSide;
  /** Centre caption lines (e.g. ['FUEL QTY', 'GALLONS']). */
  captions?: readonly string[];
  /** Electrical supply for electric sides (V) and minimum working voltage. */
  powerVar?: string;
  minVolts?: number;
}

/** Sweep of each needle about horizontal (deg): min at -SWEEP (down), max at +SWEEP (up). EST from 172S dual-gauge photos. */
const SWEEP = 50;
/** Pivot offset from the centre and scale radius (fractions of the dial radius). */
const PIVOT_X = 0.86;
const ARC_R = 0.72;

export class TwinGauge extends AnalogGauge {
  readonly leftValue = { value: 0 };
  readonly rightValue = { value: 0 };
  private readonly o: TwinGaugeOptions;
  private readonly needles: [NeedleDynamics, NeedleDynamics];
  private readonly pivots: [ReturnType<AnalogGauge['addNeedle']>, ReturnType<AnalogGauge['addNeedle']>];
  private readonly refPivots: [ReturnType<AnalogGauge['addNeedle']> | null, ReturnType<AnalogGauge['addNeedle']> | null] = [null, null];
  private readonly sides: readonly [TwinSide, TwinSide];

  constructor(o: TwinGaugeOptions) {
    const corners: ('bl' | 'br')[] = [];
    if (o.left.reference) corners.push('bl');
    if (o.right.reference) corners.push('br');
    super({ size: INSTRUMENT_SIZE.ATI2, ...o, knobCorners: corners });
    this.o = o;
    this.sides = [o.left, o.right];
    const f = this.face();
    f.background(DIAL_BLACK);
    this.paintSide(f, o.left, -1);
    this.paintSide(f, o.right, 1);
    // Centre captions: first line at the top, second at the bottom (172S dual-gauge layout).
    const caps = o.captions ?? [];
    if (caps[0]) f.text(caps[0], 0, 0.84, 0.13, DIAL_WHITE);
    if (caps[1]) f.text(caps[1], 0, -0.84, 0.11, DIAL_WHITE);
    this.addDial(f);
    const R = this.dialR;
    const spec = { length: ARC_R + 0.1, tail: 0.1, width: 0.07, tipWidth: 0.02, style: 'pointer' as const };
    this.needles = [this.makeNeedle(o.left, -1), this.makeNeedle(o.right, 1)];
    this.pivots = [
      this.addNeedle(spec, { x: -PIVOT_X * R, z: this.depth * 0.45, hubRadius: R * 0.1 }),
      this.addNeedle(spec, { x: PIVOT_X * R, z: this.depth * 0.45, hubRadius: R * 0.1 }),
    ];
    for (let i = 0; i < 2; i++) AnalogGauge.setAngle(this.pivots[i], this.needles[i].value);
    const sides = [o.left, o.right] as const;
    for (let i = 0; i < 2; i++) {
      const s = sides[i];
      if (!s.reference) continue;
      const sign = i === 0 ? -1 : 1;
      const ref = s.reference;
      this.refPivots[i] = this.addNeedle({ length: ARC_R + 0.12, tail: 0.05, width: 0.035, tipWidth: 0.015, style: 'bar' }, { x: sign * PIVOT_X * R, z: this.depth * 0.3, hubRadius: 0, material: this.mats.hub });
      const pos = cornerKnobPosition(this.size, i === 0 ? 'bl' : 'br');
      this.addKnob({
        name: ref.name,
        x: pos.x,
        y: pos.y,
        radius: this.size * 0.07,
        length: 0.009,
        onTurn: (steps, fine) => {
          const v = this.vars.get(ref.var, (s.min + s.max) / 2) + steps * ref.step * (fine ? 0.2 : 1);
          this.vars.set(ref.var, Math.max(s.min, Math.min(s.max, v)));
        },
      });
    }
  }

  /** Dial angle (deg) of value v on side `sign` (-1 left, +1 right). */
  static sideAngle(side: Pick<TwinSide, 'min' | 'max'>, sign: -1 | 1, v: number): number {
    // Left pivot points right (90 deg); up = smaller angle. Right pivot points left (270 deg); up = larger angle.
    return sign < 0 ? dialAngle(v, side.min, side.max, 90 + SWEEP, 90 - SWEEP, false) : dialAngle(v, side.min, side.max, 270 - SWEEP, 270 + SWEEP, false);
  }

  private makeNeedle(s: TwinSide, sign: -1 | 1): NeedleDynamics {
    const a0 = TwinGauge.sideAngle(s, sign, s.min);
    const a1 = TwinGauge.sideAngle(s, sign, s.max);
    const rest = s.restValue ?? s.min - (s.max - s.min) * 0.06;
    return new NeedleDynamics({ omega: 6, zeta: 0.85, min: Math.min(a0, a1) - 8, max: Math.max(a0, a1) + 8, initial: TwinGauge.sideAngle(s, sign, rest), ...s.dynamics });
  }

  private paintSide(f: FaceCanvas, s: TwinSide, sign: -1 | 1): void {
    const cx = sign * PIVOT_X;
    const R = f.r;
    const c = f.ctx;
    const angle = (v: number): number => TwinGauge.sideAngle(s, sign, v);
    const pt = (v: number, rr: number): [number, number] => {
      const a = (angle(v) * Math.PI) / 180;
      return [f.X(cx + Math.sin(a) * rr), f.Y(Math.cos(a) * rr)];
    };
    // Bands.
    for (const b of s.bands ?? []) {
      const a0 = ((angle(b.from) - 90) * Math.PI) / 180;
      const a1 = ((angle(b.to) - 90) * Math.PI) / 180;
      c.beginPath();
      c.arc(f.X(cx), f.Y(0), (ARC_R + 0.06) * R, Math.min(a0, a1), Math.max(a0, a1));
      c.arc(f.X(cx), f.Y(0), (ARC_R - 0.02) * R, Math.max(a0, a1), Math.min(a0, a1), true);
      c.closePath();
      c.fillStyle = b.color;
      c.fill();
    }
    // Scale arc + ticks.
    const aMin = ((angle(s.min) - 90) * Math.PI) / 180;
    const aMax = ((angle(s.max) - 90) * Math.PI) / 180;
    c.beginPath();
    c.arc(f.X(cx), f.Y(0), (ARC_R + 0.06) * R, Math.min(aMin, aMax), Math.max(aMin, aMax));
    c.strokeStyle = DIAL_WHITE;
    c.lineWidth = 0.012 * R;
    c.stroke();
    const tick = (v: number, len: number, w: number, color: string): void => {
      const [x0, y0] = pt(v, ARC_R + 0.06);
      const [x1, y1] = pt(v, ARC_R + 0.06 - len);
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.strokeStyle = color;
      c.lineWidth = w * R;
      c.stroke();
    };
    if (s.minorStep) for (let v = s.min; v <= s.max + 1e-6; v += s.minorStep) tick(v, 0.07, 0.012, DIAL_WHITE);
    for (const v of s.ticks) tick(v, 0.13, 0.022, DIAL_WHITE);
    for (const r of s.redlines ?? []) tick(r, 0.16, 0.035, MARK_RED);
    const labels = s.labels ?? [];
    for (let i = 0; i < labels.length && i < s.ticks.length; i++) {
      if (!labels[i]) continue;
      const [lx, ly] = pt(s.ticks[i], ARC_R - 0.16);
      c.font = `bold ${Math.round(0.12 * R)}px ${f.family}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = DIAL_WHITE;
      c.fillText(labels[i], lx, ly);
    }
    f.text(s.caption, sign * 0.58, 0.6, 0.12, DIAL_WHITE);
    if (s.unit) f.text(s.unit, sign * 0.58, -0.6, 0.1, DIAL_WHITE);
  }

  private read(s: TwinSide): number {
    const powered = s.selfPowered || !this.o.powerVar || this.vars.get(this.o.powerVar, 28) >= (this.o.minVolts ?? 10);
    if (!powered) return s.restValue ?? s.min - (s.max - s.min) * 0.06;
    if (s.read) return s.read(this.vars);
    if (s.inputVar) return this.vars.get(s.inputVar) * (s.inputScale ?? 1) + (s.inputOffset ?? 0);
    return s.min;
  }

  protected updateGauge(dt: number): void {
    const o = this.o;
    const lv = this.read(o.left);
    const rv = this.read(o.right);
    this.leftValue.value = lv;
    this.rightValue.value = rv;
    AnalogGauge.setAngle(this.pivots[0], this.needles[0].update(TwinGauge.sideAngle(o.left, -1, lv), dt));
    AnalogGauge.setAngle(this.pivots[1], this.needles[1].update(TwinGauge.sideAngle(o.right, 1, rv), dt));
    const sides = this.sides;
    for (let i = 0; i < 2; i++) {
      const p = this.refPivots[i];
      const ref = sides[i].reference;
      if (p && ref) AnalogGauge.setAngle(p, TwinGauge.sideAngle(sides[i], i === 0 ? -1 : 1, this.vars.get(ref.var, (sides[i].min + sides[i].max) / 2)));
    }
  }

  tooltip(): string {
    const o = this.o;
    return `${this.name}: ${o.left.caption} ${this.leftValue.value.toFixed(1)} | ${o.right.caption} ${this.rightValue.value.toFixed(1)}`;
  }
}
