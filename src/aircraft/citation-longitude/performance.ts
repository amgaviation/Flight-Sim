/**
 * Citation Longitude TOLD provider for the G5000 PERF / TOLD pages, built from
 * the Textron Flight Planning Guide tables (FPG p.4-14 takeoff, p.22-26
 * landing). V-speeds are interpolated in weight exactly as published (sea
 * level, ISA). Field lengths use the published sea-level / 15 degC columns and
 * EST corrections for elevation, temperature, wind and runway condition fitted
 * to the FPG table trends (per 1,000 ft: +3.2 % takeoff / +2.8 % landing below
 * the flat-rating temperature; per degC above ISA: +0.35 % / +0.25 %; headwind
 * 50 % / tailwind 150 % per 14 CFR 25.105; wet: +15 % landing (EST)).
 */
import type { PerformanceProvider, TakeoffInput, TakeoffResult, LandingInput, LandingResult } from '../../avionics/garmin-g3000/config';
import { interpTable, LDG_DIST_SL_ISA_FT, TAKEOFF_SPEEDS, TOFL_SL_ISA_F2_FT, VREF } from './data';

const clampW = (w: number, xs: readonly number[]) => Math.max(xs[0], Math.min(xs[xs.length - 1], w));

export function takeoffSpeeds(weightLb: number, flaps: '1' | '2'): { v1: number; vr: number; v2: number } {
  const t = flaps === '1' ? TAKEOFF_SPEEDS.flaps1 : TAKEOFF_SPEEDS.flaps2;
  const w = clampW(weightLb, TAKEOFF_SPEEDS.weightsLb);
  return {
    v1: Math.round(interpTable(TAKEOFF_SPEEDS.weightsLb, t.v1, w)),
    vr: Math.round(interpTable(TAKEOFF_SPEEDS.weightsLb, t.vr, w)),
    v2: Math.round(interpTable(TAKEOFF_SPEEDS.weightsLb, t.v2, w)),
  };
}

export function vref(weightLb: number): number {
  return Math.round(interpTable(VREF.weightsLb, VREF.kt, clampW(weightLb, VREF.weightsLb)));
}

function windFactor(runwayHdg: number, windDir: number, windKt: number, perKt: number): number {
  const comp = windKt * Math.cos(((windDir - runwayHdg) * Math.PI) / 180); // + headwind
  return comp >= 0 ? 1 - 0.5 * comp * perKt : 1 - 1.5 * comp * perKt;
}

export const LONGITUDE_TOLD: PerformanceProvider = {
  takeoffFlaps: ['2', '1'],
  landingFlaps: ['FULL'],
  takeoff(i: TakeoffInput): TakeoffResult | null {
    if (!(i.weightLb > 0)) return null;
    const flaps = i.flaps === '1' ? '1' : '2';
    const s = takeoffSpeeds(i.weightLb, flaps);
    const isaC = 15 - 1.98 * (i.runwayElevFt / 1000);
    let fl = interpTable(TAKEOFF_SPEEDS.weightsLb, TOFL_SL_ISA_F2_FT, clampW(i.weightLb, TAKEOFF_SPEEDS.weightsLb));
    if (flaps === '1') fl *= 1.058; // FPG p.10 vs p.5 at SL/15 degC
    fl *= 1 + 0.032 * (i.runwayElevFt / 1000);
    fl *= 1 + 0.0035 * Math.max(-20, i.oatC - isaC) + 0.012 * Math.max(0, i.oatC - 34 + 2 * (i.runwayElevFt / 1000)); // beyond the flat rating
    fl *= windFactor(i.runwayHeadingMag, i.windDirMag, i.windKt, 0.01);
    if (i.antiIce) fl *= 1.05;
    if (i.wet) fl *= 1.15;
    fl *= 1 + Math.max(0, i.slope) * 0.05;
    return {
      vspeeds: { V1: s.v1, VR: s.vr, V2: s.v2, VENR: s.v2 + 50 },
      fieldLengthFt: Math.round(fl / 10) * 10,
      notes: [`FLAPS ${flaps}`, `TOFL ${Math.round(fl).toLocaleString('en-US')} FT`, fl > i.runwayLengthFt ? 'RWY TOO SHORT' : 'RWY OK'],
    };
  },
  landing(i: LandingInput): LandingResult | null {
    if (!(i.weightLb > 0)) return null;
    const vr = vref(i.weightLb);
    const isaC = 15 - 1.98 * (i.runwayElevFt / 1000);
    let ld = interpTable(VREF.weightsLb, LDG_DIST_SL_ISA_FT, clampW(i.weightLb, VREF.weightsLb));
    ld *= 1 + 0.028 * (i.runwayElevFt / 1000);
    ld *= 1 + 0.0025 * (i.oatC - isaC);
    ld *= windFactor(i.runwayHeadingMag, i.windDirMag, i.windKt, 0.009);
    if (i.wet) ld *= 1.15;
    // VAPP: VREF + half the steady wind (5..20 kt additive), BCA / AOPA (VREF 119, VAPP 131).
    const add = Math.max(5, Math.min(20, 0.5 * Math.max(0, i.windKt)));
    return {
      vspeeds: { VREF: vr, VAPP: Math.round(vr + add) },
      fieldLengthFt: Math.round(ld / 10) * 10,
      notes: ['FLAPS FULL', `LDG DIST ${Math.round(ld).toLocaleString('en-US')} FT`, ld > i.runwayLengthFt ? 'RWY TOO SHORT' : 'RWY OK'],
    };
  },
};
