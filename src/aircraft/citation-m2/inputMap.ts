/** Keyboard / joystick command mapping of the Citation M2 (docs/modules/app.md §4.3). */
import type { AircraftInputMap } from '../types';
import { M2 } from './vars';

export const M2_INPUT_MAP: AircraftInputMap = {
  throttles: [M2.tla(1), M2.tla(2)],
  throttleRange: [0, 1], // IDLE .. TO; CUTOFF (-0.1) only through the cockpit lever gate
  // Flap handle detents UP / 15 / 35; the 60 deg ground-flap detent only from the cockpit handle (prohibited in flight, TCDS).
  flaps: { var: M2.flapHandle, detents: [0, 1, 2] },
  gear: { var: M2.gearHandle, up: 0, down: 1 },
  speedbrake: { var: M2.speedbrake, positions: [0, 1] },
  parkingBrake: { var: M2.parkBrake, on: 1, off: 0 },
  apToggleEvent: 'g3k.gmc.key_ap',
};
