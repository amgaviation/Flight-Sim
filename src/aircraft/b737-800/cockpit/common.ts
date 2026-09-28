/**
 * Small builders shared by the 737-800 panel files (annunciators, dimmer
 * knobs, Boeing toggles) so every panel uses the same sizes and styles.
 * Sizes EST: 737 annunciator lenses ~28 x 14 mm (P1 / P3 lights), dimmer
 * knobs 12 mm, standard toggles MS24523.
 */
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { AnnunciatorLight, RotaryKnob, ToggleSwitch, type LegendSegment, type ToggleSwitchOptions } from '../../../cockpit/controls';
import type { CockpitEnv } from '../../../cockpit/env';

export function annunciator(env: CockpitEnv, p: Panel, id: string, label: string, segments: LegendSegment[], x: number, y: number, w = 0.028, h = 0.014, layout: 'stack' | 'split' = 'stack'): AnnunciatorLight {
  return p.add(new AnnunciatorLight(env, { id, label, width: w, height: h, segments, layout }), x, y);
}

/** Panel / flood dimmer knob (0 OFF .. 1 BRT). */
export function dimmer(env: CockpitEnv, p: Panel, id: string, label: string, v: string, x: number, y: number, caption?: string, diameter = 0.012): RotaryKnob {
  const k = p.add(
    new RotaryKnob(env, {
      id,
      label,
      cap: 'dimmer',
      diameter,
      outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label, format: (x) => (x < 0.02 ? 'OFF' : `${Math.round(x * 100)} %`) },
    }),
    x,
    y,
  );
  if (caption) p.label(caption, x, y + diameter / 2 + 0.006, { height: 0.0026 });
  return k;
}

/** Boeing toggle with position legends and a name. */
export function toggle(env: CockpitEnv, p: Panel, o: ToggleSwitchOptions & { id: string }, x: number, y: number, name?: string): ToggleSwitch {
  return p.add(new ToggleSwitch(env, { labels: { name: name ?? true, positions: true, height: 0.0025 }, ...o }), x, y);
}
