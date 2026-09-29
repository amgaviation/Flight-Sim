/**
 * Gulfstream G800 Symmetry flight deck: assembles the structure, main panel
 * (with the lower centre panel: fire handles, gear), glareshield pod, pedestal,
 * sidesticks / pedals, the pilot HUD (combiner + headliner HUD control panel),
 * standby compass, sun visors, pull-out tables, lighting and the Honeywell
 * Symmetry (Primus Epic) displays and hardware into a `CockpitBuild`, and loads
 * the overhead / side-console builders when their folders exist (context.ts).
 *
 * Lighting (systems/lighting.ts dimmers, OHPTS LIGHTS page): label
 * backlighting zone 'panel' (`ac.light.panel`, PANEL dimmer), two flood
 * lights in the headliner ('flood', FLOOD dimmer), a dome light ('dome').
 * Annunciators (MASTER WARN, gear lamps, fire handles) are powered from the
 * essential DC buses; lamp test via `alert.annun_test`, written by the LAMP TEST key
 * on the OHPTS TEST page (systems/tscApps.ts; the Symmetry lamp test is a touch function).
 */
import * as THREE from 'three';
import { CockpitBuilder, type CockpitBuildEx } from '../../../cockpit/CockpitBuilder';
import { PALETTES, type PaletteDef } from '../../../cockpit/materials';
import { DISPLAY_VARS } from '../../../cockpit/types';
import { PushButton, RotaryKnob, ToggleSwitch } from '../../../cockpit/controls';
import { merge, roundedBox } from '../../../cockpit/geometry/primitives';
import { bl } from '../../../cockpit/frame';
import type { DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import { FDM } from '../../../core/vars';
import { G800_VARS as V } from '../vars';
import { G800HudDisplay, HUD_DISPLAY_ID, HUD_DISPLAY_ID_R } from './hud';
import { placePanel } from '../../../cockpit/frame';
import type { SimContext } from '../../../core/SimContext';
import type { EpicSuite } from '../../../avionics/honeywell-epic/suite';
import type { G800Systems } from '../createSystems';
import { CK, type G800CockpitContext } from './context';
import { EYE_L, EYE_R, GLAZING, HUD, MOUNTS, OUTBOARD_TSC } from './layout';
import { buildShell } from './shell';
import { buildMainPanel } from './mainPanel';
import { buildGlareshield } from './glareshield';
import { buildPedestal } from './pedestal';
import { buildFlightControls } from './flightControls';

type OverheadModule = { buildOverhead?: (c: G800CockpitContext) => void };
type SideModule = { buildSideConsoles?: (c: G800CockpitContext) => void };
const OVERHEAD = import.meta.glob<OverheadModule>('./overhead/index.ts', { eager: true });
const SIDE = import.meta.glob<SideModule>('./side/index.ts', { eager: true });

export interface G800CockpitOptions {
  /** Skip the overhead / side-console builders even when present. */
  mainOnly?: boolean;
  /** Canvas factory for the cockpit's own displays (the HUD); headless tests pass a fake canvas. */
  canvas?: (w: number, h: number) => DisplayCanvas;
}

/**
 * G800 flight-deck palette (G600 / G500 EBACE photographs; fix round 1 L15: the demonstrator photograph
 * g800_flying_cockpit.jpg shows a MID-GREY headliner, not cream, with dark charcoal around the overhead
 * console and window line): charcoal sidewalls, window surrounds and pillars, mid-grey headliner, black
 * leather crew seats; panels as the shared Gulfstream palette. EST sRGB values.
 */
export const G800_PALETTE: PaletteDef = {
  ...PALETTES.gulfstream,
  name: 'Gulfstream G800 Symmetry (charcoal / mid grey)',
  interior: '#2e3032',
  headliner: '#9a9a96',
  seat: '#1b1b1c',
};

export interface G800Cockpit {
  build: CockpitBuildEx;
  context: G800CockpitContext;
}

/** Preset views (body metres). The pilot eye is the default view. */
export const G800_VIEWS = [
  { name: 'Copilot', position_m: EYE_R, yawDeg: 0, pitchDeg: -8 },
  { name: 'Glareshield (guidance panel)', position_m: [12.8, 0, -0.8] as [number, number, number], yawDeg: 0, pitchDeg: -14, fovDeg: 44 },
  { name: 'Pilot displays', position_m: [12.7, -0.36, -0.72] as [number, number, number], yawDeg: 4, pitchDeg: -18, fovDeg: 60 },
  { name: 'Pedestal', position_m: [12.45, -0.2, -0.55] as [number, number, number], yawDeg: 22, pitchDeg: -58, fovDeg: 62 },
  { name: 'Pedestal TSCs (FMS)', position_m: [12.72, -0.12, -0.5] as [number, number, number], yawDeg: 10, pitchDeg: -52, fovDeg: 44 },
  { name: 'Overhead', position_m: [12.3, -0.3, -0.85] as [number, number, number], yawDeg: 14, pitchDeg: 62, fovDeg: 62 },
  { name: 'Left console / sidestick', position_m: [12.52, -0.62, -0.3] as [number, number, number], yawDeg: -50, pitchDeg: -34, fovDeg: 50 },
  { name: 'Lower centre panel (fire handles, gear)', position_m: [12.85, 0, -0.5] as [number, number, number], yawDeg: 0, pitchDeg: -28, fovDeg: 46 },
  // Views of the overhead / side-console builders (cockpit/overhead, cockpit/side).
  { name: 'Overhead touch screens', position_m: [12.35, 0, -0.9] as [number, number, number], yawDeg: 0, pitchDeg: 72, fovDeg: 70 },
  { name: 'Left console (tiller / O2)', position_m: [12.02, -0.86, -0.46] as [number, number, number], yawDeg: -12, pitchDeg: -60, fovDeg: 60 },
  { name: 'Circuit breakers (aft overhead)', position_m: [12.45, 0, -0.95] as [number, number, number], yawDeg: 180, pitchDeg: 62, fovDeg: 60 },
  { name: 'HUD control panel', position_m: [12.55, -0.4, -0.95] as [number, number, number], yawDeg: -10, pitchDeg: 50, fovDeg: 50 },
  { name: 'Observer station', position_m: [11.95, 0.3, -0.35] as [number, number, number], yawDeg: 110, pitchDeg: -10, fovDeg: 55 },
];

export function buildG800Cockpit(ctx: SimContext, sys: G800Systems, o: G800CockpitOptions = {}): G800Cockpit {
  const suite: EpicSuite | null = sys.suite;
  const b = new CockpitBuilder(ctx, { palette: G800_PALETTE, name: 'g800', eyePosition_m: EYE_L, views: G800_VIEWS });
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
  // Dual HUD (fix round 1 L02): combiner, projector and control panel on BOTH sides.
  const huds = [buildHud(c, 1, o.canvas), buildHud(c, 2, o.canvas)];
  const anim = buildCabinFittings(c);
  if (!o.mainOnly) {
    for (const m of Object.values(OVERHEAD)) m.buildOverhead?.(c);
    for (const m of Object.values(SIDE)) m.buildSideConsoles?.(c);
  }

  // ---- derived annunciator states (display-side only; systems never read these)
  const vars = ctx.vars;
  const hudPower = [DISPLAY_VARS.power(HUD_DISPLAY_ID), DISPLAY_VARS.power(HUD_DISPLAY_ID_R)];
  const deploy = [vars.get(V.hudStowS(1), 1) > 0.5 ? 1 : 0, vars.get(V.hudStowS(2)) > 0.5 ? 1 : 0];
  b.onUpdate((dt) => {
    for (const s of [1, 2] as const) {
      const hud = huds[s - 1];
      // HUD combiner: swings 80 deg up / aft about its hinge when stowed (EST); symbology on while the HUD computer says so.
      const target = vars.get(V.hudStowS(s)) > 0.5 ? 1 : 0;
      deploy[s - 1] += Math.max(-dt * 1.5, Math.min(dt * 1.5, target - deploy[s - 1]));
      hud.pivot.rotation.x = (1 - deploy[s - 1]) * 80 * (Math.PI / 180);
      vars.set(hudPower[s - 1], vars.get(V.hudOnS(s)) !== 0 && deploy[s - 1] > 0.98 ? 1 : 0);
      if (hud.screen) {
        // The display manager replaces the screen material: make it additive (black = transparent combiner glass).
        const m = hud.screen.material as THREE.MeshBasicMaterial;
        if (m.map && !m.userData.g800Hud) {
          m.userData.g800Hud = true;
          m.blending = THREE.AdditiveBlending;
          m.transparent = true;
          m.depthWrite = false;
          m.side = THREE.DoubleSide;
          m.needsUpdate = true;
          hud.screen.renderOrder = 5;
        }
      }
    }
    anim(dt);
    vars.set(CK.annunPower, vars.get('elec.l_ess_dc_powered') !== 0 || vars.get('elec.r_ess_dc_powered') !== 0 ? 1 : 0);
    vars.set(CK.gearRed, vars.get('gear.red0') !== 0 || vars.get('gear.red1') !== 0 || vars.get('gear.red2') !== 0 ? 1 : 0);
    vars.set(CK.gearGreen, vars.get('gear.green0') !== 0 && vars.get('gear.green1') !== 0 && vars.get('gear.green2') !== 0 ? 1 : 0);
  });

  const build = b.build();
  return { build, context: c };
}

/**
 * Pilot HUD: combiner on an arm hinged at the headliner in front of the pilot (G600 BL7C0704 shows it deployed; stowed
 * against the headliner, BL7C0705), overhead projector unit, and the HUD control panel on the left headliner outboard
 * of the overhead (crop p_hdliner): CONTR, VIDEO BRT, HUD BRT knobs and a MAN / AUTO switch. The hinge knob deploys /
 * stows the combiner (`ac.g800.hud_deploy`). The HUD computer (systems/hud.ts) reads every control.
 */
function buildHud(c: G800CockpitContext, side: 1 | 2, canvas?: (w: number, h: number) => DisplayCanvas): { pivot: THREE.Group; screen: THREE.Mesh | null } {
  const { b, env, ctx } = c;
  const sg = side === 1 ? -1 : 1;
  const sfx = side === 1 ? '' : '2';
  const w = 2 * HUD.eyeDist * Math.tan((HUD.fovHDeg / 2) * (Math.PI / 180));
  const h = 2 * HUD.eyeDist * Math.tan((HUD.fovVDeg / 2) * (Math.PI / 180));
  const [ex, ey, ez] = side === 1 ? EYE_L : EYE_R;
  const pivot = new THREE.Group();
  pivot.name = `hud_pivot${sfx}`;
  pivot.position.copy(bl(ex + HUD.eyeDist, ey, ez - h / 2 - 0.07));
  pivot.userData.cockpitDynamic = true;
  b.root.add(pivot);
  let screen: THREE.Mesh | null = null;
  const canDraw = !!canvas || typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';
  if (canDraw) {
    const disp = new G800HudDisplay(ctx.vars, canvas?.(600, 480), side);
    // Base material before the display texture arrives: fully transparent, so an unpowered combiner is just glass
    // (fix round 1 L18: the 'lcdOff' grey rectangle glowed green at night).
    const offMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 });
    offMat.name = 'g800.hudOff';
    screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), offMat);
    screen.name = `display:${side === 1 ? HUD_DISPLAY_ID : HUD_DISPLAY_ID_R}`;
    screen.position.set(0, -0.07 - h / 2, 0);
    pivot.add(screen);
    b.trackGeometry(screen.geometry);
    b.addDisplay(disp, screen, { glass: false, boot: false });
  }
  // Combiner frame and arms (dark). No tinted glass pane: real HUD combiner glass is nearly invisible -
  // only the stroke symbology glows (fix round 1 L18; also saves two draw calls with the dual HUD).
  const frameMat = env.materials.get('bezel');
  // Frame (top rim + two arms) as one mesh.
  const frameGeo = merge([
    new THREE.BoxGeometry(w + 0.01, 0.006, 0.008).translate(0, -0.07 + 0.004, 0),
    new THREE.BoxGeometry(0.006, 0.075, 0.006).translate(-(w + 0.006) / 2, -0.035, 0),
    new THREE.BoxGeometry(0.006, 0.075, 0.006).translate((w + 0.006) / 2, -0.035, 0),
  ]);
  const frame = new THREE.Mesh(frameGeo, frameMat);
  pivot.add(frame);
  b.trackGeometry(frameGeo);
  // Overhead projector unit behind the pilot's head and the combiner mount at the headliner.
  b.structureMesh(new THREE.BoxGeometry(0.18, 0.1, 0.3), 'panelDark', [ex - 0.12, ey, GLAZING.headerZ - 0.12]).name = `hud_projector${sfx}`;
  b.structureMesh(new THREE.BoxGeometry(0.06, 0.08, 0.05), 'panelDark', [ex + HUD.eyeDist, ey, ez - h / 2 - 0.11]).name = `hud_mount${sfx}`;
  // Hinge knob: deploys / stows the combiner.
  b.place(
    new PushButton(env, { id: `g800.hud${sfx}.stow`, label: `${side === 1 ? 'PILOT' : 'COPILOT'} HUD COMBINER (DEPLOY / STOW)`, var: V.hudStowS(side), mode: 'toggle', initial: side === 1 ? 1 : 0, stateNames: ['STOWED', 'DEPLOYED'], style: 'round', width: 0.014, capMaterial: 'knobGrey' }),
    { center_m: [ex + HUD.eyeDist - 0.035, ey - sg * 0.05, ez - h / 2 - 0.1], facing: 'aft', tiltDeg: -30 },
  );
  // HUD control panel on this side's headliner corner (identical panels both sides, g800_flying_cockpit.jpg).
  const hp = b.panel({ name: `g800.hud_ctl${sfx}`, center_m: [12.8, sg * 0.45, -1.245], facing: 'down', tiltDeg: -8, rollDeg: sg * -10, width: 0.13, height: 0.06, material: 'panelDark', screws: { kind: 'hex', diameter: 0.003, inset: 0.005 }, radius: 0.006 });
  const knob = (id: string, label: string, v: string, x: number) => {
    hp.add(new RotaryKnob(env, { id, label, outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [-135, 135], label, format: (q) => `${Math.round(q * 100)} %` }, cap: 'knurled', diameter: 0.013, pointer: 'line' }), x, -0.004);
    hp.label(label, x, 0.017, { height: 0.0019 });
  };
  knob(`g800.hud${sfx}.contr`, 'CONTR', V.hudContrS(side), -0.045);
  knob(`g800.hud${sfx}.video_brt`, 'VIDEO BRT', V.hudVideoBrtS(side), -0.012);
  knob(`g800.hud${sfx}.brt`, 'HUD BRT', V.hudBrtS(side), 0.021);
  hp.add(new ToggleSwitch(env, { id: `g800.hud${sfx}.auto`, label: `HUD BRT MAN / AUTO (${side === 1 ? 'L' : 'R'})`, var: V.hudAutoS(side), positions: ['MAN', 'AUTO'], initial: 1, scale: 0.7, labels: { positions: true, height: 0.0018 } }), 0.05, -0.004);
  return { pivot, screen };
}

/**
 * Standby magnetic compass on the windshield centre post (G600 BL7C0704 / BL7C0705), card turned by the magnetic heading
 * (a wet compass senses the field directly); tinted sun visors on the header (tap the visor clip: down / stowed); the
 * pull-out meal / desk tables under the outboard lower panels (BJT500; tap the pull tab). Returns the per-frame animator.
 */
function buildCabinFittings(c: G800CockpitContext): (dt: number) => void {
  const { b, env, ctx } = c;
  const vars = ctx.vars;
  // ---- compass: housing on the centre post just below the header, card rotating about the vertical.
  const cx = 13.05;
  const cz = GLAZING.headerZ + 0.07;
  b.structureMesh(roundedBox(0.07, 0.06, 0.06, 0.01), 'panelDark', [cx, 0, cz]).name = 'compass_housing';
  const card = new THREE.Group();
  card.name = 'compass_card';
  card.position.copy(bl(cx - 0.032, 0, cz));
  card.userData.cockpitDynamic = true;
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 24, 1, true), env.materials.get('paintWhite'));
  b.trackGeometry(cyl.geometry);
  card.add(cyl);
  const lubber = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.02, 0.001), env.materials.get('paintRed'));
  lubber.position.set(0, 0, 0.024);
  b.trackGeometry(lubber.geometry);
  b.root.add(card);
  b.root.add(lubber);
  lubber.position.copy(bl(cx - 0.056, 0, cz));
  const marks = new THREE.Mesh(new THREE.CylinderGeometry(0.0225, 0.0225, 0.004, 24, 1, true), env.materials.get('paintBlack'));
  b.trackGeometry(marks.geometry);
  card.add(marks);
  // ---- sun visors (one per side), hinged at the header.
  const visors: THREE.Group[] = [];
  for (const side of [1, 2] as const) {
    const y = side === 1 ? -0.42 : 0.42;
    const g = new THREE.Group();
    g.name = `visor_${side}`;
    g.position.copy(bl(12.98, y, GLAZING.headerZ + 0.02));
    g.userData.cockpitDynamic = true;
    const plate = new THREE.Mesh(roundedBox(0.3, 0.16, 0.004, 0.02), env.materials.custom('gloss', '#3a2a18', 0.2));
    plate.position.set(0, -0.08, 0);
    b.trackGeometry(plate.geometry);
    g.add(plate);
    b.root.add(g);
    visors.push(g);
    b.place(
      new PushButton(env, { id: `g800.fit.visor${side}`, label: `${side === 1 ? 'L' : 'R'} SUN VISOR`, var: V.visor(side), mode: 'toggle', stateNames: ['STOWED', 'DOWN'], style: 'small', width: 0.01, capMaterial: 'plasticBlack' }),
      { center_m: [12.97, y + (side === 1 ? 0.16 : -0.16), GLAZING.headerZ + 0.03], facing: 'aft', tiltDeg: -60 },
    );
  }
  // ---- pull-out tables under the lower panels ahead of each pilot.
  const tables: THREE.Group[] = [];
  for (const side of [1, 2] as const) {
    const y = side === 1 ? -0.47 : 0.47;
    const g = new THREE.Group();
    g.name = `table_${side}`;
    g.position.copy(bl(13.2, y, -0.075));
    g.userData.cockpitDynamic = true;
    const top = new THREE.Mesh(roundedBox(0.3, 0.012, 0.24, 0.01), env.materials.get('panelDark'));
    b.trackGeometry(top.geometry);
    g.add(top);
    b.root.add(g);
    tables.push(g);
    b.place(
      new PushButton(env, { id: `g800.fit.table${side}`, label: `${side === 1 ? 'L' : 'R'} TABLE (PULL OUT / STOW)`, var: V.table(side), mode: 'toggle', stateNames: ['STOWED', 'OUT'], style: 'small', width: 0.012, capMaterial: 'aluminium' }),
      { center_m: [13.3 - 0.13, y, -0.065], facing: 'aft' },
    );
  }
  const baseT = tables.map((t) => t.position.clone());
  const aftLocal = bl(12.9, 0, 0).sub(bl(13.2, 0, 0)); // cockpit-local vector for 0.3 m aft
  void OUTBOARD_TSC;
  return () => {
    card.rotation.y = -((vars.get(FDM.headingMag) * Math.PI) / 180);
    for (let i = 0; i < 2; i++) {
      // Stowed: flat forward against the header (+90 deg about the hinge); down: hanging in front of the glass.
      visors[i].rotation.x = ((1 - vars.get(`${V.visor((i + 1) as 1 | 2)}_pos`)) * 90 * Math.PI) / 180;
      const p = vars.get(`${V.table((i + 1) as 1 | 2)}_pos`);
      tables[i].position.copy(baseT[i]).addScaledVector(aftLocal, p);
    }
  };
}
