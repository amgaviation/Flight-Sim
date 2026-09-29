/**
 * Boeing 737-800 flight deck: assembles the structure, main instrument
 * panel, glareshield (MCP / EFIS / master lights), forward electronic panel
 * (CDUs), control stand, aft electronic panel, flight controls, lighting
 * and the 737NG avionics suite displays into a `CockpitBuild`, and loads the
 * overhead / side-console builders when their folders exist (contract in
 * context.ts).
 *
 * Lighting (FCOM 1.30 "Lighting"; systems/airframe.ts createLighting
 * dimmers, `ac.light.<id>`):
 *  - 'panel': label / legend backlighting of the main deck, from the
 *    brightest of the Captain, F/O and pedestal PANEL dimmers (SCOPE: one
 *    backlight channel for the three dimmers; the overhead uses its own).
 *  - 'flood': two glareshield flood lights over the main panel (GLARESHIELD
 *    FLOOD and BACKGROUND knobs; the brighter drives them).
 *  - 'afds': the MCP flood strip under the glareshield brow (AFDS FLOOD).
 *  - 'ped_flood': pedestal flood light in the overhead aft of the MCP
 *    (pedestal FLOOD knob). 'dome': the dome light (DOME switch).
 *  Annunciators dim with the LIGHTS switch DIM (40 %, EST) and light with
 *  TEST (the systems already drive the lamp vars; the cockpit lamp test lights
 *  the suite lenses too). Real lights: 4 (docs/modules/cockpit.md §11).
 */
import * as THREE from 'three';
import { CockpitBuilder, type CockpitBuildEx } from '../../../cockpit/CockpitBuilder';
import { PALETTES, type PaletteDef } from '../../../cockpit/materials';
import { placePanel } from '../../../cockpit/frame';
import type { SimContext } from '../../../core/SimContext';
import type { B738Systems } from '../createSystems';
import { B738 } from '../vars';
import { CK, type B738CockpitContext } from './context';
import { EYE_L, EYE_R, GLARE, MOUNTS } from './layout';
import { buildShell, buildWipers } from './shell';
import { buildMainPanel } from './mainPanel';
import { buildGlareshield } from './glareshield';
import { buildPedestal } from './pedestal';
import { buildAftPedestal } from './aftPedestal';
import { buildFlightControls } from './flightControls';
import { installRadioTuning } from './radioTuning';

type OverheadModule = { buildOverhead?: (c: B738CockpitContext) => void };
type SideModule = { buildSideConsoles?: (c: B738CockpitContext) => void };
const OVERHEAD = import.meta.glob<OverheadModule>('./overhead/index.ts', { eager: true });
const SIDE = import.meta.glob<SideModule>('./side/index.ts', { eager: true });

export interface B738CockpitOptions {
  /** No aircraft-owned canvas displays (node tests). */
  headless?: boolean;
  /** Skip the overhead / side-console builders even when present. */
  mainOnly?: boolean;
}

export interface B738Cockpit {
  build: CockpitBuildEx;
  context: B738CockpitContext;
}

/** Derived flood var: the brighter of the glareshield flood and background knobs. */
const FLOOD_VAR = 'ac.b738.ck.flood';

/**
 * 737NG flight-deck finish: medium Boeing grey panels (b737.org.uk NG flight deck photographs and the SCBG drawing
 * tone; the library 'boeing' palette's FS 36440 Light Gull Gray rendered near-white, sRGB ~215 in daylight).
 * EST albedo #50524e renders ~sRGB 120-130 in the daylight pilot view (#646662 measured 157); the MCP / EFIS / module plates use the
 * same panel grey ('panel'), gaps and backings a darker grey. Legends: incandescent backlighting ~2700 K (EST
 * #ffc27f), glowing warm on the dark panel at night.
 */
const B738_PALETTE: PaletteDef = {
  ...PALETTES.boeing,
  name: 'Boeing 737NG (medium Boeing grey)',
  panel: '#50524e',
  panelDark: '#303335',
  // Incandescent 5 V integral lighting ~2700 K (EST, tuned against the b737.org.uk night overhead photograph:
  // clearly orange-white, every legend legible at mid dimmer).
  backlight: '#ffb668',
};
const ANNUN_BRT = 'ac.b738.ck.annun_brt';

export function buildB738Cockpit(ctx: SimContext, sys: B738Systems, o: B738CockpitOptions = {}): B738Cockpit {
  const b = new CockpitBuilder(ctx, {
    palette: B738_PALETTE,
    name: 'b737-800',
    eyePosition_m: EYE_L,
    views: [
      { name: 'First Officer', position_m: EYE_R, yawDeg: 0, pitchDeg: -8 },
      { name: 'MCP / glareshield', position_m: [13.98, -0.12, -0.42], yawDeg: 4, pitchDeg: -10, fovDeg: 42 },
      { name: 'Centre panel', position_m: [13.92, -0.22, -0.34], yawDeg: 14, pitchDeg: -26, fovDeg: 48 },
      { name: 'FMS / CDU', position_m: [13.9, -0.22, -0.2], yawDeg: 12, pitchDeg: -50, fovDeg: 45 },
      { name: 'Throttle quadrant', position_m: [13.55, -0.3, -0.32], yawDeg: 22, pitchDeg: -58, fovDeg: 55 },
      { name: 'Aft pedestal (radios / fire)', position_m: [13.2, -0.26, -0.3], yawDeg: 25, pitchDeg: -72, fovDeg: 58 },
      { name: 'Overhead', position_m: [13.42, -0.08, -0.42], yawDeg: 4, pitchDeg: 66, fovDeg: 72 },
      // Overhead / side-console agent views (cockpit/overhead, cockpit/side).
      { name: 'Overhead left (FLT CONTROL / FUEL / ELEC)', position_m: [13.5, -0.2, -0.44], yawDeg: -4, pitchDeg: 68, fovDeg: 44 },
      { name: 'Overhead right (AIR COND / BLEED / PRESS)', position_m: [13.5, 0.2, -0.44], yawDeg: 4, pitchDeg: 68, fovDeg: 44 },
      { name: 'Aft overhead (IRS / doors)', position_m: [13.22, -0.05, -0.45], yawDeg: 0, pitchDeg: 89, fovDeg: 80 },
      { name: 'Captain side console / P18 breakers', position_m: [13.45, -0.5, -0.4], yawDeg: -118, pitchDeg: -14, fovDeg: 72 },
      { name: 'F/O side console / P6 breakers', position_m: [13.45, 0.5, -0.4], yawDeg: 118, pitchDeg: -14, fovDeg: 72 },
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
  const disposers: (() => void)[] = [];
  const c: B738CockpitContext = {
    b,
    env,
    ctx,
    sys,
    headless: o.headless ?? false,
    mounts: {
      overheadFwd: mount('overheadFwd', MOUNTS.overheadFwd),
      overheadAft: mount('overheadAft', MOUNTS.overheadAft),
      sideLeft: mount('sideLeft', MOUNTS.sideLeft),
      sideRight: mount('sideRight', MOUNTS.sideRight),
    },
    onDispose: (fn) => disposers.push(fn),
  };

  // ---- lighting zones and real lights
  // Legend backlight gain raised so every legend reads clearly at PANEL dimmer ~50 % over the (dimmer) flood
  // wash at night (EST gains, tuned against the b737.org.uk NG night flight-deck / overhead photographs: warm
  // ~2700 K legends bright on a dark panel, floods only a dim wash; fix round 1 B738-L03).
  b.zone({ id: 'panel', intensityVar: CK.panelLight, gain: 4.5 });
  b.zone({ id: 'flood', intensityVar: FLOOD_VAR, color: 0xffd9a6 });
  // AFDS zone lights the MCP legends too: same gain class as the panel backlight (B738-L03).
  b.zone({ id: 'afds', intensityVar: 'ac.light.flood_afds', color: 0xffd9a6, gain: 4.5 });
  b.zone({ id: 'ped_flood', intensityVar: 'ac.light.flood_pedestal', color: 0xffd9a6 });
  b.zone({ id: 'dome', intensityVar: 'ac.light.dome', color: 0xfff0dc });
  env.lighting.setAnnunciatorDimming(ANNUN_BRT, 0.4);
  env.lighting.lampTestVar = CK.lampTest;
  // Glareshield floods under the brow: sources outboard of each pilot, cross-aimed inboard with wide cones so
  // the two washes overlap into one even low wash across P1-P3 (nightflightdeck.jpg; fix round 1 B738-L07).
  env.lighting.addFloodLight('flood.l', 'flood', [14.44, -0.68, -0.27], [14.6, -0.25, 0.02], b.root, 1.3, 85);
  env.lighting.addFloodLight('flood.r', 'flood', [14.44, 0.68, -0.27], [14.6, 0.25, 0.02], b.root, 1.3, 85);
  // Pedestal flood in the overhead aft of the glareshield (EST 2.5 cd, narrowed so the centre panel shows no
  // warm hotspot at night; fix round 1 G18).
  env.lighting.addFloodLight('flood.ped', 'ped_flood', [13.75, 0, -0.95], [13.8, 0, 0.35], b.root, 2.5, 40);
  // Dome light in the headliner (EST 6 cd).
  env.lighting.addDomeLight('dome', 'dome', [13.2, 0, -1.2], b.root, 6);
  // Interior daylight fill: the NG deck has a large glazed area over a light-grey interior; the default admitted
  // fraction rendered the (shadowed) overhead markedly darker olive than the light Boeing grey of the direct-lit
  // MIP (day capture view_7 vs paneloverhead_737-700.jpg). EST 0.09 raises the indirect fill so the shadowed
  // ceiling reads the same grey family as the panels (fix round 1 B738-L11).
  env.lighting.interiorFill.admitted = 0.09;

  buildShell(b);
  buildWipers(b, ctx.vars);
  // AFDS flood strip tucked under the brow overhang, below the hood top surface, so it lights the MCP face but
  // is hidden from the design eye behind the hood lip (night captures showed the emissive strip as a bright
  // line along the hood top edge; fix round 1 B738-L08. Sight line from EYE_CAPT over the lip at z -0.345
  // passes z -0.344 at this x, so the strip at z -0.331 is occluded).
  const strip = new THREE.MeshStandardMaterial({ color: 0x151515, emissive: 0xffd9a6, emissiveIntensity: 0, roughness: 0.6 });
  env.materials.track(strip);
  env.lighting.registerBacklight(strip, 'afds', 1.4);
  b.structureMesh(new THREE.BoxGeometry(0.48, 0.004, 0.008), strip, [GLARE.lipX + 0.012, 0, -0.331], undefined, false).name = 'afds_flood_strip';

  buildMainPanel(c);
  buildGlareshield(c);
  buildPedestal(c);
  buildAftPedestal(c);
  buildFlightControls(c);
  c.onDispose(installRadioTuning(ctx));
  if (!o.mainOnly) {
    for (const m of Object.values(OVERHEAD)) m.buildOverhead?.(c);
    for (const m of Object.values(SIDE)) m.buildSideConsoles?.(c);
  }

  // ---- derived display-side vars (systems never read these)
  const vars = ctx.vars;
  b.onUpdate(() => {
    vars.set(CK.panelLight, Math.max(vars.get('ac.light.panel_capt'), vars.get('ac.light.panel_fo'), vars.get('ac.light.panel_pedestal')));
    vars.set(FLOOD_VAR, Math.max(vars.get('ac.light.flood_gs'), vars.get('ac.light.background')));
    const lt = vars.get(B738.lightsTest);
    vars.set(CK.lampTest, lt >= 0.5 ? 1 : 0);
    vars.set(ANNUN_BRT, lt <= -0.5 ? 0 : 1);
  });

  const build = b.build();
  const baseDispose = build.dispose?.bind(build);
  build.dispose = () => {
    for (const d of disposers) d();
    disposers.length = 0;
    baseDispose?.();
  };
  return { build, context: c };
}
