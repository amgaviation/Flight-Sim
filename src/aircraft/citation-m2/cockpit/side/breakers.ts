/**
 * Citation M2 sidewall circuit-breaker panels: table of the breakers on the
 * LH (pilot) and RH (copilot) panels, grouped by bus.
 *
 * Sources:
 *   - S&D15 §9.4: "Left and right circuit breaker panels are positioned on
 *     the cockpit sidewall within easy reach of each pilot. A junction box is
 *     accessible through the aft baggage compartment."
 *   - CAE "CJ3 to CJ/CJ1/CJ2 System Differences" (training, 2014; the M2 is
 *     the CJ1+ successor on the same 525 type certificate): the L / R
 *     IGNITION breakers and the PITCH TRIM breaker are on the LEFT circuit
 *     breaker panel (pp. 5-47, 5-58); the inverter and the bus-connecting
 *     feeders are protected by current limiters in the aft junction box
 *     (60 A inverter limiter, 225 A bus fuses), not by cockpit breakers.
 *
 * EST (the M2 AFM / maintenance manual panel drawings are not public):
 *   - Which bus sits on which panel follows the pilot-side / copilot-side
 *     split of docs/aircraft/citation-m2.md §6.1 (EMER, AVN 1, L MAIN, L XFEED
 *     on the left; AVN 2, R MAIN, R XFEED on the right).
 *   - Engraved names use Citation-family abbreviations.
 *   - Every breaker is a `cb.<name>` of systems/electrical.ts (the network
 *     creates one breaker per load / feeder; pulling it opens that load, and
 *     the MIL-PRF-5809-shaped thermal model trips it on over-current).
 *   - Breakers rated above 50 A are junction-box current limiters and are not
 *     on the cockpit panels (Klixon 7274 cockpit breakers top out at 50 A):
 *     the 325 A generator-bus limiters, the 150 A R XFEED feed and the 100 A
 *     vapor-cycle A/C motor feed.
 */

/** Largest breaker fitted in a cockpit panel (A). EST: Klixon 7274 series range 1-50 A. */
export const MAX_PANEL_BREAKER_A = 50;

export interface M2CbGroup {
  /** Bus title engraved above the group. */
  title: string;
  /** [breaker name (`cb.<name>`), engraved label]. */
  items: [string, string][];
}

/** LH sidewall (pilot): emergency bus, avionics 1, left main and left crossfeed. */
export const M2_LEFT_CB: M2CbGroup[] = [
  {
    title: 'EMERGENCY BUS',
    items: [
      ['esi', 'STBY INST'],
      ['gea', 'ENG INST'],
      ['fire_det', 'FIRE DET'],
      ['gear_ctl', 'GEAR CONT'],
      ['flap_ctl', 'FLAP CONT'],
      ['ign1', 'L IGN'], // CAE: IGNITION breakers on the left CB panel
      ['ign2', 'R IGN'],
      ['fadec1_bkp', 'L FADEC'],
      ['fadec2_bkp', 'R FADEC'],
      ['stby_lts', 'STBY LTS'],
    ],
  },
  {
    title: 'AVIONICS 1',
    items: [
      ['avn1', 'AVN 1 FEED'],
      ['pfd1', 'PFD 1'],
      ['gtc1', 'GTC 1'],
      ['gia1', 'GIA 1'],
      ['adc1', 'ADC 1'],
      ['ahrs1', 'AHRS 1'],
      ['gmc', 'AFCS CONT'],
      ['ap_servos', 'AP SERVOS'],
      ['audio1', 'AUDIO 1'],
    ],
  },
  {
    title: 'LEFT MAIN',
    items: [
      ['pitot_l', 'L P/S HTR'],
      ['boost_l', 'L BOOST'],
      ['trim_pitch', 'PITCH TRIM'], // CAE: PITCH TRIM breaker on the left CB panel
      ['stall_warn', 'STALL WARN'],
      ['bleed_ctl_l', 'L BLEED'],
      ['ws_alcohol', 'W/S ALCOHOL'],
      ['landing_l', 'L LDG LT'],
      ['nav_lts', 'NAV LTS'],
      ['beacon', 'BEACON'],
      ['wing_insp', 'WING INSP'],
    ],
  },
  {
    title: 'LEFT CROSSFEED',
    items: [
      ['l_xfeed', 'L XFEED'],
      ['panel_lts', 'PANEL LTS'],
      ['flood_lts', 'FLOOD LTS'],
      ['cockpit_fans', 'AVN FANS'],
      ['temp_ctl', 'TEMP CONT'],
    ],
  },
];

/** RH sidewall (copilot): avionics 2, right main and right crossfeed. */
export const M2_RIGHT_CB: M2CbGroup[] = [
  {
    title: 'AVIONICS 2',
    items: [
      ['avn2', 'AVN 2 FEED'],
      ['mfd', 'MFD'],
      ['pfd2', 'PFD 2'],
      ['gtc2', 'GTC 2'],
      ['gia2', 'GIA 2'],
      ['adc2', 'ADC 2'],
      ['ahrs2', 'AHRS 2'],
      ['audio2', 'AUDIO 2'],
      ['xpdr', 'XPDR'],
      ['tcas', 'TCAS'],
      ['dme', 'DME'],
      ['ra', 'RAD ALT'],
      ['radar', 'WX RADAR'],
    ],
  },
  {
    title: 'RIGHT MAIN',
    items: [
      ['pitot_r', 'R P/S HTR'],
      ['aoa_heat', 'AOA HTR'],
      ['boost_r', 'R BOOST'],
      ['bleed_ctl_r', 'R BLEED'],
      ['press_ctl', 'PRESS CONT'],
      ['tail_deice', 'TAIL DEICE'],
      ['antiskid', 'ANTISKID'],
      ['landing_r', 'R LDG LT'],
      ['taxi_lts', 'TAXI LTS'],
      ['strobes', 'ANTI COLL'],
      ['logo_lts', 'TAIL FLOOD'],
    ],
  },
  {
    title: 'RIGHT CROSSFEED',
    items: [
      ['hyd_brake_pump', 'BRAKE PUMP'],
      ['cabin_fan', 'CABIN FAN'],
      ['cabin_lts', 'CABIN LTS'],
      ['pax_signs', 'PASS SIGNS'],
      ['inverter', 'INVERTER'],
      ['aux_batt', 'AUX BATT'],
    ],
  },
];

export interface PlacedBreaker {
  name: string;
  label: string;
  ratingA: number;
}

/**
 * Groups for one side: the table groups, keeping only breakers the network has (with its rating), plus a
 * MISC group for any network breaker <= MAX_PANEL_BREAKER_A that the tables do not list (right side when the
 * name ends in `_r` / `2`), so no load can be left without a cockpit breaker.
 */
export function m2CbGroups(side: 'left' | 'right', network: { name: string; ratingA: number }[]): { title: string; items: PlacedBreaker[] }[] {
  const rating = new Map(network.map((b) => [b.name, b.ratingA]));
  const table = side === 'left' ? M2_LEFT_CB : M2_RIGHT_CB;
  const out = table
    .map((g) => ({ title: g.title, items: g.items.filter(([n]) => rating.has(n)).map(([name, label]) => ({ name, label, ratingA: rating.get(name)! })) }))
    .filter((g) => g.items.length > 0);
  const known = new Set<string>();
  for (const g of [...M2_LEFT_CB, ...M2_RIGHT_CB]) for (const [n] of g.items) known.add(n);
  const extra = network
    .filter((b) => !known.has(b.name) && b.ratingA <= MAX_PANEL_BREAKER_A)
    .filter((b) => (/_r$|2/.test(b.name) ? 'right' : 'left') === side)
    .map((b) => ({ name: b.name, label: b.name.toUpperCase().replace(/_/g, ' ').slice(0, 11), ratingA: b.ratingA }));
  if (extra.length) out.push({ title: side === 'left' ? 'LEFT MISC' : 'RIGHT MISC', items: extra });
  return out;
}

/** Rating text on the breaker cap: integer or one decimal (7.5). */
export function ratingText(a: number): string {
  return Number.isInteger(a) ? String(a) : a.toFixed(1);
}
