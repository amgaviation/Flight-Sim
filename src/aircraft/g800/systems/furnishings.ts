/**
 * G800 flight-deck furnishings: the slow manual / electric adjusters whose function is out of scope (sun visors,
 * pull-out meal / desk tables - BJT500 "retractable desk/meal table mounted on the bottom of the instrument panel" -,
 * sidestick armrest TILT ADJ and the rudder-pedal adjust crank). SCOPE: no glare, reach or ergonomics model; each
 * command var drives a rate-limited position (`<var>_pos`, 0..1) that the cockpit animates.
 * EST travel times: visor 0.6 s, table 1.2 s, armrest tilt 1 s, pedal adjust 2 s full range.
 */
import type { SimVars } from '../../../core/SimVars';
import type { Subsystem } from '../../types';
import { G800_VARS as V } from '../vars';

export class G800Furnishings implements Subsystem {
  readonly name = 'g800.furnishings';
  private readonly items: { cmd: string; pos: string; rate: number }[] = [];

  constructor(private readonly vars: SimVars) {
    for (const s of [1, 2] as const) {
      this.items.push({ cmd: V.visor(s), pos: `${V.visor(s)}_pos`, rate: 1 / 0.6 });
      this.items.push({ cmd: V.table(s), pos: `${V.table(s)}_pos`, rate: 1 / 1.2 });
      this.items.push({ cmd: V.armTilt(s), pos: `${V.armTilt(s)}_pos`, rate: 1 });
      this.items.push({ cmd: V.pedalAdj(s), pos: `${V.pedalAdj(s)}_pos`, rate: 0.5 });
    }
  }

  reset(): void {
    for (const it of this.items) this.vars.set(it.pos, this.vars.get(it.cmd));
  }

  update(dt: number): void {
    const v = this.vars;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const tgt = Math.max(0, Math.min(1, v.get(it.cmd)));
      const pos = v.get(it.pos, tgt);
      const step = it.rate * dt;
      v.set(it.pos, pos + Math.max(-step, Math.min(step, tgt - pos)));
    }
  }
}
