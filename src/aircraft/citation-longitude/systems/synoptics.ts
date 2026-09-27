/**
 * Citation Longitude G5000 synoptic pages (MFD "Aircraft Systems" panes) and the
 * GTC system controls that live on them.
 *
 * OG Section 4 (G5000 overview): the MFD synoptics cover the electrical, fuel,
 * hydraulic, environmental / pressurization and anti-ice systems, and the GTC
 * "Aircraft Systems" screen carries the touch controls that have no hardware
 * switch in the Longitude: exterior NAV / BEACON / auto PULSE lights (OG 16-3),
 * cabin and cockpit temperature targets and the recirculation fan (OG 10-3/10-4),
 * and the Cabin Pressure page, Normal (FMS destination or manual landing
 * elevation) / Altitude Select (OG 11-4/11-5).
 *
 * SCOPE: the page artwork is a schematic in the Garmin synoptic style, not a
 * reproduction of the Textron page layouts (no public screenshots with legible
 * layout were used); element positions are EST. Every value shown is a live
 * system var and every control writes the var its system reads (vars.ts).
 */
import type { SynopticPageDef } from '../../../avionics/garmin-g3000/gdu/synoptic';
import { LON_LIMITS } from '../data';
import { LON_VARS as V } from '../vars';

const KG_LB = 2.20462;
const TANK_LB = LON_LIMITS.tankUsableLb; // FPG p.3: 7,250 lb usable per wing tank
const LOW_FUEL_LB = 500; // OG CAS FUEL LEVEL LOW

export const LONGITUDE_SYNOPTICS: SynopticPageDef[] = [
  {
    id: 'elec',
    title: 'ELECTRICAL',
    elements: [
      { type: 'source', x: 60, y: 90, label: 'L GEN', kind: 'gen', online: 'elec.gen_l_online', fault: 'elec.gen_l_tripped' },
      { type: 'source', x: 250, y: 90, label: 'APU GEN', kind: 'apu', online: 'elec.apu_gen_online', fault: 'elec.apu_gen_tripped' },
      { type: 'source', x: 440, y: 90, label: 'R GEN', kind: 'gen', online: 'elec.gen_r_online', fault: 'elec.gen_r_tripped' },
      { type: 'readout', x: 60, y: 140, label: 'A', value: 'elec.gen_l_amps', decimals: 0, limits: { cautionHigh: 0.75 * LON_LIMITS.genFlightA } },
      { type: 'readout', x: 250, y: 140, label: 'A', value: 'elec.apu_gen_amps', decimals: 0, limits: { cautionHigh: 0.75 * LON_LIMITS.apuGenGroundA } },
      { type: 'readout', x: 440, y: 140, label: 'A', value: 'elec.gen_r_amps', decimals: 0, limits: { cautionHigh: 0.75 * LON_LIMITS.genFlightA } },
      { type: 'bus', x: 20, y: 190, w: 180, label: 'L MISSION', powered: 'elec.mission_l_powered' },
      { type: 'bus', x: 300, y: 190, w: 180, label: 'R MISSION', powered: 'elec.mission_r_powered' },
      { type: 'line', points: [200, 200, 300, 200], active: 'elec.bus_tie_closed' },
      { type: 'text', x: 250, y: 185, text: 'BUS TIE', size: 14 },
      { type: 'bus', x: 20, y: 270, w: 180, label: 'L MAIN', powered: 'elec.main_l_powered' },
      { type: 'bus', x: 300, y: 270, w: 180, label: 'R MAIN', powered: 'elec.main_r_powered' },
      { type: 'bus', x: 20, y: 350, w: 180, label: 'L EMER', powered: 'elec.emer_l_powered' },
      { type: 'bus', x: 300, y: 350, w: 180, label: 'R EMER', powered: 'elec.emer_r_powered' },
      { type: 'bus', x: 20, y: 430, w: 180, label: 'L INTERIOR', powered: 'elec.int_l_powered' },
      { type: 'bus', x: 300, y: 430, w: 180, label: 'R INTERIOR', powered: 'elec.int_r_powered' },
      { type: 'bus', x: 160, y: 510, w: 180, label: 'STANDBY', powered: 'elec.stby_powered' },
      { type: 'source', x: 60, y: 600, label: 'L BATT', kind: 'batt', online: 'elec.batt_l_rly_closed' },
      { type: 'source', x: 440, y: 600, label: 'R BATT', kind: 'batt', online: 'elec.batt_r_rly_closed' },
      { type: 'source', x: 250, y: 600, label: 'EXT PWR', kind: 'ext', online: 'elec.gpu_online' },
      { type: 'source', x: 250, y: 660, label: 'HYD GEN', kind: 'ptcu', online: 'elec.ptcu_gen_online' },
      { type: 'readout', x: 60, y: 650, label: 'V', value: 'elec.batt_l_v', decimals: 1, limits: { cautionLow: 24 } },
      { type: 'readout', x: 440, y: 650, label: 'V', value: 'elec.batt_r_v', decimals: 1, limits: { cautionLow: 24 } },
      { type: 'readout', x: 60, y: 690, label: 'A', value: 'elec.batt_l_amps', decimals: 0 },
      { type: 'readout', x: 440, y: 690, label: 'A', value: 'elec.batt_r_amps', decimals: 0 },
      { type: 'readout', x: 110, y: 240, label: 'V', value: 'elec.mission_l_v', decimals: 1, limits: { cautionLow: 24 } },
      { type: 'readout', x: 390, y: 240, label: 'V', value: 'elec.mission_r_v', decimals: 1, limits: { cautionLow: 24 } },
    ],
  },
  {
    id: 'fuel',
    title: 'FUEL',
    elements: [
      { type: 'aircraft', x: 250, y: 330, scale: 1 },
      { type: 'tank', x: 30, y: 200, w: 170, h: 120, qty: `fuel.left_ind_kg * ${KG_LB}`, capacity: TANK_LB, label: 'L TANK', unit: 'LB', low: LOW_FUEL_LB },
      { type: 'tank', x: 300, y: 200, w: 170, h: 120, qty: `fuel.right_ind_kg * ${KG_LB}`, capacity: TANK_LB, label: 'R TANK', unit: 'LB', low: LOW_FUEL_LB },
      { type: 'pump', x: 70, y: 360, on: 'fuel.ejector_l_on', fault: 'fuel.ejector_l_lowpress', label: 'EJECT' },
      { type: 'pump', x: 130, y: 360, on: 'fuel.boost_l_on', label: 'BOOST' },
      { type: 'pump', x: 370, y: 360, on: 'fuel.boost_r_on', label: 'BOOST' },
      { type: 'pump', x: 430, y: 360, on: 'fuel.ejector_r_on', fault: 'fuel.ejector_r_lowpress', label: 'EJECT' },
      { type: 'line', points: [100, 320, 100, 600], active: 'fuel.eng1_on' },
      { type: 'line', points: [400, 320, 400, 600], active: 'fuel.eng2_on' },
      { type: 'line', points: [100, 430, 400, 430], active: 'fuel.grav_xflow_active' },
      { type: 'text', x: 250, y: 420, text: 'GRAV XFLOW', size: 13 },
      { type: 'line', points: [100, 470, 400, 470], active: 'fuel.xfer_to_r_active', arrow: true },
      { type: 'line', points: [400, 490, 100, 490], active: 'fuel.xfer_to_l_active', arrow: true },
      { type: 'text', x: 250, y: 510, text: 'TRANSFER', size: 13 },
      { type: 'engine', x: 100, y: 630, label: 'L ENG', running: 'eng1.running' },
      { type: 'engine', x: 400, y: 630, label: 'R ENG', running: 'eng2.running' },
      { type: 'readout', x: 170, y: 560, label: 'PSI', value: 'fuel.eng1_psi', decimals: 0, limits: { cautionLow: 5 } },
      { type: 'readout', x: 330, y: 560, label: 'PSI', value: 'fuel.eng2_psi', decimals: 0, limits: { cautionLow: 5 } },
      { type: 'readout', x: 100, y: 690, label: 'INLET °C', value: V.fuelInletC(1), decimals: 0, limits: { cautionLow: 3 } },
      { type: 'readout', x: 400, y: 690, label: 'INLET °C', value: V.fuelInletC(2), decimals: 0, limits: { cautionLow: 3 } },
      { type: 'readout', x: 250, y: 110, label: 'TOTAL LB', value: `fuel.total_kg * ${KG_LB}`, decimals: 0 },
      { type: 'readout', x: 250, y: 160, label: 'USED LB', value: `fuel.used_kg * ${KG_LB}`, decimals: 0 },
      { type: 'indicator', x: 250, y: 570, label: 'IMBALANCE', on: 'fuel.imbalance', color: 'amber' },
    ],
  },
  {
    id: 'hyd',
    title: 'HYDRAULICS',
    elements: [
      { type: 'engine', x: 100, y: 110, label: 'L ENG', running: 'eng1.running' },
      { type: 'engine', x: 400, y: 110, label: 'R ENG', running: 'eng2.running' },
      { type: 'pump', x: 100, y: 200, on: 'hyd.edp_a_on', fault: 'hyd.edp_a_lowpress', label: 'EDP A' },
      { type: 'pump', x: 400, y: 200, on: 'hyd.edp_b_on', fault: 'hyd.edp_b_lowpress', label: 'EDP B' },
      { type: 'box', x: 30, y: 250, w: 140, h: 90, label: 'SYSTEM A', active: 'hyd.a_psi > 1500', fault: 'hyd.a_lowpress' },
      { type: 'box', x: 330, y: 250, w: 140, h: 90, label: 'SYSTEM B', active: 'hyd.b_psi > 1500', fault: 'hyd.b_lowpress' },
      { type: 'readout', x: 100, y: 370, label: 'PSI', value: 'hyd.a_psi', decimals: 0, limits: { cautionLow: 1500 } },
      { type: 'readout', x: 400, y: 370, label: 'PSI', value: 'hyd.b_psi', decimals: 0, limits: { cautionLow: 1500 } },
      { type: 'readout', x: 100, y: 410, label: 'QTY %', value: 'hyd.a_qty_pct', decimals: 0, limits: { cautionLow: 30 } },
      { type: 'readout', x: 400, y: 410, label: 'QTY %', value: 'hyd.b_qty_pct', decimals: 0, limits: { cautionLow: 30 } },
      { type: 'readout', x: 100, y: 450, label: '°C', value: V.hydTempC('a'), decimals: 0, limits: { warnHigh: LON_LIMITS.hydOtempC } },
      { type: 'readout', x: 400, y: 450, label: '°C', value: V.hydTempC('b'), decimals: 0, limits: { warnHigh: LON_LIMITS.hydOtempC } },
      { type: 'box', x: 180, y: 250, w: 140, h: 90, label: 'PTCU', active: 'hyd.ptcu_xfer_active || hyd.ptcu_pump_a_on || hyd.ptcu_pump_b_on || elec.ptcu_gen_online' },
      { type: 'line', points: [170, 295, 180, 295], active: 'hyd.ptcu_xfer_active || hyd.ptcu_pump_a_on' },
      { type: 'line', points: [320, 295, 330, 295], active: 'hyd.ptcu_xfer_active || hyd.ptcu_pump_b_on' },
      { type: 'box', x: 180, y: 520, w: 140, h: 70, label: 'RUDDER STBY', active: 'hyd.rss_psi > 1500' },
      { type: 'readout', x: 250, y: 620, label: 'RSS PSI', value: 'hyd.rss_psi', decimals: 0 },
      { type: 'indicator', x: 100, y: 520, label: 'FW SHUTOFF A', on: `${V.hydPumpA} == 2`, color: 'amber' },
      { type: 'indicator', x: 400, y: 520, label: 'FW SHUTOFF B', on: `${V.hydPumpB} == 2`, color: 'amber' },
    ],
  },
  {
    id: 'ecs',
    title: 'ECS / PRESSURIZATION',
    elements: [
      { type: 'readout', x: 120, y: 90, label: 'CAB ALT FT', value: 'press.cabin_alt_ft', decimals: 0, limits: { cautionHigh: LON_LIMITS.cabinAltCautionFt, warnHigh: LON_LIMITS.cabinAltWarnFt } },
      { type: 'readout', x: 380, y: 90, label: 'RATE FPM', value: 'press.cabin_rate_fpm', decimals: 0 },
      { type: 'readout', x: 120, y: 160, label: 'ΔP PSI', value: 'press.diff_psi', decimals: 1, limits: { warnHigh: LON_LIMITS.cabinDeltaPWarnPsi } },
      { type: 'readout', x: 380, y: 160, label: 'LDG ELEV FT', value: 'press.ldg_elev_ft', decimals: 0 },
      { type: 'bar', x: 200, y: 200, w: 100, h: 18, value: 'press.outflow_pos', min: 0, max: 1, label: 'OUTFLOW' },
      { type: 'valve', x: 90, y: 300, open: 'pneu.press_l_open', orientation: 'h', label: 'L PRESS SRC' },
      { type: 'valve', x: 410, y: 300, open: 'pneu.press_r_open', orientation: 'h', label: 'R PRESS SRC' },
      { type: 'line', points: [110, 300, 390, 300], active: 'pneu.pack_on' },
      { type: 'box', x: 190, y: 330, w: 120, h: 60, label: 'ACM', active: 'pneu.pack_on', fault: 'pneu.pack_trip' },
      { type: 'readout', x: 120, y: 450, label: 'CABIN °C', value: 'pneu.cabin_temp_c', decimals: 0 },
      { type: 'readout', x: 380, y: 450, label: 'CKPT °C', value: 'pneu.ckpt_temp_c', decimals: 0 },
      { type: 'readout', x: 120, y: 500, label: 'SET °C', value: V.cabinSetC, decimals: 0 },
      { type: 'readout', x: 380, y: 500, label: 'SET °C', value: V.ckptSetC, decimals: 0 },
      { type: 'readout', x: 120, y: 550, label: 'SUPPLY °C', value: 'pneu.cabin_supply_c', decimals: 0 },
      { type: 'readout', x: 380, y: 550, label: 'SUPPLY °C', value: 'pneu.ckpt_supply_c', decimals: 0 },
      { type: 'indicator', x: 250, y: 610, label: 'PASS OXY', on: 'oxy.pax_on', color: 'amber' },
      { type: 'readout', x: 250, y: 660, label: 'OXY PSI', value: 'oxy.main_psi', decimals: 0, limits: { cautionLow: 400 } },
    ],
    controls: [
      { label: 'CABIN TEMP', kind: 'number', var: V.cabinSetC, min: 16, max: 29, step: 1, unit: '°C' }, // EST range
      { label: 'CKPT TEMP', kind: 'number', var: V.ckptSetC, min: 16, max: 29, step: 1, unit: '°C' },
      { label: 'RECIRC FAN', kind: 'cycle', var: V.recircFan, values: [0, 1, 2], valueLabels: ['AUTO', 'LOW', 'HIGH'] },
      { label: 'PRESS MODE', kind: 'cycle', var: V.pressSelMode, values: [0, 1], valueLabels: ['NORMAL', 'ALT SEL'] },
      // Manual landing elevation, or back to the FMS destination elevation (-9999, OG 11-4 "Normal").
      { label: 'LDG ELEV', kind: 'number', var: V.pressLdgElevFt, min: -1000, max: 14000, step: 10, unit: 'FT' },
      { label: 'LDG ELEV SRC', kind: 'cycle', var: V.pressLdgElevFt, values: [-9999], valueLabels: ['FMS'] },
      { label: 'CABIN ALT SEL', kind: 'number', var: V.pressSelCabinFt, min: 0, max: 8000, step: 100, unit: 'FT' },
      // SCOPE: passenger-oxygen manual deploy. Its real location is not in the reference set (the overhead strip carries
      // no PASS OXY switch, c_oh photograph), so the manual deploy lives here; masks also deploy automatically.
      { label: 'PAX OXY', kind: 'cycle', var: V.oxyPax, values: [0, 1], valueLabels: ['AUTO', 'DEPLOY'] },
    ],
  },
  {
    id: 'anti_ice',
    title: 'ANTI-ICE',
    elements: [
      { type: 'indicator', x: 100, y: 110, label: 'L ENG A/I', on: `${V.aiEngL} && pneu.eai_l_ok > 0.8`, color: 'green' },
      { type: 'indicator', x: 400, y: 110, label: 'R ENG A/I', on: `${V.aiEngR} && pneu.eai_r_ok > 0.8`, color: 'green' },
      { type: 'indicator', x: 100, y: 190, label: 'L WING', on: `${V.aiWing} && pneu.wai_l_ok > 0.8`, color: 'green' },
      { type: 'indicator', x: 400, y: 190, label: 'R WING', on: `${V.aiWing} && pneu.wai_r_ok > 0.8`, color: 'green' },
      { type: 'valve', x: 250, y: 190, open: V.wingXflowOpen, orientation: 'h', label: 'WING XFLOW' },
      { type: 'indicator', x: 250, y: 270, label: 'STAB DE-ICE', on: `${V.aiStab} && elec.stab_emeds_powered`, color: 'green' },
      { type: 'indicator', x: 100, y: 350, label: 'L WSHLD', on: `${V.wshldHeatOn} && elec.wshld_l_powered`, color: 'green' },
      { type: 'indicator', x: 400, y: 350, label: 'R WSHLD', on: `${V.wshldHeatOn} && elec.wshld_r_powered`, color: 'green' },
      { type: 'indicator', x: 250, y: 430, label: 'PITOT/STATIC', on: V.pitotHeatOn, color: 'green' },
      { type: 'indicator', x: 250, y: 510, label: 'ICE DETECTED', on: 'ice.detected', color: 'amber' },
      { type: 'readout', x: 120, y: 600, label: 'L MAN PSI', value: 'pneu.l_man_psi', decimals: 0 },
      { type: 'readout', x: 380, y: 600, label: 'R MAN PSI', value: 'pneu.r_man_psi', decimals: 0 },
      { type: 'readout', x: 250, y: 660, label: 'TAT °C', value: 'adc1.tat_c', decimals: 0 },
    ],
  },
  {
    id: 'lights',
    title: 'EXTERIOR LIGHTS',
    label: 'Lights',
    elements: [
      { type: 'aircraft', x: 250, y: 330, scale: 1 },
      { type: 'indicator', x: 250, y: 120, label: 'NAV', on: 'light.nav', color: 'green' },
      { type: 'indicator', x: 250, y: 180, label: 'BEACON', on: `${V.ltBeaconMode} == 2 || (${V.ltBeaconMode} == 1 && (${V.runL} || ${V.runR} || fadec.eng1.starter_cmd || fadec.eng2.starter_cmd))`, color: 'red' },
      { type: 'indicator', x: 250, y: 240, label: 'ANTI COLL', on: V.ltAntiColl, color: 'white' },
      { type: 'indicator', x: 120, y: 520, label: 'L LDG', on: V.ltLdgL, color: 'white' },
      { type: 'indicator', x: 380, y: 520, label: 'R LDG', on: V.ltLdgR, color: 'white' },
      { type: 'indicator', x: 250, y: 580, label: 'TAXI', on: V.ltTaxi, color: 'white' },
      { type: 'indicator', x: 250, y: 640, label: 'AUTO PULSE', on: V.ltAutoPulse, color: 'cyan' },
    ],
    controls: [
      { label: 'NAV', kind: 'toggle', var: V.ltNav }, // OG 16-3: on automatically at G5000 power-up
      { label: 'BEACON', kind: 'cycle', var: V.ltBeaconMode, values: [0, 1, 2], valueLabels: ['OFF', 'NORM', 'ON'] },
      { label: 'AUTO PULSE', kind: 'toggle', var: V.ltAutoPulse }, // pulse lights on a TCAS TA/RA
      // SCOPE: cockpit dome / entry light (hot battery bus). The overhead LIGHTS strip has no DOME control (c_oh photograph);
      // on the aircraft the entry lighting is part of the cabin lighting system, reduced here to this GTC toggle.
      { label: 'CKPT DOME', kind: 'toggle', var: V.ltDome },
    ],
  },
  {
    // GTC Aircraft Systems > Tests (OG Fig 9-7-1 lists the "pneumatic relevant tests" on a GTC page; the Longitude
    // overhead has no test buttons, c_oh photograph). Each test runs while its toggle is ON.
    id: 'tests',
    title: 'SYSTEM TESTS',
    label: 'Tests',
    elements: [
      { type: 'indicator', x: 250, y: 120, label: 'FIRE WARN TEST', on: 'fire.test', color: 'white' },
      { type: 'indicator', x: 120, y: 200, label: 'L ENG FIRE', on: 'fire.eng1_warn', color: 'red' },
      { type: 'indicator', x: 380, y: 200, label: 'R ENG FIRE', on: 'fire.eng2_warn', color: 'red' },
      { type: 'indicator', x: 250, y: 260, label: 'APU FIRE', on: 'fire.apu_warn', color: 'red' },
      { type: 'indicator', x: 250, y: 360, label: 'ANNUNCIATOR TEST', on: V.lampTest, color: 'white' },
      { type: 'indicator', x: 250, y: 460, label: 'CVR TEST OK', on: V.cvrTestOk, color: 'green' },
    ],
    controls: [
      { label: 'FIRE WARN', kind: 'toggle', var: V.fireTest },
      { label: 'ANNUN', kind: 'toggle', var: V.lampTest },
    ],
  },
];
