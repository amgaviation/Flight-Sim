/**
 * Knob mounted on an instrument bezel (baro set, OBS, heading bug, DG set,
 * attitude adjust, ADF card, EGT reference, TAS ring). Follows the cockpit
 * mouse model from cockpit/types.ts:
 *   left click = one detent clockwise, right click = one detent counter-
 *   clockwise, wheel = detents (Shift = fine/inner), left drag = continuous
 *   (horizontal or vertical), middle click = push.
 * The knob animates its own rotation and reports detents through `onTurn`.
 */
import * as THREE from 'three';
import type { ControlPointer } from '../../cockpit/types';
import { knobGeometry } from './geometry';

export interface GaugeKnobOptions {
  /** Label used in tooltips ("BARO", "OBS", "HDG"). */
  name: string;
  /** Knob centre in the gauge frame (m). */
  x: number;
  y: number;
  /** Knob base z (default: the gauge's bezel front). */
  z?: number;
  radius?: number;
  length?: number;
  /** Detents turned (+ = clockwise); `fine` = Shift held (inner knob / fine step). */
  onTurn: (steps: number, fine: boolean) => void;
  /** Middle click / push. */
  onPush?: () => void;
  /** Push released (for push-and-hold functions). */
  onRelease?: () => void;
  /** Drag distance (px) per detent. Default 10. */
  dragPxPerStep?: number;
  /** Visual rotation per detent (deg). Default 18. */
  detentDeg?: number;
  material?: THREE.Material;
  /** Called after every detent (the gauge plays the click sound). */
  onDetent?: () => void;
}

export class GaugeKnob {
  readonly name: string;
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private readonly o: GaugeKnobOptions;
  private angle = 0;
  private targetAngle = 0;
  private dragAcc = 0;
  private pushed = 0;
  private readonly geometry: THREE.BufferGeometry;

  constructor(opts: GaugeKnobOptions, defaultZ: number, defaultMaterial: THREE.Material) {
    this.o = opts;
    this.name = opts.name;
    const r = opts.radius ?? 0.0075;
    const len = opts.length ?? 0.011;
    this.geometry = knobGeometry(r, len);
    this.mesh = new THREE.Mesh(this.geometry, opts.material ?? defaultMaterial);
    this.mesh.name = `knob.${opts.name}`;
    // Index line so rotation is visible.
    this.group.position.set(opts.x, opts.y, opts.z ?? defaultZ);
    this.group.add(this.mesh);
  }

  /** Adds an index mark mesh (child of the rotating knob). */
  attachIndex(mark: THREE.Object3D): void {
    this.mesh.add(mark);
  }

  owns(obj: THREE.Object3D | null): boolean {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (o === this.mesh || o === this.group) return true;
    return false;
  }

  down(p: ControlPointer): void {
    if (p.button === 1) {
      this.pushed = 1;
      this.o.onPush?.();
      return;
    }
    this.dragAcc = 0;
    this.turn(p.button === 2 ? -1 : 1, p.shift);
  }

  up(p: ControlPointer): void {
    if (p.button === 1 || this.pushed > 0) {
      this.pushed = 0;
      this.o.onRelease?.();
    }
  }

  wheel(delta: number, p: ControlPointer): void {
    const n = Math.round(delta);
    if (n !== 0) this.turn(n, p.shift);
  }

  drag(dx: number, dy: number, p: ControlPointer): void {
    // Right/up = clockwise.
    this.dragAcc += dx - dy;
    const per = this.o.dragPxPerStep ?? 10;
    const steps = Math.trunc(this.dragAcc / per);
    if (steps !== 0) {
      this.dragAcc -= steps * per;
      this.turn(steps, p.shift);
    }
  }

  /** Programmatic turn (keyboard bindings, tests). */
  turn(steps: number, fine = false): void {
    if (steps === 0) return;
    this.o.onTurn(steps, fine);
    this.targetAngle += steps * (this.o.detentDeg ?? 18);
    this.o.onDetent?.();
  }

  update(dt: number): void {
    // Knob follows detents quickly (~40 ms).
    const k = 1 - Math.exp(-dt / 0.04);
    this.angle += (this.targetAngle - this.angle) * k;
    this.mesh.rotation.z = (-this.angle * Math.PI) / 180;
    this.mesh.position.z = this.pushed > 0 ? -0.0012 : 0;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
