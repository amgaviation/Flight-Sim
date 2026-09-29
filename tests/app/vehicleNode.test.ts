import { describe, expect, it } from 'vitest';
import { SimVars } from '../../src/core/SimVars';
import { SimLoop, type LoopScheduler } from '../../src/core/SimLoop';
import { VehicleNode } from '../../src/render/VehicleNode';

/** A point moving north at constant speed with a constant yaw rate (stands in for the FDM). */
class MovingSource {
  lat = 40;
  lon = -74;
  alt = 1000;
  psi = 0;
  readonly q = { w: 1, x: 0, y: 0, z: 0 };
  constructor(readonly speed_ms = 120, readonly yawRate_rads = 0.05) {}
  step(dt: number): void {
    this.lat += (this.speed_ms * dt) / 111_320;
    this.psi += this.yawRate_rads * dt;
    this.q.w = Math.cos(this.psi / 2);
    this.q.z = Math.sin(this.psi / 2);
  }
  getDatumPosition(out: { lat: number; lon: number; alt: number }) {
    out.lat = this.lat;
    out.lon = this.lon;
    out.alt = this.alt;
    return out;
  }
}

const manual: LoopScheduler = { now: () => 0, request: () => 0, cancel: () => undefined };

/** Runs `frames` display frames at `hz` and returns the per-frame northward displacement (m) of the drawn pose. */
function drawnSteps(hz: number, interpolate: boolean, frames = 144): number[] {
  const src = new MovingSource();
  const node = new VehicleNode();
  let alpha = 1;
  const loop = new SimLoop(new SimVars(), {
    physics: (dt) => {
      node.capture(src);
      src.step(dt);
    },
    frame: (f) => {
      alpha = f.alpha;
    },
  }, { scheduler: manual });
  const out: number[] = [];
  let last = NaN;
  for (let i = 0; i < frames; i++) {
    loop.advance(1 / hz);
    const g = node.readSource(src, interpolate ? alpha : 1);
    if (Number.isFinite(last)) out.push((g.lat - last) * 111_320);
    last = g.lat;
  }
  return out.slice(10);
}

describe('VehicleNode render interpolation', () => {
  it('draws between the pre-step and latest poses by alpha (position and attitude)', () => {
    const src = new MovingSource(100, 0.5);
    const node = new VehicleNode();
    node.capture(src);
    const lat0 = src.lat;
    src.step(1 / 120);
    const g = node.readSource(src, 0.25);
    expect(g.lat).toBeCloseTo(lat0 + 0.25 * (src.lat - lat0), 12);
    // Attitude: a quarter of the step's yaw, unit length.
    const q = node.attitude;
    expect(Math.hypot(q.w, q.x, q.y, q.z)).toBeCloseTo(1, 12);
    expect(2 * Math.atan2(q.z, q.w)).toBeCloseTo(src.psi - 0.75 * (0.5 / 120), 6);
    // alpha 1 = the latest state.
    expect(node.readSource(src, 1).lat).toBe(src.lat);
  });

  it('snaps on a teleport (reposition / slew) instead of sweeping across the map', () => {
    const src = new MovingSource();
    const node = new VehicleNode();
    node.capture(src);
    src.lat += 0.5; // 55 km
    expect(node.readSource(src, 0.3).lat).toBe(src.lat);
    node.capture(src);
    src.q.w = Math.cos(0.5);
    src.q.z = Math.sin(0.5); // 57 deg yaw in one step
    node.readSource(src, 0.3);
    expect(node.attitude.z).toBeCloseTo(Math.sin(0.5), 12);
    node.resetInterpolation();
    src.step(1 / 120);
    expect(node.readSource(src, 0.3).lat).toBe(src.lat);
  });

  it.each([75, 90, 144, 165])('%i Hz display: constant per-frame motion with interpolation, judder without', (hz) => {
    const expected = 120 / hz; // metres per frame at 120 m/s
    const raw = drawnSteps(hz, false);
    const smooth = drawnSteps(hz, true);
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    // Latest-state drawing jumps by 0/1 or 1/2 physics steps (1 m each) from frame to frame.
    expect(spread(raw)).toBeGreaterThan(0.9);
    // Interpolated: every frame moves the same distance (within 1 %).
    expect(spread(smooth)).toBeLessThan(0.01 * expected);
    for (const d of smooth) expect(d).toBeCloseTo(expected, 2);
  });
});
