/**
 * Longitude centre pedestal (dossier §7.5 / §7.6, OG Sections 2, 6-13), laid out from the Textron pedestal
 * photographs (_pedfwd, _pedaft, measured at ~0.52 / 0.41 mm per px across the 0.36 m pedestal) and the AOPA 2021
 * close-ups (c_ped21, c_pedA2, c_pedFL2). Plate coordinates: x right from the left edge, y aft from the forward edge.
 *
 *  nose            : MFD GTC L (gtc2) and MFD GTC R (gtc3) in a satin silver-grey surround (L47).
 *  forward left    : MFD / GTCs dimmer, STABILIZER PRIMARY TRIM CHANNEL SELECT, SECONDARY TRIM (yellow frame) with
 *                    the NOSE DOWN / NOSE UP rocker, AUTO GROUND SPOILERS, STANDBY YAW DAMP (L36/L37).
 *  quadrant        : SPEEDBRAKE (RET .. EXT wedge scale), thrust levers with horizontal cylindrical grips (TO/GA on
 *                    the outboard end, AT DISC on the inboard top, AT paddle on the arm; L32/L33), FUEL RECIRC PUMP.
 *  forward right   : HYDRAULIC PUMP A / B, POWER TRANSFER (PTCU knob), RUDDER STANDBY, then FUEL: BOOST PUMP L / R,
 *                    GRAVITY XFLOW, TRANSFER (L34/L35).
 *  aft left        : EMER / PARK BRAKE lever (red / white grip) and CONTROL LOCK lever (L22/L42).
 *  aft centre      : ENGINE (RUN/STOP L, STARTER L / R, RUN/STOP R), PRESSURIZATION / ECS / bleed grid with the
 *                    duct mimic (L45/L46), COCKPIT VOICE RECORDER row (L43), storage bin.
 *  aft right       : FLAP lever and FLAP RESET (L39), APU box with EVENT MARKER (L44).
 *  aft end         : aileron / rudder trim (EST: not visible in the photographs, L40); PITCH/ROLL DISCONNECT handle
 *                    on the aft face (EST mount, AOPA a21_006, L41).
 */
import * as THREE from 'three';
import { GuardedButton, Lever, PushButton, RockerSwitch, RotaryKnob, SelectorKnob, ToggleSwitch, AnnunciatorLight } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { bl } from '../../../cockpit/frame';
import { INPUT } from '../../../core/vars';
import { LON_VARS as V } from '../vars';
import { TLA } from '../systems/logic';
import { lonMaterials, seg, type LonCockpitContext } from './context';
import { PEDESTAL } from './layout';
import { addGtc } from './garmin';
import { PitchRollHandle } from './controls';

/** Pedestal switchlight (c_ped21 / _pedaft: ~22 mm caps). */
const PB = 0.021;

function pb(c: LonCockpitContext, panel: Panel, id: string, label: string, v: string, x: number, y: number, segments: ReturnType<typeof seg.eq>[], name?: string, mode: 'toggle' | 'momentary' = 'toggle'): PushButton {
  const btn = panel.add(new PushButton(c.env, { id, label, var: v, mode, style: 'korry', width: PB, height: PB * 0.85, layout: 'stack', unlitTint: 0.05, segments }), x, y);
  if (name !== '') panel.label(name ?? label, x, y - 0.0155, { height: 0.0026 });
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

/** Red / white striped grip material (EMER / PARK BRAKE, _pedaft). DataTexture: no canvas needed (headless). */
function stripeMaterial(c: LonCockpitContext): THREE.MeshStandardMaterial {
  const n = 16;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const red = i % 2 === 0;
    data.set(red ? [200, 24, 20, 255] : [236, 236, 232, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, 1, n);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
  m.name = 'lon.stripes';
  c.env.materials.track(m);
  return m;
}

export function buildPedestal(c: LonCockpitContext): void {
  const { b, env, suite } = c;
  const M = lonMaterials(env);
  const P = PEDESTAL;
  // ---- nose: the two MFD GTCs in the silver-grey surround.
  const fdx = P.fwdTop[0] - P.fwdBottom[0];
  const fdz = P.fwdBottom[1] - P.fwdTop[1];
  const fwd = b.panel({
    name: 'ped_fwd',
    center_m: [(P.fwdTop[0] + P.fwdBottom[0]) / 2, 0, (P.fwdTop[1] + P.fwdBottom[1]) / 2],
    facing: 'up',
    tiltDeg: -THREE.MathUtils.radToDeg(Math.atan2(fdz, fdx)),
    width: P.width,
    height: Math.hypot(fdx, fdz),
    material: M.silver,
    screws: false,
    radius: 0.008,
  });
  const gdus = c.headless ? null : suite;
  addGtc(c, fwd, 'gtc2', gdus?.gtc('gtc2'), -0.0775, 0.008);
  addGtc(c, fwd, 'gtc3', gdus?.gtc('gtc3'), 0.0775, 0.008);

  const tp = topPlacement();
  const ped = b.panel({ name: 'pedestal', center_m: tp.center_m, facing: 'up', tiltDeg: tp.tiltDeg, width: P.width, height: tp.length, origin: 'top-left', material: M.deck, screws: { kind: 'hex', diameter: 0.004, inset: 0.008 } });
  bolsters(c, tp.length);
  forwardLeft(c, ped);
  quadrant(c, ped);
  forwardRight(c, ped);
  aftLeft(c, ped);
  engineAndPressurization(c, ped);
  aftRight(c, ped);
  aftEnd(c, ped, tp.length);
}

/** Rounded black side rails along both top edges (L47, _pedfwd / _pedaft). */
function bolsters(c: LonCockpitContext, len: number): void {
  const M = lonMaterials(c.env);
  const P = PEDESTAL;
  for (const side of [-1, 1]) {
    const y = side * (P.width / 2 + 0.012);
    const p0 = bl(P.topFwd[0] + 0.03, y, P.topFwd[1] - 0.006);
    const p1 = bl(P.topAft[0], y, P.topAft[1] - 0.006);
    const dir = p1.clone().sub(p0);
    const g = new THREE.CylinderGeometry(0.02, 0.02, dir.length() + 0.03, 20);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.scale(0.8, 1, 1); // flattened rail
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const m = c.b.structureMesh(g, M.trim);
    m.position.copy(mid);
    m.name = 'ped_bolster';
  }
  void len;
}

/** Forward left column (x ~0.043, c_pedFL2 / _pedfwd). */
function forwardLeft(c: LonCockpitContext, ped: Panel): void {
  const { env } = c;
  const x = 0.043;
  ped.line(0.082, 0.004, 0.082, 0.3, 0.0008);
  // MFD / GTCs dimmer (outer MFD, inner centre GTCs), OFF arc (OG Fig 16-2-2).
  ped.add(
    new RotaryKnob(env, {
      id: 'lon.ped.dim_mfd',
      label: 'MFD / GTCs DIM',
      cap: 'dimmer',
      innerCap: 'dimmer',
      diameter: 0.02,
      outer: { var: V.ltMfd, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: 'MFD' },
      inner: { var: V.ltGtcC, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: 'GTCs' },
    }),
    x,
    0.024,
  );
  ped.label('MFD', x - 0.017, 0.01, { height: 0.0024 });
  ped.label('GTCs', x + 0.018, 0.01, { height: 0.0024 });
  ped.label('OFF', x - 0.016, 0.037, { height: 0.0019 });
  ped.line(0.004, 0.044, 0.082, 0.044, 0.0008);
  // STABILIZER PRIMARY TRIM CHANNEL SELECT: each push alternates the active primary channel (EST legend CH 1 / CH 2).
  ped.label('STABILIZER', x, 0.049, { height: 0.0023 });
  ped.label('PRIMARY TRIM', x, 0.0535, { height: 0.0023 });
  ped.label('CHANNEL SELECT', x, 0.058, { height: 0.0023 });
  ped.add(
    new PushButton(env, {
      id: 'lon.ped.stab_chan',
      label: 'STAB PRI TRIM CHANNEL SELECT',
      var: V.stabChan,
      mode: 'cycle',
      values: [1, 2],
      stateNames: ['CH 1', 'CH 2'],
      style: 'korry',
      width: PB,
      height: PB * 0.85,
      layout: 'stack',
      unlitTint: 0.05,
      segments: [seg.eq('CH 1', 'cyan', V.stabChan, 1), seg.eq('CH 2', 'cyan', V.stabChan, 2)],
    }),
    x,
    0.071,
  );
  // SECONDARY TRIM switchlight in a yellow frame (c_pedFL2) and the NOSE DOWN / NOSE UP rocker below it.
  ped.label('SECONDARY TRIM', x, 0.087, { height: 0.0023 });
  ped.subPanel({ name: 'sec_trim_frame', x, y: 0.101, width: PB + 0.008, height: PB * 0.85 + 0.008, material: 'guardYellow', screws: false, radius: 0.002, thickness: 0.002 });
  ped.add(
    new PushButton(env, {
      id: 'lon.ped.stab_sec_arm',
      label: 'SECONDARY TRIM',
      var: V.stabSecArm,
      mode: 'toggle',
      style: 'korry',
      width: PB,
      height: PB * 0.85,
      layout: 'stack',
      unlitTint: 0.05,
      segments: [seg.eq('NORM', 'cyan', V.stabSecArm, 0), seg.eq('ENGAGED', 'amber', V.stabSecArm, 1)],
    }),
    x,
    0.101,
    { z: 0.002 },
  );
  ped.label('NOSE DOWN', x, 0.118, { height: 0.0022 });
  ped.add(
    new RockerSwitch(env, {
      id: 'lon.ped.stab_sec',
      var: V.stabSecSw,
      label: 'SECONDARY STAB TRIM NOSE DN / UP',
      positions: ['NOSE UP', 'OFF', 'NOSE DN'],
      values: [1, 0, -1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      width: 0.018,
      height: 0.028,
    }),
    x,
    0.137,
  );
  ped.label('NOSE UP', x, 0.157, { height: 0.0022 });
  // AUTO GROUND SPOILERS (dark when armed, c_pedFL2; EST lower legend OFF amber when disarmed).
  ped.bracket('AUTO GROUND SPOILERS', x, 0.168, 0.074, { height: 0.002 });
  pb(c, ped, 'lon.ped.auto_gnd_splr', 'AUTO GROUND SPOILERS', V.autoGndSplr, x, 0.183, [seg.eq('OFF', 'amber', V.autoGndSplr, 0)], '');
  ped.line(0.004, 0.198, 0.082, 0.198, 0.0008);
  // STANDBY YAW DAMP (EST legends: NORM cyan / ON white).
  ped.label('STANDBY YAW DAMP', x, 0.206, { height: 0.0023 });
  pb(c, ped, 'lon.ped.stby_yd', 'STANDBY YAW DAMP', V.stbyYd, x, 0.222, [seg.eq('NORM', 'cyan', V.stbyYd, 0), seg.eq('ON', 'white', V.stbyYd, 1)], '');
}

/** Speedbrake, thrust levers and FUEL RECIRC PUMP (throttle quadrant). */
function quadrant(c: LonCockpitContext, ped: Panel): void {
  const { b, env } = c;
  const M = lonMaterials(env);
  // ---- SPEEDBRAKE: continuous RET (forward) .. EXT (aft) with the wedge scale and vertical engraving (OG Fig 15-4-2).
  const sbx = 0.1;
  ped.add(
    new Lever(env, {
      id: 'lon.ped.speedbrake',
      var: V.speedbrake,
      label: 'SPEEDBRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'RET' },
        { value: 1, label: 'EXT' },
      ],
      softWidth: 0.02,
      step: 0.05,
      travel: { kind: 'arc', minDeg: 22, maxDeg: -22, pivotDepth: 0.04 },
      armLength: 0.1,
      knob: 'cylinder-grip',
      knobScale: 0.55,
      detentLabels: 'left',
    }),
    sbx,
    0.12,
  );
  // Wedge (thin at RET, wide at EXT) and the vertical SPEEDBRAKE engraving.
  for (let k = 0; k < 8; k++) {
    const yy = 0.09 + k * 0.009;
    ped.line(sbx - 0.019 - k * 0.0009, yy, sbx - 0.019, yy, 0.0012);
  }
  const letters = 'SPEEDBRAKE';
  for (let i = 0; i < letters.length; i++) ped.label(letters[i], sbx + 0.017, 0.075 + i * 0.0055, { height: 0.0028 });
  // ---- thrust levers (continuous, FADEC picks TO / CLB / CRU by range, OG 7-3; integral reverse through a lift gate
  // at IDLE). Labels mark the FADEC ranges (TLA table in systems/logic.ts).
  const tlDetents = [
    { value: -1, label: 'MAX REV' },
    { value: 0, label: 'IDLE', kind: 'gate' as const, direction: 'decreasing' as const },
    { value: TLA.cru, label: 'CRU' },
    { value: TLA.clb, label: 'CLB' },
    { value: 1, label: 'TO' },
  ];
  const tlY = 0.16;
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
        armWidth: 0.014,
        armMaterial: M.silver,
        knob: 'cylinder-grip',
        detentLabels: i === 1 ? 'left' : 'right',
        axis: { var: INPUT.throttle(i), map: (a) => a },
        // CONTROL LOCK engaged: the gust-lock linkage holds the levers at idle (EST interlock, logic.ts).
        limit: (v) => (v.get(V.controlLock) !== 0 ? [-1, TLA.idle] : [-1, 1]),
        format: (v) => (v < -0.01 ? `REV ${Math.round(-v * 100)} %` : v <= TLA.idle ? 'IDLE' : `${Math.round(v * 100)} %`),
      }),
      i === 1 ? 0.152 : 0.218,
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
    const L = 0.15;
    const gz = L + 0.0149; // grip axis (cylinder-grip r 16.5 mm)
    const s = i === 1 ? 'L' : 'R';
    // TO/GA: outboard end of the grip (OG Fig 6-4-1/6-4-2).
    addOnHandle(
      new PushButton(env, { id: `lon.ped.toga${i}`, label: `TO/GA (${s})`, mode: 'momentary', event: 'ap.toga', style: 'round', width: 0.014, capMaterial: 'plasticBlack', engraved: 'TO/GA', engravedHeight: 0.0018 }),
      [out * 0.0335, 0, gz],
      new THREE.Euler(0, (out * Math.PI) / 2, 0),
    );
    // AT DISC: inboard top of the grip, black cap with an arrow.
    addOnHandle(
      new PushButton(env, { id: `lon.ped.at_disc${i}`, label: `AT DISC (${s})`, mode: 'momentary', event: 'at.disc', style: 'small', width: 0.011, capMaterial: 'plasticBlack', engraved: '▼', engravedHeight: 0.004 }),
      [-out * 0.018, 0, gz + 0.0165],
      new THREE.Euler(0, 0, 0),
    );
    // AT paddle on the outboard side of the arm (arm / engage the autothrottle), engraved AT.
    addOnHandle(
      new PushButton(env, { id: `lon.ped.at_arm${i}`, label: `AT PADDLE (${s})`, mode: 'momentary', event: 'at.engage', style: 'key', width: 0.012, height: 0.018, capMaterial: 'plasticBlack', engraved: 'AT', engravedHeight: 0.003 }),
      [out * 0.009, 0, L * 0.72],
      new THREE.Euler(0, (out * Math.PI) / 2, 0),
    );
  }
  ped.label('AT DISC', 0.185, 0.035, { height: 0.0024 });
  // FUEL RECIRC PUMP (OG 2-3: under the speedbrake handle).
  pb(c, ped, 'lon.ped.fuel_recirc', 'FUEL RECIRC PUMP', V.fuelRecirc, 0.1, 0.262, [seg.eq('NORM', 'cyan', V.fuelRecirc, 1), seg.eq('OFF', 'white', V.fuelRecirc, 0)], 'FUEL RECIRC PUMP');
}

/** Forward right column (x ~0.3): hydraulics, power transfer, rudder standby, fuel (L34/L35; c_ped21, _pedfwd). */
function forwardRight(c: LonCockpitContext, ped: Panel): void {
  const { env } = c;
  const x = 0.3;
  ped.line(0.262, 0.004, 0.262, 0.3, 0.0008);
  // HYDRAULIC PUMP A / B: NORM (up) / MIN / SHUTOFF (down, lever-locked); MIN engraved between the toggles.
  ped.bracket('HYDRAULIC PUMP', x, 0.01, 0.07, { height: 0.0022 });
  const pump = (id: string, v: string, name: string, px: number) => {
    ped.add(
      new ToggleSwitch(env, {
        id,
        var: v,
        label: `HYDRAULIC PUMP ${name}`,
        positions: ['SHUTOFF', 'MIN', 'NORM'],
        values: [2, 1, 0],
        initial: 2,
        leverLock: [0], // EST: SHUTOFF (pump + firewall valve) needs a pull
        labels: { name: false, positions: false },
        scale: 0.8,
      }),
      px,
      0.034,
    );
    ped.label(name, px, 0.016, { height: 0.0024 });
    ped.label('NORM', px, 0.021, { height: 0.002 });
    ped.label('SHUTOFF', px, 0.049, { height: 0.002 });
  };
  pump('lon.ped.hyd_pump_a', V.hydPumpA, 'A', x - 0.018);
  pump('lon.ped.hyd_pump_b', V.hydPumpB, 'B', x + 0.018);
  const mid = 'MIN';
  for (let i = 0; i < mid.length; i++) ped.label(mid[i], x, 0.029 + i * 0.0045, { height: 0.0022 });
  // POWER TRANSFER (PTCU). SCOPE / photo conflict: the Textron photograph shows two switchlights under a POWER TRANSFER
  // bracket (legends not legible); the OG (Fig 6-3-1, 13-3) describes a PTCU knob OFF / AUX A / NORM / AUX B / HYD GEN,
  // whose functions are modelled (logic.ts). The knob is kept under the photograph's bracket.
  ped.bracket('POWER TRANSFER', x, 0.058, 0.07, { height: 0.0021 });
  ped.add(
    new SelectorKnob(env, {
      id: 'lon.ped.ptcu',
      var: V.ptcu,
      label: 'PTCU (POWER TRANSFER)',
      cap: 'pointer',
      diameter: 0.014,
      labelHeight: 0.0016,
      positions: [
        { value: 0, label: 'OFF', angle: -90 },
        { value: 1, label: 'AUX A', angle: -45 },
        { value: 2, label: 'NORM', angle: 0 },
        { value: 3, label: 'AUX B', angle: 45 },
        { value: 4, label: 'HYD GEN', angle: 90 },
      ],
      initial: 2,
    }),
    x,
    0.083,
  );
  ped.label('RUDDER STANDBY', x, 0.108, { height: 0.0022 });
  pb(c, ped, 'lon.ped.rudder_stby', 'RUDDER STANDBY', V.rudderStby, x, 0.122, [seg.eq('NORM', 'cyan', V.rudderStby, 1), seg.eq('OFF', 'amber', V.rudderStby, 0)], '');
  // FUEL: BOOST PUMP L / R (NORM cyan upper), GRAVITY XFLOW (OPEN upper / CLOSED cyan lower), TRANSFER knob.
  ped.line(0.266, 0.14, 0.352, 0.14, 0.0008);
  ped.label('FUEL', x, 0.145, { height: 0.0028 });
  ped.bracket('BOOST PUMP', x, 0.153, 0.064, { height: 0.0021 });
  ped.label('L', x - 0.014, 0.159, { height: 0.0023 });
  ped.label('R', x + 0.014, 0.159, { height: 0.0023 });
  pb(c, ped, 'lon.ped.boost_l', 'L FUEL BOOST PUMP', V.boostL, x - 0.0135, 0.172, [seg.eq('NORM', 'cyan', V.boostL, 0), seg.eq('ON', 'amber', V.boostL, 1)], '');
  pb(c, ped, 'lon.ped.boost_r', 'R FUEL BOOST PUMP', V.boostR, x + 0.0135, 0.172, [seg.eq('NORM', 'cyan', V.boostR, 0), seg.eq('ON', 'amber', V.boostR, 1)], '');
  ped.label('GRAVITY XFLOW', x, 0.19, { height: 0.0022 });
  pb(c, ped, 'lon.ped.grav_xflow', 'GRAVITY XFLOW', V.gravXflow, x, 0.204, [seg.eq('OPEN', 'white', V.gravXflow, 1), seg.eq('CLOSED', 'cyan', V.gravXflow, 0)], '');
  ped.add(
    new SelectorKnob(env, {
      id: 'lon.ped.fuel_xfer',
      var: V.fuelTransfer,
      label: 'FUEL TRANSFER',
      cap: 'pointer',
      diameter: 0.017,
      labelHeight: 0.0019,
      positions: [
        { value: -1, label: 'L TANK', angle: -60 },
        { value: 0, label: 'OFF', angle: 0 },
        { value: 1, label: 'R TANK', angle: 60 },
      ],
      initial: 1,
      title: 'TRANSFER',
    }),
    x,
    0.245,
  );
  ped.label('TRANSFER', x, 0.226, { height: 0.0023 });
}

/** EMER / PARK BRAKE (L22) and CONTROL LOCK (L42) levers at the aft left (_pedaft, c_pedA2). */
function aftLeft(c: LonCockpitContext, ped: Panel): void {
  const { env } = c;
  const M = lonMaterials(env);
  // Slotted recess (dark) behind the park-brake lever.
  ped.subPanel({ name: 'park_recess', x: 0.058, y: 0.45, width: 0.05, height: 0.2, material: M.trim, screws: false, radius: 0.012, thickness: 0.002 });
  ped.label('EMER / PARK BRAKE', 0.06, 0.335, { height: 0.0026 });
  ped.add(
    new Lever(env, {
      id: 'lon.ped.park_brake',
      var: V.parkBrake,
      label: 'EMER / PARK BRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'OFF' },
        { value: 1, label: 'PARK' },
      ],
      softWidth: 0.08,
      step: 0.1,
      travel: { kind: 'arc', minDeg: 30, maxDeg: -25, pivotDepth: 0.03 },
      armLength: 0.07,
      armWidth: 0.012,
      armMaterial: 'handleBlack',
      knob: 'condition',
      knobScale: 1.5,
      knobMaterial: stripeMaterial(c),
      slot: { width: 0.012, plateWidth: 0.03 },
      detentLabels: 'right',
    }),
    0.058,
    0.45,
    { z: 0.002 },
  );
  // CONTROL LOCK: UNLOCK (forward / up) .. LOCK (aft / down). Can only be engaged with both thrust levers at idle.
  ped.label('UNLOCK', 0.075, 0.615, { height: 0.0024, align: 'left' });
  const letters = 'CONTROL LOCK';
  for (let i = 0; i < letters.length; i++) if (letters[i] !== ' ') ped.label(letters[i], 0.086, 0.628 + i * 0.0068, { height: 0.0028 });
  ped.label('LOCK', 0.075, 0.718, { height: 0.0024, align: 'left' });
  ped.add(
    new Lever(env, {
      id: 'lon.ped.control_lock',
      var: V.controlLock,
      label: 'CONTROL LOCK',
      min: 0,
      max: 1,
      discrete: true,
      detents: [
        { value: 0, label: '' },
        { value: 1, label: '' },
      ],
      travel: { kind: 'arc', minDeg: 20, maxDeg: -20, pivotDepth: 0.06 },
      armLength: 0.06,
      knob: 'speedbrake',
      knobScale: 1.2,
      limit: (v) => (Math.abs(v.get(V.tla(1))) > TLA.idle || Math.abs(v.get(V.tla(2))) > TLA.idle ? [0, v.get(V.controlLock)] : [0, 1]),
      format: (v) => (v >= 0.5 ? 'LOCK' : 'UNLOCK'),
    }),
    0.05,
    0.67,
  );
}

/** ENGINE start block, PRESSURIZATION / ECS / bleed grid with the duct mimic, COCKPIT VOICE RECORDER, storage bin. */
function engineAndPressurization(c: LonCockpitContext, ped: Panel): void {
  const { env } = c;
  const M = lonMaterials(env);
  // ---- ENGINE: L RUN/STOP | STARTER L R | R RUN/STOP (_pedaft; OG Fig 6-3-1). Clear guards, RUN cyan.
  const ey = 0.356;
  ped.bracket('ENGINE', 0.206, 0.33, 0.15, { height: 0.0026 });
  ped.label('L', 0.151, 0.338, { height: 0.0026 });
  ped.label('R', 0.261, 0.338, { height: 0.0026 });
  ped.bracket('STARTER', 0.206, 0.338, 0.06, { height: 0.0022 });
  ped.label('L', 0.188, 0.344, { height: 0.0023 });
  ped.label('R', 0.224, 0.344, { height: 0.0023 });
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    const outX = i === 1 ? 0.151 : 0.261;
    const inX = i === 1 ? 0.188 : 0.224;
    ped.add(
      new GuardedButton(env, {
        id: `lon.ped.run_${s.toLowerCase()}`,
        label: `${s} ENGINE RUN/STOP`,
        var: i === 1 ? V.runL : V.runR,
        mode: 'toggle',
        style: 'korry',
        width: PB,
        height: PB * 0.85,
        layout: 'stack',
        unlitTint: 0.05,
        segments: [seg.eq('RUN', 'cyan', i === 1 ? V.runL : V.runR, 1), seg.eq('STOP', 'white', i === 1 ? V.runL : V.runR, 0)],
        guard: { color: 'clear', hinge: 'top', close: 'free', var: i === 1 ? V.runGuardL : V.runGuardR },
      }),
      outX,
      ey,
    );
    pb(c, ped, `lon.ped.start_${s.toLowerCase()}`, `${s} ENGINE STARTER`, i === 1 ? V.startL : V.startR, inX, ey, [seg.on('START', 'white', `fadec.eng${i}.starter_cmd`)], '', 'momentary');
  }
  ped.line(0.118, 0.378, 0.292, 0.378, 0.0008);
  // ---- PRESSURIZATION block. Photo (_pedaft) vs OG conflict recorded: the Textron photograph shows CKPT TEMP left /
  // CABIN TEMP right and HEAT EXCHG ONLY left / ACM ONLY right of the ECS knob; the OG MSFS art shows CABIN left /
  // CKPT right and ACM left / HEAT EXCHG right. The photograph is followed.
  ped.bracket('PRESSURIZATION', 0.207, 0.386, 0.16, { height: 0.0026 });
  const ay = 0.414;
  const temp = (id: string, v: string, name: string, x: number) => {
    ped.add(
      new RotaryKnob(env, {
        id,
        label: name,
        cap: 'pointer',
        diameter: 0.016,
        outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [0, 150], label: name, format: (t) => (t < 0.025 ? 'NORM' : `MANUAL ${Math.round(t * 100)} %`) },
      }),
      x,
      ay,
    );
    ped.label(name, x, ay - 0.021, { height: 0.0022 });
    ped.label('NORM', x, ay - 0.0155, { height: 0.0018 });
    ped.label('COLD', x - 0.019, ay + 0.002, { height: 0.0018 });
    ped.label('HOT', x + 0.018, ay + 0.002, { height: 0.0018 });
    ped.label('MANUAL', x + 0.012, ay + 0.017, { height: 0.0018 });
  };
  temp('lon.ped.ckpt_temp', V.ckptTempKnob, 'CKPT TEMP', 0.157);
  temp('lon.ped.cabin_temp', V.cabinTempKnob, 'CABIN TEMP', 0.259);
  ped.add(
    new SelectorKnob(env, {
      id: 'lon.ped.ecs',
      var: V.ecsMode,
      label: 'ECS',
      cap: 'pointer',
      diameter: 0.016,
      labelHeight: 0.0016,
      positions: [
        { value: 2, label: 'HEAT EXCHG ONLY', display: 'HEAT\nEXCHG\nONLY', angle: -60 },
        { value: 0, label: 'NORM', angle: 0 },
        { value: 1, label: 'ACM ONLY', display: 'ACM\nONLY', angle: 60 },
      ],
      initial: 1,
    }),
    0.207,
    ay,
  );
  ped.label('ECS', 0.207, ay - 0.024, { height: 0.0022 });
  // Row 2: CABIN DUMP (red guard) | FLOW | CABIN ALT UP / HLD / DN | PRESS MODE.
  const by = 0.458;
  ped.add(
    new GuardedButton(env, {
      id: 'lon.ped.cabin_dump',
      label: 'CABIN DUMP',
      var: V.pressDump,
      mode: 'toggle',
      style: 'korry',
      width: PB,
      height: PB * 0.85,
      layout: 'stack',
      unlitTint: 0.05,
      segments: [seg.eq('NORM', 'cyan', V.pressDump, 0), seg.eq('DUMP', 'amber', V.pressDump, 1)],
      guard: { color: 'red', hinge: 'top', close: 'free', var: V.pressDumpGuard },
    }),
    0.153,
    by,
  );
  ped.label('CABIN DUMP', 0.153, by - 0.017, { height: 0.0022 });
  ped.add(
    new ToggleSwitch(env, {
      id: 'lon.ped.cabin_alt',
      var: V.cabinAltSw,
      label: 'CABIN ALT',
      positions: ['DN', 'HLD', 'UP'],
      values: [-1, 0, 1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      labels: { name: 'CABIN ALT', positions: true, height: 0.0019 },
      scale: 0.7,
    }),
    0.236,
    by - 0.004,
  );
  pb(c, ped, 'lon.ped.press_mode', 'PRESS MODE', V.pressMode, 0.266, by - 0.004, [seg.eq('NORM', 'cyan', V.pressMode, 0), seg.eq('MANUAL', 'cyan', V.pressMode, 1)], 'PRESS MODE');
  pb(c, ped, 'lon.ped.flow', 'FLOW', V.flow, 0.211, by + 0.014, [seg.eq('NORM', 'cyan', V.flow, 0), seg.eq('HIGH', 'white', V.flow, 1)], 'FLOW');
  // Rows 3 / 4: PRESS SOURCE L, APU BLEED, PRESS SOURCE R; ENG BLEED L, BLEED ISOLATE, ENG BLEED R.
  const norm = (v: string) => [seg.eq('NORM', 'cyan', v, 1), seg.eq('OFF', 'amber', v, 0)];
  const r3 = 0.51;
  const r4 = 0.56;
  pb(c, ped, 'lon.ped.press_src_l', 'L PRESS SOURCE', V.pressSrcL, 0.159, r3, norm(V.pressSrcL), 'L PRESS SOURCE');
  pb(c, ped, 'lon.ped.bleed_apu', 'APU BLEED', V.bleedApu, 0.211, r3 + 0.006, norm(V.bleedApu), 'APU BLEED');
  pb(c, ped, 'lon.ped.press_src_r', 'R PRESS SOURCE', V.pressSrcR, 0.267, r3, norm(V.pressSrcR), 'R PRESS SOURCE');
  pb(c, ped, 'lon.ped.bleed_l', 'L ENG BLEED', V.bleedEngL, 0.159, r4, norm(V.bleedEngL), 'L ENG BLEED');
  pb(c, ped, 'lon.ped.bleed_iso', 'BLEED ISOLATE', V.bleedIsolate, 0.211, r4, [seg.eq('NORM', 'cyan', V.bleedIsolate, 0), seg.eq('XFLOW', 'white', V.bleedIsolate, 1)], 'BLEED ISOLATE');
  pb(c, ped, 'lon.ped.bleed_r', 'R ENG BLEED', V.bleedEngR, 0.267, r4, norm(V.bleedEngR), 'R ENG BLEED');
  // Duct mimic (white, _pedaft): ECS -> FLOW, press-source manifold, APU bleed, engine bleeds / isolate, WING A/I taps.
  const w = 0.0008;
  ped.line(0.207, ay + 0.01, 0.207, by + 0.004, w);
  ped.line(0.159, 0.486, 0.267, 0.486, w);
  ped.line(0.211, 0.479, 0.211, 0.486, w);
  ped.line(0.211, 0.486, 0.211, 0.5, w);
  ped.line(0.159, 0.486, 0.159, 0.5, w);
  ped.line(0.267, 0.486, 0.267, 0.5, w);
  ped.line(0.159, 0.52, 0.159, 0.544, w);
  ped.line(0.267, 0.52, 0.267, 0.544, w);
  ped.line(0.17, r4, 0.2, r4, w);
  ped.line(0.222, r4, 0.256, r4, w);
  ped.line(0.14, 0.534, 0.159, 0.534, w);
  ped.line(0.267, 0.534, 0.286, 0.534, w);
  ped.label('WING A/I', 0.128, 0.53, { height: 0.0019 });
  ped.label('WING A/I', 0.29, 0.53, { height: 0.0019 });
  // ---- COCKPIT VOICE RECORDER row (_pedaft): TEST (green) + HOLD 5 SEC status light, HEADSET jack, ERASE (red).
  const cy = 0.607;
  ped.label('COCKPIT VOICE', 0.19, 0.588, { height: 0.0021 });
  ped.label('RECORDER', 0.19, 0.592, { height: 0.0021 });
  ped.add(new PushButton(env, { id: 'lon.ped.cvr_test', label: 'CVR TEST', var: V.cvrTest, mode: 'momentary', style: 'round', width: 0.011, capMaterial: 'knobGrey', segments: [{ text: '', color: 'green', var: V.cvrTest }], unlitTint: 0.35 }), 0.132, cy);
  ped.add(new AnnunciatorLight(env, { id: 'lon.ped.cvr_status', label: 'CVR STATUS (HOLD 5 SEC)', width: 0.0055, height: 0.0055, unlitTint: 0.06, segments: [{ text: '', color: 'green', var: V.cvrTestOk }] }), 0.151, cy);
  ped.label('HOLD', 0.162, cy - 0.003, { height: 0.0018, align: 'left' });
  ped.label('5 SEC', 0.162, cy + 0.002, { height: 0.0018, align: 'left' });
  ped.bracket('TEST', 0.142, cy + 0.012, 0.035, { height: 0.0019 });
  // HEADSET jack (static fixture).
  const jack = new THREE.Mesh(new THREE.TorusGeometry(0.0045, 0.0015, 8, 20), env.materials.get('steel'));
  c.b.trackGeometry(jack.geometry);
  jack.userData.cockpitStatic = true;
  ped.addObject(jack, 0.195, cy, { z: 0.001 });
  ped.label('HEADSET', 0.195, cy + 0.012, { height: 0.0019 });
  ped.add(new PushButton(env, { id: 'lon.ped.cvr_erase', label: 'CVR ERASE', var: V.cvrErase, mode: 'momentary', style: 'round', width: 0.011, capMaterial: 'knobRed' }), 0.219, cy);
  ped.label('ERASE', 0.219, cy + 0.012, { height: 0.0019 });
  // Storage bin (dark recess) aft of the CVR row.
  ped.subPanel({ name: 'storage_bin', x: 0.18, y: 0.7, width: 0.12, height: 0.1, material: M.trim, screws: false, radius: 0.01, thickness: 0.0015 });
}

/** FLAP lever + FLAP RESET (L39) and the APU box with EVENT MARKER (L44). */
function aftRight(c: LonCockpitContext, ped: Panel): void {
  const { env } = c;
  // FLAP lever at the aft right beside the pressurization block (_pedaft, c_pedA2): UP / 1 (7) / 2 (15) / FULL (35), OG 15-6.
  ped.add(
    new Lever(env, {
      id: 'lon.ped.flaps',
      var: V.flapLever,
      label: 'FLAPS',
      min: 0,
      max: 3,
      discrete: true,
      detents: [
        { value: 0, label: '0' },
        { value: 1, label: '1' },
        { value: 2, label: '2' },
        { value: 3, label: 'FULL' },
      ],
      travel: { kind: 'arc', minDeg: 26, maxDeg: -26, pivotDepth: 0.07 },
      armLength: 0.08,
      knob: 'flap',
      detentLabels: 'left',
      slot: { width: 0.012, plateWidth: 0.03 },
      format: (v) => ['UP', '1 (7°)', '2 (15°)', 'FULL (35°)'][Math.round(v)] ?? String(v),
    }),
    0.318,
    0.425,
  );
  ped.label('FLAP', 0.318, 0.345, { height: 0.0028 });
  ped.bracket('FLAP RESET', 0.322, 0.515, 0.055, { height: 0.0021 });
  pb(c, ped, 'lon.ped.flap_reset', 'FLAP RESET', V.flapReset, 0.322, 0.53, [seg.on('FAIL', 'amber', V.flapFault)], '', 'momentary');
  // APU box: OFF / ON / START (spring to ON) and EVENT MARKER below.
  ped.line(0.272, 0.595, 0.354, 0.595, 0.0008);
  ped.line(0.272, 0.595, 0.272, 0.72, 0.0008);
  ped.label('APU', 0.313, 0.6, { height: 0.0028 });
  ped.add(
    new SelectorKnob(env, {
      id: 'lon.ped.apu',
      var: V.apuKnob,
      label: 'APU',
      cap: 'bar',
      diameter: 0.02,
      labelHeight: 0.0021,
      positions: [
        { value: 0, label: 'OFF', angle: -50 },
        { value: 1, label: 'ON', angle: 0 },
        { value: 2, label: 'START', angle: 50, spring: 1 },
      ],
      initial: 0,
    }),
    0.315,
    0.632,
  );
  ped.label('EVENT MARKER', 0.313, 0.668, { height: 0.0022 });
  ped.line(0.272, 0.662, 0.354, 0.662, 0.0008);
  ped.add(new PushButton(env, { id: 'lon.ped.event_marker', label: 'EVENT MARKER', var: V.eventMarker, mode: 'momentary', style: 'round', width: 0.01, capMaterial: 'plasticBlack' }), 0.318, 0.688);
}

/** Aft end: aileron / rudder trim (EST positions, L40) and the PITCH/ROLL DISCONNECT handle on the aft face (L41). */
function aftEnd(c: LonCockpitContext, ped: Panel, len: number): void {
  const { b, env } = c;
  const M = lonMaterials(env);
  // EST: the aileron-trim switch and rudder-trim knob are not visible in the pedestal photographs; kept at the aft end,
  // clear of the FLAP lever area, until a source shows their position.
  const ty = len - 0.045;
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
      labels: { name: 'AIL TRIM', positions: true, height: 0.0021 },
      scale: 0.8,
    }),
    0.14,
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
    0.225,
    ty,
  );
  // PITCH/ROLL DISCONNECT on a leather-edged plate on the pedestal aft face (a21_006; mount position EST).
  const P = PEDESTAL;
  const face = b.panel({ name: 'ped_aft_face', center_m: [P.topAft[0] - 0.004, 0, P.topAft[1] + 0.09], facing: 'aft', width: P.width - 0.04, height: 0.15, material: M.deck, screws: { kind: 'hex', diameter: 0.004, inset: 0.01 }, radius: 0.02 });
  face.bracket('PITCH/ROLL DISCONNECT', 0.0, 0.058, 0.2, { height: 0.0045 });
  face.label('PITCH', 0.0, 0.043, { height: 0.0042 });
  face.label('RECONNECT', 0.0, 0.036, { height: 0.0042 });
  face.label('PITCH/ROLL', -0.085, 0.0, { height: 0.004 });
  face.label('RECONNECT', -0.085, -0.0065, { height: 0.004 });
  face.label('PUSH-RESET', -0.085, -0.013, { height: 0.004 });
  face.label('NORM', 0.06, -0.004, { height: 0.0042 });
  face.label('ROLL', 0.0, -0.04, { height: 0.0042 });
  face.label('RECONNECT', 0.0, -0.047, { height: 0.0042 });
  face.add(new PitchRollHandle(env, { id: 'lon.ped.pitch_roll_disc', label: 'PITCH / ROLL DISCONNECT', var: V.pitchRollDisc }), -0.01, 0.0);
}
