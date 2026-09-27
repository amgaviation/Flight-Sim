/**
 * Cessna 172S fuel system (POH Sec 7 "Fuel system", Figure 7-6; docs/aircraft/c172s.md §5.2).
 *
 * Two vented integral wing tanks (28.0 gal, 26.5 usable each) feed by gravity through the
 * three-position selector (LEFT / BOTH / RIGHT) into the reservoir tank; from there through
 * the auxiliary (electric) fuel pump, the FUEL SHUTOFF valve, the strainer and the
 * engine-driven fuel pump to the fuel/air control unit (RSA servo). The physics piston
 * model reads `eng1.fuel_on` as "fuel pressure at the servo": selector and shutoff open AND
 * (engine-driven pump turning OR aux pump running) AND fuel in a selected tank. With the aux
 * pump ON and the mixture RICH the injected engine primes (POH Sec 4 starting procedure).
 *
 * SCOPE: the fuel return line (serials 172S9491+, returns metered fuel to the reservoir) has
 * no net effect on quantities and is not modelled; tank-to-tank vent crossfeed in BOTH with a
 * wing low is not modelled (both tanks feed equally in BOTH); the reservoir tank volume is
 * folded into the lines (the engine stops ~1 min after both tanks run dry in the real
 * airplane, immediately here once the selected tanks reach unusable fuel).
 */
import type { SimContext } from '../../../core/SimContext';
import { FuelSystem } from '../../../systems/fuel';
import { C172, FUEL_SEL } from '../vars';
import { FUEL_DATA, KG_PER_GAL } from '../data';
import type { C172Variant } from './electrical';

export interface C172FuelOptions {
  /** Initial quantity per tank (kg). Default full (28 gal). */
  initialKgPerTank?: number;
}

export function createC172Fuel(ctx: Pick<SimContext, 'vars'>, variant: C172Variant, opts: C172FuelOptions = {}): FuelSystem {
  const cap = FUEL_DATA.tankCapacityGal * KG_PER_GAL;
  const unusable = FUEL_DATA.tankUnusableGal * KG_PER_GAL;
  // Quantity indication power: steam electric gauges on the INST breaker; G1000 through the
  // GEA 71 engine/airframe unit (NAV1 ENG breakers).
  const gaugePower = variant === 'g1000' ? 'elec.nav1_eng_powered' : 'elec.engine_gauges_powered';
  const tank = (id: 'left' | 'right', index: number) => ({
    id,
    index,
    capacityKg: cap,
    unusableKg: unusable,
    initialKg: opts.initialKgPerTank ?? cap,
    lowLevelKg: FUEL_DATA.lowFuelGal * KG_PER_GAL, // POH Sec 7: LOW FUEL below ~5 gal
    gauge: { power: gaugePower, lagS: 3 }, // EST float transmitter damping
  });
  return new FuelSystem(
    ctx.vars,
    {
      tanks: [tank('left', 0), tank('right', 1)],
      nodes: ['l_out', 'r_out', 'reservoir', 'strainer', 'servo'],
      pumps: [
        // Gravity head from the high wing (EST ~0.5 psi at the reservoir).
        { id: 'grav_l', kind: 'gravity', from: 'left', to: 'l_out', pressurePsi: 0.5, maxFlowPph: 300 },
        { id: 'grav_r', kind: 'gravity', from: 'right', to: 'r_out', pressurePsi: 0.5, maxFlowPph: 300 },
        // Auxiliary electric pump (FUEL PUMP switch; powered through its breaker, see electrical.ts).
        { id: 'aux', kind: 'electric', from: 'strainer', to: 'servo', pressurePsi: 20, maxFlowPph: 150, on: 'elec.fuel_pump_powered' },
        // Engine-driven pump (EST: delivers pressure once the engine turns; cranking is enough).
        { id: 'edp', kind: 'engine', from: 'strainer', to: 'servo', pressurePsi: 20, maxFlowPph: 150, on: 'eng1.rpm > 50' },
      ],
      valves: [
        // Selector: LEFT = 0, BOTH = 1, RIGHT = 2 (instant, it's a rotary plug valve).
        { id: 'sel_l', a: 'l_out', b: 'reservoir', open: `${C172.fuelSelector} <= ${FUEL_SEL.both}`, travelS: 0 },
        { id: 'sel_r', a: 'r_out', b: 'reservoir', open: `${C172.fuelSelector} >= ${FUEL_SEL.both}`, travelS: 0 },
        // FUEL SHUTOFF valve knob (push-pull, red): ON pushed in.
        { id: 'shutoff', a: 'reservoir', b: 'strainer', open: C172.fuelShutoff, travelS: 0.3 },
      ],
      consumers: [{ id: 'eng', node: 'servo', flowPph: 'eng1.ff_pph', engine: 1, minPressPsi: 1 }],
      balance: { left: 'left', right: 'right', alertKg: 10 * KG_PER_GAL },
    },
    { name: 'c172-fuel' },
  );
}
