/**
 * Citation Longitude flight deck: assembles the structure, main panel,
 * glareshield, pedestal, flight controls, lighting and the Garmin G5000
 * displays into a `CockpitBuild`, and loads the overhead / side-console
 * builders when their folders exist (contract in context.ts).
 *
 * Lighting (OG Section 16, lighting.ts): label backlighting zone 'panel'
 * (`ac.light.panel`, PANEL knob, DAY = full), two flood lights ('flood',
 * FLOOD knob), map lights L / R ('map_l' / 'map_r'), glareshield
 * under-light strip ('aux', AUX knob, EST). Annunciators are powered from
 * the emergency buses and dim when the PANEL knob is out of DAY (EST,
 * Citation-family practice); lamp test via `alert.annun_test`.
 */
import * as THREE from 'three';
import { CockpitBuilder, type CockpitBuildEx } from '../../../cockpit/CockpitBuilder';
import { placePanel } from '../../../cockpit/frame';
import type { SimContext } from '../../../core/SimContext';
import type { G3000Suite } from '../../../avionics/garmin-g3000';
import type { LongitudeSystems } from '../createSystems';
import { LON_VARS as V } from '../vars';
import { CK, type LonCockpitContext } from './context';
import { EYE_L, EYE_R, GLARE_HOOD, MOUNTS } from './layout';
import { buildShell } from './shell';
import { buildGlareshield } from './glareshield';
import { buildMainPanel } from './mainPanel';
import { buildPedestal } from './pedestal';
import { buildFlightControls } from './flightControls';

type OverheadModule = { buildOverhead?: (c: LonCockpitContext) => void };
type SideModule = { buildSideConsoles?: (c: LonCockpitContext) => void };
const OVERHEAD = import.meta.glob<OverheadModule>('./overhead/index.ts', { eager: true });
const SIDE = import.meta.glob<SideModule>('./side/index.ts', { eager: true });

export interface LongitudeCockpitOptions {
  /** No canvas displays (node tests). */
  headless?: boolean;
  /** Skip the overhead / side-console builders even when present. */
  mainOnly?: boolean;
}

export interface LongitudeCockpit {
  build: CockpitBuildEx;
  context: LonCockpitContext;
}

export function buildLongitudeCockpit(ctx: SimContext, sys: LongitudeSystems, suite: G3000Suite | null, o: LongitudeCockpitOptions = {}): LongitudeCockpit {
  const b = new CockpitBuilder(ctx, {
    palette: 'citation',
    name: 'citation-longitude',
    eyePosition_m: EYE_L,
    views: [
      { name: 'Copilot', position_m: EYE_R, yawDeg: 0, pitchDeg: -8 },
      { name: 'Glareshield (GMC 710)', position_m: [7.95, -0.06, -0.45], yawDeg: 4, pitchDeg: -15, fovDeg: 44 },
      { name: 'Lower glareshield tier (display controllers, standby)', position_m: [7.95, -0.05, -0.4], yawDeg: 3, pitchDeg: -19, fovDeg: 52 },
      { name: 'Pilot lower panel (electrical)', position_m: [7.97, -0.33, -0.13], yawDeg: 0, pitchDeg: -36, fovDeg: 44 },
      { name: 'Copilot lower panel (gear, ice protection)', position_m: [7.97, 0.33, -0.13], yawDeg: 0, pitchDeg: -36, fovDeg: 44 },
      { name: 'Pedestal', position_m: [7.42, -0.22, -0.36], yawDeg: 24, pitchDeg: -66, fovDeg: 60 },
      { name: 'MFD GTCs (FMS)', position_m: [7.9, -0.06, -0.22], yawDeg: 6, pitchDeg: -40, fovDeg: 45 },
      { name: 'Overhead', position_m: [7.55, 0, -0.62], yawDeg: 0, pitchDeg: 48, fovDeg: 55 },
      { name: 'Tiller / left console', position_m: [7.62, -0.45, -0.4], yawDeg: -40, pitchDeg: -45, fovDeg: 55 },
      // Added with the side consoles (cockpit/side): oxygen masks and circuit-breaker panels.
      { name: 'Left console (O2, breakers)', position_m: [7.5, -0.5, -0.3], yawDeg: -80, pitchDeg: -30, fovDeg: 62 },
      { name: 'Right console (O2, breakers)', position_m: [7.5, 0.5, -0.3], yawDeg: 80, pitchDeg: -30, fovDeg: 62 },
      // Close-ups added by the verification pass so the pedestal legends are legible at 1280 x 720.
      { name: 'Pedestal forward (fuel, hydraulics, levers)', position_m: [7.74, 0, -0.26], yawDeg: 0, pitchDeg: -60, fovDeg: 50 },
      { name: 'Pedestal aft (engines, ECS, pressurization, APU)', position_m: [7.52, 0, -0.26], yawDeg: 0, pitchDeg: -82, fovDeg: 52 },
      { name: 'Pedestal aft face (PITCH/ROLL DISCONNECT)', position_m: [6.95, 0.05, -0.12], yawDeg: 0, pitchDeg: -38, fovDeg: 40 },
    ],
  });
  const env = b.env;
  const mount = (name: string, p: (typeof MOUNTS)[keyof typeof MOUNTS]) => {
    const g = new THREE.Group();
    g.name = `mount:${name}`;
    placePanel(g, p);
    b.root.add(g);
    return g;
  };
  const c: LonCockpitContext = {
    b,
    env,
    ctx,
    sys,
    suite,
    headless: o.headless ?? false,
    mounts: { overhead: mount('overhead', MOUNTS.overhead), sideLeft: mount('sideLeft', MOUNTS.sideLeft), sideRight: mount('sideRight', MOUNTS.sideRight) },
  };

  // ---- lighting zones and real lights (<= 5, docs/modules/cockpit.md §11)
  // L2-14: gain raised 1.5 -> 4 so engraved legends read at night with the PANEL knob up (OG 16-2: the PANEL knob
  // backlights all panel legends); EST gain tuned on the 02:00 screenshots (tests/output/lon-night2).
  b.zone({ id: 'panel', intensityVar: 'ac.light.panel', lagS: 0, gain: 4 }); // LED edge-lit panels
  b.zone({ id: 'flood', intensityVar: 'ac.light.flood', lagS: 0, color: 0xfff1dc });
  b.zone({ id: 'aux', intensityVar: 'ac.light.aux', lagS: 0, color: 0xfff1dc });
  b.zone({ id: 'map_l', intensityVar: 'ac.light.map_l', lagS: 0, color: 0xfff1dc });
  b.zone({ id: 'map_r', intensityVar: 'ac.light.map_r', lagS: 0, color: 0xfff1dc });
  env.lighting.setAnnunciatorDimming(CK.annunBright, 0.3, false, CK.annunPower);
  // Flood lights in the headliner fixtures either side of the overhead strip, aimed at the main panel (EST 4 cd LED floods).
  env.lighting.addFloodLight('flood.l', 'flood', [7.93, -0.42, -1.01], [8.34, -0.42, 0.0], b.root, 4, 55);
  env.lighting.addFloodLight('flood.r', 'flood', [7.93, 0.42, -1.01], [8.34, 0.42, 0.0], b.root, 4, 55);
  // Map lights on the side-window header, aimed at each pilot's lap (EST 3 cd).
  env.lighting.addMapLight('map.l', 'map_l', [7.55, -0.82, -0.72], [7.7, -0.45, 0.2], b.root, 3);
  env.lighting.addMapLight('map.r', 'map_r', [7.55, 0.82, -0.72], [7.7, 0.45, 0.2], b.root, 3);

  buildShell(b);
  // Glareshield under-light: LED strip along the soffit lighting the displays' bezels (AUX knob, EST).
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xfff1dc, emissiveIntensity: 0, roughness: 0.6 });
  env.materials.track(stripMat);
  env.lighting.registerBacklight(stripMat, 'aux', 1.2);
  // Under the glareshield brow lip, just aft of the GMC-tier face top (layout.ts GLARE_HOOD).
  b.structureMesh(new THREE.BoxGeometry(1.7, 0.004, 0.006), stripMat, [GLARE_HOOD.aftX - 0.036, 0, GLARE_HOOD.topZ + 0.034], undefined, false).name = 'aux_strip';

  buildMainPanel(c);
  buildGlareshield(c);
  buildPedestal(c);
  buildFlightControls(c);
  if (!o.mainOnly) {
    for (const m of Object.values(OVERHEAD)) m.buildOverhead?.(c);
    for (const m of Object.values(SIDE)) m.buildSideConsoles?.(c);
  }

  // ---- derived annunciator states (display-side only; systems never read these)
  const vars = ctx.vars;
  const gearRed = ['gear.red0', 'gear.red1', 'gear.red2'];
  const bottleArmed = [CK.bottleArmed(1), CK.bottleArmed(2)];
  b.onUpdate(() => {
    vars.set(CK.annunPower, vars.get('elec.emer_l_powered') !== 0 || vars.get('elec.emer_r_powered') !== 0 ? 1 : 0);
    vars.set(CK.annunBright, vars.get(V.ltPanel, 1) >= 0.95 ? 1 : 0);
    const armed = vars.get('fire.eng1_armed') !== 0 || vars.get('fire.eng2_armed') !== 0;
    vars.set(bottleArmed[0], armed && vars.get('fire.bottle1_discharged') === 0 ? 1 : 0);
    vars.set(bottleArmed[1], armed && vars.get('fire.bottle2_discharged') === 0 ? 1 : 0);
    vars.set(CK.gearRed, vars.get(gearRed[0]) !== 0 || vars.get(gearRed[1]) !== 0 || vars.get(gearRed[2]) !== 0 ? 1 : 0);
  });

  const build = b.build();
  return { build, context: c };
}
