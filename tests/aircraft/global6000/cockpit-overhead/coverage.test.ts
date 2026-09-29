/**
 * Global 6000 overhead panel, side consoles / side panels (EMS CDUs) and the
 * cockpit circuit-breaker panel: every control is functional (zero unbound).
 *
 * Same method as cockpit-main/coverage.test.ts: build the real systems and
 * the full cockpit (overhead + side consoles loaded through import.meta.glob),
 * record every SimVar the systems read in several states, then actuate each
 * overhead / side / breaker control through its pointer handlers and require
 * that it changed a var a system reads or emitted an event with a listener.
 * Indicator lenses must be driven by system-written vars.
 */
import { describe, expect, it } from 'vitest';
import type { CockpitControl } from '../../../../src/cockpit/types';
import { AnnunciatorLight } from '../../../../src/cockpit/controls';
import { buildG6kCockpit } from '../../../../src/aircraft/global6000/cockpit';
import { fakeCanvas } from '../../../avionics/collins-fusion/helpers';
import { makeRig } from '../helpers';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { gestures, hasListener, recordReads, recordWrites, systemReads } from './harness';

const MINE = /^g6k\.(ovhd|side|cb|gasper)\./;

describe('Global 6000 overhead / side consoles / CCBP: control coverage', () => {
  it('every overhead, side-console, EMS CDU and breaker control drives a system', { timeout: 300_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    const { build } = buildG6kCockpit(r.ctx, r.sys, { canvas: fakeCanvas() });
    build.root.updateMatrixWorld(true);
    const reads = systemReads(r);
    const mine = build.controls.filter((c) => MINE.test(c.id));
    const INDICATORS: Record<string, string[]> = {
      'g6k.side.oxy_flow1': ['oxy.pilot_flowing'],
      'g6k.side.oxy_flow2': ['oxy.copilot_flowing'],
      'g6k.side.pax_on': ['oxy.pax_on'],
      'g6k.side.pax_low': ['oxy.pax_low'],
      'g6k.ovhd.no_smoking_sign': ['ac.light.no_smoking'],
      'g6k.ovhd.wing_feed_l': ['ac.g6k.ck.oh.wing_feed_l'],
      'g6k.ovhd.wing_feed_r': ['ac.g6k.ck.oh.wing_feed_r'],
    };
    // Operating conditions some controls need before a system looks at them (the systems read these vars only then).
    const PRECONDITION: Record<string, () => void> = {
      'g6k.ovhd.ext_ac': () => r.vars.set(V.extAcAvail, 1), // ground power cart connected
      'g6k.ovhd.ext_dc': () => r.vars.set(V.extDcAvail, 1),
      'g6k.ovhd.man_temp_l': () => r.vars.set(V.packFlowSel, 3), // PACK CONTROL MAN
      'g6k.ovhd.man_temp_r': () => r.vars.set(V.packFlowSel, 3),
      'g6k.side.oxy_mode1': () => (r.vars.set(V.oxyMask(1), 1), r.vars.set(V.crewOxy, 1)), // mask out of the box, supply open: regulator in use
      'g6k.side.oxy_mode2': () => (r.vars.set(V.oxyMask(2), 1), r.vars.set(V.crewOxyR, 1)),
      // Fire handles: solenoid unlocked (DAU fire warning / override, logic.ts V.fireUnlock).
      'g6k.ovhd.fire_l': () => r.vars.set(V.fireUnlock('l'), 1),
      'g6k.ovhd.fire_apu': () => r.vars.set(V.fireUnlock('apu'), 1),
      'g6k.ovhd.fire_r': () => r.vars.set(V.fireUnlock('r'), 1),
      'g6k.side.oxy_emer1': () => (r.vars.set(V.oxyMask(1), 1), r.vars.set(V.crewOxy, 1)),
      'g6k.side.oxy_emer2': () => (r.vars.set(V.oxyMask(2), 1), r.vars.set(V.crewOxyR, 1)),
    };
    // Vars consumed inside closures that run only while an aural plays (createSystems.ts casAudio: IAC 1 / 2 mute gating).
    const CLOSURE_CONSUMED = new Set([V.auralMute(1), V.auralMute(2)]);
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
        PRECONDITION[c.id]?.();
        emitted.length = 0;
        const changed = [...recordWrites(r.vars, () => g(advance(c)))].filter((n) => !n.startsWith('ac.g6k.ck.'));
        const sysReads = recordReads(r.vars, () => {
          for (const s of r.sys.list) s.update(1 / 60);
        });
        const consumedVar = changed.find((n) => reads.has(n) || sysReads.has(n) || CLOSURE_CONSUMED.has(n));
        const handled = emitted.find((e) => hasListener(r.events, e));
        if (consumedVar) via = `var ${consumedVar}`;
        else if (handled) via = `event ${handled}`;
        if (via) break;
      }
      report.push({ id: c.id, bound: via !== '', via });
    }
    off();
    const unbound = report.filter((x) => !x.bound).map((x) => x.id);
    console.log(`Global 6000 overhead / side / CCBP: ${report.length} controls, ${report.length - unbound.length} bound.\n${report.map((x) => `  ${x.bound ? 'OK ' : '-- '} ${x.id.padEnd(30)} ${x.via}`).join('\n')}`);
    expect(mine.filter((c) => c.id.startsWith('g6k.ovhd.')).length).toBeGreaterThan(80);
    expect(mine.filter((c) => c.id.startsWith('g6k.side.')).length).toBeGreaterThan(18);
    expect(mine.filter((c) => c.id.startsWith('g6k.cb.')).length).toBeGreaterThan(10);
    expect(unbound).toEqual([]);
    build.dispose?.();
  });
});
