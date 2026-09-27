/**
 * G1000 maps on top of the common `MovingMap` (PG 190-02177-02 §5.2 "Using
 * Map Displays", §6 "Traffic", "Terrain-SVT"): the MFD 'Map - Navigation
 * Map' page, the PFD inset map (lower left) and HSI map, the MFD traffic
 * map (2 / 6 nm rings) and the Terrain-SVT page (relative terrain, 360° or
 * arc view).
 *
 * Conventions: heading-up default (MFD: MENU > orientation), the selected
 * range is the distance to the range ring (half the distance to the top
 * edge), active leg magenta, map pointer with bearing / distance on the MFD
 * (joystick push). The orientation label is at the top of the map, the
 * range at the lower left of the inset map.
 */
import { ADC, AP, FMS, GPS } from '../../../core/vars';
import { clamp, wrap360 } from '../../../core/math';
import { destinationPoint, distanceNm, initialBearing } from '../../../core/geo';
import { fmtFixed, fmtInt } from '../../common/format';
import { MovingMap, MAP_GARMIN, type MapOrientation, type MapStyle } from '../../common/draw/MovingMap';
import { box, type Ctx2D, type Rect } from '../../common/draw/context';
import type { TrafficLevel } from '../../common/draw/mapSymbols';
import { fmtDeg, fmtDist, join2 } from '../../garmin-g3000/format';
import type { G1000System } from '../state/System';
import { G1K, MAP_TER } from '../vars';
import { G1K_PALETTE, TF, winBox } from './style';

const P = G1K_PALETTE;

/** MFD map style (symbol ranges EST from the Garmin map setup defaults, PG §5.2 "Map Symbol Range"). */
const MAP_G1K: MapStyle = {
  ...MAP_GARMIN,
  palette: P,
  typeface: TF,
  labelSize: 14,
  ringColor: 'rgba(255,255,255,0.7)',
  fixesBelowNm: 15,
  smallAirportsBelowNm: 30,
  runwaysBelowNm: 10,
  navaidsBelowNm: 300,
  feathersBelowNm: 40,
};
const MAP_G1K_INSET: MapStyle = { ...MAP_G1K, labelSize: 12, smallAirportsBelowNm: 10, fixesBelowNm: 10, navaidsBelowNm: 200 };

export type G1kMapKind = 'nav' | 'inset' | 'traffic' | 'terrain';

const ORIENT: readonly MapOrientation[] = ['north-up', 'track-up', 'heading-up'];
const ORIENT_LBL = ['NORTH UP', 'TRACK UP', 'HDG UP'];
const TER_MODE = ['off', 'topo', 'relative'] as const;
const ALT_MODES = ['NORMAL', 'ABOVE', 'BELOW', 'UNRESTRICTED'];
const ALT1 = ADC.baroAlt(1);
const VS1 = ADC.vs(1);
const HDGT1 = ADC.headingTrue(1);

export class G1kMap {
  readonly map: MovingMap;
  kind: G1kMapKind;
  private rect: Rect;
  private planVersion = -1;
  private readonly ll = { lat: 0, lon: 0 };

  constructor(
    private readonly sys: G1000System,
    kind: G1kMapKind,
    rect: Rect,
  ) {
    this.kind = kind;
    this.rect = rect;
    const inset = kind === 'inset';
    this.map = new MovingMap({ rect, style: inset ? MAP_G1K_INSET : MAP_G1K, nav: sys.nav, world: sys.world ?? undefined, terrainCells: inset ? 80 : 128 });
    this.setRect(rect);
  }

  /** Places the map; `own` fixes own-ship and the outer-range pixel distance (HSI map). */
  setRect(r: Rect, own?: { x: number; y: number; rangePx: number }): void {
    this.rect = r;
    const m = this.map;
    m.rect = r;
    m.ownX = own ? own.x : r.x + r.w / 2;
    const center = this.kind === 'traffic' || this.kind === 'terrain' ? 0.5 : this.kind === 'inset' ? 0.55 : 0.6;
    m.ownY = own ? own.y : r.y + r.h * center;
    m.rangePx = own ? own.rangePx : m.ownY - r.y - 4;
  }

  private rangeNm(): number {
    const v = this.sys.vars;
    return this.kind === 'inset' ? v.get(G1K.pfdMapRange, 5) : v.get(G1K.mfdMapRange, 10);
  }

  update(dt: number): void {
    const sys = this.sys;
    const v = sys.vars;
    const s = this.map.state;
    s.valid = v.get(GPS.valid) >= 0.5;
    s.lat = v.get(GPS.lat);
    s.lon = v.get(GPS.lon);
    s.altFt = v.get(ALT1);
    s.vsFpm = v.get(VS1);
    s.heading = v.get(HDGT1);
    s.track = v.get(GPS.trackTrue);
    s.gsKt = v.get(GPS.gs);
    s.dtk = v.get(FMS.desiredTrackTrue);
    const inset = this.kind === 'inset';
    const orient = inset ? 2 : v.get(G1K.mfdMapOrient) | 0;
    s.orientation = this.kind === 'traffic' || this.kind === 'terrain' ? 'heading-up' : ORIENT[orient] ?? 'heading-up';
    const range = this.kind === 'traffic' ? 6 : this.rangeNm();
    s.rangeNm = range * 2;
    s.declutter = (inset ? v.get(G1K.pfdMapDetail) : v.get(G1K.mfdMapDetail)) as 0 | 1 | 2 | 3;
    const ter = inset ? v.get(G1K.pfdMapTer) : v.get(G1K.mfdMapTer);
    s.terrain = this.kind === 'terrain' ? 'relative' : this.kind === 'traffic' ? 'off' : TER_MODE[ter | 0] ?? 'off';
    s.tawsLevel = (v.get('alert.taws_warning') >= 0.5 ? 2 : v.get('alert.taws_caution') >= 0.5 ? 1 : 0) as 0 | 1 | 2;
    s.gearDown = true;
    s.onGround = !this.airborne();
    s.terrainGreenBand = true;
    const nav = this.kind === 'nav' || this.kind === 'inset';
    s.showAirports = nav;
    s.showNavaids = nav;
    s.showFixes = nav;
    s.showRoute = this.kind !== 'traffic';
    s.showRangeRings = true;
    const trafficOn = inset ? v.get(G1K.pfdMapTraffic) >= 0.5 : v.get(G1K.mfdMapTraffic) >= 0.5;
    s.showTraffic = this.kind === 'traffic' || trafficOn;
    s.todDistNm = nav && v.get(FMS.vnavValid) >= 0.5 ? v.get(FMS.todDistNm, NaN) : NaN;
    s.selAltFt = nav ? v.get(AP.selAltitude) : NaN;
    // Map pointer (MFD navigation map only).
    const ptr = this.kind === 'nav' ? sys.pointer : null;
    if (ptr && ptr.active) {
      this.map.clearPan();
      this.map.pan(ptr.dx, ptr.dy);
    } else if (s.panActive) this.map.clearPan();
    const fms = sys.fms;
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

  private airborne(): boolean {
    const v = this.sys.vars;
    return v.get(GPS.gs) > 30 || v.get('adc1.tas_kt') > 50;
  }

  private updateTraffic(lat: number, lon: number, hdgTrue: number): void {
    const src = this.sys.trafficSource;
    const tr = this.map.state.traffic;
    const threats = src ? src.threats : null;
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

  draw(ctx: Ctx2D): void {
    const r = this.rect;
    const v = this.sys.vars;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    box(ctx, r.x, r.y, r.w, r.h, '#000000', '');
    this.map.draw(ctx);
    const inset = this.kind === 'inset';
    const orient = this.kind === 'traffic' || this.kind === 'terrain' || inset ? 2 : v.get(G1K.mfdMapOrient) | 0;
    if (!inset) TF.draw(ctx, ORIENT_LBL[orient] ?? 'HDG UP', r.x + r.w - 8, r.y + 14, 13, P.white, 'right', 'middle', '#000000');
    // Range label (lower left of the inset map, next to the range ring on the MFD).
    const range = this.kind === 'traffic' ? 6 : this.rangeNm();
    winBox(ctx, r.x + 4, r.y + r.h - 24, 64, 20, 'rgba(0,0,0,0.75)');
    TF.draw(ctx, fmtRange(range), r.x + 36, r.y + r.h - 14, 13, P.cyan, 'center', 'middle');
    if (this.kind === 'traffic') this.drawTrafficOverlay(ctx);
    if (this.kind === 'terrain') this.drawTerrainOverlay(ctx);
    const wx = inset ? v.get('g1k.pfd.nexrad') + v.get('g1k.pfd.metar') + v.get('g1k.pfd.lightning') : v.get('g1k.mfd.nexrad') + v.get('g1k.mfd.metar') + v.get('g1k.mfd.lightning') + v.get('g1k.mfd.stormscope');
    // SCOPE: no datalink weather receiver data in the sim: the enabled products show as unavailable.
    if (wx > 0) TF.draw(ctx, 'WX DATA N/A', r.x + r.w - 8, r.y + r.h - 14, 12, P.amber, 'right', 'middle', '#000000');
    if (!this.map.state.valid) TF.draw(ctx, 'MAP - NO GPS POSITION', r.x + r.w / 2, r.y + r.h / 2, 16, P.amber, 'center', 'middle', '#000000');
    const trafficOn = inset ? v.get(G1K.pfdMapTraffic) >= 0.5 : v.get(G1K.mfdMapTraffic) >= 0.5;
    if ((trafficOn || this.kind === 'traffic') && !this.sys.trafficSource) TF.draw(ctx, 'NO TRFC DATA', r.x + 8, r.y + 14, 12, P.amber, 'left', 'middle', '#000000');
    if (this.kind === 'nav' && this.sys.pointer.active) this.drawPointer(ctx);
    if (!inset && (v.get(G1K.mfdMapTer) | 0) === MAP_TER.rel && this.kind === 'nav') this.drawRelLegend(ctx);
    ctx.restore();
  }

  private drawTrafficOverlay(ctx: Ctx2D): void {
    const v = this.sys.vars;
    const r = this.rect;
    const op = v.get(G1K.trafficMode) >= 0.5 && v.get('xpdr.mode') >= 2;
    TF.draw(ctx, op ? 'OPERATING' : 'STANDBY', r.x + 10, r.y + r.h - 40, 15, op ? P.green : P.white, 'left', 'middle', '#000000');
    const alt = ALT_MODES[v.get('g1k.traffic.alt_mode') | 0] ?? 'NORMAL';
    TF.draw(ctx, alt, r.x + r.w - 10, r.y + r.h - 40, 13, P.white, 'right', 'middle', '#000000');
    TF.draw(ctx, 'ADS-B', r.x + 10, r.y + 34, 13, P.white, 'left', 'middle', '#000000');
  }

  private drawTerrainOverlay(ctx: Ctx2D): void {
    const r = this.rect;
    const inop = this.sys.vars.get('taws.inop') >= 0.5 || this.sys.vars.get(GPS.valid) < 0.5;
    const label = this.sys.cfg.terrain === 'TAWS-B' ? 'TAWS-B' : 'TERRAIN-SVT';
    TF.draw(ctx, inop ? 'TER N/A' : label, r.x + r.w - 10, r.y + r.h - 40, 15, inop ? P.amber : P.white, 'right', 'middle', '#000000');
    this.drawRelLegend(ctx);
  }

  /** Relative terrain legend (red within 100 ft below / above, yellow to 1000 ft below). */
  private drawRelLegend(ctx: Ctx2D): void {
    const r = this.rect;
    const x = r.x + r.w - 58;
    let y = r.y + 30;
    winBox(ctx, x - 2, y - 2, 54, 62, 'rgba(0,0,0,0.8)');
    box(ctx, x, y, 50, 20, '#ff0000', '');
    TF.draw(ctx, '-100', x + 25, y + 10, 12, P.white, 'center', 'middle', '#000000');
    y += 20;
    box(ctx, x, y, 50, 20, '#ffff00', '');
    TF.draw(ctx, '-1000', x + 25, y + 10, 12, P.black, 'center', 'middle');
    y += 20;
    box(ctx, x, y, 50, 18, '#000000', '');
    TF.draw(ctx, 'FT', x + 25, y + 9, 12, P.white, 'center', 'middle');
  }

  private drawPointer(ctx: Ctx2D): void {
    const r = this.rect;
    const m = this.map;
    const s = m.state;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
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
    const d = distanceNm(s.lat, s.lon, s.panLat, s.panLon);
    const b = wrap360(initialBearing(s.lat, s.lon, s.panLat, s.panLon) - this.sys.vars.get(GPS.magVar));
    winBox(ctx, r.x + 4, r.y + 4, 190, 24);
    TF.draw(ctx, join2(fmtDeg(b), ' '), r.x + 12, r.y + 16, 14, P.white, 'left', 'middle');
    TF.draw(ctx, join2(fmtDist(d), 'NM'), r.x + 186, r.y + 16, 14, P.white, 'right', 'middle');
  }
}

/** Range label: nm (fractions below 1 nm), feet for the shortest ranges. */
export function fmtRange(nm: number): string {
  if (nm < 0.2) return join2(fmtInt(Math.round((nm * 6076.12) / 50) * 50), 'FT');
  if (nm < 1) return join2(fmtFixed(nm, 2), 'NM');
  if (nm < 10 && Math.abs(nm - Math.round(nm)) > 0.01) return join2(fmtFixed(nm, 1), 'NM');
  return join2(fmtInt(nm), 'NM');
}
