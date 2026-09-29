/**
 * Electronic checklist (ECL) logic for the Epic checklist windows (1/6 and
 * 2/3) and the Symmetry TSC checklist app.
 *
 * Behaviour (FAA FSB GVIII-G700 Rev 1 §9.2.1 c "ECL Philosophy: ...
 * selecting the default display, when autosensing occurs, selectable CAS
 * messages"; G650ER cockpit photograph of the checklist window: checkbox
 * items with dotted leaders, "Show Items", "Chklst Funct", "Active
 * Abnormal", "Undo Items" menu buttons):
 *  - Items are checked manually (CCD ENTER / touch) or automatically when
 *    their closed-loop condition (`Checklist.items[].check(vars)`) is true
 *    ("autosensing"). Manually checking an item moves the cursor to the next
 *    unchecked item.
 *  - "Undo Items" unchecks the last manually checked item.
 *  - "Show Items" toggles between all items and remaining items only.
 * SCOPE: abnormal checklists are the ones whose `phase` contains
 * 'Abnormal' or 'Emergency'; there is no CAS-message linking.
 */
import type { SimVars } from '../../../core/SimVars';
import type { Checklist } from '../../../aircraft/types';
import { EPIC_VARS } from '../vars';

export class ChecklistLogic {
  readonly name = 'epic.ecl';
  readonly lists: readonly Checklist[];
  /** Checked flags per list/item. */
  readonly checked: boolean[][];
  /** Auto-sensed flags per list/item (drawn with a filled green box). */
  readonly sensed: boolean[][];
  showRemainingOnly = false;
  private readonly vars: SimVars;
  private readonly history: [number, number][] = [];
  private senseTimer = 0;

  constructor(vars: SimVars, lists: readonly Checklist[]) {
    this.vars = vars;
    this.lists = lists;
    this.checked = lists.map((l) => l.items.map(() => false));
    this.sensed = lists.map((l) => l.items.map(() => false));
    if (!vars.has(EPIC_VARS.eclList)) vars.set(EPIC_VARS.eclList, lists.length ? 0 : -1);
    if (!vars.has(EPIC_VARS.eclCursor)) vars.set(EPIC_VARS.eclCursor, 0);
  }

  /** Index of the displayed list (-1 = index). */
  get current(): number {
    const i = this.vars.get(EPIC_VARS.eclList);
    return i >= 0 && i < this.lists.length ? i : -1;
  }

  get cursor(): number {
    return this.vars.get(EPIC_VARS.eclCursor);
  }

  select(list: number): void {
    this.vars.set(EPIC_VARS.eclList, list >= 0 && list < this.lists.length ? list : -1);
    this.vars.set(EPIC_VARS.eclCursor, this.firstUnchecked(list));
  }

  next(): void {
    if (!this.lists.length) return;
    this.select((this.current + 1) % this.lists.length);
  }

  prev(): void {
    if (!this.lists.length) return;
    this.select((this.current - 1 + this.lists.length) % this.lists.length);
  }

  /** Moves the cursor by `d` items. */
  move(d: number): void {
    const l = this.current;
    if (l < 0) {
      this.vars.set(EPIC_VARS.eclCursor, Math.max(0, Math.min(this.lists.length - 1, this.cursor + d)));
      return;
    }
    const n = this.lists[l].items.length;
    this.vars.set(EPIC_VARS.eclCursor, Math.max(0, Math.min(n - 1, this.cursor + d)));
  }

  /** Toggles item `i` (default: the cursor item) of the current list; advances to the next unchecked item. */
  toggle(i = this.cursor): void {
    const l = this.current;
    if (l < 0) {
      // Index page: open the list under the cursor.
      this.select(Math.round(this.cursor));
      return;
    }
    const items = this.checked[l];
    if (i < 0 || i >= items.length) return;
    items[i] = !items[i];
    if (items[i]) {
      this.history.push([l, i]);
      this.vars.set(EPIC_VARS.eclCursor, this.firstUnchecked(l));
    } else this.vars.set(EPIC_VARS.eclCursor, i);
  }

  /** "Undo Items": unchecks the last manually checked item. */
  undo(): void {
    const h = this.history.pop();
    if (!h) return;
    this.checked[h[0]][h[1]] = false;
    if (h[0] === this.current) this.vars.set(EPIC_VARS.eclCursor, h[1]);
  }

  /** Resets every list (new flight). */
  resetAll(): void {
    for (const a of this.checked) a.fill(false);
    for (const a of this.sensed) a.fill(false);
    this.history.length = 0;
  }

  /**
   * Checklist for a CAS message ("selectable CAS messages", FAA FSB
   * GVIII-G700 §9.2.1 c): a list whose title equals the message text
   * (case-insensitive), else one whose title contains it. -1 when none.
   */
  findForCas(text: string): number {
    const t = text.trim().toLowerCase();
    if (!t) return -1;
    let i = this.lists.findIndex((c) => c.title.trim().toLowerCase() === t);
    if (i < 0) i = this.lists.findIndex((c) => c.title.toLowerCase().includes(t));
    return i;
  }

  /** First abnormal/emergency checklist (the "Active Abnormal" key), or -1. */
  firstAbnormal(): number {
    return this.lists.findIndex((c) => /abnormal|emergency/i.test(c.phase));
  }

  isComplete(l = this.current): boolean {
    if (l < 0) return false;
    const c = this.checked[l];
    const s = this.sensed[l];
    for (let i = 0; i < c.length; i++) if (!c[i] && !s[i]) return false;
    return c.length > 0;
  }

  itemDone(l: number, i: number): boolean {
    return this.checked[l][i] || this.sensed[l][i];
  }

  private firstUnchecked(l: number): number {
    if (l < 0 || l >= this.lists.length) return 0;
    const n = this.lists[l].items.length;
    for (let i = 0; i < n; i++) if (!this.itemDone(l, i)) return i;
    return Math.max(0, n - 1);
  }

  update(dt: number): void {
    // Autosensing at 4 Hz (closed-loop items).
    this.senseTimer -= dt;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.25;
      const l = this.current;
      if (l >= 0) {
        const items = this.lists[l].items;
        const s = this.sensed[l];
        for (let i = 0; i < items.length; i++) {
          const chk = items[i].check;
          s[i] = chk ? safeCheck(chk, this.vars) : false;
        }
      }
    }
    this.vars.set(EPIC_VARS.eclComplete, this.isComplete() ? 1 : 0);
  }
}

function safeCheck(fn: (v: SimVars) => boolean, vars: SimVars): boolean {
  try {
    return !!fn(vars);
  } catch {
    return false;
  }
}
