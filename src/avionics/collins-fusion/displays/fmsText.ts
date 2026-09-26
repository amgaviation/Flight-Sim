/**
 * FMS window renderer: draws the owner side's FMS page (fms/window.ts) as a
 * 24 x 14 character page in a half window, with cursor hot spots for the six
 * left and six right line select positions ("soft buttons on displays",
 * FSB BD-700-1A10 Rev 7) and the scratchpad line. Monospace text keeps the
 * CDU column alignment (EST font choice).
 */
import type { Ctx2D } from '../../common/draw/context';
import { MONO_TYPEFACE } from '../../common/fonts';
import type { ShownWindow } from '../logic/layout';
import { FMS_COLS, FMS_ROWS, LSK_IDS, type FmsColor, type LskId } from '../fms/screen';
import type { FmsWindowModel } from '../fms/window';
import { C, rect, seg } from './style';
import type { HotSpots, WindowRenderer } from './window';

const COLORS: Record<FmsColor, string> = {
  white: C.white,
  cyan: C.cyan,
  green: C.green,
  magenta: C.magenta,
  amber: C.amber,
  grey: C.grey,
};

export class FmsTextWindow implements WindowRenderer {
  readonly animated = false;

  constructor(private readonly models: [FmsWindowModel, FmsWindowModel]) {}

  update(): void {}

  draw(ctx: Ctx2D, w: ShownWindow, hs: HotSpots): void {
    const r = w.rect;
    const m = this.models[w.owner - 1];
    const s = m.screen;
    rect(ctx, r.x, r.y, r.w, r.h, C.bg);
    const mx = 18;
    const cw = (r.w - 2 * mx) / FMS_COLS;
    const top = r.y + 30;
    const rowH = (r.h - 60) / FMS_ROWS;
    const big = Math.min(26, cw * 1.45);
    const small = big * 0.72;
    // Owner tag (pilot / copilot FMS window).
    MONO_TYPEFACE.draw(ctx, w.owner === 1 ? 'FMS 1' : 'FMS 2', r.x + 10, r.y + 14, 13, C.grey, 'left', 'middle');
    // Title and page number.
    const title = s.title;
    MONO_TYPEFACE.draw(ctx, title, r.x + r.w / 2, top, big, COLORS[s.titleColor], 'center', 'middle');
    if (s.pages > 1) MONO_TYPEFACE.draw(ctx, pageText(s.page, s.pages), r.x + r.w - mx, top, small, C.white, 'right', 'middle');
    for (let row = 1; row < FMS_ROWS - 1; row++) {
      const y = top + row * rowH;
      for (const g of s.rows[row]) {
        // The font's advance is narrower than a cell: groups ending at the last column are
        // right-aligned on the right edge so the right-hand column lines up (CDU layout).
        const end = g.col + g.text.length;
        if (end >= FMS_COLS && g.col > 0) MONO_TYPEFACE.draw(ctx, g.text, r.x + mx + FMS_COLS * cw, y, g.small ? small : big, COLORS[g.color], 'right', 'middle');
        else MONO_TYPEFACE.draw(ctx, g.text, r.x + mx + g.col * cw, y, g.small ? small : big, COLORS[g.color], 'left', 'middle');
      }
    }
    // Scratchpad with its frame.
    const sy = top + (FMS_ROWS - 1) * rowH;
    seg(ctx, r.x + mx, sy - rowH * 0.55, r.x + r.w - mx, sy - rowH * 0.55, C.dimGrey, 1);
    MONO_TYPEFACE.draw(ctx, s.scratch, r.x + mx, sy, big, COLORS[s.scratchColor], 'left', 'middle');
    // Line select hot spots: label + data rows of line k, left / right halves.
    for (let k = 1; k <= 6; k++) {
      const y0 = top + (2 * k - 1) * rowH - rowH * 0.5;
      const hgt = rowH * 2;
      hs.add(LSK_IDS[k - 1], r.x, y0, r.w * 0.5, hgt);
      hs.add(LSK_IDS[k + 5], r.x + r.w * 0.5, y0, r.w * 0.5, hgt);
      // Soft button ticks at the window edges (EST visual cue).
      seg(ctx, r.x + 3, y0 + hgt * 0.72, r.x + 12, y0 + hgt * 0.72, C.dimGrey, 2);
      seg(ctx, r.x + r.w - 12, y0 + hgt * 0.72, r.x + r.w - 3, y0 + hgt * 0.72, C.dimGrey, 2);
    }
    hs.add('SCRATCH', r.x, sy - rowH * 0.5, r.w, rowH);
  }

  enter(_side: 1 | 2, w: ShownWindow, id: string): void {
    const m = this.models[w.owner - 1];
    if ((LSK_IDS as readonly string[]).includes(id)) m.lsk(id as LskId);
  }

  data(_side: 1 | 2, w: ShownWindow, _id: string, steps: number): void {
    // DATA knob scrolls the pages (PREV / NEXT).
    const m = this.models[w.owner - 1];
    m.key(steps > 0 ? 'NEXT' : 'PREV');
  }
}

const PAGE_TXT = new Map<number, string>();
function pageText(p: number, n: number): string {
  const k = p * 100 + n;
  let s = PAGE_TXT.get(k);
  if (!s) {
    s = `${p}/${n}`;
    PAGE_TXT.set(k, s);
  }
  return s;
}
