/**
 * Cessna 172S Skyhawk SP, steam gauges with the Bendix/King NAV II avionics (serials 172S8704
 * and on, POH 172SPHUS Rev 5): aircraft module.
 *
 *  - meta.ts / c172s-common fdm: catalog data and the shared 172S flight model.
 *  - createSystems.ts: the shared 172S systems core (electrical per Fig 7-7A, fuel, vacuum,
 *    pitot-static, flight controls, lighting) plus the vacuum DG, KMA 28, KLN 94 + NAV/GPS
 *    switching, KX 155A x2, KR 87, KT 76C, KAP 140 (shared Afcs), altitude alerter and
 *    disconnect tone, cabin extras.
 *  - cockpit/: the 3D cockpit bound to those vars; c172s-common exterior; states.ts presets;
 *    checklists.ts (POH + supplements); inputMap.ts.
 */
import type { AircraftInstance, AircraftModule, InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import type { CockpitDisplay } from '../../cockpit/types';
import { C172S_FDM } from '../c172s-common/fdm';
import { createC172Exterior } from '../c172s-common/exterior';
import { C172_STEAM_META } from './meta';
import { createC172SteamSystems } from './createSystems';
import { applyC172SteamState } from './states';
import { C172_STEAM_CHECKLISTS } from './checklists';
import { C172_STEAM_INPUT_MAP } from './inputMap';
import { buildSteamCockpit } from './cockpit';
import { HobbsDisplay, Kap140Display, Kln94Display, Kr87Display, Kt76cDisplay, Kx155aDisplay } from './cockpit/displays';
import type { C172SteamSystems } from './createSystems';

/** True when canvases can be created (browser, Electron, or tests with canvas stubs). */
export function canvasAvailable(): boolean {
  return typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';
}

/** Canvas displays of the stack and the hour meter (none headless). */
export function steamDisplays(ctx: SimContext, sys: C172SteamSystems): CockpitDisplay[] {
  if (!canvasAvailable()) return [];
  const v = ctx.vars;
  return [new Kx155aDisplay(v, sys.kx1), new Kx155aDisplay(v, sys.kx2), new Kr87Display(v, sys.kr), new Kt76cDisplay(v, sys.kt), new Kap140Display(v, sys.kap), new Kln94Display(v, sys.kln), new HobbsDisplay(v)];
}

const module: AircraftModule = {
  meta: C172_STEAM_META,
  fdm: C172S_FDM,

  create(ctx: SimContext): AircraftInstance {
    const sys = createC172SteamSystems(ctx);
    const displays = steamDisplays(ctx, sys);
    const cockpit = buildSteamCockpit(ctx, sys, { displays, analog: canvasAvailable() });
    const exterior = createC172Exterior(ctx.vars, { ledLights: false });
    const systems = [...sys.list, ...cockpit.systems];

    const applyState = (s: InitialState): void => {
      applyC172SteamState(ctx, sys, s);
    };

    return {
      systems,
      cockpit: cockpit.build,
      exterior: exterior.root,
      updateExterior: exterior.update,
      applyState,
      checklists: C172_STEAM_CHECKLISTS,
      inputMap: C172_STEAM_INPUT_MAP,
      dispose(): void {
        for (const s of systems) s.dispose?.();
        exterior.dispose();
      },
    };
  },
};

export default module;
