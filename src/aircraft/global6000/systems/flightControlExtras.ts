/**
 * Global 6000 flight-control functions the generic blocks do not cover (GX
 * pilot training guide chapter 10, Flight Controls). Runs after the primary
 * flight controls and before the stabilizer trim / spoilers:
 *
 *  - ROLL SPLRS priority (GX PTG 10-48 / 10-49): the MFS roll-assist command
 *    is the average of both control-wheel roll sensors. After a roll
 *    disconnect (jammed aileron circuit, failure `fcs.roll_disconnect`) the
 *    average of a jammed and a free wheel halves the roll-assist command
 *    until a ROLL SPLRS PLT CONT / CPLT CONT switchlight gives priority to
 *    the free (valid) side; without a selection 30 s after the disconnect
 *    both ROLL SEL captions and the ROLL SELECT message come on. Output
 *    `V.mfsRollCmd` (Spoilers roll.aileronVar), `V.rollPriority`,
 *    `V.rollSelReq`. SCOPE: the jam is not simulated on one aileron surface
 *    (the aileron channel keeps both surfaces); the flight crew sees the MFS
 *    roll-assist loss and the ROLL SEL / ROLL SELECT logic.
 *  - Mach trim (GX PTG 10-25): with the autopilot off the FCUs trim the
 *    stabilizer nose up with Mach number, 0.5 deg NU at M0.85 to 1.8 deg NU
 *    at M0.90 (EST onset at M0.80), at 0.06 .. 0.03 deg/s as Mach increases;
 *    inhibited with the AP engaged, while a trim switch is operated, without
 *    stabilizer trim power or with `fcs.mach_trim` (MACH TRIM FAIL).
 *  - Stabilizer-in-motion aural clacker (GX PTG 10-27): more than 3 s at a
 *    rate above 0.2 deg/s, or more than 6 s above 0.08 deg/s (`trim.wheel`
 *    clicks through the IAC aural channels).
 *  - STALL voice with the stick shakers (GX PTG 10-61 "the voice advisory
 *    sounds").
 *
 * No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import type { AudioApi } from '../../../core/SimContext';
import type { TrimAxis } from '../../../systems/flightcontrols';
import { G6K_LIMITS } from '../data';
import { G6K_VARS as V } from '../vars';

/** Stabilizer units per degree (0..14 units = -2 .. +12 deg). */
const U_PER_DEG = G6K_LIMITS.stabUnitsMax / (G6K_LIMITS.stabDegMax - G6K_LIMITS.stabDegMin);

/** Mach trim stabilizer offset (deg NU) for a Mach number (EST onset M0.80, GX PTG 10-25 points at M0.85 / M0.90). */
export function machTrimDeg(m: number): number {
  const [m1, m2] = G6K_LIMITS.machTrimMach;
  const [d1, d2] = G6K_LIMITS.machTrimDeg;
  if (m <= 0.8) return 0;
  if (m <= m1) return (d1 * (m - 0.8)) / (m1 - 0.8);
  if (m <= m2) return d1 + ((d2 - d1) * (m - m1)) / (m2 - m1);
  return d2;
}

export class G6kFlightControlExtras implements Subsystem {
  readonly name = 'g6k.fcs_extras';
  private discT = 0;
  private rollPri = 0;
  private readonly prevSw = [0, 0, 0];
  private machApplied = NaN;
  private lastUnits = NaN;
  private fastT = 0;
  private slowT = 0;
  private clackT = 0;
  private stallVoiceT = 0;

  constructor(
    private readonly v: SimVars,
    private readonly stab: TrimAxis,
    private readonly audio: AudioApi | undefined,
  ) {}

  update(dt: number): void {
    const v = this.v;
    // ---------------- ROLL SPLRS priority
    for (let s = 1; s <= 2; s++) {
      const sw = v.get(s === 1 ? SW1 : SW2);
      // Pressing one side's switchlight selects it (the other side releases: one priority at a time).
      if (sw !== 0 && this.prevSw[s] === 0) {
        this.rollPri = s;
        v.set(s === 1 ? SW2 : SW1, 0);
      }
      if (sw === 0 && this.prevSw[s] !== 0 && this.rollPri === s) this.rollPri = 0;
      this.prevSw[s] = v.get(s === 1 ? SW1 : SW2);
    }
    const disc = v.get('fail.fcs.roll_disconnect') !== 0;
    this.discT = disc ? this.discT + dt : 0;
    v.set(V.rollPriority, this.rollPri);
    v.set(V.rollSelReq, disc && this.rollPri === 0 && this.discT >= G6K_LIMITS.rollSelectDelayS ? 1 : 0);
    const ail = v.get('surf.aileron');
    v.set(V.mfsRollCmd, disc && this.rollPri === 0 ? 0.5 * ail : ail);

    // ---------------- Mach trim
    const mach = v.get('adc1.mach');
    const target = machTrimDeg(mach) * U_PER_DEG;
    if (Number.isNaN(this.machApplied)) this.machApplied = target;
    const trimPwr = v.get('trim.pitch_elec_avail') !== 0;
    const apOff = v.get('ap.engaged') === 0;
    const switches = v.get('input.pitch_trim_rate') !== 0 || v.get(V.yokeTrimCmd) !== 0;
    const failed = v.get('fail.fcs.mach_trim') !== 0 || v.get('adc1.valid') === 0;
    let cmd = 0;
    if (apOff && trimPwr && !switches && !failed) {
      const rateDps = mach <= G6K_LIMITS.machTrimMach[0] ? G6K_LIMITS.machTrimRateDps[0] : G6K_LIMITS.machTrimRateDps[1];
      const step = rateDps * U_PER_DEG * dt;
      const d = target - this.machApplied;
      cmd = d > step ? step : d < -step ? -step : d;
      if (cmd !== 0) {
        this.stab.setPosition(this.stab.position + cmd);
        this.machApplied += cmd;
      }
    } else if (!apOff || switches) {
      // With the AP (or the pilot) trimming, the Mach trim reference follows so no step is applied afterwards.
      this.machApplied = target;
    }
    v.set(V.machTrimCmd, cmd / Math.max(dt, 1e-6));

    // ---------------- stabilizer-in-motion clacker
    const units = v.get('trim.pitch_units');
    if (!Number.isNaN(this.lastUnits) && dt > 0) {
      const rate = Math.abs(units - this.lastUnits) / dt / U_PER_DEG; // deg/s
      this.fastT = rate > 0.2 ? this.fastT + dt : 0;
      this.slowT = rate > 0.08 ? this.slowT + dt : 0;
    }
    this.lastUnits = units;
    const clack = (this.fastT > 3 || this.slowT > 6) && v.get('gear.air_ground') === 0;
    v.set(V.stabClacker, clack ? 1 : 0);
    if (clack) {
      this.clackT -= dt;
      if (this.clackT <= 0) {
        this.clackT = 0.25;
        this.audio?.play('trim.wheel');
      }
    } else this.clackT = 0;

    // ---------------- STALL voice with the shakers (in flight)
    if (v.get('alert.stick_shaker') !== 0 && v.get('gear.air_ground') === 0) {
      this.stallVoiceT -= dt;
      if (this.stallVoiceT <= 0) {
        this.stallVoiceT = 2.5; // EST repeat
        this.audio?.callout('STALL', 10);
      }
    } else this.stallVoiceT = 0;
  }

  reset(): void {
    this.discT = 0;
    this.machApplied = NaN;
    this.lastUnits = NaN;
    this.fastT = 0;
    this.slowT = 0;
    this.clackT = 0;
    this.stallVoiceT = 0;
    this.rollPri = this.v.get(SW1) !== 0 ? 1 : this.v.get(SW2) !== 0 ? 2 : 0;
    this.prevSw[1] = this.v.get(SW1);
    this.prevSw[2] = this.v.get(SW2);
  }
}

const SW1 = V.rollSplr(1);
const SW2 = V.rollSplr(2);
