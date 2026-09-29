/**
 * Bombardier Global 6000 catalogue metadata. Typical numbers (SPEC factsheet
 * 2017): typical cruise M0.85 (487 KTAS at FL410 ISA; AOPA 490 KTAS on a warm
 * day), initial cruise altitude at MTOW 41,000 ft, maximum operating altitude
 * 51,000 ft (TCDS 5.4). EST: rotation 125 KIAS and approach VREF + 5 ~ 125
 * KIAS at typical weights (data.ts vSpeeds; AOPA landing target 116 KIAS
 * light).
 */
import type { AircraftMeta } from '../types';

export const G6K_META: AircraftMeta = {
  id: 'global6000',
  name: 'Bombardier Global 6000',
  manufacturer: 'Bombardier',
  icaoType: 'GLEX',
  engines: 2,
  engineType: 'turbofan',
  avionics: 'Collins Pro Line Fusion (Global Vision)',
  description:
    'Ultra-long-range business jet (BD-700-1A10), 2 x Rolls-Royce BR710A2-20 (14,750 lbf), MTOW 99,500 lb, Mmo 0.89, FL510, 6,000 nm. Hydraulically powered cable flight controls with yokes, slats and Fowler flaps, stick pusher, Global Vision Flight Deck (Collins Pro Line Fusion: four 15.1 in AFDs, FCP, CTPs, CCPs, MKPs, IESI), autothrottle, RE220 APU, four VFGs and a RAT, three hydraulic systems.',
  typical: { cruiseAltFt: 41000, cruiseKtas: 488, approachKias: 125, rotateKias: 125, maxAltFt: 51000 },
  chaseDistance_m: 55,
};
