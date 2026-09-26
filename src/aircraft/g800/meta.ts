import type { AircraftMeta } from '../types';
import { G800_LIMITS } from './data';

/**
 * Gulfstream G800 catalog data. Typical values: GAC initial cruise altitude
 * 41,000 ft at the M0.85 long-range cruise (488 KTAS, ISA); approach speed =
 * Vref + 5 at a typical 75,000 lb landing weight (data.ts vref(), EST);
 * rotation speed for a typical 78,000 lb departure (data.ts takeoffSpeeds(), EST).
 */
export const G800_META: AircraftMeta = {
  id: 'g800',
  name: 'Gulfstream G800',
  manufacturer: 'Gulfstream Aerospace',
  icaoType: 'GA8C', // ICAO Doc 8643 designator for the GVIII-G800
  engines: 2,
  engineType: 'turbofan',
  avionics: 'Honeywell Symmetry (Primus Epic)',
  description:
    'Ultra-long-range large-cabin business jet (GVIII-G800, 2 x Rolls-Royce Pearl 700, 18,250 lbf). Fly-by-wire with active control sidesticks, Symmetry flight deck with touch-screen controllers and overhead touch panels; 8,200 nm at M0.85, MMO 0.935, 51,000 ft.',
  typical: { cruiseAltFt: 41000, cruiseKtas: 488, approachKias: 129, rotateKias: 120, maxAltFt: G800_LIMITS.maxAltFt },
  chaseDistance_m: 48,
};
