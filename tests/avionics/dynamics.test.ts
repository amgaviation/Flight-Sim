import { describe, expect, it } from 'vitest';
import { Flasher, NeedleDynamics, RateEstimator, blinkOn } from '../../src/avionics/common/dynamics';

function run(n: NeedleDynamics, target: number, seconds: number, dt = 1 / 60): number[] {
  const trace: number[] = [];
  for (let t = 0; t < seconds; t += dt) trace.push(n.update(target, dt));
  return trace;
}

describe('NeedleDynamics', () => {
  it('settles on the target', () => {
    const n = new NeedleDynamics({ omega: 10, zeta: 0.75 });
    run(n, 100, 2);
    expect(n.value).toBeCloseTo(100, 2);
    expect(Math.abs(n.rate)).toBeLessThan(0.1);
  });

  it('overshoots slightly for zeta < 1 and not at all for zeta >= 1', () => {
    const under = run(new NeedleDynamics({ omega: 10, zeta: 0.6 }), 100, 2);
    const crit = run(new NeedleDynamics({ omega: 10, zeta: 1 }), 100, 2);
    const peakU = Math.max(...under);
    // Second-order overshoot exp(-zeta pi / sqrt(1 - zeta^2)) = 9.5 % at zeta 0.6.
    expect(peakU).toBeGreaterThan(105);
    expect(peakU).toBeLessThan(112);
    expect(Math.max(...crit)).toBeLessThanOrEqual(100.0001);
  });

  it('respects the mechanical stops with a small bounce', () => {
    const n = new NeedleDynamics({ omega: 12, zeta: 0.5, min: 0, max: 50, restitution: 0.3 });
    const tr = run(n, 80, 1);
    expect(Math.max(...tr)).toBeLessThanOrEqual(50);
    expect(n.value).toBe(50);
  });

  it('chases the short way round on circular scales', () => {
    const n = new NeedleDynamics({ omega: 6, zeta: 1, circular: true, initial: 350 });
    const tr = run(n, 10, 0.2);
    // Must pass through 0/360, never through 180.
    for (const v of tr) expect(v > 300 || v < 20).toBe(true);
    run(n, 10, 3);
    expect(n.value).toBeCloseTo(10, 1);
  });

  it('is stable through a long frame hitch', () => {
    const n = new NeedleDynamics({ omega: 15, zeta: 0.7 });
    n.update(100, 0.5);
    n.update(100, 1.0);
    expect(Number.isFinite(n.value)).toBe(true);
    expect(Math.abs(n.value - 100)).toBeLessThan(5);
  });

  it('honours the rate limit', () => {
    const n = new NeedleDynamics({ omega: 30, zeta: 1, maxRate: 20 });
    n.update(1000, 0.5);
    expect(n.value).toBeLessThanOrEqual(10.0001);
  });
});

describe('RateEstimator', () => {
  it('measures a ramp slope after the filter settles', () => {
    const r = new RateEstimator(0.5);
    let v = 0;
    for (let i = 0; i < 300; i++) {
      v += 3 / 60; // 3 units/s
      r.update(v, 1 / 60);
    }
    expect(r.rate).toBeCloseTo(3, 3);
  });

  it('differentiates headings across north', () => {
    const r = new RateEstimator(0.3);
    let h = 350;
    for (let i = 0; i < 300; i++) {
      h = (h + 3 / 60) % 360;
      r.updateAngle(h, 1 / 60);
    }
    expect(r.rate).toBeCloseTo(3, 2);
  });
});

describe('blinking', () => {
  it('blinkOn alternates at the requested rate', () => {
    expect(blinkOn(0, 1)).toBe(true);
    expect(blinkOn(0.6, 1)).toBe(false);
    expect(blinkOn(1.1, 1)).toBe(true);
  });

  it('Flasher runs for its duration then stays visible', () => {
    const f = new Flasher(1, 2);
    f.trigger();
    expect(f.active).toBe(true);
    let dark = false;
    for (let i = 0; i < 30; i++) {
      f.update(1 / 60);
      if (!f.visible) dark = true;
    }
    expect(dark).toBe(true);
    for (let i = 0; i < 60; i++) f.update(1 / 60);
    expect(f.active).toBe(false);
    expect(f.visible).toBe(true);
  });
});
