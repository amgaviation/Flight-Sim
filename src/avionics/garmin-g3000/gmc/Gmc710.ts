/**
 * GMC 710 AFCS mode controller (G3000 PG 190-02046-01 §7.1 "AFCS Controls",
 * Figure 7-1; G5000 Longitude adds the A/T key and a SPD knob with FMS/MAN
 * push). Maps the key events to the AFCS (`systems/autopilot` Afcs events
 * `${prefix}<button>`) and mirrors the key annunciator lights.
 *
 * Keys (event `g3k.gmc.key_<name>`):
 *   HDG NAV APR BC        lateral modes (APR first lets the suite arm LOC/GS
 *                         for an ILS loaded with FMS selected, see
 *                         `G3000System.prepareApproach`)
 *   AP YD FD FD1 FD2      autopilot, yaw damper, flight directors
 *   XFR                   transfers the coupled side (arrows show the side)
 *   BANK                  low bank (half bank)
 *   VS FLC ALT VNAV       vertical modes
 *   SPD                   FLC reference IAS <-> Mach
 *   AT                    autothrottle engage (`at.engage`, G5000)
 * Knobs (events in vars.ts G3K_EVENTS, handled by `G3000System`): HDG (push
 * sync), CRS1 / CRS2 (push centre), ALT SEL outer / inner (push sync), NOSE
 * UP/DN wheel, SPD (Longitude).
 *
 * Lights (`g3k.gmc.lt_<key>`, 1 = lit) follow the AFCS `ap.btn_*` lights and
 * go dark when the controller is unpowered (`gmcPower` binding).
 */
import type { Subsystem } from '../../../aircraft/types';
import { AP } from '../../../core/vars';
import { compileBinding, type Evaluator } from '../../../systems/util/binding';
import type { G3000System } from '../state/System';
import { G3K, G3K_EVENTS } from '../vars';

export const GMC_KEYS = ['HDG', 'NAV', 'APR', 'BC', 'AP', 'YD', 'FD', 'FD1', 'FD2', 'XFR', 'BANK', 'VS', 'FLC', 'ALT', 'VNAV', 'SPD', 'AT'] as const;
export type GmcKey = (typeof GMC_KEYS)[number];

/** AFCS button (lower case event suffix) per key; '' = handled by the suite. */
const KEY_TO_AFCS: Record<GmcKey, string> = {
  HDG: 'hdg',
  NAV: 'nav',
  APR: 'apr',
  BC: 'bc',
  AP: 'ap',
  YD: 'yd',
  FD: 'fd',
  FD1: 'fd1',
  FD2: 'fd2',
  XFR: '',
  BANK: 'half_bank',
  VS: 'vs',
  FLC: 'flc',
  ALT: 'alt',
  VNAV: 'vnav',
  SPD: 'spd_mach',
  AT: '',
};

/** Light source var per key (the AFCS `ap.btn_*` lights). */
const KEY_LIGHT_SRC: Partial<Record<GmcKey, string>> = {
  HDG: 'ap.btn_hdg',
  NAV: 'ap.btn_nav',
  APR: 'ap.btn_apr',
  BC: 'ap.btn_bc',
  AP: 'ap.btn_ap',
  YD: 'ap.btn_yd',
  FD: 'ap.btn_fd',
  FD1: AP.fdOn(1),
  FD2: AP.fdOn(2),
  BANK: 'ap.btn_half_bank',
  VS: 'ap.btn_vs',
  FLC: 'ap.btn_flc',
  ALT: 'ap.btn_alt',
  VNAV: 'ap.btn_vnav',
  AT: AP.athr,
};

export class Gmc710 implements Subsystem {
  readonly name = 'g3000.gmc710';
  private readonly offs: (() => void)[] = [];
  private readonly power: Evaluator;
  private readonly lightSrc: string[] = [];
  private readonly lightDst: string[] = [];
  private readonly xfrL = G3K.gmcLight('xfr_l');
  private readonly xfrR = G3K.gmcLight('xfr_r');
  private powered = true;

  constructor(readonly sys: G3000System) {
    this.power = compileBinding(sys.vars, sys.cfg.gmcPower, 1);
    for (const k of GMC_KEYS) {
      const src = KEY_LIGHT_SRC[k];
      if (!src) continue;
      this.lightSrc.push(src);
      this.lightDst.push(G3K.gmcLight(k));
    }
    const ev = sys.events;
    if (ev) for (const k of GMC_KEYS) this.offs.push(ev.on(G3K_EVENTS.gmcKey(k), () => this.press(k)));
  }

  /** Presses a GMC key (same as the `g3k.gmc.key_<name>` event). */
  press(k: GmcKey): void {
    if (!this.powered) return;
    const sys = this.sys;
    const prefix = sys.cfg.afcs.eventPrefix;
    if (k === 'XFR') {
      sys.xfr();
      return;
    }
    if (k === 'AT') {
      if (sys.cfg.afcs.autothrottle) sys.events?.emit('at.engage');
      return;
    }
    if (k === 'APR') sys.prepareApproach();
    sys.events?.emit(prefix + KEY_TO_AFCS[k]);
  }

  update(_dt: number): void {
    const v = this.sys.vars;
    this.powered = this.power() >= 0.5;
    v.set(G3K.gmcPowered, this.powered ? 1 : 0);
    const on = this.powered;
    for (let i = 0; i < this.lightSrc.length; i++) v.set(this.lightDst[i], on && v.get(this.lightSrc[i]) >= 0.5 ? 1 : 0);
    const side = this.sys.coupledSide();
    v.set(this.xfrL, on && side === 1 ? 1 : 0);
    v.set(this.xfrR, on && side === 2 ? 1 : 0);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }
}
