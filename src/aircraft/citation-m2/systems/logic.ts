/**
 * Citation M2 glue logic: the relay/valve/annunciator logic that connects the
 * cockpit controls to the systems-library blocks and that has no generic
 * block of its own. Runs first in the systems list (after the failure
 * manager) and again as `M2LogicLate` at the end for indicator outputs.
 * Allocation-free per update.
 */
import type { SimContext } from '../../../core/SimContext';
import type { Subsystem } from '../../types';
import { ENV, FDM, ICE, NAV } from '../../../core/vars';
import { EdgeDetector, OffDelay } from '../../../systems/util';
import type { FailureDef } from '../../../systems/failures';
import { G3K, vn } from '../../../avionics/garmin-g3000/vars';
import { M2, M2_EVENTS, TEST_SEL } from '../vars';
import { GEN_AMPS_LIMIT, GEN_AMPS_SCHEDULE } from './eis';

const DISPLAY_IDS = ['pfd1', 'mfd', 'pfd2', 'gtc1', 'gtc2'] as const;
/** GDUs on the DISPLAYS dimmer; the GTCs (indices 3, 4) follow TOUCH CONTROLS. */
const GTC_FIRST = 3;
const DISPLAY_BRT = DISPLAY_IDS.map((d) => `display.${d}.brt`);
/** GDU poor-cooling state (systems/avionicsHealth.ts): the GDU reduces power usage (dims). */
const DISPLAY_HOT = DISPLAY_IDS.map((d) => `ac.m2.gdu_hot_${d}`);
/** ESI-1000 internal battery endurance (s). EST: typical 1 h standby battery. */
export const ESI_BATTERY_S = 3600;
/** GTC SYSTEM TESTS selection returns to OFF after this time (s). EST: G3000 tests are timed, not held. */
export const TEST_AUTO_OFF_S = 10;
/** Cabin altitude valve drive per GTC CABIN UP / DN press (s). EST. */
export const PRESS_MAN_PULSE_S = 1;

/** Wing anti-ice valve shut-off below this N2 (525AFM-06 p.3-99: "automatically shut off when the respective engine N2 falls below 75%"). */
export const WAI_MIN_N2 = 75;
/**
 * Anti-ice surface warm-up / cool-down model (EST, sized to the M2 flows ground check "displayed & clear within 60
 * sec" and the AFM "WING ANTI-ICE ... illuminates about 1 min after N2 drops below 75%"): warmth 0..1 rises at
 * `riseS` to full with heat flowing, falls at `fallS` to zero without; COLD below 0.8.
 */
export const AI_WARM = { wing: { riseS: 45, fallS: 300 }, eng: { riseS: 25, fallS: 150 } } as const;
/** Tail boot sequence (525AFM-06 p.3-100): AUTO inflates L then R, then repeats after 3 min; inflation time EST 6 s. */
export const BOOT_SEQ = { inflateS: 6, dwellS: 180, pressDelayS: 1.5 } as const;
/** W/S bleed air temperature model (EST): overheat trip and time constant. */
export const WS_TEMP = { oheatC: 93, tauS: 60, riseLowC: 60, riseHiC: 110 } as const;
/** W/S alcohol reservoir endurance (s): "sufficient alcohol is provided for ten minutes of operation" (525AFM-06 p.3-101). */
export const WS_ALCOHOL_S = 600;
/** Emergency pressurization latch (525AFM-06 p.3-23): on at 14,500 ft cabin, off ~1,000 ft lower. */
export const EMER_PRESS = { onFt: 14500, offFt: 13500 } as const;
/** Anti-skid power-up self-test (EST ~3 s; 525AFM-06 p.3-90: completed while stationary). */
export const ANTISKID_TEST_S = 3;
/** Emergency brake nitrogen bottle (EST): full charge and pressure used per full application. */
export const EMER_BRAKE_BOTTLE = { fullPsi: 1800, psiPerApplication: 120 } as const;
/** FADEC landing ignition hold after weight on wheels (s) (CAE differences p.5-45). */
export const LDG_IGN_HOLD_S = 8;
/** Pulse Light period (s), EST ~1 Hz alternating (S&D21 §9.4.1). */
export const PULSE_PERIOD_S = 1;
/**
 * Throttle high-thrust switch position (lever units). EST: the throttle-quadrant switch that retracts the speed brakes
 * and cuts the 38-degree flap extension "above approximately 85% N2" (525AFM-06 p.3-89.1 / p.3-104.1) is taken just
 * above the CRU detent (0.62), so the speed brakes work with the throttles at CRU or below in flight.
 */
export const THROTTLE_HIGH_TLA = 0.7;
/** Flap lever value of the 38-degree switch (35 + 3/25 of the 35 -> 60 span). */
const FLAP_LEVER_38 = 2 + 3 / 25;

export class M2Logic implements Subsystem {
  readonly name = 'm2.logic';
  private readonly hornSilEdge = new EdgeDetector();
  private readonly emerCommEdge = new EdgeDetector();
  private readonly tawsTestEdge = new EdgeDetector();
  private readonly hydHold = new OffDelay(2); // EST: selector valve holds pressure 2 s after the actuators stop (locks)
  private esiBattS = ESI_BATTERY_S;
  private tempManTarget = 22;
  private savedCom1 = 0;
  private testS = 0;
  private pressManS = 0;
  private pressManDir = 0;
  private readonly boostLatch = [false, false];
  private readonly boostSwPrev = [0, 0];
  private readonly eaiWarm = [1, 1];
  private readonly waiWarm = [1, 1];
  private bootT = 0;
  private readonly wsTemp = [NaN, NaN];
  private readonly wsOheat = [false, false];
  private wsAlcohol = 1;
  private emerPressAuto = false;
  private readonly antiskidEdge = new EdgeDetector();
  private antiskidTestS = 0;
  private antiskidFail = false;
  private emerBrakeBottle: number = EMER_BRAKE_BOTTLE.fullPsi;
  private emerBrakePrev = 0;
  private ldgIgnS = 0;
  private wasAir = false;
  private airS = 0;
  private pulseT = 0;
  private emerCommActive = false;
  private readonly offs: (() => void)[] = [];
  private readonly autoRev = [false, false]; // [adc, ahrs] of PFD 1 switched to side 2 automatically

  constructor(private readonly ctx: Pick<SimContext, 'vars' | 'events'>) {
    // GTC ENVIRONMENTAL page manual cabin altitude buttons: each press drives the outflow valve for PRESS_MAN_PULSE_S.
    this.offs.push(ctx.events.on(M2_EVENTS.pressManUp, () => this.pressPulse(1)));
    this.offs.push(ctx.events.on(M2_EVENTS.pressManDn, () => this.pressPulse(-1)));
  }

  private pressPulse(dir: number): void {
    this.pressManDir = dir;
    this.pressManS = PRESS_MAN_PULSE_S;
  }

  update(dt: number): void {
    const v = this.ctx.vars;
    const lock = v.get(M2.controlLock) !== 0;
    // Takeoff field elevation for the pressurization controller (landing elevation fallback).
    if (v.get('gear.air_ground') !== 0) v.set(M2.takeoffFieldElevFt, v.get(FDM.altMsl));

    // ---- FADEC lever inputs: CUTOFF below idle is a fuel-off gate, not thrust; control lock holds the throttles at idle.
    for (const i of [1, 2]) {
      const tla = v.get(M2.tla(i));
      v.set(M2.fadecTla(i), lock ? 0 : Math.max(0, Math.min(1, tla)));
    }

    // ---- Control lock (SCOPE: modelled as jammed primary controls).
    for (const axis of ['pitch', 'roll', 'yaw']) v.set(`fail.fcs.${axis}.jam`, lock ? 1 : 0);

    // ---- Speed brakes: EXTEND (handle, or ground flaps on the ground) unless either throttle is in a high-thrust
    //      position (~85 % N2): "Advance the throttles to above 85% N2; verify speed brakes retract ... retard ...
    //      speed brakes redeploy" (525AFM-06 p.3-89.1; S&D15 §9.1).
    // Throttle high-thrust switch (EST position: above the CRU detent, ~85 % N2 on the ground).
    const highThrust = v.get(M2.fadecTla(1)) >= THROTTLE_HIGH_TLA || v.get(M2.fadecTla(2)) >= THROTTLE_HIGH_TLA;
    v.set('ac.m2.thr_high', highThrust ? 1 : 0);
    const onGround = v.get('gear.air_ground') !== 0;
    const handle = v.get(M2.flapHandle);
    const gndFlaps = handle >= 2.9 && onGround;
    const sbCmd = (v.get(M2.speedbrake) >= 0.5 || gndFlaps) && !highThrust ? 1 : 0;
    v.set(M2.sbCommand, sbCmd);

    // ---- Flap handle -> flap command. Between LAND and GROUND FLAPS the handle is in the gate (35). 38-degree
    //      switch (525AFM-06 p.3-104.1): extension past 38 deg only with the handle full aft and both throttles
    //      below ~85 % N2 (flaps already beyond 38 are held, not retracted).
    let lever = handle <= 2 ? handle : handle >= 2.9 ? 3 : 2;
    if (lever > FLAP_LEVER_38 && highThrust && v.get('surf.flaps_deg') <= 38.5) lever = FLAP_LEVER_38;
    v.set('ac.m2.flap_lever_cmd', lever);

    // ---- Split pitch trim switches: both halves the same way; the pilot's switch overrides the copilot's
    //      (525AFM-06 p.3-89.1). AP/TRIM DISC held interrupts all electric trim (TrimAxis enable, systems/flight.ts).
    let trimCmd = 0;
    for (const sd of [1, 2]) {
      const dir = v.get(M2.yokeTrim(sd));
      const arm = v.get(M2.yokeTrimArm(sd));
      const c = dir !== 0 && Math.sign(dir) === Math.sign(arm) ? Math.sign(dir) : 0;
      if (trimCmd === 0 && c !== 0) trimCmd = c;
    }
    v.set(M2.yokeTrimCmd, trimCmd);

    // ---- Electrical: DISPATCH LED (dispatch relay closed with the aux battery available).
    v.set(M2.dispatchLight, v.get(M2.dispatchSw) === 1 && v.get('elec.aux_batt_v') > 18 ? 1 : 0);

    // ---- PFD 1 sensor reversion: on emergency power ADC 1 / AHRS 1 are unpowered and PFD 1 uses ADC 2 / AHRS 2
    //      (M2 flows EMER BUS ITEMS "PFD 1 in reversion mode (AHRS 2, ADC 2 ...)"). Restored when side 1 returns.
    this.sensorReversion(v, 0, 'elec.adc1_powered', 'elec.adc2_powered', vn(G3K.adcSel, 1));
    this.sensorReversion(v, 1, 'elec.ahrs1_powered', 'elec.ahrs2_powered', vn(G3K.ahrsSel, 1));

    // ---- Fuel boost NORM low-pressure activation latch (525AFM-06 p.3-115: reset by OFF or ON and back to NORM).
    for (let k = 0; k < 2; k++) {
      const i = k + 1;
      const sw = v.get(M2.boostSw(i));
      if (sw !== 0) this.boostLatch[k] = false;
      else if (v.get(k === 0 ? 'fuel.ejector_l_lowpress' : 'fuel.ejector_r_lowpress') !== 0) this.boostLatch[k] = true;
      this.boostSwPrev[k] = sw;
      v.set(M2.boostLatch(i), this.boostLatch[k] ? 1 : 0);
    }

    // ---- Ice protection: per-side WING/ENG switches (OFF / ENG ON / WING/ENG). Wing valve closes below 75 % N2.
    let anyWing = 0;
    for (let k = 0; k < 2; k++) {
      const i = k + 1;
      const sw = v.get(M2.engAiSw(i));
      const valve = sw >= 2 && v.get(`eng${i}.n2_pct`) >= WAI_MIN_N2 && !v.get(M2.engFireBtn(i)) ? 1 : 0;
      if (sw >= 2) anyWing = 1;
      v.set(M2.wingAiValve(i), valve);
      const waiHeat = valve === 1 && v.get(`pneu.wai${i}_ok`) > 0.8;
      this.waiWarm[k] = warm(this.waiWarm[k], waiHeat, AI_WARM.wing, dt);
      const eaiHeat = sw >= 1 && v.get(`pneu.eai${i}_ok`) > 0.8;
      this.eaiWarm[k] = warm(this.eaiWarm[k], eaiHeat, AI_WARM.eng, dt);
      v.set(`ac.m2.wai${i}_warm`, this.waiWarm[k]);
      v.set(`ac.m2.eai${i}_warm`, this.eaiWarm[k]);
    }
    v.set(M2.wingAiSw, anyWing);

    // ---- Tail de-ice boots (525AFM-06 p.3-100): AUTO inflates L, then R, then waits 3 min; MANUAL (momentary)
    //      inflates both while held. Needs 23 psi service air and power (R MAIN).
    const tailSw = v.get(M2.tailDeiceSw);
    const bootsAvail = v.get('elec.tail_deice_powered') !== 0;
    let b1 = false;
    let b2 = false;
    if (tailSw === 1 && bootsAvail) {
      this.bootT += dt;
      const cyc = 2 * BOOT_SEQ.inflateS + BOOT_SEQ.dwellS;
      if (this.bootT >= cyc) this.bootT -= cyc;
      b1 = this.bootT < BOOT_SEQ.inflateS;
      b2 = this.bootT >= BOOT_SEQ.inflateS && this.bootT < 2 * BOOT_SEQ.inflateS;
    } else {
      this.bootT = 0;
      if (tailSw === -1 && bootsAvail) b1 = b2 = true;
    }
    const svcAir = v.get('pneu.bleed_psi') > 20;
    v.set('ac.m2.boot1_cmd', b1 ? 1 : 0);
    v.set('ac.m2.boot2_cmd', b2 ? 1 : 0);
    v.set('ac.m2.boot1_press', b1 && svcAir ? 1 : 0);
    v.set('ac.m2.boot2_press', b2 && svcAir ? 1 : 0);

    // ---- Windshield bleed: temperature controller, overheat shut-off valve (525AFM-06 p.3-101; EST model). The
    //      O'HEAT latch resets with the switch OFF.
    const tat = v.get('fdm.tat_c', 15);
    const ias = v.get('fdm.ias_kt');
    for (let k = 0; k < 2; k++) {
      const i = k + 1;
      const sw = v.get(M2.wsBleedSw(i));
      if (sw <= 0) this.wsOheat[k] = false;
      const open = sw > 0 && !this.wsOheat[k];
      const flowOk = v.get(k === 0 ? 'pneu.ws_l_ok' : 'pneu.ws_r_ok');
      const rise = open ? (sw >= 2 ? WS_TEMP.riseHiC : WS_TEMP.riseLowC) * flowOk : 0;
      const target = tat + rise / (1 + Math.max(0, ias) / 150);
      if (Number.isNaN(this.wsTemp[k])) this.wsTemp[k] = target;
      this.wsTemp[k] += (target - this.wsTemp[k]) * (1 - Math.exp(-dt / WS_TEMP.tauS));
      if (open && this.wsTemp[k] >= WS_TEMP.oheatC) this.wsOheat[k] = true;
      v.set(`ac.m2.ws_valve${i}`, open ? 1 : 0);
      v.set(`ac.m2.ws_temp${i}_c`, this.wsTemp[k]);
    }
    v.set('ac.m2.ws_oheat', this.wsOheat[0] || this.wsOheat[1] ? 1 : 0);
    // W/S alcohol reservoir (10 min).
    if (v.get(M2.wsAlcoholSw) !== 0 && v.get('elec.ws_alcohol_powered') !== 0) this.wsAlcohol = Math.max(0, this.wsAlcohol - dt / WS_ALCOHOL_S);
    v.set(M2.wsAlcoholRemaining, this.wsAlcohol);

    // ---- Automatic emergency pressurization (525AFM-06 p.3-23): on at 14,500 ft cabin, off ~1,000 ft lower; DC power.
    const cab = v.get('press.cabin_alt_ft');
    if (cab >= EMER_PRESS.onFt) this.emerPressAuto = true;
    else if (cab < EMER_PRESS.offFt) this.emerPressAuto = false;
    v.set('ac.m2.emer_press_auto', this.emerPressAuto && v.get('elec.emer_powered') !== 0 ? 1 : 0);

    // ---- Anti-skid power-up self-test (EST 3 s; ANTISKID INOP lit during it); fails if the aircraft moves.
    const asOn = v.get(M2.antiskidSw) !== 0 && v.get('elec.antiskid_powered') !== 0;
    const asEdge = this.antiskidEdge.update(asOn);
    if (asEdge > 0) {
      this.antiskidTestS = ANTISKID_TEST_S;
      this.antiskidFail = false;
    } else if (asEdge < 0) {
      this.antiskidTestS = 0;
      this.antiskidFail = false;
    }
    if (this.antiskidTestS > 0) {
      if (onGround && v.get('fdm.gs_kt') > 5) {
        this.antiskidFail = true;
        this.antiskidTestS = 0;
      } else this.antiskidTestS = Math.max(0, this.antiskidTestS - dt);
    }
    v.set('ac.m2.antiskid_test', this.antiskidTestS > 0 ? 1 : 0);
    v.set('ac.m2.antiskid_fail', this.antiskidFail ? 1 : 0);

    // ---- Emergency brake bottle: pressure used by each application (handle travel), EST.
    const eb = Math.max(0, Math.min(1, v.get(M2.emerBrake)));
    if (eb > this.emerBrakePrev) this.emerBrakeBottle = Math.max(0, this.emerBrakeBottle - (eb - this.emerBrakePrev) * EMER_BRAKE_BOTTLE.psiPerApplication);
    this.emerBrakePrev = eb;
    v.set(M2.emerBrakeBottlePsi, this.emerBrakeBottle);

    // ---- FADEC landing ignition: held 8 s after touchdown.
    if (!onGround) {
      this.ldgIgnS = 0;
      this.airS += dt;
    } else {
      if (this.wasAir && this.airS > 2) this.ldgIgnS = LDG_IGN_HOLD_S; // touchdown after a flight (not a preset frame)
      else this.ldgIgnS = Math.max(0, this.ldgIgnS - dt);
      this.airS = 0;
    }
    this.wasAir = !onGround;
    v.set('ac.m2.ldg_ign_hold', this.ldgIgnS > 0 ? 1 : 0);

    // ---- Pulse Light phase (landing lights alternate in PULSE).
    this.pulseT = (this.pulseT + dt / PULSE_PERIOD_S) % 1;
    v.set('ac.m2.pulse_phase', this.pulseT);

    // ---- Open-centre hydraulic selector valve: pressure only while an actuator is commanded.
    const handleDn = v.get(M2.gearHandle) >= 0.5;
    const gearDemand = (handleDn && v.get('gear.down_locked') === 0) || (!handleDn && v.get('gear.up_locked') === 0 && !onGround);
    const flapDemand = Math.abs(v.get('flaps.cmd_deg') - v.get('surf.flaps_deg')) > 0.3;
    const sbDemand = Math.abs(sbCmd - v.get('surf.speedbrake')) > 0.02;
    const demand = this.hydHold.update(gearDemand || flapDemand || sbDemand, dt);
    v.set(M2.hydDemand, demand ? 1 : 0);
    v.set(M2.hydPressOn, v.get('hyd.main_psi') > 1000 && !(gearDemand || flapDemand || sbDemand) ? 1 : 0);

    // ---- Gear horn silence button.
    if (this.hornSilEdge.rising(v.get(M2.gearHornSilence) !== 0)) this.ctx.events.emit('gear.horn_silence');

    // ---- EMER COMM: tunes COM1 to 121.5 MHz "bypassing all other tuning controls" (S&D15 §10.3.G): held at
    //      121.5 every update while selected (GTC retuning has no effect); the saved frequency returns at NORM.
    const ec = this.emerCommEdge.update(v.get(M2.emerComm) !== 0);
    if (ec > 0) {
      this.savedCom1 = v.get(NAV.comActive(1));
      this.emerCommActive = true;
    } else if (ec < 0) {
      this.emerCommActive = false;
      if (this.savedCom1 > 0) v.set(NAV.comActive(1), this.savedCom1);
    }
    if (this.emerCommActive) v.set(NAV.comActive(1), 121.5);

    // ---- GTC SYSTEM TESTS: TAWS self test; the selection returns to OFF after TEST_AUTO_OFF_S (EST).
    const testSel = v.get(M2.testSel);
    if (this.tawsTestEdge.rising(testSel === TEST_SEL.taws)) this.ctx.events.emit('taws.test');
    if (testSel !== TEST_SEL.off) {
      this.testS += dt;
      if (this.testS >= TEST_AUTO_OFF_S) {
        v.set(M2.testSel, TEST_SEL.off);
        this.testS = 0;
      }
    } else this.testS = 0;

    // ---- Manual cabin altitude (GTC CABIN UP / DN buttons, MAN mode): timed valve drive pulses.
    if (this.pressManS > 0) {
      this.pressManS -= dt;
      v.set(M2.pressManual, this.pressManS > 0 ? this.pressManDir : 0);
    }

    // ---- Push-to-talk (armrest switches): transmit on the side's selected mic COM (G3000 COM field shows TX).
    //      SCOPE: no radio transmission / ATC model; the keyed state is published for the displays and audio.
    for (const s of [1, 2]) v.set(vn(G3K.comTx, s), v.get(M2.ptt(s)) !== 0 && v.get(s === 1 ? 'elec.audio1_powered' : 'elec.audio2_powered') !== 0 ? 1 : 0);

    // ---- DISPLAY REV PILOT: reverts PFD1 (PFD + EIS); with PFD1 failed the MFD takes the pilot's PFD instead.
    //      SCOPE / EST: the M2 has no MFD reversion switch (two NORM / REV rotaries, photos); the MFD reversion
    //      is selected through the pilot's switch when PFD1 is not available.
    v.set(G3K.reversionSwitch('mfd'), v.get(G3K.reversionSwitch('pfd1')) >= 0.5 && v.get(vn(G3K.unitPowered, 'pfd1')) < 0.5 ? 1 : 0);

    // ---- Manual cabin temperature (MANUAL mode: spring-loaded COLD / HOT moves the mixing valve, EST 0.5 degC/s).
    if (v.get(M2.tempMode) === 1) this.tempManTarget = Math.max(5, Math.min(35, this.tempManTarget + v.get(M2.tempManual) * 0.5 * dt));
    v.set('ac.m2.temp_man_target', this.tempManTarget);

    // ---- ESI-1000: main bus with its own backup battery (S&D21 §10.3.19), through the STBY FLT DISPLAY switch
    //      (M2 flows: TEST / ON before flight, OFF at shutdown). ON: bus power, battery when the bus fails; TEST:
    //      runs from the battery and lights the STBY BATT test light; OFF: the instrument and its battery are off.
    const sw = v.get(M2.stbyDispSw);
    const bus = v.get('elec.esi_powered') !== 0;
    const test = sw >= 1.5;
    const esiMain = sw >= 0.5 && bus && !test;
    const onBatt = sw >= 0.5 && (!bus || test) && this.esiBattS > 0;
    if (onBatt) this.esiBattS = Math.max(0, this.esiBattS - dt);
    else if (bus && sw >= 0.5) this.esiBattS = Math.min(ESI_BATTERY_S, this.esiBattS + dt * 0.5);
    v.set(M2.esiPowered, esiMain || onBatt ? 1 : 0);
    v.set('ac.m2.esi_on_batt', onBatt ? 1 : 0);
    v.set(M2.stbyBattLight, onBatt ? 1 : 0);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  /** Automatic PFD 1 sensor reversion to side 2 while side 1 is unpowered (index 0 ADC, 1 AHRS). */
  private sensorReversion(v: SimContext['vars'], k: number, p1: string, p2: string, sel: string): void {
    const s1 = v.get(p1) !== 0;
    const s2 = v.get(p2) !== 0;
    if (!s1 && s2 && v.get(sel, 1) === 1) {
      v.set(sel, 2);
      this.autoRev[k] = true;
    } else if (s1 && this.autoRev[k]) {
      v.set(sel, 1);
      this.autoRev[k] = false;
    }
  }

  /** Failures owned by the M2 glue: fuel filter clogging (FUEL FLTR BYPASS, 525AFM-06 p.3-113). */
  failures(): FailureDef[] {
    return [
      { id: 'fuel.filter_l', name: 'L fuel filter clogged', category: 'fuel', description: 'Differential pressure ~10 psi: filter bypass, FUEL FLTR BYPASS L.' },
      { id: 'fuel.filter_r', name: 'R fuel filter clogged', category: 'fuel', description: 'Differential pressure ~10 psi: filter bypass, FUEL FLTR BYPASS R.' },
    ];
  }

  /** State presets: anti-ice surfaces at their equilibrium, reservoirs full, self-tests done. */
  snapState(inAir: boolean): void {
    const v = this.ctx.vars;
    this.wasAir = inAir;
    this.airS = inAir ? 60 : 0;
    this.ldgIgnS = 0;
    for (let k = 0; k < 2; k++) {
      this.waiWarm[k] = v.get(M2.engAiSw(k + 1)) >= 2 ? 1 : 0;
      this.eaiWarm[k] = v.get(M2.engAiSw(k + 1)) >= 1 ? 1 : 0;
    }
    this.antiskidEdge.reset(v.get(M2.antiskidSw) !== 0 && v.get('elec.antiskid_powered') !== 0);
    this.antiskidTestS = 0;
    this.antiskidFail = false;
  }

  reset(): void {
    const v = this.ctx.vars;
    this.esiBattS = ESI_BATTERY_S;
    this.boostLatch.fill(false);
    this.eaiWarm.fill(0);
    this.waiWarm.fill(0);
    this.bootT = 0;
    this.wsTemp.fill(NaN);
    this.wsOheat.fill(false);
    this.wsAlcohol = 1;
    this.emerPressAuto = false;
    this.antiskidEdge.reset(v.get(M2.antiskidSw) !== 0 && v.get('elec.antiskid_powered') !== 0);
    this.antiskidTestS = 0;
    this.antiskidFail = false;
    this.emerBrakeBottle = EMER_BRAKE_BOTTLE.fullPsi;
    this.emerBrakePrev = 0;
    this.ldgIgnS = 0;
    this.wasAir = v.get('gear.air_ground') === 0;
    this.emerCommActive = v.get(M2.emerComm) !== 0;
    this.autoRev.fill(false);
    this.hydHold.reset(false);
    this.hornSilEdge.reset(v.get(M2.gearHornSilence) !== 0);
    this.emerCommEdge.reset(v.get(M2.emerComm) !== 0);
    this.tawsTestEdge.reset(v.get(M2.testSel) === TEST_SEL.taws);
    this.tempManTarget = 22;
    this.testS = 0;
    this.pressManS = 0;
  }
}

/** Indicator outputs computed after every system has updated. */
export class M2LogicLate implements Subsystem {
  readonly name = 'm2.logic_late';
  constructor(private readonly ctx: Pick<SimContext, 'vars'>) {}

  update(): void {
    const v = this.ctx.vars;
    const test = v.get(M2.testSel);
    const annun = v.get('elec.emer_powered') !== 0;
    const fireTest = test === TEST_SEL.fire || test === TEST_SEL.annu;
    const anyArmed = v.get(M2.engFireBtn(1)) !== 0 || v.get(M2.engFireBtn(2)) !== 0;
    for (const i of [1, 2]) {
      v.set(M2.engFireLight(i), annun && (v.get(`fire.eng${i}_warn`) !== 0 || fireTest) ? 1 : 0);
      v.set(M2.bottleLight(i), annun && ((anyArmed && v.get(`fire.b${i}_discharged`) === 0) || test === TEST_SEL.annu) ? 1 : 0);
      const st = v.get(`fadec.eng${i}.start_state`);
      v.set(M2.startLight(i), annun && ((st > 0 && st < 4) || test === TEST_SEL.annu) ? 1 : 0);
    }
    // Airframe ice for the FDM: wing ice, plus tail ice at reduced weight (the FDM has one airframe ice value).
    v.set(ICE.airframe, Math.max(v.get(M2.iceWing), 0.7 * v.get(M2.iceTail)));
    // Display brightness (glareshield DIMMING group): DISPLAYS for the GDUs, TOUCH CONTROLS for the GTCs; each knob
    // at 0 = automatic from the glareshield photocell (ambient light), else manual.
    const auto = 0.35 + 0.65 * Math.max(0, Math.min(1, v.get(ENV.ambientLight, 1)));
    const gdu = v.get(M2.displayDim);
    const gtc = v.get(M2.gtcDim);
    const brtGdu = gdu > 0.02 ? Math.max(0.1, gdu) : auto;
    const brtGtc = gtc > 0.02 ? Math.max(0.1, gtc) : auto;
    for (let k = 0; k < DISPLAY_BRT.length; k++) {
      const brt = k >= GTC_FIRST ? brtGtc : brtGdu;
      v.set(DISPLAY_BRT[k], v.get(DISPLAY_HOT[k]) !== 0 ? brt * 0.6 : brt); // EST 60 % when hot
    }
    // Tilt-panel green status lights (EST mapping, labels not legible in the photos): valve open with adequate flow.
    v.set('ac.m2.eai1_lt', annun && v.get(M2.engAiSw(1)) >= 1 && v.get('pneu.eai1_ok') > 0.8 ? 1 : 0);
    v.set('ac.m2.eai2_lt', annun && v.get(M2.engAiSw(2)) >= 1 && v.get('pneu.eai2_ok') > 0.8 ? 1 : 0);
    v.set('ac.m2.wai1_lt', annun && v.get(M2.wingAiValve(1)) !== 0 && v.get('pneu.wai1_ok') > 0.8 ? 1 : 0);
    v.set('ac.m2.wai2_lt', annun && v.get(M2.wingAiValve(2)) !== 0 && v.get('pneu.wai2_ok') > 0.8 ? 1 : 0);
    // Tilt-panel WING/ENG green light: engine inlet heat, plus the wing valve when WING/ENG is selected.
    for (const i of [1, 2]) {
      const eng = v.get(`ac.m2.eai${i}_lt`) !== 0;
      v.set(`ac.m2.ai${i}_lt`, eng && (v.get(M2.engAiSw(i)) < 2 || v.get(`ac.m2.wai${i}_lt`) !== 0) ? 1 : 0);
    }
    // Generator load limit marking (CAE p.5-21 CJ1+ schedule, systems/eis.ts).
    const air = v.get('gear.air_ground') === 0;
    GEN_AMPS_LIMIT.cautionHigh = !air ? GEN_AMPS_SCHEDULE.groundA : v.get('fdm.press_alt_ft') >= GEN_AMPS_SCHEDULE.highAltFt ? GEN_AMPS_SCHEDULE.airHighA : GEN_AMPS_SCHEDULE.airA;
    v.set('ac.m2.ps_heat_lt', annun && v.get('elec.pitot_l_powered') !== 0 && v.get('elec.pitot_r_powered') !== 0 ? 1 : 0);
    for (const i of [1, 2]) v.set(`ac.m2.ws_bleed${i}_lt`, annun && v.get(M2.wsBleedSw(i)) > 0 && v.get(`ac.m2.ws_valve${i}`) !== 0 && v.get(`pneu.ws_${i === 1 ? 'l' : 'r'}_ok`) > 0.8 ? 1 : 0);
    v.set('ac.m2.emer_comm_lt', annun && v.get(M2.emerComm) !== 0 ? 1 : 0);
    v.set('ac.m2.elt_lt', annun && v.get(M2.eltSw) === 1 ? 1 : 0);
    // Minor tilt-panel indications.
    v.set('ac.m2.cvr_test_lt', v.get(M2.cvrTest) !== 0 && annun ? 1 : 0);
    v.set('ac.m2.elt_active', v.get(M2.eltSw) === 1 ? 1 : 0);
    v.set(M2.gearHornActive, v.get('gear.horn'));
    // Gear handle knob lamp (red while any leg is in transit / unsafe; gear.red* include the gear lights test).
    v.set('ac.m2.gear_unsafe_lt', v.get('gear.red0') + v.get('gear.red1') + v.get('gear.red2') > 0 ? 1 : 0);
    // Event marker (FDR/AReS event, S&D15 tilt panel): lamp while pressed. SCOPE: no recorder data is kept.
    v.set('ac.m2.event_marker_lt', v.get(M2.eventMarker) !== 0 && annun ? 1 : 0);
    // Windshield rain removal (S&D15 §9.7: W/S bleed air normally, mechanical rain doors in heavy rain).
    // SCOPE: output 0..1 for the windshield rain rendering; no aerodynamic effect of the doors.
    for (const i of [1, 2]) v.set(`ac.m2.ws_rain_removal${i}`, Math.min(1, v.get(M2.wsBleedSw(i)) * 0.4 + v.get(M2.rainDoor(i)) * 0.6));
  }
}

/** Anti-ice surface warmth step (see AI_WARM). */
function warm(w: number, heat: boolean, r: { riseS: number; fallS: number }, dt: number): number {
  return heat ? Math.min(1, w + dt / r.riseS) : Math.max(0, w - dt / r.fallS);
}
