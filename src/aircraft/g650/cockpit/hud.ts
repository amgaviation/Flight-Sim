/**
 * Head-up display for the G650 pilot seat (optional equipment: Rockwell
 * Collins HGS with EVS II, "a standard LCD Head-Up Display from Rockwell
 * Collins with Enhanced Vision Systems (EVS II)", Gulfstream / Honeywell
 * PlaneView II descriptions). The Epic suite only keeps the HUD page state
 * (`epic.hud.on / dcltr / brt`, SMC HUD page, docs/modules/avionics-honeywell-epic.md
 * §15); this display draws the primary symbology on the combiner.
 *
 * Symbology (conformal, 30 x 24 deg field of view, EST after HGS-6000 class
 * displays): horizon line with heading marks, pitch ladder (5 deg steps,
 * dashed below the horizon), boresight, flight path vector (GPS flight path
 * angle and drift), flight director guidance cue, bank scale and pointer,
 * airspeed and altitude boxes with the selected values, vertical speed,
 * magnetic heading, radio altitude below 2,500 ft. DCLTR 1 removes the ladder
 * below the horizon and the heading marks, DCLTR 2 also the bank scale.
 * Sensors are the pilot-side ADC / IRS (adc1 / ahrs1) and GPS (CLAUDE.md:
 * avionics read sensor vars). SCOPE: no EVS picture, no runway symbology,
 * no flare cue / AIII mode, no windshear or TCAS symbology.
 */
import { CanvasDisplay, type DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../avionics/common/draw/context';
import type { SimVars } from '../../../core/SimVars';
import { ADC, AP, GPS } from '../../../core/vars';
import { HUD } from './layout';

const W = 600;
const H = 480;
/** Pixels per degree (conformal: W / horizontal FOV = H / vertical FOV). */
const PPD = W / HUD.fovHDeg;
const GREEN = '#33ff66';
const D2R = Math.PI / 180;
const DASH: number[] = [10, 8];
const SOLID: number[] = [];

export const HUD_DISPLAY_ID = 'g650.hud';

export class G650HudDisplay extends CanvasDisplay {
  private readonly v: SimVars;

  constructor(vars: SimVars, canvas?: DisplayCanvas) {
    super({ id: HUD_DISPLAY_ID, width: W, height: H, vars, refreshHz: 30, canvas, background: '#000000', brightnessVar: 'epic.hud.brt' });
    this.v = vars;
    for (const [n, q] of [
      [ADC.pitch(1), 0.05],
      [ADC.bank(1), 0.1],
      [ADC.heading(1), 0.2],
      [ADC.ias(1), 0.5],
      [ADC.baroAlt(1), 5],
      [ADC.vs(1), 20],
      [GPS.gs, 1],
      [GPS.trackMag, 0.2],
      [GPS.vs, 20],
      [AP.fdPitch, 0.1],
      [AP.fdBank, 0.2],
      ['ap.fd1_on', 0],
      ['ap.sel_alt_ft', 0],
      ['ap.sel_spd_kt', 0],
      ['ra1.alt_ft', 5],
      ['epic.hud.dcltr', 0],
    ] as [string, number][])
      this.watch(n, q);
  }

  private box(ctx: Ctx2D, x: number, y: number, w: number, s: string): void {
    ctx.strokeRect(x - w / 2, y - 15, w, 30);
    ctx.fillText(s, x, y);
  }

  protected draw(ctx: Ctx2D): void {
    const v = this.v;
    const pitch = v.get(ADC.pitch(1));
    const bank = v.get(ADC.bank(1));
    const hdg = v.get(ADC.heading(1));
    const dcl = v.get('epic.hud.dcltr');
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
      if (v.get('ap.fd1_on') !== 0) {
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
    this.box(ctx, 70, cy, 80, String(Math.round(v.get(ADC.ias(1)))));
    ctx.fillText(String(Math.round(v.get('ap.sel_spd_kt'))), 70, cy - 40);
    const alt = v.get(ADC.baroAlt(1));
    this.box(ctx, W - 70, cy, 96, String(Math.round(alt / 10) * 10));
    ctx.fillText(String(Math.round(v.get('ap.sel_alt_ft') / 100) * 100), W - 70, cy - 40);
    ctx.font = 'bold 16px monospace';
    const vs = Math.round(v.get(ADC.vs(1)) / 10) * 10;
    ctx.fillText(`${vs > 0 ? '+' : ''}${vs}`, W - 70, cy + 34);
    const hd = Math.round(((hdg % 360) + 360) % 360) || 360;
    ctx.font = 'bold 20px monospace';
    this.box(ctx, cx, 22, 60, String(hd).padStart(3, '0'));
    const ra = v.get('ra1.alt_ft', 9999);
    if (ra < 2500 && v.get('ra1.valid', 1) !== 0) ctx.fillText(`${Math.round(ra / 5) * 5}R`, cx, H - 60);
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`GS ${Math.round(gs)}`, 16, H - 24);
  }
}
