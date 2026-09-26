/**
 * Weather state for the simulator and its application to SimVars.
 *
 * A `WeatherState` is what the weather page edits (presets, manual entry or a
 * decoded live METAR). `applyWeather()` writes the `env.*` vars read by the
 * FDM (QNH, sea-level temperature, surface wind, turbulence, precipitation
 * for wet runways), the world (visibility, cloud layer, precipitation) and
 * the ice-protection systems (icing), and hands the winds-aloft layers to
 * the FDM wind model (`fdm.wind.setWindsAloft`).
 *
 * Conventions: wind directions are FROM, degrees TRUE (as the FDM expects;
 * METAR winds are true too, FAA JO 7900.5 / WMO 306). Cloud base is ft AGL of
 * the reference field, matching `env.cloud_base_ft` (docs/modules/world.md s.6).
 */
import type { SimVars } from '../../core/SimVars';
import { ENV } from '../../core/vars';
import type { Metar, MetarWeather } from './metar';
import { coverFraction } from './metar';

export interface WindLayer {
  /** Altitude (ft MSL). */
  altitudeFt: number;
  /** Direction FROM (deg true). */
  directionDeg: number;
  speedKt: number;
}

export interface WeatherState {
  /** Label shown in the UI ('CAVOK', 'Manual', 'METAR KTEB 260851Z'). */
  name: string;
  surfaceWind: { directionDeg: number; speedKt: number; /** Peak gust speed (kt); 0 or <= speed = none. */ gustKt: number };
  windsAloft: WindLayer[];
  visibilityM: number;
  /** Single cloud layer (the world renders one): cover 0..1, base ft AGL. */
  cloudCover: number;
  cloudBaseFt: number;
  /** Temperature (deg C) at `stationElevFt`. */
  temperatureC: number;
  dewpointC: number;
  /** Elevation (ft MSL) the temperature refers to (reporting station / departure field). */
  stationElevFt: number;
  qnhInHg: number;
  /** 0..1 (1/3 light, 2/3 moderate, 1 severe; MIL-F-8785C scale used by the FDM). */
  turbulence: number;
  /** 0..1 icing intensity in visible moisture. */
  icing: number;
  /** 0..1 precipitation intensity (rain or snow by temperature). */
  precip: number;
  /** Raw METAR when the state came from one. */
  metar?: string;
}

/** ISA temperature lapse rate: 1.98 deg C per 1000 ft (ICAO Doc 7488, 6.5 K/km). */
export const ISA_LAPSE_C_PER_FT = 0.0019812;
/** Standard pressure (inHg). */
export const STD_INHG = 29.92;
/** Visibility used for "unlimited" reports (10 SM+ / 9999 / CAVOK). EST: typical clear-day meteorological range. */
export const UNLIMITED_VIS_M = 40_000;

export function cloneWeather(w: WeatherState): WeatherState {
  return { ...w, surfaceWind: { ...w.surfaceWind }, windsAloft: w.windsAloft.map((l) => ({ ...l })) };
}

/** Sea-level temperature for the FDM (`env.sl_temp_c`) that reproduces `tempC` at `elevFt` with a constant ISA deviation. */
export function seaLevelTemperature(tempC: number, elevFt: number): number {
  return tempC + ISA_LAPSE_C_PER_FT * elevFt;
}

/**
 * Standard winds-aloft profile for presets: the surface wind veers and
 * strengthens with height. EST: generic mid-latitude westerly profile (about
 * 2 kt per 1000 ft, veering toward 270 deg), for presets only; live METARs
 * carry no upper winds.
 */
export function typicalWindsAloft(surfaceDir: number, surfaceKt: number, strength = 1): WindLayer[] {
  const levels = [3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000];
  return levels.map((alt) => {
    const f = Math.min(1, alt / 30000);
    // Veer from the surface direction toward 270 deg (shortest way) with height.
    let d = 270 - surfaceDir;
    d = ((d + 540) % 360) - 180;
    const dir = (((surfaceDir + d * f * 0.8) % 360) + 360) % 360;
    const kt = Math.round((surfaceKt * 1.3 + (alt / 1000) * 2.0 * strength) * (alt > 34000 ? 0.9 : 1));
    return { altitudeFt: alt, directionDeg: Math.round(dir), speedKt: kt };
  });
}

export type WeatherPresetId = 'cavok' | 'scattered' | 'ifr' | 'storm' | 'winter';

export const WEATHER_PRESETS: Record<WeatherPresetId, { label: string; description: string; make: (elevFt: number) => WeatherState }> = {
  cavok: {
    label: 'CAVOK',
    description: 'Clear sky, unlimited visibility, light wind',
    make: (e) => ({
      name: 'CAVOK',
      surfaceWind: { directionDeg: 270, speedKt: 5, gustKt: 0 },
      windsAloft: typicalWindsAloft(270, 5, 0.8),
      visibilityM: UNLIMITED_VIS_M,
      cloudCover: 0,
      cloudBaseFt: 5000,
      temperatureC: 15 - ISA_LAPSE_C_PER_FT * e,
      dewpointC: 5 - ISA_LAPSE_C_PER_FT * e,
      stationElevFt: e,
      qnhInHg: 30.05,
      turbulence: 0,
      icing: 0,
      precip: 0,
    }),
  },
  scattered: {
    label: 'Scattered',
    description: 'SCT045, 10 km, fair-weather cumulus, light chop',
    make: (e) => ({
      name: 'Scattered',
      surfaceWind: { directionDeg: 230, speedKt: 10, gustKt: 16 },
      windsAloft: typicalWindsAloft(230, 10),
      visibilityM: 15_000,
      cloudCover: 0.44,
      cloudBaseFt: 4500,
      temperatureC: 22 - ISA_LAPSE_C_PER_FT * e,
      dewpointC: 12 - ISA_LAPSE_C_PER_FT * e,
      stationElevFt: e,
      qnhInHg: 29.98,
      turbulence: 0.15,
      icing: 0,
      precip: 0,
    }),
  },
  ifr: {
    label: 'Overcast IFR',
    description: 'OVC006, 2400 m, light rain and mist',
    make: (e) => ({
      name: 'Overcast IFR',
      surfaceWind: { directionDeg: 110, speedKt: 12, gustKt: 0 },
      windsAloft: typicalWindsAloft(110, 12),
      visibilityM: 2400,
      cloudCover: 1,
      cloudBaseFt: 600,
      temperatureC: 9 - ISA_LAPSE_C_PER_FT * e,
      dewpointC: 8 - ISA_LAPSE_C_PER_FT * e,
      stationElevFt: e,
      qnhInHg: 29.71,
      turbulence: 0.1,
      icing: 0.1,
      precip: 0.35,
    }),
  },
  storm: {
    label: 'Thunderstorm',
    description: 'TS, BKN025CB, gusts 38 kt, heavy rain, moderate turbulence',
    make: (e) => ({
      name: 'Thunderstorm',
      surfaceWind: { directionDeg: 250, speedKt: 22, gustKt: 38 },
      windsAloft: typicalWindsAloft(250, 22, 1.3),
      visibilityM: 3000,
      cloudCover: 0.8,
      cloudBaseFt: 2500,
      temperatureC: 26 - ISA_LAPSE_C_PER_FT * e,
      dewpointC: 22 - ISA_LAPSE_C_PER_FT * e,
      stationElevFt: e,
      qnhInHg: 29.62,
      turbulence: 0.66,
      icing: 0.2,
      precip: 0.9,
    }),
  },
  winter: {
    label: 'Winter',
    description: 'OVC015, 3000 m in light snow, -8 C, icing in cloud',
    make: (e) => ({
      name: 'Winter',
      surfaceWind: { directionDeg: 340, speedKt: 14, gustKt: 22 },
      windsAloft: typicalWindsAloft(340, 14, 1.2),
      visibilityM: 3000,
      cloudCover: 1,
      cloudBaseFt: 1500,
      temperatureC: -8,
      dewpointC: -10,
      stationElevFt: e,
      qnhInHg: 30.24,
      turbulence: 0.2,
      icing: 0.55,
      precip: 0.4,
    }),
  },
};

export function presetWeather(id: WeatherPresetId, elevFt = 0): WeatherState {
  return WEATHER_PRESETS[id].make(elevFt);
}

/** Precipitation intensity (0..1) of one weather group. EST mapping of light/moderate/heavy. */
function precipOf(w: MetarWeather): number {
  if (!w.precipitation.length) return w.descriptor === 'TS' ? 0.2 : 0;
  const base = w.intensity === 'light' ? 0.3 : w.intensity === 'heavy' ? 1 : w.intensity === 'vicinity' ? 0 : 0.6;
  const drizzle = w.precipitation.length === 1 && w.precipitation[0] === 'DZ';
  return drizzle ? base * 0.5 : base;
}

/**
 * Converts a decoded METAR to a weather state.
 * @param stationElevFt reporting station elevation (the aviationweather.gov JSON gives it in metres: pass it converted)
 */
export function metarToWeather(m: Metar, stationElevFt: number): WeatherState {
  const wind = m.wind;
  const dir = wind?.directionDeg ?? (wind?.variableFromDeg !== undefined && wind.variableToDeg !== undefined ? (wind.variableFromDeg + wind.variableToDeg) / 2 : 0);
  const spd = wind?.speedKt ?? 0;
  const gust = wind?.gustKt ?? 0;

  // One visual layer: the ceiling layer if any, else the most extensive layer.
  let cover = 0;
  let base = 5000;
  let cb = false;
  const ceil = m.clouds.filter((c) => (c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV') && c.baseFt !== null);
  const pick = ceil.length ? ceil[0] : m.clouds.reduce<(typeof m.clouds)[number] | null>((a, c) => (!a || coverFraction(c.cover) > coverFraction(a.cover) ? c : a), null);
  if (pick) {
    cover = coverFraction(pick.cover);
    base = pick.baseFt ?? 1000;
  }
  for (const c of m.clouds) if (c.type === 'CB' || c.type === 'TCU') cb = true;

  let precip = 0;
  let ts = false;
  let freezing = false;
  let mist = false;
  for (const w of m.weather) {
    precip = Math.max(precip, precipOf(w));
    if (w.descriptor === 'TS') ts = true;
    if (w.descriptor === 'FZ' && w.precipitation.length) freezing = true;
    if (w.obscuration.length) mist = true;
  }

  const temp = m.temperatureC ?? 15 - ISA_LAPSE_C_PER_FT * stationElevFt;
  const dew = m.dewpointC ?? temp - 5;

  // Turbulence (EST): mechanical turbulence from strong/gusty surface wind, convective in TS/CB.
  let turb = Math.min(0.5, Math.max(0, (spd - 15) / 40) + Math.max(0, gust - spd) / 60);
  if (cb) turb = Math.max(turb, 0.33);
  if (ts) turb = Math.max(turb, 0.66);

  // Icing (EST): freezing precipitation is severe; otherwise visible moisture between +2 and -20 C at the cloud base.
  const tBase = temp - ISA_LAPSE_C_PER_FT * base;
  let icing = 0;
  if (freezing) icing = 0.8;
  else if (cover >= 0.44 && tBase <= 2 && tBase >= -20) icing = 0.3 + (cover >= 0.75 ? 0.2 : 0);

  let vis = m.visibilityM ?? UNLIMITED_VIS_M;
  if (m.visibilityUnlimited && !mist) vis = UNLIMITED_VIS_M;

  const when = m.time ? ` ${String(m.time.day).padStart(2, '0')}${String(m.time.hour).padStart(2, '0')}${String(m.time.minute).padStart(2, '0')}Z` : '';
  return {
    name: `METAR ${m.station}${when}`,
    surfaceWind: { directionDeg: Math.round(dir), speedKt: spd, gustKt: gust > spd ? gust : 0 },
    windsAloft: [],
    visibilityM: vis,
    cloudCover: cover,
    cloudBaseFt: base,
    temperatureC: temp,
    dewpointC: dew,
    stationElevFt,
    qnhInHg: m.altimeterInHg ?? STD_INHG,
    turbulence: Math.round(turb * 100) / 100,
    icing: Math.round(icing * 100) / 100,
    precip: Math.round(precip * 100) / 100,
    metar: m.raw,
  };
}

/** Minimal interface of the FDM wind model used here (physics `WindModel`). */
export interface WindsAloftSink {
  setWindsAloft(layers: { altitudeFt: number; directionDeg: number; speedKt: number }[]): void;
}

/**
 * Writes the weather into SimVars (`env.*`) and the FDM wind model.
 * Safe to call at any time (the FDM reads env vars every step).
 */
export function applyWeather(vars: SimVars, w: WeatherState, wind?: WindsAloftSink | null): void {
  vars.set(ENV.qnhInHg, w.qnhInHg);
  vars.set(ENV.oatSeaLevelC, seaLevelTemperature(w.temperatureC, w.stationElevFt));
  vars.set(ENV.visibilityM, Math.max(50, w.visibilityM));
  vars.set(ENV.cloudCover, Math.min(1, Math.max(0, w.cloudCover)));
  vars.set(ENV.cloudBaseFt, Math.max(0, w.cloudBaseFt));
  vars.set(ENV.precip, Math.min(1, Math.max(0, w.precip)));
  vars.set(ENV.turbulence, Math.min(1, Math.max(0, w.turbulence)));
  vars.set(ENV.icing, Math.min(1, Math.max(0, w.icing)));
  vars.set(ENV.surfaceWindDir, ((w.surfaceWind.directionDeg % 360) + 360) % 360);
  vars.set(ENV.surfaceWindKt, Math.max(0, w.surfaceWind.speedKt));
  // env.wind_gust_kt is the gust INCREMENT above the steady wind (physics docs s.2.3).
  vars.set(ENV.surfaceGustKt, Math.max(0, w.surfaceWind.gustKt - w.surfaceWind.speedKt));
  vars.set('env.dewpoint_c', w.dewpointC);
  vars.setString('env.weather_name', w.name);
  vars.setString('env.metar', w.metar ?? '');
  wind?.setWindsAloft(w.windsAloft.filter((l) => Number.isFinite(l.altitudeFt) && Number.isFinite(l.speedKt)).sort((a, b) => a.altitudeFt - b.altitudeFt));
}
