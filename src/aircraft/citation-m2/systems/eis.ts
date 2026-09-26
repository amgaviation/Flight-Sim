/**
 * Citation M2 G3000 engine indication (EIS strip, left side of the MFD) and
 * synoptic pages / GTC system controls.
 *
 * S&D15 §10.3.E: EIS "engine speeds and temperatures; oil pressures and
 * temperatures; fuel flow, quantity and temperature; oxygen pressure and
 * electrical and pressurization systems data". S&D21 §10.3.9: CAS on both
 * PFDs. S&D21 §10.3.2: the GTCs control "selected aircraft systems such as
 * environmental control and internal lighting"; S&D15 §9.5: landing field
 * elevation entered on the GTC.
 */
import type { EisConfig, EisSection } from '../../../avionics/garmin-g3000/config';
import type { SynopticPageDef } from '../../../avionics/garmin-g3000/gdu/synoptic';
import { M2_EIS } from '../../../avionics/garmin-g3000/presets';
import { M2_LIMITS } from '../data';
import { M2 } from '../vars';
import { LOW_FUEL_LB } from './fuel';

const n1 = M2_EIS.sections.find((s) => s.kind === 'n1') as EisSection;
const itt = M2_EIS.sections.find((s) => s.kind === 'itt') as EisSection;

export const M2_EIS_CONFIG: EisConfig = {
  engines: 2,
  sections: [
    n1,
    itt,
    {
      kind: 'digital',
      rows: [
        { label: 'N2 %', vars: ['eng1.n2_pct', 'eng2.n2_pct'], decimals: 1, limits: { warnHigh: M2_LIMITS.n2RedlinePct } },
        { label: 'OIL PSI', vars: ['eng1.oil_press_psi', 'eng2.oil_press_psi'], decimals: 0, limits: { warnLow: M2_LIMITS.oilPressMinPsi, warnHigh: M2_LIMITS.oilPressMaxPsi } },
        { label: 'OIL °C', vars: ['eng1.oil_temp_c', 'eng2.oil_temp_c'], decimals: 0, limits: { warnHigh: M2_LIMITS.oilTempMaxC } },
        { label: 'FUEL PPH', vars: ['eng1.ff_pph', 'eng2.ff_pph'], decimals: 0, step: 10 },
        { label: 'FUEL °C', vars: ['fuel.left_temp_c', 'fuel.right_temp_c'], decimals: 0, limits: { cautionLow: -40 } }, // EST fuel temp caution
      ],
    },
    { kind: 'fuel', tanks: ['fuel.tank0_kg', 'fuel.tank1_kg'], unit: 'lb', capacity: 1648, lowLevel: LOW_FUEL_LB, imbalance: 200 },
    {
      kind: 'elec',
      rows: [
        { label: 'GEN AMPS', vars: ['elec.sg1_amps', 'elec.sg2_amps'], decimals: 0, limits: { cautionHigh: 300 } }, // 300 A rating (S&D15)
        { label: 'VOLTS', vars: ['elec.l_main_v', 'elec.r_main_v'], decimals: 1, limits: { cautionLow: 24, cautionHigh: 30.5 } }, // EST
        { label: 'BATT A / V', vars: ['elec.batt_amps', 'elec.batt_v'], decimals: 0 },
      ],
    },
    { kind: 'cabin', altVar: 'press.cabin_alt_ft', rateVar: 'press.cabin_rate_fpm', diffVar: 'press.diff_psi', ldgElevVar: 'press.ldg_elev_ft', oxygenVar: 'oxy.main_psi', altWarnFt: 10000, diffMaxPsi: M2_LIMITS.cabinDiffPsi },
    { kind: 'trim', pitch: { var: 'surf.pitch_trim', min: -1, max: 1, takeoffBand: [0.05, 0.55], label: 'PITCH' }, roll: { var: 'surf.aileron_trim', min: -1, max: 1 }, yaw: { var: 'surf.rudder_trim', min: -1, max: 1 } },
    {
      kind: 'flaps',
      var: 'surf.flaps_deg',
      maxDeg: 60,
      detents: [
        { deg: 0, label: '0' },
        { deg: 15, label: '15' },
        { deg: 35, label: '35' },
        { deg: 60, label: 'GND' },
      ],
      speedbrakeVar: 'surf.speedbrake',
      speedbrakeLabel: 'SPD BRK',
    },
  ],
};

const PSI = (v: string) => v;

export const M2_SYNOPTICS: SynopticPageDef[] = [
  {
    id: 'fuel',
    title: 'FUEL',
    elements: [
      { type: 'aircraft', x: 250, y: 330, scale: 1 },
      { type: 'tank', x: 40, y: 200, w: 160, h: 120, qty: 'fuel.left_ind_kg * 2.20462', capacity: 1648, label: 'L TANK', unit: 'LB', low: LOW_FUEL_LB },
      { type: 'tank', x: 300, y: 200, w: 160, h: 120, qty: 'fuel.right_ind_kg * 2.20462', capacity: 1648, label: 'R TANK', unit: 'LB', low: LOW_FUEL_LB },
      { type: 'pump', x: 120, y: 360, on: 'fuel.boost_l_on', fault: 'fail.fuel.boost_l', label: 'BOOST' },
      { type: 'pump', x: 380, y: 360, on: 'fuel.boost_r_on', fault: 'fail.fuel.boost_r', label: 'BOOST' },
      { type: 'pump', x: 70, y: 360, on: 'fuel.ejector_l_on', label: 'EJECT' },
      { type: 'pump', x: 430, y: 360, on: 'fuel.ejector_r_on', label: 'EJECT' },
      { type: 'valve', x: 120, y: 460, open: 'fuel.fw_l_open', orientation: 'v', label: 'FW SOV' },
      { type: 'valve', x: 380, y: 460, open: 'fuel.fw_r_open', orientation: 'v', label: 'FW SOV' },
      { type: 'line', points: [120, 320, 120, 600], active: 'fuel.eng1_on' },
      { type: 'line', points: [380, 320, 380, 600], active: 'fuel.eng2_on' },
      { type: 'line', points: [120, 420, 380, 420], active: `${M2.fuelXfer} != 0`, arrow: true },
      { type: 'engine', x: 120, y: 630, label: 'L ENG', running: 'eng1.running' },
      { type: 'engine', x: 380, y: 630, label: 'R ENG', running: 'eng2.running' },
      { type: 'readout', x: 120, y: 560, label: 'PSI', value: PSI('fuel.eng1_psi'), decimals: 0, limits: { cautionLow: 5 } },
      { type: 'readout', x: 380, y: 560, label: 'PSI', value: PSI('fuel.eng2_psi'), decimals: 0, limits: { cautionLow: 5 } },
      { type: 'readout', x: 250, y: 120, label: 'TOTAL LB', value: 'fuel.total_kg * 2.20462', decimals: 0 },
      { type: 'readout', x: 250, y: 160, label: 'USED LB', value: 'fuel.used_kg * 2.20462', decimals: 0 },
    ],
    controls: [
      { label: 'L BOOST', kind: 'toggle', var: M2.boostSw(1) },
      { label: 'R BOOST', kind: 'toggle', var: M2.boostSw(2) },
      { label: 'TRANSFER', kind: 'cycle', var: M2.fuelXfer, values: [-1, 0, 1], valueLabels: ['L TANK', 'OFF', 'R TANK'] },
    ],
  },
  {
    id: 'elec',
    title: 'ELECTRICAL',
    elements: [
      { type: 'source', x: 70, y: 110, label: 'L GEN', kind: 'gen', online: 'elec.sg1_online', fault: 'elec.sg1_tripped' },
      { type: 'source', x: 430, y: 110, label: 'R GEN', kind: 'gen', online: 'elec.sg2_online', fault: 'elec.sg2_tripped' },
      { type: 'source', x: 250, y: 110, label: 'BATT', kind: 'batt', online: 'elec.batt_relay_closed || elec.emer_relay_closed' },
      { type: 'source', x: 250, y: 610, label: 'GPU', kind: 'ext', online: 'elec.gpu_online' },
      { type: 'bus', x: 20, y: 220, w: 150, label: 'L MAIN', powered: 'elec.l_main_powered' },
      { type: 'bus', x: 330, y: 220, w: 150, label: 'R MAIN', powered: 'elec.r_main_powered' },
      { type: 'bus', x: 180, y: 220, w: 140, label: 'BATT', powered: 'elec.batt_bus_powered' },
      { type: 'bus', x: 180, y: 320, w: 140, label: 'EMER', powered: 'elec.emer_powered' },
      { type: 'bus', x: 20, y: 320, w: 150, label: 'L XFEED', powered: 'elec.l_xfeed_powered' },
      { type: 'bus', x: 330, y: 320, w: 150, label: 'R XFEED', powered: 'elec.r_xfeed_powered' },
      { type: 'bus', x: 180, y: 420, w: 140, label: 'AVN 1', powered: 'elec.avn1_powered' },
      { type: 'bus', x: 330, y: 420, w: 150, label: 'AVN 2', powered: 'elec.avn2_powered' },
      { type: 'readout', x: 70, y: 170, label: 'A', value: 'elec.sg1_amps', decimals: 0, limits: { cautionHigh: 300 } },
      { type: 'readout', x: 430, y: 170, label: 'A', value: 'elec.sg2_amps', decimals: 0, limits: { cautionHigh: 300 } },
      { type: 'readout', x: 70, y: 280, label: 'V', value: 'elec.l_main_v', decimals: 1, limits: { cautionLow: 24 } },
      { type: 'readout', x: 430, y: 280, label: 'V', value: 'elec.r_main_v', decimals: 1, limits: { cautionLow: 24 } },
      { type: 'readout', x: 250, y: 170, label: 'BATT A', value: 'elec.batt_amps', decimals: 0 },
      { type: 'readout', x: 250, y: 520, label: 'AUX BATT V', value: 'elec.aux_batt_v', decimals: 1 },
      { type: 'indicator', x: 250, y: 560, label: 'BATT O\'TEMP', on: 'elec.batt_overtemp', color: 'red' },
    ],
  },
  {
    id: 'ecs',
    title: 'PRESSURIZATION / ECS',
    elements: [
      { type: 'readout', x: 120, y: 120, label: 'CAB ALT FT', value: 'press.cabin_alt_ft', decimals: 0, limits: { cautionHigh: 8500, warnHigh: 10000 } },
      { type: 'readout', x: 380, y: 120, label: 'RATE FPM', value: 'press.cabin_rate_fpm', decimals: 0 },
      { type: 'readout', x: 120, y: 200, label: 'DIFF PSI', value: 'press.diff_psi', decimals: 1, limits: { warnHigh: 8.8 } },
      { type: 'readout', x: 380, y: 200, label: 'LDG ELEV FT', value: 'press.ldg_elev_ft', decimals: 0 },
      { type: 'readout', x: 120, y: 280, label: 'CABIN °C', value: 'pneu.cabin_temp_c', decimals: 0 },
      { type: 'readout', x: 380, y: 280, label: 'SUPPLY °C', value: 'pneu.cabin_supply_c', decimals: 0 },
      { type: 'bar', x: 200, y: 330, w: 100, h: 20, value: 'press.outflow_pos', min: 0, max: 1, label: 'OUTFLOW' },
      { type: 'indicator', x: 120, y: 420, label: 'EMER PRESS', on: `${M2.pressSource} == 4`, color: 'amber' },
      { type: 'indicator', x: 380, y: 420, label: 'A/C', on: 'elec.air_cond_powered && elec.air_cond_amps > 1', color: 'green' },
      { type: 'readout', x: 250, y: 500, label: 'OXY PSI', value: 'oxy.main_psi', decimals: 0, limits: { cautionLow: 400 } },
    ],
    controls: [
      { label: 'LDG ELEV', kind: 'number', var: M2.landingElevFt, min: -1000, max: 14000, step: 10, unit: 'FT' },
      { label: 'CABIN TEMP', kind: 'number', var: M2.tempSel, min: 0, max: 1, step: 0.05, decimals: 2 },
      { label: 'TEMP MODE', kind: 'cycle', var: M2.tempMode, values: [0, 1], valueLabels: ['AUTO', 'MANUAL'] },
      { label: 'A/C', kind: 'toggle', var: M2.airCondSw },
      { label: 'CABIN FAN', kind: 'cycle', var: M2.cabinFan, values: [0, 1, 2], valueLabels: ['OFF', 'LOW', 'HIGH'] },
      { label: 'CABIN LTS', kind: 'toggle', var: M2.cabinLt },
    ],
  },
  {
    id: 'anti_ice',
    title: 'ANTI-ICE',
    elements: [
      { type: 'indicator', x: 100, y: 120, label: 'L ENG A/I', on: 'pneu.eai1_ok > 0.8 && ac.m2.eng_ai1_sw', color: 'green' },
      { type: 'indicator', x: 400, y: 120, label: 'R ENG A/I', on: 'pneu.eai2_ok > 0.8 && ac.m2.eng_ai2_sw', color: 'green' },
      { type: 'indicator', x: 250, y: 200, label: 'WING A/I', on: `pneu.wai_ok > 0.8 && ${M2.wingAiSw}`, color: 'green' },
      { type: 'indicator', x: 250, y: 280, label: 'TAIL BOOTS', on: 'ice.tail_boots', color: 'green' },
      { type: 'indicator', x: 100, y: 360, label: 'W/S BLEED L', on: `${M2.wsBleedSw(1)} > 0`, color: 'green' },
      { type: 'indicator', x: 400, y: 360, label: 'W/S BLEED R', on: `${M2.wsBleedSw(2)} > 0`, color: 'green' },
      { type: 'indicator', x: 250, y: 440, label: 'P/S HEAT', on: 'elec.pitot_l_powered && elec.pitot_r_powered', color: 'green' },
      { type: 'readout', x: 250, y: 520, label: 'BLEED PSI', value: 'pneu.bleed_psi', decimals: 0 },
      { type: 'readout', x: 250, y: 580, label: 'TAT °C', value: 'adc1.tat_c', decimals: 0 },
    ],
  },
];
