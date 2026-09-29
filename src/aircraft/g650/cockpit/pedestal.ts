/**
 * G650 centre pedestal, laid out after G650ER photographs (Flickr jeffatchison 52948656184 "the center console
 * between the pilot's seats ... Parking Brake, Speed Brake handle, the Flap Control ... 3 screens ... MCDUs",
 * 52948654839) with legends from LUC:
 *
 *  sloped forward section : MCDU 1 (left) | thrust-lever quadrant | MCDU 2 (right) (Epic `addMcdu`).
 *                           Thrust levers: IDLE, CRZ, CLB, MAX (TO/GA) detents, integral reverse through a lift
 *                           gate at IDLE; TO/GA and A/T disconnect buttons on the handles.
 *  top, forward           : FUEL CONTROL L / R (lever-lock, RUN up / OFF down).
 *  top, middle            : SPEED BRAKE lever (left; RETRACT forward / EXTEND aft), MCDU 3 (centre), FLAP lever
 *                           (right; UP / 10 / T/O APP 20 / DOWN), the red RAT handle aft of the flap lever
 *                           ("RAT", twist and pull). PARK BRAKE handle on the left side of the pedestal.
 *  top, aft left          : TERRAIN INHIBIT, RAAS INHIBIT, FLT CTRL RESET, GPWS / GND SPLR FLAP ORIDE, GND SPOILER
 *                           (amber OFF / blue ARMED); COCKPIT CALL (CREW, RESET, PRIVACY, AFT PRIVACY) with the
 *                           satcom handset ("DO NOT OPERATE SATCOM IN HANGAR").
 *  top, aft centre        : TRIM: aileron trim rocker, ROLL MOTOR CONTROL, RUDDER knob (NOSE L / NOSE R), AUTO
 *                           CENTER, BACKUP PITCH knurled thumbwheel (NOSE DOWN / NOSE UP arrows, Flickr 52948654839).
 *  top, aft right         : blank panel; cup holders at the aft end.
 * The AUTOBRAKE selector is on the lower centre instrument panel (lowerCentre.ts). Positions are scaled from
 * the photographs (EST).
 */
import * as THREE from 'three';
import { GuardedSwitch, Lever, PushButton, SelectorKnob, TBarHandle, Thumbwheel, ToggleSwitch, RockerSwitch, type LegendSegment } from '../../../cockpit/controls';
import type { CockpitEnv } from '../../../cockpit/env';
import type { ControlPointer } from '../../../cockpit/types';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { trimBoxGeometry } from '../../../cockpit/geometry/structure';
import { INPUT } from '../../../core/vars';
import { addMcdu } from '../../../avionics/honeywell-epic/cockpit';
import { G650_VARS as V, G650_EVENTS } from '../vars';
import { TLA } from '../systems/engines';
import { seg, type G650CockpitContext } from './context';
import { PEDESTAL } from './layout';

/** Gulfstream square switchlight (19 mm, EST), legend stacked, engraved name above. */
function sl(c: G650CockpitContext, panel: Panel, id: string, label: string, v: string, x: number, y: number, segments: LegendSegment[], name: string | null, mode: 'toggle' | 'momentary' = 'toggle'): PushButton {
  const btn = panel.add(new PushButton(c.env, { id, label, var: v, mode, style: 'korry', width: 0.019, height: 0.019, layout: 'stack', segments }), x, y);
  if (name) {
    const lines = name.split('\n');
    lines.forEach((ln, i) => panel.label(ln, x, y - 0.0142 - (lines.length - 1 - i) * 0.003, { height: 0.0021 }));
  }
  return btn;
}

/**
 * BACKUP PITCH thumbwheel (photograph: black ridged thumb-wheel with NOSE DOWN / NOSE UP arrows). Rolling
 * the wheel writes the momentary trim command (+1 NOSE UP rolling aft/down, -1 NOSE DOWN rolling fwd/up,
 * matching the arrow legends), spring-returning to 0 shortly after the input stops (the FBW consumes the
 * command in systems/logic.ts G650PostLogic).
 */
class G650BackupPitchWheel extends Thumbwheel {
  private holdT = 0;
  private readonly cmdVar: string;

  constructor(env: CockpitEnv, cmdVar: string) {
    super(env, {
      id: 'g650.ped.backup_pitch',
      label: 'BACKUP PITCH trim wheel (NOSE DOWN fwd / NOSE UP aft)',
      diameter: 0.03,
      width: 0.012,
      channel: { min: -1e6, max: 1e6, step: 1, degPerClick: 10, label: 'BACKUP PITCH' },
    });
    this.cmdVar = cmdVar;
    this.initVar(cmdVar, 0);
  }

  private cmd(dir: number): void {
    this.writeVar(this.cmdVar, dir);
    this.holdT = 0.25;
  }

  override onPointerDown(p: ControlPointer): void {
    super.onPointerDown(p);
    // Click top half / left button rolls forward = NOSE DOWN (-1); right button = NOSE UP (+1).
    this.cmd(p.button === 2 ? 1 : -1);
  }

  override onDrag(dx: number, dy: number, p?: ControlPointer): void {
    super.onDrag(dx, dy, p);
    if (Math.abs(dy) > 0.5) this.cmd(dy < 0 ? -1 : 1); // drag up = roll fwd = NOSE DOWN
  }

  override onWheel(delta: number, p?: ControlPointer): void {
    super.onWheel(delta, p);
    if (delta !== 0) this.cmd(delta > 0 ? -1 : 1);
  }

  override update(dt: number): void {
    super.update(dt);
    if (this.holdT > 0) {
      this.holdT -= dt;
      if (this.holdT <= 0) this.writeVar(this.cmdVar, 0);
    }
  }
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
  const { b, env, suite, ctx } = c;
  const vars = ctx.vars;
  const P = PEDESTAL;
  const W = P.width;

  // ================================================================ sloped forward section: MCDU 1 | levers | MCDU 2
  const f = slopePlacement(P.fwdTop, P.fwdBottom);
  const fwd = b.panel({ name: 'g650.ped_fwd', center_m: f.center_m, facing: 'up', tiltDeg: f.tiltDeg, width: W, height: f.length, material: 'panel', screws: false, radius: 0.006 });
  const mcduU = W / 2 - 0.08;
  if (suite) {
    addMcdu(b, fwd, -mcduU, 0, suite, 1);
    addMcdu(b, fwd, mcduU, 0, suite, 2);
  }
  // Quadrant: a raised dark centre block between the MCDUs carrying the lever slots.
  const qW = 2 * (mcduU - 0.075) - 0.008;
  const quad = fwd.subPanel({ name: 'g650.quadrant', x: 0, y: 0, width: qW, height: f.length - 0.01, material: 'panel', screws: false, radius: 0.004 });
  const tlDetents = [
    { value: -1, label: 'REV' },
    { value: 0, label: 'IDLE', kind: 'gate' as const, direction: 'decreasing' as const },
    { value: TLA.crz, label: 'CRZ' },
    { value: TLA.clb, label: 'CLB' },
    { value: TLA.max, label: 'MAX' },
  ];
  for (const i of [1, 2] as const) {
    const lv = quad.add(
      new Lever(env, {
        id: `g650.ped.tl${i}`,
        var: V.tla(i),
        label: i === 1 ? 'L THRUST LEVER' : 'R THRUST LEVER',
        min: -1,
        max: 1,
        detents: tlDetents,
        softWidth: 0.02,
        step: 0.02,
        travel: { kind: 'arc', minDeg: -40, maxDeg: 30, pivotDepth: 0.06 },
        armLength: 0.13,
        armWidth: 0.012,
        // G650 photograph: chrome horizontal cylindrical thrust-lever grips side by side.
        knob: 'boeing-thrust',
        knobMaterial: 'chrome',
        knobScale: 0.95,
        detentLabels: i === 1 ? 'left' : 'right',
        axis: { var: INPUT.throttle(i), map: (a) => a },
        format: (v) => (v < -0.01 ? `REV ${Math.round(-v * 100)} %` : v <= TLA.idle ? 'IDLE' : `${Math.round(v * 100)} %`),
      }),
      i === 1 ? -0.022 : 0.022,
      -0.03,
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
    const L = 0.13;
    // TO/GA on the outboard face of each handle, A/T disconnect on the top (EST, Gulfstream practice).
    addOnHandle(
      new PushButton(env, { id: `g650.ped.toga${i}`, label: `TO/GA (${i === 1 ? 'L' : 'R'})`, mode: 'momentary', event: 'ap.toga', style: 'small', width: 0.008, capMaterial: 'plasticBlack' }),
      [out * 0.02, 0, L + 0.006],
      new THREE.Euler(0, (out * Math.PI) / 2, 0),
    );
    addOnHandle(
      new PushButton(env, { id: `g650.ped.at_disc${i}`, label: `A/T DISC (${i === 1 ? 'L' : 'R'})`, mode: 'momentary', event: G650_EVENTS.atDisc, style: 'small', width: 0.008, capMaterial: 'knobRed' }),
      [0, 0.016, L - 0.004],
      new THREE.Euler(-Math.PI / 2, 0, 0),
    );
  }

  // ================================================================ top surface (origin top-left: x right, y aft)
  const t = slopePlacement(P.topFwd, P.topAft);
  const ped = b.panel({ name: 'g650.pedestal', center_m: t.center_m, facing: 'up', tiltDeg: t.tiltDeg, width: W, height: t.length, origin: 'top-left', material: 'panel', screws: { kind: 'dzus', diameter: 0.007, inset: 0.008, pitch: 0.25 } });

  // ---- FUEL CONTROL (lever-lock, RUN up / OFF down), centred behind the quadrant.
  const fp = ped.subPanel({ name: 'g650.fuel_ctl', x: W / 2, y: 0.045, width: 0.14, height: 0.07, material: 'panel', screws: { kind: 'dzus', diameter: 0.006, inset: 0.007 }, radius: 0.004 });
  fp.label('FUEL CONTROL', 0, 0.026, { height: 0.0026 });
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
      i === 1 ? -0.035 : 0.035,
      -0.006,
    );
  }

  // ---- SPEED BRAKE (left of MCDU 3): RETRACT forward .. EXTEND aft, continuous (LUC flight controls).
  const sbX = 0.1;
  const sbY = 0.19;
  ped.add(
    new Lever(env, {
      id: 'g650.ped.speedbrake',
      var: V.speedbrake,
      label: 'SPEED BRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'RETRACT' },
        { value: 0.5, label: '1/2' },
        { value: 1, label: 'EXTEND' },
      ],
      softWidth: 0.03,
      step: 0.05,
      travel: { kind: 'arc', minDeg: 26, maxDeg: -26, pivotDepth: 0.045 },
      armLength: 0.1,
      knob: 'speedbrake',
      detentLabels: 'right',
      dragInvert: true,
      format: (v) => (v < 0.02 ? 'RETRACT' : v > 0.98 ? 'EXTEND' : `${Math.round(v * 100)} %`),
    }),
    sbX,
    sbY,
  );
  ped.label('SPEED BRAKE', sbX - 0.03, sbY, { height: 0.0026, anchor: 'middle' }).rotation.z = Math.PI / 2;

  // ---- MCDU 3 (centre; "used to tune radio frequencies", photograph description).
  if (suite) addMcdu(b, ped, W / 2, 0.205, suite, 3);

  // ---- FLAP (right of MCDU 3): UP / 10 / T/O APP 20 / DOWN (39), discrete (photograph legends; data.ts FLAP_DETENTS).
  const flX = W - 0.1;
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
        { value: 2, label: 'T/O APP 20°' },
        { value: 3, label: 'DOWN' },
      ],
      travel: { kind: 'arc', minDeg: 26, maxDeg: -26, pivotDepth: 0.045 },
      armLength: 0.09,
      knob: 'flap',
      knobMaterial: 'knobWhite', // photograph: white FLAP grip
      detentLabels: 'left',
      dragInvert: true,
      format: (v) => ['UP', '10°', 'T/O APP 20°', 'DOWN (39°)'][Math.round(v)] ?? String(v),
    }),
    flX,
    sbY,
  );

  // ---- RAT deploy handle (red, aft of the flap lever, photograph "RAT"; LUC: twist and pull, >= 180 KCAS for
  // the generator). It cannot be pushed back in flight (the RAT is stowed on the ground by maintenance).
  const ratX = W - 0.038;
  const cup = trimBoxGeometry(0.05, 0.035, 0.09, 0.008);
  b.trackGeometry(cup);
  const cupMesh = new THREE.Mesh(cup, env.materials.get('panelDark'));
  cupMesh.name = 'ped_cup_recess';
  cupMesh.userData.cockpitStatic = true;
  ped.addObject(cupMesh, ratX, 0.12, { z: -0.012 });
  ped.add(
    new TBarHandle(env, {
      id: 'g650.ped.rat',
      var: V.ratDeploy,
      label: 'RAT DEPLOY (twist and pull)',
      style: 'tbar',
      rotate: 'none',
      pullLength: 0.05,
      legend: 'RAT',
      material: 'guardRed',
      scale: 0.75,
    }),
    ratX,
    0.255,
  );
  ped.label('RAT', ratX, 0.232, { height: 0.0026, color: '#ff6a5a' });
  let ratOut = vars.get(V.ratDeploy) !== 0;
  b.onUpdate(() => {
    const now = vars.get(V.ratDeploy) !== 0;
    if (ratOut && !now && vars.get('gear.air_ground') === 0) vars.set(V.ratDeploy, 1);
    else ratOut = now;
  });

  // ---- PARK BRAKE handle on the left side (photograph: "PARK BRAKE" along the handle; LUC: braking in
  // proportion to the handle travel = emergency brake).
  ped.add(
    new Lever(env, {
      id: 'g650.ped.park_brake',
      var: V.parkBrake,
      label: 'PARK BRAKE / EMERGENCY BRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'OFF' },
        { value: 1, label: 'PARK' },
      ],
      softWidth: 0.05,
      step: 0.1,
      travel: { kind: 'arc', minDeg: 10, maxDeg: -50, pivotDepth: 0.03 },
      armLength: 0.1,
      armWidth: 0.014,
      knob: 'speedbrake',
      knobMaterial: 'plasticBlack',
      detentLabels: 'right',
      dragInvert: true,
      format: (v) => (v < 0.03 ? 'RELEASED' : v > 0.97 ? 'SET' : `EMER ${Math.round(v * 100)} %`),
    }),
    0.03,
    0.2,
  );
  ped.label('PARK BRAKE', 0.03, 0.1, { height: 0.0024 });

  // ================================================================ aft blocks
  const ay = 0.335;
  ped.line(0.008, ay, W - 0.008, ay, 0.0008);
  const bx0 = 0.012;
  const bx1 = 0.165;
  const bx2 = 0.31;
  ped.line(bx1, ay, bx1, 0.575, 0.0008);
  ped.line(bx2, ay, bx2, 0.575, 0.0008);
  ped.line(0.008, 0.575, W - 0.008, 0.575, 0.0008);

  // ---- left block: INHIBITS / FLIGHT CONTROL
  sl(c, ped, 'g650.ped.terr_inhibit', 'TERRAIN INHIBIT', V.terrInhibit, bx0 + 0.025, ay + 0.035, [seg.on('ON', 'amber', V.terrInhibit)], 'TERRAIN\nINHIBIT');
  sl(c, ped, 'g650.ped.raas_inhibit', 'RAAS INHIBIT', V.raasInhibit, bx0 + 0.025, ay + 0.085, [seg.on('ON', 'amber', V.raasInhibit)], 'RAAS\nINHIBIT');
  ped.line(bx0 + 0.055, ay + 0.012, bx0 + 0.055, ay + 0.1, 0.0005);
  sl(c, ped, 'g650.ped.fc_reset', 'FLT CTRL RESET', V.fltCtrlReset, bx0 + 0.08, ay + 0.035, [{ text: 'ON', color: 'cyan', whenOn: true }], 'FLT CTRL\nRESET', 'momentary');
  sl(c, ped, 'g650.ped.flap_oride', 'GPWS / GND SPLR FLAP ORIDE', V.flapOride, bx0 + 0.125, ay + 0.035, [seg.on('ON', 'amber', V.flapOride)], 'GPWS/\nGND SPLR\nFLAP ORIDE');
  sl(c, ped, 'g650.ped.gnd_spoiler', 'GND SPOILER', V.gndSpoiler, bx0 + 0.125, ay + 0.085, [seg.eq('ARMED', 'cyan', V.gndSpoiler, 1), seg.eq('OFF', 'amber', V.gndSpoiler, 0)], 'GND SPOILER');
  ped.line(bx0, ay + 0.11, bx1, ay + 0.11, 0.0006);

  // ---- COCKPIT CALL (systems/audio.ts): CREW chimes the cabin (latched, RESET), PRIVACY / AFT PRIVACY toggles.
  const cy = ay + 0.13;
  ped.label('COCKPIT CALL', bx0 + 0.045, cy - 0.006, { height: 0.0026 });
  const call = (k: 'crew' | 'reset' | 'privacy' | 'aft_privacy', name: string, x: number, y: number, lamp: LegendSegment[]) =>
    sl(c, ped, `g650.ped.call_${k}`, `COCKPIT CALL ${name.replace('\n', ' ')}`, V.cockpitCall(k), x, y, lamp, name, 'momentary');
  call('crew', 'CREW', bx0 + 0.022, cy + 0.028, [seg.on('CALL', 'cyan', V.cabinCall)]);
  call('reset', 'RESET', bx0 + 0.064, cy + 0.028, []);
  call('privacy', 'PRIVACY', bx0 + 0.022, cy + 0.075, [seg.on('ON', 'cyan', V.privacy)]);
  call('aft_privacy', 'AFT\nPRIVACY', bx0 + 0.064, cy + 0.075, [seg.on('ON', 'cyan', V.aftPrivacy)]);
  // Satcom handset in its cradle (structure).
  const hs = trimBoxGeometry(0.03, 0.02, 0.07, 0.006);
  b.trackGeometry(hs);
  const hsMesh = new THREE.Mesh(hs, env.materials.get('steel'));
  hsMesh.name = 'satcom_handset';
  hsMesh.userData.cockpitStatic = true;
  ped.addObject(hsMesh, bx0 + 0.118, cy + 0.05, { z: 0.01 });
  ped.label('DO NOT OPERATE SATCOM', bx0 + 0.115, cy + 0.098, { height: 0.0017 });
  ped.label('IN HANGAR', bx0 + 0.115, cy + 0.102, { height: 0.0017 });

  // ---- centre block: TRIM
  const tx = (bx1 + bx2) / 2;
  ped.label('TRIM', tx, ay + 0.012, { height: 0.0026 });
  ped.add(
    new RockerSwitch(env, {
      id: 'g650.ped.ail_trim',
      var: V.ailTrimSw,
      label: 'AILERON TRIM (L WING DN / R WING DN)',
      positions: ['L WING DN', 'OFF', 'R WING DN'],
      values: [-1, 0, 1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      orientation: 'horizontal',
      width: 0.026,
      height: 0.02,
      legend: { top: 'R', bottom: 'L' },
    }),
    tx - 0.03,
    ay + 0.04,
  );
  ped.label('L WING DN   R WING DN', tx - 0.03, ay + 0.022, { height: 0.0016 });
  sl(c, ped, 'g650.ped.roll_motor', 'ROLL MOTOR CONTROL', V.rollMotor, tx + 0.04, ay + 0.045, [seg.eq('OFF', 'amber', V.rollMotor, 0)], 'ROLL\nMOTOR CONTROL');
  ped.line(bx1 + 0.006, ay + 0.07, bx2 - 0.006, ay + 0.07, 0.0006);
  ped.line(tx + 0.012, ay + 0.075, tx + 0.012, 0.568, 0.0006);
  ped.add(
    new SelectorKnob(env, {
      id: 'g650.ped.rud_trim',
      var: V.rudTrimSw,
      label: 'RUDDER TRIM',
      cap: 'bar',
      diameter: 0.02,
      labelHeight: 0.0018,
      positions: [
        { value: -1, label: 'NOSE L', angle: -45, spring: 1 },
        { value: 0, label: '', angle: 0 },
        { value: 1, label: 'NOSE R', angle: 45, spring: 1 },
      ],
      initial: 1,
      title: 'RUDDER',
    }),
    tx - 0.03,
    ay + 0.115,
  );
  ped.add(new PushButton(env, { id: 'g650.ped.auto_center', label: 'AUTO CENTER (rudder trim)', var: V.autoCenter, mode: 'momentary', style: 'round', width: 0.012 }), tx - 0.03, ay + 0.19);
  ped.label('AUTO CENTER', tx - 0.03, ay + 0.172, { height: 0.0019 });
  ped.label('BACKUP', tx + 0.042, ay + 0.085, { height: 0.0024 });
  ped.label('PITCH', tx + 0.042, ay + 0.09, { height: 0.0024 });
  // Black knurled thumbwheel with NOSE DOWN / NOSE UP arrow legends, no guard (G650ER pedestal photograph
  // Flickr 52948654839 bottom-centre: a ridged thumb-wheel, not a guarded rocker). Spring behaviour: rolling
  // commands the trim direction momentarily (V.backupPitch -1 NOSE DN / +1 NOSE UP, released to 0).
  ped.label('NOSE DOWN', tx + 0.042, ay + 0.108, { height: 0.0019 });
  ped.add(new G650BackupPitchWheel(env, V.backupPitch), tx + 0.042, ay + 0.14);
  ped.label('NOSE UP', tx + 0.042, ay + 0.172, { height: 0.0019 });

  // ---- right block: blank panel.
  ped.subPanel({ name: 'g650.ped_blank', x: (bx2 + W) / 2, y: (ay + 0.575) / 2, width: W - bx2 - 0.02, height: 0.575 - ay - 0.02, material: 'panel', screws: { kind: 'dzus', diameter: 0.006, inset: 0.008 }, radius: 0.004 });

  // ---- cup holders at the aft end (structure: dark recesses).
  const holder = new THREE.CylinderGeometry(0.036, 0.036, 0.01, 24);
  b.trackGeometry(holder);
  for (const hx of [W / 2 - 0.13, W / 2, W / 2 + 0.13]) {
    const m = new THREE.Mesh(holder, env.materials.get('panelDark'));
    m.name = 'cup_holder';
    m.rotation.x = Math.PI / 2;
    m.userData.cockpitStatic = true;
    ped.addObject(m, hx, 0.655, { z: 0.001 });
  }
}
