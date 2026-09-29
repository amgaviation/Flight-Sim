/**
 * SimVar names written by the AFCS (autopilot / flight director) beyond the
 * standard `AP` group of `core/vars.ts`, and the AFCS -> autothrottle
 * protocol. All AFCS extras live in the `ap.` namespace.
 */
export const AFCS_VARS = {
  /** Autopilot servo commands (normalized surface increments). */
  servoPitch: 'ap.servo_pitch',
  servoRoll: 'ap.servo_roll',
  servoYaw: 'ap.servo_yaw',
  /** Pitch trim request to the trim system's AP channel: -1 nose down, 0, +1 nose up. */
  trimCmd: 'ap.trim_cmd',
  /** 1 while the AFCS consumes the pilot's force on the axis (Boeing CWS/CMD back-driven column). */
  forcePitch: 'ap.force_pitch',
  forceRoll: 'ap.force_roll',
  /** Autopilot disconnect warning active (flashing AP/A/P lights + aural until acknowledged/timeout). */
  discWarn: 'ap.disc_warn',
  /** 1 = the last disconnect was automatic (abnormal), 0 = pilot initiated. */
  discAuto: 'ap.disc_auto',
  /** Navigation signal lost in the active nav mode (cfg.navLossWingsLevel): the FMA flashes it (appended). */
  latFail: 'ap.lat_fail',
  /** Out-of-trim warning (Garmin "CHECK PITCH TRIM"/PTRM, 737 STAB OUT OF TRIM). */
  mistrim: 'ap.mistrim',
  /** AFDS status string: '', 'FD', 'CMD', 'CWS', 'SINGLE CH', 'LAND 3', ... (FMA status column). */
  status: 'ap.status',
  /** Autoland capability string: '' | 'LAND 3' | 'LAND 2' | 'NO AUTOLAND'. */
  autoland: 'ap.autoland',
  /** 1 while FLARE is armed / engaged. */
  flareArmed: 'ap.flare_armed',
  flare: 'ap.flare',
  /** Number of engaged autopilot channels (0, 1, 2). */
  channels: 'ap.channels',
  /** Boeing CMD/CWS channel states (0/1). */
  cmdA: 'ap.cmd_a',
  cmdB: 'ap.cmd_b',
  cwsA: 'ap.cws_a',
  cwsB: 'ap.cws_b',
  /** Reference values in use. */
  altRef: 'ap.alt_ref_ft',
  pitchRef: 'ap.pitch_ref_deg',
  speedRef: 'ap.spd_ref_kt',
  bankRef: 'ap.bank_ref_deg',
  /** Effective bank limit (deg) after half-bank / selector. */
  bankLimit: 'ap.bank_limit_deg',
  /** Bank-angle limit selector input (deg; 737 MCP 10/15/20/25/30). */
  bankSelect: 'ap.bank_sel_deg',
  /** 1 while half bank / low bank is selected. */
  halfBank: 'ap.half_bank',
  /** Navigation source for NAV/APR: 0 FMS/GPS, 1 NAV1, 2 NAV2 (Garmin CDI key, Honeywell NAV source). */
  navSource: 'ap.nav_source',
  /** 1 while CWS is active (Garmin CWS button held / Boeing CWS). */
  cws: 'ap.cws',
  /** 1 while the flight director shows command bars (pitch / roll valid). */
  fdPitchValid: 'ap.fd_pitch_valid',
  fdRollValid: 'ap.fd_roll_valid',
  /** Numeric mode codes (index into LATERAL_MODES / VERTICAL_MODES) for cockpit logic. */
  latCode: 'ap.lat_code',
  vertCode: 'ap.vert_code',
  /** 1 while over a VOR (cone of confusion: deviation ignored). */
  overStation: 'ap.vor_os',
  /** MCP button lights: `ap.btn_<name>` (hdg, nav, apr, bc, alt, vs, flc, vnav, lnav, vorloc, app, lvlchg, cmd_a, cmd_b, cws_a, cws_b, yd, fd, half_bank, to, ga, lvl). */
  button: (name: string) => `ap.btn_${name}`,
  /** Autothrottle request from the active pitch mode (see AtRequest). */
  atRequest: 'ap.at_req',
  /** 1 when the requested speed is the FMS speed (VNAV), 0 = MCP/selected. */
  atSpeedFms: 'ap.at_spd_fms',
} as const;

/** Autothrottle request derived from the AFCS pitch mode (`ap.at_req`). */
export enum AtRequest {
  /** No pitch mode needing a particular thrust mode: A/T free (speed if engaged). */
  None = 0,
  /** Pitch is controlling path (ALT, VS, GS, VPATH...): A/T holds speed. */
  Speed = 1,
  /** Pitch is controlling speed in a climb (FLC/LVL CHG/VNAV SPD climb): A/T sets climb thrust (N1 limit). */
  Thrust = 2,
  /** Pitch is controlling speed in a descent: A/T retards to idle (RETARD then ARM/HOLD). */
  Idle = 3,
  /** Landing flare: RETARD to idle. */
  Retard = 4,
  /** Takeoff (on the ground, TO/GA pressed). */
  Takeoff = 5,
  /** Go-around. */
  GoAround = 6,
}
