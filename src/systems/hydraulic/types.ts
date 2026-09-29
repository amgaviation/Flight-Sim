/**
 * Configuration types for `HydraulicSystem` (HydraulicSystem.ts).
 * Pressures in psi, flows in litres per minute (L/min; 1 US gpm = 3.785 L/min),
 * volumes in litres.
 */
import type { Binding } from '../util/binding';

export interface HydSystemDef {
  id: string;
  /** Regulated system pressure (psi), e.g. 3000 (737NG A/B/standby, G650, Global 6000). */
  nominalPsi: number;
  /** Reservoir fluid capacity (L). `hyd.<id>_qty` = reservoir fluid / capacity. */
  reservoirL: number;
  /** Initial reservoir fill fraction with the system depressurised (default 1). */
  initialQty?: number;
  /** System accumulator: nitrogen precharge (psi) and total volume (L). */
  accumulator?: { prechargePsi: number; volumeL: number };
  /** Line and hose compliance (L per 1000 psi). Default 0.05 (EST). */
  complianceLPerKpsi?: number;
  /** Internal leakage at nominal pressure (L/min): valves, servo bypass. Default 0.8 (EST). */
  internalLeakLpm?: number;
  /** System relief valve cracking pressure (psi). Default 1.12 × nominal (EST). */
  reliefPsi?: number;
  /** `hyd.<id>_lowpress` threshold (psi). Default 0.5 × nominal. */
  lowPressPsi?: number;
  /** `hyd.<id>_lowqty` threshold (fraction), default 0.2 (737NG standby LOW QUANTITY at ≤ 20 %: smartcockpit 737NG hydraulics). */
  lowQty?: number;
  /** External leak (L/min at nominal pressure) while `fail.hyd.<id>.leak` is active. Default 4 (EST). */
  leakLpm?: number;
}

export type HydPumpKind = 'edp' | 'electric' | 'rat' | 'hand';

export interface HydPumpDef {
  id: string;
  system: string;
  kind: HydPumpKind;
  /** Pressure-compensator setting (psi); default the system nominal pressure. */
  ratedPsi?: number;
  /** Flow at full drive with zero back-pressure deficit (L/min). */
  maxFlowLpm: number;
  /**
   * Drive fraction 0..1. Variable-displacement pumps: flow capacity ∝ speed,
   * so an EDP uses e.g. `eng1.accessory_drive` (= N2/100); an electric pump
   * `elec.acmp_a_powered`; a RAT `clamp01(fdm.ias_kt / 130)`.
   */
  drive: Binding;
  /** ON/depressurise command (EDP switch, ACMP switch, AUTO logic). Default true. */
  on?: Binding;
  /** Compensator band (psi) over which flow falls from max to zero. Default 150 (EST). */
  bandPsi?: number;
  /** Pump LOW PRESSURE light threshold (psi). Default 1300 × ratedPsi/3000 (737NG: 1300 psi). */
  lowPressPsi?: number;
  /** When false the LOW PRESSURE output is off while the pump is switched off (default true: 737-style lights). */
  lowPressWhenOff?: boolean;
  /** Electric pumps: supply type for the current output (`hyd.<id>_amps` DC at 28 V, or `hyd.<id>_va` AC). */
  electric?: { supply: 'dc' | 'ac'; efficiency?: number; nominalV?: number; noLoadW?: number };
}

/**
 * Power transfer unit (motor in `from` driving a pump in `to`) or, with
 * `kind: 'check'`, a check-valve charging line (e.g. a brake accumulator
 * charged from a main system).
 */
export interface HydTransferDef {
  id: string;
  kind: 'ptu' | 'check';
  from: string;
  to: string;
  /** Max flow delivered into `to` (L/min). */
  maxFlowLpm: number;
  /** Operation command (PTU automatic logic). Default true. */
  active?: Binding;
  /** PTU: hydraulic power efficiency (default 0.8, EST). */
  efficiency?: number;
  /** PTU: also transfers power `to -> from` when that side is the lower one (bidirectional PTU). */
  bidirectional?: boolean;
  /** Bidirectional PTU: pressure difference that starts the transfer (psi), default 500 (EST, A320-type PTUs). */
  triggerDeltaPsi?: number;
}

export interface HydConsumerDef {
  id: string;
  system: string;
  /** Instantaneous demand (L/min), e.g. while the gear is travelling: 'gear.moving * 40'. */
  demandLpm: Binding;
  /** Pressure at which the consumer receives its full demand (default 0.5 × nominal); below it flow scales with pressure. */
  fullPsi?: number;
}

export interface HydraulicConfig {
  /** Var prefix (default 'hyd.'). */
  prefix?: string;
  systems: HydSystemDef[];
  pumps: HydPumpDef[];
  transfers?: HydTransferDef[];
  consumers?: HydConsumerDef[];
}
