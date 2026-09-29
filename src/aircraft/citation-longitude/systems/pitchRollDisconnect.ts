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
 * Handle (AOPA 2021 photograph a21_006, pedestal aft face): red flag "PULL"
 * at NORM; pulled = both axes split; rotated up = PITCH RECONNECT (pitch runs
 * re-joined, roll still split), down = ROLL RECONNECT; pushed in =
 * "PITCH/ROLL RECONNECT PUSH-RESET" (both re-joined, NORM).
 * Reconnect (LON4-03): on the aircraft the reconnect detents re-engage the
 * disconnect mechanism only when the columns / wheels are aligned (patent
 * US7229047, dual-cable disconnect couplings). Modelled: a reconnect selection
 * re-joins an axis only once the flying pilot's half is within RECONNECT_ALIGN
 * of the other half (the jam position, or neutral with no jam); until then the
 * axis stays split with the handle in the detent. EST threshold.
 *
 * Runs right after MechanicalFlightControls and before the spoilers (roll
 * spoilers follow the aileron). No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import { LON_VARS as V } from '../vars';

const RATE = 2.5; // surface full scale per second: MechanicalFlightControls default (EST)
/** EST: coupling re-engagement window (normalized surface units), see the header (patent US7229047). */
const RECONNECT_ALIGN = 0.08;

interface Half {
  column: string;
  jam: string;
  surf: string;
  free: number;
  wasSplit: boolean;
}

export class LongitudePitchRollDisconnect implements Subsystem {
  readonly name = 'lon.pitch_roll_disconnect';
  private readonly halves: Half[] = [
    { column: 'fcs.pitch_column', jam: 'fcs.pitch_jam', surf: 'surf.elevator', free: 0, wasSplit: false },
    { column: 'fcs.roll_column', jam: 'fcs.roll_jam', surf: 'surf.aileron', free: 0, wasSplit: false },
  ];
  constructor(private readonly vars: SimVars) {}

  update(dt: number): void {
    const v = this.vars;
    // Handle states (AOPA 2021 photograph a21_006: PULL; rotate up PITCH RECONNECT, down ROLL RECONNECT; PUSH-RESET):
    // 1 = both axes split, 2 = pitch reconnected (roll still split), 3 = roll reconnected (pitch still split).
    const st = v.get(V.pitchRollDisc);
    for (let i = 0; i < this.halves.length; i++) {
      const h = this.halves[i];
      const wantSplit = i === 0 ? st === 1 || st === 3 : st === 1 || st === 2;
      const channel = v.get(h.surf); // MechanicalFlightControls output this frame (frozen if jammed)
      const other = v.get(h.jam) !== 0 ? channel : 0;
      // Reconnect only when the halves are aligned (LON4-03, patent US7229047): the coupling re-engages
      // once the flying pilot's half is within RECONNECT_ALIGN of the other half; otherwise stay split.
      const split = wantSplit || (h.wasSplit && Math.abs(h.free - other) > RECONNECT_ALIGN);
      if (!split) h.wasSplit = false;
      if (!split) {
        h.free = channel;
        continue;
      }
      if (!h.wasSplit) h.free = channel;
      h.wasSplit = true;
      const cmd = v.get(h.column);
      const step = RATE * dt;
      const d = cmd - h.free;
      h.free += d > step ? step : d < -step ? -step : d;
      v.set(h.surf, 0.5 * h.free + 0.5 * other);
    }
  }

  reset(): void {
    for (const h of this.halves) {
      h.wasSplit = false;
      h.free = this.vars.get(h.surf);
    }
  }
}
