/**
 * Bombardier Global 6000 engines: BR700-710A2-20 FADEC thrust ratings and
 * lever law, start controllers (auto start, crank), autothrottle.
 *
 * TCDS 3.2: take-off 14,750 lbf (N1 102.0 %, N2 99.6 %, ITT 900 C, 5 min AEO /
 * 10 min OEI), MCT 14,450 lbf (N2 98.9 %, ITT 860 C), idle N2 58 % minimum,
 * reverse N1 limited by the FADEC to 70 % for 30 s, starting ITT 700 C
 * ground / 850 C in flight. SPEC: flat rated to ISA + 20 C.
 * FADEC: EPR is the primary thrust-setting parameter with N1 as the alternate
 * mode (Global Express pedestal ENGINE EPR / N1 switches, GX_01_018; the
 * Fusion EICAS shows EPR, EST derived from N1 there). SCOPE: the physics
 * engine is N1-controlled in both modes; N1 mode only changes the display and
 * the CAS status message.
 * Thrust levers (GX_01_018 pedestal: MAX / IDLE, piggy-back REV / MAX REV):
 * one MAX detent; below it the FADEC schedules thrust proportionally from
 * idle to the take-off rating, the crew / autothrottle sets the EICAS target
 * for the selected rating (TO / CLB / CRZ / MCT / GA). The minimum take-off
 * position is 30 deg TLA (GXFC ground lift dumping auto-arm): EST 0.67 of the
 * lever travel (45 deg MAX, EST).
 * Idle schedules (EST): ground idle on the ground, flight idle in the air,
 * approach idle with the slats out or the gear down (go-around spool-up).
 * Starting (EST procedure, see the dossier): ENG RUN switch to RUN, then the
 * L / R START push-button: the FADEC opens the start valve (air turbine starter
 * on the APU / cross bleed), fuel + ignition at ~18 % N2, starter cut-out at
 * ~50 % N2, stabilises at ~60 % N2. CRANK = dry motoring (RUN at OFF).
 */
import type { SimContext } from '../../../core/SimContext';
import type { Table2D } from '../../../physics/types';
import { isaTemperature } from '../../../physics/atmosphere';
import { ThrustRatingComputer, ThrustLeverFadec, EngineStartController, Autothrottle } from '../../../systems/fadec';
import { G6K_LIMITS } from '../data';
import { N1_RATED_PCT } from '../fdm';
import { G6K_VARS as V } from '../vars';

/** Thrust-lever positions (0..1 forward range). */
export const TLA = {
  idle: 0.03,
  /** GXFC: minimum take-off position 30 deg TLA (GLD auto-arm, pre-pressurisation, takeoff configuration check). EST 30/45. */
  toMin: 0.67,
  max: 1.0,
};

const ALTS = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 41000, 45000, 51000];
const TEMPS = [-70, -56, -40, -20, 0, 15, 30, 40, 50];

/**
 * Physical-N1 rating table from a corrected-N1 schedule vs altitude, flat
 * rated to ISA + 20 C (SPEC), clamped to the N1 limit (TCDS 102.0 %).
 */
export function ratingTable(n1cVsAlt: number[], limitPct: number, flatDevK = G6K_LIMITS.flatRatedIsaDevC): Table2D {
  const z = ALTS.map((ft, i) => {
    const tIsa = isaTemperature(ft * 0.3048);
    return TEMPS.map((tc) => {
      const tt = Math.min(tc + 273.15, tIsa + flatDevK);
      const n1 = n1cVsAlt[i] * Math.sqrt(tt / tIsa);
      return Math.round(Math.min(limitPct, n1) * 100) / 100;
    });
  });
  return { x: ALTS, y: TEMPS, z };
}

// Corrected-N1 schedules vs ALTS (EST: MCT = 14,450 / 14,750 lbf (TCDS) -> ~99.2 % of the take-off corrected N1 at
// sea level; climb / cruise follow the usual high-bypass rating shape, calibrated in the climb / cruise tests).
export const N1C_TO = ALTS.map((ft) => N1_RATED_PCT + 0.08 * (ft / 1000));
export const N1C_MCT = ALTS.map((ft) => N1_RATED_PCT - 0.8 + 0.12 * (ft / 1000));
export const N1C_CLB = ALTS.map((ft) => N1_RATED_PCT - 2.5 + 0.13 * (ft / 1000));
export const N1C_CRZ = ALTS.map((ft) => N1_RATED_PCT - 5 + 0.14 * (ft / 1000));

export interface G6kEngines {
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
  at: Autothrottle;
}

export function createEngines(ctx: SimContext): G6kEngines {
  const L = G6K_LIMITS;
  const ratings = new ThrustRatingComputer(ctx, {
    ratings: {
      TO: ratingTable(N1C_TO, L.n1TakeoffPct),
      GA: ratingTable(N1C_TO, L.n1TakeoffPct),
      MCT: ratingTable(N1C_MCT, L.n1TakeoffPct),
      CLB: ratingTable(N1C_CLB, L.n1TakeoffPct),
      CRZ: ratingTable(N1C_CRZ, L.n1TakeoffPct),
    },
    initial: 'TO',
    auto: {
      takeoff: 'TO',
      climb: 'CLB',
      cruise: 'CRZ',
      goAround: 'GA',
      // EST: GA in the air with the slats out and the gear down, and held through the go-around while the AFCS
      // vertical mode is GA (ap.vert_code 15 = VERTICAL_MODES 'GA'; the gear comes up in the go-around); CRZ once level
      // above FL250 (FMS phase). TO is held after lift-off through the take-off thrust phase (logic.ts `V.toPhase`),
      // CLB after it.
      goAroundWhen: `gear.air_ground == 0 && !${V.toPhase} && ((surf.slats > 0.5 && gear.down_locked) || ap.vert_code == 15)`,
      climbWhen: `!${V.toPhase}`,
      // ap.vert_code: VERTICAL_MODES index (3 ALT, 11 VALT: level at altitude in ALT hold or VNAV altitude hold).
      cruiseWhen: `adc1.alt_ft > 25000 && abs(adc1.vs_fpm) < 300 && (ap.vert_code == 3 || ap.vert_code == 11)`,
    },
  });
  const fadec = new ThrustLeverFadec(
    ctx,
    {
      engines: [1, 2],
      leverVar: (e) => V.tlaEff(e as 1 | 2),
      reverseLeverVar: (e) => `${V.revLever(e as 1 | 2)}_eff`,
      law: { kind: 'detent', detents: [{ lever: TLA.max, rating: 'TO', label: 'MAX' }] },
      idle: {
        ground: 24, // EST: fdm.ts n1Idle
        flight: { x: [0, 15000, 30000, 45000], y: [28, 32, 38, 46] }, // EST flight idle (bleed / relight margin)
        approach: { x: [0, 15000], y: [34, 38] }, // EST approach idle for the go-around spool-up
        approachWhen: 'surf.slats > 0.5 || gear.down_locked',
      },
      // TCDS: FADEC limits reverse N1 to 70.0 %; left reverser on system 1, right on system 2 (GXHY).
      reverse: { maxN1: L.revN1Pct, deployS: 1.8, stowS: 2.2, power: 'clamp01(max(hyd.sys1_psi, hyd.sys2_psi) / 2600)' },
      // EST: EEC powered by its PMA above ~35 % N2, else by the ESS / BATT bus.
      power: (e) => `eng${e}.n2_pct > 35 || elec.fadec${e}_powered`,
    },
    ratings,
  );
  const starts = ([1, 2] as const).map((i) => {
    const s = i === 1 ? 'l' : 'r';
    return new EngineStartController(ctx, {
      engine: i,
      startSwitch: `${V.engStart(i)} == 1 || ${V.engCrank(i)} == 1`,
      manual: `${V.engCrank(i)} == 1`, // CRANK: starter follows the latched switch, fuel follows the RUN switch (dry motoring at OFF)
      runLever: `${V.engRun(i)} == 1 && !${V.fireHandle(s)}`,
      fuelOnN2Pct: 18, // EST (light-off at 15 % N2, fdm.ts)
      starterCutoutN2Pct: 50, // EST
      idleN2Pct: 60,
      hotStartIttC: L.ittStartGroundC, // TCDS 700 C on the ground
      hotStartPredictS: 0.5,
      lightOffTimeoutS: 15,
      hungWindowS: 15,
      maxStarterS: 120, // EST starter duty
      clearingMotorS: 15,
      // Start valve solenoid on the DC ESS / BATT bus: available above the relay drop-out (QA lesson: >= 7 V, not "powered").
      starterAvailable: `elec.${i === 1 ? 'dc_ess' : 'batt_bus'}_v >= 7`,
      ignitionPower: `elec.ign${i}_powered`,
      continuousIgnition: `${V.ignition} == 1`,
    });
  });
  const at = new Autothrottle(ctx, {
    engines: [1, 2],
    style: 'bizjet',
    leverVar: (e) => V.tla(e as 1 | 2),
    power: 'elec.afcs1_powered || elec.afcs2_powered',
    servoRate: 0.12,
    // EST gain: the default Kp 0.02 speed loop hunted +/-15 % N1 with a ~20 s period on the flaps-30 approach (BR710
    // spool-up lag against the landing-configuration drag); half the proportional gain, default IAS-trend damping.
    speedKp: 0.01,
    speedKd: 0.08,
    retardRate: 0.1,
    thrHoldKt: 60,
    thrHoldEndFt: 400,
    retardFt: 50,
    retardFlapsDeg: 15,
    discWarnS: 3,
    labels: { THR: 'THR', IDLE: 'IDLE', SPD: 'SPD', SPD_FMS: 'FMS SPD', MACH: 'MACH', HOLD: 'HOLD', TO: 'TO', GA: 'GA', RETARD: 'RETARD' },
    vmoKt: L.vmoKt,
    mmo: L.mmo,
    vnavSpeedFromSelected: true, // Fusion FCP SPD FMS / MAN writes the FMS speed into the selected speed (createSystems.ts)
  });
  return { ratings, fadec, starts, at };
}
