/**
 * Base class for electromechanical (steam-gauge) instruments as 3D cockpit
 * controls (CockpitControl from cockpit/types.ts).
 *
 * Construction: square (3ATI/2ATI flange with four screws) or round bezel,
 * a black case wall, the painted dial (canvas texture, emissive under
 * instrument lighting, see-through windows via alphaTest), separate needle
 * / card / drum meshes at their own depths (real parallax), a black backing
 * disc behind the dial, and a cover glass with clearcoat reflections.
 * Only knobs are interactive (hit targets); the gauge dispatches pointer
 * events to the knob that was hit.
 *
 * Subclasses implement `updateGauge(dt)` (read vars, run needle dynamics,
 * set mesh rotations) and `tooltip()`; they build their dial in the
 * constructor with `addDial`, `addNeedle`, `addCard`, `addKnob`.
 *
 * Local frame: dial in the XY plane at z = 0, +y up (12 o'clock), +z toward
 * the pilot. The aircraft cockpit builder positions `object`.
 */
import * as THREE from 'three';
import type { AudioApi } from '../../core/SimContext';
import type { SimVars } from '../../core/SimVars';
import { COCKPIT_SOUNDS, type CockpitControl, type ControlPointer } from '../../cockpit/types';
import { DEG2RAD } from '../../core/math';
import { createDisplayCanvas, type DisplayCanvas } from '../common/CanvasDisplay';
import type { Ctx2D } from '../common/draw/context';
import { FaceCanvas } from './face';
import { GaugeKnob, type GaugeKnobOptions } from './GaugeKnob';
import {
  DIAL_RADIUS_FRACTION,
  INSTRUMENT_SIZE,
  caseWallGeometry,
  createGaugeMaterials,
  hubGeometry,
  needleGeometry,
  roundBezelGeometry,
  screwGeometry,
  squareBezelGeometry,
  type GaugeMaterialSet,
  type NeedleSpec,
} from './geometry';
import { ANALOG_VARS } from './vars';

export interface AnalogGaugeOptions {
  id: string;
  /** Display name for tooltips. */
  name?: string;
  vars: SimVars;
  /** Knob detent sounds (COCKPIT_SOUNDS.knobDetent). */
  audio?: AudioApi;
  /** Case size (m): INSTRUMENT_SIZE.ATI3 (default) or ATI2. */
  size?: number;
  bezel?: 'square' | 'round' | 'none';
  /** Dial-to-glass depth (m). Default 0.11 x size. */
  depth?: number;
  /** Face texture resolution (px). Default 512. */
  textureSize?: number;
  /** 0..1 instrument lighting var. Default ANALOG_VARS.instrumentLight. */
  lightVar?: string;
  /** Emissive colour of lit markings. EST warm white (incandescent/LED post lighting). */
  lightColor?: THREE.ColorRepresentation;
  /** Optional shared materials (e.g. from the cockpit material library). */
  materials?: Partial<Pick<GaugeMaterialSet, 'bezel' | 'knob' | 'screw'>>;
  /** Flange corners occupied by knobs (no mounting screw drawn there). */
  knobCorners?: readonly ('tl' | 'tr' | 'bl' | 'br')[];
}

/** A plane with a canvas texture redrawn at run time (hour meters, LCDs, drums). */
export interface DynamicPlane {
  canvas: DisplayCanvas;
  ctx: Ctx2D;
  texture: THREE.CanvasTexture<DisplayCanvas>;
  material: THREE.MeshStandardMaterial;
  mesh: THREE.Mesh;
  /** Call after drawing into `ctx` to upload the texture. */
  commit(): void;
}

/** Knob centre (m) at a flange corner of a case of `size`. */
export function cornerKnobPosition(size: number, corner: 'tl' | 'tr' | 'bl' | 'br'): { x: number; y: number } {
  const o = size * 0.4;
  return { x: corner === 'tl' || corner === 'bl' ? -o : o, y: corner === 'tl' || corner === 'tr' ? o : -o };
}

export abstract class AnalogGauge implements CockpitControl {
  readonly id: string;
  readonly name: string;
  readonly object = new THREE.Group();
  readonly hitTargets: THREE.Object3D[] = [];
  /** Case size and derived dimensions (m). */
  readonly size: number;
  readonly dialR: number;
  readonly depth: number;
  readonly frontZ: number;
  readonly textureSize: number;

  protected readonly vars: SimVars;
  protected readonly audio?: AudioApi;
  protected readonly mats: GaugeMaterialSet;
  protected readonly knobs: GaugeKnob[] = [];
  /** Materials whose emissiveIntensity follows the instrument lighting. */
  protected readonly litMaterials: THREE.MeshStandardMaterial[] = [];
  /** Current lighting level 0..1. */
  protected light = 0;
  private readonly lightVar: string;
  private readonly lightColor: THREE.Color;
  private readonly disposables: { dispose(): void }[] = [];
  private activeKnob: GaugeKnob | null = null;

  constructor(o: AnalogGaugeOptions) {
    this.id = o.id;
    this.name = o.name ?? o.id;
    this.vars = o.vars;
    this.audio = o.audio;
    this.size = o.size ?? INSTRUMENT_SIZE.ATI3;
    this.dialR = this.size * DIAL_RADIUS_FRACTION;
    this.depth = o.depth ?? this.size * 0.11;
    this.frontZ = this.depth + 0.0022;
    this.textureSize = o.textureSize ?? 512;
    this.lightVar = o.lightVar ?? ANALOG_VARS.instrumentLight;
    this.lightColor = new THREE.Color(o.lightColor ?? '#ffd9a8');
    this.mats = createGaugeMaterials(this.lightColor, o.materials ?? {});
    for (const k of ['wall', 'needle', 'hub', 'glass'] as const) this.track(this.mats[k]);
    if (!o.materials?.bezel) this.track(this.mats.bezel);
    if (!o.materials?.knob) this.track(this.mats.knob);
    if (!o.materials?.screw) this.track(this.mats.screw);
    this.litMaterials.push(this.mats.needle);
    this.object.name = `gauge.${o.id}`;
    this.buildCase(o.bezel ?? 'square', o.knobCorners ?? []);
  }

  // ---------------------------------------------------------------- construction helpers

  protected track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  /** New face canvas at this gauge's texture resolution. */
  protected face(sizePx = this.textureSize): FaceCanvas {
    return new FaceCanvas(sizePx);
  }

  /**
   * Adds a painted disc (the dial, a rotating card or a drum face) from a
   * FaceCanvas. `windows` enables alphaTest so transparent pixels are holes.
   * Returns the mesh (rotate it for cards).
   */
  protected addDial(face: FaceCanvas, z = 0, radius = this.dialR, parent: THREE.Object3D = this.object, windows = false, lit = true): THREE.Mesh {
    const tex = this.track(face.texture());
    const mat = this.track(
      new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: lit ? tex : null,
        emissive: lit ? this.lightColor : new THREE.Color(0),
        emissiveIntensity: 0,
        roughness: 0.82,
        metalness: 0,
        alphaTest: windows ? 0.5 : 0,
        transparent: false,
        name: `gauge.${this.id}.dial`,
      }),
    );
    if (lit) this.litMaterials.push(mat);
    const geo = this.track(new THREE.CircleGeometry(radius, 96));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = z;
    parent.add(mesh);
    return mesh;
  }

  /** Adds a textured rectangle (flags, drum strips, LCD windows). */
  protected addPlane(face: FaceCanvas, w: number, h: number, x: number, y: number, z: number, parent: THREE.Object3D = this.object, lit = true, alpha = false): THREE.Mesh {
    const tex = this.track(face.texture());
    const mat = this.track(
      new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: lit ? tex : null,
        emissive: lit ? this.lightColor : new THREE.Color(0),
        emissiveIntensity: 0,
        roughness: 0.8,
        metalness: 0,
        alphaTest: alpha ? 0.5 : 0,
      }),
    );
    if (lit) this.litMaterials.push(mat);
    const mesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(w, h)), mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  /**
   * Adds a plane whose canvas the subclass redraws when its content changes
   * (call `commit()` after drawing). `lit`: emissive under instrument
   * lighting; `emissive`: a self-lit display (LCD backlight) whose intensity
   * the subclass drives.
   */
  protected addDynamicPlane(pxW: number, pxH: number, w: number, h: number, x: number, y: number, z: number, opts: { lit?: boolean; parent?: THREE.Object3D } = {}): DynamicPlane {
    const canvas = createDisplayCanvas(pxW, pxH);
    const ctx = canvas.getContext('2d') as Ctx2D | null;
    if (!ctx) throw new Error('AnalogGauge: 2D context unavailable');
    const texture = this.track(new THREE.CanvasTexture<DisplayCanvas>(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    const lit = opts.lit ?? true;
    const material = this.track(
      new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: lit ? this.lightColor : new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.7, metalness: 0 }),
    );
    if (lit) this.litMaterials.push(material);
    const mesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(w, h)), material);
    mesh.position.set(x, y, z);
    (opts.parent ?? this.object).add(mesh);
    return {
      canvas,
      ctx,
      texture,
      material,
      mesh,
      commit: () => {
        texture.needsUpdate = true;
      },
    };
  }

  /**
   * Adds a needle on a pivot at (x, y, z). Returns the pivot group; set its
   * angle with `AnalogGauge.setAngle(pivot, deg)` (deg clockwise from 12).
   */
  protected addNeedle(spec: NeedleSpec, opts: { x?: number; y?: number; z: number; material?: THREE.Material; hubRadius?: number; parent?: THREE.Object3D }): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(opts.x ?? 0, opts.y ?? 0, opts.z);
    const geo = this.track(needleGeometry(spec, this.dialR));
    const mesh = new THREE.Mesh(geo, opts.material ?? this.mats.needle);
    pivot.add(mesh);
    if (opts.hubRadius !== 0) {
      const hr = opts.hubRadius ?? this.dialR * 0.08;
      const hub = new THREE.Mesh(this.track(hubGeometry(hr, 0.0012)), this.mats.hub);
      hub.position.z = (spec.thickness ?? 0.0004) + 0.0001;
      pivot.add(hub);
    }
    (opts.parent ?? this.object).add(pivot);
    return pivot;
  }

  /** Adds a bezel knob; its mesh becomes a hit target. */
  protected addKnob(opts: GaugeKnobOptions): GaugeKnob {
    const k = new GaugeKnob({ ...opts, onDetent: opts.onDetent ?? (() => this.audio?.play(COCKPIT_SOUNDS.knobDetent, { volume: 0.5 })) }, this.frontZ, this.mats.knob);
    // White index line on the knob face.
    const idx = new THREE.Mesh(this.track(new THREE.PlaneGeometry((opts.radius ?? 0.0075) * 0.15, (opts.radius ?? 0.0075) * 0.8)), this.mats.needle);
    idx.position.set(0, (opts.radius ?? 0.0075) * 0.45, (opts.length ?? 0.011) + 0.0002);
    k.attachIndex(idx);
    this.object.add(k.group);
    this.hitTargets.push(k.mesh);
    this.knobs.push(k);
    this.track(k);
    return k;
  }

  /** Sets a pivot's rotation from a dial angle (deg clockwise from 12 o'clock). */
  static setAngle(obj: THREE.Object3D, deg: number): void {
    obj.rotation.z = -deg * DEG2RAD;
  }

  // ---------------------------------------------------------------- CockpitControl

  update(dt: number): void {
    const l = this.vars.get(this.lightVar, 0);
    const light = l < 0 ? 0 : l > 1 ? 1 : l;
    if (light !== this.light) {
      this.light = light;
      // EST: fully lit markings ~0.9 emissive (readable at night, not glaring).
      const e = light * 0.9;
      for (let i = 0; i < this.litMaterials.length; i++) this.litMaterials[i].emissiveIntensity = e;
    }
    for (let i = 0; i < this.knobs.length; i++) this.knobs[i].update(dt);
    this.updateGauge(dt);
  }

  abstract tooltip(): string;
  protected abstract updateGauge(dt: number): void;

  onPointerDown(p: ControlPointer): void {
    const k = this.knobFor(p.object);
    if (!k) return;
    this.activeKnob = k;
    k.down(p);
  }

  onPointerUp(p: ControlPointer): void {
    this.activeKnob?.up(p);
    this.activeKnob = null;
  }

  onDrag(dx: number, dy: number, p: ControlPointer): void {
    this.activeKnob?.drag(dx, dy, p);
  }

  onWheel(delta: number, p: ControlPointer): void {
    this.knobFor(p.object)?.wheel(delta, p);
  }

  onCancel(): void {
    this.activeKnob = null;
  }

  cursor(): string {
    return 'grab';
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.object.removeFromParent();
  }

  /** Programmatic knob access (keyboard bindings, tests). */
  knob(name: string): GaugeKnob | undefined {
    return this.knobs.find((k) => k.name === name);
  }

  // ---------------------------------------------------------------- internals

  private knobFor(obj: THREE.Object3D): GaugeKnob | null {
    for (const k of this.knobs) if (k.owns(obj)) return k;
    return this.knobs.length === 1 ? this.knobs[0] : null;
  }

  private buildCase(bezel: 'square' | 'round' | 'none', knobCorners: readonly string[]): void {
    const R = this.dialR;
    // Black backing behind the dial (seen through dial windows).
    const back = new THREE.Mesh(this.track(new THREE.CircleGeometry(R * 1.02, 48)), this.mats.wall);
    back.material = this.track(new THREE.MeshStandardMaterial({ color: '#050505', roughness: 1, metalness: 0 }));
    back.position.z = -0.012;
    this.object.add(back);
    // Case wall between dial and glass.
    const wall = new THREE.Mesh(this.track(caseWallGeometry(R * 1.015, this.depth + 0.012)), this.mats.wall);
    wall.position.z = -0.012;
    this.object.add(wall);
    // Glass.
    const glass = new THREE.Mesh(this.track(new THREE.CircleGeometry(R * 1.03, 64)), this.mats.glass);
    glass.position.z = this.depth;
    glass.renderOrder = 10;
    this.object.add(glass);
    if (bezel === 'none') return;
    if (bezel === 'round') {
      const ring = new THREE.Mesh(this.track(roundBezelGeometry(R * 1.02, this.size / 2, this.frontZ)), this.mats.bezel);
      this.object.add(ring);
      return;
    }
    const plate = new THREE.Mesh(this.track(squareBezelGeometry(this.size, R * 1.02, this.frontZ)), this.mats.bezel);
    this.object.add(plate);
    // Four mounting screws (AS 26 / ARINC 408 flange pattern, EST positions).
    const sg = this.track(screwGeometry(this.size * 0.035));
    const o = this.size * 0.4;
    for (const [corner, sx, sy] of [
      ['tl', -o, o],
      ['tr', o, o],
      ['bl', -o, -o],
      ['br', o, -o],
    ] as const) {
      if (knobCorners.includes(corner)) continue;
      const sc = new THREE.Mesh(sg, this.mats.screw);
      sc.position.set(sx, sy, this.frontZ);
      this.object.add(sc);
    }
  }
}
