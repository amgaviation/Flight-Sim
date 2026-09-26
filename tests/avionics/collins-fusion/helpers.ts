/**
 * Test helpers for the Pro Line Fusion suite: a no-op 2D canvas (displays
 * are constructed and drawn in Node) and a suite factory.
 */
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import type { DisplayCanvas } from '../../../src/avionics/common/CanvasDisplay';
import { createFusionSuite, type FusionSuite } from '../../../src/avionics/collins-fusion/suite';
import { BR710A2_20_ENGINES, GLOBAL6000_AIRFRAME, type FusionSuiteConfig } from '../../../src/avionics/collins-fusion/config';
import type { Fms } from '../../../src/nav/fms/Fms';
import type { NavDatabase } from '../../../src/nav/types';

/** Draw call counters (tests assert that something was drawn). */
export const drawStats = { fillText: 0, stroke: 0, fill: 0 };

function fakeContext(canvas: unknown): unknown {
  const grad = { addColorStop() {} };
  const state: Record<string | symbol, unknown> = {
    canvas,
    font: '10px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    imageSmoothingEnabled: true,
    measureText: (s: string) => ({ width: String(s).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createConicGradient: () => grad,
    createPattern: () => ({}),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    getLineDash: () => [],
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
    fillText: () => void drawStats.fillText++,
    stroke: () => void drawStats.stroke++,
    fill: () => void drawStats.fill++,
  };
  return new Proxy(state, {
    get(t, p) {
      if (p in t) return t[p];
      return () => undefined;
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
}

/** A canvas stand-in with a no-op 2D context. */
export function fakeCanvas(): DisplayCanvas {
  const c: Record<string, unknown> = { width: 1, height: 1 };
  const ctx = fakeContext(c);
  c.getContext = () => ctx;
  c.toDataURL = () => '';
  return c as unknown as DisplayCanvas;
}

export interface TestSuite {
  vars: SimVars;
  events: EventBus;
  suite: FusionSuite;
}

export function makeSuite(extra: Partial<FusionSuiteConfig> = {}, fms: Fms | null = null, nav: NavDatabase | null = null, vars = new SimVars(), events = new EventBus()): TestSuite {
  const suite = createFusionSuite({ vars, events, fms, nav, world: null, canvas: fakeCanvas }, { airframe: GLOBAL6000_AIRFRAME, engines: BR710A2_20_ENGINES, ...extra });
  return { vars, events, suite };
}

/** Runs the suite system for `seconds`. */
export function run(t: TestSuite, seconds: number, dt = 0.05): void {
  for (let s = 0; s < seconds - 1e-9; s += dt) t.suite.system.update(dt);
}

/** Renders every display once (fills the AFD hot spot lists). */
export function render(t: TestSuite, dt = 1 / 30): void {
  for (const d of t.suite.displays) d.render(dt);
}

/** Records every emitted event (name, payload) of a bus. */
export function recordEvents(events: EventBus): { name: string; payload: unknown }[] {
  const log: { name: string; payload: unknown }[] = [];
  events.onAny((name, payload) => log.push({ name, payload }));
  return log;
}
