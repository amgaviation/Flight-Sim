/**
 * Bendix/King KX 155A VHF NAV/COMM (POH 172SPHUS Supplement 1, Figure 1 sheets 1-7).
 *
 * Controls (Supplement 1 Figure 1):
 *  - COMM: frequency display ACTIVE 'T/R' STANDBY (item 1); outer knob MHz 118-136 with
 *    wrap-around (item 10); inner knob 50 kHz pushed in / 25 kHz pulled out (item 9);
 *    transfer button (item 12): swaps USE/STBY, held 2 s = ACTIVE ENTRY (direct tune), pushed
 *    again to return; CHAN button (item 11): press = channel selection (reverts after 2 s
 *    without a selection), held 2 s = channel program mode, saved by pushing CHAN;
 *    OFF/PULL/TEST volume knob (item 13): clockwise from OFF powers the unit, pulled out
 *    defeats the automatic squelch.
 *  - NAV: display (items 2, 3); outer knob MHz 108-117 (item 5), inner 50 kHz (item 4);
 *    transfer button (item 6): swaps, held 2 s = ACTIVE ENTRY; MODE button (item 7) cycles
 *    ACTIVE/STANDBY -> ACTIVE/CDI -> ACTIVE/BEARING -> ACTIVE/RADIAL -> TIMER; in the CDI,
 *    BEARING and RADIAL formats the knobs channel the ACTIVE frequency and the transfer button
 *    swaps with the STANDBY frequency held in blind storage; in the CDI format the pulled
 *    inner knob sets the unit's own OBS (independent of the external CDI). TIMER: counts up
 *    from power-on; transfer held 2 s resets it and flashes ET (set mode), the knobs set a
 *    countdown (large = minutes, small in = 10 s, small out = 1 s), transfer starts it; at
 *    zero it counts up again, flashing for 15 s. NAV volume with PULL IDENT (item 8).
 *  - Frequencies are kept on power down (item 2: "stored in the memory on power down").
 *
 * Power: the NAV/COM breaker on its avionics bus (nav_com1 AVN BUS 1 / nav_com2 AVN BUS 2,
 * POH Fig 7-7A) and the COMM OFF/PULL/TEST knob. Outputs: nav{n}.active_mhz / stby_mhz /
 * powered (read by nav/Radios), com{n}.active_mhz / stby_mhz, and the display state vars in
 * KX(n). The 'T' annunciation follows the KMA 28 transmit selection.
 *
 * NAV ident audio: the Morse ident is heard with the volume knob pulled (PULL IDENT) through the
 * KMA 28 NAV select (receiverAudio.ts). SCOPE: COM and NAV voice audio are not synthesised. Channel program mode stores the current standby frequency into
 * the selected channel (the unit's field-by-field editing is simplified). The pilot
 * configuration pages (SWRV / BRIM / SIDE) are not modelled.
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import { NAV } from '../../../core/vars';
import { wrap360, wrap180, clamp } from '../../../core/math';
import { radioGeometry } from '../../../nav';
import { EV, KMA, KX } from '../vars';
import { Button, onEncoder, stepKhz, stepMhz, wrapInt } from './util';

/** Hold time that selects ACTIVE ENTRY / channel program / timer reset (Supplement 1: "2 seconds or more"). */
const LONG_S = 2;
/** Channel selection mode times out (Supplement 1 item 11: "within 2 seconds"). */
const CHAN_TIMEOUT_S = 2;
/** Number of programmable channels. KX 155A: 32 (Bendix/King KX 155A installation manual); EST where the POH is silent. */
export const KX_CHANNELS = 32;

export interface Kx155aOptions {
  /** Unit index (1 or 2) = nav/com receiver index. */
  n: 1 | 2;
  /** Power binding var (NAV/COM breaker load powered). */
  powerVar: string;
  /** Initial frequencies (kHz). */
  com?: [number, number];
  nav?: [number, number];
}

export class Kx155aLogic implements Subsystem {
  readonly name: string;
  readonly n: 1 | 2;
  comAct: number;
  comStby: number;
  navAct: number;
  navStby: number;
  /** 0 ACT/STBY, 1 CDI, 2 BRG, 3 RAD, 4 TIMER. */
  format = 0;
  comDirect = false;
  navDirect = false;
  /** 0 off, 1 select, 2 program. */
  chanMode = 0;
  chanIndex = 0;
  readonly channels: number[] = new Array<number>(KX_CHANNELS).fill(0);
  intObs = 0;
  /** Internal CDI (-1..1, + fly right) and TO/FROM for the display. */
  intCdi = 0;
  intToFrom = 0;
  timerS = 0;
  /** 0 count up, 1 set (flashing), 2 count down. */
  timerState = 0;
  /** Flash period after a countdown reached zero (s). */
  timerFlashS = 0;
  on = false;
  private chanTimer = 0;
  private readonly v: SimContext['vars'];
  private readonly k: ReturnType<typeof KX>;
  private readonly bComXfr: Button;
  private readonly bChan: Button;
  private readonly bNavXfr: Button;
  private readonly bMode: Button;
  private readonly offs: (() => void)[] = [];
  private readonly o: Kx155aOptions;
  private readonly cdiTmp = { devDeg: 0, cdi: 0, toFrom: 0 };
  private readonly nv: { act: string; stby: string; powered: string; received: string; isLoc: string; radial: string; cdi: string; toFrom: string };
  private readonly cv: { act: string; stby: string };

  constructor(ctx: Pick<SimContext, 'vars' | 'events'>, o: Kx155aOptions) {
    this.o = o;
    this.n = o.n;
    this.name = `kx155a-${o.n}`;
    this.v = ctx.vars;
    this.k = KX(o.n);
    // Defaults: the POH Supplement 1 figure shows 122.70 / 123.00 COMM and 117.60 NAV (EST memory contents).
    [this.comAct, this.comStby] = o.com ?? (o.n === 1 ? [122700, 123000] : [121500, 118000]);
    [this.navAct, this.navStby] = o.nav ?? (o.n === 1 ? [117600, 110500] : [110000, 113000]);
    const r = o.n;
    this.nv = {
      act: NAV.activeFreq(r),
      stby: NAV.standbyFreq(r),
      powered: NAV.powered(r),
      received: NAV.received(r),
      isLoc: NAV.isLoc(r),
      radial: NAV.radial(r),
      cdi: NAV.cdi(r),
      toFrom: NAV.toFrom(r),
    };
    this.cv = { act: NAV.comActive(r), stby: NAV.comStandby(r) };
    const v = this.v;
    this.bComXfr = new Button(v, this.k.comXfr);
    this.bChan = new Button(v, this.k.chan);
    this.bNavXfr = new Button(v, this.k.navXfr);
    this.bMode = new Button(v, this.k.navMode);
    onEncoder(ctx.events, EV.kxComMhz(r), (s) => this.comKnob(s, true), this.offs);
    onEncoder(ctx.events, EV.kxComKhz(r), (s) => this.comKnob(s, false), this.offs);
    onEncoder(ctx.events, EV.kxNavMhz(r), (s) => this.navKnob(s, true), this.offs);
    onEncoder(ctx.events, EV.kxNavKhz(r), (s) => this.navKnob(s, false), this.offs);
    this.publish();
  }

  /** Tunes (kHz). `which`: active or standby. */
  setCom(khzActive: number, khzStandby?: number): void {
    this.comAct = khzActive;
    if (khzStandby !== undefined) this.comStby = khzStandby;
    this.publish();
  }
  setNav(khzActive: number, khzStandby?: number): void {
    this.navAct = khzActive;
    if (khzStandby !== undefined) this.navStby = khzStandby;
    this.publish();
  }

  private comKnob(steps: number, outer: boolean): void {
    if (!this.on) return;
    if (this.chanMode === 1 || (this.chanMode === 2 && outer)) {
      this.chanIndex = wrapInt(this.chanIndex + steps, 0, KX_CHANNELS - 1);
      this.chanTimer = CHAN_TIMEOUT_S;
      if (this.chanMode === 1 && this.channels[this.chanIndex] > 0) this.comStby = this.channels[this.chanIndex];
      return;
    }
    const pulled = this.v.get(this.k.comInnerPull) > 0.5;
    const f = this.comDirect ? this.comAct : this.comStby;
    const nf = outer ? stepMhz(f, steps, 118, 136) : stepKhz(f, steps, pulled ? 25 : 50);
    if (this.comDirect) this.comAct = nf;
    else this.comStby = nf;
  }

  private navKnob(steps: number, outer: boolean): void {
    if (!this.on) return;
    const pulled = this.v.get(this.k.navInnerPull) > 0.5;
    if (this.format === 4) {
      if (this.timerState !== 1) return;
      // Countdown set: large = minutes, small in = 10 s, small out = 1 s (Supplement 1 item 7).
      const add = outer ? 60 * steps : (pulled ? 1 : 10) * steps;
      this.timerS = clamp(Math.round(this.timerS + add), 0, 59 * 60 + 59);
      return;
    }
    if (this.format === 1 && !outer && pulled) {
      this.intObs = wrap360(Math.round(this.intObs + steps));
      return;
    }
    const tuneActive = this.navDirect || this.format >= 1;
    const f = tuneActive ? this.navAct : this.navStby;
    const nf = outer ? stepMhz(f, steps, 108, 117) : stepKhz(f, steps, 50);
    if (tuneActive) this.navAct = nf;
    else this.navStby = nf;
  }

  update(dt: number): void {
    const v = this.v;
    const k = this.k;
    const on = v.get(this.o.powerVar) > 0.5 && v.get(k.comVol) > 0.02;
    if (on && !this.on) {
      // Power-up: elapsed timer starts from zero (item 7 TIMER), entry modes cleared.
      this.timerS = 0;
      this.timerState = 0;
      this.comDirect = this.navDirect = false;
      this.chanMode = 0;
    }
    this.on = on;
    // Inner-knob pull states shown by the unit: COMM 25 kHz channel steps (item 9), NAV OBS set
    // mode of the internal CDI format (item 4 "PULL OBS").
    v.set(k.comStep, v.get(k.comInnerPull) > 0.5 ? 25 : 50);
    // NAV audio level (item 8); the ident Morse is keyed by receiverAudio.ts while PULL IDENT is out.
    v.set(k.navAudio, on ? v.get(k.navVol) : 0);
    v.set(k.navObsSet, on && this.format === 1 && v.get(k.navInnerPull) > 0.5 ? 1 : 0);
    this.bComXfr.update(dt);
    this.bChan.update(dt);
    this.bNavXfr.update(dt);
    this.bMode.update(dt);
    if (on) {
      // ---- COMM transfer / direct tune
      if (this.bComXfr.long(LONG_S)) this.comDirect = !this.comDirect;
      else if (this.bComXfr.shortRelease(LONG_S)) {
        if (this.chanMode === 2) {
          this.channels[this.chanIndex] = this.comStby; // store the entered frequency in the channel
          this.chanIndex = wrapInt(this.chanIndex + 1, 0, KX_CHANNELS - 1);
        } else if (this.comDirect) this.comDirect = false;
        else {
          const t = this.comAct;
          this.comAct = this.comStby;
          this.comStby = t;
        }
      }
      // ---- CHAN
      if (this.bChan.long(LONG_S)) {
        this.chanMode = 2;
      } else if (this.bChan.shortRelease(LONG_S)) {
        if (this.chanMode === 2) this.chanMode = 0; // saved
        else {
          this.chanMode = 1;
          this.chanTimer = CHAN_TIMEOUT_S;
        }
      }
      if (this.chanMode === 1) {
        this.chanTimer -= dt;
        if (this.chanTimer <= 0) this.chanMode = 0;
      }
      // ---- NAV mode / transfer
      if (this.bMode.shortRelease(10)) {
        this.format = (this.format + 1) % 5;
        this.navDirect = false;
      }
      if (this.format === 4) {
        if (this.bNavXfr.long(LONG_S)) {
          this.timerS = 0;
          this.timerState = 1;
        } else if (this.bNavXfr.shortRelease(LONG_S) && this.timerState === 1) this.timerState = this.timerS > 0 ? 2 : 0;
      } else if (this.format === 0) {
        if (this.bNavXfr.long(LONG_S)) this.navDirect = !this.navDirect;
        else if (this.bNavXfr.shortRelease(LONG_S)) {
          if (this.navDirect) this.navDirect = false;
          else this.swapNav();
        }
      } else if (this.bNavXfr.shortRelease(LONG_S)) this.swapNav();
      // ---- timer
      if (this.timerState === 0) this.timerS = Math.min(this.timerS + dt, 59 * 60 + 59);
      else if (this.timerState === 2) {
        this.timerS -= dt;
        if (this.timerS <= 0) {
          this.timerS = 0;
          this.timerState = 0;
          this.timerFlashS = 15; // "flashing for the first 15 seconds"
        }
      }
      if (this.timerFlashS > 0) this.timerFlashS = Math.max(0, this.timerFlashS - dt);
      // ---- internal CDI / bearing
      if (v.get(this.nv.received) > 0.5) {
        if (v.get(this.nv.isLoc) > 0.5) {
          this.intCdi = v.get(this.nv.cdi);
          this.intToFrom = 1;
        } else {
          radioGeometry.vorCdi(v.get(this.nv.radial), this.intObs, this.cdiTmp);
          this.intCdi = this.cdiTmp.cdi;
          this.intToFrom = this.cdiTmp.toFrom;
        }
      } else {
        this.intCdi = 0;
        this.intToFrom = 0;
      }
    }
    this.publish();
  }

  private swapNav(): void {
    const t = this.navAct;
    this.navAct = this.navStby;
    this.navStby = t;
  }

  /** Bearing TO the station (deg) or NaN when not valid (BRG format). */
  bearingTo(): number {
    const v = this.v;
    if (v.get(this.nv.received) < 0.5 || v.get(this.nv.isLoc) > 0.5) return NaN;
    return wrap360(v.get(this.nv.radial) + 180);
  }
  /** Radial FROM the station (deg) or NaN (RAD format). */
  radialFrom(): number {
    const v = this.v;
    if (v.get(this.nv.received) < 0.5 || v.get(this.nv.isLoc) > 0.5) return NaN;
    return wrap360(v.get(this.nv.radial));
  }
  /** Deviation of the internal CDI in degrees (display). */
  intDevDeg(): number {
    return wrap180(this.intCdi * 10);
  }

  private publish(): void {
    const v = this.v;
    const k = this.k;
    v.set(k.on, this.on ? 1 : 0);
    v.set(this.nv.act, this.navAct / 1000);
    v.set(this.nv.stby, this.navStby / 1000);
    v.set(this.nv.powered, this.on ? 1 : 0);
    v.set(this.cv.act, this.comAct / 1000);
    v.set(this.cv.stby, this.comStby / 1000);
    v.set(k.navFormat, this.format);
    v.set(k.intObs, this.intObs);
    v.set(k.tx, this.on && v.get(KMA.txCom) === this.n ? 1 : 0);
    v.set(k.comDirect, this.comDirect ? 1 : 0);
    v.set(k.navDirect, this.navDirect ? 1 : 0);
    v.set(k.chanMode, this.chanMode);
    v.set(k.chanIndex, this.chanIndex);
    v.set(k.timerS, this.timerS);
    v.set(k.timerState, this.timerState);
  }

  reset(): void {
    this.bComXfr.reset();
    this.bChan.reset();
    this.bNavXfr.reset();
    this.bMode.reset();
    this.on = this.v.get(this.o.powerVar) > 0.5 && this.v.get(this.k.comVol) > 0.02;
    this.publish();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
