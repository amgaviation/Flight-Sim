/**
 * Shared set-up for the G800 main-cockpit tests: the headless rig (real FDM + the full systems list with the
 * Symmetry suite on fake canvases and the real navigation database) plus the cockpit build.
 */
import { NavDatabaseImpl } from '../../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../../src/nav/data/nodeLoader';
import type { InitialState } from '../../../../src/aircraft/types';
import { buildG800Cockpit, type G800Cockpit } from '../../../../src/aircraft/g800/cockpit';
import { makeRig, type Rig } from '../helpers';

let db: NavDatabaseImpl | null = null;

export async function navDb(): Promise<NavDatabaseImpl> {
  if (!db) {
    db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
  }
  return db;
}

export async function cockpitRig(state: InitialState = 'ready_to_taxi', mainOnly = true): Promise<{ r: Rig; ck: G800Cockpit }> {
  const r = makeRig(state, { avionics: true, nav: await navDb() });
  const ck = buildG800Cockpit(r.ctx, r.sys, { mainOnly });
  ck.build.root.updateMatrixWorld(true);
  return { r, ck };
}
