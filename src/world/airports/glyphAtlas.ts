/**
 * Runway designator glyph atlas, drawn procedurally on a canvas.
 *
 * Glyph geometry follows AC 150/5340-1M Figure A-6: characters 60 ft tall
 * and 20 ft wide (1: 7 ft, 4: 25 ft, 7: 23 ft), vertical strokes 5 ft,
 * horizontal strokes 10 ft (thicker to compensate for the foreshortened
 * view from the approach), 6 and 9 with a 3 ft tip. Each atlas cell is
 * GLYPH_CELL_W_FT x GLYPH_CELL_H_FT with the glyph origin at
 * (GLYPH_PAD_X_FT, GLYPH_PAD_Y_FT); y is up (toward the far end of the
 * runway), so the pilot on approach reads the characters upright.
 */
import * as THREE from 'three';
import { GLYPH_CELL_H_FT, GLYPH_CELL_W_FT, GLYPH_PAD_X_FT, GLYPH_PAD_Y_FT } from './markings';

type Pt = [number, number];
/** A glyph is a list of polygons in feet (x right, y up, origin bottom-left of the 60 ft box). */
type Glyph = Pt[][];

const V = 5; // vertical stroke (ft)
const H = 10; // horizontal stroke (ft)

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Diagonal stroke of horizontal thickness `w` from (xa, ya) to (xb, yb) (xa/xb = left edges). */
const diag = (xa: number, ya: number, xb: number, yb: number, w: number): Pt[] => [
  [xa, ya],
  [xa + w, ya],
  [xb + w, yb],
  [xb, yb],
];

export const GLYPHS: Record<string, Glyph> = {
  '0': [rect(0, 0, V, 60), rect(20 - V, 0, 20, 60), rect(0, 0, 20, H), rect(0, 60 - H, 20, 60)],
  '1': [rect(2, 0, 7, 60), [[0, 50], [2, 50], [2, 60], [0, 56]]],
  I: [rect(7.5, 0, 12.5, 60), rect(0, 0, 20, H), [[3, 52], [7.5, 50], [7.5, 60], [3, 57]]],
  '2': [rect(0, 60 - H, 20, 60), rect(20 - V, 33, 20, 60), diag(0, H, 20 - V, 36, V), rect(0, 0, 20, H)],
  '3': [rect(0, 60 - H, 20, 60), rect(20 - V, 0, 20, 60), rect(5, 25, 20, 25 + H), rect(0, 0, 20, H)],
  '4': [rect(14, 0, 14 + V, 60), diag(0, 20, 10, 60, V + 1), rect(0, 17, 25, 17 + H)],
  '5': [rect(0, 60 - H, 20, 60), rect(0, 27, V, 60), rect(0, 27, 20, 27 + H), rect(20 - V, 0, 20, 37), rect(0, 0, 20, H)],
  '6': [rect(0, 0, V, 60), rect(0, 60 - H, 20, 60), rect(20 - V, 60, 20, 63), rect(0, 26, 20, 26 + H), rect(20 - V, 0, 20, 36), rect(0, 0, 20, H)],
  '7': [rect(0, 60 - H, 23, 60), diag(5, 0, 18, 60 - H, V + 1)],
  '8': [rect(0, 0, V, 60), rect(20 - V, 0, 20, 60), rect(0, 0, 20, H), rect(0, 60 - H, 20, 60), rect(0, 26, 20, 26 + H)],
  '9': [rect(0, 60 - H, 20, 60), rect(0, 24, V, 60), rect(0, 24, 20, 24 + H), rect(20 - V, 0, 20, 60), rect(0, 0, 20, H), rect(0, -3, V, 0)],
  L: [rect(0, 0, V, 60), rect(0, 0, 20, H)],
  C: [rect(0, 0, V, 60), rect(0, 60 - H, 20, 60), rect(0, 0, 20, H)],
  R: [rect(0, 0, V, 60), rect(0, 60 - H, 20, 60), rect(20 - V, 30, 20, 60), rect(0, 28, 20, 28 + H), diag(9, 28, 15, 0, V + 1)],
};

export const ATLAS_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'I', 'L', 'C', 'R'];

/** Pixels per foot in the atlas. 4 px/ft gives 20 px per 5 ft stroke. */
const PX_PER_FT = 4;
const COLS = 7;

export interface GlyphAtlas {
  texture: THREE.Texture;
  /** Texture-space rect per character: [u0, v0, du, dv] (v up, flipY applied). */
  rects: Record<string, [number, number, number, number]>;
}

let cached: GlyphAtlas | null = null;

/** Builds (once) the designator atlas. Requires a DOM or OffscreenCanvas. */
export function getGlyphAtlas(anisotropy = 8): GlyphAtlas {
  if (cached) return cached;
  const cellW = GLYPH_CELL_W_FT * PX_PER_FT;
  const cellH = GLYPH_CELL_H_FT * PX_PER_FT;
  const rows = Math.ceil(ATLAS_CHARS.length / COLS);
  const W = THREE.MathUtils.ceilPowerOfTwo(cellW * COLS);
  const Hh = THREE.MathUtils.ceilPowerOfTwo(cellH * rows);
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = Hh;
    canvas = c;
  } else canvas = new OffscreenCanvas(W, Hh);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, Hh);
  ctx.fillStyle = '#fff';
  const rects: GlyphAtlas['rects'] = {};
  ATLAS_CHARS.forEach((ch, i) => {
    const cx = (i % COLS) * cellW;
    const cy = Math.floor(i / COLS) * cellH;
    const g = GLYPHS[ch];
    ctx.beginPath();
    for (const poly of g) {
      poly.forEach(([x, y], k) => {
        // Canvas y down: cell top is y_ft = CELL_H - PAD_Y above the glyph origin.
        const px = cx + (x + GLYPH_PAD_X_FT) * PX_PER_FT;
        const py = cy + (GLYPH_CELL_H_FT - (y + GLYPH_PAD_Y_FT)) * PX_PER_FT;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
    ctx.fill('nonzero');
    // With flipY the canvas top row maps to v = 1.
    rects[ch] = [cx / W, 1 - (cy + cellH) / Hh, cellW / W, cellH / Hh];
  });
  const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = anisotropy;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  cached = { texture, rects };
  return cached;
}

export function disposeGlyphAtlas(): void {
  if (!cached) return;
  cached.texture.dispose();
  cached = null;
}
