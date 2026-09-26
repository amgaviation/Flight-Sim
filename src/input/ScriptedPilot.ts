/**
 * Scripted test pilot: flies a hands-off takeoff through the normal pilot
 * inputs (`input.pitch`, `input.roll`, `input.yaw`, plus the gear command on
 * the event bus), so everything downstream (flight control system, nosewheel
 * steering, rudder, FDM) is exercised exactly as with a joystick.
 *
 * Used by the headless integration tests (tests/integration/testJet.test.ts)
 * and by the browser smoke test through `window.__sim.pilot`
 * (docs/modules/qa.md). It is a test harness, not an autopilot: it reads
 * flight-model truth (`fdm.*`) the way a pilot looks out of the window.
 *
 * Takeoff script (typical jet technique, FAA-H-8083-3C Airplane Flying
 * Handbook ch. 16 "Transition to Jet-Powered Airplanes", takeoff):
 *   roll:   stick neutral, wings level with aileron, hold the runway
 *           centre line with the pedals (nosewheel steering + rudder);
 *   rotate: at VR, raise the nose at ~3 deg/s (EST, the AFH's "smooth,
 *           deliberate rotation") towards the target pitch attitude;
 *   climb:  hold the pitch attitude, wings level, pedals neutral (the
 *           aircraft crabs into a crosswind); gear up at a positive rate of
 *           climb above 50 ft AGL.
 *
 * `update(dt)` must run at the systems rate, before the aircraft systems, so
 * the commands override the once-per-frame values written by InputManager.
 * No allocation per update.
 */
import type { SimVars } from '../core/SimVars';
import type { EventBus } from '../core/EventBus';
import { FDM, INPUT } from '../core/vars';
import { metresPerDegLat, metresPerDegLon } from '../core/geo';
import { INPUT_EVENTS } from './actions';

export type ScriptedPilotPhase = 'idle' | 'roll' | 'rotate' | 'climb';

export interface TakeoffScript {
  /** Rotation speed (kt IAS). */
  vrKt: number;
  /** Runway centre-line true course (deg). */
  courseTrueDeg: number;
  /** A point on the centre line (default: the aircraft position when the script starts). */
  lat?: number;
  lon?: number;
  /** Target climb pitch attitude (deg). Default 10 (EST, typical light-jet all-engine initial climb attitude). */
  pitchDeg?: number;
  /** Pitch rotation rate (deg/s). Default 3. */
  rotateRateDegS?: number;
  /** Retract the gear after lift-off (emits `input.gear_toggle` once). Default true. */
  gearUp?: boolean;
}

/** What happened during the takeoff (NaN = not reached yet). */
export interface TakeoffLog {
  /** IAS when rotation started (kt). */
  rotateIasKt: number;
  /** IAS at lift-off (kt), all gear off the ground for 0.5 s. */
  liftoffIasKt: number;
  /** Ground distance from the script start to lift-off (m). */
  liftoffDistM: number;
  /** Sim seconds from the script start to lift-off. */
  liftoffTimeS: number;
  /** Largest centre-line deviation on the ground (m, absolute). */
  maxGroundDeviationM: number;
  /** Largest |bank| after lift-off (deg). */
  maxAirBankDeg: number;
  /** Largest pitch attitude since rotation (deg); overshoot and tail-clearance check. */
  maxPitchDeg: number;
  /** Seconds since the script started. */
  elapsedS: number;
  /** Gear retraction was commanded. */
  gearUpCommanded: boolean;
}

/** Gains (EST, tuned on the test jet in a 10 kt direct crosswind with gusts; see tests/integration). */
const K_CROSS = 0.04; // pedal per metre of centre-line deviation
const K_HDG = 0.12; // pedal per degree of heading error
const K_YAWRATE = 0.25; // pedal per deg/s of yaw rate
const K_BANK = 0.06; // aileron per degree of bank
const K_ROLLRATE = 0.03; // aileron per deg/s of roll rate
const K_PITCH = 0.25; // elevator per degree of pitch error
const K_PITCH_I = 0.3; // elevator per degree-second of pitch error (pull harder until the nose comes up)
const PITCH_I_LIMIT = 0.8; // anti-windup: integral share of the elevator command
const K_PITCHRATE = 0.14; // elevator per deg/s of pitch rate
const LIFTOFF_CONFIRM_S = 0.5;

const clamp1 = (x: number): number => (x > 1 ? 1 : x < -1 ? -1 : x);
const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

export class ScriptedPilot {
  phase: ScriptedPilotPhase = 'idle';
  readonly log: TakeoffLog = ScriptedPilot.emptyLog();
  private script: Required<TakeoffScript> = { vrKt: 0, courseTrueDeg: 0, lat: 0, lon: 0, pitchDeg: 10, rotateRateDegS: 3, gearUp: true };
  private pitchTarget = 0;
  private pitchInt = 0;
  private airborneS = 0;
  private cosC = 1;
  private sinC = 0;
  private mPerDegLat = 111_000;
  private mPerDegLon = 85_000;

  constructor(
    private readonly vars: SimVars,
    private readonly events: EventBus | null = null,
  ) {}

  private static emptyLog(): TakeoffLog {
    return { rotateIasKt: NaN, liftoffIasKt: NaN, liftoffDistM: NaN, liftoffTimeS: NaN, maxGroundDeviationM: 0, maxAirBankDeg: 0, maxPitchDeg: -90, elapsedS: 0, gearUpCommanded: false };
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** Starts the takeoff script from the current position (the aircraft should be lined up). */
  startTakeoff(s: TakeoffScript): void {
    const v = this.vars;
    const lat = s.lat ?? v.get(FDM.lat);
    const lon = s.lon ?? v.get(FDM.lon);
    this.script = {
      vrKt: s.vrKt,
      courseTrueDeg: s.courseTrueDeg,
      lat,
      lon,
      pitchDeg: s.pitchDeg ?? 10,
      rotateRateDegS: s.rotateRateDegS ?? 3,
      gearUp: s.gearUp ?? true,
    };
    const c = (s.courseTrueDeg * Math.PI) / 180;
    this.cosC = Math.cos(c);
    this.sinC = Math.sin(c);
    this.mPerDegLat = metresPerDegLat(lat);
    this.mPerDegLon = metresPerDegLon(lat);
    Object.assign(this.log, ScriptedPilot.emptyLog());
    this.pitchTarget = v.get(FDM.pitch);
    this.pitchInt = 0;
    this.airborneS = 0;
    this.phase = 'roll';
  }

  /** Stops writing inputs (the next InputManager poll takes over). */
  stop(): void {
    this.phase = 'idle';
  }

  /** Metres along (+ ahead) and across (+ right) the centre line from the script's reference point. */
  private alongCross(out: { along: number; cross: number }): { along: number; cross: number } {
    const v = this.vars;
    const n = (v.get(FDM.lat) - this.script.lat) * this.mPerDegLat;
    const e = (v.get(FDM.lon) - this.script.lon) * this.mPerDegLon;
    out.along = n * this.cosC + e * this.sinC;
    out.cross = -n * this.sinC + e * this.cosC;
    return out;
  }
  private readonly ac = { along: 0, cross: 0 };

  /** 60 Hz: writes input.pitch / input.roll / input.yaw for the current phase. */
  update(dt: number): void {
    if (this.phase === 'idle') return;
    const v = this.vars;
    const s = this.script;
    const log = this.log;
    log.elapsedS += dt;
    const ias = v.get(FDM.ias);
    const pitch = v.get(FDM.pitch);
    const bank = v.get(FDM.bank);
    const onGround = v.get(FDM.onGround) !== 0;
    const { along, cross } = this.alongCross(this.ac);

    // Wings level (into-wind aileron comes out of the bank/roll-rate loop).
    v.set(INPUT.roll, clamp1(-K_BANK * bank - K_ROLLRATE * v.get(FDM.p)));

    if (this.phase === 'roll' || this.phase === 'rotate') {
      // Centre line with the pedals: nosewheel steering at low speed, rudder as it gains authority.
      const hdgErr = wrap180(v.get(FDM.headingTrue) - s.courseTrueDeg);
      v.set(INPUT.yaw, clamp1(-(K_CROSS * cross + K_HDG * hdgErr + K_YAWRATE * v.get(FDM.r))));
      if (onGround) log.maxGroundDeviationM = Math.max(log.maxGroundDeviationM, Math.abs(cross));
    } else {
      v.set(INPUT.yaw, 0);
    }

    if (this.phase === 'roll') {
      v.set(INPUT.pitch, 0);
      this.pitchTarget = pitch;
      if (ias >= s.vrKt) {
        this.phase = 'rotate';
        log.rotateIasKt = ias;
      }
      return;
    }

    // rotate / climb: PI+D pitch attitude hold on a rate-limited target.
    this.pitchTarget = Math.min(s.pitchDeg, this.pitchTarget + s.rotateRateDegS * dt);
    const err = this.pitchTarget - pitch;
    if (pitch > log.maxPitchDeg) log.maxPitchDeg = pitch;
    this.pitchInt = Math.max(-PITCH_I_LIMIT, Math.min(PITCH_I_LIMIT, this.pitchInt + K_PITCH_I * err * dt));
    v.set(INPUT.pitch, clamp1(K_PITCH * err + this.pitchInt - K_PITCHRATE * v.get(FDM.q)));

    if (this.phase === 'rotate') {
      this.airborneS = onGround ? 0 : this.airborneS + dt;
      if (this.airborneS >= LIFTOFF_CONFIRM_S) {
        this.phase = 'climb';
        log.liftoffIasKt = ias;
        log.liftoffDistM = along;
        log.liftoffTimeS = log.elapsedS;
      }
      return;
    }

    // climb
    log.maxAirBankDeg = Math.max(log.maxAirBankDeg, Math.abs(bank));
    if (s.gearUp && !log.gearUpCommanded && v.get(FDM.altAgl) > 50 && v.get(FDM.vs) > 300) {
      log.gearUpCommanded = true;
      this.events?.emit(INPUT_EVENTS.gearToggle);
    }
  }
}
