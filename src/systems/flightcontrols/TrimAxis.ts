/**
 * Trim actuator for one axis: elevator trim tab (Cessna), movable
 * horizontal stabilizer (737, G650, Global), aileron or rudder trim.
 *
 * Position is kept in display units (`range`, e.g. 737 stab 0..17 units,
 * Cessna tab -1..1) in `trim.<axis>_units` and mapped linearly to the
 * normalized FDM command (`surf.pitch_trim` etc., -1..1, + = nose up /
 * right wing down / nose right). Sources, in priority order:
 *
 *   1. Manual: trim wheel / knob. Either the cockpit control writes
 *      `trim.<axis>_units` directly (any external change of the var is
 *      accepted as a manual input) or emits `trim.<axis>_manual` with
 *      `{ delta }` in units. Always works (mechanical), unless jammed.
 *   2. Pilot electric trim (yoke switches, -1..1 var): needs `electric.power`
 *      and `electric.enable` (cutout / STAB TRIM MAIN ELEC switch). Rate may
 *      be scheduled vs IAS, with a separate flaps-extended schedule and
 *      separate stops (737NG main electric trim: 3.95–14.5 units flaps up,
 *      0.05–14.5 flaps extended; the flaps-up rate is 1/3 of the flaps-down
 *      rate — satcom.guru "Stabilizer Trim" / SmartCockpit 737NG Flight
 *      Controls). Optional column cutout: trimming against the column
 *      deflection stops the motor (737 column cutout switches).
 *   3. Autopilot trim (`ap.trim_cmd`, -1/0/+1): needs `autopilot.enable`
 *      (737 STAB TRIM AUTOPILOT cutout); inhibited while the pilot trims.
 *   Failures: trim.<axis>.jam (nothing moves), trim.<axis>.runaway (the
 *   electric motor drives continuously toward `runawayDirection` while
 *   electric power and enable are present — pulling the cutout stops it).
 *
 * Vars written: output (surf.*_trim), trim.<axis>_units, trim.<axis>_motion,
 * trim.<axis>_in_motion, trim.<axis>_to_ok, trim.<axis>_elec_avail.
 * Events: trim.<axis>_manual ({ delta } units | number).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { ADC, INPUT, SURF } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import { listen, payloadNumber, sched, type BlockEnv, type Schedule } from '../autopilot/lib';
import { FCS_VARS, type ControlAxis } from './vars';

export interface TrimAxisConfig {
  axis: ControlAxis;
  /** Normalized output var. Default surf.pitch_trim / aileron_trim / rudder_trim. */
  output?: string;
  /** Position range in display units [min, max]. */
  range: [number, number];
  /** Units value that maps to normalized 0. Default mid-range. Mapping is piecewise linear through it. */
  neutral?: number;
  /** true (default): larger units = nose up / right. */
  increasingPositive?: boolean;
  /** Position var (units). Default trim.<axis>_units. */
  positionVar?: string;
  /** Initial position (units) if the var is unset. Default neutral. */
  initial?: number;
  electric?: {
    power: Binding;
    /** Cutout / arm switch. Default true. */
    enable?: Binding;
    /** Pilot switch vars (-1..1, + = nose up/right). Default [input.pitch_trim_rate] for pitch, required otherwise. */
    switchVars?: string[];
    /** Rate (units/s), constant or vs IAS. */
    rate: Schedule;
    /** Rate with flaps extended. Default `rate`. */
    rateFlapsExtended?: Schedule;
    /** Electric stops [min, max] (units). Default `range`. */
    limits?: [number, number];
    limitsFlapsExtended?: [number, number];
    /** Column cutout: electric trim opposing a column deflection beyond `threshold` stops (pitch only). */
    columnCutout?: { inputVar?: string; threshold: number };
  };
  autopilot?: {
    /** Command var (-1..1). Default ap.trim_cmd for pitch. */
    cmdVar?: string;
    power?: Binding;
    enable?: Binding;
    rate: Schedule;
    rateFlapsExtended?: Schedule;
    limits?: [number, number];
  };
  manual?: {
    /** Manual trim available (e.g. mechanical wheel). Default true. */
    enable?: Binding;
    /** Event name. Default trim.<axis>_manual. */
    event?: string;
  };
  /** Takeoff band [lo, hi] (units) for trim.<axis>_to_ok. */
  takeoffBand?: [number, number];
  /** Runaway direction (+1 nose up / -1 nose down). Default -1. */
  runawayDirection?: 1 | -1;
  flapsVar?: string;
  iasVar?: string;
}

const DEF_OUT: Record<ControlAxis, string> = { pitch: SURF.pitchTrim, roll: SURF.aileronTrim, yaw: SURF.rudderTrim };

export class TrimAxis implements Subsystem {
  readonly name: string;
  readonly axis: ControlAxis;
  /** Position in units. */
  position: number;
  private readonly vars: SimVars;
  private readonly cfg: TrimAxisConfig;
  private readonly lo: number;
  private readonly hi: number;
  private readonly neutral: number;
  private readonly sign: number;
  private readonly out: string;
  private readonly posVar: string;
  private readonly elecPower: () => boolean;
  private readonly elecEnable: () => boolean;
  private readonly switches: string[];
  private readonly apCmd: string;
  private readonly apPower: () => boolean;
  private readonly apEnable: () => boolean;
  private readonly manualEnable: () => boolean;
  private readonly flapsVar: string;
  private readonly iasVar: string;
  private readonly columnVar: string;
  private readonly fJam: string;
  private readonly fRunaway: string;
  private manualDelta = 0;
  private lastWritten = NaN;
  private readonly offs: (() => void)[] = [];
  private readonly o: { motion: string; inMotion: string; toOk: string; elecAvail: string };

  constructor(env: BlockEnv, cfg: TrimAxisConfig) {
    this.vars = env.vars;
    this.cfg = cfg;
    this.axis = cfg.axis;
    this.name = `trim_${cfg.axis}`;
    [this.lo, this.hi] = cfg.range;
    this.neutral = cfg.neutral ?? (this.lo + this.hi) / 2;
    this.sign = cfg.increasingPositive === false ? -1 : 1;
    this.out = cfg.output ?? DEF_OUT[cfg.axis];
    this.posVar = cfg.positionVar ?? FCS_VARS.trimUnits(cfg.axis);
    const v = env.vars;
    this.elecPower = compileCondition(v, cfg.electric?.power, false);
    this.elecEnable = compileCondition(v, cfg.electric?.enable, true);
    this.switches = cfg.electric?.switchVars ?? (cfg.axis === 'pitch' ? [INPUT.pitchTrimRate] : []);
    this.apCmd = cfg.autopilot?.cmdVar ?? (cfg.axis === 'pitch' ? 'ap.trim_cmd' : `ap.trim_${cfg.axis}_cmd`);
    this.apPower = compileCondition(v, cfg.autopilot?.power, true);
    this.apEnable = compileCondition(v, cfg.autopilot?.enable, true);
    this.manualEnable = compileCondition(v, cfg.manual?.enable, true);
    this.flapsVar = cfg.flapsVar ?? SURF.flapsDeg;
    this.iasVar = cfg.iasVar ?? ADC.ias(1);
    this.columnVar = cfg.electric?.columnCutout?.inputVar ?? INPUT.pitch;
    this.fJam = failVar(`trim.${cfg.axis}.jam`);
    this.fRunaway = failVar(`trim.${cfg.axis}.runaway`);
    this.o = {
      motion: FCS_VARS.trimMotion(cfg.axis),
      inMotion: FCS_VARS.trimInMotion(cfg.axis),
      toOk: FCS_VARS.trimTakeoffOk(cfg.axis),
      elecAvail: FCS_VARS.trimElecAvail(cfg.axis),
    };
    this.position = v.has(this.posVar) ? v.get(this.posVar) : cfg.initial ?? this.neutral;
    this.write();
    listen(env.events, this.offs, cfg.manual?.event ?? FCS_VARS.trimManualEvent(cfg.axis), (p) => {
      this.manualDelta += payloadNumber(p, 0);
    });
  }

  failures(): FailureDef[] {
    const a = this.axis;
    return [
      { id: `trim.${a}.jam`, name: `${a} trim jam`, category: 'flight controls', description: 'Trim cannot be moved by any means.' },
      { id: `trim.${a}.runaway`, name: `${a} trim runaway`, category: 'flight controls', description: 'Electric trim runs continuously; use the cutout.' },
    ];
  }

  /** Normalized command for a position in units. */
  normalize(units: number): number {
    const d = units - this.neutral;
    const n = d >= 0 ? (this.hi > this.neutral ? d / (this.hi - this.neutral) : 0) : this.neutral > this.lo ? d / (this.neutral - this.lo) : 0;
    return this.sign * (n > 1 ? 1 : n < -1 ? -1 : n);
  }

  /** Sets the position (units), e.g. from `applyState`. */
  setPosition(units: number): void {
    this.position = units < this.lo ? this.lo : units > this.hi ? this.hi : units;
    this.write();
  }

  reset(): void {
    this.position = this.vars.get(this.posVar, this.position);
    this.manualDelta = 0;
    this.write();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const cfg = this.cfg;
    const jam = v.get(this.fJam) !== 0;
    // External write to the position var = manual wheel movement.
    const ext = v.get(this.posVar, this.position);
    if (!Number.isNaN(this.lastWritten) && ext !== this.lastWritten && !jam && this.manualEnable()) this.position = ext;
    let manual = this.manualDelta;
    this.manualDelta = 0;
    const start = this.position;
    const flapsExt = v.get(this.flapsVar) > 0.5;
    const ias = v.get(this.iasVar);

    if (!jam) {
      if (manual !== 0 && this.manualEnable()) this.position += manual;
      else manual = 0;

      // ---- pilot electric trim
      const e = cfg.electric;
      const elecAvail = !!e && this.elecPower() && this.elecEnable();
      v.set(this.o.elecAvail, elecAvail ? 1 : 0);
      let pilotSw = 0;
      for (let i = 0; i < this.switches.length; i++) {
        const s = v.get(this.switches[i]);
        if (Math.abs(s) > Math.abs(pilotSw)) pilotSw = s;
      }
      if (e && elecAvail) {
        const runaway = v.get(this.fRunaway) !== 0;
        let dir = runaway ? (cfg.runawayDirection ?? -1) : pilotSw;
        if (!runaway && e.columnCutout && dir !== 0) {
          const col = v.get(this.columnVar);
          if (Math.abs(col) > e.columnCutout.threshold && Math.sign(col) !== Math.sign(dir)) dir = 0;
        }
        if (dir !== 0) {
          const rate = sched(flapsExt && e.rateFlapsExtended !== undefined ? e.rateFlapsExtended : e.rate, ias);
          const lim = (flapsExt ? e.limitsFlapsExtended : undefined) ?? e.limits ?? cfg.range;
          this.drive(this.sign * dir * rate * dt, lim);
        }
      }

      // ---- autopilot trim (inhibited while the pilot trims)
      const a = cfg.autopilot;
      if (a && pilotSw === 0 && this.apPower() && this.apEnable()) {
        const c = v.get(this.apCmd);
        if (c !== 0) {
          const rate = sched(flapsExt && a.rateFlapsExtended !== undefined ? a.rateFlapsExtended : a.rate, ias);
          this.drive(this.sign * (c > 1 ? 1 : c < -1 ? -1 : c) * rate * dt, a.limits ?? cfg.range);
        }
      }
    } else {
      v.set(this.o.elecAvail, 0);
    }
    if (this.position < this.lo) this.position = this.lo;
    else if (this.position > this.hi) this.position = this.hi;
    const moved = this.position - start;
    v.set(this.o.motion, moved === 0 ? 0 : this.sign * Math.sign(moved));
    v.set(this.o.inMotion, moved !== 0 ? 1 : 0);
    const band = cfg.takeoffBand;
    v.set(this.o.toOk, band ? (this.position >= band[0] && this.position <= band[1] ? 1 : 0) : 1);
    this.write();
  }

  /** Moves by `delta` units, not beyond the stops `lim` (never pushes back an already-out-of-stop position). */
  private drive(delta: number, lim: [number, number]): void {
    let p = this.position + delta;
    if (delta > 0 && p > lim[1]) p = Math.max(this.position, lim[1]);
    if (delta < 0 && p < lim[0]) p = Math.min(this.position, lim[0]);
    this.position = p;
  }

  private write(): void {
    this.vars.set(this.posVar, this.position);
    this.lastWritten = this.position;
    this.vars.set(this.out, this.normalize(this.position));
  }
}
