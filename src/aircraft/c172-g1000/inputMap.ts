/**
 * Keyboard / joystick command mapping (docs/modules/app.md §4.3): the shared 172S engine,
 * flap and parking-brake mapping, plus the GFC 700 AP key on the PFD bezel for the
 * simulator's AP toggle (the G1000 system forwards it to the Afcs as `ap.ap`). The trim keys
 * (`input.pitch_trim_rate`) act as the yoke MET switch (systems/variant.ts).
 */
import type { AircraftInputMap } from '../types';
import { C172_INPUT_MAP } from '../c172s-common/inputMap';
import { G1K_EVENTS } from '../../avionics/garmin-g1000/vars';

export const C172G_INPUT_MAP: AircraftInputMap = {
  ...C172_INPUT_MAP,
  apToggleEvent: G1K_EVENTS.afcsKey('pfd', 'ap'),
};
