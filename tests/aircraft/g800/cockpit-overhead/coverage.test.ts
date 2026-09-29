/**
 * G800 overhead, side consoles and CB panels: every control is functional.
 *
 * Same method as the main-cockpit coverage test (tests/aircraft/g800/cockpit-main/coverage.test.ts):
 * the real systems (with the Symmetry suite on fake canvases) run in several states while every var
 * they read is recorded; each overhead / side / CB control is then actuated through its pointer
 * handlers (click, right click, ctrl-click, wheel, drag; guards open on the first gesture) and must
 * change a var a system reads or emit a handled event. Indicators must show vars the systems write.
 * The report must list no unbound control, and every OHPTS must be mounted.
 */
import { describe, expect, it } from 'vitest';
import type { CockpitControl } from '../../../../src/cockpit/types';
import type { SimVars } from '../../../../src/core/SimVars';
import { AnnunciatorLight } from '../../../../src/cockpit/controls';
import { applyG800State } from '../../../../src/aircraft/g800/states';
import type { Rig } from '../helpers';
import { fullCockpit, ptr } from './util';
import { mechanicalBreakers } from '../../../../src/aircraft/g800/cbTable';

const MINE = /^g800\.(oh|side|cb)\./;

function recordReads(vars: SimVars, fn: () => void): Set<string> {
  const reads = new Set<string>();
  const v = vars as unknown as { get: SimVars['get']; has: SimVars['has'] };
  const get = v.get.bind(vars);
  const has = v.has.bind(vars);
  v.get = (n: string, f?: number) => {
    reads.add(n);
    return get(n, f);
  };
  v.has = (n: string) => {
    reads.add(n);
    return has(n);
  };
  try {
    fn();
  } finally {
    delete (vars as unknown as Record<string, unknown>).get;
    delete (vars as unknown as Record<string, unknown>).has;
  }
  return reads;
}

function recordWrites(vars: SimVars, fn: () => void): Set<string> {
  const written = new Set<string>();
  const v = vars as unknown as { set: SimVars['set'] };
  const set = v.set.bind(vars);
  v.set = (n: string, x: number) => {
    if (!Object.is(vars.get(n, NaN), x)) written.add(n);
    set(n, x);
  };
  try {
    fn();
  } finally {
    delete (vars as unknown as Record<string, unknown>).set;
  }
  return written;
}

function systemReads(r: Rig): Set<string> {
  const all = new Set<string>();
  const run = (s: number) => {
    for (const n of recordReads(r.vars, () => r.run(s))) all.add(n);
  };
  run(2);
  for (const st of ['cold_dark', 'takeoff', 'approach', 'ready_to_taxi'] as const) {
    applyG800State(r.ctx, r.sys, st);
    run(1);
  }
  return all;
}

function gestures(c: CockpitControl): ((adv: (s: number) => void) => void)[] {
  const out: ((adv: (s: number) => void) => void)[] = [];
  const targets = c.hitTargets.length ? c.hitTargets : [c.object];
  for (const t of targets) {
    for (const button of [0, 2, 1] as const) {
      out.push((adv) => {
        c.onPointerDown?.(ptr(c, button, {}, t));
        adv(0.12);
        c.onPointerUp?.(ptr(c, button, {}, t));
        adv(0.4);
      });
    }
    for (const w of [1, -1, 3]) {
      out.push((adv) => {
        c.onWheel?.(w, ptr(c, 0, {}, t));
        adv(0.1);
      });
    }
    for (const [dx, dy] of [
      [120, 0],
      [0, -120],
      [-120, 0],
    ]) {
      out.push((adv) => {
        const p = ptr(c, 0, {}, t);
        c.onPointerDown?.(p);
        for (let i = 0; i < 6; i++) {
          c.onDrag?.(dx / 6, dy / 6, p);
          adv(1 / 30);
        }
        c.onPointerUp?.(p);
        adv(0.1);
      });
    }
  }
  return out;
}

describe('G800 overhead / side consoles: control coverage', () => {
  it('every overhead, side-console and CB control drives a var a system reads', { timeout: 600_000 }, async () => {
    const { r, build } = await fullCockpit('ready_to_taxi');
    const reads = systemReads(r);
    const INDICATORS: Record<string, string[]> = {
      'g800.side.oxy_flow1': ['oxy.pilot_flow_lpm'],
      'g800.side.oxy_flow2': ['oxy.copilot_flow_lpm'],
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
    // Operating conditions some controls need to act (their consumers ignore them otherwise, as in the aircraft).
    const PRECONDITION: Record<string, () => void> = {
      'g800.oh.gpu': () => r.vars.set('ac.g800.gpu_avail', 1), // GPU switch only matters with a cart connected
      'g800.oh.cabin_alt': () => r.vars.set('ac.press.mode_sw', 2), // CABIN ALT acts in MANUAL mode
    };
    const mine = build.controls.filter((c) => MINE.test(c.id));
    for (const c of mine) {
      if (c instanceof AnnunciatorLight) {
        const lamps = INDICATORS[c.id] ?? [];
        report.push({ id: c.id, bound: lamps.length > 0 && lamps.every((n) => r.vars.has(n)), via: `indicator ${lamps.join(', ')}` });
        continue;
      }
      let via = '';
      for (const g of gestures(c)) {
        PRECONDITION[c.id]?.();
        // Guarded controls: lift the guard first (the first click on a closed cover only opens it).
        (c as unknown as { guard?: { openGuard(): void } }).guard?.openGuard();
        emitted.length = 0;
        const changed = [...recordWrites(r.vars, () => g(advance(c)))].filter((n) => !n.startsWith('ac.g800.ck.'));
        const sysReads = recordReads(r.vars, () => {
          for (const s of r.sys.list) s.update(1 / 60);
        });
        const consumed = changed.find((n) => reads.has(n) || sysReads.has(n));
        const handled = emitted.find((e) => (r.events as unknown as { handlers: Map<string, Set<unknown>> }).handlers.get(e)?.size);
        if (consumed) via = `var ${consumed}`;
        else if (handled) via = `event ${handled}`;
        if (via) break;
      }
      report.push({ id: c.id, bound: via !== '', via });
    }
    off();
    const unbound = report.filter((x) => !x.bound).map((x) => x.id);
    console.log(`G800 overhead/side/CB: ${report.length} controls, ${report.length - unbound.length} bound.\n${report.map((x) => `  ${x.bound ? 'OK ' : '-- '} ${x.id.padEnd(28)} ${x.via}`).join('\n')}`);
    expect(unbound).toEqual([]);
    expect(report.filter((x) => x.id.startsWith('g800.oh.')).length).toBeGreaterThanOrEqual(28);
    expect(report.filter((x) => x.id.startsWith('g800.cb.')).length).toBe(mechanicalBreakers().length);
    // The three overhead touch screens are mounted.
    const ids = build.displays.map((d) => d.display.id);
    for (const n of [1, 2, 3]) expect(ids).toContain(`epic.ohpts${n}`);
  });
});
