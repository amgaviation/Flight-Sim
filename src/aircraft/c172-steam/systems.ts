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
import type { AudioApi, SimContext } from '../../core/SimContext';
import type { FailureDef } from '../../systems/failures';
import { ENG, FMS, INPUT, NAV } from '../../core/vars';
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
/** Nominal distance (nm) at which the KLN 94 cross track is expressed as an angular deviation (EST, any value > the largest xtk). */
const GPS_OBS_NOMINAL_NM = 100;

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
  private lastGps = false;
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
    // OBS knob on the KI 209A drives NAV 1, and the KLN 94 OBS-mode course only with GPS selected
    // (Supplement 19 Fig 2 item 4: "The No. 1 CDI OBS provides analog course input to the KLN 94 in OBS mode
    // when the NAV/GPS switch/annunciator is in GPS. When ... in NAV, GPS course selection in OBS mode is
    // digital through the use of the controls and display at the KLN 94").
    const obs = wrap360(v.get(NAV.obs(r)));
    if (obs !== this.lastObs || gps !== this.lastGps) {
      if (obs !== this.lastObs) v.set(NAV.obs(1), obs);
      if (gps) v.set(this.klnObsVar, obs);
      this.lastObs = obs;
      this.lastGps = gps;
    }
    v.set(KLN.obsAnalog, gps ? 1 : 0);
    if (gps) {
      const valid = v.get(KLN.cdiValid) > 0.5;
      v.set(NAV.powered(r), v.get(KLN.on));
      v.set(NAV.received(r), valid ? 1 : 0);
      v.set(NAV.cdi(r), v.get(KLN.cdi));
      v.set(NAV.toFrom(r), valid ? v.get(KLN.toFrom) : 0);
      v.set(NAV.gsValid(r), 0);
      v.set(NAV.gsDev(r), 0);
      v.set(NAV.isLoc(r), 0);
      // Analog deviation for the KAP 140 (OBS mode, no roll steering): the cross track as an angular
      // deviation at a nominal distance (the autopilot's VOR law rebuilds xtk = dist * sin(dev)).
      const xtkRight = valid ? -v.get(FMS.xtkNm) : 0;
      v.set(NAV.distNm(r), GPS_OBS_NOMINAL_NM);
      v.set(NAV.devDeg(r), (Math.asin(clamp(xtkRight / GPS_OBS_NOMINAL_NM, -1, 1)) * 180) / Math.PI);
    } else {
      v.set(NAV.powered(r), v.get(NAV.powered(1)));
      v.set(NAV.received(r), v.get(NAV.received(1)));
      v.set(NAV.cdi(r), v.get(NAV.cdi(1)));
      v.set(NAV.toFrom(r), v.get(NAV.toFrom(1)));
      v.set(NAV.gsValid(r), v.get(NAV.gsValid(1)));
      v.set(NAV.gsDev(r), v.get(NAV.gsDev(1)));
      v.set(NAV.isLoc(r), v.get(NAV.isLoc(1)));
      v.set(NAV.distNm(r), v.get(NAV.distNm(1)));
      v.set(NAV.devDeg(r), v.get(NAV.devDeg(1)));
    }
    // KAP 140 couples to the source displayed on the #1 CDI: 0 GPS roll steering (KLN 94 LEG), CDI1_RECEIVER
    // (analog #1 CDI deviation with the heading-bug course datum) in the KLN 94 OBS mode, 1 NAV 1. Supplement 19:
    // "Roll Steering will not function when the GPS is in OBS mode".
    v.set(AFCS_VARS.navSource, gps ? (v.get(KLN.obsMode) > 0.5 ? r : 0) : 1);
    // NAV / GPS annunciator lamps (powered with the KLN 94 installation's annunciator, avionics bus 1).
    const annPower = v.get('elec.gps_powered') > 0.5;
    v.set('ac.c172s.ann_nav', annPower && !gps ? 1 : 0);
    v.set('ac.c172s.ann_gps', annPower && gps ? 1 : 0);
  }

  reset(): void {
    this.lastBtn = this.vars.get(ST.navGpsBtn) > 0.5 ? 1 : 0;
    this.lastObs = NaN;
    this.lastGps = this.vars.get(ST.cdiSource) > 0.5;
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
  /** Avionics cooling fan headset/cabin level at 28 V (EST mix level; POH Sec 4 "CHECK AUDIBLY"). */
  avnFanGain: 0.06,
  /** POH Sec 3 CAUTION: "compass deviations of as much as 25°" with the alternator side OFF; EST full at 20 A discharge. */
  compassDevMaxDeg: 25,
  compassDevFullA: 20,
  /** CO symptoms (EST): impairment grows above 100 ppm to full at 800 ppm, ~3 min onset, ~10 min recovery. */
  coOnsetPpm: 100,
  coFullPpm: 800,
  coTauUpS: 180,
  coTauDownS: 600,
} as const;

/** Failure id: avionics cooling fan seized (no airflow, no sound). */
export const AVN_FAN_FAIL = 'c172s.avn_fan';

/** Canvas displays of the stack whose brightness follows the unit photocells. */
const BK_DISPLAYS = ['kx155a_1', 'kx155a_2', 'kr87', 'kt76c', 'kap140'] as const;
const BK_BRT_VARS: readonly string[] = BK_DISPLAYS.map((id) => `display.${id}.brt`);

/** Steam switch/breakers (POH Fig 7-7A): switch var, breaker var and trip flag. */
const SWITCH_BREAKERS = STEAM_BREAKERS.filter((b) => b.switchVar).map((b) => ({ sw: b.switchVar!, cb: `cb.${b.name}`, trip: `cb.${b.name}_tripped` }));

type Loop = ReturnType<AudioApi['loop']>;

export class SteamCabinExtras implements Subsystem {
  readonly name = 'c172s-cabin-extras';
  private extPsi: number = STEAM_EXTRAS.extinguisherPsi;
  private readonly swPrev: boolean[] = SWITCH_BREAKERS.map(() => false);
  private loopsTried = false;
  private fan: Loop | null = null;
  private wind: Loop | null = null;
  private coImpair = 0;
  private prevGpu = 0;
  private prevKeyDisc = false;
  constructor(
    private readonly vars: SimContext['vars'],
    private readonly audio?: AudioApi,
  ) {}

  failures(): FailureDef[] {
    return [{ id: AVN_FAN_FAIL, name: 'Avionics cooling fan', category: 'avionics', description: 'Fan seized: no cooling airflow and no fan noise (POH Sec 4 preflight "check audibly for operation").' }];
  }

  update(dt: number): void {
    const v = this.vars;
    // Trim keys / hat on a PC = the pilot's hand on the trim wheel (manual trim; the electric
    // trim is the KAP 140 split switch on the control wheel).
    const rate = v.get(INPUT.pitchTrimRate);
    if (rate !== 0) v.set(C172.trimPosition, clamp(v.get(C172.trimPosition) + rate * STEAM_EXTRAS.manualTrimUnitsPerS * dt, -1, 1));
    // The simulator's AP-disconnect key / hardware button (INPUT.apDisconnect, Shift+Z) is the pilot's thumb on the
    // A/P DISC / TRIM INT switch (Supplement 15 Fig 2 item 12): held while the key is held (edges only, so the
    // cockpit button keeps working).
    const keyDisc = v.get(INPUT.apDisconnect) > 0.5;
    if (keyDisc !== this.prevKeyDisc) {
      this.prevKeyDisc = keyDisc;
      v.set(ST.apDisc, keyDisc ? 1 : 0);
    }
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
    this.sounds(dt, doors);
    // Carbon monoxide (muffler shroud leak with CABIN HT, C172LateLogic co_ppm): the steam airplane has no CO
    // detector, so the pilot only notices the symptoms: EST impairment 0..1 (the cockpit dims the view).
    const co = v.get('ac.c172.co_ppm');
    const target = clamp((co - STEAM_EXTRAS.coOnsetPpm) / (STEAM_EXTRAS.coFullPpm - STEAM_EXTRAS.coOnsetPpm), 0, 1);
    const tau = target > this.coImpair ? STEAM_EXTRAS.coTauUpS : STEAM_EXTRAS.coTauDownS;
    this.coImpair += (target - this.coImpair) * (1 - Math.exp(-dt / tau));
    v.set(ST.coImpair, this.coImpair);
    // External power (POH Sec 4 "Starting engine (with external power)", Sec 7 receptacle on the left cowl):
    // the ground crew plugs the GPU in with the engine stopped on the ground; it is unplugged before the
    // airplane moves. MASTER BAT closes the external power contactor (electrical.ts 'gpu' source).
    const gpu = v.get(ST.gpuRequest);
    if (gpu !== this.prevGpu) {
      const onGround = v.get('fdm.on_ground', 1) > 0.5 || v.get('fdm.ias_kt') < 30;
      const stopped = v.get(ENG.running(1)) < 0.5 && v.get(ENG.rpm(1)) < 100;
      if (gpu > 0.5 && !(onGround && stopped)) v.set(ST.gpuRequest, 0);
      else v.set(C172.extPower, gpu > 0.5 ? 1 : 0);
    }
    if (v.get(C172.extPower) > 0.5 && v.get('fdm.gs_kt') > 3) {
      v.set(C172.extPower, 0);
      v.set(ST.gpuRequest, 0);
    }
    this.prevGpu = v.get(ST.gpuRequest);
    // Annunciator panel: DAY / NIGHT brightness and TST (for the cockpit lamp materials).
    const sw = Math.round(v.get(C172.annSwitch, ANN_SW.day));
    const warn = v.get('elec.warn_powered') > 0.5;
    v.set(ST.annBright, sw === ANN_SW.night ? 0 : 1);
    v.set(ST.annTest, warn && sw === ANN_SW.test ? 1 : 0);
    // Magnetic compass: POH Sec 3 "Ammeter shows excessive rate of charge" CAUTION: "with the alternator side
    // of the master switch OFF, compass deviations of as much as 25° may occur" (battery current through the
    // wiring near the compass). EST: proportional to the battery discharge, heading dependent (one-cycle).
    const discharge = v.get(C172.masterAlt) < 0.5 && v.get(C172.masterBat) > 0.5 ? Math.max(0, -v.get('elec.batt_amps')) : 0;
    const devAmp = STEAM_EXTRAS.compassDevMaxDeg * Math.min(1, discharge / STEAM_EXTRAS.compassDevFullA);
    v.set(ANALOG_VARS.compassExtraDeviation, devAmp * Math.sin(((v.get(PHYSICAL_INPUTS.headingMag) + 45) * Math.PI) / 180));
    // Annunciator panel shared legends: "LOW FUEL" with either side, "VAC" with either pump.
    v.set('ac.c172s.ann_low_fuel', Math.max(v.get(ANN.lamp('low_fuel_l')), v.get(ANN.lamp('low_fuel_r'))));
    v.set('ac.c172s.ann_vac', Math.max(v.get(ANN.lamp('vac_l')), v.get(ANN.lamp('vac_r'))));
    // No external KLN 94 MSG / WPT / APR lamps on serials 172S8704 and on (Supplement 19 Fig 2): the
    // KLN 94 shows those annunciations on its own screen.
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

  /**
   * Cabin sounds: the avionics cooling fan on AVIONICS BUS 1 (POH Sec 4 Preflight Cabin 11 "Avionics Cooling
   * Fan -- CHECK AUDIBLY FOR OPERATION"; Fig 7-7A AVN FAN) and the air noise of the ventilation (CABIN AIR,
   * wing-root vents, storm windows, an open door) growing with airspeed (EST gains).
   */
  private sounds(dt: number, doors: number): void {
    const v = this.vars;
    void dt;
    if (!this.loopsTried && this.audio) {
      this.loopsTried = true;
      try {
        this.fan = this.audio.loop('fan.avionics');
        this.wind = this.audio.loop('noise.pink');
      } catch {
        this.fan = this.wind = null;
      }
    }
    const fanOn = v.get('elec.avn_fan_powered') > 0.5 && v.get(`fail.${AVN_FAN_FAIL}`) === 0;
    const fanGain = fanOn ? STEAM_EXTRAS.avnFanGain * clamp(v.get('elec.avn1_v') / 28, 0, 1.1) : 0;
    v.set(ST.avnFanGain, fanGain);
    this.fan?.setGain(fanGain);
    const air = clamp(v.get(C172.cabinAir), 0, 1);
    const vents = (clamp(v.get(C172.ventLeft), 0, 1) + clamp(v.get(C172.ventRight), 0, 1)) / 2;
    const windows = clamp(v.get(C172.windowLeft) + v.get(C172.windowRight), 0, 1);
    const ias = Math.max(0, v.get('fdm.ias_kt'));
    const draft = 0.12 * air + 0.1 * vents + 0.4 * windows + 0.5 * Math.min(1, doors);
    const windGain = Math.min(0.5, draft * (ias / 100));
    v.set(ST.cabinAirNoise, windGain);
    this.wind?.setGain(windGain);
  }

  /** State presets (a fresh bottle). */
  reset(): void {
    if (this.vars.get(C172.extinguisher) < 0.5) this.extPsi = STEAM_EXTRAS.extinguisherPsi;
    this.prevGpu = this.vars.get(ST.gpuRequest);
  }

  dispose(): void {
    this.fan?.stop();
    this.wind?.stop();
  }
}
