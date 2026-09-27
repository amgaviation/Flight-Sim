/**
 * Shared context for the G650 cockpit builders, and the contract for the
 * overhead / side-console builders owned by other agents.
 *
 * Extension contract (loaded by cockpit/index.ts with import.meta.glob, so
 * the main cockpit builds whether or not these folders exist yet):
 *   - `cockpit/overhead/index.ts` exports `buildOverhead(c: G650CockpitContext): void`.
 *     Mount on `MOUNTS.overhead` (layout.ts): parent to `c.mounts.overhead` or create a
 *     panel with `c.b.panel({ name, ...MOUNTS.overhead, ... })`. It holds everything of
 *     dossier §9.1-9.6 (electrical, emergency power / RAT, FLT CTRL BATTERIES, APU CONTROL,
 *     ENG FIRE handles and FIRE TEST, fuel, hydraulics, bleed, temp control, cabin pressure,
 *     anti-ice, engine start, oxygen, lights) plus a lamp test (`alert.annun_test`, read by
 *     the CAS manager and the landing-gear lights) if it builds one.
 *   - `cockpit/side/index.ts` exports `buildSideConsoles(c: G650CockpitContext): void`
 *     (`MOUNTS.sideLeft` / `MOUNTS.sideRight`: the console tops aft of x 13.95). It holds the
 *     cursor control devices (PlaneView: CCDs on the outboard ledges, BJT G500 pilot report
 *     "the CCDs live in the center pedestal instead of on the outboard ledge" [of the
 *     G450/G550/G650]) with the Epic `addCcd` helper (ids `epic.ccd1.*` / `epic.ccd2.*`),
 *     map lights (`V.ltMapL/R`), oxygen masks (`V.oxyMaskL/R`, `V.oxyMaskMode`).
 *   Already built by the main cockpit (do not build again): the nosewheel TILLER on the
 *   forward end of the left console (layout.ts TILLER, id 'g650.fc.tiller'; x 14.2-14.4),
 *   the side-console bodies (structure), the CAS scroll switch (`epic.cas.scroll`) and the
 *   MFD DISPLAY SWITCHING / DISPLAY SYSTEM CONTROL switches (`epic.mfdsw*`, `epic.dusw*`) on
 *   the lower centre panel, the DU brightness knobs on the glareshield ends.
 *   Control ids must be unique across the build: the main cockpit uses the prefixes
 *   'g650.gs.', 'g650.mp.', 'g650.lc.', 'g650.ped.', 'g650.fc.', 'g650.hud' and the Epic
 *   helper ids 'epic.gp.*', 'epic.smc{1,2}.*', 'epic.mcdu{1,2,3}.*', 'epic.cas.scroll',
 *   'epic.mfdsw*', 'epic.dusw*'.
 */
import type * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import type { CockpitEnv } from '../../../cockpit/env';
import type { SimContext } from '../../../core/SimContext';
import type { EpicSuite } from '../../../avionics/honeywell-epic/suite';
import type { LegendSegment } from '../../../cockpit/controls';
import type { G650Systems } from '../createSystems';
import type { DisplayCanvas } from '../../../avionics/common/CanvasDisplay';

export interface G650CockpitContext {
  b: CockpitBuilder;
  env: CockpitEnv;
  ctx: SimContext;
  sys: G650Systems;
  /** PlaneView II suite (null in pure-systems use: then no displays / Epic hardware are built). */
  suite: EpicSuite | null;
  /** Empty groups at the overhead / side-console mount frames (cockpit-local, parented to the root). */
  mounts: { overhead: THREE.Group; sideLeft: THREE.Group; sideRight: THREE.Group };
  /** Canvas factory for the cockpit's own small displays (overhead readouts); tests pass a fake canvas. */
  canvas?: (w: number, h: number) => DisplayCanvas;
}

/**
 * Gulfstream switchlight legends (LUC drawings: square black switchlights, legend in the lower half,
 * "ON" blue / cyan, "OFF" amber, "ARMED" blue, warnings red).
 */
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

/** Vars derived by the cockpit for lenses that combine several system states (written each frame in cockpit/index.ts; display-side only). */
export const CK = {
  /** Annunciator lamp power (either ESS DC bus or the emergency bus). */
  annunPower: 'ac.g650.ck.annun_pwr',
  /** Any gear red (in transit / disagree) lamp: gear handle light. */
  gearRed: 'ac.g650.ck.gear_red',
  /** HUD combiner deployed 0..1 (animation). */
  hudDeploy: 'ac.g650.ck.hud_deploy',
} as const;
