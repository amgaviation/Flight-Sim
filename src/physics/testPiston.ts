/**
 * Generic 172-class single-engine piston FDM configuration used by tests and
 * integration until the real Cessna 172S modules exist. Numbers cite the
 * Cessna 172S POH (172SPHUS, Rev 4/5, serials 172S8001+) where available;
 * everything else is marked EST with reasoning.
 *
 * Body frame: origin (datum) at the empty-weight CG, x forward, y right,
 * z down (metres). POH fuselage stations (inches aft of the firewall datum)
 * convert with x = (EMPTY_CG_STA - sta) * 0.0254.
 */
import type { FdmConfig, PistonConfig } from './types';
import { FT_TO_M, IN_TO_M, LB_TO_KG, AVGAS_LB_PER_GAL } from '../core/units';

/** EST: typical 172S basic-empty-weight CG ~39.5 in aft of datum (POH CG envelope 35.0-47.3 in). */
const EMPTY_CG_STA = 39.5;
const sta = (inches: number): number => (EMPTY_CG_STA - inches) * IN_TO_M;

/** POH Section 1: fuel capacity 56 gal total, 53 usable -> 28 gal per tank, 1.5 gal unusable each. */
const TANK_KG = 28 * AVGAS_LB_PER_GAL * LB_TO_KG;
const UNUSABLE_KG = 1.5 * AVGAS_LB_PER_GAL * LB_TO_KG;

/** Static-deflected gear contact height below the CG datum (m). EST from the POH three-view (normal ground attitude). */
const GROUND_Z = 1.17;

export const TEST_PISTON_ENGINE: PistonConfig = {
  kind: 'piston',
  name: 'Lycoming IO-360-L2A (generic)',
  // EST: propeller plane ~38 in forward of the firewall datum, thrust line slightly above the CG.
  position_m: [sta(-38), 0, -0.25],
  thrustAxis: [1, 0, 0],
  ratedPower_hp: 180, // POH Section 1 / Section 7: 180 BHP at 2700 RPM
  ratedRpm: 2700,
  displacement_cuin: 361, // Lycoming IO-360 series displacement 361 cu in (Lycoming type certificate E-286 family)
  compressionRatio: 8.5, // IO-360-L2A 8.5:1 (Lycoming specification)
  idleRpm: 620, // POH Section 4 "engine idles (approximately 600 RPM)"; EST 620 warm
  propDiameter_m: 76 * IN_TO_M, // POH Section 2: McCauley 1A170E/JHA7660, max diameter 76 in
  propPitch_in: 60, // JHA7660 designation: 76 in diameter, 60 in pitch
  /**
   * EST: fixed-pitch cruise-prop coefficients fitted to the POH cruise table
   * (Figure 5-8: e.g. 2400 RPM / 6000 ft / 108 KTAS / 57% BHP -> CP 0.0435 at
   * J 0.72; 2700 / 8000 ft / 124 KTAS / 77% -> CP 0.043 at J 0.73), static
   * full-throttle 2300-2400 RPM (Section 4) and POH takeoff/climb performance
   * (960 ft ground roll, 730 fpm) for CT. Peak efficiency ~0.80 at J ~0.72.
   */
  propCT: {
    x: [0, 0.2, 0.4, 0.49, 0.6, 0.72, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4],
    y: [0.083, 0.08, 0.0765, 0.0727, 0.063, 0.0484, 0.038, 0.024, 0.009, -0.006, -0.022, -0.05],
  },
  propCP: {
    x: [0, 0.2, 0.4, 0.5, 0.6, 0.66, 0.72, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4],
    y: [0.0592, 0.0585, 0.0555, 0.0525, 0.049, 0.0462, 0.0437, 0.0395, 0.032, 0.021, 0.008, -0.008, -0.04],
  },
  propInertia_kgm2: 3.2, // EST: ~30 lb two-blade 76 in aluminium prop (~2.7) + crankshaft/flywheel
  frictionTorque_Nm: 35, // EST: motoring friction + compression at idle for a 360 cu in four-cylinder
  starterTorque_Nm: 190, // EST: cranks ~150-250 rpm against compression
  ratedFuelFlow_gph: 14.0, // EST: best-power BSFC ~0.47 lb/hp/h x 180 hp / 6 lb/gal
  oilPressNormal_psi: 75, // POH Figure 2-3: oil pressure green arc 50-90 psi
  oilTempNormal_f: 190, // POH Figure 2-3: oil temp green 100-245 F; EST 190 in cruise
  chtNormal_f: 380, // EST: typical 172S cruise CHT (G1000 NXi CHT green arc 200-500 F)
  egtPeak_f: 1450, // EST: IO-360 cruise peak EGT ~1400-1500 F
  induction: 'injected', // POH Section 7: fuel-injected IO-360-L2A
  propRotation: 1, // Lycoming tractor, clockwise viewed from the cockpit
};

export const TEST_PISTON: FdmConfig = {
  aero: {
    wingArea_m2: 174 * FT_TO_M * FT_TO_M, // POH Section 1: wing area 174 sq ft
    span_m: (36 + 1 / 12) * FT_TO_M, // POH three-view: 36 ft 1 in with strobes
    mac_m: 58.8 * IN_TO_M, // EST: 172 mean aerodynamic chord ~58.8 in
    refPoint_m: [sta(40.7), 0, -1.1], // EST: 25% MAC at ~sta 40.7, high wing ~1.1 m above the CG
    // CL(alpha, flaps): EST — NACA 2412 section, AR 7.5, stall at 16 deg clean.
    // Calibrated to POH stall speeds at 2550 lb (Figure 5-3/Section 1): flaps up 53 KCAS
    // (CLmax ~1.55), flaps 30 deg 48 KCAS (CLmax ~1.90).
    CL: {
      x: [-180, -90, -30, -20, -16, -12, -8, -4, 0, 4, 8, 12, 14, 15, 16, 17, 18, 20, 25, 30, 45, 60, 90, 180],
      y: [0, 10, 20, 30],
      z: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [-0.9, -0.8, -0.7, -0.65],
        [-0.95, -0.85, -0.75, -0.7],
        [-1.08, -0.95, -0.85, -0.8],
        [-0.75, -0.6, -0.45, -0.36],
        [-0.39, -0.2, -0.05, 0.04],
        [-0.04, 0.16, 0.32, 0.41],
        [0.31, 0.51, 0.67, 0.76],
        [0.66, 0.86, 1.02, 1.11],
        [1.01, 1.21, 1.37, 1.46],
        [1.33, 1.52, 1.66, 1.75],
        [1.46, 1.62, 1.77, 1.86],
        [1.51, 1.67, 1.82, 1.9],
        [1.55, 1.7, 1.76, 1.83],
        [1.48, 1.62, 1.66, 1.73],
        [1.4, 1.54, 1.58, 1.64],
        [1.25, 1.38, 1.45, 1.5],
        [1.1, 1.2, 1.26, 1.3],
        [1.02, 1.1, 1.15, 1.18],
        [1.0, 1.05, 1.08, 1.1],
        [0.85, 0.9, 0.95, 0.98],
        [0, 0.05, 0.1, 0.12],
        [0, 0, 0, 0],
      ],
    },
    CL_de: -0.15, // EST: nose-up (TE-up) elevator reduces tail lift (Cessna-class CL_de ~0.43/rad x 0.35 rad)
    CL_q: 3.9, // EST: light-single typical
    CL_alphadot: 1.7, // EST
    CL_spoiler: 0,
    CL_groundSpoiler: 0,
    groundEffectDrag: { x: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0], y: [0.3, 0.45, 0.72, 0.91, 0.954, 0.985, 1.0] }, // Wieselsberger (16h/b)^2/(1+(16h/b)^2)
    groundEffectLift: { x: [0, 0.1, 0.2, 0.3, 0.5, 1.0], y: [1.12, 1.07, 1.035, 1.02, 1.005, 1.0] }, // EST
    // Drag: EST, fitted to POH cruise (2400 RPM / 6000 ft -> 108 KTAS at 57%) with e ~0.75, AR 7.5.
    // Fixed gear and struts are included in CD0 (CD_gear = 0).
    CD0: { x: [0, 10, 20, 30], y: [0.031, 0.037, 0.052, 0.072] },
    CDi_k: { x: [0, 10, 20, 30], y: [0.0567, 0.055, 0.053, 0.052] },
    CD_mach: { x: [0, 0.3], y: [0, 0.001] },
    CD_gear: 0,
    CD_spoiler: 0,
    CD_speedbrake: 0,
    CD_groundSpoiler: 0,
    CD_beta: 0.17, // EST
    // Lateral-directional: EST, magnitudes typical of Cessna singles (Roskam-class data), pilot-sign convention.
    CY_beta: -0.393,
    CY_dr: -0.052,
    Cl_beta: -0.0923,
    Cl_p: -0.484,
    Cl_r: 0.0798,
    Cl_da: 0.07,
    Cl_dr: -0.004,
    Cl_spoiler: 0,
    // Pitch: EST static margin ~12% (Cm_alpha -0.0107/deg), benign nose-down stall break.
    Cm_alpha: { x: [-30, -16, 0, 16, 18, 20, 25, 30, 45, 90], y: [0.32, 0.171, 0, -0.171, -0.21, -0.25, -0.32, -0.38, -0.5, -0.7] },
    Cm0: -0.03, // EST: gives near-neutral pitch trim in 2400 RPM cruise (POH Figure 5-8 condition)
    Cm_q: -12.4,
    Cm_alphadot: -5.2,
    Cm_de: 0.45,
    Cm_trim: 0.18, // EST: trim tab can trim to ~65 KIAS clean at forward CG
    Cm_flap: { x: [0, 10, 20, 30], y: [0, 0.005, 0.01, 0.01] }, // EST: high-wing flaps -> slight nose-up
    Cm_gear: 0,
    Cm_spoiler: 0,
    Cn_beta: 0.0587,
    Cn_p: -0.0278,
    Cn_r: -0.0937,
    Cn_da: -0.0066,
    Cn_dr: 0.018,
    alphaStall_deg: { x: [0, 10, 20, 30], y: [16, 16, 15, 15] },
    propwashElevatorGain: 0.5, // EST: tail partly immersed in the slipstream
  },
  mass: {
    emptyMass_kg: 1663 * LB_TO_KG, // POH Section 1: standard empty weight 1663 lb
    emptyCg_m: [0, 0, 0],
    // EST: JSBSim c172p gross inertias (1285/1825/2667 kg m^2) scaled ~0.72 to empty weight.
    Ixx: 925,
    Iyy: 1314,
    Izz: 1920,
    Ixz: 0,
    maxTakeoffMass_kg: 2550 * LB_TO_KG, // POH Section 2: max takeoff weight 2550 lb
    maxLandingMass_kg: 2550 * LB_TO_KG, // POH Section 2: max landing weight 2550 lb
    maxZeroFuelMass_kg: 2550 * LB_TO_KG, // no MZFW limit in the POH
    macLeadingEdge_m: sta(26.0), // EST: LEMAC ~sta 26 in
    tanks: [
      { name: 'Left wing', position_m: [sta(48.0), -1.7, -1.0], capacity_kg: TANK_KG, unusable_kg: UNUSABLE_KG }, // POH loading: fuel arm 48 in
      { name: 'Right wing', position_m: [sta(48.0), 1.7, -1.0], capacity_kg: TANK_KG, unusable_kg: UNUSABLE_KG },
    ],
    stations: [
      { name: 'Pilot', position_m: [sta(37), -0.3, -0.3], defaultMass_kg: 77, maxMass_kg: 160 }, // EST front seat arm 37 in
      { name: 'Front passenger', position_m: [sta(37), 0.3, -0.3], defaultMass_kg: 0, maxMass_kg: 160 },
      { name: 'Rear passengers', position_m: [sta(73), 0, -0.3], defaultMass_kg: 0, maxMass_kg: 250 }, // EST rear seat arm 73 in
      { name: 'Baggage area 1', position_m: [sta(95), 0, -0.2], defaultMass_kg: 0, maxMass_kg: 120 * LB_TO_KG }, // POH: sta 82-108, 120 lb
      { name: 'Baggage area 2', position_m: [sta(125), 0, -0.2], defaultMass_kg: 0, maxMass_kg: 50 * LB_TO_KG }, // POH: sta 108-142, 50 lb
    ],
  },
  engines: [TEST_PISTON_ENGINE],
  gear: [
    {
      name: 'Nose',
      // POH three-view: wheelbase 65 in; EST nose axle at sta -6.8, main at sta 58.2.
      position_m: [sta(-6.8), 0, GROUND_Z + 0.07],
      gearIndex: 0,
      springK_Npm: 40000, // EST oleo: ~0.07 m static deflection at ~2.8 kN
      dampingC_Nspm: 3400,
      travel_m: 0.18,
      staticFriction: 0.8,
      dynamicFriction: 0.6,
      rollingFriction: 0.02,
      brake: null,
      brakeCoeff: 0,
      steerable: true,
      maxSteer_deg: 10, // EST: rudder-pedal steering ~+-10 deg
      castering: true, // castors to ~30 deg with differential braking
      retractable: false,
    },
    {
      name: 'Left main',
      position_m: [sta(58.2), -1.27, GROUND_Z + 0.08],
      gearIndex: 1,
      springK_Npm: 60000, // EST: spring-steel leg ~0.08 m static deflection
      dampingC_Nspm: 3800,
      travel_m: 0.15,
      staticFriction: 0.8,
      dynamicFriction: 0.6,
      rollingFriction: 0.02,
      brake: 'left',
      brakeCoeff: 0.55,
      steerable: false,
      maxSteer_deg: 0,
      castering: false,
      retractable: false,
    },
    {
      name: 'Right main',
      position_m: [sta(58.2), 1.27, GROUND_Z + 0.08],
      gearIndex: 2,
      springK_Npm: 60000,
      dampingC_Nspm: 3800,
      travel_m: 0.15,
      staticFriction: 0.8,
      dynamicFriction: 0.6,
      rollingFriction: 0.02,
      brake: 'right',
      brakeCoeff: 0.55,
      steerable: false,
      maxSteer_deg: 0,
      castering: false,
      retractable: false,
    },
    structure('Tail', [sta(230), 0, GROUND_Z - 1.0]),
    structure('Left wingtip', [sta(45), -5.5, GROUND_Z - 2.3]),
    structure('Right wingtip', [sta(45), 5.5, GROUND_Z - 2.3]),
    structure('Belly', [sta(0), 0, GROUND_Z - 0.45]),
  ],
  eyeHeightOnGround_m: 1.5,
  radioAltOffset_m: GROUND_Z,
  limits: {
    vmo_kt: 163, // POH Section 2: Vne 163 KIAS
    mmo: 0.3,
    maxLoadFactor: 3.8, // POH Section 2: normal category +3.8 g
    minLoadFactor: -1.52, // POH Section 2: normal category -1.52 g
    maxSinkRateOnGround_fpm: 800, // EST: ~1.5x the 14 CFR 23.473 limit descent velocity (~520 fpm at 14.7 lb/sq ft)
  },
};

function structure(name: string, p: [number, number, number]): FdmConfig['gear'][number] {
  return {
    name,
    position_m: p,
    gearIndex: -1,
    springK_Npm: 200000,
    dampingC_Nspm: 20000,
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
