/**
 * Navigation receiver identification audio of the NAV II stack: the Morse ident of the VOR / localizer
 * received on NAV 1 / NAV 2 (KX 155A) and of the NDB received on the KR 87, heard through the KMA 28.
 *
 * Sources: Supplement 1 (KX 155A) item 8 "NAV volume control ... PULL IDENT" (pulled: the ident is heard;
 * pushed: the ident filter removes it and only voice is heard); Supplement 6 (KR 87) item 7 ON/OFF/VOL and
 * item 11 BFO; Supplement 20 (KMA 28) item 3: NAV 1 / NAV 2 / ADF receiver audio select buttons, and the
 * unit off (EMG) disconnects all receiver audio except COM 1. The ident check before using a navaid is a
 * required step (AIM 1-1-3 / 1-1-8).
 *
 * Keying: International Morse (nav/radios/morse.ts pattern from the receivers' `ident_morse`) of the
 * station's 1020 Hz ident tone at EST 7 words per minute (dot 0.17 s; AIM: VOR idents at about 7 wpm),
 * repeated every EST 10 s for VOR / LOC and 8 s for NDBs (AIM 1-1-3: at least three times per 30 s; NDBs
 * identify continuously). Gain = receiver volume knob x signal received; the KR 87 ident is heard in ADF and
 * ANT mode, the BFO (A1 carrier) adds nothing modelled beyond the keyed tone (SCOPE).
 *
 * Outputs (for tests / debugging): ac.c172s.ident_nav1 / _nav2 / _adf = the instantaneous audible gain.
 * SCOPE: voice (ATIS on VORs), noise and the COM receivers are not synthesised.
 */
import type { Subsystem } from '../../types';
import type { AudioApi, SimContext } from '../../../core/SimContext';
import { NAV } from '../../../core/vars';
import { KMA, KR, KX } from '../vars';

/** Morse dot length (s): 7 wpm with the PARIS standard (1.2 s / wpm). EST from AIM "about 7 wpm". */
export const IDENT_DOT_S = 1.2 / 7;
/** Repeat periods (s), EST (see the header). */
export const IDENT_PERIOD_S = { vor: 10, ndb: 8 } as const;
/** Headset level of the ident at full receiver volume (EST mix level). */
const IDENT_GAIN = 0.25;

type Loop = ReturnType<AudioApi['loop']>;

/** True while the key is down at time `t` (s) into a Morse `pattern` ('.', '-', ' ' between letters). */
export function morseKeyDown(pattern: string, t: number, dot = IDENT_DOT_S): boolean {
  let at = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charCodeAt(i);
    if (c === 32) {
      at += 2 * dot; // letter gap: 3 units in total with the element gap already counted
      continue;
    }
    const on = c === 45 ? 3 * dot : dot; // '-' = 3 units, '.' = 1 unit
    if (t >= at && t < at + on) return true;
    at += on + dot;
    if (t < at) return false;
  }
  return false;
}

interface Channel {
  out: string;
  morse: string;
  period: number;
  t: number;
  loop: Loop | null;
  gain: number;
}

export class ReceiverIdentAudio implements Subsystem {
  readonly name = 'receiver-ident-audio';
  private readonly ch: Channel[];
  private loopsTried = false;

  constructor(
    private readonly vars: SimContext['vars'],
    private readonly audio: AudioApi | undefined,
  ) {
    this.ch = [
      { out: 'ac.c172s.ident_nav1', morse: NAV.morse(1), period: IDENT_PERIOD_S.vor, t: 0, loop: null, gain: 0 },
      { out: 'ac.c172s.ident_nav2', morse: NAV.morse(2), period: IDENT_PERIOD_S.vor, t: 0, loop: null, gain: 0 },
      { out: 'ac.c172s.ident_adf', morse: NAV.adfMorse(1), period: IDENT_PERIOD_S.ndb, t: 0, loop: null, gain: 0 },
    ];
  }

  update(dt: number): void {
    const v = this.vars;
    if (!this.loopsTried && this.audio) {
      this.loopsTried = true;
      for (const c of this.ch) {
        try {
          c.loop = this.audio.loop('ident.1020');
        } catch {
          c.loop = null;
        }
      }
    }
    const kma = v.get(KMA.on) > 0.5;
    // Per-channel audible level (before keying).
    const lvl0 = kma && v.get(KMA.sel('nav1')) > 0.5 && v.get(NAV.received(1)) > 0.5 && v.get(KX(1).navIdent) > 0.5 ? v.get(KX(1).navAudio) : 0;
    const lvl1 = kma && v.get(KMA.sel('nav2')) > 0.5 && v.get(NAV.received(2)) > 0.5 && v.get(KX(2).navIdent) > 0.5 ? v.get(KX(2).navAudio) : 0;
    const adfOn = v.get(KR.on) > 0.5;
    const lvl2 = kma && adfOn && v.get(KMA.sel('adf')) > 0.5 && v.get(NAV.adfValid(1)) > 0.5 ? v.get(KR.vol) : 0;
    this.channel(this.ch[0], lvl0, dt);
    this.channel(this.ch[1], lvl1, dt);
    this.channel(this.ch[2], lvl2, dt);
  }

  private channel(c: Channel, level: number, dt: number): void {
    const v = this.vars;
    c.t += dt;
    if (c.t >= c.period) c.t -= c.period;
    const pattern = level > 0 ? v.getString(c.morse) : '';
    const g = pattern && morseKeyDown(pattern, c.t) ? level * IDENT_GAIN : 0;
    v.set(c.out, g);
    if (g !== c.gain) {
      c.gain = g;
      c.loop?.setGain(g);
    }
  }

  dispose(): void {
    for (const c of this.ch) c.loop?.stop();
  }
}
