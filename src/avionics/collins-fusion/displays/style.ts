/**
 * Visual style of the Pro Line Fusion displays: colours, typeface and small
 * drawing helpers shared by every window renderer.
 *
 * Colour meanings follow 14 CFR 25.1322 / AC 25-11B and the Collins
 * convention (selected targets cyan, FMS / computed magenta, active modes and
 * VHF navigation green, armed modes white, cautions amber, warnings red).
 * The exact shades are EST (LCD gamut makes exact matches meaningless), from
 * Pro Line Fusion press images of the Global Vision flight deck.
 */
import { COLLINS_PALETTE } from '../../common/palette';
import { COLLINS_TYPEFACE, type Typeface } from '../../common/fonts';
import type { Ctx2D } from '../../common/draw/context';

export const C = {
  bg: '#000000',
  white: '#ffffff',
  grey: '#a4a8ad',
  dimGrey: '#5c6168',
  line: '#4a4f57',
  dark: '#15181c',
  panel: '#101418',
  menuBg: '#1b2733',
  menuSel: '#2d6fb8',
  hover: '#2a5d99',
  cyan: COLLINS_PALETTE.cyan,
  magenta: COLLINS_PALETTE.magenta,
  green: COLLINS_PALETTE.green,
  amber: COLLINS_PALETTE.amber,
  yellow: COLLINS_PALETTE.yellow,
  red: '#ff2020',
  blue: '#2a76d2',
  sky: '#1f63c2',
  skyTop: '#0d3f8f',
  ground: '#6a431c',
  groundBottom: '#3f270f',
  tape: 'rgba(24,28,34,0.78)',
  tapeEdge: '#8a9099',
  readout: '#000000',
} as const;

export const TF: Typeface = COLLINS_TYPEFACE;

export type Align = 'left' | 'center' | 'right';
export type Baseline = 'top' | 'middle' | 'bottom' | 'alphabetic';

/** Text with the Collins typeface (cached font strings, no allocation per call). */
export function txt(ctx: Ctx2D, s: string, x: number, y: number, size: number, color: string, align: Align = 'left', baseline: Baseline = 'middle'): void {
  if (!s) return;
  TF.draw(ctx, s, x, y, size, color, align, baseline);
}

/** Text with a black halo (over SVS / map backgrounds). */
export function txtHalo(ctx: Ctx2D, s: string, x: number, y: number, size: number, color: string, align: Align = 'left', baseline: Baseline = 'middle'): void {
  if (!s) return;
  TF.draw(ctx, s, x, y, size, color, align, baseline, '#000000');
}

export function textWidth(ctx: Ctx2D, s: string, size: number): number {
  return TF.width(ctx, s, size);
}

export function rect(ctx: Ctx2D, x: number, y: number, w: number, h: number, fill: string, stroke = '', lw = 1): void {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.strokeRect(x + 0.5 * lw, y + 0.5 * lw, w - lw, h - lw);
  }
}

export function seg(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, color: string, lw = 2): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Boxed value (black fill, coloured frame and text). */
export function boxed(ctx: Ctx2D, s: string, x: number, y: number, w: number, h: number, size: number, color: string, frame: string = C.white, align: Align = 'center'): void {
  rect(ctx, x, y, w, h, C.readout, frame, 1.5);
  const tx = align === 'center' ? x + w / 2 : align === 'left' ? x + 4 : x + w - 4;
  txt(ctx, s, tx, y + h / 2 + 1, size, color, align, 'middle');
}

/** Cached integer / heading strings (no allocation after warm-up). */
const INT_CACHE = new Map<number, string>();
export function istr(n: number): string {
  const k = Math.round(n);
  let s = INT_CACHE.get(k);
  if (s === undefined) {
    s = String(k);
    if (INT_CACHE.size < 20000) INT_CACHE.set(k, s);
  }
  return s;
}

const HDG_CACHE: string[] = [];
for (let i = 0; i <= 360; i++) HDG_CACHE.push((i === 0 ? 360 : i).toString().padStart(3, '0'));
/** '001'..'360' heading string. */
export function hstr(deg: number): string {
  const d = Math.round((((deg % 360) + 360) % 360)) % 360;
  return HDG_CACHE[d === 0 ? 360 : d];
}

const FIX_CACHES: Map<number, string>[] = [new Map(), new Map(), new Map(), new Map()];
/** Cached fixed-decimal string (decimals 0..3). */
export function fstr(v: number, decimals: number): string {
  const d = Math.max(0, Math.min(3, decimals));
  const p = 10 ** d;
  const k = Math.round(v * p);
  const cache = FIX_CACHES[d];
  let s = cache.get(k);
  if (s === undefined) {
    s = (k / p).toFixed(d);
    if (cache.size < 20000) cache.set(k, s);
  }
  return s;
}

const PSTR = new Map<string, Map<number, string>>();
/** Cached `prefix + integer` string (allocation-free after warm-up). */
export function pstr(prefix: string, n: number): string {
  let m = PSTR.get(prefix);
  if (!m) {
    m = new Map();
    PSTR.set(prefix, m);
  }
  const k = Math.round(n);
  let s = m.get(k);
  if (s === undefined) {
    s = prefix + istr(k);
    if (m.size < 5000) m.set(k, s);
  }
  return s;
}

/** Window frame + format title (Pro Line Fusion multifunction window). */
export function windowFrame(ctx: Ctx2D, x: number, y: number, w: number, h: number, title: string, hovered = false): void {
  ctx.strokeStyle = hovered ? C.cyan : C.line;
  ctx.lineWidth = hovered ? 2 : 1.5;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  if (title) txt(ctx, title, x + 8, y + 12, 13, C.grey, 'left', 'middle');
}

/** Normalises degrees to [0, 360). */
export function n360(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed difference a - b in [-180, 180). */
export function dAng(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export const DEG = Math.PI / 180;
