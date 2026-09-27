/**
 * GMA 1360 audio panel of the Cessna NAV III NXi (PG 190-02177-02 §4.1
 * Figure 4-2 / key table, §4.5 "Audio Panel Operation"):
 *
 *  - COM1 MIC / COM2 MIC select the transmitter and simultaneously select
 *    that COM's receiver; pressing both together enters Split-COM (pilot on
 *    COM1, copilot on COM2); pressing either MIC key alone leaves it.
 *  - COM1 / COM2 / AUX / NAV1 / NAV2 / DME / ADF receiver keys toggle audio.
 *  - TEL / MUS1 / MUS2 cycle OFF -> WHITE (wired) -> BLUE (Bluetooth); only
 *    one source can be BLUE, the others then cycle OFF <-> WHITE.
 *  - PILOT ICS / COPLT ICS / PASS ICS: intercom positions sharing audio.
 *  - SPKR/PA: speaker on/off; press and hold 2 s = PA mode (the COM MIC
 *    selection is dropped: "both active COM frequencies appearing in white
 *    indicate that no COM radio is selected for transmitting (PA)", §4.2).
 *  - MKR/MUTE: marker audio selected -> muted during reception (returns with
 *    the next marker) -> deselected when pressed again while muted and
 *    receiving (§4.3 "Marker Beacon Receiver"); HI SENS toggles receiver
 *    sensitivity (drives `nav.marker_hi_sens`).
 *  - PLAY: clearance recorder (2.5 min of the selected COM); each press
 *    plays the previous block; PTT stops play. SCOPE: no recorded audio
 *    exists in the sim, a press shows the PLAY annunciation for the length
 *    of one block (EST 10 s) and the recorder is cleared on power loss.
 *  - VOL/SQ small knob: volume (or ICS squelch on MAN SQ) of the source
 *    under the cursor; push cancels the cursor, then toggles Blue-Select;
 *    hold 2 s = Bluetooth discoverable for 90 s (SCOPE: no device ever pairs).
 *  - CRSR large knob: moves the volume cursor across the adjustable sources
 *    (PILOT ICS, COPLT ICS, PASS ICS, SPKR, MKR, MAN SQ, TEL, MUS1, MUS2);
 *    the cursor times out (EST 10 s) back to none.
 *  - DISPLAY BACKUP (red): latches reversionary mode (handled by System).
 *  - Power-up self test: every annunciator on for ~2 s (§4.5).
 *  - Fail-safe (unit failed / unpowered): pilot headset and mic wired to
 *    COM1 only, no speaker (§4.6 "Audio Panel Fail-safe Operation").
 *
 * Keys "not used in Cessna NAV III aircraft" (AUX MIC) keep their state so
 * the key light works as installed but have no audio source (SCOPE).
 *
 * Outputs: `g1k.gma.*` state vars, key light vars `g1k.gma.lt_<key>`
 * (0 off, 1 white, 2 blue, 0.5 = flashing phase off), marker tones through
 * AudioApi.tone('marker_outer' | 'marker_middle' | 'marker_inner').
 */
import type { SimVars } from '../../../core/SimVars';
import type { AudioApi } from '../../../core/SimContext';
import { NAV } from '../../../core/vars';
import { G1K, vn } from '../vars';

/** Every GMA 1360 key (PG Figure 4-2) as used in event / light names. */
export const GMA_KEYS = [
  'com1_mic',
  'com2_mic',
  'aux_mic',
  'com1',
  'com2',
  'aux',
  'nav1',
  'nav2',
  'dme',
  'adf',
  'tel',
  'mus1',
  'mus2',
  'pilot_ics',
  'coplt_ics',
  'pass_ics',
  'spkr',
  'mkr',
  'hi_sens',
  'man_sq',
  'play',
] as const;
export type GmaKey = (typeof GMA_KEYS)[number];

/** Receiver keys toggled on/off (0/1). */
const RX_KEYS: readonly GmaKey[] = ['com1', 'com2', 'aux', 'nav1', 'nav2', 'dme', 'adf'];
/** Entertainment sources: OFF (0) -> WHITE (1) -> BLUE (2). */
const ENT_KEYS: readonly GmaKey[] = ['tel', 'mus1', 'mus2'];
const ICS_KEYS: readonly GmaKey[] = ['pilot_ics', 'coplt_ics', 'pass_ics'];
/** Volume cursor stops (large knob order, PG §4.5 "Intercom Volume and Squelch"). */
export const GMA_CURSOR_SOURCES: readonly GmaKey[] = ['pilot_ics', 'coplt_ics', 'pass_ics', 'spkr', 'mkr', 'man_sq', 'tel', 'mus1', 'mus2'];

/** SPKR/PA hold for PA (PG: "Press and hold SPKR/PA for 2 seconds"). */
export const PA_HOLD_S = 2;
/** VOL knob push hold for Bluetooth pairing (PG §4.5 "Pairing": two seconds) and discoverable time (90 s). */
export const BT_HOLD_S = 2;
export const BT_DISCOVERABLE_S = 90;
/** Self test at power application (PG §4.5: annunciators lit ~2 s). */
export const GMA_SELF_TEST_S = 2;
/** EST: volume cursor inactivity timeout (not published; typical Garmin knob-cursor timeout). */
const CURSOR_TIMEOUT_S = 10;
/** EST: one clearance-recorder memory block plays for about 10 s (typical ATC transmission length). */
const PLAY_BLOCK_S = 10;
/** Volume change per small-knob click (EST: 5 % steps). */
const VOL_STEP = 0.05;

export class AudioPanel {
  /** Key hold timers (s), -1 = not held. */
  private spkrHeldS = -1;
  private spkrHoldDone = false;
  private volHeldS = -1;
  private volHoldDone = false;
  private cursorIdleS = 0;
  private btLeftS = 0;
  private selfTestS = 0;
  private playS = 0;
  private playBlocks = 0;
  private powered = false;
  private pttDown = false;
  /** Marker being received when MKR/MUTE muted the audio (debug / tests). */
  mkrMutedCode = 0;
  private lastMarker = 0;
  private readonly toneOn = [false, false, false];
  /** Keys pressed within the same short window (simultaneous MIC press). */
  private lastMicKey: 'com1_mic' | 'com2_mic' | '' = '';
  private lastMicT = -1;
  private t = 0;
  /** Unit healthy (powered, not failed, self-test done). */
  up = false;

  constructor(private readonly vars: SimVars, private readonly audio: AudioApi | null = null) {
    const v = vars;
    const init = (n: string, x: number): void => {
      if (!v.has(n)) v.set(n, x);
    };
    init(G1K.gmaMic, 1);
    init(G1K.gmaSplitCom, 0);
    init(vn(G1K.gmaSel, 'com1'), 1);
    init(vn(G1K.gmaSel, 'com2'), 0);
    for (const k of ['aux', 'nav1', 'nav2', 'dme', 'adf', 'tel', 'mus1', 'mus2', 'aux_mic']) init(vn(G1K.gmaSel, k), 0);
    for (const k of ICS_KEYS) init(vn(G1K.gmaIcs, k), 1);
    init(G1K.gmaSpeaker, 0);
    init(G1K.gmaPa, 0);
    init(G1K.gmaMkr, 1);
    init(vn(G1K.gmaSel, 'hi_sens'), 0);
    init(G1K.gmaManSq, 0);
    init(G1K.gmaPlay, 0);
    init(G1K.gmaCursor, -1);
    init(G1K.gmaVolSq, 0);
    init(G1K.gmaSquelch, 0.2);
    init(G1K.gmaBlueSelect, 0);
    init(G1K.gmaBluetooth, 0);
    for (const k of GMA_CURSOR_SOURCES) init(vn(G1K.gmaVolume, k), 0.7);
    init(NAV.markerHiSens, 0);
  }

  private get(k: string): number {
    return this.vars.get(vn(G1K.gmaSel, k));
  }
  private set(k: string, x: number): void {
    this.vars.set(vn(G1K.gmaSel, k), x);
  }

  /** Transmitter selection: 1 COM1, 2 COM2, 0 none (PA). */
  get mic(): number {
    return this.vars.get(G1K.gmaMic);
  }

  // ================================================================ keys

  /** Key press (event `g1k.gma.key_<key>`). */
  press(key: GmaKey | string): void {
    if (!this.up) return;
    const v = this.vars;
    // Any key other than the Blue-Select ones cancels Blue-Select mode (PG §4.5).
    if (v.get(G1K.gmaBlueSelect) >= 0.5 && !(ICS_KEYS as readonly string[]).includes(key) && !(ENT_KEYS as readonly string[]).includes(key)) v.set(G1K.gmaBlueSelect, 0);
    switch (key) {
      case 'com1_mic':
      case 'com2_mic':
        this.micKey(key);
        break;
      case 'aux_mic':
        // SCOPE: "Not used in Cessna NAV III aircraft" — no AUX transceiver; the key has no effect.
        break;
      case 'spkr':
        // Speaker toggles on press; holding 2 s selects PA instead (update()).
        this.spkrHeldS = 0;
        this.spkrHoldDone = false;
        if (v.get(G1K.gmaPa) >= 0.5) {
          // Pressing SPKR/PA while in PA leaves PA and restores COM1 transmit.
          v.set(G1K.gmaPa, 0);
          if (this.mic === 0) v.set(G1K.gmaMic, 1);
          this.spkrHoldDone = true;
        } else v.set(G1K.gmaSpeaker, v.get(G1K.gmaSpeaker) >= 0.5 ? 0 : 1);
        break;
      case 'mkr':
        this.mkrKey();
        break;
      case 'hi_sens': {
        const on = this.get('hi_sens') < 0.5;
        this.set('hi_sens', on ? 1 : 0);
        v.set(NAV.markerHiSens, on ? 1 : 0);
        break;
      }
      case 'man_sq':
        v.set(G1K.gmaManSq, v.get(G1K.gmaManSq) >= 0.5 ? 0 : 1);
        break;
      case 'play':
        this.playKey();
        break;
      case 'tel':
      case 'mus1':
      case 'mus2':
        if (v.get(G1K.gmaBlueSelect) >= 0.5) break; // Blue-Select: TEL/MUS pick the distributed source (cursor)
        this.entKey(key);
        break;
      case 'pilot_ics':
      case 'coplt_ics':
      case 'pass_ics':
        v.set(vn(G1K.gmaIcs, key), v.get(vn(G1K.gmaIcs, key)) >= 0.5 ? 0 : 1);
        break;
      default:
        if ((RX_KEYS as readonly string[]).includes(key)) this.set(key, this.get(key) >= 0.5 ? 0 : 1);
    }
  }

  /** Key release (`g1k.gma.key_<key>_up`) for the hold functions. */
  release(key: string): void {
    if (key === 'spkr') this.spkrHeldS = -1;
  }

  private micKey(key: 'com1_mic' | 'com2_mic'): void {
    const v = this.vars;
    const r = key === 'com1_mic' ? 1 : 2;
    const other = r === 1 ? 'com2_mic' : 'com1_mic';
    // "Press the COM1 MIC Key and the COM2 MIC Key simultaneously to enter Split-COM mode" (PG §4.5).
    // EST: presses within 0.3 s count as simultaneous.
    if (this.lastMicKey === other && this.t - this.lastMicT < 0.3) {
      v.set(G1K.gmaSplitCom, 1);
      this.set('com1', 1);
      this.set('com2', 1);
      v.set(G1K.gmaMic, 1);
      this.lastMicKey = '';
      return;
    }
    this.lastMicKey = key;
    this.lastMicT = this.t;
    v.set(G1K.gmaSplitCom, 0);
    v.set(G1K.gmaPa, 0);
    v.set(G1K.gmaMic, r);
    // "COMx receive is simultaneously selected when this key is pressed."
    this.set(r === 1 ? 'com1' : 'com2', 1);
  }

  private entKey(key: 'tel' | 'mus1' | 'mus2'): void {
    const cur = this.get(key);
    const blueElsewhere = ENT_KEYS.some((k) => k !== key && this.get(k) >= 1.5);
    // OFF -> WHITE -> BLUE -> OFF; only one source may be BLUE (PG NOTE), the others cycle OFF <-> WHITE.
    let next = cur < 0.5 ? 1 : cur < 1.5 && !blueElsewhere ? 2 : 0;
    if (next === 2 && blueElsewhere) next = 0;
    this.set(key, next);
  }

  private mkrKey(): void {
    const v = this.vars;
    const mode = v.get(G1K.gmaMkr);
    const receiving = this.markerCode() > 0;
    if (mode < 0.5) v.set(G1K.gmaMkr, 1);
    else if (mode < 1.5) {
      if (receiving) {
        v.set(G1K.gmaMkr, 2);
        this.mkrMutedCode = this.markerCode();
      } else v.set(G1K.gmaMkr, 0);
    } else v.set(G1K.gmaMkr, receiving ? 0 : 1);
    // PG key table (GMA 1360): MKR/MUTE also stops play of recorded COM audio.
    if (v.get(G1K.gmaPlay) >= 0.5) this.stopPlay();
  }

  private playKey(): void {
    const v = this.vars;
    if (v.get(G1K.gmaPlay) >= 0.5) {
      // Each subsequent press plays the previous block.
      this.playBlocks++;
      this.playS = PLAY_BLOCK_S;
      return;
    }
    v.set(G1K.gmaPlay, 1);
    this.playBlocks = 1;
    this.playS = PLAY_BLOCK_S;
  }

  private stopPlay(): void {
    this.vars.set(G1K.gmaPlay, 0);
    this.playS = 0;
    this.playBlocks = 0;
  }

  /** PTT (pilot's yoke switch): TX indication, stops playback, mutes the speaker. */
  ptt(pressed: boolean): void {
    this.pttDown = pressed;
    if (pressed && this.vars.get(G1K.gmaPlay) >= 0.5) this.stopPlay();
  }

  /** True while the pilot's PTT is keyed. */
  get transmitting(): boolean {
    return this.pttDown;
  }

  // ================================================================ knobs

  /** Large knob: moves the volume cursor (first click activates it on PILOT ICS). */
  crsr(clicks: number): void {
    if (!this.up) return;
    const v = this.vars;
    const n = GMA_CURSOR_SOURCES.length;
    const cur = v.get(G1K.gmaCursor);
    const next = cur < 0 ? 0 : (((cur + clicks) % n) + n) % n;
    v.set(G1K.gmaCursor, next);
    this.cursorIdleS = 0;
  }

  /** Small knob: volume (or ICS squelch with MAN SQ under the cursor) of the cursor source; default PILOT ICS. */
  vol(clicks: number): void {
    if (!this.up) return;
    const v = this.vars;
    let cur = v.get(G1K.gmaCursor);
    if (cur < 0) {
      cur = 0;
      v.set(G1K.gmaCursor, 0);
    }
    this.cursorIdleS = 0;
    const src = GMA_CURSOR_SOURCES[cur | 0];
    if (src === 'man_sq') {
      v.set(G1K.gmaSquelch, clamp01(v.get(G1K.gmaSquelch) + clicks * VOL_STEP));
      v.set(G1K.gmaVolSq, 1);
    } else {
      const name = vn(G1K.gmaVolume, src);
      v.set(name, clamp01(v.get(name, 0.7) + clicks * VOL_STEP));
      v.set(G1K.gmaVolSq, 0);
    }
  }

  /** Small knob push: cancels the cursor, otherwise toggles Blue-Select; holding 2 s = Bluetooth discoverable. */
  volPush(): void {
    if (!this.up) return;
    const v = this.vars;
    this.volHeldS = 0;
    this.volHoldDone = false;
    if (v.get(G1K.gmaCursor) >= 0) v.set(G1K.gmaCursor, -1);
    else v.set(G1K.gmaBlueSelect, v.get(G1K.gmaBlueSelect) >= 0.5 ? 0 : 1);
  }

  volPushUp(): void {
    this.volHeldS = -1;
  }

  // ================================================================ update

  /** Marker currently received: 1 outer, 2 middle, 3 inner, 0 none. */
  private markerCode(): number {
    const v = this.vars;
    if (v.get(NAV.markerInner) >= 0.5) return 3;
    if (v.get(NAV.markerMiddle) >= 0.5) return 2;
    if (v.get(NAV.markerOuter) >= 0.5) return 1;
    return 0;
  }

  update(dt: number, powered: boolean, failed: boolean): void {
    const v = this.vars;
    this.t += dt;
    const p = powered && !failed;
    if (p && !this.powered) {
      this.selfTestS = GMA_SELF_TEST_S;
      // "Powering off the unit automatically clears all recorded blocks."
      this.stopPlay();
    }
    this.powered = p;
    if (this.selfTestS > 0) this.selfTestS = Math.max(0, this.selfTestS - dt);
    this.up = p && this.selfTestS <= 0;
    v.set(G1K.gmaSelfTest, p && this.selfTestS > 0 ? 1 : 0);

    // Hold functions.
    if (this.spkrHeldS >= 0) {
      this.spkrHeldS += dt;
      if (!this.spkrHoldDone && this.spkrHeldS >= PA_HOLD_S) {
        this.spkrHoldDone = true;
        // The press already toggled the speaker; the hold selects PA instead and restores the speaker.
        v.set(G1K.gmaSpeaker, v.get(G1K.gmaSpeaker) >= 0.5 ? 0 : 1);
        v.set(G1K.gmaPa, 1);
        v.set(G1K.gmaMic, 0);
        v.set(G1K.gmaSplitCom, 0);
      }
    }
    if (this.volHeldS >= 0) {
      this.volHeldS += dt;
      if (!this.volHoldDone && this.volHeldS >= BT_HOLD_S) {
        this.volHoldDone = true;
        this.btLeftS = BT_DISCOVERABLE_S;
        v.set(G1K.gmaBluetooth, 1);
        this.audio?.callout('Bluetooth discoverable', 1);
      }
    }
    if (this.btLeftS > 0) {
      this.btLeftS -= dt;
      // SCOPE: no Bluetooth device exists in the sim; discoverability simply times out after 90 s.
      if (this.btLeftS <= 0) v.set(G1K.gmaBluetooth, 0);
    }
    if (v.get(G1K.gmaCursor) >= 0) {
      this.cursorIdleS += dt;
      if (this.cursorIdleS >= CURSOR_TIMEOUT_S) v.set(G1K.gmaCursor, -1);
    }
    if (this.playS > 0) {
      this.playS -= dt;
      if (this.playS <= 0) {
        this.playBlocks--;
        if (this.playBlocks > 0) this.playS = PLAY_BLOCK_S;
        else this.stopPlay();
      }
    }

    // COM TX/RX indications (TX while PTT keyed on the MIC-selected COM; RX when selected and receiving).
    const mic = this.up ? this.mic : 1; // fail-safe: pilot mic straight to COM1
    const split = this.up && v.get(G1K.gmaSplitCom) >= 0.5;
    for (let r = 1; r <= 2; r++) {
      const tx = this.pttDown && (mic === r || (split && r === 1));
      v.set(vn(G1K.comTx, r), tx ? 1 : 0);
    }

    // Marker audio: On / Muted (until the next marker) / Deselected; fail-safe: no marker audio.
    const code = this.markerCode();
    const mode = v.get(G1K.gmaMkr);
    if (code !== this.lastMarker) {
      // The mute holds only for the marker being received when MKR/MUTE was pressed: "the audio returns
      // when the next marker beacon signal is received".
      if (mode >= 1.5 && code !== 0) {
        v.set(G1K.gmaMkr, 1);
        this.mkrMutedCode = 0;
      }
      this.lastMarker = code;
    }
    const audible = this.up && v.get(G1K.gmaMkr) >= 0.5 && v.get(G1K.gmaMkr) < 1.5;
    this.tone(0, 'marker_outer', audible && code === 1);
    this.tone(1, 'marker_middle', audible && code === 2);
    this.tone(2, 'marker_inner', audible && code === 3);

    this.publishLights();
  }

  private tone(i: number, id: string, on: boolean): void {
    if (this.toneOn[i] === on) return;
    this.toneOn[i] = on;
    this.audio?.tone(id, on);
  }

  private lightTest = false;
  private lightFlash = false;

  private L(k: string, x: number): void {
    this.vars.set(vn(G1K.gmaLight, k), !this.powered ? 0 : this.lightTest ? 1 : x);
  }

  /** MIC annunciation (flashes while the PTT is active). */
  private micLit(r: number, mic: number, split: boolean): number {
    return (mic === r || split) && this.up ? (this.pttDown && this.lightFlash ? 0.5 : 1) : 0;
  }

  /** Key annunciator lights (0 off, 1 white, 2 blue; flashing keys alternate at 2 Hz). */
  private publishLights(): void {
    const v = this.vars;
    const test = v.get(G1K.gmaSelfTest) >= 0.5;
    const flash = Math.floor(this.t * 4) % 2 === 0;
    this.lightTest = test;
    this.lightFlash = flash;
    const mic = this.mic;
    const split = v.get(G1K.gmaSplitCom) >= 0.5;
    this.L('com1_mic', this.micLit(1, mic, split));
    this.L('com2_mic', this.micLit(2, mic, split));
    this.L('aux_mic', 0);
    for (let i = 0; i < RX_KEYS.length; i++) this.L(RX_KEYS[i], this.get(RX_KEYS[i]) >= 0.5 ? 1 : 0);
    const bs = v.get(G1K.gmaBlueSelect) >= 0.5;
    for (let i = 0; i < ENT_KEYS.length; i++) {
      const k = ENT_KEYS[i];
      const s = this.get(k);
      this.L(k, bs && k === 'tel' ? (flash ? 2 : 0.5) : s >= 1.5 ? 2 : s >= 0.5 ? 1 : 0);
    }
    for (let i = 0; i < ICS_KEYS.length; i++) this.L(ICS_KEYS[i], v.get(vn(G1K.gmaIcs, ICS_KEYS[i])) >= 0.5 ? (bs ? 2 : 1) : 0);
    this.L('spkr', v.get(G1K.gmaSpeaker) >= 0.5 ? 1 : 0);
    this.L('pa', v.get(G1K.gmaPa) >= 0.5 ? (this.pttDown && flash ? 0.5 : 1) : 0);
    this.L('mkr', v.get(G1K.gmaMkr) >= 0.5 ? 1 : 0);
    this.L('hi_sens', this.get('hi_sens') >= 0.5 ? 1 : 0);
    this.L('man_sq', v.get(G1K.gmaManSq) >= 0.5 ? 1 : 0);
    this.L('play', v.get(G1K.gmaPlay) >= 0.5 ? 1 : 0);
    const bt = v.get(G1K.gmaBluetooth);
    this.L('bt', bt >= 1.5 ? 2 : bt >= 0.5 ? (flash ? 2 : 0) : 0);
    // Volume cursor: the source under the cursor flashes.
    const c = v.get(G1K.gmaCursor);
    if (c >= 0 && !test && this.powered) {
      const k = GMA_CURSOR_SOURCES[c | 0];
      const base = v.get(vn(G1K.gmaLight, k));
      v.set(vn(G1K.gmaLight, k), flash ? Math.max(1, base) : 0.5);
    }
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
