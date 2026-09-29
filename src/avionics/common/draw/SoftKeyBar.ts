/**
 * Soft-key label bar along the bottom (or side) of a display: Garmin
 * G1000 PFD/MFD (12 keys under the screen), G3000/G5000 bezel keys, Primus
 * Epic bezel line keys. The bar only renders labels and states; the
 * physical bezel buttons are cockpit controls that call `press(i)` and read
 * the returned label.
 *
 * Garmin conventions (G1000 PG 190-00494-04 §1 "Softkey Function"): white
 * text on black; a selected (on) softkey shows black text on a gray
 * background until turned off; momentary keys (CDI, IDENT, TMR/REF, NRST,
 * MSG) flash black-on-gray when pressed; MSG stays black on white while
 * messages remain ('highlight'). Unavailable functions are subdued grey.
 */
import { GARMIN_TYPEFACE, type Typeface } from '../fonts';
import { GARMIN_PALETTE, type AvionicsPalette } from '../palette';
import { box, line, type Ctx2D } from './context';

export type SoftKeyState = 'normal' | 'active' | 'highlight' | 'disabled' | 'blank';

export interface SoftKey {
  label: string;
  state: SoftKeyState;
  /** Optional small status text under the label (e.g. 'ON', 'OFF'). */
  status: string;
}

export interface SoftKeyStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  fontSize: number;
  background: string;
  separator: string;
  /** Duration (s) of the pressed highlight after `press()`. */
  pressFlashS: number;
}

export const SOFTKEYS_GARMIN: SoftKeyStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  fontSize: 15,
  background: '#000000',
  separator: '#5a5d61',
  pressFlashS: 0.15,
};

export interface SoftKeyBarOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
  style: SoftKeyStyle;
  orientation?: 'horizontal' | 'vertical';
}

export class SoftKeyBar {
  readonly keys: SoftKey[] = [];
  x: number;
  y: number;
  w: number;
  h: number;
  style: SoftKeyStyle;
  orientation: 'horizontal' | 'vertical';
  private pressedIndex = -1;
  private pressedLeft = 0;

  constructor(opts: SoftKeyBarOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.w = opts.w;
    this.h = opts.h;
    this.style = opts.style;
    this.orientation = opts.orientation ?? 'horizontal';
    for (let i = 0; i < opts.count; i++) this.keys.push({ label: '', state: 'blank', status: '' });
  }

  /** Sets one key. An empty label makes the key blank. */
  setKey(i: number, label: string, state: SoftKeyState = 'normal', status = ''): void {
    const k = this.keys[i];
    if (!k) return;
    k.label = label;
    k.state = label ? state : 'blank';
    k.status = status;
  }

  /** Sets all keys from a label list ('' = blank). */
  setLabels(labels: readonly string[]): void {
    for (let i = 0; i < this.keys.length; i++) this.setKey(i, labels[i] ?? '', 'normal');
  }

  /**
   * Bezel key pressed: flashes the key and returns its label (or '' when
   * blank/disabled, so callers can ignore dead keys).
   */
  press(i: number): string {
    const k = this.keys[i];
    if (!k || k.state === 'blank' || k.state === 'disabled') return '';
    this.pressedIndex = i;
    this.pressedLeft = this.style.pressFlashS;
    return k.label;
  }

  /** Index of the key under a point (touch displays), -1 if none. */
  keyAt(px: number, py: number): number {
    if (px < this.x || py < this.y || px > this.x + this.w || py > this.y + this.h) return -1;
    const n = this.keys.length;
    return this.orientation === 'horizontal' ? Math.min(n - 1, Math.floor(((px - this.x) / this.w) * n)) : Math.min(n - 1, Math.floor(((py - this.y) / this.h) * n));
  }

  /** True while a press highlight is showing. */
  get animating(): boolean {
    return this.pressedLeft > 0;
  }

  update(dt: number): void {
    if (this.pressedLeft > 0) this.pressedLeft -= dt;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const n = this.keys.length;
    const hor = this.orientation === 'horizontal';
    const kw = hor ? this.w / n : this.w;
    const kh = hor ? this.h : this.h / n;
    box(ctx, this.x, this.y, this.w, this.h, st.background, '');
    for (let i = 0; i < n; i++) {
      const k = this.keys[i];
      const kx = hor ? this.x + i * kw : this.x;
      const ky = hor ? this.y : this.y + i * kh;
      if (i > 0) {
        if (hor) line(ctx, kx, ky + 3, kx, ky + kh - 3, st.separator, 1);
        else line(ctx, kx + 3, ky, kx + kw - 3, ky, st.separator, 1);
      }
      if (k.state === 'blank') continue;
      const pressed = i === this.pressedIndex && this.pressedLeft > 0;
      const active = k.state === 'active' || k.state === 'highlight';
      if (active || pressed) box(ctx, kx + 3, ky + 3, kw - 6, kh - 6, k.state === 'highlight' && !pressed ? p.white : p.softKeyActive, '');
      const color = active || pressed ? p.black : k.state === 'disabled' ? p.softKeyDisabled : p.softKeyText;
      const cy = k.status ? ky + kh * 0.38 : ky + kh / 2 + 1;
      st.typeface.draw(ctx, k.label, kx + kw / 2, cy, st.fontSize, color, 'center', 'middle');
      if (k.status) st.typeface.draw(ctx, k.status, kx + kw / 2, ky + kh * 0.75, st.fontSize * 0.8, active ? p.black : p.cyan, 'center', 'middle');
    }
  }
}
