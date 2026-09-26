import { describe, expect, it } from 'vitest';
import { ceilingFt, flightCategory, parseMetar, parseWeatherGroup, SM_TO_M } from '../../src/ui/weather/metar';
import { applyWeather, metarToWeather, presetWeather, seaLevelTemperature, WEATHER_PRESETS, type WeatherPresetId } from '../../src/ui/weather/weather';
import { SimVars } from '../../src/core/SimVars';
import { ENV } from '../../src/core/vars';

describe('parseMetar (US format)', () => {
  // Real reports fetched from aviationweather.gov on 2026-09-26.
  const KTEB = 'METAR KTEB 260851Z 02015G25KT 7SM -RA OVC060 14/11 A2983 RMK AO2 SLP099 P0003 60005 T01390106 56020 $';
  const KNYC = 'METAR KNYC 260951Z AUTO 04015G31KT 010V080 10SM -RA BKN043 OVC070 13/12 A2984 RMK AO2 PK WND 05031/0951 SLP096 P0002 T01330117 $';

  it('decodes station, time, wind with gust, visibility, weather, clouds, temperature and altimeter', () => {
    const m = parseMetar(KTEB);
    expect(m.station).toBe('KTEB');
    expect(m.time).toEqual({ day: 26, hour: 8, minute: 51 });
    expect(m.wind).toEqual({ directionDeg: 20, speedKt: 15, gustKt: 25 });
    expect(m.visibilityM).toBeCloseTo(7 * SM_TO_M, 3);
    expect(m.visibilityUnlimited).toBe(false);
    expect(m.weather).toHaveLength(1);
    expect(m.weather[0]).toMatchObject({ intensity: 'light', precipitation: ['RA'] });
    expect(m.clouds).toEqual([{ cover: 'OVC', baseFt: 6000, type: undefined }]);
    // Remarks T-group overrides the whole-degree group.
    expect(m.temperatureC).toBeCloseTo(13.9, 5);
    expect(m.dewpointC).toBeCloseTo(10.6, 5);
    expect(m.altimeterInHg).toBeCloseTo(29.83, 5);
    expect(m.unparsed).toEqual([]);
  });

  it('handles AUTO, variable wind direction, multiple layers and 10SM', () => {
    const m = parseMetar(KNYC);
    expect(m.auto).toBe(true);
    expect(m.wind?.variableFromDeg).toBe(10);
    expect(m.wind?.variableToDeg).toBe(80);
    expect(m.visibilityUnlimited).toBe(true);
    expect(m.clouds.map((c) => c.cover)).toEqual(['BKN', 'OVC']);
    expect(ceilingFt(m)).toBe(4300);
    expect(flightCategory(m)).toBe('VFR');
  });

  it('parses fractional and mixed visibility, negative temperatures and VV', () => {
    const m = parseMetar('KBOS 121856Z 36012KT 1 1/2SM -SN BR VV008 M02/M04 A2990');
    expect(m.visibilityM).toBeCloseTo(1.5 * SM_TO_M, 3);
    expect(m.temperatureC).toBe(-2);
    expect(m.dewpointC).toBe(-4);
    expect(m.clouds[0]).toEqual({ cover: 'VV', baseFt: 800, type: undefined });
    expect(m.weather.map((w) => w.raw)).toEqual(['-SN', 'BR']);
    expect(flightCategory(m)).toBe('IFR');
    const q = parseMetar('KXYZ 121856Z 00000KT M1/4SM FG VV001 01/01 A3001');
    expect(q.visibilityM).toBeCloseTo(0.25 * SM_TO_M, 3);
    expect(flightCategory(q)).toBe('LIFR');
  });
});

describe('parseMetar (ICAO format)', () => {
  it('decodes metric visibility, QNH in hPa, CB clouds and TS', () => {
    const m = parseMetar('METAR EGLL 261020Z 24018G32KT 200V280 4000 +TSRA BKN014CB OVC025 18/16 Q0998 TEMPO 2000 TSRA=');
    expect(m.station).toBe('EGLL');
    expect(m.wind).toMatchObject({ directionDeg: 240, speedKt: 18, gustKt: 32, variableFromDeg: 200, variableToDeg: 280 });
    expect(m.visibilityM).toBe(4000);
    expect(m.weather[0]).toMatchObject({ intensity: 'heavy', descriptor: 'TS', precipitation: ['RA'] });
    expect(m.clouds[0]).toEqual({ cover: 'BKN', baseFt: 1400, type: 'CB' });
    // 998 hPa / 33.8639 = 29.47 inHg; the TEMPO trend group is ignored.
    expect(m.altimeterInHg).toBeCloseTo(29.47, 2);
    expect(m.clouds).toHaveLength(2);
    expect(m.unparsed).toEqual([]);
  });

  it('handles CAVOK, 9999, NSC, MPS winds and VRB', () => {
    const a = parseMetar('LFPG 261030Z 05008KT CAVOK 21/09 Q1021 NOSIG');
    expect(a.cavok).toBe(true);
    expect(a.visibilityUnlimited).toBe(true);
    expect(a.altimeterInHg).toBeCloseTo(30.15, 2);
    const b = parseMetar('UUEE 261030Z 18005MPS 9999 NSC 12/05 Q1015');
    expect(b.wind?.speedKt).toBe(10); // 5 m/s = 9.7 kt
    expect(b.skyClear).toBe(true);
    expect(b.visibilityUnlimited).toBe(true);
    const c = parseMetar('EDDF 261030Z VRB02KT 0800 FG VV002 08/08 Q1025');
    expect(c.wind?.directionDeg).toBeNull();
    expect(c.visibilityM).toBe(800);
  });

  it('skips RVR and directional visibility and keeps unknown groups', () => {
    const m = parseMetar('EHAM 261025Z 21010KT 1500 1000SW R18C/P2000N R36R/1200U BR FEW003 BKN005 11/11 Q1012 ZZZZ');
    expect(m.visibilityM).toBe(1500);
    expect(m.unparsed).toEqual(['ZZZZ']);
  });
});

describe('parseWeatherGroup', () => {
  it('recognises descriptors, vicinity and obscurations', () => {
    expect(parseWeatherGroup('VCSH')).toMatchObject({ intensity: 'vicinity', descriptor: 'SH' });
    expect(parseWeatherGroup('FZFG')).toMatchObject({ descriptor: 'FZ', obscuration: ['FG'] });
    expect(parseWeatherGroup('-FZRA')).toMatchObject({ intensity: 'light', descriptor: 'FZ', precipitation: ['RA'] });
    expect(parseWeatherGroup('TS')).toMatchObject({ descriptor: 'TS' });
    expect(parseWeatherGroup('KT')).toBeNull();
    expect(parseWeatherGroup('A2992')).toBeNull();
  });
});

describe('weather model', () => {
  it('converts a METAR to sim weather', () => {
    const m = parseMetar('METAR KTEB 260851Z 02015G25KT 7SM -RA OVC060 14/11 A2983');
    const w = metarToWeather(m, 9.8);
    expect(w.surfaceWind).toEqual({ directionDeg: 20, speedKt: 15, gustKt: 25 });
    expect(w.cloudCover).toBe(1);
    expect(w.cloudBaseFt).toBe(6000);
    expect(w.precip).toBeCloseTo(0.3, 5);
    expect(w.qnhInHg).toBeCloseTo(29.83, 5);
    expect(w.metar).toContain('KTEB');
  });

  it('flags freezing precipitation as icing and thunderstorms as turbulence', () => {
    const w1 = metarToWeather(parseMetar('KXYZ 121856Z 04010KT 3SM -FZRA OVC010 M01/M02 A2990'), 500);
    expect(w1.icing).toBeGreaterThanOrEqual(0.8);
    const w2 = metarToWeather(parseMetar('KXYZ 121856Z 27025G40KT 2SM +TSRA BKN020CB 25/22 A2960'), 500);
    expect(w2.turbulence).toBeGreaterThanOrEqual(0.66);
    expect(w2.precip).toBe(1);
  });

  it('applies to SimVars with the gust as an increment and a sea-level temperature', () => {
    const vars = new SimVars();
    const layers: unknown[] = [];
    const w = presetWeather('storm', 1000);
    applyWeather(vars, w, { setWindsAloft: (l) => layers.push(...l) });
    expect(vars.get(ENV.surfaceGustKt)).toBe(38 - 22);
    expect(vars.get(ENV.oatSeaLevelC)).toBeCloseTo(seaLevelTemperature(w.temperatureC, 1000), 6);
    // Presets give 26 C at the station, ISA lapse back to sea level = +1.98 C per 1000 ft.
    expect(vars.get(ENV.oatSeaLevelC)).toBeCloseTo(26, 6);
    expect(vars.get(ENV.cloudCover)).toBeCloseTo(0.8, 6);
    expect(layers.length).toBe(w.windsAloft.length);
  });

  it('builds every preset with sane values', () => {
    for (const id of Object.keys(WEATHER_PRESETS) as WeatherPresetId[]) {
      const w = presetWeather(id, 0);
      expect(w.visibilityM).toBeGreaterThan(0);
      expect(w.cloudCover).toBeGreaterThanOrEqual(0);
      expect(w.cloudCover).toBeLessThanOrEqual(1);
      expect(w.qnhInHg).toBeGreaterThan(28);
      for (let i = 1; i < w.windsAloft.length; i++) expect(w.windsAloft[i].altitudeFt).toBeGreaterThan(w.windsAloft[i - 1].altitudeFt);
    }
  });
});
