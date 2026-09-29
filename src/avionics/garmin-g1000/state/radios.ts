/**
 * NAV / COM tuning on the G1000 NXi bezels (PG 190-02177-02 §1.2 Figure 1-2,
 * §4.2 "COM Operation", §4.3 "NAV Operation"): both GDUs carry identical
 * NAV / COM knobs acting on the same radios.
 *
 *  - NAV knob (large MHz / small kHz, 50 kHz steps) tunes the standby of the
 *    radio holding the cyan tuning box; push moves the box NAV1 <-> NAV2.
 *  - NAV transfer key swaps standby / active of the boxed radio.
 *  - NAV VOL/ID: volume 0..100 % (readout shown 2 s), push = Morse ident audio.
 *  - COM knob (large MHz / small kHz, 25 or 8.33 kHz channels) tunes the
 *    boxed COM standby; push moves the box COM1 <-> COM2.
 *  - COM transfer key swaps; press and hold 2 s tunes 121.500 MHz into the
 *    active field (EMERG).
 *  - COM VOL/SQ: volume, push = automatic squelch on / off.
 *  - Approach auto-tune (PG §4.3 "Auto-tuning NAV frequencies on approach
 *    activation"): with the CDI on GPS the approach frequency goes into both
 *    NAV active fields (actives move to standby; a matching standby is
 *    transferred); with the CDI on NAV1/NAV2 it goes to that radio's standby.
 */
import type { SimVars } from '../../../core/SimVars';
import { NAV } from '../../../core/vars';
import { stepCom, stepNav } from '../../garmin-g3000/state/radios';
import { CDI_SOURCE, G1K, vn } from '../vars';

/** Seconds a volume readout replaces the standby frequencies (PG §4.2: "remains for two seconds"). */
export const VOLUME_SHOW_S = 2;
/** COM transfer key hold time for 121.5 (PG §1.2: "Press and hold two seconds"). */
export const EMERG_HOLD_S = 2;
/** Volume change per knob click (EST: ~5 % steps, 20 clicks from 0 to 100 %). */
const VOL_STEP = 5;

export class RadioPanel {
  /** COM transfer key held (seconds) or -1. */
  private comXferHeldS = -1;
  private comXferHoldDone = false;

  constructor(private readonly vars: SimVars, readonly navCount: number) {
    const v = vars;
    const init = (n: string, x: number): void => {
      if (!v.has(n)) v.set(n, x);
    };
    init(G1K.navTuneBox, 1);
    init(G1K.comTuneBox, 1);
    init(G1K.comSpacing833, 0);
    for (const r of [1, 2]) {
      init(vn(G1K.navVolume, r), 50);
      init(vn(G1K.comVolume, r), 50);
      init(vn(G1K.comSquelch, r), 1);
      init(vn(G1K.navIdent, r), 0);
    }
    // Neutral power-up frequencies (EST: the system restores the last frequencies used; PG §4.2 NOTE).
    init(vn(NAV.comActive, 1), 118.1);
    init(vn(NAV.comStandby, 1), 121.5);
    init(vn(NAV.comActive, 2), 121.9);
    init(vn(NAV.comStandby, 2), 118.0);
    for (let r = 1; r <= Math.max(2, navCount); r++) {
      init(vn(NAV.activeFreq, r), 110.0);
      init(vn(NAV.standbyFreq, r), 113.0);
      init(vn(NAV.obs, r), 360);
    }
  }

  get navBox(): number {
    return this.vars.get(G1K.navTuneBox) >= 1.5 ? 2 : 1;
  }
  get comBox(): number {
    return this.vars.get(G1K.comTuneBox) >= 1.5 ? 2 : 1;
  }
  setNavBox(r: number): void {
    this.vars.set(G1K.navTuneBox, r === 2 ? 2 : 1);
  }

  // ---------------------------------------------------------------- NAV
  navToggleBox(): void {
    this.setNavBox(this.navBox === 1 ? 2 : 1);
  }
  navTune(clicks: number, knob: 'outer' | 'inner'): void {
    const r = this.navBox;
    this.vars.set(vn(NAV.standbyFreq, r), stepNav(this.vars.get(vn(NAV.standbyFreq, r)), clicks, knob));
  }
  navSwap(r = this.navBox): void {
    const v = this.vars;
    const a = v.get(vn(NAV.activeFreq, r));
    v.set(vn(NAV.activeFreq, r), v.get(vn(NAV.standbyFreq, r)));
    v.set(vn(NAV.standbyFreq, r), a);
  }
  navVolume(clicks: number): void {
    const r = this.navBox;
    const n = vn(G1K.navVolume, r);
    this.vars.set(n, Math.max(0, Math.min(100, this.vars.get(n, 50) + clicks * VOL_STEP)));
    this.vars.set(G1K.navVolShowS, VOLUME_SHOW_S);
  }
  navIdentToggle(): void {
    const n = vn(G1K.navIdent, this.navBox);
    this.vars.set(n, this.vars.get(n) >= 0.5 ? 0 : 1);
  }
  setNavStandby(r: number, mhz: number): void {
    if (Number.isFinite(mhz)) this.vars.set(vn(NAV.standbyFreq, r), mhz);
  }
  setNavActive(r: number, mhz: number): void {
    if (!Number.isFinite(mhz)) return;
    const v = this.vars;
    v.set(vn(NAV.standbyFreq, r), v.get(vn(NAV.activeFreq, r)));
    v.set(vn(NAV.activeFreq, r), mhz);
  }

  // ---------------------------------------------------------------- COM
  comToggleBox(): void {
    this.vars.set(G1K.comTuneBox, this.comBox === 1 ? 2 : 1);
  }
  comTune(clicks: number, knob: 'outer' | 'inner'): void {
    const r = this.comBox;
    this.vars.set(vn(NAV.comStandby, r), stepCom(this.vars.get(vn(NAV.comStandby, r)), clicks, knob, this.vars.get(G1K.comSpacing833) >= 0.5));
  }
  comSwap(r = this.comBox): void {
    const v = this.vars;
    const a = v.get(vn(NAV.comActive, r));
    v.set(vn(NAV.comActive, r), v.get(vn(NAV.comStandby, r)));
    v.set(vn(NAV.comStandby, r), a);
  }
  /** 121.500 into the active field of the boxed COM (EMERG). */
  comEmergency(r = this.comBox): void {
    this.vars.set(vn(NAV.comActive, r), 121.5);
  }
  comXferDown(): void {
    // The frequencies swap on press; holding 2 s then tunes 121.5 MHz.
    this.comSwap();
    this.comXferHeldS = 0;
    this.comXferHoldDone = false;
  }
  comXferUp(): void {
    this.comXferHeldS = -1;
  }
  comVolume(clicks: number): void {
    const n = vn(G1K.comVolume, this.comBox);
    this.vars.set(n, Math.max(0, Math.min(100, this.vars.get(n, 50) + clicks * VOL_STEP)));
    this.vars.set(G1K.comVolShowS, VOLUME_SHOW_S);
  }
  comSquelchToggle(): void {
    const n = vn(G1K.comSquelch, this.comBox);
    this.vars.set(n, this.vars.get(n, 1) >= 0.5 ? 0 : 1);
  }
  setComStandby(r: number, mhz: number): void {
    if (Number.isFinite(mhz)) this.vars.set(vn(NAV.comStandby, r), mhz);
  }
  setComActive(r: number, mhz: number): void {
    if (!Number.isFinite(mhz)) return;
    const v = this.vars;
    v.set(vn(NAV.comStandby, r), v.get(vn(NAV.comActive, r)));
    v.set(vn(NAV.comActive, r), mhz);
  }

  /**
   * Auto-tune of an approach frequency (PG §4.3): GPS CDI -> both NAV active
   * fields (a matching standby is transferred); NAV CDI -> the standby of the
   * CDI's radio.
   */
  autoTuneApproach(mhz: number, cdiSource: number): void {
    const v = this.vars;
    if (cdiSource === CDI_SOURCE.gps) {
      for (let r = 1; r <= Math.min(2, this.navCount); r++) {
        if (Math.abs(v.get(vn(NAV.activeFreq, r)) - mhz) < 0.001) continue;
        if (Math.abs(v.get(vn(NAV.standbyFreq, r)) - mhz) < 0.001) this.navSwap(r);
        else this.setNavActive(r, mhz);
      }
    } else {
      const r = Math.min(cdiSource, this.navCount);
      if (Math.abs(v.get(vn(NAV.activeFreq, r)) - mhz) > 0.001) this.setNavStandby(r, mhz);
    }
  }

  update(dt: number): void {
    const v = this.vars;
    const nv = v.get(G1K.navVolShowS);
    if (nv > 0) v.set(G1K.navVolShowS, Math.max(0, nv - dt));
    const cv = v.get(G1K.comVolShowS);
    if (cv > 0) v.set(G1K.comVolShowS, Math.max(0, cv - dt));
    if (this.comXferHeldS >= 0) {
      this.comXferHeldS += dt;
      if (!this.comXferHoldDone && this.comXferHeldS >= EMERG_HOLD_S) {
        this.comXferHoldDone = true;
        this.comEmergency();
      }
    }
  }
}
