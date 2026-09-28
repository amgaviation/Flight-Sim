/**
 * Global Vision flight-deck finish (photos N835GL, EB190582; AOPA "First look
 * at the Global 6000", 2012: "Leather wraps the pilot seats and sidewalls ...
 * carbon fiber panel inserts"):
 *  - charcoal instrument panels and glareshield face;
 *  - tan leather: lower lip of the glareshield, main-panel surround and knee
 *    panels, pedestal side rails, side consoles and sidewalls;
 *  - carbon-fibre trim on the overhead sides and lower sidewalls (EST: dark
 *    gloss; SCOPE: the weave is not rendered);
 *  - cream leather seats (palette `seat`, cockpit/index.ts);
 *  - black windshield posts and frames.
 * Colours EST from the photographs.
 */
import type * as THREE from 'three';
import type { CockpitEnv } from '../../../cockpit/env';
import { PALETTES, type PaletteDef } from '../../../cockpit/materials';

/** Palette: the Bombardier palette with the Vision charcoal panels and cream crew seats (EST from photos). */
export const G6K_PALETTE: PaletteDef = {
  ...PALETTES.bombardier,
  name: 'Bombardier Global Vision (charcoal, tan leather)',
  panel: '#2f3134',
  panelDark: '#1b1c1e',
  seat: '#d9cfbd',
};

export interface G6kFinish {
  charcoal: THREE.Material;
  tan: THREE.Material;
  carbon: THREE.Material;
  black: THREE.Material;
}

export function g6kFinish(env: CockpitEnv): G6kFinish {
  const m = env.materials;
  return {
    charcoal: m.custom('paint', 0x2f3134, 0.55),
    tan: m.custom('plastic', 0xb58f62, 0.72),
    carbon: m.custom('gloss', 0x1c1d1f, 0.28),
    black: m.custom('plastic', 0x111213, 0.6),
  };
}
