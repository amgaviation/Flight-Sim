import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { FDM } from '../../../src/core/vars';
import { compileBinding, compileExpression, expr, expressionVars } from '../../../src/systems/util/binding';
import { Flasher, Hysteresis, Latch, OffDelay, OnDelay, Pulse, SigmaDelta } from '../../../src/systems/util/timers';
import { Actuator, LagRateLimiter } from '../../../src/systems/util/filters';
import { starterDutyForSpeedRatio, StarterDriver } from '../../../src/systems/util/starter';
import { FailureManager } from '../../../src/systems/failures/FailureManager';

describe('bindings / expressions', () => {
  it('evaluates vars, arithmetic, comparisons, logic and precedence', () => {
    const v = new SimVars();
    v.set('elec.bus_v', 27.5);
    v.set('ac.sw', 2);
    const e = (s: string) => compileExpression(v, s)();
    expect(e('elec.bus_v')).toBe(27.5);
    expect(e('elec.bus_v >= 24.5')).toBe(1);
    expect(e('1 + 2 * 3')).toBe(7);
    expect(e('(1 + 2) * 3')).toBe(9);
    expect(e('-2 * -3')).toBe(6);
    expect(e('ac.sw == 2 && elec.bus_v > 20')).toBe(1);
    expect(e('ac.sw == 1 || !ac.missing')).toBe(1);
    expect(e('ac.sw == 2 ? 10 : 20')).toBe(10);
    expect(e('ac.sw == 1 ? 10 : ac.sw == 2 ? 30 : 40')).toBe(30);
    expect(e('5 % 3')).toBe(2);
    expect(e('1 / 0')).toBe(0);
    expect(e('1e-3 * 1000')).toBeCloseTo(1, 12);
    expect(e('true + false')).toBe(1);
  });

  it('functions and defaults for missing vars', () => {
    const v = new SimVars();
    v.set('x', 0.7);
    const e = (s: string) => compileExpression(v, s)();
    expect(e('cb.avn ?? 1')).toBe(1);
    expect(e('cb.avn ?? -2')).toBe(-2);
    v.set('cb.avn', 0);
    expect(e('cb.avn ?? 1')).toBe(0);
    expect(e('min(3, x, 2)')).toBe(0.7);
    expect(e('max(3, x, 2)')).toBe(3);
    expect(e('clamp(x * 2, 0, 1)')).toBe(1);
    expect(e('clamp01(-1)')).toBe(0);
    expect(e('step(x, 0.5)')).toBe(1);
    expect(e('between(x, 0.5, 0.8)')).toBe(1);
    expect(e('remap(x, 0.5, 1, 0, 100)')).toBeCloseTo(40, 10);
    expect(e('lerp(10, 20, 0.25)')).toBe(12.5);
    expect(e('abs(-3) + sign(-2) + floor(1.7) + ceil(1.2) + round(1.5)')).toBe(3 - 1 + 1 + 2 + 2);
    expect(e('sqrt(16)')).toBe(4);
    expect(e('bool(0.2)')).toBe(1);
    expect(e('eq(1.0, 1.05, 0.1)')).toBe(1);
  });

  it('compileBinding accepts numbers, booleans, strings and callbacks; errors are loud', () => {
    const v = new SimVars();
    v.set('a', 3);
    expect(compileBinding(v, 4)()).toBe(4);
    expect(compileBinding(v, true)()).toBe(1);
    expect(compileBinding(v, undefined, 9)()).toBe(9);
    expect(compileBinding(v, 'a * 2')()).toBe(6);
    expect(compileBinding(v, (vars) => vars.get('a') + 1)()).toBe(4);
    expect(() => compileExpression(v, 'a +')).toThrow(/Binding expression/);
    expect(() => compileExpression(v, 'foo(1)')).toThrow(/unknown function/);
    expect(() => compileExpression(v, 'a $ b')).toThrow(/unexpected character/);
    expect(() => compileExpression(v, 'clamp(1, 2)')).toThrow(/takes 3/);
    expect(expressionVars('elec.bus_v > 20 && max(ac.a, ac.b) ?? 1')).toEqual(['elec.bus_v', 'ac.a', 'ac.b']);
    expect(expr.and(expr.on('ac.batt'), expr.powered('elec.hot_v', 18))).toBe('((ac.batt != 0)) && ((elec.hot_v >= 18))');
    expect(compileExpression(v, expr.withDefault('cb.x', 1))()).toBe(1);
  });
});

describe('timers and filters', () => {
  it('OnDelay/OffDelay/Latch/Hysteresis/Pulse', () => {
    const on = new OnDelay(1);
    expect(on.update(true, 0.5)).toBe(false);
    expect(on.update(true, 0.6)).toBe(true);
    expect(on.update(false, 0.1)).toBe(false);
    const off = new OffDelay(1);
    expect(off.update(true, 0.1)).toBe(true);
    expect(off.update(false, 0.5)).toBe(true);
    expect(off.update(false, 0.6)).toBe(false);
    const l = new Latch();
    expect(l.update(true, false)).toBe(true);
    expect(l.update(false, false)).toBe(true);
    expect(l.update(true, true)).toBe(false);
    const lowV = new Hysteresis(24.5, 25, true);
    expect(lowV.update(25.5)).toBe(false);
    expect(lowV.update(24.4)).toBe(true);
    expect(lowV.update(24.8)).toBe(true);
    expect(lowV.update(25.1)).toBe(false);
    const p = new Pulse(0.5);
    expect(p.update(true, 0.1)).toBe(true);
    expect(p.update(true, 0.3)).toBe(true);
    expect(p.update(true, 0.3)).toBe(false);
  });

  it('SigmaDelta averages to the duty; Flasher windows; Actuator travel; LagRateLimiter', () => {
    const sd = new SigmaDelta();
    let s = 0;
    for (let i = 0; i < 1000; i++) s += sd.update(0.37);
    expect(s).toBe(370);
    const f = new Flasher(1, [0, 0.1, 0.5, 0.6]);
    let on = 0;
    for (let i = 0; i < 1000; i++) if (f.update(0.01)) on++;
    expect(on).toBeGreaterThanOrEqual(195); // 20 % duty (floating-point phase accumulation)
    expect(on).toBeLessThanOrEqual(205);
    const a = new Actuator(2, 0);
    a.update(1, 1);
    expect(a.position).toBeCloseTo(0.5, 10);
    expect(a.inTransit).toBe(true);
    a.update(1, 1.5);
    expect(a.position).toBe(1);
    a.stuck = true;
    a.update(0, 1);
    expect(a.position).toBe(1);
    const lr = new LagRateLimiter(0.1, 1, 0);
    lr.update(10, 0.5);
    expect(lr.value).toBeCloseTo(0.5, 10);
  });

  it('starter duty inverts the turbine starter equilibrium', () => {
    expect(starterDutyForSpeedRatio(1)).toBe(1);
    expect(starterDutyForSpeedRatio(0)).toBe(0);
    const d = starterDutyForSpeedRatio(0.5);
    // Equilibrium N/Nmax = (d/4) / (d/4 + (1-d)/6) = 0.5
    expect(d / 4 / (d / 4 + (1 - d) / 6)).toBeCloseTo(0.5, 12);
    const vars = new SimVars();
    const drv = new StarterDriver(vars, { engineStarterVar: 'eng1.starter', kind: 'piston' });
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += drv.update(true, 0.6);
    expect(sum).toBe(60);
    drv.update(false, 1);
    expect(vars.get('eng1.starter')).toBe(0);
  });
});

describe('FailureManager', () => {
  it('registers, triggers, clears and counts failures through methods and events', () => {
    const vars = new SimVars();
    const events = new EventBus();
    const fm = new FailureManager(vars, { events });
    fm.register([
      { id: 'elec.gen1', name: 'Generator 1', category: 'electrical' },
      { id: 'hyd.edp_a', name: 'EDP A', category: 'hydraulic' },
    ]);
    expect(vars.get('fail.elec.gen1')).toBe(0);
    const seen: string[] = [];
    events.on('fail.activated', (id) => seen.push(String(id)));
    events.emit('fail.trigger', 'elec.gen1');
    expect(vars.get('fail.elec.gen1')).toBe(1);
    expect(fm.isActive('elec.gen1')).toBe(true);
    expect(vars.get('fail.active_count')).toBe(1);
    expect(seen).toEqual(['elec.gen1']);
    expect(fm.byCategory().get('hydraulic')?.length).toBe(1);
    events.emit('fail.clear', 'elec.gen1');
    expect(vars.get('fail.elec.gen1')).toBe(0);
    fm.trigger('hyd.edp_a');
    fm.clearAll();
    expect(fm.active()).toEqual([]);
    fm.dispose();
  });

  it('arms by time, altitude crossing, speed and window; MTBF is reproducible with a seed', () => {
    const vars = new SimVars();
    const fm = new FailureManager(vars, { seed: 42 });
    fm.register([
      { id: 'a', name: 'A', category: 'x' },
      { id: 'b', name: 'B', category: 'x' },
      { id: 'c', name: 'C', category: 'x' },
      { id: 'd', name: 'D', category: 'x' },
    ]);
    fm.arm('a', { kind: 'time', afterS: 10 });
    fm.arm('b', { kind: 'altitude', ft: 5000, direction: 'above' });
    fm.arm('c', { kind: 'speed', kt: 150, direction: 'below' });
    fm.arm('d', { kind: 'window', minS: 20, maxS: 30 });
    expect(vars.get('fail.armed_count')).toBe(4);
    vars.set(FDM.altMsl, 1000);
    vars.set(FDM.ias, 250);
    for (let i = 0; i < 9 * 60; i++) fm.update(1 / 60);
    expect(fm.isActive('a')).toBe(false);
    for (let i = 0; i < 2 * 60; i++) fm.update(1 / 60);
    expect(fm.isActive('a')).toBe(true);
    vars.set(FDM.altMsl, 6000);
    fm.update(1 / 60);
    expect(fm.isActive('b')).toBe(true);
    vars.set(FDM.ias, 140);
    fm.update(1 / 60);
    expect(fm.isActive('c')).toBe(true);
    for (let i = 0; i < 20 * 60; i++) fm.update(1 / 60);
    expect(fm.isActive('d')).toBe(true);
    expect(vars.get('fail.armed_count')).toBe(0);

    // MTBF: identical seeds give identical failure times.
    const times: number[] = [];
    for (let run = 0; run < 2; run++) {
      const v2 = new SimVars();
      const m2 = new FailureManager(v2, { seed: 7 });
      m2.register({ id: 'r', name: 'R', category: 'x' });
      m2.arm('r', { kind: 'mtbf', hours: 0.01 }); // 36 s mean
      let t = 0;
      while (!m2.isActive('r') && t < 3600) {
        m2.update(1 / 60);
        t += 1 / 60;
      }
      times.push(t);
    }
    expect(times[0]).toBeGreaterThan(0);
    expect(times[0]).toBeLessThan(600);
    expect(times[0]).toBe(times[1]);
  });
});
