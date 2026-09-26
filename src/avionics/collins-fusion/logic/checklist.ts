/**
 * Electronic checklist (ECL) logic for the CHECKLIST window.
 *
 * FSB BD-700-1A10 Rev 7 appendix 6: "Electronic Checklist (ECL) linked to
 * selected CAS messages (Version 4.5.8 software and later)"; EICAS synoptic
 * / checklist selection "controlled by CHK/SYS key on the multi-function
 * keyboard panel (MKP)". Item model follows `aircraft/types` Checklist:
 * closed-loop items (`check(vars)`) are sensed automatically (4 Hz, EST);
 * open-loop items are checked with the CCP ENTER key.
 */
import type { SimVars } from '../../../core/SimVars';
import type { Checklist } from '../../../aircraft/types';
import { FUSION_VARS } from '../vars';

export function isNonNormal(c: Checklist): boolean {
  return /abnormal|emergency|non-normal|warning|caution/i.test(c.phase);
}

export class ChecklistLogic {
  readonly lists: readonly Checklist[];
  /** checked[list][item]. */
  readonly checked: boolean[][];
  /** Items ticked by closed-loop sensing (drawn green). */
  readonly sensed: boolean[][];
  list = -1;
  cursor = 0;
  private timer = 0;

  constructor(
    private readonly vars: SimVars,
    lists: readonly Checklist[],
  ) {
    this.lists = lists;
    this.checked = lists.map((l) => l.items.map(() => false));
    this.sensed = lists.map((l) => l.items.map(() => false));
    this.select(lists.length ? 0 : -1);
  }

  get current(): Checklist | null {
    return this.list >= 0 ? (this.lists[this.list] ?? null) : null;
  }

  select(i: number): void {
    this.list = i >= 0 && i < this.lists.length ? i : -1;
    this.cursor = this.firstUnchecked();
    this.publish();
  }

  /** Opens the checklist with this title (CAS link); returns false when not found. */
  openTitle(title: string): boolean {
    const i = this.lists.findIndex((l) => l.title.toUpperCase() === title.toUpperCase());
    if (i < 0) return false;
    this.select(i);
    return true;
  }

  move(delta: number): void {
    const cl = this.current;
    if (!cl) return;
    this.cursor = Math.max(0, Math.min(cl.items.length - 1, this.cursor + delta));
    this.publish();
  }

  /** Checks / unchecks the item under the cursor; checking advances to the next open item. */
  toggle(): void {
    const cl = this.current;
    if (!cl || !cl.items.length) return;
    const c = this.checked[this.list];
    c[this.cursor] = !c[this.cursor];
    if (c[this.cursor]) this.cursor = this.firstUnchecked(this.cursor);
    this.publish();
  }

  /** Next / previous checklist in the list order. */
  nextList(delta = 1): void {
    if (!this.lists.length) return;
    const n = this.lists.length;
    this.select((((this.list < 0 ? 0 : this.list) + delta) % n + n) % n);
  }

  reset(i = this.list): void {
    if (i < 0) return;
    this.checked[i].fill(false);
    this.sensed[i].fill(false);
    if (i === this.list) this.cursor = 0;
    this.publish();
  }

  resetAll(): void {
    for (let i = 0; i < this.lists.length; i++) {
      this.checked[i].fill(false);
      this.sensed[i].fill(false);
    }
    this.cursor = 0;
    this.publish();
  }

  isComplete(i = this.list): boolean {
    if (i < 0) return false;
    return this.checked[i].every((x) => x);
  }

  private firstUnchecked(from = 0): number {
    if (this.list < 0) return 0;
    const c = this.checked[this.list];
    for (let k = from; k < c.length; k++) if (!c[k]) return k;
    for (let k = 0; k < from; k++) if (!c[k]) return k;
    return Math.max(0, Math.min(from, c.length - 1));
  }

  /** Closed-loop sensing (throttled to 4 Hz). */
  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    let changed = false;
    for (let i = 0; i < this.lists.length; i++) {
      const items = this.lists[i].items;
      for (let k = 0; k < items.length; k++) {
        const chk = items[k].check;
        if (!chk) continue;
        let ok = false;
        try {
          ok = chk(this.vars);
        } catch {
          ok = false;
        }
        if (ok !== this.sensed[i][k]) {
          this.sensed[i][k] = ok;
          this.checked[i][k] = ok;
          changed = true;
        }
      }
    }
    if (changed) this.publish();
  }

  private publish(): void {
    const v = this.vars;
    v.set(FUSION_VARS.eclList, this.list);
    v.set(FUSION_VARS.eclCursor, this.cursor);
    v.set(FUSION_VARS.eclComplete, this.isComplete() ? 1 : 0);
  }
}
