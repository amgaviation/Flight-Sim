/**
 * Reversion Switch Panel (RSP-6200) source selection.
 *
 * FAA FSB report BD-700-1A10 Rev 7 appendix 6: "Revision Switch Panel
 * differs in layout and functionality"; "AFCS 1-2 switch relocated to
 * reversion switch panel (RSP)"; checking emphasis on "Control panels: CTP,
 * ACP, Reversionary Selection Panel (RSP), CNS, MKP, and CCP". Collins
 * course syllabus 523-0817473: RSP-6200 Reversion Switch Panel, ADS / AHS
 * "Reversionary modes".
 *
 * EST switch set per pilot RSP: ADC (NORM / X-SIDE / STBY), ATT-HDG
 * (NORM / IRS 3), DSPL (NORM / REV); AFCS 1 / 2 on the pilot's panel. The
 * PFD annunciates any non-normal source in amber (Global Express PFD shows
 * "ATT2 ADC1"; FSB: "Color changes for non-normal navigation sources").
 */
import type { SimVars } from '../../../core/SimVars';
import { FUSION_VARS } from '../vars';
import type { FusionSensors } from '../config';

export interface SideSources {
  adc: number;
  ahrs: number;
  ra: number;
  /** Non-normal (cross-side / standby / IRS 3) selections for the amber source annunciations. */
  adcReverted: boolean;
  ahrsReverted: boolean;
}

export class SourceSelector {
  readonly sides: [SideSources, SideSources];
  private readonly names: { adcRsp: string; attRsp: string; adcOut: string; ahrsOut: string; raOut: string }[];

  constructor(
    private readonly vars: SimVars,
    private readonly sensors: FusionSensors,
  ) {
    this.sides = [
      { adc: sensors.adc[0], ahrs: sensors.ahrs[0], ra: sensors.ra[0], adcReverted: false, ahrsReverted: false },
      { adc: sensors.adc[1], ahrs: sensors.ahrs[1], ra: sensors.ra[1], adcReverted: false, ahrsReverted: false },
    ];
    this.names = [1, 2].map((s) => ({
      adcRsp: FUSION_VARS.rspAdc(s),
      attRsp: FUSION_VARS.rspAtt(s),
      adcOut: FUSION_VARS.adcSrc(s),
      ahrsOut: FUSION_VARS.ahrsSrc(s),
      raOut: FUSION_VARS.raSrc(s),
    }));
    for (const s of [1, 2]) {
      if (!vars.has(FUSION_VARS.rspAdc(s))) vars.set(FUSION_VARS.rspAdc(s), 0);
      if (!vars.has(FUSION_VARS.rspAtt(s))) vars.set(FUSION_VARS.rspAtt(s), 0);
      if (!vars.has(FUSION_VARS.rspDspl(s))) vars.set(FUSION_VARS.rspDspl(s), 0);
    }
    if (!vars.has(FUSION_VARS.rspAfcs)) vars.set(FUSION_VARS.rspAfcs, 1);
    this.update();
  }

  update(): void {
    const v = this.vars;
    const sn = this.sensors;
    for (let i = 0; i < 2; i++) {
      const n = this.names[i];
      const out = this.sides[i];
      const a = v.get(n.adcRsp);
      out.adc = a >= 1.5 ? sn.standbyAdc : a >= 0.5 ? sn.adc[1 - i] : sn.adc[i];
      out.adcReverted = a >= 0.5;
      const t = v.get(n.attRsp);
      out.ahrs = t >= 0.5 ? sn.thirdAhrs : sn.ahrs[i];
      out.ahrsReverted = t >= 0.5;
      out.ra = sn.ra[i];
      v.set(n.adcOut, out.adc);
      v.set(n.ahrsOut, out.ahrs);
      v.set(n.raOut, out.ra);
    }
  }
}
