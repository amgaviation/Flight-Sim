/**
 * Citation Longitude overhead LIGHTS strip (loaded by cockpit/index.ts through import.meta.glob; contract in
 * cockpit/context.ts).
 *
 * Layout audit L27-L31: the Longitude overhead is a single long narrow strip at the windshield header titled
 * "LIGHTS" (AOPA 2021 photograph c_oh; OG Fig 16-2-1, 16-3-2), measured at ~0.42 mm/px on a ~0.56 m strip, left to
 * right:
 *   L LDG, R LDG, TAXI, RECOG, PULSE | PANEL (MIN .. DAY), FLOOD (MIN), AUX (MIN) knobs | EMER LTS toggle in a ring
 *   guard ("EMER LTS ARM" above, "ON" at the side) | ANTI COLL, WING INSP, TAIL FLOOD, PAX SAFETY, SEAT BELTS.
 * Lighting buttons show a cyan ON when selected (OG oh_b). NAV, BEACON and auto-PULSE are on the GTC Exterior Lights
 * page (OG 16-3).
 * Not on the real overhead (so not built here): DOME toggle (the cockpit dome light is a GTC Lights-page toggle,
 * SCOPE in systems/synoptics.ts), PASS OXY switch / lens (GTC ECS page, SCOPE), FIRE WARN TEST and ANNUN TEST (GTC
 * Aircraft Systems > Tests page, OG Fig 9-7-1), windshield wipers (OG 12-3: none), windshield-heat switches
 * (automatic), storm lights (FLOOD at full is the thunderstorm setting; SCOPE).
 *
 * Headliner fixtures (L31, a18_002): the two large round fixtures either side of the strip carry the flood lights
 * (speaker / outlet rings), sun-visor rails above the side windows with sliding visors (SCOPE: shading state).
 *
 * Panel convention (facing down): +x = right, +y = aft (label tops toward the tail, as read when looking up;
 * docs/modules/cockpit.md §1). In the photograph the titles sit on the aft edge, which is the upper edge in a
 * pilot's-eye view of a strip facing down and aft.
 */
import * as THREE from 'three';
import { PushButton, RotaryKnob, ToggleSwitch } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { LON_VARS as V } from '../../vars';
import { lonMaterials, seg, type LonCockpitContext } from '../context';
import { SunVisor } from '../controls';

/** Overhead LIGHTS strip frame (EST from c_oh / a18_002): centre just aft of the windshield header, ~35 mm below the lining. */
export const OVERHEAD = {
  center_m: [7.93, 0, -1.012] as [number, number, number],
  tiltDeg: 12, // + = forward end lower (headliner slope at the header)
  width: 0.56,
  height: 0.11,
};

/** Dome light: centre of the headliner aft of the strip (EST 6 cd LED fixture: ~4 lux at the floor, ~6 lux at the seat pans). */
export const DOME_LIGHT = { position_m: [7.35, 0, -1.12] as [number, number, number], target_m: [7.45, 0, 0.62] as [number, number, number], candela: 6 };

const fmtPct = (v: number): string => (v <= 0.001 ? 'MIN' : `${Math.round(v * 100)} %`);

/** Lighting switchlight (~30 x 28 mm, c_oh), cyan ON when selected (OG oh_b). */
function lightButton(c: LonCockpitContext, p: Panel, id: string, name: string, v: string, x: number): PushButton {
  const btn = p.add(
    new PushButton(c.env, {
      id,
      label: name,
      var: v,
      mode: 'toggle',
      style: 'korry',
      width: 0.028,
      height: 0.026,
      layout: 'stack',
      unlitTint: 0.04,
      segments: [seg.eq('ON', 'cyan', v, 1)],
    }),
    x,
    -0.012,
  );
  const lines = name.split(' ');
  if (lines.length > 1 && name.length > 9) {
    p.label(lines[0], x, 0.0235, { height: 0.0032 });
    p.label(lines.slice(1).join(' '), x, 0.0185, { height: 0.0032 });
  } else p.label(name, x, 0.0205, { height: 0.0032 });
  return btn;
}

/** Dimmer knob with the engraved arc (MIN at the stop, DAY at full for PANEL). */
function dimKnob(c: LonCockpitContext, p: Panel, id: string, name: string, v: string, x: number, format = fmtPct, dayLabel = false): void {
  p.add(
    new RotaryKnob(c.env, {
      id,
      label: name,
      cap: 'dimmer',
      diameter: 0.017,
      outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: name, format },
    }),
    x,
    -0.012,
  );
  p.label(name, x, 0.0205, { height: 0.0032 });
  p.label('MIN', x - 0.011, -0.03, { height: 0.0022 });
  if (dayLabel) p.label('DAY', x + 0.013, -0.03, { height: 0.0022 });
  // Engraved range arc on the left of the knob (c_oh).
  for (let k = 0; k < 5; k++) {
    const a0 = THREE.MathUtils.degToRad(130 + k * 22);
    const a1 = THREE.MathUtils.degToRad(130 + (k + 1) * 22 - 4);
    const r = 0.0145;
    p.line(x + r * Math.cos(a0), -0.012 + r * Math.sin(a0), x + r * Math.cos(a1), -0.012 + r * Math.sin(a1), 0.0006 + k * 0.00025);
  }
}

export function buildOverhead(c: LonCockpitContext): void {
  const { b, env } = c;
  const M = lonMaterials(env);
  const O = OVERHEAD;
  const p = b.panel({ name: 'overhead', center_m: O.center_m, facing: 'down', tiltDeg: O.tiltDeg, width: O.width, height: O.height, material: M.deck, radius: 0.008, screws: { kind: 'hex', diameter: 0.004, inset: 0.008, positions: [[-O.width / 2 + 0.01, O.height / 2 - 0.01], [O.width / 2 - 0.01, O.height / 2 - 0.01], [-O.width / 2 + 0.01, -O.height / 2 + 0.01], [O.width / 2 - 0.01, -O.height / 2 + 0.01]] } });
  // Housing: trim box from the strip up into the headliner (hides the panel back).
  const housing = new THREE.Mesh(new THREE.BoxGeometry(O.width + 0.02, O.height + 0.02, 0.05), env.materials.get('headliner'));
  b.trackGeometry(housing.geometry);
  housing.userData.cockpitStatic = true;
  housing.name = 'overhead_housing';
  p.addObject(housing, 0, 0, { z: -0.027 });

  // Single "LIGHTS" title with the long bracket lines along the aft edge (c_oh).
  p.label('LIGHTS', 0, 0.041, { height: 0.0036 });
  p.line(-0.262, 0.041, -0.022, 0.041, 0.0009);
  p.line(0.022, 0.041, 0.262, 0.041, 0.0009);
  const left: [string, string, string][] = [
    ['lon.oh.ldg_l', 'L LDG', V.ltLdgL],
    ['lon.oh.ldg_r', 'R LDG', V.ltLdgR],
    ['lon.oh.taxi', 'TAXI', V.ltTaxi],
    ['lon.oh.recog', 'RECOG', V.ltRecog],
    ['lon.oh.pulse', 'PULSE', V.ltPulse],
  ];
  left.forEach(([id, name, v], i) => lightButton(c, p, id, name, v, -0.24 + i * 0.034));
  dimKnob(c, p, 'lon.oh.panel', 'PANEL', V.ltPanel, -0.064, (v) => (v >= 0.999 ? 'DAY' : fmtPct(v)), true);
  dimKnob(c, p, 'lon.oh.flood', 'FLOOD', V.ltFlood, -0.024);
  dimKnob(c, p, 'lon.oh.aux', 'AUX', V.ltAux, 0.018);
  // EMER LTS: OFF (down) / ON (centre, engraved at the side) / ARM (up) in a ring guard (c_oh). ARM lights the
  // emergency lights when both emergency buses lose power (lighting.ts). OFF is lever-locked (EST).
  p.add(
    new ToggleSwitch(env, {
      id: 'lon.oh.emer_lts',
      var: V.ltEmer,
      label: 'EMER LTS',
      positions: ['OFF', 'ON', 'ARM'],
      values: [0, 2, 1],
      initial: 2,
      handle: 'lever-lock',
      leverLock: [0],
      fence: 'wire',
      labels: { name: false, positions: false },
    }),
    0.065,
    -0.012,
  );
  p.label('EMER LTS', 0.065, 0.0235, { height: 0.0032 });
  p.label('ARM', 0.065, 0.0185, { height: 0.0032 });
  p.label('O', 0.049, -0.009, { height: 0.0028 });
  p.label('N', 0.049, -0.0135, { height: 0.0028 });
  const right: [string, string, string][] = [
    ['lon.oh.anti_coll', 'ANTI COLL', V.ltAntiColl],
    ['lon.oh.wing_insp', 'WING INSP', V.ltWingInsp],
    ['lon.oh.tail_flood', 'TAIL FLOOD', V.ltTailFlood],
    ['lon.oh.pax_safety', 'PAX SAFETY', V.ltPaxSafety],
    ['lon.oh.seat_belts', 'SEAT BELTS', V.ltSeatBelts],
  ];
  right.forEach(([id, name, v], i) => lightButton(c, p, id, name, v, 0.104 + i * 0.034));

  buildFixtures(c);
}

/** Dome, flood and emergency-light fixtures in the headliner (lighting zones and one real light), sun visors. */
function buildFixtures(c: LonCockpitContext): void {
  const { b, env } = c;
  const M = lonMaterials(env);
  b.zone({ id: 'dome', intensityVar: 'ac.light.dome', lagS: 0, color: 0xfff4e6 });
  // Cockpit emergency light lens: follows light.emer (lighting.ts; own battery packs, EST).
  b.zone({ id: 'emer_lt', intensityVar: 'light.emer', lagS: 0, color: 0xffffff });
  env.lighting.addLight({ id: 'dome', kind: 'spot', zone: 'dome', position_m: [DOME_LIGHT.position_m[0], 0, DOME_LIGHT.position_m[2] + 0.03], target_m: DOME_LIGHT.target_m, color: 0xfff4e6, candela: DOME_LIGHT.candela, distance: 3, angleDeg: 65, penumbra: 0.6 }, b.root);

  const lens = (zone: string, gain: number, r: number, pos: [number, number, number], name: string) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, emissive: 0xfff4e6, emissiveIntensity: 0, roughness: 0.35 });
    env.materials.track(m);
    env.lighting.registerBacklight(m, zone, gain);
    const g = new THREE.CylinderGeometry(r, r * 1.1, 0.008, 28);
    b.structureMesh(g, m, pos, undefined, false).name = name;
  };
  lens('dome', 2.2, 0.05, [DOME_LIGHT.position_m[0], 0, DOME_LIGHT.position_m[2] - 0.004], 'dome_lens');
  lens('emer_lt', 3, 0.022, [7.2, 0, -1.135], 'emer_lens');
  // Large round headliner fixtures either side of the strip (a18_002): grille ring (speaker / outlet) with the flood
  // light eyeball in its centre (the lights are created in cockpit/index.ts).
  const ringG = new THREE.TorusGeometry(0.05, 0.007, 10, 36);
  ringG.rotateX(Math.PI / 2);
  const grilleG = new THREE.CylinderGeometry(0.048, 0.048, 0.004, 32);
  const eyeG = new THREE.SphereGeometry(0.016, 16, 10);
  for (const y of [-0.42, 0.42]) {
    b.structureMesh(ringG.clone(), M.fixture, [7.93, y, -1.03], undefined, false).name = 'headliner_ring';
    b.structureMesh(grilleG.clone(), M.trim, [7.93, y, -1.034], undefined, false).name = 'headliner_grille';
    const m = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xfff1dc, emissiveIntensity: 0, roughness: 0.4 });
    env.materials.track(m);
    env.lighting.registerBacklight(m, 'flood', 1.5);
    b.structureMesh(eyeG.clone(), m, [7.93, y, -1.022], undefined, false).name = 'flood_eyeball';
  }
  ringG.dispose();
  grilleG.dispose();
  eyeG.dispose();
  // Sun-visor rails above the side windows and the sliding visors (L31; SCOPE: shading state only).
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x3a3a30, roughness: 0.2, transparent: true, opacity: 0.7 });
  env.materials.track(visorMat);
  for (const side of [-1, 1] as const) {
    // Top edge of the forward side window at x 7.7: interior (y, z) ~ (0.63, -0.9) (shell loft, SIDE_WINDOWS.roof).
    const y = side * 0.655;
    const rail = new THREE.CylinderGeometry(0.006, 0.006, 0.5, 10);
    rail.rotateX(Math.PI / 2);
    b.structureMesh(rail, M.fixture, [7.7, y, -0.875], undefined, false).name = 'visor_rail';
    // Visor face parallel to the glazing (inboard normal ~ (-sin 0.7, cos 0.7) in the section plane).
    const mount = b.panel({ name: `visor_mount_${side < 0 ? 'l' : 'r'}`, center_m: [7.78, y - side * 0.012, -0.862], normal: [0, -side * 0.64, 0.77], up: [0, -side * 0.77, -0.64], width: 0.27, height: 0.02, invisible: true });
    mount.add(new SunVisor(env, { id: `lon.oh.visor_${side < 0 ? 'l' : 'r'}`, label: `${side < 0 ? 'PILOT' : 'COPILOT'} SUN VISOR`, var: side < 0 ? V.visorL : V.visorR, material: visorMat }), 0, 0);
  }
}
