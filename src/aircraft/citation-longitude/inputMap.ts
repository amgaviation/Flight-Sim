/**
 * Keyboard / joystick command mapping (docs/modules/app.md §4.3) onto the
 * Longitude cockpit vars. Thrust levers are continuous 0 (IDLE) .. 1 (TO)
 * with an integral reverse range to -1 (reverser levers lifted, OG 7-3 / BCA);
 * flaps UP / 1 / 2 / FULL; gear handle DN = 1; speedbrake handle retracted .. full
 * (no ARMED detent: the ground spoilers are fully automatic, OG 15-4).
 */
import type { AircraftInputMap } from '../types';
import { LON_VARS as V } from './vars';

export const LONGITUDE_INPUT_MAP: AircraftInputMap = {
  throttles: [V.tla(1), V.tla(2)],
  throttleRange: [0, 1],
  reverse: { value: -1 },
  flaps: { var: V.flapLever, detents: [0, 1, 2, 3] },
  gear: { var: V.gearHandle, up: 0, down: 1 },
  speedbrake: { var: V.speedbrake, positions: [0, 0.5, 1] },
  parkingBrake: { var: V.parkBrake, on: 1, off: 0 },
  apToggleEvent: 'g3k.gmc.key_ap',
  atDisconnectEvent: 'at.disc',
};
