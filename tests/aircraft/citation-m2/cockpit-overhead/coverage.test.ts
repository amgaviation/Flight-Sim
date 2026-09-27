/**
 * Citation M2 overhead / sidewall parts: control coverage (CLAUDE.md
 * "Everything in a cockpit works"). Every control the overhead and sidewall
 * builders add is actuated through its own pointer / wheel handlers; each
 * must change a var that a system reads (recorded over several states), and
 * every indicator lamp must follow a var a system writes. Also: every
 * cockpit-panel breaker of the electrical network has a control, and the crew
 * oxygen inventory vars (dossier §9.9) are bound.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { AnnunciatorLight, CircuitBreaker } from '../../../../src/cockpit/controls';
import { M2 } from '../../../../src/aircraft/citation-m2/vars';
import { applyM2State } from '../../../../src/aircraft/citation-m2/states';
import { MAX_PANEL_BREAKER_A } from '../../../../src/aircraft/citation-m2/cockpit/side/breakers';
import { allLoadsOn, exercise, isPartControl, makeCockpitRig, recordReads, recordWrites } from './harness';

describe('Citation M2 overhead / sidewall controls', () => {
  it('every part control drives a var a system reads; every lamp follows a system output (coverage report)', () => {
    const r = makeCockpitRig({ state: 'ready_to_taxi' });
    const controls = r.ck.build.controls.filter(isPartControl);
    const tick = () => {
      for (const s of r.ck.systems) s.update(1 / 60);
    };
    // Actuate every control, recording the vars it changes.
    const writes = new Map<string, Set<string>>();
    for (const c of controls) {
      if (c instanceof AnnunciatorLight) continue;
      writes.set(c.id, recordWrites(r.vars, () => exercise(c, () => {
        c.update?.(1 / 60);
        tick();
      })));
    }
    // What the systems (aircraft list + cockpit-part subsystems) read and write, over several states.
    const reads = new Set<string>();
    const sysWrites = new Set<string>();
    const runAll = () =>
      recordWrites(r.vars, () => recordReads(r.vars, () => r.step(1), reads), sysWrites, false);
    runAll();
    for (const st of ['cold_dark', 'ready_to_taxi', 'takeoff'] as const) {
      applyM2State(r.ctx, r.sys, st);
      allLoadsOn(r.vars);
      runAll();
    }
    // Masks donned and tested (the flow indicators light only then).
    r.vars.set(M2.maskOn(1), 1);
    r.vars.set('ac.m2.mask2_test', 1);
    runAll();

    const report: string[] = [];
    const unbound: string[] = [];
    for (const c of controls) {
      if (c instanceof AnnunciatorLight) {
        const segs = (c as unknown as { o: { segments: { var?: string }[] } }).o.segments;
        const lamp = segs.map((s) => s.var).filter((x): x is string => !!x);
        const ok = lamp.length > 0 && lamp.every((x) => sysWrites.has(x));
        report.push(`${c.id.padEnd(30)} indicator: ${lamp.join(', ')}${ok ? '' : ' (NOT WRITTEN BY A SYSTEM)'}`);
        if (!ok) unbound.push(c.id);
        continue;
      }
      const w = [...(writes.get(c.id) ?? [])];
      const used = w.filter((x) => reads.has(x));
      report.push(`${c.id.padEnd(30)} ${used.join(', ') || '-'}`);
      if (used.length === 0) unbound.push(`${c.id} (wrote ${w.join(',') || 'nothing'})`);
    }
    fs.mkdirSync('tests/output', { recursive: true });
    fs.writeFileSync('tests/output/citation-m2-overhead-coverage.txt', `${controls.length} controls, ${unbound.length} unbound\n${report.join('\n')}\n`);
    expect(controls.length).toBeGreaterThan(60);
    expect(unbound).toEqual([]);
  });

  it('every cockpit-panel breaker of the electrical network has a CircuitBreaker control bound to cb.<name>', () => {
    const r = makeCockpitRig({ state: 'cold_dark' });
    const cbs = r.ck.build.controls.filter((c): c is CircuitBreaker => c instanceof CircuitBreaker);
    const bound = new Set(cbs.map((c) => (c as unknown as { o: { var: string } }).o.var));
    const network = r.sys.elec.breakerNames();
    const panel = network.filter((b) => b.ratingA <= MAX_PANEL_BREAKER_A).map((b) => `cb.${b.name}`);
    expect(panel.filter((n) => !bound.has(n))).toEqual([]);
    // No control on a breaker the network does not have.
    const all = new Set(network.map((b) => `cb.${b.name}`));
    expect([...bound].filter((n) => !all.has(n))).toEqual([]);
    // Junction-box limiters only (> 50 A) stay off the panels.
    expect(network.filter((b) => b.ratingA > MAX_PANEL_BREAKER_A).map((b) => b.name).sort()).toEqual(['air_cond', 'l_limiter', 'r_limiter', 'r_xfeed']);
  });

  it('binds the crew oxygen inventory vars (dossier §9.9) to controls', () => {
    const r = makeCockpitRig({ state: 'ready_to_taxi' });
    const written = new Set<string>();
    for (const c of r.ck.build.controls.filter(isPartControl)) recordWrites(r.vars, () => exercise(c, () => c.update?.(1 / 60)), written);
    const inv = [M2.maskOn(1), M2.maskOn(2), M2.maskMode(1), M2.maskMode(2), 'ac.m2.mask1_test', 'ac.m2.mask2_test', 'ac.m2.ac_outlet_plug'];
    expect(inv.filter((v) => !written.has(v))).toEqual([]);
  });
});
