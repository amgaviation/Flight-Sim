/**
 * VHF navigation receiver (VOR / localizer + paired glideslope and DME), one
 * instance per `nav{r}`. Driven by the aircraft through `nav{r}.active_mhz`,
 * `nav{r}.obs_deg`, `nav{r}.powered` and `nav{r}.dme_hold`; writes every
 * `nav{r}.*` output listed in docs/modules/nav.md.
 *
 * The receiver measures the real signal geometry, so it reads the aircraft
 * position from FDM truth (`fdm.lat_deg`, `fdm.lon_deg`, `fdm.alt_msl_ft`),
 * like an antenna would.
 *
 * Behaviour modelled:
 *   - reception: service range x `rangeFactor` and radio line of sight;
 *     strongest station wins when several share a frequency;
 *   - receiver settling after a frequency change (flag for 0.5 s, EST) and
 *     DME search/lock time (1.5 s, EST: KN-62A / KDI-572 lock in 1-2 s);
 *   - VOR: radials referenced to the station declination, +/-10 deg CDI,
 *     TO/FROM with an ambiguity band abeam, cone of confusion overhead
 *     (EST: flag within 45 deg of vertical);
 *   - localizer: published or 700-ft-at-threshold course width, ICAO
 *     coverage sectors, back course (reverse sensing), flag outside coverage;
 *   - glideslope: null-reference antenna model (false paths, carrier nulls),
 *     +/-8 deg azimuth and 10 nm x rangeFactor coverage, curvature;
 *   - DME: slant range, ground speed and time-to-station from the range rate,
 *     DME HOLD.
 */
import type { SimVars } from '../../core/SimVars';
import { FDM, NAV } from '../../core/vars';
import { clamp, wrap360 } from '../../core/math';
import { distanceNm, initialBearing } from '../../core/geo';
import type { Navaid } from '../types';
import type { StationSource } from './stationSource';
import {
  FT_PER_NM,
  glidePathAbeamAlongNm,
  glidePathAzimuthDeg,
  glideslope,
  isLocalizerFrequency,
  locCourseWidthDeg,
  locCoverageNm,
  locDeviation,
  radioLineOfSightNm,
  slantRangeNm,
  vorCdi,
  vorRadial,
  type GsSignal,
  type LocDeviation,
  type VorCdi,
} from './geometry';
import { morse } from './morse';

export interface NavReceiverOptions {
  /** Multiplier on the published service volume radius for usable reception (EST default 1.25: signals extend beyond the protected SSV). */
  rangeFactor?: number;
  /** Seconds between station re-searches on an unchanged frequency (default 5). */
  retuneIntervalS?: number;
  /** Ground station antenna height above its site (ft), EST 15 ft (VOR counterpoise / localizer array height). */
  stationAntennaFt?: number;
  /** Receiver settling time after a frequency change (s), EST 0.5. */
  settleS?: number;
  /** DME search-to-lock time after a channel change (s), EST 1.5. */
  dmeLockS?: number;
  /** VOR cone of confusion half-angle from the vertical (deg), EST 45. */
  coneHalfAngleDeg?: number;
  /** Glideslope carrier strength below which the GS flag shows (EST 0.2). */
  gsCarrierMin?: number;
}

const SEARCH_RADIUS_NM = 300;
/** DME ground speed filter time constant (s). EST: typical DME GS display lag. */
const DME_GS_TAU_S = 3;

export class NavReceiver {
  readonly index: number;
  private readonly vars: SimVars;
  private readonly src: StationSource;
  private readonly rangeFactor: number;
  private readonly retuneInterval: number;
  private readonly antennaFt: number;
  private readonly settleS: number;
  private readonly dmeLockS: number;
  private readonly coneElevDeg: number;
  private readonly gsCarrierMin: number;

  // var names (precomputed: no string building per step)
  private readonly vFreq: string;
  private readonly vObs: string;
  private readonly vPowered: string;
  private readonly vDmeHold: string;
  private readonly vReceived: string;
  private readonly vIsLoc: string;
  private readonly vRadial: string;
  private readonly vCdi: string;
  private readonly vToFrom: string;
  private readonly vGsValid: string;
  private readonly vGsDev: string;
  private readonly vDmeValid: string;
  private readonly vDmeNm: string;
  private readonly vLocCourse: string;
  private readonly vIdent: string;
  private readonly vBearing: string;
  private readonly vStationMagVar: string;
  private readonly vSignal: string;
  private readonly vDevDeg: string;
  private readonly vGsDevDeg: string;
  private readonly vBackCourse: string;
  private readonly vDistNm: string;
  private readonly vBearingValid: string;
  private readonly vMorse: string;
  private readonly vStationType: string;
  private readonly vDmeIdent: string;
  private readonly vDmeGs: string;
  private readonly vDmeTts: string;

  // state
  private readonly cands: Navaid[] = [];
  private readonly dmeCands: Navaid[] = [];
  private tunedFreq = NaN;
  private dmeTunedFreq = NaN;
  private heldFreq = NaN;
  private searchTimer = 0;
  private settle = 0;
  private dmeLock = 0;
  private off = false;
  private lastDmeRange = NaN;
  private dmeGsFilt = 0;
  private lastDmeStation: Navaid | null = null;
  private readonly vor: VorCdi = { devDeg: 0, cdi: 0, toFrom: 0 };
  private readonly loc: LocDeviation = { devDeg: 0, offCourseDeg: 0, backCourse: false, distNm: 0 };
  private readonly gs: GsSignal = { elevationDeg: 0, dev: 0, devDeg: 0, carrier: 0, azimuthOffDeg: 0, distNm: 0 };
  /** Glide path centre-line origin (along-course nm from the LOC antenna) of `gsAbeamFor`, cached per station pair. */
  private gsAbeamAlongNm = 0;
  private gsAbeamFor: Navaid | null = null;
  private gsAbeamLoc: Navaid | null = null;

  /** Station currently received for azimuth (VOR or localizer), if any. */
  station: Navaid | null = null;
  /** Glideslope transmitter paired with the received localizer, if any. */
  glideslopeStation: Navaid | null = null;
  /** DME station being received, if any. */
  dmeStation: Navaid | null = null;

  constructor(vars: SimVars, src: StationSource, index: number, opts: NavReceiverOptions = {}) {
    this.vars = vars;
    this.src = src;
    this.index = index;
    this.rangeFactor = opts.rangeFactor ?? 1.25;
    this.retuneInterval = opts.retuneIntervalS ?? 5;
    this.antennaFt = opts.stationAntennaFt ?? 15;
    this.settleS = opts.settleS ?? 0.5;
    this.dmeLockS = opts.dmeLockS ?? 1.5;
    this.coneElevDeg = 90 - (opts.coneHalfAngleDeg ?? 45);
    this.gsCarrierMin = opts.gsCarrierMin ?? 0.2;
    const r = index;
    this.vFreq = NAV.activeFreq(r);
    this.vObs = NAV.obs(r);
    this.vPowered = NAV.powered(r);
    this.vDmeHold = NAV.dmeHold(r);
    this.vReceived = NAV.received(r);
    this.vIsLoc = NAV.isLoc(r);
    this.vRadial = NAV.radial(r);
    this.vCdi = NAV.cdi(r);
    this.vToFrom = NAV.toFrom(r);
    this.vGsValid = NAV.gsValid(r);
    this.vGsDev = NAV.gsDev(r);
    this.vDmeValid = NAV.dmeValid(r);
    this.vDmeNm = NAV.dmeNm(r);
    this.vLocCourse = NAV.locCourse(r);
    this.vIdent = NAV.ident(r);
    this.vBearing = NAV.bearing(r);
    this.vStationMagVar = NAV.stationMagVar(r);
    this.vSignal = NAV.signal(r);
    this.vDevDeg = NAV.devDeg(r);
    this.vGsDevDeg = NAV.gsDevDeg(r);
    this.vBackCourse = NAV.backCourse(r);
    this.vDistNm = NAV.distNm(r);
    this.vBearingValid = NAV.bearingValid(r);
    this.vMorse = NAV.morse(r);
    this.vStationType = NAV.stationType(r);
    this.vDmeIdent = NAV.dmeIdent(r);
    this.vDmeGs = NAV.dmeGs(r);
    this.vDmeTts = NAV.dmeTts(r);
    this.writeOff();
  }

  /** Forces a station search on the next update (after a reposition or database load). */
  reset(): void {
    this.tunedFreq = NaN;
    this.dmeTunedFreq = NaN;
    this.lastDmeRange = NaN;
    this.dmeGsFilt = 0;
  }

  private writeOff(): void {
    const v = this.vars;
    v.set(this.vReceived, 0);
    v.set(this.vIsLoc, 0);
    v.set(this.vCdi, 0);
    v.set(this.vDevDeg, 0);
    v.set(this.vToFrom, 0);
    v.set(this.vGsValid, 0);
    v.set(this.vGsDev, 0);
    v.set(this.vGsDevDeg, 0);
    v.set(this.vDmeValid, 0);
    v.set(this.vBearingValid, 0);
    v.set(this.vSignal, 0);
    v.set(this.vBackCourse, 0);
    v.set(this.vDmeGs, 0);
    v.set(this.vDmeTts, 0);
    v.setString(this.vIdent, '');
    v.setString(this.vMorse, '');
    v.setString(this.vStationType, '');
    v.setString(this.vDmeIdent, '');
    this.station = null;
    this.glideslopeStation = null;
    this.dmeStation = null;
  }

  /** Coverage-limited signal quality 0..1 of a VOR/DME/NDB-type station. */
  private stationSignal(n: Navaid, lat: number, lon: number, altFt: number, useDme: boolean): number {
    const sLat = useDme && n.dmeLat !== undefined ? n.dmeLat : n.lat;
    const sLon = useDme && n.dmeLon !== undefined ? n.dmeLon : n.lon;
    const d = distanceNm(lat, lon, sLat, sLon);
    const range = Math.max(1, n.rangeNm) * this.rangeFactor;
    const los = radioLineOfSightNm(altFt - n.elevationFt, this.antennaFt);
    if (d > range || d > los) return 0;
    const q = d / range;
    return Math.max(0.01, 1 - q * q);
  }

  private locSignal(n: Navaid, lat: number, lon: number, altFt: number): number {
    const dev = locDeviation(n.lat, n.lon, n.courseTrue ?? 0, lat, lon, this.loc);
    // EST: back-course coverage 60 % of the front sector (smaller rear lobe).
    const cov = locCoverageNm(dev.offCourseDeg) * (dev.backCourse ? 0.6 : 1) * (this.rangeFactor / 1.25);
    const los = radioLineOfSightNm(altFt - n.elevationFt, this.antennaFt);
    if (dev.distNm > cov || dev.distNm > los) return 0;
    const q = dev.distNm / cov;
    return Math.max(0.01, 1 - q * q);
  }

  update(dt: number): void {
    const v = this.vars;
    if (!v.getBool(this.vPowered)) {
      if (!this.off) this.writeOff();
      this.off = true;
      this.tunedFreq = NaN;
      return;
    }
    if (this.off) {
      // Power-up: re-search and settle like a retune.
      this.off = false;
      this.tunedFreq = NaN;
    }
    const lat = v.get(FDM.lat);
    const lon = v.get(FDM.lon);
    const alt = v.get(FDM.altMsl);
    const freq = v.get(this.vFreq);

    // ---- tuning / station search
    this.searchTimer += dt;
    if (freq !== this.tunedFreq) {
      this.tunedFreq = freq;
      this.settle = this.settleS;
      this.searchTimer = this.retuneInterval; // force a search now
    }
    if (this.searchTimer >= this.retuneInterval) {
      this.searchTimer = 0;
      this.src.onFreq(freq, lat, lon, SEARCH_RADIUS_NM, this.cands);
    }
    if (this.settle > 0) this.settle -= dt;
    const hold = v.getBool(this.vDmeHold);
    if (!hold) this.heldFreq = freq;
    const dmeFreq = hold ? this.heldFreq : freq;
    if (dmeFreq !== this.dmeTunedFreq) {
      this.dmeTunedFreq = dmeFreq;
      this.dmeLock = this.dmeLockS;
      this.lastDmeRange = NaN;
      this.dmeGsFilt = 0;
      if (dmeFreq !== freq) this.src.onFreq(dmeFreq, lat, lon, SEARCH_RADIUS_NM, this.dmeCands);
    } else if (dmeFreq !== freq && this.searchTimer === 0) {
      this.src.onFreq(dmeFreq, lat, lon, SEARCH_RADIUS_NM, this.dmeCands);
    }
    if (this.dmeLock > 0) this.dmeLock -= dt;

    const isLocFreq = isLocalizerFrequency(freq);
    v.set(this.vIsLoc, isLocFreq ? 1 : 0);

    // ---- azimuth station
    let best: Navaid | null = null;
    let bestSig = 0;
    for (let i = 0; i < this.cands.length; i++) {
      const n = this.cands[i];
      let sig = 0;
      if (isLocFreq) {
        if (n.type !== 'ILS' && n.type !== 'LOC') continue;
        sig = this.locSignal(n, lat, lon, alt);
      } else {
        if (n.type !== 'VOR' && n.type !== 'VORDME' && n.type !== 'VORTAC') continue;
        sig = this.stationSignal(n, lat, lon, alt, false);
      }
      if (sig > bestSig) {
        bestSig = sig;
        best = n;
      }
    }
    this.station = best;
    const settled = this.settle <= 0;
    let received = false;
    if (best && settled) {
      received = isLocFreq ? this.updateLocalizer(best, lat, lon) : this.updateVor(best, lat, lon, alt);
    }
    if (!received) {
      v.set(this.vReceived, 0);
      v.set(this.vBearingValid, 0);
      v.set(this.vBackCourse, 0);
      if (!best) {
        v.set(this.vToFrom, 0);
        v.set(this.vCdi, 0);
        v.set(this.vDevDeg, 0);
      }
    }
    v.set(this.vSignal, received ? bestSig : 0);
    v.setString(this.vIdent, received && best ? best.ident : '');
    v.setString(this.vMorse, received && best ? morse(best.ident) : '');
    v.setString(this.vStationType, received && best ? best.type : '');

    // ---- glideslope
    this.glideslopeStation = null;
    let gsValid = false;
    if (received && best && isLocFreq) {
      for (let i = 0; i < this.cands.length; i++) {
        const n = this.cands[i];
        if (n.type === 'GS' && n.airport === best.airport && n.runway === best.runway) {
          this.glideslopeStation = n;
          break;
        }
      }
      const g = this.glideslopeStation;
      if (g) {
        const s = glideslope(g.lat, g.lon, g.elevationFt, g.gsAngleDeg ?? 3, g.courseTrue ?? best.courseTrue ?? 0, lat, lon, alt, this.gs);
        const los = radioLineOfSightNm(alt - g.elevationFt, this.antennaFt);
        if (this.gsAbeamFor !== g || this.gsAbeamLoc !== best) {
          this.gsAbeamFor = g;
          this.gsAbeamLoc = best;
          this.gsAbeamAlongNm = glidePathAbeamAlongNm(best.lat, best.lon, best.courseTrue ?? 0, g.lat, g.lon);
        }
        // ICAO Annex 10 3.1.5.3.1: +/-8 deg azimuth about the glide path centre line (this.loc was
        // just computed for `best` by updateLocalizer), 10 nm (x rangeFactor); carrier nulls flag the GS.
        const az = glidePathAzimuthDeg(this.loc.devDeg, this.loc.distNm, this.gsAbeamAlongNm);
        gsValid = !this.loc.backCourse && az <= 8 && s.distNm <= 10 * this.rangeFactor && s.distNm <= los && s.carrier >= this.gsCarrierMin && s.elevationDeg > 0;
        if (gsValid) {
          v.set(this.vGsDev, s.dev);
          v.set(this.vGsDevDeg, s.devDeg);
        }
      }
    }
    v.set(this.vGsValid, gsValid ? 1 : 0);
    if (!gsValid) {
      v.set(this.vGsDev, 0);
      v.set(this.vGsDevDeg, 0);
    }

    // ---- DME
    this.updateDme(dt, hold, isLocFreq ? best : received ? best : null, lat, lon, alt);
  }

  private updateVor(n: Navaid, lat: number, lon: number, alt: number): boolean {
    const v = this.vars;
    const dNm = distanceNm(n.lat, n.lon, lat, lon);
    v.set(this.vDistNm, dNm);
    // Cone of confusion: no usable azimuth close to overhead.
    const elev = (Math.atan2(alt - n.elevationFt, Math.max(1, dNm * FT_PER_NM)) * 180) / Math.PI;
    if (elev > this.coneElevDeg) {
      v.set(this.vToFrom, 0);
      return false;
    }
    const radial = vorRadial(n.lat, n.lon, n.magVar, lat, lon);
    const obs = v.get(this.vObs);
    vorCdi(radial, obs, this.vor);
    v.set(this.vReceived, 1);
    v.set(this.vRadial, radial);
    v.set(this.vCdi, this.vor.cdi);
    v.set(this.vDevDeg, this.vor.devDeg);
    v.set(this.vToFrom, this.vor.toFrom);
    v.set(this.vBearing, wrap360(radial + 180));
    v.set(this.vStationMagVar, n.magVar);
    v.set(this.vBearingValid, 1);
    v.set(this.vBackCourse, 0);
    return true;
  }

  private updateLocalizer(n: Navaid, lat: number, lon: number): boolean {
    const v = this.vars;
    const course = n.courseTrue ?? 0;
    const dev = locDeviation(n.lat, n.lon, course, lat, lon, this.loc);
    let locToThr = NaN;
    if (n.thresholdLat !== undefined && n.thresholdLon !== undefined) locToThr = distanceNm(n.lat, n.lon, n.thresholdLat, n.thresholdLon);
    const half = locCourseWidthDeg(locToThr, n.courseWidthDeg) / 2;
    v.set(this.vReceived, 1);
    v.set(this.vDistNm, dev.distNm);
    v.set(this.vDevDeg, dev.devDeg);
    v.set(this.vCdi, clamp(dev.devDeg / half, -1, 1));
    v.set(this.vToFrom, 1);
    v.set(this.vBackCourse, dev.backCourse ? 1 : 0);
    v.set(this.vLocCourse, wrap360(course - n.magVar));
    v.set(this.vStationMagVar, n.magVar);
    v.set(this.vRadial, wrap360(initialBearing(n.lat, n.lon, lat, lon) - n.magVar));
    v.set(this.vBearingValid, 0);
    return true;
  }

  private updateDme(dt: number, hold: boolean, azimuthStation: Navaid | null, lat: number, lon: number, alt: number): void {
    const v = this.vars;
    // Pick the DME: paired with the received station, else any DME-capable station on the (held) channel.
    let dme: Navaid | null = null;
    let dLat = 0;
    let dLon = 0;
    let dElev = 0;
    const list = hold && this.dmeTunedFreq !== this.tunedFreq ? this.dmeCands : this.cands;
    if (!hold && azimuthStation) {
      if (azimuthStation.type === 'ILS' || azimuthStation.type === 'LOC') {
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          if (n.type === 'DME' && n.airport === azimuthStation.airport && n.runway === azimuthStation.runway) {
            dme = n;
            break;
          }
        }
      } else if (azimuthStation.hasDme) {
        dme = azimuthStation;
      }
    }
    if (!dme) {
      let bestSig = 0;
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (!n.hasDme || n.type === 'LOC' || n.type === 'ILS' || n.type === 'GS') continue;
        const sig = this.stationSignal(n, lat, lon, alt, true);
        if (sig > bestSig) {
          bestSig = sig;
          dme = n;
        }
      }
    }
    if (dme) {
      dLat = dme.dmeLat ?? dme.lat;
      dLon = dme.dmeLon ?? dme.lon;
      dElev = dme.dmeElevationFt ?? dme.elevationFt;
      const d = distanceNm(lat, lon, dLat, dLon);
      // DME: 199 nm max (AIM 1-1-7 b), service volume x factor, line of sight.
      const range = Math.min(199, Math.max(dme.rangeNm, 25) * this.rangeFactor);
      if (d > range || d > radioLineOfSightNm(alt - dElev, this.antennaFt)) dme = null;
    }
    if (dme !== this.lastDmeStation) {
      this.lastDmeStation = dme;
      this.lastDmeRange = NaN;
      this.dmeGsFilt = 0;
      if (dme) this.dmeLock = Math.max(this.dmeLock, this.dmeLockS);
    }
    this.dmeStation = dme;
    if (!dme || this.dmeLock > 0) {
      v.set(this.vDmeValid, 0);
      v.set(this.vDmeGs, 0);
      v.set(this.vDmeTts, 0);
      v.setString(this.vDmeIdent, '');
      return;
    }
    const range = slantRangeNm(lat, lon, alt, dLat, dLon, dElev);
    if (Number.isFinite(this.lastDmeRange) && dt > 0) {
      const closing = ((this.lastDmeRange - range) / dt) * 3600;
      this.dmeGsFilt += (closing - this.dmeGsFilt) * Math.min(1, dt / DME_GS_TAU_S);
    }
    this.lastDmeRange = range;
    v.set(this.vDmeValid, 1);
    v.set(this.vDmeNm, range);
    v.set(this.vDmeGs, Math.abs(this.dmeGsFilt));
    v.set(this.vDmeTts, this.dmeGsFilt > 30 ? (range / this.dmeGsFilt) * 60 : 0);
    v.setString(this.vDmeIdent, dme.ident);
  }
}
