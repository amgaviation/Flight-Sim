/**
 * Williams FJ44-1AP-21 engine control for the Citation M2: dual-channel FADEC
 * thrust ratings and throttle detents, and the FADEC automatic start.
 *
 * S&D15 §8 / S&D21 §8: "Detents in the throttle quadrant for idle, takeoff
 * (TO), climb (CLB) and maximum cruise (CRU)"; TO/GA button on the throttle;
 * dual-channel FADECs powered by engine-driven PMAs (main DC backup); 1,965 lbf
 * takeoff thrust flat rated to 72 degF (22.2 degC). TCDS: N1 red line 104.7 %
 * (100 % = 17,245 rpm), N2 100 % (41,200 rpm), ITT 855 degC takeoff (5 min),
 * 835 degC max continuous, 1,000 degC start transient (15 s).
 *
 * Rating tables (EST): each rating holds a corrected N1 (fraction of the rated
 * 101.5 % N1, fdm.ts); flat rated to ISA+7 (22 degC at sea level): below the
 * flat-rating temperature the physical N1 follows sqrt(T/T_ISA) so thrust is
 * constant, above it physical N1 is held and thrust decays (the FPG field
 * lengths grow above ~20 degC). Capped at the 104.69 % red line.
 * CRU = 0.985 x rated reproduces the FPG high-speed cruise table (tests).
 */
import type { SimContext } from '../../../core/SimContext';
import type { Table2D } from '../../../physics/types';
import { ENG } from '../../../core/vars';
import { isaTemperature } from '../../../physics/atmosphere';
import { ThrustRatingComputer, ThrustLeverFadec, EngineStartController } from '../../../systems/fadec';
import { VERTICAL_MODES } from '../../../systems/autopilot';
import { N1_RATED_PCT } from '../fdm';
import { M2_LIMITS, lookup } from '../data';
import { M2, TLA } from '../vars';

/**
 * Corrected-N1 fraction of each rating vs pressure altitude (EST, see header): TO/CLB rise with
 * altitude (FADEC max-climb schedule toward the N1/ITT limits, calibrated to the FPG time to climb:
 * FL410 in 24 min at MTOW), CRU is constant (FPG high-speed cruise table).
 */
export const RATING_FRACTION = {
  TO: { x: [0, 20000], y: [1.0, 1.035] },
  CLB: { x: [0, 25000], y: [0.995, 1.035] },
  CRU: { x: [0, 41000], y: [0.985, 0.985] },
} as const;
const FLAT_RATE_ISA_DEV_C = 7.2; // 72 degF at sea level = ISA + 7.2 degC (TCDS / S&D)

export function n1Rating(frac: { x: readonly number[]; y: readonly number[] }, altFt: number, satC: number): number {
  const fraction = lookup(frac.x, frac.y, altFt);
  const tIsa = isaTemperature(altFt * 0.3048);
  const tK = satC + 273.15;
  const tEff = Math.min(tK, tIsa + FLAT_RATE_ISA_DEV_C);
  return Math.min(M2_LIMITS.n1RedlinePct, fraction * N1_RATED_PCT * Math.sqrt(tEff / tIsa));
}

function ratingTable(fraction: { x: readonly number[]; y: readonly number[] }): Table2D {
  const alts = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 41000, 45000];
  const temps = [-70, -55, -40, -25, -10, 0, 10, 20, 30, 40, 50];
  return { x: alts, y: temps, z: alts.map((a) => temps.map((t) => Math.round(n1Rating(fraction, a, t) * 100) / 100)) };
}

/** FADEC idle schedules (N1 %, EST): ground idle; flight idle rises with altitude to keep bleed / anti-ice pressure. */
export const IDLE_N1 = { ground: 25, flight: { x: [0, 15000, 30000, 41000], y: [26, 30, 36, 42] } };

export interface EngineControls {
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
}

export function createEngineControls(ctx: SimContext): EngineControls {
  const ratings = new ThrustRatingComputer(ctx, {
    ratings: { TO: ratingTable(RATING_FRACTION.TO), CLB: ratingTable(RATING_FRACTION.CLB), CRU: ratingTable(RATING_FRACTION.CRU), GA: ratingTable(RATING_FRACTION.TO) },
    initial: 'TO',
    auto: { takeoff: 'TO', climb: 'CLB', goAround: 'GA', goAroundWhen: `ap.vert_code == ${VERTICAL_MODES.indexOf('GA')}` },
  });
  const fadec = new ThrustLeverFadec(
    ctx,
    {
      engines: [1, 2],
      leverVar: (e) => M2.fadecTla(e),
      law: {
        kind: 'detent',
        detents: [
          { lever: TLA.cru, rating: 'CRU', label: 'CRU' },
          { lever: TLA.clb, rating: 'CLB', label: 'CLB' },
          { lever: TLA.to, rating: 'TO', label: 'TO' },
        ],
      },
      idle: { ground: IDLE_N1.ground, flight: IDLE_N1.flight },
      // Dual-channel FADEC on the engine PMAs above ~20 % N2, else main DC (S&D15 §8).
      power: (e) => `${ENG.n2(e)} > 20 || elec.fadec${e}_bkp_powered`,
    },
    ratings,
  );
  const starts = [1, 2].map(
    (i) =>
      new EngineStartController(ctx, {
        engine: i,
        startSwitch: M2.startBtn(i),
        startKind: 'momentary',
        stopSwitch: M2.startDiseng,
        // Throttle out of CUTOFF (at IDLE) = RUN; the FADEC schedules start fuel.
        runLever: `${M2.tla(i)} > -0.05 && !${M2.engFireBtn(i)}`,
        fuelOnN2Pct: 9, // EST (fdm light-off 9 %)
        starterCutoutN2Pct: 45, // EST: FADEC starter cut-out, CJ-family ~45 % N2
        idleN2Pct: 52,
        hotStartIttC: 950, // EST: FADEC auto-abort margin below the 1,000 degC start transient limit (TCDS)
        lightOffTimeoutS: 10,
        maxStarterS: 60, // EST: starter duty cycle
        // Start relay on the battery bus: available above the relay drop-out voltage (see electrical.ts).
        starterAvailable: 'elec.batt_bus_v >= 7',
        ignitionPower: `elec.ign${i}_powered`,
        continuousIgnition: `${M2.ignSw(i)} == 1`,
        autoRelight: true,
      }),
  );
  return { ratings, fadec, starts };
}
