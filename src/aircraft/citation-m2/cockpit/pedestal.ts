/**
 * Citation M2 centre pedestal (S&D15 §10.2.D "Installed on Pedestal"): two
 * GTC 570 touch controllers, engine start control, engine power levers
 * (throttles with IDLE / CRU / CLB / TO detents and the TO/GA button on the
 * LH throttle, S&D15 §8 / §10.3.L), flap control handle (detents 0 / 15 / 35
 * / 60 ground flaps, S&D15 §9.1), speed brake control, elevator trim wheel
 * and indicator, rudder trim control, aileron trim control.
 * Photograph (S&D Figure III): light-grey pedestal, GTCs on a steep forward
 * face under the MFD, throttle quadrant, trim wheel on the left side, small
 * start panel at the aft end. Dimensions EST.
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import type { CockpitDisplay } from '../../../cockpit/types';
import { Lever, PushButton, RotaryKnob, ToggleSwitch, TrimWheel } from '../../../cockpit/controls';
import { extrude } from '../../../cockpit/geometry/primitives';
import { INPUT } from '../../../core/vars';
import { G3K_EVENTS } from '../../../avionics/garmin-g3000/vars';
import type { SimVars } from '../../../core/SimVars';
import { M2, TLA } from '../vars';
import { PITCH_TRIM_TO_BAND } from '../systems/flight';
import { FLOOR_Z, PEDESTAL, downFace } from './layout';
import { NullDisplay } from './panels';
import { MapJoystickKnob } from './controls';
import { GTC_PUSH_VAR } from './logic';

const inc = (e: string) => `${e}_inc`;
const dec = (e: string) => `${e}_dec`;

/** GTC 570 unit face (EST: 5.7 in portrait LCD 87 x 116 mm; knobs below the screen, Garmin PG Figure 1-12). */
const GTC_W = 0.13;
const GTC_H = 0.21;
const GTC_SCREEN: [number, number] = [0.0869, 0.1158];

export function buildPedestal(b: CockpitBuilder, displays: Map<string, CockpitDisplay>): { throttles: Lever[] } {
  const env = b.env;
  const P = PEDESTAL;
  const grey = env.materials.custom('plastic', '#7e8288', 0.55); // EST: light-grey pedestal (photograph)
  const dark = env.materials.get('panel');

  // ------------------------------------------------------------------ pedestal body (structure): side profile extruded across the width
  const [footX] = downFace(P.towerTopX, P.towerTopZ, P.towerTiltDeg, P.towerLen);
  {
    const H = (z: number) => FLOOR_Z - z - 0.004; // height above the floor, 4 mm under the panel faces
    const sh = new THREE.Shape();
    sh.moveTo(P.aftEndX - 0.01, 0);
    sh.lineTo(P.aftEndX - 0.01, H(P.aftTopZ + 0.012));
    sh.lineTo(P.quadrantAftX, H(P.quadrantZ - 0.006));
    sh.lineTo(footX, H(P.quadrantZ));
    sh.lineTo(P.towerTopX, H(P.towerTopZ));
    sh.lineTo(P.towerTopX + 0.03, H(P.towerTopZ));
    sh.lineTo(P.towerTopX + 0.03, 0);
    sh.closePath();
    const W = P.halfWidth * 2 - 0.004;
    const g = extrude(sh, { depth: W, bevel: 0.006, bevelSegments: 2, curveSegments: 4 });
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -W / 2, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
    const m = b.structureMesh(g, grey, [0, 0, FLOOR_Z]);
    m.name = 'pedestal_body';
  }

  // ------------------------------------------------------------------ GTC tower face with two GTC 570
  const [tcx, tcz] = downFace(P.towerTopX, P.towerTopZ, P.towerTiltDeg, P.towerLen / 2);
  const T = b.panel({ name: 'm2.gtc_face', center_m: [tcx, 0, tcz], facing: 'aft', tiltDeg: P.towerTiltDeg, width: P.halfWidth * 2, height: P.towerLen, origin: 'top-left', screws: false, material: dark });
  for (const [gtc, gx] of [
    ['gtc1', P.halfWidth - 0.069],
    ['gtc2', P.halfWidth + 0.069],
  ] as const) {
    const u = T.subPanel({ name: `m2.${gtc}`, x: gx, y: P.towerLen / 2, width: GTC_W, height: GTC_H, origin: 'top-left', material: 'bezel', screws: false, z: 0.004 });
    u.display(displays.get(gtc) ?? new NullDisplay(gtc), GTC_W / 2, 0.012 + GTC_SCREEN[1] / 2, GTC_SCREEN[0], GTC_SCREEN[1], { bezel: false, z: 0.0015, display: { boot: false } });
    u.label('GARMIN', GTC_W / 2, 0.006, { height: 0.0024, color: '#b8bcc2', zone: null });
    const ky = 0.165;
    // Map knob with joystick (range / pointer / pan).
    u.add(
      new MapJoystickKnob(env, {
        id: `m2.${gtc}.map`,
        label: `${gtc.toUpperCase()} MAP KNOB / JOYSTICK`,
        incEvent: inc(G3K_EVENTS.gtcLower(gtc)),
        decEvent: dec(G3K_EVENTS.gtcLower(gtc)),
        pushEvent: G3K_EVENTS.gtcLowerPush(gtc),
        joystickEvent: G3K_EVENTS.gtcJoystick(gtc),
        diameter: 0.016,
      }),
      0.024,
      ky,
    );
    // Centre knob (volume / checklist), push squelch / check.
    u.add(
      new RotaryKnob(env, {
        id: `m2.${gtc}.center`,
        label: `${gtc.toUpperCase()} CENTER KNOB`,
        cap: 'fluted',
        diameter: 0.014,
        outer: { incEvent: inc(G3K_EVENTS.gtcCenter(gtc)), decEvent: dec(G3K_EVENTS.gtcCenter(gtc)), label: 'CENTER' },
        push: { event: G3K_EVENTS.gtcCenterPush(gtc), label: 'PUSH' },
      }),
      GTC_W / 2,
      ky + 0.01,
    );
    // Dual concentric upper knob; push vs push-and-hold decided by GtcKnobPushLogic.
    u.add(
      new RotaryKnob(env, {
        id: `m2.${gtc}.upper`,
        label: `${gtc.toUpperCase()} DUAL KNOB`,
        cap: 'ring',
        innerCap: 'fluted',
        diameter: 0.022,
        outer: { incEvent: inc(G3K_EVENTS.gtcUpperOuter(gtc)), decEvent: dec(G3K_EVENTS.gtcUpperOuter(gtc)), label: 'OUTER' },
        inner: { incEvent: inc(G3K_EVENTS.gtcUpperInner(gtc)), decEvent: dec(G3K_EVENTS.gtcUpperInner(gtc)), label: 'INNER' },
        push: { var: GTC_PUSH_VAR(gtc), mode: 'momentary', label: 'PUSH / HOLD SWAP' },
      }),
      GTC_W - 0.026,
      ky,
    );
  }

  // ------------------------------------------------------------------ throttle quadrant
  const qLen = footX - P.quadrantAftX;
  const Q = b.panel({ name: 'm2.quadrant', center_m: [(footX + P.quadrantAftX) / 2, 0, P.quadrantZ - 0.002], facing: 'up', tiltDeg: -2, width: P.halfWidth * 2, height: qLen, origin: 'center', screws: { kind: 'phillips', pitch: 0.2 }, material: dark });
  const tlDetents = [
    { value: TLA.cutoff, label: 'CUTOFF' },
    { value: TLA.idle, label: 'IDLE', kind: 'gate' as const, direction: 'decreasing' as const },
    { value: TLA.cru, label: 'CRU' },
    { value: TLA.clb, label: 'CLB' },
    { value: TLA.to, label: 'TO' },
  ];
  // Control lock holds the throttles at IDLE / CUTOFF (S&D15 §9.1).
  const locked: [number, number] = [TLA.cutoff, TLA.idle];
  const free: [number, number] = [TLA.cutoff, TLA.to];
  const lockLimit = (v: SimVars): [number, number] => (v.get(M2.controlLock) !== 0 ? locked : free);
  const throttles: Lever[] = [];
  for (const i of [1, 2] as const) {
    const lev = new Lever(env, {
      id: `m2.tla${i}`,
      var: M2.tla(i),
      label: `${i === 1 ? 'L' : 'R'} THROTTLE`,
      min: TLA.cutoff,
      max: TLA.to,
      initial: TLA.cutoff,
      detents: tlDetents,
      travel: { kind: 'arc', minDeg: -34, maxDeg: 30, pivotDepth: 0.06 },
      armLength: 0.115,
      knob: 'throttle',
      knobScale: 0.95,
      detentLabels: i === 1 ? 'left' : false,
      axis: { var: INPUT.throttle(i), map: (a) => Math.max(0, Math.min(1, a)) },
      limit: lockLimit,
      format: (v) => (v < -0.05 ? 'CUTOFF' : `${Math.round(v * 100)} %`),
    });
    Q.add(lev, i === 1 ? -0.024 : 0.024, 0.02);
    throttles.push(lev);
  }
  // TO/GA button on the outboard side of the LH throttle knob (S&D15 §10.3.L).
  {
    const arm = throttles[0].object.children[0]?.children[0];
    const toga = new PushButton(env, { id: 'm2.toga', label: 'TO/GA', style: 'small', width: 0.008, mode: 'momentary', event: 'ap.toga', capMaterial: 'knobGrey' });
    toga.object.position.set(-0.021, 0, 0.122);
    toga.object.rotation.y = -Math.PI / 2;
    (arm ?? throttles[0].object).add(toga.object);
    throttles[0].object.userData.cockpitDynamic = true;
    b.add(toga);
  }
  // Flap handle (RH side): detents UP / 15 (T.O. & APPR) / 35 (LAND) / 60 GND; gate before 60 (EST).
  Q.add(
    new Lever(env, {
      id: 'm2.flaps',
      var: M2.flapHandle,
      label: 'FLAPS',
      min: 0,
      max: 3,
      discrete: true,
      detents: [
        { value: 0, label: 'UP' },
        { value: 1, label: '15 T.O.&APPR' },
        { value: 2, label: '35 LAND' },
        { value: 3, label: '60 GND', kind: 'gate' },
      ],
      travel: { kind: 'arc', minDeg: 28, maxDeg: -28, pivotDepth: 0.05 },
      armLength: 0.09,
      knob: 'flap',
      detentLabels: 'right',
      format: (v) => ['UP', '15', '35', '60 GND'][Math.round(v)] ?? v.toFixed(0),
    }),
    0.09,
    -0.02,
  );
  // Speed brake handle (LH side): RETRACT / EXTEND.
  Q.add(
    new Lever(env, {
      id: 'm2.speedbrake',
      var: M2.speedbrake,
      label: 'SPEED BRAKE',
      min: 0,
      max: 1,
      discrete: true,
      detents: [
        { value: 0, label: 'RETRACT' },
        { value: 1, label: 'EXTEND' },
      ],
      travel: { kind: 'arc', minDeg: 22, maxDeg: -22, pivotDepth: 0.04 },
      armLength: 0.07,
      knob: 'speedbrake',
      detentLabels: 'left',
      format: (v) => (v >= 0.5 ? 'EXTEND' : 'RETRACT'),
    }),
    -0.09,
    -0.02,
  );
  // Elevator trim wheel with indicator (LH side of the quadrant). EST: ~5 wheel turns for full travel.
  Q.add(
    new TrimWheel(env, {
      id: 'm2.pitch_trim',
      var: M2.pitchTrim,
      label: 'ELEVATOR TRIM',
      min: -1,
      max: 1,
      perRev: 0.4,
      diameter: 0.2,
      thickness: 0.024,
      exposure: 0.35,
      spokes: 6,
      stripes: true,
      indicator: {
        length: 0.07,
        offset: [0.03, -0.02, 0],
        marks: [
          { value: 1, label: 'NU' },
          { value: 0.3, label: 'T.O.' },
          { value: -1, label: 'ND' },
        ],
        band: PITCH_TRIM_TO_BAND,
      },
    }),
    -P.halfWidth + 0.008,
    -0.02,
  );

  // ------------------------------------------------------------------ aft console: engine start, ignition, rudder / aileron trim
  const aftLen = P.quadrantAftX - P.aftEndX;
  const A = b.panel({ name: 'm2.ped_aft', center_m: [(P.quadrantAftX + P.aftEndX) / 2, 0, (P.aftTopZ + P.quadrantZ) / 2], facing: 'up', tiltDeg: -12, width: P.halfWidth * 2, height: aftLen, origin: 'top-left', screws: { kind: 'phillips', pitch: 0.25 }, material: dark });
  A.label('ENGINE START', 0.15, 0.012, { height: 0.0026 });
  const startBtn = (i: 1 | 2) =>
    new PushButton(env, {
      id: `m2.start${i}`,
      var: M2.startBtn(i),
      label: `${i === 1 ? 'L' : 'R'} ENGINE START`,
      style: 'korry',
      width: 0.02,
      height: 0.016,
      mode: 'momentary',
      segments: [{ text: [i === 1 ? 'L' : 'R', 'START'], color: 'white', var: M2.startLight(i) }],
    });
  A.add(startBtn(1), 0.1, 0.038);
  A.add(new PushButton(env, { id: 'm2.start_diseng', var: M2.startDiseng, label: 'START DISENGAGE', style: 'korry', width: 0.02, height: 0.016, mode: 'momentary', engraved: 'DISENG', engravedHeight: 0.0024 }), 0.15, 0.038);
  A.add(startBtn(2), 0.2, 0.038);
  A.label('IGNITION', 0.15, 0.064, { height: 0.0024 });
  for (const i of [1, 2] as const) {
    A.add(new ToggleSwitch(env, { id: `m2.ign${i}`, var: M2.ignSw(i), label: `${i === 1 ? 'L' : 'R'} IGNITION`, positions: ['NORM', 'ON'], scale: 0.85, labels: { name: i === 1 ? 'L' : 'R', positions: true, height: 0.0021 } }), i === 1 ? 0.12 : 0.18, 0.09);
  }
  // Rudder trim knob (centre aft) and aileron trim knob (EST: CJ-family pedestal trim knobs).
  A.add(
    new RotaryKnob(env, {
      id: 'm2.rud_trim',
      label: 'RUDDER TRIM',
      cap: 'wing',
      diameter: 0.03,
      outer: { var: M2.rudderTrim, min: -1, max: 1, step: 0.02, initial: 0, angleRange: [-120, 120], format: (v) => (Math.abs(v) < 0.01 ? 'NEUTRAL' : `${v < 0 ? 'NL' : 'NR'} ${Math.round(Math.abs(v) * 100)} %`) },
    }),
    0.15,
    0.15,
  );
  A.label('NL  RUDDER TRIM  NR', 0.15, 0.125, { height: 0.0022 });
  A.add(
    new RotaryKnob(env, {
      id: 'm2.ail_trim',
      label: 'AILERON TRIM',
      cap: 'wing',
      diameter: 0.022,
      outer: { var: M2.aileronTrim, min: -1, max: 1, step: 0.02, initial: 0, angleRange: [-120, 120], format: (v) => (Math.abs(v) < 0.01 ? 'NEUTRAL' : `${v < 0 ? 'LWD' : 'RWD'} ${Math.round(Math.abs(v) * 100)} %`) },
    }),
    0.06,
    0.15,
  );
  A.label('LWD AIL TRIM RWD', 0.06, 0.128, { height: 0.002 });
  return { throttles };
}
