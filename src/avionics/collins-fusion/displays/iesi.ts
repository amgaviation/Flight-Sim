/**
 * Integrated Electronic Standby Instrument (IESI).
 *
 * FSB BD-700-1A10 Rev 7 appendix 6 (Global Express -> Global 6000): "Same
 * Integrated Electronic Standby (IESI) Instrument but repositioned and minor
 * bezel changes". The IESI shows attitude, airspeed, altitude with its own
 * baro setting, slip and heading from the standby air data / attitude
 * sources, independently of the AFDs. Screen 400 x 400 logical px (EST
 * square 3-ATI face), layout and tape scales EST. The baro knob is on the
 * bezel (FUSION_EVENTS.iesi('baro_inc' / 'baro_dec' / 'baro_push')).
 */
import { CanvasDisplay, type DisplayCanvas } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import { ADI_COLLINS, AttitudeIndicator, type AttitudeStyle } from '../../common/draw/AttitudeIndicator';
import { ALT_TAPE_COLLINS, AltitudeTape, type AltitudeTapeStyle } from '../../common/draw/AltitudeTape';
import { SPEED_TAPE_COLLINS, SpeedTape, type SpeedTapeStyle } from '../../common/draw/SpeedTape';
import type { SimVars } from '../../../core/SimVars';
import { ADC } from '../../../core/vars';
import type { FusionSensors } from '../config';
import { FUSION_VARS } from '../vars';
import { C, hstr, rect, txt } from './style';

export const IESI_W = 400;
export const IESI_H = 400;

const IESI_ADI: AttitudeStyle = {
  ...ADI_COLLINS,
  pxPerDeg: 4.6,
  ladder: { ...ADI_COLLINS.ladder, majorHalf: 34, midHalf: 18, fineHalf: 9, labelSize: 12, clipHalfWidth: 60, visibleRangeDeg: 22 },
  bank: { ...ADI_COLLINS.bank, radius: 92, majorLen: 12, minorLen: 7, pointerSize: 9 },
  slip: { ...ADI_COLLINS.slip, width: 18, height: 5, travel: 14 },
  fd: { ...ADI_COLLINS.fd, style: 'none' },
  symbol: { style: 'wings', size: 52, thickness: 6 },
  horizonHeadingPxPerDeg: 0,
  radioAlt: null,
  minimums: null,
};
const IESI_SPD: SpeedTapeStyle = { ...SPEED_TAPE_COLLINS, pxPerKt: 2.6, readoutW: 58, readoutH: 32, readoutSize: 20, labelSize: 14, trendSeconds: 0 };
const IESI_ALT: AltitudeTapeStyle = { ...ALT_TAPE_COLLINS, pxPerFt: 0.26, labelSize: 13, trendSeconds: 0, readoutW: 100, readoutH: 32, readoutSize: 18 };

export interface IesiOptions {
  id: string;
  vars: SimVars;
  sensors: FusionSensors;
  pixelRatio?: number;
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
  /** Power-up alignment time (s). EST 90 s for the IESI's internal attitude sensors; 0 in tests / running states. */
  alignS?: number;
}

export class IesiDisplay extends CanvasDisplay {
  private readonly v: SimVars;
  private readonly adi: AttitudeIndicator;
  private readonly spd: SpeedTape;
  private readonly alt: AltitudeTape;
  private readonly n: { ias: string; mach: string; alt: string; baro: string; std: string; pitch: string; bank: string; slip: string; hdg: string; adcValid: string; attValid: string };
  private readonly alignS: number;
  private alignLeft = 0;

  constructor(o: IesiOptions) {
    super({ id: o.id, width: IESI_W, height: IESI_H, pixelRatio: o.pixelRatio, vars: o.vars, canvas: o.canvas, refreshHz: 30 });
    this.v = o.vars;
    const a = o.sensors.standbyAdc;
    const h = o.sensors.standbyAhrs;
    this.n = {
      ias: ADC.ias(a),
      mach: ADC.mach(a),
      alt: ADC.baroAlt(a),
      baro: ADC.baroSetting(a),
      std: ADC.baroStd(a),
      pitch: ADC.pitch(h),
      bank: ADC.bank(h),
      slip: ADC.slip(h),
      hdg: ADC.heading(h),
      adcValid: ADC.valid(a),
      attValid: ADC.ahrsValid(h),
    };
    const top = 36;
    const bot = IESI_H - 44;
    const cy = top + (bot - top) / 2;
    this.adi = new AttitudeIndicator({ rect: { x: 0, y: top, w: IESI_W, h: bot - top }, cx: IESI_W / 2, cy, style: IESI_ADI });
    this.spd = new SpeedTape({ x: 4, y: top + 30, w: 64, h: bot - top - 60, style: IESI_SPD, centerY: cy, bugCount: 0 });
    this.alt = new AltitudeTape({ x: IESI_W - 104, y: top + 30, w: 98, h: bot - top - 60, style: IESI_ALT, centerY: cy });
    this.alignS = o.alignS ?? 90;
    this.animating = true;
  }

  protected override onPowerChange(on: boolean): void {
    if (on) this.alignLeft = this.v.get(FUSION_VARS.bootSkip) >= 0.5 ? 0 : this.alignS;
  }

  protected override update(dt: number): void {
    const v = this.v;
    const n = this.n;
    if (this.alignLeft > 0) {
      this.alignLeft -= dt;
      if (v.get(FUSION_VARS.bootSkip) >= 0.5) this.alignLeft = 0;
    }
    const a = this.adi.state;
    a.valid = this.alignLeft <= 0 && v.get(n.attValid, 1) >= 0.5;
    a.pitch = v.get(n.pitch);
    a.bank = v.get(n.bank);
    a.slip = v.get(n.slip);
    a.heading = v.get(n.hdg);
    this.adi.update(dt);
    const s = this.spd.state;
    s.valid = v.get(n.adcValid, 1) >= 0.5;
    s.ias = v.get(n.ias);
    s.mach = v.get(n.mach);
    this.spd.update(dt);
    const al = this.alt.state;
    al.valid = s.valid;
    al.altFt = v.get(n.alt);
    al.baroInHg = v.get(n.baro, 29.92);
    al.baroStd = v.get(n.std) >= 0.5;
    this.alt.update(dt);
  }

  protected override draw(ctx: Ctx2D): void {
    const v = this.v;
    this.adi.draw(ctx);
    this.spd.draw(ctx);
    this.alt.draw(ctx);
    if (this.alignLeft > 0) {
      rect(ctx, IESI_W / 2 - 70, 150, 140, 34, C.bg, C.amber, 1.5);
      txt(ctx, 'ATT ALIGN', IESI_W / 2, 167, 16, C.amber, 'center');
    }
    // Baro setting / STD: drawn by the altitude tape primitive below the tape.
    rect(ctx, 0, 0, IESI_W, 34, C.bg);
    txt(ctx, 'STBY', 10, 18, 13, C.grey, 'left');
    // Heading readout.
    rect(ctx, 0, IESI_H - 42, IESI_W, 42, C.bg);
    const hdg = v.get(this.n.hdg);
    rect(ctx, IESI_W / 2 - 36, IESI_H - 38, 72, 30, C.bg, C.white, 1.5);
    txt(ctx, a2hdg(hdg), IESI_W / 2, IESI_H - 22, 20, C.white, 'center');
  }
}

function a2hdg(d: number): string {
  return Number.isFinite(d) ? hstr(d) : '---';
}
