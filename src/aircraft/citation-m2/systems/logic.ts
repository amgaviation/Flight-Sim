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
import { M2, TEST_SEL } from '../vars';

const DISPLAY_IDS = ['pfd1', 'mfd', 'pfd2', 'gtc1', 'gtc2'] as const;
const DISPLAY_BRT = DISPLAY_IDS.map((d) => `display.${d}.brt`);
/** GDU poor-cooling state (systems/avionicsHealth.ts): the GDU reduces power usage (dims). */
const DISPLAY_HOT = DISPLAY_IDS.map((d) => `ac.m2.gdu_hot_${d}`);
/** ESI-1000 internal battery endurance (s). EST: typical 1 h standby battery. */
export const ESI_BATTERY_S = 3600;

export class M2Logic implements Subsystem {
  readonly name = 'm2.logic';
  private readonly hornSilEdge = new EdgeDetector();
  private readonly emerCommEdge = new EdgeDetector();
  private readonly tawsTestEdge = new EdgeDetector();
  private readonly hydHold = new OffDelay(2); // EST: selector valve holds pressure 2 s after the actuators stop (locks)
  private esiBattS = ESI_BATTERY_S;
  private tempManTarget = 22;
  private savedCom1 = 0;

  constructor(private readonly ctx: Pick<SimContext, 'vars' | 'events'>) {}

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

    // ---- TAWS self test from the SYSTEM TEST knob.
    if (this.tawsTestEdge.rising(v.get(M2.testSel) === TEST_SEL.taws)) this.ctx.events.emit('taws.test');

    // ---- Manual cabin temperature (MANUAL mode: spring-loaded COLD / HOT moves the mixing valve, EST 0.5 degC/s).
    if (v.get(M2.tempMode) === 1) this.tempManTarget = Math.max(5, Math.min(35, this.tempManTarget + v.get(M2.tempManual) * 0.5 * dt));
    v.set('ac.m2.temp_man_target', this.tempManTarget);

    // ---- ESI-1000: main bus with its own backup battery (S&D21 §10.3.19).
    const esiMain = v.get('elec.esi_powered') !== 0;
    const esiWasOn = v.get(M2.esiPowered) !== 0;
    if (esiMain) this.esiBattS = Math.min(ESI_BATTERY_S, this.esiBattS + dt * 0.5);
    else if (esiWasOn) this.esiBattS = Math.max(0, this.esiBattS - dt);
    v.set(M2.esiPowered, esiMain || (esiWasOn && this.esiBattS > 0) ? 1 : 0);
    v.set('ac.m2.esi_on_batt', !esiMain && esiWasOn && this.esiBattS > 0 ? 1 : 0);
  }

  reset(): void {
    const v = this.ctx.vars;
    this.esiBattS = ESI_BATTERY_S;
    this.hydHold.reset(false);
    this.hornSilEdge.reset(v.get(M2.gearHornSilence) !== 0);
    this.emerCommEdge.reset(v.get(M2.emerComm) !== 0);
    this.tawsTestEdge.reset(v.get(M2.testSel) === TEST_SEL.taws);
    this.tempManTarget = 22;
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
    // Display brightness: DIM knob 0 = automatic (photocell on ambient light), else manual.
    const knob = v.get(M2.displayDim);
    const auto = 0.35 + 0.65 * Math.max(0, Math.min(1, v.get(ENV.ambientLight, 1)));
    const brt = knob > 0.02 ? Math.max(0.1, knob) : auto;
    for (let k = 0; k < DISPLAY_BRT.length; k++) v.set(DISPLAY_BRT[k], v.get(DISPLAY_HOT[k]) !== 0 ? brt * 0.6 : brt); // EST 60 % when hot
    // Minor tilt-panel indications.
    v.set('ac.m2.cvr_test_lt', v.get(M2.cvrTest) !== 0 && annun ? 1 : 0);
    v.set('ac.m2.elt_active', v.get(M2.eltSw) === 1 ? 1 : 0);
    v.set(M2.gearHornActive, v.get('gear.horn'));
    // Event marker (FDR/AReS event, S&D15 tilt panel): lamp while pressed. SCOPE: no recorder data is kept.
    v.set('ac.m2.event_marker_lt', v.get(M2.eventMarker) !== 0 && annun ? 1 : 0);
    // Windshield rain removal (S&D15 §9.7: W/S bleed air normally, mechanical rain doors in heavy rain).
    // SCOPE: output 0..1 for the windshield rain rendering; no aerodynamic effect of the doors.
    for (const i of [1, 2]) v.set(`ac.m2.ws_rain_removal${i}`, Math.min(1, v.get(M2.wsBleedSw(i)) * 0.4 + v.get(M2.rainDoor(i)) * 0.6));
  }
}
