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
import * as THREE from 'three';
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

/**
 * Longitude finish materials (layout audit L15/L16/L47/L53: AOPA 2021 and Textron photographs). The deck, knee pods,
 * pedestal, console and CB-panel plates are black / very dark charcoal with white engraving; the lower sidewall
 * below the window sill is black; the pedestal nose around the MFD GTCs is a satin silver-grey surround; the
 * windshield frames are light grey with a dark inner edge. Colours EST from the photographs (the shared 'citation'
 * palette stays as it is: the M2 uses it). One instance per environment.
 */
export interface LonMaterials {
  /** Deck plates (main panel, tiers, lower sub-panels, pedestal, consoles, CB panels). */
  deck: THREE.MeshStandardMaterial;
  /** Knee pods, lower sidewall band, console bodies, bolsters (slightly softer black trim). */
  trim: THREE.MeshStandardMaterial;
  /** GMC 710 / display-controller face plates (Garmin black anodised). */
  unit: THREE.MeshStandardMaterial;
  /** Pedestal nose surround around the MFD GTCs and the thrust-lever arms. */
  silver: THREE.MeshStandardMaterial;
  /** Windshield frames / pillars (light grey trim). */
  pillar: THREE.MeshStandardMaterial;
  /** Headliner fixture rims and visor rails. */
  fixture: THREE.MeshStandardMaterial;
}

const LON_MATS = new WeakMap<object, LonMaterials>();

export function lonMaterials(env: CockpitEnv): LonMaterials {
  let m = LON_MATS.get(env);
  if (m) return m;
  const mk = (name: string, color: number, roughness: number, metalness = 0) => {
    const x = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    x.name = `lon.${name}`;
    env.materials.track(x);
    return x;
  };
  m = {
    deck: mk('deck', 0x131416, 0.7),
    trim: mk('trim', 0x18191b, 0.8),
    unit: mk('unit', 0x111213, 0.78),
    // L2-09: the GTC surround / lever arms read satin medium grey in _pedfwd / OEG p.12, not near-white; darker base
    // and higher roughness so daylight speculars do not blow it out.
    silver: mk('silver', 0x63676d, 0.55, 0.35),
    // L2-04: interior framing next to the glareshield is dark charcoal, light grey only on the upper frame /
    // headliner (a21_004, OEG p.12): darker grey base, the lower pillar band uses `trim` (shell.ts).
    pillar: mk('pillar', 0x9a9a96, 0.7),
    fixture: mk('fixture', 0x3a3c3f, 0.45, 0.3),
  };
  LON_MATS.set(env, m);
  return m;
}
