/**
 * WebGL renderer setup for the simulator (three.js r186).
 *
 * Settings follow docs/modules/world.md s.2 (the world's shaders are GLSL /
 * onBeforeCompile, so WebGLRenderer, not WebGPU):
 *  - logarithmic depth buffer: the cockpit starts 5 cm from the eye and the
 *    terrain reaches the horizon (> 200 km); a 24-bit linear depth buffer
 *    cannot span 0.05 m .. 2,000 km. (r186 also offers `reversedDepthBuffer`,
 *    but it needs EXT_clip_control and the world is calibrated with log depth.)
 *  - ACES filmic tone mapping at exposure 1 (the world applies its own partial
 *    eye adaptation; no auto-exposure here), sRGB output;
 *  - PCF shadow maps (r186 removed PCFSoftShadowMap), used for tight cockpit
 *    shadows (see CockpitShadows) and aircraft shadows on nearby ground.
 */
import * as THREE from 'three';
import type { WorldQuality } from '../world/types';

export interface GraphicsSettings {
  /** World detail preset (terrain LOD, clouds, airports). */
  quality: WorldQuality;
  /** Sun shadows (cockpit and aircraft). */
  shadows: boolean;
  /** Render resolution relative to the window's device pixels (0.5..1.5). */
  resolutionScale: number;
  /** Default vertical field of view in the cockpit (deg). */
  cockpitFovDeg: number;
  /** G-force / buffet head movement in the cockpit view. */
  headMotion: boolean;
  /** Show the frame-rate counter in the corner. */
  showFps: boolean;
}

export const DEFAULT_GRAPHICS: GraphicsSettings = {
  quality: 'high',
  shadows: true,
  resolutionScale: 1,
  // EST: 55 deg vertical is ~88 deg horizontal on 16:9, close to a pilot's comfortable forward field.
  cockpitFovDeg: 55,
  headMotion: true,
  showFps: false,
};

export function sanitizeGraphics(s: Partial<GraphicsSettings> | null | undefined): GraphicsSettings {
  const q = s?.quality;
  return {
    quality: q === 'low' || q === 'medium' || q === 'high' || q === 'ultra' ? q : DEFAULT_GRAPHICS.quality,
    shadows: typeof s?.shadows === 'boolean' ? s.shadows : DEFAULT_GRAPHICS.shadows,
    resolutionScale: Number.isFinite(s?.resolutionScale) ? Math.min(1.5, Math.max(0.5, s!.resolutionScale!)) : 1,
    cockpitFovDeg: Number.isFinite(s?.cockpitFovDeg) ? Math.min(90, Math.max(30, s!.cockpitFovDeg!)) : DEFAULT_GRAPHICS.cockpitFovDeg,
    headMotion: typeof s?.headMotion === 'boolean' ? s.headMotion : true,
    showFps: typeof s?.showFps === 'boolean' ? s.showFps : false,
  };
}

export class RenderSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private settings: GraphicsSettings;
  private readonly ro: ResizeObserver | null;
  private width = 1;
  private height = 1;
  /** Called after every resize with CSS pixel size (cameras update their aspect). */
  onResize: ((w: number, h: number) => void) | null = null;

  constructor(container: HTMLElement, settings: GraphicsSettings) {
    this.container = container;
    this.settings = settings;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'amg-view';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.enabled = settings.shadows;
    r.setClearColor(0x000000, 1);
    this.scene.name = 'scene';
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.ro?.observe(container);
    if (!this.ro) window.addEventListener('resize', this.onWindowResize);
    this.resize();
  }

  private readonly onWindowResize = () => this.resize();

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    this.renderer.setPixelRatio(dpr * this.settings.resolutionScale);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.onResize?.(w, h);
  }

  applySettings(s: GraphicsSettings): void {
    const shadowChange = s.shadows !== this.settings.shadows;
    this.settings = s;
    this.renderer.shadowMap.enabled = s.shadows;
    if (shadowChange) {
      // Materials compiled with/without shadow chunks must recompile.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
      });
    }
    this.resize();
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  /** Renderer statistics of the last frame. */
  stats(): { calls: number; triangles: number; geometries: number; textures: number; programs: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 };
  }

  /** WebGL capability summary for the debug HUD. */
  describe(): string {
    const gl = this.renderer.getContext();
    let rendererName = 'WebGL';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) rendererName = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    } catch {
      // not available
    }
    return `${rendererName} | log depth ${this.renderer.capabilities.logarithmicDepthBuffer ? 'on' : 'off'}`;
  }

  dispose(): void {
    this.ro?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
