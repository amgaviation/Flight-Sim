/**
 * Shared context for the G800 cockpit builders, and the contract for the
 * overhead / side-console builders owned by other agents.
 *
 * Extension contract (loaded by cockpit/index.ts with import.meta.glob, so
 * the main cockpit builds whether or not these folders exist yet):
 *   - `cockpit/overhead/index.ts` exports `buildOverhead(c: G800CockpitContext): void`.
 *     Mount on `MOUNTS.overhead` (layout.ts): parent to `c.mounts.overhead` or create a
 *     panel with `c.b.panel({ name, ...MOUNTS.overhead, ... })`. It holds the three OHPTS
 *     (`addOhpts`), FIRE TEST, the RAT T-handle and the other physical items of dossier §9.7.
 *     The main cockpit already builds the ENGINE / APU FIRE handle strip at the very forward
 *     edge of the overhead (layout.ts FIRE_STRIP, x ~12.86-12.94): start the overhead aft of it.
 *   - `cockpit/side/index.ts` exports `buildSideConsoles(c: G800CockpitContext): void`
 *     (`MOUNTS.sideLeft` / `MOUNTS.sideRight`: the console tops aft of the sidestick pods).
 *     It holds the tiller (left only), the oxygen mask boxes and regulators (dossier §9.4).
 *     The main cockpit already builds, on the forward part of each console (layout.ts STICK_POD):
 *     the sidesticks with their grip switches and the NOSEWHEEL STEERING switch (left pod,
 *     BJT500 "pedal steering switchlight and tiller ... on the left side ledge, aft of the
 *     sidestick"), plus the console bodies (structure). The CCDs are on the aft pedestal
 *     (BJT500: "the cursor control devices now live in the center pedestal"), built by the
 *     main cockpit with the Epic `addCcd` helper (ids `epic.ccd1.*`, `epic.ccd2.*`): do not
 *     build them again.
 *   Control ids must be unique across the build: the main cockpit uses the prefixes
 *   'g800.gs.', 'g800.mp.', 'g800.kp.', 'g800.ped.', 'g800.fc.', 'g800.fire.' and the Epic
 *   helper ids 'epic.gp.*', 'epic.ccd{1,2}.*', 'epic.cas.scroll'.
 */
import type * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import type { CockpitEnv } from '../../../cockpit/env';
import type { SimContext } from '../../../core/SimContext';
import type { EpicSuite } from '../../../avionics/honeywell-epic/suite';
import type { G800Systems } from '../createSystems';

export interface G800CockpitContext {
  b: CockpitBuilder;
  env: CockpitEnv;
  ctx: SimContext;
  sys: G800Systems;
  /** Symmetry suite (null in pure-systems use: then no displays / Epic hardware are built). */
  suite: EpicSuite | null;
  /** Empty groups at the overhead / side-console mount frames (cockpit-local, parented to the root). */
  mounts: { overhead: THREE.Group; sideLeft: THREE.Group; sideRight: THREE.Group };
}

/** Vars derived by the cockpit for lenses that combine several system states (written each frame in cockpit/index.ts; display-side only). */
export const CK = {
  /** Annunciator lamp power (ESS DC). */
  annunPower: 'ac.g800.ck.annun_pwr',
  /** Any gear red (transit / disagree) lamp. */
  gearRed: 'ac.g800.ck.gear_red',
  /** All three gear down and locked (green). */
  gearGreen: 'ac.g800.ck.gear_green',
} as const;
