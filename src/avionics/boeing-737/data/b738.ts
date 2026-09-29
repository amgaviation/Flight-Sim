/**
 * Boeing 737-800 (winglets, CFM56-7B26) airframe data used by the displays
 * and the FMC. Every number carries its source; EST marks an estimate.
 *
 * Sources:
 *  [TCDS]  FAA TCDS A16WE (Boeing 737), 737-800 section: MTOW 174,200 lb
 *          (79,016 kg), MLW 146,300 lb (66,361 kg), MZFW 138,300 lb
 *          (62,732 kg), Vmo 340 KIAS / Mmo 0.82, max operating altitude
 *          41,000 ft.
 *  [LIM]   SmartCockpit "B737NG Generic Limitations" (Nov 2006): fuel tank
 *          capacities, gear speeds (VLO 270 kt/M.82 extension, 235 kt
 *          retraction, VLE 320 kt/M.82), hydraulic 3000 psi normal /
 *          2800 psi minimum / 3500 psi relief, oil/EGT limits.
 *  [PLAC]  737-800 flap placard (flight deck placard / FCOM L.10): flaps 1,
 *          2, 5: 250 kt; 10: 210; 15: 200; 25: 190; 30: 175; 40: 162.
 *  [FSS]   b737.org.uk "Flap-Speed Schedule" (maneuver speed structure by
 *          weight band 53,070 / 62,823 kg).
 *  [AFS]   SmartCockpit "Boeing 737 Systems Review - Automatic Flight".
 */

/** Weights (kg). [TCDS] */
export const B738_WEIGHTS = {
  maxTakeoffKg: 79016,
  maxLandingKg: 66361,
  maxZeroFuelKg: 62732,
  /** EST: typical operating empty weight of a 737-800W (Boeing airport planning data lists 41,413 kg OEW, typical). */
  operatingEmptyKg: 41413,
} as const;

/** Speed limits. [TCDS] [LIM] */
export const B738_SPEEDS = {
  vmoKt: 340,
  mmo: 0.82,
  maxAltFt: 41000,
  /** Landing gear operating / extended speeds. [LIM] */
  vloExtendKt: 270,
  vloRetractKt: 235,
  vleKt: 320,
  gearMach: 0.82,
} as const;

/** Flap detents (FCOM flap lever positions) with their placard speeds. [PLAC] */
export const B738_FLAPS: readonly { deg: number; label: string; placardKt: number }[] = [
  { deg: 0, label: 'UP', placardKt: 340 },
  { deg: 1, label: '1', placardKt: 250 },
  { deg: 2, label: '2', placardKt: 250 },
  { deg: 5, label: '5', placardKt: 250 },
  { deg: 10, label: '10', placardKt: 210 },
  { deg: 15, label: '15', placardKt: 200 },
  { deg: 25, label: '25', placardKt: 190 },
  { deg: 30, label: '30', placardKt: 175 },
  { deg: 40, label: '40', placardKt: 162 },
];

/**
 * Flap maneuver speed schedule (kt) per weight band: below 53,070 kg,
 * 53,070–62,823 kg, above 62,823 kg. Structure and bands from [FSS]; the NG
 * uses the same UP/1/10/15/25 values as the 2000 classic schedule, flaps 5
 * without the +10 kt classic revision (EST: 737NG FCOM NP.21 table from
 * memory; the aircraft may override). Flaps 30/40: final approach speed.
 */
export const B738_FLAP_MANEUVER: readonly { label: string; deg: number; kt: readonly [number, number, number] }[] = [
  { label: 'UP', deg: 0, kt: [210, 220, 230] },
  { label: '1', deg: 1, kt: [190, 200, 210] },
  { label: '5', deg: 5, kt: [170, 180, 190] },
  { label: '10', deg: 10, kt: [160, 170, 180] },
  { label: '15', deg: 15, kt: [150, 160, 170] },
  { label: '25', deg: 25, kt: [140, 150, 160] },
];

/** Weight band index for B738_FLAP_MANEUVER. [FSS] */
export function maneuverBand(weightKg: number): 0 | 1 | 2 {
  return weightKg <= 53070 ? 0 : weightKg <= 62823 ? 1 : 2;
}

/** Flap maneuver speed (kt) for a flap angle at a weight; NaN for 30/40 (final approach). */
export function flapManeuverSpeed(flapDeg: number, weightKg: number): number {
  const b = maneuverBand(weightKg);
  let best: (typeof B738_FLAP_MANEUVER)[number] | undefined;
  for (const f of B738_FLAP_MANEUVER) if (Math.abs(f.deg - flapDeg) < 0.6) best = f;
  return best ? best.kt[b] : NaN;
}

/**
 * Fuel tanks (usable, kg at 0.80 kg/l). [LIM]: left + right 7,830 kg
 * (3,915 kg each), centre 13,066 kg, total 20,896 kg.
 */
export const B738_FUEL = {
  mainTankKg: 3915,
  centerTankKg: 13066,
  totalKg: 20896,
  /** Main tank LOW alert below 453 kg (1,000 lb) - FCOM 12.20 "LOW" fuel indication. */
  lowKg: 453,
  /** IMBAL alert: main tanks differ by more than 453 kg (1,000 lb). [LIM] */
  imbalanceKg: 453,
  /** CONFIG alert: centre tank > 726 kg (1,600 lb) with both centre pumps off and an engine running (FCOM 12.20). */
  configCenterKg: 726,
} as const;

/** Hydraulic system values (psi). [LIM] */
export const B738_HYDRAULICS = {
  normalPsi: 3000,
  minPsi: 2800,
  reliefPsi: 3500,
  /** Refill (RF) indication below 76 % reservoir quantity on the ground. [LIM] */
  refillFraction: 0.76,
} as const;

/** Wing reference area (m²) - Boeing 737 airport planning document: 124.58 m² (1,341 ft²) for the 737-800. */
export const B738_WING_AREA_M2 = 124.58;

/** Engine designation shown on the IDENT page. */
export const B738_ENGINE_RATING = '26K';
export const B738_MODEL = '737-800W';
