/**
 * Garmin navigation / traffic / TAWS map for MFD panes, PFD split panes and
 * the PFD inset map, built on the common `MovingMap`.
 *
 * G3000 conventions (PG 190-02046-01 §5.2 "Using Map Displays"): heading-up
 * default, orientation label top-left ("HDG UP" / "TRK UP" / "NORTH UP"), the
 * selected range is the distance to the range ring around the aircraft
 * (about half the distance to the top edge), active leg magenta, map pointer
 * with bearing / distance / lat-lon / elevation window at the upper left
 * (§5.2 "Map Panning"). The traffic map (§6.9) shows own-ship with 2 / 6 nm
 * rings and relative altitudes; the TAWS pane shows relative terrain.
 */
import { ADC, AP, FMS, GPS } from '../../../../core/vars';
import { DEG2RAD, clamp, wrap360 } from '../../../../core/math';
import { destinationPoint, distanceNm, initialBearing } from '../../../../core/geo';
import { fmtFixed, fmtInt } from '../../../common/format';
import { MovingMap, MAP_GARMIN, type MapStyle } from '../../../common/draw/MovingMap';
import { box, circle, line, type Ctx2D, type Rect } from '../../../common/draw/context';
import type { TrafficLevel } from '../../../common/draw/mapSymbols';
import { drawTrafficSymbol } from '../../../common/draw/mapSymbols';
import type { G3000System, MapKey } from '../../state/System';
import { G3K, NAV_SOURCE, vn, type PaneId } from '../../vars';
import { fmtDeg, fmtDist, fmtLat, fmtLon, join2 } from '../../format';
import { G3K_PALETTE, TF, dataBox } from '../style';

const P = G3K_PALETTE;

/** EST: legend background grey, sampled from the CRG legend graphic. */
const LEGEND_DARK = '#272b2b';
/** Relative terrain legends (rows of 19 px): CRG 190-02047-01 Rev A p.100. */
const TERRAIN_LEGEND_AIR: readonly { h: number; color: string; labels: readonly string[] }[] = [
  { h: 2, color: '#ff0000', labels: ['FT', '-100'] },
  { h: 1, color: '#ffff00', labels: ['-1000'] },
  { h: 1, color: 'rgb(87,162,68)', labels: ['-2000'] },
];
const TERRAIN_LEGEND_GROUND: readonly { h: number; color: string; labels: readonly string[] }[] = [
  { h: 2, color: '#ff0000', labels: ['FT', '400'] },
  { h: 3, color: LEGEND_DARK, labels: ['-100', '-1000', '-2000'] },
];

/**
 * G3000 map style. Symbol range limits are in MovingMap range units (twice the
 * Garmin selected range): intersections up to 7.5 nm, small airports up to
 * 15 nm, runways up to 5 nm, VOR / NDB up to 150 nm selected range (EST from
 * the Garmin map setup defaults, PG §5.2 "Map Symbol Range").
 */
const MAP_G3K: MapStyle = {
  ...MAP_GARMIN,
  palette: P,
  typeface: TF,
  labelSize: 16,
  ringColor: 'rgba(255,255,255,0.7)',
  fixesBelowNm: 15,
  smallAirportsBelowNm: 30,
  runwaysBelowNm: 10,
  navaidsBelowNm: 300,
  feathersBelowNm: 40,
};

/** PFD inset map: smaller, so small airports and intersections appear only at the short ranges (EST). */
const MAP_G3K_INSET: MapStyle = { ...MAP_G3K, labelSize: 14, smallAirportsBelowNm: 10, fixesBelowNm: 10, navaidsBelowNm: 200 };

export type MapMode = 'nav' | 'traffic' | 'taws' | 'weather';

export class MapPane {
  readonly map: MovingMap;
  mode: MapMode = 'nav';
  visible = true;
  private rect: Rect;
  private planVersion = -1;
  private readonly tmp = { x: 0, y: 0 };
  private readonly ll = { lat: 0, lon: 0 };
  private blink = 0;
  /** Inset pan offset already applied to the map (px). */
  private panDx = 0;
  private panDy = 0;

  /**
   * `key` selects the map settings (pane id or 'inset1'/'inset2'); `pane` is
   * the pane id for range / pointer (null for the PFD inset).
   */
  constructor(
    private readonly sys: G3000System,
    private readonly key: MapKey,
    private readonly pane: PaneId | null,
    rect: Rect,
    private readonly inset = false,
  ) {
    this.rect = rect;
    this.map = new MovingMap({ rect, style: inset ? MAP_G3K_INSET : MAP_G3K, nav: sys.nav, world: sys.world ?? undefined, terrainCells: inset ? 96 : 128 });
    this.setRect(rect);
  }

  /**
   * Places the map. `own` optionally fixes the own-ship position and the
   * pixel distance of the outer range (HSI map: aircraft at the HSI centre).
   */
  setRect(r: Rect, own?: { x: number; y: number; rangePx: number }): void {
    this.rect = r;
    const m = this.map;
    m.rect = r;
    m.ownX = own ? own.x : r.x + r.w / 2;
    // Heading-up maps put own-ship below centre (EST from the PG figures: ~62 % down); north-up centred.
    m.ownY = own ? own.y : r.y + r.h * (this.inset ? 0.55 : 0.6);
    m.rangePx = own ? own.rangePx : m.ownY - r.y - 4;
  }

  private rangeNm(): number {
    const v = this.sys.vars;
    if (this.pane) return this.sys.paneRange(this.pane);
    return v.get(G3K.pfdMapRange(this.key === 'inset1' ? 1 : 2), 15);
  }

  update(dt: number): void {
    this.blink += dt;
    const v = this.sys.vars;
    const set = this.sys.maps[this.key];
    const s = this.map.state;
    const side = this.key === 'inset2' || this.key === 'pfd2' || this.key === 'mfd2' ? 2 : 1;
    const ahrs = v.get(vn(G3K.ahrsSel, side), side);
    const adc = v.get(vn(G3K.adcSel, side), side);
    s.valid = v.get(GPS.valid) >= 0.5;
    s.lat = v.get(GPS.lat);
    s.lon = v.get(GPS.lon);
    s.altFt = v.get(vn(ADC.baroAlt, adc));
    s.vsFpm = v.get(vn(ADC.vs, adc));
    s.heading = v.get(vn(ADC.headingTrue, ahrs));
    s.track = v.get(GPS.trackTrue);
    s.gsKt = v.get(GPS.gs);
    s.dtk = v.get(FMS.desiredTrackTrue);
    s.orientation = this.mode === 'traffic' ? 'heading-up' : set.orientation;
    const range = this.rangeNm();
    // MovingMap range = distance to its outer ring (top edge); the Garmin range ring is its inner ring.
    s.rangeNm = range * 2;
    s.declutter = set.detail;
    const tawsWarn = v.get('alert.taws_warning') >= 0.5 ? 2 : v.get('alert.taws_caution') >= 0.5 ? 1 : 0;
    s.terrain = this.mode === 'taws' ? 'relative' : this.mode === 'traffic' ? 'off' : set.terrain;
    s.tawsLevel = tawsWarn as 0 | 1 | 2;
    s.gearDown = v.get(this.sys.cfg.gearDownVar) >= 0.5;
    // Relative terrain legends (CRG 190-02047-01 Rev A p.99-100; G5000 CRG 190-02538-02 Rev A p.142): on the
    // ground only terrain more than 400 ft above the aircraft is red; in the air red / yellow / green bands.
    s.onGround = v.get('gear.air_ground', 1) >= 0.5;
    s.terrainGreenBand = true;
    const nav = this.mode === 'nav' || this.mode === 'weather';
    s.showAirports = nav && set.airports;
    s.showNavaids = nav && set.navaids;
    s.showFixes = nav && set.fixes;
    s.showRoute = this.mode !== 'traffic';
    s.showRangeRings = set.rangeRings;
    s.showTraffic = set.traffic || this.mode === 'traffic';
    s.todDistNm = nav && v.get(FMS.vnavValid) >= 0.5 ? v.get(FMS.todDistNm, NaN) : NaN;
    s.selAltFt = nav ? v.get(AP.selAltitude) : NaN;
    // Map pointer (panning).
    const ptr = this.pane ? this.sys.pointers[this.pane] : this.insetPointer();
    if (ptr && ptr.active) {
      if (!s.panActive) this.map.pan(0, 0);
      // PFD inset pointer (GCU 275 joystick): apply the accumulated pan offset.
      if (!this.pane && (ptr.dx !== this.panDx || ptr.dy !== this.panDy)) {
        this.map.pan(ptr.dx - this.panDx, ptr.dy - this.panDy);
        this.panDx = ptr.dx;
        this.panDy = ptr.dy;
      }
    } else if (s.panActive) {
      this.map.clearPan();
      this.panDx = this.panDy = 0;
    }
    // Route from the active flight plan.
    const fms = this.sys.fms;
    if (fms) {
      const plan = fms.plans.active;
      if (plan.version !== this.planVersion) {
        this.planVersion = plan.version;
        this.map.setRoute(plan.legs, plan.activeLegIndex);
      } else this.map.setActiveLeg(plan.activeLegIndex);
    }
    this.updateTraffic(s.lat, s.lon, s.heading);
    this.map.update(dt);
  }

  private updateTraffic(lat: number, lon: number, hdgTrue: number): void {
    const src = this.sys.cfg as unknown as { trafficSource?: unknown };
    void src;
    const threats = this.sys.trafficThreats();
    const tr = this.map.state.traffic;
    for (let i = 0; i < tr.length; i++) {
      const t = tr[i];
      const th = threats ? threats[i] : undefined;
      if (!th) {
        t.active = false;
        continue;
      }
      const p = destinationPoint(lat, lon, wrap360(hdgTrue + th.relBrgDeg), th.rangeNm, this.ll);
      t.active = true;
      t.lat = p.lat;
      t.lon = p.lon;
      t.relAltFt = th.relAltFt;
      t.vsFpm = th.vsSign * 1000;
      t.level = clamp(th.level, 0, 3) as TrafficLevel;
    }
  }

  /** PFD inset pointer (GCU 275), null for panes and for the insets of aircraft without a GCU (never activated). */
  private insetPointer(): { active: boolean; dx: number; dy: number } | null {
    if (!this.inset || this.pane) return null;
    return this.sys.insetPointers[this.key === 'inset2' ? 2 : 1];
  }

  /** Moves the map pointer (joystick / touch). */
  movePointer(dx: number, dy: number): void {
    if (!this.pane) return;
    this.map.pan(dx, dy);
  }

  draw(ctx: Ctx2D): void {
    const r = this.rect;
    const m = this.map;
    if (this.mode === 'weather') this.drawRadarBackdrop(ctx);
    else m.draw(ctx);
    const v = this.sys.vars;
    const set = this.sys.maps[this.key];
    // Orientation and range labels (top-left).
    const orient = this.mode === 'traffic' ? 'HDG UP' : set.orientation === 'north-up' ? 'NORTH UP' : set.orientation === 'track-up' ? 'TRK UP' : 'HDG UP';
    dataBox(ctx, r.x + 4, r.y + 4, this.inset ? 64 : 84, this.inset ? 38 : 24, 'rgba(0,0,0,0.75)');
    if (this.inset) {
      TF.draw(ctx, 'AUTO', r.x + 36, r.y + 14, 11, P.cyan, 'center', 'middle');
      TF.draw(ctx, fmtRange(this.rangeNm()), r.x + 36, r.y + 31, 15, P.cyan, 'center', 'middle');
    } else TF.draw(ctx, orient, r.x + 46, r.y + 16, 14, P.white, 'center', 'middle');
    if (this.inset) {
      dataBox(ctx, r.x + 4, r.y + 44, 64, 20, 'rgba(0,0,0,0.75)');
      TF.draw(ctx, orient, r.x + 36, r.y + 54, 12, P.white, 'center', 'middle');
    }
    if (this.mode === 'traffic') this.drawTrafficOverlay(ctx);
    if (this.mode === 'taws') {
      const inop = v.get('taws.inop') >= 0.5;
      TF.draw(ctx, inop ? 'TAWS FAIL' : this.sys.cfg.taws === 'A' ? 'TAWS-A' : 'TAWS-B', r.x + r.w - 10, r.y + r.h - 16, 16, inop ? P.amber : P.white, 'right', 'middle', '#000000');
    }
    if (!this.inset && m.terrain?.mode === 'relative' && m.state.valid) this.drawTerrainLegend(ctx, m.state.onGround);
    const traffic = this.sys.trafficThreats();
    if ((set.traffic || this.mode === 'traffic') && !traffic) TF.draw(ctx, 'TRFC UNAVAIL', r.x + 8, r.y + r.h - 16, 13, P.amber, 'left', 'middle', '#000000');
    const ptr = this.pane ? this.sys.pointers[this.pane] : this.insetPointer();
    if (ptr && ptr.active) this.drawPointer(ctx);
  }

  /**
   * Relative terrain legend at the right edge of the pane: the "Terrain SVT / TAWS Relative Terrain
   * Legends" of CRG 190-02047-01 Rev A p.99-100 (in-air: red with FT / -100, yellow -1000, green -2000;
   * on-ground: red with FT / 400, dark -100 / -1000 / -2000). Size and position EST.
   */
  private drawTerrainLegend(ctx: Ctx2D, onGround: boolean): void {
    const r = this.rect;
    const w = 50;
    const rowH = 19;
    const x = r.x + r.w - w - 8;
    let y = r.y + 60;
    const bands = onGround ? TERRAIN_LEGEND_GROUND : TERRAIN_LEGEND_AIR;
    dataBox(ctx, x - 2, y - 2, w + 4, rowH * (onGround ? 5 : 4) + 4, 'rgba(0,0,0,0.8)');
    for (let k = 0; k < bands.length; k++) {
      const b = bands[k];
      box(ctx, x, y, w, rowH * b.h, b.color, '');
      for (let i = 0; i < b.labels.length; i++) {
        const t = b.labels[i];
        TF.draw(ctx, t, x + w / 2, y + rowH * (i + 0.5), t === 'FT' ? 13 : 15, P.white, 'center', 'middle', '#000000');
      }
      y += rowH * b.h;
    }
  }

  private drawRadarBackdrop(ctx: Ctx2D): void {
    const r = this.rect;
    const rad = this.sys.radar;
    box(ctx, r.x, r.y, r.w, r.h, '#000000', '');
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h - 30;
    const R = Math.min(r.w / 2 - 10, r.h - 60);
    ctx.beginPath();
    for (let k = 1; k <= 4; k++) {
      ctx.moveTo(cx + (R * k) / 4 * Math.sin(-1.05), cy - (R * k) / 4 * Math.cos(-1.05));
      ctx.arc(cx, cy, (R * k) / 4, -Math.PI / 2 - 1.05, -Math.PI / 2 + 1.05);
    }
    for (const a of [-60, -30, 0, 30, 60]) {
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.sin(a * DEG2RAD), cy - R * Math.cos(a * DEG2RAD));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    TF.draw(ctx, fmtRange(this.rangeNm() * 2), cx + R * 0.02 + 20, cy - R + 12, 14, P.white, 'left', 'middle');
    const txt = !rad.on ? 'RADAR OFF' : rad.mode === 'STBY' ? 'STANDBY' : rad.mode === 'WX' ? 'WEATHER' : 'GROUND MAP';
    TF.draw(ctx, txt, cx, r.y + 40, 20, rad.on && rad.mode !== 'STBY' ? P.green : P.white, 'center', 'middle');
    TF.draw(ctx, join2(join2('TILT ', fmtFixed(rad.tiltDeg, 2)), '°'), r.x + 12, r.y + r.h - 16, 14, P.cyan, 'left', 'middle');
    TF.draw(ctx, join2('GAIN ', fmtFixed(rad.gain, 1)), r.x + r.w - 12, r.y + r.h - 16, 14, P.cyan, 'right', 'middle');
  }

  private drawTrafficOverlay(ctx: Ctx2D): void {
    const v = this.sys.vars;
    const r = this.rect;
    const mode = v.get('xpdr.mode');
    const status = this.sys.cfg.traffic === 'TCAS2' ? (mode === 5 ? 'TA/RA' : mode === 4 ? 'TA ONLY' : 'STANDBY') : mode >= 2 ? 'OPERATING' : 'STANDBY';
    TF.draw(ctx, status, r.x + r.w - 10, r.y + 16, 15, status === 'STANDBY' ? P.white : P.green, 'right', 'middle', '#000000');
    TF.draw(ctx, 'NORMAL', r.x + r.w - 10, r.y + 36, 13, P.white, 'right', 'middle', '#000000');
  }

  private drawPointer(ctx: Ctx2D): void {
    const r = this.rect;
    const m = this.map;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    // Arrow pointer at the pan centre.
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + 5, cy + 16);
    ctx.lineTo(cx + 8, cy + 11);
    ctx.lineTo(cx + 14, cy + 17);
    ctx.lineTo(cx + 17, cy + 14);
    ctx.lineTo(cx + 11, cy + 8);
    ctx.lineTo(cx + 16, cy + 5);
    ctx.closePath();
    ctx.fillStyle = P.white;
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.stroke();
    const s = m.state;
    const lat = s.panLat;
    const lon = s.panLon;
    const d = distanceNm(s.lat, s.lon, lat, lon);
    const b = wrap360(initialBearing(s.lat, s.lon, lat, lon) - this.sys.vars.get(GPS.magVar));
    dataBox(ctx, r.x + 96, r.y + 4, 250, 46, 'rgba(0,0,0,0.8)');
    TF.draw(ctx, 'DIS', r.x + 104, r.y + 16, 13, P.white, 'left', 'middle');
    TF.draw(ctx, join2(fmtDist(d), 'NM'), r.x + 132, r.y + 16, 15, P.cyan, 'left', 'middle');
    TF.draw(ctx, 'BRG', r.x + 200, r.y + 16, 13, P.white, 'left', 'middle');
    TF.draw(ctx, fmtDeg(b), r.x + 232, r.y + 16, 15, P.cyan, 'left', 'middle');
    TF.draw(ctx, fmtLat(lat), r.x + 104, r.y + 36, 14, P.white, 'left', 'middle');
    TF.draw(ctx, fmtLon(lon), r.x + 222, r.y + 36, 14, P.white, 'left', 'middle');
  }
}

/** Range label: nm with fractions below 1 nm, feet for the shortest ranges. */
export function fmtRange(nm: number): string {
  if (nm < 0.2) return join2(fmtInt(Math.round((nm * 6076.12) / 50) * 50), 'FT');
  if (nm < 1) return join2(fmtFixed(nm, 2), 'NM');
  if (nm < 10 && Math.abs(nm - Math.round(nm)) > 0.01) return join2(fmtFixed(nm, 1), 'NM');
  return join2(fmtInt(nm), 'NM');
}

void NAV_SOURCE;
void circle;
void line;
void drawTrafficSymbol;
