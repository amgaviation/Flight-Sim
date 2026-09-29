/**
 * GTC touchscreen widgets (retained): buttons with icon / label / cyan value
 * line / green annunciator, text, lists, custom-drawn areas. Pages build
 * their widgets once per layout; values come from getter functions that
 * return cached strings, so a steady screen allocates nothing.
 *
 * Look (G3000 PG 190-02046-01 §1.3 "Touchscreen Controller", TBM CRG screen
 * figures): dark dotted background, dark grey buttons with a light bevelled
 * edge, white labels, cyan values, cyan border around the selected button,
 * blue fill while a button is touched (input is accepted when the finger is
 * released inside the button), subdued text for unavailable buttons.
 */
import type { Ctx2D, Rect } from '../../common/draw/context';
import { box, circle, line } from '../../common/draw/context';
import { G3K_PALETTE, TF } from '../gdu/style';

const P = G3K_PALETTE;

export const GTC_COLORS = {
  bg: '#23262a',
  bgDot: '#2d3135',
  button: '#2a2e33',
  buttonTop: '#3a3f45',
  buttonEdge: '#8d949b',
  pressed: '#1f6fb8',
  selected: '#00d8f0',
  subdued: '#62686e',
  title: '#10222a',
  titleEdge: '#3fb6c8',
  bar: '#15171a',
  barEdge: '#4a4f55',
  listRow: '#2a2e33',
  listRowAlt: '#262a2e',
  green: '#00e000',
} as const;

export type IconName =
  | 'map' | 'traffic' | 'weather' | 'fpl' | 'proc' | 'direct' | 'nearest' | 'waypoint' | 'systems' | 'checklist' | 'utilities'
  | 'perf' | 'charts' | 'speed' | 'timer' | 'mins' | 'sensors' | 'settings' | 'radio' | 'xpdr' | 'audio' | 'back' | 'home'
  | 'msg' | 'full' | 'half' | 'split' | 'up' | 'down' | 'enter' | 'cancel' | 'airport' | 'vor' | 'ndb' | 'int' | 'taws' | 'mappfd'
  | 'wf' | 'trip' | 'gps' | 'init' | 'avionics' | 'bkspc';

export type Getter<T> = T | (() => T);
export function get<T>(g: Getter<T>): T {
  return typeof g === 'function' ? (g as () => T)() : g;
}

export abstract class Widget {
  visible: () => boolean = () => true;
  constructor(
    public x: number,
    public y: number,
    public w: number,
    public h: number,
  ) {}
  hit(px: number, py: number): boolean {
    return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h;
  }
  /** True when a press here does something (for the touch highlight). */
  get interactive(): boolean {
    return false;
  }
  /** Touch released inside the widget. */
  press(_px: number, _py: number): void {}
  /** Wheel / drag scroll (lists). */
  scroll(_rows: number): void {}
  abstract draw(ctx: Ctx2D, pressed: boolean): void;
}

export interface ButtonOptions {
  label: Getter<string>;
  /** Cyan value line under the label ('FMS', '118.00'). */
  value?: Getter<string>;
  valueColor?: Getter<string>;
  icon?: IconName | (() => IconName | undefined);
  /** Green (true) / grey (false) annunciator bar; undefined = none. */
  annun?: () => boolean | undefined;
  selected?: () => boolean;
  disabled?: () => boolean;
  onPress?: () => void;
  /** Label size (default: fitted to the button). */
  size?: number;
  /** Left-aligned label (list-like buttons). */
  align?: 'center' | 'left';
}

/** Standard GTC button. */
export class Button extends Widget {
  constructor(x: number, y: number, w: number, h: number, readonly o: ButtonOptions) {
    super(x, y, w, h);
  }
  override get interactive(): boolean {
    return !!this.o.onPress && !(this.o.disabled?.() ?? false);
  }
  override press(): void {
    if (this.o.disabled?.()) return;
    this.o.onPress?.();
  }
  draw(ctx: Ctx2D, pressed: boolean): void {
    const o = this.o;
    const disabled = o.disabled?.() ?? false;
    const sel = o.selected?.() ?? false;
    drawButtonFrame(ctx, this.x, this.y, this.w, this.h, pressed && !disabled, sel);
    const label = get(o.label);
    const value = o.value !== undefined ? get(o.value) : '';
    const col = disabled ? GTC_COLORS.subdued : P.white;
    const size = o.size ?? Math.min(22, Math.max(14, this.h * 0.2));
    const icon = typeof o.icon === 'function' ? o.icon() : o.icon;
    const hasIcon = !!icon && this.h >= 72;
    const lines = splitLines(ctx, label, this.w - 12, size);
    const lh = size * 1.12;
    const textH = lines.length * lh + (value ? lh : 0);
    let ty: number;
    if (hasIcon) {
      drawIcon(ctx, icon!, this.x + this.w / 2, this.y + this.h * 0.32, Math.min(this.h * 0.36, this.w * 0.4), disabled);
      ty = this.y + this.h * 0.64 + lh / 2 - (textH - lh) / 2 + (lines.length > 1 ? lh * 0.35 : 0);
      if (ty + textH > this.y + this.h - 4) ty = this.y + this.h - 4 - textH + lh / 2;
    } else ty = this.y + this.h / 2 - textH / 2 + lh / 2;
    const tx = o.align === 'left' ? this.x + 12 : this.x + this.w / 2;
    const al = o.align === 'left' ? 'left' : 'center';
    for (let i = 0; i < lines.length; i++) TF.draw(ctx, lines[i], tx, ty + i * lh, size, col, al, 'middle');
    if (value) TF.draw(ctx, value, tx, ty + lines.length * lh, size, disabled ? GTC_COLORS.subdued : o.valueColor ? get(o.valueColor) : P.cyan, al, 'middle');
    const ann = o.annun?.();
    if (ann !== undefined) line(ctx, this.x + this.w * 0.25, this.y + this.h - 6, this.x + this.w * 0.75, this.y + this.h - 6, ann && !disabled ? GTC_COLORS.green : GTC_COLORS.subdued, 4);
  }
}

/** Static or dynamic text. */
export class Text extends Widget {
  constructor(
    x: number,
    y: number,
    readonly text: Getter<string>,
    readonly size = 18,
    readonly color: Getter<string> = P.white,
    readonly align: 'left' | 'center' | 'right' = 'left',
  ) {
    super(x, y, 0, 0);
  }
  override hit(): boolean {
    return false;
  }
  draw(ctx: Ctx2D): void {
    const t = get(this.text);
    if (t) TF.draw(ctx, t, this.x, this.y, this.size, get(this.color), this.align, 'middle');
  }
}

/** Custom-drawn area with an optional press handler (receives absolute coordinates). */
export class Custom extends Widget {
  constructor(
    x: number,
    y: number,
    w: number,
    h: number,
    readonly drawFn: (ctx: Ctx2D, r: Rect) => void,
    readonly onPress?: (px: number, py: number) => void,
  ) {
    super(x, y, w, h);
  }
  override get interactive(): boolean {
    return !!this.onPress;
  }
  override press(px: number, py: number): void {
    this.onPress?.(px, py);
  }
  draw(ctx: Ctx2D): void {
    this.drawFn(ctx, this);
  }
}

export interface ListOptions {
  count: () => number;
  rowH: number;
  drawRow: (ctx: Ctx2D, i: number, x: number, y: number, w: number, h: number) => void;
  onRow?: (i: number, px: number) => void;
  /** Row to keep in view (e.g. the active leg) when the list first shows. */
  anchor?: () => number;
}

/** Scrolling list (Up / Down buttons, wheel, or the knob scroll it). */
export class ListView extends Widget {
  first = 0;
  private anchored = false;
  constructor(x: number, y: number, w: number, h: number, readonly o: ListOptions) {
    super(x, y, w, h);
  }
  get rows(): number {
    return Math.max(1, Math.floor(this.h / this.o.rowH));
  }
  override get interactive(): boolean {
    return !!this.o.onRow;
  }
  override scroll(rows: number): void {
    const max = Math.max(0, this.o.count() - this.rows);
    this.first = Math.max(0, Math.min(max, this.first + rows));
  }
  override press(px: number, py: number): void {
    const i = this.first + Math.floor((py - this.y) / this.o.rowH);
    if (i >= 0 && i < this.o.count()) this.o.onRow?.(i, px);
  }
  draw(ctx: Ctx2D): void {
    const n = this.o.count();
    if (!this.anchored && this.o.anchor) {
      this.anchored = true;
      const a = this.o.anchor();
      if (a >= this.rows - 1) this.first = Math.min(Math.max(0, n - this.rows), a - 1);
    }
    if (this.first > Math.max(0, n - this.rows)) this.first = Math.max(0, n - this.rows);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x, this.y, this.w, this.h);
    ctx.clip();
    const rh = this.o.rowH;
    for (let k = 0; k < this.rows + 1 && this.first + k < n; k++) {
      const i = this.first + k;
      this.o.drawRow(ctx, i, this.x, this.y + k * rh, this.w, rh);
    }
    ctx.restore();
    // Scroll bar.
    if (n > this.rows) {
      const bx = this.x + this.w - 5;
      box(ctx, bx, this.y, 4, this.h, '#1a1c1f', '');
      const hh = Math.max(16, (this.h * this.rows) / n);
      const yy = this.y + ((this.h - hh) * this.first) / Math.max(1, n - this.rows);
      box(ctx, bx, yy, 4, hh, '#9aa0a6', '');
    }
  }
}

// ------------------------------------------------------------------ drawing helpers

export function drawButtonFrame(ctx: Ctx2D, x: number, y: number, w: number, h: number, pressed: boolean, selected: boolean): void {
  box(ctx, x, y, w, h, pressed ? GTC_COLORS.pressed : GTC_COLORS.button, selected ? GTC_COLORS.selected : GTC_COLORS.buttonEdge, selected ? 3 : 1.2, 4);
  if (!pressed) line(ctx, x + 4, y + 3, x + w - 4, y + 3, GTC_COLORS.buttonTop, 3);
}

/** Title tab at the top of the screen (TBM CRG figures: dark trapezoid with a cyan edge). */
export function drawTitleTab(ctx: Ctx2D, cx: number, y: number, text: string, size: number): void {
  const w = Math.max(220, TF.width(ctx, text, size) + 70);
  const h = size + 12;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, y);
  ctx.lineTo(cx + w / 2, y);
  ctx.lineTo(cx + w / 2 - 14, y + h);
  ctx.lineTo(cx - w / 2 + 14, y + h);
  ctx.closePath();
  ctx.fillStyle = GTC_COLORS.title;
  ctx.fill();
  ctx.strokeStyle = GTC_COLORS.titleEdge;
  ctx.lineWidth = 2;
  ctx.stroke();
  TF.draw(ctx, text, cx, y + h / 2 + 1, size, P.white, 'center', 'middle');
}

const SPLIT = new Map<string, Map<number, string[]>>();
/** Word-wraps a label into at most three lines (cached per label and geometry, no allocation when cached). */
export function splitLines(ctx: Ctx2D, s: string, maxW: number, size: number): string[] {
  let m = SPLIT.get(s);
  if (!m) {
    if (SPLIT.size > 2048) SPLIT.clear();
    SPLIT.set(s, (m = new Map()));
  }
  const key = ((maxW / 4) | 0) * 128 + (size | 0);
  let r = m.get(key);
  if (r) return r;
  r = [];
  if (s.indexOf('\n') >= 0) r = s.split('\n');
  else {
    const words = s.split(' ');
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && TF.width(ctx, t, size) > maxW) {
        r.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) r.push(cur);
  }
  if (r.length > 3) r = [r[0], r[1], r.slice(2).join(' ')];
  m.set(key, r);
  return r;
}

/** Simple vector icons in the Garmin GTC colours (EST shapes after the GTC home-screen icons). */
export function drawIcon(ctx: Ctx2D, name: IconName, cx: number, cy: number, s: number, disabled = false): void {
  const c1 = disabled ? GTC_COLORS.subdued : '#39c6e0';
  const c2 = disabled ? GTC_COLORS.subdued : '#d25cf0';
  const c3 = disabled ? GTC_COLORS.subdued : '#e8e8e8';
  const c4 = disabled ? GTC_COLORS.subdued : '#f0a020';
  const c5 = disabled ? GTC_COLORS.subdued : '#20c040';
  const h = s / 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const poly = (pts: number[], col: string, fill = false, lw = 3): void => {
    ctx.beginPath();
    ctx.moveTo(cx + pts[0] * h, cy + pts[1] * h);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(cx + pts[i] * h, cy + pts[i + 1] * h);
    if (fill) {
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    } else {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  };
  switch (name) {
    case 'map':
      poly([-1, -0.6, -0.35, -0.9, 0.35, -0.6, 1, -0.9, 1, 0.6, 0.35, 0.9, -0.35, 0.6, -1, 0.9], '#4f7a3a', true);
      poly([-0.8, 0.5, -0.2, -0.1, 0.4, 0.2, 0.8, -0.5], c2, false, 3);
      break;
    case 'mappfd':
      circle(ctx, cx, cy, h * 0.9, '', c3, 2);
      poly([-0.6, 0.4, 0, -0.2, 0.6, 0.1], c2, false, 3);
      break;
    case 'traffic':
      poly([0, -0.8, 0.5, 0, 0, 0.8, -0.5, 0], c3, true);
      poly([0.3, -0.9, 0.9, -0.3], c1, false, 2);
      circle(ctx, cx + h * 0.6, cy + h * 0.6, h * 0.25, c4, '', 0);
      break;
    case 'weather':
      circle(ctx, cx - h * 0.2, cy, h * 0.5, c5, '', 0);
      circle(ctx, cx + h * 0.2, cy + h * 0.1, h * 0.35, '#e8e020', '', 0);
      circle(ctx, cx + h * 0.25, cy + h * 0.1, h * 0.15, '#e02020', '', 0);
      break;
    case 'taws':
      poly([-1, 0.8, -0.4, -0.3, 0, 0.2, 0.4, -0.7, 1, 0.8], '#c8a020', true);
      poly([-0.4, -0.3, 0, 0.2, 0.4, -0.7], '#e02020', false, 3);
      break;
    case 'fpl':
      poly([-0.9, 0.6, -0.3, -0.2, 0.3, 0.3, 0.9, -0.6], c2, false, 3);
      circle(ctx, cx - h * 0.3, cy - h * 0.2, h * 0.14, c3, '', 0);
      circle(ctx, cx + h * 0.3, cy + h * 0.3, h * 0.14, c3, '', 0);
      break;
    case 'proc':
      poly([-0.9, 0.8, -0.9, -0.2, 0.2, -0.2, 0.2, -0.8, 0.9, -0.8], c1, false, 3);
      poly([0.5, 0.2, 0.9, 0.8], c2, false, 3);
      break;
    case 'direct':
      TF.draw(ctx, 'D', cx - h * 0.35, cy, s * 0.62, c2, 'center', 'middle');
      poly([-0.1, 0, 0.8, 0], c2, false, 3);
      poly([0.5, -0.3, 0.85, 0, 0.5, 0.3], c2, false, 3);
      break;
    case 'nearest':
    case 'airport':
      circle(ctx, cx, cy, h * 0.55, c2, '', 0);
      poly([-0.35, 0.35, 0.35, -0.35], c3, false, 3);
      break;
    case 'waypoint':
    case 'int':
      poly([0, -0.8, 0.7, 0.6, -0.7, 0.6], c1, true);
      break;
    case 'vor':
      poly([-0.8, 0, -0.4, -0.7, 0.4, -0.7, 0.8, 0, 0.4, 0.7, -0.4, 0.7, -0.8, 0], c1, false, 3);
      circle(ctx, cx, cy, h * 0.15, c1, '', 0);
      break;
    case 'ndb':
      for (let r = 0.3; r <= 0.9; r += 0.3) circle(ctx, cx, cy, h * r, '', c2, 2);
      break;
    case 'systems':
      circle(ctx, cx, cy, h * 0.6, '', c3, 3);
      poly([0, -0.6, 0, 0], c4, false, 3);
      poly([0, 0, 0.4, 0.3], c4, false, 3);
      break;
    case 'checklist':
      box(ctx, cx - h * 0.6, cy - h * 0.8, h * 1.2, h * 1.6, '#e8e8e8', '', 1, 2);
      for (let i = 0; i < 3; i++) line(ctx, cx - h * 0.35, cy - h * 0.4 + i * h * 0.4, cx + h * 0.4, cy - h * 0.4 + i * h * 0.4, '#303030', 2);
      poly([-0.5, 0.55, -0.3, 0.75, 0.2, 0.2], c5, false, 3);
      break;
    case 'utilities':
    case 'settings':
    case 'avionics':
      circle(ctx, cx, cy, h * 0.55, '', c3, 5);
      circle(ctx, cx, cy, h * 0.2, c3, '', 0);
      break;
    case 'perf':
      poly([-0.9, 0.6, -0.3, 0.1, 0.2, 0.3, 0.9, -0.6], c5, false, 3);
      poly([-0.9, 0.8, 0.9, 0.8], c3, false, 2);
      break;
    case 'charts':
      box(ctx, cx - h * 0.6, cy - h * 0.8, h * 1.2, h * 1.6, '#e8e8e8', '', 1, 2);
      poly([-0.3, 0.5, 0.2, -0.4], c2, false, 2);
      break;
    case 'speed':
      TF.draw(ctx, 'V', cx, cy, s * 0.7, c1, 'center', 'middle');
      break;
    case 'timer':
      circle(ctx, cx, cy, h * 0.7, '', c3, 3);
      poly([0, -0.5, 0, 0, 0.35, 0.2], c3, false, 3);
      break;
    case 'mins':
      TF.draw(ctx, 'MIN', cx, cy, s * 0.36, c1, 'center', 'middle');
      break;
    case 'sensors':
      circle(ctx, cx, cy, h * 0.6, '', c1, 3);
      poly([-0.6, 0, 0.6, 0], c3, false, 2);
      break;
    case 'radio':
    case 'audio':
      poly([-0.7, -0.3, -0.3, -0.3, 0.2, -0.7, 0.2, 0.7, -0.3, 0.3, -0.7, 0.3], c3, true);
      poly([0.45, -0.4, 0.6, 0, 0.45, 0.4], c3, false, 2);
      break;
    case 'xpdr':
      TF.draw(ctx, 'XPDR', cx, cy, s * 0.3, c3, 'center', 'middle');
      break;
    case 'wf':
      box(ctx, cx - h * 0.8, cy - h * 0.4, h * 0.9, h * 0.9, '#a07040', '', 1, 2);
      box(ctx, cx + h * 0.1, cy - h * 0.6, h * 0.6, h * 1.1, '#c0c4c8', '', 1, 2);
      break;
    case 'trip':
      poly([-0.8, 0.6, 0, -0.6, 0.8, 0.6], c2, false, 3);
      break;
    case 'gps':
      for (let i = 0; i < 5; i++) box(ctx, cx - h * 0.8 + i * h * 0.34, cy + h * 0.6 - h * (0.3 + i * 0.25), h * 0.22, h * (0.3 + i * 0.25), c1, '', 1, 0);
      break;
    case 'init':
      poly([-0.6, 0, -0.2, 0.5, 0.7, -0.6], c5, false, 4);
      break;
    case 'back':
      poly([0.7, 0.4, 0.7, -0.1, -0.5, -0.1], c1, false, 5);
      poly([-0.2, -0.45, -0.6, -0.1, -0.2, 0.25], c1, false, 5);
      break;
    case 'home':
      poly([-0.8, 0, 0, -0.7, 0.8, 0], c1, false, 4);
      box(ctx, cx - h * 0.5, cy, h, h * 0.6, c3, '', 1, 0);
      break;
    case 'msg':
      box(ctx, cx - h * 0.6, cy - h * 0.6, h * 1.2, h * 1.2, '#1b4f63', c1, 2, 3);
      TF.draw(ctx, 'M', cx, cy + 1, s * 0.5, c3, 'center', 'middle');
      break;
    case 'full':
    case 'split':
    case 'half':
      box(ctx, cx - h * 0.7, cy - h * 0.5, h * 1.4, h, '', c1, 2, 2);
      if (name !== 'full') line(ctx, cx, cy - h * 0.5, cx, cy + h * 0.5, c1, 2);
      break;
    case 'up':
      poly([-0.6, 0.3, 0, -0.4, 0.6, 0.3], c1, true);
      break;
    case 'down':
      poly([-0.6, -0.3, 0, 0.4, 0.6, -0.3], c1, true);
      break;
    case 'enter':
      poly([0.6, -0.5, 0.6, 0.2, -0.5, 0.2], c5, false, 4);
      poly([-0.2, -0.1, -0.55, 0.2, -0.2, 0.5], c5, false, 4);
      break;
    case 'cancel':
      poly([-0.5, -0.5, 0.5, 0.5], '#e04040', false, 4);
      poly([0.5, -0.5, -0.5, 0.5], '#e04040', false, 4);
      break;
    case 'bkspc':
      poly([-0.8, 0, -0.4, -0.5, 0.8, -0.5, 0.8, 0.5, -0.4, 0.5, -0.8, 0], c3, false, 2);
      poly([-0.1, -0.2, 0.4, 0.2], c3, false, 2);
      poly([0.4, -0.2, -0.1, 0.2], c3, false, 2);
      break;
  }
}
