/**
 * Display-unit window management for PlaneView II / Symmetry.
 *
 * Model (Gulfstream G550 Operating Manual 2A-31-00 "Electronic Display
 * System", PlaneView; PlaneView II and Symmetry keep the same window
 * architecture — see the G650ER and G600 cockpit photographs):
 *  - Each of the four DUs shows either one full window, or a 2/3 window
 *    plus a column of two 1/6 windows (upper / lower).
 *  - "Full window display is limited to the PFD or the MAP display. The
 *    full-window PFD is confined to DU #1 and/or #4, while full-window MAP
 *    displays are restricted to either DU #2 or #3, but not simultaneously."
 *  - "Selecting full window MAP on DU #2 forces DU #3 to show primary engine
 *    instruments on the upper 1/6 window and CAS on the lower 1/6 window.
 *    Similarly, full window MAP on DU #3 causes DU #2 to display CAS in its
 *    lower section."
 *  - Full MAP reverts to 2/3 on a DU failure, a secondary engine
 *    exceedance, a checklist auto call-up, or full MAP selected on the
 *    adjacent DU.
 *  - "If the secondary engine instruments 1/6 window is not displayed, the
 *    primary engine instrument window will revert to the alternate primary"
 *    (compacted engine format).
 *  - MFD DISPLAY SWITCHING (overhead): "the left switch toggles DU #2
 *    between normal map display or PFD mode, and the right switch controls
 *    DU #3 similarly"; DISPLAY SYSTEM CONTROL: one NORM/OFF switch per DU.
 *  - "The pilot controls information selection for DUs #1, #2, and #3,
 *    while the copilot manages #2, #3, and #4."
 *  - When the PFD is not displayed on its side, the standby display (SMC /
 *    SFD) presents it automatically (G650ER cockpit photograph caption).
 *
 * Reversion rules not in the public sources are marked EST: a CAS window
 * and a primary engine window are forced onto a working DU when none is
 * displayed (certification requires both to be visible at all times).
 */
import type { SimVars } from '../../../core/SimVars';
import { DISPLAY_VARS } from '../../../cockpit/types';
import { DuFormat, EPIC_VARS, Win, allowedInMain, allowedInSixth } from '../vars';

export type WindowSlot = 'main' | 'upper' | 'lower';

/** Default window assignment per DU (G650ER power-up photograph). */
export interface DuDefaults {
  format: DuFormat;
  main: Win;
  upper: Win;
  lower: Win;
}

export const DEFAULT_DU_LAYOUT: readonly DuDefaults[] = [
  // DU1: PFD 2/3, engine + CAS column (outboard).
  { format: DuFormat.Split, main: Win.Pfd, upper: Win.Engine, lower: Win.Cas },
  // DU2: MAP 2/3, primary + secondary engine column (inboard) — G550 OM power-up default.
  { format: DuFormat.Split, main: Win.Map, upper: Win.Engine, lower: Win.Engine2 },
  // DU3: MAP 2/3, CAS + checklist column (inboard).
  { format: DuFormat.Split, main: Win.Map, upper: Win.Cas, lower: Win.Checklist },
  // DU4: PFD 2/3, flight controls + brakes synoptics (outboard).
  { format: DuFormat.Split, main: Win.Pfd, upper: Win.SynFlightControls, lower: Win.SynBrakes },
];

/** Column side of the 1/6 windows per DU: outboard on the PFD DUs, inboard on the MFDs. */
export const COLUMN_ON_LEFT: readonly boolean[] = [true, false, true, false];

/** DUs a side may control (pilot 1..3, copilot 2..4). */
export function sideDus(side: 1 | 2): readonly number[] {
  return side === 1 ? PILOT_DUS : COPILOT_DUS;
}
const PILOT_DUS = [1, 2, 3] as const;
const COPILOT_DUS = [2, 3, 4] as const;
const CENTRE_DUS = [2, 3] as const;
const CAS_ORDER = [3, 2, 1, 4] as const;
const ENGINE_ORDER = [2, 3, 1, 4] as const;

export interface WindowManagerOptions {
  /** Display ids per DU (for DISPLAY_VARS power), e.g. ['epic.du1', ...]. */
  duIds: readonly string[];
  /** Failure var per DU (1 = failed), default `fail.<duId>`. */
  failVars?: readonly string[];
  /** Initial layout (default DEFAULT_DU_LAYOUT). */
  defaults?: readonly DuDefaults[];
  /** Var that is 1 while any secondary engine parameter is exceeded (full MAP reversion). */
  engineExceedVar?: string;
}

/** Output of the reversion logic for one DU. */
export interface DuView {
  operating: boolean;
  format: DuFormat;
  main: Win;
  upper: Win;
  lower: Win;
}

export class WindowManager {
  readonly name = 'epic.windows';
  readonly view: DuView[] = [];
  /** 1 when no secondary engine window is displayed: the primary engine window shows the compacted format. */
  engineCompact = false;
  /** PFD displayed on a DU for side 1 / 2 (else the standby display takes over). */
  readonly pfdShown: [boolean, boolean] = [true, true];
  private readonly vars: SimVars;
  private readonly duIds: readonly string[];
  private readonly failVars: readonly string[];
  private readonly defaults: readonly DuDefaults[];
  private readonly engineExceedVar: string;
  /** Full MAP was forced back to split by an event (reset when the pilot reselects). */
  private readonly fullMapInhibit = [false, false, false, false];
  private checklistCallup = false;

  constructor(vars: SimVars, opts: WindowManagerOptions) {
    this.vars = vars;
    this.duIds = opts.duIds;
    this.failVars = opts.failVars ?? opts.duIds.map((id) => `fail.${id}`);
    this.defaults = opts.defaults ?? DEFAULT_DU_LAYOUT;
    this.engineExceedVar = opts.engineExceedVar ?? 'epic.eng.exceed2';
    for (let i = 0; i < 4; i++) this.view.push({ operating: true, format: DuFormat.Split, main: Win.Blank, upper: Win.Blank, lower: Win.Blank });
    this.initVars(false);
  }

  /** Writes the default layout (force = overwrite existing selections, e.g. at power-up of the whole suite). */
  initVars(force: boolean): void {
    const v = this.vars;
    for (let n = 1; n <= 4; n++) {
      const d = this.defaults[n - 1];
      const init = (name: string, x: number): void => {
        if (force || !v.has(name)) v.set(name, x);
      };
      init(EPIC_VARS.duFormat(n), d.format);
      init(EPIC_VARS.duMain(n), d.main);
      init(EPIC_VARS.duUpper(n), d.upper);
      init(EPIC_VARS.duLower(n), d.lower);
      init(EPIC_VARS.duSwitch(n), 1);
    }
    for (let s = 1; s <= 2; s++) {
      const n = EPIC_VARS.mfdSwitch(s);
      if (force || !v.has(n)) v.set(n, 0);
    }
    this.update(0);
  }

  // ------------------------------------------------------------ selection API

  /**
   * Selects `content` for a window of DU `n` (1..4). Returns false when the
   * content is not allowed there (the selection is ignored, as on the real
   * system where the menu does not offer it).
   */
  select(n: number, slot: WindowSlot | 'full', content: Win): boolean {
    const v = this.vars;
    if (n < 1 || n > 4) return false;
    if (slot === 'full') {
      if (content === Win.Pfd && n !== 1 && n !== 4) return false;
      if (content === Win.Map && n !== 2 && n !== 3) return false;
      if (content !== Win.Pfd && content !== Win.Map) return false;
      if (content === Win.Map) {
        // Full MAP on one centre DU only: the adjacent one reverts to split.
        const other = n === 2 ? 3 : 2;
        if (v.get(EPIC_VARS.duFormat(other)) === DuFormat.Full) v.set(EPIC_VARS.duFormat(other), DuFormat.Split);
      }
      v.set(EPIC_VARS.duMain(n), content);
      v.set(EPIC_VARS.duFormat(n), DuFormat.Full);
      this.fullMapInhibit[n - 1] = false;
      return true;
    }
    if (slot === 'main') {
      if (!allowedInMain(content)) return false;
      if (content === Win.Pfd && n !== 1 && n !== 4) return false;
      v.set(EPIC_VARS.duMain(n), content);
      v.set(EPIC_VARS.duFormat(n), DuFormat.Split);
      return true;
    }
    if (!allowedInSixth(content)) return false;
    v.set(slot === 'upper' ? EPIC_VARS.duUpper(n) : EPIC_VARS.duLower(n), content);
    return true;
  }

  /** Returns the DU to split format (the "2/3" key). */
  split(n: number): void {
    this.vars.set(EPIC_VARS.duFormat(n), DuFormat.Split);
  }

  /** Toggles full / split for the main window of DU n (PFD on 1/4, MAP on 2/3). */
  toggleFull(n: number): boolean {
    const v = this.vars;
    if (v.get(EPIC_VARS.duFormat(n)) === DuFormat.Full) {
      this.split(n);
      return true;
    }
    const main = v.get(EPIC_VARS.duMain(n)) as Win;
    return this.select(n, 'full', main);
  }

  /** A CAS event called up a checklist: full MAP windows revert to split (G550 OM). */
  checklistCalledUp(): void {
    this.checklistCallup = true;
  }

  /** Current selection (not reverted) for DU n. */
  selection(n: number): DuDefaults {
    const v = this.vars;
    return {
      format: v.get(EPIC_VARS.duFormat(n)) as DuFormat,
      main: v.get(EPIC_VARS.duMain(n)) as Win,
      upper: v.get(EPIC_VARS.duUpper(n)) as Win,
      lower: v.get(EPIC_VARS.duLower(n)) as Win,
    };
  }

  /** True when content `w` is displayed on any operating DU (after reversion). */
  isShown(w: Win): boolean {
    for (const d of this.view) {
      if (!d.operating) continue;
      if (d.main === w) return true;
      if (d.format === DuFormat.Split && (d.upper === w || d.lower === w)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ reversion

  update(_dt: number): void {
    const v = this.vars;
    const exceed = v.get(this.engineExceedVar) !== 0;
    for (let n = 1; n <= 4; n++) {
      const d = this.view[n - 1];
      const id = this.duIds[n - 1];
      d.operating = v.get(DISPLAY_VARS.power(id), 1) >= 0.5 && v.get(EPIC_VARS.duSwitch(n), 1) >= 0.5 && v.get(this.failVars[n - 1]) === 0;
      d.format = v.get(EPIC_VARS.duFormat(n)) as DuFormat;
      d.main = v.get(EPIC_VARS.duMain(n)) as Win;
      d.upper = v.get(EPIC_VARS.duUpper(n)) as Win;
      d.lower = v.get(EPIC_VARS.duLower(n)) as Win;
    }
    // Full MAP reversion events.
    for (const n of CENTRE_DUS) {
      const d = this.view[n - 1];
      if (d.format === DuFormat.Full && (exceed || this.checklistCallup || !this.view[(n === 2 ? 3 : 2) - 1].operating)) {
        v.set(EPIC_VARS.duFormat(n), DuFormat.Split);
        d.format = DuFormat.Split;
      }
    }
    this.checklistCallup = false;
    // MFD DISPLAY SWITCHING: DU2 / DU3 show the PFD of their side.
    for (let s = 1; s <= 2; s++) {
      if (v.get(EPIC_VARS.mfdSwitch(s)) >= 0.5) {
        const d = this.view[s === 1 ? 1 : 2];
        d.main = Win.Pfd;
        d.format = DuFormat.Split;
      }
    }
    // Full MAP on a centre DU forces the other centre DU's column.
    const du2 = this.view[1];
    const du3 = this.view[2];
    if (du2.operating && du2.format === DuFormat.Full && du2.main === Win.Map && du3.operating) {
      du3.format = DuFormat.Split;
      du3.upper = Win.Engine;
      du3.lower = Win.Cas;
    } else if (du3.operating && du3.format === DuFormat.Full && du3.main === Win.Map && du2.operating) {
      du2.format = DuFormat.Split;
      du2.lower = Win.Cas;
    }
    // Full window formats only where allowed.
    for (let n = 1; n <= 4; n++) {
      const d = this.view[n - 1];
      if (d.format === DuFormat.Full && !((d.main === Win.Pfd && (n === 1 || n === 4)) || (d.main === Win.Map && (n === 2 || n === 3)))) d.format = DuFormat.Split;
      if (d.main === Win.Pfd && n !== 1 && n !== 4 && v.get(EPIC_VARS.mfdSwitch(n === 2 ? 1 : 2)) < 0.5) d.main = Win.Map;
    }
    // EST: CAS and primary engine must always be displayed somewhere.
    this.force(Win.Cas, 'lower', CAS_ORDER);
    this.force(Win.Engine, 'upper', ENGINE_ORDER);
    this.engineCompact = !this.isShown(Win.Engine2);
    // PFD shown per side.
    this.pfdShown[0] = this.pfdOn(1, 2);
    this.pfdShown[1] = this.pfdOn(4, 3);
    // Publish.
    for (let n = 1; n <= 4; n++) {
      const d = this.view[n - 1];
      v.set(EPIC_VARS.duOperating(n), d.operating ? 1 : 0);
      v.set(EPIC_VARS.duShownMain(n), d.operating ? d.main : Win.Blank);
      v.set(EPIC_VARS.duShownUpper(n), d.operating && d.format === DuFormat.Split ? d.upper : Win.Blank);
      v.set(EPIC_VARS.duShownLower(n), d.operating && d.format === DuFormat.Split ? d.lower : Win.Blank);
    }
    v.set('epic.eng.compact', this.engineCompact ? 1 : 0);
  }

  private pfdOn(outer: number, inner: number): boolean {
    const o = this.view[outer - 1];
    const i = this.view[inner - 1];
    return (o.operating && o.main === Win.Pfd) || (i.operating && i.main === Win.Pfd);
  }

  /** Puts `w` into `slot` of the first operating split DU in `order` when it is not displayed at all. */
  private force(w: Win, slot: 'upper' | 'lower', order: readonly number[]): void {
    if (this.isShown(w)) return;
    for (const n of order) {
      const d = this.view[n - 1];
      if (!d.operating) continue;
      if (d.format === DuFormat.Full) continue;
      if (slot === 'upper') d.upper = w;
      else d.lower = w;
      return;
    }
    // Every operating DU is in full format: revert the first operating centre DU.
    for (const n of order) {
      const d = this.view[n - 1];
      if (!d.operating) continue;
      d.format = DuFormat.Split;
      if (slot === 'upper') d.upper = w;
      else d.lower = w;
      return;
    }
  }
}
