/**
 * Global 6000 circuit-breaker directory: every breaker of the electrical
 * network (systems/electrical.ts: each load has `cb: { name: <load id> }`,
 * var `cb.<id>`, trip var `cb.<id>_tripped`) with its EMS name, EMS system
 * group, bus and location.
 *
 * Source: Global 5000 / Global Express FCOM CSP 700-5000-6 Vol. 2 chapter 7
 * ("Electrical"): 07-10-9..12 (EMS: "Load control consists of smart
 * contactors, Solid State Power Controllers (SSPC) ... can be acknowledged
 * and reset via the EMS"; locations CCBP = thermal breaker on the Cockpit
 * Circuit Breaker Panel, ACPC = thermal breaker in the AC power centre, both
 * "cannot be reset using EMS CDU"), 07-20-1 (CCBP drawing FGF0720_005) and
 * 07-20-2..38 (CB lists by system and by bus: names such as "L AUX PUMP",
 * "SLAT/FLAP PWR 1", "STAB TRIM CH 2 ... CCBP", "HYD PUMP 3B ... ACPC",
 * "L ENG FUEL SOV ... DCPC", "APU START ... ASCA").
 *
 * Where the model lumps several real breakers into one load (e.g. the
 * pitot / AOA / TAT heaters in `probe_heat`), the name is the lumped function
 * (EST); names in brackets are EST where the lists give no direct equivalent.
 * Locations follow the FCOM lists; loads the lists do not cover are SSPC
 * (DC buses) or ACPC (AC buses), EST.
 */

/** EMS "CIRCUIT BREAKER - SYSTEM" groups in the FCOM order (07-20-2: page 1 then page 2). */
export const EMS_SYSTEMS = [
  'AFCS',
  'AIR COND/PRESS',
  'APU',
  'BLEED',
  'CAIMS',
  'COMM',
  'DOORS',
  'ELEC',
  'ENGINE',
  'FIRE',
  'FLT CONTROLS',
  'FUEL',
  'HYD',
  'ICE',
  'IND/RECORD',
  'LDG GEAR',
  'LIGHTS',
  'NAV',
  'OIL',
  'OXYGEN',
  'THRUST REV',
] as const;
export type EmsSystem = (typeof EMS_SYSTEMS)[number];

/** Breaker location (FCOM 07-10-10): SSPC resettable from the EMS CDU; the others are thermal breakers. */
export type CbLocation = 'SSPC' | 'CCBP' | 'ACPC' | 'DCPC' | 'ASCA';

/** EMS bus labels (07-20-4 .. 38). */
export const EMS_BUSES = ['AC 1', 'AC 2', 'AC 3', 'AC 4', 'AC ESS', 'DC 1', 'DC 2', 'DC ESS', 'BATT', 'DC EMER', 'APU BATT'] as const;
export type EmsBus = (typeof EMS_BUSES)[number];

export interface CbEntry {
  /** Network breaker / load id (`cb.<id>`). */
  id: string;
  /** EMS / placard name. */
  name: string;
  sys: EmsSystem;
  bus: EmsBus;
  loc: CbLocation;
}

const e = (id: string, name: string, sys: EmsSystem, bus: EmsBus, loc: CbLocation = 'SSPC'): CbEntry => ({ id, name, sys, bus, loc });

export const CB_TABLE: CbEntry[] = [
  // ---------------------------------------------------------------- DC ESS BUS (07-20-24 .. 29)
  e('afd1', 'DU 1', 'IND/RECORD', 'DC ESS'),
  e('ctp1', '(CTP 1)', 'COMM', 'DC ESS'),
  e('ccp1', '(CCP 1)', 'IND/RECORD', 'DC ESS'),
  e('mkp1', '(MKP 1)', 'NAV', 'DC ESS'),
  e('fcp', 'GUID PANEL CH 2', 'AFCS', 'DC ESS'),
  e('adc1', 'ADC 1', 'NAV', 'DC ESS'), // 07-20-30 lists ADC 1 on BATT; modelled on DC ESS
  e('irs1', 'IRS 1 PWR A', 'NAV', 'DC ESS'),
  e('afcs1', 'AP 1 SERVOS', 'AFCS', 'DC ESS'),
  e('fadec1', 'L FADEC CH A', 'ENGINE', 'DC ESS'),
  e('ign1', 'L ENG IGN 1', 'ENGINE', 'DC ESS'),
  e('start_valve1', 'L ENG START A', 'ENGINE', 'DC ESS'),
  e('aux_pump_l', 'L AUX PUMP', 'FUEL', 'DC ESS'),
  e('sfcu1', 'SLAT/FLAP PWR 1', 'FLT CONTROLS', 'DC ESS', 'CCBP'),
  e('fcu1', 'FLT CTL 1 CH A', 'FLT CONTROLS', 'DC ESS'),
  e('stab_trim1', 'STAB TRIM CH 1', 'FLT CONTROLS', 'DC ESS', 'CCBP'),
  e('lgecu_a', 'GEAR CTL A PWR 1', 'LDG GEAR', 'DC ESS'),
  e('bcu_a', 'BRAKE CTL CH A', 'LDG GEAR', 'DC ESS'),
  e('nws1', 'NOSE STEER PWR 1', 'LDG GEAR', 'DC ESS'),
  e('spc', 'SPC CH B', 'FLT CONTROLS', 'DC ESS'),
  e('fideex_a', 'FIRE DETECT CH A', 'FIRE', 'DC ESS'),
  e('fuel_cmptr_a', 'FUEL COMPUTR CH A', 'FUEL', 'DC ESS'),
  e('bmc1', 'L BMC CH A', 'BLEED', 'DC ESS'),
  e('cpc1', 'AUTO PRESS 1', 'AIR COND/PRESS', 'DC ESS'),
  e('com1', 'VHF COM 1', 'COMM', 'DC ESS'),
  e('nav1', 'VOR/ILS 1', 'NAV', 'DC ESS'),
  e('gps1', 'GPS 1', 'NAV', 'DC ESS'),
  e('iac1', 'IAC 1', 'IND/RECORD', 'DC ESS'),
  e('ice_det', 'ICE DETECTOR', 'ICE', 'DC ESS', 'CCBP'),
  e('hbmu', 'HBMU 1', 'ICE', 'DC ESS'),
  // ---------------------------------------------------------------- BATT BUS (07-20-30 .. 36)
  e('afd4', 'DU 4 PWR A', 'IND/RECORD', 'BATT'),
  e('ctp2', '(CTP 2)', 'COMM', 'BATT'),
  e('adc2', 'ADC 2', 'NAV', 'BATT'),
  e('irs2', 'IRS 2 PWR A', 'NAV', 'BATT'),
  e('afcs2', 'AP 2 SERVOS', 'AFCS', 'BATT'),
  e('fadec2', 'R FADEC CH A', 'ENGINE', 'BATT'),
  e('ign2', 'R ENG IGN 1', 'ENGINE', 'BATT'),
  e('start_valve2', 'R ENG START A', 'ENGINE', 'BATT'),
  e('aux_pump_r', 'R AUX PUMP', 'FUEL', 'BATT'),
  e('sfcu2', 'SLAT/FLAP PWR 2', 'FLT CONTROLS', 'BATT', 'CCBP'),
  e('fcu2', 'FLT CTL 2 CH A', 'FLT CONTROLS', 'BATT'),
  e('stab_trim2', 'STAB TRIM CH 2', 'FLT CONTROLS', 'BATT', 'CCBP'),
  e('lgecu_b', 'GEAR CTL B PWR 1', 'LDG GEAR', 'BATT'),
  e('bcu_b', 'BRAKE CTL CH B', 'LDG GEAR', 'BATT'),
  e('nws2', 'NOSE STEER PWR 2', 'LDG GEAR', 'BATT'),
  e('fideex_b', 'FIRE DETECT CH B', 'FIRE', 'BATT'),
  e('xfeed_valve', 'XFEED SOV', 'FUEL', 'BATT'),
  e('fuel_cmptr_b', 'FUEL COMPUTR CH B', 'FUEL', 'BATT'),
  e('apu_fadec', 'APU FADEC PWR 1', 'APU', 'BATT'),
  e('apu_door', 'APU DOOR', 'APU', 'BATT'),
  e('bmc2', 'R BMC CH A', 'BLEED', 'BATT'),
  e('cpc2', 'AUTO PRESS 2', 'AIR COND/PRESS', 'BATT'),
  e('iac2', 'IAC 2', 'IND/RECORD', 'BATT'),
  e('com2', 'VHF COM 2', 'COMM', 'BATT'),
  e('ccp2', '(CCP 2)', 'IND/RECORD', 'BATT'),
  e('mkp2', '(MKP 2)', 'NAV', 'BATT'),
  // ---------------------------------------------------------------- DC BUS 1 (07-20-10 .. 16)
  e('afd2', 'DU 2', 'IND/RECORD', 'DC 1'),
  e('ra1', 'RAD ALT 1', 'NAV', 'DC 1'),
  e('taws', 'GPWS', 'NAV', 'DC 1'),
  e('radar', 'WX RADAR', 'NAV', 'DC 1'),
  e('xpdr1', 'TRANSPONDER 1', 'NAV', 'DC 1'),
  e('tcas', 'TCAS', 'NAV', 'DC 1'),
  e('adf1', 'ADF 1', 'NAV', 'DC 1'),
  e('fms', 'FMS 3 CDU', 'NAV', 'DC 1'),
  e('ldg_lt_l', 'L WING LDG LT', 'LIGHTS', 'DC 1'),
  e('ldg_lt_nose', 'NOSE LDG LTS', 'LIGHTS', 'DC 1'),
  e('taxi_lt', 'TAXI LTS', 'LIGHTS', 'DC 1'),
  e('nav_lts', 'NAV LTS', 'LIGHTS', 'DC 1'),
  e('beacon', 'BEACON LTS', 'LIGHTS', 'DC 1'),
  e('logo', 'LOGO LTS', 'LIGHTS', 'DC 1'),
  e('flood_lts', 'FLOOD LTS', 'LIGHTS', 'DC 1'),
  e('integral_lts', 'INTG LTS', 'LIGHTS', 'DC 1'),
  e('hud', 'HUD', 'IND/RECORD', 'DC 1'),
  // ---------------------------------------------------------------- DC BUS 2 (07-20-17 .. 23)
  e('afd3', 'DU 3 PWR B', 'IND/RECORD', 'DC 2'),
  e('ra2', 'RAD ALT 2', 'NAV', 'DC 2'),
  e('irs3', 'IRS 3 PWR A', 'NAV', 'DC 2'),
  e('xpdr2', 'TRANSPONDER 2', 'NAV', 'DC 2'),
  e('adf2', 'ADF 2', 'NAV', 'DC 2'),
  e('nav2', 'VOR/ILS 2', 'NAV', 'DC 2'),
  e('gps2', 'GPS 2', 'NAV', 'DC 2'),
  e('com3', 'VHF COM 3', 'COMM', 'DC 2'),
  e('ldg_lt_r', 'R WING LDG LT', 'LIGHTS', 'DC 2'),
  e('strobe', 'WING STROBE LTS', 'LIGHTS', 'DC 2'),
  e('wing_insp', 'WING INSPECT LTS', 'LIGHTS', 'DC 2'),
  e('dome_map_lts', 'DOME/MAP LTS', 'LIGHTS', 'DC 2'),
  e('cabin_dc', 'DC 2 CABIN FEED', 'ELEC', 'DC 2'),
  e('pass_signs', 'SEAT BELTS SIGN', 'LIGHTS', 'DC 2'),
  // ---------------------------------------------------------------- DC EMER BUS (07-20-9: DCPC thermal)
  e('iesi', 'STBY ADI', 'IND/RECORD', 'DC EMER', 'CCBP'),
  e('eng_sov1', 'L ENG FUEL SOV', 'FUEL', 'DC EMER', 'DCPC'),
  e('eng_sov2', 'R ENG FUEL SOV', 'FUEL', 'DC EMER', 'DCPC'),
  e('apu_fire_sov', 'APU FIRE SOV', 'FIRE', 'DC EMER', 'DCPC'),
  e('fire_ext', 'FIREX CH A', 'FIRE', 'DC EMER', 'DCPC'),
  e('emer_lts', 'EMER LTS', 'LIGHTS', 'DC EMER'),
  e('elt', '(ELT)', 'COMM', 'DC EMER', 'DCPC'),
  // ---------------------------------------------------------------- APU BATT (ASCA)
  e('apu_starter', 'APU START', 'APU', 'APU BATT', 'ASCA'),
  // ---------------------------------------------------------------- AC buses (07-20-4 .. 8)
  e('pri_l1', 'L FWD PRI PUMP', 'FUEL', 'AC 2', 'ACPC'),
  e('pri_l2', 'L AFT PRI PUMP', 'FUEL', 'AC 1', 'ACPC'),
  e('pri_r1', 'R FWD PRI PUMP', 'FUEL', 'AC 3', 'ACPC'),
  e('pri_r2', 'R AFT PRI PUMP', 'FUEL', 'AC 4', 'ACPC'),
  e('ctr_xfer1', 'L CTR XFER PUMP', 'FUEL', 'AC 1', 'ACPC'),
  e('ctr_xfer2', 'R CTR XFER PUMP', 'FUEL', 'AC 4', 'ACPC'),
  e('aft_xfer1', 'AFT TANK L PUMP', 'FUEL', 'AC 2', 'ACPC'),
  e('aft_xfer2', 'AFT TANK R PUMP', 'FUEL', 'AC 3', 'ACPC'),
  e('acmp1b', 'HYD PUMP 1B', 'HYD', 'AC 3', 'ACPC'),
  e('acmp2b', 'HYD PUMP 2B', 'HYD', 'AC 2', 'ACPC'),
  e('acmp3a', 'HYD PUMP 3A', 'HYD', 'AC 4', 'ACPC'),
  e('acmp3b', 'HYD PUMP 3B', 'HYD', 'AC 1', 'ACPC'),
  e('wshld_l', 'L WSHLD HEAT', 'ICE', 'AC 1', 'CCBP'),
  e('wshld_s', 'WINDOW HEAT', 'ICE', 'AC 2', 'CCBP'),
  e('wshld_r', 'R WSHLD HEAT', 'ICE', 'AC 4', 'CCBP'),
  e('probe_heat', 'PITOT/AOA/TAT HT', 'ICE', 'AC ESS', 'CCBP'),
  e('recirc_fans', 'RECIRC FANS', 'AIR COND/PRESS', 'AC 3', 'ACPC'),
  e('cabin_ac', 'AC 2 CABIN FEED', 'ELEC', 'AC 2', 'ACPC'),
  e('cabin_ac2', 'AC 3 CABIN FEED', 'ELEC', 'AC 3', 'ACPC'),
  e('av_batt_chgr', 'AV BATT CHGR', 'ELEC', 'AC 2', 'CCBP'),
  e('apu_batt_chgr', 'APU BATT CHGR', 'ELEC', 'AC 3', 'CCBP'),
  e('apu_oil_heat', 'APU OIL HEAT', 'APU', 'AC 4', 'ACPC'),
  e('avionics_fans', 'AVIONICS FAN', 'IND/RECORD', 'AC ESS', 'ACPC'),
];

export const CB_BY_ID: ReadonlyMap<string, CbEntry> = new Map(CB_TABLE.map((x) => [x.id, x]));

/** Breakers on the Cockpit Circuit Breaker Panel (physical, pullable in the cockpit). */
export const CCBP_ENTRIES = CB_TABLE.filter((x) => x.loc === 'CCBP');

/** EMS status text of a breaker from its vars (07-10-10: IN / OUT / TRIP). */
export function cbStatus(inVal: number, tripped: number): 'IN' | 'OUT' | 'TRIP' {
  if (tripped !== 0) return 'TRIP';
  return inVal !== 0 ? 'IN' : 'OUT';
}
