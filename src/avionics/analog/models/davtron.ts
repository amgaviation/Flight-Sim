/**
 * Davtron M803 clock / OAT / voltmeter logic, exactly as operated per the
 * Cessna 172S POH Supplement 9 "Digital Clock/O.A.T." (Davtron Model 803):
 *
 *  - Upper window: voltage ("E" suffix, selected at power-up), then OAT F,
 *    OAT C; the upper button sequences volts -> F -> C -> volts.
 *  - Lower window: SELECT sequences UT -> LT -> FT -> ET -> UT; CONTROL does
 *    the timing functions of the selected mode.
 *  - Test: hold SELECT 3 s -> "88:88" and all four annunciators.
 *  - Set UT: in UT press SELECT+CONTROL together -> tens-of-hours digit
 *    flashes; CONTROL increments the flashing digit, SELECT moves to the next
 *    digit; after the last digit SELECT exits. The mode annunciator flashes
 *    while the clock runs normally.
 *  - Set LT: as UT but minutes are synchronised with UT (hours only).
 *  - FT reset: in FT hold CONTROL 3 s (display shows 99:59) -> zeroed on release.
 *  - FT alarm: in FT, SELECT+CONTROL sets an alarm time; when flight time
 *    reaches it the display flashes; SELECT or CONTROL stops the flashing and
 *    zeros the alarm (flight time continues).
 *  - ET count-up: in ET, CONTROL starts; counts MM:SS to 59:59 then HH:MM to
 *    99:59; CONTROL again resets to zero.
 *  - ET count-down: in ET, SELECT+CONTROL sets MM:SS (max 59:59); SELECT
 *    exits; CONTROL starts; at zero the display flashes (SELECT/CONTROL
 *    resets the alarm) and ET then counts up.
 *  - Buttons are disabled without airplane power.
 *
 * SCOPE: flight time counts whenever the unit is powered unless the owner
 * supplies a `flightTimeRunning` input (the M803 can be wired to an
 * airspeed/oil-pressure switch); the display blanks without airplane power
 * while the internal battery keeps UT/LT/FT/ET running (EST).
 */

export type DavtronUpper = 'volts' | 'F' | 'C';
export type DavtronMode = 'UT' | 'LT' | 'FT' | 'ET';

const MODES: readonly DavtronMode[] = ['UT', 'LT', 'FT', 'ET'];
const DAY = 86400;
const TEST_HOLD_S = 3;
const FT_RESET_HOLD_S = 3;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export class DavtronM803 {
  upper: DavtronUpper = 'volts';
  mode: DavtronMode = 'UT';
  /** Universal time, seconds of day. */
  utcS = 0;
  /** Local time offset from UT (whole hours, -12..+14). */
  localOffsetH = 0;
  flightTimeS = 0;
  /** Flight-time alarm (s), NaN = none. */
  ftAlarmS = NaN;
  etS = 0;
  etRunning = false;
  /** Count-down target set (s); when > 0 and running, ET counts down. */
  etCountdown = false;
  /** Display flashing because an alarm fired (FT alarm / ET countdown zero). */
  alarm = false;
  /** Which timer raised `alarm`. */
  alarmSource: 'FT' | 'ET' | '' = '';
  /** Set mode: digit index 0..3 of HH:MM (or MM:SS for ET), -1 = not setting. */
  setDigit = -1;
  /** Digits being edited in set mode. */
  readonly setValue = [0, 0, 0, 0];
  powered = false;
  volts = 0;
  oatC = 0;
  private selectHeld = false;
  private controlHeld = false;
  private selectHoldS = 0;
  private controlHoldS = 0;
  private testActive = false;
  private ftResetArmed = false;
  private blinkT = 0;

  /** Initialises the clock time (e.g. from the simulator's UTC at aircraft creation). */
  setUtcHours(h: number): void {
    this.utcS = (((h * 3600) % DAY) + DAY) % DAY;
  }

  // ---------------------------------------------------------------- buttons

  /** Upper (OAT/VOLTS) button. */
  pressUpper(): void {
    if (!this.powered) return;
    this.upper = this.upper === 'volts' ? 'F' : this.upper === 'F' ? 'C' : 'volts';
  }

  pressSelect(): void {
    if (!this.powered) return;
    this.selectHeld = true;
    this.selectHoldS = 0;
    if (this.controlHeld) {
      this.enterSetMode();
      return;
    }
    if (this.alarm) {
      this.clearAlarm();
      return;
    }
    if (this.setDigit >= 0) {
      this.nextDigit();
      return;
    }
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
  }

  releaseSelect(): void {
    this.selectHeld = false;
    this.testActive = false;
  }

  pressControl(): void {
    if (!this.powered) return;
    this.controlHeld = true;
    this.controlHoldS = 0;
    if (this.selectHeld) {
      this.enterSetMode();
      return;
    }
    if (this.alarm) {
      this.clearAlarm();
      return;
    }
    if (this.setDigit >= 0) {
      this.incrementDigit();
      return;
    }
    if (this.mode === 'ET') {
      if (this.etRunning) {
        // "Pressing the CONTROL button again resets elapsed time to zero."
        this.etRunning = false;
        this.etCountdown = false;
        this.etS = 0;
      } else {
        this.etRunning = true;
      }
    }
  }

  releaseControl(): void {
    this.controlHeld = false;
    if (this.ftResetArmed) {
      this.flightTimeS = 0;
      this.ftResetArmed = false;
    }
  }

  /** Both buttons pressed together (simulator mapping for a simultaneous press). */
  pressBoth(): void {
    if (!this.powered) return;
    this.enterSetMode();
  }

  // ---------------------------------------------------------------- time

  update(dt: number, powered: boolean, volts: number, oatC: number, flightTimeRunning = true): void {
    this.powered = powered;
    this.volts = volts;
    this.oatC = oatC;
    this.blinkT += dt;
    if (!powered) {
      this.selectHeld = false;
      this.controlHeld = false;
      this.testActive = false;
      this.ftResetArmed = false;
    }
    this.utcS = (this.utcS + dt) % DAY;
    if (flightTimeRunning && powered) {
      this.flightTimeS = Math.min(this.flightTimeS + dt, 99 * 3600 + 59 * 60);
      if (Number.isFinite(this.ftAlarmS) && this.ftAlarmS > 0 && this.flightTimeS >= this.ftAlarmS && this.flightTimeS - dt < this.ftAlarmS) {
        this.alarm = true;
        this.alarmSource = 'FT';
      }
    }
    if (this.etRunning) {
      if (this.etCountdown) {
        this.etS -= dt;
        if (this.etS <= 0) {
          this.etS = -this.etS;
          this.etCountdown = false; // counts up after reaching zero
          this.alarm = true;
          this.alarmSource = 'ET';
        }
      } else {
        this.etS = Math.min(this.etS + dt, 99 * 3600 + 59 * 60);
      }
    }
    if (this.selectHeld && this.setDigit < 0) {
      this.selectHoldS += dt;
      if (this.selectHoldS >= TEST_HOLD_S) this.testActive = true;
    }
    if (this.controlHeld && this.mode === 'FT' && this.setDigit < 0) {
      this.controlHoldS += dt;
      if (this.controlHoldS >= FT_RESET_HOLD_S) this.ftResetArmed = true;
    }
  }

  // ---------------------------------------------------------------- display

  /** True while the display flashes (alarm) — callers blank the lower window on the dark phase. */
  get flashing(): boolean {
    return this.alarm;
  }

  /** Blink phase for flashing digits/annunciators (2 Hz, EST). */
  get blinkPhase(): boolean {
    return this.blinkT * 2 - Math.floor(this.blinkT * 2) < 0.5;
  }

  get testing(): boolean {
    return this.testActive;
  }

  /** Upper window text, e.g. "28.2E", " 72F", "-12C". Empty when unpowered. */
  upperText(): string {
    if (!this.powered) return '';
    if (this.testActive) return '88.8E';
    if (this.upper === 'volts') return `${this.volts.toFixed(1)}E`;
    const t = this.upper === 'F' ? this.oatC * 1.8 + 32 : this.oatC;
    return `${Math.round(t)}${this.upper}`;
  }

  /** Lower window text "HH:MM" / "MM:SS". Empty when unpowered. */
  lowerText(): string {
    if (!this.powered) return '';
    if (this.testActive) return '88:88';
    if (this.ftResetArmed) return '99:59';
    if (this.setDigit >= 0) {
      const v = this.setValue;
      return `${v[0]}${v[1]}:${v[2]}${v[3]}`;
    }
    switch (this.mode) {
      case 'UT':
        return this.hhmm(this.utcS);
      case 'LT':
        return this.hhmm((((this.utcS + this.localOffsetH * 3600) % DAY) + DAY) % DAY);
      case 'FT':
        return this.hhmm(this.flightTimeS);
      case 'ET':
        return this.etS < 3600 ? this.mmss(this.etS) : this.hhmm(this.etS);
    }
  }

  /** Index 0..3 of the digit flashing in set mode (-1 none). */
  get flashingDigit(): number {
    return this.setDigit;
  }

  /** Which annunciators are lit (all during test). */
  annunciatorLit(m: DavtronMode): boolean {
    if (!this.powered) return false;
    if (this.testActive) return true;
    return this.mode === m;
  }

  // ---------------------------------------------------------------- set mode

  private enterSetMode(): void {
    if (this.setDigit >= 0) return;
    const v = this.setValue;
    let s: number;
    if (this.mode === 'UT') s = this.utcS;
    else if (this.mode === 'LT') s = (((this.utcS + this.localOffsetH * 3600) % DAY) + DAY) % DAY;
    else if (this.mode === 'FT') s = Number.isFinite(this.ftAlarmS) ? this.ftAlarmS : 0;
    else s = 0; // ET count-down entry starts from 00:00
    const hhmm = this.mode === 'ET' ? [Math.floor(s / 60), Math.floor(s % 60)] : [Math.floor(s / 3600), Math.floor((s % 3600) / 60)];
    v[0] = Math.floor(hhmm[0] / 10);
    v[1] = hhmm[0] % 10;
    v[2] = Math.floor(hhmm[1] / 10);
    v[3] = hhmm[1] % 10;
    this.setDigit = 0;
    this.selectHeld = false;
    this.controlHeld = false;
  }

  private digitLimit(i: number): number {
    const v = this.setValue;
    if (this.mode === 'ET') return i === 0 || i === 2 ? 5 : 9; // MM:SS up to 59:59
    if (this.mode === 'FT') return i === 2 ? 5 : 9; // alarm HH:MM up to 99:59
    if (i === 0) return 2;
    if (i === 1) return v[0] === 2 ? 3 : 9;
    return i === 2 ? 5 : 9;
  }

  private incrementDigit(): void {
    const i = this.setDigit;
    // LT: minutes follow UT and cannot be set.
    if (this.mode === 'LT' && i >= 2) return;
    const lim = this.digitLimit(i);
    this.setValue[i] = this.setValue[i] >= lim ? 0 : this.setValue[i] + 1;
    if (this.mode !== 'ET' && this.mode !== 'FT' && i === 0 && this.setValue[0] === 2 && this.setValue[1] > 3) this.setValue[1] = 3;
  }

  private nextDigit(): void {
    const last = this.mode === 'LT' ? 1 : 3;
    if (this.setDigit < last) {
      this.setDigit++;
      return;
    }
    this.commitSet();
  }

  private commitSet(): void {
    const v = this.setValue;
    const a = v[0] * 10 + v[1];
    const b = v[2] * 10 + v[3];
    switch (this.mode) {
      case 'UT':
        this.utcS = a * 3600 + b * 60;
        break;
      case 'LT': {
        const utH = Math.floor(this.utcS / 3600);
        let off = a - utH;
        if (off > 14) off -= 24;
        if (off < -12) off += 24;
        this.localOffsetH = off;
        break;
      }
      case 'FT':
        this.ftAlarmS = a * 3600 + b * 60;
        if (this.ftAlarmS === 0) this.ftAlarmS = NaN;
        break;
      case 'ET':
        this.etS = a * 60 + b;
        this.etCountdown = this.etS > 0;
        this.etRunning = false;
        break;
    }
    this.setDigit = -1;
  }

  private clearAlarm(): void {
    // FT: "turn the flashing off and zero the alarm time"; ET: "reset the alarm".
    if (this.alarmSource === 'FT') this.ftAlarmS = NaN;
    this.alarm = false;
    this.alarmSource = '';
  }

  private hhmm(s: number): string {
    const h = Math.floor(s / 3600) % 100;
    const m = Math.floor((s % 3600) / 60);
    return `${pad2(h)}:${pad2(m)}`;
  }

  private mmss(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${pad2(m)}:${pad2(sec)}`;
  }
}
