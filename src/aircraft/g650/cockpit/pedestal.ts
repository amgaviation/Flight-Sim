/**
 * G650 centre pedestal (dossier §8 / §9.8, LUC flight controls / powerplant /
 * landing gear drawings):
 *
 *  forward face : MCDU 1 (left) and MCDU 2 (right) side by side (Epic `addMcdu`).
 *  top, forward : strip with AUTOBRAKE (rotary: RTO / OFF / LOW / MED / HIGH, LUC "Low, Medium and High, and a
 *                 single Rejected Takeoff (RTO) mode selected via [a] rotary switch"), GND SPOILER (ARMED blue /
 *                 OFF amber switchlight, LUC), GPWS / GND SPLR FLAP ORIDE (ON switchlight, LUC), TERRAIN and
 *                 GPWS INHIBIT.
 *  quadrant     : SPEED BRAKE handle on the left (LUC: "RETRACT" forward / "EXTEND" aft), L / R thrust levers
 *                 (IDLE, CRZ, CLB, MAX (TO/GA) detents, integral reverse through a lift gate at IDLE, TO/GA and
 *                 A/T disconnect buttons on the handles), FLAP handle on the right (UP / 10 / TO-20 / DOWN, LUC).
 *  below levers : FUEL CONTROL L / R lever-lock switches RUN / OFF (LUC powerplant: "Fuel Control RUN / OFF").
 *  trim panel   : AILERON TRIM (spring rocker), RUDDER TRIM (spring knob), AUTO CENTER, ROLL MOTOR CONTROL,
 *                 FLT CTRL RESET (LUC: "located on the center pedestal", ON legend), BACKUP PITCH (guarded split
 *                 switch NOSE DOWN / NOSE UP, LUC HSTS).
 *  aft          : MCDU 3 (Epic `addMcdu`), PARKING / EMERGENCY BRAKE handle (LUC: "braking is modulated in direct
 *                 proportion to the amount the parking brake handle is pulled").
 * Detailed positions are EST from G650 / G650ER photographs.
 */
import * as THREE from 'three';
import { GuardedSwitch, Lever, PushButton, SelectorKnob, ToggleSwitch, RockerSwitch, type LegendSegment } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { INPUT } from '../../../core/vars';
import { addMcdu } from '../../../avionics/honeywell-epic/cockpit';
import { G650_VARS as V, G650_EVENTS } from '../vars';
import { TLA } from '../systems/engines';
import { seg, type G650CockpitContext } from './context';
import { PEDESTAL } from './layout';

/** Gulfstream square switchlight (19 mm, EST), legend stacked, engraved name below. */
function sl(c: G650CockpitContext, panel: Panel, id: string, label: string, v: string, x: number, y: number, segments: LegendSegment[], name: string | null, mode: 'toggle' | 'momentary' = 'toggle'): PushButton {
  const btn = panel.add(new PushButton(c.env, { id, label, var: v, mode, style: 'korry', width: 0.019, height: 0.019, layout: 'stack', segments }), x, y);
  if (name) panel.label(name, x, y + 0.0165, { height: 0.0024 });
  return btn;
}

function slopePlacement(top: [number, number], bottom: [number, number]) {
  const dx = top[0] - bottom[0];
  const dz = bottom[1] - top[1];
  return {
    center_m: [(top[0] + bottom[0]) / 2, 0, (top[1] + bottom[1]) / 2] as [number, number, number],
    tiltDeg: -THREE.MathUtils.radToDeg(Math.atan2(dz, dx)),
    length: Math.hypot(dx, dz),
  };
}

export function buildPedestal(c: G650CockpitContext): void {
  const { b, env, suite } = c;
  const P = PEDESTAL;
  // ---- forward face: MCDU 1 and 2 (the face is sloped: its top edge faces aft-up).
  const f = slopePlacement(P.fwdTop, P.fwdBottom);
  const fwd = b.panel({ name: 'g650.ped_fwd', center_m: f.center_m, facing: 'up', tiltDeg: f.tiltDeg, width: P.width, height: f.length, material: 'panel', screws: false, radius: 0.006 });
  if (suite) {
    addMcdu(b, fwd, -0.077, 0.004, suite, 1);
    addMcdu(b, fwd, 0.077, 0.004, suite, 2);
  }

  // ---- top surface (origin top-left: x right from the left edge, y aft from the forward edge).
  const t = slopePlacement(P.topFwd, P.topAft);
  const ped = b.panel({ name: 'g650.pedestal', center_m: t.center_m, facing: 'up', tiltDeg: t.tiltDeg, width: P.width, height: t.length, origin: 'top-left', material: 'panel', screws: { kind: 'dzus', diameter: 0.007, inset: 0.008, pitch: 0.25 } });
  const W = P.width;

  // ---- forward strip: AUTOBRAKE, GND SPOILER, GPWS / GND SPLR FLAP ORIDE, TERRAIN / GPWS INHIBIT.
  const sy = 0.042;
  ped.add(
    new SelectorKnob(env, {
      id: 'g650.ped.autobrake',
      var: V.autobrake,
      label: 'AUTOBRAKE',
      cap: 'pointer',
      diameter: 0.017,
      labelHeight: 0.0019,
      // SCOPE / EST: LUC lists RTO, LOW, MED, HIGH; the OFF position of the system model (0) sits between RTO and LOW.
      positions: [
        { value: -1, label: 'RTO', angle: -80 },
        { value: 0, label: 'OFF', angle: -40 },
        { value: 1, label: 'LOW', angle: 0 },
        { value: 2, label: 'MED', angle: 40 },
        { value: 3, label: 'HIGH', angle: 80 },
      ],
      initial: 1,
      title: 'AUTOBRAKE',
    }),
    0.06,
    sy + 0.004,
  );
  sl(c, ped, 'g650.ped.gnd_spoiler', 'GND SPOILER', V.gndSpoiler, 0.16, sy, [seg.eq('ARMED', 'cyan', V.gndSpoiler, 1), seg.eq('OFF', 'amber', V.gndSpoiler, 0)], 'GND SPOILER');
  sl(c, ped, 'g650.ped.flap_oride', 'GPWS / GND SPLR FLAP ORIDE', V.flapOride, 0.215, sy, [seg.on('ON', 'amber', V.flapOride)], 'FLAP ORIDE');
  sl(c, ped, 'g650.ped.terr_inhibit', 'TERRAIN INHIBIT', V.terrInhibit, 0.285, sy, [seg.on('ON', 'amber', V.terrInhibit)], 'TERR INHIB');
  sl(c, ped, 'g650.ped.gpws_inhibit', 'GPWS INHIBIT', V.gpwsInhibit, 0.34, sy, [seg.on('ON', 'amber', V.gpwsInhibit)], 'GPWS INHIB');
  ped.line(0.01, 0.08, W - 0.01, 0.08, 0.0006);

  // ---- thrust levers: IDLE (lift gate into reverse) / CRZ / CLB / MAX (TO/GA) detents (dossier §2, engines.ts TLA).
  const tlDetents = [
    { value: -1, label: 'MAX REV' },
    { value: 0, label: 'IDLE', kind: 'gate' as const, direction: 'decreasing' as const },
    { value: TLA.crz, label: 'CRZ' },
    { value: TLA.clb, label: 'CLB' },
    { value: TLA.max, label: 'MAX' },
  ];
  const tlY = 0.235;
  for (const i of [1, 2] as const) {
    const lv = ped.add(
      new Lever(env, {
        id: `g650.ped.tl${i}`,
        var: V.tla(i),
        label: i === 1 ? 'L THRUST LEVER' : 'R THRUST LEVER',
        min: -1,
        max: 1,
        detents: tlDetents,
        softWidth: 0.02,
        step: 0.02,
        travel: { kind: 'arc', minDeg: -42, maxDeg: 30, pivotDepth: 0.06 },
        armLength: 0.155,
        armWidth: 0.013,
        knob: 'throttle',
        knobScale: 1.25,
        detentLabels: i === 1 ? 'left' : 'right',
        axis: { var: INPUT.throttle(i), map: (a) => a },
        format: (v) => (v < -0.01 ? `REV ${Math.round(-v * 100)} %` : v <= TLA.idle ? 'IDLE' : `${Math.round(v * 100)} %`),
      }),
      i === 1 ? 0.17 : 0.25,
      tlY,
    );
    lv.handle.userData.cockpitDynamic = true;
    const out = i === 1 ? -1 : 1;
    const addOnHandle = (btn: PushButton, pos: [number, number, number], rot: THREE.Euler) => {
      btn.object.position.set(...pos);
      btn.object.rotation.copy(rot);
      lv.handle.add(btn.object);
      for (const h of btn.hitTargets) h.userData.hitPriority = 1;
      b.add(btn);
    };
    const L = 0.155;
    // TO/GA on the outboard face of each handle, A/T disconnect on the top (EST, Gulfstream practice).
    addOnHandle(
      new PushButton(env, { id: `g650.ped.toga${i}`, label: `TO/GA (${i === 1 ? 'L' : 'R'})`, mode: 'momentary', event: 'ap.toga', style: 'small', width: 0.009, capMaterial: 'plasticBlack' }),
      [out * 0.022, 0, L + 0.006],
      new THREE.Euler(0, (out * Math.PI) / 2, 0),
    );
    addOnHandle(
      new PushButton(env, { id: `g650.ped.at_disc${i}`, label: `A/T DISC (${i === 1 ? 'L' : 'R'})`, mode: 'momentary', event: G650_EVENTS.atDisc, style: 'small', width: 0.009, capMaterial: 'knobRed' }),
      [0, 0.017, L - 0.004],
      new THREE.Euler(-Math.PI / 2, 0, 0),
    );
  }
  ped.label('THRUST', 0.21, 0.098, { height: 0.003 });
  // Quadrant fences: raised black cheek plates between the speed brake, the thrust levers and the flap handle
  // (G650 photographs: the lever slots sit in a raised quadrant; EST 30 mm high, 190 mm long).
  const fenceGeo = new THREE.BoxGeometry(0.006, 0.19, 0.03);
  b.trackGeometry(fenceGeo);
  for (const fx of [0.112, 0.302]) {
    const fence = new THREE.Mesh(fenceGeo, env.materials.get('panelDark'));
    fence.name = 'quadrant_fence';
    fence.userData.cockpitStatic = true;
    ped.addObject(fence, fx, tlY, { z: 0.015 });
  }

  // ---- speed brake handle (left): RETRACT forward .. EXTEND aft, continuous (LUC flight controls).
  ped.add(
    new Lever(env, {
      id: 'g650.ped.speedbrake',
      var: V.speedbrake,
      label: 'SPEED BRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'RET' },
        { value: 0.5, label: '1/2' },
        { value: 1, label: 'EXT' },
      ],
      softWidth: 0.03,
      step: 0.05,
      travel: { kind: 'arc', minDeg: 24, maxDeg: -24, pivotDepth: 0.045 },
      armLength: 0.11,
      knob: 'speedbrake',
      detentLabels: 'left',
      dragInvert: true,
      format: (v) => (v < 0.02 ? 'RETRACT' : v > 0.98 ? 'EXTEND' : `${Math.round(v * 100)} %`),
    }),
    0.065,
    tlY,
  );
  ped.label('SPEED BRAKE', 0.065, 0.098, { height: 0.0026 });

  // ---- flap handle (right): UP / 10 / TO-20 / DOWN (39), discrete (LUC flaps drawing, data.ts FLAP_DETENTS).
  ped.add(
    new Lever(env, {
      id: 'g650.ped.flaps',
      var: V.flapLever,
      label: 'FLAP',
      min: 0,
      max: 3,
      discrete: true,
      detents: [
        { value: 0, label: 'UP' },
        { value: 1, label: '10°' },
        { value: 2, label: 'TO/20°' },
        { value: 3, label: 'DOWN' },
      ],
      travel: { kind: 'arc', minDeg: 26, maxDeg: -26, pivotDepth: 0.045 },
      armLength: 0.1,
      knob: 'flap',
      detentLabels: 'right',
      dragInvert: true,
      format: (v) => ['UP', '10°', 'TO / 20°', 'DOWN (39°)'][Math.round(v)] ?? String(v),
    }),
    0.35,
    tlY,
  );
  ped.label('FLAP', 0.35, 0.098, { height: 0.0028 });

  // ---- FUEL CONTROL switches (lever-lock, RUN up / OFF down), on a black plate below the thrust levers.
  const fy = 0.405;
  const fp = ped.subPanel({ name: 'g650.fuel_ctl', x: 0.21, y: fy, width: 0.13, height: 0.06, material: 'panelDark', screws: false, radius: 0.004 });
  fp.label('FUEL CONTROL', 0, 0.022, { height: 0.0026 });
  for (const i of [1, 2] as const) {
    fp.add(
      new ToggleSwitch(env, {
        id: `g650.ped.fuel_ctl${i}`,
        var: i === 1 ? V.fuelCtlL : V.fuelCtlR,
        label: i === 1 ? 'L FUEL CONTROL' : 'R FUEL CONTROL',
        positions: ['OFF', 'RUN'],
        values: [0, 1],
        initial: 1,
        leverLock: true,
        handle: 'lever-lock',
        labels: { name: i === 1 ? 'L' : 'R', positions: true, height: 0.0022 },
      }),
      i === 1 ? -0.03 : 0.03,
      -0.006,
    );
  }

  // ---- trim / flight-control panel.
  const ty = 0.49;
  ped.line(0.01, ty - 0.045, W - 0.01, ty - 0.045, 0.0006);
  ped.label('FLIGHT CONTROL', W / 2, ty - 0.035, { height: 0.0026 });
  ped.add(
    new RockerSwitch(env, {
      id: 'g650.ped.ail_trim',
      var: V.ailTrimSw,
      label: 'AILERON TRIM',
      positions: ['L WING DN', 'OFF', 'R WING DN'],
      values: [-1, 0, 1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      orientation: 'horizontal',
      width: 0.022,
      height: 0.011,
      legend: { top: 'R', bottom: 'L' },
    }),
    0.05,
    ty,
  );
  ped.label('AIL TRIM', 0.05, ty + 0.016, { height: 0.0022 });
  ped.label('LWD      RWD', 0.05, ty - 0.013, { height: 0.0018 });
  ped.add(
    new SelectorKnob(env, {
      id: 'g650.ped.rud_trim',
      var: V.rudTrimSw,
      label: 'RUDDER TRIM',
      cap: 'bar',
      diameter: 0.017,
      labelHeight: 0.0018,
      positions: [
        { value: -1, label: 'NOSE L', angle: -45, spring: 1 },
        { value: 0, label: '', angle: 0 },
        { value: 1, label: 'NOSE R', angle: 45, spring: 1 },
      ],
      initial: 1,
      title: 'RUD TRIM',
    }),
    0.115,
    ty + 0.004,
  );
  ped.add(new PushButton(env, { id: 'g650.ped.auto_center', label: 'AUTO CENTER (rudder trim)', var: V.autoCenter, mode: 'momentary', style: 'round', width: 0.011, engraved: 'AC', engravedHeight: 0.0022 }), 0.165, ty);
  ped.label('AUTO CTR', 0.165, ty + 0.0145, { height: 0.0019 });
  sl(c, ped, 'g650.ped.roll_motor', 'ROLL MOTOR CONTROL', V.rollMotor, 0.215, ty, [seg.eq('OFF', 'amber', V.rollMotor, 0)], 'ROLL MOTOR');
  sl(c, ped, 'g650.ped.fc_reset', 'FLT CTRL RESET', V.fltCtrlReset, 0.265, ty, [{ text: 'ON', color: 'cyan', whenOn: true }], 'FLT CTRL RESET', 'momentary');
  ped.add(
    new GuardedSwitch(env, {
      id: 'g650.ped.backup_pitch',
      var: V.backupPitch,
      label: 'BACKUP PITCH',
      positions: ['NOSE UP', 'OFF', 'NOSE DN'],
      values: [1, 0, -1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      labels: { name: 'BACKUP PITCH', positions: true, height: 0.0021 },
      scale: 0.85,
      guard: { color: 'black', guardedPosition: 1, hinge: 'top' },
    }),
    0.34,
    ty + 0.003,
  );

  // ---- aft: MCDU 3 and the parking / emergency brake handle.
  if (suite) addMcdu(b, ped, 0.225, 0.69, suite, 3);
  ped.add(
    new Lever(env, {
      id: 'g650.ped.park_brake',
      var: V.parkBrake,
      label: 'PARKING / EMERGENCY BRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'OFF' },
        { value: 1, label: 'PARK' },
      ],
      softWidth: 0.05,
      step: 0.1,
      travel: { kind: 'arc', minDeg: 10, maxDeg: -45, pivotDepth: 0.03 },
      armLength: 0.09,
      armWidth: 0.012,
      knob: 'speedbrake',
      knobMaterial: 'knobRed',
      detentLabels: 'right',
      dragInvert: true,
      format: (v) => (v < 0.03 ? 'RELEASED' : v > 0.97 ? 'SET' : `EMER ${Math.round(v * 100)} %`),
    }),
    0.065,
    0.66,
  );
  ped.label('PARK BRAKE', 0.065, 0.575, { height: 0.0026 });
  ped.label('PULL', 0.065, 0.745, { height: 0.0022 });
}

