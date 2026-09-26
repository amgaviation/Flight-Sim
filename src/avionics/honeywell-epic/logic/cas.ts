/**
 * Gulfstream crew alerting system (CAS) presentation logic.
 *
 * The aircraft's `CasManager` (systems/warning) owns message logic, master
 * lights and aurals; it feeds this suite's `CasModel` (add it as a sink:
 * `casManager.addSink(suite.cas.model)`). This file adds the Gulfstream
 * window behaviour (G550 Operating Manual 2A-31-00 "CAS Display Scroll
 * Switches"):
 *  - "Red Warning messages cannot be moved on the display."
 *  - "Caution messages must be acknowledged; advisory messages must be in
 *    steady mode to be scrollable."
 *  - "When messages are scrolled away, a status bar shows the number of
 *    messages hidden from view with an arrow corresponding to direction."
 *  - "New caution messages recall all previously scrolled messages; new
 *    advisory messages recall only scrolled advisory messages."
 * Message text is mixed case, e.g. "Yaw Damper Off" (code450 checklists),
 * "AOA Limiting" (blue, FAA FSB GVI Rev 11), "Steer by Wire Fail" (amber).
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { CasModel, type CasLevel, type CasMessage } from '../../common/draw/CasWindow';
import { EPIC_EVENTS, EPIC_VARS } from '../vars';

export class GulfstreamCas {
  readonly name = 'epic.cas';
  /** Model to register as a `CasManager` sink. Advisories need no acknowledgement. */
  readonly model = new CasModel(['warning', 'caution']);
  /** Number of scrollable (non-warning) messages scrolled off the top. */
  private scrolled = 0;
  private lastCautionSeq = 0;
  private lastAdvisorySeq = 0;
  private readonly vars: SimVars;
  private readonly offs: (() => void)[] = [];
  /** Visible rows of the smallest CAS window (for the hidden-count bar). */
  visibleRows = 11;

  constructor(vars: SimVars, events: EventBus | null) {
    this.vars = vars;
    if (events) {
      this.offs.push(
        events.on(EPIC_EVENTS.casScroll, (p) => this.scroll(Number(p ?? 0))),
        events.on(EPIC_EVENTS.casScrollUp, () => this.scroll(1)),
        events.on(EPIC_EVENTS.casScrollDown, () => this.scroll(-1)),
      );
    }
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  /** Scroll switch: +1 = up (reveal older messages below? no: moves the list up), -1 = down. */
  scroll(dir: number): void {
    if (dir === 0) return;
    const list = this.model.list;
    // Only acknowledged cautions and advisories can be scrolled.
    let movable = 0;
    for (const m of list) if (m.level !== 'warning' && m.acknowledged) movable++;
    this.scrolled = Math.max(0, Math.min(movable, this.scrolled + (dir > 0 ? 1 : -1)));
  }

  /** Messages to draw, in order, after scrolling (warnings pinned first). Fills `out`, returns count. */
  visible(out: CasMessage[], rows: number): number {
    const list = this.model.list;
    let n = 0;
    for (const m of list) if (m.level === 'warning' && n < rows) out[n++] = m;
    let skip = this.scrolled;
    for (const m of list) {
      if (m.level === 'warning') continue;
      if (skip > 0 && m.acknowledged) {
        skip--;
        continue;
      }
      if (n < rows) out[n++] = m;
    }
    return n;
  }

  /** Hidden message counts (above = scrolled off, below = beyond the window). */
  hidden(rows: number): { above: number; below: number } {
    const total = this.model.list.length;
    const above = Math.min(this.scrolled, total);
    const below = Math.max(0, total - above - rows);
    this.hiddenOut.above = above;
    this.hiddenOut.below = below;
    return this.hiddenOut;
  }
  private readonly hiddenOut = { above: 0, below: 0 };

  update(_dt: number): void {
    // Recall rules: a new caution recalls all; a new advisory recalls scrolled advisories (all we track).
    let maxC = 0;
    let maxA = 0;
    for (const m of this.model.list) {
      if (m.level === 'caution' && m.seq > maxC) maxC = m.seq;
      if (m.level === 'advisory' && m.seq > maxA) maxA = m.seq;
    }
    if (maxC > this.lastCautionSeq || maxA > this.lastAdvisorySeq) this.scrolled = 0;
    this.lastCautionSeq = Math.max(this.lastCautionSeq, maxC);
    this.lastAdvisorySeq = Math.max(this.lastAdvisorySeq, maxA);
    const h = this.hidden(this.visibleRows);
    this.vars.set(EPIC_VARS.casHiddenAbove, h.above);
    this.vars.set(EPIC_VARS.casHiddenBelow, h.below);
  }
}

/** A Gulfstream CAS message definition for `CasManager.define` (add your own `when`). */
export interface GulfstreamCasText {
  id: string;
  text: string;
  level: CasLevel;
}

/**
 * Message texts seen in public Gulfstream sources (spelling and colour as
 * published). Aircraft modules add the `when` bindings for their systems.
 *  - FAA FSB GVI (G650) Rev 11 §9.2.1.12, §9.2.2.7, App. 7: "Steer by Wire
 *    Fail" (amber), "AOA Limiting" (blue), "Pedal Steering Off" (advisory),
 *    "Pedal Steering Fail" (caution), "Landing Gear Maint Reqd" (caution).
 *  - code450 "Before Starting Engines Checklist": "Yaw Damper Off" (amber),
 *    "Elevator Trim Up Limit" / "Elevator Trim Down Limit", "Aux Hydraulic
 *    On", "Aft Baggage Smoke".
 *  - G650ER cockpit photograph (CAS window, power-up): "FCC Alternate Mode",
 *    "Stall Protection Unavail", "External Baggage Door" (amber); "Ground
 *    Spoiler Unarm", "Isolation Valve Open", "IRS 1-2-3 Aligning",
 *    "Main Door", "Parking Brake On", "Check CMC" (blue).
 */
export const GULFSTREAM_CAS_TEXTS: readonly GulfstreamCasText[] = [
  { id: 'steer_by_wire_fail', text: 'Steer by Wire Fail', level: 'caution' },
  { id: 'aoa_limiting', text: 'AOA Limiting', level: 'advisory' },
  { id: 'pedal_steering_off', text: 'Pedal Steering Off', level: 'advisory' },
  { id: 'pedal_steering_fail', text: 'Pedal Steering Fail', level: 'caution' },
  { id: 'gear_maint_reqd', text: 'Landing Gear Maint Reqd', level: 'caution' },
  { id: 'yaw_damper_off', text: 'Yaw Damper Off', level: 'caution' },
  { id: 'elev_trim_up_limit', text: 'Elevator Trim Up Limit', level: 'advisory' },
  { id: 'elev_trim_dn_limit', text: 'Elevator Trim Down Limit', level: 'advisory' },
  { id: 'aux_hyd_on', text: 'Aux Hydraulic On', level: 'advisory' },
  { id: 'aft_baggage_smoke', text: 'Aft Baggage Smoke', level: 'warning' },
  { id: 'fcc_alternate', text: 'FCC Alternate Mode', level: 'caution' },
  { id: 'stall_prot_unavail', text: 'Stall Protection Unavail', level: 'caution' },
  { id: 'ext_baggage_door', text: 'External Baggage Door', level: 'caution' },
  { id: 'gnd_spoiler_unarm', text: 'Ground Spoiler Unarm', level: 'advisory' },
  { id: 'isolation_valve_open', text: 'Isolation Valve Open', level: 'advisory' },
  { id: 'irs_aligning', text: 'IRS 1-2-3 Aligning', level: 'advisory' },
  { id: 'main_door', text: 'Main Door', level: 'advisory' },
  { id: 'parking_brake_on', text: 'Parking Brake On', level: 'advisory' },
  { id: 'check_cmc', text: 'Check CMC', level: 'advisory' },
];
