/**
 * Gulfstream G800 system composition: every subsystem in update order
 * (docs/modules/systems-power.md §0.2, systems-control.md §0.1) plus the
 * Honeywell Symmetry (Primus Epic) suite, radios and FMS. Kept free of Three.js
 * so the headless tests run the exact code the app runs (docs/modules/qa.md §6).
 * The cockpit agent maps `sys.suite` displays onto the cockpit meshes.
 *
 * Order:
 *   failures -> G800Logic -> electrical -> APU -> fuel -> hydraulics -> pneumatics
 *   -> pressurization -> ice -> fire -> oxygen
 *   -> sensors (ADC 1/2/3, IRS 1/2/3, RA 1/2) -> landing gear
 *   -> radios -> FMS -> Epic suite (GP, controllers, touch screens, CAS presentation)
 *   -> thrust ratings -> AFCS -> autothrottle -> FADEC lever law -> engine starts
 *   -> stall warning -> fly-by-wire, roll/yaw trim, flaps, spoilers, steering, brakes
 *   -> overspeed, altitude alert, TAWS, TCAS, takeoff config -> CAS -> disconnect aurals
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
import { AirDataComputer, Irs, RadioAltimeter } from '../../systems/sensors';
import { LandingGear, Brakes } from '../../systems/gear';
import { Afcs, AFCS_PRIMUS_EPIC } from '../../systems/autopilot';
import type { ThrustRatingComputer, ThrustLeverFadec, EngineStartController, Autothrottle } from '../../systems/fadec';
import { FlyByWire, TrimAxis, Flaps, Spoilers, NosewheelSteering } from '../../systems/flightcontrols';
import { StallWarning, Overspeed, AltitudeAlert, ALT_ALERT_GFC700, Taws, Tcas, TakeoffConfigWarning, CasManager, DisconnectAlerts } from '../../systems/warning';
import type { LightingSystem } from '../../systems/lighting';
import { Radios } from '../../nav/Radios';
import { Fms } from '../../nav/fms/Fms';
import { createEpicSuite, type EpicSuite, type EpicSuiteHost } from '../../avionics/honeywell-epic/suite';
import { G800_AIRFRAME, PEARL700_ENGINES, DEFAULT_ENGINE_VARS } from '../../avionics/honeywell-epic/config';
import { G800_FDM } from './fdm';
import { FLAP_DETENTS, G800_LIMITS, VMO_SCHEDULE } from './data';
import { G800_VARS as V } from './vars';
import { createElectrical } from './systems/electrical';
import { createFuel } from './systems/fuel';
import { createHydraulics, hydFrac } from './systems/hydraulic';
import { createPneumatics, createPressurization, createIce, createApu, createFire, createOxygen } from './systems/environment';
import { createEngines } from './systems/engines';
import { G800Logic, G800PostLogic } from './systems/logic';
import { G800_CAS } from './systems/cas';
import { createLighting } from './systems/lighting';
import { G800_CHECKLISTS } from './checklists';

export interface G800SystemsOptions {
  /** Omit radios, FMS and the Epic suite (pure systems tests without a navigation database). */
  noAvionics?: boolean;
  /** Canvas factory for the Epic displays (headless tests pass a fake canvas). */
  canvas?: EpicSuiteHost['canvas'];
}

export interface G800Systems {
  list: Subsystem[];
  failures: FailureManager;
  logic: G800Logic;
  post: G800PostLogic;
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
  irs: Irs[];
  ra: RadioAltimeter[];
  gear: LandingGear;
  brakes: Brakes;
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
  at: Autothrottle;
  afcs: Afcs;
  stall: StallWarning;
  fbw: FlyByWire;
  rollTrim: TrimAxis;
  yawTrim: TrimAxis;
  flaps: Flaps;
  spoilers: Spoilers;
  steering: NosewheelSteering;
  overspeed: Overspeed;
  taws: Taws;
  tcas: Tcas;
  tocw: TakeoffConfigWarning;
  cas: CasManager;
  lights: LightingSystem;
  radios: Radios | null;
  fms: Fms | null;
  suite: EpicSuite | null;
}

/** IRS mode selector var: the G800 IRUs have no mode knobs (automatic NAV alignment at power-up, CAS "IRS 1-2-3 Aligning"). */
export const IRS_MODE_VAR = 'ac.g800.irs_mode';

/** FBW max AoA vs flaps: full aft stick commands 0.92 normalized AoA (SCQ flight controls "AOA limiting ... 0.92"). */
export const ALPHA_MAX = { x: G800_FDM.aero.alphaStall_deg.x, y: G800_FDM.aero.alphaStall_deg.y.map((a) => Math.round(0.9 * a * 100) / 100) };

export function createG800Systems(ctx: SimContext, opts: G800SystemsOptions = {}): G800Systems {
  const failures = new FailureManager(ctx.vars, { events: ctx.events, seed: 800 });
  const logic = new G800Logic(ctx.vars);
  const elec = createElectrical(ctx);
  const apu = createApu(ctx);
  const fuel = createFuel(ctx);
  const hyd = createHydraulics(ctx);
  const pneu = createPneumatics(ctx);
  const press = createPressurization(ctx);
  const ice = createIce(ctx);
  const fire = createFire(ctx);
  const oxy = createOxygen(ctx);

  // ---- sensors: three air data (ADS 1/2 + standby 3) and three IRUs (GVI: ADS1&2, ADS3; IRS alignment to 78 deg latitude)
  const adc = [1, 2, 3].map((s) => new AirDataComputer(ctx, { index: s, power: `elec.adc${s}_powered`, pitotProbe: s, staticPort: s === 3 ? 1 : s, trendS: 10 }));
  const irs = [1, 2, 3].map((s) => new Irs(ctx, { index: s, power: `elec.irs${s}_powered`, modeVar: IRS_MODE_VAR, gpsAutoPosition: true, gpsUpdating: true }));
  const ra = [1, 2].map((s) => new RadioAltimeter(ctx, { index: s, power: `elec.ra${s}_powered` }));

  // ---- landing gear (SCQ landing gear): electrically controlled, hydraulically actuated (left system), nitrogen
  // blowdown emergency extension (one shot, cannot retract), gear warning horn rules (GVI).
  const lowAgl = `ra1.valid && ra1.alt_ft < ${G800_LIMITS.gearHornAglFt}`;
  const gear = new LandingGear(ctx, {
    legs: [
      { index: 0, name: 'Nose', extendS: 7, retractS: 7 }, // EST
      { index: 1, name: 'Left main', extendS: 9, retractS: 8 },
      { index: 2, name: 'Right main', extendS: 9, retractS: 8 },
    ],
    handleVar: V.gearHandle,
    actuation: { power: `${hydFrac('left')} * elec.gear_ctl_powered` },
    groundRetractInhibit: true,
    handleLock: { overrideVar: V.gearLockRel },
    doors: { openS: 2, closeS: 2 },
    alternate: { kind: 'blowdown', trigger: V.gearAlt, blowdownS: 12 },
    horn: {
      rules: [
        { when: `${V.idleBoth} && ${lowAgl} && surf.flaps_deg < ${G800_LIMITS.gearHornFlapsDeg}`, silenceable: true }, // GVI: HORN SILENCE mutes
        { when: `surf.flaps_deg > ${G800_LIMITS.gearHornFlapsDeg}`, silenceable: false }, // GVI: cannot be muted
      ],
    },
    lights: { power: 'elec.gear_ctl_powered' },
  });

  const tcas = new Tcas(ctx, { power: 'elec.tcas_powered' });

  // ---- radios / FMS / Symmetry suite
  let radios: Radios | null = null;
  let fms: Fms | null = null;
  let suite: EpicSuite | null = null;
  if (!opts.noAvionics) {
    radios = new Radios(ctx, { navCount: 2, adfCount: 1 });
    // Honeywell MOD / ACTIVATE = Boeing MOD / EXEC style. Speeds: GAC LRC M0.85 / HSC M0.90 (EST climb/descent IAS).
    fms = new Fms(ctx, { style: 'boeing', engineCount: 2, bankLimitDeg: 27, speeds: { climbKt: 290, climbMach: 0.85, cruiseKt: 300, cruiseMach: 0.85, descentKt: 300, descentMach: 0.85, approachKt: 140, machTransitionFt: 31000 } });
    suite = createEpicSuite(
      { vars: ctx.vars, events: ctx.events, nav: ctx.nav, world: ctx.world, fms, canvas: opts.canvas },
      {
        variant: 'symmetry',
        airframe: G800_AIRFRAME,
        // Engine display: TRS rating bug = selected rating N1 limit (fadec.n1_limit_pct).
        engines: { ...PEARL700_ENGINES, vars: { ...DEFAULT_ENGINE_VARS, target: () => 'fadec.n1_limit_pct' } },
        power: {
          du: ['elec.du1_powered', 'elec.du2_powered', 'elec.du3_powered', 'elec.du4_powered'],
          standby: ['elec.sfd1_powered', 'elec.sfd2_powered'],
          tsc: ['elec.tsc1_powered', 'elec.tsc2_powered', 'elec.tsc3_powered', 'elec.tsc4_powered'],
          ohpts: ['elec.ohpts1_powered', 'elec.ohpts2_powered', 'elec.ohpts3_powered'],
          gp: 'elec.gp_powered || elec.gp_r_powered',
          ccd: ['elec.ccd1_powered', 'elec.ccd2_powered'],
        },
        checklists: G800_CHECKLISTS,
        synopticBindings: { 'bleed.l.psi': 'pneu.l_man_psi', 'bleed.r.psi': 'pneu.r_man_psi' },
        // GVI: no EDP switches (SCQ hydraulics); auto refuel is on the refuel panel, not the overhead.
        overheadVars: { 'hyd.edp_l': null, 'hyd.edp_r': null, 'fuel.auto_refuel': null },
      },
    );
  }

  // ---- engines / FADEC / autothrottle
  const eng = createEngines(ctx);

  // ---- AFCS (Primus Epic, GP-700): commands the FBW through ap.servo_* (stick equivalents). No yaw damper
  // button function (yaw damping is in the FBW laws).
  const afcs = new Afcs(ctx, {
    ...AFCS_PRIMUS_EPIC,
    power: 'elec.afcs_powered',
    servoPower: 'elec.afcs_powered && (elec.fcc_powered || elec.bfcu_powered)',
    sensors: { valid: 'ahrs1.valid && adc1.valid' },
    yawDamper: { withAp: false, requiredForAp: false },
    gains: { gainRefKt: 250, pitchKp: 0.035, pitchKi: 0.01, pitchKq: 0.02, rollKp: 0.05, rollKi: 0.005, rollKp_rate: 0.04 },
  });

  // ---- stall warning: stick shaker before the FBW AoA limit (SCQ: "during an approaching stall, before the
  // maximum AOA is exceeded"); EST shaker at 0.85 normalized AoA (limit 0.92). No pusher (FBW AoA limiting).
  const stall = new StallWarning(ctx, { kind: 'aoa', alphaStall: G800_FDM.aero.alphaStall_deg, shakerNorm: 0.85, power: 'elec.stall_warn_powered' });

  // ---- fly-by-wire (two dual-channel FCCs + BFCU, SCQ; four modes normal/alternate/direct/backup, BJT500).
  // Actuators: left and right hydraulics on every surface + EBHAs on the rudder, ailerons, elevators (SCQ).
  const ebha = 'clamp01(elec.emer_dc_v / 24) * 0.6'; // EST: electric backup at reduced rate
  const fbw = new FlyByWire(ctx, {
    power: 'elec.fcc_powered || elec.bfcu_powered',
    actuators: { pitch: [hydFrac('left'), hydFrac('right'), ebha], roll: [hydFrac('left'), hydFrac('right'), ebha], yaw: [hydFrac('left'), hydFrac('right'), ebha] },
    airDataValid: 'adc1.valid',
    inertialValid: 'ahrs1.att_valid',
    pitch: {
      alphaMax: ALPHA_MAX,
      vmoKt: VMO_SCHEDULE,
      mmo: G800_LIMITS.mmo,
      nzMax: { x: [0, 1], y: [G800_LIMITS.nzMaxClean, G800_LIMITS.nzMaxFlaps] },
      nzMin: { x: [0, 1], y: [G800_LIMITS.nzMinClean, G800_LIMITS.nzMinFlaps] },
      stabUnits: [-1, 1],
      // EST: firm AoA limiting (full aft stick holds ~alphaMax without overshoot at idle deceleration).
      alphaLimitGain: 0.8,
      alphaLimitRateGain: 0,
    },
    roll: { maxRateDps: 15, bankHoldDeg: 33, maxBankDeg: 67 },
    trimSwitchVars: [V.ssTrim(1), V.ssTrim(2)],
    speedSync: 'input.ap_disc && !ap.engaged',
    addVars: { yaw: [V.eldac] },
  });
  // Roll and rudder trim (pedestal switches; the FCCs apply them, SCQ ROLL MOTOR CONTROL / AUTO CENTER).
  const rollTrim = new TrimAxis(ctx, { axis: 'roll', range: [-1, 1], electric: { power: 'elec.trim_ctl_powered', switchVars: [V.rollTrimSw], rate: 0.1 }, manual: { enable: 0 }, takeoffBand: [-0.2, 0.2] });
  const yawTrim = new TrimAxis(ctx, { axis: 'yaw', range: [-1, 1], electric: { power: 'elec.trim_ctl_powered', switchVars: [V.yawTrimSw, 'ac.g800.yaw_trim_auto'], rate: 0.1 }, manual: { enable: 0 }, takeoffBand: [-0.2, 0.2] });
  const flaps = new Flaps(ctx, {
    leverVar: V.flapLever,
    detents: FLAP_DETENTS,
    normal: { power: `${hydFrac('left')} * elec.flap_ctl_powered`, rateDegPerS: 2.0 }, // EST ~20 s UP -> 39
  });
  // Six panels per wing side group: speed brakes 30 deg in flight, 55 deg on the ground (SCQ); ground spoilers deploy
  // when ARMED with idle power and wheel spin-up > 47 kt or weight on wheels (SCQ); retract when a throttle advances.
  const spoilers = new Spoilers(ctx, {
    leverVar: V.speedbrake,
    flightDetent: 1,
    groundArm: V.gndSplrArm,
    speedbrake: 'spoilers',
    flightMax: 30 / 55,
    roll: { deadband: 0.1, gain: 1.0 },
    auto: {
      thrustIdle: V.idleBoth,
      thrustAdvanced: `!${V.idleBoth}`,
      spinupKt: 47,
      groundMode: 'gear.air_ground',
      raVar: 'ra1.alt_ft',
      raFt: 10,
      rto: { speedKt: 60 },
      leverBackdrive: false,
    },
    flightPower: `max(${hydFrac('left')}, ${hydFrac('right')})`,
    groundPower: `max(${hydFrac('left')}, ${hydFrac('right')})`,
    travelS: 1.5,
  });
  // Steer-by-wire: tiller (left seat) +/-80 deg EST; pedals +/-7 deg (FSB App. 4); left hydraulics.
  const steering = new NosewheelSteering(ctx, {
    tiller: { input: V.steerCmd, maxDeg: G800_LIMITS.tillerSteerDeg },
    pedals: { maxDeg: G800_LIMITS.pedalSteerDeg },
    power: 'elec.nws_ctl_powered && hyd.left_psi > 1000',
    engage: `${V.nwsSw} == 1`,
    rateDegPerS: 30,
  });
  // Brake-by-wire (FSB), carbon brakes: inboard on the left system, outboard on the right (EST split); parking brake
  // from the accumulators (SCQ); anti-skid unavailable below 15 kt (SCQ); autobrake LOW / MED / HIGH + RTO.
  const brakes = new Brakes(ctx, {
    sources: [
      { id: 'inboard', pressurePsi: 'elec.brake_ctl_l_powered ? hyd.left_psi : 0' },
      { id: 'outboard', pressurePsi: 'elec.brake_ctl_r_powered ? hyd.right_psi : 0' },
    ],
    maxPsi: 3000,
    minSourcePsi: 1000,
    accumulator: { chargeFrom: 'hyd.left_psi', prechargePsi: G800_LIMITS.accumPrechargePsi, maxPsi: 3000, applications: 6 },
    parking: { var: V.parkBrake, kind: 'hydraulic' },
    antiskid: { enabled: 'elec.brake_ctl_l_powered || elec.brake_ctl_r_powered', minSpeedKt: G800_LIMITS.antiskidMinKt },
    autobrake: {
      selectorVar: V.autobrake,
      offValue: 0,
      levels: [
        { value: -1, label: 'RTO', rto: true },
        { value: 1, label: 'LOW', decelFps2: 4 }, // EST
        { value: 2, label: 'MED', decelFps2: 6.5 }, // EST
        { value: 3, label: 'HIGH', decelFps2: 9 }, // EST
      ],
      thrustIdle: V.idleBoth,
      thrustAdvanced: `!${V.idleBoth}`,
      speedbrakeDown: `${V.speedbrake} < 0.02`,
      pedalDisarm: 0.25,
      rtoSpeedKt: 60,
      spinupKt: 60,
    },
    temperature: { heatCapacityJPerK: 90000 }, // EST carbon heat sink per side
  });

  // ---- alerting
  const essPower = 'elec.l_ess_dc_powered || elec.r_ess_dc_powered';
  const overspeed = new Overspeed(ctx, { vmoKt: VMO_SCHEDULE, mmo: G800_LIMITS.mmo, vleKt: G800_LIMITS.vleKt, power: essPower });
  const altAlert = new AltitudeAlert(ctx, { ...ALT_ALERT_GFC700, power: essPower }); // EST: 1,000 / 200 / 200 ft bands
  const taws = new Taws(ctx, { class: 'A', power: 'elec.egpws_powered', flapsLanding: 'surf.flaps_deg >= 35', flapsDown: 'surf.flaps_deg >= 9' });
  const tocw = new TakeoffConfigWarning(ctx, {
    armed: `${V.toThrust} && gear.air_ground`,
    power: essPower,
    checks: [
      { id: 'flaps', bad: '!((surf.flaps_deg > 9 && surf.flaps_deg < 11) || (surf.flaps_deg > 19 && surf.flaps_deg < 21))', text: 'FLAPS', voice: 'Flaps' },
      { id: 'trim', bad: 'trim.pitch_units < -0.2 || trim.pitch_units > 0.35', text: 'STAB TRIM', voice: 'Trim' },
      { id: 'speedbrake', bad: `${V.speedbrake} > 0.05`, text: 'SPEED BRAKE', voice: 'Speed brake' },
      { id: 'park', bad: 'brakes.parking_set', text: 'PARKING BRAKE', voice: 'Parking brake' },
      { id: 'fcs', bad: 'fbw.mode_code != 0', text: 'FLIGHT CONTROLS', voice: 'Flight controls' },
    ],
  });
  const cas = new CasManager(ctx, {
    messages: G800_CAS,
    power: 'elec.cas_l_powered || elec.cas_r_powered',
    sinks: suite ? [suite.cas.model] : [],
  });
  const disc = new DisconnectAlerts(ctx, {});
  const post = new G800PostLogic(ctx.vars);
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
    ...irs,
    ...ra,
    gear,
    ...(radios ? [radios] : []),
    ...(fms ? [fms] : []),
    ...(suite ? [suite.system] : []),
    eng.ratings,
    afcs,
    eng.at,
    eng.fadec,
    ...eng.starts,
    stall,
    fbw,
    rollTrim,
    yawTrim,
    flaps,
    spoilers,
    steering,
    brakes,
    overspeed,
    altAlert,
    taws,
    tcas,
    tocw,
    cas,
    disc,
    post,
    lights,
  ];
  for (const s of list) {
    const f = (s as { failures?: () => FailureDef[] }).failures;
    if (s !== failures && typeof f === 'function') failures.register(f.call(s));
  }
  failures.register([
    { id: 'fire.eng1', name: 'Left engine fire', category: 'fire' },
    { id: 'fire.eng2', name: 'Right engine fire', category: 'fire' },
    { id: 'fire.apu', name: 'APU fire', category: 'fire' },
    { id: 'fire.baggage', name: 'Aft baggage smoke', category: 'fire' },
    { id: 'elec.ac_tie', name: 'AC bus tie contactor', category: 'electrical' },
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
    irs,
    ra,
    gear,
    brakes,
    ratings: eng.ratings,
    fadec: eng.fadec,
    starts: eng.starts,
    at: eng.at,
    afcs,
    stall,
    fbw,
    rollTrim,
    yawTrim,
    flaps,
    spoilers,
    steering,
    overspeed,
    taws,
    tcas,
    tocw,
    cas,
    lights,
    radios,
    fms,
    suite,
  };
}
