/**
 * Citation Longitude engines: HTF7700L dual-channel FADEC thrust ratings and
 * lever law, automatic start (RUN/STOP + START buttons), autothrottle.
 *
 * OG 7-2/7-3: the thrust levers are continuous (no detents); the FADEC picks
 * the thrust mode from the lever range: TO fully forward, CLB and CRU further
 * aft; APR = TO N1 (OG 1-3). Reversers are pivot doors (L on hyd A, R on
 * hyd B); the FADEC reduces reverse from 85 KIAS to idle by 45 KIAS (BCA),
 * implemented in logic.ts on the effective lever `ac.lon.tla_eff{i}`.
 *
 * N1 ratings (Table2D: pressure altitude x SAT): corrected-N1 schedules EST,
 * flat rated to ISA+19 (34 degC at SL, FPG p.2), clamped to the OG 1-3 limits
 * (TO/APR 96.79 %, CLB 96.49 %). The CRU schedule reproduces the FPG
 * maximum-cruise speeds (fdm.ts calibration: 91-92 % N1 at FL410-FL450 ISA).
 */
import type { SimContext } from '../../../core/SimContext';
import type { Table2D } from '../../../physics/types';
import { isaTemperature } from '../../../physics/atmosphere';
import { ThrustRatingComputer, ThrustLeverFadec, EngineStartController, Autothrottle } from '../../../systems/fadec';
import { LON_LIMITS } from '../data';
import { N1_RATED_PCT } from '../fdm';
import { LON_VARS as V } from '../vars';
import { TLA } from './logic';

const ALTS = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 41000, 45000];
const TEMPS = [-70, -56, -40, -20, 0, 15, 25, 34, 40, 50];

/** Physical-N1 rating table from a corrected-N1 schedule vs altitude, flat rated to ISA + flatDev. */
export function ratingTable(n1cVsAlt: number[], limitPct: number, flatDevK = 19): Table2D {
  const z = ALTS.map((ft, i) => {
    const tIsa = isaTemperature(ft * 0.3048);
    return TEMPS.map((tc) => {
      const t = Math.min(tc + 273.15, tIsa + flatDevK);
      const n1 = n1cVsAlt[i] * Math.sqrt(t / tIsa);
      return Math.round(Math.min(limitPct, n1) * 100) / 100;
    });
  });
  return { x: ALTS, y: TEMPS, z };
}

// Corrected N1 (%) schedules vs ALTS (EST; see header).
export const N1C_TO = ALTS.map((ft) => N1_RATED_PCT + 0.13 * (ft / 1000));
export const N1C_CLB = [91.0, 91.8, 92.5, 93.2, 93.8, 94.4, 95.0, 95.5, 96.0, 96.2];
export const N1C_CRU = [86.0, 86.5, 87.0, 87.5, 88.2, 89.0, 89.8, 90.6, 91.5, 91.2];

export interface LongitudeEngines {
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
  at: Autothrottle;
}

export function createEngines(ctx: SimContext): LongitudeEngines {
  const ratings = new ThrustRatingComputer(ctx, {
    ratings: {
      TO: ratingTable(N1C_TO, LON_LIMITS.n1TakeoffPct),
      CLB: ratingTable(N1C_CLB, LON_LIMITS.n1ClbPct),
      CRU: ratingTable(N1C_CRU, LON_LIMITS.n1ClbPct),
      GA: ratingTable(N1C_TO, LON_LIMITS.n1TakeoffPct),
      APR: ratingTable(N1C_TO, LON_LIMITS.n1TakeoffPct),
    },
    initial: 'TO',
    auto: { takeoff: 'TO', climb: 'CLB', goAround: 'GA', goAroundWhen: 'surf.flaps_deg > 5 && gear.air_ground == 0 && (gear.down_locked || surf.flaps_deg > 16)' },
  });
  const fadec = new ThrustLeverFadec(
    ctx,
    {
      engines: [1, 2],
      leverVar: (e) => `ac.lon.tla_eff${e}`,
      law: {
        kind: 'detent',
        detents: [
          { lever: TLA.cru, rating: 'CRU', label: 'CRU' },
          { lever: TLA.clb, rating: 'CLB', label: 'CLB' },
          { lever: TLA.to, rating: 'TO', label: 'TO' },
        ],
      },
      // EST: HTF7000-class ground idle ~22 % N1; flight idle rising with altitude for bleed/relight margin;
      // approach idle with the gear down or flaps FULL (spool-up for go-around).
      // Wing anti-ice selected in flight raises the idle too (OG 12-3: "engines will spool slightly for 4 seconds
      // before the wing anti-ice bleed valves are opened"; EST: the approach-idle schedule, extended above 15,000 ft
      // so that it is never below flight idle).
      idle: {
        ground: 22,
        flight: { x: [0, 15000, 30000, 45000], y: [26, 31, 38, 46] },
        approach: { x: [0, 15000, 30000, 45000], y: [32, 36, 41, 48] },
        approachWhen: `gear.down_locked || surf.flaps_deg > 16 || ${V.aiWing}`,
      },
      reverse: { maxN1: 78, deployS: 1.5, stowS: 2.0, power: 'clamp01(max(hyd.a_psi, hyd.b_psi) / 2600)' },
      // Dual-channel FADEC powered by its engine alternator when the engine turns, aircraft bus otherwise (OG 7-2).
      power: (e) => `eng${e}.n2_pct > 10 || elec.fadec_${e === 1 ? 'l' : 'r'}_aux_powered`,
    },
    ratings,
  );
  const starts = [1, 2].map((i) => {
    const run = i === 1 ? V.runL : V.runR;
    const start = i === 1 ? V.startL : V.startR;
    return new EngineStartController(ctx, {
      engine: i,
      startSwitch: `${start} && ${run}`, // with RUN/STOP at STOP the START button dry-motors (logic.ts)
      runLever: `${run} && !${i === 1 ? V.fireEngL : V.fireEngR}`,
      stopSwitch: `${run} == 0`,
      fuelOnN2Pct: 12, // EST (light-off N2 11 %, fdm.ts)
      starterCutoutN2Pct: 50, // EST
      idleN2Pct: 55,
      hotStartIttC: LON_LIMITS.ittStartC, // OG 1-3: 650 degC start limit
      // EST: 0.5 s look-ahead; the HTF7000 FADEC start schedule keeps ITT below the limit, so only a genuine
      // runaway (hot start) should trip the auto-abort, not the normal light-off rise.
      hotStartPredictS: 0.5,
      lightOffTimeoutS: 12,
      hungWindowS: 12,
      maxStarterS: 120,
      // OG 7-5: the FADEC runs the start and aborts faulty starts; no N2 rotation within 10 s of starter engagement
      // (e.g. no starter air, < 32 psi, OG 1-3) aborts (EST thresholds), posting ENG START ABORT (cas.ts).
      noRotationS: 10,
      noRotationN2Pct: 5,
      clearingMotorS: 15,
      starterAvailable: 1, // air turbine starter: strength from duct pressure (pneumatic starter block)
      ignitionPower: `elec.emer_${i === 1 ? 'l' : 'r'}_powered`,
      continuousIgnition: 0,
      starterVar: `fadec.eng${i}.auto_starter`,
    });
  });
  const at = new Autothrottle(ctx, {
    engines: [1, 2],
    style: 'bizjet',
    leverVar: (e) => V.tla(e),
    power: 'elec.afcs_powered && elec.gmc_powered',
    servoRate: 0.12,
    retardRate: 0.12,
    thrHoldKt: 60,
    thrHoldEndFt: 400, // OG 7-5: HOLD up to 400 ft AGL
    // LON4-04: OG 17 Landing "Autothrottle (if used) - Check Green RETARD at 50 feet AGL"; OG 7-5 describes the
    // mode as "reducing throttles to idle during landing operations below 40 feet AGL". Modelled at 50 ft so the
    // green RETARD annunciates at 50 ft as the checklist expects (the levers are then still reducing below 40 ft),
    // matching the AW/BCA pilot report (threshold at ~50 ft, A/T retarding into the flare).
    retardFt: 50,
    retardFlapsDeg: 30,
    discWarnS: 5,
    // OG 7-5 FMA: TO, HOLD, CLIMB, DESC, SPD, RETARD (MAX SPD / MIN SPD protection and the manual-advance HOLD:
    // systems/afcsExtras.ts)
    labels: { THR: 'CLIMB', IDLE: 'DESC', SPD: 'SPD', SPD_FMS: 'SPD', MACH: 'SPD', HOLD: 'HOLD', TO: 'TO', GA: 'TO', RETARD: 'RETARD' },
    vmoKt: LON_LIMITS.vmoKt,
    mmo: LON_LIMITS.mmo,
    // SPD knob FMS / MAN (OG 7-4): the G5000 copies the FMS speed into the selected speed in FMS mode, so the A/T
    // always holds the selected speed; MAN overrides the FMS speed also in VNAV.
    vnavSpeedFromSelected: true,
    // OG 7-5 DESC: "targeting an idle thrust for descent" - the A/T stays in DESC at the idle stop (no HOLD in flight;
    // OG: "HOLD will only activate when on the ground").
    holdAfterDescentIdle: false,
    // LON-P3-01, OG Section 1 limitation: "Autothrottle ... not armed during taxi". On the ground the AT button is
    // inert unless TO/GA is active, and TO/GA itself engages the A/T into TO (AW&ST 2019 pilot report).
    groundEngage: 'toga',
  });
  return { ratings, fadec, starts, at };
}
