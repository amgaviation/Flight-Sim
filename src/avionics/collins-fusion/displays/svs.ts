/**
 * Synthetic vision underlay for the Pro Line Fusion PFD (Collins SVS, SVM-6110
 * module: Collins course syllabus 523-0817473 "SVS Module"; FSB BD-700-1A10
 * Rev 7: "Synthetic Vision enhances situational awareness. Presented on PFD
 * and HUD"; AIN 2012: "on the PFD SVS is rendered in full color").
 *
 * SCOPE: a perspective terrain picture from `WorldQuery.elevationAt` samples
 * on a polar grid ahead of the aircraft (azimuth columns x geometric range
 * bands), drawn far-to-near as filled silhouettes (painter's algorithm) with
 * earth-curvature drop, hypsometric colouring by elevation (EST palette),
 * range haze and ridge lines, plus the destination / origin runways as
 * outlined quadrilaterals. Re-sampled at 4 Hz; drawing reuses typed arrays.
 * No obstacles, no terrain-alert colouring, no texture.
 *
 * The same sampler draws the EVS picture (monochrome infrared style limited
 * to EST 8 nm) for the EVS window (FSB: "EVS Head-Down Display (HDD) can be
 * presented on any MFW").
 */
import type { WorldQuery } from '../../../world/types';
import type { Ctx2D } from '../../common/draw/context';

const DEG = Math.PI / 180;
const NM_M = 1852;
const EARTH_R = 6371000;
/** Standard refraction reduces the geometric drop (k = 0.13). */
const REFRACTION = 0.87;
const FT_M = 0.3048;

/** EST hypsometric SVS colours (elevation m -> rgb), Collins SVS uses a natural-terrain tint. */
const HYPSO: readonly (readonly [number, number, number, number])[] = [
  [-100, 58, 96, 60],
  [0, 70, 110, 62],
  [300, 96, 122, 66],
  [800, 128, 118, 74],
  [1500, 142, 112, 80],
  [2500, 170, 150, 120],
  [3500, 214, 208, 200],
];

function hypso(elevM: number, out: Float32Array): void {
  let i = 1;
  while (i < HYPSO.length - 1 && elevM > HYPSO[i][0]) i++;
  const a = HYPSO[i - 1];
  const b = HYPSO[i];
  const t = Math.max(0, Math.min(1, (elevM - a[0]) / (b[0] - a[0])));
  out[0] = a[1] + (b[1] - a[1]) * t;
  out[1] = a[2] + (b[2] - a[2]) * t;
  out[2] = a[3] + (b[3] - a[3]) * t;
}

/** EVS grey ramp (near = bright), precomputed so drawing allocates nothing. */
const MONO_LUT: string[] = [];
for (let i = 0; i < 64; i++) {
  const l = Math.round(40 + (150 * i) / 63);
  MONO_LUT.push(`rgb(${l},${l + 8},${l})`);
}

export interface SvsRunway {
  lat: number;
  lon: number;
  headingTrue: number;
  lengthFt: number;
  widthFt: number;
  elevFt: number;
}

export class SyntheticVision {
  readonly cols = 41;
  readonly bands = 24;
  private readonly ranges = new Float64Array(this.bands);
  /** Elevation angle (deg) per sample, band-major. */
  private readonly el = new Float32Array(this.bands * this.cols);
  private readonly elev = new Float32Array(this.bands * this.cols);
  private readonly relAz = new Float32Array(this.cols);
  private readonly bandColor: string[] = [];
  private readonly bandEdge: string[] = [];
  private readonly rgb = new Float32Array(3);
  private halfFovDeg = 40;
  private timer = 0;
  private valid = false;
  private rangeMax = 0;
  private lat = 0;
  private lon = 0;
  private altM = 0;
  private hdg = 0;
  /** Runways drawn (set by the owner, e.g. origin / destination). */
  runways: SvsRunway[] = [];
  private readonly rwPts = new Float64Array(8);
  private gradCtx: Ctx2D | null = null;
  private skyGrad: CanvasGradient | null = null;

  constructor(private readonly world: Pick<WorldQuery, 'elevationAt'> | null) {
    this.setRanges(40);
    for (let k = 0; k < this.bands; k++) {
      this.bandColor.push('#000');
      this.bandEdge.push('#000');
    }
  }

  private setRanges(r1: number): void {
    if (Math.abs(r1 - this.rangeMax) < 0.5) return;
    this.rangeMax = r1;
    const r0 = 0.08;
    for (let k = 0; k < this.bands; k++) this.ranges[k] = r0 * Math.pow(r1 / r0, k / (this.bands - 1));
  }

  /** Horizontal field of view from the ADI width and scale. */
  setFov(widthPx: number, pxPerDeg: number): void {
    this.halfFovDeg = Math.min(70, widthPx / pxPerDeg / 2 + 8);
    for (let i = 0; i < this.cols; i++) this.relAz[i] = -this.halfFovDeg + (2 * this.halfFovDeg * i) / (this.cols - 1);
  }

  get available(): boolean {
    return this.world !== null && this.valid;
  }

  update(dt: number, lat: number, lon: number, altFtMsl: number, hdgTrue: number, maxRangeNm = 40): void {
    this.timer -= dt;
    if (!this.world || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      this.valid = false;
      return;
    }
    if (this.timer > 0 && this.valid) return;
    this.timer = 0.25;
    this.setRanges(maxRangeNm);
    this.lat = lat;
    this.lon = lon;
    this.altM = altFtMsl * FT_M;
    this.hdg = hdgTrue;
    const cosLat = Math.max(0.05, Math.cos(lat * DEG));
    for (let k = 0; k < this.bands; k++) {
      const rNm = this.ranges[k];
      const rM = rNm * NM_M;
      const drop = (REFRACTION * rM * rM) / (2 * EARTH_R);
      let sumE = 0;
      for (let i = 0; i < this.cols; i++) {
        const az = (hdgTrue + this.relAz[i]) * DEG;
        const sLat = lat + (rNm * Math.cos(az)) / 60;
        const sLon = lon + (rNm * Math.sin(az)) / (60 * cosLat);
        let e = this.world.elevationAt(sLat, sLon);
        if (!Number.isFinite(e)) e = 0;
        const j = k * this.cols + i;
        this.elev[j] = e;
        this.el[j] = Math.atan2(e - drop - this.altM, rM) / DEG;
        sumE += e;
      }
      hypso(sumE / this.cols, this.rgb);
      // Haze toward the far bands (EST blue-grey atmospheric perspective).
      const f = Math.pow(k / (this.bands - 1), 1.3) * 0.62;
      const r = Math.round(this.rgb[0] * (1 - f) + 150 * f);
      const g = Math.round(this.rgb[1] * (1 - f) + 170 * f);
      const b = Math.round(this.rgb[2] * (1 - f) + 196 * f);
      this.bandColor[k] = `rgb(${r},${g},${b})`;
      this.bandEdge[k] = `rgba(${Math.min(255, r + 55)},${Math.min(255, g + 55)},${Math.min(255, b + 45)},0.55)`;
    }
    this.valid = true;
  }

  /**
   * Draws the SVS picture (sky, terrain, runways) into `rect` for the
   * attitude reference point (cx, cy) and scale pxPerDeg. Caller clips.
   */
  draw(ctx: Ctx2D, x: number, y: number, w: number, h: number, cx: number, cy: number, pxPerDeg: number, pitch: number, bank: number, mono = false, monoRangeNm = 8): void {
    const R = Math.hypot(w, h) + 400;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-bank * DEG);
    // Sky (gradient anchored at the horizon).
    const hy = pitch * pxPerDeg;
    if (mono) {
      ctx.fillStyle = '#060806';
      ctx.fillRect(-R, -R, 2 * R, 2 * R);
    } else {
      if (this.gradCtx !== ctx) {
        this.skyGrad = ctx.createLinearGradient(0, -260, 0, 0);
        this.skyGrad.addColorStop(0, '#0f4aa8');
        this.skyGrad.addColorStop(1, '#7fb0e6');
        this.gradCtx = ctx;
      }
      ctx.fillStyle = '#0f4aa8';
      ctx.fillRect(-R, -R - 400, 2 * R, R + 400 + hy - 258);
      ctx.translate(0, hy);
      ctx.fillStyle = this.skyGrad!;
      ctx.fillRect(-R, -260, 2 * R, 261);
      ctx.translate(0, -hy);
      // Below-horizon fill (visible when no terrain rises above the geometric horizon).
      ctx.fillStyle = '#4c6b3c';
      ctx.fillRect(-R, hy, 2 * R, R);
    }
    if (this.valid) {
      const cols = this.cols;
      for (let k = this.bands - 1; k >= 0; k--) {
        if (mono && this.ranges[k] > monoRangeNm) continue;
        ctx.beginPath();
        for (let i = 0; i < cols; i++) {
          const px = this.relAz[i] * pxPerDeg;
          const py = -(this.el[k * cols + i] - pitch) * pxPerDeg;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineTo(this.relAz[cols - 1] * pxPerDeg, R);
        ctx.lineTo(this.relAz[0] * pxPerDeg, R);
        ctx.closePath();
        if (mono) {
          const f = 1 - this.ranges[k] / monoRangeNm;
          ctx.fillStyle = MONO_LUT[Math.max(0, Math.min(63, Math.round(f * f * 63)))];
        } else ctx.fillStyle = this.bandColor[k];
        ctx.fill();
        if (!mono && k < this.bands - 2) {
          // Ridge line of the band (terrain relief cue).
          ctx.beginPath();
          for (let i = 0; i < cols; i++) {
            const px = this.relAz[i] * pxPerDeg;
            const py = -(this.el[k * cols + i] - pitch) * pxPerDeg;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = this.bandEdge[k];
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      if (!mono) this.drawRunways(ctx, pxPerDeg, pitch);
    }
    ctx.restore();
  }

  /** Projects (lat, lon, elevM) to the rolled screen frame; returns false behind the aircraft. */
  private project(lat: number, lon: number, elevM: number, pxPerDeg: number, pitch: number, out: Float64Array, o: number): boolean {
    const cosLat = Math.max(0.05, Math.cos(this.lat * DEG));
    const n = (lat - this.lat) * 60 * NM_M;
    const e = (lon - this.lon) * 60 * NM_M * cosLat;
    const h = this.hdg * DEG;
    const fwd = n * Math.cos(h) + e * Math.sin(h);
    const right = -n * Math.sin(h) + e * Math.cos(h);
    if (fwd < 30) return false;
    const drop = (REFRACTION * fwd * fwd) / (2 * EARTH_R);
    const az = Math.atan2(right, fwd) / DEG;
    const el = Math.atan2(elevM - drop - this.altM, Math.hypot(fwd, right)) / DEG;
    out[o] = az * pxPerDeg;
    out[o + 1] = -(el - pitch) * pxPerDeg;
    return true;
  }

  private drawRunways(ctx: Ctx2D, pxPerDeg: number, pitch: number): void {
    const p = this.rwPts;
    for (const rw of this.runways) {
      const hr = rw.headingTrue * DEG;
      const lenNm = rw.lengthFt / 6076.12;
      const halfWNm = rw.widthFt / 2 / 6076.12;
      const cosLat = Math.max(0.05, Math.cos(rw.lat * DEG));
      const dLatL = (lenNm * Math.cos(hr)) / 60;
      const dLonL = (lenNm * Math.sin(hr)) / (60 * cosLat);
      const dLatW = (halfWNm * Math.cos(hr + Math.PI / 2)) / 60;
      const dLonW = (halfWNm * Math.sin(hr + Math.PI / 2)) / (60 * cosLat);
      const eM = rw.elevFt * FT_M;
      const ok =
        this.project(rw.lat - dLatW, rw.lon - dLonW, eM, pxPerDeg, pitch, p, 0) &&
        this.project(rw.lat + dLatW, rw.lon + dLonW, eM, pxPerDeg, pitch, p, 2) &&
        this.project(rw.lat + dLatL + dLatW, rw.lon + dLonL + dLonW, eM, pxPerDeg, pitch, p, 4) &&
        this.project(rw.lat + dLatL - dLatW, rw.lon + dLonL - dLonW, eM, pxPerDeg, pitch, p, 6);
      if (!ok) continue;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[2], p[3]);
      ctx.lineTo(p[4], p[5]);
      ctx.lineTo(p[6], p[7]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(60,62,66,0.95)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}
