/**
 * Overhead system controls shared by both flight decks:
 *  - PlaneView II (G650): hardware switches on the overhead panel. The G650
 *    aircraft module builds them from `OVERHEAD_PANELS` (or its own layout)
 *    bound to the same var names.
 *  - Symmetry (G500/G600/G700/G800): the three overhead panel touch
 *    screens ("three identical Esterline Korry touchscreens replace ... the
 *    overhead switchlights, knobs, and buttons" — BJT G500 pilot report).
 *    `buildOverheadPages()` turns the same definitions into touch pages, so
 *    a touch on the G800 writes exactly the var a G650 switch writes.
 *
 * Control names follow the G650/G450 checklists and overhead photographs
 * (code450 "Before Starting Engines Checklist": ELECTRIC POWER CONTROL
 * panel, EMERGENCY POWER ARM, APU, L/R MAIN TRU, CABIN / GALLEY MASTERS,
 * ENGINE BLEED AIR, TEMP CONTROL panel, CABIN PRESSURE CONTROL (AUTO /
 * SEMI / MANUAL / LANDING), WINDSHIELD HEAT (2), ANTI-ICE HTR (4), EVS WDO
 * HEAT, CABIN WDO HEAT, COWL ANTI-ICE (2) / WING ANTI-ICE (2) AUTO, FUEL
 * SYSTEM panel, PWR XFR UNIT (PTU) ARM, AUX PUMP ARM, CRANK MASTER, START
 * MASTER, SEAT BELT / NO SMOKE, CREW / PASSENGER OXYGEN ON / AUTO; G650ER
 * overhead photograph: SYSTEM TEST, MFD DISPLAY SWITCHING, EMERGENCY POWER,
 * FIRE TEST, FIRE DETECTION, APU CONTROL, BLEED AIR, TEMP CONTROL, exterior
 * lights). G800: split WAI (one per wing) and CAI (one per engine)
 * switches and four ECS zones (FAA FSB GVIII-G700 Rev 1 App. 4: "Increased
 * number of Anti-ice switches"); EST: the G650 (GVI) therefore has one WING
 * and one COWL anti-ice switch, each driving both sides' vars (`pairedVar`).
 *
 * Switch positions / values are EST where the source only names the
 * control: 2-position OFF=0 / ON=1; AUTO-style 3-position OFF=0 / AUTO=1 /
 * ON=2.
 */
import type { SimVars } from '../../../core/SimVars';
import { C } from '../style';
import { cell, type TouchPage, type TouchWidget } from './touch';
import type { SystemReadouts } from './bindings';
import type { EpicAirframe } from '../config';

/** Default var names of every overhead control (override with `EpicSuiteConfig.overheadVars`). */
export const GULFSTREAM_OVERHEAD_VARS: Readonly<Record<string, string>> = {
  // electrical
  'elec.batt_l': 'ac.elec.batt_l_sw',
  'elec.batt_r': 'ac.elec.batt_r_sw',
  'elec.gen_l': 'ac.elec.gen_l_sw',
  'elec.gen_r': 'ac.elec.gen_r_sw',
  'elec.apu_gen': 'ac.elec.apu_gen_sw',
  'elec.gpu': 'ac.elec.gpu_sw',
  'elec.bus_tie': 'ac.elec.bus_tie_sw',
  'elec.l_main_tru': 'ac.elec.l_main_tru_sw',
  'elec.r_main_tru': 'ac.elec.r_main_tru_sw',
  'elec.emer_pwr': 'ac.elec.emer_pwr_sw',
  'elec.rat': 'ac.elec.rat_deploy',
  'elec.cabin_master': 'ac.elec.cabin_master_sw',
  'elec.galley_master': 'ac.elec.galley_master_sw',
  'apu.master': 'ac.apu.master_sw',
  'apu.start': 'ac.apu.start_btn',
  // fuel
  'fuel.boost_l': 'ac.fuel.boost_l_sw',
  'fuel.boost_r': 'ac.fuel.boost_r_sw',
  'fuel.alt_l': 'ac.fuel.alt_l_sw',
  'fuel.alt_r': 'ac.fuel.alt_r_sw',
  'fuel.xflow': 'ac.fuel.xflow_sw',
  'fuel.hfr': 'ac.fuel.hfr_sw',
  'fuel.auto_refuel': 'ac.fuel.auto_refuel_sw',
  // hydraulics
  'hyd.edp_l': 'ac.hyd.edp_l_sw',
  'hyd.edp_r': 'ac.hyd.edp_r_sw',
  'hyd.aux': 'ac.hyd.aux_pump_sw',
  'hyd.ptu': 'ac.hyd.ptu_sw',
  // bleed / ECS / pressurization
  'bleed.l': 'ac.bleed.l_sw',
  'bleed.r': 'ac.bleed.r_sw',
  'bleed.apu': 'ac.bleed.apu_sw',
  'bleed.iso': 'ac.bleed.iso_sw',
  'ecs.pack_l': 'ac.ecs.pack_l_sw',
  'ecs.pack_r': 'ac.ecs.pack_r_sw',
  'ecs.ram_air': 'ac.ecs.ram_air_sw',
  'ecs.zone1': 'ac.ecs.zone1_temp_c',
  'ecs.zone2': 'ac.ecs.zone2_temp_c',
  'ecs.zone3': 'ac.ecs.zone3_temp_c',
  'ecs.zone4': 'ac.ecs.zone4_temp_c',
  'press.mode': 'ac.press.mode_sw',
  'press.ldg_elev': 'ac.press.ldg_elev_ft',
  'press.manual': 'ac.press.manual_cmd',
  'press.dump': 'ac.press.dump_sw',
  // ice protection
  'ice.wing_l': 'ac.ice.wing_l_sw',
  'ice.wing_r': 'ac.ice.wing_r_sw',
  'ice.cowl_l': 'ac.ice.cowl_l_sw',
  'ice.cowl_r': 'ac.ice.cowl_r_sw',
  'ice.wshld_l': 'ac.ice.wshld_l_sw',
  'ice.wshld_r': 'ac.ice.wshld_r_sw',
  'ice.probes': 'ac.ice.probe_heat_sw',
  'ice.cabin_wdo': 'ac.ice.cabin_wdo_sw',
  'ice.evs_wdo': 'ac.ice.evs_wdo_sw',
  // lighting
  'light.nav': 'ac.light.nav_sw',
  'light.beacon': 'ac.light.beacon_sw',
  'light.strobe': 'ac.light.strobe_sw',
  'light.landing_l': 'ac.light.landing_l_sw',
  'light.landing_r': 'ac.light.landing_r_sw',
  'light.taxi': 'ac.light.taxi_sw',
  'light.recog': 'ac.light.recog_sw',
  'light.logo': 'ac.light.logo_sw',
  'light.wing': 'ac.light.wing_sw',
  'light.emer': 'ac.light.emer_sw',
  'light.seatbelt': 'ac.cabin.seatbelt_sw',
  'light.nosmoke': 'ac.cabin.nosmoke_sw',
  'light.panel': 'ac.light.panel_knob',
  'light.flood': 'ac.light.flood_knob',
  'light.dome': 'ac.light.dome_sw',
  // engine start
  'eng.start_master': 'ac.eng.start_master_sw',
  'eng.crank_master': 'ac.eng.crank_master_sw',
  'eng.start_l': 'ac.eng.start_l_btn',
  'eng.start_r': 'ac.eng.start_r_btn',
  'eng.ign': 'ac.eng.ign_sw',
  // oxygen
  'oxy.crew': 'ac.oxy.crew_sw',
  'oxy.pax': 'ac.oxy.pax_sw',
};

/** One overhead control. */
export interface OverheadControl {
  /** Key into the var map. */
  key: string;
  label: string;
  /** Positions in tap-cycle order: value written and legend shown. */
  positions?: readonly { value: number; legend: string }[];
  /** Momentary: writes positions[1] while pressed, positions[0] on release. */
  momentary?: boolean;
  /** Guarded on the hardware panel: touch needs a confirmation tap. */
  guarded?: boolean;
  /** Continuous value control (temperature, elevation, dimmer). */
  stepper?: { min: number; max: number; step: number; decimals: number; unit: string; initial: number };
  /** Readout key (SystemReadouts) shown under the control, e.g. the bus it feeds. */
  status?: { key: string; onText: string; offText: string; offIsFault?: boolean };
  /** Initial value when the var is unset. */
  initial?: number;
}

export interface OverheadGroup {
  title: string;
  controls: OverheadControl[];
}

export interface OverheadPanelDef {
  id: string;
  title: string;
  groups: OverheadGroup[];
  /** Live readouts shown on the touch page (label, readout key, decimals, unit, scale). */
  readouts?: { label: string; key: string; decimals: number; unit: string; scale?: number }[];
}

const OFF_ON = [
  { value: 0, legend: 'OFF' },
  { value: 1, legend: 'ON' },
] as const;
const OFF_AUTO_ON = [
  { value: 0, legend: 'OFF' },
  { value: 1, legend: 'AUTO' },
  { value: 2, legend: 'ON' },
] as const;
const OFF_ARM_ON = [
  { value: 0, legend: 'OFF' },
  { value: 1, legend: 'ARM' },
  { value: 2, legend: 'ON' },
] as const;

/** Overhead panel definitions (EST layout grouping; names cited in the file header). */
export function overheadPanels(af: EpicAirframe): OverheadPanelDef[] {
  const zones: OverheadControl[] = [
    { key: 'ecs.zone1', label: 'COCKPIT', stepper: { min: 16, max: 30, step: 0.5, decimals: 1, unit: '°C', initial: 22 } },
    { key: 'ecs.zone2', label: 'FWD CABIN', stepper: { min: 16, max: 30, step: 0.5, decimals: 1, unit: '°C', initial: 22 } },
  ];
  if (af.ecsZones >= 4) zones.push({ key: 'ecs.zone4', label: 'MID CABIN', stepper: { min: 16, max: 30, step: 0.5, decimals: 1, unit: '°C', initial: 22 } });
  zones.push({ key: 'ecs.zone3', label: 'AFT CABIN', stepper: { min: 16, max: 30, step: 0.5, decimals: 1, unit: '°C', initial: 22 } });
  const wing: OverheadControl[] = af.splitAntiIce
    ? [
        { key: 'ice.wing_l', label: 'L WING', positions: OFF_AUTO_ON, initial: 1, status: { key: 'ice.wing_l', onText: 'ON', offText: '' } },
        { key: 'ice.wing_r', label: 'R WING', positions: OFF_AUTO_ON, initial: 1, status: { key: 'ice.wing_r', onText: 'ON', offText: '' } },
      ]
    : [{ key: 'ice.wing_l', label: 'WING', positions: OFF_AUTO_ON, initial: 1, status: { key: 'ice.wing_l', onText: 'ON', offText: '' } }];
  // GVI (G650): one cowl anti-ice switch; GVIII-G700/G800: "CAI (one for each engine)" (FAA FSB GVIII-G700 Rev 1).
  const cowl: OverheadControl[] = af.splitAntiIce
    ? [
        { key: 'ice.cowl_l', label: 'L COWL', positions: OFF_AUTO_ON, initial: 1, status: { key: 'ice.cowl_l', onText: 'ON', offText: '' } },
        { key: 'ice.cowl_r', label: 'R COWL', positions: OFF_AUTO_ON, initial: 1, status: { key: 'ice.cowl_r', onText: 'ON', offText: '' } },
      ]
    : [{ key: 'ice.cowl_l', label: 'COWL', positions: OFF_AUTO_ON, initial: 1, status: { key: 'ice.cowl_l', onText: 'ON', offText: '' } }];
  return [
    {
      id: 'ELEC',
      title: 'ELECTRICAL',
      groups: [
        {
          title: 'ELECTRIC POWER CONTROL',
          controls: [
            { key: 'elec.batt_l', label: 'L BATT', positions: OFF_ON },
            { key: 'elec.batt_r', label: 'R BATT', positions: OFF_ON },
            { key: 'elec.gen_l', label: 'L GEN', positions: OFF_ON, initial: 1, status: { key: 'gen.l.online', onText: 'ON LINE', offText: 'OFF', offIsFault: true } },
            { key: 'elec.gen_r', label: 'R GEN', positions: OFF_ON, initial: 1, status: { key: 'gen.r.online', onText: 'ON LINE', offText: 'OFF', offIsFault: true } },
            { key: 'elec.apu_gen', label: 'APU GEN', positions: OFF_ON, initial: 1, status: { key: 'gen.apu.online', onText: 'ON LINE', offText: '' } },
            { key: 'elec.gpu', label: 'GPU', positions: OFF_ON, status: { key: 'gen.gpu.avail', onText: 'AVAIL', offText: '' } },
            { key: 'elec.bus_tie', label: 'BUS TIE', positions: [{ value: 1, legend: 'AUTO' }, { value: 0, legend: 'OPEN' }], initial: 1 },
            { key: 'elec.l_main_tru', label: 'L MAIN TRU', positions: OFF_ON, initial: 1 },
            { key: 'elec.r_main_tru', label: 'R MAIN TRU', positions: OFF_ON, initial: 1 },
          ],
        },
        {
          title: 'EMERGENCY POWER',
          controls: [
            { key: 'elec.emer_pwr', label: 'EMER PWR', positions: [{ value: 0, legend: 'OFF' }, { value: 1, legend: 'ARM' }], initial: 1 },
            { key: 'elec.rat', label: 'RAT DEPLOY', positions: OFF_ON, guarded: true, status: { key: 'gen.rat.online', onText: 'ON LINE', offText: '' } },
            { key: 'elec.cabin_master', label: 'CABIN MASTER', positions: OFF_ON, initial: 1 },
            { key: 'elec.galley_master', label: 'GALLEY MASTER', positions: OFF_ON, initial: 1 },
          ],
        },
        {
          title: 'APU CONTROL',
          controls: [
            { key: 'apu.master', label: 'APU MASTER', positions: OFF_ON, status: { key: 'apu.avail', onText: 'AVAIL', offText: '' } },
            { key: 'apu.start', label: 'APU START', positions: OFF_ON, momentary: true },
          ],
        },
      ],
      readouts: [
        { label: 'L MAIN DC', key: 'bus.l_main_dc.v', decimals: 1, unit: 'V' },
        { label: 'R MAIN DC', key: 'bus.r_main_dc.v', decimals: 1, unit: 'V' },
        { label: 'L BATT', key: 'batt.l.v', decimals: 1, unit: 'V' },
        { label: 'R BATT', key: 'batt.r.v', decimals: 1, unit: 'V' },
        { label: 'L GEN', key: 'gen.l.load', decimals: 0, unit: '%' },
        { label: 'R GEN', key: 'gen.r.load', decimals: 0, unit: '%' },
      ],
    },
    {
      id: 'FUEL',
      title: 'FUEL',
      groups: [
        {
          title: 'FUEL SYSTEM',
          controls: [
            { key: 'fuel.boost_l', label: 'L BOOST', positions: OFF_AUTO_ON, initial: 1, status: { key: 'fuel.boost_l.low', onText: 'LOW PRESS', offText: '' } },
            { key: 'fuel.boost_r', label: 'R BOOST', positions: OFF_AUTO_ON, initial: 1, status: { key: 'fuel.boost_r.low', onText: 'LOW PRESS', offText: '' } },
            { key: 'fuel.alt_l', label: 'L ALT PUMP', positions: OFF_ON },
            { key: 'fuel.alt_r', label: 'R ALT PUMP', positions: OFF_ON },
            { key: 'fuel.xflow', label: 'CROSSFLOW', positions: [{ value: 0, legend: 'CLOSED' }, { value: 1, legend: 'OPEN' }], status: { key: 'fuel.xflow.open', onText: 'OPEN', offText: '' } },
            { key: 'fuel.hfr', label: 'HEATED RETURN', positions: OFF_AUTO_ON, initial: 1 },
            { key: 'fuel.auto_refuel', label: 'AUTO REFUEL', positions: OFF_ON },
          ],
        },
      ],
      readouts: [
        { label: 'L TANK', key: 'fuel.l.kg', decimals: 0, unit: 'LB', scale: 2.20462 },
        { label: 'R TANK', key: 'fuel.r.kg', decimals: 0, unit: 'LB', scale: 2.20462 },
        { label: 'TOTAL', key: 'fuel.total.kg', decimals: 0, unit: 'LB', scale: 2.20462 },
        { label: 'L TEMP', key: 'fuel.l.temp', decimals: 0, unit: '°C' },
        { label: 'R TEMP', key: 'fuel.r.temp', decimals: 0, unit: '°C' },
      ],
    },
    {
      id: 'HYD',
      title: 'HYDRAULICS',
      groups: [
        {
          title: 'HYDRAULICS',
          controls: [
            { key: 'hyd.edp_l', label: 'L ENG PUMP', positions: OFF_ON, initial: 1, status: { key: 'hyd.l.low', onText: 'LOW PRESS', offText: '' } },
            { key: 'hyd.edp_r', label: 'R ENG PUMP', positions: OFF_ON, initial: 1, status: { key: 'hyd.r.low', onText: 'LOW PRESS', offText: '' } },
            { key: 'hyd.aux', label: 'AUX PUMP', positions: OFF_ARM_ON, initial: 1, status: { key: 'hyd.aux.on', onText: 'ON', offText: '' } },
            { key: 'hyd.ptu', label: 'PWR XFR UNIT', positions: OFF_ARM_ON, initial: 1, status: { key: 'hyd.ptu.on', onText: 'ON', offText: '' } },
          ],
        },
      ],
      readouts: [
        { label: 'LEFT', key: 'hyd.l.psi', decimals: 0, unit: 'PSI' },
        { label: 'RIGHT', key: 'hyd.r.psi', decimals: 0, unit: 'PSI' },
        { label: 'L QTY', key: 'hyd.l.qty', decimals: 0, unit: '%', scale: 100 },
        { label: 'R QTY', key: 'hyd.r.qty', decimals: 0, unit: '%', scale: 100 },
        { label: 'BRK ACCUM', key: 'brk.accum', decimals: 0, unit: 'PSI' },
      ],
    },
    {
      id: 'ECS',
      title: 'BLEED / ECS',
      groups: [
        {
          title: 'BLEED AIR',
          controls: [
            { key: 'bleed.l', label: 'L ENG BLEED', positions: OFF_ON, initial: 1, status: { key: 'bleed.l.open', onText: 'OPEN', offText: '' } },
            { key: 'bleed.r', label: 'R ENG BLEED', positions: OFF_ON, initial: 1, status: { key: 'bleed.r.open', onText: 'OPEN', offText: '' } },
            { key: 'bleed.apu', label: 'APU BLEED', positions: OFF_ON, status: { key: 'bleed.apu.open', onText: 'OPEN', offText: '' } },
            { key: 'bleed.iso', label: 'ISOLATION', positions: [{ value: 1, legend: 'AUTO' }, { value: 2, legend: 'OPEN' }, { value: 0, legend: 'CLOSED' }], initial: 1 },
            { key: 'ecs.pack_l', label: 'L PACK', positions: OFF_ON, initial: 1, status: { key: 'pack.l.on', onText: 'ON', offText: '' } },
            { key: 'ecs.pack_r', label: 'R PACK', positions: OFF_ON, initial: 1, status: { key: 'pack.r.on', onText: 'ON', offText: '' } },
            { key: 'ecs.ram_air', label: 'RAM AIR', positions: [{ value: 0, legend: 'CLOSED' }, { value: 1, legend: 'OPEN' }], guarded: true },
          ],
        },
        { title: 'TEMP CONTROL', controls: zones },
        {
          title: 'CABIN PRESSURE',
          controls: [
            { key: 'press.mode', label: 'PRESS MODE', positions: [{ value: 0, legend: 'AUTO' }, { value: 1, legend: 'SEMI' }, { value: 2, legend: 'MANUAL' }] },
            { key: 'press.ldg_elev', label: 'LDG ELEV', stepper: { min: -1000, max: 15000, step: 100, decimals: 0, unit: 'FT', initial: 0 } },
            { key: 'press.manual', label: 'MAN RATE', stepper: { min: -1, max: 1, step: 0.25, decimals: 2, unit: '', initial: 0 } },
            { key: 'press.dump', label: 'DUMP', positions: OFF_ON, guarded: true },
          ],
        },
      ],
      readouts: [
        { label: 'CABIN ALT', key: 'press.cabin_alt', decimals: 0, unit: 'FT' },
        { label: 'RATE', key: 'press.rate', decimals: 0, unit: 'FPM' },
        { label: 'ΔP', key: 'press.diff', decimals: 1, unit: 'PSI' },
      ],
    },
    {
      id: 'ICE',
      title: 'ANTI-ICE',
      groups: [
        {
          title: 'ANTI-ICE',
          controls: [
            ...wing,
            ...cowl,
            { key: 'ice.probes', label: 'PROBE HEAT', positions: [{ value: 1, legend: 'AUTO' }, { value: 2, legend: 'ON' }], initial: 1 },
          ],
        },
        {
          title: 'WINDOW HEAT',
          controls: [
            { key: 'ice.wshld_l', label: 'L WSHLD', positions: OFF_ON, initial: 1 },
            { key: 'ice.wshld_r', label: 'R WSHLD', positions: OFF_ON, initial: 1 },
            { key: 'ice.cabin_wdo', label: 'CABIN WDO', positions: OFF_ON, initial: 1 },
            { key: 'ice.evs_wdo', label: 'EVS WDO', positions: OFF_ON, initial: 1 },
          ],
        },
      ],
      readouts: [{ label: 'TAT', key: 'ice.tat', decimals: 0, unit: '°C' }],
    },
    {
      id: 'LIGHTS',
      title: 'LIGHTS',
      groups: [
        {
          title: 'EXTERIOR LIGHTS',
          controls: [
            { key: 'light.nav', label: 'NAV', positions: OFF_ON },
            { key: 'light.beacon', label: 'BEACON', positions: OFF_ON },
            { key: 'light.strobe', label: 'STROBE', positions: OFF_ON },
            { key: 'light.landing_l', label: 'L LANDING', positions: OFF_ON },
            { key: 'light.landing_r', label: 'R LANDING', positions: OFF_ON },
            { key: 'light.taxi', label: 'TAXI', positions: OFF_ON },
            { key: 'light.recog', label: 'RECOG', positions: OFF_ON },
            { key: 'light.logo', label: 'LOGO', positions: OFF_ON },
            { key: 'light.wing', label: 'WING INSP', positions: OFF_ON },
          ],
        },
        {
          title: 'INTERIOR',
          controls: [
            { key: 'light.seatbelt', label: 'SEAT BELT', positions: OFF_ON },
            { key: 'light.nosmoke', label: 'NO SMOKE', positions: OFF_ON },
            { key: 'light.emer', label: 'EMER LTS', positions: [{ value: 0, legend: 'OFF' }, { value: 1, legend: 'ARM' }, { value: 2, legend: 'ON' }], initial: 1 },
            { key: 'light.dome', label: 'DOME', positions: OFF_ON },
            { key: 'light.panel', label: 'PANEL', stepper: { min: 0, max: 1, step: 0.1, decimals: 1, unit: '', initial: 0.6 } },
            { key: 'light.flood', label: 'FLOOD', stepper: { min: 0, max: 1, step: 0.1, decimals: 1, unit: '', initial: 0 } },
          ],
        },
      ],
    },
    {
      id: 'ENGINE',
      title: 'ENGINE / OXYGEN',
      groups: [
        {
          title: 'ENGINE START',
          controls: [
            { key: 'eng.start_master', label: 'START MASTER', positions: OFF_ON },
            { key: 'eng.crank_master', label: 'CRANK MASTER', positions: OFF_ON },
            { key: 'eng.start_l', label: 'L START', positions: OFF_ON, momentary: true, status: { key: 'start.1.valve', onText: 'VALVE OPEN', offText: '' } },
            { key: 'eng.start_r', label: 'R START', positions: OFF_ON, momentary: true, status: { key: 'start.2.valve', onText: 'VALVE OPEN', offText: '' } },
            { key: 'eng.ign', label: 'CONT IGN', positions: OFF_ON },
          ],
        },
        {
          title: 'OXYGEN',
          controls: [
            { key: 'oxy.crew', label: 'CREW O2', positions: OFF_ON, initial: 1 },
            { key: 'oxy.pax', label: 'PASS O2', positions: [{ value: 0, legend: 'OFF' }, { value: 1, legend: 'AUTO' }, { value: 2, legend: 'ON' }], initial: 1 },
          ],
        },
      ],
      readouts: [
        { label: 'CREW O2', key: 'oxy.crew.psi', decimals: 0, unit: 'PSI' },
        { label: 'APU', key: 'apu.n', decimals: 0, unit: '%' },
        { label: 'APU EGT', key: 'apu.egt', decimals: 0, unit: '°C' },
      ],
    },
  ];
}

/** Resolves a control's var name (null when the airframe hides it). */
export function overheadVar(key: string, overrides?: Readonly<Record<string, string | null>>): string | null {
  if (overrides && key in overrides) return overrides[key] ?? null;
  return GULFSTREAM_OVERHEAD_VARS[key] ?? null;
}

/**
 * Single-switch airframes (G650: one WING and one COWL anti-ice switch) drive
 * both sides' vars: the var of the right-hand twin written together with the
 * left-hand control, or null.
 */
export function pairedVar(key: string, overrides?: Readonly<Record<string, string | null>>): string | null {
  const twin = key === 'ice.wing_l' ? 'ice.wing_r' : key === 'ice.cowl_l' ? 'ice.cowl_r' : '';
  return twin ? overheadVar(twin, overrides) : null;
}

/** Writes the initial value of every control whose var is unset (applyState may overwrite). */
export function initOverheadVars(vars: SimVars, panels: readonly OverheadPanelDef[], overrides?: Readonly<Record<string, string | null>>): void {
  for (const p of panels) {
    for (const g of p.groups) {
      for (const c of g.controls) {
        const name = overheadVar(c.key, overrides);
        if (!name) continue;
        const init = c.initial ?? c.stepper?.initial ?? c.positions?.[0].value ?? 0;
        if (!vars.has(name)) vars.set(name, init);
        const twin = pairedVar(c.key, overrides);
        if (twin && !vars.has(twin)) vars.set(twin, init);
      }
    }
  }
}

/** Legend of the current position of a control. */
export function positionLegend(vars: SimVars, c: OverheadControl, name: string): string {
  const x = vars.get(name);
  const p = c.positions?.find((q) => q.value === x);
  return p ? p.legend : '';
}

/** Next position value in tap order. */
export function nextPosition(vars: SimVars, c: OverheadControl, name: string): number {
  const pos = c.positions ?? OFF_ON;
  const x = vars.get(name);
  const i = pos.findIndex((q) => q.value === x);
  return pos[(i + 1) % pos.length].value;
}

/**
 * Builds the overhead touch pages (one tab per panel) for a touch screen of
 * `w` x `h` logical pixels. Controls write the overhead vars; status lines
 * show system feedback from `readouts`.
 */
export function buildOverheadPages(vars: SimVars, panels: readonly OverheadPanelDef[], readouts: SystemReadouts, w: number, h: number, onTab: (id: string) => void, overrides?: Readonly<Record<string, string | null>>, splitWing = true): TouchPage[] {
  const tabH = 54;
  const pages: TouchPage[] = [];
  const tabs = (active: string): TouchWidget[] =>
    panels.map((p, i) => {
      const c = cell(8, 6, w - 16, tabH - 10, panels.length, 1, i, 0, 6);
      return { id: `tab.${p.id}`, kind: 'tab', ...c, label: p.id, on: () => active === p.id, tap: () => onTab(p.id), size: 15 } as TouchWidget;
    });
  for (const p of panels) {
    const ws: TouchWidget[] = tabs(p.id);
    const areaY = tabH + 10;
    const readH = p.readouts?.length ? 64 : 0;
    const areaH = h - areaY - readH - 8;
    const nGroups = p.groups.length;
    let gy = areaY;
    const totalRows = p.groups.reduce((a, g) => a + Math.ceil(g.controls.length / 4) + 0.5, 0);
    const rowH = Math.min(92, areaH / Math.max(1, totalRows));
    for (let gi = 0; gi < nGroups; gi++) {
      const g = p.groups[gi];
      const rows = Math.ceil(g.controls.length / 4);
      ws.push({ id: `grp.${p.id}.${gi}`, kind: 'group', x: 10, y: gy, w: w - 20, h: rowH * 0.45, label: g.title, size: 14 });
      gy += rowH * 0.45;
      for (let ci = 0; ci < g.controls.length; ci++) {
        const c = g.controls[ci];
        const name = overheadVar(c.key, overrides);
        if (!name) continue;
        const r = Math.floor(ci / 4);
        const col = ci % 4;
        const box = cell(14, gy, w - 28, rowH * rows - 6, 4, rows, col, r, 10);
        if (c.stepper) {
          const st = c.stepper;
          ws.push({ id: `ctl.${c.key}.val`, kind: 'value', ...box, w: box.w, label: c.label, sub: () => `${vars.get(name).toFixed(st.decimals)}${st.unit ? ' ' + st.unit : ''}`, size: 14 });
          const bw = box.h * 0.62;
          ws.push({ id: `ctl.${c.key}.dec`, kind: 'key', x: box.x + 2, y: box.y + box.h - bw - 2, w: bw, h: bw, label: '−', tap: () => vars.set(name, clampStep(vars.get(name) - st.step, st)) });
          ws.push({ id: `ctl.${c.key}.inc`, kind: 'key', x: box.x + box.w - bw - 2, y: box.y + box.h - bw - 2, w: bw, h: bw, label: '+', tap: () => vars.set(name, clampStep(vars.get(name) + st.step, st)) });
          continue;
        }
        const statusKey = c.status?.key;
        const wingPair = splitWing ? null : pairedVar(c.key, overrides);
        const widget: TouchWidget = {
          id: `ctl.${c.key}`,
          kind: 'toggle',
          ...box,
          label: c.label,
          sub: () => {
            const leg = positionLegend(vars, c, name);
            if (statusKey && c.status && readouts.bound(statusKey)) {
              const on = readouts.on(statusKey);
              const t = on ? c.status.onText : c.status.offText;
              return t && t !== leg ? `${leg}  ${t}` : leg;
            }
            return leg;
          },
          on: () => vars.get(name) !== (c.positions?.[0].value ?? 0),
          fault: () => !!(statusKey && c.status?.offIsFault && readouts.bound(statusKey) && vars.get(name) !== 0 && !readouts.on(statusKey)),
          guarded: c.guarded,
          size: 14,
        };
        if (c.momentary) {
          const pos = c.positions ?? OFF_ON;
          widget.press = (down) => vars.set(name, down ? pos[1].value : pos[0].value);
          widget.tap = () => undefined;
          widget.on = () => vars.get(name) === pos[1].value;
        } else {
          widget.tap = () => {
            const nv = nextPosition(vars, c, name);
            vars.set(name, nv);
            if (wingPair) vars.set(wingPair, nv);
          };
        }
        ws.push(widget);
      }
      gy += rowH * rows + 4;
    }
    if (p.readouts?.length) {
      const n = p.readouts.length;
      p.readouts.forEach((r, i) => {
        const c = cell(10, h - readH - 4, w - 20, readH, n, 1, i, 0, 6);
        ws.push({
          id: `ro.${r.key}`,
          kind: 'value',
          ...c,
          label: r.label,
          sub: () => {
            const x = readouts.get(r.key) * (r.scale ?? 1);
            return Number.isFinite(x) ? `${x.toFixed(r.decimals)} ${r.unit}` : `--- ${r.unit}`;
          },
          color: () => C.green,
          size: 13,
        });
      });
    }
    pages.push({ id: p.id, title: p.title, widgets: ws });
  }
  return pages;
}

function clampStep(x: number, st: { min: number; max: number; step: number }): number {
  const q = Math.round(x / st.step) * st.step;
  return Math.max(st.min, Math.min(st.max, Math.round(q * 1000) / 1000));
}
