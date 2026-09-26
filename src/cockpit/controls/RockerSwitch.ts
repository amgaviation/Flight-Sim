/**
 * Rocker switch (2 or 3 positions, optional momentary ends) in a bezel
 * frame, e.g. Cessna 172S "rocker" light switches, split MASTER ALT/BAT
 * halves, yoke trim rockers.
 *
 * Mouse: left click on the upper/lower half presses that half (holding keeps
 * a momentary position); right click = one position down; wheel = up/down.
 * For 2-position rockers a left click anywhere toggles.
 *
 * Optional legends printed on the cap faces and an indicator window lit by a
 * var (e.g. a rocker with an integral ON light).
 */
import * as THREE from 'three';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { LampColor, MaterialName } from '../materials';
import { ControlBase, type ControlOptions } from './ControlBase';
import { SwitchLogic, type MoveResult } from './logic/SwitchLogic';
import { rockerCapGeometry, rockerFrameGeometry } from '../geometry/switches';
import { snapTo, smoothTo } from '../anim';

export interface RockerSwitchOptions extends ControlOptions {
  var?: string;
  /** Position names bottom -> top (left -> right when horizontal). Default ['OFF', 'ON']. */
  positions?: string[];
  values?: number[];
  initial?: number;
  springs?: Partial<Record<number, number>>;
  events?: Partial<Record<number, string>>;
  orientation?: 'vertical' | 'horizontal';
  /** Cap size (m). Default 0.011 x 0.021. */
  width?: number;
  height?: number;
  capMaterial?: MaterialName | THREE.Material;
  /** Rocker tilt at the end positions (deg). Default 10. */
  tiltDeg?: number;
  /** Text printed on the upper / lower cap halves. */
  legend?: { top?: string; bottom?: string; color?: THREE.ColorRepresentation; zone?: string | null };
  /** Lit indicator window on the cap. */
  indicator?: { var: string; color?: LampColor };
  /** Engraved name above the frame. */
  name?: string | boolean;
  inhibit?: (to: number, from: number) => boolean;
}

export class RockerSwitch extends ControlBase {
  readonly logic: SwitchLogic;
  readonly positions: string[];
  private readonly o: RockerSwitchOptions;
  private readonly cap = new THREE.Group();
  private readonly vertical: boolean;
  private readonly tilt: number;
  private angle: number;
  private indicatorMat: THREE.MeshStandardMaterial | null = null;
  private indicatorLevel = 0;
  private pressed = false;
  private dragAcc = 0;

  constructor(env: CockpitEnv, o: RockerSwitchOptions) {
    super(env, o);
    this.o = o;
    this.positions = o.positions ?? ['OFF', 'ON'];
    this.logic = new SwitchLogic({ positions: this.positions.length, values: o.values, initial: o.initial, springs: o.springs });
    if (o.inhibit) this.logic.inhibit = o.inhibit;
    this.vertical = (o.orientation ?? 'vertical') === 'vertical';
    this.tilt = THREE.MathUtils.degToRad(o.tiltDeg ?? 10);
    this.initVar(o.var, this.logic.value);
    if (o.var) this.logic.sync(env.vars.get(o.var));
    this.angle = this.angleFor(this.logic.index);

    const w = o.width ?? 0.011;
    const h = o.height ?? 0.021;
    const gw = this.vertical ? w : h;
    const gh = this.vertical ? h : w;
    this.mesh(this.geo(`rocker.frame.${gw}.${gh}`, () => rockerFrameGeometry(gw, gh)), 'bezel', this.object, true);
    this.cap.position.z = 0.0012;
    this.object.add(this.cap);
    const capMat = o.capMaterial ?? 'plasticBlack';
    const capMesh = this.mesh(
      this.geo(`rocker.cap.${w}.${h}`, () => rockerCapGeometry(w, h)),
      typeof capMat === 'string' ? env.materials.get(capMat) : capMat,
      this.cap,
    );
    if (!this.vertical) capMesh.rotation.z = Math.PI / 2;
    const faceZ = 0.006 * 0.65 + 0.0006;
    if (o.legend) {
      const zone = o.legend.zone === undefined ? 'panel' : o.legend.zone;
      const style = { height: Math.min(0.0024, w * 0.2), zone, color: o.legend.color ?? '#f2f2ee', weight: 700 as const };
      if (o.legend.top) {
        const l = this.engrave(o.legend.top, 0, h * 0.26, style, this.cap, true);
        l.position.z = faceZ;
      }
      if (o.legend.bottom) {
        const l = this.engrave(o.legend.bottom, 0, -h * 0.26, style, this.cap, true);
        l.position.z = faceZ;
      }
    }
    if (o.indicator) {
      const m = this.own(env.materials.lens(o.indicator.color ?? 'green', null, 0.15));
      this.indicatorMat = m;
      const win = new THREE.Mesh(this.geo(`rocker.ind.${w}`, () => new THREE.PlaneGeometry(w * 0.45, w * 0.22)), m);
      win.position.set(0, h * 0.36, faceZ + 0.0002);
      this.cap.add(win);
    }
    if (o.name) this.engrave(typeof o.name === 'string' ? o.name : this.label, 0, gh / 2 + 0.0055, { weight: 700 });
    this.addHitBox(gw + 0.002, gh + 0.002, 0.012, 0, 0, 0.005);
    this.applyVisual();
  }

  protected stateText(): string {
    return this.positions[this.logic.index] ?? String(this.logic.value);
  }

  force(index: number, silent = false): void {
    const r = this.logic.force(index);
    if (r.moved) this.moved(r, silent);
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled) return;
    this.pressed = true;
    this.dragAcc = 0;
    let dir: 1 | -1;
    if (p.button === 0) {
      if (this.logic.count === 2 && !this.logic.isMomentary(0) && !this.logic.isMomentary(1)) dir = this.logic.index === 0 ? 1 : -1;
      else {
        const lp = this.localPoint(p);
        dir = (this.vertical ? lp.y : lp.x) >= 0 ? 1 : -1;
      }
    } else if (p.button === 2) dir = -1;
    else return;
    const r = this.logic.step(dir, true);
    if (r.moved) this.moved(r);
  }

  onPointerUp(): void {
    this.release();
  }

  onCancel(): void {
    this.release();
  }

  onDrag(dx: number, dy: number): void {
    if (!this.enabled) return;
    this.dragAcc += this.vertical ? -dy : dx;
    if (Math.abs(this.dragAcc) > 14) {
      const r = this.logic.step(this.dragAcc > 0 ? 1 : -1, true);
      this.dragAcc = 0;
      if (r.moved) this.moved(r);
    }
  }

  onWheel(delta: number): void {
    if (!this.enabled || delta === 0) return;
    const r = this.logic.step(delta > 0 ? 1 : -1, false);
    if (r.moved) this.moved(r);
  }

  override update(dt: number): void {
    const t = this.logic.tick(dt);
    if (t && t.moved) this.moved(t);
    if (this.o.var && this.logic.sync(this.env.vars.get(this.o.var))) this.playSound(COCKPIT_SOUNDS.rocker, 0.8);
    this.angle = snapTo(this.angle, this.angleFor(this.logic.index), dt);
    if (this.indicatorMat && this.o.indicator) {
      const on = this.env.vars.get(this.o.indicator.var) !== 0 || this.env.lighting.lampTest();
      const target = on ? 1.3 * this.env.lighting.annunciatorLevel() : 0;
      this.indicatorLevel = smoothTo(this.indicatorLevel, target, dt, 0.03, 1e-3);
      this.indicatorMat.emissiveIntensity = this.indicatorLevel;
    }
    this.applyVisual();
  }

  private release(): void {
    this.pressed = false;
    const r = this.logic.release();
    if (r && r.moved) this.moved(r);
  }

  private moved(r: MoveResult, silent = false): void {
    this.writeVar(this.o.var, this.logic.value);
    this.emit(this.o.events?.[r.to]);
    if (!silent) this.playSound(COCKPIT_SOUNDS.rocker);
  }

  private angleFor(i: number): number {
    const n = this.logic.count;
    return -this.tilt + (2 * this.tilt * i) / (n - 1);
  }

  private applyVisual(): void {
    // Pressing the top half (higher index) tilts the top inward.
    if (this.vertical) this.cap.rotation.set(-this.angle, 0, 0);
    else this.cap.rotation.set(0, this.angle, 0);
  }
}
