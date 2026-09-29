/**
 * Control inventory audit (CLAUDE.md "Everything in a cockpit works"): every
 * cockpit control var of the 737-800 (vars.ts b738ControlVars) is read by at
 * least one system while the systems run (reads are recorded through
 * SimVars.get, which every compiled binding uses). A control that nothing
 * reads would be decorative.
 */
import { describe, expect, it } from 'vitest';
import { b738ControlVars } from '../../../src/aircraft/b737-800/vars';
import { makeB738 } from './helpers';

describe('control inventory', () => {
  it('every control var is consumed by a system', () => {
    const read = new Set<string>();
    for (const state of ['cold_dark', 'ready_to_taxi', 'cruise'] as const) {
      const r = makeB738({ state, ...(state === 'cruise' ? { air: { altFtMsl: 20000, iasKt: 280, headingTrue: 90 } } : {}) });
      const get = r.vars.get.bind(r.vars);
      r.vars.get = (name: string, fallback?: number) => {
        read.add(name);
        return get(name, fallback);
      };
      r.run(1);
    }
    const unread = b738ControlVars().filter((n) => !read.has(n));
    expect(unread).toEqual([]);
  });
});
