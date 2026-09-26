/** Citation M2 catalog metadata (numbers: FPG / TCDS, see data.ts). */
import type { AircraftMeta } from '../types';

export const M2_META: AircraftMeta = {
  id: 'citation-m2',
  name: 'Cessna Citation M2 (525)',
  manufacturer: 'Cessna / Textron Aviation',
  icaoType: 'C25M', // ICAO Doc 8643
  engines: 2,
  engineType: 'turbofan',
  avionics: 'Garmin G3000 / GFC 700',
  description:
    'Single-pilot light jet (Model 525): 2 x Williams FJ44-1AP-21 (1,965 lbf), MTOW 10,700 lb, FL410, Vmo 263 KIAS / Mmo 0.71, ' +
    'Garmin G3000 with two GDU 1400W PFDs, MFD, two GTC 570 and the GMC 710 AFCS controller.',
  typical: {
    cruiseAltFt: 37000, // FPG: typical cruise FL350-410
    cruiseKtas: 396, // FPG high-speed cruise, FL370, 9,500 lb
    approachKias: 115, // VREF 109 (MLW) + 5 kt wind additive + margin (FPG)
    rotateKias: 105, // FPG: VR at MTOW, flaps 15
    maxAltFt: 41000, // TCDS
  },
  chaseDistance_m: 22,
};
