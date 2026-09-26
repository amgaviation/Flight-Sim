/**
 * TOLD (takeoff and landing data) for the G3000 PERF pages, from the Citation
 * M2 Flight Planning Guide (FPG) tables:
 *  - V1 / VR / V2 vs weight, flaps 15 and 0 (FPG p.4, sea level, ISA, dry);
 *  - takeoff field length, flaps 15, sea level, vs weight and temperature (FPG p.5);
 *  - VREF vs landing weight and landing distance, flaps 35 (FPG pp.26-31).
 * SCOPE: elevation, wind, slope, wet runway and anti-ice corrections are
 * simplified (EST factors noted inline); the real AFM tables are denser.
 */
import type { PerformanceProvider, TakeoffInput, LandingInput } from '../../../avionics/garmin-g3000/config';
import { lookup, TAKEOFF_SPEEDS, VREF } from '../data';

/** FPG p.5 flaps 15 sea level: field length (ft) vs temperature (rows) and weight (cols). */
const TOFL15 = {
  temps: [0, 10, 15, 20, 25, 30, 35, 40, 45],
  weights: [7500, 8000, 8500, 9000, 9500, 9900, 10300, 10700],
  ft: [
    [2350, 2370, 2410, 2450, 2510, 2590, 2810, 3040],
    [2440, 2470, 2510, 2550, 2610, 2680, 2910, 3150],
    [2490, 2510, 2550, 2610, 2660, 2730, 2960, 3210],
    [2530, 2560, 2600, 2660, 2720, 2780, 3010, 3270],
    [2470, 2500, 2550, 2610, 2690, 2930, 3180, 3450],
    [2390, 2440, 2490, 2560, 2860, 3110, 3380, 3750],
    [2330, 2370, 2440, 2720, 3030, 3310, 3710, 4160],
    [2260, 2340, 2590, 2890, 3240, 3670, 4120, 4590],
    [2240, 2490, 2770, 3120, 3670, 4160, 4680, 5200],
  ],
};

/** FPG p.26 landing distance (ft) flaps 35, sea level, vs temperature and weight. */
const LD35 = {
  temps: [0, 10, 15, 20, 25, 30, 35, 40, 45, 50],
  weights: [7500, 8000, 8500, 8900, 9300, 9500, 9700, 9900],
  ft: [
    [2110, 2200, 2280, 2340, 2410, 2440, 2470, 2500],
    [2160, 2250, 2330, 2390, 2460, 2500, 2530, 2560],
    [2180, 2270, 2350, 2420, 2490, 2520, 2560, 2590],
    [2210, 2300, 2380, 2450, 2520, 2560, 2590, 2620],
    [2240, 2330, 2410, 2480, 2550, 2590, 2620, 2660],
    [2260, 2350, 2440, 2510, 2580, 2620, 2650, 2690],
    [2290, 2380, 2470, 2540, 2610, 2650, 2690, 2730],
    [2320, 2410, 2500, 2570, 2650, 2680, 2720, 2770],
    [2340, 2440, 2530, 2600, 2680, 2710, 2750, 2820],
    [2370, 2470, 2560, 2630, 2710, 2740, 2790, 2880],
  ],
};

function bilinear(tab: { temps: number[]; weights: number[]; ft: number[][] }, t: number, w: number): number {
  const col = tab.ft.map((row) => lookup(tab.weights, row, w));
  return lookup(tab.temps, col, t);
}

/** Elevation factor EST: FPG shows ~+4.5 % takeoff and +2.7 % landing distance per 1,000 ft at 15 degC. */
const elevFactor = (ft: number, perK: number): number => 1 + Math.max(0, ft) / 1000 * perK;

export const M2_PERFORMANCE: PerformanceProvider = {
  takeoffFlaps: ['15', '0'],
  landingFlaps: ['35'],
  takeoff(inp: TakeoffInput) {
    const f0 = inp.flaps === '0';
    const tab = f0 ? TAKEOFF_SPEEDS.flaps0 : TAKEOFF_SPEEDS.flaps15;
    const w = inp.weightLb;
    const v1 = Math.round(lookup(TAKEOFF_SPEEDS.weightsLb, tab.v1, w));
    const vr = Math.round(lookup(TAKEOFF_SPEEDS.weightsLb, tab.vr, w));
    const v2 = Math.round(lookup(TAKEOFF_SPEEDS.weightsLb, tab.v2, w));
    let fl = bilinear(TOFL15, inp.oatC, w) * elevFactor(inp.runwayElevFt, 0.045);
    if (f0) fl *= 1.22; // EST: FPG flaps-0 table ~20-25 % longer
    if (inp.wet) fl *= 1.15; // EST
    return {
      vspeeds: { V1: v1, VR: vr, V2: v2, VENR: 160 }, // VENR EST: flaps-up climb speed
      fieldLengthFt: Math.round(fl / 10) * 10,
      notes: [`BFL ${Math.round(fl).toLocaleString('en-US')} FT (FPG)`, fl > inp.runwayLengthFt ? 'RUNWAY TOO SHORT' : 'RUNWAY OK'],
    };
  },
  landing(inp: LandingInput) {
    const vref = Math.round(lookup(VREF.weightsLb, VREF.kt, inp.weightLb));
    let ld = bilinear(LD35, inp.oatC, inp.weightLb) * elevFactor(inp.runwayElevFt, 0.027);
    if (inp.wet) ld *= 1.4; // EST
    return {
      vspeeds: { VREF: vref, VAPP: vref + 5 },
      fieldLengthFt: Math.round(ld / 10) * 10,
      notes: [`LANDING DIST ${Math.round(ld).toLocaleString('en-US')} FT (ACTUAL, FPG)`],
    };
  },
};
