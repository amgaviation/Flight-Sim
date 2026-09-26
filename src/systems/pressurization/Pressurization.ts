/**
 * Cabin pressurisation: a physical cabin (air mass in a fixed volume) with
 * inflow from the packs and outflow through a motorised outflow valve,
 * fuselage leakage, positive/negative relief (safety) valves and optional
 * structural breach, governed by an automatic controller.
 *
 * Cabin model (sub-stepped 8× per update):
 *   dm/dt = ṁ_in − ṁ_outflow(A_valve) − ṁ_leak − ṁ_safety + ṁ_neg_relief
 *   P_cab = m·R·T / V
 * Orifice flow is compressible (subsonic/choked), both directions.
 *
 * Controller (AUTO or ALTN; identical logic, independent failures):
 *   phases: GROUND -> CLIMB -> DESCENT (-> CLIMB again on a go-around / climb)
 *   GROUND:  outflow open (cabin = field) or, with takeoff pre-pressurisation,
 *            cabin held `groundPrepress.psi` above ambient.
 *   CLIMB:   target = blend from the takeoff-cabin to schedule(Hc) in
 *            proportion to climb progress (Hc = flight altitude if set, else
 *            schedule(H) blended over the first 10,000 ft).
 *   DESCENT: (H < peak − 1500 ft) target descends in proportion to the
 *            aircraft's descent from the top to the landing field
 *            (landing elevation + bias at touchdown).
 *   Always:  target ≥ the cabin altitude giving maxDiffPsi (differential limit).
 *   The commanded cabin altitude is rate-limited to the cabin climb/descent
 *   limits; the valve command is computed by inverting the orifice equation
 *   for the outflow that makes the cabin follow it (model-based
 *   feed-forward + proportional correction, τ = 3 s), and the valve moves
 *   at its actuator rate.
 *   MANUAL:  the valve moves at the manual rate while commanded.
 *   DUMP:    the valve drives fully open.
 *
 * Outputs (prefix default 'press.'):
 *   cabin_alt_ft, cabin_rate_fpm (lagged 2 s), diff_psi, cabin_psi (absolute),
 *   outflow_pos (0..1), target_alt_ft (commanded cabin alt), sched_alt_ft,
 *   ldg_elev_ft, cabin_alt_warn (≥ cabinAltWarnFt, 200 ft hysteresis),
 *   pax_masks (latched deploy), safety_valve, neg_relief, excess_diff,
 *   mode (0 AUTO / 1 ALTN / 2 MANUAL, effective), auto_fail, altn_fail,
 *   phase (0 ground, 1 climb, 2 descent), inflow_kgs, outflow_kgs.
 *
 * Failures: press.auto, press.altn (controller faults), press.outflow
 * (outflow valve jammed), press.leak (door seal: ×10 leakage),
 * press.decompression (structural breach).
 */
import type { SimVars } from '../../core/SimVars';
import type { Subsystem } from '../../aircraft/types';
import { FDM, FMS } from '../../core/vars';
import { interp1 } from '../../core/math';
import { FT_TO_M, M_TO_FT, PSI_TO_PA, PA_TO_PSI } from '../../core/units';
import { isaPressure, pressureAltitude, R_AIR, GAMMA } from '../../physics/atmosphere';
import { compileBinding, compileCondition, type Evaluator } from '../util/binding';
import { failVar } from '../util/ids';
import { Actuator } from '../util/filters';
import { EdgeDetector, Hysteresis } from '../util/timers';
import type { FailureDef } from '../failures/FailureManager';
import type { PressurizationConfig } from './types';

const SUBSTEPS = 8;
/** Pressure-tracking time constant of the controller (s). */
const TRACK_TAU_S = 3;
/** Blend distance (ft) over which the climb target moves from the takeoff cabin to the schedule when no flight altitude is set. */
const CLIMB_BLEND_FT = 10000;
/** Critical pressure ratio for choked flow (γ = 1.4). */
const PR_CRIT = Math.pow(2 / (GAMMA + 1), GAMMA / (GAMMA - 1));
const FLOW_K = Math.sqrt((2 * GAMMA) / ((GAMMA - 1) * R_AIR));

/** Pressure (Pa) at a pressure altitude (ft). */
export function pressureAtAltitudeFt(ft: number): number {
  return isaPressure(ft * FT_TO_M);
}

/** Pressure altitude (ft) of a pressure (Pa). */
export function altitudeFtAtPressure(pa: number): number {
  return pressureAltitude(Math.max(1, pa)) * M_TO_FT;
}

/** Cabin altitude (ft) reached with differential `diffPsi` at aircraft pressure altitude `altFt`. */
export function cabinAltitudeForDiff(altFt: number, diffPsi: number): number {
  return altitudeFtAtPressure(pressureAtAltitudeFt(altFt) + diffPsi * PSI_TO_PA);
}

/** Compressible orifice mass flow (kg/s) through effective area `a` (m²) from pUp to pDown at upstream temperature T (K). */
export function orificeFlow(a: number, pUp: number, pDown: number, T: number): number {
  if (a <= 0 || pUp <= pDown) return 0;
  let pr = pDown / pUp;
  if (pr < PR_CRIT) pr = PR_CRIT;
  const term = Math.pow(pr, 2 / GAMMA) - Math.pow(pr, (GAMMA + 1) / GAMMA);
  return a * pUp * FLOW_K * Math.sqrt(term > 0 ? term / T : 0);
}

const Phase = { Ground: 0, Climb: 1, Descent: 2 } as const;
type Phase = (typeof Phase)[keyof typeof Phase];

export class Pressurization implements Subsystem {
  readonly name = 'pressurization';
  readonly prefix: string;
  /** Cabin air mass (kg). */
  private mass: number;
  private phase: Phase = Phase.Ground;
  private cmdAlt = 0;
  private prevCmdP = 0;
  private refAlt = 0;
  private refCabin = 0;
  private peakAlt = 0;
  private topAlt = 0;
  private topCabin = 0;
  private lowestInDescent = 0;
  private fieldElev = 0;
  private rateFpm = 0;
  private prevCabinAlt = NaN;
  private masks = false;
  private destElev: number | undefined;
  private outflowKgs = 0;
  private safetyOpen = false;
  private negOpen = false;
  private readonly valve: Actuator;
  private readonly warn: Hysteresis;
  private readonly masksResetEdge = new EdgeDetector();
  private readonly offs: (() => void)[] = [];

  private readonly V: number;
  private readonly maxArea: number;
  private readonly leakArea: number;
  private readonly safetyArea: number;
  private readonly breachArea: number;
  private readonly relief: number;
  private readonly negRelief: number;
  private readonly autoTravel: number;
  private readonly manualTravel: number;

  private readonly inflow: Evaluator;
  private readonly flightAlt: Evaluator;
  private readonly ldgManual: Evaluator | null;
  private readonly ldgAuto: () => boolean;
  private readonly mode: Evaluator;
  private readonly manualCmd: Evaluator;
  private readonly dump: () => boolean;
  private readonly masksManual: () => boolean;
  private readonly masksReset: () => boolean;
  private readonly onGround: () => boolean;
  private readonly pAmb: Evaluator;
  private readonly altFt: Evaluator;
  private readonly cabinT: Evaluator;
  private readonly prepress: () => boolean;
  private readonly o: Record<string, string>;
  private readonly f: Record<'auto' | 'altn' | 'outflow' | 'leak' | 'decomp', string>;

  constructor(
    private readonly vars: SimVars,
    private readonly cfg: PressurizationConfig,
  ) {
    if (!(cfg.cabinVolumeM3 > 0)) throw new Error('Pressurization: cabinVolumeM3 must be > 0');
    if (!(cfg.maxDiffPsi > 0)) throw new Error('Pressurization: maxDiffPsi must be > 0');
    const P = (this.prefix = cfg.prefix ?? 'press.');
    this.V = cfg.cabinVolumeM3;
    this.maxArea = cfg.outflowValve?.maxAreaM2 ?? 3.5e-4 * this.V;
    this.leakArea = cfg.leakAreaM2 ?? 1e-5 * this.V;
    this.safetyArea = cfg.safetyAreaM2 ?? this.maxArea;
    this.breachArea = cfg.decompressionAreaM2 ?? 0.1;
    this.relief = (cfg.reliefPsi ?? cfg.maxDiffPsi + 0.5) * PSI_TO_PA;
    this.negRelief = (cfg.negReliefPsi ?? 0.5) * PSI_TO_PA;
    this.autoTravel = cfg.outflowValve?.autoTravelS ?? 5;
    this.manualTravel = cfg.outflowValve?.manualTravelS ?? 20;

    this.inflow = compileBinding(vars, cfg.inflowKgs, 0);
    this.flightAlt = compileBinding(vars, cfg.flightAltitude, 0);
    this.ldgManual = cfg.landingElevation !== undefined ? compileBinding(vars, cfg.landingElevation) : null;
    this.ldgAuto = compileCondition(vars, cfg.landingElevationAuto, cfg.destinationElevation !== undefined);
    this.mode = compileBinding(vars, cfg.mode, 0);
    this.manualCmd = compileBinding(vars, cfg.manualCommand, 0);
    this.dump = compileCondition(vars, cfg.dump, false);
    this.masksManual = compileCondition(vars, cfg.masksManual, false);
    this.masksReset = compileCondition(vars, cfg.masksReset, false);
    this.onGround = compileCondition(vars, cfg.onGround ?? FDM.onGround, true);
    this.pAmb = compileBinding(vars, cfg.staticPressurePa ?? FDM.staticPressPa, 101325);
    this.altFt = compileBinding(vars, cfg.pressureAltitudeFt ?? FDM.pressAlt, 0);
    this.cabinT = compileBinding(vars, cfg.cabinTempC, 22);
    this.prepress = compileCondition(vars, cfg.groundPrepress?.active, false);

    const names = [
      'cabin_alt_ft', 'cabin_rate_fpm', 'diff_psi', 'cabin_psi', 'outflow_pos', 'target_alt_ft', 'sched_alt_ft', 'ldg_elev_ft',
      'cabin_alt_warn', 'pax_masks', 'safety_valve', 'neg_relief', 'excess_diff', 'mode', 'auto_fail', 'altn_fail', 'phase',
      'inflow_kgs', 'outflow_kgs',
    ];
    this.o = {};
    for (const n of names) this.o[n] = `${P}${n}`;
    this.f = {
      auto: failVar('press.auto'),
      altn: failVar('press.altn'),
      outflow: failVar('press.outflow'),
      leak: failVar('press.leak'),
      decomp: failVar('press.decompression'),
    };
    this.warn = new Hysteresis(cfg.cabinAltWarnFt ?? 10000, (cfg.cabinAltWarnFt ?? 10000) - 200);

    // Initial state: cabin at ambient unless a saved cabin altitude exists.
    const pa = this.pAmb();
    const savedAlt = vars.has(this.o.cabin_alt_ft) ? vars.get(this.o.cabin_alt_ft) : NaN;
    const pc = Number.isFinite(savedAlt) ? pressureAtAltitudeFt(savedAlt) : pa;
    this.mass = (pc * this.V) / (R_AIR * (this.cabinT() + 273.15));
    this.valve = new Actuator(this.autoTravel, 1);
    this.cmdAlt = altitudeFtAtPressure(pc);
    this.prevCmdP = pc;
    this.fieldElev = this.altFt();
    this.masks = vars.get(this.o.pax_masks) !== 0;

    if (cfg.destinationElevation) {
      const dv = cfg.destinationVar ?? FMS.destIdent;
      const resolve = (id: string): void => {
        this.destElev = id ? cfg.destinationElevation!(id) : undefined;
      };
      resolve(vars.getString(dv));
      this.offs.push(vars.subscribeString(dv, (v) => resolve(v)));
    }
  }

  /** Landing field elevation in use (ft). */
  landingElevation(): number {
    if (this.ldgAuto() && this.destElev !== undefined) return this.destElev;
    if (this.ldgManual) return this.ldgManual();
    return this.fieldElev;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const vars = this.vars;
    const cfg = this.cfg;
    const pa = Math.max(100, this.pAmb());
    const H = this.altFt();
    const onGround = this.onGround();
    const Tk = this.cabinT() + 273.15;
    const pCab0 = (this.mass * R_AIR * Tk) / this.V;
    const cabinAlt0 = altitudeFtAtPressure(pCab0);
    const ldg = this.landingElevation();
    const bias = cfg.landingBiasFt ?? -300;

    // ---- phase logic
    if (onGround) {
      if (this.phase !== Phase.Ground) this.phase = Phase.Ground;
      this.fieldElev = H;
      this.refAlt = H;
      this.refCabin = cabinAlt0;
      this.peakAlt = H;
    } else if (this.phase === Phase.Ground) {
      this.phase = Phase.Climb;
      this.refAlt = this.fieldElev;
      this.refCabin = Math.min(cabinAlt0, this.fieldElev);
      this.peakAlt = H;
    }
    if (this.phase === Phase.Climb) {
      if (H > this.peakAlt) this.peakAlt = H;
      if (H < this.peakAlt - 1500) {
        this.phase = Phase.Descent;
        this.topAlt = this.peakAlt;
        this.topCabin = this.cmdAlt;
        this.lowestInDescent = H;
      }
    } else if (this.phase === Phase.Descent) {
      if (H < this.lowestInDescent) this.lowestInDescent = H;
      if (H > this.lowestInDescent + 1500) {
        this.phase = Phase.Climb;
        this.refAlt = H;
        this.refCabin = this.cmdAlt;
        this.peakAlt = H;
      }
    }

    // ---- scheduled target
    const sched = interp1(cfg.schedule, H);
    let target: number;
    if (this.phase === Phase.Ground) {
      target = H;
    } else if (this.phase === Phase.Climb) {
      const hc = this.flightAlt();
      if (hc > this.refAlt + 1000) {
        const f = clamp01((H - this.refAlt) / (Math.max(hc, H) - this.refAlt));
        target = this.refCabin + (interp1(cfg.schedule, Math.max(hc, H)) - this.refCabin) * f;
      } else {
        const f = clamp01((H - this.refAlt) / CLIMB_BLEND_FT);
        target = this.refCabin + (sched - this.refCabin) * f;
      }
    } else {
      const lfeCabin = ldg + bias;
      const span = this.topAlt - ldg;
      const f = span > 1 ? clamp01((H - ldg) / span) : 0;
      target = lfeCabin + (this.topCabin - lfeCabin) * f;
    }
    // Differential limit (controller never schedules more than maxDiff).
    if (!onGround) {
      const limitAlt = cabinAltitudeForDiff(H, cfg.maxDiffPsi);
      if (target < limitAlt) target = limitAlt;
    }

    // ---- controller mode and failures
    const autoFail = vars.get(this.f.auto) !== 0;
    const altnFail = vars.get(this.f.altn) !== 0;
    let mode = Math.round(this.mode());
    if (mode === 0 && autoFail && (cfg.autoTransferToAltn ?? true)) mode = 1;
    const controllerOk = (mode === 0 && !autoFail) || (mode === 1 && !altnFail);
    this.valve.stuck = vars.get(this.f.outflow) !== 0;

    // ---- commanded cabin altitude (rate limited)
    const climbLim = ((cfg.maxCabinClimbFpm ?? 500) / 60) * dt;
    const descLim = ((cfg.maxCabinDescentFpm ?? 300) / 60) * dt;
    if (onGround) {
      // Depressurise on the ground at ~500 fpm (EST; G450 post-landing: 500 fpm, then 2000 fpm), or hold pre-pressurisation.
      const gTarget = this.prepress() && cfg.groundPrepress ? altitudeFtAtPressure(pa + cfg.groundPrepress.psi * PSI_TO_PA) : H;
      const lim = ((this.prepress() ? (cfg.maxCabinDescentFpm ?? 300) : 2000) / 60) * dt;
      this.cmdAlt += clampAbs(gTarget - this.cmdAlt, lim);
    } else {
      const d = target - this.cmdAlt;
      this.cmdAlt += d > 0 ? Math.min(d, climbLim) : Math.max(d, -descLim);
    }
    const cmdP = pressureAtAltitudeFt(this.cmdAlt);
    const dCmdP = (cmdP - this.prevCmdP) / dt;
    this.prevCmdP = cmdP;

    // ---- valve command
    const inflow = Math.max(0, this.inflow());
    const leakA = this.leakArea * (vars.get(this.f.leak) !== 0 ? 10 : 1) + (vars.get(this.f.decomp) !== 0 ? this.breachArea : 0);
    let valveCmd = this.valve.position;
    if (this.dump() && mode !== 2) {
      valveCmd = 1;
      this.valve.travelS = this.autoTravel;
    } else if (mode === 2) {
      // Manual: the valve moves while the switch is held.
      const c = this.manualCmd();
      this.valve.travelS = this.manualTravel;
      valveCmd = c > 0.05 ? 1 : c < -0.05 ? 0 : this.valve.position;
    } else if (controllerOk) {
      this.valve.travelS = this.autoTravel;
      if (onGround && !this.prepress() && this.cmdAlt >= H - 20) valveCmd = 1;
      else {
        const k = this.V / (R_AIR * Tk);
        const netDes = k * ((cmdP - pCab0) / TRACK_TAU_S + dCmdP);
        const leak = orificeFlow(leakA, pCab0, pa, Tk);
        const outReq = inflow - leak - netDes;
        const perArea = orificeFlow(1, pCab0, pa, Tk);
        if (outReq <= 0) valveCmd = 0;
        else if (perArea <= 1e-9) valveCmd = 1;
        else valveCmd = clamp01(outReq / perArea / this.maxArea);
      }
    }
    // else: failed controller in AUTO/ALTN: the valve freezes where it is.
    this.valve.update(valveCmd, dt);

    // ---- cabin integration
    const h = dt / SUBSTEPS;
    const Tamb = 250; // EST: ambient inflow temperature for reverse flow (only matters with P_amb > P_cab)
    let outTotal = 0;
    this.safetyOpen = false;
    this.negOpen = false;
    for (let s = 0; s < SUBSTEPS; s++) {
      const pc = (this.mass * R_AIR * Tk) / this.V;
      const aValve = this.valve.position * this.maxArea;
      let out = 0;
      let inn = inflow;
      if (pc >= pa) {
        out += orificeFlow(aValve + leakA, pc, pa, Tk);
        const over = pc - pa - this.relief;
        if (over > 0) {
          this.safetyOpen = true;
          out += orificeFlow(this.safetyArea * clamp01(over / (0.1 * PSI_TO_PA)), pc, pa, Tk);
        }
      } else {
        inn += orificeFlow(aValve + leakA, pa, pc, Tamb);
        const under = pa - pc - this.negRelief;
        if (under > 0) {
          this.negOpen = true;
          inn += orificeFlow(this.safetyArea * 0.3 * clamp01(under / (0.1 * PSI_TO_PA)), pa, pc, Tamb);
        }
      }
      this.mass += (inn - out) * h;
      if (this.mass < 1e-3) this.mass = 1e-3;
      outTotal += out;
    }
    this.outflowKgs = outTotal / SUBSTEPS;

    // ---- outputs
    const pc = (this.mass * R_AIR * Tk) / this.V;
    const cabinAlt = altitudeFtAtPressure(pc);
    if (!Number.isNaN(this.prevCabinAlt)) {
      const r = ((cabinAlt - this.prevCabinAlt) / dt) * 60;
      this.rateFpm += (r - this.rateFpm) * (1 - Math.exp(-dt / 2));
    }
    this.prevCabinAlt = cabinAlt;
    if (this.masksResetEdge.rising(this.masksReset())) this.masks = false;
    if (cabinAlt >= (cfg.masksDeployFt ?? 14000) || this.masksManual()) this.masks = true;
    const diffPsi = (pc - pa) * PA_TO_PSI;

    const o = this.o;
    vars.set(o.cabin_alt_ft, cabinAlt);
    vars.set(o.cabin_rate_fpm, this.rateFpm);
    vars.set(o.diff_psi, diffPsi);
    vars.set(o.cabin_psi, pc * PA_TO_PSI);
    vars.set(o.outflow_pos, this.valve.position);
    vars.set(o.target_alt_ft, this.cmdAlt);
    vars.set(o.sched_alt_ft, target);
    vars.set(o.ldg_elev_ft, ldg);
    vars.set(o.cabin_alt_warn, this.warn.update(cabinAlt) ? 1 : 0);
    vars.set(o.pax_masks, this.masks ? 1 : 0);
    vars.set(o.safety_valve, this.safetyOpen ? 1 : 0);
    vars.set(o.neg_relief, this.negOpen ? 1 : 0);
    vars.set(o.excess_diff, diffPsi > cfg.maxDiffPsi + 0.25 ? 1 : 0);
    vars.set(o.mode, mode);
    vars.set(o.auto_fail, autoFail ? 1 : 0);
    vars.set(o.altn_fail, altnFail ? 1 : 0);
    vars.set(o.phase, this.phase);
    vars.set(o.inflow_kgs, inflow);
    vars.set(o.outflow_kgs, this.outflowKgs);
  }

  /**
   * Puts the cabin in equilibrium for a state preset: on the ground (cabin =
   * field) or in flight at the scheduled cabin altitude for the current
   * altitude (cruise) — call after the FDM has been repositioned.
   */
  settle(): void {
    const H = this.altFt();
    const onGround = this.onGround();
    const Tk = this.cabinT() + 273.15;
    let cabinAlt: number;
    if (onGround) {
      cabinAlt = H;
      this.phase = Phase.Ground;
      this.fieldElev = H;
      this.valve.reset(1);
    } else {
      cabinAlt = Math.max(interp1(this.cfg.schedule, H), cabinAltitudeForDiff(H, this.cfg.maxDiffPsi));
      this.phase = Phase.Climb;
      this.refAlt = H - 1;
      this.refCabin = cabinAlt;
      this.peakAlt = H;
      this.valve.reset(0.3);
    }
    const pc = pressureAtAltitudeFt(cabinAlt);
    this.mass = (pc * this.V) / (R_AIR * Tk);
    this.cmdAlt = cabinAlt;
    this.prevCmdP = pc;
    this.prevCabinAlt = NaN;
    this.rateFpm = 0;
  }

  /** Re-reads the cabin altitude from vars (after a state load). */
  reset(): void {
    if (this.vars.has(this.o.cabin_alt_ft)) {
      const pc = pressureAtAltitudeFt(this.vars.get(this.o.cabin_alt_ft));
      this.mass = (pc * this.V) / (R_AIR * (this.cabinT() + 273.15));
      this.cmdAlt = this.vars.get(this.o.cabin_alt_ft);
      this.prevCmdP = pc;
    }
    this.masks = this.vars.get(this.o.pax_masks) !== 0;
    this.prevCabinAlt = NaN;
  }

  /** Re-stows the passenger masks (maintenance action). */
  stowMasks(): void {
    this.masks = false;
    this.vars.set(this.o.pax_masks, 0);
  }

  failures(): FailureDef[] {
    const c = 'pressurization';
    return [
      { id: 'press.auto', name: 'Pressurization AUTO controller fault', category: c, description: 'AUTO FAIL; transfers to ALTN where fitted.' },
      { id: 'press.altn', name: 'Pressurization ALTN controller fault', category: c, description: 'Standby controller inoperative.' },
      { id: 'press.outflow', name: 'Outflow valve jammed', category: c, description: 'Outflow valve frozen in position.' },
      { id: 'press.leak', name: 'Door seal leak', category: c, description: 'Cabin leakage ×10: outflow valve closes to compensate, cabin may climb.' },
      { id: 'press.decompression', name: 'Rapid decompression', category: c, description: 'Structural breach: cabin climbs to aircraft altitude in seconds.' },
    ];
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampAbs(v: number, lim: number): number {
  return v > lim ? lim : v < -lim ? -lim : v;
}
