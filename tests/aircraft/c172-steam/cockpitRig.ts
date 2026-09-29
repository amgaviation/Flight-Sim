/**
 * Headless steam-172S cockpit: the systems rig (rig.ts) plus the 3D cockpit built on DOM /
 * OffscreenCanvas stubs so the analog instruments and the Bendix/King displays exist.
 */
import type { InitialState } from '../../../src/aircraft/types';
import { installDomStubs } from './domStubs';
import { makeSteamRig, type SteamRig, type SteamRigOptions } from './rig';
import type { SteamCockpit } from '../../../src/aircraft/c172-steam/cockpit';

export async function steamCockpitRig(state: InitialState = 'ready_to_taxi', o: Partial<SteamRigOptions> = {}): Promise<{ r: SteamRig; ck: SteamCockpit }> {
  installDomStubs();
  const { buildSteamCockpit } = await import('../../../src/aircraft/c172-steam/cockpit');
  const { steamDisplays } = await import('../../../src/aircraft/c172-steam/index');
  const r = makeSteamRig({ state, ...o });
  const ck = buildSteamCockpit(r.ctx, r.sys, { displays: steamDisplays(r.ctx, r.sys), analog: true });
  ck.build.root.updateMatrixWorld(true);
  return { r, ck };
}
