/**
 * Common engine-model interface used by the FlightModel.
 *
 * Engines read their own input vars (`eng{i}.*`, `ice.inlet{i}`) and write
 * their output vars inside `step()`. All var names are precomputed in the
 * constructor so the per-step path does not allocate strings.
 */
import { Vec3 } from '../../core/linalg';

/** Ambient/flight conditions handed to every engine each physics step (one shared, reused object). */
export interface EngineEnv {
  pressure_Pa: number;
  temperature_K: number;
  density_kgm3: number;
  speedOfSound_ms: number;
  /** Pressure altitude (ft, 29.92 datum). */
  pressureAltitude_ft: number;
  /** Temperature deviation from ISA at this pressure level (K). */
  isaDeviation_K: number;
  mach: number;
  /** True airspeed (m/s). */
  tas_ms: number;
  /** Airspeed component along the body x axis (m/s), for propeller advance ratio. */
  axialSpeed_ms: number;
  /** Dynamic pressure (Pa). */
  qbar_Pa: number;
  /** Angle of attack / sideslip (rad), for P-factor. */
  alpha_rad: number;
  beta_rad: number;
  onGround: boolean;
}

export function createEngineEnv(): EngineEnv {
  return {
    pressure_Pa: 101325,
    temperature_K: 288.15,
    density_kgm3: 1.225,
    speedOfSound_ms: 340.294,
    pressureAltitude_ft: 0,
    isaDeviation_K: 0,
    mach: 0,
    tas_ms: 0,
    axialSpeed_ms: 0,
    qbar_Pa: 0,
    alpha_rad: 0,
    beta_rad: 0,
    onGround: true,
  };
}

export interface EngineModel {
  /** 1-based engine number (matches `eng{i}.*` vars). */
  readonly index: number;
  readonly kind: 'turbofan' | 'piston';
  /** Thrust application point (body m, datum frame). */
  readonly position: Vec3;
  /** Unit thrust direction (body). */
  readonly axis: Vec3;
  /** Net thrust along `axis` (N); negative for reverse thrust / windmill drag. */
  readonly thrust_N: number;
  /** Extra body moment (N·m) besides the thrust-line moment: torque reaction, P-factor, slipstream yaw. */
  readonly extraMoment: Vec3;
  /** Angular momentum of the rotating assembly (kg·m²/s, body axes) for gyroscopic coupling. */
  readonly angularMomentum: Vec3;
  /** Slipstream dynamic-pressure increment over the tail (Pa); 0 for turbofans. */
  readonly propwashDq_Pa: number;
  /** True while combustion is sustained and the engine is at or above idle. */
  readonly running: boolean;
  /** Fuel flow (kg/s) currently consumed (the fuel system burns it from the tanks). */
  readonly fuelFlow_kgs: number;
  /** Advances the engine one step, reading inputs and writing output vars. */
  step(dt: number, env: EngineEnv): void;
  /** Instantly stabilizes the engine running at the commanded power (true) or shut down and cold (false). */
  setRunning(running: boolean, env: EngineEnv): void;
}
