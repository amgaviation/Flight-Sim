/**
 * Cursor Control Panel (CCP-6000) cursor logic, one cursor per pilot.
 *
 * Sources:
 *  - AIN, "Flying the Vision Flight Deck in Bombardier's Global 6000" (2012):
 *    "Bombardier designed the cursor-control device (CCD), which uses a
 *    trackball for cursor movement"; "there is only one place on the display
 *    that the cursor can't go, and that is in the window that shows Eicas
 *    messages. Each pilot has his own cursor; the captain's is cross-shaped
 *    and the copilot's X-shaped. If one pilot needs to move the cursor to a
 *    window occupied by the other pilot's cursor, he can bump out the other
 *    pilot's cursor"; "positioning the cursor over a waypoint, then clicking
 *    and bringing up the menu of options".
 *  - Collins course syllabus 523-0817473: CCP-6000 Cursor Control Panel.
 *
 * Model: the four AFDs form a virtual desktop in the T arrangement (AFD 1,
 * 2, 4 side by side, AFD 3 below AFD 2). The pilot's cursor reaches AFD 1,
 * 2 and 3, the copilot's AFD 2, 3 and 4 (EST, as the Epic CCDs). Trackball
 * gain, the idle hide time and the display-select jump targets are EST.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { AFD_H, AFD_W, type WinRect } from './layout';
import { FUSION_EVENTS, FUSION_STRINGS, FUSION_VARS } from '../vars';

/** EST: logical px of cursor motion per px of trackball drag. */
export const CCP_GAIN = 1.6;
/** EST: the cursor hides after this many seconds without trackball motion. */
export const CURSOR_IDLE_S = 30;

/** AFD origins in the virtual desktop (T-shape). */
export const AFD_ORIGINS: readonly (readonly [number, number])[] = [
  [0, 0],
  [AFD_W, 0],
  [AFD_W, AFD_H],
  [2 * AFD_W, 0],
];

export const REACHABLE: Readonly<Record<1 | 2, readonly number[]>> = { 1: [1, 2, 3], 2: [2, 3, 4] };

export interface CursorRouter {
  /** Hot spot id at a point of AFD `du` (logical px), '' = none. */
  hitTest(side: 1 | 2, du: number, x: number, y: number): string;
  enter(side: 1 | 2, du: number, x: number, y: number, id: string): void;
  menu(side: 1 | 2, du: number, x: number, y: number): void;
  back(side: 1 | 2, du: number, x: number, y: number): void;
  data(side: 1 | 2, du: number, x: number, y: number, id: string, steps: number, inner: boolean): void;
  /** Window key (du:slot) at a point, for the bump rule; '' = none. */
  windowKey(du: number, x: number, y: number): string;
  /** Rects (AFD-local) the cursor may not enter (EICAS window) for AFD `du`. */
  excluded(du: number): WinRect | null;
  /** 1 when AFD `du` is operating. */
  operating(du: number): boolean;
}

export interface CursorState {
  du: number;
  x: number;
  y: number;
  visible: boolean;
  idle: number;
  hover: string;
}

export class CursorLogic {
  readonly cursors: [CursorState, CursorState] = [
    { du: 1, x: 760, y: 320, visible: false, idle: 0, hover: '' },
    { du: 4, x: 260, y: 320, visible: false, idle: 0, hover: '' },
  ];
  router: CursorRouter | null = null;
  private readonly offs: (() => void)[] = [];
  private readonly powered: (side: 1 | 2) => boolean;

  constructor(
    private readonly vars: SimVars,
    events: EventBus,
    opts: { powered?: (side: 1 | 2) => boolean } = {},
  ) {
    this.powered = opts.powered ?? (() => true);
    for (const s of [1, 2] as const) {
      this.offs.push(
        events.on(FUSION_EVENTS.ccpMove(s), (p) => {
          const q = (p ?? {}) as { dx?: number; dy?: number };
          this.move(s, (q.dx ?? 0) * CCP_GAIN, (q.dy ?? 0) * CCP_GAIN);
        }),
        events.on(FUSION_EVENTS.ccpEnter(s), () => this.enter(s)),
        events.on(FUSION_EVENTS.ccpMenu(s), () => this.menu(s)),
        events.on(FUSION_EVENTS.ccpBack(s), () => this.back(s)),
        events.on(FUSION_EVENTS.ccpData(s), (p) => {
          if (typeof p === 'number') this.data(s, p, false);
          else {
            const q = (p ?? {}) as { steps?: number; inner?: boolean };
            this.data(s, q.steps ?? 1, !!q.inner);
          }
        }),
        events.on(FUSION_EVENTS.ccpDataInc(s), (p) => this.data(s, Number(p ?? 1) || 1, false)),
        events.on(FUSION_EVENTS.ccpDataDec(s), (p) => this.data(s, -(Number(p ?? 1) || 1), false)),
        events.on(FUSION_EVENTS.ccpDataInc(s, true), (p) => this.data(s, Number(p ?? 1) || 1, true)),
        events.on(FUSION_EVENTS.ccpDataDec(s, true), (p) => this.data(s, -(Number(p ?? 1) || 1), true)),
        events.on(FUSION_EVENTS.ccpDisplay(s), (p) => this.jump(s, String(p ?? 'PFD') as 'PFD' | 'UPR' | 'LWR')),
      );
    }
    this.publish(1);
    this.publish(2);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  // ------------------------------------------------------------ geometry

  private reachable(side: 1 | 2, du: number): boolean {
    return REACHABLE[side].includes(du) && (this.router?.operating(du) ?? true);
  }

  /** AFD containing a virtual-desktop point that side can reach (0 = none). */
  private duAt(side: 1 | 2, vx: number, vy: number): number {
    for (const du of REACHABLE[side]) {
      const [ox, oy] = AFD_ORIGINS[du - 1];
      if (vx >= ox && vx < ox + AFD_W && vy >= oy && vy < oy + AFD_H && this.reachable(side, du)) return du;
    }
    return 0;
  }

  private inExcluded(du: number, x: number, y: number): WinRect | null {
    const r = this.router?.excluded(du) ?? null;
    if (!r) return null;
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h ? r : null;
  }

  /** Moves side's cursor by (dx, dy) logical px across the reachable AFDs. */
  move(side: 1 | 2, dx: number, dy: number): void {
    if (!this.powered(side)) return;
    const c = this.cursors[side - 1];
    if (!this.reachable(side, c.du)) {
      // Current display lost: re-home on the first reachable one.
      const first = REACHABLE[side].find((d) => this.reachable(side, d));
      if (!first) return;
      c.du = first;
      c.x = AFD_W / 2;
      c.y = AFD_H / 2;
    }
    const [ox, oy] = AFD_ORIGINS[c.du - 1];
    let vx = ox + c.x + dx;
    let vy = oy + c.y + dy;
    let du = this.duAt(side, vx, vy);
    if (!du) {
      // Slide along the edge: try each axis alone.
      if (this.duAt(side, vx, oy + c.y)) {
        vy = oy + c.y;
      } else if (this.duAt(side, ox + c.x, vy)) {
        vx = ox + c.x;
      } else {
        vx = ox + Math.min(AFD_W - 1, Math.max(0, c.x + dx));
        vy = oy + Math.min(AFD_H - 1, Math.max(0, c.y + dy));
      }
      du = this.duAt(side, vx, vy) || c.du;
    }
    let [nx, ny] = AFD_ORIGINS[du - 1];
    let x = vx - nx;
    let y = vy - ny;
    // The EICAS window cannot be entered: jump over it in the direction of travel.
    const ex = this.inExcluded(du, x, y);
    if (ex) {
      let jx = x;
      let jy = y;
      if (Math.abs(dx) >= Math.abs(dy)) jx = dx >= 0 ? ex.x + ex.w + 1 : ex.x - 1;
      else jy = dy >= 0 ? ex.y + ex.h + 1 : ex.y - 1;
      const jvx = nx + jx;
      const jvy = ny + jy;
      const jdu = this.duAt(side, jvx, jvy);
      if (jdu && !this.inExcluded(jdu, jvx - AFD_ORIGINS[jdu - 1][0], jvy - AFD_ORIGINS[jdu - 1][1])) {
        du = jdu;
        [nx, ny] = AFD_ORIGINS[jdu - 1];
        x = jvx - nx;
        y = jvy - ny;
      } else {
        return; // blocked
      }
    }
    c.du = du;
    c.x = Math.min(AFD_W - 1, Math.max(0, x));
    c.y = Math.min(AFD_H - 1, Math.max(0, y));
    c.visible = true;
    c.idle = 0;
    this.bump(side);
    this.refreshHover(side);
    this.publish(side);
  }

  /** Display-select keys: jump to the on-side PFD display, the upper or the lower centre AFD. */
  jump(side: 1 | 2, target: 'PFD' | 'UPR' | 'LWR'): void {
    if (!this.powered(side)) return;
    const du = target === 'PFD' ? (side === 1 ? 1 : 4) : target === 'UPR' ? 2 : 3;
    if (!this.reachable(side, du)) return;
    const c = this.cursors[side - 1];
    c.du = du;
    // PFD display: the inboard half (MFW); centre displays: the pilot's half.
    c.x = du === 1 ? AFD_W * 0.75 : du === 4 ? AFD_W * 0.25 : side === 1 ? AFD_W * 0.25 : AFD_W * 0.75;
    c.y = AFD_H / 2;
    if (this.inExcluded(du, c.x, c.y)) c.x = AFD_W - c.x;
    c.visible = true;
    c.idle = 0;
    this.bump(side);
    this.refreshHover(side);
    this.publish(side);
  }

  private bump(side: 1 | 2): void {
    const me = this.cursors[side - 1];
    const other = this.cursors[2 - side];
    if (!other.visible || other.du !== me.du || !this.router) return;
    const a = this.router.windowKey(me.du, me.x, me.y);
    const b = this.router.windowKey(other.du, other.x, other.y);
    if (a && a === b) {
      other.visible = false;
      other.hover = '';
      this.publish((3 - side) as 1 | 2);
    }
  }

  private refreshHover(side: 1 | 2): void {
    const c = this.cursors[side - 1];
    c.hover = c.visible && this.router ? this.router.hitTest(side, c.du, c.x, c.y) : '';
  }

  // ------------------------------------------------------------ actions

  enter(side: 1 | 2): void {
    const c = this.cursors[side - 1];
    if (!this.powered(side) || !c.visible || !this.router) return;
    c.idle = 0;
    this.refreshHover(side);
    this.router.enter(side, c.du, c.x, c.y, c.hover);
    this.refreshHover(side);
    this.publish(side);
  }

  menu(side: 1 | 2): void {
    const c = this.cursors[side - 1];
    if (!this.powered(side) || !this.router) return;
    if (!c.visible) {
      c.visible = true;
      c.idle = 0;
    }
    this.router.menu(side, c.du, c.x, c.y);
    this.refreshHover(side);
    this.publish(side);
  }

  back(side: 1 | 2): void {
    const c = this.cursors[side - 1];
    if (!this.powered(side) || !this.router) return;
    this.router.back(side, c.du, c.x, c.y);
    this.refreshHover(side);
    this.publish(side);
  }

  data(side: 1 | 2, steps: number, inner: boolean): void {
    const c = this.cursors[side - 1];
    if (!this.powered(side) || !this.router || steps === 0) return;
    c.idle = 0;
    this.refreshHover(side);
    this.router.data(side, c.du, c.x, c.y, c.hover, steps, inner);
    this.refreshHover(side);
    this.publish(side);
  }

  update(dt: number): void {
    for (const s of [1, 2] as const) {
      const c = this.cursors[s - 1];
      const was = c.visible;
      if (!this.powered(s)) c.visible = false;
      else if (c.visible) {
        c.idle += dt;
        if (c.idle >= CURSOR_IDLE_S) c.visible = false;
      }
      if (c.visible && !this.reachable(s, c.du)) c.visible = false;
      if (was !== c.visible) {
        this.refreshHover(s);
        this.publish(s);
      }
    }
  }

  private publish(side: 1 | 2): void {
    const c = this.cursors[side - 1];
    const v = this.vars;
    v.set(FUSION_VARS.cursorDu(side), c.du);
    v.set(FUSION_VARS.cursorX(side), c.x);
    v.set(FUSION_VARS.cursorY(side), c.y);
    v.set(FUSION_VARS.cursorVisible(side), c.visible ? 1 : 0);
    v.setString(FUSION_STRINGS.cursorHover(side), c.visible ? c.hover : '');
  }

  /** Places the cursor directly (tests, mouse emulation in the 3D cockpit). */
  place(side: 1 | 2, du: number, x: number, y: number): void {
    if (!REACHABLE[side].includes(du)) return;
    const c = this.cursors[side - 1];
    c.du = du;
    c.x = x;
    c.y = y;
    c.visible = !this.inExcluded(du, x, y);
    c.idle = 0;
    this.bump(side);
    this.refreshHover(side);
    this.publish(side);
  }
}
