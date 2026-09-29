/**
 * One pilot's FMS window: current page, page number, scratchpad and the
 * MKP key / line select dispatch. The page content comes from `pages.ts`.
 *
 * MKP keys (Multifunction Keyboard Panel MKP-6000; FSB BD-700-1A10 Rev 7:
 * "Multifunction Keyboard Panel (MKP)", FMS "Controlled at MKP, CTP, CCP and
 * soft buttons on displays"): alphanumeric keys, '.', '/', '+/-', SP, CLR,
 * DEL, EXEC, PREV, NEXT and the FMS function keys IDX, FPLN, LEGS, DEP/ARR,
 * DIR, PERF, PROG, VNAV, HOLD, TUNE, MSG. The function key set is EST
 * (Collins FMS-3000 / 6000 CDU key set; no MKP-6000 drawing was available).
 */
import type { SimVars } from '../../../core/SimVars';
import { FMS } from '../../../core/vars';
import { FUSION_STRINGS } from '../vars';
import type { FmsHost } from './host';
import { FmsScreen, type LskId } from './screen';
import { FMS_PAGES, type FmsPageId, type LskResult, type PageCtx } from './pages';

/** MKP keys that select FMS pages (key id -> page). */
export const FMS_FUNCTION_KEYS: Readonly<Record<string, FmsPageId>> = {
  IDX: 'IDX',
  FPLN: 'FPLN',
  LEGS: 'LEGS',
  DEPARR: 'DEP',
  DIR: 'DIR',
  PERF: 'PERF',
  PROG: 'PROG',
  VNAV: 'VNAV',
  HOLD: 'HOLD',
  TUNE: 'TUNE',
  MSG: 'MSG',
};

const MAX_SCRATCH = 24;

export class FmsWindowModel {
  readonly screen = new FmsScreen();
  pageId: FmsPageId = 'IDX';
  pageIndex = 1;
  scratch = '';
  /** Message shown in the scratchpad line instead of the entry (CLR removes it). */
  msg = '';
  /** Per-page browsing state (DEPARTURE / ARRIVAL selections, HOLD entries). */
  readonly state: Record<string, unknown> = {};
  private timer = 0;
  private lastVersion = -1;
  private lastMod = -1;
  private dirty = true;
  private readonly ctx: PageCtx;
  private readonly pageVar: string;
  private readonly scratchVar: string;

  constructor(
    readonly side: 1 | 2,
    readonly host: FmsHost,
    private readonly vars: SimVars,
    private readonly powered: () => boolean = () => true,
  ) {
    this.ctx = { host, win: this, vars, side };
    this.pageVar = FUSION_STRINGS.fmsPage(side);
    this.scratchVar = FUSION_STRINGS.fmsScratch(side);
    this.render();
  }

  show(id: FmsPageId, index = 1): void {
    this.pageId = id;
    this.pageIndex = index;
    this.dirty = true;
    this.render();
  }

  /** MKP key. Returns true when the key was used by the FMS window. */
  key(k: string): boolean {
    if (!this.powered()) return false;
    const fk = FMS_FUNCTION_KEYS[k];
    if (fk) {
      // DEP/ARR: departure on the ground near the origin, else arrival.
      if (fk === 'DEP') this.show(this.host.vars.getBool('gear.air_ground') || !this.host.plan?.destination ? 'DEP' : 'ARR');
      else this.show(fk);
      return true;
    }
    switch (k) {
      case 'PREV':
      case 'NEXT': {
        const n = FMS_PAGES[this.pageId].pages(this.ctx);
        if (n > 1) {
          this.pageIndex = ((this.pageIndex - 1 + (k === 'NEXT' ? 1 : -1) + n) % n) + 1;
          this.dirty = true;
          this.render();
        }
        return true;
      }
      case 'EXEC':
        this.host.exec();
        this.dirty = true;
        return true;
      case 'CLR':
        if (this.msg) this.msg = '';
        else if (this.scratch === 'DELETE') this.scratch = '';
        else this.scratch = this.scratch.slice(0, -1);
        this.dirty = true;
        this.publish();
        return true;
      case 'CLRALL':
        this.msg = '';
        this.scratch = '';
        this.dirty = true;
        this.publish();
        return true;
      case 'DEL':
        if (!this.scratch) this.scratch = 'DELETE';
        this.msg = '';
        this.publish();
        return true;
      case 'SP':
        return this.type(' ');
      case 'PLUSMINUS':
        if (this.scratch.endsWith('-')) this.scratch = `${this.scratch.slice(0, -1)}+`;
        else if (this.scratch.endsWith('+')) this.scratch = `${this.scratch.slice(0, -1)}-`;
        else return this.type('-');
        this.publish();
        return true;
      case 'DOT':
        return this.type('.');
      case 'SLASH':
        return this.type('/');
    }
    if (/^[A-Z0-9./]$/.test(k)) return this.type(k);
    return false;
  }

  /** Types one character into the scratchpad. */
  type(ch: string): boolean {
    if (!this.powered()) return false;
    if (this.scratch === 'DELETE') this.scratch = '';
    this.msg = '';
    if (this.scratch.length < MAX_SCRATCH) this.scratch += ch;
    this.publish();
    return true;
  }

  /** Line select (cursor ENTER on a line select hot spot). */
  lsk(id: LskId): void {
    if (!this.powered()) return;
    const page = FMS_PAGES[this.pageId];
    let r: LskResult;
    try {
      r = page.lsk(this.ctx, id, this.scratch, this.pageIndex);
    } catch {
      r = { error: 'INVALID ENTRY' };
    }
    if (r) {
      if (r.error) this.msg = r.error;
      if (r.scratch !== undefined) {
        this.scratch = r.scratch;
        this.msg = '';
      } else if (r.ok && !r.keep) this.scratch = '';
      if (r.page) {
        this.pageId = r.page;
        this.pageIndex = r.index ?? 1;
      }
    }
    this.dirty = true;
    this.render();
  }

  /** Scratchpad line text (message overrides the entry). */
  get scratchText(): string {
    return this.msg || this.scratch;
  }

  update(dt: number): void {
    this.timer -= dt;
    const ver = this.vars.get(FMS.planVersion);
    const mod = this.vars.get(FMS.modPending);
    if (ver !== this.lastVersion || mod !== this.lastMod) {
      this.lastVersion = ver;
      this.lastMod = mod;
      this.dirty = true;
    }
    if (this.dirty || this.timer <= 0) this.render();
  }

  /** Rebuilds the screen (2 Hz or on change; allocates strings). */
  render(): void {
    this.timer = 0.5;
    this.dirty = false;
    const s = this.screen;
    s.clear();
    const page = FMS_PAGES[this.pageId];
    const n = Math.max(1, page.pages(this.ctx));
    if (this.pageIndex > n) this.pageIndex = n;
    s.pages = n;
    s.page = this.pageIndex;
    try {
      page.render(this.ctx, s, this.pageIndex);
    } catch {
      s.dataC(3, 'PAGE UNAVAILABLE', 'amber');
    }
    s.scratch = this.scratchText;
    s.scratchColor = this.msg ? 'amber' : 'white';
    this.publish();
  }

  private publish(): void {
    this.screen.scratch = this.scratchText;
    this.screen.scratchColor = this.msg ? 'amber' : 'white';
    this.vars.setString(this.pageVar, this.pageId);
    this.vars.setString(this.scratchVar, this.scratchText);
  }
}
