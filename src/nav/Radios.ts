/**
 * Radio navigation receivers as one `Subsystem`: `navCount` VOR/LOC/GS/DME
 * receivers (`nav1`, `nav2`, ...), `adfCount` ADF receivers, the marker
 * beacon receiver and the GPS receiver. Update it at the nav rate (20 Hz,
 * `SimLoop` `nav` callback) or in the aircraft systems list (60 Hz); it never
 * allocates in `update`.
 *
 *   const radios = new Radios(ctx, { navCount: 2, adfCount: 1 });
 *   systems.push(radios);
 *
 * Inputs the aircraft must write: `nav{r}.active_mhz`, `nav{r}.obs_deg`,
 * `nav{r}.powered`, optionally `nav{r}.dme_hold`; `adf{r}.active_khz`,
 * `adf{r}.powered`, `adf{r}.mode`; `nav.marker_powered`,
 * `nav.marker_hi_sens`; `gps.powered`. See docs/modules/nav.md.
 */
import type { SimVars } from '../core/SimVars';
import type { Subsystem } from '../aircraft/types';
import type { NavDatabase } from './types';
import { StationSource } from './radios/stationSource';
import { NavReceiver, type NavReceiverOptions } from './radios/NavReceiver';
import { AdfReceiver, type AdfReceiverOptions } from './radios/AdfReceiver';
import { MarkerReceiver, type MarkerReceiverOptions } from './radios/MarkerReceiver';
import { GpsReceiver, type GpsReceiverOptions } from './radios/GpsReceiver';

export interface RadiosOptions {
  /** Number of VHF NAV receivers (default 2). */
  navCount?: number;
  /** Number of ADF receivers (default 1; 0 for none). */
  adfCount?: number;
  /** Marker beacon receiver (default true); options or false. */
  marker?: boolean | MarkerReceiverOptions;
  /** GPS receiver (default true); options or false. */
  gps?: boolean | GpsReceiverOptions;
  nav?: NavReceiverOptions;
  adf?: AdfReceiverOptions;
}

export class Radios implements Subsystem {
  readonly name = 'radios';
  readonly nav: NavReceiver[] = [];
  readonly adf: AdfReceiver[] = [];
  readonly marker: MarkerReceiver | null;
  readonly gps: GpsReceiver | null;

  constructor(ctx: { vars: SimVars; nav: NavDatabase }, opts: RadiosOptions = {}) {
    const src = new StationSource(ctx.nav);
    const navCount = opts.navCount ?? 2;
    const adfCount = opts.adfCount ?? 1;
    for (let r = 1; r <= navCount; r++) this.nav.push(new NavReceiver(ctx.vars, src, r, opts.nav));
    for (let r = 1; r <= adfCount; r++) this.adf.push(new AdfReceiver(ctx.vars, src, r, opts.adf));
    this.marker = opts.marker === false ? null : new MarkerReceiver(ctx.vars, src, typeof opts.marker === 'object' ? opts.marker : {});
    this.gps = opts.gps === false ? null : new GpsReceiver(ctx.vars, typeof opts.gps === 'object' ? opts.gps : {});
  }

  update(dt: number): void {
    for (let i = 0; i < this.nav.length; i++) this.nav[i].update(dt);
    for (let i = 0; i < this.adf.length; i++) this.adf[i].update(dt);
    this.marker?.update(dt);
    this.gps?.update(dt);
  }

  /** Re-search stations (after a reposition or when the database finished loading). */
  reset(): void {
    for (const r of this.nav) r.reset();
    for (const r of this.adf) r.reset();
    this.marker?.reset();
    this.gps?.reset();
  }
}
