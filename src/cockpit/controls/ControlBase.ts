/**
 * Shared plumbing for every interactive cockpit control: identity, root
 * object, hit boxes, tooltip, SimVar/EventBus helpers, sounds and engraved
 * labels. Concrete controls implement the pointer handlers and `update`.
 *
 * Frame: a control's `object` uses the panel frame (X right, Y up, Z out of
 * the panel toward the viewer) and stands on z = 0. Place it with
 * `placeOnPanel(control.object, u, v)` or `Panel.add(control, u, v)`.
 */
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../types';
import type { CockpitEnv } from '../env';
import type { MaterialName } from '../materials';
import type { TextStyle, LabelMesh } from '../labels';
import { hitBox } from '../geometry/primitives';

export interface ControlOptions {
  /** Unique control id (e.g. 'ovhd.batt'). */
  id: string;
  /** Human-readable name shown in the tooltip (default: id). */
  label?: string;
  /** Replaces the whole tooltip text. */
  tooltip?: string | (() => string);
  /** Overrides the actuation sound id (null = silent). */
  sound?: string | null;
  /** Sound volume multiplier (default 1). */
  volume?: number;
  /** Called after the control writes a new value to its var (value = new var value). */
  onChange?: (value: number) => void;
  /** Disables pointer interaction while this var is 0 (e.g. a control hidden behind a closed door). */
  enabledVar?: string;
}

export abstract class ControlBase implements CockpitControl {
  readonly id: string;
  readonly object: THREE.Group;
  readonly hitTargets: THREE.Object3D[] = [];
  readonly label: string;
  protected readonly env: CockpitEnv;
  protected readonly baseOpts: ControlOptions;
  /** Per-instance materials to release on dispose. */
  protected readonly ownedMaterials: THREE.Material[] = [];
  /** Per-instance geometries to dispose (cached geometries are never listed here). */
  protected readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly scratch = new THREE.Vector3();
  private disposed = false;

  constructor(env: CockpitEnv, opts: ControlOptions) {
    this.env = env;
    this.baseOpts = opts;
    this.id = opts.id;
    this.label = opts.label ?? opts.id;
    this.object = new THREE.Group();
    this.object.name = `control:${opts.id}`;
    this.object.userData.control = this;
  }

  tooltip(): string {
    const t = this.baseOpts.tooltip;
    if (typeof t === 'function') return t();
    if (typeof t === 'string') return t;
    const s = this.stateText();
    return s ? `${this.label}: ${s}` : this.label;
  }

  /** Current state for the tooltip (e.g. 'ON', '12.5'). */
  protected abstract stateText(): string;

  /** False while `enabledVar` is 0. */
  get enabled(): boolean {
    const v = this.baseOpts.enabledVar;
    return !v || this.env.vars.get(v, 1) !== 0;
  }

  update(_dt: number): void {
    // Default: nothing to animate.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    for (const m of this.ownedMaterials) {
      this.env.lighting.unregister(m);
      this.env.materials.release(m);
    }
    this.ownedMaterials.length = 0;
    for (const g of this.ownedGeometries) g.dispose();
    this.ownedGeometries.length = 0;
    for (const h of this.hitTargets) {
      const m = h as THREE.Mesh;
      if (m.isMesh && !m.geometry.userData.cached) m.geometry.dispose();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers for subclasses
  // ---------------------------------------------------------------------------

  /** Plays the control's actuation sound (respecting the `sound` override). */
  protected playSound(defaultId: string | null, volume = 1, rate = 1): void {
    const id = this.baseOpts.sound === undefined ? defaultId : this.baseOpts.sound;
    if (!id) return;
    this.env.play(id, this.object, volume * (this.baseOpts.volume ?? 1), rate);
  }

  /** Writes a var (if named) and fires onChange when it changed. */
  protected writeVar(name: string | undefined | null, value: number): void {
    if (!name) return;
    const prev = this.env.vars.get(name, NaN);
    this.env.vars.set(name, value);
    if (prev !== value) this.baseOpts.onChange?.(value);
  }

  /** Reads a var with fallback. */
  protected readVar(name: string | undefined | null, fallback = 0): number {
    return name ? this.env.vars.get(name, fallback) : fallback;
  }

  /** Emits an event (if named). */
  protected emit(name: string | undefined | null, payload?: unknown): void {
    if (name) this.env.events.emit(name, payload);
  }

  /** Initializes an unset var to the control's physical default. */
  protected initVar(name: string | undefined | null, value: number): void {
    if (name && !this.env.vars.has(name)) this.env.vars.set(name, value);
  }

  /** Adds an invisible hit box to `parent` (default the root) and registers it. */
  protected addHitBox(w: number, h: number, d: number, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.object): THREE.Mesh {
    const m = hitBox(this.env.materials.get('hitbox'), w, h, d, x, y, z);
    parent.add(m);
    this.hitTargets.push(m);
    return m;
  }

  /** Creates a mesh with a shared material and cached geometry. */
  protected mesh(geometry: THREE.BufferGeometry, material: MaterialName | THREE.Material, parent: THREE.Object3D = this.object, isStatic = false): THREE.Mesh {
    const mat = typeof material === 'string' ? this.env.materials.get(material) : material;
    const m = new THREE.Mesh(geometry, mat);
    m.castShadow = false;
    m.receiveShadow = false;
    if (isStatic) m.userData.cockpitStatic = true;
    parent.add(m);
    return m;
  }

  /** Cached geometry by key. */
  protected geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    return this.env.geometry.get(key, make);
  }

  /** Engraved/backlit label added to `parent` at (x, y). Static unless `moving`. */
  protected engrave(text: string, x: number, y: number, style: Partial<TextStyle> & { height?: number } = {}, parent: THREE.Object3D = this.object, moving = false): LabelMesh {
    const l = this.env.labels.text(text, { height: 0.0026, ...style });
    l.position.x = x;
    l.position.y = y;
    l.userData.cockpitStatic = !moving;
    parent.add(l);
    return l;
  }

  /** Converts the pointer's world hit point to `target`'s local frame (shared scratch vector). */
  protected localPoint(p: ControlPointer, target: THREE.Object3D = this.object): THREE.Vector3 {
    target.updateWorldMatrix(true, false);
    return target.worldToLocal(this.scratch.copy(p.point));
  }

  /** Tracks a per-instance material for disposal. */
  protected own<T extends THREE.Material>(m: T): T {
    this.ownedMaterials.push(m);
    return m;
  }
}

/** Formats a number for tooltips with a fixed number of decimals (trailing zeros kept). */
export function fmt(v: number, decimals = 0): string {
  return v.toFixed(decimals);
}
