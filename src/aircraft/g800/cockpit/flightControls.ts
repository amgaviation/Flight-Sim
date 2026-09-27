/**
 * G800 primary flight controls in the cockpit (dossier §9.3, §9.8):
 *
 *  - BAE Systems active control sidesticks on the forward part of each side console, electronically
 *    cross-coupled and back-driven by the autopilot (BJT500; SC 2024-01741). Tilted inboard
 *    ~22 deg (BJT500: "tilted inboard 20 to 25 degrees" and "toed outboard about three degrees").
 *    Animated from input.pitch / input.roll, or from the AP servo commands (ap.servo_pitch /
 *    ap.servo_roll, stick equivalents) while the AP is engaged, so both sticks move together.
 *    Grip switches: red AP DISC / TRIM SYNC on the inboard (thumb) side (UltimateJet G500 flight
 *    test: "the red inboard button"; event ap.disc + hold var for the FBW trim-speed sync),
 *    pitch trim "coolie hat" on top (ac.g800.ss_trim{s}: +1 nose up = slower FBW trim speed),
 *    HUD / EVS rocker on the outboard side (FSB App. 4; ac.g800.hud_rocker{s}).
 *    PTT trigger on the front of the grip (ac.g800.ptt{s}, momentary) keys the MIC-selected
 *    transmitter (systems/audio.ts). SCOPE: no force feel.
 *  - NOSEWHEEL STEERING guarded switch on the left pod aft of the stick (BJT500: "pedal steering
 *    switchlight and tiller are in the normal place on the left side ledge, aft of the sidestick").
 *  - Hanging rudder pedals with toe brakes (brake-by-wire) at each station.
 */
import { GuardedSwitch, RudderPedals, Sidestick } from '../../../cockpit/controls';
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
            anchor: 'thumb',
            kind: 'button',
            options: { id: `g800.fc.ap_disc_${lc}`, label: `AP DISC / TRIM SYNC (${s})`, var: V.ssDisc(n), mode: 'momentary', event: 'ap.disc', style: 'small', width: 0.011, capMaterial: 'knobRed' },
          },
          {
            anchor: 'top',
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
    pod.label(side < 0 ? 'PILOT' : 'COPILOT', 0, -podLen / 2 + 0.014, { height: 0.0024 });
    if (side < 0) {
      pod.add(
        new GuardedSwitch(env, {
          id: 'g800.fc.nws',
          var: V.nwsSw,
          label: 'NOSEWHEEL STEERING',
          positions: ['OFF', 'ON'],
          values: [0, 1],
          initial: 1,
          labels: { name: 'NOSEWHEEL STEER', positions: true, height: 0.0021 },
          scale: 0.8,
          guard: { color: 'red', guardedPosition: 1, hinge: 'top' },
        }),
        0.055,
        -podLen / 2 + 0.06,
      );
    }
    b.place(
      new RudderPedals(env, { id: `g800.fc.pedals_${lc}`, label: side < 0 ? 'PILOT RUDDER PEDALS' : 'COPILOT RUDDER PEDALS', style: 'hanging', spacing: 0.3 }),
      { center_m: side < 0 ? PEDALS_L : PEDALS_R, facing: 'aft' },
    );
  }
}
