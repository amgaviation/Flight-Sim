/**
 * Builders shared by the 737-800 forward / aft overhead and the side
 * consoles: Boeing overhead modules (Boeing grey plates on DZUS rails),
 * and zone-aware wrappers of the cockpit controls so every engraved legend
 * of the overhead is lit by the overhead PANEL dimmer (zone 'ovhd',
 * `ac.light.panel_ovhd`) instead of the main-panel backlight.
 *
 * Sizes (EST from 737NG flight-deck photographs, cross-checked against the
 * standard Boeing overhead module width of 5.75 in = 146 mm and the
 * MS24523 toggle): annunciator lenses 22 x 12 mm, toggles on a ~28-34 mm
 * pitch, guarded switches 30 mm, engraved legends 1.9-2.4 mm cap height.
 */
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import {
  AnnunciatorLight,
  GuardedSwitch,
  PushButton,
  RotaryKnob,
  SelectorKnob,
  ToggleSwitch,
  type GuardOptions,
  type LegendSegment,
  type PushButtonOptions,
  type ToggleSwitchOptions,
} from '../../../../cockpit/controls';
import type { CockpitEnv } from '../../../../cockpit/env';

/** Lighting zone of the overhead legends (index.ts defines it on ac.light.panel_ovhd). */
export const OZ = 'ovhd';

/** Standard Boeing overhead module width (5.75 in). */
export const MOD_W = 0.146;

/** Legend size factor over the nominal heights used in the layout tables (EST: NG engraving ~2.5-3 mm caps). */
export const TXT = 1.22;

/**
 * A Boeing overhead module plate on `parent` (top-left convention of the parent), centred at (x, y),
 * with its own top-left convention and four DZUS fasteners.
 */
export function module(parent: Panel, name: string, x: number, y: number, w: number, h: number): Panel {
  const i = 0.0055;
  return parent.subPanel({
    name,
    x,
    y,
    width: w,
    height: h,
    origin: 'top-left',
    material: 'panel',
    radius: 0.002,
    screws: { kind: 'dzus', diameter: 0.0062, positions: [[i, i], [w - i, i], [i, h - i], [w - i, h - i]] },
  });
}

export class Ovhd {
  constructor(
    readonly env: CockpitEnv,
    readonly p: Panel,
  ) {}

  label(text: string, x: number, y: number, h = 0.0021, weight = 700): void {
    this.p.label(text, x, y, { height: h * TXT, zone: OZ, weight });
  }

  /** Multi-line label (lines stacked downwards, first line at y). */
  labels(lines: string[], x: number, y: number, h = 0.0019): void {
    lines.forEach((l, k) => this.label(l, x, y + k * h * TXT * 1.4, h));
  }

  /** Group bracket (title centred, ticks down) in the overhead zone. */
  bracket(title: string, x: number, y: number, w: number, h = 0.0021): void {
    this.p.bracket(title, x, y, w, { height: h * TXT, zone: OZ });
  }

  line(x0: number, y0: number, x1: number, y1: number, w = 0.0005): void {
    this.p.line(x0, y0, x1, y1, w, OZ);
  }

  annun(id: string, label: string, segments: LegendSegment[], x: number, y: number, w = 0.022, h = 0.012): AnnunciatorLight {
    return this.p.add(new AnnunciatorLight(this.env, { id, label, width: w, height: h, segments, layout: 'stack' }), x, y);
  }

  toggle(o: ToggleSwitchOptions & { id: string }, x: number, y: number, name?: string | false, scale = 0.8): ToggleSwitch {
    return this.p.add(
      new ToggleSwitch(this.env, { scale, ...o, labels: { name: name === false ? undefined : (name ?? o.label ?? true), positions: true, height: 0.0017 * TXT, zone: OZ } }),
      x,
      y,
    );
  }

  guarded(o: ToggleSwitchOptions & { id: string; guard: GuardOptions }, x: number, y: number, name?: string | false, scale = 0.8): GuardedSwitch {
    return this.p.add(
      new GuardedSwitch(this.env, {
        scale,
        ...o,
        // Boeing red spring guard (EST ~15 x 30 x 16 mm).
        guard: { width: 0.0165 * scale, length: 0.032 * scale, height: 0.019 * scale, ...o.guard },
        labels: { name: name === false ? undefined : (name ?? o.label ?? true), positions: true, height: 0.0017 * TXT, zone: OZ },
      }),
      x,
      y,
    );
  }

  button(o: PushButtonOptions & { id: string }, x: number, y: number): PushButton {
    return this.p.add(new PushButton(this.env, { style: 'round', width: 0.009, zone: OZ, ...o }), x, y);
  }

  selector(
    id: string,
    label: string,
    v: string,
    positions: { value: number; label: string; display?: string; spring?: number; gated?: boolean; angle?: number }[],
    x: number,
    y: number,
    o: { initial?: number; diameter?: number; labelHeight?: number; title?: string; cap?: 'pointer' | 'bar' | 'chicken-head' | 'wing'; labelRadius?: number } = {},
  ): SelectorKnob {
    return this.p.add(
      new SelectorKnob(this.env, {
        id,
        label,
        var: v,
        positions,
        initial: o.initial,
        diameter: o.diameter ?? 0.014,
        labelHeight: (o.labelHeight ?? 0.0017) * TXT,
        labelRadius: o.labelRadius,
        title: o.title,
        cap: o.cap ?? 'pointer',
        labelZone: OZ,
        zone: OZ,
      }),
      x,
      y,
    );
  }

  /** Continuous dimmer / temperature knob (0..1). */
  knob(id: string, label: string, v: string, x: number, y: number, o: { min?: number; max?: number; step?: number; initial?: number; diameter?: number; format?: (x: number) => string; range?: [number, number] } = {}): RotaryKnob {
    return this.p.add(
      new RotaryKnob(this.env, {
        id,
        label,
        cap: 'dimmer',
        diameter: o.diameter ?? 0.012,
        zone: OZ,
        outer: {
          var: v,
          min: o.min ?? 0,
          max: o.max ?? 1,
          step: o.step ?? 0.05,
          initial: o.initial,
          angleRange: o.range ?? [-140, 140],
          label,
          format: o.format ?? ((x) => (x < 0.02 ? 'OFF' : `${Math.round(x * 100)} %`)),
        },
      }),
      x,
      y,
    );
  }
}

/** Standard 3-position spring-to-centre switch (GEN / APU GEN / GRD PWR): OFF (-1) / 0 / ON (1). */
export const SPRING_OFF_ON: Pick<ToggleSwitchOptions, 'positions' | 'values' | 'initial' | 'springs'> = {
  positions: ['OFF', '', 'ON'],
  values: [-1, 0, 1],
  initial: 1,
  springs: { 0: 1, 2: 1 },
};

export const OFF_ON: Pick<ToggleSwitchOptions, 'positions' | 'values' | 'initial'> = { positions: ['OFF', 'ON'], values: [0, 1], initial: 0 };
