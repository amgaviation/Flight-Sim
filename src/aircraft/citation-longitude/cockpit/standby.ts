/**
 * Longitude standby flight display (OG 2-2: "A Standby Flight Display is
 * provided in the case of avionics failure"; dossier §7.2). Attitude,
 * airspeed and altitude tapes, heading and baro setting from the standby
 * sensors (ADC 3 / AHRS 3, createSystems.ts) on the standby bus
 * (`elec.stby_inst_powered`). Drawn with the avionics-common Garmin tapes
 * and ADI at standby scale.
 *
 * SCOPE: the unit's own menu, brightness keys and self test are not modelled;
 * the bezel BARO knob (turn 0.01 inHg, push STD) writes the standby ADC's
 * baro vars (adc3.baro_inhg / adc3.baro_std), which the ADC reads.
 */
import { ADC } from '../../../core/vars';
import type { SimVars } from '../../../core/SimVars';
import { CanvasDisplay, type DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import { ADI_GARMIN, AttitudeIndicator, type AttitudeStyle } from '../../../avionics/common/draw/AttitudeIndicator';
import { ALT_TAPE_GARMIN, AltitudeTape, type AltitudeTapeStyle } from '../../../avionics/common/draw/AltitudeTape';
import { SPEED_TAPE_GARMIN, SpeedTape, type SpeedTapeStyle } from '../../../avionics/common/draw/SpeedTape';
import type { Ctx2D } from '../../../avionics/common/draw/context';

const S = 3; // standby ADC / AHRS index

const ADI: AttitudeStyle = {
  ...ADI_GARMIN,
  pxPerDeg: 4.2,
  gradientPx: 140,
  ladder: { ...ADI_GARMIN.ladder, majorHalf: 30, midHalf: 16, fineHalf: 8, labelSize: 12, clipHalfWidth: 70, visibleRangeDeg: 24 },
  bank: { ...ADI_GARMIN.bank, radius: 100, majorLen: 12, minorLen: 7, pointerSize: 10 },
  slip: { ...ADI_GARMIN.slip, width: 16, height: 5, travel: 14 },
  fd: { ...ADI_GARMIN.fd, style: 'none' },
  symbol: { style: 'wings', size: 54, thickness: 6 },
};
const SPD: SpeedTapeStyle = { ...SPEED_TAPE_GARMIN, pxPerKt: 3.4, labelSize: 15, readoutW: 58, readoutH: 30, readoutSize: 19, rollWindowH: 46, minorTick: 7, majorTick: 12, trendSeconds: 0, selectedBox: false };
const ALT: AltitudeTapeStyle = { ...ALT_TAPE_GARMIN, pxPerFt: 0.34, labelSize: 14, readoutW: 78, readoutH: 30, readoutSize: 18, rollWindowH: 46, minorTick: 6, majorTick: 12, trendSeconds: 0 };

export interface StandbyDisplayOptions {
  vars: SimVars;
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
}

export class LongitudeStandbyDisplay extends CanvasDisplay {
  private readonly adi: AttitudeIndicator;
  private readonly spd: SpeedTape;
  private readonly alt: AltitudeTape;
  private readonly v: SimVars;
  private readonly n = {
    ias: ADC.ias(S),
    alt: ADC.baroAlt(S),
    baro: ADC.baroSetting(S),
    std: ADC.baroStd(S),
    mach: ADC.mach(S),
    pitch: ADC.pitch(S),
    bank: ADC.bank(S),
    slip: ADC.slip(S),
    hdg: ADC.heading(S),
    adcValid: ADC.valid(S),
    ahrsValid: ADC.ahrsValid(S),
  };

  constructor(o: StandbyDisplayOptions) {
    super({ id: 'stby', width: 400, height: 400, vars: o.vars, canvas: o.canvas, refreshHz: 30, powerVar: 'elec.stby_inst_powered', bootTimeS: 3 });
    this.v = o.vars;
    this.adi = new AttitudeIndicator({ rect: { x: 0, y: 0, w: 400, h: 350 }, cx: 200, cy: 180, style: ADI });
    this.spd = new SpeedTape({ x: 4, y: 40, w: 70, h: 280, centerY: 180, style: SPD, bugCount: 0 });
    this.alt = new AltitudeTape({ x: 314, y: 40, w: 84, h: 280, centerY: 180, style: ALT });
    this.animating = true;
  }

  protected override update(dt: number): void {
    const v = this.v;
    const n = this.n;
    const a = this.adi.state;
    a.valid = v.get(n.ahrsValid, 1) !== 0;
    a.pitch = v.get(n.pitch);
    a.bank = v.get(n.bank);
    a.slip = v.get(n.slip);
    a.heading = v.get(n.hdg);
    this.adi.update(dt);
    const s = this.spd.state;
    s.valid = v.get(n.adcValid, 1) !== 0;
    s.ias = v.get(n.ias);
    s.mach = v.get(n.mach);
    this.spd.update(dt);
    const al = this.alt.state;
    al.valid = s.valid;
    al.altFt = v.get(n.alt);
    al.baroInHg = v.get(n.baro, 29.92);
    al.baroStd = v.get(n.std) !== 0;
    this.alt.update(dt);
  }

  protected draw(ctx: Ctx2D): void {
    this.adi.draw(ctx);
    this.spd.draw(ctx);
    this.alt.draw(ctx);
    const v = this.v;
    // Heading readout (bottom) and baro setting (bottom right), Garmin colours.
    const hdg = Math.round(v.get(this.n.hdg)) % 360;
    ctx.fillStyle = '#000';
    ctx.fillRect(160, 356, 80, 36);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(160, 356, 80, 36);
    ctx.fillStyle = '#fff';
    ctx.font = '600 24px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${hdg < 10 ? '00' : hdg < 100 ? '0' : ''}${hdg === 0 ? 360 : hdg}°`, 200, 375);
    ctx.fillStyle = '#00ffff';
    ctx.font = '600 18px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v.get(this.n.std) !== 0 ? 'STD' : `${v.get(this.n.baro, 29.92).toFixed(2)}IN`, 396, 375);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText('STBY', 6, 375);
  }

  protected override drawBoot(ctx: Ctx2D, p: number): void {
    ctx.fillStyle = '#fff';
    ctx.font = '600 22px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STANDBY', 200, 170);
    ctx.fillText('ALIGNING', 200, 200);
    ctx.fillStyle = '#00ffff';
    ctx.fillRect(100, 230, 200 * p, 8);
  }
}
