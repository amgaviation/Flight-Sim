/**
 * Global 6000 AURAL WARNING TEST 1 / 2 (EMS CDU TEST CONTROL page).
 *
 * Source: Global 5000 FCOM CSP 700-5000-6 Vol. 2, Rev 2A (Apr 2005), 03-10-16
 * "Aural Warning Test": "an AURAL WARN TEST can be initiated via the EMS CDU
 * located on the pilot's and copilot's side panel. There are two warning test
 * selections provided to test Integrated Avionics Computer (IAC 1 and IAC 2).
 * TEST is initiated by pressing activation key and can be terminated by
 * pressing activation key again. The test sequences through each tone and/or
 * voice message in the following priority order" (list below, verbatim order).
 * 03-10-17 "Aural Warning Panel": the IAC 1 / IAC 2 PUSH TO MUTE switches
 * "disable respective tone/aural generator located in the respective IACs".
 *
 * Model: test n plays the sequence on IAC n's generator. It runs while IAC n is
 * powered (`elec.iac<n>_powered`, the EMS IAC breaker) and its generator is not
 * muted (`V.auralMute(n)`); muting or unpowering the IAC silences the rest of
 * the sequence (the test stays selected until it ends or is terminated).
 * `ac.g6k.ck.ems.aural_test<n>` = 1 while running (EMS TEST page state).
 *
 * EST: step durations (the FCOM gives the order, not the timing): ~2 s per
 * voice, 1.5–2.5 s per tone. SCOPE: the audio engine's generic tones stand in
 * for the Bombardier sounds (triple chime = `chime.triple`, single chime =
 * `master_caution`, cavalry charge = `ap_disconnect`, C-chord = `alt_alert`,
 * trim clacker = `trim.wheel` clicks).
 */
import type { SimVars } from '../../../../core/SimVars';
import type { AudioApi } from '../../../../core/SimContext';
import { G6K_VARS as V } from '../../vars';

type Step =
  | { k: 'voice'; text: string; dur: number }
  | { k: 'play'; id: string; dur: number; repeat?: number; gap?: number }
  | { k: 'tone'; id: string; dur: number; voice?: string };

/** FCOM 03-10-16 priority order. `n` is replaced by the IAC number in the first step. */
const SEQUENCE: readonly Step[] = [
  { k: 'voice', text: 'AURAL WARNING TEST', dur: 2.5 },
  { k: 'tone', id: 'stick_shaker', voice: 'STALL', dur: 2 }, // "STALL" (stall shaker active)
  { k: 'tone', id: 'overspeed', dur: 2 }, // continuous tone (overspeed)
  { k: 'play', id: 'chime.triple', dur: 1.5 }, // triple chime (any warning)
  { k: 'voice', text: 'NO TAKEOFF', dur: 1.8 },
  { k: 'voice', text: 'LEFT ENGINE FIRE', dur: 2 },
  { k: 'voice', text: 'RIGHT ENGINE FIRE', dur: 2 },
  { k: 'voice', text: 'APU FIRE', dur: 1.8 },
  { k: 'voice', text: 'SMOKE', dur: 1.5 },
  { k: 'voice', text: 'CABIN ALTITUDE', dur: 2 },
  { k: 'voice', text: 'GEAR BAY OVERHEAT', dur: 2 },
  { k: 'voice', text: 'LEFT REVERSER UNLOCKED', dur: 2.2 },
  { k: 'voice', text: 'RIGHT REVERSER UNLOCKED', dur: 2.2 },
  { k: 'voice', text: 'NORMAL BRAKE FAIL', dur: 2 },
  { k: 'play', id: 'master_caution', dur: 1.2 }, // single chime (any caution)
  { k: 'voice', text: 'GEAR', dur: 1.2 },
  { k: 'tone', id: 'ap_disconnect', dur: 1.8 }, // single cavalry charge (autopilot disengage)
  { k: 'voice', text: 'AUTOTHROTTLE', dur: 1.8 },
  { k: 'voice', text: 'ALTITUDE', dur: 1.5 }, // altitude alert - departure
  { k: 'play', id: 'alt_alert', dur: 1.5 }, // C-chord (altitude alert - capture)
  { k: 'play', id: 'alt_alert', dur: 2.2, repeat: 2, gap: 0.8 }, // double C-chord (vertical track alert)
  { k: 'play', id: 'chime', dur: 1.2 }, // single chime
  { k: 'play', id: 'trim.wheel', dur: 1.5, repeat: 5, gap: 0.25 }, // trim clacker (trim in motion)
  { k: 'voice', text: 'MINIMUMS, MINIMUMS', dur: 2.2 }, // DH and MDA
  { k: 'voice', text: 'SELCAL, SELCAL', dur: 2 },
];

/** Total sequence length (s). */
export const AURAL_TEST_S = SEQUENCE.reduce((s, x) => s + x.dur, 0);

/** Callout priority of the test voices (below every real warning, doc app.md 5.1). */
const PRIO = 2;

export const AURAL_TEST_VAR = (n: 1 | 2) => `ac.g6k.ck.ems.aural_test${n}`;

/** One IAC's test sequencer (no allocation per tick). */
class IacTest {
  running = false;
  private step = -1;
  private t = 0;
  private reps = 0;
  private toneOn: string | null = null;
  private readonly first: string;
  private readonly pwrVar: string;
  private readonly runVar: string;

  constructor(
    readonly n: 1 | 2,
    private readonly vars: SimVars,
    private readonly audio: AudioApi | null,
  ) {
    this.first = `AURAL WARNING TEST ${n}`;
    this.pwrVar = `elec.iac${n}_powered`;
    this.runVar = AURAL_TEST_VAR(n);
  }

  /** Generator live: IAC powered and not muted. */
  private live(): boolean {
    return this.vars.get(this.pwrVar) !== 0 && this.vars.get(V.auralMute(this.n)) === 0;
  }

  start(): void {
    this.running = true;
    this.step = -1;
    this.t = 0;
    this.vars.set(this.runVar, 1);
    this.next();
  }

  stop(): void {
    this.toneOff();
    this.running = false;
    this.step = -1;
    this.vars.set(this.runVar, 0);
  }

  private toneOff(): void {
    if (this.toneOn) this.audio?.tone(this.toneOn, false);
    this.toneOn = null;
  }

  private next(): void {
    this.toneOff();
    this.step++;
    if (this.step >= SEQUENCE.length) {
      this.stop();
      return;
    }
    const s = SEQUENCE[this.step];
    this.t = 0;
    this.reps = 0;
    if (!this.live()) return;
    if (s.k === 'voice') this.audio?.callout(this.step === 0 ? this.first : s.text, PRIO);
    else if (s.k === 'play') {
      this.audio?.play(s.id);
      this.reps = 1;
    } else {
      if (s.voice) this.audio?.callout(s.voice, PRIO);
      this.audio?.tone(s.id, true);
      this.toneOn = s.id;
    }
  }

  tick(dt: number): void {
    if (!this.running) return;
    const s = SEQUENCE[this.step];
    this.t += dt;
    // Mute / power loss cuts the generator immediately.
    if (this.toneOn && !this.live()) this.toneOff();
    if (s.k === 'play' && s.repeat && this.reps < s.repeat && this.t >= this.reps * (s.gap ?? 0.5)) {
      if (this.live()) this.audio?.play(s.id);
      this.reps++;
    }
    if (this.t >= s.dur) this.next();
  }
}

/** AURAL WARNING TEST 1 / 2 of both EMS CDUs (shared, like the other EMS tests). */
export class G6kAuralTest {
  private readonly iac: [IacTest, IacTest];

  constructor(vars: SimVars, audio: AudioApi | null) {
    this.iac = [new IacTest(1, vars, audio), new IacTest(2, vars, audio)];
    vars.set(AURAL_TEST_VAR(1), 0);
    vars.set(AURAL_TEST_VAR(2), 0);
  }

  running(n: 1 | 2): boolean {
    return this.iac[n - 1].running;
  }

  /** Activation key: start, or terminate a running test (FCOM 03-10-16 NOTE). */
  toggle(n: 1 | 2): void {
    const t = this.iac[n - 1];
    if (t.running) t.stop();
    else t.start();
  }

  tick(dt: number): void {
    this.iac[0].tick(dt);
    this.iac[1].tick(dt);
  }

  dispose(): void {
    this.iac[0].stop();
    this.iac[1].stop();
  }
}
