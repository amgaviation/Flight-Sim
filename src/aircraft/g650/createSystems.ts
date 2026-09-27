/**
 * Gulfstream G650 system composition: builds every subsystem in update order
 * (docs/modules/systems-power.md §0.2, systems-control.md §0.1) and the
 * Honeywell Primus Epic "PlaneView II" suite. Free of Three.js so the headless
 * tests run the exact code the app runs (docs/modules/qa.md §6).
 *
 * Order:
 *   failures -> G650Logic -> electrical -> APU -> fuel -> hydraulics -> pneumatics
 *   -> pressurization -> ice -> fire -> oxygen
 *   -> sensors (ADS 1-3 + standby ADS 4, IRU 1-3, RA 1-2) -> landing gear
 *   -> radio power, radios (NAV 1-2, ADF, markers, GPS), FMS, Epic suite
 *   -> thrust ratings -> AFCS -> autothrottle -> FADEC lever law -> engine starts
 *   -> stall warning -> fly-by-wire, aileron / rudder trim, flaps, spoilers,
 *      steering, brakes -> overspeed, altitude alert, TAWS, TCAS, takeoff config
 *   -> CAS -> disconnect aurals -> post logic -> lighting
 */
import type { SimContext } from '../../core/SimContext';
import { GPS, NAV } from '../../core/vars';
import type { Subsystem } from '../types';
import { compileBinding, type Evaluator } from '../../systems/util/binding';
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
import { StallWarning, Overspeed, AltitudeAlert, ALT_ALERT_GFC700, Taws, Tcas, CasManager, DisconnectAlerts, TakeoffConfigWarning } from '../../systems/warning';
import type { LightingSystem } from '../../systems/lighting';
import { Radios } from '../../nav/Radios';
import { Fms } from '../../nav/fms/Fms';
import { createEpicSuite, type EpicSuite, type EpicSuiteHost } from '../../avionics/honeywell-epic/suite';
import { BR725_ENGINES, G650_AIRFRAME, type EpicAirframe } from '../../avionics/honeywell-epic/config';
import { ALPHA_STALL } from './fdm';
import { FLAP_DETENTS, G650_LIMITS, VMO_SCHEDULE } from './data';
import { G650_VARS as V, G650_OVERHEAD_OVERRIDES } from './vars';
import { createElectrical } from './systems/electrical';
import { createFuel } from './systems/fuel';
import { createHydraulics, hydFrac } from './systems/hydraulic';
import { createPneumatics, createPressurization, createIce, createApu, createFire, createOxygen } from './systems/environment';
import { createEngines, TLA } from './systems/engines';
import { G650Logic, G650PostLogic, STAB_PER_DEG } from './systems/logic';
import { G650_CAS } from './systems/cas';
import { createLighting } from './systems/lighting';
import { G650CockpitInputs } from './systems/cockpitInputs';
import { G650AudioPanels } from './systems/audio';
import { G650_CHECKLISTS } from './checklists';

export interface G650SystemsOptions {
  /** Display canvases for the Epic suite (tests pass a fake-canvas factory; the app leaves it undefined = DOM). */
  canvas?: EpicSuiteHost['canvas'];
  /** Omit the Epic suite (pure systems tests); radios, FMS and AFCS are still built. */
  noAvionics?: boolean;
}

export interface G650Systems {
  list: Subsystem[];
  failures: FailureManager;
  logic: G650Logic;
  post: G650PostLogic;
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
  radios: Radios;
  fms: Fms;
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
  at: Autothrottle;
  afcs: Afcs;
  stall: StallWarning;
  fbw: FlyByWire;
  ailTrim: TrimAxis;
  rudTrim: TrimAxis;
  flaps: Flaps;
  spoilers: Spoilers;
  steering: NosewheelSteering;
  overspeed: Overspeed;
  taws: Taws;
  tcas: Tcas;
  tocw: TakeoffConfigWarning;
  cas: CasManager;
  lights: LightingSystem;
  suite: EpicSuite | null;
}

/**
 * Former single IRU mode var (kept for compatibility, no longer read). The G650 has an IRS MODE SELECT panel
 * (lower centre instrument panel, G650ER photograph; SmartCockpit G650 avionics quiz: "IRS Mode Select panel",
 * amber "ON BAT" when an IRU is left on after shutdown): one switchlight per IRU, `V.irsMode(n)` (2 = ON / NAV,
 * aligns on power-up; 0 = OFF).
 */
export const IRS_MODE_VAR = 'ac.g650.irs_mode';

/**
 * G650 airframe data for the Epic displays: the suite's G650_AIRFRAME with the
 * AFM flap placards (LIM: VFE 250 / 220 / 190 KCAS, VLE 250) and the four
 * anti-ice knobs L WING / L COWL / R COWL / R WING (LUC ice: "four rotary
 * knobs"; the suite's GVI default assumed one WING and one COWL switch).
 */
export const G650_EPIC_AIRFRAME: EpicAirframe = {
  ...G650_AIRFRAME,
  flapPlacardKt: [NaN, G650_LIMITS.vfe10Kt, G650_LIMITS.vfe20Kt, G650_LIMITS.vfe39Kt],
  vleKt: G650_LIMITS.vleKt,
  splitAntiIce: true,
};

/** Writes the radio receiver power vars from the electrical loads (NAV 1 on the emergency bus: backup radios, LUC). */
class RadioPower implements Subsystem {
  readonly name = 'g650.radio_power';
  private readonly items: { name: string; ev: Evaluator }[];
  constructor(private readonly ctx: Pick<SimContext, 'vars'>) {
    const v = ctx.vars;
    this.items = [
      { name: NAV.powered(1), ev: compileBinding(v, 'elec.nav1_powered', 0) },
      { name: NAV.powered(2), ev: compileBinding(v, 'elec.nav2_powered', 0) },
      { name: NAV.adfPowered(1), ev: compileBinding(v, 'elec.adf_powered', 0) },
      { name: NAV.markerPowered, ev: compileBinding(v, 'elec.nav1_powered', 0) },
      { name: GPS.powered, ev: compileBinding(v, 'elec.gps1_powered || elec.gps2_powered', 0) },
    ];
  }
  update(): void {
    const v = this.ctx.vars;
    for (let i = 0; i < this.items.length; i++) v.set(this.items[i].name, this.items[i].ev() >= 0.5 ? 1 : 0);
  }
}

export function createSystems(ctx: SimContext, opts: G650SystemsOptions = {}): G650Systems {
  const v = ctx.vars;
  const failures = new FailureManager(v, { events: ctx.events, seed: 650 });
  const logic = new G650Logic(v);
  // 3D yoke trim / AP-TRIM DISC / tiller merge (added with the cockpit build, systems/cockpitInputs.ts).
  const cockpitInputs = new G650CockpitInputs(v, ctx.events);
  const elec = createElectrical(ctx);
  const apu = createApu(ctx);
  const fuel = createFuel(ctx);
  const hyd = createHydraulics(ctx);
  const pneu = createPneumatics(ctx);
  const press = createPressurization(ctx);
  const ice = createIce(ctx);
  const fire = createFire(ctx);
  const oxy = createOxygen(ctx);

  // ---- sensors: three multi-function probes / air data systems + the standby (fourth) probe for the SMCs,
  // three IRUs (hybrid GPS/inertial, align on power-up), two radio altimeters (LUC).
  const adc = [
    new AirDataComputer(ctx, { index: 1, power: 'elec.adc1_powered', pitotProbe: 1, staticPort: 1 }),
    new AirDataComputer(ctx, { index: 2, power: 'elec.adc2_powered', pitotProbe: 2, staticPort: 2 }),
    new AirDataComputer(ctx, { index: 3, power: 'elec.adc3_powered', pitotProbe: 3, staticPort: 3 }),
    new AirDataComputer(ctx, { index: 4, power: 'elec.smc1_powered || elec.smc2_powered', pitotProbe: 4, staticPort: 3 }),
  ];
  const irs = ([1, 2, 3] as const).map(
    (s) => new Irs(ctx, { index: s, modeVar: V.irsMode(s), power: `elec.irs${s}_powered`, requirePosition: true, gpsAutoPosition: true, gpsUpdating: true }),
  );
  const ra = [new RadioAltimeter(ctx, { index: 1, power: 'elec.ra_powered' }), new RadioAltimeter(ctx, { index: 2, power: 'elec.ra_powered' })];

  // ---- landing gear (LUC landing gear): LGCU, L hydraulic system (PTU / AUX backup), N2 blowdown, horn (LIM).
  const gear = new LandingGear(ctx, {
    legs: [
      { index: 0, name: 'Nose', extendS: 7, retractS: 7 }, // EST
      { index: 1, name: 'Left main', extendS: 8, retractS: 8 },
      { index: 2, name: 'Right main', extendS: 8, retractS: 8 },
    ],
    handleVar: V.gearHandle,
    actuation: { power: `${hydFrac('left')} * (elec.lgcu1_powered || elec.lgcu2_powered)` },
    groundRetractInhibit: true,
    handleLock: { overrideVar: V.gearLockRelease },
    doors: { openS: 2, closeS: 2 },
    alternate: { kind: 'blowdown', trigger: V.gearEmer, blowdownS: 6 }, // LUC: N2 bottles, ~6 s, one shot
    horn: {
      rules: [
        // LIM: below 500 ft AGL, both thrust levers at idle, flaps < 22 deg: HORN SILENCE mutes it.
        { when: `${V.idleBoth} && ra1.valid && ra1.alt_ft < 500 && surf.flaps_deg < 22`, silenceable: true, label: 'THROTTLE' },
        // LIM: flaps > 22 deg and any gear not down and locked: cannot be muted.
        { when: 'surf.flaps_deg > 22', silenceable: false, label: 'FLAPS' },
      ],
    },
    lights: { power: 'elec.lgcu1_powered || elec.lgcu2_powered' },
  });

  // ---- radios, FMS, Epic suite
  const radioPower = new RadioPower(ctx);
  const radios = new Radios(ctx, { navCount: 2, adfCount: 1 });
  // Honeywell MOD / ACTIVATE = 'boeing' edit style (docs/modules/avionics-honeywell-epic.md §2).
  // EST speed schedule: climb 300 KIAS / M0.85, cruise M0.85 (GAC long-range cruise), descent M0.85 / 300 KIAS.
  const fms = new Fms(ctx, {
    style: 'boeing',
    engineCount: 2,
    bankLimitDeg: 27,
    speeds: { climbKt: 300, climbMach: 0.85, cruiseKt: 300, cruiseMach: 0.85, descentKt: 300, descentMach: 0.85, approachKt: 140, machTransitionFt: 30000 },
  });
  let suite: EpicSuite | null = null;
  if (!opts.noAvionics) {
    suite = createEpicSuite(
      { vars: v, events: ctx.events, nav: ctx.nav, world: ctx.world, fms, canvas: opts.canvas },
      {
        variant: 'planeview2',
        airframe: G650_EPIC_AIRFRAME,
        engines: BR725_ENGINES,
        sensors: { standbyAdc: 4, adcCount: 4 },
        power: {
          du: ['elec.du1_powered', 'elec.du2_powered', 'elec.du3_powered', 'elec.du4_powered'],
          standby: ['elec.smc1_powered', 'elec.smc2_powered'],
          mcdu: ['elec.mcdu1_powered', 'elec.mcdu2_powered', 'elec.mcdu3_powered'],
          gp: 'elec.gp_powered',
          ccd: ['elec.ccd1_powered', 'elec.ccd2_powered'],
        },
        checklists: G650_CHECKLISTS,
        overheadVars: G650_OVERHEAD_OVERRIDES,
        synopticBindings: {
          'tru.l_main': 'elec.l_main_tru_online || elec.l_main_tru_x_online',
          'tru.r_main': 'elec.r_main_tru_online || elec.r_main_tru_x_online',
          'tru.emer': 'elec.aux_tru_online',
          'tie.ac': 'elec.l_btb_closed || elec.r_btb_closed',
          'hyd.aux.psi': 'hyd.aux_on ? hyd.left_psi : 0',
          'hyd.ptu.psi': 'hyd.ptu_active ? hyd.left_psi : 0',
          'fc.gnd_spoiler_armed': V.gsArmed,
          'zone.4.temp': 'pneu.aft_cabin_temp_c',
        },
      },
    );
    // PERF INIT speed schedule defaults for the G650 (the suite's generic defaults are 250 / M0.80 climb, which
    // CONFIRM INIT then imposed on the FMS: found by tests/aircraft/g650/verify, VNAV climbed at 250 KIAS to FL300).
    // EST schedule (dossier §6): climb 300 KIAS / M0.85, cruise M0.85 (GAC long-range cruise), descent M0.85 / 300.
    const perf = suite.fmsShared.perf;
    perf.tail = 'N650GD';
    perf.climbKt = 300;
    perf.climbMach = 0.85;
    perf.cruiseKt = 300;
    perf.cruiseMach = 0.85;
    perf.descentKt = 300;
    perf.descentMach = 0.85;
  }

  // ---- engines / FADEC / autothrottle
  const eng = createEngines(ctx);

  // ---- AFCS (Primus Epic): the FCCs host the autopilot; it is available in Normal law only (LUC: "Alternate /
  // Direct: no AP") and disengages in AOA limiting (LUC). LIM: minimum engage height 200 ft AGL.
  const afcs = new Afcs(ctx, {
    ...AFCS_PRIMUS_EPIC,
    power: 'elec.afcs1_powered || elec.afcs2_powered',
    servoPower: 'fbw.mode_code == 0',
    sensors: { valid: '(ahrs1.valid && adc1.valid)' },
    yawDamper: { withAp: false, requiredForAp: false }, // yaw damping is part of the FBW normal law
    // Primus Epic: NAV pressed on the ground arms LNAV; it captures after lift-off while the FD keeps TO on the
    // roll (found by tests/aircraft/g650/verify: LNAV went active on the runway before takeoff).
    nav: { ...AFCS_PRIMUS_EPIC.nav, groundCapture: false },
    // Primus Epic VNAV climbs in VFLCH at the FMS climb speed to the lower of the selected / FMS altitude and captures
    // VASEL / VALT (code450 G450/G650 FMA list: VFLCH, VPATH, VASEL, VALT); ALTV never passes the selected altitude.
    vnavClimb: true,
    altvBoundBySel: true,
    disconnect: {
      ...AFCS_PRIMUS_EPIC.disconnect,
      auto: 'fbw.mode_code != 0 || fbw.aoa_limit',
      engageInhibit: 'fbw.mode_code != 0 || (gear.air_ground == 0 && ra1.valid && ra1.alt_ft < 200)',
    },
    // The servos are yoke equivalents for the FBW (Δnz / roll-rate commands): lower pitch gains (EST, tuned in
    // tests/aircraft/g650/approach.test.ts).
    gains: { gainRefKt: 250, pitchKp: 0.05, pitchKi: 0.01, pitchKq: 0.02, rollKp: 0.035, rollKi: 0.004 },
  });
  // AOA stall warning (stick shaker at 0.94 normalized AOA in Normal law, LUC; the PLI appears at 0.75).
  const stall = new StallWarning(ctx, { kind: 'aoa', alphaStall: ALPHA_STALL, shakerNorm: 0.94, power: 'elec.stall_warn_powered' });

  // ---- fly-by-wire (LUC flight controls): 2 dual-channel FCCs + BFCU; actuators on the L and R hydraulic
  // systems and the seven EBHAs.
  const act = [hydFrac('left'), hydFrac('right'), 'elec.ebha_mce_powered ? 0.6 : 0'];
  const fbw = new FlyByWire(ctx, {
    power: 'elec.fcc1a_powered || elec.fcc1b_powered || elec.fcc2a_powered || elec.fcc2b_powered',
    actuators: { pitch: act, roll: act, yaw: act },
    modeSelectVar: V.fcModeSel,
    // Yoke split trim switches (cockpit), merged with pilot priority by systems/cockpitInputs.ts.
    trimSwitchVars: [V.yokeTrimCmd],
    airDataValid: '(adc1.valid + adc2.valid + adc3.valid) >= 2',
    inertialValid: 'ahrs1.att_valid || ahrs2.att_valid || ahrs3.att_valid',
    pitch: {
      // LUC: limiting from 0.87-0.93 normalized AOA, 0.96 maximum at full aft column. EST: the limiter target is
      // set to 0.90 of the stall AOA so the overshoot of this (EST-gain) nz-based law stays below ~0.96-1.0.
      alphaMax: { x: ALPHA_STALL.x, y: ALPHA_STALL.y.map((a) => a * 0.9) },
      alphaOnset: 0.96, // onset 0.86 normalized
      vmoKt: VMO_SCHEDULE,
      mmo: G650_LIMITS.mmo,
      nzMax: { x: [0, 5, 10], y: [G650_LIMITS.nzMaxClean, G650_LIMITS.nzMaxClean, G650_LIMITS.nzMaxFlaps] },
      nzMin: { x: [0, 5, 10], y: [G650_LIMITS.nzMinClean, G650_LIMITS.nzMinClean, G650_LIMITS.nzMinFlaps] },
      speedGain: 0.01,
      trimRateKtPerS: 4,
      // EST gains (Gulfstream data proprietary): a slow integrator so the AOA limiter is not wound up by
      // an unreachable load-factor command at low energy.
      kp: 0.3,
      ki: 0.15,
      kq: 0.03,
      stabRate: 0.4 * STAB_PER_DEG, // LUC: stabilizer 0.4 deg/s
      stabUnits: [-1, 1],
    },
    roll: { maxRateDps: 15, bankHoldDeg: 33, maxBankDeg: 67, kp: 0.04, ki: 0.02 },
    yaw: { yawDampGain: 0.03, turnCoordGain: 0.5, washoutS: 3 },
    direct: { pitch: 0.8, roll: 1, yaw: 1, stabRate: 0.4 * STAB_PER_DEG },
  });
  // Aileron / rudder trim (FCC trims; ROLL MOTOR CONTROL only affects the yoke back-drive, post logic).
  const ailTrim = new TrimAxis(ctx, {
    axis: 'roll',
    range: [-1, 1],
    electric: { power: 'elec.fcc1b_powered || elec.fcc2a_powered', switchVars: [V.ailTrimSw], rate: 0.1 },
    manual: { enable: 0 },
    takeoffBand: [-0.15, 0.15],
  });
  const rudTrim = new TrimAxis(ctx, {
    axis: 'yaw',
    range: [-1, 1],
    electric: { power: 'elec.fcc2a_powered || elec.fcc1b_powered', switchVars: [V.rudTrimSw], rate: 0.1 },
    manual: { enable: 0 },
    takeoffBand: [-0.15, 0.15],
  });
  const flaps = new Flaps(ctx, {
    leverVar: V.flapLever,
    detents: FLAP_DETENTS,
    // FECU electric control, L hydraulic system power (AUX pump / PTU backup) (LUC). EST ~20 s UP -> 39.
    normal: { power: `${hydFrac('left')} * (elec.fecu_a_powered || elec.fecu_b_powered)`, rateDegPerS: 2 },
  });
  const spoilers = new Spoilers(ctx, {
    leverVar: V.sbCmd,
    flightDetent: 1,
    groundArm: V.gsArmed,
    speedbrake: 'spoilers',
    roll: { deadband: 0.1, gain: 1.0 },
    auto: {
      thrustIdle: V.idleBoth,
      spinupKt: 47, // LUC: wheel speed > 47 kt
      raVar: 'ra1.alt_ft',
      raFt: 10, // LUC: both MLG WOW and RA < 10 ft
      leverBackdrive: false,
    },
    flightPower: `max(${hydFrac('left')}, ${hydFrac('right')})`,
    groundPower: `max(${hydFrac('left')}, ${hydFrac('right')})`,
    travelS: 1.5,
  });
  const steering = new NosewheelSteering(ctx, {
    tiller: { maxDeg: 80, input: V.tillerCmd }, // LUC / AIN: tiller 80 deg; hardware axis or 3D handle (cockpitInputs)
    pedals: { maxDeg: 7 }, // pedals 7 deg
    power: `${V.nwsPower} == 1 && elec.nwscu_powered && hyd.left_psi > 1000`,
    rateDegPerS: 25,
  });
  const brakes = new Brakes(ctx, {
    // Brake-by-wire (BCU channels A / B): inboard brakes on L hydraulics, outboard on R (LUC).
    sources: [
      { id: 'inboard', pressurePsi: '(elec.bcu_a_powered || elec.bcu_b_powered) ? hyd.left_psi : 0' },
      { id: 'outboard', pressurePsi: '(elec.bcu_a_powered || elec.bcu_b_powered) ? hyd.right_psi : 0' },
    ],
    maxPsi: 3000,
    minSourcePsi: 1000,
    accumulator: { chargeFrom: 'max(hyd.left_psi, hyd.right_psi)', prechargePsi: 700, maxPsi: 3000, applications: 6 }, // LUC: 700 psi N2 precharge
    parking: { var: V.parkBrake, kind: 'hydraulic' },
    antiskid: { enabled: 'elec.bcu_a_powered || elec.bcu_b_powered', minSpeedKt: 10 }, // LUC: anti-skid down to 10 kt
    autobrake: {
      selectorVar: V.autobrake,
      offValue: 0,
      // LUC: LOW 7 ft/s^2, MEDIUM 10 ft/s^2, HIGH maximum anti-skid (EST 16 ft/s^2), RTO max above 80 kt.
      levels: [
        { value: -1, label: 'RTO', rto: true },
        { value: 1, label: 'LOW', decelFps2: 7 },
        { value: 2, label: 'MED', decelFps2: 10 },
        { value: 3, label: 'HIGH', decelFps2: 16 },
      ],
      thrustIdle: V.idleBoth,
      pedalDisarm: 0.25,
      rtoSpeedKt: 80,
      spinupKt: 60,
    },
    temperature: { heatCapacityJPerK: 150000 }, // EST carbon heat-sink per side (two wheels)
  });

  // ---- alerting
  const overspeed = new Overspeed(ctx, { vmoKt: VMO_SCHEDULE, mmo: G650_LIMITS.mmo, vleKt: G650_LIMITS.vleKt, power: 'elec.l_ess_dc_powered || elec.r_ess_dc_powered' });
  const altAlert = new AltitudeAlert(ctx, { ...ALT_ALERT_GFC700, power: 'elec.gp_powered' }); // EST: 1,000 / 200 ft bands
  const taws = new Taws(ctx, {
    class: 'A',
    power: 'elec.taws_powered',
    flapsLanding: 'surf.flaps_deg >= 35',
    inhibits: { terrain: V.terrInhibit, gpws: V.gpwsInhibit, flapOverride: V.flapOride },
  });
  const tcas = new Tcas(ctx, { power: 'elec.tcas_powered' });
  const tocw = new TakeoffConfigWarning(ctx, {
    armed: `${V.toThrust} && gear.air_ground`,
    power: 'elec.l_ess_dc_powered || elec.r_ess_dc_powered',
    checks: [
      { id: 'flaps', bad: 'surf.flaps_deg < 8 || surf.flaps_deg > 22', text: 'FLAPS', voice: 'Takeoff flaps' },
      { id: 'trim', bad: 'trim.pitch_units < -0.2 || trim.pitch_units > 0.35', text: 'TRIM', voice: 'Takeoff trim' },
      { id: 'speedbrake', bad: `${V.speedbrake} > 0.05`, text: 'SPEED BRAKE', voice: 'Speed brake' },
      { id: 'park', bad: 'brakes.parking_set', text: 'PARKING BRAKE', voice: 'Parking brake' },
      { id: 'fcs', bad: 'fbw.mode_code != 0', text: 'FLIGHT CONTROLS', voice: 'Flight controls' },
    ],
  });
  const cas = new CasManager(ctx, {
    messages: G650_CAS,
    power: 'elec.l_ess_dc_powered || elec.r_ess_dc_powered || elec.emer_dc_powered',
    // EST inhibits: from 80 kt until 400 ft / 30 s after lift-off; below 200 ft RA until 60 kt.
    phase: { takeoffInhibit: { fromKt: 80, toFt: 400, maxAfterLiftoffS: 30 }, landingInhibit: { belowFt: 200, untilKt: 60 } },
    sinks: suite ? [suite.cas.model] : [],
  });
  const disc = new DisconnectAlerts(ctx, { apToneMaxS: 1.5 });
  const post = new G650PostLogic(v, fbw, rudTrim);
  const lights = createLighting(ctx);
  // Audio control panels on the side consoles (added with the overhead / side-console build, systems/audio.ts).
  const audio = new G650AudioPanels(v);

  const list: Subsystem[] = [
    failures,
    cockpitInputs,
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
    radioPower,
    radios,
    fms,
    ...(suite ? [suite.system] : []),
    eng.ratings,
    afcs,
    eng.at,
    eng.fadec,
    ...eng.starts,
    stall,
    fbw,
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
    tocw,
    cas,
    disc,
    post,
    lights,
    audio,
  ];
  for (const s of list) {
    const f = (s as { failures?: () => FailureDef[] }).failures;
    if (s !== failures && typeof f === 'function') failures.register(f.call(s));
  }
  failures.register([
    { id: 'fire.eng1', name: 'Left engine fire', category: 'fire' },
    { id: 'fire.eng2', name: 'Right engine fire', category: 'fire' },
    { id: 'fire.apu', name: 'APU fire', category: 'fire' },
    { id: 'elec.l_btb', name: 'Left bus tie relay', category: 'electrical' },
    { id: 'elec.r_btb', name: 'Right bus tie relay', category: 'electrical' },
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
    radios,
    fms,
    ratings: eng.ratings,
    fadec: eng.fadec,
    starts: eng.starts,
    at: eng.at,
    afcs,
    stall,
    fbw,
    ailTrim,
    rudTrim,
    flaps,
    spoilers,
    steering,
    overspeed,
    taws,
    tcas,
    tocw,
    cas,
    lights,
    suite,
  };
}

export { TLA };
