/**
 * Keyboard / joystick command mapping (docs/modules/app.md §4.3) onto the G650
 * cockpit vars: thrust levers 0 IDLE .. 1 MAX with an integral reverse range to
 * -1 (reverser levers lifted), flaps UP / 10 / 20 / 39, gear handle DN = 1,
 * speed brake handle 0 .. 1 (no ARMED detent: GND SPOILER is a separate
 * switch, LUC flight controls), parking brake handle.
 */
import type { AircraftInputMap } from '../types';
import { G650_VARS as V } from './vars';

export const G650_INPUT_MAP: AircraftInputMap = {
  throttles: [V.tla(1), V.tla(2)],
  throttleRange: [0, 1],
  reverse: { value: -1 },
  flaps: { var: V.flapLever, detents: [0, 1, 2, 3] },
  gear: { var: V.gearHandle, up: 0, down: 1 },
  speedbrake: { var: V.speedbrake, positions: [0, 0.5, 1] },
  parkingBrake: { var: V.parkBrake, on: 1, off: 0 },
  apToggleEvent: 'epic.gp.ap',
  atDisconnectEvent: 'at.disc',
};
