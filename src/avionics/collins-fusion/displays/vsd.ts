/**
 * VSD (vertical situation display) window: side view of the terrain along
 * the current track, own ship, flight path, selected altitude and the FMS
 * vertical profile.
 *
 * FSB BD-700-1A10 Rev 7 appendix 6: "Vertical Situation Display (VSD)" and
 * "TAWS overlaid on MFW, VSD and HUD". Terrain colouring relative to own
 * altitude (EST, TAWS convention of AC 25-23 / TSO-C151 displays): red above
 * the aircraft, amber within 500 ft below (EST band), brown otherwise.
 * Scales, range set and symbols are EST.
 */
import type { SimVars } from '../../../core/SimVars';
import { ADC, AP, FMS, GPS } from '../../../core/vars';
import { destinationPoint } from '../../../core/geo';
import type { WorldQuery } from '../../../world/types';
import type { Fms } from '../../../nav/fms/Fms';
import type { Ctx2D } from '../../common/draw/context';
import type { ShownWindow } from '../logic/layout';
import { FUSION_VARS } from '../vars';
import { C, fstr, istr, rect, seg, txt } from './style';
import type { HotSpots, WindowRenderer } from './window';

const M_TO_FT = 3.28084;
const SAMPLES = 64;
const RANGES = [5, 10, 20, 40, 80, 160]; // EST
const TERRAIN = '#6b4a22';

export interface VsdOptions {
  vars: SimVars;
  world: Pick<WorldQuery, 'elevationAt'> | null;
  fms: Fms | null;
}

export class VsdWindow implements WindowRenderer {
  readonly animated = true;
  rangeIdx = 2;
  private readonly elevFt = new Float32Array(SAMPLES + 1);
  private readonly pt = { lat: 0, lon: 0 };
  private timer = 0;
  private altFt = 0;
  private vsFpm = 0;
  private gsKt = 0;
  /** Current scale (set per draw; the bound mappers below read it, no closure per frame). */
  private readonly g = { left: 0, right: 1, top: 0, bottom: 1, lo: 0, hi: 1, rng: 1 };
  private readonly yOf = (ft: number): number => this.g.bottom - ((ft - this.g.lo) / (this.g.hi - this.g.lo)) * (this.g.bottom - this.g.top);
  private readonly xOf = (nm: number): number => this.g.left + (nm / this.g.rng) * (this.g.right - this.g.left);

  constructor(private readonly o: VsdOptions) {
    this.elevFt.fill(NaN);
  }

  get rangeNm(): number {
    return RANGES[this.rangeIdx];
  }

  update(dt: number, w: ShownWindow): void {
    const v = this.o.vars;
    const adc = v.get(FUSION_VARS.adcSrc(w.owner), w.owner);
    this.altFt = v.get(ADC.baroAlt(adc));
    this.vsFpm = v.get(ADC.vs(adc));
    this.gsKt = v.get(GPS.gs);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5; // 2 Hz terrain profile refresh (EST)
    const world = this.o.world;
    if (!world || !v.getBool(GPS.valid)) {
      this.elevFt.fill(NaN);
      return;
    }
    const lat = v.get(GPS.lat);
    const lon = v.get(GPS.lon);
    const trk = this.gsKt > 30 ? v.get(GPS.trackTrue) : v.get(ADC.headingTrue(v.get(FUSION_VARS.ahrsSrc(w.owner), w.owner)), v.get(GPS.trackTrue));
    const rng = this.rangeNm;
    for (let i = 0; i <= SAMPLES; i++) {
      const d = (rng * i) / SAMPLES;
      const p = i === 0 ? null : destinationPoint(lat, lon, trk, d, this.pt);
      const e = world.elevationAt(p ? p.lat : lat, p ? p.lon : lon);
      this.elevFt[i] = Number.isFinite(e) ? e * M_TO_FT : NaN;
    }
  }

  draw(ctx: Ctx2D, w: ShownWindow, hs: HotSpots): void {
    const r = w.rect;
    const v = this.o.vars;
    rect(ctx, r.x, r.y, r.w, r.h, C.bg);
    txt(ctx, 'VSD', r.x + 8, r.y + 14, 13, C.grey, 'left');
    const left = r.x + 60;
    const right = r.x + r.w - 12;
    const top = r.y + 30;
    const bottom = r.y + r.h - 34;
    const rng = this.rangeNm;
    const alt = Number.isFinite(this.altFt) ? this.altFt : 0;
    // Vertical span grows with range (EST): 5 NM -> 4,000 ft ... 160 NM -> 50,000 ft.
    const span = Math.min(50000, Math.max(4000, rng * 700));
    let lo = alt - span * 0.45;
    let tMin = Infinity;
    for (let i = 0; i <= SAMPLES; i++) if (Number.isFinite(this.elevFt[i])) tMin = Math.min(tMin, this.elevFt[i]);
    if (Number.isFinite(tMin)) lo = Math.min(lo, tMin - span * 0.1);
    lo = Math.max(-1000, lo);
    const hi = lo + span;
    const g = this.g;
    g.left = left;
    g.right = right;
    g.top = top;
    g.bottom = bottom;
    g.lo = lo;
    g.hi = hi;
    g.rng = rng;
    const yOf = this.yOf;
    const xOf = this.xOf;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    // Terrain profile, coloured by clearance.
    for (let i = 0; i < SAMPLES; i++) {
      const e0 = this.elevFt[i];
      const e1 = this.elevFt[i + 1];
      if (!Number.isFinite(e0) || !Number.isFinite(e1)) continue;
      const x0 = xOf((rng * i) / SAMPLES);
      const x1 = xOf((rng * (i + 1)) / SAMPLES);
      const top2 = Math.max(e0, e1);
      ctx.fillStyle = top2 >= alt ? C.red : top2 >= alt - 500 ? C.amber : TERRAIN;
      ctx.beginPath();
      ctx.moveTo(x0, yOf(e0));
      ctx.lineTo(x1, yOf(e1));
      ctx.lineTo(x1, bottom);
      ctx.lineTo(x0, bottom);
      ctx.closePath();
      ctx.fill();
    }
    // Selected altitude (cyan dashed).
    const sel = v.get(AP.selAltitude, NaN);
    if (Number.isFinite(sel)) {
      ctx.setLineDash(DASH);
      seg(ctx, left, yOf(sel), right, yOf(sel), C.cyan, 2);
      ctx.setLineDash(NO_DASH);
    }
    // FMS vertical profile (magenta) from the legs' predicted altitudes.
    const fms = this.o.fms;
    if (fms) {
      const plan = fms.plans.active; // geometry / predictions exist for the active plan only
      const ai = plan.activeLegIndex;
      const legs = plan.legs;
      if (ai >= 0 && ai < legs.length) {
        const acAlong = legs[ai].geom.cumDistNm - v.get(FMS.distToWptNm);
        ctx.strokeStyle = C.magenta;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let started = false;
        for (let i = ai; i < legs.length; i++) {
          const g = legs[i].geom;
          const d = g.cumDistNm - acAlong;
          const a = g.predictedAltFt;
          if (!Number.isFinite(a) || !Number.isFinite(d)) continue;
          if (!started) {
            ctx.moveTo(xOf(0), yOf(alt));
            started = true;
          }
          ctx.lineTo(xOf(d), yOf(a));
          if (d > rng) break;
        }
        if (started) ctx.stroke();
        for (let i = ai; i < legs.length; i++) {
          const l = legs[i];
          const d = l.geom.cumDistNm - acAlong;
          if (d > rng) break;
          if (!l.fix || d < 0) continue;
          const a = l.geom.predictedAltFt;
          const x = xOf(d);
          seg(ctx, x, top, x, bottom, 'rgba(255,255,255,0.18)', 1);
          txt(ctx, l.fix.ident, x + 3, top + 10, 12, i === ai ? C.magenta : C.white, 'left');
          if (Number.isFinite(a)) {
            ctx.fillStyle = C.magenta;
            ctx.fillRect(x - 3, yOf(a) - 3, 6, 6);
          }
        }
      }
    }
    // Flight path line (green) from own ship: vs / gs.
    const ox = xOf(0);
    const oy = yOf(alt);
    if (this.gsKt > 30 && Number.isFinite(this.vsFpm)) {
      const ftPerNm = (this.vsFpm * 60) / this.gsKt;
      seg(ctx, ox, oy, xOf(rng), yOf(alt + ftPerNm * rng), C.green, 2);
    }
    ctx.restore();
    // Own ship symbol (white triangle pointing ahead).
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.moveTo(ox + 14, oy);
    ctx.lineTo(ox - 2, oy - 8);
    ctx.lineTo(ox - 2, oy + 8);
    ctx.closePath();
    ctx.fill();
    // Altitude scale.
    const step = span > 30000 ? 10000 : span > 12000 ? 5000 : span > 6000 ? 2000 : 1000;
    for (let a = Math.ceil(lo / step) * step; a <= hi; a += step) {
      const y = yOf(a);
      seg(ctx, left - 6, y, left, y, C.white, 1.5);
      txt(ctx, a >= 1000 || a <= -1000 ? kstr(a) : istr(a), left - 9, y, 12, C.white, 'right');
    }
    seg(ctx, left, top, left, bottom, C.white, 1.5);
    // Distance scale.
    seg(ctx, left, bottom, right, bottom, C.white, 1.5);
    for (let k = 1; k <= 4; k++) {
      const x = left + ((right - left) * k) / 4;
      seg(ctx, x, bottom, x, bottom + 6, C.white, 1.5);
      txt(ctx, fstr((rng * k) / 4, rng * k < 20 ? 1 : 0), x, bottom + 16, 12, C.white, 'center');
    }
    txt(ctx, 'NM', right, bottom + 28, 11, C.cyan, 'right');
    // Range hot spots.
    rect(ctx, r.x + r.w - 64, r.y + 4, 28, 22, C.panel, C.line, 1);
    rect(ctx, r.x + r.w - 32, r.y + 4, 28, 22, C.panel, C.line, 1);
    txt(ctx, '−', r.x + r.w - 50, r.y + 15, 16, C.white, 'center');
    txt(ctx, '+', r.x + r.w - 18, r.y + 15, 16, C.white, 'center');
    hs.add('rng-', r.x + r.w - 64, r.y + 4, 28, 22);
    hs.add('rng+', r.x + r.w - 32, r.y + 4, 28, 22);
    if (!this.o.world) txt(ctx, 'TERRAIN NOT AVAILABLE', (left + right) / 2, (top + bottom) / 2, 14, C.amber, 'center');
  }

  enter(_side: 1 | 2, _w: ShownWindow, id: string): void {
    if (id === 'rng+') this.rangeIdx = Math.min(RANGES.length - 1, this.rangeIdx + 1);
    else if (id === 'rng-') this.rangeIdx = Math.max(0, this.rangeIdx - 1);
    this.timer = 0;
  }

  data(_side: 1 | 2, _w: ShownWindow, _id: string, steps: number): void {
    this.enter(_side, _w, steps > 0 ? 'rng+' : 'rng-');
  }
}

const DASH = [10, 6];
const K_CACHE = new Map<number, string>();
/** '12K' style altitude label (cached). */
function kstr(ft: number): string {
  const k = Math.round(ft / 1000);
  let s = K_CACHE.get(k);
  if (s === undefined) {
    s = `${k}K`;
    K_CACHE.set(k, s);
  }
  return s;
}
const NO_DASH: number[] = [];
