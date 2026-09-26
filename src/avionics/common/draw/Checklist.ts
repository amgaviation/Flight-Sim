/**
 * Electronic checklist renderer (Garmin G1000/G3000 CHKLIST page, Primus
 * Epic ECL, Pro Line Fusion checklist window) for the `Checklist` data type
 * in aircraft/types.ts.
 *
 * Presentation (EST, from the G1000 checklist page conventions): title with
 * the phase, one line per item "CHALLENGE ........ RESPONSE", checked items
 * green with a check mark, unchecked white, the current item boxed in cyan,
 * "* CHECKLIST FINISHED *" once every item is checked. Items with an
 * automatic `check(vars)` are ticked by `autoCheck(vars)` (closed-loop
 * checklist as on Primus Epic/Fusion ECL).
 *
 * Usage:
 *   const view = new ChecklistView({ x, y, w, h, style: CHECKLIST_GARMIN });
 *   view.setChecklist(aircraft.checklists[0]);
 *   view.next(); view.toggle(); view.autoCheck(ctx.vars); view.draw(ctx2d);
 */
import type { Checklist } from '../../../aircraft/types';
import type { SimVars } from '../../../core/SimVars';
import { GARMIN_TYPEFACE, type Typeface } from '../fonts';
import { GARMIN_PALETTE, type AvionicsPalette } from '../palette';
import { box, line, type Ctx2D } from './context';

export interface ChecklistStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  fontSize: number;
  lineHeight: number;
  background: string;
  border: string;
  checkedColor: string;
  uncheckedColor: string;
  cursorColor: string;
}

export const CHECKLIST_GARMIN: ChecklistStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  fontSize: 17,
  lineHeight: 26,
  background: '#000000',
  border: '#9aa0a6',
  checkedColor: '#00ff00',
  uncheckedColor: '#ffffff',
  cursorColor: '#00ffff',
};

export interface ChecklistViewOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  style: ChecklistStyle;
}

export class ChecklistView {
  x: number;
  y: number;
  w: number;
  h: number;
  style: ChecklistStyle;
  checklist: Checklist | null = null;
  /** Checked state per item. */
  checked: boolean[] = [];
  cursor = 0;
  scroll = 0;

  constructor(opts: ChecklistViewOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.w = opts.w;
    this.h = opts.h;
    this.style = opts.style;
  }

  setChecklist(cl: Checklist | null): void {
    this.checklist = cl;
    this.checked = cl ? cl.items.map(() => false) : [];
    this.cursor = 0;
    this.scroll = 0;
  }

  get complete(): boolean {
    return this.checked.length > 0 && this.checked.every((c) => c);
  }

  get visibleRows(): number {
    return Math.max(1, Math.floor((this.h - this.style.lineHeight * 2 - 6) / this.style.lineHeight));
  }

  /** Moves the cursor (FMS knob / cursor keys). */
  move(delta: number): void {
    const n = this.checked.length;
    if (n === 0) return;
    this.cursor = Math.max(0, Math.min(n - 1, this.cursor + delta));
    this.keepVisible();
  }

  /** Toggles the item under the cursor (ENT / CHECK softkey) and advances to the next unchecked item. */
  toggle(): void {
    if (this.checked.length === 0) return;
    const was = this.checked[this.cursor];
    this.checked[this.cursor] = !was;
    if (!was) this.next();
  }

  /** Advances to the next unchecked item. */
  next(): void {
    const n = this.checked.length;
    for (let i = this.cursor + 1; i < n; i++) {
      if (!this.checked[i]) {
        this.cursor = i;
        this.keepVisible();
        return;
      }
    }
    this.cursor = Math.min(n - 1, this.cursor + 1);
    this.keepVisible();
  }

  /** Ticks every item whose automatic check passes (closed-loop items). */
  autoCheck(vars: SimVars): void {
    const cl = this.checklist;
    if (!cl) return;
    for (let i = 0; i < cl.items.length; i++) {
      const chk = cl.items[i].check;
      if (chk) this.checked[i] = chk(vars);
    }
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    box(ctx, this.x, this.y, this.w, this.h, st.background, st.border, 1.5);
    const cl = this.checklist;
    if (!cl) {
      st.typeface.draw(ctx, 'NO CHECKLIST', this.x + this.w / 2, this.y + this.h / 2, st.fontSize, p.grey, 'center', 'middle');
      return;
    }
    const lh = st.lineHeight;
    st.typeface.draw(ctx, cl.title.toUpperCase(), this.x + this.w / 2, this.y + lh / 2 + 3, st.fontSize, p.cyan, 'center', 'middle');
    line(ctx, this.x + 6, this.y + lh + 3, this.x + this.w - 6, this.y + lh + 3, st.border, 1);
    const rows = this.visibleRows;
    const top = this.y + lh + 6;
    for (let r = 0; r < rows; r++) {
      const i = this.scroll + r;
      const it = cl.items[i];
      if (!it) break;
      const y = top + r * lh;
      const cy = y + lh / 2 + 1;
      const done = this.checked[i];
      const color = done ? st.checkedColor : st.uncheckedColor;
      if (i === this.cursor) box(ctx, this.x + 4, y + 1, this.w - 8, lh - 2, '', st.cursorColor, 2);
      // Check box.
      box(ctx, this.x + 10, cy - 7, 14, 14, '', color, 1.5);
      if (done) {
        ctx.beginPath();
        ctx.moveTo(this.x + 12, cy);
        ctx.lineTo(this.x + 16, cy + 5);
        ctx.lineTo(this.x + 23, cy - 6);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      const lx = this.x + 32;
      const rx = this.x + this.w - 10;
      st.typeface.draw(ctx, it.challenge, lx, cy, st.fontSize, color, 'left', 'middle');
      st.typeface.draw(ctx, it.response, rx, cy, st.fontSize, color, 'right', 'middle');
      // Dotted leader between challenge and response.
      const cw = st.typeface.width(ctx, it.challenge, st.fontSize);
      const rw = st.typeface.width(ctx, it.response, st.fontSize);
      const x0 = lx + cw + 6;
      const x1 = rx - rw - 6;
      if (x1 > x0) {
        ctx.beginPath();
        for (let x = x0; x < x1; x += 6) {
          ctx.moveTo(x + 1, cy + 5);
          ctx.arc(x, cy + 5, 1, 0, Math.PI * 2);
        }
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
    if (this.complete) {
      st.typeface.draw(ctx, '* CHECKLIST FINISHED *', this.x + this.w / 2, this.y + this.h - lh / 2 - 2, st.fontSize, st.checkedColor, 'center', 'middle');
    }
  }

  private keepVisible(): void {
    const rows = this.visibleRows;
    if (this.cursor < this.scroll) this.scroll = this.cursor;
    if (this.cursor >= this.scroll + rows) this.scroll = this.cursor - rows + 1;
  }
}
