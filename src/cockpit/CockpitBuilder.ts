/**
 * CockpitBuilder: assembles a complete cockpit from panels, controls,
 * displays, structure and lighting, and produces a `CockpitBuild`.
 *
 *   const b = new CockpitBuilder(ctx, { palette: 'boeing', eyePosition_m: [x, y, z] });
 *   const ovhd = b.panel({ name: 'overhead', center_m: [...], facing: 'down', tiltDeg: -12, width: 0.9, height: 0.6 });
 *   b.addSwitchRow(ovhd, { x: -0.3, y: 0.2, spacing: 0.035 }, [
 *     { type: 'toggle', id: 'batt', var: 'ac.elec.batt_sw', label: 'BAT', caption: 'BAT' },
 *     { type: 'spacer' },
 *     { type: 'button', id: 'gen1', var: 'ac.elec.gen1', mode: 'toggle', segments: [...] },
 *   ]);
 *   const build = b.build();
 *
 * All sizes in metres, placements in body axes (x fwd, y right, z down).
 * Panel-local positions are (x, y) in the panel's origin convention.
 */
import * as THREE from 'three';
import type { CockpitBuild, CockpitControl, CockpitDisplay } from './types';
import { createCockpitEnv, type CockpitEnv, type CockpitEnvOptions, type CockpitHost } from './env';
import type { MaterialName } from './materials';
import type { TextStyle } from './labels';
import type { CockpitLightSpec, LightingZoneOptions } from './Lighting';
import { bodyToLocalV, placeOnPanel, placePanel, type BodyVec, type PanelPlacement, type PlaceOnPanelOptions } from './frame';
import { consolidateStatic, type MergeStats } from './merge';
import { instanceMovingParts, type MovingInstanceStats } from './instancing';
import type { DisplayOptions } from './DisplayManager';
import {
  ATI2_HOLE,
  ATI3_HOLE,
  displayScreenGeometry,
  glassDiscGeometry,
  panelGeometry,
  recessGeometry,
  rectBezelGeometry,
  roundBezelGeometry,
  screwHeadGeometry,
  screwInstances,
  screwPattern,
  squareFlangeGeometry,
  type Cutout,
  type ScrewKind,
} from './geometry/panel';
import { seatGeometry, type SeatStyle } from './geometry/structure';
import {
  AnnunciatorLight,
  CircuitBreaker,
  GuardedButton,
  GuardedSwitch,
  Placard,
  PushButton,
  PushPullKnob,
  RockerSwitch,
  RotaryKnob,
  SelectorKnob,
  TBarHandle,
  Thumbwheel,
  ToggleSwitch,
  type AnnunciatorLightOptions,
  type CircuitBreakerOptions,
  type GuardedButtonOptions,
  type GuardedSwitchOptions,
  type PlacardOptions,
  type PushButtonOptions,
  type PushPullKnobOptions,
  type RockerSwitchOptions,
  type RotaryKnobOptions,
  type SelectorKnobOptions,
  type TBarHandleOptions,
  type ThumbwheelOptions,
  type ToggleSwitchOptions,
} from './controls';
import type { CompositeControl } from './controls/FlightControls';

export interface CockpitBuilderOptions extends CockpitEnvOptions {
  /** Default pilot eye position (body metres). */
  eyePosition_m: [number, number, number];
  views?: CockpitBuild['views'];
  /** Consolidate static meshes in build() (default true). */
  mergeStatic?: boolean;
  /**
   * Draw the moving parts of keypads, breakers and push buttons as instanced
   * batches in build() (instancing.ts; default true, only with mergeStatic).
   */
  instanceMoving?: boolean;
  /** Reuse an existing environment instead of creating one. */
  env?: CockpitEnv;
  name?: string;
}

export interface PanelOptions extends PanelPlacement {
  name: string;
  width: number;
  height: number;
  thickness?: number;
  radius?: number;
  bevel?: number;
  /** Cutouts in this panel's coordinate convention. */
  cutouts?: Cutout[];
  material?: MaterialName | THREE.Material;
  /**
   * Fasteners: false = none; default = Phillips screws at the corners (and
   * every 0.2 m along long edges), inset 6 mm, 4.2 mm heads.
   */
  screws?: false | { kind?: ScrewKind; diameter?: number; inset?: number; pitch?: number; positions?: [number, number][] };
  /**
   * Coordinate convention for everything placed on this panel:
   * 'center' (default): (x, y) = metres right/up from the panel centre.
   * 'top-left': (x, y) = metres right from the left edge / DOWN from the top edge.
   */
  origin?: 'center' | 'top-left';
  /** Dark recess boxes behind rectangular cutouts (default true). */
  recessCutouts?: boolean;
  /** Hide the plate (placement frame only, e.g. for a yoke or pedals). */
  invisible?: boolean;
}

/** Placement fields accepted by every spec in a switch row / grid. */
interface SpecPlacement {
  /** Extra offset from the row slot (m). */
  dx?: number;
  dy?: number;
  rotDeg?: number;
  /** Engraved caption above the control. */
  caption?: string;
  captionOffset?: number;
  /** Override the row spacing after this item. */
  gap?: number;
}

export type ControlSpec = SpecPlacement &
  (
    | ({ type: 'toggle' } & ToggleSwitchOptions)
    | ({ type: 'rocker' } & RockerSwitchOptions)
    | ({ type: 'guarded' } & GuardedSwitchOptions)
    | ({ type: 'guardedButton' } & GuardedButtonOptions)
    | ({ type: 'button' } & PushButtonOptions)
    | ({ type: 'annunciator' } & AnnunciatorLightOptions)
    | ({ type: 'knob' } & RotaryKnobOptions)
    | ({ type: 'selector' } & SelectorKnobOptions)
    | ({ type: 'breaker' } & CircuitBreakerOptions)
    | ({ type: 'thumbwheel' } & ThumbwheelOptions)
    | ({ type: 'pushpull' } & PushPullKnobOptions)
    | ({ type: 'tbar' } & TBarHandleOptions)
    | ({ type: 'placard' } & PlacardOptions)
    | { type: 'spacer' }
  );

/** Creates a control (or placard) from a data spec. Spacers return null. */
export function createControl(env: CockpitEnv, spec: ControlSpec): CockpitControl | Placard | null {
  switch (spec.type) {
    case 'toggle':
      return new ToggleSwitch(env, spec);
    case 'rocker':
      return new RockerSwitch(env, spec);
    case 'guarded':
      return new GuardedSwitch(env, spec);
    case 'guardedButton':
      return new GuardedButton(env, spec);
    case 'button':
      return new PushButton(env, spec);
    case 'annunciator':
      return new AnnunciatorLight(env, spec);
    case 'knob':
      return new RotaryKnob(env, spec);
    case 'selector':
      return new SelectorKnob(env, spec);
    case 'breaker':
      return new CircuitBreaker(env, spec);
    case 'thumbwheel':
      return new Thumbwheel(env, spec);
    case 'pushpull':
      return new PushPullKnob(env, spec);
    case 'tbar':
      return new TBarHandle(env, spec);
    case 'placard':
      return new Placard(env, spec);
    case 'spacer':
      return null;
  }
}

/** Default caption offsets above a control (m), per spec type. */
const CAPTION_OFFSET: Partial<Record<ControlSpec['type'], number>> = {
  toggle: 0.0175,
  rocker: 0.017,
  guarded: 0.026,
  guardedButton: 0.016,
  button: 0.0135,
  annunciator: 0.011,
  knob: 0.0165,
  selector: 0.03,
  breaker: 0.0105,
  thumbwheel: 0.012,
  pushpull: 0.022,
  tbar: 0.022,
};

export interface RowLayout {
  /** First slot position in the panel's coordinate convention. */
  x: number;
  y: number;
  /** Distance between slots (m). */
  spacing: number;
  /** 'right' (default) or 'down' (toward -v, i.e. down the panel). */
  direction?: 'right' | 'down';
  /** Default caption height (m). */
  captionHeight?: number;
}

export interface GridLayout {
  x: number;
  y: number;
  /** Column and row pitch (m). Rows go down the panel. */
  dx: number;
  dy: number;
  captionHeight?: number;
}

/** A panel: a placed plate with its own 2D coordinate system for controls and labels. */
export class Panel {
  readonly name: string;
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh | null;
  readonly width: number;
  readonly height: number;
  readonly origin: 'center' | 'top-left';
  private readonly builder: CockpitBuilder;

  constructor(builder: CockpitBuilder, o: PanelOptions, parent: Panel | null, at?: { x: number; y: number; z?: number; rotDeg?: number }) {
    this.builder = builder;
    this.name = o.name;
    this.width = o.width;
    this.height = o.height;
    this.origin = o.origin ?? 'center';
    this.group.name = `panel:${o.name}`;
    const env = builder.env;
    if (parent && at) {
      const [u, v] = parent.uv(at.x, at.y);
      placeOnPanel(this.group, u, v, { z: at.z ?? 0.0006, rotDeg: at.rotDeg });
      parent.group.add(this.group);
    } else {
      placePanel(this.group, o);
      builder.root.add(this.group);
    }
    const cut = (o.cutouts ?? []).map((c): Cutout => {
      const [u, v] = this.uv(c.u, c.v);
      return { ...c, u, v } as Cutout;
    });
    if (o.invisible) this.mesh = null;
    else {
      const mat = o.material ?? 'panel';
      const g = panelGeometry({ width: o.width, height: o.height, thickness: o.thickness, radius: o.radius, bevel: o.bevel, cutouts: cut });
      const m = new THREE.Mesh(g, typeof mat === 'string' ? env.materials.get(mat) : mat);
      m.name = `panelPlate:${o.name}`;
      m.userData.ownsGeometry = true;
      this.group.add(m);
      this.mesh = m;
      builder.trackGeometry(g);
      if (o.recessCutouts !== false) {
        for (const c of cut) {
          if (c.shape !== 'rect') continue;
          const r = new THREE.Mesh(env.geometry.get(`recess.${c.w.toFixed(4)}.${c.h.toFixed(4)}`, () => recessGeometry(c.w, c.h, 0.025)), env.materials.get('panelDark'));
          r.position.set(c.u, c.v, -(o.thickness ?? 0.0032));
          r.userData.cockpitStatic = true;
          this.group.add(r);
        }
      }
      if (o.screws !== false) {
        const s = o.screws ?? {};
        const kind = s.kind ?? 'phillips';
        const d = s.diameter ?? 0.0042;
        const pos = s.positions ? s.positions.map(([x, y]) => this.uv(x, y)) : screwPattern(o.width, o.height, s.inset ?? 0.006, s.pitch ?? 0.2);
        const top: MaterialName = kind === 'phillips' ? 'screwPhillips' : kind === 'hex' ? 'screwHex' : 'screwSlot';
        const inst = screwInstances(pos, env.geometry.get(`screw.${kind}.${d}`, () => screwHeadGeometry(kind, d)), [env.materials.get('screw'), env.materials.get(top), env.materials.get('screw')]);
        this.group.add(inst);
      }
    }
  }

  /** Converts (x, y) in this panel's convention to centred (u, v). */
  uv(x: number, y: number): [number, number] {
    return this.origin === 'top-left' ? [x - this.width / 2, this.height / 2 - y] : [x, y];
  }

  /** Places and registers a control at (x, y). */
  add<T extends CockpitControl>(control: T, x: number, y: number, opts?: PlaceOnPanelOptions): T {
    const [u, v] = this.uv(x, y);
    placeOnPanel(control.object, u, v, opts);
    this.group.add(control.object);
    this.builder.add(control);
    return control;
  }

  /** Places any object (static part, placard) at (x, y). */
  addObject<T extends THREE.Object3D>(obj: T, x: number, y: number, opts?: PlaceOnPanelOptions): T {
    const [u, v] = this.uv(x, y);
    placeOnPanel(obj, u, v, opts);
    this.group.add(obj);
    return obj;
  }

  /** Engraved (backlit) text at (x, y). */
  label(text: string, x: number, y: number, style: Partial<TextStyle> = {}): THREE.Mesh {
    const l = this.builder.env.labels.text(text, { height: 0.0028, weight: 700, ...style });
    return this.addObject(l, x, y, { z: 0.00015 });
  }

  /** Group bracket line with a centred title (overhead-panel style). */
  bracket(title: string, x: number, y: number, width: number, style: Partial<TextStyle> = {}): THREE.Group {
    const g = this.builder.env.labels.bracket(title, width, { height: 0.0028, weight: 700, ...style });
    g.traverse((c) => (c.userData.cockpitStatic = true));
    return this.addObject(g, x, y);
  }

  /** Engraved line between two points. */
  line(x0: number, y0: number, x1: number, y1: number, width = 0.0005, zone: string | null = 'panel'): THREE.Mesh {
    const [u0, v0] = this.uv(x0, y0);
    const [u1, v1] = this.uv(x1, y1);
    const l = this.builder.env.labels.line(u0, v0, u1, v1, width, zone);
    this.group.add(l);
    return l;
  }

  placard(o: PlacardOptions, x: number, y: number, opts?: PlaceOnPanelOptions): Placard {
    return this.addObject(new Placard(this.builder.env, o), x, y, opts);
  }

  /** A module plate mounted on this panel (Boeing-style overhead modules, bizjet sub-panels). */
  subPanel(o: Omit<PanelOptions, keyof PanelPlacement> & { x: number; y: number; z?: number; rotDeg?: number }): Panel {
    return this.builder.registerPanel(new Panel(this.builder, { ...o, center_m: [0, 0, 0] }, this, { x: o.x, y: o.y, z: o.z, rotDeg: o.rotDeg }));
  }

  /**
   * A rectangular display: screen plane (w x h) at (x, y) with an optional
   * bezel frame; registers the display. Returns the screen mesh.
   */
  display(
    display: CockpitDisplay,
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { bezel?: false | { border?: number | [number, number, number, number]; depth?: number; material?: MaterialName }; z?: number; display?: DisplayOptions } = {},
  ): THREE.Mesh {
    const env = this.builder.env;
    const [u, v] = this.uv(x, y);
    const screen = new THREE.Mesh(env.geometry.get(`screen.${w.toFixed(4)}.${h.toFixed(4)}`, () => displayScreenGeometry(w, h)), env.materials.get('lcdOff'));
    screen.name = `display:${display.id}`;
    screen.position.set(u, v, opts.z ?? 0.001);
    this.group.add(screen);
    if (opts.bezel !== false) {
      const b = opts.bezel ?? {};
      const depth = b.depth ?? 0.008;
      const bezel = new THREE.Mesh(
        env.geometry.get(`dbezel.${w.toFixed(4)}.${h.toFixed(4)}.${JSON.stringify(b.border ?? 0.012)}.${depth}`, () => rectBezelGeometry(w, h, b.border ?? 0.012, depth, 0.008, 0.0015)),
        env.materials.get(b.material ?? 'bezel'),
      );
      bezel.position.set(u, v, 0);
      bezel.userData.cockpitStatic = true;
      this.group.add(bezel);
      screen.position.z = Math.max(screen.position.z, 0.0015);
    }
    this.builder.addDisplay(display, screen, opts.display);
    return screen;
  }

  /**
   * Round electromechanical instrument (3ATI / 2ATI): square flange, bezel
   * ring, face disc showing the display canvas, cover glass.
   */
  roundInstrument(display: CockpitDisplay, x: number, y: number, size: '3ATI' | '2ATI' | number = '3ATI', opts: { flange?: boolean; display?: DisplayOptions } = {}): THREE.Mesh {
    const env = this.builder.env;
    const [u, v] = this.uv(x, y);
    const d = size === '3ATI' ? ATI3_HOLE : size === '2ATI' ? ATI2_HOLE : size;
    const grp = new THREE.Group();
    grp.position.set(u, v, 0);
    this.group.add(grp);
    if (opts.flange !== false) {
      const fl = new THREE.Mesh(env.geometry.get(`flange.${d}`, () => squareFlangeGeometry(d * 1.16, d * 0.98)), env.materials.get('bezel'));
      fl.userData.cockpitStatic = true;
      grp.add(fl);
    }
    const ring = new THREE.Mesh(env.geometry.get(`rbezel.${d}`, () => roundBezelGeometry(d * 0.96, 0.0035, 0.004)), env.materials.get('bezelGloss'));
    ring.userData.cockpitStatic = true;
    grp.add(ring);
    const face = new THREE.Mesh(env.geometry.get(`face.${d}`, () => glassDiscGeometry(d * 0.95)), env.materials.get('lcdOff'));
    face.name = `display:${display.id}`;
    // Just above the flange, inside the bezel ring (no panel cutout needed).
    face.position.z = 0.0017;
    grp.add(face);
    this.builder.addDisplay(display, face, { glass: true, ...opts.display });
    return face;
  }
}

/** CockpitBuild plus the builder's shared resources. */
export interface CockpitBuildEx extends CockpitBuild {
  env: CockpitEnv;
  mergeStats: MergeStats | null;
  /** Moving control parts drawn as instances (instancing.ts); null when none. */
  movingStats?: MovingInstanceStats | null;
}

export class CockpitBuilder {
  readonly env: CockpitEnv;
  readonly root = new THREE.Group();
  readonly controls: CockpitControl[] = [];
  readonly displays: { display: CockpitDisplay; mesh: THREE.Mesh }[] = [];
  readonly occluders: THREE.Object3D[] = [];
  readonly panels = new Map<string, Panel>();
  private readonly o: CockpitBuilderOptions;
  private readonly hooks: ((dt: number) => void)[] = [];
  private readonly ownedGeometry: THREE.BufferGeometry[] = [];
  private readonly controlIds = new Set<string>();
  private built = false;

  constructor(host: CockpitHost, o: CockpitBuilderOptions) {
    this.o = o;
    this.env = o.env ?? createCockpitEnv(host, o);
    this.env.root = this.root;
    this.root.name = `cockpit:${o.name ?? 'root'}`;
  }

  /** Creates a top-level panel placed in body axes. */
  panel(o: PanelOptions): Panel {
    return this.registerPanel(new Panel(this, o, null));
  }

  /** @internal */
  registerPanel(p: Panel): Panel {
    if (this.panels.has(p.name)) throw new Error(`CockpitBuilder: duplicate panel '${p.name}'`);
    this.panels.set(p.name, p);
    return p;
  }

  /** Registers a control (and its sub-controls/occluders). Does not place it. */
  add<T extends CockpitControl>(control: T): T {
    if (this.controlIds.has(control.id)) throw new Error(`CockpitBuilder: duplicate control id '${control.id}'`);
    this.controlIds.add(control.id);
    this.controls.push(control);
    const comp = control as unknown as Partial<CompositeControl>;
    if (comp.subControls) for (const c of comp.subControls) this.add(c);
    if (comp.occluders) this.occluders.push(...comp.occluders);
    if (!control.object.parent) this.root.add(control.object);
    return control;
  }

  /**
   * Places a control (or any object) directly in body axes, with the panel
   * frame of the given facing (e.g. a yoke: facing 'aft' at the hub).
   */
  place<T extends CockpitControl>(control: T, p: PanelPlacement): T {
    placePanel(control.object, p);
    this.root.add(control.object);
    return this.add(control);
  }

  /** Registers a display (mesh already in the scene graph). */
  addDisplay(display: CockpitDisplay, mesh: THREE.Mesh, opts?: DisplayOptions): void {
    if (opts) mesh.userData.displayOptions = opts;
    this.displays.push({ display, mesh });
  }

  /**
   * Adds structure (glareshield, pillars, seats, consoles). `position_m` is
   * body metres; the object's own axes are cockpit-local (x right, y up, z aft).
   */
  addStructure<T extends THREE.Object3D>(obj: T, position_m?: BodyVec, opts: { occluder?: boolean; static?: boolean } = {}): T {
    if (position_m) bodyToLocalV(position_m, obj.position);
    this.root.add(obj);
    if (opts.static !== false) obj.traverse((c) => ((c as THREE.Mesh).isMesh ? (c.userData.cockpitStatic = true) : undefined));
    if (opts.occluder !== false) this.occluders.push(obj);
    return obj;
  }

  /** A structure mesh from geometry + material name, at a body position. */
  structureMesh(geometry: THREE.BufferGeometry, material: MaterialName | THREE.Material, position_m?: BodyVec, rotation?: THREE.Euler, occluder = true): THREE.Mesh {
    const m = new THREE.Mesh(geometry, typeof material === 'string' ? this.env.materials.get(material) : material);
    if (rotation) m.rotation.copy(rotation);
    this.trackGeometry(geometry);
    return this.addStructure(m, position_m, { occluder });
  }

  /** Crew seat at a body position (origin on the floor under the front of the seat pan). */
  seat(style: SeatStyle, position_m: BodyVec, material?: MaterialName): THREE.Group {
    const parts = seatGeometry(style);
    const g = new THREE.Group();
    const mat = material ?? (this.env.materials.palette.seatMaterial === 'fabric' ? 'fabric' : 'leather');
    g.add(new THREE.Mesh(parts.cushion, this.env.materials.get(mat)));
    g.add(new THREE.Mesh(parts.back, this.env.materials.get(mat)));
    g.add(new THREE.Mesh(parts.frame, this.env.materials.get('plasticBlack')));
    this.trackGeometry(parts.cushion, parts.back, parts.frame);
    g.name = 'seat';
    return this.addStructure(g, position_m);
  }

  /** @internal Geometry disposed with the build. */
  trackGeometry(...g: THREE.BufferGeometry[]): void {
    this.ownedGeometry.push(...g);
  }

  /**
   * Lays out controls in a row (or column) on a panel from data specs.
   * Returns the created controls (spacers and placards excluded).
   */
  addSwitchRow(panel: Panel, layout: RowLayout, specs: ControlSpec[]): CockpitControl[] {
    const out: CockpitControl[] = [];
    let x = layout.x;
    let y = layout.y;
    const sign = panel.origin === 'top-left' ? 1 : -1; // 'down' direction in panel coordinates
    for (const spec of specs) {
      const c = this.placeSpec(panel, spec, x, y, layout.captionHeight);
      if (c) out.push(c);
      const step = spec.gap ?? layout.spacing;
      if ((layout.direction ?? 'right') === 'right') x += step;
      else y += sign * step;
    }
    return out;
  }

  /** Lays out a grid of specs (rows down the panel). null cells are empty. */
  addGrid(panel: Panel, layout: GridLayout, rows: (ControlSpec | null)[][]): CockpitControl[] {
    const out: CockpitControl[] = [];
    const sign = panel.origin === 'top-left' ? 1 : -1;
    rows.forEach((row, r) => {
      row.forEach((spec, c) => {
        if (!spec) return;
        const ctl = this.placeSpec(panel, spec, layout.x + c * layout.dx, layout.y + sign * r * layout.dy, layout.captionHeight);
        if (ctl) out.push(ctl);
      });
    });
    return out;
  }

  /** Adds or reconfigures a lighting zone. */
  zone(o: LightingZoneOptions): void {
    this.env.lighting.addZone(o);
  }

  /** Adds a real light driven by a zone. */
  light(spec: CockpitLightSpec): THREE.PointLight | THREE.SpotLight {
    return this.env.lighting.addLight(spec, this.root);
  }

  /** Per-frame hook run by build.update. */
  onUpdate(fn: (dt: number) => void): void {
    this.hooks.push(fn);
  }

  /** Finalizes the cockpit. */
  build(): CockpitBuildEx {
    if (this.built) throw new Error('CockpitBuilder: build() called twice');
    this.built = true;
    this.env.labels.flush();
    // Interior occlusion for every lit material in the cockpit, including
    // materials created by other modules (analog gauges, aircraft parts).
    this.root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      if (Array.isArray(m)) for (const x of m) this.env.materials.patchInterior(x);
      else this.env.materials.patchInterior(m);
    });
    let mergeStats: MergeStats | null = null;
    const merged: THREE.Mesh[] = [];
    if (this.o.mergeStatic !== false) {
      const r = consolidateStatic(this.root);
      mergeStats = r.stats;
      merged.push(...r.meshes);
    }
    const moving = this.o.mergeStatic !== false && this.o.instanceMoving !== false ? instanceMovingParts(this.root, this.env.materials, this.env.lighting) : null;
    const env = this.env;
    const hooks = this.hooks;
    const owned = this.ownedGeometry;
    const controls = this.controls;
    const displays = this.displays;
    const root = this.root;
    const build: CockpitBuildEx = {
      root,
      eyePosition_m: this.o.eyePosition_m,
      views: this.o.views,
      controls,
      displays,
      lighting: env.lighting.zones(),
      occluders: this.occluders,
      env,
      mergeStats,
      movingStats: moving?.stats ?? null,
      update(dt: number) {
        env.lighting.update(dt);
        env.labels.flush();
        for (let i = 0; i < hooks.length; i++) hooks[i](dt);
      },
      dispose() {
        for (const c of controls) c.dispose?.();
        for (const d of displays) d.display.dispose?.();
        for (const m of merged) if (m.userData.ownsGeometry) m.geometry.dispose();
        moving?.dispose();
        for (const g of owned) g.dispose();
        root.removeFromParent();
        env.dispose();
      },
    };
    return build;
  }

  private placeSpec(panel: Panel, spec: ControlSpec, x: number, y: number, captionHeight?: number): CockpitControl | null {
    const made = createControl(this.env, spec);
    const px = x + (spec.dx ?? 0);
    const py = y + (panel.origin === 'top-left' ? -(spec.dy ?? 0) : (spec.dy ?? 0));
    if (made instanceof Placard) {
      panel.addObject(made, px, py, { rotDeg: spec.rotDeg });
      return null;
    }
    if (made) panel.add(made, px, py, { rotDeg: spec.rotDeg });
    if (spec.caption) {
      const off = spec.captionOffset ?? CAPTION_OFFSET[spec.type] ?? 0.015;
      panel.label(spec.caption, px, panel.origin === 'top-left' ? py - off : py + off, { height: captionHeight ?? 0.0026 });
    }
    return made;
  }
}
