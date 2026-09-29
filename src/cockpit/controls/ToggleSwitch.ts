/**
 * Bat-handle / paddle toggle switch (2 or more positions) with optional
 * spring-loaded momentary positions and lever-lock.
 *
 * Mouse:
 *  - left click: 2-position switches flip; 3+ positions move toward the
 *    half of the switch that was clicked (upper/right half = up/right).
 *    Holding the button keeps a momentary (spring-loaded) position.
 *  - right click: one position down/left.
 *  - wheel: up/down one position (momentary positions return after 0.25 s).
 *  - drag: flick the handle in the drag direction.
 * Lever-lock positions: every click/wheel/drag first pulls the handle out
 * (animated), then moves it, then lets it snap back in.
 *
 * Vars: writes `var` = values[index] on every change and follows external
 * writes to `var` (e.g. a solenoid-held start switch released by a system).
 * Events: `events[index]` is emitted when the switch enters that position.
 */
import * as THREE from 'three';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { MaterialName } from '../materials';
import { ControlBase, type ControlOptions } from './ControlBase';
import { SwitchLogic, type MoveResult } from './logic/SwitchLogic';
import { fenceGeometry, leverLockCollarGeometry, TOGGLE_DIMS, toggleBaseGeometry, toggleHandleGeometry, wireGuardGeometry, type ToggleHandleStyle } from '../geometry/switches';
import { smoothTo, snapTo } from '../anim';

export interface ToggleSwitchOptions extends ControlOptions {
  /** SimVar written with values[index]. */
  var?: string;
  /** Position names from bottom to top (or left to right). Default ['OFF', 'ON']. */
  positions?: string[];
  /** Var value per position (default 0..n-1). */
  values?: number[];
  /** Initial position index when the var is unset (default 0). */
  initial?: number;
  /** Momentary positions: index -> index it springs back to. */
  springs?: Partial<Record<number, number>>;
  /** Lever-lock positions (need pull to enter/leave). `true` = all positions. */
  leverLock?: number[] | boolean;
  /** Event emitted when entering a position. */
  events?: Partial<Record<number, string>>;
  orientation?: 'vertical' | 'horizontal';
  handle?: ToggleHandleStyle;
  handleMaterial?: MaterialName | THREE.Material;
  /** 1 = MS24523 size. */
  scale?: number;
  /** Handle angle at the end positions (deg). Default 24. */
  throwDeg?: number;
  /** Static side protection. */
  fence?: 'none' | 'plates' | 'wire';
  /**
   * Engraved labels: name above, position legends beside the positions. `midOffset` (appended by citation-longitude,
   * additive) moves a 3-position switch's centre legend laterally (m) so it clears the nut / bushing; default keeps
   * the historic 0.0085 * scale offset.
   */
  labels?: { name?: string | boolean; positions?: boolean; height?: number; zone?: string | null; midOffset?: number };
  /** Draw nut/bushing (default true). */
  base?: boolean;
  /** Interlock: return false to forbid a move. */
  inhibit?: (to: number, from: number) => boolean;
}

export class ToggleSwitch extends ControlBase {
  readonly logic: SwitchLogic;
  readonly positions: string[];
  protected readonly o: ToggleSwitchOptions;
  private readonly pivot = new THREE.Group();
  private readonly handleGroup = new THREE.Group();
  private readonly vertical: boolean;
  private readonly throwRad: number;
  private readonly scale: number;
  private angle: number;
  private pullAnim = 0;
  private pullTarget = 0;
  private pending: { dir: 1 | -1; hold: boolean } | null = null;
  private unpullTimer = 0;
  private pressed = false;
  private dragAcc = 0;

  constructor(env: CockpitEnv, o: ToggleSwitchOptions) {
    super(env, o);
    this.o = o;
    this.positions = o.positions ?? ['OFF', 'ON'];
    const n = this.positions.length;
    this.logic = new SwitchLogic({ positions: n, values: o.values, initial: o.initial, springs: o.springs, locked: o.leverLock });
    if (o.inhibit) this.logic.inhibit = o.inhibit;
    this.vertical = (o.orientation ?? 'vertical') === 'vertical';
    this.throwRad = THREE.MathUtils.degToRad(o.throwDeg ?? 24);
    this.scale = o.scale ?? 1;
    this.initVar(o.var, this.logic.value);
    if (o.var) this.logic.sync(env.vars.get(o.var));
    this.angle = this.angleFor(this.logic.index);
    this.build();
    this.applyVisual();
  }

  protected stateText(): string {
    return this.positions[this.logic.index] ?? String(this.logic.value);
  }

  /** Current position index. */
  get index(): number {
    return this.logic.index;
  }

  /**
   * Forces a position (writes the var, plays the sound); used by guards that
   * push the switch back and by aircraft logic.
   */
  force(index: number, silent = false): void {
    this.logic.unpull();
    const r = this.logic.force(index);
    if (r.moved) this.moved(r, silent);
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled) return;
    this.pressed = true;
    this.dragAcc = 0;
    let dir: 1 | -1;
    if (p.button === 0) {
      if (this.logic.count === 2) dir = this.logic.index === 0 ? 1 : -1;
      else {
        const lp = this.localPoint(p);
        dir = (this.vertical ? lp.y : lp.x) >= 0 ? 1 : -1;
      }
    } else if (p.button === 2) dir = -1;
    else return;
    this.request(dir, true);
  }

  onPointerUp(_p: ControlPointer): void {
    this.release();
  }

  onCancel(): void {
    this.release();
  }

  onDrag(dx: number, dy: number, _p: ControlPointer): void {
    if (!this.enabled) return;
    this.dragAcc += this.vertical ? -dy : dx;
    const th = 14;
    if (this.dragAcc > th) {
      this.dragAcc = 0;
      this.request(1, true);
    } else if (this.dragAcc < -th) {
      this.dragAcc = 0;
      this.request(-1, true);
    }
  }

  onWheel(delta: number, _p: ControlPointer): void {
    if (!this.enabled || delta === 0) return;
    this.request(delta > 0 ? 1 : -1, false);
  }

  cursor(_p?: ControlPointer): string {
    return this.vertical ? 'ns-resize' : 'ew-resize';
  }

  override update(dt: number): void {
    const L = this.logic;
    // Lever-lock sequence: pull, move, release.
    if (this.pending && this.pullAnim > 0.85) {
      const { dir, hold } = this.pending;
      this.pending = null;
      const r = L.step(dir, hold && this.pressed);
      if (r.moved) this.moved(r);
      this.unpullTimer = 0.07;
    }
    if (!this.pending && L.pulled && this.unpullTimer > 0) {
      this.unpullTimer -= dt;
      if (this.unpullTimer <= 0) {
        L.unpull();
        this.pullTarget = 0;
      }
    }
    const t = L.tick(dt);
    if (t && t.moved) this.moved(t);
    if (this.o.var && !this.pending) {
      const from = L.index;
      if (L.sync(this.env.vars.get(this.o.var))) {
        // Moved by a system (solenoid release): snap sound, no var write.
        this.playSound(this.heavy ? COCKPIT_SOUNDS.toggleHeavy : COCKPIT_SOUNDS.toggle, 0.8);
        if (from !== L.index) this.emit(this.o.events?.[L.index]);
      }
    }
    this.angle = snapTo(this.angle, this.angleFor(L.index), dt);
    this.pullAnim = smoothTo(this.pullAnim, this.pullTarget, dt, 0.02, 1e-3);
    this.applyVisual();
  }

  // ---------------------------------------------------------------------------

  private get heavy(): boolean {
    return this.logic.hasLocks() || this.scale > 1.2;
  }

  private request(dir: 1 | -1, hold: boolean): void {
    const L = this.logic;
    if (this.pending) return;
    const to = L.index + dir;
    const block = L.check(to);
    if (block === 'locked') {
      L.pull();
      this.pullTarget = 1;
      this.pending = { dir, hold };
      return;
    }
    if (block !== 'none') return;
    const r = L.step(dir, hold);
    if (r.moved) this.moved(r);
  }

  private release(): void {
    this.pressed = false;
    const r = this.logic.release();
    if (r && r.moved) this.moved(r);
  }

  /**
   * Publishes a move already applied to `logic` (writes the var, emits the
   * position event, plays the sound). Used by GuardedSwitch when a closing
   * guard pushes the switch.
   */
  commit(r: MoveResult, silent = false): void {
    this.moved(r, silent);
  }

  private moved(r: MoveResult, silent = false): void {
    this.writeVar(this.o.var, this.logic.value);
    this.emit(this.o.events?.[r.to]);
    if (!silent) this.playSound(this.heavy ? COCKPIT_SOUNDS.toggleHeavy : COCKPIT_SOUNDS.toggle);
  }

  private angleFor(i: number): number {
    const n = this.logic.count;
    return -this.throwRad + (2 * this.throwRad * i) / (n - 1);
  }

  private applyVisual(): void {
    if (this.vertical) this.pivot.rotation.set(-this.angle, 0, 0);
    else this.pivot.rotation.set(0, this.angle, 0);
    this.handleGroup.position.z = this.pullAnim * 0.0022 * this.scale;
  }

  private build(): void {
    const s = this.scale;
    const o = this.o;
    const style: ToggleHandleStyle = o.handle ?? (this.logic.hasLocks() ? 'lever-lock' : 'bat');
    if (o.base !== false) this.mesh(this.geo(`toggle.base.${s}`, () => toggleBaseGeometry(s)), 'steel', this.object, true);
    this.pivot.position.z = TOGGLE_DIMS.pivotZ * s;
    this.object.add(this.pivot);
    this.pivot.add(this.handleGroup);
    const hm = o.handleMaterial ?? 'handle';
    this.mesh(this.geo(`toggle.handle.${style}.${s}`, () => toggleHandleGeometry(style, s)), typeof hm === 'string' ? this.env.materials.get(hm) : hm, this.handleGroup);
    if (style === 'lever-lock') {
      const c = this.mesh(this.geo(`toggle.collar.${s}`, () => leverLockCollarGeometry(s)), 'steel', this.handleGroup);
      c.position.z = 0.0012 * s;
    }
    const along = 0.03 * s;
    if (o.fence === 'plates') {
      const f = this.mesh(this.geo(`toggle.fence.${s}`, () => fenceGeometry(0.016 * s, along, 0.017 * s)), 'panelDark', this.object, true);
      if (!this.vertical) f.rotation.z = Math.PI / 2;
    } else if (o.fence === 'wire') {
      const f = this.mesh(this.geo(`toggle.wire.${s}`, () => wireGuardGeometry(0.02 * s, 0.018 * s)), 'wire', this.object, true);
      if (!this.vertical) f.rotation.z = Math.PI / 2;
    }
    // Hit box covering the handle sweep.
    const w = 0.013 * s;
    const h = 0.03 * s;
    this.addHitBox(this.vertical ? w : h, this.vertical ? h : w, 0.024 * s, 0, 0, 0.012 * s);
    // Engraved labels.
    const lab = o.labels;
    if (lab) {
      const th = lab.height ?? 0.0026;
      const style2 = { height: th, zone: lab.zone === undefined ? 'panel' : lab.zone };
      const n = this.positions.length;
      if (lab.positions !== false) {
        if (this.vertical) {
          this.engrave(this.positions[n - 1], 0, 0.0118 * s, style2);
          this.engrave(this.positions[0], 0, -0.0118 * s, style2);
          if (n === 3) this.engrave(this.positions[1], lab.midOffset ?? 0.0085 * s, 0, { ...style2, align: 'left' });
        } else {
          this.engrave(this.positions[0], -0.0105 * s, 0, { ...style2, align: 'right' });
          this.engrave(this.positions[n - 1], 0.0105 * s, 0, { ...style2, align: 'left' });
          if (n === 3) this.engrave(this.positions[1], 0, 0.0095 * s, style2);
        }
      }
      if (lab.name) {
        const name = typeof lab.name === 'string' ? lab.name : this.label;
        const y = this.vertical ? (lab.positions !== false ? 0.0175 : 0.0125) * s : (n === 3 && lab.positions !== false ? 0.0155 : 0.0105) * s;
        this.engrave(name, 0, y, { ...style2, weight: 700 });
      }
    }
  }
}
