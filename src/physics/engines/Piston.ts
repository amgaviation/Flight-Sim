/**
 * Normally-aspirated piston engine with a fixed-pitch propeller, driven by a
 * `PistonConfig` (target: Lycoming IO-360-L2A, 180 hp @ 2700 rpm, McCauley
 * 1A170E/JHA7660 76 in propeller in the Cessna 172S).
 *
 * Physics (per step):
 *  1. Manifold pressure: throttle butterfly and engine act as flow
 *     "impedances" in series, MAP = P_ram * Ze / (Ze + Zt), with Ze ~ 1/rpm
 *     (the engine pumps volume proportional to rpm) and Zt ~ 1/A(throttle)
 *     (A = idle-gap + (1 - cos) butterfly area). Full throttle at rated rpm
 *     gives 98% of ram pressure. Manifold filling lag 50 ms.
 *  2. Air mass flow = VE * VE_residual(MAP) * rho_manifold * Vd * rpm/120.
 *     VE is calibrated so rated-power fuel flow (`ratedFuelFlow_gph`) at the
 *     best-power mixture results; VE_residual models exhaust backflow
 *     (compression ratio) at low MAP.
 *  3. Fuel: the servo meters fuel ~ proportional to air *volume*, so the
 *     full-rich fuel/air ratio rises as 1/sqrt(sigma) with altitude (why the
 *     POH requires leaning above 3,000 ft). Mixture control scales it
 *     linearly, 0 = idle cut-off. Priming: `eng.primer` and (fuel-injected)
 *     open mixture with fuel pressure while the engine is stopped build a
 *     fuel film in the intake that evaporates into the charge; too much
 *     floods the engine (too rich to fire) until cranked clear.
 *  4. Combustion: indicated power = mdot_air * K * f(phi) * mags * eta_load,
 *     with f(phi) the classic power-vs-equivalence-ratio curve (best power
 *     ~phi 1.15 = ~100 degF rich of peak EGT, 3-6% loss at peak EGT, lean and
 *     rich misfire limits). K is calibrated so brake power = rated at rated
 *     rpm, full throttle, sea level, best-power mixture.
 *  5. Torque balance: indicated - friction - pumping + starter - prop = I dw/dt.
 *     Propeller: T = CT rho n^2 D^4, Q = CP rho n^2 D^5 / 2pi from the CT/CP(J)
 *     tables; windmilling (negative CP) drives a dead engine.
 *  6. EGT (6 s lag), CHT (90 s), oil temperature (240 s) and pressure,
 *     vacuum pump suction, accessory drive.
 * The throttle idle-gap area is solved at construction so the engine idles
 * at `idleRpm` at sea level, full rich, warm, static.
 */
import { clamp, clamp01, interp1, Prng } from '../../core/math';
import { Vec3 } from '../../core/linalg';
import type { SimVars } from '../../core/SimVars';
import { ENG } from '../../core/vars';
import { AVGAS_GPH_TO_KGS, HP_TO_W, KGS_TO_PPH, PA_TO_INHG, kToF } from '../../core/units';
import { P0, R_AIR, RHO0, T0 } from '../atmosphere';
import type { PistonConfig, Table1D } from '../types';
import type { EngineEnv, EngineModel } from './Engine';

const CUIN_TO_M3 = 16.387064e-6;
/** Stoichiometric fuel/air ratio for avgas. EST: AFR ~15:1 for C8-like aviation gasoline. */
const FAR_STOICH = 0.0667;
/** Equivalence ratio of best power (~100 degF rich of peak EGT). EST from classic Lycoming/Continental leaning curves. */
const PHI_BEST_POWER = 1.15;
/** Equivalence ratio of peak EGT (slightly lean of stoichiometric). EST. */
const PHI_PEAK_EGT = 0.96;
/**
 * Relative indicated power vs equivalence ratio (fuel/air divided by
 * stoichiometric). EST shape from published leaning curves: peak EGT ~6% below
 * best power, lean misfire ~phi 0.65, rich misfire ~phi 2.1.
 */
const POWER_VS_PHI: Table1D = {
  x: [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.96, 1.02, 1.08, 1.15, 1.25, 1.35, 1.45, 1.6, 1.75, 1.9, 2.05, 2.2],
  y: [0, 0.1, 0.4, 0.62, 0.76, 0.84, 0.9, 0.94, 0.97, 0.99, 1.0, 0.995, 0.98, 0.955, 0.9, 0.8, 0.6, 0.3, 0],
};
const PHI_LEAN_LIMIT = 0.63;
const PHI_RICH_LIMIT = 2.15;
/** Throttle-body pressure loss at full throttle and rated rpm (MAP = 98% of ram pressure). EST. */
const FULL_THROTTLE_MAP_RATIO = 0.98;
/** Ram-pressure recovery of the induction inlet. EST. */
const RAM_RECOVERY = 0.7;
/** Single-magneto combustion efficiency (one plug per cylinder -> slower burn). EST, tuned to the POH run-up drop. */
const MAG_LEFT_ONLY = 0.935;
const MAG_RIGHT_ONLY = 0.925;
/** Prime quantity (kg of fuel) for one ideal cold-start prime. EST: ~10 cm^3 avgas. */
const PRIME_CHARGE_KG = 0.0073;
/** Seconds of primer / injector flow to deliver one prime charge. EST (POH: 3-5 s of aux-pump flow). */
const PRIME_TIME_S = 4;
/** Fraction of the intake fuel film drawn into the charge per revolution (x sqrt(MAP ratio)). EST. */
const FILM_DRAW_PER_REV = 0.03;
/** Starter no-load speed (engine rpm). EST: typical 12/24 V geared starter cranks ~150-300 rpm under load. */
const STARTER_NO_LOAD_RPM = 350;
/** Vacuum pump regulated suction (inHg) and spin-up constant (rpm). EST; POH green arc 4.5-5.5 inHg. */
const VACUUM_REG_INHG = 5.0;
const VACUUM_RPM_K = 400;

export class Piston implements EngineModel {
  readonly index: number;
  readonly kind = 'piston' as const;
  readonly cfg: PistonConfig;
  readonly position = new Vec3();
  readonly axis = new Vec3(1, 0, 0);
  readonly extraMoment = new Vec3();
  readonly angularMomentum = new Vec3();

  // ---- state
  /** Crankshaft/prop speed (rad/s). */
  omega = 0;
  map_Pa = P0;
  egt_K = T0;
  cht_K = T0;
  oilTemp_K = T0;
  oilPress_psi = 0;
  /** Intake fuel film in prime charges (1 = ideal prime). */
  wet = 0;
  firing = false;
  roughness = 0;
  thrust_N = 0;
  propwashDq_Pa = 0;
  fuelFlow_kgs = 0;
  /** Fuel flow shown by the flow transducer (metered + priming flow), kg/s. */
  indicatedFlow_kgs = 0;
  brakePower_W = 0;
  indicatedPower_W = 0;
  shaftTorque_Nm = 0;
  propTorque_Nm = 0;
  phi = 0;

  // ---- calibration constants
  readonly displacement_m3: number;
  readonly ve: number;
  /** Indicated work per kg of air at best power, full efficiency (J/kg). */
  readonly specificWork: number;
  readonly farBestPower: number;
  readonly idleArea: number;
  private readonly ztFull: number;
  private readonly rot: 1 | -1;
  private readonly pFactor: number;
  private readonly slipYaw: number;
  private readonly fullRich: number;
  /** 1 - torqueRollRecovery (appended option; 1 = the original full torque reaction). */
  private readonly torqueRollFactor: number;
  private readonly injected: boolean;
  private readonly diskArea: number;
  private readonly jMax: number;
  private readonly refAreaSpan: number;
  private readonly rng: Prng;

  // ---- vars
  private readonly vars: SimVars;
  private readonly vThrottle: string;
  private readonly vMixture: string;
  private readonly vMagL: string;
  private readonly vMagR: string;
  private readonly vPrimer: string;
  private readonly vAltAir: string;
  private readonly vStarter: string;
  private readonly vFuelOn: string;
  private readonly oRunning: string;
  private readonly oRpm: string;
  private readonly oMap: string;
  private readonly oEgt: string;
  private readonly oCht: string;
  private readonly oFfGph: string;
  private readonly oFfPph: string;
  private readonly oOilP: string;
  private readonly oOilTF: string;
  private readonly oOilTC: string;
  private readonly oThrust: string;
  private readonly oAcc: string;
  private readonly oVac: string;
  private readonly oRough: string;
  private readonly oPower: string;

  /**
   * @param cfg engine configuration
   * @param index 1-based engine number
   * @param vars sim variable store
   * @param wingArea_m2 / span_m aircraft reference geometry for slipstream yaw
   */
  constructor(cfg: PistonConfig, index: number, vars: SimVars, wingArea_m2 = 16, span_m = 11) {
    this.cfg = cfg;
    this.index = index;
    this.vars = vars;
    this.position.setArray(cfg.position_m);
    this.axis.setArray(cfg.thrustAxis).normalize();
    this.rot = cfg.propRotation ?? 1;
    this.pFactor = cfg.pFactorCoeff ?? 0.35;
    this.slipYaw = cfg.slipstreamYawCoeff ?? 0.004;
    this.fullRich = cfg.fullRichFactor ?? 1.12;
    this.torqueRollFactor = 1 - clamp01(cfg.torqueRollRecovery ?? 0);
    this.injected = (cfg.induction ?? 'injected') === 'injected';
    this.diskArea = Math.PI * 0.25 * cfg.propDiameter_m * cfg.propDiameter_m;
    this.jMax = cfg.propCP.x[cfg.propCP.x.length - 1];
    this.refAreaSpan = wingArea_m2 * span_m;
    this.rng = new Prng(0x5eed + index);
    this.vThrottle = ENG.throttle(index);
    this.vMixture = ENG.mixture(index);
    this.vMagL = ENG.magLeft(index);
    this.vMagR = ENG.magRight(index);
    this.vPrimer = ENG.primer(index);
    this.vAltAir = ENG.altAir(index);
    this.vStarter = ENG.starter(index);
    this.vFuelOn = ENG.fuelOn(index);
    this.oRunning = ENG.running(index);
    this.oRpm = ENG.rpm(index);
    this.oMap = ENG.mapInHg(index);
    this.oEgt = ENG.egtF(index);
    this.oCht = ENG.chtF(index);
    this.oFfGph = ENG.fuelFlowGph(index);
    this.oFfPph = ENG.fuelFlowPph(index);
    this.oOilP = ENG.oilPressPsi(index);
    this.oOilTF = ENG.oilTempF(index);
    this.oOilTC = ENG.oilTempC(index);
    this.oThrust = ENG.thrustN(index);
    this.oAcc = ENG.accessoryDrive(index);
    this.oVac = ENG.vacuumInHg(index);
    this.oRough = ENG.roughness(index);
    this.oPower = ENG.powerHp(index);
    this.displacement_m3 = cfg.displacement_cuin * CUIN_TO_M3;
    this.farBestPower = FAR_STOICH * PHI_BEST_POWER;

    // --- Volumetric efficiency from rated fuel flow at best power, SL, full throttle, rated rpm.
    const mdotFuelRated = cfg.ratedFuelFlow_gph * AVGAS_GPH_TO_KGS;
    const mdotAirRated = mdotFuelRated / this.farBestPower;
    const mapRated = FULL_THROTTLE_MAP_RATIO * P0;
    const rhoMan = mapRated / (R_AIR * T0);
    const swept = (rhoMan * this.displacement_m3 * cfg.ratedRpm) / 120;
    this.ve = mdotAirRated / (swept * this.residualVE(mapRated, P0));
    // --- Specific indicated work so that brake power = rated at the rated point.
    const wRated = (cfg.ratedRpm * 2 * Math.PI) / 60;
    const pInd = cfg.ratedPower_hp * HP_TO_W + (this.frictionTorque(cfg.ratedRpm) + this.pumpingTorque(mapRated, P0)) * wRated;
    this.specificWork = pInd / (mdotAirRated * this.loadEfficiency(mapRated / P0));
    // --- Throttle impedances: Ze = ratedRpm / rpm (1 at rated rpm).
    this.ztFull = 1 / FULL_THROTTLE_MAP_RATIO - 1;
    this.idleArea = this.solveIdleArea();
  }

  get running(): boolean {
    return this.firing && this.rpm > 400;
  }

  get rpm(): number {
    return (this.omega * 60) / (2 * Math.PI);
  }

  // ------------------------------------------------------------ component models

  /** Friction + compression torque (N·m) opposing rotation at `rpm`. EST: linear growth from the idle value. */
  frictionTorque(rpm: number): number {
    return this.cfg.frictionTorque_Nm * (0.6 + (0.4 * rpm) / this.cfg.idleRpm);
  }

  /** Pumping-loss torque (N·m): (P_exhaust - MAP) * Vd / 4pi per four-stroke cycle. */
  pumpingTorque(map: number, pExh: number): number {
    return (Math.max(0, pExh - map) * this.displacement_m3) / (4 * Math.PI);
  }

  /** Exhaust-residual volumetric efficiency factor (r - (Pexh/MAP)^(1/gamma)) / (r - 1). */
  residualVE(map: number, pExh: number): number {
    const r = this.cfg.compressionRatio;
    const x = Math.pow(pExh / Math.max(1000, map), 1 / 1.4);
    return clamp((r - x) / (r - 1), 0.05, 1.05);
  }

  /** Combustion efficiency loss at very low MAP (residual dilution, slow burn). EST. */
  loadEfficiency(mapRatio: number): number {
    const x = clamp01((0.55 - mapRatio) / 0.3);
    return 1 - 0.35 * Math.pow(x, 1.5);
  }

  /** Throttle butterfly effective open area (1 = full), idle gap `idleArea`. */
  throttleArea(t: number, idleArea = this.idleArea): number {
    const x = clamp01(t);
    return idleArea + (1 - idleArea) * (1 - Math.cos((x * Math.PI) / 2));
  }

  /** Steady manifold pressure for ram pressure, throttle area and rpm. */
  manifoldPressure(pRam: number, area: number, rpm: number): number {
    const ze = this.cfg.ratedRpm / Math.max(1, rpm);
    const zt = this.ztFull / Math.max(1e-6, area);
    return (pRam * ze) / (ze + zt);
  }

  /** Air mass flow (kg/s) at MAP, manifold temperature and rpm. */
  airFlow(map: number, tMan: number, rpm: number, pExh: number): number {
    const rho = map / (R_AIR * tMan);
    return (this.ve * this.residualVE(map, pExh) * rho * this.displacement_m3 * rpm) / 120;
  }

  /** Full-rich fuel/air ratio for ambient density ratio sigma (servo meters ~ by volume). */
  fullRichFar(sigma: number): number {
    return (this.farBestPower * this.fullRich) / Math.sqrt(Math.max(0.2, sigma));
  }

  /** Propeller torque (N·m) and thrust (N) at rpm and axial speed; handles stopped/windmilling props. */
  propeller(rpm: number, v: number, rho: number, out: { thrust: number; torque: number; j: number }): void {
    const c = this.cfg;
    const D = c.propDiameter_m;
    const n = rpm / 60;
    const va = Math.max(0, v);
    // For a slow/stopped prop use the coefficients at the table's highest J
    // with n_eff = V / (Jmax D): torque/thrust then scale with V^2 (continuous).
    const nEff = Math.max(n, va / (this.jMax * D), 1e-3);
    const J = va / (nEff * D);
    const ct = interp1(c.propCT, J);
    const cp = interp1(c.propCP, J);
    out.j = J;
    out.thrust = ct * rho * nEff * nEff * D * D * D * D;
    out.torque = (cp * rho * nEff * nEff * D * D * D * D * D) / (2 * Math.PI);
  }

  /** Torque available minus required at a static rpm (for idle calibration). */
  private staticTorqueBalance(map: number, rpm: number, far: number): number {
    const mdot = this.airFlow(map, T0, rpm, P0);
    const pf = interp1(POWER_VS_PHI, far / FAR_STOICH);
    const w = (rpm * 2 * Math.PI) / 60;
    const qInd = (mdot * this.specificWork * pf * this.loadEfficiency(map / P0)) / w;
    const prop = { thrust: 0, torque: 0, j: 0 };
    this.propeller(rpm, 0, RHO0, prop);
    return qInd - this.frictionTorque(rpm) - this.pumpingTorque(map, P0) - prop.torque;
  }

  /** Finds the throttle idle-gap area that idles at `idleRpm` (SL ISA, static, full rich, both mags). */
  private solveIdleArea(): number {
    const rpm = this.cfg.idleRpm;
    const far = this.fullRichFar(1);
    let lo = 0.05 * P0;
    let hi = P0;
    for (let k = 0; k < 60; k++) {
      const mid = 0.5 * (lo + hi);
      if (this.staticTorqueBalance(mid, rpm, far) > 0) hi = mid;
      else lo = mid;
    }
    const mapIdle = 0.5 * (lo + hi);
    const ze = this.cfg.ratedRpm / rpm;
    const zt = ze * (P0 / mapIdle - 1);
    return clamp(this.ztFull / zt, 1e-5, 0.2);
  }

  // ------------------------------------------------------------ step

  private readonly propOut = { thrust: 0, torque: 0, j: 0 };

  step(dt: number, env: EngineEnv): void {
    const c = this.cfg;
    const v = this.vars;
    const throttle = clamp01(v.get(this.vThrottle));
    const mixture = clamp01(v.get(this.vMixture));
    const magL = v.getBool(this.vMagL);
    const magR = v.getBool(this.vMagR);
    const primer = clamp01(v.get(this.vPrimer));
    const altAir = v.getBool(this.vAltAir);
    const starter = v.getBool(this.vStarter);
    const fuelOn = v.getBool(this.vFuelOn);

    const pAmb = env.pressure_Pa;
    const tAmb = env.temperature_K;
    const sigma = env.density_kgm3 / RHO0;
    const rpm = this.rpm;

    // 1. Manifold pressure
    const pRam = altAir ? pAmb * 0.97 : pAmb + RAM_RECOVERY * env.qbar_Pa;
    const tMan = altAir ? tAmb + 10 : tAmb;
    const mapTarget = this.manifoldPressure(pRam, this.throttleArea(throttle), rpm);
    this.map_Pa += (mapTarget - this.map_Pa) * (1 - Math.exp(-dt / 0.05));
    const map = this.map_Pa;

    // 2. Air flow
    const mdotAir = rpm > 1 ? this.airFlow(map, tMan, rpm, pAmb) : 0;

    // 3. Fuel metering and intake film (priming / flooding)
    const farMetered = fuelOn ? this.fullRichFar(sigma) * mixture : 0;
    const meteredFuel = mdotAir * farMetered;
    let primeFlow = primer * (PRIME_CHARGE_KG / PRIME_TIME_S);
    if (this.injected && fuelOn && rpm < 150) primeFlow += mixture * (PRIME_CHARGE_KG / PRIME_TIME_S);
    this.wet += (primeFlow * dt) / PRIME_CHARGE_KG;
    let filmFuel = 0;
    if (rpm > 20) {
      const draw = FILM_DRAW_PER_REV * Math.sqrt(clamp01(map / pAmb)) * (rpm / 60);
      filmFuel = this.wet * PRIME_CHARGE_KG * draw;
      this.wet -= this.wet * (1 - Math.exp(-draw * dt));
    }
    // Evaporation / drain from the intake film. EST: ~1 min time constant, faster when hot.
    const evapTau = this.cht_K > 340 ? 20 : 60;
    this.wet -= this.wet * (1 - Math.exp(-dt / evapTau));
    if (this.wet < 1e-6) this.wet = 0;

    // 4. Combustion
    const fuelIn = meteredFuel + filmFuel;
    const phi = mdotAir > 1e-6 ? fuelIn / mdotAir / FAR_STOICH : 0;
    this.phi = phi;
    const magFactor = magL && magR ? 1 : magL ? MAG_LEFT_ONLY : magR ? MAG_RIGHT_ONLY : 0;
    const canFire = magFactor > 0 && rpm > 50 && phi > PHI_LEAN_LIMIT && phi < PHI_RICH_LIMIT;
    this.firing = canFire;
    let pInd = 0;
    let rough = 0;
    if (canFire) {
      const pf = interp1(POWER_VS_PHI, phi);
      pInd = mdotAir * this.specificWork * pf * magFactor * this.loadEfficiency(map / pAmb);
      rough = clamp01((1 - pf) * 1.6) + (magFactor < 1 ? 0.12 : 0);
      if (rough > 0.25) {
        // Misfires: deterministic random torque dropouts proportional to roughness.
        pInd *= 1 - 0.5 * (rough - 0.25) * this.rng.next();
      }
    }
    this.roughness = clamp01(rough);
    this.indicatedPower_W = pInd;
    this.fuelFlow_kgs = canFire || rpm > 20 ? meteredFuel : 0;
    this.indicatedFlow_kgs = meteredFuel + primeFlow;

    // 5. Torque balance
    const w = this.omega;
    const qInd = pInd / Math.max(w, 5);
    const qStarter = starter ? c.starterTorque_Nm * Math.max(0, 1 - rpm / STARTER_NO_LOAD_RPM) : 0;
    const qLoss = w > 1e-6 ? this.frictionTorque(rpm) + this.pumpingTorque(map, pAmb) : 0;
    this.propeller(rpm, env.axialSpeed_ms, env.density_kgm3, this.propOut);
    const qProp = this.propOut.torque;
    const drive = qInd + qStarter - qProp;
    let wNew: number;
    if (w <= 1e-6 && drive <= this.frictionTorque(0)) {
      wNew = 0; // static friction holds a stopped engine
    } else {
      wNew = w + ((drive - qLoss) / c.propInertia_kgm2) * dt;
      if (wNew < 0) wNew = 0;
    }
    this.omega = wNew;
    this.shaftTorque_Nm = qInd + qStarter - qLoss;
    this.propTorque_Nm = qProp;
    this.brakePower_W = Math.max(0, (qInd - qLoss) * wNew);

    // Prop thrust, slipstream, moments
    const T = wNew > 0 || env.axialSpeed_ms > 1 ? this.propOut.thrust : 0;
    this.thrust_N = T;
    this.propwashDq_Pa = T > 0 ? T / this.diskArea : 0;
    const R = 0.5 * c.propDiameter_m;
    const rot = this.rot;
    const em = this.extraMoment;
    // Airframe reaction to the engine torque on the crankshaft (roll opposite to prop rotation).
    em.x = -rot * this.shaftTorque_Nm * this.axis.x * this.torqueRollFactor;
    em.y = 0;
    // P-factor: descending blade (right side for clockwise rotation) has more AoA at +alpha -> yaw left.
    const dy = rot * this.pFactor * R * clamp(env.alpha_rad, -0.35, 0.35);
    em.z = -dy * T;
    // Spiral slipstream striking the fin from the left (clockwise prop) -> yaw left.
    em.z += -rot * this.slipYaw * this.propwashDq_Pa * this.refAreaSpan;
    this.angularMomentum.copy(this.axis).scale(rot * c.propInertia_kgm2 * wNew);

    // 6. Temperatures, oil, vacuum
    const load = pInd / (c.ratedPower_hp * HP_TO_W * 1.15);
    let egtTarget = tAmb;
    if (canFire) {
      const egtPk = tAmb + ((c.egtPeak_f - kToF(tAmb)) / 1.8) * (0.62 + 0.38 * Math.sqrt(clamp(load, 0, 1.2)));
      let drop = 0;
      if (phi >= PHI_PEAK_EGT) drop = 100 * Math.pow((phi - PHI_PEAK_EGT) / 0.21, 1.3);
      else drop = 100 * Math.pow((PHI_PEAK_EGT - phi) / 0.12, 1.3);
      egtTarget = egtPk - drop / 1.8;
    }
    this.egt_K += (egtTarget - this.egt_K) * (1 - Math.exp(-dt / (canFire ? 6 : 30)));

    let chtTarget = tAmb;
    if (canFire) {
      const heat = Math.pow(clamp(load / 0.65, 0, 1.6), 0.55);
      const mixHeat = 1 + 0.12 * Math.exp(-(((phi - 1.05) / 0.15) ** 2)) - 0.08;
      const cooling = 1 + 0.25 * (1 - clamp01(env.tas_ms / 55));
      chtTarget = tAmb + ((c.chtNormal_f - 59) / 1.8) * heat * mixHeat * cooling;
    }
    this.cht_K += (chtTarget - this.cht_K) * (1 - Math.exp(-dt / 90));

    const oilTarget = canFire ? tAmb + ((c.oilTempNormal_f - 59) / 1.8) * (0.55 + 0.45 * clamp(load / 0.65, 0, 1.2)) : tAmb;
    this.oilTemp_K += (oilTarget - this.oilTemp_K) * (1 - Math.exp(-dt / (canFire ? 240 : 1200)));
    const rpmNow = this.rpm;
    const visc = 1 + 0.4 * clamp01((c.oilTempNormal_f - kToF(this.oilTemp_K)) / 150);
    this.oilPress_psi = Math.min(115, c.oilPressNormal_psi * Math.pow(clamp01(rpmNow / 2000), 0.8) * visc);

    this.publish(rpmNow, map);
  }

  private publish(rpm: number, map: number): void {
    const v = this.vars;
    v.set(this.oRunning, this.running ? 1 : 0);
    v.set(this.oRpm, rpm);
    v.set(this.oMap, map * PA_TO_INHG);
    v.set(this.oEgt, kToF(this.egt_K));
    v.set(this.oCht, kToF(this.cht_K));
    const ffShown = this.indicatedFlow_kgs;
    v.set(this.oFfGph, ffShown / AVGAS_GPH_TO_KGS);
    v.set(this.oFfPph, ffShown * KGS_TO_PPH);
    v.set(this.oOilP, this.oilPress_psi);
    v.set(this.oOilTF, kToF(this.oilTemp_K));
    v.set(this.oOilTC, this.oilTemp_K - 273.15);
    v.set(this.oThrust, this.thrust_N);
    v.set(this.oAcc, rpm / this.cfg.ratedRpm);
    v.set(this.oVac, rpm > 0 ? VACUUM_REG_INHG * (1 - Math.exp(-rpm / VACUUM_RPM_K)) : 0);
    v.set(this.oRough, this.roughness);
    v.set(this.oPower, this.brakePower_W / HP_TO_W);
  }

  /**
   * Stabilizes the engine at the current inputs (true) — rpm from a fast
   * internal spin-up with frozen conditions, temperatures at their running
   * targets — or stops it cold (false). Requires inputs that support
   * combustion (mags on, mixture open, fuel_on) to stay running.
   */
  setRunning(running: boolean, env: EngineEnv): void {
    const c = this.cfg;
    this.wet = 0;
    if (!running) {
      this.omega = 0;
      this.firing = false;
      this.map_Pa = env.pressure_Pa;
      this.egt_K = this.cht_K = this.oilTemp_K = env.temperature_K;
      this.step(1e-9, env);
      return;
    }
    // Spin up quickly from idle and let rpm settle (temperatures preset to warm).
    this.omega = (c.idleRpm * 2 * Math.PI) / 60;
    this.cht_K = env.temperature_K + (c.chtNormal_f - 59) / 1.8;
    this.oilTemp_K = env.temperature_K + (c.oilTempNormal_f - 59) / 1.8;
    this.egt_K = env.temperature_K + (c.egtPeak_f - 200 - 59) / 1.8;
    const savedEgt = this.egt_K;
    for (let i = 0; i < 1200; i++) this.step(1 / 120, env);
    // Keep thermal states warm after the settling loop.
    this.egt_K = Math.max(this.egt_K, savedEgt - 150);
    this.step(1e-9, env);
  }

  /** Fuel flow in gph (metered). */
  get fuelFlowGph(): number {
    return this.fuelFlow_kgs / AVGAS_GPH_TO_KGS;
  }

  /** EGT in degF. */
  get egtF(): number {
    return kToF(this.egt_K);
  }
}
