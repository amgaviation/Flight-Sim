/**
 * Global 6000 centre pedestal (dossier §10 / §12.4; FSB appendix 6: MKP / CCP
 * on the pedestal; AOPA 2012: "brushed chrome accents on the power levers as
 * well as the flap, spoiler and parking brake handles").
 *
 *  forward face : MKP 1 | MKP 2 (multifunction keyboards).
 *  top, forward : CCP 1 | CCP 2 (cursor control panels with trackballs).
 *  quadrant     : FLIGHT SPOILER lever (left), thrust levers with piggy-back
 *                 reverse levers, A/T disconnect (outboard grips) and TO/GA
 *                 (inboard faces), SLAT/FLAP lever (right, gates at 0 OUT and 6).
 *  below levers : ENG RUN L / R (lift to move), ENGINE EPR / N1 PBAs.
 *  trim         : STAB CH 1 / CH 2 disconnect (guarded), AIL trim split switch,
 *                 RUD trim rotary.
 *  aft          : AUTOBRAKE, GND LIFT DUMPING MAN ARM / OFF, EGPWS TERR OFF /
 *                 G/S WARN MUTED / FLAP OVRD (guarded), IRS 1 / 2 / 3 mode
 *                 selectors, DC PWR EMER OVRD (guarded), EMS CDU, COCKPIT LIGHTS
 *                 (FLOOD / DISPLAY / INTEGRAL knobs, MASTER DIM, LAMP TEST),
 *                 PARK/EMER BRAKE handle (left rear).
 *  aft face     : RAT manual deploy handle, landing-gear manual release handle.
 * Detailed positions are EST from photographs (dossier §12 "Location / size").
 */
import * as THREE from 'three';
import { GuardedButton, Lever, PushButton, RotaryKnob, SelectorKnob, TBarHandle, ToggleSwitch } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { INPUT } from '../../../core/vars';
import { addCcp, addMkp } from '../../../avionics/collins-fusion';
import { G6K_EVENTS, G6K_VARS as V } from '../vars';
import { TLA } from '../systems/engines';
import { seg, type G6kCockpitContext } from './context';
import { PEDESTAL, FLOOR_Z } from './layout';
import { pba } from './mainPanel';
import { addEmsCdu, type EmsCduLogic } from './emsCdu';
import type { DisplayCanvas } from '../../../avionics/common/CanvasDisplay';

const OPEN: [number, number] = [0, 1];
const SHUT: [number, number] = [0, 0];

function topPlacement() {
  const P = PEDESTAL;
  const dx = P.topFwd[0] - P.topAft[0];
  const dz = P.topAft[1] - P.topFwd[1];
  return {
    center_m: [(P.topFwd[0] + P.topAft[0]) / 2, 0, (P.topFwd[1] + P.topAft[1]) / 2] as [number, number, number],
    tiltDeg: -THREE.MathUtils.radToDeg(Math.atan2(dz, dx)),
    length: Math.hypot(dx, dz),
  };
}

/** Dimmer knob 0..1 with a pointer (COCKPIT LIGHTS panel). */
function dimmer(c: G6kCockpitContext, p: Panel, id: string, label: string, v: string, x: number, y: number, name: string): void {
  p.add(
    new RotaryKnob(c.env, {
      id,
      label,
      cap: 'dimmer',
      diameter: 0.014,
      outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label, format: (x) => (x <= 0.001 ? 'OFF' : x >= 0.999 ? 'BRT' : `${Math.round(x * 100)} %`) },
    }),
    x,
    y,
  );
  p.label(name, x, y - 0.0125, { height: 0.0027 });
}

export interface PedestalResult {
  ems: EmsCduLogic;
}

export function buildPedestal(c: G6kCockpitContext, canvas?: 'dom' | 'offscreen' | DisplayCanvas | null): PedestalResult {
  const { b, env, suite } = c;
  const P = PEDESTAL;
  // ---- forward face: MKP 1 | MKP 2
  const fdx = P.fwdTop[0] - P.fwdBottom[0];
  const fdz = P.fwdBottom[1] - P.fwdTop[1]; // > 0: the forward end is higher (body z down)
  const fwd = b.panel({
    name: 'ped_fwd',
    center_m: [(P.fwdTop[0] + P.fwdBottom[0]) / 2, 0, (P.fwdTop[1] + P.fwdBottom[1]) / 2],
    facing: 'up',
    tiltDeg: -THREE.MathUtils.radToDeg(Math.atan2(fdz, fdx)),
    width: P.width,
    height: Math.hypot(fdx, fdz),
    material: 'panel',
    screws: false,
    radius: 0.008,
  });
  if (suite) {
    addMkp(b, fwd, -0.103, 0, suite, 1);
    addMkp(b, fwd, 0.103, 0, suite, 2);
  }

  // ---- top surface (origin top-left: x right from the left edge, y aft from the forward edge)
  const tp = topPlacement();
  const ped = b.panel({ name: 'pedestal', center_m: tp.center_m, facing: 'up', tiltDeg: tp.tiltDeg, width: P.width, height: tp.length, origin: 'top-left', material: 'panel', screws: { kind: 'dzus', diameter: 0.007, inset: 0.008 } });
  if (suite) {
    addCcp(b, ped, 0.105, 0.085, suite, 1);
    addCcp(b, ped, 0.315, 0.085, suite, 2);
  }

  // ---- thrust levers (GX_01_018: one MAX detent; IDLE; minimum take-off position 30 deg TLA = TLA.toMin, engines.ts)
  const qy = 0.33;
  ped.line(0.12, 0.19, 0.3, 0.19, 0.0006);
  ped.label('THRUST', 0.21, 0.2, { height: 0.0027 });
  const tlDetents = [
    { value: 0, label: 'IDLE' },
    { value: TLA.toMin, label: 'T/O MIN' },
    { value: 1, label: 'MAX', kind: 'gate' as const, direction: 'increasing' as const },
  ];
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    const revVar = V.revLever(i);
    const lv = ped.add(
      new Lever(env, {
        id: `g6k.ped.tl${i}`,
        var: V.tla(i),
        label: `${s} THRUST LEVER`,
        min: 0,
        max: 1,
        detents: tlDetents,
        softWidth: 0.01,
        step: 0.02,
        travel: { kind: 'arc', minDeg: -32, maxDeg: 26, pivotDepth: 0.06 },
        armLength: 0.15,
        armWidth: 0.013,
        knob: 'boeing-thrust',
        knobScale: 1.25,
        knobMaterial: 'chrome',
        detentLabels: i === 1 ? 'left' : 'right',
        axis: { var: INPUT.throttle(i), map: (a) => a },
        // Mechanical interlock: the thrust lever cannot leave IDLE while its reverse lever is raised.
        limit: (vars) => (vars.get(revVar) > 0.02 ? SHUT : OPEN),
        format: (v) => (v <= TLA.idle ? 'IDLE' : v >= 0.995 ? 'MAX' : `${Math.round(v * 45)}° TLA`),
      }),
      i === 1 ? 0.165 : 0.255,
      qy,
    );
    lv.handle.userData.cockpitDynamic = true;
    const L = 0.15;
    const out = i === 1 ? -1 : 1;
    const onHandle = (ctl: PushButton | Lever, pos: [number, number, number], rot: THREE.Euler) => {
      ctl.object.position.set(...pos);
      ctl.object.rotation.copy(rot);
      lv.handle.add(ctl.object);
      for (const h of ctl.hitTargets) h.userData.hitPriority = 1;
      b.add(ctl);
    };
    // A/T disconnect on the outboard end of each grip (thumb), TO/GA on the front of the grip (fingers)
    // (dossier §12.4, GXAF). Grip: 'boeing-thrust' knob 55 x 30 x 38 mm at scale 1.25.
    onHandle(
      new PushButton(env, { id: `g6k.ped.at_disc${i}`, label: `A/T DISC (${s})`, mode: 'momentary', event: G6K_EVENTS.atDisc, style: 'small', width: 0.011, capMaterial: 'knobRed' }),
      [out * 0.0275, 0, L + 0.017],
      new THREE.Euler(0, (out * Math.PI) / 2, 0),
    );
    onHandle(
      new PushButton(env, { id: `g6k.ped.toga${i}`, label: `TO/GA (${s})`, mode: 'momentary', event: G6K_EVENTS.toga, style: 'small', width: 0.01, capMaterial: 'plasticBlack' }),
      [-out * 0.012, 0.0175, L + 0.012],
      new THREE.Euler(-Math.PI / 2, 0, 0),
    );
    // Piggy-back reverse lever on the front of the thrust lever: lifted up and aft, only at thrust lever IDLE and on the
    // ground (dossier §12.4; FADEC limits reverse N1 to 70 %, engines.ts). 0 stowed, ~0.1 IDLE REV, 1 MAX REV.
    const rev = new Lever(env, {
      id: `g6k.ped.rev${i}`,
      var: revVar,
      label: `${s} REVERSE LEVER`,
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: '' },
        { value: 0.1, label: '' },
        { value: 1, label: '' },
      ],
      softWidth: 0.02,
      step: 0.1,
      travel: { kind: 'arc', minDeg: 6, maxDeg: -70, pivotDepth: 0 },
      armLength: 0.07,
      armWidth: 0.008,
      armThickness: 0.005,
      knob: 'reverser',
      knobScale: 0.7,
      armMaterial: 'chrome',
      slot: false,
      detentLabels: false,
      limit: (vars) => (vars.get(V.tla(i)) <= TLA.idle + 0.01 && vars.get('gear.air_ground') !== 0 ? OPEN : SHUT),
      format: (v) => (v < 0.02 ? 'STOWED' : v < 0.15 ? 'IDLE REV' : `REV ${Math.round(v * 100)} %`),
    });
    onHandle(rev, [0, 0.016, L * 0.45], new THREE.Euler(0, 0, 0));
  }

  // ---- FLIGHT SPOILER lever (left of the throttles): RETRACT / 1/4 / 1/2 / FULL / MAX (logic.ts schedule)
  ped.add(
    new Lever(env, {
      id: 'g6k.ped.spoiler',
      var: V.flightSpoiler,
      label: 'FLIGHT SPOILER',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'RET' },
        { value: 0.25, label: '1/4' },
        { value: 0.5, label: '1/2' },
        { value: 0.8, label: 'FULL' },
        { value: 1, label: 'MAX', kind: 'gate', direction: 'increasing' },
      ],
      softWidth: 0.02,
      step: 0.05,
      travel: { kind: 'arc', minDeg: 24, maxDeg: -26, pivotDepth: 0.04 },
      armLength: 0.105,
      knob: 'speedbrake',
      knobMaterial: 'chrome',
      detentLabels: 'right',
    }),
    0.05,
    qy,
  );
  ped.label('FLT SPLR', 0.05, 0.2, { height: 0.0027 });

  // ---- SLAT/FLAP lever (right): 0 IN / 0 OUT / 6 / 16 / 30, gates at 0 OUT and 6 (dossier §12.4, GXFC)
  ped.add(
    new Lever(env, {
      id: 'g6k.ped.flaps',
      var: V.flapLever,
      label: 'SLAT/FLAP',
      min: 0,
      max: 4,
      discrete: true,
      detents: [
        { value: 0, label: '0 IN' },
        { value: 1, label: '0 OUT', kind: 'gate' },
        { value: 2, label: '6', kind: 'gate' },
        { value: 3, label: '16' },
        { value: 4, label: '30' },
      ],
      travel: { kind: 'arc', minDeg: 26, maxDeg: -26, pivotDepth: 0.045 },
      armLength: 0.1,
      knob: 'flap',
      knobMaterial: 'chrome',
      detentLabels: 'left',
      format: (v) => ['0 IN (slats in)', '0 OUT (slats out)', '6', '16', '30'][Math.round(v)] ?? String(v),
    }),
    0.375,
    qy,
  );
  ped.label('SLAT/FLAP', 0.372, 0.2, { height: 0.0027 });

  // ---- ENG RUN switches (lift-lock toggles) and the ENGINE EPR / N1 PBAs
  const ey = 0.5;
  ped.label('ENG RUN', 0.21, ey - 0.032, { height: 0.0028 });
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    ped.add(
      new ToggleSwitch(env, {
        id: `g6k.ped.run${i}`,
        var: V.engRun(i),
        label: `ENG RUN ${s}`,
        positions: ['OFF', 'RUN'],
        values: [0, 1],
        leverLock: true,
        labels: { name: s, positions: true, height: 0.0024 },
        scale: 1.15,
      }),
      i === 1 ? 0.165 : 0.255,
      ey,
    );
    pba(c, ped, { id: `g6k.ped.n1_mode${i}`, label: `${s} ENGINE EPR / N1`, v: V.engN1Mode(i), x: i === 1 ? 0.07 : 0.35, y: ey, segments: [seg.eq('N1', 'white', V.engN1Mode(i), 1)], name: `${s} EPR/N1`, nameBelow: true });
  }

  // ---- TRIM: STAB CH 1 / CH 2 disconnect (guarded), AIL trim split switch, RUD trim rotary
  const ty = 0.585;
  ped.label('STAB TRIM', 0.078, ty - 0.03, { height: 0.0027 });
  for (const n of [1, 2] as const) {
    const x = n === 1 ? 0.052 : 0.104;
    ped.add(
      new GuardedButton(env, {
        id: `g6k.ped.stab_ch${n}`,
        label: `STAB CH ${n}`,
        var: V.stabCh(n),
        mode: 'toggle',
        style: 'korry',
        width: 0.0165,
        height: 0.0165,
        layout: 'stack',
        segments: [seg.on('OFF', 'amber', V.stabCh(n))],
        guard: { color: 'red', hinge: 'top', close: 'free' },
      }),
      x,
      ty,
    );
    ped.label(`CH ${n}`, x, ty + 0.017, { height: 0.0027 });
  }
  ped.add(
    new ToggleSwitch(env, {
      id: 'g6k.ped.ail_trim',
      var: V.ailTrimSw,
      label: 'AIL TRIM',
      positions: ['LWD', '', 'RWD'],
      values: [-1, 0, 1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      orientation: 'horizontal',
      labels: { name: 'AIL TRIM', positions: true, height: 0.0024 },
      scale: 0.9,
    }),
    0.21,
    ty,
  );
  ped.add(
    new SelectorKnob(env, {
      id: 'g6k.ped.rud_trim',
      var: V.rudTrimSw,
      label: 'RUD TRIM',
      cap: 'bar',
      diameter: 0.018,
      labelHeight: 0.0022,
      positions: [
        { value: -1, label: 'NL', angle: -45, spring: 1 },
        { value: 0, label: '', angle: 0 },
        { value: 1, label: 'NR', angle: 45, spring: 1 },
      ],
      initial: 1,
      title: 'RUD TRIM',
    }),
    0.335,
    ty,
  );

  // ---- AUTOBRAKE, GND LIFT DUMPING, EGPWS
  const ay = 0.675;
  ped.add(
    new SelectorKnob(env, {
      id: 'g6k.ped.autobrake',
      var: V.autobrake,
      label: 'AUTOBRAKE',
      cap: 'pointer',
      diameter: 0.016,
      labelHeight: 0.0021,
      positions: [
        { value: 0, label: 'OFF', angle: -60 },
        { value: 1, label: 'LO', angle: -20 },
        { value: 2, label: 'MED', angle: 20 },
        { value: 3, label: 'HI', angle: 60 },
      ],
      initial: 0,
      title: 'AUTOBRAKE',
    }),
    0.062,
    ay,
  );
  ped.label('GND LIFT DUMP', 0.172, ay - 0.026, { height: 0.0027 });
  pba(c, ped, { id: 'g6k.ped.gld_man_arm', label: 'GLD MAN ARM', v: V.gldManArm, x: 0.15, y: ay, segments: [seg.on('ARM', 'white', V.gldManArm)], name: 'MAN ARM', nameBelow: true });
  pba(c, ped, { id: 'g6k.ped.gld_off', label: 'GLD OFF', v: V.gldOff, x: 0.195, y: ay, segments: [seg.on('OFF', 'white', V.gldOff)], name: 'OFF', nameBelow: true });
  ped.label('EGPWS', 0.325, ay - 0.026, { height: 0.0027 });
  pba(c, ped, { id: 'g6k.ped.terr_off', label: 'EGPWS TERR OFF', v: V.terrOff, x: 0.28, y: ay, segments: [seg.on('OFF', 'white', V.terrOff)], name: 'TERR', nameBelow: true });
  pba(c, ped, { id: 'g6k.ped.gs_mute', label: 'G/S WARN MUTED', v: V.gsMute, x: 0.325, y: ay, mode: 'momentary', segments: [seg.on('G/S', 'amber', 'taws.gs_light')], name: 'G/S WARN', nameBelow: true });
  ped.add(
    new GuardedButton(env, {
      id: 'g6k.ped.flap_ovrd',
      label: 'EGPWS FLAP OVRD',
      var: V.flapOvrd,
      mode: 'toggle',
      style: 'korry',
      width: 0.0165,
      height: 0.0165,
      layout: 'stack',
      segments: [seg.on('OVRD', 'white', V.flapOvrd)],
      guard: { color: 'clear', hinge: 'top', close: 'free', var: V.flapOvrdGuard },
    }),
    0.37,
    ay,
  );
  ped.label('FLAP', 0.37, ay - 0.018, { height: 0.0027 });

  // ---- IRS 1 / 2 / 3 mode selectors, DC PWR EMER OVRD
  const iy = 0.765;
  for (const n of [1, 2, 3] as const) {
    ped.add(
      new SelectorKnob(env, {
        id: `g6k.ped.irs${n}`,
        var: V.irsMode(n),
        label: `IRS ${n}`,
        cap: 'pointer',
        diameter: 0.015,
        labelHeight: 0.0021,
        positions: [
          { value: 0, label: 'OFF', angle: -60 },
          { value: 1, label: 'ALN', angle: -20 },
          { value: 2, label: 'NAV', angle: 20 },
          { value: 3, label: 'ATT', angle: 60 },
        ],
        initial: 0,
        title: `IRS ${n}`,
      }),
      0.06 + (n - 1) * 0.1,
      iy,
    );
  }
  ped.add(
    new GuardedButton(env, {
      id: 'g6k.ped.dc_emer_ovrd',
      label: 'DC PWR EMER OVRD',
      var: V.dcEmerOvrd,
      mode: 'toggle',
      style: 'korry',
      width: 0.0165,
      height: 0.0165,
      layout: 'stack',
      segments: [seg.on('OVRD', 'amber', V.dcEmerOvrd)],
      guard: { color: 'red', hinge: 'top', close: 'free', var: V.dcEmerOvrdGuard },
    }),
    0.375,
    iy,
  );
  ped.label('DC PWR', 0.375, iy - 0.022, { height: 0.0027 });
  ped.label('EMER OVRD', 0.375, iy + 0.018, { height: 0.0027 });

  // ---- EMS CDU (left) and COCKPIT LIGHTS (right)
  const ems = addEmsCdu(c, ped, 0.105, 0.885, canvas);
  const lx = [0.245, 0.3, 0.355];
  const ly = 0.845;
  ped.label('COCKPIT LIGHTS', 0.3, ly - 0.03, { height: 0.0027 });
  ped.label('FLOOD', 0.4, ly, { height: 0.0027, align: 'left' });
  ped.label('DISPLAY', 0.4, ly + 0.04, { height: 0.0027, align: 'left' });
  ped.label('INTEGRAL', 0.4, ly + 0.08, { height: 0.0027, align: 'left' });
  const zones = ['l', 'c', 'r'] as const;
  zones.forEach((z, k) => {
    const n = z === 'l' ? 'L' : z === 'c' ? 'CTR' : 'R';
    dimmer(c, ped, `g6k.ped.flood_${z}`, `FLOOD ${n}`, V.ltFlood(z), lx[k], ly + 0.004, n);
    dimmer(c, ped, `g6k.ped.display_${z}`, `DISPLAY ${n}`, V.ltDisplay(z), lx[k], ly + 0.044, n);
    dimmer(c, ped, `g6k.ped.integral_${z}`, `INTEGRAL ${n}`, V.ltIntegral(z), lx[k], ly + 0.084, n);
  });
  dimmer(c, ped, 'g6k.ped.integral_cb', 'INTEGRAL CB', V.ltIntegral('cb'), lx[0], ly + 0.124, 'CB');
  dimmer(c, ped, 'g6k.ped.integral_ovhd', 'INTEGRAL OVHD', V.ltIntegral('ovhd'), lx[1], ly + 0.124, 'OVHD');
  ped.add(
    new ToggleSwitch(env, {
      id: 'g6k.ped.master_dim',
      var: V.ltMaster,
      label: 'MASTER DIM',
      positions: ['OFF', 'DIM', 'BRT'],
      values: [0, 1, 2],
      initial: 2,
      labels: { name: 'MASTER', positions: true, height: 0.0022 },
      scale: 0.8,
    }),
    lx[2],
    ly + 0.126,
  );
  pba(c, ped, { id: 'g6k.ped.lamp_test', label: 'LAMP TEST', v: V.annunTest, x: 0.4, y: ly + 0.126, mode: 'momentary', size: 0.013, segments: [seg.on('TEST', 'white', V.annunTest)], name: 'LAMP TEST', nameBelow: true });

  // ---- PARK/EMER BRAKE handle (left rear): pulled aft; proportional emergency braking below the parking lock (GXLG).
  ped.add(
    new Lever(env, {
      id: 'g6k.ped.park_brake',
      var: V.parkBrake,
      label: 'PARK/EMER BRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'OFF' },
        { value: 1, label: 'PARK', kind: 'gate', direction: 'increasing' },
      ],
      softWidth: 0.02,
      step: 0.1,
      travel: { kind: 'arc', minDeg: 18, maxDeg: -38, pivotDepth: 0.03 },
      armLength: 0.08,
      knob: 'speedbrake',
      knobMaterial: 'chrome',
      detentLabels: 'right',
      format: (v) => (v >= 0.95 ? 'PARK (locked)' : v < 0.02 ? 'OFF' : `EMER ${Math.round(v * 100)} %`),
    }),
    0.035,
    1.0,
  );
  ped.label('PARK/EMER', 0.06, 1.055, { height: 0.0027 });
  ped.label('BRAKE', 0.06, 1.066, { height: 0.0027 });

  // ---- aft face of the pedestal (facing aft, toward the cabin): RAT manual deploy and landing-gear manual release.
  const aftH = FLOOR_Z - P.topAft[1];
  const aft = b.panel({ name: 'ped_aft', center_m: [P.topAft[0] - 0.003, 0, P.topAft[1] + aftH / 2], facing: 'fwd', width: P.width - 0.02, height: aftH - 0.02, material: 'panelDark', screws: false });
  aft.add(new TBarHandle(env, { id: 'g6k.ped.rat_deploy', label: 'RAT MANUAL DEPLOY', var: V.ratDeploy, style: 'tbar', legend: 'RAT', material: 'paintYellow', scale: 1.1 }), 0.1, 0.1);
  aft.label('RAT DEPLOY - PULL', 0.1, 0.155, { height: 0.0027 });
  aft.add(new TBarHandle(env, { id: 'g6k.ped.gear_release', label: 'LDG GEAR MANUAL RELEASE', var: V.gearManRelease, style: 'tbar', legend: 'GEAR', material: 'knobRed', scale: 1.1 }), -0.1, 0.1);
  aft.label('LDG GEAR MAN REL', -0.1, 0.155, { height: 0.0027 });
  return { ems };
}
