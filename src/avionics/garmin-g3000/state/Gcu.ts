/**
 * GCU 275 PFD controller (optional G3000 hardware: Citation M2 / CJ3+ fit one
 * under the glareshield per pilot). Created by the aircraft that has the unit
 * (`new GcuController(suite.system)`); aircraft without it are unaffected.
 *
 * Unit (Garmin GCU 275 unit image; Textron S&D15 §10.3.D "used for inset map
 * pan/range, baro setting and flight planning (active flight plan in the PFD
 * inset)"): RANGE knob with joystick (push = pan pointer), CLR and ENT keys,
 * dual FMS knob (push = cursor), Direct-To and COM/NAV keys, FPL and PROC
 * keys, BARO knob (push STD).
 *
 * Behaviour (EST, G1000-family key logic; the GCU 275 pilot's guide is not
 * public):
 *  - FPL: opens / closes the active flight plan window over the PFD inset;
 *    FMS knob (inner or outer) moves the cursor leg by leg, FMS push turns the
 *    cursor on / off, ENT steps the cursor.
 *  - DTO: opens the Direct-To window on the cursor leg (FPL window with the
 *    cursor on) or the active leg; the FMS knob selects another plan waypoint;
 *    ENT activates the direct-to and closes the window.
 *  - PROC: procedures window (Activate Approach / Vectors to Final / Missed
 *    Approach, disabled without a loaded approach); knob selects, ENT runs it.
 *  - CLR: closes the open window.
 *  - COM/NAV: toggles the FMS knob to tune the on-side mic COM standby
 *    frequency (outer MHz, inner kHz), push = swap active / standby; press
 *    COM/NAV again to return to the FMS windows. SCOPE: NAV tuning stays on the
 *    GTC.
 *  - RANGE turn: PFD inset range (existing `rangeTurn`); RANGE push toggles the
 *    inset map pointer; the joystick pans it.
 * The baro knob uses the existing `baroTurn` / `baroPush` events.
 *
 * State is published in `G3K.gcu*` vars; the PFD renderer draws the window.
 */
import type { Subsystem } from '../../../aircraft/types';
import { G3K, G3K_EVENTS, GCU_WINDOW, vn, type GcuKeyName } from '../vars';
import type { G3000System } from './System';

/** PROC window items (index = cursor). */
export const GCU_PROC_ITEMS = ['ACTIVATE APPROACH', 'ACTIVATE VECTORS TO FINAL', 'ACTIVATE MISSED APPROACH'] as const;

const KEYS: readonly GcuKeyName[] = ['CLR', 'ENT', 'DTO', 'FPL', 'PROC', 'COMNAV'];

export class GcuController implements Subsystem {
  readonly name = 'g3k.gcu';
  private readonly offs: (() => void)[] = [];

  constructor(
    readonly sys: G3000System,
    readonly sides: readonly (1 | 2)[] = [1, 2],
  ) {
    const ev = sys.events;
    const v = sys.vars;
    for (const s of sides) {
      v.set(vn(G3K.gcuWindow, s), GCU_WINDOW.none);
      v.set(vn(G3K.gcuCursor, s), -1);
      v.set(vn(G3K.gcuComNav, s), 0);
      v.set(vn(G3K.insetPan, s), 0);
    }
    if (!ev) return;
    const clicks = (p: unknown): number => (typeof p === 'number' ? p : p && typeof p === 'object' ? ((p as { delta?: number }).delta ?? 1) : 1);
    const turn = (name: string, fn: (n: number) => void): void => {
      this.offs.push(ev.on(name, (p) => fn(clicks(p))));
      this.offs.push(ev.on(`${name}_inc`, (p) => fn(Math.abs(clicks(p)))));
      this.offs.push(ev.on(`${name}_dec`, (p) => fn(-Math.abs(clicks(p)))));
    };
    for (const s of sides) {
      for (const k of KEYS) this.offs.push(ev.on(G3K_EVENTS.gcuKey(s, k), () => this.key(s, k)));
      turn(G3K_EVENTS.gcuFmsOuter(s), (n) => this.fms(s, n, true));
      turn(G3K_EVENTS.gcuFmsInner(s), (n) => this.fms(s, n, false));
      this.offs.push(ev.on(G3K_EVENTS.gcuFmsPush(s), () => this.fmsPush(s)));
      this.offs.push(ev.on(G3K_EVENTS.rangePush(s), () => this.rangePush(s)));
      this.offs.push(
        ev.on(G3K_EVENTS.gcuJoystick(s), (p) => {
          const o = (p ?? {}) as { x?: number; y?: number };
          this.joystick(s, o.x ?? 0, o.y ?? 0);
        }),
      );
    }
  }

  // ---------------------------------------------------------------- state helpers

  window(s: number): number {
    return this.sys.vars.get(vn(G3K.gcuWindow, s));
  }
  cursor(s: number): number {
    return this.sys.vars.get(vn(G3K.gcuCursor, s), -1);
  }
  private setWindow(s: number, w: number, cursor: number): void {
    const v = this.sys.vars;
    v.set(vn(G3K.gcuWindow, s), w);
    v.set(vn(G3K.gcuCursor, s), cursor);
    this.sys.revision++;
  }
  /** Power: the controller works with its on-side PFD (EST: GCU powered with the GDU). */
  private up(s: number): boolean {
    return this.sys.unitUp(s === 1 ? 'pfd1' : 'pfd2');
  }
  private legCount(): number {
    return this.sys.fms?.plans.active.legs.length ?? 0;
  }
  private activeLeg(): number {
    return this.sys.fms?.plans.active.activeLegIndex ?? -1;
  }
  procAvailable(): boolean {
    return !!this.sys.fpl?.plan.approachProcedure;
  }

  // ---------------------------------------------------------------- inputs

  key(s: number, k: GcuKeyName): void {
    if (!this.up(s)) return;
    const v = this.sys.vars;
    const w = this.window(s);
    switch (k) {
      case 'FPL':
        this.setWindow(s, w === GCU_WINDOW.fpl ? GCU_WINDOW.none : GCU_WINDOW.fpl, -1);
        break;
      case 'PROC':
        this.setWindow(s, w === GCU_WINDOW.proc ? GCU_WINDOW.none : GCU_WINDOW.proc, 0);
        break;
      case 'DTO': {
        if (w === GCU_WINDOW.dto) {
          this.setWindow(s, GCU_WINDOW.none, -1);
          break;
        }
        const c = this.cursor(s);
        const target = w === GCU_WINDOW.fpl && c >= 0 ? c : this.activeLeg();
        this.setWindow(s, GCU_WINDOW.dto, target);
        break;
      }
      case 'CLR':
        if (w !== GCU_WINDOW.none) this.setWindow(s, GCU_WINDOW.none, -1);
        break;
      case 'ENT':
        this.enter(s);
        break;
      case 'COMNAV':
        v.set(vn(G3K.gcuComNav, s), v.get(vn(G3K.gcuComNav, s)) >= 0.5 ? 0 : 1);
        this.sys.revision++;
        break;
    }
  }

  private enter(s: number): void {
    const w = this.window(s);
    const c = this.cursor(s);
    const fpl = this.sys.fpl;
    if (w === GCU_WINDOW.dto) {
      if (fpl && c >= 0 && c < this.legCount() && fpl.directTo(c)) this.setWindow(s, GCU_WINDOW.none, -1);
    } else if (w === GCU_WINDOW.proc) {
      if (!fpl || !this.procAvailable()) return;
      if (c === 0) fpl.activateApproach();
      else if (c === 1) fpl.activateVtf();
      else fpl.activateMissedApproach();
      this.setWindow(s, GCU_WINDOW.none, -1);
    } else if (w === GCU_WINDOW.fpl && c >= 0) {
      this.sys.vars.set(vn(G3K.gcuCursor, s), Math.min(this.legCount() - 1, c + 1));
    }
  }

  fms(s: number, n: number, outer: boolean): void {
    if (!this.up(s) || n === 0) return;
    const v = this.sys.vars;
    if (v.get(vn(G3K.gcuComNav, s)) >= 0.5) {
      const r = v.get(vn(G3K.micSelect, s), s) >= 1.5 ? 2 : 1;
      this.sys.stepComStandby(r, n, outer ? 'outer' : 'inner');
      return;
    }
    const w = this.window(s);
    const c = this.cursor(s);
    if (w === GCU_WINDOW.proc) {
      v.set(vn(G3K.gcuCursor, s), Math.max(0, Math.min(GCU_PROC_ITEMS.length - 1, c + Math.sign(n))));
    } else if (w === GCU_WINDOW.fpl || w === GCU_WINDOW.dto) {
      const count = this.legCount();
      if (count === 0) return;
      const from = c >= 0 ? c : Math.max(0, this.activeLeg());
      v.set(vn(G3K.gcuCursor, s), Math.max(0, Math.min(count - 1, from + (w === GCU_WINDOW.fpl && c < 0 ? 0 : n))));
    } else if (!outer) {
      // No window: the small knob opens the flight plan window with the cursor on the active leg (EST, G1000 practice).
      this.setWindow(s, GCU_WINDOW.fpl, Math.max(0, this.activeLeg()));
    }
    this.sys.revision++;
  }

  fmsPush(s: number): void {
    if (!this.up(s)) return;
    const v = this.sys.vars;
    if (v.get(vn(G3K.gcuComNav, s)) >= 0.5) {
      this.sys.swapCom(v.get(vn(G3K.micSelect, s), s) >= 1.5 ? 2 : 1);
      return;
    }
    const w = this.window(s);
    if (w === GCU_WINDOW.none) this.setWindow(s, GCU_WINDOW.fpl, Math.max(0, this.activeLeg()));
    else if (w === GCU_WINDOW.fpl) v.set(vn(G3K.gcuCursor, s), this.cursor(s) >= 0 ? -1 : Math.max(0, this.activeLeg()));
  }

  rangePush(s: number): void {
    if (!this.up(s)) return;
    const p = this.sys.insetPointers[s === 2 ? 2 : 1];
    p.active = !p.active;
    p.dx = 0;
    p.dy = 0;
    this.sys.vars.set(vn(G3K.insetPan, s), p.active ? 1 : 0);
  }

  joystick(s: number, x: number, y: number): void {
    if (!this.up(s) || (x === 0 && y === 0)) return;
    const p = this.sys.insetPointers[s === 2 ? 2 : 1];
    if (!p.active) {
      p.active = true;
      p.dx = 0;
      p.dy = 0;
    }
    p.dx += x * 12; // EST px per joystick event
    p.dy -= y * 12;
    this.sys.vars.set(vn(G3K.insetPan, s), 1);
  }

  /** Clamps a stale cursor after plan edits (60 Hz, allocation-free). */
  update(): void {
    const v = this.sys.vars;
    const n = this.legCount();
    for (const s of this.sides) {
      if (!this.up(s) && this.window(s) !== GCU_WINDOW.none) this.setWindow(s, GCU_WINDOW.none, -1);
      const w = this.window(s);
      if ((w === GCU_WINDOW.fpl || w === GCU_WINDOW.dto) && this.cursor(s) >= n) v.set(vn(G3K.gcuCursor, s), n - 1);
      if (w === GCU_WINDOW.dto && n === 0) this.setWindow(s, GCU_WINDOW.none, -1);
    }
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }
}
