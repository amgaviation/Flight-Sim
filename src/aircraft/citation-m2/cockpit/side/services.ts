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
 *  - Passenger signs (PASS SAFETY switch OFF / BELT / BELT & NO SMOKE on the
 *    tilt panel, `cb.pax_signs` on the R XFEED bus): the cabin FASTEN SEAT
 *    BELT / NO SMOKING signs (`ac.m2.pass_belt_lt`, `ac.m2.pass_nosmk_lt`)
 *    and the cabin chime each time a sign comes on or goes off (EST: single
 *    chime, CJ-family practice). SCOPE: the cabin itself is not modelled, so
 *    the signs are published as vars; the chime is heard in the cockpit.
 *  - Fan noise: the glareshield avionics cooling fans (`cb.cockpit_fans`)
 *    and the cabin fan / evaporator blower (`cb.cabin_fan`, OFF / LOW / HIGH)
 *    drive the `fan.avionics` audio loop (EST gains), so a pulled fan breaker
 *    is heard as well as seen (GDU cooling: systems/avionicsHealth.ts;
 *    A/C cooling: systems/airframe.ts).
 *
 * Allocation-free per update.
 */
import type { SimContext } from '../../../../core/SimContext';
import type { Subsystem } from '../../../types';
import { FDM, NAV } from '../../../../core/vars';
import { M2 } from '../../vars';

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
  /** Cabin FASTEN SEAT BELT sign lit. */
  beltSign: 'ac.m2.pass_belt_lt',
  /** Cabin NO SMOKING sign lit. */
  noSmokeSign: 'ac.m2.pass_nosmk_lt',
} as const;

type Loop = ReturnType<SimContext['audio']['loop']>;

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
  private signs = -1;
  private avnFan: Loop | null = null;
  private cabFan: Loop | null = null;

  constructor(private readonly ctx: Pick<SimContext, 'vars'> & Partial<Pick<SimContext, 'audio'>>) {}

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
    // ---- Passenger signs + chime.
    const signPwr = v.get('elec.pax_signs_powered') !== 0;
    const sel = v.get(M2.paxSafety);
    const belt = signPwr && sel >= 1 ? 1 : 0;
    const nosmk = signPwr && sel >= 2 ? 1 : 0;
    v.set(M2_SIDE_VARS.beltSign, belt);
    v.set(M2_SIDE_VARS.noSmokeSign, nosmk);
    const code = belt + 2 * nosmk;
    if (this.signs >= 0 && code !== this.signs && signPwr) this.ctx.audio?.play('chime', { volume: 0.35, position: [2.2, 0, -0.9] });
    this.signs = code;
    // ---- Fan noise (created on the first update; the handles are reused).
    const audio = this.ctx.audio;
    if (audio) {
      if (!this.avnFan) this.avnFan = audio.loop('fan.avionics');
      if (!this.cabFan) {
        this.cabFan = audio.loop('fan.avionics');
        this.cabFan.setRate(0.7);
      }
      this.avnFan.setGain(v.get('elec.cockpit_fans_powered') !== 0 ? 0.05 : 0); // EST
      this.cabFan.setGain(v.get('elec.cabin_fan_powered') !== 0 ? 0.03 * Math.min(2, v.get(M2.cabinFan)) : 0); // EST
    }
  }

  reset(): void {
    this.latched = false;
    this.pack = 1;
    this.signs = -1;
  }

  dispose(): void {
    this.avnFan?.stop();
    this.cabFan?.stop();
    this.avnFan = this.cabFan = null;
  }
}
