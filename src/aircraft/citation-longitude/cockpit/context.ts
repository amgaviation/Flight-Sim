/**
 * Shared context for the Longitude cockpit builders, and the contract for the
 * overhead / side-console builders owned by other agents.
 *
 * Extension contract (loaded by cockpit/index.ts with import.meta.glob, so
 * the main cockpit builds whether or not these folders exist yet):
 *   - `cockpit/overhead/index.ts` exports `buildOverhead(c: LonCockpitContext): void`
 *     and mounts on `MOUNTS.overhead` (layout.ts), parenting to `c.mounts.overhead`
 *     or creating its own panel with `c.b.panel({ ...MOUNTS.overhead, ... })`.
 *   - `cockpit/side/index.ts` exports `buildSideConsoles(c: LonCockpitContext): void`
 *     (`MOUNTS.sideLeft` / `MOUNTS.sideRight`). The left-console tiller is built by
 *     the main cockpit (id 'lon.tiller', layout TILLER); leave that spot free.
 *   Control ids must be unique across the build: the main cockpit uses the
 *   prefixes 'lon.gs.', 'lon.mp.', 'lon.lp.', 'lon.ped.', 'lon.fc.', 'lon.g5k.'.
 */
import type * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import type { CockpitEnv } from '../../../cockpit/env';
import type { SimContext } from '../../../core/SimContext';
import type { G3000Suite } from '../../../avionics/garmin-g3000';
import type { LegendSegment } from '../../../cockpit/controls';
import type { LongitudeSystems } from '../createSystems';

export interface LonCockpitContext {
  b: CockpitBuilder;
  env: CockpitEnv;
  ctx: SimContext;
  sys: LongitudeSystems;
  /** G5000 suite (null in pure-systems tests). Its displays may be absent (headless: noDisplays). */
  suite: G3000Suite | null;
  /** Empty groups at the overhead / side-console mount frames (cockpit-local, parented to the root). */
  mounts: { overhead: THREE.Group; sideLeft: THREE.Group; sideRight: THREE.Group };
  /** Build without canvas displays (node tests). */
  headless: boolean;
}

/** Longitude pushbutton legends. Colours per the dossier inventory (cyan normal state, amber off-normal, white status). */
export const seg = {
  /** Lit while the var equals `value`. */
  eq(text: string | string[], color: LegendSegment['color'], v: string, value: number): LegendSegment {
    return { text, color, var: v, test: (x: number) => x === value };
  },
  /** Lit while the var is non-zero. */
  on(text: string | string[], color: LegendSegment['color'], v: string): LegendSegment {
    return { text, color, var: v };
  },
};

/** Vars derived by the cockpit for annunciator lenses that combine several system states (written each frame in cockpit/index.ts). */
export const CK = {
  annunPower: 'ac.lon.ck.annun_pwr',
  annunBright: 'ac.lon.ck.annun_brt',
  bottleArmed: (b: 1 | 2) => `ac.lon.ck.bottle${b}_armed`,
  gearRed: 'ac.lon.ck.gear_red',
} as const;
