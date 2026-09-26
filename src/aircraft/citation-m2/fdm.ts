/**
 * Flight-dynamics configuration of the Cessna Citation M2 (Model 525,
 * 2 x Williams FJ44-1AP-21). Numbers are cited inline (abbreviations in
 * data.ts); every estimate is marked EST with its reasoning.
 *
 * Body frame (physics convention): origin = datum = empty-weight CG with gear
 * down, x forward, y right, z down. Longitudinal positions come from the
 * TCDS fuselage stations (inches aft of the TCDS datum, which is 94 in ahead
 * of the forward pressure bulkhead) through `fs()` in data.ts. The empty CG
 * is taken at FS 247.0 (EST, see below).
 *
 * Calibration targets (tests/aircraft/citation-m2):
 *  - Stall speeds (FPG p.32, KCAS at 10,700 lb): 98 clean, 92 flaps 15, 86 flaps 35.
 *  - Takeoff: VR 105 / V2 111 KIAS at MTOW, BFL 3,210 ft (FPG pp.4-5).
 *  - High-speed cruise (FPG p.22): FL330 403 KTAS / 997 lb/h, FL410 385 KTAS / 678 lb/h at 9,500 lb.
 *  - Climb (FPG p.21): sea level to FL410 in 24 min at MTOW.
 */
import type { FdmConfig, GearContactConfig, Table2D, TurbofanConfig } from '../../physics/types';
import { isaPressure, isaTemperature } from '../../physics/atmosphere';
import { FT_TO_M } from '../../core/units';
import { fs, LB, M2_LIMITS } from './data';

// ------------------------------------------------------------------ geometry

/** TCDS §14: MAC 69.077 in, leading edge at FS 228.745. */
export const MAC_IN = 69.077;
export const MAC_LE_FS = 228.745;
export const MAC_M = MAC_IN * 0.0254; // 1.7546 m
/** S&D15 §1.2: wing area 240.0 ft^2 (22.30 m^2), span 47 ft 3 in incl. tip lights (47 ft 0 in without). */
export const WING_AREA_M2 = 22.3;
export const SPAN_M = 14.39;

/**
 * Empty CG. The TCDS lists no empty-weight CG range; FS 250.0 (30 % MAC) is
 * EST so that the FPG basic operating weight (6,990 lb with a 200 lb pilot at
 * FS 135) sits at FS 246.7 (26 % MAC), four passengers in the club seats move
 * it forward to ~20 % MAC and full fuel (FS 253) back to ~23-26 % MAC: typical
 * loadings stay inside the TCDS envelope FS 240.14-248.43 (16.5-28.5 % MAC).
 */

/** Wing chord plane below the fuselage centreline (low wing; EST from the three-view, fuselage dia. ~1.6 m). */
const WING_Z = 0.55;

// ------------------------------------------------------------------ engine

/**
 * EST thrust lapse for a BPR 2.58 turbofan (S&D15 §8):
 *   F/F0 = delta^a * (1 - b(delta) M + c M^2) / theta^0.5,
 *   b(delta) = B_HI + (B_LO - B_HI) * clamp((delta - 0.26) / 0.74, 0, 1)
 * i.e. a strong Mach lapse at low altitude (FPG sea-level MTOW climb rate
 * 3,698 fpm) fading to a weak one at cruise altitudes (ram recovery), with
 * a/B_HI/c calibrated so that the CRU detent reproduces the FPG high-speed
 * cruise table at FL330-FL410 (tests/aircraft/citation-m2/performance.test.ts).
 */
export const LAPSE_A = 0.95;
export const LAPSE_B_LO = 0.95; // sea level
export const LAPSE_B_HI = 0.25; // FL330 and above
export const LAPSE_C = 0.25;
export function thrustLapse(mach: number, altFt: number): number {
  const H = altFt * FT_TO_M;
  const delta = isaPressure(H) / 101325;
  const theta = isaTemperature(H) / 288.15;
  const b = LAPSE_B_HI + (LAPSE_B_LO - LAPSE_B_HI) * Math.min(1, Math.max(0, (delta - 0.26) / 0.74));
  return (Math.pow(delta, LAPSE_A) * (1 - b * mach + LAPSE_C * mach * mach)) / Math.sqrt(theta);
}
function lapseTable(): Table2D {
  const machs = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const alts = [0, 2500, 5000, 10000, 15000, 20000, 25000, 30000, 33000, 36089, 41000, 45000];
  return { x: machs, y: alts, z: machs.map((m) => alts.map((ft) => Math.round(thrustLapse(m, ft) * 10000) / 10000)) };
}

/**
 * N1 (%) at which the engine produces the rated 1,965 lbf at sea level ISA
 * static. EST: 101.5 % leaves ~3 points to the 104.69 % red line, which the
 * FADEC uses to hold thrust on hot days up to the flat-rating temperature and
 * at altitude (typical FJ44 takeoff N1 97-104 %).
 */
export const N1_RATED_PCT = 101.5;

export function fj44(name: string, side: -1 | 1): TurbofanConfig {
  return {
    kind: 'turbofan',
    name,
    // Nacelles on aft-fuselage pylons: TCDS oil tank at FS 314.74 -> engine centre ~FS 320 (EST);
    // lateral offset 1.32 m (fuselage radius ~0.8 m + pylon, EST from the S&D three-view);
    // thrust line ~0.35 m above the fuselage centreline (EST).
    position_m: [fs(320), side * 1.32, -0.35],
    thrustAxis: [1, 0, 0],
    maxThrust_N: 1965 * 4.4482216, // TCDS / ETCDS: 1,965 lbf takeoff, flat rated to 22.2 degC (72 degF)
    thrustLapse: lapseTable(),
    n1Max_pct: N1_RATED_PCT,
    n1Idle_pct: 25, // EST: FJ44-class ground idle N1
    n2Idle_pct: 52, // EST: FJ44-class ground idle N2 (100 % = 41,200 rpm, TCDS)
    n2Max_pct: 98.5, // EST: N2 at rated N1; red line 100 % (TCDS)
    // Net thrust fraction vs corrected-N1 fraction (EST, turbofan cube-ish law; extends past 1.0 for hot-day FADEC margin).
    thrustVsN1: { x: [0, 0.2, 0.246, 0.4, 0.6, 0.8, 0.9, 1.0, 1.05], y: [0, 0.018, 0.032, 0.09, 0.25, 0.53, 0.74, 1.0, 1.2] },
    spoolUpTau_s: { x: [0, 20, 52, 65, 80, 98], y: [4, 3.5, 2.0, 1.3, 0.9, 0.6] }, // EST: ~5 s idle -> TO (Part 33 acceleration class)
    spoolDownTau_s: { x: [0, 52, 98], y: [3, 2.2, 1.2] },
    // TSFC (kg/(N h)) vs N1 fraction. 0.0465 at rated thrust = 0.456 lb/lbf/h (EST: FJ44-1A published static SFC class).
    tsfc: { x: [0, 0.25, 0.5, 0.8, 1.0], y: [0.12, 0.095, 0.064, 0.05, 0.0465] },
    tsfcMachFactor: 1.72, // EST: calibrated to the FPG cruise fuel flows (see physics TurbofanConfigExtras)
    idleFuelFlow_pph: 125, // EST: FJ44-class ground idle fuel flow per engine
    ittIdle_c: 470, // EST
    ittMax_c: 800, // EST: ITT at rated N1 SL ISA (bleed on), below the 835 degC MCT / 855 degC takeoff limits (TCDS)
    ittStartPeak_c: 640, // EST: typical start peak well below the 1,000 degC 15 s start transient limit (TCDS)
    starterMaxN2_pct: 26, // EST: 300 A starter-generator motoring speed on battery
    lightOffN2_pct: 9, // EST: FADEC schedules start fuel at ~8-10 % N2 (CJ family)
    startToIdle_s: 26, // EST: light-off to stabilized idle
    oilPressIdle_psi: 45, // EST: above the 23 psi minimum (TCDS/FR)
    oilPressMax_psi: 88, // EST: below the 120 psi maximum
    oilTempNormal_c: 80, // EST: below the 135 degC maximum
    reverseEfficiency: 0, // no thrust reversers on 525-0600 and on (TCDS §16: thrust attenuators not applicable)
    bleedPressMax_psi: 75, // EST: HP bleed at max N2
    windmillN1PerKt: 0.08, // EST (physics test-jet class)
    windmillN2PerKt: 0.045,
    starterTau_s: 4,
    ittStartLimit_c: M2_LIMITS.ittStartTransientC,
  };
}

// ------------------------------------------------------------------ gear

/**
 * Landing gear from S&D15 §1.2: tread 13 ft 0 in (3.96 m), wheelbase 15 ft 4 in
 * (4.67 m). Main gear at FS 264.7 (EST: ~10 % of the weight on the nose
 * wheel at a mid-envelope CG, typical 8-12 % for light jets);
 * nose gear 4.67 m ahead of it. Trailing-link mains (S&D15 §7).
 * Strut springs give ~45 % static deflection at MTOW (physics guidance):
 * mains 21.5 kN each over 0.11 m, nose 4.6 kN over 0.08 m.
 */
const MAIN_X = fs(264.7); // EST: FS 264.7
const NOSE_X = MAIN_X + 4.67;
const HALF_TREAD = 3.96 / 2;
const GEAR_Z = 1.4; // EST: contact point with struts extended (fuselage centreline ~1.3 m above the ground when parked)
const MAIN_STATIC_DEFLECTION = 0.11;

function wheel(name: string, x: number, y: number, idx: number, main: boolean): GearContactConfig {
  return {
    name,
    position_m: [x, y, GEAR_Z],
    gearIndex: idx,
    springK_Npm: main ? 195000 : 57000,
    dampingC_Nspm: main ? 20700 : 5200, // zeta ~0.5
    travel_m: main ? 0.25 : 0.2,
    staticFriction: 0.8,
    dynamicFriction: 0.6,
    rollingFriction: 0.015,
    brake: main ? (y < 0 ? 'left' : 'right') : null,
    brakeCoeff: main ? 0.55 : 0,
    // S&D15 §7: rudder pedals steer the nose wheel mechanically +/-20 deg; 95 deg castering for towing.
    steerable: !main,
    maxSteer_deg: main ? 0 : 20,
    castering: false,
    retractable: true,
  };
}

function structure(name: string, p: [number, number, number]): GearContactConfig {
  return {
    name,
    position_m: p,
    gearIndex: -1,
    springK_Npm: 600000,
    dampingC_Nspm: 50000,
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
 * Lift: aspect ratio 14.33^2/22.3 = 9.2 (straight, 0 deg sweep at 35 % chord,
 * S&D15 §1.2), lift slope 2 pi AR/(2 + sqrt(AR^2 + 4)) = 5.1/rad = 0.088/deg
 * (EST, Helmbold). CL tables tuned so the 1-g trimmed stall speeds match FPG
 * p.32 (tests). Flaps 60 = ground flaps (lift dump / drag, TCDS §10: prohibited in flight).
 */
const ALPHAS = [-180, -90, -30, -20, -14, -10, -5, 0, 5, 8, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 18, 20, 25, 30, 45, 60, 90, 180];
function clColumn(cl0: number, slope: number, stall: number, peak: number): number[] {
  // Linear to stall-3, rounded to `peak` at `stall`, post-stall drop.
  return ALPHAS.map((a) => {
    if (a <= -90 || a >= 90) return a === 90 || a === -90 ? 0.05 * Math.sign(a) : 0;
    if (a === -30) return -0.85;
    if (a === -20) return -0.9;
    if (a === -14) return -1.0;
    if (a <= stall - 3) return cl0 + slope * a;
    if (a <= stall) {
      const lin3 = cl0 + slope * (stall - 3);
      const t = (a - (stall - 3)) / 3;
      return lin3 + (peak - lin3) * (1 - (1 - t) * (1 - t));
    }
    const d = a - stall;
    if (d <= 6) return peak - 0.045 * d - 0.004 * d * d;
    if (a <= 30) return Math.max(0.95, peak - 0.37 - 0.01 * (a - stall - 6));
    if (a <= 45) return 1.0;
    return 0.85 - (a - 60) * 0.0283;
  });
}
const CL_F0 = clColumn(0.08, 0.088, 15, 1.31);
const CL_F15 = clColumn(0.33, 0.088, 14.5, 1.51);
const CL_F35 = clColumn(0.5, 0.088, 14, 1.73);
const CL_F60 = clColumn(0.52, 0.088, 13.5, 1.76);

export const CITATION_M2_FDM: FdmConfig = {
  aero: {
    wingArea_m2: WING_AREA_M2,
    span_m: SPAN_M,
    mac_m: MAC_M,
    refPoint_m: [fs(MAC_LE_FS + 0.25 * MAC_IN), 0, WING_Z], // 25 % MAC
    CL: {
      x: ALPHAS,
      y: [0, 15, 35, 60],
      z: ALPHAS.map((_, i) => [CL_F0[i], CL_F15[i], CL_F35[i], CL_F60[i]]),
    },
    // Elevator: horizontal tail 60.7 ft^2 (S&D15), tail arm ~5.7 m (EST, T-tail at FS ~470),
    // travel up 18.5 / down 15 deg (TCDS §16): full command ~0.32 rad x tau 0.45 x a_t 4/rad.
    CL_de: -0.11,
    CL_q: 5.5,
    CL_alphadot: 2,
    CL_spoiler: -0.08, // S&D21: speed brakes "allow for drag control with minimum pitching moments" (small lift loss EST)
    CL_groundSpoiler: -0.1,
    groundEffectDrag: { x: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0], y: [0.3, 0.45, 0.72, 0.91, 0.954, 0.985, 1.0] },
    groundEffectLift: { x: [0, 0.1, 0.2, 0.3, 0.5, 1.0], y: [1.12, 1.07, 1.035, 1.02, 1.005, 1.0] },
    CL_mach: { x: [0, 0.4, 0.6, 0.7, 0.75, 0.8, 0.9], y: [1, 1.04, 1.1, 1.13, 1.12, 1.08, 1.0] },
    // Drag: CD0 clean EST (L/D max ~16 class for a 9.2 AR straight-wing light jet), calibrated to FPG cruise.
    CD0: { x: [0, 15, 35, 60], y: [0.0228, 0.036, 0.068, 0.125] },
    CDi_k: { x: [0, 15, 35, 60], y: [0.0425, 0.041, 0.04, 0.04] }, // 1/(pi AR e), e ~0.82 (EST)
    // Natural-laminar-flow straight wing: drag rise near the 0.71 Mmo (EST).
    CD_mach: { x: [0, 0.6, 0.66, 0.7, 0.72, 0.75, 0.8, 0.85, 0.9], y: [0, 0, 0.0003, 0.0009, 0.0018, 0.0045, 0.016, 0.04, 0.07] },
    CD_gear: 0.02, // EST
    CD_spoiler: 0,
    // Upper 49 deg + lower 68 deg speed-brake panels (TCDS §16), EST.
    CD_speedbrake: 0.045,
    CD_groundSpoiler: 0.04,
    CD_beta: 0.3,
    CY_beta: -0.7,
    CY_dr: -0.14, // rudder +/-30 deg (TCDS §16)
    Cl_beta: -0.085, // 5 deg dihedral (S&D15 §5)
    Cl_p: -0.47,
    Cl_r: 0.12,
    Cl_da: 0.045, // ailerons up 23.5 / down 20.5 deg (TCDS §16)
    Cl_dr: -0.007,
    Cl_spoiler: 0,
    Cl_trim: 0.004, // LH aileron trim tab (S&D15 §5)
    // Static margin ~12 % MAC about 25 % MAC (EST): -0.0106 per deg.
    Cm_alpha: { x: [-30, -14, 0, 14, 16, 20, 30, 45, 90], y: [0.32, 0.148, 0, -0.148, -0.18, -0.26, -0.39, -0.5, -0.7] },
    Cm0: 0.035,
    Cm_q: -14,
    Cm_alphadot: -6,
    Cm_de: 0.6,
    Cm_trim: 0.24, // elevator trim tabs up 12 / down 20 deg (TCDS §16), EST effectiveness
    Cm_flap: { x: [0, 15, 35, 60], y: [0, -0.035, -0.06, -0.07] },
    Cm_gear: 0.004,
    Cm_spoiler: 0.005,
    Cm_mach: { x: [0, 0.68, 0.72, 0.76, 0.8, 0.9], y: [0, 0, -0.004, -0.012, -0.025, -0.06] },
    Cn_beta: 0.11,
    Cn_p: -0.02,
    Cn_r: -0.15,
    Cn_da: -0.004,
    Cn_dr: 0.085,
    Cn_trim: 0.012,
    alphaStall_deg: { x: [0, 15, 35, 60], y: [15, 14.5, 14, 13.5] },
    buffetMach: 0.76, // EST: buffet onset above Mmo 0.71
  },
  mass: {
    // FPG p.3: typically-equipped empty weight 6,790 lb, includes the 30.64 lb unusable fuel (TCDS Note 2),
    // which the FDM carries in the tanks instead.
    emptyMass_kg: (6790 - 30.64) * LB,
    emptyCg_m: [0, 0, 0],
    // EST from Roskam Part V radii of gyration for twin aft-engine business jets at empty weight:
    // Ixx = m (b Rx/2)^2, Rx 0.25; Iyy = m (L Ry/2)^2, L 12.98 m, Ry 0.32; Izz = m ((b+L)/2 Rz/2)^2, Rz 0.42.
    Ixx: 9950,
    Iyy: 13250,
    Izz: 25300,
    Ixz: 500,
    maxTakeoffMass_kg: M2_LIMITS.mtowLb * LB,
    maxLandingMass_kg: M2_LIMITS.mlwLb * LB,
    maxZeroFuelMass_kg: M2_LIMITS.mzfwLb * LB,
    macLeadingEdge_m: fs(MAC_LE_FS),
    tanks: [
      // TCDS §9.1: two wing tanks, 1,648 lb usable each at FS 253.0 (+ half of the 30.64 lb unusable).
      { name: 'Left wing', position_m: [fs(253.0), -2.3, WING_Z], capacity_kg: (1648 + 15.32) * LB, unusable_kg: 15.32 * LB },
      { name: 'Right wing', position_m: [fs(253.0), 2.3, WING_Z], capacity_kg: (1648 + 15.32) * LB, unusable_kg: 15.32 * LB },
    ],
    stations: [
      // Crew seats FS 135 (EST: 41 in aft of the forward pressure bulkhead at FS 94). FPG BOW: 1 pilot & stores 200 lb.
      { name: 'Pilot', position_m: [fs(135), -0.33, -0.1], defaultMass_kg: 200 * LB, maxMass_kg: 300 * LB },
      { name: 'Copilot', position_m: [fs(135), 0.33, -0.1], defaultMass_kg: 0, maxMass_kg: 300 * LB },
      { name: 'Cabin side-facing seat', position_m: [fs(165), 0.3, 0], defaultMass_kg: 0, maxMass_kg: 300 * LB },
      { name: 'Cabin club fwd pair', position_m: [fs(190), 0, 0], defaultMass_kg: 0, maxMass_kg: 600 * LB },
      { name: 'Cabin club aft pair', position_m: [fs(225), 0, 0], defaultMass_kg: 0, maxMass_kg: 600 * LB },
      { name: 'Belted lavatory seat', position_m: [fs(255), -0.3, 0], defaultMass_kg: 0, maxMass_kg: 300 * LB },
      { name: 'Nose baggage', position_m: [fs(74.0), 0, 0.2], defaultMass_kg: 0, maxMass_kg: 400 * LB }, // TCDS §20
      { name: 'Tailcone baggage', position_m: [fs(356.5), 0, 0.1], defaultMass_kg: 0, maxMass_kg: 325 * LB }, // TCDS §20
    ],
  },
  engines: [fj44('Left FJ44-1AP-21', -1), fj44('Right FJ44-1AP-21', 1)],
  gear: [
    wheel('Nose', NOSE_X, 0, 0, false),
    wheel('Left main', MAIN_X, -HALF_TREAD, 1, true),
    wheel('Right main', MAIN_X, HALF_TREAD, 2, true),
    // Tail cone lower skin: ~13 deg tail-strike attitude (EST, typical light jet).
    structure('Tail cone', [-5.2, 0, 0.3]),
    structure('Left wingtip', [-0.3, -SPAN_M / 2, WING_Z - 6.6 * Math.tan((5 * Math.PI) / 180)]),
    structure('Right wingtip', [-0.3, SPAN_M / 2, WING_Z - 6.6 * Math.tan((5 * Math.PI) / 180)]),
    structure('Belly', [1.5, 0, 0.85]),
    structure('Nose', [5.4, 0, 0.55]),
  ],
  eyeHeightOnGround_m: 1.95, // EST
  radioAltOffset_m: GEAR_Z - MAIN_STATIC_DEFLECTION,
  limits: {
    vmo_kt: M2_LIMITS.vmoKt,
    mmo: M2_LIMITS.mmo,
    maxLoadFactor: M2_LIMITS.nzMaxClean, // S&D21 +3.6 g
    minLoadFactor: M2_LIMITS.nzMinClean, // S&D21 -1.44 g
    maxSinkRateOnGround_fpm: 900, // EST: 1.5 x 10 ft/s design sink rate
  },
};

export default CITATION_M2_FDM;
