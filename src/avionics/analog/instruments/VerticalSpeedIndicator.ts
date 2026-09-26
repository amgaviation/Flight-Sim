/**
 * Pneumatic vertical speed indicator (rate-of-climb).
 *
 * Cessna 172S POH Rev 4 §7 "Vertical Speed Indicator": rate of climb or
 * descent in feet per minute, pointer actuated by static-pressure changes.
 * FAA-H-8083-25B PHAK ch.8: the VSI lags — it shows trend immediately but
 * needs "6 to 9 seconds" to stabilise on the actual rate (calibrated-leak
 * diaphragm). Modelled as a first-order lag with tau = 2.5 s (95 % in
 * ~7.5 s) on the air-data vertical speed, then damped needle dynamics.
 * Dial: 0 at 9 o'clock, UP clockwise over the top, DOWN below, +/-2000 fpm
 * (EST non-linear spacing from 172S dial photographs). The zero-adjust
 * screw (lower left) offsets the reading (`zeroVar`, 10 fpm per detent).
 */
import { FirstOrderLag } from '../../../core/math';
import { NeedleDynamics } from '../../common/dynamics';
import { piecewiseSigned } from '../../common/math';
import { AnalogGauge, cornerKnobPosition, type AnalogGaugeOptions } from '../AnalogGauge';
import { DIAL_BLACK, type FaceCanvas } from '../face';
import { ANALOG_VARS } from '../vars';

export interface VsiOptions extends Omit<AnalogGaugeOptions, 'knobCorners'> {
  vsVar?: string;
  zeroVar?: string;
  /** Instrument lag (s). */
  lagTau?: number;
  /** |fpm| -> deg from the zero position (EST). */
  table?: { v: readonly number[]; a: readonly number[] };
}

export const C172S_VSI_TABLE = { v: [0, 500, 1000, 1500, 2000], a: [0, 45, 90, 130, 170] } as const;

export class AnalogVerticalSpeedIndicator extends AnalogGauge {
  indicated = 0;
  private readonly o: VsiOptions;
  private readonly lag: FirstOrderLag;
  private readonly dyn: NeedleDynamics;
  private readonly pivot: ReturnType<AnalogGauge['addNeedle']>;
  private readonly table: { v: readonly number[]; a: readonly number[] };
  private readonly zeroVar: string;

  constructor(o: VsiOptions) {
    super({ name: 'Vertical speed', ...o, knobCorners: ['bl'] });
    this.o = o;
    this.table = o.table ?? C172S_VSI_TABLE;
    this.zeroVar = o.zeroVar ?? ANALOG_VARS.vsiZero;
    this.lag = new FirstOrderLag(o.lagTau ?? 2.5, 0);
    const maxA = this.table.a[this.table.a.length - 1];
    this.dyn = new NeedleDynamics({ omega: 7, zeta: 0.8, min: 270 - maxA - 4, max: 270 + maxA + 4, initial: 270 });
    const f = this.face();
    this.paint(f);
    this.addDial(f);
    this.pivot = this.addNeedle({ length: 0.84, tail: 0.2, width: 0.07, tipWidth: 0.02, style: 'pointer' }, { z: this.depth * 0.5 });
    AnalogGauge.setAngle(this.pivot, 270);
    const kp = cornerKnobPosition(this.size, 'bl');
    this.addKnob({
      name: 'ZERO',
      x: kp.x,
      y: kp.y,
      radius: 0.004,
      length: 0.003,
      onTurn: (steps) => this.vars.set(this.zeroVar, Math.max(-300, Math.min(300, this.vars.get(this.zeroVar) + steps * 10))),
    });
  }

  /** Dial angle (deg) for a vertical speed (fpm). */
  angle(fpm: number): number {
    return 270 + piecewiseSigned(this.table.v, this.table.a, fpm);
  }

  protected updateGauge(dt: number): void {
    const vs = this.vars.get(this.o.vsVar ?? ANALOG_VARS.vs);
    this.indicated = this.lag.update(vs, dt) + this.vars.get(this.zeroVar);
    AnalogGauge.setAngle(this.pivot, this.dyn.update(this.angle(this.indicated), dt));
  }

  tooltip(): string {
    return `Vertical speed: ${Math.round(this.indicated / 10) * 10} fpm`;
  }

  private paint(f: FaceCanvas): void {
    f.background(DIAL_BLACK);
    const a = (v: number): number => this.angle(v);
    f.ticks(-2000, 2000, 100, a, 0.84, 0.93, 0.011);
    f.ticks(-2000, 2000, 500, a, 0.76, 0.93, 0.022);
    for (const v of [5, 10, 15, 20]) {
      f.label(String(v), a(v * 100), 0.63, 0.14);
      f.label(String(v), a(-v * 100), 0.63, 0.14);
    }
    f.label('0', a(0), 0.63, 0.15);
    f.text('UP', -0.32, 0.3, 0.09);
    f.text('DOWN', -0.32, -0.3, 0.09);
    f.text('VERTICAL SPEED', 0.06, 0.2, 0.068);
    f.text('100 FEET PER MINUTE', 0.06, -0.2, 0.052);
  }
}
