/**
 * Citation M2 cabin / cockpit services that belong to the sidewall and
 * overhead equipment (appended to the aircraft systems list by the sidewall
 * part, after every airframe system):
 *
 *  - DME-4000 power: the Collins DME-4000 (S&D15 §10.3, dossier §6.10) is the
 *    only DME source, on its own AVN 2 breaker (`cb.dme`). The shared radio
 *    model has no DME power input, so with `elec.dme_powered` = 0 the DME
 *    outputs (`nav1/2.dme_valid`) are forced invalid after the radios update
 *    (the PFD DME fields then show dashes).
 *  - 110 V AC outlet (S&D15 §9.4: "A 500 watt inverter supplies 110 volt AC
 *    power to three outlets: one in the copilot's sidewall and two in the
 *    cabin"; CAE CJ-family differences p. 5-26: "An ON/OFF switch located in
 *    the wall outlet turns the inverter ON when a plug is inserted ... The
 *    inverter will not function with the battery switch in the EMER
 *    position"). The plug var enables the inverter load (systems/electrical.ts);
 *    this block publishes the outlet voltage for the outlet's power LED.
 *  - Emergency lighting battery pack (S&D15 §14 "Emergency Lighting Battery
 *    Pack", "Exterior LED Emergency Exit Lighting"; CAE p. 5-24/5-27: no
 *    emergency-lighting switch on the CJ/CJ1/CJ2, "a small battery in the
 *    cabin headliner which will power the interior exit lights any time a
 *    sensor is exposed to a lateral force and aft force of 5 Gs or more").
 *    Output `ac.m2.emer_lts` (1 while lit). EST: 10 min pack endurance (the
 *    14 CFR 25.812(k) figure; the Part 23 M2 value is not public).
 *
 * Allocation-free per update.
 */
import type { SimContext } from '../../../../core/SimContext';
import type { Subsystem } from '../../../types';
import { FDM, NAV } from '../../../../core/vars';

/** Vars owned by the sidewall / overhead equipment. */
export const M2_SIDE_VARS = {
  /** Copilot sidewall 110 V outlet: 1 = a plug is inserted (the outlet's switch turns the inverter on). */
  outletPlug: 'ac.m2.ac_outlet_plug',
  /** Outlet voltage (V AC), 0 when the inverter is off / unpowered. */
  outletV: 'ac.m2.ac_outlet_v',
  /** Emergency exit / interior emergency lights lit (battery pack, inertia switch). */
  emerLights: 'ac.m2.emer_lts',
  /** Emergency lighting battery pack charge 0..1. */
  emerPack: 'ac.m2.emer_lts_pack',
  /** Crew oxygen mask PRESS TO TEST buttons (momentary). */
  maskTest: (side: number) => `ac.m2.mask${side}_test`,
} as const;

/** Inertia switch threshold (g), CAE CJ-family text. */
const INERTIA_G = 5;
/** Battery pack endurance (s). EST: 10 min (14 CFR 25.812(k) practice). */
const PACK_S = 600;
/** Pack recharge time from empty on the hot battery bus (s). EST. */
const RECHARGE_S = 4 * 3600;

export class M2CabinServices implements Subsystem {
  readonly name = 'm2.cabin_services';
  private latched = false;
  private pack = 1;

  constructor(private readonly ctx: Pick<SimContext, 'vars'>) {}

  update(dt: number): void {
    const v = this.ctx.vars;
    // ---- DME-4000 power (breaker / AVN 2 bus).
    if (v.get('elec.dme_powered') === 0) {
      v.set(NAV.dmeValid(1), 0);
      v.set(NAV.dmeValid(2), 0);
    }
    // ---- 110 V outlet (500 W inverter on the R XFEED bus).
    const inv = v.get('elec.inverter_powered') !== 0 && v.get(M2_SIDE_VARS.outletPlug) !== 0;
    v.set(M2_SIDE_VARS.outletV, inv ? 115 : 0); // EST 115 V nominal ("110 volt" outlets)
    // ---- Emergency lighting battery pack: 5 g inertia switch (lateral or aft/fore), latched until the pack is empty.
    const g = Math.max(Math.abs(v.get(FDM.nx)), Math.abs(v.get(FDM.ny)));
    if (g >= INERTIA_G) this.latched = true;
    if (this.latched) {
      this.pack = Math.max(0, this.pack - dt / PACK_S);
      if (this.pack <= 0) this.latched = false;
    } else if (v.get('elec.hot_batt_powered') !== 0) this.pack = Math.min(1, this.pack + dt / RECHARGE_S);
    v.set(M2_SIDE_VARS.emerLights, this.latched ? 1 : 0);
    v.set(M2_SIDE_VARS.emerPack, this.pack);
  }

  reset(): void {
    this.latched = false;
    this.pack = 1;
  }
}
