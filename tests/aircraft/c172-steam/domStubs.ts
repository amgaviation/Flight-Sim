/**
 * DOM / OffscreenCanvas stubs for headless cockpit tests: the analog instruments and the
 * Bendix/King displays draw into do-nothing 2D contexts (same approach as tests/app/jetLifecycle).
 */
function fakeCanvas(w = 1, h = 1): unknown {
  const gradient = { addColorStop: () => undefined };
  const noop = (): unknown => gradient;
  const ctx: Record<string | symbol, unknown> = {};
  let canvas: Record<string, unknown> = {};
  const proxy = new Proxy(ctx, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 1 });
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
  canvas = { width: w, height: h, getContext: () => proxy, style: {}, addEventListener: () => undefined };
  return canvas;
}

export function installDomStubs(): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.document) {
    g.document = {
      createElement: (tag: string) => (tag === 'canvas' ? fakeCanvas() : { style: {}, appendChild: () => undefined, addEventListener: () => undefined, setAttribute: () => undefined }),
    };
  }
  if (!g.OffscreenCanvas) {
    g.OffscreenCanvas = function (this: unknown, w: number, h: number) {
      return fakeCanvas(w, h);
    };
  }
}
