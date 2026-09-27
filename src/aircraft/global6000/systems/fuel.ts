/**
 * Bombardier Global 6000 fuel system (GXFU, TCDS 1.4).
 *
 * Tanks (TCDS, SB 700-28-040): left / right main wing tanks 15,045 lb each
 * (the inboard cell of each wing is the engine feed tank, kept full by
 * gravity through inboard-only swing check valves and by the transfers),
 * centre wing tank 12,683 lb, aft fuselage bladder tank 2,275 lb.
 * Engine feed (GXFU): two AC primary boost pumps per feed tank (FWD / AFT,
 * each able to feed an engine at any power, separate AC buses, continuously
 * on whenever the engine runs and AC power is available; PRI PUMPS switch
 * inhibits both) and one DC AUX pump (L on DC ESS, R on the BATT bus: backup
 * for a failed AC pump, on for takeoff / landing, the wing transfer pump and
 * the APU start pump). Crossfeed SOV (manual only) joins the feed lines. The
 * APU is fed from the right feed line (left through the crossfeed).
 * Transfers (FMQGC): centre -> wings by two AC centre transfer pumps (start
 * at ~93 % wing, stop above 97 %); aft -> wings by two AC aft transfer pumps
 * when either wing reaches 5,500 lb (AUTO, or manually ON); wing-to-wing by
 * the AUX pumps (auto at a 400 lb imbalance with the slat/flap lever at 0 IN,
 * or manual L->R / R->L). Recirculation (FCOC heated fuel return, -9 FMQGC
 * automatic above 34,000 ft) warms the wing tanks.
 * Engine fuel SOVs close with the fire handles (GXFP: L/R ENG SOV CLSD).
 * SCOPE: the feed tank is part of its main tank (it stays full while the
 * wing has fuel); no refuel/defuel panel (service menu); the recirculation
 * only biases the tank temperature (logic.ts).
 */
import type { SimContext } from '../../../core/SimContext';
import { FuelSystem } from '../../../systems/fuel';
import { LB, G6K_LIMITS } from '../data';
import { GLOBAL6000_FDM } from '../fdm';
import { G6K_VARS as V } from '../vars';

export const FUEL_LOW_KG = G6K_LIMITS.lowFuelLb * LB;
/** Tank ids (FuelSystem) in FDM index order: 0 left main, 1 centre, 2 right main, 3 aft (Fusion GLOBAL6000_AIRFRAME.tanks). */
export const TANK_IDS = ['l_main', 'ctr', 'r_main', 'aft'] as const;

export function createFuel(ctx: Pick<SimContext, 'vars'>): FuelSystem {
  const t = GLOBAL6000_FDM.mass.tanks;
  const gauge = (power: string) => ({ power, lagS: 2 });
  return new FuelSystem(ctx.vars, {
    tanks: [
      { id: 'l_main', index: 0, capacityKg: t[0].capacity_kg, unusableKg: t[0].unusable_kg, initialKg: t[0].capacity_kg * 0.6, lowLevelKg: FUEL_LOW_KG, gauge: gauge('elec.fuel_cmptr_a_powered || elec.fuel_cmptr_b_powered') },
      { id: 'ctr', index: 1, capacityKg: t[1].capacity_kg, unusableKg: t[1].unusable_kg, initialKg: t[1].unusable_kg, gauge: gauge('elec.fuel_cmptr_a_powered || elec.fuel_cmptr_b_powered') },
      { id: 'r_main', index: 2, capacityKg: t[2].capacity_kg, unusableKg: t[2].unusable_kg, initialKg: t[2].capacity_kg * 0.6, lowLevelKg: FUEL_LOW_KG, gauge: gauge('elec.fuel_cmptr_a_powered || elec.fuel_cmptr_b_powered') },
      { id: 'aft', index: 3, capacityKg: t[3].capacity_kg, unusableKg: t[3].unusable_kg, initialKg: t[3].unusable_kg, gauge: gauge('elec.fuel_cmptr_a_powered || elec.fuel_cmptr_b_powered') },
    ],
    nodes: ['l_feed', 'r_feed'],
    pumps: [
      // AC primary pumps (EST 35 psi, 12,000 lb/h: each can feed an engine at take-off power, GXFU).
      { id: 'pri_l1', kind: 'electric', from: 'l_main', to: 'l_feed', pressurePsi: 35, maxFlowPph: 12000, on: `${V.priCmd('l1')} && elec.pri_l1_powered`, lowPressWhenOff: true },
      { id: 'pri_l2', kind: 'electric', from: 'l_main', to: 'l_feed', pressurePsi: 35, maxFlowPph: 12000, on: `${V.priCmd('l2')} && elec.pri_l2_powered`, lowPressWhenOff: true },
      { id: 'pri_r1', kind: 'electric', from: 'r_main', to: 'r_feed', pressurePsi: 35, maxFlowPph: 12000, on: `${V.priCmd('r1')} && elec.pri_r1_powered`, lowPressWhenOff: true },
      { id: 'pri_r2', kind: 'electric', from: 'r_main', to: 'r_feed', pressurePsi: 35, maxFlowPph: 12000, on: `${V.priCmd('r2')} && elec.pri_r2_powered`, lowPressWhenOff: true },
      // DC AUX pumps (EST 25 psi, 8,000 lb/h, 12 A).
      { id: 'aux_l', kind: 'electric', from: 'l_main', to: 'l_feed', pressurePsi: 25, maxFlowPph: 8000, on: `${V.auxCmd('l')} && elec.aux_pump_l_powered`, ratedAmps: 12 },
      { id: 'aux_r', kind: 'electric', from: 'r_main', to: 'r_feed', pressurePsi: 25, maxFlowPph: 8000, on: `${V.auxCmd('r')} && elec.aux_pump_r_powered`, ratedAmps: 12 },
    ],
    valves: [
      // Crossfeed SOV (BATT bus, GXFU), EST 2 s travel.
      { id: 'xfeed', a: 'l_feed', b: 'r_feed', open: `${V.xfeed} == 1`, travelS: 2, power: 'elec.xfeed_valve_powered' },
    ],
    consumers: [
      // Engine fuel SOV (DC EMER, GXFU CB) closed by the fire handle; FADEC fuel command from the ENG RUN switch.
      // `fail.eng<n>.flameout` (registered in createSystems.ts) is the instructor's engine failure: the combustor
      // flames out with the ENG RUN switch at RUN, so the FADEC latch posts L / R ENG FLAMEOUT (logic.ts).
      { id: 'eng1', node: 'l_feed', flowPph: 'eng1.ff_pph', engine: 1, run: `fadec.eng1.fuel_cmd && !${V.fireHandle('l')} && elec.eng_sov1_powered && !fail.eng1.flameout`, suction: { tank: 'l_main', ceilingFt: 20000 } },
      { id: 'eng2', node: 'r_feed', flowPph: 'eng2.ff_pph', engine: 2, run: `fadec.eng2.fuel_cmd && !${V.fireHandle('r')} && elec.eng_sov2_powered && !fail.eng2.flameout`, suction: { tank: 'r_main', ceilingFt: 20000 } },
      // APU from the right feed line through the APU fire SOV (DC EMER); boost pressure required (GXAPU).
      { id: 'apu', node: 'r_feed', flowPph: 'apu.ff_pph', run: `(apu.fuel_cmd || (apu.state >= 1 && apu.state <= 4)) && !${V.fireHandle('apu')} && elec.apu_fire_sov_powered`, minPressPsi: 5 },
    ],
    transfers: [
      // Centre transfer pumps (EST 5,000 lb/h each), FMQGC commanded.
      { id: 'ctr_xfer1', from: 'ctr', to: 'l_main', kind: 'pumped', ratePph: 5000, active: `${V.ctrXferCmd('l')} && elec.ctr_xfer1_powered` },
      { id: 'ctr_xfer2', from: 'ctr', to: 'r_main', kind: 'pumped', ratePph: 5000, active: `${V.ctrXferCmd('r')} && elec.ctr_xfer2_powered` },
      // Aft transfer pumps (EST 1,500 lb/h each: "each ... has sufficient capacity to maintain the transfer schedule").
      { id: 'aft_xfer1', from: 'aft', to: 'l_main', kind: 'pumped', ratePph: 1500, active: `${V.aftXferCmd('l')} && elec.aft_xfer1_powered` },
      { id: 'aft_xfer2', from: 'aft', to: 'r_main', kind: 'pumped', ratePph: 1500, active: `${V.aftXferCmd('r')} && elec.aft_xfer2_powered` },
      // Wing transfer by the AUX pump of the heavy side (EST 3,000 lb/h).
      { id: 'wing_lr', from: 'l_main', to: 'r_main', kind: 'pumped', ratePph: 3000, active: `${V.wingXferCmd('lr')} && fuel.aux_l_on` },
      { id: 'wing_rl', from: 'r_main', to: 'l_main', kind: 'pumped', ratePph: 3000, active: `${V.wingXferCmd('rl')} && fuel.aux_r_on` },
    ],
    balance: { left: 'l_main', right: 'r_main', alertKg: G6K_LIMITS.imbalanceFlightLb * LB },
    temperature: { skin: 'fdm.tat_c', tauFullS: 14400, initialC: 15 },
  });
}
