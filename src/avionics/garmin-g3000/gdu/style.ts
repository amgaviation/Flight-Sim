/**
 * G3000 / G5000 GDU drawing style: colours, sizes and small helpers shared
 * by the PFD, MFD, EIS and panes. Layout values are measured from the
 * pilot's-guide figures (G3000 PG 190-02046-01 Figures 1-2, 2-17, 2-22; G5000
 * CRG 190-02538-02 "EICAS Display") on the 1280 x 800 GDU 1400W screen and
 * marked EST where interpolated.
 */
import { GARMIN_PALETTE, derivePalette, type AvionicsPalette } from '../../common/palette';
import { CanvasTypeface, FONT_STACKS, type Typeface } from '../../common/fonts';
import { box, type Ctx2D } from '../../common/draw/context';

/** GDU logical size (GDU 1200W / 1400W: 1280 x 800, PG §1.1). */
export const GDU_W = 1280;
export const GDU_H = 800;
/** Softkey label strip height at the bottom of the GDU (12 bezel keys). */
export const SOFTKEY_H = 54;
/** Bottom data bar of the PFD (TAS/GS, OAT/ISA, bearing info, TMR/UTC). */
export const PFD_DATABAR_H = 54;
/** MFD: EIS strip width, navigation data bar height (PG §5.1). */
export const EIS_W = 280;
export const MFD_DATABAR_H = 34;
/** Split / half pane width (a PFD split pane equals an MFD half pane, PG §1.3). */
export const PANE_W = (GDU_W - EIS_W) / 2;

/** G3000 palette: Garmin roles plus the darker box greys of the GDU 1400 (EST from PG figures). */
export const G3K_PALETTE: AvionicsPalette = derivePalette(GARMIN_PALETTE, {
  name: 'g3000',
  grey: '#a4aab0',
  darkGrey: '#2c3035',
  tapeBackground: 'rgba(38,40,46,0.62)',
  sky: '#0f53c9',
  skyHorizon: '#5ea7f2',
  groundHorizon: '#8f5d2c',
  ground: '#553416',
  softKeyActive: '#c2c6ca',
});

export const G3K_COLORS = {
  boxFill: 'rgba(20,22,26,0.82)',
  boxSolid: '#15171a',
  boxBorder: '#8a9096',
  paneBg: '#000000',
  paneTitle: '#d9dde1',
  selectGtc1: '#00e8ff',
  selectGtc2: '#c33cff',
  softkeyBg: '#0b0c0d',
  softkeySep: '#3d4247',
  dataBar: '#1a1d21',
  eisBg: '#1b1e22',
  eisLine: '#5a6066',
  amberRev: '#ffb000',
  greenText: '#00e000',
} as const;

/** Regular (non-bold) condensed face for small labels; the bold face for values. */
export const TF: Typeface = new CanvasTypeface(FONT_STACKS.garmin, 'bold', 0.22);
export const TF_LIGHT: Typeface = new CanvasTypeface(FONT_STACKS.garmin, 'normal', 0.22);

/** Translucent Garmin data box (thin grey border). */
export function dataBox(ctx: Ctx2D, x: number, y: number, w: number, h: number, fill: string = G3K_COLORS.boxFill, border: string = G3K_COLORS.boxBorder): void {
  box(ctx, x, y, w, h, fill, border, 1.5, 3);
}

/** Black-on-colour (reverse video) annunciation text box. */
export function annunciation(ctx: Ctx2D, text: string, cx: number, cy: number, size: number, bg: string, fg = '#000000', padX = 8): number {
  const w = TF.width(ctx, text, size) + padX * 2;
  box(ctx, cx - w / 2, cy - size * 0.62, w, size * 1.24, bg, '', 1, 2);
  TF.draw(ctx, text, cx, cy + 1, size, fg, 'center', 'middle');
  return w;
}

/** Garmin-style value with a small unit ("12.6NM"). Returns the total width. */
export function valueUnit(ctx: Ctx2D, value: string, unit: string, x: number, y: number, size: number, color: string, align: 'left' | 'right' = 'left'): number {
  const wv = TF.width(ctx, value, size);
  const wu = TF.width(ctx, unit, size * 0.62);
  const total = wv + wu + 1;
  const x0 = align === 'left' ? x : x - total;
  TF.draw(ctx, value, x0, y, size, color, 'left', 'middle');
  TF.draw(ctx, unit, x0 + wv + 1, y + size * 0.14, size * 0.62, color, 'left', 'middle');
  return total;
}
