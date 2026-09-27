/**
 * Cockpit-only displays of the 172S NAV III (the G1000 GDUs come from the suite).
 *
 * Hour (Hobbs) meter, POH 172SPHBUS-00 Fig 7-2 item 12 and Sec 7 "Right panel layout": "records
 * engine operating time, when oil pressure is greater than 20 PSI". The counting is done by the shared
 * C172 logic (C172.hobbsHours, oil pressure switch + supply); this display only shows the drum
 * counter. Face per the photographs "Cessna 172SP G1000 01.jpg" and "C172S G1000 in flight.jpg": a white /
 * cream counter face in a dark rectangular bezel with the "HOURS" legend, dark digits on light drums; the
 * tenths drum is set off in red with a white digit (EST: the photographs are too small to read its colour).
 */
import type { SimVars } from '../../../core/SimVars';
import { CanvasDisplay, type DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../avionics/common/draw/context';
import { C172 } from '../../c172s-common/vars';

export class HourMeterDisplay extends CanvasDisplay {
  private shown = -1;
  constructor(
    private readonly v: SimVars,
    opts: { canvas?: 'dom' | 'offscreen' | DisplayCanvas } = {},
  ) {
    super({ id: 'hobbs', width: 200, height: 80, vars: v, refreshHz: 2, powerVar: null, brightnessVar: null, canvas: opts.canvas, background: '#e8e6de' });
  }

  protected override update(): void {
    const tenth = Math.floor(this.v.get(C172.hobbsHours) * 10);
    if (tenth !== this.shown) {
      this.shown = tenth;
      this.invalidate();
    }
  }

  protected draw(ctx: Ctx2D): void {
    const digits = Math.max(0, this.shown).toString().padStart(6, '0').slice(-6);
    ctx.fillStyle = '#e8e6de';
    ctx.fillRect(0, 0, 200, 80);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.fillText('HOURS', 100, 10);
    ctx.font = 'bold 36px "Courier New", monospace';
    for (let i = 0; i < 6; i++) {
      const x = 17 + i * 33;
      const last = i === 5;
      // Drum windows: light drums behind a thin dark frame; the tenths drum red.
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(x - 15, 21, 30, 50);
      ctx.fillStyle = last ? '#b3261e' : '#f4f2ea';
      ctx.fillRect(x - 13, 23, 26, 46);
      ctx.fillStyle = last ? '#ffffff' : '#111111';
      ctx.fillText(digits[i], x + 0.5, 47);
    }
  }
}
