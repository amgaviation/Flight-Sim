/**
 * Longitude primary flight controls in the cockpit: two control wheels
 * (conventional yokes, cable-driven elevator / ailerons, OG 15-2/15-3, BCA
 * "strictly cables and pulleys between a conventional yoke and the aileron
 * surfaces"), rudder pedals with toe brakes (brake-by-wire, OG 14), and the
 * left-seat nosewheel tiller (BCA: "a left seat tiller ... up to 80-81 deg").
 *
 * Wheels (L48): Longitude ram's-horn wheels ('ramshorn': tall grips on a flat
 * hub), hub at about the PFD bottom edge (Textron photograph, a21_004).
 * Wheel switches (dossier §7.8, c_yokeL21): AP/TRIM DISC (red, outboard grip;
 * event `ap.disc` + hold var: trim and pusher interrupt), ICS push, the split
 * pitch-trim switch and the PTT trigger on the back of the grip (L49; PTT and
 * ICS drive COM transmit / intercom state, SCOPE).
 *
 * The wheels are animated from the surface positions (surf.elevator /
 * surf.aileron) so the autopilot back-drives them, as with the real
 * cable-connected controls.
 */
import { RudderPedals, RotaryKnob, Yoke } from '../../../cockpit/controls';
import { SURF } from '../../../core/vars';
import { LON_VARS as V } from '../vars';
import { lonMaterials, type LonCockpitContext } from './context';
import { PEDALS_L, PEDALS_R, TILLER, YOKE_HUB_L, YOKE_HUB_R } from './layout';

export function buildFlightControls(c: LonCockpitContext): void {
  const { b, env } = c;
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R';
    const outboard = side < 0 ? 'left' : 'right';
    const lower = s.toLowerCase();
    b.place(
      new Yoke(env, {
        id: `lon.fc.yoke_${lower}`,
        label: side < 0 ? 'PILOT CONTROL WHEEL' : 'COPILOT CONTROL WHEEL',
        style: 'ramshorn',
        column: { kind: 'pivot', length: 0.55 },
        pitchVar: SURF.elevator,
        rollVar: SURF.aileron,
        // Outboard grip face (c_yokeL21): red AP/TRIM DISC at the top, small ICS push button beside it, the split
        // pitch-trim thumb switch below; PTT trigger on the back of the grip.
        switches: [
          {
            anchor: `${outboard}Front`,
            offset: [0, 0.03, 0],
            kind: 'button',
            options: { id: `lon.fc.ap_disc_${lower}`, label: `AP/TRIM DISC (${s})`, var: side < 0 ? V.yokeDiscL : V.yokeDiscR, mode: 'momentary', event: 'ap.disc', capMaterial: 'knobRed' },
          },
          {
            anchor: `${outboard}Front`,
            offset: [-side * 0.012, 0.018, 0],
            kind: 'button',
            // SCOPE: intercom (ICS) push; sets the ICS state (systems/crewControls.ts), no audio-panel model.
            options: { id: `lon.fc.ics_${lower}`, label: `ICS (${s})`, var: side < 0 ? V.yokeIcsL : V.yokeIcsR, mode: 'momentary', style: 'small', capMaterial: 'plasticGrey' },
          },
          {
            anchor: `${outboard}Front`,
            offset: [0, -0.006, 0],
            kind: 'rocker',
            options: {
              id: `lon.fc.trim_${lower}`,
              label: `PITCH TRIM (${s})`,
              var: side < 0 ? V.yokeTrimL : V.yokeTrimR,
              positions: ['NOSE UP', 'OFF', 'NOSE DN'],
              values: [1, 0, -1],
              initial: 1,
              springs: { 0: 1, 2: 1 },
            },
          },
          {
            anchor: `${outboard}Back`,
            kind: 'button',
            // SCOPE: PTT keys the selected COM (V.transmitting, systems/crewControls.ts); no radio-transmission model.
            options: { id: `lon.fc.ptt_${lower}`, label: `PTT (${s})`, var: side < 0 ? V.pttL : V.pttR, mode: 'momentary', style: 'key', width: 0.014, height: 0.02, capMaterial: 'plasticBlack' },
          },
        ],
      }),
      { center_m: side < 0 ? YOKE_HUB_L : YOKE_HUB_R, facing: 'aft' },
    );
    b.place(new RudderPedals(env, { id: `lon.fc.pedals_${lower}`, label: side < 0 ? 'PILOT RUDDER PEDALS' : 'COPILOT RUDDER PEDALS', style: 'hanging', spacing: 0.3 }), {
      center_m: side < 0 ? PEDALS_L : PEDALS_R,
      facing: 'aft',
    });
  }
  // Nosewheel tiller (L50, c_lcon / AOPA "tiller knob"): a small black finger-grip knob set in the forward left
  // console top, just aft of the PFD GTC wedge: -1..1 = +-81 deg nosewheel (NosewheelSteering, via
  // systems/cockpitInputs.ts). SCOPE: the handle stays where it is left (no centring spring modelled).
  const mount = b.panel({ name: 'tiller_mount', center_m: [TILLER.center_m[0], TILLER.center_m[1], TILLER.center_m[2] - 0.004], facing: 'up', width: 0.07, height: 0.07, material: lonMaterials(env).deck, screws: false, radius: 0.03 });
  mount.add(
    new RotaryKnob(env, {
      id: 'lon.tiller',
      label: 'NOSEWHEEL TILLER',
      cap: 'skirted',
      diameter: 0.045,
      height: 0.022,
      pointer: 'line',
      dragPxPerClick: 6,
      outer: { var: V.tiller3d, min: -1, max: 1, step: 0.05, angleRange: [-110, 110], label: 'TILLER', format: (v) => `${Math.round(v * 81)}°` },
    }),
    0,
    0,
  );
}
