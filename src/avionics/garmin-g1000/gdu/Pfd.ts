/**
 * G1000 NXi PFD (PG 190-02177-02 §2 "Flight Instruments", Figure 2-1) on the
 * 1024 x 768 GDU, normal and reversionary formats.
 *
 *  - Full-screen blue-over-brown attitude (7 px / deg, bank scale with 10,
 *    20, 30, 45, 60° marks, slip / skid bar, single-cue magenta flight
 *    director, extreme-pitch chevrons at +50 / -30°; declutter beyond +30 /
 *    -20° pitch or 65° bank). With ESP the roll limit indicators sit at ±45°
 *    (±30° while ESP is engaged, PG §8.11). SVT (PFD Opt > SVT > Terrain) adds
 *    the flight path marker and horizon heading labels. SCOPE: no synthetic
 *    terrain imagery is rendered.
 *  - Airspeed tape (60 kt visible, 172S colour bands, red above Vne, V-speed
 *    bugs G / R / X / Y, 6 s trend, TAS box), AFCS status annunciation /
 *    MAXSPD / MINSPD above it.
 *  - Altimeter (600 ft visible, selected altitude box with alerting, baro
 *    box, minimums bug, VNV target altitude), VSI (±2000 fpm, selected VS
 *    bug, RVSI), glideslope / glidepath / VDI left of the tape, marker
 *    beacon annunciations.
 *  - HSI (course pointer: GPS magenta single, NAV1 green single, NAV2 green
 *    double; bearing pointers 1 / 2 cyan; turn rate; track diamond; flight
 *    phase; OBS / SUSP), selected heading and course / DTK boxes, wind,
 *    DME and bearing information windows, minimums box.
 *  - Top bar (NAV / COM / navigation status / AFCS status), CAS window, OAT,
 *    transponder box, system time, inset map / HSI map, lower-right windows.
 *  - Reversionary: EIS strip on the left, instruments shifted right, inset
 *    map lower right (PG §1.3 "Reversionary Mode").
 */
import type { SimVars } from '../../../core/SimVars';
import { ADC, AP, FMS, GPS, NAV } from '../../../core/vars';
import { DEG2RAD, clamp, wrap360 } from '../../../core/math';
import { blinkOn } from '../../common/dynamics';
import { fmtFixed, fmtInt } from '../../common/format';
import { ADI_GARMIN, AttitudeIndicator, type AttitudeStyle } from '../../common/draw/AttitudeIndicator';
import { SpeedTape, SPEED_TAPE_GARMIN, type SpeedTapeStyle } from '../../common/draw/SpeedTape';
import { AltitudeTape, ALT_TAPE_GARMIN, type AltitudeTapeStyle } from '../../common/draw/AltitudeTape';
import { VerticalSpeedIndicator, VSI_GARMIN_2000 } from '../../common/draw/VerticalSpeed';
import { Hsi, HSI_GARMIN, type HsiStyle } from '../../common/draw/Hsi';
import { DeviationScale, GS_SCALE_GARMIN, VDI_GARMIN, drawMarkerBeacon, type MarkerKind } from '../../common/draw/DeviationScale';
import { CasWindow, type CasStyle } from '../../common/draw/CasWindow';
import { box, line, type Ctx2D, type Rect } from '../../common/draw/context';
import { fmtClockHms, fmtDeg, fmtDist, fmtHms, fmtNav, fmtSquawk, join2 } from '../../garmin-g3000/format';
import type { G1000System } from '../state/System';
import { BRG_SOURCE, CDI_SOURCE, G1K, PFD_MAP, WIND_OPTION, vn } from '../vars';
import { EisRenderer } from './Eis';
import { G1kMap } from './MapView';
import { TopBar } from './TopBar';
import { drawPage, drawPopup } from './windows';
import { COM_BOX_X, EIS_W, G1K_COLORS, G1K_PALETTE, NAV_BOX_W, SOFTKEY_Y, TF, TOPBAR_H, WIN_RECT, annun, winBox } from './style';

const P = G1K_PALETTE;

/** ADI: 7.0 px/deg and bank arc radius ~200 px measured on PG Figure 2-1 at 1024 x 768. */
const ADI_G1K: AttitudeStyle = {
  ...ADI_GARMIN,
  palette: P,
  typeface: TF,
  pxPerDeg: 7.0,
  gradientPx: 320,
  bank: { ...ADI_GARMIN.bank, radius: 200 },
};
/** Airspeed tape: 340 px for 60 kt = 5.67 px/kt (PG: "60 knots of airspeed viewable"). */
const SPD_G1K: SpeedTapeStyle = { ...SPEED_TAPE_GARMIN, palette: P, typeface: TF, pxPerKt: 340 / 60, labelSize: 20, readoutW: 70, readoutH: 38, readoutSize: 24, rollWindowH: 58 };
/** Altimeter: 340 px for 600 ft (PG: "600 feet of barometric altitude"). */
const ALT_G1K: AltitudeTapeStyle = { ...ALT_TAPE_GARMIN, palette: P, typeface: TF, pxPerFt: 340 / 600, labelSize: 19, readoutW: 100, readoutH: 38, readoutSize: 23, rollWindowH: 60 };
const HSI_G1K: HsiStyle = { ...HSI_GARMIN, palette: P, typeface: TF, labelSize: 19, majorTickLen: 16, minorTickLen: 9 };
const HSI_G1K_ARC: HsiStyle = { ...HSI_G1K, cardBackground: '' };
const CAS_G1K: CasStyle = { palette: P, typeface: TF, fontSize: 15, lineHeight: 17, background: 'rgba(0,0,0,0.85)', border: G1K_COLORS.boxBorder, inverseFlash: true, align: 'left' };

/** Reversionary horizontal shift of the PFD (EST from PG Figure 1-6: instruments right of the EIS strip). */
const REV_SHIFT = 100;
/** V-speed bug capacity. */
const BUGS = 6;

const AHRS_ALIGNING = 'ahrs1.aligning';
const IAS1 = ADC.ias(1);
const TAS1 = ADC.tas(1);
const ALT1 = ADC.baroAlt(1);
const VS1 = ADC.vs(1);
const BARO1 = ADC.baroSetting(1);
const STD1 = ADC.baroStd(1);
const PITCH1 = ADC.pitch(1);
const BANK1 = ADC.bank(1);
const SLIP1 = ADC.slip(1);
const HDG1 = ADC.heading(1);
const HDGT1 = ADC.headingTrue(1);
const TURN1 = ADC.turnRate(1);
const SAT1 = ADC.sat(1);
const ADCV1 = ADC.valid(1);
const AHRSV1 = ADC.ahrsValid(1);
const IAS_RATE1 = 'adc1.ias_rate_kts';
const HDG_VALID1 = 'ahrs1.hdg_valid';
const FD1 = AP.fdOn(1);
const SIDES: readonly number[] = [-1, 1];
const BRG_WHICH: readonly (1 | 2)[] = [1, 2];
const ATT_VALID1 = 'ahrs1.att_valid';

export class PfdRenderer {
  readonly adi: AttitudeIndicator;
  readonly spd: SpeedTape;
  readonly alt = new AltitudeTape({ x: 704, y: 115, w: 104, h: 340, style: ALT_G1K });
  readonly vsi = new VerticalSpeedIndicator({ x: 808, y: 132, w: 48, h: 305, style: { ...VSI_GARMIN_2000, palette: P, typeface: TF, labelSize: 14 } });
  readonly hsi = new Hsi({ cx: 459, cy: 578, radius: 141, style: HSI_G1K });
  readonly gs = new DeviationScale({ x: 686, y: 284, style: { ...GS_SCALE_GARMIN, palette: P, typeface: TF, dotSpacing: 30 } });
  readonly vdi = new DeviationScale({ x: 686, y: 284, style: { ...VDI_GARMIN, palette: P, typeface: TF, dotSpacing: 30 } });
  readonly inset: G1kMap;
  readonly eis: EisRenderer;
  readonly cas: CasWindow;
  readonly top: TopBar;
  private readonly v: SimVars;
  private time = 0;
  private xo = 0;
  private rev = false;
  private hsiMapOn = false;

  constructor(readonly sys: G1000System) {
    this.v = sys.vars;
    this.adi = new AttitudeIndicator({ rect: { x: 0, y: TOPBAR_H, w: 1024, h: SOFTKEY_Y - TOPBAR_H }, cx: 459, cy: 284, style: ADI_G1K });
    this.spd = new SpeedTape({ x: 155, y: 115, w: 85, h: 340, style: SPD_G1K, ranges: sys.cfg.speedTape.ranges, bugCount: BUGS });
    this.inset = new G1kMap(sys, 'inset', { x: 0, y: 478, w: 240, h: 227 });
    this.eis = new EisRenderer(sys);
    this.cas = new CasWindow({ x: 862, y: 118, w: 158, h: 12 * 17 + 8, model: sys.alerts.cas, style: CAS_G1K });
    this.top = new TopBar(sys);
    const s = this.spd.state;
    s.bugs.length = 0;
    for (let i = 0; i < BUGS; i++) s.bugs.push({ label: '', kt: NaN, visible: false, color: '' });
  }

  /** Normal (xo 0) or reversionary layout (instruments shifted right of the EIS strip). */
  layout(rev: boolean): void {
    if (rev === this.rev && this.adi.cx === 459 + (rev ? REV_SHIFT : 0)) return;
    this.rev = rev;
    const xo = rev ? REV_SHIFT : 0;
    this.xo = xo;
    this.adi.rect = { x: rev ? EIS_W : 0, y: TOPBAR_H, w: 1024 - (rev ? EIS_W : 0), h: SOFTKEY_Y - TOPBAR_H };
    this.adi.cx = 459 + xo;
    this.spd.x = 155 + xo;
    this.alt.x = 704 + xo;
    this.vsi.x = 808 + xo;
    this.hsi.cx = 459 + xo;
    this.gs.x = 686 + xo;
    this.vdi.x = 686 + xo;
    this.hsiMapOn = false;
    this.hsi.mode = 'rose';
    this.hsi.style = HSI_G1K;
    this.placeInset();
    if (rev) {
      this.cas.x = EIS_W + 4;
      this.cas.y = 490;
      this.cas.w = 176;
      this.cas.h = 210;
    } else {
      this.cas.x = 862;
      this.cas.y = 118;
      this.cas.w = 158;
      this.cas.h = 12 * 17 + 8;
    }
  }

  private placeInset(): void {
    this.inset.setRect(this.rev ? { x: 1024 - 204, y: 478, w: 202, h: 227 } : { x: 0, y: 478, w: 240, h: 227 });
  }

  /** Lower right window rectangle (narrower in reversionary mode). */
  windowRect(): Rect {
    return this.rev ? { x: 1024 - 204, y: WIN_RECT.y, w: 202, h: WIN_RECT.h } : WIN_RECT;
  }

  // ================================================================ update

  update(dt: number): void {
    this.time += dt;
    this.top.update(dt);
    const sys = this.sys;
    const v = this.v;
    const adcOk = v.get(ADCV1) >= 0.5;
    const attOk = v.get(ATT_VALID1, v.get(AHRSV1)) >= 0.5;
    const hdgOk = v.get(HDG_VALID1, v.get(AHRSV1)) >= 0.5;
    const airborne = v.get(GPS.gs) > 30 || v.get(TAS1) > 50;

    // --- attitude
    const a = this.adi.state;
    a.valid = attOk;
    a.pitch = v.get(PITCH1);
    a.bank = v.get(BANK1);
    a.slip = v.get(SLIP1);
    a.heading = v.get(HDG1);
    const fdOn = v.get(FD1) >= 0.5;
    a.fdVisible = fdOn && v.get('ap.fd_pitch_valid', 1) >= 0.5 && v.get('ap.fd_roll_valid', 1) >= 0.5 && (v.getString(AP.lateralActive) !== '' || v.getString(AP.verticalActive) !== '');
    a.fdPitch = v.get(AP.fdPitch);
    a.fdBank = v.get(AP.fdBank);
    // SVT: flight path marker (PG §2.1 "Synthetic Vision").
    const svt = v.get(G1K.svt) >= 0.5 && sys.cfg.terrain === 'SVT';
    a.fpvVisible = svt && v.get(GPS.valid) >= 0.5 && v.get(GPS.gs) > 30;
    if (a.fpvVisible) {
      const gs = Math.max(1, v.get(GPS.gs));
      a.fpaDeg = Math.atan2(v.get(GPS.vs) / 60, gs * 1.68781) / DEG2RAD;
      a.driftDeg = clamp(((v.get(GPS.trackTrue) - v.get(HDGT1) + 540) % 360) - 180, -20, 20);
    }
    a.pliDeg = NaN;
    this.adi.update(dt);

    // --- airspeed
    const sp = this.spd.state;
    sp.valid = adcOk;
    sp.ias = v.get(IAS1);
    sp.mach = 0;
    const rate = v.get(IAS_RATE1, NaN);
    sp.accelKtS = Number.isFinite(rate) ? rate : NaN;
    sp.maxKt = sys.cfg.speedTape.vneKt;
    sp.lowSpeedAwarenessKt = NaN;
    sp.minManeuverKt = NaN;
    sp.greenDotKt = NaN;
    const vert = v.getString(AP.verticalActive);
    // Airspeed reference bug / box in FLC (PG §7.3 "Flight Level Change Mode").
    sp.selectedKt = vert === 'FLC' ? v.get(AP.selSpeed) : NaN;
    sp.selectedIsMach = false;
    sp.selectedManaged = false;
    const defs = sys.refs.vspeeds.defs;
    for (let i = 0; i < sp.bugs.length; i++) {
      const b = sp.bugs[i];
      const d = defs[i];
      if (!d) {
        b.visible = false;
        continue;
      }
      b.label = d.label;
      b.kt = sys.refs.vspeeds.value(d.id);
      b.visible = sys.refs.vspeeds.on(d.id);
      b.color = '';
    }
    this.spd.update(dt);

    // --- altitude
    const t = this.alt.state;
    t.valid = adcOk;
    t.altFt = v.get(ALT1);
    t.vsFpm = v.get(VS1);
    t.selectedFt = v.get(AP.selAltitude);
    t.baroInHg = v.get(BARO1, 29.92);
    t.baroStd = v.get(STD1) >= 0.5;
    t.baroUnit = v.get(G1K.baroHpa) >= 0.5 ? 'hpa' : 'inhg';
    t.baroPreselectInHg = NaN;
    // Baro transition alerts (PG §2.1 "Barometric Transition Altitude"): 18,000 ft (US default).
    t.baroFlash = (!t.baroStd && t.altFt > 18000 && t.vsFpm > 0) || (t.baroStd && t.altFt < 18000 && t.vsFpm < 0);
    t.metric = v.get(G1K.metersOverlay) >= 0.5;
    const ma = sys.minsAlert;
    const mins = sys.refs.mins.effectiveFt();
    t.minimumsFt = Number.isFinite(mins) && ma.shown ? mins : NaN;
    t.minimumsPhase = ma.phase;
    t.alertPhase = sys.altAlert.phase;
    t.alertVisible = sys.altAlert.visible;
    t.vnavTargetFt = NaN;
    t.groundAltFt = NaN;
    this.alt.update(dt);

    // --- VSI
    const vs = this.vsi.state;
    vs.valid = adcOk;
    vs.vsFpm = t.vsFpm;
    vs.selectedFpm = vert === 'VS' ? v.get(AP.selVs) : NaN;
    const tod = v.get(FMS.todEteS);
    vs.requiredFpm = v.get(FMS.vnavValid) >= 0.5 && (tod <= 60 || v.getString(FMS.vnavPhase) === 'DES') ? v.get(FMS.vsRequiredFpm) : NaN;
    this.vsi.update(dt);

    // --- HSI
    this.updateHsi(hdgOk);

    // --- vertical deviation: GS (green), GP (magenta), VDI (magenta V)
    const src = sys.cdiSource;
    const gd = this.gs.state;
    const vd = this.vdi.state;
    gd.valid = false;
    gd.flag = '';
    vd.valid = false;
    vd.flag = '';
    if (src !== CDI_SOURCE.gps && v.get(vn(NAV.isLoc, src)) >= 0.5) {
      gd.color = P.green;
      gd.label = 'G';
      gd.valid = v.get(vn(NAV.gsValid, src)) >= 0.5;
      gd.dev = v.get(vn(NAV.gsDev, src));
      gd.flag = gd.valid ? '' : 'NO GS';
      gd.hollow = false;
    } else if (src === CDI_SOURCE.gps && v.get(FMS.approachActive) >= 0.5 && v.get(FMS.gpAngleDeg) > 0) {
      gd.color = P.magenta;
      gd.label = 'G';
      gd.valid = v.get(FMS.gpValid) >= 0.5;
      gd.dev = v.get(FMS.gpDev);
      gd.flag = gd.valid ? '' : 'NO GP';
      gd.hollow = false;
    } else if (v.get(FMS.vnavValid) >= 0.5 && src === CDI_SOURCE.gps) {
      // VDI: full scale ±2 dots = ±1000 ft (PG §2.1 "Vertical Deviation").
      vd.valid = true;
      vd.color = P.magenta;
      vd.label = 'V';
      vd.dev = clamp(-v.get(FMS.vnavDevFt) / 1000, -1.2, 1.2);
    }

    // --- maps and windows
    const mapMode = v.get(G1K.pfdMap);
    const full = !this.adi.state.decluttered;
    const hsiMap = full && (mapMode === PFD_MAP.hsi || mapMode === PFD_MAP.hsiTraffic);
    if (hsiMap !== this.hsiMapOn) {
      this.hsiMapOn = hsiMap;
      const h = this.hsi;
      h.mode = hsiMap ? 'arc' : 'rose';
      h.arcSpanDeg = 140;
      h.style = hsiMap ? HSI_G1K_ARC : HSI_G1K;
      const R = h.radius;
      if (hsiMap) this.inset.setRect({ x: h.cx - R - 40, y: h.cy - R - 30, w: 2 * R + 80, h: SOFTKEY_Y - (h.cy - R - 30) - 30 }, { x: h.cx, y: h.cy, rangePx: R * 2 });
      else this.placeInset();
    }
    this.inset.kind = mapMode === PFD_MAP.insetTraffic || mapMode === PFD_MAP.hsiTraffic ? 'traffic' : 'inset';
    const insetOn = full && mapMode !== PFD_MAP.off;
    if (insetOn) this.inset.update(dt);
    this.cas.update(dt);
    if (this.rev) this.eis.update(dt);
    void airborne;
  }

  private updateHsi(hdgOk: boolean): void {
    const v = this.v;
    const sys = this.sys;
    const h = this.hsi.state;
    const trueRef = v.get(G1K.navAngleTrue) >= 0.5;
    h.valid = hdgOk;
    h.headingIsTrue = trueRef;
    h.heading = trueRef ? v.get(HDGT1) : v.get(HDG1);
    h.turnRateDps = v.get(TURN1);
    h.selectedHeading = v.get(AP.selHeading);
    h.track = v.get(GPS.valid) >= 0.5 && v.get(GPS.gs) > 30 ? (trueRef ? v.get(GPS.trackTrue) : v.get(GPS.trackMag)) : NaN;
    const src = sys.cdiSource;
    h.courseVisible = true;
    h.phaseLabel = '';
    h.gsVisible = false;
    h.windValid = false;
    if (src === CDI_SOURCE.gps) {
      const obs = v.get(G1K.obs) >= 0.5;
      h.course = obs ? v.get(G1K.obsCourse) : v.get(FMS.dtkMag);
      h.courseColor = P.magenta;
      h.courseDouble = false;
      h.cdiValid = v.get(GPS.valid) >= 0.5 && v.get(FMS.activeLegIndex, -1) >= 0;
      // GPS CDI scale: Auto (FMS flight phase) or the Aux - System Setup selection (2.0 / 1.0 / 0.3 nm).
      const sel = v.get(G1K.gpsCdi) | 0;
      const fs = sel === 1 ? 2 : sel === 2 ? 1 : sel === 3 ? 0.3 : 0;
      h.cdi = fs > 0 ? clamp(-v.get(FMS.xtkNm) / fs, -1.3, 1.3) : v.get(FMS.cdi);
      h.toFrom = v.get(FMS.toFrom, 1);
      h.xtkNm = v.get(FMS.xtkNm);
      h.sourceLabel = 'GPS';
      h.phaseLabel = v.getString(FMS.approachMode) || 'ENR';
      h.courseVisible = Number.isFinite(h.course) && h.cdiValid;
    } else {
      const loc = v.get(vn(NAV.isLoc, src)) >= 0.5;
      h.course = v.get(vn(NAV.obs, src));
      h.courseColor = P.green;
      h.courseDouble = src === 2;
      h.cdiValid = v.get(vn(NAV.received, src)) >= 0.5;
      h.cdi = v.get(vn(NAV.cdi, src));
      h.toFrom = loc ? 0 : v.get(vn(NAV.toFrom, src));
      h.xtkNm = NaN;
      h.sourceLabel = loc ? (src === 1 ? 'LOC1' : 'LOC2') : src === 1 ? 'VOR1' : 'VOR2';
    }
    this.setBearing(h.bearing1, v.get(G1K.brg1Source), 1);
    this.setBearing(h.bearing2, v.get(G1K.brg2Source), 2);
    this.hsi.update(0);
  }

  private setBearing(b: { visible: boolean; bearing: number; lines: 1 | 2; color: string }, src: number, lines: 1 | 2): void {
    const v = this.v;
    b.lines = lines;
    b.color = P.cyan;
    b.visible = false;
    if (src === BRG_SOURCE.nav1 || src === BRG_SOURCE.nav2) {
      const r = src === BRG_SOURCE.nav1 ? 1 : 2;
      if (v.get(vn(NAV.bearingValid, r)) >= 0.5 && v.get(vn(NAV.isLoc, r)) < 0.5) {
        b.visible = true;
        b.bearing = v.get(vn(NAV.bearing, r));
      }
    } else if (src === BRG_SOURCE.gps) {
      const brg = v.get(FMS.bearingToWptMag, NaN);
      if (Number.isFinite(brg) && v.get(FMS.activeLegIndex, -1) >= 0) {
        b.visible = true;
        b.bearing = brg;
      }
    } else if (src === BRG_SOURCE.adf) {
      if (v.get(vn(NAV.adfValid, 1)) >= 0.5) {
        b.visible = true;
        b.bearing = wrap360(this.hsi.state.heading + v.get(vn(NAV.adfBearing, 1)));
      }
    }
  }

  // ================================================================ draw

  draw(ctx: Ctx2D, softkeysTop: number): void {
    const sys = this.sys;
    const v = this.v;
    const xo = this.xo;
    const dcl = this.adi.state.decluttered;
    this.adi.draw(ctx);
    // ESP roll limit indicators on the roll scale (PG §8.11 Figures 8-54 / 8-55).
    const lim = v.get(G1K.espRollLimit);
    if (sys.esp && lim > 0 && this.adi.state.valid) this.drawRollLimits(ctx, lim);
    if (v.get(G1K.svt) >= 0.5 && v.get(G1K.svtHdgLabels) >= 0.5 && this.adi.state.valid && sys.cfg.terrain === 'SVT') this.drawHorizonHeadings(ctx);
    if (!this.adi.state.valid) this.redX(ctx, this.adi.cx - 150, 140, 300, 260);
    if (v.get(AHRS_ALIGNING) >= 0.5) {
      winBox(ctx, this.adi.cx - 150, 200, 300, 30);
      TF.draw(ctx, 'AHRS ALIGN: Remain Stationary', this.adi.cx, 215, 16, P.white, 'center', 'middle');
    }
    this.spd.draw(ctx);
    if (!this.spd.state.valid) this.redX(ctx, this.spd.x, this.spd.y, this.spd.w, this.spd.h);
    this.drawTas(ctx, dcl);
    this.alt.draw(ctx);
    this.vsi.draw(ctx);
    if (!this.alt.state.valid) this.redX(ctx, this.alt.x, this.alt.y, this.alt.w + 48, this.alt.h);
    if (!dcl) {
      if (this.gs.state.valid || this.gs.state.flag) this.gs.draw(ctx);
      else if (this.vdi.state.valid) this.vdi.draw(ctx);
      this.drawVnvTarget(ctx);
    }
    this.drawMarkers(ctx);
    if (this.hsiMapOn) {
      const h = this.hsi;
      ctx.save();
      ctx.beginPath();
      ctx.arc(h.cx, h.cy, h.radius + 2, 0, Math.PI * 2);
      ctx.clip();
      this.inset.draw(ctx);
      ctx.restore();
    }
    this.hsi.draw(ctx);
    if (!this.hsi.state.valid) this.redX(ctx, this.hsi.cx - 60, this.hsi.cy - this.hsi.radius - 34, 120, 30);
    this.drawHsiAnnotations(ctx, dcl);
    // Top bar.
    this.top.drawBackground(ctx);
    this.top.drawNav(ctx);
    this.top.drawCom(ctx);
    this.top.drawPfdStatus(ctx, NAV_BOX_W + 6, COM_BOX_X - 6);
    this.drawAfcsAnnunciations(ctx);
    if (!dcl) {
      this.drawWind(ctx);
      this.drawDmeInfo(ctx);
      this.drawMinimumsBox(ctx);
    }
    this.drawBearingInfo(ctx);
    this.drawBottomBar(ctx, dcl);
    // Inset map (lower left; lower right in reversionary mode).
    const mapMode = v.get(G1K.pfdMap);
    if (!dcl && !this.hsiMapOn && mapMode !== PFD_MAP.off) {
      this.inset.draw(ctx);
      const r = this.rev ? { x: 1024 - 204, y: 478, w: 202, h: 227 } : { x: 0, y: 478, w: 240, h: 227 };
      box(ctx, r.x, r.y, r.w, r.h, '', G1K_COLORS.boxBorder, 1.5);
    }
    // CAS window (PG Appendix A: up to 12 lines; opens when messages exist).
    if (sys.alerts.cas.list.length > 0) this.cas.draw(ctx);
    // Lower right window and pop-ups.
    const w = sys.pfdWindow;
    const wr = this.windowRect();
    if (w && !dcl) drawPage(ctx, sys, w, wr, this.time, true);
    drawPopup(ctx, sys.popups.pfd, { x: wr.x, y: 300, w: wr.w, h: 300 });
    if (this.rev) this.eis.draw(ctx, 0, TOPBAR_H, softkeysTop);
    void xo;
  }

  private redX(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
    line(ctx, x, y, x + w, y + h, P.red, 3);
    line(ctx, x, y + h, x + w, y, P.red, 3);
  }

  /** ESP roll limit indicators: small green double ticks outside the roll scale at ±lim (PG Figure 8-54). */
  private drawRollLimits(ctx: Ctx2D, lim: number): void {
    const cx = this.adi.cx;
    const cy = this.adi.cy;
    const R = ADI_G1K.bank.radius;
    const bank = this.adi.state.bank;
    for (const s of SIDES) {
      const a = (s * lim - bank) * DEG2RAD;
      const x0 = cx + Math.sin(a) * (R + 4);
      const y0 = cy - Math.cos(a) * (R + 4);
      const x1 = cx + Math.sin(a) * (R + 16);
      const y1 = cy - Math.cos(a) * (R + 16);
      const dx = Math.cos(a) * 3;
      const dy = Math.sin(a) * 3;
      line(ctx, x0 - dx, y0 - dy, x1 - dx, y1 - dy, P.green, 2);
      line(ctx, x0 + dx, y0 + dy, x1 + dx, y1 + dy, P.green, 2);
    }
  }

  /** SVT heading labels along the zero-pitch line (PG §2.1 "Horizon Heading Marks"). */
  private drawHorizonHeadings(ctx: Ctx2D): void {
    const a = this.adi.state;
    const cx = this.adi.cx;
    const cy = this.adi.cy + a.pitch * ADI_G1K.pxPerDeg;
    const hdg = a.heading;
    const pxPerDeg = ADI_G1K.pxPerDeg;
    ctx.save();
    ctx.translate(cx, this.adi.cy);
    ctx.rotate(-a.bank * DEG2RAD);
    for (let d = Math.ceil((hdg - 60) / 10) * 10; d <= hdg + 60; d += 10) {
      const x = (d - hdg) * pxPerDeg;
      const y = cy - this.adi.cy;
      line(ctx, x, y - 5, x, y + 5, P.white, 1.5);
      const lbl = wrap360(d);
      if (lbl % 30 === 0) TF.draw(ctx, fmtInt(lbl === 0 ? 360 : lbl), x, y - 12, 12, P.white, 'center', 'middle', '#000000');
    }
    ctx.restore();
  }

  private drawTas(ctx: Ctx2D, dcl: boolean): void {
    if (dcl) return;
    const x = this.spd.x;
    const y = this.spd.y + this.spd.h;
    box(ctx, x, y, this.spd.w, 25, '#000000', G1K_COLORS.boxBorder, 1);
    TF.draw(ctx, 'TAS', x + 6, y + 13, 12, P.white, 'left', 'middle');
    TF.draw(ctx, join2(fmtInt(this.v.get(TAS1)), 'KT'), x + this.spd.w - 4, y + 13, 14, P.white, 'right', 'middle');
  }

  /** AFCS status annunciation and MAXSPD / MINSPD above the airspeed tape (PG Table 7-6, §7.5). */
  private drawAfcsAnnunciations(ctx: Ctx2D): void {
    const v = this.v;
    const cx = this.spd.x + this.spd.w / 2;
    const txt = v.getString(G1K.afcsStatus);
    if (txt) {
      const lvl = v.get(G1K.afcsStatusLevel);
      if (lvl === 2) {
        box(ctx, cx - 26, 62, 52, 20, '', P.white, 1.5);
        TF.draw(ctx, txt, cx, 73, 15, P.white, 'center', 'middle');
      } else annun(ctx, txt, cx, 72, 15, lvl === 1 ? P.red : P.yellow, lvl === 1 ? P.white : P.black);
    }
    const flash = blinkOn(this.time, 2);
    if (v.get(G1K.maxSpd) >= 0.5 && flash) annun(ctx, 'MAXSPD', cx, 98, 15, P.amber);
    else if (v.get(G1K.minSpd) >= 0.5) annun(ctx, 'MINSPD', cx, 98, 15, P.yellow);
    if (v.get(G1K.uspActive) >= 0.5) {
      const x = this.vsi.x + 54;
      box(ctx, x, 270, 150, 40, P.red, '');
      TF.draw(ctx, 'UNDERSPEED', x + 75, 282, 14, P.white, 'center', 'middle');
      TF.draw(ctx, 'PROTECT ACTIVE', x + 75, 299, 14, P.white, 'center', 'middle');
    }
  }

  /** VNV target altitude (magenta) above / right of the selected altitude while VNV applies (PG §2.3). */
  private drawVnvTarget(ctx: Ctx2D): void {
    const v = this.v;
    const vArm = v.getString(AP.verticalArmed);
    const vAct = v.getString(AP.verticalActive);
    const vnv = vAct.startsWith('VP') || vAct === 'ALTV' || vArm.indexOf('V') >= 0;
    if (v.get(FMS.vnavValid) < 0.5 || !vnv) return;
    const ft = v.get(FMS.vnavTargetAltFt);
    if (!Number.isFinite(ft)) return;
    const x = this.alt.x + this.alt.w + 2;
    box(ctx, x, 85, 60, 28, '#000000', P.magenta, 1.5);
    TF.draw(ctx, fmtInt(ft), x + 56, 100, 15, P.magenta, 'right', 'middle');
  }

  private drawMarkers(ctx: Ctx2D): void {
    const v = this.v;
    const k: MarkerKind = v.get(NAV.markerInner) >= 0.5 ? 3 : v.get(NAV.markerMiddle) >= 0.5 ? 2 : v.get(NAV.markerOuter) >= 0.5 ? 1 : 0;
    if (k && blinkOn(this.time, k === 1 ? 2 : k === 2 ? 3 : 6)) drawMarkerBeacon(ctx, this.alt.x - 26, 340, k, 'garmin', P, TF, 20);
  }

  private drawHsiAnnotations(ctx: Ctx2D, dcl: boolean): void {
    const v = this.v;
    const h = this.hsi;
    const cx = h.cx;
    const top = h.cy - h.radius - 20;
    if (!dcl) {
      // Selected heading (cyan) upper left of the HSI; course / DTK upper right (PG §2.1).
      winBox(ctx, cx - 184, top - 10, 90, 26);
      TF.draw(ctx, 'HDG', cx - 178, top + 3, 13, P.white, 'left', 'middle');
      TF.draw(ctx, fmtDeg(v.get(AP.selHeading)), cx - 98, top + 3, 16, P.cyan, 'right', 'middle');
      const gps = this.sys.cdiSource === CDI_SOURCE.gps;
      const obs = v.get(G1K.obs) >= 0.5;
      winBox(ctx, cx + 94, top - 10, 90, 26);
      TF.draw(ctx, gps && !obs ? 'DTK' : 'CRS', cx + 100, top + 3, 13, P.white, 'left', 'middle');
      const crs = h.state.course;
      TF.draw(ctx, Number.isFinite(crs) ? fmtDeg(crs) : '___°', cx + 180, top + 3, 16, gps ? P.magenta : P.green, 'right', 'middle');
    }
    // OBS / SUSP annunciation lower right of the aircraft symbol (PG §2.1).
    if (v.get(G1K.obs) >= 0.5) TF.draw(ctx, 'OBS', cx + 34, h.cy + 30, 14, P.white, 'left', 'middle');
    else if (v.get(FMS.suspended) >= 0.5) TF.draw(ctx, 'SUSP', cx + 34, h.cy + 30, 14, P.white, 'left', 'middle');
    // Dead reckoning / loss of integrity (PG §2.1 "GPS CDI").
    if (this.sys.cdiSource === CDI_SOURCE.gps && v.get(GPS.valid) < 0.5 && v.get(FMS.activeLegIndex, -1) >= 0) TF.draw(ctx, 'DR', cx - 60, h.cy + 30, 14, P.amber, 'left', 'middle');
  }

  /** Wind window (PFD Opt > Wind options 1-3, PG §2.2 "Wind Data"). */
  private drawWind(ctx: Ctx2D): void {
    const v = this.v;
    const opt = v.get(G1K.windOption);
    if (opt === WIND_OPTION.off) return;
    const x = 244 + this.xo;
    const y = 486;
    winBox(ctx, x, y, 90, 44);
    const valid = v.get(GPS.valid) >= 0.5 && v.get(TAS1) > 30 && v.get(ADCV1) >= 0.5;
    if (!valid) {
      TF.draw(ctx, 'NO WIND', x + 45, y + 22, 13, P.white, 'center', 'middle');
      return;
    }
    // Wind from GPS track / GS vs heading / TAS (the G1000 computes wind from ADC and GPS).
    const hdg = v.get(HDGT1) * DEG2RAD;
    const trk = v.get(GPS.trackTrue) * DEG2RAD;
    const tas = v.get(TAS1);
    const gs = v.get(GPS.gs);
    const wn = gs * Math.cos(trk) - tas * Math.cos(hdg);
    const we = gs * Math.sin(trk) - tas * Math.sin(hdg);
    const spd = Math.hypot(wn, we);
    const toDir = Math.atan2(we, wn) / DEG2RAD;
    const fromTrue = wrap360(toDir + 180);
    const fromMag = wrap360(fromTrue - v.get(GPS.magVar));
    const relTo = (toDir - v.get(HDGT1)) * DEG2RAD;
    if (opt === WIND_OPTION.option1) {
      const head = -spd * Math.cos(relTo);
      const cross = spd * Math.sin(relTo);
      TF.draw(ctx, head >= 0 ? '↓' : '↑', x + 10, y + 13, 14, P.white, 'left', 'middle');
      TF.draw(ctx, fmtInt(Math.abs(head)), x + 40, y + 13, 14, P.white, 'right', 'middle');
      TF.draw(ctx, cross >= 0 ? '→' : '←', x + 10, y + 32, 14, P.white, 'left', 'middle');
      TF.draw(ctx, fmtInt(Math.abs(cross)), x + 40, y + 32, 14, P.white, 'right', 'middle');
      return;
    }
    // Arrow pointing the direction the wind blows, relative to the heading.
    const ax = x + 22;
    const ay = y + 22;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(relTo);
    line(ctx, 0, 14, 0, -14, P.white, 2);
    line(ctx, 0, -14, -5, -7, P.white, 2);
    line(ctx, 0, -14, 5, -7, P.white, 2);
    ctx.restore();
    if (opt === WIND_OPTION.option2) TF.draw(ctx, join2(fmtInt(spd), 'KT'), x + 84, y + 22, 14, P.white, 'right', 'middle');
    else {
      TF.draw(ctx, fmtDeg(fromMag), x + 84, y + 13, 14, P.white, 'right', 'middle');
      TF.draw(ctx, join2(fmtInt(spd), 'KT'), x + 84, y + 32, 14, P.white, 'right', 'middle');
    }
  }

  /** DME information window above the Bearing 1 window (PFD Opt > DME, optional DME). */
  private drawDmeInfo(ctx: Ctx2D): void {
    const v = this.v;
    if (!this.sys.cfg.radios.dme || v.get(G1K.dmeWindow) < 0.5) return;
    const rx = this.sys.dmeReceiver();
    const x = 244 + this.xo;
    const y = 596;
    winBox(ctx, x, y, 90, 50);
    TF.draw(ctx, 'DME', x + 6, y + 10, 12, P.white, 'left', 'middle');
    TF.draw(ctx, rx === 1 ? 'NAV1' : 'NAV2', x + 84, y + 10, 12, P.white, 'right', 'middle');
    TF.draw(ctx, fmtNav(v.get(vn(NAV.activeFreq, rx))), x + 84, y + 25, 13, P.white, 'right', 'middle');
    const ok = v.get(vn(NAV.dmeValid, rx)) >= 0.5;
    TF.draw(ctx, ok ? join2(fmtFixed(v.get(vn(NAV.dmeNm, rx)), 1), 'NM') : '---.-NM', x + 84, y + 40, 14, P.green, 'right', 'middle');
  }

  /** BARO MIN / COMP MIN box (PG §2.4): cyan within 2500 ft, white within 100 ft, amber at minimums. */
  private drawMinimumsBox(ctx: Ctx2D): void {
    const sys = this.sys;
    const m = sys.refs.mins;
    const ft = m.effectiveFt();
    if (!Number.isFinite(ft)) return;
    const ph = sys.minsAlert.phase;
    const color = ph === 'reached' ? P.amber : ph === 'near' ? P.white : P.cyan;
    const x = this.alt.x - 100;
    const y = 462;
    winBox(ctx, x, y, 94, 24);
    TF.draw(ctx, m.mode === 2 ? 'COMP MIN' : 'BARO MIN', x + 4, y + 12, 10, P.white, 'left', 'middle');
    TF.draw(ctx, join2(fmtInt(ft), 'FT'), x + 90, y + 12, 13, color, 'right', 'middle');
  }

  /** Bearing information windows (PG §2.1 "Bearing Pointers and Information Windows"). */
  private drawBearingInfo(ctx: Ctx2D): void {
    const v = this.v;
    for (const which of BRG_WHICH) {
      const src = v.get(which === 1 ? G1K.brg1Source : G1K.brg2Source);
      if (src === BRG_SOURCE.off) continue;
      const x = which === 1 ? 244 + this.xo : 584 + this.xo;
      const y = 650;
      winBox(ctx, x, y, 90, 50);
      let label = '';
      let ident = '';
      let dist = NaN;
      let freq = '';
      if (src === BRG_SOURCE.nav1 || src === BRG_SOURCE.nav2) {
        const r = src === BRG_SOURCE.nav1 ? 1 : 2;
        label = r === 1 ? 'NAV1' : 'NAV2';
        freq = fmtNav(v.get(vn(NAV.activeFreq, r)));
        ident = v.get(vn(NAV.received, r)) >= 0.5 ? v.getString(vn(NAV.ident, r)) : '';
        dist = v.get(vn(NAV.dmeValid, r)) >= 0.5 ? v.get(vn(NAV.dmeNm, r)) : NaN;
      } else if (src === BRG_SOURCE.gps) {
        label = 'GPS';
        ident = v.getString(FMS.nextWptIdent);
        dist = v.get(FMS.activeLegIndex, -1) >= 0 ? v.get(FMS.distToWptNm) : NaN;
      } else {
        label = 'ADF';
        freq = fmtInt(v.get(vn(NAV.adfActive, 1)));
      }
      TF.draw(ctx, Number.isFinite(dist) ? join2(fmtDist(dist), 'NM') : '', x + 84, y + 10, 13, P.cyan, 'right', 'middle');
      TF.draw(ctx, ident || freq, x + 84, y + 25, 13, P.cyan, 'right', 'middle');
      TF.draw(ctx, label, x + 6, y + 40, 12, P.white, 'left', 'middle');
      // Single (1) / double (2) line pointer symbol.
      line(ctx, x + 52, y + 40, x + 84, y + 40, P.cyan, 1.5);
      if (which === 2) line(ctx, x + 52, y + 44, x + 84, y + 44, P.cyan, 1.5);
    }
  }

  /** OAT (lower left), XPDR box and system time (lower right) (PG Figure 2-1). */
  private drawBottomBar(ctx: Ctx2D, dcl: boolean): void {
    if (dcl) return;
    const v = this.v;
    const y = 722;
    // OAT: °C (PG §2.2); Aux - System Setup temperature units SCOPE: Celsius only.
    const oatX = this.rev ? EIS_W + 4 : 2;
    winBox(ctx, oatX, y - 12, 100, 24);
    TF.draw(ctx, 'OAT', oatX + 6, y, 12, P.white, 'left', 'middle');
    TF.draw(ctx, v.get(ADCV1) >= 0.5 ? join2(fmtInt(v.get(SAT1)), '°C') : '---°C', oatX + 94, y, 14, P.white, 'right', 'middle');
    // Transponder data box (PG §4.4): code and mode white on the ground, green airborne; 'R' reply; 'Ident' green.
    const xp = this.sys.xpdr;
    const up = this.sys.units.up('xpdr');
    const x = 720;
    winBox(ctx, x, y - 12, 160, 24);
    if (!up) this.redX(ctx, x + 4, y - 10, 152, 20);
    else {
      const air = xp.airborne;
      const mode = xp.mode;
      const ident = v.get(G1K.xpdrIdentS) > 0;
      const green = air && mode >= 2 ? P.green : P.white;
      TF.draw(ctx, 'XPDR', x + 6, y, 12, P.white, 'left', 'middle');
      const codeTxt = xp.entering ? xp.displayCode() : fmtSquawk(xp.code);
      TF.draw(ctx, codeTxt, x + 82, y, 15, xp.entering ? P.cyan : green, 'right', 'middle');
      const modeTxt = ident ? 'IDNT' : mode === 1 ? 'STBY' : mode === 2 ? 'ON' : 'ALT';
      TF.draw(ctx, modeTxt, x + 136, y, 14, ident ? P.green : green, 'right', 'middle');
      if (v.get(G1K.xpdrReplyS) >= 0.5) TF.draw(ctx, 'R', x + 152, y, 14, P.white, 'center', 'middle');
    }
    // System time (UTC or local per Aux - System Setup) / generic timer while running.
    const tx = 884;
    winBox(ctx, tx, y - 12, 138, 24);
    const t = this.sys.refs.timer;
    if (t.running || t.seconds > 0.5) {
      TF.draw(ctx, 'TMR', tx + 6, y, 12, P.white, 'left', 'middle');
      TF.draw(ctx, fmtHms(t.seconds, true), tx + 132, y, 14, P.white, 'right', 'middle');
    } else {
      const fmt = v.get(G1K.timeFormat) | 0;
      const utc = v.get(GPS.utcH);
      const h = fmt === 0 ? utc : utc + v.get(G1K.timeOffsetH);
      TF.draw(ctx, fmt === 0 ? 'UTC' : 'LCL', tx + 6, y, 12, P.white, 'left', 'middle');
      TF.draw(ctx, Number.isFinite(utc) ? fmtClockHms(((h % 24) + 24) % 24) : '__:__:__', tx + 132, y, 14, P.white, 'right', 'middle');
    }
  }
}
