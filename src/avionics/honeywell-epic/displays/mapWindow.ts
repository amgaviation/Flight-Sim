/**
 * Integrated navigation (INAV) map window, 2/3 or full format.
 *
 * Content (G650ER / G600 cockpit photographs; Honeywell INAV as used on
 * PlaneView): a menu bar across the top with "Map Data" and "Map View"
 * drop-down menus and range / layer buttons operated with the CCD cursor;
 * the moving map (heading / track / north up, arc or centred), terrain
 * (EGPWS colours), flight plan (active leg magenta), airports, navaids,
 * traffic; data blocks (ground speed / TAS / SAT upper left, next waypoint
 * upper right); and the vertical situation display (VSD) along the
 * current track at the bottom ("Vertical Situation Display (VSD)" is listed
 * in the G650 specification sheets). The CCD DATA knob over the map
 * changes the range.
 *
 * Weather radar layer (RDR-4000 class, radar controls on the TSC WEATHER
 * app / `epic.radar.*`): WX mode draws returns inside the +/-60 deg scan
 * sector, GMAP mode shows ground returns (topographic terrain picture),
 * OFF / STBY nothing. SCOPE: the sim has no discrete precipitation cells,
 * so the returns are procedural cells whose density and intensity follow
 * the weather model's precipitation / cloud cover (`env.precip`,
 * `env.cloud_cover`) and the radar gain; no attenuation, no tilt geometry.
 * No datalink graphical weather, no map panning, no charts.
 */
import { ADC, AP, FMS, GPS } from '../../../core/vars';
import { fmtFixed, fmtInt } from '../../common/format';
import { MovingMap } from '../../common/draw/MovingMap';
import { Hsi } from '../../common/draw/Hsi';
import type { Ctx2D } from '../../common/draw/context';
import { C, menuButton, rect, seg, text, textBold } from '../style';
import { EPIC_VARS, MapOverlay, MapUp, Win } from '../vars';
import { RANGES } from '../logic/controller';
import type { Hotspot } from '../logic/cursor';
import { EpicWindow, type EpicServices } from './window';
import { HSI_EPIC, MAP_EPIC } from './styles';
export { MAP_EPIC } from './styles';

const MENU_H = 34;
const VSD_H = 170;
const DATA_ITEMS = ['Airports', 'VOR / NDB', 'Intersections', 'Traffic', 'Terrain', 'Weather', 'VSD'] as const;
const DATA_IDS = ['map.d.apt', 'map.d.vor', 'map.d.fix', 'map.d.tfc', 'map.d.terr', 'map.d.wx', 'map.d.vsd'] as const;
const VIEW_ITEMS = ['Heading Up', 'Track Up', 'North Up', 'Centered', 'Arc'] as const;
const VIEW_IDS = ['map.v.hdg', 'map.v.trk', 'map.v.north', 'map.v.ctr', 'map.v.arc'] as const;
const BAR_IDS = ['map.data', 'map.view', 'map.rng-', 'map.rng+', 'map.wx', 'map.terr', 'map.tcas'] as const;
const VSD_SAMPLES = 64;
const WX_MAX_CELLS = 400;
/** Radar return colours (levels 1-3: green, yellow, red). */
const WX_COLORS = ['', 'rgba(20,200,40,0.85)', 'rgba(240,230,20,0.9)', 'rgba(240,30,30,0.95)'] as const;
const FT_PER_M = 3.28084;

export class MapWindow extends EpicWindow {
  readonly kind = Win.Map;
  private readonly map: MovingMap;
  private readonly hsi: Hsi;
  private readonly bar: Hotspot[] = [];
  private readonly dataSpots: Hotspot[] = [];
  private readonly viewSpots: Hotspot[] = [];
  private open: '' | 'data' | 'view' = '';
  private readonly vsdElev = new Float32Array(VSD_SAMPLES);
  private vsdTimer = 0;
  private vsdRangeNm = 10;
  private mapBottom = 0;
  // Weather returns cache (rebuilt at 1 Hz): lat, lon, radius nm, level.
  private readonly wxLat = new Float64Array(WX_MAX_CELLS);
  private readonly wxLon = new Float64Array(WX_MAX_CELLS);
  private readonly wxR = new Float32Array(WX_MAX_CELLS);
  private readonly wxLvl = new Uint8Array(WX_MAX_CELLS);
  private wxCount = 0;
  private wxTimer = 0;
  private readonly wxPt = { x: 0, y: 0 };

  constructor(svc: EpicServices, du: number, side: 1 | 2) {
    super(svc, du, side);
    this.map = new MovingMap({ rect: { x: 0, y: 0, w: 10, h: 10 }, style: MAP_EPIC, nav: svc.nav ?? undefined, world: svc.world ?? undefined, terrainCells: 128 });
    this.map.state.showRangeRings = false;
    this.hsi = new Hsi({ cx: 0, cy: 0, radius: 100, style: HSI_EPIC, mode: 'arc', arcSpanDeg: 90 });
    this.hsi.state.courseVisible = false;
    this.map.weatherOverlay = (ctx) => this.drawWeather(ctx);
    this.animating = true;
  }

  protected override onLayout(): void {
    this.hotspots.length = 0;
    this.bar.length = 0;
    this.dataSpots.length = 0;
    this.viewSpots.length = 0;
    const { x, y, w } = this;
    // Menu bar: Map Data, Map View, range -/+, WX, TERR, TCAS.
    const widths = [118, 118, 36, 36, 52, 60, 60];
    let bx = x + 6;
    for (let i = 0; i < BAR_IDS.length; i++) {
      if (i === 2) bx += 60; // range readout between the buttons
      if (i === 3) bx += 0;
      this.bar.push(this.spot(BAR_IDS[i], bx, y + 3, widths[i], MENU_H - 6));
      bx += widths[i] + (i === 2 ? 58 : 6);
    }
    for (let i = 0; i < DATA_IDS.length; i++) this.dataSpots.push(this.spot(DATA_IDS[i], x + 6, y + MENU_H + 2 + i * 30, 170, 28));
    for (let i = 0; i < VIEW_IDS.length; i++) this.viewSpots.push(this.spot(VIEW_IDS[i], x + 130, y + MENU_H + 2 + i * 30, 150, 28));
    this.spot('map.area', x, y + MENU_H, w, this.h - MENU_H);
    this.relayoutMap();
  }

  private relayoutMap(): void {
    const v = this.vars;
    const side = this.side;
    const vsd = v.get(EPIC_VARS.mapVsd(side)) !== 0;
    const top = this.y + MENU_H;
    this.mapBottom = this.y + this.h - (vsd ? VSD_H : 0);
    const r = this.map.rect;
    r.x = this.x;
    r.y = top;
    r.w = this.w;
    r.h = this.mapBottom - top;
    const centered = v.get(EPIC_VARS.mapCentered(side)) !== 0;
    this.map.ownX = this.x + this.w / 2;
    this.map.ownY = centered ? top + r.h / 2 : this.mapBottom - 40;
    this.map.rangePx = centered ? r.h / 2 - 30 : Math.min(r.h - 110, r.w * 0.47);
    this.hsi.cx = this.map.ownX;
    this.hsi.cy = this.map.ownY;
    this.hsi.radius = this.map.rangePx;
    this.hsi.mode = centered ? 'rose' : 'arc';
  }

  override enter(_side: 1 | 2, id: string): void {
    const v = this.vars;
    const s = this.side;
    const toggle = (n: string): void => v.set(n, v.get(n) !== 0 ? 0 : 1);
    if (this.open === 'data') {
      const i = DATA_IDS.indexOf(id as (typeof DATA_IDS)[number]);
      if (i >= 0) {
        if (i === 0) toggle(EPIC_VARS.mapShowAirports(s));
        else if (i === 1) toggle(EPIC_VARS.mapShowNavaids(s));
        else if (i === 2) toggle(EPIC_VARS.mapShowFixes(s));
        else if (i === 3) toggle(EPIC_VARS.mapShowTraffic(s));
        else if (i === 4) this.overlay(MapOverlay.Terrain);
        else if (i === 5) this.overlay(MapOverlay.Weather);
        else if (i === 6) {
          toggle(EPIC_VARS.mapVsd(s));
          this.relayoutMap();
        }
        return;
      }
    }
    if (this.open === 'view') {
      const i = VIEW_IDS.indexOf(id as (typeof VIEW_IDS)[number]);
      if (i >= 0) {
        if (i <= 2) v.set(EPIC_VARS.mapUp(s), i === 0 ? MapUp.Heading : i === 1 ? MapUp.Track : MapUp.North);
        else v.set(EPIC_VARS.mapCentered(s), i === 3 ? 1 : 0);
        this.relayoutMap();
        this.open = '';
        return;
      }
    }
    switch (id) {
      case 'map.data':
        this.open = this.open === 'data' ? '' : 'data';
        return;
      case 'map.view':
        this.open = this.open === 'view' ? '' : 'view';
        return;
      case 'map.rng-':
        this.stepRange(-1);
        break;
      case 'map.rng+':
        this.stepRange(1);
        break;
      case 'map.wx':
        this.overlay(MapOverlay.Weather);
        break;
      case 'map.terr':
        this.overlay(MapOverlay.Terrain);
        break;
      case 'map.tcas':
        toggle(EPIC_VARS.mapShowTraffic(s));
        break;
      default:
        break;
    }
    this.open = '';
  }

  override data(_side: 1 | 2, _id: string, steps: number): void {
    this.stepRange(Math.sign(steps));
  }

  private overlay(o: MapOverlay): void {
    const n = EPIC_VARS.mapOverlay(this.side);
    this.vars.set(n, this.vars.get(n) === o ? MapOverlay.Off : o);
  }

  private stepRange(d: number): void {
    const n = EPIC_VARS.mapRange(this.side);
    const cur = this.vars.get(n, 10);
    let i = RANGES.indexOf(cur);
    if (i < 0) i = Math.max(0, RANGES.findIndex((r) => r >= cur));
    this.vars.set(n, RANGES[Math.max(0, Math.min(RANGES.length - 1, i + d))]);
  }

  override update(dt: number): void {
    const v = this.vars;
    const side = this.side;
    const m = this.map.state;
    const vsdOn = v.get(EPIC_VARS.mapVsd(side)) !== 0;
    const centered = v.get(EPIC_VARS.mapCentered(side)) !== 0;
    if (vsdOn !== this.mapBottom < this.y + this.h - 1 || centered !== (this.hsi.mode === 'rose')) this.relayoutMap();
    m.valid = v.get(GPS.valid, 1) !== 0;
    m.lat = v.get(GPS.lat);
    m.lon = v.get(GPS.lon);
    const adc = v.get(EPIC_VARS.adcSel(side), side) || side;
    m.altFt = v.get(ADC.baroAlt(adc));
    m.vsFpm = v.get(ADC.vs(adc));
    const ahrs = v.get(EPIC_VARS.ahrsSel(side), side) || side;
    m.heading = v.get(ADC.headingTrue(ahrs));
    m.track = v.get(GPS.trackTrue);
    m.gsKt = v.get(GPS.gs);
    const up = v.get(EPIC_VARS.mapUp(side));
    m.orientation = up === MapUp.North ? 'north-up' : up === MapUp.Track ? 'track-up' : 'heading-up';
    const range = v.get(EPIC_VARS.mapRange(side), 10) || 10;
    // The range is the distance to the arc (arc format) or to the edge (centred).
    m.rangeNm = range;
    const ov = v.get(EPIC_VARS.mapOverlay(side));
    const radar = v.get(EPIC_VARS.radarMode);
    m.terrain = ov === MapOverlay.Terrain ? 'egpws' : ov === MapOverlay.Weather && radar === 3 ? 'topo' : 'off';
    if (ov === MapOverlay.Weather && radar === 2) {
      this.wxTimer -= dt;
      if (this.wxTimer <= 0) {
        this.wxTimer = 1;
        this.buildWeather(m.lat, m.lon, v.get(EPIC_VARS.mapRange(side), 10) || 10);
      }
    }
    m.tawsLevel = v.get('alert.taws_warning') !== 0 ? 2 : v.get('alert.taws_caution') !== 0 ? 1 : 0;
    m.gearDown = v.get('gear.pos0', 1) > 0.5;
    m.showAirports = v.get(EPIC_VARS.mapShowAirports(side)) !== 0;
    m.showNavaids = v.get(EPIC_VARS.mapShowNavaids(side)) !== 0;
    m.showFixes = v.get(EPIC_VARS.mapShowFixes(side)) !== 0;
    m.showTraffic = v.get(EPIC_VARS.mapShowTraffic(side)) !== 0;
    m.todDistNm = v.get(FMS.todDistNm) > 0 ? v.get(FMS.todDistNm) : NaN;
    m.selAltFt = v.get(AP.selAltitude);
    const plan = this.svc.fms?.plans.displayed ?? null;
    this.map.setRoute(plan ? plan.legs : null, v.get(FMS.activeLegIndex));
    this.map.update(dt);
    // Compass overlay follows the map orientation (magnetic card).
    const h = this.hsi.state;
    const hdgMag = v.get(ADC.heading(ahrs));
    const magVar = m.heading - hdgMag;
    h.heading = up === MapUp.North ? magVar < 0 ? -magVar : 360 - magVar : up === MapUp.Track ? v.get(GPS.trackMag) : hdgMag;
    h.selectedHeading = up === MapUp.Heading ? v.get(AP.selHeading) : NaN;
    h.track = NaN;
    h.valid = true;
    // VSD terrain profile along the track (2 Hz).
    this.vsdTimer -= dt;
    if (vsdOn && this.vsdTimer <= 0 && this.svc.world && m.valid) {
      this.vsdTimer = 0.5;
      this.vsdRangeNm = range;
      const trk = (Number.isFinite(m.track) && m.gsKt > 30 ? m.track : m.heading) * (Math.PI / 180);
      const cosLat = Math.max(0.05, Math.cos(m.lat * (Math.PI / 180)));
      for (let i = 0; i < VSD_SAMPLES; i++) {
        const d = (range * i) / (VSD_SAMPLES - 1);
        // Widest terrain over a +/- 1 nm corridor (EST corridor width).
        let e = -1e9;
        for (let c = -1; c <= 1; c++) {
          const la = m.lat + (d * Math.cos(trk) + c * Math.cos(trk + Math.PI / 2)) / 60;
          const lo = m.lon + (d * Math.sin(trk) + c * Math.sin(trk + Math.PI / 2)) / (60 * cosLat);
          e = Math.max(e, this.svc.world.elevationAt(la, lo) * FT_PER_M);
        }
        this.vsdElev[i] = e;
      }
    }
  }

  /** Procedural precipitation cells around the aircraft (see file header SCOPE). */
  private buildWeather(lat: number, lon: number, rangeNm: number): void {
    const v = this.vars;
    const precip = Math.max(0, Math.min(1, v.get('env.precip')));
    const cover = Math.max(0, Math.min(1, v.get('env.cloud_cover')));
    const gain = v.get(EPIC_VARS.radarGain);
    this.wxCount = 0;
    if (precip < 0.02 || !Number.isFinite(lat)) return;
    // Storm systems on a grid scaled with the range; each system is a cluster of blobs (EST look).
    const spacingDeg = Math.max(0.12, Math.min(2, rangeNm / 60 / 4));
    const span = rangeNm / 60 + spacingDeg;
    const i0 = Math.floor((lat - span) / spacingDeg);
    const i1 = Math.ceil((lat + span) / spacingDeg);
    const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    const j0 = Math.floor((lon - span / cosLat) / spacingDeg);
    const j1 = Math.ceil((lon + span / cosLat) / spacingDeg);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const h1 = hash(i, j);
        if (h1 > precip * (0.25 + 0.35 * cover)) continue;
        const h2 = hash(j + 17, i - 5);
        const blobs = 3 + Math.floor(h2 * 4);
        const cLat = (i + 0.5) * spacingDeg;
        const cLon = (j + 0.5) * spacingDeg;
        for (let b = 0; b < blobs; b++) {
          if (this.wxCount >= WX_MAX_CELLS) return;
          const hb = hash(i * 13 + b * 7, j * 5 - b * 3);
          const hc = hash(j * 11 - b, i * 3 + b * 17);
          const k = this.wxCount++;
          this.wxLat[k] = cLat + (hb - 0.5) * spacingDeg * 0.7;
          this.wxLon[k] = cLon + ((hc - 0.5) * spacingDeg * 0.7) / cosLat;
          this.wxR[k] = spacingDeg * 60 * (0.12 + 0.18 * hc) * (0.7 + 0.5 * cover);
          const inten = precip * (0.5 + 0.9 * hb * h2) * (1 + 0.08 * gain);
          this.wxLvl[k] = inten > 0.7 ? 3 : inten > 0.42 ? 2 : 1;
        }
      }
    }
  }

  private drawWeather(ctx: Ctx2D): void {
    const v = this.vars;
    if (v.get(EPIC_VARS.mapOverlay(this.side)) !== MapOverlay.Weather || v.get(EPIC_VARS.radarMode) !== 2) return;
    const m = this.map.state;
    const px = this.map.pxPerNmNow();
    const hdg = m.heading;
    const cosLat = Math.max(0.1, Math.cos((m.lat * Math.PI) / 180));
    // Scan sector outline (+/-60 deg).
    const up = this.map.upBearing();
    ctx.strokeStyle = 'rgba(40,200,60,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of SECTOR) {
      const a = ((hdg + d - up) * Math.PI) / 180;
      ctx.moveTo(this.map.ownX, this.map.ownY);
      ctx.lineTo(this.map.ownX + Math.sin(a) * this.map.rangePx, this.map.ownY - Math.cos(a) * this.map.rangePx);
    }
    ctx.stroke();
    for (let lvl = 1; lvl <= 3; lvl++) {
      ctx.fillStyle = WX_COLORS[lvl];
      ctx.beginPath();
      for (let k = 0; k < this.wxCount; k++) {
        if (this.wxLvl[k] < lvl) continue;
        const dy = (this.wxLat[k] - m.lat) * 60;
        const dx = (this.wxLon[k] - m.lon) * 60 * cosLat;
        const brg = (Math.atan2(dx, dy) * 180) / Math.PI;
        let rel = brg - hdg;
        rel = ((rel % 360) + 540) % 360 - 180;
        if (Math.abs(rel) > 60) continue;
        const r = this.wxR[k] * (lvl === 1 ? 1 : lvl === 2 ? 0.6 : 0.3) * px;
        const p = this.map.project(this.wxLat[k], this.wxLon[k], this.wxPt);
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, Math.max(1, r), 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  draw(ctx: Ctx2D): void {
    const v = this.vars;
    const side = this.side;
    this.frame(ctx, C.black);
    this.map.draw(ctx);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x, this.y + MENU_H, this.w, this.mapBottom - this.y - MENU_H);
    ctx.clip();
    this.hsi.draw(ctx);
    ctx.restore();
    this.drawDataBlocks(ctx);
    if (v.get(EPIC_VARS.mapVsd(side)) !== 0) this.drawVsd(ctx);
    this.drawMenuBar(ctx);
  }

  private drawDataBlocks(ctx: Ctx2D): void {
    const v = this.vars;
    const side = this.side;
    const x = this.x + 10;
    let y = this.y + MENU_H + 18;
    const adc = v.get(EPIC_VARS.adcSel(side), side) || side;
    text(ctx, 'GS', x, y, 14, C.white, 'left', 'middle');
    textBold(ctx, fmtInt(v.get(GPS.gs)), x + 32, y, 17, C.green, 'left', 'middle');
    text(ctx, 'TAS', x + 84, y, 14, C.white, 'left', 'middle');
    textBold(ctx, fmtInt(v.get(ADC.tas(adc))), x + 118, y, 17, C.green, 'left', 'middle');
    y += 22;
    text(ctx, 'SAT', x, y, 14, C.white, 'left', 'middle');
    textBold(ctx, `${fmtInt(v.get(ADC.sat(adc)))}°C`, x + 36, y, 17, C.green, 'left', 'middle');
    y += 22;
    const range = v.get(EPIC_VARS.mapRange(side), 10);
    text(ctx, 'RNG', x, y, 14, C.white, 'left', 'middle');
    textBold(ctx, fmtInt(range), x + 40, y, 17, C.cyan, 'left', 'middle');
    const ov = v.get(EPIC_VARS.mapOverlay(side));
    if (ov === MapOverlay.Terrain) textBold(ctx, 'TERR', x, y + 22, 15, C.green, 'left', 'middle');
    else if (ov === MapOverlay.Weather) {
      const tilt = v.get(EPIC_VARS.radarTilt);
      const mode = RADAR_MODES[v.get(EPIC_VARS.radarMode)] ?? 'OFF';
      textBold(ctx, `${mode} ${tilt >= 0 ? '+' : ''}${fmtFixed(tilt, 1)}°`, x, y + 22, 15, mode === 'OFF' || mode === 'STBY' ? C.amber : C.green, 'left', 'middle');
    }
    if (v.get(EPIC_VARS.mapShowTraffic(side)) !== 0) text(ctx, v.getString('tcas.status') || 'TCAS', x, y + 44, 14, C.cyan, 'left', 'middle');
    // Next waypoint (upper right).
    const rx = this.x + this.w - 10;
    let ry = this.y + MENU_H + 18;
    const id = v.getString(FMS.nextWptIdent);
    if (id && v.get(FMS.lnavValid) !== 0) {
      textBold(ctx, id, rx, ry, 18, C.magenta, 'right', 'middle');
      ry += 22;
      const dtk = v.get(FMS.dtkMag);
      text(ctx, `${fmtInt(((Math.round(dtk) % 360) + 360) % 360 || 360)}°`, rx, ry, 16, C.magenta, 'right', 'middle');
      ry += 20;
      const d = v.get(FMS.distToWptNm);
      text(ctx, `${d < 100 ? fmtFixed(d, 1) : fmtInt(d)} NM`, rx, ry, 16, C.white, 'right', 'middle');
      ry += 20;
      const ete = v.get(FMS.eteToWptS);
      if (Number.isFinite(ete) && ete > 0) text(ctx, `${Math.floor(ete / 3600)}+${Math.floor((ete % 3600) / 60).toString().padStart(2, '0')}`, rx, ry, 16, C.white, 'right', 'middle');
    }
  }

  /** Vertical situation display: terrain profile, own altitude, selected altitude, VNAV target. */
  private drawVsd(ctx: Ctx2D): void {
    const v = this.vars;
    const x0 = this.x;
    const y0 = this.mapBottom;
    const w = this.w;
    const h = this.y + this.h - y0;
    rect(ctx, x0, y0, w, h, '#050a12', '');
    seg(ctx, x0, y0, x0 + w, y0, C.winLine, 1);
    const side = this.side;
    const adc = v.get(EPIC_VARS.adcSel(side), side) || side;
    const alt = v.get(ADC.baroAlt(adc));
    // Vertical scale: +/- span around the aircraft (EST: range dependent 2000..20000 ft).
    const span = Math.max(2000, Math.min(24000, this.vsdRangeNm * 400));
    const lo = Math.max(-1000, alt - span * 0.55);
    const hi = lo + span;
    const px0 = x0 + 64;
    const pw = w - 74;
    const ph = h - 24;
    const py0 = y0 + 10;
    const yOf = (ft: number): number => py0 + ph - ((ft - lo) / (hi - lo)) * ph;
    // Altitude labels.
    const step = span > 10000 ? 5000 : span > 4000 ? 2000 : 1000;
    for (let a = Math.ceil(lo / step) * step; a <= hi; a += step) {
      const yy = yOf(a);
      seg(ctx, px0 - 4, yy, px0 + pw, yy, 'rgba(255,255,255,0.12)', 1);
      text(ctx, fmtInt(a), px0 - 8, yy, 13, C.white, 'right', 'middle');
    }
    // Terrain.
    ctx.beginPath();
    ctx.moveTo(px0, py0 + ph);
    for (let i = 0; i < VSD_SAMPLES; i++) ctx.lineTo(px0 + (pw * i) / (VSD_SAMPLES - 1), Math.max(py0, Math.min(py0 + ph, yOf(this.vsdElev[i]))));
    ctx.lineTo(px0 + pw, py0 + ph);
    ctx.closePath();
    ctx.fillStyle = '#7a4d1f';
    ctx.fill();
    // Selected altitude (cyan dashed) and VNAV target (magenta).
    const sel = v.get(AP.selAltitude);
    if (sel >= lo && sel <= hi) {
      ctx.setLineDash(DASH);
      seg(ctx, px0, yOf(sel), px0 + pw, yOf(sel), C.cyan, 2);
      ctx.setLineDash(NODASH);
    }
    const vt = v.get(FMS.vnavTargetAltFt);
    if (v.get(FMS.vnavValid) !== 0 && vt >= lo && vt <= hi) seg(ctx, px0 + pw * 0.2, yOf(vt), px0 + pw, yOf(vt), C.magenta, 2);
    // Flight path projection from the vertical speed.
    const gs = Math.max(60, v.get(GPS.gs));
    const vs = v.get(ADC.vs(adc));
    const endAlt = alt + (vs * (this.vsdRangeNm / gs)) * 60;
    seg(ctx, px0, yOf(alt), px0 + pw, yOf(endAlt), C.white, 1.5);
    // Own aircraft symbol (side view).
    const ay = yOf(alt);
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.moveTo(px0 + 12, ay);
    ctx.lineTo(px0 - 8, ay - 7);
    ctx.lineTo(px0 - 8, ay + 7);
    ctx.closePath();
    ctx.fill();
    // Distance labels.
    for (let k = 1; k <= 4; k++) {
      const xx = px0 + (pw * k) / 4;
      seg(ctx, xx, py0 + ph, xx, py0 + ph + 5, C.white, 1);
      const d = (this.vsdRangeNm * k) / 4;
      text(ctx, fmtFixed(d, Number.isInteger(d) ? 0 : 1), xx, py0 + ph + 12, 12, C.white, 'center', 'middle');
    }
  }

  private drawMenuBar(ctx: Ctx2D): void {
    const v = this.vars;
    const side = this.side;
    rect(ctx, this.x, this.y, this.w, MENU_H, C.menuFill, '');
    seg(ctx, this.x, this.y + MENU_H, this.x + this.w, this.y + MENU_H, C.winLine, 1);
    const ov = v.get(EPIC_VARS.mapOverlay(side));
    for (let i = 0; i < this.bar.length; i++) {
      const s = this.bar[i];
      const hi = this.hover === s.id;
      switch (i) {
        case 0:
          menuButton(ctx, s.x, s.y, s.w, s.h, 'Map Data', hi, this.open === 'data', true);
          break;
        case 1:
          menuButton(ctx, s.x, s.y, s.w, s.h, 'Map View', hi, this.open === 'view', true);
          break;
        case 2:
          menuButton(ctx, s.x, s.y, s.w, s.h, '-', hi);
          textBold(ctx, fmtInt(v.get(EPIC_VARS.mapRange(side), 10)), s.x + s.w + 32, s.y + s.h / 2 + 1, 17, C.cyan, 'center', 'middle');
          break;
        case 3:
          menuButton(ctx, s.x, s.y, s.w, s.h, '+', hi);
          break;
        case 4:
          menuButton(ctx, s.x, s.y, s.w, s.h, 'WX', hi, ov === MapOverlay.Weather);
          break;
        case 5:
          menuButton(ctx, s.x, s.y, s.w, s.h, 'TERR', hi, ov === MapOverlay.Terrain);
          break;
        case 6:
          menuButton(ctx, s.x, s.y, s.w, s.h, 'TCAS', hi, v.get(EPIC_VARS.mapShowTraffic(side)) !== 0);
          break;
      }
    }
    if (this.open === 'data') {
      const last = this.dataSpots[this.dataSpots.length - 1];
      rect(ctx, this.x + 2, this.y + MENU_H, 178, last.y + last.h + 4 - this.y - MENU_H, C.menuFill, C.white, 1);
      for (let i = 0; i < this.dataSpots.length; i++) {
        const s = this.dataSpots[i];
        const on = this.dataOn(i);
        menuButton(ctx, s.x, s.y, s.w, s.h, DATA_ITEMS[i], this.hover === s.id, on, false, 14);
      }
    } else if (this.open === 'view') {
      const last = this.viewSpots[this.viewSpots.length - 1];
      rect(ctx, this.x + 126, this.y + MENU_H, 158, last.y + last.h + 4 - this.y - MENU_H, C.menuFill, C.white, 1);
      const up = v.get(EPIC_VARS.mapUp(side));
      const ctr = v.get(EPIC_VARS.mapCentered(side)) !== 0;
      for (let i = 0; i < this.viewSpots.length; i++) {
        const s = this.viewSpots[i];
        const on = i === 0 ? up === MapUp.Heading : i === 1 ? up === MapUp.Track : i === 2 ? up === MapUp.North : i === 3 ? ctr : !ctr;
        menuButton(ctx, s.x, s.y, s.w, s.h, VIEW_ITEMS[i], this.hover === s.id, on, false, 14);
      }
    }
  }

  private dataOn(i: number): boolean {
    const v = this.vars;
    const s = this.side;
    switch (i) {
      case 0:
        return v.get(EPIC_VARS.mapShowAirports(s)) !== 0;
      case 1:
        return v.get(EPIC_VARS.mapShowNavaids(s)) !== 0;
      case 2:
        return v.get(EPIC_VARS.mapShowFixes(s)) !== 0;
      case 3:
        return v.get(EPIC_VARS.mapShowTraffic(s)) !== 0;
      case 4:
        return v.get(EPIC_VARS.mapOverlay(s)) === MapOverlay.Terrain;
      case 5:
        return v.get(EPIC_VARS.mapOverlay(s)) === MapOverlay.Weather;
      default:
        return v.get(EPIC_VARS.mapVsd(s)) !== 0;
    }
  }
}

const DASH = [8, 6];
const SECTOR = [-60, 60] as const;
const RADAR_MODES: Record<number, string> = { 0: 'OFF', 1: 'STBY', 2: 'WX', 3: 'GMAP' };

/** Deterministic 0..1 hash of a grid cell. */
function hash(i: number, j: number): number {
  const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const NODASH: number[] = [];
