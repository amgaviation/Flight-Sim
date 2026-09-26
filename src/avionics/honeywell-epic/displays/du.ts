/**
 * Epic display unit (DU): one 14-in landscape LCD (PlaneView II, G650
 * FlightGlobal cockpit report "four large 14in LCDs") / Honeywell
 * DU-1310-2 (Symmetry, G600 specification sheet). Design canvas 1024 x 788
 * logical px (13 x 10 in active area aspect, EST).
 *
 * The DU composes the windows chosen by the `WindowManager` (full, or a
 * 2/3 window plus two 1/6 windows with the column outboard on the PFD DUs
 * and inboard on the MFDs — G650ER photograph), draws the CCD cursors of
 * both pilots, highlights the hot spot under a cursor, and hosts the
 * window-content menu (CCD MENU key: list of the formats allowed in the
 * window under the cursor, G550 OM 2A-31 "window formats"). It routes
 * CCD ENTER / DATA to the window under the cursor.
 *
 * Mouse use in the 3D cockpit (CCD emulation): moving over a DU moves the
 * nearest pilot's cursor (DU 1-2 pilot, 3-4 copilot), a click = ENTER, a
 * long press (>= 0.5 s) = MENU, the wheel = DATA SET knob.
 *
 * Power-up: `duBootS` (EST default 25 s; G450 OM "approximately two
 * minutes" for the whole system) of self-test screen unless `epic.boot_skip`
 * is 1.
 */
import { CanvasDisplay, type DisplayCanvas } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import { C, drawCursor, menuButton, rect, seg, text, textBold } from '../style';
import { DuFormat, EPIC_STRINGS, EPIC_VARS, WIN_NAMES, Win, allowedInMain, allowedInSixth, SYNOPTIC_WINDOWS } from '../vars';
import { COLUMN_ON_LEFT, type WindowSlot } from '../logic/windows';
import type { CursorControl } from '../logic/cursor';
import type { EpicServices, EpicWindow } from './window';
import { EngineWindow, Engine2Window } from './engineWindows';
import { BlankWindow, CasWindowEpic, ChecklistWindow, WptListWindow } from './sixthWindows';
import { PfdWindow } from './pfd';
import { MapWindow } from './mapWindow';
import { SynopticWindow } from './synoptics';

export const DU_W = 1024;
export const DU_H = 788;
export const MAIN_W = 683;
export const SIXTH_W = DU_W - MAIN_W;
export const SIXTH_H = DU_H / 2;

/** Creates the window object for a content code. */
export function createWindow(kind: Win, svc: EpicServices, du: number, side: 1 | 2): EpicWindow {
  switch (kind) {
    case Win.Pfd:
      return new PfdWindow(svc, du, side);
    case Win.Map:
      return new MapWindow(svc, du, side);
    case Win.Engine:
      return new EngineWindow(svc, du, side);
    case Win.Engine2:
      return new Engine2Window(svc, du, side);
    case Win.Cas:
      return new CasWindowEpic(svc, du, side);
    case Win.Checklist:
      return new ChecklistWindow(svc, du, side);
    case Win.WptList:
      return new WptListWindow(svc, du, side);
    default:
      if (kind >= Win.SynSummary && kind <= Win.SynEngineStart) return new SynopticWindow(svc, du, side, kind);
      return new BlankWindow(svc, du, side);
  }
}

/** Items of the window-content menu for a slot. */
function menuItems(slot: WindowSlot, du: number): Win[] {
  const out: Win[] = [];
  const all: Win[] = [Win.Pfd, Win.Map, Win.Engine, Win.Engine2, Win.Cas, Win.Checklist, Win.WptList, ...SYNOPTIC_WINDOWS];
  for (const w of all) {
    if (slot === 'main') {
      if (!allowedInMain(w)) continue;
      if (w === Win.Pfd && du !== 1 && du !== 4) continue;
    } else if (!allowedInSixth(w)) continue;
    out.push(w);
  }
  return out;
}

const MENU_IDS: string[] = [];
for (let i = 0; i < 24; i++) MENU_IDS.push(`du.menu${i}`);
const FULL_ID = 'du.menu.full';
const CCD_DU = [EPIC_VARS.ccdDu(1), EPIC_VARS.ccdDu(2)] as const;
const CCD_X = [EPIC_VARS.ccdX(1), EPIC_VARS.ccdX(2)] as const;
const CCD_Y = [EPIC_VARS.ccdY(1), EPIC_VARS.ccdY(2)] as const;
const CCD_HOVER = [EPIC_STRINGS.ccdHover(1), EPIC_STRINGS.ccdHover(2)] as const;

interface PopupState {
  open: boolean;
  slot: WindowSlot;
  items: Win[];
  x: number;
  y: number;
  side: 1 | 2;
}

export interface EpicDuOptions {
  id: string;
  n: number;
  svc: EpicServices;
  cursor: CursorControl;
  pixelRatio?: number;
  bootS?: number;
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
}

export class EpicDisplayUnit extends CanvasDisplay {
  readonly n: number;
  private readonly svc: EpicServices;
  private readonly cursor: CursorControl;
  /** Window instances per slot and content (created lazily, kept for state). */
  private readonly inst: [Map<number, EpicWindow>, Map<number, EpicWindow>, Map<number, EpicWindow>] = [new Map(), new Map(), new Map()];
  /** Windows currently shown: main, upper, lower (null when hidden). */
  readonly shown: (EpicWindow | null)[] = [null, null, null];
  private readonly popup: PopupState = { open: false, slot: 'main', items: [], x: 0, y: 0, side: 1 };
  private readonly bootS: number;
  private bootRemain = 0;
  private pressT = -1;
  private pressX = 0;
  private pressY = 0;

  constructor(o: EpicDuOptions) {
    super({ id: o.id, width: DU_W, height: DU_H, pixelRatio: o.pixelRatio, vars: o.svc.vars, canvas: o.canvas, refreshHz: 30 });
    this.n = o.n;
    this.svc = o.svc;
    this.cursor = o.cursor;
    this.bootS = o.bootS ?? 25;
    this.animating = true;
  }

  /** Default side for windows on this DU (PFD DUs outboard, MFDs per side). */
  private sideOf(slot: number): 1 | 2 {
    void slot;
    return this.n <= 2 ? 1 : 2;
  }

  /** Window for (slot, content), created on first use. */
  windowFor(slotIndex: 0 | 1 | 2, kind: Win): EpicWindow {
    const m = this.inst[slotIndex];
    let w = m.get(kind);
    if (!w) {
      w = createWindow(kind, this.svc, this.n, this.sideOf(slotIndex));
      m.set(kind, w);
    }
    return w;
  }

  protected override onPowerChange(on: boolean): void {
    if (on) this.bootRemain = this.vars?.get(EPIC_VARS.bootSkip) ? 0 : this.bootS;
    else this.popup.open = false;
  }

  /** Lays out the windows of the current view (called every frame; cheap when nothing changed). */
  private layoutWindows(): void {
    const view = this.svc.windows.view[this.n - 1];
    if (!view.operating) {
      this.shown[0] = this.shown[1] = this.shown[2] = null;
      return;
    }
    const main = this.windowFor(0, view.main);
    if (view.format === DuFormat.Full) {
      main.layout(0, 0, DU_W, DU_H, 'full');
      this.shown[0] = main;
      this.shown[1] = this.shown[2] = null;
      return;
    }
    const colLeft = COLUMN_ON_LEFT[this.n - 1];
    const colX = colLeft ? 0 : MAIN_W;
    main.layout(colLeft ? SIXTH_W : 0, 0, MAIN_W, DU_H, 'main');
    const up = this.windowFor(1, view.upper);
    const lo = this.windowFor(2, view.lower);
    up.layout(colX, 0, SIXTH_W, SIXTH_H, 'sixth');
    lo.layout(colX, SIXTH_H, SIXTH_W, SIXTH_H, 'sixth');
    this.shown[0] = main;
    this.shown[1] = up;
    this.shown[2] = lo;
  }

  protected override update(dt: number): void {
    if (this.bootRemain > 0) {
      this.bootRemain -= dt;
      return;
    }
    this.layoutWindows();
    // The PFD window follows the side of the DU it is on (DU2 / DU3 in MFD display switching).
    for (let i = 0; i < 3; i++) {
      const w = this.shown[i];
      if (w) w.update(dt);
    }
  }

  // ---------------------------------------------------------------- CCD routing

  /** Window and slot at (x, y). */
  windowAt(x: number, y: number): { w: EpicWindow; slot: WindowSlot } | null {
    for (let i = 0; i < 3; i++) {
      const w = this.shown[i];
      if (w && x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h) return { w, slot: i === 0 ? 'main' : i === 1 ? 'upper' : 'lower' };
    }
    return null;
  }

  /** Hot spot id at (x, y) ('' none): the menu first, then the window's hot spots. */
  hitTest(x: number, y: number): string {
    if (this.bootRemain > 0) return '';
    const p = this.popup;
    if (p.open) {
      for (let i = 0; i < p.items.length; i++) {
        const iy = p.y + 30 + i * 26;
        if (x >= p.x && x <= p.x + 200 && y >= iy && y < iy + 24) return MENU_IDS[i];
      }
      if (p.slot === 'main' && x >= p.x && x <= p.x + 200 && y >= p.y + 30 + p.items.length * 26 && y < p.y + 54 + p.items.length * 26) return FULL_ID;
      return '';
    }
    const hit = this.windowAt(x, y);
    if (!hit) return '';
    const hs = hit.w.hotspots;
    // Last defined wins (menus drawn over lists are defined last).
    for (let i = hs.length - 1; i >= 0; i--) {
      const s = hs[i];
      if (s.w > 0 && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return s.id;
    }
    return '';
  }

  enter(side: 1 | 2, x: number, y: number, id: string): void {
    const p = this.popup;
    if (p.open) {
      if (id === FULL_ID) this.svc.windows.toggleFull(this.n);
      else {
        const i = MENU_IDS.indexOf(id);
        if (i >= 0 && i < p.items.length) this.svc.windows.select(this.n, p.slot, p.items[i]);
      }
      p.open = false;
      return;
    }
    const hit = this.windowAt(x, y);
    if (hit) hit.w.enter(side, id);
  }

  menu(side: 1 | 2, x: number, y: number): void {
    const p = this.popup;
    if (p.open) {
      p.open = false;
      return;
    }
    const hit = this.windowAt(x, y);
    if (!hit) return;
    p.open = true;
    p.side = side;
    p.slot = hit.slot;
    p.items = menuItems(hit.slot, this.n);
    const h = 40 + p.items.length * 26 + (hit.slot === 'main' ? 26 : 0);
    p.x = Math.max(4, Math.min(DU_W - 204, x - 20));
    p.y = Math.max(4, Math.min(DU_H - h - 4, y - 10));
  }

  data(side: 1 | 2, x: number, y: number, id: string, steps: number, inner: boolean): void {
    const hit = this.windowAt(x, y);
    if (hit) hit.w.data(side, id, steps, inner);
  }

  /** Side whose cursor the mouse moves on this DU. */
  get mouseSide(): 1 | 2 {
    return this.n <= 2 ? 1 : 2;
  }

  protected override onPointerLogical(x: number, y: number, kind: 'down' | 'up' | 'move' | 'wheel', delta: number): void {
    const side = this.mouseSide;
    switch (kind) {
      case 'move':
        this.cursor.place(side, this.n, x, y);
        return;
      case 'down':
        this.cursor.place(side, this.n, x, y);
        this.pressT = this.timeS;
        this.pressX = x;
        this.pressY = y;
        return;
      case 'up': {
        if (this.pressT < 0) return;
        const held = this.timeS - this.pressT;
        this.pressT = -1;
        this.cursor.place(side, this.n, this.pressX, this.pressY);
        if (held >= 0.5) this.cursor.menu(side);
        else this.cursor.enter(side);
        return;
      }
      case 'wheel':
        this.cursor.place(side, this.n, x, y);
        this.cursor.data(side, delta > 0 ? 1 : -1, false);
        return;
    }
  }

  // ---------------------------------------------------------------- draw

  protected override draw(ctx: Ctx2D): void {
    if (this.bootRemain > 0) {
      this.drawBootScreen(ctx);
      return;
    }
    const view = this.svc.windows.view[this.n - 1];
    if (!view.operating) return;
    const v = this.svc.vars;
    // Hover ids per window from the cursors on this DU.
    for (let i = 0; i < 3; i++) {
      const w = this.shown[i];
      if (w) w.hover = '';
    }
    for (let k = 0; k < 2; k++) {
      if (v.get(CCD_DU[k]) !== this.n) continue;
      const hit = this.windowAt(v.get(CCD_X[k]), v.get(CCD_Y[k]));
      if (hit) hit.w.hover = v.getString(CCD_HOVER[k]);
    }
    for (let i = 0; i < 3; i++) {
      const w = this.shown[i];
      if (!w) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(w.x, w.y, w.w, w.h);
      ctx.clip();
      w.draw(ctx);
      ctx.restore();
    }
    // Window separators.
    if (view.format === DuFormat.Split) {
      const colX = COLUMN_ON_LEFT[this.n - 1] ? SIXTH_W : MAIN_W;
      seg(ctx, colX, 0, colX, DU_H, C.winLine, 2);
      const cx0 = COLUMN_ON_LEFT[this.n - 1] ? 0 : MAIN_W;
      seg(ctx, cx0, SIXTH_H, cx0 + SIXTH_W, SIXTH_H, C.winLine, 2);
    }
    if (this.popup.open) this.drawPopup(ctx);
    if (v.get(CCD_DU[0]) === this.n) drawCursor(ctx, 1, v.get(CCD_X[0]), v.get(CCD_Y[0]));
    if (v.get(CCD_DU[1]) === this.n) drawCursor(ctx, 2, v.get(CCD_X[1]), v.get(CCD_Y[1]));
  }

  private drawPopup(ctx: Ctx2D): void {
    const p = this.popup;
    const v = this.svc.vars;
    const hover = v.get(EPIC_VARS.ccdDu(p.side)) === this.n ? v.getString(EPIC_STRINGS.ccdHover(p.side)) : '';
    const h = 40 + p.items.length * 26 + (p.slot === 'main' ? 26 : 0);
    rect(ctx, p.x - 4, p.y, 208, h, C.menuFill, C.white, 1.5);
    text(ctx, p.slot === 'main' ? 'Window 2/3' : p.slot === 'upper' ? 'Upper 1/6' : 'Lower 1/6', p.x + 100, p.y + 15, 14, C.cyan, 'center', 'middle');
    const sel = this.svc.windows.selection(this.n);
    const cur = p.slot === 'main' ? sel.main : p.slot === 'upper' ? sel.upper : sel.lower;
    for (let i = 0; i < p.items.length; i++) {
      const iy = p.y + 30 + i * 26;
      menuButton(ctx, p.x, iy, 200, 24, WIN_NAMES[p.items[i]] ?? '', hover === MENU_IDS[i], p.items[i] === cur, false, 14);
    }
    if (p.slot === 'main') {
      const iy = p.y + 30 + p.items.length * 26;
      menuButton(ctx, p.x, iy, 200, 24, sel.format === DuFormat.Full ? 'Split (2/3)' : 'Full Window', hover === FULL_ID, false, false, 14);
    }
  }

  private drawBootScreen(ctx: Ctx2D): void {
    const prog = 1 - Math.max(0, this.bootRemain) / Math.max(0.1, this.bootS);
    textBold(ctx, 'Honeywell', DU_W / 2, DU_H / 2 - 40, 40, C.white, 'center', 'middle');
    text(ctx, 'Primus Epic', DU_W / 2, DU_H / 2 + 6, 22, C.grey, 'center', 'middle');
    text(ctx, `DU ${this.n}  Self Test`, DU_W / 2, DU_H / 2 + 50, 18, C.grey, 'center', 'middle');
    rect(ctx, DU_W / 2 - 150, DU_H / 2 + 80, 300, 10, '', C.grey, 1);
    rect(ctx, DU_W / 2 - 148, DU_H / 2 + 82, 296 * prog, 6, C.cyan, '');
  }
}
