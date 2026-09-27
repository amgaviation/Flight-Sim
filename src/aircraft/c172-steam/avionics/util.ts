/**
 * Small helpers shared by the Bendix/King unit logic: button edge/hold tracking, encoder event
 * subscriptions and frequency channel arithmetic. Nothing here allocates per update.
 */
import type { EventBus } from '../../../core/EventBus';
import type { SimVars } from '../../../core/SimVars';

/** Momentary button var: rising/falling edges and hold time. */
export class Button {
  private prev = false;
  /** Seconds the button has been held (0 when released). */
  held = 0;
  /** True on the update where the button was pressed / released. */
  pressed = false;
  released = false;
  /** Hold time at the moment of release (s). */
  releasedAfter = 0;
  /** Set once a long-press action fired during the current press (so the release is not also a short press). */
  longFired = false;
  constructor(
    private readonly vars: SimVars,
    readonly name: string,
  ) {}
  update(dt: number): void {
    const on = this.vars.get(this.name) > 0.5;
    this.pressed = on && !this.prev;
    this.released = !on && this.prev;
    if (this.pressed) this.longFired = false;
    if (this.released) this.releasedAfter = this.held;
    this.held = on ? this.held + dt : 0;
    this.prev = on;
  }
  get down(): boolean {
    return this.prev;
  }
  /** Short press: released before `longS` and no long action fired. */
  shortRelease(longS: number): boolean {
    return this.released && !this.longFired && this.releasedAfter < longS;
  }
  /** Fires once when held past `longS`. */
  long(longS: number): boolean {
    if (this.prev && !this.longFired && this.held >= longS) {
      this.longFired = true;
      return true;
    }
    return false;
  }
  reset(): void {
    this.prev = this.vars.get(this.name) > 0.5;
    this.held = 0;
    this.pressed = this.released = false;
    this.longFired = true;
  }
}

/**
 * Subscribes to a rotary encoder emitted by a cockpit RotaryKnob channel (`<base>.inc` /
 * `<base>.dec`, payload = click count). `fn(steps)` gets + clockwise.
 */
export function onEncoder(events: EventBus | undefined, base: string, fn: (steps: number) => void, offs: (() => void)[]): void {
  if (!events) return;
  const n = (p: unknown): number => (typeof p === 'number' && p > 0 ? p : 1);
  offs.push(events.on(`${base}.inc`, (p) => fn(n(p))));
  offs.push(events.on(`${base}.dec`, (p) => fn(-n(p))));
}

/** Subscribes to a one-shot event. */
export function onEvent(events: EventBus | undefined, name: string, fn: () => void, offs: (() => void)[]): void {
  if (events) offs.push(events.on(name, () => fn()));
}

/** Wraps `x` into [lo, hi] (inclusive integer range). */
export function wrapInt(x: number, lo: number, hi: number): number {
  const n = hi - lo + 1;
  return lo + ((((x - lo) % n) + n) % n);
}

/**
 * Frequency held as integer kHz. `mhzStep` changes the MHz part with wrap in [loMhz, hiMhz];
 * the kHz part is kept (Supplement 1: "Exceeding the upper limit of frequency band will
 * automatically return to the lower limit and vice versa").
 */
export function stepMhz(khz: number, steps: number, loMhz: number, hiMhz: number): number {
  const mhz = Math.floor(khz / 1000);
  const frac = khz - mhz * 1000;
  return wrapInt(mhz + steps, loMhz, hiMhz) * 1000 + frac;
}

/** Changes the kHz part in `stepKhz` increments without carrying into the MHz digits. */
export function stepKhz(khz: number, steps: number, stepKhz: number): number {
  const mhz = Math.floor(khz / 1000);
  const frac = khz - mhz * 1000;
  const n = Math.round(1000 / stepKhz);
  const idx = wrapInt(Math.round(frac / stepKhz) + steps, 0, n - 1);
  return mhz * 1000 + idx * stepKhz;
}

/** mm:ss (or hh:mm) with two-digit fields, allocation per call (display code, change-throttled). */
export function clock2(a: number, b: number): string {
  return `${a < 10 ? '0' : ''}${a}:${b < 10 ? '0' : ''}${b}`;
}
