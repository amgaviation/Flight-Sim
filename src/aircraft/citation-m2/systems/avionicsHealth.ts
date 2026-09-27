/**
 * Citation M2 avionics health: power-loss consequences of the LRUs that the
 * shared G3000 / radio models do not take a power input for, reported the way
 * the Garmin system reports them (G3000 system messages on the PFD MSG list).
 *
 * Message wording: Garmin G1000 Pilot's Guide 190-00498-07, Appendix A
 * "System Messages" ("GMA1 FAIL - GMA1 is inoperative.", "XPDR1 FAIL - XPDR1
 * is inoperative.", "PFD1 COOLING - PFD1 has poor cooling. Reducing power
 * usage."); the G3000 uses the same Garmin integrated-avionics message family
 * (EST: identical wording on the M2's G3000). "GWX FAIL" follows the same
 * "<LRU> FAIL - <LRU> is inoperative." pattern (EST).
 *
 *  - GMA 36 audio processors (`cb.audio1` / `cb.audio2`, AVN 1 / AVN 2): each
 *    has a marker-beacon receiver (dual GMA 36, S&D15 §10.3.H); the marker
 *    receiver power is `audio1 || audio2` (systems/avionics.ts). A GMA with
 *    its bus up but no power -> "GMAn FAIL".
 *  - GTX 3000 transponders (`cb.xpdr`, AVN 2): no replies (IDENT dropped),
 *    "XPDR1 FAIL". Output `ac.m2.xpdr_reply` (1 = replying: powered and mode
 *    ON/ALT or TCAS modes). SCOPE: there is no ATC / other-traffic consumer of
 *    the reply; the transponder mode stays selectable on the GTC.
 *  - GWX 70 radar (`cb.radar`, AVN 2): the G3000 radar state is forced to
 *    STBY / off while unpowered, "GWX FAIL".
 *  - Avionics cooling fans (`cb.cockpit_fans`, L XFEED; "two glareshield
 *    avionics cooling fans", S&D15 §10.3.A per the dossier §6.1): a first-order
 *    GDU temperature per display. EST: a GDU 1400W dissipates ~180 W; with the
 *    fans it settles ~12 C above the cockpit air, without them ~40 C above, time
 *    constant 10 min; "COOLING" above 50 C (clears below 45 C). The G3000
 *    reduces power usage (`ac.m2.gdu_hot_<id>` = 1 -> M2LogicLate dims that
 *    display to 60 % of the selected brightness).
 *
 * Runs after the G3000 suite systems (createSystems.ts). Allocation-free per update.
 */
import type { SimContext } from '../../../core/SimContext';
import type { Subsystem } from '../../types';
import { NAV } from '../../../core/vars';
import type { G3000Suite } from '../../../avionics/garmin-g3000';

/** GDUs with a thermal model: [display id, Garmin message name]. */
const GDUS = [
  ['pfd1', 'PFD1'],
  ['mfd', 'MFD1'],
  ['pfd2', 'PFD2'],
] as const;

export const M2_AVN_HEALTH_VARS = {
  /** 1 while the transponder replies (powered, mode ON / ALT / TA). */
  xpdrReply: 'ac.m2.xpdr_reply',
  /** GDU internal temperature (C). */
  gduTemp: (id: string) => `ac.m2.gdu_temp_${id}_c`,
  /** 1 while the GDU is in its poor-cooling reduced-power state. */
  gduHot: (id: string) => `ac.m2.gdu_hot_${id}`,
} as const;

/** EST GDU thermal model (see the header). */
export const GDU_THERMAL = { riseFansC: 12, riseNoFansC: 40, tauS: 600, hotC: 50, clearC: 45 } as const;

export class M2AvionicsHealth implements Subsystem {
  readonly name = 'm2.avionics_health';
  private readonly temp = new Float64Array(GDUS.length);
  private readonly hot = new Uint8Array(GDUS.length);
  private readonly tempVar = GDUS.map(([id]) => M2_AVN_HEALTH_VARS.gduTemp(id));
  private readonly hotVar = GDUS.map(([id]) => M2_AVN_HEALTH_VARS.gduHot(id));
  private readonly powerVar = GDUS.map(([id]) => `elec.${id}_powered`);
  private readonly coolingId = GDUS.map(([id]) => `m2.cooling.${id}`);
  private readonly coolingText = GDUS.map(([, n]) => `${n} COOLING - ${n} has poor cooling. Reducing power usage.`);
  private init = false;

  constructor(
    private readonly ctx: Pick<SimContext, 'vars'>,
    private readonly suite: Pick<G3000Suite, 'system'>,
  ) {}

  update(dt: number): void {
    const v = this.ctx.vars;
    const msg = this.suite.system.messages;
    const avn1 = v.get('elec.avn1_powered') !== 0;
    const avn2 = v.get('elec.avn2_powered') !== 0;

    // ---- GMA 36 audio processors.
    msg.set('m2.gma1', 'GMA1 FAIL - GMA1 is inoperative.', avn1 && v.get('elec.audio1_powered') === 0);
    msg.set('m2.gma2', 'GMA2 FAIL - GMA2 is inoperative.', avn2 && v.get('elec.audio2_powered') === 0);

    // ---- GTX 3000 transponder.
    const xpdrPwr = v.get('elec.xpdr_powered') !== 0;
    if (!xpdrPwr) v.set(NAV.xpdrIdent, 0);
    v.set(M2_AVN_HEALTH_VARS.xpdrReply, xpdrPwr && v.get(NAV.xpdrMode) >= 2 ? 1 : 0);
    msg.set('m2.xpdr1', 'XPDR1 FAIL - XPDR1 is inoperative.', avn2 && !xpdrPwr);

    // ---- GWX 70 weather radar.
    const radarPwr = v.get('elec.radar_powered') !== 0;
    if (!radarPwr) {
      const r = this.suite.system.radar;
      r.on = false;
      r.mode = 'STBY';
    }
    msg.set('m2.gwx', 'GWX FAIL - GWX is inoperative.', avn2 && !radarPwr);

    // ---- GDU cooling (glareshield avionics fans).
    const amb = v.get('pneu.cabin_temp_c', 22);
    const fans = v.get('elec.cockpit_fans_powered') !== 0;
    const k = 1 - Math.exp(-Math.max(0, dt) / GDU_THERMAL.tauS);
    for (let i = 0; i < GDUS.length; i++) {
      const on = v.get(this.powerVar[i]) !== 0;
      const target = amb + (on ? (fans ? GDU_THERMAL.riseFansC : GDU_THERMAL.riseNoFansC) : 0);
      if (!this.init) this.temp[i] = target;
      else this.temp[i] += (target - this.temp[i]) * k;
      if (this.temp[i] > GDU_THERMAL.hotC) this.hot[i] = 1;
      else if (this.temp[i] < GDU_THERMAL.clearC) this.hot[i] = 0;
      const hot = on && this.hot[i] === 1;
      v.set(this.tempVar[i], this.temp[i]);
      v.set(this.hotVar[i], hot ? 1 : 0);
      msg.set(this.coolingId[i], this.coolingText[i], hot);
    }
    this.init = true;
  }

  reset(): void {
    this.init = false;
    this.hot.fill(0);
  }
}
