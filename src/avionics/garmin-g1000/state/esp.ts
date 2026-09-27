/**
 * Garmin ESP (Electronic Stability & Protection) and USP (Underspeed
 * Protection) for the 172S NXi (PG 190-02177-02 §8.11, §7.5):
 *
 * ESP works only when (§8.11): in flight (GPS ground speed > 30 kt or TAS >
 * 50 kt), above 200 ft AGL (GPS altitude, when available), autopilot not
 * engaged, and within the maximum engagement limits (pitch ±50°, bank ±75°).
 * It is enabled at every power-on and can be disabled on Aux - System Setup 2
 * (ESP OFF advisory).
 *
 *  - Roll: engages beyond 45° (roll limit indicators at ±45° on the roll
 *    scale), force grows from 30° to 75°, disengages below 30° (the
 *    indicator moves to 30° while engaged), none beyond 75°.
 *  - Pitch (C-172, Tables 8-5 / 8-6): nose up engage 16°, maximum force 20°,
 *    disengage 14°; nose down engage -16°, maximum -20°, disengage -14°;
 *    force up to the ±50° limit.
 *  - High airspeed: above Vne, force to raise the nose (no upper limit).
 *  - Low airspeed (Model 172): below 55 KIAS for 1 s, nose-down force until
 *    above 55 KIAS; disabled with LOI (no GPS integrity).
 *  - ESP engaged for more than 10 s (cumulative) of a 20 s interval engages
 *    the autopilot in LVL / LVL with the aural "Engaging Autopilot" — except
 *    for low airspeed protection.
 *  - Holding CWS or AP DISC interrupts ESP.
 *
 * Output: servo increments `g1k.esp.servo_pitch` / `g1k.esp.servo_roll`
 * (normalized surface, + nose up / right roll) that the aircraft adds to its
 * flight controls (MechanicalFlightControls `addVars`), exactly like the AP
 * servos; limited to the GSA 81 slip-clutch authority (EST, config).
 *
 * USP (§7.5, AP engaged): MINSPD (yellow) at the MINSPD speed (C-172: 60
 * KIAS); below the activation speed in the non-altitude-critical modes (VS,
 * VNAV, PIT, LVL) the red UNDERSPEED PROTECT ACTIVE annunciation shows and
 * the AP pitches down; in the altitude-critical modes (ALT, GS, GP, GA, FLC)
 * activation is at the stall warning. A single aural "AIRSPEED" alert
 * sounds. SCOPE: the real AFCS changes the vertical mode to armed; here the
 * pitch / VS reference is stepped nose-down (NOSE DN, 2 steps/s) while USP
 * is active, then the reference is left for the pilot. USP ACTIVE is also a
 * CAS warning on the NXi (Appendix A). Like ESP, USP works only in flight
 * (GPS ground speed > 30 kt or TAS > 50 kt): nothing fires during the POH
 * on-ground autopilot check (172SPHBUS-02 Before Takeoff items 13-15).
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { AudioApi } from '../../../core/SimContext';
import { ADC, AP, GPS } from '../../../core/vars';
import type { EspConfig } from '../config';
import { G1K } from '../vars';

const PITCH1 = ADC.pitch(1);
const BANK1 = ADC.bank(1);
const IAS1 = ADC.ias(1);
const TAS1 = ADC.tas(1);
const AHRS_VALID1 = ADC.ahrsValid(1);
const ADC_VALID1 = ADC.valid(1);
/** Altitude-critical AP modes for USP (PG §7.5). */
const ALT_CRITICAL = new Set(['ALT', 'GS', 'GP', 'GA', 'FLC']);
/** USP nose-down reference steps per second (EST). */
const USP_STEP_S = 0.5;
/** Servo slew toward the commanded ESP force (normalized / s, EST: gentle force build-up). */
const SERVO_RATE = 0.3;

/** Linear force fraction between `from` (0) and `to` (1). */
function ramp(x: number, from: number, to: number): number {
  if (to === from) return x >= to ? 1 : 0;
  const t = (x - from) / (to - from);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export class Esp {
  /** Roll / pitch ESP engaged (hysteresis state). */
  rollEngaged = false;
  pitchUpEngaged = false;
  pitchDnEngaged = false;
  highSpeed = false;
  lowSpeed = false;
  private lowSpeedS = 0;
  /** Seconds of engagement inside the rolling 20 s window (1 s buckets). */
  private readonly window = new Float64Array(20);
  private bucketT = 0;
  private bucketI = 0;
  private servoP = 0;
  private servoR = 0;
  private uspPhase = 0; // 0 none, 1 MINSPD, 2 active
  private uspStepT = 0;
  private interrupt = false;

  constructor(
    private readonly vars: SimVars,
    private readonly events: EventBus | null,
    private readonly audio: AudioApi | null,
    readonly cfg: EspConfig,
  ) {
    vars.set(G1K.espEnabled, 1); // "ESP is automatically enabled on system power on"
    vars.set(G1K.espRollLimit, cfg.rollEngageDeg);
  }

  /** CWS / AP DISC held (interrupts ESP while pressed). */
  setInterrupt(held: boolean): void {
    this.interrupt = held;
  }

  /** Aux - System Setup 2 "Stability & Protection" Enabled / Disabled. */
  setEnabled(on: boolean): void {
    this.vars.set(G1K.espEnabled, on ? 1 : 0);
  }

  get enabled(): boolean {
    return this.vars.get(G1K.espEnabled) >= 0.5;
  }

  /** Re-enables ESP at a power cycle of the system (PG: enabled on every power-on). */
  powerOn(): void {
    this.setEnabled(true);
  }

  /**
   * `available`: GIA 1 (AFCS computer), ADAHRS and the servos up.
   * `aglFt`: height above terrain from GPS (NaN when unavailable).
   * `stallWarning`: stall warning active (USP in altitude-critical modes).
   */
  update(dt: number, available: boolean, aglFt: number, stallWarning: boolean): void {
    const v = this.vars;
    const c = this.cfg;
    const apOn = v.get(AP.engaged) >= 0.5;
    const pitch = v.get(PITCH1);
    const bank = v.get(BANK1);
    const ias = v.get(IAS1);
    const attOk = v.get(AHRS_VALID1, 1) >= 0.5;
    const adcOk = v.get(ADC_VALID1, 1) >= 0.5;
    const gpsOk = v.get(GPS.valid) >= 0.5;
    const inFlight = (gpsOk && v.get(GPS.gs) > 30) || (adcOk && v.get(TAS1) > 50);
    // "above 200 feet AGL (GPS Altitude), if GPS altitude is available".
    const highEnough = !gpsOk || !Number.isFinite(aglFt) || aglFt > c.minAglFt;
    const withinLimits = Math.abs(pitch) <= c.pitchLimitDeg && Math.abs(bank) <= c.rollMaxDeg;
    const active = available && this.enabled && attOk && inFlight && highEnough && !apOn && !this.interrupt;

    let pCmd = 0;
    let rCmd = 0;
    if (active && withinLimits) {
      // Roll.
      const ab = Math.abs(bank);
      if (!this.rollEngaged && ab > c.rollEngageDeg) this.rollEngaged = true;
      else if (this.rollEngaged && ab < c.rollDisengageDeg) this.rollEngaged = false;
      if (this.rollEngaged) rCmd = -Math.sign(bank) * c.maxRollServo * ramp(ab, c.rollDisengageDeg, c.rollMaxDeg);
      // Pitch.
      if (!this.pitchUpEngaged && pitch > c.pitchUpEngageDeg) this.pitchUpEngaged = true;
      else if (this.pitchUpEngaged && pitch < c.pitchUpDisengageDeg) this.pitchUpEngaged = false;
      if (!this.pitchDnEngaged && pitch < c.pitchDnEngageDeg) this.pitchDnEngaged = true;
      else if (this.pitchDnEngaged && pitch > c.pitchDnDisengageDeg) this.pitchDnEngaged = false;
      if (this.pitchUpEngaged) pCmd = -c.maxPitchServo * ramp(pitch, c.pitchUpDisengageDeg, c.pitchUpMaxDeg);
      else if (this.pitchDnEngaged) pCmd = c.maxPitchServo * ramp(-pitch, -c.pitchDnDisengageDeg, -c.pitchDnMaxDeg);
    } else {
      this.rollEngaged = false;
      this.pitchUpEngaged = false;
      this.pitchDnEngaged = false;
    }
    // High airspeed: no maximum engagement limit.
    this.highSpeed = active && adcOk && ias > c.vneKt;
    if (this.highSpeed) pCmd = Math.max(pCmd, c.maxPitchServo * ramp(ias, c.vneKt, c.vneKt + 15));
    // Low airspeed (172): below 55 KIAS for 1 s; disabled without GPS integrity (LOI).
    const slow = active && adcOk && gpsOk && ias < c.lowSpeedKt;
    this.lowSpeedS = slow ? this.lowSpeedS + dt : 0;
    this.lowSpeed = slow && this.lowSpeedS >= c.lowSpeedDelayS;
    if (this.lowSpeed) pCmd = Math.min(pCmd, -c.maxPitchServo * ramp(c.lowSpeedKt - ias, 0, 10));

    // Servo slew.
    this.servoP += clampAbs(pCmd - this.servoP, SERVO_RATE * dt);
    this.servoR += clampAbs(rCmd - this.servoR, SERVO_RATE * dt);
    v.set(G1K.espServoPitch, this.servoP);
    v.set(G1K.espServoRoll, this.servoR);
    const attitudeEngaged = this.rollEngaged || this.pitchUpEngaged || this.pitchDnEngaged || this.highSpeed;
    const engaged = attitudeEngaged || this.lowSpeed;
    v.set(G1K.espEngaged, engaged ? 1 : 0);
    // Roll limit indicators: 45° before engagement, 30° (disengage point) while engaged; hidden when ESP is inactive.
    v.set(G1K.espRollLimit, !active ? 0 : this.rollEngaged ? c.rollDisengageDeg : c.rollEngageDeg);

    // Automatic LVL: attitude/high-speed engagement > 10 s of the last 20 s (not for low airspeed).
    this.bucketT += dt;
    if (this.bucketT >= 1) {
      this.bucketT -= 1;
      this.bucketI = (this.bucketI + 1) % this.window.length;
      this.window[this.bucketI] = 0;
    }
    if (attitudeEngaged && !this.lowSpeed) this.window[this.bucketI] += dt;
    let sum = 0;
    for (let i = 0; i < this.window.length; i++) sum += this.window[i];
    if (active && sum > c.lvlAfterS && !this.lowSpeed) {
      this.window.fill(0);
      this.audio?.callout('Engaging Autopilot', 5);
      this.events?.emit('ap.lvl');
    }

    // USP is an in-flight protection like the rest of ESP (PG §7.5 / §8.11): on the ground (IAS 0,
    // POH 172SPHBUS-02 Before Takeoff items 13-15 AP engage / overpower / A/P TRIM DISC check) the
    // real airplane gives no MINSPD, no USP ACTIVE and no "AIRSPEED" aural.
    this.updateUsp(dt, available && apOn && inFlight, ias, stallWarning);
  }

  /** `apOn`: AP engaged, AFCS available and in flight (same in-flight test as ESP). */
  private updateUsp(dt: number, apOn: boolean, ias: number, stallWarning: boolean): void {
    const v = this.vars;
    const u = this.cfg.usp;
    const vert = v.getString(AP.verticalActive);
    const altCritical = ALT_CRITICAL.has(vert);
    let phase = 0;
    if (apOn && this.enabled) {
      const minspd = ias < u.minspdKt;
      const activate = altCritical ? stallWarning : ias < u.activateKt;
      phase = activate ? 2 : minspd ? 1 : 0;
    }
    if (phase > 0 && this.uspPhase === 0) this.audio?.callout('Airspeed', 4); // single aural "AIRSPEED"
    this.uspPhase = phase;
    v.set(G1K.minSpd, phase >= 1 ? 1 : 0);
    v.set(G1K.uspActive, phase === 2 ? 1 : 0);
    if (phase === 2 && (vert === 'PIT' || vert === 'VS' || vert === 'LVL' || vert === 'VPTH' || altCritical)) {
      this.uspStepT += dt;
      if (this.uspStepT >= USP_STEP_S) {
        this.uspStepT = 0;
        this.events?.emit('ap.dn', { steps: 1 });
      }
    } else this.uspStepT = 0;
  }

  reset(): void {
    this.servoP = this.servoR = 0;
    this.rollEngaged = this.pitchUpEngaged = this.pitchDnEngaged = false;
    this.window.fill(0);
    this.vars.set(G1K.espServoPitch, 0);
    this.vars.set(G1K.espServoRoll, 0);
  }
}

function clampAbs(x: number, lim: number): number {
  return x > lim ? lim : x < -lim ? -lim : x;
}
