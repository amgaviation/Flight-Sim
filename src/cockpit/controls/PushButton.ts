/**
 * Push buttons: momentary, alternate-action (latching) and multi-state
 * cycling, with integral annunciator legends (Korry switch-lights), engraved
 * backlit cap text (keycaps, MCP buttons) and MCP-style light bars.
 *
 * Mouse: left press = push (held while the button is held; momentary vars
 * are 1 while pressed); right click = same as left (buttons have one
 * action); wheel does nothing.
 *
 * Vars/events: `var` gets the button value (momentary: 1 while pressed;
 * toggle/cycle: the latched value). `event` is emitted on press,
 * `releaseEvent` on release. Latched values follow external writes (a
 * system may unlatch a button, e.g. an auto-reset).
 *
 * Korry 389 switch-light face: 5/8 in square (korry.com, 389 series
 * technical guide) - the default 'korry' size. Other sizes EST.
 *
 * Draw calls: the cap, its engraved text, light bar and legend lenses are
 * moving parts (they travel with the cap), drawn as instances shared with
 * every other button of the cockpit (instancing.ts); the frame is static.
 */
import * as THREE from 'three';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { LampColor, MaterialName } from '../materials';
import { ControlBase, type ControlOptions } from './ControlBase';
import { ButtonLogic, type ButtonMode } from './logic/ButtonLogic';
import { LegendFace, type LegendSegment } from './Annunciator';
import { cylinderZ, revolve, roundedBox } from '../geometry/primitives';
import { rockerFrameGeometry } from '../geometry/switches';
import { smoothTo } from '../anim';
import { ControlInstances, markMovingPart } from '../instancing';

export type PushButtonStyle = 'korry' | 'round' | 'mcp' | 'key' | 'softkey' | 'mushroom' | 'small';

export interface PushButtonOptions extends ControlOptions {
  var?: string;
  mode?: ButtonMode;
  /** Values for toggle/cycle modes (default [0, 1]). */
  values?: number[];
  /** Names of the latched states for the tooltip (default OFF/ON or the values). */
  stateNames?: string[];
  initial?: number;
  /** Event emitted on press (payload: the new value). */
  event?: string;
  /** Event emitted on release. */
  releaseEvent?: string;
  style?: PushButtonStyle;
  /** Cap size (m). Defaults per style. */
  width?: number;
  height?: number;
  capMaterial?: MaterialName | THREE.Material;
  /** Engraved (backlit) text on the cap. */
  engraved?: string;
  engravedHeight?: number;
  engravedColor?: THREE.ColorRepresentation;
  /** Lighting zone for engraved text (default 'panel'). */
  zone?: string | null;
  /** Annunciator legend segments on the cap face. */
  segments?: LegendSegment[];
  layout?: 'stack' | 'split';
  /** MCP-style light bar lit by a var. `unlitTint`: diffuse tint of the dark bar (fraction of the lamp colour, default 0.18; ~0.03 = near black). */
  lightBar?: { var?: string; whenOn?: boolean; color?: LampColor; unlitTint?: number };
  /** Diffuse tint of unlit legend lenses (LegendFace `unlitTint`; default 0.2 legend / 0.16 field). */
  unlitTint?: number;
  /** Lamp emissive intensity (default 1.4). */
  intensity?: number;
  /** Engraved name above the button (panel text). */
  name?: string | boolean;
}

interface StyleDims {
  w: number;
  h: number;
  depth: number;
  travel: number;
  round: boolean;
}

const STYLE_DIMS: Record<PushButtonStyle, StyleDims> = {
  korry: { w: 0.0159, h: 0.0159, depth: 0.0055, travel: 0.0016, round: false }, // Korry 389: 5/8 in
  round: { w: 0.012, h: 0.012, depth: 0.005, travel: 0.0014, round: true },
  mcp: { w: 0.017, h: 0.012, depth: 0.006, travel: 0.0015, round: false },
  key: { w: 0.0105, h: 0.0095, depth: 0.005, travel: 0.0014, round: false },
  softkey: { w: 0.012, h: 0.007, depth: 0.004, travel: 0.0012, round: false },
  mushroom: { w: 0.024, h: 0.024, depth: 0.008, travel: 0.002, round: true },
  small: { w: 0.009, h: 0.009, depth: 0.004, travel: 0.001, round: true },
};

export class PushButton extends ControlBase {
  readonly logic: ButtonLogic;
  private faceRef: LegendFace | null = null;
  private readonly o: PushButtonOptions;
  private readonly cap = new THREE.Group();
  private readonly dims: StyleDims;
  private press = 0;
  private appliedZ = 0;
  private hoverOn = false;
  private barMat: THREE.MeshStandardMaterial | null = null;
  private barLevel = 0;
  private lastSynced: number;

  constructor(env: CockpitEnv, o: PushButtonOptions) {
    super(env, o);
    this.o = o;
    this.logic = new ButtonLogic({ mode: o.mode, values: o.values, initial: o.initial });
    const style = o.style ?? (o.segments ? 'korry' : 'round');
    const base = STYLE_DIMS[style];
    this.dims = { ...base, w: o.width ?? base.w, h: o.height ?? base.h };
    this.initVar(o.var, this.logic.value);
    if (o.var) this.logic.sync(env.vars.get(o.var));
    this.lastSynced = this.logic.value;
    this.build(style);
  }

  protected stateText(): string {
    const lit = this.face?.litText();
    if (this.logic.mode === 'momentary') return lit ? lit : this.logic.pressed ? 'PRESSED' : '';
    const names = this.o.stateNames ?? (this.logic.values.length === 2 ? ['OFF', 'ON'] : this.logic.values.map(String));
    const st = names[this.logic.index] ?? String(this.logic.value);
    return lit ? `${st} (${lit})` : st;
  }

  /** Integral annunciator legend face (null when the button has no segments). */
  get face(): LegendFace | null {
    return this.faceRef;
  }

  /** Current value. */
  get value(): number {
    return this.logic.value;
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || p.button === 1) return;
    this.doPress();
  }

  onPointerUp(_p?: ControlPointer): void {
    this.doRelease();
  }

  onCancel(): void {
    this.doRelease();
  }

  onHover(h: boolean): void {
    this.hoverOn = h;
  }

  /** Programmatic press/release (yoke hat mapping, keyboard shortcuts). */
  doPress(): void {
    if (!this.logic.press()) return;
    this.writeVar(this.o.var, this.logic.value);
    this.lastSynced = this.logic.value;
    this.emit(this.o.event, this.logic.value);
    this.playSound(COCKPIT_SOUNDS.buttonPress);
  }

  doRelease(): void {
    if (!this.logic.pressed) return;
    const changed = this.logic.release();
    if (changed) this.writeVar(this.o.var, this.logic.value);
    this.lastSynced = this.logic.value;
    this.emit(this.o.releaseEvent, this.logic.value);
    this.playSound(COCKPIT_SOUNDS.buttonRelease, 0.6);
  }

  override update(dt: number): void {
    const L = this.logic;
    if (this.o.var && L.mode !== 'momentary') {
      const v = this.env.vars.get(this.o.var);
      if (v !== this.lastSynced) {
        L.sync(v);
        this.lastSynced = v;
      }
    }
    const on = L.value !== 0;
    this.face?.update(dt, on);
    if (this.barMat && this.o.lightBar) {
      const lb = this.o.lightBar;
      const lit = (lb.var ? this.env.vars.get(lb.var) !== 0 : false) || (lb.whenOn === true && on) || this.env.lighting.lampTest();
      this.barLevel = smoothTo(this.barLevel, lit ? 1.5 * this.env.lighting.annunciatorLevel() : 0, dt, 0.025, 1e-3);
      this.barMat.emissiveIntensity = this.barLevel;
    }
    // Latched alternate-action buttons rest slightly in.
    const target = L.pressed ? 1 : L.mode !== 'momentary' && on && this.dims.travel > 0 ? 0.4 : 0;
    this.press = smoothTo(this.press, target, dt, 0.012, 1e-4);
    const inst = ControlInstances.of(this.object);
    inst?.sync(this.hoverOn);
    const z = -this.press * this.dims.travel;
    if (z !== this.appliedZ) {
      this.appliedZ = z;
      this.cap.position.z = z;
      inst?.moved(this.cap);
    }
    inst?.syncLenses();
  }

  override dispose(): void {
    this.face?.dispose();
    super.dispose();
  }

  private build(style: PushButtonStyle): void {
    const env = this.env;
    const o = this.o;
    const { w, h, depth, round } = this.dims;
    const capMat = o.capMaterial ?? (style === 'mcp' ? 'knobGrey' : style === 'key' || style === 'softkey' ? 'plasticGrey' : 'plasticBlack');
    const mat = typeof capMat === 'string' ? env.materials.get(capMat) : capMat;
    this.object.add(this.cap);
    // Bezel / frame (static).
    if (round) {
      const r = w / 2;
      this.mesh(
        this.geo(`pb.ring.${r}`, () =>
          revolve(
            [
              [r * 1.02, 0.0028],
              [r * 1.02, 0.0028],
              [r * 1.28, 0.0024],
              [r * 1.36, 0.001],
              [r * 1.36, 0],
            ],
            40,
          ),
        ),
        'bezel',
        this.object,
        true,
      );
      markMovingPart(this.mesh(this.geo(`pb.capR.${r}.${depth}`, () => cylinderZ(r * 0.98, r * 0.95, 0, depth, 36)), mat, this.cap), this.cap);
    } else if (style !== 'key' && style !== 'softkey') {
      this.mesh(this.geo(`pb.frame.${w}.${h}`, () => rockerFrameGeometry(w + 0.0006, h + 0.0006, 0.0014, 0.0028)), 'bezel', this.object, true);
      const cg = this.geo(`pb.cap.${w}.${h}.${depth}`, () => {
        const g = roundedBox(w * 0.97, h * 0.97, depth, Math.min(w, h) * 0.07, 2);
        g.translate(0, 0, depth / 2);
        return g;
      });
      markMovingPart(this.mesh(cg, mat, this.cap), this.cap);
    } else {
      const cg = this.geo(`pb.key.${w}.${h}.${depth}`, () => {
        const g = roundedBox(w, h, depth, Math.min(w, h) * 0.14, 3);
        g.translate(0, 0, depth / 2);
        // Slightly dished top.
        const p = g.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          if (p.getZ(i) > depth * 0.95) {
            const rx = p.getX(i) / (w / 2);
            const ry = p.getY(i) / (h / 2);
            p.setZ(i, p.getZ(i) - 0.0004 * (1 - Math.min(1, rx * rx + ry * ry)));
          }
        }
        g.computeVertexNormals();
        return g;
      });
      markMovingPart(this.mesh(cg, mat, this.cap), this.cap);
    }
    const faceZ = depth + 0.00012;
    // Legend segments.
    if (o.segments && o.segments.length) {
      const fw = round ? w * 0.68 : w * 0.86;
      const fh = round ? h * 0.68 : h * 0.86;
      const face = new LegendFace(env, o.segments, fw, fh, o.layout ?? 'stack', { intensity: o.intensity, own: (m) => this.own(m), unlitTint: o.unlitTint });
      face.group.position.z = faceZ;
      this.cap.add(face.group);
      this.faceRef = face;
      for (const c of face.group.children) if ((c as THREE.Mesh).isMesh) markMovingPart(c as THREE.Mesh, this.cap);
    }
    // Engraved cap text.
    if (o.engraved) {
      const th = o.engravedHeight ?? Math.min(0.0024, h * 0.24);
      const y = o.lightBar ? h * 0.18 : 0;
      const l = this.engrave(o.engraved, 0, y, { height: th, zone: o.zone === undefined ? 'panel' : o.zone, color: o.engravedColor ?? '#f2f2ee', weight: 700 }, this.cap, true);
      l.position.z = faceZ;
      markMovingPart(l, this.cap);
    }
    // Light bar.
    if (o.lightBar) {
      const m = this.own(env.materials.lens(o.lightBar.color ?? 'green', null, o.lightBar.unlitTint ?? 0.18));
      this.barMat = m;
      const bar = new THREE.Mesh(this.geo(`pb.bar.${w}`, () => new THREE.PlaneGeometry(w * 0.62, h * 0.16)), m);
      bar.position.set(0, o.engraved ? -h * 0.2 : 0, faceZ);
      this.cap.add(bar);
      markMovingPart(bar, this.cap);
    }
    if (o.name) this.engrave(typeof o.name === 'string' ? o.name : this.label, 0, h / 2 + 0.0055, { weight: 700 });
    this.addHitBox(w + 0.002, h + 0.002, depth + 0.004, 0, 0, depth / 2);
  }
}
