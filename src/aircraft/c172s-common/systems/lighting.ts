/**
 * Cessna 172S lighting (POH Sec 7 "Lighting systems"; docs/aircraft/c172s.md §5.8).
 *
 * Exterior: navigation lights on the wing tips and the top of the rudder, landing and taxi
 * lights in the left wing leading edge, a flashing beacon on top of the fin and a strobe on
 * each wing tip; courtesy lights under each wing with the rear dome light (overhead switch).
 * Interior dimmers:
 *  - steam: PANEL LT (instrument post/internal lights), RADIO LT (avionics displays and NAV
 *    indicators), GLARESHIELD LT, PEDESTAL LT; front flood lights (push switches); control
 *    wheel map light (rheostat, needs the NAV light switch);
 *  - G1000: SW/CB PANELS, PEDESTAL, AVIONICS (0 = display photocells), STBY IND; front flood
 *    light dimmers; control wheel map light.
 * Dimmer outputs are `ac.light.<id>` (read by the cockpit Lighting zones, src/cockpit/Lighting.ts)
 * plus `ac.light.instruments` for the analog instrument lighting (ANALOG_VARS.instrumentLight).
 *
 * Lamp technology: the steam 172S (1998-2004 POH) used incandescent/halogen exterior lamps and
 * a flashing beacon; the current NXi Skyhawk uses LED exterior lighting (Textron Aviation
 * Skyhawk specification: LED landing, taxi, navigation and strobe lights).
 */
import type { SimContext } from '../../../core/SimContext';
import { LightingSystem, FLASH_PATTERNS, type DimmerDef, type ExteriorLightDef } from '../../../systems/lighting';
import { ANN_SW, C172 } from '../vars';
import type { C172Variant } from './electrical';

export function createC172Lighting(ctx: Pick<SimContext, 'vars'>, variant: C172Variant): LightingSystem {
  const g = variant === 'g1000';
  const lamp = g ? 'led' : 'incandescent';
  const exterior: ExteriorLightDef[] = [
    { name: 'nav', on: C172.nav, power: 'elec.nav_lts_powered', tech: lamp },
    { name: 'beacon', on: C172.beacon, power: 'elec.beacon_powered', pattern: FLASH_PATTERNS.beaconFlash, tech: g ? 'led' : 'incandescent' },
    { name: 'strobe', on: C172.strobe, power: 'elec.strobe_lts_powered', pattern: FLASH_PATTERNS.doubleStrobe, tech: g ? 'led' : 'xenon' },
    { name: 'landing', on: C172.land, power: 'elec.land_lt_powered', tech: g ? 'led' : 'halogen' },
    { name: 'taxi', on: C172.taxi, power: 'elec.taxi_lt_powered', tech: g ? 'led' : 'halogen' },
    { name: 'courtesy', on: C172.domeCourtesy, power: 'elec.dome_courtesy_powered', tech: 'incandescent' },
  ];
  const dimmers: DimmerDef[] = g
    ? [
        // POH NAV III Sec 7 "Interior lighting" DIMMING group.
        { id: 'panel', knob: C172.dimPanel, power: 'elec.panel_lts_powered', output: ['ac.light.panel', 'ac.light.switch_cb'] },
        { id: 'pedestal', knob: C172.dimPedestal, power: 'elec.pedestal_lt_powered' },
        // AVIONICS dimmer: 0 = photocell automatic (the G1000 variant decides the display level).
        { id: 'avionics', knob: C172.dimRadio, power: 'elec.panel_lts_powered' },
        { id: 'stby_ind', knob: C172.dimStbyInd, power: 'elec.stby_ind_lts_powered', output: ['ac.light.stby_ind', 'ac.light.instruments'] },
        { id: 'flood', knob: `max(${C172.floodLeft}, ${C172.floodRight})`, power: 'elec.flood_lts_powered' },
        { id: 'map', knob: C172.mapLight, power: 'elec.map_lt_powered' },
      ]
    : [
        // POH Sec 7 "Interior lighting": PANEL LT, RADIO LT, GLARESHIELD LT, PEDESTAL LT dimmers.
        { id: 'panel', knob: C172.dimPanel, power: 'elec.panel_lts_powered', output: ['ac.light.panel', 'ac.light.instruments'] },
        // "In addition to the RADIO LT dimmer, lighting intensity for the avionics displays and the NAV
        // indicators ... is controlled by the annunciator panel test switch. When the switch is in the BRT ...
        // or DAY position, this lighting may be off regardless of the RADIO LT dimmer position" (POH Sec 7
        // "Interior lighting"): radio lighting only with the switch in DIM (ANN_SW.night = 0).
        { id: 'radio', knob: `${C172.dimRadio} * (${C172.annSwitch} == ${ANN_SW.night})`, power: 'elec.panel_lts_powered' },
        { id: 'glareshield', knob: C172.dimGlareshield, power: 'elec.glareshield_lt_powered' },
        { id: 'pedestal', knob: C172.dimPedestal, power: 'elec.pedestal_lt_powered' },
        { id: 'flood', knob: `max(${C172.floodLeft}, ${C172.floodRight})`, power: 'elec.flood_lts_powered' },
        { id: 'map', knob: C172.mapLight, power: 'elec.map_lt_powered' },
      ];
  return new LightingSystem(ctx.vars, { exterior, dimmers });
}
