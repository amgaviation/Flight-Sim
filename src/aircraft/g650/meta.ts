/**
 * Gulfstream G650 catalogue metadata. Typical numbers: M0.91 at FL450 =
 * 513 KTAS (AIN pilot report, ISA-7); rotation 107 KIAS at a 67,084 lb takeoff
 * (AIN); VREF 140 KIAS near maximum landing weight (LIM example); certified
 * ceiling 51,000 ft (TCDS IM.A.169 §11).
 */
import type { AircraftMeta } from '../types';

export const G650_META: AircraftMeta = {
  id: 'g650',
  name: 'Gulfstream G650',
  manufacturer: 'Gulfstream Aerospace',
  icaoType: 'GLF6',
  engines: 2,
  engineType: 'turbofan',
  avionics: 'Honeywell PlaneView II (Primus Epic)',
  description:
    'Ultra-long-range business jet, 2 x Rolls-Royce BR725 (16,900 lbf), MTOW 99,600 lb, Mmo 0.925, FL510. Three-axis fly-by-wire with yokes, Honeywell Primus Epic PlaneView II (four 14-inch DUs, SMCs, MCDUs, CCDs), autothrottle, RE220 APU, RAT.',
  typical: { cruiseAltFt: 45000, cruiseKtas: 513, approachKias: 135, rotateKias: 125, maxAltFt: 51000 },
  chaseDistance_m: 55,
};
