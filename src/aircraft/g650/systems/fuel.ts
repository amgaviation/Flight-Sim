/**
 * Gulfstream G650 fuel system (LUC fuel, SCQ fuel, LIM, TCDS §9).
 *
 * Two integral wing tanks, 22,100 lb usable each (TCDS). Each wing's hopper
 * (190 gal / 1,283 lb, at the root) is kept full by flapper valves and ejector
 * pumps and holds two brushless boost pumps (25 psi): MAIN (L/R ESS DC) and ALT
 * (L/R MAIN DC) feeding that side's engine manifold. "All operable boost pumps
 * shall be ON for all phases of flight" (LIM). Without boost pressure the
 * engine suction feeds below ~20,000 ft (LUC). Valves: L/R engine shutoff
 * (closed by the fire handle), crossflow (one side's pumps feed both engines,
 * L ESS DC) and intertank (gravity flow between the hoppers, R ESS DC). The
 * APU is fed from the left manifold (right via crossflow, LUC apu).
 * SCOPE: the hopper is not a separate tank (it is kept full while the wing
 * tank has fuel, so the modelled wing tank feeds directly); the heated fuel
 * return (HFRS) warms its tank through the per-tank temperature bias below
 * while `logic.ts` reports it running; refuelling is instantaneous from the
 * service menu.
 */
import type { SimContext } from '../../../core/SimContext';
import { FuelSystem } from '../../../systems/fuel';
import { LB, G650_LIMITS } from '../data';
import { G650_FDM } from '../fdm';
import { G650_VARS as V } from '../vars';

/** LIM: "Low fuel level alert @ 650 lbs" (per hopper). */
export const FUEL_LOW_KG = G650_LIMITS.lowFuelLb * LB;

export function createFuel(ctx: Pick<SimContext, 'vars'>): FuelSystem {
  const t = G650_FDM.mass.tanks;
  return new FuelSystem(ctx.vars, {
    tanks: [
      { id: 'left', index: 0, capacityKg: t[0].capacity_kg, unusableKg: t[0].unusable_kg, initialKg: t[0].capacity_kg * 0.5, lowLevelKg: FUEL_LOW_KG, gauge: { power: 'elec.l_ess_dc_powered || elec.emer_dc_powered' } },
      { id: 'right', index: 1, capacityKg: t[1].capacity_kg, unusableKg: t[1].unusable_kg, initialKg: t[1].capacity_kg * 0.5, lowLevelKg: FUEL_LOW_KG, gauge: { power: 'elec.r_ess_dc_powered || elec.emer_dc_powered' } },
    ],
    nodes: ['l_man', 'r_man'],
    pumps: [
      // Brushless boost pumps 25 psi (LUC), EST 9,000 lb/h each (2 x max takeoff burn), < 25 A (LUC) -> 12 A rated EST.
      { id: 'boost_l', kind: 'electric', from: 'left', to: 'l_man', pressurePsi: 25, maxFlowPph: 9000, on: `${V.boostL} >= 1 && elec.boost_l_powered`, ratedAmps: 12, lowPressWhenOff: true },
      { id: 'alt_l', kind: 'electric', from: 'left', to: 'l_man', pressurePsi: 25, maxFlowPph: 9000, on: `${V.altL} >= 1 && elec.alt_l_powered`, ratedAmps: 12, lowPressWhenOff: true },
      { id: 'boost_r', kind: 'electric', from: 'right', to: 'r_man', pressurePsi: 25, maxFlowPph: 9000, on: `${V.boostR} >= 1 && elec.boost_r_powered`, ratedAmps: 12, lowPressWhenOff: true },
      { id: 'alt_r', kind: 'electric', from: 'right', to: 'r_man', pressurePsi: 25, maxFlowPph: 9000, on: `${V.altR} >= 1 && elec.alt_r_powered`, ratedAmps: 12, lowPressWhenOff: true },
    ],
    valves: [
      // Crossflow valve (L ESS DC powered, LUC), EST 2 s travel.
      { id: 'xflow', a: 'l_man', b: 'r_man', open: `${V.xflow} == 1`, travelS: 2, power: 'elec.fuel_valves_l_powered' },
    ],
    consumers: [
      // Engine SOV (wheel well) closed by the fire handle (LUC fire); FADEC fuel command from the FUEL CONTROL switch.
      { id: 'eng1', node: 'l_man', flowPph: 'eng1.ff_pph', engine: 1, run: `fadec.eng1.fuel_cmd && !${V.fireHandleL}`, suction: { tank: 'left', ceilingFt: 20000 } },
      { id: 'eng2', node: 'r_man', flowPph: 'eng2.ff_pph', engine: 2, run: `fadec.eng2.fuel_cmd && !${V.fireHandleR}`, suction: { tank: 'right', ceilingFt: 20000 } },
      // APU from the left manifold; boost pressure required (LUC apu).
      { id: 'apu', node: 'l_man', flowPph: 'apu.ff_pph', run: 'apu.fuel_cmd || (apu.state >= 1 && apu.state <= 4)', minPressPsi: 5 },
    ],
    transfers: [
      // Intertank valve: gravity between the hoppers (R ESS DC, LUC). EST 3,000 lb/h at a 20 % level difference.
      { id: 'intertank', from: 'left', to: 'right', kind: 'gravity', ratePph: 3000, bidirectional: true, active: `${V.interTank} == 1 && elec.fuel_valves_r_powered` },
    ],
    balance: { left: 'left', right: 'right', alertKg: 1000 * LB }, // CAS "Fuel Imbalance" amber at 1,000 lb (LUC fuel)
    // Heated fuel return (LUC fuel): while HFRS runs (logic.ts: AUTO on at 0 °C tank, off at +10 °C) the warm
    // FOHE return raises the tank temperature. EST bias +55 °C on the effective skin temperature: at TAT -45 °C
    // the tank equilibrates near +10 °C, reproducing the 0 -> +10 °C AUTO hysteresis cycling, and in a very cold
    // cruise (TAT -60) it holds the fuel near -5 °C, clear of the -34.5 °C amber.
    temperature: {
      skin: 'fdm.tat_c',
      tauFullS: 14400,
      initialC: 15,
      tankBiasC: { left: `${V.hfrsOn(1)} != 0 ? 55 : 0`, right: `${V.hfrsOn(2)} != 0 ? 55 : 0` },
    },
  });
}
