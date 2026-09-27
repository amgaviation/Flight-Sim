/**
 * Bendix/King KR 87 digital ADF (POH 172SPHUS Supplement 6, Figure 1 sheets 1-4).
 *
 *  - 200-1799 kHz, 1 kHz steps. Active frequency in the left window; the right window shows
 *    the STANDBY frequency (FRQ), the flight timer (FLT) or the elapsed timer (ET) (items 2, 4).
 *  - Frequency knobs (item 6): outer = 100s with rollover into the 1000s up to 1799; inner
 *    pushed = 10s, pulled = 1s. They tune the standby frequency when FRQ is displayed and the
 *    active frequency directly while a timer is displayed.
 *  - FRQ (item 10): exchanges active and standby; with a timer displayed it first recalls the
 *    standby frequency from blind memory (Section 4 "elapsed time timer" note).
 *  - FLT/ET (item 9): alternately selects the flight timer (runs from power-on, up to 59:59
 *    h:min) and the elapsed timer (up to 59:59 min:s).
 *  - SET/RST (item 8): resets the elapsed timer; held until ET flashes = countdown set mode
 *    (knobs: outer minutes, inner 10 s pushed / 1 s pulled), pressed again to start; at zero
 *    it counts up and flashes for 15 s. The set mode times out 15 s after the last entry.
 *  - ADF button (item 12): out = ANT (bearing pointer parked at 90), in = ADF. BFO (item 11).
 *  - ON/OFF/VOL (item 7).
 *
 * Outputs: adf1.powered / active_khz / stby_khz / mode (nav/Radios AdfReceiver) and KR.*.
 * Power: ADF breaker (avionics bus 2) and the ON/OFF/VOL knob.
 * SCOPE: receiver audio (AM voice, ident, BFO beat tone) is not synthesised.
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import { NAV } from '../../../core/vars';
import { clamp } from '../../../core/math';
import { EV, KR } from '../vars';
import { Button, onEncoder, wrapInt } from './util';

const SET_HOLD_S = 2; // EST: "PRESS until the ET annunciation begins to flash"
const SET_TIMEOUT_S = 15;

export class Kr87Logic implements Subsystem {
  readonly name = 'kr87';
  active = 890;
  standby = 1030;
  /** 0 FRQ, 1 FLT, 2 ET. */
  window = 0;
  fltS = 0;
  etS = 0;
  /** 0 up, 1 set, 2 down. */
  etState = 0;
  etFlashS = 0;
  on = false;
  private setIdle = 0;
  private readonly bFrq: Button;
  private readonly bFlt: Button;
  private readonly bSet: Button;
  private readonly offs: (() => void)[] = [];
  private readonly vars: SimContext['vars'];

  constructor(
    ctx: Pick<SimContext, 'vars' | 'events'>,
    private readonly powerVar: string,
  ) {
    this.vars = ctx.vars;
    this.bFrq = new Button(ctx.vars, KR.frq);
    this.bFlt = new Button(ctx.vars, KR.fltEt);
    this.bSet = new Button(ctx.vars, KR.setRst);
    onEncoder(ctx.events, EV.krOuter, (s) => this.knob(s, true), this.offs);
    onEncoder(ctx.events, EV.krInner, (s) => this.knob(s, false), this.offs);
    this.publish();
  }

  setActive(khz: number, standby?: number): void {
    this.active = khz;
    if (standby !== undefined) this.standby = standby;
    this.publish();
  }

  private knob(steps: number, outer: boolean): void {
    if (!this.on) return;
    const pulled = this.vars.get(KR.innerPull) > 0.5;
    if (this.window === 2 && this.etState === 1) {
      const add = outer ? 60 * steps : (pulled ? 1 : 10) * steps;
      this.etS = clamp(Math.round(this.etS + add), 0, 59 * 60 + 59);
      this.setIdle = 0;
      return;
    }
    const f = this.window === 0 ? this.standby : this.active;
    let nf: number;
    if (outer) {
      // 100s with rollover into the 1000s, 200..1799 (keep the tens/units).
      const low = f % 100;
      const hundreds = wrapInt(Math.floor(f / 100) + steps, 2, 17);
      nf = hundreds * 100 + low;
    } else {
      const unit = pulled ? 1 : 10;
      const base = Math.floor(f / 100) * 100;
      const low = f - base;
      nf = base + (pulled ? wrapInt(low + steps * unit, 0, 99) : wrapInt(Math.floor(low / 10) + steps, 0, 9) * 10 + (low % 10));
    }
    nf = clamp(nf, 200, 1799);
    if (this.window === 0) this.standby = nf;
    else this.active = nf;
  }

  update(dt: number): void {
    const v = this.vars;
    const on = v.get(this.powerVar) > 0.5 && v.get(KR.vol) > 0.02;
    if (on && !this.on) {
      // Flight timer starts whenever the unit is turned on (Supplement 6 "To operate flight timer").
      this.fltS = 0;
      this.etS = 0;
      this.etState = 0;
    }
    this.on = on;
    // Inner knob pulled: 1 kHz tuning (item 6).
    v.set('ac.kr87.step_khz', v.get(KR.innerPull) > 0.5 ? 1 : 10);
    this.bFrq.update(dt);
    this.bFlt.update(dt);
    this.bSet.update(dt);
    if (on) {
      if (this.bFrq.pressed) {
        if (this.window !== 0) this.window = 0;
        else {
          const t = this.active;
          this.active = this.standby;
          this.standby = t;
        }
        if (this.etState === 1) this.etState = 0;
      }
      if (this.bFlt.pressed) {
        this.window = this.window === 1 ? 2 : 1;
        if (this.etState === 1) this.etState = 0;
      }
      if (this.window === 2) {
        if (this.bSet.long(SET_HOLD_S)) {
          this.etState = 1;
          this.etS = 0;
          this.setIdle = 0;
        } else if (this.bSet.shortRelease(SET_HOLD_S)) {
          if (this.etState === 1) this.etState = this.etS > 0 ? 2 : 0;
          else {
            this.etS = 0;
            this.etState = 0;
          }
        }
      } else if (this.bSet.shortRelease(SET_HOLD_S)) {
        // "The set/reset button when pressed resets the elapsed timer whether it is being displayed or not."
        this.etS = 0;
        this.etState = 0;
      }
      this.fltS = Math.min(this.fltS + dt, 59 * 3600 + 59 * 60);
      if (this.etState === 0) this.etS = Math.min(this.etS + dt, 59 * 60 + 59);
      else if (this.etState === 2) {
        this.etS -= dt;
        if (this.etS <= 0) {
          this.etS = 0;
          this.etState = 0;
          this.etFlashS = 15;
        }
      } else {
        this.setIdle += dt;
        if (this.setIdle > SET_TIMEOUT_S) this.etState = 0;
      }
      if (this.etFlashS > 0) this.etFlashS = Math.max(0, this.etFlashS - dt);
    }
    this.publish();
  }

  private publish(): void {
    const v = this.vars;
    v.set(KR.on, this.on ? 1 : 0);
    v.set(NAV.adfPowered(1), this.on ? 1 : 0);
    v.set(NAV.adfActive(1), this.active);
    v.set(NAV.adfStandby(1), this.standby);
    const adf = v.get(KR.adf, 1) > 0.5;
    v.set(NAV.adfMode(1), adf ? (v.get(KR.bfo) > 0.5 ? 2 : 1) : 0);
    v.set(KR.window, this.window);
    v.set(KR.fltS, this.fltS);
    v.set(KR.etS, this.etS);
    v.set(KR.etState, this.etState);
  }

  reset(): void {
    this.bFrq.reset();
    this.bFlt.reset();
    this.bSet.reset();
    this.on = this.vars.get(this.powerVar) > 0.5 && this.vars.get(KR.vol) > 0.02;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
