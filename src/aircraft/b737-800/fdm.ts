/**
 * Flight-dynamics configuration of the Boeing 737-800 with blended winglets
 * (2 x CFM56-7B26). Numbers are cited inline (abbreviations in data.ts);
 * every estimate is marked EST with its reasoning.
 *
 * Body frame (physics convention): origin = datum = empty-weight CG with gear
 * down, x forward, y right, z down. Longitudinal positions are laid out from
 * the mean aerodynamic chord: the empty CG is at 21 % MAC (EST: typical NG
 * operating-empty CG 18-24 % MAC), so the MAC leading edge sits 0.21 MAC
 * ahead of the datum. The main gear is at 55 % MAC (EST: ~8-9 % of the weight
 * on the nose gear at a mid CG, typical transport tip-back geometry) and the
 * nose gear one wheelbase (15.6 m, ACAPS) ahead of it. Heights: the datum is
 * 3.2 m above the ground when parked (EST: top of fuselage 5.41-5.56 m and
 * engine clearance 0.48-0.64 m, ACAPS 2.3.4; fuselage height ~4.0 m).
 *
 * Calibration targets (tests/aircraft/b737-800/performance.test.ts):
 *  - Stall (1 g, 60 t): clean ~150 KCAS, flaps 15 ~126, flaps 30 ~118, flaps 40 ~112
 *    (EST: VREF = 1.23 VS1G with the avionics perf.ts VREF table, VREF30 145 / VREF40 138 kt at 60 t).
 *  - Take-off 65 t flaps 5: VR ~140 KIAS, lift-off ~1,200 m (data.ts PERF_REF).
 *  - Cruise 65 t FL350 M0.78: ~450 KTAS, ~2,450 kg/h total (data.ts PERF_REF).
 */
import type { FdmConfig, GearContactConfig, Table2D, TurbofanConfig } from '../../physics/types';
import { isaPressure, isaTemperature } from '../../physics/atmosphere';
import { FT_TO_M } from '../../core/units';
import { B738_DIM, B738_LIMITS, B738_MASS, B738_TANKS, CFM56_7B26 } from './data';

// ------------------------------------------------------------------ geometry

export const MAC_M = B738_DIM.macM;
/** EST: empty (datum) CG at 21 % MAC. */
export const EMPTY_CG_PCT_MAC = 21;
/** MAC leading edge (body x, m). */
export const LEMAC_X = (EMPTY_CG_PCT_MAC / 100) * MAC_M;
/** Body x of a %MAC station. */
export const macX = (pct: number): number => LEMAC_X - (pct / 100) * MAC_M;
/** Datum height above the ground, parked (EST, see header). */
export const DATUM_HEIGHT_M = 3.2;
/** Wing reference plane at the MAC (low wing with 6 deg dihedral; EST). */
const WING_Z = 0.6;

export const MAIN_GEAR_X = macX(55);
export const NOSE_GEAR_X = MAIN_GEAR_X + B738_DIM.wheelbaseM;
/** Nose tip 2.46 m ahead of the nose gear (EST: BS 130 vs nose gear ~BS 227 on the NG). */
export const NOSE_TIP_X = NOSE_GEAR_X + 2.46;
/** Captain's design eye point (body m; EST: ~0.5 m aft of the nose gear, 1.12 m above the flight deck floor at 2.5 m, 0.53 m left). */
export const EYE_CAPT: [number, number, number] = [NOSE_GEAR_X - 0.5, -0.53, DATUM_HEIGHT_M - 3.62];

// ------------------------------------------------------------------ engine

/**
 * EST thrust lapse for the CFM56-7B (bypass ratio 5.1, B737ORG):
 *   F/F0 = delta^0.95 * (1 - b(delta) M + 0.25 M^2) / sqrt(theta),
 *   b(delta) = 0.46 + (0.90 - 0.46) * clamp((delta - 0.26) / 0.74, 0, 1),
 * anchored to: -17 % at M0.2 sea level (high-bypass take-off lapse), and
 * ~24 kN (5,400 lbf) max-climb thrust per engine at FL350 / M0.78 (CFM56-7B
 * published cruise thrust class), with the cruise N1 then ~86 %.
 */
export function thrustLapse(mach: number, altFt: number): number {
  const H = altFt * FT_TO_M;
  const delta = isaPressure(H) / 101325;
  const theta = isaTemperature(H) / 288.15;
  const b = 0.46 + (0.9 - 0.46) * Math.min(1, Math.max(0, (delta - 0.26) / 0.74));
  return (Math.pow(delta, 0.95) * (1 - b * mach + 0.25 * mach * mach)) / Math.sqrt(theta);
}
function lapseTable(): Table2D {
  const machs = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9];
  const alts = [0, 2500, 5000, 10000, 15000, 20000, 25000, 30000, 33000, 36089, 39000, 41000, 45000];
  return { x: machs, y: alts, z: machs.map((m) => alts.map((ft) => Math.round(thrustLapse(m, ft) * 10000) / 10000)) };
}

/**
 * N1 (%) producing the rated 26,300 lbf at sea level ISA static: 98.2 %
 * (EST, the take-off N1 of the 26K rating at SL/15 degC in the avionics
 * CFM56 N1 model, src/avionics/boeing-737/data/cfm56.ts). The red line is
 * 104 % (E004); the FADEC uses the margin on hot days up to the flat-rating
 * temperature (ISA+15) and at altitude.
 */
export const N1_RATED_PCT = 98.2;

export function cfm56(name: string, side: -1 | 1): TurbofanConfig {
  return {
    kind: 'turbofan',
    name,
    // Nacelle centre: 4.83 m outboard (EST: B737ORG engine centreline 190 in from the fuselage centreline),
    // 1.6 m above the ground (0.48-0.64 m nacelle clearance + ~2.1 m nacelle diameter / 2, ACAPS),
    // mid-nacelle ~1.7 m ahead of the local wing leading edge (EST).
    position_m: [2.5, side * 4.83, DATUM_HEIGHT_M - 1.6],
    thrustAxis: [1, 0, 0],
    maxThrust_N: CFM56_7B26.thrustLbf * 4.4482216, // E004 / ACAPS: 26,300 lbf SLST
    thrustLapse: lapseTable(),
    n1Max_pct: N1_RATED_PCT,
    n1Idle_pct: 20.5, // EST: CFM56-7B ground idle N1 ~19-22 % (line observations)
    n2Idle_pct: 59, // EST: ground idle N2 ~58-60 % (above the 56 % starter cut-out, B737ORG)
    n2Max_pct: 98, // EST: N2 at rated N1 (red line 105 %, E004)
    // Net thrust fraction vs corrected-N1 fraction (EST: ~N1^2.8 near the top so the cruise point lands at the ~85 % N1 of the published
    // cruise tables, 3.5 % idle thrust ~900 lbf).
    thrustVsN1: {
      x: [0, 0.2, 0.209, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.86, 0.9, 0.95, 1.0, 1.06],
      y: [0, 0.032, 0.035, 0.06, 0.115, 0.19, 0.29, 0.43, 0.6, 0.72, 0.8, 0.9, 1.0, 1.12],
    },
    // EST: idle -> take-off ~6 s (Part 33 acceleration class; 737 FCTM "engines accelerate symmetrically in ~6 s").
    spoolUpTau_s: { x: [0, 20, 59, 70, 85, 98], y: [4, 3.5, 2.4, 1.6, 1.0, 0.7] },
    spoolDownTau_s: { x: [0, 59, 98], y: [3, 2.5, 1.5] },
    // TSFC kg/(N h) vs N1 fraction (physical N1 / n1Max). Static rated 0.0387 (0.38 lb/lbf/h, CFM56-7B26 class);
    // part-power values calibrated so the cruise point (N1 ~86 %, M0.78, FL350) burns ~0.065 kg/(N h) installed (PERF_REF: ~1,225 kg/h per engine).
    tsfc: { x: [0, 0.2, 0.25, 0.5, 0.7, 0.8, 0.88, 0.95, 1.0], y: [0.07, 0.065, 0.063, 0.055, 0.053, 0.053, 0.053, 0.045, 0.0387] },
    tsfcMachFactor: 0.6,
    idleFuelFlow_pph: 600, // EST: ground idle ~270 kg/h per engine (0.27 x1000 KG/H on the NG secondary display)
    ittIdle_c: 440, // EST: typical warm ground idle EGT
    ittMax_c: 830, // EST: take-off EGT at rated N1 SL ISA (margin to the 950 degC red line, LIM)
    ittStartPeak_c: 560, // EST: typical start peak, below the 725 degC start limit (LIM)
    starterMaxN2_pct: 30, // EST: max motoring on the air turbine starter with APU bleed
    lightOffN2_pct: 20, // B737ORG: fuel at 25 % N2 (or 20 % at max motoring); lighting above 20 % is a normal start
    startToIdle_s: 30, // EST: light-off to stable idle (a complete NG ground start takes ~45-60 s)
    oilPressIdle_psi: 32, // EST: unregulated system, idle just above the 26 psi amber band top (B737ORG)
    oilPressMax_psi: 60, // EST
    oilTempNormal_c: 95, // EST: below the 140 degC maximum continuous (E004)
    reverseEfficiency: 0.38, // EST: cascade reverser net reverse thrust fraction at max reverse N1
    bleedPressMax_psi: 90, // EST: HP stage port at max N2 (the PRSOV regulates ~45 psi downstream)
    windmillN1PerKt: 0.08, // EST (physics test-jet class)
    windmillN2PerKt: 0.07, // EST: ~17 % N2 windmilling at 250 KIAS
    starterTau_s: 5,
    ittStartLimit_c: CFM56_7B26.egtStartC,
  };
}

// ------------------------------------------------------------------ gear

const TRACK_HALF = B738_DIM.trackM / 2; // ACAPS: 5.72 m main gear track
/** Main strut: travel 0.40 m (EST), ~0.18 m static deflection at MTOW (physics guidance 40-60 %). */
const MAIN_EXT_Z = DATUM_HEIGHT_M + 0.16;
// Nose extended contact at the same depth as the mains: the aircraft sits ~0.1 deg nose-up when parked (the physics
// static-equilibrium solver can otherwise settle in the tip-back equilibrium on the mains, see the dossier open issues).
const NOSE_EXT_Z = MAIN_EXT_Z;
const MAIN_STATIC_DEFL = 0.14; // EST: at typical landing / taxi weights

function wheel(name: string, x: number, y: number, idx: number, main: boolean): GearContactConfig {
  return {
    name,
    position_m: [x, y, main ? MAIN_EXT_Z : NOSE_EXT_Z],
    gearIndex: idx,
    // Mains: 350 kN per leg at MTOW over 0.18 m; nose: 62 kN over 0.13 m (EST).
    springK_Npm: main ? 1.95e6 : 4.8e5,
    dampingC_Nspm: main ? 2.6e5 : 5.5e4, // zeta ~0.5
    travel_m: main ? 0.4 : 0.3,
    staticFriction: 0.8,
    dynamicFriction: 0.6,
    rollingFriction: 0.015,
    brake: main ? (y < 0 ? 'left' : 'right') : null,
    brakeCoeff: main ? 0.55 : 0, // carbon/steel brakes, dry runway (EST)
    // FCOM 14.20: tiller +/-78 deg, rudder pedals +/-7 deg.
    steerable: !main,
    maxSteer_deg: main ? 0 : 78,
    castering: false,
    retractable: true,
  };
}

function structure(name: string, p: [number, number, number]): GearContactConfig {
  return {
    name,
    position_m: p,
    gearIndex: -1,
    springK_Npm: 4e6,
    dampingC_Nspm: 3e5,
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

/** Tail strike pitch attitude with the main struts extended: 11 deg (Boeing 737-800 tail-strike data, FCTM "Tail strike" table). */
export const TAIL_STRIKE_DEG = 11;
const TAIL_SKID_DX = 11.2; // EST: aft-body contact point 11.2 m aft of the main gear
const TAIL_SKID: [number, number, number] = [MAIN_GEAR_X - TAIL_SKID_DX, 0, MAIN_EXT_Z - TAIL_SKID_DX * Math.tan((TAIL_STRIKE_DEG * Math.PI) / 180)];

// ------------------------------------------------------------------ aerodynamics

/*
 * Lift: AR 34.32^2 / 124.58 = 9.45, quarter-chord sweep 25 deg: Helmbold/DATCOM lift slope
 * 2 pi AR / (2 + sqrt(AR^2 (1 + tan^2 L) + 4)) = 4.7 /rad = 0.082 /deg (EST); CL_mach adds the
 * compressibility rise (~ +20 % at M0.78). The trimmed 1-g CLmax per flap setting is chosen from the
 * VREF table (VREF = 1.23 VS1G): clean 1.30 (slats retracted), f1 1.66, f2 1.71, f5 1.78, f10 1.80,
 * f15 1.83, f25 1.93, f30 2.03, f40 2.24 (wing values, tuned so the trimmed 1-g stall speeds of the
 * complete aircraft match the targets, see the stall test). The take-off flaps 1-5 values are EST from
 * 14 CFR 25.107(b): V2 >= 1.13 VSR, so with the line V2 of ~150-152 kt at 65 t flaps 5 VSR5 must be
 * <= ~133 KCAS (CL >= 1.78); the earlier 1.65 put the stick shaker (1.07 VS) at V2. Flaps 10 / 15 are
 * kept at or above flaps 5 (VREF15 ~153-155 kt at 60 t -> VS15 ~124-126). Leading-edge slats/Krueger flaps are extended for flaps 1 and
 * more (FCOM 9.20), so their effect is part of the flap columns (CL_slats covers only the auto-slat).
 */
const FLAPS = [0, 1, 2, 5, 10, 15, 25, 30, 40];
const COLS: { cl0: number; stall: number; peak: number }[] = [
  { cl0: 0.25, stall: 14.3, peak: 1.3 },
  { cl0: 0.5, stall: 14.9, peak: 1.66 },
  { cl0: 0.55, stall: 14.9, peak: 1.71 },
  { cl0: 0.65, stall: 14.3, peak: 1.78 },
  { cl0: 0.78, stall: 13.1, peak: 1.8 },
  { cl0: 0.87, stall: 12.9, peak: 1.83 },
  { cl0: 1.0, stall: 12.9, peak: 1.93 },
  { cl0: 1.15, stall: 12.3, peak: 2.03 },
  { cl0: 1.35, stall: 12.4, peak: 2.24 },
];
const SLOPE = 0.082;
const ALPHAS = (() => {
  const s = new Set<number>([-180, -90, -30, -20, -14, -10, -5, 0, 5, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 25, 30, 45, 60, 90, 180]);
  for (const c of COLS) {
    s.add(c.stall);
    s.add(Math.round((c.stall - 1.5) * 10) / 10);
    s.add(Math.round((c.stall - 3) * 10) / 10);
    s.add(Math.round((c.stall + 1.5) * 10) / 10);
  }
  return [...s].sort((a, b) => a - b);
})();

function clColumn(cl0: number, stall: number, peak: number): number[] {
  return ALPHAS.map((a) => {
    if (a <= -90 || a >= 90) return a === 90 || a === -90 ? 0.05 * Math.sign(a) : 0;
    if (a <= -20) return a === -30 ? -0.85 : -0.95;
    if (a <= -14) return Math.min(cl0 + SLOPE * a, -0.9);
    if (a <= stall - 3) return cl0 + SLOPE * a;
    if (a <= stall) {
      const lin3 = cl0 + SLOPE * (stall - 3);
      const t = (a - (stall - 3)) / 3;
      return lin3 + (peak - lin3) * (1 - (1 - t) * (1 - t));
    }
    const d = a - stall;
    if (d <= 6) return peak - 0.05 * d - 0.004 * d * d;
    if (a <= 30) return Math.max(1.0, peak - 0.45 - 0.01 * (a - stall - 6));
    if (a <= 45) return 1.05;
    return 0.9 - (a - 60) * 0.03;
  });
}
const CL_COLS = COLS.map((c) => clColumn(c.cl0, c.stall, c.peak));

export const B738_FDM: FdmConfig = {
  aero: {
    wingArea_m2: B738_DIM.wingAreaM2,
    span_m: B738_DIM.spanM,
    mac_m: MAC_M,
    refPoint_m: [macX(25), 0, WING_Z],
    CL: { x: ALPHAS, y: FLAPS, z: ALPHAS.map((_, i) => CL_COLS.map((col) => Math.round(col[i] * 10000) / 10000)) },
    // Horizontal tail 32.8 m^2 (EST, B737ORG NG stabilizer), arm ~17.7 m: tail volume ~1.18. Elevator
    // effectiveness tau 0.45 over +/-~20 deg (EST): Cm_de = a_t tau V_h eta * 0.35 rad = 0.70.
    CL_de: -0.16,
    CL_q: 7,
    CL_alphadot: 2.5,
    CL_spoiler: -0.22, // EST: 8 flight spoiler panels at the flight-detent maximum
    CL_groundSpoiler: -0.28, // EST: 4 ground spoilers + flight spoilers full up: lift dump
    CL_slats: 0.08,
    groundEffectDrag: { x: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0], y: [0.35, 0.5, 0.72, 0.9, 0.95, 0.985, 1.0] },
    groundEffectLift: { x: [0, 0.1, 0.2, 0.3, 0.5, 1.0], y: [1.06, 1.035, 1.015, 1.006, 1.0, 1.0] },
    CL_mach: { x: [0, 0.3, 0.5, 0.6, 0.7, 0.78, 0.82, 0.86, 0.9], y: [1, 1.02, 1.07, 1.1, 1.15, 1.2, 1.2, 1.15, 1.05] },
    // Drag: CD0 clean 0.0185 with winglets (EST: cruise L/D ~16.7 at CL 0.5, Oswald e ~0.85 on AR 9.45).
    CD0: { x: FLAPS, y: [0.0185, 0.024, 0.026, 0.03, 0.04, 0.048, 0.07, 0.085, 0.11] },
    CDi_k: { x: FLAPS, y: [0.0396, 0.041, 0.041, 0.042, 0.043, 0.044, 0.045, 0.046, 0.047] },
    // Supercritical wing: drag-divergence near M0.80 (EST; Mmo 0.82, TCDS).
    CD_mach: { x: [0, 0.7, 0.74, 0.76, 0.78, 0.79, 0.8, 0.82, 0.84, 0.86, 0.9], y: [0, 0, 0.0003, 0.0006, 0.0012, 0.0018, 0.0028, 0.0055, 0.011, 0.02, 0.045] },
    CD_gear: 0.02, // EST
    CD_spoiler: 0.04,
    CD_speedbrake: 0,
    CD_groundSpoiler: 0.03,
    CD_beta: 0.5,
    CY_beta: -0.8,
    CY_dr: -0.17,
    Cl_beta: -0.1, // 6 deg dihedral + 25 deg sweep (EST)
    Cl_p: -0.45,
    Cl_r: 0.1,
    Cl_da: 0.05, // ailerons alone; spoiler roll assist from Cl_spoiler (FCOM 9.20: flight spoilers assist the ailerons)
    Cl_dr: -0.006,
    Cl_spoiler: 0.06,
    Cl_trim: 0.012,
    // Static margin ~10 % MAC about 25 % MAC (EST): -0.0082 per deg.
    Cm_alpha: { x: [-30, -14, 0, 14, 16, 20, 30, 45, 90], y: [0.25, 0.115, 0, -0.115, -0.14, -0.2, -0.33, -0.45, -0.65] },
    // Offset for the normalized stabilizer (0 at STAB.neutral = 6.5 units, +1 = 17 units, -1 = 0 units): cruise trim lands near 4-5 units at a mid CG (FCOM normal range).
    Cm0: 0.25,
    Cm_q: -28,
    Cm_alphadot: -9,
    Cm_de: 0.7,
    // Stabilizer: 17 units ~ 17 deg of stabilizer travel (EST), a_t V_h eta = 0.078 /deg -> ~8.5 units = 0.66 (normalized full scale).
    Cm_trim: 0.66,
    Cm_flap: { x: FLAPS, y: [0, -0.02, -0.025, -0.04, -0.055, -0.07, -0.085, -0.095, -0.11] },
    Cm_gear: 0.005,
    Cm_spoiler: 0.01,
    Cm_mach: { x: [0, 0.74, 0.78, 0.82, 0.86, 0.9], y: [0, 0, -0.002, -0.008, -0.02, -0.04] },
    Cn_beta: 0.12,
    Cn_p: -0.02,
    Cn_r: -0.2,
    Cn_da: -0.005,
    Cn_dr: 0.075,
    Cn_trim: 0.03,
    alphaStall_deg: { x: FLAPS, y: COLS.map((c) => c.stall) },
    buffetMach: 0.84, // EST: buffet onset above Mmo 0.82 at 1 g
  },
  mass: {
    // ACAPS: OEW 41,413 kg (baseline mixed class, includes crew); trapped fuel is carried in the tanks.
    emptyMass_kg: B738_MASS.operatingEmptyKg - 2 * B738_TANKS.unusableMainKg - B738_TANKS.unusableCenterKg,
    emptyCg_m: [0, 0, 0],
    // EST from Roskam Part V radii of gyration for twin wing-mounted-engine transports at OEW:
    // Ixx = m (b Rx / 2)^2 with Rx 0.25; Iyy = m (L Ry / 2)^2 with Ry 0.38; Izz = m ((b + L)/2 Rz / 2)^2 with Rz 0.46.
    Ixx: 8.3e5,
    Iyy: 2.33e6,
    Izz: 3.1e6,
    Ixz: 5e4,
    maxTakeoffMass_kg: B738_MASS.maxTakeoffKg,
    maxLandingMass_kg: B738_MASS.maxLandingKg,
    maxZeroFuelMass_kg: B738_MASS.maxZeroFuelKg,
    macLeadingEdge_m: LEMAC_X,
    tanks: [
      // Index order matches the avionics displays: 0 = main tank 1 (left), 1 = main tank 2 (right), 2 = centre.
      // Main tank centroids ~5.5 m outboard, 40 % local chord (EST); centre tank in the wing centre section (EST).
      { name: 'Main tank 1', position_m: [-0.2, -5.5, 0.5], capacity_kg: B738_TANKS.mainKg + B738_TANKS.unusableMainKg, unusable_kg: B738_TANKS.unusableMainKg },
      { name: 'Main tank 2', position_m: [-0.2, 5.5, 0.5], capacity_kg: B738_TANKS.mainKg + B738_TANKS.unusableMainKg, unusable_kg: B738_TANKS.unusableMainKg },
      { name: 'Centre tank', position_m: [0.6, 0, 1.2], capacity_kg: B738_TANKS.centerKg + B738_TANKS.unusableCenterKg, unusable_kg: B738_TANKS.unusableCenterKg },
    ],
    stations: [
      // Cabin zones of a 162-seat two-class layout (ACAPS 2.4.13): rows split in thirds (EST positions);
      // default load 150 passengers x 84 kg (EASA standard adult incl. hand baggage) + hold baggage.
      { name: 'Cabin forward (rows 1-10)', position_m: [8.0, 0, 0.2], defaultMass_kg: 4200, maxMass_kg: 5800 },
      { name: 'Cabin centre (rows 11-21)', position_m: [0.0, 0, 0.2], defaultMass_kg: 4200, maxMass_kg: 6200 },
      { name: 'Cabin aft (rows 22-32)', position_m: [-8.5, 0, 0.2], defaultMass_kg: 4200, maxMass_kg: 6200 },
      // Lower holds (ACAPS: 45.1 m^3 total): forward hold ahead of the wing, aft hold behind it (EST limits).
      { name: 'Forward cargo', position_m: [6.0, 0, 1.4], defaultMass_kg: 600, maxMass_kg: 3558 },
      { name: 'Aft cargo', position_m: [-7.0, 0, 1.4], defaultMass_kg: 800, maxMass_kg: 4990 },
    ],
  },
  engines: [cfm56('Engine 1 CFM56-7B26', -1), cfm56('Engine 2 CFM56-7B26', 1)],
  gear: [
    wheel('Nose', NOSE_GEAR_X, 0, 0, false),
    wheel('Left main', MAIN_GEAR_X, -TRACK_HALF, 1, true),
    wheel('Right main', MAIN_GEAR_X, TRACK_HALF, 2, true),
    structure('Tail skid', TAIL_SKID),
    // Nacelle lower lips (0.48-0.64 m clearance, ACAPS 2.3.4).
    structure('Left nacelle', [4.3, -4.83, DATUM_HEIGHT_M - 0.5]),
    structure('Right nacelle', [4.3, 4.83, DATUM_HEIGHT_M - 0.5]),
    // Winglet bottoms (4.06-4.32 m above the ground, ACAPS 2.3.4), ~7.8 m aft of the MAC LE at the tip (25 deg sweep).
    structure('Left wingtip', [LEMAC_X - 5.8, -17.2, DATUM_HEIGHT_M - 4.1]),
    structure('Right wingtip', [LEMAC_X - 5.8, 17.2, DATUM_HEIGHT_M - 4.1]),
    structure('Belly', [0, 0, DATUM_HEIGHT_M - 1.5]),
    structure('Nose', [NOSE_TIP_X - 0.3, 0, DATUM_HEIGHT_M - 2.2]),
  ],
  eyeHeightOnGround_m: 3.62, // EST (flight deck floor ~2.5 m + 1.12 m design eye)
  radioAltOffset_m: MAIN_EXT_Z - MAIN_STATIC_DEFL,
  limits: {
    vmo_kt: B738_LIMITS.vmoKt,
    mmo: B738_LIMITS.mmo,
    maxLoadFactor: B738_LIMITS.nzMax,
    minLoadFactor: B738_LIMITS.nzMin,
    maxSinkRateOnGround_fpm: 900, // EST: 1.5 x the 10 ft/s design landing sink rate (14 CFR 25.473)
  },
};

/**
 * Stick-shaker angle of attack per flap setting (deg): where the wing reaches CLmax / 1.07^2, i.e. the
 * shaker fires ~7 % above the 1-g stall speed (EST: Boeing sets the SMYD stick-shaker schedule with a
 * margin of this order; FAA AC 25-7D stall warning margin >= 5 kt or 5 %). The stall-warning block
 * normalizes AoA by its `alphaStall` table and fires at 0.9, so it is given this table / 0.9.
 */
export const SHAKER_ALPHA_DEG = {
  x: FLAPS,
  y: COLS.map((c) => Math.round(((c.peak / (1.07 * 1.07) - c.cl0) / SLOPE) * 100) / 100),
};

/** Typical payload (kg) of the default stations. */
export const DEFAULT_PAYLOAD_KG = B738_FDM.mass.stations.reduce((s, st) => s + st.defaultMass_kg, 0);

export default B738_FDM;
