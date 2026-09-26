/**
 * Standard avionics colour palettes and line widths.
 *
 * Colour *meaning* is regulated; exact *shades* are not public. Meanings:
 *  - 14 CFR 25.1322 / AC 25-11B §5.8: red = warning (immediate action),
 *    amber/yellow = caution (future action), green = safe / active,
 *    cyan = advisory / pilot-selected, white = scales and current values,
 *    magenta = FMS / computed targets.
 *  - Garmin G1000 Pilot's Guide 190-00494-04 (Citation Mustang), §2.1:
 *    selected heading/altitude "light blue", GPS course and trend vectors
 *    magenta, VOR/LOC green, bearing pointers light blue, caution yellow.
 *  - Boeing 737NG FCOM Vol 2 ch.10 (Flight Instruments, Displays): MCP
 *    targets magenta (airspeed cursor, heading bug), reference speeds green,
 *    PLI / bank-pointer exceedance amber, TCAS pitch command red.
 *  - Honeywell Primus Epic / Collins Pro Line Fusion follow AC 25-11B:
 *    cyan selected, magenta FMS, green active, white armed.
 *
 * Every hex value below is EST: sampled from manufacturer pilot-guide
 * figures and press screenshots and then normalised to a clean display
 * primary; LCD gamut differences make exact matches meaningless.
 */

/** Semantic colour roles shared by every primitive. */
export interface AvionicsPalette {
  readonly name: string;
  /** Display background (unlit LCD). */
  readonly background: string;
  readonly white: string;
  readonly grey: string;
  readonly darkGrey: string;
  readonly black: string;
  readonly cyan: string;
  readonly magenta: string;
  readonly green: string;
  readonly amber: string;
  readonly yellow: string;
  readonly red: string;
  readonly blue: string;
  /** Pilot-selected targets (heading bug, selected altitude/speed). */
  readonly selected: string;
  /** FMS / GPS computed data (active leg, VNAV targets, GPS CDI). */
  readonly fms: string;
  /** Radio navigation source (VOR/LOC) CDI and course. */
  readonly navRadio: string;
  /** Bearing pointers. */
  readonly bearing: string;
  /** Trend vectors (speed, altitude, turn rate). */
  readonly trend: string;
  /** Flight director command bars / cross pointers. */
  readonly flightDirector: string;
  /** Own-ship / aircraft reference symbol fill. */
  readonly aircraftSymbol: string;
  readonly aircraftSymbolOutline: string;
  /** Sky (top) and sky at the horizon (gradient end). Equal values = solid. */
  readonly sky: string;
  readonly skyHorizon: string;
  /** Ground at the horizon and ground (bottom). */
  readonly groundHorizon: string;
  readonly ground: string;
  /** Tape background (Garmin translucent grey, Boeing opaque grey). */
  readonly tapeBackground: string;
  /** Readout boxes (current speed/altitude pointer boxes). */
  readonly readoutBackground: string;
  readonly readoutBorder: string;
  /** CAS message levels. */
  readonly warning: string;
  readonly caution: string;
  readonly advisory: string;
  readonly status: string;
  /** Soft key label, active and disabled colours. */
  readonly softKeyText: string;
  readonly softKeyActive: string;
  readonly softKeyDisabled: string;
  /** Map: water, route, missed approach, range rings. */
  readonly mapWater: string;
  readonly mapRoute: string;
  readonly mapMissed: string;
  readonly mapRangeRing: string;
}

/** Line widths in logical pixels (see CanvasDisplay: logical = design units). */
export interface AvionicsLineWidths {
  readonly thin: number;
  readonly normal: number;
  readonly thick: number;
  /** Outline/halo drawn under symbols and text on maps / over the horizon. */
  readonly halo: number;
}

// Shared primaries (EST, see header).
const RED = '#ff2020';
const AMBER = '#ffb000';
const WHITE = '#ffffff';

/** Garmin G1000 / G1000 NXi / G3000 / G5000. */
export const GARMIN_PALETTE: AvionicsPalette = {
  name: 'garmin',
  background: '#000000',
  white: WHITE,
  grey: '#9aa0a6',
  darkGrey: '#3a3d40',
  black: '#000000',
  cyan: '#00ffff', // "light blue" in Garmin guides
  magenta: '#ff00ff',
  green: '#00ff00',
  amber: AMBER,
  yellow: '#ffff00',
  red: RED,
  blue: '#1e63d6',
  selected: '#00ffff',
  fms: '#ff00ff',
  navRadio: '#00ff00',
  bearing: '#00ffff',
  trend: '#ff00ff',
  flightDirector: '#ff00ff',
  aircraftSymbol: '#ffff00',
  aircraftSymbolOutline: '#000000',
  sky: '#0a3fbf',
  skyHorizon: '#5b9df0',
  groundHorizon: '#8a5a2b',
  ground: '#5a3510',
  tapeBackground: 'rgba(40,40,44,0.55)',
  readoutBackground: '#000000',
  readoutBorder: WHITE,
  warning: RED,
  caution: '#ffff00', // G1000 PG 190-00494-04 §3.2: caution yellow
  advisory: WHITE, // G1000 PG §3.2: advisory white
  status: WHITE,
  softKeyText: WHITE,
  softKeyActive: '#b4b8bc', // G1000 PG §1 "Softkey Function": selected = black text on gray
  softKeyDisabled: '#6b6f73',
  mapWater: '#0a2a6b',
  mapRoute: WHITE,
  mapMissed: '#00ffff',
  mapRangeRing: WHITE,
};

/** Boeing 737NG Common Display System. */
export const BOEING_PALETTE: AvionicsPalette = {
  name: 'boeing',
  background: '#000000',
  white: WHITE,
  grey: '#a0a0a0',
  darkGrey: '#505050',
  black: '#000000',
  cyan: '#00e8ff',
  magenta: '#ff40ff',
  green: '#00ff00',
  amber: AMBER,
  yellow: '#ffe000',
  red: RED,
  blue: '#1c8ad6',
  selected: '#ff40ff', // MCP targets magenta (FCOM "Airspeed Cursor (magenta)")
  fms: '#ff40ff',
  navRadio: '#ff40ff', // 737NG deviation pointers magenta
  bearing: '#00ff00',
  trend: '#00ff00', // FCOM "Speed Trend Vector (green)"
  flightDirector: '#ff40ff', // FCOM "Flight Director (magenta)"
  aircraftSymbol: '#000000',
  aircraftSymbolOutline: WHITE,
  sky: '#1c8ad6',
  skyHorizon: '#1c8ad6',
  groundHorizon: '#8c5a2b',
  ground: '#8c5a2b',
  tapeBackground: '#5a5f66',
  readoutBackground: '#000000',
  readoutBorder: WHITE,
  warning: RED,
  caution: AMBER,
  advisory: '#00e8ff',
  status: WHITE,
  softKeyText: WHITE,
  softKeyActive: '#00ff00',
  softKeyDisabled: '#707070',
  mapWater: '#062a60',
  mapRoute: '#ff40ff',
  mapMissed: '#00e8ff',
  mapRangeRing: WHITE,
};

/** Honeywell Primus Epic (Gulfstream PlaneView II, Symmetry flight deck). */
export const HONEYWELL_PALETTE: AvionicsPalette = {
  name: 'honeywell',
  background: '#000000',
  white: WHITE,
  grey: '#a8adb2',
  darkGrey: '#3c4046',
  black: '#000000',
  cyan: '#00e0ff',
  magenta: '#ff3cff',
  green: '#20ff40',
  amber: AMBER,
  yellow: '#fff000',
  red: RED,
  blue: '#2878d8',
  selected: '#00e0ff',
  fms: '#ff3cff',
  navRadio: '#20ff40',
  bearing: '#00e0ff',
  trend: '#20ff40',
  flightDirector: '#ff3cff',
  aircraftSymbol: '#000000',
  aircraftSymbolOutline: WHITE,
  sky: '#1c5fc4',
  skyHorizon: '#3a86e0',
  groundHorizon: '#7d5129',
  ground: '#5e3a1a',
  tapeBackground: 'rgba(60,64,70,0.75)',
  readoutBackground: '#000000',
  readoutBorder: WHITE,
  warning: RED,
  caution: AMBER,
  advisory: '#00e0ff',
  status: WHITE,
  softKeyText: WHITE,
  softKeyActive: '#00e0ff',
  softKeyDisabled: '#6b6f73',
  mapWater: '#0a2a6b',
  mapRoute: WHITE,
  mapMissed: '#00e0ff',
  mapRangeRing: WHITE,
};

/** Collins Pro Line Fusion (Bombardier Global Vision). */
export const COLLINS_PALETTE: AvionicsPalette = {
  name: 'collins',
  background: '#000000',
  white: WHITE,
  grey: '#a4a8ad',
  darkGrey: '#383c42',
  black: '#000000',
  cyan: '#00f0ff',
  magenta: '#ff40ff',
  green: '#30ff30',
  amber: AMBER,
  yellow: '#ffee00',
  red: RED,
  blue: '#2a76d2',
  selected: '#00f0ff',
  fms: '#ff40ff',
  navRadio: '#30ff30',
  bearing: '#00f0ff',
  trend: '#30ff30',
  flightDirector: '#ff40ff',
  aircraftSymbol: '#000000',
  aircraftSymbolOutline: WHITE,
  sky: '#1f63c2',
  skyHorizon: '#3d8be0',
  groundHorizon: '#86562a',
  ground: '#65401c',
  tapeBackground: 'rgba(56,60,66,0.8)',
  readoutBackground: '#000000',
  readoutBorder: WHITE,
  warning: RED,
  caution: AMBER,
  advisory: '#00f0ff',
  status: WHITE,
  softKeyText: WHITE,
  softKeyActive: '#00f0ff',
  softKeyDisabled: '#6b6f73',
  mapWater: '#0a2a6b',
  mapRoute: WHITE,
  mapMissed: '#00f0ff',
  mapRangeRing: WHITE,
};

export const DEFAULT_LINE_WIDTHS: AvionicsLineWidths = {
  thin: 1,
  normal: 2,
  thick: 3,
  halo: 4,
};

export type AvionicsVendor = 'garmin' | 'boeing' | 'honeywell' | 'collins';

export const PALETTES: Record<AvionicsVendor, AvionicsPalette> = {
  garmin: GARMIN_PALETTE,
  boeing: BOEING_PALETTE,
  honeywell: HONEYWELL_PALETTE,
  collins: COLLINS_PALETTE,
};

/** Returns a copy of `base` with some roles replaced (for per-aircraft tweaks). */
export function derivePalette(base: AvionicsPalette, overrides: Partial<AvionicsPalette>): AvionicsPalette {
  return { ...base, ...overrides };
}

/**
 * EGPWS / TAWS terrain display colours.
 * Garmin TAWS-B: red = terrain at or within 100 ft below the aircraft,
 * yellow = 100..1000 ft below, black otherwise (Garmin TAWS pilot's guide
 * supplement, "Relative Terrain"). Honeywell MK VI/VIII EGPWS Pilot Guide
 * 060-4314-000 Rev C p.31: density patterns of green/yellow/red.
 */
export const TERRAIN_COLORS = {
  red: [255, 0, 0] as const,
  yellow: [255, 255, 0] as const,
  amber: [255, 176, 0] as const,
  green: [0, 200, 0] as const,
  black: [0, 0, 0] as const,
  noData: [180, 0, 180] as const, // EGPWS low-density magenta "no data"
};
