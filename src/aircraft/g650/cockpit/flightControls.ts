/**
 * G650 primary flight controls in the cockpit: two control wheels (the G650
 * is "Gulfstream's last model to feature traditional, yoke-operated pilot
 * controls" with three-axis fly-by-wire; LUC: yokes mechanically
 * interconnected), rudder pedals with toe brakes (brake-by-wire, LUC
 * landing gear: pedal position transducers to the BCU), and the pilot's
 * nosewheel tiller (LUC: steer-by-wire, tiller +-80 deg).
 *
 * Yoke switches (LUC flight controls, HSTS drawing: the split pitch-trim
 * switch on the outboard horn top of each wheel): pitch trim (split rocker,
 * momentary NOSE UP / NOSE DN, -> V.yokeTrimL/R, merged by
 * systems/cockpitInputs.ts), AP / TRIM DISC (red button on the outboard horn:
 * event `ap.disc` + hold var interrupting the trim). SCOPE: the push-to-talk
 * / intercom switches are not built (no radio-transmit model to drive).
 *
 * The wheels follow the pilot inputs (input.pitch / input.roll): with FBW the
 * autopilot does not back-drive the pitch of the yokes; the roll trim motor
 * back-drive (ROLL MOTOR CONTROL, `V.yokeRollTrim`) offsets the wheel angle.
 */
import { RudderPedals, RotaryKnob, Yoke } from '../../../cockpit/controls';
import { trimBoxGeometry } from '../../../cockpit/geometry/structure';
import { G650_VARS as V } from '../vars';
import type { G650CockpitContext } from './context';
import { FLOOR_Z, PEDALS_L, PEDALS_R, TILLER, YOKE_HUB_L, YOKE_HUB_R } from './layout';

export function buildFlightControls(c: G650CockpitContext): void {
  const { b, env } = c;
  const yokes: Yoke[] = [];
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R';
    const lo = s.toLowerCase();
    const outboard = side < 0 ? 'left' : 'right';
    const yoke = b.place(
      new Yoke(env, {
        id: `g650.fc.yoke_${lo}`,
        label: side < 0 ? 'PILOT CONTROL WHEEL' : 'COPILOT CONTROL WHEEL',
        style: 'gulfstream',
        // Column pivots at the floor under the panel (hub 0.74 m above the pivot, EST).
        column: { kind: 'pivot', length: 0.7, aftDeg: 11, fwdDeg: 9 },
        rollDeg: 80,
        switches: [
          {
            anchor: `${outboard}Outboard`,
            kind: 'button',
            options: { id: `g650.fc.ap_disc_${lo}`, label: `AP / TRIM DISC (${s})`, var: side < 0 ? V.yokeDiscL : V.yokeDiscR, mode: 'momentary', event: 'ap.disc', capMaterial: 'knobRed' },
          },
          {
            anchor: `${outboard}Top`,
            kind: 'rocker',
            options: {
              id: `g650.fc.trim_${lo}`,
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
    yokes.push(yoke);
    b.place(new RudderPedals(env, { id: `g650.fc.pedals_${lo}`, label: side < 0 ? 'PILOT RUDDER PEDALS' : 'COPILOT RUDDER PEDALS', style: 'hanging', spacing: 0.3 }), {
      center_m: side < 0 ? PEDALS_L : PEDALS_R,
      facing: 'aft',
    });
  }
  // Roll-trim back-drive of the wheels (ROLL MOTOR CONTROL, G650PostLogic writes V.yokeRollTrim -1..1, EST 15 deg).
  const vars = c.ctx.vars;
  const lastBase = yokes.map(() => 0);
  const lastWritten = yokes.map(() => NaN);
  b.onUpdate(() => {
    const off = (vars.get(V.yokeRollTrim) * 15 * Math.PI) / 180;
    for (let i = 0; i < yokes.length; i++) {
      const w = yokes[i].wheel;
      // The Yoke writes its wheel angle from input.roll each frame (before this hook); add the trim offset on top.
      if (w.rotation.z !== lastWritten[i]) lastBase[i] = w.rotation.z;
      w.rotation.z = lastBase[i] - off;
      lastWritten[i] = w.rotation.z;
    }
  });

  // ---- nosewheel tiller on the forward end of the left console: -1..1 = +-80 deg (NosewheelSteering via
  // systems/cockpitInputs.ts). SCOPE: the handle stays where it is left (no centring spring modelled).
  const hz = FLOOR_Z - TILLER.center_m[2];
  b.structureMesh(trimBoxGeometry(0.16, hz, 0.2, 0.012), 'panelDark', [TILLER.center_m[0], TILLER.center_m[1], TILLER.center_m[2] + hz / 2 + 0.003]).name = 'tiller_housing';
  const mount = b.panel({ name: 'g650.tiller_mount', center_m: TILLER.center_m, facing: 'up', width: 0.15, height: 0.18, material: 'panelDark', screws: false, radius: 0.015 });
  mount.add(
    new RotaryKnob(env, {
      id: 'g650.fc.tiller',
      label: 'NOSEWHEEL TILLER',
      cap: 'skirted',
      diameter: 0.075,
      height: 0.022,
      pointer: 'line',
      dragPxPerClick: 6,
      outer: { var: V.tiller3d, min: -1, max: 1, step: 0.05, angleRange: [-110, 110], label: 'TILLER', format: (v) => `${Math.round(v * 80)}°` },
    }),
    0,
    0,
  );
  mount.label('STEERING', 0, 0.068, { height: 0.0028 });
  mount.label('L        R', 0, -0.058, { height: 0.0024 });
}
