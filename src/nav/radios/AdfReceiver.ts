/**
 * ADF receiver (`adf{r}`): tunes NDBs / compass locators on
 * `adf{r}.active_khz` and writes the relative bearing to the station
 * (`adf{r}.rel_bearing_deg`, 0 = nose, clockwise) for ADF/RMI needles.
 *
 * A loop antenna measures the direction of arrival relative to the airframe,
 * so the bearing is computed from the true bearing to the station and the
 * FDM true heading. LF/MF signals propagate by ground wave: reception is
 * limited by the NDB class range (AIM 1-1-8 Table 1-1-2) x `rangeFactor`,
 * not by line of sight.
 *
 * Modes (`adf{r}.mode`, default ADF when never written): 0 ANT (audio only,
 * needle parked at 90 deg as on the KR 87), 1 ADF, 2 BFO (ADF with beat tone).
 * SCOPE: night effect, coastal refraction, quadrantal error and thunderstorm
 * deflection are not modelled.
 */
import type { SimVars } from '../../core/SimVars';
import { FDM, NAV } from '../../core/vars';
import { wrap360 } from '../../core/math';
import { distanceNm, initialBearing } from '../../core/geo';
import type { Navaid } from '../types';
import type { StationSource } from './stationSource';
import { morse } from './morse';

export interface AdfReceiverOptions {
  /** Multiplier on the NDB class range (EST 1.25). */
  rangeFactor?: number;
  retuneIntervalS?: number;
  /** Needle settling after a frequency change (s), EST 1. */
  settleS?: number;
}

/** Needle park position when no bearing is available (deg relative). KR 87 parks at 90. */
export const ADF_PARK_DEG = 90;

export class AdfReceiver {
  readonly index: number;
  private readonly vars: SimVars;
  private readonly src: StationSource;
  private readonly rangeFactor: number;
  private readonly retuneInterval: number;
  private readonly settleS: number;
  private readonly vFreq: string;
  private readonly vPowered: string;
  private readonly vMode: string;
  private readonly vBearing: string;
  private readonly vValid: string;
  private readonly vIdent: string;
  private readonly vMorse: string;
  private readonly vSignal: string;
  private readonly vDist: string;
  private readonly cands: Navaid[] = [];
  private tunedFreq = NaN;
  private timer = 0;
  private settle = 0;
  station: Navaid | null = null;

  constructor(vars: SimVars, src: StationSource, index: number, opts: AdfReceiverOptions = {}) {
    this.vars = vars;
    this.src = src;
    this.index = index;
    this.rangeFactor = opts.rangeFactor ?? 1.25;
    this.retuneInterval = opts.retuneIntervalS ?? 5;
    this.settleS = opts.settleS ?? 1;
    this.vFreq = NAV.adfActive(index);
    this.vPowered = NAV.adfPowered(index);
    this.vMode = NAV.adfMode(index);
    this.vBearing = NAV.adfBearing(index);
    this.vValid = NAV.adfValid(index);
    this.vIdent = NAV.adfIdent(index);
    this.vMorse = NAV.adfMorse(index);
    this.vSignal = NAV.adfSignal(index);
    this.vDist = NAV.adfDistNm(index);
    this.writeNoStation();
  }

  reset(): void {
    this.tunedFreq = NaN;
  }

  private writeNoStation(): void {
    const v = this.vars;
    v.set(this.vValid, 0);
    v.set(this.vBearing, ADF_PARK_DEG);
    v.set(this.vSignal, 0);
    v.setString(this.vIdent, '');
    v.setString(this.vMorse, '');
    this.station = null;
  }

  update(dt: number): void {
    const v = this.vars;
    if (!v.getBool(this.vPowered)) {
      this.writeNoStation();
      this.tunedFreq = NaN;
      return;
    }
    const lat = v.get(FDM.lat);
    const lon = v.get(FDM.lon);
    const freq = v.get(this.vFreq);
    this.timer += dt;
    if (freq !== this.tunedFreq) {
      this.tunedFreq = freq;
      this.settle = this.settleS;
      this.timer = this.retuneInterval;
    }
    if (this.timer >= this.retuneInterval) {
      this.timer = 0;
      this.src.onFreq(freq, lat, lon, 400, this.cands);
    }
    if (this.settle > 0) this.settle -= dt;
    let best: Navaid | null = null;
    let bestSig = 0;
    let bestD = 0;
    for (let i = 0; i < this.cands.length; i++) {
      const n = this.cands[i];
      if (n.type !== 'NDB' && n.type !== 'NDBDME') continue;
      const d = distanceNm(lat, lon, n.lat, n.lon);
      const range = Math.max(5, n.rangeNm) * this.rangeFactor;
      if (d > range) continue;
      const q = d / range;
      const sig = Math.max(0.01, 1 - q * q);
      if (sig > bestSig) {
        bestSig = sig;
        best = n;
        bestD = d;
      }
    }
    if (!best) {
      this.writeNoStation();
      return;
    }
    this.station = best;
    v.setString(this.vIdent, best.ident);
    v.setString(this.vMorse, morse(best.ident));
    v.set(this.vSignal, bestSig);
    v.set(this.vDist, bestD);
    const mode = v.has(this.vMode) ? v.get(this.vMode) : 1;
    if (mode === 0 || this.settle > 0) {
      v.set(this.vValid, 0);
      v.set(this.vBearing, ADF_PARK_DEG);
      return;
    }
    const brg = initialBearing(lat, lon, best.lat, best.lon);
    v.set(this.vBearing, wrap360(brg - v.get(FDM.headingTrue)));
    v.set(this.vValid, 1);
  }
}
