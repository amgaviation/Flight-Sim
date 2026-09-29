/**
 * SimVar names written by the sensor blocks in addition to the standard
 * `ADC` group of `core/vars.ts`. They live in the same `adc{s}.` /
 * `ahrs{s}.` namespaces so every consumer finds all data of one sensor under
 * one prefix. `s` is the 1-based sensor index.
 */
export const SENSOR_VARS = {
  // --------------------------------------------------------------- ADC extras
  /** Pressure altitude (ft, 29.92 inHg datum) from the measured static pressure. */
  pressAlt: (s: number) => `adc${s}.press_alt_ft`,
  /** Calibrated airspeed (kt) before the airspeed-indicator calibration table. */
  cas: (s: number) => `adc${s}.cas_kt`,
  /** AoA vane (deg, + nose up relative to the airflow). */
  aoa: (s: number) => `adc${s}.aoa_deg`,
  /** Airspeed trend: IAS the aircraft will have in `trendS` seconds minus the current IAS (kt). */
  iasTrend: (s: number) => `adc${s}.ias_trend_kt`,
  /** IAS rate of change (kt/s, filtered). */
  iasRate: (s: number) => `adc${s}.ias_rate_kts`,
  /** 1 while the pitot source is blocked (ice or failure) — for CAS/maintenance pages, not shown to crews in reality. */
  pitotBlocked: (s: number) => `adc${s}.pitot_blocked`,
  staticBlocked: (s: number) => `adc${s}.static_blocked`,
  /** 1 while the alternate static source is selected. */
  altStatic: (s: number) => `adc${s}.alt_static`,
  /** 1 while the computer is powered (ADC fail flags use `valid`). */
  powered: (s: number) => `adc${s}.powered`,

  // --------------------------------------------------------------- AHRS / IRS attitude extras
  /** Body rates (deg/s) and accelerations (g) from the AHRS/IRS rate gyros and accelerometers. */
  p: (s: number) => `ahrs${s}.p_dps`,
  q: (s: number) => `ahrs${s}.q_dps`,
  r: (s: number) => `ahrs${s}.r_dps`,
  nx: (s: number) => `ahrs${s}.nx_g`,
  ny: (s: number) => `ahrs${s}.ny_g`,
  nz: (s: number) => `ahrs${s}.nz_g`,
  /** Attitude valid (pitch/bank/rates). `ahrs{s}.valid` = attitude AND heading valid. */
  attValid: (s: number) => `ahrs${s}.att_valid`,
  hdgValid: (s: number) => `ahrs${s}.hdg_valid`,
  /** 1 while aligning (attitude flagged). */
  aligning: (s: number) => `ahrs${s}.aligning`,
  /** Seconds left in the current alignment (0 when aligned). */
  alignRemaining: (s: number) => `ahrs${s}.align_s`,

  // --------------------------------------------------------------- IRS (ADIRU) navigation
  /** Mode selector input: 0 OFF, 1 ALIGN, 2 NAV, 3 ATT (default var; configurable). */
  irsModeSel: (s: number) => `ac.irs${s}_mode`,
  /** Active state: 0 off, 1 aligning, 2 nav, 3 att, 4 fault/unpowered. */
  irsState: (s: number) => `irs${s}.state`,
  /** ALIGN light: 0 off, 1 steady, 2 flashing (position entry needed / motion / align fault). */
  irsAlignLight: (s: number) => `irs${s}.align_light`,
  irsOnDc: (s: number) => `irs${s}.on_dc`,
  irsDcFail: (s: number) => `irs${s}.dc_fail`,
  irsFault: (s: number) => `irs${s}.fault`,
  irsNavValid: (s: number) => `irs${s}.nav_valid`,
  irsLat: (s: number) => `irs${s}.lat_deg`,
  irsLon: (s: number) => `irs${s}.lon_deg`,
  irsGs: (s: number) => `irs${s}.gs_kt`,
  irsTrackTrue: (s: number) => `irs${s}.trk_true_deg`,
  /** Present position error of the inertial solution (nm), for the FMS ANP / POS REF pages. */
  irsPosErr: (s: number) => `irs${s}.pos_err_nm`,
  /** 1 once a present position has been entered (or taken from GPS) for this alignment. */
  irsPosEntered: (s: number) => `irs${s}.pos_entered`,

  // --------------------------------------------------------------- radio altimeter
  raAlt: (s: number) => `ra${s}.alt_ft`,
  raValid: (s: number) => `ra${s}.valid`,
  /** 1 when above the maximum range (no computed data): displays blank the RA. */
  raNcd: (s: number) => `ra${s}.ncd`,

  // --------------------------------------------------------------- vacuum (analog gyros)
  /** Suction at the gyro instruments (inHg) — same name as `ANALOG_VARS.suction`. */
  vacSuction: 'ac.vac.suction_inhg',
  vacLow: 'vac.low',
  vacPumpOk: (n: number) => `vac.pump${n}_ok`,
} as const;
