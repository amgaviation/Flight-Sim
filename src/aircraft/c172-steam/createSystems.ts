/**
 * Cessna 172S Skyhawk SP, steam gauges with the Bendix/King NAV II avionics: systems composition.
 *
 * Update order (c172s-common createSystems.ts `compose`, systems-power §0.2 / systems-control §0.1):
 *
 *   failures -> C172Logic (switch interlocks, engine inputs, ACU) -> electrical (POH Fig 7-7A
 *   buses and switch breakers) -> fuel -> pitot heat -> vacuum (L VAC / VAC R, AI and DG) ->
 *   adc1 (pneumatic pitot-static) -> ASI calibration ->
 *   [vacuum DG gyro (KAP 140 heading datum), KAP 140 rate sensors (turn coordinator gyro)] ->
 *   landing gear ->
 *   [KX 155A #1 / #2 (frequencies, CHAN, timers, power), KR 87, KT 76C, nav/Radios (VOR/LOC/GS,
 *   ADF, marker, GPS receiver), KMA 28 (audio selection, marker lamps, transmitter select),
 *   FMS core, KLN 94 (pages, D->, OBS, approach modes, CDI output), NAV/GPS mux (#1 CDI, AP source)] ->
 *   [KAP 140 computer (power, PFT, buttons, MET split switch), shared Afcs (KAP 140 laws),
 *   KAP 140 annunciation] -> stall horn -> rigging -> flight controls -> pitch trim (manual wheel,
 *   KAP manual electric trim, autotrim servo) -> flaps -> steering -> brakes ->
 *   [KAP 140 altitude alerter, AP disconnect tone] -> lighting -> C172LateLogic ->
 *   [cabin extras: manual trim keys, throttle creep, extinguisher, annunciator dim/test].
 *
 * Sources: POH = Cessna 172S Skyhawk SP POH/AFM 172SPHUS Rev 5 with Supplements 1 (KX 155A),
 * 2 (KT 76C), 6 (KR 87), 15 (KAP 140), 19 (KLN 94), 20 (KMA 28).
 */
import type { SimContext } from '../../core/SimContext';
import type { Subsystem } from '../types';
import type { FailureDef } from '../../systems/failures';
import { ADC } from '../../core/vars';
import { Ahrs } from '../../systems/sensors';
import { SENSOR_VARS } from '../../systems/sensors/vars';
import { Afcs } from '../../systems/autopilot/Afcs';
import { AFCS_KAP140 } from '../../systems/autopilot/presets';
import { AltitudeAlert, ALT_ALERT_KAP140 } from '../../systems/warning/AltitudeAlert';
import { DisconnectAlerts } from '../../systems/warning/DisconnectAlerts';
import { Radios } from '../../nav/Radios';
import { Fms } from '../../nav/fms/Fms';
import { createC172Core, type C172Core } from '../c172s-common/createSystems';
import { KAP, KLN, ST } from './vars';
import { Kx155aLogic } from './avionics/kx155a';
import { Kma28Logic, gatedAlertAudio } from './avionics/kma28';
import { Kt76cLogic } from './avionics/kt76c';
import { Kr87Logic } from './avionics/kr87';
import { Kap140Logic } from './avionics/kap140';
import { Kln94Logic } from './avionics/kln94';
import { CdiSourceMux, SteamCabinExtras, SteamDirectionalGyro } from './systems';

/**
 * Pitch trim rates (trim units per second, full travel = 2 units).
 * EST: KAP 140 manual electric trim ~25 s lock to lock, autotrim ~35 s (Bendix/King KS 271C
 * trim servo; neither the POH nor the pilot's guide gives a rate). Same EST values as the G1000
 * variant's GSA 81 so the two 172S variants trim alike.
 */
export const KAP_TRIM_RATES = { electric: 2 / 25, autopilot: 2 / 35 } as const;

/**
 * KAP 140 control-law gains for the shared Afcs on the 172S FDM (EST, tuned in
 * tests/aircraft/c172-steam so that VS/ALT/NAV/APR/GS hold without oscillation at 70-120 KIAS).
 */
export const KAP140_GAINS = {
  gainRefKt: 110,
  locTauS: 22, // EST: softer localizer tracking of a rate-based roll axis
} as const;

/** Sensor index of the KAP 140 internal rate sensors (turn coordinator gyro + accelerometer). */
export const KAP_SENSOR_INDEX = 9;

/** Power of the audio panel: avionics bus 2 NAV/COM 2 breaker (POH Fig 7-7A note on the KMA 28 supply). */
export const KMA_POWER = 'elec.nav_com2_powered';

/**
 * The KAP 140 has no attitude gyro: the roll axis senses turn rate with the turn-coordinator
 * gyro, the pitch axis uses an accelerometer and the static pressure (Supplement 15 Sec 1 and
 * Sec 3: "failure of the turn coordinator ... autopilot inoperative"). Modelled as a rate/attitude
 * sensor block powered by the TURN COORD and AUTO PILOT breakers; its own failures are the KAP
 * 140 failures (the turn coordinator breaker / power), so the AHRS failure list is not exposed.
 */
class KapRateSensors extends Ahrs {
  override failures(): FailureDef[] {
    return [];
  }
}

export interface C172SteamSystemsOptions {
  /** FailureManager seed. */
  seed?: number;
}

export interface C172SteamSystems {
  core: C172Core;
  radios: Radios;
  fms: Fms;
  kx1: Kx155aLogic;
  kx2: Kx155aLogic;
  kma: Kma28Logic;
  kt: Kt76cLogic;
  kr: Kr87Logic;
  kln: Kln94Logic;
  mux: CdiSourceMux;
  dg: SteamDirectionalGyro;
  kapSensors: Ahrs;
  afcs: Afcs;
  kap: Kap140Logic;
  altAlert: AltitudeAlert;
  disc: DisconnectAlerts;
  extras: SteamCabinExtras;
  /** Update-ordered list for AircraftInstance.systems. */
  list: Subsystem[];
}

export function createC172SteamSystems(ctx: SimContext, opts: C172SteamSystemsOptions = {}): C172SteamSystems {
  const core = createC172Core(ctx, {
    variant: 'steam',
    seed: opts.seed,
    flight: {
      pitchTrim: {
        // KAP 140 manual electric trim (split switch on the pilot's wheel, Supplement 15 item 13):
        // AUTO PILOT breaker, interrupted by A/P DISC / TRIM INT held (item 12) or a trim fault.
        electric: { power: 'elec.autopilot_powered', enable: 'ac.kap140.trim_ok', switchVars: [KAP.metCmd], rate: KAP_TRIM_RATES.electric },
        // Autotrim (pitch trim servo follows the Afcs ap.trim_cmd while the autopilot is engaged).
        autopilot: { power: 'ac.kap140.servo_ok', enable: 'ac.kap140.trim_ok', rate: KAP_TRIM_RATES.autopilot },
      },
    },
  });
  const v = ctx.vars;
  // Alert tones and voice messages reach the headsets through the KMA 28 (OFF/EMG silences them).
  const alertAudio = gatedAlertAudio(ctx.audio, v);
  const alertCtx = { vars: v, events: ctx.events, audio: alertAudio };

  // ---- sensors
  const dg = new SteamDirectionalGyro(v);
  // EST: 5 s turn-coordinator gyro spin-up before the roll axis is valid (the PFT takes longer).
  const kapSensors = new KapRateSensors(ctx, {
    index: KAP_SENSOR_INDEX,
    power: 'elec.turn_coord_powered && elec.autopilot_powered',
    alignS: 5,
    hdgAlignS: 0,
  });

  // ---- avionics (NAV II stack)
  const kx1 = new Kx155aLogic(ctx, { n: 1, powerVar: 'elec.nav_com1_powered' });
  const kx2 = new Kx155aLogic(ctx, { n: 2, powerVar: 'elec.nav_com2_powered' });
  const kr = new Kr87Logic(ctx, 'elec.adf_powered');
  const kt = new Kt76cLogic(ctx, 'elec.xpndr_powered');
  const radios = new Radios(ctx, { navCount: 2, adfCount: 1 });
  const kma = new Kma28Logic(v, ctx.audio, KMA_POWER);
  // KLN 94 flight plan / D-> / OBS guidance core (Bendix/King: same leg sequencing as the shared FMS).
  const fms = new Fms(ctx, { style: 'garmin', engineCount: 1, bankLimitDeg: 25 });
  const kln = new Kln94Logic(ctx, ctx.nav, fms, 'elec.gps_powered', KLN.obs);
  const mux = new CdiSourceMux(ctx, KLN.obs);

  // ---- KAP 140 around the shared AFCS
  const afcs = new Afcs(ctx, {
    ...AFCS_KAP140,
    power: 'ac.kap140.ready',
    servoPower: 'ac.kap140.servo_ok',
    sensors: {
      pitch: ADC.pitch(KAP_SENSOR_INDEX),
      bank: ADC.bank(KAP_SENSOR_INDEX),
      // Heading datum: the vacuum DG and its heading bug (Supplement 15 item 15).
      heading: ST.dgHeading,
      p: SENSOR_VARS.p(KAP_SENSOR_INDEX),
      q: SENSOR_VARS.q(KAP_SENSOR_INDEX),
      valid: `${ADC.ahrsValid(KAP_SENSOR_INDEX)} && ${ADC.valid(1)}`,
      // SCOPE: no GPS track input to the KAP 140; courses are flown on the DG heading.
      track: ST.dgHeading,
      trackValid: false,
    },
    // The keyboard / hat trim is the manual trim wheel here (no AP disconnect); the split
    // switch disconnect is handled by Kap140Logic.
    disconnect: { ...AFCS_KAP140.disconnect, trimDisconnects: false },
    gains: { ...KAP140_GAINS },
  });
  const kap = new Kap140Logic(ctx, afcs, alertAudio, 'elec.autopilot_powered', ADC.ahrsValid(KAP_SENSOR_INDEX));

  // ---- warnings
  const altAlert = new AltitudeAlert(alertCtx, {
    ...ALT_ALERT_KAP140,
    altVar: 'ac.kap140.alt_ft',
    power: `ac.kap140.ready && ${KAP.encoderValid}`,
  });
  // Supplement 15: "an aural alert will also sound for approximately 2 seconds" on disconnect,
  // plus the PFT disconnect-tone test.
  const disc = new DisconnectAlerts(alertCtx, { apWarnVar: 'ac.kap140.tone', apToneMaxS: 2 });

  const extras = new SteamCabinExtras(v);

  const list = core.compose({
    sensors: [dg, kapSensors],
    avionics: [kx1, kx2, kr, kt, radios, kma, fms, kln, mux],
    afcs: [kap, afcs, kap.post],
    warnings: [altAlert, disc],
    late: [extras],
  });
  return { core, radios, fms, kx1, kx2, kma, kt, kr, kln, mux, dg, kapSensors, afcs, kap, altAlert, disc, extras, list };
}
