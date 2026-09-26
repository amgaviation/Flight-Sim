/**
 * Configuration of a G3000 / G5000 installation. The aircraft module (Citation
 * M2: G3000, Citation Longitude: G5000) builds one `G3000Config`, usually by
 * spreading a layout preset from `presets.ts` and adding its own numbers
 * (gauge limits, V-speeds, weights, performance providers, synoptic pages,
 * power bindings):
 *
 *   const suite = new G3000Suite(ctx, {
 *     ...G3000_M2_LAYOUT,
 *     aircraftId: 'citation-m2', aircraftName: 'Citation M2',
 *     eis: myEis, vspeeds: M2_VSPEEDS, weights: M2_WEIGHTS,
 *     power: { pfd1: 'elec.avn1_powered', mfd: 'elec.avn1_powered', pfd2: 'elec.avn2_powered', ... },
 *     fms, radios,
 *   });
 *
 * Every field except `aircraftId` and `variant` has a default so tests and
 * previews can instantiate the suite with very little. Defaults are resolved
 * once by `resolveConfig`.
 */
import type { Binding } from '../../systems/util/binding';
import type { GaugeScale } from '../common/draw/EngineIndications';
import type { SpeedRange } from '../common/draw/SpeedTape';
import type { CasModel } from '../common/draw/CasWindow';
import type { Checklist } from '../../aircraft/types';
import type { Fms, FmsOptions } from '../../nav/fms/Fms';
import type { Radios, RadiosOptions } from '../../nav/Radios';
import type { SynopticPageDef } from './gdu/synoptic';
import type { GduId, GtcId, GtcModeName, PaneId, PaneContent } from './vars';
import { PANE_CONTENT } from './vars';

export type G3000Variant = 'g3000' | 'g5000';

// ------------------------------------------------------------------ GTC

export interface GtcConfig {
  id: GtcId;
  /**
   * GTC 570: 5.7 in portrait (480 x 640 px) with a map knob (joystick), a
   * center knob and a dual concentric right knob below the screen. GTC 580:
   * 5.8 in landscape (1280 x 768 px) with a dual concentric upper knob, three
   * mode softkeys and a lower knob on the right bezel (PG 190-02046-01 §1.3,
   * Figure 1-12). Orientation follows the model unless overridden.
   */
  model: 'GTC570' | 'GTC580';
  orientation?: 'vertical' | 'horizontal';
  /** On-side PFD (1 pilot, 2 copilot). */
  side: 1 | 2;
  /** Control modes this unit offers; the first is the power-up mode. */
  modes: GtcModeName[];
  /** Show the CNS (COM / XPDR) bar at the top of every screen (G5000 and vertical GTCs). */
  cnsBar?: boolean;
  /** Panes this GTC may select in MFD mode (PG §1.3 "Controlling Display Panes"). */
  panes?: PaneId[];
  /** Power binding (default: always on). */
  power?: Binding;
  /** Canvas pixels per logical pixel (default 0.8 for GTC 580, 1 for GTC 570). */
  pixelRatio?: number;
}

// ------------------------------------------------------------------ EIS

/** Per-engine var builder (1-based engine index). */
export type EngineVar = (engine: number) => string;

export interface EisN1Section {
  kind: 'n1';
  scale: GaugeScale;
  /** N1 actual (default eng{i}.n1_pct). */
  var?: EngineVar;
  /** FADEC thrust-mode label string var (default fadec.eng{i}.detent) shown above the dials. */
  detentVar?: EngineVar;
  /** N1 reference/limit bug var (default fadec.n1_limit_pct; Longitude "N1 V bug"). */
  limitVar?: string;
  /** Commanded N1 var (Longitude "T bug"; default fadec.eng{i}.n1_target, '' = none). */
  commandVar?: EngineVar;
  /** Reverser deployed / unlocked vars ('' = none). */
  reverserVar?: EngineVar;
  reverserUnlockedVar?: EngineVar;
  /** Fan sync var (0/1, '' = none). */
  syncVar?: string;
  /** Autothrottle engaged var (bugs magenta). Default ap.at_engaged. */
  atVar?: string;
}

export interface EisIttSection {
  kind: 'itt';
  scale: GaugeScale;
  /** Scale used while the engine is starting (hot-start red line). */
  startScale?: GaugeScale;
  var?: EngineVar;
  /** Engine starting var (START shown; default fadec.eng{i}.start_state in 1..3). */
  startingVar?: EngineVar;
  fireVar?: EngineVar;
  /** Longitude: ITT digits hidden once the engine runs (Operators Guide 7-8). */
  digitsOnlyWhenNotRunning?: boolean;
  /** Start pressure var shown between the dials before start (Longitude "START PSI"). */
  startPsiVar?: string;
}

export interface EisDigitalRow {
  label: string;
  vars: string[];
  decimals: 0 | 1 | 2;
  /** Exceedance limits (caution amber / warning red). */
  limits?: { cautionLow?: number; cautionHigh?: number; warnLow?: number; warnHigh?: number };
  /** Rounding step for the readout (e.g. 10 for fuel flow). */
  step?: number;
  /** Unit label drawn left of the first value (e.g. 'PPH'). */
  unitLeft?: string;
  /** Scale multiplier applied to the var (e.g. kg->lb). */
  factor?: number;
  /** Extra green annotation var per engine (IGN / SYNC), '' = none. */
  flagVars?: string[];
  flagText?: string;
}

export interface EisDigitalSection {
  kind: 'digital';
  rows: EisDigitalRow[];
}

export interface EisOatSection {
  kind: 'oat';
  /** Temperatures (deg C) read from the selected ADC: RAT (TAT), SAT, ISA dev. */
  showRat?: boolean;
}

export interface EisFuelSection {
  kind: 'fuel';
  /** Tank quantity vars (kg, the fuel system's units). */
  tanks: [string, string];
  /** Displayed unit. */
  unit: 'lb' | 'kg';
  tempVar?: string;
  /** Low-fuel caution per tank in the displayed unit. */
  lowLevel?: number;
  /** Imbalance caution in the displayed unit (Longitude 500 lb, Operators Guide 6-5). */
  imbalance?: number;
  /** Bar graph capacity per tank in the displayed unit (0 = digital only). */
  capacity?: number;
}

export interface EisTrimSection {
  kind: 'trim';
  pitch?: { var: string; min: number; max: number; takeoffBand?: [number, number]; label?: string };
  roll?: { var: string; min: number; max: number };
  yaw?: { var: string; min: number; max: number };
}

export interface EisFlapsSection {
  kind: 'flaps';
  var: string;
  maxDeg: number;
  /** Detent angles (deg) with labels for the scale. */
  detents: { deg: number; label: string }[];
  speedbrakeVar?: string;
  /** Speedbrake annunciation text ('SPD BRK'). */
  speedbrakeLabel?: string;
  gearVars?: [string, string, string];
}

export interface EisCabinSection {
  kind: 'cabin';
  altVar?: string;
  rateVar?: string;
  diffVar?: string;
  ldgElevVar?: string;
  oxygenVar?: string;
  /** Cabin altitude warning (ft) and differential limits (psi). */
  altWarnFt?: number;
  diffMaxPsi?: number;
}

export interface EisElecSection {
  kind: 'elec';
  rows: { label: string; vars: string[]; decimals: 0 | 1; limits?: EisDigitalRow['limits'] }[];
}

export interface EisApuSection {
  kind: 'apu';
  rpmVar: string;
  egtVar: string;
  runningVar: string;
}

export interface EisCasSection {
  kind: 'cas';
  /** Rows shown (G5000 XLS: up to 13, CRG 190-02538-02 "Crew Alerting System"). */
  rows?: number;
}

export interface EisCustomSection {
  kind: 'custom';
  height: number;
  draw: (ctx: import('../common/draw/context').Ctx2D, x: number, y: number, w: number, h: number, vars: import('../../core/SimVars').SimVars) => void;
}

export type EisSection =
  | EisN1Section
  | EisIttSection
  | EisDigitalSection
  | EisOatSection
  | EisFuelSection
  | EisTrimSection
  | EisFlapsSection
  | EisCabinSection
  | EisElecSection
  | EisApuSection
  | EisCasSection
  | EisCustomSection;

export interface EisConfig {
  engines: 1 | 2;
  /** Width of the EIS strip on the MFD (logical px of the 1280 x 800 GDU). */
  width?: number;
  /** Sections top to bottom. A 'cas' section expands to fill the remaining height. */
  sections: EisSection[];
  /** Condensed section list for the reversionary PFD (default: the n1/itt/digital sections + cas). */
  reversionary?: EisSection[];
}

// ------------------------------------------------------------------ speeds and performance

export interface VSpeedDef {
  /** Id used in vars and TOLD results ('V1', 'VR', 'V2', 'VENR', 'VREF', 'VAPP'). */
  id: string;
  /** Flag label on the tape ('1', 'R', '2', 'T', 'RF', 'AP'). */
  label: string;
  group: 'takeoff' | 'landing' | 'other';
  /** Default value (kt); undefined = must be entered (bug cannot be enabled until set). */
  defaultKt?: number;
}

export interface SpeedTapeConfig {
  /** Vmo var (default overspeed.vmo_kt, written by systems/warning Overspeed). */
  vmoVar?: string;
  /** Fixed Vmo fallback when the var is absent (kt). */
  vmoKt?: number;
  /** Normalized AoA (1 = stall) used for the low-speed red band. Default stall.aoa_norm. */
  aoaNormVar?: string;
  /** Normalized AoA of the stick shaker (red band top) and of the amber caution band top. */
  shakerNorm?: number;
  cautionNorm?: number;
  /** Static coloured ranges (piston style); normally empty for jets. */
  ranges?: SpeedRange[];
  /** Approach reference (green circle) from the AoA: normalized AoA 0.66 (Longitude OG 4-6). */
  approachRefNorm?: number;
}

export interface TakeoffInput {
  airport: string;
  runway: string;
  runwayLengthFt: number;
  runwayElevFt: number;
  runwayHeadingMag: number;
  windDirMag: number;
  windKt: number;
  oatC: number;
  qnhInHg: number;
  weightLb: number;
  flaps: string;
  antiIce: boolean;
  slope: number;
  wet: boolean;
}

export interface TakeoffResult {
  vspeeds: Record<string, number>;
  /** Takeoff N1 (percent) and field length required (ft). */
  n1Pct?: number;
  fieldLengthFt?: number;
  /** Text lines of additional output ('BFL 3,450 FT'). */
  notes?: string[];
}

export interface LandingInput {
  airport: string;
  runway: string;
  runwayLengthFt: number;
  runwayElevFt: number;
  runwayHeadingMag: number;
  windDirMag: number;
  windKt: number;
  oatC: number;
  qnhInHg: number;
  weightLb: number;
  flaps: string;
  antiIce: boolean;
  wet: boolean;
}

export interface LandingResult {
  vspeeds: Record<string, number>;
  fieldLengthFt?: number;
  notes?: string[];
}

export interface PerformanceProvider {
  takeoffFlaps: string[];
  landingFlaps: string[];
  takeoff(input: TakeoffInput): TakeoffResult | null;
  landing(input: LandingInput): LandingResult | null;
}

export interface WeightsConfig {
  /** Basic operating weight default (lb). */
  basicOperatingLb: number;
  maxRampLb: number;
  maxTakeoffLb: number;
  maxLandingLb: number;
  maxZeroFuelLb: number;
  /** Standard passenger weight (lb) for the pax count entry. */
  paxLb?: number;
  maxPax?: number;
}

// ------------------------------------------------------------------ AFCS

export interface AfcsUiConfig {
  /** Afcs event prefix (default 'ap.'). */
  eventPrefix?: string;
  /** Autothrottle installed (G5000 Longitude). */
  autothrottle?: boolean;
  /** Speed knob with FMS/MAN push (Longitude) instead of the SPD key only. */
  speedKnob?: boolean;
  /** Remap FMA strings (e.g. { VPTH: 'PATH' } for the G5000). */
  labelMap?: Record<string, string>;
  /** Selected altitude limits (ft). */
  maxSelAltFt?: number;
}

// ------------------------------------------------------------------ main config

export interface G3000Config {
  variant: G3000Variant;
  aircraftId: string;
  /** Name on the MFD splash ('Citation M2'). */
  aircraftName?: string;
  /** System software label on the splash. */
  softwareVersion?: string;
  /** Number of PFDs (1 or 2) and the MFD (always 1 here). */
  pfdCount?: 1 | 2;
  /** GTCs; default two GTC 570 in the pedestal. */
  gtcs?: GtcConfig[];
  /** Where CAS messages are displayed: 'mfd' (EIS strip, M2/XLS) or 'pfd' (Longitude: PFD lower inboard corner). */
  casLocation?: 'mfd' | 'pfd';
  /** CAS model to display; the aircraft adds it as a sink to its CasManager. Created when absent. */
  casModel?: CasModel;
  eis?: EisConfig;
  vspeeds?: VSpeedDef[];
  speedTape?: SpeedTapeConfig;
  performance?: PerformanceProvider;
  weights?: WeightsConfig;
  afcs?: AfcsUiConfig;
  /** Synoptic pages available on the MFD (aircraft-supplied data providers). */
  synoptics?: SynopticPageDef[];
  checklists?: Checklist[];
  /** Power bindings per unit (default: always powered). */
  power?: Partial<Record<GduId | GtcId, Binding>>;
  /** GMC 710 AFCS controller power (default: always powered). */
  gmcPower?: Binding;
  /**
   * Power of the integrated radios created by the suite (GIA 63W NAV / GPS,
   * marker, ADF) when `radiosInstance` is absent: written each frame to
   * `nav{r}.powered`, `gps.powered`, `nav.marker_powered`, `adf1.powered`.
   * Default: follows the PFD1 power binding (EST: the GIAs share the
   * avionics bus with the displays).
   */
  radioPower?: Partial<Record<'nav1' | 'nav2' | 'gps' | 'marker' | 'adf', Binding>>;
  /** Boot times (s): GDU self test until the display draws, GTC. EST. */
  bootS?: { gdu?: number; gtc?: number };
  /** Sensor counts. */
  sensors?: { adc?: number; ahrs?: number; radioAltimeter?: boolean };
  /** NAV receivers, ADF and DME tuning windows present. */
  radios?: { nav?: number; com?: number; adf?: boolean; dme?: boolean; xpdr?: number };
  /** Existing FMS / radios (the aircraft owns their order in the systems list). */
  fms?: Fms;
  radiosInstance?: Radios;
  /** Engine count for the FMS created by the suite when `fms` is absent. */
  engineCount?: number;
  /** Options for the FMS / radios the suite creates when `fms` / `radiosInstance` are absent. */
  fmsOptions?: FmsOptions;
  radiosOptions?: RadiosOptions;
  /** TAWS class for annunciations ('A' Longitude, 'B' M2) and traffic system. */
  taws?: 'A' | 'B';
  traffic?: 'TAS' | 'TCAS2';
  /** Traffic threats (systems/warning Tcas `threats`) for the maps. */
  trafficSource?: { threats: readonly { relBrgDeg: number; rangeNm: number; relAltFt: number; vsSign: number; level: number }[] };
  /** Units. */
  units?: { weight?: 'lb' | 'kg'; fuel?: 'lb' | 'kg'; temp?: 'C' | 'F' };
  /** Fuel quantity total (kg) and per-engine fuel flow (pph) vars. */
  fuelTotalVar?: string;
  fuelFlowVar?: EngineVar;
  /** Default content of each pane at power-up. */
  defaultPanes?: Partial<Record<PaneId, PaneContent>>;
  /** Gear down var for the AOA auto mode and TAWS (default gear.down_locked). */
  gearDownVar?: string;
  /** Flaps angle var (default surf.flaps_deg). */
  flapsVar?: string;
  /** Radio altimeter index (default 1). */
  raIndex?: number;
  /** Design pixel ratio of the GDU canvases (default 0.8: 1280 x 800 logical -> 1024 x 640 texture). */
  gduPixelRatio?: number;
  /**
   * Switch to reversionary mode automatically when a display fails (default
   * false: PG §1.4 "The system does not automatically switch to reversionary
   * mode"; the crew uses the DISPLAY REVERSION switches `g3k.rev_sw.<gdu>`).
   */
  autoReversion?: boolean;
}

/** Fully resolved config (every optional field filled). */
export interface G3000Resolved {
  variant: G3000Variant;
  aircraftId: string;
  aircraftName: string;
  softwareVersion: string;
  pfdCount: 1 | 2;
  gtcs: ResolvedGtc[];
  casLocation: 'mfd' | 'pfd';
  eis: EisConfig;
  vspeeds: VSpeedDef[];
  speedTape: Required<Omit<SpeedTapeConfig, 'vmoKt'>> & { vmoKt: number };
  performance: PerformanceProvider | null;
  weights: WeightsConfig;
  afcs: Required<AfcsUiConfig>;
  synoptics: SynopticPageDef[];
  checklists: Checklist[];
  power: Partial<Record<GduId | GtcId, Binding>>;
  gmcPower: Binding | undefined;
  radioPower: Partial<Record<'nav1' | 'nav2' | 'gps' | 'marker' | 'adf', Binding>>;
  bootS: { gdu: number; gtc: number };
  sensors: { adc: number; ahrs: number; radioAltimeter: boolean };
  radios: { nav: number; com: number; adf: boolean; dme: boolean; xpdr: number };
  taws: 'A' | 'B';
  traffic: 'TAS' | 'TCAS2';
  units: { weight: 'lb' | 'kg'; fuel: 'lb' | 'kg'; temp: 'C' | 'F' };
  fuelTotalVar: string;
  fuelFlowVar: EngineVar;
  defaultPanes: Record<PaneId, PaneContent>;
  gearDownVar: string;
  flapsVar: string;
  raIndex: number;
  gduPixelRatio: number;
  autoReversion: boolean;
}

export interface ResolvedGtc {
  id: GtcId;
  model: 'GTC570' | 'GTC580';
  orientation: 'vertical' | 'horizontal';
  side: 1 | 2;
  modes: GtcModeName[];
  cnsBar: boolean;
  panes: PaneId[];
  power?: Binding;
  pixelRatio: number;
}

/** Default GTC set: two GTC 570 in the pedestal, each controlling its own side's panes (Citation M2). */
export const DEFAULT_GTCS: GtcConfig[] = [
  { id: 'gtc1', model: 'GTC570', side: 1, modes: ['MFD', 'PFD', 'NAVCOM'], panes: ['pfd1', 'mfd1'] },
  { id: 'gtc2', model: 'GTC570', side: 2, modes: ['MFD', 'PFD', 'NAVCOM'], panes: ['mfd2', 'pfd2'] },
];

/** Minimal EIS used when an aircraft gives none (placeholder scales, EST). */
export const PLACEHOLDER_EIS: EisConfig = {
  engines: 2,
  sections: [
    {
      kind: 'n1',
      scale: {
        min: 0, max: 110, bands: [{ from: 20, to: 100, color: '#00c000' }], redlines: [104], amberlines: [], ticks: [0, 20, 40, 60, 80, 100], labels: [],
        limits: { warnHigh: 104 }, decimals: 1, readoutStep: 0, unit: '%',
      },
    },
    {
      kind: 'itt',
      scale: {
        min: 0, max: 1000, bands: [{ from: 200, to: 900, color: '#00c000' }], redlines: [950], amberlines: [900], ticks: [0, 200, 400, 600, 800, 1000], labels: [],
        limits: { cautionHigh: 900, warnHigh: 950 }, decimals: 0, readoutStep: 1, unit: '°C',
      },
    },
    { kind: 'digital', rows: [
      { label: 'N2%', vars: ['eng1.n2_pct', 'eng2.n2_pct'], decimals: 1 },
      { label: 'OIL PSI', vars: ['eng1.oil_press_psi', 'eng2.oil_press_psi'], decimals: 0 },
      { label: 'OIL °C', vars: ['eng1.oil_temp_c', 'eng2.oil_temp_c'], decimals: 0 },
      { label: 'FUEL PPH', vars: ['eng1.ff_pph', 'eng2.ff_pph'], decimals: 0, step: 10 },
    ] },
    { kind: 'fuel', tanks: ['fuel.tank0_kg', 'fuel.tank1_kg'], unit: 'lb' },
    { kind: 'cas' },
  ],
};

export function resolveGtc(g: GtcConfig): ResolvedGtc {
  const orientation = g.orientation ?? (g.model === 'GTC580' ? 'horizontal' : 'vertical');
  return {
    id: g.id,
    model: g.model,
    orientation,
    side: g.side,
    modes: g.modes.length ? g.modes : ['MFD'],
    cnsBar: g.cnsBar ?? orientation === 'vertical',
    panes: g.panes ?? (g.side === 1 ? ['pfd1', 'mfd1'] : ['mfd2', 'pfd2']),
    power: g.power,
    pixelRatio: g.pixelRatio ?? (orientation === 'horizontal' ? 0.8 : 1),
  };
}

/** Fills every default. Pure: safe to call in tests. */
export function resolveConfig(c: G3000Config): G3000Resolved {
  const g5k = c.variant === 'g5000';
  const st = c.speedTape ?? {};
  return {
    variant: c.variant,
    aircraftId: c.aircraftId,
    aircraftName: c.aircraftName ?? c.aircraftId,
    softwareVersion: c.softwareVersion ?? (g5k ? 'System 3343.02' : 'System 2234.03'),
    pfdCount: c.pfdCount ?? 2,
    gtcs: (c.gtcs ?? DEFAULT_GTCS).map(resolveGtc),
    casLocation: c.casLocation ?? 'mfd',
    eis: c.eis ?? PLACEHOLDER_EIS,
    vspeeds: c.vspeeds ?? [],
    speedTape: {
      vmoVar: st.vmoVar ?? 'overspeed.vmo_kt',
      vmoKt: st.vmoKt ?? NaN,
      aoaNormVar: st.aoaNormVar ?? 'stall.aoa_norm',
      shakerNorm: st.shakerNorm ?? 0.85,
      cautionNorm: st.cautionNorm ?? 0.8,
      ranges: st.ranges ?? [],
      approachRefNorm: st.approachRefNorm ?? 0.66,
    },
    performance: c.performance ?? null,
    weights: c.weights ?? { basicOperatingLb: 0, maxRampLb: 0, maxTakeoffLb: 0, maxLandingLb: 0, maxZeroFuelLb: 0, paxLb: 200, maxPax: 8 },
    afcs: {
      eventPrefix: c.afcs?.eventPrefix ?? 'ap.',
      autothrottle: c.afcs?.autothrottle ?? g5k,
      speedKnob: c.afcs?.speedKnob ?? g5k,
      labelMap: c.afcs?.labelMap ?? (g5k ? { VPTH: 'PATH' } : {}),
      maxSelAltFt: c.afcs?.maxSelAltFt ?? 50000,
    },
    synoptics: c.synoptics ?? [],
    checklists: c.checklists ?? [],
    power: c.power ?? {},
    gmcPower: c.gmcPower,
    radioPower: c.radioPower ?? {},
    bootS: { gdu: c.bootS?.gdu ?? 12, gtc: c.bootS?.gtc ?? 8 },
    sensors: { adc: c.sensors?.adc ?? 2, ahrs: c.sensors?.ahrs ?? 2, radioAltimeter: c.sensors?.radioAltimeter ?? true },
    radios: {
      nav: c.radios?.nav ?? 2,
      com: c.radios?.com ?? 2,
      adf: c.radios?.adf ?? false,
      dme: c.radios?.dme ?? true,
      xpdr: c.radios?.xpdr ?? 2,
    },
    taws: c.taws ?? (g5k ? 'A' : 'B'),
    traffic: c.traffic ?? (g5k ? 'TCAS2' : 'TAS'),
    units: { weight: c.units?.weight ?? 'lb', fuel: c.units?.fuel ?? 'lb', temp: c.units?.temp ?? 'C' },
    fuelTotalVar: c.fuelTotalVar ?? 'fuel.total_kg',
    fuelFlowVar: c.fuelFlowVar ?? ((e: number) => `eng${e}.ff_pph`),
    defaultPanes: {
      pfd1: c.defaultPanes?.pfd1 ?? PANE_CONTENT.navMap,
      mfd1: c.defaultPanes?.mfd1 ?? PANE_CONTENT.navMap,
      mfd2: c.defaultPanes?.mfd2 ?? PANE_CONTENT.flightPlan,
      pfd2: c.defaultPanes?.pfd2 ?? PANE_CONTENT.navMap,
    },
    gearDownVar: c.gearDownVar ?? 'gear.down_locked',
    flapsVar: c.flapsVar ?? 'surf.flaps_deg',
    raIndex: c.raIndex ?? 1,
    gduPixelRatio: c.gduPixelRatio ?? 0.8,
    autoReversion: c.autoReversion ?? false,
  };
}
