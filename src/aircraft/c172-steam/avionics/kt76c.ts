/**
 * Bendix/King KT 76C transponder with blind encoder (POH 172SPHUS Supplement 2, Figure 1).
 *
 *  - Mode selector (item 5): OFF / SBY (standby, code selection) / TST (self test: all display
 *    segments on, transmitter disabled) / ON (mode A) / ALT (modes A and C).
 *  - Numeric keys 0-7 (item 8): select the Mode A reply code; "the new code will be
 *    transmitted after a 5-second delay". CLR (item 7) deletes the last digit entered. VFR
 *    (item 6) recalls the pre-programmed VFR code; programming: SBY, enter the code, hold IDT
 *    and press VFR (Supplement 2 "To program VFR code").
 *  - IDT (item 1): ident pulse; the reply lamp 'R' is steady for about 18 s (item 1 / item 4
 *    "18 +/- 2 seconds").
 *  - Reply indicator 'R' (item 4): flashes on each reply to a valid interrogation.
 *  - Altitude display (item 2): pressure altitude in hundreds of feet with 'FL' in ALT mode;
 *    dashes when the encoder data is invalid.
 *
 * Outputs: xpdr.code / xpdr.mode (core NAV vars: 0 off, 1 stby, 2 on, 3 alt) / xpdr.ident,
 * and the display state vars in KT. Power: XPNDR breaker (avionics bus 2).
 *
 * Altitude: the shared blind encoder (encoder.ts, ENC.*), which also feeds the KAP 140. In ALT the
 * transponder replies with Mode A and Mode C (Supplement 2); without valid encoder data there is no
 * altitude to report, so xpdr.mode is 2 (Mode A only) and the altitude display is dashed.
 *
 * EST: interrogations are assumed every 4.8 s (terminal radar antenna at 12.5 rpm) while
 * the transponder is replying.
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import { NAV } from '../../../core/vars';
import { ENC, EV, KT } from '../vars';
import { Button, onEvent } from './util';

export const KT_MODE = { off: 0, sby: 1, tst: 2, on: 3, alt: 4 } as const;
const CODE_DELAY_S = 5;
const IDENT_S = 18;
const SWEEP_S = 4.8;

export class Kt76cLogic implements Subsystem {
  readonly name = 'kt76c';
  /** Code being transmitted (octal digits as a decimal number). */
  code = 1200;
  /** Code shown / pending (digits entered so far fill from the left). */
  private entry: number[] = [];
  private pendingCode = -1;
  private pendingT = 0;
  private entryIdleT = 0;
  vfrCode = 1200;
  private identT = 0;
  private sweepT = 0;
  private replyT = 0;
  private readonly offs: (() => void)[] = [];
  private readonly bIdt: Button;

  constructor(
    ctx: Pick<SimContext, 'vars' | 'events'>,
    private readonly powerVar: string,
  ) {
    this.vars = ctx.vars;
    this.bIdt = new Button(ctx.vars, KT.idt);
    for (let d = 0; d <= 7; d++) onEvent(ctx.events, EV.ktKey(d), () => this.key(d), this.offs);
    onEvent(ctx.events, EV.ktClr, () => this.clr(), this.offs);
    onEvent(ctx.events, EV.ktVfr, () => this.vfr(), this.offs);
  }
  private readonly vars: SimContext['vars'];

  private get on(): boolean {
    return this.vars.get(this.powerVar) > 0.5 && Math.round(this.vars.get(KT.mode)) !== KT_MODE.off;
  }

  private key(d: number): void {
    if (!this.on) return;
    if (this.entry.length >= 4) this.entry.length = 0;
    this.entry.push(d);
    this.entryIdleT = 0;
    if (this.entry.length === 4) {
      this.pendingCode = this.entry[0] * 1000 + this.entry[1] * 100 + this.entry[2] * 10 + this.entry[3];
      this.pendingT = CODE_DELAY_S;
      this.entry.length = 0;
    }
  }

  private clr(): void {
    if (!this.on) return;
    if (this.entry.length > 0) this.entry.pop();
    else if (this.pendingCode >= 0) this.pendingCode = -1;
  }

  private vfr(): void {
    if (!this.on) return;
    const mode = Math.round(this.vars.get(KT.mode));
    if (this.bIdt.down && mode === KT_MODE.sby) {
      // Program: the code currently displayed becomes the VFR code (IDT held, VFR pressed).
      this.vfrCode = this.pendingCode >= 0 ? this.pendingCode : this.code;
      return;
    }
    this.entry.length = 0;
    this.pendingCode = -1;
    this.code = this.vfrCode;
  }

  /** Sets the reply code immediately (state presets / ATC assignment in tests). */
  setCode(code: number): void {
    this.code = code;
    this.entry.length = 0;
    this.pendingCode = -1;
  }

  update(dt: number): void {
    const v = this.vars;
    const on = this.on;
    const mode = Math.round(v.get(KT.mode));
    this.bIdt.update(dt);
    v.set(KT.on, on ? 1 : 0);
    if (!on) {
      this.identT = 0;
      this.entry.length = 0;
      v.set(NAV.xpdrMode, 0);
      v.set(NAV.xpdrIdent, 0);
      v.set(KT.reply, 0);
      v.set(KT.display, this.code);
      v.set(KT.entry, 0);
      v.set(KT.altHft, -9999);
      v.set(KT.vfrCode, this.vfrCode);
      v.set(NAV.xpdrCode, this.code);
      return;
    }
    // Code entry: pending code goes live after 5 s; an incomplete entry is abandoned after 5 s idle (EST).
    if (this.pendingCode >= 0) {
      this.pendingT -= dt;
      if (this.pendingT <= 0) {
        this.code = this.pendingCode;
        this.pendingCode = -1;
      }
    }
    if (this.entry.length > 0) {
      this.entryIdleT += dt;
      if (this.entryIdleT > CODE_DELAY_S) this.entry.length = 0;
    }
    const replying = mode === KT_MODE.on || mode === KT_MODE.alt;
    if (this.bIdt.pressed && replying) this.identT = IDENT_S;
    if (this.identT > 0) this.identT = Math.max(0, this.identT - dt);
    // Reply lamp: flashes at each interrogation (EST radar sweep), steady during IDENT.
    let reply = false;
    if (replying) {
      this.sweepT += dt;
      if (this.sweepT >= SWEEP_S) {
        this.sweepT -= SWEEP_S;
        this.replyT = 0.25;
      }
      if (this.replyT > 0) {
        this.replyT -= dt;
        reply = true;
      }
      if (this.identT > 0) reply = true;
    }
    if (mode === KT_MODE.tst) reply = true;
    v.set(KT.reply, reply ? 1 : 0);
    const encValid = v.get(ENC.valid) > 0.5;
    // Mode C only with valid encoder data (no altitude to report otherwise): ALT falls back to Mode A.
    v.set(NAV.xpdrMode, mode === KT_MODE.alt ? (encValid ? 3 : 2) : mode === KT_MODE.on ? 2 : 1);
    v.set(NAV.xpdrCode, this.code);
    v.set(NAV.xpdrIdent, this.identT > 0 ? 1 : 0);
    // Display: digits being entered (left-filled) or the pending / active code.
    let disp = this.pendingCode >= 0 ? this.pendingCode : this.code;
    if (this.entry.length > 0) {
      disp = 0;
      for (let i = 0; i < 4; i++) disp = disp * 10 + (i < this.entry.length ? this.entry[i] : 0);
    }
    v.set(KT.display, disp);
    v.set(KT.entry, this.entry.length);
    v.set(KT.vfrCode, this.vfrCode);
    // Blind encoder (shared with the KAP 140): Gillham altitude in hundreds of feet.
    v.set(KT.altHft, mode === KT_MODE.alt && encValid ? v.get(ENC.gillhamHft) : -9999);
  }

  /** Shared encoder valid (the altitude display and Mode C reporting). */
  get encoderValid(): boolean {
    return this.vars.get(ENC.valid) > 0.5;
  }

  reset(): void {
    this.bIdt.reset();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
