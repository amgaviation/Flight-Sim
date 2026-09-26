/**
 * Adaptive Flight Display (AFD-6520, 15.1-inch landscape, FSB BD-700-1A10
 * Rev 7 appendix 6; Collins course syllabus 523-0817473) of the Global
 * Vision Flight Deck.
 *
 * One AFD composes the windows the LayoutManager shows on it (full, halves,
 * quarters), draws both pilots' CCP cursors (AIN 2012: "the captain's is
 * cross-shaped and the copilot's X-shaped"), highlights the hot spot under
 * a cursor, and hosts the window menu (CCP MENU key: the contents allowed in
 * the window under the cursor, the FULL / SPLIT format commands and the
 * window's own options). CCP ENTER / DATA go to the window under the cursor.
 *
 * Design canvas 1024 x 640 logical px (16:10, EST from the 15.1-inch
 * landscape AFD active area). Power-up self test (EST 18 s, skipped with
 * `fusion.boot_skip`). A failed / unpowered AFD is black.
 *
 * Mouse use in the 3D cockpit (CCP emulation, same as the Epic suite):
 * moving over an AFD places the cursor of the pilot on that side (AFD 1:
 * pilot, AFD 4: copilot, centre AFDs by half), click = ENTER, long press
 * (>= 0.5 s) = MENU, wheel = DATA knob.
 */
import { CanvasDisplay, type DisplayCanvas } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import type { SimVars } from '../../../core/SimVars';
import { AFD_H, AFD_W, type LayoutManager, type ShownWindow } from '../logic/layout';
import type { CursorLogic } from '../logic/cursor';
import { FUSION_STRINGS, FUSION_VARS, SLOTS, WIN_NAMES, Win, type Slot } from '../vars';
import { C, rect, seg, txt } from './style';
import { HotSpots, type MenuItem, type WindowRenderer } from './window';
import type { PfdRenderer } from './pfd';

// ------------------------------------------------------------------ window set

/** PFD content adapter (the PfdRenderer of the window's PFD side). */
export class PfdWindow implements WindowRenderer {
  readonly animated = true;
  constructor(private readonly pfds: [PfdRenderer, PfdRenderer]) {}
  update(dt: number, w: ShownWindow): void {
    this.pfds[w.pfdSide - 1].update(dt, w.rect.w < 700);
  }
  draw(ctx: Ctx2D, w: ShownWindow): void {
    const r = w.rect;
    this.pfds[w.pfdSide - 1].draw(ctx, r.x, r.y, r.w, r.h);
  }
}

export class BlankWindow implements WindowRenderer {
  readonly animated = false;
  update(): void {}
  draw(ctx: Ctx2D, w: ShownWindow): void {
    const r = w.rect;
    rect(ctx, r.x, r.y, r.w, r.h, C.bg);
  }
}

/** Renderers per content; per-owner instances where the window keeps its own state (map range, formats). */
export interface FusionWindowSet {
  pfd: WindowRenderer;
  eicas: WindowRenderer;
  map: [WindowRenderer, WindowRenderer];
  fms: WindowRenderer;
  sys: WindowRenderer;
  chkl: WindowRenderer;
  vsd: [WindowRenderer, WindowRenderer];
  chart: [WindowRenderer, WindowRenderer];
  evs: [WindowRenderer, WindowRenderer];
  blank: WindowRenderer;
}

export function rendererFor(set: FusionWindowSet, w: ShownWindow): WindowRenderer {
  const o = w.owner - 1;
  switch (w.win) {
    case Win.Pfd:
      return set.pfd;
    case Win.Eicas:
      return set.eicas;
    case Win.Map:
      return set.map[o];
    case Win.Fms:
      return set.fms;
    case Win.Sys:
      return set.sys;
    case Win.Chkl:
      return set.chkl;
    case Win.Vsd:
      return set.vsd[o];
    case Win.Chart:
      return set.chart[o];
    case Win.Evs:
      return set.evs[o];
    default:
      return set.blank;
  }
}

// ------------------------------------------------------------------ menu

type MenuKind = 'win' | 'full' | 'split' | 'quarter' | 'join' | 'own';
interface MenuEntry {
  kind: MenuKind;
  label: string;
  on: boolean;
  win: Win;
  id: string;
}

interface MenuState {
  open: boolean;
  side: 1 | 2;
  slot: Slot;
  entries: MenuEntry[];
  x: number;
  y: number;
  title: string;
}

const MENU_W = 220;
const MENU_ROW = 26;
const MENU_IDS: string[] = [];
for (let i = 0; i < 48; i++) MENU_IDS.push(`menu:${i}`);

const SLOT_NAMES: Record<Slot, string> = { F: 'FULL', L: 'LEFT', R: 'RIGHT', LU: 'LEFT UPPER', LL: 'LEFT LOWER', RU: 'RIGHT UPPER', RL: 'RIGHT LOWER' };

// ------------------------------------------------------------------ AFD

export interface AfdOptions {
  n: 1 | 2 | 3 | 4;
  id: string;
  vars: SimVars;
  layout: LayoutManager;
  windows: FusionWindowSet;
  cursor: CursorLogic;
  pixelRatio?: number;
  bootS?: number;
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
}

const CUR_DU = [FUSION_VARS.cursorDu(1), FUSION_VARS.cursorDu(2)] as const;
const CUR_X = [FUSION_VARS.cursorX(1), FUSION_VARS.cursorX(2)] as const;
const CUR_Y = [FUSION_VARS.cursorY(1), FUSION_VARS.cursorY(2)] as const;
const CUR_VIS = [FUSION_VARS.cursorVisible(1), FUSION_VARS.cursorVisible(2)] as const;
const CUR_HOVER = [FUSION_STRINGS.cursorHover(1), FUSION_STRINGS.cursorHover(2)] as const;

export class AdaptiveFlightDisplay extends CanvasDisplay {
  readonly n: 1 | 2 | 3 | 4;
  readonly hotspots = new HotSpots(128);
  private readonly o: AfdOptions;
  private readonly menuState: MenuState = { open: false, side: 1, slot: 'F', entries: [], x: 0, y: 0, title: '' };
  private readonly bootS: number;
  private bootRemain = 0;
  private pressT = -1;
  private pressX = 0;
  private pressY = 0;
  private lastDt = 1 / 30;
  /** Window keys `n:slot` for the cursor bump rule (no allocation). */
  private readonly winKeys: Record<Slot, string>;

  constructor(o: AfdOptions) {
    super({ id: o.id, width: AFD_W, height: AFD_H, pixelRatio: o.pixelRatio, vars: o.vars, canvas: o.canvas, refreshHz: 30 });
    this.o = o;
    this.n = o.n;
    this.bootS = o.bootS ?? 18;
    this.animating = true;
    const k = {} as Record<Slot, string>;
    for (const s of SLOTS) k[s] = `${o.n}:${s}`;
    this.winKeys = k;
  }

  /** True while the power-up self test runs. */
  get selfTest(): boolean {
    return this.bootRemain > 0;
  }

  /** Displayed and able to take the cursor. */
  get operating(): boolean {
    return this.powered && this.bootRemain <= 0 && this.o.layout.shown[this.n - 1].operating;
  }

  protected override onPowerChange(on: boolean): void {
    if (on) this.bootRemain = this.o.vars.get(FUSION_VARS.bootSkip) >= 0.5 ? 0 : this.bootS;
    else {
      this.bootRemain = 0;
      this.menuState.open = false;
    }
  }

  protected override update(dt: number): void {
    this.lastDt = dt;
    if (this.bootRemain > 0) {
      this.bootRemain -= dt;
      if (this.o.vars.get(FUSION_VARS.bootSkip) >= 0.5) this.bootRemain = 0;
    }
  }

  // ------------------------------------------------------------ cursor routing

  windowAt(x: number, y: number): ShownWindow | null {
    return this.o.layout.windowAt(this.n, x, y);
  }

  windowKey(x: number, y: number): string {
    const w = this.windowAt(x, y);
    return w ? this.winKeys[w.slot] : '';
  }

  /** Rect of the EICAS window on this AFD (the cursor cannot enter it), or null. */
  eicasRect(): ShownWindow['rect'] | null {
    for (const w of this.o.layout.shown[this.n - 1].windows) if (w.win === Win.Eicas) return w.rect;
    return null;
  }

  hitTest(x: number, y: number): string {
    if (!this.operating) return '';
    const m = this.menuState;
    if (m.open) {
      const i = this.menuIndexAt(x, y);
      return i >= 0 ? MENU_IDS[i] : '';
    }
    const w = this.windowAt(x, y);
    if (!w) return '';
    // Only hot spots inside this window (the list is from the last frame).
    const hs = this.hotspots;
    for (let i = hs.n - 1; i >= 0; i--) {
      if (x >= hs.x[i] && x < hs.x[i] + hs.w[i] && y >= hs.y[i] && y < hs.y[i] + hs.h[i]) {
        const cx = hs.x[i] + hs.w[i] / 2;
        const cy = hs.y[i] + hs.h[i] / 2;
        const r = w.rect;
        if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) return hs.id[i];
      }
    }
    return '';
  }

  private menuIndexAt(x: number, y: number): number {
    const m = this.menuState;
    if (x < m.x || x > m.x + MENU_W) return -1;
    const i = Math.floor((y - m.y - 30) / MENU_ROW);
    return i >= 0 && i < m.entries.length ? i : -1;
  }

  enter(side: 1 | 2, x: number, y: number, id: string): void {
    const m = this.menuState;
    if (m.open) {
      const i = MENU_IDS.indexOf(id);
      if (i >= 0 && i < m.entries.length) this.applyMenu(m.side, m.slot, m.entries[i]);
      m.open = false;
      return;
    }
    const w = this.windowAt(x, y);
    if (!w) return;
    const r = rendererFor(this.o.windows, w);
    if (r.enter && id) r.enter(side, w, id);
  }

  menu(side: 1 | 2, x: number, y: number): void {
    const m = this.menuState;
    if (m.open) {
      m.open = false;
      return;
    }
    const w = this.windowAt(x, y);
    if (!w || w.win === Win.Eicas) return;
    const lay = this.o.layout;
    const entries: MenuEntry[] = [];
    const cur = lay.selected(this.n, w.slot);
    for (const win of lay.menuFor(this.n, w.slot)) entries.push({ kind: 'win', label: WIN_NAMES[win], on: win === cur, win, id: '' });
    // Format commands.
    const outboard = this.n === 1 || this.n === 4;
    if (w.slot === 'F') entries.push({ kind: 'split', label: 'SPLIT', on: false, win: Win.Blank, id: '' });
    else if (w.slot.length === 1) {
      if (!outboard || w.win === Win.Pfd) entries.push({ kind: 'full', label: 'FULL', on: false, win: Win.Blank, id: '' });
      if (w.win !== Win.Pfd) entries.push({ kind: 'quarter', label: 'SPLIT UPPER / LOWER', on: false, win: Win.Blank, id: '' });
    } else entries.push({ kind: 'join', label: 'JOIN HALF', on: false, win: Win.Blank, id: '' });
    // Window options.
    const r = rendererFor(this.o.windows, w);
    const own: MenuItem[] = r.menuItems ? r.menuItems(w) : [];
    for (const it of own) if (it.enabled !== false) entries.push({ kind: 'own', label: it.label, on: !!it.on, win: Win.Blank, id: it.id });
    m.entries = entries.slice(0, MENU_IDS.length);
    m.open = true;
    m.side = side;
    m.slot = w.slot;
    m.title = `AFD ${this.n} ${SLOT_NAMES[w.slot]}`;
    const h = 36 + m.entries.length * MENU_ROW;
    m.x = Math.max(4, Math.min(AFD_W - MENU_W - 4, x - 20));
    m.y = Math.max(4, Math.min(AFD_H - h - 4, y - 10));
  }

  back(_side: 1 | 2, _x: number, _y: number): void {
    this.menuState.open = false;
  }

  data(side: 1 | 2, x: number, y: number, id: string, steps: number, inner: boolean): void {
    const m = this.menuState;
    if (m.open) return;
    const w = this.windowAt(x, y);
    if (!w) return;
    const r = rendererFor(this.o.windows, w);
    if (r.data) r.data(side, w, id, steps, inner);
  }

  get menuOpen(): boolean {
    return this.menuState.open;
  }

  /** Menu entry labels (tests / debugging). */
  menuLabels(): string[] {
    return this.menuState.open ? this.menuState.entries.map((e) => e.label) : [];
  }

  private applyMenu(side: 1 | 2, slot: Slot, e: MenuEntry): void {
    const lay = this.o.layout;
    const n = this.n;
    switch (e.kind) {
      case 'win':
        lay.select(n, slot, e.win);
        return;
      case 'full':
        lay.setFull(n, true);
        return;
      case 'split':
        lay.setFull(n, false);
        return;
      case 'quarter':
        lay.setHalfSplit(n, slot[0] as 'L' | 'R', true);
        return;
      case 'join':
        lay.setHalfSplit(n, slot[0] as 'L' | 'R', false);
        return;
      case 'own': {
        const w = lay.windowOf(n, slot);
        if (!w) return;
        const r = rendererFor(this.o.windows, w);
        r.menuSelect?.(side, w, e.id);
        return;
      }
    }
  }

  /** Side whose cursor the mouse drives at x. */
  mouseSide(x: number): 1 | 2 {
    return this.n === 1 ? 1 : this.n === 4 ? 2 : x < AFD_W / 2 ? 1 : 2;
  }

  protected override onPointerLogical(x: number, y: number, kind: 'down' | 'up' | 'move' | 'wheel', delta: number): void {
    const cur = this.o.cursor;
    const side = this.mouseSide(kind === 'up' ? this.pressX : x);
    switch (kind) {
      case 'move':
        cur.place(side, this.n, x, y);
        return;
      case 'down':
        cur.place(side, this.n, x, y);
        this.pressT = this.timeS;
        this.pressX = x;
        this.pressY = y;
        return;
      case 'up': {
        if (this.pressT < 0) return;
        const held = this.timeS - this.pressT;
        this.pressT = -1;
        cur.place(side, this.n, this.pressX, this.pressY);
        if (held >= 0.5) cur.menu(side);
        else cur.enter(side);
        return;
      }
      case 'wheel':
        cur.place(side, this.n, x, y);
        cur.data(side, delta > 0 ? 1 : -1, false);
        return;
    }
  }

  // ------------------------------------------------------------ draw

  protected override draw(ctx: Ctx2D): void {
    const hs = this.hotspots;
    hs.clear();
    if (this.bootRemain > 0) {
      this.drawSelfTest(ctx, 1 - this.bootRemain / Math.max(0.1, this.bootS));
      return;
    }
    const shown = this.o.layout.shown[this.n - 1];
    if (!shown.operating) return;
    const dt = this.lastDt;
    for (const w of shown.windows) {
      const r = rendererFor(this.o.windows, w);
      const rc = w.rect;
      r.update(dt, w);
      ctx.save();
      ctx.beginPath();
      ctx.rect(rc.x, rc.y, rc.w, rc.h);
      ctx.clip();
      r.draw(ctx, w, hs);
      ctx.restore();
    }
    // Window separators.
    for (const w of shown.windows) {
      const rc = w.rect;
      if (rc.x > 0) seg(ctx, rc.x, rc.y, rc.x, rc.y + rc.h, C.line, 2);
      if (rc.y > 0) seg(ctx, rc.x, rc.y, rc.x + rc.w, rc.y, C.line, 2);
    }
    const v = this.o.vars;
    // Hover highlight of the hot spot under each visible cursor on this AFD.
    for (let k = 0; k < 2; k++) {
      if (v.get(CUR_DU[k]) !== this.n || v.get(CUR_VIS[k]) < 0.5) continue;
      const id = v.getString(CUR_HOVER[k]);
      if (!id || id.startsWith('menu:')) continue;
      const i = hs.indexOf(id);
      if (i >= 0) rect(ctx, hs.x[i] + 1, hs.y[i] + 1, hs.w[i] - 2, hs.h[i] - 2, '', C.cyan, 2);
    }
    if (this.menuState.open) this.drawMenu(ctx);
    // Cursors.
    for (let k = 0; k < 2; k++) {
      if (v.get(CUR_DU[k]) !== this.n || v.get(CUR_VIS[k]) < 0.5) continue;
      drawFusionCursor(ctx, (k + 1) as 1 | 2, v.get(CUR_X[k]), v.get(CUR_Y[k]));
    }
  }

  private drawMenu(ctx: Ctx2D): void {
    const m = this.menuState;
    const v = this.o.vars;
    const hover = v.get(CUR_DU[m.side - 1]) === this.n ? v.getString(CUR_HOVER[m.side - 1]) : '';
    const h = 36 + m.entries.length * MENU_ROW;
    rect(ctx, m.x, m.y, MENU_W, h, C.menuBg, C.white, 1.5);
    txt(ctx, m.title, m.x + MENU_W / 2, m.y + 16, 13, C.cyan, 'center');
    let lastKind: MenuKind = 'win';
    for (let i = 0; i < m.entries.length; i++) {
      const e = m.entries[i];
      const iy = m.y + 30 + i * MENU_ROW;
      if (i > 0 && e.kind !== lastKind && (e.kind === 'own' || lastKind === 'win')) seg(ctx, m.x + 6, iy, m.x + MENU_W - 6, iy, C.grey, 1);
      lastKind = e.kind;
      const hot = hover === MENU_IDS[i];
      if (hot) rect(ctx, m.x + 3, iy + 1, MENU_W - 6, MENU_ROW - 2, C.menuSel);
      if (e.on) {
        ctx.strokeStyle = C.green;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(m.x + 10, iy + 13);
        ctx.lineTo(m.x + 14, iy + 18);
        ctx.lineTo(m.x + 21, iy + 8);
        ctx.stroke();
      }
      txt(ctx, e.label, m.x + 28, iy + MENU_ROW / 2 + 1, 14, C.white, 'left');
      this.hotspots.add(MENU_IDS[i], m.x, iy, MENU_W, MENU_ROW);
    }
  }

  private drawSelfTest(ctx: Ctx2D, prog: number): void {
    rect(ctx, 0, 0, AFD_W, AFD_H, C.bg);
    txt(ctx, 'Rockwell Collins', AFD_W / 2, AFD_H / 2 - 60, 34, C.white, 'center');
    txt(ctx, 'PRO LINE FUSION', AFD_W / 2, AFD_H / 2 - 14, 22, C.grey, 'center');
    txt(ctx, afdLabel(this.n), AFD_W / 2, AFD_H / 2 + 26, 17, C.grey, 'center');
    rect(ctx, AFD_W / 2 - 160, AFD_H / 2 + 56, 320, 12, '', C.grey, 1);
    rect(ctx, AFD_W / 2 - 158, AFD_H / 2 + 58, 316 * Math.max(0, Math.min(1, prog)), 8, C.cyan);
  }
}

const AFD_LABELS = ['AFD 1  SELF TEST', 'AFD 2  SELF TEST', 'AFD 3  SELF TEST', 'AFD 4  SELF TEST'];
function afdLabel(n: number): string {
  return AFD_LABELS[n - 1] ?? '';
}

/** CCP cursor symbol: pilot cross, copilot X (AIN 2012); colour EST. */
export function drawFusionCursor(ctx: Ctx2D, side: 1 | 2, x: number, y: number): void {
  const r = 12;
  ctx.lineCap = 'butt';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? '#000000' : C.cyan;
    ctx.lineWidth = pass === 0 ? 6 : 3;
    ctx.beginPath();
    if (side === 1) {
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
    } else {
      const d = r * 0.75;
      ctx.moveTo(x - d, y - d);
      ctx.lineTo(x + d, y + d);
      ctx.moveTo(x - d, y + d);
      ctx.lineTo(x + d, y - d);
    }
    ctx.stroke();
  }
}
