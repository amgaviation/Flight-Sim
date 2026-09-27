/**
 * Boeing 737-800 flight controls, landing gear, brakes and steering
 * (FCOM 9.20 "Flight controls", 14.20 "Landing gear"; B737ORG "Flight
 * Controls"). Hydraulic actuation per FCOM 13.20 (services table).
 *
 *  - Ailerons and elevator: dual PCUs (A and B) behind the FLT CONTROL A / B
 *    switches; manual reversion through balance tabs when both are lost
 *    (MechanicalFlightControls manualReversion, reduced authority, EST).
 *  - Rudder: main PCU (A and B) and the standby rudder PCU (standby system,
 *    STBY RUD). No manual reversion. Rudder pressure reducer: reduced
 *    authority above ~135 KIAS (EST schedule).
 *  - Stabilizer: two-speed main electric trim (control wheel switches,
 *    STAB TRIM MAIN ELECT cutout), autopilot trim (AUTO PILOT cutout),
 *    manual trim wheels (cable); column cutout switches stop main electric
 *    trim that opposes the column unless the STAB TRIM override switch is at
 *    OVERRIDE (FCOM 9.20). 0-17 units, green band per data.ts.
 *  - Aileron trim (two switches moved together) and rudder trim (knob).
 *  - Yaw damper (system B, FCC/SMYD): YAW DAMPER switch (held; trips off).
 *  - TE flaps (system B hydraulic motor; ALTERNATE FLAPS electric motor),
 *    load relief at flaps 30/40 (FCOM), LE flaps and slats (B, PTU backup,
 *    standby for alternate extension) with the auto-slat function in flaps 1-5.
 *  - Speedbrake: 4 flight spoilers + 2 ground spoilers per wing; flight
 *    spoilers assist roll; auto ground spoilers when ARMED (wheel spin-up /
 *    RA < 10 ft with ground mode) and RTO deployment above 60 kt (FCOM 9.20).
 *  - Landing gear: system A (landing gear transfer unit: B for retraction
 *    when engine 1 N2 is low), manual extension by free fall (FCOM 14.20).
 *  - Brakes: normal system B, alternate system A, accumulator (1,000 psi
 *    precharge, LIM), anti-skid, autobrake RTO / 1 / 2 / 3 / MAX
 *    (AUTOBRAKE_737NG), parking brake.
 *  - Nose wheel steering: system A (ALT = system B), tiller +/-78 deg,
 *    rudder pedals +/-7 deg (FCOM 14.20).
 */
import type { SimContext } from '../../../core/SimContext';
import { MechanicalFlightControls, TrimAxis, Flaps, Spoilers, NosewheelSteering, YawDamper } from '../../../systems/flightcontrols';
import { LandingGear, Brakes, AUTOBRAKE_737NG, gearHornRules } from '../../../systems/gear';
import { B738_FLAP_DETENTS, STAB } from '../data';
import { B738, GEAR_LEVER, SPEEDBRAKE } from '../vars';
import { POWER } from './electrical';
import { HYD_A, HYD_B, HYD_STBY } from './hydraulic';

const actA = `(${B738.fltCtl('a')} == 1 ? ${HYD_A} : 0)`;
const actB = `(${B738.fltCtl('b')} == 1 ? ${HYD_B} : 0)`;
const actStby = `(${B738.stbyRudder} * ${HYD_STBY})`;
export const THRUST_IDLE = `${B738.tla(1)} < 0.05 && ${B738.tla(2)} < 0.05`;
export const THRUST_ADVANCED = `${B738.tla(1)} > 0.3 || ${B738.tla(2)} > 0.3`;

export interface FlightControlBlocks {
  fcs: MechanicalFlightControls;
  stab: TrimAxis;
  aileronTrim: TrimAxis;
  rudderTrim: TrimAxis;
  yd: YawDamper;
  flaps: Flaps;
  spoilers: Spoilers;
  gear: LandingGear;
  brakes: Brakes;
  steering: NosewheelSteering;
}

export function createFlightControls(ctx: SimContext): FlightControlBlocks {
  const fcs = new MechanicalFlightControls(ctx, {
    pitch: { actuators: [actA, actB], rateLimit: 1.5 },
    roll: { actuators: [actA, actB], rateLimit: 2.0 },
    yaw: {
      actuators: [actA, actB, actStby],
      manualReversion: null,
      // Rudder pressure reducer / aerodynamic blow-down (EST): full authority to 135 KIAS, ~40 % at cruise speeds.
      authority: { x: [0, 135, 160, 250, 340], y: [1, 1, 0.7, 0.45, 0.35] },
    },
  });

  const stab = new TrimAxis(ctx, {
    axis: 'pitch',
    range: [STAB.minUnits, STAB.maxUnits],
    neutral: STAB.neutral,
    electric: {
      power: POWER.stabTrim,
      enable: `${B738.stabCutoutMain} != 0`,
      switchVars: ['input.pitch_trim_rate', B738.yokeTrim(1), B738.yokeTrim(2)],
      rate: STAB.mainElecUp,
      rateFlapsExtended: STAB.mainElecDn,
      limits: STAB.elecUpLimits,
      limitsFlapsExtended: STAB.elecDnLimits,
      // Column cutout (bypassed by STAB TRIM OVERRIDE): logic writes ac.b738.trim_column = 0 when overridden.
      columnCutout: { inputVar: 'ac.b738.trim_column', threshold: 0.25 },
    },
    autopilot: { enable: `${B738.stabCutoutAp} != 0`, power: `${POWER.fccA} || ${POWER.fccB}`, rate: STAB.apUp, rateFlapsExtended: STAB.apDn, limits: [0.05, 14.5] },
    manual: {},
    takeoffBand: STAB.greenBand,
    flapsVar: 'surf.flaps_deg',
    iasVar: 'adc1.ias_kt',
  });

  // Aileron trim: +/-15 units (EST indicator scale), rudder trim +/-16 units (EST), 0.5 unit/s (EST).
  const aileronTrim = new TrimAxis(ctx, {
    axis: 'roll',
    range: [-15, 15],
    neutral: 0,
    electric: { power: 'elec.dc1_powered', switchVars: ['ac.b738.ail_trim_cmd'], rate: 0.5 },
  });
  const rudderTrim = new TrimAxis(ctx, {
    axis: 'yaw',
    range: [-16, 16],
    neutral: 0,
    electric: { power: 'elec.dc_stby_powered || elec.dc1_powered', switchVars: [B738.rudTrim], rate: 0.5 },
  });

  const yd = new YawDamper(ctx, {
    engagedVar: B738.ydSw,
    // Main yaw damper: SMYD on DC, actuator on hydraulic system B with FLT CONTROL B ON (FCOM 9.20).
    power: `${POWER.yd} && hyd.b_psi > 1000 && ${B738.fltCtl('b')} == 1`,
    rateVar: 'ahrs1.r_dps',
    rateValid: 'ahrs1.att_valid',
    nyVar: 'ahrs1.ny_g',
    gain: { x: [100, 200, 300], y: [0.05, 0.03, 0.02] }, // EST rudder per deg/s
    nyGain: 0.3,
    authority: 0.1, // EST: yaw damper authority ~3 deg of rudder at cruise
  });

  const flaps = new Flaps(ctx, {
    leverVar: B738.flapLever,
    detents: B738_FLAP_DETENTS,
    // TE flap hydraulic drive (system B), ~40 s UP -> 40 (EST).
    normal: { power: HYD_B, rateDegPerS: 1.0 },
    // ALTERNATE FLAPS: electric motor, ~2 min UP -> 15 (FCOM 9.20), DOWN spring-loaded (hold), UP held.
    alternate: { active: `${B738.altFlapsArm} != 0`, switchVar: B738.altFlapsSw, followLever: false, rateDegPerS: 0.125, power: POWER.altFlaps },
    // FCOM 9.20 flap load relief (-800): 40 -> 30 at 163 KIAS (re-extend 158), 30 -> 25 at 176 (171).
    loadRelief: [
      { fromDeg: 40, toDeg: 30, retractKt: 163, reextendKt: 158 },
      { fromDeg: 30, toDeg: 25, retractKt: 176, reextendKt: 171 },
    ],
    asymmetryDeg: 5,
    slats: {
      // LE devices: flaps 1-5 = EXTEND (slats mid position), flaps 10+ = FULL EXTEND (FCOM 9.20).
      schedule: { x: [0, 0.5, 1, 5, 7.5, 10, 40], y: [0, 0, 0.5, 0.5, 0.5, 1, 1] },
      travelS: 6,
      power: `max(${HYD_B}, ${B738.altFlapsArm} * ${HYD_STBY})`,
      // Auto-slat: slats to FULL EXTEND near the stall warning with flaps 1-5 (FCOM 9.20).
      autoSlat: { condition: 'stall.aoa_norm > 0.8', flapsRange: [0.5, 5.5] },
    },
    iasVar: 'adc1.ias_kt',
  });

  const spA = `(${B738.spoilerSw('a')} != 0 ? ${HYD_A} : 0)`;
  const spB = `(${B738.spoilerSw('b')} != 0 ? ${HYD_B} : 0)`;
  const spoilers = new Spoilers(ctx, {
    leverVar: B738.speedbrake,
    armedValue: SPEEDBRAKE.armed,
    flightDetent: SPEEDBRAKE.flightDetent,
    speedbrake: 'spoilers',
    flightMax: 1,
    // Flight spoilers rise on the down-going wing beyond ~10 deg of control wheel (EST deadband).
    roll: { deadband: 0.12, gain: 1.2 },
    groundSpoilers: true,
    auto: { thrustIdle: THRUST_IDLE, thrustAdvanced: THRUST_ADVANCED, spinupKt: 60, raFt: 10, rto: { speedKt: 60 }, leverBackdrive: true },
    flightPower: `max(${spA}, ${spB})`,
    groundPower: spA,
    travelS: 1.2,
    extLight: { flapsAboveDeg: 10, raBelowFt: 800 },
  });

  const gear = new LandingGear(ctx, {
    legs: [
      // EST typical times 10 s extension / 8 s retraction (LIM gives the 17 / 14 s maintenance limits, alternate 19 s).
      { index: 0, name: 'Nose', extendS: 10, retractS: 8, freefallS: 19 },
      { index: 1, name: 'Left main', extendS: 10, retractS: 8, freefallS: 19 },
      { index: 2, name: 'Right main', extendS: 10, retractS: 8, freefallS: 19 },
    ],
    handleVar: B738.gearLever,
    handleOffValue: GEAR_LEVER.off,
    actuation: { power: `(${POWER.gearCtl} ? 1 : 0) * (${B738.gearXferUnit} ? ${HYD_B} : ${HYD_A})`, minPower: 0.3 },
    doors: { openS: 1.5, closeS: 1.5 },
    groundRetractInhibit: true,
    handleLock: { enabled: true, overrideVar: B738.gearLockOvrd },
    alternate: { kind: 'freefall', trigger: B738.gearManualExt },
    squat: { mode: 'any', airToGroundS: 0.1, groundToAirS: 0.5 },
    horn: {
      rules: gearHornRules({
        throttleRetarded: `${B738.tla(1)} < 0.1 || ${B738.tla(2)} < 0.1`,
        lowAltitude: 'ra1.valid && ra1.alt_ft < 800',
        approachFlapsDeg: 15,
        landingFlapsDeg: 25,
      }),
    },
    lights: { power: 'elec.dc_stby_powered || elec.dc1_powered', test: `${B738.lightsTest} >= 0.5` },
  });

  const brakes = new Brakes(ctx, {
    maxPsi: 3000,
    sources: [
      { id: 'normal', pressurePsi: 'hyd.b_psi', antiskid: true, autobrake: true },
      { id: 'alternate', pressurePsi: 'hyd.a_psi', antiskid: true },
    ],
    minSourcePsi: 1000,
    accumulator: { chargeFrom: 'hyd.b_psi', prechargePsi: 1000, maxPsi: 3000, applications: 6 },
    parking: { var: B738.parkBrake, kind: 'hydraulic' },
    antiskid: { enabled: POWER.antiskid },
    autobrake: {
      selectorVar: B738.autobrake,
      offValue: 0,
      levels: AUTOBRAKE_737NG,
      thrustIdle: THRUST_IDLE,
      thrustAdvanced: THRUST_ADVANCED,
      speedbrakeDown: `${B738.speedbrake} < 0.02`,
      pedalDisarm: 0.25,
      rtoSpeedKt: 90,
    },
    // Carbon brakes: ~300 kg of heat sink per wheel (EST) -> ~2 x 300 kg x 1,200 J/kgK per side.
    temperature: { heatCapacityJPerK: 7.2e5, coolingTauS: 2400 },
  });

  const steering = new NosewheelSteering(ctx, {
    tiller: { maxDeg: 78, input: B738.tillerCmd },
    pedals: { maxDeg: 7 },
    power: `${B738.nwsSw} != 0 ? ${HYD_A} : ${HYD_B}`,
    engage: 'gear.down_locked',
    rateDegPerS: 20,
  });

  return { fcs, stab, aileronTrim, rudderTrim, yd, flaps, spoilers, gear, brakes, steering };
}
