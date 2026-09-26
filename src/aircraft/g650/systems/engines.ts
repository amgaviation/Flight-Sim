/**
 * Gulfstream G650 engines: BR725 FADEC thrust ratings and lever law, start
 * controllers (auto start / crank / alternate start), autothrottle.
 *
 * LUC powerplant / LIM: the dual-channel EEC controls EPR in the primary mode
 * (LP N1 in the alternate mode); thrust ratings TO, GA, CLB, CRZ, MCT are
 * selected on the TRS (display controller) and shown on the engine window;
 * the thrust levers run from IDLE to MAX (TO/GA) with integral reversers
 * (reverse 78.1 % LP max for 30 s, idle reverse by 60 KCAS). Limits: LP
 * 102.8 % takeoff / MCT, HP 100.0 % takeoff, 98.7 % MCT (LIM engine table).
 * SCOPE: the physics engine is N1-controlled; EPR is derived for the displays
 * by the Epic suite (eprFromN1Br700, EST).
 *
 * Idle schedules (LUC): ground idle on the ground, flight idle in the air,
 * approach idle with flaps > 22 deg in the air (full spool-up within 8 s).
 *
 * Starting (LUC, LIM):
 *  - Auto start: START MASTER ON, then L ENG / R ENG start switchlight with the
 *    FUEL CONTROL switch at RUN; the FADEC introduces fuel, igniters off ~42 %
 *    HP, starter cut-out 42 % HP (LIM: "starter cut out of 42% (HP)");
 *    START MASTER / FUEL CONTROL OFF aborts ("L-R Autostart Abort").
 *  - Crank / alternate start: CRANK MASTER ON + L/R ENG (latched in logic.ts):
 *    dry motoring with FUEL CONTROL OFF; with FUEL CONTROL RUN and CONT IGN the
 *    manual (no FADEC protection) alternate start.
 *  - Starter duty: 3 min on (LIM) -> maxStarterS 180.
 */
import type { SimContext } from '../../../core/SimContext';
import type { Table2D } from '../../../physics/types';
import { isaTemperature } from '../../../physics/atmosphere';
import { ThrustRatingComputer, ThrustLeverFadec, EngineStartController, Autothrottle } from '../../../systems/fadec';
import { G650_LIMITS } from '../data';
import { N1_RATED_PCT } from '../fdm';
import { G650_VARS as V } from '../vars';

/** Thrust-lever detents (0..1 forward range). EST: CRZ ~60 %, CLB ~80 % of the forward travel, MAX = TO/GA. */
export const TLA = {
  crz: 0.6,
  clb: 0.8,
  max: 1.0,
  /** Takeoff range (thrust levers "advanced" for pre-pressurisation / takeoff configuration). */
  toRange: 0.9,
  /** LUC: speed brake auto-retract at 95 % TRA. */
  sbRetract: 0.95,
  idle: 0.03,
};

const ALTS = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 41000, 45000, 51000];
const TEMPS = [-70, -56, -40, -20, 0, 15, 30, 40, 50];

/**
 * Physical-N1 rating table from a corrected-N1 schedule vs altitude, flat
 * rated to ISA + flatDevK (LIM: 16,100 lbf at 30 degC = ISA + 15 at sea level),
 * clamped to the LP limit.
 */
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

// Corrected N1 (%) schedules vs ALTS (EST: MCT = 66.6 / 75.2 kN of MTO at sea level (TCDSE) -> 92 % corrected;
// the altitude rise follows the usual high-bypass rating shape; CRZ reproduces the AIN M0.91 FL450 cruise).
export const N1C_TO = ALTS.map((ft) => N1_RATED_PCT + 0.1 * (ft / 1000));
export const N1C_MCT = ALTS.map((ft) => 92 + 0.16 * (ft / 1000));
export const N1C_CLB = ALTS.map((ft) => 91 + 0.15 * (ft / 1000));
export const N1C_CRZ = ALTS.map((ft) => 88 + 0.14 * (ft / 1000));

export interface G650Engines {
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
  at: Autothrottle;
}

export function createEngines(ctx: SimContext): G650Engines {
  const L = G650_LIMITS;
  const ratings = new ThrustRatingComputer(ctx, {
    ratings: {
      TO: ratingTable(N1C_TO, L.n1TakeoffPct),
      GA: ratingTable(N1C_TO, L.n1TakeoffPct),
      CLB: ratingTable(N1C_CLB, L.n1McPct),
      CRZ: ratingTable(N1C_CRZ, L.n1McPct),
      MCT: ratingTable(N1C_MCT, L.n1McPct),
    },
    initial: 'TO',
    auto: { takeoff: 'TO', climb: 'CLB', goAround: 'GA', goAroundWhen: 'surf.flaps_deg > 5 && gear.air_ground == 0 && (gear.down_locked || surf.flaps_deg > 22)' },
  });
  const fadec = new ThrustLeverFadec(
    ctx,
    {
      engines: [1, 2],
      leverVar: (e) => V.tlaEff(e),
      law: {
        kind: 'detent',
        detents: [
          { lever: TLA.crz, rating: 'CRZ', label: 'CRZ' },
          { lever: TLA.clb, rating: 'CLB', label: 'CLB' },
          { lever: TLA.max, rating: 'TO', label: 'MAX' },
        ],
      },
      idle: {
        ground: 24, // EST: fdm.ts n1Idle
        flight: { x: [0, 15000, 30000, 45000], y: [29, 33, 40, 48] }, // EST flight idle (relight / bleed margin)
        approach: { x: [0, 15000], y: [36, 40] }, // EST: approach idle for the 8 s go-around spool-up (LUC)
        approachWhen: 'surf.flaps_deg > 22', // LUC: flaps > 22 deg, WOW air
      },
      // LIM: reverse 78.1 % LP max; L reverser on the left, R reverser on the right hydraulic system (LUC).
      reverse: { maxN1: L.revMaxN1Pct, deployS: 2.0, stowS: 2.5, power: 'clamp01(max(hyd.left_psi, hyd.right_psi) / 2600)' },
      // LUC: EEC powered by its PMA above 35 % HP, else by the ESS DC bus.
      power: (e) => `eng${e}.n2_pct > 35 || elec.${e === 1 ? 'l' : 'r'}_ess_dc_powered`,
    },
    ratings,
  );
  const starts = [1, 2].map((i) => {
    const s = i === 1 ? 'l' : 'r';
    const btn = i === 1 ? V.startL : V.startR;
    const fuelCtl = i === 1 ? V.fuelCtlL : V.fuelCtlR;
    const handle = i === 1 ? V.fireHandleL : V.fireHandleR;
    return new EngineStartController(ctx, {
      engine: i,
      // Auto start: START MASTER + L/R ENG (momentary). Crank / alternate: CRANK MASTER + latched L/R ENG.
      startSwitch: `(${V.startMaster} == 1 && ${btn} == 1) || (${V.crankMaster} == 1 && ${V.crankLatch(i)} == 1)`,
      manual: `${V.crankMaster} == 1 && ${V.startMaster} == 0`,
      runLever: `${fuelCtl} == 1 && !${handle}`,
      // LUC: autostart abort = FUEL CONTROL OFF (CUTOFF abort in the controller) + START MASTER OFF.
      stopSwitch: `${V.startMaster} == 0 && ${V.crankMaster} == 0`,
      fuelOnN2Pct: 18, // EST (light-off at 16 % HP, fdm.ts)
      starterCutoutN2Pct: L.starterCutoutN2Pct,
      idleN2Pct: 62,
      hotStartIttC: L.tgtStartGroundC, // LIM 700 degC ground start
      hotStartPredictS: 0.5,
      lightOffTimeoutS: 12,
      hungWindowS: 15,
      maxStarterS: 180, // LIM starter duty: 3 minutes
      clearingMotorS: 15,
      // The ATS valve solenoid is on the ESS DC bus: available above the relay drop-out (QA lesson: >= 7 V, not "powered").
      starterAvailable: `elec.${s}_ess_dc_v >= 7`,
      ignitionPower: `elec.ign_${s}_powered`,
      continuousIgnition: `${V.contIgn} == 1`,
    });
  });
  const at = new Autothrottle(ctx, {
    engines: [1, 2],
    style: 'bizjet',
    leverVar: (e) => V.tla(e),
    power: 'elec.afcs1_powered || elec.afcs2_powered',
    servoRate: 0.12,
    retardRate: 0.12,
    thrHoldKt: 60,
    thrHoldEndFt: 400, // LUC: fixed lever (HOLD) until 400 ft AGL
    retardFt: 50, // LUC: RETARD below 50 ft RA
    retardFlapsDeg: 22,
    discWarnS: 3, // LUC: "AT1+2" flashes amber 3 s + aural
    labels: { THR: 'THR', IDLE: 'IDLE', SPD: 'SPD', SPD_FMS: 'FMS SPD', MACH: 'MACH', HOLD: 'HOLD', TO: 'TO', GA: 'GA', RETARD: 'RETARD' },
    vmoKt: L.vmoKt,
    mmo: L.mmo,
  });
  return { ratings, fadec, starts, at };
}
