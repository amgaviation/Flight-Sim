/**
 * Control-wheel and tiller inputs of the 3D cockpit (added with the cockpit
 * build). The app's input module rewrites `input.pitch_trim_rate`,
 * `input.ap_disc` and `input.tiller` every frame from the keyboard and the
 * hardware, so the cockpit's control-wheel switches and tiller handle write
 * their own vars (vars.ts `yokeTrim`, `yokeDisc`, `tiller3d`) and this block
 * merges them for the systems:
 *
 *  - Pitch trim switches (one split switch per control wheel, GXFC): pilot
 *    priority over the copilot (EST: Bombardier trim priority logic, the
 *    pilot's switch overrides) -> `V.yokeTrimCmd`, read by the stabilizer
 *    TrimAxis alongside `input.pitch_trim_rate`. Operating a wheel trim
 *    switch disconnects an engaged autopilot (GXAF: "the autopilot is
 *    disengaged by ... operation of the pitch trim switches").
 *  - AP/SP DISC (MASTER DISC) buttons (GXAF / GXFC): pressing disconnects
 *    the AP (event `ap.disc`, emitted by the button itself); while held the
 *    stabilizer trim and the stick pusher are interrupted (`V.discHeld`,
 *    read by the TrimAxis `enable` binding and the pusher enable in
 *    logic.ts).
 *  - NOSE STEER handwheel: the larger of the hardware axis (`input.tiller`)
 *    and the 3D handwheel (`V.tiller3d`) -> `V.tillerCmd` for the NWS.
 *
 * Runs before the trims and steering. No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { AP, INPUT } from '../../../core/vars';
import { G6K_VARS as V } from '../vars';

const TRIM1 = V.yokeTrim(1);
const TRIM2 = V.yokeTrim(2);
const DISC1 = V.yokeDisc(1);
const DISC2 = V.yokeDisc(2);

export class G6kCockpitInputs implements Subsystem {
  readonly name = 'g6k.cockpit_inputs';
  private prevTrim = 0;

  constructor(
    private readonly vars: SimVars,
    private readonly events?: EventBus | null,
  ) {}

  update(): void {
    const v = this.vars;
    const l = v.get(TRIM1);
    const r = v.get(TRIM2);
    const cmd = l !== 0 ? l : r;
    v.set(V.yokeTrimCmd, cmd);
    v.set(V.discHeld, v.get(DISC1) !== 0 || v.get(DISC2) !== 0 ? 1 : 0);
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
