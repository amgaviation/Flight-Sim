/**
 * Live METARs from the aviationweather.gov Data API
 * (https://aviationweather.gov/data/api/, OpenAPI `/api/data/metar`:
 * `ids` or `bbox=lat0,lon0,lat1,lon1`, `format=json`; rate limit 100
 * requests/min; a custom User-Agent is requested).
 *
 * Routed through `platform/http` (Electron IPC in the exe, the Vite proxy
 * `/proxy/awc` on the dev server).
 */
import { http, type HttpClient } from '../../platform/http';
import { parseMetar, type Metar } from './metar';

export const AWC_BASE = 'https://aviationweather.gov';

/** Subset of the METARJSON schema we use. */
export interface AwcMetarJson {
  icaoId: string;
  rawOb: string;
  lat: number;
  lon: number;
  /** Station elevation (m). */
  elev: number;
  name?: string;
  obsTime?: number;
  fltCat?: string;
}

export interface LiveMetar {
  station: string;
  name: string;
  lat: number;
  lon: number;
  elevFt: number;
  distanceNm: number;
  metar: Metar;
}

const M_TO_FT = 1 / 0.3048;
const EARTH_NM = 3440.065;

function distNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function toLive(j: AwcMetarJson, lat: number, lon: number): LiveMetar | null {
  if (!j || typeof j.rawOb !== 'string' || !j.icaoId) return null;
  return {
    station: j.icaoId,
    name: j.name ?? j.icaoId,
    lat: j.lat,
    lon: j.lon,
    elevFt: Number.isFinite(j.elev) ? j.elev * M_TO_FT : 0,
    distanceNm: Number.isFinite(j.lat) ? distNm(lat, lon, j.lat, j.lon) : 0,
    metar: parseMetar(j.rawOb),
  };
}

/** Latest METAR for a station (ICAO id). Resolves null when the station has no current report. */
export async function fetchMetar(icao: string, client: HttpClient = http()): Promise<LiveMetar | null> {
  const id = icao.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(id)) return null;
  const list = await client.fetchJson<AwcMetarJson[]>(`${AWC_BASE}/api/data/metar?ids=${id}&format=json`);
  if (!Array.isArray(list) || list.length === 0) return null;
  return toLive(list[0], list[0].lat, list[0].lon);
}

/**
 * Nearest reporting station to a position: bounding-box queries of growing
 * size (about 60, 180 and 360 nm) until one returns reports.
 */
export async function fetchNearestMetar(lat: number, lon: number, client: HttpClient = http()): Promise<LiveMetar | null> {
  for (const half of [1, 3, 6]) {
    const dLon = Math.min(60, half / Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const bbox = [lat - half, lon - dLon, lat + half, lon + dLon].map((v) => v.toFixed(3)).join(',');
    const list = await client.fetchJson<AwcMetarJson[]>(`${AWC_BASE}/api/data/metar?bbox=${bbox}&format=json`);
    if (!Array.isArray(list) || list.length === 0) continue;
    let best: LiveMetar | null = null;
    for (const j of list) {
      const l = toLive(j, lat, lon);
      if (l && (!best || l.distanceNm < best.distanceNm)) best = l;
    }
    if (best) return best;
  }
  return null;
}
