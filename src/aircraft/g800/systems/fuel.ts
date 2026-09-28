/**
 * G800 fuel system (TCDS §9 capacities; SCQ fuel and GVI limitations for the
 * GVI-family architecture; FSB App. 4 for the G800 heated-fuel-return change).
 *
 *  - Two integral wing tanks, 24,700 lb each (TCDS). Each has a hopper (1,283 lb,
 *    SCQ) filled by ejector pumps through flapper check valves. SCOPE: the hopper
 *    is folded into its wing tank (ejector transfer is always adequate).
 *  - Four electric pumps in the main wheel wells on the hoppers (SCQ): per side a
 *    main BOOST pump (OFF / AUTO / ON) and an ALTERNATE pump (OFF / ON). GVI
 *    limitation: "All operable boost pumps shall be ON for all phases of flight
 *    unless fuel balancing is in progress". AUTO (EST): runs while its side's
 *    engine or the APU needs feed. ALT ON (EST): standby, runs automatically when
 *    its boost pump's output pressure is low.
 *  - Crossflow valve: one hopper feeds the opposite engine (SCQ balancing method 2).
 *    SCOPE: the intertank (hopper-to-hopper) valve is not modelled.
 *  - Engine HP pumps suction-feed with both electric pumps off. Function fix round 1 (EST): the suction capacity falls
 *    with altitude (SUCTION_SL_PPH at sea level to zero at SUCTION_ZERO_FT) instead of an instant cut at 25,000 ft; an
 *    engine whose flow exceeds it for 2 s loses its feed (flameout) until the capacity recovers (logic.ts).
 *  - APU fed from the left tank through its own DC pump (EST).
 *  - Low level alert 650 lb per side (GVI). Heated fuel return (HFR): AUTO when tank
 *    temperature <= -5 degC (SCQ), no altitude prerequisite on the G800 (FSB App. 4);
 *    modelled as extra heat into the tank temperature model (EST +12 degC equivalent skin).
 */
import type { SimContext } from '../../../core/SimContext';
import { ENG } from '../../../core/vars';
import { FuelSystem } from '../../../systems/fuel';
import { G800_LIMITS, LB } from '../data';
import { G800_FDM } from '../fdm';
import { G800_VARS as V } from '../vars';

export const FUEL_LOW_KG = G800_LIMITS.fuelLowLb * LB;
/** EST suction-feed capacity: 6,000 pph at sea level falling linearly to zero at 36,000 ft (GVI-family suction feed is
 * limited at altitude; no published figure). Cruise flow (~1,400-1,800 pph per engine) is lost above ~FL250-FL280. */
export const SUCTION_SL_PPH = 6000;
export const SUCTION_ZERO_FT = 36000;
/** Fuel Imbalance caution (GVI limitation: 2,000 lb maximum imbalance, 1,000 lb for takeoff). EST: the caution uses
 * the takeoff limit on the ground and the flight limit in the air. */
export const IMBALANCE_GROUND_KG = G800_LIMITS.maxImbalanceTakeoffLb * LB;
export const IMBALANCE_FLIGHT_KG = 2000 * LB;

const starting = (i: number) => `(fadec.eng${i}.start_state >= 1 && fadec.eng${i}.start_state <= 3)`;

/** Boost pump command (AUTO/ON logic) for side 1 (L) or 2 (R). */
export function boostCmd(side: 1 | 2): string {
  const sw = side === 1 ? V.boostL : V.boostR;
  const apu = side === 1 ? ' || (apu.state >= 1 && apu.state <= 4)' : '';
  return `${sw} == 2 || (${sw} == 1 && (eng${side}.running || ${starting(side)} || eng${side}.n2_pct > 20${apu}))`;
}

export function createFuel(ctx: Pick<SimContext, 'vars'>): FuelSystem {
  const t = G800_FDM.mass.tanks;
  const pl = 'elec.boost_l_powered';
  const pr = 'elec.boost_r_powered';
  return new FuelSystem(ctx.vars, {
    tanks: [
      { id: 'left', index: 0, capacityKg: t[0].capacity_kg, unusableKg: t[0].unusable_kg, initialKg: t[0].capacity_kg * 0.5, lowLevelKg: FUEL_LOW_KG, gauge: { power: 'elec.l_ess_dc_powered || elec.r_ess_dc_powered' } },
      { id: 'right', index: 1, capacityKg: t[1].capacity_kg, unusableKg: t[1].unusable_kg, initialKg: t[1].capacity_kg * 0.5, lowLevelKg: FUEL_LOW_KG, gauge: { power: 'elec.l_ess_dc_powered || elec.r_ess_dc_powered' } },
    ],
    nodes: ['l_feed', 'r_feed', 'apu_feed'],
    pumps: [
      // EST: 30 psi, 9,000 pph (2x max-thrust burn), 12 A at 28 V.
      { id: 'boost_l', kind: 'electric', from: 'left', to: 'l_feed', pressurePsi: 30, maxFlowPph: 9000, on: `(${pl}) && (${boostCmd(1)})`, ratedAmps: 12 },
      { id: 'boost_r', kind: 'electric', from: 'right', to: 'r_feed', pressurePsi: 30, maxFlowPph: 9000, on: `(${pr}) && (${boostCmd(2)})`, ratedAmps: 12 },
      // Alternate pumps: EST 26 psi (the boost pump wins while it runs), 7,000 pph, 10 A.
      { id: 'alt_l', kind: 'electric', from: 'left', to: 'l_feed', pressurePsi: 26, maxFlowPph: 7000, on: `elec.alt_pump_l_powered && ${V.altPumpL} == 1 && (fuel.boost_l_lowpress || !fuel.boost_l_on) && (eng1.running || ${starting(1)})`, ratedAmps: 10 },
      { id: 'alt_r', kind: 'electric', from: 'right', to: 'r_feed', pressurePsi: 26, maxFlowPph: 7000, on: `elec.alt_pump_r_powered && ${V.altPumpR} == 1 && (fuel.boost_r_lowpress || !fuel.boost_r_on) && (eng2.running || ${starting(2)})`, ratedAmps: 10 },
      // APU DC fuel pump on the L ESS DC bus (EST: needed for battery-only APU starts, GVI "A/C battery" APU starts).
      { id: 'apu_pump', kind: 'electric', from: 'left', to: 'apu_feed', pressurePsi: 15, maxFlowPph: 600, on: 'elec.apu_ecu_powered && apu.state >= 1 && apu.state <= 4', ratedAmps: 3 },
    ],
    valves: [{ id: 'xflow', a: 'l_feed', b: 'r_feed', open: `${V.xflow} == 1`, travelS: 2, power: 'elec.l_ess_dc_powered || elec.r_ess_dc_powered' }],
    consumers: [
      // Engine fuel shutoff: FADEC fuel command (RUN/STOP + auto start) and the fire handle (firewall shutoff valve).
      { id: 'eng1', node: 'l_feed', flowPph: ENG.fuelFlowPph(1), engine: 1, run: `fadec.eng1.fuel_cmd && ${V.fireHandleL} == 0`, suction: { tank: 'left', ceilingFt: SUCTION_ZERO_FT, running: 'eng1.n2_pct > 20 && !ac.g800.suction_fail1' } },
      { id: 'eng2', node: 'r_feed', flowPph: ENG.fuelFlowPph(2), engine: 2, run: `fadec.eng2.fuel_cmd && ${V.fireHandleR} == 0`, suction: { tank: 'right', ceilingFt: SUCTION_ZERO_FT, running: 'eng2.n2_pct > 20 && !ac.g800.suction_fail2' } },
      { id: 'apu', node: 'apu_feed', flowPph: 'apu.ff_pph', run: `apu.state >= 1 && apu.state <= 4 && ${V.fireHandleApu} == 0`, minPressPsi: 2 },
    ],
    balance: { left: 'left', right: 'right', alertKg: G800_LIMITS.maxImbalanceTakeoffLb * LB },
    temperature: { skin: `fdm.tat_c + 12 * ${V.hfrActive}`, tauFullS: 10800, initialC: 15 },
  });
}
