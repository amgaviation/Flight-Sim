/**
 * Installation preset for the Cessna 172S Skyhawk with the G1000 NXi and the
 * GFC 700 AFCS (Cessna NAV III). Spread it into the suite config and add the
 * aircraft's power bindings / var names:
 *
 *   new G1000Suite(ctx, { ...C172S_NXI, checklists: C172S_G1000_CHECKLISTS })
 *
 * Sources:
 *  - Cessna 172S NAV III POH/AFM 172SPHAUS-03 (G1000): Figure 2-2 airspeed
 *    indicator markings (red 20-40 "G1000 airspeed indicator only", white
 *    40-85, green 48-129, yellow 129-163, red line 163 KIAS); Figure 2-3
 *    powerplant instrument markings; §7 "Engine Instruments" (EIS behaviour:
 *    RPM 0-3000 with a green-arc top of 2500 / 2600 / 2700 RPM by altitude,
 *    red at 2780 RPM; FFLOW 0-20 GPH, green 0-12; OIL PRES 0-120 PSI red 0-20,
 *    green 50-90, red 115-120; OIL TEMP 75-250 F green 100-245 red 245-250;
 *    CHT 100-500 F red line 500; EGT 1250-1650 F; fuel quantity red line at
 *    0 (1.5 gal unusable), float travel limit ~24 gal, LOW FUEL L/R below 5
 *    gal for 60 s; vacuum 4.5-5.5 inHg green, LOW VACUUM below 3.5 inHg);
 *    §7 "Electrical System Monitoring" (LOW VOLTS below 24.5 V; M BUS E volts;
 *    M BATT S amps); §4 speeds (rotate 55 KIAS, Vx 62, Vy 74, best glide 68).
 *  - Garmin G1000 NXi PG 190-02177-02 Rev. A: Table 2-1 V-speed bugs (GLIDE,
 *    VR, VX, VY); Appendix A CAS annunciations for the Cessna NAV III
 *    (warnings CO LVL HIGH, HIGH VOLTS, LOW VOLTS, OIL PRESSURE, USP ACTIVE;
 *    cautions LOW FUEL L/R, LOW VACUUM, STBY BATT; advisories ESP OFF / FAIL /
 *    DEGRADE); Figure 3-3 (172S EIS with VAC); Table 3-1 (35 / 53 GAL keys).
 */
import type { SpeedRange } from '../common/draw/SpeedTape';
import type { CasDef, G1000Config, G1kEisConfig, VSpeedDef } from './config';
import { G1K } from './vars';

const GREEN = '#00c000';
const RED = '#ff0000';
const YELLOW = '#ffd200';
const WHITE = '#ffffff';

/** Avgas density used to convert tank kg to gallons (6.0 lb/US gal x 0.45359 kg/lb). */
export const AVGAS_KG_PER_GAL = 2.7216;

/** 172S airspeed tape ranges (POH Figure 2-2; the red low-speed band exists on the G1000 tape only). */
export const C172S_SPEED_RANGES: SpeedRange[] = [
  { fromKt: 20, toKt: 40, color: RED, widthFrac: 1 },
  { fromKt: 48, toKt: 129, color: GREEN, widthFrac: 1 },
  { fromKt: 40, toKt: 85, color: WHITE, widthFrac: 0.5 },
  { fromKt: 129, toKt: 163, color: YELLOW, widthFrac: 1 },
];

/** Default V-speed reference bugs (PG Table 2-1 labels; POH §4 values). */
export const C172S_VSPEEDS: VSpeedDef[] = [
  { id: 'GLIDE', label: 'G', name: 'Glide', defaultKt: 68 },
  { id: 'VR', label: 'R', name: 'Vr', defaultKt: 55 },
  { id: 'VX', label: 'X', name: 'Vx', defaultKt: 62 },
  { id: 'VY', label: 'Y', name: 'Vy', defaultKt: 74 },
];

/**
 * Per-cylinder EGT / CHT of the IO-360-L2A. SCOPE: the physics engine models
 * a single EGT / CHT; the four cylinders are shown with a small fixed spread
 * (EST: typical ±20 F EGT / ±10 F CHT cylinder-to-cylinder scatter of a
 * carbureted/injected Lycoming four) so the Lean page and lean assist behave.
 * Aircraft with per-cylinder vars replace these bindings.
 */
const EGT_SPREAD = [-12, 18, -20, 6];
const CHT_SPREAD = [-6, 9, 4, -10];

export const C172S_EIS: G1kEisConfig = {
  rpm: {
    value: 'eng1.rpm',
    scale: {
      min: 0,
      max: 3000,
      bands: [{ from: 2100, to: 2700, color: GREEN }, { from: 2700, to: 3000, color: RED }],
      redlines: [2700],
      amberlines: [],
      ticks: [0, 500, 1000, 1500, 2000, 2500, 3000],
      labels: ['0', '', '', '', '', '', '3000'],
      limits: { warnHigh: 2780 },
      decimals: 0,
      readoutStep: 10, // POH 7-30: "displayed in increments of 10 RPM"
      unit: 'RPM',
    },
    greenTop: { altFt: [0, 4999, 5000, 9999, 10000], rpm: [2500, 2500, 2600, 2600, 2700] },
    redAt: 2780,
  },
  fuelFlow: {
    value: 'eng1.ff_gph',
    scale: { min: 0, max: 20, bands: [{ from: 0, to: 12, color: GREEN }], redlines: [], amberlines: [], ticks: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20], labels: ['0', '', '', '', '', '', '', '', '', '', '20'], limits: {}, decimals: 1, readoutStep: 0, unit: 'GPH' },
  },
  oilPress: {
    value: 'eng1.oil_press_psi',
    scale: { min: 0, max: 120, bands: [{ from: 0, to: 20, color: RED }, { from: 50, to: 90, color: GREEN }, { from: 115, to: 120, color: RED }], redlines: [], amberlines: [], ticks: [], labels: [], limits: { warnLow: 20, warnHigh: 115 }, decimals: 0, readoutStep: 1, unit: 'PSI' },
  },
  oilTemp: {
    value: 'eng1.oil_temp_f',
    scale: { min: 75, max: 250, bands: [{ from: 100, to: 245, color: GREEN }, { from: 245, to: 250, color: RED }], redlines: [], amberlines: [], ticks: [], labels: [], limits: { warnHigh: 245 }, decimals: 0, readoutStep: 1, unit: '°F' },
  },
  egt: { cylinders: EGT_SPREAD.map((d) => `eng1.egt_f + ${d} * clamp01((eng1.egt_f - 300) / 900)`), min: 1250, max: 1650 },
  cht: { cylinders: CHT_SPREAD.map((d) => `eng1.cht_f + ${d} * clamp01((eng1.cht_f - 100) / 200)`), min: 100, max: 500, redline: 500 },
  vacuum: {
    value: 'ac.vac.suction_inhg',
    // EST scale ends (POH gives only the 4.5-5.5 inHg green arc); centred on the arc as in PG Figure 3-3.
    scale: { min: 3, max: 7, bands: [{ from: 4.5, to: 5.5, color: GREEN }], redlines: [], amberlines: [], ticks: [3, 7], labels: [], limits: {}, decimals: 1, readoutStep: 0, unit: 'IN' },
  },
  fuelQty: {
    // Gauged (float transmitter) quantity from the fuel system; -1 gal = transmitter failed (red X).
    left: `fuel.left_ind_kg / ${AVGAS_KG_PER_GAL}`,
    right: `fuel.right_ind_kg / ${AVGAS_KG_PER_GAL}`,
    scale: {
      min: 0,
      max: 30,
      // POH Figure 2-3: red at 0 (1.5 gal unusable each tank), yellow 0-5, green 5-24 gal; above the float limit uncoloured.
      bands: [{ from: 0, to: 0.6, color: RED }, { from: 0.6, to: 5, color: YELLOW }, { from: 5, to: 24, color: GREEN }, { from: 24, to: 30, color: WHITE }],
      redlines: [0],
      amberlines: [],
      ticks: [0, 5, 10, 15, 20, 25, 30],
      labels: ['0', '', '10', '', '20', '', 'F'],
      limits: { cautionLow: 5 },
      decimals: 1,
      readoutStep: 0,
      unit: 'GAL',
    },
    indicatorMaxGal: 24,
    lowGal: 5,
    lowDelayS: 60,
  },
  // c172s-common G1000 readouts (M BUS at the WARN breaker, E BUS at NAV1 ENG on the ESS bus; UND trainer).
  elec: { mainBusV: 'ac.c172.m_bus_v', essBusV: 'ac.c172.e_bus_v', mainBattA: 'ac.c172.m_batt_a', stbyBattA: 'ac.c172.s_batt_a', lowVolts: 24.5 },
  // POH: 53 gal usable (Figure 7-5); PG Table 3-1 GAL REM keys 35 GAL / 53 GAL.
  totalizer: { defaultGal: 53, presetsGal: [35, 53], fuelFlowGph: 'eng1.ff_gph' },
};

/**
 * CAS annunciations of the 172S NXi (PG 190-02177-02 Appendix A). The GEA 71B
 * reads the discrete sensors; the conditions are the annunciation outputs of
 * the c172s-common systems (`ac.c172.ann.*`, which include the POH timing:
 * LOW FUEL L/R below 5 gal for more than 60 s, POH 7-38; LOW VOLTS below
 * 24.5 V from the ACU sense, POH 7-51; HIGH VOLTS above 32 V; LOW VACUUM
 * below 3.5 inHg, POH 7-60; OIL PRESSURE from the 20 psi switch, POH 7-32;
 * STBY BATT while the standby battery discharges). An aircraft without those
 * systems overrides the `when` bindings.
 */
export const C172S_CAS: CasDef[] = [
  { id: 'co_lvl', text: 'CO LVL HIGH', level: 'warning', when: 'ac.c172.ann.co_lvl_high ?? 0' },
  { id: 'high_volts', text: 'HIGH VOLTS', level: 'warning', when: 'ac.c172.ann.high_volts ?? 0' },
  { id: 'low_volts', text: 'LOW VOLTS', level: 'warning', when: 'ac.c172.ann.low_volts ?? 0' },
  { id: 'oil_press', text: 'OIL PRESSURE', level: 'warning', when: 'ac.c172.ann.oil_press ?? 0' },
  // USP ACTIVE is a CAS warning on the NXi with ESP (Appendix A).
  { id: 'usp', text: 'USP ACTIVE', level: 'warning', when: `${G1K.uspActive} ?? 0` },
  { id: 'low_fuel_l', text: 'LOW FUEL L', level: 'caution', when: 'ac.c172.ann.low_fuel_l ?? 0' },
  { id: 'low_fuel_r', text: 'LOW FUEL R', level: 'caution', when: 'ac.c172.ann.low_fuel_r ?? 0' },
  { id: 'low_vac', text: 'LOW VACUUM', level: 'caution', when: 'ac.c172.ann.low_vacuum ?? 0' },
  { id: 'stby_batt', text: 'STBY BATT', level: 'caution', when: 'ac.c172.ann.stby_batt ?? 0' },
  { id: 'esp_off', text: 'ESP OFF', level: 'advisory', when: `${G1K.espEnabled} < 0.5` },
  // AP AIL DISC: roll servo failed (Appendix A advisory, EST mapping to the shared Afcs roll servo failure).
  { id: 'ap_ail_disc', text: 'AP AIL DISC', level: 'advisory', when: 'fail.afcs.servo_roll ?? 0' },
];

/**
 * Unit power for the c172s-common G1000 electrical network (loads
 * `elec.<id>_powered`, POH NAV III Figure 7-7 / UND C172S electrical
 * trainer): PFD, ADC/AHRS and NAV1/ENG dual-fed from the ESS bus and AVN BUS 1;
 * COMM 1 on ESS; MFD, NAV 2, COMM 2, XPNDR, AUDIO and AUTOPILOT on AVN BUS 2.
 */
export const C172S_NXI_POWER: NonNullable<G1000Config['power']> = {
  pfd: 'elec.pfd_powered',
  mfd: 'elec.mfd_powered',
  gia1: 'elec.nav1_eng_powered',
  gea: 'elec.nav1_eng_powered',
  com1: 'elec.comm1_powered',
  gia2: 'elec.nav2_powered',
  com2: 'elec.comm2_powered',
  adahrs: 'elec.adc_ahrs_powered',
  gmu: 'elec.adc_ahrs_powered',
  xpdr: 'elec.xpndr_powered',
  gma: 'elec.audio_powered',
  servos: 'elec.autopilot_powered',
};

/** Complete 172S G1000 NXi preset for the c172s-common systems (checklists are added by the aircraft). */
export const C172S_NXI: G1000Config = {
  aircraftId: 'c172-g1000',
  aircraftName: 'Cessna 172S',
  bezel: { pfd: 'GDU1054B', mfd: 'GDU1054B' },
  afcs: true,
  // EST: Garmin ESP is delivered with the GFC 700 on NXi-equipped Skyhawks (PG §8.11 describes the C-172
  // limits); aircraft without it pass `esp: false`.
  esp: true,
  eis: C172S_EIS,
  vspeeds: C172S_VSPEEDS,
  speedTape: { ranges: C172S_SPEED_RANGES, vneKt: 163 },
  cas: C172S_CAS,
  radios: { nav: 2, adf: false, dme: false },
  // EST: GTX 345R (ADS-B In/Out) transponder as fitted to current Skyhawks (PG §1.1 lists 335R / 345R / 33ES).
  traffic: 'ADSB',
  terrain: 'SVT',
  power: C172S_NXI_POWER,
  // EST: USP activation in the altitude-critical modes "at stall warning" (PG §7.5); the 172S warning is the
  // pneumatic horn (c172s-common `ac.c172.stall_horn`).
  stallWarning: 'ac.c172.stall_horn ?? 0',
};
