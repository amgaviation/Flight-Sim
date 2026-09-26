/**
 * Bombardier Global 6000 hydraulics (GXHY): three independent 3,000 psi
 * systems.
 *  - System 1: EDP 1A (left engine) + ACMP 1B (AC BUS 3); left primary flight
 *    controls and rudder, left / right multifunction spoilers, ground
 *    spoilers, left thrust reverser.
 *  - System 2: EDP 2A (right engine) + ACMP 2B (AC BUS 2); right primary
 *    flight controls and rudder, multifunction spoilers, main gear
 *    extension / retraction actuators, right thrust reverser, outboard brakes
 *    (with the system 2 brake accumulator).
 *  - System 3: ACMP 3A (primary, AC BUS 4, normally ON) + ACMP 3B (backup,
 *    AC BUS 1) + the RAT pump; all primary flight controls, ground spoilers,
 *    gear side-brace actuators / doors / uplocks / nose gear, inboard and
 *    park / emergency brakes, nosewheel steering (brake accumulator 500 psi
 *    precharge, RAT accumulator 1,000 psi).
 * The electrically operated hydraulic SOVs on the EDP suction lines close with
 * the L / R HYD SOV switches or the fire handles. B pumps (and 3A in AUTO)
 * are commanded by logic.ts (ACPC logic).
 * Pressure colours on the synoptic (Fusion suite): green > 1,800, amber <=
 * 1,800 psi (GXHY). HYD n LO PRESS = both pumps of the system < 1,800 psi.
 * Flow rates / reservoir sizes are EST (not in the public manuals).
 */
import type { SimContext } from '../../../core/SimContext';
import { HydraulicSystem } from '../../../systems/hydraulic';
import { G6K_LIMITS } from '../data';
import { G6K_VARS as V } from '../vars';

const GAL = 3.785411784;
/** 0..1 availability of a hydraulic system for actuators (full rate above ~2,600 psi). */
export const hydFrac = (n: 1 | 2 | 3): string => `clamp01(hyd.sys${n}_psi / 2600)`;

export function createHydraulics(ctx: Pick<SimContext, 'vars'>): HydraulicSystem {
  const P = G6K_LIMITS.hydPsi;
  const low = G6K_LIMITS.hydLowPsi;
  return new HydraulicSystem(ctx.vars, {
    systems: [
      { id: 'sys1', nominalPsi: P, reservoirL: 3.2 * GAL, lowPressPsi: low, lowQty: 0.25 }, // EST reservoir sizes
      { id: 'sys2', nominalPsi: P, reservoirL: 3.2 * GAL, accumulator: { prechargePsi: G6K_LIMITS.brakeAccPrechargePsi, volumeL: 2 }, lowPressPsi: low, lowQty: 0.25 },
      { id: 'sys3', nominalPsi: P, reservoirL: 2.6 * GAL, accumulator: { prechargePsi: G6K_LIMITS.brakeAccPrechargePsi, volumeL: 2 }, lowPressPsi: low, lowQty: 0.25 },
    ],
    pumps: [
      // EDPs: EST 30 gpm at take-off N2 (variable displacement, capacity ~ N2), SOV on the suction line.
      { id: 'pump1a', system: 'sys1', kind: 'edp', maxFlowLpm: 30 * GAL, drive: 'eng1.n2_pct / 100', on: V.sovOpen(1), lowPressPsi: low },
      { id: 'pump2a', system: 'sys2', kind: 'edp', maxFlowLpm: 30 * GAL, drive: 'eng2.n2_pct / 100', on: V.sovOpen(2), lowPressPsi: low },
      // ACMPs: EST 6.5 gpm each (backup / take-off & landing flow), 115 V AC.
      { id: 'pump1b', system: 'sys1', kind: 'electric', maxFlowLpm: 6.5 * GAL, drive: 'elec.acmp1b_powered', on: V.acmpCmd('1b'), lowPressPsi: low, lowPressWhenOff: false, electric: { supply: 'ac', efficiency: 0.75 } },
      { id: 'pump2b', system: 'sys2', kind: 'electric', maxFlowLpm: 6.5 * GAL, drive: 'elec.acmp2b_powered', on: V.acmpCmd('2b'), lowPressPsi: low, lowPressWhenOff: false, electric: { supply: 'ac', efficiency: 0.75 } },
      { id: 'pump3a', system: 'sys3', kind: 'electric', maxFlowLpm: 6.5 * GAL, drive: 'elec.acmp3a_powered', on: V.acmpCmd('3a'), lowPressPsi: low, lowPressWhenOff: false, electric: { supply: 'ac', efficiency: 0.75 } },
      { id: 'pump3b', system: 'sys3', kind: 'electric', maxFlowLpm: 6.5 * GAL, drive: 'elec.acmp3b_powered', on: V.acmpCmd('3b'), lowPressPsi: low, lowPressWhenOff: false, electric: { supply: 'ac', efficiency: 0.75 } },
      // RAT pump (GXHY): turbine speed ~ airspeed while deployed; EST full delivery above 130 KCAS.
      { id: 'pumprat', system: 'sys3', kind: 'rat', maxFlowLpm: 5 * GAL, drive: `clamp01(${V.ratDrive} / 130)`, on: V.pumpRatCmd, lowPressPsi: low, lowPressWhenOff: false },
    ],
    consumers: [
      // Primary flight control PCUs (EST quiescent + surface motion).
      { id: 'fcs1', system: 'sys1', demandLpm: '2 + 10 * (abs(surf.elevator) + abs(surf.aileron) + abs(surf.rudder)) * 0.2' },
      { id: 'fcs2', system: 'sys2', demandLpm: '2 + 10 * (abs(surf.elevator) + abs(surf.aileron) + abs(surf.rudder)) * 0.2' },
      { id: 'fcs3', system: 'sys3', demandLpm: '2 + 10 * (abs(surf.elevator) + abs(surf.aileron) + abs(surf.rudder)) * 0.2' },
      { id: 'mfs1', system: 'sys1', demandLpm: '12 * spoilers.moving' },
      { id: 'mfs2', system: 'sys2', demandLpm: '12 * spoilers.moving' },
      { id: 'gs3', system: 'sys3', demandLpm: '10 * spoilers.moving' },
      { id: 'mlg_actuators', system: 'sys2', demandLpm: '55 * gear.moving' },
      { id: 'gear_locks_doors', system: 'sys3', demandLpm: '15 * gear.moving + 10 * gear.doors' },
      { id: 'rev1', system: 'sys1', demandLpm: '45 * fadec.eng1.rev_unlocked' },
      { id: 'rev2', system: 'sys2', demandLpm: '45 * fadec.eng2.rev_unlocked' },
      { id: 'brakes_ob', system: 'sys2', demandLpm: '3 * max(gear.brake_left, gear.brake_right)' },
      { id: 'brakes_ib', system: 'sys3', demandLpm: '3 * max(gear.brake_left, gear.brake_right)' },
      { id: 'nws', system: 'sys3', demandLpm: '1 * steer.engaged' },
    ],
  });
}
