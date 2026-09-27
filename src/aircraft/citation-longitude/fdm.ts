/**
 * Flight-dynamics configuration of the Cessna Citation Longitude (Model 700,
 * 2 x Honeywell HTF7700L). Sources are abbreviated as in data.ts (FPG, OG,
 * BCA, AW, WIKI); every estimate is marked EST with its reasoning.
 *
 * Body frame (physics convention): origin = datum = empty-weight CG with the
 * gear down, x forward, y right, z down. No public TCDS station data exist for
 * the Model 700 (the FAA TCDS T00015WI is not on DRS publicly), so the
 * longitudinal layout is built from the FPG three-view numbers (length 22.30 m,
 * span 21.00 m, height 5.92 m, wheelbase 9.62 m, tread 2.95 m) and EST
 * proportions measured from published side-view drawings, noted below.
 *
 * Calibration targets (tests/aircraft/citation-longitude):
 *  - 1-g stall speeds (FPG p.26, KCAS): 33,500 lb 129 UP / 116 F1 / 111 F2 / 102 FULL.
 *  - Takeoff (FPG p.4-5): VR 126 KIAS at 39,500 lb, field length 4,810 ft SL ISA (factored).
 *  - Cruise (FPG p.17-19): FL410 M0.80 457 KTAS 1,807 lb/h at 36,000 lb; FL450 M0.80 1,573 lb/h at
 *    32,000 lb; max cruise thrust FL450 473 KTAS at 32,000 lb.
 *  - Climb (FPG p.16): sea level to FL410 in 14 min at 36,000 lb (270 KIAS / M0.76).
 */
import type { FdmConfig, GearContactConfig, Table2D, TurbofanConfig } from '../../physics/types';
import { isaPressure, isaTemperature } from '../../physics/atmosphere';
import { FT_TO_M } from '../../core/units';
import { LB, LBF, LON_LIMITS } from './data';

// ------------------------------------------------------------------ geometry

/** WIKI / AOPA spec box: wing area 537 ft^2. */
export const WING_AREA_M2 = 537 * 0.09290304; // 49.89 m^2
/** FPG p.2: wing span 68 ft 11 in (21.00 m, over the winglets). */
export const SPAN_M = 21.0;
/**
 * MAC EST: straight-tapered planform with taper ratio 0.30 (EST from the plan
 * view): root chord 2S/(b(1+l)) = 3.66 m, MAC = 2/3 c_r (1+l+l^2)/(1+l) = 2.61 m.
 */
export const MAC_M = 2.61;
/**
 * Empty CG EST at 35 % MAC. The OG 17-3 takeoff stab-trim chart covers 24-40 % MAC (the certified CG
 * range); with the stations below (crew 7.4 m, club seats 4.6 / 2.2 m ahead of the datum, fuel 0.2 m
 * ahead), an empty CG at 30 % put every realistic loading at 19-23 % MAC, forward of the chart. At 35 %
 * the loadings fall at 24-29 % MAC (check-ride pass, docs §13). Aft-engine jets sit aft when empty.
 */
export const EMPTY_CG_PCT_MAC = 35;
export const MAC_LE_X = (EMPTY_CG_PCT_MAC / 100) * MAC_M; // 0.91 m ahead of the datum
/** Low wing: chord plane ~0.6 m below the fuselage centreline/datum (EST, cabin floor above the wing box). */
const WING_Z = 0.6;

// ------------------------------------------------------------------ engine

/**
 * Thrust lapse EST for a BPR ~4.4 turbofan (HTF7000 family, Honeywell data sheet
 * class): F/F0 = delta^a (1 - b M + c M^2) / theta^0.5, calibrated so the CLB
 * and CRU ratings reproduce the FPG climb times and maximum-cruise speeds.
 */
export const LAPSE_A = 0.95;
export const LAPSE_B = 0.52;
export const LAPSE_C = 0.42;
function lapseTable(): Table2D {
  const machs = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const alts = [0, 5000, 10000, 15000, 20000, 25000, 30000, 36089, 41000, 45000, 51000];
  const z = machs.map((m) =>
    alts.map((ft) => {
      const H = ft * FT_TO_M;
      const delta = isaPressure(H) / 101325;
      const theta = isaTemperature(H) / 288.15;
      const v = (Math.pow(delta, LAPSE_A) * (1 - LAPSE_B * m + LAPSE_C * m * m)) / Math.sqrt(theta);
      return Math.round(v * 10000) / 10000;
    }),
  );
  return { x: machs, y: alts, z };
}

/**
 * N1 (%) giving the rated 7,665 lbf at sea-level ISA static. EST 91.5 %: the
 * engine is flat rated to 34 degC (FPG p.2); at 34 degC the corrected speed
 * demands 91.5 x sqrt(307.15/288.15) = 94.5 % physical N1, inside the 96.79 %
 * takeoff limit (OG 1-3), leaving margin for bleed and altitude.
 */
export const N1_RATED_PCT = 91.5;

export function htf7700l(name: string, side: -1 | 1): TurbofanConfig {
  return {
    kind: 'turbofan',
    name,
    // Pylon-mounted on the aft fuselage "just aft of the wings" (BCA): nacelle centre ~4.3 m aft of the empty CG,
    // 2.1 m outboard (fuselage radius ~1.05 m + pylon + nacelle radius), thrust line 0.75 m above the datum (EST).
    position_m: [-4.3, side * 2.1, -0.75],
    thrustAxis: [1, 0, 0],
    maxThrust_N: LON_LIMITS.takeoffThrustLbf * LBF, // FPG p.2 / AW (TCDS): 7,665 lbf SL static
    thrustLapse: lapseTable(),
    n1Max_pct: N1_RATED_PCT,
    n1Idle_pct: 22, // EST: HTF7000-class ground idle N1 (Challenger 300 / Latitude family ~20-24 %)
    n2Idle_pct: 55, // EST: HTF7000-class ground idle N2
    n2Max_pct: 97.0, // EST: N2 at rated N1; limit 98.62 % takeoff (OG 1-3)
    // Net thrust fraction vs corrected-N1 fraction (EST, high-bypass curve; extends past 1.0 for the flat rating).
    thrustVsN1: { x: [0, 0.2, 0.24, 0.4, 0.6, 0.8, 0.9, 1.0, 1.06, 1.1], y: [0, 0.015, 0.03, 0.085, 0.24, 0.52, 0.73, 1.0, 1.17, 1.28] },
    spoolUpTau_s: { x: [0, 20, 55, 70, 85, 97], y: [4, 3.5, 2.2, 1.4, 0.95, 0.7] }, // EST: ~6 s idle -> TO (14 CFR 33.73 class)
    spoolDownTau_s: { x: [0, 55, 97], y: [3, 2.4, 1.4] },
    // TSFC kg/(N h) vs N1 fraction. 0.0385 at rated = 0.378 lb/lbf/h SL static (EST: BPR 4.4 class; HTF7000 published
    // SLS SFC ~0.38-0.40). Mach factor calibrated to the FPG cruise fuel flows.
    tsfc: { x: [0, 0.25, 0.5, 0.8, 1.0, 1.1], y: [0.11, 0.085, 0.056, 0.042, 0.0385, 0.0385] },
    tsfcMachFactor: 1.3,
    idleFuelFlow_pph: 260, // EST: ground idle per engine for a 7,700 lbf-class turbofan
    ittIdle_c: 480, // EST
    ittMax_c: 880, // EST: ITT at rated thrust SL ISA, below the 950/955 degC limits (OG 1-3)
    ittStartPeak_c: 560, // EST: FADEC-scheduled start well below the 650 degC start limit (OG 1-3)
    starterMaxN2_pct: 26, // EST: ATS on APU bleed (>= 32 psi) motors to ~25 % N2 (OG dry motor: release at 19 % N2 / 15 s)
    lightOffN2_pct: 11, // EST: FADEC fuel-on at ~10-12 % N2
    startToIdle_s: 20, // BCA: "each engine start took less than 30 s"
    oilPressIdle_psi: 55, // EST
    oilPressMax_psi: 100, // EST
    oilTempNormal_c: 90, // EST
    reverseEfficiency: 0.38, // EST: pivot-door reverser (OG 7-2) ~35-40 % of forward thrust
    bleedPressMax_psi: 95, // EST: HP stage at max N2
    windmillN1PerKt: 0.08, // EST (physics test-jet class)
    windmillN2PerKt: 0.04,
    starterTau_s: 4,
    ittStartLimit_c: LON_LIMITS.ittStartC,
  };
}

// ------------------------------------------------------------------ gear

/**
 * Landing gear from FPG p.2: wheelbase 31 ft 7 in (9.62 m), tread 9 ft 8 in (2.95 m).
 * Trailing-link dual-wheel mains, single trailing-link nose gear (OG 2-5 says
 * "dual trailing-link main gear"). Mains 0.85 m aft of the empty CG (EST: ~9 %
 * of the weight on the nose wheel, typical for aft-engine jets). Springs give
 * ~45 % static deflection at MTOW.
 */
export const MAIN_X = -0.85;
export const NOSE_X = MAIN_X + 9.62;
const HALF_TREAD = 2.95 / 2;
/** EST: contact point with the struts extended; fuselage centreline ~1.75 m above the ramp when parked (cabin floor ~1.25 m, BCA: baggage floor "just over four feet"). */
const GEAR_Z = 1.88;
const MAIN_STATIC_DEFLECTION = 0.12;

function wheel(name: string, x: number, y: number, idx: number, main: boolean): GearContactConfig {
  return {
    name,
    position_m: [x, y, GEAR_Z],
    gearIndex: idx,
    // MTOW 17,917 kg: mains ~8,150 kg each -> 80 kN / 0.12 m; nose ~1,600 kg -> 15.7 kN / 0.10 m.
    springK_Npm: main ? 666000 : 157000,
    dampingC_Nspm: main ? 73000 : 16000, // zeta ~0.5
    travel_m: main ? 0.28 : 0.22,
    staticFriction: 0.8,
    dynamicFriction: 0.6,
    rollingFriction: 0.015,
    brake: main ? (y < 0 ? 'left' : 'right') : null,
    brakeCoeff: main ? 0.55 : 0,
    // BCA: pedals +/-7.5 deg, tiller 80-81 deg (OG 14-3: 7 / 81 deg).
    steerable: !main,
    maxSteer_deg: main ? 0 : 81,
    castering: false,
    retractable: true,
  };
}

function structure(name: string, p: [number, number, number]): GearContactConfig {
  return {
    name,
    position_m: p,
    gearIndex: -1,
    springK_Npm: 1500000,
    dampingC_Nspm: 120000,
    travel_m: 0.1,
    staticFriction: 0.6,
    dynamicFriction: 0.5,
    rollingFriction: 0.4,
    brake: null,
    brakeCoeff: 0,
    steerable: false,
    maxSteer_deg: 0,
    castering: false,
    retractable: false,
    isStructure: true,
  };
}

// ------------------------------------------------------------------ aerodynamics

/*
 * Lift: aspect ratio 21.0^2 / 49.9 = 8.84, quarter-chord sweep 26.8/28.6 deg (WIKI).
 * DATCOM/Helmbold with half-chord sweep ~25 deg: 2 pi A / (2 + sqrt(A^2 (1 + tan^2 L) + 4)) = 4.65 /rad,
 * plus fuselage/tail lift ~+5 % -> 0.085 /deg (EST). No leading-edge devices (BCA). CL peaks are tuned so
 * the 1-g trimmed stall speeds match FPG p.26 (tests/aircraft/citation-longitude/performance.test.ts).
 */
const ALPHAS = [-180, -90, -30, -20, -14, -10, -5, 0, 4, 8, 10, 11, 12, 13, 14, 15, 16, 18, 20, 25, 30, 45, 60, 90, 180];
function clColumn(cl0: number, slope: number, stall: number, peak: number): number[] {
  // Linear to stall-3, rounded to `peak` at `stall`, gradual post-stall drop (swept wing, no slats).
  return ALPHAS.map((a) => {
    if (a <= -90 || a >= 90) return a === 90 || a === -90 ? 0.05 * Math.sign(a) : 0;
    if (a === -30) return -0.8;
    if (a === -20) return -0.85;
    if (a === -14) return -0.95;
    if (a <= stall - 3) return cl0 + slope * a;
    if (a <= stall) {
      const lin3 = cl0 + slope * (stall - 3);
      const t = (a - (stall - 3)) / 3;
      return lin3 + (peak - lin3) * (1 - (1 - t) * (1 - t));
    }
    const d = a - stall;
    if (d <= 6) return peak - 0.04 * d - 0.004 * d * d;
    if (a <= 30) return Math.max(0.9, peak - 0.34 - 0.01 * (a - stall - 6));
    if (a <= 45) return 1.0;
    return 0.85 - (a - 60) * 0.0283;
  });
}
export const CL_TUNE = {
  f0: { cl0: 0.22, stall: 13, peak: 1.09 },
  f7: { cl0: 0.45, stall: 12.5, peak: 1.37 },
  f15: { cl0: 0.62, stall: 12, peak: 1.47 },
  f35: { cl0: 0.94, stall: 11, peak: 1.76 },
};
const SLOPE = 0.085;
const CL_F0 = clColumn(CL_TUNE.f0.cl0, SLOPE, CL_TUNE.f0.stall, CL_TUNE.f0.peak);
const CL_F7 = clColumn(CL_TUNE.f7.cl0, SLOPE, CL_TUNE.f7.stall, CL_TUNE.f7.peak);
const CL_F15 = clColumn(CL_TUNE.f15.cl0, SLOPE, CL_TUNE.f15.stall, CL_TUNE.f15.peak);
const CL_F35 = clColumn(CL_TUNE.f35.cl0, SLOPE, CL_TUNE.f35.stall, CL_TUNE.f35.peak);

export const CITATION_LONGITUDE_FDM: FdmConfig = {
  aero: {
    wingArea_m2: WING_AREA_M2,
    span_m: SPAN_M,
    mac_m: MAC_M,
    refPoint_m: [MAC_LE_X - 0.25 * MAC_M, 0, WING_Z], // 25 % MAC
    CL: {
      x: ALPHAS,
      y: [0, 7, 15, 35],
      z: ALPHAS.map((_, i) => [CL_F0[i], CL_F7[i], CL_F15[i], CL_F35[i]]),
    },
    // Conventional elevator on a T-tail (cable driven, OG 15-2; EST effectiveness from tail volume ~0.75).
    CL_de: -0.2,
    CL_q: 6.5,
    CL_alphadot: 2.5,
    CL_spoiler: -0.12, // speedbrake panels (4 of 6) at full flight deflection (EST)
    CL_groundSpoiler: -0.35, // all six panels at 60 deg (OG 15-5): lift dump (EST)
    groundEffectDrag: { x: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0], y: [0.3, 0.45, 0.72, 0.91, 0.954, 0.985, 1.0] },
    groundEffectLift: { x: [0, 0.1, 0.2, 0.3, 0.5, 1.0], y: [1.1, 1.06, 1.03, 1.015, 1.004, 1.0] },
    CL_mach: { x: [0, 0.4, 0.6, 0.7, 0.8, 0.85, 0.9], y: [1, 1.04, 1.1, 1.14, 1.16, 1.12, 1.02] },
    // Drag: CD0 clean calibrated to the FPG cruise fuel flows; flap increments EST (single-slotted Fowler).
    CD0: { x: [0, 7, 15, 35], y: [0.0191, 0.026, 0.038, 0.077] },
    CDi_k: { x: [0, 7, 15, 35], y: [0.06, 0.047, 0.045, 0.044] }, // clean k calibrated to the FPG high-altitude fuel flows (includes lift-dependent compressibility/trim drag; e_eff ~0.6); flaps 1/(pi A e), e ~0.8 (EST)
    // Supercritical ~28 deg swept wing: drag divergence ~M0.84 (Mmo), EST.
    CD_mach: { x: [0, 0.7, 0.76, 0.8, 0.82, 0.84, 0.86, 0.88, 0.92], y: [0, 0, 0.0003, 0.0008, 0.0014, 0.0026, 0.0055, 0.011, 0.035] },
    CD_gear: 0.018, // EST
    CD_spoiler: 0.05, // EST: 4 flight panels at 35 deg (OG 15-4)
    CD_speedbrake: 0,
    CD_groundSpoiler: 0.06,
    CD_beta: 0.3,
    CY_beta: -0.8,
    CY_dr: -0.15,
    Cl_beta: -0.1, // sweep + low-wing dihedral effect (EST)
    Cl_p: -0.45,
    Cl_r: 0.14,
    // Cable ailerons (OG 15-3) + roll spoilers (OG 15-3, BCA). EST: combined full-wheel pb/2V ~0.11 with Cl_p -0.45
    // (Roskam Part VI business-jet class: Cl_da ~0.15 /rad over ~+/-12 deg effective; roll spoilers about 3/4 of the
    // aileron). Was 0.05 + 0.05 (pb/2V 0.22, 100 deg/s at 150 KIAS); retuned in the check-ride pass.
    Cl_da: 0.028,
    Cl_dr: -0.008,
    Cl_spoiler: 0.022,
    Cl_trim: 0.004, // electric aileron trim tab (OG 15-3)
    // Static margin EST 25 % MAC between the 25 % MAC ref point and the neutral point.
    Cm_alpha: { x: [-30, -14, 0, 13, 16, 20, 30, 45, 90], y: [0.55, 0.28, 0, -0.26, -0.33, -0.44, -0.62, -0.8, -1.0] },
    Cm0: 0.02,
    Cm_q: -24,
    Cm_alphadot: -8,
    Cm_de: 0.95,
    Cm_trim: 0.55, // electric horizontal stabilizer trim (OG 15-2; -7..0 deg, OG 17-3 chart), EST effectiveness
    Cm_flap: { x: [0, 7, 15, 35], y: [0, -0.03, -0.055, -0.12] }, // BCA: large nose-down pitch change with FULL
    Cm_gear: 0.004,
    Cm_spoiler: 0.01,
    Cm_mach: { x: [0, 0.8, 0.84, 0.88, 0.92], y: [0, 0, -0.003, -0.015, -0.04] }, // EST: mild tuck beyond Mmo (Mach trim not modelled separately)
    Cn_beta: 0.12,
    Cn_p: -0.02,
    Cn_r: -0.18,
    Cn_da: -0.004,
    Cn_dr: 0.09,
    Cn_trim: 0.012,
    alphaStall_deg: { x: [0, 7, 15, 35], y: [CL_TUNE.f0.stall, CL_TUNE.f7.stall, CL_TUNE.f15.stall, CL_TUNE.f35.stall] },
    buffetMach: 0.88, // EST: buffet onset above Mmo 0.84
  },
  mass: {
    // FPG p.3: typically-equipped empty weight 23,200 lb; 100 lb unusable fuel (EST) is carried in the tanks instead.
    emptyMass_kg: (LON_LIMITS.emptyLb - 100) * LB,
    emptyCg_m: [0, 0, 0],
    // EST, Roskam Part V radii of gyration (business jets, aft engines): Ixx = m (b Rx/2)^2 Rx 0.26;
    // Iyy = m (L Ry/2)^2, L 22.3 m, Ry 0.32; Izz = m ((b+L)/2 Rz/2)^2, Rz 0.44 (m = 10,478 kg empty).
    Ixx: 78000,
    Iyy: 133000,
    Izz: 238000,
    Ixz: 3000,
    maxTakeoffMass_kg: LON_LIMITS.mtowLb * LB,
    maxLandingMass_kg: LON_LIMITS.mlwLb * LB,
    maxZeroFuelMass_kg: LON_LIMITS.mzfwLb * LB,
    macLeadingEdge_m: MAC_LE_X,
    tanks: [
      // AW / FPG: two integral wing tanks, 7,250 lb usable each (+ 50 lb unusable EST). Centroid EST at 3.3 m span,
      // 0.2 m ahead of the empty CG (swept box).
      { name: 'Left wing', position_m: [0.2, -3.3, WING_Z], capacity_kg: (LON_LIMITS.tankUsableLb + 50) * LB, unusable_kg: 50 * LB },
      { name: 'Right wing', position_m: [0.2, 3.3, WING_Z], capacity_kg: (LON_LIMITS.tankUsableLb + 50) * LB, unusable_kg: 50 * LB },
    ],
    stations: [
      // FPG p.3: BOW includes 2 crew & stores (400 lb). Cockpit seats EST 7.4 m ahead of the CG.
      { name: 'Pilot', position_m: [7.4, -0.5, -0.2], defaultMass_kg: 200 * LB, maxMass_kg: 300 * LB },
      { name: 'Copilot', position_m: [7.4, 0.5, -0.2], defaultMass_kg: 200 * LB, maxMass_kg: 300 * LB },
      // Cabin 25 ft 2 in (FPG p.2) from ~5.9 m to ~-1.8 m: double club (8 seats) + aft seats (EST positions).
      { name: 'Forward club (4)', position_m: [4.6, 0, 0], defaultMass_kg: 0, maxMass_kg: 800 * LB },
      { name: 'Aft club (4)', position_m: [2.2, 0, 0], defaultMass_kg: 0, maxMass_kg: 800 * LB },
      { name: 'Aft cabin seats (3)', position_m: [0.2, 0, 0], defaultMass_kg: 0, maxMass_kg: 600 * LB },
      // FPG p.2: baggage 112 ft^3 / 1,115 lb, walk-in aft of the cabin (EST centroid).
      { name: 'Aft baggage', position_m: [-3.4, 0, 0.1], defaultMass_kg: 0, maxMass_kg: 1115 * LB },
    ],
  },
  engines: [htf7700l('Left HTF7700L', -1), htf7700l('Right HTF7700L', 1)],
  gear: [
    wheel('Nose', NOSE_X, 0, 0, false),
    wheel('Left main', MAIN_X, -HALF_TREAD, 1, true),
    wheel('Right main', MAIN_X, HALF_TREAD, 2, true),
    // Aft fuselage lower skin at the tail-strike point: ~12.5 deg pitch on the main wheels (EST, typical).
    structure('Tail cone', [-10.5, 0, -0.35]),
    // Winglet tips: 5 deg dihedral EST, wing 0.6 m below datum at the root.
    structure('Left winglet', [-3.8, -SPAN_M / 2, WING_Z - 9.4 * Math.tan((5 * Math.PI) / 180) - 0.5]),
    structure('Right winglet', [-3.8, SPAN_M / 2, WING_Z - 9.4 * Math.tan((5 * Math.PI) / 180) - 0.5]),
    structure('Left nacelle', [-5.6, -2.1, 0.0]),
    structure('Right nacelle', [-5.6, 2.1, 0.0]),
    structure('Belly', [2.0, 0, 1.05]),
    structure('Nose', [10.4, 0, 0.6]),
  ],
  eyeHeightOnGround_m: 2.55, // EST
  radioAltOffset_m: GEAR_Z - MAIN_STATIC_DEFLECTION,
  limits: {
    vmo_kt: LON_LIMITS.vmoKt,
    mmo: LON_LIMITS.mmo,
    maxLoadFactor: LON_LIMITS.nzMaxClean, // OG 1-4: +2.6 g flaps up
    minLoadFactor: LON_LIMITS.nzMinClean, // OG 1-4: -1.0 g
    maxSinkRateOnGround_fpm: 900, // EST: 1.5 x the 600 fpm landing limit (OG 1-4)
  },
};

export default CITATION_LONGITUDE_FDM;
