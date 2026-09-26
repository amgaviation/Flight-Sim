/**
 * SmartView-style synthetic vision underlay for the Epic PFD.
 *
 * Honeywell SmartView (standard on PlaneView II and Symmetry: G650
 * specification sheets "SmartView Synthetic Vision System") shows a
 * perspective terrain picture behind the PFD symbology. SCOPE: rendered as
 * range-banded terrain silhouettes (painter's algorithm, far to near) from
 * `WorldQuery.elevationAt` samples on a polar grid ahead of the aircraft,
 * with earth-curvature drop and atmospheric haze by range. No runways,
 * obstacles or terrain-alert colouring. The grid is re-sampled at 4 Hz;
 * drawing reuses the typed arrays (no allocation per frame).
 *
 * EVS mode (enhanced vision on the PFD, G650 "EVS II" option): the same
 * terrain drawn as a monochrome infrared-style picture limited to the
 * sensor range (EST 8 nm), dark sky. SCOPE: no runway / approach lights or
 * heat sources, no weather attenuation.
 */
import type { WorldQuery } from '../../../world/types';
import type { Ctx2D } from '../../common/draw/context';

const DEG = Math.PI / 180;
const NM_M = 1852;
const EARTH_R = 6371000;
/** Standard refraction coefficient reduces the geometric drop (k = 0.13). */
const REFRACTION = 0.87;

export class SyntheticVision {
  readonly cols = 48;
  readonly bands = 22;
  /** Sample ranges (nm), near to far (geometric). */
  private readonly ranges = new Float64Array(this.bands);
  /** Elevation angle (deg) of each sample, band-major: [band * cols + col]. */
  private readonly el = new Float32Array(this.bands * this.cols);
  private readonly relAz = new Float32Array(this.cols);
  private readonly colors: string[] = [];
  private readonly edge: string[] = [];
  private halfFovDeg = 50;
  private timer = 0;
  private valid = false;
  private pitch = 0;
  private bank = 0;
  private skyGrad: CanvasGradient | null = null;
  private gradCtx: Ctx2D | null = null;

  private rangeMax = 0;

  constructor(private readonly world: WorldQuery) {
    this.setRanges(45);
    // EST SmartView palette: olive green near, brown mid range, blue-grey haze far.
    for (let k = 0; k < this.bands; k++) {
      const f = k / (this.bands - 1);
      const r = f < 0.5 ? lerp(78, 122, f * 2) : lerp(122, 128, (f - 0.5) * 2);
      const g = f < 0.5 ? lerp(98, 102, f * 2) : lerp(102, 138, (f - 0.5) * 2);
      const b = f < 0.5 ? lerp(44, 62, f * 2) : lerp(62, 160, (f - 0.5) * 2);
      this.colors.push(`rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`);
      this.edge.push(`rgba(${Math.round(r + 70)},${Math.round(g + 60)},${Math.round(b + 40)},0.5)`);
    }
    this.resize(683, 420);
  }

  /** Geometric sample ranges from 0.12 nm to `r1` nm. */
  private setRanges(r1: number): void {
    if (Math.abs(r1 - this.rangeMax) < 1) return;
    this.rangeMax = r1;
    const r0 = 0.12;
    for (let k = 0; k < this.bands; k++) this.ranges[k] = r0 * Math.pow(r1 / r0, k / (this.bands - 1));
  }

  /** ADI area size (px) and pixels per degree set the horizontal field of view. */
  resize(w: number, _h: number, pxPerDeg = 7.5): void {
    this.halfFovDeg = Math.min(80, w / pxPerDeg / 2 + 6);
    for (let i = 0; i < this.cols; i++) this.relAz[i] = -this.halfFovDeg + (2 * this.halfFovDeg * i) / (this.cols - 1);
  }

  update(dt: number, lat: number, lon: number, altFt: number, hdgTrue: number, pitch: number, bank: number): void {
    this.pitch = pitch;
    this.bank = bank;
    this.timer -= dt;
    if (this.timer > 0 && this.valid) return;
    this.timer = 0.25;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      this.valid = false;
      return;
    }
    const altM = altFt * 0.3048;
    // Geometric horizon distance (nm) ~ 1.23 sqrt(h ft): sample out to 80 % of it (20..160 nm).
    this.setRanges(Math.max(20, Math.min(160, 0.8 * 1.23 * Math.sqrt(Math.max(0, altFt)))));
    const cosLat = Math.max(0.05, Math.cos(lat * DEG));
    for (let i = 0; i < this.cols; i++) {
      const az = (hdgTrue + this.relAz[i]) * DEG;
      const sa = Math.sin(az);
      const ca = Math.cos(az);
      for (let k = 0; k < this.bands; k++) {
        const dNm = this.ranges[k];
        const la = lat + (dNm * ca) / 60;
        const lo = lon + (dNm * sa) / (60 * cosLat);
        let e = this.world.elevationAt(la, lo);
        if (!Number.isFinite(e)) e = 0;
        const dm = dNm * NM_M;
        const drop = ((dm * dm) / (2 * EARTH_R)) * REFRACTION;
        this.el[k * this.cols + i] = Math.atan2(e - altM - drop, dm) / DEG;
      }
    }
    this.valid = true;
  }

  /**
   * Draws the sky and terrain into the attitude area (x, y, w, h) with the
   * attitude reference at (cx, cy) and `k` pixels per degree.
   */
  draw(ctx: Ctx2D, x: number, y: number, w: number, h: number, cx: number, cy: number, k: number, evs = false): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-this.bank * DEG);
    const R = Math.hypot(w, h) + 60;
    const hy = this.pitch * k;
    if (this.gradCtx !== ctx) {
      this.skyGrad = ctx.createLinearGradient(0, -260, 0, 0);
      this.skyGrad.addColorStop(0, '#1b52b8');
      this.skyGrad.addColorStop(1, '#8fb8e6');
      this.gradCtx = ctx;
    }
    // Sky (gradient anchored to the horizon) and a base ground below the horizon.
    ctx.translate(0, hy);
    if (evs) {
      ctx.fillStyle = EVS_SKY;
      ctx.fillRect(-R, -2 * R, 2 * R, 2 * R);
      ctx.fillStyle = EVS_FAR;
      ctx.fillRect(-R, 0, 2 * R, 2 * R);
    } else {
      ctx.fillStyle = '#1b52b8';
      ctx.fillRect(-R, -2 * R, 2 * R, 2 * R - 258);
      ctx.fillStyle = this.skyGrad!;
      ctx.fillRect(-R, -260, 2 * R, 261);
      ctx.fillStyle = this.colors[this.bands - 1];
      ctx.fillRect(-R, 0, 2 * R, 2 * R);
    }
    ctx.translate(0, -hy);
    if (this.valid) {
      const cols = this.cols;
      for (let b = this.bands - 1; b >= 0; b--) {
        if (evs && this.ranges[b] > EVS_RANGE_NM) continue;
        const base = b * cols;
        ctx.beginPath();
        ctx.moveTo(this.relAz[0] * k - 40, R);
        for (let i = 0; i < cols; i++) {
          const px = this.relAz[i] * k;
          const py = (this.pitch - this.el[base + i]) * k;
          if (i === 0) ctx.lineTo(px - 40, py);
          ctx.lineTo(px, py);
          if (i === cols - 1) ctx.lineTo(px + 40, py);
        }
        ctx.lineTo(this.relAz[cols - 1] * k + 40, R);
        ctx.closePath();
        ctx.fillStyle = evs ? EVS_GREYS[Math.min(EVS_GREYS.length - 1, Math.floor((this.ranges[b] / EVS_RANGE_NM) * EVS_GREYS.length))] : this.colors[b];
        ctx.fill();
        if (b < this.bands - 2) {
          // Ridge line for relief.
          ctx.beginPath();
          for (let i = 0; i < cols; i++) {
            const px = this.relAz[i] * k;
            const py = (this.pitch - this.el[base + i]) * k;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = evs ? EVS_EDGE : this.edge[b];
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}

/** EVS sensor range (nm, EST) and monochrome palette (near = warm = bright). */
const EVS_RANGE_NM = 8;
const EVS_SKY = '#16181a';
const EVS_FAR = '#2a2c2e';
const EVS_EDGE = 'rgba(230,230,230,0.35)';
const EVS_GREYS: string[] = [];
for (let i = 0; i < 16; i++) {
  const g = Math.round(170 - (i / 15) * 115);
  EVS_GREYS.push(`rgb(${g},${g},${g})`);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
