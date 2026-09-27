/**
 * 737-800 primary flight controls in the flight deck: the two control
 * columns with Boeing ram's-horn wheels (FCOM 9.10), rudder pedals with toe
 * brakes, and the Captain's nose-wheel steering tiller (FCOM 14.10 "tiller
 * ... +/-78 deg"; the F/O tiller is an option not fitted here).
 *
 * Wheel switches (FCOM 9.10 / 4.10; dossier §10.16):
 *  - Stabilizer trim switches on the outboard horn (split switch: both halves
 *    move together here), spring-loaded to neutral: `yoke_trim{1,2}`
 *    (NOSE DN -1 / NOSE UP +1), read by the stabilizer TrimAxis.
 *  - A/P disengage switch on the outboard horn: event `ap.disc` (AFDS
 *    disconnect; a second push silences the warning).
 *  - Microphone switch on the inboard horn: MIC / OFF / INT (`yoke_mic{1,2}`),
 *    spring-loaded to OFF; the ACP logic publishes the keyed transmitter
 *    (SCOPE: no radio transmission / audio model).
 *
 * The wheels and columns are animated from the surface positions
 * (`surf.elevator` / `surf.aileron`): the 737 columns are back-driven by the
 * autopilot actuators.
 */
import { RotaryKnob, RudderPedals, Yoke } from '../../../cockpit/controls';
import { SURF } from '../../../core/vars';
import { B738 } from '../vars';
import type { B738CockpitContext } from './context';
import { PEDALS_L, PEDALS_R, TILLER, YOKE_HUB_L, YOKE_HUB_R, FLOOR_Z } from './layout';

export function buildFlightControls(c: B738CockpitContext): void {
  const { b, env } = c;
  for (const s of [1, 2] as const) {
    const L = s === 1;
    const outboard = L ? 'left' : 'right';
    const inboard = L ? 'right' : 'left';
    const name = L ? 'CAPT' : 'F/O';
    const hub = L ? YOKE_HUB_L : YOKE_HUB_R;
    b.place(
      new Yoke(env, {
        id: `b738.fc.yoke${s}`,
        label: `${name} CONTROL WHEEL`,
        style: 'boeing',
        // Column pivots at the floor torque tube (EST 0.72 m below the hub).
        column: { kind: 'pivot', length: FLOOR_Z - hub[2] + 0.02, aftDeg: 11, fwdDeg: 9 },
        rollDeg: 90,
        pitchVar: SURF.elevator,
        rollVar: SURF.aileron,
        switches: [
          {
            anchor: `${outboard}Top`,
            kind: 'rocker',
            options: {
              id: `b738.fc.trim${s}`,
              label: `${name} STAB TRIM`,
              var: B738.yokeTrim(s),
              positions: ['NOSE UP', 'OFF', 'NOSE DN'],
              values: [1, 0, -1],
              initial: 1,
              springs: { 0: 1, 2: 1 },
            },
          },
          {
            // Microphone switch on the inboard horn (FCOM 5.10): MIC keys the ACP-selected transmitter, INT the
            // flight interphone; spring-loaded to OFF.
            anchor: `${inboard}Top`,
            kind: 'rocker',
            options: {
              id: `b738.fc.mic${s}`,
              label: `${name} MIC / INT`,
              var: B738.yokeMic(s),
              positions: ['MIC', 'OFF', 'INT'],
              values: [1, 0, -1],
              initial: 1,
              springs: { 0: 1, 2: 1 },
            },
          },
          {
            anchor: `${outboard}Outboard`,
            kind: 'button',
            options: { id: `b738.fc.ap_disc${s}`, label: `${name} A/P DISENGAGE`, mode: 'momentary', event: 'ap.disc', capMaterial: 'knobRed' },
          },
        ],
      }),
      { center_m: hub, facing: 'aft' },
    );
    b.place(new RudderPedals(env, { id: `b738.fc.pedals${s}`, label: `${name} RUDDER / BRAKE PEDALS`, style: 'hanging', spacing: 0.3 }), {
      center_m: L ? PEDALS_L : PEDALS_R,
      facing: 'aft',
    });
  }
  // Captain tiller (left sidewall shelf).
  const mount = b.panel({ name: 'b738.tiller_mount', center_m: TILLER.center_m, facing: 'up', width: 0.12, height: 0.14, material: 'panelDark', screws: false, radius: 0.012 });
  mount.add(
    new RotaryKnob(env, {
      id: 'b738.fc.tiller',
      label: 'NOSE WHEEL STEERING TILLER',
      cap: 'skirted',
      diameter: 0.075,
      height: 0.022,
      pointer: 'line',
      dragPxPerClick: 6,
      outer: { var: B738.tiller3d, min: -1, max: 1, step: 0.05, angleRange: [-95, 95], label: 'TILLER', format: (v) => `${Math.round(v * 78)}°` },
    }),
    0,
    0,
  );
  mount.label('NOSE WHEEL STEERING', 0, 0.058, { height: 0.0024 });
  mount.label('L', -0.05, 0.035, { height: 0.003 });
  mount.label('R', 0.05, 0.035, { height: 0.003 });
}
