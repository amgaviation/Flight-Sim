/**
 * Cessna 172S Skyhawk SP flight-dynamics configuration (both variants: the
 * G1000 NXi airplane differs only in equipment weight, see `withEquipment`).
 *
 * Starting point: src/physics/testPiston.ts (generic 172-class config by the
 * physics module). Changes, each tuned against the POH in
 * tests/aircraft/c172s-common/performance.test.ts:
 *  - Mass and balance from the POH/TCDS: standard empty weight, sample-loading
 *    basic-empty CG arm, TCDS MAC/LEMAC, seat/baggage/fuel arms.
 *  - Normal ground attitude (POH Fig 1-1: "nose strut showing approximately 2 in
 *    of strut, and wings level"): the nose contact is raised so the airplane
 *    sits level instead of 1 deg nose-down (which robbed lift in the ground roll).
 *  - Lateral/directional power effects: the generic config rolled the airplane
 *    past 45 deg of bank within 8 s of a hands-off lift-off (full-power torque
 *    reaction plus 4 deg of slipstream-induced sideslip through the dihedral).
 *    Fixed with (a) the P-factor / spiral-slipstream constants reduced to the
 *    rudder a 172 actually needs in a Vy climb, (b) the wing's recovery of the
 *    slipstream swirl (`torqueRollRecovery`), and (c) the factory rigging
 *    (ground-adjustable rudder tab, aileron rigging) applied by
 *    systems/flight.ts `C172Rigging` so the ball is centred and the wings stay
 *    level in 2400 rpm cruise.
 *  - Aileron power from Roskam's 172 derivative (Cl_da 0.178/rad) over the TCDS
 *    aileron travel instead of the generic 0.07.
 *
 * Body frame: origin (datum) at the empty-weight CG, x forward, y right,
 * z down (metres). POH fuselage stations (inches aft of the firewall datum)
 * convert with x = (EMPTY_CG_STA - sta) * 0.0254.
 */
import type { FdmConfig, GearContactConfig, PistonConfig } from '../../physics/types';
import { FT_TO_M, IN_TO_M, LB_TO_KG } from '../../core/units';
import { FUEL_DATA, KG_PER_GAL, LIMITS } from './data';

/**
 * Basic-empty-weight CG arm (in aft of the firewall datum). POH Fig 6-5 sample loading
 * problem: basic empty weight 1642 lb, moment 62.6 lb-in/1000 -> 38.1 in.
 */
export const EMPTY_CG_STA = 38.1;
/** Converts a POH station (in) to body x (m). */
export const sta = (inches: number): number => (EMPTY_CG_STA - inches) * IN_TO_M;

/**
 * Height of the datum (empty CG) above the gear contact plane with the struts at static
 * deflection (m). EST from the POH three-view: propeller ground clearance 11.25 in with a
 * 76 in propeller puts the thrust line 49.25 in (1.25 m) above ground; the empty CG sits
 * about 8 cm below the thrust line (fuselage mid-height at the front seats).
 */
export const GROUND_Z = 1.17;

/** Thrust line height above the datum (m, negative = above): POH three-view, see GROUND_Z. */
const THRUST_Z = GROUND_Z - (11.25 + 38) * IN_TO_M;

export const C172S_ENGINE: PistonConfig = {
  kind: 'piston',
  name: 'Lycoming IO-360-L2A',
  // Propeller plane: POH equipment list 61-01-R propeller installation arm -38.2 in (sta).
  position_m: [sta(-38.2), 0, THRUST_Z],
  thrustAxis: [1, 0, 0],
  ratedPower_hp: 180, // POH Sec 1: 180 BHP at 2700 RPM
  ratedRpm: 2700,
  displacement_cuin: 361, // Lycoming IO-360 series, 361 cu in (POH Sec 1 rounds to 360)
  compressionRatio: 8.5, // IO-360-L2A 8.5:1 (Lycoming specification)
  idleRpm: 620, // POH Sec 4 "engine idles (approximately 600 RPM)"; EST 620 warm
  propDiameter_m: 76 * IN_TO_M, // POH Sec 1: McCauley 1A170E/JHA7660, 76 in
  propPitch_in: 60, // JHA7660: 76 in diameter, 60 in pitch
  /**
   * EST (physics module fit, kept): fixed-pitch CT/CP fitted to POH Fig 5-8 cruise and the
   * 2300-2400 static rpm; peak efficiency ~0.80 at J ~0.72.
   */
  propCT: {
    x: [0, 0.2, 0.4, 0.49, 0.6, 0.72, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4],
    y: [0.087, 0.083, 0.077, 0.069, 0.0605, 0.0484, 0.038, 0.024, 0.009, -0.006, -0.022, -0.05],
  },
  propCP: {
    x: [0, 0.2, 0.4, 0.5, 0.6, 0.66, 0.72, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4],
    y: [0.0592, 0.0585, 0.0555, 0.0525, 0.049, 0.0462, 0.0437, 0.0395, 0.032, 0.021, 0.008, -0.008, -0.04],
  },
  propInertia_kgm2: 3.2, // EST: ~35 lb 76 in aluminium prop (POH equipment list 35.0 lb) + crankshaft
  frictionTorque_Nm: 35, // EST (physics module): motoring friction + compression at idle
  starterTorque_Nm: 190, // EST: Lamar 31B22207 starter (POH equipment list) cranks ~150-250 rpm
  ratedFuelFlow_gph: 14.0, // EST: best-power BSFC ~0.47 lb/hp/h x 180 hp / 6 lb/gal
  oilPressNormal_psi: 75, // POH Fig 2-3: green arc 50-90 psi
  oilTempNormal_f: 190, // POH Fig 2-3: green 100-245 F; EST 190 in cruise
  chtNormal_f: 380, // EST: typical 172S cruise CHT
  egtPeak_f: 1450, // EST: IO-360 cruise peak EGT 1400-1500 F
  induction: 'injected', // POH Sec 7: fuel injected (RSA-5AD1 servo, equipment list 71-03-R)
  propRotation: 1, // Lycoming tractor, clockwise viewed from the cockpit
  /**
   * EST: P-factor lateral thrust offset per radian of AoA as a fraction of the prop radius.
   * Classic propeller theory gives ~0.2-0.3 for a two-blade fixed-pitch prop at climb J
   * (McCormick, Aerodynamics, Aeronautics and Flight Mechanics, ch. 6 normal-force factor).
   */
  pFactorCoeff: 0.18,
  /**
   * EST, tuned: spiral-slipstream yaw N = -k dq S b. With the rudder tab rigged for cruise,
   * k = 0.0022 needs ~2.5 deg of right rudder in a full-power Vy climb and leaves < 2 deg of
   * sideslip feet-off (the familiar "right rudder in the climb"); the generic 0.004 gave 4 deg.
   */
  slipstreamYawCoeff: 0.0015,
  /**
   * EST: fraction of the torque reaction cancelled by the wing straightening the slipstream
   * swirl (the upwash on the left wing root / downwash on the right root of a clockwise
   * prop rolls the airplane right). Propeller-wing interaction studies (e.g. Veldhuis,
   * "Propeller Wing Aerodynamic Interference", TU Delft 2005) recover roughly half of the
   * swirl for a wing immersed in the slipstream; the 172's high wing root sits in the upper
   * slipstream.
   */
  torqueRollRecovery: 0.65,
};

/** Tank lateral centroid (m) and height (m, above the datum) — EST from the three-view: inboard wing bays. */
const TANK_Y = 1.55;
const TANK_Z = -1.05;
const TANK_KG = FUEL_DATA.tankCapacityGal * KG_PER_GAL;
const UNUSABLE_KG = FUEL_DATA.tankUnusableGal * KG_PER_GAL;

/** Main-gear lateral half-track (m). EST: 172 wheel track ~8 ft 4 in. */
const MAIN_Y = 1.27;
/** Main axle station (in): EST from the POH weighing procedure geometry and the 65 in wheelbase (POH Fig 1-1 note 2). */
const MAIN_STA = 57.6;
const NOSE_STA = MAIN_STA - 65;

export const C172S_FDM: FdmConfig = {
  aero: {
    wingArea_m2: 174 * FT_TO_M * FT_TO_M, // POH Fig 1-1 note 4: 174 sq ft
    span_m: (36 + 1 / 12) * FT_TO_M, // POH Fig 1-1: 36 ft 1 in (with strobes)
    mac_m: 58.8 * IN_TO_M, // TCDS 3A12: MAC 58.8 in
    // 25 % MAC: TCDS LEMAC 25.9 in + 0.25 x 58.8 = sta 40.6; EST: wing quarter chord ~1.0 m above the CG.
    refPoint_m: [sta(25.9 + 0.25 * 58.8), 0, -1.0],
    // CL(alpha, flaps): physics-module fit (NACA 2412, AR 7.5), calibrated to POH Fig 5-3
    // stall speeds at 2550 lb: flaps up 53 KCAS (CLmax ~1.55), flaps 30 48 KCAS (~1.90).
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
        [1.35, 1.54, 1.69, 1.78],
        [1.5, 1.66, 1.84, 1.93],
        [1.58, 1.72, 1.91, 2.0],
        [1.64, 1.77, 1.84, 1.9],
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
    CL_de: -0.15, // EST: nose-up elevator (TE up) reduces tail lift
    CL_q: 3.9, // EST: light single typical (Roskam 172: CL_q 3.9)
    CL_alphadot: 1.7, // Roskam 172: CL_alphadot 1.7
    CL_spoiler: 0,
    CL_groundSpoiler: 0,
    groundEffectDrag: { x: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0], y: [0.3, 0.45, 0.72, 0.91, 0.954, 0.985, 1.0] }, // Wieselsberger
    groundEffectLift: { x: [0, 0.1, 0.2, 0.3, 0.5, 1.0], y: [1.12, 1.07, 1.035, 1.02, 1.005, 1.0] }, // EST
    // Drag: physics-module fit to POH Fig 5-8 (2400 rpm / 6000 ft -> 108 KTAS at 57 %), e ~0.75.
    // Fixed gear (with speed fairings, POH Sec 1 note) and struts are in CD0.
    CD0: { x: [0, 10, 20, 30], y: [0.031, 0.037, 0.052, 0.072] },
    CDi_k: { x: [0, 10, 20, 30], y: [0.0567, 0.055, 0.053, 0.052] },
    CD_mach: { x: [0, 0.3], y: [0, 0.001] },
    CD_gear: 0,
    CD_spoiler: 0,
    // EST: no speedbrake; `surf.speedbrake` carries the cabin doors trailing ~3 in open in flight (logic.ts
    // updateDoors, 0.5 per door): ~0.05 m^2 of door edge and disturbed flow at CD ~1 over 16.2 m^2 = ~0.004 each.
    CD_speedbrake: 0.008,
    CD_groundSpoiler: 0,
    CD_beta: 0.17, // EST
    // Lateral-directional: Roskam, Airplane Flight Dynamics Part I, Appendix B (Cessna 172 cruise).
    CY_beta: -0.393,
    CY_dr: -0.053, // 0.187/rad x 16.2 deg rudder (TCDS)
    Cl_beta: -0.0923,
    Cl_p: -0.484,
    Cl_r: 0.0798,
    Cl_da: 0.054, // 0.178/rad x 17.5 deg mean aileron travel (TCDS: 20 up / 15 down)
    Cl_dr: -0.004, // EST (Roskam 0.0147/rad, sign per pilot convention)
    Cl_spoiler: 0,
    Cl_trim: 0.054, // aileron rigging expressed in aileron units (systems/flight.ts C172Rigging)
    // Pitch: EST static margin ~12 % (Cm_alpha -0.0107/deg), benign nose-down stall break.
    Cm_alpha: { x: [-30, -16, 0, 16, 18, 20, 25, 30, 45, 90], y: [0.32, 0.171, 0, -0.171, -0.21, -0.25, -0.32, -0.38, -0.5, -0.7] },
    Cm0: -0.03, // EST: near-neutral trim in 2400 rpm cruise
    Cm_q: -12.4, // Roskam 172
    Cm_alphadot: -5.2, // Roskam 172
    Cm_de: 0.45, // EST (Roskam -1.28/rad x ~0.35 rad effective)
    Cm_trim: 0.18, // EST: trim tab (TCDS 22 up / 19 down) trims ~60-65 KIAS clean at forward CG
    Cm_flap: { x: [0, 10, 20, 30], y: [0, 0.005, 0.01, 0.01] }, // EST: high-wing flaps -> slight nose-up
    Cm_gear: 0,
    Cm_spoiler: 0,
    Cn_beta: 0.0587,
    Cn_p: -0.0278,
    Cn_r: -0.0937,
    Cn_da: -0.0053, // Roskam -0.0168/rad x 0.305 rad (adverse yaw)
    Cn_dr: 0.0186, // Roskam -0.0657/rad x 16.2 deg (pilot sign)
    Cn_trim: 0.0186, // rudder ground-adjustable tab expressed in rudder units (C172Rigging)
    alphaStall_deg: { x: [0, 10, 20, 30], y: [16, 16, 15, 15] },
    propwashElevatorGain: 0.5, // EST: tail partly immersed in the slipstream
  },
  mass: {
    // POH Sec 1 standard empty weight 1663 lb includes unusable fuel (3.0 gal) and full oil;
    // the unusable fuel is carried in the tank masses here.
    emptyMass_kg: (LIMITS.standardEmptyLb - 2 * FUEL_DATA.tankUnusableGal * 6) * LB_TO_KG,
    emptyCg_m: [0, 0, 0],
    // EST: JSBSim c172p gross inertias (1285/1825/2667 kg m^2) scaled ~0.72 to empty weight.
    Ixx: 925,
    Iyy: 1314,
    Izz: 1920,
    Ixz: 0,
    maxTakeoffMass_kg: LIMITS.maxTakeoffLb * LB_TO_KG,
    maxLandingMass_kg: LIMITS.maxLandingLb * LB_TO_KG,
    maxZeroFuelMass_kg: LIMITS.maxTakeoffLb * LB_TO_KG, // no MZFW limit in the POH
    macLeadingEdge_m: sta(25.9), // TCDS: LEMAC 25.9 in aft of datum
    tanks: [
      // TCDS: two 28 gal tanks at 48.0 in aft of datum
      { name: 'Left wing', position_m: [sta(48.0), -TANK_Y, TANK_Z], capacity_kg: TANK_KG, unusable_kg: UNUSABLE_KG },
      { name: 'Right wing', position_m: [sta(48.0), TANK_Y, TANK_Z], capacity_kg: TANK_KG, unusable_kg: UNUSABLE_KG },
    ],
    stations: [
      // POH Fig 6-5: pilot and front passenger 340 lb at moment 12.6 -> 37.1 in (TCDS 34.0-46.0 in)
      { name: 'Pilot', position_m: [sta(37.1), -0.3, -0.25], defaultMass_kg: 170 * LB_TO_KG, maxMass_kg: 400 * LB_TO_KG },
      { name: 'Front passenger', position_m: [sta(37.1), 0.3, -0.25], defaultMass_kg: 0, maxMass_kg: 400 * LB_TO_KG },
      // TCDS: rear seats at 73.0 in
      { name: 'Rear passengers', position_m: [sta(73.0), 0, -0.25], defaultMass_kg: 0, maxMass_kg: 400 * LB_TO_KG },
      // POH / TCDS: baggage area 1 sta 82-108 (120 lb), area 2 sta 108-142 (50 lb)
      { name: 'Baggage area 1', position_m: [sta(95), 0, -0.15], defaultMass_kg: 0, maxMass_kg: LIMITS.baggageArea1Lb * LB_TO_KG },
      { name: 'Baggage area 2', position_m: [sta(125), 0, -0.1], defaultMass_kg: 0, maxMass_kg: LIMITS.baggageArea2Lb * LB_TO_KG },
    ],
  },
  engines: [C172S_ENGINE],
  gear: [
    {
      name: 'Nose',
      // Air/oil strut. Contact raised so the airplane sits level (POH Fig 1-1 note 6).
      position_m: [sta(NOSE_STA), 0, GROUND_Z + 0.088],
      gearIndex: 0,
      springK_Npm: 40000, // EST oleo: ~0.08 m static deflection at ~3.2 kN
      dampingC_Nspm: 3400,
      travel_m: 0.18,
      staticFriction: 0.8,
      dynamicFriction: 0.6,
      rollingFriction: 0.02,
      brake: null,
      brakeCoeff: 0,
      steerable: true,
      maxSteer_deg: 10, // POH Sec 7 "Ground control": ~10 deg each side through the steering bungee
      castering: true, // spring bungee: castors up to 30 deg with differential braking (POH Sec 7)
      retractable: false,
    },
    mainGear('Left main', -MAIN_Y, 1, 'left'),
    mainGear('Right main', MAIN_Y, 2, 'right'),
    // Tail tie-down ring / tail cone bottom (POH three-view), wingtips and belly.
    structure('Tail', [sta(230), 0, GROUND_Z - 0.95]),
    structure('Left wingtip', [sta(45), -5.45, GROUND_Z - 2.25]),
    structure('Right wingtip', [sta(45), 5.45, GROUND_Z - 2.25]),
    structure('Belly', [sta(10), 0, GROUND_Z - 0.42]),
    structure('Propeller tip', [sta(-38.2), 0, GROUND_Z - 0.286]), // POH Fig 1-1 note 3: 11.25 in clearance
  ],
  eyeHeightOnGround_m: 1.5,
  radioAltOffset_m: GROUND_Z + 0.017,
  limits: {
    vmo_kt: 163, // POH Sec 2: Vne 163 KIAS
    mmo: 0.3,
    maxLoadFactor: 3.8, // POH Sec 2: normal category +3.8 g
    minLoadFactor: -1.52,
    maxSinkRateOnGround_fpm: 800, // EST: ~1.5x the 14 CFR 23.473 limit descent velocity (~520 fpm at 14.7 lb/sq ft)
  },
};

function mainGear(name: string, y: number, idx: number, brake: 'left' | 'right'): GearContactConfig {
  return {
    name,
    // Tubular spring-steel legs (POH Sec 7 "Landing gear system").
    position_m: [sta(MAIN_STA), y, GROUND_Z + 0.08],
    gearIndex: idx,
    springK_Npm: 60000, // EST: spring-steel leg ~0.065 m static deflection
    dampingC_Nspm: 3800,
    travel_m: 0.15,
    staticFriction: 0.8,
    dynamicFriction: 0.6,
    rollingFriction: 0.02,
    brake,
    brakeCoeff: 0.55, // single-disc hydraulic brakes (POH Sec 7 "Brake system"); EST mu
    steerable: false,
    maxSteer_deg: 0,
    castering: false,
    retractable: false,
  };
}

function structure(name: string, p: [number, number, number]): GearContactConfig {
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

/**
 * Variant FDM: the base config with extra installed equipment (lb at a station).
 * G1000 NXi airplanes are heavier than the steam 172S (EST from the equipment lists: GDU
 * displays, GIA/GEA/GRS/GDC units, standby battery 14.0 lb at 11.2 in).
 */
export function withEquipment(base: FdmConfig, extraLb: number, armIn: number): FdmConfig {
  const m0 = base.mass.emptyMass_kg;
  const dm = extraLb * LB_TO_KG;
  const x = sta(armIn);
  // The datum stays at the steam empty CG; the heavier airplane's empty CG shifts by dm*x/(m0+dm).
  return {
    ...base,
    mass: { ...base.mass, emptyMass_kg: m0 + dm, emptyCg_m: [(dm * x) / (m0 + dm), 0, 0] },
  };
}
