/**
 * G800 primary flight controls in the cockpit (dossier §9.3, §9.8):
 *
 *  - BAE Systems active control sidesticks on the forward part of each side console, electronically
 *    cross-coupled and back-driven by the autopilot (BJT500; SC 2024-01741). Tilted inboard
 *    ~22 deg (BJT500: "tilted inboard 20 to 25 degrees" and "toed outboard about three degrees").
 *    Animated from input.pitch / input.roll, or from the AP servo commands (ap.servo_pitch /
 *    ap.servo_roll, stick equivalents) while the AP is engaged, so both sticks move together.
 *    Brushed silver grip in a square silver bezel at the forward end of the ledge beside the outboard
 *    TSC, armrest with a TILT ADJ control aft of it (G600 BL7C0704 crop p_stick). Grip switches: red
 *    AP DISC / TRIM SYNC and the black pitch-trim switch on the upper aft face (photo; event ap.disc +
 *    hold var for the FBW trim-speed sync; ac.g800.ss_trim{s}: +1 nose up = slower FBW trim speed),
 *    HUD / EVS rocker on the outboard side (FSB App. 4; ac.g800.hud_rocker{s}).
 *    PTT trigger on the front of the grip (ac.g800.ptt{s}, momentary) keys the MIC-selected
 *    transmitter (systems/audio.ts). SCOPE: no force feel.
 *  - NOSEWHEEL STEERING guarded switch and the PEDAL STEER switchlight on the left pod aft of the stick
 *    (BJT500: "The nosewheel steering system switch (a physical guarded switch) and the pedal steering
 *    switchlight and tiller are ... on the left side ledge, aft of the sidestick").
 *  - Floor-hinged rudder pedals with black grille plates and toe brakes (brake-by-wire) at each station,
 *    and a pedal-adjust crank between them (G600 BL7C0705 crop p_leftlow; SCOPE: the crank writes a
 *    pedal-reach state only).
 */
import * as THREE from 'three';
import { PushButton, RotaryKnob, RudderPedals, Sidestick } from '../../../cockpit/controls';
import { roundedBox } from '../../../cockpit/geometry/primitives';
import { G800_VARS as V } from '../vars';
import type { G800CockpitContext } from './context';
import { PEDALS_L, PEDALS_R, STICK_L, STICK_POD, STICK_R, CONSOLE } from './layout';

export function buildFlightControls(c: G800CockpitContext): void {
  const { b, env } = c;
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R';
    const n = side < 0 ? 1 : 2;
    const lc = s.toLowerCase();
    // Stick pod: the dark module plate around the stick boot (forward end of the console).
    const podLen = STICK_POD.xFwd - STICK_POD.xAft;
    const pod = b.panel({
      name: `g800.fc.pod_${lc}`,
      center_m: [(STICK_POD.xFwd + STICK_POD.xAft) / 2, side * STICK_POD.y, CONSOLE.topZ - 0.003],
      facing: 'up',
      width: STICK_POD.width,
      height: podLen,
      material: 'panelDark',
      screws: { kind: 'hex', diameter: 0.004, inset: 0.008 },
      radius: 0.012,
    });
    b.place(
      new Sidestick(env, {
        id: `g800.fc.stick_${lc}`,
        label: side < 0 ? 'PILOT SIDESTICK' : 'COPILOT SIDESTICK',
        hand: side < 0 ? 'left' : 'right',
        pitchDeg: 16,
        rollDeg: 16,
        backDriveWhenVar: 'ap.engaged',
        backDrivePitchVar: 'ap.servo_pitch',
        backDriveRollVar: 'ap.servo_roll',
        switches: [
          {
            anchor: 'top',
            offset: [0, -0.012, 0],
            kind: 'button',
            options: { id: `g800.fc.ap_disc_${lc}`, label: `AP DISC / TRIM SYNC (${s})`, var: V.ssDisc(n), mode: 'momentary', event: 'ap.disc', style: 'small', width: 0.011, capMaterial: 'knobRed' },
          },
          {
            anchor: 'top',
            offset: [0, 0.006, 0],
            kind: 'rocker',
            options: {
              id: `g800.fc.trim_${lc}`,
              label: `PITCH TRIM (${s})`,
              var: V.ssTrim(n),
              positions: ['NOSE UP', 'OFF', 'NOSE DN'],
              values: [1, 0, -1],
              initial: 1,
              springs: { 0: 1, 2: 1 },
            },
          },
          {
            anchor: 'trigger',
            kind: 'button',
            options: { id: `g800.fc.ptt_${lc}`, label: `PTT / MIC (${s})`, var: V.ptt(n), mode: 'momentary', style: 'small', width: 0.012 },
          },
          {
            anchor: 'side',
            kind: 'rocker',
            options: {
              id: `g800.fc.hud_${lc}`,
              label: `HUD / EVS VIDEO (${s})`,
              var: V.hudRocker(n),
              positions: ['CLEAR', 'OFF', 'CYCLE'],
              values: [-1, 0, 1],
              initial: 1,
              springs: { 0: 1, 2: 1 },
            },
          },
        ],
      }),
      { center_m: side < 0 ? STICK_L : STICK_R, facing: 'aft', rollDeg: side * 22, yawDeg: side * 3 },
    );
    // Brushed-silver finish of the grip / shaft and a square silver bezel around the boot (photo p_stick).
    const stick = c.b.controls.find((x) => x.id === `g800.fc.stick_${lc}`);
    const silver = env.materials.get('aluminium');
    stick?.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name ?? '';
      if (m.material === env.materials.get('yokeGrip') || m.material === env.materials.get('yoke') || name === 'yokeGrip') m.material = silver;
    });
    const bez = new THREE.Mesh(roundedBox(0.105, 0.105, 0.012, 0.012), silver);
    bez.userData.cockpitStatic = true;
    c.b.trackGeometry(bez.geometry);
    pod.addObject(bez, 0, podLen / 2 - (STICK_POD.xFwd - (side < 0 ? STICK_L : STICK_R)[0]), { z: 0.004 });
    // Armrest aft of the stick with its TILT ADJ control (state only, SCOPE).
    const arm = new THREE.Mesh(roundedBox(0.09, 0.2, 0.07, 0.02), env.materials.get('leather'));
    arm.userData.cockpitStatic = true;
    c.b.trackGeometry(arm.geometry);
    pod.addObject(arm, 0, -podLen / 2 + 0.1, { z: 0.035 });
    pod.add(
      new RotaryKnob(env, {
        id: `g800.fc.arm_tilt_${lc}`,
        label: `${s} ARMREST TILT ADJ`,
        outer: { var: V.armTilt(n), min: 0, max: 1, step: 0.1, angleRange: [-90, 90], label: 'TILT ADJ', format: (v) => `${Math.round(v * 100)} %` },
        cap: 'knurled',
        diameter: 0.014,
        pointer: 'line',
      }),
      -side * 0.07,
      -podLen / 2 + 0.05,
    );
    pod.label('TILT ADJ', -side * 0.07, -podLen / 2 + 0.066, { height: 0.0019 });
    if (side < 0) {
      pod.add(
        new PushButton(env, {
          id: 'g800.fc.pedal_steer',
          label: 'PEDAL STEER',
          var: V.pedalSteer,
          mode: 'toggle',
          initial: 1,
          stateNames: ['OFF', 'ON'],
          style: 'korry',
          width: 0.017,
          height: 0.015,
          layout: 'stack',
          segments: [{ text: 'OFF', color: 'amber', var: V.pedalSteer, test: (x) => x === 0 }],
        }),
        0.06,
        -podLen / 2 + 0.13,
      );
      pod.label('PEDAL\nSTEER', 0.06, -podLen / 2 + 0.148, { height: 0.0019 });
      // No NOSEWHEEL STEERING switch on the Symmetry ledge (BJT500: "the pedal steering switchlight and tiller"): steer-by-wire
      // is engaged whenever powered; PEDAL STEER gates only the pedal authority (function fix round 1).
    }
    b.place(
      new RudderPedals(env, { id: `g800.fc.pedals_${lc}`, label: side < 0 ? 'PILOT RUDDER PEDALS' : 'COPILOT RUDDER PEDALS', style: 'floor', spacing: 0.3 }),
      { center_m: side < 0 ? PEDALS_L : PEDALS_R, facing: 'aft' },
    );
    // Pedal-adjust crank between the pedals (SCOPE: writes the pedal-reach state only).
    const ped = side < 0 ? PEDALS_L : PEDALS_R;
    b.place(
      new RotaryKnob(env, {
        id: `g800.fc.pedal_adj_${lc}`,
        label: `${s} PEDAL ADJUST`,
        outer: { var: V.pedalAdj(n), min: 0, max: 1, step: 0.05, angleRange: [-150, 150], label: 'PEDAL ADJ', format: (v) => `${Math.round(v * 100)} %` },
        cap: 'wing',
        diameter: 0.035,
        pointer: 'none',
      }),
      { center_m: [ped[0] + 0.04, ped[1], ped[2] - 0.12], facing: 'aft' },
    );
  }
}
