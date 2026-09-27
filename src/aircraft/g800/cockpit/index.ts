/**
 * Gulfstream G800 Symmetry flight deck: assembles the structure, main panel,
 * glareshield, pedestal, sidesticks / pedals, fire handles, lighting and the
 * Honeywell Symmetry (Primus Epic) displays and hardware into a
 * `CockpitBuild`, and loads the overhead / side-console builders when their
 * folders exist (contract in context.ts).
 *
 * Lighting (systems/lighting.ts dimmers, OHPTS LIGHTS page): label
 * backlighting zone 'panel' (`ac.light.panel`, PANEL dimmer), two flood
 * lights in the headliner ('flood', FLOOD dimmer), a dome light ('dome').
 * Annunciators (MASTER WARNING / CAUTION, gear lamps, fire handles) are
 * powered from the essential DC buses; lamp test via `alert.annun_test`
 * (no G800 hardware writes it: the Symmetry lamp test is a touch function,
 * SCOPE).
 */
import * as THREE from 'three';
import { CockpitBuilder, type CockpitBuildEx } from '../../../cockpit/CockpitBuilder';
import { placePanel } from '../../../cockpit/frame';
import type { SimContext } from '../../../core/SimContext';
import type { EpicSuite } from '../../../avionics/honeywell-epic/suite';
import type { G800Systems } from '../createSystems';
import { CK, type G800CockpitContext } from './context';
import { EYE_L, EYE_R, MOUNTS } from './layout';
import { buildShell } from './shell';
import { buildMainPanel } from './mainPanel';
import { buildGlareshield } from './glareshield';
import { buildPedestal } from './pedestal';
import { buildFlightControls } from './flightControls';
import { buildFireHandles } from './fireHandles';

type OverheadModule = { buildOverhead?: (c: G800CockpitContext) => void };
type SideModule = { buildSideConsoles?: (c: G800CockpitContext) => void };
const OVERHEAD = import.meta.glob<OverheadModule>('./overhead/index.ts', { eager: true });
const SIDE = import.meta.glob<SideModule>('./side/index.ts', { eager: true });

export interface G800CockpitOptions {
  /** Skip the overhead / side-console builders even when present. */
  mainOnly?: boolean;
}

export interface G800Cockpit {
  build: CockpitBuildEx;
  context: G800CockpitContext;
}

/** Preset views (body metres). The pilot eye is the default view. */
export const G800_VIEWS = [
  { name: 'Copilot', position_m: EYE_R, yawDeg: 0, pitchDeg: -8 },
  { name: 'Glareshield (GP-700)', position_m: [12.8, 0, -0.8] as [number, number, number], yawDeg: 0, pitchDeg: -14, fovDeg: 44 },
  { name: 'Pilot displays', position_m: [12.7, -0.36, -0.72] as [number, number, number], yawDeg: 4, pitchDeg: -18, fovDeg: 60 },
  { name: 'Pedestal', position_m: [12.45, -0.2, -0.55] as [number, number, number], yawDeg: 22, pitchDeg: -58, fovDeg: 62 },
  { name: 'Pedestal TSCs (FMS)', position_m: [12.72, -0.12, -0.5] as [number, number, number], yawDeg: 10, pitchDeg: -52, fovDeg: 44 },
  { name: 'Overhead', position_m: [12.3, -0.3, -0.85] as [number, number, number], yawDeg: 14, pitchDeg: 62, fovDeg: 62 },
  { name: 'Left console / sidestick', position_m: [12.52, -0.62, -0.3] as [number, number, number], yawDeg: -50, pitchDeg: -34, fovDeg: 50 },
  { name: 'Fire handles', position_m: [12.6, -0.15, -0.85] as [number, number, number], yawDeg: 6, pitchDeg: 40, fovDeg: 45 },
  // Views of the overhead / side-console builders (cockpit/overhead, cockpit/side).
  { name: 'Overhead touch screens', position_m: [12.35, 0, -0.9] as [number, number, number], yawDeg: 0, pitchDeg: 72, fovDeg: 70 },
  { name: 'Left console (tiller / O2)', position_m: [12.02, -0.86, -0.46] as [number, number, number], yawDeg: -12, pitchDeg: -60, fovDeg: 60 },
  { name: 'Left CB panel', position_m: [12.02, -0.8, -0.32] as [number, number, number], yawDeg: -120, pitchDeg: -12, fovDeg: 50 },
  { name: 'Right CB panel', position_m: [12.02, 0.8, -0.32] as [number, number, number], yawDeg: 120, pitchDeg: -12, fovDeg: 50 },
];

export function buildG800Cockpit(ctx: SimContext, sys: G800Systems, o: G800CockpitOptions = {}): G800Cockpit {
  const suite: EpicSuite | null = sys.suite;
  const b = new CockpitBuilder(ctx, { palette: 'gulfstream', name: 'g800', eyePosition_m: EYE_L, views: G800_VIEWS });
  const env = b.env;
  const mount = (name: string, p: (typeof MOUNTS)[keyof typeof MOUNTS]) => {
    const g = new THREE.Group();
    g.name = `mount:${name}`;
    placePanel(g, p);
    b.root.add(g);
    return g;
  };
  const c: G800CockpitContext = {
    b,
    env,
    ctx,
    sys,
    suite,
    mounts: { overhead: mount('overhead', MOUNTS.overhead), sideLeft: mount('sideLeft', MOUNTS.sideLeft), sideRight: mount('sideRight', MOUNTS.sideRight) },
  };

  // ---- lighting zones and real lights (<= 5, docs/modules/cockpit.md §11). LED backlighting (no lag).
  b.zone({ id: 'panel', intensityVar: 'ac.light.panel', lagS: 0, gain: 1.5 });
  b.zone({ id: 'flood', intensityVar: 'ac.light.flood', lagS: 0, color: 0xfff1dc });
  b.zone({ id: 'dome', intensityVar: 'ac.light.dome', lagS: 0, color: 0xfff1dc });
  env.lighting.setAnnunciatorDimming(null, 0.3, false, CK.annunPower);
  // Flood lights in the headliner over each seat aimed at the main panel (EST 4 cd LED floods), and a dome light.
  env.lighting.addFloodLight('flood.l', 'flood', [12.75, -0.45, -1.28], [13.36, -0.5, -0.3], b.root, 4, 55);
  env.lighting.addFloodLight('flood.r', 'flood', [12.75, 0.45, -1.28], [13.36, 0.5, -0.3], b.root, 4, 55);
  env.lighting.addDomeLight('dome', 'dome', [12.0, 0, -1.3], b.root, 4);

  buildShell(b);
  buildMainPanel(c);
  buildGlareshield(c);
  buildPedestal(c);
  buildFlightControls(c);
  buildFireHandles(c);
  if (!o.mainOnly) {
    for (const m of Object.values(OVERHEAD)) m.buildOverhead?.(c);
    for (const m of Object.values(SIDE)) m.buildSideConsoles?.(c);
  }

  // ---- derived annunciator states (display-side only; systems never read these)
  const vars = ctx.vars;
  b.onUpdate(() => {
    vars.set(CK.annunPower, vars.get('elec.l_ess_dc_powered') !== 0 || vars.get('elec.r_ess_dc_powered') !== 0 ? 1 : 0);
    vars.set(CK.gearRed, vars.get('gear.red0') !== 0 || vars.get('gear.red1') !== 0 || vars.get('gear.red2') !== 0 ? 1 : 0);
    vars.set(CK.gearGreen, vars.get('gear.green0') !== 0 && vars.get('gear.green1') !== 0 && vars.get('gear.green2') !== 0 ? 1 : 0);
  });

  const build = b.build();
  return { build, context: c };
}
