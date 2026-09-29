/**
 * G800 head-up display symbology on the pilot's combiner (G700/G800 HUD with EFVS; FSB GVIII-G700 App. 4 HUD / EVS
 * rocker). Adapted from the G650 HUD display (src/aircraft/g650/cockpit/hud.ts, aircraft-local copy): conformal
 * 30 x 24 deg field, horizon and pitch ladder, boresight, flight path vector (GPS), FD guidance cue, bank scale,
 * airspeed / altitude boxes with the selected values, VS, heading, radio altitude.
 * Luminance from the HUD computer (systems/hud.ts: HUD BRT / MAN-AUTO / CONTR -> `ac.g800.hud_lum`); the EVS / CVS
 * video (sidestick HUD rocker, VIDEO BRT -> `ac.g800.hud_video`) is drawn as a dim green raster behind the symbols.
 * Sensors: pilot-side ADC / IRS (adc1 / ahrs1) and GPS (CLAUDE.md). SCOPE: no EVS imagery, runway symbology, flare cue,
 * declutter modes, windshear or TCAS symbology.
 */
import { CanvasDisplay, type DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../avionics/common/draw/context';
import type { SimVars } from '../../../core/SimVars';
import { ADC, AP, GPS } from '../../../core/vars';
import { HUD } from "./layout";

const W = 600;
const H = 480;
/** Pixels per degree (conformal: W / horizontal FOV = H / vertical FOV). */
const PPD = W / HUD.fovHDeg;
const GREEN = '#33ff66';
const D2R = Math.PI / 180;
const DASH: number[] = [10, 8];
const SOLID: number[] = [];

export const HUD_DISPLAY_ID = 'g800.hud';
/** Copilot HUD display (dual HUD, fix round 1 L02). */
export const HUD_DISPLAY_ID_R = 'g800.hud2';

export class G800HudDisplay extends CanvasDisplay {
  private readonly v: SimVars;
  /** Side 1 pilot (adc1/ahrs1/ra1, FD1), side 2 copilot (adc2/ahrs2/ra2, FD2). Appended (dual HUD, L02). */
  private readonly side: 1 | 2;
  private readonly videoVar: string;
  private readonly fdOnVar: string;
  private readonly raAltVar: string;
  private readonly raValidVar: string;

  constructor(vars: SimVars, canvas?: DisplayCanvas, side: 1 | 2 = 1) {
    super({ id: side === 1 ? HUD_DISPLAY_ID : HUD_DISPLAY_ID_R, width: W, height: H, vars, refreshHz: 30, canvas, background: '#000000', brightnessVar: side === 1 ? 'ac.g800.hud_lum' : 'ac.g800.hud2_lum' });
    this.v = vars;
    this.side = side;
    this.videoVar = side === 1 ? 'ac.g800.hud_video' : 'ac.g800.hud2_video';
    this.fdOnVar = `ap.fd${side}_on`;
    this.raAltVar = `ra${side}.alt_ft`;
    this.raValidVar = `ra${side}.valid`;
    for (const [n, q] of [
      [ADC.pitch(side), 0.05],
      [ADC.bank(side), 0.1],
      [ADC.heading(side), 0.2],
      [ADC.ias(side), 0.5],
      [ADC.baroAlt(side), 5],
      [ADC.vs(side), 20],
      [GPS.gs, 1],
      [GPS.trackMag, 0.2],
      [GPS.vs, 20],
      [AP.fdPitch, 0.1],
      [AP.fdBank, 0.2],
      [this.fdOnVar, 0],
      ['ap.sel_alt_ft', 0],
      ['ap.sel_spd_kt', 0],
      [this.raAltVar, 5],
      [this.videoVar, 0.02],
    ] as [string, number][])
      this.watch(n, q);
  }

  private box(ctx: Ctx2D, x: number, y: number, w: number, s: string): void {
    ctx.strokeRect(x - w / 2, y - 15, w, 30);
    ctx.fillText(s, x, y);
  }

  protected draw(ctx: Ctx2D): void {
    const v = this.v;
    const side = this.side;
    const pitch = v.get(ADC.pitch(side));
    const bank = v.get(ADC.bank(side));
    const hdg = v.get(ADC.heading(side));
    const dcl = 0;
    // EVS / CVS video raster (dim green scan lines, SCOPE: no imagery).
    const video = v.get(this.videoVar);
    if (video > 0.01) {
      ctx.fillStyle = `rgba(40, 160, 70, ${(0.25 * video).toFixed(3)})`;
      for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
    }
    const cx = W / 2;
    const cy = H / 2;
    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.font = 'bold 20px monospace';
    ctx.textBaseline = 'middle';

    // ---- horizon and pitch ladder, rotated by bank about the boresight.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-bank * D2R);
    const hy = pitch * PPD;
    ctx.beginPath();
    ctx.moveTo(-W, hy);
    ctx.lineTo(-40, hy);
    ctx.moveTo(40, hy);
    ctx.lineTo(W, hy);
    ctx.stroke();
    if (dcl < 1) {
      // Heading marks on the horizon every 10 deg.
      for (let d = -20; d <= 20; d += 10) {
        const h = Math.round((hdg + d) / 10) * 10;
        const x = (h - hdg) * PPD;
        ctx.beginPath();
        ctx.moveTo(x, hy);
        ctx.lineTo(x, hy - 10);
        ctx.stroke();
      }
    }
    for (let p = -30; p <= 30; p += 5) {
      if (p === 0) continue;
      if (p < 0 && dcl >= 1) continue;
      const y = hy - p * PPD;
      if (y < -H || y > H) continue;
      ctx.setLineDash(p < 0 ? DASH : SOLID);
      ctx.beginPath();
      ctx.moveTo(-110, y + (p < 0 ? -8 : 8));
      ctx.lineTo(-110, y);
      ctx.lineTo(-45, y);
      ctx.moveTo(45, y);
      ctx.lineTo(110, y);
      ctx.lineTo(110, y + (p < 0 ? -8 : 8));
      ctx.stroke();
      ctx.setLineDash(SOLID);
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.abs(p)), -118, y);
      ctx.textAlign = 'left';
      ctx.fillText(String(Math.abs(p)), 118, y);
    }
    ctx.restore();

    // ---- boresight (aircraft reference).
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy);
    ctx.lineTo(cx - 8, cy);
    ctx.lineTo(cx, cy + 8);
    ctx.lineTo(cx + 8, cy);
    ctx.lineTo(cx + 18, cy);
    ctx.stroke();

    // ---- flight path vector: flight path angle and drift from the GPS (EST: blank below 30 kt ground speed).
    const gs = v.get(GPS.gs);
    let fx = cx;
    let fy = cy;
    if (gs > 30) {
      const gamma = Math.atan2(v.get(GPS.vs) / 60, gs * 1.68781) / D2R;
      let drift = v.get(GPS.trackMag) - hdg;
      drift = ((drift + 540) % 360) - 180;
      fx = cx + Math.max(-12, Math.min(12, drift)) * PPD;
      fy = cy - (gamma - pitch) * PPD;
      ctx.beginPath();
      ctx.arc(fx, fy, 9, 0, Math.PI * 2);
      ctx.moveTo(fx - 9, fy);
      ctx.lineTo(fx - 26, fy);
      ctx.moveTo(fx + 9, fy);
      ctx.lineTo(fx + 26, fy);
      ctx.moveTo(fx, fy - 9);
      ctx.lineTo(fx, fy - 18);
      ctx.stroke();
      // Flight director guidance cue (small circle to be captured with the FPV).
      if (v.get(this.fdOnVar) !== 0) {
        const gx = fx + Math.max(-60, Math.min(60, (v.get(AP.fdBank) - bank) * 2));
        const gy = fy - Math.max(-80, Math.min(80, (v.get(AP.fdPitch) - pitch) * PPD));
        ctx.beginPath();
        ctx.arc(gx, gy, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ---- bank scale (top) and pointer.
    if (dcl < 2) {
      const r = 180;
      ctx.beginPath();
      for (const a of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) {
        const t = (a - 90) * D2R;
        const l = a % 30 === 0 ? 14 : 8;
        ctx.moveTo(cx + r * Math.cos(t), cy + 20 + r * Math.sin(t) * 1.0);
        ctx.lineTo(cx + (r - l) * Math.cos(t), cy + 20 + (r - l) * Math.sin(t));
      }
      ctx.stroke();
      const t = (-bank - 90) * D2R;
      const px = cx + (r - 18) * Math.cos(t);
      const py = cy + 20 + (r - 18) * Math.sin(t);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - 7 * Math.cos(t + 0.5), py - 7 * Math.sin(t + 0.5));
      ctx.lineTo(px - 7 * Math.cos(t - 0.5), py - 7 * Math.sin(t - 0.5));
      ctx.closePath();
      ctx.stroke();
    }

    // ---- airspeed (left) and altitude (right) boxes with the selected values; VS; heading; RA.
    ctx.textAlign = 'center';
    this.box(ctx, 70, cy, 80, String(Math.round(v.get(ADC.ias(side)))));
    ctx.fillText(String(Math.round(v.get('ap.sel_spd_kt'))), 70, cy - 40);
    const alt = v.get(ADC.baroAlt(side));
    this.box(ctx, W - 70, cy, 96, String(Math.round(alt / 10) * 10));
    ctx.fillText(String(Math.round(v.get('ap.sel_alt_ft') / 100) * 100), W - 70, cy - 40);
    ctx.font = 'bold 16px monospace';
    const vs = Math.round(v.get(ADC.vs(side)) / 10) * 10;
    ctx.fillText(`${vs > 0 ? '+' : ''}${vs}`, W - 70, cy + 34);
    const hd = Math.round(((hdg % 360) + 360) % 360) || 360;
    ctx.font = 'bold 20px monospace';
    this.box(ctx, cx, 22, 60, String(hd).padStart(3, '0'));
    const ra = v.get(this.raAltVar, 9999);
    if (ra < 2500 && v.get(this.raValidVar, 1) !== 0) ctx.fillText(`${Math.round(ra / 5) * 5}R`, cx, H - 60);
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`GS ${Math.round(gs)}`, 16, H - 24);
  }
}
