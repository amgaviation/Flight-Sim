/**
 * Bombardier Global 6000 (BD-700-1A10, Global Vision Flight Deck): aircraft module.
 *
 * Systems, FDM, states, checklists and input map: createSystems.ts, fdm.ts,
 * states.ts, checklists.ts, inputMap.ts (dossier docs/aircraft/global6000.md).
 * Cockpit: cockpit/index.ts (Collins Pro Line Fusion: four AFDs, FCP, CTPs,
 * CCPs, MKPs, IESI; EMS CDU; every control bound to the systems' vars).
 * Exterior: exterior.ts.
 */
import type { AircraftInstance, AircraftModule, InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { GLOBAL6000_FDM } from './fdm';
import { G6K_META } from './meta';
import { createSystems } from './createSystems';
import { applyG6kState } from './states';
import { G6K_CHECKLISTS } from './checklists';
import { G6K_INPUT_MAP } from './inputMap';
import { buildG6kCockpit } from './cockpit';
import { createG6kExterior } from './exterior';

const module: AircraftModule = {
  meta: G6K_META,
  fdm: GLOBAL6000_FDM,

  create(ctx: SimContext): AircraftInstance {
    const sys = createSystems(ctx);
    const { build } = buildG6kCockpit(ctx, sys);
    const exterior = createG6kExterior(ctx.vars);
    return {
      systems: sys.list,
      cockpit: build,
      exterior: exterior.root,
      updateExterior: exterior.update,
      applyState: (s: InitialState) => applyG6kState(ctx, sys, s),
      checklists: G6K_CHECKLISTS,
      inputMap: G6K_INPUT_MAP,
      dispose(): void {
        for (const s of sys.list) s.dispose?.();
        exterior.dispose();
      },
    };
  },
};

export default module;
