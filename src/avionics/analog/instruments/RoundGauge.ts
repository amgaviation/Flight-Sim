/**
 * Generic single-needle round gauge (tachometer, suction, ammeter,
 * voltmeter, manifold pressure, oil gauges, ...). A scale definition paints
 * the dial once; the needle follows an input var through damped dynamics
 * and falls to its rest value when the gauge's electrical supply is lost
 * (electric gauges) — mechanical/pneumatic gauges leave `powerVar` unset.
 */
import type { SimVars } from '../../../core/SimVars';
import { NeedleDynamics, type NeedleDynamicsOptions } from '../../common/dynamics';
import { dialAngle, piecewise } from '../../common/math';
import { AnalogGauge, type AnalogGaugeOptions } from '../AnalogGauge';
import { DIAL_BLACK, DIAL_WHITE, MARK_RED, type FaceCanvas } from '../face';
import type { NeedleSpec } from '../geometry';

export interface ScaleBand {
  from: number;
  to: number;
  color: string;
  /** Radii (fractions of the dial) of the band; default 0.78..0.86. */
  inner?: number;
  outer?: number;
}

export interface RoundScale {
  min: number;
  max: number;
  /** Dial angles (deg clockwise from 12) of `min` and `max`. */
  startDeg: number;
  endDeg: number;
  /** Optional non-linear value -> angle table (overrides the linear mapping). */
  table?: { v: readonly number[]; a: readonly number[] };
  majorStep: number;
  minorStep: number;
  /** Values that carry numbers (default every major tick). */
  labelStep?: number;
  /** Label text = value / labelDivisor (e.g. 100 for RPM x100). */
  labelDivisor?: number;
  labelSize?: number;
  bands?: readonly ScaleBand[];
  redlines?: readonly number[];
  /** Caption lines drawn in the middle/lower part of the dial. */
  captions?: readonly string[];
  /** Value where the needle rests unpowered / at zero input (mechanical stop). */
  restValue?: number;
}

export interface RoundGaugeOptions extends AnalogGaugeOptions {
  scale: RoundScale;
  /** Input var and linear conversion (value = var * scale + offset) ... */
  inputVar?: string;
  inputScale?: number;
  inputOffset?: number;
  /** ... or a custom reader (created once; must not allocate). */
  read?: (vars: SimVars) => number;
  /** Electrical supply (V); below `minVolts` the needle drops to `restValue`. Unset = self-powered/mechanical. */
  powerVar?: string;
  minVolts?: number;
  needle?: NeedleSpec;
  dynamics?: NeedleDynamicsOptions;
  /** Extra painting on the dial after the scale (logos, sub-scales, windows). */
  paint?: (f: FaceCanvas) => void;
  /** The dial has see-through windows (transparent pixels painted by `paint`). */
  windows?: boolean;
  /** Tooltip value formatting. */
  unit?: string;
  decimals?: number;
}

export const DEFAULT_NEEDLE: NeedleSpec = { length: 0.84, tail: 0.18, width: 0.07, tipWidth: 0.02, style: 'pointer' };

export class RoundGauge extends AnalogGauge {
  readonly scale: RoundScale;
  readonly needle: NeedleDynamics;
  /** Latest displayed value (after dynamics, in scale units). */
  value = 0;
  protected readonly pivot: ReturnType<AnalogGauge['addNeedle']>;
  private readonly opts: RoundGaugeOptions;

  constructor(o: RoundGaugeOptions) {
    super(o);
    this.opts = o;
    this.scale = o.scale;
    const sc = o.scale;
    const rest = sc.restValue ?? sc.min;
    const a0 = this.angleOf(sc.min);
    const a1 = this.angleOf(sc.max);
    this.needle = new NeedleDynamics({
      omega: 9,
      zeta: 0.7,
      min: Math.min(a0, a1) - 6,
      max: Math.max(a0, a1) + 6,
      initial: this.angleOf(rest),
      ...o.dynamics,
    });
    this.value = rest;
    const f = this.face();
    this.paintScale(f);
    o.paint?.(f);
    this.addDial(f, 0, this.dialR, this.object, o.windows ?? false);
    this.pivot = this.addNeedle(o.needle ?? DEFAULT_NEEDLE, { z: this.depth * 0.45 });
    AnalogGauge.setAngle(this.pivot, this.needle.value);
  }

  /** Dial angle (deg) of a scale value (unclamped). */
  angleOf(v: number): number {
    const sc = this.scale;
    if (sc.table) return piecewise(sc.table.v, sc.table.a, v);
    return dialAngle(v, sc.min, sc.max, sc.startDeg, sc.endDeg, false);
  }

  /** Raw input value before dynamics (override for special gauges). */
  protected readInput(): number {
    const o = this.opts;
    if (o.powerVar && this.vars.get(o.powerVar, 28) < (o.minVolts ?? 10)) return this.scale.restValue ?? this.scale.min;
    if (o.read) return o.read(this.vars);
    if (o.inputVar) return this.vars.get(o.inputVar) * (o.inputScale ?? 1) + (o.inputOffset ?? 0);
    return this.scale.restValue ?? this.scale.min;
  }

  protected updateGauge(dt: number): void {
    const v = this.readInput();
    const a = this.needle.update(this.angleOf(v), dt);
    AnalogGauge.setAngle(this.pivot, a);
    this.value = v;
  }

  tooltip(): string {
    const d = this.opts.decimals ?? 0;
    return `${this.name}: ${this.value.toFixed(d)}${this.opts.unit ? ` ${this.opts.unit}` : ''}`;
  }

  /** Paints bands, ticks, labels, redlines and captions. */
  protected paintScale(f: FaceCanvas): void {
    const sc = this.scale;
    f.background(DIAL_BLACK);
    const ang = (v: number): number => this.angleOf(v);
    for (const b of sc.bands ?? []) f.band(ang(b.from), ang(b.to), b.inner ?? 0.78, b.outer ?? 0.86, b.color);
    f.ticks(sc.min, sc.max, sc.minorStep, ang, 0.8, 0.9, 0.012);
    f.ticks(sc.min, sc.max, sc.majorStep, ang, 0.74, 0.9, 0.022);
    const ls = sc.labelStep ?? sc.majorStep;
    const div = sc.labelDivisor ?? 1;
    for (let v = sc.min; v <= sc.max + ls * 1e-6; v += ls) {
      const t = v / div;
      f.label(Number.isInteger(t) ? String(t) : t.toFixed(1), ang(v), 0.6, sc.labelSize ?? 0.15, DIAL_WHITE);
    }
    for (const r of sc.redlines ?? []) f.tick(ang(r), 0.72, 0.94, 0.03, MARK_RED);
    const caps = sc.captions ?? [];
    for (let i = 0; i < caps.length; i++) f.text(caps[i], 0, -0.3 - i * 0.14, 0.11, DIAL_WHITE);
  }
}
