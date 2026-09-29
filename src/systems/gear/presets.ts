/**
 * Ready-made data for the gear blocks. Aircraft may use them as-is or copy
 * and adjust.
 */
import type { AutobrakeLevel } from './Brakes';
import type { GearHornRule } from './LandingGear';

/**
 * 737NG autobrake selector RTO / OFF / 1 / 2 / 3 / MAX as var values
 * -1 / 0 / 1 / 2 / 3 / 4. Decelerations from the 737NG FCOM as quoted by
 * flaps2approach.com "Autobrake System – Review and Procedures" (2015):
 * 1 = 4, 2 = 5, 3 = 7.2 ft/s²; MAX = 14 ft/s² above 80 kt, 12 below.
 */
export const AUTOBRAKE_737NG: AutobrakeLevel[] = [
  { value: -1, label: 'RTO', rto: true },
  { value: 1, label: '1', decelFps2: 4 },
  { value: 2, label: '2', decelFps2: 5 },
  { value: 3, label: '3', decelFps2: 7.2 },
  { value: 4, label: 'MAX', decelFps2: 14, decelLowFps2: 12, lowSpeedKt: 80 },
];

/**
 * Generic three-tier gear warning (the pattern used by transport and
 * business jets):
 *   1. thrust retarded AND low altitude, flaps below the approach setting:
 *      horn, silenceable (737 horn cutout: flaps up–10, RA < 800 ft);
 *   2. thrust retarded, flaps at/above approach but below landing: horn,
 *      NOT silenceable (737: flaps 15);
 *   3. flaps at/above landing: horn regardless of thrust, NOT silenceable
 *      (737: flaps 25+).
 * 737NG thresholds per SmartCockpit 737NG Landing Gear ("below 800 feet AGL
 * with thrust levers at idle and gear not down and locked"; flaps 25
 * horn); the flaps 15 tier is EST from the same logic family. Arguments are
 * binding expressions (strings) and var names.
 */
export function gearHornRules(o: {
  /** Expression true when any thrust lever is retarded (idle region). */
  throttleRetarded: string;
  /** Expression true below the altitude gate, e.g. 'ra1.alt_ft < 800 && ra1.valid'. */
  lowAltitude: string;
  flapsVar?: string;
  approachFlapsDeg: number;
  landingFlapsDeg: number;
}): GearHornRule[] {
  const f = o.flapsVar ?? 'surf.flaps_deg';
  return [
    { when: `(${o.throttleRetarded}) && (${o.lowAltitude}) && ${f} < ${o.approachFlapsDeg - 0.5}`, silenceable: true, label: 'THRUST/ALTITUDE' },
    { when: `(${o.throttleRetarded}) && ${f} >= ${o.approachFlapsDeg - 0.5} && ${f} < ${o.landingFlapsDeg - 0.5}`, silenceable: false, label: 'APPROACH FLAPS' },
    { when: `${f} >= ${o.landingFlapsDeg - 0.5}`, silenceable: false, label: 'LANDING FLAPS' },
  ];
}

/**
 * Light-aircraft style (Cessna/Garmin-era retractables and Citation M2
 * "GEAR" horn): throttle(s) near idle below an altitude, or landing flaps.
 */
export function gearHornRulesSimple(o: { throttleRetarded: string; lowAltitude: string; flapsVar?: string; landingFlapsDeg: number }): GearHornRule[] {
  const f = o.flapsVar ?? 'surf.flaps_deg';
  return [
    { when: `(${o.throttleRetarded}) && (${o.lowAltitude})`, silenceable: true, label: 'THROTTLE' },
    { when: `${f} >= ${o.landingFlapsDeg - 0.5}`, silenceable: false, label: 'FLAPS' },
  ];
}
