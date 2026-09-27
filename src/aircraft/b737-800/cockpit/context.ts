/**
 * Shared context for the 737-800 cockpit builders, and the contract for the
 * forward / aft overhead and side-console builders owned by another agent.
 *
 * Extension contract (loaded by cockpit/index.ts with import.meta.glob, so
 * the main cockpit builds whether or not these folders exist yet):
 *   - `cockpit/overhead/index.ts` exports `buildOverhead(c: B738CockpitContext): void`.
 *     Mount frames: `MOUNTS.overheadFwd` (P5 forward overhead) and
 *     `MOUNTS.overheadAft` (P5 aft overhead) in layout.ts; empty groups at
 *     those frames are `c.mounts.overheadFwd / overheadAft`, or create panels
 *     with `c.b.panel({ ...MOUNTS.overheadFwd, name, ... })`. The transfer
 *     switches (`addTransferSwitches`, suite helper) and the ISDU display
 *     (`B738_DISPLAY_IDS.isdu`) belong there.
 *   - `cockpit/side/index.ts` exports `buildSideConsoles(c: B738CockpitContext): void`
 *     (`MOUNTS.sideLeft / sideRight`): map lights, oxygen mask boxes, P6 / P18
 *     breaker panels. The Captain tiller and its shelf (layout TILLER /
 *     SIDE_SHELF) are built by the main cockpit; leave that spot free.
 *   Control ids must be unique across the build: the main cockpit uses the
 *   prefixes 'b738.gs.', 'b738.mip.', 'b738.ped.', 'b738.aft.', 'b738.fc.' and
 *   the suite helpers 'b737.'.
 *   Lighting zones already defined here: 'panel' (label backlight of the main
 *   deck, see index.ts), 'flood', 'afds', 'ped_flood', 'dome'. The overhead
 *   builder should add zone 'ovhd' on `ac.light.panel_ovhd` for its labels.
 */
import type * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import type { CockpitEnv } from '../../../cockpit/env';
import type { SimContext } from '../../../core/SimContext';
import type { LegendSegment } from '../../../cockpit/controls';
import type { B738Systems } from '../createSystems';

export interface B738CockpitContext {
  b: CockpitBuilder;
  env: CockpitEnv;
  ctx: SimContext;
  sys: B738Systems;
  /** Empty groups at the mount frames (cockpit-local, parented to the root). */
  mounts: { overheadFwd: THREE.Group; overheadAft: THREE.Group; sideLeft: THREE.Group; sideRight: THREE.Group };
  /** Build without the aircraft's own canvas displays (node tests). */
  headless: boolean;
  /** Dispose hooks run with the build (event listeners, own displays). */
  onDispose(fn: () => void): void;
}

/** Legend helpers (737 lights: amber faults, green / blue status, red warnings). */
export const seg = {
  on(text: string | string[], color: LegendSegment['color'], v: string): LegendSegment {
    return { text, color, var: v };
  },
  eq(text: string | string[], color: LegendSegment['color'], v: string, value: number): LegendSegment {
    return { text, color, var: v, test: (x: number) => x === value };
  },
  /**
   * Blue valve lights: lit dim (1) or bright (2). FCOM 12.10 / 3.10: "illuminated bright blue - valve in
   * transit or disagrees with the switch; illuminated dim blue - valve in the commanded position".
   * EST: dim = 40 % of bright (the NG dim filament is clearly visible but much fainter).
   */
  any(text: string | string[], color: LegendSegment['color'], v: string): LegendSegment {
    return { text, color, var: v, test: (x: number) => x > 0, level: (x: number) => (x >= 2 ? 1 : 0.4) };
  },
};

/** Cockpit-internal derived vars (display-side only; systems never read them). */
export const CK = {
  /** Label backlight of the main deck: the brightest of the Capt / F/O / pedestal panel dimmers. */
  panelLight: 'ac.b738.ck.panel_lt',
  /** Lamp test for the cockpit lenses (LIGHTS switch TEST with annunciator power). */
  lampTest: 'ac.b738.ck.lamp_test',
  /** Fire handle override buttons (mechanical release of the handle lock, FCOM 8.20). */
  fireOverride: (h: 1 | 2 | 'apu') => `ac.b738.ck.fire_ovrd_${h}`,
  /** Any gear red light (the lever lights). */
  gearRed: 'ac.b738.ck.gear_red',
} as const;
