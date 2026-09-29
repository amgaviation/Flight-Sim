/**
 * Logic of one GTC (touchscreen controller): control mode (PFD / MFD /
 * NAV/COM), a page stack per mode, the button bar actions (Back, Home, MSG,
 * Full / Half / Split) and the hardware knobs, joystick and mode softkeys.
 *
 * Default knob functions when the page does not use them (G3000 PG
 * 190-02046-01 §1.3 Figure 1-12 "Label Bar"; G5000 GTC 570 label bar):
 *   upper (dual concentric)  MFD: display pane selection;
 *                            PFD / NAV-COM: COM standby tuning (outer MHz,
 *                            inner kHz), push = COM1/COM2, hold = swap.
 *   lower (GTC 580 lower / GTC 570 map knob)
 *                            MFD: selected pane map range, push = map
 *                            pointer (pan) on/off, joystick = pan;
 *                            PFD: on-side PFD inset map range;
 *                            NAV/COM: selected COM volume, push = squelch.
 *   center (GTC 570)         selected COM volume, push = squelch.
 *
 * Events (EventBus, see vars.ts G3K_EVENTS): `g3k.<gtc>.upper_outer` /
 * `upper_inner` / `lower` / `center` with signed clicks (or `_inc` / `_dec`
 * with positive clicks), `upper_push`, `upper_hold`, `lower_push`,
 * `center_push`, `joystick` {x, y}, `mode_pfd` / `mode_mfd` / `mode_navcom`.
 */
import { GTC_MODE, G3K, G3K_EVENTS, type GtcModeName, type PaneContent, PANE_CONTENT } from '../vars';
import type { ResolvedGtc } from '../config';
import type { G3000System } from '../state/System';
import type { GtcPage, KnobId, KnobSlot } from './GtcPage';

export type HomeFactory = (gtc: GtcController, mode: GtcModeName) => GtcPage;

const MODE_BY_CODE: GtcModeName[] = ['PFD', 'MFD', 'NAVCOM'];
const LBL_FREQ = ['COM1 Freq\nPush: 1-2 Hold: Swap', 'COM2 Freq\nPush: 1-2 Hold: Swap'];
const LBL_VOL = ['COM1 Volume\nPush: Squelch', 'COM2 Volume\nPush: Squelch'];
const MAP_CONTENTS: ReadonlySet<PaneContent> = new Set<PaneContent>([PANE_CONTENT.navMap, PANE_CONTENT.traffic, PANE_CONTENT.weather, PANE_CONTENT.taws, PANE_CONTENT.procedure]);

export class GtcController {
  readonly sys: G3000System;
  readonly g: ResolvedGtc;
  /** COM radio the knob tunes (1 / 2). */
  comSel: 1 | 2;
  /** Bumped on every page change / input (display redraw). */
  revision = 0;
  /** Message shown briefly in the title area ('Invalid entry'). */
  toast = '';
  toastS = 0;
  private readonly stacks = new Map<GtcModeName, GtcPage[]>();
  private readonly offs: (() => void)[] = [];
  private readonly home: HomeFactory;
  private readonly modeVar: string;
  /** Factory for the Messages page (set by the display to avoid an import cycle). */
  messagesPage: ((gtc: GtcController) => GtcPage) | null = null;

  constructor(sys: G3000System, g: ResolvedGtc, home: HomeFactory) {
    this.sys = sys;
    this.g = g;
    this.home = home;
    this.comSel = g.side;
    this.modeVar = G3K.gtcMode(g.id);
    for (const m of g.modes) this.stacks.set(m, [home(this, m)]);
    this.listen();
  }

  // ------------------------------------------------------------ mode / stack

  get mode(): GtcModeName {
    const m = MODE_BY_CODE[this.sys.vars.get(this.modeVar) | 0];
    return m && this.g.modes.includes(m) ? m : this.g.modes[0];
  }

  setMode(m: GtcModeName): void {
    if (!this.g.modes.includes(m)) return;
    if (m === this.mode) {
      // Pressing the active mode key returns to its Home screen.
      this.homePage();
      return;
    }
    this.sys.setGtcMode(this.g, m);
    this.revision++;
  }

  private stack(): GtcPage[] {
    const m = this.mode;
    let s = this.stacks.get(m);
    if (!s) this.stacks.set(m, (s = [this.home(this, m)]));
    return s;
  }

  get page(): GtcPage {
    const s = this.stack();
    return s[s.length - 1];
  }

  get depth(): number {
    return this.stack().length - 1;
  }

  push(p: GtcPage): void {
    this.stack().push(p);
    p.onOpen();
    this.revision++;
  }

  /** Replaces the top page (keypad -> result page flows). */
  replace(p: GtcPage): void {
    const s = this.stack();
    if (s.length > 1) s.pop()!.onClose();
    s.push(p);
    p.onOpen();
    this.revision++;
  }

  back(): void {
    const s = this.stack();
    if (s.length > 1) s.pop()!.onClose();
    this.page.onOpen();
    this.revision++;
  }

  homePage(): void {
    const s = this.stack();
    while (s.length > 1) s.pop()!.onClose();
    s[0].onOpen();
    this.revision++;
  }

  /** Pops dialogs until a page of the given class (or home) is on top. */
  popTo(pred: (p: GtcPage) => boolean): void {
    const s = this.stack();
    while (s.length > 1 && !pred(s[s.length - 1])) s.pop()!.onClose();
    this.page.onOpen();
    this.revision++;
  }

  showMessages(): void {
    if (this.messagesPage) this.push(this.messagesPage(this));
  }

  flash(text: string): void {
    this.toast = text;
    this.toastS = 3;
    this.revision++;
  }

  update(dt: number): void {
    if (this.toastS > 0) {
      this.toastS -= dt;
      if (this.toastS <= 0) {
        this.toast = '';
        this.revision++;
      }
    }
    this.page.update(dt);
  }

  // ------------------------------------------------------------ knobs

  knob(k: KnobId, clicks: number): void {
    this.revision++;
    if (this.page.onKnob(k, clicks)) return;
    const sys = this.sys;
    const mode = this.mode;
    const n = Math.round(clicks) || (k.endsWith('Push') || k === 'upperHold' ? 1 : 0);
    const steps = Math.abs(n);
    const dir = Math.sign(n);
    switch (k) {
      case 'upperOuter':
      case 'upperInner':
        if (mode === 'MFD') {
          for (let i = 0; i < steps; i++) sys.cycleGtcPane(this.g, dir);
        } else sys.stepComStandby(this.comSel, n, k === 'upperOuter' ? 'outer' : 'inner');
        return;
      case 'upperPush':
        if (mode !== 'MFD') this.comSel = this.comSel === 1 ? 2 : 1;
        return;
      case 'upperHold':
        if (mode !== 'MFD') sys.swapCom(this.comSel);
        return;
      case 'lower':
        if (mode === 'MFD') {
          const p = sys.gtcPane(this.g);
          if (p) for (let i = 0; i < steps; i++) sys.paneRangeStep(p, dir);
        } else if (mode === 'PFD') {
          for (let i = 0; i < steps; i++) sys.pfdRangeStep(this.g.side, dir);
        } else this.volume(n);
        return;
      case 'lowerPush':
        if (mode === 'MFD') this.togglePointer();
        else if (mode === 'NAVCOM') sys.toggleVar(G3K.squelch(this.comSel));
        return;
      case 'center':
        this.volume(n);
        return;
      case 'centerPush':
        sys.toggleVar(G3K.squelch(this.comSel));
        return;
    }
  }

  private volume(clicks: number): void {
    const v = this.sys.vars;
    const name = G3K.comVolume(this.g.side, this.comSel);
    v.set(name, Math.max(0, Math.min(1, Math.round((v.get(name, 0.8) + clicks * 0.05) * 100) / 100)));
  }

  /** Map pointer on the selected pane (MFD mode). */
  togglePointer(): void {
    const p = this.sys.gtcPane(this.g);
    if (!p || !MAP_CONTENTS.has(this.sys.paneContent(p))) return;
    const ptr = this.sys.pointers[p];
    ptr.active = !ptr.active;
    ptr.dx = 0;
    ptr.dy = 0;
    this.revision++;
  }

  /** Joystick deflection (-1..1 each axis): pans the map pointer of the selected pane. */
  joystick(x: number, y: number): void {
    if (this.mode !== 'MFD') return;
    const p = this.sys.gtcPane(this.g);
    if (!p || !MAP_CONTENTS.has(this.sys.paneContent(p))) return;
    const ptr = this.sys.pointers[p];
    if (!ptr.active) {
      ptr.active = true;
      ptr.dx = 0;
      ptr.dy = 0;
    }
    ptr.dx += x * 20;
    ptr.dy += y * 20;
    this.revision++;
  }

  /** Label bar text per knob slot (page override or the mode default). */
  knobLabel(slot: KnobSlot): string {
    const o = this.page.knobLabel(slot);
    if (o !== null) return o;
    const mode = this.mode;
    const c = this.comSel - 1;
    if (slot === 'upper') return mode === 'MFD' ? 'Pane Select' : LBL_FREQ[c];
    if (slot === 'lower') return mode === 'MFD' ? 'Map Range\nPush: Pan' : mode === 'PFD' ? 'PFD Map Range' : LBL_VOL[c];
    return LBL_VOL[c];
  }

  // ------------------------------------------------------------ events

  private listen(): void {
    const ev = this.sys.events;
    if (!ev) return;
    const id = this.g.id;
    const on = (name: string, fn: (p: unknown) => void): void => {
      this.offs.push(ev.on(name, fn));
    };
    const clicks = (p: unknown): number => {
      if (typeof p === 'number') return p;
      if (p && typeof p === 'object') {
        const o = p as { delta?: number; steps?: number; value?: number };
        return o.delta ?? o.steps ?? o.value ?? 1;
      }
      return 1;
    };
    const turn = (name: string, k: KnobId): void => {
      on(name, (p) => this.knob(k, clicks(p)));
      on(`${name}_inc`, (p) => this.knob(k, Math.abs(clicks(p))));
      on(`${name}_dec`, (p) => this.knob(k, -Math.abs(clicks(p))));
    };
    turn(G3K_EVENTS.gtcUpperOuter(id), 'upperOuter');
    turn(G3K_EVENTS.gtcUpperInner(id), 'upperInner');
    turn(G3K_EVENTS.gtcLower(id), 'lower');
    turn(G3K_EVENTS.gtcCenter(id), 'center');
    on(G3K_EVENTS.gtcUpperPush(id), () => this.knob('upperPush', 1));
    on(G3K_EVENTS.gtcUpperHold(id), () => this.knob('upperHold', 1));
    on(G3K_EVENTS.gtcLowerPush(id), () => this.knob('lowerPush', 1));
    on(G3K_EVENTS.gtcCenterPush(id), () => this.knob('centerPush', 1));
    on(G3K_EVENTS.gtcJoystick(id), (p) => {
      const o = (p ?? {}) as { x?: number; y?: number };
      this.joystick(Math.max(-1, Math.min(1, o.x ?? 0)), Math.max(-1, Math.min(1, o.y ?? 0)));
    });
    for (const m of this.g.modes) on(G3K_EVENTS.gtcModeKey(id, m), () => this.setMode(m));
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }
}

void GTC_MODE;
