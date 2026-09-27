/**
 * Application shell: owns the renderer, world, navigation database, audio,
 * input, sim loop and UI, and loads/unloads aircraft.
 *
 * Launch flow (docs/modules/app.md):
 *   main menu -> aircraft + airport/position + initial state + time + weather
 *   -> resolve weather (preset / manual / live METAR) and time
 *   -> world.ensureLoaded(start) -> FlightModel + aircraft.create(ctx)
 *   -> fdm.reposition(start) -> aircraft.applyState(state) -> run.
 *
 * Frame order (docs/ARCHITECTURE.md), driven by SimLoop:
 *   input.poll -> [systems 60 Hz, fdm 120 Hz, radios/FMS 20 Hz] ->
 *   place aircraft (floating origin) -> exterior -> cockpit runtime ->
 *   camera -> world.update -> cockpit shadows -> render -> audio -> UI.
 */
import * as THREE from 'three';
import { SimVars } from './core/SimVars';
import { EventBus } from './core/EventBus';
import { SimLoop, type FrameInfo } from './core/SimLoop';
import { FrameProfiler, type ProfileReport } from './core/FrameProfiler';
import { decimalYear } from './core/wmm';
import type { SimContext } from './core/SimContext';
import { ENV, FDM, FUEL, GPS, NAV, SIM } from './core/vars';
import type { AircraftInstance, AircraftModule, InitialState, Subsystem } from './aircraft/types';
import { FlightModel } from './physics/FlightModel';
import { World } from './world/World';
import { createNavDatabase, Fms, Radios, type Airport, type NavDatabaseImpl } from './nav';
import { CockpitRuntime } from './cockpit/CockpitRuntime';
import { FailureManager } from './systems/failures/FailureManager';
import { FuelSystem } from './systems/fuel/FuelSystem';
import { Apu } from './systems/apu/Apu';
import { AudioEngine, DEFAULT_VOLUMES, profileFromFdm, type AudioVolumes, type ListenerPose } from './audio/AudioEngine';
import { InputManager } from './input/InputManager';
import { APP_EVENTS, INPUT_EVENTS } from './input/actions';
import { ScriptedPilot, type ScriptedPilotPhase, type TakeoffLog, type TakeoffScript } from './input/ScriptedPilot';
import { RenderSystem, sanitizeGraphics, type GraphicsSettings } from './render/RenderSystem';
import { VehicleNode } from './render/VehicleNode';
import { CameraSystem, type CameraControlInput, type CameraMode, type CameraMotionInput } from './render/CameraSystem';
import { CockpitShadows } from './render/CockpitShadows';
import { createStorage, type KeyValueStore } from './platform/storage';
import { toggleFullscreen, platformLabel, getBridge } from './platform/env';
import { h } from './ui/dom';
import { injectStyles } from './ui/styles';
import { MainMenu } from './ui/MainMenu';
import { PauseMenu, settingsModal } from './ui/PauseMenu';
import { ChecklistViewer, LoadingScreen, Overlays, helpPanel, modal, type FuelPayloadHost } from './ui/panels';
import { daysInYear, launchFromQuery, resolveTime, sanitizeLaunch, type LaunchConfig, type TimeConfig } from './ui/launch';
import { findAircraft, defaultAircraftId, type MenuAircraft } from './ui/catalog';
import { planStart, type StartPlacement, type StartSpot } from './ui/startPosition';
import { applyWeather, presetWeather, metarToWeather, type WeatherState } from './ui/weather/weather';
import { fetchMetar, fetchNearestMetar } from './ui/weather/liveMetar';
import type { WeatherConfig } from './ui/WeatherPanel';

interface Session {
  entry: MenuAircraft;
  module: AircraftModule;
  fdm: FlightModel;
  ctx: SimContext;
  instance: AircraftInstance;
  runtime: CockpitRuntime;
  systems: Subsystem[];
  /** Radios/FMS the app added (updated at 20 Hz in the loop's nav callback). */
  navSystems: Subsystem[];
  radios: Radios | null;
  failures: FailureManager | null;
  fuelSystems: FuelSystem[];
  airport: Airport;
  placement: StartPlacement;
  weather: WeatherState;
}

/** Scripting/diagnostics API (smoke test, console). */
export interface SimDebugApi {
  phase: string;
  ready: boolean;
  error: string;
  frames: number;
  get(name: string): number;
  getString(name: string): string;
  set(name: string, value: number): void;
  emit(event: string, payload?: unknown): void;
  vars(prefixes?: string[]): Record<string, number>;
  view(mode: CameraMode | 'next'): string;
  pause(p: boolean): void;
  /** Zoom the current view (notches, + = in). */
  zoom(notches: number): void;
  stats(): Record<string, unknown>;
  launch(cfg: Partial<LaunchConfig>): Promise<void>;
  /**
   * Per-frame JS time by stage since the last reset (performance.now()
   * counters, see core/FrameProfiler). `reset` starts a new window after
   * reading.
   */
  profile(reset?: boolean): ProfileReport;
  /**
   * The visible opaque surface under a screen point (NDC, -1..1, +y up):
   * nearest visible mesh along the camera ray, skipping transparent
   * materials (clouds, glass) and non-mesh objects. `kind` classifies it.
   */
  pick(ndcX: number, ndcY: number): PickResult | null;
  /** Cockpit displays: power, render counters and the fraction of lit (non-black) canvas pixels. */
  displays(): DisplayProbe[];
  /** World ground sample under the aircraft (surface type, elevation, precise = terrain tile loaded). */
  ground(): { surface: string; elevation_m: number; precise: boolean };
  /** Scripted test pilot (input/ScriptedPilot) flying through the normal pilot inputs. */
  pilot: {
    /**
     * Starts a hands-off takeoff from the current position. Defaults: VR =
     * aircraft `typical.rotateKias`, course and centre line = the start
     * runway (else the current heading and position). Returns the phase.
     */
    takeoff(opts?: Partial<TakeoffScript>): ScriptedPilotPhase;
    stop(): void;
    state(): { phase: ScriptedPilotPhase; log: TakeoffLog };
  };
}

export interface PickResult {
  name: string;
  parent: string;
  kind: 'aircraft' | 'terrain' | 'airport' | 'base-ground' | 'other';
  distance_m: number;
}

export interface DisplayProbe {
  id: string;
  powered: boolean;
  booting: boolean;
  renders: number;
  uploads: number;
  /** Fraction of sampled canvas pixels that are not black (0..1). */
  lit: number;
}

/** Frame stages measured by the profiler (App.frame order; `total` spans input poll to UI). */
const PROFILE_SECTIONS = ['total', 'input', 'systems', 'physics', 'nav', 'vehicle', 'cockpit', 'camera', 'world', 'shadows', 'render', 'audio', 'ui'] as const;
type ProfileSectionName = (typeof PROFILE_SECTIONS)[number];

declare global {
  interface Window {
    __sim?: SimDebugApi;
  }
}

const LISTENER: ListenerPose = { position_m: [0, 0, 0], forward: [1, 0, 0], up: [0, 0, -1] };
/** Per-frame camera inputs, filled in place (no allocation per frame). */
const _camCtl: CameraControlInput = { lookX: 0, lookY: 0, zoomRate: 0 };
const _camMotion: CameraMotionInput = { nx: 0, ny: 0, nz: 1, buffet: 0, onGround: false, gsKt: 0, trackDeg: 0, speed_ms: 0, vs_ms: 0 };
const _pickRay = new THREE.Raycaster();
const _pickNdc = new THREE.Vector2();

function effectivelyVisible(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function isOpaque(m: THREE.Material | THREE.Material[]): boolean {
  const mat = Array.isArray(m) ? m[0] : m;
  return !!mat && mat.visible && mat.depthWrite && !(mat.transparent && mat.opacity < 0.99);
}

/** Fraction of non-black pixels on a display canvas (16 x 16 sample grid). Diagnostics only. */
function litFraction(canvas: HTMLCanvasElement | OffscreenCanvas): number {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx || canvas.width < 2 || canvas.height < 2) return 0;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let lit = 0;
  const n = 16;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = Math.floor(((i + 0.5) / n) * canvas.width);
      const y = Math.floor(((j + 0.5) / n) * canvas.height);
      const k = (y * canvas.width + x) * 4;
      if (data[k] + data[k + 1] + data[k + 2] > 24) lit++;
    }
  }
  return lit / (n * n);
}
const _camWorld = new THREE.Vector3();
/** Longest wait for the terrain under a ground start (see App.loadScenery). */
const GROUND_START_WAIT_MS = 120_000;

export class App {
  readonly vars = new SimVars();
  readonly events = new EventBus();
  readonly settings: KeyValueStore = createStorage('settings');
  readonly overlays = new Overlays();
  readonly vehicle = new VehicleNode();
  readonly profiler = new FrameProfiler<ProfileSectionName>(PROFILE_SECTIONS);
  private readonly P = {
    total: this.profiler.id('total'),
    input: this.profiler.id('input'),
    systems: this.profiler.id('systems'),
    physics: this.profiler.id('physics'),
    nav: this.profiler.id('nav'),
    vehicle: this.profiler.id('vehicle'),
    cockpit: this.profiler.id('cockpit'),
    camera: this.profiler.id('camera'),
    world: this.profiler.id('world'),
    shadows: this.profiler.id('shadows'),
    render: this.profiler.id('render'),
    audio: this.profiler.id('audio'),
    ui: this.profiler.id('ui'),
  };
  render!: RenderSystem;
  world!: World;
  nav!: NavDatabaseImpl;
  audio!: AudioEngine;
  input!: InputManager;
  /** Scripted test pilot (smoke test, `window.__sim.pilot`); idle unless started. */
  pilot!: ScriptedPilot;
  loop!: SimLoop;
  camera!: CameraSystem;
  shadows!: CockpitShadows;

  private readonly root: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly ui: HTMLElement;
  private graphics: GraphicsSettings;
  private volumes: AudioVolumes;
  private cfg: LaunchConfig;
  private session: Session | null = null;
  /**
   * Vars that existed before the first aircraft was created (app, world,
   * input, weather and time state). Everything else belongs to an aircraft
   * and is removed when it is unloaded (see dropAircraftVars).
   */
  private appVarKeys: Set<string> | null = null;
  private appStringKeys: Set<string> | null = null;
  private menu: MainMenu | null = null;
  private pause: PauseMenu | null = null;
  private help: HTMLElement | null = null;
  private checklist: ChecklistViewer | null = null;
  private settingsDlg: { el: HTMLElement; dispose(): void } | null = null;
  private loading: LoadingScreen | null = null;
  private autotest = false;
  private hudTimer = 0;
  private statusKey = -1;
  /** Days in the simulated year (for the UTC clock's day-of-year wrap). */
  private daysInYear = 365;
  private crashedShown = false;
  private readonly errorsSeen = new Set<string>();
  readonly debug: SimDebugApi;

  constructor(root: HTMLElement) {
    this.root = root;
    injectStyles();
    this.viewport = h('div', { class: 'amg-viewport', style: 'position:fixed;inset:0' });
    this.ui = h('div', { class: 'amg-ui' });
    root.appendChild(this.viewport);
    root.appendChild(this.overlays.el);
    root.appendChild(this.ui);
    this.graphics = sanitizeGraphics(this.settings.get<Partial<GraphicsSettings> | null>('graphics', null));
    this.volumes = { ...DEFAULT_VOLUMES, ...this.settings.get<Partial<AudioVolumes>>('audio', {}) };
    this.cfg = sanitizeLaunch(this.settings.get<unknown>('launch', null), defaultAircraftId());
    this.debug = this.createDebugApi();
    window.__sim = this.debug;
  }

  // ================================================================== boot

  async start(search = ''): Promise<void> {
    this.setPhase('boot');
    const query = launchFromQuery(search, this.cfg);
    this.autotest = !!query?.autotest;
    const qp = new URLSearchParams(search);
    const q = qp.get('quality');
    if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') this.graphics.quality = q;
    else if (this.autotest) this.graphics = { ...this.graphics, quality: 'low', resolutionScale: 0.75 };
    if (this.autotest) this.graphics = { ...this.graphics, shadows: qp.get('shadows') !== '0' && this.graphics.shadows };

    const loading = this.showLoading('AMG FLIGHT SIMULATOR');
    try {
      this.render = new RenderSystem(this.viewport, this.graphics);
    } catch (e) {
      loading.error(`WebGL could not start: ${e instanceof Error ? e.message : String(e)}. Update the graphics driver or enable hardware acceleration.`);
      this.setPhase('error', String(e));
      return;
    }
    loading.set(0.1, 'Loading navigation database...');
    this.nav = createNavDatabase({ onProgress: (m) => loading.set(0.3, m) });
    try {
      await this.nav.load();
    } catch (e) {
      loading.error(`Navigation database failed to load: ${e instanceof Error ? e.message : String(e)}`);
      this.setPhase('error', String(e));
      return;
    }
    loading.set(0.7, 'Starting renderer and world...');
    this.world = new World({ scene: this.render.scene, vars: this.vars, nav: this.nav, events: this.events, renderer: this.render.renderer, quality: this.graphics.quality });
    this.render.scene.add(this.vehicle.object);
    this.camera = new CameraSystem({
      scene: this.render.scene,
      vehicle: this.vehicle.object,
      frame: this.world.frame,
      nav: this.nav,
      groundAt: (lat, lon) => this.world.elevationAt(lat, lon),
      cockpitFovDeg: this.graphics.cockpitFovDeg,
    });
    this.camera.onModeChange = (mode, label) => {
      this.vehicle.setViewInside(mode === 'cockpit');
      if (this.session) this.overlays.toast(label, 1.6);
    };
    this.render.onResize = (w, hgt) => this.camera.setAspect(w / Math.max(1, hgt));
    this.render.resize();
    this.shadows = new CockpitShadows(this.world.environment.sunLight);
    this.audio = new AudioEngine({ vars: this.vars });
    this.audio.setVolumes(this.volumes);
    const prevSpeak = this.audio.callouts.onSpeak;
    this.audio.callouts.onSpeak = (t, p) => {
      prevSpeak?.(t, p);
      this.overlays.caption(t);
    };
    this.input = new InputManager({ vars: this.vars, events: this.events, viewElement: this.render.canvas, storage: createStorage('input'), audio: this.audio });
    this.pilot = new ScriptedPilot(this.vars, this.events);
    this.loop = new SimLoop(
      this.vars,
      {
        input: (dt) => {
          // First callback of every frame: the 'total' section runs from here to the end of frame().
          this.profiler.begin(this.P.total);
          this.profiler.begin(this.P.input);
          this.input.poll(dt);
          this.profiler.end(this.P.input);
        },
        systems: (dt) => this.stepSystems(dt),
        physics: (dt) => this.stepPhysics(dt),
        nav: (dt) => this.stepNav(dt),
        frame: (f) => this.frame(f),
      },
      { events: this.events },
    );
    this.applyGraphics(this.graphics);
    this.wireEvents();
    const resume = () => this.audio.resume();
    window.addEventListener('pointerdown', resume, { capture: true });
    window.addEventListener('keydown', resume, { capture: true });
    window.addEventListener('error', (e) => this.reportError('window', e.error ?? e.message));
    window.addEventListener('unhandledrejection', (e) => this.reportError('promise', e.reason));
    this.hideLoading();

    if (query) {
      const { autotest: _a, ...cfg } = query;
      void _a;
      await this.launch(cfg);
    } else this.showMenu();
  }

  private setPhase(phase: string, error = ''): void {
    this.debug.phase = phase;
    if (error) this.debug.error = error;
    document.body.dataset.simPhase = phase;
  }

  private reportError(where: string, e: unknown): void {
    const msg = e instanceof Error ? `${e.message}` : String(e);
    const key = `${where}:${msg}`;
    if (this.errorsSeen.has(key)) return;
    this.errorsSeen.add(key);
    console.error(`[AMG ${where}]`, e);
    this.overlays?.toast(`Error in ${where}: ${msg}`, 5);
  }

  // ================================================================== menus and modals

  private showLoading(title: string): LoadingScreen {
    this.hideLoading();
    this.loading = new LoadingScreen(title);
    this.ui.appendChild(this.loading.el);
    return this.loading;
  }

  private hideLoading(): void {
    this.loading?.el.remove();
    this.loading = null;
  }

  private showMenu(): void {
    this.setPhase('menu');
    this.input.enabled = false;
    this.menu?.el.remove();
    this.menu = new MainMenu({
      nav: this.nav,
      config: this.cfg,
      onFly: (cfg) => {
        this.audio.resume();
        this.cfg = cfg;
        this.settings.set('launch', cfg);
        void this.launch(cfg);
      },
      onSettings: () => this.openSettings(),
      onQuit: getBridge() ? () => getBridge()!.quit() : undefined,
    });
    this.ui.appendChild(this.menu.el);
  }

  private hideMenu(): void {
    this.menu?.el.remove();
    this.menu = null;
  }

  private openSettings(): void {
    this.settingsDlg?.dispose();
    this.settingsDlg = settingsModal(this.pauseHost(), () => {
      this.settingsDlg?.dispose();
      this.settingsDlg = null;
    });
    this.ui.appendChild(this.settingsDlg.el);
  }

  private syncInputEnabled(): void {
    this.input.enabled = !!this.session && !this.pause && !this.settingsDlg && !this.menu && !this.loading;
  }

  private openPause(tab = 0): void {
    if (!this.session || this.pause) return;
    this.loop.setPaused(true);
    this.pause = new PauseMenu(this.pauseHost(), tab);
    this.ui.appendChild(this.pause.el);
    this.syncInputEnabled();
  }

  private closePause(resume = true): void {
    this.pause?.dispose();
    this.pause = null;
    if (resume) this.loop.setPaused(false);
    this.syncInputEnabled();
  }

  private toggleHelp(): void {
    if (this.help) {
      this.help.remove();
      this.help = null;
      return;
    }
    const close = () => {
      this.help?.remove();
      this.help = null;
    };
    this.help = modal('Keyboard and mouse', helpPanel(this.input.actionTable()), close);
    this.ui.appendChild(this.help);
  }

  private toggleChecklist(): void {
    if (this.checklist) {
      this.checklist.dispose();
      this.checklist = null;
      return;
    }
    if (!this.session) return;
    this.checklist = new ChecklistViewer(this.session.instance.checklists ?? [], this.vars, () => this.toggleChecklist());
    this.ui.appendChild(this.checklist.el);
  }

  private pauseHost() {
    return {
      nav: this.nav,
      input: this.input,
      config: () => this.cfg,
      resume: () => this.closePause(true),
      quitToMenu: () => this.quitToMenu(),
      reposition: (airport: string, spot: StartSpot, state: InitialState) => this.reposition(airport, spot, state),
      setTime: (t: TimeConfig) => this.setTime(t),
      applyWeather: (c: WeatherConfig, w: WeatherState) => {
        this.cfg = { ...this.cfg, weather: c };
        this.settings.set('launch', this.cfg);
        applyWeather(this.vars, w, this.session?.fdm.wind ?? null);
        if (this.session) this.session.weather = w;
        this.overlays.toast(`Weather: ${w.name}`);
      },
      position: () => ({ lat: this.vars.get(FDM.lat), lon: this.vars.get(FDM.lon) }),
      fieldElevationFt: () => this.session?.airport.elevationFt ?? 0,
      failures: () => this.session?.failures ?? null,
      fuel: (): FuelPayloadHost | null => {
        const s = this.session;
        if (!s) return null;
        return {
          fdm: s.module.fdm,
          vars: this.vars,
          stationMass: (i) => s.fdm.massModel.stationMass[i] ?? 0,
          setStationMass: (i, kg) => s.fdm.setStationMass(i, kg),
          commitFuel: () => {
            for (const f of s.fuelSystems) f.reset();
          },
        };
      },
      graphics: () => this.graphics,
      setGraphics: (g: GraphicsSettings) => this.applyGraphics(g),
      volumes: () => this.volumes,
      setVolumes: (v: Partial<AudioVolumes>) => {
        this.volumes = { ...this.volumes, ...v };
        this.audio.setVolumes(this.volumes);
        this.settings.set('audio', this.volumes);
      },
      audioInfo: () => `${this.audio.active ? 'Audio running' : 'Audio starts after the first click or key press'}. Voice callouts: ${this.audio.callouts.available ? 'speech synthesis' : 'not available (captions + chime)'}. Platform: ${platformLabel()}.`,
    };
  }

  private applyGraphics(g: GraphicsSettings): void {
    const prev = this.graphics;
    this.graphics = g;
    if (!this.autotest) this.settings.set('graphics', g);
    this.render.applySettings(g);
    if (!this.world) return;
    if (prev.quality !== g.quality || this.world.quality !== g.quality) this.world.setQuality(g.quality);
    this.world.environment.sunLight.castShadow = g.shadows;
    this.shadows.enabled = g.shadows;
    this.camera.setCockpitFov(g.cockpitFovDeg);
    this.camera.headMotion = g.headMotion;
    this.overlays.showFps(g.showFps);
  }

  private wireEvents(): void {
    const ev = this.events;
    ev.on(APP_EVENTS.menu, () => {
      if (this.help) return this.toggleHelp();
      if (this.settingsDlg) {
        this.settingsDlg.dispose();
        this.settingsDlg = null;
        return;
      }
      if (this.pause) return this.closePause(true);
      if (this.session && !this.loading) this.openPause(0);
    });
    ev.on(APP_EVENTS.help, () => this.toggleHelp());
    ev.on(APP_EVENTS.checklist, () => this.toggleChecklist());
    ev.on(APP_EVENTS.debug, () => this.overlays.setHud(!this.overlays.hudVisible));
    ev.on(APP_EVENTS.fullscreen, () => void toggleFullscreen());
    ev.on(APP_EVENTS.viewCockpit, () => this.camera.cockpitNext());
    ev.on(APP_EVENTS.viewExternal, () => this.camera.externalNext());
    ev.on(APP_EVENTS.viewNext, () => this.camera.cycle(1));
    ev.on(APP_EVENTS.viewPrev, () => this.camera.cycle(-1));
    ev.on(APP_EVENTS.viewReset, () => this.camera.reset());
    ev.on(INPUT_EVENTS.mouseYokeToggle, () => {
      const on = this.input.mouseYoke.active;
      if (this.session?.runtime.interaction) this.session.runtime.interaction.enabled = !on;
      this.overlays.toast(on ? 'Mouse yoke ON (Y to release)' : 'Mouse yoke OFF');
    });
    this.vars.subscribe(SIM.paused, (v) => this.overlays.setPaused(v !== 0 && !this.pause));
    this.vars.subscribe(SIM.rate, (v) => this.overlays.toast(`Simulation rate ${v}x`));
    window.addEventListener('keydown', (e) => {
      // Full screen in Electron is handled here too (F11 would otherwise do nothing with the menu bar hidden).
      if (e.code === 'F11' && !this.session) {
        e.preventDefault();
        void toggleFullscreen();
      }
    });
  }

  // ================================================================== launch

  private async resolveWeather(c: WeatherConfig, airport: Airport, step: (t: string) => void): Promise<WeatherState> {
    if (c.mode === 'preset') return presetWeather(c.preset, airport.elevationFt);
    if (c.mode === 'manual') return JSON.parse(JSON.stringify(c.state)) as WeatherState;
    step('Fetching live METAR...');
    try {
      const live = c.station ? await fetchMetar(c.station) : await fetchNearestMetar(airport.lat, airport.lon);
      if (live) return metarToWeather(live.metar, live.elevFt);
      this.overlays.toast('No current METAR: using CAVOK', 4);
    } catch (e) {
      this.overlays.toast(`Live weather unavailable (${e instanceof Error ? e.message : String(e)}): using CAVOK`, 5);
    }
    return presetWeather('cavok', airport.elevationFt);
  }

  private setTime(t: TimeConfig): void {
    const r = resolveTime(t);
    this.vars.set(ENV.timeUtcHours, r.utcHours);
    this.vars.set(ENV.dayOfYear, r.dayOfYear);
    this.daysInYear = daysInYear(r.year);
    this.cfg = { ...this.cfg, time: t };
    this.settings.set('launch', this.cfg);
  }

  async launch(cfg: LaunchConfig): Promise<void> {
    this.cfg = cfg;
    this.hideMenu();
    this.closePause(false);
    this.setPhase('loading');
    this.debug.ready = false;
    const loading = this.showLoading('PREPARING FLIGHT');
    this.syncInputEnabled();
    const step = (p: number, t: string) => loading.set(p, t);
    try {
      step(0.05, 'Loading aircraft...');
      const entry = findAircraft(cfg.aircraftId);
      if (!entry || !entry.available) throw new Error(`Aircraft '${cfg.aircraftId}' is not available`);
      const module = await entry.load();
      const airport = this.nav.airport(cfg.airport);
      if (!airport) throw new Error(`Unknown airport '${cfg.airport}'`);

      step(0.15, 'Preparing weather...');
      const weather = await this.resolveWeather(cfg.weather, airport, (t) => step(0.18, t));
      this.unloadSession();
      this.loop.stop();
      this.setTime(cfg.time);
      applyWeather(this.vars, weather, null);

      const placement = planStart(airport, cfg.spot, cfg.state, module.meta, { dir: weather.surfaceWind.directionDeg, kt: weather.surfaceWind.speedKt });
      step(0.25, `Loading scenery around ${placement.description}...`);
      this.world.frame.recenter(placement.lat, placement.lon);
      const poll = setInterval(() => {
        const s = this.world.getStats();
        step(0.25 + Math.min(0.4, s.tilesLoaded * 0.02), `Loading scenery around ${placement.description}... (${s.tilesLoaded} tiles, ${s.terrain.pendingLoads} pending)`);
      }, 250);
      try {
        await this.loadScenery(placement.lat, placement.lon, placement.onGround);
      } finally {
        clearInterval(poll);
      }

      step(0.7, `Building ${module.meta.name}...`);
      const date = cfg.time.mode === 'now' ? new Date() : new Date(`${cfg.time.date}T12:00:00Z`);
      if (!this.appVarKeys) {
        this.appVarKeys = new Set(this.vars.keys());
        this.appStringKeys = new Set(this.vars.stringKeys());
      }
      const fdm = new FlightModel(module.fdm, this.vars, this.world, { magneticYear: decimalYear(date) });
      fdm.wind.setWindsAloft(weather.windsAloft);
      const ctx: SimContext = { vars: this.vars, events: this.events, world: this.world, nav: this.nav, audio: this.audio, fdm, storage: createStorage(`ac.${module.meta.id}`) };
      const instance = await module.create(ctx);
      const systems = instance.systems.slice();
      let radios = (systems.find((s) => s instanceof Radios) as Radios | undefined) ?? null;
      const navSystems: Subsystem[] = [];
      if (!radios) {
        radios = new Radios(ctx, { navCount: 2, adfCount: 1 });
        navSystems.push(radios);
        for (const v of [NAV.powered(1), NAV.powered(2), NAV.adfPowered(1), NAV.markerPowered, GPS.powered]) if (!this.vars.has(v)) this.vars.set(v, 1);
      }
      if (!systems.some((s) => s instanceof Fms)) navSystems.push(new Fms(ctx, { style: 'garmin', engineCount: module.meta.engines }));
      let failures = (systems.find((s) => s instanceof FailureManager) as FailureManager | undefined) ?? null;
      if (!failures) {
        failures = new FailureManager(this.vars, { events: this.events });
        for (const s of systems) {
          const f = (s as { failures?: () => ReturnType<FailureManager['list']> }).failures;
          if (typeof f === 'function') failures.register(f.call(s));
        }
        systems.unshift(failures);
      }
      const fuelSystems = systems.filter((s): s is FuelSystem => s instanceof FuelSystem);

      step(0.8, 'Positioning aircraft...');
      this.placeAndApply(fdm, instance, radios, navSystems, placement, cfg.state, airport);

      step(0.9, 'Preparing cockpit...');
      this.vehicle.setModels(instance.cockpit.root, instance.exterior);
      CockpitShadows.prepare(instance.cockpit.root);
      CockpitShadows.prepare(instance.exterior);
      const runtime = new CockpitRuntime({
        build: instance.cockpit,
        vars: this.vars,
        domElement: this.render.canvas,
        camera: this.camera.camera,
        renderer: this.render.renderer,
        interaction: {
          lookButtons: [0, 2],
          onLook: (dx, dy) => this.camera.look(dx, dy),
          onEmptyWheel: (n) => this.camera.zoom(n),
          tooltipContainer: this.ui,
        },
      });
      this.camera.setAircraft({ eye_m: instance.cockpit.eyePosition_m, views: instance.cockpit.views ?? [], chaseDistance_m: module.meta.chaseDistance_m, eyePitchDeg: instance.cockpit.eyePitchDeg });
      this.audio.configure(profileFromFdm(module.fdm, { apu: systems.some((s) => s instanceof Apu) }));
      this.input.router.setMap(instance.inputMap);
      this.session = { entry, module, fdm, ctx, instance, runtime, systems, navSystems, radios, failures, fuelSystems, airport, placement, weather };
      this.crashedShown = false;

      step(1, 'Ready');
      this.hideLoading();
      this.loop.setPaused(false);
      this.loop.resetAccumulator();
      this.loop.start();
      this.syncInputEnabled();
      this.setPhase('flying');
      this.debug.ready = true;
      this.overlays.toast(`${module.meta.name} · ${placement.description} · press H for help`, 4);
      this.render.canvas.focus();
    } catch (e) {
      this.reportError('launch', e);
      loading.error(`Could not start the flight: ${e instanceof Error ? e.message : String(e)}`);
      loading.el.appendChild(h('button', { class: 'amg-btn', type: 'button', onclick: () => (this.hideLoading(), this.showMenu()) }, 'Back to menu'));
      this.setPhase('error', e instanceof Error ? e.message : String(e));
    }
  }

  /** Reposition + initial state + radio resets (used by launch and in-flight reposition). */
  private placeAndApply(fdm: FlightModel, instance: AircraftInstance, radios: Radios | null, navSystems: Subsystem[], p: StartPlacement, state: InitialState, airport: Airport): void {
    this.pilot.stop();
    const where = { lat: p.lat, lon: p.lon, onGround: p.onGround, altFtMsl: p.onGround ? undefined : p.altFtMsl, headingTrue: p.headingTrue, iasKt: p.iasKt };
    fdm.reposition(where);
    instance.applyState(state);
    // Ground starts settle on the gear, so settle again once the state has set the gear down: repositioned
    // from the air (gear up), the first settle rests the aircraft on its belly, and the gear snapping down
    // under it threw it into the air and triggered the structural-failure crash check.
    if (p.onGround) fdm.reposition(where);
    if (p.ils) {
      // Auto-tune NAV1 to the approach ILS and set the course (magnetic).
      const mv = airport.magVar ?? this.vars.get(FDM.magVar);
      this.vars.set(NAV.activeFreq(1), p.ils.freqMhz);
      this.vars.set(NAV.obs(1), (((p.ils.courseTrue - mv) % 360) + 360) % 360);
    }
    radios?.reset();
    for (const s of navSystems) if (s !== radios) s.reset?.();
    if (state !== 'cold_dark') radios?.gps?.forceAcquired();
    this.loop.resetAccumulator();
    this.vehicle.resetInterpolation();
  }

  /** In-flight reposition with the loaded aircraft. */
  private async reposition(icao: string, spot: StartSpot, state: InitialState): Promise<void> {
    const s = this.session;
    if (!s) return;
    const airport = this.nav.airport(icao);
    if (!airport) throw new Error(`Unknown airport '${icao}'`);
    const p = planStart(airport, spot, state, s.module.meta, { dir: s.weather.surfaceWind.directionDeg, kt: s.weather.surfaceWind.speedKt });
    this.loop.setPaused(true);
    this.world.frame.recenter(p.lat, p.lon);
    await this.loadScenery(p.lat, p.lon, p.onGround);
    this.placeAndApply(s.fdm, s.instance, s.radios, s.navSystems, p, state, airport);
    s.airport = airport;
    s.placement = p;
    this.cfg = { ...this.cfg, airport: icao, spot, state };
    this.settings.set('launch', this.cfg);
    this.crashedShown = false;
    this.overlays.toast(p.description, 3);
  }

  /**
   * Streams the terrain around a start position. Ground starts wait up to
   * GROUND_START_WAIT_MS (not the world's default 25 s) for the z14 tiles:
   * placed on the fallback (airport) elevation, an aircraft whose real terrain
   * arrives a few feet lower would drop onto it and could register a hard
   * landing or crash. Offline, missing tiles end the wait at once.
   */
  private async loadScenery(lat: number, lon: number, onGround: boolean): Promise<void> {
    if (!onGround) {
      await this.world.ensureLoaded(lat, lon, 1500);
      return;
    }
    const complete = await this.world.ensureLoadedWithin(lat, lon, 2500, GROUND_START_WAIT_MS);
    if (!complete) console.warn(`Terrain around the start position did not finish loading in ${GROUND_START_WAIT_MS / 1000} s; using the fallback elevation`);
  }

  private unloadSession(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    this.pilot.stop();
    this.checklist?.dispose();
    this.checklist = null;
    this.input.router.setMap(null);
    this.input.setMouseYoke(false);
    try {
      s.runtime.dispose();
    } catch (e) {
      this.reportError('unload', e);
    }
    try {
      s.instance.dispose();
    } catch (e) {
      this.reportError('unload', e);
    }
    for (const n of s.navSystems) n.dispose?.();
    this.vehicle.setModels(null, null);
    this.dropAircraftVars();
    this.audio.configure({ engines: [], cockpitCutoffHz: 18000, cockpitGain: 1, windLevel: 0 });
    for (const id of ['stall_horn', 'stick_shaker', 'overspeed', 'ap_disconnect', 'at_disconnect', 'master_warning', 'gear_horn', 'takeoff_config', 'marker_outer', 'marker_middle', 'marker_inner']) this.audio.tone(id, false);
  }

  /**
   * Removes the unloaded aircraft's vars so the next aircraft starts from a
   * clean state. Systems initialise from vars that already exist (for
   * example LandingGear keeps `gear.pos{i}`), so without this an aircraft
   * loaded on the ground after another one's cruise state started with its
   * gear retracted and "crashed" on the runway. App-owned vars (those present
   * before the first aircraft was created, plus the input, env, sim and world
   * namespaces) are kept.
   */
  private dropAircraftVars(): void {
    const keep = this.appVarKeys;
    if (!keep) return;
    const appNs = /^(input|env|sim|world)\./;
    for (const k of [...this.vars.keys()]) if (!keep.has(k) && !appNs.test(k)) this.vars.delete(k);
    const keepS = this.appStringKeys ?? new Set<string>();
    for (const k of [...this.vars.stringKeys()]) if (!keepS.has(k) && !appNs.test(k)) this.vars.deleteString(k);
  }

  private quitToMenu(): void {
    this.closePause(false);
    this.loop.stop();
    this.unloadSession();
    this.render.renderer.clear();
    this.showMenu();
  }

  // ================================================================== loop callbacks

  private stepSystems(dt: number): void {
    const s = this.session;
    if (!s) return;
    this.profiler.begin(this.P.systems);
    // The scripted pilot (when active) overrides the frame's input.* values before the systems read them.
    this.pilot.update(dt);
    const list = s.systems;
    for (let i = 0; i < list.length; i++) {
      try {
        list[i].update(dt);
      } catch (e) {
        this.reportError(`system ${list[i].name}`, e);
      }
    }
    this.profiler.end(this.P.systems);
  }

  private stepPhysics(dt: number): void {
    const s = this.session;
    if (!s) return;
    this.profiler.begin(this.P.physics);
    try {
      // Pre-step pose for render interpolation (VehicleNode: frames fall between 120 Hz steps).
      this.vehicle.capture(s.fdm);
      s.fdm.step(dt);
    } catch (e) {
      this.reportError('flight model', e);
    }
    this.profiler.end(this.P.physics);
  }

  private stepNav(dt: number): void {
    const s = this.session;
    if (!s) return;
    this.profiler.begin(this.P.nav);
    for (const n of s.navSystems) {
      try {
        n.update(dt);
      } catch (e) {
        this.reportError(`nav ${n.name}`, e);
      }
    }
    this.profiler.end(this.P.nav);
  }

  private frame(f: FrameInfo): void {
    const s = this.session;
    const prof = this.profiler;
    const P = this.P;
    if (!s) {
      prof.end(P.total);
      return;
    }
    const dt = f.realDt;
    const v = this.vars;
    this.debug.frames++;
    // Simulated clock (UTC) advances with sim time.
    if (f.simDt > 0) {
      let t = v.get(ENV.timeUtcHours) + f.simDt / 3600;
      if (t >= 24) {
        t -= 24;
        // Day 365 (366 in a leap year) is followed by day 1.
        v.set(ENV.dayOfYear, (v.get(ENV.dayOfYear) % this.daysInYear) + 1);
      }
      v.set(ENV.timeUtcHours, t);
    }
    try {
      prof.begin(P.vehicle);
      // Draw between the last two physics states (the latest one while paused).
      const geo = this.vehicle.readSource(s.fdm, f.paused ? 1 : f.alpha);
      this.world.frame.maybeRecenter(geo.lat, geo.lon);
      this.vehicle.place(s.fdm, this.world.frame);
      s.instance.updateExterior?.(dt);
      prof.end(P.vehicle);
      prof.begin(P.cockpit);
      s.runtime.update(dt);
      prof.end(P.cockpit);
      prof.begin(P.camera);
      _camCtl.lookX = this.input.lookX;
      _camCtl.lookY = this.input.lookY;
      _camCtl.zoomRate = this.input.zoomRate;
      const cm = _camMotion;
      cm.nx = v.get(FDM.nx);
      cm.ny = v.get(FDM.ny);
      cm.nz = v.get(FDM.nz, 1);
      cm.buffet = v.get(FDM.buffet);
      cm.onGround = v.get(FDM.onGround) !== 0;
      cm.gsKt = v.get(FDM.gs);
      cm.trackDeg = v.get(FDM.trackTrue);
      cm.speed_ms = cm.gsKt * 0.514444;
      cm.vs_ms = v.get(FDM.vs) * 0.00508;
      this.camera.update(dt, _camCtl, cm, geo);
      prof.end(P.camera);
      prof.begin(P.world);
      this.world.update(dt, this.camera.camera, geo);
      prof.end(P.world);
      prof.begin(P.shadows);
      this.camera.camera.getWorldPosition(_camWorld);
      this.shadows.update(this.camera.inCockpit, _camWorld);
      prof.end(P.shadows);
      prof.begin(P.render);
      this.render.render(this.camera.camera);
      prof.end(P.render);
      prof.begin(P.audio);
      this.camera.listenerPose(LISTENER);
      this.audio.update(dt, { view: this.camera.mode, listener: LISTENER, paused: f.paused, closingSpeed_ms: this.camera.closingSpeed_ms });
      prof.end(P.audio);
    } catch (e) {
      this.reportError('frame', e);
    }
    prof.begin(P.ui);
    this.overlays.update(dt);
    this.updateStatus(dt);
    prof.end(P.ui);
    prof.end(P.total);
    prof.frame();
  }

  private updateStatus(dt: number): void {
    const v = this.vars;
    const s = this.session!;
    if (v.get(FDM.crashed) !== 0) {
      if (!this.crashedShown) {
        this.crashedShown = true;
        this.overlays.toast(`CRASHED: ${v.getString(FDM.crashReason) || 'impact'} (Esc > Position to reset)`, 8);
      }
    }
    // Status line, rebuilt only when one of its inputs changes (this runs every frame).
    const rate = v.get(SIM.rate, 1);
    const yoke = this.input.mouseYoke.active;
    const crashed = v.get(FDM.crashed) !== 0;
    const key = rate * 4 + (yoke ? 2 : 0) + (crashed ? 1 : 0);
    if (key !== this.statusKey) {
      this.statusKey = key;
      const parts: string[] = [];
      if (rate !== 1) parts.push(`${rate}x`);
      if (yoke) parts.push('MOUSE YOKE');
      if (crashed) parts.push('CRASHED');
      this.overlays.setStatus(parts.join(' · '));
    }
    this.hudTimer += dt;
    if (this.overlays.hudVisible && this.hudTimer >= 0.25) {
      this.hudTimer = 0;
      const st = this.render.stats();
      const ws = this.world.getStats();
      const n = s.module.fdm.engines.length;
      const eng: string[] = [];
      for (let i = 1; i <= n; i++) eng.push(s.module.meta.engineType === 'piston' ? `${Math.round(v.get(`eng${i}.rpm`))}rpm` : `${v.get(`eng${i}.n1_pct`).toFixed(1)}/${v.get(`eng${i}.n2_pct`).toFixed(1)}`);
      this.overlays.setHudText(
        [
          `${this.overlays.framesPerSecond.toFixed(0)} fps  ${v.get(SIM.frameMs).toFixed(1)} ms  steps ${this.loop.physicsSteps}  dropped ${this.loop.droppedTime_s.toFixed(2)} s`,
          `draw ${st.calls}  tri ${(st.triangles / 1000).toFixed(0)}k  geo ${st.geometries}  tex ${st.textures}  prog ${st.programs}`,
          `world tiles ${ws.elevationTiles} pending ${ws.terrain.pendingLoads} complete ${(ws.terrain.completeness * 100).toFixed(0)}%  airports ${ws.airports.built}`,
          `pos ${v.get(FDM.lat).toFixed(5)} ${v.get(FDM.lon).toFixed(5)}  alt ${Math.round(v.get(FDM.altMsl))} ft  agl ${Math.round(v.get(FDM.altAgl))}  ra ${Math.round(v.get(FDM.radioAlt))}`,
          `ias ${v.get(FDM.ias).toFixed(0)}  gs ${v.get(FDM.gs).toFixed(0)}  vs ${Math.round(v.get(FDM.vs))}  hdg ${v.get(FDM.headingTrue).toFixed(0)}T  pitch ${v.get(FDM.pitch).toFixed(1)}  bank ${v.get(FDM.bank).toFixed(1)}  aoa ${v.get(FDM.aoa).toFixed(1)}`,
          `mass ${Math.round(v.get(FDM.mass))} kg  cg ${v.get(FDM.cgPctMac).toFixed(1)}%  fuel ${Math.round(v.get(FUEL.totalKg))} kg  eng ${eng.join(' ')}`,
          `view ${this.camera.label()}  audio ${this.audio.active ? 'on' : 'off'} tones [${this.audio.activeTones().join(',')}]  ${this.audio.lastCallout}`,
          `env ${v.get(ENV.timeUtcHours).toFixed(2)}Z doy ${v.get(ENV.dayOfYear)}  sun ${v.get(ENV.sunElevation).toFixed(1)}  amb ${v.get(ENV.ambientLight).toFixed(2)}  ${v.getString('env.weather_name')}`,
        ].join('\n'),
      );
    }
  }

  // ================================================================== debug API

  private createDebugApi(): SimDebugApi {
    const app = this;
    return {
      phase: 'boot',
      ready: false,
      error: '',
      frames: 0,
      get: (n) => app.vars.get(n),
      getString: (n) => app.vars.getString(n),
      set: (n, x) => app.vars.set(n, x),
      emit: (e, p) => app.events.emit(e, p),
      vars(prefixes?: string[]): Record<string, number> {
        const out: Record<string, number> = {};
        for (const k of app.vars.keys()) if (!prefixes || prefixes.some((p) => k.startsWith(p))) out[k] = app.vars.get(k);
        return out;
      },
      view(mode): string {
        if (mode === 'next') app.camera.cycle(1);
        else if (mode === 'cockpit') {
          app.camera.viewIndex = 0;
          app.camera.setMode('cockpit');
        } else app.camera.setMode(mode);
        return app.camera.label();
      },
      pause: (p) => app.loop.setPaused(p),
      zoom: (n) => app.camera.zoom(n),
      stats: () => ({
        fps: app.overlays.framesPerSecond,
        render: app.render?.stats(),
        world: app.world?.getStats(),
        loop: { physicsSteps: app.loop?.physicsSteps, systemsSteps: app.loop?.systemsSteps, navSteps: app.loop?.navSteps, frames: app.loop?.frames, dropped: app.loop?.droppedTime_s },
        aircraft: app.session?.module.meta.id ?? null,
        renderer: app.render?.describe(),
        camera: app.camera ? { mode: app.camera.mode, fov: app.camera.camera.fov, pos: app.camera.camera.getWorldPosition(new THREE.Vector3()).toArray(), parent: app.camera.camera.parent?.name } : null,
        vehicle: app.vehicle.object.getWorldPosition(new THREE.Vector3()).toArray(),
        placement: app.session
          ? { description: app.session.placement.description, runway: app.session.placement.runway?.ident ?? null, ils: app.session.placement.ils ?? null, airport: app.session.airport.icao }
          : null,
      }),
      launch: (partial) => app.launch({ ...app.cfg, ...partial }),
      pick(ndcX: number, ndcY: number): PickResult | null {
        if (!app.render || !app.camera) return null;
        const cam = app.camera.camera;
        cam.updateMatrixWorld();
        _pickRay.setFromCamera(_pickNdc.set(ndcX, ndcY), cam);
        _pickRay.camera = cam;
        const hits = _pickRay.intersectObject(app.render.scene, true);
        for (const h of hits) {
          const o = h.object as THREE.Mesh;
          if (!o.isMesh || !effectivelyVisible(o) || !isOpaque(o.material)) continue;
          let kind: PickResult['kind'] = 'other';
          for (let p: THREE.Object3D | null = o; p; p = p.parent) {
            if (p === app.vehicle.object) kind = 'aircraft';
            else if (p.name === 'airports') kind = kind === 'other' ? 'airport' : kind;
            else if (p.name === 'terrain') kind = kind === 'other' ? 'terrain' : kind;
          }
          if (o.name === 'base-ground') kind = 'base-ground';
          return { name: o.name, parent: o.parent?.name ?? '', kind, distance_m: h.distance };
        }
        return null;
      },
      displays(): DisplayProbe[] {
        const s = app.session;
        if (!s) return [];
        return s.runtime.displays.handles().map((h) => ({
          id: h.display.id,
          powered: h.powered,
          booting: h.booting,
          renders: h.renders,
          uploads: h.uploads,
          lit: litFraction(h.display.canvas as HTMLCanvasElement | OffscreenCanvas),
        }));
      },
      ground() {
        const g = app.world.sampleGround(app.vars.get(FDM.lat), app.vars.get(FDM.lon));
        return { surface: String(g.surface), elevation_m: g.elevation_m, precise: g.precise };
      },
      profile(reset = false): ProfileReport {
        const r = app.profiler.report();
        if (reset) app.profiler.reset();
        return r;
      },
      pilot: {
        takeoff(opts: Partial<TakeoffScript> = {}): ScriptedPilotPhase {
          const s = app.session;
          if (!s) throw new Error('no aircraft loaded');
          const p = s.placement;
          const onRunway = !!p.runway && p.onGround;
          app.pilot.startTakeoff({
            vrKt: opts.vrKt ?? s.module.meta.typical.rotateKias,
            courseTrueDeg: opts.courseTrueDeg ?? (onRunway ? p.headingTrue : app.vars.get(FDM.headingTrue)),
            lat: opts.lat ?? (onRunway ? p.lat : undefined),
            lon: opts.lon ?? (onRunway ? p.lon : undefined),
            pitchDeg: opts.pitchDeg,
            rotateRateDegS: opts.rotateRateDegS,
            gearUp: opts.gearUp,
          });
          return app.pilot.phase;
        },
        stop: () => app.pilot.stop(),
        state: () => ({ phase: app.pilot.phase, log: { ...app.pilot.log } }),
      },
    };
  }
}
