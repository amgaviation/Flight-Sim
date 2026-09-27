/**
 * Frequency-selector logic of the aft-pedestal radio panels (the knobs emit
 * click events; this adjusts the standby frequencies with the real panels'
 * carry / wrap rules; the transfer switches are handled by the systems
 * logic, B738Logic):
 *
 *  - VHF NAV control panel: outer knob 1 MHz (108-117 MHz), inner 50 kHz
 *    (.00-.95, wraps within the MHz) (FCOM 5.10 / ARINC 710 band).
 *  - VHF COM (radio tuning panel): outer 1 MHz (118-136), inner 25 kHz
 *    (.000-.975, wraps) (SCOPE: 8.33 kHz channels are not offered).
 *  - ADF: outer 100 kHz, inner 1 kHz (190-1750 kHz; EST step: the NG ADF
 *    panel tunes in 0.5 kHz with three knobs).
 *  - ATC code: four octal digits (two concentric knobs), writes `xpdr.code`
 *    as the 4-digit number.
 *
 * Events: `b738.<radio><n>.<outer|inner>_<inc|dec>` (payload = clicks) and
 * `b738.xpdr.d<k>_<inc|dec>`.
 */
import type { SimContext } from '../../../core/SimContext';
import { NAV } from '../../../core/vars';

export const TUNE_EVENTS = {
  knob: (radio: 'nav' | 'com' | 'adf', n: 1 | 2, ch: 'outer' | 'inner', dir: 'inc' | 'dec') => `b738.${radio}${n}.${ch}_${dir}`,
  xpdrDigit: (k: 1 | 2 | 3 | 4, dir: 'inc' | 'dec') => `b738.xpdr.d${k}_${dir}`,
} as const;

const clicks = (p: unknown): number => (typeof p === 'number' && Number.isFinite(p) ? Math.max(1, Math.round(p)) : 1);

export function installRadioTuning(ctx: Pick<SimContext, 'vars' | 'events'>): () => void {
  const v = ctx.vars;
  const offs: (() => void)[] = [];
  const on = (name: string, fn: (n: number) => void) => offs.push(ctx.events.on(name, (p) => fn(clicks(p))));
  // Generic: frequency split into whole units and fraction with wrap rules.
  const tune = (varName: string, lo: number, hi: number, frac: number, fracSpan: number, init: number) => ({
    outer: (d: number) => {
      const f = v.get(varName, init);
      const whole = Math.floor(f + 1e-6);
      const fr = f - whole;
      let w = whole + d;
      const span = hi - lo + 1;
      w = lo + ((((w - lo) % span) + span) % span);
      v.set(varName, Math.round((w + fr) * 1000) / 1000);
    },
    inner: (d: number) => {
      const f = v.get(varName, init);
      const whole = Math.floor(f + 1e-6);
      const steps = Math.round((f - whole) / frac);
      const n = Math.round(fracSpan / frac);
      const s = (((steps + d) % n) + n) % n;
      v.set(varName, Math.round((whole + s * frac) * 1000) / 1000);
    },
  });
  for (const n of [1, 2] as const) {
    const nav = tune(NAV.standbyFreq(n), 108, 117, 0.05, 1, 108.0);
    const com = tune(NAV.comStandby(n), 118, 136, 0.025, 1, 118.0);
    for (const [radio, t] of [
      ['nav', nav],
      ['com', com],
    ] as const) {
      on(TUNE_EVENTS.knob(radio, n, 'outer', 'inc'), (c) => t.outer(c));
      on(TUNE_EVENTS.knob(radio, n, 'outer', 'dec'), (c) => t.outer(-c));
      on(TUNE_EVENTS.knob(radio, n, 'inner', 'inc'), (c) => t.inner(c));
      on(TUNE_EVENTS.knob(radio, n, 'inner', 'dec'), (c) => t.inner(-c));
    }
    const adf = NAV.adfStandby(n);
    const adfSet = (d: number) => v.set(adf, Math.max(190, Math.min(1750, Math.round(v.get(adf, 350) + d))));
    on(TUNE_EVENTS.knob('adf', n, 'outer', 'inc'), (c) => adfSet(100 * c));
    on(TUNE_EVENTS.knob('adf', n, 'outer', 'dec'), (c) => adfSet(-100 * c));
    on(TUNE_EVENTS.knob('adf', n, 'inner', 'inc'), (c) => adfSet(c));
    on(TUNE_EVENTS.knob('adf', n, 'inner', 'dec'), (c) => adfSet(-c));
  }
  const digit = (k: 1 | 2 | 3 | 4, d: number) => {
    const code = Math.max(0, Math.round(v.get(NAV.xpdrCode, 2000)));
    const pow = 10 ** (4 - k);
    const cur = Math.floor(code / pow) % 10;
    const nd = (((Math.min(7, cur) + d) % 8) + 8) % 8;
    v.set(NAV.xpdrCode, code - cur * pow + nd * pow);
  };
  for (const k of [1, 2, 3, 4] as const) {
    on(TUNE_EVENTS.xpdrDigit(k, 'inc'), (c) => digit(k, c));
    on(TUNE_EVENTS.xpdrDigit(k, 'dec'), (c) => digit(k, -c));
  }
  return () => {
    for (const o of offs) o();
  };
}
