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
import type { EmsCduLogic } from './emsCdu';

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
  ems: EmsCduLogic;
}

/** Preset cockpit views (body metres; yaw + right, pitch + up). The pilot eye is the default view. */
export const G6K_VIEWS = [
  { name: 'Copilot', position_m: EYE_R, yawDeg: 0, pitchDeg: -8 },
  { name: 'Glareshield (FCP / CTP)', position_m: [11.12, 0, -1.02] as [number, number, number], yawDeg: 0, pitchDeg: -14, fovDeg: 58 },
  { name: 'Centre panel (AFD 2 / 3, IESI, gear)', position_m: [11.02, 0, -0.86] as [number, number, number], yawDeg: 0, pitchDeg: -18, fovDeg: 58 },
  { name: 'MKP / CCP (FMS)', position_m: [11.0, -0.14, -0.78] as [number, number, number], yawDeg: 14, pitchDeg: -58, fovDeg: 50 },
  { name: 'Pedestal', position_m: [10.6, -0.3, -0.98] as [number, number, number], yawDeg: 36, pitchDeg: -58, fovDeg: 60 },
  { name: 'Pedestal aft (EMS CDU, lights, IRS)', position_m: [10.55, -0.14, -0.8] as [number, number, number], yawDeg: 30, pitchDeg: -72, fovDeg: 50 },
  { name: 'Overhead', position_m: [10.45, -0.2, -0.92] as [number, number, number], yawDeg: 8, pitchDeg: 58, fovDeg: 70 },
  { name: 'NOSE STEER / left console', position_m: [10.92, -0.5, -0.95] as [number, number, number], yawDeg: -48, pitchDeg: -45, fovDeg: 55 },
];

export function buildG6kCockpit(ctx: SimContext, sys: G6kSystems, o: G6kCockpitOptions = {}): G6kCockpit {
  const b = new CockpitBuilder(ctx, { palette: 'bombardier', name: 'global6000', eyePosition_m: EYE_L, views: G6K_VIEWS });
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
  };

  // ---- lighting zones (systems/lighting.ts dimmer outputs) and real lights (<= 5, docs/modules/cockpit.md §11)
  b.zone({ id: ZONE.centre, intensityVar: 'ac.light.panel_c', lagS: 0, gain: 1.4 }); // LED edge-lit panels (EST gain)
  b.zone({ id: ZONE.left, intensityVar: 'ac.light.panel_l', lagS: 0, gain: 1.4 });
  b.zone({ id: ZONE.right, intensityVar: 'ac.light.panel_r', lagS: 0, gain: 1.4 });
  for (const z of ['flood_l', 'flood_c', 'flood_r', 'dome']) b.zone({ id: z, intensityVar: `ac.light.${z}`, lagS: 0, color: 0xfff1dc });
  env.lighting.setAnnunciatorDimming(CK.annunBright, 0.3, false, CK.annunPower);
  // Glareshield floods over each pilot's panel and the overhead flood onto the pedestal (EST 4 cd LED floods).
  env.lighting.addFloodLight('flood.l', 'flood_l', [11.5, -0.5, -0.8], [11.62, -0.5, -0.35], b.root, 4, 60);
  env.lighting.addFloodLight('flood.r', 'flood_r', [11.5, 0.5, -0.8], [11.62, 0.5, -0.35], b.root, 4, 60);
  env.lighting.addFloodLight('flood.c', 'flood_c', [10.95, 0, -1.3], [10.9, 0, -0.42], b.root, 4, 55);
  env.lighting.addDomeLight('dome', 'dome', [10.4, 0, -1.34], b.root, 3);

  buildShell(b);
  buildMainPanel(c);
  buildGlareshield(c);
  const { ems } = buildPedestal(c, o.canvas);
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
    vars.set(CK.emsPower, pwr);
    vars.set(CK.annunBright, vars.get(V.ltMaster, 2) === 1 ? 0 : 1);
    vars.set(CK.gearRed, vars.get(red[0]) !== 0 || vars.get(red[1]) !== 0 || vars.get(red[2]) !== 0 ? 1 : 0);
  });

  const build = b.build();
  const dispose = build.dispose?.bind(build);
  build.dispose = () => {
    ems.dispose();
    dispose?.();
  };
  return { build, context: c, ems };
}
