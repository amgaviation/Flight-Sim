/**
 * G800 circuit-breaker panels on the flight-deck sidewalls aft of each crew seat.
 *
 * Every breaker of the modelled electrical network (systems/electrical.ts: one breaker per load,
 * `cb.<load>` 1 = in, `cb.<load>_tripped`) is a pullable `CircuitBreaker` bound to those vars, so
 * pulling one removes power from its load (`elec.<load>_powered` = 0) and an overcurrent trip
 * (e.g. the `elec.<load>.short` failure) pops it with the white band showing; pushing it back in
 * resets it (it trips again while the fault persists). The tests check that this table and the
 * network's `breakerNames()` match exactly.
 *
 * Sources / estimates:
 *  - BJT500: "The banks of mechanical circuit breakers are almost gone now, with 45 percent
 *    replaced by electronic circuit breakers." SCOPE: the model has one breaker per modelled load
 *    and builds every one of them as a mechanical breaker here; the real aircraft resets its
 *    electronic breakers (ECBs) from a touch-screen page, which the Epic suite does not model.
 *  - Location: GVI-family cockpit sidewall CB panels behind the pilot / copilot seats (EST, G650
 *    arrangement; no G800 drawing is public). Pilot side: L ESS DC, L MAIN DC, EMER DC / UPS and
 *    the left / emergency AC loads; copilot side: R ESS DC, R MAIN DC and the right AC loads,
 *    grouped under engraved bus titles as the topology in systems/electrical.ts.
 *  - Ratings are the network's breaker ratings (EST typical per equipment class, electrical.ts).
 *    The APU starter entry is the starter feeder current limiter (400 A) shown as a breaker (SCOPE).
 *  - Legend texts: equipment names in Gulfstream CB-panel style (EST).
 */
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { CircuitBreaker } from '../../../../cockpit/controls';
import type { CockpitEnv } from '../../../../cockpit/env';

export interface CbGroup {
  title: string;
  /** [breaker name (= load id), engraved legend] */
  items: [string, string][];
}

export const CB_PANEL_LEFT: CbGroup[] = [
  {
    title: 'L ESS DC',
    items: [
      ['du1', 'DU 1'], ['tsc1', 'TSC 1'], ['tsc2', 'TSC 2'], ['sfd1', 'SFD 1'], ['ohpts1', 'OHPTS 1'], ['gp', 'GP'], ['ccd1', 'CCD 1'],
      ['adc1', 'ADC 1'], ['irs1', 'IRS 1'], ['ra1', 'RAD ALT 1'], ['radio1', 'NAV/COM 1'], ['xpdr1', 'XPDR 1'], ['afcs', 'AFCS'], ['egpws', 'EGPWS'],
      ['fadec_l_aux', 'L FADEC'], ['ign_l', 'L IGN'], ['boost_l', 'L BOOST PUMP'], ['fire_det', 'FIRE DET'], ['stall_warn', 'STALL WARN'], ['cas_l', 'CAS 1'], ['gear_ctl', 'GEAR CONT'],
      ['brake_ctl_l', 'BRAKE CONT IB'], ['nws_ctl', 'NWS CONT'], ['flap_ctl', 'FLAP CONT'], ['apu_ecu', 'APU ECU'], ['apu_starter', 'APU START'], ['pack_ctl_l', 'L PACK CONT'], ['press_ctl', 'PRESS CONT'],
    ],
  },
  {
    title: 'L MAIN DC',
    items: [
      ['du2', 'DU 2'], ['ohpts2', 'OHPTS 2'], ['fms', 'FMS'], ['radar', 'WX RADAR'], ['hud_l', 'HUD 1'], ['ice_det', 'ICE DET'], ['alt_pump_l', 'L ALT PUMP'],
      ['panel_lts', 'CKPT LTS'], ['ext_nav', 'NAV LTS'], ['ext_beacon', 'BEACON'], ['ext_ldg_l', 'L LDG LT'], ['ext_taxi', 'TAXI LT'], ['ext_wing', 'WING INSP'],
    ],
  },
  {
    title: 'EMER DC  /  UPS',
    items: [['adc3', 'ADC 3'], ['irs3', 'IRS 3'], ['emer_lts', 'EMER LTS'], ['fcc', 'FCC'], ['bfcu', 'BFCU']],
  },
  {
    title: 'L MAIN AC  /  L ESS AC  /  EMER AC',
    items: [['galley', 'GALLEY'], ['cabin_l', 'CABIN L'], ['wshld_l', 'L WSHLD HT'], ['probes_l', 'PROBE HT 1'], ['pack_fans', 'PACK FANS']],
  },
];

export const CB_PANEL_RIGHT: CbGroup[] = [
  {
    title: 'R ESS DC',
    items: [
      ['du4', 'DU 4'], ['tsc4', 'TSC 4'], ['tsc3', 'TSC 3'], ['sfd2', 'SFD 2'], ['ohpts3', 'OHPTS 3'], ['gp_r', 'GP ALT'], ['ccd2', 'CCD 2'],
      ['adc2', 'ADC 2'], ['irs2', 'IRS 2'], ['ra2', 'RAD ALT 2'], ['radio2', 'NAV/COM 2'], ['xpdr2', 'XPDR 2'], ['tcas', 'TCAS'], ['fadec_r_aux', 'R FADEC'],
      ['ign_r', 'R IGN'], ['boost_r', 'R BOOST PUMP'], ['brake_ctl_r', 'BRAKE CONT OB'], ['cas_r', 'CAS 2'], ['pack_ctl_r', 'R PACK CONT'], ['oxy_ctl', 'OXY CONT'], ['trim_ctl', 'TRIM CONT'],
    ],
  },
  {
    title: 'R MAIN DC',
    items: [['du3', 'DU 3'], ['evs', 'EVS'], ['hud_r', 'HUD 2'], ['alt_pump_r', 'R ALT PUMP'], ['ext_strobe', 'STROBE'], ['ext_ldg_r', 'R LDG LT'], ['ext_recog', 'RECOG LT'], ['ext_logo', 'LOGO LT'], ['cabin_signs', 'CABIN SIGNS']],
  },
  {
    title: 'R MAIN AC  /  R ESS AC',
    items: [['cabin_r', 'CABIN R'], ['wshld_r', 'R WSHLD HT'], ['cabin_wdo', 'CABIN WDO HT'], ['evs_wdo', 'EVS WDO HT'], ['aux_hyd', 'AUX HYD PUMP'], ['probes_r', 'PROBE HT 2']],
  },
];

/** Layout constants of a CB panel (m). */
export const CB_GRID = { cols: 14, dx: 0.031, dy: 0.03, title: 0.014, margin: 0.018 } as const;

/** Panel size (width, height) needed for the given groups. */
export function cbPanelSize(groups: CbGroup[]): [number, number] {
  const rows = groups.reduce((a, g) => a + Math.ceil(g.items.length / CB_GRID.cols), 0);
  const h = 2 * CB_GRID.margin + groups.length * CB_GRID.title + rows * CB_GRID.dy;
  const w = 2 * CB_GRID.margin + (CB_GRID.cols - 1) * CB_GRID.dx + 0.02;
  return [w, h];
}

/**
 * Fills a CB panel (origin 'top-left': x right, y down) with the groups. Ratings come from the
 * network (`ratings`: breaker name -> amps). Returns the created breakers.
 */
export function fillCbPanel(env: CockpitEnv, panel: Panel, groups: CbGroup[], ratings: ReadonlyMap<string, number>): CircuitBreaker[] {
  const out: CircuitBreaker[] = [];
  const G = CB_GRID;
  let y = G.margin;
  for (const g of groups) {
    panel.bracket(g.title, panel.width / 2, y + 0.004, panel.width - 2 * G.margin, { height: 0.0026 });
    y += G.title;
    g.items.forEach(([name, legend], i) => {
      const col = i % G.cols;
      const row = Math.floor(i / G.cols);
      const x = G.margin + 0.01 + col * G.dx;
      const yy = y + row * G.dy + 0.008;
      const rating = ratings.get(name);
      const cb = panel.add(
        new CircuitBreaker(env, {
          id: `g800.cb.${name}`,
          label: `CB ${legend}`,
          var: `cb.${name}`,
          trippedVar: `cb.${name}_tripped`,
          rating: rating ?? '',
          diameter: 0.0095,
          collar: 'round',
        }),
        x,
        yy,
      );
      panel.label(legend, x, yy + 0.0115, { height: 0.0021, weight: 700 });
      out.push(cb);
    });
    y += Math.ceil(g.items.length / G.cols) * G.dy;
  }
  return out;
}
