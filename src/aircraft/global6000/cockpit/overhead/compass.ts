/**
 * Standby magnetic compass (Global Vision overhead forward edge, above the
 * centre post; placard "STANDBY COMPASS PULL DOWN TO OPEN", photo N835GL top
 * edge). The compass stows in the overhead fitting strip; pulled down
 * (`V.compassOpen` = 1) its card is readable through the lubber-line window.
 * The card follows `V.compassHdg` (systems/vision.ts: magnetic heading with
 * EST deviation and damping). SCOPE: no card tilt / northerly-turning error;
 * the card has no lighting of its own.
 */
import { CanvasDisplay, type DisplayCanvas } from '../../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../../avionics/common/draw/context';
import type { SimVars } from '../../../../core/SimVars';
import { G6K_VARS as V } from '../../vars';

const W = 240;
const H = 90;
const LABELS = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];

/** Compass card seen through the window: a horizontal band of the card, 10 deg ticks, 30 deg numerals, lubber line. */
export class CompassCard extends CanvasDisplay {
  constructor(
    private readonly v: SimVars,
    canvas?: 'dom' | 'offscreen' | DisplayCanvas,
  ) {
    super({ id: 'g6k.stby_compass', width: W, height: H, vars: v, canvas, refreshHz: 20, powerVar: null, brightnessVar: null, background: '#101010' });
    this.animating = true;
  }

  protected draw(ctx: Ctx2D): void {
    const h = this.v.get(V.compassHdg);
    const pxPerDeg = 3.2;
    ctx.fillStyle = '#e9e4d6';
    ctx.strokeStyle = '#e9e4d6';
    ctx.lineWidth = 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 26px Arial, sans-serif';
    const first = Math.floor((h - 40) / 5) * 5;
    for (let d = first; d <= h + 40; d += 5) {
      const x = W / 2 + (d - h) * pxPerDeg;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 10 === 0;
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, major ? 30 : 20);
      ctx.stroke();
      if (dd % 30 === 0) ctx.fillText(LABELS[dd / 30], x, 56);
    }
    // Lubber line.
    ctx.strokeStyle = '#ff7a2a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
  }
}
