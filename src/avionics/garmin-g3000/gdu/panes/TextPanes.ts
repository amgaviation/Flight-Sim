/**
 * Non-map display panes: Active Flight Plan (with VNAV profile), Systems
 * synoptics, Checklist, Nearest, Waypoint (airport) Info, Trip Planning /
 * statistics, GPS Status, Weight and Fuel, Performance (TOLD) and Charts.
 * Each pane draws into the rectangle it is given (half or full pane).
 *
 * Formats follow the G3000 PG 190-02046-01 figures: flight plan table
 * columns DTK / DIS LEG CUM / ALT / FUEL REM / ETE LEG CUM / ETA with the
 * "Current VNAV Profile" box (§5.6, §5.7), nearest lists with bearing arrows
 * and distance (§5.3), GPS status sky view and signal bars (§1.4).
 */
import type { SimVars } from '../../../../core/SimVars';
import { ADC, FMS, GPS } from '../../../../core/vars';
import { DEG2RAD, wrap360 } from '../../../../core/math';
import { distanceNm, initialBearing } from '../../../../core/geo';
import { KG_TO_LB } from '../../../../core/units';
import { fmtFixed, fmtInt } from '../../../common/format';
import { box, circle, line, type Ctx2D, type Rect } from '../../../common/draw/context';
import type { Airport, Navaid, Fix } from '../../../../nav/types';
import type { FplRow } from '../../state/FplEditor';
import type { G3000System } from '../../state/System';
import { G3K, vn } from '../../vars';
import { fmtClockH, fmtDeg, fmtDist, fmtHms, fmtLat, fmtLon, fmtThousands, fmtCom, fmtNav, join2 } from '../../format';
import { SynopticPage } from '../synoptic';
import { G3K_COLORS, G3K_PALETTE, TF, dataBox } from '../style';

const P = G3K_PALETTE;

export interface PaneContentView {
  update(dt: number): void;
  draw(ctx: Ctx2D, r: Rect): void;
}

function header(ctx: Ctx2D, r: Rect, text: string): void {
  TF.draw(ctx, text, r.x + 10, r.y + 16, 16, P.white, 'left', 'middle');
  line(ctx, r.x + 4, r.y + 30, r.x + r.w - 4, r.y + 30, G3K_COLORS.boxBorder, 1);
}

// ================================================================== flight plan

export class FplPane implements PaneContentView {
  private rows: FplRow[] = [];
  private version = NaN;
  constructor(private readonly sys: G3000System) {}
  update(_dt: number): void {
    const fpl = this.sys.fpl;
    if (!fpl) return;
    const ver = fpl.plan.version * 1000 + fpl.plan.activeLegIndex + this.sys.revision * 7;
    if (ver !== this.version) {
      this.version = ver;
      this.rows = fpl.rows();
    }
  }
  draw(ctx: Ctx2D, r: Rect): void {
    const fpl = this.sys.fpl;
    const v = this.sys.vars;
    if (!fpl) {
      TF.draw(ctx, 'FMS NOT AVAILABLE', r.x + r.w / 2, r.y + r.h / 2, 20, P.amber, 'center', 'middle');
      return;
    }
    const wide = r.w > 700;
    const plan = fpl.plan;
    const perf = this.sys.fms!.perf;
    const profileH = 150;
    const tableH = r.h - profileH - 8;
    const x = r.x + 8;
    // Column layout (x offsets).
    const cols = wide ? [0, 180, 260, 340, 420, 540, 640, 740, 840] : [0, 150, 222, 0, 300, 400, 0, 0, 0];
    TF.draw(ctx, 'ACTIVE FLIGHT PLAN', x, r.y + 14, 15, P.white, 'left', 'middle');
    const hy = r.y + 36;
    TF.draw(ctx, 'DTK', x + cols[1] + 40, hy, 13, P.white, 'right', 'middle');
    TF.draw(ctx, 'DIS', x + cols[2] + 50, hy - 9, 13, P.white, 'right', 'middle');
    TF.draw(ctx, 'LEG', x + cols[2] + 50, hy + 7, 12, P.white, 'right', 'middle');
    if (wide) {
      TF.draw(ctx, 'CUM', x + cols[3] + 50, hy + 7, 12, P.white, 'right', 'middle');
      TF.draw(ctx, 'FUEL', x + cols[5] + 70, hy - 9, 13, P.white, 'right', 'middle');
      TF.draw(ctx, 'REM', x + cols[5] + 70, hy + 7, 12, P.white, 'right', 'middle');
      TF.draw(ctx, 'ETE', x + cols[6] + 70, hy - 9, 13, P.white, 'right', 'middle');
      TF.draw(ctx, 'LEG', x + cols[6] + 70, hy + 7, 12, P.white, 'right', 'middle');
      TF.draw(ctx, 'ETA', x + cols[8] + 60, hy, 13, P.white, 'right', 'middle');
    }
    TF.draw(ctx, 'ALT', x + cols[4] + 70, hy, 13, P.white, 'right', 'middle');
    if (!wide) TF.draw(ctx, 'FUEL', x + cols[5] + 80, hy, 13, P.white, 'right', 'middle');
    line(ctx, r.x + 4, hy + 18, r.x + r.w - 4, hy + 18, G3K_COLORS.boxBorder, 1);
    const rowH = 30;
    const top = hy + 24;
    const maxRows = Math.floor((tableH - (top - r.y)) / rowH);
    // Scroll so the active leg is on screen (one row of context above).
    let first = 0;
    const act = this.rows.findIndex((row) => row.active);
    if (act > maxRows - 3) first = Math.min(act - 2, Math.max(0, this.rows.length - maxRows));
    const fuelK = this.sys.cfg.units.fuel === 'lb' ? KG_TO_LB : 1;
    for (let i = 0; i < maxRows && first + i < this.rows.length; i++) {
      const row = this.rows[first + i];
      const y = top + i * rowH + rowH / 2;
      if (row.kind === 'header') {
        TF.draw(ctx, row.text, x + 20, y, 16, P.white, 'left', 'middle');
        continue;
      }
      const col = row.active ? P.magenta : row.kind === 'origin' || row.kind === 'destination' ? P.cyan : P.white;
      if (row.active) {
        // Active leg arrow (magenta bracket from the FROM row).
        line(ctx, x + 2, y - rowH, x + 2, y, P.magenta, 2);
        line(ctx, x + 2, y, x + 12, y, P.magenta, 2);
      }
      TF.draw(ctx, row.text, x + 16, y, 18, row.kind === 'disco' ? P.white : col, 'left', 'middle');
      if (row.sub && row.kind === 'leg') TF.draw(ctx, row.sub, x + 16 + TF.width(ctx, row.text, 18) + 8, y + 2, 12, P.white, 'left', 'middle');
      const k = row.legIndex;
      const leg = k >= 0 ? plan.legs[k] : undefined;
      if (!leg || row.kind === 'disco') continue;
      const future = k >= plan.activeLegIndex && plan.activeLegIndex >= 0;
      const dtk = leg.geom.valid ? wrap360(leg.geom.finalCourseTrue - (leg.magVar ?? 0)) : NaN;
      if (Number.isFinite(dtk) && k > 0) TF.draw(ctx, fmtDeg(dtk), x + cols[1] + 40, y, 17, col, 'right', 'middle');
      if (leg.geom.valid && k > 0) TF.draw(ctx, fmtDist(leg.geom.lengthNm), x + cols[2] + 50, y, 17, col, 'right', 'middle');
      if (wide && future && k < perf.count) TF.draw(ctx, fmtDist(perf.distNm[k]), x + cols[3] + 50, y, 17, col, 'right', 'middle');
      // Altitude: constraint in cyan (crew entered) / white (database), predicted in white small.
      const a = leg.altitude;
      if (a) {
        const ft = a.kind === 'atOrBelow' ? a.upperFt : a.lowerFt;
        if (ft !== undefined) {
          const txt = ft >= 18000 ? join2('FL', fmtInt(ft / 100)) : join2(fmtThousands(ft), 'FT');
          TF.draw(ctx, txt, x + cols[4] + 70, y, 17, leg.userConstraint ? P.cyan : P.white, 'right', 'middle');
          if (a.kind === 'atOrAbove') line(ctx, x + cols[4] + 70 - TF.width(ctx, txt, 17), y + 11, x + cols[4] + 70, y + 11, P.white, 1.5);
          if (a.kind === 'atOrBelow') line(ctx, x + cols[4] + 70 - TF.width(ctx, txt, 17), y - 11, x + cols[4] + 70, y - 11, P.white, 1.5);
        }
      } else if (Number.isFinite(leg.geom.predictedAltFt)) TF.draw(ctx, join2(fmtThousands(Math.round(leg.geom.predictedAltFt / 10) * 10), 'FT'), x + cols[4] + 70, y, 14, P.white, 'right', 'middle');
      if (future && k < perf.count && Number.isFinite(perf.fuelKg[k])) TF.draw(ctx, fmtInt(perf.fuelKg[k] * fuelK), x + cols[5] + (wide ? 70 : 80), y, 17, col, 'right', 'middle');
      if (wide && future && k < perf.count) {
        const eteLeg = k === plan.activeLegIndex ? perf.eteS[k] : perf.eteS[k] - perf.eteS[k - 1];
        TF.draw(ctx, fmtHms(eteLeg), x + cols[6] + 70, y, 17, col, 'right', 'middle');
        TF.draw(ctx, join2(fmtClockH(perf.etaUtcH[k]), 'UTC'), x + cols[8] + 60, y, 16, col, 'right', 'middle');
      }
    }
    // Current VNAV profile.
    const py = r.y + r.h - profileH;
    dataBox(ctx, r.x + 6, py, r.w - 12, profileH - 6, 'rgba(0,0,0,0.6)');
    TF.draw(ctx, 'CURRENT VNAV PROFILE', r.x + 16, py + 14, 14, P.white, 'left', 'middle');
    const vnav = v.get(FMS.vnavValid) >= 0.5;
    const items: [string, string][] = [
      ['ACTIVE VNAV WAYPOINT', vnav ? join2(fmtThousands(v.get(FMS.vnavTargetAltFt)), 'FT') : '_____FT'],
      ['TIME TO TOD', v.get(FMS.todEteS) > 0 ? fmtHms(v.get(FMS.todEteS)) : '__:__'],
      ['FPA', join2(fmtFixed(-plan.descentFpaDeg, 2), '°')],
      ['VS TGT', vnav ? join2(fmtInt(v.get(FMS.vsRequiredFpm)), 'FPM') : '____FPM'],
      ['V DEV', vnav ? join2(fmtInt(v.get(FMS.vnavDevFt)), 'FT') : '____FT'],
    ];
    const colW = (r.w - 24) / (wide ? 3 : 2);
    items.forEach(([label, val], i) => {
      const cx = r.x + 16 + (i % (wide ? 3 : 2)) * colW;
      const cy = py + 42 + Math.floor(i / (wide ? 3 : 2)) * 34;
      TF.draw(ctx, label, cx, cy, 13, P.white, 'left', 'middle');
      TF.draw(ctx, val, cx + colW - 16, cy, 17, P.magenta, 'right', 'middle');
    });
  }
}

// ================================================================== synoptics

export class SynopticsPane implements PaneContentView {
  private readonly pages: SynopticPage[];
  constructor(private readonly sys: G3000System, private readonly paneVar: string) {
    this.pages = sys.cfg.synoptics.map((d) => new SynopticPage(sys.vars, d));
  }
  update(_dt: number): void {}
  title(): string {
    const p = this.pages[this.sys.vars.get(this.paneVar) | 0];
    return p ? p.def.title : 'Systems';
  }
  draw(ctx: Ctx2D, r: Rect): void {
    const i = this.sys.vars.get(this.paneVar) | 0;
    const page = this.pages[i];
    if (!page) {
      TF.draw(ctx, 'NO SYNOPTIC PAGES', r.x + r.w / 2, r.y + r.h / 2, 18, P.white, 'center', 'middle');
      return;
    }
    page.draw(ctx, r.x + 4, r.y + 8, r.w - 8, r.h - 12, this.sys.vars, P, TF);
  }
}

// ================================================================== checklist

export class ChecklistPane implements PaneContentView {
  constructor(private readonly sys: G3000System) {}
  update(_dt: number): void {}
  draw(ctx: Ctx2D, r: Rect): void {
    const m = this.sys.checklists;
    const cl = m.current;
    if (!cl) {
      TF.draw(ctx, 'NO CHECKLISTS', r.x + r.w / 2, r.y + r.h / 2, 18, P.white, 'center', 'middle');
      return;
    }
    TF.draw(ctx, cl.phase.toUpperCase(), r.x + 10, r.y + 16, 14, P.cyan, 'left', 'middle');
    TF.draw(ctx, cl.title, r.x + r.w / 2, r.y + 40, 20, P.white, 'center', 'middle');
    line(ctx, r.x + 6, r.y + 56, r.x + r.w - 6, r.y + 56, G3K_COLORS.boxBorder, 1);
    const rowH = 30;
    const maxRows = Math.floor((r.h - 110) / rowH);
    const first = Math.max(0, Math.min(m.cursor - Math.floor(maxRows / 2), cl.items.length - maxRows));
    for (let i = 0; i < maxRows && first + i < cl.items.length; i++) {
      const k = first + i;
      const it = cl.items[k];
      const y = r.y + 72 + i * rowH;
      const checked = m.isChecked(k);
      const col = checked ? P.green : P.white;
      if (k === m.cursor) box(ctx, r.x + 6, y - rowH / 2 + 2, r.w - 12, rowH - 4, '', P.cyan, 2, 3);
      box(ctx, r.x + 14, y - 8, 16, 16, '', col, 1.5);
      if (checked) {
        ctx.beginPath();
        ctx.moveTo(r.x + 16, y);
        ctx.lineTo(r.x + 21, y + 6);
        ctx.lineTo(r.x + 30, y - 9);
        ctx.strokeStyle = P.green;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      TF.draw(ctx, it.challenge, r.x + 40, y, 16, col, 'left', 'middle');
      TF.draw(ctx, it.response, r.x + r.w - 12, y, 16, col, 'right', 'middle');
      // Leader dots.
      const x0 = r.x + 48 + TF.width(ctx, it.challenge, 16);
      const x1 = r.x + r.w - 20 - TF.width(ctx, it.response, 16);
      for (let dx = x0; dx < x1; dx += 8) circle(ctx, dx, y + 5, 1, col);
    }
    const done = m.complete();
    TF.draw(ctx, done ? 'CHECKLIST COMPLETE' : '', r.x + r.w / 2, r.y + r.h - 24, 17, P.green, 'center', 'middle');
  }
}

// ================================================================== nearest

type NearestItem = { ident: string; name: string; lat: number; lon: number; freq: string; extra: string };

export class NearestPane implements PaneContentView {
  items: NearestItem[] = [];
  private timer = 0;
  private kind = '';
  constructor(private readonly sys: G3000System) {}
  update(dt: number): void {
    this.timer -= dt;
    const kind = this.sys.ui.nearestKind;
    if (this.timer > 0 && kind === this.kind) return;
    this.timer = 2;
    this.kind = kind;
    this.items = nearestItems(this.sys, kind, 25);
  }
  draw(ctx: Ctx2D, r: Rect): void {
    const v = this.sys.vars;
    const title = this.kind === 'airport' ? 'NEAREST AIRPORTS' : this.kind === 'vor' ? 'NEAREST VOR' : this.kind === 'ndb' ? 'NEAREST NDB' : 'NEAREST INTERSECTIONS';
    header(ctx, r, title);
    const lat = v.get(GPS.lat);
    const lon = v.get(GPS.lon);
    const mv = v.get(GPS.magVar);
    const rowH = 44;
    const n = Math.floor((r.h - 40) / rowH);
    for (let i = 0; i < n && i < this.items.length; i++) {
      const it = this.items[i];
      const y = r.y + 40 + i * rowH + rowH / 2;
      TF.draw(ctx, it.ident, r.x + 12, y - 8, 20, P.cyan, 'left', 'middle');
      TF.draw(ctx, it.name.slice(0, 22), r.x + 12, y + 12, 13, P.white, 'left', 'middle');
      const brg = wrap360(initialBearing(lat, lon, it.lat, it.lon) - mv);
      const d = distanceNm(lat, lon, it.lat, it.lon);
      const bx = r.x + r.w * 0.52;
      // Bearing arrow relative to heading.
      const rel = (brg - v.get(vn(ADC.heading, 1))) * DEG2RAD;
      line(ctx, bx - 10 * Math.sin(rel), y - 8 + 10 * Math.cos(rel), bx + 10 * Math.sin(rel), y - 8 - 10 * Math.cos(rel), P.cyan, 2.5);
      TF.draw(ctx, fmtDeg(brg), bx, y + 12, 15, P.white, 'center', 'middle');
      TF.draw(ctx, join2(fmtDist(d), 'NM'), r.x + r.w * 0.74, y, 17, P.white, 'right', 'middle');
      TF.draw(ctx, it.freq || it.extra, r.x + r.w - 10, y, 16, P.white, 'right', 'middle');
    }
  }
}

/** Nearest facilities (shared by the pane and the GTC Nearest screens). Allocates: 0.5 Hz. */
export function nearestItems(sys: G3000System, kind: 'airport' | 'vor' | 'ndb' | 'int', limit: number): NearestItem[] {
  const v = sys.vars;
  if (v.get(GPS.valid) < 0.5) return [];
  const lat = v.get(GPS.lat);
  const lon = v.get(GPS.lon);
  if (kind === 'airport') {
    return sys.nav.airportsNear(lat, lon, 100, 60)
      .filter((a: Airport) => a.type !== 'heliport' && a.type !== 'closed')
      .slice(0, limit)
      .map((a: Airport) => {
        let longest = 0;
        for (const rw of a.runways) longest = Math.max(longest, rw.lengthFt);
        const twr = a.frequencies.find((f) => /TWR|CTAF|UNICOM/i.test(f.type));
        return { ident: a.icao, name: a.name, lat: a.lat, lon: a.lon, freq: twr ? fmtCom(twr.mhz) : '', extra: join2(fmtThousands(longest), 'FT') };
      });
  }
  if (kind === 'int') {
    return sys.nav.fixesNear(lat, lon, 30).slice(0, limit).map((f: Fix) => ({ ident: f.ident, name: '', lat: f.lat, lon: f.lon, freq: '', extra: '' }));
  }
  const types = kind === 'vor' ? (['VOR', 'VORDME', 'VORTAC'] as const) : (['NDB', 'NDBDME'] as const);
  return sys.nav
    .navaidsNear(lat, lon, 200, [...types])
    .slice(0, limit)
    .map((n: Navaid) => ({ ident: n.ident, name: n.name, lat: n.lat, lon: n.lon, freq: kind === 'vor' ? fmtNav(n.freq) : fmtFixed(n.freq, 1), extra: '' }));
}

// ================================================================== waypoint info

export class WaypointInfoPane implements PaneContentView {
  constructor(private readonly sys: G3000System) {}
  update(_dt: number): void {}
  draw(ctx: Ctx2D, r: Rect): void {
    const id = this.sys.ui.wptInfoIdent;
    const a = id ? this.sys.nav.airport(id) : undefined;
    header(ctx, r, 'AIRPORT INFORMATION');
    if (!a) {
      TF.draw(ctx, 'Select an airport on the GTC', r.x + r.w / 2, r.y + 80, 16, P.white, 'center', 'middle');
      return;
    }
    TF.draw(ctx, a.icao, r.x + 12, r.y + 54, 26, P.cyan, 'left', 'middle');
    TF.draw(ctx, a.name, r.x + 12, r.y + 82, 16, P.white, 'left', 'middle');
    TF.draw(ctx, join2(join2(a.municipality, ', '), a.country), r.x + 12, r.y + 104, 14, P.white, 'left', 'middle');
    TF.draw(ctx, join2(join2(fmtLat(a.lat), '  '), fmtLon(a.lon)), r.x + 12, r.y + 128, 14, P.white, 'left', 'middle');
    TF.draw(ctx, join2(join2('ELEV ', fmtThousands(a.elevationFt)), 'FT'), r.x + r.w - 12, r.y + 54, 16, P.white, 'right', 'middle');
    let y = r.y + 160;
    TF.draw(ctx, 'RUNWAYS', r.x + 12, y, 14, P.white, 'left', 'middle');
    y += 24;
    const seen = new Set<string>();
    for (const rw of a.runways) {
      if (seen.has(rw.oppositeIdent)) continue;
      seen.add(rw.ident);
      TF.draw(ctx, join2(join2(rw.ident, '-'), rw.oppositeIdent), r.x + 20, y, 17, P.cyan, 'left', 'middle');
      TF.draw(ctx, join2(join2(join2(join2(join2(fmtThousands(rw.lengthFt), 'FT x '), fmtInt(rw.widthFt)), 'FT  '), rw.surface.toUpperCase()), rw.ils ? '  ILS' : ''), r.x + 110, y, 14, P.white, 'left', 'middle');
      y += 24;
      if (y > r.y + r.h * 0.6) break;
    }
    y += 10;
    TF.draw(ctx, 'FREQUENCIES', r.x + 12, y, 14, P.white, 'left', 'middle');
    y += 24;
    for (const f of a.frequencies) {
      TF.draw(ctx, f.type, r.x + 20, y, 15, P.white, 'left', 'middle');
      TF.draw(ctx, fmtCom(f.mhz), r.x + r.w - 20, y, 17, P.cyan, 'right', 'middle');
      y += 22;
      if (y > r.y + r.h - 16) break;
    }
  }
}

// ================================================================== trip / GPS / W&F / TOLD / charts

export class TripPane implements PaneContentView {
  constructor(private readonly sys: G3000System) {}
  update(_dt: number): void {}
  draw(ctx: Ctx2D, r: Rect): void {
    const v = this.sys.vars;
    header(ctx, r, 'TRIP STATISTICS');
    const fuelK = this.sys.cfg.units.fuel === 'lb' ? KG_TO_LB : 1;
    const unit = this.sys.cfg.units.fuel === 'lb' ? 'LB' : 'KG';
    const rows: [string, string][] = [
      ['FLIGHT TIME', fmtHms(v.get(G3K.flightTimeS), true)],
      ['TRIP ODOMETER', join2(fmtDist(v.get(G3K.tripOdoNm)), 'NM')],
      ['FUEL ON BOARD', join2(fmtThousands(v.get(this.sys.cfg.fuelTotalVar) * fuelK), unit)],
      ['FUEL AT DEST', v.get(FMS.fuelDestKg) > 0 ? join2(fmtThousands(v.get(FMS.fuelDestKg) * fuelK), unit) : '____'],
      ['DIST TO DEST', join2(fmtDist(v.get(FMS.distToDestNm)), 'NM')],
      ['ETE DEST', fmtHms(v.get(FMS.eteDestS), true)],
      ['ETA DEST', join2(fmtClockH(v.get(FMS.etaDestUtcH)), 'UTC')],
      ['GROUND SPEED', join2(fmtInt(v.get(GPS.gs)), 'KT')],
    ];
    rows.forEach(([k, val], i) => {
      const y = r.y + 56 + i * 34;
      TF.draw(ctx, k, r.x + 16, y, 16, P.white, 'left', 'middle');
      TF.draw(ctx, val, r.x + r.w - 16, y, 19, P.cyan, 'right', 'middle');
    });
  }
}

export class GpsStatusPane implements PaneContentView {
  private t = 0;
  constructor(private readonly sys: G3000System) {}
  update(dt: number): void {
    this.t += dt;
  }
  draw(ctx: Ctx2D, r: Rect): void {
    const v = this.sys.vars;
    header(ctx, r, 'GPS 1 STATUS');
    const valid = v.get(GPS.valid) >= 0.5;
    const sats = Math.round(v.get(GPS.sats, valid ? 10 : 0));
    const cx = r.x + r.w / 2;
    const cy = r.y + 190;
    const R = Math.min(140, r.w / 2 - 20);
    circle(ctx, cx, cy, R, '', P.white, 1.5);
    circle(ctx, cx, cy, R / 2, '', P.white, 1);
    TF.draw(ctx, 'N', cx, cy - R - 12, 14, P.white, 'center', 'middle');
    // Satellite positions (EST: fixed pseudo-random constellation; the GPS model has no almanac).
    for (let i = 0; i < 12; i++) {
      const az = (i * 137.5 + 20) * DEG2RAD;
      const el = ((i * 53) % 80) / 90;
      const x = cx + Math.sin(az) * R * (1 - el);
      const y = cy - Math.cos(az) * R * (1 - el);
      const used = i < sats;
      box(ctx, x - 13, y - 9, 26, 18, used ? P.green : '', used ? P.green : P.white, 1.5, 9);
      TF.draw(ctx, fmtInt((i * 7) % 32 + 1), x, y + 1, 12, used ? '#000000' : P.white, 'center', 'middle');
    }
    const y0 = cy + R + 30;
    const rows: [string, string][] = [
      ['EPU', join2(fmtFixed(v.get(GPS.epuNm, 0.02), 2), 'NM')],
      ['SOLUTION', valid ? (v.get(GPS.sbas) >= 0.5 ? '3D DIFF NAV' : '3D NAV') : 'ACQUIRING'],
      ['SBAS', v.get(GPS.sbas) >= 0.5 ? 'ACTIVE' : 'INACTIVE'],
      ['POSITION', valid ? join2(join2(fmtLat(v.get(GPS.lat)), ' '), fmtLon(v.get(GPS.lon))) : '____'],
    ];
    rows.forEach(([k, val], i) => {
      TF.draw(ctx, k, r.x + 16, y0 + i * 28, 15, P.white, 'left', 'middle');
      TF.draw(ctx, val, r.x + r.w - 16, y0 + i * 28, 16, valid ? P.green : P.white, 'right', 'middle');
    });
  }
}

export class WeightFuelPane implements PaneContentView {
  constructor(private readonly sys: G3000System) {}
  update(_dt: number): void {}
  draw(ctx: Ctx2D, r: Rect): void {
    const wf = this.sys.wf;
    header(ctx, r, 'WEIGHT AND FUEL');
    const rows: [string, number, boolean][] = [
      ['BASIC OPERATING WT', wf.bowLb, false],
      ['CREW & STORES', wf.crewStoresLb, false],
      [join2(join2('PASSENGERS (', fmtInt(wf.pax)), ')'), wf.pax * wf.paxLb, false],
      ['CARGO', wf.cargoLb, false],
      ['ZERO FUEL WEIGHT', wf.zfwLb, wf.over('zfw')],
      ['FUEL ON BOARD', wf.fuelLb, false],
      ['GROSS WEIGHT', wf.grossLb, wf.over('gross')],
      ['FUEL RESERVES', wf.reserveLb, false],
      ['EST LANDING FUEL', wf.destFuelLb, false],
      ['EST LANDING WEIGHT', wf.landingLb, wf.over('landing')],
    ];
    rows.forEach(([k, val, over], i) => {
      const y = r.y + 54 + i * 34;
      TF.draw(ctx, k, r.x + 14, y, 16, P.white, 'left', 'middle');
      TF.draw(ctx, Number.isFinite(val) ? join2(fmtThousands(val), 'LB') : '_____LB', r.x + r.w - 14, y, 19, over ? P.amber : P.cyan, 'right', 'middle');
    });
  }
}

export class ToldPane implements PaneContentView {
  constructor(private readonly sys: G3000System) {}
  update(_dt: number): void {}
  draw(ctx: Ctx2D, r: Rect): void {
    const t = this.sys.told;
    header(ctx, r, 'PERFORMANCE');
    let y = r.y + 54;
    const put = (k: string, val: string, col: string = P.cyan): void => {
      TF.draw(ctx, k, r.x + 16, y, 16, P.white, 'left', 'middle');
      TF.draw(ctx, val, r.x + r.w - 16, y, 18, col, 'right', 'middle');
      y += 30;
    };
    const ti = t.inputs.takeoff;
    TF.draw(ctx, 'TAKEOFF', r.x + 16, y, 16, P.cyan, 'left', 'middle');
    y += 28;
    put('ORIGIN / RWY', ti.airport ? join2(join2(ti.airport, ' / '), ti.runway || '___') : '____');
    put('WEIGHT', join2(fmtThousands(ti.weightLb), 'LB'));
    put('FLAPS', ti.flaps || '__');
    const tr = t.takeoffResult;
    if (tr) {
      for (const [k, val] of Object.entries(tr.vspeeds)) put(k, join2(fmtInt(val), 'KT'), P.magenta);
      if (tr.n1Pct) put('TAKEOFF N1', join2(fmtFixed(tr.n1Pct, 1), '%'), P.magenta);
      if (tr.fieldLengthFt) put('FIELD LENGTH', join2(fmtThousands(tr.fieldLengthFt), 'FT'), P.magenta);
    }
    y += 10;
    const li = t.inputs.landing;
    TF.draw(ctx, 'LANDING', r.x + 16, y, 16, P.cyan, 'left', 'middle');
    y += 28;
    put('DEST / RWY', li.airport ? join2(join2(li.airport, ' / '), li.runway || '___') : '____');
    put('FLAPS', li.flaps || '__');
    const lr = t.landingResult;
    if (lr) for (const [k, val] of Object.entries(lr.vspeeds)) put(k, join2(fmtInt(val), 'KT'), P.magenta);
  }
}

export class ChartsPane implements PaneContentView {
  update(_dt: number): void {}
  draw(ctx: Ctx2D, r: Rect): void {
    // SCOPE: no chart database is bundled (Jeppesen ChartView / FliteCharts are licensed products).
    TF.draw(ctx, 'CHART NOT AVAILABLE', r.x + r.w / 2, r.y + r.h / 2 - 12, 20, P.white, 'center', 'middle');
    TF.draw(ctx, 'No chart database installed', r.x + r.w / 2, r.y + r.h / 2 + 16, 15, P.grey, 'center', 'middle');
  }
}

void (null as unknown as SimVars);
