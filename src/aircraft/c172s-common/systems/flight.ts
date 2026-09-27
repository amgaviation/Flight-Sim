/**
 * Cessna 172S flight controls, trim, flaps, landing gear, steering, brakes, stall warning and
 * factory rigging (POH Sec 7; TCDS 3A12; docs/aircraft/c172s.md §5.6-5.7, 5.9-5.10).
 *
 *  - Primary controls: cables and push-rods, no boost (POH Sec 7 "Flight controls"). The pilot
 *    yoke/pedal inputs reach the surfaces through C172Logic's control-lock gate
 *    (`ac.c172.fcs.*_in`).
 *  - Elevator trim: manual vertical trim wheel with position indicator on the pedestal
 *    ("forward rotation trims nose down"), trim tab 22 deg up / 19 deg down (TCDS). The
 *    variant adds the autopilot pitch-trim servo (KAP 140 / GFC 700) and the yoke electric
 *    trim switch through `pitchTrim` options.
 *  - Flaps: electric single-slot flaps, follow-up switch lever with mechanical stops at 10 and
 *    20 deg (POH Sec 7 "Wing flap system"), FLAP(S) 10 A breaker.
 *  - Landing gear: fixed tricycle, tubular spring-steel mains, air/oil nose strut.
 *  - Ground steering: spring bungee from the rudder pedals, ~10 deg each side; differential
 *    braking castors the nosewheel to 30 deg (POH Sec 7 "Ground control") — the castering
 *    behaviour is in the FDM gear contact (fdm.ts).
 *  - Brakes: single-disc hydraulic brake per main wheel, master cylinders on the pilot's (and
 *    copilot's, interconnected) pedals; parking brake handle under the left panel.
 *  - Stall warning: pneumatic reed horn (inlet in the left wing leading edge), "audible
 *    warning at 5 to 10 knots above stall in all flight conditions" (POH Sec 7).
 *  - Rigging: the rudder has a ground-adjustable trim tab and the ailerons are rigged at the
 *    factory; the airplane flies ball-centred and wings-level hands-off in cruise
 *    (C172Rigging, constants from the FDM cruise balance in the performance tests).
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import { SURF } from '../../../core/vars';
import { LandingGear, Brakes } from '../../../systems/gear';
import { MechanicalFlightControls, TrimAxis, Flaps, NosewheelSteering, type TrimAxisConfig } from '../../../systems/flightcontrols';
import { StallWarning } from '../../../systems/warning';
import { FLAP_DETENTS } from '../data';
import { C172 } from '../vars';

/**
 * Factory rigging (surface-command units, pilot signs; the FDM's Cn_trim / Cl_trim equal the
 * rudder / aileron derivatives). Values = the rudder and aileron that centre the ball and hold
 * the wings level at 2400 rpm / 6000 ft cruise (POH Fig 5-8 condition), measured in
 * tests/aircraft/c172s-common (hand-flown averages of surf.aileron / surf.rudder ~0 at 2400 rpm,
 * 90-110 KCAS; the 75 KIAS climb then needs ~1.4 % right rudder, as in the airplane).
 */
export const RIGGING = {
  /** Ground-adjustable rudder tab (POH Sec 7 "Empennage": "ground adjustable trim tab at the base of the trailing edge"). */
  rudderTab: 0.019,
  /** Aileron rigging (EST, as the factory rigs the wings level against the engine torque in cruise). */
  aileron: 0.006,
} as const;

/** Stall-horn threshold on the FDM stall-proximity output: horn ~6-7 kt above the stall (POH: 5-10 kt). */
export const STALL_HORN_THRESHOLD = 0.4;

/** Flap motor rate (deg/s). EST: 0-30 deg in ~8.5 s (typical 172 electric flap travel time). */
export const FLAP_RATE_DPS = 3.5;

/** Constant factory rigging written every update (before the FDM reads surf.*_trim). */
export class C172Rigging implements Subsystem {
  readonly name = 'c172-rigging';
  constructor(private readonly vars: SimContext['vars']) {}
  update(): void {
    this.vars.set(SURF.rudderTrim, RIGGING.rudderTab);
    this.vars.set(SURF.aileronTrim, RIGGING.aileron);
  }
}

export interface C172FlightOptions {
  /** Autopilot / electric channels of the elevator trim (variant AFCS). */
  pitchTrim?: Pick<TrimAxisConfig, 'autopilot' | 'electric' | 'manual' | 'runawayDirection'>;
}

export interface C172FlightBlocks {
  gear: LandingGear;
  fcs: MechanicalFlightControls;
  rigging: C172Rigging;
  pitchTrim: TrimAxis;
  flaps: Flaps;
  steering: NosewheelSteering;
  brakes: Brakes;
  stall: StallWarning;
}

/** Trim wheel units: -1 = full nose DOWN (tab 22 deg up) .. +1 = full nose UP (tab 19 deg down). */
export const TRIM_RANGE: [number, number] = [-1, 1];

export function createC172Flight(ctx: Pick<SimContext, 'vars' | 'events' | 'audio'>, opts: C172FlightOptions = {}): C172FlightBlocks {
  const env = { vars: ctx.vars, events: ctx.events, audio: ctx.audio };
  const gear = new LandingGear(env, {
    retractable: false,
    legs: [
      { index: 0, extendS: 1, retractS: 1 },
      { index: 1, extendS: 1, retractS: 1 },
      { index: 2, extendS: 1, retractS: 1 },
    ],
    squat: { legs: [1, 2], mode: 'any', airToGroundS: 0.1, groundToAirS: 0.5 },
  });
  // Cable-and-pulley controls: the free play is a fraction of a degree at the surface (EST 0.2 %
  // of travel); the hardware stick/pedal deadzone is applied by the input layer, not here.
  const FREE_PLAY = 0.002;
  const fcs = new MechanicalFlightControls(env, {
    pitch: { input: 'ac.c172.fcs.pitch_in', deadband: FREE_PLAY },
    roll: { input: 'ac.c172.fcs.roll_in', deadband: FREE_PLAY },
    yaw: { input: 'ac.c172.fcs.yaw_in', pilotSensedVar: null, deadband: FREE_PLAY },
  });
  const pitchTrim = new TrimAxis(env, {
    axis: 'pitch',
    range: TRIM_RANGE,
    neutral: 0,
    positionVar: C172.trimPosition,
    ...opts.pitchTrim,
  });
  const flaps = new Flaps(env, {
    leverVar: C172.flapLever,
    detents: FLAP_DETENTS,
    normal: { power: 'elec.flap_motor_powered', rateDegPerS: FLAP_RATE_DPS },
  });
  const steering = new NosewheelSteering(env, {
    // Rudder pedals through the spring bungee, ~10 deg each side (POH Sec 7 "Ground control").
    pedals: { input: 'ac.c172.fcs.yaw_in', maxDeg: 10 },
    rateDegPerS: 40, // EST: direct mechanical linkage
  });
  const brakes = new Brakes(env, {
    // Master cylinders on the rudder pedals: no hydraulic source to lose (EST 1000 psi full pedal).
    sources: [{ id: 'master', pressurePsi: 1000, antiskid: false }],
    maxPsi: 1000,
    minSourcePsi: 0,
    parking: { var: C172.parkingBrake, kind: 'mechanical' },
    temperature: { heatCapacityJPerK: 2200, coolingTauS: 300 }, // EST: ~2.5 kg steel disc + caliper per side
  });
  const stall = new StallWarning(env, { kind: 'horn', hornThreshold: STALL_HORN_THRESHOLD, hornTone: 'stall_horn' });
  const rigging = new C172Rigging(ctx.vars);
  return { gear, fcs, rigging, pitchTrim, flaps, steering, brakes, stall };
}
