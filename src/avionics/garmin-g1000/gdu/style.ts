/**
 * G1000 NXi GDU drawing style and layout (10.4-inch GDU 1054B, 1024 x 768
 * native resolution; PG 190-02177-02 §1.1). Positions are measured from the
 * PG PFD / MFD figures scaled to 1024 x 768 (e.g. Figure 2-1 "PFD
 * Information": top bar 0-55 px, airspeed tape x 155-240 / y 115-455,
 * attitude centre (459, 284), altimeter x 704-808, VSI x 808-856, HSI centre
 * (459, 578) radius 141, lower right window x 720-1022 / y 490-708,
 * softkey labels y 740-768); interpolated values are marked EST.
 */
import { GARMIN_PALETTE, derivePalette, type AvionicsPalette } from '../../common/palette';
import { CanvasTypeface, FONT_STACKS, type Typeface } from '../../common/fonts';
import { box, type Ctx2D } from '../../common/draw/context';

export const GDU_W = 1024;
export const GDU_H = 768;
/** Softkey label strip (12 keys x 85.3 px). */
export const SOFTKEY_H = 28;
export const SOFTKEY_Y = GDU_H - SOFTKEY_H;
/** Top bar: NAV box, navigation status / AFCS status boxes (PFD) or navigation data bar (MFD), COM box. */
export const TOPBAR_H = 55;
export const NAV_BOX_W = 250;
export const COM_BOX_X = 775;
/** MFD EIS strip width (PG Figure 3-2, EST 158 px of 1024). */
export const EIS_W = 158;
/** Lower-right PFD window (References, Nearest, Flight Plan, Alerts, Direct-to, Procedures). */
export const WIN_RECT = { x: 720, y: 490, w: 302, h: 218 };

/** G1000 palette: Garmin roles; the NXi uses a slightly deeper sky blue (EST from the PG figures). */
export const G1K_PALETTE: AvionicsPalette = derivePalette(GARMIN_PALETTE, {
  name: 'g1000',
  sky: '#1353c4',
  skyHorizon: '#5aa0ee',
  groundHorizon: '#8f5d2a',
  ground: '#523214',
  tapeBackground: 'rgba(40,42,48,0.6)',
});

export const G1K_COLORS = {
  boxFill: 'rgba(0,0,0,0.85)',
  boxBorder: '#8c9196',
  barBg: '#101214',
  softkeyBg: '#000000',
  softkeySep: '#4a4f54',
  softkeyLabel: '#ffffff',
  pageTitle: '#00ffff',
  eisBg: '#000000',
  eisLine: '#5a6066',
  groupTab: '#2d3136',
} as const;

export const TF: Typeface = new CanvasTypeface(FONT_STACKS.garmin, 'bold', 0.22);
export const TF_LIGHT: Typeface = new CanvasTypeface(FONT_STACKS.garmin, 'normal', 0.22);

/** Black Garmin window with a thin grey border. */
export function winBox(ctx: Ctx2D, x: number, y: number, w: number, h: number, fill: string = G1K_COLORS.boxFill): void {
  box(ctx, x, y, w, h, fill, G1K_COLORS.boxBorder, 1.5, 3);
}

/** Reverse-video annunciation box centred on (cx, cy). Returns its width. */
export function annun(ctx: Ctx2D, text: string, cx: number, cy: number, size: number, bg: string, fg = '#000000'): number {
  const w = TF.width(ctx, text, size) + 10;
  box(ctx, cx - w / 2, cy - size * 0.62, w, size * 1.24, bg, '', 1, 2);
  TF.draw(ctx, text, cx, cy + 1, size, fg, 'center', 'middle');
  return w;
}

/** Cursor highlight: black text on cyan (flashing when `flash` is false in the off phase). */
export function cursorText(ctx: Ctx2D, text: string, x: number, y: number, size: number, align: 'left' | 'right' | 'center', on: boolean): void {
  const w = TF.width(ctx, text || ' ', size);
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  if (on) box(ctx, x0 - 3, y - size * 0.62, w + 6, size * 1.24, '#00ffff', '');
  TF.draw(ctx, text, x, y + 1, size, on ? '#000000' : '#00ffff', align, 'middle');
}
