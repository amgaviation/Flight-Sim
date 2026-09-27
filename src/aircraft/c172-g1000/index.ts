/**
 * Cessna 172S Skyhawk NAV III with the Garmin G1000 NXi and the GFC 700 AFCS: aircraft module.
 *
 *  - meta.ts / c172s-common fdm.ts: catalog data and the flight model (TCDS 3A12, POH 172SPHBUS-00;
 *    docs/aircraft/c172s.md). The NAV III empty weight equals the steam airplane's within the
 *    POH sample loading, so the shared C172S_FDM is used unchanged (data.ts).
 *  - createSystems.ts: shared 172S core (electrical with ESS bus and standby battery, fuel, vacuum,
 *    pitot-static, flaps, trim, brakes, lights) + G1000 NXi suite + GRS 79 AHRS + GFC 700 + variant
 *    logic (systems/variant.ts).
 *  - cockpit/: the 3D cockpit bound to those vars; c172s-common exterior.ts: the airframe.
 *  - states.ts, checklists.ts (POH Sec 3 / 4), inputMap.ts.
 */
import type { AircraftInstance, AircraftModule, InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import type { CockpitDisplay } from '../../cockpit/types';
import { C172S_FDM } from '../c172s-common/fdm';
import { createC172Exterior } from '../c172s-common/exterior';
import { C172G_META } from './meta';
import { createC172G1000Systems } from './createSystems';
import { applyC172G1000State } from './states';
import { C172G_CHECKLISTS } from './checklists';
import { C172G_INPUT_MAP } from './inputMap';
import { buildC172G1000Cockpit } from './cockpit';
import { HourMeterDisplay } from './cockpit/displays';

/** Canvas-backed cockpit displays that need a DOM (or OffscreenCanvas); none headless. */
function cockpitDisplays(ctx: SimContext): CockpitDisplay[] {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return [];
  return [new HourMeterDisplay(ctx.vars)];
}

const module: AircraftModule = {
  meta: C172G_META,
  fdm: C172S_FDM,

  create(ctx: SimContext): AircraftInstance {
    const sys = createC172G1000Systems(ctx, { checklists: C172G_CHECKLISTS });
    const cockpit = buildC172G1000Cockpit(ctx, sys.suite.cfg, { displays: [...sys.suite.displayList(), ...cockpitDisplays(ctx)] });
    // NXi Skyhawk: LED exterior lighting (c172s-common lighting.ts).
    const exterior = createC172Exterior(ctx.vars, { ledLights: true });
    const systems = sys.list;

    const applyState = (s: InitialState): void => applyC172G1000State(ctx, sys, s);

    return {
      systems,
      cockpit: cockpit.build,
      exterior: exterior.root,
      updateExterior: exterior.update,
      applyState,
      checklists: C172G_CHECKLISTS,
      inputMap: C172G_INPUT_MAP,
      dispose(): void {
        for (const s of systems) s.dispose?.();
        exterior.dispose();
      },
    };
  },
};

export default module;
