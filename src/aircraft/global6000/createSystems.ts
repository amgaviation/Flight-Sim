/**
 * Bombardier Global 6000 system composition: builds every subsystem in
 * update order (docs/modules/systems-power.md 0.2, systems-control.md 0.1)
 * and the Collins Pro Line Fusion "Global Vision Flight Deck" suite. Free of
 * Three.js so the headless tests run the exact code the app runs
 * (docs/modules/qa.md 6).
 *
 * Order:
 *   failures -> G6kLogic -> bus power control selectors -> electrical -> APU
 *   -> fuel -> hydraulics -> pneumatics -> pressurization -> ice -> fire
 *   -> oxygen -> sensors (ADC 1 / 2, standby ADC 3, IRS 1-3, IESI AHRS 4,
 *   RA 1 / 2) -> landing gear -> radio power, radios, FMS, Fusion suite
 *   -> thrust ratings -> AFCS (+ bank-limit logic) -> autothrottle -> FADEC
 *   -> engine starts -> yaw damper, stall protection -> primary flight
 *   controls, stabilizer / aileron / rudder trim, slats / flaps, spoilers,
 *   steering, brakes -> overspeed, altitude alert, TAWS, TCAS, takeoff
 *   configuration -> CAS -> disconnect aurals -> post logic -> lighting
 */
import type { SimContext } from '../../core/SimContext';
import { GPS, NAV } from '../../core/vars';
import type { Subsystem } from '../types';
import { compileBinding, type Evaluator } from '../../systems/util/binding';
import { FailureManager, type FailureDef } from '../../systems/failures';
import type { ElectricalNetwork, SourceSelector } from '../../systems/electrical';
import type { FuelSystem } from '../../systems/fuel';
import type { HydraulicSystem } from '../../systems/hydraulic';
import type { PneumaticSystem } from '../../systems/pneumatic';
import type { Pressurization } from '../../systems/pressurization';
import type { IceProtection } from '../../systems/ice';
import type { Apu } from '../../systems/apu';
import type { FireProtection } from '../../systems/fire';
import type { OxygenSystem } from '../../systems/oxygen';
import { AirDataComputer, Ahrs, Irs, RadioAltimeter } from '../../systems/sensors';
import { LandingGear, Brakes } from '../../systems/gear';
import { Afcs, AFCS_PROLINE_FUSION } from '../../systems/autopilot';
import type { ThrustRatingComputer, ThrustLeverFadec, EngineStartController, Autothrottle } from '../../systems/fadec';
import { MechanicalFlightControls, TrimAxis, YawDamper, Flaps, Spoilers, NosewheelSteering } from '../../systems/flightcontrols';
import { StallWarning, Overspeed, AltitudeAlert, ALT_ALERT_GFC700, Taws, Tcas, CasManager, DisconnectAlerts, TakeoffConfigWarning } from '../../systems/warning';
import type { LightingSystem } from '../../systems/lighting';
import { Radios } from '../../nav/Radios';
import { Fms } from '../../nav/fms/Fms';
import { createFusionSuite, GLOBAL6000_AIRFRAME, BR710A2_20_ENGINES, type FusionSuite, type FusionSuiteHost } from '../../avionics/collins-fusion';
import { ALPHA_STALL, CL_SLATS } from './fdm';
import { FLAP_DETENTS, G6K_LIMITS, VMO_SCHEDULE, mmoAt } from './data';
import { G6K_VARS as V } from './vars';
import { createElectrical, BusPowerControl, PowerHoldup } from './systems/electrical';
import { createFuel } from './systems/fuel';
import { createHydraulics, hydFrac } from './systems/hydraulic';
import { createPneumatics, createPressurization, createIce, createApu, createFire, createOxygen } from './systems/environment';
import { createEngines, TLA } from './systems/engines';
import { G6kLogic, G6kPostLogic } from './systems/logic';
import { G6kVisionLogic } from './systems/vision';
import { G6K_CAS } from './systems/cas';
import { createLighting } from './systems/lighting';
import { G6kCockpitInputs } from './systems/cockpitInputs';
import { G6K_CHECKLISTS, G6K_CAS_CHECKLISTS } from './checklists';

export interface G6kSystemsOptions {
  /** Display canvases for the Fusion suite (tests pass a fake-canvas factory; the app leaves it undefined = DOM). */
  canvas?: FusionSuiteHost['canvas'];
  /** Omit the Fusion suite (pure systems tests); radios, FMS and AFCS are still built. */
  noAvionics?: boolean;
}

export interface G6kSystems {
  list: Subsystem[];
  failures: FailureManager;
  logic: G6kLogic;
  post: G6kPostLogic;
  selectors: SourceSelector[];
  elec: ElectricalNetwork;
  /** Runs the bus selectors and the network to equilibrium (applyState). */
  settleElec(): void;
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
  standbyAhrs: Ahrs;
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
  tocw: TakeoffConfigWarning;
  cas: CasManager;
  lights: LightingSystem;
  suite: FusionSuite | null;
}

/**
 * Stall protection alpha vs configuration index (flaps deg + 100 x slats,
 * logic.ts): slats in -> fdm ALPHA_STALL at flaps 0; slats out -> the slat
 * extension adds CL_SLATS / CL_alpha (Aerodynamics.effectiveStallAlpha).
 */
const SLAT_ALPHA = CL_SLATS / 0.082;
export const STALL_CFG_ALPHA = {
  x: [0, 100, 106, 116, 130],
  y: [ALPHA_STALL.y[0], ALPHA_STALL.y[0] + SLAT_ALPHA, ALPHA_STALL.y[1] + SLAT_ALPHA, ALPHA_STALL.y[2] + SLAT_ALPHA, ALPHA_STALL.y[3] + SLAT_ALPHA],
};

/**
 * FMS speed schedule (EST): climb 300 KIAS / M0.80, cruise M0.85 (SPEC typical cruise), descent M0.85 / 300 KIAS;
 * 250 KIAS below 10,000 ft is applied by the FMS (14 CFR 91.117).
 */
const FMS_SPEEDS = { climbKt: 300, climbMach: 0.8, cruiseKt: 300, cruiseMach: 0.85, descentKt: 300, descentMach: 0.85, approachKt: 140, machTransitionFt: 31000 };

/** Writes the radio receiver power vars from the electrical loads. */
class RadioPower implements Subsystem {
  readonly name = 'g6k.radio_power';
  private readonly items: { name: string; ev: Evaluator }[];
  constructor(private readonly ctx: Pick<SimContext, 'vars'>) {
    const v = ctx.vars;
    this.items = [
      { name: NAV.powered(1), ev: compileBinding(v, 'elec.nav1_powered', 0) },
      { name: NAV.powered(2), ev: compileBinding(v, 'elec.nav2_powered', 0) },
      { name: NAV.adfPowered(1), ev: compileBinding(v, 'elec.adf1_powered', 0) },
      { name: NAV.adfPowered(2), ev: compileBinding(v, 'elec.adf2_powered', 0) },
      { name: NAV.markerPowered, ev: compileBinding(v, 'elec.nav1_powered', 0) },
      { name: GPS.powered, ev: compileBinding(v, 'elec.gps1_powered || elec.gps2_powered', 0) },
    ];
  }
  update(): void {
    const v = this.ctx.vars;
    for (let i = 0; i < this.items.length; i++) v.set(this.items[i].name, this.items[i].ev() >= 0.5 ? 1 : 0);
  }
}

/** GXAF: automatic high / low bank limit transition at 35,050 / 34,950 ft (logic.ts), applied to the AFCS HALF BANK state. */
class AfcsBankLimit implements Subsystem {
  readonly name = 'g6k.afcs_bank';
  private prev = -1;
  constructor(
    private readonly ctx: Pick<SimContext, 'vars'>,
    private readonly afcs: Afcs,
  ) {}
  update(): void {
    const low = this.ctx.vars.get(V.bankLow);
    if (low !== this.prev) {
      if ((low !== 0) !== this.afcs.halfBank) this.afcs.press('HALF_BANK');
      this.prev = low;
    }
  }
  reset(): void {
    this.prev = -1;
  }
}

/** MMO above 35,000 ft decreases to 0.842 at 51,000 ft (GXAG placard): supplements the Overspeed block (fixed MMO 0.89). */
class MmoSchedule implements Subsystem {
  readonly name = 'g6k.mmo_schedule';
  constructor(private readonly ctx: Pick<SimContext, 'vars'>) {}
  update(): void {
    const v = this.ctx.vars;
    if (v.get('adc1.mach') > mmoAt(v.get('adc1.press_alt_ft')) + 0.002 && v.get('elec.dc_ess_powered') !== 0) v.set('alert.overspeed', 1);
  }
}

export function createSystems(ctx: SimContext, opts: G6kSystemsOptions = {}): G6kSystems {
  const v = ctx.vars;
  const failures = new FailureManager(v, { events: ctx.events, seed: 6000 });
  const logic = new G6kLogic(v);
  const vision = new G6kVisionLogic(v, ctx.events ?? null);
  const elecPkg = createElectrical(ctx);
  const elec = elecPkg.net;
  const busControl = new BusPowerControl(elecPkg.selectors);
  const holdup = new PowerHoldup(v); // avionics ride through the ACPC / DCPC transfer breaks (electrical.ts)
  const apu = createApu(ctx);
  const fuel = createFuel(ctx);
  const hyd = createHydraulics(ctx);
  const pneu = createPneumatics(ctx);
  const press = createPressurization(ctx);
  const ice = createIce(ctx);
  const fire = createFire(ctx);
  const oxy = createOxygen(ctx);

  // ---- sensors: ADC 1 / 2 (pilot / copilot), standby ADC 3 in the IESI, three Laseref IRS (FSB: "Laseref 6 IRSs",
  // Fusion DEFAULT_SENSORS: IRS 3 for the RSP ATT/HDG reversion), the IESI's own attitude sensor (AHRS 4), two RAs.
  const adc = [
    new AirDataComputer(ctx, { index: 1, power: 'elec.adc1_powered', pitotProbe: 1, staticPort: 1, trendS: 10 }),
    new AirDataComputer(ctx, { index: 2, power: 'elec.adc2_powered', pitotProbe: 2, staticPort: 2, trendS: 10 }),
    new AirDataComputer(ctx, { index: 3, power: 'elec.iesi_powered', pitotProbe: 3, staticPort: 3, trendS: 10 }),
  ];
  const irs = ([1, 2, 3] as const).map(
    (s) =>
      new Irs(ctx, {
        index: s,
        modeVar: V.irsMode(s),
        power: `elec.irs${s}_powered`,
        dcBackup: 'elec.dc_emer_powered',
        requirePosition: true,
        gpsAutoPosition: true,
        gpsUpdating: true,
      }),
  );
  const standbyAhrs = new Ahrs(ctx, { index: 4, power: 'elec.iesi_powered', alignS: 90, hdgAlignS: 0 }); // Fusion doc: IESI attitude alignment 90 s (EST)
  const ra = [new RadioAltimeter(ctx, { index: 1, power: 'elec.ra1_powered' }), new RadioAltimeter(ctx, { index: 2, power: 'elec.ra2_powered' })];

  // ---- landing gear (GXLG): LGECU, system 3 (doors, locks, nose gear, side braces) + system 2 (main actuators),
  // manual release handle = free fall with system 2 assist, handle solenoid lock + DN LCK REL, 28 s disagree.
  const tla1 = V.tla(1);
  const tla2 = V.tla(2);
  const raOk = '(ra1.valid || ra2.valid)';
  const gear = new LandingGear(ctx, {
    legs: [
      { index: 0, name: 'Nose', extendS: 7, retractS: 7 }, // EST
      { index: 1, name: 'Left main', extendS: 9, retractS: 9 },
      { index: 2, name: 'Right main', extendS: 9, retractS: 9 },
    ],
    handleVar: V.gearHandle,
    actuation: { power: `min(${hydFrac(3)}, max(${hydFrac(2)}, 0.4)) * (elec.lgecu_a_powered || elec.lgecu_b_powered)` },
    groundRetractInhibit: true,
    handleLock: { overrideVar: V.gearDnLckRel },
    doors: { openS: 2.5, closeS: 2.5 },
    alternate: { kind: 'freefall', trigger: `${V.gearManRelease} >= 0.99` },
    disagreeS: G6K_LIMITS.gearDisagreeS,
    horn: {
      rules: [
        // GXLG primary mode (serviceable RA): RA < 500 ft with either throttle < 25 deg TLA; RA < 1,000 ft with the SFCL at 30;
        // RA < 500 ft descending > 400 fpm. Not mutable.
        { when: `${raOk} && ra1.alt_ft < 500 && (${tla1} < 0.55 || ${tla2} < 0.55)`, silenceable: false, label: 'GEAR' },
        { when: `${raOk} && ra1.alt_ft < 1000 && ${V.flapLever} > 3.5`, silenceable: false, label: 'FLAPS' },
        { when: `${raOk} && ra1.alt_ft < 500 && adc1.vs_fpm < -400`, silenceable: false, label: 'SINK' },
        // Secondary mode (no serviceable RA): below 16,500 ft with both throttles idle below 165 kt, or flaps 30; HORN MUTED
        // (logic.ts, effective only without RA) silences it.
        { when: `!${raOk} && adc1.alt_ft < 16500 && ((adc1.ias_kt < 165 && ${V.idleBoth}) || ${V.flapLever} > 3.5) && !${V.hornMuteEff}`, silenceable: false, label: 'GEAR' },
      ],
    },
    lights: { power: 'elec.lgecu_a_powered || elec.lgecu_b_powered' },
  });

  // ---- radios, FMS, Fusion suite
  const radioPower = new RadioPower(ctx);
  const radios = new Radios(ctx, { navCount: 2, adfCount: 2 });
  // Collins FMS: MOD + EXEC ('boeing' edit style, avionics-collins-fusion.md). EST speed schedule: climb 300 KIAS / M0.80,
  // cruise M0.85 (SPEC typical cruise), descent M0.85 / 300 KIAS.
  const fms = new Fms(ctx, {
    style: 'boeing',
    engineCount: 2,
    bankLimitDeg: 25,
    speeds: FMS_SPEEDS,
  });
  let suite: FusionSuite | null = null;
  if (!opts.noAvionics) {
    suite = createFusionSuite(
      { vars: v, events: ctx.events, nav: ctx.nav, world: ctx.world, fms, canvas: opts.canvas },
      {
        airframe: GLOBAL6000_AIRFRAME,
        engines: BR710A2_20_ENGINES,
        sensors: { comCount: 3 },
        // Global Vision CTP (photo N835GL): no CRS knobs on the FCP; the CTP TUNE/DATA knob sets the course on the PFD page.
        ctpCourseOnPfdPage: true,
        power: {
          afd: ['elec.afd1_powered', 'elec.afd2_powered', 'elec.afd3_powered', 'elec.afd4_powered'],
          ctp: ['elec.ctp1_powered', 'elec.ctp2_powered'],
          ccp: ['elec.ccp1_powered', 'elec.ccp2_powered'],
          mkp: ['elec.mkp1_powered', 'elec.mkp2_powered'],
          fcp: 'elec.fcp_powered',
          rsp: 'elec.dc_ess_powered || elec.batt_bus_powered',
          iesi: 'elec.iesi_powered',
        },
        checklists: G6K_CHECKLISTS,
        casChecklists: G6K_CAS_CHECKLISTS,
        synopticBindings: {
          'acbus2.shed': V.singleGen,
          'acbus3.shed': V.singleGen,
          'dc_bus1.shed': V.singleTru,
          'dc_bus2.shed': V.singleTru,
          'fuel.ctr_xfer1.on': 'fuel.ctr_xfer1_active',
          'fuel.ctr_xfer2.on': 'fuel.ctr_xfer2_active',
          'fuel.aft_xfer1.on': 'fuel.aft_xfer1_active',
          'fuel.aft_xfer2.on': 'fuel.aft_xfer2_active',
          'fuel.sov1.open': `!${V.fireHandle('l')}`,
          'fuel.sov2.open': `!${V.fireHandle('r')}`,
          'fuel.eng1.temp': 'fuel.l_main_temp_c',
          'fuel.eng2.temp': 'fuel.r_main_temp_c',
          'brk.ob.psi': 'max(hyd.sys2_psi, brakes.accum_psi)',
          'brk.ib.psi': 'hyd.sys3_psi',
          'fc.rtl': 'remap(adc1.ias_kt, 160, 340, 1, 0.3)',
          'oxy.psi': 'oxy.crew_psi',
        },
      },
    );
  }

  // The Fusion FMS PERF INIT / VNAV SETUP defaults (generic in the suite: BOW 51,200 lb, climb 250 / M0.80, descent
  // 280 / M0.80) become the Global's: SPEC BOW 52,230 lb and the EST speed schedule of the FMS above. CONFIRM INIT
  // (applySpeeds) otherwise replaced the aircraft's schedule with the generic one, and VNAV climbed at 250 KIAS to
  // FL300 (found by the full-flight verification).
  if (suite) {
    const p = suite.fmsHost.perf;
    p.bowLb = G6K_LIMITS.bowLb;
    p.climbKt = FMS_SPEEDS.climbKt;
    p.climbMach = FMS_SPEEDS.climbMach;
    p.cruiseKt = FMS_SPEEDS.cruiseKt;
    p.cruiseMach = FMS_SPEEDS.cruiseMach;
    p.descentKt = FMS_SPEEDS.descentKt;
    p.descentMach = FMS_SPEEDS.descentMach;
  }

  // ---- engines / FADEC / autothrottle
  const eng = createEngines(ctx);

  // ---- AFCS (Collins Pro Line Fusion, GVFD): AP servos drive the cable quadrants (GXFC: pitch / roll servo cable
  // circuits into the right aft quadrants); pitch trim through the FCUs. GXAF: roll rate 7.5 deg/s, bank 27 / 17 deg,
  // pitch +/-20 deg, VS -8,000 / +6,000 fpm (Global Express FGC; EST carried over to Fusion).
  const afcs = new Afcs(ctx, {
    ...AFCS_PROLINE_FUSION,
    power: 'elec.afcs1_powered || elec.afcs2_powered',
    servoPower: `max(${hydFrac(1)}, ${hydFrac(2)}, ${hydFrac(3)}) > 0.5`,
    sensors: { valid: '(ahrs1.valid && adc1.valid)' },
    limits: { ...AFCS_PROLINE_FUSION.limits, maxBankDeg: 27, lowBankDeg: 17, maxRollRateDps: 7.5, maxPitchUpDeg: 20, maxPitchDownDeg: -20, maxVsFpm: 8000 },
    yawDamper: { withAp: true, requiredForAp: false },
    cws: 'garmin', // TCS (touch control steering) on the control wheels (GXAG)
    // LNAV / VOR / LOC pre-selected on the ground stay armed through the take-off roll (the TO lateral mode holds the
    // runway track) and capture only once airborne (GXAF: take-off mode until a lateral mode captures). EST: capture at
    // lift-off rather than the 400 ft AFE of later Collins FGS descriptions (the shared AFCS has no height gate).
    nav: { ...AFCS_PROLINE_FUSION.nav, groundCapture: false },
    // Pro Line Fusion VNAV climbs in VFLC toward the FCP / FMS altitude (FSB appendix 6: VNAV climb and descent).
    vnavClimb: true,
    // The FCP speed target is the FMS speed in SPD FMS (the Fusion FCP copies it into ap.sel_spd / ap.sel_mach) and the
    // crew's in SPD MAN, so the VNAV modes fly the selected speed (Collins FCP SPD FMS / MAN).
    vnavSpeedFromSelected: true,
    // VNAV never descends through the FCP preselected altitude (Collins VNAV: the preselector altitude is always
    // honoured; found by the full-flight verification: VALTS followed the next constraint through 5,000 ft selected).
    altvBoundBySel: true,
    disconnect: {
      ...AFCS_PROLINE_FUSION.disconnect,
      // Stick pusher activation disconnects the AP (EST, standard SPS logic); EST 200 ft AGL minimum engage.
      auto: 'stall.pusher_active',
      engageInhibit: `(gear.air_ground == 0 && ra1.valid && ra1.alt_ft < 200)`,
    },
    // EST alphaTauS 4 s (default 2 s): with the AoA feed-forward filtered at 2 s the pitch / path loops fought the slow
    // flight-path response of the slats-out wing and the coupled ILS oscillated +/-3.5 deg pitch (8 s period, VS -150 ..
    // -1,150 fpm; found by the full-flight verification). With 4 s it holds the glideslope at ~3.5 deg nose up and -670 fpm
    // (AAIB N618WF: ~4 deg mean approach attitude).
    gains: { gainRefKt: 250, alphaTauS: 4 },
  });
  const bankLimit = new AfcsBankLimit(ctx, afcs);
  // Dual yaw dampers (GXFC) on the rudder summing unit: EST gains.
  const yd = new YawDamper(ctx, {
    engagedVar: 'ap.yd_engaged',
    power: `(elec.afcs1_powered || elec.afcs2_powered) && max(${hydFrac(1)}, ${hydFrac(2)}, ${hydFrac(3)}) > 0.5`,
    gain: { x: [100, 200, 300], y: [0.05, 0.03, 0.02] },
    nyGain: 0.3,
    authority: 0.2,
  });
  // Stall protection (GXFC): dual AOA vanes, dual-channel SPC, two shakers, pusher (both channels agree), inhibited on the
  // ground or below 70 KCAS; PUSHER switches OFF or AP/SP DISC held disable the pusher. EST trip points.
  const stall = new StallWarning(ctx, {
    kind: 'aoa',
    alphaStall: STALL_CFG_ALPHA,
    flapsVar: V.stallCfg,
    shakerNorm: 0.8,
    // GXFC: the pusher drives both columns to the full forward limit (overpowers a full aft pull): EST -1.3 of full travel.
    pusher: { enabled: V.pusherEnabled, norm: 0.9, command: -1.3 },
    power: `elec.spc_powered && adc1.ias_kt > ${G6K_LIMITS.stallInhibitKt}`,
    test: V.stallTest,
  });

  // ---- primary flight controls (GXFC): cable-commanded, hydraulically powered PCUs: ailerons and elevators 2 PCUs
  // each (system 1 left / system 2 right surfaces, system 3 all), rudder 3 PCUs; no manual reversion (the PCUs lock the
  // surfaces). Rudder travel limiter vs CAS (EST schedule).
  const act = [hydFrac(1), hydFrac(2), hydFrac(3)];
  const fcs = new MechanicalFlightControls(ctx, {
    pitch: { actuators: act, manualReversion: null },
    roll: { actuators: act, manualReversion: null },
    yaw: { actuators: act, manualReversion: null, authority: { x: [0, 160, 250, 340], y: [1, 1, 0.45, 0.3] } },
  });
  // Stabilizer trim (GXFC): 0-14 units = 2 deg ND .. 12 deg NU; manual 0.5 deg/s at low Mach -> 0.3 deg/s at high Mach
  // (14/14 units per deg: 0.7 -> 0.42 units/s); STAB CH 1 / CH 2 disconnect switches; master disconnect interrupts.
  const U_PER_DEG = G6K_LIMITS.stabUnitsMax / (G6K_LIMITS.stabDegMax - G6K_LIMITS.stabDegMin);
  const stab = new TrimAxis(ctx, {
    axis: 'pitch',
    range: [0, G6K_LIMITS.stabUnitsMax],
    neutral: 7,
    electric: {
      power: `(elec.stab_trim1_powered && ${V.stabCh(1)} == 0) || (elec.stab_trim2_powered && ${V.stabCh(2)} == 0)`,
      enable: `input.ap_disc == 0 && ${V.discHeld} == 0`,
      // Hardware / keyboard trim (input.pitch_trim_rate) and the 3D control-wheel switches (cockpitInputs.ts).
      switchVars: ['input.pitch_trim_rate', V.yokeTrimCmd],
      rate: { x: [0, 250, 320], y: [G6K_LIMITS.trimRateLowMachDps * U_PER_DEG, G6K_LIMITS.trimRateLowMachDps * U_PER_DEG, G6K_LIMITS.trimRateHighMachDps * U_PER_DEG] },
    },
    autopilot: { power: `(elec.stab_trim1_powered && ${V.stabCh(1)} == 0) || (elec.stab_trim2_powered && ${V.stabCh(2)} == 0)`, rate: 0.25 * U_PER_DEG },
    manual: { enable: 0 },
    takeoffBand: G6K_LIMITS.stabGreenBand,
    initial: 7,
  });
  // Aileron / rudder trim (GXFC): electric actuators, need hydraulic pressure (trim through the PCUs). EST rates / bands.
  const anyHyd = `max(${hydFrac(1)}, ${hydFrac(2)}, ${hydFrac(3)}) > 0.5`;
  const ailTrim = new TrimAxis(ctx, {
    axis: 'roll',
    range: [-1, 1],
    electric: { power: `elec.fcu1_powered && ${anyHyd}`, switchVars: [V.ailTrimSw], rate: 0.1 },
    manual: { enable: 0 },
    takeoffBand: [-0.2, 0.2],
  });
  const rudTrim = new TrimAxis(ctx, {
    axis: 'yaw',
    range: [-1, 1],
    electric: { power: `elec.fcu2_powered && ${anyHyd}`, switchVars: [V.rudTrimSw], rate: 0.1 },
    manual: { enable: 0 },
    takeoffBand: [-0.2, 0.2],
  });
  // Slats / flaps (GXFC): SFCU 1 / 2 each drive one DC motor per PDU (half speed on one); slats extend first, flaps
  // retract first. EST full-travel times: slats 8 s, flaps 0 -> 30 in 20 s.
  const sfcu = '((elec.sfcu1_powered ? 0.5 : 0) + (elec.sfcu2_powered ? 0.5 : 0))';
  const flaps = new Flaps(ctx, {
    leverVar: V.flapLever,
    detents: FLAP_DETENTS.map((d) => ({ lever: d.lever, flapDeg: d.flapDeg, label: d.label, vfe: d.flapDeg > 0 ? d.vfe : undefined })),
    normal: { power: `${sfcu} * (slats.pos >= 0.99 || flaps.cmd_deg < surf.flaps_deg - 0.05 ? 1 : 0)`, rateDegPerS: 1.5 },
    slats: {
      schedule: { x: [0, 30], y: [0, 0] },
      travelS: 8,
      power: `${sfcu} * (${V.flapLever} >= 0.5 || surf.flaps_deg < 0.5 ? 1 : 0)`,
      autoSlat: { condition: `${V.flapLever} >= 0.5`, flapsRange: [0, 30] },
    },
  });
  // Spoilers (GXFC): 4 MFS + 2 GS per wing; MFS (systems 1 / 2) for roll assist, proportional lift dumping (FLIGHT
  // SPOILER lever, logic.ts schedule) and ground lift dumping; GS (systems 1 / 3) ground only. GLD: armed, both throttles
  // idle, wheel speed > 16 kt or RA < 7 ft.
  const spoilers = new Spoilers(ctx, {
    leverVar: V.sbCmd,
    flightDetent: 1,
    groundArm: V.gldArmed,
    speedbrake: 'spoilers',
    roll: { deadband: 0.1, gain: 0.8 },
    auto: { thrustIdle: V.idleBoth, spinupKt: G6K_LIMITS.gldWheelKt, raVar: 'ra1.alt_ft', raFt: G6K_LIMITS.gldRaFt, leverBackdrive: false },
    flightPower: `max(${hydFrac(1)}, ${hydFrac(2)})`,
    groundPower: `max(${hydFrac(1)}, ${hydFrac(3)})`,
    travelS: 1.5,
  });
  // Nosewheel steering (GXLG): NOSE STEER armed, WOW, gear down; handwheel +/-75 deg, pedals +/-7.5 deg, system 3.
  const steering = new NosewheelSteering(ctx, {
    tiller: { input: V.tillerCmd, maxDeg: G6K_LIMITS.tillerMaxDeg },
    pedals: { maxDeg: G6K_LIMITS.pedalSteerMaxDeg },
    power: `${V.nwsArm} == 1 && (elec.nws1_powered || elec.nws2_powered) && hyd.sys3_psi > 1000 && gear.handle_down`,
    rateDegPerS: 25,
  });
  // Brakes (GXLG): brake-by-wire, outboard brakes on system 2, inboard on system 3, accumulators (500 psi precharge),
  // PARK/EMER handle (system 3, no anti-skid when used proportionally), anti-skid, autobrake LO / MED / HI = 4 / 8 / 13
  // ft/s^2, applied with both MLG WOW > 5 s or spin-up > 50 kt and the ground spoilers deployed.
  const brakes = new Brakes(ctx, {
    sources: [
      { id: 'outboard', pressurePsi: '(elec.bcu_a_powered || elec.bcu_b_powered) ? hyd.sys2_psi : 0' },
      { id: 'inboard', pressurePsi: '(elec.bcu_a_powered || elec.bcu_b_powered) ? hyd.sys3_psi : 0' },
    ],
    maxPsi: 3000,
    minSourcePsi: 1000,
    accumulator: { chargeFrom: 'max(hyd.sys2_psi, hyd.sys3_psi)', prechargePsi: G6K_LIMITS.brakeAccPrechargePsi, maxPsi: 3000, applications: 6 },
    parking: { var: V.parkSet, kind: 'hydraulic' },
    emergency: { var: V.emerBrake, pressurePsi: 'max(hyd.sys3_psi, brakes.accum_psi)' },
    antiskid: { enabled: 'elec.bcu_a_powered || elec.bcu_b_powered', minSpeedKt: 10 },
    autobrake: {
      selectorVar: V.autobrake,
      offValue: 0,
      levels: [
        { value: 1, label: 'LO', decelFps2: G6K_LIMITS.autobrakeLoFps2 },
        { value: 2, label: 'MED', decelFps2: G6K_LIMITS.autobrakeMedFps2 },
        { value: 3, label: 'HI', decelFps2: G6K_LIMITS.autobrakeHiFps2 },
      ],
      thrustIdle: `${V.idleBoth} && surf.ground_spoilers > 0.5`,
      pedalDisarm: 0.2, // GXLG: brake pedal application > 20 % travel disarms
      spinupKt: G6K_LIMITS.autobrakeSpinupKt,
    },
    temperature: { heatCapacityJPerK: 220000 }, // EST carbon heat sink per side (two wheels)
  });

  // ---- alerting
  const overspeed = new Overspeed(ctx, { vmoKt: VMO_SCHEDULE, mmo: G6K_LIMITS.mmo, vleKt: G6K_LIMITS.vleKt, power: 'elec.dc_ess_powered || elec.batt_bus_powered' });
  const mmoSched = new MmoSchedule(ctx);
  const altAlert = new AltitudeAlert(ctx, { ...ALT_ALERT_GFC700, power: 'elec.fcp_powered' }); // EST: 1,000 / 200 ft bands
  const taws = new Taws(ctx, {
    class: 'A',
    power: 'elec.taws_powered',
    flapsLanding: `${V.flapLever} > 3.5`,
    inhibits: { terrain: V.terrOff, flapOverride: V.flapOvrd },
  });
  const tcas = new Tcas(ctx, { power: 'elec.tcas_powered' });
  const tocw = new TakeoffConfigWarning(ctx, {
    armed: `${V.toThrust} && gear.air_ground`,
    power: 'elec.dc_ess_powered || elec.batt_bus_powered',
    checks: [
      { id: 'flaps', bad: `${V.flapLever} < 1.5 || ${V.flapLever} > 3.5`, text: 'CONFIG FLAPS', voice: 'No takeoff' },
      { id: 'stab', bad: 'trim.pitch_to_ok == 0', text: 'CONFIG STAB TRIM', voice: 'No takeoff' },
      { id: 'ail', bad: 'trim.roll_to_ok == 0', text: 'CONFIG AIL TRIM', voice: 'No takeoff' },
      { id: 'rud', bad: 'trim.yaw_to_ok == 0', text: 'CONFIG RUD TRIM', voice: 'No takeoff' },
      { id: 'spoilers', bad: `${V.flightSpoiler} > 0.05`, text: 'CONFIG SPOILERS', voice: 'No takeoff' },
      { id: 'park', bad: `${V.parkBrake} > 0.05`, text: 'PARK BRAKE ON', voice: 'No takeoff' },
    ],
  });
  // IAC 1 / IAC 2 aural warning channels (GXAG: two integrated avionics computers each hold an aural warning generator).
  // SCOPE: the AURAL MUTE switches silence one generator each; the CAS voices and chimes go quiet only with both muted
  // (the other IAC still speaks). TAWS / TCAS / stall voices keep their own path.
  const auralLive = () => v.get(V.auralMute(1)) === 0 || v.get(V.auralMute(2)) === 0;
  const casAudio: SimContext['audio'] = {
    play: (id, o) => (auralLive() ? ctx.audio.play(id, o) : undefined),
    loop: (id) => ctx.audio.loop(id),
    callout: (t, pr) => (auralLive() ? ctx.audio.callout(t, pr) : undefined),
    tone: (id, on) => ctx.audio.tone(id, on && auralLive()),
  };
  const cas = new CasManager({ ...ctx, audio: casAudio }, {
    messages: G6K_CAS,
    // The IACs (CAS, aural warning generators) run on DC ESS / BATT bus; the DC EMER bus is hot from the battery direct
    // buses even with BATT MASTER off, and powering the CAS from it lit MASTER CAUTION in a cold & dark cockpit (found by
    // the full-flight verification).
    power: 'elec.dc_ess_powered || elec.batt_bus_powered',
    // EST inhibits: from 80 kt until 400 ft / 30 s after lift-off; below 200 ft RA until 60 kt.
    phase: { takeoffInhibit: { fromKt: 80, toFt: 400, maxAfterLiftoffS: 30 }, landingInhibit: { belowFt: 200, untilKt: 60 } },
    sinks: suite ? [suite.cas.model] : [],
  });
  const disc = new DisconnectAlerts(ctx, { apToneMaxS: 1.5 });
  const post = new G6kPostLogic(v, ctx.events ?? null);
  const cockpitInputs = new G6kCockpitInputs(v, ctx.events ?? null);
  const lights = createLighting(ctx);

  const list: Subsystem[] = [
    failures,
    logic,
    vision,
    busControl,
    elec,
    holdup,
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
    standbyAhrs,
    ...ra,
    gear,
    radioPower,
    radios,
    fms,
    ...(suite ? [suite.system] : []),
    cockpitInputs,
    eng.ratings,
    afcs,
    bankLimit,
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
    mmoSched,
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
    { id: 'eng1.flameout', name: 'Left engine failure (flameout)', category: 'engine', description: 'Combustor flameout with ENG RUN at RUN: L ENG FLAMEOUT, VFG 1 / 2 and EDP 1A lost.' },
    { id: 'eng2.flameout', name: 'Right engine failure (flameout)', category: 'engine', description: 'Combustor flameout with ENG RUN at RUN: R ENG FLAMEOUT, VFG 3 / 4 and EDP 2A lost.' },
    { id: 'fire.eng1', name: 'Left engine fire', category: 'fire' },
    { id: 'fire.eng2', name: 'Right engine fire', category: 'fire' },
    { id: 'fire.apu', name: 'APU fire', category: 'fire' },
    { id: 'fire.mlg', name: 'Main gear bay overheat', category: 'fire' },
    { id: 'elec.dcpc', name: 'DC power center (DCPC) control failure', category: 'electrical' },
  ]);

  return {
    list,
    failures,
    logic,
    post,
    selectors: elecPkg.selectors,
    elec,
    settleElec: elecPkg.settle,
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
    standbyAhrs,
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
    tocw,
    cas,
    lights,
    suite,
  };
}

export { TLA };
