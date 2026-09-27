/**
 * Keyboard / joystick command mapping (docs/modules/app.md §4.3) for the shared 172S cockpit
 * controls. The variant adds its autopilot engage event (`apToggleEvent`).
 */
import type { AircraftInputMap } from '../types';
import { C172 } from './vars';

export const C172_INPUT_MAP: AircraftInputMap = {
  throttles: [C172.throttle],
  throttleRange: [0, 1],
  mixtures: [C172.mixture],
  mixtureRange: [0, 1],
  // Flap switch lever detents UP / 10 / 20 / FULL.
  flaps: { var: C172.flapLever, detents: [0, 1, 2, 3] },
  parkingBrake: { var: C172.parkingBrake, on: 1, off: 0 },
};
