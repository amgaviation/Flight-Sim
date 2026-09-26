/**
 * TCAS II logic (simplified, v7.1 thresholds) with a pluggable traffic
 * source. There is no traffic generator in the sim yet; the aircraft/app
 * supplies a `TrafficSource` (AI traffic, multiplayer, scenario scripts)
 * or leaves it empty (TCAS runs, shows no traffic).
 *
 * Thresholds: FAA "Introduction to TCAS II Version 7.1" (2011), Table 3
 * (sensitivity level, tau, DMOD, ZTHR, ALIM by own altitude):
 *   SL2 <1000 ft AGL: TA 20 s, 0.30 nm, 850 ft; no RA
 *   SL3 1000–2350 AGL: TA 25 s/0.33 nm/850; RA 15 s/0.20 nm/600, ALIM 300
 *   SL4 2350 AGL–5000 MSL: 30/0.48/850; 20/0.35/600, 300
 *   SL5 5000–10000: 40/0.75/850; 25/0.55/600, 350
 *   SL6 10000–20000: 45/1.00/850; 30/0.80/600, 400
 *   SL7 20000–42000: 48/1.30/850; 35/1.10/700, 600
 *   SL7 >42000: 48/1.30/1200; 35/1.10/800, 700
 * Same source: RAs inhibited below 1000 ft AGL (TA ONLY), descend RAs
 * inhibited below 1100 ft AGL. Proximate traffic: within 6 nm and ±1200 ft.
 * Sense: the direction that gives more vertical separation at the closest
 * point of approach (own aircraft assumed to reach 1500 fpm after 5 s).
 *
 * Mode (`xpdr.mode`, core NAV.xpdrMode): 4 = TA ONLY, 5 = TA/RA, other =
 * TCAS standby. Aurals: "TRAFFIC, TRAFFIC", "CLIMB, CLIMB",
 * "DESCEND, DESCEND", "CLEAR OF CONFLICT".
 *
 * Vars written: tcas.ta (TA count), tcas.ra (0/1), tcas.ra_sense (+1 climb,
 * −1 descend), tcas.ra_vs_min_fpm / tcas.ra_vs_max_fpm (green fly-to band),
 * string tcas.status ('TCAS OFF' | 'TA ONLY' | 'TA/RA' | 'TCAS FAIL'),
 * tcas.sl (sensitivity level), tcas.count (targets displayed).
 * Displays read `tcas.threats` (reused array of TcasThreat).
 * Failure: tcas.
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import type { AudioApi } from '../../core/SimContext';
import { ADC, GPS, NAV } from '../../core/vars';
import { distanceNm, initialBearing } from '../../core/geo';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import type { BlockEnv } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';

export interface TrafficTarget {
  id: string;
  lat: number;
  lon: number;
  /** Pressure altitude (ft); NaN = non-altitude-reporting. */
  altFt: number;
  vsFpm: number;
}

export interface TrafficSource {
  targets(): readonly TrafficTarget[];
}

export interface TcasThreat {
  id: string;
  /** Bearing relative to own heading (deg, + right). */
  relBrgDeg: number;
  rangeNm: number;
  /** Relative altitude (ft, + above), NaN if unknown. */
  relAltFt: number;
  /** +1 climbing, −1 descending, 0 level (±500 fpm threshold). */
  vsSign: number;
  /** 0 other, 1 proximate, 2 TA, 3 RA. */
  level: number;
}

interface SlRow { sl: number; taTau: number; taDmod: number; taZthr: number; raTau: number; raDmod: number; raZthr: number; alim: number }

export const TCAS_SENSITIVITY: readonly SlRow[] = [
  { sl: 2, taTau: 20, taDmod: 0.3, taZthr: 850, raTau: 0, raDmod: 0, raZthr: 0, alim: 0 },
  { sl: 3, taTau: 25, taDmod: 0.33, taZthr: 850, raTau: 15, raDmod: 0.2, raZthr: 600, alim: 300 },
  { sl: 4, taTau: 30, taDmod: 0.48, taZthr: 850, raTau: 20, raDmod: 0.35, raZthr: 600, alim: 300 },
  { sl: 5, taTau: 40, taDmod: 0.75, taZthr: 850, raTau: 25, raDmod: 0.55, raZthr: 600, alim: 350 },
  { sl: 6, taTau: 45, taDmod: 1.0, taZthr: 850, raTau: 30, raDmod: 0.8, raZthr: 600, alim: 400 },
  { sl: 7, taTau: 48, taDmod: 1.3, taZthr: 850, raTau: 35, raDmod: 1.1, raZthr: 700, alim: 600 },
  { sl: 7, taTau: 48, taDmod: 1.3, taZthr: 1200, raTau: 35, raDmod: 1.1, raZthr: 800, alim: 700 },
];

export interface TcasConfig {
  source?: TrafficSource;
  power?: Binding;
  modeVar?: string;
  /** Display range (nm). Default 40. */
  rangeNm?: number;
  maxThreats?: number;
  ownAltVar?: string;
  ownVsVar?: string;
  raVar?: string;
  headingVar?: string;
}

export class Tcas implements Subsystem {
  readonly name = 'tcas';
  readonly threats: TcasThreat[] = [];
  source: TrafficSource | undefined;
  private readonly vars: SimVars;
  private readonly audio: AudioApi | undefined;
  private readonly cfg: TcasConfig;
  private readonly power: () => boolean;
  private readonly pool: TcasThreat[];
  private readonly prevRange = new Map<string, number>();
  private acc = 0;
  private raActive = false;
  private taCount = 0;
  private readonly f = failVar('tcas');

  constructor(env: BlockEnv, cfg: TcasConfig = {}) {
    this.vars = env.vars;
    this.audio = env.audio;
    this.cfg = cfg;
    this.source = cfg.source;
    this.power = compileCondition(env.vars, cfg.power, true);
    const n = cfg.maxThreats ?? 30;
    this.pool = [];
    for (let i = 0; i < n; i++) this.pool.push({ id: '', relBrgDeg: 0, rangeNm: 0, relAltFt: 0, vsSign: 0, level: 0 });
  }

  failures(): FailureDef[] {
    return [{ id: 'tcas', name: 'TCAS', category: 'surveillance', description: 'TCAS FAIL: no traffic or advisories.' }];
  }

  /** Sensitivity row for own altitude MSL and height AGL. */
  static sensitivity(altMslFt: number, aglFt: number): SlRow {
    const t = TCAS_SENSITIVITY;
    if (aglFt < 1000) return t[0];
    if (aglFt < 2350) return t[1];
    if (altMslFt < 5000) return t[2];
    if (altMslFt < 10000) return t[3];
    if (altMslFt < 20000) return t[4];
    if (altMslFt < 42000) return t[5];
    return t[6];
  }

  update(dt: number): void {
    const v = this.vars;
    const mode = v.get(this.cfg.modeVar ?? NAV.xpdrMode);
    const failed = v.get(this.f) !== 0;
    const on = this.power() && (mode === 4 || mode === 5);
    v.setString('tcas.status', failed ? 'TCAS FAIL' : !on ? 'TCAS OFF' : mode === 4 ? 'TA ONLY' : 'TA/RA');
    if (!on || failed || !this.source) {
      this.threats.length = 0;
      this.setRa(false, 0);
      v.set('tcas.ta', 0);
      v.set('tcas.count', 0);
      return;
    }
    this.acc += dt;
    if (this.acc < 1) return; // surveillance update 1 Hz
    const period = this.acc;
    this.acc = 0;
    const ownLat = v.get(GPS.lat);
    const ownLon = v.get(GPS.lon);
    const ownAlt = v.get(this.cfg.ownAltVar ?? SENSOR_VARS.pressAlt(1));
    const ownVs = v.get(this.cfg.ownVsVar ?? ADC.vs(1));
    const agl = v.get(this.cfg.raVar ?? SENSOR_VARS.raAlt(1), 99999);
    const hdg = v.get(this.cfg.headingVar ?? ADC.heading(1)) + v.get(GPS.magVar);
    const sl = Tcas.sensitivity(ownAlt, agl);
    v.set('tcas.sl', mode === 4 ? 1 : sl.sl);
    const raAllowed = mode === 5 && sl.raTau > 0;
    const range = this.cfg.rangeNm ?? 40;
    this.threats.length = 0;
    if (this.prevRange.size > 500) this.prevRange.clear(); // bound memory with churning traffic ids
    let ta = 0;
    let raSense = 0;
    let raTarget = false;
    for (const t of this.source.targets()) {
      const r = distanceNm(ownLat, ownLon, t.lat, t.lon);
      if (r > range || this.threats.length >= this.pool.length) continue;
      const prev = this.prevRange.get(t.id);
      this.prevRange.set(t.id, r);
      const closure = prev !== undefined ? ((prev - r) / period) * 3600 : 0; // kt, + closing
      const rel = t.altFt - ownAlt;
      const vClose = Number.isFinite(rel) ? -(t.vsFpm - ownVs) * Math.sign(rel) : 0; // fpm, + closing
      const tauR = closure > 1 ? ((r - (sl.taDmod * sl.taDmod) / Math.max(r, 1e-3)) / closure) * 3600 : Infinity;
      const tauRRa = closure > 1 ? ((r - (sl.raDmod * sl.raDmod) / Math.max(r, 1e-3)) / closure) * 3600 : Infinity;
      const tauV = Number.isFinite(rel) && vClose > 0 ? (Math.abs(rel) / vClose) * 60 : Infinity;
      let level = r < 6 && (!Number.isFinite(rel) || Math.abs(rel) < 1200) ? 1 : 0;
      const taRange = tauR < sl.taTau || r < sl.taDmod;
      const taVert = !Number.isFinite(rel) || Math.abs(rel) < sl.taZthr || tauV < sl.taTau;
      if (taRange && taVert) level = 2;
      if (raAllowed && Number.isFinite(rel)) {
        const raRange = tauRRa < sl.raTau || r < sl.raDmod;
        const raVert = Math.abs(rel) < sl.raZthr || tauV < sl.raTau;
        if (raRange && raVert) {
          level = 3;
          raTarget = true;
          // Sense giving more separation at CPA (own aircraft 1500 fpm after a 5 s delay).
          const tCpa = Math.min(Number.isFinite(tauRRa) ? Math.max(tauRRa, 0) : 30, 60);
          const relAtCpa = rel + ((t.vsFpm - ownVs) * tCpa) / 60;
          const climbSep = relAtCpa - (1500 * Math.max(0, tCpa - 5)) / 60;
          const descSep = relAtCpa + (1500 * Math.max(0, tCpa - 5)) / 60;
          let sense = Math.abs(climbSep) >= Math.abs(descSep) ? 1 : -1;
          if (sense < 0 && agl < 1100) sense = 1; // descend RAs inhibited near the ground
          if (raSense === 0) raSense = sense;
        }
      }
      if (level === 2) ta++;
      const th = this.pool[this.threats.length];
      th.id = t.id;
      th.rangeNm = r;
      th.relAltFt = rel;
      th.vsSign = t.vsFpm > 500 ? 1 : t.vsFpm < -500 ? -1 : 0;
      th.level = level;
      const brg = initialBearing(ownLat, ownLon, t.lat, t.lon);
      th.relBrgDeg = ((((brg - hdg + 180) % 360) + 360) % 360) - 180;
      this.threats.push(th);
    }
    if (ta > this.taCount && !raTarget) this.audio?.callout('TRAFFIC, TRAFFIC', 6);
    this.taCount = ta;
    v.set('tcas.ta', ta);
    v.set('tcas.count', this.threats.length);
    this.setRa(raTarget, raSense);
  }

  private setRa(active: boolean, sense: number): void {
    const v = this.vars;
    if (active && !this.raActive) this.audio?.callout(sense > 0 ? 'CLIMB, CLIMB' : 'DESCEND, DESCEND', 9);
    if (!active && this.raActive) this.audio?.callout('CLEAR OF CONFLICT', 5);
    this.raActive = active;
    v.set('tcas.ra', active ? 1 : 0);
    v.set('tcas.ra_sense', active ? sense : 0);
    // Fly-to band: 1500–2000 fpm in the RA sense (v7.1 standard climb/descend RA).
    v.set('tcas.ra_vs_min_fpm', active ? (sense > 0 ? 1500 : -2000) : NaN);
    v.set('tcas.ra_vs_max_fpm', active ? (sense > 0 ? 2000 : -1500) : NaN);
  }
}
