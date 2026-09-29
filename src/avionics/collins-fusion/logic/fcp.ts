/**
 * Flight Control Panel (Collins FCP-5120, Global Vision glareshield) logic:
 * turns button presses and knob clicks into AFCS / autothrottle events and
 * selected-value vars, and drives the button annunciators.
 *
 * Sources:
 *  - Collins course syllabus 523-0817473 (FCP-5120 Flight Control Panel,
 *    FCSA-5000 Flight Control System Application).
 *  - FAA FSB report BD-700-1A10 Rev 7 appendix 6 (Global Express to Global
 *    6000 differences): "New Flight Control Panel"; "Emergency Descent Mode
 *    (EDM) button on FCP"; "Auto pilot and auto throttles engage for EDM
 *    when manually initiated"; "Manual speed control available during EDM
 *    operation"; "Altitude knob PUSH FINE function"; "Auto-throttle ...
 *    engaged from the FCP"; "Auto Nav to Nav Transfer on Missed Approach".
 *  - Global Express "Automatic Flight" manual (guidance panel heritage):
 *    FD, CPL, AP, YD, FLC, NAV, BANK, HDG (PUSH SYNC), VNAV, ALT, APR, VS,
 *    BC, SPD knob PUSH CHG (IAS / Mach), SPD MAN / FMS, CRS 1/2 PUSH DCT,
 *    pitch wheel DN / UP; FD switch removes the off-side command bars.
 *
 * Event map (`fusion.fcp.<id>`, knobs `<knob>_inc` / `<knob>_dec` with the
 * click count as payload) -> AFCS event (`<afcsPrefix><name>`):
 *   fd1 fd1 | fd2 fd2 | ap ap | yd yd | hdg hdg | nav nav | appr apr | bc bc
 *   bank half_bank | flc flc | vs vs | vnav vnav | alt alt | hdg_push hdg_sync
 *   spd_push spd_mach | pitch_inc up | pitch_dec dn | toga toga
 *   at -> `at.engage`; cpl -> coupled side; spd_man -> MAN / FMS speed;
 *   alt_push -> FINE; edm -> Emergency Descent Mode; crs{1,2}_push -> DIRECT.
 * EST: EDM target altitude 15,000 ft and a 90 deg left turn (Collins EDM
 * as described for the Global 7500 / Challenger 650 marketing material; no
 * Global 6000 AFM extract was available), speed target VMO/MMO - 10 kt / 0.01.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { ADC, AP, FMS, NAV } from '../../../core/vars';
import { FUSION_EVENTS, FUSION_VARS, NavSrc } from '../vars';
import { mmoAt, vmoAt, type FusionAirframe, type FusionEventMap, type FusionSensors } from '../config';

export const FCP_BUTTONS = ['fd1', 'fd2', 'cpl', 'ap', 'yd', 'at', 'hdg', 'nav', 'appr', 'bc', 'bank', 'flc', 'vs', 'vnav', 'alt', 'spd_man', 'edm', 'hdg_push', 'crs1_push', 'crs2_push', 'alt_push', 'spd_push', 'toga'] as const;
export type FcpButton = (typeof FCP_BUTTONS)[number];
export const FCP_KNOBS = ['hdg', 'crs1', 'crs2', 'alt', 'spd', 'pitch'] as const;
export type FcpKnob = (typeof FCP_KNOBS)[number];

/** Button -> AFCS event name (without prefix). */
const AFCS_MAP: Partial<Record<FcpButton, string>> = {
  fd1: 'fd1',
  fd2: 'fd2',
  ap: 'ap',
  yd: 'yd',
  hdg: 'hdg',
  nav: 'nav',
  bc: 'bc',
  bank: 'half_bank',
  flc: 'flc',
  vs: 'vs',
  vnav: 'vnav',
  alt: 'alt',
  hdg_push: 'hdg_sync',
  spd_push: 'spd_mach',
  toga: 'toga',
};

/** Annunciator var per lit button (AFCS `ap.btn_*`, A/T and suite vars). */
export const FCP_LIGHTS: Partial<Record<FcpButton, string>> = {
  ap: 'ap.btn_ap',
  yd: 'ap.btn_yd',
  hdg: 'ap.btn_hdg',
  nav: 'ap.btn_nav',
  appr: 'ap.btn_apr',
  bc: 'ap.btn_bc',
  bank: 'ap.btn_half_bank',
  flc: 'ap.btn_flc',
  vs: 'ap.btn_vs',
  vnav: 'ap.btn_vnav',
  alt: 'ap.btn_alt',
  at: 'ap.at_engaged',
  fd1: 'ap.fd1_on',
  fd2: 'ap.fd2_on',
  edm: FUSION_VARS.edm,
  spd_man: FUSION_VARS.spdFms,
};

/** Maximum operating altitude (ft): EASA TCDS IM.A.009 "51,000 ft maximum operating altitude". */
export const MAX_SEL_ALT_FT = 51000;
/** EST: EDM target altitude and speed margins (see header). */
export const EDM_ALT_FT = 15000;
const EDM_TURN_DEG = -90;

export interface ApproachInfo {
  freqMhz: number;
  courseMag: number;
  ident: string;
}

export interface FcpOptions {
  sensors: FusionSensors;
  events: FusionEventMap;
  airframe: FusionAirframe;
  powered?: () => boolean;
  /** LOC-type approach of the active flight plan (null = none), for APPR nav-to-nav transfer. */
  approachInfo?: () => ApproachInfo | null;
}

export class FcpLogic {
  private readonly offs: (() => void)[] = [];
  private readonly powered: () => boolean;
  private readonly clicksPayload = { steps: 1 };
  private edmArmedAlt = false;

  constructor(
    private readonly vars: SimVars,
    private readonly events: EventBus,
    private readonly opts: FcpOptions,
  ) {
    this.powered = opts.powered ?? (() => true);
    for (const b of FCP_BUTTONS) this.offs.push(events.on(FUSION_EVENTS.fcp(b), () => this.press(b)));
    for (const k of FCP_KNOBS) {
      this.offs.push(
        events.on(FUSION_EVENTS.fcp(`${k}_inc`), (p) => this.turn(k, Math.max(1, Number(p ?? 1) || 1))),
        events.on(FUSION_EVENTS.fcp(`${k}_dec`), (p) => this.turn(k, -Math.max(1, Number(p ?? 1) || 1))),
      );
    }
    const v = vars;
    if (!v.has(FUSION_VARS.coupleSide)) v.set(FUSION_VARS.coupleSide, 1);
    if (!v.has(FUSION_VARS.spdFms)) v.set(FUSION_VARS.spdFms, 0);
    if (!v.has(FUSION_VARS.altFine)) v.set(FUSION_VARS.altFine, 0);
    if (!v.has(FUSION_VARS.edm)) v.set(FUSION_VARS.edm, 0);
    if (!v.has(AP.selAltitude)) v.set(AP.selAltitude, 10000);
    if (!v.has(AP.selSpeed)) v.set(AP.selSpeed, 200);
    if (!v.has(AP.selMach)) v.set(AP.selMach, 0.8);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  private afcs(name: string, payload?: unknown): void {
    this.events.emit(`${this.opts.events.afcsPrefix}${name}`, payload);
  }

  get coupledSide(): 1 | 2 {
    return this.vars.get(FUSION_VARS.coupleSide, 1) === 2 ? 2 : 1;
  }

  // ------------------------------------------------------------ buttons

  press(b: FcpButton): void {
    if (!this.powered()) return;
    const v = this.vars;
    switch (b) {
      case 'cpl':
        v.set(FUSION_VARS.coupleSide, this.coupledSide === 1 ? 2 : 1);
        this.syncNavSource();
        return;
      case 'at':
        this.events.emit(this.opts.events.atEngage);
        return;
      case 'spd_man':
        v.set(FUSION_VARS.spdFms, v.get(FUSION_VARS.spdFms) >= 0.5 ? 0 : 1);
        return;
      case 'alt_push':
        v.set(FUSION_VARS.altFine, v.get(FUSION_VARS.altFine) >= 0.5 ? 0 : 1);
        return;
      case 'edm':
        this.toggleEdm();
        return;
      case 'crs1_push':
      case 'crs2_push':
        this.courseDirect(b === 'crs1_push' ? 1 : 2);
        return;
      case 'appr':
        this.approach();
        return;
      case 'nav':
        this.syncNavSource();
        this.cancelEdm();
        this.afcs('nav');
        return;
    }
    const name = AFCS_MAP[b];
    if (!name) return;
    if (v.get(FUSION_VARS.edm) >= 0.5 && (b === 'hdg' || b === 'flc' || b === 'vs' || b === 'vnav' || b === 'alt' || b === 'bc')) {
      // Selecting another mode cancels EDM (EST).
      v.set(FUSION_VARS.edm, 0);
      this.edmArmedAlt = false;
    }
    this.afcs(name);
  }

  /** APPR: nav-to-nav transfer to the approach localizer (QA lesson: fly the LOC, not the FMS path). */
  private approach(): void {
    const v = this.vars;
    const s = this.coupledSide;
    const src = v.get(FUSION_VARS.navSource(s));
    const info = this.opts.approachInfo?.() ?? null;
    if (src === NavSrc.Fms && info) {
      const rx = this.opts.sensors.nav[s - 1];
      v.set(NAV.activeFreq(rx), info.freqMhz);
      v.set(NAV.obs(rx), info.courseMag);
      v.set(AP.selCourse(s), info.courseMag);
      v.set(FUSION_VARS.navSource(s), s === 1 ? NavSrc.Nav1 : NavSrc.Nav2);
    }
    this.syncNavSource();
    this.afcs('apr');
  }

  /** CRS PUSH DCT: course to the station (VOR bearing), on the side's selected receiver. */
  private courseDirect(s: 1 | 2): void {
    const v = this.vars;
    const rx = this.courseReceiver(s);
    if (!v.getBool(NAV.received(rx)) || v.getBool(NAV.isLoc(rx)) || !v.getBool(NAV.bearingValid(rx))) return;
    const brg = Math.round(norm360(v.get(NAV.bearing(rx)))) || 360;
    v.set(NAV.obs(rx), brg);
    v.set(AP.selCourse(s), brg);
  }

  private courseReceiver(s: 1 | 2): number {
    const src = this.vars.get(FUSION_VARS.navSource(s));
    if (src === NavSrc.Nav1) return this.opts.sensors.nav[0];
    if (src === NavSrc.Nav2) return this.opts.sensors.nav[1];
    return this.opts.sensors.nav[s - 1];
  }

  private cancelEdm(): void {
    if (this.vars.get(FUSION_VARS.edm) >= 0.5) {
      this.vars.set(FUSION_VARS.edm, 0);
      this.edmArmedAlt = false;
    }
  }

  private toggleEdm(): void {
    const v = this.vars;
    if (v.get(FUSION_VARS.edm) >= 0.5) {
      v.set(FUSION_VARS.edm, 0);
      this.edmArmedAlt = false;
      return;
    }
    const s = this.coupledSide;
    const adc = this.opts.sensors.adc[s - 1];
    const ahrs = this.opts.sensors.ahrs[s - 1];
    const alt = v.get(ADC.baroAlt(adc));
    if (alt <= EDM_ALT_FT + 500) return; // nothing to descend to
    v.set(FUSION_VARS.edm, 1);
    this.edmArmedAlt = true;
    v.set(AP.selAltitude, EDM_ALT_FT);
    v.set(AP.selHeading, norm360(v.get(ADC.heading(ahrs)) + EDM_TURN_DEG) || 360);
    const af = this.opts.airframe;
    v.set(AP.selSpeed, vmoAt(af, alt) - 10);
    v.set(AP.selMach, Math.round((mmoAt(af, alt) - 0.01) * 100) / 100);
    v.set(FUSION_VARS.spdFms, 0);
    if (!v.getBool(AP.engaged)) this.afcs('ap');
    if (!v.getBool(AP.athr)) this.events.emit(this.opts.events.atEngage);
    if (v.getString(AP.lateralActive) !== 'HDG') this.afcs('hdg');
    this.afcs('flc');
  }

  // ------------------------------------------------------------ knobs

  turn(k: FcpKnob, clicks: number): void {
    if (!this.powered() || clicks === 0) return;
    const v = this.vars;
    switch (k) {
      case 'hdg': {
        v.set(AP.selHeading, norm360(v.get(AP.selHeading) + clicks) || 360);
        return;
      }
      case 'crs1':
      case 'crs2': {
        const s = k === 'crs1' ? 1 : 2;
        const rx = this.courseReceiver(s);
        const c = norm360(v.get(NAV.obs(rx)) + clicks) || 360;
        v.set(NAV.obs(rx), c);
        v.set(AP.selCourse(s), c);
        return;
      }
      case 'alt': {
        const step = v.get(FUSION_VARS.altFine) >= 0.5 ? 100 : 1000;
        const cur = v.get(AP.selAltitude);
        // Snap to the step grid first (a fine setting followed by coarse steps rounds to the grid).
        const snapped = clicks > 0 ? Math.floor(cur / step) * step : Math.ceil(cur / step) * step;
        const next = Math.min(MAX_SEL_ALT_FT, Math.max(0, (snapped === cur ? cur : snapped) + clicks * step));
        v.set(AP.selAltitude, next);
        return;
      }
      case 'spd': {
        if (v.get(FUSION_VARS.spdFms) >= 0.5) v.set(FUSION_VARS.spdFms, 0); // EST: turning the knob selects MAN
        if (v.getBool(AP.speedIsMach)) v.set(AP.selMach, Math.min(0.95, Math.max(0.4, Math.round((v.get(AP.selMach) + clicks * 0.01) * 100) / 100)));
        else v.set(AP.selSpeed, Math.min(400, Math.max(100, Math.round(v.get(AP.selSpeed)) + clicks)));
        return;
      }
      case 'pitch': {
        this.clicksPayload.steps = Math.abs(clicks);
        this.afcs(clicks > 0 ? 'up' : 'dn', this.clicksPayload);
        return;
      }
    }
  }

  /** Writes `ap.nav_source` from the coupled side's PFD nav source. */
  syncNavSource(): void {
    const v = this.vars;
    const src = v.get(FUSION_VARS.navSource(this.coupledSide));
    v.set('ap.nav_source', src === NavSrc.Nav1 ? this.opts.sensors.nav[0] : src === NavSrc.Nav2 ? this.opts.sensors.nav[1] : 0);
  }

  /** Per-step: FMS speed targets, nav source, EDM completion. */
  update(_dt: number): void {
    const v = this.vars;
    this.syncNavSource();
    if (v.get(FUSION_VARS.spdFms) >= 0.5) {
      const mach = v.get(FMS.vnavTargetMach);
      const kt = v.get(FMS.vnavTargetSpeedKt);
      if (mach > 0.3) {
        v.set(AP.selMach, Math.round(mach * 1000) / 1000);
        if (!v.getBool(AP.speedIsMach)) v.set(AP.speedIsMach, 1);
      } else if (kt > 60) {
        v.set(AP.selSpeed, Math.round(kt));
        if (v.getBool(AP.speedIsMach)) v.set(AP.speedIsMach, 0);
      }
    }
    if (this.edmArmedAlt && v.get(FUSION_VARS.edm) >= 0.5) {
      const vert = v.getString(AP.verticalActive);
      // EDM ends at the level-off at the target altitude or when the AP disconnects.
      if (vert === 'ALT' || !v.getBool(AP.engaged)) {
        v.set(FUSION_VARS.edm, 0);
        this.edmArmedAlt = false;
      }
    }
  }
}

function norm360(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}
