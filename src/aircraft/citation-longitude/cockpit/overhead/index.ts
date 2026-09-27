/**
 * Citation Longitude overhead panel (loaded by cockpit/index.ts through
 * import.meta.glob; contract in cockpit/context.ts).
 *
 * The Longitude overhead is a short console at the windshield header (dossier
 * §7.0 / §7.7). OG Section 16 names what it carries:
 *   - "The overhead lighting panel contains the following cockpit lighting
 *     controls: PANEL knob (instrument panel label backlighting, the Day
 *     position is full intensity), FLOOD knob (overhead cockpit flood light),
 *     AUX knob" (OG 16-2, Fig 16-2-1);
 *   - the exterior-light buttons L LDG, R LDG, RECOG, PULSE, TAXI, WING INSP,
 *     TAIL FLOOD and ANTI COLL "on the overhead lighting panel" (OG 16-3/16-4,
 *     Fig 16-3-2). NAV, BEACON and auto-PULSE live on the GTC Exterior Lights
 *     page (OG 16-3), not here;
 *   - EMER LTS OFF / ARM / ON (OG 17-2 Cockpit Inspection "EMER LTS Switch ...
 *     ARM"), PASS SAFETY, FIRE WARN TEST and PASS OXY (dossier §7.7, EST
 *     positions and legends, Citation-family practice).
 * Added here (EST, Citation-family practice; every one drives a system):
 *   - DOME light toggle (hot battery bus load `dome_lt`, dimmer 'dome');
 *   - ANNUN TEST: annunciator / CAS lamp test (`alert.annun_test`, read by the
 *     CasManager and every cockpit lens);
 *   - PASS OXY ON status lens (`oxy.pax_on`).
 * Not fitted on the Longitude (so not built): windshield wipers (OG 12-3: "not
 * equipped with windshield wipers ... hydrophobic coating"), windshield-heat
 * switches (OG 12-3: automatic controller), storm lights (the FLOOD knob at
 * full is the thunderstorm setting; SCOPE).
 *
 * Geometry (EST from flight-deck photographs): 0.40 m wide x 0.36 m long
 * console from x 7.99 aft to 7.63, following the 12 deg headliner slope, set
 * ~55 mm below the headliner in a light-grey trimmed housing. Panel
 * convention (facing down): +x = right, +y = aft (label tops toward the tail,
 * as read when looking up; docs/modules/cockpit.md §1).
 */
import * as THREE from 'three';
import { AnnunciatorLight, GuardedSwitch, PushButton, RotaryKnob, ToggleSwitch } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { LON_VARS as V } from '../../vars';
import { seg, type LonCockpitContext } from '../context';

/** Overhead panel frame (EST). Kept inside the headliner: centre 55 mm below the skin inset at x 7.77. */
export const OVERHEAD = {
  center_m: [7.81, 0, -1.03] as [number, number, number],
  tiltDeg: 12, // + = forward end lower here (verified with placePanel: -12 raised the front into the windshield header)
  width: 0.4,
  height: 0.36,
};

/** Dome light: centre of the headliner aft of the overhead console (EST 6 cd LED fixture: ~4 lux at the floor, ~6 lux at the seat pans). */
export const DOME_LIGHT = { position_m: [7.35, 0, -1.12] as [number, number, number], target_m: [7.45, 0, 0.62] as [number, number, number], candela: 6 };

const fmtPct = (v: number): string => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)} %`);

/** Korry lighting button: white ON legend when selected (EST legend colour, same convention as the ice buttons, OG 12-3). */
function lightButton(c: LonCockpitContext, p: Panel, id: string, name: string, v: string, x: number, y: number): PushButton {
  const btn = p.add(
    new PushButton(c.env, {
      id,
      label: name,
      var: v,
      mode: 'toggle',
      style: 'korry',
      width: 0.0175,
      height: 0.0175,
      layout: 'stack',
      segments: [seg.eq('ON', 'white', v, 1)],
    }),
    x,
    y,
  );
  p.label(name, x, y + 0.0158, { height: 0.0031 });
  return btn;
}

/** Dimmer knob (0..1, pointer, OFF at the stop). */
function dimKnob(c: LonCockpitContext, p: Panel, id: string, name: string, v: string, x: number, y: number, format = fmtPct): void {
  p.add(
    new RotaryKnob(c.env, {
      id,
      label: name,
      cap: 'dimmer',
      diameter: 0.016,
      outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: name, format },
    }),
    x,
    y,
  );
  p.label(name, x, y + 0.019, { height: 0.0032 });
  p.label('OFF', x - 0.0135, y - 0.0125, { height: 0.0019 });
}

export function buildOverhead(c: LonCockpitContext): void {
  const { b, env } = c;
  const O = OVERHEAD;
  const p = b.panel({ name: 'overhead', center_m: O.center_m, facing: 'down', tiltDeg: O.tiltDeg, width: O.width, height: O.height, material: 'panel', radius: 0.01, screws: { kind: 'dzus', diameter: 0.007, inset: 0.008 } });

  // Housing: light-grey trim box from the panel edge up into the headliner (hides the panel back).
  const housing = new THREE.Mesh(new THREE.BoxGeometry(O.width + 0.03, O.height + 0.03, 0.1), env.materials.get('headliner'));
  b.trackGeometry(housing.geometry);
  housing.userData.cockpitStatic = true;
  housing.name = 'overhead_housing';
  p.addObject(housing, 0, 0, { z: -0.052 });

  // ---------------------------------------------------------------- EXTERIOR LIGHTS (forward row, OG 16-3 Fig 16-3-2)
  const yExt = -0.12;
  p.bracket('EXTERIOR LIGHTS', 0, yExt + 0.033, 0.34);
  const ext: [string, string, string][] = [
    ['lon.oh.ldg_l', 'L LDG', V.ltLdgL],
    ['lon.oh.ldg_r', 'R LDG', V.ltLdgR],
    ['lon.oh.recog', 'RECOG', V.ltRecog],
    ['lon.oh.pulse', 'PULSE', V.ltPulse],
    ['lon.oh.taxi', 'TAXI', V.ltTaxi],
    ['lon.oh.wing_insp', 'WING INSP', V.ltWingInsp],
    ['lon.oh.tail_flood', 'TAIL FLOOD', V.ltTailFlood],
    ['lon.oh.anti_coll', 'ANTI COLL', V.ltAntiColl],
  ];
  ext.forEach(([id, name, v], i) => lightButton(c, p, id, name, v, -0.1505 + i * 0.043, yExt));

  // ---------------------------------------------------------------- COCKPIT LIGHTS (OG 16-2 Fig 16-2-1)
  const yCk = -0.025;
  p.bracket('COCKPIT LIGHTS', -0.075, yCk + 0.037, 0.2);
  dimKnob(c, p, 'lon.oh.panel', 'PANEL', V.ltPanel, -0.14, yCk, (v) => (v >= 0.999 ? 'DAY' : fmtPct(v)));
  p.label('DAY', -0.14 + 0.0135, yCk - 0.0125, { height: 0.0019 });
  dimKnob(c, p, 'lon.oh.flood', 'FLOOD', V.ltFlood, -0.075, yCk);
  dimKnob(c, p, 'lon.oh.aux', 'AUX', V.ltAux, -0.01, yCk);
  p.add(
    new ToggleSwitch(env, {
      id: 'lon.oh.dome',
      var: V.ltDome,
      label: 'DOME',
      positions: ['OFF', 'ON'],
      labels: { name: 'DOME', positions: true, height: 0.0026 },
    }),
    0.055,
    yCk - 0.002,
  );
  // EMER LTS: OFF / ARM / ON (OG 17-2). ARM lights the emergency lights when both emergency buses lose power (lighting.ts).
  p.add(
    new ToggleSwitch(env, {
      id: 'lon.oh.emer_lts',
      var: V.ltEmer,
      label: 'EMER LTS',
      positions: ['OFF', 'ARM', 'ON'],
      values: [0, 1, 2],
      initial: 1,
      handle: 'lever-lock',
      leverLock: [0],
      labels: { name: 'EMER LTS', positions: true, height: 0.0026 },
    }),
    0.13,
    yCk - 0.002,
  );

  // ---------------------------------------------------------------- PASS SAFETY / OXYGEN / TEST (aft row)
  const yAft = 0.085;
  p.add(
    new ToggleSwitch(env, {
      id: 'lon.oh.pass_safety',
      var: V.ltSeatBelt,
      label: 'PASS SAFETY',
      positions: ['OFF', 'SEAT BELT', 'PASS SAFETY'],
      values: [0, 1, 2],
      labels: { name: 'PASS SIGNS', positions: true, height: 0.0024 },
    }),
    -0.145,
    yAft,
  );
  p.bracket('OXYGEN', -0.04, yAft + 0.04, 0.1);
  // PASS OXY: guarded NORM / MAN DEPLOY (dossier §4.8 / §7.7; masks also deploy automatically at 14,000 ft cabin).
  p.add(
    new GuardedSwitch(env, {
      id: 'lon.oh.pass_oxy',
      var: V.oxyPax,
      label: 'PASS OXY',
      positions: ['NORM', 'MAN DEPLOY'],
      values: [0, 1],
      labels: { name: false, positions: true, height: 0.0022 },
      guard: { color: 'red', guardedPosition: 0, close: 'returns' },
    }),
    -0.06,
    yAft,
  );
  p.add(
    new AnnunciatorLight(env, {
      id: 'lon.oh.pass_oxy_on',
      label: 'PASS OXY ON',
      width: 0.02,
      height: 0.013,
      layout: 'stack',
      segments: [seg.on(['PASS OXY', 'ON'], 'white', 'oxy.pax_on')],
    }),
    -0.018,
    yAft,
  );
  p.bracket('TEST', 0.1, yAft + 0.04, 0.1);
  p.add(
    new PushButton(env, {
      id: 'lon.oh.fire_test',
      label: 'FIRE WARN TEST',
      var: V.fireTest,
      mode: 'momentary',
      style: 'korry',
      width: 0.0175,
      height: 0.0175,
      layout: 'stack',
      segments: [seg.on(['FIRE', 'TEST'], 'white', 'fire.test')],
    }),
    0.075,
    yAft,
  );
  p.label('FIRE WARN', 0.075, yAft + 0.0155, { height: 0.0024 });
  p.add(
    new PushButton(env, {
      id: 'lon.oh.annun_test',
      label: 'ANNUN TEST',
      var: V.lampTest,
      mode: 'momentary',
      style: 'korry',
      width: 0.0175,
      height: 0.0175,
      layout: 'stack',
      segments: [seg.on(['LAMP', 'TEST'], 'white', V.lampTest)],
    }),
    0.125,
    yAft,
  );
  p.label('ANNUN', 0.125, yAft + 0.0155, { height: 0.0024 });

  // Placard (EST): the emergency-light arming note.
  p.placard({ text: 'EMER LTS - ARM BEFORE FLIGHT', height: 0.0021, style: 'engraved' }, 0.1, yCk - 0.034);

  buildFixtures(c);
}

/** Dome, flood and emergency-light fixtures in the headliner (lighting zones and one real light). */
function buildFixtures(c: LonCockpitContext): void {
  const { b, env } = c;
  b.zone({ id: 'dome', intensityVar: 'ac.light.dome', lagS: 0, color: 0xfff4e6 });
  // Cockpit emergency light lens: follows light.emer (lighting.ts; own battery packs, EST).
  b.zone({ id: 'emer_lt', intensityVar: 'light.emer', lagS: 0, color: 0xffffff });
  // Spot aimed down from just below the lens: the fixture's reflector keeps the light off the headliner around it
  // (a point light on the ceiling washes the headliner out).
  env.lighting.addLight({ id: 'dome', kind: 'spot', zone: 'dome', position_m: [DOME_LIGHT.position_m[0], 0, DOME_LIGHT.position_m[2] + 0.03], target_m: DOME_LIGHT.target_m, color: 0xfff4e6, candela: DOME_LIGHT.candela, distance: 3, angleDeg: 65, penumbra: 0.6 }, b.root);

  const lens = (zone: string, gain: number, r: number, pos: [number, number, number], name: string) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, emissive: 0xfff4e6, emissiveIntensity: 0, roughness: 0.35 });
    env.materials.track(m);
    env.lighting.registerBacklight(m, zone, gain);
    const g = new THREE.CylinderGeometry(r, r * 1.1, 0.008, 28);
    b.structureMesh(g, m, pos, undefined, false).name = name;
  };
  // Dome light lens (round LED fixture), emergency light lens aft of it.
  lens('dome', 2.2, 0.05, [DOME_LIGHT.position_m[0], 0, DOME_LIGHT.position_m[2] - 0.004], 'dome_lens');
  lens('emer_lt', 3, 0.022, [7.2, 0, -1.135], 'emer_lens');
  // Flood-light eyeballs over each seat (the lights themselves are created in cockpit/index.ts).
  const eyeG = new THREE.SphereGeometry(0.018, 16, 10);
  const bezelG = new THREE.CylinderGeometry(0.026, 0.026, 0.006, 20);
  for (const y of [-0.42, 0.42]) {
    b.structureMesh(bezelG.clone(), 'bezel', [7.95, y, -1.03], undefined, false).name = 'flood_bezel';
    const m = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xfff1dc, emissiveIntensity: 0, roughness: 0.4 });
    env.materials.track(m);
    env.lighting.registerBacklight(m, 'flood', 1.5);
    b.structureMesh(eyeG.clone(), m, [7.95, y, -1.02], undefined, false).name = 'flood_eyeball';
  }
  eyeG.dispose();
  bezelG.dispose();
}
