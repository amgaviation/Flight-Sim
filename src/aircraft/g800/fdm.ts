/**
 * Flight-dynamics configuration of the Gulfstream G800 (GVIII-G800, 2 x
 * Rolls-Royce Pearl 700 / BR700-730B2-14). Source abbreviations as in
 * data.ts (TCDS, E135, FSB, GVI, GAC, WIKI, RR); every estimate is marked EST
 * with its reasoning.
 *
 * Body frame (physics convention): origin = datum = empty-weight CG with the
 * gear down, x forward, y right, z down. The TCDS gives only the W&B datum
 * (100 in ahead of the radome) and the MAC (4.756 m); station data are not
 * public, so the layout is built from the TCDS/FSB three-view numbers (length
 * 30.41 m, span 31.40 m, height 25.54 ft, fuselage width 2.74 m) and EST
 * proportions from published side/plan views (noted below).
 *
 * Calibration targets (tests/aircraft/g800/performance.test.ts, data.ts G800_PERF):
 *  - Stall (1-g, KCAS, EST from CLmax design values): 83,500 lb clean 124 / F39 106;
 *    105,600 lb F20 125.
 *  - Takeoff (GAC): 5,812 ft TOFL MTOW SL ISA -> AEO distance to 35 ft ~4,530 ft (EST ratio).
 *  - Cruise (GAC range, Breguet-derived EST): M0.85 2,750 lb/h and M0.90 3,400 lb/h
 *    total at 85,000 lb (FL410-FL450).
 */
import type { FdmConfig, GearContactConfig, Table2D, TurbofanConfig } from '../../physics/types';
import { isaPressure, isaTemperature } from '../../physics/atmosphere';
import { FT_TO_M } from '../../core/units';
import { FLAP_DETENTS, G800_LIMITS, LB, LBF } from './data';

// ------------------------------------------------------------------ geometry

/** WIKI: G700/G800 wing 1,283 ft^2. */
export const WING_AREA_M2 = G800_LIMITS.wingAreaFt2 * 0.09290304; // 119.19 m^2
/** TCDS §4: span 31.40 m (over the winglets). */
export const SPAN_M = G800_LIMITS.spanM;
/** TCDS §16: MAC 4.756 m. */
export const MAC_M = G800_LIMITS.macM;
/**
 * Empty CG EST at 38 % MAC: inside the 35-45 % MAC zero-fuel CG envelope
 * (FSB App. 3) toward its forward half (a typically-equipped empty aircraft
 * with a completed interior and aft engines).
 */
export const EMPTY_CG_PCT_MAC = 38;
export const MAC_LE_X = (EMPTY_CG_PCT_MAC / 100) * MAC_M; // 1.81 m ahead of the datum
/** EST: nose 15.5 m ahead of the empty CG (CG at ~51 % of the 30.41 m length, aft-engine layout). */
export const NOSE_X = 15.5;
/** Low wing: chord plane EST 1.0 m below the fuselage centreline (datum height). */
const WING_Z = 1.0;

// ------------------------------------------------------------------ engine

/**
 * Thrust lapse EST for a BPR ~5 two-spool turbofan (Pearl 700 class): F/F0 =
 * delta^a (1 - b M + c M^2) / sqrt(theta); a/b/c calibrated so the MCT/CLB
 * ratings give the GAC direct climb to FL410 at MTOW and the 51,000 ft
 * ceiling at light weight.
 */
export const LAPSE_A = 0.93;
export const LAPSE_B = 0.5;
export const LAPSE_C = 0.42;
function lapseTable(): Table2D {
  const machs = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
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
 * N1 (%) giving the rated 18,250 lbf at sea-level ISA static. EST 91.0 %: flat
 * rated to ISA+15 (EST, typical BR700-family flat rating; BR725 is rated
 * 16,100 lbf at 30 degC, GVI) the corrected-speed demand at 30 degC is
 * 91.0 x sqrt(303.15/288.15) = 93.3 % physical N1, inside the 96.6 % MTO
 * limit (E135), leaving margin for bleed and altitude.
 */
export const N1_RATED_PCT = 91.0;

export function pearl700(name: string, side: -1 | 1): TurbofanConfig {
  return {
    kind: 'turbofan',
    name,
    // Aft-fuselage pylons (GAC three-view): nacelle centre EST 9.0 m aft of the empty CG, 2.6 m outboard
    // (fuselage radius 1.45 m + pylon + 0.8 m nacelle radius for the 51.8 in fan, RR), thrust line 0.9 m above the datum.
    position_m: [-9.0, side * 2.6, -0.9],
    thrustAxis: [1, 0, 0],
    maxThrust_N: G800_LIMITS.thrustLbf * LBF, // TCDS §5 / E135: 81.2 kN (18,250 lbf) SL static
    thrustLapse: lapseTable(),
    n1Max_pct: N1_RATED_PCT,
    n1Idle_pct: 22, // EST: BR700-family ground idle LP ~20-24 %
    n2Idle_pct: 60, // EST: ground idle HP ~60 % (E135 oil-pressure schedule starts at "idle to 72.3 % NH")
    n2Max_pct: 99.5, // EST: HP at rated thrust; MTO limit 102.2 % (E135)
    // Net thrust fraction vs corrected-N1 fraction (EST high-bypass curve; extends past 1.0 for the flat rating).
    thrustVsN1: { x: [0, 0.2, 0.24, 0.4, 0.6, 0.8, 0.9, 1.0, 1.06, 1.1], y: [0, 0.015, 0.03, 0.085, 0.24, 0.52, 0.73, 1.0, 1.17, 1.28] },
    spoolUpTau_s: { x: [0, 20, 60, 75, 88, 99], y: [4.5, 3.8, 2.4, 1.5, 1.0, 0.75] }, // EST: ~6-7 s idle -> TO (14 CFR 33.73 class)
    spoolDownTau_s: { x: [0, 60, 99], y: [3.2, 2.6, 1.5] },
    // TSFC kg/(N h) vs N1 fraction. 0.0355 at rated = 0.348 lb/lbf/h SL static (EST: BPR ~5 class, RR: "5 % more
    // efficient" than the BR725). The Mach factor (tsfcMachFactor) is calibrated to the G800_PERF cruise burns.
    tsfc: { x: [0, 0.25, 0.5, 0.8, 1.0, 1.1], y: [0.105, 0.08, 0.052, 0.039, 0.0355, 0.0355] },
    tsfcMachFactor: 1.0,
    idleFuelFlow_pph: 420, // EST: ground idle per engine for an 18,000 lbf-class turbofan
    ittIdle_c: 480, // EST (TGT)
    ittMax_c: 880, // EST: TGT at rated thrust SL ISA, below the 940 degC MTO limit (E135)
    ittStartPeak_c: 620, // EST: FADEC-scheduled start well below the 800 degC ground start limit (E135)
    starterMaxN2_pct: 30, // EST: air turbine starter on APU bleed motors to ~30 % HP
    lightOffN2_pct: 18, // EST: FADEC fuel/igniters at ~18-20 % HP (BR700-family auto start)
    startToIdle_s: 32, // EST: BR700-family ground start ~40-45 s from button to stabilised idle
    oilPressIdle_psi: 50, // EST: above the 35 psid idle minimum (E135)
    oilPressMax_psi: 90, // EST
    oilTempNormal_c: 95, // EST
    reverseEfficiency: 0.4, // EST: target/cascade reverser ~40 % of forward thrust
    bleedPressMax_psi: 110, // EST: HP8 port at max HP
    windmillN1PerKt: 0.08, // EST (physics test-jet class)
    windmillN2PerKt: 0.045,
    starterTau_s: 4,
    selfSustainN2_pct: 36, // EST: must be below the 42 % HP starter cut-out (GVI)
    ittStartLimit_c: G800_LIMITS.tgtStartGroundC,
  };
}

// ------------------------------------------------------------------ gear

/**
 * Landing gear: twin-wheel nose and main gears (TCDS §21: nose twin 21 x 7.25-10,
 * main twin H37.5 x 12.0 R19). Wheelbase EST 13.4 m and track EST 4.6 m from the
 * GVI three-view proportions (not published; FSB: 180-deg turn in 61 ft).
 * Mains 1.2 m aft of the empty CG (EST: ~9 % nose load). Springs give ~40 %
 * static deflection at MTOW.
 */
export const MAIN_X = -1.2;
export const NOSE_GEAR_X = MAIN_X + 13.4;
const HALF_TRACK = 4.6 / 2;
/** EST: contact point with the struts extended; fuselage centreline ~2.9 m above the ramp when parked. */
const GEAR_Z = 3.02;
const MAIN_STATIC_DEFLECTION = 0.14;

function wheel(name: string, x: number, y: number, idx: number, main: boolean): GearContactConfig {
  return {
    name,
    position_m: [x, y, GEAR_Z],
    gearIndex: idx,
    // MTOW 47,899 kg: mains ~21,800 kg each -> 214 kN / 0.14 m; nose ~4,300 kg -> 42 kN / 0.12 m.
    springK_Npm: main ? 1530000 : 352000,
    dampingC_Nspm: main ? 183000 : 39000, // zeta ~0.5
    travel_m: main ? 0.35 : 0.3,
    staticFriction: 0.8,
    dynamicFriction: 0.6,
    rollingFriction: 0.015,
    brake: main ? (y < 0 ? 'left' : 'right') : null,
    brakeCoeff: main ? 0.55 : 0,
    steerable: !main,
    maxSteer_deg: main ? 0 : G800_LIMITS.tillerSteerDeg,
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
    dampingC_Nspm: 240000,
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
 * Lift: aspect ratio 31.4^2 / 119.19 = 8.27, 33 deg sweep (WIKI). DATCOM/Helmbold with
 * half-chord sweep ~30 deg: 2 pi A / (2 + sqrt(A^2 (1 + tan^2) + 4)) = 4.42 /rad, + ~5 % body
 * lift -> 0.081 /deg (EST). No leading-edge devices (BJT500, Gulfstream large-cabin wings).
 * Single-slotted Fowler flaps 10/20/39 (G800_AIRFRAME). The CL peaks are tuned so the 1-g
 * trimmed stall speeds match the G800_PERF design values (performance.test.ts).
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
  f0: { cl0: 0.18, stall: 14, peak: 1.23 },
  f10: { cl0: 0.45, stall: 13, peak: 1.4 },
  f20: { cl0: 0.62, stall: 12, peak: 1.515 },
  f39: { cl0: 0.95, stall: 11, peak: 1.68 },
};
const SLOPE = 0.081;
const CL_F0 = clColumn(CL_TUNE.f0.cl0, SLOPE, CL_TUNE.f0.stall, CL_TUNE.f0.peak);
const CL_F10 = clColumn(CL_TUNE.f10.cl0, SLOPE, CL_TUNE.f10.stall, CL_TUNE.f10.peak);
const CL_F20 = clColumn(CL_TUNE.f20.cl0, SLOPE, CL_TUNE.f20.stall, CL_TUNE.f20.peak);
const CL_F39 = clColumn(CL_TUNE.f39.cl0, SLOPE, CL_TUNE.f39.stall, CL_TUNE.f39.peak);
const FLAPS = FLAP_DETENTS.map((d) => d.flapDeg); // [0, 10, 20, 39]

export const G800_FDM: FdmConfig = {
  aero: {
    wingArea_m2: WING_AREA_M2,
    span_m: SPAN_M,
    mac_m: MAC_M,
    refPoint_m: [MAC_LE_X - 0.25 * MAC_M, 0, WING_Z], // 25 % MAC
    CL: {
      x: ALPHAS,
      y: FLAPS,
      z: ALPHAS.map((_, i) => [CL_F0[i], CL_F10[i], CL_F20[i], CL_F39[i]]),
    },
    // FBW elevators on a T-tail with a trimmable horizontal stabilizer (BJT500: "no elevator trim tabs").
    CL_de: -0.22,
    CL_q: 7.0,
    CL_alphadot: 2.5,
    CL_spoiler: -0.14, // six panels as speed brakes at 30 deg in flight (SCQ flight controls), EST effectiveness
    CL_groundSpoiler: -0.45, // all six panels at 55 deg on the ground (SCQ): lift dump (EST)
    groundEffectDrag: { x: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0], y: [0.3, 0.45, 0.72, 0.91, 0.954, 0.985, 1.0] },
    groundEffectLift: { x: [0, 0.1, 0.2, 0.3, 0.5, 1.0], y: [1.1, 1.06, 1.03, 1.015, 1.004, 1.0] },
    CL_mach: { x: [0, 0.4, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95], y: [1, 1.03, 1.08, 1.11, 1.13, 1.12, 1.07, 0.98] },
    // Drag: CD0 clean calibrated to the G800_PERF cruise burns (clean large-cabin jet on a large wing); flap
    // increments EST (single-slotted Fowler, 2/3 of the trailing edge, BJT500).
    CD0: { x: FLAPS, y: [0.0138, 0.022, 0.034, 0.078] },
    CDi_k: { x: FLAPS, y: [0.047, 0.044, 0.043, 0.042] }, // 1/(pi A e): e ~0.82 clean incl. winglets (EST)
    // Supercritical 33 deg swept wing with MMO 0.935 (TCDS): drag rise from ~M0.88, divergence ~M0.93 (EST).
    CD_mach: { x: [0, 0.75, 0.8, 0.85, 0.88, 0.9, 0.92, 0.935, 0.95, 0.98], y: [0, 0, 0.0002, 0.0006, 0.0011, 0.0019, 0.0032, 0.0048, 0.008, 0.02] },
    CD_gear: 0.016, // EST
    CD_spoiler: 0.045, // EST: six panels at 30 deg
    CD_speedbrake: 0,
    CD_groundSpoiler: 0.07,
    CD_beta: 0.3,
    CY_beta: -0.85,
    CY_dr: -0.16,
    Cl_beta: -0.11, // sweep + dihedral (EST)
    Cl_p: -0.45,
    Cl_r: 0.14,
    Cl_da: 0.045, // FBW ailerons (EBHA backed, SCQ) - EST effectiveness
    Cl_dr: -0.008,
    Cl_spoiler: 0.05, // outboard spoilers are roll spoilers (SCQ: four flight spoilers)
    Cl_trim: 0.004, // roll trim (FCC-commanded aileron offset, SCQ ROLL MOTOR CONTROL)
    // Static margin EST ~30 % MAC between the 25 % MAC ref point and the neutral point (0.081/deg x 0.30).
    Cm_alpha: { x: [-30, -14, 0, 14, 16, 20, 30, 45, 90], y: [0.6, 0.34, 0, -0.34, -0.4, -0.5, -0.68, -0.85, -1.05] },
    Cm0: 0.03,
    Cm_q: -26,
    Cm_alphadot: -9,
    Cm_de: 1.0,
    Cm_trim: 0.55, // trimmable horizontal stabilizer (HSTA dual electric motor, SCQ), EST effectiveness
    Cm_flap: { x: FLAPS, y: [0, -0.04, -0.07, -0.13] }, // EST: Fowler flaps nose-down pitching moment
    Cm_gear: 0.004,
    Cm_spoiler: 0.012,
    Cm_mach: { x: [0, 0.85, 0.9, 0.935, 0.97], y: [0, 0, -0.004, -0.012, -0.035] }, // EST mild tuck near MMO (FBW compensates)
    Cn_beta: 0.13,
    Cn_p: -0.02,
    Cn_r: -0.19,
    Cn_da: -0.004,
    Cn_dr: 0.085,
    Cn_trim: 0.012,
    alphaStall_deg: { x: FLAPS, y: [CL_TUNE.f0.stall, CL_TUNE.f10.stall, CL_TUNE.f20.stall, CL_TUNE.f39.stall] },
    buffetMach: 0.95, // EST: buffet onset just above MMO 0.935
  },
  mass: {
    emptyMass_kg: G800_LIMITS.emptyLb * LB,
    emptyCg_m: [0, 0, 0],
    // EST, Roskam Part V radii of gyration (business jets, aft engines), m = 24,313 kg empty:
    // Ixx = m (b Rx/2)^2, Rx 0.26; Iyy = m (L Ry/2)^2, L 30.41 m, Ry 0.32; Izz = m ((b+L)/2 Rz/2)^2, Rz 0.44.
    Ixx: 405000,
    Iyy: 575000,
    Izz: 1124000,
    Ixz: 15000,
    maxTakeoffMass_kg: G800_LIMITS.mtowLb * LB,
    maxLandingMass_kg: G800_LIMITS.mlwLb * LB,
    maxZeroFuelMass_kg: G800_LIMITS.mzfwLb * LB,
    macLeadingEdge_m: MAC_LE_X,
    tanks: [
      // TCDS §9: two wing tanks 24,700 lb each (hopper included) + EST 60 lb unusable. Centroid EST 4.5 m span,
      // 0.3 m aft of the empty CG (33 deg swept box).
      { name: 'Left wing', position_m: [-0.3, -4.5, WING_Z], capacity_kg: (G800_LIMITS.fuelTankLb + G800_LIMITS.fuelUnusableTankLb) * LB, unusable_kg: G800_LIMITS.fuelUnusableTankLb * LB },
      { name: 'Right wing', position_m: [-0.3, 4.5, WING_Z], capacity_kg: (G800_LIMITS.fuelTankLb + G800_LIMITS.fuelUnusableTankLb) * LB, unusable_kg: G800_LIMITS.fuelUnusableTankLb * LB },
    ],
    stations: [
      // Flight crew seats EST 3.0 m aft of the nose.
      { name: 'Pilot', position_m: [NOSE_X - 3.0, -0.55, 0.0], defaultMass_kg: 200 * LB, maxMass_kg: 300 * LB },
      { name: 'Copilot', position_m: [NOSE_X - 3.0, 0.55, 0.0], defaultMass_kg: 200 * LB, maxMass_kg: 300 * LB },
      // Cabin 46 ft 10 in (GAC) from ~11 m to ~-3.3 m: four living areas (EST positions).
      { name: 'Forward club (4)', position_m: [9.3, 0, 0.3], defaultMass_kg: 0, maxMass_kg: 800 * LB },
      { name: 'Conference / dining (6)', position_m: [5.8, 0, 0.3], defaultMass_kg: 0, maxMass_kg: 1200 * LB },
      { name: 'Aft lounge (6)', position_m: [1.8, 0, 0.3], defaultMass_kg: 0, maxMass_kg: 1200 * LB },
      { name: 'Stateroom (3)', position_m: [-1.6, 0, 0.3], defaultMass_kg: 0, maxMass_kg: 600 * LB },
      // EST: aft internal baggage (195 ft^3 class, in-flight accessible) 2,500 lb.
      { name: 'Aft baggage', position_m: [-4.6, 0, 0.3], defaultMass_kg: 0, maxMass_kg: 2500 * LB },
    ],
  },
  engines: [pearl700('Left Pearl 700', -1), pearl700('Right Pearl 700', 1)],
  gear: [
    wheel('Nose', NOSE_GEAR_X, 0, 0, false),
    wheel('Left main', MAIN_X, -HALF_TRACK, 1, true),
    wheel('Right main', MAIN_X, HALF_TRACK, 2, true),
    // Aft fuselage lower skin at the tail-strike point: ~12.4 deg pitch on the main wheels (EST).
    structure('Tail cone', [-12.5, 0, 0.4]),
    // Winglet tips: 3 deg dihedral EST, winglet tips 1.2 m above the wing tip.
    structure('Left winglet', [-6.4, -SPAN_M / 2, WING_Z - 14.3 * Math.tan((3 * Math.PI) / 180) - 1.2]),
    structure('Right winglet', [-6.4, SPAN_M / 2, WING_Z - 14.3 * Math.tan((3 * Math.PI) / 180) - 1.2]),
    structure('Left nacelle', [-10.8, -2.6, -0.2]),
    structure('Right nacelle', [-10.8, 2.6, -0.2]),
    structure('Belly', [3.0, 0, 1.5]),
    structure('Nose', [NOSE_X - 0.3, 0, 0.9]),
  ],
  eyeHeightOnGround_m: 3.3, // EST: pilot eye ~0.4 m above the centreline, centreline ~2.9 m above the ramp
  radioAltOffset_m: GEAR_Z - MAIN_STATIC_DEFLECTION,
  limits: {
    vmo_kt: G800_LIMITS.vmoKt,
    mmo: G800_LIMITS.mmo,
    maxLoadFactor: G800_LIMITS.nzMaxClean, // GVI: +2.5 g flaps up
    minLoadFactor: G800_LIMITS.nzMinClean, // GVI: -1.0 g
    maxSinkRateOnGround_fpm: 900, // EST: 1.5 x the 600 fpm Part 25 landing design sink rate
  },
};

export default G800_FDM;
