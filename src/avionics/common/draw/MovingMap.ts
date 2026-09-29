/**
 * Moving map for MFDs, navigation displays, PFD inset maps and the 172
 * G1000 MFD: north-up / track-up / heading-up / DTK-up, range selection and
 * pan, terrain (TAWS relative, EGPWS, topo) from a cached raster, airports
 * with runway orientation (and scaled runways at short ranges), VOR/NDB/DME/
 * fix symbols, localizer feathers, flight-plan legs (active magenta, others
 * white, missed approach cyan) including arcs, holds and fly-by turns, range
 * rings, own-ship, track line, TOD marker, selected-altitude intercept arc,
 * TCAS traffic, a weather overlay hook and declutter levels.
 *
 * Data sources are structural so the map works with the real modules or
 * test doubles:
 *   nav:   Pick<NavDatabase, 'airportsNear' | 'navaidsNear' | 'fixesNear'>
 *   world: Pick<WorldQuery, 'elevationAt'>
 *   route: any array of { type, segment, geom: LegGeometry, fix? } (nav's PlanLeg)
 * Database queries are cached and refreshed only when the aircraft moved by
 * 15 % of the range, the range changed, or 5 s elapsed.
 *
 * Declutter levels (EST, modelled on the G1000 DCLTR softkey cycle):
 *   0 everything; 1 removes intersections and navaid idents;
 *   2 also removes navaids and small airports; 3 leaves only the route,
 *   own-ship, traffic and terrain.
 */
import { DEG2RAD, clamp } from '../../../core/math';
import { destinationPoint, distanceNm, initialBearing, intermediatePoint } from '../../../core/geo';
import type { Airport, Fix, NavDatabase, Navaid, NavaidType } from '../../../nav/types';
import type { LegGeometry } from '../../../nav/flightplan/types';
import type { WorldQuery } from '../../../world/types';
import { fmtFixed, fmtInt } from '../format';
import { BOEING_TYPEFACE, GARMIN_TYPEFACE, HONEYWELL_TYPEFACE, type Typeface } from '../fonts';
import { localToScreen, projectLocalNm, unprojectLocalNm, type LocalXY } from '../math';
import { BOEING_PALETTE, GARMIN_PALETTE, HONEYWELL_PALETTE, type AvionicsPalette } from '../palette';
import { DASH_MEDIUM, DASH_NONE, DASH_SHORT, box, circle, clipRect, type Ctx2D, type Rect } from './context';
import { drawAirportSymbol, drawLocalizerFeather, drawNavaidSymbol, drawOwnship, drawRunway, drawTrafficSymbol, type NavaidSymbolKind, type SymbolStyle, type TrafficLevel } from './mapSymbols';
import { TerrainRaster, type TerrainMode } from './TerrainRaster';

export type MapOrientation = 'north-up' | 'track-up' | 'heading-up' | 'dtk-up';

export interface MapStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  symbols: SymbolStyle;
  background: string;
  labelSize: number;
  /** Range rings: full circles, an arc ahead (ND), or none. */
  rangeRings: 'full' | 'arc' | 'none';
  ringColor: string;
  routeWidth: number;
  /** Scaled runway rectangles drawn at or below this range (nm). */
  runwaysBelowNm: number;
  /** Localizer feathers at or below this range (nm). */
  feathersBelowNm: number;
  /** Fixes drawn at or below this range (nm). */
  fixesBelowNm: number;
  /** Navaids drawn at or below this range (nm). */
  navaidsBelowNm: number;
  /** Small airports drawn at or below this range (nm). */
  smallAirportsBelowNm: number;
  /** Track line from own-ship ('none' to omit). */
  trackLine: 'garmin' | 'boeing' | 'none';
  /** Waypoint idents in the route: white, active magenta. */
  showRouteIdents: boolean;
  /** Traffic "other/proximate" colour. */
  trafficColor: string;
  /** Ordered range list for rangeUp/rangeDown (nm). */
  ranges: readonly number[];
}

export const MAP_GARMIN: MapStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  symbols: 'garmin',
  background: '#000000',
  labelSize: 15,
  rangeRings: 'full',
  ringColor: 'rgba(255,255,255,0.55)',
  routeWidth: 3,
  runwaysBelowNm: 5,
  feathersBelowNm: 30,
  fixesBelowNm: 30,
  navaidsBelowNm: 150,
  smallAirportsBelowNm: 30,
  trackLine: 'garmin',
  showRouteIdents: true,
  trafficColor: '#ffffff',
  // G1000 map ranges (PG 190-00494-04 §5: 500 ft .. 1000 nm); 500 ft ~ 0.08 nm.
  ranges: [0.25, 0.5, 0.75, 1, 1.5, 2.5, 4, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000],
};

export const MAP_BOEING: MapStyle = {
  palette: BOEING_PALETTE,
  typeface: BOEING_TYPEFACE,
  symbols: 'boeing',
  background: '#000000',
  labelSize: 15,
  rangeRings: 'arc',
  ringColor: '#ffffff',
  routeWidth: 3,
  runwaysBelowNm: 10,
  feathersBelowNm: 40,
  fixesBelowNm: 40,
  navaidsBelowNm: 160,
  smallAirportsBelowNm: 40,
  trackLine: 'boeing',
  showRouteIdents: true,
  trafficColor: '#00e8ff',
  // 737NG EFIS control panel range selector: 5..640 nm.
  ranges: [5, 10, 20, 40, 80, 160, 320, 640],
};

export const MAP_HONEYWELL: MapStyle = {
  ...MAP_GARMIN,
  palette: HONEYWELL_PALETTE,
  typeface: HONEYWELL_TYPEFACE,
  symbols: 'honeywell',
  rangeRings: 'arc',
  trafficColor: '#00e0ff',
  ranges: [1, 2, 5, 10, 25, 50, 100, 200, 300, 500, 1000], // EST: Primus Epic range set
};

/** One TCAS/TIS target. Fixed-capacity array in `MapState.traffic`. */
export interface TrafficTarget {
  active: boolean;
  lat: number;
  lon: number;
  relAltFt: number;
  vsFpm: number;
  level: TrafficLevel;
}

/** Minimal flight-plan leg the map draws (nav's PlanLeg satisfies it). */
export interface MapRouteLeg {
  readonly type: string;
  readonly segment: string;
  readonly geom: LegGeometry;
  readonly fix?: { readonly ident: string; readonly lat: number; readonly lon: number };
}

export interface MapState {
  valid: boolean;
  lat: number;
  lon: number;
  altFt: number;
  vsFpm: number;
  heading: number;
  track: number;
  gsKt: number;
  /** Desired track (deg true) for 'dtk-up'. */
  dtk: number;
  orientation: MapOrientation;
  /** Distance (nm) from own-ship to the range edge (`rangePx` pixels). */
  rangeNm: number;
  declutter: 0 | 1 | 2 | 3;
  terrain: TerrainMode;
  /** TAWS alert overlay 0/1/2 (see TerrainRaster). */
  tawsLevel: 0 | 1 | 2;
  gearDown: boolean;
  /** Aircraft on the ground: Garmin G3000/G5000 on-ground relative terrain legend (TerrainRaster.onGround). */
  onGround: boolean;
  /** Garmin G3000/G5000 in-air relative terrain legend green band -1000..-2000 ft (TerrainRaster.relativeGreenBand). */
  terrainGreenBand: boolean;
  /**
   * EGPWS terrain: elevation (ft MSL) of the runway nearest the aircraft, for the 400 ft runway blanking
   * (TerrainRaster.runwayElevFt). NaN = the nearest airport of the map's nav database.
   */
  runwayElevFt: number;
  showAirports: boolean;
  showNavaids: boolean;
  showFixes: boolean;
  showTraffic: boolean;
  showRoute: boolean;
  showRangeRings: boolean;
  /** Pan mode (map centred on panLat/panLon, north-up). */
  panActive: boolean;
  panLat: number;
  panLon: number;
  /** Distance from own-ship to top of descent along the route (nm), NaN = none. */
  todDistNm: number;
  /** Selected altitude for the intercept arc (NaN = none). */
  selAltFt: number;
  traffic: TrafficTarget[];
}

export function createMapState(trafficCapacity = 30): MapState {
  const traffic: TrafficTarget[] = [];
  for (let i = 0; i < trafficCapacity; i++) traffic.push({ active: false, lat: 0, lon: 0, relAltFt: 0, vsFpm: 0, level: 0 });
  return {
    valid: true,
    lat: 0,
    lon: 0,
    altFt: 0,
    vsFpm: 0,
    heading: 0,
    track: 0,
    gsKt: 0,
    dtk: 0,
    orientation: 'north-up',
    rangeNm: 10,
    declutter: 0,
    terrain: 'off',
    tawsLevel: 0,
    gearDown: false,
    onGround: false,
    terrainGreenBand: false,
    runwayElevFt: NaN,
    showAirports: true,
    showNavaids: true,
    showFixes: true,
    showTraffic: true,
    showRoute: true,
    showRangeRings: true,
    panActive: false,
    panLat: 0,
    panLon: 0,
    todDistNm: NaN,
    selAltFt: NaN,
    traffic,
  };
}

export interface MovingMapOptions {
  rect: Rect;
  style: MapStyle;
  /** Own-ship screen position (default: centre of rect). */
  ownX?: number;
  ownY?: number;
  /** Pixels from own-ship to the range edge (default: ownY - rect.y - 10). */
  rangePx?: number;
  nav?: Pick<NavDatabase, 'airportsNear' | 'navaidsNear' | 'fixesNear'>;
  world?: Pick<WorldQuery, 'elevationAt'>;
  /** Terrain raster resolution (cells per side). */
  terrainCells?: number;
  trafficCapacity?: number;
}

const NAVAID_TYPES: NavaidType[] = ['VOR', 'VORDME', 'VORTAC', 'TACAN', 'DME', 'NDB', 'NDBDME'];
const ARC_SEGMENTS = 24;

export class MovingMap {
  readonly state: MapState;
  rect: Rect;
  style: MapStyle;
  ownX: number;
  ownY: number;
  rangePx: number;
  readonly terrain: TerrainRaster | null;
  /** Called after terrain, before symbols: draw weather radar / datalink imagery. */
  weatherOverlay: ((ctx: Ctx2D, map: MovingMap) => void) | null = null;

  private readonly nav?: MovingMapOptions['nav'];
  private route: readonly MapRouteLeg[] | null = null;
  private activeLeg = -1;
  private airports: Airport[] = [];
  private navaids: Navaid[] = [];
  private fixes: Fix[] = [];
  private queryLat = NaN;
  private queryLon = NaN;
  private queryRange = 0;
  private queryAge = Infinity;
  // Projection state (updated each frame).
  private refLat = 0;
  private refLon = 0;
  private cosRef = 1;
  private upSin = 0;
  private upCos = 1;
  private upDeg = 0;
  private cx = 0;
  private cy = 0;
  private pxPerNm = 1;
  private readonly tmp: LocalXY = { x: 0, y: 0 };
  private readonly tmp2: LocalXY = { x: 0, y: 0 };
  private readonly ll = { lat: 0, lon: 0 };
  private readonly ll2 = { lat: 0, lon: 0 };
  // Hold geometry scratch points.
  private readonly hA = { lat: 0, lon: 0 };
  private readonly hC1 = { lat: 0, lon: 0 };
  private readonly hC2 = { lat: 0, lon: 0 };
  private readonly hO1 = { lat: 0, lon: 0 };
  private readonly hO2 = { lat: 0, lon: 0 };

  constructor(opts: MovingMapOptions) {
    this.rect = opts.rect;
    this.style = opts.style;
    this.ownX = opts.ownX ?? opts.rect.x + opts.rect.w / 2;
    this.ownY = opts.ownY ?? opts.rect.y + opts.rect.h / 2;
    this.rangePx = opts.rangePx ?? this.ownY - opts.rect.y - 10;
    this.nav = opts.nav;
    this.terrain = opts.world ? new TerrainRaster({ world: opts.world, size: opts.terrainCells ?? 128 }) : null;
    this.state = createMapState(opts.trafficCapacity ?? 30);
  }

  // ---------------------------------------------------------------- API

  /** Sets the flight plan legs to draw (nav PlanLeg[] works directly) and the active leg index. */
  setRoute(legs: readonly MapRouteLeg[] | null, activeIndex: number): void {
    this.route = legs;
    this.activeLeg = activeIndex;
  }

  setActiveLeg(index: number): void {
    this.activeLeg = index;
  }

  /** Sets the range to the nearest value in the style's range list. */
  setRange(nm: number): void {
    const r = this.style.ranges;
    let best = r[0];
    for (let i = 0; i < r.length; i++) if (Math.abs(r[i] - nm) < Math.abs(best - nm)) best = r[i];
    this.state.rangeNm = best;
  }

  /** Next larger / smaller range in the list. Returns the new range. */
  rangeUp(): number {
    const r = this.style.ranges;
    for (let i = 0; i < r.length; i++) if (r[i] > this.state.rangeNm + 1e-9) return (this.state.rangeNm = r[i]);
    return this.state.rangeNm;
  }

  rangeDown(): number {
    const r = this.style.ranges;
    for (let i = r.length - 1; i >= 0; i--) if (r[i] < this.state.rangeNm - 1e-9) return (this.state.rangeNm = r[i]);
    return this.state.rangeNm;
  }

  /** Starts/moves pan: shifts the map centre by screen pixels (joystick/cursor). */
  pan(dxPx: number, dyPx: number): void {
    const s = this.state;
    if (!s.panActive) {
      s.panActive = true;
      s.panLat = s.lat;
      s.panLon = s.lon;
    }
    // Pan is north-up: screen right = east, up = north.
    const cos = Math.max(0.01, Math.cos(s.panLat * DEG2RAD));
    s.panLat = clamp(s.panLat - dyPx / this.pxPerNmNow() / 60, -89, 89);
    s.panLon = wrapLon(s.panLon + dxPx / this.pxPerNmNow() / (60 * cos));
  }

  clearPan(): void {
    this.state.panActive = false;
  }

  /** Current screen pixels per nm. */
  pxPerNmNow(): number {
    return this.rangePx / Math.max(1e-6, this.state.rangeNm);
  }

  /** Map "up" bearing (deg true) for the current orientation. */
  upBearing(): number {
    const s = this.state;
    if (s.panActive) return 0;
    switch (s.orientation) {
      case 'track-up':
        return s.gsKt > 5 ? s.track : s.heading;
      case 'heading-up':
        return s.heading;
      case 'dtk-up':
        return s.dtk;
      default:
        return 0;
    }
  }

  /** Projects lat/lon to screen px (valid after or during draw). */
  project(lat: number, lon: number, out: LocalXY): LocalXY {
    projectLocalNm(lat, lon, this.refLat, this.refLon, this.cosRef, this.tmp2);
    return localToScreen(this.tmp2.x, this.tmp2.y, this.upSin, this.upCos, this.cx, this.cy, this.pxPerNm, out);
  }

  /** Screen px to lat/lon (for cursor/pan readouts). */
  unproject(x: number, y: number, out: { lat: number; lon: number }): { lat: number; lon: number } {
    const dx = (x - this.cx) / this.pxPerNm;
    const dy = -(y - this.cy) / this.pxPerNm;
    // Inverse rotation of localToScreen.
    const ex = dx * this.upCos + dy * this.upSin;
    const ny = -dx * this.upSin + dy * this.upCos;
    return unprojectLocalNm(ex, ny, this.refLat, this.refLon, this.cosRef, out);
  }

  update(dt: number): void {
    const s = this.state;
    this.queryAge += dt;
    this.prepareProjection();
    this.refreshQueries();
    if (this.terrain) {
      const t = this.terrain;
      t.mode = s.declutter >= 3 && s.terrain === 'topo' ? 'off' : s.terrain;
      t.alertLevel = s.tawsLevel;
      t.gearDown = s.gearDown;
      t.onGround = s.onGround;
      t.relativeGreenBand = s.terrainGreenBand;
      t.runwayElevFt = t.mode !== 'egpws' ? NaN : Number.isFinite(s.runwayElevFt) ? s.runwayElevFt : this.nearestRunwayElevFt(s.lat, s.lon);
      if (t.mode !== 'off') t.update(this.refLat, this.refLon, s.rangeNm, s.altFt, s.track);
    }
  }

  /**
   * Field elevation (ft) of the airport with runways nearest to (lat, lon) among the airports queried
   * around the map (NaN when none): the EGPWS "nearest runway elevation" (SCOPE: airport field
   * elevation stands in for the individual runway elevation). Allocation-free.
   */
  nearestRunwayElevFt(lat: number, lon: number): number {
    const list = this.airports;
    const cos = Math.cos(lat * DEG2RAD);
    let best = Infinity;
    let elev = NaN;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.type === 'heliport' || a.type === 'seaplane_base' || a.type === 'closed' || a.runways.length === 0) continue;
      const dy = a.lat - lat;
      let dx = a.lon - lon;
      if (dx > 180) dx -= 360;
      else if (dx < -180) dx += 360;
      dx *= cos;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        elev = a.elevationFt;
      }
    }
    return elev;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const r = this.rect;
    this.prepareProjection();
    clipRect(ctx, r.x, r.y, r.w, r.h);
    if (st.background) box(ctx, r.x, r.y, r.w, r.h, st.background, '');
    if (!s.valid) {
      st.typeface.draw(ctx, 'MAP - NO POSITION', r.x + r.w / 2, r.y + r.h / 2, 18, p.amber, 'center', 'middle');
      ctx.restore();
      return;
    }
    if (this.terrain && this.terrain.mode !== 'off') {
      const g = this.project(this.terrain.gridLat, this.terrain.gridLon, this.tmp);
      this.terrain.draw(ctx, g.x, g.y, this.pxPerNm, this.upDeg);
    }
    if (this.weatherOverlay) this.weatherOverlay(ctx, this);
    if (s.showRangeRings && st.rangeRings !== 'none') this.drawRangeRings(ctx);
    const d = s.declutter;
    if (s.showAirports && d < 3) this.drawAirports(ctx);
    if (s.showNavaids && d < 2 && s.rangeNm <= st.navaidsBelowNm) this.drawNavaids(ctx, d >= 1);
    if (s.showFixes && d < 1 && s.rangeNm <= st.fixesBelowNm) this.drawFixes(ctx);
    if (s.showRoute && this.route) this.drawRoute(ctx);
    if (Number.isFinite(s.todDistNm)) this.drawTod(ctx);
    if (Number.isFinite(s.selAltFt)) this.drawAltitudeArc(ctx);
    if (s.showTraffic) this.drawTraffic(ctx);
    this.drawOwnshipAndTrack(ctx);
    ctx.restore();
  }

  // ---------------------------------------------------------------- internals

  private prepareProjection(): void {
    const s = this.state;
    const pan = s.panActive;
    this.refLat = pan ? s.panLat : s.lat;
    this.refLon = pan ? s.panLon : s.lon;
    this.cosRef = Math.max(1e-6, Math.cos(this.refLat * DEG2RAD));
    this.upDeg = this.upBearing();
    this.upSin = Math.sin(this.upDeg * DEG2RAD);
    this.upCos = Math.cos(this.upDeg * DEG2RAD);
    this.cx = pan ? this.rect.x + this.rect.w / 2 : this.ownX;
    this.cy = pan ? this.rect.y + this.rect.h / 2 : this.ownY;
    this.pxPerNm = this.pxPerNmNow();
  }

  private refreshQueries(): void {
    const nav = this.nav;
    if (!nav) return;
    const s = this.state;
    const moved = Number.isNaN(this.queryLat) ? Infinity : distanceNm(this.queryLat, this.queryLon, this.refLat, this.refLon);
    if (moved < s.rangeNm * 0.15 && this.queryRange === s.rangeNm && this.queryAge < 5) return;
    const radius = s.rangeNm * 1.6 + 2;
    this.queryLat = this.refLat;
    this.queryLon = this.refLon;
    this.queryRange = s.rangeNm;
    this.queryAge = 0;
    this.airports = nav.airportsNear(this.refLat, this.refLon, radius, 250);
    this.navaids = s.rangeNm <= this.style.navaidsBelowNm ? nav.navaidsNear(this.refLat, this.refLon, radius, NAVAID_TYPES) : [];
    this.fixes = s.rangeNm <= this.style.fixesBelowNm ? nav.fixesNear(this.refLat, this.refLon, radius) : [];
  }

  private onScreen(x: number, y: number, margin = 20): boolean {
    const r = this.rect;
    return x >= r.x - margin && x <= r.x + r.w + margin && y >= r.y - margin && y <= r.y + r.h + margin;
  }

  private drawRangeRings(ctx: Ctx2D): void {
    const st = this.style;
    const s = this.state;
    const R = this.rangePx;
    ctx.beginPath();
    if (st.rangeRings === 'full') {
      ctx.arc(this.cx, this.cy, R / 2, 0, Math.PI * 2);
      ctx.moveTo(this.cx + R, this.cy);
      ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
    } else {
      ctx.arc(this.cx, this.cy, R / 2, -Math.PI / 2 - 0.9, -Math.PI / 2 + 0.9);
      ctx.moveTo(this.cx + R * Math.sin(-0.9), this.cy - R * Math.cos(0.9));
      ctx.arc(this.cx, this.cy, R, -Math.PI / 2 - 0.9, -Math.PI / 2 + 0.9);
    }
    ctx.setLineDash(st.rangeRings === 'arc' ? DASH_SHORT : DASH_NONE);
    ctx.strokeStyle = st.ringColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash(DASH_NONE);
    const half = s.rangeNm / 2;
    const txt = half < 1 ? fmtFixed(half, half < 0.5 ? 2 : 1) : fmtInt(half);
    st.typeface.draw(ctx, txt, this.cx - (R / 2) * 0.72, this.cy - (R / 2) * 0.72, 14, st.palette.white, 'center', 'middle', st.palette.black);
  }

  private drawAirports(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const s = this.state;
    const small = s.rangeNm <= st.smallAirportsBelowNm && s.declutter < 2;
    const pt = this.tmp;
    for (let i = 0; i < this.airports.length; i++) {
      const a = this.airports[i];
      const isSmall = a.type === 'small_airport' || a.type === 'heliport' || a.type === 'seaplane_base';
      if (isSmall && !small) continue;
      this.project(a.lat, a.lon, pt);
      if (!this.onScreen(pt.x, pt.y)) continue;
      const ax = pt.x;
      const ay = pt.y;
      // Longest runway orientation.
      let longest = -1;
      let hdg = NaN;
      let paved = false;
      for (let k = 0; k < a.runways.length; k++) {
        const rw = a.runways[k];
        if (rw.lengthFt > longest) {
          longest = rw.lengthFt;
          hdg = rw.headingTrue;
          paved = rw.surface === 'asphalt' || rw.surface === 'concrete';
        }
      }
      if (s.rangeNm <= st.runwaysBelowNm && a.runways.length > 0) {
        for (let k = 0; k < a.runways.length; k++) {
          const rw = a.runways[k];
          const opp = this.oppositeEnd(a, k);
          if (opp < k) continue; // draw each physical runway once
          const la0 = rw.lat;
          const lo0 = rw.lon;
          let la1: number;
          let lo1: number;
          if (opp >= 0) {
            la1 = a.runways[opp].lat;
            lo1 = a.runways[opp].lon;
          } else {
            const e = destinationPoint(la0, lo0, rw.headingTrue, rw.lengthFt / 6076.12, this.ll2);
            la1 = e.lat;
            lo1 = e.lon;
          }
          this.project(la0, lo0, this.tmp);
          const x0 = this.tmp.x;
          const y0 = this.tmp.y;
          this.project(la1, lo1, this.tmp);
          drawRunway(ctx, x0, y0, this.tmp.x, this.tmp.y, (rw.widthFt / 6076.12) * this.pxPerNm, p.grey, p.white);
          if (rw.ils && s.rangeNm <= st.feathersBelowNm && s.declutter < 2) {
            this.project(rw.lat, rw.lon, this.tmp);
            drawLocalizerFeather(ctx, this.tmp.x, this.tmp.y, (rw.ils.courseTrue - this.upDeg) * DEG2RAD, 5 * this.pxPerNm, p.green);
          }
        }
      } else {
        const kind = a.type === 'large_airport' || a.type === 'medium_airport' ? 'towered' : paved ? 'untowered' : 'soft';
        drawAirportSymbol(ctx, ax, ay, (hdg - this.upDeg) * DEG2RAD, kind, st.symbols, p);
        if (s.rangeNm <= st.feathersBelowNm && s.declutter < 2) {
          for (let k = 0; k < a.runways.length; k++) {
            const rw = a.runways[k];
            if (!rw.ils) continue;
            const tla = rw.thresholdLat ?? rw.lat;
            const tlo = rw.thresholdLon ?? rw.lon;
            this.project(tla, tlo, this.tmp);
            drawLocalizerFeather(ctx, this.tmp.x, this.tmp.y, (rw.ils.courseTrue - this.upDeg) * DEG2RAD, 7 * this.pxPerNm, p.green);
          }
        }
      }
      if (s.declutter < 2 || !isSmall) {
        st.typeface.draw(ctx, a.icao, ax + 10, ay + 12, st.labelSize, st.symbols === 'boeing' ? p.cyan : p.white, 'left', 'middle', p.black);
      }
    }
  }

  private oppositeEnd(a: Airport, k: number): number {
    const id = a.runways[k].oppositeIdent;
    for (let i = 0; i < a.runways.length; i++) if (i !== k && a.runways[i].ident === id) return i;
    return -1;
  }

  private drawNavaids(ctx: Ctx2D, noIdents: boolean): void {
    const st = this.style;
    const p = st.palette;
    const pt = this.tmp;
    for (let i = 0; i < this.navaids.length; i++) {
      const n = this.navaids[i];
      this.project(n.lat, n.lon, pt);
      if (!this.onScreen(pt.x, pt.y)) continue;
      const kind: NavaidSymbolKind = n.type === 'NDBDME' ? 'NDB' : (n.type as NavaidSymbolKind);
      drawNavaidSymbol(ctx, pt.x, pt.y, kind, st.symbols, p, 9);
      if (!noIdents) st.typeface.draw(ctx, n.ident, pt.x + 10, pt.y - 10, st.labelSize - 1, st.symbols === 'boeing' ? p.cyan : p.white, 'left', 'middle', p.black);
    }
  }

  private drawFixes(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const pt = this.tmp;
    for (let i = 0; i < this.fixes.length; i++) {
      const f = this.fixes[i];
      this.project(f.lat, f.lon, pt);
      if (!this.onScreen(pt.x, pt.y)) continue;
      drawNavaidSymbol(ctx, pt.x, pt.y, 'FIX', st.symbols, p, 7, st.symbols === 'boeing' ? p.cyan : p.grey);
      st.typeface.draw(ctx, f.ident, pt.x + 8, pt.y - 8, st.labelSize - 2, st.symbols === 'boeing' ? p.cyan : p.grey, 'left', 'middle', p.black);
    }
  }

  // ---------------------------------------------------------------- route

  private legColor(i: number, leg: MapRouteLeg): string {
    const p = this.style.palette;
    if (i === this.activeLeg) return p.fms;
    if (leg.segment === 'missed') return p.mapMissed;
    return p.mapRoute;
  }

  private drawRoute(ctx: Ctx2D): void {
    const legs = this.route!;
    const st = this.style;
    const p = st.palette;
    const first = Math.max(0, this.activeLeg);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      // Pass 0: inactive legs; pass 1: active leg on top.
      for (let i = first; i < legs.length; i++) {
        const isActive = i === this.activeLeg;
        if ((pass === 1) !== isActive) continue;
        const leg = legs[i];
        const g = leg.geom;
        if (!g.valid || g.kind === 'none') continue;
        const color = this.legColor(i, leg);
        ctx.beginPath();
        const prev = i > 0 ? legs[i - 1].geom : null;
        const startLat = prev && prev.valid && prev.turnValid ? prev.turnEndLat : g.startLat;
        const startLon = prev && prev.valid && prev.turnValid ? prev.turnEndLon : g.startLon;
        const endLat = g.turnValid ? g.turnStartLat : g.endLat;
        const endLon = g.turnValid ? g.turnStartLon : g.endLon;
        switch (g.kind) {
          case 'gc':
          case 'heading':
          case 'pt':
            this.pathGreatCircle(ctx, startLat, startLon, endLat, endLon, true);
            break;
          case 'arc':
            this.pathArc(ctx, g.centerLat, g.centerLon, g.radiusNm, g.startRadial, g.sweepDeg * g.turnDir, true);
            break;
          case 'hold':
            this.pathHold(ctx, g);
            break;
        }
        if (g.turnValid) this.pathTurn(ctx, g);
        ctx.setLineDash(g.kind === 'heading' ? DASH_MEDIUM : DASH_NONE);
        ctx.strokeStyle = p.black;
        ctx.lineWidth = st.routeWidth + 2;
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = st.routeWidth;
        ctx.stroke();
      }
    }
    ctx.setLineDash(DASH_NONE);
    // Waypoints and idents.
    if (!st.showRouteIdents) return;
    for (let i = first; i < legs.length; i++) {
      const leg = legs[i];
      if (!leg.fix || !leg.geom.valid) continue;
      this.project(leg.fix.lat, leg.fix.lon, this.tmp);
      if (!this.onScreen(this.tmp.x, this.tmp.y)) continue;
      const color = i === this.activeLeg ? p.fms : leg.segment === 'missed' ? p.mapMissed : p.white;
      drawNavaidSymbol(ctx, this.tmp.x, this.tmp.y, 'WPT', st.symbols, p, 7, color);
      st.typeface.draw(ctx, leg.fix.ident, this.tmp.x + 9, this.tmp.y - 9, st.labelSize, color, 'left', 'middle', p.black);
    }
  }

  /** Appends a great-circle polyline (subdivided every ~20 nm) to the current path. */
  private pathGreatCircle(ctx: Ctx2D, la0: number, lo0: number, la1: number, lo1: number, move: boolean): void {
    const d = distanceNm(la0, lo0, la1, lo1);
    const n = Math.max(1, Math.min(64, Math.ceil(d / 20)));
    for (let k = 0; k <= n; k++) {
      const q = n === 1 ? (k === 0 ? this.setLL(la0, lo0) : this.setLL(la1, lo1)) : intermediatePoint(la0, lo0, la1, lo1, k / n, this.ll);
      this.project(q.lat, q.lon, this.tmp);
      if (k === 0 && move) ctx.moveTo(this.tmp.x, this.tmp.y);
      else ctx.lineTo(this.tmp.x, this.tmp.y);
    }
  }

  private setLL(lat: number, lon: number): { lat: number; lon: number } {
    this.ll.lat = lat;
    this.ll.lon = lon;
    return this.ll;
  }

  /** Arc about a centre from `startRadial` sweeping `signedSweep` deg (+ clockwise). */
  private pathArc(ctx: Ctx2D, cla: number, clo: number, radiusNm: number, startRadial: number, signedSweep: number, move: boolean): void {
    const n = Math.max(4, Math.min(ARC_SEGMENTS * 2, Math.ceil(Math.abs(signedSweep) / 7.5)));
    for (let k = 0; k <= n; k++) {
      const brg = startRadial + (signedSweep * k) / n;
      const q = destinationPoint(cla, clo, brg, radiusNm, this.ll);
      this.project(q.lat, q.lon, this.tmp);
      if (k === 0 && move) ctx.moveTo(this.tmp.x, this.tmp.y);
      else ctx.lineTo(this.tmp.x, this.tmp.y);
    }
  }

  /** Fly-by turn arc from turnStart to turnEnd about the turn centre. */
  private pathTurn(ctx: Ctx2D, g: LegGeometry): void {
    const b0 = initialBearing(g.turnCenterLat, g.turnCenterLon, g.turnStartLat, g.turnStartLon);
    this.pathArc(ctx, g.turnCenterLat, g.turnCenterLon, g.turnRadiusNm, b0, g.turnAngleDeg, false);
  }

  /** Racetrack hold at the leg's fix (inbound course, leg length, turn radius, direction). */
  private pathHold(ctx: Ctx2D, g: LegGeometry): void {
    const c = g.holdInboundTrue;
    const dir = g.turnDir >= 0 ? 1 : -1;
    const R = g.radiusNm;
    const L = Math.max(g.holdLegNm, 0.5);
    const fLat = g.endLat;
    const fLon = g.endLon;
    // Inbound leg start A, turn centres C1 (at the fix) and C2 (at A), outbound offset 2R.
    const a = destinationPoint(fLat, fLon, c + 180, L, this.hA);
    const c1 = destinationPoint(fLat, fLon, c + 90 * dir, R, this.hC1);
    const c2 = destinationPoint(a.lat, a.lon, c + 90 * dir, R, this.hC2);
    this.pathGreatCircle(ctx, a.lat, a.lon, fLat, fLon, true);
    // Turn at the fix: from radial (c - 90 dir) through 180 deg.
    this.pathArc(ctx, c1.lat, c1.lon, R, c - 90 * dir, 180 * dir, false);
    const o1 = destinationPoint(fLat, fLon, c + 90 * dir, 2 * R, this.hO1);
    const o2 = destinationPoint(a.lat, a.lon, c + 90 * dir, 2 * R, this.hO2);
    this.pathGreatCircle(ctx, o1.lat, o1.lon, o2.lat, o2.lon, false);
    this.pathArc(ctx, c2.lat, c2.lon, R, c + 90 * dir, 180 * dir, false);
  }

  /** TOD marker: walks the route from own-ship `todDistNm` ahead. */
  private drawTod(ctx: Ctx2D): void {
    const s = this.state;
    const st = this.style;
    const p = st.palette;
    const legs = this.route;
    let remaining = s.todDistNm;
    if (!(remaining >= 0)) return;
    let fromLat = s.lat;
    let fromLon = s.lon;
    let found = false;
    if (legs) {
      for (let i = Math.max(0, this.activeLeg); i < legs.length; i++) {
        const g = legs[i].geom;
        if (!g.valid) continue;
        const d = distanceNm(fromLat, fromLon, g.endLat, g.endLon);
        if (remaining <= d) {
          const q = intermediatePoint(fromLat, fromLon, g.endLat, g.endLon, d > 0 ? remaining / d : 0, this.ll);
          fromLat = q.lat;
          fromLon = q.lon;
          found = true;
          break;
        }
        remaining -= d;
        fromLat = g.endLat;
        fromLon = g.endLon;
      }
    }
    if (!found) {
      const q = destinationPoint(s.lat, s.lon, s.track, s.todDistNm, this.ll);
      fromLat = q.lat;
      fromLon = q.lon;
    }
    this.project(fromLat, fromLon, this.tmp);
    if (!this.onScreen(this.tmp.x, this.tmp.y)) return;
    circle(ctx, this.tmp.x, this.tmp.y, 6, '', p.fms, 2.5);
    st.typeface.draw(ctx, 'TOD', this.tmp.x + 9, this.tmp.y, st.labelSize, p.fms, 'left', 'middle', p.black);
  }

  /** Selected-altitude intercept arc (G1000 PG §5 "Selected Altitude Intercept Arc"). */
  private drawAltitudeArc(ctx: Ctx2D): void {
    const s = this.state;
    const dAlt = s.selAltFt - s.altFt;
    if (Math.abs(dAlt) < 100 || Math.abs(s.vsFpm) < 100 || Math.sign(dAlt) !== Math.sign(s.vsFpm) || s.gsKt < 30) return;
    const minutes = dAlt / s.vsFpm;
    const distNm = (s.gsKt * minutes) / 60;
    const rPx = distNm * this.pxPerNm;
    if (rPx > this.rangePx * 1.5 || rPx < 4) return;
    const rel = (s.track - this.upDeg) * DEG2RAD;
    ctx.beginPath();
    ctx.arc(this.ownX, this.ownY, rPx, rel - Math.PI / 2 - 0.35, rel - Math.PI / 2 + 0.35);
    ctx.strokeStyle = this.style.palette.selected;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  private drawTraffic(ctx: Ctx2D): void {
    const st = this.style;
    const s = this.state;
    const t = s.traffic;
    for (let i = 0; i < t.length; i++) {
      const tg = t[i];
      if (!tg.active) continue;
      this.project(tg.lat, tg.lon, this.tmp);
      if (!this.onScreen(this.tmp.x, this.tmp.y, -4)) continue;
      drawTrafficSymbol(ctx, this.tmp.x, this.tmp.y, tg.level, tg.relAltFt, tg.vsFpm, st.palette, st.typeface, st.trafficColor);
    }
  }

  private drawOwnshipAndTrack(ctx: Ctx2D): void {
    const st = this.style;
    const s = this.state;
    const p = st.palette;
    this.project(s.lat, s.lon, this.tmp);
    const x = this.tmp.x;
    const y = this.tmp.y;
    if (!this.onScreen(x, y, 0)) return;
    if (st.trackLine !== 'none' && s.gsKt > 5 && !s.panActive) {
      const rel = (s.track - this.upDeg) * DEG2RAD;
      const len = this.rangePx;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len * Math.sin(rel), y - len * Math.cos(rel));
      ctx.strokeStyle = p.white;
      ctx.lineWidth = st.trackLine === 'garmin' ? 1.5 : 2;
      ctx.stroke();
      if (st.trackLine === 'boeing') {
        // Range marks at half and full range.
        for (let f = 0.5; f <= 1; f += 0.5) {
          const mx = x + len * f * Math.sin(rel);
          const my = y - len * f * Math.cos(rel);
          ctx.beginPath();
          ctx.moveTo(mx - 6 * Math.cos(rel), my - 6 * Math.sin(rel));
          ctx.lineTo(mx + 6 * Math.cos(rel), my + 6 * Math.sin(rel));
          ctx.stroke();
        }
      }
    }
    drawOwnship(ctx, x, y, (s.heading - this.upDeg) * DEG2RAD, st.symbols, p, 18);
    if (s.panActive) {
      // Pan cursor at the map centre.
      const cx = this.rect.x + this.rect.w / 2;
      const cy = this.rect.y + this.rect.h / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy);
      ctx.lineTo(cx + 12, cy);
      ctx.moveTo(cx, cy - 12);
      ctx.lineTo(cx, cy + 12);
      ctx.strokeStyle = p.white;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function wrapLon(lon: number): number {
  return lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon;
}
