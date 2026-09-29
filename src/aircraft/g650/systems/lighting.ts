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
 * COCKPIT LIGHTS MASTER CONTROL (G650 training material): OFF = day (annunciators
 * full bright, integral panel backlighting off); night range = annunciators dimmed
 * and panel backlighting on (PANEL knob level); full clockwise = annunciators full
 * bright; ORIDE = also the overhead dome light and the side-console floodlights
 * (modelled by the map lights, which light the consoles) at full, the Gulfstream
 * equivalent of a thunderstorm light. The annunciator dimming follows the knob
 * continuously through the night range (training material). The integral
 * backlighting follows the PANEL knob whenever MASTER is out of OFF; with MASTER
 * at OFF a reduced standby level remains only while the scene is dark
 * (env.ambient_light < 0.3): by day the standby is extinguished, and a night
 * start before the renderer writes env.ambient_light (it defaults to 0) still
 * shows dim legends.
 * VEST LTS ORIDE (side console) forces the vestibule lights off; SCOPE: the cabin is
 * not rendered, the vestibule light is state only (`ac.light.vestibule`).
 */
import type { SimContext } from '../../../core/SimContext';
import { LightingSystem, FLASH_PATTERNS } from '../../../systems/lighting';
import { G650_VARS as V } from '../vars';

export function createLighting(ctx: Pick<SimContext, 'vars'>): LightingSystem {
  const on = (sw: string) => `${sw} == 1 ? 1 : 0`;
  const ORIDE = `${V.ltMaster} > 1.05`;
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
      // Integral panel backlighting: full PANEL-knob level only in the MASTER night range (training material:
      // backlighting illuminates when MASTER leaves OFF); with MASTER at OFF (day) a reduced standby level
      // remains as the day stand-in for the sunlit legends (see the SCOPE note above - the renderer washes it
      // out in daylight, and a night start with MASTER untouched still shows dim legends).
      // With MASTER at OFF the standby stand-in level is additionally extinguished in daylight once the
      // renderer publishes the ambience (env.ambient_light; 0 while unwritten, e.g. a night start before the
      // first frame, which keeps night starts lit - see the SCOPE note above).
      { id: 'panel', knob: `${V.ltMaster} >= 0.005 ? ${V.ltPanel} : (env.ambient_light < 0.3 ? 0.35 * ${V.ltPanel} : 0)`, power: 'elec.panel_lts_powered', output: ['ac.light.panel'] },
      { id: 'flood', knob: V.ltFlood, power: 'elec.panel_lts_powered', output: ['ac.light.flood'] },
      { id: 'dome', knob: `${V.ltDome} == 1 || ${ORIDE} ? 1 : 0`, power: 'elec.panel_lts_powered || elec.emer_dc_powered', output: ['ac.light.dome'] },
      { id: 'map_l', knob: `max(${V.ltMapL}, ${ORIDE} ? 1 : 0)`, power: 'elec.l_ess_dc_powered', output: ['ac.light.map_l'] },
      { id: 'map_r', knob: `max(${V.ltMapR}, ${ORIDE} ? 1 : 0)`, power: 'elec.r_ess_dc_powered', output: ['ac.light.map_r'] },
      // Annunciators full bright in day mode (MASTER OFF); in the night range the brightness follows the knob
      // CONTINUOUSLY (G650 training material: rotating MASTER from OFF dims the annunciators, full clockwise
      // brings them to full bright): dimmest just past OFF, rising linearly to full at the clockwise stop.
      // Cockpit consumers floor the value at their dim level (Lighting.annunciatorLevel).
      { id: 'annun_bright', knob: `${V.ltMaster} < 0.005 ? 1 : min(1, 0.3 + 0.7 * ${V.ltMaster})`, output: [V.annunBright] },
      // Vestibule (entry area) lights: on with cabin power unless VEST LTS ORIDE (SCOPE: state only).
      { id: 'vestibule', knob: `${V.cabinMaster} == 1 && ${V.vestOride} == 0 ? 1 : 0`, power: 'elec.cabin_dc_powered', output: ['ac.light.vestibule'] },
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
