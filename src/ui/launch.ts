/**
 * Flight setup ("launch config"): aircraft, airport, start position, initial
 * state, date/time and weather. Persisted as the last used setup and
 * parseable from the page URL for scripted starts:
 *
 *   ?aircraft=_test-jet&airport=KTEB&runway=01&state=takeoff&time=14:30&date=2026-06-21&weather=cavok&autotest=1
 *
 * `runway=` or `parking=<n>`; `state` = cold_dark | ready_to_taxi | takeoff |
 * approach | cruise; `time` = HH:MM UTC or `now`; `weather` = preset id,
 * `live` or `live:KXXX`.
 */
import type { InitialState } from '../aircraft/types';
import type { StartSpot } from './startPosition';
import type { WeatherConfig } from './WeatherPanel';
import { WEATHER_PRESETS, type WeatherPresetId } from './weather/weather';

export interface TimeConfig {
  mode: 'now' | 'custom';
  /** 'YYYY-MM-DD' (UTC). */
  date: string;
  /** UTC hours 0..24. */
  utcHours: number;
}

export interface LaunchConfig {
  aircraftId: string;
  airport: string;
  spot: StartSpot;
  state: InitialState;
  time: TimeConfig;
  weather: WeatherConfig;
}

export const STATES: { id: InitialState; label: string; hint: string }[] = [
  { id: 'cold_dark', label: 'Cold & dark', hint: 'Everything off, parked' },
  { id: 'ready_to_taxi', label: 'Ready to taxi', hint: 'Engines running, parking brake set' },
  { id: 'takeoff', label: 'On runway', hint: 'Lined up, configured for takeoff' },
  { id: 'approach', label: '10 nm final', hint: 'Configured, on the extended centreline' },
  { id: 'cruise', label: 'Cruise', hint: 'Clean, trimmed at cruise altitude' },
];

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultLaunch(aircraftId: string): LaunchConfig {
  return {
    aircraftId,
    airport: 'KTEB',
    spot: { kind: 'auto' },
    state: 'ready_to_taxi',
    time: { mode: 'now', date: todayUtc(), utcHours: 15 },
    weather: { mode: 'preset', preset: 'cavok' },
  };
}

const STATE_IDS = new Set<InitialState>(['cold_dark', 'ready_to_taxi', 'takeoff', 'approach', 'cruise']);

export function sanitizeLaunch(x: unknown, fallbackAircraft: string): LaunchConfig {
  const d = defaultLaunch(fallbackAircraft);
  if (!x || typeof x !== 'object') return d;
  const c = x as Partial<LaunchConfig>;
  const spot = c.spot && typeof c.spot === 'object' && ['runway', 'parking', 'auto'].includes((c.spot as StartSpot).kind) ? (c.spot as StartSpot) : d.spot;
  const time =
    c.time && typeof c.time === 'object' && (c.time.mode === 'now' || c.time.mode === 'custom') && /^\d{4}-\d{2}-\d{2}$/.test(String(c.time.date)) && Number.isFinite(c.time.utcHours)
      ? { mode: c.time.mode, date: c.time.date, utcHours: Math.min(24, Math.max(0, c.time.utcHours)) }
      : d.time;
  let weather: WeatherConfig = d.weather;
  const w = c.weather as WeatherConfig | undefined;
  if (w && w.mode === 'preset' && w.preset in WEATHER_PRESETS) weather = w;
  else if (w && w.mode === 'live') weather = w;
  else if (w && w.mode === 'manual' && w.state && typeof w.state === 'object' && Array.isArray(w.state.windsAloft)) weather = w;
  return {
    aircraftId: typeof c.aircraftId === 'string' && c.aircraftId ? c.aircraftId : d.aircraftId,
    airport: typeof c.airport === 'string' && c.airport ? c.airport.toUpperCase() : d.airport,
    spot,
    state: c.state && STATE_IDS.has(c.state) ? c.state : d.state,
    time,
    weather,
  };
}

/** Parses launch overrides from a URL query. Returns null when no `aircraft` or `airport` parameter is present. */
export function launchFromQuery(search: string, base: LaunchConfig): (LaunchConfig & { autotest: boolean }) | null {
  const q = new URLSearchParams(search);
  if (!q.has('aircraft') && !q.has('airport')) return null;
  const c: LaunchConfig = JSON.parse(JSON.stringify(base)) as LaunchConfig;
  if (q.get('aircraft')) c.aircraftId = q.get('aircraft')!;
  if (q.get('airport')) c.airport = q.get('airport')!.toUpperCase();
  if (q.get('runway')) c.spot = { kind: 'runway', runway: q.get('runway')!.toUpperCase() };
  else if (q.get('parking') !== null) c.spot = { kind: 'parking', index: Math.max(0, Number(q.get('parking')) - 1 || 0) };
  const st = q.get('state') as InitialState | null;
  if (st && STATE_IDS.has(st)) c.state = st;
  const t = q.get('time');
  if (t === 'now') c.time = { ...c.time, mode: 'now' };
  else if (t && /^\d{1,2}:\d{2}$/.test(t)) {
    const [hh, mm] = t.split(':').map(Number);
    c.time = { mode: 'custom', date: q.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(q.get('date')!) ? q.get('date')! : c.time.date, utcHours: Math.min(24, hh + mm / 60) };
  }
  const w = q.get('weather');
  if (w && w in WEATHER_PRESETS) c.weather = { mode: 'preset', preset: w as WeatherPresetId };
  else if (w === 'live') c.weather = { mode: 'live' };
  else if (w?.startsWith('live:')) c.weather = { mode: 'live', station: w.slice(5).toUpperCase() };
  return { ...c, autotest: q.get('autotest') === '1' };
}

/** Day of year (1..366) and UTC hours for a time config. */
/** 365 or 366 days (Gregorian leap-year rule), for the UTC clock's day-of-year wrap. */
export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

export function resolveTime(t: TimeConfig, now = new Date()): { year: number; dayOfYear: number; utcHours: number } {
  const d = t.mode === 'now' ? now : new Date(`${t.date}T00:00:00Z`);
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const doy = Math.floor((Date.UTC(year, d.getUTCMonth(), d.getUTCDate()) - start) / 86_400_000) + 1;
  const hours = t.mode === 'now' ? now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600 : t.utcHours;
  return { year, dayOfYear: doy, utcHours: hours };
}
