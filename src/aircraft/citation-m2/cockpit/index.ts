/**
 * Citation M2 flight deck (everything except the overhead area and the
 * sidewall consoles, which mount through `cockpit/overhead/index.ts` and
 * `cockpit/side/index.ts` when those modules exist; see `M2CockpitPart`).
 *
 *   const { build, systems } = buildM2Cockpit(ctx, sys, { displays: sys.suite.displayList() });
 *
 * Structure: shell.ts (walls, windshield frame, glareshield hood, floor,
 * seats); panels.ts (instrument panel with the three GDU 1400W and the
 * electrical power panel; centre glareshield panel with the GMC 710 and the
 * DIMMING / reversion panel above it, ESI-1000, GCU 275s, master warning /
 * caution, ENG FIRE / BOTTLE); lower.ts (tilt panels, gear module, handles
 * below the tilt panel); pedestal.ts (GTC 570 x 2, throttles with TO/GA,
 * flaps, speed brake, trims, engine start); flightControls.ts (control wheels
 * with hand microphones, pedals); fit.ts (plates and hood fitted to the lining).
 *
 * Lighting: panel / pedestal backlighting, glareshield floods and the map
 * lights follow the M2 LightingSystem dimmer outputs (`ac.light.panel`,
 * `.pedestal`, `.flood`, `.map_l`, `.map_r`, systems/airframe.ts);
 * annunciator brightness follows `ac.light.annun` (DIM with the panel lights
 * on, full bright at the PANELS DAY detent) and the lamp test is the GTC
 * SYSTEM TESTS page ANNU test.
 */
import * as THREE from 'three';
import type { SimContext } from '../../../core/SimContext';
import type { CockpitDisplay } from '../../../cockpit/types';
import { CockpitBuilder, type CockpitBuildEx } from '../../../cockpit/CockpitBuilder';
import type { Subsystem } from '../../types';
import { bl } from '../../../cockpit/frame';
import { M2, TEST_SEL } from '../vars';
import { EYE, EYE_R, GLARE, MOUNTS } from './layout';
import { buildShell } from './shell';
import { buildGlareshieldPanel, buildMainPanel } from './panels';
import { buildTiltPanels, buildUnderPanel } from './lower';
import { buildPedestal } from './pedestal';
import { buildFlightControls } from './flightControls';
import { EsiController } from './displays';
import { GtcKnobPushLogic } from './logic';

/** Ice-detection lights at the base of the windshield centre post, either side of the eye reference (EST). */
export const ICE_LIGHT = { x: 3.62, y: 0.03, z: -0.401 };

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
      // The M2 has no overhead panel (S&D15 §10.2): this view looks at the compass / eye reference on the centre post.
      { name: 'Compass / centre post', position_m: [3.1, -0.1, -0.42], yawDeg: 9, pitchDeg: -6, fovDeg: 40 },
      // Overhead / sidewall parts (cockpit/overhead, cockpit/side).
      { name: 'Headliner / crew oxygen', position_m: [3.15, 0, -0.36], yawDeg: 180, pitchDeg: 66, fovDeg: 80 },
      { name: 'LH circuit breakers', position_m: [3.27, -0.4, -0.22], yawDeg: -90, pitchDeg: -43, fovDeg: 46 },
      { name: 'RH circuit breakers', position_m: [3.27, 0.4, -0.22], yawDeg: 90, pitchDeg: -43, fovDeg: 46 },
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
  // Glareshield floodlights: LED strips under the brow (S&D21 §10.1) as four low-intensity emitters for an even
  // wash (M2-L39; EST 0.5 cd each), and the overhead map lights (EST 4 cd).
  for (const y of [-0.46, -0.16, 0.16, 0.46]) {
    env.lighting.addFloodLight(`m2.flood.${y < 0 ? 'l' : 'r'}${Math.abs(y) > 0.3 ? 'o' : 'i'}`, 'flood', [3.6, y, -0.268], [3.7, y * 1.05, 0.08], b.root, 0.5, 62);
  }
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

  // Windshield ice-detection lights (S&D15 §9.7 "mounted on the glareshield"): two orange lenses at the base of the
  // centre post either side of the eye-reference fixture, aimed outboard at each windshield (EST location from the
  // S&D15 Fig III photograph), lit by the WING INSP switch (light.wing).
  {
    const mat = new THREE.MeshBasicMaterial({ color: 0x3a2008, toneMapped: false });
    env.materials.track(mat);
    const housing = new THREE.BoxGeometry(0.016, 0.014, 0.022);
    const lens = new THREE.CircleGeometry(0.0055, 16);
    b.trackGeometry(housing, lens);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(housing, env.materials.get('plasticBlack'));
      h.position.copy(bl(ICE_LIGHT.x, s * ICE_LIGHT.y, ICE_LIGHT.z));
      h.userData.cockpitStatic = true;
      b.root.add(h);
      const m = new THREE.Mesh(lens, mat);
      m.name = 'ice_detect_light';
      m.position.copy(bl(ICE_LIGHT.x, s * (ICE_LIGHT.y + 0.0085), ICE_LIGHT.z));
      m.rotation.y = s * (Math.PI / 2) - s * 0.35; // facing outboard and slightly aft, toward the windshield panel
      m.userData.cockpitDynamic = true;
      b.root.add(m);
    }
    const col = new THREE.Color();
    b.onUpdate(() => {
      const l = vars.get('light.wing');
      col.setRGB(0.23 + 0.77 * l, 0.13 + 0.5 * l, 0.03 + 0.1 * l);
      mat.color.copy(col);
    });
  }
  // Round blue-ringed fitting at the centre of the glareshield lip (S&D21 Fig 3 / S&D15 Fig III / pin1). EST: the
  // display auto-dimming photocell, the light source of the DISPLAYS / TOUCH CONTROLS AUTO settings
  // (env.ambient_light, systems/logic.ts).
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0065, 0.0015, 8, 24), env.materials.custom('paint', '#2d5fb0', 0.4));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.0058, 20), env.materials.custom('plastic', '#141414', 0.2));
    b.trackGeometry(ring.geometry, disc.geometry);
    for (const m of [ring, disc]) {
      m.position.copy(bl(GLARE.browX - 0.0015, 0, GLARE.browZ + 0.007));
      m.userData.cockpitStatic = true;
      m.name = 'm2.photocell';
      b.root.add(m);
    }
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

  // Lamp test (GTC SYSTEM TESTS ANNU) and annunciator DIM with the panel lights on (airframe.ts 'annun' dimmer).
  b.onUpdate(() => {
    const powered = vars.get('elec.emer_powered') !== 0;
    vars.set(COCKPIT_LOCAL_VARS.lampTest, powered && vars.get(M2.testSel) === TEST_SEL.annu ? 1 : 0);
    vars.set(COCKPIT_LOCAL_VARS.annunBright, vars.get('ac.light.annun', 1) >= 0.9 ? 1 : 0);
    // Truthful display power for the ESI-1000 (the display itself follows ac.m2.esi_powered).
    vars.set('display.esi.power', vars.get(M2.esiPowered));
  });

  return { build: b.build(), systems: extraSystems };
}
