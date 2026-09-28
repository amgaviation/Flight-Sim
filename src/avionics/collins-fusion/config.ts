/**
 * Configuration of the Collins Pro Line Fusion suite (Bombardier Global
 * Vision Flight Deck) and the Global 6000 / BR700-710A2-20 data set.
 *
 * Sources (cited per value below):
 *  - EASA TCDS E.018 Issue 16 (24 Oct 2023), BR700-710 engines: ratings,
 *    TGT, N1 / N2 speed, oil temperature and oil pressure limits.
 *  - EASA TCDS IM.A.009 Issue 14 (23 Jan 2026), BD-700: fuel capacities
 *    (SB 700-28-040 configuration) and maximum weights of the BD-700-1A10.
 *  - Bombardier Global Express "Airplane General" training manual, airspeed
 *    limits placard GX_01_022 (VMO / MMO / VFE / VLO / VLE); same airframe
 *    and placard values assumed for the Global 6000 (EST: the Global 6000
 *    is a BD-700-1A10 with the Vision flight deck, TCDS IM.A.009 note 8).
 *  - Global Express "Flight Controls" manual: slat / flap lever positions
 *    0 IN, 0 OUT, 6, 16, 30; stabilizer trim 0-14 units, takeoff green band
 *    4.5-11 units (GX_10_022).
 *  - Global Express "Electrical" / "Hydraulics" / "Fuel System" manuals:
 *    synoptic colour logic and ranges (see logic/readouts.ts, displays/synoptics.ts).
 */
import type { Binding } from '../../systems/util/binding';
import type { Checklist } from '../../aircraft/types';
import type { ExceedanceLimits } from '../common/alerting';

// ------------------------------------------------------------------ airframe

export interface FusionFlapDetent {
  /** `ac.flap_lever` value of the detent. */
  lever: number;
  /** EICAS / PFD label. */
  label: string;
  /** Slats extended in this position. */
  slats: boolean;
  /** Flap angle (deg). */
  flapDeg: number;
  /** Placard VFE (KIAS); NaN = none (retracted). */
  vfeKt: number;
}

export interface FusionTankDef {
  /** EICAS label. */
  label: string;
  /** Index of `fuel.tank{i}_kg`. */
  index: number;
  /** Usable capacity (lb). */
  capacityLb: number;
}

export interface FusionAirframe {
  name: string;
  /** VMO (KIAS) by pressure altitude: [altFt, kt] breakpoints (step schedule). */
  vmo: readonly (readonly [number, number])[];
  /** MMO by pressure altitude: [altFt, mach] breakpoints (linear between). */
  mmo: readonly (readonly [number, number])[];
  flaps: readonly FusionFlapDetent[];
  /** Gear placards (KIAS). */
  vloExtKt: number;
  vloRetKt: number;
  vleKt: number;
  /** Horizontal stabilizer trim display: range (units) and takeoff green band. */
  stabUnits: readonly [number, number];
  stabGreenBand: readonly [number, number];
  /** Vars for the EICAS trim / configuration displays. */
  vars: {
    stabUnits: string;
    rudderTrim: string;
    aileronTrim: string;
    flapsDeg: string;
    slats: string;
    flapLever: string;
    spoilerLeft: string;
    spoilerRight: string;
    groundSpoilers: string;
    gearPos: (i: number) => string;
    gearHandleDown: string;
    parkingBrake: string;
  };
  tanks: readonly FusionTankDef[];
  /** Maximum weights (lb) for the FMS PERF INIT checks. */
  mtowLb: number;
  mlwLb: number;
  mzfwLb: number;
  /** Cabin temperature zones on the AIR COND page. */
  ecsZones: readonly string[];
  /** Doors on the DOORS page (id = readout key suffix, label). */
  doors: readonly { id: string; label: string }[];
}

/** Global 6000 (BD-700-1A10 with the Global Vision Flight Deck). */
export const GLOBAL6000_AIRFRAME: FusionAirframe = {
  name: 'GLOBAL 6000',
  // GX_01_022: VMO 300 KIAS below 8,000 ft, 340 KIAS 8,000 to 30,267 ft (MMO above).
  vmo: [
    [0, 300],
    [8000, 340],
  ],
  // GX_01_022: MMO 0.89 from 30,267 to 35,000 ft, 0.88 at 41,000, 0.858 at 47,000, 0.842 at 51,000 ft.
  mmo: [
    [30267, 0.89],
    [35000, 0.89],
    [41000, 0.88],
    [47000, 0.858],
    [51000, 0.842],
  ],
  // GX_10: slat/flap lever 0 (slats IN), 0 (slats OUT), 6, 16, 30. VFE per GX_01_022:
  // slats out 0 deg 225, 6 deg 210, 16 deg 210, 30 deg 185 KIAS.
  flaps: [
    { lever: 0, label: '0', slats: false, flapDeg: 0, vfeKt: NaN },
    { lever: 1, label: '0', slats: true, flapDeg: 0, vfeKt: 225 },
    { lever: 2, label: '6', slats: true, flapDeg: 6, vfeKt: 210 },
    { lever: 3, label: '16', slats: true, flapDeg: 16, vfeKt: 210 },
    { lever: 4, label: '30', slats: true, flapDeg: 30, vfeKt: 185 },
  ],
  vloExtKt: 200, // GX_01_022 VLO (EXT)
  vloRetKt: 200, // GX_01_022 VLO (RET)
  vleKt: 250, // GX_01_022 VLE
  stabUnits: [0, 14], // GX_10: "converted to units from 0 to 14"
  stabGreenBand: [4.5, 11], // GX_10_022: "Green Band (takeoff) Between 4.5 and 11 units"
  vars: {
    stabUnits: 'trim.pitch_units',
    rudderTrim: 'surf.rudder_trim',
    aileronTrim: 'surf.aileron_trim',
    flapsDeg: 'surf.flaps_deg',
    slats: 'surf.slats',
    flapLever: 'ac.flap_lever',
    spoilerLeft: 'surf.spoiler_left',
    spoilerRight: 'surf.spoiler_right',
    groundSpoilers: 'surf.ground_spoilers',
    gearPos: (i: number) => `gear.pos${i}`,
    gearHandleDown: 'gear.handle_down',
    parkingBrake: 'brakes.parking_set',
  },
  // EASA TCDS IM.A.009 section 2 1.4, aircraft with SB 700-28-040: mains 15,045 lb each,
  // centre 12,683 lb, aft 2,275 lb, total 45,050 lb usable. Tank indices EST (aircraft maps them).
  tanks: [
    { label: 'L', index: 0, capacityLb: 15045 },
    { label: 'CTR', index: 1, capacityLb: 12683 },
    { label: 'R', index: 2, capacityLb: 15045 },
    { label: 'AFT', index: 3, capacityLb: 2275 },
  ],
  mtowLb: 99500, // TCDS IM.A.009 1.5
  mlwLb: 78600,
  mzfwLb: 58000,
  ecsZones: ['CKPT', 'FWD CABIN', 'AFT CABIN'], // EST: Global Express STAT page shows FWD / AFT CABIN temperatures
  // Global Express "Airplane General": door warning system monitors the passenger, cargo (baggage)
  // and emergency exit doors plus service doors (GX_01_043).
  doors: [
    { id: 'pax', label: 'PASSENGER' },
    { id: 'emer', label: 'EMER EXIT' },
    { id: 'bag', label: 'BAGGAGE' },
    { id: 'aft_eqpt', label: 'AFT EQPT BAY' },
    { id: 'svc_large', label: 'LARGE SERV' },
    { id: 'svc_small', label: 'SMALL SERV' },
  ],
};

// ------------------------------------------------------------------ engines

/** Oil pressure limit curve vs N2 (psid): value at/below `n2Lo`, linear to `n2Hi`, constant above. */
export interface OilPressCurve {
  n2Lo: number;
  n2Hi: number;
  lowPsi: number;
  highPsi: number;
}

export interface FusionEngineLimits {
  n1MaxPct: number;
  n1OverspeedPct: number;
  n2MaxPct: number;
  n2MctPct: number;
  n2OverspeedPct: number;
  ittStartGroundC: number;
  ittStartFlightC: number;
  ittTakeoffC: number;
  ittMctC: number;
  ittOvertempC: number;
  oilTempMaxC: number;
  oilTempMinTakeoffC: number;
  /** Lower limit for flight (amber) and minimum to complete the flight (red). */
  oilPressCaution: OilPressCurve;
  oilPressWarning: OilPressCurve;
  thrustTakeoffLbf: number;
  thrustMctLbf: number;
  /** 100 % N1 / N2 in rpm (for the status page). */
  n1Rpm: number;
  n2Rpm: number;
}

/** Var names the EICAS reads for engine `i` (1-based). */
export interface FusionEngineVars {
  n1: (i: number) => string;
  n2: (i: number) => string;
  itt: (i: number) => string;
  ff: (i: number) => string;
  oilPress: (i: number) => string;
  oilTemp: (i: number) => string;
  vib: (i: number) => string;
  running: (i: number) => string;
  ignition: (i: number) => string;
  /** EPR (BR710 FADEC primary thrust parameter). Missing var = derived from N1 (EST). */
  epr: (i: number) => string;
  /** 1 = FADEC in N1 (alternate) mode (Global Express ENGINE panel EPR / N1 switches). */
  n1Mode: (i: number) => string;
  startState: (i: number) => string;
  revUnlocked: (i: number) => string;
  revDeployed: (i: number) => string;
  /** Thrust rating (string var) and N1 limit / target. */
  rating: string;
  n1Limit: string;
  n1Target: (i: number) => string;
}

export const DEFAULT_ENGINE_VARS: FusionEngineVars = {
  n1: (i) => `eng${i}.n1_pct`,
  n2: (i) => `eng${i}.n2_pct`,
  itt: (i) => `eng${i}.itt_c`,
  ff: (i) => `eng${i}.ff_pph`,
  oilPress: (i) => `eng${i}.oil_press_psi`,
  oilTemp: (i) => `eng${i}.oil_temp_c`,
  vib: (i) => `eng${i}.vib_n1`,
  running: (i) => `eng${i}.running`,
  ignition: (i) => `eng${i}.ignition`,
  epr: (i) => `ac.eng${i}.epr`,
  n1Mode: (i) => `ac.eng${i}.n1_mode`,
  startState: (i) => `fadec.eng${i}.start_state`,
  revUnlocked: (i) => `fadec.eng${i}.rev_unlocked`,
  revDeployed: (i) => `fadec.eng${i}.rev_deployed`,
  rating: 'fadec.rating',
  n1Limit: 'fadec.n1_limit_pct',
  n1Target: (i) => `fadec.eng${i}.n1_target`,
};

export interface FusionEngineConfig {
  name: string;
  count: number;
  limits: FusionEngineLimits;
  vars: FusionEngineVars;
  /** Show the EPR digital readouts above the N1 gauges (EST: BR710 EPR-mode FADEC, Global Express primary EICAS "CRZ EPR"). */
  showEpr: boolean;
}

const psi = (kPa: number): number => Math.round((kPa / 6.894757) * 10) / 10;

/** Rolls-Royce Deutschland BR700-710A2-20 (Global Express / XRS / 6000). EASA TCDS E.018 Issue 16. */
export const BR710A2_20_ENGINES: FusionEngineConfig = {
  name: 'BR710A2-20',
  count: 2,
  limits: {
    n1MaxPct: 102.1, // E.018 IV.2 N1 maximum take-off (BR700-710A2-20)
    n1OverspeedPct: 102.5, // E.018 IV.2 N1 maximum overspeed (20 s)
    n2MaxPct: 99.6, // E.018 IV.2 N2 maximum take-off
    n2MctPct: 98.9, // E.018 IV.2 N2 maximum continuous
    n2OverspeedPct: 99.8, // E.018 IV.2 N2 maximum overspeed (20 s)
    ittStartGroundC: 700, // E.018 IV.1 TGT starting on ground
    ittStartFlightC: 850, // E.018 IV.1 TGT starting in flight
    ittTakeoffC: 900, // E.018 IV.1 TGT take-off (5 min, 10 min OEI)
    ittMctC: 860, // E.018 IV.1 TGT maximum continuous
    ittOvertempC: 905, // E.018 IV.1 maximum overtemperature (20 s)
    oilTempMaxC: 160, // E.018 IV.1 maximum for unrestricted use
    oilTempMinTakeoffC: 20, // E.018 IV.1 minimum for acceleration to take-off
    // E.018 IV.3.2 differential oil pressure, lower limit for flight: 241.2 kPa idle..72.3 % N2,
    // straight line to 310.3 kPa at 90 % N2, 310.3 kPa above.
    oilPressCaution: { n2Lo: 72.3, n2Hi: 90, lowPsi: psi(241.2), highPsi: psi(310.3) },
    // Minimum to complete flight: 172.3 kPa, straight line to 241.2 kPa at 90 % N2.
    oilPressWarning: { n2Lo: 72.3, n2Hi: 90, lowPsi: psi(172.3), highPsi: psi(241.2) },
    thrustTakeoffLbf: 14750, // E.018 III.6 take-off 65.6 kN
    thrustMctLbf: 14455, // E.018 III.6 maximum continuous 64.3 kN
    n1Rpm: 7431, // E.018 IV.2 "100% N1 equals 7431 rpm"
    n2Rpm: 15898, // E.018 IV.2 "100% N2 equals 15898 rpm"
  },
  vars: DEFAULT_ENGINE_VARS,
  showEpr: true,
};

/** Oil pressure limit (psid) at `n2` for a TCDS curve. */
export function oilPressLimit(c: OilPressCurve, n2: number): number {
  if (n2 <= c.n2Lo) return c.lowPsi;
  if (n2 >= c.n2Hi) return c.highPsi;
  return c.lowPsi + ((c.highPsi - c.lowPsi) * (n2 - c.n2Lo)) / (c.n2Hi - c.n2Lo);
}

/** Gauge scale of one EICAS parameter. */
export interface FusionScale {
  min: number;
  max: number;
  /** Amber from this value (NaN = none). */
  amber: number;
  /** Red line (NaN = none). */
  red: number;
  limits: ExceedanceLimits;
}

export interface FusionEngineScales {
  n1: FusionScale;
  itt: FusionScale;
  /** ITT scale while starting on the ground (red line at the start limit). */
  ittStart: FusionScale;
  n2: FusionScale;
  oilTemp: FusionScale;
}

export function engineScales(e: FusionEngineConfig): FusionEngineScales {
  const L = e.limits;
  return {
    // EST: N1 dial 0-110 % with the take-off limit as the red line.
    n1: { min: 0, max: 110, amber: NaN, red: L.n1MaxPct, limits: { warnHigh: L.n1MaxPct + 0.05, flashS: 5 } },
    // EST: ITT dial 0-1000 C, amber band from the MCT limit to the take-off limit (red).
    itt: { min: 0, max: 1000, amber: L.ittMctC, red: L.ittTakeoffC, limits: { cautionHigh: L.ittMctC + 0.5, warnHigh: L.ittTakeoffC + 0.5, flashS: 5 } },
    ittStart: { min: 0, max: 1000, amber: NaN, red: L.ittStartGroundC, limits: { warnHigh: L.ittStartGroundC + 0.5, flashS: 5 } },
    n2: { min: 0, max: 110, amber: L.n2MctPct, red: L.n2MaxPct, limits: { warnHigh: L.n2MaxPct + 0.05, flashS: 5 } },
    oilTemp: { min: -40, max: 180, amber: NaN, red: L.oilTempMaxC, limits: { warnHigh: L.oilTempMaxC + 0.5, flashS: 5 } },
  };
}

// ------------------------------------------------------------------ sensors / radios

export interface FusionSensors {
  /** ADC / IRS (AHRS output) / RA indices per side [pilot, copilot]. */
  adc: readonly [number, number];
  ahrs: readonly [number, number];
  ra: readonly [number, number];
  /** Standby ADC / AHRS (IESI) and the third IRS used by the RSP ATT reversion. */
  standbyAdc: number;
  standbyAhrs: number;
  thirdAhrs: number;
  /** NAV / ADF receivers per side. */
  nav: readonly [number, number];
  adf: readonly [number, number];
  comCount: number;
}

export const DEFAULT_SENSORS: FusionSensors = {
  adc: [1, 2],
  ahrs: [1, 2],
  ra: [1, 2],
  standbyAdc: 3,
  standbyAhrs: 4,
  thirdAhrs: 3, // Laseref 6 IRS 1/2/3 (FSB appendix 6: "Laseref 6 IRSs")
  nav: [1, 2],
  adf: [1, 2],
  comCount: 3,
};

// ------------------------------------------------------------------ events / power

export interface FusionEventMap {
  /** AFCS event prefix (systems/autopilot Afcs default 'ap.'). */
  afcsPrefix: string;
  /** Autothrottle engage toggle (Autothrottle bizjet style). */
  atEngage: string;
  /** FMS EXEC / ERASE events (nav Fms). */
  fmsExec: string;
  fmsErase: string;
}

export const DEFAULT_EVENTS: FusionEventMap = {
  afcsPrefix: 'ap.',
  atEngage: 'at.engage',
  fmsExec: 'fms.exec',
  fmsErase: 'fms.erase',
};

/** Power bindings (systems/util Binding: var, expression, number or function). Unset = always powered. */
export interface FusionPower {
  afd?: readonly [Binding, Binding, Binding, Binding];
  ctp?: readonly [Binding, Binding];
  ccp?: readonly [Binding, Binding];
  mkp?: readonly [Binding, Binding];
  fcp?: Binding;
  rsp?: Binding;
  iesi?: Binding;
}

// ------------------------------------------------------------------ suite config

export interface FusionSuiteConfig {
  airframe: FusionAirframe;
  engines: FusionEngineConfig;
  sensors?: Partial<FusionSensors>;
  events?: Partial<FusionEventMap>;
  power?: FusionPower;
  /** Aircraft checklists (AircraftInstance.checklists) for the electronic checklist. */
  checklists?: readonly Checklist[];
  /** CAS message id -> checklist title, for the CAS-linked ECL (FSB: "ECL linked to selected CAS messages"). */
  casChecklists?: Readonly<Record<string, string>>;
  /** Synoptic readout bindings (logic/readouts.ts keys -> Binding). Merged over DEFAULT_READOUT_BINDINGS. */
  synopticBindings?: Readonly<Record<string, Binding>>;
  /** Display id prefix (default 'fusion'). */
  idPrefix?: string;
  /** Canvas pixels per logical pixel. */
  pixelRatio?: number;
  /** AFD power-up test duration (s). EST 18 s. */
  afdBootS?: number;
  /** Fuel quantity unit on the EICAS / synoptics (Global Express FMQGC: pounds standard, kilograms optional). */
  fuelUnit?: 'lb' | 'kg';
  /** Transition altitude (ft) for FL display in the FMS. */
  transitionAltFt?: number;
  /**
   * (Appended by global6000.) Global Vision CTP: the TUNE/DATA knob sets the on-side selected course while the CTP
   * shows its PFD page (TUNE/MENU key), instead of switching back to the radio page. Default false.
   */
  ctpCourseOnPfdPage?: boolean;
}

export interface FusionResolvedConfig extends Required<Omit<FusionSuiteConfig, 'sensors' | 'events' | 'power' | 'checklists' | 'casChecklists' | 'synopticBindings'>> {
  sensors: FusionSensors;
  events: FusionEventMap;
  power: FusionPower;
  checklists: readonly Checklist[];
  casChecklists: Readonly<Record<string, string>>;
  synopticBindings: Readonly<Record<string, Binding>>;
  scales: FusionEngineScales;
}

export function resolveConfig(c: FusionSuiteConfig): FusionResolvedConfig {
  return {
    airframe: c.airframe,
    engines: c.engines,
    sensors: { ...DEFAULT_SENSORS, ...(c.sensors ?? {}) },
    events: { ...DEFAULT_EVENTS, ...(c.events ?? {}) },
    power: c.power ?? {},
    checklists: c.checklists ?? [],
    casChecklists: c.casChecklists ?? {},
    synopticBindings: c.synopticBindings ?? {},
    idPrefix: c.idPrefix ?? 'fusion',
    pixelRatio: c.pixelRatio ?? 1,
    afdBootS: c.afdBootS ?? 18, // EST: IMA avionics power-up with display self test, typical 15-20 s
    fuelUnit: c.fuelUnit ?? 'lb',
    transitionAltFt: c.transitionAltFt ?? 18000, // FAA transition altitude (14 CFR 91.121)
    ctpCourseOnPfdPage: c.ctpCourseOnPfdPage ?? false,
    scales: engineScales(c.engines),
  };
}

// ------------------------------------------------------------------ airframe helpers

/** VMO (KIAS) at pressure altitude (step schedule). */
export function vmoAt(af: FusionAirframe, altFt: number): number {
  let v = af.vmo[0][1];
  for (const [a, kt] of af.vmo) if (altFt >= a) v = kt;
  return v;
}

/** MMO at pressure altitude (linear between breakpoints, clamped). */
export function mmoAt(af: FusionAirframe, altFt: number): number {
  const m = af.mmo;
  if (altFt <= m[0][0]) return m[0][1];
  for (let i = 1; i < m.length; i++) {
    if (altFt <= m[i][0]) {
      const [a0, v0] = m[i - 1];
      const [a1, v1] = m[i];
      return v0 + ((v1 - v0) * (altFt - a0)) / (a1 - a0);
    }
  }
  return m[m.length - 1][1];
}

/** Nearest flap detent to a lever value. */
export function flapDetentFor(af: FusionAirframe, lever: number): FusionFlapDetent {
  let best = af.flaps[0];
  for (const d of af.flaps) if (Math.abs(d.lever - lever) < Math.abs(best.lever - lever)) best = d;
  return best;
}
