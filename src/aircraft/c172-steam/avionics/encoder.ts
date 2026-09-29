/**
 * Blind altitude encoder of the NAV II 172S (POH 172SPHUS Supplement 2 "KT 76C Transponder with Blind
 * Encoder"; Supplement 15 Sec 3 "Loss of Blind Altitude Encoder -- Altitude Alerter and Altitude Preselect
 * function inoperative").
 *
 * One encoder on the static system feeds both the KT 76C (Mode C reply, altitude display) and the KAP 140
 * altitude alerter / preselect. It publishes:
 *  - ENC.valid: 1 once powered, warmed up and not failed;
 *  - ENC.altFt: pressure altitude (29.92 inHg) of the pneumatic static source; a blocked static port traps
 *    the pressure, so the encoder then reports the trapped altitude like the altimeter;
 *  - ENC.gillhamHft: the Gillham-coded altitude in 100 ft increments (-9999 when invalid).
 *
 * Power: EST on the XPNDR breaker (avionics bus 2): the blind encoder is part of the transponder
 * installation (Supplement 2) and the POH Fig 7-7A lists no separate encoder breaker.
 * Warm-up: EST 60 s; Supplement 15 Fig 3 item 4 NOTE: the display may be dashed "for up to 3 minutes on
 * start up if a blind encoder is installed" (heated encoders warm up faster in a temperate cabin).
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import type { FailureDef } from '../../../systems/failures';
import { SENSOR_VARS } from '../../../systems/sensors/vars';
import { ENC } from '../vars';

export const ENCODER_FAIL = 'c172s.encoder';
/** EST encoder warm-up (s), see the header. */
export const ENCODER_WARMUP_S = 60;

export class BlindEncoder implements Subsystem {
  readonly name = 'blind-encoder';
  private warmT = 0;
  private wasOn = false;
  private readonly failVar = `fail.${ENCODER_FAIL}`;

  constructor(
    private readonly vars: SimContext['vars'],
    private readonly powerVar: string,
  ) {}

  failures(): FailureDef[] {
    return [
      {
        id: ENCODER_FAIL,
        name: 'Blind altitude encoder',
        category: 'avionics',
        description: 'No altitude data: KT 76C altitude dashed and no Mode C; KAP 140 altitude alerter and preselect inoperative (Supplement 15 Sec 3).',
      },
    ];
  }

  get valid(): boolean {
    return this.vars.get(ENC.valid) > 0.5;
  }

  update(dt: number): void {
    const v = this.vars;
    const on = v.get(this.powerVar) > 0.5;
    if (on && !this.wasOn) this.warmT = 0;
    this.wasOn = on;
    if (on) this.warmT += dt;
    const ok = on && this.warmT >= ENCODER_WARMUP_S && v.get(this.failVar) === 0;
    const alt = v.get(SENSOR_VARS.pressAlt(1));
    v.set(ENC.valid, ok ? 1 : 0);
    v.set(ENC.altFt, ok ? alt : 0);
    v.set(ENC.gillhamHft, ok ? Math.round(alt / 100) : -9999);
  }

  /** Skips the warm-up (state presets with the avionics already running). */
  warm(): void {
    this.warmT = ENCODER_WARMUP_S;
    this.wasOn = this.vars.get(this.powerVar) > 0.5;
  }
}
