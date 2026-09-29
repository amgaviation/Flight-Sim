/**
 * Generic renderer for the Symmetry touch screens (TSCs, overhead panel
 * touch screens): draws the current `TouchPage` of a `TouchScreenLogic`
 * and routes pointer events (finger down / lift) to it.
 *
 * Look (EST, from G500 / G600 / G700 cockpit photographs): dark grey
 * background, rounded grey buttons with white legends, latched functions
 * with a green fill, faults amber, a blue title bar with HOME / BACK keys.
 */
import { CanvasDisplay, type DisplayCanvas } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import { roundRectPath } from '../../common/draw/context';
import { C, text, textBold } from '../style';
import { labelOf, subOf, type TouchScreenLogic, type TouchWidget } from '../logic/touch';
import type { SimVars } from '../../../core/SimVars';

export interface TouchDisplayOptions {
  id: string;
  width: number;
  height: number;
  vars: SimVars;
  logic: TouchScreenLogic;
  pixelRatio?: number;
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
  /** Title bar height (0 = pages draw their own header). */
  titleH?: number;
  /** Page id of the HOME key ('' = no HOME / BACK keys). */
  home?: string;
  bootS?: number;
  bootSkipVar?: string;
}

export class TouchDisplay extends CanvasDisplay {
  readonly logic: TouchScreenLogic;
  private readonly titleH: number;
  private readonly home: string;
  private readonly bootS: number;
  private readonly bootSkipVar: string;
  private bootRemain = 0;
  private t = 0;
  private readonly hdr: TouchWidget[] = [];

  constructor(o: TouchDisplayOptions) {
    super({ id: o.id, width: o.width, height: o.height, pixelRatio: o.pixelRatio, vars: o.vars, canvas: o.canvas, background: C.touchBg, refreshHz: 30 });
    this.logic = o.logic;
    this.titleH = o.titleH ?? 0;
    this.home = o.home ?? '';
    this.bootS = o.bootS ?? 0;
    this.bootSkipVar = o.bootSkipVar ?? 'epic.boot_skip';
    this.animating = true;
    if (this.home && this.titleH) {
      this.hdr.push({ id: 'hdr.home', kind: 'button', x: 6, y: 4, w: 84, h: this.titleH - 8, label: 'HOME', tap: () => this.logic.show(this.home) });
      this.hdr.push({ id: 'hdr.back', kind: 'button', x: 96, y: 4, w: 84, h: this.titleH - 8, label: 'BACK', tap: () => this.logic.back() });
    }
  }

  protected override onPowerChange(on: boolean): void {
    if (on) this.bootRemain = this.vars?.get(this.bootSkipVar) ? 0 : this.bootS;
    else this.logic.pressed = null;
  }

  protected override update(dt: number): void {
    this.t += dt;
    if (this.bootRemain > 0) this.bootRemain -= dt;
    this.logic.update(dt);
  }

  private headerHit(x: number, y: number): TouchWidget | null {
    if (!this.titleH || !this.home || y > this.titleH) return null;
    for (const w of this.hdr) if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return w;
    return null;
  }

  /** Header keys (fixed objects). */
  headerKeys(): readonly TouchWidget[] {
    return this.hdr;
  }

  private hdrPressed: TouchWidget | null = null;

  protected override onPointerLogical(x: number, y: number, kind: 'down' | 'up' | 'move' | 'wheel'): void {
    if (this.bootRemain > 0) return;
    if (kind === 'down') {
      const h = this.headerHit(x, y);
      if (h) {
        this.hdrPressed = h;
        return;
      }
      this.logic.down(x, y);
    } else if (kind === 'up') {
      if (this.hdrPressed) {
        const h = this.headerHit(x, y);
        if (h === this.hdrPressed) h.tap?.();
        this.hdrPressed = null;
        return;
      }
      this.logic.up(x, y);
    }
  }

  protected override draw(ctx: Ctx2D): void {
    if (this.bootRemain > 0) {
      textBold(ctx, 'Honeywell', this.logicalWidth / 2, this.logicalHeight / 2 - 12, 30, C.white, 'center', 'middle');
      text(ctx, 'Initializing', this.logicalWidth / 2, this.logicalHeight / 2 + 24, 16, C.grey, 'center', 'middle');
      return;
    }
    const page = this.logic.current;
    if (this.titleH) {
      ctx.fillStyle = C.touchTitle;
      ctx.fillRect(0, 0, this.logicalWidth, this.titleH);
      textBold(ctx, page.title, this.logicalWidth / 2, this.titleH / 2 + 1, 19, C.white, 'center', 'middle');
      for (let i = 0; i < this.hdr.length; i++) drawWidget(ctx, this.hdr[i], this.hdrPressed === this.hdr[i], false);
    }
    page.draw?.(ctx, page);
    const ws = page.widgets;
    for (let i = 0; i < ws.length; i++) drawWidget(ctx, ws[i], this.logic.pressed === ws[i], this.logic.armed === ws[i]);
  }
}

/** Draws one touch widget. */
export function drawWidget(ctx: Ctx2D, w: TouchWidget, pressed: boolean, armed: boolean): void {
  const size = w.size ?? 16;
  const dis = w.disabled?.() ?? false;
  const on = w.on?.() ?? false;
  const fault = w.fault?.() ?? false;
  const col = w.color?.() ?? (dis ? C.dim : fault ? C.amber : C.white);
  const label = labelOf(w);
  switch (w.kind) {
    case 'label':
      text(ctx, label, w.x, w.y + w.h / 2, size, col, 'left', 'middle');
      return;
    case 'group':
      text(ctx, label, w.x + 4, w.y + w.h / 2, size, C.cyan, 'left', 'middle');
      ctx.fillStyle = C.touchEdge;
      ctx.fillRect(w.x + 8 + ctx.measureText(label).width + 8, w.y + w.h / 2, Math.max(0, w.w - ctx.measureText(label).width - 24), 1);
      return;
    case 'annunciator':
      ctx.beginPath();
      roundRectPath(ctx, w.x, w.y, w.w, w.h, 4);
      ctx.fillStyle = on ? (fault ? C.amber : C.green) : '#20252b';
      ctx.fill();
      text(ctx, label, w.x + w.w / 2, w.y + w.h / 2 + 1, size, on ? C.black : C.dim, 'center', 'middle');
      return;
    case 'value': {
      ctx.beginPath();
      roundRectPath(ctx, w.x, w.y, w.w, w.h, 6);
      ctx.fillStyle = C.touchPanel;
      ctx.fill();
      ctx.strokeStyle = C.touchEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
      text(ctx, label, w.x + w.w / 2, w.y + 14, size - 2, C.white, 'center', 'middle');
      textBold(ctx, subOf(w), w.x + w.w / 2, w.y + w.h * 0.6, size + 3, w.color?.() ?? C.cyan, 'center', 'middle');
      return;
    }
    default:
      break;
  }
  // Buttons, toggles, tabs, tiles, keys.
  const r = w.kind === 'tile' ? 10 : 7;
  ctx.beginPath();
  roundRectPath(ctx, w.x, w.y, w.w, w.h, r);
  let fill: string = C.touchButton;
  if (w.kind === 'tab') fill = on ? '#44505c' : '#2a3038';
  else if (on) fill = C.touchButtonOn;
  if (pressed) fill = '#6f7b88';
  if (dis) fill = '#262a30';
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = armed ? C.amber : w.kind === 'tab' && on ? C.cyan : C.touchEdge;
  ctx.lineWidth = armed ? 3 : 1.5;
  ctx.stroke();
  if (w.kind === 'tab' && on) {
    ctx.fillStyle = C.cyan;
    ctx.fillRect(w.x + 6, w.y + w.h - 4, w.w - 12, 3);
  }
  const sub = subOf(w);
  if (armed) {
    textBold(ctx, label, w.x + w.w / 2, w.y + w.h * 0.36, size, C.amber, 'center', 'middle');
    text(ctx, 'CONFIRM', w.x + w.w / 2, w.y + w.h * 0.72, size - 2, C.amber, 'center', 'middle');
    return;
  }
  if (sub) {
    textBold(ctx, label, w.x + w.w / 2, w.y + w.h * 0.36, size, col, 'center', 'middle');
    text(ctx, sub, w.x + w.w / 2, w.y + w.h * 0.72, size - 1, fault ? C.amber : on ? C.white : C.cyan, 'center', 'middle');
  } else textBold(ctx, label, w.x + w.w / 2, w.y + w.h / 2 + 1, w.kind === 'tile' ? size + 2 : size, col, 'center', 'middle');
}
