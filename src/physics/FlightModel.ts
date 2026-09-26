/**
 * Six-degree-of-freedom flight model.
 *
 * State: geodetic CG position (lat, lon deg; alt m MSL, geometric), local NED
 * velocity (m/s), body->NED attitude quaternion, body angular rate (rad/s).
 * Earth rotation and transport rate are ignored (docs/ARCHITECTURE.md).
 *
 * step(dt) order: environment vars -> mass/CG -> air data, wind, gusts,
 * turbulence -> engines -> aerodynamics -> ground contact -> gravity ->
 * integration -> crash checks -> publish every fdm.* var.
 *
 * Integration is semi-implicit (symplectic) Euler: v += a dt, x += v dt,
 * w += wdot dt, q <- q exp(w dt/2) (renormalised). Near the ground the step
 * is split into `groundSubsteps` substeps in which ground reactions and
 * gravity are re-evaluated while aero and engine forces are held, which keeps
 * stiff struts and stiction anchors stable at 120 Hz. Position is advanced in
 * local NED and converted to lat/lon with the WGS84 meridian and
 * prime-vertical radii.
 *
 * Rotational dynamics include gyroscopic coupling of spinning propellers:
 * I dw/dt = M - w x (I w + H_rotors).
 */
import { DEG2RAD, RAD2DEG, clamp, wrap180, wrap360 } from '../core/math';
import { Mat3, Quat, Vec3 } from '../core/linalg';
import { FT_TO_M, G0, KT_TO_MS, M_TO_FT, MS_TO_FPM, MS_TO_KT, PA_TO_INHG } from '../core/units';
import { WGS84_E2, meridianRadius, primeVerticalRadius } from '../core/geo';
import { decimalYear, magneticDeclination } from '../core/wmm';
import type { SimVars } from '../core/SimVars';
import type { FlightModelHandle } from '../core/SimContext';
import { ENV, FDM, ICE, SURF, GEAR } from '../core/vars';
import type { WorldQuery } from '../world/types';
import type { FdmConfig } from './types';
import {
  Atmosphere,
  DrydenTurbulence,
  WindModel,
  casFromImpactPressure,
  createAirState,
  createTurbulenceSample,
  easFromTas,
  impactPressureFromMach,
  tasFromCas,
  totalTemperature,
  windFromVector,
  type AirState,
  type TurbulenceSample,
} from './atmosphere';
import { Aerodynamics, createAeroInputs, type AeroInputs } from './Aerodynamics';
import { GroundContact } from './GroundContact';
import { MassModel } from './MassModel';
import { createEngineEnv, type EngineEnv, type EngineModel } from './engines/Engine';
import { Turbofan } from './engines/Turbofan';
import { Piston } from './engines/Piston';

export interface FlightModelOptions {
  /** PRNG seed for gusts and turbulence (deterministic runs). Default 1. */
  seed?: number;
  /** Decimal year for the WMM declination. Default: the current date. */
  magneticYear?: number;
  /** TAT probe recovery factor used for fdm.tat_c. Default 1 (true stagnation temperature). */
  tatRecovery?: number;
  /** Substeps per physics step while any contact may touch the ground. Default 4. */
  groundSubsteps?: number;
}

export interface RepositionOptions {
  lat: number;
  lon: number;
  /** Altitude (ft MSL) of the aircraft datum; omit (or onGround) to place it on the ground. */
  altFtMsl?: number;
  onGround?: boolean;
  headingTrue: number;
  /** Indicated airspeed for an in-air reposition (kt). Default 1.4 x clean stall-ish speed. */
  iasKt?: number;
}

export interface TrimResult {
  converged: boolean;
  /** Angle of attack = pitch attitude for level flight (deg). */
  alphaDeg: number;
  /** Normalized pitch trim (surf.pitch_trim) with the elevator at `elevator`. */
  pitchTrim: number;
  elevator: number;
  /** Total thrust along the engines' axes required (N). */
  thrustN: number;
  /** True airspeed (m/s) of the trim point. */
  tas_ms: number;
}

/** Crash thresholds (EST). */
const STRUCTURE_IMPACT_MS = 2.0;
const STRUCTURE_SCRAPE_S = 1.5;
const OVERLOAD_ULTIMATE_FACTOR = 1.5; // 14 CFR 23/25.303 factor of safety
const VD_FACTOR = 1.25;
/** Ground-elevation change per step (m) treated as a terrain-data refinement, not real terrain. EST. */
const TERRAIN_JUMP_M = 0.25;

export class FlightModel implements FlightModelHandle {
  readonly config: FdmConfig;
  readonly vars: SimVars;
  readonly world: WorldQuery;
  readonly atmosphere = new Atmosphere();
  readonly wind: WindModel;
  readonly turbulence: DrydenTurbulence;
  readonly aero: Aerodynamics;
  readonly engines: EngineModel[];
  readonly ground: GroundContact;
  readonly massModel: MassModel;
  readonly engineEnv: EngineEnv = createEngineEnv();
  readonly air: AirState = createAirState();
  readonly aeroInputs: AeroInputs = createAeroInputs();
  readonly turb: TurbulenceSample = createTurbulenceSample();

  // ---- state
  /** CG latitude/longitude (deg) and geometric altitude (m MSL). */
  lat = 0;
  lon = 0;
  alt = 0;
  readonly q = new Quat();
  readonly vNed = new Vec3();
  /** Body angular rate (rad/s). */
  readonly omega = new Vec3();
  crashed = false;
  crashReason = '';
  frozen = false;
  /** Terrain elevation under the CG (m MSL) from the last step. */
  groundElevation = 0;
  /** Steady + gust wind (NED air velocity, m/s). */
  readonly windNed = new Vec3();
  /** Body specific force (m/s^2), averaged over the last step. */
  readonly specificForce = new Vec3(0, 0, -G0);
  tas = 0;
  cas = 0;
  mach = 0;
  qbar = 0;
  alpha = 0;
  beta = 0;
  alphaDot = 0;

  private readonly opts: Required<FlightModelOptions>;
  private readonly substeps: number;
  private readonly retractable: boolean;
  private readonly fixedGearExtension: number;
  private readonly gearPosVars: string[];
  private prevAlpha = 0;
  private magVar = 0;
  private magTimer = 1e9;
  private magLat = 1e9;
  private magLon = 1e9;
  private nzFilt = 1;
  private readonly lastCg = new Vec3();
  private readonly magYear: number;

  // scratch (no allocation in step)
  private readonly R = new Mat3();
  private readonly vAir = new Vec3();
  private readonly fEng = new Vec3();
  private readonly mEng = new Vec3();
  private readonly hRot = new Vec3();
  private readonly fB = new Vec3();
  private readonly mB = new Vec3();
  private readonly aN = new Vec3();
  private readonly wd = new Vec3();
  private readonly t1 = new Vec3();
  private readonly t2 = new Vec3();
  private readonly dPos = new Vec3();
  private readonly zero = new Vec3();
  private readonly sfAcc = new Vec3();
  private readonly windOut = { dir: 0, kt: 0 };

  constructor(config: FdmConfig, vars: SimVars, world: WorldQuery, options: FlightModelOptions = {}) {
    this.config = config;
    this.vars = vars;
    this.world = world;
    this.opts = {
      seed: options.seed ?? 1,
      magneticYear: options.magneticYear ?? decimalYear(new Date()),
      tatRecovery: options.tatRecovery ?? 1,
      groundSubsteps: Math.max(1, Math.floor(options.groundSubsteps ?? 4)),
    };
    this.magYear = this.opts.magneticYear;
    this.substeps = this.opts.groundSubsteps;
    this.wind = new WindModel(this.opts.seed * 7919 + 1);
    this.turbulence = new DrydenTurbulence(this.opts.seed * 104729 + 3);
    this.aero = new Aerodynamics(config.aero);
    this.massModel = new MassModel(config.mass, vars);
    this.ground = new GroundContact(config.gear, vars);
    this.engines = config.engines.map((e, i) =>
      e.kind === 'turbofan' ? new Turbofan(e, i + 1, vars) : new Piston(e, i + 1, vars, config.aero.wingArea_m2, config.aero.span_m),
    );
    this.retractable = config.gear.some((g) => g.retractable && g.gearIndex >= 0 && !g.isStructure);
    this.aero.retractableGear = this.retractable;
    this.fixedGearExtension = 1;
    const idx = [...new Set(config.gear.filter((g) => g.retractable && g.gearIndex >= 0 && !g.isStructure).map((g) => g.gearIndex))];
    this.gearPosVars = idx.map((i) => GEAR.pos(i));
    this.lastCg.copy(this.massModel.cg);
    this.reposition({ lat: 0, lon: 0, onGround: true, headingTrue: 0 });
  }

  // =================================================================== public API

  get mass(): number {
    return this.massModel.mass;
  }

  get cg(): Vec3 {
    return this.massModel.cg;
  }

  /** Heading/pitch/bank (deg). */
  get headingTrueDeg(): number {
    return wrap360(this.q.getPsi() * RAD2DEG);
  }
  get pitchDeg(): number {
    return this.q.getTheta() * RAD2DEG;
  }
  get bankDeg(): number {
    return this.q.getPhi() * RAD2DEG;
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
    this.vars.set(FDM.frozen, frozen ? 1 : 0);
  }

  setStationMass(index: number, kg: number): void {
    this.massModel.setStationMass(index, kg);
  }

  /** Instantly stabilizes all engines running at the commanded power (or shuts them down). */
  setEnginesRunning(running: boolean): void {
    this.updateAirData(0);
    for (const e of this.engines) e.setRunning(running, this.engineEnv);
  }

  /** Moves the aircraft (e.g. slew mode) by local offsets (m) and a heading change (deg). */
  slew(dNorth_m: number, dEast_m: number, dUp_m: number, dHeadingDeg = 0): void {
    this.movePosition(dNorth_m, dEast_m, -dUp_m);
    if (dHeadingDeg !== 0) {
      const psi = this.q.getPsi() + dHeadingDeg * DEG2RAD;
      this.q.setFromEuler(psi, this.q.getTheta(), this.q.getPhi());
      const s = Math.hypot(this.vNed.x, this.vNed.y);
      const trk = Math.atan2(this.vNed.y, this.vNed.x) + dHeadingDeg * DEG2RAD;
      this.vNed.x = s * Math.cos(trk);
      this.vNed.y = s * Math.sin(trk);
    }
    this.ground.reset();
    this.publish();
  }

  /** Datum (reference point) geodetic position — what `fdm.lat_deg/lon_deg/alt_msl_ft` report. */
  getDatumPosition(out: { lat: number; lon: number; alt: number }): { lat: number; lon: number; alt: number } {
    const cg = this.massModel.cg;
    this.t1.set(-cg.x, -cg.y, -cg.z);
    this.q.rotate(this.t1, this.t2);
    const mr = meridianRadius(this.lat) + this.alt;
    const nr = (primeVerticalRadius(this.lat) + this.alt) * Math.max(1e-9, Math.cos(this.lat * DEG2RAD));
    out.lat = this.lat + (this.t2.x / mr) * RAD2DEG;
    out.lon = wrap180(this.lon + (this.t2.y / nr) * RAD2DEG);
    out.alt = this.alt - this.t2.z;
    return out;
  }

  reposition(opts: RepositionOptions): void {
    this.crashed = false;
    this.crashReason = '';
    this.ground.reset();
    this.lat = opts.lat;
    this.lon = wrap180(opts.lon);
    this.omega.zero();
    this.vNed.zero();
    this.alphaDot = 0;
    this.turbulence.reset();
    this.wind.reset();
    const tb = this.turb;
    tb.u = tb.v = tb.w = tb.p = tb.q = tb.r = 0;
    this.massModel.update();
    this.lastCg.copy(this.massModel.cg);
    const psi = opts.headingTrue * DEG2RAD;
    this.q.setFromEuler(psi, 0, 0);
    this.readEnvironment();
    const onGround = opts.onGround ?? opts.altFtMsl === undefined;
    const g = this.world.sampleGround(this.lat, this.lon);
    this.groundElevation = Number.isFinite(g.elevation_m) ? g.elevation_m : 0;
    if (onGround) {
      this.settleOnGround(psi);
    } else {
      // Datum altitude -> CG altitude for a level attitude (body z is down, so a CG below the datum is lower).
      this.alt = (opts.altFtMsl ?? 0) * FT_TO_M - this.massModel.cg.z;
      if (this.alt < this.groundElevation + 5) this.alt = this.groundElevation + 5;
      this.atmosphere.sample(this.alt, this.air);
      const flaps = this.vars.get(SURF.flapsDeg);
      const ias = opts.iasKt ?? this.defaultIas(flaps);
      const tas = tasFromCas(ias * KT_TO_MS, this.air.pressure_Pa, this.air.temperature_K);
      const trim = this.computeTrim({ tas_ms: tas });
      let alphaDeg = trim.alphaDeg;
      if (!trim.converged) {
        const qbar = 0.5 * this.air.density_kgm3 * tas * tas;
        const cl = (this.massModel.mass * G0) / Math.max(1, qbar * this.config.aero.wingArea_m2);
        alphaDeg = this.aero.alphaForLift(cl, flaps, this.vars.get(SURF.slats), this.vars.get(ICE.airframe), tas / this.air.speedOfSound_ms);
      }
      this.q.setFromEuler(psi, alphaDeg * DEG2RAD, 0);
      const agl = this.alt - this.groundElevation;
      this.wind.steadyWind(this.alt, agl, this.lat, this.windNed);
      this.vNed.set(tas * Math.cos(psi) + this.windNed.x, tas * Math.sin(psi) + this.windNed.y, 0);
      this.prevAlpha = alphaDeg * DEG2RAD;
    }
    this.nzFilt = 1;
    this.magTimer = 1e9;
    this.updateAirData(0);
    this.publish();
  }

  /**
   * Level-flight trim at the current altitude, attitude-free: solves angle of
   * attack, pitch trim (elevator held at `elevator`, default 0) and total
   * thrust so that body X/Z forces and pitching moment vanish, using the
   * current mass, CG, flap/gear/spoiler vars. Newton iteration with a
   * numerical Jacobian. Does not change the aircraft state.
   */
  computeTrim(opts: { iasKt?: number; tas_ms?: number; elevator?: number } = {}): TrimResult {
    this.massModel.update();
    const air = this.atmosphere.sample(this.alt, createAirState());
    let tas = opts.tas_ms ?? 0;
    if (!(tas > 0)) tas = opts.iasKt !== undefined ? tasFromCas(opts.iasKt * KT_TO_MS, air.pressure_Pa, air.temperature_K) : Math.max(30, this.tas);
    const elev = opts.elevator ?? 0;
    const m = this.massModel.mass;
    const W = m * G0;
    const S = this.config.aero.wingArea_m2;
    const c = this.config.aero.mac_m;
    const qbar = 0.5 * air.density_kgm3 * tas * tas;
    const mach = tas / air.speedOfSound_ms;
    const inp = createAeroInputs();
    this.fillSurfaceInputs(inp);
    inp.tas = tas;
    inp.qbar = qbar;
    inp.mach = mach;
    inp.heightAgl = Math.max(0, this.alt - this.groundElevation);
    inp.elevator = elev;
    const cg = this.massModel.cg;
    const res = [0, 0, 0];
    const f = (a: number, t: number, T: number, out: number[]): void => {
      inp.alpha = a;
      inp.pitchTrim = t;
      this.aero.compute(inp, cg);
      let fx = this.aero.force.x - W * Math.sin(a);
      let fz = this.aero.force.z + W * Math.cos(a);
      let my = this.aero.moment.y;
      const n = this.engines.length || 1;
      for (const e of this.engines) {
        const ax = e.axis;
        const Te = T / n;
        fx += Te * ax.x;
        fz += Te * ax.z;
        const rx = e.position.x - cg.x;
        const rz = e.position.z - cg.z;
        my += rz * (Te * ax.x) - rx * (Te * ax.z);
      }
      out[0] = fx / W;
      out[1] = fz / W;
      out[2] = my / (W * c);
    };
    const flaps = inp.flapsDeg;
    let a = this.aero.alphaForLift(W / Math.max(1, qbar * S), flaps, inp.slats, inp.ice, mach) * DEG2RAD;
    let t = 0;
    let T = Math.max(0, 0.08 * W);
    const J = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const r1 = [0, 0, 0];
    let converged = false;
    for (let it = 0; it < 40; it++) {
      f(a, t, T, res);
      const err = Math.abs(res[0]) + Math.abs(res[1]) + Math.abs(res[2]);
      if (err < 1e-9) {
        converged = true;
        break;
      }
      const ha = 1e-5;
      const ht = 1e-5;
      const hT = Math.max(1, 1e-5 * W);
      f(a + ha, t, T, r1);
      for (let k = 0; k < 3; k++) J[k * 3] = (r1[k] - res[k]) / ha;
      f(a, t + ht, T, r1);
      for (let k = 0; k < 3; k++) J[k * 3 + 1] = (r1[k] - res[k]) / ht;
      f(a, t, T + hT, r1);
      for (let k = 0; k < 3; k++) J[k * 3 + 2] = (r1[k] - res[k]) / hT;
      const M = new Mat3().set(J[0], J[1], J[2], J[3], J[4], J[5], J[6], J[7], J[8]);
      const Mi = new Mat3();
      if (!Mi.invertFrom(M)) break;
      const d = Mi.mulVec(new Vec3(res[0], res[1], res[2]), new Vec3());
      a -= clamp(d.x, -2 * DEG2RAD, 2 * DEG2RAD);
      t -= clamp(d.y, -0.5, 0.5);
      T -= clamp(d.z, -0.3 * W, 0.3 * W);
      if (T < 0) T = 0;
    }
    f(a, t, T, res);
    converged = converged || Math.abs(res[0]) + Math.abs(res[1]) + Math.abs(res[2]) < 1e-6;
    return { converged: converged && Math.abs(t) <= 1.5, alphaDeg: a * RAD2DEG, pitchTrim: t, elevator: elev, thrustN: T, tas_ms: tas };
  }

  // =================================================================== step

  step(dt: number): void {
    if (!(dt > 0)) return;
    this.readEnvironment();
    // Mass & CG. Keep the datum fixed in space when the CG shifts (fuel burn, payload).
    if (this.massModel.update()) {
      const cg = this.massModel.cg;
      this.t1.subVectors(cg, this.lastCg);
      if (this.t1.lengthSq() > 0) {
        this.q.rotate(this.t1, this.t2);
        this.movePosition(this.t2.x, this.t2.y, this.t2.z);
      }
      this.lastCg.copy(cg);
    }

    const g = this.world.sampleGround(this.lat, this.lon);
    const newElev = Number.isFinite(g.elevation_m) ? g.elevation_m : this.groundElevation;
    // Terrain refinement (low-res estimate replaced by a loaded tile) can step the
    // ground under a parked/taxiing aircraft; carry the aircraft with the terrain
    // instead of launching it or burying it. A real slope never changes this fast.
    const jump = newElev - this.groundElevation;
    if (this.ground.onGround && Math.abs(jump) > TERRAIN_JUMP_M) this.alt += jump;
    this.groundElevation = newElev;
    this.updateAirData(dt);

    // Engines (always run, even frozen or crashed, so gauges stay live).
    const env = this.engineEnv;
    for (let i = 0; i < this.engines.length; i++) this.engines[i].step(dt, env);

    // Aerodynamics
    const inp = this.aeroInputs;
    this.fillSurfaceInputs(inp);
    inp.alpha = this.alpha;
    inp.beta = this.beta;
    inp.alphaDot = this.alphaDot;
    inp.p = this.omega.x - this.turb.p;
    inp.q = this.omega.y - this.turb.q;
    inp.r = this.omega.z - this.turb.r;
    inp.tas = this.tas;
    inp.qbar = this.qbar;
    inp.mach = this.mach;
    const rp = this.config.aero.refPoint_m;
    this.t1.set(rp[0] - this.cg.x, rp[1] - this.cg.y, rp[2] - this.cg.z);
    this.q.rotate(this.t1, this.t2);
    inp.heightAgl = Math.max(0, this.alt - this.t2.z - this.groundElevation);
    let pw = 0;
    for (let i = 0; i < this.engines.length; i++) pw += this.engines[i].propwashDq_Pa;
    inp.propwashDq = pw;
    this.aero.compute(inp, this.cg);

    if (this.frozen || this.crashed) {
      this.vars.set(FDM.frozen, this.frozen ? 1 : 0);
      this.publish();
      return;
    }

    // Engine forces/moments about the CG and rotor angular momentum.
    const fE = this.fEng.zero();
    const mE = this.mEng.zero();
    const hR = this.hRot.zero();
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i];
      this.t1.copy(e.axis).scale(e.thrust_N);
      fE.add(this.t1);
      this.t2.subVectors(e.position, this.cg);
      this.t2.crossVectors(this.t2, this.t1);
      mE.add(this.t2).add(e.extraMoment);
      hR.add(e.angularMomentum);
    }

    this.integrate(dt);
    this.checkCrash();
    this.ground.publish();
    this.publish();
  }

  // =================================================================== internals

  private readEnvironment(): void {
    const v = this.vars;
    this.atmosphere.setConditions(v.get(ENV.qnhInHg, 29.92126), v.get(ENV.oatSeaLevelC, 15));
    this.wind.setSurfaceWind(v.get(ENV.surfaceWindDir, 0), v.get(ENV.surfaceWindKt, 0), v.get(ENV.surfaceGustKt, 0));
    this.ground.wetness = v.get(ENV.precip, 0);
  }

  private defaultIas(flaps: number): number {
    // 1.4 x 1-g stall speed at sea level for the current configuration.
    const alphaS = this.aero.effectiveStallAlpha(flaps, 0, 0);
    const clmax = this.aero.wingLift(alphaS, flaps, 0, 0, 0);
    const vs = Math.sqrt((2 * this.massModel.mass * G0) / (1.225 * this.config.aero.wingArea_m2 * Math.max(0.3, clmax)));
    return 1.4 * vs * MS_TO_KT;
  }

  private fillSurfaceInputs(inp: AeroInputs): void {
    const v = this.vars;
    inp.elevator = clamp(v.get(SURF.elevator), -1, 1);
    inp.aileron = clamp(v.get(SURF.aileron), -1, 1);
    inp.rudder = clamp(v.get(SURF.rudder), -1, 1);
    inp.pitchTrim = clamp(v.get(SURF.pitchTrim), -1, 1);
    inp.aileronTrim = clamp(v.get(SURF.aileronTrim), -1, 1);
    inp.rudderTrim = clamp(v.get(SURF.rudderTrim), -1, 1);
    inp.flapsDeg = v.get(SURF.flapsDeg);
    inp.slats = clamp(v.get(SURF.slats), 0, 1);
    inp.spoilerLeft = clamp(v.get(SURF.spoilerLeft), 0, 1);
    inp.spoilerRight = clamp(v.get(SURF.spoilerRight), 0, 1);
    inp.speedbrake = clamp(v.get(SURF.speedbrake), 0, 1);
    inp.groundSpoilers = clamp(v.get(SURF.groundSpoilers), 0, 1);
    inp.ice = clamp(v.get(ICE.airframe), 0, 1);
    if (this.retractable) {
      let sum = 0;
      for (let i = 0; i < this.gearPosVars.length; i++) sum += clamp(v.get(this.gearPosVars[i], 1), 0, 1);
      inp.gearExtension = this.gearPosVars.length > 0 ? sum / this.gearPosVars.length : 1;
    } else {
      inp.gearExtension = this.fixedGearExtension;
    }
  }

  /** Air data, wind, gusts and turbulence at the CG; fills engineEnv. dt = 0 -> no stochastic update. */
  private updateAirData(dt: number): void {
    const air = this.atmosphere.sample(this.alt, this.air);
    const agl = this.alt - this.groundElevation;
    this.wind.steadyWind(this.alt, agl, this.lat, this.windNed);
    const live = dt > 0 && !this.frozen && !this.crashed;
    if (live) this.wind.applyGust(dt, agl, this.windNed);
    // Air-relative velocity in body axes.
    this.vAir.subVectors(this.vNed, this.windNed);
    this.q.rotateInverse(this.vAir, this.vAir);
    const tasApprox = this.vAir.length();
    if (live) {
      this.turbulence.step(dt, tasApprox, agl, this.vars.get(ENV.turbulence, 0), this.config.aero.span_m, this.turb);
    } else if (dt > 0) {
      this.turb.u = this.turb.v = this.turb.w = this.turb.p = this.turb.q = this.turb.r = 0;
    }
    this.vAir.x -= this.turb.u;
    this.vAir.y -= this.turb.v;
    this.vAir.z -= this.turb.w;
    const tas = this.vAir.length();
    this.tas = tas;
    if (tas > 0.5) {
      this.alpha = Math.atan2(this.vAir.z, this.vAir.x);
      this.beta = Math.asin(clamp(this.vAir.y / tas, -1, 1));
    } else {
      this.alpha = 0;
      this.beta = 0;
    }
    if (dt > 0) {
      // Alpha rate: finite difference, 40 ms low-pass, zero at very low speed.
      const raw = tas > 10 ? wrapAngle(this.alpha - this.prevAlpha) / dt : 0;
      const k = 1 - Math.exp(-dt / 0.04);
      this.alphaDot += (clamp(raw, -3, 3) - this.alphaDot) * k;
    }
    this.prevAlpha = this.alpha;
    this.mach = tas / air.speedOfSound_ms;
    this.qbar = 0.5 * air.density_kgm3 * tas * tas;
    this.cas = casFromImpactPressure(impactPressureFromMach(this.mach, air.pressure_Pa));

    const env = this.engineEnv;
    env.pressure_Pa = air.pressure_Pa;
    env.temperature_K = air.temperature_K;
    env.density_kgm3 = air.density_kgm3;
    env.speedOfSound_ms = air.speedOfSound_ms;
    env.pressureAltitude_ft = air.pressureAltitude_m * M_TO_FT;
    env.isaDeviation_K = air.isaDeviation_K;
    env.mach = this.mach;
    env.tas_ms = tas;
    env.axialSpeed_ms = Math.max(0, this.vAir.x);
    env.qbar_Pa = this.qbar;
    env.alpha_rad = this.alpha;
    env.beta_rad = this.beta;
    env.onGround = this.ground.onGround;
  }

  /** Semi-implicit Euler with ground substeps. */
  private integrate(dt: number): void {
    const cg = this.massModel.cg;
    const m = this.massModel.mass;
    const I = this.massModel.inertia;
    const Iinv = this.massModel.inertiaInv;
    const agl = this.alt - this.groundElevation;
    const near = agl < this.ground.maxReach + 10;
    if (near) this.ground.sampleTerrain(this.world, this.lat, this.lon, this.alt, this.q, cg);
    else this.ground.clearTerrain();
    const n = near ? this.substeps : 1;
    const h = dt / n;
    const gLocal = normalGravity(this.lat, this.alt);
    this.dPos.zero();
    this.sfAcc.zero();
    for (let k = 0; k < n; k++) {
      this.ground.compute(this.dPos, this.q, this.vNed, this.omega, cg, h);
      // Body force (non-gravitational) and moment about the CG.
      this.fB.copy(this.aero.force).add(this.fEng).add(this.ground.forceBody);
      this.mB.copy(this.aero.moment).add(this.mEng).add(this.ground.momentBody);
      this.sfAcc.addScaled(this.fB, 1 / (m * n));
      // Translational: NED acceleration.
      this.q.rotate(this.fB, this.aN);
      this.aN.scale(1 / m);
      this.aN.z += gLocal;
      // Rotational: I wdot = M - w x (I w + H).
      I.mulVec(this.omega, this.t1).add(this.hRot);
      this.t2.crossVectors(this.omega, this.t1);
      this.t1.subVectors(this.mB, this.t2);
      Iinv.mulVec(this.t1, this.wd);
      // Symplectic update.
      this.vNed.addScaled(this.aN, h);
      this.omega.addScaled(this.wd, h);
      this.dPos.addScaled(this.vNed, h);
      this.q.integrateBodyRate(this.omega, h);
    }
    this.specificForce.copy(this.sfAcc);
    this.movePosition(this.dPos.x, this.dPos.y, this.dPos.z);
  }

  /** Moves the CG by a local NED displacement (m) using the WGS84 radii. */
  private movePosition(dn: number, de: number, dd: number): void {
    const mr = meridianRadius(this.lat) + this.alt;
    const nr = (primeVerticalRadius(this.lat) + this.alt) * Math.max(1e-9, Math.cos(this.lat * DEG2RAD));
    this.lat += (dn / mr) * RAD2DEG;
    this.lon += (de / nr) * RAD2DEG;
    this.alt -= dd;
    if (this.lat > 90) {
      this.lat = 180 - this.lat;
      this.lon += 180;
    } else if (this.lat < -90) {
      this.lat = -180 - this.lat;
      this.lon += 180;
    }
    this.lon = wrap180(this.lon);
  }

  /** Static 3-DOF (alt, pitch, roll) equilibrium on the gear at the current lat/lon. */
  private settleOnGround(psi: number): void {
    const cg = this.massModel.cg;
    const W = this.massModel.mass * G0;
    const elev = this.groundElevation;
    // Start with the CG well above any contact and sample the terrain planes.
    const alt0 = elev + this.ground.maxReach + 1;
    this.alt = alt0;
    this.q.setFromEuler(psi, 0, 0);
    this.ground.sampleTerrain(this.world, this.lat, this.lon, alt0, this.q, cg);
    // Initial guess: lowest active contact just touching (flat approximation).
    let alt = elev + 0.5;
    for (let i = 0; i < this.ground.contacts.length; i++) {
      const c = this.ground.contacts[i];
      if (c.cfg.isStructure || !this.ground.isActive(i)) continue;
      this.t1.subVectors(c.bodyPos, cg);
      const groundZ = alt0 - c.planePoint.z; // terrain elevation under the contact
      alt = Math.max(alt, groundZ + this.t1.z);
    }
    let th = 0;
    let ph = 0;
    const r0 = [0, 0, 0];
    const r1 = [0, 0, 0];
    const J = new Mat3();
    const Ji = new Mat3();
    const d = new Vec3();
    const resid = (a: number, t: number, p: number, out: number[]): void => {
      this.q.setFromEuler(psi, t, p);
      this.dPos.set(0, 0, -(a - alt0));
      this.ground.compute(this.dPos, this.q, this.zero, this.zero, cg, 0);
      this.q.rotate(this.ground.forceBody, this.t1);
      out[0] = (this.t1.z + W) / W; // vertical force balance (NED down)
      out[1] = this.ground.momentBody.y / W;
      out[2] = this.ground.momentBody.x / W;
    };
    alt -= 0.02; // start slightly compressed so that the Jacobian is informative
    for (let it = 0; it < 80; it++) {
      resid(alt, th, ph, r0);
      if (Math.abs(r0[0]) + Math.abs(r0[1]) + Math.abs(r0[2]) < 1e-9) break;
      const e = J.e;
      resid(alt + 1e-4, th, ph, r1);
      for (let k = 0; k < 3; k++) e[k * 3] = (r1[k] - r0[k]) / 1e-4;
      resid(alt, th + 1e-5, ph, r1);
      for (let k = 0; k < 3; k++) e[k * 3 + 1] = (r1[k] - r0[k]) / 1e-5;
      resid(alt, th, ph + 1e-5, r1);
      for (let k = 0; k < 3; k++) e[k * 3 + 2] = (r1[k] - r0[k]) / 1e-5;
      if (!Ji.invertFrom(J)) {
        // Degenerate (e.g. nothing touching): drop until contact.
        alt -= 0.05;
        continue;
      }
      d.set(r0[0], r0[1], r0[2]);
      Ji.mulVec(d, d);
      alt -= clamp(d.x, -0.05, 0.05);
      th -= clamp(d.y, -0.01, 0.01);
      ph -= clamp(d.z, -0.01, 0.01);
    }
    this.alt = alt;
    this.q.setFromEuler(psi, th, ph);
    this.vNed.zero();
    this.omega.zero();
    // Re-sample planes at the final altitude so the first dynamic step starts in equilibrium.
    this.ground.sampleTerrain(this.world, this.lat, this.lon, this.alt, this.q, cg);
    this.dPos.zero();
    this.ground.compute(this.dPos, this.q, this.zero, this.zero, cg, 0);
    for (const c of this.ground.contacts) {
      c.wasInContact = c.normalForce > 0;
    }
  }

  private checkCrash(): void {
    const lim = this.config.limits;
    const gr = this.ground;
    let reason = '';
    if (gr.maxTouchdownSpeed * MS_TO_FPM > lim.maxSinkRateOnGround_fpm) {
      reason = `Hard landing: ${Math.round(gr.maxTouchdownSpeed * MS_TO_FPM)} fpm`;
    } else if (gr.structureImpactSpeed > STRUCTURE_IMPACT_MS) {
      reason = `Structure impact: ${gr.structureContactName}`;
    } else if (gr.structureContactTime > STRUCTURE_SCRAPE_S && Math.hypot(this.vNed.x, this.vNed.y) > 2.5) {
      reason = `Structure ground contact: ${gr.structureContactName}`;
    } else if (gr.touchingWater) {
      reason = 'Contact with water';
    } else if (this.alt < this.groundElevation) {
      reason = 'Terrain impact';
    } else {
      const nz = -this.specificForce.z / G0;
      this.nzFilt += (nz - this.nzFilt) * 0.1;
      if (!gr.onGround) {
        if (this.nzFilt > lim.maxLoadFactor * OVERLOAD_ULTIMATE_FACTOR || this.nzFilt < lim.minLoadFactor * OVERLOAD_ULTIMATE_FACTOR) {
          reason = `Structural failure: load factor ${this.nzFilt.toFixed(1)} g`;
        } else if (this.cas * MS_TO_KT > lim.vmo_kt * VD_FACTOR || (lim.mmo >= 0.4 && this.mach > lim.mmo + 0.1)) {
          reason = 'Structural failure: overspeed';
        }
      }
    }
    if (reason) {
      this.crashed = true;
      this.crashReason = reason;
      this.vNed.zero();
      this.omega.zero();
    }
  }

  /** Writes every fdm.* var. */
  private publish(): void {
    const v = this.vars;
    const air = this.air;
    const psi = this.q.getPsi();
    const theta = this.q.getTheta();
    const phi = this.q.getPhi();
    const hdgTrue = wrap360(psi * RAD2DEG);

    // Magnetic variation: refresh every ~2 s of motion or when moved > ~2 km.
    this.magTimer++;
    if (this.magTimer > 240 || Math.abs(this.lat - this.magLat) > 0.02 || Math.abs(this.lon - this.magLon) > 0.02) {
      this.magVar = magneticDeclination(this.lat, this.lon, this.alt, this.magYear);
      this.magLat = this.lat;
      this.magLon = this.lon;
      this.magTimer = 0;
    }

    const datum = this.datumScratch;
    this.getDatumPosition(datum);
    v.set(FDM.lat, datum.lat);
    v.set(FDM.lon, datum.lon);
    v.set(FDM.altMsl, datum.alt * M_TO_FT);
    const agl = this.alt - this.groundElevation;
    v.set(FDM.altAgl, agl * M_TO_FT);
    // Radio altimeter reference: datum + radioAltOffset along body z.
    const cg = this.massModel.cg;
    this.t1.set(-cg.x, -cg.y, this.config.radioAltOffset_m - cg.z);
    this.q.rotate(this.t1, this.t2);
    v.set(FDM.radioAlt, (this.alt - this.t2.z - this.groundElevation) * M_TO_FT);
    v.set(FDM.pitch, theta * RAD2DEG);
    v.set(FDM.bank, phi * RAD2DEG);
    v.set(FDM.headingTrue, hdgTrue);
    v.set(FDM.magVar, this.magVar);
    v.set(FDM.headingMag, wrap360(hdgTrue - this.magVar));
    const gs = Math.hypot(this.vNed.x, this.vNed.y);
    const trk = gs > 0.5 ? wrap360(Math.atan2(this.vNed.y, this.vNed.x) * RAD2DEG) : hdgTrue;
    v.set(FDM.trackTrue, trk);
    v.set(FDM.trackMag, wrap360(trk - this.magVar));
    const casKt = this.cas * MS_TO_KT;
    v.set(FDM.ias, casKt);
    v.set(FDM.cas, casKt);
    v.set(FDM.tas, this.tas * MS_TO_KT);
    v.set(FDM.eas, easFromTas(this.tas, air.density_kgm3) * MS_TO_KT);
    v.set(FDM.gs, gs * MS_TO_KT);
    v.set(FDM.mach, this.mach);
    v.set(FDM.vs, -this.vNed.z * MS_TO_FPM);
    v.set(FDM.aoa, this.alpha * RAD2DEG);
    v.set(FDM.beta, this.beta * RAD2DEG);
    const sf = this.specificForce;
    v.set(FDM.nz, -sf.z / G0);
    v.set(FDM.ny, sf.y / G0);
    v.set(FDM.nx, sf.x / G0);
    const w = this.omega;
    v.set(FDM.p, w.x * RAD2DEG);
    v.set(FDM.q, w.y * RAD2DEG);
    v.set(FDM.r, w.z * RAD2DEG);
    const ct = Math.cos(theta);
    const turn = Math.abs(ct) > 1e-3 ? (w.y * Math.sin(phi) + w.z * Math.cos(phi)) / ct : 0;
    v.set(FDM.turnRate, turn * RAD2DEG);
    v.set(FDM.onGround, this.ground.onGround ? 1 : 0);
    v.set(FDM.crashed, this.crashed ? 1 : 0);
    v.setString(FDM.crashReason, this.crashReason);
    v.set(FDM.mass, this.massModel.mass);
    v.set(FDM.cgPctMac, this.massModel.cgPercentMac(this.config.aero.mac_m));
    v.set(FDM.stallWarn, this.aero.stallWarning);
    v.set(FDM.aoaNorm, this.aero.aoaNorm);
    v.set(FDM.alphaStall, this.aero.alphaStallEff);
    v.set(FDM.buffet, this.aero.buffet);
    v.set(FDM.pressAlt, air.pressureAltitude_m * M_TO_FT);
    v.set(FDM.densityAlt, air.densityAltitude_m * M_TO_FT);
    v.set(FDM.sat, air.temperature_K - 273.15);
    v.set(FDM.tat, totalTemperature(air.temperature_K, this.mach, this.opts.tatRecovery) - 273.15);
    v.set(FDM.staticPressInHg, air.pressure_Pa * PA_TO_INHG);
    v.set(FDM.staticPressPa, air.pressure_Pa);
    v.set(FDM.densityKgM3, air.density_kgm3);
    v.set(FDM.qbarPa, this.qbar);
    windFromVector(this.windNed.x, this.windNed.y, this.windOut);
    v.set(FDM.windDir, this.windOut.dir);
    v.set(FDM.windSpeed, this.windOut.kt);
    v.set(FDM.groundElevFt, this.groundElevation * M_TO_FT);
    v.set(FDM.frozen, this.frozen ? 1 : 0);
  }

  private readonly datumScratch = { lat: 0, lon: 0, alt: 0 };
}

/** WGS84 normal gravity (Somigliana, NIMA TR8350.2 eq. 4-1) with a free-air height correction. */
export function normalGravity(latDeg: number, h: number): number {
  const s = Math.sin(latDeg * DEG2RAD);
  const s2 = s * s;
  const g0 = (9.7803253359 * (1 + 0.00193185265241 * s2)) / Math.sqrt(1 - WGS84_E2 * s2);
  // TR8350.2 eq. 4-3 (second-order free-air correction).
  return g0 * (1 - (2 / 6378137) * (1 + 1 / 298.257223563 + 0.00344978650684 - 2 * (1 / 298.257223563) * s2) * h + (3 / (6378137 * 6378137)) * h * h);
}

function wrapAngle(a: number): number {
  return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a;
}
