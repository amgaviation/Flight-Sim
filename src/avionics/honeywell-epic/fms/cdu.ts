/**
 * MCDU screen model and page framework for the Honeywell NG FMS as fitted
 * to Gulfstream PlaneView II (three MCDUs on the pedestal) and hosted by
 * the Symmetry touch-screen controllers' FMS app.
 *
 * Screen: 24 columns x 14 rows (title, six label/data line pairs next to
 * the line select keys 1L-6L / 1R-6R, scratchpad). "Each MCDU page is
 * arranged with a centered title at the top and a page number in the
 * upper-right corner ... (e.g. RADIO 1/2)" (code450 "Communications
 * System"). Colours (EST, Honeywell convention): labels white small,
 * pilot entries cyan, FMS values green/white, active waypoint magenta,
 * required entries as amber boxes.
 */
export type CduColor = 'white' | 'cyan' | 'green' | 'magenta' | 'amber' | 'red' | 'grey';

export const CDU_COLS = 24;
export const CDU_ROWS = 14;

export interface CduSeg {
  text: string;
  col: number;
  color: CduColor;
  small: boolean;
}

/** One rendered MCDU page. Rows 1..12: label (odd, small) / data (even) pairs; row 13 scratchpad. */
export class CduScreen {
  title = '';
  titleColor: CduColor = 'white';
  page = 0;
  pages = 0;
  readonly rows: CduSeg[][] = [];
  scratch = '';
  scratchColor: CduColor = 'white';

  constructor() {
    for (let i = 0; i < CDU_ROWS; i++) this.rows.push([]);
  }

  clear(): void {
    this.title = '';
    this.titleColor = 'white';
    this.page = 0;
    this.pages = 0;
    for (const r of this.rows) r.length = 0;
  }

  put(row: number, col: number, text: string, color: CduColor = 'white', small = false): void {
    if (row < 0 || row >= CDU_ROWS || !text) return;
    this.rows[row].push({ text, col: Math.max(0, Math.min(CDU_COLS - 1, col)), color, small });
  }

  /** Label (small) above line select row k (1..6), left / right / centre aligned. */
  labelL(k: number, text: string, color: CduColor = 'white'): void {
    this.put(2 * k - 1, 0, text, color, true);
  }
  labelR(k: number, text: string, color: CduColor = 'white'): void {
    this.put(2 * k - 1, CDU_COLS - text.length, text, color, true);
  }
  labelC(k: number, text: string, color: CduColor = 'white'): void {
    this.put(2 * k - 1, Math.floor((CDU_COLS - text.length) / 2), text, color, true);
  }
  /** Data line next to LSK k (1..6). */
  dataL(k: number, text: string, color: CduColor = 'white', small = false): void {
    this.put(2 * k, 0, text, color, small);
  }
  dataR(k: number, text: string, color: CduColor = 'white', small = false): void {
    this.put(2 * k, CDU_COLS - text.length, text, color, small);
  }
  dataC(k: number, text: string, color: CduColor = 'white', small = false): void {
    this.put(2 * k, Math.floor((CDU_COLS - text.length) / 2), text, color, small);
  }
  /** Plain text of a row (tests / debugging). */
  rowText(row: number): string {
    const chars = new Array<string>(CDU_COLS).fill(' ');
    for (const s of this.rows[row]) for (let i = 0; i < s.text.length && s.col + i < CDU_COLS; i++) chars[s.col + i] = s.text[i];
    return chars.join('').trimEnd();
  }
  /** Whole screen as text lines (tests). */
  text(): string[] {
    const out = [`${this.title}${this.pages > 1 ? ` ${this.page}/${this.pages}` : ''}`];
    for (let r = 1; r < CDU_ROWS - 1; r++) out.push(this.rowText(r));
    out.push(this.scratch);
    return out;
  }
}

export type LskId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';

/** MCDU function keys (EST layout of the Gulfstream Honeywell MCDU; functions from code450 "FMS Procedures"). */
export const CDU_FUNCTION_KEYS = ['FPL', 'NAV', 'PERF', 'PROG', 'DIR', 'RADIO', 'MSG', 'DLK', 'MENU', 'PREV', 'NEXT'] as const;
export type CduFunctionKey = (typeof CDU_FUNCTION_KEYS)[number];

// ---------------------------------------------------------------- entry parsing

/** Altitude entry: 'FL350' / '350' (flight level when < 1000) / '12500'. Returns ft or NaN. */
export function parseAltitude(s: string): number {
  const t = s.trim().toUpperCase();
  let m = /^FL(\d{2,3})$/.exec(t);
  if (m) return Number(m[1]) * 100;
  m = /^(\d{1,5})$/.exec(t);
  if (!m) return NaN;
  const n = Number(m[1]);
  return n < 1000 ? n * 100 : n;
}

/** Speed entry: '250' kt or '.80' / '0.80' / 'M.80' Mach. */
export function parseSpeed(s: string): { kt: number; mach: number } | null {
  const t = s.trim().toUpperCase().replace(/^M/, '');
  if (/^0?\.\d{1,3}$/.test(t)) return { kt: NaN, mach: Number(t.startsWith('.') ? `0${t}` : t) };
  if (/^\d{2,3}$/.test(t)) return { kt: Number(t), mach: NaN };
  return null;
}

/** Speed schedule 'kt/mach' ('250/.80'), either part optional. */
export function parseSpeedPair(s: string): { kt: number; mach: number } | null {
  const [a, b] = s.split('/');
  const r = { kt: NaN, mach: NaN };
  for (const part of [a, b]) {
    if (!part) continue;
    const p = parseSpeed(part);
    if (!p) return null;
    if (Number.isFinite(p.kt)) r.kt = p.kt;
    if (Number.isFinite(p.mach)) r.mach = p.mach;
  }
  return Number.isFinite(r.kt) || Number.isFinite(r.mach) ? r : null;
}

/** VHF COM frequency (118.000-136.990 MHz, 8.33/25 kHz): '118.5', '11850', '121.9'. */
export function parseComFreq(s: string): number {
  return parseFreq(s, 118, 136.99);
}

/** VHF NAV frequency 108.00-117.95 MHz. */
export function parseNavFreq(s: string): number {
  return parseFreq(s, 108, 117.95);
}

function parseFreq(s: string, lo: number, hi: number): number {
  let t = s.trim();
  if (/^\d{3,6}$/.test(t)) {
    // '1185' -> 118.5, '11850' -> 118.50, '118500' -> 118.500
    t = `${t.slice(0, 3)}.${t.slice(3)}`;
  }
  if (!/^\d{3}(\.\d{1,3})?$/.test(t)) return NaN;
  const f = Number(t);
  return f >= lo && f <= hi ? Math.round(f * 1000) / 1000 : NaN;
}

/** ADF frequency 190-1750 kHz. */
export function parseAdfFreq(s: string): number {
  const t = s.trim();
  if (!/^\d{3,4}(\.\d)?$/.test(t)) return NaN;
  const f = Number(t);
  return f >= 190 && f <= 1750 ? f : NaN;
}

/** HF frequency 2000-29999 kHz ('8891' or '8.891' MHz). */
export function parseHfFreq(s: string): number {
  const t = s.trim();
  if (/^\d{1,2}\.\d{1,3}$/.test(t)) {
    const k = Math.round(Number(t) * 1000);
    return k >= 2000 && k <= 29999 ? k : NaN;
  }
  if (!/^\d{4,5}$/.test(t)) return NaN;
  const k = Number(t);
  return k >= 2000 && k <= 29999 ? k : NaN;
}

/** Transponder code: four octal digits. */
export function parseSquawk(s: string): number {
  const t = s.trim();
  return /^[0-7]{4}$/.test(t) ? Number(t) : NaN;
}

/** 'N4030.5W07350.2' / '4030N07350W' style positions. */
export function parseLatLon(s: string): { lat: number; lon: number } | null {
  const t = s.trim().toUpperCase().replace(/\s+/g, '');
  let m = /^([NS])(\d{2})(\d{2}(?:\.\d+)?)([EW])(\d{3})(\d{2}(?:\.\d+)?)$/.exec(t);
  if (m) {
    const lat = (Number(m[2]) + Number(m[3]) / 60) * (m[1] === 'S' ? -1 : 1);
    const lon = (Number(m[5]) + Number(m[6]) / 60) * (m[4] === 'W' ? -1 : 1);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  }
  m = /^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])$/.exec(t);
  if (m) {
    const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === 'S' ? -1 : 1);
    const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === 'W' ? -1 : 1);
    return { lat, lon };
  }
  return null;
}

// ---------------------------------------------------------------- formatting

export function fmtAlt(ft: number, transAltFt = 18000): string {
  if (!Number.isFinite(ft)) return '-----';
  return ft >= transAltFt ? `FL${Math.round(ft / 100).toString().padStart(3, '0')}` : Math.round(ft).toString();
}

export function fmtLat(lat: number): string {
  const a = Math.abs(lat);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${lat >= 0 ? 'N' : 'S'}${d.toString().padStart(2, '0')}${m.toFixed(1).padStart(4, '0')}`;
}

export function fmtLon(lon: number): string {
  const a = Math.abs(lon);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${lon >= 0 ? 'E' : 'W'}${d.toString().padStart(3, '0')}${m.toFixed(1).padStart(4, '0')}`;
}

export function fmtTime(hUtc: number): string {
  if (!Number.isFinite(hUtc)) return '--:--';
  const h = ((hUtc % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

export function fmtEte(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '--:--';
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}+${(m % 60).toString().padStart(2, '0')}`;
}

export function pad(s: string, n: number, right = false): string {
  return right ? s.padStart(n) : s.padEnd(n);
}
