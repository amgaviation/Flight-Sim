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
import { G3K, vn } from '../../../avionics/garmin-g3000/vars';
import { M2, M2_EVENTS, TEST_SEL } from '../vars';

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

  constructor(private readonly ctx: Pick<SimContext, 'vars' | 'events'>) {
    // GTC ENVIRONMENTAL page manual cabin altitude buttons: each press drives the outflow valve for PRESS_MAN_PULSE_S.
    ctx.events.on(M2_EVENTS.pressManUp, () => this.pressPulse(1));
    ctx.events.on(M2_EVENTS.pressManDn, () => this.pressPulse(-1));
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

    // ---- Speed brakes: EXTEND unless either throttle is in a high-thrust position (~85 % N2, S&D15 §9.1 / §7);
    //      ground flaps (60 deg) deploy them automatically on the ground.
    const highThrust = v.get('eng1.n2_pct') > 85 || v.get('eng2.n2_pct') > 85;
    const onGround = v.get('gear.air_ground') !== 0;
    const gndFlaps = v.get(M2.flapHandle) >= 3 && onGround;
    const sbCmd = (v.get(M2.speedbrake) >= 0.5 && !highThrust) || gndFlaps ? 1 : 0;
    v.set(M2.sbCommand, sbCmd);

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

    // ---- EMER COMM: COM1 to 121.5 MHz while selected, restored afterwards (S&D15 §10.3.G).
    const ec = this.emerCommEdge.update(v.get(M2.emerComm) !== 0);
    if (ec > 0) {
      this.savedCom1 = v.get(NAV.comActive(1));
      v.set(NAV.comActive(1), 121.5);
    } else if (ec < 0 && this.savedCom1 > 0) v.set(NAV.comActive(1), this.savedCom1);

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

  reset(): void {
    const v = this.ctx.vars;
    this.esiBattS = ESI_BATTERY_S;
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
    v.set('ac.m2.eai1_lt', annun && v.get(M2.engAiSw(1)) !== 0 && v.get('pneu.eai1_ok') > 0.8 ? 1 : 0);
    v.set('ac.m2.eai2_lt', annun && v.get(M2.engAiSw(2)) !== 0 && v.get('pneu.eai2_ok') > 0.8 ? 1 : 0);
    v.set('ac.m2.wai_lt', annun && v.get(M2.wingAiSw) !== 0 && v.get('pneu.wai_ok') > 0.8 ? 1 : 0);
    v.set('ac.m2.ps_heat_lt', annun && v.get('elec.pitot_l_powered') !== 0 && v.get('elec.pitot_r_powered') !== 0 ? 1 : 0);
    for (const i of [1, 2]) v.set(`ac.m2.ws_bleed${i}_lt`, annun && v.get(M2.wsBleedSw(i)) > 0 && v.get(`pneu.ws_${i === 1 ? 'l' : 'r'}_ok`) > 0.8 ? 1 : 0);
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
