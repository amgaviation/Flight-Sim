/**
 * Timer / References window models (PG 190-02177-02 §2.1 "Airspeed
 * Indicator" Vspeed bugs, §2.2 "Generic Timer", §2.4 "Minimum Altitude
 * Alerting"): V-speed reference bugs, the generic timer and the MDA/DH
 * (BARO / TEMP COMP) minimums. State lives in `g1k.*` vars so both GDUs and
 * the reversionary display agree. Pure TypeScript, unit tested.
 */
import type { SimVars } from '../../../core/SimVars';
import { AP } from '../../../core/vars';
import { tempCompCorrectionFt } from '../../garmin-g3000/state/models';
import type { VSpeedDef } from '../config';
import { G1K, MINS_MODE, vn } from '../vars';

// ------------------------------------------------------------------ V-speeds

/**
 * V-speed bugs (GLIDE / VR / VX / VY on the 172S): black flags with cyan
 * letters on the right of the airspeed tape; values change in 1 kt steps
 * (a changed value is marked with '*'); On/Off per bug; All References
 * On / Off and Restore Defaults from the References window menu.
 */
export class VSpeedBank {
  constructor(private readonly vars: SimVars, readonly defs: readonly VSpeedDef[]) {
    this.restoreDefaults();
  }
  value(id: string): number {
    return this.vars.get(vn(G1K.vspeedKt, id), NaN);
  }
  on(id: string): boolean {
    return this.vars.get(vn(G1K.vspeedOn, id)) >= 0.5;
  }
  modified(id: string): boolean {
    return this.vars.get(vn(G1K.vspeedMod, id)) >= 0.5;
  }
  set(id: string, kt: number): void {
    const d = this.defs.find((x) => x.id === id);
    const v = Math.max(20, Math.min(999, Math.round(kt)));
    this.vars.set(vn(G1K.vspeedKt, id), v);
    this.vars.set(vn(G1K.vspeedMod, id), d && d.defaultKt !== v ? 1 : 0);
  }
  setOn(id: string, on: boolean): void {
    this.vars.set(vn(G1K.vspeedOn, id), on ? 1 : 0);
  }
  setAll(on: boolean): void {
    for (const d of this.defs) this.setOn(d.id, on);
  }
  restoreDefaults(): void {
    for (const d of this.defs) {
      this.vars.set(vn(G1K.vspeedKt, d.id), d.defaultKt);
      this.vars.set(vn(G1K.vspeedMod, d.id), 0);
      this.vars.set(vn(G1K.vspeedOn, d.id), 0);
    }
  }
}

// ------------------------------------------------------------------ timer

/**
 * Generic timer (PG §2.2): HH:MM:SS preset, Up / Dn, Start? -> Stop? ->
 * Reset?. A count-down reaching zero continues counting up (and raises the
 * TIMER EXPIRD message); reset returns to the preset (down) or zero (up).
 */
export class GenericTimer {
  /** Set true for one update when a count-down reaches zero (TIMER EXPIRD). */
  expired = false;
  constructor(private readonly vars: SimVars) {
    if (!vars.has(G1K.timerDir)) vars.set(G1K.timerDir, 1);
  }
  get seconds(): number {
    return this.vars.get(G1K.timerS);
  }
  get running(): boolean {
    return this.vars.get(G1K.timerRunning) >= 0.5;
  }
  get countingDown(): boolean {
    return this.vars.get(G1K.timerDir) < 0;
  }
  /** Prompt shown in the window: 'Start?', 'Stop?' or 'Reset?'. */
  get prompt(): 'Start?' | 'Stop?' | 'Reset?' {
    if (this.running) return 'Stop?';
    const s = this.seconds;
    const idle = this.countingDown ? Math.abs(s - this.vars.get(G1K.timerPreset)) < 0.5 : s < 0.5;
    return idle ? 'Start?' : 'Reset?';
  }
  /** ENT on the Start? / Stop? / Reset? field. */
  promptAction(): void {
    const p = this.prompt;
    if (p === 'Start?') this.start();
    else if (p === 'Stop?') this.stop();
    else this.reset();
  }
  start(): void {
    this.vars.set(G1K.timerRunning, 1);
  }
  stop(): void {
    this.vars.set(G1K.timerRunning, 0);
  }
  reset(): void {
    this.stop();
    this.vars.set(G1K.timerS, this.countingDown ? this.vars.get(G1K.timerPreset) : 0);
  }
  setDirection(down: boolean): void {
    this.vars.set(G1K.timerDir, down ? -1 : 1);
    if (!this.running) this.vars.set(G1K.timerS, down ? this.vars.get(G1K.timerPreset) : 0);
  }
  /** Sets the preset (HH:MM:SS as seconds, max 23:59:59). */
  setPreset(seconds: number): void {
    const s = Math.max(0, Math.min(23 * 3600 + 59 * 60 + 59, Math.round(seconds)));
    this.vars.set(G1K.timerPreset, s);
    if (!this.running) this.vars.set(G1K.timerS, s);
  }
  update(dt: number): void {
    this.expired = false;
    if (!this.running) return;
    let s = this.seconds;
    if (this.countingDown) {
      s -= dt;
      if (s <= 0) {
        s = -s;
        this.vars.set(G1K.timerDir, 1);
        this.expired = true;
      }
    } else s += dt;
    this.vars.set(G1K.timerS, s);
  }
}

// ------------------------------------------------------------------ minimums

const MINS_FT = vn(AP.minimums, 1);
const MINS_RA = vn(AP.minimumsIsRadio, 1);

/**
 * MDA/DH minimums (PG §2.4): OFF / BARO / TEMP COMP, 0..16,000 ft, temp
 * -59..+59 C; reset to OFF when the approach is deleted, another approach is
 * loaded, or the system power is cycled. Publishes `ap.mins1_ft` (NaN = off)
 * and `ap.mins1_is_ra` = 0 (no radio altimeter in the NXi 172).
 */
export class Minimums {
  destElevFt = 0;
  constructor(private readonly vars: SimVars) {}
  get mode(): number {
    return this.vars.get(G1K.minsMode);
  }
  get valueFt(): number {
    return this.vars.get(G1K.minsFt);
  }
  get tempC(): number {
    return this.vars.get(G1K.minsTempC, 15);
  }
  setMode(m: number): void {
    this.vars.set(G1K.minsMode, m);
    this.publish();
  }
  setValue(ft: number): void {
    this.vars.set(G1K.minsFt, Math.max(0, Math.min(16000, Math.round(ft / 10) * 10)));
    this.publish();
  }
  setTemp(c: number): void {
    this.vars.set(G1K.minsTempC, Math.max(-59, Math.min(59, Math.round(c))));
    this.publish();
  }
  reset(): void {
    this.vars.set(G1K.minsMode, MINS_MODE.off);
    this.publish();
  }
  /** Altitude used for alerting (ft), NaN when off. TEMP COMP adds the cold-temperature correction (COMP MIN). */
  effectiveFt(): number {
    const m = this.mode;
    if (m === MINS_MODE.off) return NaN;
    const v = this.valueFt;
    if (m === MINS_MODE.tempComp) return Math.round(v + tempCompCorrectionFt(v, this.destElevFt, this.tempC));
    return v;
  }
  publish(): void {
    this.vars.set(MINS_FT, this.effectiveFt());
    this.vars.set(MINS_RA, 0);
  }
}
