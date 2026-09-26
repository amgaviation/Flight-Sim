/**
 * Citation Longitude hydraulics (OG Section 13; OG 2-4/2-5, 7-2, 14-2, 15-3).
 *
 * Two 3,000 psi systems: A from the left engine-driven pump, B from the right
 * (OG 13-2). HYDRAULICS PUMP switches: NORM / MIN (depressurisation valve,
 * reduced output) / SHUTOFF (pump off-line + firewall shutoff valve).
 * Accumulators for nosewheel steering, ground spoilers and brakes (OG 13-2;
 * brake/park accumulators are modelled by the Brakes block, the four
 * ground-spoiler accumulators by logic.ts).
 *
 * PTCU (Power Transfer and Conversion Unit): a hydraulic motor/pump pair plus
 * a motor-generator. Modes (OG 13-4): OFF; AUX A / AUX B = electric motor
 * drives a pump into A / B; NORM = automatic (charges the brake accumulators
 * at power-up B then A, primes A/B during the on-side engine start, otherwise
 * power transfer between A and B); HYD GEN = hydraulic motor from B (or A)
 * drives the generator (electrical.ts `ptcu_gen`). Logic in logic.ts writes
 * `hyd.ptcu_*_cmd`.
 *
 * Rudder Standby System (OG 13-3): self-contained electric pump + reservoir
 * powering the rudder when system A is lost (RUDDER STANDBY NORM).
 *
 * Users: A = rudder, left thrust reverser, inboard brakes, gear (EST), left
 * spoiler panels (EST split); B = outboard brakes, right thrust reverser,
 * nosewheel steering (EST), right spoiler panels (EST).
 * Flows / volumes are EST (bizjet class: 8 gpm EDP, 6 L reservoir).
 */
import type { SimContext } from '../../../core/SimContext';
import { HydraulicSystem } from '../../../systems/hydraulic';
import { LON_LIMITS } from '../data';
import { LON_VARS as V } from '../vars';

export const hydFrac = (sys: 'a' | 'b' | 'rss'): string => `clamp01(hyd.${sys}_psi / 2600)`;

export function createHydraulics(ctx: Pick<SimContext, 'vars'>): HydraulicSystem {
  const P = LON_LIMITS.hydPsi;
  return new HydraulicSystem(ctx.vars, {
    systems: [
      { id: 'a', nominalPsi: P, reservoirL: 6, accumulator: { prechargePsi: 1500, volumeL: 1.0 }, lowPressPsi: 1500 },
      { id: 'b', nominalPsi: P, reservoirL: 6, accumulator: { prechargePsi: 1500, volumeL: 1.0 }, lowPressPsi: 1500 },
      { id: 'rss', nominalPsi: P, reservoirL: 1, lowPressPsi: 1500 },
    ],
    pumps: [
      // Engine-driven pumps (EST 30 L/min at max N2): NORM full pressure; MIN depressurised (EST 1,500 psi).
      { id: 'edp_a', system: 'a', kind: 'edp', maxFlowLpm: 30, drive: 'eng1.n2_pct / 100', on: `${V.hydPumpA} == 0 && !${V.fireEngL}` },
      { id: 'edp_b', system: 'b', kind: 'edp', maxFlowLpm: 30, drive: 'eng2.n2_pct / 100', on: `${V.hydPumpB} == 0 && !${V.fireEngR}` },
      { id: 'edp_a_min', system: 'a', kind: 'edp', ratedPsi: 1500, maxFlowLpm: 30, drive: 'eng1.n2_pct / 100', on: `${V.hydPumpA} == 1 && !${V.fireEngL}`, lowPressWhenOff: false },
      { id: 'edp_b_min', system: 'b', kind: 'edp', ratedPsi: 1500, maxFlowLpm: 30, drive: 'eng2.n2_pct / 100', on: `${V.hydPumpB} == 1 && !${V.fireEngR}`, lowPressWhenOff: false },
      // PTCU electric motor driving its A or B pump (AUX modes, priming, accumulator charging). EST 8 L/min.
      { id: 'ptcu_pump_a', system: 'a', kind: 'electric', maxFlowLpm: 8, drive: 'elec.ptcu_motor_powered', on: 'hyd.ptcu_a_cmd', electric: { supply: 'dc', efficiency: 0.7 }, lowPressWhenOff: false },
      { id: 'ptcu_pump_b', system: 'b', kind: 'electric', maxFlowLpm: 8, drive: 'elec.ptcu_motor_powered', on: 'hyd.ptcu_b_cmd', electric: { supply: 'dc', efficiency: 0.7 }, lowPressWhenOff: false },
      // Rudder standby pump (EST 3 L/min).
      { id: 'rss_pump', system: 'rss', kind: 'electric', maxFlowLpm: 3, drive: 'elec.rss_pump_powered', on: V.rssActive, electric: { supply: 'dc', efficiency: 0.65 }, lowPressWhenOff: false },
    ],
    transfers: [
      // PTCU power-transfer mode (hydraulic motor/pump pair, bidirectional, OG 13-3/13-6).
      { id: 'ptcu_xfer', kind: 'ptu', from: 'a', to: 'b', maxFlowLpm: 12, bidirectional: true, triggerDeltaPsi: 500, active: 'hyd.ptcu_xfer_cmd' },
    ],
    consumers: [
      { id: 'rudder_a', system: 'a', demandLpm: '0.5 + 3 * abs(surf.rudder)' },
      { id: 'rudder_rss', system: 'rss', demandLpm: `${V.rssActive} * (0.3 + 3 * abs(surf.rudder))` },
      { id: 'gear', system: 'a', demandLpm: '28 * gear.moving' },
      { id: 'rev_l', system: 'a', demandLpm: '25 * fadec.eng1.rev_unlocked' },
      { id: 'rev_r', system: 'b', demandLpm: '25 * fadec.eng2.rev_unlocked' },
      { id: 'spoilers_a', system: 'a', demandLpm: '10 * spoilers.moving' },
      { id: 'spoilers_b', system: 'b', demandLpm: '10 * spoilers.moving' },
      { id: 'nws', system: 'b', demandLpm: '0.5 * steer.engaged' },
      { id: 'brakes_a', system: 'a', demandLpm: '2 * max(gear.brake_left, gear.brake_right)' },
      { id: 'brakes_b', system: 'b', demandLpm: '2 * max(gear.brake_left, gear.brake_right)' },
      // PTCU hydraulic motor in HYD GEN mode (EST 14 L/min at the 200 A generator rating).
      { id: 'ptcu_gen_a', system: 'a', demandLpm: `(hyd.ptcu_gen_cmd && ${V.ptcuGenSrcB} == 0) * (2 + 12 * elec.ptcu_gen_load_pct / 100)` },
      { id: 'ptcu_gen_b', system: 'b', demandLpm: `(hyd.ptcu_gen_cmd && ${V.ptcuGenSrcB} == 1) * (2 + 12 * elec.ptcu_gen_load_pct / 100)` },
    ],
  });
}
