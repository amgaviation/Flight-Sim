/**
 * Cessna 172S NAV III with the Garmin G1000 NXi and the GFC 700 AFCS: systems composition.
 *
 * Update order (c172s-common createSystems.ts `compose`, systems-power §0.2 /
 * systems-control §0.1):
 *
 *   failures -> C172Logic (switch interlocks, engine inputs, ACU, STBY BATT controller) ->
 *   electrical (POH NAV III Fig 7-7 buses, ESS bus, standby battery, dual-fed LRUs) -> fuel ->
 *   pitot heat -> vacuum (standby attitude indicator) -> air data (adc1 = GDC 74 digital,
 *   adc2 = pneumatic standby ASI / altimeter) -> ASI calibration ->
 *   [GRS 79 AHRS (ahrs1), C172G1000Logic: MET / A/P TRIM DISC / ELT / key / friction /
 *   extinguisher] -> landing gear -> [G1000 suite: radio power, radios, FMS, G1000 system] ->
 *   [GFC 700 Afcs, ESP servo mixer] -> stall horn -> rigging -> flight controls -> pitch trim
 *   (manual wheel + MET + AP trim servo) -> flaps -> steering -> brakes -> [AP disconnect aural] ->
 *   lighting -> C172LateLogic -> [C172G1000LateLogic: display / key lighting, cooling fans,
 *   GYRO flag].
 *
 * Sources: POH = Cessna 172S NAV III GFC 700 AFCS POH/AFM 172SPHBUS-00; PG = Garmin G1000 NXi
 * Pilot's Guide for the Cessna NAV III 190-02177-02.
 */
import type { SimContext } from '../../core/SimContext';
import type { Checklist, Subsystem } from '../types';
import { Ahrs } from '../../systems/sensors';
import { Afcs } from '../../systems/autopilot';
import { DisconnectAlerts } from '../../systems/warning';
import { G1000Suite, C172S_NXI, C172S_CAS, AFCS_GFC700_NXI, G1K, type CasDef } from '../../avionics/garmin-g1000';
import { createC172Core, type C172Core } from '../c172s-common/createSystems';
import { C172G } from './vars';
import { GFC700_GAINS, TRIM_RATES } from './data';
import { C172G1000LateLogic, C172G1000Logic } from './systems/variant';

/** GFC 700 servos powered through the AUTOPILOT breaker and past their preflight test (PG §7 "PFT"), AFCS computer in GIA 1. */
const TRIM_SERVO_POWER = `${G1K.unitUp('servos')} && ${G1K.unitUp('gia1')}`;
/** A/P TRIM DISC held interrupts electric and autopilot trim (POH Sec 3). */
const TRIM_ENABLE = `${C172G.trimInterrupt} < 0.5`;

/**
 * CAS additions for this installation: the display cooling advisories named in the POH Sec 3
 * "Display cooling advisory" procedure (PFD1 COOLING / MFD1 COOLING).
 */
export const C172G_CAS: CasDef[] = [
  ...C172S_CAS,
  { id: 'pfd1_cooling', text: 'PFD1 COOLING', level: 'advisory', when: `${C172G.pfdCooling} ?? 0` },
  { id: 'mfd1_cooling', text: 'MFD1 COOLING', level: 'advisory', when: `${C172G.mfdCooling} ?? 0` },
];

/**
 * Adds the Garmin ESP servo increments to the GFC 700 servo commands so they reach the
 * surfaces through the shared MechanicalFlightControls (PG §8.11: ESP acts through the
 * autopilot servos with the autopilot off; the Afcs writes 0 while disengaged).
 */
class EspServoMixer implements Subsystem {
  readonly name = 'c172-g1000-esp-mixer';
  constructor(private readonly vars: SimContext['vars']) {}
  update(): void {
    const v = this.vars;
    const p = v.get(G1K.espServoPitch);
    const r = v.get(G1K.espServoRoll);
    if (p !== 0) v.set('ap.servo_pitch', v.get('ap.servo_pitch') + p);
    if (r !== 0) v.set('ap.servo_roll', v.get('ap.servo_roll') + r);
  }
}

export interface C172G1000SystemsOptions {
  /** Headless (tests): no display canvases. */
  noDisplays?: boolean;
  checklists?: Checklist[];
  /** FailureManager seed. */
  seed?: number;
}

export interface C172G1000Systems {
  core: C172Core;
  suite: G1000Suite;
  ahrs: Ahrs;
  afcs: Afcs;
  logic: C172G1000Logic;
  lateLogic: C172G1000LateLogic;
  disc: DisconnectAlerts;
  /** Update-ordered list for AircraftInstance.systems. */
  list: Subsystem[];
}

export function createC172G1000Systems(ctx: SimContext, opts: C172G1000SystemsOptions = {}): C172G1000Systems {
  const core = createC172Core(ctx, {
    variant: 'g1000',
    seed: opts.seed,
    flight: {
      pitchTrim: {
        // GSA 81 pitch trim servo: manual electric trim from the yoke MET switch (PG §7).
        electric: { power: TRIM_SERVO_POWER, enable: TRIM_ENABLE, switchVars: [C172G.metCmd], rate: TRIM_RATES.electric },
        // Autopilot trim follow-up (shared Afcs ap.trim_cmd).
        autopilot: { power: TRIM_SERVO_POWER, enable: TRIM_ENABLE, rate: TRIM_RATES.autopilot },
      },
    },
  });

  const suite = new G1000Suite(ctx, { ...C172S_NXI, cas: C172G_CAS, checklists: opts.checklists }, { noDisplays: opts.noDisplays });
  // GRS 79 AHRS on the dual-fed ADC AHRS breakers (POH NAV III Fig 7-7; alignment EST per the shared block).
  const ahrs = new Ahrs(ctx, { index: 1, power: 'elec.adc_ahrs_powered' });
  const afcs = new Afcs(ctx, { ...AFCS_GFC700_NXI, ...suite.afcsWiring(), gains: { ...GFC700_GAINS } });
  const logic = new C172G1000Logic(ctx.vars, { disengageAp: () => afcs.disengage(false) });
  const lateLogic = new C172G1000LateLogic(ctx);
  // PG §7: manual AP disconnect gives a two-second disconnect tone (EST for the automatic case as well).
  const disc = new DisconnectAlerts(ctx, { apToneMaxS: 2 });

  const list = core.compose({
    sensors: [ahrs, logic],
    avionics: [...suite.systems],
    afcs: [afcs, new EspServoMixer(ctx.vars)],
    warnings: [disc],
    late: [lateLogic],
  });
  return { core, suite, ahrs, afcs, logic, lateLogic, disc, list };
}
