/**
 * One 737NG Control Display Unit (CDU): keyboard handling, scratchpad and
 * page selection. Both CDUs talk to the single FMC (b737.org.uk FMC page:
 * "two keyboards connected to the one PC"); each has its own page and
 * scratchpad.
 *
 * Keys (ids as used by the cockpit KeyPad; event `ac.cdu<s>.key`, payload
 * = id; CLR release `ac.cdu<s>.CLR:up`):
 *   L1..L6 / R1..R6 line select keys
 *   INIT_REF RTE CLB CRZ DES MENU (or DIR_INTC) LEGS DEP_ARR HOLD PROG EXEC
 *   N1_LIMIT FIX PREV_PAGE NEXT_PAGE
 *   A..Z 0..9 SP DEL / CLR +/- .
 *
 * Scratchpad rules (FCOM 11.40 "Scratchpad"): keys append characters (24
 * max); CLR deletes the last character, held for more than one second it
 * clears the line; DEL writes DELETE into an empty scratchpad (the next
 * line select key deletes that data); +/- writes '-' and toggles it with
 * '+'. Entry errors (INVALID ENTRY, NOT IN DATA BASE, INVALID DELETE) are
 * shown on the CDU that made the entry until cleared with CLR (the entry
 * is kept underneath). FMC alerting / advisory messages are shown on both
 * CDUs over the scratchpad and light the MSG annunciator; CLR removes the
 * message; typing brings the scratchpad back in front of it.
 */
import type { EventBus } from '../../../core/EventBus';
import { CduScreen, CduColor } from './screen';
import type { B737Fmc } from './Fmc';
import type { CduPage, Lsk, PageId } from './pages/common';
import { createPages } from './pages';
import { B737_EVENTS, type Side } from '../vars';

/** Seconds CLR must be held to clear the whole scratchpad. */
const CLR_HOLD_S = 1.0;

export class Cdu {
  readonly side: Side;
  readonly fmc: B737Fmc;
  readonly screen = new CduScreen();
  /** Scratchpad text (entry being typed). */
  scratch = '';
  /** Local entry error message (shown instead of the scratchpad until CLR). */
  entryError = '';
  page: CduPage;
  /** Current sub-page (0-based). */
  sub = 0;
  /** Per-page transient state (selection lists, pending VIA entries...). */
  readonly state = new Map<string, unknown>();
  private readonly pages: Map<PageId, CduPage>;
  private readonly offs: (() => void)[] = [];
  private typedOverMsg = false;
  private lastMsgTop = '';
  private clrHeld = -1;
  private clrReleaseSeen = false;

  constructor(fmc: B737Fmc, side: Side, events?: EventBus) {
    this.fmc = fmc;
    this.side = side;
    this.pages = createPages();
    this.page = this.pages.get('ident')!;
    if (events) {
      this.offs.push(
        events.on(B737_EVENTS.cduKey(side), (p) => {
          if (typeof p === 'string') this.key(p);
        }),
        events.on(`${B737_EVENTS.cduKeyPrefix(side)}CLR:up`, () => this.clrUp()),
      );
    }
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  get pageId(): PageId {
    return this.page.id;
  }

  /** Shows a page (sub-page index 0-based). */
  show(id: PageId, sub = 0): void {
    const p = this.pages.get(id);
    if (!p) return;
    this.page = p;
    this.sub = sub;
    p.onShow?.(this);
  }

  pageObj(id: PageId): CduPage | undefined {
    return this.pages.get(id);
  }

  // ------------------------------------------------------------ scratchpad API for pages

  /** True when the scratchpad holds DELETE. */
  get isDelete(): boolean {
    return this.scratch === 'DELETE';
  }

  /** Clears the scratchpad after an accepted entry. */
  consume(): void {
    this.scratch = '';
    this.typedOverMsg = false;
  }

  /** Shows an entry error (INVALID ENTRY...). */
  error(msg: string): void {
    this.entryError = msg;
  }

  /** Copies data into the scratchpad (LSK with an empty scratchpad). */
  copy(text: string): void {
    this.scratch = text.slice(0, 24);
    this.entryError = '';
    this.typedOverMsg = true;
  }

  /** Text currently displayed on the scratchpad line and whether it is a message. */
  scratchLine(): { text: string; msg: boolean } {
    if (this.entryError) return { text: this.entryError, msg: true };
    const top = this.fmc.messages[0]?.text ?? '';
    if (top && !(this.typedOverMsg && this.scratch)) return { text: top, msg: true };
    return { text: this.scratch, msg: false };
  }

  // ------------------------------------------------------------ keys

  key(id: string): void {
    if (!this.fmc.powered) return;
    const k = id.toUpperCase();
    const lsk = /^([LR])([1-6])$/.exec(k);
    if (lsk) {
      this.page.lsk(this, { side: lsk[1] as 'L' | 'R', row: Number(lsk[2]) });
      return;
    }
    switch (k) {
      case 'INIT_REF':
      case 'INIT REF':
        this.show(this.initRefPage());
        return;
      case 'RTE':
        this.show('rte');
        return;
      case 'CLB':
        this.show('clb');
        return;
      case 'CRZ':
        this.show('crz');
        return;
      case 'DES':
        this.show('des');
        return;
      case 'MENU':
        this.show('menu');
        return;
      case 'DIR_INTC':
      case 'DIR INTC':
      case 'LEGS':
        this.show('legs');
        return;
      case 'DEP_ARR':
      case 'DEP ARR':
        this.show('depArr');
        return;
      case 'HOLD':
        this.show('hold');
        return;
      case 'PROG':
        this.show('prog');
        return;
      case 'N1_LIMIT':
      case 'N1 LIMIT':
        this.show('n1');
        return;
      case 'FIX':
        this.show('fix');
        return;
      case 'EXEC':
        this.fmc.exec();
        return;
      case 'PREV_PAGE':
      case 'PREV PAGE': {
        const n = this.page.pages(this);
        this.sub = n > 1 ? (this.sub - 1 + n) % n : 0;
        return;
      }
      case 'NEXT_PAGE':
      case 'NEXT PAGE': {
        const n = this.page.pages(this);
        this.sub = n > 1 ? (this.sub + 1) % n : 0;
        return;
      }
      case 'CLR':
        this.clrDown();
        return;
      case 'DEL':
        if (this.entryError) return;
        if (this.scratch === '') {
          this.scratch = 'DELETE';
          this.typedOverMsg = true;
        }
        return;
      case '+/-':
      case 'PLUSMINUS': {
        this.beginTyping();
        const last = this.scratch.slice(-1);
        if (last === '-') this.scratch = this.scratch.slice(0, -1) + '+';
        else if (last === '+') this.scratch = this.scratch.slice(0, -1) + '-';
        else this.append('-');
        return;
      }
      case 'SP':
        this.beginTyping();
        this.append(' ');
        return;
      case 'SLASH':
      case '/':
        this.beginTyping();
        this.append('/');
        return;
      case 'DOT':
      case '.':
        this.beginTyping();
        this.append('.');
        return;
      default:
        if (/^[A-Z0-9]$/.test(k)) {
          this.beginTyping();
          this.append(k);
        }
    }
  }

  private beginTyping(): void {
    if (this.entryError) this.entryError = '';
    if (this.scratch === 'DELETE') this.scratch = '';
    this.typedOverMsg = true;
  }

  private append(ch: string): void {
    if (this.scratch.length < 24) this.scratch += ch;
  }

  private clrDown(): void {
    this.clrHeld = 0;
    if (this.entryError) {
      this.entryError = '';
      return;
    }
    const line = this.scratchLine();
    if (line.msg) {
      this.fmc.clearTopMessage();
      return;
    }
    if (this.scratch === 'DELETE') this.scratch = '';
    else this.scratch = this.scratch.slice(0, -1);
    if (!this.scratch) this.typedOverMsg = false;
  }

  private clrUp(): void {
    this.clrReleaseSeen = true;
    this.clrHeld = -1;
  }

  /** Page shown by INIT REF for the flight phase (FCOM 11.40 "INIT REF key"). */
  private initRefPage(): PageId {
    const f = this.fmc;
    if (!f.ground) return 'approach';
    if (f.messages.some((m) => m.text === 'ENTER IRS POSITION')) return 'pos';
    if (!f.hasActiveRoute) return 'ident';
    if (!Number.isFinite(f.zfwKg) || !Number.isFinite(f.perf.costIndex) || !Number.isFinite(f.perf.crzAltFt)) return 'perfInit';
    return 'takeoff';
  }

  // ------------------------------------------------------------ update / render

  update(dt: number): void {
    // CLR held (only when the keypad reports releases).
    if (this.clrHeld >= 0 && this.clrReleaseSeen) {
      this.clrHeld += dt;
      if (this.clrHeld >= CLR_HOLD_S) {
        this.scratch = '';
        this.typedOverMsg = false;
        this.clrHeld = -1;
      }
    }
    // A new FMC message comes in front of the scratchpad.
    const top = this.fmc.messages[0]?.text ?? '';
    if (top !== this.lastMsgTop) {
      this.lastMsgTop = top;
      if (top) this.typedOverMsg = false;
    }
  }

  /** Renders the current page into `screen` (always; cheap). Returns the screen. */
  render(): CduScreen {
    const s = this.screen;
    s.clear();
    if (!this.fmc.powered) return s;
    const n = this.page.pages(this);
    if (this.sub >= n) this.sub = Math.max(0, n - 1);
    this.page.render(this, s);
    const line = this.scratchLine();
    s.put(13, 0, line.text, { color: CduColor.White, small: false });
    return s;
  }
}
