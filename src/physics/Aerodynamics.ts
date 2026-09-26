/**
 * Aerodynamic coefficient build-up from an `AeroConfig` (physics/types.ts).
 *
 * Inputs are air-relative (wind and turbulence already removed) and the
 * normalized pilot-sign surface commands from `surf.*`. Output is the body
 * force (N) and moment about the CG (N·m), plus stall/buffet cues.
 *
 * Model summary (all angles deg unless noted):
 *   alpha_t  = effective stall AoA = (alphaStall(flaps) + slat extension) * (1 - 0.25 ice)
 *   alpha'   = AoA remapped so the table's stall break lands on alpha_t
 *   CL_wing  = CL(alpha', flaps) * CL_mach(M) * GE_lift(h/b) * iceFactor(alpha') + CL_slats*slats*ramp
 *   CL       = CL_wing + CL_de*de + CL_q*qhat + CL_alphadot*adhat + CL_spoiler*sym + CL_groundSpoiler*gs
 *   CD       = CD0(flaps)(1 + 0.8 ice) + k(flaps) CL_wing^2 GE_drag(h/b) + CD_mach(M) + CD_gear*gear
 *              + CD_spoiler*(spL+spR)/2 + CD_speedbrake*sb + CD_groundSpoiler*gs + CD_beta*beta^2 + CD_alpha(alpha)
 *   CY       = CY_beta*beta + CY_dr*dr
 *   Cl       = Cl_beta*beta + Cl_p(stall-degraded)*phat + Cl_r*rhat + Cl_da*da + Cl_dr*dr + Cl_spoiler*(spR-spL) + Cl_trim*daTrim
 *   Cm       = Cm0 + Cm_alpha(alpha') + Cm_q*qhat + Cm_alphadot*adhat + Cm_de*de + Cm_trim*trim
 *              + Cm_flap(flaps) + Cm_gear*gear + Cm_spoiler*sym + Cm_mach(M)
 *   Cn       = Cn_beta*beta + Cn_p*phat + Cn_r*rhat + Cn_da*da + Cn_dr*dr + Cn_trim*drTrim
 * Control terms for elevator and rudder act on qbar + propwashElevatorGain * dq_propwash.
 * Rates are nondimensionalised: phat = p b/2V, qhat = q c/2V, rhat = r b/2V, adhat = alphadot c/2V.
 *
 * Ice penalties (EST, consistent with NASA icing-research summaries that
 * report 20-30%+ CLmax loss, several degrees earlier stall and large drag
 * rises for ice-contaminated wings): CLmax -30%, stall AoA -25%, CD0 +80%
 * at full `ice.airframe`.
 */
import { RAD2DEG, clamp, clamp01, interp1, interp2, smoothstep } from '../core/math';
import { Vec3 } from '../core/linalg';
import type { AeroConfig } from './types';

/** Air-relative state and control inputs for one evaluation (reuse one instance). */
export interface AeroInputs {
  /** Angle of attack (rad). */
  alpha: number;
  /** Sideslip (rad, + = wind from the right). */
  beta: number;
  /** d(alpha)/dt (rad/s). */
  alphaDot: number;
  /** Air-relative body rates (rad/s): body rates minus rotational turbulence. */
  p: number;
  q: number;
  r: number;
  /** True airspeed (m/s). */
  tas: number;
  /** Dynamic pressure (Pa). */
  qbar: number;
  mach: number;
  /** Height of the aerodynamic reference point above ground (m) for ground effect. */
  heightAgl: number;
  elevator: number;
  aileron: number;
  rudder: number;
  pitchTrim: number;
  aileronTrim: number;
  rudderTrim: number;
  flapsDeg: number;
  slats: number;
  spoilerLeft: number;
  spoilerRight: number;
  speedbrake: number;
  groundSpoilers: number;
  /** Mean landing-gear extension 0..1 (1 for fixed gear). */
  gearExtension: number;
  /** Airframe ice 0..1 (`ice.airframe`). */
  ice: number;
  /** Propeller slipstream dynamic-pressure increment over the tail (Pa). */
  propwashDq: number;
}

export function createAeroInputs(): AeroInputs {
  return {
    alpha: 0,
    beta: 0,
    alphaDot: 0,
    p: 0,
    q: 0,
    r: 0,
    tas: 0,
    qbar: 0,
    mach: 0,
    heightAgl: 1e4,
    elevator: 0,
    aileron: 0,
    rudder: 0,
    pitchTrim: 0,
    aileronTrim: 0,
    rudderTrim: 0,
    flapsDeg: 0,
    slats: 0,
    spoilerLeft: 0,
    spoilerRight: 0,
    speedbrake: 0,
    groundSpoilers: 0,
    gearExtension: 1,
    ice: 0,
    propwashDq: 0,
  };
}

/** Maximum fractional CLmax loss at full airframe ice. EST (see file header). */
export const ICE_CLMAX_LOSS = 0.3;
/** Maximum fractional stall-AoA reduction at full airframe ice. EST. */
export const ICE_ALPHA_STALL_LOSS = 0.25;
/** Maximum fractional parasite-drag increase at full airframe ice. EST. */
export const ICE_CD0_RISE = 0.8;
/** Fractional lift-slope loss at full ice in the linear range. EST. */
const ICE_SLOPE_LOSS = 0.03;

export class Aerodynamics {
  readonly cfg: AeroConfig;
  /** Body-axis force (N). */
  readonly force = new Vec3();
  /** Body-axis moment about the CG (N·m). */
  readonly moment = new Vec3();

  // Coefficient outputs (last evaluation)
  CL = 0;
  CD = 0;
  CY = 0;
  Cl = 0;
  Cm = 0;
  Cn = 0;
  /** Effective stall AoA (deg) for the current configuration. */
  alphaStallEff = 15;
  /** alpha / alphaStallEff (can exceed 1 or be negative). */
  aoaNorm = 0;
  /** Stall proximity 0..1: 0 at alpha <= 0.5*alpha_stall, 1 at alpha_stall. */
  stallWarning = 0;
  /** Buffet intensity 0..1 (stall, Mach, speedbrake, gear). */
  buffet = 0;
  /** Depth into the stall 0..1 (0 below alpha_stall, 1 at alpha_stall + 5 deg). */
  stallDepth = 0;

  /** Estimated clean lift-curve slope (per deg) near zero alpha. */
  readonly liftSlopePerDeg: number;
  /**
   * Set false for fixed landing gear (no gear-extension buffet). The FDM sets
   * this from the gear configuration.
   */
  retractableGear = true;
  private remapRamp = 0;
  private remapFade = 0;
  private readonly tmp = new Vec3();
  private readonly arm = new Vec3();

  constructor(cfg: AeroConfig) {
    this.cfg = cfg;
    const cl0 = interp2(cfg.CL, 0, 0);
    const cl4 = interp2(cfg.CL, 4, 0);
    this.liftSlopePerDeg = Math.max(0.02, (cl4 - cl0) / 4);
  }

  /** Effective stall AoA (deg) for flaps/slats/ice. */
  effectiveStallAlpha(flapsDeg: number, slats: number, ice: number): number {
    const as = interp1(this.cfg.alphaStall_deg, flapsDeg);
    const slatExt = this.cfg.CL_slats ? (clamp01(slats) * this.cfg.CL_slats) / this.liftSlopePerDeg : 0;
    return (as + slatExt) * (1 - ICE_ALPHA_STALL_LOSS * clamp01(ice));
  }

  /**
   * Basic wing lift coefficient (no ground effect, no control/rate terms):
   * table lookup with the stall remap, Mach factor, slat increment and ice.
   */
  wingLift(alphaDeg: number, flapsDeg: number, slats: number, ice: number, mach: number): number {
    const cfg = this.cfg;
    const as = interp1(cfg.alphaStall_deg, flapsDeg);
    const at = this.effectiveStallAlpha(flapsDeg, slats, ice);
    const a = this.remapAlpha(alphaDeg, as, at);
    const ramp = this.remapRamp;
    const fade = this.remapFade;
    const ic = clamp01(ice);
    let cl = interp2(cfg.CL, a, flapsDeg);
    if (cfg.CL_mach) cl *= interp1(cfg.CL_mach, mach);
    if (ic > 0) cl *= 1 - ic * (ICE_SLOPE_LOSS + (ICE_CLMAX_LOSS - ICE_SLOPE_LOSS) * ramp);
    if (cfg.CL_slats && slats > 0) cl += cfg.CL_slats * clamp01(slats) * ramp * (1 - fade);
    return cl;
  }

  /**
   * Remaps a positive AoA so the table's stall break (at `as`, the tabulated
   * stall AoA for the flap setting) lands on the effective stall AoA `at`
   * (slats extend it, ice reduces it). Identity below the knee 0.5*min(as,at);
   * linear stretch between knee and stall; beyond the stall the offset fades
   * out over 30 deg so deep post-stall data is used unmodified. Also sets
   * `remapRamp` (0 at the knee -> 1 at stall) and `remapFade` (post-stall fade).
   */
  private remapAlpha(alphaDeg: number, as: number, at: number): number {
    this.remapRamp = 0;
    this.remapFade = 0;
    if (!(alphaDeg > 0)) return alphaDeg;
    const ak = 0.5 * Math.min(as, at);
    this.remapRamp = smoothstep(ak, at, alphaDeg);
    if (alphaDeg <= ak) return alphaDeg;
    if (alphaDeg <= at) return Math.abs(at - ak) < 1e-9 ? alphaDeg : ak + ((alphaDeg - ak) * (as - ak)) / (at - ak);
    const fade = clamp01((alphaDeg - at) / 30);
    this.remapFade = fade;
    return (as + (alphaDeg - at)) * (1 - fade) + alphaDeg * fade;
  }

  /**
   * Alpha (deg) giving `targetCL` of wing lift in the pre-stall range, by
   * bisection between -10 deg and the effective stall AoA. Returns the stall
   * AoA if the target exceeds CLmax.
   */
  alphaForLift(targetCL: number, flapsDeg: number, slats: number, ice: number, mach: number): number {
    const at = this.effectiveStallAlpha(flapsDeg, slats, ice);
    let lo = -10;
    let hi = at;
    if (this.wingLift(hi, flapsDeg, slats, ice, mach) <= targetCL) return hi;
    if (this.wingLift(lo, flapsDeg, slats, ice, mach) >= targetCL) return lo;
    for (let k = 0; k < 50; k++) {
      const mid = 0.5 * (lo + hi);
      if (this.wingLift(mid, flapsDeg, slats, ice, mach) < targetCL) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /**
   * Evaluates forces and moments.
   * @param inp air-relative inputs
   * @param cg current CG (body m, datum frame)
   */
  compute(inp: AeroInputs, cg: Vec3): void {
    const cfg = this.cfg;
    const S = cfg.wingArea_m2;
    const b = cfg.span_m;
    const c = cfg.mac_m;
    const qbar = inp.qbar;
    const V = Math.max(1, inp.tas);
    const alphaDeg = inp.alpha * RAD2DEG;
    const beta = inp.beta;
    const flaps = inp.flapsDeg;
    const ice = clamp01(inp.ice);
    const mach = inp.mach;

    // Nondimensional rates
    const phat = (inp.p * b) / (2 * V);
    const qhat = (inp.q * c) / (2 * V);
    const rhat = (inp.r * b) / (2 * V);
    const adhat = (inp.alphaDot * c) / (2 * V);

    // Stall bookkeeping
    const at = this.effectiveStallAlpha(flaps, inp.slats, ice);
    this.alphaStallEff = at;
    this.aoaNorm = at > 0 ? alphaDeg / at : 0;
    this.stallWarning = clamp01((alphaDeg - 0.5 * at) / (0.5 * at));
    this.stallDepth = smoothstep(at, at + 5, alphaDeg);

    // Ground effect (height of the reference point over span)
    const hb = Math.max(0, inp.heightAgl) / b;
    const geLift = interp1(cfg.groundEffectLift, hb);
    const geDrag = interp1(cfg.groundEffectDrag, hb);

    // ---- Lift
    const clWing = this.wingLift(alphaDeg, flaps, inp.slats, ice, mach) * geLift;
    const sym = clamp01(inp.speedbrake + 0.5 * (inp.spoilerLeft + inp.spoilerRight));
    const gs = clamp01(inp.groundSpoilers);
    // Control surfaces in the propeller slipstream see qbar + gain * dq.
    const pw = cfg.propwashElevatorGain ?? 0;
    const qTail = qbar + pw * Math.max(0, inp.propwashDq);
    const tailRatio = qbar > 1e-3 ? qTail / qbar : 0;
    let CL =
      clWing +
      cfg.CL_q * qhat +
      cfg.CL_alphadot * adhat +
      cfg.CL_spoiler * sym +
      cfg.CL_groundSpoiler * gs;
    const clElev = cfg.CL_de * inp.elevator;

    // ---- Drag
    let CD =
      interp1(cfg.CD0, flaps) * (1 + ICE_CD0_RISE * ice) +
      interp1(cfg.CDi_k, flaps) * clWing * clWing * geDrag +
      interp1(cfg.CD_mach, mach) +
      cfg.CD_gear * clamp01(inp.gearExtension) +
      cfg.CD_spoiler * 0.5 * (inp.spoilerLeft + inp.spoilerRight) +
      cfg.CD_speedbrake * clamp01(inp.speedbrake) +
      cfg.CD_groundSpoiler * gs +
      cfg.CD_beta * beta * beta;
    const absA = Math.abs(alphaDeg);
    if (cfg.CD_alpha) {
      CD += interp1(cfg.CD_alpha, alphaDeg);
    } else {
      // Default post-stall flat-plate drag rise (EST: CD ~ 1.2-1.3 sin^2(alpha) for a flat plate).
      const s = Math.sin(inp.alpha);
      CD += 1.25 * s * s * smoothstep(at, at + 10, absA);
    }

    // ---- Side force
    const CYbase = cfg.CY_beta * beta;
    const cyRudder = cfg.CY_dr * inp.rudder;

    // ---- Roll (roll damping degrades and reverses in the stall -> autorotation / wing drop)
    const clpEff = cfg.Cl_p * (1 - 1.4 * this.stallDepth);
    const Cl =
      cfg.Cl_beta * beta +
      clpEff * phat +
      cfg.Cl_r * rhat +
      cfg.Cl_da * inp.aileron +
      cfg.Cl_dr * inp.rudder +
      cfg.Cl_spoiler * (inp.spoilerRight - inp.spoilerLeft) +
      (cfg.Cl_trim ?? 0) * inp.aileronTrim;

    // ---- Pitch (Cm_alpha table uses the same stall remap so the break follows alpha_t)
    const aMap = this.remapAlpha(alphaDeg, interp1(cfg.alphaStall_deg, flaps), at);
    const CmBase =
      cfg.Cm0 +
      interp1(cfg.Cm_alpha, aMap) +
      cfg.Cm_q * qhat +
      cfg.Cm_alphadot * adhat +
      cfg.Cm_trim * inp.pitchTrim +
      interp1(cfg.Cm_flap, flaps) +
      cfg.Cm_gear * clamp01(inp.gearExtension) +
      cfg.Cm_spoiler * sym +
      (cfg.Cm_mach ? interp1(cfg.Cm_mach, mach) : 0);
    const cmElev = cfg.Cm_de * inp.elevator;

    // ---- Yaw
    const CnBase =
      cfg.Cn_beta * beta + cfg.Cn_p * phat + cfg.Cn_r * rhat + cfg.Cn_da * inp.aileron + (cfg.Cn_trim ?? 0) * inp.rudderTrim;
    const cnRudder = cfg.Cn_dr * inp.rudder;

    // Totals (control terms scaled to tail dynamic pressure)
    CL += clElev * tailRatio;
    const CY = CYbase + cyRudder * tailRatio;
    const Cm = CmBase + cmElev * tailRatio;
    const Cn = CnBase + cnRudder * tailRatio;
    this.CL = CL;
    this.CD = CD;
    this.CY = CY;
    this.Cl = Cl;
    this.Cm = Cm;
    this.Cn = Cn;

    // Dimensional forces: lift perpendicular to the relative wind in the
    // symmetry plane, drag opposite the relative wind, side force on body y.
    // Control forces use qTail directly so they survive at zero airspeed.
    const qS = qbar * S;
    const L = (CL - clElev * tailRatio) * qS + clElev * qTail * S;
    const D = CD * qS;
    const Y = CYbase * qS + cyRudder * qTail * S;
    const ca = Math.cos(inp.alpha);
    const sa = Math.sin(inp.alpha);
    const cb = Math.cos(beta);
    const sb = Math.sin(beta);
    const f = this.force;
    f.x = -D * ca * cb + L * sa;
    f.y = -D * sb + Y;
    f.z = -D * sa * cb - L * ca;

    // Moments about the reference point, then transfer to the CG.
    const m = this.moment;
    m.x = Cl * qS * b;
    m.y = CmBase * qS * c + cmElev * qTail * S * c;
    m.z = CnBase * qS * b + cnRudder * qTail * S * b;
    const rp = cfg.refPoint_m;
    this.arm.set(rp[0] - cg.x, rp[1] - cg.y, rp[2] - cg.z);
    this.tmp.crossVectors(this.arm, f);
    m.add(this.tmp);

    // ---- Buffet
    const stallBuffet = smoothstep(0.88 * at, at + 2, alphaDeg);
    let machBuffet = 0;
    if (cfg.buffetMach !== undefined) {
      // Buffet boundary moves to lower Mach at higher CL (EST: -0.15 M per unit CL above 0.5).
      const mb = cfg.buffetMach - 0.15 * Math.max(0, clWing - 0.5);
      machBuffet = smoothstep(mb - 0.01, mb + 0.04, mach);
    }
    const sbBuffet = 0.25 * clamp01(inp.speedbrake + 0.5 * (inp.spoilerLeft + inp.spoilerRight)) * clamp01(qbar / 15000);
    const gearBuffet = this.retractableGear ? 0.12 * clamp01(inp.gearExtension) * clamp01(qbar / 8000) : 0;
    this.buffet = clamp(Math.max(stallBuffet, machBuffet) + sbBuffet + gearBuffet, 0, 1);
  }
}
