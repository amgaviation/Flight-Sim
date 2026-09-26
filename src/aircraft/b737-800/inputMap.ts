/** Keyboard / joystick command mapping of the 737-800 (docs/modules/app.md §4.3). */
import type { AircraftInputMap } from '../types';
import { B737_EVENTS } from '../../avionics/boeing-737';
import { B738, GEAR_LEVER, SPEEDBRAKE } from './vars';

export const B738_INPUT_MAP: AircraftInputMap = {
  throttles: [B738.tla(1), B738.tla(2)],
  throttleRange: [0, 1],
  // Piggy-back reverse thrust levers (0 stowed .. 1 full reverse).
  reverse: { vars: [B738.revLever(1), B738.revLever(2)], full: 1 },
  // Flap lever detents UP 1 2 5 10 15 25 30 40 (index 0..8).
  flaps: { var: B738.flapLever, detents: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  gear: { var: B738.gearLever, up: GEAR_LEVER.up, down: GEAR_LEVER.down },
  speedbrake: { var: B738.speedbrake, positions: [SPEEDBRAKE.down, SPEEDBRAKE.flightDetent, SPEEDBRAKE.up], armed: SPEEDBRAKE.armed },
  parkingBrake: { var: B738.parkBrake, on: 1, off: 0 },
  apToggleEvent: B737_EVENTS.mcpButton('cmd_a'),
  atDisconnectEvent: 'at.disc',
};
