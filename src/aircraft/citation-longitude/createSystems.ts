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
import { LongitudeCockpitInputs } from './systems/cockpitInputs';
import { LongitudePitchRollDisconnect } from './systems/pitchRollDisconnect';
import { LONGITUDE_CAS } from './systems/cas';
import { createLighting } from './systems/lighting';
import { LONGITUDE_TOLD } from './performance';
import { LONGITUDE_CHECKLISTS } from './checklists';
import { LONGITUDE_SYNOPTICS } from './systems/synoptics';

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

/**
 * Pilot column / wheel gearing vs IAS (surface per unit input), EST. Without it the constant-authority surfaces
 * gave 3.7 g for 30 % column and 191 deg/s roll rate at 250 KIAS (check-ride pass, 2026-09).
 *  - Pitch: full authority to 130 KIAS (rotation, flare, stall recovery unchanged), then (130/V)^2, i.e. the
 *    full-column load-factor increment stays ~3.6 g (34,000 lb) and 10 % column is ~0.35 g at any higher speed.
 *  - Roll: full authority to 180 KIAS (full wheel ~40-50 deg/s at approach speeds, pb/2V ~0.11), then (180/V)^2:
 *    ~40 deg/s at 250 KIAS, ~30 deg/s at 320 KIAS at 15,000 ft (typical business-jet full-wheel rates).
 */
function blowdown(vFull: number): { x: number[]; y: number[] } {
  const x = [0, vFull, ...[160, 180, 200, 220, 250, 280, 310, 340, 400].filter((k) => k > vFull)];
  return { x, y: x.map((k) => (k <= vFull ? 1 : (vFull / k) ** 2)) };
}
export const PILOT_GEARING = { pitch: blowdown(130), roll: blowdown(180) };

/** Stabilizer trim display units: degrees of stabilizer incidence (OG 17-3 chart: -7..0 deg with CG). */
export const STAB_RANGE: [number, number] = [-9, 1.5];
export const STAB_NEUTRAL = -3.5;
export const STAB_TO_BAND: [number, number] = [-7.5, -0.5];

export function createLongitudeSystems(ctx: SimContext, opts: LongitudeSystemsOptions = {}): LongitudeSystems {
  const failures = new FailureManager(ctx.vars, { events: ctx.events, seed: 700 });
  const logic = new LongitudeLogic(ctx.vars);
  // 3D control-wheel switches and tiller (cockpit build): merged here before the trims and steering.
  const cockpitInputs = new LongitudeCockpitInputs(ctx.vars, ctx.events);
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
        synoptics: LONGITUDE_SYNOPTICS, // MFD synoptics + GTC system controls (lights, temperature, cabin pressure)
        speedTape: { vmoKt: LON_LIMITS.vmoKt, shakerNorm: 1.0, cautionNorm: 0.8, approachRefNorm: 0.66 }, // OG 4-6: amber 0.8-1.0, VAPP at 0.66
        // FPG p.15-19: 270 KIAS / M0.80 climb, M0.80-0.82 cruise, 3,000 fpm high-speed descent (EST 300 KIAS / M0.80).
        fmsOptions: { engineCount: 2, speeds: { climbKt: 270, climbMach: 0.8, cruiseKt: 300, cruiseMach: 0.82, descentKt: 300, descentMach: 0.8, approachKt: 140, machTransitionFt: 29000, speedLimitDecelFt: 3000 } },
      },
      { noDisplays: opts.noDisplays },
    );
    // Navigation-map terrain: Absolute (topographic) on the MFD and PFD inset maps, as the crew normally sets them
    // (G5000 map settings Off / Absolute / Relative), same as the M2. EST: the suite's TAWS default (Relative) paints
    // every map red on the ground (terrain within 100 ft of the aircraft); the TAWS pane stays Relative.
    for (const k of ['mfd1', 'mfd2', 'pfd1', 'pfd2', 'inset1', 'inset2'] as const) {
      const m = suite.system.maps[k];
      if (m) m.terrain = 'topo';
    }
  }

  // ---- engines / FADEC / autothrottle
  const eng = createEngines(ctx);

  // ---- AFCS (G5000): no YD button (automatic yaw damping in the FBW rudder, OG 4-7/15-3).
  const afcs = new Afcs(ctx, {
    ...AFCS_GFC_G5000,
    // G5000 CRG 190-02538-02 p.154-156: the VNAV key arms PATH, FLC and ALTV as the FMS profile requires (VNAV
    // climbs in VFLC at the FMS climb speed); the VNAV path mode is annunciated PATH on the G5000.
    vnavClimb: true,
    vnavSpeedFromSelected: true, // SPD knob FMS/MAN (OG 7-4): the G5000 copies the FMS speed into the selected speed
    altvBoundBySel: true, // VNAV never descends through the selected altitude (G5000 CRG: ALTS vs ALTV arming)
    labels: {
      ...AFCS_GFC_G5000.labels,
      vertical: { ...AFCS_GFC_G5000.labels.vertical, VPATH: 'PATH' },
      armedVertical: { ...AFCS_GFC_G5000.labels.armedVertical, VPATH: 'PATH' },
    },
    // The FD stays in TO on the takeoff roll; an armed FMS/LOC captures once airborne (EST: G5000 practice, the
    // CRG lists TO as "constant pitch angle on the ground"; capturing LNAV at brake release would drop the TO FMA).
    nav: { ...AFCS_GFC_G5000.nav, groundCapture: false },
    power: 'elec.afcs_powered && elec.gmc_powered',
    servoPower: 'elec.afcs_powered',
    sensors: { valid: '(ahrs1.valid && adc1.valid)' },
    yawDamper: { withAp: false, requiredForAp: false },
    // OG 1-7: AP minimum engage 400 ft AGL after takeoff (engagement is the crew's job; enforced in the doc/checklist).
    gains: { gainRefKt: 250 },
    // PITCH/ROLL DISCONNECT pulled: the AP disconnects and cannot be engaged (EST, systems/pitchRollDisconnect.ts).
    disconnect: { ...AFCS_GFC_G5000.disconnect, auto: `${V.pitchRollDisc} != 0`, engageInhibit: `${V.pitchRollDisc} != 0` },
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
    // AP/TRIM DISC held interrupts the pusher (EST, Citation-family function; systems/cockpitInputs.ts).
    pusher: { norm: 0.97, command: -0.35, enabled: `!${V.discHeld}` },
    power: 'elec.stall_warn_powered',
  });

  // ---- primary flight controls: cable elevator/ailerons; FBW hydraulic rudder (A, RSS backup; no manual reversion).
  const fcs = new MechanicalFlightControls(ctx, {
    // Cable elevator and ailerons (OG 15-2/15-3): the deflection a pilot can hold is force-limited (hinge moments
    // grow with dynamic pressure; elevator/aileron blow-down), so a spring-centred sim column/wheel maps to about
    // constant stick-force-per-g and roll rate above manoeuvring speed. See PILOT_GEARING (EST).
    pitch: { gearing: PILOT_GEARING.pitch },
    roll: { gearing: PILOT_GEARING.roll },
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
      // Keyboard/hardware trim, the 3D control-wheel trim switches (merged), the secondary stab trim switch.
      switchVars: [V.pitchTrimYoke, V.yokeTrimCmd, V.stabSecSw],
      enable: `!${V.discHeld}`, // AP/TRIM DISC held interrupts electric trim
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
    tiller: { maxDeg: 81, input: V.tillerCmd }, // OG 14-3 / BCA 80-81 deg; hardware axis or 3D handle (cockpitInputs)
    pedals: { maxDeg: 7.5 }, // BCA 7.5 deg
    power: `max(hyd.a_psi, hyd.b_psi) > 1000`,
    rateDegPerS: 30,
    // DGAC Longitude abnormal card: NOSEWHEEL STEERING MALFUNCTION - MASTER DISCONNECT button push and hold.
    engage: `!${V.discHeld}`,
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
    lampTest: V.lampTest, // overhead ANNUN TEST (same var as the library default, bound explicitly)
    // OG 3-3/3-4: TOPI from 85 kt until 400 ft / 30 s airborne; LOPI below 400 ft RA until 50 kt.
    phase: { takeoffInhibit: { fromKt: 85, toFt: 400, maxAfterLiftoffS: 30 }, landingInhibit: { belowFt: 400, untilKt: 50 } },
    sinks: suite ? [suite.casModel] : [],
  });
  const disc = new DisconnectAlerts(ctx, { apToneMaxS: 2 });
  const post = new LongitudePostLogic(ctx.vars);
  const prDisc = new LongitudePitchRollDisconnect(ctx.vars);
  const lights = createLighting(ctx);

  const list: Subsystem[] = [
    failures,
    logic,
    cockpitInputs,
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
    prDisc,
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
