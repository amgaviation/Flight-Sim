/**
 * Engraved / printed panel text and annunciator legends.
 *
 * All text is rasterized once into shared canvas atlas pages (shelf packed,
 * padded against mip bleeding) and drawn as small quads whose UVs address the
 * glyph cell. Materials are shared per (atlas page, lighting zone, fill
 * colour); their emissive intensity follows the zone's dimmer var through
 * `CockpitLighting`, which is how engraved backlit legends light up at night.
 *
 * Text cells are coverage masks (white glyphs on an opaque black cell, stored
 * without sRGB encoding) read as the label material's `alphaMap`: the fill
 * colour and backlight come from the material, and minified (mipmapped) text
 * keeps its full brightness. With glyphs on a transparent background the
 * mip chain averaged the transparent texels' black RGB into the glyphs, so a
 * legend a few pixels tall was drawn at coverage squared - two to three times
 * too dark on a daylight panel.
 *
 * Label quads are flagged `userData.cockpitStatic = true` so `CockpitBuilder`
 * can merge all static labels of a panel into one draw call.
 *
 * Without a canvas (node), text is measured approximately and quads are
 * created untextured, so geometry/layout code can still be unit tested.
 */
import * as THREE from 'three';
import { createCanvas, context2d, type AnyCanvas, type AnyContext2D } from './env';
import { LAMP_COLORS, type CockpitMaterials, type LampColor } from './materials';
import type { CockpitLighting } from './Lighting';

/** Default engraving font: condensed grotesque as used on most avionics/panel overlays. */
export const PANEL_FONT = '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, Helvetica, sans-serif';
/** Wider font for keycaps and large placards. */
export const KEY_FONT = '"Helvetica Neue", Arial, Helvetica, sans-serif';

/** Pixel height of a capital letter in the atlas (resolution of all text). */
const CAP_PX = 34;
/** Ratio of cap height to CSS font size for typical sans fonts. */
const CAP_RATIO = 0.72;
const PAD = 6;

export interface TextStyle {
  /** Capital-letter height in metres (typical engraved panel text 2.5-3.5 mm). */
  height: number;
  font?: string;
  weight?: number | 'normal' | 'bold';
  /** Daylight colour of the text (default palette.labelFill). */
  color?: THREE.ColorRepresentation;
  /**
   * Lighting zone id whose dimmer backlights this text (default 'panel').
   * null = printed (not lit), e.g. placards and decals.
   */
  zone?: string | null;
  align?: 'center' | 'left' | 'right';
  /** Vertical anchor of the quad origin. */
  anchor?: 'middle' | 'top' | 'bottom';
  /** Extra letter spacing in em (engraving is often slightly spaced). */
  spacing?: number;
  /** Line spacing multiple for multi-line text (default 1.35). */
  lineHeight?: number;
  /** Draws a rectangle outline around the text (engraved box). Line width in em. */
  box?: number;
}

export interface AtlasRect {
  page: number;
  /** UV rect with flipY applied (v1 = top). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Cell size in pixels (including padding). */
  w: number;
  h: number;
}

interface AtlasPage {
  canvas: AnyCanvas | null;
  ctx: AnyContext2D | null;
  texture: THREE.Texture | null;
  shelves: { y: number; h: number; x: number }[];
  nextY: number;
  dirty: boolean;
}

/** Shelf-packed canvas atlas shared by all labels and legends of a cockpit. */
export class LabelAtlas {
  readonly size: number;
  private readonly pages: AtlasPage[] = [];
  private readonly cells = new Map<string, AtlasRect>();

  constructor(size = 2048) {
    this.size = size;
  }

  /** True when text can actually be rasterized (browser / worker). */
  get canDraw(): boolean {
    return this.page(0).ctx !== null;
  }

  /** Texture of a page (null without canvas support). */
  texture(page: number): THREE.Texture | null {
    return this.page(page).texture;
  }

  /**
   * Returns the cell for `key`, drawing it with `draw(ctx, x, y, w, h)` the
   * first time. `w`/`h` exclude padding; the callback draws inside that box.
   */
  cell(key: string, w: number, h: number, draw: (ctx: AnyContext2D, x: number, y: number, w: number, h: number) => void): AtlasRect {
    const hit = this.cells.get(key);
    if (hit) return hit;
    const cw = Math.min(this.size, Math.ceil(w) + PAD * 2);
    const ch = Math.min(this.size, Math.ceil(h) + PAD * 2);
    const { page, x, y } = this.alloc(cw, ch);
    const pg = this.pages[page];
    if (pg.ctx) {
      pg.ctx.save();
      pg.ctx.beginPath();
      pg.ctx.rect(x, y, cw, ch);
      pg.ctx.clip();
      draw(pg.ctx, x + PAD, y + PAD, cw - PAD * 2, ch - PAD * 2);
      pg.ctx.restore();
      pg.dirty = true;
    }
    const S = this.size;
    const rect: AtlasRect = { page, u0: (x + PAD * 0.5) / S, u1: (x + cw - PAD * 0.5) / S, v1: 1 - (y + PAD * 0.5) / S, v0: 1 - (y + ch - PAD * 0.5) / S, w: cw - PAD, h: ch - PAD };
    this.cells.set(key, rect);
    return rect;
  }

  /** Uploads pages changed since the last flush. Cheap when nothing changed. */
  flush(): void {
    for (const p of this.pages) {
      if (p.dirty && p.texture) {
        p.texture.needsUpdate = true;
        p.dirty = false;
      }
    }
  }

  get pageCount(): number {
    return this.pages.length;
  }

  dispose(): void {
    for (const p of this.pages) p.texture?.dispose();
    this.pages.length = 0;
    this.cells.clear();
  }

  private page(i: number): AtlasPage {
    while (this.pages.length <= i) {
      const canvas = createCanvas(this.size, this.size);
      const ctx = context2d(canvas);
      let texture: THREE.Texture | null = null;
      if (canvas && ctx) {
        ctx.clearRect(0, 0, this.size, this.size);
        texture = new THREE.CanvasTexture(canvas);
        // Coverage masks and black/white legend cells: no sRGB decode (alphaMap reads .g linearly).
        texture.colorSpace = THREE.NoColorSpace;
        texture.anisotropy = 8;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.name = `cockpit.labelAtlas${this.pages.length}`;
      }
      this.pages.push({ canvas, ctx, texture, shelves: [], nextY: 0, dirty: false });
    }
    return this.pages[i];
  }

  private alloc(w: number, h: number): { page: number; x: number; y: number } {
    for (let pi = 0; ; pi++) {
      const pg = this.page(pi);
      // Best-fitting existing shelf.
      let best: { y: number; h: number; x: number } | null = null;
      for (const s of pg.shelves) {
        if (s.h >= h && s.h <= h * 1.4 + 4 && s.x + w <= this.size && (!best || s.h < best.h)) best = s;
      }
      if (best) {
        const x = best.x;
        best.x += w;
        return { page: pi, x, y: best.y };
      }
      if (pg.nextY + h <= this.size) {
        const shelf = { y: pg.nextY, h, x: w };
        pg.shelves.push(shelf);
        pg.nextY += h;
        return { page: pi, x: 0, y: shelf.y };
      }
    }
  }
}

/** A text / legend quad and its physical size. */
export interface LabelMesh extends THREE.Mesh {
  userData: { cockpitStatic: boolean; width_m: number; height_m: number; text: string };
}

/**
 * Creates engraved text, placards, engraved lines and annunciator legend
 * textures. One per cockpit (see `CockpitEnv.labels`).
 */
export class LabelFactory {
  readonly atlas: LabelAtlas;
  private readonly materials: CockpitMaterials;
  private readonly lighting: CockpitLighting;
  private readonly matCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();
  private readonly measureCtx: AnyContext2D | null;
  /**
   * Night-glow alpha boost of backlit labels (shared shader uniform; additive
   * opt-in, default 0 = exactly the previous look). Backlit legends are
   * alpha-masked quads, so a minified glyph's peak brightness is capped by its
   * mip-filtered pixel coverage: at night a 3 mm legend a metre away renders
   * a few dim pixels however high the zone's emissive gain is driven, while a
   * real edge-lit panel legend blooms into a legible warm glow (light spreads
   * in the acrylic and in the eye). With `nightGlow` > 0 the label shader
   * raises the alpha of partially covered pixels while (and only while) the
   * material's backlight emissive is driving them - the mip ring around each
   * glyph becomes a soft halo, night legends read at their emissive colour,
   * and daylight (emissive washed out to 0) is untouched. Set it once before
   * building panels (aircraft cockpit index).
   */
  readonly nightGlow = { value: 0 };

  constructor(materials: CockpitMaterials, lighting: CockpitLighting, opts: { atlasSize?: number } = {}) {
    this.materials = materials;
    this.lighting = lighting;
    this.atlas = new LabelAtlas(opts.atlasSize ?? 2048);
    this.measureCtx = context2d(createCanvas(8, 8));
  }

  /**
   * Engraved or printed text quad in the XY plane facing +Z, 0.15 mm above
   * z = 0 (so it sits on the surface it is added to). Supports '\n'.
   */
  text(text: string, style: TextStyle): LabelMesh {
    const font = style.font ?? PANEL_FONT;
    const weight = style.weight ?? 600;
    const lines = text.split('\n');
    const fontPx = CAP_PX / CAP_RATIO;
    const lineH = fontPx * (style.lineHeight ?? 1.35);
    const spacingPx = (style.spacing ?? 0.04) * fontPx;
    const cssFont = `${weight} ${fontPx.toFixed(1)}px ${font}`;
    let maxW = 0;
    const widths: number[] = [];
    for (const l of lines) {
      const w = this.measure(l, cssFont, fontPx) + spacingPx * Math.max(0, l.length - 1);
      widths.push(w);
      maxW = Math.max(maxW, w);
    }
    const boxPx = style.box ? Math.max(2, style.box * fontPx) : 0;
    const boxPad = style.box ? fontPx * 0.35 + boxPx : 0;
    const cellW = maxW + boxPad * 2;
    const cellH = lineH * (lines.length - 1) + fontPx * 1.1 + boxPad * 2;
    const align = style.align ?? 'center';
    const key = `t|${text}|${cssFont}|${style.spacing ?? 0.04}|${style.lineHeight ?? 1.35}|${align}|${style.box ?? 0}`;
    const rect = this.atlas.cell(key, cellW, cellH, (ctx, x, y, w) => {
      // Opaque black cell (padding included): the glyph coverage is the green channel (alphaMap).
      ctx.fillStyle = '#000000';
      ctx.fillRect(x - PAD, y - PAD, w + PAD * 2, cellH + PAD * 2);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      ctx.font = cssFont;
      ctx.textBaseline = 'alphabetic';
      for (let i = 0; i < lines.length; i++) {
        const lw = widths[i];
        let tx = x + boxPad;
        if (align === 'center') tx = x + (w - lw) / 2;
        else if (align === 'right') tx = x + w - boxPad - lw;
        const baseline = y + boxPad + fontPx * 0.93 + i * lineH;
        drawSpaced(ctx, lines[i], tx, baseline, spacingPx);
      }
      if (boxPx > 0) {
        ctx.lineWidth = boxPx;
        ctx.strokeRect(x + boxPx / 2, y + boxPx / 2, w - boxPx, cellH - boxPx);
      }
    });
    const mPerPx = style.height / CAP_PX;
    const wM = rect.w * mPerPx;
    const hM = rect.h * mPerPx;
    let oy = 0;
    const anchor = style.anchor ?? 'middle';
    if (anchor === 'top') oy = -hM / 2;
    else if (anchor === 'bottom') oy = hM / 2;
    let ox = 0;
    if (align === 'left') ox = wM / 2;
    else if (align === 'right') ox = -wM / 2;
    const geo = this.quad(rect, wM, hM, ox, oy);
    const mat = this.labelMaterial(rect.page, style.zone === undefined ? 'panel' : style.zone, style.color);
    const mesh = new THREE.Mesh(geo, mat) as unknown as LabelMesh;
    mesh.position.z = 0.00015;
    mesh.renderOrder = 2;
    mesh.userData = { cockpitStatic: true, width_m: wM, height_m: hM, text };
    mesh.name = `label:${text}`;
    return mesh;
  }

  /**
   * A solid engraved rectangle (lines, tick marks, group brackets), centred at
   * the origin, in the XY plane.
   */
  rect(w: number, h: number, zone: string | null = 'panel', color?: THREE.ColorRepresentation): LabelMesh {
    const r = this.atlas.cell('solid', 8, 8, (ctx, x, y, cw, ch) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 5, y - 5, cw + 10, ch + 10);
    });
    // Sample only the cell centre so mips never reach transparent padding.
    const cu = (r.u0 + r.u1) / 2;
    const cv = (r.v0 + r.v1) / 2;
    const inner: AtlasRect = { ...r, u0: cu - 1e-4, u1: cu + 1e-4, v0: cv - 1e-4, v1: cv + 1e-4 };
    const geo = this.quad(inner, w, h, 0, 0);
    const mesh = new THREE.Mesh(geo, this.labelMaterial(r.page, zone, color)) as unknown as LabelMesh;
    mesh.position.z = 0.00015;
    mesh.renderOrder = 2;
    mesh.userData = { cockpitStatic: true, width_m: w, height_m: h, text: '' };
    return mesh;
  }

  /** Engraved line segment from (x0, y0) to (x1, y1) (metres, XY plane). */
  line(x0: number, y0: number, x1: number, y1: number, width: number, zone: string | null = 'panel', color?: THREE.ColorRepresentation): LabelMesh {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const m = this.rect(len, width, zone, color);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.00015);
    m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    return m;
  }

  /**
   * Group bracket as on Boeing/bizjet overhead panels: a horizontal line with
   * short down-ticks at both ends and the title centred in a gap.
   */
  bracket(title: string, width: number, style: TextStyle, tick = style.height * 1.2): THREE.Group {
    const g = new THREE.Group();
    const t = this.text(title, { ...style, anchor: 'middle' });
    g.add(t);
    const lw = style.height * 0.14;
    const gap = t.userData.width_m / 2 + style.height * 0.4;
    const half = width / 2;
    if (half > gap) {
      g.add(this.line(-half, 0, -gap, 0, lw, style.zone, style.color));
      g.add(this.line(gap, 0, half, 0, lw, style.zone, style.color));
    }
    g.add(this.line(-half, lw / 2, -half, -tick, lw, style.zone, style.color));
    g.add(this.line(half, lw / 2, half, -tick, lw, style.zone, style.color));
    return g;
  }

  /**
   * Labels arranged on a circle (rotary selector positions). Angles in degrees
   * clockwise from 12 o'clock. Text stays upright. Optional tick marks
   * between knob skirt and text.
   */
  arc(
    items: { text: string; angleDeg: number }[],
    radius: number,
    style: TextStyle,
    ticks?: { inner: number; outer: number; width: number },
  ): THREE.Group {
    const g = new THREE.Group();
    for (const it of items) {
      const a = THREE.MathUtils.degToRad(it.angleDeg);
      const sx = Math.sin(a);
      const cy = Math.cos(a);
      if (it.text) {
        const t = this.text(it.text, { ...style, anchor: 'middle', align: 'center' });
        // Push the label out so its nearest edge (not its centre) sits on the radius.
        const halfW = t.userData.width_m / 2;
        const halfH = t.userData.height_m / 2 - style.height * 0.35;
        const extra = Math.abs(sx) * halfW + Math.abs(cy) * halfH;
        t.position.set(sx * (radius + extra), cy * (radius + extra), 0.00015);
        g.add(t);
      }
      if (ticks) g.add(this.line(sx * ticks.inner, cy * ticks.inner, sx * ticks.outer, cy * ticks.outer, ticks.width, style.zone, style.color));
    }
    return g;
  }

  /**
   * Annunciator legend cell (opaque): white legend on black ('legend' style,
   * text glows) or black legend on white ('field' style, whole lens glows).
   * Returns the atlas rect and page texture, for use as map + emissiveMap of a
   * `materials.lens()` material.
   */
  legend(
    lines: string[],
    pxW: number,
    pxH: number,
    style: 'legend' | 'field' = 'legend',
    font = PANEL_FONT,
    weight: number | 'bold' = 700,
  ): { rect: AtlasRect; texture: THREE.Texture | null } {
    const key = `lg|${lines.join('\\n')}|${pxW}x${pxH}|${style}|${font}|${weight}`;
    const rect = this.atlas.cell(key, pxW, pxH, (ctx, x, y, w, h) => {
      const bg = style === 'field' ? '#ffffff' : '#000000';
      const fg = style === 'field' ? '#000000' : '#ffffff';
      ctx.fillStyle = bg;
      ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
      const n = Math.max(1, lines.length);
      let fontPx = Math.min((h / n) * 0.78, 64);
      ctx.font = `${weight} ${fontPx}px ${font}`;
      for (const l of lines) {
        const mw = ctx.measureText(l).width;
        if (mw > w * 0.92) fontPx = Math.min(fontPx, (fontPx * w * 0.92) / mw);
      }
      ctx.font = `${weight} ${fontPx.toFixed(1)}px ${font}`;
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        const cy = y + (h * (i + 0.5)) / n;
        ctx.fillText(lines[i] ?? '', x + w / 2, cy);
      }
    });
    return { rect, texture: this.atlas.texture(rect.page) };
  }

  /** A quad (XY plane, facing +Z) whose UVs address `rect`. Shared per rect/size. */
  quad(rect: AtlasRect, w: number, h: number, ox = 0, oy = 0): THREE.BufferGeometry {
    const key = `${rect.page}:${rect.u0.toFixed(5)}:${rect.v0.toFixed(5)}:${rect.u1.toFixed(5)}:${rect.v1.toFixed(5)}:${w.toFixed(6)}:${h.toFixed(6)}:${ox.toFixed(6)}:${oy.toFixed(6)}`;
    let g = this.geoCache.get(key);
    if (!g) {
      g = new THREE.PlaneGeometry(w, h);
      g.translate(ox, oy, 0);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      // PlaneGeometry vertex order: top-left, top-right, bottom-left, bottom-right.
      uv.setXY(0, rect.u0, rect.v1);
      uv.setXY(1, rect.u1, rect.v1);
      uv.setXY(2, rect.u0, rect.v0);
      uv.setXY(3, rect.u1, rect.v0);
      uv.needsUpdate = true;
      g.userData.cached = true;
      this.geoCache.set(key, g);
    }
    return g;
  }

  /** Lamp colour lookup helper. */
  lampColor(c: LampColor | THREE.ColorRepresentation): THREE.Color {
    return new THREE.Color(typeof c === 'string' && c in LAMP_COLORS ? LAMP_COLORS[c as LampColor] : c);
  }

  /** Uploads atlas pages changed since the last call. */
  flush(): void {
    this.atlas.flush();
  }

  dispose(): void {
    for (const g of this.geoCache.values()) g.dispose();
    this.geoCache.clear();
    for (const m of this.matCache.values()) {
      this.lighting.unregister(m);
      m.dispose();
    }
    this.matCache.clear();
    this.atlas.dispose();
  }

  private labelMaterial(page: number, zone: string | null, color?: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
    const fill = new THREE.Color(color ?? this.materials.palette.labelFill);
    const key = `${page}|${zone ?? '-'}|${fill.getHexString()}`;
    let m = this.matCache.get(key);
    if (!m) {
      const tex = this.atlas.texture(page);
      m = new THREE.MeshStandardMaterial({
        color: fill,
        // Coverage mask (see header): alpha = glyph coverage, colour and backlight from the material.
        alphaMap: tex,
        transparent: true,
        depthWrite: false,
        roughness: 0.55,
        metalness: 0,
        emissive: new THREE.Color(this.materials.palette.backlight),
        emissiveIntensity: 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      });
      m.name = `cockpit.label.${key}`;
      if (zone) {
        // Night-glow alpha boost (see `nightGlow`): lift partial-coverage (mip ring)
        // pixels toward opaque in proportion to the backlight drive. `emissive` is
        // three's material uniform emissive x emissiveIntensity, so the boost follows
        // the zone dimmer and the daylight wash-out with no extra per-frame work.
        const glow = this.nightGlow;
        m.onBeforeCompile = (shader) => {
          shader.uniforms.labelNightGlow = glow;
          shader.fragmentShader =
            'uniform float labelNightGlow;\n' +
            shader.fragmentShader.replace(
              '#include <alphamap_fragment>',
              '#include <alphamap_fragment>\n\tdiffuseColor.a = mix( diffuseColor.a, 1.0 - pow( 1.0 - diffuseColor.a, 2.5 ), clamp( labelNightGlow * dot( emissive, vec3( 0.45 ) ), 0.0, 1.0 ) );',
            );
        };
        m.customProgramCacheKey = () => 'cockpitLabelGlow';
      }
      this.materials.patchInterior(m);
      this.matCache.set(key, m);
      if (zone) this.lighting.registerBacklight(m, zone);
    }
    return m;
  }

  private measure(text: string, cssFont: string, fontPx: number): number {
    const ctx = this.measureCtx;
    if (ctx) {
      ctx.font = cssFont;
      return ctx.measureText(text).width;
    }
    // Node fallback: average condensed-sans advance ~0.55 em.
    return text.length * fontPx * 0.55;
  }
}

function drawSpaced(ctx: AnyContext2D, text: string, x: number, y: number, spacing: number): void {
  if (spacing === 0) {
    ctx.fillText(text, x, y);
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}
