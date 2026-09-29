/**
 * HTTP access for the few runtime network features (live METARs).
 *
 * aviationweather.gov sends no CORS headers, so a browser page cannot fetch
 * it directly. Requests are routed, in order:
 *
 *   1. Electron: the main process fetches through IPC (`window.amg.httpGet`,
 *      host allow-list in `electron/main.cjs`).
 *   2. Vite dev server / `vite preview`: the same-origin proxy prefix from
 *      `vite.config.ts` (`/proxy/awc` -> https://aviationweather.gov).
 *   3. Direct `fetch` (works for CORS-enabled hosts; last resort).
 *
 * The first route that produces an HTTP response wins; a network error or a
 * timeout falls through to the next route. Terrain tiles do NOT go through
 * this module (the world's workers fetch them directly; S3 is CORS-enabled).
 */
import { getBridge, isDevServer, type AmgBridge } from './env';

export interface HttpRequestOptions {
  /** Abort after this many ms (default 12,000). */
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Restrict the routes tried (default all applicable, in order). */
  routes?: HttpRoute[];
}

export type HttpRoute = 'electron' | 'proxy' | 'direct';

export interface HttpResponse {
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
  /** Route that produced the response. */
  route: HttpRoute;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(message: string, url: string, status = 0) {
    super(message);
    this.name = 'HttpError';
    this.url = url;
    this.status = status;
  }
}

/** Same-origin proxy prefixes served by the Vite dev/preview server (vite.config.ts). */
export const DEFAULT_PROXIES: Readonly<Record<string, string>> = {
  'https://aviationweather.gov': '/proxy/awc',
};

export interface HttpClientOptions {
  fetchImpl?: typeof fetch;
  /** Electron bridge (default: `window.amg`). `null` disables the IPC route. */
  bridge?: AmgBridge | null;
  /** Whether same-origin proxies exist (default: the Vite dev server is running). */
  proxyAvailable?: boolean;
  proxies?: Readonly<Record<string, string>>;
}

/** Proxy URL for `url` when a proxy prefix covers its origin, else null. Pure. */
export function proxiedUrl(url: string, proxies: Readonly<Record<string, string>> = DEFAULT_PROXIES): string | null {
  for (const origin of Object.keys(proxies)) {
    if (url === origin || url.startsWith(`${origin}/`) || url.startsWith(`${origin}?`)) {
      return proxies[origin] + url.slice(origin.length);
    }
  }
  return null;
}

/** Routes applicable to a URL in the given host, in order of preference. Pure. */
export function planRoutes(url: string, env: { electron: boolean; proxyAvailable: boolean; proxies?: Readonly<Record<string, string>> }): HttpRoute[] {
  const routes: HttpRoute[] = [];
  const absolute = /^https?:\/\//i.test(url);
  if (env.electron && absolute) routes.push('electron');
  if (env.proxyAvailable && absolute && proxiedUrl(url, env.proxies) !== null) routes.push('proxy');
  routes.push('direct');
  return routes;
}

export class HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly bridge: AmgBridge | null;
  private readonly proxyAvailable: boolean;
  private readonly proxies: Readonly<Record<string, string>>;

  constructor(o: HttpClientOptions = {}) {
    this.fetchImpl = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.bridge = o.bridge === undefined ? getBridge() : o.bridge;
    this.proxyAvailable = o.proxyAvailable ?? isDevServer();
    this.proxies = o.proxies ?? DEFAULT_PROXIES;
  }

  /** GET `url`; resolves with the first HTTP response (any status). Rejects only when every route fails. */
  async get(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
    const timeoutMs = opts.timeoutMs ?? 12_000;
    let routes = planRoutes(url, { electron: this.bridge !== null, proxyAvailable: this.proxyAvailable, proxies: this.proxies });
    if (opts.routes) routes = routes.filter((r) => opts.routes!.includes(r));
    let lastErr: unknown = null;
    for (const route of routes) {
      try {
        if (route === 'electron' && this.bridge) {
          const r = await withTimeout(this.bridge.httpGet(url, { timeoutMs, headers: opts.headers }), timeoutMs + 1000, url);
          return { ok: r.ok, status: r.status, contentType: r.contentType, text: r.body, route };
        }
        const target = route === 'proxy' ? proxiedUrl(url, this.proxies)! : url;
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = setTimeout(() => ctl?.abort(), timeoutMs);
        try {
          const res = await this.fetchImpl(target, { headers: opts.headers, signal: ctl?.signal, cache: 'no-store' });
          const text = await res.text();
          return { ok: res.ok, status: res.status, contentType: res.headers.get('content-type') ?? '', text, route };
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        lastErr = e;
      }
    }
    throw new HttpError(`Request failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, url);
  }

  /** GET and return the body; rejects on non-2xx. */
  async fetchText(url: string, opts?: HttpRequestOptions): Promise<string> {
    const r = await this.get(url, opts);
    if (!r.ok) throw new HttpError(`HTTP ${r.status} for ${url}`, url, r.status);
    return r.text;
  }

  /** GET and parse JSON; rejects on non-2xx or invalid JSON. An empty 2xx body (e.g. HTTP 204) resolves `null`. */
  async fetchJson<T = unknown>(url: string, opts?: HttpRequestOptions): Promise<T | null> {
    const text = await this.fetchText(url, opts);
    if (text.trim() === '') return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(`Invalid JSON from ${url}`, url);
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new HttpError(`Timeout after ${ms} ms`, url)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

let defaultClient: HttpClient | null = null;

/** Shared client for the running host (created lazily so tests can run without `window`). */
export function http(): HttpClient {
  return (defaultClient ??= new HttpClient());
}

export function fetchText(url: string, opts?: HttpRequestOptions): Promise<string> {
  return http().fetchText(url, opts);
}

export function fetchJson<T = unknown>(url: string, opts?: HttpRequestOptions): Promise<T | null> {
  return http().fetchJson<T>(url, opts);
}
