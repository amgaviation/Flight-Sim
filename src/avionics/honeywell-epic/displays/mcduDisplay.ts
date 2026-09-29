/**
 * MCDU screen display (PlaneView II pedestal MCDUs) and the shared CDU
 * screen renderer used by the Symmetry TSC FMS app.
 *
 * 24 x 14 character grid (fms/cdu.ts). Large characters for data lines,
 * small for labels; colours per `CduColor` (Honeywell: green active /
 * computed, cyan pilot entries and presets, magenta active waypoint,
 * amber messages / boxes, white labels) — EST shades.
 */
import { CanvasDisplay, type DisplayCanvas } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import { EPIC_MONO, C } from '../style';
import { CDU_COLS, CDU_ROWS, type CduColor, type CduScreen } from '../fms/cdu';
import type { Mcdu } from '../fms/mcdu';
import type { SimVars } from '../../../core/SimVars';

export const CDU_COLORS: Record<CduColor, string> = {
  white: '#f2f4f5',
  cyan: '#2ee6ff',
  green: '#27f23c',
  magenta: '#ff4cf5',
  amber: '#ffb000',
  red: '#ff2a2a',
  grey: '#8a9098',
};

/** Draws a CDU screen into (x, y, w, h). */
export function drawCduScreen(ctx: Ctx2D, s: CduScreen, x: number, y: number, w: number, h: number): void {
  const cw = w / CDU_COLS;
  const rh = h / CDU_ROWS;
  const big = Math.min(rh * 0.82, cw * 1.55);
  const small = big * 0.74;
  // Title row (centred) with the page number at the right.
  if (s.title) EPIC_MONO.draw(ctx, s.title, x + w / 2, y + rh * 0.55, big, CDU_COLORS[s.titleColor], 'center', 'middle');
  if (s.pages > 1) EPIC_MONO.draw(ctx, PAGE_NUM[Math.min(9, s.page)] + '/' + PAGE_NUM[Math.min(9, s.pages)], x + w - 2, y + rh * 0.55, small, C.white, 'right', 'middle');
  for (let r = 1; r < CDU_ROWS - 1; r++) {
    const segs = s.rows[r];
    const cy = y + rh * (r + 0.55);
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      EPIC_MONO.draw(ctx, sg.text, x + sg.col * cw, cy, sg.small ? small : big, CDU_COLORS[sg.color], 'left', 'middle');
    }
  }
  // Scratchpad (bottom row), with bracket markers.
  const sy = y + rh * (CDU_ROWS - 0.45);
  ctx.fillStyle = '#3a3f45';
  ctx.fillRect(x, sy - rh * 0.55, w, 1);
  if (s.scratch) EPIC_MONO.draw(ctx, s.scratch, x + 2, sy, big, CDU_COLORS[s.scratchColor], 'left', 'middle');
}

const PAGE_NUM = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export interface McduDisplayOptions {
  id: string;
  vars: SimVars;
  mcdu: Mcdu;
  pixelRatio?: number;
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
}

/** Pedestal MCDU screen: 480 x 400 logical px (EST ~ 5 x 4 in CRT-replacement LCD). */
export class McduDisplay extends CanvasDisplay {
  readonly mcdu: Mcdu;
  private lastVersion = -1;

  constructor(o: McduDisplayOptions) {
    super({ id: o.id, width: 480, height: 400, pixelRatio: o.pixelRatio, vars: o.vars, canvas: o.canvas, refreshHz: 20 });
    this.mcdu = o.mcdu;
  }

  protected override update(): void {
    if (this.mcdu.version !== this.lastVersion) {
      this.lastVersion = this.mcdu.version;
      this.invalidate();
    }
  }

  protected override draw(ctx: Ctx2D): void {
    drawCduScreen(ctx, this.mcdu.screen, 14, 8, 480 - 28, 400 - 14);
  }
}
