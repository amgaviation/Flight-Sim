/**
 * A do-nothing 2D canvas for headless tests: lets the canvas-textured cockpit parts (analog standby instruments, compass, hour meter) be built in
 * node without a real canvas (copied from the Longitude cockpit tests).
 */
import type { DisplayCanvas } from '../../../src/avionics/common/CanvasDisplay';

export function fakeCanvas(width: number, height: number): DisplayCanvas {
  const noop = (): unknown => gradient;
  const gradient = { addColorStop: () => undefined };
  const ctx: Record<string | symbol, unknown> = {};
  const proxy = new Proxy(ctx, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 });
      if (k === 'getImageData' || k === 'createImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (k === 'getLineDash') return () => [];
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (k === 'canvas') return canvas;
      return noop;
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  const canvas = { width, height, getContext: () => proxy, style: {} } as unknown as DisplayCanvas;
  return canvas;
}
