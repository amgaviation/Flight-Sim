/**
 * Citation M2 fuel system (S&D15 §9.2, S&D21 §9.2, TCDS §9.1):
 *  - two integral wing tanks, 1,648 lb usable each (3,296 lb total at 6.7 lb/gal);
 *  - each engine normally fed from its own wing tank, fully automatic;
 *  - motive-flow ejector pump in each tank sump (high-pressure fuel from the
 *    engine FDU returns to drive it), plus a motive-flow scavenge pump;
 *  - one electric boost pump per tank "during engine start, fuel transfer, and
 *    as activated by low fuel pressure"; switch OFF / NORM / ON (CAE CJ-family
 *    differences p.5-30: OFF de-energizes the pump, no automatic operation);
 *  - tank-to-tank transfer; vented surge tank near each tip; fuel heated by the
 *    oil heat exchanger (no anti-ice additive needed).
 *
 * Model: tank -> (ejector | boost) -> sump manifold -> firewall shutoff valve
 * (closed by the ENG FIRE button) -> engine feed. FUEL TRANSFER: "Fuel is
 * transferred in the direction of the arrow on the FUEL TRANSFER selector (i.e.
 * if the selector is turned clockwise, the arrow points to R TANK and fuel is
 * transferred from the left tank)" (525AFM-06 p.3-113); selecting a tank runs
 * the boost pump in the OPPOSITE (supplying) tank and opens the crossfeed valve
 * (CAE CJ1+/CJ2 differences p.5-31). "Fuel transfer will not occur if the Fuel
 * Boost is operating in the receiving tank" (525AFM-06 p.3-113); rate
 * "approximately 10 pounds per minute" (600 lb/h).
 * Boost NORM: automatic on start, transfer and low pressure; the low-pressure
 * activation latches until the switch is taken to OFF or ON and back to NORM
 * (525AFM-06 p.3-115; latch in M2Logic, `ac.m2.boost<i>_latch`).
 * Low-fuel level caution at 190 lb per tank (EST, see dossier).
 */
import type { SimContext } from '../../../core/SimContext';
import { ENG } from '../../../core/vars';
import { FuelSystem } from '../../../systems/fuel';
import { CITATION_M2_FDM } from '../fdm';
import { LB } from '../data';
import { M2 } from '../vars';

export const LOW_FUEL_LB = 190;
/** Tank-to-tank transfer rate (lb/h): "approximately 10 pounds per minute" (525AFM-06 p.3-113). */
export const XFER_RATE_PPH = 600; // EST: CJ-family FUEL LEVEL LOW threshold per tank (~30 min at holding)

export function createFuel(ctx: Pick<SimContext, 'vars'>): FuelSystem {
  const tanks = CITATION_M2_FDM.mass.tanks;
  const boostOn = (i: 1 | 2): string => {
    const side = i === 1 ? 'l' : 'r';
    // Supplying pump for a transfer: R TANK (+1) runs the LEFT pump (left -> right), L TANK (-1) the right pump.
    const xferSel = i === 1 ? 1 : -1;
    return (
      // OFF (-1) de-energizes the pump: no automatic start / transfer / low-pressure operation (CAE differences p.5-30).
      `elec.boost_${side}_powered && ${M2.boostSw(i)} != -1 && (${M2.boostSw(i)} == 1 || ${M2.fuelXfer} == ${xferSel} ||` +
      ` (fadec.eng${i}.start_state > 0 && fadec.eng${i}.start_state < 4) || ${M2.boostLatch(i)})`
    );
  };
  return new FuelSystem(ctx.vars, {
    tanks: [
      { id: 'left', index: 0, capacityKg: tanks[0].capacity_kg, unusableKg: tanks[0].unusable_kg, initialKg: tanks[0].capacity_kg * 0.6, lowLevelKg: LOW_FUEL_LB * LB, gauge: { power: 'elec.gea_powered' } },
      { id: 'right', index: 1, capacityKg: tanks[1].capacity_kg, unusableKg: tanks[1].unusable_kg, initialKg: tanks[1].capacity_kg * 0.6, lowLevelKg: LOW_FUEL_LB * LB, gauge: { power: 'elec.gea_powered' } },
    ],
    nodes: ['l_sump', 'r_sump', 'l_feed', 'r_feed'],
    pumps: [
      // Motive-flow ejectors need engine HP fuel: running above ~40 % N2 (EST).
      { id: 'ejector_l', kind: 'ejector', from: 'left', to: 'l_sump', pressurePsi: 25, maxFlowPph: 1800, on: `${ENG.n2(1)} > 40` },
      { id: 'ejector_r', kind: 'ejector', from: 'right', to: 'r_sump', pressurePsi: 25, maxFlowPph: 1800, on: `${ENG.n2(2)} > 40` },
      // Electric boost pumps: higher head so they take over the feed when running (check valves); EST 28 psi / 1,500 lb/h / 7 A.
      { id: 'boost_l', kind: 'electric', from: 'left', to: 'l_sump', pressurePsi: 28, maxFlowPph: 1500, on: boostOn(1), ratedAmps: 7 },
      { id: 'boost_r', kind: 'electric', from: 'right', to: 'r_sump', pressurePsi: 28, maxFlowPph: 1500, on: boostOn(2), ratedAmps: 7 },
    ],
    valves: [
      // Firewall shutoff valves: closed by the ENG FIRE push button (motorised, emergency bus).
      { id: 'fw_l', a: 'l_sump', b: 'l_feed', open: `!${M2.engFireBtn(1)}`, travelS: 1, power: 'elec.emer_powered' },
      { id: 'fw_r', a: 'r_sump', b: 'r_feed', open: `!${M2.engFireBtn(2)}`, travelS: 1, power: 'elec.emer_powered' },
    ],
    transfers: [
      // ~10 lb/min (525AFM-06 p.3-113); none while the receiving tank's boost pump runs.
      { id: 'xfer_lr', from: 'left', to: 'right', kind: 'pumped', ratePph: XFER_RATE_PPH, active: `${M2.fuelXfer} == 1 && fuel.boost_l_on && !fuel.boost_r_on` },
      { id: 'xfer_rl', from: 'right', to: 'left', kind: 'pumped', ratePph: XFER_RATE_PPH, active: `${M2.fuelXfer} == -1 && fuel.boost_r_on && !fuel.boost_l_on` },
    ],
    consumers: [
      { id: 'eng1', node: 'l_feed', flowPph: ENG.fuelFlowPph(1), engine: 1, run: 'fadec.eng1.fuel_cmd', suction: { tank: 'left' }, minPressPsi: 3 },
      { id: 'eng2', node: 'r_feed', flowPph: ENG.fuelFlowPph(2), engine: 2, run: 'fadec.eng2.fuel_cmd', suction: { tank: 'right' }, minPressPsi: 3 },
    ],
    balance: { left: 'left', right: 'right', alertKg: 200 * LB }, // EST imbalance caution 200 lb
    temperature: { skin: 'fdm.tat_c', initialC: 15 },
  });
}
