/**
 * Glass displays and gauge faces on cockpit meshes.
 *
 * For every registered CockpitDisplay the manager owns a CanvasTexture
 * (sRGB) on the display's canvas (HTMLCanvasElement or OffscreenCanvas) and
 * an unlit material on the display mesh, and each frame:
 *  - reads `display.<id>.power` (missing = powered): unpowered screens are
 *    black and are not rendered;
 *  - reads `display.<id>.brt` (0..1, missing = 1) and calls
 *    `display.setBrightness` when it changes; the screen material is dimmed
 *    only when the display does not implement setBrightness (displays that
 *    dim their own drawing, e.g. avionics CanvasDisplay, are not dimmed
 *    twice) unless `dimMaterial` says otherwise;
 *  - after a power-up, optionally shows a boot splash for N seconds before
 *    the display's own rendering starts, then writes `display.<id>.ready` = 1;
 *  - throttles `display.render(dt)` to `refreshHz` (dt = time since that
 *    display last rendered), staggering displays across frames and limiting
 *    renders per frame (`maxRendersPerFrame`); a `false` return skips the
 *    texture upload.
 *
 * The pure scheduling core (`RefreshScheduler`) is unit-tested in node.
 * Display meshes should be planes facing their local +Z (e.g.
 * `displayScreenGeometry`) so the optional cover glass sits in front.
 */
import * as THREE from 'three';
import type { SimVars } from '../core/SimVars';
import type { CockpitDisplay } from './types';
import { DISPLAY_VARS } from './types';
import type { CockpitMaterials } from './materials';
import { context2d, createCanvas, type AnyCanvas, type AnyContext2D } from './env';

// -----------------------------------------------------------------------------
// Scheduling core (pure)
// -----------------------------------------------------------------------------

export interface ScheduleEntry {
  id: string;
  /** Seconds between renders (1 / refreshHz). */
  interval: number;
  /** Time accumulated since the last render (s). */
  acc: number;
  /** Render on the next tick regardless of timing. */
  force: boolean;
  /** Excluded from scheduling (unpowered / booting). */
  paused: boolean;
}

/**
 * Decides which displays render on a frame. Entries accumulate time; an
 * entry is due when its accumulator reaches its interval. Due entries are
 * served most-overdue first up to the per-frame budget; the rest wait (their
 * accumulators keep growing, so they come first next frame). After a render
 * the accumulator keeps the remainder (average rate exact) but is clamped so
 * a stalled display does not burst.
 */
export class RefreshScheduler {
  readonly entries: ScheduleEntry[] = [];
  private readonly due: ScheduleEntry[] = [];
  private staggerSeed = 0;

  add(id: string, hz: number): ScheduleEntry {
    const interval = 1 / Math.max(0.1, hz);
    // Stagger initial phases (golden-ratio sequence) so displays spread over frames.
    this.staggerSeed = (this.staggerSeed + 0.618034) % 1;
    const e: ScheduleEntry = { id, interval, acc: this.staggerSeed * interval, force: true, paused: false };
    this.entries.push(e);
    return e;
  }

  remove(id: string): void {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i >= 0) this.entries.splice(i, 1);
  }

  /**
   * Advances time by dt and fills `out` with the entries to render this
   * frame (most overdue first, at most `budget`). Each returned entry's
   * `renderDt` (time since its previous render) is written into `dts`.
   * Allocation-free.
   */
  tick(dt: number, budget: number, out: ScheduleEntry[], dts: number[]): number {
    const due = this.due;
    due.length = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.paused) continue;
      e.acc += dt;
      if (e.force || e.acc >= e.interval - 1e-6) due.push(e);
    }
    // Insertion sort by overdue ratio (forced first).
    for (let i = 1; i < due.length; i++) {
      const x = due[i];
      const rx = x.force ? Infinity : x.acc / x.interval;
      let j = i - 1;
      while (j >= 0 && (due[j].force ? Infinity : due[j].acc / due[j].interval) < rx) {
        due[j + 1] = due[j];
        j--;
      }
      due[j + 1] = x;
    }
    const n = Math.min(budget, due.length);
    out.length = 0;
    dts.length = 0;
    for (let i = 0; i < n; i++) {
      const e = due[i];
      out.push(e);
      dts.push(e.acc);
      e.force = false;
      e.acc = Math.min(Math.max(0, e.acc - e.interval), e.interval * 0.5);
    }
    return n;
  }
}

// -----------------------------------------------------------------------------
// Display manager
// -----------------------------------------------------------------------------

export interface DisplayBootOptions {
  /** Splash duration after power-up (s). */
  seconds: number;
  /** Splash title (default: display id). */
  title?: string;
  /** Custom splash drawing; called ~10 times per second during boot. */
  draw?: (ctx: AnyContext2D, w: number, h: number, elapsedS: number, totalS: number) => void;
}

export interface DisplayOptions {
  powerVar?: string;
  brightnessVar?: string;
  /** Boot splash after power-up (default none: the display handles its own start-up). */
  boot?: DisplayBootOptions | false;
  /** Add a cover-glass overlay in front of the screen (default true when materials are available). */
  glass?: boolean;
  /** Colour multiplier at full brightness (default 1). */
  gain?: number;
  /**
   * Scale the screen material by the brightness var. Default: true only when
   * the display has no `setBrightness` (otherwise the display dims itself).
   */
  dimMaterial?: boolean;
  /** Generate mipmaps on upload (default true; better minification). */
  mipmaps?: boolean;
  anisotropy?: number;
}

export interface DisplayHandle {
  readonly display: CockpitDisplay;
  readonly mesh: THREE.Mesh;
  readonly texture: THREE.CanvasTexture<AnyCanvas>;
  readonly material: THREE.MeshBasicMaterial;
  readonly options: DisplayOptions;
  powered: boolean;
  booting: boolean;
  bootLeft: number;
  brightness: number;
  /** Counters (renders called / texture uploads). */
  renders: number;
  uploads: number;
  /** Requests a render on the next update (e.g. after a mode change). */
  forceRender(): void;
}

interface Entry extends DisplayHandle {
  sched: ScheduleEntry;
  powerVar: string;
  brtVar: string;
  readyVar: string;
  splash: { canvas: AnyCanvas; ctx: AnyContext2D; texture: THREE.CanvasTexture<AnyCanvas>; lastDraw: number } | null;
  glassMesh: THREE.Mesh | null;
  lastBrt: number;
  prevMaterial: THREE.Material | THREE.Material[];
}

export interface DisplayManagerOptions {
  /** Maximum display renders per frame (default 4). */
  maxRendersPerFrame?: number;
  /** Cockpit materials (for cover glass). */
  materials?: CockpitMaterials;
  anisotropy?: number;
}

export class DisplayManager {
  private readonly vars: SimVars;
  private readonly o: DisplayManagerOptions;
  private readonly sched = new RefreshScheduler();
  private readonly map = new Map<string, Entry>();
  private readonly list: Entry[] = [];
  private readonly dueOut: ScheduleEntry[] = [];
  private readonly dueDt: number[] = [];
  readonly stats = { frames: 0, renders: 0, uploads: 0, skipped: 0 };

  constructor(vars: SimVars, o: DisplayManagerOptions = {}) {
    this.vars = vars;
    this.o = o;
  }

  /** Registers a display on a mesh. The mesh's material is replaced (and restored on remove). */
  add(display: CockpitDisplay, mesh: THREE.Mesh, opts?: DisplayOptions): DisplayHandle {
    if (this.map.has(display.id)) throw new Error(`DisplayManager: duplicate display id '${display.id}'`);
    const options: DisplayOptions = opts ?? (mesh.userData.displayOptions as DisplayOptions | undefined) ?? {};
    const texture = new THREE.CanvasTexture<AnyCanvas>(display.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mip = options.mipmaps ?? true;
    texture.generateMipmaps = mip;
    texture.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = options.anisotropy ?? this.o.anisotropy ?? 4;
    texture.name = `display.${display.id}`;
    const material = new THREE.MeshBasicMaterial({ map: texture, color: 0x000000, toneMapped: false });
    material.name = `display.${display.id}`;
    const prevMaterial = mesh.material;
    mesh.material = material;
    let glassMesh: THREE.Mesh | null = null;
    if ((options.glass ?? true) && this.o.materials) {
      glassMesh = new THREE.Mesh(mesh.geometry, this.o.materials.displayGlass());
      glassMesh.position.z = 0.0015;
      glassMesh.renderOrder = 3;
      glassMesh.name = `displayGlass.${display.id}`;
      mesh.add(glassMesh);
    }
    const sched = this.sched.add(display.id, display.refreshHz);
    const e: Entry = {
      display,
      mesh,
      texture,
      material,
      options,
      powered: false,
      booting: false,
      bootLeft: 0,
      brightness: 1,
      renders: 0,
      uploads: 0,
      forceRender: () => {
        sched.force = true;
      },
      sched,
      powerVar: options.powerVar ?? DISPLAY_VARS.power(display.id),
      brtVar: options.brightnessVar ?? DISPLAY_VARS.brightness(display.id),
      readyVar: DISPLAY_VARS.ready(display.id),
      splash: null,
      glassMesh,
      lastBrt: -1,
      prevMaterial,
    };
    sched.paused = true; // until the first update decides power
    this.map.set(display.id, e);
    this.list.push(e);
    return e;
  }

  get(id: string): DisplayHandle | undefined {
    return this.map.get(id);
  }

  /** All handles. */
  handles(): readonly DisplayHandle[] {
    return this.list;
  }

  remove(id: string): void {
    const e = this.map.get(id);
    if (!e) return;
    this.map.delete(id);
    this.list.splice(this.list.indexOf(e), 1);
    this.sched.remove(id);
    e.mesh.material = e.prevMaterial;
    if (e.glassMesh) e.mesh.remove(e.glassMesh);
    e.texture.dispose();
    e.material.dispose();
    e.splash?.texture.dispose();
  }

  /** Per-frame update: power, brightness, boot, throttled rendering. */
  update(dt: number): void {
    this.stats.frames++;
    const v = this.vars;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      const powered = !v.has(e.powerVar) || v.get(e.powerVar) !== 0;
      if (powered !== e.powered) this.setPower(e, powered);
      if (e.booting) {
        e.bootLeft -= dt;
        this.drawSplash(e, dt);
        if (e.bootLeft <= 0) this.finishBoot(e);
      }
      const brt = v.has(e.brtVar) ? Math.min(1, Math.max(0, v.get(e.brtVar))) : 1;
      if (Math.abs(brt - e.lastBrt) > 1e-4) {
        e.lastBrt = brt;
        e.brightness = brt;
        e.display.setBrightness?.(brt);
        this.applyColor(e);
      }
    }
    const n = this.sched.tick(dt, this.o.maxRendersPerFrame ?? 4, this.dueOut, this.dueDt);
    for (let i = 0; i < n; i++) {
      const e = this.map.get(this.dueOut[i].id);
      if (!e) continue;
      e.renders++;
      this.stats.renders++;
      if (e.display.render(this.dueDt[i])) {
        e.texture.needsUpdate = true;
        e.uploads++;
        this.stats.uploads++;
      } else this.stats.skipped++;
    }
  }

  dispose(): void {
    for (const e of [...this.list]) {
      this.remove(e.display.id);
      e.display.dispose?.();
    }
  }

  // ---------------------------------------------------------------------------

  private setPower(e: Entry, on: boolean): void {
    e.powered = on;
    if (!on) {
      e.booting = false;
      e.sched.paused = true;
      e.display.setBrightness?.(0);
      this.vars.set(e.readyVar, 0);
      e.lastBrt = -1;
      this.applyColor(e);
      return;
    }
    const boot = e.options.boot;
    if (boot && boot.seconds > 0) {
      e.booting = true;
      e.bootLeft = boot.seconds;
      e.sched.paused = true;
      this.ensureSplash(e);
      if (e.splash) {
        e.material.map = e.splash.texture;
        e.material.needsUpdate = true;
        e.splash.lastDraw = Infinity;
      }
      this.vars.set(e.readyVar, 0);
    } else this.finishBoot(e);
    e.lastBrt = -1;
    this.applyColor(e);
  }

  private finishBoot(e: Entry): void {
    e.booting = false;
    e.bootLeft = 0;
    if (e.material.map !== e.texture) {
      e.material.map = e.texture;
      e.material.needsUpdate = true;
    }
    e.sched.paused = false;
    e.sched.force = true;
    this.vars.set(e.readyVar, 1);
    this.applyColor(e);
  }

  private applyColor(e: Entry): void {
    const dim = e.options.dimMaterial ?? !e.display.setBrightness;
    const k = e.powered ? (dim ? e.brightness : 1) * (e.options.gain ?? 1) : 0;
    e.material.color.setScalar(k);
  }

  private ensureSplash(e: Entry): void {
    if (e.splash) return;
    const w = Math.max(64, Math.round(e.display.width / 2));
    const h = Math.max(48, Math.round(e.display.height / 2));
    const canvas = createCanvas(w, h);
    const ctx = context2d(canvas);
    if (!canvas || !ctx) return;
    const texture = new THREE.CanvasTexture<AnyCanvas>(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    e.splash = { canvas, ctx, texture, lastDraw: Infinity };
  }

  private drawSplash(e: Entry, dt: number): void {
    const s = e.splash;
    const boot = e.options.boot;
    if (!s || !boot) return;
    s.lastDraw += dt;
    if (s.lastDraw < 0.1) return;
    s.lastDraw = 0;
    const w = s.canvas.width;
    const h = s.canvas.height;
    const elapsed = boot.seconds - e.bootLeft;
    if (boot.draw) boot.draw(s.ctx, w, h, elapsed, boot.seconds);
    else drawDefaultSplash(s.ctx, w, h, boot.title ?? e.display.id, elapsed / boot.seconds);
    s.texture.needsUpdate = true;
  }
}

/** Default boot splash: black screen, title, thin progress bar. */
export function drawDefaultSplash(ctx: AnyContext2D, w: number, h: number, title: string, progress: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d8dde6';
  ctx.font = `600 ${Math.round(h * 0.08)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, w / 2, h * 0.45);
  const bw = w * 0.4;
  ctx.strokeStyle = '#5c6370';
  ctx.lineWidth = 1;
  ctx.strokeRect((w - bw) / 2, h * 0.6, bw, h * 0.02);
  ctx.fillStyle = '#9aa3b2';
  ctx.fillRect((w - bw) / 2, h * 0.6, bw * Math.min(1, Math.max(0, progress)), h * 0.02);
}
