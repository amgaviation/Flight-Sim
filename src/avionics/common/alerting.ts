/**
 * Display-side alerting state machines shared by every avionics family:
 * selected-altitude alerting, MDA/DH minimums alerting and gauge
 * exceedance colouring. Pure logic (no drawing), allocation-free, unit
 * tested in tests/avionics/alerting.test.ts.
 */
import { blinkOn } from './dynamics';

// ------------------------------------------------------------------ altitude alerter

/** Thresholds for `AltitudeAlerter` (feet). */
export interface AltitudeAlertConfig {
  /** Distance to the selected altitude at which the "approaching" alert fires. */
  approachFt: number;
  /** Distance at which the "near" (within) cue shows. */
  nearFt: number;
  /** Error that counts as having reached the selected altitude. */
  captureFt: number;
  /** Deviation from a captured altitude that raises the deviation alert. */
  deviationFt: number;
  /** Flash duration (s) for each cue; 0 = steady. */
  flashS: number;
  /** Also flash (not only change colour) on the near cue. */
  flashNear: boolean;
}

/**
 * Garmin G1000/G3000/G5000: 1000 ft approach (cyan box, flash 5 s, tone),
 * within 200 ft (cyan text, flash 5 s), deviation +/-200 ft after capture
 * (yellow, flash 5 s, tone). G1000 Pilot's Guide 190-00494-04 §2.1
 * "Altitude Alerting".
 */
export const ALT_ALERT_GARMIN: AltitudeAlertConfig = {
  approachFt: 1000,
  nearFt: 200,
  captureFt: 50, // EST: "after reaching the Selected Altitude"
  deviationFt: 200,
  flashS: 5,
  flashNear: true,
};

/**
 * Boeing 737NG: white box 900..300 ft before the MCP altitude, amber
 * flashing box on a deviation of more than 300 ft (EST: 737NG FCOM 10.10
 * "Altitude Alert" as commonly described; the FCOM extract available states
 * only "appears steady for altitude acquisition, flashes during deviation").
 */
export const ALT_ALERT_BOEING: AltitudeAlertConfig = {
  approachFt: 900,
  nearFt: 300,
  captureFt: 300,
  deviationFt: 300,
  flashS: 0,
  flashNear: false,
};

/**
 * Honeywell Primus Epic / Collins Pro Line Fusion. EST: no public pilot
 * guide excerpt was available; 1000 ft pre-alert and a 200 ft deviation
 * band are the thresholds shared by the Garmin and most Part 25 alerters,
 * with a 250 ft "near" cue and no flashing on the near cue.
 */
export const ALT_ALERT_HONEYWELL: AltitudeAlertConfig = {
  approachFt: 1000,
  nearFt: 250,
  captureFt: 50,
  deviationFt: 200,
  flashS: 5,
  flashNear: false,
};

export type AltitudeAlertPhase = 'idle' | 'approaching' | 'near' | 'captured' | 'deviation';

/**
 * Selected-altitude alerting. Call `update` every display frame with the
 * indicated altitude and the selected altitude. Outputs:
 *  - `phase`: current cue (drawers map it to colours per vendor),
 *  - `flashing` / `visible`: blink state of the selected-altitude box,
 *  - `consumeAural()`: true once per aural tone trigger (approach, deviation).
 * Changing the selected altitude resets the alerter (G1000 PG: "Whenever
 * the Selected Altitude is changed, Altitude Alerting is reset").
 */
export class AltitudeAlerter {
  cfg: AltitudeAlertConfig;
  phase: AltitudeAlertPhase = 'idle';
  private selected = NaN;
  private flashLeft = 0;
  private t = 0;
  private aural = false;

  constructor(cfg: AltitudeAlertConfig = ALT_ALERT_GARMIN) {
    this.cfg = cfg;
  }

  update(altFt: number, selectedFt: number, dt: number): void {
    this.t += dt;
    if (this.flashLeft > 0) this.flashLeft -= dt;
    const c = this.cfg;
    const err = Math.abs(altFt - selectedFt);
    if (selectedFt !== this.selected) {
      this.selected = selectedFt;
      this.flashLeft = 0;
      // Re-initialise without cues from where the aircraft already is.
      this.phase = err <= c.captureFt ? 'captured' : err < c.nearFt ? 'near' : err < c.approachFt ? 'approaching' : 'idle';
      return;
    }
    switch (this.phase) {
      case 'idle':
        if (err <= c.captureFt) this.enter('captured', false, false);
        else if (err < c.nearFt) this.enter('near', c.flashNear, false);
        else if (err < c.approachFt) this.enter('approaching', true, true);
        break;
      case 'approaching':
        if (err <= c.captureFt) this.enter('captured', false, false);
        else if (err < c.nearFt) this.enter('near', c.flashNear, false);
        else if (err >= c.approachFt) this.phase = 'idle';
        break;
      case 'near':
        if (err <= c.captureFt) this.enter('captured', false, false);
        else if (err >= c.approachFt) this.phase = 'idle';
        else if (err >= c.nearFt) this.phase = 'approaching';
        break;
      case 'captured':
        if (err > c.deviationFt) this.enter('deviation', true, true);
        break;
      case 'deviation':
        if (err <= c.deviationFt) this.enter('captured', false, false);
        break;
    }
  }

  /** True while the flash period of the latest cue is running. */
  get flashing(): boolean {
    return this.flashLeft > 0;
  }

  /** Blink phase: false during the dark half of a flash cycle. */
  get visible(): boolean {
    return this.flashLeft <= 0 || blinkOn(this.t);
  }

  /** Returns true once after each cue that has an aural tone. */
  consumeAural(): boolean {
    const a = this.aural;
    this.aural = false;
    return a;
  }

  reset(): void {
    this.selected = NaN;
    this.phase = 'idle';
    this.flashLeft = 0;
    this.aural = false;
  }

  private enter(p: AltitudeAlertPhase, flash: boolean, aural: boolean): void {
    this.phase = p;
    this.flashLeft = flash ? this.cfg.flashS : 0;
    if (aural) this.aural = true;
  }
}

// ------------------------------------------------------------------ minimums

/** Thresholds for `MinimumsAlerter` (feet above the minimums setting). */
export interface MinimumsConfig {
  /** Readout/bug appears when within this height above minimums (Infinity = always). */
  showWithinFt: number;
  /** "Approaching minimums" cue (Garmin: white within 100 ft; 0 = none). */
  nearFt: number;
  /** Alerting arms only after the aircraft has been this high above minimums (Garmin 150 ft). */
  armAboveFt: number;
  /** After minimums were reached, climbing this far above them resets the alert (Garmin 50, Boeing 75). */
  resetAboveFt: number;
  /** Flash duration when minimums are reached (Boeing 3 s; 0 = steady). */
  flashS: number;
}

/** G1000 PG 190-00494-04 §2.1 "Minimum Descent Altitude/Decision Height Alerting". */
export const MINIMUMS_GARMIN: MinimumsConfig = {
  showWithinFt: 2500,
  nearFt: 100,
  armAboveFt: 150,
  resetAboveFt: 50,
  flashS: 0,
};

/**
 * 737NG FCOM 10.10 "Selected Radio Altitude Approach Minimums": amber and
 * flashing for 3 s when descending through minimums, back to normal at
 * minimums + 75 ft during go-around, at touchdown, or on RST.
 */
export const MINIMUMS_BOEING: MinimumsConfig = {
  showWithinFt: Infinity,
  nearFt: 0,
  armAboveFt: 75, // EST: the reset band doubles as the arming band
  resetAboveFt: 75,
  flashS: 3,
};

/** EST: Primus Epic / Pro Line Fusion "MINIMUMS" cue behaves like the Boeing one without flashing. */
export const MINIMUMS_HONEYWELL: MinimumsConfig = {
  showWithinFt: Infinity,
  nearFt: 100,
  armAboveFt: 100,
  resetAboveFt: 75,
  flashS: 3,
};

export type MinimumsPhase = 'inhibited' | 'hidden' | 'armed' | 'near' | 'reached';

/**
 * MDA/DH alerting. `update(heightFt, minimumsFt, onGround, dt)` where
 * `heightFt` is the baro altitude (BARO minimums) or radio altitude (RA
 * minimums). `phase` drives colours; `consumeAural()` returns true once when
 * minimums are reached ("MINIMUMS").
 */
export class MinimumsAlerter {
  cfg: MinimumsConfig;
  phase: MinimumsPhase = 'inhibited';
  private armed = false;
  private flashLeft = 0;
  private t = 0;
  private aural = false;
  private lastMins = NaN;

  constructor(cfg: MinimumsConfig = MINIMUMS_GARMIN) {
    this.cfg = cfg;
  }

  update(heightFt: number, minimumsFt: number, onGround: boolean, dt: number): void {
    this.t += dt;
    if (this.flashLeft > 0) this.flashLeft -= dt;
    const c = this.cfg;
    if (minimumsFt !== this.lastMins) {
      this.lastMins = minimumsFt;
      this.armed = false;
    }
    const above = heightFt - minimumsFt;
    if (onGround) {
      this.armed = false;
      this.flashLeft = 0;
      this.phase = 'inhibited';
      return;
    }
    if (!this.armed) {
      if (above >= c.armAboveFt) this.armed = true;
    }
    if (this.phase === 'reached') {
      if (above >= c.resetAboveFt) {
        // Climbing away (go-around): alerting disabled until re-armed.
        this.armed = above >= c.armAboveFt;
        this.phase = above > c.showWithinFt ? 'hidden' : 'armed';
      }
      return;
    }
    if (!this.armed) {
      this.phase = above > c.showWithinFt ? 'hidden' : 'inhibited';
      return;
    }
    if (above <= 0) {
      this.phase = 'reached';
      this.flashLeft = c.flashS;
      this.aural = true;
    } else if (above <= c.nearFt) {
      this.phase = 'near';
    } else if (above <= c.showWithinFt) {
      this.phase = 'armed';
    } else {
      this.phase = 'hidden';
    }
  }

  /** Readout/bug should be drawn. */
  get shown(): boolean {
    return this.phase === 'armed' || this.phase === 'near' || this.phase === 'reached' || (this.phase === 'inhibited' && this.cfg.showWithinFt === Infinity);
  }

  get flashing(): boolean {
    return this.flashLeft > 0;
  }

  get visible(): boolean {
    return this.flashLeft <= 0 || blinkOn(this.t);
  }

  consumeAural(): boolean {
    const a = this.aural;
    this.aural = false;
    return a;
  }

  /** Boeing EFIS RST switch: clears a "reached" alert. */
  reset(): void {
    if (this.phase === 'reached') this.phase = 'armed';
    this.armed = false;
    this.flashLeft = 0;
  }
}

// ------------------------------------------------------------------ exceedance

/** Limits for `ExceedanceMonitor`; omit any that do not apply. */
export interface ExceedanceLimits {
  warnLow?: number;
  cautionLow?: number;
  cautionHigh?: number;
  warnHigh?: number;
  /** Hysteresis (value units) before a level is left again. Default 0. */
  hysteresis?: number;
  /** Flash duration when a higher level is entered (s). Infinity = until `acknowledge()`. 0 = never. */
  flashS?: number;
}

/**
 * Engine/system gauge exceedance: level 0 normal, 1 caution (amber/yellow),
 * 2 warning (red). Entering a higher level starts a flash period (Garmin EIS
 * readouts flash when a red line is exceeded — EST duration 5 s).
 */
export class ExceedanceMonitor {
  limits: ExceedanceLimits;
  level: 0 | 1 | 2 = 0;
  /** Highest value seen while in warning (exceedance memory, e.g. EGT). */
  peak = -Infinity;
  private flashLeft = 0;
  private t = 0;

  constructor(limits: ExceedanceLimits) {
    this.limits = limits;
  }

  update(value: number, dt: number): 0 | 1 | 2 {
    this.t += dt;
    if (this.flashLeft > 0 && this.flashLeft !== Infinity) this.flashLeft -= dt;
    const l = this.limits;
    const h = l.hysteresis ?? 0;
    const target = this.classify(value, 0);
    // Only drop a level once the value is back inside by the hysteresis margin.
    let next: 0 | 1 | 2 = target;
    if (target < this.level && this.classify(value, h) >= this.level) next = this.level;
    if (next > this.level) this.flashLeft = l.flashS ?? 5;
    this.level = next;
    if (next === 2) this.peak = Math.max(this.peak, value);
    return next;
  }

  get flashing(): boolean {
    return this.flashLeft > 0;
  }

  get visible(): boolean {
    return this.flashLeft <= 0 || blinkOn(this.t);
  }

  acknowledge(): void {
    this.flashLeft = 0;
  }

  /** Level for `value`, with limits moved inward by `margin` (for hysteresis checks). */
  private classify(value: number, margin: number): 0 | 1 | 2 {
    const l = this.limits;
    if ((l.warnHigh !== undefined && value > l.warnHigh - margin) || (l.warnLow !== undefined && value < l.warnLow + margin)) return 2;
    if ((l.cautionHigh !== undefined && value > l.cautionHigh - margin) || (l.cautionLow !== undefined && value < l.cautionLow + margin)) return 1;
    return 0;
  }
}
