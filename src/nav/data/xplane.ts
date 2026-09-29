/**
 * Parsers for the X-Plane navigation data files distributed with FlightGear
 * (fgdata/Navaids, GPL v2, © Robin A. Peel): `nav.dat` (version 810),
 * `fix.dat` (600) and `awy.dat` (640). File format references: X-Plane
 * "XP NAV810", "XP FIX600" and "XP AWY640" specifications
 * (https://developer.x-plane.com/docs/data-development-documentation/).
 *
 * Runtime-import rule: loaded by Node type stripping from the build script;
 * no runtime relative imports.
 */

/** nav.dat row codes (XP NAV810 spec). */
export const NAV_ROW = {
  NDB: 2,
  VOR: 3,
  LOC_ILS: 4, // localizer component of a full ILS
  LOC: 5, // localizer-only approach (LOC, LDA, SDF)
  GS: 6,
  OM: 7,
  MM: 8,
  IM: 9,
  DME_PAIRED: 12, // DME paired with a VOR or ILS (frequency not displayed)
  DME: 13, // standalone DME
} as const;

export interface NavDatRecord {
  code: number;
  lat: number;
  lon: number;
  elevFt: number;
  /** MHz for VHF rows (file stores MHz*100), kHz for NDB rows. */
  freq: number;
  rangeNm: number;
  /**
   * Row-specific field: VOR slaved variation (deg), LOC true course,
   * GS: angle*100000 + true course, markers: true course, DME: bias (nm).
   */
  extra: number;
  ident: string;
  /** For ILS-family rows (4-9, and 12 when the name ends with 'DME-ILS'). */
  airport: string;
  runway: string;
  name: string;
}

/**
 * Parses nav.dat (810). Header lines ('I'/'A', version line) and the '99'
 * terminator are skipped; malformed lines are ignored.
 */
export function parseNavDat(text: string): NavDatRecord[] {
  const out: NavDatRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.length < 10) continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 9) continue;
    const code = Number(p[0]);
    if (!Number.isInteger(code) || code < 2 || code > 13 || code === 10 || code === 11) continue;
    const lat = Number(p[1]);
    const lon = Number(p[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const rawFreq = Number(p[4]);
    const freq = code === NAV_ROW.NDB ? rawFreq : rawFreq / 100;
    const ilsFamily =
      (code >= NAV_ROW.LOC_ILS && code <= NAV_ROW.IM) || (code === NAV_ROW.DME_PAIRED && p[p.length - 1] === 'DME-ILS');
    out.push({
      code,
      lat,
      lon,
      elevFt: Number(p[3]),
      freq,
      rangeNm: Number(p[5]),
      extra: Number(p[6]),
      ident: p[7],
      airport: ilsFamily ? (p[8] ?? '') : '',
      runway: ilsFamily ? (p[9] ?? '') : '',
      name: ilsFamily ? p.slice(10).join(' ') : p.slice(8).join(' '),
    });
  }
  return out;
}

/** Splits the nav.dat GS field `angle*100000 + course` (e.g. 300030.664 -> 3.00 deg, 30.664 deg). */
export function splitGsField(v: number): { angleDeg: number; courseTrue: number } {
  const angleCenti = Math.floor(v / 1000);
  return { angleDeg: angleCenti / 100, courseTrue: v - angleCenti * 1000 };
}

export interface FixDatRecord {
  ident: string;
  lat: number;
  lon: number;
}

/** Parses fix.dat (600): `lat lon ident` per line. */
export function parseFixDat(text: string): FixDatRecord[] {
  const out: FixDatRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const p = line.trim().split(/\s+/);
    if (p.length !== 3) continue;
    const lat = Number(p[0]);
    const lon = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ ident: p[2], lat, lon });
  }
  return out;
}

export interface AwyDatRecord {
  from: string;
  fromLat: number;
  fromLon: number;
  to: string;
  toLat: number;
  toLon: number;
  /** 1 = low (victor) airway, 2 = high (jet) airway. */
  level: 1 | 2;
  /** Base and top in feet (file stores hundreds of feet). */
  baseFt: number;
  topFt: number;
  /** Airway names sharing this segment (the file joins them with '-'). */
  names: string[];
}

/** Parses awy.dat (640): `from lat lon to lat lon level base top name[-name...]`. */
export function parseAwyDat(text: string): AwyDatRecord[] {
  const out: AwyDatRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const p = line.trim().split(/\s+/);
    if (p.length !== 10) continue;
    const fromLat = Number(p[1]);
    const fromLon = Number(p[2]);
    const toLat = Number(p[4]);
    const toLon = Number(p[5]);
    const level = Number(p[6]);
    if (![fromLat, fromLon, toLat, toLon].every(Number.isFinite) || (level !== 1 && level !== 2)) continue;
    out.push({
      from: p[0],
      fromLat,
      fromLon,
      to: p[3],
      toLat,
      toLon,
      level,
      baseFt: Number(p[7]) * 100,
      topFt: Number(p[8]) * 100,
      names: p[9].split('-').filter((s) => s.length > 0),
    });
  }
  return out;
}

/** Extracts the "data cycle 2013.10" style cycle string from a file header, or ''. */
export function xplaneCycle(text: string): string {
  const m = /data cycle\s+([0-9.]+)/i.exec(text.slice(0, 2000));
  return m ? m[1] : '';
}
