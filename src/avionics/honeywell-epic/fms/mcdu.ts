/**
 * MCDU controller: key handling, scratchpad, page navigation and the FMS
 * message queue. One `Mcdu` per control display unit (G650: three on the
 * pedestal, "Any of the three MCDUs installed on the cockpit pedestal may be
 * used to tune the COM and NAV radios" — G550 OM 2A-23-40), plus one per
 * Symmetry TSC hosting the FMS app. All MCDUs share one `FmsShared` state
 * (the FMS itself, performance data and messages).
 *
 * Keys (payload of `EPIC_EVENTS.mcduKey(n)`): 'A'..'Z', '0'..'9', '.', '/',
 * '+/-', 'SP', 'CLR', 'DEL', 'L1'..'L6', 'R1'..'R6', and the function keys
 * FPL, NAV, PERF, PROG, DIR, RADIO, MSG, DLK, MENU, PREV, NEXT.
 * CLR removes the last scratchpad character (a message is cleared first);
 * holding CLR ('CLR_HOLD') clears the scratchpad. DEL puts DELETE in the
 * empty scratchpad; a line select key then deletes the entry.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { NavDatabase } from '../../../nav/types';
import type { Fms } from '../../../nav/fms/Fms';
import type { FlightPlan } from '../../../nav/flightplan/FlightPlan';
import type { AirportProcedures } from '../../../nav/types';
import { EPIC_EVENTS, EPIC_STRINGS, EPIC_VARS } from '../vars';
import type { EpicResolvedConfig } from '../config';
import { CduScreen, type LskId } from './cdu';

/** A page of the MCDU. */
export interface CduPage {
  readonly id: string;
  /** Sub-page count for PREV / NEXT (default 1). */
  pages?(m: Mcdu): number;
  render(m: Mcdu, s: CduScreen, sub: number): void;
  lsk?(m: Mcdu, k: LskId, sub: number): void;
  /** Live refresh period (s), 0 = redraw only on changes (default 1). */
  refreshS?: number;
}

/** Performance-initialisation data shared by all MCDUs (PERF INIT pages). */
export interface PerfData {
  acftType: string;
  tail: string;
  climbKt: number;
  climbMach: number;
  cruiseMach: number;
  cruiseKt: number;
  descentMach: number;
  descentKt: number;
  transAltFt: number;
  speedLimitKt: number;
  speedLimitAltFt: number;
  bowLb: number;
  paxCargoLb: number;
  reservesLb: number;
  cruiseAltFt: number;
  confirmed: boolean;
  rnpNm: number;
}

/** State shared by every MCDU / FMS app of the aircraft. */
export class FmsShared {
  readonly perf: PerfData;
  readonly messages: string[] = [];
  /** Procedure cache per airport (async `loadProcedures`). */
  readonly procs = new Map<string, AirportProcedures | null | 'loading'>();
  /** Last loaded route string (ROUTE page). */
  lastRoute = '';
  /** Pending hold definition (HOLD page). */
  hold = { ident: '', courseMag: NaN, turn: 'R' as 'L' | 'R', legMin: 1 };
  version = 0;

  constructor(
    readonly vars: SimVars,
    readonly events: EventBus,
    readonly fms: Fms | null,
    readonly db: NavDatabase | null,
    readonly cfg: EpicResolvedConfig,
  ) {
    this.perf = {
      acftType: cfg.airframe.name,
      tail: 'N650GA',
      climbKt: 250,
      climbMach: 0.8,
      cruiseMach: 0.85,
      cruiseKt: 300,
      descentMach: 0.8,
      descentKt: 280,
      transAltFt: 18000,
      speedLimitKt: 250,
      speedLimitAltFt: 10000,
      bowLb: NaN,
      paxCargoLb: NaN,
      reservesLb: 3000,
      cruiseAltFt: NaN,
      confirmed: false,
      rnpNm: NaN,
    };
    vars.set('epic.fms.perf_init', 0);
  }

  /** Posts an FMS message (MSG page, scratchpad of every MCDU). */
  post(text: string): void {
    const i = this.messages.indexOf(text);
    if (i >= 0) this.messages.splice(i, 1);
    this.messages.unshift(text);
    if (this.messages.length > 20) this.messages.length = 20;
    this.version++;
  }

  /** Plan being edited / displayed (MOD when pending). */
  get plan(): FlightPlan | null {
    return this.fms ? this.fms.plans.displayed : null;
  }

  get modPending(): boolean {
    return !!this.fms && this.fms.plans.modified !== null;
  }

  /** Applies a plan edit (Honeywell: into the MOD plan when the FMS uses MOD/ACTIVATE). */
  edit(fn: (p: FlightPlan) => void): boolean {
    if (!this.fms) return false;
    try {
      this.fms.plans.apply(fn);
      this.version++;
      return true;
    } catch (e) {
      this.post(e instanceof Error && e.message.length < 25 ? e.message.toUpperCase() : 'INVALID ENTRY');
      return false;
    }
  }

  activate(): void {
    this.events.emit('fms.exec');
    this.version++;
  }

  cancelMod(): void {
    this.events.emit('fms.erase');
    this.version++;
  }

  /** Loads (once) and returns the procedures of an airport; null while loading or unknown. */
  procedures(icao: string): AirportProcedures | null {
    const k = icao.toUpperCase();
    const c = this.procs.get(k);
    if (c === 'loading') return null;
    if (c !== undefined) return c;
    const loader = this.db?.loadProcedures;
    if (!loader) {
      this.procs.set(k, null);
      return null;
    }
    this.procs.set(k, 'loading');
    loader
      .call(this.db, k)
      .then((p) => {
        this.procs.set(k, p ?? null);
        this.version++;
      })
      .catch(() => {
        this.procs.set(k, null);
        this.version++;
      });
    return null;
  }

  /** Applies the PERF INIT speed schedule and cruise altitude to the FMS. */
  applyPerf(): void {
    const p = this.perf;
    this.fms?.setSpeeds({
      climbKt: p.climbKt,
      climbMach: p.climbMach,
      cruiseKt: p.cruiseKt,
      cruiseMach: p.cruiseMach,
      descentKt: p.descentKt,
      descentMach: p.descentMach,
    });
    if (Number.isFinite(p.cruiseAltFt) && this.fms) this.fms.setCruiseAltitude(p.cruiseAltFt);
    this.vars.set('epic.fms.perf_init', p.confirmed ? 1 : 0);
    this.version++;
  }
}

export class Mcdu {
  readonly screen = new CduScreen();
  scratch = '';
  /** Message shown in the scratchpad (cleared by CLR), or ''. */
  msg = '';
  page: CduPage;
  sub = 0;
  /** Incremented whenever the screen content changed (displays watch it). */
  version = 0;
  private readonly pagesById: Map<string, CduPage>;
  private readonly offs: (() => void)[] = [];
  private refreshT = 0;
  private lastShared = -1;
  private lastMsgCount = 0;
  private dirty = true;

  constructor(
    readonly index: number,
    readonly shared: FmsShared,
    pages: readonly CduPage[],
    /** Page ids of the function keys. */
    private readonly keyPages: Readonly<Record<string, string>>,
    readonly powered: () => boolean = () => true,
  ) {
    this.pagesById = new Map(pages.map((p) => [p.id, p]));
    this.page = this.pagesById.get(keyPages.FPL ?? pages[0].id) ?? pages[0];
    const events = shared.events;
    this.offs.push(events.on(EPIC_EVENTS.mcduKey(index), (p) => this.key(String(p ?? ''))));
  }

  get vars(): SimVars {
    return this.shared.vars;
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  /** Shows page `id` (sub-page `sub`). */
  show(id: string, sub = 0): void {
    const p = this.pagesById.get(id);
    if (!p) return;
    this.page = p;
    this.sub = sub;
    this.dirty = true;
  }

  hasPage(id: string): boolean {
    return this.pagesById.has(id);
  }

  /** Takes the scratchpad content (clears it). */
  take(): string {
    const s = this.scratch;
    this.scratch = '';
    this.dirty = true;
    return s;
  }

  /** Error in the scratchpad (the entry stays for correction). */
  error(text = 'INVALID ENTRY'): void {
    this.msg = text;
    this.dirty = true;
  }

  /** Puts text into the scratchpad (line select with an empty scratchpad copies a field). */
  setScratch(s: string): void {
    this.scratch = s.slice(0, 24);
    this.msg = '';
    this.dirty = true;
  }

  invalidate(): void {
    this.dirty = true;
  }

  key(k: string): void {
    if (!this.powered()) return;
    this.dirty = true;
    if (/^[LR][1-6]$/.test(k) || /^LSK[1-6][LR]$/.test(k)) {
      const id = (k.startsWith('LSK') ? `${k[4]}${k[3]}` : k) as LskId;
      if (this.msg) this.msg = '';
      this.page.lsk?.(this, id, this.sub);
      return;
    }
    switch (k) {
      case 'CLR':
        if (this.msg) this.msg = '';
        else if (this.scratch === 'DELETE') this.scratch = '';
        else this.scratch = this.scratch.slice(0, -1);
        return;
      case 'CLR_HOLD':
        this.msg = '';
        this.scratch = '';
        return;
      case 'DEL':
        if (!this.scratch) this.scratch = 'DELETE';
        return;
      case 'SP':
        this.append(' ');
        return;
      case '+/-':
        if (this.scratch.endsWith('-')) this.scratch = `${this.scratch.slice(0, -1)}+`;
        else if (this.scratch.endsWith('+')) this.scratch = this.scratch.slice(0, -1) + '-';
        else this.append('-');
        return;
      case 'PREV': {
        const n = this.page.pages?.(this) ?? 1;
        this.sub = (this.sub - 1 + n) % n;
        return;
      }
      case 'NEXT': {
        const n = this.page.pages?.(this) ?? 1;
        this.sub = (this.sub + 1) % n;
        return;
      }
      default:
        break;
    }
    const target = this.keyPages[k];
    if (target) {
      this.show(target, 0);
      return;
    }
    if (k.length === 1 && /[A-Z0-9./]/.test(k)) this.append(k);
  }

  private append(ch: string): void {
    if (this.msg) this.msg = '';
    if (this.scratch === 'DELETE') this.scratch = '';
    if (this.scratch.length < 24) this.scratch += ch;
  }

  /** Re-renders the screen when needed (keys, shared changes, live refresh). Returns true when redrawn. */
  update(dt: number): boolean {
    const sh = this.shared;
    // New FMS messages appear in the scratchpad (MSG annunciation).
    if (sh.messages.length !== this.lastMsgCount) {
      if (sh.messages.length > this.lastMsgCount && sh.messages[0]) this.msg = sh.messages[0];
      this.lastMsgCount = sh.messages.length;
      this.dirty = true;
    }
    if (sh.version !== this.lastShared) {
      this.lastShared = sh.version;
      this.dirty = true;
    }
    this.refreshT += dt;
    const r = this.page.refreshS ?? 1;
    if (r > 0 && this.refreshT >= r) {
      this.refreshT = 0;
      this.dirty = true;
    }
    if (!this.dirty) return false;
    this.dirty = false;
    const s = this.screen;
    s.clear();
    const n = this.page.pages?.(this) ?? 1;
    if (this.sub >= n) this.sub = Math.max(0, n - 1);
    this.page.render(this, s, this.sub);
    if (n > 1 && s.pages === 0) {
      s.page = this.sub + 1;
      s.pages = n;
    }
    s.scratch = this.msg || this.scratch;
    s.scratchColor = this.msg ? 'amber' : 'white';
    this.version++;
    this.vars.setString(EPIC_STRINGS.mcduScratch(this.index), s.scratch);
    this.vars.setString(EPIC_STRINGS.mcduTitle(this.index), s.title);
    this.vars.set(EPIC_VARS.mcduMod, sh.modPending ? 1 : 0);
    return true;
  }
}
