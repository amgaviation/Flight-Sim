/**
 * Annunciator lenses: multi-segment lit legends used by push buttons
 * (Korry-style switch-lights), stand-alone annunciator lights, gear handle
 * lamps and keypad lights.
 *
 * Each segment is a small quad whose texture (label atlas cell) holds the
 * legend and whose own material glows in the lamp colour when lit:
 *  - 'legend' style: legend glows, background stays dark (most annunciators);
 *  - 'field' style: the whole lens glows with a dark legend (warning lights).
 * Unlit segments show a dark tinted lens with a faintly visible legend.
 *
 * A segment is lit when its var satisfies `test` (default: != 0), during
 * lamp test (ALERT.annunTest), or when its owner forces it (e.g. a latched
 * button's integral ON light via `whenOn`). Brightness follows
 * `lighting.annunciatorLevel()` (BRT/DIM and annunciator power) with a short
 * filament lag.
 */
import * as THREE from 'three';
import type { ControlPointer } from '../types';
import { COCKPIT_SOUNDS } from '../types';
import type { CockpitEnv } from '../env';
import type { LampColor } from '../materials';
import { ControlBase, type ControlOptions } from './ControlBase';
import { smoothTo } from '../anim';
import { rectBezelGeometry } from '../geometry/panel';

export interface LegendSegment {
  /** Legend text; string with '\n' or array of lines. '' = plain lamp. */
  text: string | string[];
  color: LampColor | THREE.ColorRepresentation;
  /** Var that lights the segment. */
  var?: string;
  /** Lit test on the var value (default v != 0). */
  test?: (v: number) => boolean;
  /** Lit whenever the owning button's value is non-zero (latched ON legend). */
  whenOn?: boolean;
  style?: 'legend' | 'field';
}

interface SegState {
  def: LegendSegment;
  mat: THREE.MeshStandardMaterial;
  mesh: THREE.Mesh;
  level: number;
  lit: boolean;
}

/** A rectangular lens face split into lit segments, facing +Z, centred at the origin. */
export class LegendFace {
  readonly group = new THREE.Group();
  private readonly env: CockpitEnv;
  private readonly segs: SegState[] = [];
  private readonly intensity: number;

  constructor(
    env: CockpitEnv,
    segments: LegendSegment[],
    w: number,
    h: number,
    layout: 'stack' | 'split' = 'stack',
    opts: { intensity?: number; gap?: number; own?: (m: THREE.Material) => void } = {},
  ) {
    this.env = env;
    this.intensity = opts.intensity ?? 1.4;
    const n = Math.max(1, segments.length);
    const gap = opts.gap ?? Math.min(w, h) * 0.04;
    const sw = layout === 'split' ? (w - gap * (n - 1)) / n : w;
    const sh = layout === 'split' ? h : (h - gap * (n - 1)) / n;
    const pxPerM = 14000;
    segments.forEach((def, i) => {
      const lines = Array.isArray(def.text) ? def.text : def.text.split('\n');
      const pw = Math.max(16, Math.min(320, Math.round(sw * pxPerM)));
      const ph = Math.max(12, Math.min(256, Math.round(sh * pxPerM)));
      const style = def.style ?? 'legend';
      const lg = env.labels.legend(lines.length ? lines : [''], pw, ph, style);
      const mat = env.materials.lens(def.color, lg.texture, style === 'field' ? 0.16 : 0.2);
      mat.map = lg.texture;
      opts.own?.(mat);
      const geo = env.labels.quad(lg.rect, sw, sh);
      const mesh = new THREE.Mesh(geo, mat);
      if (layout === 'split') mesh.position.x = -w / 2 + sw / 2 + i * (sw + gap);
      else mesh.position.y = h / 2 - sh / 2 - i * (sh + gap);
      mesh.name = `legend:${lines.join(' ')}`;
      this.group.add(mesh);
      this.segs.push({ def, mat, mesh, level: 0, lit: false });
    });
    // Dark lens body behind segments (visible in the gaps).
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), env.materials.get('lcdOff'));
    back.position.z = -0.0001;
    back.userData.ownedGeometry = true;
    this.group.add(back);
  }

  /** Number of segments. */
  get count(): number {
    return this.segs.length;
  }

  /** True when segment i is currently lit (logic state, before lamp lag). */
  isLit(i: number): boolean {
    return this.segs[i]?.lit ?? false;
  }

  /** Legend text of lit segments (for tooltips). */
  litText(): string {
    const out: string[] = [];
    for (const s of this.segs) if (s.lit) out.push(Array.isArray(s.def.text) ? s.def.text.join(' ') : s.def.text.replace(/\n/g, ' '));
    return out.join(' / ');
  }

  /** Per-frame update. `ownerOn` = owning button value != 0; `forceAll` lights everything (press-to-test). */
  update(dt: number, ownerOn = false, forceAll = false): void {
    const L = this.env.lighting;
    const test = forceAll || L.lampTest();
    const level = L.annunciatorLevel();
    const v = this.env.vars;
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      const d = s.def;
      let lit = false;
      if (d.var) {
        const x = v.get(d.var);
        lit = d.test ? d.test(x) : x !== 0;
      }
      if (d.whenOn && ownerOn) lit = true;
      s.lit = lit;
      const target = lit || test ? this.intensity * level : 0;
      s.level = smoothTo(s.level, target, dt, 0.025, 1e-3);
      s.mat.emissiveIntensity = s.level;
    }
  }

  dispose(): void {
    for (const c of this.group.children) {
      const m = c as THREE.Mesh;
      if (m.userData.ownedGeometry) m.geometry.dispose();
    }
  }
}

export interface AnnunciatorLightOptions extends ControlOptions {
  segments: LegendSegment[];
  layout?: 'stack' | 'split';
  /** Lens size (m). Default 0.016 x 0.012. */
  width?: number;
  height?: number;
  /** Draw a bezel frame (default true). */
  bezel?: boolean;
  /** Pressing the lens lights every segment (press-to-test lamps). */
  pressToTest?: boolean;
  /** Emissive intensity when lit (default 1.4). */
  intensity?: number;
}

/**
 * Stand-alone annunciator light (gear lights, marker beacons, caution
 * panels). Hovering shows its legend and lit state; `pressToTest` lamps
 * light while pressed.
 */
export class AnnunciatorLight extends ControlBase {
  readonly face: LegendFace;
  private readonly o: AnnunciatorLightOptions;
  private testing = false;

  constructor(env: CockpitEnv, o: AnnunciatorLightOptions) {
    super(env, o);
    this.o = o;
    const w = o.width ?? 0.016;
    const h = o.height ?? 0.012;
    if (o.bezel !== false) this.mesh(this.geo(`annun.bezel.${w}.${h}`, () => rectBezelGeometry(w, h, 0.0015, 0.0022, 0.0015, 0.0005)), 'bezel', this.object, true);
    this.face = new LegendFace(env, o.segments, w, h, o.layout ?? 'stack', { intensity: o.intensity, own: (m) => this.own(m) });
    this.face.group.position.z = 0.0012;
    this.object.add(this.face.group);
    this.addHitBox(w + 0.003, h + 0.003, 0.006, 0, 0, 0.002);
  }

  protected stateText(): string {
    return this.face.litText() || 'OFF';
  }

  onPointerDown(p: ControlPointer): void {
    if (!this.o.pressToTest || p.button !== 0 || !this.enabled) return;
    this.testing = true;
    this.playSound(COCKPIT_SOUNDS.buttonPress, 0.6);
  }

  onPointerUp(_p?: ControlPointer): void {
    if (this.testing) this.playSound(COCKPIT_SOUNDS.buttonRelease, 0.5);
    this.testing = false;
  }

  onCancel(): void {
    this.testing = false;
  }

  override update(dt: number): void {
    this.face.update(dt, false, this.testing);
    if (this.testing) this.face.group.position.z = 0.0006;
    else this.face.group.position.z = 0.0012;
  }

  override dispose(): void {
    this.face.dispose();
    super.dispose();
  }
}
