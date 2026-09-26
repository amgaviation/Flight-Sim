/**
 * Citation M2 control wheels and rudder pedals.
 *
 * S&D15 §9.1: dual control-wheel columns, adjustable rudder pedals with
 * brakes, mechanical nose-wheel steering; "the elevator trim also has an
 * electric actuator controlled by switches on each pilot's control wheel".
 * S&D15 §10.3.L: "Control Wheel Steering (CWS) and AP disconnect functions
 * are controlled via switches on each yoke". The M2's push-to-talk switches
 * sit under the armrests (AOPA Pilot, March 2014: "yoke-free PTT"), so the
 * wheels carry no PTT. Photograph (S&D Figure III): leather-wrapped M-shaped
 * wheels on floor-mounted columns (EST dimensions).
 *
 * Controls:
 *  - AP/TRIM DISC (red, outboard grip): event `ap.disc` (AFCS disconnect;
 *    a second press silences the disconnect tone). SCOPE: holding it does
 *    not additionally interrupt manual electric trim.
 *  - Pitch trim split rocker (outboard grip top): `ac.m2.yoke_trim<side>`
 *    +1 nose up / -1 nose down (TrimAxis switch input, systems/flight.ts).
 *  - CWS (inboard grip, front): event `ap.cws` { pressed } (GFC 700 CWS).
 *  - Wheels / columns animate from the surface positions (mechanical
 *    controls are back-driven by the AP servos); mouse drag flies them
 *    through the cockpit.* input contract.
 */
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
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
    b.place(
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
          { anchor: `${inn}Front`, kind: 'button', options: { id: `m2.yoke${side}.cws`, label: 'CWS', style: 'small', mode: 'momentary', event: 'ap.cws', releaseEvent: 'ap.cws', capMaterial: 'knobGrey' } },
        ],
      }),
      { center_m: [YOKE_HUB.x, y, YOKE_HUB.z], facing: 'aft', tiltDeg: -8 },
    );
    b.place(
      new RudderPedals(env, { id: `m2.pedals${side}`, label: `${L ? 'PILOT' : 'COPILOT'} RUDDER PEDALS / TOE BRAKES`, style: 'hanging', spacing: 0.28, travel: 0.08, yawVar: SURF.rudder }),
      { center_m: [PEDALS.x, (L ? -1 : 1) * PEDALS.y, PEDALS.z], facing: 'aft' },
    );
  }
}
