/**
 * Overhead instruments of the 737-800 drawn on canvases (electromechanical
 * look, <= 30 Hz; CLAUDE.md: gauges <= 60 Hz):
 *
 *  - `ScaleDial`: round dial with one or more concentric scales and a
 *    needle per scale: fuel temperature, duct pressure (L / R needles), APU
 *    EGT, cabin / duct temperature, cabin altitude with the inner
 *    differential-pressure scale, cabin rate of climb, outflow valve
 *    position, crew oxygen pressure, yaw damper position.
 *  - `IsduDisplay`: IRS display unit (ISDU) windows on the aft overhead
 *    (FCOM 11.20 "IRS display unit"): left / right data windows, format
 *    from the DSPL SEL (TEST, TK/GS, PPOS, WIND, HDG/STS), and the keyboard
 *    entry echo.
 *
 * Scales (FCOM 1.30 panel figures, photographs; EST where noted):
 *  - FUEL TEMP -50..+50 deg C (NG fuel temperature indicator).
 *  - DUCT PRESS 0..80 psi, needles L and R.
 *  - APU EGT 0..12 x 100 deg C (EST scale; red radial at the start limit, EST).
 *  - TEMP (air conditioning) 0..100 deg C.
 *  - CABIN ALT 0..50 x 1000 ft outer, DIFF PRESS 0..10 psi inner, red radial
 *    at 9.1 psi (LIM max differential).
 *  - CABIN CLIMB -4..+4 x 1000 fpm, zero at 9 o'clock.
 *  - Crew OXYGEN 0..2000 psi (EST scale for the 1,850 psi cylinder).
 */
import { CanvasDisplay } from '../../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../../avionics/common/draw/context';
import { FONT_STACKS, fontString } from '../../../../avionics/common/fonts';
import type { SimVars } from '../../../../core/SimVars';
import { B738 } from '../../vars';

const D2R = Math.PI / 180;
const SANS = FONT_STACKS.honeywell;

export interface DialScale {
  /** Needle / tick angle (deg clockwise from 12 o'clock) of a value. */
  angle: (v: number) => number;
  ticks: { v: number; label?: string; major?: boolean }[];
  /** Tick outer radius (px of the 256 canvas). Default 112. */
  radius?: number;
  /** Label radius. Default radius - 34. */
  labelRadius?: number;
  labelSize?: number;
  bands?: { from: number; to: number; color: string }[];
}

export interface DialNeedleDef {
  var: string;
  scale?: number;
  color?: string;
  tag?: string;
  /** Tip radius (px). Default the scale radius - 8. */
  length?: number;
  width?: number;
}

export interface ScaleDialOptions {
  id: string;
  vars: SimVars;
  powerVar?: string | null;
  scales: DialScale[];
  needles: DialNeedleDef[];
  title: string[];
  titleY?: number;
  quantum?: number;
  canvas?: 'dom' | 'offscreen';
}

export class ScaleDial extends CanvasDisplay {
  private readonly o: ScaleDialOptions;
  private readonly v: SimVars;

  constructor(o: ScaleDialOptions) {
    super({ id: o.id, width: 256, height: 256, vars: o.vars, powerVar: o.powerVar === undefined ? null : o.powerVar, refreshHz: 30, canvas: o.canvas, background: '#0d0e0f' });
    this.o = o;
    this.v = o.vars;
    for (const n of o.needles) this.watch(n.var, o.quantum ?? 0.002);
  }

  protected draw(ctx: Ctx2D): void {
    const o = this.o;
    const cx = 128;
    const cy = 128;
    ctx.fillStyle = '#0d0e0f';
    ctx.fillRect(0, 0, 256, 256);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of o.scales) {
      const R = s.radius ?? 112;
      for (const b of s.bands ?? []) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 7;
        ctx.beginPath();
        const a0 = s.angle(b.from);
        const a1 = s.angle(b.to);
        ctx.arc(cx, cy, R - 4, (Math.min(a0, a1) - 90) * D2R, (Math.max(a0, a1) - 90) * D2R);
        ctx.stroke();
      }
      ctx.strokeStyle = '#f2f2ee';
      ctx.fillStyle = '#f2f2ee';
      for (const t of s.ticks) {
        const a = s.angle(t.v) * D2R;
        const sn = Math.sin(a);
        const cs = -Math.cos(a);
        const major = t.major !== false;
        ctx.lineWidth = major ? 3 : 1.5;
        const r0 = major ? R - 16 : R - 9;
        ctx.beginPath();
        ctx.moveTo(cx + sn * r0, cy + cs * r0);
        ctx.lineTo(cx + sn * R, cy + cs * R);
        ctx.stroke();
        if (t.label) {
          ctx.font = fontString(s.labelSize ?? 20, SANS, 'bold');
          const lr = s.labelRadius ?? R - 32;
          ctx.fillText(t.label, cx + sn * lr, cy + cs * lr);
        }
      }
    }
    ctx.fillStyle = '#f2f2ee';
    ctx.font = fontString(14, SANS, 'bold');
    o.title.forEach((line, i) => ctx.fillText(line, cx, (o.titleY ?? 176) + i * 16));
    for (const n of o.needles) {
      const s = o.scales[n.scale ?? 0];
      const a = s.angle(this.v.get(n.var)) * D2R;
      const len = n.length ?? (s.radius ?? 112) - 8;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.fillStyle = n.color ?? '#f6f6f2';
      const w = n.width ?? 7;
      ctx.beginPath();
      ctx.moveTo(-w / 2, 16);
      ctx.lineTo(-w / 2, -len + 22);
      ctx.lineTo(0, -len);
      ctx.lineTo(w / 2, -len + 22);
      ctx.lineTo(w / 2, 16);
      ctx.closePath();
      ctx.fill();
      if (n.tag) {
        ctx.fillStyle = '#000';
        ctx.font = fontString(12, SANS, 'bold');
        ctx.fillText(n.tag, 0, -len + 34);
      }
      ctx.restore();
    }
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Linear angle mapping helper: value v0 at a0 deg, v1 at a1 deg (clamped). */
export function lin(v0: number, v1: number, a0: number, a1: number): (v: number) => number {
  return (v) => {
    const t = Math.max(0, Math.min(1, (v - v0) / (v1 - v0)));
    return a0 + (a1 - a0) * t;
  };
}

/** Evenly spaced ticks with labels every `labelEvery` (value formatter). */
export function ticks(v0: number, v1: number, step: number, labelEvery: number, fmt: (v: number) => string = (v) => String(v)): DialScale['ticks'] {
  const out: DialScale['ticks'] = [];
  const n = Math.round((v1 - v0) / step);
  for (let i = 0; i <= n; i++) {
    const v = v0 + i * step;
    const lab = Math.abs(Math.round(v / labelEvery) * labelEvery - v) < step * 0.01;
    out.push({ v, label: lab ? fmt(v) : undefined, major: lab });
  }
  return out;
}

// ============================================================== ISDU

const pad = (n: number, w: number) => String(Math.floor(Math.abs(n))).padStart(w, '0');

/**
 * IRS display unit windows: left and right data fields (FCOM 11.20). DSPL SEL
 * TEST lights every segment; TK/GS: true track / ground speed; PPOS: latitude /
 * longitude; WIND: true wind direction / speed; HDG/STS: true heading / minutes
 * to alignment. While digits are keyed on the ISDU keyboard the entry is shown
 * in the left window (SCOPE: the entry is echoed; ENT then signals the present
 * position entry to the IRSs, which take the aircraft position).
 */
export class IsduDisplay extends CanvasDisplay {
  private readonly v: SimVars;
  constructor(
    vars: SimVars,
    id: string,
    private readonly entry: () => string,
    canvas?: 'dom' | 'offscreen',
  ) {
    super({ id, width: 512, height: 96, vars, powerVar: null, refreshHz: 10, canvas, background: '#060606' });
    this.v = vars;
    for (const n of [B738.lt.isduText('l'), B738.lt.isduText('r'), B738.isduSel, B738.isduSys, 'irs1.state', 'irs2.state', 'ac.b738.ck.isdu_entry_n']) this.watch(n, 0.01);
  }

  protected draw(ctx: Ctx2D): void {
    const v = this.v;
    ctx.fillStyle = '#060606';
    ctx.fillRect(0, 0, 512, 96);
    const ir = v.get(B738.isduSys) >= 0.5 ? 2 : 1;
    const on = v.get(`irs${ir}.state`) !== 0;
    ctx.textBaseline = 'middle';
    ctx.font = fontString(46, FONT_STACKS.lcd, 'bold');
    ctx.fillStyle = '#ff9a2a';
    const e = this.entry();
    if (e) {
      ctx.textAlign = 'left';
      ctx.fillText(e, 16, 50);
      return;
    }
    if (!on) return;
    const sel = Math.round(v.get(B738.isduSel));
    const l = v.get(B738.lt.isduText('l'));
    const r = v.get(B738.lt.isduText('r'));
    let a = '';
    let b = '';
    if (sel === 0) {
      a = '8888888';
      b = '8888888';
    } else if (sel === 1) {
      a = `${pad(((l % 360) + 360) % 360, 3)}.${Math.floor((((l % 1) + 1) % 1) * 10)}`;
      b = pad(r, 3);
    } else if (sel === 2) {
      const lm = Math.abs(l) * 60;
      const om = Math.abs(r) * 60;
      a = `${l >= 0 ? 'N' : 'S'}${pad(lm / 60, 2)} ${(lm % 60).toFixed(1).padStart(4, '0')}`;
      b = `${r >= 0 ? 'E' : 'W'}${pad(om / 60, 3)} ${(om % 60).toFixed(1).padStart(4, '0')}`;
    } else if (sel === 3) {
      a = pad(((l % 360) + 360) % 360, 3);
      b = pad(r, 3);
    } else {
      a = `${pad(((l % 360) + 360) % 360, 3)}.${Math.floor((((l % 1) + 1) % 1) * 10)}`;
      b = r > 0 ? pad(r, 2) : '';
    }
    ctx.textAlign = 'right';
    ctx.fillText(a, 244, 50);
    ctx.fillText(b, 496, 50);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(255, 10, 2, 76);
  }
}
