/**
 * Citation M2 control wheels and rudder pedals.
 *
 * S&D15 §9.1: dual control-wheel columns, adjustable rudder pedals with
 * brakes, mechanical nose-wheel steering; "the elevator trim also has an
 * electric actuator controlled by switches on each pilot's control wheel".
 * S&D15 §10.3.L: "Control Wheel Steering (CWS) and AP disconnect functions
 * are controlled via switches on each yoke". The M2's push-to-talk switches
 * sit under the armrests (AOPA Pilot, March 2014: "yoke-free PTT";
 * side/index.ts), so the wheels carry no PTT. Photographs (S&D figures): tall
 * M-shaped wheels with a grey hub shroud bearing the CITATION M2 logo plaque
 * (EST dimensions). S&D15 §10.3.H: "Two handheld microphones ... installed on
 * each of the control columns" (coiled cord visible in S&D15 Fig III): a
 * static hand mic in a holder on each column (SCOPE: the hand-mic key is not
 * modelled separately; transmit is keyed by the armrest PTT).
 *
 * Controls:
 *  - AP/TRIM DISC (red, outboard grip): event `ap.disc` (AFCS disconnect;
 *    a second press silences the disconnect tone). SCOPE: holding it does
 *    not additionally interrupt manual electric trim.
 *  - Pitch trim split rocker (outboard grip top): `ac.m2.yoke_trim<side>`
 *    +1 nose up / -1 nose down (TrimAxis switch input, systems/flight.ts).
 *  - CWS (white-ringed round button on top of the inboard horn, photos; S&D15
 *    §10.3.L CWS): event `ap.cws` { pressed } (GFC 700 CWS).
 *  - Wheels / columns animate from the surface positions (mechanical
 *    controls are back-driven by the AP servos); mouse drag flies them
 *    through the cockpit.* input contract.
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import { cylinderZ, merge, roundedBox, transform } from '../../../cockpit/geometry/primitives';
import { RudderPedals, Yoke } from '../../../cockpit/controls';
import { SURF } from '../../../core/vars';
import { M2 } from '../vars';
import { FLOOR_Z, PEDALS, YOKE_HUB } from './layout';

export function buildFlightControls(b: CockpitBuilder): void {
  const env = b.env;
  for (const side of [1, 2] as const) {
    const L = side === 1;
    const out = L ? 'left' : 'right';
    const inn = L ? 'right' : 'left';
    const y = (L ? -1 : 1) * YOKE_HUB.y;
    const yoke = b.place(
      new Yoke(env, {
        id: `m2.yoke${side}`,
        label: `${L ? 'PILOT' : 'COPILOT'} CONTROL WHEEL`,
        style: 'bizjet',
        scale: 1.05,
        column: { kind: 'pivot', length: FLOOR_Z - YOKE_HUB.z - 0.02, aftDeg: 10, fwdDeg: 8, radius: 0.024 },
        rollDeg: 80,
        pitchVar: SURF.elevator,
        rollVar: SURF.aileron,
        switches: [
          { anchor: `${out}Outboard`, kind: 'button', options: { id: `m2.yoke${side}.ap_disc`, label: 'AP/TRIM DISC', style: 'small', mode: 'momentary', event: 'ap.disc', capMaterial: 'knobRed' } },
          {
            anchor: `${out}Top`,
            kind: 'rocker',
            options: { id: `m2.yoke${side}.trim`, var: M2.yokeTrim(side), label: 'PITCH TRIM', positions: ['NOSE UP', 'OFF', 'NOSE DN'], values: [1, 0, -1], initial: 1, springs: { 0: 1, 2: 1 } },
          },
          { anchor: `${inn}Top`, kind: 'button', options: { id: `m2.yoke${side}.cws`, label: 'CWS', style: 'round', width: 0.009, mode: 'momentary', event: 'ap.cws', releaseEvent: 'ap.cws', capMaterial: 'knobWhite' } },
        ],
      }),
      { center_m: [YOKE_HUB.x, y, YOKE_HUB.z], facing: 'aft', tiltDeg: -8 },
    );
    // Grey hub shroud with the CITATION M2 logo plaque (moves with the wheel: hub anchor).
    {
      const shroud = new THREE.Mesh(env.geometry.get('m2.yoke.shroud', () => roundedBox(0.085, 0.05, 0.016, 0.01, 3)), env.materials.custom('plastic', '#6f7378', 0.5));
      shroud.position.z = 0.016;
      const plaque = env.labels.text('CITATION M2', { height: 0.0055, color: '#e8e8e8', zone: null, align: 'center' });
      plaque.position.z = 0.0245;
      yoke.anchors.hub.add(shroud, plaque);
    }
    // Hand microphone in its holder on the lower column (static; EST position 15 cm above the floor pivot).
    {
      const g = merge([
        transform(roundedBox(0.035, 0.07, 0.03, 0.01, 3), 0, 0, 0),
        transform(cylinderZ(0.008, 0.008, 0, 0.03, 12), 0, 0.045, 0),
        transform(roundedBox(0.045, 0.05, 0.012, 0.004, 2), 0, -0.01, -0.02),
      ]);
      const mic = b.structureMesh(g, 'plasticBlack', [YOKE_HUB.x + 0.02, (L ? -1 : 1) * (YOKE_HUB.y + 0.045), FLOOR_Z - 0.17], undefined, false);
      mic.name = `m2.hand_mic${side}`;
    }
    b.place(
      new RudderPedals(env, { id: `m2.pedals${side}`, label: `${L ? 'PILOT' : 'COPILOT'} RUDDER PEDALS / TOE BRAKES`, style: 'hanging', spacing: 0.28, travel: 0.08, yawVar: SURF.rudder }),
      { center_m: [PEDALS.x, (L ? -1 : 1) * PEDALS.y, PEDALS.z], facing: 'aft' },
    );
  }
}
