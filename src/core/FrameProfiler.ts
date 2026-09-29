/**
 * Low-overhead per-frame profiler: named sections accumulate wall-clock
 * milliseconds (performance.now()) and call counts, read back as averages
 * per frame. Used by App.ts around each stage of the frame (input, systems,
 * physics, nav, world, cockpit/displays, render, audio ...) and exposed
 * through `window.__sim.profile()` for the smoke test and the debug HUD.
 *
 * Hot path: `begin(id)` / `end(id)` only index typed arrays; section ids are
 * small integers fixed at construction. Nothing allocates per frame.
 * Nested sections are allowed (e.g. `physics` inside `step`); each section
 * reports its own inclusive time.
 */

export interface ProfileSection {
  name: string;
  /** Average milliseconds per frame (inclusive). */
  msPerFrame: number;
  /** Average calls per frame. */
  callsPerFrame: number;
  /** Largest single-call time (ms). */
  maxMs: number;
}

export interface ProfileReport {
  frames: number;
  /** Wall-clock span covered by the report (s). */
  seconds: number;
  /** Average real frame interval (ms) = seconds / frames. */
  frameIntervalMs: number;
  /** Sections sorted by msPerFrame, largest first. */
  sections: ProfileSection[];
}

export class FrameProfiler<Name extends string = string> {
  readonly names: readonly Name[];
  private readonly total: Float64Array;
  private readonly count: Float64Array;
  private readonly max: Float64Array;
  private readonly start: Float64Array;
  private frames = 0;
  private t0: number;
  private readonly now: () => number;
  /** Profiling can be switched off (then begin/end return at once). */
  enabled = true;

  constructor(names: readonly Name[], now: () => number = () => performance.now()) {
    this.names = names;
    const n = names.length;
    this.total = new Float64Array(n);
    this.count = new Float64Array(n);
    this.max = new Float64Array(n);
    this.start = new Float64Array(n);
    this.now = now;
    this.t0 = now();
  }

  /** Section id for `name` (resolve once, outside the hot path). */
  id(name: Name): number {
    const i = this.names.indexOf(name);
    if (i < 0) throw new Error(`FrameProfiler: unknown section '${name}'`);
    return i;
  }

  begin(id: number): void {
    if (this.enabled) this.start[id] = this.now();
  }

  end(id: number): void {
    if (!this.enabled) return;
    const dt = this.now() - this.start[id];
    this.total[id] += dt;
    this.count[id] += 1;
    if (dt > this.max[id]) this.max[id] = dt;
  }

  /** Marks the end of one frame. */
  frame(): void {
    if (this.enabled) this.frames++;
  }

  reset(): void {
    this.total.fill(0);
    this.count.fill(0);
    this.max.fill(0);
    this.frames = 0;
    this.t0 = this.now();
  }

  /** Averages since the last reset (allocates; call from diagnostics, not per frame). */
  report(): ProfileReport {
    const f = Math.max(1, this.frames);
    const seconds = (this.now() - this.t0) / 1000;
    const sections: ProfileSection[] = this.names.map((name, i) => ({
      name,
      msPerFrame: this.total[i] / f,
      callsPerFrame: this.count[i] / f,
      maxMs: this.max[i],
    }));
    sections.sort((a, b) => b.msPerFrame - a.msPerFrame);
    return { frames: this.frames, seconds, frameIntervalMs: this.frames > 0 ? (seconds * 1000) / this.frames : 0, sections };
  }
}
