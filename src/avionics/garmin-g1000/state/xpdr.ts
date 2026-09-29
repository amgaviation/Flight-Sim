/**
 * GTX 345R Mode S transponder controlled from the PFD (PG 190-02177-02 §4.4):
 *
 *  - XPDR softkey -> mode softkeys Standby / On / ALT / VFR / Code / Ident;
 *    Code -> digit softkeys 0-7 / Ident / BKSP.
 *  - Softkey code entry: digits left to right; the next digit must come
 *    within 10 s or the entry is cancelled and the previous code restored;
 *    BKSP moves back one digit; the code becomes active 5 s after the fourth
 *    digit.
 *  - FMS knob entry (PFD): the small knob enters two digits at a time, the
 *    large knob moves to the next pair, ENT completes; CLR / small-knob push
 *    cancels; the code activates automatically 10 s after the entry is
 *    finished.
 *  - VFR toggles the pre-programmed VFR code (1200) and restores the previous
 *    code on a second press.
 *  - IDENT: 18 s green "Ident" in the mode field (DO-181E 18 ±1 s); inhibited
 *    in Standby.
 *  - Mode code in `xpdr.mode`: 1 STBY, 2 ON, 3 ALT (core/vars NAV.xpdrMode).
 *    On the ground the GTX suppresses Mode A/C/S all-call replies (shown
 *    white); airborne the mode and code turn green.
 */
import type { SimVars } from '../../../core/SimVars';
import { NAV } from '../../../core/vars';
import { IDENT_S, VFR_CODE } from '../../garmin-g3000/state/radios';
import { G1K } from '../vars';

/** Softkey digit timeout (s) and activation delays (PG §4.4). */
export const XPDR_DIGIT_TIMEOUT_S = 10;
export const XPDR_ACTIVATE_S = 5;
export const XPDR_FMS_ACTIVATE_S = 10;
/** EST: SSR interrogation roughly every 4.8 s (12.5 rpm radar sweep); the 'R' reply mark shows ~0.5 s. */
const REPLY_PERIOD_S = 4.8;
const REPLY_SHOW_S = 0.5;

export class Transponder {
  /** Digits entered (string of 0-4 octal chars) while an entry is in progress. */
  entry = '';
  entering = false;
  /** Entry made with the FMS knob (pairs of digits). */
  fmsEntry = false;
  /** FMS entry: pair index 0/1 and the pairs' values (0..77). */
  fmsPair = 0;
  private fmsPairs = [0, 0];
  private sinceDigitS = 0;
  private sinceCompleteS = -1;
  private replyT = 0;
  /** Set when the entry ended (softkeys go back a level). */
  entryFinished = false;
  airborne = false;

  constructor(private readonly vars: SimVars) {
    if (!vars.has(NAV.xpdrCode)) vars.set(NAV.xpdrCode, VFR_CODE);
    if (!vars.has(NAV.xpdrMode)) vars.set(NAV.xpdrMode, 1);
    if (!vars.has(G1K.xpdrPrevCode)) vars.set(G1K.xpdrPrevCode, VFR_CODE);
    this.publish();
  }

  get code(): number {
    return this.vars.get(NAV.xpdrCode);
  }
  get mode(): number {
    return this.vars.get(NAV.xpdrMode);
  }

  setMode(m: 1 | 2 | 3): void {
    this.vars.set(NAV.xpdrMode, m);
  }

  /** VFR softkey: 1200 <-> previous code. */
  vfr(): void {
    const v = this.vars;
    const c = this.code;
    if (c === VFR_CODE) v.set(NAV.xpdrCode, v.get(G1K.xpdrPrevCode, VFR_CODE));
    else {
      v.set(G1K.xpdrPrevCode, c);
      v.set(NAV.xpdrCode, VFR_CODE);
    }
    this.cancelEntry();
  }

  ident(): boolean {
    if (this.mode < 2) return false; // Standby: IDENT inoperative (PG §4.4 NOTE)
    this.vars.set(G1K.xpdrIdentS, IDENT_S);
    this.vars.set(NAV.xpdrIdent, 1);
    return true;
  }

  /** Code softkey: starts a new softkey entry. */
  beginEntry(): void {
    this.entering = true;
    this.fmsEntry = false;
    this.entry = '';
    this.sinceDigitS = 0;
    this.sinceCompleteS = -1;
    this.publish();
  }

  /** Digit softkey 0..7. */
  digit(d: number): void {
    if (d < 0 || d > 7) return;
    if (!this.entering || this.fmsEntry) this.beginEntry();
    if (this.entry.length >= 4) return;
    this.entry += String(d);
    this.sinceDigitS = 0;
    if (this.entry.length === 4) this.sinceCompleteS = 0;
    this.publish();
  }

  backspace(): void {
    if (!this.entering) return;
    this.entry = this.entry.slice(0, -1);
    this.sinceDigitS = 0;
    this.sinceCompleteS = -1;
    this.publish();
  }

  /** FMS small knob during code entry (PFD): changes the current digit pair. */
  fmsInner(clicks: number): void {
    if (!this.entering || !this.fmsEntry) {
      this.entering = true;
      this.fmsEntry = true;
      this.fmsPair = 0;
      const c = String(Math.round(this.code)).padStart(4, '0');
      this.fmsPairs = [Number(c.slice(0, 2)), Number(c.slice(2, 4))];
    }
    const toIdx = (p: number): number => Math.floor(p / 10) * 8 + (p % 10);
    const fromIdx = (i: number): number => Math.floor(i / 8) * 10 + (i % 8);
    const i = (((toIdx(this.fmsPairs[this.fmsPair]) + clicks) % 64) + 64) % 64;
    this.fmsPairs[this.fmsPair] = fromIdx(i);
    this.entry = String(this.fmsPairs[0]).padStart(2, '0') + (this.fmsPair > 0 ? String(this.fmsPairs[1]).padStart(2, '0') : '');
    this.sinceDigitS = 0;
    this.sinceCompleteS = -1;
    this.publish();
  }

  /** FMS large knob: next / previous pair. */
  fmsOuter(clicks: number): void {
    if (!this.entering || !this.fmsEntry) return;
    this.fmsPair = clicks > 0 ? 1 : 0;
    this.entry = String(this.fmsPairs[0]).padStart(2, '0') + (this.fmsPair > 0 ? String(this.fmsPairs[1]).padStart(2, '0') : '');
    if (this.fmsPair === 1) this.sinceCompleteS = 0;
    this.sinceDigitS = 0;
    this.publish();
  }

  /** ENT completes an FMS entry. */
  fmsEnter(): boolean {
    if (!this.entering || !this.fmsEntry) return false;
    this.entry = String(this.fmsPairs[0]).padStart(2, '0') + String(this.fmsPairs[1]).padStart(2, '0');
    this.activateEntry();
    return true;
  }

  cancelEntry(): void {
    if (!this.entering) return;
    this.entering = false;
    this.fmsEntry = false;
    this.entry = '';
    this.entryFinished = true;
    this.publish();
  }

  private activateEntry(): void {
    if (/^[0-7]{4}$/.test(this.entry)) {
      this.vars.set(G1K.xpdrPrevCode, this.code);
      this.vars.set(NAV.xpdrCode, Number(this.entry));
    }
    this.entering = false;
    this.fmsEntry = false;
    this.entry = '';
    this.entryFinished = true;
    this.publish();
  }

  /** Four-character code for display ('45__' while entering). */
  displayCode(): string {
    if (this.entering) return this.entry.padEnd(4, '_');
    return String(Math.round(this.code)).padStart(4, '0');
  }

  private publish(): void {
    const v = this.vars;
    v.set(G1K.xpdrEntry, this.entering ? 1 : 0);
    v.set(G1K.xpdrEntryDigits, this.entry.length);
    v.set(G1K.xpdrEntryCode, this.entry.length ? Number(this.entry.padEnd(4, '0')) : 0);
  }

  update(dt: number, airborne: boolean, powered: boolean): void {
    const v = this.vars;
    this.airborne = airborne;
    const idS = v.get(G1K.xpdrIdentS);
    if (idS > 0) {
      const left = Math.max(0, idS - dt);
      v.set(G1K.xpdrIdentS, left);
      if (left <= 0) v.set(NAV.xpdrIdent, 0);
    }
    if (this.entering) {
      this.sinceDigitS += dt;
      if (this.sinceCompleteS >= 0) {
        this.sinceCompleteS += dt;
        const lim = this.fmsEntry ? XPDR_FMS_ACTIVATE_S : XPDR_ACTIVATE_S;
        if (this.sinceCompleteS >= lim) {
          if (this.fmsEntry) this.entry = String(this.fmsPairs[0]).padStart(2, '0') + String(this.fmsPairs[1]).padStart(2, '0');
          this.activateEntry();
        }
      } else if (this.sinceDigitS >= XPDR_DIGIT_TIMEOUT_S) this.cancelEntry();
    }
    // Reply indication: replies only in ON / ALT while airborne (on-ground replies suppressed).
    const replying = powered && this.mode >= 2 && airborne;
    this.replyT = replying ? this.replyT + dt : 0;
    const r = replying && this.replyT % REPLY_PERIOD_S < REPLY_SHOW_S;
    v.set(G1K.xpdrReplyS, r ? 1 : 0);
  }
}
