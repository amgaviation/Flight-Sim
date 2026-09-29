/**
 * Flight-dynamics configuration of the Gulfstream G650 (GVI, 2 x Rolls-Royce
 * BR700-725A1-12). Sources are abbreviated as in data.ts (TCDS, LIM, AIN, LUC,
 * GAC, TCDSE); every estimate is marked EST with its reasoning.
 *
 * Body frame (physics convention): origin = empty-weight CG with the gear
 * down, x forward, y right, z down. The TCDS gives the datum (100 in ahead
 * of the radome) and the MAC (4.756 m) but no station of the MAC or the
 * gear, so the longitudinal layout is built from the GAC three-view numbers
 * (length 30.41 m, span 30.36 m, height 7.82 m) and EST proportions of
 * aft-engine long-range business jets, noted below.
 *
 * Calibration targets (tests/aircraft/g650/performance.test.ts):
 *  - Stall: 1-g KCAS from the CLMAX EST of data.ts (VSR f20 110 kt at
 *    67,084 lb -> V2 124 (AIN); VSR f39 114 kt at MLW -> VREF 140 (LIM)).
 *  - Takeoff: balanced field 5,858 ft at MTOW SL ISA (GAC); VR 107 / V2 124
 *    at 67,084 lb (AIN).
 *  - Climb: 15 min to FL430 at 67,084 lb (AIN).
 *  - Cruise: FL450 ISA-7 M0.91 (513 KTAS), 1,480 lb/h per engine at ~64,500 lb (AIN).
 */
import type { FdmConfig, GearContactConfig, Table2D, TurbofanConfig } from '../../physics/types';
import { isaPressure, isaTemperature } from '../../physics/atmosphere';
import { FT_TO_M } from '../../core/units';
import { CLMAX, G650_LIMITS, LB, LBF, WING_AREA_M2 } from './data';

// ------------------------------------------------------------------ geometry

/** GAC: span 99 ft 7 in (30.36 m). */
export const SPAN_M = 30.36;
/** TCDS §16: MAC 4.756 m (187.24 in). */
export const MAC_M = 4.756;
/** GAC: overall length 99 ft 9 in (30.41 m). */
export const LENGTH_M = 30.41;
/**
 * Empty CG EST at 40 % MAC: the MZFW CG envelope spans 36.5-45 % MAC (LUC
 * fuel, AFM 01-03-70); an aft-engine jet's empty CG sits in its aft part.
 */
export const EMPTY_CG_PCT_MAC = 40;
export const MAC_LE_X = (EMPTY_CG_PCT_MAC / 100) * MAC_M; // MAC leading edge 1.90 m ahead of the empty CG
/** Low wing: chord plane ~1.0 m below the fuselage centreline (EST, cabin floor over the wing box). */
const WING_Z = 1.0;
/** EST: nose tip 16.7 m ahead of the empty CG (CG at ~55 % of the length, aft-engine jets). */
export const NOSE_X = 16.7;

// ------------------------------------------------------------------ engine

/**
 * Thrust lapse EST for a BPR 4.2 two-spool turbofan (BR725, TCDSE / LIM
 * "4.18:1 bypass ratio"): F/F0 = delta^a (1 - b M + c M^2) / theta^0.5,
 * calibrated so the climb (AIN 15 min to FL430) and the M0.91 FL450 cruise
 * point (AIN) are reproduced with the TSFC below.
 */
export const LAPSE_A = 0.92;
export const LAPSE_B = 0.5;
export const LAPSE_C = 0.4;
function lapseTable(): Table2D {
  const machs = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
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
 * Corrected N1 (%) giving the rated 16,900 lbf at sea-level ISA static. EST
 * 96 %: the engine is flat rated to 30 degC (LIM: 16,100 lbf at 30 degC); at
 * 30 degC the same corrected speed needs 96 x sqrt(303.15/288.15) = 98.5 %
 * physical N1, inside the 102.8 % takeoff limit (LIM engine table).
 */
export const N1_RATED_PCT = 96;

export function br725(name: string, side: -1 | 1): TurbofanConfig {
  return {
    kind: 'turbofan',
    name,
    // Pylon-mounted on the aft fuselage: nacelle centre ~22 m aft of the nose (EST from the three-view, inlet
    // just aft of the wing trailing edge), 2.9 m outboard (fuselage radius 1.5 m + pylon + nacelle radius 0.7 m),
    // thrust line 0.9 m above the fuselage centreline (EST).
    position_m: [NOSE_X - 22.0, side * 2.9, -0.9],
    thrustAxis: [1, 0, 0],
    maxThrust_N: G650_LIMITS.takeoffThrustLbf * LBF, // TCDSE: 75.2 kN MTO, 16,900 lbf SL static
    thrustLapse: lapseTable(),
    n1Max_pct: N1_RATED_PCT,
    n1Idle_pct: 24, // EST: BR700-family ground idle LP ~22-26 %
    n2Idle_pct: 62, // EST: BR700-family ground idle HP ~60-63 %
    n2Max_pct: 97.5, // EST: HP at rated LP; limit 100 % takeoff (LIM)
    // Net thrust fraction vs corrected-N1 fraction (EST high-bypass curve; > 1 for the high-altitude ratings).
    thrustVsN1: { x: [0, 0.2, 0.25, 0.4, 0.6, 0.8, 0.9, 1.0, 1.05, 1.1], y: [0, 0.015, 0.03, 0.08, 0.23, 0.5, 0.72, 1.0, 1.15, 1.3] },
    spoolUpTau_s: { x: [0, 20, 62, 75, 88, 97], y: [4, 3.5, 2.4, 1.5, 1.0, 0.75] }, // EST: ~7 s idle -> TO (14 CFR 33.73 class, larger fan)
    spoolDownTau_s: { x: [0, 62, 97], y: [3, 2.6, 1.5] },
    // TSFC kg/(N h) vs N1 fraction: 0.0375 at rated = 0.368 lb/lbf/h SL static (EST, BPR 4.2 class); Mach factor
    // calibrated to the AIN cruise fuel flow (0.63 lb/lbf/h installed at M0.91 FL450).
    tsfc: { x: [0, 0.25, 0.5, 0.8, 1.0, 1.1], y: [0.1, 0.08, 0.052, 0.04, 0.0375, 0.0375] },
    tsfcMachFactor: 0.93,
    idleFuelFlow_pph: 480, // EST: ground idle per engine (scaled from HTF7000-class 260 pph by thrust class)
    ittIdle_c: 440, // EST ground-idle TGT
    ittMax_c: 845, // EST: TGT at rated thrust SL ISA, below the 900 degC takeoff limit (LIM)
    ittStartPeak_c: 560, // EST: FADEC-scheduled start well below the 700 degC ground-start limit (LIM)
    starterMaxN2_pct: 25, // EST: ATS on 40 psi bleed (LUC minimum start bleed)
    lightOffN2_pct: 16, // EST: fuel introduced at ~16-18 % HP
    startToIdle_s: 28, // EST: auto start ~40 s from button to idle
    oilPressIdle_psi: 50, // EST: above the 35 psid take-off minimum below 72.3 % HP (LIM)
    oilPressMax_psi: 85, // EST
    oilTempNormal_c: 95, // EST
    reverseEfficiency: 0.4, // EST: BR725 target-type reverser ~40 % of forward thrust
    bleedPressMax_psi: 90, // EST: 8th stage at max HP
    windmillN1PerKt: 0.075, // EST (windmill airstart 250-340 KCAS, LIM)
    windmillN2PerKt: 0.04,
    starterTau_s: 4,
    selfSustainN2_pct: 36, // EST: core self-sustaining below the 42 % HP starter cut-out (LIM)
    ittStartLimit_c: G650_LIMITS.tgtStartGroundC,
  };
}

// ------------------------------------------------------------------ gear

/**
 * Landing gear EST (no public G650 gear stations): wheelbase 13.5 m and main
 * track 4.4 m (scaled from the G550, 12.3 m / 4.17 m, by the longer G650
 * fuselage and wider wing root). Mains 1.08 m aft of the empty CG (8 % of
 * the weight on the twin nose wheels). Trailing-link mains, twin wheels on
 * every leg (TCDS §21 tyres). Springs give ~0.12 m static deflection at MTOW.
 */
export const WHEELBASE_M = 13.5;
export const TRACK_M = 4.4;
export const MAIN_X = -1.08;
export const NOSE_GEAR_X = MAIN_X + WHEELBASE_M;
/** EST: contact point with the struts extended: fuselage centreline ~2.35 m above the ramp when parked. */
const GEAR_Z = 2.47;
const MAIN_STATIC_DEFLECTION = 0.12;

function wheel(name: string, x: number, y: number, idx: number, main: boolean): GearContactConfig {
  return {
    name,
    position_m: [x, y, GEAR_Z],
    gearIndex: idx,
    // MTOW 45,177 kg: mains ~20,800 kg each -> 204 kN / 0.12 m; nose ~3,600 kg -> 35 kN / 0.10 m.
    springK_Npm: main ? 1700000 : 350000,
    dampingC_Nspm: main ? 290000 : 55000, // zeta ~0.5 (EST)
    travel_m: main ? 0.32 : 0.26,
    staticFriction: 0.8,
    dynamicFriction: 0.6,
    rollingFriction: 0.015,
    brake: main ? (y < 0 ? 'left' : 'right') : null,
    brakeCoeff: main ? 0.55 : 0,
    // Steer-by-wire: tiller 80 deg, pedals 7 deg (LUC landing gear, AIN).
    steerable: !main,
    maxSteer_deg: main ? 0 : 80,
    castering: false,
    retractable: true,
  };
}

function structure(name: string, p: [number, number, number]): GearContactConfig {
  return {
    name,
    position_m: p,
    gearIndex: -1,
    springK_Npm: 3000000,
    dampingC_Nspm: 250000,
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
 * Lift: aspect ratio 30.36^2 / 119.2 = 7.73, 36 deg leading-edge sweep (GAC),
 * half-chord sweep ~30 deg: Helmbold 2 pi A / (2 + sqrt(A^2 (1 + tan^2 L) + 4)) = 4.36 /rad,
 * plus fuselage/tail lift ~+5 % -> 0.080 /deg (EST). No leading-edge devices; single-slotted
 * Fowler flaps 10/20/39 deg (LUC). The CL peaks are tuned so the 1-g trimmed stall speeds
 * match the CLMAX EST of data.ts (performance.test.ts).
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
/**
 * CL build-up per flap setting. `peak` is tuned so the trimmed 1-g stall (idle, 1 kt/s, DIRECT law;
 * performance.test.ts) reproduces the CLMAX EST of data.ts: the whole-aircraft lift at the stall AoA
 * (pitch-rate / alpha-dot and elevator terms of the deceleration) exceeds the wing table peak by ~4 %.
 */
export const CL_TUNE = {
  f0: { cl0: 0.17, stall: 13, peak: CLMAX.f0 - 0.04 },
  f10: { cl0: 0.38, stall: 12.5, peak: CLMAX.f10 - 0.045 },
  f20: { cl0: 0.5, stall: 12, peak: CLMAX.f20 - 0.05 },
  f39: { cl0: 0.78, stall: 11, peak: CLMAX.f39 - 0.055 },
};
const SLOPE = 0.08;
const CL_F0 = clColumn(CL_TUNE.f0.cl0, SLOPE, CL_TUNE.f0.stall, CL_TUNE.f0.peak);
const CL_F10 = clColumn(CL_TUNE.f10.cl0, SLOPE, CL_TUNE.f10.stall, CL_TUNE.f10.peak);
const CL_F20 = clColumn(CL_TUNE.f20.cl0, SLOPE, CL_TUNE.f20.stall, CL_TUNE.f20.peak);
const CL_F39 = clColumn(CL_TUNE.f39.cl0, SLOPE, CL_TUNE.f39.stall, CL_TUNE.f39.peak);

/** Stall AoA (deg) vs flaps, used by the stall warning and the FBW AoA limiter. */
export const ALPHA_STALL = { x: [0, 10, 20, 39], y: [CL_TUNE.f0.stall, CL_TUNE.f10.stall, CL_TUNE.f20.stall, CL_TUNE.f39.stall] };

export const G650_FDM: FdmConfig = {
  aero: {
    wingArea_m2: WING_AREA_M2,
    span_m: SPAN_M,
    mac_m: MAC_M,
    refPoint_m: [MAC_LE_X - 0.25 * MAC_M, 0, WING_Z], // 25 % MAC
    CL: {
      x: ALPHAS,
      y: [0, 10, 20, 39],
      z: ALPHAS.map((_, i) => [CL_F0[i], CL_F10[i], CL_F20[i], CL_F39[i]]),
    },
    // FBW elevators on a T-tail with a movable stabilizer (LUC). EST effectiveness from the tail volume.
    CL_de: -0.25,
    CL_q: 7.0,
    CL_alphadot: 2.8,
    CL_spoiler: -0.14, // six panels at the 30 deg in-flight speed brake limit (LUC), EST
    CL_groundSpoiler: -0.4, // six panels at 55 deg (flaps >= 10, LUC): lift dump, EST
    groundEffectDrag: { x: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0], y: [0.3, 0.45, 0.72, 0.91, 0.954, 0.985, 1.0] },
    // EST: low-wing in extreme proximity (h/b ~0.08 at rotation); raised from 1.10 in fix round 1 so lift-off
    // follows the rotation more promptly (audit F17). Note: with VR below the 1-g VS at flaps 20 (dossier §3,
    // FAR 25 speeds), lift-off physically occurs near 1.10-1.15 VS1g ~ V2, not at VR+5 - see dossier §15.
    groundEffectLift: { x: [0, 0.1, 0.2, 0.3, 0.5, 1.0], y: [1.16, 1.1, 1.05, 1.02, 1.005, 1.0] },
    CL_mach: { x: [0, 0.4, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95], y: [1, 1.03, 1.08, 1.12, 1.15, 1.16, 1.12, 1.02] },
    // Drag: CD0 clean calibrated to the AIN cruise point; flap increments EST (single-slotted Fowler).
    CD0: { x: [0, 10, 20, 39], y: [0.0158, 0.027, 0.04, 0.085] },
    CDi_k: { x: [0, 10, 20, 39], y: [0.056, 0.047, 0.045, 0.044] }, // clean incl. lift-dependent compressibility/trim drag (e_eff ~0.74), flaps e ~0.9 (EST)
    // Mmo 0.925 wing (TCDS): drag divergence just above Mmo, EST.
    CD_mach: { x: [0, 0.78, 0.84, 0.88, 0.9, 0.92, 0.935, 0.95, 0.98], y: [0, 0, 0.0003, 0.0007, 0.0011, 0.0021, 0.0038, 0.008, 0.025] },
    CD_gear: 0.016, // EST
    CD_spoiler: 0.045, // EST: six panels at 30 deg
    CD_speedbrake: 0,
    CD_groundSpoiler: 0.07,
    CD_beta: 0.3,
    CY_beta: -0.85,
    CY_dr: -0.16,
    Cl_beta: -0.1, // sweep + low-wing dihedral effect (EST)
    Cl_p: -0.45,
    Cl_r: 0.14,
    Cl_da: 0.05,
    Cl_dr: -0.008,
    Cl_spoiler: 0.06, // roll spoilers (mid + outboard up to 55 deg, LUC)
    Cl_trim: 0.004, // aileron trim (FCC roll trim, LUC)
    // Static margin EST ~22 % MAC between the 25 % MAC ref point and the neutral point.
    Cm_alpha: { x: [-30, -14, 0, 13, 16, 20, 30, 45, 90], y: [0.5, 0.25, 0, -0.23, -0.3, -0.4, -0.58, -0.78, -1.0] },
    Cm0: 0.02,
    Cm_q: -26,
    Cm_alphadot: -9,
    Cm_de: 1.15, // EST (raised from 1.0 in fix round 1: crisper rotation response; tail volume class)
    Cm_trim: 0.6, // horizontal stabilizer (HSTA, 0.4 deg/s normal rate, LUC), EST effectiveness over the normalized range
    Cm_flap: { x: [0, 10, 20, 39], y: [0, -0.035, -0.06, -0.13] },
    Cm_gear: 0.004,
    Cm_spoiler: 0.012,
    Cm_mach: { x: [0, 0.85, 0.9, 0.93, 0.96], y: [0, 0, -0.003, -0.01, -0.03] }, // EST: mild tuck beyond Mmo
    Cn_beta: 0.13,
    Cn_p: -0.02,
    Cn_r: -0.19,
    Cn_da: -0.004,
    Cn_dr: 0.09,
    Cn_trim: 0.012,
    alphaStall_deg: ALPHA_STALL,
    buffetMach: 0.96, // EST: buffet onset above Mmo 0.925 (Vd/Md margin)
  },
  mass: {
    // BOW 54,000 lb (EST, data.ts) minus 2 crew x 200 lb (default stations) minus 2 x 50 lb unusable fuel (in the tanks).
    emptyMass_kg: (G650_LIMITS.bowLb - 400 - 2 * G650_LIMITS.tankUnusableLb) * LB,
    emptyCg_m: [0, 0, 0],
    // EST, Roskam Part V radii of gyration (business jets, aft engines), m = 24,270 kg empty:
    // Ixx = m (b Rx / 2)^2, Rx 0.26 -> 3.95 m; Iyy = m (L Ry / 2)^2, L 30.41 m, Ry 0.32 -> 4.87 m;
    // Izz = m ((b + L) / 2 Rz / 2)^2, Rz 0.44 -> 6.69 m. Fuel and payload add their own point masses.
    Ixx: 379000,
    Iyy: 575000,
    Izz: 1086000,
    Ixz: 15000,
    maxTakeoffMass_kg: G650_LIMITS.mtowLb * LB,
    maxLandingMass_kg: G650_LIMITS.mlwLb * LB,
    maxZeroFuelMass_kg: G650_LIMITS.mzfwLb * LB,
    macLeadingEdge_m: MAC_LE_X,
    tanks: [
      // TCDS §9: two integral wing tanks, 22,100 lb usable each (+50 lb unusable EST). Centroid EST 4.5 m
      // outboard, 0.5 m aft of the empty CG (36 deg swept box), in the wing chord plane.
      { name: 'Left wing', position_m: [-0.5, -4.5, WING_Z], capacity_kg: (G650_LIMITS.tankUsableLb + G650_LIMITS.tankUnusableLb) * LB, unusable_kg: G650_LIMITS.tankUnusableLb * LB },
      { name: 'Right wing', position_m: [-0.5, 4.5, WING_Z], capacity_kg: (G650_LIMITS.tankUsableLb + G650_LIMITS.tankUnusableLb) * LB, unusable_kg: G650_LIMITS.tankUnusableLb * LB },
    ],
    stations: [
      // Cockpit seats EST 13.9 m ahead of the empty CG (2.8 m aft of the nose tip).
      { name: 'Pilot', position_m: [NOSE_X - 2.8, -0.55, -0.1], defaultMass_kg: 200 * LB, maxMass_kg: 300 * LB },
      { name: 'Copilot', position_m: [NOSE_X - 2.8, 0.55, -0.1], defaultMass_kg: 200 * LB, maxMass_kg: 300 * LB },
      // Cabin 46 ft 10 in (GAC) in four living areas (EST positions): forward club, conference, aft club, divan.
      { name: 'Forward club (4)', position_m: [8.5, 0, 0.2], defaultMass_kg: 0, maxMass_kg: 800 * LB },
      { name: 'Mid cabin (6)', position_m: [4.5, 0, 0.2], defaultMass_kg: 0, maxMass_kg: 1200 * LB },
      { name: 'Aft cabin (6)', position_m: [0.5, 0, 0.2], defaultMass_kg: 0, maxMass_kg: 1200 * LB },
      { name: 'Aft stateroom (3)', position_m: [-2.5, 0, 0.2], defaultMass_kg: 0, maxMass_kg: 600 * LB },
      // GAC: baggage 195 ft^3, internal aft of the cabin, accessible in flight (EST centroid; 2,500 lb EST limit).
      { name: 'Baggage', position_m: [-4.8, 0, 0.3], defaultMass_kg: 0, maxMass_kg: 2500 * LB },
    ],
  },
  engines: [br725('Left BR725', -1), br725('Right BR725', 1)],
  gear: [
    wheel('Nose', NOSE_GEAR_X, 0, 0, false),
    wheel('Left main', MAIN_X, -TRACK_M / 2, 1, true),
    wheel('Right main', MAIN_X, TRACK_M / 2, 2, true),
    // Aft fuselage lower skin at the tail-strike point: ~13 deg pitch on the main wheels (AIN: rotation to 9-12 deg).
    structure('Tail cone', [MAIN_X - 9.9, 0, 0.05]),
    // Winglet tips: 3 deg dihedral EST (+2.81 deg quoted for the fuel system, LUC), wing 1.0 m below the centreline at the root.
    structure('Left winglet', [-6.0, -SPAN_M / 2, WING_Z - 13.7 * Math.tan((3 * Math.PI) / 180) - 1.0]),
    structure('Right winglet', [-6.0, SPAN_M / 2, WING_Z - 13.7 * Math.tan((3 * Math.PI) / 180) - 1.0]),
    structure('Left nacelle', [NOSE_X - 24.2, -2.9, -0.2]),
    structure('Right nacelle', [NOSE_X - 24.2, 2.9, -0.2]),
    structure('Belly', [3.0, 0, 1.45]),
    structure('Nose', [NOSE_X - 0.3, 0, 0.7]),
  ],
  eyeHeightOnGround_m: 3.35, // EST: pilot eye ~1.0 m above the cockpit floor, floor ~2.35 m above the ramp
  radioAltOffset_m: GEAR_Z - MAIN_STATIC_DEFLECTION,
  limits: {
    vmo_kt: G650_LIMITS.vmoKt,
    mmo: G650_LIMITS.mmo,
    maxLoadFactor: G650_LIMITS.nzMaxClean, // LIM: +2.5 g flaps 0
    minLoadFactor: G650_LIMITS.nzMinClean, // LIM: -1.0 g
    maxSinkRateOnGround_fpm: 900, // EST: 1.5 x the 600 fpm design sink rate (14 CFR 25.473 10 ft/s)
  },
};

export default G650_FDM;
