/**
 * ADF bearing indicator with manually rotatable compass card (Bendix/King
 * KI 227 style; 172S POH Rev 4 Section 7 Figure 7-2 item 14 "ADF Bearing
 * Indicator", KR 87 / KI 227 installation in the equipment list).
 *
 * The needle shows the relative bearing to the station (0 = nose, at the
 * top of the instrument); the card is set by the HDG knob (lower left) to
 * the aircraft heading so the needle head reads magnetic bearing. The
 * receiver (nav module AdfReceiver) parks the needle at 90 deg in ANT mode
 * or without a signal; ADF needles are slow and swing (EST dynamics omega
 * 2.5 rad/s, zeta 0.55).
 * Inputs: adf{r}.rel_bearing_deg; card state in `cardVar` (1 deg/detent,
 * Shift 10 deg).
 */
import { wrap360 } from '../../../core/math';
import { NAV } from '../../../core/vars';
import { NeedleDynamics } from '../../common/dynamics';
import { AnalogGauge, cornerKnobPosition, type AnalogGaugeOptions } from '../AnalogGauge';
import { DIAL_BLACK, DIAL_WHITE, type FaceCanvas } from '../face';
import { ANALOG_VARS } from '../vars';

export interface AdfIndicatorOptions extends Omit<AnalogGaugeOptions, 'knobCorners'> {
  receiver?: number;
  cardVar?: string;
}

const CARDINAL: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

export class AdfIndicator extends AnalogGauge {
  private readonly bearingVar: string;
  private readonly cardVar: string;
  private readonly card: ReturnType<AnalogGauge['addDial']>;
  private readonly needlePivot: ReturnType<AnalogGauge['addNeedle']>;
  private readonly dyn = new NeedleDynamics({ omega: 2.5, zeta: 0.55, circular: true, initial: 90 });

  constructor(o: AdfIndicatorOptions) {
    super({ name: 'ADF', ...o, knobCorners: ['bl'] });
    const r = o.receiver ?? 1;
    this.bearingVar = NAV.adfBearing(r);
    this.cardVar = o.cardVar ?? ANALOG_VARS.adfCard;
    const cf = this.face();
    this.paintCard(cf);
    this.card = this.addDial(cf, 0);
    const mf = this.face();
    mf.background('#141414');
    mf.circleWindow(0, 0, 0.9);
    mf.poly([0, 0.9, -0.05, 0.99, 0.05, 0.99], DIAL_WHITE);
    for (let a = 45; a < 360; a += 45) mf.tick(a, 0.9, 0.98, 0.018);
    mf.text('ADF', 0, -0.95, 0.06);
    this.addDial(mf, 0.0012, this.dialR, this.object, true);
    this.needlePivot = this.addNeedle({ length: 0.82, tail: 0.72, width: 0.06, tipWidth: 0.02, style: 'pointer' }, { z: this.depth * 0.5 });
    const kp = cornerKnobPosition(this.size, 'bl');
    this.addKnob({
      name: 'HDG',
      x: kp.x,
      y: kp.y,
      onTurn: (steps, coarse) => this.vars.set(this.cardVar, wrap360(Math.round(this.vars.get(this.cardVar)) + steps * (coarse ? 10 : 1))),
    });
  }

  protected updateGauge(dt: number): void {
    const rel = this.vars.get(this.bearingVar, 90);
    AnalogGauge.setAngle(this.needlePivot, this.dyn.update(rel, dt));
    AnalogGauge.setAngle(this.card, -this.vars.get(this.cardVar));
  }

  tooltip(): string {
    const card = this.vars.get(this.cardVar);
    return `ADF: relative ${Math.round(wrap360(this.dyn.value))}° · card ${Math.round(wrap360(card))}° · reads ${Math.round(wrap360(card + this.dyn.value))}°`;
  }

  private paintCard(f: FaceCanvas): void {
    f.background(DIAL_BLACK);
    for (let d = 0; d < 360; d += 5) f.tick(d, d % 10 === 0 ? 0.72 : 0.78, 0.86, d % 10 === 0 ? 0.02 : 0.011);
    for (let d = 0; d < 360; d += 30) f.label(CARDINAL[d] ?? String(d / 10), d, 0.6, d % 90 === 0 ? 0.16 : 0.13, DIAL_WHITE, true);
  }
}
