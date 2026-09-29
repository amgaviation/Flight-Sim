/**
 * Declarative synoptic pages (MFD "Systems" panes: electrical, fuel, ECS /
 * pressurization, anti-ice, flight controls / trim, doors, hydraulics ...).
 *
 * The aircraft module describes each page as a list of elements in a design
 * coordinate space (default 500 x 700, the half-pane size) whose state comes
 * from `Binding`s (var names or expressions, compiled once). The renderer
 * follows the Garmin synoptic conventions described in the Longitude
 * Operators Guide (flow lines green when powered/flowing, white when not;
 * out-of-range digits in amber reverse video; open doors red; PG
 * 190-02046-01 §3.2 "Synoptics": doors red, fuel quantity graphic, buses).
 *
 *   const ELEC: SynopticPageDef = {
 *     id: 'elec', title: 'Electrical',
 *     elements: [
 *       { type: 'source', x: 60, y: 80, label: 'GEN 1', kind: 'gen', online: 'elec.gen1_online' },
 *       { type: 'line', points: [60, 110, 60, 200], active: 'elec.gen1_online' },
 *       { type: 'bus', x: 20, y: 200, w: 180, label: 'L MAIN BUS', powered: 'elec.lmain_powered' },
 *       { type: 'readout', x: 60, y: 140, label: 'V', value: 'elec.gen1_v', decimals: 1, limits: { cautionLow: 26 } },
 *     ],
 *     controls: [{ label: 'Cabin Temp', kind: 'number', var: 'ac.ecs.cabin_temp_c', min: 16, max: 30, step: 1, unit: '°C' }],
 *   };
 */
import type { SimVars } from '../../../core/SimVars';
import { compileBinding, type Binding, type Evaluator } from '../../../systems/util/binding';
import { fmtFixed, fmtInt } from '../../common/format';
import type { Typeface } from '../../common/fonts';
import type { AvionicsPalette } from '../../common/palette';
import { box, circle, line, type Ctx2D } from '../../common/draw/context';

export type SynLimits = { cautionLow?: number; cautionHigh?: number; warnLow?: number; warnHigh?: number };

export type SynElement =
  | { type: 'line'; points: number[]; active?: Binding; width?: number; activeColor?: string; inactiveColor?: string; arrow?: boolean }
  | { type: 'text'; x: number; y: number; text: string; size?: number; color?: string; align?: 'left' | 'center' | 'right' }
  | { type: 'box'; x: number; y: number; w: number; h: number; label?: string; active?: Binding; fault?: Binding; radius?: number }
  | { type: 'bus'; x: number; y: number; w: number; h?: number; label: string; powered: Binding }
  | { type: 'source'; x: number; y: number; label: string; kind: 'gen' | 'batt' | 'ext' | 'apu' | 'ptcu'; online: Binding; fault?: Binding }
  | { type: 'valve'; x: number; y: number; open: Binding; orientation?: 'h' | 'v'; fault?: Binding; label?: string }
  | { type: 'pump'; x: number; y: number; on: Binding; fault?: Binding; label?: string }
  | { type: 'tank'; x: number; y: number; w: number; h: number; qty: Binding; capacity: number; label?: string; decimals?: 0 | 1; unit?: string; low?: number }
  | { type: 'readout'; x: number; y: number; label?: string; value: Binding; decimals?: 0 | 1 | 2; unit?: string; limits?: SynLimits; align?: 'left' | 'center' | 'right'; size?: number; valid?: Binding }
  | { type: 'bar'; x: number; y: number; w: number; h: number; value: Binding; min: number; max: number; label?: string; limits?: SynLimits; orientation?: 'h' | 'v'; zero?: number }
  | { type: 'indicator'; x: number; y: number; label: string; on: Binding; color?: 'green' | 'amber' | 'red' | 'white' | 'cyan'; offLabel?: string }
  | { type: 'door'; x: number; y: number; w: number; h: number; label: string; open: Binding }
  | { type: 'engine'; x: number; y: number; label: string; running: Binding; w?: number; h?: number }
  | { type: 'aircraft'; x: number; y: number; scale?: number }
  | { type: 'surface'; x: number; y: number; w: number; h: number; value: Binding; min: number; max: number; label?: string; orientation?: 'h' | 'v' };

/** Controls shown on the GTC while this synoptic page is selected (aircraft system controls). */
export interface SynopticControl {
  label: string;
  kind: 'toggle' | 'cycle' | 'button' | 'number';
  /** Var written (toggle 0/1, cycle through `values`, number within min..max). */
  var?: string;
  /** Event emitted (button) with `payload`. */
  event?: string;
  payload?: unknown;
  values?: number[];
  valueLabels?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  decimals?: 0 | 1 | 2;
}

export interface SynopticPageDef {
  id: string;
  title: string;
  /** Button label on the GTC Aircraft Systems screen (default title). */
  label?: string;
  width?: number;
  height?: number;
  elements?: SynElement[];
  /** Custom drawing after the elements (design coordinates). */
  draw?: (ctx: Ctx2D, vars: SimVars, palette: AvionicsPalette, typeface: Typeface) => void;
  controls?: SynopticControl[];
}

type Compiled = { el: SynElement; a: Evaluator; b: Evaluator; c: Evaluator };

/** Pre-compiled page (bindings compiled once per page). */
export class SynopticPage {
  readonly def: SynopticPageDef;
  readonly w: number;
  readonly h: number;
  private readonly items: Compiled[];
  constructor(vars: SimVars, def: SynopticPageDef) {
    this.def = def;
    this.w = def.width ?? 500;
    this.h = def.height ?? 700;
    const none = (): number => 0;
    this.items = (def.elements ?? []).map((el) => {
      let a: Evaluator = none;
      let b: Evaluator = none;
      let c: Evaluator = none;
      switch (el.type) {
        case 'line':
          a = compileBinding(vars, el.active, 1);
          break;
        case 'box':
          a = compileBinding(vars, el.active, 0);
          b = compileBinding(vars, el.fault, 0);
          break;
        case 'bus':
          a = compileBinding(vars, el.powered, 0);
          break;
        case 'source':
          a = compileBinding(vars, el.online, 0);
          b = compileBinding(vars, el.fault, 0);
          break;
        case 'valve':
          a = compileBinding(vars, el.open, 0);
          b = compileBinding(vars, el.fault, 0);
          break;
        case 'pump':
          a = compileBinding(vars, el.on, 0);
          b = compileBinding(vars, el.fault, 0);
          break;
        case 'tank':
          a = compileBinding(vars, el.qty, 0);
          break;
        case 'readout':
          a = compileBinding(vars, el.value, NaN);
          c = compileBinding(vars, el.valid, 1);
          break;
        case 'bar':
        case 'surface':
          a = compileBinding(vars, el.value, 0);
          break;
        case 'indicator':
          a = compileBinding(vars, el.on, 0);
          break;
        case 'door':
          a = compileBinding(vars, el.open, 0);
          break;
        case 'engine':
          a = compileBinding(vars, el.running, 0);
          break;
        default:
          break;
      }
      return { el, a, b, c };
    });
  }

  /** Draws the page scaled into the rectangle (keeps aspect ratio, top-centred). */
  draw(ctx: Ctx2D, x: number, y: number, w: number, h: number, vars: SimVars, p: AvionicsPalette, tf: Typeface): void {
    const s = Math.min(w / this.w, h / this.h);
    const ox = x + (w - this.w * s) / 2;
    ctx.save();
    ctx.translate(ox, y);
    ctx.scale(s, s);
    for (const it of this.items) drawElement(ctx, it, p, tf);
    this.def.draw?.(ctx, vars, p, tf);
    ctx.restore();
  }
}

const LC = { fg: '', bg: '' };
/** Exceedance colours (reused object: no allocation per draw). */
function levelColor(v: number, l: SynLimits | undefined, p: AvionicsPalette): { fg: string; bg: string } {
  LC.fg = p.green;
  LC.bg = '';
  if (!l || !Number.isFinite(v)) return LC;
  if ((l.warnLow !== undefined && v <= l.warnLow) || (l.warnHigh !== undefined && v >= l.warnHigh)) {
    LC.fg = p.white;
    LC.bg = p.red;
  } else if ((l.cautionLow !== undefined && v <= l.cautionLow) || (l.cautionHigh !== undefined && v >= l.cautionHigh)) {
    LC.fg = '#000000';
    LC.bg = p.amber;
  }
  return LC;
}

function namedColor(c: 'green' | 'amber' | 'red' | 'white' | 'cyan' | undefined, p: AvionicsPalette): string {
  switch (c) {
    case 'amber':
      return p.amber;
    case 'red':
      return p.red;
    case 'white':
      return p.white;
    case 'cyan':
      return p.cyan;
    default:
      return p.green;
  }
}

function fmtVal(v: number, d: 0 | 1 | 2 | undefined): string {
  if (!Number.isFinite(v)) return '---';
  return d === 1 || d === 2 ? fmtFixed(v, d) : fmtInt(v);
}

function drawElement(ctx: Ctx2D, it: Compiled, p: AvionicsPalette, tf: Typeface): void {
  const el = it.el;
  switch (el.type) {
    case 'line': {
      const on = it.a() >= 0.5;
      ctx.beginPath();
      for (let i = 0; i < el.points.length; i += 2) {
        if (i === 0) ctx.moveTo(el.points[0], el.points[1]);
        else ctx.lineTo(el.points[i], el.points[i + 1]);
      }
      ctx.strokeStyle = on ? el.activeColor ?? p.green : el.inactiveColor ?? p.white;
      ctx.lineWidth = el.width ?? 3;
      ctx.stroke();
      if (el.arrow && el.points.length >= 4) {
        const n = el.points.length;
        const x1 = el.points[n - 2];
        const y1 = el.points[n - 1];
        const a = Math.atan2(y1 - el.points[n - 3], x1 - el.points[n - 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - 10 * Math.cos(a - 0.45), y1 - 10 * Math.sin(a - 0.45));
        ctx.lineTo(x1 - 10 * Math.cos(a + 0.45), y1 - 10 * Math.sin(a + 0.45));
        ctx.closePath();
        ctx.fillStyle = on ? el.activeColor ?? p.green : el.inactiveColor ?? p.white;
        ctx.fill();
      }
      break;
    }
    case 'text':
      tf.draw(ctx, el.text, el.x, el.y, el.size ?? 16, el.color ?? p.white, el.align ?? 'center', 'middle');
      break;
    case 'box': {
      const fault = it.b() >= 0.5;
      const on = it.a() >= 0.5;
      box(ctx, el.x, el.y, el.w, el.h, fault ? p.amber : '#1a1c1e', fault ? p.amber : on ? p.green : p.white, 2, el.radius ?? 4);
      if (el.label) tf.draw(ctx, el.label, el.x + el.w / 2, el.y + el.h / 2, 15, fault ? '#000000' : on ? p.green : p.white, 'center', 'middle');
      break;
    }
    case 'bus': {
      const on = it.a() >= 0.5;
      const h = el.h ?? 26;
      box(ctx, el.x, el.y, el.w, h, on ? '#0b5d0b' : '#2c2e30', on ? p.green : p.white, 2, 3);
      tf.draw(ctx, el.label, el.x + el.w / 2, el.y + h / 2 + 1, 15, on ? p.white : p.grey, 'center', 'middle');
      break;
    }
    case 'source': {
      const on = it.a() >= 0.5;
      const fault = it.b() >= 0.5;
      const col = fault ? p.amber : on ? p.green : p.white;
      if (el.kind === 'batt') {
        box(ctx, el.x - 26, el.y - 16, 52, 32, '#1a1c1e', col, 2, 3);
        line(ctx, el.x - 12, el.y - 20, el.x - 12, el.y - 16, col, 3);
        line(ctx, el.x + 12, el.y - 20, el.x + 12, el.y - 16, col, 3);
      } else {
        circle(ctx, el.x, el.y, 22, '#1a1c1e', col, 2);
        if (el.kind === 'gen' || el.kind === 'apu' || el.kind === 'ptcu') {
          ctx.beginPath();
          for (let i = 0; i <= 16; i++) {
            const t = i / 16;
            const xx = el.x - 12 + 24 * t;
            const yy = el.y + 6 - 6 * Math.sin(t * Math.PI * 2);
            if (i === 0) ctx.moveTo(xx, yy);
            else ctx.lineTo(xx, yy);
          }
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      tf.draw(ctx, el.label, el.x, el.y + 34, 14, col, 'center', 'middle');
      break;
    }
    case 'valve': {
      const open = it.a() >= 0.5;
      const fault = it.b() >= 0.5;
      const col = fault ? p.amber : open ? p.green : p.white;
      circle(ctx, el.x, el.y, 13, '#1a1c1e', col, 2);
      const vert = (el.orientation ?? 'h') === 'v';
      // Bar aligned with the flow when open, across it when closed.
      const along = open !== vert;
      if (along) line(ctx, el.x - 11, el.y, el.x + 11, el.y, col, 3);
      else line(ctx, el.x, el.y - 11, el.x, el.y + 11, col, 3);
      if (el.label) tf.draw(ctx, el.label, el.x, el.y + 24, 12, p.white, 'center', 'middle');
      break;
    }
    case 'pump': {
      const on = it.a() >= 0.5;
      const fault = it.b() >= 0.5;
      const col = fault ? p.amber : on ? p.green : p.white;
      circle(ctx, el.x, el.y, 14, on ? '#0b5d0b' : '#1a1c1e', col, 2);
      ctx.beginPath();
      ctx.moveTo(el.x - 6, el.y + 7);
      ctx.lineTo(el.x, el.y - 8);
      ctx.lineTo(el.x + 6, el.y + 7);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      if (el.label) tf.draw(ctx, el.label, el.x, el.y + 26, 12, p.white, 'center', 'middle');
      break;
    }
    case 'tank': {
      const q = it.a();
      const f = el.capacity > 0 ? Math.max(0, Math.min(1, q / el.capacity)) : 0;
      const low = el.low !== undefined && q <= el.low;
      box(ctx, el.x, el.y, el.w, el.h, '#16181a', p.white, 2, 6);
      ctx.fillStyle = low ? p.amber : '#1f7fd1';
      ctx.fillRect(el.x + 3, el.y + el.h - 3 - (el.h - 6) * f, el.w - 6, (el.h - 6) * f);
      if (el.label) tf.draw(ctx, el.label, el.x + el.w / 2, el.y - 12, 14, p.white, 'center', 'middle');
      tf.draw(ctx, fmtVal(q, el.decimals ?? 0), el.x + el.w / 2, el.y + el.h / 2, 18, low ? '#000000' : p.white, 'center', 'middle', low ? undefined : '#000000');
      if (el.unit) tf.draw(ctx, el.unit, el.x + el.w / 2, el.y + el.h / 2 + 18, 12, p.white, 'center', 'middle');
      break;
    }
    case 'readout': {
      const valid = it.c() >= 0.5;
      const v = it.a();
      const c = levelColor(v, el.limits, p);
      const s = el.size ?? 18;
      const txt = valid ? fmtVal(v, el.decimals ?? 0) : '---';
      const align = el.align ?? 'center';
      const tw = tf.width(ctx, txt, s);
      const bx = align === 'center' ? el.x - tw / 2 : align === 'right' ? el.x - tw : el.x;
      if (c.bg && valid) box(ctx, bx - 3, el.y - s * 0.6, tw + 6, s * 1.2, c.bg, '');
      tf.draw(ctx, txt, el.x, el.y, s, valid ? c.fg : p.amber, align, 'middle');
      if (el.label) tf.draw(ctx, el.label, el.x, el.y - s * 0.95, 13, p.white, align, 'middle');
      if (el.unit) tf.draw(ctx, el.unit, bx + tw + 4, el.y + 2, 12, p.white, 'left', 'middle');
      break;
    }
    case 'bar': {
      const v = it.a();
      const vert = el.orientation === 'v';
      const f = Math.max(0, Math.min(1, (v - el.min) / (el.max - el.min)));
      const c = levelColor(v, el.limits, p);
      box(ctx, el.x, el.y, el.w, el.h, '#16181a', p.white, 1.5);
      ctx.fillStyle = c.bg || p.green;
      if (vert) ctx.fillRect(el.x + 2, el.y + el.h - 2 - (el.h - 4) * f, el.w - 4, (el.h - 4) * f);
      else ctx.fillRect(el.x + 2, el.y + 2, (el.w - 4) * f, el.h - 4);
      if (el.label) tf.draw(ctx, el.label, el.x + el.w / 2, el.y - 10, 13, p.white, 'center', 'middle');
      break;
    }
    case 'indicator': {
      const on = it.a() >= 0.5;
      const col = on ? namedColor(el.color, p) : p.grey;
      const txt = on || !el.offLabel ? el.label : el.offLabel;
      const w = Math.max(60, tf.width(ctx, txt, 14) + 14);
      box(ctx, el.x - w / 2, el.y - 12, w, 24, on && (el.color === 'red' || el.color === 'amber') ? col : '#1a1c1e', col, 2, 3);
      tf.draw(ctx, txt, el.x, el.y + 1, 14, on && (el.color === 'red' || el.color === 'amber') ? '#000000' : col, 'center', 'middle');
      break;
    }
    case 'door': {
      const open = it.a() >= 0.5;
      box(ctx, el.x, el.y, el.w, el.h, open ? p.red : '#0b5d0b', open ? p.red : p.green, 2, 2);
      tf.draw(ctx, el.label, el.x + el.w / 2, el.y + el.h + 12, 12, open ? p.red : p.white, 'center', 'middle');
      break;
    }
    case 'engine': {
      const on = it.a() >= 0.5;
      const w = el.w ?? 56;
      const h = el.h ?? 90;
      ctx.beginPath();
      ctx.moveTo(el.x - w / 2, el.y - h / 2 + 8);
      ctx.lineTo(el.x + w / 2, el.y - h / 2);
      ctx.lineTo(el.x + w / 2, el.y + h / 2);
      ctx.lineTo(el.x - w / 2, el.y + h / 2 - 8);
      ctx.closePath();
      ctx.fillStyle = '#1a1c1e';
      ctx.fill();
      ctx.strokeStyle = on ? p.green : p.white;
      ctx.lineWidth = 2;
      ctx.stroke();
      tf.draw(ctx, el.label, el.x, el.y, 14, on ? p.green : p.white, 'center', 'middle');
      break;
    }
    case 'aircraft': {
      const s = el.scale ?? 1;
      ctx.save();
      ctx.translate(el.x, el.y);
      ctx.scale(s, s);
      ctx.beginPath();
      // Plan-view business jet outline (EST, schematic).
      ctx.moveTo(0, -150);
      ctx.bezierCurveTo(14, -140, 16, -110, 16, -80);
      ctx.lineTo(16, -20);
      ctx.lineTo(150, 20);
      ctx.lineTo(150, 38);
      ctx.lineTo(16, 20);
      ctx.lineTo(14, 90);
      ctx.lineTo(55, 120);
      ctx.lineTo(55, 132);
      ctx.lineTo(0, 124);
      ctx.lineTo(-55, 132);
      ctx.lineTo(-55, 120);
      ctx.lineTo(-14, 90);
      ctx.lineTo(-16, 20);
      ctx.lineTo(-150, 38);
      ctx.lineTo(-150, 20);
      ctx.lineTo(-16, -20);
      ctx.lineTo(-16, -80);
      ctx.bezierCurveTo(-16, -110, -14, -140, 0, -150);
      ctx.closePath();
      ctx.fillStyle = '#2a2d30';
      ctx.fill();
      ctx.strokeStyle = p.white;
      ctx.lineWidth = 1.5 / s;
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'surface': {
      const v = it.a();
      const vert = el.orientation !== 'h';
      box(ctx, el.x, el.y, el.w, el.h, '#16181a', p.white, 1.5);
      const f = Math.max(0, Math.min(1, (v - el.min) / (el.max - el.min)));
      const z = Math.max(0, Math.min(1, (0 - el.min) / (el.max - el.min)));
      ctx.fillStyle = p.green;
      if (vert) {
        const y0 = el.y + el.h * (1 - z);
        const y1 = el.y + el.h * (1 - f);
        ctx.fillRect(el.x + 2, Math.min(y0, y1), el.w - 4, Math.max(2, Math.abs(y1 - y0)));
      } else {
        const x0 = el.x + el.w * z;
        const x1 = el.x + el.w * f;
        ctx.fillRect(Math.min(x0, x1), el.y + 2, Math.max(2, Math.abs(x1 - x0)), el.h - 4);
      }
      if (el.label) tf.draw(ctx, el.label, el.x + el.w / 2, el.y - 10, 12, p.white, 'center', 'middle');
      break;
    }
  }
}
