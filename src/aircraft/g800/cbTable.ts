/**
 * G800 circuit protection: which breakers of the modelled electrical network
 * (systems/electrical.ts, one breaker per load `cb.<load>`) are mechanical
 * breakers on the two overhead CB panels, and which are electronic circuit
 * breakers (ECBs) reset from the TSC ECB application (systems/tscApps.ts).
 * Three.js-free: shared by the cockpit (cockpit/overhead/breakers.ts) and the
 * TSC application.
 *
 * Sources / estimates:
 *  - Location and panel format: two CB panels at the aft end of the overhead, each a
 *    lettered / numbered grid (rows A-G, columns 1-6) with engraved group outlines
 *    FLIGHT INSTRUMENTS, APU, LDG GEAR / DOOR CTRL, COM / NAV, ELECTRICAL (G600 BL7C0705
 *    photograph, crop p_cb; G500 BL7C0670 overhead photograph).
 *  - BJT500: "The banks of mechanical circuit breakers are almost gone now, with 45
 *    percent replaced by electronic circuit breakers." Here 37 of the 87 modelled
 *    breakers (43 %) are ECBs.
 *  - EST: the assignment of each modelled load to a group and grid cell (the photo
 *    legends are not legible); legend texts in Gulfstream CB style.
 */

/** Engraved / listed legend per breaker (load id). */
export const CB_LEGEND: Readonly<Record<string, string>> = {
  du1: 'DU 1', du2: 'DU 2', du3: 'DU 3', du4: 'DU 4', tsc1: 'TSC 1', tsc2: 'TSC 2', tsc3: 'TSC 3', tsc4: 'TSC 4',
  sfd1: 'SFD 1', sfd2: 'SFD 2', ohpts1: 'OHPTS 1', ohpts2: 'OHPTS 2', ohpts3: 'OHPTS 3', gp: 'GP', gp_r: 'GP ALT',
  ccd1: 'CCD 1', ccd2: 'CCD 2', adc1: 'ADC 1', adc2: 'ADC 2', adc3: 'ADC 3', irs1: 'IRS 1', irs2: 'IRS 2', irs3: 'IRS 3',
  ra1: 'RAD ALT 1', ra2: 'RAD ALT 2', radio1: 'NAV/COM 1', radio2: 'NAV/COM 2', xpdr1: 'XPDR 1', xpdr2: 'XPDR 2',
  afcs: 'AFCS', egpws: 'EGPWS', tcas: 'TCAS', fadec_l_aux: 'L FADEC', fadec_r_aux: 'R FADEC', ign_l: 'L IGN', ign_r: 'R IGN',
  boost_l: 'L BOOST PUMP', boost_r: 'R BOOST PUMP', fire_det: 'FIRE DET', stall_warn: 'STALL WARN', cas_l: 'CAS 1', cas_r: 'CAS 2',
  gear_ctl: 'GEAR CONT', brake_ctl_l: 'BRAKE CONT IB', brake_ctl_r: 'BRAKE CONT OB', nws_ctl: 'NWS CONT', flap_ctl: 'FLAP CONT',
  apu_ecu: 'APU ECU', apu_starter: 'APU START', pack_ctl_l: 'L PACK CONT', pack_ctl_r: 'R PACK CONT', press_ctl: 'PRESS CONT',
  oxy_ctl: 'OXY CONT', trim_ctl: 'TRIM CONT', fms: 'FMS', radar: 'WX RADAR', hud_l: 'HUD 1', hud_r: 'HUD 2', ice_det: 'ICE DET',
  alt_pump_l: 'L ALT PUMP', alt_pump_r: 'R ALT PUMP', panel_lts: 'CKPT LTS', ext_nav: 'NAV LTS', ext_beacon: 'BEACON',
  ext_ldg_l: 'L LDG LT', ext_ldg_r: 'R LDG LT', ext_taxi: 'TAXI LT', ext_wing: 'WING INSP', ext_strobe: 'STROBE',
  ext_recog: 'RECOG LT', ext_logo: 'LOGO LT', cabin_signs: 'CABIN SIGNS', evs: 'EVS', emer_lts: 'EMER LTS', fcc: 'FCC',
  bfcu: 'BFCU', galley: 'GALLEY', cabin_l: 'CABIN L', cabin_r: 'CABIN R', wshld_l: 'L WSHLD HT', wshld_r: 'R WSHLD HT',
  cabin_wdo: 'CABIN WDO HT', evs_wdo: 'EVS WDO HT', aux_hyd: 'AUX HYD PUMP', probes_l: 'PROBE HT 1', probes_r: 'PROBE HT 2',
  pack_fans: 'PACK FANS',
};

/** A group outline on a CB panel: grid rows r0..r1 (0 = A) and columns c0..c1 (0 = column 1), filled row by row. */
export interface CbGridGroup {
  title: string;
  rows: [number, number];
  cols: [number, number];
  items: string[];
}

export const CB_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
export const CB_COLS = 6;

/** Left (pilot-side) overhead CB panel. */
export const CB_OVHD_LEFT: CbGridGroup[] = [
  { title: 'FLIGHT INSTRUMENTS', rows: [0, 2], cols: [0, 5], items: ['du1', 'du2', 'sfd1', 'adc1', 'irs1', 'ra1', 'gp', 'ccd1', 'tsc1', 'tsc2', 'ohpts1', 'ohpts2', 'cas_l', 'egpws', 'stall_warn', 'afcs', 'adc3', 'irs3'] },
  { title: 'LDG GEAR / DOOR CTRL', rows: [3, 4], cols: [0, 2], items: ['gear_ctl', 'brake_ctl_l', 'nws_ctl', 'fire_det'] },
  { title: 'APU', rows: [3, 4], cols: [3, 5], items: ['apu_ecu', 'apu_starter', 'fadec_l_aux', 'ign_l'] },
  { title: 'COM / NAV', rows: [5, 6], cols: [0, 2], items: ['radio1', 'xpdr1'] },
  { title: 'ELECTRICAL', rows: [5, 6], cols: [3, 5], items: ['fcc', 'bfcu'] },
];

/** Right (copilot-side) overhead CB panel. */
export const CB_OVHD_RIGHT: CbGridGroup[] = [
  { title: 'FLIGHT INSTRUMENTS', rows: [0, 1], cols: [0, 5], items: ['du3', 'du4', 'sfd2', 'adc2', 'irs2', 'ra2', 'gp_r', 'ccd2', 'tsc3', 'tsc4', 'ohpts3', 'cas_r'] },
  { title: 'APU', rows: [2, 3], cols: [0, 2], items: ['fadec_r_aux', 'ign_r'] },
  { title: 'LDG GEAR', rows: [2, 3], cols: [3, 5], items: ['brake_ctl_r'] },
  { title: 'ELECTRICAL', rows: [4, 6], cols: [0, 2], items: ['boost_l', 'boost_r'] },
  { title: 'COM / NAV', rows: [4, 6], cols: [3, 5], items: ['radio2', 'xpdr2', 'tcas'] },
];

/** Every mechanical breaker (left + right overhead panels). */
export function mechanicalBreakers(): string[] {
  return [...CB_OVHD_LEFT, ...CB_OVHD_RIGHT].flatMap((g) => g.items);
}

/** Electronic circuit breakers: every network breaker that is not on an overhead panel (network order). */
export function electronicBreakers(all: readonly string[]): string[] {
  const mech = new Set(mechanicalBreakers());
  return all.filter((n) => !mech.has(n));
}

/** Grid cell (row, column) of item `i` of a group. */
export function cbCell(g: CbGridGroup, i: number): [number, number] {
  const w = g.cols[1] - g.cols[0] + 1;
  return [g.rows[0] + Math.floor(i / w), g.cols[0] + (i % w)];
}
