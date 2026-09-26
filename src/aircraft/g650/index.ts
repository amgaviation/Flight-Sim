/**
 * Gulfstream G650 (GVI): aircraft module.
 *
 * Systems, FDM, states, checklists and input map: createSystems.ts, fdm.ts,
 * states.ts, checklists.ts, inputMap.ts (dossier docs/aircraft/g650.md).
 * Cockpit: cockpit/index.ts (Honeywell Primus Epic PlaneView II: four 14-in
 * DUs, guidance panel, two SMCs, three MCDUs; yokes with FBW; optional HUD;
 * every control bound to the systems' vars). Exterior: exterior.ts.
 */
import type { AircraftInstance, AircraftModule, InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { G650_FDM } from './fdm';
import { G650_META } from './meta';
import { createSystems } from './createSystems';
import { applyG650State } from './states';
import { G650_CHECKLISTS } from './checklists';
import { G650_INPUT_MAP } from './inputMap';
import { buildG650Cockpit } from './cockpit';
import { createG650Exterior } from './exterior';

const module: AircraftModule = {
  meta: G650_META,
  fdm: G650_FDM,

  create(ctx: SimContext): AircraftInstance {
    const sys = createSystems(ctx);
    const { build } = buildG650Cockpit(ctx, sys);
    const exterior = createG650Exterior(ctx.vars);
    return {
      systems: sys.list,
      cockpit: build,
      exterior: exterior.root,
      updateExterior: exterior.update,
      applyState: (s: InitialState) => applyG650State(ctx, sys, s),
      checklists: G650_CHECKLISTS,
      inputMap: G650_INPUT_MAP,
      dispose(): void {
        for (const s of sys.list) s.dispose?.();
        exterior.dispose();
      },
    };
  },
};

export default module;
