/**
 * Shared context for the Global 6000 cockpit builders, and the contract for
 * the overhead / side-console builders owned by another agent.
 *
 * Extension contract (loaded by cockpit/index.ts with import.meta.glob, so the
 * main cockpit builds whether or not these folders exist yet):
 *   - `cockpit/overhead/index.ts` exports `buildOverhead(c: G6kCockpitContext): void`
 *     and mounts on `MOUNTS.overhead` (layout.ts): parent to `c.mounts.overhead`
 *     or create a panel with `c.b.panel({ ...MOUNTS.overhead, name, ... })`. The
 *     dossier §12.1 inventory (fire handles, ELECTRICAL, HYDRAULIC, FUEL, BLEED,
 *     ANTI-ICE, PRESSURIZATION, ENGINE / APU, EXTERNAL LIGHTS, PASS SIGNS, DOME,
 *     IAC MUTE, ELT) belongs there.
 *   - `cockpit/side/index.ts` exports `buildSideConsoles(c: G6kCockpitContext): void`
 *     (`MOUNTS.sideLeft` / `MOUNTS.sideRight`): RSP 1 / 2 (collins-fusion `addRsp`),
 *     STALL PUSHER switches, oxygen masks / PASSENGER OXYGEN / crew supply, map
 *     light knobs (`V.ltMap`), HUD power. The pilot's NOSE STEER handwheel is
 *     built by the main cockpit (id 'g6k.tiller', layout TILLER); leave that spot free.
 *   Control ids must be unique across the build: the main cockpit uses the prefixes
 *   'g6k.gs.', 'g6k.mp.', 'g6k.ped.', 'g6k.fc.', 'g6k.ems.', 'g6k.tiller' and the
 *   Fusion hardware ids 'fusion.*' (FCP, CTP 1 / 2, CCP 1 / 2, MKP 1 / 2, IESI).
 *   Use 'g6k.ovhd.' / 'g6k.side.' (RSP: 'fusion.rsp*').
 */
import type * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import type { CockpitEnv } from '../../../cockpit/env';
import type { SimContext } from '../../../core/SimContext';
import type { FusionSuite } from '../../../avionics/collins-fusion';
import type { LegendSegment } from '../../../cockpit/controls';
import type { G6kSystems } from '../createSystems';
import type { DisplayCanvas } from '../../../avionics/common/CanvasDisplay';

export interface G6kCockpitContext {
  b: CockpitBuilder;
  env: CockpitEnv;
  ctx: SimContext;
  sys: G6kSystems;
  /** Collins Pro Line Fusion suite (null when the systems were built without avionics). */
  suite: FusionSuite | null;
  /** Empty groups at the overhead / side-console mount frames (cockpit-local, parented to the root). */
  mounts: { overhead: THREE.Group; sideLeft: THREE.Group; sideRight: THREE.Group };
  /** Canvas option for cockpit-owned displays (G6kCockpitOptions.canvas; null = no display). Added for the side-panel EMS CDUs. */
  canvas?: 'dom' | 'offscreen' | DisplayCanvas | null;
  /** Extra clean-ups run by the build's dispose() (event subscriptions of cockpit-owned logic). */
  disposers?: (() => void)[];
}

/** Switchlight legends (Bombardier convention: dark = normal; white status, amber caution, green / cyan advisory). */
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

/** Vars derived by the cockpit for lamps / lighting that combine several system states (display-side only; no system reads them). */
export const CK = {
  annunPower: 'ac.g6k.ck.annun_pwr',
  annunBright: 'ac.g6k.ck.annun_brt',
  gearRed: 'ac.g6k.ck.gear_red',
  /** EMS CDU page (0 EMER CNTL, 1 TEST) and the held test line keys. */
  emsPage: 'ac.g6k.ck.ems_page',
  emsPower: 'ac.g6k.ck.ems_pwr',
} as const;

/** Lighting zones (systems/lighting.ts dimmer outputs): INTEGRAL L / CTR / R panel back-lighting. */
export const ZONE = { left: 'panel_l', centre: 'panel', right: 'panel_r' } as const;
