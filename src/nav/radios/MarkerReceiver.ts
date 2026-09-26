/**
 * 75 MHz marker beacon receiver. Sets `nav.marker_outer`, `nav.marker_middle`
 * and `nav.marker_inner` to 1 while the aircraft is inside the respective
 * beacon's elliptical pattern (AIM 1-1-9 e.1). Power comes from
 * `nav.marker_powered` (or the var given in the options), sensitivity from
 * `nav.marker_hi_sens` (1 = HI: EST 1.6x larger pattern).
 *
 * Audio (400 Hz dashes OM, 1300 Hz dot-dash MM, 3000 Hz dots IM) and lamps are
 * the aircraft's job; they read these vars.
 */
import type { SimVars } from '../../core/SimVars';
import { FDM, NAV } from '../../core/vars';
import type { Navaid } from '../types';
import type { StationSource } from './stationSource';
import { inMarkerCone } from './geometry';

export interface MarkerReceiverOptions {
  /** Var holding receiver power (default 'nav.marker_powered'). */
  powerVar?: string;
  /** HI sensitivity pattern scale (EST 1.6). */
  hiSensitivityScale?: number;
}

const SEARCH_RADIUS_NM = 5;
const SEARCH_INTERVAL_S = 2;

export class MarkerReceiver {
  private readonly vars: SimVars;
  private readonly src: StationSource;
  private readonly powerVar: string;
  private readonly hiScale: number;
  private readonly near: Navaid[] = [];
  private timer = SEARCH_INTERVAL_S;

  constructor(vars: SimVars, src: StationSource, opts: MarkerReceiverOptions = {}) {
    this.vars = vars;
    this.src = src;
    this.powerVar = opts.powerVar ?? NAV.markerPowered;
    this.hiScale = opts.hiSensitivityScale ?? 1.6;
    this.write(0, 0, 0);
  }

  reset(): void {
    this.timer = SEARCH_INTERVAL_S;
  }

  private write(o: number, m: number, i: number): void {
    this.vars.set(NAV.markerOuter, o);
    this.vars.set(NAV.markerMiddle, m);
    this.vars.set(NAV.markerInner, i);
  }

  update(dt: number): void {
    const v = this.vars;
    if (!v.getBool(this.powerVar)) {
      this.write(0, 0, 0);
      return;
    }
    const lat = v.get(FDM.lat);
    const lon = v.get(FDM.lon);
    const alt = v.get(FDM.altMsl);
    this.timer += dt;
    if (this.timer >= SEARCH_INTERVAL_S) {
      this.timer = 0;
      this.src.markersNear(lat, lon, SEARCH_RADIUS_NM, this.near);
    }
    const sens = v.getBool(NAV.markerHiSens) ? this.hiScale : 1;
    let o = 0;
    let m = 0;
    let i = 0;
    for (let k = 0; k < this.near.length; k++) {
      const n = this.near[k];
      if (!inMarkerCone(n.lat, n.lon, n.elevationFt, n.courseTrue ?? 0, lat, lon, alt, sens)) continue;
      if (n.type === 'OM') o = 1;
      else if (n.type === 'MM') m = 1;
      else if (n.type === 'IM') i = 1;
    }
    this.write(o, m, i);
  }
}
