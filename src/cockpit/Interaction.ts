/**
 * CockpitInteraction: mouse/touch/pen interaction with 3D cockpit controls
 * and touchscreen displays.
 *
 * Conventions (documented for every aircraft):
 *  - Hovering a control highlights its moving parts with a soft rim glow and
 *    shows a tooltip "NAME: STATE"; the cursor hints at the gesture.
 *  - Left click = primary action, right click = secondary action, middle
 *    click (or Ctrl+left) = push (knobs). Wheel rotates/steps (Shift+wheel =
 *    inner knob of a concentric pair). Drag = levers, yokes, thumbwheels,
 *    knobs, trim wheels (pointer capture; pointer lock for controls that
 *    request it, e.g. the yoke).
 *  - Free look: dragging with a `lookButtons` button (default left and
 *    right) that starts on empty space (no control, no touch display) calls
 *    `onLook(dx, dy)`; the wheel over empty space calls `onEmptyWheel`. A
 *    right click on a control is always the control's secondary action, so
 *    camera look and cockpit clicks never conflict.
 *  - The browser context menu is suppressed on the canvas.
 *  - Touch displays (CockpitDisplay.onPointer): down/move/up/wheel are
 *    forwarded in canvas pixels (UV -> pixel; x right, y down).
 *  - Keyboard focus: clicking a control that implements onKey (keypads)
 *    focuses it; keys go to it until another click or Escape.
 *
 * The ControlPointer object passed to controls is reused between calls;
 * controls must not keep references to it.
 */
import * as THREE from 'three';
import type { CockpitControl, CockpitDisplay, ControlPointer } from './types';

export interface CockpitInteractionOptions {
  /** Element receiving pointer events (the renderer canvas). */
  domElement: HTMLElement;
  camera: THREE.Camera;
  /** Buttons that start free look on empty space. Default [0, 2]. */
  lookButtons?: number[];
  /** Free-look drag (pixels, pointer-lock movement when locked). */
  onLook?: (dx: number, dy: number) => void;
  onLookStart?: () => void;
  onLookEnd?: () => void;
  /** Request pointer lock while free-looking. Default false. */
  lookPointerLock?: boolean;
  /** Wheel over empty space (+1 per notch up), e.g. zoom. */
  onEmptyWheel?: (notches: number) => void;
  /** Show tooltips (default true) and hover highlight (default true). */
  tooltips?: boolean;
  highlight?: boolean;
  highlightColor?: THREE.ColorRepresentation;
  /** Element the tooltip is appended to (default document.body). */
  tooltipContainer?: HTMLElement;
  /** Maximum pick distance (m). Default 12. */
  maxDistance?: number;
}

type Owner = { kind: 'control'; control: CockpitControl } | { kind: 'display'; display: CockpitDisplay; mesh: THREE.Mesh } | { kind: 'occluder' };

export type PickResult =
  | { kind: 'control'; control: CockpitControl; hit: THREE.Intersection }
  | { kind: 'display'; display: CockpitDisplay; mesh: THREE.Mesh; hit: THREE.Intersection; x: number; y: number }
  | null;

/** Rim-glow highlight for hovered controls (overlay meshes sharing geometry). */
export class HoverHighlighter {
  readonly material: THREE.ShaderMaterial;
  private readonly overlays: THREE.Mesh[] = [];
  private target: CockpitControl | null = null;

  constructor(color: THREE.ColorRepresentation = '#9fd3ff') {
    this.material = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, strength: { value: 1 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float strength;
        #include <logdepthbuf_pars_fragment>
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          #include <logdepthbuf_fragment>
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float rim = f * f;
          gl_FragColor = vec4(color * (0.06 + rim * 0.55) * strength, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.material.name = 'cockpit.hoverRim';
  }

  get current(): CockpitControl | null {
    return this.target;
  }

  show(control: CockpitControl | null): void {
    if (control === this.target) return;
    this.clear();
    this.target = control;
    if (!control) return;
    const meshes: THREE.Mesh[] = [];
    control.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
      if (m.userData.hitBox || m.userData.cockpitStatic || m.userData.overlay) return;
      if (m.name.startsWith('label:') || m.name.startsWith('legend:')) return;
      meshes.push(m);
    });
    for (const m of meshes) {
      const ov = new THREE.Mesh(m.geometry, this.material);
      ov.userData.overlay = true;
      ov.renderOrder = 20;
      ov.raycast = () => undefined;
      m.add(ov);
      this.overlays.push(ov);
    }
  }

  clear(): void {
    for (const o of this.overlays) o.removeFromParent();
    this.overlays.length = 0;
    this.target = null;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}

export class CockpitInteraction {
  enabled = true;
  private camera: THREE.Camera;
  private readonly dom: HTMLElement;
  private readonly o: CockpitInteractionOptions;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hits: THREE.Intersection[] = [];
  private readonly owners = new Map<THREE.Object3D, Owner>();
  private targets: THREE.Object3D[] = [];
  private targetsDirty = true;
  private readonly controls = new Set<CockpitControl>();
  private readonly displays = new Map<CockpitDisplay, THREE.Mesh>();
  private readonly occluders: THREE.Object3D[] = [];
  private readonly highlighter: HoverHighlighter | null;
  private readonly tooltip: HTMLDivElement | null = null;
  private tooltipText = '';
  private readonly p: ControlPointer = { button: 0, shift: false, ctrl: false, alt: false, point: new THREE.Vector3(), object: new THREE.Object3D() };
  private hovered: CockpitControl | null = null;
  private hoverDisplay: CockpitDisplay | null = null;
  private focusedCtl: CockpitControl | null = null;
  private active: { control: CockpitControl; pointerId: number; button: 0 | 1 | 2; lastX: number; lastY: number; locked: boolean } | null = null;
  private activeDisplay: { display: CockpitDisplay; mesh: THREE.Mesh; pointerId: number } | null = null;
  private look: { pointerId: number; lastX: number; lastY: number; locked: boolean } | null = null;
  private lastX = -1;
  private lastY = -1;
  private hasPointer = false;
  private recheck = 0;
  private wheelAcc = 0;
  private cursorSet = false;
  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions | boolean | undefined][] = [];

  constructor(o: CockpitInteractionOptions) {
    this.o = o;
    this.dom = o.domElement;
    this.camera = o.camera;
    this.raycaster.near = 0.01;
    this.raycaster.far = o.maxDistance ?? 12;
    this.highlighter = o.highlight === false ? null : new HoverHighlighter(o.highlightColor);
    if (o.tooltips !== false && typeof document !== 'undefined') {
      const t = document.createElement('div');
      t.className = 'cockpit-tooltip';
      Object.assign(t.style, {
        position: 'fixed',
        left: '0px',
        top: '0px',
        pointerEvents: 'none',
        zIndex: '1000',
        background: 'rgba(14,16,20,0.86)',
        color: '#e6ebf2',
        font: '12px/1.35 system-ui, "Segoe UI", Roboto, sans-serif',
        padding: '3px 8px',
        borderRadius: '4px',
        border: '1px solid rgba(160,190,220,0.25)',
        whiteSpace: 'nowrap',
        display: 'none',
        transform: 'translate(14px, 16px)',
      } satisfies Partial<CSSStyleDeclaration>);
      (o.tooltipContainer ?? document.body).appendChild(t);
      this.tooltip = t;
    }
    this.listen(this.dom, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.listen(this.dom, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.listen(this.dom, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.listen(this.dom, 'pointercancel', (e) => this.onCancelEvt(e as PointerEvent));
    this.listen(this.dom, 'pointerleave', () => this.onLeave());
    this.listen(this.dom, 'wheel', (e) => this.onWheelEvt(e as WheelEvent), { passive: false });
    this.listen(this.dom, 'contextmenu', (e) => e.preventDefault());
    if (typeof window !== 'undefined') {
      this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true), true);
      this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false), true);
      this.listen(window, 'blur', () => this.cancelAll());
    }
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /** Registers a control (and nothing else: composite controls' subControls must be registered too). */
  register(control: CockpitControl): void {
    if (this.controls.has(control)) return;
    this.controls.add(control);
    for (const h of control.hitTargets) this.owners.set(h, { kind: 'control', control });
    this.targetsDirty = true;
  }

  registerAll(controls: Iterable<CockpitControl>): void {
    for (const c of controls) this.register(c);
  }

  unregister(control: CockpitControl): void {
    if (!this.controls.delete(control)) return;
    for (const h of control.hitTargets) this.owners.delete(h);
    if (this.hovered === control) this.setHover(null);
    if (this.focusedCtl === control) this.focusedCtl = null;
    if (this.active?.control === control) this.active = null;
    this.targetsDirty = true;
  }

  /** Registers a display mesh: touch forwarding when the display implements onPointer; otherwise it just blocks rays. */
  registerDisplay(display: CockpitDisplay, mesh: THREE.Mesh): void {
    this.displays.set(display, mesh);
    this.owners.set(mesh, { kind: 'display', display, mesh });
    this.targetsDirty = true;
  }

  unregisterDisplay(display: CockpitDisplay): void {
    const m = this.displays.get(display);
    if (!m) return;
    this.displays.delete(display);
    this.owners.delete(m);
    this.targetsDirty = true;
  }

  /** Non-interactive geometry that blocks rays (all meshes under the given objects). */
  setOccluders(objs: THREE.Object3D[]): void {
    for (const o of this.occluders) if (this.owners.get(o)?.kind === 'occluder') this.owners.delete(o);
    this.occluders.length = 0;
    for (const root of objs) {
      root.traverse((c) => {
        if ((c as THREE.Mesh).isMesh && !this.owners.has(c)) {
          this.occluders.push(c);
          this.owners.set(c, { kind: 'occluder' });
        }
      });
    }
    this.targetsDirty = true;
  }

  /** Currently hovered control. */
  get hoveredControl(): CockpitControl | null {
    return this.hovered;
  }

  /** Control with keyboard focus. */
  get focused(): CockpitControl | null {
    return this.focusedCtl;
  }

  /** True while a control or display drag is in progress (camera modules should not act). */
  get busy(): boolean {
    return !!this.active || !!this.activeDisplay;
  }

  /** Raycasts at client coordinates. */
  pick(clientX: number, clientY: number): PickResult {
    const rect = this.dom.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return this.pickNdc(this.ndc);
  }

  /** Raycasts at normalized device coordinates (x, y in -1..1). */
  pickNdc(ndc: THREE.Vector2): PickResult {
    if (this.targetsDirty) this.rebuildTargets();
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.hits;
    hits.length = 0;
    this.raycaster.intersectObjects(this.targets, false, hits);
    if (!hits.length) return null;
    // Among hits within 3 cm of the nearest, prefer higher hitPriority.
    let best: THREE.Intersection | null = null;
    let bestPri = -Infinity;
    let bestOwner: Owner | null = null;
    const d0 = hits[0].distance;
    for (const h of hits) {
      if (h.distance > d0 + 0.03) break;
      const ow = this.owners.get(h.object);
      if (!ow) continue;
      if (ow.kind === 'control' && !this.usable(ow.control)) continue;
      const pri = ow.kind === 'occluder' ? -2 : ((h.object.userData.hitPriority as number | undefined) ?? 0);
      if (pri > bestPri) {
        bestPri = pri;
        best = h;
        bestOwner = ow;
      }
    }
    if (!best || !bestOwner || bestOwner.kind === 'occluder') return null;
    if (bestOwner.kind === 'control') return { kind: 'control', control: bestOwner.control, hit: best };
    const d = bestOwner.display;
    const uv = best.uv;
    const x = uv ? uv.x * d.width : 0;
    const y = uv ? (1 - uv.y) * d.height : 0;
    return { kind: 'display', display: d, mesh: bestOwner.mesh, hit: best, x, y };
  }

  /** Per-frame: refresh tooltip text and re-pick hover when controls moved under a still pointer. */
  update(dt: number): void {
    if (!this.enabled) return;
    this.recheck += dt;
    if (this.hasPointer && !this.active && !this.look && !this.activeDisplay && this.recheck > 0.12) {
      this.recheck = 0;
      this.updateHover(this.lastX, this.lastY, null);
    }
    const c = this.active?.control ?? this.hovered;
    if (this.tooltip) {
      const text = c ? c.tooltip() : '';
      if (text !== this.tooltipText) {
        this.tooltipText = text;
        this.tooltip.textContent = text;
        this.tooltip.style.display = text ? 'block' : 'none';
      }
    }
  }

  dispose(): void {
    this.cancelAll();
    for (const [t, n, f, opt] of this.listeners) t.removeEventListener(n, f, opt);
    this.listeners.length = 0;
    this.highlighter?.dispose();
    this.tooltip?.remove();
    this.controls.clear();
    this.displays.clear();
    this.owners.clear();
    this.targets = [];
  }

  // ---------------------------------------------------------------------------

  private listen(t: EventTarget, name: string, f: EventListener, opt?: AddEventListenerOptions | boolean): void {
    t.addEventListener(name, f, opt);
    this.listeners.push([t, name, f, opt]);
  }

  private usable(c: CockpitControl): boolean {
    if (c.enabled === false) return false;
    let o: THREE.Object3D | null = c.object;
    while (o) {
      if (!o.visible) return false;
      o = o.parent;
    }
    return true;
  }

  private rebuildTargets(): void {
    const t: THREE.Object3D[] = [];
    for (const c of this.controls) for (const h of c.hitTargets) t.push(h);
    for (const m of this.displays.values()) t.push(m);
    for (const o of this.occluders) t.push(o);
    this.targets = t;
    this.targetsDirty = false;
  }

  private fillPointer(e: { button: number; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey?: boolean }, hit: THREE.Intersection | null): ControlPointer {
    const p = this.p;
    p.button = (e.button === 1 ? 1 : e.button === 2 ? 2 : 0) as 0 | 1 | 2;
    p.shift = e.shiftKey;
    p.ctrl = e.ctrlKey || !!e.metaKey;
    p.alt = e.altKey;
    if (hit) {
      p.point.copy(hit.point);
      p.object = hit.object;
    }
    return p;
  }

  private setHover(c: CockpitControl | null): void {
    if (c === this.hovered) return;
    this.hovered?.onHover?.(false);
    this.hovered = c;
    c?.onHover?.(true);
    this.highlighter?.show(c ?? this.focusedCtl);
  }

  private setCursor(cur: string | null): void {
    if (cur) {
      this.dom.style.cursor = cur;
      this.cursorSet = true;
    } else if (this.cursorSet) {
      this.dom.style.cursor = '';
      this.cursorSet = false;
    }
  }

  private moveTooltip(x: number, y: number): void {
    if (this.tooltip) {
      this.tooltip.style.left = `${x}px`;
      this.tooltip.style.top = `${y}px`;
    }
  }

  private updateHover(x: number, y: number, e: PointerEvent | null): void {
    const r = this.pick(x, y);
    if (r?.kind === 'control') {
      this.setHover(r.control);
      this.hoverDisplay = null;
      const p = this.fillPointer(e ?? { button: 0, shiftKey: false, ctrlKey: false, altKey: false }, r.hit);
      this.setCursor(r.control.cursor ? r.control.cursor(p) : 'pointer');
    } else {
      this.setHover(null);
      if (r?.kind === 'display' && r.display.onPointer) {
        this.hoverDisplay = r.display;
        this.setCursor('pointer');
      } else {
        this.hoverDisplay = null;
        this.setCursor(null);
      }
    }
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled) return;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.hasPointer = true;
    if (this.active || this.look || this.activeDisplay) return;
    const r = this.pick(e.clientX, e.clientY);
    const btn = (e.button === 1 ? 1 : e.button === 2 ? 2 : 0) as 0 | 1 | 2;
    if (r?.kind === 'control') {
      e.preventDefault();
      const c = r.control;
      this.focusedCtl = c.onKey ? c : null;
      this.capture(e);
      let locked = false;
      if (c.pointerLock) locked = this.requestLock();
      this.active = { control: c, pointerId: e.pointerId, button: btn, lastX: e.clientX, lastY: e.clientY, locked };
      c.onPointerDown?.(this.fillPointer(e, r.hit));
      return;
    }
    this.focusedCtl = null;
    if (r?.kind === 'display' && r.display.onPointer) {
      e.preventDefault();
      this.capture(e);
      this.activeDisplay = { display: r.display, mesh: r.mesh, pointerId: e.pointerId };
      r.display.onPointer(r.x, r.y, 'down');
      return;
    }
    const lookButtons = this.o.lookButtons ?? [0, 2];
    if (lookButtons.includes(e.button)) {
      this.capture(e);
      const locked = this.o.lookPointerLock ? this.requestLock() : false;
      this.look = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY, locked };
      this.o.onLookStart?.();
    }
    if (e.button === 1) e.preventDefault(); // no autoscroll
  }

  private onMove(e: PointerEvent): void {
    if (!this.enabled) return;
    this.hasPointer = true;
    const a = this.active;
    if (a && e.pointerId === a.pointerId) {
      const { dx, dy } = this.delta(e, a);
      if (dx !== 0 || dy !== 0) a.control.onDrag?.(dx, dy, this.p);
      return;
    }
    const ad = this.activeDisplay;
    if (ad && e.pointerId === ad.pointerId) {
      const r = this.pick(e.clientX, e.clientY);
      if (r?.kind === 'display' && r.display === ad.display) ad.display.onPointer?.(r.x, r.y, 'move');
      return;
    }
    const l = this.look;
    if (l && e.pointerId === l.pointerId) {
      const { dx, dy } = this.delta(e, l);
      if (dx !== 0 || dy !== 0) this.o.onLook?.(dx, dy);
      return;
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moveTooltip(e.clientX, e.clientY);
    this.updateHover(e.clientX, e.clientY, e);
    if (this.hoverDisplay?.onPointer) {
      const r = this.pick(e.clientX, e.clientY);
      if (r?.kind === 'display') r.display.onPointer?.(r.x, r.y, 'move');
    }
  }

  private onUp(e: PointerEvent): void {
    const a = this.active;
    if (a && e.pointerId === a.pointerId) {
      this.fillPointer(e, null);
      this.p.button = a.button;
      a.control.onPointerUp?.(this.p);
      this.release(e, a.locked);
      this.active = null;
      return;
    }
    const ad = this.activeDisplay;
    if (ad && e.pointerId === ad.pointerId) {
      const r = this.pick(e.clientX, e.clientY);
      ad.display.onPointer?.(r?.kind === 'display' && r.display === ad.display ? r.x : -1, r?.kind === 'display' && r.display === ad.display ? r.y : -1, 'up');
      this.release(e, false);
      this.activeDisplay = null;
      return;
    }
    const l = this.look;
    if (l && e.pointerId === l.pointerId) {
      this.release(e, l.locked);
      this.look = null;
      this.o.onLookEnd?.();
    }
  }

  private onCancelEvt(e: PointerEvent): void {
    if (this.active && e.pointerId === this.active.pointerId) {
      this.active.control.onCancel?.();
      this.release(e, this.active.locked);
      this.active = null;
    }
    if (this.activeDisplay && e.pointerId === this.activeDisplay.pointerId) {
      this.activeDisplay.display.onPointer?.(-1, -1, 'up');
      this.activeDisplay = null;
    }
    if (this.look && e.pointerId === this.look.pointerId) {
      this.look = null;
      this.o.onLookEnd?.();
    }
  }

  private onLeave(): void {
    if (this.active || this.look || this.activeDisplay) return;
    this.hasPointer = false;
    this.setHover(null);
    this.setCursor(null);
    if (this.tooltip) this.tooltip.style.display = 'none';
    this.tooltipText = '';
  }

  private onWheelEvt(e: WheelEvent): void {
    if (!this.enabled) return;
    // Shift+wheel is turned into horizontal scrolling by some platforms.
    const raw = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    const unit = e.deltaMode === 1 ? 33.3 : e.deltaMode === 2 ? 800 : 1;
    const px = -raw * unit;
    let notches: number;
    if (Math.abs(px) >= 50) {
      notches = Math.sign(px);
      this.wheelAcc = 0;
    } else {
      this.wheelAcc += px;
      notches = Math.trunc(this.wheelAcc / 100);
      this.wheelAcc -= notches * 100;
    }
    const r = this.pick(e.clientX, e.clientY);
    if (r?.kind === 'control') {
      e.preventDefault();
      if (notches !== 0) r.control.onWheel?.(notches, this.fillPointer({ button: 0, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey }, r.hit));
      return;
    }
    if (r?.kind === 'display' && r.display.onPointer) {
      e.preventDefault();
      if (notches !== 0) r.display.onPointer(r.x, r.y, 'wheel', notches);
      return;
    }
    if (this.o.onEmptyWheel) {
      e.preventDefault();
      if (notches !== 0) this.o.onEmptyWheel(notches);
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const f = this.focusedCtl;
    if (!f || !f.onKey || !this.enabled) return;
    if (f.onKey(e.key, e.code, down, e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
    } else if (down && e.key === 'Escape') {
      this.focusedCtl = null;
      this.highlighter?.show(this.hovered);
    }
  }

  private delta(e: PointerEvent, s: { lastX: number; lastY: number; locked: boolean }): { dx: number; dy: number } {
    let dx: number;
    let dy: number;
    if (s.locked || (typeof document !== 'undefined' && document.pointerLockElement === this.dom)) {
      dx = e.movementX || 0;
      dy = e.movementY || 0;
    } else {
      dx = e.clientX - s.lastX;
      dy = e.clientY - s.lastY;
    }
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    return { dx, dy };
  }

  private capture(e: PointerEvent): void {
    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch {
      /* pointer may already be gone */
    }
  }

  private release(e: PointerEvent, locked: boolean): void {
    try {
      if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (locked && typeof document !== 'undefined' && document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  private requestLock(): boolean {
    const el = this.dom as HTMLElement & { requestPointerLock?: () => Promise<void> | void };
    if (!el.requestPointerLock) return false;
    try {
      const r = el.requestPointerLock();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  private cancelAll(): void {
    if (this.active) {
      this.active.control.onCancel?.();
      if (this.active.locked && typeof document !== 'undefined' && document.pointerLockElement === this.dom) document.exitPointerLock();
      this.active = null;
    }
    if (this.activeDisplay) {
      this.activeDisplay.display.onPointer?.(-1, -1, 'up');
      this.activeDisplay = null;
    }
    if (this.look) {
      this.look = null;
      this.o.onLookEnd?.();
    }
  }
}
