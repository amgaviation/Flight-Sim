/**
 * Scratchpad entry parsing for the 737 FMC (formats per the FCOM 11.xx CDU
 * data-entry rules as commonly documented for the Smiths U10 FMC):
 *   altitude  "8000", "12500", "FL350", "350" (three digits = flight level)
 *   speed     "250" (kt), ".78" / ".780" (Mach)
 *   speed/alt "250/10000", "/FL240", "/240A", "/12000B", "250/", ".78/FL300"
 *   weight    "62.5" (thousands of kg or lb)
 *   lat/lon   "N4051.1W07403.6" (degrees + decimal minutes)
 *   wind      "270/35"
 *   temp      "+15", "-20", "15"
 *   course    "090" / "90"
 * Every parser returns NaN / null on invalid input (the CDU then shows
 * INVALID ENTRY).
 */

/** Altitude in feet (flight levels converted); NaN when invalid. */
export function parseAltitude(s: string): number {
  const t = s.trim().toUpperCase();
  if (/^FL\d{1,3}$/.test(t)) return Number(t.slice(2)) * 100;
  if (/^-?\d{1,5}$/.test(t)) {
    const n = Number(t);
    // Three digits or fewer are flight levels (FCOM: "enter 3 digits for FL"), except small values.
    if (t.length <= 3 && n >= 10) return n * 100;
    return n;
  }
  return NaN;
}

/** Formats an altitude the FMC way: "FL350" at or above the transition altitude, else feet. */
export function fmtAlt(ft: number, transAltFt = 18000): string {
  if (!Number.isFinite(ft)) return '-----';
  const r = Math.round(ft);
  if (r >= transAltFt) return `FL${String(Math.round(r / 100)).padStart(3, '0')}`;
  return String(r);
}

export interface SpeedEntry {
  kt: number;
  mach: number;
}

/** IAS (100-400 kt) or Mach (.40-.89). */
export function parseSpeed(s: string): SpeedEntry | null {
  const t = s.trim();
  if (/^\.\d{2,3}$/.test(t) || /^0\.\d{2,3}$/.test(t)) {
    const m = Number(t);
    if (m >= 0.4 && m <= 0.89) return { kt: NaN, mach: Math.round(m * 1000) / 1000 };
    return null;
  }
  if (/^\d{2,3}$/.test(t)) {
    const k = Number(t);
    if (k >= 100 && k <= 400) return { kt: k, mach: NaN };
  }
  return null;
}

export interface SpeedAltEntry {
  speed: SpeedEntry | null;
  altFt: number;
  /** 'at' | 'atOrAbove' (A) | 'atOrBelow' (B) or '' when no altitude. */
  altKind: '' | 'at' | 'atOrAbove' | 'atOrBelow';
  hasSlash: boolean;
}

/** Speed/altitude constraint entry ("250/10000", "/FL240A", "250/"). */
export function parseSpeedAlt(s: string): SpeedAltEntry | null {
  const t = s.trim().toUpperCase();
  const slash = t.indexOf('/');
  let sp = '';
  let al = t;
  if (slash >= 0) {
    sp = t.slice(0, slash);
    al = t.slice(slash + 1);
  } else {
    // A lone entry is an altitude (LEGS right side accepts "FL240" or "8000A").
    sp = '';
  }
  let speed: SpeedEntry | null = null;
  if (sp) {
    speed = parseSpeed(sp);
    if (!speed) return null;
  }
  let altKind: SpeedAltEntry['altKind'] = '';
  let altFt = NaN;
  if (al) {
    let k: SpeedAltEntry['altKind'] = 'at';
    if (al.endsWith('A')) {
      k = 'atOrAbove';
      al = al.slice(0, -1);
    } else if (al.endsWith('B')) {
      k = 'atOrBelow';
      al = al.slice(0, -1);
    }
    altFt = parseAltitude(al);
    if (!Number.isFinite(altFt) || altFt < -1000 || altFt > 45000) return null;
    altKind = k;
  }
  if (!speed && !Number.isFinite(altFt)) return null;
  return { speed, altFt, altKind, hasSlash: slash >= 0 };
}

/** Weight entry in thousands (kg or lb) -> kg. */
export function parseWeight(s: string, unit: 'kg' | 'lb'): number {
  const t = s.trim();
  if (!/^\d{1,3}(\.\d)?$/.test(t)) return NaN;
  const n = Number(t) * 1000;
  return unit === 'lb' ? n / 2.2046226 : n;
}

/** Formats a weight (kg) in thousands of the display unit, one decimal. */
export function fmtWeight(kg: number, unit: 'kg' | 'lb'): string {
  if (!Number.isFinite(kg)) return '---.-';
  const v = (unit === 'lb' ? kg * 2.2046226 : kg) / 1000;
  return v.toFixed(1);
}

/** "N4051.1W07403.6" / "N40 51.1 W074 03.6" -> { lat, lon }. */
export function parseLatLon(s: string): { lat: number; lon: number } | null {
  const t = s.trim().toUpperCase().replace(/[\s°]/g, '');
  const m = /^([NS])(\d{2})(\d{2}(?:\.\d{1,2})?)([EW])(\d{3})(\d{2}(?:\.\d{1,2})?)$/.exec(t);
  if (!m) return null;
  const lat = (Number(m[2]) + Number(m[3]) / 60) * (m[1] === 'S' ? -1 : 1);
  const lon = (Number(m[5]) + Number(m[6]) / 60) * (m[4] === 'W' ? -1 : 1);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || Number(m[3]) >= 60 || Number(m[6]) >= 60) return null;
  return { lat, lon };
}

/** Formats a position like the CDU: "N40°51.1 W074°03.6". */
export function fmtLatLon(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '---°--.- ----°--.-';
  const f = (v: number, deg: number, pos: string, neg: string): string => {
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = Math.round((a - d) * 600) / 10;
    if (m >= 60) {
      m -= 60;
      d += 1;
    }
    return `${v < 0 ? neg : pos}${String(d).padStart(deg, '0')}°${m.toFixed(1).padStart(4, '0')}`;
  };
  return `${f(lat, 2, 'N', 'S')} ${f(lon, 3, 'E', 'W')}`;
}

/** Wind "270/35" -> { dir, kt }. */
export function parseWind(s: string): { dir: number; kt: number } | null {
  const m = /^(\d{1,3})\/(\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  const dir = Number(m[1]);
  const kt = Number(m[2]);
  if (dir > 360 || kt > 250) return null;
  return { dir: dir % 360, kt };
}

/** Temperature (°C): "+15", "-20", "15", "15C". */
export function parseTempC(s: string): number {
  const m = /^([+-]?\d{1,2})C?$/.exec(s.trim().toUpperCase());
  if (!m) return NaN;
  const t = Number(m[1]);
  return t >= -60 && t <= 70 ? t : NaN;
}

/** Course / heading 0-360 (magnetic). */
export function parseCourse(s: string): number {
  const t = s.trim();
  if (!/^\d{1,3}$/.test(t)) return NaN;
  const c = Number(t);
  return c <= 360 ? c % 360 : NaN;
}

/** Cost index 0-500 (NG, b737.org.uk FMC page). */
export function parseCostIndex(s: string): number {
  const t = s.trim();
  if (!/^\d{1,3}$/.test(t)) return NaN;
  const c = Number(t);
  return c <= 500 ? c : NaN;
}

/** Formats a course/heading "090°". */
export function fmtCourse(deg: number): string {
  if (!Number.isFinite(deg)) return '---°';
  const d = Math.round(((deg % 360) + 360) % 360);
  return `${String(d === 0 ? 360 : d).padStart(3, '0')}°`;
}

/** UTC hours -> "1429.8z". */
export function fmtZulu(utcH: number): string {
  if (!Number.isFinite(utcH)) return '----z';
  const h = ((utcH % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = (h - hh) * 60;
  return `${String(hh).padStart(2, '0')}${mm.toFixed(1).padStart(4, '0')}z`;
}

/** Speed formatting: "280" or ".780". */
export function fmtSpeed(kt: number, mach = NaN): string {
  if (Number.isFinite(mach) && mach > 0) return `.${String(Math.round(mach * 1000)).padStart(3, '0')}`;
  if (!Number.isFinite(kt)) return '---';
  return String(Math.round(kt));
}
