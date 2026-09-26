/**
 * CFM56-7B26 engine control for the 737-800 (FCOM 7.20 "Engines"; B737ORG
 * "Powerplant"; E004).
 *
 *  - EEC (dual-channel FADEC): thrust lever angle -> N1 command, linear from
 *    the idle schedule to the full-rated take-off N1 at the forward stop; the
 *    FMC N1 LIMIT page selects the rating that the A/T and the N1 reference
 *    bugs use (the avionics suite emits `fadec.rating`). Idle: ground, flight
 *    and approach idle (approach idle with flaps >= 15 or gear down, FCOM).
 *  - Thrust reversers: piggy-back reverse levers, hydraulic (A for engine 1,
 *    B for engine 2, standby as backup), air/ground or RA < 10 ft interlock,
 *    REVERSER UNLOCKED (amber EIS alert) while in transit (FCOM 7.20).
 *  - Ground start (manual): ENGINE START switch to GRD opens the start valve
 *    (air turbine starter on the bleed duct, pneumatic starter in
 *    airframe.ts) and is held by a solenoid; the start lever to IDLE at 25 %
 *    N2 opens the fuel valves and fires the selected igniter(s); the switch
 *    releases to OFF at 56 % N2 starter cut-out (B737ORG). CONT = continuous
 *    ignition (selected igniters), FLT = both igniters. No automatic start
 *    abort on the ground (SCOPE: the EEC hot/wet start detection of later
 *    software is not modelled).
 *
 * Rating tables: the CFM56 N1-limit model of the avionics family
 * (estimateN1Limit, EST, fitted to published QRH-style values) evaluated on
 * an altitude x temperature grid.
 */
import type { SimContext } from '../../../core/SimContext';
import type { Table2D } from '../../../physics/types';
import { ENG } from '../../../core/vars';
import { ThrustRatingComputer, ThrustLeverFadec, EngineStartController } from '../../../systems/fadec';
import { estimateN1Limit, type N1Rating } from '../../../avionics/boeing-737/data/cfm56';
import { CFM56_7B26 } from '../data';
import { B738 } from '../vars';

const RATINGS: N1Rating[] = ['TO', 'TO-1', 'TO-2', 'CLB', 'CLB-1', 'CLB-2', 'CRZ', 'CON', 'GA'];

function ratingTable(r: N1Rating): Table2D {
  const alts = [-1000, 0, 2000, 4000, 6000, 8000, 10000, 15000, 20000, 25000, 30000, 35000, 41000, 45000];
  const temps = [-70, -60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
  return { x: alts, y: temps, z: alts.map((a) => temps.map((t) => Math.round(estimateN1Limit(r, a, t) * 100) / 100)) };
}

/**
 * EEC idle schedules (N1 %, EST from line values): ground idle ~20.5 %
 * (physics n1Idle); flight idle rises with altitude; approach idle keeps the
 * engines spooled for a go-around (~30 % at sea level).
 */
export const IDLE_N1 = {
  ground: 20.5,
  flight: { x: [0, 10000, 20000, 30000, 41000], y: [22, 27, 31, 36, 42] },
  approach: { x: [0, 10000, 20000], y: [30, 33, 36] },
};

/** Reverse thrust: max reverse N1 ~80 % (EST, FCOM "reverse thrust above 80 % N1 ... "), deploy ~2 s / stow ~3 s (EST). */
export const REVERSE = { maxN1: 80, deployS: 2, stowS: 3 };

export interface EngineControls {
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
}

export function createEngineControls(ctx: SimContext, opts: { autoRating?: boolean } = {}): EngineControls {
  const tables: Record<string, Table2D> = {};
  for (const r of RATINGS) tables[r] = ratingTable(r);
  const ratings = new ThrustRatingComputer(ctx, {
    ratings: tables,
    initial: 'TO',
    // The FMC selects the rating (fadec.rating events). Without an FMC (no nav database) the TRC runs its own
    // automatic selection: TO on the ground, CLB after lift-off, GA with the flaps out in the air.
    ...(opts.autoRating
      ? { auto: { takeoff: 'TO', climb: 'CLB', goAround: 'GA', goAroundWhen: 'surf.flaps_deg > 0.5 && gear.air_ground == 0 && ra1.alt_ft < 2000 && ap.vert_code == 15' } }
      : {}),
  });
  const hydRev = 'hyd.a_psi > 1000 || hyd.b_psi > 1000 || hyd.stby_psi > 1000';
  const fadec = new ThrustLeverFadec(
    ctx,
    {
      engines: [1, 2],
      leverVar: (e) => B738.fadecTla(e as 1 | 2),
      reverseLeverVar: (e) => `ac.b738.fadec_rev${e}`,
      law: { kind: 'linear', maxRating: 'TO' },
      idle: {
        ground: IDLE_N1.ground,
        flight: IDLE_N1.flight,
        approach: IDLE_N1.approach,
        approachWhen: 'surf.flaps_deg >= 14.5 || gear.down_locked',
      },
      reverse: { maxN1: REVERSE.maxN1, deployS: REVERSE.deployS, stowS: REVERSE.stowS, power: hydRev, interlock: 'gear.air_ground || (ra1.valid && ra1.alt_ft < 10)' },
      // EEC: own alternator above 15 % N2 (B737ORG), AC transfer bus during the start.
      power: (e) => `${ENG.n2(e)} > 15 || elec.eec${e}_alt_powered`,
    },
    ratings,
  );
  const starts = ([1, 2] as const).map(
    (i) =>
      new EngineStartController(ctx, {
        engine: i,
        manual: true,
        startSwitch: `${B738.engStart(i)} == 0`,
        startKind: 'held',
        releaseSwitch: { var: B738.engStart(i), offValue: 1 },
        runLever: `${B738.startLever(i)} >= 0.5 && !${B738.fireHandle(i)}`,
        fuelOnN2Pct: CFM56_7B26.fuelOnN2Pct,
        starterCutoutN2Pct: CFM56_7B26.starterCutoutN2Pct,
        idleN2Pct: 59,
        hotStartIttC: CFM56_7B26.egtStartC,
        maxStarterS: CFM56_7B26.starterDutyS,
        // Start valve solenoid on DC; the air supply strength comes from the duct (pneumatic starter).
        starterAvailable: `elec.eng${i}_start_powered`,
        // IGNITION select: IGN L (AC standby bus) / BOTH / IGN R (AC XFR 1) (FCOM 7.20).
        ignitionPower: `${B738.ignSel} <= -0.5 ? elec.ign_l_powered : ${B738.ignSel} >= 0.5 ? elec.ign_r_powered : (elec.ign_l_powered || elec.ign_r_powered)`,
        continuousIgnition: `${B738.engStart(i)} >= 2`,
        autoRelight: true,
      }),
  );
  return { ratings, fadec, starts };
}
