/**
 * Boeing 737-800 hydraulic power (FCOM 13.20 "Hydraulics"; B737ORG
 * "Hydraulics"; LIM).
 *
 *  - System A: engine-driven pump on engine 1 (ENG 1) + AC motor pump
 *    powered from XFR bus 2 (ELEC 2). System B: ENG 2 pump + ELEC 1 pump (XFR
 *    bus 1). 3,000 psi normal, 2,800 min, relief 3,500 (LIM). EDP 37 gpm, EMDP
 *    6 gpm (B737ORG). Reservoirs A 21.6 l, B 31.1 l (B737ORG quantity table).
 *    LOW PRESSURE lights below 1,300 psi (FCOM). The engine fire handle closes
 *    the EDP supply shutoff valve (FCOM 8.20).
 *  - Standby system: one AC motor pump (3 gpm, B737ORG) on XFR bus 1, run by
 *    FLT CONTROL A/B STBY RUD, ALTERNATE FLAPS ARM, or automatically (loss of
 *    A or B with flaps extended, airborne or wheel speed > 60 kt, FCOM 9.20).
 *    Serves the standby rudder PCU, LE devices (extend only) and both
 *    reversers (slow).
 *  - PTU: system A pressure drives a pump in system B to keep the autoslats
 *    and LE devices available when the B EDP pressure is lost (airborne,
 *    flaps extended but less than 15, FCOM 13.20).
 *  - Landing gear transfer unit: system B supplies gear retraction when
 *    engine 1 N2 drops below limits in flight with the gear lever UP.
 *
 * The consumers turn actuator motion into flow demand so pumps droop and
 * slow actuators when they are overloaded (e.g. a single ELEC pump).
 */
import type { SimContext } from '../../../core/SimContext';
import { HydraulicSystem } from '../../../systems/hydraulic';
import { HYD_LIMITS } from '../data';
import { B738 } from '../vars';

export const HYD_A = 'clamp01(hyd.a_psi / 2800)';
export const HYD_B = 'clamp01(hyd.b_psi / 2800)';
export const HYD_STBY = 'clamp01(hyd.stby_psi / 2800)';

export function createHydraulics(ctx: Pick<SimContext, 'vars'>): HydraulicSystem {
  const H = HYD_LIMITS;
  return new HydraulicSystem(ctx.vars, {
    systems: [
      { id: 'a', nominalPsi: H.normalPsi, reservoirL: H.resAL, reliefPsi: H.reliefPsi, lowPressPsi: H.lowPressPsi, lowQty: 0.2 },
      { id: 'b', nominalPsi: H.normalPsi, reservoirL: H.resBL, reliefPsi: H.reliefPsi, lowPressPsi: H.lowPressPsi, lowQty: 0.2 },
      { id: 'stby', nominalPsi: H.normalPsi, reservoirL: H.resStbyL, reliefPsi: H.reliefPsi, lowPressPsi: H.lowPressPsi, lowQty: 0.5 },
    ],
    pumps: [
      { id: 'edp_a', system: 'a', kind: 'edp', maxFlowLpm: H.edpLpm, drive: 'eng1.n2_pct / 100', on: `${B738.hydPump('eng1')} != 0 && !${B738.fireHandle(1)}` },
      { id: 'emdp_a', system: 'a', kind: 'electric', maxFlowLpm: H.emdpLpm, drive: 'elec.hyd_elec2_powered', on: `${B738.hydPump('elec2')} != 0`, electric: { supply: 'ac', efficiency: 0.75, nominalV: 115, noLoadW: 300 } },
      { id: 'emdp_b', system: 'b', kind: 'electric', maxFlowLpm: H.emdpLpm, drive: 'elec.hyd_elec1_powered', on: `${B738.hydPump('elec1')} != 0`, electric: { supply: 'ac', efficiency: 0.75, nominalV: 115, noLoadW: 300 } },
      { id: 'edp_b', system: 'b', kind: 'edp', maxFlowLpm: H.edpLpm, drive: 'eng2.n2_pct / 100', on: `${B738.hydPump('eng2')} != 0 && !${B738.fireHandle(2)}` },
      { id: 'stby_pump', system: 'stby', kind: 'electric', maxFlowLpm: H.stbyLpm, drive: 'elec.hyd_stby_powered', on: B738.stbyPumpCmd, lowPressWhenOff: false, electric: { supply: 'ac', efficiency: 0.7, nominalV: 115, noLoadW: 150 } },
    ],
    transfers: [
      // PTU: hydraulic motor in A driving a pump in B (EST 30 l/min, efficiency 0.8).
      { id: 'ptu', kind: 'ptu', from: 'a', to: 'b', maxFlowLpm: 30, active: B738.ptuCmd, efficiency: 0.8 },
    ],
    consumers: [
      // ---- System A: ailerons/elevator/rudder PCUs (A), ground spoilers + inboard flight spoilers, NWS, gear, alternate brakes, reverser 1
      { id: 'fcs_a', system: 'a', demandLpm: `${B738.fltCtl('a')} == 1 ? 3 + 20 * (abs(ap.servo_pitch) + abs(fcs.pitch_column) * 0.3) : 0` },
      { id: 'gear_a', system: 'a', demandLpm: `gear.moving * (${B738.gearXferUnit} ? 0 : 70)` },
      { id: 'nws', system: 'a', demandLpm: `steer.engaged * 4` },
      { id: 'spoilers_a', system: 'a', demandLpm: 'spoilers.moving * 25' },
      { id: 'rev1', system: 'a', demandLpm: 'fadec.eng1.rev_unlocked * 60' },
      // ---- System B: PCUs (B), outboard flight spoilers, TE flaps, LE devices, normal brakes, yaw damper, reverser 2, gear transfer
      { id: 'fcs_b', system: 'b', demandLpm: `${B738.fltCtl('b')} == 1 ? 3 + 20 * (abs(ap.servo_pitch) + abs(fcs.pitch_column) * 0.3) : 0` },
      { id: 'flaps', system: 'b', demandLpm: 'flaps.moving * 40' },
      { id: 'slats', system: 'b', demandLpm: 'slats.transit * 25' },
      { id: 'brakes_b', system: 'b', demandLpm: '(gear.brake_left + gear.brake_right) * 3' },
      { id: 'gear_xfer', system: 'b', demandLpm: `gear.moving * ${B738.gearXferUnit} * 70` },
      { id: 'rev2', system: 'b', demandLpm: 'fadec.eng2.rev_unlocked * 60' },
      // ---- Standby: standby rudder PCU, LE devices extension, reversers (slow)
      { id: 'stby_rud', system: 'stby', demandLpm: `${B738.stbyRudder} * 3` },
      { id: 'stby_le', system: 'stby', demandLpm: `${B738.altFlapsArm} * slats.transit * 8` },
    ],
  });
}
