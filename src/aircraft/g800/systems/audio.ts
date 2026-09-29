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
 *          ac.g800.hf{1,2}_tx   HF transmitting (drives the HF load current)
 *          ac.g800.pa_tx        PA keyed (drives the PA amplifier load current; fix round 1 F07)
 *          ac.g800.rx{r}_level{s} headset level of receiver r on side s (TSC AUDIO app on x volume x receiver power)
 * Function fix round 1: MIC select and the receivers are set on the TSC AUDIO application (systems/tscApps.ts);
 * each transmitter needs its own power (VHF 1 / 2: elec.radio1/2, VHF 3: elec.com3, HF 1 / 2: elec.hf1/2, PA: elec.pa)
 * and the keying side's audio (elec.radio1 / radio2).
 * SCOPE: no radio / intercom sound is synthesised (the receiver levels are state); the HF radios and the PA carry no
 * traffic. The stuck-mic timeout and its CAS text remain EST (no public Honeywell / Gulfstream figure).
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import { G800_VARS as V, AUDIO_RX } from '../vars';

/** EST: VHF transceiver stuck-microphone timeout (typical avionics VHF radios cut transmit after 30-120 s; 35 s chosen). */
export const STUCK_MIC_S = 35;

const SIDES = [1, 2] as const;
/** Power of each transmitter by MIC select value (index 1..6). */
const TX_POWER = ['', 'elec.radio1_powered', 'elec.radio2_powered', 'elec.com3_powered', 'elec.hf1_powered', 'elec.hf2_powered', 'elec.pa_powered'];
/** Power of each AUDIO_RX receiver. */
const RX_POWER = ['elec.radio1_powered', 'elec.radio2_powered', 'elec.com3_powered', 'elec.hf1_powered', 'elec.hf2_powered', 'elec.radio1_powered', 'elec.radio2_powered', 'elec.radio1_powered', 'elec.radio1_powered'];
/** EST default receiver volume. */
export const RX_DEFAULT_VOL = 0.7;

export class G800Audio implements Subsystem {
  readonly name = 'g800.audio';
  private readonly keyedS = [0, 0];
  private readonly rxOn: string[][] = [[], []];
  private readonly rxVol: string[][] = [[], []];
  private readonly rxLevel: string[][] = [[], []];

  constructor(private readonly v: SimVars) {
    for (let i = 0; i < 2; i++) {
      const s = SIDES[i];
      if (!v.has(V.micSel(s))) v.set(V.micSel(s), s);
      for (let r = 0; r < AUDIO_RX.length; r++) {
        this.rxOn[i].push(V.rxOn(s, r));
        this.rxVol[i].push(V.rxVol(s, r));
        this.rxLevel[i].push(V.rxLevel(s, r));
        // Defaults: each side monitors its own VHF (pilot VHF 1, copilot VHF 2).
        if (!v.has(V.rxOn(s, r))) v.set(V.rxOn(s, r), r === i ? 1 : 0);
        if (!v.has(V.rxVol(s, r))) v.set(V.rxVol(s, r), RX_DEFAULT_VOL);
      }
    }
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
    let hf1 = 0;
    let hf2 = 0;
    let pa = 0;
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
      const txOk = sel >= 1 && sel <= 6 && v.get(TX_POWER[sel]) !== 0;
      const keyed = ptt && pwr && !timedOut && txOk ? sel : 0;
      v.set(V.micKeyed(s), keyed);
      if (keyed === 1) tx1 = 1;
      else if (keyed === 2) tx2 = 1;
      else if (keyed === 3) tx3 = 1;
      else if (keyed === 4) hf1 = 1;
      else if (keyed === 5) hf2 = 1;
      else if (keyed === 6) pa = 1;
      // Receiver levels at this side's headset.
      for (let r = 0; r < RX_POWER.length; r++) {
        const lvl = pwr && v.get(RX_POWER[r]) !== 0 && v.get(this.rxOn[i][r]) !== 0 ? Math.max(0, Math.min(1, v.get(this.rxVol[i][r]))) : 0;
        v.set(this.rxLevel[i][r], lvl);
      }
    }
    v.set(V.comTx(1), tx1);
    v.set(V.comTx(2), tx2);
    v.set(V.comTx(3), tx3);
    v.set('ac.g800.hf1_tx', hf1);
    v.set('ac.g800.hf2_tx', hf2);
    v.set(V.paTx, pa); // PA keyed: the cabin PA amplifier draws its keyed current (electrical.ts 'pa'; fix F07)
    v.set(V.stuckMic, stuck);
  }
}
