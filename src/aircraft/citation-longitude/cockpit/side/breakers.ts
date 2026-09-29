/**
 * Longitude circuit-breaker panels: one per side console, grouped by bus.
 *
 * Every breaker is a real `cb.<name>` of the electrical network
 * (systems/electrical.ts: each load is created with `cb: { name: <load id>,
 * ratingA }`). Pulling one opens that load (ElectricalNetwork: a load is
 * active only while `cb.<name>` != 0), and the network trips it
 * (`cb.<name>` = 0, `cb.<name>_tripped` = 1) on over-current per the
 * MIL-PRF-5809-shaped curve; the CircuitBreaker control pops out and plays the
 * trip sound.
 *
 * SCOPE / EST:
 *   - Panel names, grouping and positions are EST (Citation-family practice:
 *     breakers grouped by bus with the bus name above each group). The
 *     public Longitude documents (OG, FPG, BCA) do not list the breaker
 *     panels; the loads are the modelled ones in systems/electrical.ts.
 *   - Feeders above 50 A (APU starter 500 A, PTCU motor 150 A, MAIN bus
 *     feeds 150 A, BUS TIE 400 A) are current limiters in the J-boxes, not
 *     cockpit breakers (EST, 50 A = largest Klixon 7274 cockpit breaker), so
 *     they are not on the panels.
 *   - Any breaker the network gains later that is not in the table below is
 *     placed automatically in an extra group on the side its bus name
 *     suggests, so no load can be left without a cockpit breaker.
 */

/** Largest breaker fitted in a cockpit panel (A). Klixon 7274 series tops out at 50 A (EST catalogue range). */
export const MAX_PANEL_BREAKER_A = 50;

export interface CbGroup {
  title: string;
  /** [breaker name (cb.<name>), engraved label] */
  items: [string, string][];
}

/** Left console: pilot-side buses. */
export const LEFT_CB_GROUPS: CbGroup[] = [
  {
    title: 'L EMER BUS',
    items: [
      ['pfd1', 'PFD 1'],
      ['gtc1', 'GTC 1'],
      ['gia1', 'GIA 1'],
      ['adc1', 'ADC 1'],
      ['ahrs1', 'AHRS 1'],
      ['gmc', 'GMC'],
      ['afcs', 'AFCS'],
      ['fadec_l_aux', 'FADEC L'],
      ['flaps', 'FLAPS'],
      ['fire_det', 'FIRE DET'],
      ['stall_warn', 'STALL WARN'],
      ['ra', 'RAD ALT'],
      ['ext_lt_nav', 'NAV LTS'],
      ['ign_l', 'IGN L'],
      ['stab_trim_pri1', 'STAB TRIM PRI 1'],
      ['ail_trim', 'AIL TRIM'],
      ['pitot_stby', 'P/S HT STBY'],
    ],
  },
  {
    title: 'L MISSION BUS',
    items: [
      ['mfd', 'MFD'],
      ['gtc2', 'GTC 2'],
      ['boost_l', 'BOOST L'],
      ['recirc_l', 'RECIRC L'],
      ['pitot_l', 'P/S HT L'],
      ['stab_emeds', 'STAB DEICE'],
      ['ecs_fans', 'ECS FANS'],
      ['apu_ecu', 'APU ECU'],
      ['panel_lts', 'PANEL LTS'],
      ['ext_lt_beacon', 'BEACON'],
      ['ext_lt_strobe', 'ANTI COLL'],
      ['ext_lt_taxi', 'TAXI LTS'],
    ],
  },
  {
    title: 'L MAIN / INTERIOR / STBY / HOT BATT',
    items: [
      ['wshld_l', 'WSHLD L'],
      ['ldg_lt_l', 'LDG LT L'],
      ['wing_insp', 'WING INSP'],
      ['cabin_l', 'CABIN L'],
      ['stby_inst', 'STBY INST'],
      ['dome_lt', 'DOME LT'],
    ],
  },
];

/** Right console: copilot-side buses. */
export const RIGHT_CB_GROUPS: CbGroup[] = [
  {
    title: 'R EMER BUS',
    items: [
      ['pfd2', 'PFD 2'],
      ['gtc4', 'GTC 4'],
      ['gia2', 'GIA 2'],
      ['adc2', 'ADC 2'],
      ['ahrs2', 'AHRS 2'],
      ['fadec_r_aux', 'FADEC R'],
      ['xpdr1', 'XPDR 1'],
      ['ign_r', 'IGN R'],
      ['gear_ctl', 'GEAR CTL'],
      ['brake_ctl', 'BRAKE CTL'],
      ['rudder_ctl', 'RUDDER CTL'],
      ['stab_trim_pri2', 'STAB TRIM PRI 2'],
      ['stab_trim_sec', 'STAB TRIM SEC'],
      ['rud_trim', 'RUD TRIM'],
    ],
  },
  {
    title: 'R MISSION BUS',
    items: [
      ['gtc3', 'GTC 3'],
      ['boost_r', 'BOOST R'],
      ['recirc_r', 'RECIRC R'],
      ['pitot_r', 'P/S HT R'],
      ['rss_pump', 'RUD STBY'],
      ['radar', 'WX RADAR'],
      ['tcas', 'TCAS'],
      ['xpdr2', 'XPDR 2'],
      ['ext_lt_recog', 'RECOG'],
    ],
  },
  {
    title: 'R MAIN / INTERIOR / SERVICE',
    items: [
      ['wshld_r', 'WSHLD R'],
      ['ldg_lt_r', 'LDG LT R'],
      ['tail_flood', 'TAIL FLOOD'],
      ['galley', 'GALLEY'],
      ['cabin_r', 'CABIN R'],
      ['service', 'SERVICE'],
    ],
  },
];

/** Every breaker name placed from the tables. */
export function tabledBreakers(): Set<string> {
  const s = new Set<string>();
  for (const g of [...LEFT_CB_GROUPS, ...RIGHT_CB_GROUPS]) for (const [n] of g.items) s.add(n);
  return s;
}

/**
 * Groups for one side: the table groups (only breakers that exist in the network) plus an extra group for
 * network breakers <= MAX_PANEL_BREAKER_A that are not in either table (right side if the name ends in `_r`
 * or contains `2`, else left).
 */
export function cbGroupsFor(side: 'left' | 'right', network: { name: string; ratingA: number }[]): { title: string; items: { name: string; label: string; ratingA: number }[] }[] {
  const rating = new Map(network.map((b) => [b.name, b.ratingA]));
  const table = side === 'left' ? LEFT_CB_GROUPS : RIGHT_CB_GROUPS;
  const out = table
    .map((g) => ({ title: g.title, items: g.items.filter(([n]) => rating.has(n)).map(([n, label]) => ({ name: n, label, ratingA: rating.get(n)! })) }))
    .filter((g) => g.items.length > 0);
  const known = tabledBreakers();
  const extra = network
    .filter((b) => !known.has(b.name) && b.ratingA <= MAX_PANEL_BREAKER_A)
    .filter((b) => ((/_r$/.test(b.name) || /2/.test(b.name)) ? 'right' : 'left') === side)
    .map((b) => ({ name: b.name, label: b.name.toUpperCase().replace(/_/g, ' ').slice(0, 10), ratingA: b.ratingA }));
  if (extra.length) out.push({ title: side === 'left' ? 'L MISC' : 'R MISC', items: extra });
  return out;
}

/** Panel rating text (A): integer or one decimal. */
export function ratingText(a: number): string {
  return Number.isInteger(a) ? String(a) : a.toFixed(1);
}
