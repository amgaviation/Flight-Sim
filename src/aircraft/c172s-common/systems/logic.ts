/**
 * Cessna 172S glue logic between the cockpit control vars (vars.ts) and the building blocks:
 *
 * C172Logic (first in the update order):
 *  - MASTER switch split-rocker interlock (POH NAV III Sec 7: "The ALT side of the switch can
 *    not be set to ON without the BAT side of the switch also being set to ON").
 *  - Ignition key: magnetos grounded (OFF) when the key is removed.
 *  - Engine inputs: throttle / mixture knobs -> eng1.throttle / eng1.mixture; ignition switch
 *    -> eng1.mag_left / mag_right (OFF, R, L, BOTH, START); magneto failures; blocked air
 *    filter opens the spring-loaded alternate air door (POH Sec 7 "Air induction system": ~10 %
 *    power loss at full throttle).
 *  - Control wheel lock: ailerons neutral, elevator slightly trailing-edge down (POH Sec 7
 *    "Control locks"); rudder free (the rudder gust lock is an external item).
 *  - ACU: an alternator over-voltage opens the ALT FLD / ALT FIELD breaker (POH Sec 7).
 *  - G1000 standby battery controller: releases the standby battery onto the ESS bus when
 *    ARMed and the main bus (sensed through the WARN breaker) is below 20 V or the MASTER BAT
 *    switch is OFF; TEST lamp logic (POH NAV III Sec 4/7).
 *
 * C172LateLogic (last): annunciator conditions and the steam annunciator-panel lamps, the
 * hour meter, electrical readouts (G1000 EIS M/E BUS VOLTS, M/S BATT AMPS; steam analog
 * instrument supply vars), ELT, cabin heat/air/defrost and CO.
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import type { FailureDef } from '../../../systems/failures';
import { ENG, FDM, INPUT, SURF } from '../../../core/vars';
import { Hysteresis, OnDelay } from '../../../systems/util';
import { SENSOR_VARS } from '../../../systems/sensors/vars';
import { ANN, ANN_SW, C172, C172_FAIL, DOOR, ELT_SW, MAG, STBY_BATT } from '../vars';
import { ELEC_DATA, FUEL_DATA, KG_PER_GAL } from '../data';
import type { C172Variant } from './electrical';

const f = (id: string) => `fail.${id}`;

/** Cabin door in flight (POH Sec 3 NOTE "Inadvertent opening of a cabin door in flight"). */
export const DOOR_DATA = {
  /** POH: the door trails "approximately 3 inches open": ~3 in at the aft edge of a ~36 in door = ~5 deg of the ~55 deg swing (EST). */
  trailPos: 0.09,
  /** EST: above this the slipstream holds an unlatched door in its trail position. */
  trailAboveKias: 40,
  /** EST: POH advises trimming to 75 KIAS before closing; above ~85 KIAS the air load holds it open. */
  maxCloseKias: 85,
} as const;

export class C172Logic implements Subsystem {
  readonly name = 'c172-logic';
  private prevAlt = 0;
  private prevKeyIn = true;
  private prevBat = 0;
  private prevAltTripped = 0;
  private readonly stbyRelease = new Hysteresis(ELEC_DATA.stbyTakeoverV, ELEC_DATA.stbyTakeoverV + 1, true);
  private readonly altFieldCb: string;

  constructor(
    private readonly vars: SimContext['vars'],
    private readonly variant: C172Variant,
  ) {
    this.altFieldCb = variant === 'g1000' ? 'alt_field' : 'alt_fld';
  }

  failures(): FailureDef[] {
    const c = 'engine';
    return [
      { id: C172_FAIL.magLeft, name: 'Left magneto', category: c, description: 'Left magneto dead: engine runs rough on L, drops out of BOTH redundancy.' },
      { id: C172_FAIL.magRight, name: 'Right magneto', category: c, description: 'Right magneto dead.' },
      { id: C172_FAIL.airFilter, name: 'Induction air filter blocked', category: c, description: 'Alternate air door opens: ~10 % power loss at full throttle.' },
      { id: C172_FAIL.altBelt, name: 'Alternator belt broken', category: 'electrical', description: 'No alternator output: LOW VOLTS, battery discharge.' },
      { id: C172_FAIL.mufflerLeak, name: 'Muffler shroud crack', category: 'cabin', description: 'Carbon monoxide in the cabin with CABIN HT on.' },
      { id: C172_FAIL.fuelXmtrL, name: 'Left fuel quantity transmitter', category: 'fuel', description: 'Needle to OFF, L LOW FUEL annunciation.' },
      { id: C172_FAIL.fuelXmtrR, name: 'Right fuel quantity transmitter', category: 'fuel', description: 'Needle to OFF, LOW FUEL R annunciation.' },
      ...(this.variant === 'g1000'
        ? [
            { id: C172_FAIL.coDetSrvc, name: 'CO detector needs service', category: 'cabin', description: 'CO DET SRVC system message (detector still works).' },
            { id: C172_FAIL.coDetFail, name: 'CO detector failure', category: 'cabin', description: 'CO DET FAIL system message; CO LVL HIGH can no longer be annunciated.' },
          ]
        : []),
    ];
  }

  reset(): void {
    this.prevAlt = this.vars.get(C172.masterAlt);
    this.prevBat = this.vars.get(C172.masterBat);
    this.prevAltTripped = this.vars.get('elec.alt_tripped');
    this.prevKeyIn = this.vars.get(C172.keyIn, 1) >= 0.5;
  }

  update(): void {
    const v = this.vars;
    // ---- MASTER split rocker interlock: ALT up pushes BAT up; BAT down pushes ALT down.
    let alt = v.get(C172.masterAlt);
    let bat = v.get(C172.masterBat);
    if (alt > 0.5 && this.prevAlt <= 0.5 && bat < 0.5) {
      bat = 1;
      v.set(C172.masterBat, 1);
    }
    if (bat < 0.5 && this.prevBat >= 0.5 && alt > 0.5) {
      alt = 0;
      v.set(C172.masterAlt, 0);
    }
    this.prevAlt = alt;
    this.prevBat = bat;

    // ---- ignition key and magnetos
    // The key can be withdrawn only in OFF (key-operated OFF/R/L/BOTH/START switch, POH Sec 7 "Ignition-starter
    // system"): a removal attempt in any other position leaves the key in; without the key the switch cannot
    // leave OFF.
    const keyIn = v.get(C172.keyIn, 1) >= 0.5;
    if (!keyIn && v.get(C172.magneto) !== MAG.off) {
      if (this.prevKeyIn) v.set(C172.keyIn, 1);
      else v.set(C172.magneto, MAG.off);
    }
    this.prevKeyIn = v.get(C172.keyIn, 1) >= 0.5;
    const mag = Math.round(v.get(C172.magneto));
    const left = mag === MAG.left || mag === MAG.both || mag === MAG.start;
    const right = mag === MAG.right || mag === MAG.both || mag === MAG.start;
    v.set(ENG.magLeft(1), left && v.get(f(C172_FAIL.magLeft)) === 0 ? 1 : 0);
    v.set(ENG.magRight(1), right && v.get(f(C172_FAIL.magRight)) === 0 ? 1 : 0);
    v.set(ENG.throttle(1), clamp01(v.get(C172.throttle)));
    v.set(ENG.mixture(1), clamp01(v.get(C172.mixture)));
    v.set(ENG.primer(1), 0); // fuel injected: priming with the aux pump (POH Sec 4)
    v.set(ENG.altAir(1), v.get(f(C172_FAIL.airFilter)) !== 0 ? 1 : 0);

    // ---- control wheel lock: surfaces held (elevator slightly TE down = small nose-down command)
    const locked = v.get(C172.controlLock) > 0.5;
    v.set('ac.c172.fcs.pitch_in', locked ? -0.12 : v.get(INPUT.pitch));
    v.set('ac.c172.fcs.roll_in', locked ? 0 : v.get(INPUT.roll));
    v.set('ac.c172.fcs.yaw_in', v.get(INPUT.yaw));

    // ---- ACU over-voltage protection opens the ALT FLD / ALT FIELD breaker
    const tripped = v.get('elec.alt_tripped');
    if (tripped > 0.5 && this.prevAltTripped <= 0.5) {
      v.set(`cb.${this.altFieldCb}`, 0);
      v.set(`cb.${this.altFieldCb}_tripped`, 1);
    }
    this.prevAltTripped = tripped;

    // ---- G1000 standby battery controller
    if (this.variant === 'g1000') {
      const sw = Math.round(v.get(C172.stbyBatt));
      // Main bus voltage sense: from the crossfeed bus through the WARN breaker (POH NAV III Fig 7-7 sheets
      // 2/3 "Main Bus Voltage Sense"); a pulled or tripped WARN breaker reads as a low main bus.
      const sense = v.get('elec.warn_powered') > 0.5 ? v.get('elec.warn_v') : 0;
      const mainLow = this.stbyRelease.update(sense);
      // The sense above is last update's voltage. With the MASTER BAT switch OFF the main buses have no
      // source at all this update (alternator field and external power both need BAT, POH Sec 7), so the
      // controller is released in the same update: MASTER OFF with STBY BATT ARM keeps the ESS bus powered
      // without a dropout (POH 172SPHBUS-00 7-51: "the standby battery will power the essential bus").
      const noMain = v.get(C172.masterBat) < 0.5;
      v.set('ac.c172.stby_release', sw === STBY_BATT.arm && (mainLow || noMain) ? 1 : 0);
      // TEST: the green lamp stays lit while the battery holds its voltage under the test load
      // (EST threshold 23.5 V under ~3 A: fails a battery below ~20 % charge).
      v.set(C172.stbyTestLamp, sw === STBY_BATT.test && v.get('elec.stby_batt_v') >= 23.5 ? 1 : 0);
    }
  }
}

/** Steam annunciator-panel lamp: flashes ~10 s after it comes on, then steady (POH Sec 7). */
class PanelLamp {
  private prev = false;
  private flashT = 0;
  constructor(
    readonly out: string,
    private readonly flashS = 10,
  ) {}
  update(on: boolean, dt: number, test: boolean, t: number): number {
    if (on && !this.prev) this.flashT = this.flashS;
    this.prev = on;
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    const flashPhase = Math.floor(t * 2.5) % 2 === 0; // EST ~1.25 Hz flash
    if (test) return flashPhase ? 1 : 0; // POH: "all amber and red messages will flash until the switch is released"
    if (!on) return 0;
    return this.flashT > 0 ? (flashPhase ? 1 : 0) : 1;
  }
}

export class C172LateLogic implements Subsystem {
  readonly name = 'c172-late-logic';
  private readonly lowFuelL = new OnDelay(FUEL_DATA.lowFuelDelayS);
  private readonly lowFuelR = new OnDelay(FUEL_DATA.lowFuelDelayS);
  private readonly stbyDischarge = new OnDelay(ELEC_DATA.stbyAnnunDelayS);
  private readonly lamps: Record<string, PanelLamp> = {};
  private t = 0;
  private eltLatched = false;
  private co = 0;
  private cabinT = NaN;
  private fog = 0;
  private readonly doorPos = [0, 0];
  private readonly doorWasOpen = [false, false];

  constructor(
    private readonly vars: SimContext['vars'],
    private readonly variant: C172Variant,
  ) {
    for (const id of ['oil_press', 'low_fuel_l', 'low_fuel_r', 'vac_l', 'vac_r', 'volts'] as const) this.lamps[id] = new PanelLamp(ANN.lamp(id));
  }

  reset(): void {
    const v = this.vars;
    this.lowFuelL.reset(v.get('fuel.left_low') > 0.5);
    this.lowFuelR.reset(v.get('fuel.right_low') > 0.5);
    this.stbyDischarge.reset(false);
    this.eltLatched = false;
    this.co = 0;
    this.cabinT = NaN;
    this.fog = 0;
    for (const side of [0, 1]) {
      const st = Math.round(v.get(side === 0 ? C172.doorLeft : C172.doorRight, DOOR.closed));
      this.doorWasOpen[side] = st === DOOR.open;
      this.doorPos[side] = st === DOOR.open ? (v.get(FDM.ias) > DOOR_DATA.trailAboveKias ? DOOR_DATA.trailPos : 1) : 0;
    }
  }

  update(dt: number): void {
    const v = this.vars;
    const g = this.variant === 'g1000';
    this.t += dt;

    // ---------------------------------------------------------------- engine / fuel conditions
    const oilPsi = v.get(ENG.oilPressPsi(1));
    const oilLow = oilPsi < 20; // POH Sec 7: low oil pressure switch closes below 20 psi
    v.set(C172.oilPressSwitch, oilLow ? 1 : 0);
    const xL = v.get(f(C172_FAIL.fuelXmtrL)) !== 0;
    const xR = v.get(f(C172_FAIL.fuelXmtrR)) !== 0;
    // POH Sec 7 "Fuel indicating": LOW FUEL when the tank stays below ~5 gal for > 60 s, or the transmitter fails.
    const lowL = this.lowFuelL.update(v.get('fuel.left_low') > 0.5, dt) || xL;
    const lowR = this.lowFuelR.update(v.get('fuel.right_low') > 0.5, dt) || xR;
    // Failed transmitter: needle below 0 ("OFF"): publish the indicated quantity as -1 gal.
    if (xL) v.set('fuel.left_ind_kg', -KG_PER_GAL);
    if (xR) v.set('fuel.right_ind_kg', -KG_PER_GAL);

    // ---------------------------------------------------------------- electrical readouts
    // G1000 (UND): main bus voltage measured at the WARN breaker on the X-FEED bus, essential bus
    // voltage at the NAV1 ENG breaker on the ESS bus. Steam: the Davtron voltmeter reads bus 1.
    const mBus = g ? (v.get('elec.warn_powered') > 0.5 ? v.get('elec.warn_v') : 0) : v.get('elec.bus1_v');
    const eBus = g ? (v.get('cb.nav1_eng_ess', 1) > 0.5 ? v.get('elec.ess_v') : 0) : mBus;
    v.set(C172.mBusV, mBus);
    v.set(C172.eBusV, eBus);
    v.set(C172.mBattA, v.get('elec.batt_amps'));
    v.set(C172.sBattA, g ? v.get('elec.stby_batt_amps') : 0);
    // Steam analog instruments (src/avionics/analog ANALOG_VARS).
    v.set(C172.analogBusV, v.get('elec.bus1_v'));
    v.set(C172.analogBattAmps, v.get('elec.batt_amps'));
    v.set(C172.analogTurnCoordV, v.get('elec.turn_coord_v'));
    v.set(C172.analogGaugesV, v.get('elec.engine_gauges_v'));
    v.set(C172.analogClockV, v.get('elec.bus1_v'));

    const lowVolts = v.get('elec.xfeed_v') < ELEC_DATA.lowVolts; // ACU senses the main bus (POH Sec 7)
    const highVolts = Math.max(mBus, eBus) > ELEC_DATA.highVolts; // UND: > 32.0 V

    // ---------------------------------------------------------------- annunciation conditions
    const warnPower = v.get('elec.warn_powered') > 0.5;
    const gea = v.get('elec.nav1_eng_powered') > 0.5; // G1000: GEA 71 reads the sensors
    const powered = g ? gea : warnPower;
    v.set(ANN.oilPress, powered && oilLow ? 1 : 0);
    v.set(ANN.lowFuelL, powered && lowL ? 1 : 0);
    v.set(ANN.lowFuelR, powered && lowR ? 1 : 0);
    const vac1 = v.get(SENSOR_VARS.vacPumpOk(1)) > 0.5;
    const vac2 = v.get(SENSOR_VARS.vacPumpOk(2)) > 0.5;
    v.set(ANN.vacL, !g && warnPower && !vac1 ? 1 : 0);
    v.set(ANN.vacR, !g && warnPower && !vac2 ? 1 : 0);
    v.set(ANN.lowVacuum, g && gea && v.get(SENSOR_VARS.vacLow) > 0.5 ? 1 : 0);
    // LOW VOLTS: the ACU signal needs the ACU (J-box) sense on WARN.
    v.set(ANN.lowVolts, (g ? gea || v.get('elec.lru_pfd_powered') > 0.5 : warnPower) && lowVolts ? 1 : 0);
    v.set(ANN.highVolts, g && gea && highVolts ? 1 : 0);
    const stbyDis = g && this.stbyDischarge.update(v.get('elec.stby_batt_amps') < -ELEC_DATA.stbyAnnunAmps, dt);
    v.set(ANN.stbyBatt, g && (gea || v.get('elec.lru_pfd_powered') > 0.5) && stbyDis ? 1 : 0);

    // Steam annunciator panel lamps (flash 10 s then steady; TEST flashes all; NIGHT dims).
    if (!g) {
      const sw = Math.round(v.get(C172.annSwitch, ANN_SW.day));
      const test = warnPower && sw === ANN_SW.test;
      const bright = sw === ANN_SW.night ? 0.35 : 1; // EST night dimming
      const lamp = (id: string, on: boolean) => v.set(ANN.lamp(id as never), warnPower ? bright * this.lamps[id].update(on, dt, test, this.t) : 0);
      lamp('oil_press', oilLow);
      lamp('low_fuel_l', lowL);
      lamp('low_fuel_r', lowR);
      lamp('vac_l', !vac1);
      lamp('vac_r', !vac2);
      lamp('volts', lowVolts);
    }

    // ---------------------------------------------------------------- hour (Hobbs) meter
    // POH Sec 7: the low-oil-pressure switch grounds the hour meter above 20 psi.
    if (!oilLow && warnPower) v.set(C172.hobbsHours, v.get(C172.hobbsHours) + dt / 3600);
    if (v.get(ENG.running(1)) > 0.5) v.set('ac.c172.eng_hours', v.get('ac.c172.eng_hours') + dt / 3600);
    v.set(C172.starterEngaged, v.get('elec.starter_engaged'));
    v.set(C172.stallHorn, v.get('alert.stall_horn'));

    // ---------------------------------------------------------------- ELT (steam: Pointer 3000-11, Supplement 4)
    // Remote switch ON transmits; AUTO transmits after an impact (crash or > ~2.3 g
    // longitudinal deceleration, EST G-switch); RESET/TEST stops it.
    const elt = Math.round(v.get(C172.elt));
    if (v.get(FDM.crashed) > 0.5 || v.get(FDM.nx) < -2.3) this.eltLatched = true;
    if (elt === ELT_SW.reset) this.eltLatched = false;
    v.set(C172.eltTx, elt === ELT_SW.on || (elt === ELT_SW.arm && this.eltLatched) ? 1 : 0);

    // ---------------------------------------------------------------- cabin heat / air / defrost / CO
    this.updateCabin(dt);
    this.updateDoors(dt);
  }

  /**
   * Cabin doors (POH 7-27 / Sec 3 "Inadvertent opening of a cabin door in flight" NOTE): an unlatched door
   * trails about 3 in open in flight ("the door will trail in a position approximately 3 inches open"), with
   * some drag, buffet and wind noise. To close it the pilot slows down (POH: trim to 75 KIAS, then pull the
   * door shut); above DOOR_DATA.maxCloseKias the air load holds it open, so the door state returns to OPEN.
   * On the ground an unlatched door swings fully open. Drag: the door increments `surf.speedbrake`, which the
   * 172S FDM maps to CD_speedbrake (fdm.ts, EST) and to the FDM buffet.
   */
  private updateDoors(dt: number): void {
    const v = this.vars;
    const ias = v.get(FDM.ias);
    const flying = ias > DOOR_DATA.trailAboveKias;
    let drag = 0;
    for (const side of [0, 1] as const) {
      const doorVar = side === 0 ? C172.doorLeft : C172.doorRight;
      const posVar = side === 0 ? C172.doorLeftPos : C172.doorRightPos;
      let st = Math.round(v.get(doorVar, DOOR.closed));
      const wasOpen = this.doorWasOpen[side];
      if (st !== DOOR.open && wasOpen && ias > DOOR_DATA.maxCloseKias) {
        st = DOOR.open;
        v.set(doorVar, DOOR.open);
      }
      this.doorWasOpen[side] = st === DOOR.open;
      const target = st === DOOR.open ? (flying ? DOOR_DATA.trailPos : 1) : 0;
      this.doorPos[side] += (target - this.doorPos[side]) * (1 - Math.exp(-dt / 0.4));
      v.set(posVar, this.doorPos[side]);
      if (flying) drag += Math.min(this.doorPos[side], DOOR_DATA.trailPos) / DOOR_DATA.trailPos;
    }
    v.set(SURF.speedbrake, 0.5 * drag);
  }

  private updateCabin(dt: number): void {
    const v = this.vars;
    const oat = v.get(FDM.sat, 15);
    const heat = clamp01(v.get(C172.cabinHeat));
    const air = clamp01(v.get(C172.cabinAir));
    const running = v.get(ENG.running(1)) > 0.5;
    // Muffler shroud heat: EST up to ~45 C rise of the heater air at cruise power, scaled with EGT rise.
    const egtRise = Math.max(0, v.get(ENG.egtF(1)) - 400) / 1000;
    const heaterRise = running ? 45 * clamp01(egtRise) : 0;
    // POH Sec 7: max heat with CABIN HT out and CABIN AIR in; air dilutes the heated flow.
    const ventilation = 0.2 + 0.8 * air + 0.5 * clamp01(v.get(C172.windowLeft) + v.get(C172.windowRight)) + 0.3 * (v.get(C172.ventLeft) + v.get(C172.ventRight)) / 2;
    const heatFlow = heat * (1 - 0.6 * air);
    const target = oat + heaterRise * heatFlow / Math.max(0.3, heatFlow + ventilation * 0.5) + 3 * (1 - clamp01(ventilation)); // + body/solar EST
    if (Number.isNaN(this.cabinT)) this.cabinT = Math.max(oat, 15);
    this.cabinT += (target - this.cabinT) * (1 - Math.exp(-dt / 120)); // EST ~2 min cabin time constant
    v.set(C172.cabinTempC, this.cabinT);
    // Windshield fog/frost: the glass below the cabin dew point fogs; defroster air (knobs x heat) clears it.
    const dew = v.get('env.dewpoint_c', oat - 5) + 4; // occupants add moisture (EST +4 C)
    const glassT = oat + 0.3 * (this.cabinT - oat);
    const defrost = 0.5 * (clamp01(v.get(C172.defrostLeft)) + clamp01(v.get(C172.defrostRight))) * (0.3 + 0.7 * heat) * (running ? 1 : 0.2);
    const fogRate = glassT < dew ? 0.02 : -0.01; // per s (EST)
    this.fog = clamp01(this.fog + (fogRate - 0.08 * defrost) * dt);
    v.set(C172.windshieldFog, this.fog);
    // Carbon monoxide (G1000 option "CO LVL HIGH"): a cracked muffler shroud feeds exhaust into the heater air.
    const leak = v.get(f(C172_FAIL.mufflerLeak)) !== 0 && running ? 400 * heatFlow : 0; // ppm source (EST)
    this.co += (leak - this.co * (0.02 + 0.1 * ventilation)) * dt;
    if (this.co < 0) this.co = 0;
    v.set('ac.c172.co_ppm', this.co);
    // CO detector (G1000 option, POH 7-80): EST powered through the WARN circuit; a failed ("CO DET FAIL") or
    // unpowered detector cannot raise CO LVL HIGH. "CO DET SRVC" (needs service) still detects.
    const det = this.variant === 'g1000' && v.get('elec.warn_powered') > 0.5 && v.get(f(C172_FAIL.coDetFail)) === 0;
    v.set(C172.coDetOk, det ? 1 : 0);
    v.set(ANN.coLvlHigh, det && this.co > 50 ? 1 : 0); // EST alarm level 50 ppm
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Initial fuel per tank helper for states (kg). */
export function galToKg(gal: number): number {
  return gal * KG_PER_GAL;
}

