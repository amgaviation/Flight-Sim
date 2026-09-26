/**
 * EFIS control panels (Captain and F/O; FCOM 10.10 "EFIS Control Panel").
 *
 *   MINS   outer ring RADIO/BARO (var), inner knob sets the minimums (events),
 *          push = RST (resets the minimums alert on the PFD).
 *          Turning below 0 ft (RADIO) / -1,000 ft (BARO) blanks the display.
 *   FPV / MTRS push buttons toggle the flight path vector / metric altitude.
 *   BARO   outer ring IN/HPA, inner knob sets the altimeter setting, push =
 *          STD. While STD is shown the knob changes the preselect (white,
 *          under STD); the next push sets the preselected value.
 *   Mode   APP / VOR / MAP / PLN (var), push = CTR (centred / expanded).
 *   Range  5 .. 640 nm (var, detents), push = TFC (traffic display).
 *   VOR/ADF 1 and 2 switches (vars), map buttons WXR STA WPT ARPT DATA POS
 *          TERR (events toggle state vars; WXR and TERR are exclusive).
 *
 * Outputs: the state vars in B737_VARS.efis*, the minimums for the TAWS
 * minimums monitor (`ap.mins{s}_ft`, `ap.mins{s}_is_ra`) and the barometric
 * setting of the side's air data computer (`adc{n}.baro_inhg`,
 * `adc{n}.baro_std`). The DISPLAYS CONTROL PANEL switch (BOTH ON 1/2) makes
 * one panel drive both sides (CdsLogic resolves `efisSourceFor`).
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { ADC, AP } from '../../../core/vars';
import { listen, payloadNumber } from '../../../systems/autopilot/lib';
import { B737_EVENTS, B737_VARS, EFIS_MAP_BUTTONS, ND_RANGES_NM, NdMode, type EfisMapButton, type Side } from '../vars';

/** Radio minimums: 0-999 ft (EST limit of the selector), 10 ft per click (EST). */
const RADIO_MAX_FT = 999;
const BARO_MIN_FT = -1000;
const BARO_MAX_FT = 16000;
const MINS_STEP_FT = 10;
/** Baro limits (inHg): 22.00-32.00 (EST, typical Boeing altimeter setting range 745-1100 hPa). */
const BARO_MIN_INHG = 22;
const BARO_MAX_INHG = 32.48;
const HPA_PER_INHG = 33.8639;

export class EfisPanels {
  readonly name = 'b737_efis';
  private readonly vars: SimVars;
  private readonly offs: (() => void)[] = [];
  private readonly adcIndex: [number, number];
  /** Minimums RST requests consumed by the PFDs (count per side). */
  readonly minsReset: [number, number] = [0, 0];

  constructor(env: { vars: SimVars; events?: EventBus }, adcIndex: [number, number]) {
    this.vars = env.vars;
    this.adcIndex = adcIndex;
    const v = env.vars;
    for (const s of [1, 2] as Side[]) {
      const init = (n: string, x: number): void => {
        if (!v.has(n)) v.set(n, x);
      };
      init(B737_VARS.efisMinsRef(s), 0);
      init(B737_VARS.efisMinsRadioFt(s), -1);
      init(B737_VARS.efisMinsBaroFt(s), -1);
      init(B737_VARS.efisBaroHpa(s), 0);
      init(B737_VARS.efisBaroPresel(s), 29.92);
      init(B737_VARS.efisFpv(s), 0);
      init(B737_VARS.efisMtrs(s), 0);
      init(B737_VARS.efisMode(s), NdMode.Map);
      init(B737_VARS.efisCtr(s), 0);
      init(B737_VARS.efisRange(s), 2);
      init(B737_VARS.efisTfc(s), 0);
      init(B737_VARS.efisVorAdf(s, 1), 0);
      init(B737_VARS.efisVorAdf(s, 2), 0);
      for (const b of EFIS_MAP_BUTTONS) init(B737_VARS.efisMapButton(s, b), 0);
      const e = env.events;
      listen(e, this.offs, B737_EVENTS.efisMinsInc(s), (p) => this.mins(s, payloadNumber(p, 1)));
      listen(e, this.offs, B737_EVENTS.efisMinsDec(s), (p) => this.mins(s, -payloadNumber(p, 1)));
      listen(e, this.offs, B737_EVENTS.efisMinsRst(s), () => this.minsRst(s));
      listen(e, this.offs, B737_EVENTS.efisBaroInc(s), (p) => this.baro(s, payloadNumber(p, 1)));
      listen(e, this.offs, B737_EVENTS.efisBaroDec(s), (p) => this.baro(s, -payloadNumber(p, 1)));
      listen(e, this.offs, B737_EVENTS.efisBaroStd(s), () => this.std(s));
      listen(e, this.offs, B737_EVENTS.efisCtr(s), () => this.toggle(B737_VARS.efisCtr(s)));
      listen(e, this.offs, B737_EVENTS.efisTfc(s), () => this.toggle(B737_VARS.efisTfc(s)));
      listen(e, this.offs, B737_EVENTS.efisFpv(s), () => this.toggle(B737_VARS.efisFpv(s)));
      listen(e, this.offs, B737_EVENTS.efisMtrs(s), () => this.toggle(B737_VARS.efisMtrs(s)));
      for (const b of EFIS_MAP_BUTTONS) listen(e, this.offs, B737_EVENTS.efisMapButton(s, b), () => this.mapButton(s, b));
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  private toggle(name: string): void {
    this.vars.set(name, this.vars.get(name) !== 0 ? 0 : 1);
  }

  /** Map option button: toggles; WXR and TERR exclude each other (FCOM: selecting one deselects the other). */
  mapButton(s: Side, b: EfisMapButton): void {
    const v = this.vars;
    const on = v.get(B737_VARS.efisMapButton(s, b)) === 0;
    v.set(B737_VARS.efisMapButton(s, b), on ? 1 : 0);
    if (on && b === 'wxr') v.set(B737_VARS.efisMapButton(s, 'terr'), 0);
    if (on && b === 'terr') v.set(B737_VARS.efisMapButton(s, 'wxr'), 0);
  }

  /** MINS knob: `clicks` > 0 clockwise (increase). */
  mins(s: Side, clicks: number): void {
    const v = this.vars;
    const radio = v.get(B737_VARS.efisMinsRef(s)) === 0;
    const name = radio ? B737_VARS.efisMinsRadioFt(s) : B737_VARS.efisMinsBaroFt(s);
    let ft = v.get(name, -1);
    const lo = radio ? 0 : BARO_MIN_FT;
    const hi = radio ? RADIO_MAX_FT : BARO_MAX_FT;
    // Not set: the first click shows a starting value (EST 200 ft RA / field elevation + 200 is unknown here: 200 ft).
    if (ft < lo) {
      if (clicks <= 0) return;
      ft = radio ? 200 : 200;
    } else {
      ft += clicks * MINS_STEP_FT;
      if (ft < lo) ft = -9999; // turned below the bottom: minimums blank
      else if (ft > hi) ft = hi;
    }
    v.set(name, ft < lo ? -1 : Math.round(ft));
  }

  minsRst(s: Side): void {
    this.minsReset[s - 1]++;
  }

  /** Air data computer whose baro setting this side's knob sets. */
  adcFor(s: Side): number {
    return this.adcIndex[s - 1];
  }

  /** BARO knob: 0.01 inHg or 1 hPa per click (in the selected unit). */
  baro(s: Side, clicks: number): void {
    const v = this.vars;
    const n = this.adcFor(s);
    const hpa = v.get(B737_VARS.efisBaroHpa(s)) !== 0;
    const std = v.get(ADC.baroStd(n)) !== 0;
    const name = std ? B737_VARS.efisBaroPresel(s) : ADC.baroSetting(n);
    let inhg = v.get(name, 29.92);
    if (hpa) {
      const h = Math.round(inhg * HPA_PER_INHG) + clicks;
      inhg = h / HPA_PER_INHG;
    } else {
      inhg = Math.round(inhg * 100 + clicks) / 100;
    }
    v.set(name, Math.min(BARO_MAX_INHG, Math.max(BARO_MIN_INHG, inhg)));
  }

  /** STD push: STD <-> the (preselected) altimeter setting. */
  std(s: Side): void {
    const v = this.vars;
    const n = this.adcFor(s);
    const std = v.get(ADC.baroStd(n)) !== 0;
    if (std) {
      v.set(ADC.baroSetting(n), v.get(B737_VARS.efisBaroPresel(s), 29.92));
      v.set(ADC.baroStd(n), 0);
    } else {
      v.set(B737_VARS.efisBaroPresel(s), v.get(ADC.baroSetting(n), 29.92));
      v.set(ADC.baroStd(n), 1);
    }
  }

  /** Publishes the minimums for the TAWS minimums monitor and the resolved ND range. */
  update(_dt: number): void {
    const v = this.vars;
    for (const s of [1, 2] as Side[]) {
      const radio = v.get(B737_VARS.efisMinsRef(s)) === 0;
      const ft = v.get(radio ? B737_VARS.efisMinsRadioFt(s) : B737_VARS.efisMinsBaroFt(s), -1);
      const set = radio ? ft >= 0 : ft >= BARO_MIN_FT;
      v.set(AP.minimums(s), set ? ft : radio ? -1 : -9999);
      v.set(AP.minimumsIsRadio(s), radio ? 1 : 0);
      const idx = Math.max(0, Math.min(ND_RANGES_NM.length - 1, Math.round(v.get(B737_VARS.efisRange(s)))));
      v.set(B737_VARS.ndRangeNm(s), ND_RANGES_NM[idx]);
    }
  }
}

export { HPA_PER_INHG };
