/**
 * Flight-dynamics configuration of the Bombardier Global 6000 (BD-700-1A10,
 * 2 x Rolls-Royce BR700-710A2-20). Sources are abbreviated as in data.ts
 * (TCDS, SPEC, GXAG, GXFC, AOPA); every estimate is marked EST.
 *
 * Body frame (physics convention): origin = datum = empty-weight CG with the
 * gear down, x forward, y right, z down. The TCDS datum (FS 0 = 144 in ahead
 * of the nose) is not used as the FDM origin; station numbers below are
 * converted from the GXAG three-view: length 30.30 m, span 28.65 m (94 ft),
 * height 7.77 m, wheelbase 13.06 m (max), main gear track 4.18 m, fuselage
 * diameter 2.69 m, horizontal tail span 9.68 m, wing root chord 6.43 m /
 * tip chord 1.24 m, dihedral 2.5 deg.
 *
 * Calibration targets (tests/aircraft/global6000/performance.test.ts):
 *  - 1-g stall speeds (EST from CLmax, data.ts CLMAX; the AFM tables are not
 *    public): VS1G at 78,600 lb = 100 KCAS slats/flaps 30, 135 KCAS clean.
 *  - Take-off (SPEC): 6,476 ft at MTOW SL ISA (factored all-engine distance
 *    to 35 ft is compared, see the test).
 *  - Cruise (AOPA): FL410 M0.85 ~490 KTAS at 3,200 lb/h (EST mid weight
 *    78,000 lb; AOPA does not give the weight).
 *  - Climb (SPEC): initial cruise altitude 41,000 ft at MTOW.
 */
import type { FdmConfig, GearContactConfig, Table2D, TurbofanConfig } from '../../physics/types';
import { isaPressure, isaTemperature } from '../../physics/atmosphere';
import { FT_TO_M } from '../../core/units';
import { LB, LBF, G6K_LIMITS } from './data';

// ------------------------------------------------------------------ geometry

/** GXAG: equivalent wing area 1,022 ft^2 (94.95 m^2) incl. ailerons, flaps, spoilers and the area within the fuselage. */
export const WING_AREA_M2 = 94.95;
/** SPEC / GXAG schematic: wing span 94 ft 0 in (28.65 m) over the winglets. */
export const SPAN_M = 28.65;
/**
 * MAC EST: equivalent straight-tapered planform with S = 94.95 m^2, b = 28.65 m
 * and taper 0.20 (GXAG tip chord 1.24 m): c_r = 2S/(b(1+l)) = 5.52 m,
 * MAC = 2/3 c_r (1+l+l^2)/(1+l) = 3.80 m.
 */
export const MAC_M = 3.8;
/** Empty CG EST at 28 % MAC (aft-engine long-range jet; the AFM CG envelope is not public). */
export const EMPTY_CG_PCT_MAC = 28;
export const MAC_LE_X = (EMPTY_CG_PCT_MAC / 100) * MAC_M; // 1.06 m ahead of the datum
/** Low wing: chord plane ~0.8 m below the fuselage centreline / datum (EST, 2.69 m fuselage, wing box under the floor). */
const WING_Z = 0.8;

// ------------------------------------------------------------------ engine

/**
 * Thrust lapse EST for a BPR ~4 turbofan (BR710 class): F/F0 = delta^a
 * (1 - b M + c M^2) / theta^0.5, calibrated so the climb rating reaches
 * FL410 at MTOW (SPEC initial cruise altitude) and the cruise rating holds
 * M0.85 / M0.88 at FL410-FL450 (SPEC high-speed cruise M0.88).
 */
export const LAPSE_A = 0.8;
export const LAPSE_B = 0.5;
export const LAPSE_C = 0.4;
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
 * Corrected N1 (%) giving the rated 14,750 lbf at sea-level ISA static. EST
 * 96.5 %: the engine is flat rated to ISA + 20 C (SPEC); at 35 C the
 * corrected speed demands 96.5 x sqrt(308.15/288.15) = 99.8 % physical N1,
 * just inside the 102.0 % take-off limit (TCDS 3.2) with bleed margin.
 */
export const N1_RATED_PCT = 96.5;

export function br710(name: string, side: -1 | 1): TurbofanConfig {
  return {
    kind: 'turbofan',
    name,
    // Pylons on the aft fuselage (GXAG three-view): nacelle centre ~23.2 m aft of the nose tip = 9.3 m aft of the empty
    // CG, 2.45 m outboard (fuselage radius 1.35 m + pylon + 0.75 m nacelle radius), 0.95 m above the datum (EST).
    position_m: [-9.3, side * 2.45, -0.95],
    thrustAxis: [1, 0, 0],
    maxThrust_N: G6K_LIMITS.takeoffThrustLbf * LBF, // TCDS 3.2: 14,750 lbf (65.6 kN) SL static
    thrustLapse: lapseTable(),
    n1Max_pct: N1_RATED_PCT,
    n1Idle_pct: 24, // EST: BR710 ground idle N1 ~24 % (BR700 family, Gulfstream GV/G550 indications 22-26 %)
    n2Idle_pct: 60, // TCDS 3.2 idle range N2 58 % minimum; EST 60 %
    n2Max_pct: 98.5, // EST: N2 at rated N1, below the 99.6 % take-off limit (TCDS)
    // Net thrust fraction vs corrected-N1 fraction (EST high-bypass curve, extends past 1.0 for the flat rating).
    thrustVsN1: { x: [0, 0.2, 0.25, 0.4, 0.6, 0.8, 0.9, 1.0, 1.06, 1.1], y: [0, 0.012, 0.03, 0.085, 0.24, 0.52, 0.74, 1.0, 1.16, 1.27] },
    spoolUpTau_s: { x: [0, 20, 60, 72, 85, 98], y: [4, 3.6, 2.4, 1.5, 1.0, 0.75] }, // EST: ~6-7 s idle -> TO (14 CFR 33.73)
    spoolDownTau_s: { x: [0, 60, 98], y: [3, 2.6, 1.5] },
    // TSFC kg/(N h) vs N1 fraction: 0.0398 at rated = 0.39 lb/lbf/h SL static (EST BR710 class, BPR ~4). The Mach factor
    // is calibrated to the AOPA cruise fuel flow (0.64 lb/lbf/h class installed cruise TSFC at M0.85 / FL410).
    tsfc: { x: [0, 0.25, 0.5, 0.8, 1.0, 1.1], y: [0.12, 0.09, 0.058, 0.0425, 0.0398, 0.0398] },
    tsfcMachFactor: 1.0,
    idleFuelFlow_pph: 550, // EST: ground idle per engine for a 14,750 lbf-class turbofan (~3.7 % of TO fuel flow)
    ittIdle_c: 470, // EST
    ittMax_c: 830, // EST: ITT at rated thrust SL ISA, below the 860 / 900 C MCT / TO limits (TCDS)
    ittStartPeak_c: 560, // EST: FADEC-scheduled ground start below the 700 C limit (TCDS)
    starterMaxN2_pct: 28, // EST: air turbine starter on APU bleed (~45 psi, GXAPU) motors to ~26-30 % N2
    lightOffN2_pct: 15, // EST: FADEC fuel-on ~14-16 % N2
    startToIdle_s: 24, // EST: BR710 ground start light-off to idle ~25 s
    oilPressIdle_psi: 48, // EST: above the 35 psid idle lower limit (E018)
    oilPressMax_psi: 80, // EST
    oilTempNormal_c: 95, // EST
    reverseEfficiency: 0.4, // EST: clamshell/cascade reverser on the BR710 (Global) ~40 % of forward thrust at 70 % N1
    bleedPressMax_psi: 110, // EST: HP stage at max N2
    windmillN1PerKt: 0.08, // EST (physics test-jet class)
    windmillN2PerKt: 0.04,
    starterTau_s: 4,
    ittStartLimit_c: G6K_LIMITS.ittStartGroundC,
  };
}

// ------------------------------------------------------------------ gear

/**
 * Landing gear from GXAG: wheelbase 13.06 m (42 ft 10 in, max), main track
 * 4.18 m (13 ft 8 in); twin wheels on every leg, main tyres H38x12-19 (TCDS),
 * nose 21x7.25-10. Mains 1.0 m aft of the empty CG (EST: ~8 % of the weight on
 * the nose wheel). Contact points with the struts extended; springs give ~45 %
 * of travel at MTOW.
 */
export const MAIN_X = -1.0;
export const NOSE_X = MAIN_X + 13.06;
export const HALF_TRACK = 4.18 / 2;
/**
 * EST: fuselage centreline ~2.2 m above the ramp when parked (GXAG passenger door
 * sill at the floor line 1.63 m above the ground; floor ~0.55 m below the axis
 * of a 2.69 m fuselage), datum ~0.1 m below the axis.
 */
export const GEAR_Z = 2.25;
const MAIN_STATIC_DEFLECTION = 0.13;

function wheel(name: string, x: number, y: number, idx: number, main: boolean): GearContactConfig {
  return {
    name,
    position_m: [x, y, GEAR_Z],
    gearIndex: idx,
    // MTOW 45,132 kg: mains ~20,800 kg each -> 204 kN at 0.145 m; nose ~3,500 kg -> 34 kN at 0.12 m.
    springK_Npm: main ? 1400000 : 285000,
    dampingC_Nspm: main ? 170000 : 31000, // zeta ~0.5
    travel_m: main ? 0.34 : 0.28,
    staticFriction: 0.8,
    dynamicFriction: 0.6,
    rollingFriction: 0.015,
    brake: main ? (y < 0 ? 'left' : 'right') : null,
    brakeCoeff: main ? 0.55 : 0,
    // GXLG: tiller +/-75 deg (full authority), pedals +/-7.5 deg.
    steerable: !main,
    maxSteer_deg: main ? 0 : G6K_LIMITS.tillerMaxDeg,
    // GXLG: steering disarmed -> free caster with shimmy damping.
    castering: false,
    retractable: true,
  };
}

function structure(name: string, p: [number, number, number]): GearContactConfig {
  return {
    name,
    position_m: p,
    gearIndex: -1,
    springK_Npm: 2000000,
    dampingC_Nspm: 150000,
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
 * Lift: aspect ratio 28.65^2 / 94.95 = 8.64, quarter-chord sweep ~35 deg (Global wing, EST from the three-view).
 * DATCOM/Helmbold with half-chord sweep ~30 deg: 2 pi A / (2 + sqrt(A^2 (1 + tan^2 L) + 4)) = 4.46 /rad = 0.078 /deg,
 * + fuselage/tail lift ~5 % -> 0.082 /deg (EST). Leading-edge slats (4 segments per side, GXAG) add CL near the
 * stall only (Aerodynamics CL_slats ramp) and extend the stall AoA. CL peaks are tuned so the 1-g stall speeds match
 * data.ts CLMAX (tests/aircraft/global6000/performance.test.ts).
 */
const ALPHAS = [-180, -90, -30, -20, -14, -10, -5, 0, 4, 8, 10, 11, 12, 13, 14, 15, 16, 18, 20, 25, 30, 45, 60, 90, 180];
function clColumn(cl0: number, slope: number, stall: number, peak: number): number[] {
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
/** Flap columns (slats IN). The slats-out increment is CL_SLATS. Tuned in the stall-speed test. */
export const CL_TUNE = {
  f0: { cl0: 0.15, stall: 14, peak: 1.25 },
  // Flaps 6: cl0 0.8 / stall 9 (first calibration 0.62 / 11): the old curve gave CL ~1.4 at the ~9 deg lift-off AoA,
  // so the aircraft lifted off ~VR + 19 kt (V2 + 15) at 73,000 lb instead of reaching V2 by 35 ft (14 CFR 25.107(e),
  // found by the full-flight verification). CLmax (peak + slats = 1.87) is unchanged.
  f6: { cl0: 0.8, stall: 9, peak: 1.42 },
  f16: { cl0: 0.8, stall: 11, peak: 1.6 },
  // Flaps 30: cl0 lowered 0.25 (the curve reaches the same peak): AAIB report
  // on Global Express N618WF (EW/C2008/08/09): on the approach at ~121 KIAS "the pitch attitude varied by 2 deg either
  // side of a mean value of approximately 4 deg nose up", 8 deg at touchdown. The old curve (cl0 1.05, stall 10) flew the 3 deg glide path
  // at ~0.5-1 deg pitch (found by the full-flight verification). CLmax (peak + slats) and so the stall speeds are unchanged.
  f30: { cl0: 0.8, stall: 11, peak: 1.8 },
};
/** Slat CL increment at the stall: 1.70 - 1.25 slats out flaps 0 (data.ts CLMAX, EST). */
export const CL_SLATS = 0.45;
const SLOPE = 0.082;
const CL_F0 = clColumn(CL_TUNE.f0.cl0, SLOPE, CL_TUNE.f0.stall, CL_TUNE.f0.peak);
const CL_F6 = clColumn(CL_TUNE.f6.cl0, SLOPE, CL_TUNE.f6.stall, CL_TUNE.f6.peak);
const CL_F16 = clColumn(CL_TUNE.f16.cl0, SLOPE, CL_TUNE.f16.stall, CL_TUNE.f16.peak);
const CL_F30 = clColumn(CL_TUNE.f30.cl0, SLOPE, CL_TUNE.f30.stall, CL_TUNE.f30.peak);

/** Stall AoA (deg, slats in) vs flaps; the stall warning / pusher use it with the slat extension (StallWarning). */
export const ALPHA_STALL = { x: [0, 6, 16, 30], y: [CL_TUNE.f0.stall, CL_TUNE.f6.stall, CL_TUNE.f16.stall, CL_TUNE.f30.stall] };
/** Stall AoA with the slats out (alphaStall + CL_slats / CL_alpha), for the stall protection computer. */
export const ALPHA_STALL_SLATS = { x: ALPHA_STALL.x, y: ALPHA_STALL.y.map((a) => a + CL_SLATS / SLOPE) };

export const GLOBAL6000_FDM: FdmConfig = {
  aero: {
    wingArea_m2: WING_AREA_M2,
    span_m: SPAN_M,
    mac_m: MAC_M,
    refPoint_m: [MAC_LE_X - 0.25 * MAC_M, 0, WING_Z], // 25 % MAC
    CL: {
      x: ALPHAS,
      y: [0, 6, 16, 30],
      z: ALPHAS.map((_, i) => [CL_F0[i], CL_F6[i], CL_F16[i], CL_F30[i]]),
    },
    CL_slats: CL_SLATS,
    // Elevators on a T-tail with a trimmable stabilizer (GXFC). Tail volume EST: S_h 22.76 m^2 (GXAG) x arm ~14 m /
    // (S c) = 0.88.
    CL_de: -0.24,
    CL_q: 7.0,
    CL_alphadot: 2.8,
    CL_spoiler: -0.14, // 4 MFS pairs at full lift-dump deflection (EST)
    CL_groundSpoiler: -0.4, // all 12 panels at ground lift dumping (EST)
    groundEffectDrag: { x: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0], y: [0.3, 0.45, 0.72, 0.91, 0.954, 0.985, 1.0] },
    groundEffectLift: { x: [0, 0.1, 0.2, 0.3, 0.5, 1.0], y: [1.1, 1.06, 1.03, 1.015, 1.004, 1.0] },
    CL_mach: { x: [0, 0.4, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95], y: [1, 1.04, 1.1, 1.14, 1.17, 1.16, 1.08, 0.95] },
    // Drag: clean CD0 calibrated to the AOPA cruise fuel flow; flap increments EST (single-slotted Fowler, GXAG).
    CD0: { x: [0, 6, 16, 30], y: [0.0165, 0.026, 0.038, 0.072] },
    CDi_k: { x: [0, 6, 16, 30], y: [0.046, 0.043, 0.042, 0.042] }, // e ~0.8 flaps; clean incl. trim/compressibility lift drag (EST)
    // Supercritical ~35 deg swept wing: drag divergence ~M0.88 (SPEC high-speed cruise M0.88, MMO 0.89), EST.
    CD_mach: { x: [0, 0.7, 0.78, 0.82, 0.85, 0.87, 0.89, 0.91, 0.95], y: [0, 0, 0.0003, 0.0008, 0.0016, 0.0026, 0.0045, 0.009, 0.03] },
    CD_gear: 0.02, // EST
    CD_spoiler: 0.055, // EST: 4 MFS pairs at full flight deflection
    CD_speedbrake: 0,
    CD_groundSpoiler: 0.07,
    CD_beta: 0.3,
    CY_beta: -0.85,
    CY_dr: -0.17,
    Cl_beta: -0.11, // 35 deg sweep + 2.5 deg dihedral (EST)
    Cl_p: -0.45,
    Cl_r: 0.15,
    Cl_da: 0.045, // hydraulic ailerons (EST)
    Cl_dr: -0.008,
    Cl_spoiler: 0.06, // roll-assist MFS (GXFC)
    Cl_trim: 0.004, // aileron trim (repositions the aileron neutral, GXFC)
    // Static margin EST ~18 % MAC about the 25 % MAC reference point.
    Cm_alpha: { x: [-30, -14, 0, 14, 17, 20, 30, 45, 90], y: [0.45, 0.21, 0, -0.21, -0.28, -0.38, -0.56, -0.75, -1.0] },
    Cm0: 0.03,
    Cm_q: -30,
    Cm_alphadot: -9,
    Cm_de: 0.5,
    Cm_trim: 0.35, // stabilizer: normalized -1..1 = 0..14 units = 10 deg; dCm/d(stab) = a_t V_h eta ~3.2 /rad (EST)
    Cm_flap: { x: [0, 6, 16, 30], y: [0, -0.025, -0.05, -0.1] },
    Cm_gear: 0.004,
    Cm_spoiler: 0.012,
    Cm_mach: { x: [0, 0.82, 0.86, 0.9, 0.95], y: [0, 0, -0.004, -0.018, -0.045] }, // Mach tuck (the FCUs' Mach trim, GXFC)
    Cn_beta: 0.13,
    Cn_p: -0.02,
    Cn_r: -0.2,
    Cn_da: -0.004,
    Cn_dr: 0.095,
    Cn_trim: 0.012,
    alphaStall_deg: ALPHA_STALL,
    buffetMach: 0.9, // EST: buffet onset above MMO 0.89
  },
  mass: {
    // SPEC BOW 52,230 lb includes crew; the 2 crew (400 lb) sit in stations; drainable + undrainable unusable fuel
    // (172 lb, TCDS 1.4) is carried in the tanks as unusable.
    emptyMass_kg: (G6K_LIMITS.bowLb - 400 - 172) * LB,
    emptyCg_m: [0, 0, 0],
    // EST, Roskam Part V radii of gyration (business jets, aft engines): Ixx = m (b Rx/2)^2, Rx 0.25;
    // Iyy = m (L Ry/2)^2, L 30.3 m, Ry 0.38 (long aft-engine fuselage, upper end of the Roskam range); Izz = m ((b+L)/2 Rz/2)^2, Rz 0.44 (m = 23,432 kg empty).
    Ixx: 300000,
    Iyy: 780000,
    Izz: 985000,
    Ixz: 15000,
    maxTakeoffMass_kg: G6K_LIMITS.mtowLb * LB,
    maxLandingMass_kg: G6K_LIMITS.mlwLb * LB,
    maxZeroFuelMass_kg: G6K_LIMITS.mzfwLb * LB,
    macLeadingEdge_m: MAC_LE_X,
    tanks: [
      // TCDS 1.4 (SB 700-28-040): mains 15,045 lb each (wing box incl. the inboard feed tank), centroid EST 5.0 m
      // outboard, 0.5 m aft of the empty CG (35 deg swept box).
      { name: 'Left main', position_m: [-0.5, -5.0, WING_Z], capacity_kg: (G6K_LIMITS.mainTankLb + 36) * LB, unusable_kg: 36 * LB },
      // Centre wing tank 12,683 lb (TCDS), centre section under the cabin floor.
      { name: 'Centre', position_m: [1.0, 0, WING_Z + 0.2], capacity_kg: (G6K_LIMITS.centerTankLb + 50) * LB, unusable_kg: 50 * LB },
      { name: 'Right main', position_m: [-0.5, 5.0, WING_Z], capacity_kg: (G6K_LIMITS.mainTankLb + 36) * LB, unusable_kg: 36 * LB },
      // Aft fuselage tank (bladder) 2,275 lb (TCDS), aft of the rear pressure bulkhead area (EST x -7.5 m).
      { name: 'Aft', position_m: [-7.5, 0, 0.3], capacity_kg: (G6K_LIMITS.aftTankLb + 50) * LB, unusable_kg: 50 * LB },
    ],
    stations: [
      // Cockpit seats EST 10.6 m ahead of the CG (pilot eye 10.9 m, GXAG eye 0.49 m off the centreline).
      { name: 'Pilot', position_m: [10.6, -0.49, -0.3], defaultMass_kg: 200 * LB, maxMass_kg: 300 * LB },
      { name: 'Copilot', position_m: [10.6, 0.49, -0.3], defaultMass_kg: 200 * LB, maxMass_kg: 300 * LB },
      // Cabin 13.18 m (SPEC, cockpit divider to the aft cabin): forward, mid and aft zones (EST centroids).
      { name: 'Forward cabin (4)', position_m: [7.2, 0, 0.3], defaultMass_kg: 0, maxMass_kg: 900 * LB },
      { name: 'Mid cabin (6)', position_m: [3.3, 0, 0.3], defaultMass_kg: 0, maxMass_kg: 1300 * LB },
      { name: 'Aft cabin (4)', position_m: [-0.7, 0, 0.3], defaultMass_kg: 0, maxMass_kg: 900 * LB },
      { name: 'Crew rest / galley', position_m: [9.0, 0, 0.3], defaultMass_kg: 0, maxMass_kg: 600 * LB },
      // GXAG: baggage compartment door aft left; in-flight accessible baggage (SPEC) ~195 ft^3, EST 1,000 lb at x -3.8.
      { name: 'Aft baggage', position_m: [-3.8, 0, 0.4], defaultMass_kg: 0, maxMass_kg: 1000 * LB },
    ],
  },
  engines: [br710('Left BR710A2-20', -1), br710('Right BR710A2-20', 1)],
  gear: [
    wheel('Nose', NOSE_X, 0, 0, false),
    wheel('Left main', MAIN_X, -HALF_TRACK, 1, true),
    wheel('Right main', MAIN_X, HALF_TRACK, 2, true),
    // Aft fuselage lower skin (upswept tail cone): tail strike ~13.5 deg on compressed mains (EST).
    structure('Tail cone', [-11.5, 0, -0.35]),
    // Winglet / tip: 2.5 deg dihedral (GXAG), tip ~13 m outboard of the root, swept aft.
    structure('Left wingtip', [-6.3, -SPAN_M / 2 + 0.3, WING_Z - 13 * Math.tan((2.5 * Math.PI) / 180) - 0.1]),
    structure('Right wingtip', [-6.3, SPAN_M / 2 - 0.3, WING_Z - 13 * Math.tan((2.5 * Math.PI) / 180) - 0.1]),
    structure('Left nacelle', [-9.3, -2.45, -0.2]),
    structure('Right nacelle', [-9.3, 2.45, -0.2]),
    structure('Belly', [2.0, 0, 1.45]),
    structure('Nose', [13.7, 0, 0.7]),
  ],
  eyeHeightOnGround_m: 3.14, // GXAG GX_01_005 eye position (EST reading of the figure)
  radioAltOffset_m: GEAR_Z - MAIN_STATIC_DEFLECTION,
  limits: {
    vmo_kt: G6K_LIMITS.vmoKt,
    mmo: G6K_LIMITS.mmo,
    maxLoadFactor: G6K_LIMITS.nzMaxClean,
    minLoadFactor: G6K_LIMITS.nzMinClean,
    maxSinkRateOnGround_fpm: 900, // EST: 1.5 x the 600 fpm design landing sink rate (14 CFR 25.473)
  },
};

export default GLOBAL6000_FDM;
