/**
 * Generic ~7,500 kg twin-turbofan light jet (CJ4 / Phenom 300 class) used by
 * the physics tests and by the integration shell until real aircraft exist.
 *
 * This is NOT a model of any specific type: every number is an engineering
 * estimate (EST) chosen to be physically consistent — wing loading, thrust
 * to weight, stall and approach speeds, stability margins and inertias in
 * the range published for this class of aircraft. Real aircraft modules must
 * use their own sourced data.
 *
 * Body frame: datum at the empty-weight CG (gear down), x fwd, y right, z down.
 */
import type { FdmConfig, Table2D, TurbofanConfig } from './types';
import { isaPressure, isaTemperature } from './atmosphere';
import { FT_TO_M } from '../core/units';

/**
 * EST generic turbofan thrust lapse, bypass ratio ~3-4:
 *   F/F0 = delta^0.85 * (1 - 0.55 M + 0.35 M^2) * theta^-0.5 (cold air helps).
 * Gives ~0.21 at FL410 / M0.78, consistent with typical light-jet cruise
 * thrust fractions.
 */
function genericLapse(): Table2D {
  const machs = [0, 0.2, 0.4, 0.6, 0.8, 0.9];
  const alts = [0, 5000, 10000, 20000, 30000, 36089, 41000, 45000, 51000];
  const z = machs.map((m) =>
    alts.map((ft) => {
      const H = ft * FT_TO_M;
      const delta = isaPressure(H) / 101325;
      const theta = isaTemperature(H) / 288.15;
      const v = Math.pow(delta, 0.85) * (1 - 0.55 * m + 0.35 * m * m) / Math.sqrt(theta);
      return Math.round(v * 10000) / 10000;
    }),
  );
  return { x: machs, y: alts, z };
}

const LAPSE = genericLapse();

function engine(name: string, y: number): TurbofanConfig {
  return {
    kind: 'turbofan',
    name,
    position_m: [-3.6, y, -0.7], // EST: aft-fuselage pylons, thrust line above the CG
    thrustAxis: [1, 0, 0],
    maxThrust_N: 16000, // EST: ~3,600 lbf class (FJ44-4 / PW535 class)
    thrustLapse: LAPSE,
    n1Max_pct: 100,
    n1Idle_pct: 24,
    n2Idle_pct: 58,
    n2Max_pct: 98,
    thrustVsN1: { x: [0, 0.2, 0.24, 0.4, 0.6, 0.8, 0.9, 1.0, 1.05], y: [0, 0.02, 0.035, 0.1, 0.27, 0.55, 0.75, 1.0, 1.12] },
    spoolUpTau_s: { x: [0, 20, 58, 70, 85, 98], y: [4, 3.5, 2.0, 1.2, 0.8, 0.6] },
    spoolDownTau_s: { x: [0, 58, 98], y: [3, 2.2, 1.2] },
    tsfc: { x: [0, 0.24, 0.5, 0.8, 1.0], y: [0.12, 0.09, 0.06, 0.05, 0.0465] }, // kg/(N h); 0.0465 = 0.456 lb/lbf/h at max
    idleFuelFlow_pph: 170,
    ittIdle_c: 480,
    ittMax_c: 800,
    ittStartPeak_c: 650,
    starterMaxN2_pct: 28,
    lightOffN2_pct: 10,
    startToIdle_s: 25,
    oilPressIdle_psi: 40,
    oilPressMax_psi: 75,
    oilTempNormal_c: 85,
    reverseEfficiency: 0.35,
    bleedPressMax_psi: 60,
    windmillN1PerKt: 0.08,
    windmillN2PerKt: 0.045,
  };
}

function structure(name: string, p: [number, number, number]): FdmConfig['gear'][number] {
  return {
    name,
    position_m: p,
    gearIndex: -1,
    springK_Npm: 800000,
    dampingC_Nspm: 60000,
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

/** Flap settings used by the table: 0 (up), 15 (takeoff/approach), 35 (land). */
export const TEST_JET: FdmConfig = {
  aero: {
    wingArea_m2: 30.7,
    span_m: 15.5,
    mac_m: 2.1,
    refPoint_m: [0.1, 0, 0.5], // low wing: 25% MAC slightly ahead of and below the empty CG
    CL: {
      x: [-180, -90, -30, -20, -14, -10, -5, 0, 5, 10, 12, 13, 14, 15, 16, 18, 20, 25, 30, 45, 60, 90, 180],
      y: [0, 15, 35],
      z: [
        [0, 0, 0],
        [0, 0, 0],
        [-0.9, -0.8, -0.7],
        [-0.95, -0.85, -0.75],
        [-1.05, -0.9, -0.8],
        [-0.7, -0.3, 0.1],
        [-0.275, 0.125, 0.525],
        [0.15, 0.55, 0.95],
        [0.575, 0.975, 1.375],
        [1.0, 1.4, 1.8],
        [1.16, 1.54, 1.95],
        [1.23, 1.6, 1.88],
        [1.28, 1.52, 1.78],
        [1.22, 1.42, 1.68],
        [1.12, 1.33, 1.58],
        [1.0, 1.2, 1.42],
        [0.95, 1.1, 1.3],
        [0.95, 1.05, 1.2],
        [0.97, 1.05, 1.15],
        [1.0, 1.05, 1.1],
        [0.87, 0.9, 0.95],
        [0, 0.05, 0.1],
        [0, 0, 0],
      ],
    },
    CL_de: -0.12,
    CL_q: 5,
    CL_alphadot: 2,
    CL_spoiler: -0.25,
    CL_groundSpoiler: -0.6,
    groundEffectDrag: { x: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0], y: [0.3, 0.45, 0.72, 0.91, 0.954, 0.985, 1.0] },
    groundEffectLift: { x: [0, 0.1, 0.2, 0.3, 0.5, 1.0], y: [1.12, 1.07, 1.035, 1.02, 1.005, 1.0] },
    CL_mach: { x: [0, 0.4, 0.6, 0.7, 0.8, 0.9], y: [1, 1.04, 1.1, 1.13, 1.1, 1.0] },
    CD0: { x: [0, 15, 35], y: [0.021, 0.032, 0.065] },
    CDi_k: { x: [0, 15, 35], y: [0.051, 0.049, 0.047] },
    CD_mach: { x: [0, 0.7, 0.75, 0.78, 0.82, 0.86, 0.9], y: [0, 0, 0.0008, 0.002, 0.008, 0.025, 0.05] },
    CD_gear: 0.018,
    CD_spoiler: 0.02,
    CD_speedbrake: 0.025,
    CD_groundSpoiler: 0.06,
    CD_beta: 0.3,
    CY_beta: -0.75,
    CY_dr: -0.15,
    Cl_beta: -0.09,
    Cl_p: -0.45,
    Cl_r: 0.12,
    Cl_da: 0.035,
    Cl_dr: -0.008,
    Cl_spoiler: 0.03,
    Cl_trim: 0.004,
    Cm_alpha: { x: [-30, -14, 0, 14, 16, 20, 30, 45, 90], y: [0.3, 0.143, 0, -0.143, -0.17, -0.25, -0.38, -0.5, -0.7] },
    Cm0: 0.03,
    Cm_q: -18,
    Cm_alphadot: -6,
    Cm_de: 0.5,
    Cm_trim: 0.3,
    Cm_flap: { x: [0, 15, 35], y: [0, -0.03, -0.05] },
    Cm_gear: 0.005,
    Cm_spoiler: 0.02,
    Cm_mach: { x: [0, 0.75, 0.8, 0.85, 0.9], y: [0, 0, -0.01, -0.03, -0.06] },
    Cn_beta: 0.12,
    Cn_p: -0.02,
    Cn_r: -0.16,
    Cn_da: -0.004,
    Cn_dr: 0.09,
    Cn_trim: 0.02,
    alphaStall_deg: { x: [0, 15, 35], y: [14, 13, 12] },
    buffetMach: 0.82,
  },
  mass: {
    emptyMass_kg: 4900,
    emptyCg_m: [0, 0, 0],
    Ixx: 20000,
    Iyy: 45000,
    Izz: 62000,
    Ixz: 1500,
    maxTakeoffMass_kg: 7500,
    maxLandingMass_kg: 7000,
    maxZeroFuelMass_kg: 5900,
    macLeadingEdge_m: 0.1 + 0.25 * 2.1,
    tanks: [
      { name: 'Left wing', position_m: [0.1, -2.6, 0.45], capacity_kg: 1150, unusable_kg: 10 },
      { name: 'Right wing', position_m: [0.1, 2.6, 0.45], capacity_kg: 1150, unusable_kg: 10 },
    ],
    stations: [
      { name: 'Pilot', position_m: [4.6, -0.45, -0.1], defaultMass_kg: 90, maxMass_kg: 150 },
      { name: 'Copilot', position_m: [4.6, 0.45, -0.1], defaultMass_kg: 90, maxMass_kg: 150 },
      { name: 'Cabin forward', position_m: [2.3, 0, 0], defaultMass_kg: 0, maxMass_kg: 400 },
      { name: 'Cabin aft', position_m: [0.8, 0, 0], defaultMass_kg: 0, maxMass_kg: 400 },
      { name: 'Aft baggage', position_m: [-2.5, 0, 0], defaultMass_kg: 0, maxMass_kg: 300 },
      { name: 'Nose baggage', position_m: [6.5, 0, 0.2], defaultMass_kg: 0, maxMass_kg: 150 },
    ],
  },
  engines: [engine('Left turbofan', -1.5), engine('Right turbofan', 1.5)],
  gear: [
    {
      name: 'Nose',
      position_m: [5.0, 0, 1.55],
      gearIndex: 0,
      springK_Npm: 80000,
      dampingC_Nspm: 9000,
      travel_m: 0.25,
      staticFriction: 0.8,
      dynamicFriction: 0.6,
      rollingFriction: 0.015,
      brake: null,
      brakeCoeff: 0,
      steerable: true,
      maxSteer_deg: 60,
      castering: false,
      retractable: true,
    },
    {
      name: 'Left main',
      position_m: [-0.6, -1.9, 1.55],
      gearIndex: 1,
      springK_Npm: 245000,
      dampingC_Nspm: 28000,
      travel_m: 0.28,
      staticFriction: 0.8,
      dynamicFriction: 0.6,
      rollingFriction: 0.015,
      brake: 'left',
      brakeCoeff: 0.5,
      steerable: false,
      maxSteer_deg: 0,
      castering: false,
      retractable: true,
    },
    {
      name: 'Right main',
      position_m: [-0.6, 1.9, 1.55],
      gearIndex: 2,
      springK_Npm: 245000,
      dampingC_Nspm: 28000,
      travel_m: 0.28,
      staticFriction: 0.8,
      dynamicFriction: 0.6,
      rollingFriction: 0.015,
      brake: 'right',
      brakeCoeff: 0.5,
      steerable: false,
      maxSteer_deg: 0,
      castering: false,
      retractable: true,
    },
    structure('Tail cone', [-7.0, 0, -0.2]),
    structure('Left wingtip', [-1.8, -7.7, 0.12]),
    structure('Right wingtip', [-1.8, 7.7, 0.12]),
    structure('Belly', [2.0, 0, 0.92]),
  ],
  eyeHeightOnGround_m: 2.3,
  radioAltOffset_m: 1.42,
  limits: {
    vmo_kt: 305,
    mmo: 0.77,
    maxLoadFactor: 3.0, // 14 CFR 25.337: 2.1 + 24000/(W+10000) for W = 16,500 lb
    minLoadFactor: -1.0,
    maxSinkRateOnGround_fpm: 900, // EST: 1.5x the 14 CFR 25.473 10 ft/s design sink rate
  },
};
