/**
 * Citation M2 flight controls, landing gear, brakes and steering.
 *
 * S&D15 §9.1 / S&D21 §9.1: primary controls are mechanical (push rods, bell
 * cranks, sectors, stainless cables); trim tabs on the LH aileron, elevators
 * and rudder driven by pedestal trim wheels; the elevator trim also has an
 * electric actuator (yoke switches; the AFCS pitch-trim servo provides
 * electric trim and autopilot trim); yaw damper (not required for dispatch);
 * integral control lock. Flaps: handle detents 15, 35 and 60 (ground flaps,
 * lift dump, automatically deploy the speed brakes), any position 0-35 in
 * flight; speed brakes above and below each wing, any speed, auto retract
 * when either throttle is in a high-thrust position; flaps and speed brakes
 * electrically controlled, hydraulically actuated.
 * S&D15 §7: gear cycles in < 6 s, electrically controlled / hydraulically
 * actuated; emergency extension by manual uplock release (free fall) then
 * pneumatic blow-down; horn with the gear up below 130 KIAS and either
 * throttle below ~85 % N2; nose wheel steered mechanically by the pedals
 * +/-20 deg (95 deg castering for towing); multi-disc anti-skid brakes
 * (anti-skid above 12 kt) powered by the independent electric hydraulic
 * system, pneumatic emergency back-up.
 * TCDS §16 travel: elevator up 18.5 / down 15 deg; elevator trim tab up 12 /
 * down 20 deg; rudder +/-30 deg, rudder trim tab +/-20 deg; ailerons up 23.5
 * / down 20.5 deg, aileron trim tab up 20 / down 18 deg; flaps 0/15/35/60;
 * speed brakes upper 0-49 deg, lower 0-68 deg.
 */
import type { SimContext } from '../../../core/SimContext';
import { MechanicalFlightControls, TrimAxis, Flaps, Spoilers, NosewheelSteering, YawDamper } from '../../../systems/flightcontrols';
import { LandingGear, Brakes } from '../../../systems/gear';
import { FLAP_DETENTS } from '../data';
import { M2 } from '../vars';

/** Derived flap lever command after the 38-degree switch logic (written by M2Logic). */
export const M2_FLAP_LEVER_CMD = 'ac.m2.flap_lever_cmd';
/** Neither AP/TRIM DISC button held. */
export const TRIM_NOT_INTERRUPTED = `!${M2.apTrimDisc(1)} && !${M2.apTrimDisc(2)}`;

const HYD_MAIN = 'clamp01(hyd.main_psi / 1200)';

/** Pitch trim takeoff band (normalized units). EST: bracket of the computed takeoff trims for the certified CG range (tests). */
export const PITCH_TRIM_TO_BAND: [number, number] = [0.05, 0.55];

export interface FlightControlBlocks {
  fcs: MechanicalFlightControls;
  pitchTrim: TrimAxis;
  aileronTrim: TrimAxis;
  rudderTrim: TrimAxis;
  flaps: Flaps;
  speedbrakes: Spoilers;
  yd: YawDamper;
  steering: NosewheelSteering;
  gear: LandingGear;
  brakes: Brakes;
}

export function createFlightControls(ctx: SimContext): FlightControlBlocks {
  const fcs = new MechanicalFlightControls(ctx, {
    // Mechanical cables: no actuators; the control lock jams all three axes (fail vars written by M2Logic).
    pitch: { rateLimit: 3 },
    roll: { rateLimit: 3 },
    yaw: { rateLimit: 3 },
  });
  const pitchTrim = new TrimAxis(ctx, {
    axis: 'pitch',
    range: [-1, 1],
    positionVar: M2.pitchTrim,
    initial: 0.25,
    electric: {
      power: 'elec.trim_pitch_powered',
      // AP/TRIM DISC held interrupts the electric trim (525AFM-06 p.3-89.1 before-taxi check; runaway procedure).
      enable: TRIM_NOT_INTERRUPTED,
      // Yoke split switches after the arm/direction and pilot-priority logic (M2Logic), plus the keyboard trim input.
      switchVars: ['input.pitch_trim_rate', M2.yokeTrimCmd],
      // EST: full travel ~20 s at low speed, ~40 s at high speed (speed-scheduled trim rate).
      rate: { x: [100, 200, 260], y: [0.1, 0.06, 0.045] },
    },
    autopilot: { power: 'elec.ap_servos_powered', enable: TRIM_NOT_INTERRUPTED, rate: { x: [100, 260], y: [0.06, 0.03] } },
    takeoffBand: PITCH_TRIM_TO_BAND,
  });
  const aileronTrim = new TrimAxis(ctx, { axis: 'roll', range: [-1, 1], positionVar: M2.aileronTrim });
  const rudderTrim = new TrimAxis(ctx, { axis: 'yaw', range: [-1, 1], positionVar: M2.rudderTrim });
  const flaps = new Flaps(ctx, {
    // Handle through the 38-degree switch logic (M2Logic: flap_lever_cmd); follow-up handle 0-35 (S&D15 §9.1).
    leverVar: M2_FLAP_LEVER_CMD,
    continuous: true,
    detents: FLAP_DETENTS.map((d) => ({ ...d })),
    // Electrically controlled (EMER bus flap control), hydraulically actuated; EST ~10 s 0 -> 35.
    normal: { power: `${HYD_MAIN} * elec.flap_ctl_powered`, rateDegPerS: 3.5 },
  });
  const speedbrakes = new Spoilers(ctx, {
    leverVar: M2.sbCommand,
    flightDetent: 1,
    speedbrake: 'panels',
    groundSpoilers: false,
    travelS: 2, // EST
    flightPower: `${HYD_MAIN} * elec.spd_brk_powered`, // SPEED BRAKE breaker (525AFM-06 p.3-102)
  });
  const yd = new YawDamper(ctx, {
    power: 'elec.ap_servos_powered',
    gain: { x: [100, 200, 260], y: [0.035, 0.025, 0.018] }, // EST, tuned on the M2 FDM
    nyGain: 0.3,
    authority: 0.15,
  });
  const steering = new NosewheelSteering(ctx, {
    pedals: { maxDeg: 20 }, // S&D15 §7: mechanical, +/-20 deg
    rateDegPerS: 60,
  });
  const gear = new LandingGear(ctx, {
    legs: [
      { index: 0, name: 'Nose', extendS: 5, retractS: 5 },
      { index: 1, name: 'Left main', extendS: 5.5, retractS: 5.5 },
      { index: 2, name: 'Right main', extendS: 5.5, retractS: 5.5 },
    ], // S&D15 §7: "less than 6 seconds to cycle"
    handleVar: M2.gearHandle,
    actuation: { power: `${HYD_MAIN} * elec.gear_ctl_powered` },
    doors: { openS: 0.6, closeS: 0.6 },
    groundRetractInhibit: true,
    // 525AFM-06 p.3-103: the T-handle releases the uplocks (free fall); "After the T handle has been pulled the round
    // collar handle can be pulled to discharge the nitrogen blow down system" (blow-down only after the T-handle).
    alternate: { kind: 'blowdown', trigger: `${M2.gearBlowdown} && ${M2.gearEmerRelease}`, freefallTrigger: M2.gearEmerRelease, blowdownS: 4 },
    horn: {
      // SYSTEM TESTS LDG GEAR: lights and horn (EST, CJ-family rotary test), not silenceable.
      test: `${M2.testSel} == 5`,
      rules: [
        // 525AFM-06 p.3-103: gear up, "Airspeed below 130 KIAS (copilot's indicator)" and either throttle below ~85 % N2
        // (silenceable); ADC 1 when ADC 2 is invalid.
        { when: 'gear.air_ground == 0 && (adc2.valid ? adc2.ias_kt : adc1.ias_kt) < 130 && (eng1.n2_pct < 85 || eng2.n2_pct < 85)', silenceable: true, label: 'THROTTLE' },
        // Flaps beyond the approach setting with the gear up: cannot be silenced (CJ family, EST).
        { when: 'gear.air_ground == 0 && surf.flaps_deg > 17', silenceable: false, label: 'FLAPS' },
      ],
    },
    lights: { power: 'elec.gear_ctl_powered', test: `${M2.testSel} == 5 || ${M2.testSel} == 2` },
  });
  const brakes = new Brakes(ctx, {
    sources: [{ id: 'power_brake', pressurePsi: 'hyd.brk_psi' }],
    maxPsi: 1400, // EST metered brake pressure
    minSourcePsi: 900,
    accumulator: { chargeFrom: 'hyd.brk_psi', prechargePsi: 650, maxPsi: 1500 },
    // S&D15 §7: anti-skid above 12 kt; inoperative until its power-up self-test has passed (M2Logic, 525AFM-06 p.3-90).
    antiskid: { enabled: `${M2.antiskidSw} && elec.antiskid_powered && !ac.m2.antiskid_test && !ac.m2.antiskid_fail`, minSpeedKt: 12 },
    parking: { var: M2.parkBrake, kind: 'hydraulic' },
    // Pneumatic back-up (S&D21 §7.3) from a finite bottle (EST charge / consumption, M2Logic).
    emergency: { var: M2.emerBrake, pressurePsi: `min(1100, ${M2.emerBrakeBottlePsi})` },
    temperature: { heatCapacityJPerK: 9000 },
  });
  return { fcs, pitchTrim, aileronTrim, rudderTrim, flaps, speedbrakes, yd, steering, gear, brakes };
}
