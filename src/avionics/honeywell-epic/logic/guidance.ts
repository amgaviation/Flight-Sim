/**
 * Flight guidance panel (FGP / Honeywell GP-700) logic: maps every knob and
 * button of the glareshield panel to AFCS / autothrottle events and to the
 * selected-value SimVars, and drives the GP windows and lights.
 *
 * Layout and functions (G650ER glareshield photograph, J. Atchison 2023;
 * G600 glareshield, Gulfstream press image; code450 "ILS Approach",
 * "Go Around", "VNAV", "Before Starting Engines Checklist"):
 *   BARO (PUSH STD) | CRS 1 (PUSH DCT) | FD 1
 *   SPEED window, speed knob (push IAS/MACH), MAN (speed source), FLCH
 *   HEADING window, heading knob (push SYNC), HDG, NAV, APR, BC, LOW BANK
 *   AP, YD, A/T, PFD CMD (coupling arrows L / R)
 *   VS/FPA window, VS/FPA wheel, VS, FPA, VNAV
 *   ALTITUDE window, altitude knob (outer 1000 ft / inner 100 ft), ALT
 *   FD 2 | CRS 2 (PUSH DCT) | BARO (PUSH STD)
 *
 * Behaviour notes:
 *  - "The guidance panel PFD CMD button lights both L and R annunciators"
 *    in dual couple below 1200 ft RA on an ILS (code450 "ILS Approach").
 *    The coupled side's NAV SRC is the AFCS navigation source (`ap.nav_source`).
 *  - APR with the FMS as the source and an ILS / LOC approach loaded:
 *    the on-side NAV receiver is previewed / auto-tuned (code450: FMS nav
 *    source, "within 75 NM flight plan distance and 30 NM direct distance",
 *    approach selected) and APR "arms the glide slope". SCOPE: the NAV SRC
 *    changes to the on-side NAV receiver when APR is pressed instead of at
 *    LOC capture, so the AFCS flies LOC/GS (QA lesson: APR must switch the
 *    AFCS nav source to LOC when an ILS approach is active).
 *  - VNAV requires the FMS as the navigation source (code450 "VNAV").
 *  - Speed MAN / FMS: FMS speed = the VNAV target speed
 *    (`fms.vnav_tgt_speed_kt/mach`), MAN = the guidance-panel speed.
 * Knob increments (EST, typical Honeywell GP): speed 1 kt / 0.01 M,
 * heading and course 1 deg (x10 above 12 clicks/s), altitude 1000 / 100 ft,
 * VS 100 fpm, FPA 0.1 deg, baro 0.01 inHg / 1 hPa.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { ADC, AP, FMS, GPS, NAV } from '../../../core/vars';
import { AFCS_VARS } from '../../../systems/autopilot/vars';
import { VERTICAL_MODES } from '../../../systems/autopilot/types';
import { EPIC_EVENTS, EPIC_VARS, NavSrc } from '../vars';
import type { EpicEventMap, EpicSensors } from '../config';

/** Guidance panel controls: id -> kind. Knobs emit `<id>_inc` / `<id>_dec` with a click count. */
export const GP_CONTROLS = {
  // knobs
  crs1: 'knob',
  crs2: 'knob',
  baro1: 'knob',
  baro2: 'knob',
  spd: 'knob',
  hdg: 'knob',
  vs: 'knob',
  alt: 'knob',
  alt_fine: 'knob',
  // knob pushes
  crs1_push: 'button',
  crs2_push: 'button',
  baro1_push: 'button',
  baro2_push: 'button',
  spd_push: 'button',
  hdg_push: 'button',
  // buttons
  fd1: 'button',
  fd2: 'button',
  man: 'button',
  flch: 'button',
  hdg_btn: 'button',
  nav: 'button',
  apr: 'button',
  bc: 'button',
  lowbank: 'button',
  ap: 'button',
  yd: 'button',
  at: 'button',
  pfdcmd: 'button',
  vs_btn: 'button',
  fpa: 'button',
  vnav: 'button',
  alt_btn: 'button',
} as const;
export type GpControl = keyof typeof GP_CONTROLS;

/** Light var per lit guidance-panel key (AFCS `ap.btn_*` plus suite vars). */
export const GP_LIGHTS: Partial<Record<GpControl, string>> = {
  fd1: AP.fdOn(1),
  fd2: AP.fdOn(2),
  hdg_btn: AFCS_VARS.button('hdg'),
  nav: AFCS_VARS.button('nav'),
  apr: AFCS_VARS.button('apr'),
  bc: AFCS_VARS.button('bc'),
  lowbank: AFCS_VARS.button('half_bank'),
  ap: AFCS_VARS.button('ap'),
  yd: AFCS_VARS.button('yd'),
  at: AP.athr,
  flch: AFCS_VARS.button('flc'),
  vs_btn: AFCS_VARS.button('vs'),
  vnav: AFCS_VARS.button('vnav'),
  alt_btn: AFCS_VARS.button('alt'),
  man: EPIC_VARS.speedMan,
};

/** String window contents computed by the logic (cached strings, rebuilt only on change). */
export interface GpWindows {
  speed: string;
  heading: string;
  vsfpa: string;
  altitude: string;
  /** Small legend above the VS/FPA digits ('VS', 'FPA', ''). */
  vsLegend: string;
  /** 'IAS' / 'MACH' / 'FMS' legend in the speed window. */
  speedLegend: string;
}

export interface GuidancePanelOptions {
  sensors: EpicSensors;
  events: EpicEventMap;
  /** Guidance panel power (keys dead and windows blank when false). */
  powered?: () => boolean;
  /** Approach auto-tune / preview limits (code450): along-plan and direct distance (nm). */
  previewAlongNm?: number;
  previewDirectNm?: number;
  /** Destination direct distance source, default reads the FMS approach plan through `approachInfo`. */
  approachInfo?: () => { freqMhz: number; courseMag: number } | null;
}

const VS_CODE = VERTICAL_MODES.indexOf('VS');
const FPA_CODE = VERTICAL_MODES.indexOf('FPA');
const PIT_CODE = VERTICAL_MODES.indexOf('PIT');

export class GuidancePanelLogic {
  readonly name = 'epic.gp';
  readonly windows: GpWindows = { speed: '', heading: '', vsfpa: '', altitude: '', vsLegend: '', speedLegend: '' };
  private readonly vars: SimVars;
  private readonly events: EventBus;
  private readonly opts: GuidancePanelOptions;
  private readonly offs: (() => void)[] = [];
  private readonly ap: string;
  private readonly poweredFn: () => boolean;
  private lastVert = -1;
  private readonly knobT: Record<string, number> = {};
  private readonly knobRate: Record<string, number> = {};
  private time = 0;
  // Window caches.
  private cSpd = NaN;
  private cSpdMode = -1;
  private cHdg = NaN;
  private cVs = NaN;
  private cVsMode = -1;
  private cAlt = NaN;
  private previewTimer = 0;

  constructor(vars: SimVars, events: EventBus, opts: GuidancePanelOptions) {
    this.vars = vars;
    this.events = events;
    this.opts = opts;
    this.ap = opts.events.afcsPrefix;
    this.poweredFn = opts.powered ?? (() => true);
    const init = (n: string, x: number): void => {
      if (!vars.has(n)) vars.set(n, x);
    };
    init(EPIC_VARS.coupleSide, 1);
    init(EPIC_VARS.speedMan, 1);
    init(EPIC_VARS.fpaRef, 0);
    for (const s of [1, 2]) {
      init(EPIC_VARS.navSrc(s), NavSrc.Fms);
      init(EPIC_VARS.fmsNum(s), s);
    }
    for (const id of Object.keys(GP_CONTROLS) as GpControl[]) {
      if (GP_CONTROLS[id] === 'knob') {
        this.offs.push(events.on(EPIC_EVENTS.gp(`${id}_inc`), (p) => this.turn(id, Math.max(1, Number(p ?? 1)))));
        this.offs.push(events.on(EPIC_EVENTS.gp(`${id}_dec`), (p) => this.turn(id, -Math.max(1, Number(p ?? 1)))));
        this.offs.push(events.on(EPIC_EVENTS.gp(id), (p) => this.turn(id, Number(p ?? 0))));
      } else {
        this.offs.push(events.on(EPIC_EVENTS.gp(id), () => this.press(id)));
      }
    }
    this.update(0);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  private afcs(btn: string, payload?: unknown): void {
    this.events.emit(`${this.ap}${btn}`, payload);
  }

  /** Accelerated knob steps: x10 while turned faster than 12 clicks/s (EST). */
  private accel(id: string, steps: number): number {
    const last = this.knobT[id] ?? -1;
    const dt = this.time - last;
    this.knobT[id] = this.time;
    const rate = dt > 0 && dt < 0.5 ? Math.abs(steps) / dt : 0;
    const r = (this.knobRate[id] = 0.6 * (this.knobRate[id] ?? 0) + 0.4 * rate);
    return r > 12 ? steps * 10 : steps;
  }

  /** Knob rotation (+ = clockwise). */
  turn(id: GpControl, steps: number): void {
    if (!this.poweredFn() || steps === 0) return;
    const v = this.vars;
    switch (id) {
      case 'hdg': {
        const n = this.accel(id, steps);
        v.set(AP.selHeading, wrap360(v.get(AP.selHeading) + n));
        break;
      }
      case 'crs1':
      case 'crs2': {
        const side = id === 'crs1' ? 1 : 2;
        const n = this.accel(id, steps);
        const r = this.courseReceiver(side);
        if (r > 0) v.set(NAV.obs(r), wrap360(v.get(NAV.obs(r)) + n));
        v.set(AP.selCourse(side), wrap360(v.get(AP.selCourse(side)) + n));
        break;
      }
      case 'spd': {
        if (v.get(AP.speedIsMach) !== 0) v.set(AP.selMach, clamp(round3(v.get(AP.selMach) + 0.01 * steps), 0.4, 0.935));
        else v.set(AP.selSpeed, clamp(Math.round(v.get(AP.selSpeed) + this.accel(id, steps)), 100, 340));
        break;
      }
      case 'alt':
        v.set(AP.selAltitude, clamp(Math.round((v.get(AP.selAltitude) + 1000 * steps) / 100) * 100, 0, 51000));
        break;
      case 'alt_fine':
        v.set(AP.selAltitude, clamp(Math.round((v.get(AP.selAltitude) + 100 * steps) / 100) * 100, 0, 51000));
        break;
      case 'vs': {
        const code = v.get(AFCS_VARS.vertCode);
        if (code === FPA_CODE) v.set(EPIC_VARS.fpaRef, clamp(Math.round((v.get(EPIC_VARS.fpaRef) + 0.1 * steps) * 10) / 10, -10, 10));
        if (code === VS_CODE || code === FPA_CODE || code === PIT_CODE) this.afcs(steps > 0 ? 'up' : 'dn', { steps: Math.abs(steps) });
        break;
      }
      case 'baro1':
      case 'baro2': {
        const side = id === 'baro1' ? 1 : 2;
        const adc = this.adcIndex(side);
        if (v.get(ADC.baroStd(adc)) !== 0) break; // STD selected: knob preselects nothing (SCOPE)
        const hpa = v.get(EPIC_VARS.baroHpa(side)) !== 0;
        const cur = v.get(ADC.baroSetting(adc), 29.92);
        const next = hpa ? (Math.round(cur * HPA) + steps) / HPA : Math.round((cur + 0.01 * steps) * 100) / 100;
        v.set(ADC.baroSetting(adc), clamp(next, 27.5, 31.5));
        break;
      }
      default:
        break;
    }
  }

  /** Button (or knob push) press. */
  press(id: GpControl): void {
    if (!this.poweredFn()) return;
    const v = this.vars;
    switch (id) {
      case 'fd1':
        this.afcs('fd1');
        break;
      case 'fd2':
        this.afcs('fd2');
        break;
      case 'ap':
        this.syncNavSource();
        this.afcs('ap');
        break;
      case 'yd':
        this.afcs('yd');
        break;
      case 'at':
        this.events.emit(this.opts.events.atEngage);
        break;
      case 'hdg_btn':
        this.afcs('hdg');
        break;
      case 'hdg_push':
        this.afcs('hdg_sync');
        break;
      case 'nav':
        this.syncNavSource();
        this.afcs('nav');
        break;
      case 'apr':
        this.pressApproach();
        break;
      case 'bc':
        this.syncNavSource();
        this.afcs('bc');
        break;
      case 'lowbank':
        this.afcs('half_bank');
        break;
      case 'pfdcmd': {
        const s = v.get(EPIC_VARS.coupleSide) === 1 ? 2 : 1;
        v.set(EPIC_VARS.coupleSide, s);
        this.syncNavSource();
        break;
      }
      case 'flch':
        this.afcs('flc');
        break;
      case 'vs_btn':
        this.afcs('vs');
        break;
      case 'fpa':
        this.afcs('fpa');
        break;
      case 'vnav':
        // VNAV needs the FMS as the navigation source on the coupled side.
        if (v.get(EPIC_VARS.navSrc(this.coupled())) === NavSrc.Fms) {
          this.syncNavSource();
          this.afcs('vnav');
        }
        break;
      case 'alt_btn':
        this.afcs('alt');
        break;
      case 'man': {
        const man = v.get(EPIC_VARS.speedMan) === 0;
        if (man) {
          // Switching to MAN: the manual speed starts at the current FMS target (EST).
          const kt = v.get(FMS.vnavTargetSpeedKt);
          const m = v.get(FMS.vnavTargetMach);
          if (m > 0.3) {
            v.set(AP.selMach, round3(m));
            v.set(AP.speedIsMach, 1);
          } else if (kt > 60) {
            v.set(AP.selSpeed, Math.round(kt));
            v.set(AP.speedIsMach, 0);
          }
        }
        v.set(EPIC_VARS.speedMan, man ? 1 : 0);
        break;
      }
      case 'spd_push':
        this.afcs('spd_mach');
        break;
      case 'crs1_push':
      case 'crs2_push': {
        // PUSH DCT: course to the station (VOR) or the localizer course.
        const side = id === 'crs1_push' ? 1 : 2;
        const r = this.courseReceiver(side);
        if (r > 0) {
          if (v.get(NAV.isLoc(r)) !== 0 && v.get(NAV.received(r)) !== 0) v.set(NAV.obs(r), Math.round(wrap360(v.get(NAV.locCourse(r)))));
          else if (v.get(NAV.bearingValid(r)) !== 0) v.set(NAV.obs(r), Math.round(wrap360(v.get(NAV.bearing(r)))));
          v.set(AP.selCourse(side), v.get(NAV.obs(r)));
        }
        break;
      }
      case 'baro1_push':
      case 'baro2_push': {
        const side = id === 'baro1_push' ? 1 : 2;
        const adc = this.adcIndex(side);
        v.set(ADC.baroStd(adc), v.get(ADC.baroStd(adc)) !== 0 ? 0 : 1);
        break;
      }
      default:
        break;
    }
  }

  /** The coupled side (PFD CMD): 1 pilot, 2 copilot. */
  coupled(): 1 | 2 {
    return this.vars.get(EPIC_VARS.coupleSide) === 2 ? 2 : 1;
  }

  private adcIndex(side: 1 | 2): number {
    const sel = this.vars.get(EPIC_VARS.adcSel(side));
    return sel > 0 ? sel : this.opts.sensors.sides[side - 1].adc;
  }

  /** NAV receiver whose OBS the CRS knob of `side` sets (the side's NAV source, else its on-side receiver). */
  private courseReceiver(side: 1 | 2): number {
    const src = this.vars.get(EPIC_VARS.navSrc(side));
    return src >= NavSrc.Nav1 ? src : this.opts.sensors.sides[side - 1].nav;
  }

  /** `ap.nav_source` follows the coupled side's NAV SRC (0 FMS, n NAVn). */
  private syncNavSource(): void {
    this.vars.set(AFCS_VARS.navSource, this.vars.get(EPIC_VARS.navSrc(this.coupled())));
  }

  private pressApproach(): void {
    const v = this.vars;
    const side = this.coupled();
    const src = v.get(EPIC_VARS.navSrc(side));
    if (src === NavSrc.Fms) {
      const app = this.opts.approachInfo?.() ?? null;
      const r = this.opts.sensors.sides[side - 1].nav;
      if (app && app.freqMhz > 0) {
        // ILS / LOC approach loaded: tune (if not yet) and switch the source to the NAV receiver.
        if (Math.abs(v.get(NAV.activeFreq(r)) - app.freqMhz) > 0.001) v.set(NAV.activeFreq(r), app.freqMhz);
        v.set(NAV.obs(r), Math.round(wrap360(app.courseMag)));
        v.set(EPIC_VARS.navSrc(side), r);
      }
    }
    this.syncNavSource();
    this.afcs('apr');
  }

  update(dt: number): void {
    this.time += dt;
    const v = this.vars;
    // FPA reference mirror (display): initialise on entering FPA from the current flight path angle.
    const vert = v.get(AFCS_VARS.vertCode);
    if (vert !== this.lastVert) {
      if (vert === FPA_CODE) {
        const gs = Math.max(1, v.get(GPS.gs));
        const vs = v.get(ADC.vs(this.adcIndex(this.coupled())));
        v.set(EPIC_VARS.fpaRef, Math.round((Math.atan2(vs, gs * 101.269) * 180) / Math.PI * 10) / 10);
      }
      this.lastVert = vert;
    }
    v.set(EPIC_VARS.lowBank, v.get(AFCS_VARS.halfBank));
    // Approach preview / auto-tune: FMS source, approach with a NAV frequency within range.
    this.previewTimer -= dt;
    if (this.previewTimer <= 0) {
      this.previewTimer = 1;
      this.autoTune();
    }
    this.updateWindows();
  }

  /** Auto NAV preview (code450: within 75 nm along the plan and 30 nm direct of the destination). */
  private autoTune(): void {
    const v = this.vars;
    const app = this.opts.approachInfo?.() ?? null;
    for (const side of SIDES) {
      const pv = EPIC_VARS.preview(side);
      if (!app || app.freqMhz <= 0 || v.get(EPIC_VARS.navSrc(side)) !== NavSrc.Fms) {
        v.set(pv, 0);
        continue;
      }
      const along = v.get(FMS.distToDestNm, 1e9);
      const direct = v.get(EPIC_VARS.destDirectNm, along);
      if (along <= (this.opts.previewAlongNm ?? 75) && direct <= (this.opts.previewDirectNm ?? 30)) {
        const r = this.opts.sensors.sides[side - 1].nav;
        if (Math.abs(v.get(NAV.activeFreq(r)) - app.freqMhz) > 0.001) v.set(NAV.activeFreq(r), app.freqMhz);
        v.set(NAV.obs(r), Math.round(wrap360(app.courseMag)));
        v.set(pv, 1);
      } else v.set(pv, 0);
    }
  }

  private updateWindows(): void {
    const v = this.vars;
    const w = this.windows;
    const on = this.poweredFn();
    // SPEED
    const man = v.get(EPIC_VARS.speedMan) !== 0;
    const isMach = v.get(AP.speedIsMach) !== 0;
    const spdMode = !on ? 0 : !man ? 1 : isMach ? 2 : 3;
    const spd = spdMode === 2 ? v.get(AP.selMach) : spdMode === 3 ? v.get(AP.selSpeed) : 0;
    if (spdMode !== this.cSpdMode || spd !== this.cSpd) {
      this.cSpdMode = spdMode;
      this.cSpd = spd;
      w.speed = spdMode === 0 ? '' : spdMode === 1 ? '---' : spdMode === 2 ? `.${Math.round(spd * 1000).toString().padStart(3, '0')}` : Math.round(spd).toString();
      w.speedLegend = spdMode === 0 ? '' : spdMode === 1 ? 'FMS' : spdMode === 2 ? 'MACH' : 'IAS';
    }
    // HEADING
    const hdg = on ? Math.round(wrap360(v.get(AP.selHeading))) : -1;
    if (hdg !== this.cHdg) {
      this.cHdg = hdg;
      w.heading = hdg < 0 ? '' : (hdg === 0 ? 360 : hdg).toString().padStart(3, '0');
    }
    // VS / FPA
    const code = v.get(AFCS_VARS.vertCode);
    const vsMode = !on ? 0 : code === VS_CODE ? 1 : code === FPA_CODE ? 2 : 3;
    const vsv = vsMode === 1 ? v.get(AP.selVs) : vsMode === 2 ? v.get(EPIC_VARS.fpaRef) : 0;
    if (vsMode !== this.cVsMode || vsv !== this.cVs) {
      this.cVsMode = vsMode;
      this.cVs = vsv;
      w.vsfpa = vsMode === 1 ? `${vsv > 0 ? '+' : vsv < 0 ? '-' : ' '}${Math.abs(Math.round(vsv))}` : vsMode === 2 ? `${vsv > 0 ? '+' : vsv < 0 ? '-' : ' '}${Math.abs(vsv).toFixed(1)}` : '';
      w.vsLegend = vsMode === 1 ? 'VS' : vsMode === 2 ? 'FPA' : '';
    }
    // ALTITUDE
    const alt = on ? Math.round(v.get(AP.selAltitude)) : -1;
    if (alt !== this.cAlt) {
      this.cAlt = alt;
      w.altitude = alt < 0 ? '' : alt.toString();
    }
  }
}

const HPA = 33.86389;
const SIDES = [1, 2] as const;

function wrap360(d: number): number {
  const r = d % 360;
  return r <= 0 ? r + 360 : r;
}
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
