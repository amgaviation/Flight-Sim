/**
 * Autopilot and autothrottle disconnect aurals.
 *
 * Watches the disconnect-warning vars written by the AFCS (`ap.disc_warn`)
 * and the Autothrottle (`at.disc_warn`) and drives the aural alerts:
 *   - AP: 'ap_disconnect' tone (Boeing wailer / "cavalry charge", Garmin
 *     disconnect tone) while the warning is active, limited to
 *     `apToneMaxS` (Garmin: the tone lasts ~1.5–2 s even though the AP
 *     annunciation keeps flashing — G1000 PG; KAP 140: 2 s tone, 5 s
 *     flashing AP — KAP 140 Pilot's Guide; Boeing: until reset, 737 A/P
 *     disengage light "flashes red and tone sounds").
 *     Optional voice ("AUTOPILOT") for installations with voice messaging.
 *   - A/T: 'at_disconnect' tone limited to `atToneMaxS`.
 *
 * Vars read: ap.disc_warn, at.disc_warn. Writes nothing (sound only), plus
 * alert.ap_disc_aural / alert.at_disc_aural (1 while the tone plays) for
 * recorders/tests.
 */
import type { Subsystem } from '../../aircraft/types';
import type { SimVars } from '../../core/SimVars';
import type { AudioApi } from '../../core/SimContext';
import type { BlockEnv } from '../autopilot/lib';

export interface DisconnectAlertsConfig {
  apTone?: string;
  atTone?: string;
  /** Max tone duration (s); Infinity = while the warning var is set. Defaults: AP Infinity, A/T 3. */
  apToneMaxS?: number;
  atToneMaxS?: number;
  /**
   * Max AP tone duration (s) after an automatic disconnect (`ap.disc_auto` = 1); default `apToneMaxS`.
   * Infinity = while the warning is set (GFC 700: "until acknowledged", CRG 190-00384-12 §6.4). Appended.
   */
  apToneAutoMaxS?: number;
  apVoice?: string;
  apWarnVar?: string;
  atWarnVar?: string;
}

export class DisconnectAlerts implements Subsystem {
  readonly name = 'disconnect_alerts';
  private readonly vars: SimVars;
  private readonly audio: AudioApi | undefined;
  private readonly cfg: DisconnectAlertsConfig;
  private apT = -1;
  private atT = -1;
  private apOn = false;
  private atOn = false;

  constructor(env: BlockEnv, cfg: DisconnectAlertsConfig = {}) {
    this.vars = env.vars;
    this.audio = env.audio;
    this.cfg = cfg;
  }

  update(dt: number): void {
    const v = this.vars;
    const c = this.cfg;
    const apW = v.get(c.apWarnVar ?? 'ap.disc_warn') !== 0;
    const atW = v.get(c.atWarnVar ?? 'at.disc_warn') !== 0;
    if (apW && this.apT < 0) {
      this.apT = 0;
      if (c.apVoice) this.audio?.callout(c.apVoice, 8);
    } else if (!apW) this.apT = -1;
    else this.apT += dt;
    if (atW && this.atT < 0) this.atT = 0;
    else if (!atW) this.atT = -1;
    else this.atT += dt;
    const apMax = v.get('ap.disc_auto') !== 0 ? (c.apToneAutoMaxS ?? c.apToneMaxS ?? Infinity) : (c.apToneMaxS ?? Infinity);
    const apTone = apW && this.apT < apMax;
    const atTone = atW && this.atT < (c.atToneMaxS ?? 3);
    if (apTone !== this.apOn) {
      this.apOn = apTone;
      this.audio?.tone(c.apTone ?? 'ap_disconnect', apTone);
    }
    if (atTone !== this.atOn) {
      this.atOn = atTone;
      this.audio?.tone(c.atTone ?? 'at_disconnect', atTone);
    }
    v.set('alert.ap_disc_aural', apTone ? 1 : 0);
    v.set('alert.at_disc_aural', atTone ? 1 : 0);
  }
}
