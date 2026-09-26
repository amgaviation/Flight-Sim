/**
 * Minimal kinematic aircraft for LNAV tests: coordinated turns from a bank
 * angle that follows the FMS roll command with a roll-rate limit, constant
 * speed, no wind. Publishes the GPS/ADC/AHRS vars the FMS reads.
 */
import { SimVars } from '../../src/core/SimVars';
import { ADC, FMS, GPS } from '../../src/core/vars';
import { destinationPoint } from '../../src/core/geo';

const G = 9.80665;

export interface SimInit {
  lat: number;
  lon: number;
  hdgTrue: number;
  gsKt: number;
  altFt?: number;
  vsFpm?: number;
  magVar?: number;
  rollRateDegS?: number;
}

export class KinematicAircraft {
  lat: number;
  lon: number;
  hdg: number;
  gs: number;
  alt: number;
  vs: number;
  bank = 0;
  readonly magVar: number;
  readonly rollRate: number;
  private readonly out = { lat: 0, lon: 0 };

  constructor(
    readonly vars: SimVars,
    init: SimInit,
  ) {
    this.lat = init.lat;
    this.lon = init.lon;
    this.hdg = init.hdgTrue;
    this.gs = init.gsKt;
    this.alt = init.altFt ?? 5000;
    this.vs = init.vsFpm ?? 0;
    this.magVar = init.magVar ?? 0;
    this.rollRate = init.rollRateDegS ?? 5;
    this.publish();
  }

  publish(): void {
    const v = this.vars;
    v.set(GPS.valid, 1);
    v.set(GPS.lat, this.lat);
    v.set(GPS.lon, this.lon);
    v.set(GPS.gs, this.gs);
    v.set(GPS.trackTrue, ((this.hdg % 360) + 360) % 360);
    v.set(GPS.magVar, this.magVar);
    v.set(GPS.alt, this.alt);
    v.set(GPS.sbas, 1);
    v.set(ADC.baroAlt(1), this.alt);
    v.set(ADC.heading(1), (((this.hdg - this.magVar) % 360) + 360) % 360);
  }

  /** Follows `fms.lnav_bank_cmd_deg` (or `bankCmd` when given) and moves. */
  step(dt: number, bankCmd?: number): void {
    const cmd = bankCmd ?? this.vars.get(FMS.lnavBankCmd);
    const d = cmd - this.bank;
    const max = this.rollRate * dt;
    this.bank += Math.max(-max, Math.min(max, d));
    const v = this.gs * (1852 / 3600);
    const rate = ((G * Math.tan((this.bank * Math.PI) / 180)) / v) * (180 / Math.PI);
    this.hdg = (((this.hdg + rate * dt) % 360) + 360) % 360;
    destinationPoint(this.lat, this.lon, this.hdg, (this.gs * dt) / 3600, this.out);
    this.lat = this.out.lat;
    this.lon = this.out.lon;
    this.alt += (this.vs / 60) * dt;
    this.publish();
  }
}
