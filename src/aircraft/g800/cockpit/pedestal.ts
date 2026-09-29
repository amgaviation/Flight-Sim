/**
 * G800 centre pedestal (G600 BL7C0704 g600_center, BL7C0705 crops p_pedmid / p_pedaft / p_flap / p_trim / p_pbrk;
 * G500 BL7C0670 c_ped; BJT500: "two [touchscreen controllers] in the pedestal that replace the FMS MCDUs", "the
 * cursor control devices now live in the center pedestal", "just one switch on the center pedestal - the flight
 * control reset switch", cup holders aft):
 *
 *  wings (fwd)  : pedestal TSC 2 (L) and TSC 3 (R) on raised wings tilted up toward each pilot (Epic `addTsc`);
 *  wings (aft)  : CCD grips (four buttons across the top: DU select L / C / R and MENU, a trackball, ENTER trigger,
 *                 a DATA thumbwheel on the outboard side, a long palm rest), `epic.ccd{1,2}.*` events;
 *  channel      : L / R power levers with large chrome cylindrical grips side by side (0 IDLE .. 1 MAX; piggy-back
 *                 reverse levers riding on the grips, usable only at IDLE; TO/GA on the outboard face and the A/T
 *                 ENG / DISENG thumb button on top of each grip - code450: "A/T ENG / DISENG button - Push either with
 *                 thumb"); FUEL CONTROL (L / R rotary RUN / OFF, red fire lamp beside each knob, code450 G700/G800
 *                 fire and powerplant study sheets); SPEED BRAKE (left, white paddle, RETRACT / EXTEND) and FLAPS
 *                 (right, white knob, UP / 10° / 20° T/O APP / DOWN); the Gulfstream logo; PITCH TRIM split switch
 *                 (both halves must move) with FLT CTRL RESET (clear guard) right of it; YAW TRIM knob (NOSE L / R);
 *  aft          : PARKING BRAKE handle in its recess aft-left (amber SET lamp), a storage bin aft-right, cupholders
 *                 and bumper (shell.ts).
 * AUTOBRAKE, GROUND SPOILERS ARM, ROLL TRIM and rudder-trim AUTO CENTER are TSC functions (systems/tscApps.ts).
 * Detailed positions EST from the photographs.
 */
import * as THREE from 'three';
import { AnnunciatorLight, GuardedButton, Lever, PushButton, RockerSwitch, SelectorKnob, TBarHandle, Thumbwheel } from '../../../cockpit/controls';
import { CcdTouchPad, addTsc } from '../../../avionics/honeywell-epic/cockpit';
import { EPIC_EVENTS } from '../../../avionics/honeywell-epic/vars';
import type { EpicSuite } from '../../../avionics/honeywell-epic/suite';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { KeyPad } from '../../../cockpit/controls';
import { INPUT } from '../../../core/vars';
import type { SimVars } from '../../../core/SimVars';
import { roundedBox } from '../../../cockpit/geometry/primitives';
import { G800_VARS as V } from '../vars';
import type { G800CockpitContext } from './context';
import { PEDESTAL } from './layout';

/** Pedestal panel placement from the layout (facing up, forward end raised). */
function slopePlacement(top: [number, number], bottom: [number, number]) {
  const dx = top[0] - bottom[0];
  const dz = bottom[1] - top[1];
  return {
    center_m: [(top[0] + bottom[0]) / 2, 0, (top[1] + bottom[1]) / 2] as [number, number, number],
    tiltDeg: -THREE.MathUtils.radToDeg(Math.atan2(dz, dx)),
    length: Math.hypot(dx, dz),
  };
}

// Reverse levers: only from IDLE (GVI: reversers "only at IDLE"); the interlock tuples are cached (no per-frame allocation).
const REV_FREE: [number, number] = [0, 1];
const REV_LOCKED: [number, number] = [0, 0];
const FWD_FREE: [number, number] = [0, 1];
const FWD_LOCKED: [number, number] = [0, 0];

export function buildPedestal(c: G800CockpitContext): void {
  const { b, env, suite } = c;
  const P = PEDESTAL;
  const W = P.width;
  const cx = W / 2;
  // ---- forward face: pedestal TSCs on the wings
  const fp = slopePlacement(P.fwdTop, P.fwdBottom);
  const fwd = b.panel({ name: 'g800.ped_fwd', center_m: fp.center_m, facing: 'up', tiltDeg: fp.tiltDeg, width: W, height: fp.length, material: 'panelDark', screws: false, radius: 0.008 });
  if (suite) {
    // Portrait pedestal TSC units raked toward the crew (fix round 1 L01; G600 BL7C0705 crop p_pedmid).
    addTsc(fwd, -P.tscU, 0.004, suite, 2, true);
    addTsc(fwd, P.tscU, 0.004, suite, 3, true);
  }

  // ---- top surface (origin top-left: x right from the left edge, y aft from the forward edge)
  const tp = slopePlacement(P.topFwd, P.topAft);
  const ped = b.panel({ name: 'g800.pedestal', center_m: tp.center_m, facing: 'up', tiltDeg: tp.tiltDeg, width: W, height: tp.length, origin: 'top-left', material: 'panelDark', screws: { kind: 'hex', diameter: 0.004, inset: 0.008, pitch: 0.3 } });
  // Centre-channel side walls (the wings stand 25 mm proud of the channel floor).
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(roundedBox(0.008, 0.62, 0.025, 0.003), env.materials.get('panelDark'));
    wall.userData.cockpitStatic = true;
    b.trackGeometry(wall.geometry);
    ped.addObject(wall, cx + s * (P.channelHalf + 0.004), 0.31, { z: 0.0125 });
  }

  // ---- power levers (centre channel, 35 mm apart). Linear lever law, full forward = the TO rating (dossier §2).
  const qy = 0.045;
  const L = 0.15;
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    const revVar = V.rev(i);
    const out = i === 1 ? -1 : 1;
    const lv = ped.add(
      new Lever(env, {
        id: `g800.ped.pl${i}`,
        var: V.tla(i),
        label: `${s} POWER LEVER`,
        min: 0,
        max: 1,
        detents: [
          { value: 0, label: 'IDLE' },
          { value: 1, label: 'MAX' },
        ],
        softWidth: 0.02,
        step: 0.02,
        travel: { kind: 'arc', minDeg: -34, maxDeg: 30, pivotDepth: 0.06 },
        armLength: L,
        armWidth: 0.01,
        knob: 'boeing-thrust',
        knobMaterial: 'chrome',
        knobScale: 0.95,
        armMaterial: 'aluminium',
        detentLabels: false,
        axis: { var: INPUT.throttle(i), map: (a) => a },
        // Forward thrust is blocked while the reverser lever is raised.
        limit: (vars: SimVars) => (vars.get(revVar) > 0.02 ? FWD_LOCKED : FWD_FREE),
        format: (x) => (x <= 0.02 ? 'IDLE' : `${Math.round(x * 100)} %`),
      }),
      cx + out * 0.0175,
      qy,
    );
    lv.handle.userData.cockpitDynamic = true;
    const onHandle = (ctl: { object: THREE.Object3D; hitTargets: THREE.Object3D[] }, pos: [number, number, number], rot: THREE.Euler) => {
      ctl.object.position.set(...pos);
      ctl.object.rotation.copy(rot);
      lv.handle.add(ctl.object);
      for (const h of ctl.hitTargets) h.userData.hitPriority = 1;
    };
    // TO/GA on the outboard end of the grip; A/T ENG / DISENG (thumb, top of the grip).
    const toga = new PushButton(env, { id: `g800.ped.toga${i}`, label: `TO/GA (${s})`, mode: 'momentary', event: 'ap.toga', style: 'small', width: 0.009, capMaterial: 'plasticBlack' });
    onHandle(toga, [out * 0.031, 0, L + 0.004], new THREE.Euler(0, (out * Math.PI) / 2, 0));
    b.add(toga);
    const at = new PushButton(env, { id: `g800.ped.at_disc${i}`, label: `A/T ENG / DISENG (${s})`, mode: 'momentary', event: EPIC_EVENTS.gp('at'), style: 'small', width: 0.008, capMaterial: 'plasticBlack' });
    onHandle(at, [out * 0.012, 0.012, L + 0.006], new THREE.Euler(-Math.PI / 2, 0, 0));
    b.add(at);
    // Piggy-back reverse lever: a flat paddle FOLDED ON TOP of the chrome grip, hinged at the top rear and
    // lifted aft / up to deploy, stowed flush (fix round 1 L10; G500 c_ped / G600 p_pedmid photographs).
    // Only at IDLE.
    const tlaVar = V.tla(i);
    const rev = new Lever(env, {
      id: `g800.ped.rev${i}`,
      var: revVar,
      label: `${s} REVERSE LEVER`,
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'STOW' },
        { value: 0.25, label: 'IDLE REV' },
        { value: 1, label: 'MAX REV' },
      ],
      softWidth: 0.03,
      step: 0.05,
      travel: { kind: 'arc', minDeg: 4, maxDeg: -64, pivotDepth: 0.005 },
      armLength: 0.012,
      armWidth: 0.006,
      knobGeometry: {
        key: 'g800.rev.paddle',
        // Paddle plate lying forward over the grip top from the aft hinge (+Z toward the front of the grip).
        build: () => roundedBox(0.024, 0.007, 0.056, 0.003, 2).translate(0, 0, 0.026),
      },
      knobMaterial: 'plasticBlack',
      slot: false,
      detentLabels: false,
      limit: (vars: SimVars) => (vars.get(tlaVar) <= 0.05 ? REV_FREE : REV_LOCKED),
      format: (x) => (x <= 0.01 ? 'STOWED' : `REV ${Math.round(x * 100)} %`),
    });
    onHandle(rev, [0, 0.014, L - 0.006], new THREE.Euler(-Math.PI / 2, 0, 0));
    b.add(rev);
  }

  // ---- FUEL CONTROL (raised sub-panel aft of the levers): L / R rotary RUN (up) / OFF (down), gated out of OFF;
  // the red lamp beside each knob follows that engine's fire warning.
  const fc = ped.subPanel({ name: 'g800.ped_fuel', x: cx, y: 0.17, width: 0.1, height: 0.075, z: 0.012, material: 'panelDark', radius: 0.006 });
  fc.label('FUEL CONTROL', 0, 0.03, { height: 0.0026 });
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    const x = i === 1 ? -0.025 : 0.025;
    fc.add(
      new SelectorKnob(env, {
        id: `g800.ped.run_${s.toLowerCase()}`,
        var: i === 1 ? V.runL : V.runR,
        label: `${s} FUEL CONTROL`,
        cap: 'bar',
        diameter: 0.016,
        labelHeight: 0.0022,
        positions: [
          { value: 0, label: 'OFF', angle: 180, gated: true },
          { value: 1, label: 'RUN', angle: 0, gated: true },
        ],
        initial: 0,
      }),
      x,
      -0.002,
    );
    fc.add(new AnnunciatorLight(env, { id: `g800.ped.fire_lt_${s.toLowerCase()}`, label: `${s} FUEL CONTROL FIRE LIGHT`, width: 0.007, height: 0.007, segments: [{ text: '', color: 'red', var: `fire.eng${i}_warn` }] }), x + (i === 1 ? 0.014 : -0.014), -0.002);
    fc.label(s, x + (i === 1 ? 0.014 : -0.014), 0.009, { height: 0.0024 });
  }

  // ---- SPEED BRAKE (left) and FLAPS (right) in the channel aft of FUEL CONTROL.
  const sy = 0.3;
  ped.add(
    new Lever(env, {
      id: 'g800.ped.speedbrake',
      var: V.speedbrake,
      label: 'SPEED BRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'RETRACT' },
        { value: 0.5, label: '' },
        { value: 1, label: 'EXTEND' },
      ],
      softWidth: 0.02,
      step: 0.05,
      travel: { kind: 'arc', minDeg: 24, maxDeg: -24, pivotDepth: 0.04 },
      armLength: 0.07,
      knob: 'speedbrake',
      knobMaterial: 'knobWhite',
      knobScale: 0.8,
      detentLabels: false,
    }),
    cx - 0.024,
    sy,
  );
  ped.label('SPEED\nBRAKE', cx - 0.043, sy, { height: 0.0022 });
  ped.label('RETRACT', cx - 0.024, sy - 0.05, { height: 0.002 });
  ped.label('EXTEND', cx - 0.024, sy + 0.05, { height: 0.002 });
  ped.add(
    new Lever(env, {
      id: 'g800.ped.flaps',
      var: V.flapLever,
      label: 'FLAPS',
      min: 0,
      max: 3,
      discrete: true,
      detents: [
        { value: 0, label: 'UP' },
        { value: 1, label: '10°' },
        { value: 2, label: '20° T/O APP' },
        { value: 3, label: 'DOWN' },
      ],
      travel: { kind: 'arc', minDeg: 24, maxDeg: -24, pivotDepth: 0.045 },
      armLength: 0.07,
      knob: 'flap',
      knobMaterial: 'knobWhite',
      knobScale: 0.8,
      detentLabels: 'left',
      labelHeight: 0.002,
      format: (v) => ['UP', '10°', '20°', 'DOWN (39°)'][Math.round(v)] ?? String(v),
    }),
    cx + 0.026,
    sy,
  );
  ped.label('Gulfstream', cx, 0.4, { height: 0.0075, weight: 700 });

  // ---- trim sub-panel: PITCH TRIM split switch (both halves), FLT CTRL RESET (clear guard), YAW TRIM knob.
  const ty = 0.47;
  const tr = ped.subPanel({ name: 'g800.ped_trim', x: cx, y: ty + 0.03, width: 0.095, height: 0.12, material: 'panelDark', radius: 0.008 });
  tr.label('PITCH TRIM', -0.022, 0.045, { height: 0.0022 });
  // Two large square paddle halves side by side (~20 mm each, G600 crop p_pedaft; fix round 1 L09).
  for (const [k, dx, v] of [
    ['a', -0.033, V.altTrimA],
    ['b', -0.011, V.altTrimB],
  ] as const) {
    tr.add(
      new RockerSwitch(env, {
        id: `g800.ped.pitch_trim_${k}`,
        var: v,
        label: `PITCH TRIM (${k === 'a' ? 'left' : 'right'} half)`,
        positions: ['NOSE UP', 'OFF', 'NOSE DN'],
        values: [1, 0, -1],
        initial: 1,
        springs: { 0: 1, 2: 1 },
        width: 0.02,
        height: 0.02,
      }),
      dx,
      0.025,
    );
  }
  tr.label('NOSE UP', -0.02, 0.006, { height: 0.002 });
  tr.add(
    new GuardedButton(env, {
      id: 'g800.ped.flt_ctrl_reset',
      label: 'FLT CTRL RESET',
      var: V.fltCtrlReset,
      mode: 'momentary',
      style: 'korry',
      unlitTint: 0.38, // faint legend when unlit (fix round 1 L11)
      width: 0.016,
      height: 0.016,
      layout: 'stack',
      segments: [{ text: ['FLT CTRL', 'RESET'], color: 'white', whenOn: true }],
      guard: { color: 'clear', hinge: 'top', close: 'free' },
    }),
    0.025,
    0.025,
  );
  tr.label('FLT CTRL\nRESET', 0.025, 0.045, { height: 0.0019 });
  tr.add(
    new SelectorKnob(env, {
      id: 'g800.ped.yaw_trim',
      var: V.yawTrimSw,
      label: 'YAW TRIM',
      cap: 'smooth',
      diameter: 0.028,
      labelHeight: 0.0019,
      positions: [
        { value: -1, label: 'NOSE L', angle: -40, spring: 1 },
        { value: 0, label: '', angle: 0 },
        { value: 1, label: 'NOSE R', angle: 40, spring: 1 },
      ],
      initial: 1,
      title: 'YAW TRIM',
    }),
    0,
    -0.03,
  );

  // ---- PARKING BRAKE: squared handle in its recess aft-left, amber lamp on top when set.
  const pbX = 0.07;
  const pbY = 0.64;
  const recess = new THREE.Mesh(roundedBox(0.1, 0.13, 0.004, 0.012), env.materials.get('plasticBlack'));
  recess.userData.cockpitStatic = true;
  b.trackGeometry(recess.geometry);
  ped.addObject(recess, pbX, pbY, { z: 0.001 });
  ped.add(
    new TBarHandle(env, {
      id: 'g800.ped.park_brake',
      label: 'PARKING BRAKE',
      var: V.parkBrake,
      valueIn: 0,
      valueOut: 1,
      style: 'knob',
      rotate: 'none',
      legend: 'PARKING BRAKE',
      lightVar: 'brakes.parking_set',
      lightColor: 'amber',
      material: 'aluminium',
      pullLength: 0.035,
      scale: 1.3,
    }),
    pbX,
    pbY,
  );

  // ---- CCDs on the wings aft of the TSCs.
  if (suite) {
    addSymmetryCcd(c, ped, 0.0675, 0.2, suite, 1);
    addSymmetryCcd(c, ped, W - 0.0675, 0.2, suite, 2);
  }
}

/**
 * Symmetry CCD: a grip-style hand rest (G600 BL7C0705 p_pedmid; G500 c_ped): four small buttons across the top of the
 * head (DU select left / centre / right and MENU), a trackball (cursor), an ENTER trigger on the front, a DATA
 * thumbwheel on the outboard side (outer = coarse, Shift = fine) and a long palm rest running aft with a silver insert.
 */
function addSymmetryCcd(c: G800CockpitContext, ped: Panel, x: number, y: number, suite: EpicSuite, side: 1 | 2): void {
  const { b, env } = c;
  const pfx = `${suite.cfg.idPrefix}.ccd${side}`;
  const outb = side === 1 ? -1 : 1;
  // Grip body: head (forward) and palm rest (aft), dark rubberised; silver insert along the rest.
  const body = new THREE.Group();
  const head = new THREE.Mesh(env.geometry.get('g800.ccd.head', () => roundedBox(0.062, 0.075, 0.06, 0.014).translate(0, 0, 0.03)), env.materials.get('plasticBlack'));
  head.position.y = 0.03;
  const rest = new THREE.Mesh(env.geometry.get('g800.ccd.rest', () => roundedBox(0.05, 0.19, 0.04, 0.012).translate(0, 0, 0.02)), env.materials.get('plasticBlack'));
  rest.position.y = -0.1;
  const insert = new THREE.Mesh(env.geometry.get('g800.ccd.insert', () => roundedBox(0.012, 0.15, 0.004, 0.002)), env.materials.get('aluminium'));
  insert.position.set(-outb * 0.019, -0.1, 0.04);
  insert.rotation.y = -outb * 0.5;
  body.add(head, rest, insert);
  for (const m of body.children) m.userData.cockpitStatic = true;
  ped.addObject(body, x, y);
  // Controls on the head top (sub-panel 60 mm above the wing).
  const top = ped.subPanel({ name: `g800.ccd${side}`, x, y: y - 0.03, z: 0.061, width: 0.056, height: 0.07, origin: 'top-left', material: 'plasticBlack', thickness: 0.002, screws: false, radius: 0.01 });
  const keys = new KeyPad(env, {
    id: `${pfx}.du`,
    label: `CCD ${side} display select`,
    rows: [[{ id: '0', label: '' }, { id: '1', label: '' }, { id: '2', label: '' }]],
    singleEvent: EPIC_EVENTS.ccdDu(side),
    eventPrefix: `epic.ccd${side}.k`,
    keyWidth: 0.008,
    keyHeight: 0.008,
    gap: 0.004,
  });
  top.add(keys, 0.006, 0.012);
  top.add(new PushButton(env, { id: `${pfx}.menu`, label: `CCD ${side} MENU`, mode: 'momentary', event: EPIC_EVENTS.ccdMenu(side), style: 'small', width: 0.008, capMaterial: 'plasticGrey' }), 0.046, 0.016);
  // Trackball (the touch-pad control with a ball on it).
  const pad = new CcdTouchPad(env, `${pfx}.pad`, side, suite.events, 0.03, 0.03);
  top.add(pad, 0.028, 0.042);
  const ball = new THREE.Mesh(env.geometry.get('g800.ccd.ball', () => new THREE.SphereGeometry(0.013, 20, 12)), env.materials.get('bezelGloss'));
  ball.position.z = 0.002;
  pad.object.add(ball);
  const ring = new THREE.Mesh(env.geometry.get('g800.ccd.ring', () => new THREE.TorusGeometry(0.0145, 0.0018, 8, 24)), env.materials.get('aluminium'));
  ring.position.z = 0.003;
  pad.object.add(ring);
  // ENTER trigger on the forward face of the head.
  const enter = new PushButton(env, { id: `${pfx}.enter`, label: `CCD ${side} ENTER`, mode: 'momentary', event: EPIC_EVENTS.ccdEnter(side), style: 'small', width: 0.012, capMaterial: 'plasticGrey' });
  ped.add(enter, x, y + 0.004 - 0.03 - 0.0375, { z: 0.035, tiltDeg: 90 });
  // DATA thumbwheel on the outboard side of the head.
  ped.add(
    new Thumbwheel(env, {
      id: `${pfx}.data`,
      label: `CCD ${side} DATA`,
      channel: { incEvent: EPIC_EVENTS.ccdDataInc(side), decEvent: EPIC_EVENTS.ccdDataDec(side), label: 'DATA' },
      diameter: 0.022,
      width: 0.008,
      orientation: 'vertical',
    }),
    x + outb * 0.033,
    y + 0.02,
    { z: 0.035, rotDeg: 0 },
  );
}
