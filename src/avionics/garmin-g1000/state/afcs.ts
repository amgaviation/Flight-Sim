/**
 * GFC 700 glue for the G1000 NXi (PG 190-02177-02 Section 7):
 *
 *  - `AFCS_GFC700_NXI`: the shared `Afcs` preset for the 172S, spreading
 *    `AFCS_GFC700_G1000` with the NXi 172 numbers (PG Table 7-2: PIT
 *    -15..+20 deg in 0.5 deg steps, VS -2000..+1500 fpm in 100 fpm steps,
 *    FLC 70..150 KIAS in 1 kt steps; Table 7-3: 22 deg roll limit; §7.3
 *    "At 50 feet from the Selected Altitude, the flight director
 *    automatically transitions ... to Altitude Hold Mode").
 *  - `AFCS_KEYS`: the GFC 700 keys on the GDU 1054B bezel and the `ap.*`
 *    event each one sends (the shared Afcs listens to `ap.<button>`).
 *  - `AfcsMonitor`: the AFCS status annunciations above the airspeed tape
 *    (PG Table 7-6: PFT, AFCS, PTRM, ROLL, PTCH, ↑ELE / ↓ELE, AIL→ / ←AIL),
 *    the preflight test at servo power-up, overspeed protection (MAXSPD),
 *    and the reference range clamps the shared Afcs cannot express
 *    (asymmetric VS range, FLC speed range).
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { AudioApi } from '../../../core/SimContext';
import { ADC, AP } from '../../../core/vars';
import { AFCS_GFC700_G1000 } from '../../../systems/autopilot/presets';
import type { AfcsConfig } from '../../../systems/autopilot/types';
import { G1K } from '../vars';

type Preset = Omit<AfcsConfig, 'power' | 'servoPower' | 'sensors' | 'gains'>;

/** PG Table 7-2 (Cessna 172): VS reference -2000 .. +1500 fpm, FLC reference 70 .. 150 KIAS. */
export const NXI_VS_MIN_FPM = -2000;
export const NXI_VS_MAX_FPM = 1500;
export const NXI_FLC_MIN_KT = 70;
export const NXI_FLC_MAX_KT = 150;

/**
 * Shared-Afcs preset for the GFC 700 in the 172S NXi. Spread it and add the
 * power / servo power bindings:
 *   new Afcs(ctx, { ...AFCS_GFC700_NXI, power: 'g1k.gia1.up', servoPower: 'g1k.servos.up' })
 * `maxVsFpm` is the larger magnitude (2000); AfcsMonitor clamps climbs to +1500.
 */
export const AFCS_GFC700_NXI: Preset = {
  ...AFCS_GFC700_G1000,
  name: 'gfc700_nxi_172',
  limits: { ...AFCS_GFC700_G1000.limits, maxVsFpm: -NXI_VS_MIN_FPM },
  altCaptureToHoldFt: 50,
  // CRG 190-00384-12 §6.4: automatic disengagement flashes red AP with the aural "until acknowledged by pushing the
  // AP DISC or MET Switch"; manual: 5 s flashing yellow (discWarningS 5 from the preset).
  autoDiscLatches: true,
  // CRG §6.3: loss of navigation data flashes the mode yellow, the FD rolls wings level, and after 10 s without
  // pilot action enters the default mode (ROL).
  navLossRevertS: 10,
  navLossWingsLevel: true,
};

/** GFC 700 keys on the GDU 1054B bezel (PG Figure 7-1) -> shared-Afcs event suffix and payload. */
export const AFCS_KEYS: readonly { key: string; label: string; event: string; payload?: unknown }[] = [
  { key: 'ap', label: 'AP', event: 'ap' },
  { key: 'fd', label: 'FD', event: 'fd' },
  { key: 'hdg', label: 'HDG', event: 'hdg' },
  { key: 'alt', label: 'ALT', event: 'alt' },
  { key: 'nav', label: 'NAV', event: 'nav' },
  { key: 'vnv', label: 'VNV', event: 'vnav' },
  { key: 'apr', label: 'APR', event: 'apr' },
  { key: 'bc', label: 'BC', event: 'bc' },
  { key: 'vs', label: 'VS', event: 'vs' },
  { key: 'flc', label: 'FLC', event: 'flc' },
  { key: 'nose_up', label: 'NOSE UP', event: 'up', payload: { steps: 1 } },
  { key: 'nose_dn', label: 'NOSE DN', event: 'dn', payload: { steps: 1 } },
];

/** AFCS status annunciation texts (PG Table 7-6). */
export const AFCS_STATUS = {
  pft: 'PFT',
  afcs: 'AFCS',
  ptrm: 'PTRM',
  roll: 'ROLL',
  ptch: 'PTCH',
  eleUp: '↑ELE',
  eleDn: '↓ELE',
  ailR: 'AIL→',
  ailL: '←AIL',
} as const;

/** Roll mistrim: EST same thresholds as the shared Afcs pitch mistrim (|servo| > 0.25 for 10 s). */
const ROLL_MISTRIM_SERVO = 0.25;
const ROLL_MISTRIM_S = 10;
/** Overspeed protection: annunciate within EST 2 kt of Vne (the PG gives no margin), nudge 1 step / s. */
const MAXSPD_MARGIN_KT = 2;
const MAXSPD_NUDGE_S = 1;
/** Modes in which overspeed protection is active (PG §7.5 "not active in ALT, GS or GP modes"). */
const OVERSPEED_MODES = new Set(['PIT', 'VS', 'FLC', 'VPTH', 'ALTS', 'ALTV']);
/** Var names used every update (built once: no per-step string building). */
const IAS1 = ADC.ias(1);
const FD1 = AP.fdOn(1);
const PFD_POWERED = G1K.unitPowered('pfd');

export class AfcsMonitor {
  private rollMistrimS = 0;
  private pftFailed = false;
  private wasServos = false;
  private pftToneS = 0;
  private nudgeS = 0;

  constructor(
    private readonly vars: SimVars,
    private readonly events: EventBus | null,
    private readonly audio: AudioApi | null,
    private readonly vneKt: number,
  ) {}

  /**
   * `gia1Up`: AFCS computer (GIA 1) up; `servosPowered` / `servosUp`: GSA 81
   * servos powered / passed the preflight test (the unit boot timer is the PFT).
   */
  update(dt: number, gia1Up: boolean, servosSupplied: boolean, servosPowered: boolean, servosUp: boolean, servoPftS: number): void {
    const v = this.vars;
    // --- preflight test (PG Table 7-6: white PFT while testing, aural at completion; red PFT = failed:
    // servo power present but the servos (fail.g1k.servos) do not pass their power-on test)
    this.pftFailed = servosSupplied && !servosPowered;
    if (servosUp && !this.wasServos) {
      // EST: the completion aural is the GFC 700 disconnect tone, ~1 s.
      this.pftToneS = 1;
      this.audio?.tone('ap_disconnect', true);
    }
    this.wasServos = servosUp;
    if (this.pftToneS > 0) {
      this.pftToneS -= dt;
      if (this.pftToneS <= 0) this.audio?.tone('ap_disconnect', false);
    }
    v.set(G1K.afcsPftS, servosPowered && !servosUp ? servoPftS : 0);

    // --- status annunciation priority: red (PFT fail, AFCS, PTRM, ROLL, PTCH) > white PFT > yellow mistrim
    let text = '';
    let level = 0;
    // PTRM also for a stuck MET half (CRG 190-00384-12 §6.1 "MET function is disabled and PTRM is displayed").
    const trimFail = v.get('fail.trim.pitch.jam') >= 0.5 || v.get('fail.trim.pitch.runaway') >= 0.5 || v.get(G1K.metFault) >= 0.5;
    if (this.pftFailed) {
      text = AFCS_STATUS.pft;
      level = 1;
    } else if ((!gia1Up || v.get('fail.afcs') >= 0.5) && v.get(PFD_POWERED) >= 0.5) {
      text = AFCS_STATUS.afcs;
      level = 1;
    } else if (gia1Up && !servosSupplied) {
      // SCOPE: AUTOPILOT breaker out / servo power lost -> AFCS system failure annunciation.
      text = AFCS_STATUS.afcs;
      level = 1;
    } else if (servosPowered && !servosUp) {
      text = AFCS_STATUS.pft;
      level = 2;
    } else if (trimFail && servosUp) {
      text = AFCS_STATUS.ptrm;
      level = 1;
    } else if (v.get('fail.afcs.servo_roll') >= 0.5) {
      text = AFCS_STATUS.roll;
      level = 1;
    } else if (v.get('fail.afcs.servo_pitch') >= 0.5) {
      text = AFCS_STATUS.ptch;
      level = 1;
    } else if (v.get(AP.engaged) >= 0.5) {
      const sr = v.get('ap.servo_roll');
      this.rollMistrimS = Math.abs(sr) > ROLL_MISTRIM_SERVO ? this.rollMistrimS + dt : 0;
      if (v.get('ap.mistrim') >= 0.5) {
        text = v.get('ap.servo_pitch') >= 0 ? AFCS_STATUS.eleUp : AFCS_STATUS.eleDn;
        level = 0;
      } else if (this.rollMistrimS > ROLL_MISTRIM_S) {
        text = sr >= 0 ? AFCS_STATUS.ailR : AFCS_STATUS.ailL;
        level = 0;
      }
    } else this.rollMistrimS = 0;
    v.setString(G1K.afcsStatus, text);
    v.set(G1K.afcsStatusLevel, level);

    // --- reference ranges the shared Afcs cannot express (PG Table 7-2)
    const vert = v.getString(AP.verticalActive);
    if (vert === 'VS') {
      const vs = v.get(AP.selVs);
      if (vs > NXI_VS_MAX_FPM) v.set(AP.selVs, NXI_VS_MAX_FPM);
      else if (vs < NXI_VS_MIN_FPM) v.set(AP.selVs, NXI_VS_MIN_FPM);
    } else if (vert === 'FLC') {
      const s = v.get(AP.selSpeed);
      if (s < NXI_FLC_MIN_KT) v.set(AP.selSpeed, NXI_FLC_MIN_KT);
      else if (s > NXI_FLC_MAX_KT) v.set(AP.selSpeed, NXI_FLC_MAX_KT);
    }

    // --- overspeed protection (PG §7.5): FD/AP in PIT, VS, FLC, VPTH, ALTS, ALTV
    const ias = v.get(IAS1);
    const fdOn = v.get(FD1) >= 0.5 || v.get(AP.engaged) >= 0.5;
    const maxspd = gia1Up && fdOn && OVERSPEED_MODES.has(vert) && ias >= this.vneKt - MAXSPD_MARGIN_KT;
    v.set(G1K.maxSpd, maxspd ? 1 : 0);
    if (maxspd && (vert === 'PIT' || vert === 'VS')) {
      // SCOPE: the real FD limits its pitch command to hold Vne; here the reference is raised one step per
      // second (NOSE UP) until the overspeed clears.
      this.nudgeS += dt;
      if (this.nudgeS >= MAXSPD_NUDGE_S) {
        this.nudgeS = 0;
        this.events?.emit('ap.up', { steps: 1 });
      }
    } else this.nudgeS = 0;
  }

  dispose(): void {
    if (this.pftToneS > 0) this.audio?.tone('ap_disconnect', false);
  }
}
