/**
 * Base class for every glass display (PFD, MFD, EICAS, CDU screen, standby
 * instrument, LCD windows). Implements `CockpitDisplay` from
 * cockpit/types.ts so the cockpit DisplayManager can map it onto geometry.
 *
 * Responsibilities:
 *  - Canvas creation: DOM canvas (default when a document exists) or
 *    OffscreenCanvas (workers / headless), or a caller-supplied canvas.
 *  - DPR-independent logical coordinates: subclasses draw in a fixed design
 *    size (e.g. 1024 x 768 "G1000 PFD units"); `pixelRatio` only changes the
 *    texture resolution.
 *  - Power and brightness: reads `display.<id>.power` / `display.<id>.brt`
 *    (DISPLAY_VARS, missing var = powered / full brightness) and honours
 *    `setBrightness()` from the dimming system. Unpowered = black.
 *  - Optional boot sequence after power-up (`bootTimeS`, `drawBoot`).
 *  - Dirty tracking: `render()` returns false (no texture upload) unless the
 *    display was invalidated, is animating, the brightness changed, or a
 *    watched SimVar moved by more than its quantum.
 *
 * Subclass contract:
 *    protected update(dt)   every render call while powered (timers, filters)
 *    protected draw(ctx,dt) full redraw in logical pixels (background cleared)
 *    protected drawBoot(ctx, progress) while booting (default: black)
 *    protected onPowerChange(on)
 *    protected onPointerLogical(x, y, kind, delta) touch/click in logical px
 */
import type { CockpitDisplay } from '../../cockpit/types';
import { DISPLAY_VARS } from '../../cockpit/types';
import type { SimVars } from '../../core/SimVars';
import { DASH_NONE, type Ctx2D } from './draw/context';

export type DisplayCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface CanvasDisplayOptions {
  /** Unique display id (also used for DISPLAY_VARS names). */
  id: string;
  /** Logical (design) width/height in pixels; all drawing uses these units. */
  width: number;
  height: number;
  /** Canvas pixels per logical pixel (texture resolution). Default 1. */
  pixelRatio?: number;
  /** Target refresh rate (Hz). Default 30 (CLAUDE.md: glass <= 30 Hz). */
  refreshHz?: number;
  /** SimVars for power/brightness/watched vars. Without it the display is always powered. */
  vars?: SimVars;
  /** Power var (0 = off). Default DISPLAY_VARS.power(id); null disables the check. Missing var = powered. */
  powerVar?: string | null;
  /** Brightness var 0..1. Default DISPLAY_VARS.brightness(id); null disables. Missing var = 1. */
  brightnessVar?: string | null;
  /** 'dom' | 'offscreen' | an existing canvas. Default: 'dom' when `document` exists, else 'offscreen'. */
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
  /** Background fill before every frame. Default '#000'. */
  background?: string;
  /** Seconds of boot screen after power-up (0 = none). Default 0. */
  bootTimeS?: number;
  /** Apply brightness by darkening the frame (default true). Set false if the material is dimmed instead. */
  applyBrightness?: boolean;
  /** Request an alpha channel (transparent HUD/overlay displays). Default false. */
  alpha?: boolean;
}

/** Creates a canvas of the requested kind and pixel size. */
export function createDisplayCanvas(widthPx: number, heightPx: number, kind: 'dom' | 'offscreen' | 'auto' = 'auto'): DisplayCanvas {
  const useOffscreen = kind === 'offscreen' || (kind === 'auto' && typeof document === 'undefined');
  if (useOffscreen) {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('createDisplayCanvas: OffscreenCanvas is not available');
    return new OffscreenCanvas(widthPx, heightPx);
  }
  const c = document.createElement('canvas');
  c.width = widthPx;
  c.height = heightPx;
  return c;
}

// Precomputed brightness overlays (64 steps) so dimming never allocates a colour string.
const DIM_STEPS = 64;
const DIM_FILLS: string[] = [];
for (let i = 0; i <= DIM_STEPS; i++) DIM_FILLS.push(`rgba(0,0,0,${(i / DIM_STEPS).toFixed(4)})`);

export abstract class CanvasDisplay implements CockpitDisplay {
  readonly id: string;
  readonly canvas: DisplayCanvas;
  /** Canvas size in pixels (CockpitDisplay contract). */
  readonly width: number;
  readonly height: number;
  readonly refreshHz: number;
  /** Design size in logical pixels. */
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly pixelRatio: number;

  protected readonly ctx: Ctx2D;
  protected readonly vars?: SimVars;
  protected readonly background: string;
  /** Set true by subclasses while something animates (flashing, boot); forces a redraw every render. */
  protected animating = false;
  /** Seconds since the display last powered up. */
  protected timeS = 0;

  /** Power var (null = always powered); read by the DisplayManager when the registration names none. */
  readonly powerVar: string | null;
  private readonly brightnessVar: string | null;
  private readonly bootTimeS: number;
  private readonly applyBrightness: boolean;
  private bootLeft = 0;
  private wasPowered = false;
  private firstFrame = true;
  private dirty = true;
  private externalBrightness = -1;
  private lastBrightness = -1;
  private forcedPower: boolean | null = null;
  // Watched vars (quantized comparisons).
  private watchNames: string[] = [];
  private watchQuanta: number[] = [];
  private watchValues = new Float64Array(0);
  private watchStringNames: string[] = [];
  private watchStringValues: string[] = [];

  constructor(opts: CanvasDisplayOptions) {
    this.id = opts.id;
    this.logicalWidth = opts.width;
    this.logicalHeight = opts.height;
    this.pixelRatio = opts.pixelRatio ?? 1;
    this.refreshHz = opts.refreshHz ?? 30;
    this.vars = opts.vars;
    this.powerVar = opts.powerVar === undefined ? DISPLAY_VARS.power(opts.id) : opts.powerVar;
    this.brightnessVar = opts.brightnessVar === undefined ? DISPLAY_VARS.brightness(opts.id) : opts.brightnessVar;
    this.background = opts.background ?? '#000000';
    this.bootTimeS = opts.bootTimeS ?? 0;
    this.applyBrightness = opts.applyBrightness ?? true;
    const pw = Math.max(1, Math.round(opts.width * this.pixelRatio));
    const ph = Math.max(1, Math.round(opts.height * this.pixelRatio));
    const c = opts.canvas;
    if (c === undefined || c === 'dom' || c === 'offscreen') {
      this.canvas = createDisplayCanvas(pw, ph, c ?? 'auto');
    } else {
      this.canvas = c;
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.width = pw;
    this.height = ph;
    const ctx = this.canvas.getContext('2d', { alpha: opts.alpha ?? false }) as Ctx2D | null;
    if (!ctx) throw new Error(`CanvasDisplay ${opts.id}: 2D context unavailable`);
    this.ctx = ctx;
  }

  // ---------------------------------------------------------------- state

  /** True when powered (power var >= 0.5, or forced by `setPowered`). */
  get powered(): boolean {
    if (this.forcedPower !== null) return this.forcedPower;
    if (!this.vars || !this.powerVar) return true;
    return this.vars.get(this.powerVar, 1) >= 0.5;
  }

  /** Effective brightness 0..1 (setBrightness() wins over the brightness var). */
  get brightness(): number {
    if (this.externalBrightness >= 0) return this.externalBrightness;
    if (!this.vars || !this.brightnessVar) return 1;
    const b = this.vars.get(this.brightnessVar, 1);
    return b < 0 ? 0 : b > 1 ? 1 : b;
  }

  /** True while the boot screen is showing. */
  get booting(): boolean {
    return this.bootLeft > 1e-6;
  }

  /** Overrides the power var (true/false) or returns control to it (null). */
  setPowered(on: boolean | null): void {
    this.forcedPower = on;
  }

  /** CockpitDisplay: brightness from the dimming system. */
  setBrightness(b: number): void {
    this.externalBrightness = b < 0 ? 0 : b > 1 ? 1 : b;
  }

  /** Forces a redraw on the next render. */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * Redraw when `name` changes by at least `quantum` (0 = any change). Call
   * in the subclass constructor for every var the display shows.
   */
  protected watch(name: string, quantum = 0): void {
    this.watchNames.push(name);
    this.watchQuanta.push(quantum);
    const next = new Float64Array(this.watchNames.length);
    next.set(this.watchValues);
    next[next.length - 1] = NaN;
    this.watchValues = next;
  }

  /** Redraw when string var `name` changes. */
  protected watchString(name: string): void {
    this.watchStringNames.push(name);
    this.watchStringValues.push('\u0000');
  }

  // ---------------------------------------------------------------- CockpitDisplay

  render(dt: number): boolean {
    const powered = this.powered;
    if (!powered) {
      if (this.wasPowered || this.firstFrame) {
        const was = this.wasPowered;
        this.wasPowered = false;
        this.firstFrame = false;
        this.bootLeft = 0;
        this.clearBlack();
        if (was) this.onPowerChange(false);
        return true;
      }
      return false;
    }
    this.firstFrame = false;
    if (!this.wasPowered) {
      this.wasPowered = true;
      this.timeS = 0;
      this.bootLeft = this.bootTimeS;
      this.dirty = true;
      this.onPowerChange(true);
    }
    this.timeS += dt;
    this.update(dt);
    const b = this.brightness;
    if (this.bootLeft > 1e-6) {
      this.bootLeft -= dt;
      this.begin();
      this.drawBoot(this.ctx, this.bootTimeS > 0 ? 1 - Math.max(0, this.bootLeft) / this.bootTimeS : 1);
      this.end(b);
      this.dirty = true; // first normal frame after boot must draw
      return true;
    }
    const changed = this.watchChanged();
    if (!this.dirty && !this.animating && !changed && b === this.lastBrightness) return false;
    this.dirty = false;
    this.lastBrightness = b;
    this.begin();
    this.draw(this.ctx, dt);
    this.end(b);
    return true;
  }

  onPointer(x: number, y: number, kind: 'down' | 'up' | 'move' | 'wheel', delta?: number): void {
    if (!this.powered) return;
    this.onPointerLogical(x / this.pixelRatio, y / this.pixelRatio, kind, delta ?? 0);
  }

  dispose(): void {
    // Release the backing store early (GPU texture is owned by the DisplayManager).
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.watchNames = [];
    this.watchStringNames = [];
  }

  // ---------------------------------------------------------------- subclass hooks

  /** Per-render update while powered (timers, filters). Default no-op. */
  protected update(_dt: number): void {}

  /** Full-frame draw in logical pixels; the background has been filled. */
  protected abstract draw(ctx: Ctx2D, dt: number): void;

  /** Boot screen; `progress` 0..1. Default: black. */
  protected drawBoot(_ctx: Ctx2D, _progress: number): void {}

  /** Power transition notification. */
  protected onPowerChange(_on: boolean): void {}

  /** Pointer in logical pixels (see CockpitDisplay.onPointer). */
  protected onPointerLogical(_x: number, _y: number, _kind: 'down' | 'up' | 'move' | 'wheel', _delta: number): void {}

  // ---------------------------------------------------------------- internals

  private begin(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setLineDash(DASH_NONE);
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, this.width, this.height);
    const pr = this.pixelRatio;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
  }

  private end(brightness: number): void {
    if (!this.applyBrightness || brightness >= 1) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = DIM_FILLS[Math.round((1 - brightness) * DIM_STEPS)];
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private clearBlack(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private watchChanged(): boolean {
    const vars = this.vars;
    if (!vars) return false;
    let changed = false;
    const names = this.watchNames;
    const vals = this.watchValues;
    for (let i = 0; i < names.length; i++) {
      const q = this.watchQuanta[i];
      const raw = vars.get(names[i]);
      const v = q > 0 ? Math.round(raw / q) : raw;
      if (v !== vals[i]) {
        vals[i] = v;
        changed = true;
      }
    }
    const sn = this.watchStringNames;
    for (let i = 0; i < sn.length; i++) {
      const s = vars.getString(sn[i]);
      if (s !== this.watchStringValues[i]) {
        this.watchStringValues[i] = s;
        changed = true;
      }
    }
    return changed;
  }
}

/**
 * Concrete display driven by callbacks (quick displays, LCD windows, tests).
 */
export class CallbackDisplay extends CanvasDisplay {
  constructor(
    opts: CanvasDisplayOptions,
    private readonly drawFn: (ctx: Ctx2D, dt: number, display: CallbackDisplay) => void,
    private readonly updateFn?: (dt: number, display: CallbackDisplay) => void,
  ) {
    super(opts);
  }

  /** Public so callbacks can request continuous redraws. */
  setAnimating(on: boolean): void {
    this.animating = on;
  }

  /** Elapsed powered time (s). */
  get time(): number {
    return this.timeS;
  }

  /** Public wrapper around `watch` for callback-driven displays. */
  watchVar(name: string, quantum = 0): void {
    this.watch(name, quantum);
  }

  protected override update(dt: number): void {
    this.updateFn?.(dt, this);
  }

  protected override draw(ctx: Ctx2D, dt: number): void {
    this.drawFn(ctx, dt, this);
  }
}
