/**
 * Installation layout presets for the two supported aircraft. The aircraft
 * module spreads one into its `G3000Config` and overrides anything it models
 * differently (engine vars, fuel tank vars, synoptic pages, power bindings,
 * performance provider):
 *
 *   new G3000Suite(ctx, { ...G3000_M2_LAYOUT, aircraftId: 'citation-m2', power: {...}, synoptics: M2_SYNOPTICS });
 *
 * Numbers and their sources
 *  - Citation M2 (Model 525, 2 x Williams FJ44-1AP-21): weights, Vmo 263 KIAS
 *    / Mmo 0.71 and FL410 from Textron / flyradius.com "Cessna Citation M2
 *    Specifications" (max ramp 10,800, MTOW 10,700, MLW 9,900, MZFW 8,400 lb,
 *    usable fuel 3,296 lb); engine limits from the FJ44-1AP-21 type data
 *    (flyradius.com "Engine - FJ44-1AP-21": ITT 855 °C takeoff 5 min / 835 °C
 *    max continuous, N1 104.69 %, N2 100 %, oil 23-120 psig, oil 135 °C).
 *  - Citation Longitude (Model 700, 2 x Honeywell HTF7700L): Longitude
 *    Operator's Guide "Operating Limitations" p.1-1..1-4 (max ramp 39,700,
 *    MTOW 39,500, MLW 33,500, MZFW 26,800 lb; ITT 955 °C takeoff / 950 °C
 *    climb / 650 °C start; N1 96.79 %, N2 98.62 % (99.90 % transient);
 *    Vmo 325 KIAS, Mmo 0.84; FL450; fuel imbalance 500 lb).
 * Values marked EST are estimates for the display layout (scale ends, tick
 * spacing, default V-speeds at typical weights) and should be replaced by the
 * aircraft module when it has AFM data.
 */
import type { EisConfig, G3000Config, GtcConfig, VSpeedDef } from './config';
import type { GaugeScale } from '../common/draw/EngineIndications';
import { PANE_CONTENT } from './vars';

const GREEN = '#00d000';

// ------------------------------------------------------------------ Citation M2 (G3000)

const M2_N1: GaugeScale = {
  min: 0,
  max: 110, // EST scale end
  bands: [{ from: 0, to: 104.7, color: '#ffffff' }],
  redlines: [104.7], // FJ44-1AP-21: 104.69 % (18,055 rpm)
  amberlines: [],
  ticks: [0, 20, 40, 60, 80, 100],
  labels: [],
  limits: { warnHigh: 104.7 },
  decimals: 1,
  readoutStep: 0,
  unit: '%',
};

const M2_ITT: GaugeScale = {
  min: 0,
  max: 1000, // EST scale end
  bands: [
    { from: 200, to: 835, color: GREEN },
    { from: 835, to: 855, color: '#ffc000' },
  ],
  redlines: [855], // takeoff 5 min limit
  amberlines: [835], // max continuous
  ticks: [0, 200, 400, 600, 800, 1000],
  labels: [],
  limits: { cautionHigh: 835, warnHigh: 855 },
  decimals: 0,
  readoutStep: 1,
  unit: '°C',
};

/** Citation M2 MFD EIS strip: N1, ITT, N2 / oil / fuel flow, fuel quantity, trims, flaps and speedbrake, CAS. */
export const M2_EIS: EisConfig = {
  engines: 2,
  sections: [
    { kind: 'n1', scale: M2_N1, commandVar: () => '', limitVar: 'fadec.n1_limit_pct' },
    { kind: 'itt', scale: M2_ITT },
    {
      kind: 'digital',
      rows: [
        { label: 'N2 %', vars: ['eng1.n2_pct', 'eng2.n2_pct'], decimals: 1, limits: { warnHigh: 100.0 } },
        { label: 'OIL PSI', vars: ['eng1.oil_press_psi', 'eng2.oil_press_psi'], decimals: 0, limits: { warnLow: 23, warnHigh: 120 } },
        { label: 'OIL °C', vars: ['eng1.oil_temp_c', 'eng2.oil_temp_c'], decimals: 0, limits: { warnHigh: 135 } },
        { label: 'FUEL PPH', vars: ['eng1.ff_pph', 'eng2.ff_pph'], decimals: 0, step: 10 },
      ],
    },
    { kind: 'fuel', tanks: ['fuel.tank0_kg', 'fuel.tank1_kg'], unit: 'lb', capacity: 1648, lowLevel: 190, imbalance: 200 }, // capacity = 3,296 / 2; low 190 lb / imbalance 200 lb EST
    { kind: 'trim', pitch: { var: 'surf.pitch_trim', min: -1, max: 1, takeoffBand: [0.1, 0.45] }, roll: { var: 'surf.aileron_trim', min: -1, max: 1 }, yaw: { var: 'surf.rudder_trim', min: -1, max: 1 } }, // takeoff band EST
    { kind: 'flaps', var: 'surf.flaps_deg', maxDeg: 35, detents: [{ deg: 0, label: 'UP' }, { deg: 15, label: 'T/O' }, { deg: 35, label: 'LAND' }], speedbrakeVar: 'surf.speedbrake', speedbrakeLabel: 'SPD BRK' },
    { kind: 'cas', rows: 11 }, // G3000: up to 11 CAS messages (PG §3.3)
  ],
};

/** M2 V-speed bugs: defaults are EST values at typical weights (the crew / TOLD sets the real ones). */
export const M2_VSPEEDS: VSpeedDef[] = [
  { id: 'V1', label: '1', group: 'takeoff', defaultKt: 100 },
  { id: 'VR', label: 'R', group: 'takeoff', defaultKt: 104 },
  { id: 'V2', label: '2', group: 'takeoff', defaultKt: 113 },
  { id: 'VENR', label: 'EN', group: 'takeoff', defaultKt: 140 },
  { id: 'VREF', label: 'RF', group: 'landing', defaultKt: 108 },
  { id: 'VAPP', label: 'AP', group: 'landing', defaultKt: 113 },
];

/** Two GTC 570 in the pedestal, each with the three control modes (EST mode set). */
export const M2_GTCS: GtcConfig[] = [
  { id: 'gtc1', model: 'GTC570', side: 1, modes: ['MFD', 'PFD', 'NAVCOM'], panes: ['pfd1', 'mfd1'], cnsBar: true },
  { id: 'gtc2', model: 'GTC570', side: 2, modes: ['MFD', 'PFD', 'NAVCOM'], panes: ['mfd2', 'pfd2'], cnsBar: true },
];

export const G3000_M2_LAYOUT: Omit<G3000Config, 'aircraftId'> = {
  variant: 'g3000',
  aircraftName: 'Citation M2',
  pfdCount: 2,
  gtcs: M2_GTCS,
  casLocation: 'mfd',
  eis: M2_EIS,
  vspeeds: M2_VSPEEDS,
  speedTape: { vmoKt: 263 },
  weights: { basicOperatingLb: 6960, maxRampLb: 10800, maxTakeoffLb: 10700, maxLandingLb: 9900, maxZeroFuelLb: 8400, paxLb: 200, maxPax: 7 }, // BOW EST (standard empty 6,746 lb + crew items)
  afcs: { autothrottle: false, speedKnob: false, maxSelAltFt: 41000 },
  sensors: { adc: 2, ahrs: 2, radioAltimeter: true },
  radios: { nav: 2, com: 2, adf: false, dme: true, xpdr: 2 },
  taws: 'B',
  traffic: 'TAS',
  engineCount: 2,
  defaultPanes: { mfd1: PANE_CONTENT.navMap, mfd2: PANE_CONTENT.flightPlan, pfd1: PANE_CONTENT.navMap, pfd2: PANE_CONTENT.navMap },
};

// ------------------------------------------------------------------ Citation Longitude (G5000)

const LON_N1: GaugeScale = {
  min: 0,
  max: 110, // EST scale end
  bands: [{ from: 0, to: 96.8, color: '#ffffff' }],
  redlines: [96.8], // takeoff / APR 96.79 %
  amberlines: [],
  ticks: [0, 20, 40, 60, 80, 100],
  labels: [],
  limits: { warnHigh: 96.8 },
  decimals: 1,
  readoutStep: 0,
  unit: '%',
};

const LON_ITT: GaugeScale = {
  min: 0,
  max: 1100, // EST scale end
  bands: [{ from: 300, to: 950, color: GREEN }], // green lower end EST
  redlines: [955], // takeoff / APR limit
  amberlines: [950], // CLB continuous
  ticks: [0, 200, 400, 600, 800, 1000],
  labels: [],
  limits: { cautionHigh: 950, warnHigh: 955 },
  decimals: 0,
  readoutStep: 1,
  unit: '°C',
};

const LON_ITT_START: GaugeScale = { ...LON_ITT, redlines: [650], amberlines: [], bands: [{ from: 0, to: 650, color: GREEN }], limits: { warnHigh: 650 } };

/** Longitude EIS (top-left of the MFD): N1 with thrust mode, T / V bugs and reversers; ITT with start PSI; digital engine rows; fuel; flaps / spoilers / gear; trims. CAS is on the PFDs. */
export const LONGITUDE_EIS: EisConfig = {
  engines: 2,
  sections: [
    // Thrust mode: the governing FADEC rating (aircraft/citation-longitude/systems/crewControls.ts), magenta under the A/T (OG 7-7).
    { kind: 'n1', scale: LON_N1, reverserVar: (e) => `eng${e}.reverser_pos`, detentVar: (e) => `ac.lon.eng${e}.thrust_mode`, modeColorByAt: true },
    { kind: 'itt', scale: LON_ITT, startScale: LON_ITT_START, digitsOnlyWhenNotRunning: true, startPsiVar: 'pneu.start_psi' },
    {
      kind: 'digital',
      rows: [
        { label: 'N2 %', vars: ['eng1.n2_pct', 'eng2.n2_pct'], decimals: 1, limits: { warnHigh: 98.62 } },
        { label: 'FF PPH', vars: ['eng1.ff_pph', 'eng2.ff_pph'], decimals: 0, step: 10 },
        { label: 'OIL PSI', vars: ['eng1.oil_press_psi', 'eng2.oil_press_psi'], decimals: 0, limits: { warnLow: 25 } }, // EST
        { label: 'OIL °C', vars: ['eng1.oil_temp_c', 'eng2.oil_temp_c'], decimals: 0, limits: { cautionHigh: 140, warnHigh: 151 } }, // EST
      ],
    },
    { kind: 'oat', showRat: true },
    { kind: 'fuel', tanks: ['fuel.tank0_kg', 'fuel.tank1_kg'], unit: 'lb', imbalance: 500, lowLevel: 600 }, // imbalance: OG p.1-3; low level EST
    // OG 15-5: flap detents UP 0, 1 = 7 deg, 2 = 15 deg, FULL = 35 deg; the selected position is a cyan bug (flap lever).
    { kind: 'flaps', var: 'surf.flaps_deg', maxDeg: 35, detents: [{ deg: 0, label: '0' }, { deg: 7, label: '1' }, { deg: 15, label: '2' }, { deg: 35, label: 'FULL' }], speedbrakeVar: 'surf.speedbrake', speedbrakeLabel: 'SPOILERS', gearVars: ['gear.pos0', 'gear.pos1', 'gear.pos2'], selectedVar: 'ac.lon.flap_lever', selectedDeg: [0, 7, 15, 35] },
    { kind: 'trim', pitch: { var: 'surf.pitch_trim', min: -1, max: 1, takeoffBand: [0.05, 0.4] }, roll: { var: 'surf.aileron_trim', min: -1, max: 1 }, yaw: { var: 'surf.rudder_trim', min: -1, max: 1 } },
  ],
};

export const LONGITUDE_VSPEEDS: VSpeedDef[] = [
  { id: 'V1', label: '1', group: 'takeoff', defaultKt: 125 },
  { id: 'VR', label: 'R', group: 'takeoff', defaultKt: 130 },
  { id: 'V2', label: '2', group: 'takeoff', defaultKt: 138 },
  { id: 'VENR', label: 'EN', group: 'takeoff', defaultKt: 180 },
  { id: 'VREF', label: 'RF', group: 'landing', defaultKt: 122 },
  { id: 'VAPP', label: 'AP', group: 'landing', defaultKt: 127 },
]; // all EST at typical weights

/**
 * Four GTC 570 (Longitude OG 4-9 / 4-10): an outboard PFD GTC per pilot
 * (PFD control, CNS bar) and two MFD GTCs below the MFD (display panes,
 * flight management, PFD split panes).
 */
export const LONGITUDE_GTCS: GtcConfig[] = [
  { id: 'gtc1', model: 'GTC570', side: 1, modes: ['PFD'], panes: [], cnsBar: true },
  { id: 'gtc2', model: 'GTC570', side: 1, modes: ['MFD'], panes: ['mfd1', 'pfd1'], cnsBar: true },
  { id: 'gtc3', model: 'GTC570', side: 2, modes: ['MFD'], panes: ['mfd2', 'pfd2'], cnsBar: true },
  { id: 'gtc4', model: 'GTC570', side: 2, modes: ['PFD'], panes: [], cnsBar: true },
];

export const G5000_LONGITUDE_LAYOUT: Omit<G3000Config, 'aircraftId'> = {
  variant: 'g5000',
  aircraftName: 'Citation Longitude',
  pfdCount: 2,
  gtcs: LONGITUDE_GTCS,
  casLocation: 'pfd',
  eis: LONGITUDE_EIS,
  vspeeds: LONGITUDE_VSPEEDS,
  speedTape: { vmoKt: 325 },
  weights: { basicOperatingLb: 24000, maxRampLb: 39700, maxTakeoffLb: 39500, maxLandingLb: 33500, maxZeroFuelLb: 26800, paxLb: 200, maxPax: 12 }, // BOW EST
  afcs: { autothrottle: true, speedKnob: true, maxSelAltFt: 45000 },
  sensors: { adc: 2, ahrs: 2, radioAltimeter: true },
  radios: { nav: 2, com: 2, adf: false, dme: true, xpdr: 2 },
  taws: 'A',
  traffic: 'TCAS2',
  engineCount: 2,
  defaultPanes: { mfd1: PANE_CONTENT.navMap, mfd2: PANE_CONTENT.flightPlan, pfd1: PANE_CONTENT.navMap, pfd2: PANE_CONTENT.navMap },
};
