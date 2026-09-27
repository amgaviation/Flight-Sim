/**
 * Citation M2 overhead area (loaded by cockpit/index.ts through
 * import.meta.glob; contract `M2CockpitPart` in cockpit/index.ts).
 *
 * The M2 has no overhead switch panel: every system switch is on the
 * instrument / tilt panels, the glareshield and the pedestal (S&D15 §10.2).
 * What the S&D places in the cockpit ceiling area (S&D15 §10.4
 * "Miscellaneous cockpit equipment" and §11.1) is built here:
 *   - "Magnetic Compass" at the BASE of the windshield centre post, sitting
 *     on the glareshield top in the forward view (S&D15 Fig III, S&D21 Fig 3;
 *     compass.ts), with the "Eye Position Reference Indicator" (ball on a T
 *     stalk, flanked by the two orange ice-detection lights of
 *     cockpit/index.ts) directly above it on the post (M2-L09; EST positions);
 *   - "Two Reading Lights" (L / R, headliner above each seat): the fixtures
 *     around the map-light spots of cockpit/index.ts, lens lit by a small
 *     dimmer knob on each fixture (EST: the M2 has no tilt-panel map-light
 *     dimmers in the photos; `ac.m2.map_lt1/2` -> `ac.light.map_l/_r`);
 *   - "Two Ventilation Air Outlets" (gaspers) beside the reading lights;
 *   - "Floodlight": an overhead cockpit floodlight on the FLOOD dimmer
 *     (`ac.light.flood`), lighting the pedestal and throttle quadrant at
 *     night (EST 3 cd LED fixture, in addition to the glareshield LED floods);
 *   - "Two Oxygen Masks": quick-donning pressure-demand masks with
 *     microphones "at each crew seat" (S&D15 §9.6), stowed above each crew
 *     member's shoulder (S&D21 §10.1). Each stowage has the regulator
 *     selector N / 100% / EMER (`ac.m2.mask<n>_mode`, OxygenSystem crew mask
 *     mode 0 / 1 / 2), a PRESS TO TEST button (`ac.m2.mask<n>_test`,
 *     OxygenSystem crew test) and the flow indicator (`oxy.crew<n>_flowing`).
 *
 * Not fitted on the M2, so not built: overhead switch panel, dome light
 * (reading lights + floodlight only, S&D15 §10.4), storm lights, windshield
 * wipers (rain removal doors, S&D15 §9.7), electric windshield heat (bleed
 * air, S&D15 §9.7), emergency-lighting switch (CAE CJ differences p. 5-17:
 * none on the CJ/CJ1/CJ2 family; automatic battery pack, side/services.ts).
 *
 * Geometry EST from cockpit photographs; the fittings sit on the headliner
 * lining computed from the shell profile (side/interior.ts).
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../../cockpit/CockpitBuilder';
import { AnnunciatorLight, PushButton, RotaryKnob, SelectorKnob } from '../../../../cockpit/controls';
import { bl } from '../../../../cockpit/frame';
import { cylinderZ, merge, transform } from '../../../../cockpit/geometry/primitives';
import { M2_FUSELAGE } from '../../exterior';
import { M2 } from '../../vars';
import type { M2CockpitContext } from '../index';
import { headlinerZ, LINING_INSET } from '../side/interior';
import { M2_SIDE_VARS } from '../side/services';
import { buildCompass } from './compass';
import { M2MaskStowage } from './mask';

/** Headliner fittings (body x / |y|), EST. Reading lights at the map-light spots of cockpit/index.ts. */
export const OVERHEAD = {
  readingLight: { x: 2.95, y: 0.42 },
  gasper: { x: 2.95, y: 0.31 },
  mask: { x: 2.76, y: 0.3 },
  flood: { x: 2.92, y: 0, target: [3.25, 0, 0.2] as [number, number, number], candela: 3 },
  /** Compass centre (body x / z): on the glareshield top at the post base (fit.ts hood surface z -0.294 at x 3.71). */
  compass: { x: 3.71, z: -0.317 },
  /** Eye reference ball (body x / z), directly above the compass on the post. */
  eyeRef: { x: 3.62, z: -0.388 },
};

const HEADLINER_GREY = '#8f8a80';

export default function buildOverhead(b: CockpitBuilder, c: M2CockpitContext): void {
  const env = b.env;
  const mats = env.materials;
  const trim = mats.custom('plastic', HEADLINER_GREY, 0.7);
  const chrome = mats.get('chrome');

  // ---------------------------------------------------------------- compass + eye reference on the centre post
  const postZ = (x: number) => M2_FUSELAGE.topZ(x) + LINING_INSET - 0.014; // centre post frame surface (shell.ts inset - 14 mm)
  buildCompass(b, [OVERHEAD.compass.x, 0, OVERHEAD.compass.z]);
  {
    // Eye position reference: a white ball on a T stalk hanging from the centre post (EST shape).
    const e = OVERHEAD.eyeRef;
    const drop = e.z - postZ(e.x); // body z from the post surface down to the ball
    const g = merge([
      transform(new THREE.SphereGeometry(0.006, 14, 10), 0, 0, 0),
      transform(new THREE.CylinderGeometry(0.0015, 0.0015, Math.max(0.005, drop), 8), 0, drop / 2, 0),
      transform(new THREE.CylinderGeometry(0.0015, 0.0015, 0.03, 8).rotateZ(Math.PI / 2), 0, drop, 0),
    ]);
    b.structureMesh(g, mats.custom('paint', '#f0f0ea', 0.4), [e.x, 0, e.z], undefined, false).name = 'm2.eye_ref';
  }

  // ---------------------------------------------------------------- reading lights, gaspers, floodlight
  const lensGeo = new THREE.CircleGeometry(0.011, 24);
  const bezelGeo = cylinderZ(0.022, 0.02, 0, 0.012, 28);
  const eyeballGeo = new THREE.SphereGeometry(0.015, 20, 12);
  const gasperNozzle = merge([cylinderZ(0.019, 0.017, 0, 0.006, 24), transform(new THREE.SphereGeometry(0.013, 18, 10), 0, 0, 0.004), transform(cylinderZ(0.006, 0.006, 0, 0.018, 16), 0, 0, 0.004)]);
  b.trackGeometry(lensGeo, bezelGeo, eyeballGeo, gasperNozzle);
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'l' : 'r';
    // Reading light: bezel ring + eyeball aimed at the crew member's lap, lens glowing with its dimmer zone.
    const rl = OVERHEAD.readingLight;
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.3, metalness: 0 });
    mats.track(lensMat);
    env.lighting.registerBacklight(lensMat, `map_${side}`, 3);
    lensMat.emissive.set('#fff6e8'); // LED warm white (EST)
    const fx = fixture(b, [rl.x, s * rl.y, headlinerZ(rl.x, rl.y)], s, `m2.reading_light_${side}`);
    fx.add(new THREE.Mesh(bezelGeo, trim), new THREE.Mesh(eyeballGeo, chrome).translateZ(0.006));
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.z = 0.0215;
    fx.add(lens);
    // Reading-light dimmer on the fixture plate (EST), MAP L / MAP R.
    const n = s < 0 ? 1 : 2;
    const dp = b.panel({ name: `m2.ovhd.map_dim${n}`, center_m: [rl.x - 0.045, s * rl.y, headlinerZ(rl.x - 0.045, rl.y) + 0.003], normal: [0, -s * 0.35, 0.94], up: [-1, 0, 0], width: 0.03, height: 0.03, material: trim, radius: 0.006, screws: false });
    dp.add(
      new RotaryKnob(env, {
        id: `m2.map_lt${n}`,
        label: `MAP ${n === 1 ? 'L' : 'R'} LIGHT`,
        cap: 'dimmer',
        diameter: 0.012,
        outer: { var: M2.mapLt(n), min: 0, max: 1, step: 0.05, angleRange: [-140, 140], format: (x) => (x <= 0.001 ? 'OFF' : `${Math.round(x * 100)} %`) },
      }),
      0,
      0.002,
    );
    dp.label('MAP', 0, -0.011, { height: 0.0026 });
    // Gasper (ventilation air outlet): chrome eyeball nozzle.
    const gp = OVERHEAD.gasper;
    fixture(b, [gp.x, s * gp.y, headlinerZ(gp.x, gp.y)], s, `m2.gasper_${side}`).add(new THREE.Mesh(gasperNozzle, chrome));
  }
  {
    const f = OVERHEAD.flood;
    const pos: [number, number, number] = [f.x, 0, headlinerZ(f.x, 0.001)];
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.35 });
    mats.track(lensMat);
    env.lighting.registerBacklight(lensMat, 'flood', 2.5);
    const fx = fixture(b, pos, 1, 'm2.overhead_flood');
    const hous = new THREE.BoxGeometry(0.07, 0.03, 0.012).translate(0, 0, 0.006);
    const lg = new THREE.PlaneGeometry(0.055, 0.018);
    b.trackGeometry(hous, lg);
    fx.add(new THREE.Mesh(hous, trim));
    const lens = new THREE.Mesh(lg, lensMat);
    lens.position.z = 0.0125;
    fx.add(lens);
    // Half-angle 40 deg: the cone stays below the headliner (which slopes down toward the windshield).
    env.lighting.addFloodLight('m2.flood.ovhd', 'flood', [pos[0], 0, pos[2] + 0.03], f.target, b.root, f.candela, 40);
  }

  // ---------------------------------------------------------------- crew oxygen masks (above each shoulder)
  for (const n of [1, 2] as const) {
    const s = n === 1 ? -1 : 1;
    const who = n === 1 ? 'PILOT' : 'COPILOT';
    const m = OVERHEAD.mask;
    const z = headlinerZ(m.x, m.y) + 0.004;
    // Plate on the headliner, facing down and slightly inboard; label tops toward the tail (read looking up and aft).
    const p = b.panel({
      name: `m2.ovhd.mask${n}`,
      center_m: [m.x, s * m.y, z],
      normal: [0, -s * 0.3, 0.954],
      up: [-1, 0, 0],
      width: 0.23,
      height: 0.15,
      material: trim,
      radius: 0.01,
      screws: false,
    });
    // Mask container on the outboard half of the plate (panel +u is toward the aircraft's left for a down-facing plate).
    const ub = 0.055 * s; // outboard
    p.add(new M2MaskStowage(env, { id: `m2.ovhd.mask${n}`, label: `${who} O2 MASK`, var: M2.maskOn(n), toward: s > 0 ? 1 : -1 }), ub, 0.0);
    p.label(`${who} OXYGEN`, ub, 0.064, { height: 0.0045 });
    // Regulator selector N / 100% / EMER (OxygenSystem crew mask mode; EST legends, EROS-class regulator).
    const uc = -0.06 * s; // inboard column
    p.add(
      new SelectorKnob(env, {
        id: `m2.ovhd.mask${n}_mode`,
        label: `${who} O2 REGULATOR`,
        var: M2.maskMode(n),
        positions: [
          { value: 0, label: 'N', angle: -45 },
          { value: 1, label: '100%', angle: 0 },
          { value: 2, label: 'EMER', angle: 45 },
        ],
        diameter: 0.016,
        labelRadius: 0.021,
        labelHeight: 0.0034,
        cap: 'bar',
      }),
      uc,
      0.022,
    );
    p.add(new PushButton(env, { id: `m2.ovhd.mask${n}_test`, label: `${who} O2 PRESS TO TEST`, var: M2_SIDE_VARS.maskTest(n), mode: 'momentary', style: 'round', width: 0.011 }), uc - 0.02, -0.035);
    p.label('PRESS TO TEST', uc - 0.02, -0.053, { height: 0.0028 });
    p.add(
      new AnnunciatorLight(env, {
        id: `m2.ovhd.mask${n}_flow`,
        label: `${who} O2 FLOW INDICATOR`,
        width: 0.013,
        height: 0.009,
        segments: [{ text: 'FLOW', color: 'amber', var: `oxy.crew${n}_flowing`, style: 'field' }],
      }),
      uc + 0.02,
      -0.035,
    );
    p.label('FLOW', uc + 0.02, -0.053, { height: 0.0028 });
  }
  void c;
}

/**
 * A group sitting on the headliner at `pos` (body), its local +z pointing out of the lining into the cabin
 * (down, tipped inboard with the headliner curvature for side fittings).
 */
function fixture(b: CockpitBuilder, pos: [number, number, number], s: number, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.copy(bl(...pos));
  // Local +z -> body down (+z_body = local -y), tipped inboard by ~20 deg for side fittings.
  const inboard = Math.abs(pos[1]) > 0.05 ? 0.35 : 0;
  const n = bl(0, -s * inboard, 1).normalize();
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  g.userData.m2Fixture = true;
  b.addStructure(g, undefined, { occluder: false });
  return g;
}
