/**
 * Mechanical gyro instrument models (pure, allocation-free, deterministic
 * with a seed): rotor spin-up/down, vacuum attitude gyro (erection, drift,
 * tumbling, rest attitude with the rotor stopped), directional gyro
 * (precession / earth-rate drift, tumbling, caging) and the electric turn
 * coordinator gyro (canted 30 deg, rate + roll sensing, OFF flag).
 *
 * Sources:
 *  - FAA-H-8083-25B PHAK ch.8 "Flight Instruments": attitude indicator bank
 *    limits usually 100-110 deg and pitch limits 60-70 deg, beyond which it
 *    tumbles; heading indicator drifts from precession (friction) and earth
 *    rotation and must be reset to the magnetic compass (error up to
 *    ~15 deg per hour); turn coordinator gimbal canted up 30 deg so it
 *    senses roll as well as yaw; electric TC with power-failure flag.
 *  - Cessna 172S POH Rev 4 §7 "Vacuum System and Instruments": desired
 *    suction 4.5-5.5 inHg; outside that range the attitude and directional
 *    indicators should not be considered reliable.
 * Rates and time constants without a public source are marked EST.
 */
import { DEG2RAD, RAD2DEG, Prng, clamp, smoothstep, wrap180, wrap360 } from '../../../core/math';

// ------------------------------------------------------------------ rotor

/**
 * Gyro rotor speed as a fraction of rated rpm, first-order toward the
 * drive's steady-state speed with separate spin-up and coast-down time
 * constants.
 */
export class GyroRotor {
  speed = 0;
  constructor(
    public spinUpTau: number,
    public spinDownTau: number,
  ) {}

  update(driveSpeed: number, dt: number): number {
    const tau = driveSpeed > this.speed ? this.spinUpTau : this.spinDownTau;
    this.speed += (driveSpeed - this.speed) * (1 - Math.exp(-dt / tau));
    return this.speed;
  }
}

/** Nominal instrument suction (inHg): middle of the 172S 4.5-5.5 inHg green range (POH §7). */
export const RATED_SUCTION_INHG = 5.0;

/**
 * Steady-state rotor speed fraction for a given suction: an air-driven
 * turbine rotor balances drive torque (proportional to the pressure
 * differential) against windage (proportional to speed squared), so speed
 * goes as sqrt(suction / rated).
 */
export function vacuumRotorDrive(suctionInHg: number, ratedInHg = RATED_SUCTION_INHG): number {
  return suctionInHg > 0 ? Math.sqrt(suctionInHg / ratedInHg) : 0;
}

// ------------------------------------------------------------------ attitude gyro

export interface AttitudeGyroOptions {
  /** Pitch/bank at which the gyro tumbles (PHAK: 60-70 / 100-110 deg). */
  pitchLimitDeg?: number;
  bankLimitDeg?: number;
  /** Non-tumbling instrument (limits ignored). */
  nonTumbling?: boolean;
  /**
   * Erection rate (deg/min) at rated speed while the gyro is within
   * `cutoutDeg` of the apparent vertical. EST 6 deg/min.
   */
  erectionDegMin?: number;
  /**
   * Beyond this disagreement with the apparent vertical (turns, strong
   * accelerations) the erection torque drops to `cutoutFactor`. EST 10 deg /
   * 0.3: gives the few-degree bank/pitch errors seen after a 180-360 deg
   * turn or a takeoff acceleration.
   */
  cutoutDeg?: number;
  cutoutFactor?: number;
  /** Erection rate while re-erecting after a tumble or a cold start (deg/min). EST 25: ~6-8 min to recover. */
  recoveryDegMin?: number;
  /** Spin-up / coast-down time constants (s). EST 60 / 180 (gyro "up to speed" in ~3 min, coasts several minutes). */
  spinUpTau?: number;
  spinDownTau?: number;
  /** Random wander at rated speed (deg / sqrt(min)). EST 0.3. */
  wanderDeg?: number;
  /** Attitude the horizon falls to with the rotor stopped (deg). EST: nose-down, banked. */
  restPitchDeg?: number;
  restBankDeg?: number;
  seed?: number;
}

/**
 * Vacuum attitude gyro. `update()` takes true attitude, specific force and
 * the rotor drive and leaves the indicated attitude in `pitch`/`bank`.
 *
 * Model: indicated = true + error. The error is held (rigidity) while the
 * rotor turns fast; the pendulous-vane erection system drives the
 * indication toward the APPARENT vertical (the specific-force direction) at
 * a limited rate, which reproduces the classic turn and acceleration
 * errors; friction wander grows as the rotor slows; below ~50 % speed the
 * gimbals lose rigidity, the indication stops following the aircraft and
 * sags toward the rest attitude. Exceeding a gimbal limit tumbles the gyro
 * (large random error plus a decaying wobble); it then re-erects at the
 * recovery rate (also used after a cold start).
 */
export class AttitudeGyro {
  readonly rotor: GyroRotor;
  pitch = 0;
  bank = 0;
  errPitch = 0;
  errBank = 0;
  tumbled = false;
  /** True while re-erecting after a tumble or a cold start. */
  erecting = false;
  private wobble = 0;
  private wobblePhase = 0;
  private readonly rng: Prng;
  private readonly o: Required<AttitudeGyroOptions>;
  private initialized = false;

  constructor(opts: AttitudeGyroOptions = {}) {
    this.o = {
      pitchLimitDeg: opts.pitchLimitDeg ?? 65,
      bankLimitDeg: opts.bankLimitDeg ?? 105,
      nonTumbling: opts.nonTumbling ?? false,
      erectionDegMin: opts.erectionDegMin ?? 6,
      cutoutDeg: opts.cutoutDeg ?? 10,
      cutoutFactor: opts.cutoutFactor ?? 0.3,
      recoveryDegMin: opts.recoveryDegMin ?? 25,
      spinUpTau: opts.spinUpTau ?? 60,
      spinDownTau: opts.spinDownTau ?? 180,
      wanderDeg: opts.wanderDeg ?? 0.3,
      restPitchDeg: opts.restPitchDeg ?? -12,
      restBankDeg: opts.restBankDeg ?? 22,
      seed: opts.seed ?? 7,
    };
    this.rotor = new GyroRotor(this.o.spinUpTau, this.o.spinDownTau);
    this.rng = new Prng(this.o.seed);
  }

  /** Puts the gyro at rated speed and erected (flying start / state presets). */
  setSpunUp(truePitch: number, trueBank: number): void {
    this.rotor.speed = 1;
    this.errPitch = 0;
    this.errBank = 0;
    this.tumbled = false;
    this.erecting = false;
    this.wobble = 0;
    this.pitch = truePitch;
    this.bank = trueBank;
    this.initialized = true;
  }

  /** Cold, stopped gyro resting at its rest attitude. */
  setStopped(truePitch: number, trueBank: number): void {
    this.rotor.speed = 0;
    this.pitch = this.o.restPitchDeg;
    this.bank = this.o.restBankDeg;
    this.errPitch = this.pitch - truePitch;
    this.errBank = wrap180(this.bank - trueBank);
    this.erecting = true;
    this.initialized = true;
  }

  /**
   * @param truePitch/trueBank aircraft attitude (deg)
   * @param nx/ny/nz specific force in g (fdm.nx/ny/nz conventions: nz = +1 level)
   * @param driveSpeed steady-state rotor speed fraction (vacuumRotorDrive(suction))
   */
  update(truePitch: number, trueBank: number, nx: number, ny: number, nz: number, driveSpeed: number, dt: number): void {
    if (!(dt > 0)) return;
    if (!this.initialized) this.setStopped(truePitch, trueBank);
    const o = this.o;
    const w = this.rotor.update(driveSpeed, dt);
    const rigid = smoothstep(0.25, 0.55, w);

    // Tumble when a gimbal hits its stop while the rotor turns.
    if (!o.nonTumbling && w > 0.3 && !this.tumbled && (Math.abs(truePitch) > o.pitchLimitDeg || Math.abs(trueBank) > o.bankLimitDeg)) {
      this.tumbled = true;
      this.erecting = true;
      this.errPitch = clamp(this.errPitch + this.rng.range(-45, 45), -80, 80);
      this.errBank = wrap180(this.errBank + this.rng.range(90, 270));
      this.wobble = 25;
    }

    // Rigid part: error held, then erection + wander.
    let ip = truePitch + this.errPitch;
    let ib = wrap180(trueBank + this.errBank);
    const f = Math.hypot(nx, ny, nz);
    if (f > 0.3 && w > 0.2) {
      const apPitch = Math.asin(clamp(nx / f, -1, 1)) * RAD2DEG;
      const apBank = Math.atan2(-ny, nz) * RAD2DEG;
      const dP = apPitch - ip;
      const dB = wrap180(apBank - ib);
      const wf = clamp(w, 0, 1.1);
      ip += this.erectStep(dP, wf, dt);
      ib = wrap180(ib + this.erectStep(dB, wf, dt));
      if (this.erecting && Math.abs(dP) < 1.5 && Math.abs(dB) < 1.5 && this.wobble < 0.5 && w > 0.8) {
        this.erecting = false;
        this.tumbled = false;
      }
    }
    // Friction wander grows as the rotor slows (random walk, deg/sqrt(min)).
    const sigma = o.wanderDeg * (1 + 4 * clamp(1 - w, 0, 1)) * Math.sqrt(dt / 60);
    ip += this.rng.gaussian() * sigma;
    ib += this.rng.gaussian() * sigma;
    // Without rigidity the indication stops following the aircraft and sags to rest.
    if (rigid < 1) {
      const sag = (1 - rigid) * Math.min(1, dt * 0.5);
      const heldP = this.pitch + (o.restPitchDeg - this.pitch) * sag;
      const heldB = this.bank + wrap180(o.restBankDeg - this.bank) * sag;
      ip = rigid * ip + (1 - rigid) * heldP;
      ib = wrap180(heldB + rigid * wrap180(ib - heldB));
      if (rigid < 0.5) this.erecting = true;
    }
    this.errPitch = clamp(ip - truePitch, -90, 90);
    this.errBank = wrap180(ib - trueBank);
    // Tumble wobble (decays over ~30 s).
    this.wobblePhase += dt * 2 * Math.PI * 0.3;
    this.wobble *= Math.exp(-dt / 12);
    const wob = this.wobble * Math.sin(this.wobblePhase);
    this.pitch = clamp(truePitch + this.errPitch + wob * 0.4, -90, 90);
    this.bank = wrap180(trueBank + this.errBank + wob);
  }

  /** Erection correction (deg) toward the apparent vertical for disagreement `d` (deg). */
  private erectStep(d: number, w: number, dt: number): number {
    const o = this.o;
    const ad = Math.abs(d);
    let rateDegMin: number;
    if (this.erecting) rateDegMin = o.recoveryDegMin;
    else if (ad > o.cutoutDeg) rateDegMin = o.erectionDegMin * o.cutoutFactor;
    else rateDegMin = o.erectionDegMin * clamp(ad / 2, 0.15, 1);
    const step = (rateDegMin / 60) * w * dt;
    return clamp(d, -step, step);
  }
}

// ------------------------------------------------------------------ directional gyro

/** Apparent drift of a free directional gyro from earth rotation: 15.04 deg/h x sin(latitude). */
export const EARTH_RATE_DEG_H = 15.041;

export interface DirectionalGyroOptions {
  /** Friction precession bias magnitude range (deg/h); a random bias in +/- this range per spin-up. EST 3..8. */
  driftMinDegH?: number;
  driftMaxDegH?: number;
  /** Latitude (deg) whose earth-rate the instrument's latitude nut compensates (NaN = none). EST NaN. */
  compensatedLatDeg?: number;
  /** Gimbal limit (deg pitch/bank) beyond which the DG tumbles. EST 85 (modern DG); older DGs ~55. */
  tumbleLimitDeg?: number;
  spinUpTau?: number;
  spinDownTau?: number;
  seed?: number;
}

/**
 * Directional gyro (heading indicator). Indicated = true heading + error.
 * The error grows from friction precession (bias scaled by 1/rotor speed)
 * and apparent earth-rate drift; with a slow rotor the card stops
 * following the aircraft; tumbling spins the card. `adjust()` is the push-
 * and-turn knob (card set to the magnetic compass).
 */
export class DirectionalGyro {
  readonly rotor: GyroRotor;
  heading = 0;
  err = 0;
  tumbled = false;
  private bias = 0;
  private spin = 0;
  private readonly rng: Prng;
  private readonly o: Required<DirectionalGyroOptions>;
  private initialized = false;
  private lastSpeed = 0;

  constructor(opts: DirectionalGyroOptions = {}) {
    this.o = {
      driftMinDegH: opts.driftMinDegH ?? 3,
      driftMaxDegH: opts.driftMaxDegH ?? 8,
      compensatedLatDeg: opts.compensatedLatDeg ?? NaN,
      tumbleLimitDeg: opts.tumbleLimitDeg ?? 85,
      spinUpTau: opts.spinUpTau ?? 60,
      spinDownTau: opts.spinDownTau ?? 180,
      seed: opts.seed ?? 11,
    };
    this.rotor = new GyroRotor(this.o.spinUpTau, this.o.spinDownTau);
    this.rng = new Prng(this.o.seed);
    this.newBias();
  }

  /** Current friction bias (deg/h, sign = direction). */
  get biasDegH(): number {
    return this.bias;
  }

  setSpunUp(trueHeading: number, errDeg = 0): void {
    this.rotor.speed = 1;
    this.err = errDeg;
    this.tumbled = false;
    this.spin = 0;
    this.heading = wrap360(trueHeading + errDeg);
    this.initialized = true;
  }

  setStopped(trueHeading: number): void {
    this.rotor.speed = 0;
    this.err = this.rng.range(-40, 40);
    this.heading = wrap360(trueHeading + this.err);
    this.initialized = true;
  }

  /** Pilot adjustment knob: rotates the card by `deltaDeg`. Also cages (clears a tumble). */
  adjust(deltaDeg: number): void {
    this.err = wrap180(this.err + deltaDeg);
    this.heading = wrap360(this.heading + deltaDeg);
    if (this.tumbled) {
      this.tumbled = false;
      this.spin = 0;
    }
  }

  update(trueHeading: number, pitch: number, bank: number, latDeg: number, driveSpeed: number, dt: number): void {
    if (!(dt > 0)) return;
    if (!this.initialized) this.setStopped(trueHeading);
    const o = this.o;
    const w = this.rotor.update(driveSpeed, dt);
    if (w > 0.9 && this.lastSpeed <= 0.9) this.newBias();
    this.lastSpeed = w;
    const rigid = smoothstep(0.25, 0.55, w);
    if (!this.tumbled && w > 0.3 && (Math.abs(pitch) > o.tumbleLimitDeg || Math.abs(bank) > o.tumbleLimitDeg)) {
      this.tumbled = true;
      this.spin = this.rng.range(-1, 1) > 0 ? 120 : -120;
    }
    // Drift: friction bias (grows as the rotor slows) + uncompensated earth rate.
    const earth = EARTH_RATE_DEG_H * (Math.sin(latDeg * DEG2RAD) - (Number.isNaN(o.compensatedLatDeg) ? 0 : Math.sin(o.compensatedLatDeg * DEG2RAD)));
    const driftDegS = ((this.bias / Math.max(0.15, w)) * rigid + earth * rigid) / 3600;
    let ind = wrap360(trueHeading + this.err + driftDegS * dt);
    if (this.tumbled) {
      ind = wrap360(ind + this.spin * dt);
      this.spin *= Math.exp(-dt / 20);
    }
    if (rigid < 1) {
      // Card no longer held in space: it turns with the case.
      ind = wrap360(this.heading + rigid * wrap180(ind - this.heading));
    }
    this.err = wrap180(ind - trueHeading);
    this.heading = ind;
  }

  private newBias(): void {
    const mag = this.rng.range(this.o.driftMinDegH, this.o.driftMaxDegH);
    this.bias = this.rng.next() < 0.5 ? -mag : mag;
  }
}

// ------------------------------------------------------------------ turn coordinator

export interface TurnGyroOptions {
  /** Symbol deflection (deg) at a standard-rate turn (the L/R index marks). EST 17. */
  standardMarkDeg?: number;
  /** Gimbal cant (deg): PHAK 30 deg. */
  cantDeg?: number;
  /** Bank used to calibrate standard rate (deg). EST 15 (light-aircraft standard-rate bank ~ TAS/10 + 7). */
  calibrationBankDeg?: number;
  /** Supply voltage below which the OFF flag shows and the motor stops. EST 18 V (28 V system). */
  minVolts?: number;
  spinUpTau?: number;
  spinDownTau?: number;
  /** Symbol dynamics (dashpot-damped gimbal). EST omega 7 rad/s, zeta 0.75. */
  omega?: number;
  zeta?: number;
}

/**
 * Electric turn coordinator gyro. Senses (p sin(cant) + r cos(cant)) scaled
 * by rotor speed (precession torque is proportional to angular momentum),
 * calibrated so a coordinated standard-rate turn places the symbol wing on
 * the L/R mark. `symbolDeg` + = right wing down (right turn). `flag` true =
 * OFF flag in view.
 */
export class TurnGyro {
  readonly rotor: GyroRotor;
  symbolDeg = 0;
  flag = true;
  private rate = 0;
  private readonly o: Required<TurnGyroOptions>;
  private readonly sinCant: number;
  private readonly cosCant: number;
  private readonly signalStd: number;

  constructor(opts: TurnGyroOptions = {}) {
    this.o = {
      standardMarkDeg: opts.standardMarkDeg ?? 17,
      cantDeg: opts.cantDeg ?? 30,
      calibrationBankDeg: opts.calibrationBankDeg ?? 15,
      minVolts: opts.minVolts ?? 18,
      spinUpTau: opts.spinUpTau ?? 15,
      spinDownTau: opts.spinDownTau ?? 90,
      omega: opts.omega ?? 7,
      zeta: opts.zeta ?? 0.75,
    };
    this.rotor = new GyroRotor(this.o.spinUpTau, this.o.spinDownTau);
    this.sinCant = Math.sin(this.o.cantDeg * DEG2RAD);
    this.cosCant = Math.cos(this.o.cantDeg * DEG2RAD);
    // Standard rate 3 deg/s in a coordinated turn at the calibration bank: p = 0, r = 3 cos(bank).
    this.signalStd = 3 * Math.cos(this.o.calibrationBankDeg * DEG2RAD) * this.cosCant;
  }

  /** Symbol target (deg) for body rates (deg/s) at rotor speed `w`. Pure. */
  target(pDps: number, rDps: number, w: number): number {
    const signal = (pDps * this.sinCant + rDps * this.cosCant) * clamp(w, 0, 1.05);
    return clamp((signal / this.signalStd) * this.o.standardMarkDeg, -this.o.standardMarkDeg * 1.9, this.o.standardMarkDeg * 1.9);
  }

  setSpunUp(): void {
    this.rotor.speed = 1;
  }

  update(pDps: number, rDps: number, volts: number, dt: number): void {
    if (!(dt > 0)) return;
    const powered = volts >= this.o.minVolts;
    this.flag = !powered;
    const w = this.rotor.update(powered ? 1 : 0, dt);
    const tgt = this.target(pDps, rDps, w);
    // Damped gimbal (semi-implicit, sub-stepped).
    const om = this.o.omega;
    const n = Math.max(1, Math.ceil((om * dt) / 0.2));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.rate += (om * om * (tgt - this.symbolDeg) - 2 * this.o.zeta * om * this.rate) * h;
      this.symbolDeg += this.rate * h;
    }
  }
}
