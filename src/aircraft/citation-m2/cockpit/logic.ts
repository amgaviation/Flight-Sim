/**
 * Small cockpit-hardware logic for controls whose behaviour lives in the
 * unit itself (updated with the systems at 60 Hz):
 *  - `GtcKnobPushLogic`: GTC 570 dual concentric knob push vs push-and-hold
 *    (G3000 PG §1.3: push = toggle COM1 / COM2 tuning, push and hold = swap
 *    active / standby). A press shorter than 0.8 s (EST, Garmin long-press)
 *    emits `g3k.<gtc>.upper_push` on release; holding emits
 *    `g3k.<gtc>.upper_hold` once.
 *  - `EsiController` (displays.ts) handles the ESI-1000 bezel buttons.
 */
import type { SimContext } from '../../../core/SimContext';
import type { Subsystem } from '../../types';
import { G3K_EVENTS } from '../../../avionics/garmin-g3000/vars';

export const GTC_PUSH_VAR = (gtc: string): string => `ac.m2.${gtc}_upper_push`;
const HOLD_S = 0.8;

export class GtcKnobPushLogic implements Subsystem {
  readonly name = 'm2.gtc_knob_push';
  private readonly held: number[];
  private readonly fired: boolean[];
  private readonly vars: string[];
  constructor(
    private readonly ctx: Pick<SimContext, 'vars' | 'events'>,
    private readonly gtcs: readonly string[],
  ) {
    this.held = gtcs.map(() => -1);
    this.fired = gtcs.map(() => false);
    this.vars = gtcs.map((g) => GTC_PUSH_VAR(g));
  }
  update(dt: number): void {
    const v = this.ctx.vars;
    for (let i = 0; i < this.gtcs.length; i++) {
      const down = v.get(this.vars[i]) !== 0;
      if (down) {
        if (this.held[i] < 0) {
          this.held[i] = 0;
          this.fired[i] = false;
        } else this.held[i] += dt;
        if (!this.fired[i] && this.held[i] >= HOLD_S) {
          this.fired[i] = true;
          this.ctx.events.emit(G3K_EVENTS.gtcUpperHold(this.gtcs[i]));
        }
      } else if (this.held[i] >= 0) {
        if (!this.fired[i]) this.ctx.events.emit(G3K_EVENTS.gtcUpperPush(this.gtcs[i]));
        this.held[i] = -1;
      }
    }
  }
}
