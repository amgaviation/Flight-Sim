import type { AircraftInputMap } from '../types';
import { FLAP_DETENTS } from './data';
import { G800_VARS as V } from './vars';

/**
 * Keyboard/joystick command mapping (docs/modules/app.md §4.3): power levers,
 * piggy-back reverse levers, flap handle UP/10/20/39, gear handle (1 = DN),
 * speed brake handle (RET / mid / EXT), parking brake handle. `Z` presses the
 * GP-700 AP button (event ap.ap), Shift+T the A/T disconnect buttons (at.disc).
 */
export const G800_INPUT_MAP: AircraftInputMap = {
  throttles: [V.tla(1), V.tla(2)],
  throttleRange: [0, 1],
  reverse: { vars: [V.rev(1), V.rev(2)], full: 1 },
  flaps: { var: V.flapLever, detents: FLAP_DETENTS.map((d) => d.lever) },
  gear: { var: V.gearHandle, up: 0, down: 1 },
  speedbrake: { var: V.speedbrake, positions: [0, 0.5, 1] },
  parkingBrake: { var: V.parkBrake, on: 1, off: 0 },
  apToggleEvent: 'ap.ap',
  atDisconnectEvent: 'at.disc',
};
