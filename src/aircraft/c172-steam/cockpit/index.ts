/**
 * Cessna 172S Skyhawk SP (steam gauges, Bendix/King NAV II) cockpit.
 *
 *   const { build, systems } = buildSteamCockpit(ctx, sys, { displays, analog });
 *
 * Structure: panel.ts (upper instrument panel, flight / engine instruments, annunciator panel,
 * NAV/GPS switch, avionics breakers, ELT, hour meter); stack.ts (KMA 28, KLN 94, KX 155A x2,
 * KR 87, KT 76C, KAP 140); lower.ts (lower switch / breaker panel, engine controls, dimmers,
 * flaps, cabin heat / air, pedestal, fuel selector, parking brake); cabin.ts (shell, windows,
 * overhead console, vents, doors, storm windows, compass, seats, extinguisher);
 * flightControls.ts (control wheels with the KAP 140 switches, pedals, control lock).
 *
 * Lighting zones follow the shared 172S LightingSystem outputs (c172s-common lighting.ts):
 * 'panel' (PANEL LT: engraved switch-panel legends), 'radio' (RADIO LT: Bendix/King button
 * legends and knob marks), 'glareshield' (GLARESHIELD LT: the light under the glareshield lip
 * and the compass), 'pedestal', 'flood' (overhead front floods), 'map' (control-wheel map light),
 * 'dome' (rear dome light). The annunciator panel DIM position dims the annunciator lamps.
 */
import * as THREE from 'three';
import type { SimContext } from '../../../core/SimContext';
import type { CockpitDisplay } from '../../../cockpit/types';
import { CockpitBuilder, type CockpitBuildEx } from '../../../cockpit/CockpitBuilder';
import { PALETTES, type PaletteDef } from '../../../cockpit/materials';
import type { Subsystem } from '../../types';
import { SURF } from '../../../core/vars';
import { sta } from '../../c172s-common/fdm';
import { C172 } from '../../c172s-common/vars';
import { ST } from '../vars';
import type { C172SteamSystems } from '../createSystems';
import { buildMainPanel } from './panel';
import { buildStack } from './stack';
import { buildLowerPanel, buildParkingBrake, buildPedestal } from './lower';
import { buildCabin } from './cabin';
import { buildFlightControls } from './flightControls';
import { EYE, EYE_R, GLARE, PANEL, hz } from './layout';

/**
 * 2001-2004 Skyhawk SP interior (EST from the reference photograph): medium blue-grey painted
 * instrument panel, black lower switch panel and glareshield, grey plastic linings.
 */
export const C172_STEAM_PALETTE: PaletteDef = {
  ...PALETTES.cessna172,
  name: 'Cessna 172S NAV II (grey panel)',
  panel: '#50555b', // EST: photograph samples #5d5e5f (shade) .. #9ca19d (sunlit); darker base so the sunlit render matches
  panelRoughness: 0.75,
  panelFinish: 'textured',
  panelDark: '#161618',
  glareshield: '#1b1b1c',
  bezel: '#141415',
  knob: '#161618',
  handle: 'black',
  backlight: '#ffe2b0', // EST: incandescent post / edge lighting of the 2004 panel
  flood: '#fff1dc',
};

export interface SteamCockpitOptions {
  /** Canvas displays by id ('kx155a_1', 'kx155a_2', 'kr87', 'kt76c', 'kap140', 'kln94', 'hobbs'); missing ids leave the windows dark. */
  displays?: CockpitDisplay[];
  /** Build the canvas-textured analog instruments (needs a DOM or OffscreenCanvas). */
  analog?: boolean;
}

export interface SteamCockpit {
  build: CockpitBuildEx;
  systems: Subsystem[];
}

export function buildSteamCockpit(ctx: SimContext, sys: C172SteamSystems, opts: SteamCockpitOptions = {}): SteamCockpit {
  const b = new CockpitBuilder(ctx, {
    palette: C172_STEAM_PALETTE,
    name: 'c172-steam',
    eyePosition_m: EYE,
    views: [
      { name: 'Copilot', position_m: EYE_R, yawDeg: 0, pitchDeg: -10 },
      // Close-ups aimed at the item centres (layout.ts POS), EST camera positions (leaning forward;
      // the lower panel views are taken from in front of the control wheels).
      { name: 'Flight instruments', position_m: [EYE[0] + 0.15, EYE[1], hz(1.7)], yawDeg: 0, pitchDeg: -37, fovDeg: 50 },
      { name: 'Radio stack', position_m: [EYE[0] + 0.15, 0.0, hz(1.66)], yawDeg: 13, pitchDeg: -36, fovDeg: 50 },
      { name: 'KAP 140 / transponder', position_m: [0.36, 0.09, hz(1.32)], yawDeg: 0, pitchDeg: -18, fovDeg: 55 },
      { name: 'Lower switch panel', position_m: [0.36, -0.3, hz(1.27)], yawDeg: 0, pitchDeg: -20, fovDeg: 75 },
      { name: 'Engine controls / flaps', position_m: [0.36, 0.1, hz(1.25)], yawDeg: 0, pitchDeg: -25, fovDeg: 72 },
      { name: 'Pedestal / fuel selector', position_m: [EYE[0] + 0.2, 0, hz(1.5)], yawDeg: 0, pitchDeg: -62, fovDeg: 60 },
      { name: 'Overhead console', position_m: [EYE[0] - 0.12, 0, hz(1.6)], yawDeg: 0, pitchDeg: 70, fovDeg: 60 },
      { name: 'Left door', position_m: [EYE[0] + 0.05, EYE[1] + 0.12, hz(1.55)], yawDeg: -90, pitchDeg: -38, fovDeg: 65 },
    ],
  });
  const env = b.env;
  const vars = ctx.vars;
  const displays = new Map<string, CockpitDisplay>();
  for (const d of opts.displays ?? []) displays.set(d.id, d);

  // ---------------------------------------------------------------- lighting zones (incandescent, small lag)
  b.zone({ id: 'panel', intensityVar: 'ac.light.panel', lagS: 0.08 });
  b.zone({ id: 'radio', intensityVar: 'ac.light.radio', lagS: 0.08 });
  b.zone({ id: 'glareshield', intensityVar: 'ac.light.glareshield', lagS: 0.08 });
  b.zone({ id: 'pedestal', intensityVar: 'ac.light.pedestal', lagS: 0.08 });
  b.zone({ id: 'flood', intensityVar: 'ac.light.flood', lagS: 0.08 });
  b.zone({ id: 'map', intensityVar: 'ac.light.map', lagS: 0.08 });
  b.zone({ id: 'dome', intensityVar: C172.domeCourtesy, powerVar: 'elec.dome_courtesy_powered', lagS: 0.08 });
  env.lighting.setAnnunciatorDimming(ST.annBright, 0.35);
  // Glareshield light (lamp strip under the glareshield lip lighting the panel face, EST 1.5 cd).
  env.lighting.addFloodLight('c172s.glare.l', 'glareshield', [GLARE.browX - 0.02, -0.25, hz(GLARE.topH - 0.04)], [sta(PANEL.fs), -0.25, hz(PANEL.topH - 0.25)], b.root, 1.5, 70);
  env.lighting.addFloodLight('c172s.glare.r', 'glareshield', [GLARE.browX - 0.02, 0.2, hz(GLARE.topH - 0.04)], [sta(PANEL.fs), 0.2, hz(PANEL.topH - 0.25)], b.root, 1.5, 70);

  // ---------------------------------------------------------------- structure, panels, controls
  const cabin = buildCabin(b, ctx);
  const main = buildMainPanel(b, ctx, sys, displays, opts.analog ?? false);
  buildStack(b, main.panel, displays);
  const lower = buildLowerPanel(b, main.panel);
  buildPedestal(b);
  buildParkingBrake(b, main.panel);
  const fc = buildFlightControls(b, main.panel);

  // ---------------------------------------------------------------- visual-only animation hooks
  const flap = lower.flapPointer;
  const flapX = flap.position.x;
  const vTop = flap.position.y;
  const span = lower.flapScale.yBot - lower.flapScale.yTop;
  const stormAxis = new THREE.Vector3(1, 0, 0);
  const qBaseL = cabin.stormLeft.quaternion.clone();
  const qBaseR = cabin.stormRight.quaternion.clone();
  const qTmp = new THREE.Quaternion();
  b.onUpdate(() => {
    // Flap position indicator follows the actual flap angle (0..30 deg) down the scale.
    const f = Math.max(0, Math.min(1, vars.get(SURF.flapsDeg) / 30));
    flap.position.set(flapX, vTop - f * span, flap.position.z);
    // Storm windows swing inward/outward about their top hinge (EST 45 deg fully open).
    const wl = vars.get(C172.windowLeft);
    const wr = vars.get(C172.windowRight);
    cabin.stormLeft.quaternion.copy(qBaseL).multiply(qTmp.setFromAxisAngle(stormAxis, -wl * 0.8));
    cabin.stormRight.quaternion.copy(qBaseR).multiply(qTmp.setFromAxisAngle(stormAxis, -wr * 0.8));
    fc.lockFlag.visible = vars.get(C172.controlLock) > 0.5;
  });

  const build = b.build();
  // The six-pack sits low in the panel: look down a little more than the generic -8 deg.
  build.eyePitchDeg = -13; // whole six-pack plus the tach / ADF row on screen at 16:9
  return { build, systems: [] };
}
