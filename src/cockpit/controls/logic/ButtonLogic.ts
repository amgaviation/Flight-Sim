/**
 * Pure logic for push buttons.
 *
 * Modes:
 *  - 'momentary': value 1 while pressed, 0 when released (e.g. master
 *    caution reset, AP buttons that send an event).
 *  - 'toggle': alternate action; each press flips between values[0] and
 *    values[1] (push-on/push-off Korry switches).
 *  - 'cycle': each press advances through `values` (e.g. AUTO -> ON -> OFF).
 */
export type ButtonMode = 'momentary' | 'toggle' | 'cycle';

export interface ButtonLogicOptions {
  mode?: ButtonMode;
  /** Values for 'toggle' (2 entries) and 'cycle' (>= 2). Default [0, 1]. */
  values?: number[];
  /** Initial index into values. */
  initial?: number;
}

export class ButtonLogic {
  readonly mode: ButtonMode;
  readonly values: readonly number[];
  pressed = false;
  index: number;

  constructor(o: ButtonLogicOptions = {}) {
    this.mode = o.mode ?? 'momentary';
    this.values = o.values ?? [0, 1];
    if (this.values.length < 2) throw new Error('ButtonLogic: at least two values required');
    this.index = Math.max(0, Math.min(this.values.length - 1, o.initial ?? 0));
  }

  /** Current value for the bound var. */
  get value(): number {
    if (this.mode === 'momentary') return this.pressed ? this.values[1] : this.values[0];
    return this.values[this.index];
  }

  /** Press: returns true when the output value changed. */
  press(): boolean {
    if (this.pressed) return false;
    this.pressed = true;
    if (this.mode === 'momentary') return true;
    this.index = (this.index + 1) % (this.mode === 'toggle' ? 2 : this.values.length);
    return true;
  }

  /** Release: returns true when the output value changed. */
  release(): boolean {
    if (!this.pressed) return false;
    this.pressed = false;
    return this.mode === 'momentary';
  }

  /** Follows an external value (latched state reset by a system). */
  sync(v: number): boolean {
    if (this.mode === 'momentary') return false;
    if (this.values[this.index] === v) return false;
    let best = this.index;
    let bestD = Infinity;
    for (let i = 0; i < this.values.length; i++) {
      const d = Math.abs(this.values[i] - v);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best === this.index) return false;
    this.index = best;
    return true;
  }
}
