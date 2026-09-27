/**
 * Citation M2 overhead area (loaded by cockpit/index.ts through
 * import.meta.glob; contract `M2CockpitPart` in cockpit/index.ts).
 *
 * The M2 has no overhead switch panel: every system switch is on the
 * instrument / tilt panels, the glareshield and the pedestal (S&D15 §10.2).
 * What the S&D places in the cockpit ceiling area (S&D15 §10.4
 * "Miscellaneous cockpit equipment" and §11.1) is built here:
 *   - "Magnetic Compass" on the windshield centre post (compass.ts);
 *   - "Eye Position Reference Indicator" (ball on the centre post);
 *   - "Two Reading Lights" (L / R, headliner above each seat): the fixtures
 *     around the map-light spots of cockpit/index.ts, lens lit by the
 *     MAP L / MAP R dimmers on the RH tilt panel (`ac.light.map_l/_r`);
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
import { AnnunciatorLight, PushButton, SelectorKnob } from '../../../../cockpit/controls';
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
  compassX: 3.33,
  eyeRefX: 3.5,
};

const HEADLINER_GREY = '#8f8a80';

export default function buildOverhead(b: CockpitBuilder, c: M2CockpitContext): void {
  const env = b.env;
  const mats = env.materials;
  const trim = mats.custom('plastic', HEADLINER_GREY, 0.7);
  const chrome = mats.get('chrome');

  // ---------------------------------------------------------------- compass + eye reference on the centre post
  const postZ = (x: number) => M2_FUSELAGE.topZ(x) + LINING_INSET - 0.012; // centre post frame surface (shell.ts inset - 12 mm)
  buildCompass(b, [OVERHEAD.compassX, 0, postZ(OVERHEAD.compassX) + 0.072]);
  {
    // Eye position reference: a white ball on a short stalk under the centre post (EST shape).
    const g = merge([transform(new THREE.SphereGeometry(0.006, 14, 10), 0, -0.022, 0), transform(new THREE.CylinderGeometry(0.0015, 0.0015, 0.02, 8), 0, -0.01, 0)]);
    b.structureMesh(g, mats.custom('paint', '#f0f0ea', 0.4), [OVERHEAD.eyeRefX, 0, postZ(OVERHEAD.eyeRefX)], undefined, false).name = 'm2.eye_ref';
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
