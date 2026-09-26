/**
 * Crew alerting (CAS / EICAS message list): model + renderer.
 *
 * Levels and colours (14 CFR 25.1322): warning red, caution amber/yellow,
 * advisory (Garmin white, Honeywell/Collins/Boeing cyan), status white.
 * Behaviour per G1000 PG 190-00494-04 §3.2 "CAS Messages and
 * Prioritization": messages grouped by criticality (warning, caution,
 * advisory) and sorted by order of appearance, most recent on top; a new
 * warning/caution flashes until MASTER WARNING / MASTER CAUTION is pressed
 * (acknowledges all flashing messages of that level); messages present at
 * power-up are already acknowledged (call `acknowledgeAll()`); warnings
 * cannot be scrolled and stay at the top; the scroll indicator takes the
 * colour of the hidden messages.
 *
 * `unackedWarnings` / `unackedCautions` let the aircraft drive
 * `alert.master_warning` / `alert.master_caution`.
 *
 * Usage (allocation-free per frame):
 *   const cas = new CasModel();
 *   cas.define('batt_off', 'BATT OFF', 'caution');     // once
 *   cas.setActive('batt_off', vars.get('ac.elec.batt_sw') === 0); // each update
 *   const view = new CasWindow({ x, y, w, h, model: cas, style: CAS_GARMIN });
 */
import { blinkOn } from '../dynamics';
import { GARMIN_TYPEFACE, BOEING_TYPEFACE, HONEYWELL_TYPEFACE, type Typeface } from '../fonts';
import { BOEING_PALETTE, GARMIN_PALETTE, HONEYWELL_PALETTE, type AvionicsPalette } from '../palette';
import { box, triangle, type Ctx2D } from './context';

export type CasLevel = 'warning' | 'caution' | 'advisory' | 'status';

const LEVEL_RANK: Record<CasLevel, number> = { warning: 0, caution: 1, advisory: 2, status: 3 };

export interface CasMessage {
  readonly id: string;
  text: string;
  level: CasLevel;
  active: boolean;
  acknowledged: boolean;
  /** Activation sequence number (larger = newer). */
  seq: number;
}

export class CasModel {
  /** Levels whose new messages need acknowledgement (flash until acked). */
  ackLevels: ReadonlySet<CasLevel>;
  private readonly byId = new Map<string, CasMessage>();
  private readonly all: CasMessage[] = [];
  private readonly activeList: CasMessage[] = [];
  private dirty = true;
  private seq = 0;
  /** First visible row (scroll offset). */
  scroll = 0;

  constructor(ackLevels: readonly CasLevel[] = ['warning', 'caution']) {
    this.ackLevels = new Set(ackLevels);
  }

  /** Declares a message (inactive). Re-defining updates text/level. */
  define(id: string, text: string, level: CasLevel): CasMessage {
    let m = this.byId.get(id);
    if (!m) {
      m = { id, text, level, active: false, acknowledged: true, seq: 0 };
      this.byId.set(id, m);
      this.all.push(m);
    } else {
      m.text = text;
      m.level = level;
    }
    this.dirty = true;
    return m;
  }

  /** Activates/deactivates a defined message; activation makes it new (unacknowledged). */
  setActive(id: string, on: boolean): void {
    const m = this.byId.get(id);
    if (!m || m.active === on) return;
    m.active = on;
    if (on) {
      m.seq = ++this.seq;
      m.acknowledged = !this.ackLevels.has(m.level);
    }
    this.dirty = true;
  }

  /** Convenience: define-if-needed and set. */
  set(id: string, text: string, level: CasLevel, on: boolean): void {
    if (!this.byId.has(id)) this.define(id, text, level);
    this.setActive(id, on);
  }

  isActive(id: string): boolean {
    return this.byId.get(id)?.active ?? false;
  }

  /** Acknowledges new messages of `level` (or all levels). */
  acknowledge(level?: CasLevel): void {
    for (const m of this.all) if (m.active && (!level || m.level === level)) m.acknowledged = true;
  }

  /** Marks everything acknowledged (power-up: existing messages do not flash). */
  acknowledgeAll(): void {
    this.acknowledge();
  }

  /** Active messages in display order (cached; rebuilt only when something changed). */
  get list(): readonly CasMessage[] {
    if (this.dirty) {
      this.activeList.length = 0;
      for (const m of this.all) if (m.active) this.activeList.push(m);
      this.activeList.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.seq - a.seq);
      this.dirty = false;
    }
    return this.activeList;
  }

  get unackedWarnings(): number {
    return this.countUnacked('warning');
  }

  get unackedCautions(): number {
    return this.countUnacked('caution');
  }

  /** Highest active level (or null). */
  get highestLevel(): CasLevel | null {
    const l = this.list;
    return l.length > 0 ? l[0].level : null;
  }

  scrollBy(rows: number, visibleRows: number): void {
    const max = Math.max(0, this.list.length - visibleRows);
    this.scroll = Math.max(0, Math.min(max, this.scroll + rows));
  }

  private countUnacked(level: CasLevel): number {
    let n = 0;
    for (const m of this.all) if (m.active && m.level === level && !m.acknowledged) n++;
    return n;
  }
}

export interface CasStyle {
  palette: AvionicsPalette;
  typeface: Typeface;
  fontSize: number;
  lineHeight: number;
  background: string;
  border: string;
  /** Unacknowledged messages flash in inverse video. */
  inverseFlash: boolean;
  /** Text alignment within the window. */
  align: 'left' | 'center';
}

export const CAS_GARMIN: CasStyle = {
  palette: GARMIN_PALETTE,
  typeface: GARMIN_TYPEFACE,
  fontSize: 18,
  lineHeight: 22,
  background: '#000000',
  border: '#9aa0a6',
  inverseFlash: true,
  align: 'left',
};

export const CAS_HONEYWELL: CasStyle = { ...CAS_GARMIN, palette: HONEYWELL_PALETTE, typeface: HONEYWELL_TYPEFACE, border: '' };

export const CAS_BOEING: CasStyle = { ...CAS_GARMIN, palette: BOEING_PALETTE, typeface: BOEING_TYPEFACE, border: '' };

export interface CasWindowOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  model: CasModel;
  style: CasStyle;
}

export class CasWindow {
  x: number;
  y: number;
  w: number;
  h: number;
  model: CasModel;
  style: CasStyle;
  private time = 0;

  constructor(opts: CasWindowOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.w = opts.w;
    this.h = opts.h;
    this.model = opts.model;
    this.style = opts.style;
  }

  get visibleRows(): number {
    return Math.max(1, Math.floor((this.h - 4) / this.style.lineHeight));
  }

  /** True while any unacknowledged message flashes (display must keep redrawing). */
  get animating(): boolean {
    return this.model.unackedWarnings + this.model.unackedCautions > 0;
  }

  update(dt: number): void {
    this.time += dt;
  }

  levelColor(level: CasLevel): string {
    const p = this.style.palette;
    return level === 'warning' ? p.warning : level === 'caution' ? p.caution : level === 'advisory' ? p.advisory : p.status;
  }

  draw(ctx: Ctx2D): void {
    const st = this.style;
    const list = this.model.list;
    box(ctx, this.x, this.y, this.w, this.h, st.background, st.border, 1);
    const rows = this.visibleRows;
    // Warnings are pinned at the top; the remaining rows scroll.
    let pinned = 0;
    while (pinned < list.length && list[pinned].level === 'warning' && pinned < rows) pinned++;
    const free = rows - pinned;
    const rest = list.length - pinned;
    const scroll = Math.max(0, Math.min(this.model.scroll, rest - free));
    const blink = blinkOn(this.time);
    for (let r = 0; r < pinned; r++) this.row(ctx, list[r], r, blink);
    for (let r = 0; r < free; r++) {
      const m = list[pinned + scroll + r];
      if (!m) break;
      this.row(ctx, m, pinned + r, blink);
    }
    // More messages below / above (indicator in the colour of the hidden messages).
    const below = rest - scroll - free;
    const ax = this.x + this.w - 14;
    if (below > 0) {
      const ay = this.y + this.h - 12;
      triangle(ctx, ax - 6, ay - 4, ax + 6, ay - 4, ax, ay + 5, this.levelColor(list[pinned + scroll + free].level));
    }
    if (scroll > 0) {
      const ay = this.y + pinned * st.lineHeight + 10;
      triangle(ctx, ax - 6, ay + 4, ax + 6, ay + 4, ax, ay - 5, this.levelColor(list[pinned + scroll - 1].level));
    }
  }

  private row(ctx: Ctx2D, m: CasMessage, r: number, blink: boolean): void {
    const st = this.style;
    const color = this.levelColor(m.level);
    const y = this.y + 2 + r * st.lineHeight;
    const inverse = st.inverseFlash && !m.acknowledged && blink;
    const tx = st.align === 'center' ? this.x + this.w / 2 : this.x + 8;
    if (inverse) {
      const tw = st.typeface.width(ctx, m.text, st.fontSize);
      const bx = st.align === 'center' ? tx - tw / 2 - 3 : tx - 3;
      box(ctx, bx, y + 1, tw + 6, st.lineHeight - 2, color, '');
    }
    st.typeface.draw(ctx, m.text, tx, y + st.lineHeight / 2 + 1, st.fontSize, inverse ? st.palette.black : color, st.align, 'middle');
  }
}
