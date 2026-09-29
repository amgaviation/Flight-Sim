/**
 * MAP multifunction window (Pro Line Fusion "MFW" map) with the flight plan,
 * terrain (TAWS overlay), traffic, airports / navaids / fixes and graphical
 * flight planning.
 *
 * Sources:
 *  - FSB BD-700-1A10 Rev 7 appendix 6: "TAWS overlaid on MFW, VSD and HUD";
 *    "TCAS presented on MFW and HUD"; "FMS graphical flight planning";
 *    "Optional Integrated Flight Information System (IFIS) ... Enhanced
 *    Maps"; the VSD is a separate window (vsd.ts).
 *  - AIN 2012: "positioning the cursor over a waypoint, then clicking and
 *    bringing up the menu of options for that waypoint".
 * Formats (EST): ARC (heading up, own ship low, 120 deg compass arc), ROSE
 * (heading up, centred, full compass) and PLAN (north up, centred). Range
 * list, colours and the waypoint menu items are EST.
 */
import type { SimVars } from '../../../core/SimVars';
import { ADC, AP, FMS, GPS } from '../../../core/vars';
import type { NavDatabase } from '../../../nav/types';
import type { WorldQuery } from '../../../world/types';
import type { Fms } from '../../../nav/fms/Fms';
import { MovingMap, MAP_HONEYWELL, type MapStyle } from '../../common/draw/MovingMap';
import { COLLINS_PALETTE } from '../../common/palette';
import { COLLINS_TYPEFACE } from '../../common/fonts';
import type { Ctx2D } from '../../common/draw/context';
import type { ShownWindow } from '../logic/layout';
import { FUSION_VARS } from '../vars';
import { C, DEG, fstr, hstr, istr, n360, pstr, rect, seg, txt, txtHalo } from './style';
import type { HotSpots, MenuItem, WindowRenderer } from './window';

export const MAP_FUSION: MapStyle = {
  ...MAP_HONEYWELL,
  palette: COLLINS_PALETTE,
  typeface: COLLINS_TYPEFACE,
  labelSize: 14,
  rangeRings: 'none',
  ranges: [2, 5, 10, 20, 40, 80, 160, 320, 640], // EST Collins range set
};

type MapFormat = 'ARC' | 'ROSE' | 'PLAN';

export interface MapWindowOptions {
  vars: SimVars;
  nav: NavDatabase | null;
  world: Pick<WorldQuery, 'elevationAt'> | null;
  fms: Fms | null;
}

export class MapWindow implements WindowRenderer {
  readonly animated = true;
  readonly map: MovingMap;
  format: MapFormat = 'ARC';
  private lastRect = { x: -1, y: -1, w: 0, h: 0 };
  private lastPlanVer = -1;
  private readonly pt = { x: 0, y: 0 };
  /** Graphical flight planning popup: leg index and anchor (AFD px), -1 = closed. */
  private popIdx = -1;
  private popX = 0;
  private popY = 0;
  private readonly wptIds: string[] = [];

  constructor(private readonly o: MapWindowOptions) {
    this.map = new MovingMap({ rect: { x: 0, y: 0, w: 512, h: 640 }, style: MAP_FUSION, nav: o.nav ?? undefined, world: o.world ?? undefined, terrainCells: 96 });
    this.map.setRange(40);
    for (let i = 0; i < 64; i++) this.wptIds.push(`wpt:${i}`);
  }

  private layout(w: ShownWindow): void {
    const r = w.rect;
    const l = this.lastRect;
    if (l.x === r.x && l.y === r.y && l.w === r.w && l.h === r.h && (this.map.ownY !== 0 || r.h === 0)) {
      this.applyFormat(r);
      return;
    }
    l.x = r.x;
    l.y = r.y;
    l.w = r.w;
    l.h = r.h;
    this.map.rect = { x: r.x, y: r.y + 24, w: r.w, h: r.h - 24 };
    this.applyFormat(r);
  }

  private applyFormat(r: { x: number; y: number; w: number; h: number }): void {
    const m = this.map;
    m.ownX = r.x + r.w / 2;
    if (this.format === 'ARC') {
      m.ownY = r.y + r.h * 0.8;
      m.rangePx = r.h * 0.8 - 60;
    } else {
      m.ownY = r.y + 24 + (r.h - 24) / 2;
      m.rangePx = Math.min(r.w, r.h - 24) / 2 - 30;
    }
    m.state.orientation = this.format === 'PLAN' ? 'north-up' : 'heading-up';
  }

  update(dt: number, w: ShownWindow): void {
    this.layout(w);
    const v = this.o.vars;
    const s = this.map.state;
    const side = w.owner;
    const ahrs = v.get(FUSION_VARS.ahrsSrc(side), side);
    const adc = v.get(FUSION_VARS.adcSrc(side), side);
    s.valid = v.getBool(GPS.valid);
    s.lat = v.get(GPS.lat);
    s.lon = v.get(GPS.lon);
    s.altFt = v.get(ADC.baroAlt(adc));
    s.vsFpm = v.get(ADC.vs(adc));
    s.heading = v.get(ADC.headingTrue(ahrs), v.get(ADC.heading(ahrs)) + v.get(GPS.magVar));
    s.track = v.get(GPS.trackTrue);
    s.gsKt = v.get(GPS.gs);
    s.dtk = v.get(FMS.desiredTrackTrue);
    s.gearDown = v.get('gear.down_locked') >= 0.5;
    s.tawsLevel = v.getBool('alert.taws_warning') ? 2 : v.getBool('alert.taws_caution') ? 1 : 0;
    s.todDistNm = v.get(FMS.todDistNm) > 0 ? v.get(FMS.todDistNm) : NaN;
    s.selAltFt = v.get(AP.selAltitude, NaN);
    const fms = this.o.fms;
    const ver = v.get(FMS.planVersion);
    // The route drawn is the active plan (its geometry is computed by the FMS); a pending
    // modification is overlaid dashed white in draw() (Collins / Boeing MOD convention, EST).
    if (fms && ver !== this.lastPlanVer) {
      this.lastPlanVer = ver;
      const plan = fms.plans.active;
      this.map.setRoute(plan.legs, plan.activeLegIndex);
    } else if (fms) this.map.setActiveLeg(fms.plans.active.activeLegIndex);
    this.map.update(dt);
  }

  draw(ctx: Ctx2D, w: ShownWindow, hs: HotSpots): void {
    const r = w.rect;
    const v = this.o.vars;
    rect(ctx, r.x, r.y, r.w, r.h, C.bg);
    this.map.draw(ctx);
    const m = this.map;
    const s = m.state;
    const magVar = v.get(GPS.magVar);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    // Compass (magnetic labels), heading bug, lubber line.
    if (this.format !== 'PLAN') this.drawCompass(ctx, s.heading - magVar, v.get(AP.selHeading, NaN));
    else this.drawNorthArrow(ctx, r);
    // Range label at the half-range ring position.
    const rr = m.rangePx;
    ctx.beginPath();
    if (this.format === 'ARC') ctx.arc(m.ownX, m.ownY, rr / 2, Math.PI * 1.17, Math.PI * 1.83);
    else ctx.arc(m.ownX, m.ownY, rr / 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    txtHalo(ctx, fstr(s.rangeNm / 2, s.rangeNm / 2 < 5 ? 1 : 0), m.ownX - rr / 2 * 0.72, m.ownY - rr / 2 * 0.72, 13, C.white, 'center');
    // Top data bar: GS / TAS, next waypoint, DTK / distance / ETE.
    rect(ctx, r.x, r.y, r.w, 24, C.panel);
    seg(ctx, r.x, r.y + 24, r.x + r.w, r.y + 24, C.line, 1);
    txt(ctx, pstr('GS ', v.get(GPS.gs)), r.x + 8, r.y + 12, 14, C.white, 'left');
    const next = v.getString(FMS.nextWptIdent);
    if (next) {
      txt(ctx, next, r.x + r.w * 0.42, r.y + 12, 15, C.magenta, 'left');
      txt(ctx, fstr(v.get(FMS.distToWptNm), 1), r.x + r.w - 70, r.y + 12, 14, C.white, 'right');
      txt(ctx, 'NM', r.x + r.w - 66, r.y + 12, 11, C.white, 'left');
      txt(ctx, hstr(v.get(FMS.dtkMag)), r.x + r.w * 0.42 - 10, r.y + 12, 14, C.magenta, 'right');
    }
    // Overlay annunciations (bottom-left).
    let ty = r.y + r.h - 12;
    if (s.terrain !== 'off') {
      txt(ctx, 'TERR', r.x + 8, ty, 13, C.green, 'left');
      ty -= 16;
    }
    if (s.showTraffic) txt(ctx, 'TFC', r.x + 8, ty, 13, C.cyan, 'left');
    txt(ctx, this.format, r.x + r.w - 8, r.y + r.h - 12, 13, C.grey, 'right');
    // Range hot spots and waypoint hot spots (graphical flight planning).
    hs.add('rng-', r.x + r.w - 64, r.y + 28, 28, 24);
    hs.add('rng+', r.x + r.w - 32, r.y + 28, 28, 24);
    rect(ctx, r.x + r.w - 64, r.y + 28, 28, 24, C.panel, C.line, 1);
    rect(ctx, r.x + r.w - 32, r.y + 28, 28, 24, C.panel, C.line, 1);
    txt(ctx, '−', r.x + r.w - 50, r.y + 40, 16, C.white, 'center');
    txt(ctx, '+', r.x + r.w - 18, r.y + 40, 16, C.white, 'center');
    const fms = this.o.fms;
    if (fms?.plans.pending) this.drawMod(ctx, r);
    if (fms) {
      const plan = fms.plans.displayed;
      const n = Math.min(plan.legs.length, this.wptIds.length);
      for (let i = 0; i < n; i++) {
        const l = plan.legs[i];
        if (!l.fix || l.type === 'DISCO') continue;
        const p = m.project(l.fix.lat, l.fix.lon, this.pt);
        if (p.x < r.x || p.x > r.x + r.w || p.y < r.y + 24 || p.y > r.y + r.h) continue;
        hs.add(this.wptIds[i], p.x - 12, p.y - 12, 24, 24);
      }
    }
    if (this.popIdx >= 0) this.drawPopup(ctx, r, hs);
    ctx.restore();
  }

  private drawCompass(ctx: Ctx2D, hdgMag: number, sel: number): void {
    const m = this.map;
    const cx = m.ownX;
    const cy = m.ownY;
    const R = m.rangePx;
    const span = this.format === 'ARC' ? 62 : 180;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (this.format === 'ARC') ctx.arc(cx, cy, R, -Math.PI / 2 - span * DEG, -Math.PI / 2 + span * DEG);
    else ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    const first = Math.ceil((hdgMag - span) / 5) * 5;
    for (let d = first; d <= hdgMag + span; d += 5) {
      const a = (d - hdgMag) * DEG - Math.PI / 2;
      const len = d % 10 === 0 ? 12 : 6;
      ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.lineTo(cx + Math.cos(a) * (R - len), cy + Math.sin(a) * (R - len));
    }
    ctx.stroke();
    for (let d = Math.ceil((hdgMag - span) / 30) * 30; d <= hdgMag + span; d += 30) {
      const a = (d - hdgMag) * DEG - Math.PI / 2;
      const lbl = n360(d) === 0 ? 'N' : n360(d) === 90 ? 'E' : n360(d) === 180 ? 'S' : n360(d) === 270 ? 'W' : istr(n360(d) / 10);
      txtHalo(ctx, lbl, cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24), 15, C.white, 'center');
    }
    // Lubber line and heading readout.
    seg(ctx, cx, cy - R - 2, cx, cy - R - 14, C.white, 3);
    rect(ctx, cx - 26, cy - R - 38, 52, 22, C.bg, C.white, 1.5);
    txt(ctx, hstr(hdgMag), cx, cy - R - 26, 17, C.white, 'center');
    // Heading bug (cyan), parked at the arc end when off scale.
    if (Number.isFinite(sel)) {
      let d = sel - hdgMag;
      d = ((d + 540) % 360) - 180;
      const dd = Math.max(-span, Math.min(span, d));
      const a = dd * DEG - Math.PI / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(-9, -8);
      ctx.lineTo(-4, -8);
      ctx.lineTo(0, -3);
      ctx.lineTo(4, -8);
      ctx.lineTo(9, -8);
      ctx.lineTo(9, 0);
      ctx.closePath();
      ctx.fillStyle = C.cyan;
      ctx.fill();
      ctx.restore();
    }
  }

  /** Pending MOD route: dashed white polyline through the fixes from the active leg on. */
  private drawMod(ctx: Ctx2D, r: { x: number; y: number; w: number; h: number }): void {
    const plan = this.o.fms?.plans.displayed;
    if (!plan) return;
    const m = this.map;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y + 24, r.w, r.h - 24);
    ctx.clip();
    ctx.setLineDash(MOD_DASH);
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    if (m.state.valid) {
      ctx.moveTo(m.ownX, m.ownY);
      started = true;
    }
    for (let i = Math.max(0, plan.activeLegIndex); i < plan.legs.length; i++) {
      const l = plan.legs[i];
      if (!l.fix || l.type === 'DISCO' || l.segment === 'missed') continue;
      const p = m.project(l.fix.lat, l.fix.lon, this.pt);
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.restore();
  }

  private drawNorthArrow(ctx: Ctx2D, r: { x: number; y: number; w: number; h: number }): void {
    const x = r.x + 26;
    const y = r.y + 50;
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x - 7, y + 6);
    ctx.lineTo(x + 7, y + 6);
    ctx.closePath();
    ctx.fillStyle = C.white;
    ctx.fill();
    txt(ctx, 'N', x, y + 16, 12, C.white, 'center');
  }

  // ------------------------------------------------------------ graphical flight planning

  private static readonly POP_ITEMS: readonly [string, string][] = [
    ['wptm:dir', 'DIRECT-TO'],
    ['wptm:hold', 'HOLD AT'],
    ['wptm:del', 'DELETE'],
    ['wptm:close', 'CLOSE'],
  ];

  private drawPopup(ctx: Ctx2D, r: { x: number; y: number; w: number; h: number }, hs: HotSpots): void {
    const fms = this.o.fms;
    const leg = fms?.plans.displayed.legs[this.popIdx];
    if (!leg?.fix) {
      this.popIdx = -1;
      return;
    }
    const w = 150;
    const ih = 26;
    const items = MapWindow.POP_ITEMS;
    const x = Math.min(r.x + r.w - w - 4, Math.max(r.x + 4, this.popX + 14));
    const y = Math.min(r.y + r.h - (items.length + 1) * ih - 4, Math.max(r.y + 28, this.popY - 10));
    rect(ctx, x, y, w, (items.length + 1) * ih, C.menuBg, C.white, 1.5);
    txt(ctx, leg.fix.ident, x + w / 2, y + ih / 2, 16, C.magenta, 'center');
    for (let i = 0; i < items.length; i++) {
      const iy = y + (i + 1) * ih;
      seg(ctx, x, iy, x + w, iy, C.line, 1);
      txt(ctx, items[i][1], x + 10, iy + ih / 2, 15, C.white, 'left');
      hs.add(items[i][0], x, iy, w, ih);
    }
  }

  enter(_side: 1 | 2, _w: ShownWindow, id: string): void {
    const m = this.map;
    if (id === 'rng+') {
      m.rangeUp();
      return;
    }
    if (id === 'rng-') {
      m.rangeDown();
      return;
    }
    const fms = this.o.fms;
    if (id.startsWith('wpt:')) {
      const idx = Number(id.slice(4));
      const leg = fms?.plans.displayed.legs[idx];
      if (!leg?.fix) return;
      const p = m.project(leg.fix.lat, leg.fix.lon, this.pt);
      this.popIdx = idx;
      this.popX = p.x;
      this.popY = p.y;
      return;
    }
    if (id.startsWith('wptm:') && fms) {
      const idx = this.popIdx;
      this.popIdx = -1;
      if (id === 'wptm:dir') fms.directTo(idx);
      else if (id === 'wptm:del') {
        const p = fms.plans.edit();
        if (idx !== p.activeLegIndex) p.deleteLeg(idx);
        fms.plans.commit();
      } else if (id === 'wptm:hold') {
        const p = fms.plans.edit();
        p.insertHold(idx, { turnDirection: 'R' });
        fms.plans.commit();
      }
    }
  }

  data(_side: 1 | 2, _w: ShownWindow, _id: string, steps: number): void {
    if (steps > 0) this.map.rangeUp();
    else this.map.rangeDown();
  }

  menuItems(): MenuItem[] {
    const s = this.map.state;
    return [
      { id: 'fmt:ARC', label: 'ARC', on: this.format === 'ARC' },
      { id: 'fmt:ROSE', label: 'ROSE', on: this.format === 'ROSE' },
      { id: 'fmt:PLAN', label: 'PLAN', on: this.format === 'PLAN' },
      { id: 'ovl:terr', label: 'TERRAIN', on: s.terrain !== 'off' },
      { id: 'ovl:tfc', label: 'TRAFFIC', on: s.showTraffic },
      { id: 'ovl:apt', label: 'AIRPORTS', on: s.showAirports },
      { id: 'ovl:vor', label: 'VOR / NDB', on: s.showNavaids },
      { id: 'ovl:fix', label: 'INTERSECTIONS', on: s.showFixes },
    ];
  }

  menuSelect(_side: 1 | 2, _w: ShownWindow, id: string): void {
    const s = this.map.state;
    if (id.startsWith('fmt:')) this.format = id.slice(4) as MapFormat;
    else if (id === 'ovl:terr') s.terrain = s.terrain === 'off' ? 'egpws' : 'off';
    else if (id === 'ovl:tfc') s.showTraffic = !s.showTraffic;
    else if (id === 'ovl:apt') s.showAirports = !s.showAirports;
    else if (id === 'ovl:vor') s.showNavaids = !s.showNavaids;
    else if (id === 'ovl:fix') s.showFixes = !s.showFixes;
    this.lastRect.w = -1;
  }
}

const MOD_DASH = [12, 8];
const NO_DASH: number[] = [];
