/**
 * Flight dynamics configuration supplied by each aircraft module.
 *
 * All values SI unless suffixed. Body axes: x forward, y right, z down, origin
 * at the aircraft reference datum (by convention the empty-weight CG at gear
 * down). Positions are metres from that datum.
 *
 * The aerodynamic model is a coefficient build-up over normalized control
 * inputs (see `vars.ts` SURF, pilot-intuitive signs). Derivatives with respect
 * to a normalized surface command are per unit command (full deflection = 1).
 */

/** Linear interpolation table, clamped at the ends. `x` strictly increasing. */
export interface Table1D {
  x: number[];
  y: number[];
}

/** Bilinear table: z[i][j] is the value at (x[i], y[j]). Clamped at the ends. */
export interface Table2D {
  x: number[];
  y: number[];
  z: number[][];
}

export interface AeroConfig {
  wingArea_m2: number;
  span_m: number;
  mac_m: number;
  /** Aerodynamic reference point (usually 25% MAC) relative to datum. */
  refPoint_m: [number, number, number];

  // ---- Lift ----
  /** CL vs alpha (deg) and flap angle (deg). Must cover post-stall (e.g. -180..180). */
  CL: Table2D;
  /** CL increment per unit (+ nose up) elevator command. */
  CL_de: number;
  /** Pitch-rate damping of lift, per rad of (q * mac / 2V). */
  CL_q: number;
  CL_alphadot: number;
  /** CL change at full symmetric spoiler/speedbrake deployment (negative). */
  CL_spoiler: number;
  CL_groundSpoiler: number;
  /** CL increment at full slat extension (optional, adds to max-CL region). */
  CL_slats?: number;
  /** Ground-effect multiplier on induced drag vs height/span (1 = none). */
  groundEffectDrag: Table1D;
  /** Ground-effect multiplier on lift vs height/span. */
  groundEffectLift: Table1D;
  /** Mach correction multiplier on CL slope (optional). */
  CL_mach?: Table1D;

  // ---- Drag ----
  /** Parasite drag vs flap angle (deg). */
  CD0: Table1D;
  /** Induced-drag factor k in CDi = k * CL^2 (vs flap angle deg). */
  CDi_k: Table1D;
  /** Wave drag increment vs Mach. */
  CD_mach: Table1D;
  /** Extra drag with gear fully extended. */
  CD_gear: number;
  CD_spoiler: number;
  CD_speedbrake: number;
  CD_groundSpoiler: number;
  CD_beta: number; // per rad^2 of sideslip
  /** Post-stall / high-alpha drag vs alpha (deg), added on top. */
  CD_alpha?: Table1D;

  // ---- Side force ----
  CY_beta: number; // per rad
  CY_dr: number; // per unit rudder command

  // ---- Roll moment ----
  Cl_beta: number; // per rad (dihedral effect, negative for stability)
  Cl_p: number; // per rad of (p * span / 2V)
  Cl_r: number;
  Cl_da: number; // per unit aileron command (+ = right roll)
  Cl_dr: number;
  /** Roll moment per unit differential spoiler (right minus left). */
  Cl_spoiler: number;
  Cl_trim?: number; // per unit aileron trim

  // ---- Pitch moment ----
  /** Cm vs alpha (deg) at flaps up about refPoint (includes stall break / pitch-up). */
  Cm_alpha: Table1D;
  Cm0: number;
  Cm_q: number; // per rad of (q * mac / 2V)
  Cm_alphadot: number;
  Cm_de: number; // per unit elevator command (+ = nose up)
  Cm_trim: number; // per unit pitch trim (+ = nose up)
  /** Pitch moment increment vs flap angle (deg). */
  Cm_flap: Table1D;
  Cm_gear: number;
  Cm_spoiler: number;
  /** Mach tuck / pitch moment increment vs Mach. */
  Cm_mach?: Table1D;
  /** Thrust-line pitch coupling is computed from engine positions; no term needed. */

  // ---- Yaw moment ----
  Cn_beta: number; // per rad (weathercock stability, positive)
  Cn_p: number;
  Cn_r: number;
  Cn_da: number; // adverse yaw per unit aileron
  Cn_dr: number; // per unit rudder (+ = yaw right)
  Cn_trim?: number; // per unit rudder trim

  /** Stall AoA (deg) vs flap angle for the stall-proximity output `fdm.stall_warning`. */
  alphaStall_deg: Table1D;
  /** Downwash / propwash effects are optional per aircraft. */
  propwashElevatorGain?: number;
  /** Structural speed/overspeed buffet thresholds for sound & shake. */
  buffetMach?: number;
}

export interface TurbofanConfig {
  kind: 'turbofan';
  name: string;
  position_m: [number, number, number];
  /** Unit thrust direction in body axes (usually [1,0,0] or slightly canted). */
  thrustAxis: [number, number, number];
  /** Sea-level static max takeoff thrust (N) at ISA. */
  maxThrust_N: number;
  /** Thrust available fraction vs Mach (rows) and pressure altitude ft (cols). */
  thrustLapse: Table2D;
  /** N1 (%) at which maxThrust is produced (sea level static). */
  n1Max_pct: number;
  n1Idle_pct: number;
  n2Idle_pct: number;
  n2Max_pct: number;
  /** Net thrust fraction vs N1 fraction of n1Max (0..1 -> 0..1), static. */
  thrustVsN1: Table1D;
  /** First-order spool time constants (s) accelerating / decelerating near idle and near max. */
  spoolUpTau_s: Table1D; // vs N2 %
  spoolDownTau_s: Table1D; // vs N2 %
  /** Thrust-specific fuel consumption, kg/(N·h), vs N1 fraction. */
  tsfc: Table1D;
  idleFuelFlow_pph: number;
  /** ITT at idle and at max continuous, plus start peak. */
  ittIdle_c: number;
  ittMax_c: number;
  ittStartPeak_c: number;
  /** Starter behaviour: N2 reached on starter alone and light-off N2. */
  starterMaxN2_pct: number;
  lightOffN2_pct: number;
  /** Time (s) from light-off to stabilized idle at ISA. */
  startToIdle_s: number;
  oilPressIdle_psi: number;
  oilPressMax_psi: number;
  oilTempNormal_c: number;
  /** Reverse thrust fraction of forward thrust at full reverse N1 (0 if no reverser). */
  reverseEfficiency: number;
  /** Max bleed pressure (psi) at max N2. */
  bleedPressMax_psi: number;
  /** Windmill N1/N2 per knot TAS (for air-start and in-flight shutdown). */
  windmillN1PerKt: number;
  windmillN2PerKt: number;
}

export interface PistonConfig {
  kind: 'piston';
  name: string;
  position_m: [number, number, number];
  thrustAxis: [number, number, number];
  ratedPower_hp: number;
  ratedRpm: number;
  displacement_cuin: number;
  compressionRatio: number;
  idleRpm: number;
  /** Fixed-pitch propeller. */
  propDiameter_m: number;
  propPitch_in: number;
  /** Propeller thrust coefficient CT vs advance ratio J. */
  propCT: Table1D;
  /** Propeller power coefficient CP vs advance ratio J. */
  propCP: Table1D;
  propInertia_kgm2: number;
  /** Engine + prop rotational friction torque at idle (N·m). */
  frictionTorque_Nm: number;
  starterTorque_Nm: number;
  /** Best-power mixture ratio and fuel flow at rated power (gph). */
  ratedFuelFlow_gph: number;
  oilPressNormal_psi: number;
  oilTempNormal_f: number;
  chtNormal_f: number;
  egtPeak_f: number;
}

export type EngineConfig = TurbofanConfig | PistonConfig;

export interface GearContactConfig {
  name: string;
  /** Contact point with the strut fully extended (m, body). */
  position_m: [number, number, number];
  /** Index into GEAR.pos(i) for retraction state; -1 for fixed structure contacts. */
  gearIndex: number;
  springK_Npm: number;
  dampingC_Nspm: number;
  /** Max strut travel (m). */
  travel_m: number;
  staticFriction: number;
  dynamicFriction: number;
  rollingFriction: number;
  /** 'left' | 'right' brake group, or null if no brake. */
  brake: 'left' | 'right' | null;
  /** Max braking force coefficient at full brake. */
  brakeCoeff: number;
  steerable: boolean;
  maxSteer_deg: number;
  /** Castering nosewheel (free when not steered, e.g. 172 above steering limits). */
  castering: boolean;
  retractable: boolean;
  /** Structure contacts (tail skid, wingtips, belly) — crash if exceeded. */
  isStructure?: boolean;
}

export interface FuelTankConfig {
  name: string;
  position_m: [number, number, number];
  capacity_kg: number;
  /** Unusable fuel (kg). */
  unusable_kg: number;
}

export interface PayloadStationConfig {
  name: string;
  position_m: [number, number, number];
  defaultMass_kg: number;
  maxMass_kg: number;
}

export interface MassConfig {
  emptyMass_kg: number;
  emptyCg_m: [number, number, number];
  /** Inertia about CG at empty weight (kg·m²). */
  Ixx: number;
  Iyy: number;
  Izz: number;
  Ixz: number;
  maxTakeoffMass_kg: number;
  maxLandingMass_kg: number;
  maxZeroFuelMass_kg: number;
  /** MAC leading edge x-position (m, body) for %MAC output. */
  macLeadingEdge_m: number;
  tanks: FuelTankConfig[];
  stations: PayloadStationConfig[];
}

export interface FdmConfig {
  aero: AeroConfig;
  mass: MassConfig;
  engines: EngineConfig[];
  gear: GearContactConfig[];
  /** Pitot/static and AoA vane locations are not modelled separately. */
  /** Eye height above gear-contact plane on ground (m), used for camera sanity checks. */
  eyeHeightOnGround_m?: number;
  /** Radio altimeter reference offset: height of main-gear bottom below datum (m, positive). */
  radioAltOffset_m: number;
  /** Structural limits used for crash/overstress detection. */
  limits: {
    vmo_kt: number;
    mmo: number;
    maxLoadFactor: number;
    minLoadFactor: number;
    maxSinkRateOnGround_fpm: number;
  };
}

// ---------------------------------------------------------------------------
// Appended by the physics module (append-only; see CLAUDE.md shared contracts).
// ---------------------------------------------------------------------------

/**
 * Optional piston-engine refinements, merged into `PistonConfig` below (all
 * fields optional, so existing configs keep compiling). Read by
 * `physics/engines/Piston.ts`.
 */
export interface PistonConfigExtras {
  /**
   * 'injected' (default; e.g. IO-360-L2A with RSA servo: aux pump + open
   * mixture primes the cylinders) or 'carbureted' (only `eng.primer` primes).
   */
  induction?: 'injected' | 'carbureted';
  /**
   * Propeller rotation seen from the cockpit: 1 = clockwise (Lycoming/
   * Continental tractor default), -1 = counter-clockwise. Sets the sign of
   * torque reaction, P-factor, slipstream yaw and gyroscopic moments.
   */
  propRotation?: 1 | -1;
  /** P-factor lateral thrust offset per radian of AoA, as a fraction of prop radius (default 0.35). */
  pFactorCoeff?: number;
  /** Spiral-slipstream yaw coefficient: N = -k * dq_prop * S * b (default 0.004). */
  slipstreamYawCoeff?: number;
  /** Full-rich fuel/air ratio at sea level as a multiple of best-power FAR (default 1.12). */
  fullRichFactor?: number;
}

/** Turbofan refinements (all optional), merged into `TurbofanConfig` below. Read by `physics/engines/Turbofan.ts`. */
export interface TurbofanConfigExtras {
  /** Starter time constant (s) spooling N2 toward starterMaxN2 (default 4). */
  starterTau_s?: number;
  /** N2 (%) above which the core self-sustains without the starter (default 0.75 * n2Idle). */
  selfSustainN2_pct?: number;
  /** ITT limit (degC) used only to scale the hot-start overshoot (default ittStartPeak + 150). */
  ittStartLimit_c?: number;
  /** N1 (%) vs N2 (%) mapping exponent above idle (default 1.3). */
  n1MapExponent?: number;
}

// Declaration merging: the optional extras become part of the config
// interfaces themselves, so aircraft may set them in plain object literals.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PistonConfig extends PistonConfigExtras {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TurbofanConfig extends TurbofanConfigExtras {}
