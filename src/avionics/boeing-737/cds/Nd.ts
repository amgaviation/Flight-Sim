/**
 * 737NG Navigation Display format (FCOM 10.10 "ND"; layout measured on a
 * 737NG ND photograph (Wikimedia Commons "737NG Navigation Display with
 * weather radar showing") and b737.org.uk ND images; EST where ambiguous).
 *
 * Modes (EFIS control panel): APP, VOR (heading up, expanded arc or
 * centred rose with course pointer and deviation), MAP (track up, arc or
 * CTR rose, route and map data), PLN (true north up, centred on the LEGS
 * page STEP waypoint). Range 5-640 nm = aircraft to the compass arc.
 *
 * Header: GS / TAS, wind (magnetic, arrow relative to the display), TRK/HDG
 * box with MAG, active waypoint (magenta) / ETA / distance (MAP, PLN) or
 * receiver / course / DME (APP, VOR).
 * Map: compass arc (ticks 5 deg, numbers every 30 deg), heading pointer,
 * selected heading bug (magenta), track line with range marks and half
 * range label, position trend vector (green, 30/60/90 s), altitude range
 * arc (green), route (active magenta, modified white dashed, missed approach
 * cyan) with fly-by turns, arcs and holds, waypoints (DATA: constraint and
 * ETA), T/C and T/D, FIX INFO circles/radials (green), map options STA /
 * WPT / ARPT (cyan; tuned navaids green) / POS (VOR and ADF bearing lines),
 * EGPWS terrain (TERR) with peaks numbers, weather radar hook (WXR), TCAS
 * traffic (TFC), VNAV path pointer, RNP / ANP, FMC source, cross-track,
 * VOR / ADF pointers and data blocks.
 */
import { ADC, AP, FMS, GPS, NAV } from '../../../core/vars';
import { fmtInt } from '../../common/format';
import { projectLocalNm, localToScreen, type LocalXY } from '../../common/math';
import { TerrainRaster } from '../../common/draw/TerrainRaster';
import type { Ctx2D } from '../../common/draw/context';
import type { Airport, Fix, Navaid } from '../../../nav/types';
import type { FlightPlan } from '../../../nav/flightplan/FlightPlan';
import { B737_VARS, EFIS_MAP_BUTTONS, NdMode, type Side } from '../vars';
import { CDS, LW, blink, cdsFont, haloText, line, text } from './style';
import type { CdsEnv, CdsFormatRenderer } from './types';

const DEG = Math.PI / 180;
const W = 800;
/** Expanded (arc) geometry: centre at the airplane symbol apex, arc radius (Commons ND photo scaled to 800 px). */
const EXP_CX = 400;
const EXP_CY = 618;
const EXP_R = 527;
/** Centred (rose) geometry (EST). */
const CTR_CX = 400;
const CTR_CY = 418;
const CTR_R = 300;
const MAP_TOP = 96;
const MAP_BOT = 712;

function wrap180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}
function wrap360(d: number): number {
  return ((d % 360) + 360) % 360;
}

export class Nd implements CdsFormatRenderer {
  private readonly env: CdsEnv;
  private side: Side = 1;
  private t = 0;
  // EFIS state
  private mode: NdMode = NdMode.Map;
  private ctr = false;
  private rangeNm = 20;
  private panel: Side = 1;
  // aircraft state
  private posValid = false;
  private lat = 0;
  private lon = 0;
  private hdgMag = 0;
  private hdgTrue = 0;
  private hdgValid = false;
  private trkMag = 0;
  private trkTrue = 0;
  private magVar = 0;
  private gs = 0;
  private tas = 0;
  private alt = 0;
  private vs = 0;
  private turnRate = 0;
  // geometry
  private cx = EXP_CX;
  private cy = EXP_CY;
  private radius = EXP_R;
  private pxPerNm = EXP_R / 20;
  private upTrue = 0;
  private upSin = 0;
  private upCos = 1;
  private refLat = 0;
  private refLon = 0;
  private cosRef = 1;
  private readonly pt: LocalXY = { x: 0, y: 0 };
  private readonly ln: LocalXY = { x: 0, y: 0 };
  // map database cache
  private airports: Airport[] = [];
  private navaids: Navaid[] = [];
  private fixes: Fix[] = [];
  private qLat = NaN;
  private qLon = NaN;
  private qRange = 0;
  private qT = 0;
  // terrain
  private terrain: TerrainRaster | null = null;
  private peakHi = NaN;
  private peakLo = NaN;
  private peakT = 0;

  constructor(env: CdsEnv) {
    this.env = env;
  }

  reset(): void {
    this.qT = 99;
  }

  // ================================================================ update

  update(dt: number, side: Side): void {
    const v = this.env.vars;
    this.side = side;
    this.t += dt;
    const p = v.get(B737_VARS.efisSourceFor(side), side) as Side;
    this.panel = p;
    this.mode = v.get(B737_VARS.efisMode(p)) as NdMode;
    this.ctr = v.get(B737_VARS.efisCtr(p)) !== 0 || this.mode === NdMode.Pln;
    this.rangeNm = v.get(B737_VARS.ndRangeNm(p), 20);
    const a = v.get(B737_VARS.airDataFor(side), side);
    this.posValid = v.get(GPS.valid) !== 0;
    this.lat = v.get(GPS.lat);
    this.lon = v.get(GPS.lon);
    this.hdgValid = v.get(ADC.ahrsValid(a), 1) !== 0;
    this.hdgMag = v.get(ADC.heading(a));
    this.magVar = v.get(GPS.magVar);
    this.hdgTrue = v.has(ADC.headingTrue(a)) ? v.get(ADC.headingTrue(a)) : this.hdgMag + this.magVar;
    this.gs = v.get(GPS.gs);
    this.tas = v.get(ADC.tas(a));
    this.alt = v.get(ADC.baroAlt(a));
    this.vs = v.get(ADC.vs(a));
    this.turnRate = v.get(ADC.turnRate(a));
    if (this.posValid && this.gs > 30) {
      this.trkMag = v.get(GPS.trackMag);
      this.trkTrue = v.get(GPS.trackTrue);
    } else {
      this.trkMag = this.hdgMag;
      this.trkTrue = this.hdgTrue;
    }
    // Geometry.
    if (this.ctr) {
      this.cx = CTR_CX;
      this.cy = CTR_CY;
      this.radius = CTR_R;
    } else {
      this.cx = EXP_CX;
      this.cy = EXP_CY;
      this.radius = EXP_R;
    }
    this.pxPerNm = this.radius / Math.max(1, this.rangeNm);
    this.upTrue = this.mode === NdMode.Pln ? 0 : this.mode === NdMode.Map ? this.trkTrue : this.hdgTrue;
    this.upSin = Math.sin(this.upTrue * DEG);
    this.upCos = Math.cos(this.upTrue * DEG);
    this.refLat = this.lat;
    this.refLon = this.lon;
    if (this.mode === NdMode.Pln) this.planCentre();
    this.cosRef = Math.cos(this.refLat * DEG);

    // Map database queries: refresh when moved 15 % of the range, the range changed, or 5 s passed.
    this.qT += dt;
    const nav = this.env.nav;
    const wantMap = this.mode === NdMode.Map || this.mode === NdMode.Pln;
    if (nav && nav.ready && wantMap && this.posValid) {
      const moved = Number.isNaN(this.qLat) ? Infinity : Math.hypot((this.refLat - this.qLat) * 60, (this.refLon - this.qLon) * 60 * this.cosRef);
      if (moved > this.rangeNm * 0.15 || this.qRange !== this.rangeNm || this.qT > 5) {
        this.qLat = this.refLat;
        this.qLon = this.refLon;
        this.qRange = this.rangeNm;
        this.qT = 0;
        const r = this.rangeNm * 1.45;
        const bt = (k: EfisKey): boolean => v.get(B737_VARS.efisMapButton(p, k)) !== 0;
        this.airports = bt('arpt') ? nav.airportsNear(this.refLat, this.refLon, r, 60).filter((ap) => ap.type === 'large_airport' || ap.type === 'medium_airport' || (this.rangeNm <= 40 && ap.type === 'small_airport' && ap.runways.some((rw) => rw.lengthFt >= 4000))) : [];
        this.navaids = bt('sta') ? nav.navaidsNear(this.refLat, this.refLon, r, ['VOR', 'VORDME', 'VORTAC', 'TACAN', 'DME', 'NDB', 'NDBDME']).slice(0, 60) : [];
        this.fixes = bt('wpt') && this.rangeNm <= 40 ? nav.fixesNear(this.refLat, this.refLon, r).filter((f) => !/[0-9]/.test(f.ident)).slice(0, this.rangeNm <= 10 ? 40 : 25) : [];
      }
    }

    // Terrain (EGPWS display, TERR switch).
    const terrOn = v.get(B737_VARS.efisMapButton(p, 'terr')) !== 0 && this.mode !== NdMode.Pln;
    if (terrOn && this.env.world) {
      if (!this.terrain) this.terrain = new TerrainRaster({ world: this.env.world, size: 96, samplesPerUpdate: 500 });
      this.terrain.mode = 'egpws';
      this.terrain.gearDown = v.get(this.env.cfg.vars.gearDown) !== 0;
      const warn = v.get(this.env.cfg.vars.tawsWarning) !== 0;
      const caut = v.get(this.env.cfg.vars.tawsCaution) !== 0;
      this.terrain.alertLevel = warn ? 2 : caut ? 1 : 0;
      this.terrain.update(this.lat, this.lon, this.rangeNm, this.alt, this.trkTrue);
      this.peakT += dt;
      if (this.peakT > 1) {
        this.peakT = 0;
        this.computePeaks();
      }
    } else if (this.terrain) this.terrain.mode = 'off';
  }

  /** PLN mode map centre: the STEP waypoint (FMC LEGS page) or the active waypoint. */
  private planCentre(): void {
    const plan = this.displayedPlan();
    if (!plan) return;
    let i = this.env.fmc?.planCenterIndex ?? -1;
    if (i < 0 || i >= plan.legs.length) i = Math.max(0, plan.activeLegIndex);
    for (let k = i; k < plan.legs.length; k++) {
      const f = plan.legs[k].fix;
      if (f && Number.isFinite(f.lat)) {
        this.refLat = f.lat;
        this.refLon = f.lon;
        return;
      }
    }
  }

  private computePeaks(): void {
    const tr = this.terrain;
    if (!tr) return;
    let hi = -Infinity;
    let lo = Infinity;
    const n = 12;
    const r = this.rangeNm;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const dx = (j / (n - 1) - 0.5) * 2 * r;
        const dy = (i / (n - 1)) * r;
        // Rotate the display-relative sample into north/east.
        const e = dx * this.upCos + dy * this.upSin;
        const nn = -dx * this.upSin + dy * this.upCos;
        const el = tr.cachedElevationFt(this.lat + nn / 60, this.lon + e / (60 * this.cosRef));
        if (!Number.isFinite(el)) continue;
        if (el > hi) hi = el;
        if (el < lo) lo = el;
      }
    }
    this.peakHi = Number.isFinite(hi) ? hi : NaN;
    this.peakLo = Number.isFinite(lo) ? lo : NaN;
  }

  private displayedPlan(): FlightPlan | null {
    const fms = this.env.fms;
    if (!fms) return null;
    return fms.plans.active;
  }

  /** Projects lat/lon into this.pt (screen px). */
  private project(lat: number, lon: number): LocalXY {
    projectLocalNm(lat, lon, this.refLat, this.refLon, this.cosRef, this.ln);
    return localToScreen(this.ln.x, this.ln.y, this.upSin, this.upCos, this.mode === NdMode.Pln ? this.cx : this.cx, this.cy, this.pxPerNm, this.pt);
  }

  /** Screen position of a point `distNm` from the aircraft on a true bearing (relative to the reference). */
  private projectBearing(brgTrue: number, distNm: number, out: LocalXY): LocalXY {
    const x = Math.sin(brgTrue * DEG) * distNm;
    const y = Math.cos(brgTrue * DEG) * distNm;
    // Offset of the aircraft from the reference (PLN).
    projectLocalNm(this.lat, this.lon, this.refLat, this.refLon, this.cosRef, this.ln);
    return localToScreen(this.ln.x + x, this.ln.y + y, this.upSin, this.upCos, this.cx, this.cy, this.pxPerNm, out);
  }

  // ================================================================ draw

  draw(ctx: Ctx2D): void {
    const v = this.env.vars;
    if (!this.hdgValid && this.mode !== NdMode.Pln) {
      this.flag(ctx, 'HDG', W / 2, 60);
      return;
    }
    const isMap = this.mode === NdMode.Map || this.mode === NdMode.Pln;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, MAP_TOP - (this.ctr ? 20 : 0), W, MAP_BOT - MAP_TOP + 60);
    ctx.clip();
    // Terrain / weather under everything.
    if (this.terrain && this.terrain.mode !== 'off') {
      const tr = this.terrain;
      this.project(tr.gridLat, tr.gridLon);
      tr.draw(ctx, this.pt.x, this.pt.y, this.pxPerNm, this.upTrue);
    }
    if (this.env.weather && v.get(B737_VARS.efisMapButton(this.panel, 'wxr')) !== 0 && this.mode !== NdMode.Pln) {
      this.env.weather(ctx, { cx: this.cx, cy: this.cy, pxPerNm: this.pxPerNm, upDeg: this.upTrue, rangeNm: this.rangeNm, side: this.side });
    }
    if (isMap && this.posValid) {
      this.drawMapData(ctx);
      this.drawFixInfo(ctx);
      this.drawRoute(ctx);
      this.drawTocTod(ctx);
    }
    ctx.restore();

    if (this.mode === NdMode.Pln) this.drawPlanRose(ctx);
    else this.drawCompass(ctx);
    if (isMap && this.mode === NdMode.Map) {
      this.drawTrackLine(ctx);
      this.drawTrend(ctx);
      this.drawAltitudeArc(ctx);
      this.drawVnavPointer(ctx);
    }
    if (this.mode === NdMode.App || this.mode === NdMode.Vor) this.drawCourse(ctx);
    this.drawBearingPointers(ctx);
    this.drawTraffic(ctx);
    this.drawAircraft(ctx);
    this.drawHeader(ctx);
    this.drawFooter(ctx);
  }

  // ---------------------------------------------------------------- compass
  private drawCompass(ctx: Ctx2D): void {
    const v = this.env.vars;
    const up = this.mode === NdMode.Map ? this.trkMag : this.hdgMag;
    const cx = this.cx;
    const cy = this.cy;
    const r = this.radius;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 70, W, MAP_BOT);
    ctx.clip();
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    if (this.ctr) ctx.arc(cx, cy, r, 0, Math.PI * 2);
    else ctx.arc(cx, cy, r, -Math.PI / 2 - 62 * DEG, -Math.PI / 2 + 62 * DEG);
    ctx.stroke();
    const span = this.ctr ? 180 : 62;
    ctx.beginPath();
    const h0 = Math.ceil((up - span) / 5) * 5;
    for (let h = h0; h <= up + span; h += 5) {
      const a = (h - up) * DEG;
      const len = h % 10 === 0 ? 18 : 10;
      const s = Math.sin(a);
      const c = Math.cos(a);
      ctx.moveTo(cx + s * r, cy - c * r);
      ctx.lineTo(cx + s * (r - len), cy - c * (r - len));
    }
    ctx.stroke();
    for (let h = Math.ceil((up - span) / 30) * 30; h <= up + span; h += 30) {
      const a = (h - up) * DEG;
      const n = wrap360(h) / 10;
      ctx.save();
      ctx.translate(cx + Math.sin(a) * (r - 40), cy - Math.cos(a) * (r - 40));
      ctx.rotate(a);
      text(ctx, fmtInt(n === 0 ? 0 : n), 0, 0, 30, CDS.white, 'center');
      ctx.restore();
    }
    // Centred modes: range ring at half range (dashed white).
    if (this.ctr) {
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(cx, cy, r / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Heading pointer (white triangle) in MAP (track up) mode; track pointer in heading-up modes.
    const hp = this.mode === NdMode.Map ? wrap180(this.hdgMag - up) : 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(hp * DEG);
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    ctx.moveTo(0, -r + 2);
    ctx.lineTo(-11, -r - 18);
    ctx.lineTo(11, -r - 18);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // Selected heading bug (magenta) + dashed heading line for 10 s after a change is not modelled (always off; EST).
    const sel = v.get(AP.selHeading);
    const d = wrap180(sel - up);
    if (Math.abs(d) <= span) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(d * DEG);
      ctx.strokeStyle = CDS.magenta;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      ctx.moveTo(-15, -r);
      ctx.lineTo(-15, -r - 12);
      ctx.lineTo(15, -r - 12);
      ctx.lineTo(15, -r);
      ctx.lineTo(7, -r);
      ctx.lineTo(0, -r - 9);
      ctx.lineTo(-7, -r);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    // Heading-up modes: track line (white) at the track angle.
    if (this.mode !== NdMode.Map) {
      const td = wrap180(this.trkMag - this.hdgMag);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(td * DEG);
      line(ctx, 0, -r + 24, 0, -40, CDS.white, LW.thin);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawPlanRose(ctx: Ctx2D): void {
    const cx = this.cx;
    const cy = this.cy;
    const r = this.radius;
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(cx, cy, r / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // North arrow and cardinal ticks.
    for (let k = 0; k < 4; k++) {
      const a = k * 90 * DEG;
      line(ctx, cx + Math.sin(a) * (r - 14), cy - Math.cos(a) * (r - 14), cx + Math.sin(a) * (r + 14), cy - Math.cos(a) * (r + 14), CDS.white, LW.normal);
    }
    text(ctx, 'N', cx, cy - r - 28, 26, CDS.white, 'center');
    ctx.fillStyle = CDS.white;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r - 12);
    ctx.lineTo(cx - 8, cy - r + 2);
    ctx.lineTo(cx + 8, cy - r + 2);
    ctx.closePath();
    ctx.fill();
    text(ctx, fmtInt(this.rangeNm / 2), cx + r / 2 + 6, cy - 12, 20, CDS.white, 'left');
  }

  private drawTrackLine(ctx: Ctx2D): void {
    const cx = this.cx;
    const cy = this.cy;
    const r = this.radius;
    line(ctx, cx, cy - 58, cx, cy - r + 20, CDS.white, LW.thin);
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.moveTo(cx - 8, cy - r * f);
      ctx.lineTo(cx + 8, cy - r * f);
    }
    ctx.stroke();
    const half = this.rangeNm / 2;
    text(ctx, half < 10 ? half.toFixed(1).replace('.0', '') : fmtInt(half), cx - 12, cy - r / 2, 26, CDS.white, 'right');
  }

  // ---------------------------------------------------------------- map data
  private drawMapData(ctx: Ctx2D): void {
    const v = this.env.vars;
    const tuned1 = v.getString(NAV.ident(1));
    const tuned2 = v.getString(NAV.ident(2));
    for (const ap of this.airports) {
      this.project(ap.lat, ap.lon);
      if (!this.onMap()) continue;
      ctx.strokeStyle = CDS.cyan;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      ctx.arc(this.pt.x, this.pt.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      text(ctx, ap.icao, this.pt.x + 16, this.pt.y + 16, 20, CDS.cyan, 'left');
    }
    for (const n of this.navaids) {
      this.project(n.lat, n.lon);
      if (!this.onMap()) continue;
      const tuned = n.ident === tuned1 || n.ident === tuned2;
      const col = tuned ? CDS.green : CDS.cyan;
      this.navaidSymbol(ctx, this.pt.x, this.pt.y, n.type, col);
      text(ctx, n.ident, this.pt.x + 16, this.pt.y + 16, 20, col, 'left');
    }
    for (const f of this.fixes) {
      this.project(f.lat, f.lon);
      if (!this.onMap()) continue;
      this.star(ctx, this.pt.x, this.pt.y, 8, CDS.cyan);
      text(ctx, f.ident, this.pt.x + 12, this.pt.y + 14, 18, CDS.cyan, 'left');
    }
    // POS: VOR radials / ADF bearings from the stations (green / cyan lines to the aircraft).
    if (v.get(B737_VARS.efisMapButton(this.panel, 'pos')) !== 0) {
      for (const r of [1, 2]) {
        if (v.get(NAV.bearingValid(r)) === 0) continue;
        const brgMag = v.get(NAV.bearing(r));
        this.projectBearing(brgMag + this.magVar, Math.min(this.rangeNm * 1.3, v.get(NAV.distNm(r)) || this.rangeNm), this.pt);
        ctx.setLineDash([10, 8]);
        line(ctx, this.cx, this.cy, this.pt.x, this.pt.y, CDS.green, LW.thin);
        ctx.setLineDash([]);
      }
    }
  }

  private onMap(): boolean {
    const x = this.pt.x;
    const y = this.pt.y;
    return x > -20 && x < W + 20 && y > MAP_TOP - 30 && y < MAP_BOT + 40;
  }

  private navaidSymbol(ctx: Ctx2D, x: number, y: number, type: string, col: string): void {
    ctx.strokeStyle = col;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    if (type === 'NDB' || type === 'NDBDME') {
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.moveTo(x + 3, y);
      ctx.arc(x, y, 3, 0, Math.PI * 2);
    } else if (type === 'DME' || type === 'TACAN') {
      ctx.rect(x - 7, y - 7, 14, 14);
    } else if (type === 'VORTAC') {
      // Three-lobed VORTAC symbol (the Commons ND photo "VBI").
      for (let k = 0; k < 3; k++) {
        const a = (k * 120 - 90) * DEG;
        const lx = x + Math.cos(a) * 8;
        const ly = y + Math.sin(a) * 8;
        ctx.moveTo(x, y);
        ctx.lineTo(lx, ly);
        ctx.moveTo(lx + 5, ly);
        ctx.arc(lx, ly, 5, 0, Math.PI * 2);
      }
    } else {
      // VOR: hexagon; VOR/DME: hexagon in a square.
      for (let k = 0; k <= 6; k++) {
        const a = (k * 60) * DEG;
        const px = x + Math.cos(a) * 8;
        const py = y + Math.sin(a) * 8;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      if (type === 'VORDME') ctx.rect(x - 10, y - 10, 20, 20);
    }
    ctx.stroke();
  }

  private star(ctx: Ctx2D, x: number, y: number, s: number, col: string): void {
    ctx.strokeStyle = col;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.5);
    ctx.lineTo(x + s * 0.35, y - s * 0.35);
    ctx.lineTo(x + s * 1.5, y);
    ctx.lineTo(x + s * 0.35, y + s * 0.35);
    ctx.lineTo(x, y + s * 1.5);
    ctx.lineTo(x - s * 0.35, y + s * 0.35);
    ctx.lineTo(x - s * 1.5, y);
    ctx.lineTo(x - s * 0.35, y - s * 0.35);
    ctx.closePath();
    ctx.stroke();
  }

  // ---------------------------------------------------------------- route
  private drawRoute(ctx: Ctx2D): void {
    const fms = this.env.fms;
    if (!fms) return;
    const act = fms.plans.active;
    const mod = fms.plans.modified;
    this.drawPlan(ctx, act, false);
    if (mod) this.drawPlan(ctx, mod, true);
  }

  private drawPlan(ctx: Ctx2D, plan: FlightPlan, modified: boolean): void {
    const v = this.env.vars;
    const legs = plan.legs;
    const act = plan.activeLegIndex;
    const first = modified ? Math.max(0, act) : Math.max(0, act);
    const missedStart = plan.firstMissedIndex;
    const missedActive = v.get(FMS.missedActive) !== 0;
    ctx.lineWidth = LW.normal + 0.6;
    if (modified) ctx.setLineDash([14, 10]);
    for (let i = first; i < legs.length; i++) {
      const leg = legs[i];
      if (leg.type === 'DISCO' || !leg.geom.valid) continue;
      const missed = missedStart >= 0 && i >= missedStart && !missedActive;
      const col = modified ? CDS.white : missed ? CDS.cyan : CDS.magenta;
      ctx.strokeStyle = col;
      this.legPath(ctx, plan, i, i === act);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Waypoints with labels (active waypoint magenta).
    const data = v.get(B737_VARS.efisMapButton(this.panel, 'data')) !== 0;
    const fms = this.env.fms;
    for (let i = Math.max(0, act); i < legs.length; i++) {
      const leg = legs[i];
      const f = leg.fix;
      if (!f || leg.type === 'DISCO' || !Number.isFinite(f.lat)) continue;
      if (leg.type === 'HM' || leg.type === 'HF' || leg.type === 'HA') continue;
      this.project(leg.geom.valid && Number.isFinite(leg.geom.endLat) ? leg.geom.endLat : f.lat, leg.geom.valid && Number.isFinite(leg.geom.endLon) ? leg.geom.endLon : f.lon);
      if (!this.onMap()) continue;
      const activeWpt = i === act && !modified;
      const col = activeWpt ? CDS.magenta : CDS.white;
      const x = this.pt.x;
      const y = this.pt.y;
      if (f.kind === 'runway') {
        this.runwaySymbol(ctx, plan, f.airport ?? '', f.ident.replace(/^RW/, ''), col);
      } else if (f.kind === 'airport') {
        ctx.strokeStyle = col;
        ctx.lineWidth = LW.normal;
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.stroke();
      } else this.star(ctx, x, y, 9, col);
      haloText(ctx, f.ident, x + 18, y + 18, 21, col, 'left');
      if (data) {
        let yy = y + 40;
        const c = leg.altitude;
        if (c) {
          const alt = c.kind === 'atOrBelow' ? c.upperFt ?? 0 : c.lowerFt ?? c.upperFt ?? 0;
          const suffix = c.kind === 'atOrAbove' ? 'A' : c.kind === 'atOrBelow' ? 'B' : '';
          text(ctx, (alt >= 18000 ? 'FL' + fmtInt(Math.round(alt / 100)) : fmtInt(alt)) + suffix, x + 18, yy, 18, col, 'left');
          yy += 20;
        }
        const eta = fms && fms.perf.count > i ? fms.perf.etaUtcH[i] : NaN;
        if (Number.isFinite(eta) && !modified) text(ctx, this.fmtZulu(eta), x + 18, yy, 18, col, 'left');
      }
    }
  }

  /** Builds the path of leg `i` (fly-by turns replace the corners). */
  private legPath(ctx: Ctx2D, plan: FlightPlan, i: number, isActive: boolean): void {
    const leg = plan.legs[i];
    const g = leg.geom;
    const prev = i > 0 ? plan.legs[i - 1] : undefined;
    ctx.beginPath();
    switch (g.kind) {
      case 'gc':
      case 'heading': {
        let sLat = g.startLat;
        let sLon = g.startLon;
        if (prev && prev.type !== 'DISCO' && prev.geom.valid && prev.geom.turnValid && !isActive) {
          sLat = prev.geom.turnEndLat;
          sLon = prev.geom.turnEndLon;
        }
        if (isActive && leg.dfStartLat !== undefined && leg.type === 'DF') {
          sLat = leg.dfStartLat;
          sLon = leg.dfStartLon ?? sLon;
        }
        const eLat = g.turnValid ? g.turnStartLat : g.endLat;
        const eLon = g.turnValid ? g.turnStartLon : g.endLon;
        if (!Number.isFinite(sLat) || !Number.isFinite(eLat)) return;
        this.project(sLat, sLon);
        ctx.moveTo(this.pt.x, this.pt.y);
        this.project(eLat, eLon);
        ctx.lineTo(this.pt.x, this.pt.y);
        if (g.kind === 'heading') ctx.setLineDash([10, 10]);
        break;
      }
      case 'arc': {
        const n = Math.max(4, Math.ceil(g.sweepDeg / 6));
        for (let k = 0; k <= n; k++) {
          const b = g.startRadial + g.turnDir * g.sweepDeg * (k / n);
          this.pointFrom(g.centerLat, g.centerLon, b, g.radiusNm);
          if (k === 0) ctx.moveTo(this.pt.x, this.pt.y);
          else ctx.lineTo(this.pt.x, this.pt.y);
        }
        break;
      }
      case 'hold': {
        // Racetrack: inbound leg ending at the fix, turn, outbound, turn.
        const fLat = g.endLat;
        const fLon = g.endLon;
        if (!Number.isFinite(fLat)) return;
        const inb = g.holdInboundTrue;
        const dir = g.turnDir || 1;
        const r = g.radiusNm;
        const L = g.holdLegNm;
        // Local frame: along = inbound direction, side = turn side.
        const ax = Math.sin(inb * DEG);
        const ay = Math.cos(inb * DEG);
        const sx = Math.sin((inb + dir * 90) * DEG);
        const sy = Math.cos((inb + dir * 90) * DEG);
        projectLocalNm(fLat, fLon, this.refLat, this.refLon, this.cosRef, this.ln);
        const fx = this.ln.x;
        const fy = this.ln.y;
        const pts = 10;
        const pnt = (xn: number, yn: number, first: boolean): void => {
          localToScreen(xn, yn, this.upSin, this.upCos, this.cx, this.cy, this.pxPerNm, this.pt);
          if (first) ctx.moveTo(this.pt.x, this.pt.y);
          else ctx.lineTo(this.pt.x, this.pt.y);
        };
        pnt(fx - ax * L, fy - ay * L, true);
        pnt(fx, fy, false);
        // Turn at the fix end (centre offset r to the turn side).
        const c1x = fx + sx * r;
        const c1y = fy + sy * r;
        for (let k = 1; k <= pts; k++) {
          const a = Math.PI * (k / pts);
          pnt(c1x - sx * r * Math.cos(a) + ax * r * Math.sin(a), c1y - sy * r * Math.cos(a) + ay * r * Math.sin(a), false);
        }
        pnt(fx + sx * 2 * r - ax * L, fy + sy * 2 * r - ay * L, false);
        const c2x = fx + sx * r - ax * L;
        const c2y = fy + sy * r - ay * L;
        for (let k = 1; k <= pts; k++) {
          const a = Math.PI * (k / pts);
          pnt(c2x + sx * r * Math.cos(a) - ax * r * Math.sin(a), c2y + sy * r * Math.cos(a) - ay * r * Math.sin(a), false);
        }
        break;
      }
      default: {
        if (!Number.isFinite(g.startLat) || !Number.isFinite(g.endLat)) return;
        this.project(g.startLat, g.startLon);
        ctx.moveTo(this.pt.x, this.pt.y);
        this.project(g.endLat, g.endLon);
        ctx.lineTo(this.pt.x, this.pt.y);
      }
    }
    // Fly-by turn into the next leg.
    if (g.turnValid && g.kind !== 'hold' && Number.isFinite(g.turnCenterLat)) {
      const b0 = this.bearingFrom(g.turnCenterLat, g.turnCenterLon, g.turnStartLat, g.turnStartLon);
      const b1 = this.bearingFrom(g.turnCenterLat, g.turnCenterLon, g.turnEndLat, g.turnEndLon);
      let sweep = wrap360((b1 - b0) * Math.sign(g.turnAngleDeg || 1));
      if (sweep > 180) sweep = 360 - sweep;
      const n = Math.max(3, Math.ceil(sweep / 8));
      for (let k = 0; k <= n; k++) {
        const b = b0 + Math.sign(g.turnAngleDeg || 1) * sweep * (k / n);
        this.pointFrom(g.turnCenterLat, g.turnCenterLon, b, g.turnRadiusNm);
        if (k === 0) ctx.moveTo(this.pt.x, this.pt.y);
        else ctx.lineTo(this.pt.x, this.pt.y);
      }
    }
  }

  private pointFrom(lat: number, lon: number, brg: number, distNm: number): void {
    projectLocalNm(lat, lon, this.refLat, this.refLon, this.cosRef, this.ln);
    localToScreen(this.ln.x + Math.sin(brg * DEG) * distNm, this.ln.y + Math.cos(brg * DEG) * distNm, this.upSin, this.upCos, this.cx, this.cy, this.pxPerNm, this.pt);
  }

  private bearingFrom(lat0: number, lon0: number, lat1: number, lon1: number): number {
    const dx = (lon1 - lon0) * Math.cos(lat0 * DEG);
    const dy = lat1 - lat0;
    return wrap360(Math.atan2(dx, dy) / DEG);
  }

  private runwaySymbol(ctx: Ctx2D, _plan: FlightPlan, icao: string, rwIdent: string, col: string): void {
    const ap = this.env.nav?.airport(icao);
    const rw = ap?.runways.find((r) => r.ident.replace(/^0/, '') === rwIdent.replace(/^0/, ''));
    if (!rw) {
      this.star(ctx, this.pt.x, this.pt.y, 9, col);
      return;
    }
    const lenNm = rw.lengthFt / 6076.12;
    const x0 = this.pt.x;
    const y0 = this.pt.y;
    const a = (rw.headingTrue - this.upTrue) * DEG;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const w = 6;
    const lx = dx * lenNm * this.pxPerNm;
    const ly = dy * lenNm * this.pxPerNm;
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    ctx.moveTo(x0 - dy * w, y0 + dx * w);
    ctx.lineTo(x0 - dy * w + lx, y0 + dx * w + ly);
    ctx.moveTo(x0 + dy * w, y0 - dx * w);
    ctx.lineTo(x0 + dy * w + lx, y0 - dx * w + ly);
    ctx.stroke();
    // Extended centre line (dashed, 14.2 nm) behind the threshold (EST length).
    ctx.setLineDash([8, 8]);
    line(ctx, x0, y0, x0 - dx * 14.2 * this.pxPerNm, y0 - dy * 14.2 * this.pxPerNm, CDS.white, LW.thin);
    ctx.setLineDash([]);
    void col;
  }

  private drawTocTod(ctx: Ctx2D): void {
    const fmc = this.env.fmc;
    if (!fmc) return;
    for (const [p, lbl] of [
      [fmc.toc, 'T/C'],
      [fmc.tod, 'T/D'],
    ] as const) {
      if (!Number.isFinite(p.lat)) continue;
      this.project(p.lat, p.lon);
      if (!this.onMap()) continue;
      ctx.strokeStyle = CDS.green;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      ctx.arc(this.pt.x, this.pt.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      text(ctx, lbl, this.pt.x + 16, this.pt.y, 21, CDS.green, 'left');
    }
  }

  private drawFixInfo(ctx: Ctx2D): void {
    const fmc = this.env.fmc;
    if (!fmc) return;
    ctx.strokeStyle = CDS.green;
    ctx.lineWidth = LW.normal;
    for (const f of fmc.fixes) {
      this.project(f.lat, f.lon);
      const fx = this.pt.x;
      const fy = this.pt.y;
      ctx.beginPath();
      ctx.arc(fx, fy, 12, 0, Math.PI * 2);
      ctx.stroke();
      text(ctx, f.ident, fx + 16, fy - 16, 20, CDS.green, 'left');
      ctx.setLineDash([10, 8]);
      for (let k = 0; k < f.distancesNm.length; k++) {
        const d = f.distancesNm[k];
        if (Number.isFinite(d) && d > 0) {
          ctx.beginPath();
          ctx.arc(fx, fy, d * this.pxPerNm, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      for (let k = 0; k < f.radials.length; k++) {
        const rad = f.radials[k];
        if (!Number.isFinite(rad)) continue;
        this.pointFrom(f.lat, f.lon, rad + f.magVar, this.rangeNm * 2);
        line(ctx, fx, fy, this.pt.x, this.pt.y, CDS.green, LW.normal);
      }
      ctx.setLineDash([]);
    }
  }

  // ---------------------------------------------------------------- dynamic symbols
  private drawTrend(ctx: Ctx2D): void {
    if (this.gs < 40 || this.rangeNm > 160) return;
    // Position trend vector: 30 s segments, 3 (range >= 20 nm), 2 (10 nm) or 1 (5 nm) (FCOM "position trend vector"; EST split).
    const segs = this.rangeNm >= 20 ? 3 : this.rangeNm >= 10 ? 2 : 1;
    const w = (this.turnRate * DEG); // rad/s
    const vNmS = this.gs / 3600;
    ctx.strokeStyle = CDS.green;
    ctx.lineWidth = LW.normal;
    let x = 0;
    let y = 0;
    let a = 0;
    ctx.beginPath();
    ctx.moveTo(this.cx, this.cy - 58);
    const steps = 10;
    for (let s = 0; s < segs; s++) {
      for (let k = 0; k < steps; k++) {
        const dt = 30 / steps;
        a += w * dt;
        x += Math.sin(a) * vNmS * dt;
        y += Math.cos(a) * vNmS * dt;
        const sx = this.cx + x * this.pxPerNm;
        const sy = this.cy - y * this.pxPerNm;
        if (k === 0 && s > 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
        if (k === steps - 2) {
          // Gap between the 30 s segments.
          const nx = this.cx + (x + Math.sin(a) * vNmS * dt) * this.pxPerNm;
          const ny = this.cy - (y + Math.cos(a) * vNmS * dt) * this.pxPerNm;
          ctx.moveTo(nx, ny);
        }
      }
    }
    ctx.stroke();
  }

  private drawAltitudeArc(ctx: Ctx2D): void {
    const sel = this.env.vars.get(AP.selAltitude);
    const d = sel - this.alt;
    if (Math.abs(this.vs) < 200 || Math.abs(d) < 150 || Math.sign(d) !== Math.sign(this.vs)) return;
    const distNm = ((d / this.vs) * this.gs) / 60;
    const rPx = distNm * this.pxPerNm;
    if (rPx < 60 || rPx > this.radius) return;
    ctx.strokeStyle = CDS.green;
    ctx.lineWidth = LW.normal + 0.4;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, rPx, -Math.PI / 2 - 0.22, -Math.PI / 2 + 0.22);
    ctx.stroke();
  }

  private drawVnavPointer(ctx: Ctx2D): void {
    const v = this.env.vars;
    if (v.get(FMS.vnavValid) === 0 || v.getString(FMS.vnavPhase) !== 'DES') return;
    const dev = v.get(FMS.vnavDevFt);
    const x = 764;
    const cy = 400;
    const dot = 42;
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    for (const k of [-2, -1, 1, 2]) {
      ctx.moveTo(x + 6, cy + k * dot);
      ctx.arc(x, cy + k * dot, 6, 0, Math.PI * 2);
    }
    ctx.moveTo(x - 14, cy);
    ctx.lineTo(x + 14, cy);
    ctx.stroke();
    // Full scale +/-400 ft (EST). Path below the aircraft (aircraft high, dev > 0) -> pointer below centre.
    const y = cy + Math.max(-2.3, Math.min(2.3, (dev / 400) * 2)) * dot;
    ctx.fillStyle = CDS.magenta;
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x + 9, y);
    ctx.lineTo(x, y + 14);
    ctx.lineTo(x - 9, y);
    ctx.closePath();
    ctx.fill();
    if (Math.abs(dev) > 400) text(ctx, fmtInt(Math.round(dev / 10) * 10), x - 16, dev > 0 ? cy + 2.6 * dot : cy - 2.6 * dot, 18, CDS.white, 'right');
  }

  private drawCourse(ctx: Ctx2D): void {
    const v = this.env.vars;
    const r = v.get(B737_VARS.navRxFor(this.side), this.side);
    const crs = v.get(AP.selCourse(this.side), v.get(NAV.obs(r)));
    const isLoc = v.get(NAV.isLoc(r)) !== 0;
    const valid = v.get(NAV.received(r)) !== 0;
    const d = wrap180(crs - this.hdgMag);
    const cx = this.cx;
    const cy = this.cy;
    const R = this.ctr ? this.radius - 30 : 200;
    const dot = this.ctr ? 60 : 60;
    ctx.save();
    ctx.translate(cx, cy - (this.ctr ? 0 : 150));
    ctx.rotate(d * DEG);
    // Course pointer (magenta, head and tail).
    ctx.strokeStyle = CDS.magenta;
    ctx.lineWidth = LW.thick;
    ctx.beginPath();
    ctx.moveTo(0, -R);
    ctx.lineTo(0, -R + 90);
    ctx.moveTo(0, R);
    ctx.lineTo(0, R - 90);
    ctx.moveTo(-12, -R + 22);
    ctx.lineTo(0, -R);
    ctx.lineTo(12, -R + 22);
    ctx.stroke();
    // Deviation dots and bar.
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    for (const k of [-2, -1, 1, 2]) {
      ctx.moveTo(k * dot + 7, 0);
      ctx.arc(k * dot, 0, 7, 0, Math.PI * 2);
    }
    ctx.stroke();
    if (valid) {
      const cdi = v.get(NAV.cdi(r));
      const x = Math.max(-2.2, Math.min(2.2, cdi * 2)) * dot;
      ctx.strokeStyle = CDS.magenta;
      ctx.lineWidth = LW.thick + 1;
      line(ctx, x, -R + 100, x, R - 100, CDS.magenta, LW.thick + 1);
      // VOR TO/FROM triangle.
      if (!isLoc) {
        const tf = v.get(NAV.toFrom(r));
        if (tf !== 0) {
          ctx.fillStyle = CDS.white;
          ctx.beginPath();
          const ty = tf > 0 ? -R + 130 : R - 130;
          ctx.moveTo(0, ty - tf * 14);
          ctx.lineTo(-11, ty + tf * 6);
          ctx.lineTo(11, ty + tf * 6);
          ctx.closePath();
          ctx.fill();
        }
      }
    } else {
      text(ctx, isLoc ? 'LOC' : 'VOR', -60, -60, 22, CDS.amber, 'center');
    }
    ctx.restore();
    // Glideslope (APP mode, ILS).
    if (this.mode === NdMode.App && isLoc) {
      const gx = 756;
      const gy = 400;
      ctx.strokeStyle = CDS.white;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      for (const k of [-2, -1, 1, 2]) {
        ctx.moveTo(gx + 6, gy + k * 44);
        ctx.arc(gx, gy + k * 44, 6, 0, Math.PI * 2);
      }
      ctx.moveTo(gx - 14, gy);
      ctx.lineTo(gx + 14, gy);
      ctx.stroke();
      if (v.get(NAV.gsValid(r)) !== 0) {
        const y = gy - Math.max(-2.3, Math.min(2.3, v.get(NAV.gsDev(r)) * 2)) * 44;
        ctx.fillStyle = CDS.magenta;
        ctx.beginPath();
        ctx.moveTo(gx, y - 14);
        ctx.lineTo(gx + 9, y);
        ctx.lineTo(gx, y + 14);
        ctx.lineTo(gx - 9, y);
        ctx.closePath();
        ctx.fill();
      } else text(ctx, 'G/S', gx, gy - 120, 20, CDS.amber, 'center');
    }
  }

  private drawBearingPointers(ctx: Ctx2D): void {
    const v = this.env.vars;
    const p = this.panel;
    for (const n of [1, 2] as const) {
      const sel = v.get(B737_VARS.efisVorAdf(p, n));
      if (sel === 0) continue;
      let valid: boolean;
      let brgMag: number;
      if (sel > 0) {
        valid = v.get(NAV.bearingValid(n)) !== 0;
        brgMag = v.get(NAV.bearing(n));
      } else {
        valid = v.get(NAV.adfValid(n)) !== 0;
        brgMag = this.hdgMag + v.get(NAV.adfBearing(n));
      }
      if (!valid) continue;
      const up = this.mode === NdMode.Map ? this.trkMag : this.mode === NdMode.Pln ? 0 : this.hdgMag;
      const a = wrap180(brgMag - up) * DEG;
      const col = sel > 0 ? CDS.green : CDS.cyan;
      const r = this.radius - 22;
      const hx = this.cx + Math.sin(a) * r;
      const hy = this.cy - Math.cos(a) * r;
      const tx = this.cx - Math.sin(a) * r;
      const ty = this.cy + Math.cos(a) * r;
      ctx.strokeStyle = col;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      if (n === 1) {
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - Math.sin(a) * 70, hy + Math.cos(a) * 70);
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.sin(a) * 70, ty - Math.cos(a) * 70);
      } else {
        const ox = Math.cos(a) * 5;
        const oy = Math.sin(a) * 5;
        for (const s of [-1, 1]) {
          ctx.moveTo(hx + s * ox - Math.sin(a) * 14, hy + s * oy + Math.cos(a) * 14);
          ctx.lineTo(hx + s * ox - Math.sin(a) * 70, hy + s * oy + Math.cos(a) * 70);
          ctx.moveTo(tx + s * ox, ty + s * oy);
          ctx.lineTo(tx + s * ox + Math.sin(a) * 70, ty + s * oy - Math.cos(a) * 70);
        }
      }
      // Arrow head.
      ctx.moveTo(hx - Math.sin(a) * 18 + Math.cos(a) * 10, hy + Math.cos(a) * 18 + Math.sin(a) * 10);
      ctx.lineTo(hx, hy);
      ctx.lineTo(hx - Math.sin(a) * 18 - Math.cos(a) * 10, hy + Math.cos(a) * 18 - Math.sin(a) * 10);
      ctx.stroke();
    }
  }

  private drawTraffic(ctx: Ctx2D): void {
    const v = this.env.vars;
    const tr = this.env.traffic;
    if (v.get(B737_VARS.efisTfc(this.panel)) === 0 || this.mode === NdMode.Pln) return;
    // 3 nm TCAS range ring (12 dots) around the airplane when TFC is selected (Commons ND photo).
    const rr = 3 * this.pxPerNm;
    if (rr > 12 && rr < 200) {
      ctx.fillStyle = CDS.white;
      for (let k = 0; k < 12; k++) {
        const a = (k * 30) * DEG;
        ctx.beginPath();
        ctx.arc(this.cx + Math.sin(a) * rr, this.cy - Math.cos(a) * rr, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (!tr) return;
    const up = this.mode === NdMode.Map ? this.trkMag : this.hdgMag;
    for (const th of tr.threats) {
      const brgMag = this.hdgMag + th.relBrgDeg;
      const a = wrap180(brgMag - up) * DEG;
      const x = this.cx + Math.sin(a) * th.rangeNm * this.pxPerNm;
      const y = this.cy - Math.cos(a) * th.rangeNm * this.pxPerNm;
      if (y < MAP_TOP || y > MAP_BOT || x < 0 || x > W) continue;
      const lvl = th.level;
      const col = lvl >= 3 ? CDS.red : lvl === 2 ? CDS.amber : CDS.white;
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.lineWidth = LW.normal;
      ctx.beginPath();
      if (lvl >= 3) ctx.rect(x - 9, y - 9, 18, 18);
      else if (lvl === 2) ctx.arc(x, y, 9, 0, Math.PI * 2);
      else {
        ctx.moveTo(x, y - 11);
        ctx.lineTo(x + 9, y);
        ctx.lineTo(x, y + 11);
        ctx.lineTo(x - 9, y);
        ctx.closePath();
      }
      if (lvl >= 1) ctx.fill();
      else ctx.stroke();
      const ra = Math.round(th.relAltFt / 100);
      const s = (ra >= 0 ? '+' : '-') + fmtInt(Math.abs(ra)).padStart(2, '0');
      text(ctx, s, x, ra >= 0 ? y - 24 : y + 24, 18, col, 'center');
      if (th.vsSign !== 0) {
        line(ctx, x + 16, y - 10, x + 16, y + 10, col, LW.normal);
        const ay = th.vsSign > 0 ? y - 10 : y + 10;
        line(ctx, x + 11, ay + th.vsSign * 6, x + 16, ay, col, LW.normal);
        line(ctx, x + 21, ay + th.vsSign * 6, x + 16, ay, col, LW.normal);
      }
    }
  }

  private drawAircraft(ctx: Ctx2D): void {
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.thick;
    if (this.mode === NdMode.Pln) {
      if (!this.posValid) return;
      this.project(this.lat, this.lon);
      const a = this.trkTrue * DEG;
      ctx.save();
      ctx.translate(this.pt.x, this.pt.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(-11, 14);
      ctx.lineTo(11, 14);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return;
    }
    // Airplane symbol: white triangle, apex at the present position (Commons ND photo: ~45 x 57 px).
    ctx.beginPath();
    ctx.moveTo(this.cx, this.cy);
    ctx.lineTo(this.cx - 22, this.cy + 56);
    ctx.lineTo(this.cx + 22, this.cy + 56);
    ctx.closePath();
    ctx.stroke();
    if (this.mode !== NdMode.Map) line(ctx, this.cx, this.cy - 30, this.cx, this.cy + 56, CDS.white, LW.normal);
  }

  // ---------------------------------------------------------------- header / footer
  private drawHeader(ctx: Ctx2D): void {
    const v = this.env.vars;
    // GS / TAS.
    text(ctx, 'GS', 16, 36, 20, CDS.white, 'left');
    text(ctx, fmtInt(Math.round(this.gs)), 46, 34, 30, CDS.white, 'left');
    if (this.tas >= 100) {
      text(ctx, 'TAS', 118, 36, 20, CDS.white, 'left');
      text(ctx, fmtInt(Math.round(this.tas)), 160, 34, 30, CDS.white, 'left');
      // Wind from TAS/heading vs GS/track (true), shown magnetic.
      const ax = Math.sin(this.hdgTrue * DEG) * this.tas;
      const ay = Math.cos(this.hdgTrue * DEG) * this.tas;
      const gx = Math.sin(this.trkTrue * DEG) * this.gs;
      const gy = Math.cos(this.trkTrue * DEG) * this.gs;
      const wx = gx - ax;
      const wy = gy - ay;
      const ws = Math.hypot(wx, wy);
      if (ws >= 1 && this.posValid) {
        const fromTrue = wrap360(Math.atan2(-wx, -wy) / DEG);
        const fromMag = wrap360(fromTrue - this.magVar);
        text(ctx, fmtInt(Math.round(fromMag) || 360).padStart(3, '0') + '°/' + fmtInt(Math.round(ws)), 16, 70, 28, CDS.white, 'left');
        // Arrow: points the way the wind blows, relative to the display.
        const up = this.upTrue;
        const a = (fromTrue + 180 - up) * DEG;
        const ax0 = 60;
        const ay0 = 118;
        const L = 28;
        const x1 = ax0 + Math.sin(a) * L;
        const y1 = ay0 - Math.cos(a) * L;
        const x0 = ax0 - Math.sin(a) * L;
        const y0 = ay0 + Math.cos(a) * L;
        ctx.strokeStyle = CDS.white;
        ctx.lineWidth = LW.normal;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.moveTo(x1 - Math.sin(a - 0.5) * 12, y1 + Math.cos(a - 0.5) * 12);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x1 - Math.sin(a + 0.5) * 12, y1 + Math.cos(a + 0.5) * 12);
        ctx.stroke();
      }
    }
    // TRK / HDG box.
    const trkMode = this.mode === NdMode.Map || this.mode === NdMode.Pln;
    const val = trkMode ? this.trkMag : this.hdgMag;
    const s = fmtInt(Math.round(val) % 360 || 360).padStart(3, '0');
    ctx.fillStyle = CDS.black;
    ctx.fillRect(357, 16, 90, 50);
    ctx.strokeStyle = CDS.white;
    ctx.lineWidth = LW.normal;
    ctx.beginPath();
    ctx.moveTo(357, 16);
    ctx.lineTo(357, 66);
    ctx.lineTo(447, 66);
    ctx.lineTo(447, 16);
    ctx.stroke();
    text(ctx, s, 402, 43, 38, CDS.white, 'center');
    text(ctx, trkMode ? 'TRK' : 'HDG', 348, 42, 26, CDS.green, 'right');
    text(ctx, 'MAG', 456, 42, 26, CDS.green, 'left');

    if (trkMode) {
      // Active waypoint / ETA / distance.
      const id = v.getString(FMS.nextWptIdent);
      if (id && v.get(FMS.lnavValid) !== 0) {
        text(ctx, id, 784, 30, 28, CDS.magenta, 'right');
        const ete = v.get(FMS.eteToWptS);
        const utc = v.get('env.time_utc_h', v.get(GPS.utcH));
        if (Number.isFinite(ete) && ete > 0) text(ctx, this.fmtZulu(utc + ete / 3600), 784, 60, 26, CDS.white, 'right');
        const d = v.get(FMS.distToWptNm);
        text(ctx, (d < 100 ? d.toFixed(1) : fmtInt(Math.round(d))) + 'NM', 784, 90, 26, CDS.white, 'right');
      }
    } else {
      // Receiver / course / DME.
      const r = v.get(B737_VARS.navRxFor(this.side), this.side);
      const isLoc = v.get(NAV.isLoc(r)) !== 0;
      const lbl = (isLoc ? 'ILS' : 'VOR') + fmtInt(r);
      text(ctx, lbl, 784, 30, 26, CDS.green, 'right');
      const id = v.getString(NAV.ident(r));
      const f = v.get(NAV.activeFreq(r));
      text(ctx, id || (f > 0 ? f.toFixed(2) : '---'), 784, 58, 24, CDS.green, 'right');
      const crs = v.get(AP.selCourse(this.side), v.get(NAV.obs(r)));
      text(ctx, 'CRS ' + fmtInt(Math.round(wrap360(crs)) || 360).padStart(3, '0'), 784, 86, 24, CDS.white, 'right');
      const dme = v.get(NAV.dmeValid(r)) !== 0;
      text(ctx, 'DME ' + (dme ? v.get(NAV.dmeNm(r)).toFixed(1) : '---'), 784, 114, 24, CDS.white, 'right');
    }
  }

  private drawFooter(ctx: Ctx2D): void {
    const v = this.env.vars;
    const p = this.panel;
    // Map option annunciations (cyan, left edge; Commons ND photo).
    let y = 470;
    const opt = (s: string, col: string = CDS.cyan): void => {
      text(ctx, s, 22, y, 22, col, 'left');
      y += 28;
    };
    if (this.mode === NdMode.Map || this.mode === NdMode.Pln) {
      if (v.get(B737_VARS.efisMapButton(p, 'arpt')) !== 0) opt('ARPT');
      if (v.get(B737_VARS.efisMapButton(p, 'wpt')) !== 0) opt('WPT');
      if (v.get(B737_VARS.efisMapButton(p, 'sta')) !== 0) opt('STA');
      if (v.get(B737_VARS.efisMapButton(p, 'data')) !== 0) opt('DATA');
      if (v.get(B737_VARS.efisMapButton(p, 'pos')) !== 0) opt('POS');
    }
    if (v.get(B737_VARS.efisMapButton(p, 'wxr')) !== 0 && this.mode !== NdMode.Pln) {
      const wm = this.env.cfg.vars.wxrModeText;
      const mt = wm ? v.getString(wm) : '';
      if (mt.startsWith('WXR')) opt(mt, CDS.amber);
      else {
        opt('WXR');
        if (mt) opt(mt);
        const wt = this.env.cfg.vars.wxrTiltDeg;
        const tilt = wt ? Math.round(v.get(wt) * 10) / 10 : 0;
        opt(wt ? (tilt >= 0 ? '+' : '-') + Math.abs(tilt).toFixed(1) : '+0');
      }
    }
    if (v.get(B737_VARS.efisMapButton(p, 'terr')) !== 0 && this.mode !== NdMode.Pln) {
      const inop = v.get(this.env.cfg.vars.tawsInop) !== 0 || !this.env.world;
      opt(inop ? 'TERR FAIL' : 'TERR', inop ? CDS.amber : CDS.cyan);
      if (!inop && Number.isFinite(this.peakHi)) {
        // Peaks (hundreds of ft): high in the colour of its band, low green (EGPWS peaks mode).
        const hiCol = this.peakHi - this.alt > 2000 ? CDS.red : this.peakHi - this.alt > -500 ? CDS.amber : CDS.green;
        text(ctx, fmtInt(Math.max(0, Math.round(this.peakHi / 100))).padStart(3, '0'), 22, y, 22, hiCol, 'left');
        y += 26;
        text(ctx, fmtInt(Math.max(0, Math.round(this.peakLo / 100))).padStart(3, '0'), 22, y, 22, CDS.green, 'left');
        y += 28;
      }
    }
    const cv = this.env.cfg.vars;
    if (v.get(B737_VARS.efisTfc(p)) !== 0 && this.mode !== NdMode.Pln) {
      const status = v.getString(cv.tcasStatus);
      if (status === 'TCAS OFF' || status === 'TCAS FAIL') opt(status === 'TCAS OFF' ? 'TCAS OFF' : 'TCAS FAIL', CDS.amber);
      else if (status === 'TCAS TEST') opt('TCAS TEST');
      else if (status === 'TA ONLY') {
        opt('TFC');
        opt('TA ONLY');
      } else opt('TFC');
    }
    // TCAS / terrain alert messages (centre).
    if (v.get(cv.tcasRa) > 0) haloText(ctx, 'TRAFFIC', W / 2, 560, 28, CDS.red, 'center');
    else if (v.get(cv.tcasTa) > 0) haloText(ctx, 'TRAFFIC', W / 2, 560, 28, CDS.amber, 'center');
    if (v.get(cv.tawsWarning) !== 0 && blink(this.t, 1.5)) haloText(ctx, 'PULL UP', W / 2, 520, 30, CDS.red, 'center');
    else if (v.get(cv.tawsCaution) !== 0) haloText(ctx, 'TERRAIN', W / 2, 520, 28, CDS.amber, 'center');

    // VOR / ADF data blocks (bottom corners).
    for (const n of [1, 2] as const) {
      const sel = v.get(B737_VARS.efisVorAdf(p, n));
      if (sel === 0) continue;
      const x = n === 1 ? 20 : 780;
      const al: CanvasTextAlign = n === 1 ? 'left' : 'right';
      const col = sel > 0 ? CDS.green : CDS.cyan;
      text(ctx, (sel > 0 ? 'VOR ' : 'ADF ') + fmtInt(n), x, 718, 22, col, al);
      if (sel > 0) {
        const id = v.getString(NAV.ident(n));
        const f = v.get(NAV.activeFreq(n));
        text(ctx, id || (f > 0 ? f.toFixed(2) : '---'), x, 744, 22, col, al);
        const dme = v.get(NAV.dmeValid(n)) !== 0;
        text(ctx, 'DME' + (dme ? v.get(NAV.dmeNm(n)).toFixed(1) : '---'), x, 770, 22, col, al);
      } else {
        const id = v.getString(NAV.adfIdent(n));
        const f = v.get(NAV.adfActive(n));
        text(ctx, id || (f > 0 ? f.toFixed(1) : '---'), x, 744, 22, col, al);
      }
    }
    if (this.mode === NdMode.Map || this.mode === NdMode.Pln) {
      // FMC source and RNP / ANP (green, bottom).
      const fs = v.get(B737_VARS.fmcSel);
      const src = fs < 0 ? 'L' : fs > 0 ? 'R' : this.side === 1 ? 'L' : 'R';
      text(ctx, 'FMC ' + src, 250, 772, 22, CDS.green, 'center');
      const rnp = v.get(B737_VARS.fmcRnpNm, NaN);
      const anp = v.get(B737_VARS.fmcAnpNm, NaN);
      if (Number.isFinite(rnp) && rnp > 0) {
        text(ctx, 'RNP', 372, 752, 20, CDS.green, 'center');
        text(ctx, rnp.toFixed(2), 372, 774, 22, CDS.green, 'center');
        text(ctx, 'ANP', 452, 752, 20, CDS.green, 'center');
        text(ctx, Number.isFinite(anp) ? anp.toFixed(2) : '-.--', 452, 774, 22, CDS.green, 'center');
      }
      // Cross-track error below the airplane symbol (MAP, LNAV route active).
      if (this.mode === NdMode.Map && v.get(FMS.lnavValid) !== 0) {
        const xtk = v.get(FMS.xtkNm);
        const s = Math.abs(xtk).toFixed(1);
        text(ctx, Math.abs(xtk) >= 0.05 ? s + (xtk > 0 ? 'R' : 'L') : s, this.cx, this.cy + 76, 22, CDS.white, 'center');
      }
    }
    // Mode / range disagreement between the EFIS panel and the display: not applicable (single source per side).
    void EFIS_MAP_BUTTONS;
  }

  private fmtZulu(utcH: number): string {
    const h = ((utcH % 24) + 24) % 24;
    const hh = Math.floor(h);
    const mm = (h - hh) * 60;
    const m10 = Math.floor(mm * 10) / 10;
    const mi = Math.floor(m10);
    const tenth = Math.round((m10 - mi) * 10) % 10;
    return fmtInt(hh).padStart(2, '0') + fmtInt(mi).padStart(2, '0') + '.' + fmtInt(tenth) + 'z';
  }

  private flag(ctx: Ctx2D, s: string, x: number, y: number): void {
    ctx.font = cdsFont(26);
    const w = ctx.measureText(s).width + 14;
    ctx.strokeStyle = CDS.amber;
    ctx.lineWidth = LW.normal;
    ctx.strokeRect(x - w / 2, y - 18, w, 36);
    text(ctx, s, x, y + 1, 26, CDS.amber, 'center');
  }
}

type EfisKey = 'arpt' | 'sta' | 'wpt';
