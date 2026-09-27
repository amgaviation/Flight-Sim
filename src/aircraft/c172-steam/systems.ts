/**
 * Cessna 172S steam-gauge variant glue systems (besides the Bendix/King units in ./avionics):
 *
 *  - SteamDirectionalGyro: the vacuum directional gyro as a sensor (models/gyro DirectionalGyro,
 *    vacuum drive, friction drift, earth rate, tumble). It is the KAP 140 heading datum (the
 *    heading-bug pick-off, Supplement 15 item 15) and the cockpit heading indicator displays
 *    the same gyro (cockpit/panel.ts shares the instance), so the ADJ knob moves both.
 *  - CdiSourceMux: the NAV/GPS switch-annunciator (Supplement 19 Fig 2): the #1 CDI (KI 209A,
 *    receiver 3 below) shows NAV 1 or the KLN 94 and the KAP 140 couples to the same source;
 *    the #1 CDI OBS knob drives NAV 1's OBS and the KLN 94 OBS-mode course.
 *  - SteamCabinExtras: elevator trim wheel moved by the pilot's trim keys/buttons (the 172S has
 *    only the manual wheel plus the KAP 140 manual electric trim), throttle creep with the
 *    friction lock backed off, the portable extinguisher gauge, the annunciator panel dim/test
 *    outputs, the instrument lighting of the Bendix/King displays.
 */
import type { Subsystem } from '../types';
import type { SimContext } from '../../core/SimContext';
import type { FailureDef } from '../../systems/failures';
import { ENG, INPUT, NAV } from '../../core/vars';
import { clamp, wrap360 } from '../../core/math';
import { DirectionalGyro, vacuumRotorDrive } from '../../avionics/analog/models/gyro';
import { ANALOG_VARS, PHYSICAL_INPUTS } from '../../avionics/analog/vars';
import { AFCS_VARS } from '../../systems/autopilot/vars';
import { ANN, ANN_SW, C172 } from '../c172s-common/vars';
import { STEAM_BREAKERS } from '../c172s-common/systems/electrical';
import { EV, KLN, ST } from './vars';
import { onEvent } from './avionics/util';

/** Virtual receiver index shown on the #1 CDI (KI 209A): NAV 1 or GPS per the NAV/GPS switch. */
export const CDI1_RECEIVER = 3;

/** Directional gyro failure id (mechanical gyro failure: the rotor stops, card follows the case). */
export const DG_FAIL = 'c172s.dg';
const DG_FAIL_VAR = `fail.${DG_FAIL}`;

export class SteamDirectionalGyro implements Subsystem {
  readonly name = 'dg-gyro';
  /** Shared with the cockpit heading indicator. */
  readonly gyro = new DirectionalGyro({ seed: 172 });
  constructor(private readonly vars: SimContext['vars']) {}
  failures(): FailureDef[] {
    return [{ id: DG_FAIL, name: 'Directional gyro', category: 'instruments', description: 'DG rotor seized: the card turns with the airplane; KAP 140 HDG / NAV modes unusable (Supplement 15).' }];
  }
  update(dt: number): void {
    const v = this.vars;
    const failed = v.get(DG_FAIL_VAR) !== 0;
    const drive = failed ? 0 : vacuumRotorDrive(v.get(ANALOG_VARS.suction, 0));
    this.gyro.update(v.get(PHYSICAL_INPUTS.headingMag), v.get(PHYSICAL_INPUTS.pitch), v.get(PHYSICAL_INPUTS.bank), v.get(PHYSICAL_INPUTS.lat), drive, dt);
    v.set(ST.dgHeading, this.gyro.heading);
  }
  /** Card aligned with the compass, rotor at speed (state presets). */
  setSpunUp(errDeg = 0): void {
    this.gyro.setSpunUp(this.vars.get(PHYSICAL_INPUTS.headingMag), errDeg);
    this.vars.set(ST.dgHeading, this.gyro.heading);
  }
  setStopped(): void {
    this.gyro.setStopped(this.vars.get(PHYSICAL_INPUTS.headingMag));
    this.vars.set(ST.dgHeading, this.gyro.heading);
  }
}

export class CdiSourceMux implements Subsystem {
  readonly name = 'cdi-source';
  private readonly offs: (() => void)[] = [];
  private readonly r = CDI1_RECEIVER;
  private lastObs = NaN;
  private lastBtn = 0;
  private readonly vars: SimContext['vars'];
  constructor(
    ctx: Pick<SimContext, 'vars' | 'events'>,
    private readonly klnObsVar: string = KLN.obs,
  ) {
    this.vars = ctx.vars;
    onEvent(ctx.events, EV.navGps, () => this.toggle(), this.offs);
  }

  private toggle(): void {
    this.vars.set(ST.cdiSource, this.vars.get(ST.cdiSource) > 0.5 ? 0 : 1);
  }

  update(): void {
    const v = this.vars;
    // The switch-annunciator is a momentary push button (ST.navGpsBtn, alternate action) or the event above.
    const btn = v.get(ST.navGpsBtn) > 0.5 ? 1 : 0;
    if (btn && !this.lastBtn) this.toggle();
    this.lastBtn = btn;
    const gps = v.get(ST.cdiSource) > 0.5;
    const r = this.r;
    // OBS knob on the KI 209A drives NAV 1 and the KLN 94 OBS course.
    const obs = wrap360(v.get(NAV.obs(r)));
    if (obs !== this.lastObs) {
      this.lastObs = obs;
      v.set(NAV.obs(1), obs);
      v.set(this.klnObsVar, obs);
    }
    if (gps) {
      const valid = v.get(KLN.cdiValid) > 0.5;
      v.set(NAV.powered(r), v.get(KLN.on));
      v.set(NAV.received(r), valid ? 1 : 0);
      v.set(NAV.cdi(r), v.get(KLN.cdi));
      v.set(NAV.toFrom(r), valid ? v.get(KLN.toFrom) : 0);
      v.set(NAV.gsValid(r), 0);
      v.set(NAV.gsDev(r), 0);
      v.set(NAV.isLoc(r), 0);
    } else {
      v.set(NAV.powered(r), v.get(NAV.powered(1)));
      v.set(NAV.received(r), v.get(NAV.received(1)));
      v.set(NAV.cdi(r), v.get(NAV.cdi(1)));
      v.set(NAV.toFrom(r), v.get(NAV.toFrom(1)));
      v.set(NAV.gsValid(r), v.get(NAV.gsValid(1)));
      v.set(NAV.gsDev(r), v.get(NAV.gsDev(1)));
      v.set(NAV.isLoc(r), v.get(NAV.isLoc(1)));
    }
    // KAP 140 couples to the source displayed on the #1 CDI: 0 GPS (roll steering), 1 NAV 1.
    v.set(AFCS_VARS.navSource, gps ? 0 : 1);
    // NAV / GPS annunciator lamps (powered with the KLN 94 installation's annunciator, avionics bus 1).
    const annPower = v.get('elec.gps_powered') > 0.5;
    v.set('ac.c172s.ann_nav', annPower && !gps ? 1 : 0);
    v.set('ac.c172s.ann_gps', annPower && gps ? 1 : 0);
  }

  reset(): void {
    this.lastBtn = this.vars.get(ST.navGpsBtn) > 0.5 ? 1 : 0;
    this.lastObs = NaN;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}

/** EST data for the cabin extras (see each use). */
export const STEAM_EXTRAS = {
  /** Pilot rolling the manual trim wheel continuously: lock to lock in ~8 s (EST, same as the G1000 variant). */
  manualTrimUnitsPerS: 2 / 8,
  /** Throttle creep toward idle with the friction lock backed off (EST, same as the G1000 variant). */
  creepFrictionBelow: 0.1,
  creepRatePerS: 0.004,
  /** Portable Halon 1211 extinguisher gage ~150 psi charged, empty in ~10 s (EST, H3R/Amerex typical). */
  extinguisherPsi: 150,
  extinguisherDischargeS: 10,
} as const;

/** Canvas displays of the stack whose brightness follows the unit photocells. */
const BK_DISPLAYS = ['kx155a_1', 'kx155a_2', 'kr87', 'kt76c', 'kap140'] as const;
const BK_BRT_VARS: readonly string[] = BK_DISPLAYS.map((id) => `display.${id}.brt`);

/** Steam switch/breakers (POH Fig 7-7A): switch var, breaker var and trip flag. */
const SWITCH_BREAKERS = STEAM_BREAKERS.filter((b) => b.switchVar).map((b) => ({ sw: b.switchVar!, cb: `cb.${b.name}`, trip: `cb.${b.name}_tripped` }));

export class SteamCabinExtras implements Subsystem {
  readonly name = 'c172s-cabin-extras';
  private extPsi: number = STEAM_EXTRAS.extinguisherPsi;
  private readonly swPrev: boolean[] = SWITCH_BREAKERS.map(() => false);
  constructor(private readonly vars: SimContext['vars']) {}

  update(dt: number): void {
    const v = this.vars;
    // Trim keys / hat on a PC = the pilot's hand on the trim wheel (manual trim; the electric
    // trim is the KAP 140 split switch on the control wheel).
    const rate = v.get(INPUT.pitchTrimRate);
    if (rate !== 0) v.set(C172.trimPosition, clamp(v.get(C172.trimPosition) + rate * STEAM_EXTRAS.manualTrimUnitsPerS * dt, -1, 1));
    // Throttle creep (engine vibration) with the friction lock backed off.
    if (v.get(C172.throttleFriction) < STEAM_EXTRAS.creepFrictionBelow && v.get(ENG.running(1)) > 0.5 && v.get(INPUT.throttleBound) === 0) {
      const t = v.get(C172.throttle);
      if (t > 0) v.set(C172.throttle, Math.max(0, t - STEAM_EXTRAS.creepRatePerS * dt));
    }
    // Portable extinguisher: discharge empties the bottle (gage to zero).
    if (v.get(C172.extinguisher) > 0.5 && this.extPsi > 0) this.extPsi = Math.max(0, this.extPsi - (STEAM_EXTRAS.extinguisherPsi / STEAM_EXTRAS.extinguisherDischargeS) * dt);
    v.set('ac.c172s.extinguisher_psi', this.extPsi);
    // Cabin draft from doors / baggage door open (cabin ventilation cue; SCOPE: no drag change).
    const doors = (v.get(C172.doorLeft) < 0.5 ? 1 : 0) + (v.get(C172.doorRight) < 0.5 ? 1 : 0) + (v.get(C172.baggageDoor) < 0.5 ? 0.3 : 0);
    v.set('ac.c172s.cabin_draft', doors);
    // Annunciator panel: DAY / NIGHT brightness and TST (for the cockpit lamp materials).
    const sw = Math.round(v.get(C172.annSwitch, ANN_SW.day));
    const warn = v.get('elec.warn_powered') > 0.5;
    v.set(ST.annBright, sw === ANN_SW.night ? 0 : 1);
    v.set(ST.annTest, warn && sw === ANN_SW.test ? 1 : 0);
    // Magnetic compass: no electrical deviation modelled beyond the compensation card (SCOPE).
    v.set(ANALOG_VARS.compassExtraDeviation, 0);
    // Annunciator panel shared legends: "LOW FUEL" with either side, "VAC" with either pump.
    v.set('ac.c172s.ann_low_fuel', Math.max(v.get(ANN.lamp('low_fuel_l')), v.get(ANN.lamp('low_fuel_r'))));
    v.set('ac.c172s.ann_vac', Math.max(v.get(ANN.lamp('vac_l')), v.get(ANN.lamp('vac_r'))));
    // KLN 94 external annunciators (message, waypoint alert, approach): powered with the GPS, all lit
    // on the Self Test page (Pilot's Guide 3.2 step 3).
    const kOn = v.get(KLN.on) > 0.5;
    const selfTest = kOn && v.get('ac.kln94.self_test') > 0.5;
    v.set('ac.c172s.ann_kln_msg', kOn && (selfTest || v.get(KLN.msg) > 0.5) ? 1 : 0);
    v.set('ac.c172s.ann_kln_wpt', kOn && (selfTest || v.get(KLN.wpt) > 0.5) ? 1 : 0);
    v.set('ac.c172s.ann_kln_apr', kOn && (selfTest || v.get(KLN.apr) > 0.5) ? 1 : 0);
    // Display brightness: the KLN 94 On/Off/Brightness knob; the gas-discharge Bendix/King
    // displays and the KAP 140 dim themselves with their photocells (Supplement 6 Sec 1
    // "self-dimming gas discharge numerics"), EST 55 % at night.
    v.set('display.kln94.brt', v.get(KLN.brt, 0.8));
    const photo = v.get('env.ambient_light', 1) > 0.35 ? 1 : 0.55;
    for (let i = 0; i < BK_BRT_VARS.length; i++) v.set(BK_BRT_VARS[i], photo);
    // Switch/breakers (POH Sec 7 "Circuit breakers and fuses"): a tripped switch/breaker snaps to
    // OFF; moving it back ON resets the breaker.
    for (let i = 0; i < SWITCH_BREAKERS.length; i++) {
      const sb = SWITCH_BREAKERS[i];
      const tripped = v.get(sb.trip) > 0.5;
      const sw = v.get(sb.sw) > 0.5;
      if (tripped && sw && this.swPrev[i]) v.set(sb.sw, 0);
      else if (tripped && sw && !this.swPrev[i]) {
        v.set(sb.cb, 1);
        v.set(sb.trip, 0);
      }
      this.swPrev[i] = v.get(sb.sw) > 0.5;
    }
  }

  /** State presets (a fresh bottle). */
  reset(): void {
    if (this.vars.get(C172.extinguisher) < 0.5) this.extPsi = STEAM_EXTRAS.extinguisherPsi;
  }
}
