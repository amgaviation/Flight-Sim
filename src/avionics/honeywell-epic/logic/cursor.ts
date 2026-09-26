/**
 * Cursor control devices (CCDs).
 *
 * G550 Operating Manual 2A-31-00 (PlaneView, same concept in PlaneView II
 * and Symmetry): "Each pilot and copilot has ergonomic CCDs positioned as
 * armrests. The pilot can control display units #1, #2, and #3, while the
 * copilot controls units #2, #3, and #4. The cursor appears as a green plus
 * (+) type symbol for the pilot cursor or a blue (x) type symbol for the
 * copilot. Interactive menu elements display with a blue background and a
 * white outline when beneath the cursor position."
 *
 * Controls modelled on each CCD (Mason CCD on Symmetry, G600 spec sheet):
 * touch pad (cursor motion), ENTER (select), MENU (window menu), three DU
 * select keys (jump to the side's left / centre / right DU) and the
 * concentric DATA SET knob (outer = coarse, inner = fine).
 * SCOPE: the cursor hides after `parkS` seconds without use (EST 20 s);
 * the first touch-pad motion restores it where it was.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { EPIC_EVENTS, EPIC_STRINGS, EPIC_VARS } from '../vars';
import { sideDus } from './windows';

/** Interactive area of a window, in DU logical pixels. */
export interface Hotspot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Receives the CCD actions; implemented by the suite (routes to the DU windows). */
export interface CursorRouter {
  /** Id of the hot spot at (x, y) on DU `du`, '' when none. */
  hitTest(side: 1 | 2, du: number, x: number, y: number): string;
  enter(side: 1 | 2, du: number, x: number, y: number, hotspot: string): void;
  menu(side: 1 | 2, du: number, x: number, y: number, hotspot: string): void;
  data(side: 1 | 2, du: number, x: number, y: number, hotspot: string, steps: number, inner: boolean): void;
}

export interface CursorControlOptions {
  duWidth: number;
  duHeight: number;
  /** Touch-pad pixels -> DU pixels (default 1.6, EST: a full DU width in ~2 pad sweeps). */
  gain?: number;
  /** Inactivity time before the cursor is removed (s). */
  parkS?: number;
  /** CCD power bindings evaluated by the suite (false = cursor removed, keys dead). */
  powered?: (side: 1 | 2) => boolean;
}

interface SideState {
  du: number;
  x: number;
  y: number;
  idle: number;
  lastDu: number;
}

export class CursorControl {
  readonly name = 'epic.ccd';
  router: CursorRouter | null = null;
  private readonly vars: SimVars;
  private readonly offs: (() => void)[] = [];
  private readonly w: number;
  private readonly h: number;
  private readonly gain: number;
  private readonly parkS: number;
  private readonly poweredFn: (side: 1 | 2) => boolean;
  private readonly st: [SideState, SideState];

  constructor(vars: SimVars, events: EventBus | null, opts: CursorControlOptions) {
    this.vars = vars;
    this.w = opts.duWidth;
    this.h = opts.duHeight;
    this.gain = opts.gain ?? 1.6;
    this.parkS = opts.parkS ?? 20;
    this.poweredFn = opts.powered ?? (() => true);
    this.st = [
      { du: 0, x: this.w * 0.5, y: this.h * 0.5, idle: 0, lastDu: 2 },
      { du: 0, x: this.w * 0.5, y: this.h * 0.5, idle: 0, lastDu: 3 },
    ];
    if (events) {
      for (const side of [1, 2] as const) {
        this.offs.push(
          events.on(EPIC_EVENTS.ccdMove(side), (p) => {
            const q = (p ?? {}) as { dx?: number; dy?: number };
            this.move(side, Number(q.dx ?? 0), Number(q.dy ?? 0));
          }),
          events.on(EPIC_EVENTS.ccdEnter(side), () => this.enter(side)),
          events.on(EPIC_EVENTS.ccdMenu(side), () => this.menu(side)),
          events.on(EPIC_EVENTS.ccdDu(side), (p) => this.jump(side, Number(p ?? 1))),
          events.on(EPIC_EVENTS.ccdData(side), (p) => {
            const q = (typeof p === 'number' ? { steps: p } : (p ?? {})) as { steps?: number; inner?: boolean };
            this.data(side, Number(q.steps ?? 0), !!q.inner);
          }),
          events.on(EPIC_EVENTS.ccdDataInc(side), (p) => this.data(side, Math.max(1, Number(p ?? 1)), false)),
          events.on(EPIC_EVENTS.ccdDataDec(side), (p) => this.data(side, -Math.max(1, Number(p ?? 1)), false)),
          events.on(EPIC_EVENTS.ccdDataInc(side, true), (p) => this.data(side, Math.max(1, Number(p ?? 1)), true)),
          events.on(EPIC_EVENTS.ccdDataDec(side, true), (p) => this.data(side, -Math.max(1, Number(p ?? 1)), true)),
        );
      }
    }
    this.publish(1);
    this.publish(2);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  /** Cursor state of a side (du 0 = parked). */
  cursor(side: 1 | 2): Readonly<{ du: number; x: number; y: number }> {
    return this.st[side - 1];
  }

  /** Moves the cursor by touch-pad pixels; crossing a DU edge continues on the neighbouring DU of the side. */
  move(side: 1 | 2, dx: number, dy: number): void {
    if (!this.poweredFn(side)) return;
    const s = this.st[side - 1];
    s.idle = 0;
    if (s.du === 0) {
      s.du = s.lastDu;
      this.publish(side);
      return;
    }
    s.x += dx * this.gain;
    s.y += dy * this.gain;
    const dus = sideDus(side);
    const k = dus.indexOf(s.du);
    if (s.x < 0) {
      if (k > 0) {
        s.du = dus[k - 1];
        s.x += this.w;
      } else s.x = 0;
    } else if (s.x > this.w) {
      if (k < dus.length - 1) {
        s.du = dus[k + 1];
        s.x -= this.w;
      } else s.x = this.w;
    }
    s.x = Math.min(this.w, Math.max(0, s.x));
    s.y = Math.min(this.h, Math.max(0, s.y));
    this.publish(side);
  }

  /** DU select key: 0 / 1 / 2 = the side's left / centre / right DU (cursor at its centre). */
  jump(side: 1 | 2, which: number): void {
    if (!this.poweredFn(side)) return;
    const s = this.st[side - 1];
    const dus = sideDus(side);
    s.du = dus[Math.max(0, Math.min(dus.length - 1, Math.round(which)))];
    s.x = this.w * 0.5;
    s.y = this.h * 0.5;
    s.idle = 0;
    this.publish(side);
  }

  /** Places the cursor directly (mouse click on a DU in the 3D cockpit: CCD emulation). */
  place(side: 1 | 2, du: number, x: number, y: number): boolean {
    if (!this.poweredFn(side) || sideDus(side).indexOf(du) < 0) return false;
    const s = this.st[side - 1];
    s.du = du;
    s.x = Math.min(this.w, Math.max(0, x));
    s.y = Math.min(this.h, Math.max(0, y));
    s.idle = 0;
    this.publish(side);
    return true;
  }

  enter(side: 1 | 2): void {
    const s = this.st[side - 1];
    if (!this.poweredFn(side)) return;
    s.idle = 0;
    if (s.du === 0) {
      s.du = s.lastDu;
      this.publish(side);
      return;
    }
    this.router?.enter(side, s.du, s.x, s.y, this.hover(side));
  }

  menu(side: 1 | 2): void {
    const s = this.st[side - 1];
    if (!this.poweredFn(side) || s.du === 0) return;
    s.idle = 0;
    this.router?.menu(side, s.du, s.x, s.y, this.hover(side));
  }

  data(side: 1 | 2, steps: number, inner: boolean): void {
    const s = this.st[side - 1];
    if (!this.poweredFn(side) || s.du === 0 || steps === 0) return;
    s.idle = 0;
    this.router?.data(side, s.du, s.x, s.y, this.hover(side), steps, inner);
  }

  /** Hot spot under the side's cursor ('' none). */
  hover(side: 1 | 2): string {
    return this.vars.getString(EPIC_STRINGS.ccdHover(side));
  }

  update(dt: number): void {
    for (const side of SIDES) {
      const s = this.st[side - 1];
      if (!this.poweredFn(side)) {
        if (s.du !== 0) {
          s.lastDu = s.du;
          s.du = 0;
          this.publish(side);
        }
        continue;
      }
      if (s.du !== 0) {
        s.idle += dt;
        if (s.idle > this.parkS) {
          s.lastDu = s.du;
          s.du = 0;
          this.publish(side);
          continue;
        }
      }
      const id = s.du !== 0 && this.router ? this.router.hitTest(side, s.du, s.x, s.y) : '';
      this.vars.setString(EPIC_STRINGS.ccdHover(side), id);
    }
  }

  private publish(side: 1 | 2): void {
    const s = this.st[side - 1];
    const v = this.vars;
    v.set(EPIC_VARS.ccdDu(side), s.du);
    v.set(EPIC_VARS.ccdX(side), s.x);
    v.set(EPIC_VARS.ccdY(side), s.y);
    if (s.du === 0) v.setString(EPIC_STRINGS.ccdHover(side), '');
    else if (this.router) v.setString(EPIC_STRINGS.ccdHover(side), this.router.hitTest(side, s.du, s.x, s.y));
  }
}

const SIDES = [1, 2] as const;
