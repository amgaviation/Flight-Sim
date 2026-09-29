/**
 * Battery chemistry data and reference battery definitions for the fleet.
 *
 * Internal resistance from Concorde's Ipp rating ("peak power current": the
 * current at which a 24 V battery's terminal voltage falls to 12 V):
 *   R ≈ (OCV_full − 12 V) / Ipp.
 * Temperature: Concorde RG24-15 Ipp is 1025 A at 23 °C and 600 A at −18 °C
 * (Concorde RG24-15 spec sheet), i.e. R rises ×1.7 over 41 °C -> +1.7 %/°C
 * below 25 °C (RESISTANCE_TEMP_COEFF).
 */
import type { Table1D } from '../../physics/types';
import type { BatteryChemistry, BatteryDef } from './types';

/**
 * Open-circuit volts per cell vs state of charge.
 * Lead-acid (VRLA/AGM): 2.15 V/cell full (Concorde: 24 V RG battery fully
 * charged OCV ≥ 25.8 V = 2.15 V/cell); 50 % ≈ 2.05, 25 % ≈ 2.00, 0 % ≈ 1.95
 * (typical AGM OCV/SOC chart, Battery University BU-903). Below "0 %" rated
 * capacity the voltage collapses (EST, 1.85 at SOC 0 so a flat battery sags hard).
 */
export const OCV_LEAD_ACID: Table1D = { x: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1], y: [1.85, 1.93, 1.97, 2.0, 2.05, 2.1, 2.15] };
/**
 * NiCd: flat 1.25-1.30 V plateau, ~1.33 V just off charge, steep knee below
 * ~10 % (typical sintered-plate aircraft NiCd discharge curve, Saft/Marathon
 * battery OMMs; EST shape). 20 cells -> 24 V nominal (737NG: 20-cell NiCd).
 */
export const OCV_NICD: Table1D = { x: [0, 0.05, 0.1, 0.3, 0.6, 0.9, 1], y: [1.05, 1.15, 1.2, 1.24, 1.26, 1.29, 1.33] };
/** LiFePO4 (8 cells = 25.6 V nominal, e.g. True Blue Power TB-series main batteries): flat 3.25-3.33 V plateau (EST from typical LFP OCV curve). */
export const OCV_LI_ION: Table1D = { x: [0, 0.05, 0.1, 0.2, 0.5, 0.8, 0.95, 1], y: [2.8, 3.05, 3.2, 3.25, 3.29, 3.32, 3.35, 3.45] };

export const DEFAULT_CELLS: Record<BatteryChemistry, number> = { 'lead-acid': 12, nicd: 20, 'li-ion': 8 };
export const DEFAULT_OCV: Record<BatteryChemistry, Table1D> = { 'lead-acid': OCV_LEAD_ACID, nicd: OCV_NICD, 'li-ion': OCV_LI_ION };
/** EST: Peukert exponents typical of each chemistry. */
export const DEFAULT_PEUKERT: Record<BatteryChemistry, number> = { 'lead-acid': 1.15, nicd: 1.05, 'li-ion': 1.03 };
/** Internal resistance temperature coefficient below 25 °C (per °C), from the Concorde Ipp ratio above. */
export const RESISTANCE_TEMP_COEFF = 0.017;
/** Capacity loss per °C below 25 °C (EST: lead-acid ~50 % at −25 °C), floor 0.4. */
export const CAPACITY_TEMP_COEFF: Record<BatteryChemistry, number> = { 'lead-acid': 0.01, nicd: 0.006, 'li-ion': 0.008 };

/**
 * Cessna 172S main battery: Concorde RG24-15, 24 V, 13.6 Ah (C1), Ipp 1025 A
 * at 23 °C (Concorde RG24-15 spec sheet; Textron part listing "RG24-15M ...
 * 24-Volt 13.6 AH", compatible with the 172). R = (25.8 − 12)/1025 ≈ 13.5 mΩ.
 */
export const BATTERY_172S_MAIN: Omit<BatteryDef, 'id' | 'bus'> = {
  chemistry: 'lead-acid',
  cells: 12,
  capacityAh: 13.6,
  internalResistanceOhm: 0.0135,
};

/**
 * Concorde RG-380E/44 (Citation / King Air / Learjet class main battery):
 * 24 V, 42 Ah (C1), Ipp 1350 A at 23 °C (Concorde RG-380E/44 data).
 * R = (25.8 − 12)/1350 ≈ 10 mΩ.
 */
export const BATTERY_RG380E44: Omit<BatteryDef, 'id' | 'bus'> = {
  chemistry: 'lead-acid',
  cells: 12,
  capacityAh: 42,
  internalResistanceOhm: 0.0102,
};

/** Boeing 737NG main battery: 20-cell NiCd, 24 V nominal, 48 Ah (aviationhunt ATA 24 notes). R: EST 12 mΩ. */
export const BATTERY_737NG_NICD: Omit<BatteryDef, 'id' | 'bus'> = {
  chemistry: 'nicd',
  cells: 20,
  capacityAh: 48,
  internalResistanceOhm: 0.012,
};

/** Gulfstream G650 main batteries: 28 VDC (nominal), 53 Ah NiCd, two installed (G650 electrical system study guides). R: EST 11 mΩ. */
export const BATTERY_G650_NICD: Omit<BatteryDef, 'id' | 'bus'> = {
  chemistry: 'nicd',
  cells: 20,
  capacityAh: 53,
  internalResistanceOhm: 0.011,
};

/**
 * Cessna 172S G1000 standby battery (feeds the essential bus for 30 min;
 * "at 20 volts the standby battery has little or no capacity remaining" —
 * UND C172S electrical system guide). Capacity EST: a small sealed lead-acid
 * pack, 24 V ~7 Ah gives ~30 min at the ~10-12 A essential load.
 */
export const BATTERY_172S_STANDBY: Omit<BatteryDef, 'id' | 'bus'> = {
  chemistry: 'lead-acid',
  cells: 12,
  capacityAh: 7,
  internalResistanceOhm: 0.04,
};
