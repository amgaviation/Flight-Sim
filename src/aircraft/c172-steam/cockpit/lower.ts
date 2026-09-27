/**
 * Lower instrument panel, pedestal and floor controls of the steam 172S (POH 172SPHUS Rev 5
 * Fig 7-2 items 24-39, 41-43; Sec 7):
 *
 *  - Left lower switch panel (black): ignition key switch OFF / R / L / BOTH / START [39],
 *    MASTER split rocker ALT | BAT [38] (interlock in the shared C172Logic), the circuit
 *    breakers [37] (CABIN LTS/PWR, FLAP, INST, AVN BUS 1, AVN BUS 2, TURN COORD, INST LTS, and
 *    WARN / ALT FLD right of the avionics master), the AVIONICS BUS 1 | BUS 2 split rocker [36]
 *    and the switch/breakers FUEL PUMP, BCN LAND TAXI NAV STROBE (LIGHTS), PITOT HEAT
 *    (POH Sec 7 "Circuit breakers": "push to reset" or "switch/breaker" type).
 *  - Centre: RADIO / PANEL and GLARESHIELD / PEDESTAL dimmers (concentric) [31, 32], throttle
 *    with the friction lock [30], mixture with its lock button [28], ALT STATIC AIR [29].
 *  - Right of centre: wing flap switch with the position indicator [27], CABIN HT / CABIN AIR
 *    [25, 26], glove box [24].
 *  - Pedestal: elevator trim wheel and position indicator [35], hand microphone [41], 12 VDC
 *    power port [42], FUEL SHUTOFF valve knob [33]; fuel selector at its foot [34]; parking
 *    brake handle under the left lower panel [43].
 *
 * Positions: layout.ts POS (Fig 7-2). The breaker order in the upper row is the photograph's where
 * visible (CABIN LTS/PWR, FLAP, INST ... AVN BUS 2, TURN COORD); AVN BUS 1 hidden by the wheel (EST).
 */
import * as THREE from 'three';
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import { CircuitBreaker, FuelSelector, Lever, PushButton, PushPullKnob, RockerSwitch, RotaryKnob, SelectorKnob, TBarHandle, ToggleSwitch, TrimWheel } from '../../../cockpit/controls';
import { cylinderZ, extrude, roundedBox, tube } from '../../../cockpit/geometry/primitives';
import { SURF } from '../../../core/vars';
import { sta } from '../../c172s-common/fdm';
import { C172, FUEL_SEL, MAG } from '../../c172s-common/vars';
import { STEAM_BREAKERS } from '../../c172s-common/systems/electrical';
import { FLAP_DETENTS } from '../../c172s-common/data';
import { TAKEOFF_TRIM } from '../../c172s-common/states';
import { ST } from '../vars';
import { FLOOR_H, IN, PANEL, PANEL_H, PANEL_W, PED, POS, hz, px, py } from './layout';

/** Manual elevator trim wheel travel. EST 3.5 turns lock to lock (same EST as the G1000 variant; the POH gives no figure). */
export const TRIM_WHEEL_TURNS = 3.5;

function text(panel: Panel, t: string, X: number, Z: number, h = 0.0016, zone: string | null = 'panel'): void {
  panel.label(t, px(X), py(Z), { height: h, zone, color: '#ecece6' });
}

export interface LowerParts {
  /** Flap position pointer (moved by the cockpit hook from surf.flaps_deg). */
  flapPointer: THREE.Object3D;
  flapScale: { yTop: number; yBot: number };
}

export function buildLowerPanel(b: CockpitBuilder, panel: Panel): LowerParts {
  const env = b.env;
  const mats = env.materials;
  const black = mats.custom('paint', '#1e1f21', 0.72);

  // ---------------------------------------------------------------- black lower panel plate
  const h = PANEL.heightIn - PANEL.upperIn;
  const plate = new THREE.Mesh(env.geometry.get('c172s.lower_plate', () => roundedBox(PANEL_W, h * IN, 0.004, 0.003)), black);
  plate.userData.cockpitStatic = true;
  panel.addObject(plate, PANEL_W / 2, py(PANEL.upperIn + h / 2), { z: -0.002 });
  panel.line(px(-5.2), py(PANEL.upperIn + 0.1), px(-5.2), py(PANEL.heightIn - 0.1), 0.0008, null);
  void PANEL_H;

  // ---------------------------------------------------------------- ignition switch [39]
  // Key switch OFF / R / L / BOTH / START (spring back to BOTH). Middle click (push) inserts /
  // removes the key: without it the shared logic holds the magnetos OFF (C172Logic).
  panel.add(
    new SelectorKnob(env, {
      id: 'c172s.ignition',
      label: 'IGNITION switch (middle click: insert / remove key)',
      var: C172.magneto,
      positions: [
        { value: MAG.off, label: 'OFF', angle: -90 },
        { value: MAG.right, label: 'R', angle: -45 },
        { value: MAG.left, label: 'L', angle: 0 },
        { value: MAG.both, label: 'BOTH', angle: 45 },
        { value: MAG.start, label: 'START', angle: 90, spring: 3 },
      ],
      initial: 0,
      cap: 'key',
      push: { var: C172.keyIn, mode: 'toggle', label: 'KEY' },
      diameter: 0.022,
      labelRadius: 0.021,
      labelHeight: 0.0017,
    }),
    px(POS.key.X),
    py(POS.key.Z),
  );

  // ---------------------------------------------------------------- MASTER ALT | BAT [38]
  const rocker = (id: string, label: string, v: string, X: number, legendTop: string, color: string): RockerSwitch =>
    panel.add(
      new RockerSwitch(env, {
        id,
        label,
        var: v,
        positions: ['OFF', 'ON'],
        width: 0.0115,
        height: 0.024,
        capMaterial: mats.custom('plastic', color, 0.5),
        legend: { top: legendTop, color: '#f4f4f0', zone: 'panel' },
      }),
      px(X),
      py(POS.master.Z),
    );
  rocker('c172s.master_alt', 'MASTER ALT', C172.masterAlt, POS.master.X - 0.25, 'ALT', '#b3261e');
  rocker('c172s.master_bat', 'MASTER BAT', C172.masterBat, POS.master.X + 0.25, 'BAT', '#b3261e');
  text(panel, 'MASTER', POS.master.X, POS.master.Z - 0.75);

  // ---------------------------------------------------------------- circuit breakers [37]
  const cbText: Record<string, string> = {
    cabin_lts_pwr: 'CABIN\nLTS/PWR',
    flap: 'FLAP',
    inst: 'INST',
    avn_bus1: 'AVN\nBUS 1',
    avn_bus2: 'AVN\nBUS 2',
    turn_coord: 'TURN\nCOORD',
    inst_lts: 'INST\nLTS',
    warn: 'WARN',
    alt_fld: 'ALT\nFLD',
  };
  const upper = ['cabin_lts_pwr', 'flap', 'inst', 'avn_bus1', 'avn_bus2', 'turn_coord', 'inst_lts'];
  const addCb = (name: string, X: number): void => {
    const def = STEAM_BREAKERS.find((x) => x.name === name)!;
    panel.add(new CircuitBreaker(env, { id: `c172s.cb.${name}`, label: `${def.label} circuit breaker (${def.ratingA} A)`, var: `cb.${name}`, trippedVar: `cb.${name}_tripped`, rating: def.ratingA }), px(X), py(POS.cbRowZ));
    text(panel, cbText[name], X, POS.cbRowZ - 0.52, 0.0013);
  };
  upper.forEach((n, i) => addCb(n, POS.cbLeftX0 + i * POS.cbPitch));
  addCb('warn', POS.cbRightX[0]);
  addCb('alt_fld', POS.cbRightX[1]);

  // ---------------------------------------------------------------- AVIONICS BUS 1 | BUS 2 [36]
  rocker('c172s.avn_bus1', 'AVIONICS BUS 1', C172.avionicsBus1, POS.avnMaster.X - 0.25, 'BUS\n1', '#2a2b2e');
  rocker('c172s.avn_bus2', 'AVIONICS BUS 2', C172.avionicsBus2, POS.avnMaster.X + 0.25, 'BUS\n2', '#2a2b2e');
  text(panel, 'AVIONICS', POS.avnMaster.X, POS.avnMaster.Z + 0.75);

  // ---------------------------------------------------------------- switch/breakers [37]
  const sw: [string, string, string][] = [
    ['fuel_pump', 'FUEL\nPUMP', C172.fuelPump],
    ['bcn', 'BCN', C172.beacon],
    ['land', 'LAND', C172.land],
    ['taxi', 'TAXI', C172.taxi],
    ['nav', 'NAV', C172.nav],
    ['strobe', 'STROBE', C172.strobe],
    ['pitot_heat', 'PITOT\nHEAT', C172.pitotHeat],
  ];
  sw.forEach(([name, t, v], i) => {
    const X = POS.swX0 + i * POS.swPitch;
    const def = STEAM_BREAKERS.find((x) => x.name === name)!;
    panel.add(
      new ToggleSwitch(env, {
        id: `c172s.sw.${name}`,
        label: `${def.label} switch/breaker (${def.ratingA} A)`,
        var: v,
        positions: ['OFF', 'ON'],
        scale: 0.8,
        labels: { positions: false },
      }),
      px(X),
      py(POS.swRowZ),
    );
    text(panel, t, X, POS.swRowZ - 0.62, 0.0013);
    text(panel, 'OFF', X, POS.swRowZ + 0.55, 0.0011);
  });
  panel.bracket('LIGHTS', px(POS.swX0 + 3 * POS.swPitch), py(POS.swRowZ - 1.0), 4.4 * POS.swPitch * IN, { height: 0.0013 });

  // ---------------------------------------------------------------- dimmers [31, 32]
  const dimmer = (id: string, label: string, X: number, Z: number, outer: [string, string], inner: [string, string]): void => {
    panel.add(
      new RotaryKnob(env, {
        id,
        label,
        outer: { var: outer[0], label: outer[1], min: 0, max: 1, step: 0.05, initial: 0, angleRange: [-140, 140], format: (x) => (x <= 0 ? 'OFF' : `${Math.round(x * 100)}%`) },
        inner: { var: inner[0], label: inner[1], min: 0, max: 1, step: 0.05, initial: 0, angleRange: [-140, 140], format: (x) => (x <= 0 ? 'OFF' : `${Math.round(x * 100)}%`) },
        cap: 'ring',
        innerCap: 'dimmer',
        diameter: 0.024,
        pointer: 'line',
        zone: 'panel',
      }),
      px(X),
      py(Z),
    );
  };
  dimmer('c172s.dim_panel_radio', 'PANEL LT (outer) / RADIO LT (inner) dimmers', POS.dimmerUpper.X, POS.dimmerUpper.Z, [C172.dimPanel, 'PANEL'], [C172.dimRadio, 'RADIO']);
  text(panel, 'PANEL', POS.dimmerUpper.X - 0.9, POS.dimmerUpper.Z - 0.2, 0.0012);
  text(panel, 'RADIO', POS.dimmerUpper.X - 0.9, POS.dimmerUpper.Z + 0.15, 0.0012);
  dimmer('c172s.dim_glare_ped', 'GLARESHIELD LT (outer) / PEDESTAL LT (inner) dimmers', POS.dimmerLower.X, POS.dimmerLower.Z, [C172.dimGlareshield, 'GLARESHIELD'], [C172.dimPedestal, 'PEDESTAL']);
  text(panel, 'GLARE-\nSHIELD', POS.dimmerLower.X - 0.95, POS.dimmerLower.Z - 0.2, 0.0011);
  text(panel, 'PED', POS.dimmerLower.X - 0.95, POS.dimmerLower.Z + 0.25, 0.0012);

  // ---------------------------------------------------------------- throttle + friction lock [30], mixture [28], ALT STATIC AIR [29]
  panel.add(new PushPullKnob(env, { id: 'c172s.throttle', label: 'THROTTLE (push open)', var: C172.throttle, valueIn: 1, valueOut: 0, style: 'throttle', travel: 0.095, vernierStep: 0 }), px(POS.throttle.X), py(POS.throttle.Z));
  panel.add(
    new RotaryKnob(env, {
      id: 'c172s.throttle_friction',
      label: 'THROTTLE FRICTION LOCK (clockwise = more friction)',
      outer: { var: C172.throttleFriction, min: 0, max: 1, step: 0.1, initial: 0.3, degPerClick: 30, format: (x) => `${Math.round(x * 100)}%` },
      cap: 'ring',
      diameter: 0.031,
      height: 0.006,
      material: 'chrome',
      pointer: 'none',
    }),
    px(POS.throttle.X),
    py(POS.throttle.Z),
  );
  text(panel, 'THROTTLE', POS.throttle.X, POS.throttle.Z + 0.95, 0.0013);
  panel.add(new PushPullKnob(env, { id: 'c172s.mixture', label: 'MIXTURE (pull lean; center button unlocks)', var: C172.mixture, valueIn: 1, valueOut: 0, style: 'mixture', travel: 0.095, lockButton: true, vernierStep: 0.008 }), px(POS.mixture.X), py(POS.mixture.Z));
  text(panel, 'MIXTURE', POS.mixture.X, POS.mixture.Z + 0.95, 0.0013);
  panel.add(new PushPullKnob(env, { id: 'c172s.alt_static', label: 'ALT STATIC AIR (pull ON)', var: C172.altStatic, valueIn: 0, valueOut: 1, style: 'plain', travel: 0.025, material: 'knobRed' }), px(POS.altStatic.X), py(POS.altStatic.Z));
  text(panel, 'ALT STATIC AIR\nPULL ON', POS.altStatic.X + 1.3, POS.altStatic.Z, 0.0011);

  // ---------------------------------------------------------------- wing flaps [27]
  const fX = POS.flap.X;
  const fTop = POS.flap.Z - 0.95;
  const fBot = POS.flap.Z + 0.95;
  text(panel, 'WING\nFLAPS', fX - 0.9, fTop - 0.1, 0.0013);
  const detentZ = (lev: number): number => fTop + ((fBot - fTop) * lev) / 3;
  for (const d of FLAP_DETENTS) text(panel, d.label, fX + 0.62, detentZ(d.lever), 0.0012);
  panel.add(
    new Lever(env, {
      id: 'c172s.flaps',
      label: 'WING FLAP switch',
      var: C172.flapLever,
      min: 0,
      max: 3,
      initial: 0,
      discrete: true,
      detents: FLAP_DETENTS.map((d) => ({ value: d.lever, label: d.label })),
      travel: { kind: 'linear', length: (fBot - fTop) * IN },
      knob: 'flap',
      knobScale: 0.65,
      knobMaterial: 'knobWhite',
      armLength: 0.03,
      detentLabels: false,
      slot: { width: 0.006, plateWidth: 0.016 },
      dragInvert: true,
      format: (v) => FLAP_DETENTS[Math.round(v)]?.label ?? '',
    }),
    px(fX),
    py((fTop + fBot) / 2),
    { rotDeg: 180 },
  );
  // Flap position indicator: follow-up pointer beside the lever (surf.flaps_deg, moved by the cockpit hook).
  const flapPointer = new THREE.Mesh(
    env.geometry.get('c172s.flap_ptr', () => {
      const s = new THREE.Shape();
      s.moveTo(0.004, 0);
      s.lineTo(-0.002, 0.0022);
      s.lineTo(-0.002, -0.0022);
      s.closePath();
      return extrude(s, { depth: 0.0012, anchor: 'back0' });
    }),
    mats.custom('paint', '#f2f2ee', 0.5),
  );
  flapPointer.name = 'flap_pointer';
  flapPointer.userData.cockpitDynamic = true;
  panel.addObject(flapPointer, px(fX - 0.45), py(fTop), { z: 0.0003 });

  // ---------------------------------------------------------------- CABIN HT / CABIN AIR [25, 26]
  panel.add(new PushPullKnob(env, { id: 'c172s.cabin_heat', label: 'CABIN HT (pull ON)', var: C172.cabinHeat, valueIn: 0, valueOut: 1, style: 'cabin', travel: 0.05, vernierStep: 0.05, clickToggles: false, material: 'knobRed' }), px(POS.cabinHeat.X), py(POS.cabinHeat.Z));
  text(panel, 'CABIN HT\nPULL ON', POS.cabinHeat.X - 1.25, POS.cabinHeat.Z, 0.0012);
  panel.add(new PushPullKnob(env, { id: 'c172s.cabin_air', label: 'CABIN AIR (pull ON)', var: C172.cabinAir, valueIn: 0, valueOut: 1, style: 'cabin', travel: 0.05, vernierStep: 0.05, clickToggles: false, material: 'knobGrey' }), px(POS.cabinAir.X), py(POS.cabinAir.Z));
  text(panel, 'CABIN AIR\nPULL ON', POS.cabinAir.X - 1.25, POS.cabinAir.Z, 0.0012);

  // ---------------------------------------------------------------- glove box [24] (SCOPE: storage door, static)
  {
    const g = POS.gloveBox;
    const m = new THREE.Mesh(env.geometry.get('c172s.glovebox', () => roundedBox((g.X1 - g.X0) * IN, (g.Z1 - g.Z0) * IN, 0.006, 0.004)), black);
    m.userData.cockpitStatic = true;
    panel.addObject(m, px((g.X0 + g.X1) / 2), py((g.Z0 + g.Z1) / 2), { z: 0.003 });
    const latch = new THREE.Mesh(env.geometry.get('c172s.glove_latch', () => cylinderZ(0.008, 0.008, 0, 0.004, 24)), mats.get('chrome'));
    latch.userData.cockpitStatic = true;
    panel.addObject(latch, px(15.2), py(g.Z0 + 0.6), { z: 0.0065 });
  }

  return { flapPointer, flapScale: { yTop: py(fTop), yBot: py(fBot) } };
}

// ------------------------------------------------------------------ pedestal and floor

/** Cockpit-local point (x right, y up, z aft) from (FS in, y m right, height m). */
function L(fs: number, y: number, hgt: number): THREE.Vector3 {
  const b = new THREE.Vector3(y, hgt - 1.17, -sta(fs));
  return b;
}

export function buildPedestal(b: CockpitBuilder): void {
  const env = b.env;
  const mats = env.materials;
  const black = mats.custom('plastic', '#1d1d20', 0.78);
  const tilt = (Math.atan2((PED.botFs - PED.topFs) * IN, PED.topH - PED.botH) * 180) / Math.PI;
  const len = Math.hypot((PED.botFs - PED.topFs) * IN, PED.topH - PED.botH);
  // Pedestal body: side-profile prism from the lower panel down to the floor.
  {
    const s = new THREE.Shape();
    const P = (fs: number, hgt: number): [number, number] => {
      const v = L(fs, 0, hgt);
      return [v.z, v.y];
    };
    const pts = [P(12, PED.topH + 0.01), P(PED.topFs - 0.1, PED.topH + 0.01), P(PED.botFs, PED.botH), P(PED.botFs + 0.6, FLOOR_H), P(12, FLOOR_H)];
    s.moveTo(...pts[0]);
    for (const p of pts.slice(1)) s.lineTo(...p);
    s.closePath();
    const g = extrude(s, { depth: PED.width - 0.004, bevel: 0.004, bevelSegments: 2, anchor: 'back0' });
    g.rotateY(-Math.PI / 2);
    g.translate(PED.width / 2, 0, 0);
    b.structureMesh(g, black).name = 'pedestal_body';
  }
  const midFs = (PED.topFs + PED.botFs) / 2;
  const midH = (PED.topH + PED.botH) / 2;
  const face = b.panel({
    name: 'c172s.pedestal',
    center_m: [sta(midFs) - 0.002 * Math.cos((tilt * Math.PI) / 180), 0, hz(midH + 0.002 * Math.sin((tilt * Math.PI) / 180))],
    facing: 'aft',
    tiltDeg: tilt,
    width: PED.width,
    height: len,
    origin: 'top-left',
    material: black,
    thickness: 0.003,
    radius: 0.006,
    screws: { positions: [[0.008, 0.008], [PED.width - 0.008, 0.008], [0.008, len - 0.008], [PED.width - 0.008, len - 0.008]] },
  });
  const txt = (t: string, x: number, y: number, hgt: number): void => {
    const l = env.labels.text(t, { height: hgt, weight: 700, zone: 'pedestal', color: '#e9e9e4' });
    l.userData.cockpitStatic = true;
    face.addObject(l, x, y, { z: 0.0002 });
  };
  // Elevator trim wheel and indicator [35].
  const trimX = 0.045;
  const trimY = 0.1;
  face.add(
    new TrimWheel(env, {
      id: 'c172s.trim_wheel',
      label: 'ELEVATOR TRIM wheel',
      var: C172.trimPosition,
      min: -1,
      max: 1,
      perRev: 2 / TRIM_WHEEL_TURNS,
      forwardDecreases: true,
      diameter: 0.1,
      thickness: 0.016,
      exposure: 0.22,
      spokes: 0,
      material: 'plasticBlack',
      indicator: {
        length: 0.07,
        offset: [-0.025, 0, 0],
        marks: [{ value: -1, label: '' }, { value: TAKEOFF_TRIM, label: '' }, { value: 1, label: '' }],
        increasingUp: false,
      },
    }),
    trimX,
    trimY,
  );
  txt('NOSE\nDOWN', 0.017, trimY - 0.05, 0.0021);
  txt('NOSE\nUP', 0.017, trimY + 0.05, 0.0021);
  txt('TAKE\nOFF', 0.0075, trimY - 0.035 * TAKEOFF_TRIM, 0.0015);
  // Hand microphone [41] with its push-to-talk (keys the KMA 28 selected transmitter).
  const micX = 0.11;
  const micY = 0.1;
  {
    const mic = new THREE.Group();
    mic.name = 'hand_mic';
    mic.add(new THREE.Mesh(env.geometry.get('c172s.mic_body', () => roundedBox(0.048, 0.07, 0.024, 0.01)), mats.get('plasticBlack')));
    const grille = new THREE.Mesh(env.geometry.get('c172s.mic_grille', () => roundedBox(0.03, 0.022, 0.002, 0.004)), mats.get('steel'));
    grille.position.set(0, 0.018, 0.012);
    mic.add(grille);
    mic.traverse((c) => (c.userData.cockpitStatic = true));
    face.addObject(mic, micX, micY, { z: 0.013 });
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const a = t * Math.PI * 2 * 14;
      pts.push(new THREE.Vector3(0.007 * Math.cos(a), -t * 0.12, 0.007 * Math.sin(a) + 0.012));
    }
    const cord = new THREE.Mesh(env.geometry.get('c172s.mic_cord', () => tube(pts, 0.0016, 360, 6)), mats.get('plasticBlack'));
    cord.userData.cockpitStatic = true;
    face.addObject(cord, micX, micY + 0.035, { z: 0.004 });
  }
  face.add(
    new PushButton(env, { id: 'c172s.ptt_hand_mic', label: 'HAND MIC push-to-talk', mode: 'momentary', var: ST.pttHandMic, style: 'small', width: 0.01, height: 0.018, capMaterial: 'plasticGrey' }),
    micX - 0.026,
    micY - 0.005,
    { z: 0.013 },
  );
  // 12 VDC power port [42] (SCOPE: load modelled by the CABIN LTS/PWR circuit; static receptacle).
  const outlet = new THREE.Mesh(env.geometry.get('c172s.outlet', () => cylinderZ(0.0115, 0.011, 0, 0.006, 28)), mats.get('plasticBlack'));
  outlet.userData.cockpitStatic = true;
  face.addObject(outlet, 0.035, 0.24);
  txt('12 VDC\n10 AMP', 0.035, 0.265, 0.0015);
  // FUEL SHUTOFF valve [33]: red knob, push ON / pull OFF.
  face.add(
    new PushPullKnob(env, { id: 'c172s.fuel_shutoff', label: 'FUEL SHUTOFF (push ON / pull OFF)', var: C172.fuelShutoff, valueIn: 1, valueOut: 0, style: 'plain', travel: 0.04, material: 'knobRed', clickToggles: true }),
    0.108,
    0.255,
  );
  txt('FUEL\nSHUTOFF', 0.108, 0.225, 0.0019);
  txt('ON (PUSH)  OFF (PULL)', 0.108, 0.282, 0.0013);

  // Fuel selector [34] on the floor plate aft of the pedestal (POH placard: LEFT / BOTH / RIGHT).
  const floorPlate = b.panel({
    name: 'c172s.fuel_selector_plate',
    center_m: [sta(PED.botFs + 3.2), 0, hz(FLOOR_H + 0.012)],
    facing: 'up',
    width: 0.13,
    height: 0.105,
    origin: 'center',
    material: mats.custom('paint', '#141414', 0.6),
    thickness: 0.012,
    radius: 0.012,
    screws: { positions: [[-0.055, -0.042], [0.055, -0.042]] },
  });
  floorPlate.add(
    new FuelSelector(env, {
      id: 'c172s.fuel_selector',
      label: 'FUEL SELECTOR (LEFT / BOTH / RIGHT)',
      var: C172.fuelSelector,
      positions: [
        { value: FUEL_SEL.left, label: 'LEFT', angle: -90 },
        { value: FUEL_SEL.both, label: 'BOTH', angle: 0 },
        { value: FUEL_SEL.right, label: 'RIGHT', angle: 90 },
      ],
      initial: 1,
      // POH placard: LEFT / RIGHT 26.5 gal LEVEL FLIGHT ONLY; BOTH 53.0 gal TAKEOFF LANDING ALL FLIGHT ATTITUDES.
      sublabels: ['26.5 GAL\nLEVEL FLIGHT\nONLY', '53.0 GAL\nTAKEOFF LANDING\nALL FLIGHT ATTITUDES', '26.5 GAL\nLEVEL FLIGHT\nONLY'],
      placardDiameter: 0.1,
      diameter: 0.065,
      labelHeight: 0.0034,
    }),
    0,
    -0.004,
  );
  void RockerSwitch;
}

/** Parking brake handle [43] under the left lower panel: pull aft and rotate 90 deg down to set (POH Sec 7). */
export function buildParkingBrake(b: CockpitBuilder, panel: Panel): void {
  panel.add(
    new TBarHandle(b.env, {
      id: 'c172s.parking_brake',
      label: 'PARKING BRAKE (pull and rotate to set)',
      var: C172.parkingBrake,
      valueIn: 0,
      valueOut: 1,
      style: 'tbar',
      rotate: 'lock',
      springIn: true,
      pullLength: 0.05,
      legend: 'PARK BRAKE',
    }),
    px(-15.4),
    py(PANEL.heightIn + 0.9),
    { z: -0.01 },
  );
}
