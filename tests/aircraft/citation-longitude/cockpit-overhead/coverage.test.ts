/**
 * Citation Longitude overhead panel and side consoles: every control is
 * functional (zero unbound controls).
 *
 * Same method as cockpit-main/coverage.test.ts: build the real systems and the
 * full cockpit (overhead + side consoles loaded through import.meta.glob),
 * record every SimVar the systems read in several states, then actuate each
 * overhead / side-console / circuit-breaker control through its pointer
 * handlers and require that it changed a var a system reads or emitted a
 * handled event. Indicator lenses must be driven by system-written vars.
 */
import { describe, expect, it } from 'vitest';
import type { CockpitControl } from '../../../../src/cockpit/types';
import { AnnunciatorLight } from '../../../../src/cockpit/controls';
import { buildLongitudeCockpit } from '../../../../src/aircraft/citation-longitude/cockpit';
import { makeRig } from '../helpers';
import { gestures, hasListener, recordReads, recordWrites, systemReads } from './harness';

const MINE = /^lon\.(oh|sc|cb)\./;

describe('Citation Longitude overhead / side consoles: control coverage', () => {
  it('every overhead, side-console and breaker control drives a system', { timeout: 240_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: false });
    const { build } = buildLongitudeCockpit(r.ctx, r.sys, null, { headless: true });
    build.root.updateMatrixWorld(true);
    const reads = systemReads(r);
    const mine = build.controls.filter((c) => MINE.test(c.id));
    const INDICATORS: Record<string, string[]> = {
      'lon.sc.oxy_flow_l': ['oxy.pilot_flowing'],
      'lon.sc.oxy_flow_r': ['oxy.copilot_flowing'],
    };
    const emitted: string[] = [];
    const off = r.events.onAny((n) => emitted.push(n));
    const report: { id: string; bound: boolean; via: string }[] = [];
    const advance = (c: CockpitControl) => (s: number) => {
      const n = Math.max(1, Math.round(s * 60));
      for (let i = 0; i < n; i++) {
        c.update?.(1 / 60);
        build.update?.(1 / 60);
      }
    };
    for (const c of mine) {
      if (c instanceof AnnunciatorLight) {
        const lamps = INDICATORS[c.id] ?? [];
        const missing = lamps.filter((n) => !r.vars.has(n));
        report.push({ id: c.id, bound: lamps.length > 0 && missing.length === 0, via: `indicator ${lamps.join(', ')}` });
        continue;
      }
      let via = '';
      for (const g of gestures(c)) {
        emitted.length = 0;
        const changed = [...recordWrites(r.vars, () => g(advance(c)))].filter((n) => !n.startsWith('ac.lon.ck.'));
        const sysReads = recordReads(r.vars, () => {
          for (const s of r.sys.list) s.update(1 / 60);
        });
        const consumedVar = changed.find((n) => reads.has(n) || sysReads.has(n));
        const handled = emitted.find((e) => hasListener(r.events, e));
        if (consumedVar) via = `var ${consumedVar}`;
        else if (handled) via = `event ${handled}`;
        if (via) break;
      }
      report.push({ id: c.id, bound: via !== '', via });
    }
    off();
    const unbound = report.filter((x) => !x.bound).map((x) => x.id);
    console.log(`Longitude overhead / side consoles: ${report.length} controls, ${report.length - unbound.length} bound.\n${report.map((x) => `  ${x.bound ? 'OK ' : '-- '} ${x.id.padEnd(28)} ${x.via}`).join('\n')}`);
    // LIGHTS strip (c_oh): 10 switchlights, 3 dimmers, EMER LTS; 2 sun visors; 2 x (mask, regulator, test, flow); breakers.
    expect(mine.filter((c) => c.id.startsWith('lon.oh.')).length).toBe(16);
    expect(mine.filter((c) => c.id.startsWith('lon.sc.')).length).toBe(10); // per side: mask, regulator, test, flow, MIC SEL (function fix round 1)
    expect(mine.filter((c) => c.id.startsWith('lon.cb.')).length).toBeGreaterThan(50);
    expect(unbound).toEqual([]);
  });
});
