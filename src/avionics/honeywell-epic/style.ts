/**
 * Gulfstream PlaneView II / Symmetry display style: colours, typefaces and
 * small canvas drawing helpers shared by every Epic display.
 *
 * Colour meanings (AC 25-11B, 14 CFR 25.1322) as used by Gulfstream:
 *  - CAS: red warnings, amber cautions, blue (cyan) advisories, white status
 *    (G550 OM 2A-31-00: "Messages appear in red, amber, or blue colors";
 *    FAA FSB GVI Rev 11 §9.2.2.7 "the blue 'AOA Limiting' CAS message").
 *  - Cursor: "a green plus (+) type symbol for the pilot cursor or a blue (x)
 *    type symbol for the copilot"; interactive items under the cursor show
 *    "with a blue background and a white outline" (G550 OM 2A-31-00 CCD).
 *  - Engine indications: normal green or white, caution amber, warning red
 *    (G550 OM 2A-31-00 range markings).
 *  - Selected targets cyan, FMS magenta, active modes green, armed white
 *    (Honeywell Primus Epic convention; see common/palette.ts).
 * Exact shades are EST (sampled from G650ER / G600 cockpit photographs).
 */
import { CanvasTypeface, FONT_STACKS, type Typeface } from '../common/fonts';
import { derivePalette, HONEYWELL_PALETTE, type AvionicsPalette } from '../common/palette';
import type { Ctx2D } from '../common/draw/context';
import type { TextAlign, TextBaseline } from '../common/StrokeFont';

/** PlaneView palette: white aircraft symbol with black outline (G650 PFD photograph). */
export const EPIC_PALETTE: AvionicsPalette = derivePalette(HONEYWELL_PALETTE, {
  name: 'planeview',
  sky: '#1a5fd0',
  skyHorizon: '#3d8cf0',
  groundHorizon: '#86582a',
  ground: '#5c3a17',
  aircraftSymbol: '#ffffff',
  aircraftSymbolOutline: '#000000',
  tapeBackground: 'rgba(52,56,62,0.82)',
  caution: '#ffb000',
  advisory: '#1ee6ff',
});

/** Named colours used across the suite (EST shades). */
export const C = {
  black: '#000000',
  white: '#ffffff',
  grey: '#a6acb3',
  dim: '#6c737b',
  green: '#1fff3c',
  cyan: '#1ee6ff',
  magenta: '#ff3cff',
  amber: '#ffb000',
  yellow: '#fff000',
  red: '#ff2020',
  blue: '#1e6ed8',
  /** Synoptic / 1/6 window background (G650 photographs: dark blue-grey). */
  winBg: '#2b3036',
  winBgLight: '#3b4148',
  /** Window border lines. */
  winLine: '#6f7780',
  /** Menu-bar button fill / text (INAV menu bar). */
  menuFill: '#20252b',
  menuText: '#dfe3e8',
  /** Cursor-highlighted item (blue background, white outline). */
  hiFill: '#1c4fd0',
  /** Touch-screen (Symmetry) colours. */
  touchBg: '#1b1f24',
  touchPanel: '#2c323a',
  touchButton: '#3b434d',
  touchButtonOn: '#1f7a34',
  touchEdge: '#5b6671',
  touchTitle: '#12467f',
  /** Guidance panel window digits (EST: amber-orange LCD in the G650 GP photograph). */
  gpDigits: '#ff9a1a',
  /** Symmetry GP-700 window digits (EST: blue-white). */
  gpDigitsSym: '#bfe6ff',
  /** Tape backgrounds. */
  tape: 'rgba(40,44,50,0.78)',
} as const;

/** Main display typeface (Honeywell sans, semibold). */
export const EPIC_FONT: Typeface = new CanvasTypeface(FONT_STACKS.honeywell, 600, 0.24);
/** Bold variant for the big readouts. */
export const EPIC_FONT_BOLD: Typeface = new CanvasTypeface(FONT_STACKS.honeywell, 700, 0.24);
/** MCDU / CDU monospace (bold, like the Honeywell MCDU character set). */
export const EPIC_MONO: Typeface = new CanvasTypeface(FONT_STACKS.mono, 700, 0.2);
/** Guidance-panel / LCD windows. */
export const EPIC_LCD: Typeface = new CanvasTypeface(FONT_STACKS.lcd, 700, 0);

/** Draws text with the default Epic typeface. */
export function text(ctx: Ctx2D, s: string, x: number, y: number, size: number, color: string, align: TextAlign = 'left', baseline: TextBaseline = 'middle', halo?: string): void {
  EPIC_FONT.draw(ctx, s, x, y, size, color, align, baseline, halo);
}

export function textBold(ctx: Ctx2D, s: string, x: number, y: number, size: number, color: string, align: TextAlign = 'left', baseline: TextBaseline = 'middle', halo?: string): void {
  EPIC_FONT_BOLD.draw(ctx, s, x, y, size, color, align, baseline, halo);
}

/** Filled/stroked rectangle (no allocation). */
export function rect(ctx: Ctx2D, x: number, y: number, w: number, h: number, fill: string, stroke = '', lw = 1): void {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
  }
}

/** Straight line. */
export function seg(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, color: string, lw = 2): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Small down-pointing menu triangle (window menu buttons: "Map Data ▾"). */
export function menuTriangle(ctx: Ctx2D, x: number, y: number, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - s, y - s * 0.5);
  ctx.lineTo(x + s, y - s * 0.5);
  ctx.lineTo(x, y + s * 0.6);
  ctx.closePath();
  ctx.fill();
}

/**
 * Window menu-bar button (INAV "Map Data", "Map View", checklist "Show
 * Items"). `hi` = under the cursor (blue fill, white outline), `on` = latched.
 */
export function menuButton(ctx: Ctx2D, x: number, y: number, w: number, h: number, label: string, hi: boolean, on = false, dropDown = false, size = 15): void {
  rect(ctx, x, y, w, h, hi ? C.hiFill : on ? C.winBgLight : C.menuFill, hi ? C.white : C.winLine, hi ? 2 : 1);
  const tx = dropDown ? x + (w - 12) / 2 : x + w / 2;
  text(ctx, label, tx, y + h / 2 + 1, size, on && !hi ? C.cyan : C.menuText, 'center', 'middle');
  if (dropDown) menuTriangle(ctx, x + w - 9, y + h / 2, 4, C.menuText);
}

/** Boxed numeric/text readout. */
export function readout(ctx: Ctx2D, x: number, y: number, w: number, h: number, value: string, color: string, size: number, align: TextAlign = 'right', border = C.winLine): void {
  rect(ctx, x, y, w, h, C.black, border, 1);
  const tx = align === 'right' ? x + w - 4 : align === 'center' ? x + w / 2 : x + 4;
  text(ctx, value, tx, y + h / 2 + 1, size, color, align, 'middle');
}

/** Cursor symbols: pilot green '+', copilot cyan 'x' (G550 OM 2A-31-00). */
export function drawCursor(ctx: Ctx2D, side: 1 | 2, x: number, y: number): void {
  const r = 11;
  ctx.lineCap = 'butt';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? C.black : side === 1 ? C.green : C.cyan;
    ctx.lineWidth = pass === 0 ? 6 : 3;
    ctx.beginPath();
    if (side === 1) {
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
    } else {
      const d = r * 0.75;
      ctx.moveTo(x - d, y - d);
      ctx.lineTo(x + d, y + d);
      ctx.moveTo(x - d, y + d);
      ctx.lineTo(x + d, y - d);
    }
    ctx.stroke();
  }
}

/** Colour for a CAS level. */
export function casColor(level: 'warning' | 'caution' | 'advisory' | 'status'): string {
  return level === 'warning' ? C.red : level === 'caution' ? C.amber : level === 'advisory' ? C.cyan : C.white;
}

/** Colour of an engine parameter for an exceedance level 0/1/2. */
export function levelColor(level: number, normal: string = C.green): string {
  return level >= 2 ? C.red : level === 1 ? C.amber : normal;
}
