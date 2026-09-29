/**
 * Pressurisation schedules for the fleet. Each schedule gives the cabin
 * altitude (ft) vs aircraft pressure altitude (ft) at cruise; the controller
 * additionally enforces `maxDiffPsi`. Anchor points are published cabin
 * altitudes; the differentials below were checked against them with the ISA
 * pressure model (Pressurization.cabinAltitudeForDiff), e.g. 8,000 ft cabin
 * at FL410 = 8.32 psid.
 *
 * Between the anchors and sea level the schedules are linear in aircraft
 * altitude (EST: real controllers use a similar proportional law; exact
 * manufacturer tables are not public).
 */
import type { Table1D } from '../../physics/types';

export interface PressurizationPreset {
  maxDiffPsi: number;
  reliefPsi: number;
  schedule: Table1D;
  maxCabinClimbFpm: number;
  maxCabinDescentFpm: number;
}

/**
 * Boeing 737NG: max differential 8.35 psi above FL370 giving an 8,000 ft
 * cabin at FL410; safety relief valves 8.95 psi, structural max 9.1 psi
 * (737 pressurisation notes, 737b.blogspot.com / Air Tycoon 737 pressurisation).
 * Rates: EST 500 fpm up / 300 fpm down (typical auto limits).
 */
export const PRESS_737NG: PressurizationPreset = {
  maxDiffPsi: 8.35,
  reliefPsi: 8.95,
  schedule: { x: [0, 41000, 45000], y: [0, 8000, 8000] },
  maxCabinClimbFpm: 500,
  maxCabinDescentFpm: 350,
};

/**
 * Gulfstream G650: 4,850 ft cabin at 51,000 ft (Robb Report / Gulfstream
 * published figure) => 10.69 psid (derived). Relief EST +0.3 psi. Rates:
 * "up to 500 fpm" climb, "up to 300 fpm" descent (code450.com Gulfstream
 * pressurisation notes).
 */
export const PRESS_G650: PressurizationPreset = {
  maxDiffPsi: 10.7,
  reliefPsi: 11.0,
  schedule: { x: [0, 51000], y: [0, 4850] },
  maxCabinClimbFpm: 500,
  maxCabinDescentFpm: 300,
};

/**
 * Gulfstream G800: 2,916 ft cabin at 41,000 ft (Gulfstream G800 published
 * figure) => 10.62 psid; same 10.7 psid shell as the G650 -> 4,850 ft at
 * 51,000 ft (EST). Rates as G650.
 */
export const PRESS_G800: PressurizationPreset = {
  maxDiffPsi: 10.7,
  reliefPsi: 11.0,
  schedule: { x: [0, 41000, 51000], y: [0, 2916, 4850] },
  maxCabinClimbFpm: 500,
  maxCabinDescentFpm: 300,
};

/**
 * Bombardier Global 6000: cabin "lower than 6,000 ft" at 51,000 ft
 * (Bombardier / globalair specification summaries); 4,500 ft at 45,000 ft and
 * 5,680 ft at 51,000 ft (EST: Bombardier marketing figures) both correspond
 * to 10.32 psid (derived). Relief EST +0.3 psi.
 */
export const PRESS_GLOBAL6000: PressurizationPreset = {
  maxDiffPsi: 10.33,
  reliefPsi: 10.6,
  schedule: { x: [0, 45000, 51000], y: [0, 4500, 5680] },
  maxCabinClimbFpm: 500,
  maxCabinDescentFpm: 300,
};

/**
 * Cessna Citation Longitude: 5,950 ft cabin at 45,000 ft ceiling, 9.66 psid
 * max differential (Textron / BCA pilot report). Relief EST +0.3 psi.
 */
export const PRESS_LONGITUDE: PressurizationPreset = {
  maxDiffPsi: 9.66,
  reliefPsi: 9.95,
  schedule: { x: [0, 45000], y: [0, 5950] },
  maxCabinClimbFpm: 500,
  maxCabinDescentFpm: 300,
};

/**
 * Cessna Citation M2 (525): EST 8.5 psid (CitationJet-family shell; the CJ4 is
 * 9.0 psid per Wikipedia CitationJet article), giving ~7,580 ft cabin at the
 * 41,000 ft ceiling (derived). Relief EST +0.3 psi.
 */
export const PRESS_M2: PressurizationPreset = {
  maxDiffPsi: 8.5,
  reliefPsi: 8.8,
  schedule: { x: [0, 41000], y: [0, 7580] },
  maxCabinClimbFpm: 500,
  maxCabinDescentFpm: 300,
};
