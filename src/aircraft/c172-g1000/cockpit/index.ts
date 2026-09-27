/**
 * Cessna 172S NAV III (G1000 NXi / GFC 700) 3D cockpit.
 *
 *   const cockpit = buildC172G1000Cockpit(ctx, sys.suite.cfg, { displays: [...sys.suite.displayList(), hobbs] });
 *
 * Structure: panel.ts (instrument panel, POH Fig 7-2 items 1-19, 26-28, 30-34), gdu.ts (GDU 1054B
 * bezels, GMA 1360), pedestal.ts (items 20-25), flightControls.ts (control wheels with the GFC 700
 * switches, map light, pedals, control lock), shell.ts (cabin, windshield, compass, glareshield,
 * doors, seats, overhead console, vents, defrosters, fire extinguisher), layout.ts (dimensions and
 * sources).
 *
 * Lighting (POH Sec 7 "Interior lighting", c172s-common lighting.ts dimmer outputs):
 *  - 'panel': internally lit switch, circuit-breaker, engine-control and environmental panels
 *    (SW/CB PANELS dimmer, ac.light.switch_cb);
 *  - 'pedestal': LED strips on the throttle / flap panel and the pedestal (ac.light.pedestal);
 *  - 'pfd_keys' / 'mfd_keys' / 'gma_keys': bezel key backlighting (AVIONICS dimmer or photocell,
 *    systems/variant.ts);
 *  - standby instruments and compass: STBY IND dimmer (ac.light.stby_ind) through their own lightVar;
 *  - 'flood' (front flood lights, overhead dimmers), 'map' (control-wheel map light), 'dome'
 *    (rear dome / courtesy light, light.courtesy).
 */
import * as THREE from 'three';
import type { SimContext } from '../../../core/SimContext';
import { SURF } from '../../../core/vars';
import type { CockpitDisplay } from '../../../cockpit/types';
import { CockpitBuilder, type CockpitBuildEx } from '../../../cockpit/CockpitBuilder';
import type { PaletteDef } from '../../../cockpit/materials';
import { PALETTES } from '../../../cockpit/materials';
import type { G1000Resolved } from '../../../avionics/garmin-g1000/config';
import { sta } from '../../c172s-common/fdm';
import { C172, DOOR as DOOR_POS } from '../../c172s-common/vars';
import { C172G } from '../vars';
import { EXTINGUISHER } from '../data';
import { EYE, EYE_R, IN, PANEL, PANEL_H, hz } from './layout';
import { buildInstrumentPanel } from './panel';
import { buildPedestal, PED } from './pedestal';
import { buildFlightControls } from './flightControls';
import { buildShell } from './shell';

/**
 * 172S NAV III interior colours (EST from the photographs listed in layout.ts): textured medium-grey
 * upper panel, dark-grey switch panel and black lower panel (set per plate in panel.ts), dark GDU
 * bezels, light-grey plastic sidewalls, grey leather seats, white LED panel lighting (NXi).
 */
export const C172G_PALETTE: PaletteDef = {
  ...PALETTES.cessna172,
  name: 'Cessna 172S NAV III (G1000 NXi)',
  panel: '#505256',
  panelRoughness: 0.82,
  panelFinish: 'textured',
  panelDark: '#1c1c1e',
  glareshield: '#161617',
  bezel: '#2a2b2e',
  knob: '#18181a',
  interior: '#9a958c',
  headliner: '#c9c4ba',
  carpet: '#3e3d3c',
  seat: '#4c4843',
  seatMaterial: 'leather',
  yoke: '#18181a',
  backlight: '#f2f4ff',
  flood: '#fff4e6',
};

/** Default pilot view pitch: glareshield ~10 deg below the horizon, whole PFD in view (see layout.ts EYE). */
export const C172G_EYE_PITCH_DEG = -14;

export interface C172G1000CockpitOptions {
  /** Displays by id: 'pfd', 'mfd' (G1000 suite), 'hobbs'. Missing ids get blank screens (headless). */
  displays?: CockpitDisplay[];
  /** Build the canvas-textured standby instruments and compass (default: when a canvas is available). */
  analog?: boolean;
}

export interface C172G1000Cockpit {
  build: CockpitBuildEx;
}

const canvasAvailable = (): boolean => typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';

export function buildC172G1000Cockpit(ctx: SimContext, cfg: G1000Resolved, opts: C172G1000CockpitOptions = {}): C172G1000Cockpit {
  const b = new CockpitBuilder(ctx, {
    palette: C172G_PALETTE,
    name: 'c172-g1000',
    eyePosition_m: EYE,
    views: [
      { name: 'Copilot', position_m: EYE_R, yawDeg: 0, pitchDeg: -12 },
      { name: 'PFD', position_m: [sta(33), -9.14 * IN, hz(1.45)], yawDeg: 0, pitchDeg: -4, fovDeg: 42 },
      { name: 'MFD / audio panel', position_m: [sta(33), 4.5 * IN, hz(1.45)], yawDeg: 0, pitchDeg: -4, fovDeg: 44 },
      // Close-ups from between the control wheels and the panel (the wheels are behind the camera).
      { name: 'Standby instruments / engine controls', position_m: [sta(25), 0.02, hz(1.33)], yawDeg: 0, pitchDeg: -18, fovDeg: 55 },
      { name: 'Switch panel / circuit breakers', position_m: [sta(26), -0.34, hz(1.36)], yawDeg: 2, pitchDeg: -32, fovDeg: 55 },
      { name: 'Flaps / cabin heat', position_m: [sta(25), 0.2, hz(1.32)], yawDeg: 0, pitchDeg: -25, fovDeg: 55 },
      { name: 'Pedestal / trim', position_m: [sta(31), 0, hz(1.28)], yawDeg: 0, pitchDeg: -48, fovDeg: 55 },
      { name: 'Fuel selector', position_m: [sta(31), 0, hz(1.12)], yawDeg: 0, pitchDeg: -80, fovDeg: 50 },
      { name: 'Overhead console', position_m: [sta(50), -0.08, hz(1.62)], yawDeg: 0, pitchDeg: 72, fovDeg: 70 },
      { name: 'Left door', position_m: [sta(44), 0.05, hz(1.55)], yawDeg: -90, pitchDeg: -18, fovDeg: 72 },
    ],
  });
  const env = b.env;
  const vars = ctx.vars;
  const displays = new Map<string, CockpitDisplay>();
  for (const d of opts.displays ?? []) displays.set(d.id, d);
  const analog = opts.analog ?? canvasAvailable();

  // ---------------------------------------------------------------- lighting zones (LED)
  b.zone({ id: 'panel', intensityVar: 'ac.light.switch_cb', lagS: 0 });
  b.zone({ id: 'pedestal', intensityVar: 'ac.light.pedestal', lagS: 0 });
  b.zone({ id: 'flood', intensityVar: 'ac.light.flood', lagS: 0 });
  b.zone({ id: 'map', intensityVar: 'ac.light.map', lagS: 0 });
  b.zone({ id: 'dome', intensityVar: 'light.courtesy', lagS: 0.05 });
  // Pedestal LED strips (throttle / flap panel lower edge and above the power outlet).
  env.lighting.addFloodLight('c172g.ped.upper', 'pedestal', [sta(PANEL.fs + 1.2), 0, hz(PANEL.topH - PANEL_H - 0.005)], [sta(PED.botFs), 0, hz(PED.botH)], b.root, 0.5, 60);

  // ---------------------------------------------------------------- structure, panels, controls
  const shell = buildShell(b, ctx, { analog });
  const ip = buildInstrumentPanel({ b, ctx, cfg, displays, analog });
  buildPedestal(b);
  const fc = buildFlightControls(b, ctx);

  // ---------------------------------------------------------------- per-frame mechanics (indicators and moving structure)
  const flapScale = ip.flapPointer.userData.flapScale as { yTop: number; yBot: number };
  const flapX = ip.flapPointer.position.x;
  const panelH = ip.panel.height;
  let flapAnim = 0;
  const deg = THREE.MathUtils.degToRad;
  b.onUpdate((dt) => {
    // Flap follow-up pointer (actual flap position, 0-30 deg over the UP..FULL scale).
    const f = THREE.MathUtils.clamp(vars.get(SURF.flapsDeg) / 30, 0, 1);
    flapAnim += (f - flapAnim) * Math.min(1, dt * 12);
    const y = flapScale.yTop + (flapScale.yBot - flapScale.yTop) * flapAnim;
    ip.flapPointer.position.set(flapX, panelH / 2 - y, ip.flapPointer.position.z);
    // Standby attitude GYRO flag (low vacuum).
    if (ip.gyroFlag) {
      const g = vars.get(C172G.gyroFlag);
      ip.gyroFlag.visible = g > 0.02;
      ip.gyroFlag.scale.y = Math.max(0.05, g);
    }
    // Ignition key present; control-lock flag.
    if (ip.keyBow) ip.keyBow.visible = vars.get(C172.keyIn, 1) > 0.5;
    fc.lockFlag.visible = vars.get(C172.controlLock) > 0.5;
    // Doors (swing outward about the forward hinge) and their openable windows.
    for (const d of shell.doors) {
      const open = Math.round(vars.get(d.doorVar, DOOR_POS.closed)) === DOOR_POS.open ? 1 : 0;
      d.open += (open - d.open) * Math.min(1, dt * 2.5);
      d.pivot.rotation.y = d.side * deg(55) * d.open;
      const w = THREE.MathUtils.clamp(vars.get(d.winVar), 0, 1);
      d.winOpen += (w - d.winOpen) * Math.min(1, dt * 4);
      d.win.rotation.z = d.side * deg(30) * d.winOpen;
    }
    // Extinguisher gage needle: 0 psi at -120 deg .. 200 psi at +120 deg (EST dial).
    const psi = vars.get(C172G.extPsi, EXTINGUISHER.chargedPsi);
    shell.extNeedle.rotation.z = -deg(-120 + (240 * THREE.MathUtils.clamp(psi, 0, 200)) / 200);
  });

  const build = b.build();
  build.eyePitchDeg = C172G_EYE_PITCH_DEG;
  return { build };
}
