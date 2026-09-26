/**
 * G800 centre pedestal (dossier §9.5; BJT500: "two [touchscreen controllers] in the pedestal
 * that replace the FMS MCDUs", "the cursor control devices now live in the center pedestal",
 * "just one switch on the center pedestal - the flight control reset switch", cup holders aft;
 * Woodward: throttle quadrant, fuel switch module, speed brake, trim and flap handles):
 *
 *  forward face : pedestal TSC 2 (L) and TSC 3 (R) side by side (Epic `addTsc`);
 *  quadrant     : SPEED BRAKE handle (left) with the GND SPLR arm switch, L / R power levers
 *                 (0 IDLE .. 1 MAX, TO/GA outboard and A/T DISC inboard on each knob,
 *                 piggy-back reverse levers usable only at IDLE), FLAP handle (right,
 *                 UP / 10 / 20 / 39);
 *  fuel module  : L / R ENGINE RUN/STOP lift-lock switches aft of the levers;
 *  trims        : ROLL TRIM rocker, RUDDER TRIM knob with AUTO CENTER, AUTOBRAKE selector;
 *  aft          : guarded FLT CTRL RESET, PARKING BRAKE handle, CCD 1 (L) and CCD 2 (R).
 * Detailed positions are EST from photographs.
 */
import * as THREE from 'three';
import { GuardedButton, Lever, PushButton, RockerSwitch, SelectorKnob, TBarHandle, ToggleSwitch } from '../../../cockpit/controls';
import { addCcd, addTsc } from '../../../avionics/honeywell-epic/cockpit';
import { INPUT } from '../../../core/vars';
import type { SimVars } from '../../../core/SimVars';
import { G800_VARS as V, AUTOBRAKE } from '../vars';
import type { G800CockpitContext } from './context';
import { PEDESTAL } from './layout';

/** Pedestal top panel placement from the layout (facing up, forward end slightly raised). */
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
  // ---- forward face: pedestal TSCs
  const fp = slopePlacement(P.fwdTop, P.fwdBottom);
  const fwd = b.panel({ name: 'g800.ped_fwd', center_m: fp.center_m, facing: 'up', tiltDeg: fp.tiltDeg, width: P.width, height: fp.length, material: 'panel', screws: false, radius: 0.008 });
  if (suite) {
    addTsc(fwd, -0.098, 0.004, suite, 2);
    addTsc(fwd, 0.098, 0.004, suite, 3);
  }

  // ---- top surface (origin top-left: x right from the left edge, y aft from the forward edge)
  const tp = slopePlacement(P.topFwd, P.topAft);
  const W = P.width;
  const ped = b.panel({ name: 'g800.pedestal', center_m: tp.center_m, facing: 'up', tiltDeg: tp.tiltDeg, width: W, height: tp.length, origin: 'top-left', material: 'panel', screws: { kind: 'dzus', diameter: 0.007, inset: 0.008 } });

  // ---- power levers. Linear lever law, full forward = the TO rating (dossier §2 ThrustLeverFadec); the
  // FADEC rating (TRS) caps N1. Detent labels: IDLE / MAX (EST: no intermediate gates, the A/T drives them).
  const qy = 0.15;
  const levers: Lever[] = [];
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    const revVar = V.rev(i);
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
        armLength: 0.14,
        armWidth: 0.012,
        knob: 'throttle',
        knobScale: 1.1,
        detentLabels: i === 1 ? 'left' : 'right',
        axis: { var: INPUT.throttle(i), map: (a) => a },
        // Forward thrust is blocked while the reverser lever is raised.
        limit: (vars: SimVars) => (vars.get(revVar) > 0.02 ? FWD_LOCKED : FWD_FREE),
        format: (x) => (x <= 0.02 ? 'IDLE' : `${Math.round(x * 100)} %`),
      }),
      i === 1 ? W / 2 - 0.045 : W / 2 + 0.045,
      qy,
    );
    lv.handle.userData.cockpitDynamic = true;
    levers.push(lv);
    // Handle-mounted buttons: TO/GA outboard, A/T DISC inboard (dossier §9.5).
    const out = i === 1 ? -1 : 1;
    const L = 0.14;
    const onHandle = (btn: PushButton, pos: [number, number, number], rot: THREE.Euler) => {
      btn.object.position.set(...pos);
      btn.object.rotation.copy(rot);
      lv.handle.add(btn.object);
      for (const h of btn.hitTargets) h.userData.hitPriority = 1;
      b.add(btn);
    };
    onHandle(
      new PushButton(env, { id: `g800.ped.toga${i}`, label: `TO/GA (${s})`, mode: 'momentary', event: 'ap.toga', style: 'small', width: 0.009, capMaterial: 'plasticBlack' }),
      [out * 0.021, 0, L + 0.004],
      new THREE.Euler(0, (out * Math.PI) / 2, 0),
    );
    onHandle(
      new PushButton(env, { id: `g800.ped.at_disc${i}`, label: `A/T DISC (${s})`, mode: 'momentary', event: 'at.disc', style: 'small', width: 0.009, capMaterial: 'knobRed' }),
      [-out * 0.021, 0, L + 0.004],
      new THREE.Euler(0, (-out * Math.PI) / 2, 0),
    );
    // Piggy-back reverse lever just ahead of the power lever slot: lifted aft/up to deploy (only at IDLE).
    // SCOPE: drawn as a separate short lever beside the power lever's knob path, not riding on its knob.
    const tlaVar = V.tla(i);
    ped.add(
      new Lever(env, {
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
        travel: { kind: 'arc', minDeg: 10, maxDeg: -55, pivotDepth: 0.02 },
        armLength: 0.06,
        armWidth: 0.008,
        knob: 'reverser',
        knobScale: 0.8,
        detentLabels: false,
        limit: (vars: SimVars) => (vars.get(tlaVar) <= 0.05 ? REV_FREE : REV_LOCKED),
        format: (x) => (x <= 0.01 ? 'STOWED' : `REV ${Math.round(x * 100)} %`),
      }),
      i === 1 ? W / 2 - 0.045 - out * 0.0 - 0.018 : W / 2 + 0.045 + 0.018,
      0.035,
    );
  }
  void levers;
  ped.label('POWER', W / 2, 0.014, { height: 0.003 });

  // ---- speed brake handle (left of the power levers): RET .. EXT, continuous with a mid detent
  ped.add(
    new Lever(env, {
      id: 'g800.ped.speedbrake',
      var: V.speedbrake,
      label: 'SPEED BRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'RET' },
        { value: 0.5, label: '1/2' },
        { value: 1, label: 'EXT' },
      ],
      softWidth: 0.02,
      step: 0.05,
      travel: { kind: 'arc', minDeg: 26, maxDeg: -26, pivotDepth: 0.04 },
      armLength: 0.1,
      knob: 'speedbrake',
      detentLabels: 'left',
    }),
    0.055,
    qy + 0.01,
  );
  ped.label('SPEED BRAKE', 0.055, 0.06, { height: 0.0026 });
  ped.add(
    new ToggleSwitch(env, {
      id: 'g800.ped.gnd_splr',
      var: V.gndSplrArm,
      label: 'GND SPLR',
      positions: ['OFF', 'ARMED'],
      values: [0, 1],
      initial: 0,
      labels: { name: 'GND SPLR', positions: true, height: 0.0022 },
      scale: 0.8,
    }),
    0.055,
    0.3,
  );

  // ---- flap handle (right): UP / 10 / 20 / 39 (G800_AIRFRAME, dossier §3.2)
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
        { value: 1, label: '10' },
        { value: 2, label: '20' },
        { value: 3, label: '39' },
      ],
      travel: { kind: 'arc', minDeg: 26, maxDeg: -26, pivotDepth: 0.045 },
      armLength: 0.095,
      knob: 'flap',
      detentLabels: 'right',
      format: (v) => ['UP', '10°', '20°', '39°'][Math.round(v)] ?? String(v),
    }),
    W - 0.055,
    qy + 0.01,
  );
  ped.label('FLAPS', W - 0.055, 0.06, { height: 0.0028 });

  // ---- fuel control: L / R ENGINE RUN / STOP (lift-lock)
  const ey = 0.33;
  ped.label('ENGINE', W / 2, ey - 0.03, { height: 0.003 });
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    ped.add(
      new ToggleSwitch(env, {
        id: `g800.ped.run_${s.toLowerCase()}`,
        var: i === 1 ? V.runL : V.runR,
        label: `${s} ENGINE RUN/STOP`,
        positions: ['STOP', 'RUN'],
        values: [0, 1],
        initial: 0,
        leverLock: true,
        handle: 'lever-lock',
        labels: { name: s, positions: true, height: 0.0022 },
      }),
      i === 1 ? W / 2 - 0.045 : W / 2 + 0.045,
      ey,
    );
  }

  // ---- trims and autobrake
  const ty = 0.43;
  ped.add(
    new RockerSwitch(env, {
      id: 'g800.ped.roll_trim',
      var: V.rollTrimSw,
      label: 'ROLL TRIM',
      positions: ['LWD', 'OFF', 'RWD'],
      values: [-1, 0, 1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      orientation: 'horizontal',
      width: 0.011,
      height: 0.022,
      legend: { top: 'R', bottom: 'L' },
      name: 'ROLL TRIM',
    }),
    0.055,
    ty,
  );
  ped.add(
    new SelectorKnob(env, {
      id: 'g800.ped.rudder_trim',
      var: V.yawTrimSw,
      label: 'RUDDER TRIM',
      cap: 'bar',
      diameter: 0.02,
      labelHeight: 0.0019,
      positions: [
        { value: -1, label: 'NL', angle: -45, spring: 1 },
        { value: 0, label: '', angle: 0 },
        { value: 1, label: 'NR', angle: 45, spring: 1 },
      ],
      initial: 1,
      title: 'RUDDER TRIM',
    }),
    0.155,
    ty,
  );
  ped.add(
    new PushButton(env, {
      id: 'g800.ped.rudder_ctr',
      label: 'RUDDER TRIM AUTO CENTER',
      var: V.yawTrimCenter,
      mode: 'momentary',
      style: 'round',
      width: 0.011,
      engraved: 'CTR',
      engravedHeight: 0.0019,
    }),
    0.205,
    ty,
  );
  ped.label('AUTO\nCENTER', 0.205, ty + 0.017, { height: 0.0019 });
  ped.add(
    new SelectorKnob(env, {
      id: 'g800.ped.autobrake',
      var: V.autobrake,
      label: 'AUTOBRAKE',
      cap: 'pointer',
      diameter: 0.02,
      labelHeight: 0.0019,
      positions: [
        { value: AUTOBRAKE.RTO, label: 'RTO', angle: -80 },
        { value: AUTOBRAKE.OFF, label: 'OFF', angle: -40 },
        { value: AUTOBRAKE.LOW, label: 'LOW', angle: 0 },
        { value: AUTOBRAKE.MED, label: 'MED', angle: 40 },
        { value: AUTOBRAKE.HIGH, label: 'HIGH', angle: 80 },
      ],
      initial: 1,
      title: 'AUTOBRAKE',
    }),
    W - 0.07,
    ty + 0.004,
  );

  // ---- aft: FLT CTRL RESET (guarded), PARKING BRAKE
  const ay = 0.53;
  ped.add(
    new GuardedButton(env, {
      id: 'g800.ped.flt_ctrl_reset',
      label: 'FLT CTRL RESET',
      var: V.fltCtrlReset,
      mode: 'momentary',
      style: 'korry',
      width: 0.017,
      height: 0.017,
      layout: 'stack',
      segments: [{ text: ['FLT CTRL', 'RESET'], color: 'white', whenOn: true }],
      guard: { color: 'red', hinge: 'top', close: 'free' },
    }),
    0.08,
    ay,
  );
  ped.label('FLT CTRL RESET', 0.08, ay - 0.022, { height: 0.0022 });
  ped.add(
    new TBarHandle(env, {
      id: 'g800.ped.park_brake',
      label: 'PARKING BRAKE',
      var: V.parkBrake,
      valueIn: 0,
      valueOut: 1,
      style: 'tbar',
      rotate: 'none',
      legend: 'PARK BRAKE',
      pullLength: 0.04,
      scale: 0.9,
    }),
    W - 0.08,
    ay,
  );
  ped.label('PARKING BRAKE - PULL', W - 0.08, ay - 0.024, { height: 0.0022 });

  // ---- CCDs (Epic `addCcd`): cursor control devices on the aft pedestal
  if (suite) {
    addCcd(b, ped, 0.1, 0.69, suite, 1);
    addCcd(b, ped, W - 0.1, 0.69, suite, 2);
  }
}
