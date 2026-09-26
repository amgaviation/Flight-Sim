/**
 * Base class of the Epic DU windows (PFD, map, engine, CAS, checklist,
 * synoptics ...) and the shared services a window can use.
 *
 * A window draws into a rectangle of its DU (logical pixels of the DU
 * canvas). Interactive elements are exposed as `Hotspot`s so the CCD
 * cursor can highlight and activate them (logic/cursor.ts).
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { NavDatabase } from '../../../nav/types';
import type { WorldQuery } from '../../../world/types';
import type { Fms } from '../../../nav/fms/Fms';
import type { Ctx2D } from '../../common/draw/context';
import type { EpicResolvedConfig } from '../config';
import type { Hotspot } from '../logic/cursor';
import type { WindowManager } from '../logic/windows';
import type { GulfstreamCas } from '../logic/cas';
import type { ChecklistLogic } from '../logic/checklist';
import type { SystemReadouts } from '../logic/bindings';
import type { Win } from '../vars';
import { C, rect, text } from '../style';

/** Services shared by all DU windows. */
export interface EpicServices {
  vars: SimVars;
  events: EventBus;
  cfg: EpicResolvedConfig;
  windows: WindowManager;
  cas: GulfstreamCas;
  checklist: ChecklistLogic;
  readouts: SystemReadouts;
  fms: Fms | null;
  nav: NavDatabase | null;
  world: WorldQuery | null;
}

export type WindowFormat = 'full' | 'main' | 'sixth';

export abstract class EpicWindow {
  abstract readonly kind: Win;
  x = 0;
  y = 0;
  w = 0;
  h = 0;
  format: WindowFormat = 'main';
  /** Continuous redraw needed (moving symbology). */
  animating = false;
  /** Interactive areas (fixed objects; positions set in `layout`). */
  readonly hotspots: Hotspot[] = [];
  /** Hot spot id under a cursor on this DU ('' none), set by the DU before drawing. */
  hover = '';

  constructor(
    readonly svc: EpicServices,
    /** DU number (1..4). */
    readonly du: number,
    /** Side whose sensors / settings this window follows (1 pilot, 2 copilot). */
    public side: 1 | 2,
  ) {}

  get vars(): SimVars {
    return this.svc.vars;
  }

  /** Sets the window rectangle; subclasses reposition their parts. */
  layout(x: number, y: number, w: number, h: number, format: WindowFormat): void {
    const changed = x !== this.x || y !== this.y || w !== this.w || h !== this.h || format !== this.format;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.format = format;
    if (changed) this.onLayout();
  }

  protected onLayout(): void {}

  update(_dt: number): void {}

  abstract draw(ctx: Ctx2D): void;

  /** CCD ENTER on hot spot `id` (by `side`). */
  enter(_side: 1 | 2, _id: string): void {}

  /** CCD DATA SET knob over hot spot `id` (or the window background when id is ''). */
  data(_side: 1 | 2, _id: string, _steps: number, _inner: boolean): void {}

  /** Defines / moves a hot spot (reuses the object with the same id). */
  protected spot(id: string, x: number, y: number, w: number, h: number): Hotspot {
    let s = this.hotspots.find((q) => q.id === id);
    if (!s) {
      s = { id, x, y, w, h };
      this.hotspots.push(s);
    } else {
      s.x = x;
      s.y = y;
      s.w = w;
      s.h = h;
    }
    return s;
  }

  /** Dark window background with the thin grey window border. */
  protected frame(ctx: Ctx2D, bg: string = C.black): void {
    rect(ctx, this.x, this.y, this.w, this.h, bg, '');
  }

  /** Title in the window's top-left corner. */
  protected title(ctx: Ctx2D, t: string, color: string = C.white): void {
    text(ctx, t, this.x + 10, this.y + 16, 16, color, 'left', 'middle');
  }
}
