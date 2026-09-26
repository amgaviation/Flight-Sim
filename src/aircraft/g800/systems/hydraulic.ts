/**
 * G800 hydraulics (SCQ hydraulics, GVI limitations; GVI-family architecture).
 *
 *  - Left and right 3,000 psi systems; engine-driven pumps are constant-pressure,
 *    variable-volume, 3,000-3,500 psi whenever the engine runs (SCQ). There is no
 *    EDP switch: a shutoff valve in the pump supply line closes when the engine
 *    fire handle is pulled (SCQ).
 *  - AUX pump (electric, AC) in the LEFT system: powers flaps, landing gear,
 *    inboard brakes and parking brake, cabin door and nosewheel steering on the
 *    ground and as a backup (SCQ). Switch OFF / ARM / ON (EST ARM logic: runs
 *    automatically when the left system is low with no PTU pressure).
 *  - PTU transfers power (not fluid) from the RIGHT to the LEFT system when the
 *    right system is pressurised and the left is depressurised but intact (SCQ).
 *    PWR XFR UNIT OFF / ARM / ON; "PTU Hydraulic Fail" below 1,500 psi output.
 *  - Accumulators: three (two active, one passive), 1,200 psi nitrogen precharge (SCQ/GVI).
 *  - Reservoirs (GVI indicated full): left 2.8-3.0 gal, right 1.4-1.6 gal.
 *  - Users: both systems drive every primary flight-control surface actuator
 *    (single-system loss leaves all primary surfaces operative except one
 *    spoiler pair, SCQ); EBHAs back up the rudder, ailerons, elevators and the
 *    outboard spoilers electrically (flightcontrols in createSystems.ts). Left:
 *    flaps, gear, NWS, inboard brakes, parking brake, cabin door, left thrust
 *    reverser (EST). Right: right thrust reverser, PTU motor, outboard brakes (EST).
 * Flow capacities are EST (large-cabin bizjet class: EDP ~16 gpm, AUX ~3 gpm).
 */
import type { SimContext } from '../../../core/SimContext';
import { HydraulicSystem } from '../../../systems/hydraulic';
import { G800_LIMITS } from '../data';
import { G800_VARS as V } from '../vars';

const GAL_L = 3.785411784;
export const hydFrac = (sys: 'left' | 'right'): string => `clamp01(hyd.${sys}_psi / 2600)`;

export function createHydraulics(ctx: Pick<SimContext, 'vars'>): HydraulicSystem {
  const P = G800_LIMITS.hydPsi;
  const fc = '1 + 5 * (abs(surf.elevator) + abs(surf.aileron) + abs(surf.rudder))'; // FBW actuators, both systems (EST L/min)
  return new HydraulicSystem(ctx.vars, {
    systems: [
      { id: 'left', nominalPsi: P, reservoirL: G800_LIMITS.hydReservoirLeftGal * GAL_L, accumulator: { prechargePsi: G800_LIMITS.accumPrechargePsi, volumeL: 2 }, lowPressPsi: 1500 },
      { id: 'right', nominalPsi: P, reservoirL: G800_LIMITS.hydReservoirRightGal * GAL_L, accumulator: { prechargePsi: G800_LIMITS.accumPrechargePsi, volumeL: 1.5 }, lowPressPsi: 1500 },
    ],
    pumps: [
      { id: 'edp_l', system: 'left', kind: 'edp', maxFlowLpm: 60, drive: 'eng1.n2_pct / 100', on: `${V.fireHandleL} == 0` },
      { id: 'edp_r', system: 'right', kind: 'edp', maxFlowLpm: 60, drive: 'eng2.n2_pct / 100', on: `${V.fireHandleR} == 0` },
      { id: 'aux', system: 'left', kind: 'electric', maxFlowLpm: 12, drive: 'elec.aux_hyd_powered', on: V.auxPumpOn, electric: { supply: 'ac', efficiency: 0.75 }, lowPressWhenOff: false },
    ],
    transfers: [{ id: 'ptu', kind: 'ptu', from: 'right', to: 'left', maxFlowLpm: 30, active: V.ptuOn, efficiency: 0.8 }],
    consumers: [
      { id: 'fc_left', system: 'left', demandLpm: fc },
      { id: 'fc_right', system: 'right', demandLpm: fc },
      { id: 'flaps', system: 'left', demandLpm: '20 * flaps.moving' },
      { id: 'gear', system: 'left', demandLpm: '40 * gear.moving' },
      { id: 'nws', system: 'left', demandLpm: '0.5 * steer.engaged' },
      { id: 'brakes_ib', system: 'left', demandLpm: '3 * max(gear.brake_left, gear.brake_right)' },
      { id: 'brakes_ob', system: 'right', demandLpm: '3 * max(gear.brake_left, gear.brake_right)' },
      { id: 'rev_l', system: 'left', demandLpm: '30 * fadec.eng1.rev_unlocked' },
      { id: 'rev_r', system: 'right', demandLpm: '30 * fadec.eng2.rev_unlocked' },
      { id: 'spoilers_l', system: 'left', demandLpm: '12 * spoilers.moving' },
      { id: 'spoilers_r', system: 'right', demandLpm: '12 * spoilers.moving' },
    ],
  });
}
