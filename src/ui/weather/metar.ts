/**
 * METAR decoder (FAA and ICAO formats).
 *
 * Format references:
 *  - FAA Order JO 7900.5E "Surface Weather Observing" chapter 14 / AIM 7-1-28
 *    (US: statute-mile visibility, `A2992` altimeter, remarks `T01390106`).
 *  - WMO No. 306 Manual on Codes, FM 15 METAR (ICAO: metres, `Q1013`, `CAVOK`,
 *    `9999` = 10 km or more, `NSC`/`NCD`).
 *
 * The decoder is tolerant: unknown groups are kept in `unparsed` and never
 * throw. RVR, runway-state, trend (`BECMG`/`TEMPO`/`NOSIG`) and recent-weather
 * (`RE..`) groups are skipped.
 */

export type CloudCover = 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV';

export interface MetarCloud {
  cover: CloudCover;
  /** Base (ft AGL); null when reported as `///`. */
  baseFt: number | null;
  /** Convective type: cumulonimbus or towering cumulus. */
  type?: 'CB' | 'TCU';
}

export interface MetarWeather {
  raw: string;
  intensity: 'light' | 'moderate' | 'heavy' | 'vicinity';
  /** MI BC PR DR BL SH TS FZ */
  descriptor: string;
  /** Precipitation codes: DZ RA SN SG IC PL GR GS UP */
  precipitation: string[];
  /** Obscurations: BR FG FU VA DU SA HZ PY */
  obscuration: string[];
  /** Other: PO SQ FC SS DS */
  other: string[];
}

export interface MetarWind {
  /** Direction the wind blows FROM (deg true); null for VRB. */
  directionDeg: number | null;
  speedKt: number;
  /** Peak gust speed (kt), null when not reported. */
  gustKt: number | null;
  variableFromDeg?: number;
  variableToDeg?: number;
}

export interface Metar {
  raw: string;
  station: string;
  /** Day of month and UTC time of observation. */
  time: { day: number; hour: number; minute: number } | null;
  auto: boolean;
  corrected: boolean;
  wind: MetarWind | null;
  /** Prevailing visibility (m). */
  visibilityM: number | null;
  /** True for `P6SM`, `10SM` or more, `9999` and `CAVOK` (visibility at or above the reportable maximum). */
  visibilityUnlimited: boolean;
  weather: MetarWeather[];
  clouds: MetarCloud[];
  cavok: boolean;
  /** SKC/CLR/NSC/NCD reported. */
  skyClear: boolean;
  temperatureC: number | null;
  dewpointC: number | null;
  /** Altimeter setting (inHg), from `A2992` or converted from `Q1013`. */
  altimeterInHg: number | null;
  remarks: string;
  unparsed: string[];
}

export const SM_TO_M = 1609.344;
/** hPa -> inHg (1 inHg = 33.8639 hPa, NIST SP 811). */
export const HPA_TO_INHG = 1 / 33.8639;
const MPS_TO_KT = 1 / 0.514444;
const KMH_TO_KT = 1 / 1.852;

const PRECIP = ['DZ', 'RA', 'SN', 'SG', 'IC', 'PL', 'GR', 'GS', 'UP'];
const OBSC = ['BR', 'FG', 'FU', 'VA', 'DU', 'SA', 'HZ', 'PY'];
const OTHER = ['PO', 'SQ', 'FC', 'SS', 'DS'];
const DESCR = ['MI', 'BC', 'PR', 'DR', 'BL', 'SH', 'TS', 'FZ'];
const TREND = new Set(['BECMG', 'TEMPO', 'NOSIG', 'FM', 'TL', 'AT', 'PROB30', 'PROB40']);

function emptyMetar(raw: string): Metar {
  return {
    raw,
    station: '',
    time: null,
    auto: false,
    corrected: false,
    wind: null,
    visibilityM: null,
    visibilityUnlimited: false,
    weather: [],
    clouds: [],
    cavok: false,
    skyClear: false,
    temperatureC: null,
    dewpointC: null,
    altimeterInHg: null,
    remarks: '',
    unparsed: [],
  };
}

/** Parses one weather-phenomenon group (`-SHRA`, `+TSRAGR`, `VCTS`, `FZFG`, `BR`). Returns null if it is not one. */
export function parseWeatherGroup(tok: string): MetarWeather | null {
  let s = tok;
  let intensity: MetarWeather['intensity'] = 'moderate';
  if (s.startsWith('-')) {
    intensity = 'light';
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    intensity = 'heavy';
    s = s.slice(1);
  } else if (s.startsWith('VC')) {
    intensity = 'vicinity';
    s = s.slice(2);
  }
  if (s.length < 2 || s.length % 2 !== 0) return null;
  const w: MetarWeather = { raw: tok, intensity, descriptor: '', precipitation: [], obscuration: [], other: [] };
  for (let i = 0; i < s.length; i += 2) {
    const c = s.slice(i, i + 2);
    if (i === 0 && DESCR.includes(c)) w.descriptor = c;
    else if (PRECIP.includes(c)) w.precipitation.push(c);
    else if (OBSC.includes(c)) w.obscuration.push(c);
    else if (OTHER.includes(c)) w.other.push(c);
    else if (DESCR.includes(c) && w.descriptor === '') w.descriptor = c;
    else return null;
  }
  // A lone descriptor is only valid for TS (thunderstorm without precipitation) and VCSH.
  if (!w.precipitation.length && !w.obscuration.length && !w.other.length && w.descriptor !== 'TS' && !(w.descriptor === 'SH' && intensity === 'vicinity')) return null;
  return w;
}

function parseTemp(s: string): number | null {
  if (s === '' || s.includes('/')) return null;
  const neg = s.startsWith('M');
  const n = Number(neg ? s.slice(1) : s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Visibility in statute miles from tokens like '10SM', 'P6SM', '1/2SM', 'M1/4SM' (with an optional preceding whole number). */
function parseSm(tok: string, whole: number): { sm: number; plus: boolean } | null {
  const m = /^(P|M)?(\d+)?(?:\/(\d+))?SM$/.exec(tok);
  if (!m) return null;
  let sm: number;
  if (m[3] !== undefined) sm = Number(m[2]) / Number(m[3]);
  else sm = Number(m[2]);
  if (!Number.isFinite(sm)) return null;
  return { sm: sm + whole, plus: m[1] === 'P' };
}

/**
 * Decodes a METAR/SPECI report. Accepts the report with or without the
 * leading `METAR`/`SPECI` word and a trailing `=` or `$` maintenance flag.
 */
export function parseMetar(input: string): Metar {
  const raw = input.trim().replace(/\s+/g, ' ');
  const m = emptyMetar(raw);
  let toks = raw.replace(/=$/, '').split(' ').filter((t) => t.length > 0);
  if (toks[0] === 'METAR' || toks[0] === 'SPECI') toks = toks.slice(1);
  const rmk = toks.indexOf('RMK');
  if (rmk >= 0) {
    m.remarks = toks.slice(rmk + 1).join(' ');
    toks = toks.slice(0, rmk);
  }
  let i = 0;
  if (toks[i] && /^[A-Z][A-Z0-9]{3}$/.test(toks[i])) m.station = toks[i++];
  if (toks[i]) {
    const t = /^(\d{2})(\d{2})(\d{2})Z$/.exec(toks[i]);
    if (t) {
      m.time = { day: Number(t[1]), hour: Number(t[2]), minute: Number(t[3]) };
      i++;
    }
  }
  let inTrend = false;
  for (; i < toks.length; i++) {
    const tok = toks[i];
    if (inTrend) continue;
    if (TREND.has(tok) || /^(FM|TL|AT)\d{4}$/.test(tok)) {
      inTrend = true;
      continue;
    }
    if (tok === 'AUTO') {
      m.auto = true;
      continue;
    }
    if (tok === 'COR' || tok === 'CCA') {
      m.corrected = true;
      continue;
    }
    // Wind: dddff(Gfff)KT|MPS|KMH, VRBffKT, 00000KT, ///// KT
    const w = /^(\d{3}|VRB|\/{3})(\d{2,3}|\/\/)(?:G(\d{2,3}))?(KT|MPS|KMH)$/.exec(tok);
    if (w) {
      const f = w[4] === 'MPS' ? MPS_TO_KT : w[4] === 'KMH' ? KMH_TO_KT : 1;
      const spd = w[2] === '//' ? 0 : Math.round(Number(w[2]) * f);
      m.wind = {
        directionDeg: w[1] === 'VRB' || w[1] === '///' ? null : Number(w[1]) % 360,
        speedKt: spd,
        gustKt: w[3] ? Math.round(Number(w[3]) * f) : null,
      };
      continue;
    }
    const vr = /^(\d{3})V(\d{3})$/.exec(tok);
    if (vr && m.wind) {
      m.wind.variableFromDeg = Number(vr[1]);
      m.wind.variableToDeg = Number(vr[2]);
      continue;
    }
    if (tok === 'CAVOK') {
      m.cavok = true;
      m.visibilityM = 10_000;
      m.visibilityUnlimited = true;
      continue;
    }
    // Visibility, US: '10SM', 'P6SM', '1/2SM', '1 1/2SM' (two tokens), 'M1/4SM'
    if (/^\d$/.test(tok) && toks[i + 1] && /^\d\/\d+SM$/.test(toks[i + 1])) {
      const v = parseSm(toks[i + 1], Number(tok));
      if (v) {
        m.visibilityM = v.sm * SM_TO_M;
        i++;
        continue;
      }
    }
    const sm = parseSm(tok, 0);
    if (sm) {
      m.visibilityM = sm.sm * SM_TO_M;
      m.visibilityUnlimited = sm.plus || sm.sm >= 10;
      continue;
    }
    // Visibility, ICAO: '9999', '0800', '4000NDV', directional minimum '1500SW' ignored
    const vm = /^(\d{4})(NDV)?$/.exec(tok);
    if (vm && m.visibilityM === null) {
      const v = Number(vm[1]);
      m.visibilityM = v;
      m.visibilityUnlimited = v >= 9999;
      continue;
    }
    if (/^\d{4}(N|NE|E|SE|S|SW|W|NW)$/.test(tok)) continue;
    // RVR: R04/1200FT, R27L/P2000N, R09/0600V1000U
    if (/^R\d{2}[LCR]?\//.test(tok)) continue;
    // Clouds
    if (tok === 'SKC' || tok === 'CLR' || tok === 'NSC' || tok === 'NCD') {
      m.skyClear = true;
      continue;
    }
    const cl = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/{3})(CB|TCU|\/{3})?$/.exec(tok);
    if (cl) {
      m.clouds.push({
        cover: cl[1] as CloudCover,
        baseFt: cl[2] === '///' ? null : Number(cl[2]) * 100,
        type: cl[3] === 'CB' || cl[3] === 'TCU' ? cl[3] : undefined,
      });
      continue;
    }
    // Temperature / dewpoint: 14/11, M02/M05, 05/, 12///
    const td = /^(M?\d{2}|\/\/)\/(M?\d{2}|\/\/)?$/.exec(tok);
    if (td) {
      m.temperatureC = parseTemp(td[1]);
      m.dewpointC = td[2] ? parseTemp(td[2]) : null;
      continue;
    }
    const alt = /^A(\d{4})$/.exec(tok);
    if (alt) {
      m.altimeterInHg = Number(alt[1]) / 100;
      continue;
    }
    const q = /^Q(\d{4})$/.exec(tok);
    if (q) {
      if (m.altimeterInHg === null) m.altimeterInHg = Math.round(Number(q[1]) * HPA_TO_INHG * 100) / 100;
      continue;
    }
    if (/^RE[A-Z]+$/.test(tok) || /^WS/.test(tok) || tok === 'NOSIG') continue;
    const wx = parseWeatherGroup(tok);
    if (wx) {
      m.weather.push(wx);
      continue;
    }
    m.unparsed.push(tok);
  }
  // US remarks: precise temperature 'T01390106' (tenths, 1 = negative).
  const tg = /(?:^|\s)T([01])(\d{3})([01])(\d{3})(?:\s|$)/.exec(m.remarks);
  if (tg) {
    m.temperatureC = (tg[1] === '1' ? -1 : 1) * (Number(tg[2]) / 10);
    m.dewpointC = (tg[3] === '1' ? -1 : 1) * (Number(tg[4]) / 10);
  }
  return m;
}

/** Cover fraction used by the world cloud layer (world.md section 6: FEW ~0.19, SCT ~0.44, BKN ~0.75, OVC 1). */
export function coverFraction(c: CloudCover): number {
  switch (c) {
    case 'FEW':
      return 0.19; // 1-2 oktas
    case 'SCT':
      return 0.44; // 3-4 oktas
    case 'BKN':
      return 0.75; // 5-7 oktas
    case 'OVC':
    case 'VV':
      return 1;
  }
}

/** Ceiling (ft AGL): lowest BKN/OVC/VV base, or null (FAA: 14 CFR 1.1 "ceiling"). */
export function ceilingFt(m: Metar): number | null {
  let c: number | null = null;
  for (const l of m.clouds) {
    if ((l.cover === 'BKN' || l.cover === 'OVC' || l.cover === 'VV') && l.baseFt !== null) c = c === null ? l.baseFt : Math.min(c, l.baseFt);
  }
  return c;
}

/** FAA flight category (AIM 7-1-7 / aviationweather.gov definitions). */
export function flightCategory(m: Metar): 'VFR' | 'MVFR' | 'IFR' | 'LIFR' {
  const ceil = ceilingFt(m) ?? Infinity;
  const visSm = m.visibilityM === null ? Infinity : m.visibilityM / SM_TO_M;
  if (ceil < 500 || visSm < 1) return 'LIFR';
  if (ceil < 1000 || visSm < 3) return 'IFR';
  if (ceil <= 3000 || visSm <= 5) return 'MVFR';
  return 'VFR';
}
