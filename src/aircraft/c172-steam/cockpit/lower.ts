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
 *  - Pedestal: elevator trim wheel with its TAKE OFF position indicator [35] on the left, hand
 *    microphone [41] in its clip, the jack plate at the top right (MIC JACK, CABIN PWR 12V [42],
 *    AUX AUDIO IN; VH-SPQ photograph, Supplement 22), FUEL SHUTOFF valve knob [33] low on the
 *    face, the hooded pedestal light, and the fuel selector on the sloped foot [34]; parking
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
  const rocker = (id: string, label: string, v: string, X: number, legendTop: string | null, color: string): RockerSwitch =>
    panel.add(
      new RockerSwitch(env, {
        id,
        label,
        var: v,
        positions: ['OFF', 'ON'],
        width: 0.0115,
        height: 0.024,
        capMaterial: mats.custom('plastic', color, 0.5),
        legend: legendTop ? { top: legendTop, color: '#f4f4f0', zone: 'panel' } : undefined,
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
    // POH Sec 7 "Circuit breakers and fuses": "push to reset" breakers (cannot be pulled; push in after a trip).
    panel.add(new CircuitBreaker(env, { id: `c172s.cb.${name}`, label: `${def.label} circuit breaker (${def.ratingA} A, push to reset)`, var: `cb.${name}`, trippedVar: `cb.${name}_tripped`, rating: def.ratingA, pullable: false }), px(X), py(POS.cbRowZ));
    text(panel, cbText[name], X, POS.cbRowZ - 0.52, 0.0013);
  };
  upper.forEach((n, i) => addCb(n, POS.cbLeftX0 + i * POS.cbPitch));
  addCb('warn', POS.cbRightX[0]);
  addCb('alt_fld', POS.cbRightX[1]);

  // ---------------------------------------------------------------- AVIONICS BUS 1 | BUS 2 [36]
  // VH-SPQ / N146TC photographs: a white split rocker with "BUS 1  BUS 2" printed below it.
  rocker('c172s.avn_bus1', 'AVIONICS BUS 1', C172.avionicsBus1, POS.avnMaster.X - 0.25, null, '#e6e5e0');
  rocker('c172s.avn_bus2', 'AVIONICS BUS 2', C172.avionicsBus2, POS.avnMaster.X + 0.25, null, '#e6e5e0');
  text(panel, 'BUS\n1', POS.avnMaster.X - 0.25, POS.avnMaster.Z + 0.82, 0.0012);
  text(panel, 'BUS\n2', POS.avnMaster.X + 0.25, POS.avnMaster.Z + 0.82, 0.0012);
  text(panel, 'AVIONICS', POS.avnMaster.X, POS.avnMaster.Z - 0.78, 0.0013);

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
  // Legends as on VH-SPQ (and the POH text): "• PANEL LT / ○ RADIO LT" and "• GLARESHIELD LT /
  // ○ PEDESTAL LT" above each concentric dimmer (filled dot = outer knob, open dot = inner), and a
  // "BRT" arc with an arrow (clockwise = brighter) on the left of each knob.
  const brtArc = (X: number, Z: number): void => {
    const r = 0.62;
    const a0 = (205 * Math.PI) / 180;
    const a1 = (125 * Math.PI) / 180;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
      panel.line(px(X + r * Math.cos(t0)), py(Z - r * Math.sin(t0)), px(X + r * Math.cos(t1)), py(Z - r * Math.sin(t1)), 0.0005);
    }
    text(panel, '▲', X + r * Math.cos(a1) + 0.03, Z - r * Math.sin(a1) - 0.05, 0.0011);
    text(panel, 'B\nR\nT', X - r - 0.2, Z, 0.001);
  };
  dimmer('c172s.dim_panel_radio', 'PANEL LT (outer) / RADIO LT (inner) dimmers', POS.dimmerUpper.X, POS.dimmerUpper.Z, [C172.dimPanel, 'PANEL LT'], [C172.dimRadio, 'RADIO LT']);
  panel.label('• PANEL LT\n○ RADIO LT', px(POS.dimmerUpper.X + 0.05), py(POS.dimmerUpper.Z - 0.82), { height: 0.0011, zone: 'panel', color: '#ecece6', align: 'left' });
  brtArc(POS.dimmerUpper.X, POS.dimmerUpper.Z);
  dimmer('c172s.dim_glare_ped', 'GLARESHIELD LT (outer) / PEDESTAL LT (inner) dimmers', POS.dimmerLower.X, POS.dimmerLower.Z, [C172.dimGlareshield, 'GLARESHIELD LT'], [C172.dimPedestal, 'PEDESTAL LT']);
  panel.label('• GLARESHIELD LT\n○ PEDESTAL LT', px(POS.dimmerLower.X - 0.55), py(POS.dimmerLower.Z - 0.82), { height: 0.0011, zone: 'panel', color: '#ecece6', align: 'left' });
  brtArc(POS.dimmerLower.X, POS.dimmerLower.Z);

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
  // VH-SPQ: "THROT / PUSH / OPEN" left of the throttle, "MIX / PULL / LEAN" left of the mixture.
  text(panel, 'THROT\nPUSH\nOPEN', POS.throttle.X - 1.0, POS.throttle.Z - 0.1, 0.0012);
  // POH Sec 7: the mixture is "a red knob with raised points around the circumference" and a lock button.
  panel.add(new PushPullKnob(env, { id: 'c172s.mixture', label: 'MIXTURE (pull lean; center button unlocks)', var: C172.mixture, valueIn: 1, valueOut: 0, style: 'mixture', travel: 0.095, lockButton: true, vernierStep: 0.008, ridges: 10 }), px(POS.mixture.X), py(POS.mixture.Z));
  text(panel, 'MIX\nPULL\nLEAN', POS.mixture.X - 0.9, POS.mixture.Z - 0.55, 0.0011);
  panel.add(new PushPullKnob(env, { id: 'c172s.alt_static', label: 'ALT STATIC AIR (pull ON)', var: C172.altStatic, valueIn: 0, valueOut: 1, style: 'plain', travel: 0.025, material: 'knobRed' }), px(POS.altStatic.X), py(POS.altStatic.Z));
  text(panel, 'ALT\nSTATIC AIR\nPULL ON', POS.altStatic.X - 1.25, POS.altStatic.Z, 0.0011);

  // ---------------------------------------------------------------- wing flaps [27]
  const fX = POS.flap.X;
  const fTop = POS.flap.Z - 0.95;
  const fBot = POS.flap.Z + 0.95;
  text(panel, 'WING\nFLAPS', fX - 1.25, fTop - 0.45, 0.0013);
  const detentZ = (lev: number): number => fTop + ((fBot - fTop) * lev) / 3;
  // Flap position scale left of the lever (VH-SPQ): detent legends, and the POH Sec 2 placard 4
  // colour codes on the indicator: blue 0-10 deg (110 KIAS), white 10-30 deg (85 KIAS).
  for (const d of FLAP_DETENTS) text(panel, d.label, fX - 1.05, detentZ(d.lever), 0.0012);
  {
    const band = (z0: number, z1: number, color: string): void => {
      const m = env.labels.rect(0.0022, (z1 - z0) * IN, null, color);
      m.userData.cockpitStatic = true;
      panel.addObject(m, px(fX - 0.66), py((z0 + z1) / 2), { z: 0.0002 });
    };
    band(detentZ(0), detentZ(1), '#2f6fd6');
    band(detentZ(1), detentZ(3), '#f2f2ee');
  }
  text(panel, 'AVOID SLIPS WITH\nFLAPS EXTENDED', fX - 0.35, fBot + 0.6, 0.0011);
  panel.add(
    new Lever(env, {
      id: 'c172s.flaps',
      label: 'WING FLAP switch',
      var: C172.flapLever,
      min: 0,
      max: 3,
      initial: 0,
      discrete: true,
      // POH Sec 7 "Wing flap system": mechanical stops at 10 and 20 deg; "the flap lever is moved to the right
      // to clear mechanical stops at the 10° and 20° positions" (extending). Gates: a drag stops there; release
      // and drag again (or click) to move the lever over the stop.
      detents: FLAP_DETENTS.map((d) => ({ value: d.lever, label: d.label, ...(d.lever === 1 || d.lever === 2 ? { kind: 'gate' as const, direction: 'increasing' as const } : {}) })),
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
  // POH Sec 7: CABIN HT and CABIN AIR are "double-button locking type" knobs permitting intermediate
  // settings (the centre button releases the lock, as on the mixture); VH-SPQ: chrome knobs.
  panel.add(new PushPullKnob(env, { id: 'c172s.cabin_heat', label: 'CABIN HT (pull ON; centre button unlocks)', var: C172.cabinHeat, valueIn: 0, valueOut: 1, style: 'cabin', travel: 0.05, vernierStep: 0.05, clickToggles: false, lockButton: true, material: 'chrome' }), px(POS.cabinHeat.X), py(POS.cabinHeat.Z));
  text(panel, 'CABIN HT\nPULL ON', POS.cabinHeat.X - 1.25, POS.cabinHeat.Z, 0.0012);
  panel.add(new PushPullKnob(env, { id: 'c172s.cabin_air', label: 'CABIN AIR (pull ON; centre button unlocks)', var: C172.cabinAir, valueIn: 0, valueOut: 1, style: 'cabin', travel: 0.05, vernierStep: 0.05, clickToggles: false, lockButton: true, material: 'chrome' }), px(POS.cabinAir.X), py(POS.cabinAir.Z));
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

export interface PedestalParts {
  /** Plug of a portable audio device in the AUX AUDIO IN jack (shown while ST.auxJack = 1). */
  auxPlug: THREE.Object3D;
  /** 12 V device plug in the CABIN PWR 12V outlet (shown while C172.cabinPwr12v = 1). */
  pwrPlug: THREE.Object3D;
}

export function buildPedestal(b: CockpitBuilder): PedestalParts {
  const env = b.env;
  const mats = env.materials;
  const black = mats.custom('plastic', '#1d1d20', 0.78);
  const tilt = (Math.atan2((PED.botFs - PED.topFs) * IN, PED.topH - PED.botH) * 180) / Math.PI;
  const len = Math.hypot((PED.botFs - PED.topFs) * IN, PED.topH - PED.botH);
  // Pedestal body: side-profile prism from the lower panel down to the sloped foot and the floor.
  {
    const s = new THREE.Shape();
    const P = (fs: number, hgt: number): [number, number] => {
      const v = L(fs, 0, hgt);
      return [v.z, v.y];
    };
    const pts = [P(12, PED.topH + 0.01), P(PED.topFs - 0.1, PED.topH + 0.01), P(PED.botFs, PED.botH), P(PED.footFs, PED.footH), P(PED.footFs, FLOOR_H), P(12, FLOOR_H)];
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
  const txt = (t: string, x: number, y: number, hgt: number, rotDeg = 0): void => {
    const l = env.labels.text(t, { height: hgt, weight: 700, zone: 'pedestal', color: '#e9e9e4' });
    l.userData.cockpitStatic = true;
    face.addObject(l, x, y, { z: 0.0002, rotDeg });
  };
  // Elevator trim wheel and indicator [35]: a large ribbed wheel on the left of the pedestal face
  // (POH Fig 7-2 item 35; VH-SPQ / N146TC / Commons "Cessna 172 trim control" photographs: ~6 in of
  // rim exposed with raised grip nubs, NOSE DOWN above, NOSE UP below, the position indicator slot
  // with its vertical TAKE OFF legend to its left). EST 7.9 in wheel, 1.6 in proud of the face.
  const trimX = 0.044;
  const trimY = 0.095;
  face.add(
    new TrimWheel(env, {
      id: 'c172s.trim_wheel',
      label: 'ELEVATOR TRIM wheel',
      var: C172.trimPosition,
      min: -1,
      max: 1,
      perRev: 2 / TRIM_WHEEL_TURNS,
      forwardDecreases: true,
      diameter: 0.2,
      thickness: 0.018,
      exposure: 0.2,
      spokes: 0,
      nubs: 24,
      material: 'plasticBlack',
      indicator: {
        length: 0.085,
        offset: [-0.026, 0, 0],
        marks: [{ value: -1, label: '' }, { value: TAKEOFF_TRIM, label: '' }, { value: 1, label: '' }],
        increasingUp: false,
      },
    }),
    trimX,
    trimY,
  );
  txt('NOSE\nDOWN', 0.019, trimY - 0.066, 0.0021);
  txt('NOSE\nUP', 0.019, trimY + 0.066, 0.0021);
  // TAKE OFF legend reading downward beside the slot, with its arrow at the takeoff mark.
  txt('◄ TAKE OFF', 0.006, trimY - 0.0425 * TAKEOFF_TRIM + 0.017, 0.0016, -90);
  // Hand microphone [41] in its clip, with its push-to-talk (keys the KMA 28 selected transmitter).
  const micX = 0.087;
  const micY = 0.1;
  {
    const mic = new THREE.Group();
    mic.name = 'hand_mic';
    mic.add(new THREE.Mesh(env.geometry.get('c172s.mic_body', () => roundedBox(0.044, 0.07, 0.024, 0.01)), mats.get('plasticBlack')));
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
    micX - 0.024,
    micY - 0.005,
    { z: 0.013 },
  );
  // Jack plate at the top right beside the microphone clip (VH-SPQ photograph): "MIC JACK" arrow,
  // the 12 V cabin power outlet "CABIN PWR 12V" [42] (Supplement 22: remote power outlet on the
  // centre pedestal, "location may vary"), and the AUX AUDIO IN jack of the KMA 28 (Supplement 20
  // AUX input). The outlet (Supplement 22: the converter supplies power only with a device plugged in,
  // from CABIN LTS/PWR, 10 A max) toggles "a device plugged in" (C172.cabinPwr12v, the cabin_12v load;
  // unplugging is the load-shed action). The AUX jack toggles "a portable audio device plugged in"
  // (ST.auxJack), which the KMA 28 routes when AUX is selected.
  const jackX = 0.13;
  const jackY = 0.045;
  const auxPlug = new THREE.Group();
  const pwrPlug = new THREE.Group();
  {
    const plate = new THREE.Mesh(env.geometry.get('c172s.jack_plate', () => roundedBox(0.036, 0.034, 0.004, 0.003)), mats.custom('plastic', '#101012', 0.6));
    plate.userData.cockpitStatic = true;
    face.addObject(plate, jackX, jackY, { z: 0.002 });
    txt('MIC JACK ►', jackX - 0.004, jackY - 0.026, 0.0014);
    const outlet = new THREE.Mesh(env.geometry.get('c172s.outlet', () => cylinderZ(0.0075, 0.007, 0, 0.004, 24)), mats.get('plasticBlack'));
    outlet.userData.cockpitStatic = true;
    face.addObject(outlet, jackX - 0.008, jackY - 0.004, { z: 0.004 });
    txt('CABIN\nPWR\n12V', jackX - 0.008, jackY + 0.011, 0.0011);
    face.add(
      new PushButton(env, { id: 'c172s.cabin_pwr_12v', label: 'CABIN PWR 12V outlet (click: plug in / unplug a 12 V device)', var: C172.cabinPwr12v, mode: 'toggle', style: 'round', width: 0.011, capMaterial: 'plasticBlack', engraved: '', zone: null }),
      jackX - 0.008,
      jackY - 0.004,
      { z: 0.005 },
    );
    const pp = new THREE.Mesh(env.geometry.get('c172s.pwr_plug', () => cylinderZ(0.0065, 0.006, 0, 0.03, 16)), mats.get('plasticBlack'));
    pwrPlug.add(pp);
    pwrPlug.name = 'pwr_plug';
    pwrPlug.userData.cockpitDynamic = true;
    pwrPlug.visible = false;
    face.addObject(pwrPlug, jackX - 0.008, jackY - 0.004, { z: 0.008 });
    face.add(
      new PushButton(env, { id: 'c172s.aux_audio_jack', label: 'AUX AUDIO IN jack (click: plug in / unplug a portable audio device)', var: ST.auxJack, mode: 'toggle', style: 'round', width: 0.005, capMaterial: 'chrome', engraved: '', zone: null }),
      jackX + 0.01,
      jackY - 0.004,
      { z: 0.004 },
    );
    txt('AUX\nAUDIO\nIN', jackX + 0.01, jackY + 0.011, 0.0011);
    // Plug of the portable device (visible while plugged in).
    const plug = new THREE.Mesh(env.geometry.get('c172s.aux_plug', () => cylinderZ(0.003, 0.0035, 0, 0.022, 12)), mats.get('plasticBlack'));
    auxPlug.add(plug);
    auxPlug.name = 'aux_plug';
    auxPlug.userData.cockpitDynamic = true;
    auxPlug.visible = false;
    face.addObject(auxPlug, jackX + 0.01, jackY - 0.004, { z: 0.006 });
  }
  // FUEL SHUTOFF valve [33]: red knob, push ON / pull OFF, placard "FUEL SHUTOFF / PULL OFF" under
  // it and a rectangular recess to its left (VH-SPQ photograph).
  face.add(
    new PushPullKnob(env, { id: 'c172s.fuel_shutoff', label: 'FUEL SHUTOFF (push ON / pull OFF)', var: C172.fuelShutoff, valueIn: 1, valueOut: 0, style: 'plain', travel: 0.04, material: 'knobRed', clickToggles: true }),
    0.108,
    0.245,
  );
  txt('FUEL SHUTOFF\nPULL OFF', 0.106, 0.268, 0.0017);
  {
    const recess = new THREE.Mesh(env.geometry.get('c172s.ped_recess', () => roundedBox(0.05, 0.022, 0.003, 0.004)), mats.custom('plastic', '#08080a', 0.9));
    recess.userData.cockpitStatic = true;
    face.addObject(recess, 0.042, 0.247, { z: 0.0006 });
  }
  // Pedestal light: "a single, hooded light located above the fuel selector" (POH Sec 7), on the
  // PEDESTAL LT dimmer ('pedestal' zone).
  {
    const hood = new THREE.Mesh(
      env.geometry.get('c172s.ped_hood', () => {
        const g = new THREE.CylinderGeometry(0.012, 0.012, 0.03, 16, 1, false, 0, Math.PI);
        g.rotateZ(Math.PI / 2);
        return g;
      }),
      black,
    );
    hood.userData.cockpitStatic = true;
    face.addObject(hood, PED.width / 2, len - 0.012, { z: 0.004 });
    const lens = new THREE.Mesh(env.geometry.get('c172s.ped_lamp', () => roundedBox(0.022, 0.006, 0.003, 0.002)), mats.custom('gloss', '#f3ead6', 0.3));
    lens.userData.cockpitStatic = true;
    face.addObject(lens, PED.width / 2, len - 0.006, { z: 0.002 });
  }
  const footTilt = (Math.atan2((PED.footFs - PED.botFs) * IN, PED.botH - PED.footH) * 180) / Math.PI;
  const footLen = Math.hypot((PED.footFs - PED.botFs) * IN, PED.botH - PED.footH);
  const footMid: [number, number] = [(PED.botFs + PED.footFs) / 2, (PED.botH + PED.footH) / 2];
  env.lighting.addFloodLight('c172s.ped_light', 'pedestal', [sta(PED.botFs - 0.4), 0, hz(PED.botH + 0.01)], [sta(footMid[0]), 0, hz(footMid[1])], b.root, 0.6, 70);

  // Fuel selector [34] on the sloped foot of the pedestal (POH placard: LEFT / BOTH / RIGHT); the
  // handle is a cream pointer (VH-SPQ photograph).
  const foot = b.panel({
    name: 'c172s.fuel_selector_plate',
    center_m: [sta(footMid[0]) - 0.003 * Math.cos((footTilt * Math.PI) / 180), 0, hz(footMid[1] + 0.003 * Math.sin((footTilt * Math.PI) / 180))],
    facing: 'aft',
    tiltDeg: footTilt,
    width: PED.footWidth,
    height: footLen,
    origin: 'center',
    material: mats.custom('paint', '#141414', 0.6),
    thickness: 0.006,
    radius: 0.01,
    screws: { positions: [[-PED.footWidth / 2 + 0.01, -footLen / 2 + 0.01], [PED.footWidth / 2 - 0.01, -footLen / 2 + 0.01], [-PED.footWidth / 2 + 0.01, footLen / 2 - 0.01], [PED.footWidth / 2 - 0.01, footLen / 2 - 0.01]] },
  });
  foot.add(
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
      placardDiameter: 0.12,
      diameter: 0.07,
      labelHeight: 0.0034,
      material: mats.custom('plastic', '#e8e2d2', 0.45),
    }),
    0,
    0.004,
  );
  void RockerSwitch;
  return { auxPlug, pwrPlug };
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
      // POH Fig 7-2 item 43 / VH-SPQ: a wide flat bar handle (~5 in, EST) centred at X -12.6 in.
      barWidth: 0.127,
    }),
    px(-12.6),
    py(PANEL.heightIn + 0.8),
    { z: -0.01 },
  );
}
