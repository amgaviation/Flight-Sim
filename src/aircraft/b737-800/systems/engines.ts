/**
 * CFM56-7B26 engine control for the 737-800 (FCOM 7.20 "Engines"; B737ORG
 * "Powerplant"; E004).
 *
 *  - EEC (dual-channel FADEC): thrust lever angle -> N1 command, linear from
 *    the idle schedule to the full-rated take-off N1 at the forward stop; the
 *    FMC N1 LIMIT page selects the rating that the A/T and the N1 reference
 *    bugs use (the avionics suite emits `fadec.rating`). Idle: ground, flight
 *    and approach idle (approach idle in flight with the flaps in landing
 *    configuration, 15 or greater, or engine anti-ice ON for either engine;
 *    FCOM 7.20 "EEC idle modes").
 *  - EEC modes (FCOM 7.20; B737Theory "EEC"): NORMAL computes the N1 from
 *    the ADIRU air data. Soft alternate is entered automatically when the
 *    required air data is lost (ALTN lit, ON still in view) and uses the last
 *    valid flight conditions; hard alternate by selecting ALTN or by
 *    retarding the lever to idle while in soft alternate. In hard ALTN the N1
 *    for a given lever is equal to or higher than in NORMAL and the N1
 *    redline protection is not provided (`B738Eec`).
 *  - Thrust reversers: piggy-back reverse levers, hydraulic (A for engine 1,
 *    B for engine 2, standby as the slower alternate), air/ground or RA < 10 ft interlock,
 *    REVERSER UNLOCKED (amber EIS alert) while in transit (FCOM 7.20).
 *  - Ground start (manual): ENGINE START switch to GRD opens the start valve
 *    (air turbine starter on the bleed duct, pneumatic starter in
 *    airframe.ts) and is held by a solenoid; the start lever to IDLE at 25 %
 *    N2 opens the fuel valves and fires the selected igniter(s); the switch
 *    releases to OFF at 56 % N2 starter cut-out (B737ORG). CONT = continuous
 *    ignition (selected igniters), FLT = both igniters regardless of the
 *    IGNITION select switch (FCOM 7.20). No automatic start
 *    abort on the ground (SCOPE: the EEC hot/wet start detection of later
 *    software is not modelled).
 *
 * Rating tables: the CFM56 N1-limit model of the avionics family
 * (estimateN1Limit, EST, fitted to published QRH-style values) evaluated on
 * an altitude x temperature grid.
 */
import type { SimContext } from '../../../core/SimContext';
import type { Subsystem } from '../../types';
import type { FailureDef } from '../../../systems/failures';
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

/**
 * Hard-alternate N1 schedule. The ALTN mode uses a fixed, flat-rated schedule that assumes the most demanding
 * conditions so that the thrust is equal to or greater than NORMAL at the same lever position (FCOM 7.20; PPRuNe
 * "737 NG EEC alternate": "N1 for a given thrust lever position will be higher ... thrust overboost possible at
 * full forward lever"). EST: +3 % N1 over the NORMAL lever law at full forward (+0 at idle, linear in between);
 * no N1 redline clamp: the full-forward N1 may exceed the 104 % redline (TCDS E00055EN: CFM56-7B N1 104 %).
 */
export const EEC_ALTN = { biasPctAtFull: 3, n1RedlinePct: 104 };

/**
 * EEC mode per engine (0 NORMAL, 1 soft ALTN, 2 hard ALTN; `ac.b738.eec_mode{i}`) and the hard-alternate N1
 * law. Runs right after the ThrustLeverFadec and replaces its N1 command in hard ALTN (forward thrust only;
 * reverse thrust is scheduled the same in both modes). SCOPE: the soft-alternate N1 equals NORMAL (the EEC
 * keeps the last valid flight conditions, and the rating tables here are not a function of the lost data).
 */
export class B738Eec implements Subsystem {
  readonly name = 'b738.eec';
  private readonly hardLatch = [false, false];
  /** Oil quantity per engine (US qt), oil-leak failure model. */
  private readonly oilQt = [ENGINE_OIL.normalQt, ENGINE_OIL.normalQt];
  private t = 0;
  constructor(private readonly ctx: Pick<SimContext, 'vars'>) {}

  /**
   * Engine failures for the QRH non-normal training (QRH 7.1 Engine Failure or Shutdown, 7.2 Engine Limit or
   * Surge or Stall, 7.x Engine Oil, 8.2 Engine Severe Damage or Separation; V1 cut).
   */
  failures(): FailureDef[] {
    const out: FailureDef[] = [];
    for (const i of [1, 2] as const) {
      out.push(
        { id: `eng${i}.flameout`, name: `Engine ${i} failure (flameout)`, category: 'engine', description: 'Combustor flameout with the start lever at IDLE: N2 spools down, ENG FAIL, GEN OFF BUS, ENG hydraulic LOW PRESSURE, bleed lost. Relight after the failure clears (FLT / auto relight).' },
        { id: `eng${i}.severe_damage`, name: `Engine ${i} severe damage`, category: 'engine', description: 'Core seized: N1 / N2 to near zero, no windmilling, high vibration (AVM) on the engine display.' },
        { id: `eng${i}.surge`, name: `Engine ${i} surge / stall`, category: 'engine', description: 'Compressor surge: N1 and EGT fluctuate, EGT rises, vibration.' },
        { id: `eng${i}.oil_leak`, name: `Engine ${i} oil leak`, category: 'engine', description: 'Oil quantity falls to zero in ~10 min, then oil pressure is lost (LOW OIL PRESSURE).' },
        { id: `eng${i}.oil_pump`, name: `Engine ${i} oil pressure loss`, category: 'engine', description: 'Oil pump failure: oil pressure below the red line (LOW OIL PRESSURE).' },
      );
    }
    return out;
  }

  update(dt = 1 / 60): void {
    const v = this.ctx.vars;
    this.t += dt;
    // The EEC needs the ADIRU Pt / Ps / TAT from either ADIRU (both channels cross-fed, FCOM 7.20).
    const dataValid = v.get('adc1.valid') !== 0 || v.get('adc2.valid') !== 0;
    for (let k = 0; k < 2; k++) {
      const i = (k + 1) as 1 | 2;
      const swOn = v.get(B738.eec(i)) !== 0;
      const tla = v.get(B738.fadecTla(i));
      if (dataValid) this.hardLatch[k] = false;
      else if (swOn && tla < 0.03) this.hardLatch[k] = true; // soft ALTN + lever to idle -> hard ALTN
      const mode = !swOn || this.hardLatch[k] ? 2 : !dataValid ? 1 : 0;
      v.set(B738.eecMode(i), mode);
      if (mode === 2) this.altnLaw(i, tla);
      this.failureEffects(k, i, dt);
    }
  }

  /** Hard-alternate N1 law (forward thrust; see EEC_ALTN). */
  private altnLaw(i: 1 | 2, tla: number): void {
    const v = this.ctx.vars;
    if (v.get(`fadec.eng${i}.fuel_cmd`, 1) === 0 && v.get(`eng${i}.running`) === 0) return;
    if (v.get(`ac.b738.fadec_rev${i}`) > 0.02 || v.get(`eng${i}.reverser_pos`) > 0.02) return;
    if (v.get(`fail.fadec.eng${i}`) !== 0) return;
    const lever = Math.max(0, Math.min(1, tla));
    const altn = v.get(`fadec.eng${i}.n1_target`) + EEC_ALTN.biasPctAtFull * lever;
    v.set(ENG.n1Cmd(i), altn);
    v.set(`fadec.eng${i}.n1_target`, altn);
  }

  /** Engine failure effects (physics inputs ENG.seized / vibAdd / oilPressFactor / ittAdd; surge N1 modulation). */
  private failureEffects(k: number, i: 1 | 2, dt: number): void {
    const v = this.ctx.vars;
    const damage = v.get(`fail.eng${i}.severe_damage`) !== 0;
    const surge = v.get(`fail.eng${i}.surge`) !== 0 && v.get(`eng${i}.running`) !== 0;
    v.set(ENG.seized(i), damage ? 1 : 0);
    // AVM scale 0-5 units; severe damage pegs it (EST 5.0), a surge gives EST 2-3 units.
    v.set(ENG.vibAdd(i), damage ? 5 : surge ? 2.5 : 0);
    if (surge) {
      // EST: N1 fluctuation +/- ~8 % at ~0.7 Hz and an EGT rise of ~80 degC with fluctuation (QRH 7.2 conditions:
      // "engine indications abnormal / fluctuating, EGT rising").
      const ph = Math.sin(this.t * 4.4 + i);
      v.set(ENG.n1Cmd(i), Math.max(0, v.get(ENG.n1Cmd(i)) * (1 - 0.08 * (1 + ph) * 0.5)));
      v.set(ENG.ittAdd(i), 80 + 40 * ph);
    } else v.set(ENG.ittAdd(i), 0);
    if (v.get(`fail.eng${i}.oil_leak`) !== 0 && v.get(`eng${i}.n2_pct`) > 5) this.oilQt[k] = Math.max(0, this.oilQt[k] - (ENGINE_OIL.normalQt / 600) * dt);
    v.set(B738.oilQty(i), this.oilQt[k]);
    const pump = v.get(`fail.eng${i}.oil_pump`) !== 0;
    v.set(ENG.oilPressFactor(i), pump ? 0.1 : this.oilQt[k] < 2 ? this.oilQt[k] / 2 * 0.3 : 1);
  }

  reset(): void {
    this.hardLatch[0] = false;
    this.hardLatch[1] = false;
    this.oilQt[0] = this.oilQt[1] = ENGINE_OIL.normalQt;
  }
}

/**
 * CFM56-7B oil: normal quantity on the engine display ~18 US qt (EST line value; the engine display library
 * default), tank usable ~20 qt (EST).
 */
export const ENGINE_OIL = { normalQt: 18 };

export interface EngineControls {
  ratings: ThrustRatingComputer;
  fadec: ThrustLeverFadec;
  starts: EngineStartController[];
  eec: B738Eec;
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
  // Reverser 1 on hydraulic system A, reverser 2 on B; the standby system is the alternate source for both,
  // at a slower rate (FCOM 7.20 / 13.20; EST half rate).
  const hydRev = (e: number) => `${e === 1 ? 'hyd.a_psi' : 'hyd.b_psi'} > 1000 ? 1 : hyd.stby_psi > 1000 ? 0.5 : 0`;
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
        // FCOM 7.20: flaps in landing configuration (15 or greater) or engine anti-ice ON for either engine.
        // SCOPE: the flap / anti-ice signal-failure fallback (approach idle below 15,000 ft) is not modelled.
        approachWhen: `surf.flaps_deg >= 14.5 || ${B738.engAi(1)} || ${B738.engAi(2)}`,
      },
      reverse: { maxN1: REVERSE.maxN1, deployS: REVERSE.deployS, stowS: REVERSE.stowS, powerPerEngine: hydRev, interlock: 'gear.air_ground || (ra1.valid && ra1.alt_ft < 10)' },
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
        // IGNITION select: IGN L (AC standby bus) / BOTH / IGN R (AC XFR 1) (FCOM 7.20). ENGINE START FLT
        // energises both igniters whatever the IGNITION select position (FCOM 7.20); igniter state in logic.ts.
        ignitionPower: `${B738.engStart(i)} >= 2.5 ? (elec.ign_l_powered || elec.ign_r_powered) : ${B738.ignSel} <= -0.5 ? elec.ign_l_powered : ${B738.ignSel} >= 0.5 ? elec.ign_r_powered : (elec.ign_l_powered || elec.ign_r_powered)`,
        continuousIgnition: `${B738.engStart(i)} >= 2`,
        autoRelight: true,
      }),
  );
  return { ratings, fadec, starts, eec: new B738Eec(ctx) };
}
