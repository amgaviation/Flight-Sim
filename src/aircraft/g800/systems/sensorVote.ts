/**
 * G800 sensor selection (function fix round 1).
 *
 * FCC voting. The GVIII fly-by-wire uses triplex air data and inertial data (dossier §4.11: ADS 1/2/3,
 * IRS 1/2/3). A single sensor loss is voted out without a law change; ALTERNATE is entered only when
 * the necessary data are lost (BJT500: "alternate, direct and backup are entered only when the necessary
 * data are lost"). Here each FCC input is the median of the valid sources (mid-value select with three,
 * mean with two, the single value with one). The data are "OK" for NORMAL law with at least two valid
 * sources of each kind (2-of-3, EST: no public G800 voting threshold). Outputs `ac.g800.fcc.*`.
 *
 * FGC side selection. On the Primus Epic the coupled side's guidance computer uses that side's sensors
 * (standard dual-FGC architecture, EST: no G800 text): with PFD CMD on side 2 the AFCS reads ADC 2 /
 * IRS 2 / RA 2, so a side-1 sensor failure does not disconnect it. Outputs `ac.g800.fgc.*`.
 *
 * Runs after the sensors and before the AFCS / FBW. No allocation in update().
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import { ADC } from '../../../core/vars';
import { SENSOR_VARS } from '../../../systems/sensors/vars';
import { EPIC_VARS } from '../../../avionics/honeywell-epic/vars';

type Src = readonly [string, string, string];
const tri = (f: (s: number) => string): Src => [f(1), f(2), f(3)];

/** FCC (voted) sensor vars read by the FBW. */
export const FCC_SENSORS = {
  ias: 'ac.g800.fcc.ias_kt',
  mach: 'ac.g800.fcc.mach',
  aoa: 'ac.g800.fcc.aoa_deg',
  pressAlt: 'ac.g800.fcc.press_alt_ft',
  pitch: 'ac.g800.fcc.pitch_deg',
  bank: 'ac.g800.fcc.bank_deg',
  p: 'ac.g800.fcc.p_dps',
  q: 'ac.g800.fcc.q_dps',
  r: 'ac.g800.fcc.r_dps',
  nz: 'ac.g800.fcc.nz_g',
  ny: 'ac.g800.fcc.ny_g',
} as const;
/** 1 while at least 2 of 3 air data / inertial sources are valid. */
export const FCC_AIR_OK = 'ac.g800.fcc.air_ok';
export const FCC_IRS_OK = 'ac.g800.fcc.irs_ok';

/** Coupled-side (FGC) sensor vars read by the AFCS. */
export const FGC_SENSORS = {
  pitch: 'ac.g800.fgc.pitch_deg',
  bank: 'ac.g800.fgc.bank_deg',
  heading: 'ac.g800.fgc.hdg_deg',
  p: 'ac.g800.fgc.p_dps',
  q: 'ac.g800.fgc.q_dps',
  ias: 'ac.g800.fgc.ias_kt',
  mach: 'ac.g800.fgc.mach',
  tas: 'ac.g800.fgc.tas_kt',
  alt: 'ac.g800.fgc.alt_ft',
  vs: 'ac.g800.fgc.vs_fpm',
  ias_rate: 'ac.g800.fgc.ias_rate',
  ra: 'ac.g800.fgc.ra_ft',
} as const;
export const FGC_VALID = 'ac.g800.fgc.valid';
export const FGC_RA_VALID = 'ac.g800.fgc.ra_valid';

const AIR_IN: [keyof typeof FCC_SENSORS, Src][] = [
  ['ias', tri(ADC.ias)],
  ['mach', tri(ADC.mach)],
  ['aoa', tri(SENSOR_VARS.aoa)],
  ['pressAlt', tri(SENSOR_VARS.pressAlt)],
];
const IRS_IN: [keyof typeof FCC_SENSORS, Src][] = [
  ['pitch', tri(ADC.pitch)],
  ['bank', tri(ADC.bank)],
  ['p', tri(SENSOR_VARS.p)],
  ['q', tri(SENSOR_VARS.q)],
  ['r', tri(SENSOR_VARS.r)],
  ['nz', tri(SENSOR_VARS.nz)],
  ['ny', tri(SENSOR_VARS.ny)],
];
// FGC: [output, side-1 var, side-2 var]
const FGC_IN: [string, string, string][] = [
  [FGC_SENSORS.pitch, ADC.pitch(1), ADC.pitch(2)],
  [FGC_SENSORS.bank, ADC.bank(1), ADC.bank(2)],
  [FGC_SENSORS.heading, ADC.heading(1), ADC.heading(2)],
  [FGC_SENSORS.p, SENSOR_VARS.p(1), SENSOR_VARS.p(2)],
  [FGC_SENSORS.q, SENSOR_VARS.q(1), SENSOR_VARS.q(2)],
  [FGC_SENSORS.ias, ADC.ias(1), ADC.ias(2)],
  [FGC_SENSORS.mach, ADC.mach(1), ADC.mach(2)],
  [FGC_SENSORS.tas, ADC.tas(1), ADC.tas(2)],
  [FGC_SENSORS.alt, ADC.baroAlt(1), ADC.baroAlt(2)],
  [FGC_SENSORS.vs, ADC.vs(1), ADC.vs(2)],
  [FGC_SENSORS.ias_rate, SENSOR_VARS.iasRate(1), SENSOR_VARS.iasRate(2)],
  [FGC_SENSORS.ra, SENSOR_VARS.raAlt(1), SENSOR_VARS.raAlt(2)],
];

const bits = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);

/** Median of the valid entries of a (length 3) with validity mask bits (no allocation). */
export function voteMedian(a0: number, a1: number, a2: number, mask: number): number {
  const v0 = (mask & 1) !== 0;
  const v1 = (mask & 2) !== 0;
  const v2 = (mask & 4) !== 0;
  const n = (v0 ? 1 : 0) + (v1 ? 1 : 0) + (v2 ? 1 : 0);
  if (n === 3) return Math.max(Math.min(a0, a1), Math.min(Math.max(a0, a1), a2));
  if (n === 2) return v0 && v1 ? (a0 + a1) / 2 : v0 ? (a0 + a2) / 2 : (a1 + a2) / 2;
  if (n === 1) return v0 ? a0 : v1 ? a1 : a2;
  return a0; // nothing valid: side 1 (the FBW is in ALTERNATE / DIRECT then)
}

export class G800SensorVote implements Subsystem {
  readonly name = 'g800.sensor_vote';
  private readonly adcValid = tri(ADC.valid);
  private readonly attValid = tri(SENSOR_VARS.attValid);

  constructor(private readonly v: SimVars) {}

  update(): void {
    const v = this.v;
    let airMask = 0;
    let irsMask = 0;
    for (let i = 0; i < 3; i++) {
      if (v.get(this.adcValid[i]) !== 0) airMask |= 1 << i;
      if (v.get(this.attValid[i]) !== 0) irsMask |= 1 << i;
    }
    for (let k = 0; k < AIR_IN.length; k++) {
      const s = AIR_IN[k][1];
      v.set(FCC_SENSORS[AIR_IN[k][0]], voteMedian(v.get(s[0]), v.get(s[1]), v.get(s[2]), airMask));
    }
    for (let k = 0; k < IRS_IN.length; k++) {
      const s = IRS_IN[k][1];
      v.set(FCC_SENSORS[IRS_IN[k][0]], voteMedian(v.get(s[0]), v.get(s[1]), v.get(s[2]), irsMask));
    }
    v.set(FCC_AIR_OK, bits(airMask) >= 2 ? 1 : 0);
    v.set(FCC_IRS_OK, bits(irsMask) >= 2 ? 1 : 0);
    // Voted-sensor block health diagnostic (ac.g800.fcs_src, vars.ts): valid ADCs * 10 + valid IRSs
    // (fix round 1 F14: the declared var was never written).
    v.set('ac.g800.fcs_src', bits(airMask) * 10 + bits(irsMask));

    // Coupled side (PFD CMD): 1 or 2.
    const side2 = v.get(EPIC_VARS.coupleSide, 1) === 2;
    for (let k = 0; k < FGC_IN.length; k++) v.set(FGC_IN[k][0], v.get(side2 ? FGC_IN[k][2] : FGC_IN[k][1]));
    v.set(FGC_VALID, v.get(side2 ? 'ahrs2.valid' : 'ahrs1.valid') !== 0 && v.get(side2 ? 'adc2.valid' : 'adc1.valid') !== 0 ? 1 : 0);
    v.set(FGC_RA_VALID, v.get(side2 ? 'ra2.valid' : 'ra1.valid'));
  }
}
