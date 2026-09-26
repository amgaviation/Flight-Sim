/**
 * Control-wheel and tiller inputs of the 3D cockpit (added with the cockpit
 * build). The app's input module rewrites `input.pitch_trim_rate`,
 * `input.ap_disc` and `input.tiller` every frame from the keyboard and the
 * hardware, so the cockpit's yoke switches and tiller handle write their own
 * vars and this block merges them for the systems:
 *
 *  - Pitch trim split switches (one per control wheel): pilot priority over
 *    the copilot (Citation-family trim priority, EST) -> `V.yokeTrimCmd`,
 *    read by the stabilizer TrimAxis alongside `input.pitch_trim_rate`.
 *    Operating a wheel trim switch disconnects the autopilot (Garmin GFC:
 *    "the AP is disconnected when the pilot operates the MEPT switch";
 *    G5000 CRG AFCS section).
 *  - AP/TRIM DISC buttons: pressing disconnects the AP (event `ap.disc`,
 *    emitted by the button itself); while held, electric pitch trim and
 *    the stick pusher are interrupted (`V.discHeld`, EST: Citation-family
 *    AP/TRIM DISC function, used by the stall-warning pusher `enabled` and
 *    the trim `enable` bindings in createSystems.ts).
 *  - Tiller: the larger of the hardware axis (`input.tiller`) and the
 *    left-console handle (`V.tiller3d`) -> `V.tillerCmd` for the NWS.
 *
 * Runs before the trims and steering. No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { AP, INPUT } from '../../../core/vars';
import { LON_VARS as V } from '../vars';

export class LongitudeCockpitInputs implements Subsystem {
  readonly name = 'lon.cockpit_inputs';
  private prevTrim = 0;

  constructor(
    private readonly vars: SimVars,
    private readonly events?: EventBus,
  ) {}

  update(): void {
    const v = this.vars;
    const l = v.get(V.yokeTrimL);
    const r = v.get(V.yokeTrimR);
    const cmd = l !== 0 ? l : r;
    v.set(V.yokeTrimCmd, cmd);
    const held = v.get(V.yokeDiscL) !== 0 || v.get(V.yokeDiscR) !== 0;
    v.set(V.discHeld, held ? 1 : 0);
    // A wheel trim actuation (rising edge) disconnects an engaged autopilot.
    if (cmd !== 0 && this.prevTrim === 0 && v.get(AP.engaged) !== 0) this.events?.emit('ap.disc');
    this.prevTrim = cmd;
    const hw = v.get(INPUT.tiller);
    const h3 = v.get(V.tiller3d);
    v.set(V.tillerCmd, Math.abs(hw) >= Math.abs(h3) ? hw : h3);
  }

  reset(): void {
    this.prevTrim = 0;
  }
}
