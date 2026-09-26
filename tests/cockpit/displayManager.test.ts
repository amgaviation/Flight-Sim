import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../src/core/SimVars';
import { DisplayManager, RefreshScheduler, type ScheduleEntry } from '../../src/cockpit/DisplayManager';
import type { CockpitDisplay } from '../../src/cockpit/types';

class FakeDisplay implements CockpitDisplay {
  readonly canvas = { width: 256, height: 128 } as unknown as HTMLCanvasElement;
  readonly width = 256;
  readonly height = 128;
  renders = 0;
  dts: number[] = [];
  changed = true;
  brightness: number[] = [];
  constructor(
    readonly id: string,
    readonly refreshHz: number,
  ) {}
  render(dt: number): boolean {
    this.renders++;
    this.dts.push(dt);
    return this.changed;
  }
  setBrightness(b: number): void {
    this.brightness.push(b);
  }
}

function frames(dm: DisplayManager, n: number, dt = 1 / 60): void {
  for (let i = 0; i < n; i++) dm.update(dt);
}

describe('RefreshScheduler', () => {
  it('renders each entry at its rate on average', () => {
    const s = new RefreshScheduler();
    const a = s.add('a', 30);
    const b = s.add('b', 10);
    const out: ScheduleEntry[] = [];
    const dts: number[] = [];
    const count = { a: 0, b: 0 };
    for (let i = 0; i < 600; i++) {
      const n = s.tick(1 / 60, 10, out, dts);
      for (let k = 0; k < n; k++) count[out[k].id as 'a' | 'b']++;
    }
    // 10 s of frames.
    expect(count.a).toBeGreaterThanOrEqual(299);
    expect(count.a).toBeLessThanOrEqual(302);
    expect(count.b).toBeGreaterThanOrEqual(99);
    expect(count.b).toBeLessThanOrEqual(102);
    expect(a.interval).toBeCloseTo(1 / 30, 9);
    expect(b.paused).toBe(false);
  });

  it('respects the per-frame budget, serving the most overdue first', () => {
    const s = new RefreshScheduler();
    for (let i = 0; i < 6; i++) s.add(`d${i}`, 60);
    const out: ScheduleEntry[] = [];
    const dts: number[] = [];
    // First tick: all forced, budget 2.
    expect(s.tick(1 / 60, 2, out, dts)).toBe(2);
    let served = 2;
    for (let i = 0; i < 10; i++) served += s.tick(1 / 60, 2, out, dts);
    expect(served).toBe(22);
    // Every display got served at least once in 11 frames.
    const counts = new Map<string, number>();
    for (let i = 0; i < 60; i++) {
      const n = s.tick(1 / 60, 2, out, dts);
      for (let k = 0; k < n; k++) counts.set(out[k].id, (counts.get(out[k].id) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
  });

  it('passes the elapsed time since the previous render', () => {
    const s = new RefreshScheduler();
    const e = s.add('x', 10);
    const out: ScheduleEntry[] = [];
    const dts: number[] = [];
    s.tick(0.01, 5, out, dts); // forced first render
    e.acc = 0;
    let got = 0;
    for (let i = 0; i < 20 && !got; i++) {
      if (s.tick(0.02, 5, out, dts)) got = dts[0];
    }
    expect(got).toBeCloseTo(0.1, 6);
  });

  it('skips paused entries', () => {
    const s = new RefreshScheduler();
    const e = s.add('x', 30);
    e.paused = true;
    const out: ScheduleEntry[] = [];
    expect(s.tick(1, 5, out, [])).toBe(0);
  });
});

describe('DisplayManager', () => {
  it('throttles renders to refreshHz and uploads only when render() returns true', () => {
    const vars = new SimVars();
    const dm = new DisplayManager(vars);
    const d = new FakeDisplay('pfd', 20);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    const h = dm.add(d, mesh);
    frames(dm, 120); // 2 s at 60 fps
    expect(d.renders).toBeGreaterThanOrEqual(39);
    expect(d.renders).toBeLessThanOrEqual(42);
    const v0 = h.texture.version;
    d.changed = false;
    frames(dm, 60);
    expect(h.texture.version).toBe(v0);
    expect(dm.stats.skipped).toBeGreaterThan(0);
    d.changed = true;
    frames(dm, 6);
    expect(h.texture.version).toBeGreaterThan(v0);
    expect(mesh.material).toBe(h.material);
    expect(h.texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('blacks out and stops rendering when unpowered; brightness goes to setBrightness (self-dimming display)', () => {
    const vars = new SimVars();
    const dm = new DisplayManager(vars);
    const d = new FakeDisplay('mfd', 30);
    const h = dm.add(d, new THREE.Mesh(new THREE.PlaneGeometry(1, 1)));
    vars.set('display.mfd.power', 0);
    frames(dm, 30);
    expect(d.renders).toBe(0);
    expect(h.material.color.r).toBe(0);
    expect(vars.get('display.mfd.ready')).toBe(0);
    vars.set('display.mfd.power', 1);
    vars.set('display.mfd.brt', 0.5);
    frames(dm, 30);
    expect(d.renders).toBeGreaterThan(10);
    // The display dims itself (it implements setBrightness): material stays at full scale.
    expect(h.material.color.r).toBeCloseTo(1, 6);
    expect(d.brightness.at(-1)).toBe(0.5);
    expect(vars.get('display.mfd.ready')).toBe(1);
  });

  it('dims the screen material for displays without setBrightness (or when dimMaterial is set)', () => {
    const vars = new SimVars();
    const dm = new DisplayManager(vars);
    const plain: CockpitDisplay = { id: 'eicas', canvas: {} as HTMLCanvasElement, width: 64, height: 64, refreshHz: 10, render: () => true };
    const h = dm.add(plain, new THREE.Mesh(new THREE.PlaneGeometry(1, 1)));
    const d2 = new FakeDisplay('cdu', 10);
    const h2 = dm.add(d2, new THREE.Mesh(new THREE.PlaneGeometry(1, 1)), { dimMaterial: true, gain: 0.8 });
    vars.set('display.eicas.brt', 0.25);
    vars.set('display.cdu.brt', 0.5);
    frames(dm, 3);
    expect(h.material.color.r).toBeCloseTo(0.25, 6);
    expect(h2.material.color.r).toBeCloseTo(0.4, 6);
  });

  it('holds a boot splash for N seconds after power-up before rendering', () => {
    const vars = new SimVars();
    const dm = new DisplayManager(vars);
    const d = new FakeDisplay('gdu', 30);
    const h = dm.add(d, new THREE.Mesh(new THREE.PlaneGeometry(1, 1)), { boot: { seconds: 2 } });
    frames(dm, 60); // 1 s
    expect(h.booting).toBe(true);
    expect(d.renders).toBe(0);
    expect(vars.get('display.gdu.ready')).toBe(0);
    frames(dm, 70); // past 2 s
    expect(h.booting).toBe(false);
    expect(vars.get('display.gdu.ready')).toBe(1);
    expect(d.renders).toBeGreaterThan(0);
    // Power cycle restarts the boot.
    vars.set('display.gdu.power', 0);
    frames(dm, 2);
    vars.set('display.gdu.power', 1);
    const before = d.renders;
    frames(dm, 30);
    expect(d.renders).toBe(before);
    expect(h.booting).toBe(true);
  });

  it('limits renders per frame and rejects duplicate ids', () => {
    const vars = new SimVars();
    const dm = new DisplayManager(vars, { maxRendersPerFrame: 2 });
    const ds = [0, 1, 2, 3, 4].map((i) => new FakeDisplay(`d${i}`, 60));
    for (const d of ds) dm.add(d, new THREE.Mesh(new THREE.PlaneGeometry(1, 1)));
    dm.update(1 / 60);
    expect(ds.reduce((a, d) => a + d.renders, 0)).toBe(2);
    expect(() => dm.add(new FakeDisplay('d0', 10), new THREE.Mesh())).toThrow();
    dm.remove('d0');
    expect(dm.get('d0')).toBeUndefined();
  });
});
