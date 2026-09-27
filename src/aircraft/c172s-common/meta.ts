/**
 * Shared catalog data for the two 172S variants (each variant sets its own id, name and
 * avionics string and spreads this).
 */
import type { AircraftMeta } from '../types';

export const C172S_META_BASE: Omit<AircraftMeta, 'id' | 'name' | 'avionics' | 'description'> = {
  manufacturer: 'Cessna (Textron Aviation)',
  icaoType: 'C172',
  engines: 1,
  engineType: 'piston',
  typical: {
    cruiseAltFt: 6000, // POH Fig 5-8 reference altitude for the 2400 RPM cruise
    cruiseKtas: 108, // POH Fig 5-8: 2400 RPM / 6000 ft / standard temperature
    approachKias: 65, // POH Sec 4: normal approach 65-75 KIAS flaps up, 60-70 flaps down
    rotateKias: 55, // POH Sec 4 normal takeoff: lift nose wheel at 55 KIAS
    maxAltFt: 14000, // POH: service ceiling 14,000 ft
  },
  chaseDistance_m: 16,
};
