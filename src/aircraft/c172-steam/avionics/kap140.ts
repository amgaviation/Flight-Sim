/**
 * Bendix/King KAP 140 two-axis autopilot with altitude preselect (POH 172SPHUS Supplement 15,
 * Revision 5, Figures 2 and 3; Bendix/King KAP 140 Pilot's Guide 006-18034-0000).
 *
 * The flight-guidance laws are the shared `Afcs` with the `AFCS_KAP140` preset (ROL + VS on
 * engagement, turn-rate roll axis, UP/DN 100 fpm or 20 ft per press, NAV/APR/REV, ALT, altitude
 * arming). This file adds the KAP 140 computer around it:
 *
 *  - Power: AUTO PILOT 5 A breaker on avionics bus 2 (Supplement 15 item 10, POH Fig 7-7A).
 *  - Preflight self test on power application (Supplement 15 Sec 4 A.2): 'PFT' with an
 *    increasing number, then all display segments, the airplane PITCH TRIM annunciator and the
 *    disconnect tone. The red P may then stay lit for about 30 s (pitch axis unavailable).
 *  - Buttons AP / HDG / NAV / APR / REV / ALT (items 3-8), UP / DN (item 9: single press =
 *    100 fpm in VS or 20 ft in ALT; held = 300 fpm per second in VS, or a 500 fpm climb/descent
 *    in ALT with the reference synchronised to the altitude on release), ARM (Fig 3 item 3) and
 *    BARO (item 2: 3 s baro display, held 2 s toggles IN HG / HPA), concentric altitude select
 *    knobs (item 1: 1000 ft / 100 ft; they adjust the baro while it is displayed). Selecting an
 *    altitude with the knobs while engaged arms the capture automatically.
 *  - Annunciations: AP (flashing after a disconnect), mode fields, ARM, ALERT (the KAP altitude
 *    alerter: 1000 ft / 200 ft bands with five short tones), PT arrows (direction of required
 *    trim; flashing when the auto trim has not satisfied the request for 10 s; solid without an
 *    arrowhead = trim fault), red P / R, the right field (selected altitude FT, VS FPM for 3 s
 *    after UP/DN, BARO IN HG / HPA), 5 s flashing HDG after NAV / APR / REV (set the bug as the
 *    course datum), flashing NAV / APR / REV / GS after a reversion caused by a flagged source.
 *  - A/P DISC / TRIM INT on the pilot's wheel (item 12): disengages the AP and interrupts the
 *    manual electric trim and the autotrim while held.
 *  - Manual electric trim, split switch (item 13): trims only when both halves move the same
 *    way; using it with the AP engaged disengages the AP. One half held alone for 5 s shows the
 *    red PT (trim monitor, preflight test step 3c/d).
 *  - Altitude: the KAP 140 alerter/preselect uses the blind encoder's pressure altitude
 *    corrected with the KAP's own baro setting ("Not inputting the proper barometric setting
 *    into the autopilot computer will produce inaccuracies"); dashed until the encoder warms up.
 *  - Heading datum: the vacuum DG heading bug (Supplement 15 item 15); loss of the turn
 *    coordinator makes the autopilot inoperative, loss of the attitude indicator has no effect.
 *  - Voice messages "TRIM IN MOTION" (elevator trim running > 5 s, repeats every 5 s) and
 *    "CHECK PITCH TRIM" (out of trim ~20 s) (Supplement 15 Sec 3 note, serials 172S9129 on /
 *    SB KC140-M1).
 *
 * EST values: PFT step timing (the POH gives no durations), P lamp 30 s ("approximately 30
 * seconds"), encoder warm-up 60 s, trim rates in data. SCOPE: the KAP 140 uses the #1 CDI OBS
 * course (the shared AFCS VOR/LOC law) rather than the DG heading bug as the course datum.
 */
import type { Subsystem } from '../../types';
import type { AudioApi, SimContext } from '../../../core/SimContext';
import type { FailureDef } from '../../../systems/failures';
import { AP, ADC } from '../../../core/vars';
import { clamp } from '../../../core/math';
import { Afcs } from '../../../systems/autopilot/Afcs';
import { AFCS_VARS } from '../../../systems/autopilot/vars';
import { SENSOR_VARS } from '../../../systems/sensors/vars';
import { indicatedAltitudeFt, HPA_PER_INHG } from '../../../avionics/analog/models/altimeter';
import { ANN_SW, C172 } from '../../c172s-common/vars';
import { EV, KAP, ST } from '../vars';
import { Button, onEncoder, onEvent } from './util';

/** Failure ids of the KAP 140 installation. */
export const KAP_FAIL = {
  computer: 'c172s.kap140',
  pitch: 'c172s.kap140.pitch',
  roll: 'c172s.kap140.roll',
  trim: 'c172s.kap140.trim',
} as const;

/** KAP 140 timing (EST unless noted). */
export const KAP_TIMING = {
  pftStepS: 0.8,
  pftSteps: 7,
  displayTestS: 2.0,
  pLampAfterPowerS: 30, // Supplement 15 Sec 4 NOTE: "approximately 30 seconds"
  hdgReminderS: 5, // Supplement 15: "flash HDG for 5 seconds"
  fieldS: 3, // Supplement 15 Fig 3 item 4: VS / baro shown for 3 seconds
  baroUnitsHoldS: 2, // item 2: "pushed and held for 2 seconds"
  upDnHoldS: 0.5,
  vsHoldRateFpmS: 300, // item 9: "300 fpm per second"
  altHoldVsFpm: 500, // item 9: "rate of 500 FPM"
  ptFlashS: 10, // item 16: 10 seconds
  metMonitorS: 5, // preflight test step 3c: 5 seconds
  encoderWarmupS: 60,
  trimInMotionS: 5,
} as const;

/** Selected-altitude range of the alerter (ft). EST from the display's 5 digits and the 172S ceiling. */
const SEL_ALT_RANGE: [number, number] = [0, 32000];

type LatLabel = 'ROL' | 'HDG' | 'NAV' | 'APR' | 'REV' | '';

export class Kap140Logic implements Subsystem {
  readonly name = 'kap140';
  /** Pre-AFCS part (buttons, power, MET) and post-AFCS part (annunciations) of the update. */
  readonly post: Subsystem;
  powered = false;
  /** Seconds since power-up. */
  private powerT = 0;
  private done = false;
  pft = 0;
  pLamp = false;
  rLamp = false;
  /** Right field: 0 ALT (FT), 1 VS (FPM), 2 BARO. */
  field = 0;
  private fieldT = 0;
  baroInHg = 29.92;
  baroHpaUnits = false;
  baroFlash = false;
  hdgFlashT = 0;
  /** Mode label flashing after a reversion ('' = none). */
  flashLat: LatLabel = '';
  flashGs = false;
  pt = 0;
  private ptT = 0;
  private metAloneT = 0;
  private metFault = false;
  private encoderT = 0;
  private prevLat = 'NONE';
  private prevVert = 'NONE';
  private pressedLat = false;
  private trimMotionT = 0;
  private trimMotionCallT = 0;
  private mistrimCalled = false;
  private upDnRepeatT = 0;
  private altHoldSlew = 0;
  private clockT = 0;
  private readonly bUp: Button;
  private readonly bDn: Button;
  private readonly bBaro: Button;
  private readonly bDisc: Button;
  private readonly offs: (() => void)[] = [];
  private readonly v: SimContext['vars'];

  constructor(
    ctx: Pick<SimContext, 'vars' | 'events'>,
    readonly afcs: Afcs,
    private readonly audio: AudioApi | undefined,
    private readonly powerVar: string,
    /** Vars of the KAP rate sensors' validity (turn coordinator gyro powered). */
    private readonly sensorsValidVar: string,
  ) {
    this.v = ctx.vars;
    const v = ctx.vars;
    this.bUp = new Button(v, KAP.up);
    this.bDn = new Button(v, KAP.dn);
    this.bBaro = new Button(v, KAP.baro);
    this.bDisc = new Button(v, ST.apDisc);
    const ev = ctx.events;
    onEvent(ev, EV.kap('ap'), () => this.pressAp(), this.offs);
    onEvent(ev, EV.kap('hdg'), () => this.mode('HDG'), this.offs);
    onEvent(ev, EV.kap('nav'), () => this.mode('NAV'), this.offs);
    onEvent(ev, EV.kap('apr'), () => this.mode('APR'), this.offs);
    onEvent(ev, EV.kap('rev'), () => this.mode('BC'), this.offs);
    onEvent(ev, EV.kap('alt'), () => this.mode('ALT'), this.offs);
    onEvent(ev, EV.kap('arm'), () => this.mode('ARM'), this.offs);
    onEncoder(ev, EV.kapAltOuter, (s) => this.knob(s, true), this.offs);
    onEncoder(ev, EV.kapAltInner, (s) => this.knob(s, false), this.offs);
    this.post = { name: 'kap140-annunciation', update: (dt) => this.updatePost(dt) };
  }

  failures(): FailureDef[] {
    const c = 'autopilot';
    return [
      { id: KAP_FAIL.computer, name: 'KAP 140 computer', category: c, description: 'Autopilot computer failed: P and R lit, autopilot inoperative.' },
      { id: KAP_FAIL.pitch, name: 'KAP 140 pitch axis', category: c, description: 'Red P: pitch axis disabled, cannot be engaged.' },
      { id: KAP_FAIL.roll, name: 'KAP 140 roll axis', category: c, description: 'Red R: roll axis disabled, autopilot cannot be engaged.' },
      { id: KAP_FAIL.trim, name: 'KAP 140 pitch trim', category: c, description: 'Autotrim / manual electric trim fault: PITCH TRIM annunciator, trim inoperative.' },
    ];
  }

  /** True when the computer has passed its self test and both axes are available. */
  get ready(): boolean {
    return this.powered && this.done && !this.rLamp;
  }

  /** Failure flag var names (built once: the update runs at 60 Hz). */
  private readonly fv = {
    computer: `fail.${KAP_FAIL.computer}`,
    pitch: `fail.${KAP_FAIL.pitch}`,
    roll: `fail.${KAP_FAIL.roll}`,
    trim: `fail.${KAP_FAIL.trim}`,
  } as const;
  private failed(name: string): boolean {
    return this.v.get(name) !== 0;
  }

  private pressAp(): void {
    if (!this.powered || !this.done) return;
    this.flashLat = '';
    this.flashGs = false;
    if (this.afcs.engaged) {
      this.afcs.press('AP');
      return;
    }
    if (!this.ready || this.pLamp) return; // "DO NOT ENGAGE INTO A ROLL AXIS ONLY SYSTEM"
    this.afcs.press('AP');
  }

  private mode(m: 'HDG' | 'NAV' | 'APR' | 'BC' | 'ALT' | 'ARM'): void {
    if (!this.ready) return;
    this.pressedLat = true;
    if (m === 'ALT' && this.flashGs) this.flashGs = false;
    if (m !== 'ALT' && m !== 'ARM') this.flashLat = '';
    this.afcs.press(m);
    if (m === 'NAV' || m === 'APR' || m === 'BC') this.hdgFlashT = KAP_TIMING.hdgReminderS;
  }

  private knob(steps: number, outer: boolean): void {
    if (!this.powered || !this.done) return;
    const v = this.v;
    if (this.field === 2 || this.baroFlash) {
      if (this.baroHpaUnits) {
        const hpa = Math.round(this.baroInHg * HPA_PER_INHG) + steps * (outer ? 10 : 1);
        this.baroInHg = clamp(hpa / HPA_PER_INHG, 28.1, 31.0);
      } else this.baroInHg = clamp(Math.round((this.baroInHg + steps * (outer ? 0.1 : 0.01)) * 100) / 100, 28.1, 31.0);
      this.baroFlash = false;
      this.field = 2;
      this.fieldT = KAP_TIMING.fieldS;
      return;
    }
    const sel = clamp(v.get(AP.selAltitude) + steps * (outer ? 1000 : 100), SEL_ALT_RANGE[0], SEL_ALT_RANGE[1]);
    v.set(AP.selAltitude, Math.round(sel / 100) * 100);
    this.field = 0;
    // "ALT hold arming when the autopilot is engaged is automatic upon altitude alerter altitude selection."
    if (this.afcs.engaged && !this.afcs.kapAltitudeArm) this.afcs.press('ARM');
  }

  /** State presets: computer on, self test done, P lamp out, encoder warm. */
  setReady(): void {
    this.powered = this.v.get(this.powerVar) > 0.5;
    this.powerT = this.powered ? 1000 : 0;
    this.done = this.powered;
    this.pft = 0;
    this.pLamp = false;
    this.baroFlash = false;
    this.encoderT = KAP_TIMING.encoderWarmupS;
  }

  update(dt: number): void {
    const v = this.v;
    const on = v.get(this.powerVar) > 0.5 && !this.failed(this.fv.computer);
    if (on && !this.powered) {
      this.powerT = 0;
      this.done = false;
      this.encoderT = 0;
      this.baroFlash = true;
      this.metFault = false;
    }
    if (!on && this.powered && this.afcs.engaged) this.afcs.disengage(true);
    this.powered = on;
    this.bUp.update(dt);
    this.bDn.update(dt);
    this.bBaro.update(dt);
    this.bDisc.update(dt);
    const T = KAP_TIMING;
    if (on) {
      this.powerT += dt;
      this.encoderT += dt;
      const pftEnd = T.pftSteps * T.pftStepS;
      if (this.powerT < pftEnd) this.pft = 1 + Math.floor(this.powerT / T.pftStepS);
      else if (this.powerT < pftEnd + T.displayTestS) this.pft = 99;
      else {
        this.pft = 0;
        this.done = true;
      }
      this.pLamp = this.failed(this.fv.pitch) || (this.done && this.powerT < pftEnd + T.displayTestS + T.pLampAfterPowerS);
      this.rLamp = this.failed(this.fv.roll) || v.get(this.sensorsValidVar) < 0.5;
    } else {
      this.pft = 0;
      this.pLamp = this.rLamp = false;
      this.done = false;
    }
    if (this.afcs.engaged && (this.rLamp || this.pLamp)) this.afcs.disengage(true);

    // ---- A/P DISC / TRIM INT
    if (this.bDisc.pressed) this.afcs.press('DISC');

    // ---- manual electric trim (split switch; needs the AUTO PILOT breaker)
    const lh = Math.round(v.get(ST.metLeft));
    const rh = Math.round(v.get(ST.metRight));
    const trimOk = on && !this.failed(this.fv.trim) && !this.bDisc.down;
    let met = 0;
    if (trimOk && lh !== 0 && lh === rh) met = lh;
    // Trim monitor: one half alone for 5 s -> red PT (preflight test 3c/3d).
    if (on && (lh !== 0) !== (rh !== 0)) this.metAloneT += dt;
    else this.metAloneT = 0;
    this.metFault = this.metAloneT >= T.metMonitorS;
    v.set(KAP.metCmd, met);
    if (met !== 0 && this.afcs.engaged) this.afcs.disengage(false);

    // ---- UP / DN
    if (this.ready) this.upDn(dt);
    // ---- BARO
    if (on && this.done) {
      if (this.bBaro.long(T.baroUnitsHoldS)) {
        this.baroHpaUnits = !this.baroHpaUnits;
        this.field = 2;
        this.fieldT = T.fieldS;
      } else if (this.bBaro.shortRelease(T.baroUnitsHoldS)) {
        this.baroFlash = false; // accept the present value
        this.field = 2;
        this.fieldT = T.fieldS;
      }
    }
    if (this.fieldT > 0) {
      this.fieldT -= dt;
      if (this.fieldT <= 0) this.field = 0;
    }
    // ---- KAP altitude (blind encoder + KAP baro)
    const encOk = on && this.encoderT >= T.encoderWarmupS && v.get(SENSOR_VARS.staticBlocked(1)) < 0.5;
    v.set(KAP.encoderValid, encOk ? 1 : 0);
    v.set('ac.kap140.alt_ft', indicatedAltitudeFt(v.get(SENSOR_VARS.pressAlt(1)), this.baroInHg));
    v.set('ac.kap140.ready', this.ready ? 1 : 0);
    v.set('ac.kap140.servo_ok', this.ready && !this.pLamp ? 1 : 0);
    v.set('ac.kap140.trim_ok', trimOk ? 1 : 0);
  }

  private upDn(dt: number): void {
    const a = this.afcs;
    const T = KAP_TIMING;
    const v = this.v;
    const dir = this.bUp.down ? 1 : this.bDn.down ? -1 : 0;
    const pressed = this.bUp.pressed || this.bDn.pressed;
    const held = Math.max(this.bUp.held, this.bDn.held);
    if (!a.engaged) {
      this.altHoldSlew = 0;
      return;
    }
    if (a.vert === 'VS') {
      if (pressed) {
        a.press(dir > 0 ? 'UP' : 'DN');
        this.upDnRepeatT = 0;
      } else if (dir !== 0 && held > T.upDnHoldS) {
        // Held: 300 fpm per second (three 100 fpm steps per second).
        this.upDnRepeatT += dt;
        while (this.upDnRepeatT >= 100 / T.vsHoldRateFpmS) {
          this.upDnRepeatT -= 100 / T.vsHoldRateFpmS;
          a.press(dir > 0 ? 'UP' : 'DN');
        }
      }
      if (dir !== 0 || this.bUp.released || this.bDn.released) {
        this.field = 1;
        this.fieldT = T.fieldS;
      }
      if (this.altHoldSlew !== 0 && dir === 0) {
        // Release after a held UP/DN in ALT: synchronise the ALT reference to the altitude.
        this.altHoldSlew = 0;
        a.press('ALT');
      }
      return;
    }
    if (a.vert === 'ALT') {
      if (dir !== 0 && held > T.upDnHoldS) {
        // Held in ALT: climb / descend at 500 fpm; ALT re-engages at release.
        a.press('VS');
        v.set(AP.selVs, dir * T.altHoldVsFpm);
        this.altHoldSlew = dir;
      } else if (this.bUp.shortRelease(T.upDnHoldS)) a.press('UP');
      else if (this.bDn.shortRelease(T.upDnHoldS)) a.press('DN');
    }
  }

  private updatePost(dt: number): void {
    const v = this.v;
    const a = this.afcs;
    const T = KAP_TIMING;
    this.clockT += dt;
    // Reversion detection: a NAV-type mode (active or armed) replaced by ROL without a button press.
    const lat = a.lat;
    const navPrev = this.prevLat === 'VOR' || this.prevLat === 'LOC' || this.prevLat === 'BC' || this.prevLat === 'LNAV';
    if (!this.pressedLat && navPrev && lat === 'ROL' && a.engaged) this.flashLat = this.prevLat === 'BC' ? 'REV' : a.approach ? 'APR' : 'NAV';
    if (!this.pressedLat && this.prevVert === 'GS' && a.vert !== 'GS' && a.engaged) this.flashGs = true;
    if (!a.engaged && !this.powered) {
      this.flashLat = '';
      this.flashGs = false;
    }
    this.prevLat = lat;
    this.prevVert = a.vert;
    this.pressedLat = false;
    if (this.hdgFlashT > 0) this.hdgFlashT = Math.max(0, this.hdgFlashT - dt);

    // PT annunciation: direction of the required trim; flashes after 10 s unsatisfied; solid = fault.
    const trimCmd = v.get(AFCS_VARS.trimCmd);
    const trimFault = this.failed(this.fv.trim) || this.metFault;
    if (trimFault) this.pt = 2;
    else if (a.engaged && trimCmd !== 0) this.pt = trimCmd > 0 ? 1 : -1;
    else this.pt = 0;
    this.ptT = this.pt === 1 || this.pt === -1 ? this.ptT + dt : 0;
    v.set(KAP.pt, this.powered && this.done ? this.pt : 0);
    v.set(KAP.ptFlash, this.ptT > T.ptFlashS ? 1 : 0);

    // Airplane annunciator panel PITCH TRIM (red): trim fault / runaway, or the self-test display.
    const warn = v.get('elec.warn_powered') > 0.5;
    const sw = Math.round(v.get(C172.annSwitch, ANN_SW.day));
    const annTest = warn && sw === ANN_SW.test;
    const runaway = v.get('fail.trim.pitch.runaway') !== 0 && v.get('trim.pitch_in_motion') !== 0;
    const ptLamp = (this.powered && (this.pft === 99 || this.failed(this.fv.trim))) || runaway;
    const bright = sw === ANN_SW.night ? 0.35 : 1;
    const flash = Math.floor(this.clockT * 2.5) % 2 === 0;
    v.set(KAP.pitchTrimLamp, warn ? (annTest ? (flash ? bright : 0) : ptLamp ? bright : 0) : 0);

    // Disconnect tone request: AFCS disconnect warning, or the self-test tone during the display test.
    v.set('ac.kap140.tone', v.get(AFCS_VARS.discWarn) !== 0 || (this.powered && this.pft === 99) ? 1 : 0);

    // Voice messages (via the audio panel; OFF/EMG silences them).
    const inMotion = v.get('trim.pitch_in_motion') !== 0 && (a.engaged || v.get(KAP.metCmd) !== 0);
    this.trimMotionT = inMotion ? this.trimMotionT + dt : 0;
    if (this.trimMotionT > T.trimInMotionS) {
      this.trimMotionCallT -= dt;
      if (this.trimMotionCallT <= 0) {
        this.audio?.callout('TRIM IN MOTION', 5);
        this.trimMotionCallT = T.trimInMotionS;
      }
    } else this.trimMotionCallT = 0;
    const mistrim = v.get(AFCS_VARS.mistrim) !== 0 && a.engaged;
    if (mistrim && !this.mistrimCalled) this.audio?.callout('CHECK PITCH TRIM', 6);
    this.mistrimCalled = mistrim;

    // Outputs for the display.
    v.set(KAP.on, this.powered ? 1 : 0);
    v.set(KAP.pft, this.pft);
    v.set(KAP.pLamp, this.powered && (this.pLamp || this.pft === 99) ? 1 : 0);
    v.set(KAP.rLamp, this.powered && (this.rLamp || this.pft === 99) ? 1 : 0);
    v.set(KAP.field, this.field);
    v.set(KAP.baroInHg, this.baroInHg);
    v.set(KAP.baroHpa, this.baroHpaUnits ? 1 : 0);
    v.set(KAP.baroFlash, this.baroFlash && this.done ? 1 : 0);
    v.set(KAP.armSel, a.kapAltitudeArm ? 1 : 0);
    v.set(KAP.armAnn, a.engaged && a.kapAltitudeArm && a.vert === 'VS' ? 1 : 0);
    v.set(KAP.alert, this.powered && this.done && v.get(KAP.encoderValid) > 0.5 ? v.get('alt.alert_light') : 0);
    v.set(KAP.hdgFlash, this.hdgFlashT > 0 ? 1 : 0);
    v.set(KAP.apFlash, v.get(AFCS_VARS.discWarn));
    v.set('ac.kap140.adc_alt', v.get(ADC.baroAlt(1)));
  }

  /** Lateral annunciation label for the display. */
  latLabel(): string {
    const a = this.afcs;
    if (!a.engaged) return '';
    switch (a.lat) {
      case 'ROL':
        return 'ROL';
      case 'HDG':
        return 'HDG';
      case 'BC':
        return 'REV';
      case 'VOR':
      case 'LOC':
      case 'LNAV':
        return a.approach ? 'APR' : 'NAV';
      default:
        return '';
    }
  }
  /** Armed lateral label ('NAV' / 'APR' / 'REV' with the small ARM), or ''. */
  latArmedLabel(): string {
    const a = this.afcs;
    if (!a.engaged) return '';
    switch (a.latArmed) {
      case 'BC':
        return 'REV';
      case 'VOR':
      case 'LOC':
      case 'LNAV':
        return a.approach ? 'APR' : 'NAV';
      default:
        return '';
    }
  }
  vertLabel(): string {
    const a = this.afcs;
    if (!a.engaged) return '';
    return a.vert === 'VS' ? 'VS' : a.vert === 'ALT' || a.vert === 'ALTS' ? 'ALT' : a.vert === 'GS' ? 'GS' : '';
  }
  gsArmed(): boolean {
    return this.afcs.engaged && (this.afcs.vertArmed & 4) !== 0;
  }

  reset(): void {
    this.bUp.reset();
    this.bDn.reset();
    this.bBaro.reset();
    this.bDisc.reset();
    this.prevLat = this.afcs.lat;
    this.prevVert = this.afcs.vert;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
