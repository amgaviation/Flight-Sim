/**
 * GPWS/EGPWS alert envelopes (basic modes 1–6) as pure functions.
 *
 * Source: Honeywell MK V/VII and MK VI/VIII EGPWS envelope definitions
 * (MK VIII Product Specification 965-1180-601 §6.2, as transcribed in the
 * FlightGear MK VIII emulation `mk_viii.cxx`, J.-Y. Lefort 2005) and the
 * MK V/VII EGPWS Pilot's Guide 060-4241-000 Rev H (2011) for the behaviour
 * notes. Heights are radio altitude (ft), rates in fpm (barometric
 * altitude rate: negative = descending), speeds in KCAS.
 *
 * Mode 1 (excessive descent rate), "air transport" envelope:
 *   SINK RATE (outer):  RA < −572 − 0.6035·(VS + bias), 10 < RA < 2450
 *                       -> 964 fpm @ 10 ft ... 5007 fpm @ 2450 ft
 *   PULL UP (inner):    RA < 284: RA < −1620 − 1.1133·(VS + bias)
 *                       284 ≤ RA < 2450: RA < −400 − 0.4·(VS + bias)
 *                       -> 1464 fpm @ 10 ft, 1710 fpm @ 284 ft, 7125 fpm @ 2450 ft
 * Mode 2A (excessive closure, flaps not landing):
 *   RA < 1220: RA < −1579 + 0.7895·closure  (2000 fpm @ 0 ft ... 3545 @ 1220)
 *   RA ≥ 1220: RA < 522 + 0.1968·closure, upper limit 1650 ft at/below
 *   `airspeed1` rising linearly (8.9 ft/kt) to 2450 ft at `airspeed2`
 *   (220/310 kt on the MK V; pilot's guide "220 knots to 310 knots").
 * Mode 2B (landing configuration / ILS / first 60 s after takeoff):
 *   RA < 789, same lower line; lower cut-off 30 ft, or with landing flaps
 *   200–600 ft depending on the baro rate (−400..−1000 fpm).
 * Mode 3 (altitude loss after takeoff): allowed loss 5.4 + 0.092·RA,
 *   30 < RA < 1500.
 * Mode 4 (unsafe terrain clearance), turbofan type:
 *   4A gear up:   < 190 kt: TOO LOW GEAR below 500 ft;
 *                 190–250 kt: TOO LOW TERRAIN below −1083 + 8.333·V;
 *                 > 250 kt: TOO LOW TERRAIN below 1000 ft.
 *   4B gear down, flaps not landing: < 159 kt: TOO LOW FLAPS below 245 ft;
 *                 above: TOO LOW TERRAIN on the same line up to 1000 ft.
 * Mode 5 (below glideslope, gear down): soft "GLIDESLOPE" > 1.3 dots,
 *   30 < RA < 1000 (below 150 ft: RA > 243 − 71.43·dots); hard (louder,
 *   repeated) > 2 dots, 30 < RA < 300 (below 150 ft: RA > 293 − 71.43·dots).
 * Mode 6 bank angle (type 2): AP engaged: 33° above 122 ft; otherwise
 *   55° above 2450 ft, RA < 153.33·φ − 5983 (150–2450 ft: 40°..55°),
 *   RA < 4·φ − 10 (30–150 ft: 10°..40°), 10° below 30 ft.
 */

/** Mode 1 outer (SINK RATE) boundary. `vsFpm` negative when descending. */
export function mode1SinkRate(raFt: number, vsFpm: number, biasFpm = 0): boolean {
  return raFt > 10 && raFt < 2450 && raFt < -572 - 0.6035 * (vsFpm + biasFpm);
}

/** Mode 1 inner (PULL UP) boundary. */
export function mode1PullUp(raFt: number, vsFpm: number, biasFpm = 0): boolean {
  if (!(raFt > 10) || raFt >= 2450) return false;
  const r = vsFpm + biasFpm;
  if (raFt < 284) return raFt < -1620 - 1.1133 * r;
  return raFt < -400 - 0.4 * r;
}

/**
 * Mode 1 SINK RATE bias (fpm) from the glideslope deviation: when the
 * aircraft is ABOVE a valid front-course glideslope (`gsDotsBelow` < 0) the
 * outer boundary is desensitised by up to 300 fpm (2 dots above), faded
 * out below 100 ft (MK V/VII pilot's guide "Glideslope Deviation Bias").
 */
export function mode1GsBias(gsDotsBelow: number, raFt: number): number {
  let bias = 0;
  if (gsDotsBelow <= -2) bias = 300;
  else if (gsDotsBelow < 0) bias = -150 * gsDotsBelow;
  if (raFt < 100) bias *= 0.01 * raFt;
  return bias;
}

/** Mode 2A upper limit (ft) vs airspeed. */
export function mode2AUpperLimit(iasKt: number, airspeed1 = 220, airspeed2 = 310): number {
  if (iasKt <= airspeed1) return 1650;
  if (iasKt >= airspeed2) return 2450;
  return Math.min(2450, 1650 + 8.9 * (iasKt - airspeed1));
}

/** Mode 2A (flaps not in landing configuration). `closureFpm` positive = terrain closing. */
export function mode2A(raFt: number, closureFpm: number, iasKt: number, airspeed1 = 220, airspeed2 = 310): boolean {
  if (!(raFt > 30)) return false;
  if (raFt < 1220) return raFt < -1579 + 0.7895 * closureFpm;
  return raFt < mode2AUpperLimit(iasKt, airspeed1, airspeed2) && raFt < 522 + 0.1968 * closureFpm;
}

/** Mode 2B (landing configuration). */
export function mode2B(raFt: number, closureFpm: number, flapsLanding: boolean, baroRateFpm: number): boolean {
  if (!(raFt < 789)) return false;
  let lower = 30;
  if (flapsLanding) {
    if (baroRateFpm > -400) lower = 200;
    else if (baroRateFpm < -1000) lower = 600;
    else lower = -66.777 - 0.667 * baroRateFpm;
  }
  return raFt > lower && raFt < -1579 + 0.7895 * closureFpm;
}

/** Mode 2 closure-rate limit by configuration (fpm): clamps the RA rate term like the MK VIII filter. */
export function limitClosureRate(raRateFpm: number, gsWithin2Dots: boolean, gearDown: boolean, flapsDown: boolean): number {
  let lo = -Infinity;
  let hi = Infinity;
  const both = gearDown && flapsDown;
  const one = gearDown || flapsDown;
  if (gsWithin2Dots) {
    lo = both ? -1000 : one ? 0 : 1000;
    hi = both ? 3000 : one ? 4000 : 5000;
  } else if (both) {
    lo = 0;
    hi = 4000;
  } else if (one) {
    lo = 1000;
    hi = 5000;
  }
  return raRateFpm < lo ? lo : raRateFpm > hi ? hi : raRateFpm;
}

/** Mode 3 allowed altitude loss (ft) at a radio height. */
export function mode3AllowedLoss(raFt: number): number {
  return 5.4 + 0.092 * raFt;
}

export interface Mode4Envelope {
  /** Below this speed the gear/flaps alert applies (kt). */
  lowKt: number;
  /** Above this speed the upper limit is `maxFt`. */
  highKt: number;
  /** Floor for TOO LOW GEAR / TOO LOW FLAPS (ft). */
  lowFt: number;
  maxFt: number;
}

/** MK V turbofan 4A (gear up) and 4B (gear down, flaps not landing). */
export const MODE4A_TURBOFAN: Mode4Envelope = { lowKt: 190, highKt: 250, lowFt: 500, maxFt: 1000 };
export const MODE4B_TURBOFAN: Mode4Envelope = { lowKt: 159, highKt: 250, lowFt: 245, maxFt: 1000 };

/**
 * Mode 4 alert for one envelope: 0 none, 1 configuration alert (TOO LOW
 * GEAR in 4A / TOO LOW FLAPS in 4B), 2 TOO LOW TERRAIN.
 */
export function mode4(raFt: number, iasKt: number, env: Mode4Envelope): 0 | 1 | 2 {
  if (!(raFt > 30)) return 0;
  if (iasKt < env.lowKt) return raFt < env.lowFt ? 1 : 0;
  const lim = iasKt >= env.highKt ? env.maxFt : Math.min(env.maxFt, -1083 + 8.333 * iasKt);
  return raFt < lim ? 2 : 0;
}

/** Mode 5: 0 none, 1 soft GLIDESLOPE, 2 hard GLIDESLOPE. `dotsBelow` > 0 = aircraft below the beam. */
export function mode5(raFt: number, dotsBelow: number): 0 | 1 | 2 {
  if (!(raFt > 30)) return 0;
  if (dotsBelow > 2 && raFt < 300 && (raFt >= 150 || raFt > 293 - 71.43 * dotsBelow)) return 2;
  if (dotsBelow > 1.3 && raFt < 1000 && (raFt >= 150 || raFt > 243 - 71.43 * dotsBelow)) return 1;
  return 0;
}

/** Mode 6 bank-angle limit (deg) at a radio height. */
export function bankAngleLimit(raFt: number, apEngaged: boolean, raValid = true): number {
  if (apEngaged && (!raValid || raFt > 122)) return 33;
  if (!raValid || raFt > 2450) return 55;
  if (raFt > 150) return (raFt + 5983.3333) / 153.33333;
  if (raFt > 30) return (raFt + 10) / 4;
  if (raFt > 5) return 10;
  return Infinity;
}

/**
 * FLTA required terrain clearance (ft) by phase (TSO-C151c Table 3.1.1):
 * enroute 700 level / 500 descending, terminal 350 / 300, approach 150 /
 * 100, departure 100.
 */
export function fltaRequiredClearance(phase: 'enroute' | 'terminal' | 'approach' | 'departure', descending: boolean): number {
  switch (phase) {
    case 'enroute':
      return descending ? 500 : 700;
    case 'terminal':
      return descending ? 300 : 350;
    case 'approach':
      return descending ? 100 : 150;
    default:
      return 100;
  }
}
