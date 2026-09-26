/**
 * Standard SimVar names shared by every aircraft and module.
 *
 * Ownership (who writes) is noted per group. Anything not listed here is
 * aircraft-specific and must use the `ac.` prefix.
 *
 * Sign conventions (pilot-intuitive, normalized):
 *   input.pitch  +1 = yoke/stick full aft (nose up)
 *   input.roll   +1 = full right roll
 *   input.yaw    +1 = full right rudder pedal
 *   surf.elevator/aileron/rudder use the same signs as the inputs.
 * Body axes: x forward, y right, z down. Angles in degrees unless suffixed _rad.
 */

/** Written by the input module (keyboard/mouse/joystick). Read by aircraft FCS. */
export const INPUT = {
  pitch: 'input.pitch', // -1..1
  roll: 'input.roll', // -1..1
  yaw: 'input.yaw', // -1..1
  tiller: 'input.tiller', // -1..1 (nosewheel tiller / pedal steering override)
  brakeLeft: 'input.brake_left', // 0..1 toe brake
  brakeRight: 'input.brake_right', // 0..1
  /** Hardware throttle axis per lever (0..1). Aircraft decide how this maps to TLA. */
  throttle: (i: number) => `input.throttle${i}`,
  /** 1 while a hardware throttle axis is bound; cockpit lever then follows the axis. */
  throttleBound: 'input.throttle_axis_bound',
  mixture: (i: number) => `input.mixture${i}`,
  pitchTrimRate: 'input.pitch_trim_rate', // -1..1 (hat switch / key held), + = nose up
  apDisconnect: 'input.ap_disc', // momentary 1 while pressed
  toga: 'input.toga', // momentary
} as const;

/** Written by aircraft systems (flight control system). Read by FDM. */
export const SURF = {
  elevator: 'surf.elevator', // -1..1 (+ nose up)
  aileron: 'surf.aileron', // -1..1 (+ roll right)
  rudder: 'surf.rudder', // -1..1 (+ yaw right)
  pitchTrim: 'surf.pitch_trim', // -1..1 normalized trim tab/stabilizer (+ nose up)
  aileronTrim: 'surf.aileron_trim', // -1..1
  rudderTrim: 'surf.rudder_trim', // -1..1
  flapsDeg: 'surf.flaps_deg', // actual flap angle
  slats: 'surf.slats', // 0..1 leading-edge devices extension
  spoilerLeft: 'surf.spoiler_left', // 0..1 roll/flight spoilers left wing
  spoilerRight: 'surf.spoiler_right', // 0..1
  speedbrake: 'surf.speedbrake', // 0..1 symmetric flight spoilers / speedbrake panels
  groundSpoilers: 'surf.ground_spoilers', // 0..1
} as const;

/** Written by aircraft systems (gear/brake/steering). Read by FDM. */
export const GEAR = {
  /** 0 = up & locked, 1 = down & locked. Index 0 = nose, 1 = left main, 2 = right main. */
  pos: (i: number) => `gear.pos${i}`,
  brakeLeft: 'gear.brake_left', // 0..1 actual applied brake
  brakeRight: 'gear.brake_right', // 0..1
  steerDeg: 'gear.steer_deg', // actual nosewheel angle (+ right)
  /** Written by FDM. */
  weightOnWheels: (i: number) => `gear.wow${i}`, // 0/1
  compression: (i: number) => `gear.compression${i}`, // 0..1
  wheelSpeedKt: (i: number) => `gear.wheel_speed${i}_kt`,
} as const;

/**
 * Engine vars. Inputs are written by aircraft systems (FADEC, fuel, starter),
 * outputs are written by the FDM engine models. `i` is 1-based.
 */
export const ENG = {
  // --- turbofan inputs
  n1Cmd: (i: number) => `eng${i}.n1_cmd_pct`, // FADEC-demanded N1
  fuelOn: (i: number) => `eng${i}.fuel_on`, // fuel shutoff valve open AND fuel pressure available
  starter: (i: number) => `eng${i}.starter`, // starter engaged (air or electric)
  ignition: (i: number) => `eng${i}.ignition`, // igniters firing
  bleedExtract: (i: number) => `eng${i}.bleed_extract`, // 0..1 customer bleed load
  reverserPos: (i: number) => `eng${i}.reverser_pos`, // 0..1 reverser deployment
  antiIce: (i: number) => `eng${i}.anti_ice`, // nacelle anti-ice on (0/1)
  // --- piston inputs
  throttle: (i: number) => `eng${i}.throttle`, // 0..1 throttle butterfly
  mixture: (i: number) => `eng${i}.mixture`, // 0..1 (0 = idle cutoff)
  magLeft: (i: number) => `eng${i}.mag_left`, // 0/1
  magRight: (i: number) => `eng${i}.mag_right`, // 0/1
  primer: (i: number) => `eng${i}.primer`, // 0..1 prime quantity
  altAir: (i: number) => `eng${i}.alt_air`, // alternate induction air open
  // --- outputs (all engines)
  running: (i: number) => `eng${i}.running`, // 0/1
  n1: (i: number) => `eng${i}.n1_pct`,
  n2: (i: number) => `eng${i}.n2_pct`,
  itt: (i: number) => `eng${i}.itt_c`, // ITT or EGT for turbofans
  fuelFlowPph: (i: number) => `eng${i}.ff_pph`,
  oilPressPsi: (i: number) => `eng${i}.oil_press_psi`,
  oilTempC: (i: number) => `eng${i}.oil_temp_c`,
  thrustN: (i: number) => `eng${i}.thrust_n`,
  vibN1: (i: number) => `eng${i}.vib_n1`,
  vibN2: (i: number) => `eng${i}.vib_n2`,
  rpm: (i: number) => `eng${i}.rpm`,
  mapInHg: (i: number) => `eng${i}.map_inhg`,
  egtF: (i: number) => `eng${i}.egt_f`,
  chtF: (i: number) => `eng${i}.cht_f`,
  fuelFlowGph: (i: number) => `eng${i}.ff_gph`,
  oilTempF: (i: number) => `eng${i}.oil_temp_f`,
  /** Accessory gearbox drive fraction 0..1 (for generators, hydraulic pumps, vacuum pumps). */
  accessoryDrive: (i: number) => `eng${i}.accessory_drive`,
  /** Bleed air available pressure (psi) at the engine port. */
  bleedPressPsi: (i: number) => `eng${i}.bleed_press_psi`,
  // --- appended by physics (append-only)
  /** Piston: engine-driven vacuum pump suction available (inHg), before any vacuum-system failure logic. */
  vacuumInHg: (i: number) => `eng${i}.vacuum_inhg`,
  /** 0..1 combustion roughness (misfire from mixture/magneto/flooding) for audio & vibration. */
  roughness: (i: number) => `eng${i}.rough`,
  /** Piston: brake horsepower delivered to the propeller (hp). */
  powerHp: (i: number) => `eng${i}.power_hp`,
} as const;

/** Written by aircraft fuel system. Read by FDM (mass) and engines. kg per tank, 0-based. */
export const FUEL = {
  tankKg: (i: number) => `fuel.tank${i}_kg`,
  totalKg: 'fuel.total_kg',
} as const;

/** Written by the FDM each step. Read by everything else. */
export const FDM = {
  lat: 'fdm.lat_deg',
  lon: 'fdm.lon_deg',
  altMsl: 'fdm.alt_msl_ft', // geometric altitude above mean sea level
  altAgl: 'fdm.alt_agl_ft', // height of CG reference above terrain
  radioAlt: 'fdm.radio_alt_ft', // height of gear-down reference point above terrain
  pitch: 'fdm.pitch_deg',
  bank: 'fdm.bank_deg',
  headingTrue: 'fdm.hdg_true_deg',
  headingMag: 'fdm.hdg_mag_deg',
  magVar: 'fdm.mag_var_deg', // + east
  trackTrue: 'fdm.trk_true_deg',
  trackMag: 'fdm.trk_mag_deg',
  ias: 'fdm.ias_kt', // indicated airspeed from pitot-static (before instrument error)
  cas: 'fdm.cas_kt',
  tas: 'fdm.tas_kt',
  gs: 'fdm.gs_kt',
  mach: 'fdm.mach',
  vs: 'fdm.vs_fpm', // inertial vertical speed
  aoa: 'fdm.aoa_deg',
  beta: 'fdm.beta_deg', // sideslip
  nz: 'fdm.nz_g', // load factor (body z, positive = pilot pushed into seat)
  ny: 'fdm.ny_g', // lateral acceleration (slip ball)
  nx: 'fdm.nx_g',
  p: 'fdm.p_dps', // body roll rate
  q: 'fdm.q_dps',
  r: 'fdm.r_dps',
  turnRate: 'fdm.turn_rate_dps',
  onGround: 'fdm.on_ground',
  crashed: 'fdm.crashed',
  mass: 'fdm.mass_kg',
  cgPctMac: 'fdm.cg_pct_mac',
  stallWarn: 'fdm.stall_warning', // raw aerodynamic stall proximity 0..1 (aircraft decides warning logic)
  // atmosphere at aircraft
  pressAlt: 'fdm.press_alt_ft', // pressure altitude (29.92)
  densityAlt: 'fdm.density_alt_ft',
  sat: 'fdm.sat_c', // static air temperature
  tat: 'fdm.tat_c',
  staticPressInHg: 'fdm.static_press_inhg',
  staticPressPa: 'fdm.static_press_pa',
  densityKgM3: 'fdm.density_kgm3',
  qbarPa: 'fdm.qbar_pa',
  windDir: 'fdm.wind_dir_deg', // true, direction wind is FROM
  windSpeed: 'fdm.wind_kt',
  groundElevFt: 'fdm.ground_elev_ft',
  // --- appended by physics (append-only)
  /** 0..1 airframe buffet intensity (stall buffet, Mach buffet, speedbrake/gear buffet) for shake & sound. */
  buffet: 'fdm.buffet',
  /** String var: human-readable crash cause ('' when not crashed). */
  crashReason: 'fdm.crash_reason',
  /** Normalized AoA: alpha / effective stall alpha (flaps, slats, ice). 1.0 = stall. */
  aoaNorm: 'fdm.aoa_norm',
  /** Effective stall AoA (deg) for the current flap/slat/ice state. */
  alphaStall: 'fdm.alpha_stall_deg',
  /** Equivalent airspeed (kt). */
  eas: 'fdm.eas_kt',
  /** 1 while the FDM is frozen (slew / position freeze). */
  frozen: 'fdm.frozen',
} as const;

/** Environment, written by the weather/time modules. */
export const ENV = {
  qnhInHg: 'env.qnh_inhg', // sea-level pressure at aircraft location
  oatSeaLevelC: 'env.sl_temp_c',
  visibilityM: 'env.visibility_m',
  cloudBaseFt: 'env.cloud_base_ft',
  cloudCover: 'env.cloud_cover', // 0..1
  precip: 'env.precip', // 0..1
  turbulence: 'env.turbulence', // 0..1
  icing: 'env.icing', // 0..1 icing intensity when in visible moisture
  timeUtcHours: 'env.time_utc_h', // 0..24
  dayOfYear: 'env.day_of_year',
  sunElevation: 'env.sun_elev_deg',
  ambientLight: 'env.ambient_light', // 0..1 used for display auto-dimming
  // --- appended by physics (append-only). Surface wind at 10 m AGL; read by the FDM every step.
  surfaceWindDir: 'env.wind_dir_deg', // true, direction wind is FROM
  surfaceWindKt: 'env.wind_kt',
  surfaceGustKt: 'env.wind_gust_kt', // gust increment above the steady wind (kt), 0 = none
} as const;

/** Simulation control. */
export const SIM = {
  paused: 'sim.paused',
  rate: 'sim.rate', // time acceleration
  timeS: 'sim.time_s', // elapsed sim seconds
  slew: 'sim.slew', // slew mode on
  frameMs: 'sim.frame_ms',
} as const;

/**
 * Pitot/static and electrical-independent instrument sources exposed by
 * aircraft systems for avionics. Avionics must read these (not FDM truth)
 * so that failures and instrument lag propagate.
 */
export const ADC = {
  /** ADC/AHRS index `s` (1-based). Aircraft with one source only set s=1. */
  ias: (s: number) => `adc${s}.ias_kt`,
  mach: (s: number) => `adc${s}.mach`,
  baroAlt: (s: number) => `adc${s}.alt_ft`, // corrected for baro setting
  vs: (s: number) => `adc${s}.vs_fpm`,
  tas: (s: number) => `adc${s}.tas_kt`,
  sat: (s: number) => `adc${s}.sat_c`,
  tat: (s: number) => `adc${s}.tat_c`,
  baroSetting: (s: number) => `adc${s}.baro_inhg`,
  baroStd: (s: number) => `adc${s}.baro_std`, // 0/1 STD selected
  valid: (s: number) => `adc${s}.valid`,
  pitch: (s: number) => `ahrs${s}.pitch_deg`,
  bank: (s: number) => `ahrs${s}.bank_deg`,
  heading: (s: number) => `ahrs${s}.hdg_mag_deg`,
  headingTrue: (s: number) => `ahrs${s}.hdg_true_deg`,
  turnRate: (s: number) => `ahrs${s}.turn_rate_dps`,
  slip: (s: number) => `ahrs${s}.slip`, // -1..1 ball deflection
  ahrsValid: (s: number) => `ahrs${s}.valid`,
} as const;

/** Navigation radio receiver outputs, written by nav/Radios. `r` is 1-based. */
export const NAV = {
  activeFreq: (r: number) => `nav${r}.active_mhz`,
  standbyFreq: (r: number) => `nav${r}.stby_mhz`,
  obs: (r: number) => `nav${r}.obs_deg`,
  powered: (r: number) => `nav${r}.powered`,
  received: (r: number) => `nav${r}.received`, // signal valid
  isLoc: (r: number) => `nav${r}.is_loc`,
  radial: (r: number) => `nav${r}.radial_deg`, // bearing FROM station (magnetic)
  cdi: (r: number) => `nav${r}.cdi`, // -1..1 (full scale), + = needle right (fly right)
  toFrom: (r: number) => `nav${r}.to_from`, // 1 = TO, -1 = FROM, 0 = OFF
  gsValid: (r: number) => `nav${r}.gs_valid`,
  gsDev: (r: number) => `nav${r}.gs_dev`, // -1..1, + = glideslope above aircraft (fly up)
  dmeValid: (r: number) => `nav${r}.dme_valid`,
  dmeNm: (r: number) => `nav${r}.dme_nm`,
  locCourse: (r: number) => `nav${r}.loc_course_deg`,
  ident: (r: number) => `nav${r}.ident`, // string var
  bearing: (r: number) => `nav${r}.bearing_deg`, // bearing TO station (magnetic), for RMI/bearing pointers
  markerOuter: 'nav.marker_outer',
  markerMiddle: 'nav.marker_middle',
  markerInner: 'nav.marker_inner',
  adfActive: (r: number) => `adf${r}.active_khz`,
  adfStandby: (r: number) => `adf${r}.stby_khz`,
  adfBearing: (r: number) => `adf${r}.rel_bearing_deg`,
  adfValid: (r: number) => `adf${r}.valid`,
  comActive: (r: number) => `com${r}.active_mhz`,
  comStandby: (r: number) => `com${r}.stby_mhz`,
  xpdrCode: 'xpdr.code',
  xpdrMode: 'xpdr.mode', // 0 off, 1 stby, 2 on (mode A), 3 alt (mode C/S), 4 TA only, 5 TA/RA
  xpdrIdent: 'xpdr.ident',
  // --- appended by nav (append-only). See docs/modules/nav.md for semantics.
  // Receiver inputs written by the aircraft:
  /** 1 = DME held on the frequency that was tuned when hold was engaged (DME HOLD). */
  dmeHold: (r: number) => `nav${r}.dme_hold`,
  /** ADF receiver power (0/1). */
  adfPowered: (r: number) => `adf${r}.powered`,
  /** ADF function: 0 = ANT (audio only, needle parked at 90), 1 = ADF, 2 = BFO (ADF + beat tone). */
  adfMode: (r: number) => `adf${r}.mode`,
  /** Marker beacon receiver power (0/1) and sensitivity (1 = HI, 0 = LO). */
  markerPowered: 'nav.marker_powered',
  markerHiSens: 'nav.marker_hi_sens',
  // Receiver outputs written by nav/Radios:
  /** 0..1 received signal quality (ident audio volume, flag threshold). */
  signal: (r: number) => `nav${r}.signal`,
  /** Angular deviation from the selected VOR course / localizer course (deg), + = fly right (same sign as cdi). */
  devDeg: (r: number) => `nav${r}.dev_deg`,
  /** Glideslope angular deviation (deg), + = glideslope above aircraft (fly up). */
  gsDevDeg: (r: number) => `nav${r}.gs_dev_deg`,
  /** 1 while the aircraft is in the localizer back-course sector. */
  backCourse: (r: number) => `nav${r}.back_course`,
  /** Horizontal distance to the received station (nm). */
  distNm: (r: number) => `nav${r}.dist_nm`,
  /** 1 when `bearing` (RMI) is valid (VOR received; not for localizers). */
  bearingValid: (r: number) => `nav${r}.bearing_valid`,
  /** String: morse pattern of the station ident, e.g. '.. -  . -...'. */
  morse: (r: number) => `nav${r}.ident_morse`,
  /** String: station type received ('VOR', 'VORDME', 'VORTAC', 'ILS', 'LOC', 'DME', ...), '' when none. */
  stationType: (r: number) => `nav${r}.station_type`,
  /** String: ident of the DME being received (differs from `ident` in DME HOLD). */
  dmeIdent: (r: number) => `nav${r}.dme_ident`,
  /** DME-derived ground speed toward/away from the station (kt, always >= 0) and time to station (min). */
  dmeGs: (r: number) => `nav${r}.dme_gs_kt`,
  dmeTts: (r: number) => `nav${r}.dme_tts_min`,
  adfIdent: (r: number) => `adf${r}.ident`, // string
  adfMorse: (r: number) => `adf${r}.ident_morse`, // string
  adfSignal: (r: number) => `adf${r}.signal`, // 0..1
  adfDistNm: (r: number) => `adf${r}.dist_nm`,
} as const;

/**
 * GPS receiver (nav/Radios GpsReceiver). GPS position and ground speed are
 * the documented exception to "avionics never read fdm.*": the receiver
 * copies FDM truth after its acquisition delay.
 */
export const GPS = {
  /** Input: receiver power (0/1), written by the aircraft electrical logic. */
  powered: 'gps.powered',
  /** Input: 1 = receiver failed / no satellites (failure injection). */
  fail: 'gps.fail',
  valid: 'gps.valid',
  lat: 'gps.lat_deg',
  lon: 'gps.lon_deg',
  /** Geometric altitude MSL (ft). */
  alt: 'gps.alt_ft',
  gs: 'gps.gs_kt',
  trackTrue: 'gps.trk_true_deg',
  trackMag: 'gps.trk_mag_deg',
  vs: 'gps.vs_fpm',
  /** Magnetic variation at the position (WMM2025, deg + east). */
  magVar: 'gps.mag_var_deg',
  /** Satellites tracked and estimated position uncertainty (nm). */
  sats: 'gps.sats',
  epuNm: 'gps.epu_nm',
  /** 1 when SBAS (WAAS/EGNOS) corrections are in use (LPV capable). */
  sbas: 'gps.sbas',
  /** Seconds left until position fix after power-up (0 when valid). */
  acquireS: 'gps.acq_s',
  /** UTC time of day (hours) from the GPS. */
  utcH: 'gps.utc_h',
} as const;

/** Generic autopilot/FD outputs shared by avionics renderers. Aircraft AP logic writes these. */
export const AP = {
  engaged: 'ap.engaged',
  fdOn: (side: number) => `ap.fd${side}_on`,
  fdPitch: 'ap.fd_pitch_deg', // commanded pitch
  fdBank: 'ap.fd_bank_deg', // commanded bank
  yd: 'ap.yd_engaged',
  athr: 'ap.at_engaged',
  lateralActive: 'ap.lat_active', // string var: e.g. 'HDG', 'LNAV', 'LOC', 'ROL'
  lateralArmed: 'ap.lat_armed', // string var
  verticalActive: 'ap.vert_active', // string var: 'PIT', 'ALT', 'VS', 'FLC', 'VPATH', 'GS', 'TO', 'GA'
  verticalArmed: 'ap.vert_armed', // string var
  athrMode: 'ap.at_mode', // string var
  selHeading: 'ap.sel_hdg_deg',
  selCourse: (side: number) => `ap.sel_crs${side}_deg`,
  selAltitude: 'ap.sel_alt_ft',
  selVs: 'ap.sel_vs_fpm',
  selSpeed: 'ap.sel_spd_kt',
  selMach: 'ap.sel_mach',
  speedIsMach: 'ap.spd_is_mach',
  selFpa: 'ap.sel_fpa_deg',
  minimums: (side: number) => `ap.mins${side}_ft`,
  minimumsIsRadio: (side: number) => `ap.mins${side}_is_ra`,
} as const;

/** Flight-plan/FMS outputs for displays. FMS owns these. */
export const FMS = {
  activeLegIndex: 'fms.active_leg',
  xtkNm: 'fms.xtk_nm', // + = right of course
  dtkMag: 'fms.dtk_mag_deg',
  desiredTrackTrue: 'fms.dtk_true_deg',
  distToWptNm: 'fms.dist_to_wpt_nm',
  bearingToWptMag: 'fms.brg_to_wpt_deg',
  eteToWptS: 'fms.ete_wpt_s',
  nextWptIdent: 'fms.next_wpt', // string
  destIdent: 'fms.dest', // string
  distToDestNm: 'fms.dist_to_dest_nm',
  lnavValid: 'fms.lnav_valid',
  vnavTargetAltFt: 'fms.vnav_tgt_alt_ft',
  vnavDevFt: 'fms.vnav_dev_ft', // + = above path
  vnavValid: 'fms.vnav_valid',
  todDistNm: 'fms.tod_dist_nm',
  cdiScaleNm: 'fms.cdi_scale_nm',
  approachMode: 'fms.approach_mode', // string: 'TERM', 'ENR', 'OCN', 'LPV', 'LNAV', 'LNAV+V', 'LNAV/VNAV'
  // --- appended by nav (append-only). Written by nav/fms (Fms / LnavGuidance / VnavGuidance).
  /** LNAV roll command for the autopilot/flight director (deg, + = right wing down). */
  lnavBankCmd: 'fms.lnav_bank_cmd_deg',
  /** VNAV/FMS target speed (kt IAS) and Mach (0 when the target is an IAS). */
  vnavTargetSpeedKt: 'fms.vnav_tgt_speed_kt',
  vnavTargetMach: 'fms.vnav_tgt_mach',
  /** Lateral deviation scaled by the current CDI scale (or LPV angular scale), -1..1, + = fly right (needle right). */
  cdi: 'fms.cdi',
  /** Approach glidepath (LPV / LNAV/VNAV / synthetic): deviation -1..1 (+ = path above aircraft, fly up), validity, angle. */
  gpDev: 'fms.gp_dev',
  gpValid: 'fms.gp_valid',
  gpAngleDeg: 'fms.gp_angle_deg',
  /** String: ident of the FROM waypoint of the active leg. */
  fromWptIdent: 'fms.from_wpt',
  /** String: ident of the waypoint after the active one. */
  afterWptIdent: 'fms.after_wpt',
  /** 1 = TO, -1 = FROM (past the active waypoint while suspended / in a hold outbound). */
  toFrom: 'fms.to_from',
  /** String: ARINC path terminator of the active leg ('TF', 'DF', 'HM', 'VA', ...). */
  legType: 'fms.leg_type',
  /** DTK (deg magnetic) of the leg after the active one (for "turn to" advisories). */
  nextDtkMag: 'fms.next_dtk_mag_deg',
  /** 1 while waypoint sequencing is suspended (MAP before missed approach activation, discontinuity, manual termination). */
  suspended: 'fms.suspended',
  inHold: 'fms.in_hold',
  /** String: hold entry being flown: 'DIRECT' | 'TEARDROP' | 'PARALLEL' | ''. */
  holdEntry: 'fms.hold_entry',
  /** 1 during the last ~10 s before a turn at the active waypoint (Garmin "WPT" alert). */
  wptAlert: 'fms.wpt_alert',
  /** Destination predictions: ETE (s), ETA (UTC hours), fuel remaining at destination (kg). */
  eteDestS: 'fms.ete_dest_s',
  etaDestUtcH: 'fms.eta_dest_utc_h',
  fuelDestKg: 'fms.fuel_dest_kg',
  /** Vertical speed required to meet the VNAV target altitude at its waypoint (fpm, negative = descend). */
  vsRequiredFpm: 'fms.vs_req_fpm',
  /** Time to top of descent (s), 0 once past it. */
  todEteS: 'fms.tod_ete_s',
  /** String: VNAV phase 'CLB' | 'CRZ' | 'DES' | 'APR' | '' (no plan). */
  vnavPhase: 'fms.vnav_phase',
  /** Cruise altitude (ft) of the active plan (mirrors FlightPlan.cruiseAltFt). */
  cruiseAltFt: 'fms.crz_alt_ft',
  /** Increments whenever the active plan (or its geometry) changes; displays re-read the plan. */
  planVersion: 'fms.plan_version',
  /** Boeing-style editing: 1 while a modified plan awaits EXEC (EXEC light). */
  modPending: 'fms.mod_pending',
  /** 1 while the approach is active (final approach mode, CDI ramped to approach scaling). */
  approachActive: 'fms.approach_active',
  /** 1 once the missed approach has been activated. */
  missedActive: 'fms.missed_active',
} as const;

/** Ice accretion. Written by systems/IceProtection; read by FDM (lift/drag penalties) and ADC (pitot blockage). */
export const ICE = {
  airframe: 'ice.airframe', // 0..1 accumulated wing/tail ice (FDM: reduces CLmax & stall AoA, raises CD)
  inlet: (i: number) => `ice.inlet${i}`, // 0..1 engine inlet ice (engine: thrust/N1 loss, vibration)
  pitot: (s: number) => `ice.pitot${s}`, // 0..1 pitot blockage
  static: (s: number) => `ice.static${s}`, // 0..1 static port blockage
  windshield: (side: number) => `ice.windshield${side}`, // 0..1 (render: frost overlay)
} as const;

/** Master warning/caution and generic alerting shared by all aircraft. */
export const ALERT = {
  masterWarning: 'alert.master_warning', // latched until pushed
  masterCaution: 'alert.master_caution',
  stickShaker: 'alert.stick_shaker',
  stallHorn: 'alert.stall_horn',
  overspeed: 'alert.overspeed',
  gearWarning: 'alert.gear_warning',
  configWarning: 'alert.takeoff_config',
  tawsWarning: 'alert.taws_warning', // PULL UP
  tawsCaution: 'alert.taws_caution', // TERRAIN / SINK RATE / GLIDESLOPE etc.
  annunTest: 'alert.annun_test', // lamp test active
} as const;

// ---------------------------------------------------------------------------
// Appended by systems-power (append-only). Written by the blocks in
// src/systems/{electrical,fuel,hydraulic,pneumatic,pressurization,ice,apu,
// fire,oxygen,lighting,failures}; reference: docs/modules/systems-power.md.
// Component ids (bus, pump, system, light names) come from each aircraft's
// config, so most entries are name builders.
// ---------------------------------------------------------------------------

/** Failure state (FailureManager; blocks read these directly): 1 = failed. */
export const FAIL = {
  state: (id: string) => `fail.${id}`,
  activeCount: 'fail.active_count',
  armedCount: 'fail.armed_count',
} as const;

/** Circuit breakers (cockpit CircuitBreaker `var` / `trippedVar`): 1 = in; 0 = pulled or tripped. Missing = in. */
export const CB = {
  in: (name: string) => `cb.${name}`,
  tripped: (name: string) => `cb.${name}_tripped`,
} as const;

/** Electrical network outputs (default prefix 'elec.'); `id` is a bus, source, load or link id. */
export const ELEC = {
  volts: (id: string) => `elec.${id}_v`,
  powered: (id: string) => `elec.${id}_powered`, // bus >= its powered threshold / load receiving power
  amps: (id: string) => `elec.${id}_amps`, // battery: + charging, - discharging (ammeter sign)
  hz: (id: string) => `elec.${id}_hz`,
  soc: (battery: string) => `elec.${battery}_soc`, // 0..1
  online: (source: string) => `elec.${source}_online`,
  loadPct: (source: string) => `elec.${source}_load_pct`,
} as const;

/** Hydraulic outputs (default prefix 'hyd.'). */
export const HYD = {
  psi: (system: string) => `hyd.${system}_psi`,
  qty: (system: string) => `hyd.${system}_qty`, // 0..1 reservoir
  lowPress: (systemOrPump: string) => `hyd.${systemOrPump}_lowpress`,
} as const;

/** Cabin pressurisation outputs (default prefix 'press.'). */
export const PRESS = {
  cabinAlt: 'press.cabin_alt_ft',
  cabinRate: 'press.cabin_rate_fpm',
  diff: 'press.diff_psi',
  outflowPos: 'press.outflow_pos', // 0 closed .. 1 open
  targetAlt: 'press.target_alt_ft',
  landingElev: 'press.ldg_elev_ft',
  cabinAltWarn: 'press.cabin_alt_warn', // >= 10,000 ft (configurable)
  paxMasks: 'press.pax_masks', // passenger masks deployed (latched)
} as const;

/** Exterior light intensities 0..1 for the exterior renderer (LightingSystem). */
export const LIGHT = {
  level: (name: string) => `light.${name}`, // nav, beacon, strobe, landing_l, taxi, logo, wing, ...
  extension: (name: string) => `light.${name}_ext`, // retractable lights 0..1
} as const;
