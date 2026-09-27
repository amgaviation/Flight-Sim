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
 *   lighting -> C172LateLogic -> [C172Fire, C172G1000LateLogic: display / key lighting, cooling fans,
 *   ELT, system messages, GYRO flag].
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
import { G1K_EVENTS } from '../../avionics/garmin-g1000/vars';
import { C172Fire } from '../c172s-common/systems/fire';
import { createC172Core, type C172Core } from '../c172s-common/createSystems';
import { C172G } from './vars';
import { GFC700_GAINS, TRIM_RATES } from './data';
import { C172G1000LateLogic, C172G1000Logic } from './systems/variant';
import { C172G1000ProcedureMonitor } from './systems/procedures';
import { C172Tires } from '../c172s-common/systems/tires';

/** GFC 700 servos powered through the AUTOPILOT breaker and past their preflight test (PG §7 "PFT"), AFCS computer in GIA 1. */
const TRIM_SERVO_POWER = `${G1K.unitUp('servos')} && ${G1K.unitUp('gia1')}`;
/** A/P TRIM DISC held interrupts electric and autopilot trim (POH Sec 3). */
const TRIM_ENABLE = `${C172G.trimInterrupt} < 0.5`;

/**
 * CAS of this installation: the Nav III list (C172S_CAS). PFD1 COOLING / MFD1 COOLING are Alerts-window system
 * messages, not CAS (CRG 190-00384-12 Appendix A); C172G1000LateLogic raises them through the alerts API.
 */
export const C172G_CAS: CasDef[] = [...C172S_CAS];

/**
 * Power hold-up of a unit supply var (EST ~0.1 s input capacitance): `out` follows `src` but stays 1 through a
 * shorter interruption (the GRS 79 AHRS riding through a one-update bus transfer to the standby battery).
 */
class PowerHoldUp implements Subsystem {
  readonly name: string;
  private lostS = 0;
  constructor(
    private readonly vars: SimContext['vars'],
    private readonly src: string,
    private readonly out: string,
    private readonly holdS: number,
  ) {
    this.name = `hold:${out}`;
  }
  reset(): void {
    this.lostS = 0;
    this.vars.set(this.out, this.vars.get(this.src));
  }
  update(dt: number): void {
    const on = this.vars.get(this.src) > 0.5;
    this.lostS = on ? 0 : this.lostS + dt;
    const was = this.vars.get(this.out) > 0.5;
    this.vars.set(this.out, on || (was && this.lostS <= this.holdS) ? 1 : 0);
  }
}

/** Manual CDI changes (G1000 CDI softkey) reach the GFC 700 (reverts NAV modes to ROL, POH 7-20 / 7-71). */
class CdiToAfcs implements Subsystem {
  readonly name = 'c172-g1000-cdi-afcs';
  private readonly off: () => void;
  constructor(ctx: SimContext, afcs: Afcs) {
    this.off = ctx.events.on(G1K_EVENTS.cdiManual, () => afcs.navSourceChanged());
  }
  update(): void {}
  dispose(): void {
    this.off();
  }
}

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
  /** AHRS supply hold-up (reset it before the AHRS in a state preset). */
  ahrsHold: Subsystem & { reset(): void };
  afcs: Afcs;
  logic: C172G1000Logic;
  lateLogic: C172G1000LateLogic;
  fire: C172Fire;
  /** Tyre deflation failures (POH Sec 3 abnormal landings). */
  tires: C172Tires;
  /** Latches of the action-sequence POH checks (STBY BATT test, AP preflight, magneto check, annunciations). */
  procedures: C172G1000ProcedureMonitor;
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
  // GRS 79 AHRS on the dual-fed ADC AHRS breakers (POH NAV III Fig 7-7; alignment EST per the shared block), with
  // the same EST 0.1 s supply hold-up as the G1000 units (C172S_NXI powerHoldUpS).
  const ahrsHold = new PowerHoldUp(ctx.vars, 'elec.adc_ahrs_powered', 'ac.c172g.adc_ahrs_supply', C172S_NXI.powerHoldUpS ?? 0.1);
  const ahrs = new Ahrs(ctx, { index: 1, power: 'ac.c172g.adc_ahrs_supply' });
  const afcs = new Afcs(ctx, { ...AFCS_GFC700_NXI, ...suite.afcsWiring(), gains: { ...GFC700_GAINS } });
  const logic = new C172G1000Logic(ctx.vars, { disengageAp: () => afcs.disengage(false), emit: (n, p) => ctx.events.emit(n, p) });
  const lateLogic = new C172G1000LateLogic(ctx, (id, text, on) => suite.system.alerts.message(id, text, on));
  // Fire / cabin smoke model (POH Sec 3 fire procedures); the portable extinguisher discharges Halon into the cabin.
  const fire = new C172Fire(ctx.vars, { extDischarging: C172G.extDischarging });
  // CRG 190-00384-12 §6.4: manual disconnect: 3 s aural (5 s flashing yellow AP, Afcs discWarningS); automatic:
  // aural and flashing red AP until acknowledged with A/P TRIM DISC or MET (Afcs autoDiscLatches).
  const disc = new DisconnectAlerts(ctx, { apToneMaxS: 3, apToneAutoMaxS: Infinity });
  const tires = new C172Tires(ctx.vars);
  const procedures = new C172G1000ProcedureMonitor(ctx, () => suite.casModel);

  const list = core.compose({
    sensors: [ahrsHold, ahrs, logic, tires],
    avionics: [...suite.systems],
    afcs: [afcs, new EspServoMixer(ctx.vars), new CdiToAfcs(ctx, afcs)],
    warnings: [disc],
    late: [fire, lateLogic, procedures],
  });
  return { core, suite, ahrs, ahrsHold, afcs, logic, lateLogic, fire, tires, procedures, disc, list };
}
