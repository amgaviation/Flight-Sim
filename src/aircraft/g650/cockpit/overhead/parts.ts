/**
 * Building blocks of the G650 overhead and side consoles (aircraft-local):
 *
 *  - `SwitchLight`: a Gulfstream square push-button switchlight whose press can map the current value of
 *    its var to any next value (`next`). Two such buttons share one multi-state var where the aircraft has
 *    a pair of switchlights for one function (AUX PUMP "OFF/ARM" + "ON", ISOLATION "OPEN" + "CLOSED",
 *    CABIN PRESSURE "AUTO/SEMI" + "MANUAL", EMERGENCY POWER "OFF/ARM" + "ON"; LUC system notes).
 *  - `sl()`: places one with its engraved name above it.
 *  - `section()`: the white outline and title of an overhead section (Flickr G650ER overhead: panels
 *    "divided by white lines and clearly labeled").
 *  - `G650Readout`: small digital readout (APU EGT / RPM, oxygen pressures) drawn on a canvas, powered from
 *    the panel's electrical load.
 */
import type * as THREE from 'three';
import { PushButton, type PushButtonOptions, type LegendSegment } from '../../../../cockpit/controls';
import type { CockpitEnv } from '../../../../cockpit/env';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { COCKPIT_SOUNDS } from '../../../../cockpit/types';
import { CanvasDisplay, type DisplayCanvas } from '../../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../../avionics/common/draw/context';
import type { SimVars } from '../../../../core/SimVars';
import { SL } from './layout';

export interface SwitchLightOptions extends PushButtonOptions {
  /** Press maps the var's current value to the next one (all reachable values must be in `values`). */
  next?: (current: number) => number;
}

export class SwitchLight extends PushButton {
  private readonly nextFn: ((current: number) => number) | null;
  private readonly boundVar: string | null;

  constructor(env: CockpitEnv, o: SwitchLightOptions) {
    super(env, o.next ? { ...o, mode: 'cycle', values: o.values ?? [0, 1, 2] } : o);
    this.nextFn = o.next ?? null;
    this.boundVar = o.var ?? null;
  }

  override doPress(): void {
    if (!this.nextFn || !this.boundVar) {
      super.doPress();
      return;
    }
    if (this.logic.pressed) return;
    this.logic.pressed = true;
    const nv = this.nextFn(this.env.vars.get(this.boundVar));
    this.logic.sync(nv);
    this.writeVar(this.boundVar, nv);
    this.playSound(COCKPIT_SOUNDS.buttonPress);
  }
}

export interface SlSpec {
  id: string;
  label: string;
  var: string;
  segments: LegendSegment[];
  /** Engraved name above the switchlight (null = none). Default = label. */
  name?: string | null;
  mode?: 'toggle' | 'momentary';
  values?: number[];
  next?: (current: number) => number;
  stateNames?: string[];
  tooltip?: string | (() => string);
}

/** Places a 19 mm switchlight at (x, y) (panel convention) with its name engraved above. */
export function sl(env: CockpitEnv, panel: Panel, s: SlSpec, x: number, y: number, topLeft = true): SwitchLight {
  const btn = panel.add(
    new SwitchLight(env, {
      id: s.id,
      label: s.label,
      var: s.var,
      mode: s.mode ?? 'toggle',
      values: s.values,
      next: s.next,
      stateNames: s.stateNames,
      tooltip: s.tooltip,
      style: 'korry',
      width: SL.size,
      height: SL.size,
      layout: 'stack',
      segments: s.segments,
    }),
    x,
    y,
  );
  const name = s.name === undefined ? s.label : s.name;
  if (name) {
    const lines = name.split('\n');
    const dy = topLeft ? -1 : 1;
    lines.forEach((ln, i) => panel.label(ln, x, y + dy * (0.0138 + (lines.length - 1 - i) * 0.0031), { height: 0.0024 }));
  }
  return btn;
}

/** Section outline (white engraved lines) with its title centred in the top edge (origin 'top-left' panels). */
export function section(panel: Panel, title: string, x0: number, y0: number, x1: number, y1: number): void {
  const w = 0.0006;
  const tw = Math.min(x1 - x0 - 0.01, title.length * 0.0026 + 0.008);
  const cx = (x0 + x1) / 2;
  panel.line(x0, y0, cx - tw / 2, y0, w);
  panel.line(cx + tw / 2, y0, x1, y0, w);
  panel.line(x1, y0, x1, y1, w);
  panel.line(x1, y1, x0, y1, w);
  panel.line(x0, y1, x0, y0, w);
  panel.label(title, cx, y0, { height: 0.003, weight: 800 });
}

// ------------------------------------------------------------------------------------------ readout

export interface ReadoutLine {
  label: string;
  var: string;
  unit: string;
  /** Display resolution (value is rounded to a multiple). */
  step: number;
}

/**
 * Two- or three-line digital readout (LED segment style, EST appearance). Blank while `powerVar` is 0.
 */
export class G650Readout extends CanvasDisplay {
  private readonly lines: ReadoutLine[];
  private readonly v: SimVars;

  constructor(id: string, vars: SimVars, lines: ReadoutLine[], powerVar: string, canvas?: DisplayCanvas) {
    super({ id, width: 192, height: 32 * lines.length + 8, vars, refreshHz: 10, powerVar, brightnessVar: null, canvas, background: '#020402' });
    this.lines = lines;
    this.v = vars;
    for (const l of lines) this.watch(l.var, l.step / 2);
  }

  protected draw(ctx: Ctx2D): void {
    ctx.font = 'bold 22px monospace';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i];
      const y = 20 + i * 32;
      const val = Math.round(this.v.get(l.var) / l.step) * l.step;
      ctx.fillStyle = '#7fe0a0';
      ctx.textAlign = 'left';
      ctx.fillText(l.label, 8, y);
      ctx.fillStyle = '#b8ffcc';
      ctx.textAlign = 'right';
      ctx.fillText(`${val.toFixed(0)}${l.unit}`, 184, y);
    }
  }
}

/** Object3D helper type re-export for builders. */
export type Obj = THREE.Object3D;
