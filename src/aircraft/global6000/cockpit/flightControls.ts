/**
 * Global 6000 primary flight controls in the cockpit: two control wheels
 * (conventional yokes driving the cable-signalled PCUs, GXFC; AOPA 2012
 * "leather-wrapped yokes"), hanging rudder pedals with toe brakes (brake-by-
 * wire, GXLG), and the pilot's NOSE STEER handwheel (GXLG: +/-75 deg).
 *
 * Control-wheel switches (Global Vision wheel, photo N835GL crops c_lwing /
 * c_rwing; GXAG / GXAF / FSB appendix 6; dossier §12.5):
 *  - MSTR DISC (red, outboard horn top): disconnects the AP (event `ap.disc`)
 *    and, held, interrupts stab trim and the stick pusher (`V.yokeDisc`,
 *    systems/cockpitInputs.ts);
 *  - NOSE DN / NOSE UP pitch trim split switch (top of the outboard horn,
 *    `V.yokeTrim`);
 *  - TCS (touch control steering, front of the outboard horn): AFCS CWS while
 *    held (events `ap.cws` 1 / 0);
 *  - FPV CAGE (inboard horn top, FSB "FPV Cage button on yoke"):
 *    `fusion.s{s}.fpv_cage`;
 *  - R/T / IC rocker on the rear of the outboard horn (`V.yokePtt`, spring to
 *    centre). SCOPE: no radio-transmit / intercom audio model; the keyed state
 *    is `V.pttKeyed` (systems/vision.ts).
 * The hub carries the BOMBARDIER GLOBAL logo with a chrome ring and no
 * chronometer button (photo): the PFD chronometer is not on the wheel.
 *
 * The wheels are animated from the surface positions (surf.elevator /
 * surf.aileron), so the autopilot back-drives them as with the real
 * cable-connected controls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RotaryKnob, RudderPedals, Yoke } from '../../../cockpit/controls';
import { SURF } from '../../../core/vars';
import { G6K_EVENTS, G6K_VARS as V } from '../vars';
import { G6K_LIMITS } from '../data';
import type { G6kCockpitContext } from './context';
import { PEDALS_L, PEDALS_R, TILLER, YOKE_HUB_L, YOKE_HUB_R } from './layout';

export function buildFlightControls(c: G6kCockpitContext): void {
  const { b, env } = c;
  for (const s of [1, 2] as const) {
    const S = s === 1 ? 'L' : 'R';
    const who = s === 1 ? 'PILOT' : 'COPILOT';
    const out = s === 1 ? 'left' : 'right';
    const inb = s === 1 ? 'right' : 'left';
    const yoke = new Yoke(env, {
      id: `g6k.fc.yoke_${S.toLowerCase()}`,
      label: `${who} CONTROL WHEEL`,
      // Sculpted ram's-horn wheel (photo N835GL c_lwing: tall leather-wrapped grips rising from a wide hub),
      // not the M-shaped 'bizjet' wheel of the first pass.
      style: 'ramshorn',
      column: { kind: 'pivot', length: 0.62 },
      pitchVar: SURF.elevator,
      rollVar: SURF.aileron,
      switches: [
        {
          anchor: `${out}Outboard`,
          kind: 'button',
          options: { id: `g6k.fc.ap_disc${s}`, label: `MSTR DISC (${S})`, var: V.yokeDisc(s), mode: 'momentary', event: 'ap.disc', capMaterial: 'knobRed' },
        },
        {
          anchor: `${out}Top`,
          kind: 'rocker',
          options: {
            id: `g6k.fc.trim${s}`,
            label: `PITCH TRIM (${S})`,
            var: V.yokeTrim(s),
            positions: ['NOSE UP', 'OFF', 'NOSE DN'], // wheel legends NOSE DN (forward) / NOSE UP (aft), photo
            values: [1, 0, -1],
            initial: 1,
            springs: { 0: 1, 2: 1 },
          },
        },
        {
          anchor: `${out}Front`,
          kind: 'button',
          options: { id: `g6k.fc.tcs${s}`, label: `TCS (${S})`, mode: 'momentary', event: G6K_EVENTS.tcs, releaseEvent: G6K_EVENTS.tcs, capMaterial: 'plasticBlack' },
        },
        {
          anchor: `${inb}Top`,
          kind: 'button',
          options: { id: `g6k.fc.fpv_cage${s}`, label: `FPV CAGE (${S})`, mode: 'momentary', event: G6K_EVENTS.fpvCage(s), capMaterial: 'knobGrey' },
        },
        {
          anchor: `${out}Back`,
          kind: 'rocker',
          options: {
            id: `g6k.fc.ptt${s}`,
            label: `R/T - IC (${S})`,
            var: V.yokePtt(s),
            positions: ['IC', 'OFF', 'R/T'],
            values: [-1, 0, 1],
            initial: 1,
            springs: { 0: 1, 2: 1 },
          },
        },
      ],
    });
    b.place(yoke, { center_m: s === 1 ? YOKE_HUB_L : YOKE_HUB_R, facing: 'aft' });
    // Wheel dressing (photo N835GL c_lwing): chrome trim ring round the hub face and an embossed oval hub cap
    // (the BOMBARDIER GLOBAL badge reads as an embossed oval; no trademark text) plus a white stitch seam ring
    // at the base of each grip on the leather wrap.
    const ringG = env.geometry.get('g6k.yoke.ring', () => new THREE.TorusGeometry(0.052, 0.0028, 10, 40).scale(1.5, 0.62, 1));
    const ring = new THREE.Mesh(ringG, env.materials.get('chrome'));
    ring.position.set(0, -0.035, 0.0395);
    yoke.wheel.add(ring);
    const capG = env.geometry.get('g6k.yoke.cap', () => new THREE.CylinderGeometry(0.03, 0.032, 0.004, 32).rotateX(Math.PI / 2).scale(1.55, 0.6, 1));
    const cap = new THREE.Mesh(capG, env.materials.get('plasticBlack'));
    cap.position.set(0, -0.035, 0.041);
    yoke.wheel.add(cap);
    const embG = env.geometry.get('g6k.yoke.emb', () => new THREE.TorusGeometry(0.021, 0.0012, 8, 32).scale(1.6, 0.55, 1));
    const emb = new THREE.Mesh(embG, env.materials.get('chrome'));
    emb.position.set(0, -0.035, 0.0435);
    yoke.wheel.add(emb);
    const stitchG = env.geometry.get('g6k.yoke.stitch', () => new THREE.TorusGeometry(0.0185, 0.0007, 6, 24));
    const stitchM = env.materials.custom('plastic', 0xe8e2d4, 0.9);
    for (const sx of [-1, 1]) {
      const st = new THREE.Mesh(stitchG, stitchM);
      st.position.set(sx * 0.154, 0.0, 0);
      st.rotation.x = Math.PI / 2;
      yoke.wheel.add(st);
    }
    b.place(new RudderPedals(env, { id: `g6k.fc.pedals_${S.toLowerCase()}`, label: `${who} RUDDER PEDALS`, style: 'hanging', spacing: 0.3 }), { center_m: s === 1 ? PEDALS_L : PEDALS_R, facing: 'aft' });
  }
  // NOSE STEER tiller (GXLG: +/-75 deg; tiller -1..1 = +/-75 deg via cockpitInputs.ts): a black D-loop crank handle on a
  // round hub set flush into the top of the pilot's side console, forward end (photo EB190582 e_tiller).
  // SCOPE: the tiller stays where it is left (no centring spring modelled).
  const mount = b.panel({ name: 'tiller_mount', center_m: TILLER.center_m, facing: 'up', width: 0.1, height: 0.1, material: 'plasticBlack', screws: false, radius: 0.04, thickness: 0.002 });
  const knob = mount.add(
    new RotaryKnob(env, {
      id: 'g6k.tiller',
      label: 'NOSE STEER TILLER',
      cap: 'smooth',
      material: 'plasticBlack',
      diameter: 0.075,
      height: 0.012,
      pointer: 'none',
      dragPxPerClick: 6,
      outer: { var: V.tiller3d, min: -1, max: 1, step: 0.05, angleRange: [-110, 110], label: 'NOSE STEER', format: (v) => `${Math.round(v * G6K_LIMITS.tillerMaxDeg)}°` },
    }),
    0,
    0,
  );
  // D-loop crank handle on the hub (rotates with it): a flat loop from the hub centre out past the rim (EST 0.11 m).
  const pts = [new THREE.Vector3(0, 0.0, 0.014), new THREE.Vector3(0, 0.02, 0.03), new THREE.Vector3(0.0, 0.1, 0.034)];
  const arm = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([pts[0], pts[1], pts[2]]), 12, 0.006, 8, false);
  const grip = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.022, 0.1, 0.034), new THREE.Vector3(-0.03, 0.075, 0.03), new THREE.Vector3(-0.018, 0.03, 0.02), new THREE.Vector3(0, 0.012, 0.016)]), 12, 0.006, 8, false);
  const bar = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(-0.024, 0.1, 0.034), new THREE.Vector3(0.002, 0.1, 0.034)), 2, 0.0065, 8, false);
  const loop = mergeGeometries([arm, grip, bar], false)!;
  arm.dispose();
  grip.dispose();
  bar.dispose();
  b.trackGeometry(loop);
  knob.outer.group.add(new THREE.Mesh(loop, env.materials.get('plasticBlack')));
  mount.label('NOSE STEER', 0, -0.05, { height: 0.0024, zone: 'panel_l' });
}
