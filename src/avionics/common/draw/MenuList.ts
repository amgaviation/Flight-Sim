/**
 * Text UI helpers shared by MFD pages, CDU screens and PFD windows:
 *  - `MenuList`: scrolling list with a cursor (Garmin page menus, nearest
 *    lists, Primus Epic menus); disabled items are skipped by the cursor.
 *  - `DataField`: label/value field with selected (cursor) and editing
 *    states, flashing edit character (frequency, altitude, waypoint entry).
 *  - `ModeAnnunciator`: flight mode annunciation columns (Garmin AFCS status
 *    bar, Boeing FMA, Primus Epic / Fusion mode line): active mode green,
 *    armed mode white/cyan, change highlight on mode transitions. EST: Boeing
 *    draws a white "mode change highlight" rectangle around a newly engaged
 *    mode for 10 s (737NG AFDS description; the same 10 s white highlight is
 *    documented for other PFD readouts in FCOM 10.10, e.g. the radio
 *    altitude box); Garmin flashes the new annunciation (10 s).
 */
import { blinkOn } from '../dynamics';
import { GARMIN_TYPEFACE, type Typeface } from '../fonts';
import { GARMIN_PALETTE, type AvionicsPalette } from '../palette';
import { box, line, triangle, type Ctx2D } from './context';

export interface TextUiStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  fontSize: number;
  lineHeight: number;
  background: string;
  border: string;
  /** Cursor: filled highlight (Garmin cyan box, black text) or outline box. */
  cursor: 'fill' | 'outline';
  cursorColor: string;
  titleColor: string;
  itemColor: string;
  valueColor: string;
}

export const TEXT_UI_GARMIN: TextUiStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  fontSize: 17,
  lineHeight: 24,
  background: '#000000',
  border: '#9aa0a6',
  cursor: 'fill',
  cursorColor: '#00ffff',
  titleColor: '#ffffff',
  itemColor: '#ffffff',
  valueColor: '#00ffff',
};

// ------------------------------------------------------------------ MenuList

export interface MenuItem {
  label: string;
  /** Optional right-aligned value text. */
  value: string;
  enabled: boolean;
  /** Check/selection mark (radio-style options). */
  checked: boolean;
}

export interface MenuListOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  style: TextUiStyle;
  title?: string;
}

export class MenuList {
  readonly items: MenuItem[] = [];
  x: number;
  y: number;
  w: number;
  h: number;
  style: TextUiStyle;
  title: string;
  cursor = 0;
  scroll = 0;
  /** Cursor visible (Garmin: cursor shown after pushing the FMS knob). */
  cursorActive = true;

  constructor(opts: MenuListOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.w = opts.w;
    this.h = opts.h;
    this.style = opts.style;
    this.title = opts.title ?? '';
  }

  /** Replaces the items (allocates; call on page changes, not per frame). */
  setItems(items: readonly (string | Partial<MenuItem> & { label: string })[]): void {
    this.items.length = 0;
    for (const it of items) {
      if (typeof it === 'string') this.items.push({ label: it, value: '', enabled: true, checked: false });
      else this.items.push({ label: it.label, value: it.value ?? '', enabled: it.enabled ?? true, checked: it.checked ?? false });
    }
    this.cursor = Math.min(this.cursor, Math.max(0, this.items.length - 1));
    if (this.items.length > 0 && !this.items[this.cursor].enabled) this.move(1);
    this.clampScroll();
  }

  get visibleRows(): number {
    const titleH = this.title ? this.style.lineHeight : 0;
    return Math.max(1, Math.floor((this.h - titleH - 6) / this.style.lineHeight));
  }

  /** Moves the cursor by `delta` enabled items (FMS knob). Returns the new index. */
  move(delta: number): number {
    const n = this.items.length;
    if (n === 0) return -1;
    const dir = delta >= 0 ? 1 : -1;
    let steps = Math.abs(delta);
    let i = this.cursor;
    while (steps > 0) {
      let j = i + dir;
      while (j >= 0 && j < n && !this.items[j].enabled) j += dir;
      if (j < 0 || j >= n) break;
      i = j;
      steps--;
    }
    this.cursor = i;
    this.clampScroll();
    return i;
  }

  /** Selected item index (ENT), or -1 when the current item is disabled. */
  select(): number {
    const it = this.items[this.cursor];
    return it && it.enabled ? this.cursor : -1;
  }

  /** Item index under a point (touch displays), -1 if none. */
  itemAt(px: number, py: number): number {
    const titleH = this.title ? this.style.lineHeight : 0;
    if (px < this.x || px > this.x + this.w) return -1;
    const row = Math.floor((py - this.y - titleH - 3) / this.style.lineHeight);
    const i = this.scroll + row;
    return row >= 0 && row < this.visibleRows && i < this.items.length ? i : -1;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    box(ctx, this.x, this.y, this.w, this.h, st.background, st.border, 1.5);
    let y = this.y + 3;
    if (this.title) {
      st.typeface.draw(ctx, this.title, this.x + this.w / 2, y + st.lineHeight / 2, st.fontSize, st.titleColor, 'center', 'middle');
      line(ctx, this.x + 4, y + st.lineHeight, this.x + this.w - 4, y + st.lineHeight, st.border, 1);
      y += st.lineHeight;
    }
    const rows = this.visibleRows;
    for (let r = 0; r < rows; r++) {
      const i = this.scroll + r;
      const it = this.items[i];
      if (!it) break;
      const ry = y + r * st.lineHeight;
      const isCursor = this.cursorActive && i === this.cursor;
      if (isCursor) {
        if (st.cursor === 'fill') box(ctx, this.x + 4, ry + 2, this.w - 8, st.lineHeight - 4, st.cursorColor, '');
        else box(ctx, this.x + 4, ry + 2, this.w - 8, st.lineHeight - 4, '', st.cursorColor, 2);
      }
      const fill = isCursor && st.cursor === 'fill';
      const color = !it.enabled ? p.grey : fill ? p.black : st.itemColor;
      const cy = ry + st.lineHeight / 2 + 1;
      if (it.checked) triangle(ctx, this.x + 10, cy - 5, this.x + 10, cy + 5, this.x + 17, cy, color);
      st.typeface.draw(ctx, it.label, this.x + 22, cy, st.fontSize, color, 'left', 'middle');
      if (it.value) st.typeface.draw(ctx, it.value, this.x + this.w - 10, cy, st.fontSize, fill ? p.black : st.valueColor, 'right', 'middle');
    }
    // Scroll bar.
    if (this.items.length > rows) {
      const trackH = rows * st.lineHeight;
      const barH = Math.max(12, (trackH * rows) / this.items.length);
      const barY = y + ((trackH - barH) * this.scroll) / Math.max(1, this.items.length - rows);
      box(ctx, this.x + this.w - 5, barY, 3, barH, p.grey, '');
    }
  }

  private clampScroll(): void {
    const rows = this.visibleRows;
    if (this.cursor < this.scroll) this.scroll = this.cursor;
    if (this.cursor >= this.scroll + rows) this.scroll = this.cursor - rows + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.items.length - rows)));
  }
}

// ------------------------------------------------------------------ DataField

export interface DataFieldOptions {
  x: number;
  y: number;
  w: number;
  label?: string;
  style: TextUiStyle;
  /** Value colour when not selected ('' = style.valueColor). */
  color?: string;
  align?: 'left' | 'right' | 'center';
}

/**
 * A labelled value. States: normal, selected (cursor box), editing (the
 * character at `editPos` flashes / is boxed). Editing logic (which digits
 * are allowed) belongs to the owner; `DataField` only renders.
 */
export class DataField {
  x: number;
  y: number;
  w: number;
  label: string;
  style: TextUiStyle;
  color: string;
  align: 'left' | 'right' | 'center';
  value = '';
  selected = false;
  editing = false;
  editPos = 0;
  private time = 0;

  constructor(opts: DataFieldOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.w = opts.w;
    this.label = opts.label ?? '';
    this.style = opts.style;
    this.color = opts.color ?? '';
    this.align = opts.align ?? 'right';
  }

  update(dt: number): void {
    this.time += dt;
  }

  get animating(): boolean {
    return this.editing;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const h = st.lineHeight;
    if (this.label) st.typeface.draw(ctx, this.label, this.x, this.y + h / 2, st.fontSize * 0.85, p.white, 'left', 'middle');
    const vx = this.align === 'right' ? this.x + this.w - 4 : this.align === 'center' ? this.x + this.w / 2 : this.x + 4;
    if (this.selected && !this.editing) {
      const tw = st.typeface.width(ctx, this.value, st.fontSize);
      const bx = this.align === 'right' ? vx - tw - 3 : this.align === 'center' ? vx - tw / 2 - 3 : vx - 3;
      if (st.cursor === 'fill') box(ctx, bx, this.y + 1, tw + 6, h - 2, st.cursorColor, '');
      else box(ctx, bx, this.y + 1, tw + 6, h - 2, '', st.cursorColor, 2);
    }
    const color = this.selected && !this.editing && st.cursor === 'fill' ? p.black : this.color || st.valueColor;
    st.typeface.draw(ctx, this.value, vx, this.y + h / 2 + 1, st.fontSize, color, this.align, 'middle');
    if (this.editing && this.value.length > 0) {
      // Box the character being edited; it blinks.
      const ch = this.value[Math.min(this.editPos, this.value.length - 1)];
      const full = st.typeface.width(ctx, this.value, st.fontSize);
      const start = this.align === 'right' ? vx - full : this.align === 'center' ? vx - full / 2 : vx;
      const pre = st.typeface.width(ctx, this.value.slice(0, this.editPos), st.fontSize);
      const cw = st.typeface.width(ctx, ch, st.fontSize);
      if (blinkOn(this.time, 2)) box(ctx, start + pre - 1, this.y + 1, cw + 2, h - 2, st.cursorColor, '');
      st.typeface.draw(ctx, ch, start + pre, this.y + h / 2 + 1, st.fontSize, p.black, 'left', 'middle');
    }
  }
}

// ------------------------------------------------------------------ ModeAnnunciator

export interface FmaColumn {
  active: string;
  armed: string;
  /** Override colours ('' = style defaults). */
  activeColor: string;
  armedColor: string;
  /** Seconds left of the mode-change highlight (managed by update()). */
  changeLeft: number;
  lastActive: string;
}

export interface FmaStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  fontSize: number;
  /** 'box': outline box around a changed mode (Boeing); 'flash': flashing text (Garmin). */
  change: 'box' | 'flash';
  changeSeconds: number;
  separator: string;
  background: string;
}

export const FMA_GARMIN: FmaStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  fontSize: 19,
  change: 'flash',
  changeSeconds: 10,
  separator: '#9aa0a6',
  background: 'rgba(0,0,0,0.75)',
};

export interface ModeAnnunciatorOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  columns: number;
  style: FmaStyle;
}

export class ModeAnnunciator {
  readonly columns: FmaColumn[] = [];
  x: number;
  y: number;
  w: number;
  h: number;
  style: FmaStyle;
  private time = 0;

  constructor(opts: ModeAnnunciatorOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.w = opts.w;
    this.h = opts.h;
    this.style = opts.style;
    for (let i = 0; i < opts.columns; i++) this.columns.push({ active: '', armed: '', activeColor: '', armedColor: '', changeLeft: 0, lastActive: '' });
  }

  /** Sets column i; a change of the active mode starts the change highlight. */
  set(i: number, active: string, armed = '', activeColor = '', armedColor = ''): void {
    const c = this.columns[i];
    if (!c) return;
    c.active = active;
    c.armed = armed;
    c.activeColor = activeColor;
    c.armedColor = armedColor;
  }

  get animating(): boolean {
    for (const c of this.columns) if (c.changeLeft > 0) return true;
    return false;
  }

  update(dt: number): void {
    this.time += dt;
    for (const c of this.columns) {
      if (c.active !== c.lastActive) {
        if (c.active) c.changeLeft = this.style.changeSeconds;
        c.lastActive = c.active;
      } else if (c.changeLeft > 0) c.changeLeft -= dt;
    }
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const p = st.palette;
    const n = this.columns.length;
    const cw = this.w / n;
    if (st.background) box(ctx, this.x, this.y, this.w, this.h, st.background, '');
    const blink = blinkOn(this.time);
    for (let i = 0; i < n; i++) {
      const c = this.columns[i];
      const cx = this.x + i * cw + cw / 2;
      if (i > 0) line(ctx, this.x + i * cw, this.y + 3, this.x + i * cw, this.y + this.h - 3, st.separator, 1.5);
      const hasArmed = c.armed.length > 0;
      const ay = hasArmed ? this.y + this.h * 0.32 : this.y + this.h / 2;
      if (c.active) {
        const changing = c.changeLeft > 0;
        const color = c.activeColor || p.green;
        const hide = changing && st.change === 'flash' && !blink;
        if (!hide) st.typeface.draw(ctx, c.active, cx, ay + 1, st.fontSize, color, 'center', 'middle');
        if (changing && st.change === 'box') {
          const tw = st.typeface.width(ctx, c.active, st.fontSize);
          box(ctx, cx - tw / 2 - 5, ay - st.fontSize * 0.62, tw + 10, st.fontSize * 1.24, '', p.white, 1.5);
        }
      }
      if (hasArmed) st.typeface.draw(ctx, c.armed, cx, this.y + this.h * 0.74, st.fontSize * 0.85, c.armedColor || p.white, 'center', 'middle');
    }
  }
}
