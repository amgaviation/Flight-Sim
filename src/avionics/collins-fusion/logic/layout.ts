/**
 * Window layout of the four Adaptive Flight Displays (AFD 1-4, T-shape).
 *
 * Model (sources and estimates):
 *  - Each AFD shows one full window or is split into two halves; a half may
 *    be split again into upper / lower quarters. AIN "Flying the Vision
 *    Flight Deck in Bombardier's Global 6000" (2012): "Each display can be
 *    split, so the copilot's PFD, for example, could show the ADI on the
 *    right ... and an approach chart on the left"; "full landscape PFDs,
 *    with navigation on the center display and system synoptics on the
 *    lower center display"; "the approach plate on the right side of the
 *    center MFD; the left side showed engine gauges and system synoptics".
 *    Quarter windows: EST (Pro Line Fusion multifunction window sizes).
 *  - The PFD is shown on the outboard AFDs, full or in the outboard half.
 *  - EICAS is always displayed (EST, reversion principle of AC 25-11B
 *    5.12): normally the left half of the upper centre AFD; it moves to
 *    the lower centre AFD when AFD 2 is lost, then to an outboard AFD
 *    (composite with the PFD).
 *  - PFD reversion: an outboard AFD failure moves that side's PFD into the
 *    on-side half of the upper centre AFD (EST). RSP DSPL REV forces the
 *    PFD + EICAS composite on the on-side outboard AFD (EST).
 *  - Nine memory selections per pilot (FSB BD-700-1A10 Rev 7 appendix 6:
 *    "DU presentation, nine (9) memory selections"; AIN: memory keys store
 *    layouts "quickly recalled").
 */
import type { SimVars } from '../../../core/SimVars';
import { FUSION_VARS, SLOTS, Win, type Slot } from '../vars';

export const AFD_W = 1024;
export const AFD_H = 640;

export interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SLOT_RECTS: Readonly<Record<Slot, WinRect>> = {
  F: { x: 0, y: 0, w: AFD_W, h: AFD_H },
  L: { x: 0, y: 0, w: AFD_W / 2, h: AFD_H },
  R: { x: AFD_W / 2, y: 0, w: AFD_W / 2, h: AFD_H },
  LU: { x: 0, y: 0, w: AFD_W / 2, h: AFD_H / 2 },
  LL: { x: 0, y: AFD_H / 2, w: AFD_W / 2, h: AFD_H / 2 },
  RU: { x: AFD_W / 2, y: 0, w: AFD_W / 2, h: AFD_H / 2 },
  RL: { x: AFD_W / 2, y: AFD_H / 2, w: AFD_W / 2, h: AFD_H / 2 },
};

export type SlotSize = 'full' | 'half' | 'quarter';
export function slotSize(slot: Slot): SlotSize {
  return slot === 'F' ? 'full' : slot.length === 1 ? 'half' : 'quarter';
}

/** Selected (pilot-chosen) layout of one AFD. */
export interface AfdSelection {
  full: boolean;
  f: Win;
  l: Win;
  r: Win;
  splitL: boolean;
  splitR: boolean;
  lu: Win;
  ll: Win;
  ru: Win;
  rl: Win;
}

export interface ShownWindow {
  slot: Slot;
  win: Win;
  rect: WinRect;
  /** Side that owns the window (FMS scratchpad, SYS page): 1 pilot, 2 copilot. */
  owner: 1 | 2;
  /** For PFD windows: whose PFD (1 / 2). */
  pfdSide: 1 | 2;
}

export interface ShownLayout {
  operating: boolean;
  reversion: boolean;
  windows: ShownWindow[];
}

/** Where each window content may go (EST rules, see file header). */
export function allowedIn(n: number, slot: Slot, win: Win): boolean {
  const size = slotSize(slot);
  const outboard = n === 1 || n === 4;
  const outHalf: Slot = n === 1 ? 'L' : 'R';
  switch (win) {
    case Win.Blank:
      return !outboard || slot !== outHalf; // the outboard half of a PFD display always shows the PFD when split
    case Win.Pfd:
      return outboard && (slot === 'F' || slot === outHalf);
    case Win.Eicas:
      return size === 'half' && (!outboard || slot !== outHalf);
    case Win.Sys:
    case Win.Fms:
      return size === 'half' && (!outboard || slot !== outHalf);
    case Win.Map:
    case Win.Chkl:
    case Win.Vsd:
    case Win.Chart:
    case Win.Evs:
      if (size === 'full') return !outboard; // full-screen MFW formats only on the centre displays
      return !outboard || !slot.startsWith(outHalf);
  }
  return false;
}

/** Contents offered in the window menu for a slot (in menu order). */
export const MENU_CONTENTS: readonly Win[] = [Win.Map, Win.Fms, Win.Sys, Win.Chkl, Win.Vsd, Win.Chart, Win.Evs, Win.Eicas, Win.Pfd];

function cloneSel(s: AfdSelection): AfdSelection {
  return { ...s };
}

/** Default layout (EST: typical Global Vision configuration, see file header). */
export function defaultLayout(): AfdSelection[] {
  const base = (): AfdSelection => ({ full: false, f: Win.Blank, l: Win.Blank, r: Win.Blank, splitL: false, splitR: false, lu: Win.Map, ll: Win.Vsd, ru: Win.Map, rl: Win.Vsd });
  const a1 = base();
  a1.l = Win.Pfd;
  a1.r = Win.Map;
  const a2 = base();
  a2.l = Win.Eicas;
  a2.r = Win.Sys;
  // AFD 3 (lower centre): FMS window on the pilot's half beside a map (photo EB190582 e_ped_mid shows AFD 3
  // dominated by a chart/map; the FMS text windows are brought up over it as needed). Both-halves-FMS left the
  // display nearly black; either side's FMS window is still one MKP FMS key away (showWindow).
  const a3 = base();
  a3.l = Win.Fms;
  a3.r = Win.Map;
  const a4 = base();
  a4.l = Win.Map;
  a4.r = Win.Pfd;
  return [a1, a2, a3, a4];
}

/** Memory presets 1-3 (EST); 4-9 start as copies of the default. */
function defaultMemories(): AfdSelection[][] {
  const m1 = defaultLayout();
  // Memory 2: "Primus-like" layout from the AIN report: full PFDs, navigation on the upper centre
  // display, synoptics on the lower centre display.
  const m2 = defaultLayout();
  m2[0].full = true;
  m2[0].f = Win.Pfd;
  m2[3].full = true;
  m2[3].f = Win.Pfd;
  m2[1].l = Win.Eicas;
  m2[1].r = Win.Map;
  m2[2].l = Win.Sys;
  m2[2].r = Win.Fms;
  // Memory 3: approach: chart next to each PFD, map / VSD on the upper centre.
  const m3 = defaultLayout();
  m3[0].r = Win.Chart;
  m3[3].l = Win.Chart;
  m3[1].r = Win.Map;
  const out = [m1, m2, m3];
  while (out.length < 9) out.push(defaultLayout());
  return out;
}

export class LayoutManager {
  /** Selected layouts (mirrored in the `fusion.afd{n}.*` vars). */
  readonly sel: AfdSelection[] = defaultLayout();
  /** Shown layouts after reversion (recomputed by `update`). */
  readonly shown: ShownLayout[] = [];
  /** Memory selections [side][slot 0..8][afd 0..3]. */
  readonly memories: AfdSelection[][][] = [defaultMemories(), defaultMemories()];
  private readonly opVars: string[];
  private readonly revVars: string[];

  /**
   * @param operating returns true when AFD n (1..4) is powered and not failed.
   * @param rspDspl returns the RSP DSPL position of side s (0 NORM, 1 REV).
   */
  constructor(
    private readonly vars: SimVars,
    private readonly operating: (n: number) => boolean = (n) => vars.get(FUSION_VARS.afdFail(n)) < 0.5,
    private readonly rspDspl: (s: 1 | 2) => number = (s) => vars.get(FUSION_VARS.rspDspl(s)),
  ) {
    this.opVars = [1, 2, 3, 4].map((n) => FUSION_VARS.afdOperating(n));
    this.revVars = [1, 2, 3, 4].map((n) => FUSION_VARS.afdReversion(n));
    for (let i = 0; i < 4; i++) this.shown.push({ operating: true, reversion: false, windows: [] });
    this.writeVars();
    this.update();
  }

  // ------------------------------------------------------------ selection

  /** Resets the selected layout to the default (initial states). */
  reset(): void {
    const d = defaultLayout();
    for (let i = 0; i < 4; i++) this.sel[i] = d[i];
    this.writeVars();
    this.update();
  }

  /** Reads the selected layout back from the vars (external writes, state restore). */
  readVars(): void {
    const v = this.vars;
    for (let n = 1; n <= 4; n++) {
      const s = this.sel[n - 1];
      if (!v.has(FUSION_VARS.afdFull(n))) continue;
      s.full = v.get(FUSION_VARS.afdFull(n)) >= 0.5;
      s.f = v.get(FUSION_VARS.afdWin(n, 'F')) as Win;
      s.l = v.get(FUSION_VARS.afdWin(n, 'L')) as Win;
      s.r = v.get(FUSION_VARS.afdWin(n, 'R')) as Win;
      s.splitL = v.get(FUSION_VARS.afdHalfSplit(n, 'L')) >= 0.5;
      s.splitR = v.get(FUSION_VARS.afdHalfSplit(n, 'R')) >= 0.5;
      s.lu = v.get(FUSION_VARS.afdWin(n, 'LU')) as Win;
      s.ll = v.get(FUSION_VARS.afdWin(n, 'LL')) as Win;
      s.ru = v.get(FUSION_VARS.afdWin(n, 'RU')) as Win;
      s.rl = v.get(FUSION_VARS.afdWin(n, 'RL')) as Win;
    }
  }

  private writeVars(): void {
    const v = this.vars;
    for (let n = 1; n <= 4; n++) {
      const s = this.sel[n - 1];
      v.set(FUSION_VARS.afdFull(n), s.full ? 1 : 0);
      v.set(FUSION_VARS.afdWin(n, 'F'), s.f);
      v.set(FUSION_VARS.afdWin(n, 'L'), s.l);
      v.set(FUSION_VARS.afdWin(n, 'R'), s.r);
      v.set(FUSION_VARS.afdHalfSplit(n, 'L'), s.splitL ? 1 : 0);
      v.set(FUSION_VARS.afdHalfSplit(n, 'R'), s.splitR ? 1 : 0);
      v.set(FUSION_VARS.afdWin(n, 'LU'), s.lu);
      v.set(FUSION_VARS.afdWin(n, 'LL'), s.ll);
      v.set(FUSION_VARS.afdWin(n, 'RU'), s.ru);
      v.set(FUSION_VARS.afdWin(n, 'RL'), s.rl);
    }
  }

  private getSel(s: AfdSelection, slot: Slot): Win {
    switch (slot) {
      case 'F':
        return s.f;
      case 'L':
        return s.l;
      case 'R':
        return s.r;
      case 'LU':
        return s.lu;
      case 'LL':
        return s.ll;
      case 'RU':
        return s.ru;
      case 'RL':
        return s.rl;
    }
  }

  private setSel(s: AfdSelection, slot: Slot, w: Win): void {
    switch (slot) {
      case 'F':
        s.f = w;
        break;
      case 'L':
        s.l = w;
        break;
      case 'R':
        s.r = w;
        break;
      case 'LU':
        s.lu = w;
        break;
      case 'LL':
        s.ll = w;
        break;
      case 'RU':
        s.ru = w;
        break;
      case 'RL':
        s.rl = w;
        break;
    }
  }

  /** Content currently selected in a slot of AFD n. */
  selected(n: number, slot: Slot): Win {
    return this.getSel(this.sel[n - 1], slot);
  }

  /**
   * Selects `win` into `slot` of AFD `n` (window menu ENTER). Returns false
   * when the combination is not allowed. EICAS is unique: selecting it
   * elsewhere swaps it with the window that held it.
   */
  select(n: number, slot: Slot, win: Win): boolean {
    if (n < 1 || n > 4 || !allowedIn(n, slot, win)) return false;
    const s = this.sel[n - 1];
    if (win === Win.Eicas) {
      // Swap with the current EICAS window (the old place receives this window's content).
      const prev = this.getSel(s, slot);
      for (let k = 1; k <= 4; k++) {
        const o = this.sel[k - 1];
        for (const sl of SLOTS) {
          if ((k !== n || sl !== slot) && this.getSel(o, sl) === Win.Eicas) this.setSel(o, sl, allowedIn(k, sl, prev) && prev !== Win.Eicas ? prev : Win.Map);
        }
      }
    } else if (this.getSel(s, slot) === Win.Eicas) {
      // Replacing the EICAS window: EICAS moves to the other half of the upper centre display.
      return false;
    }
    if (slot === 'F') {
      s.full = true;
    } else if (slot === 'L' || slot === 'R') {
      s.full = false;
      if (slot === 'L') s.splitL = false;
      else s.splitR = false;
    } else {
      s.full = false;
      if (slot[0] === 'L') s.splitL = true;
      else s.splitR = true;
    }
    this.setSel(s, slot, win);
    this.writeVars();
    this.update();
    return true;
  }

  /** Full / split toggle of AFD n (window menu FULL / SPLIT). */
  setFull(n: number, full: boolean): boolean {
    const s = this.sel[n - 1];
    if (full === s.full) return true;
    if (full) {
      // Full format keeps the dominant content: the PFD on outboard displays, else the left half.
      const outboard = n === 1 || n === 4;
      const pick = outboard ? Win.Pfd : s.l === Win.Eicas || s.r === Win.Eicas ? Win.Blank : s.l;
      if (pick === Win.Blank) return false; // the EICAS half cannot be removed by going full
      s.full = true;
      s.f = pick;
    } else {
      s.full = false;
      if (s.f === Win.Pfd) {
        if (n === 1) s.l = Win.Pfd;
        else s.r = Win.Pfd;
      } else if (s.f !== Win.Blank && s.l !== Win.Eicas) s.l = s.f;
    }
    this.writeVars();
    this.update();
    return true;
  }

  /** Splits / joins half `half` of AFD n into quarters. */
  setHalfSplit(n: number, half: 'L' | 'R', split: boolean): boolean {
    const s = this.sel[n - 1];
    if (s.full) return false;
    const cur = half === 'L' ? s.l : s.r;
    if (split && (cur === Win.Pfd || cur === Win.Eicas)) return false;
    if (half === 'L') s.splitL = split;
    else s.splitR = split;
    this.writeVars();
    this.update();
    return true;
  }

  /** Contents the window menu offers for a slot of AFD n. */
  menuFor(n: number, slot: Slot): Win[] {
    return MENU_CONTENTS.filter((w) => allowedIn(n, slot, w));
  }

  // ------------------------------------------------------------ memories

  store(side: 1 | 2, k: number): void {
    if (k < 1 || k > 9) return;
    this.memories[side - 1][k - 1] = this.sel.map(cloneSel);
  }

  recall(side: 1 | 2, k: number): boolean {
    if (k < 1 || k > 9) return false;
    const m = this.memories[side - 1][k - 1];
    for (let i = 0; i < 4; i++) this.sel[i] = cloneSel(m[i]);
    this.writeVars();
    this.update();
    return true;
  }

  // ------------------------------------------------------------ shown layout

  private readonly lastOp = [true, true, true, true];
  private readonly lastRsp = [0, 0];
  private dirty = true;

  /**
   * Per-step check (no allocation): recomputes the shown layouts only when a
   * display's operating state or an RSP DSPL switch changed.
   */
  tick(): void {
    let changed = this.dirty;
    for (let n = 1; n <= 4; n++) {
      const o = this.operating(n);
      if (o !== this.lastOp[n - 1]) changed = true;
    }
    for (const s of [1, 2] as const) if (this.rspDspl(s) !== this.lastRsp[s - 1]) changed = true;
    if (changed) this.update();
  }

  /** Recomputes the shown layouts (reversion) and writes the output vars (allocates: layout changes only). */
  update(): void {
    this.dirty = false;
    const v = this.vars;
    const op = [false, false, false, false];
    for (let n = 1; n <= 4; n++) {
      op[n - 1] = this.operating(n);
      this.lastOp[n - 1] = op[n - 1];
      v.set(this.opVars[n - 1], op[n - 1] ? 1 : 0);
    }
    this.lastRsp[0] = this.rspDspl(1);
    this.lastRsp[1] = this.rspDspl(2);
    const rev = [false, false, false, false];
    const lay: { full: boolean; wins: Map<Slot, Win> }[] = [];
    for (let n = 1; n <= 4; n++) {
      const s = this.sel[n - 1];
      const wins = new Map<Slot, Win>();
      if (s.full) wins.set('F', s.f);
      else {
        if (s.splitL) {
          wins.set('LU', s.lu);
          wins.set('LL', s.ll);
        } else wins.set('L', s.l);
        if (s.splitR) {
          wins.set('RU', s.ru);
          wins.set('RL', s.rl);
        } else wins.set('R', s.r);
      }
      lay.push({ full: s.full, wins });
    }
    const setHalf = (n: number, half: 'L' | 'R', w: Win): void => {
      const l = lay[n - 1];
      if (l.full) {
        const f = l.wins.get('F') ?? Win.Blank;
        l.full = false;
        l.wins.clear();
        // The full content keeps the other half.
        const other = half === 'L' ? 'R' : 'L';
        l.wins.set(other, f === Win.Pfd || f === Win.Eicas ? Win.Map : f);
      }
      l.wins.delete(`${half}U` as Slot);
      l.wins.delete(`${half}L` as Slot);
      l.wins.set(half, w);
      rev[n - 1] = true;
    };
    // RSP DSPL REV: PFD + EICAS composite on the on-side outboard AFD (this EICAS
    // instance wins over the selected one; the pilot's switch takes precedence).
    let forcedEicas = 0;
    for (const side of [1, 2] as const) {
      if (this.rspDspl(side) < 0.5) continue;
      const n = side === 1 ? 1 : 4;
      if (!op[n - 1]) continue;
      setHalf(n, side === 1 ? 'L' : 'R', Win.Pfd);
      setHalf(n, side === 1 ? 'R' : 'L', Win.Eicas);
      if (!forcedEicas) forcedEicas = n;
    }
    // PFD reversion to the upper centre display.
    for (const side of [1, 2] as const) {
      const n = side === 1 ? 1 : 4;
      if (op[n - 1]) continue;
      if (op[1]) setHalf(2, side === 1 ? 'L' : 'R', Win.Pfd);
      else if (op[2]) setHalf(3, side === 1 ? 'L' : 'R', Win.Pfd);
    }
    // EICAS must be shown somewhere operating (only one instance).
    let eicasAt = forcedEicas;
    for (let n = 1; n <= 4 && !eicasAt; n++) {
      if (!op[n - 1]) continue;
      for (const w of lay[n - 1].wins.values()) if (w === Win.Eicas) eicasAt = n;
    }
    if (!eicasAt) {
      const order: [number, 'L' | 'R'][] = [
        [2, 'L'],
        [3, 'L'],
        [2, 'R'],
        [3, 'R'],
        [1, 'R'],
        [4, 'L'],
      ];
      for (const [n, half] of order) {
        if (!op[n - 1]) continue;
        const cur = lay[n - 1].wins.get(half);
        if (cur === Win.Pfd) continue;
        setHalf(n, half, Win.Eicas);
        eicasAt = n;
        break;
      }
    }
    // Remove duplicate EICAS windows (keep the first operating one).
    for (let n = 1; n <= 4; n++) {
      if (n === eicasAt) continue;
      for (const [sl, w] of lay[n - 1].wins) if (w === Win.Eicas) lay[n - 1].wins.set(sl, Win.Map);
    }
    // Build the shown layouts.
    const pfdOn = [0, 0];
    for (let n = 1; n <= 4; n++) {
      const sh = this.shown[n - 1];
      sh.operating = op[n - 1];
      sh.reversion = rev[n - 1];
      sh.windows.length = 0;
      if (op[n - 1]) {
        for (const [slot, win] of lay[n - 1].wins) {
          const owner: 1 | 2 = n === 1 ? 1 : n === 4 ? 2 : slot === 'F' || slot[0] === 'L' ? 1 : 2;
          let pfdSide: 1 | 2 = n === 4 ? 2 : 1;
          if (win === Win.Pfd && (n === 2 || n === 3)) pfdSide = slot[0] === 'R' ? 2 : 1;
          if (win === Win.Pfd && !pfdOn[pfdSide - 1]) pfdOn[pfdSide - 1] = n;
          sh.windows.push({ slot, win, rect: SLOT_RECTS[slot], owner, pfdSide });
        }
        // Stable draw order.
        sh.windows.sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
      }
      v.set(this.revVars[n - 1], rev[n - 1] ? 1 : 0);
    }
    v.set(FUSION_VARS.pfdOn(1), pfdOn[0]);
    v.set(FUSION_VARS.pfdOn(2), pfdOn[1]);
    v.set(FUSION_VARS.eicasOn, eicasAt);
  }

  /** Shown window at a point of AFD n (logical px), or null. */
  windowAt(n: number, x: number, y: number): ShownWindow | null {
    const sh = this.shown[n - 1];
    if (!sh) return null;
    for (const w of sh.windows) {
      const r = w.rect;
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return w;
    }
    return null;
  }

  /** Shown window of a slot (null when that slot is not displayed). */
  windowOf(n: number, slot: Slot): ShownWindow | null {
    return this.shown[n - 1]?.windows.find((w) => w.slot === slot) ?? null;
  }
}
