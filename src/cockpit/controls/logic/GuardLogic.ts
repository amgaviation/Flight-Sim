/**
 * Pure logic for a switch guard (flip cover). The first click opens the
 * guard; the switch underneath can only be operated while it is open.
 *
 * Closing behaviour (`close`):
 *  - 'returns': the cover pushes the switch back to `guardedPosition` as it
 *    closes (typical "guarded to NORMAL/OFF" switches, e.g. Boeing generator
 *    drive disconnect, standby power, many bizjet emergency switches).
 *  - 'blocks': the cover cannot close unless the switch is already in
 *    `guardedPosition` (physical interference).
 *  - 'free': the cover closes regardless (covers over push buttons, clear
 *    covers that leave the switch state alone).
 */
import type { MoveResult, SwitchLogic } from './SwitchLogic';

export type GuardClose = 'returns' | 'blocks' | 'free';

export interface GuardLogicOptions {
  /** Switch position the guard protects (default 0). */
  guardedPosition?: number;
  /** Default 'returns' when a switch is guarded, 'free' for a guarded button. */
  close?: GuardClose;
  /** Initially open (default false). */
  open?: boolean;
}

export type GuardToggleResult = 'opened' | 'closed' | 'blocked';

export class GuardLogic {
  readonly guardedPosition: number;
  readonly closeMode: GuardClose;
  open: boolean;
  private readonly sw: SwitchLogic | null;

  constructor(sw: SwitchLogic | null, o: GuardLogicOptions = {}) {
    this.sw = sw;
    this.guardedPosition = o.guardedPosition ?? 0;
    this.closeMode = o.close ?? (sw ? 'returns' : 'free');
    this.open = o.open ?? false;
  }

  /** The switch may be operated only while the guard is open. */
  canOperate(): boolean {
    return this.open;
  }

  openGuard(): boolean {
    if (this.open) return false;
    this.open = true;
    return true;
  }

  /**
   * Closes the guard. Returns whether it closed and any switch movement the
   * closing caused ('returns' mode).
   */
  closeGuard(): { closed: boolean; moved: MoveResult | null } {
    if (!this.open) return { closed: false, moved: null };
    const sw = this.sw;
    if (sw && sw.index !== this.guardedPosition) {
      if (this.closeMode === 'blocks') return { closed: false, moved: null };
      if (this.closeMode === 'returns') {
        sw.unpull();
        const moved = sw.force(this.guardedPosition);
        this.open = false;
        return { closed: true, moved };
      }
    }
    this.open = false;
    return { closed: true, moved: null };
  }

  toggle(): GuardToggleResult {
    if (!this.open) {
      this.openGuard();
      return 'opened';
    }
    return this.closeGuard().closed ? 'closed' : 'blocked';
  }
}
