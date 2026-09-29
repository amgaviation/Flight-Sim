/**
 * GTC screen ("page") base class. A page builds its widgets for the content
 * rectangle it is given (vertical GTC 570 or horizontal GTC 580 layout) and
 * rebuilds only when that rectangle changes. Pages may consume the GTC knobs
 * (`onKnob`), override the knob labels shown in the label bar, and add
 * contextual buttons to the button bar (Enter, Cancel, Up / Down).
 */
import type { Ctx2D, Rect } from '../../common/draw/context';
import type { G3000System } from '../state/System';
import type { GtcController } from './GtcController';
import { Button, Custom, ListView, Text, type ButtonOptions, type Getter, type IconName, type ListOptions, type Widget } from './ui';

export type KnobId = 'upperOuter' | 'upperInner' | 'upperPush' | 'upperHold' | 'lower' | 'lowerPush' | 'center' | 'centerPush';
export type KnobSlot = 'upper' | 'lower' | 'center';

export interface BarButton {
  label: Getter<string>;
  icon: IconName;
  press: () => void;
  disabled?: () => boolean;
}

export abstract class GtcPage {
  abstract readonly title: Getter<string>;
  readonly widgets: Widget[] = [];
  /** Dialog pages (keypads, lists) show Cancel in the button bar. */
  dialog = false;
  private builtRect: Rect | null = null;
  private builtRev = -1;

  constructor(readonly gtc: GtcController) {}

  get sys(): G3000System {
    return this.gtc.sys;
  }

  /** Rebuilds the widgets when the content rectangle changed (or `invalidate()` was called). */
  ensureBuilt(r: Rect): void {
    const b = this.builtRect;
    if (b && b.x === r.x && b.y === r.y && b.w === r.w && b.h === r.h && this.builtRev === this.layoutRev) return;
    this.builtRect = { x: r.x, y: r.y, w: r.w, h: r.h };
    this.builtRev = this.layoutRev;
    this.widgets.length = 0;
    this.build(r);
  }

  /** Bump to force a rebuild (the widget set depends on data, e.g. a list of procedures). */
  protected layoutRev = 0;
  invalidate(): void {
    this.layoutRev++;
  }

  protected abstract build(r: Rect): void;

  /** Called every frame while the page is on top. */
  update(_dt: number): void {}
  /** Knob input; return true when consumed (otherwise the mode default applies). */
  onKnob(_k: KnobId, _clicks: number): boolean {
    return false;
  }
  /** Label bar text for a knob slot, or null for the default. */
  knobLabel(_slot: KnobSlot): string | null {
    return null;
  }
  /** Contextual button-bar buttons. */
  barButtons(): readonly BarButton[] | null {
    return null;
  }
  onOpen(): void {}
  onClose(): void {}
  /** Extra drawing after the widgets (overlays). */
  drawOverlay(_ctx: Ctx2D, _r: Rect): void {}

  // ------------------------------------------------------------ helpers

  protected add<W extends Widget>(w: W): W {
    this.widgets.push(w);
    return w;
  }

  protected button(x: number, y: number, w: number, h: number, o: ButtonOptions): Button {
    return this.add(new Button(x, y, w, h, o));
  }

  protected text(x: number, y: number, text: Getter<string>, size = 18, color?: Getter<string>, align: 'left' | 'center' | 'right' = 'left'): Text {
    return this.add(new Text(x, y, text, size, color, align));
  }

  protected custom(x: number, y: number, w: number, h: number, draw: (ctx: Ctx2D, r: Rect) => void, onPress?: (px: number, py: number) => void): Custom {
    return this.add(new Custom(x, y, w, h, draw, onPress));
  }

  protected list(x: number, y: number, w: number, h: number, o: ListOptions): ListView {
    return this.add(new ListView(x, y, w, h, o));
  }

  /**
   * Lays out `cells` (row-major, null = empty cell) in a cols x rows grid
   * inside `r` with `gap` px between buttons. Returns the created buttons.
   */
  protected grid(r: Rect, cols: number, rows: number, cells: (ButtonOptions | null)[], gap = 10): Button[] {
    const bw = (r.w - gap * (cols + 1)) / cols;
    const bh = (r.h - gap * (rows + 1)) / rows;
    const out: Button[] = [];
    for (let i = 0; i < cells.length && i < cols * rows; i++) {
      const c = cells[i];
      if (!c) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      out.push(this.button(r.x + gap + col * (bw + gap), r.y + gap + row * (bh + gap), bw, bh, c));
    }
    return out;
  }
}
