/**
 * G800 side consoles and the observer station (mount contract in ../context.ts).
 *
 * Outboard consoles, aft of the sidestick pods built by the main cockpit (layout.ts STICK_POD):
 *  - left : nosewheel steering TILLER (FSB GVIII-G700 §9.4 b: tiller on the left side only;
 *           BJT500: "the pedal steering switchlight and tiller are in the normal place on the left
 *           side ledge, aft of the sidestick"), crew oxygen mask stowage box with the mask
 *           regulator selector (NORM / 100 % / EMER) and the mask flow indicator;
 *  - right: copilot oxygen mask box, regulator and flow indicator.
 *  The NOSEWHEEL STEERING switch, PEDAL STEER switchlight and the CCDs are built by the main cockpit.
 *
 * Observer station on the right aft bulkhead behind the copilot (G500 BL7C0670 photograph c_right; BJT500
 * "the jumpseater has a dedicated touchscreen controller"): EROS-type mask stowage (`ac.g800.oxy_mask3`, observer
 * crew station of the oxygen system) with its regulator, and the COMM JACKS panel (headset / mic receptacles:
 * connectors, not controls). SCOPE: the fifth (jump-seat) TSC is a blank housing - the Epic suite models four TSCs.
 *
 * Circuit breakers: on the aft overhead (cockpit/overhead/breakers.ts) and the TSC ECB page (fix round 1).
 *
 * Not fitted / not built (see docs/aircraft/g800.md §10.2): windshield wipers (PPG "Surface Seal" coating, G650 /
 * G500 / G600 flight-deck windows), hardware audio control panels (Symmetry audio is on the TSC RADIOS app).
 *
 * Positions EST from G500/G600/G700 flight-deck photographs.
 */
import * as THREE from 'three';
import { AnnunciatorLight, SelectorKnob } from '../../../../cockpit/controls';
import { trimBoxGeometry } from '../../../../cockpit/geometry/structure';
import { G800_LIMITS } from '../../data';
import { G800_VARS as V } from '../../vars';
import type { G800CockpitContext } from '../context';
import { MOUNTS } from '../layout';
import { MaskStowage, Tiller } from './controls';

/** Observer station panel on the right aft bulkhead (body centre, EST behind the copilot seat). */
const OBS = { x: 11.62, y: 0.86, z: -0.12, w: 0.22, h: 0.3 };

export function buildSideConsoles(c: G800CockpitContext): void {
  const { b, env } = c;

  // =============================================================== outboard consoles
  for (const side of [1, 2] as const) {
    const m = side === 1 ? MOUNTS.sideLeft : MOUNTS.sideRight;
    const s = side === 1 ? 'L' : 'R';
    const outb = side === 1 ? -1 : 1; // panel u toward the sidewall
    // The panel face stands 6 mm proud of the console body top built by the main cockpit (CONSOLE.topZ).
    const center_m: [number, number, number] = [m.center_m[0], m.center_m[1], m.center_m[2] - 0.006];
    const con = b.panel({ name: `g800.side_${s.toLowerCase()}`, ...m, center_m, material: 'panelDark', screws: { kind: 'dzus', diameter: 0.006, inset: 0.008 }, radius: 0.01 });
    const maskV = -0.12;
    const maskU = 0.02 * -outb;
    const ctlV = maskV + 0.12;
    con.add(new MaskStowage(env, { id: `g800.side.mask${side}`, label: `${s} CREW O2 MASK`, var: V.oxyMask(side) }), maskU, maskV);
    con.add(
      new SelectorKnob(env, {
        id: `g800.side.oxy_mode${side}`,
        label: `${s} MASK REGULATOR`,
        var: V.oxyMode(side),
        positions: [
          { value: 0, label: 'NORM', angle: -40 },
          { value: 1, label: '100%', angle: 0 },
          { value: 2, label: 'EMER', angle: 40 },
        ],
        initial: 0,
        diameter: 0.016,
        labelHeight: 0.0028,
        title: 'O2 MASK',
      }),
      maskU + outb * 0.03,
      ctlV,
    );
    const who = side === 1 ? 'pilot' : 'copilot';
    con.add(
      new AnnunciatorLight(env, {
        id: `g800.side.oxy_flow${side}`,
        label: `${s} O2 FLOW`,
        segments: [{ text: 'O2 FLOW', color: 'green', var: `oxy.${who}_flow_lpm`, test: (f) => f > 0.1 }],
        width: 0.024,
        height: 0.013,
      }),
      maskU - outb * 0.035,
      ctlV,
    );
    if (side === 1) {
      con.add(new Tiller(env, { id: 'g800.side.tiller', label: 'NOSEWHEEL TILLER', var: V.tiller, maxDeg: G800_LIMITS.tillerSteerDeg }), 0, 0.14);
      con.label('STEER', 0, 0.075, { height: 0.0034, weight: 700 });
    }
  }

  // =============================================================== observer station (right aft bulkhead)
  const obs = b.panel({ name: 'g800.obs', center_m: [OBS.x, OBS.y, OBS.z], facing: 'left', width: OBS.w, height: OBS.h, material: 'panelDark', screws: { kind: 'dzus', diameter: 0.006, inset: 0.008 }, radius: 0.01 });
  // Jump-seat TSC housing (SCOPE: blank screen, the suite models TSC 1-4 only).
  const tscBox = new THREE.Mesh(trimBoxGeometry(0.12, 0.17, 0.02, 0.006), env.materials.get('bezelGloss'));
  b.trackGeometry(tscBox.geometry);
  obs.addObject(tscBox, 0, 0.055, { z: 0.01 });
  const blank = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.14), env.materials.get('lcdOff'));
  b.trackGeometry(blank.geometry);
  obs.addObject(blank, 0, 0.055, { z: 0.0205 });
  // Observer O2 mask box and regulator.
  obs.add(new MaskStowage(env, { id: 'g800.side.mask3', label: 'OBSERVER O2 MASK', var: V.obsMask, size: [0.09, 0.1, 0.045] }), -0.05, -0.095);
  obs.add(
    new SelectorKnob(env, {
      id: 'g800.side.oxy_mode3',
      label: 'OBSERVER MASK REGULATOR',
      var: V.obsMaskMode,
      positions: [
        { value: 0, label: 'NORM', angle: -40 },
        { value: 1, label: '100%', angle: 0 },
        { value: 2, label: 'EMER', angle: 40 },
      ],
      initial: 0,
      diameter: 0.014,
      labelHeight: 0.0024,
      title: 'O2',
    }),
    0.06,
    -0.075,
  );
  // COMM JACKS (headset / mic receptacles).
  obs.label('COMM JACKS', 0.06, -0.108, { height: 0.0024, weight: 700 });
  const jack = env.geometry.get('g800.jack', () => new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 16).rotateX(Math.PI / 2).translate(0, 0, 0.003));
  for (const [dx, name] of [
    [-0.012, 'HEADSET'],
    [0.012, 'MIC'],
  ] as const) {
    const j = new THREE.Mesh(jack, env.materials.get('chrome'));
    j.userData.cockpitStatic = true;
    obs.addObject(j, 0.06 + dx, -0.125);
    obs.label(name, 0.06 + dx, -0.137, { height: 0.0017, weight: 700 });
  }
}
