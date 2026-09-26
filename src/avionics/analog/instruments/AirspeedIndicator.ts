/**
 * Airspeed indicator (pitot-static, no power) with true-airspeed ring.
 *
 * Cessna 172S POH Rev 4: §2 Figure 2-2 markings — white arc 40-85 KIAS
 * (full-flap operating range, Vso..Vfe), green arc 48-129 KIAS (Vs1..Vno),
 * yellow arc 129-163 KIAS (caution), red line 163 KIAS (Vne). §7 "Airspeed
 * Indicator": calibrated in knots, TAS window: "rotate the lower left knob
 * until pressure altitude aligns with outside air temperature in the twelve
 * o'clock window. True airspeed ... can now be read in the lower window".
 *
 * The TAS ring is a circular slide rule (see models/tasRing.ts); its setting
 * (TAS/IAS factor k) is stored in `tasRingVar` so it survives state saves.
 * Reads `adc1.ias_kt` (pitot/static failures propagate). The dial's
 * non-linear angle table is EST from 172S dial photographs.
 */
import { clamp } from '../../../core/math';
import { NeedleDynamics } from '../../common/dynamics';
import { piecewise } from '../../common/math';
import { AnalogGauge, cornerKnobPosition, type AnalogGaugeOptions } from '../AnalogGauge';
import { DIAL_BLACK, DIAL_WHITE, MARK_GREEN, MARK_RED, MARK_WHITE, MARK_YELLOW, type FaceCanvas } from '../face';
import { oatMarkDeg, paMarkDeg, ringRotationDeg } from '../models/tasRing';
import { ANALOG_VARS } from '../vars';

export interface AirspeedMarkings {
  whiteArc: [number, number];
  greenArc: [number, number];
  yellowArc: [number, number];
  redline: number;
}

/** 172S POH Figure 2-2. */
export const C172S_ASI_MARKINGS: AirspeedMarkings = {
  whiteArc: [40, 85],
  greenArc: [48, 129],
  yellowArc: [129, 163],
  redline: 163,
};

export interface AirspeedIndicatorOptions extends Omit<AnalogGaugeOptions, 'knobCorners'> {
  iasVar?: string;
  tasRingVar?: string;
  markings?: AirspeedMarkings;
  /** Dial value/angle table (kt -> deg clockwise from 12). */
  table?: { v: readonly number[]; a: readonly number[] };
  /** Speed at which the TAS ring is exact (kt). EST 110 (172S cruise). */
  tasReferenceKt?: number;
}

/** EST: 172S dial geometry (0 kt at 12 o'clock, 40 kt ~1 o'clock, 160 kt ~9 o'clock). */
export const C172S_ASI_TABLE = {
  v: [0, 40, 60, 80, 100, 120, 140, 160, 180, 200],
  a: [0, 28, 68, 112, 156, 197, 236, 272, 305, 334],
} as const;

export class AirspeedIndicator extends AnalogGauge {
  readonly needle: NeedleDynamics;
  ias = 0;
  private readonly pivot: ReturnType<AnalogGauge['addNeedle']>;
  private readonly ring: ReturnType<AnalogGauge['addDial']>;
  private readonly iasVar: string;
  private readonly ringVar: string;
  private readonly table: { v: readonly number[]; a: readonly number[] };
  private readonly S: number;

  constructor(o: AirspeedIndicatorOptions) {
    super({ name: 'Airspeed', ...o, knobCorners: ['bl'] });
    this.iasVar = o.iasVar ?? ANALOG_VARS.ias;
    this.ringVar = o.tasRingVar ?? ANALOG_VARS.asiTasRing;
    this.table = o.table ?? C172S_ASI_TABLE;
    const m = o.markings ?? C172S_ASI_MARKINGS;
    // Slide-rule scale: S = v * da/dv at the reference speed (deg per unit ln).
    const vr = o.tasReferenceKt ?? 110;
    const dadv = (this.angle(vr + 1) - this.angle(vr - 1)) / 2;
    this.S = vr * dadv;
    if (!this.vars.has(this.ringVar)) this.vars.set(this.ringVar, 1);

    // Rotating TAS ring behind the dial.
    const rf = this.face();
    this.paintRing(rf);
    this.ring = this.addDial(rf, -0.003);
    // Dial with windows.
    const f = this.face();
    this.paintDial(f, m);
    this.addDial(f, 0, this.dialR, this.object, true);
    this.needle = new NeedleDynamics({ omega: 8, zeta: 0.75, min: -3, max: this.angle(this.table.v[this.table.v.length - 1]) + 4 });
    this.pivot = this.addNeedle({ length: 0.86, tail: 0.2, width: 0.075, tipWidth: 0.02, style: 'pointer' }, { z: this.depth * 0.5 });
    const kp = cornerKnobPosition(this.size, 'bl');
    this.addKnob({
      name: 'TAS',
      x: kp.x,
      y: kp.y,
      onTurn: (steps, fine) => {
        const k = this.vars.get(this.ringVar, 1) + steps * (fine ? 0.001 : 0.005);
        this.vars.set(this.ringVar, clamp(k, 0.9, 1.45));
      },
    });
  }

  /** Dial angle (deg) for an airspeed. */
  angle(kt: number): number {
    return piecewise(this.table.v, this.table.a, kt);
  }

  /** TAS factor currently set on the ring. */
  get tasFactor(): number {
    return this.vars.get(this.ringVar, 1);
  }

  protected updateGauge(dt: number): void {
    this.ias = Math.max(0, this.vars.get(this.iasVar));
    AnalogGauge.setAngle(this.pivot, this.needle.update(this.angle(this.ias), dt));
    AnalogGauge.setAngle(this.ring, ringRotationDeg(this.tasFactor, this.S));
  }

  tooltip(): string {
    return `Airspeed: ${Math.round(this.ias)} KIAS · TAS ring ${Math.round(this.ias * this.tasFactor)} KTAS`;
  }

  private paintDial(f: FaceCanvas, m: AirspeedMarkings): void {
    f.background(DIAL_BLACK);
    const a = (v: number): number => this.angle(v);
    // Arcs (white arc inside the green, as on Cessna dials).
    f.band(a(m.greenArc[0]), a(m.greenArc[1]), 0.8, 0.9, MARK_GREEN);
    f.band(a(m.yellowArc[0]), a(m.yellowArc[1]), 0.8, 0.9, MARK_YELLOW);
    f.band(a(m.whiteArc[0]), a(m.whiteArc[1]), 0.72, 0.8, MARK_WHITE);
    f.tick(a(m.redline), 0.7, 0.93, 0.03, MARK_RED);
    // Ticks: 5 kt from 40, majors each 10, labels each 20.
    f.ticks(40, 200, 5, a, 0.84, 0.93, 0.011);
    f.ticks(40, 200, 10, a, 0.78, 0.93, 0.02);
    for (let v = 40; v <= 200; v += 20) f.label(String(v), a(v), 0.62, 0.13);
    f.text('AIRSPEED', 0, -0.16, 0.08);
    f.text('KNOTS', 0, -0.27, 0.075);
    // TAS window (lower, over the ring's TAS numbers) and PA/OAT window (top).
    f.sectorWindow(150, 210, 0.4, 0.55);
    f.sectorWindow(-32, 32, 0.24, 0.38);
    f.arc(150, 210, 0.555, 0.01);
    f.arc(-32, 32, 0.385, 0.01);
    // Fixed OAT scale above the PA window (deg C), -40..+40.
    for (let t = -40; t <= 40; t += 10) {
      const ang = oatMarkDeg(t, this.S);
      f.tick(ang, 0.385, 0.43, 0.008);
      if (t % 20 === 0) f.label(String(t), ang, 0.47, 0.055);
    }
    f.text('°C', 0.34, 0.37, 0.05);
    f.text('TAS', 0, -0.62, 0.06);
  }

  private paintRing(f: FaceCanvas): void {
    f.background('#141414');
    // TAS numbers at the dial angle of their own speed (read under the needle in the lower window).
    for (let v = 60; v <= 200; v += 5) {
      const ang = this.angle(v);
      f.tick(ang, 0.5, 0.55, v % 10 === 0 ? 0.01 : 0.006);
      if (v % 20 === 0) f.label(String(v), ang, 0.45, 0.07, DIAL_WHITE, true);
    }
    // Pressure-altitude marks (thousands of ft) for the top window.
    for (let pa = 0; pa <= 16000; pa += 1000) {
      const ang = paMarkDeg(pa, this.S);
      f.tick(ang, 0.33, 0.38, 0.007);
      if (pa % 2000 === 0) f.label(String(pa / 1000), ang, 0.285, 0.05, DIAL_WHITE, true);
    }
  }
}
