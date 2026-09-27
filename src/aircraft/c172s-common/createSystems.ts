/**
 * Cessna 172S shared systems core. Each variant (c172-steam, c172-g1000) calls
 * `createC172Core(ctx, { variant })`, builds its own avionics / autopilot / warnings, then
 * `core.compose({...})` to get the update-ordered `AircraftInstance.systems` list
 * (systems-power §0.2 / systems-control §0.1):
 *
 *   failures -> C172Logic (cockpit controls -> engine inputs, interlocks, ACU, STBY BATT) ->
 *   electrical -> fuel -> pitot heat / ice -> vacuum -> air-data sources -> ASI calibration ->
 *   [variant sensors: AHRS, KAP 140 sensors ...] -> landing gear -> [variant avionics: radios,
 *   G1000 units ...] -> [variant AFCS] -> stall horn -> rigging -> primary flight controls ->
 *   pitch trim -> flaps -> nosewheel steering -> brakes -> [variant warnings: altitude alerter,
 *   TAWS, CAS ...] -> lighting -> C172LateLogic (annunciators, meters, cabin) -> [variant late].
 */
import type { SimContext } from '../../core/SimContext';
import type { Subsystem } from '../types';
import { FailureManager, type FailureDef } from '../../systems/failures';
import type { ElectricalNetwork } from '../../systems/electrical';
import type { FuelSystem } from '../../systems/fuel';
import type { VacuumSystem } from '../../systems/sensors';
import type { LightingSystem } from '../../systems/lighting';
import { createC172Electrical, type C172ElectricalOptions, type C172Variant } from './systems/electrical';
import { createC172Fuel, type C172FuelOptions } from './systems/fuel';
import { createC172AirData, createC172Vacuum, type C172AirData } from './systems/instruments';
import { createC172Flight, type C172FlightBlocks, type C172FlightOptions } from './systems/flight';
import { createC172Lighting } from './systems/lighting';
import { C172LateLogic, C172Logic } from './systems/logic';

export interface C172CoreOptions {
  variant: C172Variant;
  electrical?: C172ElectricalOptions;
  fuel?: C172FuelOptions;
  flight?: C172FlightOptions;
  /** FailureManager seed (deterministic random failures). */
  seed?: number;
}

export interface C172ComposeParts {
  /** After the air-data sources (AHRS, KAP 140 rate sensors, ...). */
  sensors?: Subsystem[];
  /** After the landing gear (radios, G1000 LRUs, FMS/GPS, ...). */
  avionics?: Subsystem[];
  /** Autopilot / flight director (before the flight controls, so servo commands apply this step). */
  afcs?: Subsystem[];
  /** After the flight controls (altitude alerter, TAWS, CAS, disconnect aurals, ...). */
  warnings?: Subsystem[];
  /** After the shared late logic. */
  late?: Subsystem[];
}

export interface C172Core extends C172FlightBlocks {
  variant: C172Variant;
  failures: FailureManager;
  logic: C172Logic;
  elec: ElectricalNetwork;
  fuel: FuelSystem;
  airData: C172AirData;
  vacuum: VacuumSystem;
  lights: LightingSystem;
  late: C172LateLogic;
  /** Update-ordered list including the variant parts; registers every block's failures. */
  compose(parts?: C172ComposeParts): Subsystem[];
}

export function createC172Core(ctx: SimContext | Pick<SimContext, 'vars' | 'events' | 'audio'>, opts: C172CoreOptions): C172Core {
  const { variant } = opts;
  const failures = new FailureManager(ctx.vars, { events: ctx.events, seed: opts.seed ?? 172 });
  const logic = new C172Logic(ctx.vars, variant);
  const elec = createC172Electrical(ctx, variant, opts.electrical);
  const fuel = createC172Fuel(ctx, variant, opts.fuel);
  const airData = createC172AirData(ctx, variant);
  const vacuum = createC172Vacuum(ctx, variant);
  const flight = createC172Flight(ctx, opts.flight);
  const lights = createC172Lighting(ctx, variant);
  const late = new C172LateLogic(ctx.vars, variant);

  const compose = (parts: C172ComposeParts = {}): Subsystem[] => {
    const list: Subsystem[] = [
      failures,
      logic,
      elec,
      fuel,
      airData.pitotHeat,
      vacuum,
      ...airData.sources,
      airData.calibration,
      ...(parts.sensors ?? []),
      flight.gear,
      ...(parts.avionics ?? []),
      ...(parts.afcs ?? []),
      flight.stall,
      flight.rigging,
      flight.fcs,
      flight.pitchTrim,
      flight.flaps,
      flight.steering,
      flight.brakes,
      ...(parts.warnings ?? []),
      lights,
      late,
      ...(parts.late ?? []),
    ];
    const registered = new Set(failures.list().map((d) => d.id));
    for (const s of list) {
      if (s === failures) continue;
      const fn = (s as { failures?: () => FailureDef[] }).failures;
      if (typeof fn !== 'function') continue;
      for (const d of fn.call(s)) {
        if (registered.has(d.id)) continue;
        registered.add(d.id);
        failures.register(d);
      }
    }
    return list;
  };

  return { variant, failures, logic, elec, fuel, airData, vacuum, lights, late, ...flight, compose };
}
