/**
 * In-flight menu (Esc): resume, reposition, time & weather, failures, fuel &
 * payload, controls, graphics, audio, quit to the main menu. The sim is
 * paused while it is open (the host decides).
 */
import { h, clear, button, tabs } from './dom';
import type { NavDatabase, Airport } from '../nav/types';
import type { InputManager } from '../input/InputManager';
import type { GraphicsSettings } from '../render/RenderSystem';
import type { AudioVolumes } from '../audio/AudioEngine';
import type { FailureManager } from '../systems/failures/FailureManager';
import type { InitialState } from '../aircraft/types';
import { ControlsPanel } from './ControlsPanel';
import { WeatherPanel, type WeatherConfig } from './WeatherPanel';
import type { WeatherState } from './weather/weather';
import { audioPanel, failuresPanel, fuelPayloadPanel, graphicsPanel, modal, type FuelPayloadHost } from './panels';
import { STATES, type LaunchConfig, type TimeConfig } from './launch';
import { usableRunways, type StartSpot } from './startPosition';

export interface PauseHost {
  nav: NavDatabase;
  input: InputManager;
  config(): LaunchConfig;
  resume(): void;
  quitToMenu(): void;
  reposition(airport: string, spot: StartSpot, state: InitialState): Promise<void>;
  setTime(t: TimeConfig): void;
  applyWeather(cfg: WeatherConfig, w: WeatherState): void;
  position(): { lat: number; lon: number };
  fieldElevationFt(): number;
  failures(): FailureManager | null;
  fuel(): FuelPayloadHost | null;
  graphics(): GraphicsSettings;
  setGraphics(g: GraphicsSettings): void;
  volumes(): AudioVolumes;
  setVolumes(v: Partial<AudioVolumes>): void;
  audioInfo(): string;
}

export const PAUSE_TABS = ['Position', 'Time & weather', 'Failures', 'Fuel & payload', 'Controls', 'Graphics', 'Audio'] as const;

export class PauseMenu {
  readonly el: HTMLElement;
  private controls: ControlsPanel | null = null;

  constructor(
    private readonly host: PauseHost,
    initialTab = 0,
  ) {
    const body = tabs([...PAUSE_TABS], (i) => this.tab(i), initialTab);
    const extra = [button('Resume', () => host.resume(), 'active'), button('Quit to main menu', () => host.quitToMenu(), 'danger')];
    this.el = modal('Simulation paused', body, () => host.resume(), extra);
  }

  private tab(i: number): HTMLElement {
    this.controls?.dispose();
    this.controls = null;
    switch (PAUSE_TABS[i]) {
      case 'Position':
        return this.positionTab();
      case 'Time & weather':
        return this.timeWeatherTab();
      case 'Failures':
        return failuresPanel(this.host.failures());
      case 'Fuel & payload': {
        const f = this.host.fuel();
        return f ? fuelPayloadPanel(f) : h('div', {}, 'No aircraft loaded.');
      }
      case 'Controls':
        this.controls = new ControlsPanel(this.host.input);
        return this.controls.el;
      case 'Graphics':
        return graphicsPanel(() => this.host.graphics(), (g) => this.host.setGraphics(g));
      case 'Audio':
        return audioPanel(() => this.host.volumes(), (v) => this.host.setVolumes(v), () => this.host.audioInfo());
    }
    return h('div');
  }

  private positionTab(): HTMLElement {
    const cfg = this.host.config();
    let airport: Airport | undefined = this.host.nav.airport(cfg.airport);
    let spot: StartSpot = cfg.spot;
    let state: InitialState = cfg.state;
    const root = h('div');
    const render = () => {
      clear(root);
      const input = h('input', { class: 'amg-input amg-search', placeholder: 'Airport ICAO, name or city', value: airport?.icao ?? '' });
      const results = h('div');
      input.addEventListener('input', () => {
        clear(results);
        const q = input.value.trim();
        if (q.length < 2) return;
        for (const a of this.host.nav.searchAirports(q, 8)) {
          results.appendChild(h('div', { class: 'amg-list-item', onclick: () => ((airport = a), (spot = { kind: 'auto' }), render()) }, [h('span', {}, [h('strong', {}, a.icao), ` ${a.name}`]), h('span', { class: 'amg-dim' }, a.municipality)]));
        }
      });
      root.appendChild(input);
      root.appendChild(results);
      root.appendChild(h('div', { class: 'amg-section' }, 'State'));
      root.appendChild(h('div', { class: 'amg-seg' }, STATES.map((s) => h('button', { class: s.id === state ? 'active' : '', onclick: () => ((state = s.id), render()) }, s.label))));
      if (airport) {
        root.appendChild(h('div', { class: 'amg-section' }, `Position at ${airport.icao}`));
        root.appendChild(h('div', { class: `amg-list-item ${spot.kind === 'auto' ? 'selected' : ''}`, onclick: () => ((spot = { kind: 'auto' }), render()) }, 'Automatic (into wind)'));
        for (const r of usableRunways(airport)) {
          const sel = spot.kind === 'runway' && spot.runway === r.ident.toUpperCase();
          root.appendChild(h('div', { class: `amg-list-item ${sel ? 'selected' : ''}`, onclick: () => ((spot = { kind: 'runway', runway: r.ident.toUpperCase() }), render()) }, [h('span', {}, `Runway ${r.ident}`), h('span', { class: 'amg-dim' }, `${Math.round(r.lengthFt)} ft${r.ils ? ' · ILS' : ''}`)]));
        }
      }
      const status = h('span', { class: 'amg-hint' });
      root.appendChild(
        h('div', { class: 'amg-row', style: 'margin-top:12px' }, [
          button('Reposition', () => {
            if (!airport) return;
            status.textContent = 'Loading scenery...';
            this.host.reposition(airport.icao, spot, state).then(
              () => this.host.resume(),
              (e) => (status.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`),
            );
          }, 'active'),
          status,
        ]),
      );
    };
    render();
    return root;
  }

  private timeWeatherTab(): HTMLElement {
    const cfg = this.host.config();
    const t = cfg.time;
    const dateIn = h('input', { type: 'date', class: 'amg-input', value: t.date });
    const hh = Math.floor(t.utcHours) % 24;
    const mm = Math.round((t.utcHours % 1) * 60) % 60;
    const timeIn = h('input', { type: 'time', class: 'amg-input', value: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` });
    const weather = new WeatherPanel({
      config: cfg.weather,
      elevationFt: () => this.host.fieldElevationFt(),
      position: () => this.host.position(),
      applyButton: true,
      onChange: (c, w) => {
        if (w) this.host.applyWeather(c, w);
      },
    });
    return h('div', {}, [
      h('div', { class: 'amg-section', style: 'margin-top:0' }, 'Date & time (UTC)'),
      h('div', { class: 'amg-row' }, [
        dateIn,
        timeIn,
        button('Set time', () => {
          const [a, b] = timeIn.value.split(':').map(Number);
          this.host.setTime({ mode: 'custom', date: dateIn.value || t.date, utcHours: (a || 0) + (b || 0) / 60 });
        }, 'small'),
        button('Now', () => this.host.setTime({ mode: 'now', date: t.date, utcHours: t.utcHours }), 'small'),
      ]),
      h('div', { class: 'amg-section' }, 'Weather'),
      weather.el,
    ]);
  }

  dispose(): void {
    this.controls?.dispose();
    this.el.remove();
  }
}

/** Settings-only modal for the main menu (controls, graphics, audio). */
export function settingsModal(host: Pick<PauseHost, 'input' | 'graphics' | 'setGraphics' | 'volumes' | 'setVolumes' | 'audioInfo'>, onClose: () => void): { el: HTMLElement; dispose(): void } {
  let controls: ControlsPanel | null = null;
  const body = tabs(['Controls', 'Graphics', 'Audio'], (i) => {
    controls?.dispose();
    controls = null;
    if (i === 0) {
      controls = new ControlsPanel(host.input);
      return controls.el;
    }
    if (i === 1) return graphicsPanel(() => host.graphics(), (g) => host.setGraphics(g));
    return audioPanel(() => host.volumes(), (v) => host.setVolumes(v), () => host.audioInfo());
  });
  const el = modal('Settings', body, onClose);
  return {
    el,
    dispose(): void {
      controls?.dispose();
      el.remove();
    },
  };
}
