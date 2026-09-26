/**
 * Longitude primary flight controls in the cockpit: two control wheels
 * (conventional yokes, cable-driven elevator / ailerons, OG 15-2/15-3, BCA
 * "strictly cables and pulleys between a conventional yoke and the aileron
 * surfaces"), rudder pedals with toe brakes (brake-by-wire, OG 14), and the
 * left-seat nosewheel tiller (BCA: "a left seat tiller ... up to 80-81 deg").
 *
 * Wheel switches (dossier §7.8): AP/TRIM DISC (red, outboard grip; event
 * `ap.disc` + hold var: trim and pusher interrupt) and the split pitch-trim
 * switch (top of the outboard grip) on each wheel. SCOPE: the push-to-talk
 * and intercom switches are not built (no radio-transmit model to drive).
 *
 * The wheels are animated from the surface positions (surf.elevator /
 * surf.aileron) so the autopilot back-drives them, as with the real
 * cable-connected controls.
 */
import { RudderPedals, RotaryKnob, Yoke } from '../../../cockpit/controls';
import { SURF } from '../../../core/vars';
import { LON_VARS as V } from '../vars';
import type { LonCockpitContext } from './context';
import { FLOOR_Z, PEDALS_L, PEDALS_R, TILLER, YOKE_HUB_L, YOKE_HUB_R } from './layout';
import { trimBoxGeometry } from '../../../cockpit/geometry/structure';

export function buildFlightControls(c: LonCockpitContext): void {
  const { b, env } = c;
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R';
    const outboard = side < 0 ? 'left' : 'right';
    b.place(
      new Yoke(env, {
        id: `lon.fc.yoke_${s.toLowerCase()}`,
        label: side < 0 ? 'PILOT CONTROL WHEEL' : 'COPILOT CONTROL WHEEL',
        style: 'bizjet',
        column: { kind: 'pivot', length: 0.55 },
        pitchVar: SURF.elevator,
        rollVar: SURF.aileron,
        switches: [
          {
            anchor: `${outboard}Outboard`,
            kind: 'button',
            options: { id: `lon.fc.ap_disc_${s.toLowerCase()}`, label: `AP/TRIM DISC (${s})`, var: side < 0 ? V.yokeDiscL : V.yokeDiscR, mode: 'momentary', event: 'ap.disc', capMaterial: 'knobRed' },
          },
          {
            anchor: `${outboard}Top`,
            kind: 'rocker',
            options: {
              id: `lon.fc.trim_${s.toLowerCase()}`,
              label: `PITCH TRIM (${s})`,
              var: side < 0 ? V.yokeTrimL : V.yokeTrimR,
              positions: ['NOSE UP', 'OFF', 'NOSE DN'],
              values: [1, 0, -1],
              initial: 1,
              springs: { 0: 1, 2: 1 },
            },
          },
        ],
      }),
      { center_m: side < 0 ? YOKE_HUB_L : YOKE_HUB_R, facing: 'aft' },
    );
    b.place(new RudderPedals(env, { id: `lon.fc.pedals_${s.toLowerCase()}`, label: side < 0 ? 'PILOT RUDDER PEDALS' : 'COPILOT RUDDER PEDALS', style: 'hanging', spacing: 0.3 }), {
      center_m: side < 0 ? PEDALS_L : PEDALS_R,
      facing: 'aft',
    });
  }
  // Nosewheel tiller on the left console (dossier §7.8): -1..1 = +-81 deg nosewheel (NosewheelSteering, via
  // systems/cockpitInputs.ts). SCOPE: the handle stays where it is left (no centring spring modelled).
  // Tiller housing down to the floor (the side-console builder may enclose it in the console).
  const hz = FLOOR_Z - TILLER.center_m[2];
  b.structureMesh(trimBoxGeometry(0.1, hz, 0.12, 0.01), 'panelDark', [TILLER.center_m[0], TILLER.center_m[1], TILLER.center_m[2] + hz / 2 + 0.002]).name = 'tiller_housing';
  const mount = b.panel({ name: 'tiller_mount', center_m: TILLER.center_m, facing: 'up', width: 0.11, height: 0.13, material: 'panelDark', screws: false, radius: 0.012 });
  mount.add(
    new RotaryKnob(env, {
      id: 'lon.tiller',
      label: 'NOSEWHEEL TILLER',
      cap: 'skirted',
      diameter: 0.07,
      height: 0.02,
      pointer: 'line',
      dragPxPerClick: 6,
      outer: { var: V.tiller3d, min: -1, max: 1, step: 0.05, angleRange: [-110, 110], label: 'TILLER', format: (v) => `${Math.round(v * 81)}°` },
    }),
    0,
    0,
  );
  mount.label('TILLER', 0, 0.052, { height: 0.0026 });
}
