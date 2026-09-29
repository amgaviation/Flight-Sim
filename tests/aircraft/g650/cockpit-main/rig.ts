/**
 * Shared set-up for the G650 main-cockpit tests: the headless rig (real FDM + the full systems list with the
 * PlaneView II suite on fake canvases and the real navigation database) plus the cockpit build (HUD on a fake
 * canvas).
 */
import { NavDatabaseImpl } from '../../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../../src/nav/data/nodeLoader';
import type { InitialState } from '../../../../src/aircraft/types';
import { buildG650Cockpit, type G650Cockpit } from '../../../../src/aircraft/g650/cockpit';
import { fakeCanvas } from '../../../avionics/honeywell-epic/helpers';
import { installDomStubs } from '../../c172-steam/domStubs';
import { makeRig, type Rig } from '../helpers';

// The standby magnetic compass (cockpit/index.ts) paints its card on an OffscreenCanvas at build time.
installDomStubs();

let db: NavDatabaseImpl | null = null;

export async function navDb(): Promise<NavDatabaseImpl> {
  if (!db) {
    db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
  }
  return db;
}

export async function cockpitRig(state: InitialState = 'ready_to_taxi', mainOnly = true): Promise<{ r: Rig; ck: G650Cockpit }> {
  const r = makeRig(state, { avionics: true, nav: await navDb() });
  const ck = buildG650Cockpit(r.ctx, r.sys, { mainOnly, canvas: () => fakeCanvas() });
  ck.build.root.updateMatrixWorld(true);
  return { r, ck };
}
