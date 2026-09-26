/**
 * Citation Longitude system composition: builds every subsystem in update
 * order (docs/modules/systems-power.md §0.2, systems-control.md §0.1) and the
 * Garmin G5000 suite. Kept free of Three.js so headless tests run the exact
 * code the app runs (docs/modules/qa.md §6).
 *
 * Order:
 *   failures -> LongitudeLogic -> electrical -> APU -> fuel -> hydraulics
 *   -> pneumatics -> pressurization -> ice -> fire -> oxygen
 *   -> sensors (ADC 1/2 + standby 3, AHRS 1/2 + standby 3, RA)
 *   -> landing gear -> G5000 suite (radio power, radios, FMS, G5000 system, GMC 710)
 *   -> thrust ratings -> AFCS -> autothrottle -> FADEC lever law -> engine starts
 *   -> yaw damper, stall warning/pusher -> flight controls, trims, flaps, spoilers,
 *      steering, brakes -> overspeed, altitude alert, TAWS, TCAS -> CAS -> disconnect aurals
 *   -> post logic -> lighting
 */
import type { SimContext } from '../../core/SimContext';
import type { Subsystem } from '../types';
import { FailureManager, type FailureDef } from '../../systems/failures';
import type { ElectricalNetwork } from '../../systems/electrical';
import type { FuelSystem } from '../../systems/fuel';
import type { HydraulicSystem } from '../../systems/hydraulic';
import type { PneumaticSystem } from '../../systems/pneumatic';
import type { Pressurization } from '../../systems/pressurization';
import type { IceProtection } from '../../systems/ice';
import type { Apu } from '../../systems/apu';
import type { FireProtection } from '../../systems/fire';
import type { OxygenSystem } from '../../systems/oxygen';
import { AirDataComputer, Ahrs, RadioAltimeter } from '../../systems/sensors';
import { LandingGear, Brakes } from '../../systems/gear';
import { Afcs, AFCS_GFC_G5000 } from '../../systems/autopilot';
import type { ThrustRatingComputer, ThrustLeverFadec, EngineStartController, Autothrottle } from '../../systems/fadec';
import { MechanicalFlightControls, TrimAxis, Flaps, Spoilers, NosewheelSteering, YawDamper } from '../../systems/flightcontrols';
import { StallWarning, Overspeed, AltitudeAlert, ALT_ALERT_GFC700, Taws, Tcas, CasManager, DisconnectAlerts } from '../../systems/warning';
import { LightingSystem } from '../../systems/lighting';
import { G3000Suite, G5000_LONGITUDE_LAYOUT, LONGITUDE_EIS } from '../../avionics/garmin-g3000';
import { CITATION_LONGITUDE_FDM } from './fdm';
import { FLAP_DETENTS, LON_LIMITS, VMO_SCHEDULE } from './data';
import { LON_VARS as V } from './vars';
import { createElectrical } from './systems/electrical';
import { createFuel } from './systems/fuel';
import { createHydraulics, hydFrac } from './systems/hydraulic';
import { createPneumatics, createPressurization, createIce, createApu, createFire, createOxygen } from './systems/environment';
import { createEngines } from './systems/engines';
import { LongitudeLogic, LongitudePostLogic, TLA } from './systems/logic';
import { LONGITUDE_CAS } from './systems/cas';
import { createLighting } from './systems/lighting';
import { LONGITUDE_TOLD } from './performance';
import { LONGITUDE_CHECKLISTS } from './checklists';

export interface LongitudeSystemsOptions {
  /** Headless: build the G5000 suite without canvases (tests). */
  noDisplays?: boolean;
  /** Omit the G5000 suite entirely (pure systems tests). */
  noAvionics?: boolean;
}

export interface LongitudeSystems {
  list: Subsystem[];
  failures: FailureManager;
  logic: LongitudeLogic;
  post: LongitudePostLogic;
  elec: ElectricalNetwork;
  fuel: FuelSystem;
  hyd: HydraulicSystem;
  pneu: PneumaticSystem;
  press: Pressurization;
  ice: IceProtection;
  apu: Apu;
  fire: FireProtection;
  oxy: OxygenSystem;
  adc: AirDataComputer[];
  ahrs: Ahrs[];
  ra: RadioAltimeter;
  gear: LandingGear;
  brakes: Brakes;
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
  at: Autothrottle;
  afcs: Afcs;
  yd: YawDamper;
  stall: StallWarning;
  fcs: MechanicalFlightControls;
  stab: TrimAxis;
  ailTrim: TrimAxis;
  rudTrim: TrimAxis;
  flaps: Flaps;
  spoilers: Spoilers;
  steering: NosewheelSteering;
  overspeed: Overspeed;
  taws: Taws;
  tcas: Tcas;
  cas: CasManager;
  lights: LightingSystem;
  suite: G3000Suite | null;
}

/** Stabilizer trim display units: degrees of stabilizer incidence (OG 17-3 chart: -7..0 deg with CG). */
export const STAB_RANGE: [number, number] = [-9, 1.5];
export const STAB_NEUTRAL = -3.5;
export const STAB_TO_BAND: [number, number] = [-7.5, -0.5];

export function createLongitudeSystems(ctx: SimContext, opts: LongitudeSystemsOptions = {}): LongitudeSystems {
  const failures = new FailureManager(ctx.vars, { events: ctx.events, seed: 700 });
  const logic = new LongitudeLogic(ctx.vars);
  const elec = createElectrical(ctx);
  const apu = createApu(ctx);
  const fuel = createFuel(ctx);
  const hyd = createHydraulics(ctx);
  const pneu = createPneumatics(ctx);
  const press = createPressurization(ctx);
  const ice = createIce(ctx);
  const fire = createFire(ctx);
  const oxy = createOxygen(ctx);

  // ---- sensors: dual GDC (G5000), dual AHRS (Litef LCR-100 per BCA), standby (ADC/AHRS 3), radio altimeter.
  const adc = [
    new AirDataComputer(ctx, { index: 1, power: 'elec.adc1_powered', pitotProbe: 1, staticPort: 1 }),
    new AirDataComputer(ctx, { index: 2, power: 'elec.adc2_powered', pitotProbe: 2, staticPort: 2 }),
    new AirDataComputer(ctx, { index: 3, power: 'elec.stby_inst_powered', pitotProbe: 1, staticPort: 1 }),
  ];
  const ahrs = [
    new Ahrs(ctx, { index: 1, power: 'elec.ahrs1_powered', alignS: 60 }), // EST: LCR-100 gyrocompassing align ~1 min on the ground
    new Ahrs(ctx, { index: 2, power: 'elec.ahrs2_powered', alignS: 60 }),
    new Ahrs(ctx, { index: 3, power: 'elec.stby_inst_powered', alignS: 90 }),
  ];
  const ra = new RadioAltimeter(ctx, { index: 1, power: 'elec.ra_powered' });

  // ---- landing gear: trailing link, hydraulic (system A, EST), electrically signalled (OG 14-2).
  const gear = new LandingGear(ctx, {
    legs: [
      { index: 0, name: 'Nose', extendS: 6, retractS: 6 }, // EST
      { index: 1, name: 'Left main', extendS: 7, retractS: 7 },
      { index: 2, name: 'Right main', extendS: 7, retractS: 7 },
    ],
    handleVar: V.gearHandle,
    actuation: { power: `${hydFrac('a')} * elec.gear_ctl_powered` },
    groundRetractInhibit: true,
    doors: { openS: 1.5, closeS: 1.5 },
    alternate: { kind: 'freefall', trigger: V.gearEmer },
    lights: { power: 'elec.emer_l_powered || elec.emer_r_powered' },
  });

  const tcas = new Tcas(ctx, { power: 'elec.tcas_powered' });

  // ---- G5000 (Garmin): three GDUs, four GTC 570, GMC 710 (OG 4-2, BCA).
  let suite: G3000Suite | null = null;
  if (!opts.noAvionics) {
    suite = new G3000Suite(
      ctx,
      {
        ...G5000_LONGITUDE_LAYOUT,
        aircraftId: 'citation-longitude',
        power: {
          pfd1: 'elec.pfd1_powered',
          mfd: 'elec.mfd_powered',
          pfd2: 'elec.pfd2_powered',
          gtc1: 'elec.gtc1_powered',
          gtc2: 'elec.gtc2_powered',
          gtc3: 'elec.gtc3_powered',
          gtc4: 'elec.gtc4_powered',
        },
        gmcPower: 'elec.gmc_powered',
        radioPower: { nav1: 'elec.gia1_powered', nav2: 'elec.gia2_powered', gps: 'elec.gia1_powered || elec.gia2_powered', marker: 'elec.gia1_powered' },
        eis: LONGITUDE_EIS,
        weights: { basicOperatingLb: LON_LIMITS.bowLb, maxRampLb: LON_LIMITS.maxRampLb, maxTakeoffLb: LON_LIMITS.mtowLb, maxLandingLb: LON_LIMITS.mlwLb, maxZeroFuelLb: LON_LIMITS.mzfwLb, paxLb: 200, maxPax: 12 },
        performance: LONGITUDE_TOLD,
        trafficSource: tcas,
        checklists: LONGITUDE_CHECKLISTS,
        speedTape: { vmoKt: LON_LIMITS.vmoKt, shakerNorm: 1.0, cautionNorm: 0.8, approachRefNorm: 0.66 }, // OG 4-6: amber 0.8-1.0, VAPP at 0.66
        // FPG p.15-19: 270 KIAS / M0.80 climb, M0.80-0.82 cruise, 3,000 fpm high-speed descent (EST 300 KIAS / M0.80).
        fmsOptions: { engineCount: 2, speeds: { climbKt: 270, climbMach: 0.8, cruiseKt: 300, cruiseMach: 0.82, descentKt: 300, descentMach: 0.8, approachKt: 140, machTransitionFt: 29000 } },
      },
      { noDisplays: opts.noDisplays },
    );
  }

  // ---- engines / FADEC / autothrottle
  const eng = createEngines(ctx);

  // ---- AFCS (G5000): no YD button (automatic yaw damping in the FBW rudder, OG 4-7/15-3).
  const afcs = new Afcs(ctx, {
    ...AFCS_GFC_G5000,
    power: 'elec.afcs_powered && elec.gmc_powered',
    servoPower: 'elec.afcs_powered',
    sensors: { valid: '(ahrs1.valid && adc1.valid)' },
    yawDamper: { withAp: false, requiredForAp: false },
    // OG 1-7: AP minimum engage 400 ft AGL after takeoff (engagement is the crew's job; enforced in the doc/checklist).
    gains: { gainRefKt: 250 },
  });
  const yd = new YawDamper(ctx, {
    engagedVar: 'ap.yd_engaged',
    power: `elec.rudder_ctl_powered && (${hydFrac('a')} > 0.5 || ${hydFrac('rss')} > 0.5)`,
    gain: { x: [100, 200, 300], y: [0.05, 0.03, 0.02] }, // EST rudder per deg/s
    nyGain: 0.3,
    authority: 0.2,
  });
  // Stick shaker and pusher (BCA). AoA gauge amber 0.8-1.0 (OG 4-6); shaker at 0.82 EST; pusher at 0.97 EST.
  const stall = new StallWarning(ctx, {
    kind: 'aoa',
    alphaStall: CITATION_LONGITUDE_FDM.aero.alphaStall_deg,
    shakerNorm: 0.82,
    pusher: { norm: 0.97, command: -0.35 },
    power: 'elec.stall_warn_powered',
  });

  // ---- primary flight controls: cable elevator/ailerons; FBW hydraulic rudder (A, RSS backup; no manual reversion).
  const fcs = new MechanicalFlightControls(ctx, {
    yaw: {
      actuators: [hydFrac('a'), hydFrac('rss')],
      manualReversion: null,
      // FBW "control scaling" (OG 15-1): rudder authority reduced with speed (EST limiter schedule).
      authority: { x: [0, 160, 250, 325], y: [1, 1, 0.55, 0.35] },
    },
  });
  const stab = new TrimAxis(ctx, {
    axis: 'pitch',
    range: STAB_RANGE,
    neutral: STAB_NEUTRAL,
    increasingPositive: false, // more negative stab incidence = nose up
    electric: {
      power: 'elec.emer_l_powered || elec.emer_r_powered',
      switchVars: [V.pitchTrimYoke, V.stabSecSw],
      rate: { x: [0, 150, 300], y: [0.5, 0.3, 0.15] }, // EST deg/s
    },
    autopilot: { power: 'elec.afcs_powered', rate: { x: [0, 150, 300], y: [0.3, 0.2, 0.1] } },
    manual: { enable: 0 },
    takeoffBand: STAB_TO_BAND,
    initial: -4.5,
  });
  const ailTrim = new TrimAxis(ctx, {
    axis: 'roll',
    range: [-1, 1],
    electric: { power: 'elec.emer_l_powered', switchVars: [V.ailTrimSw], rate: 0.12 },
    manual: { enable: 0 },
    takeoffBand: [-0.15, 0.15],
  });
  const rudTrim = new TrimAxis(ctx, {
    axis: 'yaw',
    range: [-1, 1],
    electric: { power: 'elec.emer_r_powered', switchVars: [V.rudTrimSw], rate: 0.12 },
    manual: { enable: 0 },
    takeoffBand: [-0.15, 0.15],
  });
  const flaps = new Flaps(ctx, {
    leverVar: V.flapLever,
    detents: FLAP_DETENTS,
    normal: { power: 'elec.flaps_powered', rateDegPerS: 2.4 }, // EST: ~15 s UP -> FULL
  });
  const spoilers = new Spoilers(ctx, {
    leverVar: V.sbCmd,
    flightDetent: 1,
    groundArm: V.gsArmed,
    speedbrake: 'spoilers',
    roll: { deadband: 0.08, gain: 1.1 },
    auto: {
      thrustIdle: V.idleBoth,
      // OG 15-4/15-5: retract below 30 kt or when the throttles leave idle.
      thrustAdvanced: `!${V.idleBoth} || max(gear.wheel_speed1_kt, gear.wheel_speed2_kt) < 30`,
      spinupKt: 35,
      raVar: 'ra1.alt_ft',
      raFt: -100, // no RA ground-mode backup: deployment needs wheel spin-up > 35 kt (OG 15-4)
      rto: { speedKt: 60 },
      leverBackdrive: false,
    },
    flightPower: `max(${hydFrac('a')}, ${hydFrac('b')})`,
    groundPower: `max(max(${hydFrac('a')}, ${hydFrac('b')}), ac.lon.gs_accum_ok >= 3)`,
    travelS: 1.5,
  });
  const steering = new NosewheelSteering(ctx, {
    tiller: { maxDeg: 81 }, // OG 14-3 / BCA 80-81 deg
    pedals: { maxDeg: 7.5 }, // BCA 7.5 deg
    power: `max(hyd.a_psi, hyd.b_psi) > 1000`,
    rateDegPerS: 30,
  });
  const brakes = new Brakes(ctx, {
    // Brake-by-wire (BCA), inboard on A / outboard on B (OG 14-2).
    sources: [
      { id: 'a', pressurePsi: 'elec.brake_ctl_powered ? hyd.a_psi : 0' },
      { id: 'b', pressurePsi: 'elec.brake_ctl_powered ? hyd.b_psi : 0' },
    ],
    maxPsi: 3000,
    minSourcePsi: 1000,
    accumulator: { chargeFrom: 'max(hyd.a_psi, hyd.b_psi)', prechargePsi: 1000, maxPsi: 3000, applications: 6 },
    parking: { var: V.parkBrake, kind: 'hydraulic' },
    antiskid: { enabled: 'elec.brake_ctl_powered' },
    temperature: { heatCapacityJPerK: 60000 }, // EST carbon heat-sink per side
  });

  // ---- alerting
  const overspeed = new Overspeed(ctx, { vmoKt: VMO_SCHEDULE, mmo: LON_LIMITS.mmo, vleKt: LON_LIMITS.vleKt, power: 'elec.emer_l_powered || elec.emer_r_powered' });
  const altAlert = new AltitudeAlert(ctx, ALT_ALERT_GFC700);
  const taws = new Taws(ctx, {
    class: 'A',
    power: 'elec.gia1_powered',
    flapsLanding: 'surf.flaps_deg >= 30',
    inhibits: { terrain: 'g3k.taws.inhibit_terr', gpws: 'g3k.taws.inhibit_gpws', flapOverride: 'g3k.taws.flap_ovrd' },
  });
  const cas = new CasManager(ctx, {
    messages: LONGITUDE_CAS,
    power: 'elec.emer_l_powered || elec.emer_r_powered',
    // OG 3-3/3-4: TOPI from 85 kt until 400 ft / 30 s airborne; LOPI below 400 ft RA until 50 kt.
    phase: { takeoffInhibit: { fromKt: 85, toFt: 400, maxAfterLiftoffS: 30 }, landingInhibit: { belowFt: 400, untilKt: 50 } },
    sinks: suite ? [suite.casModel] : [],
  });
  const disc = new DisconnectAlerts(ctx, { apToneMaxS: 2 });
  const post = new LongitudePostLogic(ctx.vars);
  const lights = createLighting(ctx);

  const list: Subsystem[] = [
    failures,
    logic,
    elec,
    apu,
    fuel,
    hyd,
    pneu,
    press,
    ice,
    fire,
    oxy,
    ...adc,
    ...ahrs,
    ra,
    gear,
    ...(suite ? suite.systems : []),
    eng.ratings,
    afcs,
    eng.at,
    eng.fadec,
    ...eng.starts,
    yd,
    stall,
    fcs,
    stab,
    ailTrim,
    rudTrim,
    flaps,
    spoilers,
    steering,
    brakes,
    overspeed,
    altAlert,
    taws,
    tcas,
    cas,
    disc,
    post,
    lights,
  ];
  // Failure catalogue for the pause menu.
  for (const s of list) {
    const f = (s as { failures?: () => FailureDef[] }).failures;
    if (s !== failures && typeof f === 'function') failures.register(f.call(s));
  }
  failures.register([
    { id: 'fire.eng1', name: 'Left engine fire', category: 'fire' },
    { id: 'fire.eng2', name: 'Right engine fire', category: 'fire' },
    { id: 'fire.apu', name: 'APU fire', category: 'fire' },
    { id: 'hyd.ptcu', name: 'PTCU failure', category: 'hydraulic' },
    { id: 'hyd.rss_pump', name: 'Rudder standby pump', category: 'hydraulic' },
    { id: 'hyd.a.overheat', name: 'Hydraulic A overheat', category: 'hydraulic' },
    { id: 'hyd.b.overheat', name: 'Hydraulic B overheat', category: 'hydraulic' },
    { id: 'elec.bus_tie', name: 'Bus tie contactor', category: 'electrical' },
    { id: 'ice.wshld_ctl', name: 'Windshield heat controller', category: 'ice' },
    { id: 'fuel.recirc_l', name: 'Left fuel recirculation pump', category: 'fuel' },
    { id: 'fuel.recirc_r', name: 'Right fuel recirculation pump', category: 'fuel' },
  ]);

  return {
    list,
    failures,
    logic,
    post,
    elec,
    fuel,
    hyd,
    pneu,
    press,
    ice,
    apu,
    fire,
    oxy,
    adc,
    ahrs,
    ra,
    gear,
    brakes,
    ratings: eng.ratings,
    fadec: eng.fadec,
    starts: eng.starts,
    at: eng.at,
    afcs,
    yd,
    stall,
    fcs,
    stab,
    ailTrim,
    rudTrim,
    flaps,
    spoilers,
    steering,
    overspeed,
    taws,
    tcas,
    cas,
    lights,
    suite,
  };
}

export { TLA };
