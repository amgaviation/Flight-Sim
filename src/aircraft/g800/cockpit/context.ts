/**
 * Shared context for the G800 cockpit builders, and the contract for the
 * overhead / side-console builders owned by other agents.
 *
 * Extension contract (loaded by cockpit/index.ts with import.meta.glob, so
 * the main cockpit builds whether or not these folders exist yet):
 *   - `cockpit/overhead/index.ts` exports `buildOverhead(c: G800CockpitContext): void`.
 *     It builds the whole overhead console from the windshield header aft (overhead/layout.ts):
 *     forward strip, OHPTS 1-3, ELECTRICAL POWER CONTROL, DOORS / ENGINE CONTROL / BLEED AIR /
 *     CABIN PRESSURE CONTROL, gaspers and the two CB panels (overhead/breakers.ts).
 *   - `cockpit/side/index.ts` exports `buildSideConsoles(c: G800CockpitContext): void`
 *     (`MOUNTS.sideLeft` / `MOUNTS.sideRight`: the console tops aft of the sidestick pods; the
 *     observer station on the right aft bulkhead). It holds the tiller (left only) and the oxygen
 *     mask boxes and regulators (dossier §9.4). The main cockpit builds, on the forward part of each
 *     console (layout.ts STICK_POD): the sidesticks, armrests, the NOSEWHEEL STEERING switch and the
 *     PEDAL STEER switchlight (left pod). The CCDs are on the pedestal wings (pedestal.ts).
 *   Control ids must be unique across the build: the main cockpit uses the prefixes
 *   'g800.gs.', 'g800.kp.', 'g800.ped.', 'g800.fc.', 'g800.fire.', 'g800.hud.', 'g800.fit.' and the
 *   Epic ids 'epic.gp.*', 'epic.ccd{1,2}.*'; the overhead 'g800.oh.' / 'g800.cb.'; the side 'g800.side.'.
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
