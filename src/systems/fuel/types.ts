/**
 * Configuration types for `FuelSystem` (FuelSystem.ts). Masses in kg, flows
 * in lb/h (pph, matching `eng{i}.ff_pph`), pressures in psi.
 */
import type { Binding } from '../util/binding';

export interface FuelTankDef {
  id: string;
  /** Index into `FdmConfig.mass.tanks` (the FDM reads `fuel.tank{index}_kg`). */
  index: number;
  capacityKg: number;
  /** Unusable fuel (kg): pumps and gravity feed stop drawing at this level. Default 0. */
  unusableKg?: number;
  /** Initial mass when `fuel.tank{index}_kg` is not yet set (default: full). */
  initialKg?: number;
  /** Low-level annunciation threshold (kg); `fuel.<id>_low`. */
  lowLevelKg?: number;
  /** Quantity gauging: power (gauge reads 0 when unpowered, default powered) and indication lag (s, default 2). */
  gauge?: { power?: Binding; lagS?: number };
  /** Leak rate while `fail.fuel.<id>.leak` is active (pph). Default max(600, 10 % of capacity per hour) (EST: a significant but not catastrophic leak). */
  leakPph?: number;
}

export type FuelPumpKind = 'electric' | 'ejector' | 'engine' | 'gravity';

export interface FuelPumpDef {
  id: string;
  /**
   * 'electric' boost/standby/aux pumps, 'ejector' (jet/motive-flow pumps
   * powered by high-pressure fuel returned from the engine), 'engine'
   * (engine-driven, in-line), 'gravity' (gravity head from a tank).
   */
  kind: FuelPumpKind;
  /** Source: a tank id (tank-mounted pumps, gravity feed) or a node id (in-line pumps). */
  from: string;
  /** Destination node id. */
  to: string;
  /** Outlet pressure at zero flow (psi). Gravity: head (e.g. 0.5). */
  pressurePsi: number;
  /** Maximum flow (pph). */
  maxFlowPph: number;
  /** Pump running: electric = switch && power, ejector = motive flow, engine = drive. Default true. */
  on?: Binding;
  /** Pump LOW PRESSURE light threshold (psi): `fuel.<id>_lowpress` = commanded on but outlet below it. Default 0.5 × pressurePsi. */
  lowPressPsi?: number;
  /**
   * When true the LOW PRESSURE output is also on while the pump is switched
   * off (737NG main-tank pump lights; centre-tank lights are inhibited with the
   * switch off, so leave this false for those). Default false.
   */
  lowPressWhenOff?: boolean;
  /** Electric pumps: current at max flow (A) -> `fuel.<id>_amps` for an electrical load binding. */
  ratedAmps?: number;
}

export interface FuelValveDef {
  id: string;
  /** Node ids joined when open. */
  a: string;
  b: string;
  /** Command: true = open. */
  open: Binding;
  /** Full travel time (s), default 1 (motorised gate/ball valves: 1-3 s typical, EST). 0 = instant (mechanical selector). */
  travelS?: number;
  /** Motorised valves only move while powered (default: always). */
  power?: Binding;
  /** Initial position (0..1), default = command at construction. */
  initial?: number;
}

export interface FuelConsumerDef {
  id: string;
  /** Node the consumer draws from. */
  node: string;
  /** Fuel demand (pph), e.g. 'eng1.ff_pph' or 'apu.ff_pph'. */
  flowPph: Binding;
  /** When set, the fuel system writes `eng{engine}.fuel_on` for this consumer. */
  engine?: number;
  /**
   * Engine run/cutoff command: start lever RUN, fuel control switch, FADEC
   * fuel command. Default 1. `eng.fuel_on` = run && feed adequate.
   */
  run?: Binding;
  /** Minimum inlet pressure (psi) for feed to count as adequate. Default 0.05. */
  minPressPsi?: number;
  /**
   * Suction feed: the engine-driven pump lifts fuel from `tank` without boost
   * pressure while the engine turns (`running`, default `eng{engine}.n2_pct > 20`)
   * and the aircraft is below `ceilingFt` (default 25,000 ft, EST; 737-type
   * suction feed is limited at high altitude by fuel vapour).
   */
  suction?: { tank: string; ceilingFt?: number; running?: Binding };
}

export interface FuelTransferDef {
  id: string;
  from: string;
  to: string;
  /** 'pumped': constant rate while active. 'gravity': rate scales with the level difference. */
  kind: 'pumped' | 'gravity';
  ratePph: number;
  active: Binding;
  /** Gravity: fill-fraction difference giving the full rate (default 0.2). */
  fullRateLevelDiff?: number;
  /** Gravity: flow either way (crossflow valve). Default false (from -> to only). */
  bidirectional?: boolean;
  /** Pumped transfer stops when the destination reaches this fraction of capacity (default 1). */
  stopAtFraction?: number;
}

export interface FuelSystemConfig {
  /** Var prefix (default 'fuel.'). */
  prefix?: string;
  tanks: FuelTankDef[];
  /** Manifold/junction nodes. */
  nodes: string[];
  pumps: FuelPumpDef[];
  valves?: FuelValveDef[];
  consumers: FuelConsumerDef[];
  transfers?: FuelTransferDef[];
  /** Lateral imbalance: `fuel.imbalance_kg` = left − right, `fuel.imbalance` when |Δ| ≥ alertKg. */
  balance?: { left: string; right: string; alertKg: number };
  /** Bulk fuel temperature model (optional): tanks approach `skin` (default 'fdm.tat_c') with τ = tauFullS × fill fraction. */
  temperature?: { skin?: Binding; tauFullS?: number; initialC?: number };
  /** Aircraft altitude for suction-feed ceilings (default 'fdm.press_alt_ft'). */
  altitude?: Binding;
}
