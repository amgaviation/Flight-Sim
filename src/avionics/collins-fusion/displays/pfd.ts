/**
 * Pro Line Fusion PFD window (Global Vision), full (1024 x 640) or half
 * (512 x 640) format, for pilot (side 1) or copilot (side 2).
 *
 * Sources:
 *  - FAA FSB report BD-700-1A10 Rev 7 appendix 6 (Global Express to Global
 *    6000): "Flight Path Vector (caged and uncaged) vice flight director
 *    command bars"; "FPV Cage button on yoke"; "Takeoff mode pitch target
 *    box"; "Preselect altitudes appear in feet and meters"; "Color changes
 *    for non-normal navigation sources"; "RNP and EPU symbology added";
 *    Synthetic Vision "Presented on PFD"; "PFDs Nav Source, Course and
 *    bearing pointers controlled primary via CTP".
 *  - Global Express "Automatic Flight" manual (Global FMA conventions kept
 *    by the Vision flight deck): active modes green, armed modes white below
 *    the active ones, lateral modes left, vertical modes right, "Active mode
 *    flashes for 5 seconds upon automatic mode capture", AP1 / AP2 status,
 *    PFD source annunciations such as "ATT2 ADC1".
 *  - AIN 2012 flight report: guidance cue "donut" flown inside the FPV.
 *  - AC 25-11B colour conventions.
 * Layout coordinates, sizes and the guidance-cue law are EST (from Pro Line
 * Fusion PFD images); see docs/modules/avionics-collins-fusion.md.
 */
import type { SimVars } from '../../../core/SimVars';
import { ADC, AP, FMS, GPS, NAV } from '../../../core/vars';
import type { WorldQuery } from '../../../world/types';
import { AttitudeIndicator, ADI_COLLINS, type AttitudeStyle } from '../../common/draw/AttitudeIndicator';
import { SpeedTape, SPEED_TAPE_COLLINS, type SpeedTapeStyle } from '../../common/draw/SpeedTape';
import { AltitudeTape, ALT_TAPE_COLLINS, type AltitudeTapeStyle } from '../../common/draw/AltitudeTape';
import { VerticalSpeedIndicator, VSI_COLLINS } from '../../common/draw/VerticalSpeed';
import { Hsi, HSI_COLLINS, type HsiStyle } from '../../common/draw/Hsi';
import { DeviationScale, GS_SCALE_BOEING, LOC_SCALE_BOEING, type DeviationScaleStyle } from '../../common/draw/DeviationScale';
import { AltitudeAlerter, MinimumsAlerter, ALT_ALERT_HONEYWELL, MINIMUMS_HONEYWELL } from '../../common/alerting';
import { derivePalette, COLLINS_PALETTE } from '../../common/palette';
import { blinkOn } from '../../common/dynamics';
import type { Ctx2D } from '../../common/draw/context';
import { BrgSrc, FUSION_VARS, NavSrc } from '../vars';
import { flapDetentFor, mmoAt, vmoAt, type FusionResolvedConfig } from '../config';
import { C, DEG, boxed, dAng, fstr, hstr, istr, n360, pstr, rect, seg, txt, txtHalo } from './style';
import { SyntheticVision } from './svs';

/** Sensor var names per source index (built once; sources change with the RSP). */
interface SensorNames {
  attValid: string;
  hdgValid: string;
  iasRate: string;
  pressAlt: string;
  raAlt: string;
  raValid: string;
  raNcd: string;
}
const SENS: SensorNames[] = [];
for (let n = 0; n <= 8; n++) {
  SENS.push({
    attValid: `ahrs${n}.att_valid`,
    hdgValid: `ahrs${n}.hdg_valid`,
    iasRate: `adc${n}.ias_rate_kts`,
    pressAlt: `adc${n}.press_alt_ft`,
    raAlt: `ra${n}.alt_ft`,
    raValid: `ra${n}.valid`,
    raNcd: `ra${n}.ncd`,
  });
}
const sens = (n: number): SensorNames => SENS[Math.max(0, Math.min(8, Math.round(n)))];

/** Transparent sky / ground so the SVS picture shows through the ADI primitive. */
const SVS_PALETTE = derivePalette(COLLINS_PALETTE, { sky: 'rgba(0,0,0,0)', skyHorizon: 'rgba(0,0,0,0)', ground: 'rgba(0,0,0,0)', groundHorizon: 'rgba(0,0,0,0)' });

function adiStyle(pxPerDeg: number, svs: boolean, half: boolean): AttitudeStyle {
  const s: AttitudeStyle = {
    ...ADI_COLLINS,
    palette: svs ? SVS_PALETTE : ADI_COLLINS.palette,
    gradient: !svs,
    gradientPx: 220,
    pxPerDeg,
    horizonWidth: 2,
    ladder: { ...ADI_COLLINS.ladder, labelSize: half ? 15 : 17, majorHalf: half ? 50 : 62, midHalf: half ? 25 : 30, fineHalf: half ? 12 : 15, visibleRangeDeg: 22, clipHalfWidth: half ? 95 : 120 },
    bank: { ...ADI_COLLINS.bank, radius: half ? 150 : 175 },
    fd: { ...ADI_COLLINS.fd, style: 'none' },
    symbol: { style: 'wings', size: half ? 70 : 90, thickness: 8 },
    horizonHeadingPxPerDeg: svs ? pxPerDeg : 0,
    radioAlt: null,
    minimums: null,
  };
  return s;
}

// Mach readout drawn by drawMach (Collins 'M.xxx' under the tape), not by the tape primitive.
const SPEED_FUSION: SpeedTapeStyle = { ...SPEED_TAPE_COLLINS, machShow: 99, machHide: 99, pxPerKt: 4.4, labelStep: 20, minorStep: 10, readoutW: 78, readoutH: 42, readoutSize: 27, trendSeconds: 10 };
const SPEED_FUSION_HALF: SpeedTapeStyle = { ...SPEED_FUSION, pxPerKt: 3.8, readoutW: 64, readoutH: 36, readoutSize: 22, labelSize: 18 };
const ALT_FUSION: AltitudeTapeStyle = { ...ALT_TAPE_COLLINS, pxPerFt: 0.52, minorStep: 100, labelStep: 200, readoutW: 108, readoutH: 42, readoutSize: 27 };
const ALT_FUSION_HALF: AltitudeTapeStyle = { ...ALT_FUSION, pxPerFt: 0.44, readoutW: 84, readoutH: 36, readoutSize: 22, labelSize: 18 };
const HSI_FUSION: HsiStyle = { ...HSI_COLLINS, labelSize: 18 };
const GS_FUSION: DeviationScaleStyle = { ...GS_SCALE_BOEING, palette: COLLINS_PALETTE, dotSpacing: 30, background: 'rgba(0,0,0,0.35)' };
const LOC_FUSION: DeviationScaleStyle = { ...LOC_SCALE_BOEING, palette: COLLINS_PALETTE, dotSpacing: 34, background: 'rgba(0,0,0,0.35)' };

interface PfdLayout {
  half: boolean;
  w: number;
  h: number;
  fmaH: number;
  adiTop: number;
  adiBottom: number;
  cx: number;
  cy: number;
  pxPerDeg: number;
  adi: AttitudeIndicator;
  adiSvs: AttitudeIndicator;
  spd: SpeedTape;
  alt: AltitudeTape;
  vsi: VerticalSpeedIndicator;
  hsi: Hsi;
  gs: DeviationScale;
  loc: DeviationScale;
  font: number;
}

function makeLayout(half: boolean): PfdLayout {
  if (!half) {
    const cx = 512;
    const cy = 262;
    const pxPerDeg = 8;
    const adi = new AttitudeIndicator({ rect: { x: 0, y: 46, w: 1024, h: 404 }, cx, cy, style: adiStyle(pxPerDeg, false, false) });
    const adiSvs = new AttitudeIndicator({ rect: { x: 0, y: 46, w: 1024, h: 404 }, cx, cy, style: adiStyle(pxPerDeg, true, false) });
    return {
      half,
      w: 1024,
      h: 640,
      fmaH: 46,
      adiTop: 46,
      adiBottom: 450,
      cx,
      cy,
      pxPerDeg,
      adi,
      adiSvs,
      spd: new SpeedTape({ x: 196, y: 102, w: 92, h: 320, style: SPEED_FUSION, centerY: cy, bugCount: 8 }),
      alt: new AltitudeTape({ x: 706, y: 102, w: 104, h: 320, style: ALT_FUSION, centerY: cy }),
      vsi: new VerticalSpeedIndicator({ x: 814, y: 112, w: 50, h: 300, style: VSI_COLLINS }),
      hsi: new Hsi({ cx: 512, cy: 708, radius: 226, style: HSI_FUSION, mode: 'arc', arcSpanDeg: 110, wind: null }),
      gs: new DeviationScale({ x: 670, y: cy, style: GS_FUSION }),
      loc: new DeviationScale({ x: cx, y: 432, style: LOC_FUSION }),
      font: 20,
    };
  }
  const cx = 256;
  const cy = 222;
  const pxPerDeg = 7;
  const adi = new AttitudeIndicator({ rect: { x: 0, y: 52, w: 512, h: 348 }, cx, cy, style: adiStyle(pxPerDeg, false, true) });
  const adiSvs = new AttitudeIndicator({ rect: { x: 0, y: 52, w: 512, h: 348 }, cx, cy, style: adiStyle(pxPerDeg, true, true) });
  return {
    half,
    w: 512,
    h: 640,
    fmaH: 52,
    adiTop: 52,
    adiBottom: 400,
    cx,
    cy,
    pxPerDeg,
    adi,
    adiSvs,
    spd: new SpeedTape({ x: 6, y: 96, w: 70, h: 252, style: SPEED_FUSION_HALF, centerY: cy, bugCount: 8 }),
    alt: new AltitudeTape({ x: 396, y: 96, w: 84, h: 252, style: ALT_FUSION_HALF, centerY: cy }),
    // Half format: the narrow VSI has no room for its digital readout; drawVsDigital() puts it above the scale.
    vsi: new VerticalSpeedIndicator({ x: 482, y: 104, w: 28, h: 236, style: { ...VSI_COLLINS, digitalAboveFpm: 1e9 } }),
    hsi: new Hsi({ cx: 256, cy: 532, radius: 94, style: HSI_FUSION, mode: 'rose', wind: null }),
    gs: new DeviationScale({ x: 370, y: cy, style: { ...GS_FUSION, dotSpacing: 24 } }),
    loc: new DeviationScale({ x: cx, y: 384, style: { ...LOC_FUSION, dotSpacing: 26 } }),
    font: 17,
  };
}

const ETE_STR: string[] = [];
for (let m = 0; m < 6000; m++) ETE_STR.push(`${Math.floor(m / 60)}+${(m % 60).toString().padStart(2, '0')}`);
const BUG_IDS: readonly (readonly [string, 'v1' | 'vr' | 'v2' | 'vt' | 'vref' | 'vapp', boolean])[] = [
  ['1', 'v1', true],
  ['R', 'vr', true],
  ['2', 'v2', true],
  ['T', 'vt', true],
  ['RF', 'vref', false],
  ['AP', 'vapp', false],
];
const MACH_STR: string[] = [];
for (let i = 0; i < 1000; i++) MACH_STR.push(`M.${i.toString().padStart(3, '0')}`);

/** FMA field with the 5 s "new mode" flash (Global Express AFCS manual). */
class FmaField {
  text = '';
  flashT = 0;
  set(s: string, flash: boolean): void {
    if (s !== this.text) {
      if (flash && s) this.flashT = 5;
      this.text = s;
    }
  }
  update(dt: number): void {
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
  }
}

export interface PfdServices {
  vars: SimVars;
  cfg: FusionResolvedConfig;
  world: Pick<WorldQuery, 'elevationAt'> | null;
  /** Runways for the SVS (origin / destination), refreshed by the suite. */
  svsRunways: () => { lat: number; lon: number; headingTrue: number; lengthFt: number; widthFt: number; elevFt: number }[];
}

export class PfdRenderer {
  private readonly full = makeLayout(false);
  private readonly halfL = makeLayout(true);
  private readonly svs: SyntheticVision;
  private readonly altAlert = new AltitudeAlerter(ALT_ALERT_HONEYWELL);
  private readonly mins = new MinimumsAlerter(MINIMUMS_HONEYWELL);
  private readonly fmaLat = new FmaField();
  private readonly fmaVert = new FmaField();
  private readonly fmaAt = new FmaField();
  private readonly fmaLatArm = new FmaField();
  private readonly fmaVertArm = new FmaField();
  private time = 0;
  private svsLatch = false;
  // Per-frame derived values.
  private fpa = 0;
  private drift = 0;
  private fpvValid = false;

  constructor(
    readonly side: 1 | 2,
    private readonly svc: PfdServices,
  ) {
    this.svs = new SyntheticVision(svc.world);
  }

  private get v(): SimVars {
    return this.svc.vars;
  }

  /** Per-frame state update (sensors -> primitives). */
  update(dt: number, half: boolean): void {
    this.time += dt;
    const L = half ? this.halfL : this.full;
    const v = this.v;
    const s = this.side;
    const cfg = this.svc.cfg;
    const adc = v.get(FUSION_VARS.adcSrc(s), cfg.sensors.adc[s - 1]);
    const ahrs = v.get(FUSION_VARS.ahrsSrc(s), cfg.sensors.ahrs[s - 1]);
    const ra = v.get(FUSION_VARS.raSrc(s), cfg.sensors.ra[s - 1]);
    // ------------------------------------------------ attitude
    const attValid = v.get(sens(ahrs).attValid, 1) >= 0.5 && v.get(ADC.ahrsValid(ahrs), 1) >= 0.5;
    const pitch = v.get(ADC.pitch(ahrs));
    const bank = v.get(ADC.bank(ahrs));
    const hdg = v.get(ADC.heading(ahrs));
    const svsOn = v.getBool(FUSION_VARS.svs(s)) && this.svc.world !== null;
    this.svsLatch = svsOn;
    const adi = svsOn ? L.adiSvs : L.adi;
    const a = adi.state;
    a.valid = attValid;
    a.pitch = pitch;
    a.bank = bank;
    a.slip = v.get(ADC.slip(ahrs));
    a.heading = hdg;
    a.fdVisible = false;
    a.fpvVisible = false;
    // Pitch limit indicator from the AoA ratio (EST: stick-shaker at 0.85 of the stall AoA, 14 deg clean stall AoA).
    const aoaNorm = v.get('stall.aoa_norm', NaN);
    a.pliDeg = Number.isFinite(aoaNorm) && aoaNorm > 0.55 && !v.getBool('gear.air_ground') ? pitch + (0.85 - aoaNorm) * 14 : NaN;
    adi.update(dt);
    // FPV (from sensors: ADC vertical speed and TAS, GPS track vs heading).
    const tas = v.get(ADC.tas(adc));
    const vsFpm = v.get(ADC.vs(adc));
    this.fpvValid = attValid && tas > 40 && v.get(ADC.valid(adc), 1) >= 0.5;
    this.fpa = this.fpvValid ? Math.atan2((vsFpm / 60) * 0.3048, tas * 0.514444) / DEG : 0;
    const caged = v.getBool(FUSION_VARS.fpvCaged(s));
    this.drift = !caged && v.getBool(GPS.valid) && v.get(GPS.gs) > 30 ? Math.max(-20, Math.min(20, dAng(v.get(GPS.trackMag), hdg))) : 0;
    if (svsOn) {
      this.svs.setFov(L.w, L.pxPerDeg);
      this.svs.runways = this.svc.svsRunways();
      this.svs.update(dt, v.get(GPS.lat), v.get(GPS.lon), v.get(GPS.alt, v.get(ADC.baroAlt(adc))), v.get(ADC.headingTrue(ahrs), hdg + v.get(GPS.magVar)));
    }
    // ------------------------------------------------ speed
    const sp = L.spd.state;
    const adcValid = v.get(ADC.valid(adc), 1) >= 0.5;
    sp.valid = adcValid;
    const ias = v.get(ADC.ias(adc));
    const mach = v.get(ADC.mach(adc));
    const paFt = v.get(sens(adc).pressAlt, v.get(ADC.baroAlt(adc)));
    sp.ias = ias;
    sp.mach = mach;
    sp.accelKtS = v.has(sens(adc).iasRate) ? v.get(sens(adc).iasRate) : NaN;
    const isMach = v.getBool(AP.speedIsMach);
    sp.selectedIsMach = isMach;
    sp.selectedKt = v.get(AP.selSpeed, NaN);
    sp.selectedMach = v.get(AP.selMach, NaN);
    sp.selectedManaged = v.getBool(FUSION_VARS.spdFms);
    const af = cfg.airframe;
    const vmo = v.has('overspeed.vmo_kt') ? v.get('overspeed.vmo_kt') : Math.min(vmoAt(af, paFt), mach > 0.2 ? (ias * mmoAt(af, paFt)) / mach : 999);
    sp.maxKt = vmo;
    // Shaker speed from the AoA ratio (EST: constant-weight lift, V_shaker = V * sqrt(aoa_norm / 0.85)).
    sp.minKt = Number.isFinite(aoaNorm) && aoaNorm > 0.05 && ias > 60 && !v.getBool('gear.air_ground') ? ias * Math.sqrt(Math.min(1.5, aoaNorm / 0.85)) : NaN;
    const det = flapDetentFor(af, v.get(af.vars.flapLever));
    sp.flapLimitKt = Number.isFinite(det.vfeKt) ? det.vfeKt : v.get(af.vars.gearPos(1)) > 0.05 ? af.vleKt : NaN;
    this.fillBugs(sp.bugs);
    L.spd.update(dt);
    // ------------------------------------------------ altitude
    const al = L.alt.state;
    al.valid = adcValid;
    const altFt = v.get(ADC.baroAlt(adc));
    al.altFt = altFt;
    al.vsFpm = vsFpm;
    const sel = v.get(AP.selAltitude, NaN);
    al.selectedFt = sel;
    this.altAlert.update(altFt, sel, dt);
    al.alertPhase = this.altAlert.phase;
    al.alertVisible = this.altAlert.visible;
    al.baroInHg = v.get(ADC.baroSetting(adc), 29.92);
    al.baroUnit = v.getBool(FUSION_VARS.baroHpa(s)) ? 'hpa' : 'inhg';
    al.baroStd = v.getBool(ADC.baroStd(adc));
    const pre = v.get(FUSION_VARS.baroPreset(s));
    al.baroPreselectInHg = pre > 0 ? pre : NaN;
    al.metric = v.getBool(FUSION_VARS.metric(s));
    const vnavMode = v.getString(AP.verticalActive).startsWith('V') && v.getString(AP.verticalActive) !== 'VS';
    al.vnavTargetFt = vnavMode && v.getBool(FMS.vnavValid) ? v.get(FMS.vnavTargetAltFt, NaN) : NaN;
    const raFt = v.get(sens(ra).raAlt);
    const raValid = v.get(sens(ra).raValid) >= 0.5 && v.get(sens(ra).raNcd) < 0.5;
    al.groundAltFt = raValid && raFt < 2500 ? altFt - raFt : NaN;
    const minsFt = v.get(AP.minimums(s), NaN);
    const minsRa = v.getBool(AP.minimumsIsRadio(s));
    this.mins.update(minsRa ? (raValid ? raFt : 9999) : altFt, minsFt, v.getBool('gear.air_ground'), dt);
    al.minimumsFt = minsRa ? NaN : minsFt;
    al.minimumsPhase = this.mins.phase;
    L.alt.update(dt);
    // ------------------------------------------------ vertical speed
    const vs = L.vsi.state;
    vs.valid = adcValid;
    vs.vsFpm = vsFpm;
    vs.selectedFpm = v.getString(AP.verticalActive) === 'VS' ? v.get(AP.selVs, NaN) : NaN;
    vs.requiredFpm = vnavMode ? v.get(FMS.vsRequiredFpm, NaN) : NaN;
    const raLo = v.get('tcas.ra_vs_min_fpm', NaN);
    const raHi = v.get('tcas.ra_vs_max_fpm', NaN);
    const raOn = v.getBool('tcas.ra');
    vs.raGreenFrom = raOn ? raLo : NaN;
    vs.raGreenTo = raOn ? raHi : NaN;
    // ------------------------------------------------ HSI + deviations
    this.updateNav(L, hdg, dt);
    // ------------------------------------------------ FMA
    const flash = !v.getBool('gear.air_ground');
    this.fmaLat.set(v.getString(AP.lateralActive), flash);
    this.fmaVert.set(v.getString(AP.verticalActive), flash);
    this.fmaAt.set(v.getString(AP.athrMode), flash);
    this.fmaLatArm.set(v.getString(AP.lateralArmed), false);
    this.fmaVertArm.set(v.getString(AP.verticalArmed), false);
    this.fmaLat.update(dt);
    this.fmaVert.update(dt);
    this.fmaAt.update(dt);
  }

  private fillBugs(bugs: { label: string; kt: number; visible: boolean; color: string }[]): void {
    const v = this.v;
    const onGround = v.getBool('gear.air_ground');
    for (let i = 0; i < bugs.length; i++) {
      const b = bugs[i];
      if (i >= BUG_IDS.length) {
        b.visible = false;
        continue;
      }
      const [label, id, takeoff] = BUG_IDS[i];
      const kt = v.get(FUSION_VARS.vspd(id));
      b.label = label;
      b.kt = kt;
      b.color = C.cyan;
      // EST: takeoff bugs on the ground and in the air until VREF is entered; approach bugs in the air.
      b.visible = kt > 0 && (takeoff ? onGround || v.get(FUSION_VARS.vspd('vref')) <= 0 : !onGround);
    }
  }

  private navRx(src: number): number {
    const sn = this.svc.cfg.sensors;
    return src === NavSrc.Nav2 ? sn.nav[1] : sn.nav[0];
  }

  private updateNav(L: PfdLayout, hdg: number, dt: number): void {
    const v = this.v;
    const s = this.side;
    const sn = this.svc.cfg.sensors;
    const ahrs = v.get(FUSION_VARS.ahrsSrc(s), sn.ahrs[s - 1]);
    const h = L.hsi.state;
    h.valid = v.get(sens(ahrs).hdgValid, v.get(ADC.ahrsValid(ahrs), 1)) >= 0.5;
    h.heading = hdg;
    h.selectedHeading = v.get(AP.selHeading, NaN);
    h.track = v.getBool(GPS.valid) && v.get(GPS.gs) > 30 ? v.get(GPS.trackMag) : NaN;
    h.turnRateDps = v.get(ADC.turnRate(ahrs));
    const src = v.get(FUSION_VARS.navSource(s));
    const gs = L.gs.state;
    const loc = L.loc.state;
    if (src === NavSrc.Fms) {
      h.courseVisible = v.getBool(FMS.lnavValid) || v.get(FMS.activeLegIndex, -1) >= 0;
      h.course = v.get(FMS.dtkMag);
      h.courseColor = C.magenta;
      h.cdiValid = v.getBool(FMS.lnavValid);
      h.cdi = v.get(FMS.cdi);
      h.toFrom = v.get(FMS.toFrom, 1);
      h.xtkNm = v.get(FMS.xtkNm, NaN);
      h.courseDouble = false;
      loc.valid = false;
      loc.flag = '';
      // Approach glidepath (LPV / LNAV/VNAV) or VNAV path deviation (EST 500 ft full scale).
      if (v.getBool(FMS.gpValid)) {
        gs.valid = true;
        gs.dev = v.get(FMS.gpDev);
        gs.color = C.magenta;
        gs.label = 'GP';
        gs.flag = '';
      } else if (v.getBool(FMS.vnavValid) && v.getString(FMS.vnavPhase) === 'DES') {
        gs.valid = true;
        gs.dev = Math.max(-1.2, Math.min(1.2, -v.get(FMS.vnavDevFt) / 500));
        gs.color = C.magenta;
        gs.label = 'V';
        gs.flag = '';
      } else {
        gs.valid = false;
        gs.flag = '';
        gs.label = '';
      }
    } else {
      const rx = this.navRx(src);
      const isLoc = v.getBool(NAV.isLoc(rx));
      const rcv = v.getBool(NAV.received(rx));
      h.courseVisible = true;
      h.course = v.get(NAV.obs(rx), v.get(AP.selCourse(s)));
      if (isLoc && v.has(NAV.locCourse(rx)) && !v.has(NAV.obs(rx))) h.course = v.get(NAV.locCourse(rx));
      h.courseColor = C.green;
      h.courseDouble = src === NavSrc.Nav2;
      h.cdiValid = rcv;
      h.cdi = v.get(NAV.cdi(rx));
      h.toFrom = isLoc ? 0 : v.get(NAV.toFrom(rx));
      h.xtkNm = NaN;
      loc.valid = isLoc && rcv;
      loc.dev = v.get(NAV.cdi(rx));
      loc.color = C.green;
      loc.flag = isLoc && !rcv ? 'LOC' : '';
      gs.valid = isLoc && v.getBool(NAV.gsValid(rx));
      gs.dev = v.get(NAV.gsDev(rx));
      gs.color = C.green;
      gs.label = 'G';
      gs.flag = isLoc && !gs.valid ? 'GS' : '';
    }
    h.sourceLabel = '';
    h.phaseLabel = '';
    // Bearing pointers.
    for (const n of [1, 2] as const) {
      const bp = n === 1 ? h.bearing1 : h.bearing2;
      const bs = v.get(FUSION_VARS.brg(s, n));
      bp.lines = n === 1 ? 1 : 2;
      bp.color = C.cyan;
      bp.visible = false;
      if (bs === BrgSrc.Vor) {
        const rx = sn.nav[n - 1];
        bp.visible = v.getBool(NAV.bearingValid(rx));
        bp.bearing = v.get(NAV.bearing(rx));
      } else if (bs === BrgSrc.Adf) {
        const rx = sn.adf[n - 1];
        bp.visible = v.getBool(NAV.adfValid(rx));
        bp.bearing = n360(hdg + v.get(NAV.adfBearing(rx)));
      } else if (bs === BrgSrc.Fms) {
        bp.visible = v.getString(FMS.nextWptIdent) !== '';
        bp.bearing = v.get(FMS.bearingToWptMag);
        bp.color = C.magenta;
      }
    }
    h.windValid = false;
    L.hsi.update(dt);
    L.gs.update(dt);
    L.loc.update(dt);
  }

  // ================================================================ draw

  draw(ctx: Ctx2D, x0: number, y0: number, w: number, h: number): void {
    const half = w < 700;
    const L = half ? this.halfL : this.full;
    ctx.save();
    ctx.translate(x0, y0);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    rect(ctx, 0, 0, w, h, C.bg);
    const v = this.v;
    const svsOn = this.svsLatch && this.svs.available;
    const adi = svsOn ? L.adiSvs : L.adi;
    if (svsOn && adi.state.valid) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, L.adiTop, L.w, L.adiBottom - L.adiTop);
      ctx.clip();
      this.svs.draw(ctx, 0, L.adiTop, L.w, L.adiBottom - L.adiTop, L.cx, L.cy, L.pxPerDeg, adi.state.pitch, adi.state.bank);
      ctx.restore();
    }
    adi.draw(ctx);
    this.drawLowBank(ctx, L);
    this.drawFpv(ctx, L, adi);
    this.drawAdiAnnunciations(ctx, L);
    L.spd.draw(ctx);
    L.alt.draw(ctx);
    L.vsi.draw(ctx);
    if (L.half) this.drawVsDigital(ctx, L);
    if (L.gs.state.valid || L.gs.state.flag) L.gs.draw(ctx);
    if (L.loc.state.valid || L.loc.state.flag) L.loc.draw(ctx);
    this.drawRadioAlt(ctx, L);
    this.drawMinimums(ctx, L);
    this.drawMarkers(ctx, L);
    this.drawSourceFlags(ctx, L);
    // Lower area: black background behind the compass.
    rect(ctx, 0, L.adiBottom, L.w, L.h - L.adiBottom, C.bg);
    seg(ctx, 0, L.adiBottom, L.w, L.adiBottom, C.line, 1);
    this.drawHsi(ctx, L);
    this.drawFma(ctx, L);
    this.drawMach(ctx, L);
    void v;
    ctx.restore();
  }

  private drawLowBank(ctx: Ctx2D, L: PfdLayout): void {
    if (!this.v.getBool('ap.half_bank')) return;
    // Low bank "eyebrow": green arc at the top of the bank scale (Global Express AFCS manual).
    const r = (L.half ? 150 : 175) + 10;
    ctx.save();
    ctx.translate(L.cx, L.cy);
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2 - 15 * DEG, -Math.PI / 2 + 15 * DEG);
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  private drawFpv(ctx: Ctx2D, L: PfdLayout, adi: AttitudeIndicator): void {
    if (!this.fpvValid) return;
    const v = this.v;
    const s = adi.state;
    const k = L.pxPerDeg;
    ctx.save();
    ctx.translate(L.cx, L.cy);
    ctx.rotate(-s.bank * DEG);
    // FPV position relative to the aircraft reference (pitch - fpa below the boresight).
    const fx = this.drift * k;
    const fy = (s.pitch - this.fpa) * k;
    const r = L.half ? 9 : 11;
    const wing = L.half ? 20 : 26;
    // Guidance cue (flight director) relative to the FPV (EST law: pitch error and bank error).
    const fdOn = v.getBool(AP.fdOn(this.side)) || v.getBool(AP.engaged);
    const fdValid = v.get('ap.fd_pitch_valid', 1) >= 0.5 && v.get('ap.fd_roll_valid', 1) >= 0.5;
    const cmdP = v.get(AP.fdPitch, NaN);
    const cmdB = v.get(AP.fdBank, NaN);
    if (fdOn && fdValid && Number.isFinite(cmdP) && Number.isFinite(cmdB)) {
      const gx = fx + Math.max(-40, Math.min(40, dAng(cmdB, s.bank))) * (L.half ? 2.4 : 3);
      const gy = fy - Math.max(-12, Math.min(12, cmdP - s.pitch)) * k;
      // Takeoff mode: pitch target box (FSB "Takeoff mode pitch target box").
      if (v.getString(AP.verticalActive) === 'TO') {
        ctx.strokeStyle = C.magenta;
        ctx.lineWidth = 3;
        ctx.strokeRect(-18, (s.pitch - cmdP) * k - 10, 36, 20);
      } else {
        ctx.beginPath();
        ctx.arc(gx, gy, r * 0.62, 0, Math.PI * 2);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.strokeStyle = C.magenta;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }
    // FPV: circle with wings and tail (white, black halo). Caged: ghost drift mark (EST).
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.moveTo(fx - r, fy);
    ctx.lineTo(fx - r - wing, fy);
    ctx.moveTo(fx + r, fy);
    ctx.lineTo(fx + r + wing, fy);
    ctx.moveTo(fx, fy - r);
    ctx.lineTo(fx, fy - r - wing * 0.45);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  private drawAdiAnnunciations(ctx: Ctx2D, L: PfdLayout): void {
    const v = this.v;
    const y = L.adiBottom - (L.half ? 78 : 92);
    const f = L.half ? 20 : 24;
    if (v.getBool('alert.taws_warning')) txtHalo(ctx, 'PULL UP', L.cx, y, f + 4, C.red, 'center');
    else if (v.getBool('alert.windshear')) txtHalo(ctx, 'WINDSHEAR', L.cx, y, f + 4, C.red, 'center');
    else if (v.getBool('alert.taws_caution')) txtHalo(ctx, v.getString('taws.alert') || 'TERRAIN', L.cx, y, f, C.amber, 'center');
    else if (v.getBool('tcas.ra')) txtHalo(ctx, 'TCAS RA', L.cx, y, f, C.red, 'center');
    else if (v.get('tcas.ta') > 0) txtHalo(ctx, 'TRAFFIC', L.cx, y, f, C.amber, 'center');
    if (v.getBool(FUSION_VARS.edm)) txtHalo(ctx, 'EMERGENCY DESCENT', L.cx, L.adiTop + (L.half ? 56 : 64), f - 2, C.amber, 'center');
    if (!L.adi.state.valid) {
      boxed(ctx, 'ATT FAIL', L.cx - 60, L.cy - 18, 120, 36, 22, C.red, C.red);
    }
    if (v.getBool(FUSION_VARS.fpvCaged(this.side))) txtHalo(ctx, 'FPV CAGE', L.cx + (L.half ? 80 : 150), L.cy + 30, 14, C.white, 'left');
  }

  private drawRadioAlt(ctx: Ctx2D, L: PfdLayout): void {
    const v = this.v;
    const s = this.side;
    const ra = v.get(FUSION_VARS.raSrc(s), this.svc.cfg.sensors.ra[s - 1]);
    const sn = sens(ra);
    if (v.get(sn.raValid) < 0.5 || v.get(sn.raNcd) >= 0.5) return;
    const ft = v.get(sn.raAlt);
    if (ft > 2500) return;
    const q = ft < 200 ? 5 : ft < 1500 ? 10 : 50;
    const val = Math.round(ft / q) * q;
    const reached = v.getBool(AP.minimumsIsRadio(s)) && this.mins.phase === 'reached';
    const w = L.half ? 70 : 84;
    const hgt = L.half ? 28 : 32;
    const y = L.adiBottom - (L.half ? 44 : 50);
    boxed(ctx, istr(val), L.cx - w / 2, y - hgt / 2, w, hgt, L.half ? 20 : 24, reached ? C.amber : C.white, C.white);
    txtHalo(ctx, 'RA', L.cx + w / 2 + 6, y, 14, C.white, 'left');
  }

  private drawMinimums(ctx: Ctx2D, L: PfdLayout): void {
    const v = this.v;
    const s = this.side;
    const ft = v.get(AP.minimums(s), NaN);
    if (!Number.isFinite(ft)) return;
    const isRa = v.getBool(AP.minimumsIsRadio(s));
    const x = L.half ? L.alt.x - 4 : L.alt.x - 10;
    const y = L.adiBottom - 16;
    const reached = this.mins.phase === 'reached';
    const color = reached ? C.amber : C.cyan;
    txtHalo(ctx, isRa ? 'RA' : 'BARO', x - (L.half ? 52 : 66), y, 14, color, 'right');
    txtHalo(ctx, istr(ft), x, y, L.half ? 17 : 20, color, 'right');
    if (reached && blinkOn(this.time, 1.6)) txtHalo(ctx, 'MIN', L.cx + (L.half ? 70 : 110), L.cy + 60, L.half ? 20 : 24, C.amber, 'center');
  }

  private drawMarkers(ctx: Ctx2D, L: PfdLayout): void {
    const v = this.v;
    let t = '';
    let c: string = C.white;
    if (v.getBool(NAV.markerInner)) {
      t = 'IM';
      c = C.white;
    } else if (v.getBool(NAV.markerMiddle)) {
      t = 'MM';
      c = C.amber;
    } else if (v.getBool(NAV.markerOuter)) {
      t = 'OM';
      c = C.cyan;
    }
    if (!t || !blinkOn(this.time, 2)) return;
    const x = L.alt.x - (L.half ? 34 : 44);
    const y = L.adiTop + (L.half ? 62 : 70);
    boxed(ctx, t, x - 18, y - 13, 36, 26, 16, c, c);
  }

  private drawSourceFlags(ctx: Ctx2D, L: PfdLayout): void {
    const v = this.v;
    const s = this.side;
    const x = L.half ? 88 : 310;
    let y = L.adiTop + (L.half ? 16 : 18);
    const adcRev = v.get(FUSION_VARS.rspAdc(s)) >= 0.5;
    const attRev = v.get(FUSION_VARS.rspAtt(s)) >= 0.5;
    if (attRev) {
      txtHalo(ctx, pstr('IRS', v.get(FUSION_VARS.ahrsSrc(s))), x, y, 16, C.amber, 'left');
      y += 18;
    }
    if (adcRev) txtHalo(ctx, pstr('ADC', v.get(FUSION_VARS.adcSrc(s))), x, y, 16, C.amber, 'left');
  }

  /** Half format V/S digital readout (above the VSI climbing, below descending), beyond 500 fpm like VSI_COLLINS. */
  private drawVsDigital(ctx: Ctx2D, L: PfdLayout): void {
    const st = L.vsi.state;
    if (!st.valid || !(Math.abs(st.vsFpm) >= 500)) return;
    const up = st.vsFpm > 0;
    txt(ctx, istr(Math.round(Math.abs(st.vsFpm) / 50) * 50), L.w - 2, up ? L.vsi.y - 8 : L.vsi.y + L.vsi.h + 9, 12, C.green, 'right');
  }

  private drawMach(ctx: Ctx2D, L: PfdLayout): void {
    const v = this.v;
    const s = this.side;
    const adc = v.get(FUSION_VARS.adcSrc(s), this.svc.cfg.sensors.adc[s - 1]);
    const m = v.get(ADC.mach(adc));
    if (m < 0.4) return;
    const x = L.spd.x + L.spd.w / 2;
    const y = L.spd.y + L.spd.h + (L.half ? 16 : 20);
    txt(ctx, MACH_STR[Math.max(0, Math.min(999, Math.round(m * 1000)))], x, y, L.half ? 17 : 20, C.white, 'center');
  }

  private drawHsi(ctx: Ctx2D, L: PfdLayout): void {
    const v = this.v;
    const s = this.side;
    const rose = v.getBool(FUSION_VARS.hsiRose(s));
    const hsi = L.hsi;
    if (!L.half) {
      hsi.mode = rose ? 'rose' : 'arc';
      hsi.cx = 512;
      hsi.cy = rose ? 560 : 708;
      hsi.radius = rose ? 76 : 226;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, L.adiBottom + 1, L.w, L.h - L.adiBottom - 1);
    ctx.clip();
    hsi.draw(ctx);
    ctx.restore();
    // Heading readout box at the lubber line.
    const st = hsi.state;
    const bx = hsi.cx;
    const by = hsi.mode === 'arc' ? hsi.cy - hsi.radius - 22 : hsi.cy - hsi.radius - 22;
    if (st.valid) boxed(ctx, hstr(st.heading), bx - 28, by - 14, 56, 28, 20, C.white, C.white);
    this.drawNavBlock(ctx, L);
    this.drawRightBlock(ctx, L);
  }

  private drawNavBlock(ctx: Ctx2D, L: PfdLayout): void {
    const v = this.v;
    const s = this.side;
    const src = v.get(FUSION_VARS.navSource(s));
    const x = L.half ? 6 : 24;
    let y = L.adiBottom + (L.half ? 20 : 24);
    const f = L.half ? 16 : 19;
    const dy = L.half ? 20 : 24;
    if (src === NavSrc.Fms) {
      txt(ctx, s === 1 ? 'FMS1' : 'FMS2', x, y, f, C.magenta);
      const mode = v.getString(FMS.approachMode);
      if (mode) txt(ctx, mode, x + (L.half ? 50 : 62), y, f - 3, C.magenta);
      y += dy;
      txt(ctx, v.getString(FMS.nextWptIdent) || '----', x, y, f, C.magenta);
      y += dy;
      txt(ctx, fstr(v.get(FMS.distToWptNm), 1), x, y, f, C.white);
      txt(ctx, 'NM', x + (L.half ? 58 : 70), y, f - 5, C.white);
      y += dy;
      const ete = v.get(FMS.eteToWptS);
      txt(ctx, Number.isFinite(ete) && ete > 0 && ete < 360000 ? ETE_STR[Math.min(ETE_STR.length - 1, Math.floor(ete / 60))] : '-:--', x, y, f, C.white);
      y += dy;
      txt(ctx, 'CRS', x, y, f - 3, C.white);
      txt(ctx, hstr(v.get(FMS.dtkMag)), x + (L.half ? 34 : 42), y, f, C.magenta);
    } else {
      const rx = this.navRx(src);
      const isLoc = v.getBool(NAV.isLoc(rx));
      const cross = (s === 1 && src === NavSrc.Nav2) || (s === 2 && src === NavSrc.Nav1);
      const col = cross ? C.amber : C.green;
      txt(ctx, isLoc ? (src === NavSrc.Nav2 ? 'LOC2' : 'LOC1') : src === NavSrc.Nav2 ? 'VOR2' : 'VOR1', x, y, f, col);
      y += dy;
      txt(ctx, v.getString(NAV.ident(rx)) || fstr(v.get(NAV.activeFreq(rx)), 2), x, y, f, C.green);
      y += dy;
      txt(ctx, v.getBool(NAV.dmeValid(rx)) ? fstr(v.get(NAV.dmeNm(rx)), 1) : '---.-', x, y, f, v.getBool(NAV.dmeHold(rx)) ? C.amber : C.white);
      txt(ctx, 'NM', x + (L.half ? 58 : 70), y, f - 5, C.white);
      if (v.getBool(NAV.dmeHold(rx))) txt(ctx, 'H', x + (L.half ? 96 : 112), y, f, C.amber);
      y += dy * 2;
      txt(ctx, 'CRS', x, y, f - 3, C.white);
      txt(ctx, hstr(v.get(NAV.obs(rx))), x + (L.half ? 34 : 42), y, f, C.green);
    }
  }

  private drawRightBlock(ctx: Ctx2D, L: PfdLayout): void {
    const v = this.v;
    const s = this.side;
    const x = L.half ? L.w - 6 : L.w - 24;
    let y = L.adiBottom + (L.half ? 20 : 24);
    const f = L.half ? 16 : 19;
    const dy = L.half ? 20 : 24;
    txt(ctx, 'HDG', x - (L.half ? 44 : 52), y, f - 3, C.white, 'right');
    txt(ctx, hstr(v.get(AP.selHeading)), x, y, f, C.cyan, 'right');
    y += dy;
    for (const n of [1, 2] as const) {
      const bs = v.get(FUSION_VARS.brg(s, n));
      if (bs === BrgSrc.Off) continue;
      const sn = this.svc.cfg.sensors;
      const label = bs === BrgSrc.Vor ? (n === 1 ? 'VOR1' : 'VOR2') : bs === BrgSrc.Adf ? (n === 1 ? 'ADF1' : 'ADF2') : s === 1 ? 'FMS1' : 'FMS2';
      const ident = bs === BrgSrc.Vor ? v.getString(NAV.ident(sn.nav[n - 1])) : bs === BrgSrc.Adf ? v.getString(NAV.adfIdent(sn.adf[n - 1])) : v.getString(FMS.nextWptIdent);
      txt(ctx, n === 1 ? '○' : '◇', x - (L.half ? 120 : 150), y, f, bs === BrgSrc.Fms ? C.magenta : C.cyan, 'left');
      txt(ctx, label, x - (L.half ? 100 : 128), y, f - 2, bs === BrgSrc.Fms ? C.magenta : C.cyan, 'left');
      txt(ctx, ident || '---', x, y, f - 2, C.white, 'right');
      y += dy;
    }
    // Ground speed / true airspeed and wind from sensors (GPS vs air data).
    const adc = v.get(FUSION_VARS.adcSrc(s), this.svc.cfg.sensors.adc[s - 1]);
    const gs = v.get(GPS.gs);
    const tas = v.get(ADC.tas(adc));
    txt(ctx, pstr('GS ', gs), x, y, f - 2, C.white, 'right');
    y += dy;
    txt(ctx, pstr('TAS ', tas), x, y, f - 2, C.white, 'right');
    y += dy;
    if (v.getBool(GPS.valid) && gs > 50 && tas > 50) {
      const ahrs = v.get(FUSION_VARS.ahrsSrc(s), this.svc.cfg.sensors.ahrs[s - 1]);
      const hdg = v.get(ADC.heading(ahrs)) * DEG;
      const trk = v.get(GPS.trackMag) * DEG;
      const wx = gs * Math.sin(trk) - tas * Math.sin(hdg);
      const wy = gs * Math.cos(trk) - tas * Math.cos(hdg);
      const spd = Math.hypot(wx, wy);
      if (spd >= 3) {
        const from = n360(Math.atan2(-wx, -wy) / DEG);
        txt(ctx, pstr('/', spd), x, y, f - 2, C.white, 'right');
        txt(ctx, hstr(from), x - (L.half ? 34 : 40), y, f - 2, C.white, 'right');
        // Arrow relative to the aircraft heading.
        const rel = (from + 180 - hdg / DEG) * DEG;
        const ax = x - (L.half ? 112 : 136);
        ctx.save();
        ctx.translate(ax, y);
        ctx.rotate(rel);
        ctx.beginPath();
        ctx.moveTo(0, 10);
        ctx.lineTo(0, -10);
        ctx.moveTo(-5, -4);
        ctx.lineTo(0, -10);
        ctx.lineTo(5, -4);
        ctx.strokeStyle = C.white;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawFma(ctx: Ctx2D, L: PfdLayout): void {
    const v = this.v;
    const s = this.side;
    const H = L.fmaH;
    rect(ctx, 0, 0, L.w, H, C.bg);
    seg(ctx, 0, H, L.w, H, C.line, 1.5);
    const f = L.half ? 16 : 21;
    const fa = L.half ? 13 : 16;
    // Columns (EST): A/T | lateral | AP / YD | vertical | approach / EDM.
    const cols = L.half ? [0, 86, 214, 292, 430, 512] : [0, 170, 420, 604, 860, 1024];
    for (let i = 1; i < cols.length - 1; i++) seg(ctx, cols[i], 4, cols[i], H - 4, C.line, 1.5);
    const yA = L.half ? 17 : 17;
    const yB = L.half ? 39 : 38;
    const flash = (fld: FmaField): boolean => fld.flashT > 0 && !blinkOn(this.time, 2);
    const at = this.fmaAt.text;
    const atWarn = v.getBool('at.disc_warn');
    if (atWarn) txt(ctx, 'AT', (cols[0] + cols[1]) / 2, yA, f, blinkOn(this.time, 2) ? C.amber : C.bg, 'center');
    else if (at && !flash(this.fmaAt)) txt(ctx, at, (cols[0] + cols[1]) / 2, yA, f, C.green, 'center');
    if (v.getBool(FUSION_VARS.spdFms)) txt(ctx, 'FMS SPD', (cols[0] + cols[1]) / 2, yB, fa, C.magenta, 'center');
    const lat = this.fmaLat.text;
    if (lat && !flash(this.fmaLat)) txt(ctx, lat, (cols[1] + cols[2]) / 2, yA, f, C.green, 'center');
    const latArm = this.fmaLatArm.text;
    if (latArm) txt(ctx, latArm, (cols[1] + cols[2]) / 2, yB, fa, C.white, 'center');
    // AP / YD with the coupling arrow (FD / AP reference side).
    const cpl = v.get(FUSION_VARS.coupleSide, 1) === 2 ? 2 : 1;
    const apx = (cols[2] + cols[3]) / 2;
    const apWarn = v.getBool('ap.disc_warn');
    const afcsN = v.get(FUSION_VARS.rspAfcs, 1) === 2 ? '2' : '1';
    const apTxt = afcsN === '2' ? 'AP2' : 'AP1';
    if (apWarn) {
      if (blinkOn(this.time, 2)) txt(ctx, apTxt, apx, yA, f, C.red, 'center');
    } else if (v.getBool(AP.engaged)) txt(ctx, apTxt, apx, yA, f, C.green, 'center');
    if (v.getBool(AP.yd)) txt(ctx, afcsN === '2' ? 'YD2' : 'YD1', apx, yB, fa, C.green, 'center');
    const arrowX = cpl === 1 ? cols[2] + 12 : cols[3] - 12;
    txt(ctx, cpl === 1 ? '◀' : '▶', arrowX, yA, fa, C.green, 'center');
    const vert = this.fmaVert.text;
    if (vert && !flash(this.fmaVert)) txt(ctx, vert, (cols[3] + cols[4]) / 2, yA, f, C.green, 'center');
    const vArm = this.fmaVertArm.text;
    if (vArm) txt(ctx, vArm, (cols[3] + cols[4]) / 2, yB, fa, C.white, 'center');
    const ex = (cols[4] + cols[5]) / 2;
    if (v.getBool(FUSION_VARS.edm)) txt(ctx, 'EDM', ex, yA, f, C.amber, 'center');
    else {
      const appr = v.getString(FMS.approachMode);
      if (v.getBool(FMS.approachActive) && appr) txt(ctx, appr, ex, yA, fa, C.magenta, 'center');
    }
    // Couple side coloured label: which PFD is the flight guidance reference (EST).
    if (cpl === s) txt(ctx, 'CPL', ex, yB, fa - 2, C.green, 'center');
  }
}
