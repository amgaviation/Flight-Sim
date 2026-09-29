/**
 * Keypads built from a layout description: CDU/MCDU keyboards, Garmin
 * GCU/GMC keypads, line-select key columns, radio control panel keys.
 *
 * Each key is its own animated group (shared cap geometry per size) with an
 * engraved, backlit legend; keys may carry a small annunciator bar
 * (`lightVar`, e.g. EXEC). Extra annunciator lights on the keypad face
 * (MSG, FAIL, OFST, DSPY) are given in `lights`. Caps, legends, bars and
 * lights are marked as moving parts, so the cockpit build draws all key caps
 * of one size/material, and all legends of one atlas page, as single
 * instanced batches (instancing.ts); a pressed key moves its instances.
 *
 * Mouse: left or right press on a key presses it (emits its event);
 * release releases it. Clicking the keypad also gives it keyboard focus when
 * `keyboard` is true: PC keys then press the matching keys (letters,
 * digits, space -> SP, Backspace -> CLR/DEL, Enter -> ENT/EXEC, explicit
 * `keys` mappings) until focus moves elsewhere or Escape is pressed.
 *
 * Events: `${eventPrefix}${id}` with payload 'down' on press, optionally a
 * single `singleEvent` with the key id as payload, and `...:up` on release
 * when `releaseEvents` is set.
 */
import * as THREE from 'three';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { MaterialName, LampColor } from '../materials';
import { KEY_FONT } from '../labels';
import { ControlBase, type ControlOptions } from './ControlBase';
import { KeyPadLogic, type KeyDef } from './logic/MiscLogic';
import { LegendFace } from './Annunciator';
import { roundedBox } from '../geometry/primitives';
import { smoothTo } from '../anim';
import { ControlInstances, markMovingPart } from '../instancing';

export interface KeyPadOptions extends ControlOptions {
  rows: KeyDef[][];
  eventPrefix?: string;
  singleEvent?: string;
  releaseEvents?: boolean;
  /** Key unit size (m) and gap. Defaults 0.0105 x 0.0095, gap 0.0028 (CDU-like, EST). */
  keyWidth?: number;
  keyHeight?: number;
  gap?: number;
  /** Per-row horizontal offset in key units (staggered layouts). */
  rowOffsets?: number[];
  keyMaterial?: MaterialName | THREE.Material;
  /** Material per key style (e.g. { lsk: 'plasticBlack', function: 'knobGrey' }). */
  styleMaterials?: Record<string, MaterialName | THREE.Material>;
  legendHeight?: number;
  legendColor?: THREE.ColorRepresentation;
  zone?: string | null;
  /** Accept PC keyboard input while focused. */
  keyboard?: boolean;
  /** Annunciator lights on the keypad face; positions in metres from the keypad origin (top-left of the first key). */
  lights?: { text: string; color: LampColor; var: string; x: number; y: number; w?: number; h?: number }[];
}

interface KeyState {
  def: KeyDef;
  group: THREE.Group;
  hit: THREE.Mesh;
  press: number;
  /** Cap travel last applied to the group (m). */
  appliedZ: number;
  down: boolean;
  bar: { mat: THREE.MeshStandardMaterial; level: number } | null;
}

export class KeyPad extends ControlBase {
  readonly logic: KeyPadLogic;
  private readonly o: KeyPadOptions;
  private readonly keys = new Map<string, KeyState>();
  private readonly keyList: KeyState[] = [];
  private readonly byHit = new Map<THREE.Object3D, KeyState>();
  private readonly faces: LegendFace[] = [];
  private active: KeyState | null = null;
  private hovered: KeyState | null = null;
  private hoverOn = false;
  private focused = false;
  /** Size of the laid-out keypad (m). */
  readonly width: number;
  readonly height: number;

  constructor(env: CockpitEnv, o: KeyPadOptions) {
    super(env, o);
    this.o = o;
    this.logic = new KeyPadLogic({ rows: o.rows, eventPrefix: o.eventPrefix, singleEvent: o.singleEvent, releaseEvents: o.releaseEvents, emit: (n, p) => env.events.emit(n, p) });
    const kw = o.keyWidth ?? 0.0105;
    const kh = o.keyHeight ?? 0.0095;
    const gap = o.gap ?? 0.0028;
    let y = 0;
    let maxX = 0;
    o.rows.forEach((row, ri) => {
      let x = (o.rowOffsets?.[ri] ?? 0) * (kw + gap);
      let rowH = kh;
      for (const k of row) {
        const w = (k.w ?? 1) * kw + ((k.w ?? 1) - 1) * gap;
        const h = (k.h ?? 1) * kh + ((k.h ?? 1) - 1) * gap;
        if (!k.spacer) this.buildKey(k, x + w / 2, y - h / 2, w, h);
        x += w + gap;
        rowH = Math.max(rowH, kh);
      }
      maxX = Math.max(maxX, x - gap);
      y -= rowH + gap;
    });
    this.width = maxX;
    this.height = -y - gap;
    for (const l of o.lights ?? []) {
      const face = new LegendFace(env, [{ text: l.text, color: l.color, var: l.var }], l.w ?? 0.012, l.h ?? 0.0055, 'stack', { own: (m) => this.own(m) });
      face.group.position.set(l.x, l.y, 0.0005);
      this.object.add(face.group);
      this.faces.push(face);
      for (const c of face.group.children) if ((c as THREE.Mesh).isMesh) markMovingPart(c as THREE.Mesh, face.group);
    }
  }

  protected stateText(): string {
    return this.hovered ? (this.hovered.def.label ?? this.hovered.def.id).replace(/\n/g, ' ') : this.focused ? 'keyboard focus' : '';
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.enabled || p.button === 1) return;
    const k = this.byHit.get(p.object);
    if (!k) return;
    this.active = k;
    this.pressKey(k);
  }

  onPointerUp(_p?: ControlPointer): void {
    if (this.active) this.releaseKey(this.active);
    this.active = null;
  }

  onCancel(): void {
    this.onPointerUp();
    this.focused = false;
  }

  cursor(p: ControlPointer): string {
    this.hovered = this.byHit.get(p.object) ?? null;
    return 'pointer';
  }

  onHover(h: boolean): void {
    this.hoverOn = h;
    if (!h) this.hovered = null;
  }

  onKey(key: string, _code: string, down: boolean, _shift?: boolean): boolean {
    if (!this.o.keyboard) return false;
    if (key === 'Escape' && down && !this.logic.has('CLR')) {
      this.focused = false;
      return false;
    }
    const id = this.logic.keyFor(key);
    if (!id) return false;
    const k = this.keys.get(id);
    if (!k) return false;
    this.focused = true;
    if (down) {
      if (!k.down) this.pressKey(k);
    } else this.releaseKey(k);
    return true;
  }

  /** Presses/releases a key by id (programmatic). */
  press(id: string): boolean {
    const k = this.keys.get(id);
    if (!k) return false;
    this.pressKey(k);
    this.releaseKey(k);
    return true;
  }

  override update(dt: number): void {
    const test = this.env.lighting.lampTest();
    const lvl = this.env.lighting.annunciatorLevel();
    // Instanced parts (after build): hidden with the keypad; the original meshes are drawn while hovered or
    // keyboard-focused so the hover rim can attach to them.
    const inst = ControlInstances.of(this.object);
    inst?.sync(this.hoverOn || this.focused);
    for (let i = 0; i < this.keyList.length; i++) {
      const k = this.keyList[i];
      k.press = smoothTo(k.press, k.down ? 1 : 0, dt, 0.012, 1e-4);
      const z = -k.press * 0.0014;
      if (z !== k.appliedZ) {
        k.appliedZ = z;
        k.group.position.z = z;
        inst?.moved(k.group);
      }
      if (k.bar && k.def.lightVar) {
        const lit = test || this.env.vars.get(k.def.lightVar) !== 0;
        k.bar.level = smoothTo(k.bar.level, lit ? 1.5 * lvl : 0, dt, 0.025, 1e-3);
        k.bar.mat.emissiveIntensity = k.bar.level;
      }
    }
    for (let i = 0; i < this.faces.length; i++) this.faces[i].update(dt);
    inst?.syncLenses();
  }

  override dispose(): void {
    for (const f of this.faces) f.dispose();
    super.dispose();
  }

  private pressKey(k: KeyState): void {
    k.down = true;
    this.logic.press(k.def.id);
    this.playSound(COCKPIT_SOUNDS.key);
  }

  private releaseKey(k: KeyState): void {
    if (!k.down) return;
    k.down = false;
    this.logic.release(k.def.id);
  }

  private buildKey(k: KeyDef, cx: number, cy: number, w: number, h: number): void {
    const o = this.o;
    const group = new THREE.Group();
    group.position.set(cx, cy, 0);
    this.object.add(group);
    const depth = 0.0055;
    const g = this.geo(`key.${w.toFixed(5)}.${h.toFixed(5)}`, () => {
      const b = roundedBox(w, h, depth, Math.min(w, h) * 0.12, 3);
      b.translate(0, 0, depth / 2);
      return b;
    });
    const sm = (k.style ? o.styleMaterials?.[k.style] : undefined) ?? o.keyMaterial ?? 'plasticGrey';
    const mat = typeof sm === 'string' ? this.env.materials.get(sm) : sm;
    markMovingPart(this.mesh(g, mat, group), group);
    const label = k.label ?? k.id;
    const lines = label.split('\n').length;
    const th = o.legendHeight ?? Math.min(0.0024, (h * 0.5) / lines);
    const zone = o.zone === undefined ? 'panel' : o.zone;
    const hasBar = !!k.lightVar;
    // A blank legend (e.g. display bezel softkeys, label: '') draws nothing: skip its label mesh (one draw call per key).
    if (label.trim() !== '') {
      const l = this.engrave(label, 0, hasBar ? h * 0.16 : 0, { height: th, font: KEY_FONT, weight: 700, zone, color: o.legendColor ?? '#f2f2ee', spacing: 0.02 }, group, true);
      l.position.z = depth + 0.0001;
      // Shrink long legends to fit the key.
      const maxW = w * 0.86;
      if (l.userData.width_m > maxW) l.scale.setScalar(maxW / l.userData.width_m);
      markMovingPart(l, group);
    }
    let bar: KeyState['bar'] = null;
    if (hasBar) {
      const m = this.own(this.env.materials.lens('white', null, 0.15));
      const bm = new THREE.Mesh(this.geo(`key.bar.${w.toFixed(5)}`, () => new THREE.PlaneGeometry(w * 0.6, h * 0.13)), m);
      bm.position.set(0, -h * 0.24, depth + 0.0001);
      group.add(bm);
      markMovingPart(bm, group);
      bar = { mat: m, level: 0 };
    }
    const hit = this.addHitBox(w + 0.0005, h + 0.0005, depth + 0.003, 0, 0, depth / 2, group);
    const st: KeyState = { def: k, group, hit, press: 0, appliedZ: 0, down: false, bar };
    this.keys.set(k.id, st);
    this.keyList.push(st);
    this.byHit.set(hit, st);
  }
}
