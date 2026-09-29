/**
 * GDU softkey controller (PG 190-02177-02 §1.4 "Softkey Function"): twelve
 * bezel keys under each display. Three kinds of keys: on/off keys with an
 * annunciator bar (green on / grey off), option keys whose label shows the
 * choice, and keys that open a sub-level with a Back key. "Softkeys revert
 * to the previous level after 45 seconds of inactivity"; "when a softkey
 * function is disabled, the softkey label is subdued". The Alerts key keeps
 * position 12 on every PFD level.
 */

export interface SoftkeyDef {
  label: string | (() => string);
  /** Annunciator bar: true green, false grey, undefined none. */
  annun?: () => boolean | undefined;
  /** Subdued (unavailable). */
  disabled?: () => boolean;
  press?: () => void;
  /** Opens a sub-level. */
  menu?: string;
  /** Back key (returns one level). */
  back?: boolean;
  /** Flashing label (Alerts key states). */
  flashing?: () => boolean;
  /** Label drawn inverse (black on white): Alerts with messages still present. */
  inverse?: () => boolean;
  /** Label colour override (Warning red, Caution amber). */
  color?: () => string;
}

export type SoftkeyMenu = (SoftkeyDef | null)[];

/** PG §1.4: softkeys revert after 45 s of inactivity. */
export const SOFTKEY_REVERT_S = 45;

export class SoftkeyController {
  private stack: string[];
  private idle = 0;
  /** Seconds each key stays highlighted after a press (visual feedback). */
  readonly flash = new Float32Array(12);

  constructor(
    public menus: Record<string, SoftkeyMenu>,
    private root = 'top',
  ) {
    this.stack = [root];
  }

  get level(): string {
    return this.stack[this.stack.length - 1];
  }

  get depth(): number {
    return this.stack.length - 1;
  }

  keys(): SoftkeyMenu {
    return this.menus[this.level] ?? this.menus[this.root] ?? [];
  }

  /** Label text of key i ('' = blank). */
  label(i: number): string {
    const k = this.keys()[i];
    if (!k) return '';
    return typeof k.label === 'function' ? k.label() : k.label;
  }

  press(i: number): void {
    const k = this.keys()[i];
    this.idle = 0;
    if (i >= 0 && i < 12) this.flash[i] = 0.15;
    if (!k || k.disabled?.()) return;
    if (k.back) {
      this.back();
      return;
    }
    if (k.menu && this.menus[k.menu]) {
      this.stack.push(k.menu);
      return;
    }
    k.press?.();
  }

  back(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  /** Jumps to a level (pushing it above the root), e.g. XPDR code entry finished -> XPDR level. */
  goTo(level: string): void {
    if (!this.menus[level]) return;
    const i = this.stack.indexOf(level);
    if (i >= 0) this.stack.length = i + 1;
    else this.stack.push(level);
    this.idle = 0;
  }

  /** New root (MFD page change: every page has its own softkeys). */
  setRoot(root: string): void {
    if (this.root === root && this.stack[0] === root) return;
    this.root = root;
    this.stack = [root];
    this.idle = 0;
  }

  reset(): void {
    this.stack = [this.root];
    this.idle = 0;
  }

  update(dt: number): void {
    for (let i = 0; i < 12; i++) if (this.flash[i] > 0) this.flash[i] -= dt;
    if (this.stack.length > 1) {
      this.idle += dt;
      if (this.idle >= SOFTKEY_REVERT_S) {
        this.stack.pop();
        this.idle = 0;
      }
    } else this.idle = 0;
  }
}

/** Twelve-slot menu from a sparse list. */
export function fill12(keys: (SoftkeyDef | null | undefined)[]): SoftkeyMenu {
  const out: SoftkeyMenu = [];
  for (let i = 0; i < 12; i++) out.push(keys[i] ?? null);
  return out;
}
