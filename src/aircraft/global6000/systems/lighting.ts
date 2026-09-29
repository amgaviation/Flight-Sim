/**
 * Bombardier Global 6000 lighting (GXLT, GX_01_018 EXTERNAL LIGHTS, PASS
 * SIGNS, EMER LIGHTS; pedestal COCKPIT LIGHTS FLOOD/DISPLAY and
 * INTEGRAL/MISC panels).
 *
 * Exterior (output `light.<name>` 0..1 for the exterior renderer, which
 * converts to candela x world.render_units_per_lux):
 *  - LANDING: one landing / taxi light in each wing fairing leading edge
 *    (L WING / R WING switches) and two sealed-beam lamps on the nose gear
 *    (NLG switch, lit only with the nose gear down, GXLT);
 *  - TAXI/RECOG: taxi lights in each wing leading edge, also used in flight as
 *    recognition lights;
 *  - NAV: wing tip and tail position lights;
 *  - STROBE: three synchronized white strobes (both wing tips, tail);
 *  - BEACON: red/white anti-collision strobes top and bottom of the fuselage;
 *  - WING INSP, LOGO.
 * Emergency lights: OFF / ARM / ON; ARM lights them on loss of DC ESS and BATT
 * BUS power (EST Part 25 arming logic).
 * Interior (Global Vision COCKPIT LIGHTS panel, photo EB190582 aft-right
 * pedestal; GX PTG 15-5 .. 15-13): AREA (OFF .. BRT: the cockpit area / flood
 * lights), INTEGRAL OVHD / CB / L / CTR / R knobs (panel back-lighting),
 * MASTER INTEG ON / AUTO / OFF (PTG 15-11: "AUTO ... turned on/off through a
 * light sensor circuit depending on the ambient lighting"), PBA DIM / BRT
 * (switchlight legends, PTG 15-13), EYE REF ON / OFF (eye-reference light,
 * PTG 15-12), FOOT ON / OFF (floor lights, PTG 15-13); DISPLAY L / CTR / R
 * knobs on the reversion panel set the AFD brightness; DOME, map lights, pass
 * signs.
 * Landing lights (PTG 15-28): L WING / NLG / R WING OFF / PULSE / STEADY;
 * PULSE cycles the lights at 45 pulses per minute, L wing and R wing
 * alternately, each NLG lamp with its wing light (V.ldgPulse, logic.ts).
 * TAXI/RECOG (PTG 15-28): ON = wing taxi lights (recognition in flight),
 * WINGTIP = wingtip taxi lights.
 */
import type { SimContext } from '../../../core/SimContext';
import { LightingSystem, FLASH_PATTERNS } from '../../../systems/lighting';
import { G6K_VARS as V } from '../vars';

/**
 * Derived lighting states the LightingSystem bindings read: EMER LIGHTS on (ON, or ARM with DC ESS lost; GX PTG 15-35)
 * and the beacon colour (RED 1 / WHT 2). Runs before the LightingSystem.
 */
export class G6kLightingLogic {
  readonly name = 'g6k.lighting_logic';
  constructor(private readonly v: SimContext['vars']) {}
  update(): void {
    const v = this.v;
    const sw = v.get(V.emerLights);
    v.set(V.emerLtsOn, sw === 2 || (sw === 1 && v.get('elec.dc_ess_powered') === 0) ? 1 : 0);
    v.set(V.beaconRed, v.get(V.ltBeacon) === 2 ? 0 : 1);
  }
}

export function createLighting(ctx: Pick<SimContext, 'vars'>): LightingSystem {
  const on = (sw: string) => `${sw} == 1 ? 1 : 0`;
  // MASTER DIM: OFF = full knob range, DIM = x0.5, BRT = full (EST reading of the GXLT integral lighting description).
  // MASTER INTEG: OFF 0 / AUTO 1 / ON 2. AUTO: photocell, on below EST 35 % ambient light (env.ambient_light).
  const master = `${V.ltMaster} == 2 ? 1 : ${V.ltMaster} == 1 && env.ambient_light < 0.35 ? 1 : 0`;
  // Landing light switch: 0 OFF, 1 STEADY, 2 PULSE (L side lit while V.ldgPulse = 1, R side while 0).
  const ldg = (sw: string, left: boolean) => `${sw} == 1 || (${sw} == 2 && ${left ? '' : '!'}${V.ldgPulse}) ? 1 : 0`;
  return new LightingSystem(ctx.vars, {
    exterior: [
      { name: 'nav', on: on(V.ltNav), power: 'elec.nav_lts_powered', tech: 'led' },
      // GXLT: fuselage red/white anti-collision strobes (upper and lower), EST 50 flashes/min.
      // BEACON RED / OFF / WHT (GX PTG 15-29: red for ground operation, white as the back-up anti-collision light): the
      // exterior colours the beacon lamps from V.beaconRed (1 red, 0 white).
      { name: 'beacon', on: `${V.ltBeacon} >= 1 ? 1 : 0`, power: 'elec.beacon_powered', pattern: FLASH_PATTERNS.beaconFlash, tech: 'xenon' },
      { name: 'beacon_lower', on: `${V.ltBeacon} >= 1 ? 1 : 0`, power: 'elec.beacon_powered', pattern: FLASH_PATTERNS.beaconFlash, phaseS: 0.5, tech: 'xenon' },
      { name: 'strobe', on: on(V.ltStrobe), power: 'elec.strobe_powered', pattern: FLASH_PATTERNS.singleStrobe, tech: 'xenon' },
      { name: 'strobe_tail', on: on(V.ltStrobe), power: 'elec.strobe_powered', pattern: FLASH_PATTERNS.singleStrobe, tech: 'xenon' }, // synchronized with the wing strobes (GXLT)
      { name: 'landing_l', on: ldg(V.ltLdgL, true), power: 'elec.ldg_lt_l_powered', tech: 'halogen' },
      { name: 'landing_r', on: ldg(V.ltLdgR, false), power: 'elec.ldg_lt_r_powered', tech: 'halogen' },
      // SCOPE: the two NLG lamps are one exterior light; on PULSE it follows the left-wing phase.
      { name: 'landing_nose', on: `(${V.ltLdgNose} == 1 || (${V.ltLdgNose} == 2 && ${V.ldgPulse})) && gear.pos0 > 0.95 ? 1 : 0`, power: 'elec.ldg_lt_nose_powered', tech: 'halogen' },
      // TAXI/RECOG (GX PTG 15-28): 1 ON = wing taxi / recognition lights; 2 WINGTIP = the wing-tip taxi lights
      // (`light.wingtip_taxi`, exterior.ts wing-tip lamps).
      { name: 'taxi', on: on(V.ltTaxi), power: 'elec.taxi_lt_powered', tech: 'halogen' },
      { name: 'recognition', on: on(V.ltTaxi), power: 'elec.taxi_lt_powered', tech: 'halogen' },
      { name: 'wingtip_taxi', on: `${V.ltTaxi} == 2 ? 1 : 0`, power: 'elec.taxi_lt_powered', tech: 'led' },
      { name: 'logo', on: on(V.ltLogo), power: 'elec.logo_powered', tech: 'halogen' },
      { name: 'wing', on: on(V.ltWing), power: 'elec.wing_insp_powered', tech: 'halogen' },
      // EMER LIGHTS (GX PTG 15-35 .. 15-40): ON, or ARM with DC ESS lost; the lights have their own battery packs (no
      // aircraft power binding).
      { name: 'emer', on: V.emerLtsOn, tech: 'led' },
    ],
    dimmers: [
      // AREA knob (Vision pedestal; GX PTG 15-11 "two area lights ... general illumination of the flight compartment",
      // 28 VDC from the AV BATT DIR bus, so they work with BATT MASTER OFF): the glareshield / overhead floods and the
      // ceiling (dome) light of this build. There is no separate DOME switch on the Global overhead.
      { id: 'flood_l', knob: V.ltArea, power: 'elec.flood_lts_powered', output: ['ac.light.flood_l', 'ac.light.flood'] },
      { id: 'flood_c', knob: V.ltArea, power: 'elec.flood_lts_powered', output: ['ac.light.flood_c'] },
      { id: 'flood_r', knob: V.ltArea, power: 'elec.flood_lts_powered', output: ['ac.light.flood_r'] },
      { id: 'eye_ref', knob: `${V.ltEyeRef} == 1 ? 1 : 0`, power: 'elec.dome_map_lts_powered', output: ['ac.light.eye_ref'] },
      { id: 'foot', knob: `${V.ltFoot} == 1 ? 1 : 0`, power: 'elec.dome_map_lts_powered', output: ['ac.light.foot'] },
      { id: 'panel_l', knob: V.ltIntegral('l'), power: 'elec.integral_lts_powered', master, output: ['ac.light.panel_l', 'ac.light.panel'] },
      { id: 'panel_c', knob: V.ltIntegral('c'), power: 'elec.integral_lts_powered', master, output: ['ac.light.panel_c'] },
      { id: 'panel_r', knob: V.ltIntegral('r'), power: 'elec.integral_lts_powered', master, output: ['ac.light.panel_r'] },
      { id: 'panel_cb', knob: V.ltIntegral('cb'), power: 'elec.integral_lts_powered', master, output: ['ac.light.panel_cb'] },
      { id: 'panel_ovhd', knob: V.ltIntegral('ovhd'), power: 'elec.integral_lts_powered', master, output: ['ac.light.panel_ovhd'] },
      { id: 'dome', knob: V.ltArea, power: 'elec.flood_lts_powered', output: ['ac.light.dome'] },
      { id: 'map_l', knob: V.ltMap(1), power: 'elec.dome_map_lts_powered', output: ['ac.light.map_l'] },
      { id: 'map_r', knob: V.ltMap(2), power: 'elec.dome_map_lts_powered', output: ['ac.light.map_r'] },
      // DSPL knobs (reversion panel, photo e_ped_l): L = AFD 1, CTR = AFD 2 + IESI, R = AFD 4, LWR = AFD 3 (lower centre),
      // never fully dark (EST min 5 %). GX PTG 15-6: the L / R DISPLAY knobs also dim the EMS CDUs (side builder).
      { id: 'du_l', knob: V.ltDisplay('l'), min: 0.05, output: ['display.fusion.afd1.brt', 'ac.g6k.light.ems1_dim'] },
      { id: 'du_c', knob: V.ltDisplay('c'), min: 0.05, output: ['display.fusion.afd2.brt', 'display.fusion.iesi.brt'] },
      { id: 'du_lwr', knob: `${V.ltDisplayLwr}`, min: 0.05, output: ['display.fusion.afd3.brt'] },
      { id: 'du_r', knob: V.ltDisplay('r'), min: 0.05, output: ['display.fusion.afd4.brt', 'ac.g6k.light.ems2_dim'] },
      // CTP 1 / 2 BRT / OFF knobs on each CTP (photo N835GL): 0 = display off.
      { id: 'ctp1', knob: V.ltCtp(1), output: ['display.fusion.ctp1.brt'] },
      { id: 'ctp2', knob: V.ltCtp(2), output: ['display.fusion.ctp2.brt'] },
      // PBA DIM / BRT (GX PTG 15-13): switchlight legend level (the cockpit dims the annunciators from it).
      { id: 'pba', knob: `${V.ltPbaDim} == 0 ? 0.3 : 1`, output: ['ac.light.pba'] },
      // PASS SIGNS AUTO (GX PTG 15-20): NO SMKG with the gear selected down or the cabin above 8,000 ft; SEAT BLTS with
      // the gear down, the slats / flaps out of 0 or the cabin above 8,000 ft.
      { id: 'seatbelt', knob: `${V.seatBelts} == 2 || (${V.seatBelts} == 1 && (gear.handle_down || ${V.flapLever} >= 0.5 || press.cabin_alt_ft > 8000)) ? 1 : 0`, power: 'elec.pass_signs_powered', output: ['ac.light.seatbelt'] },
      { id: 'no_smoking', knob: `${V.noSmoking} == 2 || (${V.noSmoking} == 1 && (gear.handle_down || press.cabin_alt_ft > 8000)) ? 1 : 0`, power: 'elec.pass_signs_powered', output: ['ac.light.no_smoking'] },
    ],
  });
}
