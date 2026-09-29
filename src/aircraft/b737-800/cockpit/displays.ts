/**
 * The 737-800's own canvas displays (the six DUs, CDU screens and MCP
 * windows come from the avionics suite):
 *
 *  - `IsfdDisplay`: Integrated Standby Flight Display (Smiths / GE ISFD on
 *    the NG, FCOM 10.10 "Integrated Standby Flight Display"): attitude with
 *    bank scale and slip indicator, airspeed tape (left), altitude tape with
 *    the baro setting (right), heading scale (bottom), and with APP selected
 *    the localizer (bottom) and glide slope (right) deviation scales
 *    (B-CRS: back-course sensing). It reads only its own sensors: air data 3
 *    (auxiliary pitot, alternate static) and attitude 3 (ISFD inertial
 *    sensors), powered from the DC standby / hot battery bus (electrical.ts
 *    'isfd'). ATT RST re-aligns the attitude (~90 s, ATT flag + countdown).
 *    Layout EST from ISFD photographs; tape scales EST.
 *  - `ClockDisplay`: Captain / F/O clock (FCOM 10.10 "Clock"): UTC / MAN time
 *    and date (TIME/DATE), ET (elapsed time, RUN / HLD) and CHR
 *    (chronograph) with the sweep second hand; SET flashes the field set.
 *  - `DialDisplay`: electromechanical-look dial gauges on a canvas (flap
 *    position indicator with L / R needles, hydraulic brake pressure,
 *    rudder trim indicator).
 *  - `LcdDisplay`: the radio control panel windows (NAV, VHF COM, ADF,
 *    ATC code).
 */
import { CanvasDisplay } from '../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../avionics/common/draw/context';
import { FONT_STACKS, fontString } from '../../../avionics/common/fonts';
import type { SimVars } from '../../../core/SimVars';
import type { DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import { B738 } from '../vars';

const D2R = Math.PI / 180;
const MONO = FONT_STACKS.mono;
const SANS = FONT_STACKS.honeywell;

type CanvasOpt = 'dom' | 'offscreen' | DisplayCanvas | undefined;

// ============================================================== ISFD

export class IsfdDisplay extends CanvasDisplay {
  private readonly v: SimVars;

  constructor(vars: SimVars, id: string, canvas?: CanvasOpt) {
    // Refresh 20 Hz (EST; standby LCD).
    super({ id, width: 400, height: 400, vars, powerVar: 'elec.isfd_powered', refreshHz: 20, canvas, bootTimeS: 3 });
    this.v = vars;
    for (const [n, q] of [
      ['adc3.ias_kt', 0.25],
      ['adc3.alt_ft', 2],
      ['ahrs3.pitch_deg', 0.1],
      ['ahrs3.bank_deg', 0.1],
      ['ahrs3.hdg_mag_deg', 0.2],
      ['ahrs3.slip', 0.02],
      ['ahrs3.valid', 0],
      ['adc3.valid', 0],
      ['ac.b738.isfd_baro_disp', 0],
      ['adc3.baro_std', 0],
      [B738.isfdHpa, 0],
      [B738.isfdApp, 0],
      ['ac.b738.isfd_loc_dev', 0.01],
      ['ac.b738.isfd_gs_dev', 0.01],
      ['ahrs3.align_s', 1],
    ] as [string, number][])
      this.watch(n, q);
  }

  protected override drawBoot(ctx: Ctx2D): void {
    ctx.fillStyle = '#fff';
    ctx.font = fontString(28, SANS, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SELF TEST', 200, 200);
  }

  protected draw(ctx: Ctx2D): void {
    const v = this.v;
    const attOk = v.get('ahrs3.valid') !== 0;
    const adcOk = v.get('adc3.valid') !== 0;
    const pitch = v.get('ahrs3.pitch_deg');
    const bank = v.get('ahrs3.bank_deg');
    const cx = 200;
    const cy = 190;
    const ppd = 5.2; // px per degree of pitch (EST)
    // ---- attitude
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 400, 400);
    ctx.clip();
    if (attOk) {
      ctx.translate(cx, cy);
      ctx.rotate(-bank * D2R);
      ctx.translate(0, pitch * ppd);
      ctx.fillStyle = '#1d8ce0';
      ctx.fillRect(-500, -900, 1000, 900);
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(-500, 0, 1000, 900);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-500, 0);
      ctx.lineTo(500, 0);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = fontString(15, SANS, 'bold');
      ctx.textBaseline = 'middle';
      for (let p = -30; p <= 30; p += 5) {
        if (p === 0) continue;
        const y = -p * ppd;
        if (Math.abs(p - pitch) > 22) continue;
        const w = p % 10 === 0 ? 40 : 18;
        ctx.beginPath();
        ctx.moveTo(-w, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        if (p % 10 === 0) {
          ctx.textAlign = 'right';
          ctx.fillText(String(Math.abs(p)), -w - 4, y);
          ctx.textAlign = 'left';
          ctx.fillText(String(Math.abs(p)), w + 4, y);
        }
      }
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 400, 400);
    }
    ctx.restore();
    // Bank scale (fixed) and pointer.
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2;
    const R = 118;
    if (attOk) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, (-90 - 60) * D2R, (-90 + 60) * D2R);
      ctx.stroke();
      for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
        const l = Math.abs(a) === 30 || Math.abs(a) === 60 ? 14 : 8;
        const s = Math.sin(a * D2R);
        const c = -Math.cos(a * D2R);
        ctx.beginPath();
        ctx.moveTo(cx + s * R, cy + c * R);
        ctx.lineTo(cx + s * (R + l), cy + c * (R + l));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy - R);
      ctx.lineTo(cx - 7, cy - R - 12);
      ctx.lineTo(cx + 7, cy - R - 12);
      ctx.closePath();
      ctx.stroke();
      // Roll pointer with slip indicator.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-bank * D2R);
      ctx.beginPath();
      ctx.moveTo(0, -R);
      ctx.lineTo(-8, -R + 13);
      ctx.lineTo(8, -R + 13);
      ctx.closePath();
      ctx.fill();
      const slip = Math.max(-1, Math.min(1, v.get('ahrs3.slip')));
      ctx.fillRect(-9 + slip * 14, -R + 16, 18, 5);
      ctx.restore();
      // Aircraft symbol (Boeing-style wings, EST colour: white outline, black fill).
      ctx.fillStyle = '#000';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 30, cy - 4);
        ctx.lineTo(cx + s * 80, cy - 4);
        ctx.lineTo(cx + s * 80, cy + 4);
        ctx.lineTo(cx + s * 38, cy + 4);
        ctx.lineTo(cx + s * 38, cy + 14);
        ctx.lineTo(cx + s * 30, cy + 14);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillRect(cx - 5, cy - 5, 10, 10);
      ctx.strokeRect(cx - 5, cy - 5, 10, 10);
    } else this.flag(ctx, 'ATT', cx, cy);
    if (!attOk && v.get('ahrs3.align_s') > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = fontString(16, SANS, 'bold');
      ctx.textAlign = 'center';
      ctx.fillText(`ALIGNING ${Math.ceil(v.get('ahrs3.align_s'))}s`, cx, cy + 40);
    }
    // ---- speed tape (left)
    this.tape(ctx, 0, 60, 70, 270, adcOk, v.get('adc3.ias_kt'), 10, 4.0, 30, 'SPD', false);
    // ---- altitude tape (right)
    this.tape(ctx, 318, 60, 82, 270, adcOk, v.get('adc3.alt_ft'), 100, 0.4, 0, 'ALT', true);
    // ---- baro setting (top right)
    ctx.fillStyle = '#000';
    ctx.fillRect(290, 0, 110, 34);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = fontString(20, MONO, 'bold');
    const std = v.get('adc3.baro_std') !== 0;
    const hpa = v.get(B738.isfdHpa) !== 0;
    const bd = v.get('ac.b738.isfd_baro_disp', 29.92);
    ctx.fillStyle = '#26e0ff';
    ctx.fillText(std ? 'STD' : hpa ? `${bd.toFixed(0)} HP` : `${bd.toFixed(2)} IN`, 396, 17);
    // ---- heading (bottom)
    ctx.fillStyle = '#000';
    ctx.fillRect(70, 360, 248, 40);
    if (attOk) {
      const hdg = v.get('ahrs3.hdg_mag_deg');
      ctx.save();
      ctx.beginPath();
      ctx.rect(70, 360, 248, 40);
      ctx.clip();
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.font = fontString(16, MONO, 'bold');
      ctx.textAlign = 'center';
      const ppd2 = 4;
      const base = Math.floor(hdg / 5) * 5;
      for (let d = base - 35; d <= base + 35; d += 5) {
        const x = 194 + (d - hdg) * ppd2;
        const h = ((d % 360) + 360) % 360;
        ctx.beginPath();
        ctx.moveTo(x, 360);
        ctx.lineTo(x, h % 10 === 0 ? 372 : 366);
        ctx.stroke();
        if (h % 30 === 0) ctx.fillText(String(h / 10).padStart(2, '0'), x, 388);
      }
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(194, 362);
      ctx.lineTo(188, 352);
      ctx.lineTo(200, 352);
      ctx.fill();
    } else this.flag(ctx, 'HDG', 194, 380);
    // ---- ILS deviation (APP)
    const app = v.get(B738.isfdApp);
    if (app >= 1 && attOk) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#fff';
      const loc = Math.max(-1.2, Math.min(1.2, v.get('ac.b738.isfd_loc_dev')));
      for (const d of [-2, -1, 1, 2]) {
        ctx.beginPath();
        ctx.arc(cx + d * 36, 340, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#ff38ff';
      ctx.beginPath();
      ctx.moveTo(cx + loc * 72, 332);
      ctx.lineTo(cx + loc * 72 + 9, 340);
      ctx.lineTo(cx + loc * 72, 348);
      ctx.lineTo(cx + loc * 72 - 9, 340);
      ctx.fill();
      if (app === 1) {
        const gs = Math.max(-1.2, Math.min(1.2, v.get('ac.b738.isfd_gs_dev')));
        ctx.strokeStyle = '#fff';
        for (const d of [-2, -1, 1, 2]) {
          ctx.beginPath();
          ctx.arc(302, cy + d * 36, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(302, cy - gs * 72 - 9);
        ctx.lineTo(311, cy - gs * 72);
        ctx.lineTo(302, cy - gs * 72 + 9);
        ctx.lineTo(293, cy - gs * 72);
        ctx.fill();
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = fontString(15, SANS, 'bold');
        ctx.textAlign = 'center';
        ctx.fillText('B-CRS', cx, 316);
      }
    }
  }

  private flag(ctx: Ctx2D, t: string, x: number, y: number): void {
    ctx.font = fontString(24, SANS, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(t).width + 12;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - w / 2, y - 16, w, 32);
    ctx.strokeStyle = '#ff2020';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - w / 2, y - 16, w, 32);
    ctx.fillStyle = '#ff2020';
    ctx.fillText(t, x, y);
  }

  private tape(ctx: Ctx2D, x: number, y: number, w: number, h: number, ok: boolean, value: number, step: number, ppu: number, minV: number, flag: string, right: boolean): void {
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(x, y, w, h);
    const mid = y + h / 2;
    if (!ok) {
      this.flag(ctx, flag, x + w / 2, mid);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.font = fontString(16, MONO, 'bold');
    ctx.textBaseline = 'middle';
    const shown = Math.max(minV, value);
    const base = Math.floor(shown / step) * step;
    const n = Math.ceil(h / 2 / (step * ppu)) + 1;
    for (let k = -n; k <= n; k++) {
      const val = base + k * step;
      if (val < minV) continue;
      const yy = mid - (val - shown) * ppu;
      const major = right ? val % 500 === 0 : val % 20 === 0;
      ctx.beginPath();
      if (right) {
        ctx.moveTo(x, yy);
        ctx.lineTo(x + (major ? 12 : 6), yy);
      } else {
        ctx.moveTo(x + w, yy);
        ctx.lineTo(x + w - (major ? 12 : 6), yy);
      }
      ctx.stroke();
      if (major) {
        ctx.textAlign = right ? 'left' : 'right';
        ctx.fillText(String(val), right ? x + 15 : x + w - 15, yy);
      }
    }
    ctx.restore();
    // Readout box.
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.fillRect(x + 2, mid - 17, w - 4, 34);
    ctx.strokeRect(x + 2, mid - 17, w - 4, 34);
    ctx.fillStyle = '#fff';
    ctx.font = fontString(right ? 20 : 22, MONO, 'bold');
    ctx.textAlign = 'center';
    ctx.fillText(right ? String(Math.round(value / 20) * 20) : String(Math.max(Math.round(minV), Math.round(value))), x + w / 2, mid + 1);
  }
}

// ============================================================== clock

export class ClockDisplay extends CanvasDisplay {
  private readonly v: SimVars;
  private readonly side: 1 | 2;
  private blink = 0;

  constructor(vars: SimVars, id: string, side: 1 | 2, canvas?: CanvasOpt) {
    super({ id, width: 256, height: 256, vars, powerVar: 'elec.clock_powered', refreshHz: 10, canvas });
    this.v = vars;
    this.side = side;
    this.watch(B738.lt.clockChrS(side), 0.5);
    this.watch(B738.lt.clockEtS(side), 30);
    this.watch(B738.lt.clockMode(side), 0);
    this.watch(B738.lt.clockSetField(side), 0);
    this.watch(B738.lt.clockManOffsetH(side), 0);
    this.watch(B738.lt.clockEtRun(side), 0);
    this.watch('env.time_utc_h', 1 / 60);
  }

  protected draw(ctx: Ctx2D): void {
    const v = this.v;
    ctx.fillStyle = '#111214';
    ctx.fillRect(0, 0, 256, 256);
    const cx = 128;
    const cy = 128;
    // Seconds dial (white marks every second, numerals every 10 s: 10 .. 60, SCBG clock face).
    ctx.strokeStyle = '#e8e8e8';
    ctx.fillStyle = '#e8e8e8';
    for (let s = 0; s < 60; s++) {
      const a = (s / 60) * Math.PI * 2;
      const r0 = s % 5 === 0 ? 104 : 111;
      ctx.lineWidth = s % 5 === 0 ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
      ctx.lineTo(cx + Math.sin(a) * 120, cy - Math.cos(a) * 120);
      ctx.stroke();
    }
    ctx.font = fontString(17, SANS, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let s = 10; s <= 60; s += 10) {
      const a = (s / 60) * Math.PI * 2;
      ctx.fillText(String(s), cx + Math.sin(a) * 91, cy - Math.cos(a) * 91);
    }
    // LCD windows (Smiths NG clock, SCBG drawing): upper TIME / DATE window with the MAN / UTC flag, lower ET / CHR
    // window with the RUN / HLD flag. SET: the field being set flashes.
    this.blink = (this.blink + 1) % 10;
    const flashOff = this.blink < 4;
    const lcd = (text: string, y: number, label: string) => {
      ctx.fillStyle = '#9fa98f';
      ctx.fillRect(cx - 50, y - 16, 100, 32);
      ctx.fillStyle = '#111';
      ctx.font = fontString(25, FONT_STACKS.lcd, 'bold');
      ctx.fillText(text, cx, y + 1);
      ctx.fillStyle = '#e8e8e8';
      ctx.font = fontString(11, SANS, 'bold');
      ctx.fillText(label, cx, y - 25);
    };
    const s = this.side;
    const chr = v.get(B738.lt.clockChrS(s));
    const et = v.get(B738.lt.clockEtS(s));
    const mode = v.get(B738.lt.clockMode(s));
    const field = v.get(B738.lt.clockSetField(s));
    const man = mode >= 2;
    const hours = v.get('env.time_utc_h', 12) + (man ? v.get(B738.lt.clockManOffsetH(s)) : 0);
    const utc = ((hours % 24) + 24) % 24;
    const dayShift = Math.floor(hours / 24);
    const two = (n: number) => (n < 10 ? `0${n}` : String(n));
    const blank = (t: string, on: boolean) => (on && flashOff ? t.replace(/[0-9]/g, ' ') : t);
    if (mode === 1 || mode === 3) {
      // DATE: day.month (EST 365-day calendar from env.day_of_year).
      const doy = ((Math.round(v.get('env.day_of_year', 1)) - 1 + dayShift) % 365 + 365) % 365;
      const ml = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      let m = 0;
      let d = doy;
      while (d >= ml[m]) {
        d -= ml[m];
        m++;
      }
      lcd(`${blank(two(d + 1), field === 1)}.${two(m + 1)}`, 100, 'DAY  MO YR');
    } else {
      lcd(`${blank(two(Math.floor(utc)), field === 1)}:${blank(two(Math.floor((utc * 60) % 60)), field === 2)}`, 100, 'TIME');
    }
    ctx.fillStyle = '#e8e8e8';
    ctx.font = fontString(12, SANS, 'bold');
    ctx.fillText(man ? 'MAN' : 'UTC', cx + 70, 72);
    // Lower window: CHR minutes while the chronograph runs / holds a time, else ET hours:minutes.
    if (chr > 0) lcd(`${two(Math.floor(chr / 60) % 100)}:${two(Math.floor(chr % 60))}`, 170, 'ET  CHR');
    else lcd(`${two(Math.floor(et / 3600) % 100)}:${two(Math.floor(et / 60) % 60)}`, 170, 'ET  CHR');
    ctx.fillStyle = '#e8e8e8';
    ctx.font = fontString(12, SANS, 'bold');
    ctx.fillText(v.get(B738.lt.clockEtRun(s)) !== 0 ? 'RUN' : 'HLD', cx - 72, 196);
    // Chronograph sweep second hand.
    if (chr > 0) {
      const a = ((chr % 60) / 60) * Math.PI * 2;
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(a) * 114, cy - Math.cos(a) * 114);
      ctx.stroke();
    }
  }
}

// ============================================================== dial gauges

export interface DialNeedle {
  var: string;
  color?: string;
  /** Letter on the needle tip (flap indicator L / R). */
  tag?: string;
  width?: number;
}

export interface DialOptions {
  id: string;
  vars: SimVars;
  powerVar?: string | null;
  /** Needle angle (deg clockwise from 12 o'clock) of a value. */
  angle: (v: number) => number;
  ticks: { v: number; label?: string; major?: boolean }[];
  needles: DialNeedle[];
  /** Caption lines drawn on the dial. */
  title: string[];
  titleY?: number;
  bands?: { from: number; to: number; color: string }[];
  /** Quantum of the watched needle vars. */
  quantum?: number;
  canvas?: CanvasOpt;
}

export class DialDisplay extends CanvasDisplay {
  private readonly o: DialOptions;
  private readonly v: SimVars;

  constructor(o: DialOptions) {
    // Electromechanical gauges: <= 60 Hz (CLAUDE.md); 30 Hz is ample for these needles.
    super({ id: o.id, width: 256, height: 256, vars: o.vars, powerVar: o.powerVar === undefined ? null : o.powerVar, refreshHz: 30, canvas: o.canvas, background: '#0e0f10' });
    this.o = o;
    this.v = o.vars;
    for (const n of o.needles) this.watch(n.var, o.quantum ?? 0.05);
  }

  protected draw(ctx: Ctx2D): void {
    const o = this.o;
    const cx = 128;
    const cy = 128;
    ctx.fillStyle = '#0e0f10';
    ctx.fillRect(0, 0, 256, 256);
    for (const b of o.bands ?? []) {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, 104, (o.angle(b.from) - 90) * D2R, (o.angle(b.to) - 90) * D2R);
      ctx.stroke();
    }
    ctx.strokeStyle = '#f0f0f0';
    ctx.fillStyle = '#f0f0f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of o.ticks) {
      const a = o.angle(t.v) * D2R;
      const s = Math.sin(a);
      const c = -Math.cos(a);
      ctx.lineWidth = t.major === false ? 1.5 : 3;
      const r0 = t.major === false ? 100 : 92;
      ctx.beginPath();
      ctx.moveTo(cx + s * r0, cy + c * r0);
      ctx.lineTo(cx + s * 112, cy + c * 112);
      ctx.stroke();
      if (t.label) {
        ctx.font = fontString(20, SANS, 'bold');
        ctx.fillText(t.label, cx + s * 74, cy + c * 74);
      }
    }
    ctx.font = fontString(13, SANS, 'bold');
    o.title.forEach((line, i) => ctx.fillText(line, cx, (o.titleY ?? 172) + i * 15));
    for (const n of o.needles) {
      const val = this.v.get(n.var);
      const a = o.angle(val) * D2R;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.fillStyle = n.color ?? '#f4f4f4';
      const w = n.width ?? 7;
      ctx.beginPath();
      ctx.moveTo(-w / 2, 18);
      ctx.lineTo(-w / 2, -80);
      ctx.lineTo(0, -104);
      ctx.lineTo(w / 2, -80);
      ctx.lineTo(w / 2, 18);
      ctx.closePath();
      ctx.fill();
      if (n.tag) {
        ctx.fillStyle = '#000';
        ctx.font = fontString(11, SANS, 'bold');
        ctx.fillText(n.tag, 0, -70);
      }
      ctx.restore();
    }
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================== radio LCD windows

export interface LcdField {
  /** Text of the field (called at <= refresh rate; may allocate a short string). */
  text: () => string;
  x: number;
  /** Baseline centre y (px; default the middle of a single-row window). */
  y?: number;
  size?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export class LcdDisplay extends CanvasDisplay {
  private readonly fields: LcdField[];

  constructor(vars: SimVars, id: string, powerVar: string, watchVars: string[], fields: LcdField[], width = 320, canvas?: CanvasOpt, height = 64) {
    super({ id, width, height, vars, powerVar, refreshHz: 10, canvas, background: '#050505' });
    this.fields = fields;
    for (const w of watchVars) this.watch(w, 0.001);
  }

  protected draw(ctx: Ctx2D): void {
    ctx.textBaseline = 'middle';
    for (const f of this.fields) {
      ctx.fillStyle = f.color ?? '#ffb02e';
      ctx.font = fontString(f.size ?? 40, FONT_STACKS.lcd, 'bold');
      ctx.textAlign = f.align ?? 'center';
      ctx.fillText(f.text(), f.x, f.y ?? 34);
    }
  }
}

// ============================================================== rudder trim indicator (linear)

/**
 * Rudder trim indicator: the NG trim module's horizontal linear scale across the top of the rudder / aileron
 * trim panel (FCOM 9.10 "Rudder trim indicator"; NG pedestal photographs): 15-0-15 scale with LEFT / RIGHT
 * arrows and a vertical pointer, backlit window. Reads `ac.b738.lt.rud_trim_units` (logic.ts, +/-16 units).
 */
export class RudderTrimIndicator extends CanvasDisplay {
  private readonly v: SimVars;

  constructor(vars: SimVars, id: string, canvas?: CanvasOpt) {
    super({ id, width: 512, height: 112, vars, powerVar: 'elec.dc_stby_powered', refreshHz: 30, canvas, background: '#0e0f10' });
    this.v = vars;
    this.watch(B738.lt.rudderTrimUnits, 0.05);
  }

  protected draw(ctx: Ctx2D): void {
    const W = 512;
    ctx.fillStyle = '#0e0f10';
    ctx.fillRect(0, 0, W, 112);
    const cx = W / 2;
    const span = 220; // px from centre to the 16-unit end
    const px = (u: number) => cx + (u / 16) * span;
    ctx.strokeStyle = '#f0f0f0';
    ctx.fillStyle = '#f0f0f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Scale line with ticks every unit, majors / numerals at 0, 5, 10, 15 each side (15-0-15 scale).
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px(-16), 58);
    ctx.lineTo(px(16), 58);
    ctx.stroke();
    for (let u = -15; u <= 15; u++) {
      const major = u % 5 === 0;
      ctx.lineWidth = major ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(px(u), 58);
      ctx.lineTo(px(u), major ? 40 : 48);
      ctx.stroke();
      if (major) {
        ctx.font = fontString(20, SANS, 'bold');
        ctx.fillText(String(Math.abs(u)), px(u), 26);
      }
    }
    ctx.font = fontString(17, SANS, 'bold');
    ctx.fillText('LEFT', px(-13), 96);
    ctx.fillText('RUDDER TRIM', cx, 96);
    ctx.fillText('RIGHT', px(13), 96);
    // Pointer (white triangle from below the scale).
    const u = Math.max(-16, Math.min(16, this.v.get(B738.lt.rudderTrimUnits)));
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.moveTo(px(u), 60);
    ctx.lineTo(px(u) - 9, 80);
    ctx.lineTo(px(u) + 9, 80);
    ctx.closePath();
    ctx.fill();
  }
}

/** Flap position indicator angle (FCOM 9.10: marks 0 1 2 5 10 15 25 30 40, non-linear; EST angles). */
export const FLAP_DIAL = {
  marks: [0, 1, 2, 5, 10, 15, 25, 30, 40],
  angles: [-150, -120, -95, -65, -30, 5, 45, 85, 140],
  angle(v: number): number {
    const m = FLAP_DIAL.marks;
    const a = FLAP_DIAL.angles;
    if (v <= m[0]) return a[0];
    for (let i = 0; i < m.length - 1; i++) if (v <= m[i + 1]) return a[i] + ((a[i + 1] - a[i]) * (v - m[i])) / (m[i + 1] - m[i]);
    return a[a.length - 1];
  },
};
