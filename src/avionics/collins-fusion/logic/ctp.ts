/**
 * Control Tuning Panel (CTP-6000) logic, one per pilot on the glareshield.
 *
 * Sources:
 *  - FAA FSB report BD-700-1A10 Rev 7 appendix 6: "Comm radios controlled at
 *    two (2) Control Tuning Panels (CTP) on glareshield"; "Nav radios
 *    controlled at two (2) CTP"; "CTP is the primary panel for PFD
 *    selection"; "PFDs Nav Source, Course and bearing pointers controlled
 *    primary via CTP with backup functionality provided"; "Standby HSI on
 *    CTP"; SVS / EVS / HUD "Controlled at CTP".
 *  - AOPA "First look at the Global 6000" (2012): radio tuning uses "a
 *    Control Tuning Panel mounted up high on the glareshield".
 *  - Global Express "Automatic Flight" manual: PFD control panel functions
 *    MINIMUMS (RAD / BARO), BARO SET (IN / HPA, PUSH STD), NAV SRC (V/L,
 *    FMS), BRG pointers, HSI format (inherited by the CTP).
 *
 * The CTP display page layouts, the key set and the tuning steps are EST
 * (no public CTP-6000 drawing): six line select keys beside the display
 * (1-3 left, 4-6 right), a concentric TUNE knob (outer MHz, inner kHz, push
 * transfers the standby), BARO and MINS knobs with push functions.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { ADC, AP, NAV } from '../../../core/vars';
import { BrgSrc, FUSION_EVENTS, FUSION_VARS, NavSrc } from '../vars';
import type { FusionSensors } from '../config';

export const CtpPage = { Radio: 0, Pfd: 1, Hsi: 2 } as const;
export type CtpPage = (typeof CtpPage)[keyof typeof CtpPage];

/** CTP function keys. */
export const CTP_KEYS = ['COM', 'NAV', 'ADF', 'ATC', 'PFD', 'HSI', 'IDENT', 'NAVSRC', 'BRG1', 'BRG2', 'DME'] as const;
export type CtpKey = (typeof CTP_KEYS)[number];

/** Radio line of the RADIO page (line select key 1..6 -> line). */
export type RadioLine = 'COM' | 'NAV' | 'ADF' | 'ATC' | 'COM3' | 'DME';
export const RADIO_LINES: readonly RadioLine[] = ['COM', 'NAV', 'ADF', 'ATC', 'COM3', 'DME'];

/** Transponder modes (core `xpdr.mode`): 1 STBY, 3 ALT, 4 TA ONLY, 5 TA/RA. */
export const XPDR_MODES = [1, 3, 4, 5] as const;
export const XPDR_MODE_NAMES: Readonly<Record<number, string>> = { 0: 'OFF', 1: 'STBY', 2: 'ON', 3: 'ALT', 4: 'TA ONLY', 5: 'TA/RA' };

/** VHF COM band (ICAO Annex 10 Vol V: 117.975-137 MHz; channels from 118.000 MHz). */
export const COM_MIN = 118.0;
export const COM_MAX = 136.975;
/** VHF NAV band 108.00-117.95 MHz, 50 kHz channels. */
export const NAV_MIN = 108.0;
export const NAV_MAX = 117.95;
/** ADF 190-1799 kHz (EST: Collins NAV-4000 ADF range). */
export const ADF_MIN = 190;
export const ADF_MAX = 1799;

export const comVars = (r: number) => ({ act: NAV.comActive(r), stby: NAV.comStandby(r) });

/** Steps a COM frequency: outer = 1 MHz, inner = 25 kHz (EST channel step), wrapping within the band. */
export function stepCom(f: number, clicks: number, inner: boolean): number {
  const mhz = Math.floor(f + 1e-6);
  let khz = Math.round((f - mhz) * 1000);
  if (inner) {
    khz = (((khz + clicks * 25) % 1000) + 1000) % 1000;
    return Math.round((mhz + khz / 1000) * 1000) / 1000;
  }
  let m = mhz + clicks;
  while (m > 136) m -= 19; // 118..136 MHz = 19 values
  while (m < 118) m += 19;
  return Math.round((m + khz / 1000) * 1000) / 1000;
}

/** Steps a NAV frequency: outer = 1 MHz (108-117), inner = 50 kHz. */
export function stepNav(f: number, clicks: number, inner: boolean): number {
  const mhz = Math.floor(f + 1e-6);
  let khz = Math.round((f - mhz) * 1000);
  if (inner) {
    khz = (((khz + clicks * 50) % 1000) + 1000) % 1000;
    return Math.round((mhz + khz / 1000) * 100) / 100;
  }
  let m = mhz + clicks;
  while (m > 117) m -= 10;
  while (m < 108) m += 10;
  return Math.round((m + khz / 1000) * 100) / 100;
}

/** Steps an ADF frequency: outer = 100 kHz, inner = 1 kHz (EST). */
export function stepAdf(f: number, clicks: number, inner: boolean): number {
  const n = f + clicks * (inner ? 1 : 100);
  return Math.min(ADF_MAX, Math.max(ADF_MIN, Math.round(n)));
}

/** Steps a squawk code: outer = the two high octal digits, inner = the two low digits. */
export function stepSquawk(code: number, clicks: number, inner: boolean): number {
  const s = Math.max(0, Math.min(7777, Math.round(code))).toString().padStart(4, '0');
  const hi = parseInt(s.slice(0, 2), 8);
  const lo = parseInt(s.slice(2), 8);
  const h2 = inner ? hi : (((hi + clicks) % 64) + 64) % 64;
  const l2 = inner ? (((lo + clicks) % 64) + 64) % 64 : lo;
  return Number(h2.toString(8).padStart(2, '0') + l2.toString(8).padStart(2, '0'));
}

export interface CtpOptions {
  sensors: FusionSensors;
  powered?: (side: 1 | 2) => boolean;
}

export class CtpLogic {
  private readonly offs: (() => void)[] = [];
  private readonly powered: (side: 1 | 2) => boolean;

  constructor(
    private readonly vars: SimVars,
    events: EventBus,
    private readonly opts: CtpOptions,
  ) {
    this.powered = opts.powered ?? (() => true);
    const v = vars;
    for (const s of [1, 2] as const) {
      this.offs.push(
        events.on(FUSION_EVENTS.ctpLsk(s), (p) => this.lsk(s, Number(p ?? 0))),
        events.on(FUSION_EVENTS.ctpKey(s), (p) => this.key(s, String(p ?? '') as CtpKey)),
        events.on(FUSION_EVENTS.ctp(s, 'tune_out_inc'), (p) => this.tune(s, Math.max(1, Number(p ?? 1) || 1), false)),
        events.on(FUSION_EVENTS.ctp(s, 'tune_out_dec'), (p) => this.tune(s, -Math.max(1, Number(p ?? 1) || 1), false)),
        events.on(FUSION_EVENTS.ctp(s, 'tune_in_inc'), (p) => this.tune(s, Math.max(1, Number(p ?? 1) || 1), true)),
        events.on(FUSION_EVENTS.ctp(s, 'tune_in_dec'), (p) => this.tune(s, -Math.max(1, Number(p ?? 1) || 1), true)),
        events.on(FUSION_EVENTS.ctp(s, 'tune_push'), () => this.transfer(s)),
        events.on(FUSION_EVENTS.ctp(s, 'baro_inc'), (p) => this.baro(s, Math.max(1, Number(p ?? 1) || 1))),
        events.on(FUSION_EVENTS.ctp(s, 'baro_dec'), (p) => this.baro(s, -Math.max(1, Number(p ?? 1) || 1))),
        events.on(FUSION_EVENTS.ctp(s, 'baro_push'), () => this.baroStd(s)),
        events.on(FUSION_EVENTS.ctp(s, 'mins_inc'), (p) => this.mins(s, Math.max(1, Number(p ?? 1) || 1))),
        events.on(FUSION_EVENTS.ctp(s, 'mins_dec'), (p) => this.mins(s, -Math.max(1, Number(p ?? 1) || 1))),
        events.on(FUSION_EVENTS.ctp(s, 'mins_push'), () => this.minsType(s)),
      );
      const init = (name: string, val: number) => {
        if (!v.has(name)) v.set(name, val);
      };
      init(FUSION_VARS.ctpPage(s), CtpPage.Radio);
      init(FUSION_VARS.ctpSel(s), 0);
      init(FUSION_VARS.navSource(s), NavSrc.Fms);
      init(FUSION_VARS.brg(s, 1), BrgSrc.Off);
      init(FUSION_VARS.brg(s, 2), BrgSrc.Off);
      init(FUSION_VARS.svs(s), 1);
      init(FUSION_VARS.hsiRose(s), 0);
      init(FUSION_VARS.baroHpa(s), 0);
      init(AP.minimums(s), 200);
      init(AP.minimumsIsRadio(s), 1);
      const nav = opts.sensors.nav[s - 1];
      init(NAV.activeFreq(nav), s === 1 ? 110.1 : 113.1);
      init(NAV.standbyFreq(nav), s === 1 ? 108.5 : 115.1);
      init(NAV.obs(nav), 360);
      const adf = opts.sensors.adf[s - 1];
      init(NAV.adfActive(adf), 350);
      init(NAV.adfStandby(adf), 400);
    }
    for (let r = 1; r <= opts.sensors.comCount; r++) {
      if (!v.has(NAV.comActive(r))) v.set(NAV.comActive(r), r === 1 ? 121.5 : r === 2 ? 122.8 : 131.55);
      if (!v.has(NAV.comStandby(r))) v.set(NAV.comStandby(r), r === 1 ? 118.1 : r === 2 ? 121.9 : 136.975);
    }
    if (!v.has(NAV.xpdrCode)) v.set(NAV.xpdrCode, 2000);
    if (!v.has(NAV.xpdrMode)) v.set(NAV.xpdrMode, 1);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  page(s: 1 | 2): CtpPage {
    return this.vars.get(FUSION_VARS.ctpPage(s)) as CtpPage;
  }

  selectedLine(s: 1 | 2): RadioLine {
    return RADIO_LINES[Math.max(0, Math.min(5, this.vars.get(FUSION_VARS.ctpSel(s))))];
  }

  /** COM receiver shown on side s's COM line (on-side COM 1 / 2). */
  comFor(s: 1 | 2): number {
    return s;
  }

  // ------------------------------------------------------------ keys

  key(s: 1 | 2, k: CtpKey): void {
    if (!this.powered(s)) return;
    const v = this.vars;
    const sel = (line: RadioLine): void => {
      v.set(FUSION_VARS.ctpPage(s), CtpPage.Radio);
      v.set(FUSION_VARS.ctpSel(s), RADIO_LINES.indexOf(line));
    };
    switch (k) {
      case 'COM':
        sel('COM');
        return;
      case 'NAV':
        sel('NAV');
        return;
      case 'ADF':
        sel('ADF');
        return;
      case 'ATC':
        sel('ATC');
        return;
      case 'DME':
        this.dmeHold(s);
        return;
      case 'PFD':
        v.set(FUSION_VARS.ctpPage(s), this.page(s) === CtpPage.Pfd ? CtpPage.Radio : CtpPage.Pfd);
        return;
      case 'HSI':
        v.set(FUSION_VARS.ctpPage(s), this.page(s) === CtpPage.Hsi ? CtpPage.Radio : CtpPage.Hsi);
        return;
      case 'IDENT':
        v.set(NAV.xpdrIdent, 1);
        return;
      case 'NAVSRC':
        this.cycleNavSource(s);
        return;
      case 'BRG1':
        this.cycleBearing(s, 1);
        return;
      case 'BRG2':
        this.cycleBearing(s, 2);
        return;
    }
  }

  /** NAV SRC: FMS -> on-side VOR/LOC -> cross-side VOR/LOC -> FMS. */
  cycleNavSource(s: 1 | 2): void {
    const v = this.vars;
    const cur = v.get(FUSION_VARS.navSource(s));
    const on = s === 1 ? NavSrc.Nav1 : NavSrc.Nav2;
    const x = s === 1 ? NavSrc.Nav2 : NavSrc.Nav1;
    const next = cur === NavSrc.Fms ? on : cur === on ? x : NavSrc.Fms;
    v.set(FUSION_VARS.navSource(s), next);
    // Course pointer follows the receiver's OBS.
    if (next !== NavSrc.Fms) {
      const rx = this.opts.sensors.nav[next - 1];
      v.set(AP.selCourse(s), v.get(NAV.obs(rx), 360));
    }
  }

  cycleBearing(s: 1 | 2, n: 1 | 2): void {
    const v = this.vars;
    const cur = v.get(FUSION_VARS.brg(s, n));
    v.set(FUSION_VARS.brg(s, n), (cur + 1) % 4);
  }

  private dmeHold(s: 1 | 2): void {
    const rx = this.opts.sensors.nav[s - 1];
    this.vars.set(NAV.dmeHold(rx), this.vars.getBool(NAV.dmeHold(rx)) ? 0 : 1);
  }

  /**
   * Line select keys. RADIO page: selects the line for tuning, a second press
   * on the selected radio line transfers standby -> active (ATC: cycles the
   * mode; DME: DME HOLD). PFD page: L1 NAV SRC, L2 BRG 1, L3 BRG 2, R1 SVS,
   * R2 HSI ARC / ROSE, R3 BARO IN / HPA.
   */
  lsk(s: 1 | 2, n: number): void {
    if (!this.powered(s) || n < 1 || n > 6) return;
    const v = this.vars;
    const p = this.page(s);
    if (p === CtpPage.Pfd) {
      switch (n) {
        case 1:
          this.cycleNavSource(s);
          return;
        case 2:
          this.cycleBearing(s, 1);
          return;
        case 3:
          this.cycleBearing(s, 2);
          return;
        case 4:
          v.set(FUSION_VARS.svs(s), v.getBool(FUSION_VARS.svs(s)) ? 0 : 1);
          return;
        case 5:
          v.set(FUSION_VARS.hsiRose(s), v.getBool(FUSION_VARS.hsiRose(s)) ? 0 : 1);
          return;
        case 6:
          v.set(FUSION_VARS.baroHpa(s), v.getBool(FUSION_VARS.baroHpa(s)) ? 0 : 1);
          return;
      }
      return;
    }
    if (p === CtpPage.Hsi) {
      v.set(FUSION_VARS.ctpPage(s), CtpPage.Radio);
      return;
    }
    const line = RADIO_LINES[n - 1];
    const cur = this.selectedLine(s);
    if (line === 'DME') {
      this.dmeHold(s);
      return;
    }
    if (cur === line) {
      if (line === 'ATC') this.cycleXpdrMode();
      else this.transfer(s);
      return;
    }
    v.set(FUSION_VARS.ctpSel(s), n - 1);
  }

  cycleXpdrMode(): void {
    const v = this.vars;
    const m = v.get(NAV.xpdrMode);
    const i = XPDR_MODES.indexOf(m as (typeof XPDR_MODES)[number]);
    v.set(NAV.xpdrMode, XPDR_MODES[(i + 1) % XPDR_MODES.length]);
  }

  // ------------------------------------------------------------ knobs

  tune(s: 1 | 2, clicks: number, inner: boolean): void {
    if (!this.powered(s)) return;
    const v = this.vars;
    if (this.page(s) !== CtpPage.Radio) v.set(FUSION_VARS.ctpPage(s), CtpPage.Radio);
    const line = this.selectedLine(s);
    const nav = this.opts.sensors.nav[s - 1];
    const adf = this.opts.sensors.adf[s - 1];
    switch (line) {
      case 'COM': {
        const c = comVars(this.comFor(s));
        v.set(c.stby, stepCom(v.get(c.stby, COM_MIN), clicks, inner));
        return;
      }
      case 'COM3': {
        const c = comVars(3);
        v.set(c.stby, stepCom(v.get(c.stby, COM_MIN), clicks, inner));
        return;
      }
      case 'NAV':
        v.set(NAV.standbyFreq(nav), stepNav(v.get(NAV.standbyFreq(nav), NAV_MIN), clicks, inner));
        return;
      case 'ADF':
        v.set(NAV.adfStandby(adf), stepAdf(v.get(NAV.adfStandby(adf), ADF_MIN), clicks, inner));
        return;
      case 'ATC':
        v.set(NAV.xpdrCode, stepSquawk(v.get(NAV.xpdrCode), clicks, inner));
        return;
      case 'DME':
        return;
    }
  }

  /** TUNE push / second LSK press: standby <-> active of the selected radio. */
  transfer(s: 1 | 2): void {
    if (!this.powered(s)) return;
    const v = this.vars;
    const line = this.selectedLine(s);
    const swap = (a: string, b: string) => {
      const x = v.get(a);
      v.set(a, v.get(b));
      v.set(b, x);
    };
    const nav = this.opts.sensors.nav[s - 1];
    const adf = this.opts.sensors.adf[s - 1];
    if (line === 'COM') swap(comVars(this.comFor(s)).act, comVars(this.comFor(s)).stby);
    else if (line === 'COM3') swap(comVars(3).act, comVars(3).stby);
    else if (line === 'NAV') swap(NAV.activeFreq(nav), NAV.standbyFreq(nav));
    else if (line === 'ADF') swap(NAV.adfActive(adf), NAV.adfStandby(adf));
    else if (line === 'ATC') this.cycleXpdrMode();
  }

  /** BARO knob: 0.01 inHg or 1 hPa per click; while STD, sets the preselect. */
  baro(s: 1 | 2, clicks: number): void {
    if (!this.powered(s)) return;
    const v = this.vars;
    const adc = this.opts.sensors.adc[s - 1];
    const hpa = v.getBool(FUSION_VARS.baroHpa(s));
    const std = v.getBool(ADC.baroStd(adc));
    const cur = std ? v.get(FUSION_VARS.baroPreset(s)) || v.get(ADC.baroSetting(adc), 29.92) : v.get(ADC.baroSetting(adc), 29.92);
    let next: number;
    if (hpa) {
      const h = Math.round(cur * 33.8639) + clicks;
      next = h / 33.8639;
    } else next = Math.round((cur + clicks * 0.01) * 100) / 100;
    // Kollsman range 28.10-31.00 inHg (946-1050 hPa), as the analog altimeter model.
    next = Math.min(31.0, Math.max(28.1, next));
    if (std) v.set(FUSION_VARS.baroPreset(s), next);
    else v.set(ADC.baroSetting(adc), next);
  }

  /** BARO push: STD on / off (off restores the preselect, if any). */
  baroStd(s: 1 | 2): void {
    if (!this.powered(s)) return;
    const v = this.vars;
    const adc = this.opts.sensors.adc[s - 1];
    if (v.getBool(ADC.baroStd(adc))) {
      v.set(ADC.baroStd(adc), 0);
      const pre = v.get(FUSION_VARS.baroPreset(s));
      if (pre > 0) v.set(ADC.baroSetting(adc), pre);
      v.set(FUSION_VARS.baroPreset(s), 0);
    } else {
      v.set(ADC.baroStd(adc), 1);
      v.set(FUSION_VARS.baroPreset(s), 0);
    }
  }

  /** MINS knob: 10 ft per click (RA 0-2500 ft, BARO 0-15,000 ft; EST ranges). */
  mins(s: 1 | 2, clicks: number): void {
    if (!this.powered(s)) return;
    const v = this.vars;
    const ra = v.getBool(AP.minimumsIsRadio(s));
    const max = ra ? 2500 : 15000;
    v.set(AP.minimums(s), Math.min(max, Math.max(0, Math.round(v.get(AP.minimums(s)) / 10) * 10 + clicks * 10)));
  }

  /** MINS push: RA <-> BARO. */
  minsType(s: 1 | 2): void {
    if (!this.powered(s)) return;
    const v = this.vars;
    v.set(AP.minimumsIsRadio(s), v.getBool(AP.minimumsIsRadio(s)) ? 0 : 1);
    if (v.getBool(AP.minimumsIsRadio(s)) && v.get(AP.minimums(s)) > 2500) v.set(AP.minimums(s), 200);
  }
}
