/**
 * Keyboard / joystick command mapping (docs/modules/app.md §4.3): the shared 172S engine,
 * flap and parking-brake mapping, plus the KAP 140 AP button for the simulator's AP toggle.
 * The trim keys (`input.pitch_trim_rate`) are the pilot's hand on the manual elevator trim
 * wheel (systems.ts SteamCabinExtras); the KAP 140 manual electric trim is the split switch
 * on the control wheel.
 */
import type { AircraftInputMap } from '../types';
import { C172_INPUT_MAP } from '../c172s-common/inputMap';
import { EV } from './vars';

export const C172_STEAM_INPUT_MAP: AircraftInputMap = {
  ...C172_INPUT_MAP,
  apToggleEvent: EV.kap('ap'),
};
