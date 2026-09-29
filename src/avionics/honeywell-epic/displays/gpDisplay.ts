/**
 * Guidance panel windows: SPEED, HEADING, VS/FPA and ALTITUDE readouts of
 * the glareshield guidance panel (G650 FGP / Symmetry GP-700). Text comes
 * from `GuidancePanelLogic.windows` (cached strings). PlaneView II digits
 * are amber-orange LCD segments, Symmetry GP-700 digits blue-white (EST
 * from the G650ER and G600 glareshield photographs). Each window is its own
 * small display so the aircraft can map it behind the panel cut-out.
 */
import { CanvasDisplay, type DisplayCanvas } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import { C, EPIC_LCD, text } from '../style';
import { EPIC_VARS } from '../vars';
import type { GuidancePanelLogic } from '../logic/guidance';
import type { SimVars } from '../../../core/SimVars';

export type GpWindowKind = 'speed' | 'heading' | 'vsfpa' | 'altitude';
export const GP_WINDOW_KINDS: readonly GpWindowKind[] = ['speed', 'heading', 'vsfpa', 'altitude'];

export interface GpWindowOptions {
  id: string;
  kind: GpWindowKind;
  vars: SimVars;
  gp: GuidancePanelLogic;
  symmetry: boolean;
  /** Power var (the suite writes display.<id>.power from the GP binding). */
  pixelRatio?: number;
  canvas?: 'dom' | 'offscreen' | DisplayCanvas;
}

export class GpWindowDisplay extends CanvasDisplay {
  readonly kind: GpWindowKind;
  private readonly gp: GuidancePanelLogic;
  private readonly color: string;
  private lastText = '';
  private lastLegend = '';

  constructor(o: GpWindowOptions) {
    super({ id: o.id, width: 200, height: 72, pixelRatio: o.pixelRatio, vars: o.vars, canvas: o.canvas, refreshHz: 15, background: '#050505' });
    this.kind = o.kind;
    this.gp = o.gp;
    this.color = o.symmetry ? C.gpDigitsSym : C.gpDigits;
    this.watch(EPIC_VARS.gpBrt, 0.02);
  }

  private textNow(): string {
    const w = this.gp.windows;
    return this.kind === 'speed' ? w.speed : this.kind === 'heading' ? w.heading : this.kind === 'vsfpa' ? w.vsfpa : w.altitude;
  }

  private legendNow(): string {
    const w = this.gp.windows;
    return this.kind === 'speed' ? w.speedLegend : this.kind === 'vsfpa' ? w.vsLegend : '';
  }

  protected override update(): void {
    const t = this.textNow();
    const l = this.legendNow();
    if (t !== this.lastText || l !== this.lastLegend) {
      this.lastText = t;
      this.lastLegend = l;
      this.invalidate();
    }
  }

  protected override draw(ctx: Ctx2D): void {
    const t = this.lastText;
    if (!t) return;
    const brt = this.vars?.get(EPIC_VARS.gpBrt, 1) ?? 1;
    ctx.globalAlpha = Math.max(0.25, Math.min(1, brt));
    EPIC_LCD.draw(ctx, t, 186, 42, 46, this.color, 'right', 'middle');
    if (this.lastLegend) text(ctx, this.lastLegend, 10, 16, 15, this.color, 'left', 'middle');
    ctx.globalAlpha = 1;
  }
}
