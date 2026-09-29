/**
 * Boeing 737-800 (winglets, CFM56-7B26): aircraft module.
 *
 * Systems, FDM, states, checklists and input map: createSystems.ts, fdm.ts,
 * states.ts, checklists.ts, inputMap.ts (dossier docs/aircraft/b737-800.md).
 * Cockpit: cockpit/index.ts (six-DU CDS, MCP, EFIS panels, CDUs from the
 * 737NG avionics suite; ISFD, clocks, gauges and every panel control bound
 * to the systems' vars; the overhead / side consoles load from
 * cockpit/overhead and cockpit/side when present). Exterior: exterior.ts.
 */
import type { AircraftInstance, AircraftModule, InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { B738_FDM } from './fdm';
import { B738_META } from './meta';
import { createSystems } from './createSystems';
import { applyB738State } from './states';
import { B738_CHECKLISTS } from './checklists';
import { B738_INPUT_MAP } from './inputMap';
import { buildB738Cockpit } from './cockpit';
import { createB738Exterior } from './exterior';

const module: AircraftModule = {
  meta: B738_META,
  fdm: B738_FDM,

  create(ctx: SimContext): AircraftInstance {
    const sys = createSystems(ctx);
    const { build } = buildB738Cockpit(ctx, sys);
    const exterior = createB738Exterior(ctx.vars);
    return {
      systems: sys.list,
      cockpit: build,
      exterior: exterior.root,
      updateExterior: exterior.update,
      applyState: (s: InitialState) => applyB738State(ctx, sys, s),
      checklists: B738_CHECKLISTS,
      inputMap: B738_INPUT_MAP,
      dispose(): void {
        for (const s of sys.list) s.dispose?.();
        sys.suite.dispose?.();
        exterior.dispose();
      },
    };
  },
};

export default module;
