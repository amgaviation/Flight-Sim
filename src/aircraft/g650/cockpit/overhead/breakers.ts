/**
 * G650 circuit-breaker panels: the aft segment of the overhead console, split into a LEFT and a RIGHT
 * panel at the centreline.
 *
 * Source: G650ER overhead photograph and owner's description (Flickr jeffatchison 52948516166): two CB
 * panels split at the centreline, each densely populated, with printed column numbers (1-9...) and row
 * letters (A-G...) on the borders, "laid out in sections that are divided by white lines and clearly
 * labeled as to what system they belong to. ... [they] can be manually disconnected during emergencies
 * per checklists", backlit for night use. The section titles FLT INSTRUMENTS, FLT CTRL / LDG GEAR,
 * ENG SYS / FUEL, ELECTRICAL and COM / NAV are readable in the photograph; the remaining section titles
 * (AIR COND / PRESS, ICE PROTECTION, LIGHTING) are EST after the same style.
 *
 * Every breaker of the modelled electrical network (systems/electrical.ts: one breaker per load,
 * `cb.<load>` 1 = in, `cb.<load>_tripped`) is a pullable `CircuitBreaker` bound to those vars: pulling one
 * removes power from its load (`elec.<load>_powered` = 0, the consuming system loses it: a display blanks,
 * a pump stops, a heater goes cold), an overcurrent (e.g. the `elec.<load>.short` failure) trips it with the
 * white band showing, and pushing it back in resets it (it trips again while the fault persists). The
 * tests check that this table and the network's `breakerNames()` match exactly.
 *
 * SCOPE / EST:
 *  - One breaker per modelled load; the real aircraft has many more (one per LRU channel and power feed).
 *    Which section a load sits in follows the photographed titles; legends and the order inside a section
 *    are EST.
 *  - Ratings are the network's breaker ratings (EST per equipment class, electrical.ts). The AUX hydraulic
 *    pump (150 A) and the APU starter (600 A) are really fed through current limiters / contactors outside
 *    the cockpit; they are shown here as their control breakers so they can be isolated (SCOPE).
 *  - AC loads are shown as single breakers (the real three-phase breakers are ganged triples).
 */
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { CircuitBreaker } from '../../../../cockpit/controls';
import type { CockpitEnv } from '../../../../cockpit/env';

export interface CbGroup {
  title: string;
  /** [breaker name (= load id), engraved legend (\n = two lines), feeding bus] */
  items: [string, string, string][];
}

/** LEFT panel (pilot side): flight instruments / flight controls + gear / engine + fuel. */
export const G650_CB_GROUPS_L: CbGroup[] = [
  {
    // Photographed title (Flickr 52948516166): displays, guidance, air data and inertial sensors.
    title: 'FLT INSTRUMENTS',
    items: [
      ['du1', 'DU\n1', 'L ESS DC'], ['du2', 'DU\n2', 'L MAIN DC'], ['du3', 'DU\n3', 'R MAIN DC'], ['du4', 'DU\n4', 'R ESS DC'],
      ['smc1', 'SMC\n1', 'EMER DC'], ['smc2', 'SMC\n2', 'EMER DC'], ['gp', 'GUID\nPNL', 'L ESS DC'], ['afcs1', 'FGC\n1', 'L ESS DC'],
      ['afcs2', 'FGC\n2', 'R ESS DC'], ['ccd1', 'CCD\n1', 'L ESS DC'], ['ccd2', 'CCD\n2', 'R ESS DC'], ['mcdu1', 'MCDU\n1', 'EMER DC'],
      ['mcdu2', 'MCDU\n2', 'L MAIN DC'], ['mcdu3', 'MCDU\n3', 'EMER DC'],
      ['adc1', 'ADS\n1', 'L ESS DC'], ['adc2', 'ADS\n2', 'R ESS DC'], ['adc3', 'ADS\n3', 'EMER DC'], ['irs1', 'IRU\n1', 'EMER DC'],
      ['irs2', 'IRU\n2', 'EMER DC'], ['irs3', 'IRU\n3', 'EMER DC'], ['ra', 'RAD\nALT', 'R MAIN DC'],
    ],
  },
  {
    // Photographed title.
    title: 'FLT CTRL / LDG GEAR',
    items: [
      ['fcc1a', 'FCC\n1A', 'FCC UPS'], ['fcc1b', 'FCC\n1B', 'L ESS DC'], ['fcc2a', 'FCC\n2A', 'R ESS DC'], ['fcc2b', 'FCC\n2B', 'FCC UPS'],
      ['bfcu', 'BFCU', 'FCC UPS'], ['ebha_mce', 'EBHA\nMCE', 'EBHA'], ['hscu1', 'HSCU\n1', 'EMER AC'], ['hscu2', 'HSCU\n2', 'R MAIN AC'],
      ['fecu_a', 'FLAP\nCONT A', 'L ESS DC'], ['fecu_b', 'FLAP\nCONT B', 'R ESS DC'], ['stall_warn', 'STALL\nWARN', 'L ESS DC'], ['fcs_chargers', 'FCS BATT\nCHGR', 'EMER AC'],
      ['hyd_aux', 'AUX HYD\nPUMP', 'L ESS DC'], ['lgcu1', 'LGCU\n1', 'L ESS DC'], ['lgcu2', 'LGCU\n2', 'R MAIN DC'], ['bcu_a', 'BCU\nA', 'L ESS DC'],
      ['bcu_b', 'BCU\nB', 'R ESS DC'], ['nwscu', 'NWS\nCONT', 'L ESS DC'],
    ],
  },
  {
    // Photographed title.
    title: 'ENG SYS / FUEL',
    items: [
      ['ign_l', 'L\nIGN', 'L ESS DC'], ['ign_r', 'R\nIGN', 'R ESS DC'], ['start_valve_l', 'L START\nVLV', 'L ESS DC'], ['start_valve_r', 'R START\nVLV', 'R ESS DC'],
      ['apu_ecu', 'APU\nECU', 'L ESS DC'], ['apu_starter', 'APU\nSTART', 'L BATT'],
      ['fdcu_l', 'L FIRE\nDET', 'L ESS DC'], ['fdcu_r', 'R FIRE\nDET', 'R ESS DC'], ['fire_ext', 'FIRE\nEXTING', 'R ESS DC'],
      ['boost_l', 'L MAIN\nPUMP', 'L ESS DC'], ['alt_l', 'L ALT\nPUMP', 'L MAIN DC'], ['fuel_valves_l', 'L VLV\nX-FLOW', 'L ESS DC'],
      ['boost_r', 'R MAIN\nPUMP', 'R ESS DC'], ['alt_r', 'R ALT\nPUMP', 'R MAIN DC'], ['fuel_valves_r', 'R VLV\nINT TK', 'R ESS DC'],
    ],
  },
];

/** RIGHT panel (copilot side): com/nav, electrical, ECS, ice, lighting. */
export const G650_CB_GROUPS_R: CbGroup[] = [
  {
    // Photographed title.
    title: 'COM / NAV',
    items: [
      ['gps1', 'GPS\n1', 'L ESS DC'], ['gps2', 'GPS\n2', 'R ESS DC'], ['nav1', 'NAV/\nCOM 1', 'EMER DC'], ['nav2', 'NAV\n2', 'R ESS DC'],
      ['adf', 'ADF', 'L MAIN DC'], ['xpdr1', 'XPDR\n1', 'L MAIN DC'], ['xpdr2', 'XPDR\n2', 'R MAIN DC'], ['tcas', 'TCAS', 'R MAIN DC'],
      ['radar', 'WX\nRADAR', 'L MAIN DC'], ['taws', 'EGPWS', 'L MAIN DC'], ['acp', 'AUDIO', 'EMER DC'],
    ],
  },
  {
    // Photographed title: cabin and service power distribution.
    title: 'ELECTRICAL',
    items: [['cabin_dc', 'CABIN\nDC', 'AUX DC'], ['cabin_60hz', 'CABIN\n60 HZ', 'L MAIN AC'], ['galley', 'GALLEY', 'R MAIN AC'], ['gsb_loads', 'GND SVC\nBUS', 'GSB']],
  },
  {
    title: 'AIR COND / PRESS', // EST title (not readable in the photograph)
    items: [
      ['bac_l', 'L BLEED\nCONT', 'L ESS DC'], ['bac_r', 'R BLEED\nCONT', 'R ESS DC'], ['cpc', 'CABIN\nPRESS', 'L ESS DC'], ['recirc_fans', 'RECIRC\nFANS', 'L MAIN AC'],
      ['oxy_panel', 'OXYGEN\nCONT', 'R ESS DC'],
    ],
  },
  {
    title: 'ICE PROTECTION', // EST title
    items: [
      ['probe1', 'ADS 1\nHTR', 'L ESS DC'], ['probe2', 'ADS 2\nHTR', 'R ESS DC'], ['probe3', 'ADS 3\nHTR', 'L ESS DC'], ['probe4', 'ADS 4\nHTR', 'R ESS DC'],
      ['wshld_l', 'L WSHLD\nHEAT', 'L MAIN AC'], ['wshld_r', 'R WSHLD\nHEAT', 'R MAIN AC'], ['cabin_wdo', 'CABIN\nWDO HT', 'R MAIN AC'], ['evs_wdo', 'EVS\nWDO HT', 'L MAIN AC'],
      ['ice_det_l', 'L ICE\nDET', 'L MAIN AC'], ['ice_det_r', 'R ICE\nDET', 'R MAIN AC'], ['ice_det', 'ICE DET\nCONT', 'R MAIN DC'], ['cowl_valve_l', 'L COWL\nA/I VLV', 'L ESS DC'],
      ['cowl_valve_r', 'R COWL\nA/I VLV', 'R ESS DC'],
    ],
  },
  {
    title: 'LIGHTING', // EST title
    items: [
      ['ldg_lt_l', 'L LDG\nLT', 'L MAIN DC'], ['ldg_lt_r', 'R LDG\nLT', 'R MAIN DC'], ['taxi_lt', 'TAXI\nLT', 'L MAIN DC'], ['nav_lts', 'NAV\nLTS', 'L MAIN DC'],
      ['beacon', 'BEACON', 'L MAIN DC'], ['strobe', 'ANTI-\nCOLL', 'R MAIN DC'], ['recog', 'RECOG\nLTS', 'R MAIN DC'], ['logo', 'LOGO\nLTS', 'R MAIN DC'],
      ['wing_insp', 'WING\nINSP', 'L MAIN DC'], ['panel_lts', 'CKPT\nLTS', 'L MAIN DC'], ['emer_lts', 'EMER\nLTS', 'EMER DC'],
    ],
  },
];

/** Both panels' groups (kept for the tests: this flat table must match `breakerNames()` exactly). */
export const G650_CB_GROUPS: CbGroup[] = [...G650_CB_GROUPS_L, ...G650_CB_GROUPS_R];

/** Layout constants (m): breaker pitch, group title height, gaps (tight grid, photographed panels are dense). */
export const CB_GRID = { dx: 0.021, dy: 0.031, title: 0.011, gap: 0.01, margin: 0.014, maxCols: 14 } as const;

/**
 * Fills one CB panel (origin 'top-left': x right, y down = forward) with `groups` (default: all groups).
 * Groups are packed in shelves left to right, each group a grid of up to `maxCols` breakers with a white
 * outline and its section title, and the border carries printed column numbers (1, 2, 3...) along the aft
 * edge and row letters (A, B, C...) down the left edge (Flickr 52948516166: grid coordinates on the
 * borders). `ratings`: breaker name -> amps (the network's `breakerNames()`). Returns the breakers.
 */
export function fillCbPanel(env: CockpitEnv, panel: Panel, width: number, ratings: ReadonlyMap<string, number>, groups: CbGroup[] = G650_CB_GROUPS): CircuitBreaker[] {
  const G = CB_GRID;
  const out: CircuitBreaker[] = [];
  let x = G.margin;
  let y = G.margin;
  let shelfH = 0;
  let maxY = 0;
  let maxX = 0;
  for (const g of groups) {
    const cols = Math.min(G.maxCols, g.items.length);
    const rows = Math.ceil(g.items.length / cols);
    const w = cols * G.dx + 0.006;
    const h = G.title + rows * G.dy + 0.004;
    if (x + w > width - 0.008 + 1e-6) {
      x = G.margin;
      y += shelfH + G.gap;
      shelfH = 0;
    }
    // White group outline with the section title in its top edge.
    const x0 = x;
    const x1 = x + w;
    const y0 = y + 0.004;
    const y1 = y + h;
    const tw = Math.min(w - 0.006, g.title.length * 0.0022 + 0.006);
    const cx = (x0 + x1) / 2;
    panel.line(x0, y0, cx - tw / 2, y0);
    panel.line(cx + tw / 2, y0, x1, y0);
    panel.line(x1, y0, x1, y1);
    panel.line(x1, y1, x0, y1);
    panel.line(x0, y1, x0, y0);
    panel.label(g.title, cx, y0, { height: 0.0026, weight: 800 });
    g.items.forEach(([name, legend, bus], i) => {
      const cx2 = x + 0.003 + G.dx / 2 + (i % cols) * G.dx;
      const cy = y + G.title + 0.0065 + Math.floor(i / cols) * G.dy;
      const rating = ratings.get(name);
      const text = legend.replace('\n', ' ');
      out.push(
        panel.add(
          new CircuitBreaker(env, {
            id: `g650.cb.${name}`,
            label: `CB ${text} (${bus})`,
            var: `cb.${name}`,
            trippedVar: `cb.${name}_tripped`,
            rating: rating ?? '',
            diameter: 0.0085,
            collar: 'round',
          }),
          cx2,
          cy,
        ),
      );
      const lines = legend.split('\n');
      lines.forEach((ln, k) => panel.label(ln, cx2, cy + 0.0095 + k * 0.003, { height: 0.002, weight: 700 }));
      maxY = Math.max(maxY, cy);
      maxX = Math.max(maxX, cx2);
    });
    x += w + 0.006;
    shelfH = Math.max(shelfH, h);
  }
  // Printed grid coordinates on the borders (photograph: column numbers along the aft edge, row letters
  // down the sides), on the breaker pitch from the panel margin.
  const cols = Math.floor((maxX - G.margin) / G.dx) + 1;
  for (let cIdx = 0; cIdx < cols; cIdx++) {
    panel.label(String(cIdx + 1), G.margin + 0.003 + G.dx / 2 + cIdx * G.dx, 0.006, { height: 0.0022, weight: 700 });
  }
  const rows = Math.floor((maxY - G.margin) / G.dy) + 1;
  for (let rIdx = 0; rIdx < rows; rIdx++) {
    const ry = G.margin + G.title + 0.0065 + rIdx * G.dy;
    if (ry > maxY + G.dy) break;
    panel.label(String.fromCharCode(65 + (rIdx % 26)), 0.006, ry, { height: 0.0022, weight: 700 });
  }
  return out;
}
