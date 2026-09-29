/** Cessna 172S Skyhawk (G1000 NXi / GFC 700) catalog metadata; shared numbers from c172s-common/meta.ts. */
import type { AircraftMeta } from '../types';
import { C172S_META_BASE } from '../c172s-common/meta';

export const C172G_META: AircraftMeta = {
  ...C172S_META_BASE,
  id: 'c172-g1000',
  name: 'Cessna 172S Skyhawk (G1000 NXi)',
  avionics: 'Garmin G1000 NXi / GFC 700',
  description:
    'Four-seat trainer, Lycoming IO-360-L2A 180 hp, MTOW 2,550 lb, Vne 163 KIAS. Garmin G1000 NXi (two GDU displays, GMA 1360 audio panel, ' +
    'standby airspeed / vacuum attitude / altimeter, standby battery) and the GFC 700 autopilot with ESP.',
};
