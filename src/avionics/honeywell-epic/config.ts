/**
 * Configuration of the Honeywell Primus Epic suite for Gulfstream flight
 * decks: PlaneView II (G650 / G650ER) and Symmetry (G500 / G600 / G700 /
 * G800). The aircraft module builds one `EpicSuiteConfig` and calls
 * `createEpicSuite(ctx, config)` (suite.ts).
 *
 * Hardware per variant (what `createEpicSuite` instantiates):
 *
 *  PlaneView II (G650)            | Symmetry (G800)
 *  -------------------------------+--------------------------------------------
 *  4 DUs, 14 in landscape          | 4 DUs (Honeywell DU-1310-2)
 *  2 SMC (standby multifunction    | 2 SFD touch standby displays (ESIS-5000)
 *    controller = display          |   flanking the GP
 *    controller + standby)         |
 *  1 guidance panel (FGP)          | 1 guidance panel (GP-700)
 *  3 MCDUs on the pedestal         | 5 TSCs: outboard L/R, pedestal L/R, (jump seat)
 *  2 CCDs                          | 2 CCDs
 *  hardware overhead switches      | 3 overhead panel touch screens (OHPTS)
 *
 * Sources: Guardian Jet G650 S/N 6044 and G600 S/N 73053 specification
 * sheets ("4 Honeywell DU1310-2 Display Units, Dual Honeywell ESIS-5000
 * standby flight displays, Dual Mason CCD, 5 Touch Screen Controllers,
 * Single Honeywell GP-700, 3 Overhead Panel Cockpit Touch Screens";
 * "Triple Honeywell NEXTGEN Multifunction Display Units"); FlightGlobal
 * "Gulfstream G650 - in the cockpit" (2008): "four large 14in LCDs ...
 * patented combined display controller and standby instrument on the
 * glareshield"; BJT "Pilot report: Gulfstream G500" (4 forward TSCs, 3
 * overhead touchscreens, 2 standby instruments flanking the guidance panel).
 */
import type { Binding } from '../../systems/util/binding';
import type { Checklist } from '../../aircraft/types';
import type { GaugeScale } from '../common/draw/EngineIndications';

export type EpicVariant = 'planeview2' | 'symmetry';

// ---------------------------------------------------------------- engines

/**
 * Operating limits of one engine type, straight from the engine type
 * certificate data sheet. Temperatures in deg C, speeds in % of the TCDS
 * reference speed, pressures in psi (differential).
 */
export interface EpicEngineLimits {
  /** Engine model designation shown in docs/tooltips. */
  model: string;
  tgtStartGroundC: number;
  tgtStartFlightC: number;
  tgtMaxContC: number;
  tgtMaxTakeoffC: number;
  /** 2-minute transient limit (NaN when not published). */
  tgtTransientC: number;
  /** 20-second over-temperature allowance (maintenance-free). */
  tgtOverTempC: number;
  n1MaxTakeoffPct: number;
  n1OverspeedPct: number;
  n2MaxTakeoffPct: number;
  n2OverspeedPct: number;
  n2MaxContPct: number;
  /** Differential oil pressure: minimum to complete a flight / normal lower limit above 90 % N2. */
  oilPressMinPsi: number;
  oilPressNormalPsi: number;
  oilTempMaxC: number;
  /** Rated thrust (kN) at MTO / MCT, sea level ISA. */
  thrustMtoKn: number;
  thrustMctKn: number;
}

/**
 * Rolls-Royce BR700-725A1-12 (G650 / G650ER).
 * UK CAA TCDS UK.TC.E.00082 Issue 01 (15 Mar 2024, validating EASA.E.018)
 * section IV: TGT start ground 700 / flight 850 C, MTO 900 C, MCT 885 C,
 * 20 s over-temperature 920 C; N1 (7000 rpm = 100 %) MTO 102.8 %, 20 s
 * overspeed 104.3 %; N2 (15898 rpm = 100 %) MTO 100.0 %, overspeed 101.3 %,
 * MCT 98.7 %; oil pressure lower limit for flight 241.2 kPa (35 psid) idle
 * to 72.3 % N2 rising to 310.3 kPa (45 psid) above 90 % N2, minimum to
 * complete flight 172.3 kPa (25 psid); oil temperature max 160 C;
 * ratings MTO 75.2 kN, MCT 66.6 kN.
 */
export const BR725_LIMITS: EpicEngineLimits = {
  model: 'Rolls-Royce BR700-725A1-12',
  tgtStartGroundC: 700,
  tgtStartFlightC: 850,
  tgtMaxContC: 885,
  tgtMaxTakeoffC: 900,
  tgtTransientC: NaN,
  tgtOverTempC: 920,
  n1MaxTakeoffPct: 102.8,
  n1OverspeedPct: 104.3,
  n2MaxTakeoffPct: 100.0,
  n2OverspeedPct: 101.3,
  n2MaxContPct: 98.7,
  oilPressMinPsi: 25,
  oilPressNormalPsi: 35,
  oilTempMaxC: 160,
  thrustMtoKn: 75.2,
  thrustMctKn: 66.6,
};

/**
 * Rolls-Royce Pearl 700, BR700-730B2-14 (G700 / G800).
 * EASA TCDS E.135 Issue 02 (12 Oct 2023): TGT start ground 800 / flight
 * 850 C, MTO 940 C, transient 950 C (2 min), MCT 940 C, 20 s
 * over-temperature 960 C; N1 (6500 rpm = 100 %) MTO/MCT 96.6 %, overspeed
 * 97.8 %; N2 (19000 rpm = 100 %) MTO/MCT 102.2 %, overspeed 103.4 %; oil
 * pressure minimum to start flight 35 psid (idle to 72.3 % NH), 45 psid
 * above 90 % NH, minimum to complete flight 25 psid; oil scavenge
 * temperature 170 C steady (175 C transient); ratings MTO 81.2 kN,
 * MCT 72.2 kN.
 */
export const PEARL700_LIMITS: EpicEngineLimits = {
  model: 'Rolls-Royce Pearl 700 (BR700-730B2-14)',
  tgtStartGroundC: 800,
  tgtStartFlightC: 850,
  tgtMaxContC: 940,
  tgtMaxTakeoffC: 940,
  tgtTransientC: 950,
  tgtOverTempC: 960,
  n1MaxTakeoffPct: 96.6,
  n1OverspeedPct: 97.8,
  n2MaxTakeoffPct: 102.2,
  n2OverspeedPct: 103.4,
  n2MaxContPct: 102.2,
  oilPressMinPsi: 25,
  oilPressNormalPsi: 35,
  oilTempMaxC: 170,
  thrustMtoKn: 81.2,
  thrustMctKn: 72.2,
};

/**
 * Where the engine page reads each parameter. `i` is the 1-based engine.
 * Defaults are the physics / systems standard names (core/vars.ts ENG).
 */
export interface EpicEngineVars {
  n1: (i: number) => string;
  n2: (i: number) => string;
  tgt: (i: number) => string;
  ff: (i: number) => string;
  oilPress: (i: number) => string;
  oilTemp: (i: number) => string;
  vibLp: (i: number) => string;
  vibHp: (i: number) => string;
  running: (i: number) => string;
  /**
   * EPR var written by the aircraft FADEC model. When the var has never been
   * written the display derives EPR from N1 with `eprFromN1` (EST).
   */
  epr: (i: number) => string;
  /** EPR / N1 target of the selected thrust rating (TRS). Missing = no bug. */
  target: (i: number) => string;
  /** 1 while the FADEC runs in the alternate (LP / N1) control mode ("ALT" above LP). */
  altMode: (i: number) => string;
  /** Starter engaged / ignition (start synoptic, "ST" / "IGN" flags). */
  starter: (i: number) => string;
  ignition: (i: number) => string;
  /** String var: FADEC thrust rating in use ('TO', 'CLB', 'CRZ', 'MCT', 'GA'). */
  rating: string;
}

export const DEFAULT_ENGINE_VARS: EpicEngineVars = {
  n1: (i) => `eng${i}.n1_pct`,
  n2: (i) => `eng${i}.n2_pct`,
  tgt: (i) => `eng${i}.itt_c`,
  ff: (i) => `eng${i}.ff_pph`,
  oilPress: (i) => `eng${i}.oil_press_psi`,
  oilTemp: (i) => `eng${i}.oil_temp_c`,
  vibLp: (i) => `eng${i}.vib_n1`,
  vibHp: (i) => `eng${i}.vib_n2`,
  running: (i) => `eng${i}.running`,
  epr: (i) => `ac.eng${i}.epr`,
  target: (i) => `fadec.eng${i}.n1_target`,
  altMode: (i) => `ac.eng${i}.fadec_alt`,
  starter: (i) => `eng${i}.starter`,
  ignition: (i) => `eng${i}.ignition`,
  rating: 'fadec.rating',
};

export interface EpicEngineConfig {
  count: number;
  limits: EpicEngineLimits;
  /**
   * Primary thrust-setting parameter. The BR725 and Pearl 700 FADECs control
   * EPR in the primary mode and revert to LP (N1) control in the alternate
   * mode (code450 "Powerplant": "Primary: EPR-based thrust control;
   * Alternate: LP (N1) speed control (displayed as blue ALT)"; FAA FSB
   * GVIII-G700 Rev 1 App. 4: "GVIII-G700 EPR controlled").
   */
  primary: 'EPR' | 'N1';
  vars: EpicEngineVars;
  /** Is `vars.target` an N1 value (true, `ThrustLeverFadec` n1_target) or an EPR value? */
  targetIsN1: boolean;
  /**
   * EPR estimate from N1 % for installations whose FADEC model does not
   * publish EPR. EST: see `eprFromN1Br700`.
   */
  eprFromN1: (n1Pct: number) => number;
}

/**
 * EST EPR (P5/P2) vs N1 for a BR700-family high-bypass engine at static
 * sea level: 1.00 at idle (~22 % N1) rising to ~1.62 at maximum takeoff
 * N1. Shape from the generic fan pressure-ratio law EPR - 1 ~ N1^2.4; the
 * end points are estimates (no public BR725/Pearl EPR schedule).
 */
export function eprFromN1Br700(n1Pct: number): number {
  const x = Math.max(0, n1Pct) / 100;
  return 1 + 0.62 * Math.pow(Math.max(0, x - 0.2) / 0.8, 2.4);
}

// ---------------------------------------------------------------- engine gauge scales

function scaleOf(min: number, max: number, amber: number[], red: number[], ticks: number[], labels: string[], decimals: 0 | 1 | 2, step: number, unit: string, cautionHigh?: number, warnHigh?: number, cautionLow?: number, warnLow?: number): GaugeScale {
  return {
    min,
    max,
    bands: [],
    redlines: red,
    amberlines: amber,
    ticks,
    labels,
    limits: { cautionHigh, warnHigh, cautionLow, warnLow, hysteresis: 0 },
    decimals,
    readoutStep: step,
    unit,
  };
}

/** Dial/readout scales used by the engine windows, derived from the limits. */
export interface EpicEngineScales {
  epr: GaugeScale;
  tgt: GaugeScale;
  lp: GaugeScale;
  hp: GaugeScale;
  oilPress: GaugeScale;
  oilTemp: GaugeScale;
  vib: GaugeScale;
}

/**
 * EPR 0.8..1.8 (EST dial range), TGT 0..1000 C with the MCT amber line and
 * the MTO red line, LP 0..110 % with the MTO red line, HP digital with red
 * above MTO, oil pressure red below the minimum / amber below normal (G550
 * OM 2A-31: "oil pressure ... red digits below 25 psi to white digits at
 * 35 psi and above"), oil temperature red above the maximum, vibration
 * amber at 1.8 units (EST: G450 system test "ENG VIB MON: observe 1.8-2.2
 * amber indication").
 */
export function engineScales(l: EpicEngineLimits): EpicEngineScales {
  const tgtRed = Number.isFinite(l.tgtTransientC) ? l.tgtTransientC : l.tgtMaxTakeoffC;
  return {
    epr: scaleOf(0.8, 1.8, [], [], [0.8, 1.0, 1.2, 1.4, 1.6, 1.8], [], 2, 0, ''),
    tgt: scaleOf(0, 1000, l.tgtMaxContC < tgtRed ? [l.tgtMaxContC] : [], [tgtRed], [0, 200, 400, 600, 800, 1000], [], 0, 1, 'C', l.tgtMaxContC < tgtRed ? l.tgtMaxContC : undefined, tgtRed),
    lp: scaleOf(0, 110, [], [l.n1MaxTakeoffPct], [0, 20, 40, 60, 80, 100], [], 1, 0, '%', undefined, l.n1MaxTakeoffPct),
    hp: scaleOf(0, 110, [], [l.n2MaxTakeoffPct], [], [], 1, 0, '%', undefined, l.n2MaxTakeoffPct),
    oilPress: scaleOf(0, 100, [], [], [], [], 0, 1, 'PSI', undefined, undefined, l.oilPressNormalPsi, l.oilPressMinPsi),
    oilTemp: scaleOf(-40, 200, [], [], [], [], 0, 1, 'C', undefined, l.oilTempMaxC),
    vib: scaleOf(0, 5, [], [], [], [], 2, 0, '', 1.8),
  };
}

export const BR725_ENGINES: EpicEngineConfig = {
  count: 2,
  limits: BR725_LIMITS,
  primary: 'EPR',
  vars: DEFAULT_ENGINE_VARS,
  targetIsN1: true,
  eprFromN1: eprFromN1Br700,
};

export const PEARL700_ENGINES: EpicEngineConfig = {
  count: 2,
  limits: PEARL700_LIMITS,
  primary: 'EPR',
  vars: DEFAULT_ENGINE_VARS,
  targetIsN1: true,
  eprFromN1: eprFromN1Br700,
};

// ---------------------------------------------------------------- sensors and aircraft data

/** Sensor indices feeding one side's PFD (reversion through the SENSOR page changes adc/ahrs). */
export interface EpicSideSensors {
  adc: number;
  ahrs: number;
  ra: number;
  /** On-side VHF NAV receiver and ADF. */
  nav: number;
  adf: number;
}

export interface EpicSensors {
  sides: [EpicSideSensors, EpicSideSensors];
  /** Standby air data / attitude (standby instrument), e.g. index 3. */
  standbyAdc: number;
  standbyAhrs: number;
  /** Number of ADC / AHRS (IRS) sources selectable on the SENSOR page. */
  adcCount: number;
  ahrsCount: number;
  /** VHF NAV receivers (NAV1..NAVn), ADFs. */
  navCount: number;
  adfCount: number;
  comCount: number;
}

export const DEFAULT_SENSORS: EpicSensors = {
  sides: [
    { adc: 1, ahrs: 1, ra: 1, nav: 1, adf: 1 },
    { adc: 2, ahrs: 2, ra: 2, nav: 2, adf: 2 },
  ],
  standbyAdc: 3,
  standbyAhrs: 3,
  adcCount: 3,
  ahrsCount: 3,
  navCount: 2,
  adfCount: 1,
  comCount: 3,
};

/** Airframe numbers the displays need (speed tape, flap scale, trim scales). */
export interface EpicAirframe {
  /** Display name ('G650', 'G800'). */
  name: string;
  /** Vmo (kt) / Mmo: fallback barber pole when `overspeed.vmo_kt` is not written. */
  vmoKt: number;
  mmo: number;
  /** Flap handle detents (deg), e.g. [0, 10, 20, 39]. */
  flapDetents: readonly number[];
  /** Placard speed per flap detent (kt), same order (NaN for 0). */
  flapPlacardKt: readonly number[];
  /** Landing gear extended / operating speed (kt). */
  vleKt: number;
  /**
   * (Appended by the g800 aircraft.) Draw the flap / gear placard limit (amber tick, SpeedTape `flapLimitKt`) on the
   * PFD speed tape: `flapPlacardKt` of the current flap position, and `vleKt` while the gear is not up. Default false.
   */
  showPlacardLimit?: boolean;
  /** Pitch trim display: var, range [nose down, nose up] units, takeoff green band. */
  pitchTrim: { var: string; min: number; max: number; greenLo: number; greenHi: number };
  aileronTrimVar: string;
  rudderTrimVar: string;
  /** Aircraft length class for the doors synoptic outline (m). */
  lengthM: number;
  /** Cabin windows per side for the doors synoptic outline. */
  windowsPerSide: number;
  /** Number of ECS temperature zones (G650: 3, G700/G800: 4 — FAA FSB GVIII-G700 App. 4). */
  ecsZones: number;
  /** Separate wing anti-ice / cowl anti-ice switches per side (G700/G800: yes — FAA FSB GVIII-G700). */
  splitAntiIce: boolean;
}

// ---------------------------------------------------------------- suite config

/** Event names the suite emits towards the aircraft systems. */
export interface EpicEventMap {
  /** AFCS event prefix (systems/autopilot Afcs `eventPrefix`), default 'ap.'. */
  afcsPrefix: string;
  /** Autothrottle engage toggle / disconnect (systems/fadec Autothrottle). */
  atEngage: string;
  atDisconnect: string;
  /** FADEC thrust rating selection (ThrustRatingComputer), payload rating id. */
  thrustRating: string;
  /** EGPWS self test (systems/warning Taws `taws.test`). */
  tawsTest: string;
  /** IRS present-position entry (systems/sensors Irs `irs.pos_entry`). */
  irsPosEntry: string;
  /** CAS acknowledgement (systems/warning CasManager `cas.ack`). */
  casAck: string;
}

export const DEFAULT_EVENTS: EpicEventMap = {
  afcsPrefix: 'ap.',
  atEngage: 'at.engage',
  atDisconnect: 'at.disc',
  thrustRating: 'fadec.rating',
  tawsTest: 'taws.test',
  irsPosEntry: 'irs.pos_entry',
  casAck: 'cas.ack',
};

/** Power bindings (systems/util Binding: var name, expression or function). Omitted = always powered. */
export interface EpicPower {
  du?: [Binding, Binding, Binding, Binding];
  /** PlaneView II SMCs or Symmetry SFDs, [pilot, copilot]. */
  standby?: [Binding, Binding];
  mcdu?: [Binding, Binding, Binding];
  /** Symmetry TSCs [outboard L, pedestal L, pedestal R, outboard R]. */
  tsc?: [Binding, Binding, Binding, Binding];
  /** Symmetry overhead touch screens [left, centre, right]. */
  ohpts?: [Binding, Binding, Binding];
  gp?: Binding;
  ccd?: [Binding, Binding];
  /** Display failure inputs (1 = failed), e.g. 'fail.du1'. Default `fail.epic.du{n}`. */
}

export interface EpicSuiteConfig {
  variant: EpicVariant;
  airframe: EpicAirframe;
  engines: EpicEngineConfig;
  sensors?: Partial<EpicSensors>;
  events?: Partial<EpicEventMap>;
  power?: EpicPower;
  /** Electronic checklists shown on the ECL windows (AircraftInstance.checklists). */
  checklists?: readonly Checklist[];
  /**
   * Synoptic bindings: element binding id -> Binding. Merged over the
   * variant defaults (displays/synoptics/pages.ts `DEFAULT_SYNOPTIC_BINDINGS`).
   */
  synopticBindings?: Readonly<Record<string, Binding>>;
  /**
   * Overhead system control vars (Symmetry touch pages and PlaneView II
   * hardware alike). Merged over `GULFSTREAM_OVERHEAD_VARS` (logic/overhead.ts);
   * `null` hides a control the airframe does not have.
   */
  overheadVars?: Readonly<Record<string, string | null>>;
  /** Display ids prefix (default 'epic'). */
  idPrefix?: string;
  /** Canvas texture resolution multiplier for the DUs (default 1). */
  pixelRatio?: number;
  /** Boot time of the DUs after power-up (s). G450: "approximately two minutes"; EST 25 s default for playability. */
  duBootS?: number;
  /**
   * Symmetry only, appended (additive, fix round 1): portrait TSC page layouts (480 x 800). The real G500-G800
   * touch-screen controllers are tall portrait tablets (G800 demonstrator flight-deck photograph). Default false
   * keeps the original landscape layouts.
   */
  tscPortrait?: boolean;
  /**
   * Appended (G800 fix round 1 F02): the GP lateral key cycles OFF -> HDG -> TRK -> OFF (Symmetry
   * HDG/TRK key; BJT500). Default false keeps the plain HDG key.
   */
  gpHdgTrkToggle?: boolean;
}

/**
 * Gulfstream G650 airframe display data.
 * Flap detents 0/10/20/39 (G650 flap scale on the CAS trim strip, cockpit
 * photograph G650ER S/N "Gulfstream G650ER-Cockpit", J. Atchison 2023).
 * Vmo 340 KCAS / Mmo 0.925 (EASA TCDS IM.A.169 Issue 17, GVI section 1.10).
 * Flap placards EST:
 * 10 deg 250 kt, 20 deg 220 kt, 39 deg 180 kt; VLE 250 kt (EST).
 */
export const G650_AIRFRAME: EpicAirframe = {
  name: 'G650',
  vmoKt: 340,
  mmo: 0.925,
  flapDetents: [0, 10, 20, 39],
  flapPlacardKt: [NaN, 250, 220, 180],
  vleKt: 250,
  pitchTrim: { var: 'trim.pitch_units', min: -1, max: 1, greenLo: -0.2, greenHi: 0.35 },
  aileronTrimVar: 'surf.aileron_trim',
  rudderTrimVar: 'surf.rudder_trim',
  lengthM: 30.4,
  windowsPerSide: 8,
  ecsZones: 3,
  splitAntiIce: false,
};

/**
 * Gulfstream G800 airframe display data. Vmo/Mmo 340 KCAS / 0.935 (EASA
 * TCDS IM.A.169 Issue 17, GVIII-G800 section 10); length 99.78 ft
 * (FSB GVIII-G800 differences table), 4 ECS cabin zones and split
 * wing / cowl anti-ice switches (FSB "Increased number of Anti-ice switches:
 * two switches for WAI (one for each wing) and CAI (one for each engine)",
 * "Increased ECS cabin zones from 3 to 4"). Flap placards EST as G650.
 */
export const G800_AIRFRAME: EpicAirframe = {
  name: 'G800',
  vmoKt: 340,
  mmo: 0.935,
  flapDetents: [0, 10, 20, 39],
  flapPlacardKt: [NaN, 250, 220, 180],
  vleKt: 250,
  pitchTrim: { var: 'trim.pitch_units', min: -1, max: 1, greenLo: -0.2, greenHi: 0.35 },
  aileronTrimVar: 'surf.aileron_trim',
  rudderTrimVar: 'surf.rudder_trim',
  lengthM: 30.4,
  windowsPerSide: 8,
  ecsZones: 4,
  splitAntiIce: true,
};

/** Fully resolved config (defaults applied) used internally. */
export interface EpicResolvedConfig extends Omit<EpicSuiteConfig, 'sensors' | 'events'> {
  sensors: EpicSensors;
  events: EpicEventMap;
  scales: EpicEngineScales;
  idPrefix: string;
}

export function resolveConfig(cfg: EpicSuiteConfig): EpicResolvedConfig {
  const sensors: EpicSensors = { ...DEFAULT_SENSORS, ...(cfg.sensors ?? {}) };
  return {
    ...cfg,
    sensors,
    events: { ...DEFAULT_EVENTS, ...(cfg.events ?? {}) },
    scales: engineScales(cfg.engines.limits),
    idPrefix: cfg.idPrefix ?? 'epic',
  };
}
