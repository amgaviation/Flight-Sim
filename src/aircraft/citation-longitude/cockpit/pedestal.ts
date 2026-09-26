/**
 * Longitude centre pedestal (dossier §7.5 / §7.6, OG Sections 2, 6-13):
 *
 *  forward face  : MFD GTC L (gtc2) and MFD GTC R (gtc3) side by side (BCA "the two center GTC panels").
 *  top, forward  : MFD/GTC dimmer (forward left, OG 16); FUEL group (OG 2-3 "on the right side of the
 *                  pedestal, fore section"); HYDRAULICS group (OG 2-5 "right side fore of the centre
 *                  pedestal"); SPEEDBRAKE handle left of the throttles with FUEL RECIRC under it (OG 2-3);
 *                  thrust levers (TO/GA outboard on each handle, A/T disconnect on the front, A/T arm button
 *                  on the arm facing aft: OG 7-3/7-4 Fig 6-4-1/6-4-2); FLAPS lever on the right (OG 15);
 *                  aileron / rudder trim and the guarded secondary stab trim aft of it.
 *  top, aft      : ENGINE RUN/STOP (guarded) and STARTER buttons "aft of the throttle quadrant" (OG 7-3),
 *                  air conditioning "just aft of the engine start area" (OG 2-4), pressurization "in the
 *                  centre" (OG 11-4), bleed air "at the rear ... middle section" (OG 9-3), APU knob "aft
 *                  right side" (OG 2-3).
 * Detailed positions are EST from photographs.
 */
import * as THREE from 'three';
import { GuardedButton, GuardedSwitch, Lever, PushButton, RotaryKnob, SelectorKnob, ToggleSwitch } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { INPUT } from '../../../core/vars';
import { LON_VARS as V } from '../vars';
import { TLA } from '../systems/logic';
import { seg, type LonCockpitContext } from './context';
import { PEDESTAL } from './layout';
import { addGtc } from './garmin';

function pb(c: LonCockpitContext, panel: Panel, id: string, label: string, v: string, x: number, y: number, segments: ReturnType<typeof seg.eq>[], name?: string, mode: 'toggle' | 'momentary' = 'toggle'): PushButton {
  const btn = panel.add(new PushButton(c.env, { id, label, var: v, mode, style: 'korry', width: 0.0175, height: 0.0175, layout: 'stack', segments }), x, y);
  if (name !== '') panel.label(name ?? label, x, y - 0.0155, { height: 0.0028 });
  return btn;
}

/** Pedestal top panel placement from the layout (facing up, forward end slightly raised). */
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

export function buildPedestal(c: LonCockpitContext): void {
  const { b, env, suite } = c;
  const P = PEDESTAL;
  // ---- forward face: the two MFD GTCs.
  const fdx = P.fwdTop[0] - P.fwdBottom[0];
  const fdz = P.fwdBottom[1] - P.fwdTop[1];
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
  const gdus = c.headless ? null : suite;
  addGtc(c, fwd, 'gtc2', gdus?.gtc('gtc2'), -0.0775, 0.008);
  addGtc(c, fwd, 'gtc3', gdus?.gtc('gtc3'), 0.0775, 0.008);

  // ---- top surface (origin top-left: x right from the left edge, y aft from the forward edge).
  const tp = topPlacement();
  const ped = b.panel({ name: 'pedestal', center_m: tp.center_m, facing: 'up', tiltDeg: tp.tiltDeg, width: P.width, height: tp.length, origin: 'top-left', material: 'panel', screws: { kind: 'dzus', diameter: 0.007, inset: 0.008 } });

  // MFD / GTC dimmer (dual: outer MFD, inner centre GTCs).
  ped.add(
    new RotaryKnob(env, {
      id: 'lon.ped.dim_mfd',
      label: 'MFD / GTC DIM',
      cap: 'dimmer',
      innerCap: 'dimmer',
      diameter: 0.022,
      outer: { var: V.ltMfd, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: 'MFD' },
      inner: { var: V.ltGtcC, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: 'GTC' },
    }),
    0.04,
    0.04,
  );
  ped.label('MFD  GTC', 0.04, 0.018, { height: 0.0026 });

  // ---- FUEL (right fore)
  const fx = 0.225;
  ped.label('FUEL', fx + 0.045, 0.012, { height: 0.0032 });
  pb(c, ped, 'lon.ped.boost_l', 'L FUEL BOOST PUMP', V.boostL, fx, 0.04, [seg.eq('ON', 'amber', V.boostL, 1), seg.eq('NORM', 'cyan', V.boostL, 0)], 'BOOST L');
  pb(c, ped, 'lon.ped.grav_xflow', 'GRAVITY XFLOW', V.gravXflow, fx + 0.045, 0.04, [seg.eq('OPEN', 'white', V.gravXflow, 1), seg.eq('CLOSED', 'cyan', V.gravXflow, 0)], 'GRAV XFLOW');
  pb(c, ped, 'lon.ped.boost_r', 'R FUEL BOOST PUMP', V.boostR, fx + 0.09, 0.04, [seg.eq('ON', 'amber', V.boostR, 1), seg.eq('NORM', 'cyan', V.boostR, 0)], 'BOOST R');
  ped.add(
    new SelectorKnob(env, {
      id: 'lon.ped.fuel_xfer',
      var: V.fuelTransfer,
      label: 'FUEL TRANSFER',
      cap: 'pointer',
      diameter: 0.016,
      labelHeight: 0.002,
      positions: [
        { value: -1, label: 'L TANK', angle: -50 },
        { value: 0, label: 'OFF', angle: 0 },
        { value: 1, label: 'R TANK', angle: 50 },
      ],
      initial: 1,
      title: 'TRANSFER',
    }),
    fx + 0.045,
    0.1,
  );

  // ---- HYDRAULICS (right fore, below fuel)
  const hy = 0.17;
  ped.label('HYDRAULICS', fx + 0.045, hy - 0.033, { height: 0.0030 });
  const pump = (id: string, v: string, name: string, x: number) =>
    ped.add(
      new ToggleSwitch(env, {
        id,
        var: v,
        label: name,
        positions: ['SHUTOFF', 'MIN', 'NORM'],
        values: [2, 1, 0],
        initial: 2,
        leverLock: [0], // EST: SHUTOFF (pump + firewall valve) needs a pull
        labels: { name, positions: true, height: 0.0023 },
        scale: 0.85,
      }),
      x,
      hy,
    );
  pump('lon.ped.hyd_pump_a', V.hydPumpA, 'PUMP A', fx);
  pump('lon.ped.hyd_pump_b', V.hydPumpB, 'PUMP B', fx + 0.09);
  ped.add(
    new SelectorKnob(env, {
      id: 'lon.ped.ptcu',
      var: V.ptcu,
      label: 'PTCU',
      cap: 'pointer',
      diameter: 0.016,
      labelHeight: 0.0018,
      positions: [
        { value: 0, label: 'OFF', angle: -80 },
        { value: 1, label: 'AUX A', angle: -40 },
        { value: 2, label: 'NORM', angle: 0 },
        { value: 3, label: 'AUX B', angle: 40 },
        { value: 4, label: 'HYD GEN', angle: 80 },
      ],
      initial: 2,
      title: 'PTCU',
    }),
    fx + 0.045,
    hy + 0.006,
  );
  pb(c, ped, 'lon.ped.rudder_stby', 'RUDDER STANDBY', V.rudderStby, fx + 0.09, hy + 0.062, [seg.eq('OFF', 'amber', V.rudderStby, 0), seg.eq('NORM', 'cyan', V.rudderStby, 1)], 'RUDDER STBY');

  // ---- thrust levers (continuous, no detents: FADEC picks TO / CLB / CRU by range, OG 7-3; integral reverse
  // through a lift gate at IDLE). Labels mark the FADEC ranges (dossier §7.5, TLA table in systems/logic.ts).
  const tlDetents = [
    { value: -1, label: 'MAX REV' },
    { value: 0, label: 'IDLE', kind: 'gate' as const, direction: 'decreasing' as const },
    { value: TLA.cru, label: 'CRU' },
    { value: TLA.clb, label: 'CLB' },
    { value: 1, label: 'TO' },
  ];
  const tlY = 0.235;
  const levers: Lever[] = [];
  for (const i of [1, 2] as const) {
    const lv = ped.add(
      new Lever(env, {
        id: `lon.ped.tl${i}`,
        var: V.tla(i),
        label: i === 1 ? 'L THRUST LEVER' : 'R THRUST LEVER',
        min: -1,
        max: 1,
        detents: tlDetents,
        softWidth: 0.004,
        step: 0.02,
        travel: { kind: 'arc', minDeg: -42, maxDeg: 28, pivotDepth: 0.06 },
        armLength: 0.15,
        armWidth: 0.013,
        knob: 'throttle',
        knobScale: 1.45,
        detentLabels: i === 1 ? 'left' : 'right',
        axis: { var: INPUT.throttle(i), map: (a) => a },
        format: (v) => (v < -0.01 ? `REV ${Math.round(-v * 100)} %` : v <= TLA.idle ? 'IDLE' : `${Math.round(v * 100)} %`),
      }),
      i === 1 ? 0.115 : 0.175,
      tlY,
    );
    lv.handle.userData.cockpitDynamic = true;
    levers.push(lv);
    // Handle-mounted buttons (ride on the lever). Outboard side: TO/GA; front of the handle: A/T disconnect;
    // aft face of the arm: A/T arm/engage (OG 7-3/7-4).
    const out = i === 1 ? -1 : 1;
    const addOnHandle = (btn: PushButton, pos: [number, number, number], rot: THREE.Euler) => {
      btn.object.position.set(...pos);
      btn.object.rotation.copy(rot);
      lv.handle.add(btn.object);
      for (const h of btn.hitTargets) h.userData.hitPriority = 1;
      b.add(btn);
    };
    const L = 0.15;
    addOnHandle(
      new PushButton(env, { id: `lon.ped.toga${i}`, label: `TO/GA (${i === 1 ? 'L' : 'R'})`, mode: 'momentary', event: 'ap.toga', style: 'small', width: 0.009, capMaterial: 'plasticBlack' }),
      [out * 0.021, 0, L + 0.006],
      new THREE.Euler(0, (out * Math.PI) / 2, 0),
    );
    addOnHandle(
      new PushButton(env, { id: `lon.ped.at_disc${i}`, label: `A/T DISC (${i === 1 ? 'L' : 'R'})`, mode: 'momentary', event: 'at.disc', style: 'small', width: 0.009, capMaterial: 'knobRed' }),
      [0, 0.016, L - 0.004],
      new THREE.Euler(-Math.PI / 2, 0, 0),
    );
    addOnHandle(
      new PushButton(env, { id: `lon.ped.at_arm${i}`, label: `A/T ARM (${i === 1 ? 'L' : 'R'})`, mode: 'momentary', event: 'at.engage', style: 'small', width: 0.008, capMaterial: 'plasticGrey' }),
      [out * 0.009, -0.008, L * 0.55],
      new THREE.Euler(Math.PI / 2, 0, 0),
    );
  }
  void levers;

  // ---- speedbrake handle (left of the throttles): RETRACT .. FULL, continuous (dossier §7.5)
  ped.add(
    new Lever(env, {
      id: 'lon.ped.speedbrake',
      var: V.speedbrake,
      label: 'SPEEDBRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'RET' },
        { value: 0.5, label: '1/2' },
        { value: 1, label: 'FULL' },
      ],
      softWidth: 0.02,
      step: 0.05,
      travel: { kind: 'arc', minDeg: 22, maxDeg: -22, pivotDepth: 0.04 },
      armLength: 0.1,
      knob: 'speedbrake',
      detentLabels: 'left',
    }),
    0.045,
    0.2,
  );
  ped.label('SPEED BRAKE', 0.045, 0.098, { height: 0.0028 });
  pb(c, ped, 'lon.ped.fuel_recirc', 'FUEL RECIRC', V.fuelRecirc, 0.045, 0.31, [seg.eq('OFF', 'white', V.fuelRecirc, 0), seg.eq('NORM', 'cyan', V.fuelRecirc, 1)], 'FUEL RECIRC');

  // ---- flap lever (right): UP / 1 (7) / 2 (15) / FULL (35), OG 15-6
  ped.add(
    new Lever(env, {
      id: 'lon.ped.flaps',
      var: V.flapLever,
      label: 'FLAPS',
      min: 0,
      max: 3,
      discrete: true,
      detents: [
        { value: 0, label: 'UP' },
        { value: 1, label: '1' },
        { value: 2, label: '2' },
        { value: 3, label: 'FULL' },
      ],
      travel: { kind: 'arc', minDeg: 24, maxDeg: -24, pivotDepth: 0.045 },
      armLength: 0.095,
      knob: 'flap',
      detentLabels: 'right',
      format: (v) => ['UP', '1 (7°)', '2 (15°)', 'FULL (35°)'][Math.round(v)] ?? String(v),
    }),
    0.3,
    0.3,
  );
  ped.label('FLAPS', 0.3, 0.232, { height: 0.0030 });

  // ---- trims (aft of the flap lever)
  const ty = 0.405;
  ped.add(
    new ToggleSwitch(env, {
      id: 'lon.ped.ail_trim',
      var: V.ailTrimSw,
      label: 'AILERON TRIM',
      positions: ['LWD', 'OFF', 'RWD'],
      values: [-1, 0, 1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      orientation: 'horizontal',
      labels: { name: 'AIL TRIM', positions: true, height: 0.0023 },
      scale: 0.85,
    }),
    0.23,
    ty,
  );
  ped.add(
    new SelectorKnob(env, {
      id: 'lon.ped.rud_trim',
      var: V.rudTrimSw,
      label: 'RUDDER TRIM',
      cap: 'bar',
      diameter: 0.018,
      labelHeight: 0.0019,
      positions: [
        { value: -1, label: 'NOSE L', angle: -45, spring: 1 },
        { value: 0, label: '', angle: 0 },
        { value: 1, label: 'NOSE R', angle: 45, spring: 1 },
      ],
      initial: 1,
      title: 'RUD TRIM',
    }),
    0.3,
    ty,
  );
  ped.add(
    new GuardedSwitch(env, {
      id: 'lon.ped.stab_sec',
      var: V.stabSecSw,
      label: 'SECONDARY STAB TRIM',
      positions: ['NOSE DN', 'OFF', 'NOSE UP'],
      values: [-1, 0, 1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      labels: { name: 'SEC STAB TRIM', positions: true, height: 0.0023 },
      scale: 0.85,
      guard: { color: 'red', guardedPosition: 1, var: V.stabSecGuard, hinge: 'top' },
    }),
    0.3,
    ty + 0.07,
  );

  // ---- ENGINE: RUN/STOP (guarded) and STARTER (OG 7-3)
  const ey = 0.53;
  ped.label('ENGINE', 0.18, ey - 0.04, { height: 0.0032 });
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    const outX = i === 1 ? 0.045 : 0.315;
    const inX = i === 1 ? 0.115 : 0.245;
    ped.add(
      new GuardedButton(env, {
        id: `lon.ped.run_${s.toLowerCase()}`,
        label: `${s} ENGINE RUN/STOP`,
        var: i === 1 ? V.runL : V.runR,
        mode: 'toggle',
        style: 'korry',
        width: 0.019,
        height: 0.019,
        layout: 'stack',
        segments: [seg.eq('RUN', 'green', i === 1 ? V.runL : V.runR, 1), seg.eq('STOP', 'white', i === 1 ? V.runL : V.runR, 0)],
        guard: { color: 'red', hinge: 'top', close: 'free', var: i === 1 ? V.runGuardL : V.runGuardR },
      }),
      outX,
      ey,
    );
    ped.label(`${s} RUN/STOP`, outX, ey - 0.022, { height: 0.0025 });
    pb(c, ped, `lon.ped.start_${s.toLowerCase()}`, `${s} ENGINE STARTER`, i === 1 ? V.startL : V.startR, inX, ey, [seg.on('START', 'white', `fadec.eng${i}.starter_cmd`)], `${s} START`, 'momentary');
  }

  // ---- AIR CONDITIONING (aft of the start area, OG 10-3)
  const ay = 0.615;
  ped.label('AIR CONDITIONING', 0.18, ay - 0.038, { height: 0.0029 });
  const temp = (id: string, v: string, name: string, x: number) =>
    ped.add(
      new RotaryKnob(env, {
        id,
        label: name,
        cap: 'pointer',
        diameter: 0.016,
        outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [-150, 150], label: name, format: (x) => (x < 0.025 ? 'NORM' : `MAN ${Math.round(x * 100)} %`) },
      }),
      x,
      ay,
    );
  temp('lon.ped.cabin_temp', V.cabinTempKnob, 'CABIN TEMP', 0.045);
  temp('lon.ped.ckpt_temp', V.ckptTempKnob, 'CKPT TEMP', 0.11);
  ped.label('CABIN', 0.045, ay - 0.018, { height: 0.0024 });
  ped.label('CKPT', 0.11, ay - 0.018, { height: 0.0024 });
  ped.label('NORM  COLD-HOT', 0.078, ay + 0.02, { height: 0.0020 });
  ped.add(
    new SelectorKnob(env, {
      id: 'lon.ped.ecs',
      var: V.ecsMode,
      label: 'ECS',
      cap: 'pointer',
      diameter: 0.016,
      labelHeight: 0.0017,
      positions: [
        { value: 0, label: 'NORM', angle: -40 },
        { value: 1, label: 'ACM ONLY', angle: 0 },
        { value: 2, label: 'HX ONLY', angle: 40 },
      ],
      initial: 0,
      title: 'ECS',
    }),
    0.2,
    ay + 0.004,
  );
  pb(c, ped, 'lon.ped.flow', 'FLOW', V.flow, 0.29, ay, [seg.eq('HIGH', 'white', V.flow, 1), seg.eq('NORM', 'cyan', V.flow, 0)], 'FLOW');

  // ---- PRESSURIZATION (centre, OG 11-4) and the APU knob (aft right)
  const py = 0.69;
  ped.label('PRESSURIZATION', 0.1, py - 0.036, { height: 0.0029 });
  ped.add(
    new ToggleSwitch(env, {
      id: 'lon.ped.cabin_alt',
      var: V.cabinAltSw,
      label: 'CABIN ALT',
      positions: ['DN', '', 'UP'],
      values: [-1, 0, 1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      labels: { name: 'CABIN ALT', positions: true, height: 0.0023 },
      scale: 0.85,
    }),
    0.04,
    py,
  );
  pb(c, ped, 'lon.ped.press_mode', 'PRESS MODE', V.pressMode, 0.1, py, [seg.eq('MAN', 'amber', V.pressMode, 1), seg.eq('NORM', 'cyan', V.pressMode, 0)], 'PRESS MODE');
  ped.add(
    new GuardedButton(env, {
      id: 'lon.ped.cabin_dump',
      label: 'CABIN DUMP',
      var: V.pressDump,
      mode: 'toggle',
      style: 'korry',
      width: 0.0175,
      height: 0.0175,
      layout: 'stack',
      segments: [seg.eq('DUMP', 'amber', V.pressDump, 1), seg.eq('NORM', 'cyan', V.pressDump, 0)],
      guard: { color: 'red', hinge: 'top', close: 'free', var: V.pressDumpGuard },
    }),
    0.16,
    py,
  );
  ped.label('CABIN DUMP', 0.16, py - 0.021, { height: 0.0025 });
  ped.add(
    new SelectorKnob(env, {
      id: 'lon.ped.apu',
      var: V.apuKnob,
      label: 'APU',
      cap: 'bar',
      diameter: 0.02,
      labelHeight: 0.0021,
      positions: [
        { value: 0, label: 'OFF', angle: -45 },
        { value: 1, label: 'ON', angle: 0 },
        { value: 2, label: 'START', angle: 45, spring: 1 },
      ],
      initial: 0,
      title: 'APU',
    }),
    0.3,
    py + 0.004,
  );

  // ---- BLEED AIR (rear, middle, OG 9-3)
  const by = 0.775;
  ped.label('BLEED AIR', 0.16, by - 0.036, { height: 0.0029 });
  const norm = (v: string) => [seg.eq('OFF', 'amber', v, 0), seg.eq('NORM', 'cyan', v, 1)];
  pb(c, ped, 'lon.ped.bleed_l', 'L ENG BLD AIR', V.bleedEngL, 0.035, by, norm(V.bleedEngL), 'ENG L');
  pb(c, ped, 'lon.ped.press_src_l', 'L PRESS SOURCE', V.pressSrcL, 0.08, by, norm(V.pressSrcL), 'PRESS L');
  pb(c, ped, 'lon.ped.bleed_apu', 'APU BLEED', V.bleedApu, 0.135, by, norm(V.bleedApu), 'APU');
  pb(c, ped, 'lon.ped.bleed_iso', 'BLEED ISOLATE', V.bleedIsolate, 0.18, by, [seg.eq('XFLOW', 'white', V.bleedIsolate, 1), seg.eq('NORM', 'cyan', V.bleedIsolate, 0)], 'ISOLATE');
  pb(c, ped, 'lon.ped.press_src_r', 'R PRESS SOURCE', V.pressSrcR, 0.235, by, norm(V.pressSrcR), 'PRESS R');
  pb(c, ped, 'lon.ped.bleed_r', 'R ENG BLD AIR', V.bleedEngR, 0.28, by, norm(V.bleedEngR), 'ENG R');
}
