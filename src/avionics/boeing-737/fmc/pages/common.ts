/**
 * CDU page framework: the page interface, line-select key addressing and
 * shared formatting helpers.
 *
 * A page renders the 14 x 24 screen from the FMC state every refresh and
 * handles its line select keys. Sub-pages ("1/3") are selected with the
 * PREV PAGE / NEXT PAGE keys; the CDU wraps around at the ends (FCOM 11.40
 * "Page access").
 */
import type { CduScreen } from '../screen';
import type { Cdu } from '../Cdu';

/** Line select key: side and row (1..6, top to bottom). */
export interface Lsk {
  side: 'L' | 'R';
  row: number;
}

export type PageId =
  | 'index'
  | 'ident'
  | 'pos'
  | 'perfInit'
  | 'takeoff'
  | 'approach'
  | 'n1'
  | 'navData'
  | 'navStatus'
  | 'menu'
  | 'rte'
  | 'depArr'
  | 'departures'
  | 'arrivals'
  | 'legs'
  | 'rteData'
  | 'hold'
  | 'clb'
  | 'crz'
  | 'des'
  | 'desForecast'
  | 'prog'
  | 'fix';

export interface CduPage {
  readonly id: PageId;
  /** Number of sub-pages (>= 1). */
  pages(c: Cdu): number;
  render(c: Cdu, s: CduScreen): void;
  lsk(c: Cdu, k: Lsk): void;
  /** Called when the page is selected (reset per-visit state). */
  onShow?(c: Cdu): void;
}

export const INVALID_ENTRY = 'INVALID ENTRY';
export const NOT_IN_DATABASE = 'NOT IN DATA BASE';
export const INVALID_DELETE = 'INVALID DELETE';

/** Boxes of `n` characters (required entry). */
export function boxes(n: number): string {
  return '□'.repeat(n);
}

/** Dashes of `n` characters (optional entry). */
export function dashes(n: number): string {
  return '-'.repeat(n);
}

/** Pads / truncates to exactly n characters. */
export function fit(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

/** Signed temperature "+15°C". */
export function fmtTemp(c: number): string {
  if (!Number.isFinite(c)) return '---°C';
  const r = Math.round(c);
  return `${r >= 0 ? '+' : ''}${r}°C`;
}

/** Signed temperature in °F from °C. */
export function fmtTempF(c: number): string {
  if (!Number.isFinite(c)) return '---°F';
  const f = Math.round(c * 1.8 + 32);
  return `${f >= 0 ? '+' : ''}${f}°F`;
}

/** Wind "270°/ 15". */
export function fmtWind(dir: number, kt: number): string {
  if (!Number.isFinite(dir) || !Number.isFinite(kt)) return '---°/---';
  const d = Math.round(dir) % 360;
  return `${String(d === 0 && kt > 0 ? 360 : d).padStart(3, '0')}°/${String(Math.round(kt)).padStart(3, ' ')}`;
}

/** N1 pair "94.5/ 94.5%" (both engines). */
export function fmtN1(n1: number): string {
  if (!Number.isFinite(n1)) return '--.-/ --.-%';
  const s = n1.toFixed(1);
  return `${s}/ ${s}%`;
}

/** Distance "123NM" / "12.3" (< 10 nm one decimal). */
export function fmtDist(nm: number): string {
  if (!Number.isFinite(nm)) return '---';
  return nm < 10 ? nm.toFixed(1) : String(Math.round(nm));
}

/** UTC time "1432.5z". */
export function fmtEta(h: number): string {
  if (!Number.isFinite(h)) return '----z';
  const t = ((h % 24) + 24) % 24;
  let hh = Math.floor(t);
  let mm = (t - hh) * 60;
  if (mm >= 59.95) {
    mm = 0;
    hh = (hh + 1) % 24;
  }
  return `${String(hh).padStart(2, '0')}${mm.toFixed(1).padStart(4, '0')}z`;
}

/** Fuel / weight in thousands "12.3" (kg or lb per the configured unit). */
export function fmtThousands(kg: number, unit: 'kg' | 'lb'): string {
  if (!Number.isFinite(kg)) return '--.-';
  const v = (unit === 'lb' ? kg * 2.2046226 : kg) / 1000;
  return v.toFixed(1);
}
