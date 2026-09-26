/**
 * Low-garbage number formatting for display rendering.
 *
 * Displays redraw at up to 30 Hz and format dozens of numbers per frame.
 * `String(n)` / template literals allocate every call; these helpers keep
 * small bounded caches keyed by the rounded value so a steady display
 * allocates nothing. Caches are cleared wholesale when they grow past
 * `CACHE_LIMIT` entries (cheap, and keeps memory bounded).
 */

const CACHE_LIMIT = 4096;

class BoundedCache {
  private readonly map = new Map<number, string>();
  get(key: number): string | undefined {
    return this.map.get(key);
  }
  set(key: number, value: string): string {
    if (this.map.size >= CACHE_LIMIT) this.map.clear();
    this.map.set(key, value);
    return value;
  }
  clear(): void {
    this.map.clear();
  }
}

const intCache = new BoundedCache();
/** Rounded integer as a string ("-12", "0", "3500"). */
export function fmtInt(v: number): string {
  if (!Number.isFinite(v)) return '---';
  const n = Math.round(v);
  const hit = intCache.get(n);
  return hit !== undefined ? hit : intCache.set(n, String(n));
}

const padCaches = new Map<number, BoundedCache>();
/**
 * Rounded absolute integer zero/space padded to `width` characters
 * (e.g. fmtPad(7, 3) = "007"). Negative values get a leading '-'.
 */
export function fmtPad(v: number, width: number, padChar = '0'): string {
  if (!Number.isFinite(v)) return '-'.repeat(width);
  const n = Math.round(v);
  const key = width * 65536 + padChar.charCodeAt(0);
  let cache = padCaches.get(key);
  if (!cache) padCaches.set(key, (cache = new BoundedCache()));
  const hit = cache.get(n);
  if (hit !== undefined) return hit;
  const s = String(Math.abs(n)).padStart(width, padChar);
  return cache.set(n, n < 0 ? `-${s}` : s);
}

const fixedCaches: BoundedCache[] = [new BoundedCache(), new BoundedCache(), new BoundedCache(), new BoundedCache()];
/** Fixed-point with 0..3 decimals ("29.92", ".78" style handled by fmtMach). */
export function fmtFixed(v: number, decimals: 0 | 1 | 2 | 3): string {
  if (!Number.isFinite(v)) return '---';
  const scale = decimals === 0 ? 1 : decimals === 1 ? 10 : decimals === 2 ? 100 : 1000;
  const key = Math.round(v * scale);
  const cache = fixedCaches[decimals];
  const hit = cache.get(key);
  return hit !== undefined ? hit : cache.set(key, (key / scale).toFixed(decimals));
}

const machCache = new BoundedCache();
/** Mach number Garmin/Boeing style: ".782" (3 decimals, no leading zero). */
export function fmtMach(m: number, decimals: 2 | 3 = 3): string {
  if (!Number.isFinite(m)) return '.---';
  const scale = decimals === 3 ? 1000 : 100;
  const key = Math.round(m * scale) * 10 + decimals;
  const hit = machCache.get(key);
  if (hit !== undefined) return hit;
  const s = (Math.round(m * scale) / scale).toFixed(decimals);
  return machCache.set(key, s.startsWith('0') ? s.slice(1) : s);
}

const hdgCache = new BoundedCache();
/**
 * Heading as three digits, 001..360 (aviation convention: north is 360,
 * never 000, e.g. G1000 heading box).
 */
export function fmtHeading(deg: number, zeroIs360 = true): string {
  if (!Number.isFinite(deg)) return '---';
  let n = Math.round(deg) % 360;
  if (n < 0) n += 360;
  if (n === 0 && zeroIs360) n = 360;
  const hit = hdgCache.get(n);
  return hit !== undefined ? hit : hdgCache.set(n, String(n).padStart(3, '0'));
}

const timeCache = new BoundedCache();
/** Seconds as "MM:SS" (or "H:MM" when `hours` is true and seconds >= 3600). */
export function fmtClock(seconds: number, hours = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const s = Math.floor(seconds);
  const key = hours && s >= 3600 ? -Math.floor(s / 60) - 1 : s;
  const hit = timeCache.get(key);
  if (hit !== undefined) return hit;
  let out: string;
  if (hours && s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    out = `${h}:${String(m).padStart(2, '0')}`;
  } else {
    const m = Math.floor(s / 60);
    out = `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  return timeCache.set(key, out);
}

const baroInCache = new BoundedCache();
const baroHpaCache = new BoundedCache();
/** Altimeter setting: "29.92" (inHg, 2 decimals) or "1013" (hPa). */
export function fmtBaro(inHg: number, unit: 'inhg' | 'hpa'): string {
  if (unit === 'inhg') {
    const key = Math.round(inHg * 100);
    const hit = baroInCache.get(key);
    return hit !== undefined ? hit : baroInCache.set(key, (key / 100).toFixed(2));
  }
  // 1 inHg = 33.8639 hPa (NIST SP 811: 3386.389 Pa).
  const hpa = Math.round(inHg * 33.86389);
  const hit = baroHpaCache.get(hpa);
  return hit !== undefined ? hit : baroHpaCache.set(hpa, String(hpa));
}

/** Clears every cache (tests / memory pressure). */
export function clearFormatCaches(): void {
  for (const c of [intCache, machCache, hdgCache, timeCache, baroInCache, baroHpaCache, ...fixedCaches]) c.clear();
  padCaches.clear();
}
