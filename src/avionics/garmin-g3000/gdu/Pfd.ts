/**
 * G3000 / G5000 PFD (GDU 1400W, 1280 x 800), full and split formats.
 *
 * Layout from the G3000 PG 190-02046-01 figures (Figure 1-2 PFD power-up,
 * §2.1 PFD in full mode with inset map, Figures 2-17..2-24): full-screen
 * blue-over-brown horizon; airspeed tape left and altimeter + VSI right of
 * the attitude centre; HSI centred low (partly behind the bottom data bar);
 * MSG icon top-left, AFCS status box top-centre, COM box top-right; inset map
 * bottom-left; wind window upper-left and PFD navigation status bar right of
 * the HSI; TAS/GS/OAT/ISA, bearing information and TMR/UTC in the bottom data
 * bar; 12 softkey labels along the bottom. The G5000 (Longitude) adds the
 * autothrottle cell to the AFCS box and, with `casLocation: 'pfd'`, the CAS
 * window in the lower inboard corner (Longitude Operators Guide §3).
 *
 * Every value comes from sensor / system vars selected for this side (ADC /
 * AHRS selection per PG §1.3 "Sensors"); nothing reads FDM truth except the
 * GPS-derived position / ground speed (CLAUDE.md exception).
 */
import type { SimVars } from '../../../core/SimVars';
import { ADC, AP, FMS, GPS, NAV } from '../../../core/vars';
import { DEG2RAD, RAD2DEG, clamp, wrap360 } from '../../../core/math';
import { AltitudeAlerter, ALT_ALERT_GARMIN, MinimumsAlerter, MINIMUMS_GARMIN } from '../../common/alerting';
import { blinkOn } from '../../common/dynamics';
import { fmtFixed, fmtInt, fmtMach } from '../../common/format';
import { ADI_GARMIN, AttitudeIndicator, quantizeRadioAlt, type AttitudeStyle } from '../../common/draw/AttitudeIndicator';
import { SpeedTape, SPEED_TAPE_GARMIN, type SpeedTapeStyle } from '../../common/draw/SpeedTape';
import { AltitudeTape, ALT_TAPE_GARMIN, type AltitudeTapeStyle } from '../../common/draw/AltitudeTape';
import { VerticalSpeedIndicator, VSI_GARMIN_4000 } from '../../common/draw/VerticalSpeed';
import { Hsi, HSI_GARMIN, type HsiStyle } from '../../common/draw/Hsi';
import { DeviationScale, GS_SCALE_GARMIN, VDI_GARMIN, drawMarkerBeacon, type MarkerKind } from '../../common/draw/DeviationScale';
import { MovingMap, MAP_GARMIN } from '../../common/draw/MovingMap';
import { CasWindow, type CasStyle } from '../../common/draw/CasWindow';
import { box, circle, clipRect, line, triangle, type Ctx2D } from '../../common/draw/context';
import type { G3000System } from '../state/System';
import { AOA_MODE, BRG_SOURCE, G3K, GCU_WINDOW, MINS_MODE, NAV_SOURCE, PFD_MAP, WIND_OPTION, vn } from '../vars';
import { legIdent } from '../state/FplEditor';
import { GCU_PROC_ITEMS } from '../state/Gcu';
import { fmtClockHms, fmtCom, fmtDeg, fmtDist, fmtHms, fmtNav, fmtAdf, fmtSigned, fmtSquawk, join2 } from '../format';
import { G3K_COLORS, G3K_PALETTE, GDU_H, PFD_DATABAR_H, SOFTKEY_H, TF, annunciation, dataBox, valueUnit } from './style';
import { MapPane } from './panes/MapPane';

const P = G3K_PALETTE;

/**
 * G3000 attitude style: Garmin geometry on the 1280 x 800 GDU, measured from
 * the TBM 930 CRG PFD figure (horizon y 273, 10° lines at y 190 / 353 ->
 * ~8.2 px/deg; 10° line 110 px long; bank arc radius ~200 px).
 */
const ADI_G3K: AttitudeStyle = {
  ...ADI_GARMIN,
  palette: P,
  typeface: TF,
  pxPerDeg: 8.2,
  gradientPx: 360,
  ladder: { ...ADI_GARMIN.ladder, majorHalf: 55, midHalf: 27, fineHalf: 14, labelSize: 21, visibleRangeDeg: 15, clipHalfWidth: 150, lineWidth: 2.5 },
  bank: { ...ADI_GARMIN.bank, radius: 192, pointerSize: 17, majorLen: 24, minorLen: 13, lineWidth: 2.5 },
  slip: { ...ADI_GARMIN.slip, width: 32, height: 7, travel: 28, gap: 4 },
  fd: { ...ADI_GARMIN.fd, size: 132, thickness: 14 },
  symbol: { ...ADI_GARMIN.symbol, size: 140, thickness: 16 },
};

const SPD_G3K: SpeedTapeStyle = { ...SPEED_TAPE_GARMIN, palette: P, typeface: TF, pxPerKt: 5.9, labelSize: 25, readoutW: 84, readoutH: 46, readoutSize: 31, rollWindowH: 76, majorTick: 20, minorTick: 11, stripW: 9 };
const ALT_G3K: AltitudeTapeStyle = { ...ALT_TAPE_GARMIN, palette: P, typeface: TF, pxPerFt: 0.36, labelSize: 24, readoutW: 116, readoutH: 46, readoutSize: 29, rollWindowH: 78, majorTick: 20, minorTick: 10 };
const HSI_G3K: HsiStyle = { ...HSI_GARMIN, palette: P, typeface: TF, labelSize: 25, majorTickLen: 20, minorTickLen: 11, cardBackground: 'rgba(28,30,34,0.72)' };
/** HSI map layout: arc compass over a moving map (PG §2.1 "HSI Map"). */
const HSI_G3K_ARC: HsiStyle = { ...HSI_G3K, cardBackground: '' };

const CAS_PFD: CasStyle = { palette: P, typeface: TF, fontSize: 19, lineHeight: 23, background: 'rgba(0,0,0,0.78)', border: G3K_COLORS.boxBorder, inverseFlash: true, align: 'left' };

/** Sensor var builders (stable functions for `vn`). */
const AHRS_ATT_VALID = (i: number): string => `ahrs${i}.att_valid`;
const AHRS_HDG_VALID = (i: number): string => `ahrs${i}.hdg_valid`;
const AHRS_ALIGNING = (i: number): string => `ahrs${i}.aligning`;
const ADC_AOA = (i: number): string => `adc${i}.aoa_deg`;
const ADC_IAS_RATE = (i: number): string => `adc${i}.ias_rate_kts`;
const ADC_PRESS_ALT = (i: number): string => `adc${i}.press_alt_ft`;
const RA_VALID = (i: number): string => `ra${i}.valid`;
const RA_NCD = (i: number): string => `ra${i}.ncd`;
const RA_ALT = (i: number): string => `ra${i}.alt_ft`;
const MISCOMP_TXT = ['ALT MISCOMP', 'IAS MISCOMP', 'HDG MISCOMP', 'PIT MISCOMP', 'ROL MISCOMP'];
const NAV_LBL = ['NAV', 'NAV1', 'NAV2', 'NAV3'];

/** Mode strings flash for 10 s after a change (PG §7.2 "Flight Director Modes"). */
const MODE_FLASH_S = 10;

interface Layout {
  x0: number;
  w: number;
  split: boolean;
  cx: number;
  adiCy: number;
  bottom: number;
  /** Reversionary format: condensed EIS over the outboard edge, no inset map (PG Figures 1-23 / 1-24). */
  rev: boolean;
}

export interface PfdHooks {
  /** CAS model shown on this PFD (Longitude) or null. */
  casOnPfd: boolean;
}

export class PfdRenderer {
  readonly adi = new AttitudeIndicator({ rect: { x: 0, y: 0, w: 1280, h: 700 }, cx: 640, cy: 280, style: ADI_G3K });
  readonly spd = new SpeedTape({ x: 318, y: 109, w: 92, h: 344, style: SPD_G3K, bugCount: 8 });
  readonly alt = new AltitudeTape({ x: 880, y: 110, w: 112, h: 340, style: ALT_G3K });
  readonly vsi = new VerticalSpeedIndicator({ x: 994, y: 118, w: 48, h: 324, style: { ...VSI_GARMIN_4000, palette: P, typeface: TF, labelSize: 18 } });
  readonly hsi = new Hsi({ cx: 640, cy: 590, radius: 140, style: HSI_G3K });
  readonly vdev = new DeviationScale({ x: 858, y: 280, style: { ...GS_SCALE_GARMIN, palette: P, typeface: TF } });
  readonly vnavDev = new DeviationScale({ x: 858, y: 280, style: { ...VDI_GARMIN, palette: P, typeface: TF } });
  readonly inset: MapPane;
  private readonly cas: CasWindow | null;
  private readonly altAlert = new AltitudeAlerter(ALT_ALERT_GARMIN);
  private readonly minsAlert = new MinimumsAlerter(MINIMUMS_GARMIN);
  private L: Layout = { x0: 0, w: 1280, split: false, cx: 640, adiCy: 280, bottom: 700, rev: false };
  private time = 0;
  // FMA change flash timers.
  private lastLat = '';
  private lastVert = '';
  private lastLatArmed = '';
  private lastVertArmed = '';
  private latFlash = 0;
  private vertFlash = 0;
  private lastAt = '';
  private atFlash = 0;
  private lastTa = 0;
  private hsiMapOn = false;
  private vnavTargetFt = NaN;
  private taFlash = 0;
  private readonly v: SimVars;

  constructor(readonly sys: G3000System, readonly side: 1 | 2, hooks: PfdHooks) {
    this.v = sys.vars;
    this.inset = new MapPane(sys, side === 1 ? 'inset1' : 'inset2', null, { x: 0, y: 402, w: 282, h: 296 }, true);
    this.cas = hooks.casOnPfd ? new CasWindow({ x: 1030, y: 470, w: 246, h: 220, model: sys.cas, style: CAS_PFD }) : null;
    this.layout(0, 1280, false);
    const s = this.spd.state;
    s.bugs.length = 0;
    for (let i = 0; i < 8; i++) s.bugs.push({ label: '', kt: NaN, visible: false, color: '' });
  }

  get animating(): boolean {
    return true;
  }

  /** CAS rows visible on this PFD (0 without a CAS window). */
  get casRows(): number {
    return this.cas ? this.cas.visibleRows : 0;
  }

  /** CAS scroll from the softkeys / GTC. */
  scrollCas(rows: number): void {
    if (this.cas) this.sys.cas.scrollBy(rows, this.cas.visibleRows);
  }

  // ================================================================ layout

  /**
   * Places every instrument for the full (1280) or split (outboard 780 px)
   * format. `cx` overrides the attitude centre: the reversionary format keeps
   * the full-format geometry centred near the display centre, right of the
   * condensed EIS (PG Figures 1-23 / 1-24), and hides the inset map.
   */
  layout(x0: number, w: number, split: boolean, cx0?: number): void {
    const L = this.L;
    const rev = cx0 !== undefined;
    const cx = cx0 ?? x0 + w / 2;
    if (L.x0 === x0 && L.w === w && L.split === split && L.cx === cx && L.rev === rev && this.adi.rect.w === w) return;
    const bottom = GDU_H - SOFTKEY_H - PFD_DATABAR_H;
    L.x0 = x0;
    L.w = w;
    L.split = split;
    L.rev = rev;
    L.bottom = bottom;
    L.cx = cx;
    L.adiCy = 280;
    this.adi.rect = { x: x0, y: 0, w, h: bottom };
    this.adi.cx = cx;
    this.adi.cy = 280;
    // Tapes: full format offsets from the PG figure (speed tape 322 px left of centre, altimeter 240 px right).
    const spdDx = split ? 250 : 322;
    const altDx = split ? 170 : 240;
    this.spd.x = cx - spdDx;
    this.alt.x = cx + altDx;
    this.vsi.x = this.alt.x + this.alt.w + 2;
    this.vdev.x = this.alt.x - 20;
    this.vnavDev.x = this.alt.x - 20;
    this.hsi.cx = cx;
    this.hsi.cy = split ? 596 : 590;
    this.hsi.radius = split ? 128 : 140;
    this.hsiMapOn = false;
    this.hsi.mode = 'rose';
    this.hsi.style = HSI_G3K;
    this.layoutInset();
    if (this.cas) {
      const cw = split ? 200 : 246;
      this.cas.w = cw;
      this.cas.h = split ? 170 : 206;
      this.cas.y = bottom - this.cas.h - 4;
      this.cas.x = this.side === 1 ? x0 + w - cw - 4 : x0 + 4;
    }
  }

  /** Inset map rectangle (lower-left corner; lower-right beside the CAS on PFD2) or hidden. */
  private layoutInset(): void {
    const L = this.L;
    const bottom = L.bottom;
    this.inset.setRect(L.split || L.rev ? { x: -1000, y: 0, w: 1, h: 1 } : this.side === 2 && this.cas ? { x: L.x0 + L.w - 282, y: 402, w: 282, h: bottom - 402 } : { x: L.x0, y: 402, w: 282, h: bottom - 402 });
  }

  // ================================================================ update

  update(dt: number): void {
    this.time += dt;
    const v = this.v;
    const s = this.side;
    const adc = v.get(vn(G3K.adcSel, s), s);
    const ahrs = v.get(vn(G3K.ahrsSel, s), s);
    const adcOk = v.get(vn(ADC.valid, adc)) >= 0.5;
    const attOk = v.get(vn(AHRS_ATT_VALID, ahrs), v.get(vn(ADC.ahrsValid, ahrs))) >= 0.5;
    const hdgOk = v.get(vn(AHRS_HDG_VALID, ahrs), v.get(vn(ADC.ahrsValid, ahrs))) >= 0.5;
    const onGround = v.get('gear.air_ground', 1) >= 0.5;

    // --- attitude
    const a = this.adi.state;
    a.valid = attOk;
    a.pitch = v.get(vn(ADC.pitch, ahrs));
    a.bank = v.get(vn(ADC.bank, ahrs));
    a.slip = v.get(vn(ADC.slip, ahrs));
    a.heading = v.get(vn(ADC.heading, ahrs));
    const fdOn = v.get(vn(AP.fdOn, s)) >= 0.5;
    a.fdVisible = fdOn && v.get('ap.fd_pitch_valid', 1) >= 0.5 && v.get('ap.fd_roll_valid', 1) >= 0.5 && (v.getString(AP.lateralActive) !== '' || v.getString(AP.verticalActive) !== '');
    a.fdPitch = v.get(AP.fdPitch);
    a.fdBank = v.get(AP.fdBank);
    const aoaNorm = v.get(this.sys.cfg.speedTape.aoaNormVar, NaN);
    const aoaDeg = v.get(vn(ADC_AOA, adc), NaN);
    // Pitch limit indicator within 4 deg of the stall AoA (PG §2.1 "Angle of Attack").
    if (Number.isFinite(aoaNorm) && aoaNorm > 0.2 && Number.isFinite(aoaDeg) && !onGround) {
      const stallAoa = aoaDeg / aoaNorm;
      const margin = stallAoa - aoaDeg;
      a.pliDeg = margin < 4 ? a.pitch + margin : NaN;
    } else a.pliDeg = NaN;
    this.adi.update(dt);

    // --- airspeed
    const sp = this.spd.state;
    sp.valid = adcOk;
    sp.ias = v.get(vn(ADC.ias, adc));
    sp.mach = v.get(vn(ADC.mach, adc));
    const rate = v.get(vn(ADC_IAS_RATE, adc), NaN);
    sp.accelKtS = Number.isFinite(rate) ? rate : NaN;
    const vmoVar = v.get(this.sys.cfg.speedTape.vmoVar, NaN);
    sp.maxKt = Number.isFinite(vmoVar) && vmoVar > 0 ? vmoVar : this.sys.cfg.speedTape.vmoKt;
    const stc = this.sys.cfg.speedTape;
    if (!onGround && Number.isFinite(aoaNorm) && aoaNorm > 0.05 && sp.ias > 40) {
      // Low-speed awareness from the AoA: V at a given normalized AoA ~ V * sqrt(aoaNorm / target) (lift ~ alpha * V^2). EST.
      sp.lowSpeedAwarenessKt = sp.ias * Math.sqrt(aoaNorm / stc.shakerNorm);
      sp.minManeuverKt = sp.ias * Math.sqrt(aoaNorm / stc.cautionNorm);
      const flaps = v.get(this.sys.cfg.flapsVar);
      sp.greenDotKt = flaps > 1 ? sp.ias * Math.sqrt(aoaNorm / stc.approachRefNorm) : NaN;
    } else {
      sp.lowSpeedAwarenessKt = NaN;
      sp.minManeuverKt = NaN;
      sp.greenDotKt = NaN;
    }
    const vert = v.getString(AP.verticalActive);
    const flc = vert === 'FLC' || vert === 'VFLC';
    const at = v.get(AP.athr) >= 0.5;
    sp.selectedIsMach = v.get(AP.speedIsMach) >= 0.5;
    sp.selectedKt = flc || at || this.sys.cfg.afcs.speedKnob ? v.get(AP.selSpeed) : NaN;
    sp.selectedMach = v.get(AP.selMach);
    sp.selectedManaged = v.get(G3K.speedFms) >= 0.5 || v.get('ap.at_spd_fms') >= 0.5;
    const defs = this.sys.vspeeds.defs;
    for (let i = 0; i < sp.bugs.length; i++) {
      const b = sp.bugs[i];
      const d = defs[i];
      if (!d) {
        b.visible = false;
        continue;
      }
      b.label = d.label;
      b.kt = this.sys.vspeeds.value(d.id);
      // Takeoff bugs are removed once airborne above the highest takeoff speed + 50 kt (EST, Garmin removes them in climb).
      b.visible = this.sys.vspeeds.on(d.id) && !(d.group === 'takeoff' && !onGround && sp.ias > b.kt + 50);
      b.color = this.sys.vspeeds.source(d.id) === 'told' ? P.magenta : '';
    }
    this.spd.update(dt);

    // --- altitude
    const t = this.alt.state;
    t.valid = adcOk;
    t.altFt = v.get(vn(ADC.baroAlt, adc));
    t.vsFpm = v.get(vn(ADC.vs, adc));
    t.selectedFt = v.get(AP.selAltitude);
    t.baroInHg = v.get(vn(ADC.baroSetting, adc), 29.92);
    t.baroStd = v.get(vn(ADC.baroStd, adc)) >= 0.5;
    t.baroUnit = v.get(vn(G3K.baroHpa, s)) >= 0.5 ? 'hpa' : 'inhg';
    t.baroPreselectInHg = t.baroStd ? v.get(vn(G3K.baroPreselect, s), 29.92) : NaN;
    // Baro transition alert: flashing setting when crossing the transition altitude / level (US 18,000 ft, PG §2.1).
    t.baroFlash = (!t.baroStd && t.altFt > 18000 && t.vsFpm > 0) || (t.baroStd && t.altFt < 18000 && t.vsFpm < 0 && t.altFt > 3000);
    t.metric = v.get(vn(G3K.metersOverlay, s)) >= 0.5;
    const minsMode = this.sys.mins.mode;
    const mins = this.sys.mins.effectiveFt();
    const raIdx = this.sys.cfg.raIndex;
    const raValid = this.sys.cfg.sensors.radioAltimeter && v.get(vn(RA_VALID, raIdx)) >= 0.5;
    const raFt = v.get(vn(RA_ALT, raIdx), NaN);
    const minsHeight = minsMode === MINS_MODE.radio ? raFt : t.altFt;
    this.minsAlert.update(minsHeight, Number.isFinite(mins) ? mins : NaN, onGround, dt);
    t.minimumsFt = minsMode === MINS_MODE.baro || minsMode === MINS_MODE.tempComp ? mins : NaN;
    t.minimumsPhase = this.minsAlert.phase;
    this.altAlert.update(t.altFt, t.selectedFt, dt);
    t.alertPhase = this.altAlert.phase;
    t.alertVisible = this.altAlert.visible;
    // VNAV target altitude (magenta box above the selected altitude) while a VNAV path mode is armed or active (PG §2.3).
    const vpth = v.getString(AP.verticalActive).startsWith('VP') || v.getString(AP.verticalArmed).indexOf('VP') >= 0 || v.getString(AP.verticalActive) === 'VFLC';
    this.vnavTargetFt = v.get(FMS.vnavValid) >= 0.5 && vpth ? v.get(FMS.vnavTargetAltFt) : NaN;
    t.vnavTargetFt = NaN;
    t.groundAltFt = raValid && raFt < 2500 ? t.altFt - raFt : NaN;
    this.alt.update(dt);

    // --- VSI
    const vs = this.vsi.state;
    vs.valid = adcOk;
    vs.vsFpm = t.vsFpm;
    vs.selectedFpm = vert === 'VS' ? v.get(AP.selVs) : NaN;
    const tod = v.get(FMS.todEteS);
    vs.requiredFpm = v.get(FMS.vnavValid) >= 0.5 && (tod <= 60 || v.getString(FMS.vnavPhase) === 'DES') ? v.get(FMS.vsRequiredFpm) : NaN;
    const ra = v.get('tcas.ra') >= 0.5;
    vs.raRedFrom = ra ? v.get('tcas.ra_vs_min_fpm', NaN) : NaN;
    vs.raRedTo = ra ? v.get('tcas.ra_vs_max_fpm', NaN) : NaN;
    this.vsi.update(dt);

    // --- HSI
    this.updateHsi(hdgOk, ahrs);

    // --- vertical deviation (GS / GP / VDI)
    const src = this.sys.navSource(s);
    const gd = this.vdev.state;
    const vd = this.vnavDev.state;
    gd.valid = false;
    gd.flag = '';
    vd.valid = false;
    vd.flag = '';
    if (src !== NAV_SOURCE.fms && v.get(vn(NAV.isLoc, src)) >= 0.5) {
      gd.color = P.green;
      gd.label = 'G';
      gd.valid = v.get(vn(NAV.gsValid, src)) >= 0.5;
      gd.dev = v.get(vn(NAV.gsDev, src));
      gd.flag = gd.valid ? '' : 'NO GS';
      gd.hollow = false;
    } else if (src === NAV_SOURCE.fms && v.get(FMS.approachActive) >= 0.5 && v.get(FMS.gpAngleDeg) > 0) {
      gd.color = P.magenta;
      gd.label = 'G';
      gd.valid = v.get(FMS.gpValid) >= 0.5;
      gd.dev = v.get(FMS.gpDev);
      gd.flag = gd.valid ? '' : 'NO GP';
      gd.hollow = false;
    } else if (v.get(FMS.vnavValid) >= 0.5 && src === NAV_SOURCE.fms) {
      // VDI: full scale (2 dots) = 1000 ft (PG §2.1 "Vertical Deviation").
      vd.valid = true;
      vd.color = P.magenta;
      vd.label = 'V';
      vd.dev = clamp(-v.get(FMS.vnavDevFt) / 1000, -1.2, 1.2);
    }

    // --- FMA flash timers
    const lat = v.getString(AP.lateralActive);
    const latArmed = v.getString(AP.lateralArmed);
    const vArmed = v.getString(AP.verticalArmed);
    if (lat !== this.lastLat) {
      if (this.lastLat !== '' && lat !== '') this.latFlash = MODE_FLASH_S;
      this.lastLat = lat;
    }
    if (vert !== this.lastVert) {
      if (this.lastVert !== '' && vert !== '') this.vertFlash = MODE_FLASH_S;
      this.lastVert = vert;
    }
    this.lastLatArmed = latArmed;
    this.lastVertArmed = vArmed;
    const atMode = v.getString(AP.athrMode);
    if (atMode !== this.lastAt) {
      if (this.lastAt !== '' && atMode !== '') this.atFlash = MODE_FLASH_S;
      this.lastAt = atMode;
    }
    this.latFlash = Math.max(0, this.latFlash - dt);
    this.vertFlash = Math.max(0, this.vertFlash - dt);
    this.atFlash = Math.max(0, this.atFlash - dt);
    const ta = v.get('tcas.ta');
    if (ta > this.lastTa) this.taFlash = 5;
    this.lastTa = ta;
    this.taFlash = Math.max(0, this.taFlash - dt);

    // --- inset map and CAS
    const mapMode = v.get(vn(G3K.pfdMap, s));
    const full = !this.L.split && !this.L.rev && !this.adi.state.decluttered;
    const hsiMap = full && mapMode === PFD_MAP.hsiMap;
    if (hsiMap !== this.hsiMapOn) {
      this.hsiMapOn = hsiMap;
      const h = this.hsi;
      h.mode = hsiMap ? 'arc' : 'rose';
      h.arcSpanDeg = 120;
      h.style = hsiMap ? HSI_G3K_ARC : HSI_G3K;
      const R = h.radius;
      if (hsiMap) this.inset.setRect({ x: h.cx - R - 60, y: h.cy - R - 30, w: 2 * R + 120, h: this.L.bottom - (h.cy - R - 30) }, { x: h.cx, y: h.cy, rangePx: R * 2 });
      else this.layoutInset();
    }
    this.inset.visible = full && mapMode === PFD_MAP.inset;
    if (this.inset.visible || hsiMap) this.inset.update(dt);
    this.cas?.update(dt);
  }

  private updateHsi(hdgOk: boolean, ahrs: number): void {
    const v = this.v;
    const s = this.side;
    const h = this.hsi.state;
    const trueRef = v.get(G3K.navAngleTrue) >= 0.5;
    h.valid = hdgOk;
    h.headingIsTrue = trueRef;
    h.heading = trueRef ? v.get(vn(ADC.headingTrue, ahrs)) : v.get(vn(ADC.heading, ahrs));
    h.turnRateDps = v.get(vn(ADC.turnRate, ahrs));
    h.selectedHeading = v.get(AP.selHeading);
    h.track = v.get(GPS.valid) >= 0.5 && v.get(GPS.gs) > 30 ? (trueRef ? v.get(GPS.trackTrue) : v.get(GPS.trackMag)) : NaN;
    const src = this.sys.navSource(s);
    h.courseVisible = true;
    h.phaseLabel = '';
    h.gsVisible = false;
    if (src === NAV_SOURCE.fms) {
      const obs = v.get(vn(G3K.obs, s)) >= 0.5;
      h.course = obs ? v.get(vn(G3K.obsCourse, s)) : v.get(FMS.dtkMag);
      h.courseColor = P.magenta;
      h.courseDouble = false;
      h.cdiValid = v.get(FMS.lnavValid) >= 0.5 || v.get(FMS.activeLegIndex, -1) >= 0;
      h.cdi = v.get(FMS.cdi);
      h.toFrom = v.get(FMS.toFrom, 1);
      h.xtkNm = v.get(FMS.xtkNm);
      h.sourceLabel = 'FMS';
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
    this.setBearing(h.bearing1, v.get(vn(G3K.brg1Source, s)), 1);
    this.setBearing(h.bearing2, v.get(vn(G3K.brg2Source, s)), 2);
    h.windValid = false;
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
    } else if (src === BRG_SOURCE.fms) {
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

  draw(ctx: Ctx2D): void {
    const L = this.L;
    const v = this.v;
    ctx.save();
    clipRect(ctx, L.x0, 0, L.w, GDU_H - SOFTKEY_H);
    this.adi.draw(ctx);
    const a = this.adi.state;
    if (!a.valid) this.drawFailBox(ctx, L.cx, 200, 'ATTITUDE FAIL');
    const ahrsIdx = v.get(vn(G3K.ahrsSel, this.side), this.side);
    if (v.get(vn(AHRS_ALIGNING, ahrsIdx)) >= 0.5) {
      box(ctx, L.cx - 170, 210, 340, 34, 'rgba(0,0,0,0.6)', '');
      TF.draw(ctx, 'AHRS ALIGN: Keep Wings Level', L.cx, 228, 22, P.white, 'center', 'middle');
    }
    this.spd.draw(ctx);
    this.alt.draw(ctx);
    this.vsi.draw(ctx);
    if (this.vdev.state.valid || this.vdev.state.flag) this.vdev.draw(ctx);
    else if (this.vnavDev.state.valid) this.vnavDev.draw(ctx);
    this.drawVnavTarget(ctx);
    this.drawAoa(ctx);
    if (this.hsiMapOn) {
      // Moving map inside the HSI arc (clipped to the compass circle and the area above the data bar).
      const h = this.hsi;
      ctx.save();
      ctx.beginPath();
      ctx.arc(h.cx, h.cy, h.radius + 2, 0, Math.PI * 2);
      ctx.clip();
      this.inset.draw(ctx);
      ctx.restore();
    }
    this.hsi.draw(ctx);
    this.drawHsiReadouts(ctx);
    this.drawAfcsBox(ctx);
    this.drawMsgIcon(ctx);
    this.drawComBox(ctx);
    this.drawNavStatus(ctx);
    this.drawWind(ctx);
    this.drawMinimums(ctx);
    this.drawRadioAlt(ctx);
    this.drawMarkers(ctx);
    this.drawAnnunciations(ctx);
    this.drawSensorWindows(ctx);
    this.drawDmeWindow(ctx);
    if (this.inset.visible) this.inset.draw(ctx);
    this.drawGcuWindow(ctx);
    if (this.cas) this.cas.draw(ctx);
    this.drawDataBar(ctx);
    ctx.restore();
  }

  /**
   * GCU 275 windows over the inset area (state/Gcu.ts; only aircraft with a GCU open them): active flight
   * plan with cursor, Direct-To, procedures, and the COM tuning prompt (EST layout after the G1000-family
   * PFD inset windows).
   */
  private drawGcuWindow(ctx: Ctx2D): void {
    const v = this.v;
    const s = this.side;
    const win = v.get(vn(G3K.gcuWindow, s));
    const comnav = v.get(vn(G3K.gcuComNav, s)) >= 0.5;
    if ((win === GCU_WINDOW.none && !comnav) || this.L.rev) return;
    const L = this.L;
    const x = L.x0 + 2;
    const w = 282;
    const y = 402;
    const bottom = L.bottom;
    if (comnav) {
      const r = v.get(vn(G3K.micSelect, s), s) >= 1.5 ? 2 : 1;
      dataBox(ctx, x, bottom - 44, w, 40, 'rgba(10,12,14,0.92)');
      TF.draw(ctx, r === 1 ? 'COM1 STBY' : 'COM2 STBY', x + 10, bottom - 24, 15, P.white, 'left', 'middle');
      TF.draw(ctx, fmtCom(v.get(vn(NAV.comStandby, r)), v.get(G3K.comSpacing833) >= 0.5), x + w - 10, bottom - 24, 20, P.cyan, 'right', 'middle');
    }
    if (win === GCU_WINDOW.none) return;
    const h = bottom - y - (comnav ? 48 : 4);
    dataBox(ctx, x, y, w, h, 'rgba(10,12,14,0.92)');
    const cur = v.get(vn(G3K.gcuCursor, s), -1);
    const fms = this.sys.fms;
    const legs = fms ? fms.plans.active.legs : null;
    const active = fms ? fms.plans.active.activeLegIndex : -1;
    const rowH = 24;
    if (win === GCU_WINDOW.proc) {
      TF.draw(ctx, 'PROCEDURES', x + w / 2, y + 16, 16, P.white, 'center', 'middle');
      const ok = !!this.sys.fpl?.plan.approachProcedure;
      for (let i = 0; i < GCU_PROC_ITEMS.length; i++) {
        const ry = y + 44 + i * rowH;
        if (i === cur) box(ctx, x + 6, ry - rowH / 2 + 2, w - 12, rowH - 4, P.cyan, '');
        TF.draw(ctx, GCU_PROC_ITEMS[i], x + 12, ry, 13, i === cur ? '#000000' : ok ? P.white : P.grey, 'left', 'middle');
      }
      return;
    }
    TF.draw(ctx, win === GCU_WINDOW.dto ? 'DIRECT TO' : 'ACTIVE FLIGHT PLAN', x + w / 2, y + 16, 16, P.white, 'center', 'middle');
    if (!legs || legs.length === 0) {
      TF.draw(ctx, '_____', x + w / 2, y + 50, 18, P.cyan, 'center', 'middle');
      return;
    }
    if (win === GCU_WINDOW.dto) {
      const i = cur >= 0 && cur < legs.length ? cur : Math.max(0, active);
      box(ctx, x + 60, y + 38, w - 120, 28, P.cyan, '');
      TF.draw(ctx, legIdent(legs[i]), x + w / 2, y + 52, 20, '#000000', 'center', 'middle');
      TF.draw(ctx, 'ENT: ACTIVATE', x + w / 2, y + 88, 13, P.white, 'center', 'middle');
      return;
    }
    const rows = Math.max(1, Math.floor((h - 36) / rowH));
    const anchor = cur >= 0 ? cur : Math.max(0, active);
    const first = Math.max(0, Math.min(legs.length - rows, anchor - (rows >> 1)));
    for (let k = 0; k < rows && first + k < legs.length; k++) {
      const i = first + k;
      const ry = y + 44 + k * rowH;
      if (i === cur) box(ctx, x + 6, ry - rowH / 2 + 2, w - 12, rowH - 4, P.cyan, '');
      TF.draw(ctx, legIdent(legs[i]), x + 14, ry, 16, i === cur ? '#000000' : i === active ? P.magenta : P.white, 'left', 'middle');
    }
  }

  private drawFailBox(ctx: Ctx2D, x: number, y: number, text: string): void {
    TF.draw(ctx, text, x, y, 26, P.red, 'center', 'middle', '#000000');
  }

  /** VNAV target altitude above the altimeter's selected altitude (magenta, PG §2.3 Figure 2-44). */
  private drawVnavTarget(ctx: Ctx2D): void {
    const t = this;
    if (!Number.isFinite(t.vnavTargetFt)) return;
    const x = this.alt.x;
    const y = this.alt.y - 68;
    dataBox(ctx, x, y, this.alt.w, 28, 'rgba(0,0,0,0.75)');
    TF.draw(ctx, fmtInt(Math.round(t.vnavTargetFt / 10) * 10), x + this.alt.w - 28, y + 15, 21, P.magenta, 'right', 'middle');
    TF.draw(ctx, 'FT', x + this.alt.w - 6, y + 17, 13, P.magenta, 'right', 'middle');
  }

  /** Normalized AoA gauge below the airspeed tape (PG §2.1 "Angle of Attack (AOA) Indicator"). */
  private drawAoa(ctx: Ctx2D): void {
    const v = this.v;
    const mode = v.get(vn(G3K.aoaMode, this.side));
    if (mode === AOA_MODE.off || this.L.split) return;
    const gearDown = v.get(this.sys.cfg.gearDownVar) >= 0.5;
    const flaps = v.get(this.sys.cfg.flapsVar) > 1;
    // Auto: displayed with the gear down and flaps set (Longitude OG 4-6); PG G3000 treats Auto as On.
    if (mode === AOA_MODE.auto && this.sys.cfg.variant === 'g5000' && !(gearDown && flaps)) return;
    const aoa = v.get(this.sys.cfg.speedTape.aoaNormVar, NaN);
    // Below the airspeed tape and its Mach readout (TBM CRG PFD figure: AOA box under the tape).
    const cx = this.spd.x + 20;
    const cy = this.spd.y + this.spd.h + 125;
    const r = 40;
    const a0 = Math.PI;
    const ang = (f: number): number => a0 + (Math.PI / 2) * clamp(f, 0, 1.1);
    box(ctx, cx - 58, cy - r - 16, 118, r + 40, 'rgba(0,0,0,0.55)', '', 1, 4);
    ctx.beginPath();
    ctx.arc(cx, cy, r, ang(0), ang(0.8));
    ctx.strokeStyle = P.white;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, ang(0.8), ang(1));
    ctx.strokeStyle = this.sys.cfg.variant === 'g5000' ? P.amber : P.red;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, ang(1), ang(1.1));
    ctx.strokeStyle = P.red;
    ctx.stroke();
    // Approach reference tick at 0.66 (Longitude OG 4-6).
    const ar = ang(this.sys.cfg.speedTape.approachRefNorm);
    line(ctx, cx + (r - 8) * Math.cos(ar), cy + (r - 8) * Math.sin(ar), cx + (r + 6) * Math.cos(ar), cy + (r + 6) * Math.sin(ar), P.green, 2);
    if (Number.isFinite(aoa)) {
      const an = ang(aoa);
      const col = aoa >= 1 ? P.red : aoa >= 0.8 ? P.amber : P.white;
      line(ctx, cx, cy, cx + (r + 3) * Math.cos(an), cy + (r + 3) * Math.sin(an), col, 3);
      TF.draw(ctx, fmtFixed(aoa, 2), cx + 30, cy + 14, 17, col, 'center', 'middle');
    }
    TF.draw(ctx, 'AOA', cx - 22, cy + 14, 14, P.white, 'center', 'middle');
  }

  private drawHsiReadouts(ctx: Ctx2D): void {
    const v = this.v;
    const h = this.hsi;
    const y = h.cy - h.radius - 24;
    // Selected heading (upper left) and course (upper right) for 3 s after a change (PG §2.1).
    if (this.sys.hdgChangedS < 3) {
      dataBox(ctx, h.cx - 176, y - 16, 102, 32);
      TF.draw(ctx, 'HDG', h.cx - 168, y, 17, P.white, 'left', 'middle');
      TF.draw(ctx, fmtDeg(v.get(AP.selHeading)), h.cx - 80, y, 22, P.cyan, 'right', 'middle');
    }
    if (this.sys.crsChangedS[this.side] < 3) {
      const src = this.sys.navSource(this.side);
      const crs = src === NAV_SOURCE.fms ? v.get(vn(G3K.obsCourse, this.side)) : v.get(vn(NAV.obs, src));
      dataBox(ctx, h.cx + 74, y - 16, 102, 32);
      TF.draw(ctx, 'CRS', h.cx + 82, y, 17, P.white, 'left', 'middle');
      TF.draw(ctx, fmtDeg(crs), h.cx + 168, y, 22, src === NAV_SOURCE.fms ? P.magenta : P.green, 'right', 'middle');
    }
    // OBS / SUSP annunciation lower right of the aircraft symbol.
    if (this.sys.navSource(this.side) === NAV_SOURCE.fms) {
      const susp = v.get(FMS.suspended) >= 0.5;
      const obs = v.get(vn(G3K.obs, this.side)) >= 0.5;
      if (susp || obs) TF.draw(ctx, susp ? 'SUSP' : 'OBS', h.cx + 40, h.cy + 36, 17, P.magenta, 'left', 'middle');
      if (v.getString(FMS.legType).startsWith('V')) TF.draw(ctx, 'HDG LEG', h.cx, h.cy + 56, 16, P.magenta, 'center', 'middle');
    }
  }

  private drawAfcsBox(ctx: Ctx2D): void {
    const v = this.v;
    const g5k = this.sys.cfg.variant === 'g5000';
    const L = this.L;
    const w = L.split ? 420 : g5k ? 560 : 420;
    const x = L.cx - w / 2;
    const h = 50;
    box(ctx, x, 0, w, h, '#16181c', G3K_COLORS.boxBorder, 1.5, 3);
    const map = this.sys.cfg.afcs.labelMap;
    const lbl = (s: string): string => (s && map[s] !== undefined ? map[s] : s);
    const lat = lbl(v.getString(AP.lateralActive));
    const latArmed = lbl(v.getString(AP.lateralArmed));
    const vert = lbl(v.getString(AP.verticalActive));
    const vertArmed = lbl(v.getString(AP.verticalArmed));
    const ap = v.get(AP.engaged) >= 0.5;
    const discWarn = v.get('ap.disc_warn') >= 0.5;
    const yd = v.get(AP.yd) >= 0.5;
    const blink = blinkOn(this.time, 2);
    // Cells: [A/T] [lat armed | lat active] [AP/YD] [vert active + ref] [vert armed].
    let cx = x;
    if (g5k && !L.split) {
      const atW = 110;
      const atMode = v.getString(AP.athrMode);
      if (atMode) TF.draw(ctx, atMode, cx + atW / 2, 17, 21, (this.atFlash > 0 && !blink) ? '#1b1e22' : P.green, 'center', 'middle');
      if (atMode === 'SPD' || atMode === 'MAX SPD' || atMode === 'MIN SPD') {
        const tgt = v.get('at.target_kt', NaN);
        if (Number.isFinite(tgt)) TF.draw(ctx, fmtInt(tgt), cx + atW / 2, 38, 17, P.cyan, 'center', 'middle');
      }
      line(ctx, cx + atW, 4, cx + atW, h - 4, G3K_COLORS.boxBorder, 1);
      cx += atW;
    }
    const remaining = x + w - cx;
    const latW = remaining * 0.36;
    const midW = remaining * 0.16;
    const vertW = remaining - latW - midW;
    // Lateral: armed (white, left) and active (green, right), flashing after a change.
    TF.draw(ctx, latArmed, cx + latW * 0.26, 25, 20, P.white, 'center', 'middle');
    if (lat) TF.draw(ctx, lat, cx + latW * 0.72, 25, 22, this.latFlash > 0 && !blink ? '#1b1e22' : P.green, 'center', 'middle');
    line(ctx, cx + latW, 4, cx + latW, h - 4, G3K_COLORS.boxBorder, 1);
    // Centre: AP (green / flashing amber reverse on disconnect), YD (G3000), FD arrow to the coupled side.
    const mx = cx + latW + midW / 2;
    if (discWarn && !ap) {
      if (blink) annunciation(ctx, 'AP', mx, 17, 20, P.amber);
    } else if (ap) TF.draw(ctx, 'AP', mx, 17, 20, P.green, 'center', 'middle');
    if (!g5k && yd) TF.draw(ctx, 'YD', mx, 38, 16, P.green, 'center', 'middle');
    if (g5k && v.get(AP.athr) >= 0.5) TF.draw(ctx, 'AT', mx, 38, 17, P.green, 'center', 'middle');
    else if (g5k && v.get('at.disc_warn') >= 0.5 && blink) annunciation(ctx, 'AT', mx, 38, 16, P.amber);
    const fdSide = this.sys.coupledSide();
    if (v.get(vn(AP.fdOn, 1)) >= 0.5 || v.get(vn(AP.fdOn, 2)) >= 0.5) {
      const ax = fdSide === 1 ? mx - midW / 2 + 8 : mx + midW / 2 - 8;
      const d = fdSide === 1 ? -1 : 1;
      triangle(ctx, ax + d * 6, 27, ax - d * 4, 21, ax - d * 4, 33, P.green);
    }
    line(ctx, cx + latW + midW, 4, cx + latW + midW, h - 4, G3K_COLORS.boxBorder, 1);
    // Vertical: active + reference, armed modes.
    const vx = cx + latW + midW;
    if (vert) {
      TF.draw(ctx, vert, vx + vertW * 0.22, 25, 22, this.vertFlash > 0 && !blink ? '#1b1e22' : P.green, 'center', 'middle');
      const ref = this.vertRef(vert);
      if (ref) TF.draw(ctx, ref, vx + vertW * 0.5, 25, 19, P.green, 'center', 'middle');
    }
    TF.draw(ctx, vertArmed, vx + vertW * 0.8, 25, 19, P.white, 'center', 'middle');
  }

  /** Mode reference text next to the active vertical mode (ALT ft, VS fpm with arrow, FLC kt / Mach). */
  private vertRef(vert: string): string {
    const v = this.v;
    if (vert === 'ALT' || vert === 'ALTS' || vert === 'ALTV') return vert === 'ALT' ? join2(fmtInt(v.get('ap.alt_ref_ft')), 'FT') : '';
    if (vert === 'VS') {
      const vs = v.get(AP.selVs);
      return join2(vs >= 0 ? '↑' : '↓', join2(fmtInt(Math.abs(vs)), 'FPM'));
    }
    if (vert === 'FLC' || vert === 'VFLC') return v.get(AP.speedIsMach) >= 0.5 ? join2('M', fmtMach(v.get(AP.selMach), 3)) : join2(fmtInt(v.get(AP.selSpeed)), 'KT');
    if (vert === 'PIT') return '';
    return '';
  }

  private drawMsgIcon(ctx: Ctx2D): void {
    const unread = this.v.get(G3K.msgUnread) >= 0.5;
    const x = this.L.x0 + 4;
    const on = !unread || blinkOn(this.time, 1.5);
    box(ctx, x, 3, 56, 58, 'rgba(10,12,14,0.85)', G3K_COLORS.boxBorder, 1.5, 4);
    box(ctx, x + 12, 8, 32, 30, unread && on ? P.cyan : '#1b4f63', '', 1, 3);
    TF.draw(ctx, 'M', x + 28, 24, 26, unread && on ? '#000000' : P.white, 'center', 'middle');
    TF.draw(ctx, 'MSG', x + 28, 49, 16, P.white, 'center', 'middle');
  }

  private drawComBox(ctx: Ctx2D): void {
    const v = this.v;
    const L = this.L;
    const w = 180;
    const x = L.x0 + L.w - w - 4;
    const mic = v.get(vn(G3K.micSelect, this.side), this.side);
    dataBox(ctx, x, 3, w, 48, 'rgba(10,12,14,0.85)');
    const r = mic >= 1 && mic <= 2 ? mic : 1;
    TF.draw(ctx, r === 1 ? 'COM1' : 'COM2', x + 10, 18, 16, P.white, 'left', 'middle');
    // Transmitting (push-to-talk keyed on this side): TX beside the COM label (optional var, aircraft with PTT modelling).
    if (v.get(vn(G3K.comTx, this.side)) >= 0.5) TF.draw(ctx, 'TX', x + 62, 18, 14, P.green, 'left', 'middle');
    TF.draw(ctx, fmtCom(v.get(vn(NAV.comActive, r)), v.get(G3K.comSpacing833) >= 0.5), x + w - 10, 18, 22, P.green, 'right', 'middle');
    const other = r === 1 ? 2 : 1;
    TF.draw(ctx, other === 1 ? 'COM1' : 'COM2', x + 10, 38, 14, P.grey, 'left', 'middle');
    TF.draw(ctx, fmtCom(v.get(vn(NAV.comActive, other)), v.get(G3K.comSpacing833) >= 0.5), x + w - 10, 38, 17, P.white, 'right', 'middle');
    // XPDR code and mode under the COM box (G5000 style).
    const code = v.get(NAV.xpdrCode);
    const mode = v.get(NAV.xpdrMode);
    const ident = v.get(G3K.xpdrIdentS) > 0;
    dataBox(ctx, x + 70, 54, w - 70, 24, 'rgba(10,12,14,0.85)');
    TF.draw(ctx, ident ? 'IDENT' : mode <= 1 ? 'STBY' : mode === 2 ? 'ON' : 'ALT', x + 78, 67, 14, ident ? P.green : mode <= 1 ? P.white : P.green, 'left', 'middle');
    TF.draw(ctx, fmtSquawk(code), x + w - 8, 67, 18, mode <= 1 ? P.white : P.green, 'right', 'middle');
  }

  /** PFD navigation status bar right of the HSI: active leg and DIS / BRG (G3000) or DIS / ETE (G5000) (PG §5.1). */
  private drawNavStatus(ctx: Ctx2D): void {
    const v = this.v;
    const L = this.L;
    if (this.adi.state.decluttered) return;
    const x = L.split ? L.cx + 90 : L.cx + 142;
    const w = L.split ? L.x0 + L.w - x - 6 : 286;
    const y = 470;
    const casSide = this.cas && this.side === 1;
    const bx = casSide ? Math.min(x, L.x0 + L.w - this.cas!.w - w - 10) : x;
    dataBox(ctx, bx, y, w, 58, 'rgba(10,12,14,0.8)');
    const to = v.getString(FMS.nextWptIdent);
    const from = v.getString(FMS.fromWptIdent);
    const tod = v.get(FMS.todEteS);
    if (!to) {
      TF.draw(ctx, 'DIS', bx + 12, y + 42, 15, P.white, 'left', 'middle');
      TF.draw(ctx, '__._', bx + 50, y + 42, 19, P.magenta, 'left', 'middle');
      TF.draw(ctx, 'BRG', bx + w * 0.55, y + 42, 15, P.white, 'left', 'middle');
      TF.draw(ctx, '___°', bx + w * 0.55 + 40, y + 42, 19, P.magenta, 'left', 'middle');
      return;
    }
    const active = v.get(FMS.activeLegIndex, -1);
    const direct = from === 'P.POS' || v.getString(FMS.legType) === 'DF';
    const legTxt = direct ? join2('D→ ', to) : from ? join2(join2(from, ' → '), to) : to;
    TF.draw(ctx, legTxt, bx + w / 2, y + 16, 20, P.magenta, 'center', 'middle');
    const dis = v.get(FMS.distToWptNm);
    if (v.get(FMS.vnavValid) >= 0.5 && tod > 0 && tod <= 60) {
      TF.draw(ctx, 'TOD within 1 minute', bx + w / 2, y + 42, 17, P.white, 'center', 'middle');
      return;
    }
    TF.draw(ctx, 'DIS', bx + 12, y + 42, 15, P.white, 'left', 'middle');
    valueUnit(ctx, fmtDist(dis), 'NM', bx + 46, y + 42, 20, P.magenta);
    if (this.sys.cfg.variant === 'g5000') {
      TF.draw(ctx, 'ETE', bx + w * 0.56, y + 42, 15, P.white, 'left', 'middle');
      TF.draw(ctx, fmtHms(v.get(FMS.eteToWptS)), bx + w * 0.56 + 38, y + 42, 20, P.magenta, 'left', 'middle');
    } else {
      TF.draw(ctx, 'BRG', bx + w * 0.56, y + 42, 15, P.white, 'left', 'middle');
      TF.draw(ctx, fmtDeg(v.get(FMS.bearingToWptMag)), bx + w * 0.56 + 40, y + 42, 20, P.magenta, 'left', 'middle');
    }
    void active;
  }

  /** Wind window upper left of the HSI (PG §2.3 "Wind Data"): computed from GPS ground vector and air vector. */
  private drawWind(ctx: Ctx2D): void {
    const v = this.v;
    const opt = v.get(vn(G3K.windOption, this.side));
    if (opt === WIND_OPTION.off || this.adi.state.decluttered) return;
    // Right of the airspeed tape, above the HSI's left side (TBM CRG PFD figure: "NO WIND DATA" box).
    const W = 96;
    const x = this.spd.x + this.spd.w + 16;
    const y = this.spd.y + this.spd.h + 2;
    dataBox(ctx, x, y, W, 54, 'rgba(10,12,14,0.8)');
    const adc = v.get(vn(G3K.adcSel, this.side), this.side);
    const ahrs = v.get(vn(G3K.ahrsSel, this.side), this.side);
    const tas = v.get(vn(ADC.tas, adc));
    const gs = v.get(GPS.gs);
    const valid = v.get(GPS.valid) >= 0.5 && tas > 30 && v.get('gear.air_ground', 1) < 0.5;
    if (!valid) {
      TF.draw(ctx, 'NO WIND', x + W / 2, y + 18, 15, P.white, 'center', 'middle');
      TF.draw(ctx, 'DATA', x + W / 2, y + 37, 15, P.white, 'center', 'middle');
      return;
    }
    const hdgT = v.get(vn(ADC.headingTrue, ahrs)) * DEG2RAD;
    const trkT = v.get(GPS.trackTrue) * DEG2RAD;
    const wn = gs * Math.cos(trkT) - tas * Math.cos(hdgT);
    const we = gs * Math.sin(trkT) - tas * Math.sin(hdgT);
    const spd = Math.hypot(wn, we);
    const fromT = wrap360(Math.atan2(-we, -wn) * RAD2DEG);
    const magVar = v.get(GPS.magVar);
    const fromMag = wrap360(fromT - magVar);
    const hdgMag = v.get(vn(ADC.heading, ahrs));
    // Arrow shows where the wind blows to, relative to the aircraft heading.
    const rel = (fromMag + 180 - hdgMag) * DEG2RAD;
    const ax = x + 20;
    const ay = y + 27;
    if (opt === WIND_OPTION.headXwind) {
      const relFrom = (fromMag - hdgMag) * DEG2RAD;
      const head = spd * Math.cos(relFrom);
      const cross = spd * Math.sin(relFrom);
      TF.draw(ctx, head >= 0 ? '↓' : '↑', x + 12, y + 18, 17, P.white, 'left', 'middle');
      TF.draw(ctx, fmtInt(Math.abs(head)), x + 30, y + 18, 18, P.white, 'left', 'middle');
      TF.draw(ctx, cross >= 0 ? '←' : '→', x + 12, y + 40, 17, P.white, 'left', 'middle');
      TF.draw(ctx, fmtInt(Math.abs(cross)), x + 30, y + 40, 18, P.white, 'left', 'middle');
      return;
    }
    if (spd >= 1) {
      const dx = Math.sin(rel) * 15;
      const dy = -Math.cos(rel) * 15;
      line(ctx, ax - dx, ay - dy, ax + dx, ay + dy, P.white, 2.5);
      const hx = ax + dx;
      const hy = ay + dy;
      const ang = Math.atan2(dy, dx);
      triangle(ctx, hx + Math.cos(ang) * 4, hy + Math.sin(ang) * 4, hx - Math.cos(ang - 0.5) * 9, hy - Math.sin(ang - 0.5) * 9, hx - Math.cos(ang + 0.5) * 9, hy - Math.sin(ang + 0.5) * 9, P.white);
    }
    if (opt === WIND_OPTION.arrowDirSpeed) {
      TF.draw(ctx, fmtDeg(fromMag), x + W - 6, y + 16, 17, P.white, 'right', 'middle');
      valueUnit(ctx, fmtInt(spd), 'KT', x + W - 6, y + 39, 18, P.white, 'right');
    } else valueUnit(ctx, fmtInt(spd), 'KT', x + W - 6, y + 28, 20, P.white, 'right');
  }

  /** Minimums box lower-left of the altimeter (PG §2.4 Figure 2-50). */
  private drawMinimums(ctx: Ctx2D): void {
    const m = this.sys.mins;
    const mode = m.mode;
    if (mode === MINS_MODE.off || this.adi.state.decluttered) return;
    const ph = this.minsAlert.phase;
    if (ph === 'hidden' || ph === 'inhibited') {
      // Shown within 2,500 ft of the minimums (PG); on the ground keep it visible for set-up.
      if (!(this.v.get('gear.air_ground', 1) >= 0.5)) return;
    }
    const col = ph === 'reached' ? P.amber : ph === 'near' ? P.white : P.cyan;
    const x = this.alt.x - 118;
    const y = this.alt.y + this.alt.h + 8;
    dataBox(ctx, x, y, 110, 42, 'rgba(10,12,14,0.8)');
    const label = mode === MINS_MODE.radio ? 'RA MIN' : mode === MINS_MODE.tempComp ? 'TEMP COMP' : 'BARO MIN';
    TF.draw(ctx, label, x + 55, y + 12, 13, P.white, 'center', 'middle');
    valueUnit(ctx, fmtInt(m.effectiveFt()), 'FT', x + 104, y + 30, 20, col, 'right');
  }

  /** Radar altitude upper right of the HSI (PG §2.4 "Radar Altimeter", Table 2-3 resolution). */
  private drawRadioAlt(ctx: Ctx2D): void {
    const v = this.v;
    if (!this.sys.cfg.sensors.radioAltimeter) return;
    const i = this.sys.cfg.raIndex;
    const h = this.hsi;
    const x = h.cx + 104;
    const y = h.cy - h.radius - 60;
    const valid = v.get(vn(RA_VALID, i)) >= 0.5;
    const ncd = v.get(vn(RA_NCD, i)) >= 0.5;
    if (!valid && !ncd) {
      dataBox(ctx, x, y, 100, 32, 'rgba(10,12,14,0.8)');
      TF.draw(ctx, 'RA FAIL', x + 50, y + 16, 18, P.amber, 'center', 'middle');
      return;
    }
    const ft = v.get(vn(RA_ALT, i));
    if (!valid || ft > 2500) return;
    const reached = this.sys.mins.mode === MINS_MODE.radio && ft <= this.sys.mins.valueFt;
    dataBox(ctx, x, y, 100, 32, 'rgba(10,12,14,0.8)');
    TF.draw(ctx, 'RA', x + 8, y + 16, 15, P.white, 'left', 'middle');
    TF.draw(ctx, fmtInt(quantizeRadioAlt(Math.max(0, ft))), x + 92, y + 16, 22, reached ? P.amber : P.green, 'right', 'middle');
  }

  private drawMarkers(ctx: Ctx2D): void {
    const v = this.v;
    const kind: MarkerKind = v.get(NAV.markerOuter) >= 0.5 ? 1 : v.get(NAV.markerMiddle) >= 0.5 ? 2 : v.get(NAV.markerInner) >= 0.5 ? 3 : 0;
    if (!kind) return;
    if (!blinkOn(this.time, kind === 1 ? 2 : kind === 2 ? 3 : 6)) return;
    drawMarkerBeacon(ctx, this.alt.x - 30, this.alt.y - 18, kind, 'garmin', P, TF, 26);
  }

  /** Traffic (upper left of the HSI) and terrain (upper left of the altimeter) annunciations (PG §2.4). */
  private drawAnnunciations(ctx: Ctx2D): void {
    const v = this.v;
    const blink = blinkOn(this.time, 2);
    const h = this.hsi;
    const ta = v.get('tcas.ta');
    const ra = v.get('tcas.ra') >= 0.5;
    if (ra || ta > 0) {
      if (!(this.taFlash > 0 && !blink)) annunciation(ctx, 'TRAFFIC', h.cx - h.radius - 64, h.cy - h.radius - 50, 18, ra ? P.red : P.amber, ra ? P.white : '#000000');
    } else {
      const mode = v.get(NAV.xpdrMode);
      const status = this.sys.cfg.traffic === 'TCAS2' ? (mode === 4 ? 'TA ONLY' : mode < 4 && mode >= 0 ? 'TCAS OFF' : '') : mode <= 1 ? 'TAS STBY' : '';
      if (status && !this.adi.state.decluttered) TF.draw(ctx, status, h.cx - h.radius - 64, h.cy - h.radius - 50, 16, P.white, 'center', 'middle', '#000000');
    }
    const ax = this.alt.x - 70;
    const ay = 64;
    if (v.get('alert.taws_warning') >= 0.5) annunciation(ctx, 'PULL UP', ax, ay, 20, P.red, P.white);
    else if (v.get('alert.taws_caution') >= 0.5) {
      const txt = v.getString('taws.alert') || 'TERRAIN';
      annunciation(ctx, txt.length > 14 ? 'TERRAIN' : txt, ax, ay, 18, P.amber);
    } else if (v.get('taws.test') >= 0.5) annunciation(ctx, this.sys.cfg.taws === 'B' ? 'TAWS TEST' : 'TERR TEST', ax, ay, 16, P.white);
    else if (v.get('taws.inop') >= 0.5) annunciation(ctx, 'TAWS FAIL', ax, ay, 16, P.amber);
    // AP / A/T disconnect and mistrim annunciations in the ADI.
    if (v.get('ap.mistrim') >= 0.5) annunciation(ctx, 'PTRM', this.L.cx + 150, 110, 17, P.amber);
    // LOW ALT on SBAS approaches (PG §2.4): FAF active and >= 164 ft below the FAF altitude (approximated from VNAV deviation).
    if (v.get(FMS.approachActive) >= 0.5 && v.get(FMS.vnavDevFt) < -164 && v.get('alert.taws_caution') < 0.5) annunciation(ctx, 'LOW ALT', ax, ay + 30, 16, P.amber);
  }

  /** Comparator and reversionary sensor windows (PG §2.4 "System Alerting"). */
  private drawSensorWindows(ctx: Ctx2D): void {
    const v = this.v;
    const L = this.L;
    const x = L.x0 + L.w - 150;
    let y = 96;
    const mask = v.get(G3K.miscompare);
        for (let i = 0; i < 5; i++) {
      if (!(mask & (1 << i))) continue;
      annunciation(ctx, MISCOMP_TXT[i], x + 70, y, 15, P.amber);
      y += 24;
    }
    if (this.sys.cfg.pfdCount === 2) {
      const a1 = v.get(vn(G3K.adcSel, 1), 1);
      const a2 = v.get(vn(G3K.adcSel, 2), 2);
      const h1 = v.get(vn(G3K.ahrsSel, 1), 1);
      const h2 = v.get(vn(G3K.ahrsSel, 2), 2);
      if (a1 === a2) {
        annunciation(ctx, join2('BOTH ON ADC', fmtInt(a1)), x + 70, y, 15, P.amber);
        y += 24;
      }
      if (h1 === h2) annunciation(ctx, join2('BOTH ON AHRS', fmtInt(h1)), x + 70, y, 15, P.amber);
    }
  }

  /** DME information window left of the HSI (PG §2.1 "DME Information Window"). */
  private drawDmeWindow(ctx: Ctx2D): void {
    const v = this.v;
    if (v.get(vn(G3K.dmeWindow, this.side)) < 0.5 || this.L.split) return;
    const r = Math.min(this.side, this.sys.cfg.radios.nav);
    const h = this.hsi;
    const x = h.cx - h.radius - 190;
    const y = h.cy + 20;
    dataBox(ctx, x, y, 170, 50, 'rgba(10,12,14,0.8)');
    TF.draw(ctx, NAV_LBL[r] ?? 'NAV', x + 8, y + 15, 15, P.white, 'left', 'middle');
    TF.draw(ctx, fmtNav(v.get(vn(NAV.activeFreq, r))), x + 162, y + 15, 19, P.green, 'right', 'middle');
    TF.draw(ctx, 'DME', x + 8, y + 36, 15, P.white, 'left', 'middle');
    const valid = v.get(vn(NAV.dmeValid, r)) >= 0.5;
    valueUnit(ctx, valid ? fmtDist(v.get(vn(NAV.dmeNm, r))) : '___', 'NM', x + 162, y + 36, 19, P.green, 'right');
  }

  /** Bottom data bar: TAS / GS, OAT / ISA, bearing information windows, TMR / UTC. */
  private drawDataBar(ctx: Ctx2D): void {
    const v = this.v;
    const L = this.L;
    const y = L.bottom;
    const h = PFD_DATABAR_H;
    box(ctx, L.x0, y, L.w, h, G3K_COLORS.dataBar, '');
    line(ctx, L.x0, y, L.x0 + L.w, y, G3K_COLORS.boxBorder, 1);
    const adc = v.get(vn(G3K.adcSel, this.side), this.side);
    const x = L.x0 + 8;
    const r1 = y + 15;
    const r2 = y + 38;
    TF.draw(ctx, 'TAS', x, r1, 15, P.white, 'left', 'middle');
    valueUnit(ctx, fmtInt(v.get(vn(ADC.tas, adc))), 'KT', x + 40, r1, 19, P.white);
    TF.draw(ctx, 'GS', x, r2, 15, P.white, 'left', 'middle');
    valueUnit(ctx, v.get(GPS.valid) >= 0.5 ? fmtInt(v.get(GPS.gs)) : '___', 'KT', x + 40, r2, 19, P.white);
    const sat = v.get(vn(ADC.sat, adc), NaN);
    const isa = sat - (15 - 0.0019812 * v.get(vn(ADC_PRESS_ALT, adc), v.get(vn(ADC.baroAlt, adc))));
    TF.draw(ctx, 'OAT', x + 128, r1, 15, P.white, 'left', 'middle');
    TF.draw(ctx, Number.isFinite(sat) ? join2(fmtInt(sat), '°C') : '__°C', x + 172, r1, 19, P.white, 'left', 'middle');
    TF.draw(ctx, 'ISA', x + 128, r2, 15, P.white, 'left', 'middle');
    TF.draw(ctx, Number.isFinite(isa) ? join2(fmtSigned(isa), '°C') : '__°C', x + 172, r2, 19, P.white, 'left', 'middle');
    // Bearing information windows (PG Figure 2-22).
    const b1 = v.get(vn(G3K.brg1Source, this.side));
    const b2 = v.get(vn(G3K.brg2Source, this.side));
    if (!L.split) {
      // Reversionary: the bar starts right of the EIS, so the windows move right of the OAT / ISA fields.
      this.drawBrgInfo(ctx, b1, 1, L.rev ? L.cx - 10 : L.cx - 70, r1, r2, 'right');
      this.drawBrgInfo(ctx, b2, 2, L.rev ? L.cx + 50 : L.cx + 70, r1, r2, 'left');
    }
    // Timer and UTC.
    const tx = L.x0 + L.w - 200;
    TF.draw(ctx, 'TMR', tx, r1, 15, P.white, 'left', 'middle');
    TF.draw(ctx, fmtHms(this.sys.timer.seconds, true), L.x0 + L.w - 10, r1, 19, P.white, 'right', 'middle');
    TF.draw(ctx, 'UTC', tx, r2, 15, P.white, 'left', 'middle');
    const utc = v.get(GPS.valid) >= 0.5 ? v.get(GPS.utcH, v.get('env.time_utc_h')) : v.get('env.time_utc_h');
    TF.draw(ctx, fmtClockHms(utc), L.x0 + L.w - 10, r2, 19, P.white, 'right', 'middle');
  }

  private drawBrgInfo(ctx: Ctx2D, src: number, which: 1 | 2, x: number, r1: number, r2: number, align: 'left' | 'right'): void {
    if (src === BRG_SOURCE.off) return;
    const v = this.v;
    let ident = '';
    let dist = NaN;
    let label = '';
    let freq = '';
    if (src === BRG_SOURCE.nav1 || src === BRG_SOURCE.nav2) {
      const r = src === BRG_SOURCE.nav1 ? 1 : 2;
      label = NAV_LBL[r] ?? 'NAV';
      ident = v.getString(vn(NAV.ident, r));
      if (!ident || v.get(vn(NAV.received, r)) < 0.5) freq = fmtNav(v.get(vn(NAV.activeFreq, r)));
      if (v.get(vn(NAV.dmeValid, r)) >= 0.5) dist = v.get(vn(NAV.dmeNm, r));
      if (v.get(vn(NAV.isLoc, r)) >= 0.5) {
        ident = '';
        freq = '';
      }
    } else if (src === BRG_SOURCE.fms) {
      label = 'FMS';
      ident = v.getString(FMS.nextWptIdent);
      dist = v.get(FMS.distToWptNm, NaN);
    } else if (src === BRG_SOURCE.adf) {
      label = 'ADF';
      freq = fmtAdf(v.get(vn(NAV.adfActive, 1)));
      ident = v.getString(vn(NAV.adfIdent, 1));
    }
    const dir = align === 'right' ? -1 : 1;
    const noData = !ident && !freq;
    if (Number.isFinite(dist)) valueUnit(ctx, fmtDist(dist), 'NM', x, r1, 18, P.cyan, align);
    let cx = x;
    // Pointer icon (single / double line arrow).
    const iw = 30;
    const iy = r2;
    const ix0 = align === 'right' ? cx - iw : cx;
    ctx.beginPath();
    if (which === 1) {
      ctx.moveTo(ix0, iy);
      ctx.lineTo(ix0 + iw, iy);
    } else {
      ctx.moveTo(ix0, iy - 3);
      ctx.lineTo(ix0 + iw, iy - 3);
      ctx.moveTo(ix0, iy + 3);
      ctx.lineTo(ix0 + iw, iy + 3);
    }
    ctx.strokeStyle = P.cyan;
    ctx.lineWidth = 2;
    ctx.stroke();
    cx += dir * (iw + 6);
    TF.draw(ctx, label, cx, r2, 15, P.cyan, align, 'middle');
    cx += dir * (TF.width(ctx, label, 15) + 8);
    TF.draw(ctx, noData ? 'NO DATA' : ident || freq, cx, r2, 18, noData ? P.white : P.cyan, align, 'middle');
  }
}

void circle;
