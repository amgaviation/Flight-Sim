/**
 * Canvas displays of the steam 172S NAV II stack and panel:
 *
 *  - KX 155A NAV/COMM (Supplement 1 Fig 1 sheets 1-2): orange gas-discharge numerics, COMM USE
 *    'T/R' STBY on the left, NAV USE and STBY / CDI / BRG (TO) / RAD (FR) / TIMER (ET) on the right.
 *  - KR 87 ADF (Supplement 6 Fig 1 items 1-5): ANT/ADF, active frequency, BFO / FRQ, standby
 *    frequency or FLT / ET timer.
 *  - KT 76C transponder (Supplement 2 Fig 1 items 2-4): FL + pressure altitude (hundreds of ft),
 *    mode annunciators SBY / ON / ALT / TST, reply 'R', four-digit code.
 *  - KAP 140 LCD (Supplement 15 Figs 2-3): lateral and vertical mode fields with ARM, AP, PT
 *    arrows, the right field (selected altitude FT / VS FPM / BARO IN HG - HPA), ALERT, PFT n.
 *  - KLN 94 colour LCD (Pilot's Guide 006-18207-0000 Chapter 3): turn-on pages, NAV 1 / NAV 2 /
 *    NAV 4 map, APT 1, FPL 0, D->, NRST, MSG, ALT, PROC and the status line.
 *  - Hour meter (Hobbs) drum counter.
 *
 * Digits are drawn as 7-segment glyphs (the Bendix/King displays are segmented); small
 * annunciator words use a condensed sans font. Colours EST from photographs (gas discharge
 * orange #ff7a1a, KAP 140 LCD dark segments on a grey-green backlit field).
 * Displays read the logic objects of this aircraft (same module) and redraw only when their
 * signature (a number built from the shown state) changes; flashing items set `animating`.
 */
import type { SimVars } from '../../../core/SimVars';
import { ADC, FMS, GPS, NAV } from '../../../core/vars';
import { CanvasDisplay } from '../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../avionics/common/draw/context';
import { fmtClock, fmtFixed, fmtPad } from '../../../avionics/common/format';
import { distanceNm, initialBearing } from '../../../core/geo';
import { wrap360 } from '../../../core/math';
import { AP } from '../../../core/vars';
import type { Kx155aLogic } from '../avionics/kx155a';
import type { Kr87Logic } from '../avionics/kr87';
import { KT_MODE, type Kt76cLogic } from '../avionics/kt76c';
import type { Kap140Logic } from '../avionics/kap140';
import { KLN_PAGE_TYPES, KLN_RANGES, type Kln94Logic } from '../avionics/kln94';
import { C172 } from '../../c172s-common/vars';
import { KAP, KLN, KR, KT, KX } from '../vars';

// ------------------------------------------------------------------ 7-segment glyphs

/** Segment bits a b c d e f g (a = top, clockwise, g = middle). */
const SEG: Record<string, number> = {
  '0': 0b0111111,
  '1': 0b0000110,
  '2': 0b1011011,
  '3': 0b1001111,
  '4': 0b1100110,
  '5': 0b1101101,
  '6': 0b1111101,
  '7': 0b0000111,
  '8': 0b1111111,
  '9': 0b1101111,
  '-': 0b1000000,
  ' ': 0,
  A: 0b1110111,
  b: 0b1111100,
  C: 0b0111001,
  c: 0b1011000,
  d: 0b1011110,
  E: 0b1111001,
  F: 0b1110001,
  G: 0b0111101,
  H: 0b1110110,
  h: 0b1110100,
  I: 0b0000110,
  J: 0b0011110,
  L: 0b0111000,
  n: 0b1010100,
  o: 0b1011100,
  O: 0b0111111,
  P: 0b1110011,
  r: 0b1010000,
  S: 0b1101101,
  t: 0b1111000,
  U: 0b0111110,
  u: 0b0011100,
  Y: 0b1101110,
};

/**
 * Draws a string of 7-segment characters, left-aligned at (x, y) (top-left of the first cell),
 * cell `w` x `h`, italic slant 8 %. '.' and ':' attach to the previous cell. Returns the end x.
 */
export function drawSeg(ctx: Ctx2D, text: string, x: number, y: number, w: number, h: number, color: string): number {
  const t = Math.max(1.2, w * 0.16); // segment thickness
  const g = t * 0.25; // gap
  const slant = 0.08;
  ctx.fillStyle = color;
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '.') {
      ctx.beginPath();
      ctx.arc(cx - w * 0.12 - slant * 0 * h, y + h - t * 0.5, t * 0.55, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (ch === ':') {
      ctx.fillRect(cx - w * 0.2, y + h * 0.28, t * 0.9, t * 0.9);
      ctx.fillRect(cx - w * 0.25, y + h * 0.66, t * 0.9, t * 0.9);
      continue;
    }
    const bits = SEG[ch] ?? 0;
    const sx = (yy: number): number => (h - (yy - y)) * slant; // slant offset at height yy
    const seg = (x0: number, y0: number, x1: number, y1: number): void => {
      // x0,y0 -> x1,y1 along the segment axis, drawn as a quad of thickness t.
      const hor = y0 === y1;
      ctx.beginPath();
      if (hor) {
        ctx.moveTo(x0 + g + sx(y0), y0);
        ctx.lineTo(x0 + g + t * 0.5 + sx(y0 - t / 2), y0 - t / 2);
        ctx.lineTo(x1 - g - t * 0.5 + sx(y0 - t / 2), y0 - t / 2);
        ctx.lineTo(x1 - g + sx(y0), y0);
        ctx.lineTo(x1 - g - t * 0.5 + sx(y0 + t / 2), y0 + t / 2);
        ctx.lineTo(x0 + g + t * 0.5 + sx(y0 + t / 2), y0 + t / 2);
      } else {
        ctx.moveTo(x0 + sx(y0 + g), y0 + g);
        ctx.lineTo(x0 + t / 2 + sx(y0 + g + t * 0.5), y0 + g + t * 0.5);
        ctx.lineTo(x0 + t / 2 + sx(y1 - g - t * 0.5), y1 - g - t * 0.5);
        ctx.lineTo(x0 + sx(y1 - g), y1 - g);
        ctx.lineTo(x0 - t / 2 + sx(y1 - g - t * 0.5), y1 - g - t * 0.5);
        ctx.lineTo(x0 - t / 2 + sx(y0 + g + t * 0.5), y0 + g + t * 0.5);
      }
      ctx.closePath();
      ctx.fill();
    };
    const l = cx + t / 2;
    const r = cx + w * 0.78 - t / 2;
    const top = y + t / 2;
    const mid = y + h / 2;
    const bot = y + h - t / 2;
    if (bits & 1) seg(l, top, r, top); // a
    if (bits & 2) seg(r, top, r, mid); // b
    if (bits & 4) seg(r, mid, r, bot); // c
    if (bits & 8) seg(l, bot, r, bot); // d
    if (bits & 16) seg(l, mid, l, bot); // e
    if (bits & 32) seg(l, top, l, mid); // f
    if (bits & 64) seg(l, mid, r, mid); // g
    cx += w;
  }
  return cx;
}

const ANN_FONT = (px: number): string => `700 ${px}px "Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", Arial, sans-serif`;
/** Gas-discharge orange (EST from photographs of KX 155A / KR 87 / KT 76C displays). */
export const BK_ORANGE = '#ff7a1a';
/** Seconds-based blink (2 Hz). */
const blinkOn = (t: number): boolean => Math.floor(t * 4) % 2 === 0;

/** Base: redraw when `sig()` changes. */
abstract class SigDisplay extends CanvasDisplay {
  private lastSig = NaN;
  protected t = 0;
  protected abstract sig(): number;
  protected override update(dt: number): void {
    this.t += dt;
    const s = this.sig();
    if (s !== this.lastSig) {
      this.lastSig = s;
      this.invalidate();
    }
  }
}

function annText(ctx: Ctx2D, text: string, x: number, y: number, px: number, color: string, align: CanvasTextAlign = 'left'): void {
  ctx.font = ANN_FONT(px);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

// ------------------------------------------------------------------ KX 155A

/** Frequency text "122.70" / "117.60" (kHz integer in, 2 decimals). */
function freqText(mhz: number, decimals: 2 | 3 = 2): string {
  return fmtFixed(Math.round(mhz * 1000) / 1000, decimals);
}

export class Kx155aDisplay extends SigDisplay {
  private readonly k: ReturnType<typeof KX>;
  constructor(
    vars: SimVars,
    private readonly unit: Kx155aLogic,
  ) {
    super({ id: `kx155a_${unit.n}`, width: 700, height: 80, pixelRatio: 1.4, vars, powerVar: KX(unit.n).on, brightnessVar: null, refreshHz: 20 });
    this.k = KX(unit.n);
  }
  protected sig(): number {
    const u = this.unit;
    const v = this.vars!;
    let s = u.comAct * 7 + u.comStby * 13 + u.navAct * 17 + u.navStby * 19 + u.format * 1e7 + (u.comDirect ? 3e7 : 0) + (u.navDirect ? 5e7 : 0);
    s += u.chanMode * 1.1e8 + u.chanIndex * 2.3e8 + v.get(this.k.tx) * 3e9 + v.get(this.k.comPull) * 5e9;
    if (u.format === 1) s += Math.round(u.intDevDeg() * 4) * 1.3 + u.intObs * 11 + u.intToFrom * 1e10 + v.get(NAV.isLoc(u.n)) * 2e10;
    else if (u.format === 2) s += Math.round(u.bearingTo() || -1) * 1.7;
    else if (u.format === 3) s += Math.round(u.radialFrom() || -1) * 1.9;
    else if (u.format === 4) s += Math.floor(u.timerS) * 2.9 + u.timerState * 1e10;
    this.animating = (u.format === 4 && (u.timerState === 1 || u.timerFlashS > 0)) || u.chanMode > 0;
    return s;
  }
  protected draw(ctx: Ctx2D): void {
    const u = this.unit;
    const v = this.vars!;
    const o = BK_ORANGE;
    const W = 28;
    const H = 44;
    const y = 12;
    // COMM USE / STBY.
    drawSeg(ctx, freqText(u.comAct / 1000), 12, y, W, H, o);
    const tx = v.get(this.k.tx) > 0.5;
    if (tx) annText(ctx, 'T', 166, 22, 13, o, 'center');
    if (v.get(this.k.comPull) > 0.5 || tx) annText(ctx, 'R', 166, 44, 13, o, 'center');
    if (u.chanMode > 0) {
      annText(ctx, u.chanMode === 2 ? 'PG' : 'CH', 186, 34, 16, o);
      drawSeg(ctx, fmtPad(u.chanIndex + 1, 2), 212, y, W, H, o);
    } else if (!u.comDirect) drawSeg(ctx, freqText(u.comStby / 1000), 182, y, W, H, o);
    // Divider.
    ctx.fillStyle = '#3a1a08';
    ctx.fillRect(338, 6, 2, 68);
    // NAV USE.
    drawSeg(ctx, freqText(u.navAct / 1000), 350, y, W, H, o);
    const rx = 512;
    switch (u.format) {
      case 0:
        if (!u.navDirect) drawSeg(ctx, freqText(u.navStby / 1000), rx, y, W * 0.95, H, o);
        break;
      case 1: {
        const loc = v.get(NAV.isLoc(u.n)) > 0.5;
        const valid = v.get(NAV.received(u.n)) > 0.5;
        if (loc) drawSeg(ctx, 'LOC', rx + 6, y - 2, W * 0.8, H * 0.62, o);
        else {
          annText(ctx, 'OBS', rx - 4, 24, 9, o, 'center');
          drawSeg(ctx, fmtPad(Math.round(wrap360(u.intObs)) % 360, 3), rx + 6, y - 2, W * 0.8, H * 0.62, o);
        }
        // CDI dot scale with the deviation cursor (+ = fly right) or FLAG.
        const cy = 64;
        if (!valid) drawSeg(ctx, 'FLAG', rx - 20, 46, 16, 22, o);
        else {
          for (let i = -5; i <= 5; i++) if (i !== 0) ctx.fillRect(rx + 34 + i * 7.5, cy, 4, 2);
          const dev = Math.max(-1, Math.min(1, u.intDevDeg() / (loc ? 2.5 : 10)));
          ctx.fillRect(rx + 34 + dev * 37.5 - 1, cy - 7, 3, 16);
          annText(ctx, u.intToFrom > 0 ? '^' : u.intToFrom < 0 ? 'v' : '', rx + 36, cy - 10, 10, o, 'center');
        }
        break;
      }
      case 2: {
        const b = u.bearingTo();
        if (Number.isFinite(b)) drawSeg(ctx, fmtPad(Math.round(b) % 360, 3), rx + 4, y, W * 0.9, H, o);
        else drawSeg(ctx, '---', rx + 4, y, W * 0.9, H, o);
        annText(ctx, 'TO', rx + 110, 18, 11, o, 'center');
        break;
      }
      case 3: {
        const r = u.radialFrom();
        if (Number.isFinite(r)) drawSeg(ctx, fmtPad(Math.round(r) % 360, 3), rx + 4, y, W * 0.9, H, o);
        else drawSeg(ctx, '---', rx + 4, y, W * 0.9, H, o);
        annText(ctx, 'FR', rx + 110, 18, 11, o, 'center');
        break;
      }
      case 4: {
        const show = !((u.timerState === 1 || u.timerFlashS > 0) && !blinkOn(this.t));
        if (show) drawSeg(ctx, fmtClock(u.timerS), rx - 4, y, W * 0.85, H, o);
        annText(ctx, 'ET', rx + 150, 60, 11, o, 'center');
        break;
      }
    }
  }
}

// ------------------------------------------------------------------ KR 87

export class Kr87Display extends SigDisplay {
  constructor(
    vars: SimVars,
    private readonly unit: Kr87Logic,
  ) {
    super({ id: 'kr87', width: 420, height: 75, pixelRatio: 1.5, vars, powerVar: KR.on, brightnessVar: null, refreshHz: 20 });
  }
  protected sig(): number {
    const u = this.unit;
    const v = this.vars!;
    this.animating = u.etState === 1 || u.etFlashS > 0;
    return u.active * 3 + u.standby * 7 + u.window * 1e5 + Math.floor(u.window === 1 ? u.fltS / 60 : u.etS) * 11 + u.etState * 1e6 + v.get(KR.adf) * 1e7 + v.get(KR.bfo) * 2e7;
  }
  protected draw(ctx: Ctx2D): void {
    const u = this.unit;
    const v = this.vars!;
    const o = BK_ORANGE;
    const adf = v.get(KR.adf, 1) > 0.5;
    annText(ctx, adf ? 'ADF' : 'ANT', 34, adf ? 48 : 26, 13, o, 'center');
    const act = String(u.active);
    drawSeg(ctx, act.length < 4 ? ` ${act}` : act, 64, 14, 30, 44, o);
    if (v.get(KR.bfo) > 0.5) annText(ctx, 'BFO', 214, 22, 13, o, 'center');
    if (u.window === 0) {
      annText(ctx, 'FRQ', 214, 54, 13, o, 'center');
      const sb = String(u.standby);
      drawSeg(ctx, sb.length < 4 ? ` ${sb}` : sb, 250, 14, 30, 44, o);
    } else if (u.window === 1) {
      drawSeg(ctx, fmtClock(u.fltS, true).padStart(5, ' '), 250, 14, 26, 44, o);
      annText(ctx, 'FLT', 398, 22, 12, o, 'center');
    } else {
      const flash = (u.etState === 1 || u.etFlashS > 0) && !blinkOn(this.t);
      if (!flash) drawSeg(ctx, fmtClock(u.etS), 250, 14, 26, 44, o);
      annText(ctx, 'ET', 398, 54, 12, o, 'center');
    }
  }
}

// ------------------------------------------------------------------ KT 76C

export class Kt76cDisplay extends SigDisplay {
  constructor(
    vars: SimVars,
    private readonly unit: Kt76cLogic,
  ) {
    super({ id: 'kt76c', width: 380, height: 84, pixelRatio: 1.5, vars, powerVar: KT.on, brightnessVar: null, refreshHz: 20 });
  }
  protected sig(): number {
    const v = this.vars!;
    return v.get(KT.display) * 3 + v.get(KT.entry) * 1e5 + v.get(KT.reply) * 1e6 + Math.round(v.get(KT.mode)) * 1e7 + v.get(KT.altHft) * 1.3e8;
  }
  protected draw(ctx: Ctx2D): void {
    const v = this.vars!;
    const o = BK_ORANGE;
    const mode = Math.round(v.get(KT.mode));
    if (mode === KT_MODE.tst) {
      // All display segments (Supplement 2 item 5 TST).
      annText(ctx, 'FL', 26, 62, 13, o, 'center');
      drawSeg(ctx, '888', 42, 16, 30, 46, o);
      annText(ctx, 'ALT ON SBY TST', 196, 16, 10, o, 'center');
      annText(ctx, 'R', 222, 30, 14, o, 'center');
      drawSeg(ctx, '8888', 240, 16, 32, 46, o);
      return;
    }
    const alt = v.get(KT.altHft);
    if (mode === KT_MODE.alt) {
      annText(ctx, 'FL', 26, 62, 13, o, 'center');
      if (alt > -9000) drawSeg(ctx, fmtPad(Math.max(-9, Math.round(alt)), 3), 42, 16, 30, 46, o);
      else drawSeg(ctx, '---', 42, 16, 30, 46, o);
    }
    annText(ctx, mode === KT_MODE.alt ? 'ALT' : mode === KT_MODE.on ? 'ON' : 'SBY', 180, 16, 12, o, 'center');
    if (v.get(KT.reply) > 0.5) annText(ctx, 'R', 222, 30, 14, o, 'center');
    const digits = Math.round(v.get(KT.entry));
    const code = fmtPad(Math.round(v.get(KT.display)), 4);
    drawSeg(ctx, digits > 0 ? code.slice(0, digits).padEnd(4, ' ') : code, 240, 16, 32, 46, o);
    void this.unit;
  }
}

// ------------------------------------------------------------------ KAP 140

const LCD_BG = '#8e9c86'; // EST: grey-green backlit LCD field
const LCD_INK = '#161b14';

export class Kap140Display extends SigDisplay {
  constructor(
    vars: SimVars,
    private readonly kap: Kap140Logic,
  ) {
    super({ id: 'kap140', width: 380, height: 83, pixelRatio: 1.5, vars, powerVar: KAP.on, brightnessVar: null, background: LCD_BG, refreshHz: 15 });
  }
  protected sig(): number {
    const v = this.vars!;
    const a = this.kap.afcs;
    const flashing = v.get(KAP.hdgFlash) + v.get(KAP.apFlash) + v.get(KAP.ptFlash) + v.get(KAP.baroFlash) + (this.kap.flashLat ? 1 : 0) + (this.kap.flashGs ? 1 : 0) + v.get(KAP.alert);
    this.animating = flashing > 0;
    const field = v.get(KAP.field);
    const fv = field === 1 ? v.get(AP.selVs) : field === 2 ? v.get(KAP.baroInHg) * 100 + v.get(KAP.baroHpa) * 1e4 : v.get(AP.selAltitude);
    return (
      v.get(KAP.pft) +
      (a.engaged ? 1e3 : 0) +
      a.latArmed.length * 7 +
      a.lat.length * 11 +
      a.vert.length * 13 +
      a.vertArmed * 17 +
      (a.approach ? 1e4 : 0) +
      field * 1e5 +
      fv * 1.1e6 +
      v.get(KAP.pt) * 3e3 +
      v.get(KAP.armAnn) * 5e3 +
      v.get(KAP.encoderValid) * 7e3 +
      (a.lat === 'HDG' ? 1 : a.lat === 'ROL' ? 2 : a.lat === 'BC' ? 3 : 4) * 1.3e4
    );
  }
  protected draw(ctx: Ctx2D): void {
    const v = this.vars!;
    const k = this.kap;
    const a = k.afcs;
    const ink = LCD_INK;
    const pft = v.get(KAP.pft);
    const blink = blinkOn(this.t);
    if (pft > 0 && pft < 99) {
      annText(ctx, 'PFT', 60, 42, 26, ink, 'center');
      drawSeg(ctx, String(pft), 100, 22, 22, 38, ink);
      return;
    }
    if (pft === 99) {
      // Display test: all segments.
      annText(ctx, 'AP  HDG NAV APR REV  ALT VS GS ARM', 190, 20, 14, ink, 'center');
      annText(ctx, 'P', 250, 50, 14, ink, 'center');
      annText(ctx, 'T', 250, 66, 14, ink, 'center');
      drawSeg(ctx, '88888', 262, 34, 20, 34, ink);
      annText(ctx, 'FT FPM IN HPA ALERT', 190, 74, 10, ink, 'center');
      return;
    }
    // Lateral field.
    let lat = k.latLabel();
    if (k.flashLat) lat = blink ? k.flashLat : '';
    else if (lat === 'HDG' && v.get(KAP.hdgFlash) > 0.5 && !blink) lat = '';
    if (lat) annText(ctx, lat, 44, 30, 26, ink, 'center');
    const latArm = k.latArmedLabel();
    if (latArm) {
      annText(ctx, latArm, 44, 62, 16, ink, 'center');
      annText(ctx, 'ARM', 78, 70, 9, ink, 'left');
    }
    // AP engaged annunciation (flashes after a disconnect).
    const apOn = a.engaged || (v.get(KAP.apFlash) > 0.5 && blink);
    if (apOn) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(96, 48, 30, 22);
      annText(ctx, 'AP', 111, 59, 14, ink, 'center');
    }
    // Vertical field.
    let vert = k.vertLabel();
    if (k.flashGs) vert = blink ? 'GS' : '';
    if (vert) annText(ctx, vert, 160, 30, 26, ink, 'center');
    if (k.gsArmed()) {
      annText(ctx, 'GS', 160, 62, 16, ink, 'center');
      annText(ctx, 'ARM', 178, 70, 9, ink, 'left');
    } else if (v.get(KAP.armAnn) > 0.5) annText(ctx, 'ARM', 160, 64, 14, ink, 'center');
    // Pitch trim annunciation: P over T with the arrow; solid (no arrow) = trim fault.
    const pt = v.get(KAP.pt);
    const ptVisible = pt !== 0 && (v.get(KAP.ptFlash) < 0.5 || blink);
    if (ptVisible) {
      annText(ctx, 'P', 214, 26, 15, ink, 'center');
      annText(ctx, 'T', 214, 46, 15, ink, 'center');
      if (pt === 1) annText(ctx, '▲', 214, 10, 10, ink, 'center');
      else if (pt === -1) annText(ctx, '▼', 214, 62, 10, ink, 'center');
    }
    // Right field.
    const field = v.get(KAP.field);
    if (v.get(KAP.alert) > 0.5 && blink) annText(ctx, 'ALERT', 262, 74, 10, ink, 'center');
    if (field === 2 || v.get(KAP.baroFlash) > 0.5) {
      const hpa = v.get(KAP.baroHpa) > 0.5;
      const show = v.get(KAP.baroFlash) < 0.5 || blink;
      if (show) {
        const txt = hpa ? String(Math.round(v.get(KAP.baroInHg) * 33.86389)) : fmtFixed(v.get(KAP.baroInHg), 2);
        drawSeg(ctx, txt.padStart(5, ' '), 240, 16, 22, 38, ink);
      }
      annText(ctx, 'BARO', 262, 66, 11, ink, 'center');
      annText(ctx, hpa ? 'HPA' : 'IN', 340, 66, 11, ink, 'center');
    } else if (field === 1) {
      const vs = Math.round(v.get(AP.selVs) / 100) * 100;
      drawSeg(ctx, String(vs).padStart(5, ' '), 240, 16, 22, 38, ink);
      annText(ctx, 'FPM', 340, 66, 11, ink, 'center');
    } else if (v.get(KAP.encoderValid) > 0.5) {
      const alt = Math.round(v.get(AP.selAltitude));
      drawSeg(ctx, String(alt).padStart(5, ' '), 240, 16, 22, 38, ink);
      annText(ctx, 'FT', 340, 66, 11, ink, 'center');
    } else {
      // Dashed while the blind encoder warms up (Supplement 15 Fig 3 item 4 NOTE).
      drawSeg(ctx, '-----', 240, 16, 22, 38, ink);
      annText(ctx, 'FT', 340, 66, 11, ink, 'center');
    }
  }
}

// ------------------------------------------------------------------ KLN 94

const KLN_BG = '#04070f';
const KLN_CYAN = '#58d8ff';
const KLN_GREEN = '#49e36a';
const KLN_WHITE = '#e8ecf0';
const KLN_MAG = '#f05ae8';
const KLN_YEL = '#f2d23a';
const KLN_FONT = (px: number): string => `600 ${px}px "DejaVu Sans Mono", "Roboto Mono", Consolas, monospace`;

export class Kln94Display extends SigDisplay {
  constructor(
    vars: SimVars,
    private readonly kln: Kln94Logic,
  ) {
    super({ id: 'kln94', width: 340, height: 150, pixelRatio: 2, vars, powerVar: KLN.on, background: KLN_BG, refreshHz: 10 });
  }
  protected sig(): number {
    const k = this.kln;
    const v = this.vars!;
    this.animating = k.screen === 'pages' && (k.pageType === 'NAV' || k.pageType === 'AUX') ? true : k.cursor || v.get(KLN.msg) === 1;
    let s = k.screen.length * 1e3 + k.typeIndex * 17 + k.pageNum[k.typeIndex] * 131 + k.entry.length * 7 + k.entryPos * 3 + k.fplRow * 29;
    s += k.nrstIndex * 37 + k.procIndex * 41 + (k.dtoConfirm ? 1e5 : 0) + k.messages.length * 1e6 + k.apr * 1e7 + (k.obsMode ? 1e8 : 0) + k.baroInHg * 1e3 + v.get(KLN.obs) * 1e4;
    s += this.kln.approaches.length * 43;
    for (let i = 0; i < k.entry.length; i++) s += k.entry.charCodeAt(i) * (i + 1) * 53;
    return s;
  }
  private txt(ctx: Ctx2D, s: string, x: number, y: number, px: number, c: string, align: CanvasTextAlign = 'left'): void {
    ctx.font = KLN_FONT(px);
    ctx.fillStyle = c;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }
  protected draw(ctx: Ctx2D): void {
    const k = this.kln;
    const v = this.vars!;
    switch (k.screen) {
      case 'poweron':
        this.txt(ctx, 'KLN 94', 170, 50, 22, KLN_WHITE, 'center');
        this.txt(ctx, 'BENDIX/KING', 170, 78, 12, KLN_CYAN, 'center');
        this.txt(ctx, 'ORS 03', 170, 104, 12, KLN_GREEN, 'center');
        return;
      case 'selftest':
        this.txt(ctx, 'SELF TEST', 170, 16, 13, KLN_CYAN, 'center');
        this.txt(ctx, `ALT ${fmtPad(Math.round(v.get(ADC.baroAlt(1)) / 10) * 10, 5, ' ')}FT  BARO ${fmtFixed(k.baroInHg, 2)}`, 12, 44, 11, KLN_WHITE);
        this.txt(ctx, 'DIS  34.5NM  CDI  +HALF RIGHT', 12, 64, 11, KLN_WHITE);
        this.txt(ctx, 'RMI 130°   ANNUN ON', 12, 84, 11, KLN_WHITE);
        this.txt(ctx, 'PASS', 12, 120, 13, KLN_GREEN);
        this.cursorBox(ctx, 'OK?', 250, 120);
        return;
      case 'init':
        this.txt(ctx, 'INITIALIZATION', 170, 16, 13, KLN_CYAN, 'center');
        this.txt(ctx, `DATE/TIME  ${fmtClock((v.get('env.time_utc_h') * 3600) % 86400, true)} UTC`, 12, 50, 11, KLN_WHITE);
        this.txt(ctx, `POS ${fmtFixed(Math.abs(v.get(GPS.lat)), 2)}${v.get(GPS.lat) >= 0 ? 'N' : 'S'} ${fmtFixed(Math.abs(v.get(GPS.lon)), 2)}${v.get(GPS.lon) >= 0 ? 'E' : 'W'}`, 12, 72, 11, KLN_WHITE);
        this.cursorBox(ctx, 'OK?', 250, 120);
        return;
      case 'database':
        this.txt(ctx, 'DATABASE', 170, 16, 13, KLN_CYAN, 'center');
        this.txt(ctx, 'AMERICAS', 170, 50, 12, KLN_WHITE, 'center');
        this.txt(ctx, 'BUNDLED OURAIRPORTS / FLIGHTGEAR', 170, 72, 9, KLN_WHITE, 'center');
        this.cursorBox(ctx, 'ACKNOWLEDGE?', 190, 120);
        return;
      case 'dto':
        this.header(ctx, 'DIRECT TO:');
        this.entryLine(ctx, 30, 58);
        if (k.dtoConfirm && k.wpt) {
          this.txt(ctx, `${fmtFixed(this.distTo(k.wpt.lat, k.wpt.lon), 1)}NM  ${fmtPad(Math.round(this.brgTo(k.wpt.lat, k.wpt.lon)) % 360, 3)}°`, 30, 92, 12, KLN_WHITE);
          this.cursorBox(ctx, 'ENT TO CONFIRM', 170, 124);
        }
        this.status(ctx);
        return;
      case 'nrst': {
        this.header(ctx, 'NEAREST AIRPORTS');
        for (let i = 0; i < Math.min(5, k.nearest.length); i++) {
          const a = k.nearest[i];
          const y = 36 + i * 17;
          const sel = i === k.nrstIndex;
          if (sel) {
            ctx.fillStyle = '#1f3a66';
            ctx.fillRect(4, y - 8, 332, 16);
          }
          this.txt(ctx, a.icao, 10, y, 12, sel ? KLN_WHITE : KLN_CYAN);
          this.txt(ctx, `${fmtFixed(this.distTo(a.lat, a.lon), 1)}NM`, 200, y, 12, KLN_GREEN, 'right');
          this.txt(ctx, `${fmtPad(Math.round(this.brgTo(a.lat, a.lon)) % 360, 3)}°`, 250, y, 12, KLN_GREEN);
        }
        if (!k.nearest.length) this.txt(ctx, 'NO AIRPORTS', 170, 70, 12, KLN_WHITE, 'center');
        this.status(ctx);
        return;
      }
      case 'msg':
        this.header(ctx, 'MESSAGES');
        for (let i = 0; i < Math.min(6, k.messages.length); i++) this.txt(ctx, k.messages[i].text, 10, 38 + i * 16, 12, KLN_YEL);
        this.status(ctx);
        return;
      case 'alt':
        this.header(ctx, 'ALT 1');
        this.txt(ctx, `ALT ${fmtPad(Math.round(v.get(ADC.baroAlt(1)) / 10) * 10, 5, ' ')}FT`, 20, 60, 14, KLN_WHITE);
        this.txt(ctx, `BARO: ${fmtFixed(k.baroInHg, 2)}"`, 20, 90, 14, KLN_CYAN);
        this.status(ctx);
        return;
      case 'proc': {
        this.header(ctx, `APPROACHES ${this.kln.fms.plans.active.destination?.icao ?? ''}`);
        if (k.procLoading) this.txt(ctx, 'LOADING...', 170, 70, 12, KLN_WHITE, 'center');
        for (let i = 0; i < Math.min(5, k.approaches.length); i++) {
          const y = 38 + i * 17;
          const sel = i === k.procIndex;
          if (sel) {
            ctx.fillStyle = '#1f3a66';
            ctx.fillRect(4, y - 8, 332, 16);
          }
          this.txt(ctx, k.approaches[i].ident, 10, y, 12, sel ? KLN_WHITE : KLN_CYAN);
        }
        if (!k.procLoading && !k.approaches.length) this.txt(ctx, 'NO APPROACHES', 170, 70, 12, KLN_WHITE, 'center');
        this.status(ctx);
        return;
      }
      case 'pages':
        this.page(ctx);
        this.status(ctx);
        return;
      default:
        return;
    }
  }
  private header(ctx: Ctx2D, t: string): void {
    ctx.fillStyle = '#12254a';
    ctx.fillRect(0, 0, 340, 18);
    this.txt(ctx, t, 6, 9, 12, KLN_CYAN);
  }
  private cursorBox(ctx: Ctx2D, t: string, x: number, y: number): void {
    ctx.font = KLN_FONT(12);
    const w = ctx.measureText(t).width + 8;
    ctx.fillStyle = blinkOn(this.t) ? KLN_CYAN : '#1f5f7a';
    ctx.fillRect(x - w / 2, y - 9, w, 18);
    this.txt(ctx, t, x, y, 12, KLN_BG, 'center');
  }
  private entryLine(ctx: Ctx2D, x: number, y: number): void {
    const k = this.kln;
    const e = k.entry.padEnd(5, ' ');
    for (let i = 0; i < 5; i++) {
      const cx = x + i * 16;
      if (k.cursor && i === k.entryPos) {
        ctx.fillStyle = blinkOn(this.t) ? KLN_CYAN : '#1f5f7a';
        ctx.fillRect(cx - 1, y - 11, 15, 22);
      }
      this.txt(ctx, e[i], cx + 6, y, 18, k.cursor && i === k.entryPos ? KLN_BG : KLN_WHITE, 'center');
    }
  }
  private distTo(lat: number, lon: number): number {
    return distanceNm(this.vars!.get(GPS.lat), this.vars!.get(GPS.lon), lat, lon);
  }
  private brgTo(lat: number, lon: number): number {
    const v = this.vars!;
    return wrap360(initialBearing(v.get(GPS.lat), v.get(GPS.lon), lat, lon) - v.get(GPS.magVar));
  }
  /** Bottom status line: mode (LEG/OBS), page name, message prompt, approach annunciation (Pilot's Guide 3.4). */
  private status(ctx: Ctx2D): void {
    const k = this.kln;
    const v = this.vars!;
    ctx.fillStyle = '#12254a';
    ctx.fillRect(0, 134, 340, 16);
    this.txt(ctx, k.obsMode ? `OBS ${fmtPad(Math.round(v.get(KLN.obs)) % 360, 3)}` : 'LEG', 6, 142, 11, KLN_GREEN);
    this.txt(ctx, k.screen === 'pages' ? `${k.pageType} ${k.pageNum[k.typeIndex]}` : '', 170, 142, 11, KLN_WHITE, 'center');
    const msg = v.get(KLN.msg);
    if (msg === 2 || (msg === 1 && blinkOn(this.t))) this.txt(ctx, 'MSG', 250, 142, 11, KLN_YEL);
    this.txt(ctx, k.apr === 2 ? 'ACTV' : k.apr === 1 ? 'ARM' : 'ENR', 334, 142, 11, KLN_CYAN, 'right');
  }
  private page(ctx: Ctx2D): void {
    const k = this.kln;
    const v = this.vars!;
    const n = k.pageNum[k.typeIndex];
    const type = KLN_PAGE_TYPES[k.typeIndex];
    if (!k.navReady && type === 'NAV') {
      this.header(ctx, `NAV ${n}`);
      this.txt(ctx, 'NAV FLAG / NO GPS FIX', 170, 70, 12, KLN_YEL, 'center');
      return;
    }
    if (type === 'NAV' && n === 1) {
      this.header(ctx, 'NAV 1');
      const from = v.getString(FMS.fromWptIdent);
      const to = v.getString(FMS.nextWptIdent);
      this.txt(ctx, from || '----', 10, 32, 14, KLN_CYAN);
      this.txt(ctx, v.get(FMS.toFrom) < 0 ? 'FR' : '→', 120, 32, 14, KLN_WHITE, 'center');
      this.txt(ctx, to || '----', 150, 32, 14, KLN_MAG);
      // CDI bar (+/- 5 dots) with the deviation.
      const cx = 170;
      for (let i = -5; i <= 5; i++) {
        ctx.fillStyle = KLN_WHITE;
        ctx.fillRect(cx + i * 14 - 1, 56, 3, 3);
      }
      const cdi = v.get(KLN.cdi);
      ctx.fillStyle = KLN_MAG;
      ctx.fillRect(cx + cdi * 70 - 2, 46, 5, 22);
      this.txt(ctx, `DIS ${fmtFixed(v.get(FMS.distToWptNm), 1)}NM`, 10, 86, 12, KLN_GREEN);
      this.txt(ctx, `GS ${fmtPad(Math.round(v.get(GPS.gs)), 3, ' ')}KT`, 190, 86, 12, KLN_GREEN);
      this.txt(ctx, `DTK ${fmtPad(Math.round(v.get(FMS.dtkMag)) % 360, 3)}°`, 10, 106, 12, KLN_GREEN);
      this.txt(ctx, `ETE ${fmtClock(v.get(FMS.eteToWptS), true)}`, 190, 106, 12, KLN_GREEN);
      this.txt(ctx, `BRG ${fmtPad(Math.round(v.get(FMS.bearingToWptMag)) % 360, 3)}°`, 10, 124, 12, KLN_GREEN);
      return;
    }
    if (type === 'NAV' && n === 2) {
      this.header(ctx, 'NAV 2  PRESENT POSN');
      const lat = v.get(GPS.lat);
      const lon = v.get(GPS.lon);
      this.txt(ctx, `${lat >= 0 ? 'N' : 'S'} ${fmtFixed(Math.abs(lat), 3)}°`, 20, 60, 16, KLN_WHITE);
      this.txt(ctx, `${lon >= 0 ? 'E' : 'W'} ${fmtFixed(Math.abs(lon), 3)}°`, 20, 90, 16, KLN_WHITE);
      return;
    }
    if (type === 'NAV' && n === 4) {
      this.map(ctx);
      return;
    }
    if (type === 'APT') {
      this.header(ctx, `APT ${n}`);
      this.entryLine(ctx, 20, 44);
      if (k.apt) {
        this.txt(ctx, k.apt.name.slice(0, 26).toUpperCase(), 20, 74, 11, KLN_WHITE);
        this.txt(ctx, `${fmtFixed(this.distTo(k.apt.lat, k.apt.lon), 1)}NM  ${fmtPad(Math.round(this.brgTo(k.apt.lat, k.apt.lon)) % 360, 3)}°  ELEV ${Math.round(k.apt.elevationFt)}FT`, 20, 96, 11, KLN_GREEN);
      }
      return;
    }
    if (type === 'FPL') {
      this.header(ctx, 'FPL 0  ACTIVE');
      const plan = k.fms.plans.active;
      const first = Math.max(0, Math.min(k.fplRow - 3, plan.legs.length - 5));
      for (let i = 0; i < 6; i++) {
        const idx = first + i;
        const y = 32 + i * 17;
        if (idx < plan.legs.length) {
          const leg = plan.legs[idx];
          const active = idx === plan.activeLegIndex;
          this.txt(ctx, `${idx + 1}`, 14, y, 11, KLN_WHITE, 'right');
          this.txt(ctx, leg.fix?.ident ?? '', 24, y, 12, active ? KLN_MAG : KLN_CYAN);
          if (k.cursor && idx === k.fplRow) this.txt(ctx, '<', 110, y, 12, KLN_YEL);
        } else if (idx === plan.legs.length) {
          if (k.cursor && k.fplRow === idx) this.entryLine(ctx, 24, y);
          else this.txt(ctx, '_____', 24, y, 12, KLN_WHITE);
          break;
        }
      }
      return;
    }
    this.header(ctx, `${type} ${n}`);
    if (type === 'SET') this.txt(ctx, `BARO ${fmtFixed(k.baroInHg, 2)}`, 20, 60, 13, KLN_WHITE);
    else if (type === 'AUX') this.txt(ctx, `GPS ${v.get(GPS.valid) > 0.5 ? 'NAV' : 'ACQ'}  SATS ${Math.round(v.get('gps.sats', 8))}`, 20, 60, 13, KLN_WHITE);
    else this.txt(ctx, 'NO DATA', 170, 70, 12, KLN_WHITE, 'center');
  }
  /** NAV 4 moving map: track-up, route and active leg, present position (Pilot's Guide 3.13, simplified). */
  private map(ctx: Ctx2D): void {
    const k = this.kln;
    const v = this.vars!;
    const range = KLN_RANGES[k.rangeIndex];
    const cx = 170;
    const cy = 112;
    const ppn = 100 / range;
    const trk = v.get(GPS.trackTrue) * (Math.PI / 180);
    const lat0 = v.get(GPS.lat);
    const lon0 = v.get(GPS.lon);
    const cosL = Math.cos(lat0 * (Math.PI / 180));
    const legs = k.fms.plans.active.legs;
    ctx.strokeStyle = KLN_WHITE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let first = true;
    let ax = 0;
    let ay = 0;
    for (let i = 0; i < legs.length; i++) {
      const w = legs[i].fix;
      if (!w) continue;
      const dx = (w.lon - lon0) * 60 * cosL;
      const dy = (w.lat - lat0) * 60;
      const rx = dx * Math.cos(trk) - dy * Math.sin(trk);
      const ry = dx * Math.sin(trk) + dy * Math.cos(trk);
      const x = cx + rx * ppn;
      const y = cy - ry * ppn;
      if (i === k.fms.plans.active.activeLegIndex) {
        ax = x;
        ay = y;
      }
      if (first) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      first = false;
    }
    ctx.stroke();
    if (ax || ay) {
      ctx.fillStyle = KLN_MAG;
      ctx.fillRect(ax - 3, ay - 3, 6, 6);
    }
    // Own ship.
    ctx.fillStyle = KLN_WHITE;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx + 6, cy + 6);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(cx - 6, cy + 6);
    ctx.closePath();
    ctx.fill();
    this.txt(ctx, `${range}`, 8, 10, 11, KLN_CYAN);
    this.txt(ctx, 'TK↑', 332, 10, 11, KLN_CYAN, 'right');
  }
}

// ------------------------------------------------------------------ hour meter

/** Hobbs hour meter (POH Fig 7-2 item 23): 5 digits + tenths drum. */
export class HobbsDisplay extends SigDisplay {
  constructor(vars: SimVars) {
    super({ id: 'hobbs', width: 180, height: 44, pixelRatio: 1.5, vars, powerVar: null, brightnessVar: null, background: '#101010', refreshHz: 2 });
  }
  protected sig(): number {
    return Math.floor(this.vars!.get(C172.hobbsHours) * 10);
  }
  protected draw(ctx: Ctx2D): void {
    const tenths = Math.floor(this.vars!.get(C172.hobbsHours) * 10);
    const txt = fmtPad(Math.floor(tenths / 10) % 100000, 5);
    ctx.font = '700 30px "DejaVu Sans Mono", Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = '#e9e9e2';
      ctx.fillText(txt[i], 16 + i * 28, 23);
    }
    ctx.fillStyle = '#e9e9e2';
    ctx.fillRect(148, 4, 28, 36);
    ctx.fillStyle = '#111';
    ctx.fillText(String(tenths % 10), 162, 23);
  }
}
