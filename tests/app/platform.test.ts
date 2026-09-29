import { describe, expect, it } from 'vitest';
import { HttpClient, planRoutes, proxiedUrl } from '../../src/platform/http';
import { createStorage, MemoryBackend } from '../../src/platform/storage';
import type { AmgBridge } from '../../src/platform/env';

const AWC = 'https://aviationweather.gov/api/data/metar?ids=KTEB&format=json';

describe('http routing', () => {
  it('maps covered origins to the dev proxy', () => {
    expect(proxiedUrl(AWC)).toBe('/proxy/awc/api/data/metar?ids=KTEB&format=json');
    expect(proxiedUrl('https://example.com/x')).toBeNull();
    expect(proxiedUrl('https://aviationweather.gov.evil.com/x')).toBeNull();
  });

  it('plans routes per host', () => {
    expect(planRoutes(AWC, { electron: true, proxyAvailable: false })).toEqual(['electron', 'direct']);
    expect(planRoutes(AWC, { electron: false, proxyAvailable: true })).toEqual(['proxy', 'direct']);
    expect(planRoutes('./data/x.json', { electron: true, proxyAvailable: true })).toEqual(['direct']);
  });

  it('uses the Electron bridge first and falls back on failure', async () => {
    const calls: string[] = [];
    const bridge = {
      isElectron: true,
      httpGet: async (url: string) => {
        calls.push(`ipc:${url}`);
        throw new Error('offline');
      },
    } as unknown as AmgBridge;
    const fetchImpl = (async (url: string) => {
      calls.push(`fetch:${url}`);
      return new Response('[{"a":1}]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const c = new HttpClient({ bridge, fetchImpl, proxyAvailable: true });
    const r = await c.fetchJson<{ a: number }[]>(AWC);
    expect(r).toEqual([{ a: 1 }]);
    expect(calls).toEqual([`ipc:${AWC}`, 'fetch:/proxy/awc/api/data/metar?ids=KTEB&format=json']);
  });

  it('rejects non-2xx in fetchText and resolves null on an empty body', async () => {
    const mk = (status: number, body: string) => new HttpClient({ bridge: null, proxyAvailable: false, fetchImpl: (async () => new Response(body, { status })) as unknown as typeof fetch });
    await expect(mk(503, 'down').fetchText(AWC)).rejects.toThrow(/503/);
    await expect(mk(200, '').fetchJson(AWC)).resolves.toBeNull();
    const r = await mk(404, 'nope').get(AWC);
    expect(r.status).toBe(404);
    expect(r.route).toBe('direct');
  });
});

describe('storage', () => {
  it('namespaces keys, round-trips JSON and returns fallbacks', () => {
    const be = new MemoryBackend();
    const s = createStorage('settings', be);
    expect(s.get('missing', 42)).toBe(42);
    s.set('graphics', { quality: 'high', scale: 0.8 });
    expect(s.get('graphics', null)).toEqual({ quality: 'high', scale: 0.8 });
    expect(be.getItem('amgsim.settings.graphics')).toBe('{"quality":"high","scale":0.8}');
    const child = s.child('input');
    child.set('dev1', [1, 2]);
    expect(be.getItem('amgsim.settings.input.dev1')).toBe('[1,2]');
    expect(s.keys().sort()).toEqual(['graphics', 'input.dev1']);
    s.remove('graphics');
    expect(s.get('graphics', 'gone')).toBe('gone');
  });

  it('survives corrupt data and throwing backends', () => {
    const be = new MemoryBackend();
    be.setItem('amgsim.x.bad', '{not json');
    const s = createStorage('x', be);
    expect(s.get('bad', 'fallback')).toBe('fallback');
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
      key: () => null,
      length: 0,
    };
    const t = createStorage('y', throwing);
    expect(() => t.set('a', 1)).not.toThrow();
    expect(t.get('a', 7)).toBe(7);
    expect(t.keys()).toEqual([]);
  });
});
