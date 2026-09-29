/**
 * CockpitRuntime: wires a CockpitBuild into the app frame loop.
 *
 *   const rt = new CockpitRuntime({ build, vars, domElement: renderer.domElement, camera, renderer });
 *   // every frame, after the sim steps and before renderer.render:
 *   rt.update(dt);
 *
 * It registers every control (including sub-controls of composites such as
 * the yoke) and display with a CockpitInteraction (when a DOM element and a
 * camera are given) and a DisplayManager, and per frame runs, in order:
 * control.update(dt) for every control (sub-controls of composites are in
 * build.controls and are updated here, not by their owner), build.update(dt) (lighting, label
 * atlas, aircraft hooks), displays.update(dt), interaction.update(dt).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SimVars } from '../core/SimVars';
import type { CockpitBuild, CockpitControl } from './types';
import { CockpitInteraction, type CockpitInteractionOptions } from './Interaction';
import { DisplayManager, type DisplayManagerOptions } from './DisplayManager';
import type { CockpitBuildEx } from './CockpitBuilder';
import type { CompositeControl } from './controls/FlightControls';

export interface CockpitRuntimeOptions {
  build: CockpitBuild;
  vars: SimVars;
  domElement?: HTMLElement;
  camera?: THREE.Camera;
  interaction?: Omit<CockpitInteractionOptions, 'domElement' | 'camera'>;
  displays?: DisplayManagerOptions;
  /** When given, an interior reflection environment (PMREM of RoomEnvironment) is applied to cockpit materials. */
  renderer?: THREE.WebGLRenderer;
}

export class CockpitRuntime {
  readonly build: CockpitBuild;
  readonly displays: DisplayManager;
  readonly interaction: CockpitInteraction | null;
  /** Every control, sub-controls included, in update order. */
  readonly controls: CockpitControl[] = [];
  private envTexture: THREE.Texture | null = null;

  constructor(o: CockpitRuntimeOptions) {
    this.build = o.build;
    const ex = o.build as Partial<CockpitBuildEx>;
    this.displays = new DisplayManager(o.vars, { materials: ex.env?.materials, ...o.displays });
    const seen = new Set<CockpitControl>();
    const collect = (c: CockpitControl) => {
      if (seen.has(c)) return;
      seen.add(c);
      this.controls.push(c);
      const sub = (c as unknown as Partial<CompositeControl>).subControls;
      if (sub) for (const s of sub) collect(s);
    };
    for (const c of o.build.controls) collect(c);
    for (const d of o.build.displays) this.displays.add(d.display, d.mesh);
    if (o.domElement && o.camera) {
      this.interaction = new CockpitInteraction({ ...o.interaction, domElement: o.domElement, camera: o.camera });
      this.interaction.registerAll(this.controls);
      for (const d of o.build.displays) this.interaction.registerDisplay(d.display, d.mesh);
      if (o.build.occluders?.length) this.interaction.setOccluders(o.build.occluders);
    } else this.interaction = null;
    if (o.renderer && ex.env) {
      this.envTexture = createInteriorEnvironment(o.renderer);
      ex.env.materials.setEnvironment(this.envTexture);
    }
  }

  setCamera(camera: THREE.Camera): void {
    this.interaction?.setCamera(camera);
  }

  /** Per-frame update (every control exactly once, sub-controls included). */
  update(dt: number): void {
    const cs = this.controls;
    for (let i = 0; i < cs.length; i++) cs[i].update?.(dt);
    this.build.update?.(dt);
    this.displays.update(dt);
    this.interaction?.update(dt);
  }

  dispose(): void {
    this.interaction?.dispose();
    this.displays.dispose();
    this.envTexture?.dispose();
    this.build.dispose?.();
  }
}

/**
 * Interior reflection environment: PMREM-filtered RoomEnvironment (a neutral
 * lit room), used as `envMap` for cockpit materials so metals and glossy
 * plastics reflect an interior instead of the sky.
 */
export function createInteriorEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const rt = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  return rt.texture;
}
