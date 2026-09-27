/**
 * Cockpit-only displays of the 172S NAV III (the G1000 GDUs come from the suite).
 *
 * Hour (Hobbs) meter, POH 172SPHBUS-00 Fig 7-2 item 12 and Sec 7 "Right panel layout": "records
 * engine operating time, when oil pressure is greater than 20 PSI". The counting is done by the shared
 * C172 logic (C172.hobbsHours, oil pressure switch + supply); this display only shows the drum
 * counter: five white-on-black hour digits and a black-on-white tenths drum (EST face from photographs).
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
    super({ id: 'hobbs', width: 200, height: 60, vars: v, refreshHz: 2, powerVar: null, brightnessVar: null, canvas: opts.canvas, background: '#0c0c0c' });
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
    ctx.font = 'bold 38px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 6; i++) {
      const x = 17 + i * 33;
      const last = i === 5;
      ctx.fillStyle = last ? '#e8e8e8' : '#151515';
      ctx.fillRect(x - 15, 6, 30, 48);
      ctx.fillStyle = last ? '#101010' : '#f0f0f0';
      ctx.fillText(digits[i], x + 0.5, 31);
    }
  }
}
