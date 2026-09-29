/**
 * Boeing 737-800 fuel system (FCOM 12.20 "Fuel"; LIM; systems-power.md §4.3
 * 737NG recipe).
 *
 *  - Three tanks: main tank 1 (left wing) and 2 (right wing), 3,915 kg usable
 *    each, and the centre tank 13,066 kg (LIM, 0.80 kg/l).
 *  - Each main tank has FWD and AFT AC boost pumps feeding its engine
 *    manifold; the centre tank has L and R pumps (override/jettison class)
 *    that deliver a higher pressure, so with the centre pumps on, centre fuel
 *    is burned first (check valves). LOW PRESSURE lights: main pumps also
 *    light when switched off; centre pumps only when on (FCOM 12.20).
 *  - CROSSFEED valve (motorised, DC) joins the two engine manifolds; VALVE
 *    OPEN light bright blue in transit, dim when open.
 *  - The engine start lever and the engine fire handle close the spar
 *    (wing) valve and the engine fuel shutoff valve (ENG / SPAR VALVE CLOSED
 *    lights: bright in transit, dim closed, out open).
 *  - Suction feed: each engine can draw from its own main tank without pumps
 *    (below ~25,000 ft; FCOM: suction feed altitude depends on fuel
 *    temperature/volatility).
 *  - APU: from the left (No. 1) manifold, suction-fed from tank 1 when no AC
 *    pump runs (FCOM 12.20 "APU fuel").
 */
import type { SimContext } from '../../../core/SimContext';
import { ENG } from '../../../core/vars';
import { FuelSystem } from '../../../systems/fuel';
import { B738_FDM } from '../fdm';
import { B738_TANKS } from '../data';
import { B738, type FuelPump } from '../vars';

/** Main / centre boost pump performance (EST: 23 / 30 psi class, 20,000 pph shut-off-to-max flow, 10 A per phase). */
const PUMP = { mainPsi: 23, centerPsi: 30, maxPph: 20000, amps: 10 };

export function createFuel(ctx: Pick<SimContext, 'vars'>): FuelSystem {
  const t = B738_FDM.mass.tanks;
  const pumpOn = (p: FuelPump, bus: string): string => `${B738.fuelPump(p)} != 0 && elec.${bus}_powered`;
  const gauge = { power: 'elec.dc1_powered || elec.dc_stby_powered || elec.batt_bus_powered' };
  // Spar / engine shutoff valves: open with the start lever at IDLE and the fire handle in (FCOM 12.20); motorised on the hot battery bus.
  const valveOpen = (i: 1 | 2): string => `${B738.startLever(i)} >= 0.5 && !${B738.fireHandle(i)}`;
  return new FuelSystem(ctx.vars, {
    tanks: [
      { id: 'main1', index: 0, capacityKg: t[0].capacity_kg, unusableKg: t[0].unusable_kg, initialKg: 3000, lowLevelKg: B738_TANKS.lowKg, gauge },
      { id: 'main2', index: 1, capacityKg: t[1].capacity_kg, unusableKg: t[1].unusable_kg, initialKg: 3000, lowLevelKg: B738_TANKS.lowKg, gauge },
      { id: 'center', index: 2, capacityKg: t[2].capacity_kg, unusableKg: t[2].unusable_kg, initialKg: 0, lowLevelKg: 0, gauge },
    ],
    nodes: ['man1', 'man2', 'wing1', 'wing2', 'eng1_in', 'eng2_in'],
    pumps: [
      { id: 'l_fwd', kind: 'electric', from: 'main1', to: 'man1', pressurePsi: PUMP.mainPsi, maxFlowPph: PUMP.maxPph, on: pumpOn('l_fwd', 'fuel_l_fwd'), lowPressWhenOff: true, ratedAmps: PUMP.amps },
      { id: 'l_aft', kind: 'electric', from: 'main1', to: 'man1', pressurePsi: PUMP.mainPsi, maxFlowPph: PUMP.maxPph, on: pumpOn('l_aft', 'fuel_l_aft'), lowPressWhenOff: true, ratedAmps: PUMP.amps },
      { id: 'r_fwd', kind: 'electric', from: 'main2', to: 'man2', pressurePsi: PUMP.mainPsi, maxFlowPph: PUMP.maxPph, on: pumpOn('r_fwd', 'fuel_r_fwd'), lowPressWhenOff: true, ratedAmps: PUMP.amps },
      { id: 'r_aft', kind: 'electric', from: 'main2', to: 'man2', pressurePsi: PUMP.mainPsi, maxFlowPph: PUMP.maxPph, on: pumpOn('r_aft', 'fuel_r_aft'), lowPressWhenOff: true, ratedAmps: PUMP.amps },
      // Centre pumps: automatic low-output-pressure shutoff (b737.org.uk Fuel; SB/AD 2002-43-11 class change on
      // the NG): once the centre tank runs dry the pump latches off (logic.ts latch) with the switch still ON and
      // the LOW PRESSURE light on (cas.ts), preventing dry running; reset by cycling the switch OFF.
      {
        id: 'c_l',
        kind: 'electric',
        from: 'center',
        to: 'man1',
        pressurePsi: PUMP.centerPsi,
        maxFlowPph: PUMP.maxPph,
        on: `${pumpOn('c_l', 'fuel_c_l')} && !${B738.ctrPumpShutoff('c_l')}`,
        lowPressWhenOff: false,
        ratedAmps: PUMP.amps,
      },
      {
        id: 'c_r',
        kind: 'electric',
        from: 'center',
        to: 'man2',
        pressurePsi: PUMP.centerPsi,
        maxFlowPph: PUMP.maxPph,
        on: `${pumpOn('c_r', 'fuel_c_r')} && !${B738.ctrPumpShutoff('c_r')}`,
        lowPressWhenOff: false,
        ratedAmps: PUMP.amps,
      },
    ],
    valves: [
      { id: 'xfeed', a: 'man1', b: 'man2', open: `${B738.crossfeed} != 0`, travelS: 2, power: 'elec.fuel_valves_powered' }, // EST travel
      { id: 'spar1', a: 'man1', b: 'wing1', open: valveOpen(1), travelS: 1, power: 'elec.hot_batt_powered' },
      { id: 'spar2', a: 'man2', b: 'wing2', open: valveOpen(2), travelS: 1, power: 'elec.hot_batt_powered' },
      { id: 'engv1', a: 'wing1', b: 'eng1_in', open: valveOpen(1), travelS: 0.8, power: 'elec.hot_batt_powered' },
      { id: 'engv2', a: 'wing2', b: 'eng2_in', open: valveOpen(2), travelS: 0.8, power: 'elec.hot_batt_powered' },
    ],
    consumers: [
      // `fail.eng<n>.flameout` (engines.ts B738Eec failures): the combustor flames out (fuel to the burner lost)
      // while the failure is active; the EEC auto relight / FLT ignition can relight once it clears.
      { id: 'eng1', node: 'eng1_in', flowPph: ENG.fuelFlowPph(1), engine: 1, run: 'fadec.eng1.fuel_cmd && !fail.eng1.flameout', suction: { tank: 'main1', ceilingFt: 25000 }, minPressPsi: 3 },
      { id: 'eng2', node: 'eng2_in', flowPph: ENG.fuelFlowPph(2), engine: 2, run: 'fadec.eng2.fuel_cmd && !fail.eng2.flameout', suction: { tank: 'main2', ceilingFt: 25000 }, minPressPsi: 3 },
      // The APU fuel shutoff valve follows the ECU fuel command, so the 60 s cool-down after APU OFF keeps burning
      // (FCOM 7.10: "APU switch OFF ... APU continues to run for a cooling period"); the switch opens it for the start.
      { id: 'apu', node: 'man1', flowPph: 'apu.ff_pph', run: `${B738.apuSw} >= 1 || apu.fuel_cmd != 0`, suction: { tank: 'main1', running: `${B738.apuSw} >= 1 || apu.fuel_cmd != 0`, ceilingFt: 41000 }, minPressPsi: 2 },
    ],
    balance: { left: 'main1', right: 'main2', alertKg: B738_TANKS.imbalanceKg },
    temperature: { skin: 'fdm.tat_c', initialC: 15 },
  });
}
