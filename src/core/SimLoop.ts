/**
 * Fixed-timestep simulation loop (docs/ARCHITECTURE.md "Frame and step order").
 *
 *   every animation frame:
 *     input(realDt)                          -> input.* vars
 *     accumulate realDt * sim.rate
 *     while accumulator >= 1/120 s (bounded by maxSubsteps):
 *         if (step % 2 == 0) systems(1/60)   // aircraft Subsystems
 *         physics(1/120)                      // fdm.step
 *         if (step % 6 == 0) nav(1/20)        // radios / FMS at 20 Hz
 *     frame({ realDt, simDt, alpha, ... })    // world, cockpit, displays, render, audio
 *
 * Pause (`sim.paused`) stops all fixed-rate callbacks; `input` and `frame`
 * still run so the cockpit stays interactive. Sim rate (`sim.rate`) is
 * clamped to 1..16. When a frame needs more than `maxSubsteps` physics steps
 * the excess simulated time is dropped (no spiral of death) and counted in
 * `droppedTime_s`.
 *
 * Publishes `sim.time_s` (elapsed simulated seconds) after every physics
 * step and `sim.frame_ms` (real frame time) once per frame.
 *
 * The scheduler is injectable: `createRafScheduler()` in the browser/Electron,
 * `ManualScheduler` (or direct `advance(dt)` calls) in tests.
 */
import type { SimVars } from './SimVars';
import type { EventBus } from './EventBus';
import { SIM } from './vars';

export const PHYSICS_HZ = 120;
export const SYSTEMS_HZ = 60;
export const NAV_HZ = 20;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
export const SYSTEMS_DT = 1 / SYSTEMS_HZ;
export const NAV_DT = 1 / NAV_HZ;
const SYSTEMS_EVERY = PHYSICS_HZ / SYSTEMS_HZ; // 2
const NAV_EVERY = PHYSICS_HZ / NAV_HZ; // 6

export const MIN_SIM_RATE = 1;
export const MAX_SIM_RATE = 16;
/** Discrete rates stepped through by the `sim.rate_inc` / `sim.rate_dec` events. */
export const SIM_RATE_STEPS: readonly number[] = [1, 2, 4, 8, 16];

/** Abstract frame scheduler (requestAnimationFrame in the app, manual in tests). */
export interface LoopScheduler {
  /** Monotonic time in milliseconds. */
  now(): number;
  /** Requests `cb` on the next frame; returns a handle for `cancel`. */
  request(cb: (timeMs: number) => void): number;
  cancel(handle: number): void;
}

/** Browser scheduler backed by `requestAnimationFrame` and `performance.now()`. */
export function createRafScheduler(): LoopScheduler {
  return {
    now: () => performance.now(),
    request: (cb) => requestAnimationFrame(cb),
    cancel: (h) => cancelAnimationFrame(h),
  };
}

/**
 * Deterministic scheduler for tests and headless runs. `tick(ms)` advances
 * the clock and fires the pending frame callback (if any).
 */
export class ManualScheduler implements LoopScheduler {
  time = 0;
  private pending: ((t: number) => void) | null = null;
  private handle = 0;

  now(): number {
    return this.time;
  }

  request(cb: (timeMs: number) => void): number {
    this.pending = cb;
    return ++this.handle;
  }

  cancel(handle: number): void {
    if (handle === this.handle) this.pending = null;
  }

  /** Advances time by `ms` and runs the pending frame callback. Returns true if one ran. */
  tick(ms: number): boolean {
    this.time += ms;
    const cb = this.pending;
    this.pending = null;
    if (cb) cb(this.time);
    return cb !== null;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }
}

/** Information handed to the per-frame hook. */
export interface FrameInfo {
  /** Real (wall-clock) seconds since the previous frame, after clamping. */
  realDt: number;
  /** Simulated seconds advanced this frame (0 while paused). */
  simDt: number;
  /** Fraction (0..1) of a physics step left in the accumulator, for render interpolation. */
  alpha: number;
  /** Physics steps executed this frame. */
  steps: number;
  paused: boolean;
}

export interface SimLoopCallbacks {
  /** Once per frame before stepping (poll keyboard/joystick into input.* vars). */
  input?(realDt: number): void;
  /** 60 Hz: aircraft subsystems, called on even physics steps before the FDM. */
  systems?(dt: number): void;
  /** 120 Hz: flight model step. */
  physics?(dt: number): void;
  /** 20 Hz: radios / FMS, after the FDM step. */
  nav?(dt: number): void;
  /** Once per frame after stepping: world, cockpit, displays, render, audio. */
  frame?(info: FrameInfo): void;
}

export interface SimLoopOptions {
  /** Upper bound of physics steps per frame (default 48 = 16x at 40 fps). */
  maxSubsteps?: number;
  /** Real frame time clamp in seconds (default 0.25; protects against tab switches). */
  maxFrameTime_s?: number;
  /** Frame scheduler (default: requestAnimationFrame). */
  scheduler?: LoopScheduler;
  /**
   * Optional event bus. When given the loop handles `sim.pause_toggle`,
   * `sim.pause_set` (payload boolean), `sim.rate_inc`, `sim.rate_dec`,
   * `sim.rate_set` (payload number) and `sim.step` (single step while paused).
   */
  events?: EventBus;
}

export class SimLoop {
  readonly vars: SimVars;
  private readonly cb: SimLoopCallbacks;
  private readonly scheduler: LoopScheduler;
  readonly maxSubsteps: number;
  readonly maxFrameTime_s: number;

  private accumulator = 0;
  private lastTimeMs: number | null = null;
  private handle: number | null = null;
  private simTime = 0;
  private stepRequests = 0;
  private readonly unsubs: (() => void)[] = [];
  private readonly frameInfo: FrameInfo = { realDt: 0, simDt: 0, alpha: 0, steps: 0, paused: false };

  /** Total physics steps executed since construction. */
  physicsSteps = 0;
  systemsSteps = 0;
  navSteps = 0;
  /** Simulated seconds discarded because a frame hit `maxSubsteps`. */
  droppedTime_s = 0;
  frames = 0;

  constructor(vars: SimVars, callbacks: SimLoopCallbacks, options: SimLoopOptions = {}) {
    this.vars = vars;
    this.cb = callbacks;
    this.maxSubsteps = Math.max(1, Math.floor(options.maxSubsteps ?? 48));
    this.maxFrameTime_s = options.maxFrameTime_s ?? 0.25;
    this.scheduler = options.scheduler ?? createRafScheduler();
    if (!vars.has(SIM.rate)) vars.set(SIM.rate, 1);
    if (!vars.has(SIM.paused)) vars.set(SIM.paused, 0);
    this.simTime = vars.get(SIM.timeS, 0);
    vars.set(SIM.timeS, this.simTime);
    const ev = options.events;
    if (ev) {
      this.unsubs.push(
        ev.on('sim.pause_toggle', () => this.setPaused(!this.paused)),
        ev.on('sim.pause_set', (p) => this.setPaused(Boolean(p))),
        ev.on('sim.rate_inc', () => this.stepRate(1)),
        ev.on('sim.rate_dec', () => this.stepRate(-1)),
        ev.on('sim.rate_set', (p) => this.setRate(Number(p))),
        ev.on('sim.step', () => {
          this.stepRequests++;
        }),
      );
    }
  }

  get running(): boolean {
    return this.handle !== null;
  }

  get paused(): boolean {
    return this.vars.getBool(SIM.paused);
  }

  setPaused(p: boolean): void {
    this.vars.setBool(SIM.paused, p);
    if (p) this.accumulator = 0;
  }

  /** Current sim rate, clamped to 1..16. */
  get rate(): number {
    const r = this.vars.get(SIM.rate, 1);
    return r < MIN_SIM_RATE ? MIN_SIM_RATE : r > MAX_SIM_RATE ? MAX_SIM_RATE : r;
  }

  setRate(r: number): void {
    if (!Number.isFinite(r)) return;
    this.vars.set(SIM.rate, Math.min(MAX_SIM_RATE, Math.max(MIN_SIM_RATE, r)));
  }

  /** Steps through SIM_RATE_STEPS (dir = +1 faster, -1 slower). */
  stepRate(dir: 1 | -1): void {
    const r = this.rate;
    const steps = SIM_RATE_STEPS;
    let next = dir > 0 ? steps[steps.length - 1] : steps[0];
    if (dir > 0) {
      for (let i = 0; i < steps.length; i++) {
        if (steps[i] > r + 1e-9) {
          next = steps[i];
          break;
        }
      }
    } else {
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i] < r - 1e-9) {
          next = steps[i];
          break;
        }
      }
    }
    this.setRate(next);
  }

  /** Elapsed simulated seconds. */
  get time(): number {
    return this.simTime;
  }

  start(): void {
    if (this.handle !== null) return;
    this.lastTimeMs = null;
    const tick = (t: number): void => {
      this.handle = this.scheduler.request(tick);
      const last = this.lastTimeMs;
      this.lastTimeMs = t;
      if (last !== null) this.advance((t - last) / 1000);
    };
    this.handle = this.scheduler.request(tick);
  }

  stop(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.lastTimeMs = null;
  }

  dispose(): void {
    this.stop();
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
  }

  /** Forgets any partially accumulated step time (e.g. after a reposition or state load). */
  resetAccumulator(): void {
    this.accumulator = 0;
  }

  /**
   * Runs one frame worth of simulation for `realDt` wall-clock seconds.
   * Called by the scheduler; tests may call it directly. Returns the number
   * of physics steps executed.
   */
  advance(realDt: number): number {
    let dt = realDt;
    if (!(dt >= 0)) dt = 0;
    if (dt > this.maxFrameTime_s) dt = this.maxFrameTime_s;
    this.vars.set(SIM.frameMs, realDt * 1000);
    this.frames++;
    this.cb.input?.(dt);

    const paused = this.paused;
    let steps = 0;
    const t0 = this.simTime;
    if (!paused) {
      this.accumulator += dt * this.rate;
      // Tolerance so that e.g. 1/60 s at 1x yields exactly 2 steps despite rounding.
      const eps = 1e-9;
      while (this.accumulator + eps >= PHYSICS_DT) {
        if (steps >= this.maxSubsteps) {
          this.droppedTime_s += this.accumulator;
          this.accumulator = 0;
          break;
        }
        this.accumulator -= PHYSICS_DT;
        this.stepOnce();
        steps++;
      }
      if (this.accumulator < 0) this.accumulator = 0;
    } else {
      this.accumulator = 0;
      while (this.stepRequests > 0) {
        this.stepRequests--;
        this.stepOnce();
        steps++;
      }
    }
    this.stepRequests = 0;

    const fi = this.frameInfo;
    fi.realDt = dt;
    fi.simDt = this.simTime - t0;
    fi.alpha = this.accumulator / PHYSICS_DT;
    fi.steps = steps;
    fi.paused = paused;
    this.cb.frame?.(fi);
    return steps;
  }

  /** Executes exactly one fixed physics step (with systems/nav on their divisors). */
  stepOnce(): void {
    const k = this.physicsSteps;
    if (k % SYSTEMS_EVERY === 0) {
      this.cb.systems?.(SYSTEMS_DT);
      this.systemsSteps++;
    }
    this.cb.physics?.(PHYSICS_DT);
    if (k % NAV_EVERY === 0) {
      this.cb.nav?.(NAV_DT);
      this.navSteps++;
    }
    this.physicsSteps = k + 1;
    this.simTime += PHYSICS_DT;
    this.vars.set(SIM.timeS, this.simTime);
  }
}
