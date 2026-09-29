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
import * as THREE from 'three';

/** Lighting zone of the overhead legends (index.ts defines it on ac.light.panel_ovhd). */
export const OZ = 'ovhd';

/** Standard Boeing overhead module width (5.75 in). */
export const MOD_W = 0.146;

/**
 * Legend size factor over the nominal heights used in the layout tables: SCBG 1:1 overhead drawing, position
 * legends ~2.5 mm and titles ~3-3.5 mm cap height (nominal 0.0017-0.0022 x 1.45).
 */
export const TXT = 1.45;

/**
 * Minimum nominal legend height (m, before TXT): Boeing panel lettering is ~2.4-3.5 mm cap height and every
 * legend is legible from the seat; layout-table values below this are clamped so the smallest engravings render
 * >= ~1.9 mm instead of aliasing away (fix round 1 B738-L10 / G19).
 */
export const MIN_LEGEND_H = 0.0013;

/**
 * Overhead plate material: the ceiling faces down and is lit only by indirect fill, so with the shared 'panel'
 * albedo it rendered a markedly darker olive grey than the direct-lit MIP (day capture view_7 vs the light
 * Boeing grey of paneloverhead_737-700.jpg). EST: a ~18 % lighter albedo of the same grey family brings the
 * shadowed overhead to the same rendered tone (fix round 1 B738-L11).
 */
export function ovhdPanelMaterial(env: CockpitEnv): THREE.Material {
  return env.materials.custom('paint', 0x6c6e68, 0.85);
}

/**
 * A Boeing overhead module plate on `parent` (top-left convention of the parent), centred at (x, y),
 * with its own top-left convention and four DZUS fasteners.
 */
export function module(parent: Panel, name: string, x: number, y: number, w: number, h: number, material?: THREE.Material): Panel {
  const i = 0.0055;
  return parent.subPanel({
    name,
    x,
    y,
    width: w,
    height: h,
    origin: 'top-left',
    material: material ?? 'panel',
    radius: 0.002,
    screws: { kind: 'dzus', diameter: 0.0062, positions: [[i, i], [w - i, i], [i, h - i], [w - i, h - i]] },
  });
}

export class Ovhd {
  /**
   * `origin`: the module's top-left corner in the parent overhead's coordinates. Every method then takes
   * coordinates in the parent (overhead-absolute) frame, as measured on the SCBG drawing; `X` / `Y` convert.
   */
  constructor(
    readonly env: CockpitEnv,
    readonly p: Panel,
    readonly origin: readonly [number, number] = [0, 0],
  ) {}

  X(x: number): number {
    return x - this.origin[0];
  }

  Y(y: number): number {
    return y - this.origin[1];
  }

  label(text: string, x: number, y: number, h = 0.0021, weight = 800): void {
    this.p.label(text, this.X(x), this.Y(y), { height: Math.max(h, MIN_LEGEND_H) * TXT, zone: OZ, weight });
  }

  /** Multi-line label (lines stacked downwards, first line at y). */
  labels(lines: string[], x: number, y: number, h = 0.0019): void {
    const hh = Math.max(h, MIN_LEGEND_H);
    lines.forEach((l, k) => this.label(l, x, y + k * hh * TXT * 1.4, hh));
  }

  /** Group bracket (title centred, ticks down) in the overhead zone. */
  bracket(title: string, x: number, y: number, w: number, h = 0.0021): void {
    this.p.bracket(title, this.X(x), this.Y(y), w, { height: h * TXT, zone: OZ });
  }

  line(x0: number, y0: number, x1: number, y1: number, w = 0.0005): void {
    this.p.line(this.X(x0), this.Y(y0), this.X(x1), this.Y(y1), w, OZ);
  }

  annun(id: string, label: string, segments: LegendSegment[], x: number, y: number, w = 0.022, h = 0.012): AnnunciatorLight {
    return this.p.add(new AnnunciatorLight(this.env, { id, label, width: w, height: h, segments, layout: 'stack' }), this.X(x), this.Y(y));
  }

  toggle(o: ToggleSwitchOptions & { id: string }, x: number, y: number, name?: string | false, scale = 0.8): ToggleSwitch {
    return this.p.add(
      new ToggleSwitch(this.env, { scale, ...o, labels: { name: name === false ? undefined : (name ?? o.label ?? true), positions: true, height: 0.0017 * TXT, zone: OZ } }),
      this.X(x),
      this.Y(y),
    );
  }

  guarded(o: ToggleSwitchOptions & { id: string; guard: GuardOptions }, x: number, y: number, name?: string | false, scale = 0.8): GuardedSwitch {
    return this.p.add(
      new GuardedSwitch(this.env, {
        scale,
        ...o,
        // Boeing spring-loaded flip-cover guard: a low-profile hinged cover (EST ~16 x 32 x 9 mm; b737.org.uk
        // overhead photographs), not a tall box.
        guard: { width: 0.0165 * scale, length: 0.032 * scale, height: 0.009 * scale, ...o.guard },
        labels: { name: name === false ? undefined : (name ?? o.label ?? true), positions: true, height: 0.0017 * TXT, zone: OZ },
      }),
      this.X(x),
      this.Y(y),
    );
  }

  button(o: PushButtonOptions & { id: string }, x: number, y: number): PushButton {
    return this.p.add(new PushButton(this.env, { style: 'round', width: 0.009, zone: OZ, ...o }), this.X(x), this.Y(y));
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
        labelHeight: Math.max(o.labelHeight ?? 0.0017, MIN_LEGEND_H) * TXT,
        labelRadius: o.labelRadius,
        title: o.title,
        cap: o.cap ?? 'pointer',
        labelZone: OZ,
        zone: OZ,
      }),
      this.X(x),
      this.Y(y),
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
      this.X(x),
      this.Y(y),
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

/**
 * Overhead module on `parent` spanning (x0, y0)-(x1, y1) in the parent's top-left frame; the returned Ovhd takes
 * parent-frame coordinates (SCBG drawing measurements).
 */
export function moduleAbs(env: CockpitEnv, parent: Panel, name: string, x0: number, y0: number, x1: number, y1: number): Ovhd {
  const w = x1 - x0;
  const h = y1 - y0;
  return new Ovhd(env, module(parent, name, x0 + w / 2, y0 + h / 2, w, h, ovhdPanelMaterial(env)), [x0, y0]);
}

/**
 * Quarter-turn "INDEX TO LOCK" panel latch (SCBG overhead drawing: one at each lower corner of the forward and aft
 * overheads): black plate with a chrome turn bar and the engraved legend. Static geometry only (not a control).
 */
export function indexLock(env: CockpitEnv, parent: Panel, x: number, y: number): void {
  const pl = parent.subPanel({ name: `${parent.name}.index_lock_${x.toFixed(3)}`, x, y, width: 0.026, height: 0.03, origin: 'top-left', material: 'plasticBlack', radius: 0.003, screws: false });
  const bar = new THREE.Mesh(env.geometry.get('b738.index_lock_bar', () => new THREE.BoxGeometry(0.004, 0.022, 0.004)), env.materials.get('chrome'));
  bar.userData.cockpitStatic = true;
  pl.addObject(bar, 0.013, 0.015, { z: 0.002 });
  const knob = new THREE.Mesh(env.geometry.get('b738.index_lock_knob', () => new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 16).rotateX(Math.PI / 2)), env.materials.get('chrome'));
  knob.userData.cockpitStatic = true;
  pl.addObject(knob, 0.013, 0.015, { z: 0.003 });
  pl.label('INDEX TO LOCK', 0.004, 0.015, { height: 0.0016, zone: OZ });
}
