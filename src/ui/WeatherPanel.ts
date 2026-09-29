/**
 * Weather editor: presets, manual entry (surface wind, visibility, cloud
 * layer, temperature/dewpoint, QNH, turbulence, icing, precipitation, winds
 * aloft) and live METAR for the nearest reporting station.
 */
import { h, clear, button, field, numberInput, select, slider } from './dom';
import { WEATHER_PRESETS, cloneWeather, metarToWeather, presetWeather, typicalWindsAloft, type WeatherPresetId, type WeatherState } from './weather/weather';
import { fetchMetar, fetchNearestMetar, type LiveMetar } from './weather/liveMetar';
import { flightCategory, SM_TO_M } from './weather/metar';

export type WeatherConfig = { mode: 'preset'; preset: WeatherPresetId } | { mode: 'manual'; state: WeatherState } | { mode: 'live'; station?: string };

const COVERS: { value: number; label: string }[] = [
  { value: 0, label: 'Clear (SKC)' },
  { value: 0.19, label: 'Few (FEW)' },
  { value: 0.44, label: 'Scattered (SCT)' },
  { value: 0.75, label: 'Broken (BKN)' },
  { value: 1, label: 'Overcast (OVC)' },
];

export interface WeatherPanelOptions {
  config: WeatherConfig;
  /** Field elevation for presets/manual temperature reference (ft). */
  elevationFt: () => number;
  /** Position for "nearest station". */
  position: () => { lat: number; lon: number } | null;
  onChange: (cfg: WeatherConfig, resolved: WeatherState | null) => void;
  /** Show an "Apply" button (in-flight use) instead of applying on every change. */
  applyButton?: boolean;
}

export class WeatherPanel {
  readonly el: HTMLElement;
  private cfg: WeatherConfig;
  private manual: WeatherState;
  private live: LiveMetar | null = null;
  private liveStatus = '';
  private readonly o: WeatherPanelOptions;

  constructor(o: WeatherPanelOptions) {
    this.o = o;
    this.cfg = o.config;
    this.manual = o.config.mode === 'manual' ? cloneWeather(o.config.state) : presetWeather(o.config.mode === 'preset' ? o.config.preset : 'cavok', o.elevationFt());
    this.el = h('div', { class: 'amg-weather' });
    this.render();
  }

  get config(): WeatherConfig {
    return this.cfg;
  }

  /** Weather resolved for the current config (null for live until fetched). */
  resolved(): WeatherState | null {
    const c = this.cfg;
    if (c.mode === 'preset') return presetWeather(c.preset, this.o.elevationFt());
    if (c.mode === 'manual') return cloneWeather(c.state);
    return this.live ? metarToWeather(this.live.metar, this.live.elevFt) : null;
  }

  private emit(): void {
    if (!this.o.applyButton) this.o.onChange(this.cfg, this.resolved());
  }

  private setMode(mode: WeatherConfig['mode']): void {
    if (mode === 'preset') this.cfg = { mode: 'preset', preset: this.cfg.mode === 'preset' ? this.cfg.preset : 'cavok' };
    else if (mode === 'manual') {
      const r = this.resolved();
      if (r) this.manual = r;
      this.manual.name = 'Manual';
      this.cfg = { mode: 'manual', state: this.manual };
    } else this.cfg = { mode: 'live', station: this.live?.station };
    this.render();
    this.emit();
  }

  private render(): void {
    clear(this.el);
    const modes: [WeatherConfig['mode'], string][] = [
      ['preset', 'Presets'],
      ['manual', 'Manual'],
      ['live', 'Live METAR'],
    ];
    this.el.appendChild(h('div', { class: 'amg-seg' }, modes.map(([m, l]) => h('button', { class: this.cfg.mode === m ? 'active' : '', onclick: () => this.setMode(m) }, l))));
    if (this.cfg.mode === 'preset') this.renderPresets();
    else if (this.cfg.mode === 'manual') this.renderManual();
    else this.renderLive();
    if (this.o.applyButton) {
      this.el.appendChild(
        h('div', { class: 'amg-row', style: 'margin-top:12px' }, [
          button('Apply weather', () => {
            if (this.cfg.mode === 'live' && !this.live) {
              this.liveStatus = 'Fetch a METAR first.';
              this.render();
              return;
            }
            this.o.onChange(this.cfg, this.resolved());
          }, 'active'),
        ]),
      );
    }
  }

  private renderPresets(): void {
    const cur = this.cfg.mode === 'preset' ? this.cfg.preset : 'cavok';
    const list = h('div', { style: 'margin-top:10px' });
    for (const [id, p] of Object.entries(WEATHER_PRESETS) as [WeatherPresetId, (typeof WEATHER_PRESETS)[WeatherPresetId]][]) {
      list.appendChild(
        h('div', { class: `amg-card ${id === cur ? 'selected' : ''}`, onclick: () => ((this.cfg = { mode: 'preset', preset: id }), this.render(), this.emit()) }, [h('div', { class: 'amg-title' }, p.label), h('div', { class: 'amg-meta' }, p.description)]),
      );
    }
    this.el.appendChild(list);
  }

  private renderManual(): void {
    const w = this.manual;
    const upd = () => {
      this.cfg = { mode: 'manual', state: w };
      this.emit();
    };
    const box = h('div', { style: 'margin-top:10px' });
    box.appendChild(h('div', { class: 'amg-section' }, 'Surface'));
    box.appendChild(
      field(
        'Wind (from, true)',
        h('span', { class: 'amg-row', style: 'margin:0' }, [
          numberInput(w.surfaceWind.directionDeg, { min: 0, max: 360, step: 10, onChange: (v) => ((w.surfaceWind.directionDeg = v % 360), upd()) }),
          h('span', {}, '/'),
          numberInput(w.surfaceWind.speedKt, { min: 0, max: 99, onChange: (v) => ((w.surfaceWind.speedKt = v), upd()) }),
          h('span', {}, 'kt gusting'),
          numberInput(w.surfaceWind.gustKt, { min: 0, max: 120, onChange: (v) => ((w.surfaceWind.gustKt = v), upd()) }),
        ]),
        'Gust = peak speed (0 = none)',
      ),
    );
    box.appendChild(field('Visibility (SM)', numberInput(Math.round((w.visibilityM / SM_TO_M) * 10) / 10, { min: 0, max: 60, step: 0.25, onChange: (v) => ((w.visibilityM = Math.max(50, v * SM_TO_M)), upd()) })));
    box.appendChild(
      field(
        'Cloud layer',
        h('span', { class: 'amg-row', style: 'margin:0' }, [
          select(COVERS, COVERS.reduce((a, c) => (Math.abs(c.value - w.cloudCover) < Math.abs(a.value - w.cloudCover) ? c : a)).value, (v) => ((w.cloudCover = v), upd())),
          h('span', {}, 'base'),
          numberInput(w.cloudBaseFt, { min: 100, max: 30000, step: 100, onChange: (v) => ((w.cloudBaseFt = v), upd()) }),
          h('span', {}, 'ft AGL'),
        ]),
      ),
    );
    box.appendChild(
      field(
        'Temperature / dewpoint',
        h('span', { class: 'amg-row', style: 'margin:0' }, [
          numberInput(Math.round(w.temperatureC), { min: -60, max: 55, onChange: (v) => ((w.temperatureC = v), upd()) }),
          h('span', {}, '/'),
          numberInput(Math.round(w.dewpointC), { min: -70, max: 40, onChange: (v) => ((w.dewpointC = v), upd()) }),
          h('span', {}, 'deg C at the field'),
        ]),
      ),
    );
    box.appendChild(field('QNH (inHg)', numberInput(w.qnhInHg, { min: 27.5, max: 31.5, step: 0.01, onChange: (v) => ((w.qnhInHg = v), upd()) }), `${Math.round(w.qnhInHg * 33.8639)} hPa`));
    box.appendChild(field('Turbulence', slider(w.turbulence, { min: 0, max: 1, step: 0.05, format: (v) => (v < 0.05 ? 'none' : v < 0.4 ? 'light' : v < 0.75 ? 'moderate' : 'severe'), onInput: (v) => ((w.turbulence = v), upd()) })));
    box.appendChild(field('Icing (in cloud)', slider(w.icing, { min: 0, max: 1, step: 0.05, format: (v) => (v < 0.05 ? 'none' : v < 0.35 ? 'light' : v < 0.7 ? 'moderate' : 'severe'), onInput: (v) => ((w.icing = v), upd()) })));
    box.appendChild(field('Precipitation', slider(w.precip, { min: 0, max: 1, step: 0.05, format: (v) => (v < 0.05 ? 'none' : v < 0.4 ? 'light' : v < 0.75 ? 'moderate' : 'heavy'), onInput: (v) => ((w.precip = v), upd()) })));
    box.appendChild(h('div', { class: 'amg-section' }, 'Winds aloft (ft MSL, from true, kt)'));
    const table = h('table', { class: 'amg-table' });
    const renderRows = () => {
      clear(table);
      table.appendChild(h('tr', {}, [h('th', {}, 'Altitude'), h('th', {}, 'Direction'), h('th', {}, 'Speed'), h('th', {}, '')]));
      w.windsAloft.forEach((l, i) => {
        table.appendChild(
          h('tr', {}, [
            h('td', {}, numberInput(l.altitudeFt, { min: 0, max: 60000, step: 1000, onChange: (v) => ((l.altitudeFt = v), upd()) })),
            h('td', {}, numberInput(l.directionDeg, { min: 0, max: 360, step: 10, onChange: (v) => ((l.directionDeg = v % 360), upd()) })),
            h('td', {}, numberInput(l.speedKt, { min: 0, max: 250, step: 5, onChange: (v) => ((l.speedKt = v), upd()) })),
            h('td', {}, button('Remove', () => (w.windsAloft.splice(i, 1), renderRows(), upd()), 'small')),
          ]),
        );
      });
    };
    renderRows();
    box.appendChild(table);
    box.appendChild(
      h('div', { class: 'amg-row' }, [
        button('Add layer', () => {
          const last = w.windsAloft[w.windsAloft.length - 1];
          w.windsAloft.push({ altitudeFt: (last?.altitudeFt ?? 0) + 3000, directionDeg: last?.directionDeg ?? 270, speedKt: last?.speedKt ?? 20 });
          renderRows();
          upd();
        }, 'small'),
        button('Typical profile', () => {
          w.windsAloft = typicalWindsAloft(w.surfaceWind.directionDeg, w.surfaceWind.speedKt);
          renderRows();
          upd();
        }, 'small'),
        button('Clear', () => ((w.windsAloft = []), renderRows(), upd()), 'small'),
      ]),
    );
    this.el.appendChild(box);
  }

  private renderLive(): void {
    const box = h('div', { style: 'margin-top:10px' });
    const input = h('input', { class: 'amg-input', placeholder: 'ICAO (blank = nearest)', value: this.cfg.mode === 'live' ? (this.cfg.station ?? '') : '', style: 'width:150px' });
    const go = async (): Promise<void> => {
      this.liveStatus = 'Fetching...';
      this.render();
      try {
        const id = input.value.trim();
        const pos = this.o.position();
        const r = id ? await fetchMetar(id) : pos ? await fetchNearestMetar(pos.lat, pos.lon) : null;
        this.live = r;
        this.liveStatus = r ? '' : 'No current METAR found.';
        this.cfg = { mode: 'live', station: r?.station };
      } catch (e) {
        this.live = null;
        this.liveStatus = `METAR unavailable (${e instanceof Error ? e.message : String(e)}). Check the network connection.`;
      }
      this.render();
      this.emit();
    };
    box.appendChild(h('div', { class: 'amg-row' }, [input, button('Fetch', () => void go())]));
    box.appendChild(h('div', { class: 'amg-hint', style: 'display:block;margin:4px 0 8px' }, 'Source: aviationweather.gov (NOAA/NWS). Upper winds are not in METARs; the FDM uses its boundary-layer profile.'));
    if (this.liveStatus) box.appendChild(h('div', { class: this.liveStatus.startsWith('Fetching') ? 'amg-hint' : 'amg-error' }, this.liveStatus));
    if (this.live) {
      const m = this.live.metar;
      const w = metarToWeather(m, this.live.elevFt);
      const cat = flightCategory(m);
      box.appendChild(h('div', { class: 'amg-row' }, [h('strong', {}, `${this.live.station} ${this.live.name}`), h('span', { class: `amg-badge ${cat === 'VFR' ? 'ok' : 'warn'}` }, cat), h('span', { class: 'amg-hint' }, `${this.live.distanceNm.toFixed(0)} nm`)]));
      box.appendChild(h('div', { class: 'amg-metar' }, m.raw));
      box.appendChild(
        h('div', { class: 'amg-grid2', style: 'margin-top:8px;font-size:12px' }, [
          h('span', {}, `Wind ${String(w.surfaceWind.directionDeg).padStart(3, '0')}/${w.surfaceWind.speedKt}${w.surfaceWind.gustKt ? `G${w.surfaceWind.gustKt}` : ''} kt`),
          h('span', {}, `Visibility ${(w.visibilityM / SM_TO_M).toFixed(1)} SM`),
          h('span', {}, `Clouds ${Math.round(w.cloudCover * 8)}/8 at ${w.cloudBaseFt} ft`),
          h('span', {}, `Temp ${w.temperatureC.toFixed(1)} / ${w.dewpointC.toFixed(1)} C`),
          h('span', {}, `Altimeter ${w.qnhInHg.toFixed(2)} inHg`),
          h('span', {}, `Precip ${w.precip > 0 ? Math.round(w.precip * 100) + ' %' : 'none'}`),
        ]),
      );
    }
    this.el.appendChild(box);
  }

  /** Live mode: the fetched METAR (null until fetched). */
  get liveMetar(): LiveMetar | null {
    return this.live;
  }
}
