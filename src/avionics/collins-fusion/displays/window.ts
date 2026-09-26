/**
 * Window renderer contract and shared services of the Pro Line Fusion AFDs.
 *
 * A window (PFD, EICAS or a multifunction window) draws itself into its rect
 * of the AFD canvas and registers cursor hot spots while drawing (fixed
 * capacity, no allocation per frame). The AFD routes CCP cursor ENTER / DATA
 * to the hot spot under the cursor.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { NavDatabase } from '../../../nav/types';
import type { WorldQuery } from '../../../world/types';
import type { Fms } from '../../../nav/fms/Fms';
import type { Ctx2D } from '../../common/draw/context';
import type { FusionResolvedConfig } from '../config';
import type { LayoutManager, ShownWindow } from '../logic/layout';
import type { FusionCas } from '../logic/cas';
import type { ChecklistLogic } from '../logic/checklist';
import type { SynopticReadouts } from '../logic/readouts';
import type { FmsHost } from '../fms/host';
import type { FmsWindowModel } from '../fms/window';
import type { PfdRenderer } from './pfd';
import type { Win } from '../vars';

/** Fixed-capacity list of rectangular hot spots (logical AFD px). */
export class HotSpots {
  readonly cap: number;
  n = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly w: Float32Array;
  readonly h: Float32Array;
  readonly id: string[];

  constructor(cap = 96) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.w = new Float32Array(cap);
    this.h = new Float32Array(cap);
    this.id = new Array<string>(cap).fill('');
  }

  clear(): void {
    this.n = 0;
  }

  add(id: string, x: number, y: number, w: number, h: number): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.id[i] = id;
    this.x[i] = x;
    this.y[i] = y;
    this.w[i] = w;
    this.h[i] = h;
  }

  /** Topmost hot spot at (px, py), '' = none. */
  at(px: number, py: number): string {
    for (let i = this.n - 1; i >= 0; i--) {
      if (px >= this.x[i] && px < this.x[i] + this.w[i] && py >= this.y[i] && py < this.y[i] + this.h[i]) return this.id[i];
    }
    return '';
  }

  /** Index of a hot spot id (-1 = none). */
  indexOf(id: string): number {
    for (let i = 0; i < this.n; i++) if (this.id[i] === id) return i;
    return -1;
  }
}

export interface MenuItem {
  id: string;
  label: string;
  /** Checked / current selection (drawn with a tick). */
  on?: boolean;
  enabled?: boolean;
}

export interface WindowRenderer {
  /** Per-render update (sensors -> state). */
  update(dt: number, w: ShownWindow): void;
  /** Draws into `w.rect` of the AFD and registers hot spots (AFD px). */
  draw(ctx: Ctx2D, w: ShownWindow, hs: HotSpots): void;
  /** Cursor ENTER on one of this window's hot spots. */
  enter?(side: 1 | 2, w: ShownWindow, id: string): void;
  /** CCP DATA knob with the cursor in this window (id = hot spot under the cursor, may be ''). */
  data?(side: 1 | 2, w: ShownWindow, id: string, steps: number, inner: boolean): void;
  /** Window-specific window-menu items (appended after the content list). */
  menuItems?(w: ShownWindow): MenuItem[];
  /** A window-menu item of this window was selected. */
  menuSelect?(side: 1 | 2, w: ShownWindow, id: string): void;
  /** Continuous redraw needed (moving map, PFD). */
  readonly animated: boolean;
}

export interface FusionServices {
  vars: SimVars;
  events: EventBus;
  cfg: FusionResolvedConfig;
  layout: LayoutManager;
  cas: FusionCas;
  checklist: ChecklistLogic;
  readouts: SynopticReadouts;
  fmsHost: FmsHost;
  fmsWin: [FmsWindowModel, FmsWindowModel];
  pfd: [PfdRenderer, PfdRenderer];
  nav: NavDatabase | null;
  world: Pick<WorldQuery, 'elevationAt'> | null;
  fms: Fms | null;
  /** Content shown when an MKP key asks for a window (FMS, SYSTEMS, CHECKLIST): brings it up for `side`. */
  showWindow(side: 1 | 2, win: Win): void;
}
