/**
 * Citation Longitude autothrottle / AFCS functions the generic blocks do not
 * cover (function-audit fix round 1):
 *
 *  - `LongitudeAtHold` (before the autothrottle): OG 7-5 "On the ground during
 *    takeoff and once the throttle is advanced towards takeoff power, the
 *    autothrottle will engage HOLD and disable the AT servos ... HOLD will only
 *    activate when on the ground". With the A/T engaged in any mode but TO (a
 *    TO/GA takeoff keeps TO until the generic 60 kt HOLD), either lever in the T/O
 *    range on the ground switches the A/T to HOLD (servos off) until 400 ft AGL.
 *  - `LongitudeAtProtection` (after the autothrottle, before the FADEC law):
 *    OG 7-5 A/T protection modes MAX SPD ("limit throttle to prevent
 *    overspeed") and MIN SPD ("increase throttle to prevent nearing stall
 *    speeds"); BCA 2021: "If the autothrottles are not engaged, they will
 *    automatically engage to retard the throttles ... If you fly too slowly, the
 *    autothrottles will advance and if the speedbrakes are deployed, they will
 *    automatically stow" (stow in logic.ts). Thresholds EST: MIN SPD at AoA 0.72
 *    of the stall AoA (shaker 0.82), cleared below 0.60; MAX SPD within 2 kt of
 *    Vmo/Mmo (Overspeed block's `overspeed.vmo_kt`), cleared 8 kt below. Only in
 *    flight above 400 ft RA (EST: no protection in the landing flare).
 *    MIN SPD drives the levers to TO, MAX SPD retards while above the limit.
 *  - Emergency Descent Mode (BCA 2021; DGAC card "EMERGENCY DESCENT and EDM"):
 *    cabin altitude > 14,700 ft with the AP engaged above 30,000 ft: the AFCS
 *    turns 90 deg left (HDG), descends in FLC at Mmo/Vmo (EST margins: M0.82 /
 *    315 KIAS) to 15,000 ft (selected altitude), the A/T retards to idle (FLC
 *    descent = DESC); level at 15,000 ft the A/T targets 250 KIAS (EST: "advance
 *    to provide a safe margin above stall speed"). Any crew AFCS change (AP off,
 *    another lateral or vertical mode) ends EDM. Annunciation: white CAS
 *    EMERGENCY DESCENT (EST text; SCOPE: no dedicated FMA field).
 *
 * No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import { ADC, AP } from '../../../core/vars';
import { AtMode, type Autothrottle } from '../../../systems/fadec';
import type { Afcs } from '../../../systems/autopilot';
import { LON_VARS as V } from '../vars';
import { TLA } from './logic';

const LEVERS = [V.tla(1), V.tla(2)];

export class LongitudeAtHold implements Subsystem {
  readonly name = 'lon.at_hold';
  constructor(
    private readonly vars: SimVars,
    private readonly at: Autothrottle,
  ) {}
  update(): void {
    const v = this.vars;
    const at = this.at;
    if (!at.engaged || v.get('gear.air_ground') === 0) return;
    if (at.mode === AtMode.Takeoff || at.mode === AtMode.Hold) return;
    if (v.get(V.toThrust) !== 0) at.mode = AtMode.Hold;
  }
}

/** EST thresholds (see header). */
const MIN_SPD_ON = 0.72;
const MIN_SPD_OFF = 0.6;
const MAX_SPD_ON_KT = 2;
const MAX_SPD_OFF_KT = 8;
const SERVO = 0.12; // lever units/s, the A/T servo rate (engines.ts)
const EDM_CABIN_FT = 14700;
const EDM_MIN_ALT_FT = 30000;
const EDM_TARGET_FT = 15000;
const EDM_MACH = 0.82; // EST: Mmo 0.84 - 0.02
const EDM_KT = 315; // EST: Vmo 325 - 10
const EDM_LEVEL_KT = 250; // EST

export class LongitudeAtProtection implements Subsystem {
  readonly name = 'lon.at_protection';
  private prot = 0;
  private readonly lever = new Float64Array(2);
  private edm = false;
  private edmLevel = false;

  constructor(
    private readonly vars: SimVars,
    private readonly at: Autothrottle,
    private readonly afcs: Afcs,
  ) {}

  update(dt: number): void {
    const v = this.vars;
    const at = this.at;
    const air = v.get('gear.air_ground') === 0;
    const ra = v.get('ra1.alt_ft', 99999);
    const ias = v.get(ADC.ias(1));
    const vmax = v.get('overspeed.vmo_kt');
    const aoa = v.get('stall.aoa_norm');
    const powered = v.get('elec.afcs_powered') !== 0 && v.get('elec.gmc_powered') !== 0 && v.get('fail.at') === 0;
    const armed = air && ra > 400 && powered;

    // ---------------- A/T protection
    let want = 0;
    if (armed) {
      if (aoa > MIN_SPD_ON || (this.prot === 1 && aoa > MIN_SPD_OFF)) want = 1;
      else if (vmax > 0 && (ias > vmax - MAX_SPD_ON_KT || (this.prot === 2 && ias > vmax - MAX_SPD_OFF_KT))) want = 2;
    }
    if (want !== 0 && this.prot === 0) {
      if (!at.engaged) at.pressEngage(); // BCA: the A/T engages automatically for the protection
      for (let k = 0; k < 2; k++) this.lever[k] = v.get(LEVERS[k]);
    }
    this.prot = at.engaged ? want : 0;
    if (this.prot !== 0) {
      for (let k = 0; k < 2; k++) {
        let x = this.lever[k];
        if (this.prot === 1) x = Math.min(TLA.to, x + SERVO * dt);
        else if (ias > vmax - MAX_SPD_ON_KT) x = Math.max(0, x - SERVO * dt);
        this.lever[k] = x;
        v.set(LEVERS[k], x);
      }
      v.setString(AP.athrMode, this.prot === 1 ? 'MIN SPD' : 'MAX SPD');
    }
    v.set(V.atProt, this.prot);

    // ---------------- Emergency Descent Mode
    const apOn = v.get(AP.engaged) !== 0;
    const alt = v.get('adc1.press_alt_ft');
    const cabin = v.get('press.cabin_alt_ft');
    if (!this.edm && apOn && air && cabin > EDM_CABIN_FT && alt > EDM_MIN_ALT_FT) {
      this.edm = true;
      this.edmLevel = false;
      let hdg = v.get('ahrs1.hdg_mag_deg') - 90;
      if (hdg < 0) hdg += 360;
      v.set(AP.selHeading, Math.round(hdg));
      v.set(AP.selAltitude, EDM_TARGET_FT);
      v.set(AP.speedIsMach, 0);
      if (this.afcs.lat !== 'HDG') this.afcs.press('HDG');
      if (this.afcs.vert !== 'FLC') this.afcs.press('FLC');
      if (!at.engaged) at.pressEngage();
    }
    if (this.edm) {
      const lat = this.afcs.lat;
      const vert = this.afcs.vert;
      const ours = apOn && lat === 'HDG' && (vert === 'FLC' || vert === 'ALTS' || vert === 'ALT');
      if (!ours) this.edm = false;
      else if (!this.edmLevel) {
        const mach = v.get(ADC.mach(1));
        const tgt = mach > 0.1 ? Math.min(EDM_KT, (ias * EDM_MACH) / mach) : EDM_KT;
        v.set(AP.selSpeed, Math.round(tgt));
        if (vert === 'ALT' && Math.abs(alt - EDM_TARGET_FT) < 300) {
          this.edmLevel = true;
          v.set(AP.selSpeed, EDM_LEVEL_KT);
          this.edm = false;
        }
      }
    }
    v.set(V.edmActive, this.edm ? 1 : 0);
  }

  reset(): void {
    this.prot = 0;
    this.edm = false;
    this.edmLevel = false;
  }
}
