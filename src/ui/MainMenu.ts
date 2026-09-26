/**
 * Main menu: aircraft selection, departure airport and position (runway,
 * parking or automatic into-wind runway), initial state, date/time and
 * weather, then FLY.
 */
import type { NavDatabase, Airport } from '../nav/types';
import { appVersion, platformLabel } from '../platform/env';
import { h, clear, button } from './dom';
import { menuAircraft } from './catalog';
import { STATES, type LaunchConfig } from './launch';
import { parkingSpots, usableRunways } from './startPosition';
import { WeatherPanel } from './WeatherPanel';

export interface MainMenuOptions {
  nav: NavDatabase;
  config: LaunchConfig;
  onFly: (cfg: LaunchConfig) => void;
  onSettings: () => void;
  onQuit?: () => void;
}

export class MainMenu {
  readonly el: HTMLElement;
  private cfg: LaunchConfig;
  private readonly o: MainMenuOptions;
  private airport: Airport | undefined;
  private readonly acBody = h('div', { class: 'amg-col-body' });
  private readonly aptBody = h('div', { class: 'amg-col-body' });
  private readonly envBody = h('div', { class: 'amg-col-body' });
  private readonly summary = h('div', { class: 'amg-summary' });
  private weather!: WeatherPanel;
  private searchResults: Airport[] = [];

  constructor(o: MainMenuOptions) {
    this.o = o;
    this.cfg = o.config;
    this.airport = o.nav.airport(this.cfg.airport);
    this.el = h('div', { class: 'amg-screen amg-menu' }, [
      h('div', { class: 'amg-header' }, [
        h('h1', {}, 'AMG FLIGHT SIMULATOR'),
        h('span', { class: 'amg-sub' }, `v${appVersion()} · ${platformLabel()}`),
        h('span', { class: 'amg-spacer' }),
        button('Controls, graphics & audio', () => o.onSettings()),
        o.onQuit ? button('Quit', () => o.onQuit!(), 'danger') : null,
      ]),
      h('div', { class: 'amg-cols' }, [
        h('div', { class: 'amg-col' }, [h('h3', {}, 'Aircraft'), this.acBody]),
        h('div', { class: 'amg-col' }, [h('h3', {}, 'Departure'), this.aptBody]),
        h('div', { class: 'amg-col' }, [h('h3', {}, 'Time & weather'), this.envBody]),
      ]),
      h('div', { class: 'amg-footer' }, [this.summary, h('button', { class: 'amg-btn primary', type: 'button', onclick: () => this.fly(), id: 'amg-fly' }, 'FLY')]),
      h(
        'div',
        { class: 'amg-attrib' },
        'Terrain: AWS Terrain Tiles (Mapzen/Tilezen; 3DEP, SRTM, GMTED2010 courtesy of the U.S. Geological Survey, ETOPO1 NOAA, and others). Airports & navaids: OurAirports (public domain), FAA CIFP, FlightGear navdata (GPL). Magnetic model: NOAA WMM2025. Weather: aviationweather.gov.',
      ),
    ]);
    this.renderAircraft();
    this.renderAirport();
    this.renderEnv();
    this.updateSummary();
  }

  get config(): LaunchConfig {
    return this.cfg;
  }

  private fly(): void {
    const ac = menuAircraft().find((a) => a.id === this.cfg.aircraftId);
    if (!ac?.available || !this.airport) return;
    this.cfg.weather = this.weather.config;
    this.o.onFly(this.cfg);
  }

  private renderAircraft(): void {
    clear(this.acBody);
    for (const a of menuAircraft()) {
      const sel = a.id === this.cfg.aircraftId;
      this.acBody.appendChild(
        h(
          'div',
          {
            class: `amg-card ${sel ? 'selected' : ''} ${a.available ? '' : 'disabled'}`,
            title: a.available ? '' : 'This aircraft module is not built yet',
            onclick: () => {
              if (!a.available) return;
              this.cfg.aircraftId = a.id;
              this.renderAircraft();
              this.updateSummary();
            },
          },
          [
            h('div', { class: 'amg-title' }, [a.name, a.available ? null : h('span', { class: 'amg-badge warn' }, 'in development')]),
            h('div', { class: 'amg-meta' }, a.avionics),
          ],
        ),
      );
    }
  }

  private renderAirport(): void {
    clear(this.aptBody);
    const input = h('input', { class: 'amg-input amg-search', placeholder: 'Search ICAO, name or city', value: this.airport ? this.airport.icao : this.cfg.airport, id: 'amg-airport-search' });
    const results = h('div');
    const renderResults = () => {
      clear(results);
      for (const a of this.searchResults) {
        results.appendChild(
          h('div', { class: `amg-list-item ${a.icao === this.airport?.icao ? 'selected' : ''}`, onclick: () => this.selectAirport(a) }, [
            h('span', {}, [h('strong', {}, a.icao), ` ${a.name}`]),
            h('span', { class: 'amg-dim' }, `${a.municipality || ''} ${a.country}`),
          ]),
        );
      }
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    input.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const q = input.value.trim();
        this.searchResults = q.length >= 2 ? this.o.nav.searchAirports(q, 12).filter((a) => a.type !== 'heliport' && a.type !== 'closed') : [];
        renderResults();
      }, 120);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.searchResults[0]) this.selectAirport(this.searchResults[0]);
    });
    this.aptBody.appendChild(input);
    this.aptBody.appendChild(results);
    renderResults();
    const a = this.airport;
    if (!a) {
      this.aptBody.appendChild(h('div', { class: 'amg-hint', style: 'display:block;margin-top:10px' }, this.o.nav.ready ? 'Select a departure airport.' : 'Navigation database not loaded.'));
      return;
    }
    this.aptBody.appendChild(
      h('div', { style: 'margin-top:10px' }, [
        h('div', { class: 'amg-title' }, `${a.icao} · ${a.name}`),
        h('div', { class: 'amg-hint', style: 'display:block' }, `${a.municipality}, ${a.country} · elevation ${Math.round(a.elevationFt)} ft`),
      ]),
    );
    this.aptBody.appendChild(h('div', { class: 'amg-section' }, 'Initial state'));
    this.aptBody.appendChild(
      h(
        'div',
        { class: 'amg-seg' },
        STATES.map((s) =>
          h('button', { class: s.id === this.cfg.state ? 'active' : '', title: s.hint, onclick: () => ((this.cfg.state = s.id), this.renderAirport(), this.updateSummary()) }, s.label),
        ),
      ),
    );
    this.aptBody.appendChild(h('div', { class: 'amg-section' }, 'Position'));
    const spot = this.cfg.spot;
    const item = (label: string, detail: string, selected: boolean, onclick: () => void) =>
      h('div', { class: `amg-list-item ${selected ? 'selected' : ''}`, onclick }, [h('span', {}, label), h('span', { class: 'amg-dim' }, detail)]);
    this.aptBody.appendChild(item('Automatic', 'runway most into the wind', spot.kind === 'auto', () => ((this.cfg.spot = { kind: 'auto' }), this.renderAirport(), this.updateSummary())));
    for (const r of usableRunways(a)) {
      const ils = r.ils ? ` · ILS ${r.ils.ident} ${r.ils.freqMhz.toFixed(2)}` : '';
      this.aptBody.appendChild(
        item(`Runway ${r.ident}`, `${Math.round(r.lengthFt)} x ${Math.round(r.widthFt)} ft · ${r.surface}${ils}`, spot.kind === 'runway' && spot.runway === r.ident.toUpperCase(), () => {
          this.cfg.spot = { kind: 'runway', runway: r.ident.toUpperCase() };
          this.renderAirport();
          this.updateSummary();
        }),
      );
    }
    const parking = parkingSpots(a);
    if (parking.length && (this.cfg.state === 'cold_dark' || this.cfg.state === 'ready_to_taxi')) {
      for (const p of parking) {
        this.aptBody.appendChild(
          item(p.name, 'generic apron', spot.kind === 'parking' && spot.index === p.index, () => {
            this.cfg.spot = { kind: 'parking', index: p.index };
            this.renderAirport();
            this.updateSummary();
          }),
        );
      }
    }
  }

  private selectAirport(a: Airport): void {
    this.airport = a;
    this.cfg.airport = a.icao;
    this.cfg.spot = { kind: 'auto' };
    this.searchResults = [];
    this.renderAirport();
    this.updateSummary();
  }

  private renderEnv(): void {
    clear(this.envBody);
    const t = this.cfg.time;
    this.envBody.appendChild(h('div', { class: 'amg-section', style: 'margin-top:0' }, 'Date & time (UTC)'));
    const dateIn = h('input', { type: 'date', class: 'amg-input', value: t.date });
    const timeIn = h('input', { type: 'time', class: 'amg-input', value: `${String(Math.floor(t.utcHours) % 24).padStart(2, '0')}:${String(Math.round((t.utcHours % 1) * 60) % 60).padStart(2, '0')}` });
    const setCustom = () => {
      const [hh, mm] = timeIn.value.split(':').map(Number);
      this.cfg.time = { mode: 'custom', date: dateIn.value || t.date, utcHours: (hh || 0) + (mm || 0) / 60 };
      this.renderEnv();
      this.updateSummary();
    };
    dateIn.addEventListener('change', setCustom);
    timeIn.addEventListener('change', setCustom);
    const lon = this.airport?.lon ?? 0;
    // Local mean solar time -> UTC: UTC = LMST - lon/15.
    const solar = (localH: number) => (((localH - lon / 15) % 24) + 24) % 24;
    const preset = (label: string, localH: number) =>
      button(label, () => {
        this.cfg.time = { mode: 'custom', date: this.cfg.time.date, utcHours: solar(localH) };
        this.renderEnv();
        this.updateSummary();
      }, 'small');
    this.envBody.appendChild(
      h('div', { class: 'amg-row' }, [
        button('Now', () => ((this.cfg.time = { ...this.cfg.time, mode: 'now' }), this.renderEnv(), this.updateSummary()), `small ${t.mode === 'now' ? 'active' : ''}`),
        preset('Dawn', 6),
        preset('Morning', 9.5),
        preset('Noon', 12.5),
        preset('Dusk', 18.8),
        preset('Night', 22.5),
      ]),
    );
    this.envBody.appendChild(h('div', { class: 'amg-row' }, [dateIn, timeIn, h('span', { class: 'amg-hint' }, t.mode === 'now' ? 'using the current time' : `local solar ~${fmtH(t.utcHours + lon / 15)}`)]));
    this.envBody.appendChild(h('div', { class: 'amg-section' }, 'Weather'));
    this.weather = new WeatherPanel({
      config: this.cfg.weather,
      elevationFt: () => this.airport?.elevationFt ?? 0,
      position: () => (this.airport ? { lat: this.airport.lat, lon: this.airport.lon } : null),
      onChange: (c) => {
        this.cfg.weather = c;
        this.updateSummary();
      },
    });
    this.envBody.appendChild(this.weather.el);
  }

  private updateSummary(): void {
    const ac = menuAircraft().find((a) => a.id === this.cfg.aircraftId);
    const st = STATES.find((s) => s.id === this.cfg.state)?.label ?? this.cfg.state;
    const pos = this.cfg.spot.kind === 'runway' ? `runway ${this.cfg.spot.runway}` : this.cfg.spot.kind === 'parking' ? `apron ${this.cfg.spot.index + 1}` : 'auto runway';
    const w = this.cfg.weather.mode === 'preset' ? this.cfg.weather.preset.toUpperCase() : this.cfg.weather.mode === 'live' ? 'live METAR' : 'manual weather';
    this.summary.textContent = `${ac?.name ?? this.cfg.aircraftId} · ${this.airport?.icao ?? this.cfg.airport} ${pos} · ${st} · ${this.cfg.time.mode === 'now' ? 'now' : `${this.cfg.time.date} ${fmtH(this.cfg.time.utcHours)}Z`} · ${w}`;
    const fly = this.el.querySelector<HTMLButtonElement>('#amg-fly');
    if (fly) fly.disabled = !ac?.available || !this.airport;
  }
}

function fmtH(hours: number): string {
  const x = ((hours % 24) + 24) % 24;
  const hh = Math.floor(x);
  const mm = Math.round((x - hh) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
