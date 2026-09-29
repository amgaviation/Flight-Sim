/**
 * 737-800 circuit breaker panels: P18 (Captain's side, aft of the seat,
 * "load control center - left") and P6 (F/O's side, main power distribution
 * panel), FCOM 6.10 "Circuit breaker panels" / dossier §10.0 (sidewalls).
 *
 * Every breaker of the modelled electrical network (systems/electrical.ts:
 * one breaker per load, `cb.<load>` 1 = in, `cb.<load>_tripped`) is a
 * pullable `CircuitBreaker` bound to those vars: pulling one removes power
 * from its load (`elec.<load>_powered` = 0 and the consuming system loses
 * it: a DU blanks, a pump stops, a heater goes cold, a light goes out); an
 * overcurrent (e.g. the `elec.<load>.short` failure) trips it with the white
 * band showing; pushing it back in resets it. The test checks that this
 * table and the network's `breakerNames()` match exactly.
 *
 * Grouping: by feeding bus with the bus title engraved above each group (the
 * NG panels are organised by system with the bus named on each row; EST).
 * P18 carries the Captain-side / standby buses (AC STANDBY, AC XFR 1, DC
 * STANDBY, battery buses), P6 the F/O-side and DC buses.
 *
 * SCOPE / EST: one breaker per modelled load; the real panels carry several
 * hundred (one per LRU power feed, three-phase breakers ganged). Legends
 * follow Boeing breaker naming style; ratings are the network ratings (EST
 * per equipment class). The APU start breaker stands for the start power
 * contactor / current limiter feed (400 A is not a flight deck breaker size).
 */

export interface CbGroup {
  title: string;
  /** [breaker name (= load id), engraved legend (\n = two lines)] */
  items: [string, string][];
}

export const B738_P18: CbGroup[] = [
  {
    title: 'AC STANDBY BUS',
    items: [
      ['du_capt_out', 'CAPT OUTBD\nDU'],
      ['du_capt_in', 'CAPT INBD\nDU'],
      ['du_upper', 'UPPER\nDU'],
      ['deu1', 'DEU\n1'],
      ['irs1_ac', 'IRS L\nAC'],
      ['nav1', 'VHF NAV\n1'],
      ['ign_l', 'IGN\nL'],
      ['stby_yd', 'STBY\nYAW DMPR'],
    ],
  },
  {
    title: 'AC TRANSFER BUS 1',
    items: [
      ['fmc', 'FMC'],
      ['cdu1', 'CDU\nL'],
      ['adf1', 'ADF\n1'],
      ['ign_r', 'IGN\nR'],
      ['eec1_alt', 'EEC 1\nALTN PWR'],
      // Diagonal fuel pump split (sjap.nl NG Power Sources): XFR 1 carries TANK 1 FWD, TANK 2 AFT and CTR L.
      ['fuel_l_fwd', 'FUEL PUMP\nL FWD'],
      ['fuel_r_aft', 'FUEL PUMP\nR AFT'],
      ['fuel_c_l', 'FUEL PUMP\nCTR L'],
      ['hyd_elec1', 'HYD PUMP\nELEC 1'],
      ['probe_heat_a', 'PROBE\nHEAT A'],
      ['win_heat_l_side', 'WINDOW HT\nL SIDE'],
      ['win_heat_r_fwd', 'WINDOW HT\nR FWD'],
      ['pack_ctl_l', 'PACK\nCONT L'],
      ['recirc_l', 'RECIRC\nFAN L'],
      ['trim_air', 'TRIM\nAIR'],
      ['equip_cool', 'EQUIP\nCOOLING'],
      ['apu_scu', 'APU\nSTART CONV'],
      ['wiper_l', 'WIPER\nL'],
      ['landing_retract', 'LDG LT\nRETR'],
      ['taxi_lt', 'TAXI\nLT'],
      ['position_lts', 'POSITION\nLTS'],
      ['anti_coll', 'ANTI\nCOLL'],
      ['wing_lts', 'WING\nLTS'],
    ],
  },
  {
    title: 'DC STANDBY BUS',
    items: [
      ['com1', 'VHF COMM\n1'],
      ['efis1', 'EFIS\nCAPT'],
      ['isfd', 'ISFD'],
      ['eng_ind', 'ENG\nIND'],
      ['fire_det', 'FIRE\nDET'],
      ['ign_dc', 'IGN\nDC'],
      ['stall_warn1', 'STALL\nWARN 1'],
      ['alt_flaps', 'ALTN\nFLAPS'],
      ['stby_rud', 'STBY\nRUD'],
      ['press_altn', 'PRESS\nALTN'],
    ],
  },
  {
    title: 'BATTERY BUS',
    items: [
      ['apu_ecu', 'APU\nECU'],
      ['apu_start', 'APU\nSTART'],
      ['fire_ext', 'FIRE\nEXT'],
      ['dome_lt', 'DOME\nLTS'],
    ],
  },
  {
    title: 'HOT BATTERY BUS',
    items: [
      ['clock', 'CLOCK'],
      ['fire_bottle_sq', 'EXT\nSQUIBS'],
      ['park_brake_valve', 'PARK BRK\nVALVE'],
      ['pax_oxy', 'PASS\nOXY'],
      ['irs_dc', 'IRS\nDC'],
    ],
  },
];

export const B738_P6: CbGroup[] = [
  {
    title: 'AC TRANSFER BUS 2',
    items: [
      ['du_lower', 'LOWER\nDU'],
      ['du_fo_in', 'F/O INBD\nDU'],
      ['du_fo_out', 'F/O OUTBD\nDU'],
      ['deu2', 'DEU\n2'],
      ['cdu2', 'CDU\nR'],
      ['irs2_ac', 'IRS R\nAC'],
      ['nav2', 'VHF NAV\n2'],
      ['adf2', 'ADF\n2'],
      ['tcas', 'TCAS'],
      ['wxr', 'WX\nRADAR'],
      ['eec2_alt', 'EEC 2\nALTN PWR'],
      // Diagonal fuel pump split (sjap.nl NG Power Sources): XFR 2 carries TANK 1 AFT, TANK 2 FWD and CTR R.
      ['fuel_l_aft', 'FUEL PUMP\nL AFT'],
      ['fuel_r_fwd', 'FUEL PUMP\nR FWD'],
      ['fuel_c_r', 'FUEL PUMP\nCTR R'],
      ['hyd_elec2', 'HYD PUMP\nELEC 2'],
      ['hyd_stby', 'STBY HYD\nPUMP'],
      ['probe_heat_b', 'PROBE\nHEAT B'],
      ['win_heat_l_fwd', 'WINDOW HT\nL FWD'],
      ['win_heat_r_side', 'WINDOW HT\nR SIDE'],
      ['pack_ctl_r', 'PACK\nCONT R'],
      ['recirc_r', 'RECIRC\nFAN R'],
      ['wiper_r', 'WIPER\nR'],
      ['fixed_landing', 'LDG LT\nFIXED'],
      ['turnoff_lts', 'RWY\nTURNOFF'],
      ['strobe_lts', 'STROBE\nLTS'],
      ['logo_lts', 'LOGO\nLTS'],
      ['wheel_well_lts', 'WHEEL\nWELL LT'],
    ],
  },
  {
    title: 'DC BUS 1',
    items: [
      ['mcp1', 'MCP\n1'],
      ['fcc_a', 'FCC\nA'],
      ['at', 'AUTO\nTHROTTLE'],
      ['gps1', 'GPS\n1'],
      ['ra1', 'RADIO\nALT 1'],
      ['smyd1', 'SMYD\n1'],
      ['taws', 'GPWS'],
      ['mach_warn', 'MACH\nWARN'],
      ['yd', 'YAW\nDAMPER'],
      ['stab_trim', 'STAB TRIM\nMAIN ELEC'],
      ['flt_ctl_a', 'FLT CONT\nA'],
      ['gear_ctl', 'LDG GEAR\nCONT'],
      ['antiskid', 'ANTI-\nSKID'],
      ['autobrake', 'AUTO\nBRAKE'],
      ['press_auto', 'PRESS\nAUTO'],
      ['eng1_start', 'ENG 1\nSTART'],
      ['fuel_valves', 'FUEL\nVALVES'],
      ['bleed_ctl_l', 'BLEED\nL'],
      ['wing_ai_valve', 'WING\nA/I'],
      ['eng_ai1', 'ENG 1\nA/I'],
      ['cargo_fire', 'CARGO\nFIRE'],
      ['wxr_ctl', 'WXR\nCONT'],
      ['emer_lts', 'EMER\nLTS'],
      ['fd_door_lock', 'FLT DK\nDOOR LOCK'],
      ['xpdr2', 'ATC\n2'],
      ['panel_lts', 'PANEL\nLTS'],
      ['annun_lts', 'MASTER\nDIM'],
    ],
  },
  {
    title: 'DC BUS 2',
    items: [
      ['mcp2', 'MCP\n2'],
      ['fcc_b', 'FCC\nB'],
      ['com2', 'VHF COMM\n2'],
      ['efis2', 'EFIS\nF/O'],
      ['gps2', 'GPS\n2'],
      ['ra2', 'RADIO\nALT 2'],
      ['xpdr', 'ATC\n1'],
      ['smyd2', 'SMYD\n2'],
      ['stall_warn2', 'STALL\nWARN 2'],
      ['flt_ctl_b', 'FLT CONT\nB'],
      ['spoiler_ctl', 'SPOILER\nCONT'],
      ['steering', 'NOSE\nSTEER'],
      ['eng2_start', 'ENG 2\nSTART'],
      ['bleed_ctl_r', 'BLEED\nR'],
      ['eng_ai2', 'ENG 2\nA/I'],
      ['flood_lts', 'FLOOD\nLTS'],
    ],
  },
  {
    title: 'AC MAIN BUS 1 / 2 (CAB/UTIL)',
    items: [
      ['galley_fwd', 'GALLEY\nFWD'],
      ['ife', 'IFE /\nPASS SEAT'],
      ['galley_aft', 'GALLEY\nAFT'],
      ['cabin_lts', 'CABIN\nLTS'],
    ],
  },
];
