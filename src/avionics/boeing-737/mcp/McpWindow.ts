/**
 * One MCP data window (COURSE L/R, IAS/MACH, HEADING, ALTITUDE, VERT SPEED)
 * of the 737NG Mode Control Panel. The windows show the strings the AFDS
 * writes (`ac.mcp.win_*`, see Afds.annunciate): blank IAS/MACH in VNAV
 * without speed intervention, blank V/S unless V/S is engaged, and the
 * flashing underspeed 'A' / overspeed '8' symbol in the first digit of the
 * IAS/MACH window (FCOM 4.10 "IAS/MACH display": "flashing 8 ... overspeed
 * limiting, flashing A ... underspeed limiting").
 *
 * Look: white seven-segment style digits on black (NG MCP photographs; the
 * window texture is small, so a bold monospace face is used, EST).
 * Refresh 15 Hz (only redrawn when the string changes or while flashing).
 */
import { CanvasDisplay } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import { FONT_STACKS, fontString } from '../../common/fonts';
import type { SimVars } from '../../../core/SimVars';
import { B737_VARS, type Side } from '../vars';

export type McpWindowKind = 'crs1' | 'spd' | 'hdg' | 'alt' | 'vs' | 'crs2';
export const MCP_WINDOW_KINDS: readonly McpWindowKind[] = ['crs1', 'spd', 'hdg', 'alt', 'vs', 'crs2'];

/** Cockpit display id of an MCP window. */
export function mcpWindowId(k: McpWindowKind): string {
  return `b737_mcp_${k}`;
}

/** Digit cells per window (MCP photographs: CRS 3, IAS/MACH 3 + limit symbol, HDG 3, ALT 5, V/S sign + 4). */
const CELLS: Record<McpWindowKind, number> = { crs1: 3, spd: 4, hdg: 3, alt: 5, vs: 5, crs2: 3 };

const W_PER_CELL = 40;
const H = 64;
const COLOR = '#f4f1e6';

function varFor(k: McpWindowKind): string {
  switch (k) {
    case 'crs1':
      return B737_VARS.mcpWinCrs(1 as Side);
    case 'crs2':
      return B737_VARS.mcpWinCrs(2 as Side);
    case 'spd':
      return B737_VARS.mcpWinSpd;
    case 'hdg':
      return B737_VARS.mcpWinHdg;
    case 'alt':
      return B737_VARS.mcpWinAlt;
    case 'vs':
      return B737_VARS.mcpWinVs;
  }
}

export interface McpWindowOptions {
  vars: SimVars;
  canvas?: 'dom' | 'offscreen' | HTMLCanvasElement | OffscreenCanvas;
  pixelRatio?: number;
}

export class McpWindowDisplay extends CanvasDisplay {
  readonly kind: McpWindowKind;
  readonly cells: number;
  private readonly textVar: string;
  private readonly font = fontString(52, FONT_STACKS.mono, 'bold');
  private text = '';
  private limit = 0;
  private flashT = 0;

  constructor(kind: McpWindowKind, opts: McpWindowOptions) {
    const cells = CELLS[kind];
    super({ id: mcpWindowId(kind), width: cells * W_PER_CELL, height: H, pixelRatio: opts.pixelRatio ?? 1, vars: opts.vars, refreshHz: 15, canvas: opts.canvas });
    this.kind = kind;
    this.cells = cells;
    this.textVar = varFor(kind);
    this.watchString(this.textVar);
    if (kind === 'spd') this.watch(B737_VARS.mcpSpdLimit);
  }

  /** Physical aspect ratio (w / h) for the cockpit window mesh. */
  get aspect(): number {
    return (this.cells * W_PER_CELL) / H;
  }

  protected override update(dt: number): void {
    const v = this.vars!;
    this.text = v.getString(this.textVar);
    this.limit = this.kind === 'spd' ? v.get(B737_VARS.mcpSpdLimit) : 0;
    this.animating = this.limit !== 0;
    this.flashT = (this.flashT + dt) % 1;
  }

  protected draw(ctx: Ctx2D): void {
    ctx.font = this.font;
    ctx.fillStyle = COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const s = this.text;
    // Right-aligned in the digit cells.
    const n = this.cells;
    const off = n - s.length;
    for (let i = 0; i < s.length; i++) {
      const cell = off + i;
      if (cell < 0) continue;
      ctx.fillText(s[i], (cell + 0.5) * W_PER_CELL, H / 2 + 2);
    }
    // Speed limit symbol in the left cell (flashing, 2 Hz EST).
    if (this.limit !== 0 && this.flashT < 0.5 && this.kind === 'spd') ctx.fillText(this.limit > 0 ? '8' : 'A', 0.5 * W_PER_CELL, H / 2 + 2);
  }
}
