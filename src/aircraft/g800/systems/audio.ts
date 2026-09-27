/**
 * G800 audio / transmit keying (dossier §9.3; check-airman pass). On the Symmetry flight deck the audio
 * control functions (MIC select, receiver volumes) are an app on the touch-screen controllers
 * (BJT500: no hardware audio panels). The sidestick front trigger is the push-to-talk.
 *
 * Inputs:  ac.g800.ptt{s}      sidestick PTT trigger, momentary (1 = MIC keyed)
 *          ac.g800.mic_sel{s}  selected transmitter: 1 VHF 1, 2 VHF 2, 3 VHF 3, 4 HF 1, 5 HF 2, 6 PA
 *                              (defaults pilot VHF 1, copilot VHF 2).
 *          elec.radio1_powered / elec.radio2_powered (audio + NAV/COM on the L / R ESS DC buses).
 * Outputs: ac.g800.mic_keyed{s} transmitter number keyed by that side (0 = not transmitting)
 *          ac.g800.com{r}_tx    VHF r transmitting (1..3)
 *          ac.g800.stuck_mic    1 when a transmitter has been keyed continuously past the timeout
 *                               (CAS advisory "Stuck Mic"; the radio stops transmitting).
 * SCOPE: the TSC audio app is not in the Epic suite, so MIC select is the var above (no touch UI);
 * no radio / intercom sound is synthesised; the HF radios and the PA are state only.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import { G800_VARS as V } from '../vars';

/** EST: VHF transceiver stuck-microphone timeout (typical avionics VHF radios cut transmit after 30-120 s; 35 s chosen). */
export const STUCK_MIC_S = 35;

const SIDES = [1, 2] as const;

export class G800Audio implements Subsystem {
  readonly name = 'g800.audio';
  private readonly keyedS = [0, 0];

  constructor(private readonly v: SimVars) {
    if (!v.has(V.micSel(1))) v.set(V.micSel(1), 1);
    if (!v.has(V.micSel(2))) v.set(V.micSel(2), 2);
  }

  reset(): void {
    this.keyedS[0] = 0;
    this.keyedS[1] = 0;
  }

  update(dt: number): void {
    const v = this.v;
    let tx1 = 0;
    let tx2 = 0;
    let tx3 = 0;
    let stuck = 0;
    for (let i = 0; i < 2; i++) {
      const s = SIDES[i];
      // Each side's audio is on its own ESS DC radio load; with one side dead the other side's audio still works.
      const pwr = v.get(s === 1 ? 'elec.radio1_powered' : 'elec.radio2_powered') !== 0;
      const ptt = v.get(V.ptt(s)) > 0.5;
      const sel = Math.round(v.get(V.micSel(s)));
      this.keyedS[i] = ptt && pwr ? this.keyedS[i] + dt : 0;
      const timedOut = this.keyedS[i] > STUCK_MIC_S;
      if (timedOut) stuck = 1;
      const keyed = ptt && pwr && !timedOut && sel >= 1 && sel <= 6 ? sel : 0;
      v.set(V.micKeyed(s), keyed);
      if (keyed === 1) tx1 = 1;
      else if (keyed === 2) tx2 = 1;
      else if (keyed === 3) tx3 = 1;
    }
    v.set(V.comTx(1), tx1);
    v.set(V.comTx(2), tx2);
    v.set(V.comTx(3), tx3);
    v.set(V.stuckMic, stuck);
  }
}
