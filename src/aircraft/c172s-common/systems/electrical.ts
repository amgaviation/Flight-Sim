/**
 * Cessna 172S electrical system for both cockpit variants (docs/aircraft/c172s.md §5).
 *
 * Common (POH Sec 7 "Electrical system"): 28 V DC, belt-driven 60 A alternator and a 24 V
 * main battery on the left forward firewall; power distribution module (J-box) with the
 * battery (master) contactor, alternator control unit (ACU), starter contactor and the
 * external power receptacle; split primary bus (ELEC BUS 1 / ELEC BUS 2) fed through PDM
 * feeder breakers; a diode-fed essential/crossfeed bus carrying ALT FLD and WARN; two
 * avionics buses behind feeder breakers and the split AVIONICS switch.
 *
 * Steam (POH 172SPHUS Rev 5 Fig 7-7A, serials 172S8704 and on): breakers per the schematic.
 * G1000 (POH 172SPHAUS-03 Fig 7-7 and UND C172S Electrical System trainer, G1000 NXi):
 * adds the ESSENTIAL bus (diode-fed from both primary buses) with the standby battery
 * (STBY BATT ARM/OFF/TEST) and dual-fed PFD, ADC/AHRS and NAV1/ENG units (identical breakers
 * on AVN BUS 1 and the ESS bus, diode-ORed at the unit).
 *
 * Bus ids (outputs elec.<id>_v / _powered / _amps):
 *   batt_bus (main battery terminal / hot), pdm (after the master contactor), bus1, bus2,
 *   xfeed (steam "ESSENTIAL/CROSSFEED" bus; G1000 "X-FEED" bus), avn1, avn2;
 *   G1000 only: ess, stby_bus (standby battery terminal), lru_pfd, lru_adc_ahrs, lru_nav1_eng.
 * Load ids (elec.<id>_powered): see STEAM_LOADS / G1000_LOADS below; avionics variants read
 * e.g. 'elec.nav_com1_powered' (steam) or 'elec.pfd_powered' (G1000) for their power.
 *
 * Load currents are EST (typical 28 V draws of the listed equipment) unless noted.
 */
import type { SimContext } from '../../../core/SimContext';
import { ElectricalNetwork, BATTERY_172S_MAIN, BATTERY_172S_STANDBY, type ElectricalConfig, type LoadDef } from '../../../systems/electrical';
import { C172, C172_FAIL, STBY_BATT } from '../vars';
import { ELEC_DATA } from '../data';

export type C172Variant = 'steam' | 'g1000';

/** Circuit-breaker names (cb.<name>) per variant, with their panel label and rating (A). */
export interface C172Breaker {
  name: string;
  label: string;
  ratingA: number;
  bus: string;
  /** Switch/breaker (steam: the toggle is the breaker) — `var` is the switch var. */
  switchVar?: string;
}

/**
 * Steam 172S breakers (POH Fig 7-7A, serials 172S8704 and on). Ratings: FLAP 10 A and
 * PITOT HEAT 5 A per POH Sec 7 text; the others EST from the same ratings the G1000 panel
 * uses for the same circuits (UND).
 */
export const STEAM_BREAKERS: C172Breaker[] = [
  // ELECTRICAL BUS 1
  { name: 'cabin_lts_pwr', label: 'CABIN LTS/PWR', ratingA: 5, bus: 'bus1' },
  { name: 'inst', label: 'INST', ratingA: 5, bus: 'bus1' },
  { name: 'fuel_pump', label: 'FUEL PUMP', ratingA: 5, bus: 'bus1', switchVar: C172.fuelPump },
  { name: 'land', label: 'LAND', ratingA: 10, bus: 'bus1', switchVar: C172.land },
  { name: 'bcn', label: 'BCN', ratingA: 5, bus: 'bus1', switchVar: C172.beacon },
  { name: 'flap', label: 'FLAP', ratingA: 10, bus: 'bus1' },
  { name: 'avn_bus1', label: 'AVN BUS 1', ratingA: 15, bus: 'bus1' },
  // ESSENTIAL / CROSSFEED BUS
  { name: 'warn', label: 'WARN', ratingA: 5, bus: 'xfeed' },
  { name: 'alt_fld', label: 'ALT FLD', ratingA: 5, bus: 'xfeed' },
  // ELECTRICAL BUS 2
  { name: 'avn_bus2', label: 'AVN BUS 2', ratingA: 15, bus: 'bus2' },
  { name: 'turn_coord', label: 'TURN COORD', ratingA: 5, bus: 'bus2' },
  { name: 'nav', label: 'NAV', ratingA: 5, bus: 'bus2', switchVar: C172.nav },
  { name: 'inst_lts', label: 'INST LTS', ratingA: 5, bus: 'bus2' },
  { name: 'strobe', label: 'STROBE', ratingA: 5, bus: 'bus2', switchVar: C172.strobe },
  { name: 'taxi', label: 'TAXI', ratingA: 10, bus: 'bus2', switchVar: C172.taxi },
  { name: 'pitot_heat', label: 'PITOT HEAT', ratingA: 5, bus: 'bus2', switchVar: C172.pitotHeat },
  // AVIONICS BUS 1
  { name: 'avn_fan', label: 'AVN FAN', ratingA: 3, bus: 'avn1' },
  { name: 'gps', label: 'GPS', ratingA: 5, bus: 'avn1' },
  { name: 'gyro', label: 'GYRO', ratingA: 5, bus: 'avn1' },
  { name: 'nav_com1', label: 'NAV/COM 1', ratingA: 10, bus: 'avn1' },
  // AVIONICS BUS 2
  { name: 'nav_com2', label: 'NAV/COM 2', ratingA: 10, bus: 'avn2' },
  { name: 'xpndr', label: 'XPNDR', ratingA: 5, bus: 'avn2' },
  { name: 'autopilot', label: 'AUTO PILOT', ratingA: 5, bus: 'avn2' },
  { name: 'adf', label: 'ADF', ratingA: 3, bus: 'avn2' },
];

/** G1000 NXi breakers (UND C172S Electrical System trainer; POH NAV III Fig 7-7 sheet 2). */
export const G1000_BREAKERS: C172Breaker[] = [
  // ELECTRICAL BUS 1
  { name: 'fuel_pump', label: 'FUEL PUMP', ratingA: 5, bus: 'bus1' },
  { name: 'bcn_lt', label: 'BCN LT', ratingA: 5, bus: 'bus1' },
  { name: 'land_lt', label: 'LAND LT', ratingA: 10, bus: 'bus1' },
  { name: 'cabin_lts_pwr', label: 'CABIN LTS/PWR', ratingA: 5, bus: 'bus1' },
  { name: 'flaps', label: 'FLAPS', ratingA: 10, bus: 'bus1' },
  { name: 'avn1', label: 'AVN 1', ratingA: 15, bus: 'bus1' },
  // ELECTRICAL BUS 2
  { name: 'avn2', label: 'AVN 2', ratingA: 15, bus: 'bus2' },
  { name: 'pitot_heat', label: 'PITOT HEAT', ratingA: 5, bus: 'bus2' },
  { name: 'nav_lts', label: 'NAV LTS', ratingA: 5, bus: 'bus2' },
  { name: 'taxi_lt', label: 'TAXI LT', ratingA: 10, bus: 'bus2' },
  { name: 'strobe_lts', label: 'STROBE LTS', ratingA: 5, bus: 'bus2' },
  { name: 'panel_lts', label: 'PANEL LTS', ratingA: 5, bus: 'bus2' },
  // CROSSFEED BUS (ratings EST: not listed by UND)
  { name: 'alt_field', label: 'ALT FIELD', ratingA: 5, bus: 'xfeed' },
  { name: 'warn', label: 'WARN', ratingA: 2, bus: 'xfeed' },
  // ESSENTIAL BUS
  { name: 'pfd_ess', label: 'PFD', ratingA: 5, bus: 'ess' },
  { name: 'adc_ahrs_ess', label: 'ADC AHRS', ratingA: 10, bus: 'ess' },
  { name: 'nav1_eng_ess', label: 'NAV1 ENG', ratingA: 15, bus: 'ess' },
  { name: 'comm1', label: 'COMM 1', ratingA: 5, bus: 'ess' },
  { name: 'stdby_ind_lts', label: 'STDBY IND LTS', ratingA: 5, bus: 'ess' },
  { name: 'stdby_batt', label: 'STDBY BATT', ratingA: 20, bus: 'ess' },
  // AVIONICS BUS 1
  { name: 'pfd_avn1', label: 'PFD', ratingA: 5, bus: 'avn1' },
  { name: 'adc_ahrs_avn1', label: 'ADC AHRS', ratingA: 10, bus: 'avn1' },
  { name: 'nav1_eng_avn1', label: 'NAV1 ENG', ratingA: 15, bus: 'avn1' },
  // AVIONICS BUS 2
  { name: 'mfd', label: 'MFD', ratingA: 5, bus: 'avn2' },
  { name: 'xpndr', label: 'XPNDR', ratingA: 5, bus: 'avn2' },
  { name: 'nav2', label: 'NAV 2', ratingA: 5, bus: 'avn2' },
  { name: 'comm2', label: 'COMM 2', ratingA: 5, bus: 'avn2' },
  { name: 'audio', label: 'AUDIO', ratingA: 5, bus: 'avn2' },
  { name: 'autopilot', label: 'AUTOPILOT', ratingA: 5, bus: 'avn2' },
];

function cb(list: C172Breaker[], name: string): { name: string; ratingA: number } {
  const b = list.find((x) => x.name === name);
  if (!b) throw new Error(`c172 breaker ${name} not defined`);
  return { name: b.name, ratingA: b.ratingA };
}

/** Shared lighting loads (EST currents; lamp loads are resistive so they dim with bus voltage). */
function lightLoads(list: C172Breaker[], v: C172Variant): LoadDef[] {
  const g = v === 'g1000';
  return [
    // Exterior (POH Sec 7 "Exterior lighting"). Levels come from the LightingSystem (light.<name>),
    // which already includes the switch and flash pattern, so the load follows the lamp.
    { id: 'beacon', bus: 'bus1', amps: '3.0 * light.beacon', model: 'resistive', enabled: C172.beacon, cb: cb(list, g ? 'bcn_lt' : 'bcn') },
    { id: 'land_lt', bus: 'bus1', amps: 3.6, model: 'resistive', enabled: C172.land, cb: cb(list, g ? 'land_lt' : 'land') },
    { id: 'taxi_lt', bus: 'bus2', amps: 3.6, model: 'resistive', enabled: C172.taxi, cb: cb(list, g ? 'taxi_lt' : 'taxi') },
    { id: 'nav_lts', bus: 'bus2', amps: 2.4, model: 'resistive', enabled: C172.nav, cb: cb(list, g ? 'nav_lts' : 'nav') },
    // Control-wheel map light: powered through the NAV light switch (POH Sec 7 "Interior lighting").
    { id: 'map_lt', bus: 'bus2', amps: `0.3 * ${C172.mapLight}`, model: 'resistive', enabled: C172.nav, cb: cb(list, g ? 'nav_lts' : 'nav') },
    { id: 'strobe_lts', bus: 'bus2', amps: 2.2, enabled: C172.strobe, cb: cb(list, g ? 'strobe_lts' : 'strobe') },
    // Interior
    { id: 'panel_lts', bus: 'bus2', amps: `1.5 * ${C172.dimPanel} + 0.6 * ${C172.dimRadio}`, model: 'resistive', cb: cb(list, g ? 'panel_lts' : 'inst_lts') },
    { id: 'pedestal_lt', bus: g ? 'bus2' : 'bus1', amps: `0.3 * ${C172.dimPedestal}`, model: 'resistive', cb: cb(list, g ? 'panel_lts' : 'cabin_lts_pwr') },
    ...(g
      ? []
      : [{ id: 'glareshield_lt', bus: 'bus1', amps: `1.0 * ${C172.dimGlareshield}`, model: 'resistive' as const, cb: cb(list, 'cabin_lts_pwr') }]),
    { id: 'flood_lts', bus: 'bus1', amps: `0.5 * (${C172.floodLeft} + ${C172.floodRight})`, model: 'resistive', cb: cb(list, 'cabin_lts_pwr') },
    { id: 'dome_courtesy', bus: 'bus1', amps: 1.5, model: 'resistive', enabled: C172.domeCourtesy, cb: cb(list, 'cabin_lts_pwr') },
    { id: 'cabin_12v', bus: 'bus1', amps: 1.0, enabled: C172.cabinPwr12v, cb: cb(list, 'cabin_lts_pwr') },
  ];
}

export const STEAM_LOADS = (list = STEAM_BREAKERS): LoadDef[] => [
  ...lightLoads(list, 'steam'),
  // ELECTRICAL BUS 1
  { id: 'engine_gauges', bus: 'bus1', amps: 1.0, cb: cb(list, 'inst') }, // fuel qty, oil T/P, EGT/FF (transducer indicators)
  { id: 'fuel_pump', bus: 'bus1', amps: 3.0, enabled: C172.fuelPump, cb: cb(list, 'fuel_pump') },
  { id: 'flap_motor', bus: 'bus1', amps: '8 * flaps.transit', cb: cb(list, 'flap') },
  // ESSENTIAL / CROSSFEED BUS
  { id: 'warn', bus: 'xfeed', amps: 0.3, cb: cb(list, 'warn') }, // annunciator panel, hour meter
  { id: 'alt_field', bus: 'xfeed', amps: `2.5 * ${C172.masterAlt}`, cb: cb(list, 'alt_fld') },
  // ELECTRICAL BUS 2
  { id: 'turn_coord', bus: 'bus2', amps: 0.4, cb: cb(list, 'turn_coord') },
  { id: 'pitot_heat', bus: 'bus2', amps: 3.5, model: 'resistive', enabled: C172.pitotHeat, cb: cb(list, 'pitot_heat') },
  // AVIONICS BUS 1
  { id: 'avn_fan', bus: 'avn1', amps: 0.5, cb: cb(list, 'avn_fan') },
  { id: 'gps', bus: 'avn1', amps: 1.8, cb: cb(list, 'gps') }, // GPS/MFD (KLN 94 / GNS 430 class)
  { id: 'gyro', bus: 'avn1', amps: 1.0, cb: cb(list, 'gyro') }, // HSI slaved gyro (option)
  { id: 'nav_com1', bus: 'avn1', amps: 1.1, cb: cb(list, 'nav_com1') }, // KX 155A #1 + KMA 26 audio panel
  // AVIONICS BUS 2
  { id: 'nav_com2', bus: 'avn2', amps: 0.6, cb: cb(list, 'nav_com2') },
  { id: 'xpndr', bus: 'avn2', amps: 0.8, cb: cb(list, 'xpndr') }, // KT 76C
  { id: 'autopilot', bus: 'avn2', amps: 1.2, cb: cb(list, 'autopilot') }, // KAP 140 computer + servos (EST)
  { id: 'adf', bus: 'avn2', amps: 0.5, cb: cb(list, 'adf') }, // KR 87
  // Davtron clock keep-alive from the battery through the PDM glass fuse (POH Sec 7 "Circuit breakers and fuses").
  { id: 'clock_mem', bus: 'batt_bus', amps: 0.01 },
];

export const G1000_LOADS = (list = G1000_BREAKERS): LoadDef[] => [
  ...lightLoads(list, 'g1000'),
  // ELECTRICAL BUS 1
  { id: 'fuel_pump', bus: 'bus1', amps: 3.0, enabled: C172.fuelPump, cb: cb(list, 'fuel_pump') },
  { id: 'flap_motor', bus: 'bus1', amps: '8 * flaps.transit', cb: cb(list, 'flaps') },
  // CROSSFEED BUS
  { id: 'alt_field', bus: 'xfeed', amps: `2.5 * ${C172.masterAlt}`, cb: cb(list, 'alt_field') },
  // WARN feeds: stall warning, autopilot warning, ELT warning, main bus voltmeter, hour meter,
  // starter relay, standby battery controller and main bus sense (UND / POH NAV III Fig 7-7).
  { id: 'warn', bus: 'xfeed', amps: 0.4, cb: cb(list, 'warn') },
  // ELECTRICAL BUS 2
  { id: 'pitot_heat', bus: 'bus2', amps: 3.5, model: 'resistive', enabled: C172.pitotHeat, cb: cb(list, 'pitot_heat') },
  // ESSENTIAL BUS
  { id: 'comm1', bus: 'ess', amps: 0.6, cb: cb(list, 'comm1') }, // GIA 63W #1 COM (receive)
  { id: 'stby_ind_lts', bus: 'ess', amps: `0.3 * ${C172.dimStbyInd}`, model: 'resistive', cb: cb(list, 'stdby_ind_lts') },
  // Dual-fed units (load on the diode-ORed unit bus)
  { id: 'pfd', bus: 'lru_pfd', amps: 2.2 }, // GDU 1040/1050 PFD + deck-skin cooling fans
  { id: 'adc_ahrs', bus: 'lru_adc_ahrs', amps: 1.2 }, // GDC 72/74 + GRS 79
  { id: 'nav1_eng', bus: 'lru_nav1_eng', amps: 2.6 }, // GIA 63W #1 NAV/GPS + GEA 71 engine/airframe unit
  // AVIONICS BUS 2
  { id: 'mfd', bus: 'avn2', amps: 2.2, cb: cb(list, 'mfd') }, // GDU MFD + MFD fan
  { id: 'xpndr', bus: 'avn2', amps: 1.2, cb: cb(list, 'xpndr') }, // GTX 33/345
  { id: 'nav2', bus: 'avn2', amps: 2.0, cb: cb(list, 'nav2') }, // GIA 63W #2 + aft avionics fan
  { id: 'comm2', bus: 'avn2', amps: 0.6, cb: cb(list, 'comm2') },
  { id: 'audio', bus: 'avn2', amps: 0.9, cb: cb(list, 'audio') }, // GMA 1347/1360
  { id: 'autopilot', bus: 'avn2', amps: 1.5, cb: cb(list, 'autopilot') }, // GFC 700 servos (GSA 81 x3) + GSM
  // Standby battery TEST load (POH NAV III: test places the battery under load; UND: test load heats).
  { id: 'stby_test', bus: 'stby_bus', amps: 3.0, enabled: `${C172.stbyBatt} == ${STBY_BATT.test}` },
];

/** EST open-circuit volts per cell vs state of charge of the vented main battery (full 2.05 V/cell). */
export const MAIN_BATTERY_OCV = { x: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1], y: [1.84, 1.9, 1.93, 1.96, 1.99, 2.02, 2.05] };

export interface C172ElectricalOptions {
  /** Extra loads (e.g. optional avionics) appended to the variant list. */
  extraLoads?: LoadDef[];
  /** Replace the variant load list entirely. */
  loads?: LoadDef[];
  /** Initial main battery state of charge (default 1). */
  initialSoc?: number;
}

/** Builds the `ElectricalConfig` for a variant (exported for tests and documentation). */
export function c172ElectricalConfig(variant: C172Variant, opts: C172ElectricalOptions = {}): ElectricalConfig {
  const g = variant === 'g1000';
  const list = g ? G1000_BREAKERS : STEAM_BREAKERS;
  const loads = [...(opts.loads ?? (g ? G1000_LOADS(list) : STEAM_LOADS(list))), ...(opts.extraLoads ?? [])];
  const buses = [
    { id: 'batt_bus' },
    { id: 'pdm' },
    { id: 'bus1' },
    { id: 'bus2' },
    { id: 'xfeed' },
    { id: 'avn1' },
    { id: 'avn2' },
    ...(g ? [{ id: 'ess' }, { id: 'stby_bus' }, { id: 'lru_pfd' }, { id: 'lru_adc_ahrs' }, { id: 'lru_nav1_eng' }] : []),
  ];
  const cfg: ElectricalConfig = {
    buses,
    batteries: [
      {
        id: 'batt',
        bus: 'batt_bus',
        ...BATTERY_172S_MAIN,
        capacityAh: ELEC_DATA.mainBatteryAh, // POH equipment list 24-02-R: 24 V, 12.75 Ah (manifold type)
        // EST: vented ("manifold type") lead-acid, 12 cells: ~24.6 V open circuit when charged and
        // ~40 mOhm with its cabling, so the bus reads ~24.2-24.4 V with the MASTER on before the
        // start (the POH NAV III preflight expects LOW VOLTS shown with the engine stopped) and
        // dips to ~16-18 V while cranking.
        ocvPerCell: MAIN_BATTERY_OCV,
        internalResistanceOhm: 0.04,
        fullChargeV: 28.3, // EST: a charged vented battery still takes ~1-2 A at the 28.5 V bus (POH: < 5 A after 30 min of cruise)
        initialSoc: opts.initialSoc ?? 1,
        ambientC: 'fdm.sat_c',
      },
      // Standby battery (POH NAV III equipment list 24-07-S, AVT 200413, 14.0 lb): capacity EST (preset).
      ...(g ? [{ id: 'stby_batt', bus: 'stby_bus', ...BATTERY_172S_STANDBY, ambientC: 'fdm.sat_c' }] : []),
    ],
    dcGenerators: [
      {
        id: 'alt',
        bus: 'pdm',
        kind: 'alternator',
        regulatedV: ELEC_DATA.regulatedV,
        ratedA: ELEC_DATA.alternatorA, // POH Sec 7: 60 A
        // Alternator relay needs ALT master AND BAT master (POH NAV III: ALT cannot be ON without BAT)
        // and ALT FLD / ALT FIELD power (UND: "Power from the X-FEED BUS via the ALT FIELD circuit
        // breaker is required for the alternator to generate power").
        switch: `${C172.masterAlt} && ${C172.masterBat} && elec.alt_field_powered`,
        // Drive = engine rpm (belt). A runaway regulator (failure elec.alt.regulator) applies full
        // field: the alternator then delivers beyond its 60 A rating (EST ~75 A max), which is what
        // drives the bus past the ACU's 31.75 V trip even with both batteries absorbing charge. It is
        // expressed as a x3 effective drive into the table's above-rating range (x > 2800), which
        // normal operation (<= 2700 rpm redline) never reaches.
        drive: `eng1.rpm * (1 - fail.${C172_FAIL.altBelt}) * (1 + 2 * (fail.elec.alt.regulator ?? 0))`,
        minDrive: 450,
        // EST: Lycoming alternator pulley ~3.2:1; output limited at idle (POH Sec 3: LOW VOLTS may
        // come on below 1000 rpm with electrical load; full 60 A above ~2000 rpm).
        maxAmpsVsDrive: { x: [450, 600, 800, 1000, 1300, 1600, 2000, 2800, 4800], y: [0, 14, 26, 36, 46, 54, 60, 60, 75] },
        field: { bus: 'xfeed', minV: 8 },
        ovTripV: ELEC_DATA.acuOvTripV, // POH NAV III Sec 3: ACU disconnects at ~31.75 V
        ovTripDelayS: 0.3,
      },
    ],
    externals: [
      // POH Sec 7 "External power receptacle": with the BAT master ON the PDM closes the external
      // power relay; the external supply then also charges the battery (EST 28 V cart).
      { id: 'gpu', bus: 'batt_bus', type: 'dc', available: C172.extPower, switch: C172.masterBat, voltage: 28.0, currentLimitA: 400, resistanceOhm: 0.01 },
    ],
    starters: [
      {
        id: 'starter',
        bus: 'pdm',
        // Ignition switch START closes the starter contactor (POH Sec 7). Contactor coil supply: steam
        // through the INST breaker (ignition switch circuit), G1000 through WARN (starter relay).
        command: g ? `${C172.magneto} == 4 && (cb.warn ?? 1)` : `${C172.magneto} == 4 && (cb.inst ?? 1)`,
        speed: 'eng1.rpm',
        noLoadSpeed: 350, // physics Piston starter no-load speed
        resistanceOhm: 0.065, // EST (systems-power recipe): ~370 A locked rotor at 24 V
        nominalV: 24,
        engineStarterVar: 'eng1.starter',
        engineKind: 'piston',
        contactor: { bus: g ? 'xfeed' : 'bus1', pickupV: 16, dropoutV: 11 }, // EST
      },
    ],
    links: [
      // Master (battery) contactor in the PDM.
      { id: 'batt_contactor', a: 'batt_bus', b: 'pdm', closed: C172.masterBat, coil: { bus: 'batt_bus', pickupV: 14, dropoutV: 10 } },
      // PDM feeder breakers to the primary buses (UND: "FEEDER A / FEEDER B", not accessible in flight).
      { id: 'feeder_b', a: 'pdm', b: 'bus1', cb: { name: 'feeder_b', ratingA: 60 } },
      { id: 'feeder_a', a: 'pdm', b: 'bus2', cb: { name: 'feeder_a', ratingA: 60 } },
      // Essential/crossfeed bus: diodes from both primary buses.
      { id: 'xfeed_d1', a: 'bus1', b: 'xfeed', kind: 'diode' },
      { id: 'xfeed_d2', a: 'bus2', b: 'xfeed', kind: 'diode' },
      // Avionics buses: feeder breaker + AVIONICS BUS 1 / BUS 2 switch (relays).
      { id: 'avn1_relay', a: 'bus1', b: 'avn1', closed: C172.avionicsBus1, cb: cb(list, g ? 'avn1' : 'avn_bus1') },
      { id: 'avn2_relay', a: 'bus2', b: 'avn2', closed: C172.avionicsBus2, cb: cb(list, g ? 'avn2' : 'avn_bus2') },
      ...(g
        ? [
            // ESS bus feed. POH NAV III Fig 7-7 sheet 2 shows one diode from each primary bus into
            // the ESS bus. SCOPE: modelled as one diode from the crossfeed bus (itself diode-fed from
            // both primary buses): the same behaviour for every failure except a crossfeed-bus short,
            // and no diode loop (the network's ideal diodes cannot open inside a loop, which would
            // let the standby battery back-feed the main buses through the second ESS diode).
            { id: 'ess_d', a: 'xfeed', b: 'ess', kind: 'diode' as const },
            // Standby battery controller: discharges into ESS when ARMed and the main bus is below 20 V
            // (POH NAV III Sec 3), charges from ESS while ARMed. TEST (momentary) loads the battery only.
            { id: 'stby_discharge', a: 'stby_bus', b: 'ess', kind: 'diode' as const, closed: 'ac.c172.stby_release', cb: cb(list, 'stdby_batt') },
            { id: 'stby_charge', a: 'ess', b: 'stby_bus', kind: 'diode' as const, closed: `${C172.stbyBatt} == ${STBY_BATT.arm}`, cb: cb(list, 'stdby_batt') },
            // Dual feeds (identical breakers on AVN BUS 1 and ESS, diode-ORed at the unit). The unit
            // draws from the higher supply; only one feed conducts at a time so the unit bus never
            // closes a diode loop between AVN BUS 1 and the ESS bus (see ess_d). The ESS feed wins a
            // tie (0.5 V hysteresis, EST); a pulled ESS breaker hands the unit to AVN BUS 1.
            ...dualFeed('pfd', 'lru_pfd', cb(list, 'pfd_avn1'), cb(list, 'pfd_ess')),
            ...dualFeed('adc', 'lru_adc_ahrs', cb(list, 'adc_ahrs_avn1'), cb(list, 'adc_ahrs_ess')),
            ...dualFeed('nav1', 'lru_nav1_eng', cb(list, 'nav1_eng_avn1'), cb(list, 'nav1_eng_ess')),
          ]
        : []),
    ],
    loads,
  };
  return cfg;
}

/** The two diode feeds (AVN BUS 1 and ESS) of a dual-fed G1000 unit bus; exactly one conducts. */
function dualFeed(id: string, unitBus: string, cbAvn: { name: string; ratingA: number }, cbEss: { name: string; ratingA: number }) {
  const avnWins = `(elec.avn1_v > elec.ess_v + 0.5 || (cb.${cbEss.name} ?? 1) < 0.5)`;
  return [
    { id: `${id}_f1`, a: 'avn1', b: unitBus, kind: 'diode' as const, closed: avnWins, cb: cbAvn },
    { id: `${id}_f2`, a: 'ess', b: unitBus, kind: 'diode' as const, closed: `!${avnWins}`, cb: cbEss },
  ];
}

export function createC172Electrical(ctx: Pick<SimContext, 'vars'>, variant: C172Variant, opts: C172ElectricalOptions = {}): ElectricalNetwork {
  return new ElectricalNetwork(ctx.vars, c172ElectricalConfig(variant, opts), { name: `c172-electrical-${variant}` });
}

/** Breaker list of a variant (for the variant's circuit-breaker panel build). */
export function c172Breakers(variant: C172Variant): C172Breaker[] {
  return variant === 'g1000' ? G1000_BREAKERS : STEAM_BREAKERS;
}
