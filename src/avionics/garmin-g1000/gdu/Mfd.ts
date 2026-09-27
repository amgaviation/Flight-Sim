/**
 * MFD format (PG 190-02177-02 §1.4 "MFD Page Groups", Figure 1-12): EIS
 * strip on the left, top bar (NAV box, navigation data bar, COM box) with
 * the page title, the page in the remaining area, the page group window in
 * the lower right corner while the FMS knob changes pages, pop-up menus,
 * and the Direct-to / Procedures / procedure loading / checklist overlays.
 */
import { GPS } from '../../../core/vars';
import { box, line, type Ctx2D, type Rect } from '../../common/draw/context';
import { blinkOn } from '../../common/dynamics';
import { fmtFixed, fmtInt } from '../../common/format';
import { fmtClockHms, fmtCom, fmtDeg, fmtDist, fmtHms, fmtLat, fmtLon, fmtNav, join2 } from '../../garmin-g3000/format';
import type { G1000System } from '../state/System';
import {
  AirportInfoPage,
  ChecklistPage,
  GpsStatusPage,
  NavaidInfoPage,
  NearestAirportsPage,
  NearestNavaidPage,
  SystemSetupPage,
  SystemStatusPage,
  TripPlanningPage,
  UtilityPage,
  brgDist,
  type Page,
} from '../state/pages';
import { G1K } from '../vars';
import { EisRenderer } from './Eis';
import { G1kMap } from './MapView';
import { TopBar } from './TopBar';
import { drawField, drawPage, drawPopup, fieldValue } from './windows';
import { EIS_W, G1K_COLORS, G1K_PALETTE, GDU_W, SOFTKEY_Y, TF, TOPBAR_H, winBox } from './style';

const P = G1K_PALETTE;
const BODY: Rect = { x: EIS_W + 1, y: TOPBAR_H + 1, w: GDU_W - EIS_W - 1, h: SOFTKEY_Y - TOPBAR_H - 1 };

export class MfdRenderer {
  readonly eis: EisRenderer;
  readonly top: TopBar;
  private readonly navMap: G1kMap;
  private readonly trafficMap: G1kMap;
  private readonly terrainMap: G1kMap;
  private time = 0;

  constructor(private readonly sys: G1000System) {
    this.eis = new EisRenderer(sys);
    this.top = new TopBar(sys);
    this.navMap = new G1kMap(sys, 'nav', BODY);
    this.trafficMap = new G1kMap(sys, 'traffic', BODY);
    this.terrainMap = new G1kMap(sys, 'terrain', BODY);
  }

  update(dt: number): void {
    this.time += dt;
    this.top.update(dt);
    this.eis.update(dt);
    const id = this.sys.mfd.basePage.id;
    if (id === 'map_nav' || id === 'wpt_apt' || id.startsWith('nrst') || id === 'fpl') this.navMap.update(dt);
    else if (id === 'map_traffic') this.trafficMap.update(dt);
    else if (id === 'map_terrain') this.terrainMap.update(dt);
  }

  draw(ctx: Ctx2D): void {
    const sys = this.sys;
    const mfd = sys.mfd;
    const page = mfd.page;
    const base = mfd.basePage;
    // Page body first (maps fill it), then the fixed frame.
    this.drawBase(ctx, base);
    if (page !== base) {
      // Overlays (Direct-to, Procedures, loading pages, checklist): framed window on the right half of the body.
      const r: Rect = page instanceof ChecklistPage ? { x: BODY.x + 4, y: BODY.y + 24, w: BODY.w - 8, h: BODY.h - 28 } : { x: GDU_W - 330, y: BODY.y + 30, w: 326, h: 300 };
      if (page instanceof ChecklistPage) this.drawChecklist(ctx, page, r);
      else drawPage(ctx, sys, page, r, this.time, true);
    }
    this.top.drawBackground(ctx);
    this.top.drawNav(ctx);
    this.top.drawCom(ctx);
    this.top.drawMfdDataBar(ctx, sys.mfd.setup.dataBar, page.title());
    this.eis.draw(ctx, 0, TOPBAR_H + 1, SOFTKEY_Y);
    if (mfd.groupWindowS > 0) this.drawGroupWindow(ctx);
    drawPopup(ctx, sys.popups.mfd, { x: GDU_W - 330, y: 200, w: 300, h: 360 });
  }

  private drawBase(ctx: Ctx2D, page: Page): void {
    const r = BODY;
    const id = page.id;
    if (id === 'map_nav') {
      this.navMap.draw(ctx);
      return;
    }
    if (id === 'map_traffic') {
      this.trafficMap.draw(ctx);
      return;
    }
    if (id === 'map_terrain') {
      this.terrainMap.draw(ctx);
      return;
    }
    box(ctx, r.x, r.y, r.w, r.h, '#000000', '');
    // Pages with a map on the left and data on the right (WPT / NRST / FPL): EST split 55 % / 45 %.
    const split = page instanceof AirportInfoPage || page instanceof NearestAirportsPage || page instanceof NearestNavaidPage || id === 'fpl';
    const data: Rect = split ? { x: r.x + r.w * 0.52, y: r.y + 24, w: r.w * 0.48 - 8, h: r.h - 28 } : { x: r.x + 12, y: r.y + 24, w: r.w - 24, h: r.h - 28 };
    if (split) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w * 0.52, r.h);
      ctx.clip();
      this.navMap.draw(ctx);
      ctx.restore();
      line(ctx, r.x + r.w * 0.52, r.y, r.x + r.w * 0.52, r.y + r.h, G1K_COLORS.boxBorder, 1);
    }
    if (page instanceof AirportInfoPage) this.drawAirportInfo(ctx, page, data);
    else if (page instanceof NavaidInfoPage) this.drawNavaidInfo(ctx, page, data);
    else if (page instanceof NearestAirportsPage) drawPage(ctx, this.sys, page, data, this.time, false);
    else if (page instanceof NearestNavaidPage) this.drawNearestNavaids(ctx, page, data);
    else if (page instanceof TripPlanningPage) this.drawTrip(ctx, data);
    else if (page instanceof UtilityPage) this.drawUtility(ctx, page, data);
    else if (page instanceof GpsStatusPage) this.drawGpsStatus(ctx, data);
    else if (page instanceof SystemSetupPage) this.drawSetup(ctx, page, data);
    else if (page instanceof SystemStatusPage) this.drawStatus(ctx, data);
    else drawPage(ctx, this.sys, page, data, this.time, false);
  }

  /** Page group window (lower right): page titles above the group tabs, current in cyan. */
  private drawGroupWindow(ctx: Ctx2D): void {
    const mfd = this.sys.mfd;
    const g = mfd.groups[mfd.group];
    const n = g.pages.length;
    const w = 300;
    const h = 30 + n * 18 + 26;
    const x = GDU_W - w - 4;
    const y = SOFTKEY_Y - h - 4;
    winBox(ctx, x, y, w, h, '#000000');
    for (let i = 0; i < n; i++) {
      const t = g.pages[i].title();
      const short = t.indexOf(' - ') >= 0 ? t.slice(t.indexOf(' - ') + 3) : t;
      TF.draw(ctx, short, x + 12, y + 16 + i * 18, 14, i === mfd.pageIdx[mfd.group] ? P.cyan : P.white, 'left', 'middle');
    }
    const tw = w / mfd.groups.length;
    for (let i = 0; i < mfd.groups.length; i++) {
      const tx = x + i * tw;
      const ty = y + h - 24;
      box(ctx, tx + 2, ty, tw - 4, 20, i === mfd.group ? P.cyan : G1K_COLORS.groupTab, '');
      TF.draw(ctx, mfd.groups[i].id, tx + tw / 2, ty + 10, 13, i === mfd.group ? P.black : P.white, 'center', 'middle');
    }
  }

  private drawAirportInfo(ctx: Ctx2D, p: AirportInfoPage, r: Rect): void {
    const f = p.form;
    const a = p.apt;
    let y = r.y + 8;
    drawField(ctx, f, 'ident', p.ident || '____', r.x, y, 18, P.cyan, 'left', this.time);
    if (!a) return;
    y += 22;
    TF.draw(ctx, a.name.slice(0, 34), r.x, y, 13, P.white, 'left', 'middle');
    y += 17;
    TF.draw(ctx, a.municipality.slice(0, 34), r.x, y, 12, P.white, 'left', 'middle');
    y += 20;
    TF.draw(ctx, join2('ELEV ', join2(fmtInt(a.elevationFt), 'FT')), r.x, y, 13, P.white, 'left', 'middle');
    const bd = brgDist(this.sys.pos(), a.lat, a.lon, this.sys.magVar());
    TF.draw(ctx, Number.isFinite(bd.dist) ? join2(join2(fmtDeg(bd.brg), '  '), join2(fmtDist(bd.dist), 'NM')) : '', r.x + r.w, y, 13, P.white, 'right', 'middle');
    y += 18;
    TF.draw(ctx, join2(fmtLat(a.lat), join2('  ', fmtLon(a.lon))), r.x, y, 12, P.white, 'left', 'middle');
    y += 24;
    if (p.view === 'info1') {
      TF.draw(ctx, 'RUNWAYS', r.x, y, 13, P.white, 'left', 'middle');
      y += 18;
      const seen = new Set<string>();
      for (const rw of a.runways) {
        const key = [rw.ident, rw.oppositeIdent].sort().join('-');
        if (seen.has(key)) continue;
        seen.add(key);
        TF.draw(ctx, join2(rw.ident, join2('-', rw.oppositeIdent)), r.x + 8, y, 14, P.cyan, 'left', 'middle');
        TF.draw(ctx, join2(fmtInt(rw.lengthFt), join2('FT x ', join2(fmtInt(rw.widthFt), 'FT'))), r.x + r.w, y, 13, P.white, 'right', 'middle');
        y += 17;
        if (rw.ils) {
          TF.draw(ctx, join2(rw.ils.ident, join2(' ', fmtNav(rw.ils.freqMhz))), r.x + 24, y, 12, P.green, 'left', 'middle');
          y += 15;
        }
        if (y > r.y + r.h - 20) break;
      }
    } else {
      TF.draw(ctx, 'FREQUENCIES', r.x, y, 13, P.white, 'left', 'middle');
      y += 18;
      const vis = Math.floor((r.y + r.h - y) / 17);
      const first = Math.max(0, Math.min(a.frequencies.length - vis, f.field?.id === 'freqs' ? f.row - vis + 1 : 0));
      for (let i = 0; i < vis; i++) {
        const q = a.frequencies[first + i];
        if (!q) break;
        const cur = f.active && f.field?.id === 'freqs' && f.row === first + i;
        TF.draw(ctx, q.type.slice(0, 10), r.x + 8, y, 12, P.white, 'left', 'middle');
        const txt = q.mhz < 118 ? fmtNav(q.mhz) : fmtCom(q.mhz, Math.round(q.mhz * 1000) % 25 !== 0);
        if (cur) box(ctx, r.x + r.w - 70, y - 8, 70, 16, P.cyan, '');
        TF.draw(ctx, txt, r.x + r.w - 2, y, 13, cur ? P.black : P.cyan, 'right', 'middle');
        y += 17;
      }
    }
  }

  private drawNavaidInfo(ctx: Ctx2D, p: NavaidInfoPage, r: Rect): void {
    const f = p.form;
    let y = r.y + 8;
    drawField(ctx, f, 'ident', p.ident || '_____', r.x, y, 18, P.cyan, 'left', this.time);
    const w = p.wpt;
    if (!w) return;
    y += 24;
    if (p.navaid) {
      TF.draw(ctx, p.navaid.name.slice(0, 34), r.x, y, 13, P.white, 'left', 'middle');
      y += 18;
      TF.draw(ctx, p.navaid.type, r.x, y, 13, P.white, 'left', 'middle');
      drawField(ctx, f, 'freq', fieldValue(f, f.fields[1]), r.x + r.w, y, 15, P.cyan, 'right', this.time);
      y += 18;
    }
    TF.draw(ctx, join2(fmtLat(w.lat), join2('  ', fmtLon(w.lon))), r.x, y, 12, P.white, 'left', 'middle');
    y += 18;
    const bd = brgDist(this.sys.pos(), w.lat, w.lon, this.sys.magVar());
    if (Number.isFinite(bd.dist)) TF.draw(ctx, join2('BRG ', join2(fmtDeg(bd.brg), join2('  DIS ', join2(fmtDist(bd.dist), 'NM')))), r.x, y, 13, P.white, 'left', 'middle');
  }

  private drawNearestNavaids(ctx: Ctx2D, p: NearestNavaidPage, r: Rect): void {
    const f = p.form;
    const rowH = 20;
    const vis = Math.floor(r.h / rowH);
    if (f.row < f.scroll) f.scroll = f.row;
    if (f.row >= f.scroll + vis) f.scroll = f.row - vis + 1;
    for (let i = 0; i < vis; i++) {
      const n = p.list[f.scroll + i];
      if (!n) break;
      const y = r.y + 8 + i * rowH;
      const cur = f.active && f.row === f.scroll + i;
      if (cur) box(ctx, r.x - 2, y - 9, 64, 18, P.cyan, '');
      TF.draw(ctx, n.ident, r.x, y, 14, cur ? P.black : P.cyan, 'left', 'middle');
      TF.draw(ctx, fmtDeg(n.brg), r.x + 120, y, 13, P.white, 'right', 'middle');
      TF.draw(ctx, join2(fmtDist(n.dist), 'NM'), r.x + 200, y, 13, P.white, 'right', 'middle');
      if (Number.isFinite(n.freq)) TF.draw(ctx, p.kind === 'ndb' ? fmtFixed(n.freq, 1) : fmtNav(n.freq), r.x + r.w, y, 13, P.cyan, 'right', 'middle');
    }
    if (!p.list.length) TF.draw(ctx, 'NONE WITHIN RANGE', r.x + r.w / 2, r.y + 30, 14, P.white, 'center', 'middle');
  }

  /** AUX - Trip Planning (automatic): present position to the active waypoint and destination. */
  private drawTrip(ctx: Ctx2D, r: Rect): void {
    const v = this.sys.vars;
    const gs = v.get(GPS.gs);
    const ff = v.get('eng1.ff_gph');
    const fob = v.get(G1K.fuelRemGal);
    const leg = v.get('fms.active_leg', -1) >= 0;
    let y = r.y + 10;
    const row = (label: string, value: string): void => {
      TF.draw(ctx, label, r.x, y, 13, P.white, 'left', 'middle');
      TF.draw(ctx, value, r.x + 320, y, 15, P.cyan, 'right', 'middle');
      y += 22;
    };
    TF.draw(ctx, 'AUTOMATIC  P.POS', r.x, y, 14, P.white, 'left', 'middle');
    y += 28;
    row('GS', join2(fmtInt(gs), 'KT'));
    row('FUEL FLOW', join2(fmtFixed(ff, 1), 'GPH'));
    row('FUEL ON BOARD', join2(fmtFixed(fob, 1), 'GL'));
    y += 8;
    row('DTK', leg ? fmtDeg(v.get('fms.dtk_mag_deg')) : '___°');
    row('DIS (WPT)', leg ? join2(fmtDist(v.get('fms.dist_to_wpt_nm')), 'NM') : '__._NM');
    row('ETE (WPT)', leg && gs > 5 ? fmtHms(v.get('fms.ete_wpt_s')) : '__:__');
    const dd = v.get('fms.dist_to_dest_nm', NaN);
    row('DIS (DEST)', Number.isFinite(dd) ? join2(fmtDist(dd), 'NM') : '__._NM');
    const ete = Number.isFinite(dd) && gs > 5 ? (dd / gs) * 3600 : NaN;
    row('ETE (DEST)', Number.isFinite(ete) ? fmtHms(ete) : '__:__');
    row('ETA (DEST)', Number.isFinite(ete) ? fmtClockHms((((v.get(GPS.utcH) + ete / 3600) % 24) + 24) % 24) : '__:__');
    y += 8;
    const req = Number.isFinite(ete) ? (ff * ete) / 3600 : NaN;
    row('FUEL REQ', Number.isFinite(req) ? join2(fmtFixed(req, 1), 'GL') : '__._GL');
    row('FUEL REM (DEST)', Number.isFinite(req) ? join2(fmtFixed(fob - req, 1), 'GL') : '__._GL');
    row('ENDURANCE', ff > 0.5 ? fmtHms((fob / ff) * 3600) : '__:__');
    row('RANGE', ff > 0.5 ? join2(fmtInt((fob / ff) * gs), 'NM') : '___NM');
    row('EFFICIENCY', ff > 0.5 ? join2(fmtFixed(gs / ff, 1), 'NM/GL') : '__._NM/GL');
  }

  private drawUtility(ctx: Ctx2D, p: UtilityPage, r: Rect): void {
    const v = this.sys.vars;
    const f = p.form;
    const t = this.sys.refs.timer;
    let y = r.y + 10;
    TF.draw(ctx, 'TIMERS', r.x, y, 14, P.white, 'left', 'middle');
    y += 24;
    TF.draw(ctx, 'GENERIC', r.x, y, 13, P.white, 'left', 'middle');
    drawField(ctx, f, 'timer', fmtHms(t.seconds, true), r.x + 240, y, 15, P.cyan, 'right', this.time);
    drawField(ctx, f, 'dir', fieldValue(f, f.fields[1]), r.x + 290, y, 14, P.cyan, 'center', this.time);
    drawField(ctx, f, 'start', t.prompt, r.x + 380, y, 14, P.cyan, 'right', this.time);
    y += 24;
    const row = (label: string, value: string): void => {
      TF.draw(ctx, label, r.x, y, 13, P.white, 'left', 'middle');
      TF.draw(ctx, value, r.x + 240, y, 15, P.white, 'right', 'middle');
      y += 22;
    };
    row('FLIGHT', fmtHms(v.get(G1K.flightTimeS), true));
    const dep = v.get(G1K.departureTimeH, NaN);
    row('DEPARTURE TIME', Number.isFinite(dep) && dep > 0 ? fmtClockHms(dep) : '__:__:__');
    y += 10;
    TF.draw(ctx, 'TRIP STATISTICS', r.x, y, 14, P.white, 'left', 'middle');
    y += 24;
    row('TRIP ODOM', join2(fmtFixed(v.get(G1K.tripOdoNm), 1), 'NM'));
    row('ODOMETER', join2(fmtFixed(v.get(G1K.odometerNm), 1), 'NM'));
    row('MAX GS', join2(fmtInt(v.get(G1K.maxGsKt)), 'KT'));
    row('ENG HRS', fmtFixed(this.sys.fuel.engineHours(), 1));
  }

  private drawGpsStatus(ctx: Ctx2D, r: Rect): void {
    const v = this.sys.vars;
    const rx = v.get(G1K.gpsStatusRx) >= 1.5 ? 2 : 1;
    const up = this.sys.units.up(rx === 1 ? 'gia1' : 'gia2');
    const valid = up && v.get(GPS.valid) >= 0.5;
    const sbas = v.get(GPS.sbas) >= 0.5;
    const sats = v.get(GPS.sats);
    let y = r.y + 10;
    const row = (label: string, value: string, color: string = P.white): void => {
      TF.draw(ctx, label, r.x, y, 13, P.white, 'left', 'middle');
      TF.draw(ctx, value, r.x + 330, y, 15, color, 'right', 'middle');
      y += 22;
    };
    TF.draw(ctx, rx === 1 ? 'GPS1' : 'GPS2', r.x, y, 15, P.cyan, 'left', 'middle');
    y += 26;
    const acq = v.get(GPS.acquireS);
    row('GPS SOLUTION', !up ? 'INOP' : valid ? (sbas ? '3D DIFF NAV' : '3D NAV') : acq > 0 ? 'ACQUIRING' : 'SEARCH SKY', valid ? P.green : P.white);
    row('SATELLITES', up ? fmtInt(sats) : '--');
    const epu = v.get(GPS.epuNm);
    row('EPU', valid && Number.isFinite(epu) ? join2(fmtFixed(epu, 2), 'NM') : '__.__NM');
    // HFOM / VFOM: EST from EPU (HFOM ~ EPU; VFOM ~ 1.5 x HFOM in feet).
    row('HFOM', valid && Number.isFinite(epu) ? join2(fmtInt(epu * 6076), 'FT') : '____FT');
    row('VFOM', valid && Number.isFinite(epu) ? join2(fmtInt(epu * 6076 * 1.5), 'FT') : '____FT');
    row('SBAS', sbas ? 'ACTIVE' : 'INACTIVE', sbas ? P.green : P.white);
    y += 8;
    row('POSITION', valid ? join2(fmtLat(v.get(GPS.lat)), join2(' ', fmtLon(v.get(GPS.lon)))) : '__°__.___');
    row('TIME (UTC)', valid ? fmtClockHms(v.get(GPS.utcH)) : '__:__:__');
    row('ALTITUDE', valid ? join2(fmtInt(v.get(GPS.alt)), 'FT') : '_____FT');
    row('GS', valid ? join2(fmtInt(v.get(GPS.gs)), 'KT') : '___KT');
    row('TRACK', valid && v.get(GPS.gs) > 5 ? fmtDeg(v.get(GPS.trackMag)) : '___°');
    // Signal strength bars (EST: synthetic per-satellite strengths from the satellite count).
    const n = up ? Math.max(0, Math.min(12, sats | 0)) : 0;
    const bx = r.x + 360;
    const by = r.y + 120;
    for (let i = 0; i < 12; i++) {
      const h = i < n ? 30 + ((i * 37) % 30) : 4;
      box(ctx, bx + i * 22, by - h, 16, h, i < n ? (sbas ? P.green : P.cyan) : P.darkGrey, '');
    }
  }

  private drawSetup(ctx: Ctx2D, p: SystemSetupPage, r: Rect): void {
    const f = p.form;
    const t = this.time;
    let y = r.y + 10;
    const row = (label: string, id: string, suffix = ''): void => {
      const fld = f.fields.find((q) => q.id === id);
      if (!fld) return;
      const en = fld.enabled ? fld.enabled() : true;
      TF.draw(ctx, label, r.x, y, 13, P.white, 'left', 'middle');
      if (en) drawField(ctx, f, id, join2(fieldValue(f, fld), suffix), r.x + 400, y, 14, P.cyan, 'right', t);
      else TF.draw(ctx, '----', r.x + 400, y, 14, P.grey, 'right', 'middle');
      y += 22;
    };
    if (p.setup === 1) {
      TF.draw(ctx, 'DATE / TIME', r.x, y, 14, P.white, 'left', 'middle');
      y += 22;
      row('TIME FORMAT', 'time_fmt');
      row('TIME OFFSET', 'time_ofs', 'HR');
      y += 6;
      TF.draw(ctx, 'DISPLAY UNITS', r.x, y, 14, P.white, 'left', 'middle');
      y += 22;
      row('NAV ANGLE', 'nav_angle');
      row('BARO', 'baro');
      y += 6;
      TF.draw(ctx, 'AIRSPACE / ALERTS', r.x, y, 14, P.white, 'left', 'middle');
      y += 22;
      row('ARRIVAL ALERT', 'arr_alert');
      row('ARRIVAL DISTANCE', 'arr_nm', 'NM');
      y += 6;
      TF.draw(ctx, 'NAVIGATION STATUS', r.x, y, 14, P.white, 'left', 'middle');
      y += 22;
      row('GPS CDI', 'gps_cdi');
      y += 6;
      TF.draw(ctx, 'MFD DATA BAR FIELDS', r.x, y, 14, P.white, 'left', 'middle');
      y += 22;
      for (let i = 0; i < 4; i++) row(`FIELD ${i + 1}`, `bar${i}`);
      y += 6;
      TF.draw(ctx, 'COM CONFIG', r.x, y, 14, P.white, 'left', 'middle');
      y += 22;
      row('CHANNEL SPACING', 'com_spacing');
    } else {
      TF.draw(ctx, 'STABILITY & PROTECTION', r.x, y, 14, P.white, 'left', 'middle');
      y += 22;
      row('ESP', 'esp');
    }
  }

  private drawStatus(ctx: Ctx2D, r: Rect): void {
    const sys = this.sys;
    let y = r.y + 10;
    TF.draw(ctx, 'AIRFRAME', r.x, y, 13, P.white, 'left', 'middle');
    TF.draw(ctx, sys.cfg.aircraftName, r.x + 380, y, 14, P.cyan, 'right', 'middle');
    y += 20;
    TF.draw(ctx, 'SYSTEM SOFTWARE', r.x, y, 13, P.white, 'left', 'middle');
    TF.draw(ctx, sys.cfg.softwareVersion, r.x + 380, y, 14, P.cyan, 'right', 'middle');
    y += 28;
    TF.draw(ctx, 'LRU INFO', r.x, y, 14, P.white, 'left', 'middle');
    TF.draw(ctx, 'STATUS', r.x + 380, y, 13, P.white, 'right', 'middle');
    y += 20;
    for (const l of sys.lruStatus()) {
      TF.draw(ctx, l.name, r.x + 8, y, 13, P.white, 'left', 'middle');
      TF.draw(ctx, l.ok ? '✓' : 'X', r.x + 380, y, 15, l.ok ? P.green : P.red, 'right', 'middle');
      y += 18;
    }
    y += 10;
    TF.draw(ctx, 'DATABASES', r.x, y, 14, P.white, 'left', 'middle');
    y += 20;
    // Navigation data source (OurAirports / FAA CIFP via public/data; see docs/modules/nav.md).
    TF.draw(ctx, 'NAVIGATION', r.x + 8, y, 13, P.white, 'left', 'middle');
    TF.draw(ctx, sys.nav.ready ? 'OurAirports / CIFP' : 'LOADING', r.x + 380, y, 13, sys.nav.ready ? P.green : P.amber, 'right', 'middle');
  }

  private drawChecklist(ctx: Ctx2D, p: ChecklistPage, r: Rect): void {
    const sys = this.sys;
    const f = p.form;
    const cl = sys.checklists;
    box(ctx, r.x, r.y, r.w, r.h, '#000000', G1K_COLORS.boxBorder, 1.5);
    let y = r.y + 14;
    TF.draw(ctx, 'Group:', r.x + 10, y, 13, P.white, 'left', 'middle');
    drawField(ctx, f, 'group', fieldValue(f, f.fields[0]) || '----', r.x + 70, y, 14, P.cyan, 'left', this.time);
    y += 22;
    TF.draw(ctx, 'Checklist:', r.x + 10, y, 13, P.white, 'left', 'middle');
    drawField(ctx, f, 'list', fieldValue(f, f.fields[1]) || '----', r.x + 90, y, 14, P.cyan, 'left', this.time);
    y += 10;
    line(ctx, r.x + 6, y, r.x + r.w - 6, y, P.grey, 1);
    const cur = cl.current;
    if (!cur) return;
    const rowH = 20;
    const top = y + 14;
    const vis = Math.floor((r.y + r.h - top - 40) / rowH);
    if (f.row < f.scroll) f.scroll = f.row;
    if (f.row >= f.scroll + vis) f.scroll = f.row - vis + 1;
    for (let i = 0; i < vis; i++) {
      const k = f.scroll + i;
      const it = cur.items[k];
      if (!it) break;
      const yy = top + i * rowH;
      const checked = cl.isChecked(k);
      const hl = f.active && f.field?.id === 'items' && f.row === k;
      if (hl) box(ctx, r.x + 8, yy - 9, r.w - 16, 18, 'rgba(0,255,255,0.25)', P.cyan, 1);
      box(ctx, r.x + 14, yy - 6, 12, 12, '', checked ? P.green : P.white, 1.5);
      if (checked) TF.draw(ctx, '✓', r.x + 20, yy, 12, P.green, 'center', 'middle');
      const color = checked ? P.green : P.white;
      TF.draw(ctx, it.challenge, r.x + 34, yy, 13, color, 'left', 'middle');
      TF.draw(ctx, it.response, r.x + r.w - 12, yy, 13, color, 'right', 'middle');
    }
    const done = cl.complete();
    const by = r.y + r.h - 20;
    TF.draw(ctx, done ? '*Checklist Finished*' : '*Checklist Not Finished*', r.x + r.w / 2, by - 20, 14, done ? P.green : P.amber, 'center', 'middle');
    if (done && cl.index < cl.lists.length - 1) drawField(ctx, f, 'next', 'Go to Next Checklist?', r.x + r.w / 2, by, 14, P.white, 'center', this.time);
    void blinkOn;
  }
}
