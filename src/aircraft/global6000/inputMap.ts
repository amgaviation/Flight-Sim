/**
 * Keyboard / joystick command mapping (docs/modules/app.md 4.3) onto the
 * Global 6000 cockpit vars: thrust levers 0 IDLE .. 1 MAX with piggy-back
 * reverse levers (0 stowed .. 1 MAX REV), SLAT/FLAP lever 0 IN / 0 OUT / 6 /
 * 16 / 30, gear handle DN = 1, FLIGHT SPOILER lever RETRACT / 1/2 / FULL / MAX
 * (no ARMED detent: ground lift dumping arms automatically, MAN ARM switch on
 * the pedestal), PARK/EMER BRAKE handle.
 */
import type { AircraftInputMap } from '../types';
import { G6K_VARS as V } from './vars';

export const G6K_INPUT_MAP: AircraftInputMap = {
  throttles: [V.tla(1), V.tla(2)],
  throttleRange: [0, 1],
  reverse: { vars: [V.revLever(1), V.revLever(2)], full: 1 },
  flaps: { var: V.flapLever, detents: [0, 1, 2, 3, 4] },
  gear: { var: V.gearHandle, up: 0, down: 1 },
  speedbrake: { var: V.flightSpoiler, positions: [0, 0.5, 0.8, 1] },
  parkingBrake: { var: V.parkBrake, on: 1, off: 0 },
  apToggleEvent: 'fusion.fcp.ap',
  atDisconnectEvent: 'at.disc',
};
