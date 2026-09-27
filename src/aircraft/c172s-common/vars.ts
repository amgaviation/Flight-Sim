/**
 * Cessna 172S shared SimVar names (`ac.c172.*`), used by both cockpit
 * variants (c172-steam, c172-g1000). Every cockpit control writes exactly one
 * of these vars; the systems in ./systems consume them (CLAUDE.md: every
 * control changes state that a system consumes).
 *
 * Values and positions follow the POH wording (docs/aircraft/c172s.md §8):
 * switches are 0 = OFF (down) / 1 = ON (up) unless noted.
 */

/** MAGNETOS / ignition key positions (POH Sec 7: "labeled clockwise OFF, R, L, BOTH and START"). */
export const MAG = { off: 0, right: 1, left: 2, both: 3, start: 4 } as const;
/** Fuel selector positions (POH Sec 7: three-position LEFT / BOTH / RIGHT). */
export const FUEL_SEL = { left: 0, both: 1, right: 2 } as const;
/** G1000 STBY BATT switch (POH NAV III Sec 7: three-position ARM / OFF / TEST, TEST momentary). */
export const STBY_BATT = { test: -1, off: 0, arm: 1 } as const;
/**
 * ELT remote switch. Steam (Artex ME406 remote rocker, POH Sec 7 "remote
 * switch/annunciator"): ARM (normal) / ON; G1000 (POH NAV III Sec 7): ON / AUTO / RESET.
 * One var for both: -1 RESET/TEST (momentary), 0 ARM/AUTO, 1 ON.
 */
export const ELT_SW = { reset: -1, arm: 0, on: 1 } as const;
/**
 * Steam annunciator panel toggle (POH Sec 7 "Annunciator panel", later serials):
 * DAY / NIGHT brightness with a momentary TEST position. -1 TEST, 0 NIGHT (dim), 1 DAY (bright).
 */
export const ANN_SW = { test: -1, night: 0, day: 1 } as const;
/** Cabin door handle (POH Sec 7 "Entrance doors"): OPEN / CLOSE / LOCK. */
export const DOOR = { open: 0, closed: 1, locked: 2 } as const;

export const C172 = {
  // ---------------------------------------------------------------- electrical (switch panel)
  /** MASTER switch BAT half (red split rocker, right half). */
  masterBat: 'ac.c172.master_bat',
  /** MASTER switch ALT half (left half). Mechanically interlocked: ALT cannot be ON with BAT OFF. */
  masterAlt: 'ac.c172.master_alt',
  /** AVIONICS BUS 1 / BUS 2 (split rocker; steam serials 172S8704+ and G1000). */
  avionicsBus1: 'ac.c172.avn_bus1',
  avionicsBus2: 'ac.c172.avn_bus2',
  /** G1000 STBY BATT switch, see STBY_BATT. */
  stbyBatt: 'ac.c172.stby_batt',
  /** External power cart plugged into the receptacle (left cowl) and on. */
  extPower: 'ac.c172.ext_pwr',
  /** CABIN PWR 12V switch (G1000 switch panel) / 12 V power port load (steam: always on with CABIN LTS/PWR CB). */
  cabinPwr12v: 'ac.c172.cabin_pwr_12v',
  // ---------------------------------------------------------------- engine and fuel
  /** Ignition / MAGNETOS key switch, see MAG (START spring-loaded back to BOTH). */
  magneto: 'ac.c172.mags',
  /** Ignition key inserted (the key is needed to turn the switch; cold & dark: removed). */
  keyIn: 'ac.c172.key_in',
  /** Throttle knob 0 = idle (pulled full out) .. 1 = full (pushed full in). */
  throttle: 'ac.c172.throttle',
  /** Throttle friction lock knob 0..1 (clockwise increases friction). */
  throttleFriction: 'ac.c172.throttle_friction',
  /** Mixture knob 0 = idle cut-off (pulled) .. 1 = full rich (pushed); vernier twist. */
  mixture: 'ac.c172.mixture',
  /** FUEL PUMP (auxiliary electric fuel pump) switch. */
  fuelPump: 'ac.c172.fuel_pump',
  /** Fuel selector valve handle, see FUEL_SEL. */
  fuelSelector: 'ac.c172.fuel_selector',
  /** FUEL SHUTOFF valve knob: 1 = ON (pushed in), 0 = OFF (pulled out). */
  fuelShutoff: 'ac.c172.fuel_shutoff',
  // ---------------------------------------------------------------- flight controls
  /** Wing flap switch lever 0 UP, 1 10°, 2 20°, 3 FULL. */
  flapLever: 'ac.c172.flap_lever',
  /** Parking brake handle (pull aft and rotate 90° down = set). */
  parkingBrake: 'ac.c172.parking_brake',
  /** Control wheel lock (steel rod through the pilot's control column, flag over the ignition switch). */
  controlLock: 'ac.c172.control_lock',
  /** Elevator trim wheel position var (TrimAxis units, -1 full nose DOWN .. +1 full nose UP). */
  trimPosition: 'trim.pitch_units',
  // ---------------------------------------------------------------- lights and heat (switch panel)
  beacon: 'ac.c172.lt_beacon',
  land: 'ac.c172.lt_land',
  taxi: 'ac.c172.lt_taxi',
  nav: 'ac.c172.lt_nav',
  strobe: 'ac.c172.lt_strobe',
  pitotHeat: 'ac.c172.pitot_heat',
  // ---------------------------------------------------------------- interior lighting (knobs 0..1)
  /** Steam: PANEL LT dimmer (instrument post/internal lights). G1000: SW/CB PANELS dimmer. */
  dimPanel: 'ac.c172.dim_panel',
  /** Steam: RADIO LT dimmer (avionics displays + NAV indicators). G1000: AVIONICS dimmer (0 = photocell auto). */
  dimRadio: 'ac.c172.dim_radio',
  /** Steam: GLARESHIELD LT dimmer. */
  dimGlareshield: 'ac.c172.dim_glareshield',
  /** PEDESTAL LT dimmer (both variants). */
  dimPedestal: 'ac.c172.dim_pedestal',
  /** G1000: STBY IND dimmer (standby ASI, AI, altimeter, compass). */
  dimStbyInd: 'ac.c172.dim_stby_ind',
  /** Overhead console front flood lights: dimmer knobs (G1000) / push switches (steam), 0..1. */
  floodLeft: 'ac.c172.flood_left',
  floodRight: 'ac.c172.flood_right',
  /** Rear dome + wing courtesy lights push switch (overhead console). */
  domeCourtesy: 'ac.c172.dome_courtesy',
  /** Pilot control wheel map light rheostat (needs NAV light switch ON). */
  mapLight: 'ac.c172.map_light',
  /** Steam annunciator panel DAY/NIGHT/TEST toggle, see ANN_SW. */
  annSwitch: 'ac.c172.ann_switch',
  // ---------------------------------------------------------------- cabin environment (push-pull, 0 = in .. 1 = out)
  cabinHeat: 'ac.c172.cabin_heat',
  cabinAir: 'ac.c172.cabin_air',
  defrostLeft: 'ac.c172.defrost_left',
  defrostRight: 'ac.c172.defrost_right',
  /** ALT STATIC AIR valve: 0 OFF (pushed in) / 1 ON (pulled). */
  altStatic: 'ac.c172.alt_static',
  /** Overhead / wing-root fresh-air vents 0..1. */
  ventLeft: 'ac.c172.vent_left',
  ventRight: 'ac.c172.vent_right',
  // ---------------------------------------------------------------- miscellaneous
  elt: 'ac.c172.elt',
  /** Pilot / copilot door handles (DOOR), openable storm windows (0 closed .. 1 open), baggage door. */
  doorLeft: 'ac.c172.door_left',
  doorRight: 'ac.c172.door_right',
  windowLeft: 'ac.c172.window_left',
  windowRight: 'ac.c172.window_right',
  baggageDoor: 'ac.c172.baggage_door',
  /** Portable Halon 1211 extinguisher discharged (POH Sec 7). */
  extinguisher: 'ac.c172.extinguisher',
  // ---------------------------------------------------------------- outputs (read-only for cockpit/avionics)
  /** Hour (Hobbs) meter, hours: runs while oil pressure > 20 psi and its WARN/INST supply is powered. */
  hobbsHours: 'ac.c172.hobbs_h',
  /** Recording tachometer hours (engine time at 2400 rpm = 1 h/h; the steam tachometer drum). */
  tachHours: 'ac.eng1.tach_hours',
  /** Oil pressure switch closed (< 20 psi). */
  oilPressSwitch: 'ac.c172.oil_press_low',
  /** Starter engaged (relay closed) — for sound and the G1000 start annunciation. */
  starterEngaged: 'ac.c172.starter_engaged',
  /** Stall warning horn sounding (0/1) — pneumatic reed horn above the left door. */
  stallHorn: 'ac.c172.stall_horn',
  /** Cabin temperature (deg C) from the heat/air controls. */
  cabinTempC: 'ac.c172.cabin_temp_c',
  /** Windshield defog (0..1, 1 = fully fogged) — reduced by defrost air. */
  windshieldFog: 'ac.c172.ws_fog',
  /** 1 while the alternator field is powered and the alternator is on line. */
  altOnline: 'elec.alt_online',
  /** Steam compatibility vars for src/avionics/analog (ANALOG_VARS). */
  analogBusV: 'ac.elec.bus_v',
  analogBattAmps: 'ac.elec.batt_amps',
  analogTurnCoordV: 'ac.elec.turn_coord_v',
  analogGaugesV: 'ac.elec.gauges_v',
  analogClockV: 'ac.elec.clock_v',
  analogInstLight: 'ac.light.instruments',
  /** G1000 EIS electrical readouts: M BUS / E BUS volts, M BATT / S BATT amps (+ = charging). */
  mBusV: 'ac.c172.m_bus_v',
  eBusV: 'ac.c172.e_bus_v',
  mBattA: 'ac.c172.m_batt_a',
  sBattA: 'ac.c172.s_batt_a',
  /** G1000 STBY BATT TEST lamp (green LED right of the switch). */
  stbyTestLamp: 'ac.c172.stby_test_lamp',
  /** ELT transmitting (remote switch annunciator lit). */
  eltTx: 'ac.c172.elt_tx',
} as const;

/**
 * Annunciation conditions (0/1) computed by C172Annunciators for both variants.
 * Steam annunciator panel (POH Sec 7): L LOW FUEL R, OIL PRESS (red), L VAC R, VOLTS (red);
 * the `_lamp` vars include the 10 s attention flash and the TEST/NIGHT dimming (0..1 brightness).
 * G1000 (POH NAV III Sec 7): OIL PRESSURE, LOW FUEL L, LOW FUEL R, LOW VOLTS, HIGH VOLTS,
 * STBY BATT, LOW VACUUM (PITCH TRIM and CO LVL HIGH come from the AFCS / CO detector).
 */
export const ANN = {
  oilPress: 'ac.c172.ann.oil_press',
  lowFuelL: 'ac.c172.ann.low_fuel_l',
  lowFuelR: 'ac.c172.ann.low_fuel_r',
  vacL: 'ac.c172.ann.vac_l',
  vacR: 'ac.c172.ann.vac_r',
  lowVacuum: 'ac.c172.ann.low_vacuum',
  lowVolts: 'ac.c172.ann.low_volts',
  highVolts: 'ac.c172.ann.high_volts',
  stbyBatt: 'ac.c172.ann.stby_batt',
  coLvlHigh: 'ac.c172.ann.co_lvl_high',
  /** Steam panel lamp outputs (0..1 brightness incl. flash/test/dim). */
  lamp: (id: 'oil_press' | 'low_fuel_l' | 'low_fuel_r' | 'vac_l' | 'vac_r' | 'volts') => `ac.c172.lamp.${id}`,
} as const;

/** Failure ids registered by the c172s-common systems (besides the building blocks' own). */
export const C172_FAIL = {
  /**
   * Engine-driven fuel pump inoperative (POH Sec 3 "Engine-driven fuel pump failure": FUEL PUMP
   * switch ON). Registered by the FuelSystem (pump id `edp` in systems/fuel.ts).
   */
  edpFuelPump: 'fuel.edp',
  /** Induction air filter blocked: the spring-loaded alternate air door opens (~10 % power loss). */
  airFilter: 'c172.air_filter',
  /** Alternator drive belt broken. */
  altBelt: 'c172.alt_belt',
  /** Exhaust muffler shroud crack: CO in the cabin with CABIN HT on. */
  mufflerLeak: 'c172.muffler_leak',
  /** Magneto failures (dead magneto). */
  magLeft: 'c172.mag_left',
  magRight: 'c172.mag_right',
  /** Fuel quantity transmitter failure (needle to OFF, LOW FUEL annunciator). */
  fuelXmtrL: 'c172.fuel_xmtr_l',
  fuelXmtrR: 'c172.fuel_xmtr_r',
} as const;
