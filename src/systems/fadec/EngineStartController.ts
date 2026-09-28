/**
 * Turbofan start sequencing for one engine: automatic (FADEC auto start
 * with protection) and manual modes.
 *
 * Automatic start (Citation/Gulfstream/Global FADECs; physics.md §7.3):
 *   START request (rising edge of `startSwitch`, or level while held for
 *   'held' switches) with the engine not running:
 *     MOTORING  starter engaged, igniters on;
 *     FUEL      when the run/cutoff lever/switch is at RUN and N2 >=
 *               `fuelOnN2Pct` (≈ the engine's light-off N2) the FADEC opens
 *               the fuel (`fuelCmdVar`);
 *     LIGHT-OFF expected within `lightOffTimeoutS` (ITT rise >= 50 °C);
 *     ACCEL     starter and igniters cut out at `starterCutoutN2Pct`;
 *     RUNNING   N2 >= 98 % of `idleN2Pct` (or eng{i}.running).
 *   Auto-abort (fuel off, igniters off, starter keeps motoring for
 *   `clearingMotorS` to cool/clear, then off):
 *     HOT     ITT above `hotStartIttC`, or predicted to exceed it (ITT rate
 *             × 2 s) during the start;
 *     HUNG    N2 increase less than 1 % over `hungWindowS` before idle;
 *     NO LIGHT no ITT rise within `lightOffTimeoutS` of fuel on;
 *     STARTER starter engaged longer than `maxStarterS`.
 * Manual start (737NG: ENGINE START switch to GRD, start lever to IDLE at
 *   25 % N2 or max motoring, starter cut-out at 56 % N2 when the GRD switch
 *   releases to OFF — SmartCockpit 737NG Engines/APU): the starter follows
 *   the start switch, igniters fire while starting with the lever at RUN,
 *   the fuel follows the lever directly, no auto-abort (the crew monitors
 *   and aborts); at cut-out a solenoid-held switch is released
 *   (`releaseSwitch`).
 * Running: fuel command = run lever; continuous ignition switch and auto
 *   relight (flameout in flight with the lever at RUN: igniters on) keep the
 *   igniters powered.
 *
 * Outputs (defaults): starter request `fadec.eng{i}.starter_cmd` (fed to
 * the electrical starter / pneumatic start valve bindings, or set
 * `starterVar: ENG.starter(i)` without a starter model), igniters
 * `eng{i}.ignition`, fuel `fadec.eng{i}.fuel_cmd` (feeds the fuel
 * system's consumer `run` binding; the fuel system is the only writer of
 * eng{i}.fuel_on). State: fadec.eng{i}.start_state (StartState), string
 * fadec.eng{i}.start_status, fadec.eng{i}.abort (1 while an abort latch is
 * set; cleared by a new start or the run lever to CUTOFF), string
 * fadec.eng{i}.abort_reason, fadec.eng{i}.starter_s (current engagement time).
 * Failures: start.eng{i}.valve (starter engagement fails), start.eng{i}.ign
 * (igniters fail).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import { ENG } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import type { BlockEnv } from '../autopilot/lib';

export enum StartState {
  Off = 0,
  Motoring = 1,
  Fuel = 2,
  Accel = 3,
  Running = 4,
  Abort = 5,
  ManualStart = 6,
}

const STATUS: Record<StartState, string> = {
  [StartState.Off]: 'OFF',
  [StartState.Motoring]: 'MOTORING',
  [StartState.Fuel]: 'LIGHT-OFF',
  [StartState.Accel]: 'ACCEL',
  [StartState.Running]: 'RUN',
  [StartState.Abort]: 'ABORT',
  [StartState.ManualStart]: 'START',
};

export interface EngineStartConfig {
  engine: number;
  /** Start switch/button. */
  startSwitch: Binding;
  /** 'momentary' (push button starts the sequence) or 'held' (switch held/solenoid-held during the start). Default 'momentary'. */
  startKind?: 'momentary' | 'held';
  /** Var + value written to release a solenoid-held start switch at cut-out (737 GRD -> OFF). */
  releaseSwitch?: { var: string; offValue: number };
  /** Run/cutoff (fuel) lever or switch: true = RUN/IDLE. */
  runLever: Binding;
  /** Manual start mode (true) vs automatic. Default false. */
  manual?: Binding;
  /** Stop/abort request (e.g. pressing START again / STOP button). */
  stopSwitch?: Binding;
  fuelOnN2Pct: number;
  starterCutoutN2Pct: number;
  idleN2Pct: number;
  hotStartIttC: number;
  lightOffTimeoutS?: number;
  hungWindowS?: number;
  maxStarterS?: number;
  clearingMotorS?: number;
  /**
   * (Appended by citation-longitude.) Look-ahead (s) of the predicted-hot-start abort: ITT + rate x
   * this > hotStartIttC + 30. Default 2. Engines whose start ITT rises steeply from ambient toward a
   * start peak close to the limit need a shorter horizon or every light-off transient aborts.
   */
  hotStartPredictS?: number;
  /**
   * (Appended by citation-longitude.) No-rotation abort: with the starter engaged, an N2 still below
   * `noRotationN2Pct` after `noRotationS` seconds of motoring aborts the start ('NO ROTATION', e.g. no starter
   * air). Default off.
   */
  noRotationS?: number;
  noRotationN2Pct?: number;
  /**
   * Starter can be engaged (bleed/DC available). Default true. Evaluated every
   * update; false drops the starter at once. For a DC starter bind it to the
   * starter bus voltage above the start relay's drop-out (e.g.
   * `'elec.batt_bus_v >= 7'`) and model the relay as the electrical starter's
   * `contactor`. Do not use a bus `_powered` flag: the normal cranking dip
   * (~16 V on a 24 V battery at ~800 A) falls below its 18 V threshold and the
   * starter chatters at the systems rate without turning the engine.
   */
  starterAvailable?: Binding;
  /** Igniter power. Default true. */
  ignitionPower?: Binding;
  /** Continuous ignition selected (IGN CONT / FLT). Default false. */
  continuousIgnition?: Binding;
  /** Auto relight after an in-flight flameout. Default true. */
  autoRelight?: boolean;
  /** Air/ground for auto relight. Default gear.air_ground. */
  onGround?: Binding;
  starterVar?: string;
  ignitionVar?: string;
  fuelCmdVar?: string;
}

export class EngineStartController implements Subsystem {
  readonly name: string;
  readonly engine: number;
  state: StartState = StartState.Off;
  abortReason = '';
  private readonly vars: SimVars;
  private readonly cfg: EngineStartConfig;
  private readonly startSw: () => boolean;
  private readonly stopSw: () => boolean;
  private readonly run: () => boolean;
  private readonly manual: () => boolean;
  private readonly starterAvail: () => boolean;
  private readonly ignPower: () => boolean;
  private readonly contIgn: () => boolean;
  private readonly ground: () => boolean;
  private prevStart = false;
  private starterT = 0;
  private stateT = 0;
  private fuelIttRef = 0;
  private prevItt = 0;
  private ittRate = 0;
  private hungRefN2 = 0;
  private hungT = 0;
  private clearingT = 0;
  private abortLatched = false;
  private readonly o: { starter: string; ign: string; fuel: string; state: string; status: string; abort: string; reason: string; starterS: string };
  private readonly iN2: string;
  private readonly iItt: string;
  private readonly iRun: string;
  private readonly fValve: string;
  private readonly fIgn: string;

  constructor(env: BlockEnv, cfg: EngineStartConfig) {
    const v = env.vars;
    const i = cfg.engine;
    this.vars = v;
    this.cfg = cfg;
    this.engine = i;
    this.name = `start_eng${i}`;
    this.startSw = compileCondition(v, cfg.startSwitch);
    this.stopSw = compileCondition(v, cfg.stopSwitch, false);
    this.run = compileCondition(v, cfg.runLever);
    this.manual = compileCondition(v, cfg.manual, false);
    this.starterAvail = compileCondition(v, cfg.starterAvailable, true);
    this.ignPower = compileCondition(v, cfg.ignitionPower, true);
    this.contIgn = compileCondition(v, cfg.continuousIgnition, false);
    this.ground = compileCondition(v, cfg.onGround ?? 'gear.air_ground', true);
    const p = `fadec.eng${i}.`;
    this.o = {
      starter: cfg.starterVar ?? `${p}starter_cmd`,
      ign: cfg.ignitionVar ?? ENG.ignition(i),
      fuel: cfg.fuelCmdVar ?? `${p}fuel_cmd`,
      state: `${p}start_state`,
      status: `${p}start_status`,
      abort: `${p}abort`,
      reason: `${p}abort_reason`,
      starterS: `${p}starter_s`,
    };
    this.iN2 = ENG.n2(i);
    this.iItt = ENG.itt(i);
    this.iRun = ENG.running(i);
    this.fValve = failVar(`start.eng${i}.valve`);
    this.fIgn = failVar(`start.eng${i}.ign`);
    if (v.get(this.iRun) !== 0) this.state = StartState.Running;
  }

  failures(): FailureDef[] {
    const i = this.engine;
    return [
      { id: `start.eng${i}.valve`, name: `Engine ${i} starter`, category: 'engine', description: 'Starter / start valve fails to engage.' },
      { id: `start.eng${i}.ign`, name: `Engine ${i} igniters`, category: 'engine', description: 'Igniters inoperative: no light-off.' },
    ];
  }

  reset(): void {
    this.state = this.vars.get(this.iRun) !== 0 ? StartState.Running : StartState.Off;
    this.prevStart = this.startSw();
    this.abortLatched = false;
    this.abortReason = '';
    this.starterT = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const cfg = this.cfg;
    const n2 = v.get(this.iN2);
    const itt = v.get(this.iItt);
    this.ittRate += ((dt > 0 ? (itt - this.prevItt) / dt : 0) - this.ittRate) * (1 - Math.exp(-dt / 0.5));
    this.prevItt = itt;
    const running = v.get(this.iRun) !== 0;
    const runLever = this.run();
    const manual = this.manual();
    const sw = this.startSw();
    const rising = sw && !this.prevStart;
    this.prevStart = sw;
    const held = (cfg.startKind ?? 'momentary') === 'held';
    this.stateT += dt;

    if (!runLever && this.state === StartState.Abort && this.clearingT <= 0) this.abortLatched = false;

    let starter = false;
    let ign = false;
    let fuel = runLever;

    if (manual) {
      // ---- manual mode: the crew sequences everything
      if (sw && !running && n2 < cfg.starterCutoutN2Pct) this.state = StartState.ManualStart;
      if (this.state === StartState.ManualStart) {
        starter = sw;
        ign = runLever;
        if (n2 >= cfg.starterCutoutN2Pct) {
          if (cfg.releaseSwitch) v.set(cfg.releaseSwitch.var, cfg.releaseSwitch.offValue);
          this.state = StartState.Accel;
        } else if (!sw) this.state = running ? StartState.Running : StartState.Off;
      } else if (this.state === StartState.Accel) {
        if (running || n2 >= 0.98 * cfg.idleN2Pct) this.state = StartState.Running;
        else if (!runLever) this.state = StartState.Off;
      } else if (running) this.state = StartState.Running;
      else if (this.state === StartState.Running) this.state = StartState.Off;
    } else {
      // ---- automatic mode
      const startReq = held ? sw : rising;
      if (startReq && !running && this.state !== StartState.Motoring && this.state !== StartState.Fuel && this.state !== StartState.Accel) {
        this.enter(StartState.Motoring);
        this.abortLatched = false;
        this.abortReason = '';
        this.starterT = 0;
      }
      if (this.stopSw() && this.state >= StartState.Motoring && this.state <= StartState.Accel) this.abort('STOP');
      switch (this.state) {
        case StartState.Motoring:
          starter = true;
          ign = true;
          fuel = false;
          if (held && !sw) this.enter(StartState.Off);
          else if (cfg.noRotationS !== undefined && this.stateT > cfg.noRotationS && n2 < (cfg.noRotationN2Pct ?? 5)) this.abort('NO ROTATION');
          else if (runLever && n2 >= cfg.fuelOnN2Pct) {
            this.fuelIttRef = itt;
            this.hungRefN2 = n2;
            this.hungT = 0;
            this.enter(StartState.Fuel);
          }
          break;
        case StartState.Fuel:
          starter = true;
          ign = true;
          fuel = runLever;
          if (!runLever) this.abort('CUTOFF');
          else if (itt - this.fuelIttRef >= 50) this.enter(StartState.Accel);
          else if (this.stateT > (cfg.lightOffTimeoutS ?? 10)) this.abort('NO LIGHT');
          break;
        case StartState.Accel: {
          starter = n2 < cfg.starterCutoutN2Pct;
          ign = starter;
          fuel = runLever;
          if (!starter && cfg.releaseSwitch && held) v.set(cfg.releaseSwitch.var, cfg.releaseSwitch.offValue);
          if (!runLever) this.abort('CUTOFF');
          else if (itt > cfg.hotStartIttC || itt + this.ittRate * (cfg.hotStartPredictS ?? 2) > cfg.hotStartIttC + 30) this.abort('HOT');
          else if (running || n2 >= 0.98 * cfg.idleN2Pct) this.enter(StartState.Running);
          else {
            this.hungT += dt;
            if (this.hungT >= (cfg.hungWindowS ?? 10)) {
              if (n2 - this.hungRefN2 < 1) this.abort('HUNG');
              this.hungRefN2 = n2;
              this.hungT = 0;
            }
          }
          break;
        }
        case StartState.Abort:
          fuel = false;
          if (this.clearingT > 0) {
            this.clearingT -= dt;
            starter = true;
          }
          if (!this.abortLatched && this.clearingT <= 0) this.enter(StartState.Off);
          break;
        case StartState.Running:
          if (!running && n2 < 0.5 * cfg.idleN2Pct) this.enter(StartState.Off);
          break;
        default:
          if (running) this.enter(StartState.Running);
      }
      if (this.state >= StartState.Motoring && this.state <= StartState.Accel && starter) {
        if (this.starterT > (cfg.maxStarterS ?? 120)) this.abort('STARTER');
      }
    }

    // ---- continuous ignition / auto relight
    if (this.contIgn()) ign = true;
    const airborne = !this.ground();
    if ((cfg.autoRelight ?? true) && airborne && runLever && !running && n2 > 5 && this.state !== StartState.Abort) ign = true;

    // ---- availability
    if (!this.starterAvail() || v.get(this.fValve) !== 0) starter = false;
    if (!this.ignPower() || v.get(this.fIgn) !== 0) ign = false;
    if (this.state === StartState.Abort) fuel = false;
    this.starterT = starter ? this.starterT + dt : 0;

    v.set(this.o.starter, starter ? 1 : 0);
    v.set(this.o.ign, ign ? 1 : 0);
    v.set(this.o.fuel, fuel ? 1 : 0);
    v.set(this.o.state, this.state);
    v.setString(this.o.status, STATUS[this.state]);
    v.set(this.o.abort, this.abortLatched ? 1 : 0);
    v.setString(this.o.reason, this.abortReason);
    v.set(this.o.starterS, this.starterT);
  }

  private enter(s: StartState): void {
    this.state = s;
    this.stateT = 0;
  }

  private abort(reason: string): void {
    this.abortReason = reason;
    this.abortLatched = true;
    // Dry motoring to clear fuel and cool the turbine after a hot/no-light abort.
    this.clearingT = reason === 'HOT' || reason === 'NO LIGHT' ? this.cfg.clearingMotorS ?? 15 : 0;
    this.enter(StartState.Abort);
  }
}
