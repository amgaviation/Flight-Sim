/**
 * Vector stroke font for Boeing-style displays.
 *
 * The 737NG Common Display System draws its characters as uniform-width
 * luminous strokes (a heritage of the calligraphic CRT symbol generators of
 * the 737-300/400 EFIS). No such font ships with Windows or Linux, so this
 * is a compact single-stroke glyph set designed on a 4 x 6 grid (width x
 * cap height, y up from the baseline). It renders crisply at any size,
 * costs one `stroke()` per string and needs no font files (bundle-free).
 *
 * Glyph shapes are original (EST: proportions approximate the CDS font as
 * seen in the 737NG FCOM display figures: narrow, square-shouldered,
 * unslashed zero).
 */
import type { Ctx2D } from './draw/context';

/** Polylines [x0, y0, x1, y1, ...] in glyph units (x 0..4, y 0..6, up). */
type Glyph = readonly (readonly number[])[];

const O_RING = [1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0];

const GLYPHS: Record<string, Glyph> = {
  '0': [O_RING],
  '1': [[1, 5, 2, 6, 2, 0], [1, 0, 3, 0]],
  '2': [[0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 0, 0, 4, 0]],
  '3': [[0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1], [1.5, 3, 3, 3]],
  '4': [[3, 0, 3, 6, 0, 2, 4, 2]],
  '5': [[4, 6, 0, 6, 0, 3.5, 3, 3.5, 4, 2.5, 4, 1, 3, 0, 1, 0, 0, 1]],
  '6': [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2.5, 3, 3.5, 0, 3.5]],
  '7': [[0, 6, 4, 6, 1.5, 0]],
  '8': [[1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3]],
  '9': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 3.5, 1, 2.5, 4, 2.5]],
  A: [[0, 0, 0, 4, 2, 6, 4, 4, 4, 0], [0, 2.5, 4, 2.5]],
  B: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3], [3, 3, 4, 2, 4, 1, 3, 0, 0, 0]],
  C: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1]],
  D: [[0, 0, 0, 6, 2.5, 6, 4, 4.5, 4, 1.5, 2.5, 0, 0, 0]],
  E: [[4, 6, 0, 6, 0, 0, 4, 0], [0, 3, 3, 3]],
  F: [[4, 6, 0, 6, 0, 0], [0, 3, 3, 3]],
  G: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 3, 2.5, 3]],
  H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  I: [[1, 6, 3, 6], [2, 6, 2, 0], [1, 0, 3, 0]],
  J: [[4, 6, 4, 1, 3, 0, 1, 0, 0, 1]],
  K: [[0, 0, 0, 6], [4, 6, 0, 2], [1.3, 3.3, 4, 0]],
  L: [[0, 6, 0, 0, 4, 0]],
  M: [[0, 0, 0, 6, 2, 3, 4, 6, 4, 0]],
  N: [[0, 0, 0, 6, 4, 0, 4, 6]],
  O: [O_RING],
  P: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]],
  Q: [O_RING, [2.5, 1.5, 4.2, -0.3]],
  R: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3], [2, 3, 4, 0]],
  S: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 4, 1, 3, 3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1]],
  T: [[0, 6, 4, 6], [2, 6, 2, 0]],
  U: [[0, 6, 0, 1, 1, 0, 3, 0, 4, 1, 4, 6]],
  V: [[0, 6, 2, 0, 4, 6]],
  W: [[0, 6, 1, 0, 2, 4, 3, 0, 4, 6]],
  X: [[0, 0, 4, 6], [0, 6, 4, 0]],
  Y: [[0, 6, 2, 3, 4, 6], [2, 3, 2, 0]],
  Z: [[0, 6, 4, 6, 0, 0, 4, 0]],
  '.': [[1.7, 0, 2.3, 0, 2.3, 0.6, 1.7, 0.6, 1.7, 0]],
  ',': [[2.3, 0.6, 2.3, 0, 1.5, -1]],
  ':': [[1.7, 1, 2.3, 1, 2.3, 1.6, 1.7, 1.6, 1.7, 1], [1.7, 4, 2.3, 4, 2.3, 4.6, 1.7, 4.6, 1.7, 4]],
  '-': [[0.5, 3, 3.5, 3]],
  '+': [[0.5, 3, 3.5, 3], [2, 1.5, 2, 4.5]],
  '=': [[0.5, 2, 3.5, 2], [0.5, 4, 3.5, 4]],
  '/': [[0, 0, 4, 6]],
  '\\': [[0, 6, 4, 0]],
  '(': [[2.8, 6.5, 1.5, 5, 1.5, 1, 2.8, -0.5]],
  ')': [[1.2, 6.5, 2.5, 5, 2.5, 1, 1.2, -0.5]],
  '[': [[3, 6.5, 1.5, 6.5, 1.5, -0.5, 3, -0.5]],
  ']': [[1, 6.5, 2.5, 6.5, 2.5, -0.5, 1, -0.5]],
  '<': [[3.5, 5.5, 0.5, 3, 3.5, 0.5]],
  '>': [[0.5, 5.5, 3.5, 3, 0.5, 0.5]],
  '%': [[0, 0, 4, 6], [0.5, 6, 1.5, 6, 1.5, 5, 0.5, 5, 0.5, 6], [2.5, 1, 3.5, 1, 3.5, 0, 2.5, 0, 2.5, 1]],
  '*': [[2, 1, 2, 5], [0.5, 4, 3.5, 2], [0.5, 2, 3.5, 4]],
  '#': [[1.2, 0, 1.2, 6], [2.8, 0, 2.8, 6], [0, 2, 4, 2], [0, 4, 4, 4]],
  "'": [[2, 6, 2, 4.5]],
  '"': [[1.3, 6, 1.3, 4.5], [2.7, 6, 2.7, 4.5]],
  '!': [[2, 6, 2, 2], [1.7, 0, 2.3, 0, 2.3, 0.6, 1.7, 0.6, 1.7, 0]],
  '?': [[0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 2, 2.5, 2, 1.8], [1.7, 0, 2.3, 0, 2.3, 0.6, 1.7, 0.6, 1.7, 0]],
  _: [[0, -0.5, 4, -0.5]],
  '°': [[1.2, 6, 2.8, 6, 2.8, 4.4, 1.2, 4.4, 1.2, 6]],
  '^': [[0.5, 3.5, 2, 6, 3.5, 3.5]],
  // Arrows (used on NDs and CDUs).
  '↑': [[2, 0, 2, 6], [0.5, 4.5, 2, 6, 3.5, 4.5]],
  '↓': [[2, 6, 2, 0], [0.5, 1.5, 2, 0, 3.5, 1.5]],
  '←': [[4, 3, 0, 3], [1.5, 4.5, 0, 3, 1.5, 1.5]],
  '→': [[0, 3, 4, 3], [2.5, 4.5, 4, 3, 2.5, 1.5]],
  '△': [[0, 0.5, 2, 5.5, 4, 0.5, 0, 0.5]],
  '□': [[0, 0, 0, 6, 4, 6, 4, 0, 0, 0]],
};

/** Cap height in glyph units. */
const CAP = 6;
/** Advance per character in glyph units (4 wide + 1.4 spacing). */
const ADVANCE = 5.4;

export type TextAlign = 'left' | 'center' | 'right';
export type TextBaseline = 'top' | 'middle' | 'bottom' | 'alphabetic';

/**
 * Stroke font renderer. `size` is the nominal font size in pixels (same
 * meaning as a CSS font size): cap height = 0.72 * size, matching typical
 * sans-serif metrics so layouts can switch between stroke and canvas fonts.
 */
export class StrokeFont {
  /** Stroke width as a fraction of the cap height. */
  weight: number;

  constructor(weight = 0.13) {
    this.weight = weight;
  }

  /** Width of `text` in pixels at `size`. */
  width(text: string, size: number): number {
    const s = (size * 0.72) / CAP;
    return text.length > 0 ? (text.length * ADVANCE - 1.4) * s : 0;
  }

  /** Whether the font has a glyph for `ch` (lower case maps to upper case). */
  has(ch: string): boolean {
    return ch === ' ' || GLYPHS[ch] !== undefined || GLYPHS[ch.toUpperCase()] !== undefined;
  }

  /**
   * Appends the glyph paths of `text` to the current path (no stroke).
   * Useful to stroke several strings in one call.
   */
  path(ctx: Ctx2D, text: string, x: number, y: number, size: number, align: TextAlign = 'left', baseline: TextBaseline = 'alphabetic', slant = 0): void {
    const s = (size * 0.72) / CAP;
    let x0 = x;
    if (align !== 'left') {
      const w = this.width(text, size);
      x0 -= align === 'center' ? w / 2 : w;
    }
    let yb = y; // baseline (canvas y grows downward)
    if (baseline === 'top') yb = y + CAP * s;
    else if (baseline === 'middle') yb = y + (CAP * s) / 2;
    else if (baseline === 'bottom') yb = y + 0.1 * CAP * s;
    for (let i = 0; i < text.length; i++) {
      let g = GLYPHS[text[i]];
      if (g === undefined) {
        const up = text[i].toUpperCase();
        g = GLYPHS[up];
      }
      if (g !== undefined) {
        const ox = x0 + i * ADVANCE * s;
        for (const line of g) {
          for (let k = 0; k < line.length; k += 2) {
            const gy = line[k + 1];
            const px = ox + (line[k] + gy * slant) * s;
            const py = yb - gy * s;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        }
      }
    }
  }

  /** Strokes `text` in `color`. */
  draw(ctx: Ctx2D, text: string, x: number, y: number, size: number, color: string, align: TextAlign = 'left', baseline: TextBaseline = 'alphabetic'): void {
    ctx.beginPath();
    this.path(ctx, text, x, y, size, align, baseline);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * 0.72 * this.weight);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/** Shared default instance. */
export const STROKE_FONT = new StrokeFont();
