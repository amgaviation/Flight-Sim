/**
 * SimVar names shared by the flight-control blocks (besides the standard
 * `SURF`/`INPUT` groups). Blocks take every name as an option; these are
 * the defaults and the protocol between blocks.
 */
export type ControlAxis = 'pitch' | 'roll' | 'yaw';

export const FCS_VARS = {
  /** Autopilot servo commands (normalized surface increments, pilot-intuitive signs). Written by the AFCS. */
  apServo: (axis: ControlAxis) => `ap.servo_${axis}`,
  /** 1 while the AFCS consumes the pilot's control force on this axis (Boeing CWS / CMD with force transducers). */
  apForceSensed: (axis: 'pitch' | 'roll') => `ap.force_${axis}`,
  /** Yaw damper rudder command (normalized). Written by `YawDamper`. */
  ydCmd: 'fcs.yd_cmd',
  /** Stall pusher elevator command (normalized, <= 0 = nose down). Written by `StallWarning` with a pusher. */
  pusherCmd: 'stall.pusher_cmd',
  /** Total command on the axis before actuator dynamics (what the column/wheel/pedals show when back-driven). */
  column: (axis: ControlAxis) => `fcs.${axis}_column`,
  /** Best actuator power 0..1. */
  power: (axis: ControlAxis) => `fcs.${axis}_power`,
  /** 1 while the axis is in manual reversion. */
  manual: (axis: ControlAxis) => `fcs.${axis}_manual`,
  /** 1 while the surface is jammed. */
  jammed: (axis: ControlAxis) => `fcs.${axis}_jam`,
  /** Trim position in display units (stab units, tab deg, ...). */
  trimUnits: (axis: ControlAxis) => `trim.${axis}_units`,
  /** Trim motor direction: -1 nose down/left, 0 stopped, +1 nose up/right. */
  trimMotion: (axis: ControlAxis) => `trim.${axis}_motion`,
  /** 1 while any trim source is moving the trim (drives trim wheel clacks, "TRIM IN MOTION" voice, AP logic). */
  trimInMotion: (axis: ControlAxis) => `trim.${axis}_in_motion`,
  /** 1 while the trim is inside the configured takeoff band (takeoff config warning, STAB TRIM green band). */
  trimTakeoffOk: (axis: ControlAxis) => `trim.${axis}_to_ok`,
  /** 1 while electric (main) trim is available (powered, not cut out). */
  trimElecAvail: (axis: ControlAxis) => `trim.${axis}_elec_avail`,
  /** Manual trim wheel event (payload `{ delta }` in trim units, or a number). */
  trimManualEvent: (axis: ControlAxis) => `trim.${axis}_manual`,
} as const;
