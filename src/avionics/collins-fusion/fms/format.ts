/**
 * FMS scratchpad entry parsing and text formatting (Collins FMS page
 * conventions: altitudes above the transition altitude as flight levels,
 * speed / altitude constraint "250/12000", "A" / "B" suffixes for at-or-
 * above / at-or-below; Collins FMS-3000 / FMS-6000 pilot's guide format,
 * EST where the Fusion guide was not available).
 */
import type { AltitudeConstraint, SpeedConstraint } from '../../../nav/types';

/** Altitude entry: 'FL350' / '350' (flight level when < 1000) / '12500'. Returns ft or NaN. */
export function parseAltitude(s: string): number {
  const t = s.trim().toUpperCase();
  let m = /^FL(\d{2,3})$/.exec(t);
  if (m) return Number(m[1]) * 100;
  m = /^(\d{1,5})$/.exec(t);
  if (!m) return NaN;
  const n = Number(m[1]);
  const ft = n < 1000 ? n * 100 : n;
  return ft <= 60000 ? ft : NaN;
}

/** Speed entry: '250' kt or '.80' / '0.80' / 'M.80' Mach. */
export function parseSpeed(s: string): { kt: number; mach: number } | null {
  const t = s.trim().toUpperCase().replace(/^M/, '');
  if (/^0?\.\d{1,3}$/.test(t)) {
    const m = Number(t.startsWith('.') ? `0${t}` : t);
    return m >= 0.1 && m <= 0.99 ? { kt: NaN, mach: m } : null;
  }
  if (/^\d{2,3}$/.test(t)) {
    const k = Number(t);
    return k >= 60 && k <= 400 ? { kt: k, mach: NaN } : null;
  }
  return null;
}

/** Speed schedule 'kt/mach' ('250/.80'); either part optional. */
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

/** Altitude constraint: '12000' (at), '12000A' (at or above), 'FL240B' (at or below), '5000A7000B' (between). */
export function parseAltConstraint(s: string): AltitudeConstraint | null {
  const t = s.trim().toUpperCase();
  const between = /^(FL\d{2,3}|\d{1,5})A(FL\d{2,3}|\d{1,5})B$/.exec(t);
  if (between) {
    const lo = parseAltitude(between[1]);
    const hi = parseAltitude(between[2]);
    return Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo ? { kind: 'between', lowerFt: lo, upperFt: hi } : null;
  }
  const m = /^(FL\d{2,3}|\d{1,5})([AB]?)$/.exec(t);
  if (!m) return null;
  const ft = parseAltitude(m[1]);
  if (!Number.isFinite(ft)) return null;
  if (m[2] === 'A') return { kind: 'atOrAbove', lowerFt: ft };
  if (m[2] === 'B') return { kind: 'atOrBelow', upperFt: ft };
  return { kind: 'at', lowerFt: ft, upperFt: ft };
}

/**
 * LEGS right-side entry: 'speed/altitude', '/altitude', 'speed/' or an
 * altitude alone. Returns null when nothing valid.
 */
export function parseSpeedAlt(s: string): { speed: SpeedConstraint | null | undefined; alt: AltitudeConstraint | null | undefined } | null {
  const t = s.trim().toUpperCase();
  if (!t) return null;
  if (t.includes('/')) {
    const [sp, al] = t.split('/');
    let speed: SpeedConstraint | undefined;
    let alt: AltitudeConstraint | undefined;
    if (sp) {
      const p = parseSpeed(sp);
      if (!p || !Number.isFinite(p.kt)) return null;
      speed = { kind: 'atOrBelow', kt: p.kt };
    }
    if (al) {
      const a = parseAltConstraint(al);
      if (!a) return null;
      alt = a;
    }
    if (!speed && !alt) return null;
    return { speed, alt };
  }
  const a = parseAltConstraint(t);
  return a ? { speed: undefined, alt: a } : null;
}

function parseFreq(s: string, lo: number, hi: number, decimals: number): number {
  let t = s.trim();
  if (/^\d{3,6}$/.test(t)) t = `${t.slice(0, 3)}.${t.slice(3)}`; // '1185' -> 118.5
  if (!/^\d{3}(\.\d{1,3})?$/.test(t)) return NaN;
  const f = Number(t);
  const p = 10 ** decimals;
  return f >= lo && f <= hi + 1e-9 ? Math.round(f * p) / p : NaN;
}

/** VHF COM 118.000-136.975 MHz. */
export function parseComFreq(s: string): number {
  return parseFreq(s, 118, 136.975, 3);
}

/** VHF NAV 108.00-117.95 MHz. */
export function parseNavFreq(s: string): number {
  return parseFreq(s, 108, 117.95, 2);
}

/** ADF 190-1799 kHz (decimal .5 allowed). */
export function parseAdfFreq(s: string): number {
  const t = s.trim();
  if (!/^\d{3,4}(\.\d)?$/.test(t)) return NaN;
  const f = Number(t);
  return f >= 190 && f <= 1799 ? f : NaN;
}

/** HF 2000-29999 kHz ('8891' or '8.891' MHz); HF-9031A range 2-29.9999 MHz. */
export function parseHfFreq(s: string): number {
  const t = s.trim();
  if (/^\d{1,2}\.\d{1,4}$/.test(t)) {
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

/** 'N4030.5W07350.2' / '4030N07350W' positions. */
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

/** Weight entry in pounds ('58.0' = thousands of lb when < 200, or '58000'). */
export function parseWeightLb(s: string): number {
  const t = s.trim();
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(t)) return NaN;
  const n = Number(t);
  return n < 200 ? Math.round(n * 1000) : Math.round(n);
}

// ---------------------------------------------------------------- formatting

export function fmtAlt(ft: number, transAltFt = 18000): string {
  if (!Number.isFinite(ft)) return '-----';
  return ft >= transAltFt ? `FL${Math.round(ft / 100).toString().padStart(3, '0')}` : Math.round(ft).toString();
}

export function fmtAltConstraint(c: AltitudeConstraint | undefined, transAltFt = 18000): string {
  if (!c) return '';
  switch (c.kind) {
    case 'at':
      return fmtAlt(c.lowerFt ?? c.upperFt ?? NaN, transAltFt);
    case 'atOrAbove':
      return `${fmtAlt(c.lowerFt ?? NaN, transAltFt)}A`;
    case 'atOrBelow':
      return `${fmtAlt(c.upperFt ?? NaN, transAltFt)}B`;
    case 'between':
      return `${fmtAlt(c.lowerFt ?? NaN, transAltFt)}A${fmtAlt(c.upperFt ?? NaN, transAltFt)}B`;
  }
}

export function fmtLat(lat: number): string {
  const a = Math.abs(lat);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${lat >= 0 ? 'N' : 'S'}${d.toString().padStart(2, '0')}°${m.toFixed(1).padStart(4, '0')}`;
}

export function fmtLon(lon: number): string {
  const a = Math.abs(lon);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${lon >= 0 ? 'E' : 'W'}${d.toString().padStart(3, '0')}°${m.toFixed(1).padStart(4, '0')}`;
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

export function fmtFreq(mhz: number, decimals: number): string {
  return Number.isFinite(mhz) && mhz > 0 ? mhz.toFixed(decimals) : '---.--';
}

export function fmtCrs(deg: number): string {
  if (!Number.isFinite(deg)) return '---°';
  const d = Math.round(((deg % 360) + 360) % 360) || 360;
  return `${d.toString().padStart(3, '0')}°`;
}

export function fmtNm(nm: number): string {
  if (!Number.isFinite(nm)) return '---';
  return nm < 10 ? nm.toFixed(1) : Math.round(nm).toString();
}

export function fmtSquawk(code: number): string {
  return Math.max(0, Math.min(7777, Math.round(code))).toString().padStart(4, '0');
}
