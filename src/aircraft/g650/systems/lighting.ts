/**
 * Gulfstream G650 lighting (overhead EXTERIOR LIGHTS and interior controls;
 * G650ER overhead photograph, LUC electrical).
 *
 * Exterior (LED, output `light.<name>` 0..1 for the exterior renderer, which
 * converts to candela x world.render_units_per_lux): position lights (wing
 * tips / tail), red beacons (top of the fin and belly), white anti-collision
 * strobes (wing tips, tail), L/R landing lights (wing roots), nose-gear taxi
 * light, recognition lights, tail logo floods, wing inspection lights.
 * LIM: landing lights on the ground limited to 10 minutes (crew limitation).
 * Emergency lights: OFF / ARM / ON; ARM lights them when the emergency buses
 * lose normal power (EST standard Part 25 arming logic).
 * Interior: PANEL (integral) and FLOOD knobs, DOME, pilot / copilot map lights,
 * DU brightness knobs, SEAT BELT / NO SMOKE signs (cabin power).
 */
import type { SimContext } from '../../../core/SimContext';
import { LightingSystem, FLASH_PATTERNS } from '../../../systems/lighting';
import { G650_VARS as V } from '../vars';

export function createLighting(ctx: Pick<SimContext, 'vars'>): LightingSystem {
  const on = (sw: string) => `${sw} == 1 ? 1 : 0`;
  return new LightingSystem(ctx.vars, {
    exterior: [
      { name: 'nav', on: on(V.ltNav), power: 'elec.nav_lts_powered', tech: 'led' },
      { name: 'beacon', on: on(V.ltBeacon), power: 'elec.beacon_powered', pattern: FLASH_PATTERNS.beaconFlash, tech: 'led' },
      { name: 'beacon_lower', on: on(V.ltBeacon), power: 'elec.beacon_powered', pattern: FLASH_PATTERNS.beaconFlash, phaseS: 0.5, tech: 'led' },
      { name: 'strobe', on: on(V.ltStrobe), power: 'elec.strobe_powered', pattern: FLASH_PATTERNS.doubleStrobe, tech: 'led' },
      { name: 'strobe_tail', on: on(V.ltStrobe), power: 'elec.strobe_powered', pattern: FLASH_PATTERNS.doubleStrobe, phaseS: 0.25, tech: 'led' },
      { name: 'landing_l', on: on(V.ltLdgL), power: 'elec.ldg_lt_l_powered', tech: 'led' },
      { name: 'landing_r', on: on(V.ltLdgR), power: 'elec.ldg_lt_r_powered', tech: 'led' },
      // Taxi light on the nose gear: only while the gear is down (EST interlock).
      { name: 'taxi', on: `${V.ltTaxi} == 1 && gear.pos0 > 0.95 ? 1 : 0`, power: 'elec.taxi_lt_powered', tech: 'led' },
      { name: 'recognition', on: on(V.ltRecog), power: 'elec.recog_powered', tech: 'led' },
      { name: 'logo', on: on(V.ltLogo), power: 'elec.logo_powered', tech: 'led' },
      { name: 'wing', on: on(V.ltWing), power: 'elec.wing_insp_powered', tech: 'led' },
      { name: 'emer', on: `${V.ltEmer} == 2 || (${V.ltEmer} == 1 && !elec.l_ess_dc_powered && !elec.r_ess_dc_powered) ? 1 : 0`, tech: 'led' },
    ],
    dimmers: [
      { id: 'panel', knob: V.ltPanel, power: 'elec.panel_lts_powered', output: ['ac.light.panel'] },
      { id: 'flood', knob: V.ltFlood, power: 'elec.panel_lts_powered', output: ['ac.light.flood'] },
      { id: 'dome', knob: `${V.ltDome} == 1 ? 1 : 0`, power: 'elec.panel_lts_powered || elec.emer_dc_powered', output: ['ac.light.dome'] },
      { id: 'map_l', knob: V.ltMapL, power: 'elec.l_ess_dc_powered', output: ['ac.light.map_l'] },
      { id: 'map_r', knob: V.ltMapR, power: 'elec.r_ess_dc_powered', output: ['ac.light.map_r'] },
      // DU brightness (Epic display ids epic.du1..4), never fully dark (EST min 5 %).
      { id: 'du1_brt', knob: V.duBrt(1), min: 0.05, output: ['display.epic.du1.brt'] },
      { id: 'du2_brt', knob: V.duBrt(2), min: 0.05, output: ['display.epic.du2.brt'] },
      { id: 'du3_brt', knob: V.duBrt(3), min: 0.05, output: ['display.epic.du3.brt'] },
      { id: 'du4_brt', knob: V.duBrt(4), min: 0.05, output: ['display.epic.du4.brt'] },
      { id: 'seatbelt', knob: `${V.seatBelt} == 1 ? 1 : 0`, power: 'elec.aux_dc_powered || elec.gsb_powered', output: ['ac.light.seatbelt'] },
      { id: 'no_smoking', knob: `${V.noSmoke} == 1 ? 1 : 0`, power: 'elec.aux_dc_powered || elec.gsb_powered', output: ['ac.light.no_smoking'] },
    ],
  });
}
