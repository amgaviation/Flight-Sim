/**
 * CHARTS and EVS multifunction windows.
 *
 * CHARTS: the Global Vision offers optional electronic charts (FSB
 * BD-700-1A10 Rev 7 appendix 6: "Optional Integrated Flight Information
 * System (IFIS) ... Electronic Charts"). Licensed chart data is not
 * available to the simulator, so this window draws an airport diagram from
 * the navigation database instead (runways to scale, idents, lengths) with
 * own ship: SCOPE / EST substitute, documented as such.
 *
 * EVS: FSB appendix 6 "EVS Head-Down Display (HDD) can be presented on any
 * MFW". The infrared picture is simulated with the SVS terrain sampler in a
 * monochrome style limited to 8 nm (EST: IR range in clear air), with a
 * horizon line and heading scale; no thermal targets, no weather
 * attenuation (SCOPE).
 */
import type { SimVars } from '../../../core/SimVars';
import { ADC, FMS, GPS } from '../../../core/vars';
import type { NavDatabase, Airport } from '../../../nav/types';
import type { WorldQuery } from '../../../world/types';
import type { Fms } from '../../../nav/fms/Fms';
import { MovingMap } from '../../common/draw/MovingMap';
import type { Ctx2D } from '../../common/draw/context';
import type { ShownWindow } from '../logic/layout';
import { FUSION_VARS } from '../vars';
import { MAP_FUSION } from './map';
import { SyntheticVision } from './svs';
import { C, DEG, hstr, n360, rect, seg, txt } from './style';
import type { HotSpots, WindowRenderer } from './window';

export interface ChartOptions {
  vars: SimVars;
  nav: NavDatabase | null;
  fms: Fms | null;
}

export class ChartWindow implements WindowRenderer {
  readonly animated = true;
  readonly map: MovingMap;
  private airport: Airport | null = null;
  private lastPlanVer = -1;
  private lines: string[] = [];
  private title = '';
  /** 0 = automatic (origin on the ground, destination airborne), 1 = origin, 2 = destination. */
  select: 0 | 1 | 2 = 0;

  constructor(private readonly o: ChartOptions) {
    this.map = new MovingMap({ rect: { x: 0, y: 0, w: 512, h: 640 }, style: { ...MAP_FUSION, runwaysBelowNm: 12, rangeRings: 'none' }, nav: o.nav ?? undefined });
    this.map.setRange(2);
    const s = this.map.state;
    s.orientation = 'north-up';
    s.showFixes = false;
    s.showNavaids = false;
    s.showRoute = false;
    s.terrain = 'off';
  }

  private pickAirport(): Airport | null {
    const fms = this.o.fms;
    if (!fms) return null;
    const plan = fms.plans.active;
    const airborne = this.o.vars.get(GPS.gs) > 60;
    if (this.select === 1) return plan.origin;
    if (this.select === 2) return plan.destination;
    return airborne ? (plan.destination ?? plan.origin) : (plan.origin ?? plan.destination);
  }

  update(dt: number, w: ShownWindow): void {
    const v = this.o.vars;
    const r = w.rect;
    const m = this.map;
    m.rect.x = r.x;
    m.rect.y = r.y + 24;
    m.rect.w = r.w;
    m.rect.h = r.h - 84;
    m.ownX = r.x + r.w / 2;
    m.ownY = r.y + 24 + (r.h - 84) / 2;
    m.rangePx = Math.min(r.w, r.h - 84) / 2 - 10;
    const ver = v.get(FMS.planVersion);
    const ap = this.pickAirport();
    if (ap !== this.airport || ver !== this.lastPlanVer) {
      this.lastPlanVer = ver;
      this.airport = ap;
      this.lines = [];
      this.title = ap ? `${ap.icao}  AIRPORT DIAGRAM` : 'NO AIRPORT';
      if (ap) {
        const seen = new Set<string>();
        for (const rw of ap.runways) {
          if (seen.has(rw.oppositeIdent)) continue;
          seen.add(rw.ident);
          this.lines.push(`RWY ${rw.ident}/${rw.oppositeIdent}  ${Math.round(rw.lengthFt).toLocaleString('en-US')} x ${Math.round(rw.widthFt)} FT`);
        }
      }
    }
    const s = m.state;
    s.valid = v.getBool(GPS.valid);
    s.lat = v.get(GPS.lat);
    s.lon = v.get(GPS.lon);
    const ahrs = v.get(FUSION_VARS.ahrsSrc(w.owner), w.owner);
    s.heading = v.get(ADC.headingTrue(ahrs), v.get(GPS.trackTrue));
    s.track = v.get(GPS.trackTrue);
    s.gsKt = v.get(GPS.gs);
    s.panActive = ap !== null;
    if (ap) {
      s.panLat = ap.lat;
      s.panLon = ap.lon;
    }
    m.update(dt);
  }

  draw(ctx: Ctx2D, w: ShownWindow, hs: HotSpots): void {
    const r = w.rect;
    rect(ctx, r.x, r.y, r.w, r.h, C.bg);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y + 24, r.w, r.h - 84);
    ctx.clip();
    this.map.draw(ctx);
    ctx.restore();
    rect(ctx, r.x, r.y, r.w, 24, C.panel);
    txt(ctx, this.title, r.x + 8, r.y + 12, 14, C.white, 'left');
    txt(ctx, 'NAV DB', r.x + r.w - 8, r.y + 12, 11, C.grey, 'right');
    seg(ctx, r.x, r.y + r.h - 60, r.x + r.w, r.y + r.h - 60, C.line, 1);
    for (let i = 0; i < Math.min(3, this.lines.length); i++) txt(ctx, this.lines[i], r.x + 10, r.y + r.h - 46 + i * 18, 13, C.white, 'left');
    // ORIGIN / DEST selector hot spots.
    const bw = 64;
    rect(ctx, r.x + r.w - 2 * bw - 8, r.y + 28, bw, 22, C.panel, this.select === 1 ? C.cyan : C.line, 1.5);
    rect(ctx, r.x + r.w - bw - 4, r.y + 28, bw, 22, C.panel, this.select === 2 ? C.cyan : C.line, 1.5);
    txt(ctx, 'ORIG', r.x + r.w - 1.5 * bw - 8, r.y + 39, 12, C.white, 'center');
    txt(ctx, 'DEST', r.x + r.w - 0.5 * bw - 4, r.y + 39, 12, C.white, 'center');
    hs.add('chart:orig', r.x + r.w - 2 * bw - 8, r.y + 28, bw, 22);
    hs.add('chart:dest', r.x + r.w - bw - 4, r.y + 28, bw, 22);
  }

  enter(_side: 1 | 2, _w: ShownWindow, id: string): void {
    if (id === 'chart:orig') this.select = this.select === 1 ? 0 : 1;
    else if (id === 'chart:dest') this.select = this.select === 2 ? 0 : 2;
  }

  data(_side: 1 | 2, _w: ShownWindow, _id: string, steps: number): void {
    if (steps > 0) this.map.rangeUp();
    else this.map.rangeDown();
  }
}

// ------------------------------------------------------------------------ EVS

export interface EvsOptions {
  vars: SimVars;
  world: Pick<WorldQuery, 'elevationAt'> | null;
}

const EVS_FOV_DEG = 30; // EST horizontal field of view of the EVS camera picture

export class EvsWindow implements WindowRenderer {
  readonly animated = true;
  private readonly svs: SyntheticVision;
  private pitch = 0;
  private bank = 0;
  private hdgMag = 0;

  constructor(private readonly o: EvsOptions) {
    this.svs = new SyntheticVision(o.world);
  }

  update(dt: number, w: ShownWindow): void {
    const v = this.o.vars;
    const ahrs = v.get(FUSION_VARS.ahrsSrc(w.owner), w.owner);
    this.pitch = v.get(ADC.pitch(ahrs));
    this.bank = v.get(ADC.bank(ahrs));
    this.hdgMag = v.get(ADC.heading(ahrs));
    const pxPerDeg = w.rect.w / EVS_FOV_DEG;
    this.svs.setFov(w.rect.w, pxPerDeg);
    if (v.getBool(GPS.valid)) this.svs.update(dt, v.get(GPS.lat), v.get(GPS.lon), v.get(GPS.alt), v.get(ADC.headingTrue(ahrs), this.hdgMag + v.get(GPS.magVar)), 10);
  }

  draw(ctx: Ctx2D, w: ShownWindow, _hs: HotSpots): void {
    const r = w.rect;
    rect(ctx, r.x, r.y, r.w, r.h, '#101410');
    const pxPerDeg = r.w / EVS_FOV_DEG;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (this.svs.available && Number.isFinite(this.pitch)) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      this.svs.draw(ctx, r.x, r.y, r.w, r.h, cx, cy, pxPerDeg, this.pitch, this.bank, true, 8);
      // Horizon line.
      ctx.translate(cx, cy);
      ctx.rotate(-this.bank * DEG);
      seg(ctx, -r.w, this.pitch * pxPerDeg, r.w, this.pitch * pxPerDeg, 'rgba(230,255,230,0.8)', 1.5);
      ctx.restore();
    } else txt(ctx, 'EVS NOT AVAILABLE', cx, cy, 16, C.amber, 'center');
    // Heading scale along the top (every 5 deg).
    const hdg = this.hdgMag;
    if (Number.isFinite(hdg)) {
      for (let d = Math.ceil((hdg - EVS_FOV_DEG / 2) / 5) * 5; d <= hdg + EVS_FOV_DEG / 2; d += 5) {
        const x = cx + (d - hdg) * pxPerDeg;
        seg(ctx, x, r.y + 30, x, r.y + (d % 10 === 0 ? 42 : 36), C.white, 1.5);
        if (d % 10 === 0) txt(ctx, hstr(n360(d)), x, r.y + 52, 12, C.white, 'center');
      }
      seg(ctx, cx, r.y + 24, cx, r.y + 30, C.white, 2);
    }
    txt(ctx, 'EVS', r.x + 8, r.y + 14, 13, C.white, 'left');
    // Boresight cross.
    seg(ctx, cx - 12, cy, cx - 4, cy, C.white, 2);
    seg(ctx, cx + 4, cy, cx + 12, cy, C.white, 2);
    seg(ctx, cx, cy - 12, cx, cy - 4, C.white, 2);
  }
}
