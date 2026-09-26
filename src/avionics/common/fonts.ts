/**
 * Display typefaces (bundle-free).
 *
 * The simulator ships no font files (CLAUDE.md: no runtime network, assets
 * procedural or bundled), so avionics text uses font stacks of fonts that
 * are installed on the target platforms and approximate the real faces:
 *  - Garmin: a condensed humanist sans. Windows 10+ ships "Bahnschrift"
 *    (DIN-like, with SemiCondensed/Condensed widths); Linux has DejaVu Sans
 *    Condensed / Liberation Sans Narrow.
 *  - Honeywell / Collins: plain sans-serif (Segoe UI / DejaVu Sans).
 *  - Boeing: the vector `StrokeFont` (see StrokeFont.ts); a monospace stack
 *    is the canvas-font fallback.
 *  - Data fields / CDU: monospace stack ("Roboto Mono", "DejaVu Sans Mono",
 *    "Consolas", monospace).
 *  - Steam gauge dials: geometric sans ("Futura", "Century Gothic", Arial).
 *
 * `Typeface` hides whether text is drawn with a canvas font or the stroke
 * font, so every primitive can switch style by swapping one object.
 */
import type { Ctx2D } from './draw/context';
import { STROKE_FONT, StrokeFont, type TextAlign, type TextBaseline } from './StrokeFont';

export const FONT_STACKS = {
  garmin: '"Bahnschrift SemiCondensed", "Roboto Condensed", "Arial Narrow", "DejaVu Sans Condensed", "Liberation Sans Narrow", sans-serif',
  honeywell: '"Segoe UI", "Roboto", "DejaVu Sans", "Liberation Sans", Arial, sans-serif',
  collins: '"Bahnschrift", "Roboto", "Segoe UI", "DejaVu Sans", "Liberation Sans", sans-serif',
  boeing: '"Roboto Mono", "DejaVu Sans Mono", "Consolas", "Liberation Mono", monospace',
  mono: '"Roboto Mono", "DejaVu Sans Mono", "Consolas", "Liberation Mono", monospace',
  gauge: '"Futura", "Century Gothic", "Avenir Next", Arial, "DejaVu Sans", sans-serif',
  lcd: '"DSEG7 Classic", "Digital-7", "Consolas", "DejaVu Sans Mono", monospace',
} as const;

const fontStringCache = new Map<string, Map<number, string>>();

/**
 * CSS font shorthand for canvas `ctx.font`, cached so steady-state drawing
 * allocates nothing. Size is rounded to 0.5 px.
 */
export function fontString(sizePx: number, family: string, weight: 'normal' | 'bold' | number = 'normal'): string {
  const key = `${weight}|${family}`;
  let m = fontStringCache.get(key);
  if (!m) fontStringCache.set(key, (m = new Map()));
  const s2 = Math.round(sizePx * 2);
  let f = m.get(s2);
  if (f === undefined) {
    f = `${weight} ${s2 / 2}px ${family}`;
    m.set(s2, f);
  }
  return f;
}

/** Abstract text renderer. `size` = CSS font size in logical pixels. */
export interface Typeface {
  /** Draws text; with `halo` a dark outline is stroked first (readability over the horizon/map). */
  draw(ctx: Ctx2D, text: string, x: number, y: number, size: number, color: string, align?: TextAlign, baseline?: TextBaseline, halo?: string): void;
  /** Width of `text` in pixels. */
  width(ctx: Ctx2D, text: string, size: number): number;
}

/** Canvas-font typeface (font stack + weight). */
export class CanvasTypeface implements Typeface {
  private readonly sizes = new Map<number, string>();

  constructor(
    readonly family: string,
    readonly weight: 'normal' | 'bold' | number = 'normal',
    /** Halo line width as a fraction of the font size. */
    readonly haloWidth = 0.22,
  ) {}

  /** Cached `ctx.font` string for `size` (0.5 px resolution). */
  font(size: number): string {
    const k = Math.round(size * 2);
    let f = this.sizes.get(k);
    if (f === undefined) {
      f = `${this.weight} ${k / 2}px ${this.family}`;
      this.sizes.set(k, f);
    }
    return f;
  }

  draw(ctx: Ctx2D, text: string, x: number, y: number, size: number, color: string, align: TextAlign = 'left', baseline: TextBaseline = 'alphabetic', halo?: string): void {
    ctx.font = this.font(size);
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (halo) {
      ctx.lineWidth = Math.max(2, size * this.haloWidth);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = halo;
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  width(ctx: Ctx2D, text: string, size: number): number {
    ctx.font = this.font(size);
    return ctx.measureText(text).width;
  }
}

/** Stroke-font typeface (Boeing style). */
export class StrokeTypeface implements Typeface {
  constructor(readonly font: StrokeFont = STROKE_FONT) {}

  draw(ctx: Ctx2D, text: string, x: number, y: number, size: number, color: string, align: TextAlign = 'left', baseline: TextBaseline = 'alphabetic', halo?: string): void {
    ctx.beginPath();
    this.font.path(ctx, text, x, y, size, align, baseline);
    const lw = Math.max(1, size * 0.72 * this.font.weight);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (halo) {
      ctx.strokeStyle = halo;
      ctx.lineWidth = lw + Math.max(2, size * 0.15);
      ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  width(_ctx: Ctx2D, text: string, size: number): number {
    return this.font.width(text, size);
  }
}

export const GARMIN_TYPEFACE: Typeface = new CanvasTypeface(FONT_STACKS.garmin, 'bold');
export const HONEYWELL_TYPEFACE: Typeface = new CanvasTypeface(FONT_STACKS.honeywell, 600);
export const COLLINS_TYPEFACE: Typeface = new CanvasTypeface(FONT_STACKS.collins, 600);
export const BOEING_TYPEFACE: Typeface = new StrokeTypeface();
export const MONO_TYPEFACE: Typeface = new CanvasTypeface(FONT_STACKS.mono, 'bold');
export const GAUGE_TYPEFACE: Typeface = new CanvasTypeface(FONT_STACKS.gauge, 'bold', 0.18);

// ------------------------------------------------------------------ availability

const availability = new Map<string, boolean>();
let probeCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

function probe(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (probeCtx !== undefined) return probeCtx;
  probeCtx = null;
  if (typeof OffscreenCanvas !== 'undefined') probeCtx = new OffscreenCanvas(8, 8).getContext('2d');
  else if (typeof document !== 'undefined') probeCtx = document.createElement('canvas').getContext('2d');
  return probeCtx;
}

/**
 * Whether a system font family is installed, detected by comparing text
 * widths against two generic fallbacks (a font that is missing renders in
 * the fallback). Returns false where no canvas exists (tests, SSR).
 */
export function isFontAvailable(family: string): boolean {
  const cached = availability.get(family);
  if (cached !== undefined) return cached;
  const ctx = probe();
  let ok = false;
  if (ctx) {
    const sample = 'mmmmmmmmmmlli0O8WQ';
    for (const generic of ['monospace', 'serif', 'sans-serif']) {
      ctx.font = `72px ${generic}`;
      const base = ctx.measureText(sample).width;
      ctx.font = `72px "${family}", ${generic}`;
      if (Math.abs(ctx.measureText(sample).width - base) > 0.5) {
        ok = true;
        break;
      }
    }
  }
  availability.set(family, ok);
  return ok;
}

/** First installed family of a CSS font stack (quoted names unquoted), or the generic at its end. */
export function resolveFontStack(stack: string): string {
  const parts = stack.split(',').map((p) => p.trim().replace(/^["']|["']$/g, ''));
  for (const p of parts) {
    if (p === 'sans-serif' || p === 'serif' || p === 'monospace') return p;
    if (isFontAvailable(p)) return p;
  }
  return parts[parts.length - 1] ?? 'sans-serif';
}

/**
 * Waits until the document's fonts are ready (locally installed fonts need
 * no download; this only matters when a page added @font-face rules) and
 * resolves with the resolved family of each stack. Never rejects; resolves
 * after `timeoutMs` at the latest.
 */
export async function ensureFonts(stacks: readonly string[] = Object.values(FONT_STACKS), timeoutMs = 1500): Promise<string[]> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (fonts) {
    await Promise.race([fonts.ready.then(() => undefined), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  }
  return stacks.map(resolveFontStack);
}
