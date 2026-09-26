/**
 * PlaneView II / Symmetry primary flight display window (2/3 or full).
 *
 * Layout from the G650ER / G600 cockpit photographs and the G650 FSB
 * (FAA FSB GVI Rev 11) / G550 OM 2A-31 descriptions:
 *  - flight mode annunciator across the top (A/T, lateral, vertical, AP
 *    status with the PFD CMD coupling arrow);
 *  - large attitude display (SmartView synthetic vision when enabled) with
 *    speed tape left, altitude tape and VSI right, selected speed above
 *    the speed tape, Mach below it, selected altitude above and the
 *    barometric setting below the altitude tape;
 *  - HUD-like flight path symbol ("FPV" on the SMC PFD page) with the
 *    flight path guidance cue and acceleration caret (EST: shown when the
 *    FPV is selected and the flight director is on, replacing the single
 *    cue command bars);
 *  - radio altitude box under the aircraft symbol, minimums readout;
 *  - lateral / vertical deviation scales, the HSI (arc, rose or arc map)
 *    with the navigation source, course, bearing pointers, wind and
 *    preview (cyan ghost) needles for the auto-tuned ILS.
 * Colours: selected targets cyan, FMS magenta, radio navigation green,
 * active modes green / armed white (Honeywell convention, see style.ts).
 *
 * Sensor reversion: the side's ADC / IRS come from the SENSOR page
 * (EPIC_VARS.adcSel / ahrsSel); a cross-side source is annunciated in amber
 * ("ADC 2", EST placement).
 */
import { ADC, AP, FMS, GPS, NAV } from '../../../core/vars';
import { AFCS_VARS } from '../../../systems/autopilot/vars';
import { SENSOR_VARS } from '../../../systems/sensors/vars';
import { ALT_ALERT_HONEYWELL, AltitudeAlerter, MINIMUMS_HONEYWELL, MinimumsAlerter } from '../../common/alerting';
import { blinkOn } from '../../common/dynamics';
import { fmtFixed, fmtInt } from '../../common/format';
import { AttitudeIndicator, quantizeRadioAlt } from '../../common/draw/AttitudeIndicator';
import { AltitudeTape } from '../../common/draw/AltitudeTape';
import { SpeedTape } from '../../common/draw/SpeedTape';
import { VerticalSpeedIndicator } from '../../common/draw/VerticalSpeed';
import { Hsi } from '../../common/draw/Hsi';
import { DeviationScale } from '../../common/draw/DeviationScale';
import { MovingMap } from '../../common/draw/MovingMap';
import { ADI_EPIC, ADI_EPIC_SVS, ALT_TAPE_EPIC, GS_EPIC, HSI_EPIC, LOC_EPIC, MAP_EPIC, SPEED_TAPE_EPIC, VSI_EPIC } from './styles';
export { ADI_EPIC, ADI_EPIC_SVS, ALT_TAPE_EPIC, HSI_EPIC, SPEED_TAPE_EPIC, VSI_EPIC } from './styles';
import type { Ctx2D } from '../../common/draw/context';
import { C, rect, seg, text, textBold } from '../style';
import { BrgSrc, EPIC_VARS, HsiMode, NavSrc, Win } from '../vars';
import { EpicWindow, type EpicServices } from './window';
import { SyntheticVision } from './svs';

const DEG = Math.PI / 180;
const G = 9.80665;
const KT_TO_MS = 0.514444;

/** AFCS mode names -> Gulfstream / Honeywell FMA text (EST where the FSB does not name them). */
const FMA_TEXT: Record<string, string> = {
  NONE: '',
  ROL: 'ROLL',
  LVL: 'LVL',
  HDG: 'HDG',
  TRK: 'TRK',
  LNAV: 'LNAV',
  VOR: 'VOR',
  LOC: 'LOC',
  BC: 'BC',
  TO: 'TO',
  GA: 'GA',
  CWS: 'CWS',
  ROLLOUT: 'ROLLOUT',
  PIT: 'PTCH',
  ALT: 'ALT',
  ALTS: 'ASEL',
  ALTV: 'VASEL',
  VS: 'VS',
  FPA: 'FPA',
  FLC: 'FLCH',
  VPATH: 'VPATH',
  VFLC: 'VFLCH',
  VALT: 'VALT',
  GS: 'GS',
  GP: 'GP',
  FLARE: 'FLARE',
};

/** Translates an AFCS mode string (possibly several space separated armed modes); cached per input. */
const fmaCache = new Map<string, string>();
export function fmaText(raw: string): string {
  let t = fmaCache.get(raw);
  if (t === undefined) {
    t = raw
      .split(/\s+/)
      .filter((x) => x)
      .map((x) => FMA_TEXT[x] ?? x)
      .filter((x) => x)
      .join(' ');
    if (fmaCache.size < 256) fmaCache.set(raw, t);
  }
  return t;
}

/** Sensor var names of the selected ADC / IRS / RA (rebuilt only when the selection changes). */
class SensorNames {
  adc = -1;
  ahrs = -1;
  ra = -1;
  ias = '';
  mach = '';
  alt = '';
  vs = '';
  tas = '';
  baro = '';
  baroStd = '';
  adcValid = '';
  aoa = '';
  iasRate = '';
  pitch = '';
  bank = '';
  hdg = '';
  hdgTrue = '';
  slip = '';
  attValid = '';
  hdgValid = '';
  raAlt = '';
  raValid = '';

  set(adc: number, ahrs: number, ra: number): void {
    if (adc !== this.adc) {
      this.adc = adc;
      this.ias = ADC.ias(adc);
      this.mach = ADC.mach(adc);
      this.alt = ADC.baroAlt(adc);
      this.vs = ADC.vs(adc);
      this.tas = ADC.tas(adc);
      this.baro = ADC.baroSetting(adc);
      this.baroStd = ADC.baroStd(adc);
      this.adcValid = ADC.valid(adc);
      this.aoa = SENSOR_VARS.aoa(adc);
      this.iasRate = SENSOR_VARS.iasRate(adc);
    }
    if (ahrs !== this.ahrs) {
      this.ahrs = ahrs;
      this.pitch = ADC.pitch(ahrs);
      this.bank = ADC.bank(ahrs);
      this.hdg = ADC.heading(ahrs);
      this.hdgTrue = ADC.headingTrue(ahrs);
      this.slip = ADC.slip(ahrs);
      this.attValid = SENSOR_VARS.attValid(ahrs);
      this.hdgValid = SENSOR_VARS.hdgValid(ahrs);
    }
    if (ra !== this.ra) {
      this.ra = ra;
      this.raAlt = SENSOR_VARS.raAlt(ra);
      this.raValid = SENSOR_VARS.raValid(ra);
    }
  }
}

/** Navigation receiver var names (NAV1..3). */
const NAV_NAMES = [1, 2, 3].map((r) => ({
  cdi: NAV.cdi(r),
  toFrom: NAV.toFrom(r),
  received: NAV.received(r),
  isLoc: NAV.isLoc(r),
  obs: NAV.obs(r),
  gsValid: NAV.gsValid(r),
  gsDev: NAV.gsDev(r),
  dmeValid: NAV.dmeValid(r),
  dmeNm: NAV.dmeNm(r),
  freq: NAV.activeFreq(r),
  bearing: NAV.bearing(r),
  bearingValid: NAV.bearingValid(r),
  ident: NAV.ident(r),
  locCourse: NAV.locCourse(r),
}));
const ADF_NAMES = [1, 2].map((r) => ({ valid: NAV.adfValid(r), rel: NAV.adfBearing(r) }));
const SIDE_LABEL_FMS = ['FMS1', 'FMS2', 'FMS3'];
const LOC_LABEL = ['LOC1', 'LOC2', 'LOC3'];
const VOR_LABEL = ['VOR1', 'VOR2', 'VOR3'];
const BRG_LABEL: Record<number, string> = { [BrgSrc.Nav1]: 'VOR1', [BrgSrc.Nav2]: 'VOR2', [BrgSrc.Adf1]: 'ADF1', [BrgSrc.Adf2]: 'ADF2', [BrgSrc.Fms]: 'FMS' };
const VSPEED_BUGS: readonly [string, string][] = [
  ['v1', '1'],
  ['vr', 'R'],
  ['v2', '2'],
  ['vfs', 'FS'],
  ['vref', 'RF'],
  ['vapp', 'AP'],
];

export class PfdWindow extends EpicWindow {
  readonly kind = Win.Pfd;
  private readonly adi: AttitudeIndicator;
  private readonly spd: SpeedTape;
  private readonly alt: AltitudeTape;
  private readonly vsi: VerticalSpeedIndicator;
  private readonly hsi: Hsi;
  private readonly gs: DeviationScale;
  private readonly loc: DeviationScale;
  private readonly map: MovingMap;
  private readonly svs: SyntheticVision | null;
  private readonly sn = new SensorNames();
  private readonly altAlert = new AltitudeAlerter(ALT_ALERT_HONEYWELL);
  private readonly mins = new MinimumsAlerter(MINIMUMS_HONEYWELL);
  private t = 0;
  // FMA change boxes (s remaining).
  private lastLat = '';
  private lastVert = '';
  private lastAt = '';
  private latBox = 0;
  private vertBox = 0;
  private atBox = 0;
  // Cached per-frame values.
  private hdgMag = 0;
  private hdgTrue = 0;
  private courseMag = 0;
  private navColor: string = C.magenta;
  private navLabel = '';
  private fpvOn = false;
  private fdOn = false;
  private accelKtS = 0;
  private lastIas = NaN;
  private prevAdc = 0;
  private prevAhrs = 0;
  // Layout
  private cx = 0;
  private cy = 0;
  private fmaH = 44;
  private hsiTop = 0;

  constructor(svc: EpicServices, du: number, side: 1 | 2) {
    super(svc, du, side);
    const z = { x: 0, y: 0, w: 10, h: 10 };
    this.adi = new AttitudeIndicator({ rect: { ...z }, cx: 0, cy: 0, style: ADI_EPIC });
    this.spd = new SpeedTape({ ...z, style: SPEED_TAPE_EPIC, bugCount: 8 });
    this.alt = new AltitudeTape({ ...z, style: ALT_TAPE_EPIC });
    this.vsi = new VerticalSpeedIndicator({ ...z, style: VSI_EPIC });
    this.hsi = new Hsi({ cx: 0, cy: 0, radius: 100, style: HSI_EPIC, mode: 'arc', arcSpanDeg: 90 });
    this.gs = new DeviationScale({ x: 0, y: 0, style: GS_EPIC });
    this.loc = new DeviationScale({ x: 0, y: 0, style: LOC_EPIC });
    this.map = new MovingMap({ rect: { ...z }, style: MAP_EPIC, nav: svc.nav ?? undefined, world: svc.world ?? undefined, terrainCells: 96 });
    this.map.state.orientation = 'heading-up';
    this.map.state.showFixes = false;
    this.map.state.showRangeRings = false;
    this.svs = svc.world ? new SyntheticVision(svc.world) : null;
    this.animating = true;
  }

  protected override onLayout(): void {
    const { x, y, w, h } = this;
    const full = this.format === 'full';
    this.fmaH = 44;
    const adiBottom = y + Math.round(h * 0.585);
    this.cx = x + Math.round(w * (full ? 0.46 : 0.455));
    this.cy = y + Math.round(this.fmaH + (adiBottom - y - this.fmaH) * 0.47);
    this.adi.rect.x = x;
    this.adi.rect.y = y + this.fmaH;
    this.adi.rect.w = w;
    this.adi.rect.h = adiBottom - y - this.fmaH;
    this.adi.cx = this.cx;
    this.adi.cy = this.cy;
    const tapeTop = y + this.fmaH + 40;
    const tapeH = adiBottom - 44 - tapeTop;
    const spdW = 92;
    this.spd.x = x + (full ? 60 : 16);
    this.spd.y = tapeTop;
    this.spd.w = spdW;
    this.spd.h = tapeH;
    this.spd.centerY = this.cy;
    const altW = 104;
    const vsiW = 58;
    const altX = x + w - vsiW - altW - (full ? 60 : 12);
    this.alt.x = altX;
    this.alt.y = tapeTop;
    this.alt.w = altW;
    this.alt.h = tapeH;
    this.alt.centerY = this.cy;
    this.vsi.x = altX + altW + 4;
    this.vsi.y = tapeTop + 20;
    this.vsi.w = vsiW;
    this.vsi.h = tapeH - 40;
    this.gs.x = altX - 24;
    this.gs.y = this.cy;
    this.loc.x = this.cx;
    this.loc.y = adiBottom - 26;
    // HSI below the ADI.
    this.hsiTop = adiBottom;
    const hsiH = y + h - adiBottom;
    this.layoutHsi(hsiH);
    this.svs?.resize(this.adi.rect.w, this.adi.rect.h, ADI_EPIC.pxPerDeg);
  }

  private layoutHsi(hsiH: number): void {
    const mode = this.vars.get(EPIC_VARS.hsiMode(this.side)) as HsiMode;
    if (mode === HsiMode.Rose) {
      this.hsi.mode = 'rose';
      this.hsi.radius = Math.round(hsiH * 0.4);
      this.hsi.cx = this.cx;
      this.hsi.cy = this.hsiTop + Math.round(hsiH * 0.53);
    } else {
      this.hsi.mode = 'arc';
      this.hsi.radius = Math.round(hsiH * 0.82);
      this.hsi.cx = this.cx;
      this.hsi.cy = this.y + this.h - 22;
    }
    const r = this.hsi.radius;
    this.map.rect.x = this.x;
    this.map.rect.y = this.hsiTop + 2;
    this.map.rect.w = this.w;
    this.map.rect.h = this.y + this.h - this.hsiTop - 2;
    this.map.ownX = this.hsi.cx;
    this.map.ownY = this.hsi.cy;
    this.map.rangePx = r;
  }

  // ---------------------------------------------------------------- update

  override update(dt: number): void {
    this.t += dt;
    const v = this.vars;
    const side = this.side;
    const cfg = this.svc.cfg;
    const sen = cfg.sensors.sides[side - 1];
    const adcSel = v.get(EPIC_VARS.adcSel(side), sen.adc) || sen.adc;
    const ahrsSel = v.get(EPIC_VARS.ahrsSel(side), sen.ahrs) || sen.ahrs;
    this.prevAdc = adcSel;
    this.prevAhrs = ahrsSel;
    this.sn.set(adcSel, ahrsSel, sen.ra);
    const n = this.sn;
    // HSI layout follows the HSI mode selection.
    const wantRose = v.get(EPIC_VARS.hsiMode(side)) === HsiMode.Rose;
    if (wantRose !== (this.hsi.mode === 'rose')) this.layoutHsi(this.y + this.h - this.hsiTop);

    const adcValid = v.get(n.adcValid, 1) !== 0;
    const attValid = v.get(n.attValid, v.get(ADC.ahrsValid(ahrsSel), 1)) !== 0;
    const hdgValid = v.get(n.hdgValid, v.get(ADC.ahrsValid(ahrsSel), 1)) !== 0;
    const pitch = v.get(n.pitch);
    const bank = v.get(n.bank);
    this.hdgMag = v.get(n.hdg);
    this.hdgTrue = v.get(n.hdgTrue);
    const ias = v.get(n.ias);
    const vs = v.get(n.vs);
    const gs = v.get(GPS.gs);
    const trkMag = v.get(GPS.trackMag);
    const onGround = v.get('gear.air_ground') !== 0;

    // --- attitude
    const a = this.adi.state;
    a.valid = attValid;
    a.pitch = pitch;
    a.bank = bank;
    a.slip = v.get(n.slip);
    a.heading = this.hdgMag;
    this.fdOn = v.get(AP.fdOn(side)) !== 0 && v.get(AFCS_VARS.fdPitchValid, 1) !== 0;
    this.fpvOn = v.get(EPIC_VARS.fpv(side)) !== 0 && gs > 20;
    a.fdVisible = this.fdOn && !this.fpvOn;
    a.fdPitch = v.get(AP.fdPitch);
    a.fdBank = v.get(AP.fdBank);
    a.fpvVisible = this.fpvOn;
    a.fpaDeg = gs > 1 ? Math.atan2(vs / 101.2686, gs) / DEG : 0;
    a.driftDeg = wrap180(trkMag - this.hdgMag);
    // Pitch limit indicator from the stall-protection normalized AoA (EST shaker at 0.85).
    const aoaN = v.get('stall.aoa_norm');
    const aoa = v.get(n.aoa);
    a.pliDeg = !onGround && aoaN > 0.05 && aoa > 0.5 ? pitch + (0.85 / aoaN - 1) * aoa : NaN;
    if (Number.isFinite(a.pliDeg) && a.pliDeg - pitch > 12) a.pliDeg = NaN;
    this.adi.update(dt);

    // --- speed tape
    const sp = this.spd.state;
    sp.valid = adcValid;
    sp.ias = ias;
    sp.mach = v.get(n.mach);
    const rate = v.has(n.iasRate) ? v.get(n.iasRate) : NaN;
    if (Number.isFinite(rate)) sp.accelKtS = rate;
    else {
      sp.accelKtS = Number.isFinite(this.lastIas) && dt > 0 ? (this.accelKtS * 0.9 + ((ias - this.lastIas) / dt) * 0.1) : 0;
    }
    this.lastIas = ias;
    this.accelKtS = sp.accelKtS;
    const man = v.get(EPIC_VARS.speedMan, 1) !== 0;
    const isMach = v.get(AP.speedIsMach) !== 0;
    sp.selectedManaged = !man;
    if (man) {
      sp.selectedIsMach = isMach;
      sp.selectedKt = isMach ? NaN : v.get(AP.selSpeed);
      sp.selectedMach = isMach ? v.get(AP.selMach) : NaN;
    } else {
      const fk = v.get(FMS.vnavTargetSpeedKt);
      const fm = v.get(FMS.vnavTargetMach);
      sp.selectedIsMach = fm > 0 && !(fk > 0);
      sp.selectedKt = fk > 0 ? fk : NaN;
      sp.selectedMach = fm > 0 ? fm : NaN;
    }
    const vmo = v.get('overspeed.vmo_kt');
    const mach = sp.mach;
    const mmoKt = mach > 0.3 ? (ias * cfg.airframe.mmo) / mach : Infinity;
    sp.maxKt = vmo > 0 ? vmo : Math.min(cfg.airframe.vmoKt, mmoKt);
    // Low speed: shaker speed from the normalized AoA (alpha ~ 1/V^2 at constant load), airborne only.
    sp.minKt = !onGround && aoaN > 0.05 && ias > 60 ? ias * Math.sqrt(aoaN / 0.85) : NaN;
    const shown = v.get(EPIC_VARS.vspeedsShown, 1) !== 0;
    for (let i = 0; i < sp.bugs.length; i++) {
      const b = sp.bugs[i];
      if (i < VSPEED_BUGS.length) {
        const kt = v.get(EPIC_VARS.vspeed(VSPEED_BUGS[i][0]));
        b.label = VSPEED_BUGS[i][1];
        b.kt = kt;
        b.visible = shown && kt > 0;
        b.color = C.cyan;
      } else b.visible = false;
    }
    this.spd.update(dt);

    // --- altitude tape
    const al = this.alt.state;
    al.valid = adcValid;
    al.altFt = v.get(n.alt);
    al.vsFpm = vs;
    al.selectedFt = v.get(AP.selAltitude);
    this.altAlert.update(al.altFt, al.selectedFt, dt);
    al.alertPhase = this.altAlert.phase;
    al.alertVisible = this.altAlert.visible;
    al.baroInHg = v.get(n.baro, 29.92);
    al.baroStd = v.get(n.baroStd) !== 0;
    al.baroUnit = v.get(EPIC_VARS.baroHpa(side)) !== 0 ? 'hpa' : 'inhg';
    const minsRa = v.get(EPIC_VARS.minsRa(side)) !== 0;
    const minsFt = v.get(EPIC_VARS.minsFt(side));
    al.minimumsFt = !minsRa && minsFt > 0 ? minsFt : NaN;
    al.vnavTargetFt = v.get(FMS.vnavValid) !== 0 ? v.get(FMS.vnavTargetAltFt) : NaN;
    const raValid = v.get(n.raValid, 1) !== 0 && v.get(SENSOR_VARS.raNcd(sen.ra)) === 0;
    const raFt = v.get(n.raAlt);
    al.groundAltFt = raValid && raFt < 2500 ? al.altFt - raFt : NaN;
    this.alt.update(dt);
    this.mins.update(minsRa ? raFt : al.altFt, minsFt, onGround, dt);
    al.minimumsPhase = this.mins.phase;
    a.radioAltValid = raValid;
    a.radioAltFt = raFt;

    // --- VSI
    const vsi = this.vsi.state;
    vsi.valid = adcValid;
    vsi.vsFpm = vs;
    const vc = v.getString(AP.verticalActive);
    vsi.selectedFpm = vc === 'VS' ? v.get(AP.selVs) : NaN;
    // TCAS resolution advisory: green fly-to band on the VSI (systems/warning Tcas outputs).
    if (v.get('tcas.ra') !== 0) {
      vsi.raGreenFrom = v.get('tcas.ra_vs_min_fpm');
      vsi.raGreenTo = v.get('tcas.ra_vs_max_fpm');
    } else {
      vsi.raGreenFrom = NaN;
      vsi.raGreenTo = NaN;
    }

    // --- navigation source / HSI
    this.updateNav(v, hdgValid, trkMag, gs);
    this.hsi.update(dt);
    this.gs.update(dt);
    this.loc.update(dt);

    // --- FMA change boxes (EST 10 s)
    const lat = v.getString(AP.lateralActive);
    const at = v.getString(AP.athrMode);
    if (lat !== this.lastLat) {
      this.latBox = lat ? 10 : 0;
      this.lastLat = lat;
    }
    if (vc !== this.lastVert) {
      this.vertBox = vc ? 10 : 0;
      this.lastVert = vc;
    }
    if (at !== this.lastAt) {
      this.atBox = at ? 10 : 0;
      this.lastAt = at;
    }
    this.latBox = Math.max(0, this.latBox - dt);
    this.vertBox = Math.max(0, this.vertBox - dt);
    this.atBox = Math.max(0, this.atBox - dt);

    // --- HSI map / SVS
    if (this.vars.get(EPIC_VARS.hsiMode(side)) === HsiMode.Map) {
      const m = this.map.state;
      m.lat = v.get(GPS.lat);
      m.lon = v.get(GPS.lon);
      m.valid = v.get(GPS.valid, 1) !== 0;
      m.heading = this.hdgTrue;
      m.track = v.get(GPS.trackTrue);
      m.gsKt = gs;
      m.altFt = al.altFt;
      m.rangeNm = v.get(EPIC_VARS.pfdRange(side), 10) || 10;
      m.terrain = 'off';
      const plan = this.svc.fms?.plans.active;
      this.map.setRoute(plan ? plan.legs : null, v.get(FMS.activeLegIndex));
      this.map.update(dt);
    }
    if (this.svs && (v.get(EPIC_VARS.svs(side)) !== 0 || v.get(EPIC_VARS.evs(side)) !== 0) && attValid) {
      this.svs.update(dt, v.get(GPS.lat), v.get(GPS.lon), v.get('gps.alt_ft', al.altFt), this.hdgTrue, pitch, bank);
    }
  }

  private updateNav(v: EpicServices['vars'], hdgValid: boolean, trkMag: number, gs: number): void {
    const side = this.side;
    const h = this.hsi.state;
    h.valid = hdgValid;
    h.heading = this.hdgMag;
    h.selectedHeading = v.get(AP.selHeading);
    h.track = gs > 30 ? trkMag : NaN;
    const src = v.get(EPIC_VARS.navSrc(side)) as NavSrc;
    const g = this.gs.state;
    const l = this.loc.state;
    g.hollow = false;
    l.hollow = false;
    g.dev2 = NaN;
    l.dev2 = NaN;
    g.flag = '';
    l.flag = '';
    if (src === NavSrc.Fms) {
      const fn = Math.max(1, Math.min(3, v.get(EPIC_VARS.fmsNum(side), side) || side));
      this.navLabel = SIDE_LABEL_FMS[fn - 1];
      this.navColor = C.magenta;
      this.courseMag = v.get(FMS.dtkMag);
      h.courseVisible = v.get(FMS.lnavValid) !== 0;
      h.cdiValid = h.courseVisible;
      h.cdi = v.get(FMS.cdi);
      h.toFrom = v.get(FMS.toFrom, 1);
      h.xtkNm = Math.abs(v.get(FMS.xtkNm)) > 0.05 ? v.get(FMS.xtkNm) : NaN;
      // Vertical deviation: glide path (LPV) or VNAV path (EST +/-500 ft full scale).
      if (v.get(FMS.gpValid) !== 0) {
        g.valid = true;
        g.dev = v.get(FMS.gpDev);
        g.label = 'GP';
        g.color = C.magenta;
      } else if (v.get(FMS.vnavValid) !== 0 && Number.isFinite(v.get(FMS.vnavDevFt)) && v.getString(AP.verticalActive).startsWith('V')) {
        g.valid = true;
        g.dev = -v.get(FMS.vnavDevFt) / 500;
        g.label = 'V';
        g.color = C.magenta;
      } else g.valid = false;
      l.valid = false;
      // Preview (cyan ghost needles) of the auto-tuned on-side receiver.
      if (v.get(EPIC_VARS.preview(side)) !== 0) {
        const r = this.svc.cfg.sensors.sides[side - 1].nav;
        const nn = NAV_NAMES[r - 1];
        if (v.get(nn.received) !== 0) {
          l.valid = true;
          l.dev = v.get(nn.cdi);
          l.hollow = true;
          l.color = C.cyan;
          if (v.get(nn.gsValid) !== 0) {
            g.dev2 = v.get(nn.gsDev);
            g.color2 = C.cyan;
            if (!g.valid) {
              g.valid = true;
              g.dev = v.get(nn.gsDev);
              g.hollow = true;
              g.color = C.cyan;
              g.label = '';
            }
          }
        }
      }
    } else {
      const r = Math.min(3, src);
      const nn = NAV_NAMES[r - 1];
      const isLoc = v.get(nn.isLoc) !== 0;
      this.navLabel = isLoc ? LOC_LABEL[r - 1] : VOR_LABEL[r - 1];
      this.navColor = C.green;
      this.courseMag = v.get(nn.obs);
      h.courseVisible = true;
      const rx = v.get(nn.received) !== 0;
      h.cdiValid = rx;
      h.cdi = v.get(nn.cdi);
      h.toFrom = isLoc ? 0 : v.get(nn.toFrom);
      h.xtkNm = NaN;
      g.valid = isLoc && v.get(nn.gsValid) !== 0;
      g.dev = v.get(nn.gsDev);
      g.color = C.green;
      g.label = '';
      g.flag = isLoc && rx && !g.valid ? 'NO GS' : '';
      l.valid = isLoc && rx;
      l.dev = h.cdi;
      l.color = C.green;
    }
    h.course = this.courseMag;
    h.courseColor = this.navColor;
    h.sourceLabel = '';
    h.gsVisible = false;
    this.bearing(h.bearing1, v.get(EPIC_VARS.brg1(side)) as BrgSrc, 1);
    this.bearing(h.bearing2, v.get(EPIC_VARS.brg2(side)) as BrgSrc, 2);
    // Wind from the air and ground vectors (true directions).
    const tas = v.get(this.sn.tas);
    const trkT = v.get(GPS.trackTrue);
    if (tas > 60 && gs > 30) {
      const ax = tas * Math.sin(this.hdgTrue * DEG);
      const ay = tas * Math.cos(this.hdgTrue * DEG);
      const gx = gs * Math.sin(trkT * DEG);
      const gy = gs * Math.cos(trkT * DEG);
      const wx = gx - ax;
      const wy = gy - ay;
      h.windKt = Math.hypot(wx, wy);
      // Direction the wind blows FROM, referenced to magnetic like the heading.
      h.windFrom = norm360(Math.atan2(-wx, -wy) / DEG - (this.hdgTrue - this.hdgMag));
      h.windValid = true;
    } else h.windValid = false;
  }

  private bearing(b: { visible: boolean; bearing: number; lines: 1 | 2; color: string }, src: BrgSrc, which: 1 | 2): void {
    const v = this.vars;
    b.lines = which;
    b.color = which === 1 ? C.cyan : C.white;
    b.visible = false;
    switch (src) {
      case BrgSrc.Nav1:
      case BrgSrc.Nav2: {
        const nn = NAV_NAMES[src === BrgSrc.Nav1 ? 0 : 1];
        b.visible = v.get(nn.bearingValid, v.get(nn.received)) !== 0 && v.get(nn.isLoc) === 0;
        b.bearing = v.get(nn.bearing);
        break;
      }
      case BrgSrc.Adf1:
      case BrgSrc.Adf2: {
        const an = ADF_NAMES[src === BrgSrc.Adf1 ? 0 : 1];
        b.visible = v.get(an.valid) !== 0;
        b.bearing = norm360(this.hdgMag + v.get(an.rel));
        break;
      }
      case BrgSrc.Fms:
        b.visible = v.get(FMS.lnavValid) !== 0;
        b.bearing = v.get(FMS.bearingToWptMag);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- draw

  draw(ctx: Ctx2D): void {
    const v = this.vars;
    const side = this.side;
    this.frame(ctx, C.black);
    // Attitude (with SmartView underlay when available).
    const evsOn = !!this.svs && v.get(EPIC_VARS.evs(side)) !== 0 && this.adi.state.valid;
    const svsOn = evsOn || (!!this.svs && v.get(EPIC_VARS.svs(side)) !== 0 && this.adi.state.valid);
    if (svsOn) {
      const r = this.adi.rect;
      this.svs!.draw(ctx, r.x, r.y, r.w, r.h, this.cx, this.cy, ADI_EPIC.pxPerDeg, evsOn);
    }
    this.adi.style = svsOn ? ADI_EPIC_SVS : ADI_EPIC;
    this.adi.draw(ctx);
    if (this.fpvOn && this.adi.state.valid) this.drawFlightPath(ctx);
    this.spd.draw(ctx);
    this.alt.draw(ctx);
    this.vsi.draw(ctx);
    if (this.gs.state.valid || this.gs.state.flag) this.gs.draw(ctx);
    if (this.loc.state.valid) this.loc.draw(ctx);
    this.drawSpeedExtras(ctx);
    this.drawRaMins(ctx);
    this.drawSensorFlags(ctx);
    this.drawAoa(ctx);
    if (evsOn) textBold(ctx, 'EVS', this.spd.x + this.spd.w + 8, this.adi.rect.y + 62, 16, C.white, 'left', 'middle');
    this.drawHsi(ctx);
    this.drawFma(ctx);
  }

  /** Flight path symbol extras: guidance cue (FD in FPV mode) and acceleration caret. */
  private drawFlightPath(ctx: Ctx2D): void {
    const a = this.adi.state;
    const k = ADI_EPIC.pxPerDeg;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(-a.bank * DEG);
    const fx = Math.max(-20, Math.min(20, a.driftDeg)) * k;
    const fy = (a.pitch - a.fpaDeg) * k;
    // Acceleration caret: flight path angle equivalent of the along-track acceleration (asin(a/g)).
    const acc = Math.max(-0.3, Math.min(0.3, (this.accelKtS * KT_TO_MS) / G));
    const cy = fy - (Math.asin(acc) / DEG) * k;
    ctx.beginPath();
    ctx.moveTo(fx - 36, cy - 8);
    ctx.lineTo(fx - 28, cy);
    ctx.lineTo(fx - 36, cy + 8);
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (this.fdOn && !a.decluttered) {
      // Guidance cue: where the flight path must go to satisfy the FD pitch / roll command (EST gains).
      const gx = fx + Math.max(-40, Math.min(40, a.fdBank - a.bank)) * 1.4;
      const gy = fy - Math.max(-15, Math.min(15, a.fdPitch - a.pitch)) * k;
      ctx.beginPath();
      ctx.arc(gx, gy, 7, 0, Math.PI * 2);
      ctx.strokeStyle = C.black;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = C.magenta;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSpeedExtras(ctx: Ctx2D): void {
    const sp = this.spd.state;
    const x = this.spd.x;
    const w = this.spd.w;
    // Selected speed above the tape.
    const top = this.spd.y - 32;
    rect(ctx, x, top, w, 28, C.black, C.winLine, 1);
    const col = sp.selectedManaged ? C.magenta : C.cyan;
    let s = '---';
    if (sp.selectedIsMach && Number.isFinite(sp.selectedMach)) s = fmtFixed(sp.selectedMach, 2).replace(/^0/, 'M');
    else if (Number.isFinite(sp.selectedKt)) s = fmtInt(sp.selectedKt);
    textBold(ctx, s, x + w / 2, top + 15, 21, col, 'center', 'middle');
    // (Mach below the tape is drawn by the speed tape above 0.45 M.)
  }

  private drawRaMins(ctx: Ctx2D): void {
    const a = this.adi.state;
    const v = this.vars;
    const side = this.side;
    const test = v.get(EPIC_VARS.testRa(side)) !== 0;
    const y = this.cy + 118;
    if (test || (a.radioAltValid && a.radioAltFt <= 2500)) {
      const ft = test ? 50 : quantizeRadioAlt(a.radioAltFt);
      const reached = this.mins.phase === 'reached' && v.get(EPIC_VARS.minsRa(side)) !== 0;
      rect(ctx, this.cx - 44, y - 15, 88, 30, C.black, C.white, 1.5);
      textBold(ctx, fmtInt(ft), this.cx + 34, y + 1, 22, reached ? C.amber : C.white, 'right', 'middle');
    }
    // Minimums: 'RA 200' / 'BARO 1200' (cyan; amber when reached).
    const minsFt = v.get(EPIC_VARS.minsFt(side));
    if (minsFt > 0) {
      const ra = v.get(EPIC_VARS.minsRa(side)) !== 0;
      const reached = this.mins.phase === 'reached';
      const col = reached ? C.amber : C.cyan;
      if (!reached || this.mins.visible) {
        const mx = this.alt.x - 70;
        text(ctx, ra ? 'RA' : 'BARO', mx - 4, y + 1, 15, col, 'right', 'middle');
        textBold(ctx, fmtInt(minsFt), mx, y + 1, 18, col, 'left', 'middle');
      }
      if (reached && this.mins.visible) textBold(ctx, 'MIN', this.cx - 90, y + 1, 20, C.amber, 'center', 'middle');
    }
  }

  /**
   * Normalized AOA readout at the lower left of the attitude (G650ER PFD
   * photograph shows an "AOA" box there). EST: the stall-protection
   * normalized AOA (1.0 = stall), amber at the shaker threshold (0.85).
   */
  private drawAoa(ctx: Ctx2D): void {
    const n = this.vars.get('stall.aoa_norm');
    const x = this.spd.x + this.spd.w + 6;
    const y = this.spd.y + this.spd.h - 26;
    rect(ctx, x, y, 98, 24, C.black, C.winLine, 1);
    text(ctx, 'AOA', x + 6, y + 13, 14, C.white, 'left', 'middle');
    const ok = Number.isFinite(n) && this.adi.state.valid;
    textBold(ctx, ok ? fmtFixed(Math.max(0, n), 2) : '----', x + 92, y + 13, 16, ok && n >= 0.85 ? C.amber : C.green, 'right', 'middle');
  }

  private drawSensorFlags(ctx: Ctx2D): void {
    const sen = this.svc.cfg.sensors.sides[this.side - 1];
    if (this.prevAdc !== sen.adc) textBold(ctx, ADC_LABELS[this.prevAdc] ?? 'ADC', this.spd.x + this.spd.w + 8, this.adi.rect.y + 20, 16, C.amber, 'left', 'middle');
    if (this.prevAhrs !== sen.ahrs) textBold(ctx, IRS_LABELS[this.prevAhrs] ?? 'IRS', this.spd.x + this.spd.w + 8, this.adi.rect.y + 40, 16, C.amber, 'left', 'middle');
  }

  private drawHsi(ctx: Ctx2D): void {
    const v = this.vars;
    const side = this.side;
    const top = this.hsiTop;
    const mode = v.get(EPIC_VARS.hsiMode(side)) as HsiMode;
    rect(ctx, this.x, top, this.w, this.y + this.h - top, C.black, '');
    seg(ctx, this.x, top, this.x + this.w, top, C.winLine, 1);
    if (mode === HsiMode.Map) this.map.draw(ctx);
    this.hsi.draw(ctx);
    if (this.vars.get(EPIC_VARS.preview(side)) !== 0 && v.get(EPIC_VARS.navSrc(side)) === NavSrc.Fms) this.drawPreviewNeedle(ctx);
    // Upper-left: selected heading; upper-right: course (source colour).
    const ly = top + 20;
    text(ctx, 'HDG', this.x + 12, ly, 15, C.cyan, 'left', 'middle');
    textBold(ctx, fmtHdg(this.hsi.state.selectedHeading), this.x + 52, ly, 19, C.cyan, 'left', 'middle');
    text(ctx, 'CRS', this.x + this.w - 72, ly, 15, this.navColor, 'right', 'middle');
    textBold(ctx, fmtHdg(this.courseMag), this.x + this.w - 12, ly, 19, this.navColor, 'right', 'middle');
    // Left column: navigation source and data.
    let y = top + 50;
    textBold(ctx, this.navLabel, this.x + 12, y, 19, this.navColor, 'left', 'middle');
    y += 22;
    const src = v.get(EPIC_VARS.navSrc(side)) as NavSrc;
    if (src === NavSrc.Fms) {
      text(ctx, v.getString(FMS.nextWptIdent), this.x + 12, y, 17, C.magenta, 'left', 'middle');
      y += 20;
      const d = v.get(FMS.distToWptNm);
      if (Number.isFinite(d) && v.get(FMS.lnavValid) !== 0) text(ctx, `${d < 100 ? fmtFixed(d, 1) : fmtInt(d)} NM`, this.x + 12, y, 16, C.white, 'left', 'middle');
      y += 20;
      const mode = v.getString(FMS.approachMode);
      if (mode) text(ctx, mode, this.x + 12, y, 15, C.white, 'left', 'middle');
    } else {
      const nn = NAV_NAMES[Math.min(3, src) - 1];
      const id = v.getString(nn.ident);
      text(ctx, id || fmtFixed(v.get(nn.freq, 108), 2), this.x + 12, y, 17, C.green, 'left', 'middle');
      y += 20;
      if (v.get(nn.dmeValid) !== 0) text(ctx, `${fmtFixed(v.get(nn.dmeNm), 1)} NM`, this.x + 12, y, 16, C.white, 'left', 'middle');
    }
    // Bearing pointer legends (bottom corners).
    const b1 = v.get(EPIC_VARS.brg1(side));
    const b2 = v.get(EPIC_VARS.brg2(side));
    const by = this.y + this.h - 16;
    if (b1 !== BrgSrc.Off) text(ctx, BRG_LABEL[b1] ?? '', this.x + 12, by, 15, C.cyan, 'left', 'middle');
    if (b2 !== BrgSrc.Off) text(ctx, BRG_LABEL[b2] ?? '', this.x + this.w - 12, by, 15, C.white, 'right', 'middle');
    // Wind (upper left of the HSI, below the HDG readout).
    const h = this.hsi.state;
    if (h.windValid && h.windKt >= 3) {
      const wx = this.x + this.w - 60;
      const wy = top + 62;
      text(ctx, `${fmtHdg(h.windFrom)}/${fmtInt(h.windKt)}`, wx + 48, wy + 26, 15, C.white, 'right', 'middle');
      const ang = (h.windFrom - this.hdgMag + 180) * DEG;
      ctx.save();
      ctx.translate(wx + 20, wy);
      ctx.rotate(ang);
      ctx.strokeStyle = C.white;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(0, 12);
      ctx.moveTo(-5, 6);
      ctx.lineTo(0, 12);
      ctx.lineTo(5, 6);
      ctx.stroke();
      ctx.restore();
    }
    if (mode === HsiMode.Map || mode === HsiMode.Arc) text(ctx, fmtInt(v.get(EPIC_VARS.pfdRange(side), 10)), this.hsi.cx - this.hsi.radius * 0.5 - 8, this.hsi.cy - this.hsi.radius * 0.5, 14, C.white, 'right', 'middle');
  }

  /** Cyan preview course pointer of the auto-tuned ILS (drawn over the FMS course). */
  private drawPreviewNeedle(ctx: Ctx2D): void {
    const v = this.vars;
    const r = this.svc.cfg.sensors.sides[this.side - 1].nav;
    const nn = NAV_NAMES[r - 1];
    const crs = v.get(nn.obs);
    const R = this.hsi.radius;
    ctx.save();
    ctx.translate(this.hsi.cx, this.hsi.cy);
    ctx.rotate((crs - this.hdgMag) * DEG);
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 2;
    ctx.setLineDash(PREVIEW_DASH);
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.92);
    ctx.lineTo(0, -R * 0.35);
    ctx.moveTo(0, R * 0.35);
    ctx.lineTo(0, R * 0.9);
    const dev = Math.max(-1.2, Math.min(1.2, v.get(nn.cdi))) * R * 0.4;
    ctx.moveTo(dev, -R * 0.3);
    ctx.lineTo(dev, R * 0.3);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.restore();
  }

  private drawFma(ctx: Ctx2D): void {
    const v = this.vars;
    const x = this.x;
    const y = this.y;
    const w = this.w;
    const h = this.fmaH;
    rect(ctx, x, y, w, h, C.black, '');
    seg(ctx, x, y + h, x + w, y + h, C.winLine, 1);
    const c1 = x + w * 0.2;
    const c2 = x + w * 0.44;
    const c3 = x + w * 0.74;
    seg(ctx, c1, y + 4, c1, y + h - 4, C.winLine, 1);
    seg(ctx, c2, y + 4, c2, y + h - 4, C.winLine, 1);
    seg(ctx, c3, y + 4, c3, y + h - 4, C.winLine, 1);
    const flash = blinkOn(this.t, 2);
    // A/T column.
    const atOn = v.get(AP.athr) !== 0;
    const atMode = v.getString(AP.athrMode);
    if (atOn || atMode) this.mode(ctx, atOn ? `AT ${atMode}` : atMode, (x + c1) / 2, y + 16, atOn ? C.green : C.white, this.atBox > 0);
    // Lateral: active (green) over armed (white).
    this.mode(ctx, fmaText(v.getString(AP.lateralActive)), (c1 + c2) / 2, y + 15, C.green, this.latBox > 0);
    text(ctx, fmaText(v.getString(AP.lateralArmed)), (c1 + c2) / 2, y + 35, 15, C.white, 'center', 'middle');
    // Vertical.
    const vert = fmaText(v.getString(AP.verticalActive));
    this.mode(ctx, vert, (c2 + c3) / 2, y + 15, C.green, this.vertBox > 0);
    text(ctx, fmaText(v.getString(AP.verticalArmed)), (c2 + c3) / 2, y + 35, 15, C.white, 'center', 'middle');
    // AP / YD with the coupling arrow.
    const ap = v.get(AP.engaged) !== 0;
    const disc = v.get(AFCS_VARS.discWarn) !== 0;
    const yd = v.get(AP.yd) !== 0;
    const couple = v.get(EPIC_VARS.coupleSide, 1);
    const acx = (c3 + x + w) / 2;
    if (ap) textBold(ctx, 'AP', acx, y + 15, 20, C.green, 'center', 'middle');
    else if (disc && flash) textBold(ctx, 'AP', acx, y + 15, 20, C.red, 'center', 'middle');
    if (ap || v.get(AP.fdOn(1)) !== 0 || v.get(AP.fdOn(2)) !== 0) this.arrow(ctx, couple === 2 ? acx + 34 : acx - 34, y + 15, couple === 2);
    if (yd && !ap) text(ctx, 'YD', acx, y + 35, 15, C.green, 'center', 'middle');
    if (v.get(AFCS_VARS.halfBank) !== 0) text(ctx, 'LO BANK', (c1 + c2) / 2, y + h + 12, 13, C.white, 'center', 'middle');
  }

  private mode(ctx: Ctx2D, s: string, x: number, y: number, col: string, boxed: boolean): void {
    if (!s) return;
    textBold(ctx, s, x, y, 20, col, 'center', 'middle');
    if (boxed) {
      const w = ctx.measureText(s).width + 12;
      rect(ctx, x - w / 2, y - 12, w, 24, '', C.white, 1.5);
    }
  }

  /** PFD CMD coupling arrow: points to the side whose FD / NAV SRC the AFCS follows. */
  private arrow(ctx: Ctx2D, x: number, y: number, right: boolean): void {
    ctx.fillStyle = C.green;
    ctx.beginPath();
    const d = right ? 1 : -1;
    ctx.moveTo(x + 9 * d, y);
    ctx.lineTo(x - 3 * d, y - 8);
    ctx.lineTo(x - 3 * d, y + 8);
    ctx.closePath();
    ctx.fill();
  }
}

const ADC_LABELS: Record<number, string> = { 1: 'ADC 1', 2: 'ADC 2', 3: 'ADC 3' };
const IRS_LABELS: Record<number, string> = { 1: 'IRS 1', 2: 'IRS 2', 3: 'IRS 3' };
const PREVIEW_DASH = [8, 6];
const NO_DASH: number[] = [];

function wrap180(d: number): number {
  let r = d % 360;
  if (r > 180) r -= 360;
  if (r < -180) r += 360;
  return r;
}

function norm360(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

const HDG_STR: string[] = [];
for (let i = 0; i <= 360; i++) HDG_STR.push((i === 0 ? 360 : i).toString().padStart(3, '0'));
function fmtHdg(d: number): string {
  if (!Number.isFinite(d)) return '---';
  return HDG_STR[Math.round(norm360(d)) % 360];
}
