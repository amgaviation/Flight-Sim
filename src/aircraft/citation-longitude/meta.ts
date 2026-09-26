/**
 * Citation Longitude catalogue metadata. Typical numbers from the FPG
 * (FPG-JET-700-1019): M0.80 at FL410 = 457 KTAS (p.19); VR 120 KIAS at a
 * typical 36,500 lb takeoff weight (p.4); VREF 121-125 KIAS at 31,500-33,500 lb
 * (p.22); certified ceiling FL450 (p.2).
 */
import type { AircraftMeta } from '../types';

export const LONGITUDE_META: AircraftMeta = {
  id: 'citation-longitude',
  name: 'Cessna Citation Longitude (Model 700)',
  manufacturer: 'Textron Aviation (Cessna)',
  icaoType: 'C700',
  engines: 2,
  engineType: 'turbofan',
  avionics: 'Garmin G5000',
  description:
    'Super-midsize business jet, 2 x Honeywell HTF7700L (7,665 lbf), MTOW 39,500 lb, Mmo 0.84, FL450. Garmin G5000 with three 14-inch GDUs, four GTC 570 touchscreen controllers, autothrottle, APU, FBW rudder and spoilers, PTCU.',
  typical: { cruiseAltFt: 41000, cruiseKtas: 457, approachKias: 125, rotateKias: 120, maxAltFt: 45000 },
  chaseDistance_m: 42,
};
