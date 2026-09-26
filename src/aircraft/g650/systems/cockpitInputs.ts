/**
 * Yoke and tiller inputs of the 3D G650 flight deck (added with the cockpit
 * build, src/aircraft/g650/cockpit). The app's input module rewrites
 * `input.pitch_trim_rate`, `input.ap_disc` and `input.tiller` every frame
 * from the keyboard / hardware, so the cockpit's yoke switches and the tiller
 * handle write their own vars and this block merges them for the systems:
 *
 *  - Pitch trim: split trim switch on the outboard horn of each yoke (LUC
 *    flight controls, HSTS: "pitch trim is controlled by the split-trim switch
 *    on either control wheel or the BACKUP PITCH trim switch"). Pilot priority
 *    over the copilot (EST, usual dual-control practice) -> `V.yokeTrimCmd`,
 *    read by the FBW as a trim switch (createSystems `trimSwitchVars`): in the
 *    air it moves the FBW reference speed, on the ground the stabilizer.
 *    With the autopilot engaged a trim actuation disconnects it (Primus Epic
 *    preset `trimDisconnects`, applied here because the preset only watches
 *    `input.pitch_trim_rate`).
 *  - AP / TRIM DISC: the buttons emit `ap.disc` themselves (AFCS listener);
 *    while one is held the yoke trim switches are interrupted (`V.discHeld`,
 *    EST: Gulfstream AP/TRIM DISC function).
 *  - Tiller: the larger deflection of the hardware axis (`input.tiller`) and
 *    the side-console handle (`V.tiller3d`) -> `V.tillerCmd` for the NWS.
 *
 * Runs before the FBW and the steering. No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { AP, INPUT } from '../../../core/vars';
import { G650_VARS as V } from '../vars';

export class G650CockpitInputs implements Subsystem {
  readonly name = 'g650.cockpit_inputs';
  private prevTrim = 0;

  constructor(
    private readonly vars: SimVars,
    private readonly events?: EventBus,
  ) {}

  update(): void {
    const v = this.vars;
    const held = v.get(V.yokeDiscL) !== 0 || v.get(V.yokeDiscR) !== 0;
    v.set(V.discHeld, held ? 1 : 0);
    const l = v.get(V.yokeTrimL);
    const r = v.get(V.yokeTrimR);
    const cmd = held ? 0 : l !== 0 ? l : r;
    v.set(V.yokeTrimCmd, cmd);
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
