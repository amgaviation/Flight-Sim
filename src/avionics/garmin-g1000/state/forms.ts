/**
 * Cursor / field model behind every G1000 window and MFD page that uses the
 * FMS knob (PG 190-02177-02 §1.2 "FMS Knob": push toggles the flashing
 * cursor; with the cursor on, the large knob moves the cursor between fields
 * (and scrolls lists), the small knob enters data in the highlighted field;
 * ENT confirms, CLR cancels / clears). UI-independent and unit tested.
 *
 * Field kinds:
 *  - `select`: option list; the small knob changes a pending choice shown in
 *    place (the Garmin pop-up), ENT (or moving the cursor) commits it.
 *  - `text`: identifier / character entry. The small knob selects the
 *    character at the edit position (A-Z, 0-9 and the field's extra chars),
 *    the large knob moves the edit position; ENT commits (auto-completed
 *    from the database when a `complete` callback is given).
 *  - `number`: small knob steps the value (pending until ENT); `bigStep` on
 *    the large knob while editing.
 *  - `action`: 'Activate?', 'Load?', 'Start?' prompts: ENT runs it.
 *  - `list`: scrolling rows (flight plan legs, nearest airports, alerts):
 *    the large knob moves the highlighted row, ENT / CLR / small knob call
 *    the row handlers.
 */

export type FieldKind = 'select' | 'text' | 'number' | 'action' | 'list';

interface FieldBase {
  id: string;
  /** Disabled fields are skipped by the cursor. */
  enabled?: () => boolean;
}

export interface SelectField extends FieldBase {
  kind: 'select';
  options: () => readonly string[];
  get: () => number;
  set: (i: number) => void;
  /** Wrap around at the ends (default true). */
  wrap?: boolean;
  /** Commit immediately on every small-knob click (no pending state). */
  live?: boolean;
}

export interface TextField extends FieldBase {
  kind: 'text';
  get: () => string;
  /** Commit the entered text; return false to reject (the cursor stays). */
  commit: (v: string) => boolean | void;
  maxLen: number;
  /** Allowed characters (default ' ' excluded: A-Z0-9). */
  charset?: string;
  /** Auto-completion of a prefix ('KJF' -> 'KJFK'); '' = no match. */
  complete?: (prefix: string) => string;
}

export interface NumberField extends FieldBase {
  kind: 'number';
  get: () => number;
  set: (v: number) => void;
  step: number;
  bigStep?: number;
  min: number;
  max: number;
  wrap?: boolean;
  live?: boolean;
}

export interface ActionField extends FieldBase {
  kind: 'action';
  label: () => string;
  run: () => void;
}

export interface ListField extends FieldBase {
  kind: 'list';
  count: () => number;
  /** Rows that can take the cursor (headers are skipped); default all. */
  selectable?: (row: number) => boolean;
  onEnter?: (row: number) => void;
  onClear?: (row: number) => void;
  /** Small knob on a row (e.g. start a waypoint insertion). */
  onInner?: (row: number, clicks: number) => void;
}

export type Field = SelectField | TextField | NumberField | ActionField | ListField;

export const IDENT_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export class Form {
  fields: Field[];
  /** Index of the highlighted field. */
  index = 0;
  /** Highlighted row of a list field. */
  row = 0;
  /** Flashing cursor shown (FMS knob pushed / window opened with the cursor). */
  active = false;
  /** A select / number / text field is being edited (pending value shown). */
  editing = false;
  pendingIndex = 0;
  pendingNumber = 0;
  /** Text being entered, edit position and the auto-completion. */
  text = '';
  textPos = 0;
  completion = '';
  /** Called after a commit / action (pages refresh). */
  onChange: (() => void) | null = null;
  /** First visible row of a list (renderers scroll to keep `row` visible). */
  scroll = 0;

  constructor(fields: Field[] = []) {
    this.fields = fields;
  }

  get field(): Field | undefined {
    return this.fields[this.index];
  }

  setFields(fields: Field[], keepIndex = false): void {
    this.fields = fields;
    if (!keepIndex) {
      this.index = 0;
      this.row = 0;
      this.scroll = 0;
    }
    this.editing = false;
    this.index = Math.min(this.index, Math.max(0, fields.length - 1));
    if (!this.isEnabled(this.index)) this.index = this.nextEnabled(this.index, 1);
    const f = this.field;
    if (f?.kind === 'list') this.row = this.clampRow(f, this.row);
  }

  /** Cursor on (optionally at a field id). */
  activate(fieldId?: string): void {
    this.active = true;
    this.editing = false;
    if (fieldId) {
      const i = this.fields.findIndex((f) => f.id === fieldId);
      if (i >= 0) this.index = i;
    }
    if (!this.isEnabled(this.index)) this.index = this.nextEnabled(this.index, 1);
    const f = this.field;
    if (f?.kind === 'list') this.row = this.clampRow(f, this.row);
  }

  deactivate(): void {
    this.active = false;
    this.editing = false;
  }

  /** FMS knob push: toggles the cursor (cancels a pending edit). */
  push(): void {
    if (this.active) this.deactivate();
    else this.activate();
  }

  private isEnabled(i: number): boolean {
    const f = this.fields[i];
    return !!f && (f.enabled ? f.enabled() : true);
  }

  private nextEnabled(from: number, dir: number): number {
    const n = this.fields.length;
    if (!n) return 0;
    for (let k = 0; k < n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (this.isEnabled(i)) return i;
    }
    return from;
  }

  private clampRow(f: ListField, row: number): number {
    const n = f.count();
    if (n <= 0) return 0;
    let r = Math.max(0, Math.min(n - 1, row));
    if (f.selectable && !f.selectable(r)) {
      for (let k = 1; k < n; k++) {
        if (r + k < n && f.selectable(r + k)) return r + k;
        if (r - k >= 0 && f.selectable(r - k)) return r - k;
      }
    }
    return r;
  }

  /** Large FMS knob. */
  outer(clicks: number): void {
    if (!this.active || !clicks) return;
    const f = this.field;
    if (this.editing && f?.kind === 'text') {
      // Move the character position (entering a longer identifier).
      const pos = Math.max(0, Math.min(f.maxLen - 1, this.textPos + clicks));
      if (pos > this.textPos && this.text.length <= this.textPos) this.text = this.text.padEnd(this.textPos + 1, ' ');
      this.textPos = pos;
      if (clicks < 0) this.text = this.text.slice(0, this.textPos + 1);
      this.updateCompletion(f);
      return;
    }
    if (this.editing && f?.kind === 'number' && f.bigStep) {
      this.pendingNumber = this.stepNumber(f, this.pendingNumber, clicks * f.bigStep);
      return;
    }
    if (this.editing) this.commit();
    const dir = clicks > 0 ? 1 : -1;
    for (let k = 0; k < Math.abs(clicks); k++) this.moveOnce(dir);
  }

  private moveOnce(dir: number): void {
    const f = this.field;
    if (f?.kind === 'list') {
      const n = f.count();
      let r = this.row + dir;
      while (r >= 0 && r < n && f.selectable && !f.selectable(r)) r += dir;
      if (r >= 0 && r < n) {
        this.row = r;
        return;
      }
      if (this.fields.length === 1) return; // stay on the list's end
    }
    const next = this.nextEnabled(this.index + dir, dir);
    this.index = next;
    const g = this.field;
    if (g?.kind === 'list') {
      const n = g.count();
      this.row = this.clampRow(g, dir > 0 ? 0 : n - 1);
    }
  }

  /** Small FMS knob. */
  inner(clicks: number): void {
    if (!this.active || !clicks) return;
    const f = this.field;
    if (!f) return;
    switch (f.kind) {
      case 'select': {
        const opts = f.options();
        if (!opts.length) return;
        if (!this.editing) {
          this.editing = !f.live;
          this.pendingIndex = f.get();
        }
        let i = this.pendingIndex + clicks;
        if (f.wrap ?? true) i = ((i % opts.length) + opts.length) % opts.length;
        else i = Math.max(0, Math.min(opts.length - 1, i));
        this.pendingIndex = i;
        if (f.live) {
          f.set(i);
          this.onChange?.();
        }
        return;
      }
      case 'number': {
        if (!this.editing) {
          this.editing = !f.live;
          this.pendingNumber = f.get();
        }
        this.pendingNumber = this.stepNumber(f, this.pendingNumber, clicks * f.step);
        if (f.live) {
          f.set(this.pendingNumber);
          this.onChange?.();
        }
        return;
      }
      case 'text': {
        const cs = f.charset ?? IDENT_CHARSET;
        if (!this.editing) {
          this.editing = true;
          this.text = f.get().toUpperCase().slice(0, 1);
          this.textPos = 0;
        }
        const cur = this.text[this.textPos] ?? '';
        let ci = cs.indexOf(cur);
        if (ci < 0) ci = clicks > 0 ? -1 : 0;
        ci = (((ci + clicks) % cs.length) + cs.length) % cs.length;
        this.text = (this.text.slice(0, this.textPos) + cs[ci]).slice(0, f.maxLen);
        this.updateCompletion(f);
        return;
      }
      case 'list':
        f.onInner?.(this.row, clicks);
        return;
      case 'action':
        return;
    }
  }

  private stepNumber(f: NumberField, v: number, d: number): number {
    let n = v + d;
    if (f.wrap) {
      const span = f.max - f.min + f.step;
      n = ((((n - f.min) % span) + span) % span) + f.min;
    } else n = Math.max(f.min, Math.min(f.max, n));
    return Math.round(n / f.step) * f.step;
  }

  private updateCompletion(f: TextField): void {
    const t = this.text.trimEnd();
    this.completion = f.complete && t ? f.complete(t) : '';
  }

  /** Current text entry value (completion if one matched). */
  get enteredText(): string {
    const t = this.text.trimEnd();
    return this.completion && this.completion.startsWith(t) ? this.completion : t;
  }

  /** Commits a pending edit. Returns false when rejected. */
  commit(): boolean {
    const f = this.field;
    if (!f || !this.editing) return true;
    this.editing = false;
    let ok = true;
    if (f.kind === 'select') f.set(this.pendingIndex);
    else if (f.kind === 'number') f.set(this.pendingNumber);
    else if (f.kind === 'text') {
      const r = f.commit(this.enteredText);
      ok = r !== false;
      if (!ok) this.editing = true;
    }
    this.onChange?.();
    return ok;
  }

  /** ENT key. Returns true when the form consumed it. */
  ent(): boolean {
    if (!this.active) return false;
    const f = this.field;
    if (!f) return false;
    if (this.editing) {
      if (this.commit()) this.moveOnce(1);
      return true;
    }
    if (f.kind === 'action') {
      f.run();
      this.onChange?.();
      return true;
    }
    if (f.kind === 'list') {
      f.onEnter?.(this.row);
      this.onChange?.();
      return true;
    }
    // ENT on a non-editing field advances the cursor.
    this.moveOnce(1);
    return true;
  }

  /** CLR key. Returns true when the form consumed it. */
  clr(): boolean {
    if (!this.active) return false;
    if (this.editing) {
      this.editing = false;
      return true;
    }
    const f = this.field;
    if (f?.kind === 'list' && f.onClear) {
      f.onClear(this.row);
      this.onChange?.();
      return true;
    }
    this.deactivate();
    return true;
  }

  /** Pending option index or the field value (renderers). */
  displayIndex(f: SelectField): number {
    return this.editing && this.field === f ? this.pendingIndex : f.get();
  }

  displayNumber(f: NumberField): number {
    return this.editing && this.field === f ? this.pendingNumber : f.get();
  }

  isCursor(fieldId: string): boolean {
    return this.active && this.field?.id === fieldId;
  }
}

/** A pop-up list (page menus, 'Load Frequency', confirmations): FMS knob moves, ENT selects, CLR closes. */
export class PopupMenu {
  items: { label: string; enabled: boolean; run: () => void }[] = [];
  index = 0;
  open = false;
  title = '';

  show(title: string, items: { label: string; enabled?: boolean; run: () => void }[], start = 0): void {
    this.title = title;
    this.items = items.map((i) => ({ label: i.label, enabled: i.enabled ?? true, run: i.run }));
    this.index = Math.max(0, Math.min(items.length - 1, start));
    if (this.items.length && !this.items[this.index].enabled) this.move(1);
    this.open = true;
  }

  close(): void {
    this.open = false;
  }

  move(clicks: number): void {
    const n = this.items.length;
    if (!n) return;
    const dir = clicks >= 0 ? 1 : -1;
    for (let k = 0; k < Math.abs(clicks); k++) {
      let i = this.index;
      for (let j = 0; j < n; j++) {
        i = Math.max(0, Math.min(n - 1, i + dir));
        if (this.items[i].enabled) break;
      }
      if (this.items[i].enabled) this.index = i;
    }
  }

  ent(): void {
    const it = this.items[this.index];
    this.open = false;
    if (it?.enabled) it.run();
  }
}
