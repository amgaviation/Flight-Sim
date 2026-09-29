/**
 * Configuration types for `ElectricalNetwork` (see ElectricalNetwork.ts for
 * the solver and docs/modules/systems-power.md for the full reference).
 *
 * Units: volts (V), amps (A), volt-amperes (VA / kVA), hertz (Hz), seconds.
 * Every `Binding` is a number, boolean, expression string or callback
 * (src/systems/util/binding.ts).
 */
import type { Binding } from '../util/binding';
import type { Table1D } from '../../physics/types';

export type BusType = 'dc' | 'ac';

export interface BusDef {
  id: string;
  /** Default 'dc'. */
  type?: BusType;
  /** Nominal voltage: default 28 (DC) or 115 (AC). Used for resistive-load scaling. */
  nominalV?: number;
  /**
   * `elec.<id>_powered` = voltage >= poweredV. Default 18 V DC (DO-160 Section
   * 16, 28 V DC emergency-operation minimum 18 V) or 100 V AC (DO-160 normal
   * AC range 100-122 V).
   */
  poweredV?: number;
}

/**
 * Thermal circuit breaker. `name` maps to the cockpit var `cb.<name>` (1 = in,
 * 0 = pulled/tripped; missing = in) and `cb.<name>_tripped` (1 after an
 * overcurrent trip; the cockpit `CircuitBreaker` control's `trippedVar`).
 * Several loads may share one breaker by using the same name.
 */
export interface CircuitBreakerDef {
  name: string;
  /** Rated current (A). Trip-time curve: see ElectricalNetwork `CB_*` constants. */
  ratingA: number;
}

/** Relay/contactor coil: the contact can only close while the coil bus voltage is high enough. */
export interface CoilDef {
  /** Bus supplying the coil (default: the component's own bus / link side `a`). */
  bus?: string;
  /** Coil pull-in voltage (V). */
  pickupV: number;
  /** Coil drop-out voltage (V), < pickupV. */
  dropoutV: number;
  /** Pull-in delay (s), default 0.02 (EST: typical 10-25 ms contactor operate time). */
  pickupDelayS?: number;
}

/** Connection between two buses of the same type. */
export interface LinkDef {
  id: string;
  a: string;
  b: string;
  /**
   * 'contactor' (default): bidirectional, closed while `closed` is true.
   * 'diode': current only flows a -> b (isolation/steering diodes), and only while `closed`.
   */
  kind?: 'contactor' | 'diode';
  /** Command (switch logic / automatic logic). Default: always closed. */
  closed?: Binding;
  coil?: CoilDef;
  /** Feeder breaker in series with the link. */
  cb?: CircuitBreakerDef;
}

export type LoadModel = 'constant-current' | 'resistive';

export interface LoadDef {
  id: string;
  bus: string;
  /** DC buses: current (A) at nominal voltage. Binding, so it can follow system state (e.g. 'hyd.acmp_a_amps'). */
  amps?: Binding;
  /** AC buses: apparent power (VA). */
  va?: Binding;
  /**
   * 'constant-current' (default; avionics, motors with regulated supplies): full
   * current down to ~0.5·minV, then linear to 0. 'resistive' (lamps, heaters):
   * current scales with V / nominalV.
   */
  model?: LoadModel;
  /** Load switched on (default true). A disabled load is unpowered and draws nothing. */
  enabled?: Binding;
  /** Load-shedding command: true = disconnected. */
  shed?: Binding;
  cb?: CircuitBreakerDef;
  /** Minimum voltage for `elec.<id>_powered` (default: the bus poweredV). */
  minV?: number;
  /** Optional relay feeding the load (coil defaults to the load's bus). */
  contactor?: CoilDef;
}

export type BatteryChemistry = 'lead-acid' | 'nicd' | 'li-ion';

export interface BatteryThermalDef {
  /** Heat capacity (J/K). */
  heatCapacityJK: number;
  /** Heat transfer to ambient (W/K). */
  coolingWK: number;
  /** `elec.<id>_overtemp` threshold (°C). */
  overTempC: number;
}

export interface BatteryDef {
  id: string;
  /** Bus the battery terminals connect to (usually a hot battery bus). */
  bus: string;
  chemistry?: BatteryChemistry;
  /** Number of cells (lead-acid 2.0 V/cell, NiCd 1.2, Li-ion LiFePO4 3.2). Default 12 / 20 / 8. */
  cells?: number;
  /** Rated capacity (Ah) at the one-hour rate. */
  capacityAh: number;
  /** Internal resistance at 25 °C (Ω). */
  internalResistanceOhm: number;
  /** Initial state of charge 0..1 (default 1; `elec.<id>_soc` overrides when set before construction). */
  initialSoc?: number;
  /** Open-circuit voltage per cell vs SOC (0..1); default from chemistry. */
  ocvPerCell?: Table1D;
  /** Terminal voltage at which a full battery accepts ~no current (default 28.5 V for 24 V batteries). */
  fullChargeV?: number;
  /** Charge-acceptance taper exponent (default 5, see Battery model). */
  chargeTaper?: number;
  /** Charge path resistance multiplier (default 3). */
  chargeResistanceFactor?: number;
  /** Max charge current in C (default 2.0). */
  maxChargeC?: number;
  /** Peukert exponent (default lead-acid 1.15, NiCd 1.05, Li-ion 1.03). */
  peukert?: number;
  /** Ambient temperature (°C) binding, e.g. 'fdm.sat_c' or a compartment temp. Default 20. */
  ambientC?: Binding;
  thermal?: BatteryThermalDef;
}

/** Electric starter motor (standalone, or the start mode of a starter-generator). */
export interface StarterDef {
  /** Start command (starter switch / key START / FADEC start request). */
  command: Binding;
  /** Bus the starter draws from (default: the generator bus, or `bus` for standalone starters). */
  bus?: string;
  /** Motor speed signal in engine units, e.g. 'eng1.n2_pct' or 'eng1.rpm'. */
  speed: Binding;
  /** Speed (same units) where back-EMF equals `nominalV` (motor no-load speed at nominal voltage). */
  noLoadSpeed: number;
  /** Armature + cable resistance (Ω). Locked-rotor current = V / resistance. */
  resistanceOhm: number;
  /** Start current limit (A) (soft-start / current-limited starters). Default: none. */
  currentLimitA?: number;
  /** Voltage at which the engine reaches its physics `starterMaxN2_pct` (turbine) or full starter torque (piston). Default 24. */
  nominalV?: number;
  /**
   * When set, the network drives this var (usually `ENG.starter(i)`) with the
   * electrically achievable starter strength (see util/starter.ts). The
   * FADEC/start logic must then write its request to the `command` var
   * instead of `eng{i}.starter`.
   */
  engineStarterVar?: string;
  /** Engine type for the starter PWM mapping. Default 'turbine'. */
  engineKind?: 'turbine' | 'piston';
  /** Engine `starterTau_s` if overridden in the FdmConfig (default 4). */
  engineStarterTau?: number;
  /** Start relay/solenoid: chatters and drops out on a flat battery. */
  contactor?: CoilDef;
  cb?: CircuitBreakerDef;
}

export interface StarterMotorDef extends StarterDef {
  id: string;
  bus: string;
}

export interface DcGeneratorDef {
  id: string;
  /** Bus the line contactor (GLC) connects to. */
  bus: string;
  kind?: 'starter-generator' | 'alternator' | 'generator';
  /** Regulated voltage (V), e.g. 28.5. */
  regulatedV: number;
  /** Rated output (A). `elec.<id>_load_pct` = amps / ratedA · 100. */
  ratedA: number;
  /** Current limit (A); default 1.5 × ratedA (starter-generators) or ratedA (alternators). */
  currentLimitA?: number;
  /** Output resistance inside the current limit (Ω), default 0.0015 (regulation at the point of regulation: ~0.2 V droop at 150 A). */
  outputResistanceOhm?: number;
  /** Drive speed, e.g. 'eng1.n2_pct' (starter-generator) or 'eng1.rpm' (alternator). */
  drive: Binding;
  /** Minimum drive for regulation / online (same units as `drive`). */
  minDrive: number;
  /** Alternators: max current vs drive (same units). Overrides currentLimitA when given. */
  maxAmpsVsDrive?: Table1D;
  /** GEN/ALT switch (default on). */
  switch?: Binding;
  /** Rising edge re-arms a tripped generator (GEN RESET). Cycling `switch` off->on also resets. */
  reset?: Binding;
  /** Field supply (alternators need bus power to excite: a flat battery prevents alternator excitation). */
  field?: { bus: string; minV: number };
  /** Over-voltage protection trip (V), default 32. */
  ovTripV?: number;
  /** Over-voltage trip delay (s), default 0.2. */
  ovTripDelayS?: number;
  starter?: StarterDef;
}

export interface AcGeneratorDef {
  id: string;
  bus: string;
  /** Rated output (kVA). */
  ratedKva: number;
  /** Default 115 V. */
  nominalV?: number;
  /** Constant frequency (IDG, APU generator, inverter-like sources; default 400 Hz) or Hz vs drive (VFG / RAT). */
  frequency?: number | Table1D;
  /** Drive: engine N2 %, APU N %, RAT/ADG airspeed... */
  drive: Binding;
  /** Minimum drive for the generator to be available (underspeed limit). */
  minDrive: number;
  /** Overspeed limit: above this the GCU trips (optional). */
  maxDrive?: number;
  /** Generator control switch (GCR/GCB command). Default on. */
  switch?: Binding;
  /** IDG/CSD drive disconnect command (rising edge latches until `reconnectDrive()`). */
  disconnect?: Binding;
  /** Rising edge resets a GCU trip. */
  reset?: Binding;
  /** Overload trip: load % above which the trip timer runs (default 150) and its delay (default 5 s). */
  overloadTripPct?: number;
  overloadTripS?: number;
}

export interface ExternalPowerDef {
  id: string;
  bus: string;
  type: BusType;
  /** GPU connected and producing power (e.g. 'ac.gpu_connected'). */
  available: Binding;
  /** EXT PWR switch / contactor command (default on). */
  switch?: Binding;
  /** Output voltage (default 28 DC / 115 AC). */
  voltage?: number;
  /** DC: current limit (A), default 1500 (start cart). */
  currentLimitA?: number;
  /** DC: output resistance (Ω), default 0.004. */
  resistanceOhm?: number;
  /** AC: rating (kVA), default 90. */
  ratedKva?: number;
  /** AC frequency, default 400. */
  frequency?: number;
}

/** Transformer-rectifier unit (also usable for battery chargers). */
export interface TruDef {
  id: string;
  acBus: string;
  dcBus: string;
  /** Rated DC output (A). */
  ratedA: number;
  /** Output at no load (V), default 28.5; at rated load `fullLoadV` (default 27.0). */
  noLoadV?: number;
  fullLoadV?: number;
  /** Current limit (A), default 1.3 × ratedA. */
  currentLimitA?: number;
  /** Efficiency (default 0.9) and power factor (default 0.95) for the AC-side load. */
  efficiency?: number;
  powerFactor?: number;
  /** Enable command (e.g. TR3 disconnect relay logic). Default on. */
  enabled?: Binding;
  /** Minimum AC input voltage (default 100). */
  minAcV?: number;
}

/** Static inverter (DC -> AC). */
export interface InverterDef {
  id: string;
  dcBus: string;
  acBus: string;
  /** Rated output (VA). */
  ratedVa: number;
  /** Efficiency (default 0.85). */
  efficiency?: number;
  enabled?: Binding;
  /** Minimum DC input for operation (default 20 V). */
  minDcV?: number;
  outputV?: number;
  frequency?: number;
}

export interface ElectricalConfig {
  /** Var prefix (default 'elec.'). All outputs are `<prefix><id>_<suffix>`. */
  prefix?: string;
  buses: BusDef[];
  batteries?: BatteryDef[];
  dcGenerators?: DcGeneratorDef[];
  acGenerators?: AcGeneratorDef[];
  externals?: ExternalPowerDef[];
  trus?: TruDef[];
  inverters?: InverterDef[];
  starters?: StarterMotorDef[];
  links?: LinkDef[];
  loads?: LoadDef[];
}
