/**
 * Citation Longitude PITCH/ROLL DISCONNECT handle.
 *
 * Source: Longitude emergency/abnormal checklist card published with the DGAC
 * Chile type-rating evaluation form "Textron Citation Longitude C700" (2021),
 * p.3: "JAMMED PITCH OR ROLL CONTROL SYSTEM: 1. Control Wheel - Relax Pressure.
 * 2. PITCH/ROLL DISCONNECT Handle - Pull Until Latched. 3. Operative Control
 * Wheel - Identify, Recover Airplane Attitude." The elevator and aileron runs
 * are cable driven (OG 15-2); the handle splits the pilot's and copilot's
 * columns/wheels so each drives its own half of the elevator and ailerons.
 *
 * Model (the FDM has one elevator and one aileron command, so the halves are
 * averaged):
 *  - Handle stowed: no effect (the MechanicalFlightControls output stands).
 *  - Handle pulled: surf = 0.5 * operative half + 0.5 * other half.
 *    The operative half is the flying pilot's wheel (the single pilot input)
 *    and follows `fcs.<axis>_column` at the normal surface rate. The other
 *    half stays where the jam holds it (`fcs.<axis>_jam`: the channel's frozen
 *    output) or, with no jam, trails at neutral (EST: the unattended wheel's
 *    half floats to the aerodynamic neutral).
 *  - The autopilot disconnects when the handle is pulled and cannot be
 *    re-engaged while it is latched (EST: the AP pitch and roll servos drive
 *    one cable run; Citation-family practice, `disconnect.auto` /
 *    `engageInhibit` in createSystems.ts).
 * SCOPE: the handle is reset on the ground (maintenance action on the real
 * aircraft); pushing it back in the cockpit re-connects the runs.
 *
 * Runs right after MechanicalFlightControls and before the spoilers (roll
 * spoilers follow the aileron). No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import { LON_VARS as V } from '../vars';

const RATE = 2.5; // surface full scale per second: MechanicalFlightControls default (EST)

interface Half {
  column: string;
  jam: string;
  surf: string;
  free: number;
}

export class LongitudePitchRollDisconnect implements Subsystem {
  readonly name = 'lon.pitch_roll_disconnect';
  private readonly halves: Half[] = [
    { column: 'fcs.pitch_column', jam: 'fcs.pitch_jam', surf: 'surf.elevator', free: 0 },
    { column: 'fcs.roll_column', jam: 'fcs.roll_jam', surf: 'surf.aileron', free: 0 },
  ];
  private wasSplit = false;

  constructor(private readonly vars: SimVars) {}

  update(dt: number): void {
    const v = this.vars;
    const split = v.get(V.pitchRollDisc) !== 0;
    for (let i = 0; i < this.halves.length; i++) {
      const h = this.halves[i];
      const channel = v.get(h.surf); // MechanicalFlightControls output this frame (frozen if jammed)
      if (!split) {
        h.free = channel;
        continue;
      }
      if (!this.wasSplit) h.free = channel;
      const cmd = v.get(h.column);
      const step = RATE * dt;
      const d = cmd - h.free;
      h.free += d > step ? step : d < -step ? -step : d;
      const other = v.get(h.jam) !== 0 ? channel : 0;
      v.set(h.surf, 0.5 * h.free + 0.5 * other);
    }
    this.wasSplit = split;
  }

  reset(): void {
    this.wasSplit = false;
    for (const h of this.halves) h.free = this.vars.get(h.surf);
  }
}
