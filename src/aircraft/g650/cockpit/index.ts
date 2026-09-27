/**
 * Gulfstream G650 PlaneView II flight deck: assembles the structure, main
 * panel, glareshield, pedestal, yokes / pedals / tiller, the optional HUD,
 * lighting and the Honeywell Primus Epic displays and hardware into a
 * `CockpitBuild`, and loads the overhead / side-console builders when their
 * folders exist (contract in context.ts).
 *
 * Lighting (systems/lighting.ts dimmers): label backlighting zone 'panel'
 * (`ac.light.panel`, PANEL dimmer), two flood lights in the headliner
 * ('flood', FLOOD dimmer), a dome light ('dome'), map lights ('map_l' /
 * 'map_r'). LED backlighting (no lag). Annunciators (MASTER WARNING /
 * CAUTION, gear lights, switchlights) are powered from the essential DC or
 * the emergency bus (EST) and follow the lamp test `alert.annun_test`.
 */
import * as THREE from 'three';
import { CockpitBuilder, type CockpitBuildEx } from '../../../cockpit/CockpitBuilder';
import { placePanel, bl } from '../../../cockpit/frame';
import { DISPLAY_VARS } from '../../../cockpit/types';
import type { SimContext } from '../../../core/SimContext';
import type { DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import type { EpicSuite } from '../../../avionics/honeywell-epic/suite';
import type { G650Systems } from '../createSystems';
import { CK, type G650CockpitContext } from './context';
import { EYE_L, EYE_R, HUD, MOUNTS } from './layout';
import { buildShell } from './shell';
import { buildMainPanel } from './mainPanel';
import { buildGlareshield } from './glareshield';
import { buildPedestal } from './pedestal';
import { buildFlightControls } from './flightControls';
import { G650HudDisplay, HUD_DISPLAY_ID } from './hud';

type OverheadModule = { buildOverhead?: (c: G650CockpitContext) => void };
type SideModule = { buildSideConsoles?: (c: G650CockpitContext) => void };
const OVERHEAD = import.meta.glob<OverheadModule>('./overhead/index.ts', { eager: true });
const SIDE = import.meta.glob<SideModule>('./side/index.ts', { eager: true });

export interface G650CockpitOptions {
  /** Skip the overhead / side-console builders even when present. */
  mainOnly?: boolean;
  /** HUD fitted (optional equipment, default true). */
  hud?: boolean;
  /** Canvas factory for the cockpit's own displays (the HUD); tests pass a fake canvas. */
  canvas?: (w: number, h: number) => DisplayCanvas;
}

export interface G650Cockpit {
  build: CockpitBuildEx;
  context: G650CockpitContext;
}

/** Preset views (body metres). The pilot eye is the default view. */
export const G650_VIEWS = [
  { name: 'Copilot', position_m: EYE_R, yawDeg: 0, pitchDeg: -8 },
  { name: 'Glareshield (guidance panel)', position_m: [14.08, 0, -1.0] as [number, number, number], yawDeg: 0, pitchDeg: -16, fovDeg: 46 },
  { name: 'Pilot displays', position_m: [14.0, -0.38, -0.95] as [number, number, number], yawDeg: 4, pitchDeg: -22, fovDeg: 58 },
  { name: 'Pedestal', position_m: [13.72, -0.22, -0.95] as [number, number, number], yawDeg: 18, pitchDeg: -58, fovDeg: 64 },
  { name: 'MCDUs (FMS)', position_m: [14.12, -0.1, -0.82] as [number, number, number], yawDeg: 6, pitchDeg: -62, fovDeg: 46 },
  { name: 'Gear / lower panel', position_m: [14.1, 0.2, -0.8] as [number, number, number], yawDeg: -4, pitchDeg: -35, fovDeg: 50 },
  { name: 'Overhead', position_m: [13.65, -0.3, -1.05] as [number, number, number], yawDeg: 14, pitchDeg: 64, fovDeg: 64 },
  { name: 'Left console / tiller', position_m: [13.95, -0.62, -0.92] as [number, number, number], yawDeg: -35, pitchDeg: -58, fovDeg: 58 },
  // Overhead / side-console builders (cockpit/overhead, cockpit/side).
  { name: 'Overhead (lights / anti-ice)', position_m: [13.72, -0.1, -1.08] as [number, number, number], yawDeg: 4, pitchDeg: 50, fovDeg: 52 },
  { name: 'Overhead (systems)', position_m: [13.6, -0.05, -1.0] as [number, number, number], yawDeg: 0, pitchDeg: 76, fovDeg: 66 },
  { name: 'Circuit breakers', position_m: [13.24, 0, -1.08] as [number, number, number], yawDeg: 0, pitchDeg: 86, fovDeg: 62 },
  { name: 'Right console', position_m: [13.95, 0.62, -0.92] as [number, number, number], yawDeg: 35, pitchDeg: -58, fovDeg: 58 },
];

/** HUD combiner and overhead projector (pilot side). Returns the combiner screen mesh and its pivot group. */
function buildHud(c: G650CockpitContext, canvas?: (w: number, h: number) => DisplayCanvas): { pivot: THREE.Group; screen: THREE.Mesh } {
  const { b, env, ctx } = c;
  const hud = new G650HudDisplay(ctx.vars, canvas?.(600, 480));
  const w = 2 * HUD.eyeDist * Math.tan((HUD.fovHDeg / 2) * (Math.PI / 180));
  const h = 2 * HUD.eyeDist * Math.tan((HUD.fovVDeg / 2) * (Math.PI / 180));
  const [ex, ey, ez] = EYE_L;
  // Pivot at the combiner arm hinge above the glass: stowed = swung up / aft toward the headliner.
  const pivot = new THREE.Group();
  pivot.name = 'hud_pivot';
  pivot.position.copy(bl(ex + HUD.eyeDist, ey, ez - h / 2 - 0.07));
  pivot.userData.cockpitDynamic = true;
  b.root.add(pivot);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), env.materials.get('lcdOff'));
  screen.name = `display:${HUD_DISPLAY_ID}`;
  screen.position.set(0, -0.07 - h / 2, 0);
  pivot.add(screen);
  b.trackGeometry(screen.geometry);
  // Combiner frame (thin dark rim) and the arm to the hinge.
  const frameMat = env.materials.get('bezel');
  const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.005, 0.006), frameMat);
  rim.position.set(0, -0.07 + 0.004, 0);
  pivot.add(rim);
  b.trackGeometry(rim.geometry);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.075, 0.005), frameMat);
    arm.position.set((sx * (w + 0.006)) / 2, -0.035, 0);
    pivot.add(arm);
    b.trackGeometry(arm.geometry);
  }
  // Overhead projector unit (behind / above the pilot's head, EST HGS overhead unit size).
  const proj = new THREE.BoxGeometry(0.2, 0.12, 0.34);
  b.structureMesh(proj, 'panelDark', [ex - 0.12, ey, -1.43]).name = 'hud_projector';
  const mount = new THREE.BoxGeometry(0.05, 0.1, 0.05);
  b.structureMesh(mount, 'panelDark', [ex + HUD.eyeDist, ey, ez - h / 2 - 0.12]).name = 'hud_mount';
  b.addDisplay(hud, screen, { glass: false, boot: false });
  return { pivot, screen };
}

export function buildG650Cockpit(ctx: SimContext, sys: G650Systems, o: G650CockpitOptions = {}): G650Cockpit {
  const suite: EpicSuite | null = sys.suite;
  const b = new CockpitBuilder(ctx, { palette: 'gulfstream', name: 'g650', eyePosition_m: EYE_L, views: G650_VIEWS });
  const env = b.env;
  const mount = (name: string, p: (typeof MOUNTS)[keyof typeof MOUNTS]) => {
    const g = new THREE.Group();
    g.name = `mount:${name}`;
    placePanel(g, p);
    b.root.add(g);
    return g;
  };
  const c: G650CockpitContext = {
    b,
    env,
    ctx,
    sys,
    suite,
    mounts: { overhead: mount('overhead', MOUNTS.overhead), sideLeft: mount('sideLeft', MOUNTS.sideLeft), sideRight: mount('sideRight', MOUNTS.sideRight) },
    canvas: o.canvas,
  };

  // ---- lighting zones and real lights (<= 5, docs/modules/cockpit.md §11). LED backlighting (no lag).
  b.zone({ id: 'panel', intensityVar: 'ac.light.panel', lagS: 0, gain: 1.5 });
  b.zone({ id: 'flood', intensityVar: 'ac.light.flood', lagS: 0, color: 0xfff1dc });
  b.zone({ id: 'dome', intensityVar: 'ac.light.dome', lagS: 0, color: 0xfff1dc });
  b.zone({ id: 'map_l', intensityVar: 'ac.light.map_l', lagS: 0, color: 0xfff1dc });
  b.zone({ id: 'map_r', intensityVar: 'ac.light.map_r', lagS: 0, color: 0xfff1dc });
  env.lighting.setAnnunciatorDimming(null, 0.3, false, CK.annunPower);
  // Flood lights in the headliner over each seat aimed at the main panel (EST 4 cd LED floods), a dome light,
  // and the map lights on the side-window headers aimed at each pilot's lap (EST 3 cd).
  env.lighting.addFloodLight('flood.l', 'flood', [13.95, -0.4, -1.45], [14.55, -0.5, -0.55], b.root, 4, 55);
  env.lighting.addFloodLight('flood.r', 'flood', [13.95, 0.4, -1.45], [14.55, 0.5, -0.55], b.root, 4, 55);
  env.lighting.addDomeLight('dome', 'dome', [13.3, 0, -1.48], b.root, 4);
  env.lighting.addMapLight('map.l', 'map_l', [13.7, -0.95, -1.2], [14.0, -0.55, -0.1], b.root, 3);
  env.lighting.addMapLight('map.r', 'map_r', [13.7, 0.95, -1.2], [14.0, 0.55, -0.1], b.root, 3);

  buildShell(b);
  buildMainPanel(c);
  buildGlareshield(c);
  buildPedestal(c);
  buildFlightControls(c);
  const hud = o.hud !== false ? buildHud(c, o.canvas) : null;
  if (!o.mainOnly) {
    for (const m of Object.values(OVERHEAD)) m.buildOverhead?.(c);
    for (const m of Object.values(SIDE)) m.buildSideConsoles?.(c);
  }

  // ---- derived annunciator / display states (display-side only; systems never read these)
  const vars = ctx.vars;
  const hudPower = DISPLAY_VARS.power(HUD_DISPLAY_ID);
  let deploy = vars.get('epic.hud.on', 1) !== 0 ? 1 : 0;
  b.onUpdate((dt) => {
    const ess = vars.get('elec.l_ess_dc_powered') !== 0 || vars.get('elec.r_ess_dc_powered') !== 0;
    vars.set(CK.annunPower, ess || vars.get('elec.emer_dc_powered') !== 0 ? 1 : 0);
    vars.set(CK.gearRed, vars.get('gear.red0') !== 0 || vars.get('gear.red1') !== 0 || vars.get('gear.red2') !== 0 ? 1 : 0);
    if (hud) {
      // HUD on (SMC HUD page) and powered from the left ESS DC bus (EST): combiner deployed, symbology drawn.
      const on = vars.get('epic.hud.on', 1) !== 0;
      vars.set(hudPower, on && vars.get('elec.l_ess_dc_powered') !== 0 ? 1 : 0);
      const target = on ? 1 : 0;
      deploy += Math.max(-dt * 1.5, Math.min(dt * 1.5, target - deploy));
      vars.set(CK.hudDeploy, deploy);
      // Stowed: the combiner swings 80 deg up / aft about its hinge (EST).
      hud.pivot.rotation.x = (1 - deploy) * 80 * (Math.PI / 180);
      hud.pivot.visible = deploy > 0.001 || target > 0;
      // The display manager replaces the screen material: make it additive (black = transparent combiner glass).
      const m = hud.screen.material as THREE.MeshBasicMaterial;
      if (m.map && !m.userData.g650Hud) {
        m.userData.g650Hud = true;
        m.blending = THREE.AdditiveBlending;
        m.transparent = true;
        m.depthWrite = false;
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
        hud.screen.renderOrder = 5;
      }
    }
  });

  const build = b.build();
  return { build, context: c };
}
