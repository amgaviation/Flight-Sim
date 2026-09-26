/**
 * Settings and in-flight panels: graphics, audio, failures, fuel & payload,
 * checklists, keyboard help, loading screen, toasts/captions and the debug HUD.
 */
import { h, clear, button, field, select, slider } from './dom';
import type { GraphicsSettings } from '../render/RenderSystem';
import type { AudioVolumes } from '../audio/AudioEngine';
import type { FailureManager } from '../systems/failures/FailureManager';
import type { FdmConfig } from '../physics/types';
import type { SimVars } from '../core/SimVars';
import type { Checklist } from '../aircraft/types';
import { FDM, FUEL } from '../core/vars';
import { chordLabel, type KeyChord } from '../input/actions';

const KG_TO_LB = 2.2046226218;

// ------------------------------------------------------------------ graphics / audio

export function graphicsPanel(get: () => GraphicsSettings, set: (g: GraphicsSettings) => void): HTMLElement {
  const g = get();
  const upd = (patch: Partial<GraphicsSettings>) => set({ ...get(), ...patch });
  return h('div', {}, [
    field(
      'Scenery detail',
      select(
        [
          { value: 'low', label: 'Low (integrated GPUs)' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High (recommended)' },
          { value: 'ultra', label: 'Ultra' },
        ],
        g.quality,
        (v) => upd({ quality: v }),
      ),
      'Terrain LOD, view distance, clouds, airport lighting budget',
    ),
    field('Shadows', h('input', { type: 'checkbox', checked: g.shadows, onchange: (e: Event) => upd({ shadows: (e.target as HTMLInputElement).checked }) }), 'Sun shadows in the cockpit and under the aircraft'),
    field('Resolution scale', slider(g.resolutionScale, { min: 0.5, max: 1.5, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ resolutionScale: v }) })),
    field('Cockpit field of view', slider(g.cockpitFovDeg, { min: 35, max: 85, step: 1, format: (v) => `${v} deg (vertical)`, onInput: (v) => upd({ cockpitFovDeg: v }) })),
    field('Head movement', h('input', { type: 'checkbox', checked: g.headMotion, onchange: (e: Event) => upd({ headMotion: (e.target as HTMLInputElement).checked }) }), 'G-force and buffet head motion in the cockpit'),
    field('Frame-rate counter', h('input', { type: 'checkbox', checked: g.showFps, onchange: (e: Event) => upd({ showFps: (e.target as HTMLInputElement).checked }) })),
  ]);
}

export function audioPanel(get: () => AudioVolumes, set: (v: Partial<AudioVolumes>) => void, info: () => string): HTMLElement {
  const v = get();
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const row = (label: string, key: keyof AudioVolumes) => field(label, slider(v[key], { min: 0, max: 1, step: 0.05, format: pct, onInput: (x) => set({ [key]: x }) }));
  return h('div', {}, [
    row('Master', 'master'),
    row('Engines', 'engines'),
    row('Environment (wind, rain, wheels)', 'environment'),
    row('Cockpit controls', 'cockpit'),
    row('Alerts and tones', 'alerts'),
    row('Voice callouts', 'voice'),
    h('div', { class: 'amg-hint', style: 'display:block;margin-top:8px' }, info()),
  ]);
}

// ------------------------------------------------------------------ failures

export function failuresPanel(fm: FailureManager | null): HTMLElement {
  const root = h('div');
  if (!fm) {
    root.appendChild(h('div', { class: 'amg-hint', style: 'display:block' }, 'This aircraft does not publish failures.'));
    return root;
  }
  const render = () => {
    clear(root);
    const active = new Set(fm.active());
    const armed = new Map(fm.armed().map((a) => [a.id, a]));
    root.appendChild(
      h('div', { class: 'amg-row' }, [
        h('span', {}, `${active.size} active, ${armed.size} armed`),
        button('Clear all', () => (fm.clearAll(), render()), 'small danger'),
        button('Arm 1 random failure in 1-10 min', () => (fm.armRandom(1, 60, 600), render()), 'small'),
      ]),
    );
    for (const [cat, defs] of fm.byCategory()) {
      root.appendChild(h('div', { class: 'amg-section' }, cat));
      const table = h('table', { class: 'amg-table' });
      for (const d of defs) {
        const on = active.has(d.id);
        const arm = armed.get(d.id);
        table.appendChild(
          h('tr', {}, [
            h('td', { title: d.description ?? '' }, [d.name, h('div', { class: 'amg-hint' }, d.id)]),
            h('td', { class: on ? 'amg-error' : arm ? 'amg-warn' : '' }, on ? 'FAILED' : arm ? 'armed' : ''),
            h('td', {}, [
              on ? button('Repair', () => (fm.clear(d.id), render()), 'small') : button('Fail now', () => (fm.trigger(d.id), render()), 'small danger'),
              arm
                ? button('Disarm', () => (fm.disarm(d.id), render()), 'small')
                : button('Arm (random 1-10 min)', () => (fm.arm(d.id, { kind: 'window', minS: 60, maxS: 600 }), render()), 'small'),
            ]),
          ]),
        );
      }
      root.appendChild(table);
    }
  };
  render();
  return root;
}

// ------------------------------------------------------------------ fuel & payload

export interface FuelPayloadHost {
  fdm: FdmConfig;
  vars: SimVars;
  stationMass(i: number): number;
  setStationMass(i: number, kg: number): void;
  /** Re-read tank vars into the aircraft's fuel systems. */
  commitFuel(): void;
}

export function fuelPayloadPanel(host: FuelPayloadHost): HTMLElement {
  const m = host.fdm.mass;
  const summary = h('div', { class: 'amg-row' });
  const refresh = () => {
    const gw = host.vars.get(FDM.mass);
    const cg = host.vars.get(FDM.cgPctMac);
    const over = gw > m.maxTakeoffMass_kg;
    summary.textContent = '';
    summary.appendChild(h('span', { class: over ? 'amg-error' : '' }, `Gross weight ${Math.round(gw)} kg (${Math.round(gw * KG_TO_LB)} lb), MTOW ${Math.round(m.maxTakeoffMass_kg)} kg`));
    summary.appendChild(h('span', {}, `CG ${cg.toFixed(1)} % MAC`));
    summary.appendChild(h('span', {}, `Fuel ${Math.round(host.vars.get(FUEL.totalKg))} kg`));
  };
  const tanks = m.tanks.map((t, i) =>
    field(
      `${t.name} (max ${Math.round(t.capacity_kg)} kg)`,
      slider(Math.round(host.vars.get(FUEL.tankKg(i))), {
        min: 0,
        max: Math.round(t.capacity_kg),
        step: 5,
        format: (v) => `${v} kg / ${Math.round(v * KG_TO_LB)} lb`,
        onInput: (v) => {
          host.vars.set(FUEL.tankKg(i), v);
          host.commitFuel();
          setTimeout(refresh, 50);
        },
      }),
    ),
  );
  const stations = m.stations.map((s, i) =>
    field(
      `${s.name} (max ${Math.round(s.maxMass_kg)} kg)`,
      slider(Math.round(host.stationMass(i)), {
        min: 0,
        max: Math.round(s.maxMass_kg),
        step: 5,
        format: (v) => `${v} kg`,
        onInput: (v) => {
          host.setStationMass(i, v);
          setTimeout(refresh, 50);
        },
      }),
    ),
  );
  const fill = (frac: number) => {
    m.tanks.forEach((t, i) => host.vars.set(FUEL.tankKg(i), t.capacity_kg * frac));
    host.commitFuel();
  };
  refresh();
  return h('div', {}, [
    summary,
    h('div', { class: 'amg-row' }, [button('Fuel 25 %', () => fill(0.25), 'small'), button('50 %', () => fill(0.5), 'small'), button('75 %', () => fill(0.75), 'small'), button('Full', () => fill(1), 'small')]),
    h('div', { class: 'amg-hint', style: 'display:block' }, 'Changes apply immediately; reopen this page to refresh the sliders after quick-fill.'),
    h('div', { class: 'amg-section' }, 'Fuel tanks'),
    ...tanks,
    h('div', { class: 'amg-section' }, 'Payload stations'),
    ...stations,
  ]);
}

// ------------------------------------------------------------------ checklists

export class ChecklistViewer {
  readonly el: HTMLElement;
  private idx = 0;
  private readonly done = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly lists: Checklist[],
    private readonly vars: SimVars,
    onClose: () => void,
  ) {
    this.el = h('div', { class: 'amg-side' });
    const head = h('div', { class: 'amg-modal-head' }, [h('h2', {}, 'Checklists'), button('Close (K)', onClose, 'small')]);
    this.el.appendChild(head);
    this.body = h('div', { class: 'amg-modal-body' });
    this.el.appendChild(this.body);
    this.render();
    this.timer = setInterval(() => this.render(), 700);
  }
  private readonly body: HTMLElement;

  private render(): void {
    clear(this.body);
    if (this.lists.length === 0) {
      this.body.appendChild(h('div', { class: 'amg-hint' }, 'No checklists for this aircraft.'));
      return;
    }
    this.body.appendChild(
      h(
        'div',
        { class: 'amg-seg', style: 'margin-bottom:8px' },
        this.lists.map((l, i) => h('button', { class: i === this.idx ? 'active' : '', onclick: () => ((this.idx = i), this.render()) }, l.title)),
      ),
    );
    const l = this.lists[this.idx];
    this.body.appendChild(h('div', { class: 'amg-hint', style: 'display:block;margin-bottom:6px' }, `Phase: ${l.phase}. Click an item to tick it; items verified by the aircraft turn green.`));
    l.items.forEach((it, j) => {
      const key = `${this.idx}.${j}`;
      let ok = false;
      try {
        ok = it.check ? it.check(this.vars) : false;
      } catch {
        ok = false;
      }
      const ticked = this.done.has(key);
      this.body.appendChild(
        h('div', { class: `amg-check ${ticked ? 'done' : ''} ${ok ? 'auto-ok' : ''}`, onclick: () => (ticked ? this.done.delete(key) : this.done.add(key), this.render()) }, [
          h('span', {}, it.challenge),
          h('span', { class: 'amg-dots' }),
          h('span', { class: 'amg-resp' }, `${it.response}${ok ? ' ✓' : ''}`),
        ]),
      );
    });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.el.remove();
  }
}

// ------------------------------------------------------------------ help

export function helpPanel(table: { label: string; group: string; keys: KeyChord[] }[]): HTMLElement {
  const groups = new Map<string, typeof table>();
  for (const r of table) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group)!.push(r);
  }
  const root = h('div');
  for (const [g, rows] of groups) {
    root.appendChild(h('div', { class: 'amg-section' }, g));
    root.appendChild(
      h(
        'div',
        { class: 'amg-keys' },
        rows.map((r) => h('div', { class: 'amg-keyrow' }, [h('span', {}, r.label), h('span', {}, r.keys.length ? r.keys.map((k) => h('kbd', {}, chordLabel(k))) : h('span', { class: 'amg-hint' }, 'unbound'))])),
      ),
    );
  }
  root.appendChild(h('div', { class: 'amg-section' }, 'Mouse'));
  root.appendChild(
    h('div', { class: 'amg-keys' }, [
      ['Left click', 'switch / press / step up'],
      ['Right click', 'step down / secondary'],
      ['Middle click or Ctrl+click', 'push a knob'],
      ['Wheel', 'turn knobs, move levers (Shift = inner knob)'],
      ['Drag a control', 'levers, yoke, pedals, trim wheel'],
      ['Drag empty space', 'look around (cockpit) / orbit (outside)'],
      ['Wheel on empty space', 'zoom'],
    ].map(([a, b]) => h('div', { class: 'amg-keyrow' }, [h('span', {}, a), h('span', { class: 'amg-hint' }, b)]))),
  );
  return root;
}

// ------------------------------------------------------------------ modal frame

export function modal(title: string, body: HTMLElement, onClose: () => void, extra: HTMLElement[] = []): HTMLElement {
  const bg = h('div', { class: 'amg-modal-bg' }, [
    h('div', { class: 'amg-modal' }, [h('div', { class: 'amg-modal-head' }, [h('h2', {}, title), h('span', { style: 'flex:1' }), ...extra, button('Close', onClose, 'small')]), h('div', { class: 'amg-modal-body' }, body)]),
  ]);
  bg.addEventListener('pointerdown', (e) => {
    if (e.target === bg) onClose();
  });
  return bg;
}

// ------------------------------------------------------------------ loading

export class LoadingScreen {
  readonly el: HTMLElement;
  private readonly bar: HTMLDivElement;
  private readonly step: HTMLElement;
  constructor(title = 'LOADING') {
    this.bar = h('div');
    this.step = h('div', { class: 'amg-step' });
    this.el = h('div', { class: 'amg-loading' }, [h('h2', {}, title), h('div', { class: 'amg-progress' }, this.bar), this.step]);
  }
  set(progress: number, text: string): void {
    this.bar.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
    this.step.textContent = text;
  }
  error(text: string): void {
    this.step.className = 'amg-error';
    this.step.textContent = text;
  }
}

// ------------------------------------------------------------------ in-flight overlays

export class Overlays {
  readonly el: HTMLElement;
  private readonly toastEl = h('div', { class: 'amg-toast', style: 'opacity:0' });
  private readonly captionEl = h('div', { class: 'amg-caption', style: 'opacity:0' });
  private readonly pausedEl = h('div', { class: 'amg-paused', style: 'display:none' }, 'PAUSED');
  private readonly statusEl = h('div', { class: 'amg-status' });
  private readonly fpsEl = h('div', { class: 'amg-fps', style: 'display:none' });
  private readonly hudEl = h('div', { class: 'amg-hud', style: 'display:none' });
  private toastT = 0;
  private captionT = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private fps = 0;

  constructor() {
    this.el = h('div', { class: 'amg-overlays' }, [this.toastEl, this.captionEl, this.pausedEl, this.statusEl, this.fpsEl, this.hudEl]);
  }

  toast(text: string, seconds = 2): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    this.toastT = seconds;
  }

  caption(text: string): void {
    this.captionEl.textContent = text;
    this.captionEl.style.opacity = '1';
    this.captionT = 3;
  }

  setPaused(p: boolean): void {
    this.pausedEl.style.display = p ? 'block' : 'none';
  }

  setStatus(text: string): void {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
  }

  get hudVisible(): boolean {
    return this.hudEl.style.display !== 'none';
  }

  setHud(visible: boolean): void {
    this.hudEl.style.display = visible ? 'block' : 'none';
  }

  setHudText(text: string): void {
    this.hudEl.textContent = text;
  }

  showFps(on: boolean): void {
    this.fpsEl.style.display = on ? 'block' : 'none';
  }

  get framesPerSecond(): number {
    return this.fps;
  }

  update(dt: number): void {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.style.opacity = '0';
    }
    if (this.captionT > 0) {
      this.captionT -= dt;
      if (this.captionT <= 0) this.captionEl.style.opacity = '0';
    }
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsN = 0;
      this.fpsEl.textContent = `${this.fps.toFixed(0)} fps`;
    }
  }
}
