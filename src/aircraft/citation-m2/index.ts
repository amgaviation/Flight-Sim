/**
 * Cessna Citation M2 (Model 525, serials 525-0800 and on): aircraft module.
 *
 *  - meta.ts / fdm.ts: catalog data and the flight model (TCDS A1WI / EASA
 *    IM.A.078, Textron S&D and Flight Planning Guide; docs/aircraft/citation-m2.md).
 *  - createSystems.ts: electrical, fuel, hydraulics, bleed / ECS,
 *    pressurization, ice, fire, oxygen, sensors, gear, FADEC, G3000 suite,
 *    GFC 700 AFCS, warnings, CAS, lighting.
 *  - cockpit/: the 3D flight deck bound to the system vars; exterior.ts: the
 *    procedural airframe; states.ts: initial-state presets; checklists.ts.
 */
import type { AircraftInstance, AircraftModule, InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import type { CockpitDisplay } from '../../cockpit/types';
import { M2_META } from './meta';
import { CITATION_M2_FDM } from './fdm';
import { createSystems } from './createSystems';
import { applyM2State } from './states';
import { M2_CHECKLISTS } from './checklists';
import { M2_INPUT_MAP } from './inputMap';
import { buildM2Cockpit } from './cockpit';
import { Esi1000Display, HourMeterDisplay, ESI_VARS } from './cockpit/displays';
import { GTC_PUSH_VAR } from './cockpit/logic';
import { createM2Exterior } from './exterior';

/** Canvas-backed cockpit displays that need a DOM (or OffscreenCanvas); none headless. */
function cockpitDisplays(ctx: SimContext): CockpitDisplay[] {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return [];
  return [new Esi1000Display(ctx.vars), new HourMeterDisplay(ctx.vars)];
}

const module: AircraftModule = {
  meta: M2_META,
  fdm: CITATION_M2_FDM,

  create(ctx: SimContext): AircraftInstance {
    const sys = createSystems(ctx, { checklists: M2_CHECKLISTS });
    const cockpit = buildM2Cockpit(ctx, { displays: [...sys.suite.displayList(), ...cockpitDisplays(ctx)] });
    const exterior = createM2Exterior(ctx.vars);
    const systems = [...sys.list, ...cockpit.systems];

    const applyState = (s: InitialState): void => {
      const v = ctx.vars;
      for (let i = 1; i <= 4; i++) v.set(ESI_VARS.button(i), 0);
      v.set(ESI_VARS.brtOffset, 0);
      v.set(GTC_PUSH_VAR('gtc1'), 0);
      v.set(GTC_PUSH_VAR('gtc2'), 0);
      applyM2State(ctx, sys, s);
      // Standby baro follows the local QNH like the G3000 sides (applyM2State sets adc1..3).
      v.set('adc3.baro_std', 0);
    };

    return {
      systems,
      cockpit: cockpit.build,
      exterior: exterior.root,
      updateExterior: exterior.update,
      applyState,
      checklists: M2_CHECKLISTS,
      inputMap: M2_INPUT_MAP,
      dispose(): void {
        for (const s of systems) s.dispose?.();
        exterior.dispose();
      },
    };
  },
};

export default module;
