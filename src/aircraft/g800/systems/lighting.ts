/**
 * G800 lighting. Exterior lights from the Symmetry OHPTS LIGHTS page (Epic
 * overhead definitions: NAV, BEACON, STROBE, L/R LANDING, TAXI, RECOG, LOGO,
 * WING INSP; interior SEAT BELT, NO SMOKE, EMER LTS OFF/ARM/ON, DOME, PANEL and
 * FLOOD dimmers). All exterior fixtures EST LED (G700/G800 generation).
 * Anti-collision flash rates per 14 CFR 25.1401(c) (40-100 flashes/min).
 * The landing lights double as recognition lights at reduced intensity (EST).
 */
import type { SimContext } from '../../../core/SimContext';
import { LightingSystem, FLASH_PATTERNS } from '../../../systems/lighting';
import { G800_VARS as V } from '../vars';

export function createLighting(ctx: Pick<SimContext, 'vars'>): LightingSystem {
  return new LightingSystem(ctx.vars, {
    exterior: [
      { name: 'nav', on: V.ltNav, power: 'elec.ext_nav_powered', tech: 'led' },
      { name: 'beacon', on: V.ltBeacon, power: 'elec.ext_beacon_powered', pattern: FLASH_PATTERNS.beaconFlash, tech: 'led' },
      { name: 'beacon_lower', on: V.ltBeacon, power: 'elec.ext_beacon_powered', pattern: FLASH_PATTERNS.beaconFlash, phaseS: 0.6, tech: 'led' },
      { name: 'strobe', on: V.ltStrobe, power: 'elec.ext_strobe_powered', pattern: FLASH_PATTERNS.doubleStrobe, tech: 'led' },
      { name: 'strobe_tail', on: V.ltStrobe, power: 'elec.ext_strobe_powered', pattern: FLASH_PATTERNS.doubleStrobe, phaseS: 0.3, tech: 'led' },
      { name: 'landing_l', on: V.ltLandingL, power: 'elec.ext_ldg_l_powered', tech: 'led' },
      { name: 'landing_r', on: V.ltLandingR, power: 'elec.ext_ldg_r_powered', tech: 'led' },
      // Recognition: the landing-light fixtures at low intensity when the landing function is off (EST 25 %).
      { name: 'recognition', on: `${V.ltRecog} && !${V.ltLandingL} && !${V.ltLandingR} ? 0.25 : 0`, power: 'elec.ext_recog_powered', tech: 'led' },
      { name: 'taxi', on: V.ltTaxi, power: 'elec.ext_taxi_powered', tech: 'led' },
      { name: 'wing', on: V.ltWing, power: 'elec.ext_wing_powered', tech: 'led' },
      { name: 'logo', on: V.ltLogo, power: 'elec.ext_logo_powered', tech: 'led' },
      { name: 'emer', on: 'ac.g800.emer_lts_on', power: 'elec.emer_lts_powered', tech: 'led' },
    ],
    dimmers: [
      { id: 'panel', knob: V.ltPanel, power: 'elec.panel_lts_powered', output: ['ac.light.panel'] },
      { id: 'flood', knob: V.ltFlood, power: 'elec.panel_lts_powered', output: ['ac.light.flood'] },
      { id: 'dome', knob: V.ltDome, power: 'elec.panel_lts_powered', output: ['ac.light.dome'] },
      { id: 'seatbelt', knob: V.ltSeatbelt, power: 'elec.cabin_signs_powered', output: ['ac.light.seatbelt'] },
      { id: 'no_smoking', knob: V.ltNoSmoke, power: 'elec.cabin_signs_powered', output: ['ac.light.no_smoking'] },
    ],
  });
}
