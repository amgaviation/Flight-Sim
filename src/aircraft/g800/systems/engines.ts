/**
 * G800 engines: Pearl 700 FADEC thrust ratings (TRS), power-lever law,
 * automatic start, and the autothrottle.
 *
 * - Thrust rating system (Epic TRS: TO, GA, CLB, CRZ, MCT). The Pearl 700 is
 *   EPR-controlled in the primary mode and LP (N1) in the alternate mode (FSB
 *   App. 4; C450 "Primary: EPR-based thrust control; Alternate: LP (N1)"). SCOPE:
 *   the FADEC here schedules N1 (corrected-N1 tables, E135 limits); EPR is
 *   derived for display (logic.ts) from the BR700-family EPR/N1 relation.
 * - Power levers: full forward = maximum takeoff thrust; the selected TRS rating
 *   drives the A/T targets and the engine-display bug (GVI practice: "set EPR to
 *   the bug"). Idle: ground, flight and approach idle (SCQ powerplant: three idle
 *   settings; approach idle with gear down and locked, flaps > 20 deg, < 5,000 ft
 *   AGL and no wheel spin-up).
 * - Reversers: electrically controlled, hydraulically operated (SCQ); piggy-back
 *   levers; idle reverse by 60 KCAS (GVI, logic.ts reduces the lever).
 * - Automatic start (SCQ powerplant): START MASTER ON arms the FADEC auto start
 *   (start valve and ignition), opens the isolation valve and shuts the packs;
 *   the start valve and igniters close at ~42 % HP (GVI starter cut-out 42 % HP);
 *   the FADEC protects ground starts with an automatic shutdown (FSB 9.2.1 j).
 * - Autothrottle: Honeywell bizjet style, engagement needs a valid rating (SCQ:
 *   "valid EPR rating selected, valid speed target selected, valid OAT and more
 *   than 1.10 EPR" for takeoff engagement).
 */
import type { SimContext } from '../../../core/SimContext';
import type { Table2D } from '../../../physics/types';
import { isaTemperature } from '../../../physics/atmosphere';
import { ThrustRatingComputer, ThrustLeverFadec, EngineStartController, Autothrottle } from '../../../systems/fadec';
import { G800_LIMITS } from '../data';
import { N1_RATED_PCT } from '../fdm';
import { G800_VARS as V } from '../vars';

const ALTS = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 41000, 45000, 51000];
const TEMPS = [-70, -56, -40, -20, 0, 15, 25, 30, 40, 50];

/** Physical-N1 rating table from a corrected-N1 schedule vs altitude, flat rated to ISA + flatDev (EST 15 K). */
export function ratingTable(n1cVsAlt: number[], limitPct: number, flatDevK = 15): Table2D {
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

// Corrected N1 (%) schedules vs ALTS (EST: shaped like the BR700-family climb/cruise ratings; the MCT/CLB
// schedules give the GAC direct climb to FL410 at MTOW, CRZ the M0.90 high-speed cruise).
export const N1C_TO = ALTS.map((ft) => N1_RATED_PCT + 0.12 * (ft / 1000));
export const N1C_MCT = N1C_TO.map((x) => x - 1.0);
export const N1C_CLB = [89.0, 89.8, 90.6, 91.4, 92.2, 93.0, 93.8, 94.5, 95.2, 95.6, 96.0];
export const N1C_CRZ = [85.0, 85.6, 86.2, 86.8, 87.6, 88.4, 89.2, 90.0, 91.0, 91.5, 92.0];

export interface G800Engines {
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
  at: Autothrottle;
}

/** Approach idle conditions (SCQ powerplant). */
export const APPROACH_IDLE = 'gear.down_locked && surf.flaps_deg > 20 && ra1.valid && ra1.alt_ft < 5000 && gear.wheel_speed1_kt < 20';

export function createEngines(ctx: SimContext): G800Engines {
  const lim = G800_LIMITS.n1MtoPct;
  const ratings = new ThrustRatingComputer(ctx, {
    ratings: {
      TO: ratingTable(N1C_TO, lim),
      GA: ratingTable(N1C_TO, lim),
      CLB: ratingTable(N1C_CLB, lim),
      CRZ: ratingTable(N1C_CRZ, lim),
      MCT: ratingTable(N1C_MCT, lim),
    },
    initial: 'TO',
    auto: {
      takeoff: 'TO',
      climb: 'CLB',
      goAround: 'GA',
      goAroundWhen: 'gear.air_ground == 0 && surf.flaps_deg > 25', // EST: landing flaps selected in the air arm the GA rating
      // Automatic TO -> CLB only (above 1,500 ft RA, or with the RA out of range). Found by the check-airman pass: a
      // level condition ('airborne && RA > 1,500') re-selected CLB every frame, so the TSC TRS page could not select
      // CRZ or MCT in flight. Manual selections now stick until the next automatic transition (EST: Primus Epic TRS
      // auto-sequences TO -> CLB after takeoff; CRZ / MCT are crew selections).
      climbWhen: (v) =>
        v.get('gear.air_ground') === 0 && v.getString('fadec.rating') === 'TO' && (v.get('ra1.valid') === 0 || v.get('ra1.alt_ft') > 1500) ? 1 : 0,
    },
  });
  const fadec = new ThrustLeverFadec(
    ctx,
    {
      engines: [1, 2],
      leverVar: (e) => V.tlaEff(e),
      law: { kind: 'linear', maxRating: 'TO' },
      idle: {
        ground: 22,
        flight: { x: [0, 15000, 30000, 45000, 51000], y: [27, 32, 39, 47, 50] }, // EST
        approach: { x: [0, 5000, 15000], y: [34, 36, 40] }, // EST
        approachWhen: APPROACH_IDLE,
      },
      reverse: { maxN1: 75, deployS: 2, stowS: 2.5, power: 'clamp01(max(hyd.left_psi, hyd.right_psi) / 2600)' }, // EST (BR725 reverse LP limit 78.1 %, GVI)
      power: (e) => `eng${e}.n2_pct > 10 || elec.fadec_${e === 1 ? 'l' : 'r'}_aux_powered`,
    },
    ratings,
  );
  const starts = [1, 2].map((i) => {
    const run = i === 1 ? V.runL : V.runR;
    const fire = i === 1 ? V.fireHandleL : V.fireHandleR;
    return new EngineStartController(ctx, {
      engine: i,
      startSwitch: V.startReq(i),
      runLever: `${run} == 1 && ${fire} == 0`,
      stopSwitch: `${run} == 0 && ${V.crankMaster} == 0`,
      fuelOnN2Pct: 20, // EST: fdm light-off 18 % HP
      starterCutoutN2Pct: G800_LIMITS.starterCutoutN2Pct, // GVI: 42 % HP
      idleN2Pct: 60,
      hotStartIttC: G800_LIMITS.tgtStartGroundC, // E135: 800 degC ground start limit (FADEC auto shutdown, FSB 9.2.1 j)
      hotStartPredictS: 0.5,
      lightOffTimeoutS: 15,
      hungWindowS: 15,
      maxStarterS: 180, // GVI starter duty: 3 min per attempt
      clearingMotorS: 15,
      starterAvailable: 1, // air turbine starter: strength from duct pressure (PneumaticSystem starter)
      ignitionPower: `elec.${i === 1 ? 'l' : 'r'}_ess_dc_powered`,
      continuousIgnition: `${V.contIgn} == 1`,
      starterVar: `fadec.eng${i}.auto_starter`,
    });
  });
  const at = new Autothrottle(ctx, {
    engines: [1, 2],
    style: 'bizjet',
    leverVar: (e) => V.tla(e),
    // EST: autothrottle unavailable with either engine in FADEC alternate (LP) control (ENGINE CONTROL L / R ENG).
    power: `elec.afcs_powered && !${V.engAlt(1)} && !${V.engAlt(2)}`,
    servoRate: 0.12,
    retardRate: 0.1,
    thrHoldKt: 60,
    thrHoldEndFt: 400,
    retardFt: 30, // EST
    retardFlapsDeg: 30,
    discWarnS: 5,
    labels: { THR: 'THR', IDLE: 'IDLE', SPD: 'SPD', SPD_FMS: 'SPD', MACH: 'MACH', HOLD: 'HOLD', TO: 'TO', GA: 'GA', RETARD: 'RETARD' },
    vmoKt: G800_LIMITS.vmoKt,
    mmo: G800_LIMITS.mmo,
  });
  return { ratings, fadec, starts, at };
}
