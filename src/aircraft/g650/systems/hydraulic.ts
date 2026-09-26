/**
 * Gulfstream G650 hydraulics (LUC hydraulics, SCQ hydraulics, LIM).
 *
 * Two independent 3,000 psi systems plus sub-systems:
 *  - LEFT: L engine-driven pump (25-37 gpm idle-TO), 4.55 gal reservoir;
 *    landing gear, inboard brakes, flaps, main door, midboard spoilers,
 *    nosewheel steering, L thrust reverser, flight controls (LUC).
 *  - RIGHT: R EDP, 2.77 gal reservoir; outboard brakes, inboard and outboard
 *    spoilers, R thrust reverser, flight controls, PTU motor (LUC).
 *  - AUX pump: DC electric (L ESS DC), 3,000 psi at 2 gpm, into the LEFT
 *    system; ARM = automatic (on the ground with low L pressure and a brake
 *    pedal pressed; in flight for the gear / flaps after a dual EDP loss),
 *    ON = manual (2 min timer in flight); logic.ts writes the command.
 *  - PTU (PWR XFR UNIT): R-system motor drives a pump pressurising the LEFT
 *    system (no fluid transfer), 22 gpm; ARM = automatic when L < 2,400 psi
 *    (7 s debounce), off 7 s after L >= 2,750 psi (LUC).
 *  - Seven EBHAs (electro-backup hydraulic actuators): self-contained,
 *    powered from the EBHA battery bus; they are the "third system" for the
 *    flight controls (FlyByWire actuator binding, createSystems.ts).
 * Fire handles close the hydraulic shutoff valves (EDP isolated, LUC fire).
 * Accumulators: 1,200 psi nitrogen precharge (LIM).
 */
import type { SimContext } from '../../../core/SimContext';
import { HydraulicSystem } from '../../../systems/hydraulic';
import { G650_LIMITS } from '../data';
import { G650_VARS as V } from '../vars';

const GAL = 3.785411784;
export const hydFrac = (sys: 'left' | 'right'): string => `clamp01(hyd.${sys}_psi / 2600)`;

export function createHydraulics(ctx: Pick<SimContext, 'vars'>): HydraulicSystem {
  const P = G650_LIMITS.hydPsi;
  const acc = { prechargePsi: G650_LIMITS.accPrechargePsi, volumeL: 2.5 }; // EST volume
  return new HydraulicSystem(ctx.vars, {
    systems: [
      { id: 'left', nominalPsi: P, reservoirL: 4.55 * GAL, accumulator: acc, lowPressPsi: G650_LIMITS.hydLowPsi, lowQty: 1.98 / 4.55 }, // "L Hydraulic Quantity Low" < 1.98 gal
      { id: 'right', nominalPsi: P, reservoirL: 2.77 * GAL, accumulator: acc, lowPressPsi: G650_LIMITS.hydLowPsi, lowQty: 0.8 / 2.77 },
    ],
    pumps: [
      // EDPs: 37 gpm at takeoff HP (LUC 25-37 gpm idle-TO). Engine-driven, isolated by the fire handle shutoff valve.
      { id: 'edp_l', system: 'left', kind: 'edp', maxFlowLpm: 37 * GAL, drive: 'eng1.n2_pct / 100', on: `!${V.fireHandleL}` },
      { id: 'edp_r', system: 'right', kind: 'edp', maxFlowLpm: 37 * GAL, drive: 'eng2.n2_pct / 100', on: `!${V.fireHandleR}` },
      // AUX pump: 3,000 psi at 2 gpm (LUC), DC motor.
      { id: 'aux', system: 'left', kind: 'electric', maxFlowLpm: 2 * GAL, drive: 'elec.hyd_aux_powered', on: V.auxPumpCmd, electric: { supply: 'dc', efficiency: 0.7 }, lowPressWhenOff: false },
    ],
    transfers: [
      // PTU: R drives a pump in L, 22 gpm (LUC); unidirectional.
      { id: 'ptu', kind: 'ptu', from: 'right', to: 'left', maxFlowLpm: 22 * GAL, active: V.ptuCmd, efficiency: 0.8 },
    ],
    consumers: [
      // Flight-control actuators on both systems (9 HA + 7 EBHA, LUC): quiescent + surface motion (EST).
      { id: 'fcs_l', system: 'left', demandLpm: '2 + 12 * (abs(surf.elevator) + abs(surf.aileron) + abs(surf.rudder)) * 0.2' },
      { id: 'fcs_r', system: 'right', demandLpm: '2 + 12 * (abs(surf.elevator) + abs(surf.aileron) + abs(surf.rudder)) * 0.2' },
      { id: 'gear', system: 'left', demandLpm: '60 * gear.moving' },
      { id: 'flaps', system: 'left', demandLpm: '30 * flaps.moving' },
      { id: 'nws', system: 'left', demandLpm: '1 * steer.engaged' },
      { id: 'rev_l', system: 'left', demandLpm: '45 * fadec.eng1.rev_unlocked' },
      { id: 'rev_r', system: 'right', demandLpm: '45 * fadec.eng2.rev_unlocked' },
      { id: 'spoilers_l', system: 'left', demandLpm: '15 * spoilers.moving' }, // midboard panels
      { id: 'spoilers_r', system: 'right', demandLpm: '30 * spoilers.moving' }, // inboard + outboard panels
      { id: 'brakes_in', system: 'left', demandLpm: '3 * max(gear.brake_left, gear.brake_right)' }, // inboard brakes
      { id: 'brakes_out', system: 'right', demandLpm: '3 * max(gear.brake_left, gear.brake_right)' }, // outboard brakes
      { id: 'door', system: 'left', demandLpm: `2 * (${V.doorMain} > 0.02 && ${V.doorMain} < 0.98)` }, // main door actuator
    ],
  });
}
