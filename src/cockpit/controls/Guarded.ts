/**
 * Guarded switches and guarded push buttons (hinged flip covers).
 *
 * Mouse: clicking the closed guard opens it (first click); with the guard
 * open, clicks on the switch/button operate it; clicking the open guard
 * closes it. Closing behaviour follows GuardLogic ('returns' pushes the
 * switch back to the guarded position as real spring guards do; 'blocks'
 * refuses to close unless the switch is in the guarded position; 'free').
 *
 * Vars: the inner control's var as usual; optional `guard.var` = 1 while the
 * guard is open (and the guard follows external writes to it).
 */
import * as THREE from 'three';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { MaterialName } from '../materials';
import { ControlBase } from './ControlBase';
import { GuardLogic, type GuardClose } from './logic/GuardLogic';
import { ToggleSwitch, type ToggleSwitchOptions } from './ToggleSwitch';
import { PushButton, type PushButtonOptions } from './PushButton';
import { guardBaseGeometry, guardCoverGeometry } from '../geometry/switches';
import { hitBox } from '../geometry/primitives';
import { smoothTo } from '../anim';

export interface GuardOptions {
  /** Cover colour (default red). */
  color?: 'red' | 'black' | 'yellow' | 'clear';
  /** Switch position the guard protects (default 0). */
  guardedPosition?: number;
  close?: GuardClose;
  /** Hinge edge (default 'top'). */
  hinge?: 'top' | 'bottom' | 'left' | 'right';
  /** Cover size (m): across, along (from hinge), height. */
  width?: number;
  length?: number;
  height?: number;
  /** Open angle (deg, default 105). */
  openDeg?: number;
  /** Var = 1 while open. */
  var?: string;
  initialOpen?: boolean;
}

const COLOR_MAT: Record<NonNullable<GuardOptions['color']>, MaterialName> = {
  red: 'guardRed',
  black: 'guardBlack',
  yellow: 'guardYellow',
  clear: 'guardClear',
};

/** Hinged cover geometry, animation and hit box. */
class GuardAssembly {
  readonly hinge = new THREE.Group();
  readonly pivot = new THREE.Group();
  readonly hit: THREE.Mesh;
  private angle = 0;
  private readonly openRad: number;

  constructor(env: CockpitEnv, parent: THREE.Object3D, o: GuardOptions, w: number, len: number, h: number) {
    this.openRad = THREE.MathUtils.degToRad(o.openDeg ?? 105);
    const side = o.hinge ?? 'top';
    const rot = { top: 0, bottom: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[side];
    const pos = { top: [0, len / 2], bottom: [0, -len / 2], left: [-len / 2, 0], right: [len / 2, 0] }[side];
    this.hinge.position.set(pos[0], pos[1], 0);
    this.hinge.rotation.z = rot;
    parent.add(this.hinge);
    const base = new THREE.Mesh(env.geometry.get(`guard.base.${w}.${len}`, () => guardBaseGeometry(w, 0.004)), env.materials.get(o.color === 'clear' ? 'guardBlack' : COLOR_MAT[o.color ?? 'red']));
    base.userData.cockpitStatic = true;
    this.hinge.add(base);
    this.pivot.position.z = 0.0025;
    this.hinge.add(this.pivot);
    const cover = new THREE.Mesh(env.geometry.get(`guard.cover.${w}.${len}.${h}`, () => guardCoverGeometry(w, len, h)), env.materials.get(COLOR_MAT[o.color ?? 'red']));
    this.pivot.add(cover);
    this.hit = hitBox(env.materials.get('hitbox'), w + 0.002, len + 0.002, h + 0.002, 0, -len / 2, h / 2);
    this.pivot.add(this.hit);
  }

  update(dt: number, open: boolean): void {
    this.angle = smoothTo(this.angle, open ? this.openRad : 0, dt, 0.045, 1e-4);
    this.pivot.rotation.x = -this.angle;
  }

  isGuardHit(obj: THREE.Object3D): boolean {
    return obj === this.hit;
  }
}

export interface GuardedSwitchOptions extends ToggleSwitchOptions {
  guard?: GuardOptions;
}

/** Toggle switch under a hinged guard. */
export class GuardedSwitch extends ControlBase {
  readonly inner: ToggleSwitch;
  readonly guard: GuardLogic;
  private readonly assembly: GuardAssembly;
  private readonly g: GuardOptions;
  private active: 'guard' | 'switch' | null = null;
  private lastGuardVar = -1;

  constructor(env: CockpitEnv, o: GuardedSwitchOptions) {
    super(env, o);
    this.g = o.guard ?? {};
    this.inner = new ToggleSwitch(env, { ...o, sound: o.sound });
    this.object.add(this.inner.object);
    this.guard = new GuardLogic(this.inner.logic, { guardedPosition: this.g.guardedPosition ?? 0, close: this.g.close, open: this.g.initialOpen });
    const s = o.scale ?? 1;
    this.assembly = new GuardAssembly(env, this.object, this.g, this.g.width ?? 0.017 * s, this.g.length ?? 0.034 * s, this.g.height ?? 0.024 * s);
    this.hitTargets.push(this.assembly.hit, ...this.inner.hitTargets);
    this.initVar(this.g.var, this.guard.open ? 1 : 0);
    if (this.g.var) this.guard.open = env.vars.get(this.g.var) !== 0;
  }

  protected stateText(): string {
    return `${this.inner.positions[this.inner.index]} (guard ${this.guard.open ? 'OPEN' : 'CLOSED'})`;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled) return;
    if (this.assembly.isGuardHit(p.object)) {
      if (p.button === 1) return;
      this.active = 'guard';
      this.toggleGuard();
      return;
    }
    if (!this.guard.canOperate()) return;
    this.active = 'switch';
    this.inner.onPointerDown(p);
  }

  onPointerUp(p: ControlPointer): void {
    if (this.active === 'switch') this.inner.onPointerUp(p);
    this.active = null;
  }

  onCancel(): void {
    if (this.active === 'switch') this.inner.onCancel();
    this.active = null;
  }

  onDrag(dx: number, dy: number, p: ControlPointer): void {
    if (this.active === 'switch') this.inner.onDrag(dx, dy, p);
  }

  onWheel(delta: number, p: ControlPointer): void {
    if (!this.enabled) return;
    if (this.assembly.isGuardHit(p.object)) {
      // Wheel up opens, down closes.
      if ((delta > 0) !== this.guard.open) this.toggleGuard();
      return;
    }
    if (this.guard.canOperate()) this.inner.onWheel(delta, p);
  }

  /** Opens/closes the guard programmatically. */
  toggleGuard(): void {
    if (!this.guard.open) {
      this.guard.openGuard();
      this.playSound(COCKPIT_SOUNDS.guardOpen);
    } else {
      const r = this.guard.closeGuard();
      if (!r.closed) return;
      if (r.moved && r.moved.moved) this.inner.commit(r.moved);
      this.playSound(COCKPIT_SOUNDS.guardClose);
    }
    this.writeVar(this.g.var, this.guard.open ? 1 : 0);
    this.lastGuardVar = this.guard.open ? 1 : 0;
  }

  override update(dt: number): void {
    if (this.g.var) {
      const v = this.env.vars.get(this.g.var) !== 0 ? 1 : 0;
      if (v !== this.lastGuardVar) {
        this.lastGuardVar = v;
        if ((v === 1) !== this.guard.open) this.toggleGuard();
      }
    }
    this.inner.update(dt);
    this.assembly.update(dt, this.guard.open);
  }

  override dispose(): void {
    this.inner.dispose();
    super.dispose();
  }
}

export interface GuardedButtonOptions extends PushButtonOptions {
  guard?: GuardOptions;
}

/** Push button (e.g. fire bottle discharge, EMER) under a hinged guard. */
export class GuardedButton extends ControlBase {
  readonly inner: PushButton;
  readonly guard: GuardLogic;
  private readonly assembly: GuardAssembly;
  private readonly g: GuardOptions;
  private active: 'guard' | 'button' | null = null;
  private lastGuardVar = -1;

  constructor(env: CockpitEnv, o: GuardedButtonOptions) {
    super(env, o);
    this.g = o.guard ?? {};
    this.inner = new PushButton(env, o);
    this.object.add(this.inner.object);
    this.guard = new GuardLogic(null, { close: this.g.close ?? 'free', open: this.g.initialOpen });
    const w = (o.width ?? 0.0159) + 0.005;
    const len = (o.height ?? 0.0159) + 0.008;
    this.assembly = new GuardAssembly(env, this.object, this.g, this.g.width ?? w, this.g.length ?? len, this.g.height ?? 0.012);
    this.hitTargets.push(this.assembly.hit, ...this.inner.hitTargets);
    this.initVar(this.g.var, this.guard.open ? 1 : 0);
    if (this.g.var) this.guard.open = env.vars.get(this.g.var) !== 0;
  }

  protected stateText(): string {
    const s = this.inner.tooltip();
    const i = s.indexOf(': ');
    return `${i >= 0 ? s.slice(i + 2) : ''} (guard ${this.guard.open ? 'OPEN' : 'CLOSED'})`.trim();
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled) return;
    if (this.assembly.isGuardHit(p.object)) {
      if (p.button === 1) return;
      this.active = 'guard';
      this.toggleGuard();
      return;
    }
    if (!this.guard.canOperate()) return;
    this.active = 'button';
    this.inner.onPointerDown(p);
  }

  onPointerUp(_p?: ControlPointer): void {
    if (this.active === 'button') this.inner.onPointerUp();
    this.active = null;
  }

  onCancel(): void {
    if (this.active === 'button') this.inner.onCancel();
    this.active = null;
  }

  onWheel(delta: number, p: ControlPointer): void {
    if (this.assembly.isGuardHit(p.object) && (delta > 0) !== this.guard.open) this.toggleGuard();
  }

  toggleGuard(): void {
    if (!this.guard.open) {
      this.guard.openGuard();
      this.playSound(COCKPIT_SOUNDS.guardOpen);
    } else {
      if (!this.guard.closeGuard().closed) return;
      this.playSound(COCKPIT_SOUNDS.guardClose);
    }
    this.writeVar(this.g.var, this.guard.open ? 1 : 0);
    this.lastGuardVar = this.guard.open ? 1 : 0;
  }

  override update(dt: number): void {
    if (this.g.var) {
      const v = this.env.vars.get(this.g.var) !== 0 ? 1 : 0;
      if (v !== this.lastGuardVar) {
        this.lastGuardVar = v;
        if ((v === 1) !== this.guard.open) this.toggleGuard();
      }
    }
    this.inner.update(dt);
    this.assembly.update(dt, this.guard.open);
  }

  override dispose(): void {
    this.inner.dispose();
    super.dispose();
  }
}
