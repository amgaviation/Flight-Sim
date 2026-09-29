/**
 * G1000 NXi alerting (PG 190-02177-02 Appendix A "CAS Message
 * Prioritization", §1.4 Table 1-3 Alerts softkey, §1.3 "System
 * Annunciations"):
 *
 *  - CAS window on the PFD (right of the altimeter, up to 12 lines): warnings
 *    red, cautions amber (new ones inverse until acknowledged), advisories
 *    white; grouped by level, newest first; a white line separates
 *    acknowledged from unacknowledged messages. Messages present when the
 *    system is powered on are already acknowledged.
 *  - Aurals: a warning gives a continuously repeating chime until the
 *    Warning softkey is pressed (unless its `auralInhibit` holds, e.g. LOW
 *    VOLTS on the ground); a caution gives a single chime.
 *  - Alerts softkey (rightmost PFD softkey, visible at every level): flashes
 *    'Warning' / 'Caution' / 'Advisory' for an unacknowledged CAS message
 *    (pressing acknowledges that level and the label returns to 'Alerts'),
 *    flashes 'Message' for a new system message (pressing opens the Alerts
 *    window and acknowledges it). With messages still present after
 *    acknowledgement the 'Alerts' label is black on white.
 *  - System messages (Alerts window, up to 64): the subset relevant to the
 *    modelled 172S equipment, texts verbatim from Appendix A.
 *
 * CAS conditions are `CasDef` bindings from the installation config with an
 * optional persistence delay (LOW FUEL L/R 60 s, POH 7-38).
 */
import type { SimVars } from '../../../core/SimVars';
import type { AudioApi } from '../../../core/SimContext';
import { compileCondition } from '../../../systems/util/binding';
import { CasModel, type CasMessage } from '../../common/draw/CasWindow';
import { MessageList } from '../../garmin-g3000/state/models';
import type { CasDef } from '../config';
import { G1K } from '../vars';

/** Alerts softkey label per `g1k.alerts.key` code. */
export const ALERTS_KEY_LABELS = ['Alerts', 'Message', 'Advisory', 'Caution', 'Warning'] as const;

interface CasItem {
  def: CasDef;
  cond: () => boolean;
  /** Aural inhibited (CasDef.auralInhibit), or null. */
  quiet: (() => boolean) | null;
  heldS: number;
  msg: CasMessage | null;
}

export class AlertSystem {
  readonly cas: CasModel;
  readonly messages = new MessageList();
  private readonly items: CasItem[] = [];
  private lastUnackedCautions = 0;
  private warnTone = false;
  private wasEnabled = false;

  constructor(
    private readonly vars: SimVars,
    private readonly audio: AudioApi | null,
    defs: readonly CasDef[],
    casModel?: CasModel,
  ) {
    // G1000 NXi: advisories are also shown inverse (flashing Advisory softkey) until acknowledged (PG Appendix A).
    this.cas = casModel ?? new CasModel(['warning', 'caution', 'advisory']);
    for (const d of defs) {
      const msg = this.cas.define(d.id, d.text, d.level);
      this.items.push({ def: d, cond: compileCondition(vars, d.when), quiet: d.auralInhibit !== undefined ? compileCondition(vars, d.auralInhibit, false) : null, heldS: 0, msg });
    }
  }

  /** Current Alerts softkey state: 0 Alerts, 1 Message, 2 Advisory, 3 Caution, 4 Warning. */
  get keyState(): number {
    return this.vars.get(G1K.alertsKey);
  }

  /** Alerts label shown black on white (messages remain after acknowledgement). */
  get keyInverse(): boolean {
    return this.keyState === 0 && (this.cas.list.length > 0 || this.messages.list.length > 0);
  }

  /** Number of unacknowledged advisories. */
  private unackedAdvisories(): number {
    let n = 0;
    const l = this.cas.list;
    for (let i = 0; i < l.length; i++) if (l[i].level === 'advisory' && !l[i].acknowledged) n++;
    return n;
  }

  /**
   * Alerts softkey pressed. Returns true when the Alerts window should toggle
   * (plain 'Alerts' or 'Message'); a Warning / Caution / Advisory press only
   * acknowledges.
   */
  pressAlertsKey(): boolean {
    const k = this.keyState;
    if (k === 4) this.cas.acknowledge('warning');
    else if (k === 3) this.cas.acknowledge('caution');
    else if (k === 2) this.cas.acknowledge('advisory');
    else {
      if (k === 1) this.messages.markAllRead();
      this.publishKey();
      return true;
    }
    this.publishKey();
    return false;
  }

  /** Acknowledge everything (external CAS acknowledge event). */
  acknowledgeAll(): void {
    this.cas.acknowledgeAll();
    this.publishKey();
  }

  /** Viewing the Alerts window marks the system messages read. */
  viewed(): void {
    this.messages.markAllRead();
  }

  /**
   * Evaluates the CAS conditions. `enabled` = the alerting path is up (GEA
   * engine/airframe unit and a display); `powerUp` = first update after the
   * system came up (existing messages are pre-acknowledged).
   */
  update(dt: number, enabled: boolean): void {
    const powerUp = enabled && !this.wasEnabled;
    this.wasEnabled = enabled;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const on = enabled && it.cond();
      it.heldS = on ? it.heldS + dt : 0;
      this.cas.setActive(it.def.id, on && it.heldS >= (it.def.delayS ?? 0));
    }
    if (powerUp) this.cas.acknowledgeAll();
    // Aurals: repeating warning chime while any warning is unacknowledged; single chime per new caution.
    // Unacknowledged warnings whose aural is not inhibited (CasDef.auralInhibit).
    let loud = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const m = it.msg;
      if (m && m.level === 'warning' && m.active && !m.acknowledged && !(it.quiet && it.quiet())) loud++;
    }
    const w = enabled && loud > 0;
    if (w !== this.warnTone) {
      this.warnTone = w;
      this.audio?.tone('master_warning', w);
    }
    const c = this.cas.unackedCautions;
    if (enabled && c > this.lastUnackedCautions) this.audio?.play('master_caution');
    this.lastUnackedCautions = c;
    this.vars.set(G1K.warnChime, w ? 1 : 0);
    this.publishKey();
  }

  /** Sets a system message (Appendix A text) on or off. */
  message(id: string, text: string, on: boolean): void {
    this.messages.set(id, text, on);
  }

  private publishKey(): void {
    const v = this.vars;
    let k = 0;
    if (this.cas.unackedWarnings > 0) k = 4;
    else if (this.cas.unackedCautions > 0) k = 3;
    else if (this.unackedAdvisories() > 0) k = 2;
    else if (this.messages.unread > 0) k = 1;
    v.set(G1K.alertsKey, k);
    v.set(G1K.msgUnread, this.messages.unread > 0 ? 1 : 0);
    v.set(G1K.msgCount, this.messages.list.length);
  }

  dispose(): void {
    if (this.warnTone) this.audio?.tone('master_warning', false);
    this.warnTone = false;
  }
}
