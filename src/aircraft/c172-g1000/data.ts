/**
 * Cessna 172S NAV III (G1000 NXi) with the GFC 700 AFCS: variant numbers.
 *
 * Sources:
 *  - POH: Cessna 172S NAV III GFC 700 AFCS POH/AFM 172SPHBUS-00 (20 Dec 2007).
 *    Sec 1/6: standard empty weight 1663 lb and sample basic empty weight 1642 lb at
 *    moment 62.6 lb-in/1000, identical to the steam 172S (172SPHUS), so the variant flies
 *    the shared C172S_FDM without an equipment delta.
 *    Sec 2 "Garmin GFC 700 AFCS" limitations (quoted below).
 *  - PG: Garmin G1000 NXi Pilot's Guide for the Cessna NAV III 190-02177-02 (GFC 700 section).
 * Everything else is marked EST with the reasoning.
 */

/** POH Sec 2 "GARMIN GFC 700 AFCS" limitations. */
export const AFCS_LIMITS = {
  /** "Autopilot maximum engagement speed - 150 KIAS." */
  maxEngageKias: 150,
  /** "Autopilot minimum engagement speed - 70 KIAS." */
  minEngageKias: 70,
  /** "Electric Trim maximum operating speed - 163 KIAS." */
  maxElectricTrimKias: 163,
  /** "Maximum fuel imbalance with autopilot engaged - 90 pounds." */
  maxFuelImbalanceLb: 90,
  /** "The autopilot must be disengaged below 200 feet AGL during approach operations and below 800 feet AGL during all other operations." */
  minUseApproachFtAgl: 200,
  minUseOtherFtAgl: 800,
} as const;

/**
 * Pitch trim rates in trim units per second (the shared TrimAxis range is -1 nose down ..
 * +1 nose up, i.e. 2 units lock to lock).
 * EST: GSA 81 trim servo / manual electric trim ~25 s lock to lock (typical GA electric
 * trim; the PG gives no rate); autopilot trim follow-up slower (~35 s); a pilot rolling the
 * manual trim wheel continuously covers the range in ~8 s.
 */
export const TRIM_RATES = {
  electric: 2 / 25,
  autopilot: 2 / 35,
  manualHand: 2 / 8,
} as const;

/**
 * Manual elevator trim wheel travel: EST 3.5 turns lock to lock (172 pedestal wheel with its
 * chain/cable drum; the POH gives no figure).
 */
export const TRIM_WHEEL_TURNS = 3.5;

/**
 * GFC 700 inner-loop gains for the shared Afcs on the 172S FDM (EST, tuned in
 * tests/aircraft/c172-g1000 so that VS/ALT/HDG/LOC/GS hold without oscillation at 70-120 KIAS).
 */
export const GFC700_GAINS = {
  gainRefKt: 110,
} as const;

/** EST: throttle creeps toward idle under engine vibration with the friction lock backed off below this setting. */
export const THROTTLE_CREEP = { frictionBelow: 0.1, ratePerS: 0.004 } as const;

/**
 * Portable Halon 1211 extinguisher, POH 172SPHBUS-00 Sec 7 "Cabin fire extinguisher": gage "within the
 * green arc (approximately 125 psi)"; "the contents ... will empty in approximately eight seconds of
 * continuous use".
 */
export const EXTINGUISHER = { chargedPsi: 125, dischargeS: 8 } as const;

/**
 * Avionics cooling (POH Sec 3 "Display cooling advisory": PFD1 COOLING / MFD1 COOLING when the
 * forward avionics fan fails; STBY BATT OFF unless needed).
 * EST: GDU internal rise above the cabin 10 C with the fan, 30 C without it, 4 min time constant,
 * advisory above a 25 C rise (comes on within ~5 min of a fan failure on a warm day).
 */
export const DISPLAY_COOLING = { riseFanC: 10, riseNoFanC: 30, tauS: 240, advisoryRiseC: 25 } as const;
