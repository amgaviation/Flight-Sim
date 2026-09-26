/**
 * Standby displays.
 *
 * PlaneView II — standby multifunction controller (SMC), one per side on
 * the glareshield: "patented combined display controller and standby
 * instrument on the glareshield" (FlightGlobal, G650 in the cockpit,
 * 2008). The screen shows the standby flight instrument (attitude,
 * airspeed, altitude, heading, baro; standby ADC / AHRS) and, when a
 * display-controller function key is pressed, the controller page with
 * ten line-select items (logic/controller.ts). It returns to the standby
 * instrument after 30 s without input and presents the attitude
 * automatically "when the PFD is not displayed" (G650ER cockpit
 * photograph caption).
 *
 * Symmetry — two Honeywell ESIS-5000 touch standby flight displays
 * flanking the guidance panel (G600 specification sheet; BJT G500 report
 * "two standby instruments flanking the guidance panel"). Touch zones:
 * baro setting (opens +/- / STD / unit keys), brightness.
 */
import { ADC } from '../../../core/vars';
import { CanvasDisplay, type DisplayCanvas } from '../../common/CanvasDisplay';
import { fmtFixed, fmtInt } from '../../common/format';
import { ADI_HONEYWELL, AttitudeIndicator, type AttitudeStyle } from '../../common/draw/AttitudeIndicator';
import { ALT_TAPE_HONEYWELL, AltitudeTape, type AltitudeTapeStyle } from '../../common/draw/AltitudeTape';
import { SPEED_TAPE_HONEYWELL, SpeedTape, type SpeedTapeStyle } from '../../common/draw/SpeedTape';
import type { Ctx2D } from '../../common/draw/context';
import { C, EPIC_FONT, EPIC_PALETTE, rect, text, textBold } from '../style';
import { EPIC_VARS } from '../vars';
import type { DisplayControllerLogic, DcLine } from '../logic/controller';
import type { WindowManager } from '../logic/windows';
import type { SimVars } from '../../../core/SimVars';
import type { EpicSensors } from '../config';

const STBY_ADI: AttitudeStyle = {
  ...ADI_HONEYWELL,
  palette: EPIC_PALETTE,
  typeface: EPIC_FONT,
  pxPerDeg: 4.4,
  ladder: { ...ADI_HONEYWELL.ladder, majorHalf: 34, midHalf: 18, fineHalf: 9, labelSize: 12, clipHalfWidth: 60, visibleRangeDeg: 22 },
  bank: { ...ADI_HONEYWELL.bank, radius: 92, majorLen: 12, minorLen: 7, pointerSize: 9 },
  slip: { ...ADI_HONEYWELL.slip, width: 18, height: 5, travel: 14 },
  fd: { ...ADI_HONEYWELL.fd, style: 'none' },
  symbol: { style: 'wings', size: 52, thickness: 6 },
  horizonHeadingPxPerDeg: 0,
  radioAlt: null,
  minimums: null,
};
const STBY_SPD: SpeedTapeStyle = { ...SPEED_TAPE_HONEYWELL, palette: EPIC_PALETTE, typeface: EPIC_FONT, pxPerKt: 2.6, readoutW: 58, readoutH: 32, readoutSize: 20, labelSize: 14, trendSeconds: 0 };
const STBY_ALT: AltitudeTapeStyle = { ...ALT_TAPE_HONEYWELL, palette: EPIC_PALETTE, typeface: EPIC_FONT, pxPerFt: 0.26, labelSize: 13, trendSeconds: 0, readoutW: 80, readoutSize: 18 };

/** Standby flight instrument drawn into a rectangle (standby ADC / AHRS). */
export class StandbyInstrument {
  private readonly adi: AttitudeIndicator;
  private readonly spd: SpeedTape;
  private readonly alt: AltitudeTape;
  private readonly names: { ias: string; alt: string; baro: string; std: string; mach: string; pitch: string; bank: string; slip: string; hdg: string; valid: string; att: string };
  x = 0;
  y = 0;
  w = 0;
  h = 0;

  constructor(
    private readonly vars: SimVars,
    sensors: EpicSensors,
  ) {
    const a = sensors.standbyAdc;
    const h = sensors.standbyAhrs;
    this.names = {
      ias: ADC.ias(a),
      alt: ADC.baroAlt(a),
      baro: ADC.baroSetting(a),
      std: ADC.baroStd(a),
      mach: ADC.mach(a),
      pitch: ADC.pitch(h),
      bank: ADC.bank(h),
      slip: ADC.slip(h),
      hdg: ADC.heading(h),
      valid: ADC.valid(a),
      att: ADC.ahrsValid(h),
    };
    const z = { x: 0, y: 0, w: 10, h: 10 };
    this.adi = new AttitudeIndicator({ rect: { ...z }, cx: 0, cy: 0, style: STBY_ADI });
    this.spd = new SpeedTape({ ...z, style: STBY_SPD, bugCount: 0 });
    this.alt = new AltitudeTape({ ...z, style: STBY_ALT });
  }

  get baroVar(): string {
    return this.names.baro;
  }
  get stdVar(): string {
    return this.names.std;
  }

  layout(x: number, y: number, w: number, h: number): void {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    const top = y + 4;
    const bot = y + h - 40;
    this.adi.rect.x = x;
    this.adi.rect.y = top;
    this.adi.rect.w = w;
    this.adi.rect.h = bot - top;
    this.adi.cx = x + w / 2;
    this.adi.cy = top + (bot - top) / 2;
    this.spd.x = x + 4;
    this.spd.y = top + 40;
    this.spd.w = 64;
    this.spd.h = bot - top - 80;
    this.spd.centerY = this.adi.cy;
    this.alt.x = x + w - 90;
    this.alt.y = top + 40;
    this.alt.w = 84;
    this.alt.h = bot - top - 80;
    this.alt.centerY = this.adi.cy;
  }

  update(dt: number): void {
    const v = this.vars;
    const n = this.names;
    const a = this.adi.state;
    a.valid = v.get(n.att, 1) !== 0;
    a.pitch = v.get(n.pitch);
    a.bank = v.get(n.bank);
    a.slip = v.get(n.slip);
    a.heading = v.get(n.hdg);
    this.adi.update(dt);
    const s = this.spd.state;
    s.valid = v.get(n.valid, 1) !== 0;
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

  draw(ctx: Ctx2D, hpa: boolean): void {
    const v = this.vars;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x, this.y, this.w, this.h);
    ctx.clip();
    this.adi.draw(ctx);
    this.spd.draw(ctx);
    this.alt.draw(ctx);
    // Heading readout (bottom) and baro (top right).
    const hdg = v.get(this.names.hdg);
    rect(ctx, this.x + this.w / 2 - 34, this.y + this.h - 36, 68, 30, C.black, C.white, 1);
    textBold(ctx, fmtHdg(hdg), this.x + this.w / 2, this.y + this.h - 20, 20, C.white, 'center', 'middle');
    this.alt.state.baroUnit = hpa ? 'hpa' : 'inhg';
    ctx.restore();
  }
}

// ---------------------------------------------------------------- SMC (PlaneView II)

const COLORS: Record<DcLine['color'], string> = { white: C.white, cyan: C.cyan, green: C.green, magenta: C.magenta, amber: C.amber };

export interface SmcOptions {
  id: string;
  side: 1 | 2;
  vars: SimVars;
  dc: DisplayControllerLogic;
  windows: WindowManager;
  sensors: EpicSensors;
  pixelRatio?: number;
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
}

/** SMC screen, 480 x 360 logical px (EST 4:3 ~ 5 in). LSK rows align with the physical keys at y = 72 + 58 k. */
export class SmcDisplay extends CanvasDisplay {
  readonly side: 1 | 2;
  private readonly dc: DisplayControllerLogic;
  private readonly windows: WindowManager;
  private readonly stby: StandbyInstrument;

  constructor(o: SmcOptions) {
    super({ id: o.id, width: 480, height: 360, pixelRatio: o.pixelRatio, vars: o.vars, canvas: o.canvas, refreshHz: 30 });
    this.side = o.side;
    this.dc = o.dc;
    this.windows = o.windows;
    this.stby = new StandbyInstrument(o.vars, o.sensors);
    this.stby.layout(0, 0, 480, 360);
    this.animating = true;
  }

  /** True while the standby instrument is shown (standby mode, or the side's PFD is lost). */
  get standbyShown(): boolean {
    return (this.vars?.get(EPIC_VARS.smcStandby(this.side), 1) ?? 1) !== 0 || !this.windows.pfdShown[this.side - 1];
  }

  protected override update(dt: number): void {
    this.stby.update(dt);
  }

  protected override draw(ctx: Ctx2D): void {
    const hpa = (this.vars?.get(EPIC_VARS.baroHpa(this.side)) ?? 0) !== 0;
    if (this.standbyShown) {
      this.stby.draw(ctx, hpa);
      if (!this.windows.pfdShown[this.side - 1]) textBold(ctx, 'PFD REV', 240, 46, 14, C.amber, 'center', 'middle');
      return;
    }
    const lines = this.dc.render(this.side);
    textBold(ctx, this.dc.title(this.side), 240, 22, 20, C.white, 'center', 'middle');
    ctx.fillStyle = C.winLine;
    ctx.fillRect(10, 40, 460, 1);
    for (let k = 0; k < 10; k++) {
      const l = lines[k];
      const left = k < 5;
      const row = k % 5;
      const y = 72 + row * 58;
      const x = left ? 12 : 468;
      const al = left ? 'left' : 'right';
      if (l.label) text(ctx, l.label, x, y - 13, 14, C.white, al, 'middle');
      if (l.value) {
        const s = l.arrow ? (left ? `< ${l.value}` : `${l.value} >`) : l.value;
        textBold(ctx, s, x, y + 10, 19, COLORS[l.color], al, 'middle');
        if (l.selected) {
          const w = ctx.measureText(s).width + 10;
          rect(ctx, left ? x - 5 : x - w + 5, y - 3, w, 26, '', C.cyan, 2);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- SFD (Symmetry)

export interface SfdOptions {
  id: string;
  side: 1 | 2;
  vars: SimVars;
  sensors: EpicSensors;
  pixelRatio?: number;
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
}

const SFD_KEYS = ['-', '+', 'STD', 'IN/HPA', 'CLOSE'] as const;

/** ESIS-5000 style touch standby display, 480 x 420 logical px (EST). */
export class SfdDisplay extends CanvasDisplay {
  readonly side: 1 | 2;
  private readonly stby: StandbyInstrument;
  private baroOpen = false;
  private hpa = false;
  private closeT = 0;

  constructor(o: SfdOptions) {
    super({ id: o.id, width: 480, height: 420, pixelRatio: o.pixelRatio, vars: o.vars, canvas: o.canvas, refreshHz: 30 });
    this.side = o.side;
    this.stby = new StandbyInstrument(o.vars, o.sensors);
    this.stby.layout(0, 0, 480, 420);
    this.animating = true;
  }

  protected override update(dt: number): void {
    this.stby.update(dt);
    if (this.baroOpen) {
      this.closeT -= dt;
      if (this.closeT <= 0) this.baroOpen = false;
    }
  }

  /** Touch: the baro field (top right) opens the baro keys; keys act on finger lift. */
  protected override onPointerLogical(x: number, y: number, kind: 'down' | 'up' | 'move' | 'wheel', delta: number): void {
    const v = this.vars;
    if (!v) return;
    if (kind === 'wheel') {
      this.stepBaro(delta > 0 ? 1 : -1);
      return;
    }
    if (kind !== 'up') return;
    if (this.baroOpen && y >= 360) {
      const i = Math.floor(x / 96);
      this.closeT = 8;
      if (i === 0) this.stepBaro(-1);
      else if (i === 1) this.stepBaro(1);
      else if (i === 2) v.set(this.stby.stdVar, v.get(this.stby.stdVar) !== 0 ? 0 : 1);
      else if (i === 3) this.hpa = !this.hpa;
      else this.baroOpen = false;
      return;
    }
    if (y < 40 && x > 240) {
      this.baroOpen = !this.baroOpen;
      this.closeT = 8;
    }
  }

  private stepBaro(d: number): void {
    const v = this.vars!;
    const n = this.stby.baroVar;
    const cur = v.get(n, 29.92);
    const next = this.hpa ? (Math.round(cur * 33.8639) + d) / 33.8639 : Math.round((cur + 0.01 * d) * 100) / 100;
    v.set(n, Math.max(27.5, Math.min(31.5, next)));
  }

  protected override draw(ctx: Ctx2D): void {
    this.stby.draw(ctx, this.hpa);
    if (this.baroOpen) {
      for (let i = 0; i < SFD_KEYS.length; i++) {
        rect(ctx, i * 96 + 3, 364, 90, 52, C.touchButton, C.touchEdge, 1.5);
        textBold(ctx, SFD_KEYS[i], i * 96 + 48, 391, 17, C.white, 'center', 'middle');
      }
    }
  }
}

const HDG_STR: string[] = [];
for (let i = 0; i < 360; i++) HDG_STR.push((i === 0 ? 360 : i).toString().padStart(3, '0'));
function fmtHdg(d: number): string {
  if (!Number.isFinite(d)) return '---';
  return HDG_STR[((Math.round(d) % 360) + 360) % 360];
}
