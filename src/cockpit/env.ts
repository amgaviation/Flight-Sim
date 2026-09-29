/**
 * Shared construction context for cockpit parts.
 *
 * Every control takes a `CockpitEnv` as its first constructor argument. It
 * bundles the sim data plumbing (SimVars, EventBus, audio) with the shared
 * render resources (materials, label atlas, lighting, geometry cache) so that
 * hundreds of controls share textures, materials and geometry instead of each
 * allocating their own.
 *
 * `createCockpitEnv` works in node (unit tests): canvas-backed resources
 * degrade to untextured materials when no canvas implementation exists.
 */
import * as THREE from 'three';
import type { SimVars } from '../core/SimVars';
import type { EventBus } from '../core/EventBus';
import type { AudioApi } from '../core/SimContext';
import { CockpitMaterials, type PaletteId, type PaletteDef } from './materials';
import { LabelFactory } from './labels';
import { CockpitLighting } from './Lighting';
import { objectPointToBody } from './frame';

/** The part of `SimContext` the cockpit needs (a full SimContext satisfies it). */
export interface CockpitHost {
  vars: SimVars;
  events: EventBus;
  audio?: AudioApi | null;
}

export interface CockpitEnv extends CockpitHost {
  readonly materials: CockpitMaterials;
  readonly labels: LabelFactory;
  readonly lighting: CockpitLighting;
  readonly geometry: GeometryCache;
  /**
   * Cockpit root group (the aircraft-datum frame). Set by CockpitBuilder; used
   * to compute body-frame sound positions. May be null for loose controls.
   */
  root: THREE.Object3D | null;
  /** Master volume scale for control sounds (default 1). */
  soundVolume: number;
  /** Plays a control sound (no-op without audio). `from` gives the 3D position. */
  play(id: string | null | undefined, from?: THREE.Object3D, volume?: number, rate?: number): void;
  /** Frees every shared resource (materials, textures, geometry). */
  dispose(): void;
}

export interface CockpitEnvOptions {
  /** Manufacturer palette for panel paint, knobs and backlight colours (default 'citation'). */
  palette?: PaletteId | PaletteDef;
  /** Master volume scale for control sounds. */
  soundVolume?: number;
  /** Label atlas page size in pixels (default 2048). */
  atlasSize?: number;
}

/** Creates the shared environment. `host` may be a full SimContext. */
export function createCockpitEnv(host: CockpitHost, opts: CockpitEnvOptions = {}): CockpitEnv {
  const materials = new CockpitMaterials(opts.palette ?? 'citation');
  const lighting = new CockpitLighting(host.vars, materials);
  const labels = new LabelFactory(materials, lighting, { atlasSize: opts.atlasSize });
  const geometry = new GeometryCache();
  const pos: [number, number, number] = [0, 0, 0];
  const env: CockpitEnv = {
    vars: host.vars,
    events: host.events,
    audio: host.audio ?? null,
    materials,
    labels,
    lighting,
    geometry,
    root: null,
    soundVolume: opts.soundVolume ?? 1,
    play(id, from, volume = 1, rate = 1) {
      const audio = env.audio;
      if (!audio || !id) return;
      const vol = volume * env.soundVolume;
      if (from && env.root) {
        objectPointToBody(from, env.root, null, pos);
        audio.play(id, { volume: vol, rate, position: [pos[0], pos[1], pos[2]] });
      } else {
        audio.play(id, { volume: vol, rate });
      }
    },
    dispose() {
      labels.dispose();
      materials.dispose();
      geometry.dispose();
      lighting.dispose();
    },
  };
  return env;
}

/**
 * Keyed geometry cache. Identical parts (toggle handles, screw heads, knob
 * caps) share one BufferGeometry. Geometries obtained here must not be
 * disposed by their users; the cache owns them.
 */
export class GeometryCache {
  private readonly map = new Map<string, THREE.BufferGeometry>();

  get(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.map.get(key);
    if (!g) {
      g = make();
      g.userData.cached = true;
      this.map.set(key, g);
    }
    return g;
  }

  get size(): number {
    return this.map.size;
  }

  dispose(): void {
    for (const g of this.map.values()) g.dispose();
    this.map.clear();
  }
}

/** A 2D drawing surface (DOM canvas in the browser, OffscreenCanvas in workers). */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Creates a canvas, or returns null when none is available (node tests). */
export function createCanvas(w: number, h: number): AnyCanvas | null {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

/** 2D context of a canvas created by {@link createCanvas}, or null. */
export function context2d(c: AnyCanvas | null): AnyContext2D | null {
  if (!c) return null;
  try {
    return (c.getContext('2d') as AnyContext2D | null) ?? null;
  } catch {
    return null;
  }
}
