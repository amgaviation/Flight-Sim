/**
 * Cessna 172S "Skyhawk SP" control wheel (the post-1996 restart yoke, identical on the steam and
 * G1000 airplanes): a tall central hub with the leather pad and the oval Skyhawk SP emblem, a
 * flat lower bar and two upright grips canted slightly outboard, each topped by a squared pod.
 * On the steam NAV II airplane the pilot's left pod carries the KAP 140 switches (Supplement 15
 * Fig 2 items 12 and 13: A/P DISC / TRIM INT and the split manual electric trim switch) and the
 * microphone button; the copilot's the microphone button; the map light and its rheostat are on
 * the lower surface of the pilot's wheel (POH Sec 7 "Interior lighting").
 *
 * Same shape and dimensions as the c172-g1000 module's wheel (kept as a copy so the two aircraft
 * modules stay independent; EST from photographs, overall width ~0.39 m across the grips, hub
 * 0.09 x 0.17 m, grips ~0.20 m tall above the bar).
 */
import * as THREE from 'three';
import type { CockpitEnv } from '../../../cockpit/env';
import { Yoke, type YokeOptions } from '../../../cockpit/controls';
import { extrude, hitBox, merge, roundedBox, tube, transform } from '../../../cockpit/geometry/primitives';
import type { YokeAnchorName } from '../../../cockpit/geometry/yokes';

const GRIP_X = 0.168;
const BAR_Y = -0.062;
const POD_Y = 0.118;

function skyhawkWheelParts(): { frame: THREE.BufferGeometry; grips: THREE.BufferGeometry; hub: THREE.BufferGeometry; pad: THREE.BufferGeometry; emblem: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  // Lower bar + upright grips: one tube per side from the hub, along the bottom, up into the grip.
  const sideParts: THREE.BufferGeometry[] = [];
  const gripParts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const bar = tube(
      [
        new THREE.Vector3(s * 0.03, BAR_Y + 0.004, -0.004),
        new THREE.Vector3(s * 0.09, BAR_Y - 0.002, 0),
        new THREE.Vector3(s * 0.14, BAR_Y, 0),
        new THREE.Vector3(s * (GRIP_X - 0.004), BAR_Y + 0.04, 0.002),
      ],
      0.017,
      32,
      14,
    );
    bar.scale(1, 1.25, 0.9); // flattened oval section (taller than deep)
    sideParts.push(bar);
    const grip = tube(
      [
        new THREE.Vector3(s * (GRIP_X - 0.006), BAR_Y + 0.03, 0.002),
        new THREE.Vector3(s * GRIP_X, 0.02, 0.004),
        new THREE.Vector3(s * (GRIP_X + 0.006), POD_Y - 0.03, 0.002),
      ],
      0.0175,
      24,
      14,
    );
    gripParts.push(grip);
    // Squared pod on top of each grip (switch housing on the pilot's left grip).
    const pod = roundedBox(0.046, 0.05, 0.05, 0.009, 3);
    transform(pod, s * (GRIP_X + 0.007), POD_Y, 0.003, 0.35, 0, 0);
    sideParts.push(pod);
  }
  const frame = merge(sideParts);
  const grips = merge(gripParts);
  for (const g of [...sideParts, ...gripParts]) g.dispose();
  // Hub: tapered shield (narrower at the top), extruded toward the pilot.
  const sh = new THREE.Shape();
  const top = 0.078;
  const bot = -0.088;
  sh.moveTo(-0.043, top - 0.01);
  sh.quadraticCurveTo(-0.043, top, -0.033, top);
  sh.lineTo(0.033, top);
  sh.quadraticCurveTo(0.043, top, 0.043, top - 0.01);
  sh.lineTo(0.052, bot + 0.014);
  sh.quadraticCurveTo(0.052, bot, 0.038, bot);
  sh.lineTo(-0.038, bot);
  sh.quadraticCurveTo(-0.052, bot, -0.052, bot + 0.014);
  sh.closePath();
  const hub = extrude(sh, { depth: 0.042, bevel: 0.006, bevelSegments: 3, curveSegments: 8 });
  hub.translate(0, 0, -0.024);
  // Leather pad (slightly proud of the hub face) and the emblem.
  const ps = new THREE.Shape();
  ps.moveTo(-0.036, 0.07);
  ps.lineTo(0.036, 0.07);
  ps.lineTo(0.043, -0.08);
  ps.lineTo(-0.043, -0.08);
  ps.closePath();
  const pad = extrude(ps, { depth: 0.006, bevel: 0.0025, bevelSegments: 2 });
  pad.translate(0, 0, 0.016);
  const emblem = new THREE.CylinderGeometry(0.026, 0.026, 0.004, 40);
  emblem.rotateX(Math.PI / 2);
  emblem.scale(1, 0.62, 1);
  emblem.translate(0, -0.052, 0.024);
  const rim = new THREE.TorusGeometry(0.027, 0.0022, 8, 40);
  rim.scale(1, 0.64, 1);
  rim.translate(0, -0.052, 0.025);
  return { frame, grips, hub, pad, emblem, rim };
}

/** Anchor frames (position, outward normal, up) on the Skyhawk wheel. */
const ANCHORS: Partial<Record<YokeAnchorName, { p: [number, number, number]; n: [number, number, number]; up: [number, number, number] }>> = {
  // Pod top face (tilted toward the pilot): MET and A/P TRIM DISC (photograph "Cessna 172SP G1000 02.jpg").
  leftTop: { p: [-(GRIP_X + 0.007), POD_Y + 0.023, 0.011], n: [0, 0.94, 0.34], up: [0, 0.34, -0.94] },
  rightTop: { p: [GRIP_X + 0.007, POD_Y + 0.023, 0.011], n: [0, 0.94, 0.34], up: [0, 0.34, -0.94] },
  // Pod face toward the pilot: CWS / microphone button.
  leftBack: { p: [-(GRIP_X + 0.007), POD_Y + 0.004, 0.03], n: [0, 0, 1], up: [0, 1, 0] },
  rightBack: { p: [GRIP_X + 0.007, POD_Y + 0.004, 0.03], n: [0, 0, 1], up: [0, 1, 0] },
  leftOutboard: { p: [-(GRIP_X + 0.031), POD_Y, 0.003], n: [-1, 0, 0], up: [0, 1, 0] },
  rightOutboard: { p: [GRIP_X + 0.031, POD_Y, 0.003], n: [1, 0, 0], up: [0, 1, 0] },
  leftInboard: { p: [-(GRIP_X - 0.017), POD_Y, 0.003], n: [1, 0, 0], up: [0, 1, 0] },
  rightInboard: { p: [GRIP_X - 0.017, POD_Y, 0.003], n: [-1, 0, 0], up: [0, 1, 0] },
  leftFront: { p: [-(GRIP_X + 0.007), POD_Y, -0.024], n: [0, 0, -1], up: [0, 1, 0] },
  rightFront: { p: [GRIP_X + 0.007, POD_Y, -0.024], n: [0, 0, -1], up: [0, 1, 0] },
  // Under the hub: map light and its rheostat.
  hub: { p: [0, -0.094, 0.004], n: [0, -1, 0], up: [0, 0, -1] },
  hubTop: { p: [0, 0.085, 0], n: [0, 1, 0], up: [0, 0, -1] },
};

/**
 * Builds a shared `Yoke` and swaps its wheel for the Skyhawk SP shape (meshes, grip hit boxes,
 * anchors and occluders), before the builder registers it.
 */
export function skyhawkYoke(env: CockpitEnv, o: Omit<YokeOptions, 'style'>): Yoke {
  const y = new Yoke(env, { ...o, style: 'cessna', switches: [] });
  const w = y.wheel;
  // Remove the generic wheel meshes and grip hit boxes.
  for (const c of [...w.children]) {
    if ((c as THREE.Mesh).isMesh) {
      w.remove(c);
      const oi = y.occluders.indexOf(c);
      if (oi >= 0) y.occluders.splice(oi, 1);
      const hi = y.hitTargets.indexOf(c);
      if (hi >= 0) y.hitTargets.splice(hi, 1);
      if (c.userData.hitBox) (c as THREE.Mesh).geometry.dispose(); // generic grip boxes (uncached)
    }
  }
  // Wheel geometry is built once per cockpit and shared by both wheels (geometry cache).
  let p: ReturnType<typeof skyhawkWheelParts> | null = null;
  const add = (key: 'frame' | 'grips' | 'hub' | 'pad' | 'emblem' | 'rim', mat: THREE.Material, occluder = false): THREE.Mesh => {
    const geo = env.geometry.get(`c172s.yoke.${key}`, () => {
      p ??= skyhawkWheelParts();
      return p[key];
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = `yoke_${key}`;
    w.add(m);
    if (occluder) y.occluders.push(m);
    return m;
  };
  const mats = env.materials;
  add('frame', mats.get('yoke'), true);
  add('grips', mats.get('yokeGrip'));
  add('hub', mats.get('yoke'), true);
  add('pad', mats.get('leather'));
  add('emblem', mats.custom('metal', '#9aa1a8', 0.35));
  add('rim', mats.get('chrome'));
  // Grip hit boxes (drag the wheel) behind the grip switches (priority -1).
  const hb = mats.get('hitbox');
  for (const [bw, bh, bd, bx, by, bz] of [
    [0.05, 0.2, 0.055, -GRIP_X, 0.02, 0],
    [0.05, 0.2, 0.055, GRIP_X, 0.02, 0],
    [0.11, 0.18, 0.05, 0, -0.005, 0],
    [0.36, 0.045, 0.045, 0, BAR_Y, 0],
  ] as const) {
    const h = hitBox(hb, bw, bh, bd, bx, by, bz);
    h.userData.hitPriority = -1;
    w.add(h);
    y.hitTargets.push(h);
  }
  // Re-seat the switch anchors on the new shape.
  const z = new THREE.Vector3();
  const up = new THREE.Vector3();
  const x = new THREE.Vector3();
  const m = new THREE.Matrix4();
  for (const [name, a] of Object.entries(ANCHORS) as [YokeAnchorName, NonNullable<(typeof ANCHORS)[YokeAnchorName]>][]) {
    const obj = y.anchors[name];
    obj.position.set(...a.p);
    z.set(...a.n).normalize();
    up.set(...a.up).normalize();
    x.crossVectors(up, z).normalize();
    up.crossVectors(z, x).normalize();
    m.makeBasis(x, up, z);
    obj.quaternion.setFromRotationMatrix(m);
  }
  for (const s of o.switches ?? []) y.addSwitch(s);
  return y;
}
