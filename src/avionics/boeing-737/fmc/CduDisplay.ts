/**
 * CDU screen (the 737NG colour LCD CDU, or the original green CRT with
 * `cduScreen: 'green'`): draws the 14 x 24 character grid of a `Cdu`.
 *
 * Character cells are drawn one by one centred in fixed cells, so the
 * layout is exact whatever monospace font the platform provides. Large
 * characters for data lines and the title, small characters for labels
 * (FCOM 11.40 "CDU display": large font for data, small for labels and
 * predicted values). Boxes (□) are drawn as outlined rectangles, zeros are
 * slashed (as on the U10 CDU screenshots), reverse video = modified data.
 * Colours on the LCD CDU: white data, green active / selected states,
 * magenta active waypoint and FMC targets, cyan inactive, amber alerts.
 *
 * Refresh: 15 Hz, redrawing only when the screen content changes.
 */
import { CanvasDisplay } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import { FONT_STACKS, fontString } from '../../common/fonts';
import type { Cdu } from './Cdu';
import { CDU_COLS, CDU_ROWS, CduColor } from './screen';
import { B737_VARS, cduDisplayId } from '../vars';

/** Logical size (px). The NG CDU display area is about 4 x 3.4 in (EST). */
export const CDU_W = 560;
export const CDU_H = 480;
const MARGIN_X = 10;
const TOP = 12;
const CELL_W = (CDU_W - 2 * MARGIN_X) / CDU_COLS;
const ROW_H = (CDU_H - TOP - 8) / CDU_ROWS;

const LCD_COLORS: Record<CduColor, string> = {
  [CduColor.White]: '#f2f2f2',
  [CduColor.Cyan]: '#34e2ff',
  [CduColor.Green]: '#27ec43',
  [CduColor.Magenta]: '#ff5cf2',
  [CduColor.Amber]: '#ffb52a',
};
const CRT_GREEN = '#3cff6e';

export interface CduDisplayOptions {
  canvas?: 'dom' | 'offscreen' | HTMLCanvasElement | OffscreenCanvas;
  pixelRatio?: number;
}

export class CduDisplay extends CanvasDisplay {
  readonly cdu: Cdu;
  private readonly green: boolean;
  private lastHash = -1;
  private readonly largeFont = fontString(30, FONT_STACKS.mono, 'bold');
  private readonly smallFont = fontString(22, FONT_STACKS.mono, 'bold');

  constructor(cdu: Cdu, opts: CduDisplayOptions = {}) {
    super({
      id: cduDisplayId(cdu.side),
      width: CDU_W,
      height: CDU_H,
      pixelRatio: opts.pixelRatio ?? 1,
      vars: cdu.fmc.vars,
      refreshHz: 15,
      canvas: opts.canvas,
      brightnessVar: B737_VARS.cduBrt(cdu.side),
      bootTimeS: 0,
    });
    this.cdu = cdu;
    this.green = cdu.fmc.cfg.cduScreen === 'green';
  }

  protected override update(dt: number): void {
    this.cdu.update(dt);
    const h = this.cdu.render().hash();
    if (h !== this.lastHash) {
      this.lastHash = h;
      this.invalidate();
    }
  }

  protected draw(ctx: Ctx2D): void {
    const s = this.cdu.screen;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let r = 0; r < CDU_ROWS; r++) {
      const base = TOP + (r + 1) * ROW_H - 7;
      for (let col = 0; col < CDU_COLS; col++) {
        const k = r * CDU_COLS + col;
        const ch = s.chars[k];
        const rev = s.reverse[k] === 1;
        if (ch === ' ' && !rev) continue;
        const small = s.small[k] === 1;
        const color = this.green ? CRT_GREEN : LCD_COLORS[s.color[k] as CduColor] ?? LCD_COLORS[CduColor.White];
        const x = MARGIN_X + col * CELL_W;
        if (rev) {
          ctx.fillStyle = color;
          ctx.fillRect(x, base - ROW_H + 9, CELL_W, ROW_H - 2);
        }
        const fg = rev ? '#000000' : color;
        this.glyph(ctx, ch, x, base, small, fg);
      }
    }
  }

  private glyph(ctx: Ctx2D, ch: string, x: number, base: number, small: boolean, color: string): void {
    const cx = x + CELL_W / 2;
    const h = small ? 16 : 21; // cap height (px)
    if (ch === '□') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      const w = CELL_W * 0.7;
      ctx.strokeRect(cx - w / 2, base - h, w, h);
      return;
    }
    if (ch === '°') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, base - h + 4, small ? 3 : 4, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = color;
    ctx.font = small ? this.smallFont : this.largeFont;
    ctx.fillText(ch, cx, base);
    if (ch === '0') {
      // Slashed zero.
      ctx.strokeStyle = color;
      ctx.lineWidth = small ? 1.6 : 2.2;
      ctx.beginPath();
      ctx.moveTo(cx - h * 0.22, base - h * 0.15);
      ctx.lineTo(cx + h * 0.22, base - h * 0.85);
      ctx.stroke();
    }
  }
}
