/**
 * GPS / SBAS receiver. After power-up it takes `acquisitionS` seconds to a
 * first fix (shorter warm start after a brief power interruption), then
 * publishes position, ground speed, track and altitude every update.
 *
 * GPS position and ground speed are the documented exception to "avionics
 * never read fdm.*" (CLAUDE.md): the receiver copies FDM truth.
 * SCOPE: no satellite geometry, RAIM prediction or position noise; `gps.fail`
 * removes the solution (satellite loss / receiver failure). Satellite count
 * and EPU are nominal constants.
 *
 * EST acquisition: cold start 45 s, warm start (power off < 10 min) 15 s:
 * typical of TSO-C145/C146 receivers (Garmin GIA 63W/GTN specify a first fix
 * within about a minute from cold, seconds when warm).
 */
import type { SimVars } from '../../core/SimVars';
import { ENV, FDM, GPS } from '../../core/vars';
import { wrap360 } from '../../core/math';
import { magneticDeclination } from '../../core/wmm';

export interface GpsReceiverOptions {
  /** Cold-start time to first fix (s), EST 45. */
  acquisitionS?: number;
  /** Warm-start time (s), EST 15, used when power returns within `warmWindowS`. */
  warmAcquisitionS?: number;
  warmWindowS?: number;
  /** SBAS (WAAS) capable receiver (default true). */
  sbas?: boolean;
  /** Decimal year for the magnetic model (default: derived from env.day_of_year, else 2026.5). */
  magVarYear?: number;
}

/** EST nominal constellation values while valid. */
const NOMINAL_SATS = 10;
const EPU_SBAS_NM = 0.01;
const EPU_GPS_NM = 0.05;
/** Below this ground speed the track is held (GPS track is undefined when stationary). */
const TRACK_HOLD_GS_KT = 3;
const MAGVAR_INTERVAL_S = 2;

export class GpsReceiver {
  private readonly vars: SimVars;
  private readonly coldS: number;
  private readonly warmS: number;
  private readonly warmWindow: number;
  private readonly sbas: boolean;
  private readonly year: number;
  private acquire = NaN;
  private offFor = Infinity;
  private magVar = 0;
  private magTimer = MAGVAR_INTERVAL_S;
  private track = 0;
  private valid = false;

  constructor(vars: SimVars, opts: GpsReceiverOptions = {}) {
    this.vars = vars;
    this.coldS = opts.acquisitionS ?? 45;
    this.warmS = opts.warmAcquisitionS ?? 15;
    this.warmWindow = opts.warmWindowS ?? 600;
    this.sbas = opts.sbas ?? true;
    this.year = opts.magVarYear ?? 2026.5;
    this.writeInvalid(NaN);
  }

  /** Instantly acquires (e.g. after loading a 'cruise' state preset). */
  forceAcquired(): void {
    this.acquire = 0;
    this.offFor = 0;
  }

  reset(): void {
    this.magTimer = MAGVAR_INTERVAL_S;
  }

  private writeInvalid(acqRemaining: number): void {
    const v = this.vars;
    v.set(GPS.valid, 0);
    v.set(GPS.sats, 0);
    v.set(GPS.sbas, 0);
    v.set(GPS.acquireS, Number.isFinite(acqRemaining) ? Math.max(0, acqRemaining) : 0);
    this.valid = false;
  }

  update(dt: number): void {
    const v = this.vars;
    const powered = v.getBool(GPS.powered);
    if (!powered) {
      this.offFor += dt;
      this.acquire = NaN;
      this.writeInvalid(NaN);
      return;
    }
    if (Number.isNaN(this.acquire)) {
      this.acquire = this.offFor <= this.warmWindow ? this.warmS : this.coldS;
      this.offFor = 0;
    }
    if (this.acquire > 0) this.acquire -= dt;
    if (this.acquire > 0 || v.getBool(GPS.fail)) {
      this.writeInvalid(this.acquire);
      return;
    }
    const lat = v.get(FDM.lat);
    const lon = v.get(FDM.lon);
    const gs = v.get(FDM.gs);
    this.magTimer += dt;
    if (this.magTimer >= MAGVAR_INTERVAL_S || !this.valid) {
      this.magTimer = 0;
      const doy = v.get(ENV.dayOfYear, 0);
      const year = doy > 0 ? Math.floor(this.year) + doy / 365.25 : this.year;
      this.magVar = magneticDeclination(lat, lon, v.get(FDM.altMsl) * 0.3048, year);
    }
    if (gs >= TRACK_HOLD_GS_KT || !this.valid) this.track = v.get(FDM.trackTrue);
    v.set(GPS.lat, lat);
    v.set(GPS.lon, lon);
    v.set(GPS.alt, v.get(FDM.altMsl));
    v.set(GPS.gs, gs);
    v.set(GPS.trackTrue, this.track);
    v.set(GPS.trackMag, wrap360(this.track - this.magVar));
    v.set(GPS.vs, v.get(FDM.vs));
    v.set(GPS.magVar, this.magVar);
    v.set(GPS.sats, NOMINAL_SATS);
    v.set(GPS.sbas, this.sbas ? 1 : 0);
    v.set(GPS.epuNm, this.sbas ? EPU_SBAS_NM : EPU_GPS_NM);
    v.set(GPS.acquireS, 0);
    v.set(GPS.utcH, v.get(ENV.timeUtcHours));
    v.set(GPS.valid, 1);
    this.valid = true;
  }
}
