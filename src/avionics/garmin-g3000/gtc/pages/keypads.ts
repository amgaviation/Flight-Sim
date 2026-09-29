/**
 * GTC data entry dialogs: numeric keypad (frequencies, squawk, altitudes,
 * speeds, times), alphanumeric keypad (waypoint identifiers, G3000 PG §1.3
 * "Keypads": letters, numbers, backspace, Enter; the dual knob also enters
 * characters: inner = character, outer = cursor), and a generic list picker
 * (duplicate waypoints, procedures, runways, transitions).
 */
import type { Ctx2D, Rect } from '../../../common/draw/context';
import { box } from '../../../common/draw/context';
import { G3K_PALETTE, TF } from '../../gdu/style';
import type { GtcController } from '../GtcController';
import { GtcPage, type BarButton, type KnobId, type KnobSlot } from '../GtcPage';
import { GTC_COLORS, type ButtonOptions, type Getter } from '../ui';

const P = G3K_PALETTE;

export interface NumericKeypadOptions {
  title: string;
  /** Current value shown until the first key press. */
  initial?: Getter<string>;
  maxDigits: number;
  /** Allowed digits (default '0123456789'; '01234567' for squawk codes). */
  digits?: string;
  decimal?: boolean;
  sign?: boolean;
  /** Formats the typed buffer ('123.4' -> '123.4_'). */
  format?: (buf: string) => string;
  unit?: string;
  /** Applies the entry; return false for "Invalid entry" (keypad stays open). */
  onEnter: (buf: string) => boolean;
  /** Extra buttons shown beside the keypad (VFR, XFER, IDENT...). */
  extra?: ButtonOptions[];
  /** Keeps the keypad open after Enter (radio tuning pages). */
  stayOpen?: boolean;
}

function keypadRects(r: Rect, extra: number): { field: Rect; keys: Rect; side: Rect | null } {
  const horizontal = r.w > r.h * 1.3;
  const fieldH = Math.min(90, r.h * 0.18);
  const field = { x: r.x + 10, y: r.y + 6, w: r.w - 20, h: fieldH };
  const top = r.y + fieldH + 14;
  if (horizontal) {
    const kw = Math.min(r.w * 0.55, (r.h - fieldH - 20) * 0.95);
    const keys = { x: r.x + (extra ? 10 : (r.w - kw) / 2), y: top, w: kw, h: r.y + r.h - top - 4 };
    const side = extra ? { x: keys.x + kw + 20, y: top, w: r.x + r.w - keys.x - kw - 30, h: keys.h } : null;
    return { field, keys, side };
  }
  const sideH = extra ? Math.min(90, r.h * 0.16) : 0;
  const keys = { x: r.x + 4, y: top, w: r.w - 8, h: r.y + r.h - top - sideH - 6 };
  const side = extra ? { x: r.x + 4, y: keys.y + keys.h + 2, w: r.w - 8, h: sideH } : null;
  return { field, keys, side };
}

export class NumericKeypadPage extends GtcPage {
  readonly title: string;
  buf = '';
  private touched = false;
  override dialog = true;

  constructor(gtc: GtcController, readonly o: NumericKeypadOptions) {
    super(gtc);
    this.title = o.title;
  }

  /** Types one key ('0'..'9', '.', '-', 'BKSP'). Public for tests. */
  key(k: string): void {
    const o = this.o;
    if (!this.touched) {
      this.touched = true;
      this.buf = '';
    }
    if (k === 'BKSP') this.buf = this.buf.slice(0, -1);
    else if (k === '-') this.buf = this.buf.startsWith('-') ? this.buf.slice(1) : '-' + this.buf;
    else if (k === '.') {
      if (o.decimal && !this.buf.includes('.')) this.buf += '.';
    } else if ((o.digits ?? '0123456789').includes(k) && this.buf.replace(/[-.]/g, '').length < o.maxDigits) this.buf += k;
    this.gtc.revision++;
  }

  enter(): boolean {
    const ok = this.o.onEnter(this.buf);
    if (!ok) {
      this.gtc.flash('Invalid entry');
      return false;
    }
    if (this.o.stayOpen) {
      this.buf = '';
      this.touched = false;
    } else this.gtc.back();
    return true;
  }

  get display(): string {
    if (!this.touched) return this.o.initial !== undefined ? (typeof this.o.initial === 'function' ? this.o.initial() : this.o.initial) : '';
    return this.o.format ? this.o.format(this.buf) : this.buf + '_';
  }

  protected build(r: Rect): void {
    const o = this.o;
    const L = keypadRects(r, o.extra?.length ?? 0);
    this.custom(L.field.x, L.field.y, L.field.w, L.field.h, (ctx) => this.drawField(ctx, L.field));
    const digits = o.digits ?? '0123456789';
    const k = (d: string): ButtonOptions => ({ label: d, size: 30, onPress: () => this.key(d), disabled: () => d.length === 1 && d >= '0' && d <= '9' && !digits.includes(d) });
    this.grid(L.keys, 3, 4, [
      k('1'), k('2'), k('3'),
      k('4'), k('5'), k('6'),
      k('7'), k('8'), k('9'),
      o.sign ? { label: '+/-', size: 26, onPress: () => this.key('-') } : o.decimal ? { label: '.', size: 30, onPress: () => this.key('.') } : null,
      k('0'),
      { label: 'BKSP', icon: 'bkspc', size: 18, onPress: () => this.key('BKSP') },
    ], 8);
    if (L.side && o.extra) {
      const n = o.extra.length;
      const horizontal = L.side.w < L.side.h;
      this.grid(L.side, horizontal ? 1 : n, horizontal ? Math.max(4, n) : 1, o.extra, 8);
    }
  }

  private drawField(ctx: Ctx2D, f: Rect): void {
    box(ctx, f.x, f.y, f.w, f.h, '#000000', GTC_COLORS.buttonEdge, 1.5, 4);
    const t = this.display;
    const size = Math.min(48, f.h * 0.6);
    TF.draw(ctx, t || ' ', f.x + f.w / 2, f.y + f.h / 2 + 2, size, this.touched ? P.cyan : P.white, 'center', 'middle');
    if (this.o.unit) TF.draw(ctx, this.o.unit, f.x + f.w - 12, f.y + f.h / 2 + 6, size * 0.45, P.cyan, 'right', 'middle');
  }

  override barButtons(): readonly BarButton[] {
    return this.bar;
  }
  private readonly bar: BarButton[] = [{ label: 'Enter', icon: 'enter', press: () => this.enter() }];

  override onKnob(k: KnobId, clicks: number): boolean {
    if (k === 'upperPush') {
      this.enter();
      return true;
    }
    return false;
  }
}

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CHARS = ALPHA + '0123456789';

export interface AlphaKeypadOptions {
  title: string;
  initial?: string;
  maxLen?: number;
  onEnter: (text: string) => boolean;
  /** Hint line under the field (e.g. the facility name of the typed ident). */
  hint?: (text: string) => string;
}

export class AlphaKeypadPage extends GtcPage {
  readonly title: string;
  entry: string;
  override dialog = true;
  private readonly bar: BarButton[];

  constructor(gtc: GtcController, readonly o: AlphaKeypadOptions) {
    super(gtc);
    this.title = o.title;
    this.entry = o.initial ?? '';
    this.bar = [{ label: 'Enter', icon: 'enter', press: () => this.enter() }];
  }

  key(k: string): void {
    if (k === 'BKSP') this.entry = this.entry.slice(0, -1);
    else if (this.entry.length < (this.o.maxLen ?? 7)) this.entry += k;
    this.gtc.revision++;
  }

  enter(): boolean {
    if (!this.entry) return false;
    const ok = this.o.onEnter(this.entry);
    if (!ok) this.gtc.flash(`${this.entry} not found`);
    return ok;
  }

  protected build(r: Rect): void {
    const horizontal = r.w > r.h * 1.3;
    const fieldH = Math.min(84, r.h * 0.16);
    const f = { x: r.x + 10, y: r.y + 6, w: r.w - 20, h: fieldH };
    this.custom(f.x, f.y, f.w, f.h, (ctx) => {
      box(ctx, f.x, f.y, f.w, f.h, '#000000', GTC_COLORS.buttonEdge, 1.5, 4);
      const hint = this.o.hint ? this.o.hint(this.entry) : '';
      const size = Math.min(40, f.h * 0.5);
      TF.draw(ctx, this.entry + '_', f.x + f.w / 2, f.y + (hint ? f.h * 0.38 : f.h / 2) + 2, size, P.cyan, 'center', 'middle');
      if (hint) TF.draw(ctx, hint, f.x + f.w / 2, f.y + f.h * 0.78, size * 0.45, P.white, 'center', 'middle');
    });
    const top = f.y + f.h + 8;
    const cols = horizontal ? 10 : 6;
    const keys: ButtonOptions[] = [];
    for (const c of CHARS) keys.push({ label: c, size: horizontal ? 26 : 22, onPress: () => this.key(c) });
    keys.push({ label: 'BKSP', icon: 'bkspc', size: 15, onPress: () => this.key('BKSP') });
    const rows = Math.ceil(keys.length / cols);
    this.grid({ x: r.x, y: top, w: r.w, h: r.y + r.h - top }, cols, rows, keys, horizontal ? 8 : 5);
  }

  override barButtons(): readonly BarButton[] {
    return this.bar;
  }

  override knobLabel(slot: KnobSlot): string | null {
    return slot === 'upper' ? 'Data Entry\nPush: Enter' : null;
  }

  override onKnob(k: KnobId, clicks: number): boolean {
    if (k === 'upperInner') {
      // Cycle the last character through A-Z, 0-9.
      if (!this.entry) this.entry = 'A';
      else {
        const last = this.entry[this.entry.length - 1];
        const i = CHARS.indexOf(last);
        const n = CHARS.length;
        this.entry = this.entry.slice(0, -1) + CHARS[(((i + Math.round(clicks)) % n) + n) % n];
      }
      this.gtc.revision++;
      return true;
    }
    if (k === 'upperOuter') {
      if (clicks > 0 && this.entry.length < (this.o.maxLen ?? 7)) this.entry += 'A';
      else if (clicks < 0) this.entry = this.entry.slice(0, -1);
      this.gtc.revision++;
      return true;
    }
    if (k === 'upperPush') {
      this.enter();
      return true;
    }
    return false;
  }
}

export interface ListItem {
  label: string;
  sub?: string;
  value?: string;
}

/** Generic list selection dialog. */
export class ListSelectPage extends GtcPage {
  readonly title: string;
  override dialog = true;
  constructor(
    gtc: GtcController,
    title: string,
    private readonly items: () => readonly ListItem[],
    private readonly onSelect: (i: number, item: ListItem) => void,
    private readonly empty = 'None',
  ) {
    super(gtc);
    this.title = title;
  }
  protected build(r: Rect): void {
    const rowH = r.w > r.h * 1.3 ? 76 : 62;
    this.list(r.x + 8, r.y + 6, r.w - 16, r.h - 12, {
      count: () => this.items().length,
      rowH,
      drawRow: (ctx, i, x, y, w, h) => {
        const it = this.items()[i];
        box(ctx, x + 2, y + 3, w - 12, h - 6, GTC_COLORS.button, GTC_COLORS.buttonEdge, 1, 4);
        TF.draw(ctx, it.label, x + 16, y + (it.sub ? h * 0.36 : h / 2), 21, P.white, 'left', 'middle');
        if (it.sub) TF.draw(ctx, it.sub, x + 16, y + h * 0.7, 15, P.grey, 'left', 'middle');
        if (it.value) TF.draw(ctx, it.value, x + w - 24, y + h / 2, 19, P.cyan, 'right', 'middle');
      },
      onRow: (i) => {
        const it = this.items()[i];
        if (it) this.onSelect(i, it);
      },
    });
    this.custom(r.x, r.y, r.w, r.h, (ctx) => {
      if (!this.items().length) TF.draw(ctx, this.empty, r.x + r.w / 2, r.y + r.h / 2, 20, P.white, 'center', 'middle');
    });
  }
  override onKnob(k: KnobId, clicks: number): boolean {
    if (k === 'upperInner' || k === 'upperOuter') {
      for (const w of this.widgets) w.scroll(Math.sign(clicks));
      this.gtc.revision++;
      return true;
    }
    return false;
  }
}
