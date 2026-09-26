/**
 * Cached formatters for G3000 / G5000 text (frequencies, times, lat/lon,
 * altitudes with units). Every function returns strings from bounded caches
 * so a steady display allocates nothing (docs/modules/avionics-common.md §5).
 */

const LIMIT = 4096;

class Cache<K> {
  private readonly m = new Map<K, string>();
  get(k: K): string | undefined {
    return this.m.get(k);
  }
  set(k: K, v: string): string {
    if (this.m.size >= LIMIT) this.m.clear();
    this.m.set(k, v);
    return v;
  }
}

const comCache = new Cache<number>();
/** VHF COM frequency: 25 kHz spacing "118.25" (2 decimals) or 8.33 kHz channel "118.255" (3 decimals). */
export function fmtCom(mhz: number, three = false): string {
  if (!Number.isFinite(mhz) || mhz <= 0) return '---.--';
  const k = Math.round(mhz * 1000) * 2 + (three ? 1 : 0);
  const hit = comCache.get(k);
  if (hit !== undefined) return hit;
  return comCache.set(k, (Math.round(mhz * 1000) / 1000).toFixed(three ? 3 : 2));
}

const navCache = new Cache<number>();
/** VHF NAV frequency "110.90". */
export function fmtNav(mhz: number): string {
  if (!Number.isFinite(mhz) || mhz <= 0) return '---.--';
  const k = Math.round(mhz * 100);
  const hit = navCache.get(k);
  return hit !== undefined ? hit : navCache.set(k, (k / 100).toFixed(2));
}

const adfCache = new Cache<number>();
/** ADF frequency (kHz) "1799.5". */
export function fmtAdf(khz: number): string {
  if (!Number.isFinite(khz) || khz <= 0) return '----.-';
  const k = Math.round(khz * 10);
  const hit = adfCache.get(k);
  return hit !== undefined ? hit : adfCache.set(k, (k / 10).toFixed(1));
}

const xpdrCache = new Cache<number>();
/** Transponder code as four octal digits "1200". */
export function fmtSquawk(code: number): string {
  const c = Math.max(0, Math.min(7777, Math.round(code)));
  const hit = xpdrCache.get(c);
  return hit !== undefined ? hit : xpdrCache.set(c, String(c).padStart(4, '0'));
}

const hmsCache = new Cache<number>();
/** Seconds as "H:MM:SS" (timer, ETE > 1 h) or "MM:SS". Negative -> "-MM:SS". */
export function fmtHms(seconds: number, alwaysHours = false): string {
  if (!Number.isFinite(seconds)) return '__:__';
  const s = Math.round(seconds);
  const k = s * 2 + (alwaysHours ? 1 : 0);
  const hit = hmsCache.get(k);
  if (hit !== undefined) return hit;
  const a = Math.abs(s);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const ss = a % 60;
  const mm = String(m).padStart(2, '0');
  const sss = String(ss).padStart(2, '0');
  const body = h > 0 || alwaysHours ? `${h}:${mm}:${sss}` : `${mm}:${sss}`;
  return hmsCache.set(k, s < 0 ? `-${body}` : body);
}

const hmCache = new Cache<number>();
/** Hours (0..24) of day as "HH:MM" (UTC clock). */
export function fmtClockH(hours: number): string {
  if (!Number.isFinite(hours)) return '__:__';
  let mins = Math.floor((((hours % 24) + 24) % 24) * 60 + 1e-6);
  if (mins >= 1440) mins -= 1440;
  const hit = hmCache.get(mins);
  if (hit !== undefined) return hit;
  return hmCache.set(mins, `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
}

const hmsClockCache = new Cache<number>();
/** Hours of day as "HH:MM:SS" (UTC readout on the PFD). */
export function fmtClockHms(hours: number): string {
  if (!Number.isFinite(hours)) return '__:__:__';
  let secs = Math.floor((((hours % 24) + 24) % 24) * 3600 + 1e-6);
  if (secs >= 86400) secs -= 86400;
  const hit = hmsClockCache.get(secs);
  if (hit !== undefined) return hit;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return hmsClockCache.set(secs, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
}

const latCache = new Cache<number>();
/** Latitude "N 37°45.83'" (hundredths of a minute). */
export function fmtLat(lat: number): string {
  if (!Number.isFinite(lat)) return '___°__.__\'';
  const k = Math.round(lat * 6000);
  const hit = latCache.get(k);
  if (hit !== undefined) return hit;
  const a = Math.abs(k) / 6000;
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return latCache.set(k, `${lat < 0 ? 'S' : 'N'} ${String(d).padStart(2, '0')}°${m.toFixed(2).padStart(5, '0')}'`);
}

const lonCache = new Cache<number>();
/** Longitude "W097°16.11'". */
export function fmtLon(lon: number): string {
  if (!Number.isFinite(lon)) return '____°__.__\'';
  const k = Math.round(lon * 6000);
  const hit = lonCache.get(k);
  if (hit !== undefined) return hit;
  const a = Math.abs(k) / 6000;
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return lonCache.set(k, `${lon < 0 ? 'W' : 'E'}${String(d).padStart(3, '0')}°${m.toFixed(2).padStart(5, '0')}'`);
}

const thouCache = new Cache<number>();
/** Integer with thousands separator "12,500". */
export function fmtThousands(v: number): string {
  if (!Number.isFinite(v)) return '___';
  const n = Math.round(v);
  const hit = thouCache.get(n);
  if (hit !== undefined) return hit;
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return thouCache.set(n, n < 0 ? `-${s}` : s);
}

const degCache = new Cache<number>();
/** Course/bearing "087°" (001..360). */
export function fmtDeg(v: number): string {
  if (!Number.isFinite(v)) return '___°';
  let n = Math.round(v) % 360;
  if (n <= 0) n += 360;
  const hit = degCache.get(n);
  return hit !== undefined ? hit : degCache.set(n, `${String(n).padStart(3, '0')}°`);
}

const distCache = new Cache<number>();
/** Distance with adaptive resolution: "0.9", "12.6", "126". */
export function fmtDist(nm: number): string {
  if (!Number.isFinite(nm) || nm < 0) return '__._';
  const k = nm < 100 ? Math.round(nm * 10) : Math.round(nm) * 10 + 1e7;
  const hit = distCache.get(k);
  if (hit !== undefined) return hit;
  return distCache.set(k, nm < 100 ? (Math.round(nm * 10) / 10).toFixed(1) : String(Math.round(nm)));
}

const signedCache = new Cache<number>();
/** Signed integer "+5" / "-12" / "+0". */
export function fmtSigned(v: number): string {
  if (!Number.isFinite(v)) return '__';
  const n = Math.round(v);
  const hit = signedCache.get(n);
  return hit !== undefined ? hit : signedCache.set(n, n < 0 ? String(n) : `+${n}`);
}

const joinCache = new Map<string, Map<string, string>>();
/** Cached concatenation of two strings (used for "ident + suffix" labels). */
export function join2(a: string, b: string): string {
  let m = joinCache.get(a);
  if (!m) {
    if (joinCache.size > LIMIT) joinCache.clear();
    joinCache.set(a, (m = new Map()));
  }
  let s = m.get(b);
  if (s === undefined) {
    s = a + b;
    if (m.size > 256) m.clear();
    m.set(b, s);
  }
  return s;
}
