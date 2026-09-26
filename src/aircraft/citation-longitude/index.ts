/**
 * Cessna Citation Longitude (Model 700): aircraft module.
 *
 * Systems, FDM, states, checklists and input map: createSystems.ts, fdm.ts,
 * states.ts, checklists.ts, inputMap.ts (dossier docs/aircraft/citation-longitude.md).
 * Cockpit: cockpit/index.ts (Garmin G5000: three GDU 1400W, four GTC 570,
 * GMC 710; standby display; every control bound to the systems' vars).
 * Exterior: exterior.ts.
 */
import type { AircraftInstance, AircraftModule, InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { CITATION_LONGITUDE_FDM } from './fdm';
import { LONGITUDE_META } from './meta';
import { createLongitudeSystems } from './createSystems';
import { applyLongitudeState } from './states';
import { LONGITUDE_CHECKLISTS } from './checklists';
import { LONGITUDE_INPUT_MAP } from './inputMap';
import { buildLongitudeCockpit } from './cockpit';
import { createLongitudeExterior } from './exterior';

const module: AircraftModule = {
  meta: LONGITUDE_META,
  fdm: CITATION_LONGITUDE_FDM,

  create(ctx: SimContext): AircraftInstance {
    const sys = createLongitudeSystems(ctx);
    const { build } = buildLongitudeCockpit(ctx, sys, sys.suite);
    const exterior = createLongitudeExterior(ctx.vars);
    return {
      systems: sys.list,
      cockpit: build,
      exterior: exterior.root,
      updateExterior: exterior.update,
      applyState: (s: InitialState) => applyLongitudeState(ctx, sys, s),
      checklists: LONGITUDE_CHECKLISTS,
      inputMap: LONGITUDE_INPUT_MAP,
      dispose(): void {
        for (const s of sys.list) s.dispose?.();
        exterior.dispose();
      },
    };
  },
};

export default module;
