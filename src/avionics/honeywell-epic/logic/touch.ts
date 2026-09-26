/**
 * Touch-screen UI framework for the Symmetry touch screens (TSCs, overhead
 * panel touch screens, standby flight displays).
 *
 * Interaction model (BJT "Pilot report: Gulfstream G500"): resistive
 * screens needing "at least 100 grams" of pressure, with "actuation
 * occurring when the pilot lifts a finger off the screen" — a control acts
 * on pointer-up inside the control it was pressed on; sliding off cancels.
 * Guarded functions (switches that are guarded on hardware panels) need a
 * confirmation tap (EST, mirrors the positive-action soft buttons
 * described in the G500 report).
 *
 * Widgets are plain data with callbacks, so page definitions are testable
 * without a canvas: `TouchScreenLogic.tap(x, y)` / `down()` + `up()`.
 */

export type TouchKind = 'button' | 'toggle' | 'label' | 'value' | 'tab' | 'tile' | 'group' | 'key' | 'annunciator';

export interface TouchWidget {
  id: string;
  kind: TouchKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text (static or live). */
  label?: string | (() => string);
  /** Second line / value text. */
  sub?: string | (() => string);
  /** Lit / latched state (green 'on' fill for toggles and tabs). */
  on?: () => boolean;
  /** Caution / fault state (amber legend). */
  fault?: () => boolean;
  /** Text colour override. */
  color?: () => string;
  /** Disabled (greyed, not tappable). */
  disabled?: () => boolean;
  /** Needs a confirmation tap (guarded function). */
  guarded?: boolean;
  tap?: () => void;
  /** Called on pointer down / up for momentary controls (starter buttons, IDENT). */
  press?: (down: boolean) => void;
  /** Font size (default 16). */
  size?: number;
}

export interface TouchPage {
  id: string;
  title: string;
  widgets: TouchWidget[];
  /** Optional custom graphics drawn under the widgets (synoptic lines, gauges). */
  draw?: (ctx: import('../../common/draw/context').Ctx2D, page: TouchPage) => void;
  /** Called when the page becomes visible. */
  enter?: () => void;
  /** Redraw every frame (live values). Default true. */
  live?: boolean;
}

export function labelOf(w: TouchWidget): string {
  const l = w.label;
  return typeof l === 'function' ? l() : (l ?? '');
}

export function subOf(w: TouchWidget): string {
  const s = w.sub;
  return typeof s === 'function' ? s() : (s ?? '');
}

/** Page navigation and pointer handling of one touch screen. */
export class TouchScreenLogic {
  readonly pages: TouchPage[];
  private readonly byId = new Map<string, number>();
  page = 0;
  /** Stack of previous pages (BACK). */
  private readonly history: number[] = [];
  /** Widget under the finger (pressed highlight). */
  pressed: TouchWidget | null = null;
  /** Guarded widget awaiting confirmation. */
  armed: TouchWidget | null = null;
  armedT = 0;
  /** Incremented on every change (displays redraw on change). */
  version = 0;

  constructor(pages: TouchPage[], readonly powered: () => boolean = () => true) {
    this.pages = pages;
    pages.forEach((p, i) => this.byId.set(p.id, i));
  }

  get current(): TouchPage {
    return this.pages[this.page];
  }

  show(id: string, push = true): boolean {
    const i = this.byId.get(id);
    if (i === undefined) return false;
    if (push && i !== this.page) this.history.push(this.page);
    if (this.history.length > 16) this.history.shift();
    this.page = i;
    this.armed = null;
    this.pages[i].enter?.();
    this.version++;
    return true;
  }

  back(): void {
    const i = this.history.pop();
    if (i !== undefined) {
      this.page = i;
      this.version++;
    }
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  hit(x: number, y: number): TouchWidget | null {
    const ws = this.current.widgets;
    for (let i = ws.length - 1; i >= 0; i--) {
      const w = ws[i];
      if (!w.tap && !w.press) continue;
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return w;
    }
    return null;
  }

  down(x: number, y: number): void {
    if (!this.powered()) return;
    const w = this.hit(x, y);
    if (!w || w.disabled?.()) return;
    this.pressed = w;
    w.press?.(true);
    this.version++;
  }

  up(x: number, y: number): void {
    const w = this.pressed;
    this.pressed = null;
    if (!w) return;
    w.press?.(false);
    this.version++;
    if (!this.powered()) return;
    // Act only if the finger is lifted over the same control.
    if (this.hit(x, y) !== w || !w.tap) return;
    if (w.guarded) {
      if (this.armed !== w) {
        this.armed = w;
        this.armedT = 4; // confirmation window (s), EST
        return;
      }
      this.armed = null;
    }
    w.tap();
  }

  /** Tap = down + up at the same point (tests, keyboard shortcuts). */
  tap(x: number, y: number): void {
    this.down(x, y);
    this.up(x, y);
  }

  /** Taps the widget with id `id` on the current page (tests). Returns false when not found. */
  tapId(id: string): boolean {
    const w = this.current.widgets.find((q) => q.id === id);
    if (!w) return false;
    this.tap(w.x + w.w / 2, w.y + w.h / 2);
    return true;
  }

  update(dt: number): void {
    if (this.armed) {
      this.armedT -= dt;
      if (this.armedT <= 0) {
        this.armed = null;
        this.version++;
      }
    }
  }
}

// ---------------------------------------------------------------- layout helpers

/** Grid cell rectangle: columns x rows inside (x, y, w, h) with a gap. */
export function cell(x: number, y: number, w: number, h: number, cols: number, rows: number, c: number, r: number, gap = 8): { x: number; y: number; w: number; h: number } {
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = (h - gap * (rows - 1)) / rows;
  return { x: x + c * (cw + gap), y: y + r * (ch + gap), w: cw, h: ch };
}
