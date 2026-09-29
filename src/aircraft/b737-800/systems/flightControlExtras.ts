/**
 * Boeing 737-800 FCC pitch augmentation the generic blocks do not cover
 * (FCOM 9.20 "Flight controls"; b737.org.uk "Flight Controls"):
 *
 *  - Speed Trim System (STS): during manual flight at low weight / aft CG /
 *    high thrust, the FCC trims the stabilizer through the AUTOPILOT trim
 *    servo "in a direction opposite the speed change" so the column force
 *    pushes the airplane back to the trimmed speed: speed above the trimmed
 *    speed trims nose UP, speed below trims nose DOWN (the familiar
 *    nose-down trim wheel motion accelerating after take-off). Conditions
 *    (FCOM 9.20 / b737.org.uk): autopilot not engaged, 10 s after take-off,
 *    5 s after a manual trim input, airspeed roughly 100 kt to Mach 0.68
 *    (EST band 100-300 KIAS), FCC powered, AUTOPILOT stab trim cutout at
 *    NORMAL, not failed (fail.b738.speed_trim -> SPEED TRIM FAIL). The trim
 *    wheels visibly rotate (the autopilot TrimAxis moves trim.pitch_units).
 *    EST law: the trimmed-speed reference follows IAS with a long time
 *    constant; deviations beyond a 5 kt deadband are trimmed at the
 *    autopilot trim rate with a gain of 0.02 units/kt (no public gain).
 *  - Mach trim: above M0.615 the FCCs adjust the ELEVATOR with respect to
 *    the stabilizer to compensate for Mach tuck; fully automatic, no wheel
 *    motion (FCOM 9.20: "Mach Trim ... adjusts the elevators with respect to
 *    the stabilizer ... operates above Mach .615"). Modelled as a nose-up
 *    elevator bias (`ac.b738.mach_trim_elev`, an addVar of the pitch
 *    channel), EST 0 at M0.615 to +0.035 normalized elevator at Mmo 0.82.
 *    Disabled by fail.b738.mach_trim or loss of both FCCs (MACH TRIM FAIL).
 *
 * No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import type { TrimAxis } from '../../../systems/flightcontrols';
import { B738 } from '../vars';

/** STS envelope and law (EST where no public figure exists; see the header). */
export const STS = {
  minKt: 100,
  maxKt: 300, // EST upper end (FCOM gives Mach 0.68 class)
  afterLiftoffS: 10, // FCOM 9.20: operates 10 s after take-off
  afterTrimS: 5, // and 5 s after release of the trim switches
  deadbandKt: 5, // EST
  gainUnitsPerKt: 0.02, // EST
  refTauS: 40, // EST trimmed-speed reference time constant
} as const;

/** Mach trim schedule: normalized nose-up elevator vs Mach (FCOM 9.20 onset M0.615; magnitude EST). */
export function machTrimElev(mach: number): number {
  if (mach <= 0.615) return 0;
  return Math.min(0.035, ((mach - 0.615) / (0.82 - 0.615)) * 0.035);
}

export class B738FlightControlExtras implements Subsystem {
  readonly name = 'b738.fcs_extras';
  private refKt = NaN;
  private airT = 0;
  private trimHoldT = 0;
  /** STS stabilizer offset currently applied (units, + nose up). */
  private applied = 0;

  constructor(
    private readonly v: SimVars,
    private readonly stab: TrimAxis,
  ) {}

  update(dt: number): void {
    const v = this.v;
    const air = v.get('gear.air_ground') === 0;
    this.airT = air ? this.airT + dt : 0;
    const ias = v.get('adc1.ias_kt');
    const adcOk = v.get('adc1.valid') !== 0;
    const fccPwr = v.get('elec.fcc_a_powered') !== 0 || v.get('elec.fcc_b_powered') !== 0;

    // ---------------- Speed Trim System
    const manualTrim = v.get('input.pitch_trim_rate') !== 0 || v.get(B738.yokeTrim(1)) !== 0 || v.get(B738.yokeTrim(2)) !== 0;
    this.trimHoldT = manualTrim ? STS.afterTrimS : Math.max(0, this.trimHoldT - dt);
    const stsOk =
      fccPwr &&
      adcOk &&
      air &&
      this.airT >= STS.afterLiftoffS &&
      v.get('ap.engaged') === 0 &&
      v.get(B738.stabCutoutAp) !== 0 &&
      v.get('fail.b738.speed_trim') === 0 &&
      ias >= STS.minKt &&
      ias <= STS.maxKt &&
      this.trimHoldT <= 0;
    if (Number.isNaN(this.refKt) || manualTrim || !air) this.refKt = ias;
    // The trimmed-speed reference follows IAS slowly, so STS opposes short-term speed changes.
    this.refKt += ((ias - this.refKt) * dt) / STS.refTauS;
    let cmd = 0;
    if (!stsOk) this.applied = 0;
    else {
      const err = ias - this.refKt; // + = faster than trimmed -> trim nose up (FCOM 9.20 "opposite the speed change")
      const target = Math.abs(err) <= STS.deadbandKt ? 0 : STS.gainUnitsPerKt * Math.sign(err) * (Math.abs(err) - STS.deadbandKt);
      // Move the applied STS offset toward the target at the autopilot trim rate (FCOM 9.20 rates, data.ts STAB).
      const rate = v.get('surf.flaps_deg') > 0.5 ? 0.27 : 0.09;
      const d = target - this.applied;
      const step = Math.abs(d) <= rate * dt ? d : Math.sign(d) * rate * dt;
      if (step !== 0) {
        this.stab.setPosition(this.stab.position + step);
        this.applied += step;
        cmd = Math.sign(step);
      }
    }
    v.set(B738.stsCmd, cmd);

    // ---------------- Mach trim (elevator bias, no stab / wheel motion)
    const machOk = fccPwr && adcOk && v.get('fail.b738.mach_trim') === 0;
    v.set(B738.machTrimElev, machOk ? machTrimElev(v.get('adc1.mach')) : 0);
  }

  reset(): void {
    this.refKt = NaN;
    this.airT = 0;
    this.trimHoldT = 0;
    this.applied = 0;
  }
}
