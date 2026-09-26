/**
 * Multifunction Keyboard Panel (MKP-6000) key dispatch, one MKP per pilot.
 *
 * FSB BD-700-1A10 Rev 7 appendix 6: FMS "Controlled at MKP, CTP, CCP and
 * soft buttons on displays"; EICAS synoptic / checklist selection
 * "controlled by CHK/SYS key on the multi-function keyboard panel (MKP)";
 * "DU presentation, nine (9) memory selections"; "Electronic Checklist
 * (ECL) linked to selected CAS messages".
 *
 * Key ids (EST key set; no public MKP-6000 drawing): 'A'..'Z', '0'..'9',
 * DOT, SLASH, PLUSMINUS, SP, CLR, CLRALL, DEL, EXEC, PREV, NEXT, the FMS
 * function keys (fms/window.ts FMS_FUNCTION_KEYS), FMS (brings up the FMS
 * window), CHKSYS, CAS_UP / CAS_DN (EICAS message scroll; the cursor cannot
 * enter the EICAS window), MEM / STO followed by a digit 1-9 (recall /
 * store a display memory; EST two-key sequence).
 */
import type { LayoutManager } from './layout';
import type { FusionCas } from './cas';
import type { ChecklistLogic } from './checklist';
import type { FmsWindowModel } from '../fms/window';
import { FMS_FUNCTION_KEYS } from '../fms/window';
import { Win, type Slot } from '../vars';

export const MKP_KEYS: readonly string[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  'DOT',
  'SLASH',
  'PLUSMINUS',
  'SP',
  'CLR',
  'DEL',
  'EXEC',
  'PREV',
  'NEXT',
  ...Object.keys(FMS_FUNCTION_KEYS),
  'FMS',
  'CHKSYS',
  'CAS_UP',
  'CAS_DN',
  'MEM',
  'STO',
];

export interface MkpHost {
  layout: LayoutManager;
  cas: FusionCas;
  checklist: ChecklistLogic;
  fmsWin: [FmsWindowModel, FmsWindowModel];
  /** CAS message id -> checklist title (CAS-linked ECL). */
  casChecklists: Readonly<Record<string, string>>;
  /** Brings content `win` up for `side` (suite rule). */
  showWindow(side: 1 | 2, win: Win): void;
  /** Content shown in a window owned by `side`, or null when none shows it. */
  sideShows(side: 1 | 2, win: Win): { n: number; slot: Slot } | null;
  powered(side: 1 | 2): boolean;
}

export class MkpLogic {
  /** Pending two-key sequence per side ('' / 'MEM' / 'STO'). */
  readonly pending: [string, string] = ['', ''];

  constructor(private readonly h: MkpHost) {}

  key(side: 1 | 2, k: string): void {
    const h = this.h;
    if (!h.powered(side)) return;
    const pend = this.pending[side - 1];
    if (pend) {
      this.pending[side - 1] = '';
      if (/^[1-9]$/.test(k)) {
        if (pend === 'MEM') h.layout.recall(side, Number(k));
        else h.layout.store(side, Number(k));
        return;
      }
    }
    switch (k) {
      case 'MEM':
      case 'STO':
        this.pending[side - 1] = k;
        return;
      case 'CAS_UP':
        h.cas.scrollBy(-1);
        return;
      case 'CAS_DN':
        h.cas.scrollBy(1);
        return;
      case 'CHKSYS':
        this.chkSys(side);
        return;
      case 'FMS':
        h.showWindow(side, Win.Fms);
        return;
    }
    const fm = h.fmsWin[side - 1];
    if (FMS_FUNCTION_KEYS[k]) {
      h.showWindow(side, Win.Fms);
      fm.key(k);
      return;
    }
    fm.key(k);
  }

  /**
   * CHK/SYS: a CAS message linked to a checklist opens that checklist
   * (first press); otherwise toggles the side's SYSTEMS / CHECKLIST window
   * (EST behaviour).
   */
  chkSys(side: 1 | 2): void {
    const h = this.h;
    const linked = h.cas.newestLinked(h.casChecklists);
    if (linked) {
      const title = h.casChecklists[linked.id];
      const cur = h.checklist.current;
      if (title && (!cur || cur.title.toUpperCase() !== title.toUpperCase()) && h.checklist.openTitle(title)) {
        this.swap(side, Win.Chkl);
        return;
      }
    }
    if (h.sideShows(side, Win.Sys)) this.swap(side, Win.Chkl);
    else this.swap(side, Win.Sys);
  }

  /** Replaces the side's SYSTEMS / CHECKLIST window by `win`, or brings `win` up. */
  private swap(side: 1 | 2, win: Win): void {
    const h = this.h;
    if (h.sideShows(side, win)) return;
    const other = win === Win.Sys ? Win.Chkl : Win.Sys;
    const at = h.sideShows(side, other);
    if (at && h.layout.select(at.n, at.slot, win)) return;
    h.showWindow(side, win);
  }
}
