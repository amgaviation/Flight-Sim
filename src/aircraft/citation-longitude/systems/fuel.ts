/**
 * Citation Longitude fuel system (OG Section 6; AW / FPG capacities).
 *
 * Two integral wing tanks (1,083 US gal / 7,255 lb usable each, AW), each with
 * a motive-flow primary ejector pump (engine HP motive flow) feeding its
 * engine, an electric boost pump (NORM: automatic for engine start, fuel
 * transfer, APU operation (right) and low fuel; ON: continuous), a
 * recirculation pump (temperature only; logic.ts) and scavenge ejectors (folded
 * into the primary ejector's low-level pickup). A single fuel-transfer valve
 * moves fuel with the on-side boost pump (L TANK = right pump pushes to the
 * left tank; OG 6-4); both boost pumps running = net zero (FUEL TRANSFER FAIL).
 * The gravity crossflow valves (in flight only) level the tanks. The APU is fed
 * from the right tank (OG 6-2).
 */
import type { SimContext } from '../../../core/SimContext';
import { ENG } from '../../../core/vars';
import { FuelSystem } from '../../../systems/fuel';
import { LB, LON_LIMITS } from '../data';
import { CITATION_LONGITUDE_FDM } from '../fdm';
import { LON_VARS as V } from '../vars';

/** OG CAS: FUEL LEVEL LOW L/R below 500 lb in the tank. */
export const FUEL_LOW_KG = 500 * LB;

/** Boost-pump automatic logic (NORM) per side; OG 6-4, 8-2. */
export function boostCmd(side: 1 | 2): string {
  const sw = side === 1 ? V.boostL : V.boostR;
  const tank = side === 1 ? 'fuel.tank0_kg' : 'fuel.tank1_kg';
  const eng = `eng${side}`;
  const start = `(fadec.eng${side}.start_state >= 1 && fadec.eng${side}.start_state <= 3)`;
  // L TANK (-1): the RIGHT pump pushes fuel to the left tank; R TANK (+1): the LEFT pump.
  const xfer = side === 1 ? `${V.fuelTransfer} == 1` : `${V.fuelTransfer} == -1`;
  const low = `${tank} < ${FUEL_LOW_KG.toFixed(1)}`;
  const ejectorLow = `(${eng}.running && fuel.ejector_${side === 1 ? 'l' : 'r'}_lowpress)`;
  const apu = side === 2 ? ` || (apu.state >= 1 && apu.state <= 4 && !eng2.running)` : '';
  return `${sw} == 1 || ${start} || ${xfer} || ${low} || ${ejectorLow}${apu}`;
}

export function createFuel(ctx: Pick<SimContext, 'vars'>): FuelSystem {
  const t = CITATION_LONGITUDE_FDM.mass.tanks;
  const powerL = 'elec.mission_l_v > 18';
  const powerR = 'elec.mission_r_v > 18';
  return new FuelSystem(ctx.vars, {
    tanks: [
      { id: 'left', index: 0, capacityKg: t[0].capacity_kg, unusableKg: t[0].unusable_kg, initialKg: t[0].capacity_kg * 0.5, lowLevelKg: FUEL_LOW_KG, gauge: { power: 'elec.emer_l_powered' } },
      { id: 'right', index: 1, capacityKg: t[1].capacity_kg, unusableKg: t[1].unusable_kg, initialKg: t[1].capacity_kg * 0.5, lowLevelKg: FUEL_LOW_KG, gauge: { power: 'elec.emer_r_powered' } },
    ],
    nodes: ['l_man', 'r_man'],
    pumps: [
      // Primary motive-flow ejectors: need engine HP motive flow (EST: N2 > 45 %); capacity EST 3x max burn.
      { id: 'ejector_l', kind: 'ejector', from: 'left', to: 'l_man', pressurePsi: 28, maxFlowPph: 6000, on: `${ENG.n2(1)} > 45 && !fail.fuel.ejector_l` },
      { id: 'ejector_r', kind: 'ejector', from: 'right', to: 'r_man', pressurePsi: 28, maxFlowPph: 6000, on: `${ENG.n2(2)} > 45 && !fail.fuel.ejector_r` },
      // Electric boost pumps (EST 22 psi, 4,000 pph, 8 A at 28 V).
      { id: 'boost_l', kind: 'electric', from: 'left', to: 'l_man', pressurePsi: 22, maxFlowPph: 4000, on: `(${powerL}) && (${boostCmd(1)})`, ratedAmps: 8 },
      { id: 'boost_r', kind: 'electric', from: 'right', to: 'r_man', pressurePsi: 22, maxFlowPph: 4000, on: `(${powerR}) && (${boostCmd(2)})`, ratedAmps: 8 },
    ],
    consumers: [
      // Engine fuel shutoff: FADEC fuel command and the ENG FIRE switchlight (firewall shutoff valve).
      { id: 'eng1', node: 'l_man', flowPph: ENG.fuelFlowPph(1), engine: 1, run: `fadec.eng1.fuel_cmd && !${V.fireEngL}`, suction: { tank: 'left' } },
      { id: 'eng2', node: 'r_man', flowPph: ENG.fuelFlowPph(2), engine: 2, run: `fadec.eng2.fuel_cmd && !${V.fireEngR}`, suction: { tank: 'right' } },
      { id: 'apu', node: 'r_man', flowPph: 'apu.ff_pph', run: 'apu.state >= 1 && apu.state <= 4', minPressPsi: 2 },
    ],
    transfers: [
      // Transfer valve: pumped by the on-side boost pump (EST 1,200 pph, boost-pump capacity minus engine feed).
      { id: 'xfer_to_l', from: 'right', to: 'left', kind: 'pumped', ratePph: 1200, active: `${V.fuelTransfer} == -1 && fuel.boost_r_on && !fuel.boost_l_on` },
      { id: 'xfer_to_r', from: 'left', to: 'right', kind: 'pumped', ratePph: 1200, active: `${V.fuelTransfer} == 1 && fuel.boost_l_on && !fuel.boost_r_on` },
      // Gravity crossflow (OG 6-4: no effect on the ground). EST 2,000 pph at a 20 % level difference.
      { id: 'grav_xflow', from: 'left', to: 'right', kind: 'gravity', ratePph: 2000, bidirectional: true, active: `${V.gravXflow} && gear.air_ground == 0` },
    ],
    balance: { left: 'left', right: 'right', alertKg: LON_LIMITS.maxFuelImbalanceLb * LB },
    temperature: { skin: 'fdm.tat_c', tauFullS: 10800, initialC: 15 },
  });
}
