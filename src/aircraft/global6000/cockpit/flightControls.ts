/**
 * Global 6000 primary flight controls in the cockpit: two control wheels
 * (conventional yokes driving the cable-signalled PCUs, GXFC; AOPA 2012
 * "leather-wrapped yokes"), hanging rudder pedals with toe brakes (brake-by-
 * wire, GXLG), and the pilot's NOSE STEER handwheel (GXLG: +/-75 deg).
 *
 * Control-wheel switches (GXAG / GXAF / FSB appendix 6; dossier §12.5):
 *  - AP/SP DISC (red, outboard horn): disconnects the AP (event `ap.disc`) and,
 *    held, interrupts stab trim and the stick pusher (`V.yokeDisc`,
 *    systems/cockpitInputs.ts);
 *  - pitch trim split switch (top of the outboard horn, `V.yokeTrim`);
 *  - TCS (touch control steering, front of the outboard horn): AFCS CWS while
 *    held (events `ap.cws` 1 / 0);
 *  - FPV CAGE (inboard horn, FSB "FPV Cage button on yoke"): `fusion.s{s}.fpv_cage`;
 *  - CHRONO (hub): the side's PFD chronometer start / stop (`fusion.s{s}.chrono`).
 * SCOPE: the push-to-talk / intercom switches are not built (no radio-transmit
 * model to drive).
 *
 * The wheels are animated from the surface positions (surf.elevator /
 * surf.aileron), so the autopilot back-drives them as with the real
 * cable-connected controls.
 */
import { RotaryKnob, RudderPedals, Yoke } from '../../../cockpit/controls';
import { SURF } from '../../../core/vars';
import { trimBoxGeometry } from '../../../cockpit/geometry/structure';
import { FUSION_EVENTS } from '../../../avionics/collins-fusion';
import { G6K_EVENTS, G6K_VARS as V } from '../vars';
import { G6K_LIMITS } from '../data';
import type { G6kCockpitContext } from './context';
import { FLOOR_Z, PEDALS_L, PEDALS_R, TILLER, YOKE_HUB_L, YOKE_HUB_R } from './layout';

export function buildFlightControls(c: G6kCockpitContext): void {
  const { b, env } = c;
  for (const s of [1, 2] as const) {
    const S = s === 1 ? 'L' : 'R';
    const who = s === 1 ? 'PILOT' : 'COPILOT';
    const out = s === 1 ? 'left' : 'right';
    const inb = s === 1 ? 'right' : 'left';
    const yoke = new Yoke(env, {
      id: `g6k.fc.yoke_${S.toLowerCase()}`,
      label: `${who} CONTROL WHEEL`,
      style: 'bizjet',
      column: { kind: 'pivot', length: 0.62 },
      pitchVar: SURF.elevator,
      rollVar: SURF.aileron,
      switches: [
        {
          anchor: `${out}Outboard`,
          kind: 'button',
          options: { id: `g6k.fc.ap_disc${s}`, label: `AP/SP DISC (${S})`, var: V.yokeDisc(s), mode: 'momentary', event: 'ap.disc', capMaterial: 'knobRed' },
        },
        {
          anchor: `${out}Top`,
          kind: 'rocker',
          options: {
            id: `g6k.fc.trim${s}`,
            label: `PITCH TRIM (${S})`,
            var: V.yokeTrim(s),
            positions: ['NOSE UP', 'OFF', 'NOSE DN'],
            values: [1, 0, -1],
            initial: 1,
            springs: { 0: 1, 2: 1 },
          },
        },
        {
          anchor: `${out}Front`,
          kind: 'button',
          options: { id: `g6k.fc.tcs${s}`, label: `TCS (${S})`, mode: 'momentary', event: G6K_EVENTS.tcs, releaseEvent: G6K_EVENTS.tcs, capMaterial: 'plasticBlack' },
        },
        {
          anchor: `${inb}Top`,
          kind: 'button',
          options: { id: `g6k.fc.fpv_cage${s}`, label: `FPV CAGE (${S})`, mode: 'momentary', event: G6K_EVENTS.fpvCage(s), capMaterial: 'knobGrey' },
        },
        {
          anchor: 'hubTop',
          kind: 'button',
          options: { id: `g6k.fc.chrono${s}`, label: `CHRONO (${S})`, mode: 'momentary', event: FUSION_EVENTS.chrono(s), capMaterial: 'plasticBlack' },
        },
      ],
    });
    b.place(yoke, { center_m: s === 1 ? YOKE_HUB_L : YOKE_HUB_R, facing: 'aft' });
    b.place(new RudderPedals(env, { id: `g6k.fc.pedals_${S.toLowerCase()}`, label: `${who} RUDDER PEDALS`, style: 'hanging', spacing: 0.3 }), { center_m: s === 1 ? PEDALS_L : PEDALS_R, facing: 'aft' });
  }
  // NOSE STEER handwheel on the pilot's side console (GXLG: +/-75 deg; tiller -1..1 = +/-75 deg via cockpitInputs.ts).
  // SCOPE: the handwheel stays where it is left (no centring spring modelled).
  const hz = FLOOR_Z - TILLER.center_m[2];
  b.structureMesh(trimBoxGeometry(0.1, hz, 0.12, 0.01), 'panelDark', [TILLER.center_m[0], TILLER.center_m[1], TILLER.center_m[2] + hz / 2 + 0.002]).name = 'tiller_housing';
  const mount = b.panel({ name: 'tiller_mount', center_m: TILLER.center_m, facing: 'up', width: 0.11, height: 0.13, material: 'panelDark', screws: false, radius: 0.012 });
  mount.add(
    new RotaryKnob(env, {
      id: 'g6k.tiller',
      label: 'NOSE STEER HANDWHEEL',
      cap: 'skirted',
      diameter: 0.075,
      height: 0.02,
      pointer: 'line',
      dragPxPerClick: 6,
      outer: { var: V.tiller3d, min: -1, max: 1, step: 0.05, angleRange: [-110, 110], label: 'NOSE STEER', format: (v) => `${Math.round(v * G6K_LIMITS.tillerMaxDeg)}°` },
    }),
    0,
    0,
  );
  mount.label('NOSE STEER', 0, 0.055, { height: 0.0026, zone: 'panel_l' });
}
