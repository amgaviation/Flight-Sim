/**
 * Citation M2 cockpit-specific displays (not part of the G3000 suite):
 *
 *  - `Esi1000Display`: L-3 Trilogy ESI-1000 electronic standby instrument
 *    on the centre glareshield (S&D15 §10.2.A / §10.3.U): "backup for
 *    attitude, altitude, airspeed, and slip/skid information on a 3.7 inch
 *    LCD with LED backlight; a bezel-mounted light sensor provides automatic
 *    dimming with manual offset; four soft key buttons ... for setting
 *    display and button brightness, barometric setting and access to menu
 *    options". Data from the standby air data (ADC 3: standby pitot-static)
 *    and its internal attitude sensor (AHRS 3), power `ac.m2.esi_powered`
 *    (main bus with its own battery, systems/logic.ts).
 *    SCOPE: the menu tree is reduced to the baro unit (IN/HPA) choice; the
 *    optional heading page is not shown (the M2 installation has no
 *    magnetometer input, S&D15 lists attitude, altitude, airspeed and slip).
 *  - `HourMeterDisplay`: the tilt-panel flight hour meter (S&D15 §10.2.C),
 *    an electromechanical counter that runs while the aircraft is airborne
 *    (squat switch) and powered. EST: starts at 1,234.5 h for a used airframe.
 */
import { ADC } from '../../../core/vars';
import type { SimVars } from '../../../core/SimVars';
import { CanvasDisplay, type DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import { ADI_GARMIN, AttitudeIndicator, type AttitudeStyle } from '../../../avionics/common/draw/AttitudeIndicator';
import { ALT_TAPE_GARMIN, AltitudeTape, type AltitudeTapeStyle } from '../../../avionics/common/draw/AltitudeTape';
import { SPEED_TAPE_GARMIN, SpeedTape, type SpeedTapeStyle } from '../../../avionics/common/draw/SpeedTape';
import type { Ctx2D } from '../../../avionics/common/draw/context';
import type { Subsystem } from '../../types';
import { M2 } from '../vars';

/** ESI-1000 cockpit vars (bezel buttons -> the instrument itself). */
export const ESI_VARS = {
  /** Brightness offset from the photocell level, -0.5 .. +0.5 (button 4 cycles). */
  brtOffset: 'ac.m2.esi_brt_ofs',
  /** Baro unit: 0 inHg, 1 hPa (menu). */
  hpa: 'ac.m2.esi_hpa',
  /** Bezel buttons 1..4 (momentary): BARO -, BARO +, STD, BRT (EST assignment). */
  button: (i: number) => `ac.m2.esi_b${i}`,
} as const;

/** Vars read only by these cockpit displays (for the control-coverage audit). */
export const COCKPIT_DISPLAY_VARS: readonly string[] = [ESI_VARS.brtOffset, ESI_VARS.hpa];

const ESI_ADI: AttitudeStyle = {
  ...ADI_GARMIN,
  pxPerDeg: 4.2,
  gradientPx: 120,
  ladder: { ...ADI_GARMIN.ladder, majorHalf: 26, midHalf: 14, fineHalf: 7, labelSize: 11, clipHalfWidth: 46, visibleRangeDeg: 24 },
  bank: { ...ADI_GARMIN.bank, radius: 70, minorLen: 6, majorLen: 11, pointerSize: 8 },
  slip: { ...ADI_GARMIN.slip, width: 16, height: 4, travel: 14 },
  fd: { ...ADI_GARMIN.fd, style: 'none' },
  symbol: { style: 'wings', size: 40, thickness: 5 },
};
const ESI_SPD: SpeedTapeStyle = { ...SPEED_TAPE_GARMIN, pxPerKt: 2.2, readoutW: 46, readoutH: 26, readoutSize: 17, labelSize: 12, trendSeconds: 0 };
const ESI_ALT: AltitudeTapeStyle = { ...ALT_TAPE_GARMIN, pxPerFt: 0.22, labelSize: 11, trendSeconds: 0, readoutW: 62, readoutSize: 15 };

/** ESI-1000 screen: 3.7 in portrait LCD, 240 x 320 logical px (EST 3:4). */
export class Esi1000Display extends CanvasDisplay {
  private readonly adi: AttitudeIndicator;
  private readonly spd: SpeedTape;
  private readonly alt: AltitudeTape;
  private readonly v: SimVars;
  private static readonly W = 240;
  private static readonly H = 320;

  constructor(vars: SimVars, opts: { canvas?: 'dom' | 'offscreen' | DisplayCanvas; pixelRatio?: number } = {}) {
    super({ id: 'esi', width: Esi1000Display.W, height: Esi1000Display.H, pixelRatio: opts.pixelRatio ?? 1.5, vars, refreshHz: 20, powerVar: M2.esiPowered, brightnessVar: null, canvas: opts.canvas, bootTimeS: 6 });
    this.v = vars;
    const W = Esi1000Display.W;
    const H = Esi1000Display.H;
    const top = 22;
    const bot = H - 30;
    const cy = (top + bot) / 2;
    this.adi = new AttitudeIndicator({ rect: { x: 0, y: top, w: W, h: bot - top }, cx: W / 2, cy, style: ESI_ADI });
    this.spd = new SpeedTape({ x: 2, y: top + 18, w: 52, h: bot - top - 36, style: ESI_SPD, bugCount: 0 });
    this.spd.centerY = cy;
    this.alt = new AltitudeTape({ x: W - 70, y: top + 18, w: 68, h: bot - top - 36, style: ESI_ALT });
    this.alt.centerY = cy;
    this.animating = true;
  }

  protected override update(dt: number): void {
    const v = this.v;
    const a = this.adi.state;
    a.valid = v.get(ADC.ahrsValid(3), 1) !== 0;
    a.pitch = v.get(ADC.pitch(3));
    a.bank = v.get(ADC.bank(3));
    a.slip = v.get(ADC.slip(3));
    this.adi.update(dt);
    const s = this.spd.state;
    s.valid = v.get(ADC.valid(3), 1) !== 0;
    s.ias = v.get(ADC.ias(3));
    s.mach = v.get(ADC.mach(3));
    this.spd.update(dt);
    const al = this.alt.state;
    al.valid = s.valid;
    al.altFt = v.get(ADC.baroAlt(3));
    al.baroInHg = v.get(ADC.baroSetting(3), 29.92);
    al.baroStd = v.get(ADC.baroStd(3)) !== 0;
    al.baroUnit = v.get(ESI_VARS.hpa) !== 0 ? 'hpa' : 'inhg';
    this.alt.update(dt);
    // Photocell automatic dimming with the manual offset (S&D15 §10.3.U).
    const amb = Math.max(0, Math.min(1, v.get('env.ambient_light', 1)));
    this.setBrightness(Math.max(0.15, Math.min(1, 0.35 + 0.65 * amb + v.get(ESI_VARS.brtOffset))));
  }

  protected draw(ctx: Ctx2D): void {
    const W = Esi1000Display.W;
    const H = Esi1000Display.H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 22, W, H - 52);
    ctx.clip();
    this.adi.draw(ctx);
    this.spd.draw(ctx);
    this.alt.draw(ctx);
    ctx.restore();
    // Top bar: Mach; bottom bar: baro setting and button legends.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, 22);
    ctx.fillRect(0, H - 30, W, 30);
    const v = this.v;
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    const m = v.get(ADC.mach(3));
    ctx.fillText(m >= 0.4 ? `M .${Math.round(m * 1000).toString().padStart(3, '0')}` : '', 6, 11);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#00ffff';
    const std = v.get(ADC.baroStd(3)) !== 0;
    const inhg = v.get(ADC.baroSetting(3), 29.92);
    const hpa = v.get(ESI_VARS.hpa) !== 0;
    ctx.fillText(std ? 'STD BARO' : hpa ? `${Math.round(inhg * 33.8639)} HPA` : `${inhg.toFixed(2)} IN`, W - 6, 11);
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    const legends = ['BARO -', 'BARO +', 'STD', 'BRT'];
    for (let i = 0; i < 4; i++) ctx.fillText(legends[i], (W * (i + 0.5)) / 4, H - 14);
  }

  protected override drawBoot(ctx: Ctx2D, p: number): void {
    const W = Esi1000Display.W;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, Esi1000Display.H);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TRILOGY', W / 2, 130);
    ctx.font = '12px Arial, sans-serif';
    ctx.fillText('ESI-1000  SELF TEST', W / 2, 160);
    ctx.fillStyle = '#00c000';
    ctx.fillRect(40, 190, (W - 80) * p, 6);
  }
}

/** Flight hour meter (electromechanical counter, 0.1 h digits), 160 x 48 px. */
export class HourMeterDisplay extends CanvasDisplay {
  private hours: number;
  private shown = -1;
  constructor(
    private readonly v: SimVars,
    opts: { canvas?: 'dom' | 'offscreen' | DisplayCanvas; startHours?: number } = {},
  ) {
    super({ id: 'hobbs', width: 160, height: 48, vars: v, refreshHz: 2, powerVar: null, brightnessVar: null, canvas: opts.canvas, background: '#0c0c0c' });
    this.hours = opts.startHours ?? 1234.5;
  }
  protected override update(dt: number): void {
    // Runs while airborne with the emergency bus powered (hour meter on the EMER bus, EST).
    if (this.v.get('gear.air_ground', 1) === 0 && this.v.get('elec.emer_powered') !== 0) this.hours += dt / 3600;
    const tenth = Math.floor(this.hours * 10);
    if (tenth !== this.shown) {
      this.shown = tenth;
      this.invalidate();
    }
  }
  protected draw(ctx: Ctx2D): void {
    const digits = this.shown.toString().padStart(6, '0');
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 6; i++) {
      const x = 12 + i * 23;
      const last = i === 5;
      ctx.fillStyle = last ? '#e8e8e8' : '#151515';
      ctx.fillRect(x - 10, 6, 21, 36);
      ctx.fillStyle = last ? '#101010' : '#f0f0f0';
      ctx.fillText(digits[i], x + 0.5, 25);
    }
  }
}

/**
 * ESI-1000 bezel-button logic (the instrument's own processor): BARO -/+ step
 * the standby baro setting 0.01 inHg per press (auto-repeat 8 /s after 0.5 s),
 * STD toggles standard pressure, BRT steps the manual brightness offset
 * (-0.3 .. +0.3). Only works while the instrument is powered. Writes the
 * standby ADC inputs (adc3.baro_inhg / adc3.baro_std), which the standby
 * AirDataComputer reads.
 */
export class EsiController implements Subsystem {
  readonly name = 'm2.esi_controller';
  private readonly held = [0, 0, 0, 0];
  private readonly last = [false, false, false, false];
  constructor(private readonly vars: SimVars) {}
  update(dt: number): void {
    const v = this.vars;
    const on = v.get(M2.esiPowered) !== 0;
    for (let i = 0; i < 4; i++) {
      const down = on && v.get(ESI_VARS.button(i + 1)) !== 0;
      const edge = down && !this.last[i];
      this.last[i] = down;
      if (!down) {
        this.held[i] = 0;
        continue;
      }
      this.held[i] += dt;
      const repeat = i < 2 && this.held[i] > 0.5 && Math.floor((this.held[i] - 0.5) * 8) !== Math.floor((this.held[i] - 0.5 - dt) * 8);
      if (!edge && !repeat) continue;
      if (i < 2) {
        const b = v.get(ADC.baroSetting(3), 29.92) + (i === 0 ? -0.01 : 0.01);
        v.set(ADC.baroSetting(3), Math.round(Math.max(27.5, Math.min(31.5, b)) * 100) / 100);
        v.set(ADC.baroStd(3), 0);
      } else if (i === 2) v.set(ADC.baroStd(3), v.get(ADC.baroStd(3)) !== 0 ? 0 : 1);
      else {
        const o = v.get(ESI_VARS.brtOffset);
        v.set(ESI_VARS.brtOffset, o >= 0.29 ? -0.3 : Math.round((o + 0.15) * 100) / 100);
      }
    }
  }
}
