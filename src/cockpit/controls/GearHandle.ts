/**
 * Landing-gear handle: wheel-shaped knob (14 CFR 25.781) on a lever that
 * must be pulled out of its detent before it can move (every position is
 * lever-locked), with lamps inside the knob (e.g. red "gear unsafe / in
 * transit" light) and an optional interlock (ground down-lock solenoid).
 *
 * Mouse: left click = move to the other position (2-position) or toward the
 * clicked half (3-position, e.g. Boeing UP-OFF-DN); right click = down;
 * wheel = up/down; drag = flick. The pull-out, swing and re-seat are
 * animated; the var changes when the handle leaves the detent.
 *
 * Vars: `var` = values[index] (index 0 = DOWN at the bottom, last = UP).
 */
import * as THREE from 'three';
import type { SimVars } from '../../core/SimVars';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { LampColor, MaterialName } from '../materials';
import { ControlBase, type ControlOptions } from './ControlBase';
import { SwitchLogic } from './logic/SwitchLogic';
import { leverArmGeometry, leverKnobGeometry, quadrantSlotGeometry } from '../geometry/levers';
import { smoothTo } from '../anim';

export interface GearHandleOptions extends ControlOptions {
  var: string;
  /** Position names bottom -> top. Default ['DN', 'UP']. */
  positions?: string[];
  values?: number[];
  initial?: number;
  /** Interlock: return false to forbid moving (e.g. to UP with weight on wheels). */
  inhibit?: (to: number, from: number, vars: SimVars) => boolean;
  /** Lamps in the knob hub. */
  lights?: { var: string; color?: LampColor; test?: (v: number) => boolean }[];
  /** Arm length (m), default 0.085; swing half-angle (deg), default 30; pull-out (m), default 0.012. */
  length?: number;
  swingDeg?: number;
  pull?: number;
  knobScale?: number;
  /** Engraved position labels beside the slot (default true). */
  labels?: boolean;
  /** (Appended by global6000.) Knob (wheel) material, default 'knobWhite'; arm material, default 'chrome'. */
  knobMaterial?: MaterialName;
  armMaterial?: MaterialName;
  /**
   * (Appended by citation-longitude, additive.) Custom knob geometry factory replacing the default 25.781 wheel
   * (`leverKnobGeometry('gear', knobScale)`); built centred on the arm tip, extending +Z. The geometry is adopted by
   * the environment's cache under `key` (must be unique per shape).
   */
  knobGeometry?: { key: string; build: () => THREE.BufferGeometry };
}

export class GearHandle extends ControlBase {
  readonly logic: SwitchLogic;
  readonly positions: string[];
  private readonly o: GearHandleOptions;
  private readonly swing = new THREE.Group();
  private readonly slide = new THREE.Group();
  private readonly swingRad: number;
  private readonly pullLen: number;
  private angle: number;
  private pullAnim = 0;
  private pullTarget = 0;
  private pending: 1 | -1 | 0 = 0;
  private reseat = 0;
  private dragAcc = 0;
  private readonly lamps: { mat: THREE.MeshStandardMaterial; level: number; def: NonNullable<GearHandleOptions['lights']>[number] }[] = [];

  constructor(env: CockpitEnv, o: GearHandleOptions) {
    super(env, o);
    this.o = o;
    this.positions = o.positions ?? ['DN', 'UP'];
    this.logic = new SwitchLogic({ positions: this.positions.length, values: o.values, initial: o.initial, locked: true });
    if (o.inhibit) {
      const f = o.inhibit;
      this.logic.inhibit = (to, from) => f(to, from, env.vars);
    }
    this.swingRad = THREE.MathUtils.degToRad(o.swingDeg ?? 30);
    this.pullLen = o.pull ?? 0.012;
    this.initVar(o.var, this.logic.value);
    this.logic.sync(env.vars.get(o.var));
    this.angle = this.angleFor(this.logic.index);
    this.build();
    this.applyVisual();
  }

  /**
   * (Appended by b737-800, additive.) The sliding handle group (arm + knob; +z along the arm toward the knob).
   * Controls mounted on it, such as a lock-override trigger on the knob itself, ride with the pull-out and swing.
   */
  get handle(): THREE.Group {
    return this.slide;
  }

  protected stateText(): string {
    return this.positions[this.logic.index] + (this.pending ? ' (moving)' : '');
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled) return;
    this.dragAcc = 0;
    if (p.button === 0) {
      if (this.logic.count === 2) this.request(this.logic.index === 0 ? 1 : -1);
      else this.request(this.localPoint(p).y >= 0 ? 1 : -1);
    } else if (p.button === 2) this.request(-1);
  }

  onDrag(_dx: number, dy: number, _p?: ControlPointer): void {
    this.dragAcc -= dy;
    if (Math.abs(this.dragAcc) > 20) {
      this.request(this.dragAcc > 0 ? 1 : -1);
      this.dragAcc = 0;
    }
  }

  onWheel(delta: number, _p?: ControlPointer): void {
    if (!this.enabled || delta === 0) return;
    this.request(delta > 0 ? 1 : -1);
  }

  cursor(_p?: ControlPointer): string {
    return 'ns-resize';
  }

  override update(dt: number): void {
    const L = this.logic;
    if (this.pending && this.pullAnim > 0.9) {
      const r = L.step(this.pending, false);
      this.pending = 0;
      if (r.moved) {
        this.writeVar(this.o.var, L.value);
        this.playSound(COCKPIT_SOUNDS.gearHandle);
      } else if (r.blocked === 'inhibited') this.playSound(COCKPIT_SOUNDS.leverGate);
      this.reseat = 0.12;
    }
    if (!this.pending && this.reseat > 0) {
      this.reseat -= dt;
      if (this.reseat <= 0) {
        L.unpull();
        this.pullTarget = 0;
      }
    }
    if (!this.pending) L.sync(this.env.vars.get(this.o.var));
    this.angle = smoothTo(this.angle, this.angleFor(L.index), dt, 0.06, 1e-5);
    this.pullAnim = smoothTo(this.pullAnim, this.pullTarget, dt, 0.035, 1e-3);
    const test = this.env.lighting.lampTest();
    const lvl = this.env.lighting.annunciatorLevel();
    for (const l of this.lamps) {
      const v = this.env.vars.get(l.def.var);
      const lit = test || (l.def.test ? l.def.test(v) : v !== 0);
      l.level = smoothTo(l.level, lit ? 1.6 * lvl : 0, dt, 0.03, 1e-3);
      l.mat.emissiveIntensity = l.level;
    }
    this.applyVisual();
  }

  private request(dir: 1 | -1): void {
    if (this.pending) return;
    const to = this.logic.index + dir;
    if (to < 0 || to >= this.logic.count) return;
    this.logic.pull();
    this.pullTarget = 1;
    this.pending = dir;
  }

  private angleFor(i: number): number {
    const n = this.logic.count;
    return -this.swingRad + (2 * this.swingRad * i) / (n - 1);
  }

  private applyVisual(): void {
    this.swing.rotation.x = -this.angle;
    this.slide.position.z = this.pullAnim * this.pullLen;
  }

  private build(): void {
    const len = this.o.length ?? 0.085;
    const ks = this.o.knobScale ?? 1;
    this.object.add(this.swing);
    this.swing.add(this.slide);
    this.mesh(this.geo(`gear.arm.${len}`, () => leverArmGeometry(len, 0.012, 0.009)), this.o.armMaterial ?? 'chrome', this.slide);
    const kg = this.o.knobGeometry;
    const knob = this.mesh(kg ? this.geo(kg.key, kg.build) : this.geo(`lever.knob.gear.${ks}`, () => leverKnobGeometry('gear', ks)), this.o.knobMaterial ?? 'knobWhite', this.slide);
    knob.position.z = len;
    // Hub lamps: a lens disc on the wheel face.
    const lights = this.o.lights ?? [];
    lights.forEach((def, i) => {
      const mat = this.own(this.env.materials.lens(def.color ?? 'red', null, 0.25));
      const r = 0.009 * ks;
      const g = this.geo(`gear.lamp.${r}.${lights.length}.${i}`, () => {
        if (lights.length === 1) return new THREE.CircleGeometry(r, 32);
        const a0 = (i / lights.length) * Math.PI * 2;
        return new THREE.CircleGeometry(r, 16, a0, (Math.PI * 2) / lights.length);
      });
      const m = new THREE.Mesh(g, mat);
      m.position.z = len + 0.0162 * ks;
      this.slide.add(m);
      this.lamps.push({ mat, level: 0, def });
    });
    this.addHitBox(0.055 * ks, 0.055 * ks, 0.03 * ks, 0, 0, len + 0.01 * ks, this.slide);
    // Vertical slot with position labels.
    const reach = len * Math.sin(this.swingRad) * 0.35;
    this.mesh(this.geo(`gear.slot.${reach.toFixed(4)}`, () => quadrantSlotGeometry(reach * 2 + 0.02, 0.014, 0.034, 0.003)), 'panelDark', this.object, true);
    if (this.o.labels !== false) {
      const n = this.positions.length;
      this.positions.forEach((name, i) => {
        const y = -reach - 0.012 + ((reach * 2 + 0.024) * i) / (n - 1);
        this.engrave(name, 0.026, y, { height: 0.0032, align: 'left', weight: 700 });
      });
    }
  }
}
