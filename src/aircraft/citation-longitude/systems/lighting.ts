/**
 * Citation Longitude lighting (OG Section 16).
 *
 * Exterior (all LED): red/green/white navigation (GTC Exterior Lights page;
 * automatically ON at G5000 power-up), beacon (red flashing, GTC mode OFF /
 * NORM = on while an engine is at RUN or a starter is engaged / ON),
 * anti-collision (white flashing, ANTI COLL button; the same fixtures as the
 * beacon on the tail bullet and belly, plus one white on the bullet trailing
 * edge), belly landing lights L/R that double as recognition (steady, low
 * intensity) and pulse lights (alternating flash; manual PULSE button or
 * automatic on a TCAS TA/RA when enabled on the GTC); nose-gear taxi light with
 * wingtip downwash lights; wing inspection lights; tail flood (logo) lights.
 * Recognition/pulse cannot be selected together with the landing function.
 *
 * Interior: PANEL (label backlighting, DAY = full), FLOOD, AUX knobs on the
 * overhead; dual-concentric PFD/GTC dimmers outboard on each lower panel,
 * MFD/GTC dimmer on the forward pedestal; MAP LIGHT knobs; EMER LTS switch
 * (ARM = on automatically when the emergency buses lose power), PASS SAFETY.
 */
import type { SimContext } from '../../../core/SimContext';
import { LightingSystem, FLASH_PATTERNS } from '../../../systems/lighting';
import { LON_VARS as V } from '../vars';

/** Pulse-light pattern: the two belly lights flash alternately ~45/min (EST, Precise Flight Pulselite class). */
const PULSE = { kind: 'flash' as const, periodS: 1.3, windows: [0, 0.55] };

export function createLighting(ctx: Pick<SimContext, 'vars'>): LightingSystem {
  const ldgFn = (sw: string) => `${sw} ? 1 : 0`;
  const recogOrPulse = `!${V.ltLdgL} && !${V.ltLdgR}`;
  const pulseOn = `${recogOrPulse} && (${V.ltPulse} || (${V.ltAutoPulse} && (tcas.ta > 0 || tcas.ra > 0)))`;
  const beacon = `${V.ltBeaconMode} == 2 || (${V.ltBeaconMode} == 1 && (${V.runL} || ${V.runR} || fadec.eng1.starter_cmd || fadec.eng2.starter_cmd))`;
  return new LightingSystem(ctx.vars, {
    exterior: [
      { name: 'nav', on: V.ltNav, power: 'elec.ext_lt_nav_powered', tech: 'led' },
      { name: 'beacon', on: beacon, power: 'elec.mission_l_powered', pattern: FLASH_PATTERNS.beaconFlash, tech: 'led' },
      { name: 'beacon_lower', on: beacon, power: 'elec.mission_l_powered', pattern: FLASH_PATTERNS.beaconFlash, phaseS: 0.6, tech: 'led' },
      { name: 'strobe', on: V.ltAntiColl, power: 'elec.ext_lt_strobe_powered', pattern: FLASH_PATTERNS.doubleStrobe, tech: 'led' },
      { name: 'strobe_tail', on: V.ltAntiColl, power: 'elec.ext_lt_strobe_powered', pattern: FLASH_PATTERNS.doubleStrobe, phaseS: 0.3, tech: 'led' },
      { name: 'landing_l', on: ldgFn(V.ltLdgL), power: 'elec.ldg_lt_l_powered', tech: 'led' },
      { name: 'landing_r', on: ldgFn(V.ltLdgR), power: 'elec.ldg_lt_r_powered', tech: 'led' },
      // Recognition: steady low intensity (EST 25 % of the landing function).
      { name: 'recognition', on: `${recogOrPulse} && ${V.ltRecog} && !(${pulseOn}) ? 0.25 : 0`, power: 'elec.ext_lt_recog_powered', tech: 'led' },
      { name: 'pulse_l', on: pulseOn, power: 'elec.ext_lt_recog_powered', pattern: PULSE, tech: 'led' },
      { name: 'pulse_r', on: pulseOn, power: 'elec.ext_lt_recog_powered', pattern: PULSE, phaseS: 0.65, tech: 'led' },
      { name: 'taxi', on: V.ltTaxi, power: 'elec.ext_lt_taxi_powered', tech: 'led' },
      { name: 'wingtip_taxi', on: V.ltTaxi, power: 'elec.ext_lt_taxi_powered', tech: 'led' }, // wingtip downwash lights (OG 16-4)
      { name: 'wing', on: V.ltWingInsp, power: 'elec.wing_insp_powered', tech: 'led' },
      { name: 'logo', on: V.ltTailFlood, power: 'elec.tail_flood_powered', tech: 'led' },
      // Emergency lights: ON, or ARM with both emergency buses unpowered (EST standard Part 25 arming logic).
      { name: 'emer', on: `${V.ltEmer} == 2 || (${V.ltEmer} == 1 && !elec.emer_l_powered && !elec.emer_r_powered)`, tech: 'led' },
    ],
    dimmers: [
      { id: 'panel', knob: V.ltPanel, power: 'elec.panel_lts_powered', output: ['ac.light.panel'] },
      { id: 'flood', knob: V.ltFlood, power: 'elec.panel_lts_powered', output: ['ac.light.flood'] },
      { id: 'aux', knob: V.ltAux, power: 'elec.panel_lts_powered', output: ['ac.light.aux'] },
      { id: 'map_l', knob: V.ltMapL, power: 'elec.emer_l_powered', output: ['ac.light.map_l'] },
      { id: 'map_r', knob: V.ltMapR, power: 'elec.emer_r_powered', output: ['ac.light.map_r'] },
      // Display brightness (G5000 display.<id>.brt), never fully dark (EST min 5 %).
      { id: 'pfd_l', knob: V.ltPfdL, min: 0.05, output: ['display.pfd1.brt'] },
      { id: 'gtc_l', knob: V.ltGtcL, min: 0.05, output: ['display.gtc1.brt'] },
      { id: 'mfd', knob: V.ltMfd, min: 0.05, output: ['display.mfd.brt'] },
      { id: 'gtc_c', knob: V.ltGtcC, min: 0.05, output: ['display.gtc2.brt', 'display.gtc3.brt'] },
      { id: 'pfd_r', knob: V.ltPfdR, min: 0.05, output: ['display.pfd2.brt'] },
      { id: 'gtc_r', knob: V.ltGtcR, min: 0.05, output: ['display.gtc4.brt'] },
      { id: 'pass_safety', knob: `${V.ltSeatBelt} >= 1`, power: 'elec.int_l_powered || elec.int_r_powered', output: ['ac.light.seatbelt'] },
      { id: 'no_smoking', knob: `${V.ltSeatBelt} == 2`, power: 'elec.int_l_powered || elec.int_r_powered', output: ['ac.light.no_smoking'] },
    ],
  });
}
