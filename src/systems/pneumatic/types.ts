/**
 * Configuration types for `PneumaticSystem` (PneumaticSystem.ts).
 * Pressures psi (gauge), mass flows kg/s, temperatures °C.
 */
import type { Binding } from '../util/binding';

export interface BleedSourceDef {
  id: string;
  /** Duct (manifold) fed through this source's pressure-regulating shutoff valve (PRSOV). */
  duct: string;
  /** Port pressure available (psi), e.g. `eng1.bleed_press_psi`, 'apu.bleed_psi', or a ground-cart var. */
  pressure: Binding;
  /** Bleed/PRSOV command (BLEED switch, APU BLEED switch, automatic logic). Default true. */
  valve?: Binding;
  /** PRSOV regulated downstream pressure (psi). Default 45 (EST: typical 40-50 psig bleed regulation). */
  regulatedPsi?: number;
  /** Max mass flow at full port pressure (kg/s). */
  maxFlowKgs: number;
  /** Engine index: publishes `eng{i}.bleed_extract` = flow / maxFlow. */
  engine?: number;
  /** Rising edge clears an overheat/overpressure trip (TRIP RESET). */
  reset?: Binding;
  /** HP port: when the LP port pressure is below `belowPsi` the HP valve opens and pressure × `ratio` is available (EST idle descent). */
  hp?: {
    belowPsi: number;
    ratio: number;
    /**
     * (Appended by citation-longitude.) HP PRSOV regulation point (psi): the HP valve opens when the LP port is below
     * it (replacing `belowPsi`) and the HP supply is capped at it (Longitude OG 9-2: 31.5 psig, 52 psig with wing
     * anti-ice requested). Default: none (`belowPsi`, uncapped HP supply).
     */
    regulation?: Binding;
  };
  /** Valve travel time (s), default 1.5 (EST). */
  travelS?: number;
}

export interface PneuValveDef {
  id: string;
  /** Duct ids joined when open (isolation / crossbleed valves). */
  a: string;
  b: string;
  open: Binding;
  /** Travel time (s), default 3 (EST motorised butterfly). */
  travelS?: number;
  /** Motorised valves only move while powered. Default always. */
  power?: Binding;
}

export interface PneuConsumerDef {
  id: string;
  /** Duct the consumer draws from (ignored when `engine` is set). */
  duct?: string;
  /** Draws directly from this engine's own bleed port (e.g. nacelle anti-ice upstream of the PRSOV). */
  engine?: number;
  /** Engine port pressure binding when `engine` is set (default `eng{engine}.bleed_press_psi`). */
  enginePressure?: Binding;
  /** Demand at full operation (kg/s); 0 when off. E.g. 'ac.wing_ai * 0.25'. */
  demandKgs: Binding;
  /** Pressure for full function (psi). Default 20 (EST). */
  minPsi?: number;
}

export interface PackDef {
  id: string;
  duct: string;
  /** Pack valve open (PACK switch AUTO/HIGH). */
  on: Binding;
  /** Pack mass flow when fully supplied (kg/s): bind NORM/HIGH flow, e.g. 'ac.pack_l == 2 ? 0.9 : 0.6'. */
  flowKgs: Binding;
  /** Duct pressure for full flow (psi). Default 18 (EST). */
  minPsi?: number;
  /** Rising edge clears a pack overheat trip (PACK TRIP RESET). */
  reset?: Binding;
  /** Coldest / hottest outlet (°C). Defaults 2 / 70 (EST: water separator anti-ice limit / duct overheat margin). */
  minOutletC?: number;
  maxOutletC?: number;
  /**
   * (Appended by citation-longitude.) Outlet limits as bindings (°C), overriding minOutletC / maxOutletC while
   * given: pack modes that bypass the air-cycle machine or the heat exchangers change the reachable range.
   */
  minOutletCBinding?: Binding;
  maxOutletCBinding?: Binding;
}

export interface ZoneDef {
  id: string;
  /** Packs supplying the zone (share of their flow split equally among zones they feed). */
  packs: string[];
  /** Target temperature (°C) from the zone temperature selector. */
  target: Binding;
  /** Zone air volume (m³), default 30. */
  volumeM3?: number;
  /** Internal heat load (W): passengers ~100 W each, avionics, lights. Default 1500. */
  heatLoadW?: Binding;
  /** Heat capacity of air + furnishings (kJ/K). Default 25 × volume (EST). */
  heatCapacityKJK?: number;
  /** Skin heat transfer (W/K). Default 3 × volume (EST: insulated fuselage, ~20 kW loss for a narrow-body cabin at −30 °C). */
  skinUAWK?: number;
  /** Outside/skin temperature (°C), default 'fdm.tat_c'. */
  skin?: Binding;
  initialC?: number;
}

export interface AirStarterDef {
  id: string;
  engine: number;
  duct: string;
  /** Start valve command (engine start switch GRD / FADEC start request). */
  command: Binding;
  /** Start valve solenoid power (default always). */
  valvePower?: Binding;
  /** Duct pressure at which the engine reaches its physics starterMaxN2 (psi). */
  nominalPsi: number;
  /** Air consumed at nominal pressure (kg/s). Default 1.0 (EST). */
  demandKgs?: number;
  /** Var driven with the pneumatic starter strength, default `eng{engine}.starter`. */
  engineStarterVar?: string;
  /** Engine `starterTau_s` if overridden (default 4). */
  engineStarterTau?: number;
}

export interface PneumaticConfig {
  /** Var prefix (default 'pneu.'). */
  prefix?: string;
  ducts: string[];
  sources: BleedSourceDef[];
  valves?: PneuValveDef[];
  consumers?: PneuConsumerDef[];
  packs?: PackDef[];
  zones?: ZoneDef[];
  starters?: AirStarterDef[];
  /** Duct pressure lag (s), default 0.5. */
  ductLagS?: number;
  /** Leak flow while `fail.pneu.<duct>.leak` is active (kg/s), default 0.4 (EST). */
  leakKgs?: number;
}
