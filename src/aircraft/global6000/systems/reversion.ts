/**
 * Global 6000 (Global Vision) pedestal reversion panel logic (photo EB190582
 * crops e_ped_l / e_ped_aft: L PFD [ADC] [IRS], AFCS [1/2], R PFD [ADC] [IRS]
 * switchlights, DISPLAYS NORM / REV and TUNE rotaries, L / CTR / R / LWR DSPL
 * dimmers). The ADC / IRS / AFCS switchlights write the Collins Fusion RSP
 * vars directly (FUSION_VARS.rspAdc / rspAtt / rspAfcs, consumed by the
 * suite's source selection, PFD source annunciations and the AFCS channel);
 * this block adds:
 *
 *  - DISPLAYS NORM / REV: REV sets both sides' display reversion (the Fusion
 *    layout shows the PFD + EICAS composite on each outboard AFD), NORM
 *    restores the normal format (FUSION_VARS.rspDspl(1 / 2)).
 *  - TUNE NORM / VHF / DSPL: radio-tuning reversion source `V.tuneSrc`.
 *    SCOPE: the Fusion suite always tunes through the CTP / MKP windows; the
 *    selected tuning source is state only (shown by the knob), as the
 *    reversionary tuning path is not modelled.
 *  - AFCS 1/2 is written as 1 / 2 by the alternate-action switchlight; an
 *    unset var reads as FGC 1.
 *
 * Runs before the Fusion suite. No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import { G6K_VARS as V } from '../vars';

const DSPL = [V.rspDspl(1), V.rspDspl(2)];
const ADC = [V.rspAdc(1), V.rspAdc(2)];
const ATT = [V.rspAtt(1), V.rspAtt(2)];

export class G6kReversion implements Subsystem {
  readonly name = 'g6k.reversion';
  private prevDisplays = NaN;

  constructor(private readonly v: SimVars) {}

  update(): void {
    const v = this.v;
    // DISPLAYS rotary: write the RSP display reversion only when the knob moves (the Fusion suite's own state logic may
    // also set the vars, e.g. on a display failure).
    const d = v.get(V.displaysRev) >= 0.5 ? 1 : 0;
    if (d !== this.prevDisplays) {
      for (let i = 0; i < 2; i++) v.set(DSPL[i], d);
      this.prevDisplays = d;
    }
    // Keep the switchlight vars within their contract (0 NORM / 1 reverted).
    for (let i = 0; i < 2; i++) {
      if (v.get(ADC[i]) > 1) v.set(ADC[i], 1);
      if (v.get(ATT[i]) > 1) v.set(ATT[i], 1);
    }
    const afcs = v.get(V.rspAfcs, 1);
    if (afcs !== 1 && afcs !== 2) v.set(V.rspAfcs, 1);
    // TUNE: 0 NORM (CTP) / 1 VHF / 2 DSPL.
    v.set(V.tuneSrc, Math.max(0, Math.min(2, Math.round(v.get(V.tuneSel)))));
  }

  reset(): void {
    this.prevDisplays = NaN;
  }
}
