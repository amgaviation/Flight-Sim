/**
 * Citation M2 centre pedestal (S&D15 §10.2.D "Installed on Pedestal"): two
 * GTC 570 touch controllers, engine start control, engine power levers
 * (throttles with IDLE / CRU / CLB / TO detents and the TO/GA button on the
 * LH throttle, S&D15 §8 / §10.3.L), flap control handle (detents 0 / 15 / 35
 * / 60 ground flaps, S&D15 §9.1), speed brake control, elevator trim wheel
 * and indicator, rudder trim control, aileron trim control. No ignition
 * switches (S&D15 §10.2.D list; AOPA Mar 2014: ignition in the G3000, GTC
 * ENGINE page, systems/eis.ts).
 * Photographs (S&D15 Fig III, S&D21 Fig 3, flyradius, Skies 2017; M2-L26..L34):
 * reduced-size pedestal with a silver sculpted shroud around the GTCs and the
 * throttle quadrant, black face plates and a black lower pedestal to the
 * floor; GTC 570s (115 x 181 mm, SE Aerospace) with the three knobs on one
 * line; a textured phone tray with USB outlets forward of the power levers
 * (AIN "a cellphone holder forward of the power levers"; AOPA USB ports);
 * ENGINE START L / DISENGAGE / R as three abutting square buttons on the
 * sloped aft face of the quadrant shroud; quadrant slot legends TO / CLB /
 * CRU / IDLE / OFF; flap gates 0 / T.O. & APPR 15 / LAND 35 / GROUND FLAPS -
 * GROUND USE ONLY 60; small SPEED BRAKE lever low on the LH quadrant face;
 * short levers with horizontal cylindrical grips; rudder and aileron trim
 * knobs on the aft face of the black lower pedestal near the floor. Dimensions EST.
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import type { CockpitDisplay } from '../../../cockpit/types';
import { Lever, PushButton, RotaryKnob, TrimWheel } from '../../../cockpit/controls';
import { extrude, roundedBox } from '../../../cockpit/geometry/primitives';
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

/** GTC 570 unit face 4.53 x 7.14 in (115 x 181 mm, SE Aerospace); 5.7 in portrait LCD 87 x 116 mm; knobs below the screen on one line (PG Figure 1-12). */
const GTC_W = 0.115;
const GTC_H = 0.181;
const GTC_SCREEN: [number, number] = [0.0869, 0.1158];

export function buildPedestal(b: CockpitBuilder, displays: Map<string, CockpitDisplay>): { throttles: Lever[] } {
  const env = b.env;
  const P = PEDESTAL;
  const silver = env.materials.custom('paint', '#b4b7bb', 0.45); // EST: silver / light-grey sculpted shroud (photographs)
  const black = env.materials.custom('plastic', '#1c1d1f', 0.6); // black lower pedestal
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
    const m = b.structureMesh(g, black, [0, 0, FLOOR_Z]);
    m.name = 'pedestal_body';
    // Silver shroud: the upper band of the profile (GTC surround and quadrant hood), 4 mm proud of the body sides.
    const band = 0.075;
    const sh2 = new THREE.Shape();
    sh2.moveTo(P.aftEndX - 0.012, H(P.aftTopZ + 0.012));
    sh2.lineTo(P.quadrantAftX, H(P.quadrantZ - 0.006));
    sh2.lineTo(footX, H(P.quadrantZ));
    sh2.lineTo(P.towerTopX, H(P.towerTopZ));
    sh2.lineTo(P.towerTopX + 0.032, H(P.towerTopZ));
    sh2.lineTo(P.towerTopX + 0.032, H(P.towerTopZ) - band * 1.4);
    sh2.lineTo(footX, H(P.quadrantZ) - band);
    sh2.lineTo(P.quadrantAftX, H(P.quadrantZ - 0.006) - band);
    sh2.lineTo(P.aftEndX - 0.012, H(P.aftTopZ + 0.012) - band);
    sh2.closePath();
    const W2 = P.halfWidth * 2 + 0.008;
    const g2 = extrude(sh2, { depth: W2, bevel: 0.005, bevelSegments: 2, curveSegments: 4 });
    g2.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -W2 / 2, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
    b.structureMesh(g2, silver, [0, 0, FLOOR_Z]).name = 'pedestal_shroud';
  }

  // ------------------------------------------------------------------ GTC tower face with two GTC 570
  const [tcx, tcz] = downFace(P.towerTopX, P.towerTopZ, P.towerTiltDeg, P.towerLen / 2);
  const T = b.panel({ name: 'm2.gtc_face', center_m: [tcx, 0, tcz], facing: 'aft', tiltDeg: P.towerTiltDeg, width: P.halfWidth * 2, height: P.towerLen, origin: 'top-left', screws: false, material: silver });
  for (const [gtc, gx] of [
    ['gtc1', P.halfWidth - 0.0615],
    ['gtc2', P.halfWidth + 0.0615],
  ] as const) {
    const u = T.subPanel({ name: `m2.${gtc}`, x: gx, y: 0.006 + GTC_H / 2, width: GTC_W, height: GTC_H, origin: 'top-left', material: 'bezel', screws: false, z: 0.004 });
    u.display(displays.get(gtc) ?? new NullDisplay(gtc), GTC_W / 2, 0.012 + GTC_SCREEN[1] / 2, GTC_SCREEN[0], GTC_SCREEN[1], { bezel: false, z: 0.0015, display: { boot: false } });
    u.label('GARMIN', GTC_W / 2, 0.006, { height: 0.0024, color: '#b8bcc2', zone: null });
    const ky = 0.153; // all three knobs on one line (photo)
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
      ky,
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
      GTC_W - 0.024,
      ky,
    );
  }
  // Phone tray with USB outlets between the GTCs and the power levers (static; carbon-textured, EST size).
  {
    const trayY = 0.006 + GTC_H + 0.03;
    const tray = new THREE.Mesh(roundedBox(0.2, 0.042, 0.012, 0.006), env.materials.custom('plastic', '#2b2c2e', 0.35));
    b.trackGeometry(tray.geometry);
    tray.userData.cockpitStatic = true;
    T.addObject(tray, P.halfWidth, trayY, { z: -0.004 });
    const usbG = new THREE.BoxGeometry(0.012, 0.005, 0.004);
    b.trackGeometry(usbG);
    for (const dx of [-0.02, 0.02]) {
      const usb = new THREE.Mesh(usbG, env.materials.get('plasticBlack'));
      usb.userData.cockpitStatic = true;
      T.addObject(usb, P.halfWidth + dx, trayY + 0.012, { z: 0.004 });
    }
    T.label('USB', P.halfWidth, trayY + 0.019, { height: 0.0018, zone: null });
  }

  // ------------------------------------------------------------------ throttle quadrant
  const qLen = footX - P.quadrantAftX;
  const Q = b.panel({ name: 'm2.quadrant', center_m: [(footX + P.quadrantAftX) / 2, 0, P.quadrantZ - 0.002], facing: 'up', tiltDeg: -2, width: P.halfWidth * 2, height: qLen, origin: 'center', screws: { kind: 'phillips', pitch: 0.2 }, material: dark });
  const tlDetents = [
    { value: TLA.cutoff, label: 'OFF' },
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
      armLength: 0.07,
      // Short lever with a horizontal cylindrical black grip (~50 mm, photos): the T-bar knob shape.
      knob: 'speedbrake',
      knobScale: 1.1,
      knobMaterial: 'plasticBlack',
      detentLabels: i === 1 ? 'left' : false,
      axis: { var: INPUT.throttle(i), map: (a) => Math.max(0, Math.min(1, a)) },
      limit: lockLimit,
      format: (v) => (v < -0.05 ? 'OFF' : `${Math.round(v * 100)} %`),
    });
    Q.add(lev, i === 1 ? -0.024 : 0.024, 0.02);
    throttles.push(lev);
  }
  // TO/GA button on the outboard side of the LH throttle knob (S&D15 §10.3.L).
  {
    const arm = throttles[0].object.children[0]?.children[0];
    const toga = new PushButton(env, { id: 'm2.toga', label: 'TO/GA', style: 'small', width: 0.008, mode: 'momentary', event: 'ap.toga', capMaterial: 'knobGrey' });
    toga.object.position.set(-0.038, 0, 0.074);
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
      // Follow-up handle: "Any intermediate position from zero to 35 degrees may be selected in flight" (S&D15 §9.1).
      // "A slight downward pressure is required to move the handle beyond the TAKEOFF AND APPROACH gate to the landing
      // position. The handle must be lifted at the landing gate before it can be moved aft to the GROUND FLAPS
      // position" (525AFM-06 p.3-103): gates at 15 and 35 (extending), soft detents at 0 and 60.
      // Gate legends (flyradius quadrant photo): 0 / T.O. & APPR 15 / LAND 35 / GROUND FLAPS - GROUND USE ONLY 60.
      step: 0.1,
      detents: [
        { value: 0, label: '0°' },
        { value: 1, label: 'T.O. & APPR 15°', kind: 'gate', direction: 'increasing' },
        { value: 2, label: 'LAND 35°', kind: 'gate', direction: 'increasing' },
        { value: 3, label: 'GROUND FLAPS 60°\nGROUND USE ONLY' },
      ],
      travel: { kind: 'arc', minDeg: 28, maxDeg: -28, pivotDepth: 0.05 },
      armLength: 0.09,
      knob: 'flap',
      detentLabels: 'right',
      format: (v) => (v >= 2.9 ? '60 GND' : v > 2 ? '35 (GATE)' : `${Math.round(v <= 1 ? v * 15 : 15 + (v - 1) * 20)}°`),
    }),
    0.09,
    -0.02,
  );
  // Speed brake: small lever in a fore-aft slot low on the LH quadrant face, RETRACT (fwd / top) / EXTEND (aft).
  Q.label('SPEED BRAKE', -0.105, -0.075, { height: 0.0024 });
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
      travel: { kind: 'linear', length: 0.04 },
      armLength: 0.03,
      knob: 'speedbrake',
      knobScale: 0.6,
      detentLabels: 'left',
      format: (v) => (v >= 0.5 ? 'EXTEND' : 'RETRACT'),
    }),
    -0.105,
    -0.045,
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

  // ------------------------------------------------------------------ ENGINE START on the sloped aft face of the quadrant shroud
  const aftLen = P.quadrantAftX - P.aftEndX;
  const A = b.panel({ name: 'm2.ped_aft', center_m: [(P.quadrantAftX + P.aftEndX) / 2, 0, (P.aftTopZ + P.quadrantZ) / 2], facing: 'up', tiltDeg: -12, width: P.halfWidth * 2, height: aftLen, origin: 'top-left', screws: false, material: silver });
  // ENGINE START bracket with L / DISENGAGE / R printed above three abutting square buttons (photos).
  A.bracket('ENGINE START', 0.15, 0.03, 0.062, { height: 0.0026 });
  const startBtn = (i: 1 | 2) =>
    new PushButton(env, {
      id: `m2.start${i}`,
      var: M2.startBtn(i),
      label: `${i === 1 ? 'L' : 'R'} ENGINE START`,
      style: 'korry',
      width: 0.019,
      height: 0.019,
      mode: 'momentary',
      segments: [{ text: '', color: 'white', var: M2.startLight(i) }],
    });
  A.add(startBtn(1), 0.1305, 0.056);
  A.add(new PushButton(env, { id: 'm2.start_diseng', var: M2.startDiseng, label: 'START DISENGAGE', style: 'korry', width: 0.019, height: 0.019, mode: 'momentary', engraved: '', engravedHeight: 0.0024 }), 0.15, 0.056);
  A.add(startBtn(2), 0.1695, 0.056);
  A.label('L', 0.1305, 0.04, { height: 0.0028 });
  A.label('DISENGAGE', 0.15, 0.04, { height: 0.0019 });
  A.label('R', 0.1695, 0.04, { height: 0.0028 });

  // ------------------------------------------------------------------ rudder / aileron trim on the aft face of the black lower pedestal
  // (S&D15 Fig III / S&D21 Fig 3: pointer knobs with dot scales near the floor; rudder above aileron, EST order).
  const trimZ = (P.aftTopZ + 0.02 + FLOOR_Z) / 2;
  const TR = b.panel({ name: 'm2.ped_trim', center_m: [P.aftEndX - 0.012, 0, trimZ], facing: 'aft', tiltDeg: 0, width: P.halfWidth * 2 - 0.02, height: FLOOR_Z - P.aftTopZ - 0.06, origin: 'center', screws: false, material: black });
  TR.add(
    new RotaryKnob(env, {
      id: 'm2.rud_trim',
      label: 'RUDDER TRIM',
      cap: 'pointer',
      diameter: 0.028,
      outer: { var: M2.rudderTrim, min: -1, max: 1, step: 0.02, initial: 0, angleRange: [-120, 120], format: (v) => (Math.abs(v) < 0.01 ? 'NEUTRAL' : `${v < 0 ? 'NL' : 'NR'} ${Math.round(Math.abs(v) * 100)} %`) },
    }),
    0,
    0,
  );
  TR.label('NOSE L    RUDDER TRIM    NOSE R', 0, 0.028, { height: 0.0024 });
  TR.label('\u2022 \u2022 \u2022 \u2022 \u2022 \u2022 \u2022', 0, 0.02, { height: 0.0022 });
  TR.add(
    new RotaryKnob(env, {
      id: 'm2.ail_trim',
      label: 'AILERON TRIM',
      cap: 'pointer',
      diameter: 0.022,
      outer: { var: M2.aileronTrim, min: -1, max: 1, step: 0.02, initial: 0, angleRange: [-120, 120], format: (v) => (Math.abs(v) < 0.01 ? 'NEUTRAL' : `${v < 0 ? 'LWD' : 'RWD'} ${Math.round(Math.abs(v) * 100)} %`) },
    }),
    0,
    -0.09,
  );
  TR.label('LWD   AILERON TRIM   RWD', 0, -0.064, { height: 0.0022 });
  TR.label('\u2022 \u2022 \u2022 \u2022 \u2022', 0, -0.071, { height: 0.0022 });
  return { throttles };
}
