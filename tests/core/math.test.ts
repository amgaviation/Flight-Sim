import { describe, expect, it } from 'vitest';
import {
  FirstOrderLag,
  Prng,
  RateLimiter,
  SecondOrderFilter,
  approach,
  clamp,
  findSegment,
  interp1,
  interp2,
  lerp,
  smoothstep,
  table1,
  table2,
  wrap180,
  wrap360,
} from '../../src/core/math';
import { Mat3, Quat, Vec3 } from '../../src/core/linalg';
import * as U from '../../src/core/units';

describe('scalar helpers', () => {
  it('clamp / lerp / smoothstep / approach', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(lerp(2, 4, 0.25)).toBe(2.5);
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5, 12);
    expect(smoothstep(0, 10, 20)).toBe(1);
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(0, -10, 3)).toBe(-3);
    expect(approach(9, 10, 3)).toBe(10);
  });

  it('angle wrapping', () => {
    expect(wrap360(-10)).toBe(350);
    expect(wrap360(720)).toBe(0);
    expect(wrap360(359.5)).toBe(359.5);
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-190)).toBe(170);
    expect(wrap180(180)).toBe(-180);
    expect(wrap180(0)).toBe(0);
  });
});

describe('table interpolation', () => {
  const t1 = table1([0, 1, 3, 10], [0, 10, 30, 100]);
  it('interp1 interior, knots and clamped ends', () => {
    expect(interp1(t1, 0.5)).toBeCloseTo(5, 12);
    expect(interp1(t1, 2)).toBeCloseTo(20, 12);
    expect(interp1(t1, 3)).toBeCloseTo(30, 12);
    expect(interp1(t1, 6.5)).toBeCloseTo(65, 12);
    expect(interp1(t1, -5)).toBe(0);
    expect(interp1(t1, 50)).toBe(100);
    expect(interp1({ x: [1], y: [7] }, 99)).toBe(7);
  });

  it('findSegment binary search', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = 0; i < 8; i++) expect(findSegment(xs, i + 0.5)).toBe(i);
    expect(findSegment(xs, -1)).toBe(0);
    expect(findSegment(xs, 100)).toBe(7);
  });

  it('interp2 bilinear with clamping', () => {
    const t2 = table2([0, 10], [0, 100, 200], [
      [0, 1, 2],
      [10, 11, 12],
    ]);
    expect(interp2(t2, 5, 50)).toBeCloseTo(5.5, 12);
    expect(interp2(t2, 0, 150)).toBeCloseTo(1.5, 12);
    expect(interp2(t2, 20, 250)).toBe(12);
    expect(interp2(t2, -1, -1)).toBe(0);
  });

  it('validates tables', () => {
    expect(() => table1([0, 0], [1, 2])).toThrow();
    expect(() => table2([0, 1], [0], [[1]])).toThrow();
  });
});

describe('filters', () => {
  it('first-order lag reaches 63% after one time constant regardless of dt', () => {
    for (const dt of [0.001, 1 / 120, 0.1]) {
      const f = new FirstOrderLag(1, 0);
      const n = Math.round(1 / dt);
      for (let i = 0; i < n; i++) f.update(1, dt);
      expect(f.value).toBeCloseTo(1 - Math.exp(-1), 6);
    }
  });

  it('rate limiter limits slew', () => {
    const r = new RateLimiter(2, 4, 0);
    r.update(10, 1);
    expect(r.value).toBe(2);
    r.update(-10, 1);
    expect(r.value).toBe(-2);
    r.update(-2.5, 1);
    expect(r.value).toBe(-2.5);
  });

  it('second-order filter settles on the input', () => {
    const f = new SecondOrderFilter(10, 1, 0);
    for (let i = 0; i < 600; i++) f.update(3, 1 / 120);
    expect(f.value).toBeCloseTo(3, 4);
  });
});

describe('Prng', () => {
  it('is deterministic per seed and uniform-ish', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const c = new Prng(43);
    let same = true;
    let diff = false;
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const x = a.next();
      const y = b.next();
      const z = c.next();
      if (x !== y) same = false;
      if (x !== z) diff = true;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(same).toBe(true);
    expect(diff).toBe(true);
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });

  it('gaussian has unit variance', () => {
    const p = new Prng(7);
    let s = 0;
    let s2 = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) {
      const g = p.gaussian();
      s += g;
      s2 += g * g;
    }
    expect(s / n).toBeCloseTo(0, 1);
    expect(s2 / n).toBeGreaterThan(0.97);
    expect(s2 / n).toBeLessThan(1.03);
  });
});

describe('linalg', () => {
  it('quaternion Euler round trip and rotation', () => {
    const q = new Quat().setFromEuler(1.0, 0.3, -0.5);
    expect(q.getPsi()).toBeCloseTo(1.0, 12);
    expect(q.getTheta()).toBeCloseTo(0.3, 12);
    expect(q.getPhi()).toBeCloseTo(-0.5, 12);
    // Heading 90 deg: body x points east in NED.
    const h = new Quat().setFromEuler(Math.PI / 2, 0, 0);
    const v = h.rotate(new Vec3(1, 0, 0), new Vec3());
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(1, 12);
    const back = h.rotateInverse(v, new Vec3());
    expect(back.x).toBeCloseTo(1, 12);
    // Pitch up 30 deg: body x has negative down component.
    const p = new Quat().setFromEuler(0, Math.PI / 6, 0).rotate(new Vec3(1, 0, 0), new Vec3());
    expect(p.z).toBeCloseTo(-0.5, 12);
  });

  it('integrating a constant body rate matches the analytic rotation', () => {
    const q = new Quat();
    const w = new Vec3(0, 0, 0.5); // yaw 0.5 rad/s
    for (let i = 0; i < 240; i++) q.integrateBodyRate(w, 1 / 120);
    expect(q.getPsi()).toBeCloseTo(1.0, 10);
  });

  it('matrix inverse and quaternion matrix agree', () => {
    const q = new Quat().setFromEuler(0.7, -0.2, 0.4);
    const m = q.toMatrix(new Mat3());
    const v = new Vec3(1, 2, 3);
    const a = m.mulVec(v, new Vec3());
    const b = q.rotate(v, new Vec3());
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);
    expect(a.z).toBeCloseTo(b.z, 12);
    const inv = new Mat3();
    const j = new Mat3().set(2, 0, -0.3, 0, 5, 0, -0.3, 0, 7);
    expect(inv.invertFrom(j)).toBe(true);
    const r = inv.mulVec(j.mulVec(v, new Vec3()), new Vec3());
    expect(r.x).toBeCloseTo(1, 12);
    expect(r.y).toBeCloseTo(2, 12);
    expect(r.z).toBeCloseTo(3, 12);
  });
});

describe('units', () => {
  it('exact definitions', () => {
    expect(U.FT_TO_M).toBe(0.3048);
    expect(U.KT_TO_MS * 3600).toBeCloseTo(1852, 9);
    expect(29.92 * U.INHG_TO_PA).toBeCloseTo(101320.8, 0);
    expect(U.LBF_TO_N).toBeCloseTo(4.4482216152605, 12);
    expect(U.cToF(100)).toBeCloseTo(212, 12);
    expect(U.fToC(32)).toBeCloseTo(0, 12);
    expect(U.AVGAS_KG_PER_L).toBeCloseTo(0.719, 3);
    expect(U.JETA_KG_PER_L).toBeCloseTo(0.803, 3);
    expect(180 * U.HP_TO_W).toBeCloseTo(134226, 0);
  });
});
