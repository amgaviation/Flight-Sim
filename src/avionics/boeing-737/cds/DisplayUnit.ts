/**
 * One 737NG display unit (Honeywell flat-panel DU): an 800 x 800 logical
 * canvas that draws whichever CDS format the CDS logic assigned to it
 * (`ac.cds.<du>.format` / `.side`). Power follows `display.<id>.power`
 * (written by CdsLogic from the DU power binding, DEU availability and
 * failures); brightness `display.<id>.brt` (panel brightness knobs).
 *
 * Refresh: 30 Hz while showing the PFD / ND (continuous motion), otherwise
 * the engine / systems formats redraw at 15 Hz (CLAUDE.md: glass <= 30 Hz).
 */
import { CanvasDisplay } from '../../common/CanvasDisplay';
import type { Ctx2D } from '../../common/draw/context';
import { B737_VARS, DuFormat, duDisplayId, type DuId, type Side } from '../vars';
import type { CdsEnv, CdsFormatRenderer } from './types';
import { DU_SIZE } from './types';
import { Pfd } from './Pfd';
import { Nd } from './Nd';
import { EngPrimary, EngSecondary, EngCompact } from './EngineDisplays';
import { SysDisplay } from './SysDisplay';
import { CDS, text } from './style';

export interface DisplayUnitOptions {
  canvas?: 'dom' | 'offscreen' | HTMLCanvasElement | OffscreenCanvas;
  pixelRatio?: number;
  /** Seconds of self test after power-up (EST 2 s: DUs show a blank screen while initialising). */
  bootS?: number;
}

export class DisplayUnit extends CanvasDisplay {
  readonly du: DuId;
  private readonly env: CdsEnv;
  private readonly formatVar: string;
  private readonly sideVar: string;
  private current: DuFormat = DuFormat.Blank;
  private currentSide: Side = 1;
  private renderer: CdsFormatRenderer | null = null;
  private readonly cache = new Map<number, CdsFormatRenderer>();

  constructor(env: CdsEnv, du: DuId, opts: DisplayUnitOptions = {}) {
    super({
      id: duDisplayId(du),
      width: DU_SIZE,
      height: DU_SIZE,
      pixelRatio: opts.pixelRatio ?? env.cfg.duPixelRatio,
      vars: env.vars,
      refreshHz: 30,
      canvas: opts.canvas,
      bootTimeS: opts.bootS ?? 2,
    });
    this.env = env;
    this.du = du;
    this.formatVar = B737_VARS.duFormat(du);
    this.sideVar = B737_VARS.duSide(du);
    this.animating = true;
  }

  /** Format currently drawn (for tests / probes). */
  get format(): DuFormat {
    return this.current;
  }

  private rendererFor(f: DuFormat, side: Side): CdsFormatRenderer | null {
    const key = f * 4 + side;
    let r = this.cache.get(key);
    if (r) return r;
    switch (f) {
      case DuFormat.Pfd:
        r = new Pfd(this.env);
        break;
      case DuFormat.Nd:
        r = new Nd(this.env);
        break;
      case DuFormat.EngPrimary:
        r = new EngPrimary(this.env);
        break;
      case DuFormat.EngSecondary:
        r = new EngSecondary(this.env);
        break;
      case DuFormat.EngCompact:
        r = new EngCompact(this.env);
        break;
      case DuFormat.Sys:
        r = new SysDisplay(this.env);
        break;
      default:
        return null;
    }
    this.cache.set(key, r);
    return r;
  }

  protected override update(dt: number): void {
    const v = this.vars!;
    const f = v.get(this.formatVar) as DuFormat;
    const s = (v.get(this.sideVar) === 2 ? 2 : 1) as Side;
    if (f !== this.current || s !== this.currentSide) {
      this.current = f;
      this.currentSide = s;
      this.renderer = this.rendererFor(f, s);
      this.renderer?.reset?.();
    }
    this.renderer?.update(dt, s);
  }

  protected draw(ctx: Ctx2D): void {
    this.renderer?.draw(ctx);
  }

  protected override drawBoot(ctx: Ctx2D, progress: number): void {
    // Power-up self test: the NG DUs come up black; a small status line is shown here (EST).
    if (progress < 0.5) return;
    text(ctx, 'INITIALIZING', DU_SIZE / 2, DU_SIZE / 2, 22, CDS.white, 'center');
  }
}
