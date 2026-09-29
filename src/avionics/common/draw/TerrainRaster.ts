/**
 * Cached terrain raster for moving maps (TAWS / EGPWS relative terrain and
 * absolute topographic colouring).
 *
 * A square grid of `size` x `size` cells, north-up, centred near the
 * aircraft, covering +/- `coverage` x map range. Elevations come from
 * `WorldQuery.elevationAt` and are sampled incrementally (a per-update
 * budget, nearest cells first) so a range change or a long flight never
 * stalls a frame. When the aircraft drifts away from the grid centre the
 * grid is shifted by whole cells and only the newly exposed cells are
 * sampled. Colouring runs from the cached elevations through a LUT, so a
 * change of aircraft altitude recolours without resampling.
 *
 * Colour schemes:
 *  - 'relative' (Garmin TAWS-B / G1000 relative terrain): red = terrain at
 *    or within 100 ft below the aircraft or above it, yellow = 100..1000 ft
 *    below, black (transparent) otherwise. Garmin G3000/G5000 variants
 *    (Cockpit Reference Guides 190-02047-01 Rev A p.99-100, TBM 930, and
 *    190-02538-02 Rev A p.142, Citation XLS G5000 TAWS-A: "Terrain SVT /
 *    TAWS Relative Terrain Legends"):
 *      in-air legend with `relativeGreenBand`: red above -100 ft, yellow
 *      -100..-1000 ft, green -1000..-2000 ft, black below;
 *      on-ground legend (`onGround`): only terrain 400 ft or more above
 *      the aircraft is red, everything else black, so the departure airport
 *      area is not painted red/yellow while taxiing. The G1000 NXi uses the
 *      same legends (PG 190-02177-00 Rev A p.291-292: green -1000..-2000 ft
 *      for Terrain Proximity, Terrain-SVT and TAWS-B, and the on-ground rule);
 *      plain 'relative' (no options) is the original G1000 red/yellow/black.
 *  - 'egpws' (Honeywell MK VI/VIII EGPWS Pilot Guide 060-4314-000 Rev C
 *    p.31, non-peaks): > +2000 ft high-density red, +1000..+2000 high-density
 *    yellow, -500 (-250 gear down)..+1000 low-density yellow, -1000..-500
 *    high-density green, -2000..-1000 low-density green, below -2000 black.
 *    EST densities: high 50 %, low 25 % (ordered 4x4 dither).
 *    Same guide p.32: "Terrain more than 2000 feet below the aircraft, or
 *    within 400 (vertical) feet of the nearest runway elevation, is not
 *    displayed (black)" - applied when `runwayElevFt` is known (MovingMap
 *    fills it from the nearest airport), so the airport area stays black on
 *    the ground and on approach instead of a yellow dot field.
 *  - 'topo': absolute elevation ramp (EST Garmin-like topo colours), water
 *    below 0 m (terrarium tiles carry bathymetry, so oceans are negative).
 *  - 'off'.
 * TAWS alert overlay: with `alertLevel` 1/2, cells ahead of the aircraft
 * (+/-30 deg of track, within `alertLookAheadNm`) whose colour band is
 * yellow or red are painted solid yellow / red (EGPWS: "the terrain that
 * created the alert is changed to solid yellow/red").
 * SCOPE: the real EGPWS paints only the cells found by its look-ahead
 * envelope; here the forward sector approximates that envelope. The EGPWS
 * "reference altitude" (projected 30 s ahead when descending > 1000 fpm,
 * guide p.35) is not modelled; the nearest runway is approximated by the
 * nearest airport's field elevation.
 */
import type { WorldQuery } from '../../../world/types';
import { createDisplayCanvas, type DisplayCanvas } from '../CanvasDisplay';
import type { Ctx2D } from './context';

export type TerrainMode = 'off' | 'relative' | 'egpws' | 'topo';

export interface TerrainRasterOptions {
  world: Pick<WorldQuery, 'elevationAt'>;
  /** Cells per side (default 128). */
  size?: number;
  /** Grid half-width as a multiple of the map range (default 1.45: covers track-up corners). */
  coverage?: number;
  /** Elevation samples per update (default 900). */
  samplesPerUpdate?: number;
  /** Raster pixels per cell side (default 2): EGPWS dot densities dither at pixel level, finer than the elevation grid. */
  pixelsPerCell?: number;
}

const M_TO_FT = 1 / 0.3048;
/**
 * Garmin on-ground relative terrain legend: red at 400 ft or more above the aircraft, black below (CRG
 * 190-02047-01 Rev A p.100; G1000 NXi PG 190-02177-00 Rev A p.291: "While the aircraft is on the ground,
 * the system displays relative terrain 400 feet or more above the aircraft altitude using red").
 */
const GARMIN_GROUND_RED_FT = 400;
/** EGPWS: terrain within 400 ft (vertical) of the nearest runway elevation is not displayed (Pilot Guide 060-4314-000 Rev C p.32). */
const EGPWS_RUNWAY_BLANK_FT = 400;
/** EST: green of the G3000/G5000 in-air relative terrain legend, sampled from the legend graphic (CRG 190-02047-01 Rev A p.100). */
const GARMIN_GREEN = [87, 162, 68];

function sameElev(a: number, b: number): boolean {
  return Number.isNaN(a) ? Number.isNaN(b) : Math.abs(a - b) < 1;
}
/** 4x4 Bayer matrix, thresholds in (0,1). */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Topographic ramp: elevation (ft) -> RGB (EST, Garmin-like topo). */
const TOPO_FT = [0, 500, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 15000];
const TOPO_RGB = [
  [44, 84, 40],
  [58, 104, 46],
  [76, 118, 52],
  [118, 132, 60],
  [150, 138, 72],
  [160, 124, 76],
  [140, 100, 66],
  [120, 86, 62],
  [150, 140, 132],
  [200, 196, 190],
  [236, 236, 236],
];

export class TerrainRaster {
  readonly size: number;
  /** Raster pixels per cell side. */
  readonly ppc: number;
  readonly canvas: DisplayCanvas;
  mode: TerrainMode = 'off';
  /** 0 none, 1 caution (yellow), 2 warning (red) forward-sector overlay. */
  alertLevel: 0 | 1 | 2 = 0;
  /** Look-ahead distance (nm) for the alert overlay. */
  alertLookAheadNm = 4;
  /** Gear down: EGPWS low-density yellow band starts at -250 ft instead of -500. */
  gearDown = false;
  /**
   * 'relative' mode, Garmin G3000/G5000 on-ground legend: while on the ground
   * only terrain more than 400 ft above the aircraft is shown (red).
   */
  onGround = false;
  /** 'relative' mode, Garmin G3000/G5000 in-air legend: green band -1000..-2000 ft (G1000 TAWS-B: none). */
  relativeGreenBand = false;
  /** 'egpws' mode: elevation (ft MSL) of the runway nearest the aircraft; terrain within 400 ft of it is black. NaN = unknown. */
  runwayElevFt = NaN;

  private readonly world: Pick<WorldQuery, 'elevationAt'>;
  private readonly ctx: Ctx2D;
  private readonly image: ImageData;
  private readonly elevFt: Float32Array;
  private readonly sampled: Uint8Array;
  private readonly order: Int32Array;
  private readonly coverage: number;
  private readonly budget: number;
  private cursor = 0;
  private centerLat = NaN;
  private centerLon = NaN;
  private cosLat = 1;
  private cellNm = 0;
  private colorAltFt = NaN;
  private colorMode: TerrainMode = 'off';
  private colorAlert = 0;
  private colorTrack = NaN;
  private colorOnGround = false;
  private colorGreen = false;
  private colorRwy = NaN;
  private needsColor = true;
  private sampledCount = 0;

  constructor(opts: TerrainRasterOptions) {
    this.world = opts.world;
    this.size = opts.size ?? 128;
    this.coverage = opts.coverage ?? 1.45;
    this.budget = opts.samplesPerUpdate ?? 900;
    this.ppc = Math.max(1, Math.round(opts.pixelsPerCell ?? 2));
    const n = this.size;
    const px = n * this.ppc;
    this.canvas = createDisplayCanvas(px, px);
    const ctx = this.canvas.getContext('2d') as Ctx2D | null;
    if (!ctx) throw new Error('TerrainRaster: 2D context unavailable');
    this.ctx = ctx;
    this.image = ctx.createImageData(px, px);
    this.elevFt = new Float32Array(n * n);
    this.sampled = new Uint8Array(n * n);
    // Sampling order: nearest to the centre first.
    const idx: number[] = [];
    for (let i = 0; i < n * n; i++) idx.push(i);
    const c = (n - 1) / 2;
    idx.sort((a, b) => {
      const ra = ((a % n) - c) ** 2 + (Math.floor(a / n) - c) ** 2;
      const rb = ((b % n) - c) ** 2 + (Math.floor(b / n) - c) ** 2;
      return ra - rb;
    });
    this.order = Int32Array.from(idx);
  }

  /** Grid centre and cell size (for projecting the raster onto the map). */
  get gridLat(): number {
    return this.centerLat;
  }
  get gridLon(): number {
    return this.centerLon;
  }
  get gridCellNm(): number {
    return this.cellNm;
  }
  /** Fraction of cells sampled (0..1). */
  get completeness(): number {
    return this.sampledCount / (this.size * this.size);
  }

  /** Elevation (ft) cached for the cell containing (lat, lon); NaN if outside or not sampled yet. */
  cachedElevationFt(lat: number, lon: number): number {
    if (!Number.isFinite(this.centerLat)) return NaN;
    const n = this.size;
    const x = ((lon - this.centerLon) * 60 * this.cosLat) / this.cellNm + n / 2;
    const y = n / 2 - ((lat - this.centerLat) * 60) / this.cellNm;
    const j = Math.floor(x);
    const i = Math.floor(y);
    if (i < 0 || j < 0 || i >= n || j >= n) return NaN;
    const k = i * n + j;
    return this.sampled[k] ? this.elevFt[k] : NaN;
  }

  /**
   * Re-centres/re-scales the grid if needed, samples up to the budget and
   * recolours when anything changed. Call once per map frame.
   */
  update(lat: number, lon: number, rangeNm: number, altFt: number, trackDeg: number): void {
    if (this.mode === 'off') return;
    const n = this.size;
    const wantCell = (2 * rangeNm * this.coverage) / n;
    if (!Number.isFinite(this.centerLat) || Math.abs(wantCell - this.cellNm) > this.cellNm * 0.05) {
      this.reset(lat, lon, wantCell);
    } else {
      // Shift by whole cells when the aircraft is more than 20 % of the half-width off centre.
      const dxNm = (lon - this.centerLon) * 60 * this.cosLat;
      const dyNm = (lat - this.centerLat) * 60;
      const limit = (n / 2) * this.cellNm * 0.2;
      if (Math.abs(dxNm) > limit || Math.abs(dyNm) > limit) {
        const sx = Math.round(dxNm / this.cellNm);
        const sy = Math.round(dyNm / this.cellNm);
        this.shift(sx, sy);
      }
    }
    // Sample.
    let done = 0;
    const order = this.order;
    const total = n * n;
    while (done < this.budget && this.cursor < total) {
      const k = order[this.cursor++];
      if (this.sampled[k]) continue;
      const i = Math.floor(k / n);
      const j = k - i * n;
      const xNm = (j + 0.5 - n / 2) * this.cellNm;
      const yNm = (n / 2 - i - 0.5) * this.cellNm;
      const la = this.centerLat + yNm / 60;
      let lo = this.centerLon + xNm / (60 * this.cosLat);
      if (lo > 180) lo -= 360;
      else if (lo < -180) lo += 360;
      const e = this.world.elevationAt(la, lo);
      this.elevFt[k] = Number.isFinite(e) ? e * M_TO_FT : 0;
      this.sampled[k] = 1;
      this.sampledCount++;
      done++;
    }
    if (done > 0) this.needsColor = true;
    if (
      this.needsColor ||
      this.colorMode !== this.mode ||
      (this.mode !== 'topo' && Math.abs(altFt - this.colorAltFt) > 25) ||
      this.colorAlert !== this.alertLevel ||
      (this.alertLevel > 0 && Math.abs(trackDeg - this.colorTrack) > 3) ||
      this.colorOnGround !== this.onGround ||
      this.colorGreen !== this.relativeGreenBand ||
      !sameElev(this.colorRwy, this.runwayElevFt)
    ) {
      this.colorize(lat, lon, altFt, trackDeg);
    }
  }

  /**
   * Draws the raster onto a map. `project` maps the grid centre to screen;
   * `pxPerNm` and the map rotation (`upDeg`, map "up" bearing) place it.
   */
  draw(ctx: Ctx2D, centerX: number, centerY: number, pxPerNm: number, upDeg: number): void {
    if (this.mode === 'off' || !Number.isFinite(this.centerLat)) return;
    const n = this.size * this.ppc;
    const scale = (this.cellNm * pxPerNm) / this.ppc;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((-upDeg * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = this.mode === 'topo';
    ctx.drawImage(this.canvas, -n / 2, -n / 2);
    ctx.restore();
  }

  /** Clears the grid around a new centre / cell size. */
  reset(lat: number, lon: number, cellNm: number): void {
    this.centerLat = lat;
    this.centerLon = lon;
    this.cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    this.cellNm = cellNm;
    this.sampled.fill(0);
    this.sampledCount = 0;
    this.cursor = 0;
    this.needsColor = true;
  }

  /** Moves the grid by (sx, sy) cells (east, north), keeping overlapping samples. */
  private shift(sx: number, sy: number): void {
    const n = this.size;
    if (Math.abs(sx) >= n || Math.abs(sy) >= n) {
      this.reset(this.centerLat + (sy * this.cellNm) / 60, this.centerLon + (sx * this.cellNm) / (60 * this.cosLat), this.cellNm);
      return;
    }
    const e = this.elevFt;
    const s = this.sampled;
    // New cell (i, j) takes old cell (i - sy, j + sx)  [rows grow southward].
    const rowStart = sy > 0 ? n - 1 : 0;
    const rowStep = sy > 0 ? -1 : 1;
    const colStart = sx > 0 ? 0 : n - 1;
    const colStep = sx > 0 ? 1 : -1;
    let count = 0;
    for (let a = 0, i = rowStart; a < n; a++, i += rowStep) {
      for (let b = 0, j = colStart; b < n; b++, j += colStep) {
        const oi = i - sy;
        const oj = j + sx;
        const k = i * n + j;
        if (oi >= 0 && oi < n && oj >= 0 && oj < n && s[oi * n + oj]) {
          e[k] = e[oi * n + oj];
          s[k] = 1;
          count++;
        } else {
          s[k] = 0;
        }
      }
    }
    this.sampledCount = count;
    this.centerLat += (sy * this.cellNm) / 60;
    this.centerLon += (sx * this.cellNm) / (60 * this.cosLat);
    this.cursor = 0;
    this.needsColor = true;
  }

  private colorize(lat: number, lon: number, altFt: number, trackDeg: number): void {
    const n = this.size;
    const ppc = this.ppc;
    const W = n * ppc;
    const data = this.image.data;
    const e = this.elevFt;
    const s = this.sampled;
    const mode = this.mode;
    const lowYellow = this.gearDown ? -250 : -500;
    const alert = this.alertLevel;
    // Aircraft position in grid cells (for the alert sector).
    const ax = ((lon - this.centerLon) * 60 * this.cosLat) / this.cellNm + n / 2;
    const ay = n / 2 - ((lat - this.centerLat) * 60) / this.cellNm;
    const lookCells = this.alertLookAheadNm / this.cellNm;
    const trk = (trackDeg * Math.PI) / 180;
    const tx = Math.sin(trk);
    const ty = -Math.cos(trk);
    const cosSector = Math.cos((30 * Math.PI) / 180);
    const onGround = this.onGround;
    const greenBand = this.relativeGreenBand;
    // EGPWS runway blanking reference: the nearest runway elevation, or - on the ground, when no airport
    // is known yet - the aircraft's own altitude (on the ground the aircraft IS at runway elevation, so
    // the airport surroundings stay black instead of a solid caution field; MK VI/VIII Pilot Guide
    // 060-4314-000 Rev C p.32; fix round 1 L05).
    let rwy = mode === 'egpws' && Number.isFinite(this.runwayElevFt) ? this.runwayElevFt : NaN;
    if (mode === 'egpws' && !Number.isFinite(rwy) && onGround && Number.isFinite(altFt)) rwy = altFt;
    const rwyBlank = Number.isFinite(rwy);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const k = i * n + j;
        let r = 0;
        let g = 0;
        let b = 0;
        let density = 0; // 0 = transparent, 1 = solid, else dithered
        if (s[k]) {
          const el = e[k];
          if (mode === 'topo') {
            if (el < 0) {
              r = 10;
              g = 36;
              b = 96;
            } else {
              this.topo(el);
              r = TMP[0];
              g = TMP[1];
              b = TMP[2];
            }
            density = 1;
          } else {
            const d = el - altFt;
            let band = 0; // 0 none, 1 yellow, 2 red, 3 green, 4 Garmin green
            let dens = 1;
            if (mode === 'relative') {
              if (onGround) {
                if (d >= GARMIN_GROUND_RED_FT) band = 2;
              } else if (d > -100) band = 2;
              else if (d > -1000) band = 1;
              else if (greenBand && d > -2000) band = 4;
            } else if (rwyBlank && Math.abs(el - rwy) <= EGPWS_RUNWAY_BLANK_FT) {
              band = 0;
            } else if (d > 2000) {
              band = 2;
              dens = 0.5;
            } else if (d > 1000) {
              band = 1;
              dens = 0.5;
            } else if (d > lowYellow) {
              band = 1;
              dens = 0.25;
            } else if (d > -1000) {
              band = 3;
              dens = 0.5;
            } else if (d > -2000) {
              band = 3;
              dens = 0.25;
            }
            // Solid alert painting in the forward sector.
            if (alert > 0 && (band === 1 || band === 2)) {
              const vx = j + 0.5 - ax;
              const vy = i + 0.5 - ay;
              const dist = Math.hypot(vx, vy);
              if (dist <= lookCells && (dist < 1 || (vx * tx + vy * ty) / dist >= cosSector)) {
                band = alert === 2 ? 2 : 1;
                dens = 1;
              }
            }
            if (band !== 0) {
              density = dens;
              if (band === 2) r = 255;
              else if (band === 1) {
                r = 255;
                g = 255;
              } else if (band === 4) {
                r = GARMIN_GREEN[0];
                g = GARMIN_GREEN[1];
                b = GARMIN_GREEN[2];
              } else g = 200;
            }
          }
        }
        for (let pi = 0; pi < ppc; pi++) {
          const py = i * ppc + pi;
          for (let pj = 0; pj < ppc; pj++) {
            const pxl = j * ppc + pj;
            const o = (py * W + pxl) * 4;
            const on = density >= 1 || (density > 0 && BAYER4[(py & 3) * 4 + (pxl & 3)] < density);
            data[o] = r;
            data[o + 1] = g;
            data[o + 2] = b;
            data[o + 3] = on ? 255 : 0;
          }
        }
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.colorAltFt = altFt;
    this.colorMode = mode;
    this.colorAlert = alert;
    this.colorTrack = trackDeg;
    this.colorOnGround = onGround;
    this.colorGreen = greenBand;
    this.colorRwy = this.runwayElevFt;
    this.needsColor = false;
  }

  private topo(ft: number): void {
    const xs = TOPO_FT;
    if (ft >= xs[xs.length - 1]) {
      const c = TOPO_RGB[TOPO_RGB.length - 1];
      TMP[0] = c[0];
      TMP[1] = c[1];
      TMP[2] = c[2];
      return;
    }
    let i = 1;
    while (xs[i] < ft) i++;
    const t = (ft - xs[i - 1]) / (xs[i] - xs[i - 1]);
    const c0 = TOPO_RGB[i - 1];
    const c1 = TOPO_RGB[i];
    TMP[0] = c0[0] + (c1[0] - c0[0]) * t;
    TMP[1] = c0[1] + (c1[1] - c0[1]) * t;
    TMP[2] = c0[2] + (c1[2] - c0[2]) * t;
  }
}

const TMP = [0, 0, 0];

/** Options of {@link terrainBand} (see the TerrainRaster properties of the same names). */
export interface TerrainBandOptions {
  /**
   * 'relative': Garmin G3000/G5000 on-ground legend (red above +400 ft only).
   * 'egpws' (appended): on the ground with no known runway elevation, the aircraft's own altitude stands
   * in as the runway-blanking reference (the aircraft is at runway elevation; fix round 1 L05).
   */
  onGround?: boolean;
  /** 'relative': Garmin G3000/G5000 in-air green band -1000..-2000 ft. */
  greenBand?: boolean;
  /** 'egpws': terrain elevation and nearest runway elevation (ft MSL) for the 400 ft runway blanking. */
  elevFt?: number;
  runwayElevFt?: number;
}

/**
 * Pure classification used by the raster (exported for tests): relative
 * band for terrain `d` ft above (+) / below (-) the aircraft.
 * Returns 0 none, 1 yellow, 2 red, 3 green, and the density (0..1).
 */
export function terrainBand(mode: 'relative' | 'egpws', d: number, gearDown = false, o: TerrainBandOptions = {}): { band: 0 | 1 | 2 | 3; density: number } {
  if (mode === 'relative') {
    if (o.onGround) return d >= GARMIN_GROUND_RED_FT ? { band: 2, density: 1 } : { band: 0, density: 0 };
    if (d > -100) return { band: 2, density: 1 };
    if (d > -1000) return { band: 1, density: 1 };
    if (o.greenBand && d > -2000) return { band: 3, density: 1 };
    return { band: 0, density: 0 };
  }
  const el = o.elevFt ?? NaN;
  let rwy = o.runwayElevFt ?? NaN;
  if (!Number.isFinite(rwy) && o.onGround && Number.isFinite(el)) rwy = el - d; // own altitude = runway elevation on the ground
  if (Number.isFinite(el) && Number.isFinite(rwy) && Math.abs(el - rwy) <= EGPWS_RUNWAY_BLANK_FT) return { band: 0, density: 0 };
  if (d > 2000) return { band: 2, density: 0.5 };
  if (d > 1000) return { band: 1, density: 0.5 };
  if (d > (gearDown ? -250 : -500)) return { band: 1, density: 0.25 };
  if (d > -1000) return { band: 3, density: 0.5 };
  if (d > -2000) return { band: 3, density: 0.25 };
  return { band: 0, density: 0 };
}
