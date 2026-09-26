/**
 * Citation M2 flight deck (everything except the overhead area and the
 * sidewall consoles, which mount through `cockpit/overhead/index.ts` and
 * `cockpit/side/index.ts` when those modules exist; see `M2CockpitPart`).
 *
 *   const { build, systems } = buildM2Cockpit(ctx, sys, { displays: sys.suite.displayList() });
 *
 * Structure: shell.ts (walls, windshield frame, glareshield hood, floor,
 * seats); panels.ts (instrument panel with the three GDU 1400W and the
 * electrical power panel; centre glareshield panel with the GMC 710,
 * ESI-1000, DCUs, master warning / caution, ENG FIRE / BOTTLE, reversion and
 * dimming); lower.ts (tilt panels, gear module, beneath-panel handles);
 * pedestal.ts (GTC 570 x 2, throttles with TO/GA, flaps, speed brake, trims,
 * engine start); flightControls.ts (control wheels, pedals).
 *
 * Lighting: panel / pedestal backlighting, glareshield floods and the map
 * lights follow the M2 LightingSystem dimmer outputs (`ac.light.panel`,
 * `.pedestal`, `.flood`, `.map_l`, `.map_r`, systems/airframe.ts);
 * annunciator brightness follows `ac.light.annun` (DIM with the panel lights
 * on) and the lamp test is the SYSTEM TEST knob's ANNU position.
 */
import * as THREE from 'three';
import type { SimContext } from '../../../core/SimContext';
import type { CockpitDisplay } from '../../../cockpit/types';
import { CockpitBuilder, type CockpitBuildEx } from '../../../cockpit/CockpitBuilder';
import type { Subsystem } from '../../types';
import { bl } from '../../../cockpit/frame';
import { M2, TEST_SEL } from '../vars';
import { EYE, EYE_R, MOUNTS } from './layout';
import { buildShell } from './shell';
import { buildGlareshieldPanel, buildMainPanel } from './panels';
import { buildTiltPanels, buildUnderPanel } from './lower';
import { buildPedestal } from './pedestal';
import { buildFlightControls } from './flightControls';
import { EsiController } from './displays';
import { GtcKnobPushLogic } from './logic';

/** Cockpit-local vars written by the cockpit's per-frame hook (display plumbing only). */
export const COCKPIT_LOCAL_VARS = {
  lampTest: 'ac.m2.ckpt_lamp_test',
  annunBright: 'ac.m2.ckpt_annun_bright',
} as const;

export interface M2CockpitOptions {
  /** Displays by id: 'pfd1', 'mfd', 'pfd2', 'gtc1', 'gtc2' (G3000 suite), 'esi', 'hobbs'. Missing ids get blank screens (headless). */
  displays?: CockpitDisplay[];
}

/** Context handed to the overhead / sidewall builders (cockpit/overhead, cockpit/side). */
export interface M2CockpitContext {
  ctx: SimContext;
  /** Named mount groups (cockpit-local frame at the MOUNTS body positions). */
  mounts: Record<keyof typeof MOUNTS, THREE.Group>;
  /** Extra subsystems the part needs (appended to the aircraft's systems list). */
  systems: Subsystem[];
}

/** A cockpit part module (default export of cockpit/overhead/index.ts or cockpit/side/index.ts). */
export type M2CockpitPart = (b: CockpitBuilder, c: M2CockpitContext) => void;

const PARTS = import.meta.glob<{ default: M2CockpitPart }>(['./overhead/index.ts', './side/index.ts'], { eager: true });

export interface M2Cockpit {
  build: CockpitBuildEx;
  /** Cockpit-hardware subsystems (ESI-1000 buttons, GTC knob push/hold) to append to the systems list. */
  systems: Subsystem[];
}

export function buildM2Cockpit(ctx: SimContext, opts: M2CockpitOptions = {}): M2Cockpit {
  const b = new CockpitBuilder(ctx, {
    palette: 'citation',
    name: 'citation-m2',
    eyePosition_m: EYE,
    views: [
      { name: 'Copilot', position_m: EYE_R, yawDeg: 0, pitchDeg: -8 },
      { name: 'Glareshield / GMC 710', position_m: [3.22, -0.12, -0.36], yawDeg: 6, pitchDeg: -10, fovDeg: 38 },
      { name: 'PFD 1', position_m: [3.2, -0.36, -0.3], yawDeg: 0, pitchDeg: -18, fovDeg: 42 },
      { name: 'Pedestal', position_m: [3.02, 0, -0.33], yawDeg: 0, pitchDeg: -52, fovDeg: 50 },
      { name: 'GTC 570 (FMS)', position_m: [3.14, -0.08, -0.26], yawDeg: 8, pitchDeg: -42, fovDeg: 40 },
      { name: 'LH tilt panel / electrical', position_m: [3.18, -0.45, -0.28], yawDeg: -6, pitchDeg: -44, fovDeg: 45 },
      { name: 'RH tilt panel', position_m: [3.18, 0.42, -0.28], yawDeg: 8, pitchDeg: -44, fovDeg: 45 },
      { name: 'Overhead', position_m: [3.0, -0.2, -0.42], yawDeg: 0, pitchDeg: 62, fovDeg: 60 },
    ],
  });
  const env = b.env;
  const vars = ctx.vars;
  const displays = new Map<string, CockpitDisplay>();
  for (const d of opts.displays ?? []) displays.set(d.id, d);

  // ---------------------------------------------------------------- lighting zones (LED panels, S&D15 §5 / §9.4)
  b.zone({ id: 'panel', intensityVar: 'ac.light.panel', lagS: 0 });
  b.zone({ id: 'pedestal', intensityVar: 'ac.light.pedestal', lagS: 0 });
  b.zone({ id: 'flood', intensityVar: 'ac.light.flood', lagS: 0 });
  b.zone({ id: 'map_l', intensityVar: 'ac.light.map_l', lagS: 0 });
  b.zone({ id: 'map_r', intensityVar: 'ac.light.map_r', lagS: 0 });
  env.lighting.setAnnunciatorDimming(COCKPIT_LOCAL_VARS.annunBright, 0.45, false, 'elec.emer_powered');
  env.lighting.lampTestVar = COCKPIT_LOCAL_VARS.lampTest;
  // Glareshield floodlights (LED strips under the brow, EST 3 cd) and overhead map lights (EST 4 cd).
  env.lighting.addFloodLight('m2.flood.l', 'flood', [3.5, -0.35, -0.3], [3.66, -0.37, -0.02], b.root, 3, 60);
  env.lighting.addFloodLight('m2.flood.r', 'flood', [3.5, 0.35, -0.3], [3.66, 0.37, -0.02], b.root, 3, 60);
  env.lighting.addMapLight('m2.map.l', 'map_l', [2.95, -0.42, -0.68], [3.2, -0.3, 0.15], b.root, 4);
  env.lighting.addMapLight('m2.map.r', 'map_r', [2.95, 0.42, -0.68], [3.2, 0.3, 0.15], b.root, 4);

  // ---------------------------------------------------------------- structure and panels
  buildShell(b);
  buildMainPanel({ b, displays });
  buildGlareshieldPanel({ b, displays });
  buildTiltPanels(b, displays);
  buildUnderPanel(b);
  buildPedestal(b, displays);
  buildFlightControls(b);

  // Windshield ice-detection lights on the glareshield (S&D15 §9.7), lit by the WING INSP switch (light.wing).
  {
    const mat = new THREE.MeshBasicMaterial({ color: 0x202020, toneMapped: false });
    env.materials.track(mat);
    const geo = new THREE.BoxGeometry(0.03, 0.008, 0.012);
    b.trackGeometry(geo);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(geo, mat);
      m.name = 'ice_detect_light';
      m.position.copy(bl(3.86, s * 0.3, -0.262));
      m.userData.cockpitDynamic = true;
      b.root.add(m);
    }
    const col = new THREE.Color();
    b.onUpdate(() => {
      const l = vars.get('light.wing');
      col.setRGB(0.12 + 0.88 * l, 0.12 + 0.88 * l, 0.12 + 0.85 * l);
      mat.color.copy(col);
    });
  }

  // Mount points for the overhead / sidewall parts.
  const mounts = {} as Record<keyof typeof MOUNTS, THREE.Group>;
  for (const k of Object.keys(MOUNTS) as (keyof typeof MOUNTS)[]) {
    const g = new THREE.Group();
    g.name = `m2.mount.${k}`;
    g.position.copy(bl(...MOUNTS[k]));
    b.root.add(g);
    mounts[k] = g;
  }
  const extraSystems: Subsystem[] = [new EsiController(vars), new GtcKnobPushLogic(ctx, ['gtc1', 'gtc2'])];
  for (const part of Object.values(PARTS)) part.default(b, { ctx, mounts, systems: extraSystems });

  // Lamp test (SYSTEM TEST knob ANNU, S&D / CJ family) and annunciator DIM with the panel lights on (airframe.ts 'annun' dimmer).
  b.onUpdate(() => {
    const powered = vars.get('elec.emer_powered') !== 0;
    vars.set(COCKPIT_LOCAL_VARS.lampTest, powered && vars.get(M2.testSel) === TEST_SEL.annu ? 1 : 0);
    vars.set(COCKPIT_LOCAL_VARS.annunBright, vars.get('ac.light.annun', 1) >= 0.9 ? 1 : 0);
  });

  return { build: b.build(), systems: extraSystems };
}
