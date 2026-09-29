/**
 * Gulfstream G800 (GVIII-G800): aircraft module.
 *
 * Systems, FDM, states, checklists and input map: createSystems.ts, fdm.ts,
 * states.ts, checklists.ts, inputMap.ts (dossier docs/aircraft/g800.md).
 * Cockpit: cockpit/index.ts (Honeywell Symmetry: four DU-1310 display units,
 * GP-700 guidance panel, two touch SFDs, four TSCs, two CCDs, three overhead
 * touch screens; active control sidesticks; every control bound to the
 * systems' vars). Exterior: exterior.ts.
 */
import type { AircraftInstance, AircraftModule, InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { G800_FDM } from './fdm';
import { G800_META } from './meta';
import { createG800Systems } from './createSystems';
import { applyG800State } from './states';
import { G800_CHECKLISTS } from './checklists';
import { G800_INPUT_MAP } from './inputMap';
import { buildG800Cockpit } from './cockpit';
import { createG800Exterior } from './exterior';

const module: AircraftModule = {
  meta: G800_META,
  fdm: G800_FDM,

  create(ctx: SimContext): AircraftInstance {
    const sys = createG800Systems(ctx);
    const { build } = buildG800Cockpit(ctx, sys);
    const exterior = createG800Exterior(ctx.vars);
    return {
      systems: sys.list,
      cockpit: build,
      exterior: exterior.root,
      updateExterior: exterior.update,
      applyState: (s: InitialState) => applyG800State(ctx, sys, s),
      checklists: G800_CHECKLISTS,
      inputMap: G800_INPUT_MAP,
      dispose(): void {
        for (const s of sys.list) s.dispose?.();
        exterior.dispose();
      },
    };
  },
};

export default module;
