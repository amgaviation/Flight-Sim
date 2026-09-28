/**
 * Bombardier Global 6000 (Global Vision Flight Deck) cockpit: assembles the
 * structure, main instrument panel, glareshield, pedestal, control wheels,
 * pedals, NOSE STEER handwheel, lighting and the Collins Pro Line Fusion
 * hardware (four AFDs, FCP, CTP 1 / 2, IESI, CCP 1 / 2, MKP 1 / 2) into a
 * `CockpitBuild`, and loads the overhead / side-console builders when their
 * folders exist (contract in context.ts).
 *
 * Lighting (systems/lighting.ts, GXLT COCKPIT LIGHTS panel): label and panel
 * back-lighting zones 'panel_l' / 'panel' (centre) / 'panel_r' driven by the
 * INTEGRAL L / CTR / R knobs through the MASTER DIM switch; FLOOD L / CTR / R
 * lights under the glareshield and the overhead; DOME light. Annunciators
 * (switchlights, gear lights, MASTER WARNING / CAUTION) are powered from DC
 * ESS / BATT BUS and dim with MASTER DIM at DIM (EST); LAMP TEST lights them
 * all (`alert.annun_test`).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CockpitBuilder, type CockpitBuildEx } from '../../../cockpit/CockpitBuilder';
import { placePanel } from '../../../cockpit/frame';
import type { SimContext } from '../../../core/SimContext';
import type { DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import type { G6kSystems } from '../createSystems';
import { G6K_VARS as V } from '../vars';
import { CK, ZONE, type G6kCockpitContext } from './context';
import { EYE_L, EYE_R, MOUNTS } from './layout';
import { buildShell } from './shell';
import { buildMainPanel } from './mainPanel';
import { buildGlareshield } from './glareshield';
import { buildPedestal } from './pedestal';
import { buildFlightControls } from './flightControls';
import { G6K_PALETTE } from './finish';

type OverheadModule = { buildOverhead?: (c: G6kCockpitContext) => void };
type SideModule = { buildSideConsoles?: (c: G6kCockpitContext) => void };
const OVERHEAD = import.meta.glob<OverheadModule>('./overhead/index.ts', { eager: true });
const SIDE = import.meta.glob<SideModule>('./side/index.ts', { eager: true });

export interface G6kCockpitOptions {
  /** Skip the overhead / side-console builders even when present. */
  mainOnly?: boolean;
  /** Canvas for the cockpit's own displays (EMS CDU): default DOM / OffscreenCanvas; null = no display (node tests without a canvas stub). */
  canvas?: 'dom' | 'offscreen' | DisplayCanvas | null;
}

export interface G6kCockpit {
  build: CockpitBuildEx;
  context: G6kCockpitContext;
}

/**
 * Default look-down at the design eye (EST): the upper AFD row spans ~19-34 deg below the eye (layout.ts), so a
 * level view showed only the top half of the PFD; -12 deg keeps the glareshield / runway and the whole PFD in view.
 */
export const G6K_EYE_PITCH_DEG = -12;

/** Preset cockpit views (body metres; yaw + right, pitch + up). The pilot eye is the default view. */
export const G6K_VIEWS = [
  { name: 'Copilot', position_m: EYE_R, yawDeg: 0, pitchDeg: G6K_EYE_PITCH_DEG },
  { name: 'Glareshield (FCP / CTP / HUD)', position_m: [11.12, 0, -1.02] as [number, number, number], yawDeg: 0, pitchDeg: -14, fovDeg: 58 },
  { name: 'Centre panel (AFD 2, IESI / TAWS, GEAR AND BRAKES)', position_m: [11.08, 0, -0.95] as [number, number, number], yawDeg: 0, pitchDeg: -22, fovDeg: 56 },
  { name: 'AFD 3, MKP and throttle quadrant', position_m: [10.95, 0, -0.9] as [number, number, number], yawDeg: 0, pitchDeg: -50, fovDeg: 58 },
  { name: 'Pedestal (CCP, flaps, park brake, lights)', position_m: [10.7, 0, -0.95] as [number, number, number], yawDeg: 0, pitchDeg: -68, fovDeg: 62 },
  { name: 'Pedestal aft (trims, GLD, IRS)', position_m: [10.5, 0, -0.8] as [number, number, number], yawDeg: 0, pitchDeg: -82, fovDeg: 55 },
  { name: 'Overhead', position_m: [10.7, 0, -0.84] as [number, number, number], yawDeg: 0, pitchDeg: 84, fovDeg: 78 },
  { name: 'NOSE STEER / left console', position_m: [10.92, -0.6, -0.95] as [number, number, number], yawDeg: -40, pitchDeg: -50, fovDeg: 55 },
  // Overhead / side-console builders (cockpit/overhead, cockpit/side):
  { name: 'Overhead from the pilot seat', position_m: [10.88, -0.45, -1.0] as [number, number, number], yawDeg: 40, pitchDeg: 72, fovDeg: 80 },
  { name: 'Pilot panel wing (STALL PUSHER, EMS CDU 1)', position_m: [11.1, -0.62, -0.95] as [number, number, number], yawDeg: -22, pitchDeg: -28, fovDeg: 50 },
  { name: 'Copilot panel wing (EMS CDU 2) and side console', position_m: [11.1, 0.62, -0.95] as [number, number, number], yawDeg: 22, pitchDeg: -28, fovDeg: 50 },
  { name: 'Cockpit circuit breaker panel (aft bulkhead)', position_m: [9.92, -0.62, -0.9] as [number, number, number], yawDeg: 176, pitchDeg: -3, fovDeg: 45 },
];

export function buildG6kCockpit(ctx: SimContext, sys: G6kSystems, o: G6kCockpitOptions = {}): G6kCockpit {
  const b = new CockpitBuilder(ctx, { palette: G6K_PALETTE, name: 'global6000', eyePosition_m: EYE_L, views: G6K_VIEWS });
  const env = b.env;
  const mount = (name: string, p: (typeof MOUNTS)[keyof typeof MOUNTS]) => {
    const g = new THREE.Group();
    g.name = `mount:${name}`;
    placePanel(g, p);
    b.root.add(g);
    return g;
  };
  const c: G6kCockpitContext = {
    b,
    env,
    ctx,
    sys,
    suite: sys.suite,
    mounts: { overhead: mount('overhead', MOUNTS.overhead), sideLeft: mount('sideLeft', MOUNTS.sideLeft), sideRight: mount('sideRight', MOUNTS.sideRight) },
    canvas: o.canvas,
    disposers: [],
  };

  // ---- lighting zones (systems/lighting.ts dimmer outputs) and real lights (<= 5, docs/modules/cockpit.md §11)
  b.zone({ id: ZONE.centre, intensityVar: 'ac.light.panel_c', lagS: 0, gain: 1.9 }); // LED edge-lit panels (EST gain: 1.4 left the night legends barely legible from the seat; same as the overhead)
  b.zone({ id: ZONE.left, intensityVar: 'ac.light.panel_l', lagS: 0, gain: 1.9 });
  b.zone({ id: ZONE.right, intensityVar: 'ac.light.panel_r', lagS: 0, gain: 1.9 });
  for (const z of ['flood_l', 'flood_c', 'flood_r', 'dome']) b.zone({ id: z, intensityVar: `ac.light.${z}`, lagS: 0, color: 0xfff1dc });
  env.lighting.setAnnunciatorDimming(CK.annunBright, 0.3, false, CK.annunPower);
  // Glareshield floods over each pilot's panel and the overhead flood onto the pedestal (EST 4 cd LED floods).
  env.lighting.addFloodLight('flood.l', 'flood_l', [11.5, -0.5, -0.8], [11.62, -0.5, -0.35], b.root, 4, 60);
  env.lighting.addFloodLight('flood.r', 'flood_r', [11.5, 0.5, -0.8], [11.62, 0.5, -0.35], b.root, 4, 60);
  env.lighting.addFloodLight('flood.c', 'flood_c', [10.95, 0, -1.3], [10.9, 0, -0.42], b.root, 4, 55);
  env.lighting.addDomeLight('dome', 'dome', [10.4, 0, -1.34], b.root, 3);
  // EYE REF light (GX PTG 15-12, eye-reference orientation lamp; EST: a small lamp on the centre windshield post) and
  // FOOT (floor) lights under the knee panels (PTG 15-13): emissive lamps in their own zones.
  for (const z of ['eye_ref', 'foot']) b.zone({ id: z, intensityVar: `ac.light.${z}`, lagS: 0, color: 0xfff1dc, gain: 2 });
  const lampMat = (zone: string) => {
    const m = new THREE.MeshStandardMaterial({ color: 0x302e2a, emissive: 0xfff1dc, emissiveIntensity: 0, roughness: 0.3 });
    env.materials.track(m);
    env.lighting.registerBacklight(m, zone, 3);
    return m;
  };
  const eye = b.structureMesh(new THREE.SphereGeometry(0.008, 12, 8), lampMat('eye_ref'), [11.3, 0, -1.2], undefined, false);
  eye.name = 'eye_ref_light';
  // Both footwell strips in one mesh (local x = body y).
  const footG = mergeGeometries([new THREE.BoxGeometry(0.2, 0.006, 0.02).translate(-0.5, 0, 0), new THREE.BoxGeometry(0.2, 0.006, 0.02).translate(0.5, 0, 0)], false)!;
  b.structureMesh(footG, lampMat('foot'), [11.58, 0, -0.215], undefined, false).name = 'foot_lights';

  buildShell(b);
  buildMainPanel(c);
  buildGlareshield(c);
  buildPedestal(c);
  buildFlightControls(c);
  if (!o.mainOnly) {
    for (const m of Object.values(OVERHEAD)) m.buildOverhead?.(c);
    for (const m of Object.values(SIDE)) m.buildSideConsoles?.(c);
  }

  // ---- derived lamp / lighting states (display-side only; systems never read these)
  const vars = ctx.vars;
  const red = ['gear.red0', 'gear.red1', 'gear.red2'];
  b.onUpdate(() => {
    const pwr = vars.get('elec.dc_ess_powered') !== 0 || vars.get('elec.batt_bus_powered') !== 0 ? 1 : 0;
    vars.set(CK.annunPower, pwr);
    // PBA DIM / BRT (GX PTG 15-13 "Pushbutton annunciator lights ... single switch DIM/BRT").
    vars.set(CK.annunBright, vars.get('ac.light.pba', 1) < 0.5 ? 0 : 1);
    vars.set(CK.gearRed, vars.get(red[0]) !== 0 || vars.get(red[1]) !== 0 || vars.get(red[2]) !== 0 ? 1 : 0);
  });

  const build = b.build();
  build.eyePitchDeg = G6K_EYE_PITCH_DEG;
  const dispose = build.dispose?.bind(build);
  build.dispose = () => {
    for (const d of c.disposers ?? []) d();
    dispose?.();
  };
  return { build, context: c };
}
