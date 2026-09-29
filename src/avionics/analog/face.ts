/**
 * Dial-face painting for electromechanical instruments. Faces are drawn
 * once into a square canvas and used as the colour AND emissive map of the
 * dial mesh (markings glow under instrument lighting; the black background
 * stays black). Transparent regions (`window()`) become see-through holes
 * (the mesh uses alphaTest) so rotating drums/cards mounted behind the dial
 * show through with real parallax.
 *
 * Coordinates are normalised: the dial radius is 1, origin at the centre,
 * +x right, +y up (12 o'clock). Angles are degrees clockwise from 12
 * o'clock; sizes (font, line width) are fractions of the dial radius.
 */
import * as THREE from 'three';
import { createDisplayCanvas, type DisplayCanvas } from '../common/CanvasDisplay';
import type { Ctx2D } from '../common/draw/context';
import { FONT_STACKS } from '../common/fonts';

export const DIAL_BLACK = '#101011';
export const DIAL_WHITE = '#f2f2ec';
/** Standard instrument range-marking colours (14 CFR 23.1545 / 23.1549 markings). */
export const MARK_GREEN = '#1fb040';
export const MARK_YELLOW = '#f2d000';
export const MARK_RED = '#e2231a';
export const MARK_WHITE = '#f2f2ec';
export const MARK_BLUE = '#2d6fd6';

export class FaceCanvas {
  readonly canvas: DisplayCanvas;
  readonly ctx: Ctx2D;
  readonly size: number;
  /** Radius in pixels of the normalised unit circle. */
  readonly r: number;
  readonly family: string;

  constructor(sizePx = 512, family: string = FONT_STACKS.gauge) {
    this.size = sizePx;
    this.r = sizePx / 2;
    this.family = family;
    this.canvas = createDisplayCanvas(sizePx, sizePx);
    const ctx = this.canvas.getContext('2d') as Ctx2D | null;
    if (!ctx) throw new Error('FaceCanvas: 2D context unavailable');
    this.ctx = ctx;
    ctx.lineCap = 'butt';
  }

  X(x: number): number {
    return this.r + x * this.r;
  }

  Y(y: number): number {
    return this.r - y * this.r;
  }

  /** x of the point at angle `deg` (clockwise from up) and radius f. */
  px(deg: number, f: number): number {
    return this.r + Math.sin((deg * Math.PI) / 180) * f * this.r;
  }

  py(deg: number, f: number): number {
    return this.r - Math.cos((deg * Math.PI) / 180) * f * this.r;
  }

  /** Fills the dial disc (or the whole square with `square`). */
  background(color = DIAL_BLACK, square = false): void {
    const c = this.ctx;
    c.fillStyle = color;
    if (square) c.fillRect(0, 0, this.size, this.size);
    else {
      c.beginPath();
      c.arc(this.r, this.r, this.r, 0, Math.PI * 2);
      c.fill();
    }
  }

  /** Radial tick from radius f0 to f1 at angle deg. */
  tick(deg: number, f0: number, f1: number, width: number, color = DIAL_WHITE): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(this.px(deg, f0), this.py(deg, f0));
    c.lineTo(this.px(deg, f1), this.py(deg, f1));
    c.strokeStyle = color;
    c.lineWidth = width * this.r;
    c.stroke();
  }

  /** Ticks for each value in [from, to] step `step` using `angleOf`. */
  ticks(from: number, to: number, step: number, angleOf: (v: number) => number, f0: number, f1: number, width: number, color = DIAL_WHITE): void {
    for (let v = from; v <= to + step * 1e-6; v += step) this.tick(angleOf(v), f0, f1, width, color);
  }

  /** Annular band between radii f0 < f1 from angle a0 to a1 (deg, clockwise). */
  band(a0: number, a1: number, f0: number, f1: number, color: string): void {
    const c = this.ctx;
    const s0 = ((Math.min(a0, a1) - 90) * Math.PI) / 180;
    const s1 = ((Math.max(a0, a1) - 90) * Math.PI) / 180;
    c.beginPath();
    c.arc(this.r, this.r, f1 * this.r, s0, s1);
    c.arc(this.r, this.r, f0 * this.r, s1, s0, true);
    c.closePath();
    c.fillStyle = color;
    c.fill();
  }

  /** Arc line at radius f from a0 to a1. */
  arc(a0: number, a1: number, f: number, width: number, color = DIAL_WHITE): void {
    const c = this.ctx;
    c.beginPath();
    c.arc(this.r, this.r, f * this.r, ((Math.min(a0, a1) - 90) * Math.PI) / 180, ((Math.max(a0, a1) - 90) * Math.PI) / 180);
    c.strokeStyle = color;
    c.lineWidth = width * this.r;
    c.stroke();
  }

  /** Text centred at normalised (x, y). `size` = cap height-ish font size as a fraction of the radius. */
  text(str: string, x: number, y: number, size: number, color = DIAL_WHITE, align: CanvasTextAlign = 'center', weight: 'normal' | 'bold' = 'bold', family = this.family): void {
    const c = this.ctx;
    c.font = `${weight} ${Math.round(size * this.r)}px ${family}`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(str, this.X(x), this.Y(y));
  }

  /**
   * Text at polar position (deg, f). `radial`: rotated with the dial so its
   * top points outward; `rotOffset` (deg) adds to that rotation (e.g. -90 for
   * drum labels that must read upright when they reach 3 o'clock).
   */
  label(str: string, deg: number, f: number, size: number, color = DIAL_WHITE, radial = false, rotOffset = 0): void {
    const c = this.ctx;
    if (!radial) {
      this.text(str, Math.sin((deg * Math.PI) / 180) * f, Math.cos((deg * Math.PI) / 180) * f, size, color);
      return;
    }
    c.save();
    c.translate(this.px(deg, f), this.py(deg, f));
    c.rotate(((deg + rotOffset) * Math.PI) / 180);
    c.font = `bold ${Math.round(size * this.r)}px ${this.family}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(str, 0, 0);
    c.restore();
  }

  /** Polygon from normalised points [x0, y0, x1, y1, ...]. */
  poly(pts: readonly number[], fill: string, stroke = '', width = 0.01): void {
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      if (i === 0) c.moveTo(this.X(pts[i]), this.Y(pts[i + 1]));
      else c.lineTo(this.X(pts[i]), this.Y(pts[i + 1]));
    }
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = width * this.r;
      c.stroke();
    }
  }

  /** Filled circle at normalised (x, y) radius rf. */
  dot(x: number, y: number, rf: number, fill: string, stroke = '', width = 0.01): void {
    const c = this.ctx;
    c.beginPath();
    c.arc(this.X(x), this.Y(y), rf * this.r, 0, Math.PI * 2);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = width * this.r;
      c.stroke();
    }
  }

  /** Cuts a transparent rectangular window (normalised centre and size). */
  window(x: number, y: number, w: number, h: number): void {
    this.ctx.clearRect(this.X(x - w / 2), this.Y(y + h / 2), w * this.r, h * this.r);
  }

  /** Cuts a transparent annular-sector window (deg range, radii). */
  sectorWindow(a0: number, a1: number, f0: number, f1: number): void {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    this.band(a0, a1, f0, f1, '#000');
    c.restore();
  }

  /** Cuts a transparent circle. */
  circleWindow(x: number, y: number, rf: number): void {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    this.dot(x, y, rf, '#000');
    c.restore();
  }

  /** Creates a texture of the current canvas (sRGB, mipmapped). */
  texture(): THREE.CanvasTexture<DisplayCanvas> {
    const t = new THREE.CanvasTexture<DisplayCanvas>(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }
}
