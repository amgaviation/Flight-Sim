import { describe, expect, it } from 'vitest';
import { SimVars } from '../../src/core/SimVars';
import { EventBus } from '../../src/core/EventBus';
import { ManualScheduler, SimLoop } from '../../src/core/SimLoop';
import { SIM } from '../../src/core/vars';

function makeLoop(opts: { maxSubsteps?: number } = {}) {
  const vars = new SimVars();
  const events = new EventBus();
  const scheduler = new ManualScheduler();
  const log: string[] = [];
  const counts = { input: 0, systems: 0, physics: 0, nav: 0, frame: 0 };
  const loop = new SimLoop(
    vars,
    {
      input: () => {
        counts.input++;
      },
      systems: (dt) => {
        counts.systems++;
        expect(dt).toBeCloseTo(1 / 60, 12);
        log.push('S');
      },
      physics: (dt) => {
        counts.physics++;
        expect(dt).toBeCloseTo(1 / 120, 12);
        log.push('P');
      },
      nav: (dt) => {
        counts.nav++;
        expect(dt).toBeCloseTo(1 / 20, 12);
        log.push('N');
      },
      frame: () => {
        counts.frame++;
      },
    },
    { scheduler, events, maxSubsteps: opts.maxSubsteps },
  );
  return { vars, events, scheduler, loop, counts, log };
}

describe('SimLoop', () => {
  it('runs 120 physics, 60 systems and 20 nav steps per simulated second at 1x', () => {
    const { loop, counts, vars } = makeLoop();
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(counts.physics).toBe(120);
    expect(counts.systems).toBe(60);
    expect(counts.nav).toBe(20);
    expect(counts.frame).toBe(60);
    expect(counts.input).toBe(60);
    expect(vars.get(SIM.timeS)).toBeCloseTo(1.0, 9);
    expect(vars.get(SIM.frameMs)).toBeCloseTo(1000 / 60, 6);
  });

  it('orders systems before physics on even steps and nav after physics every 6th step', () => {
    const { loop, log } = makeLoop();
    for (let i = 0; i < 6; i++) loop.stepOnce();
    expect(log.join('')).toBe('SPNPSPPSPP');
  });

  it('accumulates fractional frames without losing time', () => {
    const { loop, counts } = makeLoop();
    // 144 Hz monitor for 1 s: steps must still total 120.
    for (let i = 0; i < 144; i++) loop.advance(1 / 144);
    expect(counts.physics).toBe(120);
  });

  it('scales with sim rate and clamps it to 1..16', () => {
    const { loop, counts, vars } = makeLoop({ maxSubsteps: 1000 });
    loop.setRate(4);
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(counts.physics).toBe(480);
    loop.setRate(100);
    expect(vars.get(SIM.rate)).toBe(16);
    loop.setRate(0.1);
    expect(vars.get(SIM.rate)).toBe(1);
  });

  it('caps substeps per frame and drops the excess (no spiral of death)', () => {
    const { loop, counts } = makeLoop({ maxSubsteps: 10 });
    loop.setRate(16);
    const steps = loop.advance(0.1); // wants 192 steps
    expect(steps).toBe(10);
    expect(counts.physics).toBe(10);
    expect(loop.droppedTime_s).toBeGreaterThan(1.5);
  });

  it('clamps huge real frame times (tab switch)', () => {
    const { loop, counts } = makeLoop();
    loop.advance(5); // clamped to 0.25 s -> 30 steps
    expect(counts.physics).toBe(30);
  });

  it('pause stops fixed-rate callbacks but frames continue; sim.step single-steps', () => {
    const { loop, counts, events } = makeLoop();
    events.emit('sim.pause_toggle');
    expect(loop.paused).toBe(true);
    for (let i = 0; i < 30; i++) loop.advance(1 / 60);
    expect(counts.physics).toBe(0);
    expect(counts.frame).toBe(30);
    events.emit('sim.step');
    loop.advance(1 / 60);
    expect(counts.physics).toBe(1);
    events.emit('sim.pause_set', false);
    loop.advance(1 / 60);
    expect(counts.physics).toBe(3);
  });

  it('rate events step through 1,2,4,8,16', () => {
    const { loop, events } = makeLoop();
    events.emit('sim.rate_inc');
    expect(loop.rate).toBe(2);
    events.emit('sim.rate_inc');
    events.emit('sim.rate_inc');
    events.emit('sim.rate_inc');
    events.emit('sim.rate_inc');
    expect(loop.rate).toBe(16);
    events.emit('sim.rate_dec');
    expect(loop.rate).toBe(8);
    events.emit('sim.rate_set', 3);
    events.emit('sim.rate_dec');
    expect(loop.rate).toBe(2);
  });

  it('drives itself from an injected scheduler', () => {
    const { loop, scheduler, counts } = makeLoop();
    loop.start();
    expect(loop.running).toBe(true);
    scheduler.tick(0); // first frame only records the timestamp
    for (let i = 0; i < 120; i++) scheduler.tick(1000 / 120);
    expect(counts.physics).toBe(120);
    loop.stop();
    expect(loop.running).toBe(false);
    expect(scheduler.tick(10)).toBe(false);
  });
});
