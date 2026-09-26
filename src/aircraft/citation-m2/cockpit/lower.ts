/**
 * Citation M2 tilt panels, landing gear control module and the controls
 * beneath the instrument panel.
 *
 * S&D15 §10.2.C "Installed on Tilt Panel (left to right)": pressurization
 * controls, ice protection controls, windshield anti-ice controls, fuel
 * controls, manual temp controls, landing gear control module, lighting
 * controls, emergency comm switch, event marker, cockpit voice recorder
 * controller, flight hour meter, ELT remote switch. The M2 documents do not
 * publish the switch faces; names, positions and values follow the dossier
 * inventory (docs/aircraft/citation-m2.md §9.4-9.6, EST CJ family). The
 * controls the S&D does not list on the tilt panel (SYSTEM TEST rotary,
 * cabin fan / air distribution, PASS OXY, cabin lights) are placed with the
 * nearest listed group (EST).
 * S&D15 §10.2.E "Installed beneath the instrument panel": emergency brake
 * handle, parking brake handle, emergency gear release, control locks, rain
 * removal levers.
 */
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import { AnnunciatorLight, GearHandle, GuardedSwitch, PushButton, PushPullKnob, RotaryKnob, SelectorKnob, TBarHandle, ToggleSwitch } from '../../../cockpit/controls';
import type { CockpitDisplay } from '../../../cockpit/types';
import { M2, TEST_SEL } from '../vars';
import { GEAR_MODULE, MAIN, TILT, downFace } from './layout';
import { NullDisplay } from './panels';

type Env = CockpitBuilder['env'];

function tiltPanel(b: CockpitBuilder, name: string, y0: number, y1: number): Panel {
  const [cx, cz] = downFace(TILT.topX, TILT.topZ, TILT.tiltDeg, TILT.height / 2);
  return b.panel({ name, center_m: [cx, (y0 + y1) / 2, cz], facing: 'aft', tiltDeg: TILT.tiltDeg, width: y1 - y0, height: TILT.height, origin: 'top-left', screws: { kind: 'dzus', diameter: 0.006, inset: 0.006, pitch: 0.3 }, material: 'panel' });
}

const tog = (env: Env, id: string, v: string, name: string, positions: string[], values?: number[], extra: Partial<ConstructorParameters<typeof ToggleSwitch>[1]> = {}) =>
  new ToggleSwitch(env, { id, var: v, label: name, positions, values, labels: { name, positions: true, height: 0.0024 }, scale: 0.85, ...extra });

const dimmer = (env: Env, id: string, v: string, name: string) =>
  new RotaryKnob(env, { id, label: name, cap: 'dimmer', diameter: 0.013, outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], format: (x) => (x <= 0.001 ? 'OFF' : `${Math.round(x * 100)} %`) } });

function bracket(p: Panel, title: string, x0: number, x1: number): void {
  p.bracket(title, (x0 + x1) / 2, 0.011, x1 - x0, { height: 0.0024 });
}

export function buildTiltPanels(b: CockpitBuilder, displays: Map<string, CockpitDisplay>): void {
  const env = b.env;
  // ------------------------------------------------------------------ LH tilt panel
  const L = tiltPanel(b, 'm2.tilt.l', TILT.left.y0, TILT.left.y1);
  const r1 = 0.043;
  const r2 = 0.106;
  // PRESSURIZATION (S&D15 §9.5; CJ1+ S&D "air source selection, emergency cabin pressure dump, manual pressure control").
  bracket(L, 'PRESSURIZATION', 0.006, 0.118);
  L.add(
    new SelectorKnob(env, {
      id: 'm2.press_source',
      var: M2.pressSource,
      label: 'PRESS SOURCE',
      cap: 'pointer',
      diameter: 0.016,
      labelHeight: 0.0019,
      positions: [
        { value: 0, label: 'OFF', angle: -80 },
        { value: 1, label: 'L', angle: -40 },
        { value: 2, label: 'R', angle: 0 },
        { value: 3, label: 'NORM', angle: 40 },
        { value: 4, label: 'EMER', angle: 80 },
      ],
      initial: 3,
      title: 'SOURCE',
    }),
    0.033,
    0.07,
  );
  L.add(tog(env, 'm2.press_mode', M2.pressMode, 'MODE', ['AUTO', 'MAN'], [0, 2]), 0.078, r1);
  L.add(tog(env, 'm2.press_manual', M2.pressManual, 'MANUAL', ['DN', '', 'UP'], [-1, 0, 1], { initial: 1, springs: { 0: 1, 2: 1 } }), 0.104, r1);
  L.add(
    new GuardedSwitch(env, {
      id: 'm2.cabin_dump',
      var: M2.cabinDump,
      label: 'CABIN DUMP',
      positions: ['NORM', 'DUMP'],
      values: [0, 1],
      scale: 0.85,
      labels: { name: 'CABIN DUMP', positions: true, height: 0.0021 },
      guard: { color: 'red', guardedPosition: 0, hinge: 'top' },
    }),
    0.091,
    r2 + 0.006,
  );
  // ICE PROTECTION (S&D15 §9.7).
  bracket(L, 'ICE PROTECTION', 0.124, 0.238);
  L.add(tog(env, 'm2.pitot_static', M2.pitotStaticSw, 'PITOT & STATIC', ['OFF', 'ON']), 0.142, r1);
  L.add(tog(env, 'm2.eng_ai1', M2.engAiSw(1), 'ENG L', ['OFF', 'ON']), 0.183, r1);
  L.add(tog(env, 'm2.eng_ai2', M2.engAiSw(2), 'ENG R', ['OFF', 'ON']), 0.21, r1);
  L.add(tog(env, 'm2.wing_ai', M2.wingAiSw, 'WING', ['OFF', 'ON']), 0.155, r2);
  L.add(tog(env, 'm2.tail_deice', M2.tailDeiceSw, 'TAIL DE-ICE', ['MANUAL', 'OFF', 'AUTO'], [-1, 0, 1], { initial: 1, springs: { 0: 1 } }), 0.2, r2);
  // WINDSHIELD ANTI-ICE: L / R bleed OFF / LOW / HI, pilot windshield alcohol back-up (guarded).
  bracket(L, 'W/S ANTI-ICE', 0.244, 0.31);
  L.add(tog(env, 'm2.ws_bleed1', M2.wsBleedSw(1), 'L', ['OFF', 'LOW', 'HI']), 0.26, r1);
  L.add(tog(env, 'm2.ws_bleed2', M2.wsBleedSw(2), 'R', ['OFF', 'LOW', 'HI']), 0.292, r1);
  L.add(
    new GuardedSwitch(env, {
      id: 'm2.ws_alcohol',
      var: M2.wsAlcoholSw,
      label: 'W/S ALCOHOL',
      positions: ['OFF', 'ON'],
      scale: 0.85,
      labels: { name: 'ALCOHOL', positions: true, height: 0.0021 },
      guard: { color: 'black', guardedPosition: 0 },
    }),
    0.276,
    r2 + 0.006,
  );
  // FUEL (S&D15 §9.2): boost pumps NORM / ON, tank-to-tank transfer.
  bracket(L, 'FUEL', 0.316, 0.378);
  L.add(tog(env, 'm2.boost1', M2.boostSw(1), 'BOOST L', ['NORM', 'ON']), 0.33, r1);
  L.add(tog(env, 'm2.boost2', M2.boostSw(2), 'BOOST R', ['NORM', 'ON']), 0.362, r1);
  L.add(
    new SelectorKnob(env, {
      id: 'm2.fuel_xfer',
      var: M2.fuelXfer,
      label: 'FUEL TRANSFER',
      cap: 'pointer',
      diameter: 0.015,
      labelHeight: 0.0019,
      positions: [
        { value: -1, label: 'L TANK', angle: -55 },
        { value: 0, label: 'OFF', angle: 0 },
        { value: 1, label: 'R TANK', angle: 55 },
      ],
      initial: 1,
      title: 'TRANSFER',
    }),
    0.347,
    r2 + 0.004,
  );
  // MANUAL TEMP (S&D15 §9.5 digital temperature control; manual back-up).
  bracket(L, 'TEMP', 0.384, 0.449);
  L.add(tog(env, 'm2.temp_mode', M2.tempMode, 'CONTROL', ['AUTO', 'MAN']), 0.397, r1);
  L.add(tog(env, 'm2.air_cond', M2.airCondSw, 'AIR COND', ['OFF', 'ON']), 0.43, r1);
  L.add(
    new RotaryKnob(env, {
      id: 'm2.temp_sel',
      label: 'TEMP SELECT',
      cap: 'pointer',
      diameter: 0.015,
      outer: { var: M2.tempSel, min: 0, max: 1, step: 0.05, initial: 0.5, angleRange: [-135, 135], format: (x) => `${Math.round(16 + 12 * x)} C` },
    }),
    0.399,
    r2,
  );
  L.label('COLD  HOT', 0.399, r2 + 0.016, { height: 0.0018, weight: 600 });
  L.add(tog(env, 'm2.temp_man', M2.tempManual, 'MANUAL', ['COLD', '', 'HOT'], [-1, 0, 1], { initial: 1, springs: { 0: 1, 2: 1 }, orientation: 'horizontal' }), 0.432, r2);

  // ------------------------------------------------------------------ Landing gear control module (S&D15 §7, §10.2.C)
  {
    const [top0x, top0z] = [MAIN.center[0] - (MAIN.height / 2) * Math.sin((MAIN.tiltDeg * Math.PI) / 180), MAIN.center[2] + (MAIN.height / 2) * Math.cos((MAIN.tiltDeg * Math.PI) / 180)];
    const [cx, cz] = downFace(top0x, top0z, GEAR_MODULE.tiltDeg, GEAR_MODULE.height / 2);
    const G = b.panel({
      name: 'm2.gear',
      center_m: [cx, (GEAR_MODULE.y0 + GEAR_MODULE.y1) / 2, cz],
      facing: 'aft',
      tiltDeg: GEAR_MODULE.tiltDeg,
      width: GEAR_MODULE.y1 - GEAR_MODULE.y0,
      height: GEAR_MODULE.height,
      origin: 'top-left',
      screws: { kind: 'dzus', diameter: 0.006, positions: [[0.006, 0.006], [0.109, 0.006], [0.006, 0.134], [0.109, 0.134]] },
    });
    G.label('LANDING GEAR', 0.0575, 0.011, { height: 0.0024 });
    const legs: [string, number][] = [
      ['NOSE', 0.0575],
      ['LH', 0.03],
      ['RH', 0.085],
    ];
    legs.forEach(([lab, x], i) => {
      G.add(new AnnunciatorLight(env, { id: `m2.gear.green${i}`, label: `${lab} GEAR DOWN`, width: 0.016, height: 0.011, segments: [{ text: lab, color: 'green', var: `gear.green${i}`, style: 'field' }] }), x, i === 0 ? 0.026 : 0.041);
    });
    G.add(
      new AnnunciatorLight(env, {
        id: 'm2.gear.unlocked',
        label: 'GEAR UNLOCKED',
        width: 0.03,
        height: 0.009,
        segments: [{ text: 'UNLOCKED', color: 'red', var: 'gear.red0', test: () => env.vars.get('gear.red0') + env.vars.get('gear.red1') + env.vars.get('gear.red2') > 0, style: 'field' }],
      }),
      0.0575,
      0.056,
    );
    G.add(
      new GearHandle(env, {
        id: 'm2.gear.handle',
        var: M2.gearHandle,
        label: 'LANDING GEAR',
        positions: ['DN', 'UP'],
        values: [1, 0],
        initial: 0,
        length: 0.06,
        swingDeg: 26,
        // Down-lock solenoid: the handle cannot be raised with weight on wheels (gear.handle_lock).
        inhibit: (to, _from, v) => !(to === 1 && v.get('gear.handle_lock') !== 0),
      }),
      0.036,
      0.1,
    );
    G.add(new PushButton(env, { id: 'm2.gear.horn_sil', var: M2.gearHornSilence, label: 'GEAR HORN SILENCE', style: 'round', width: 0.009, mode: 'momentary', engraved: '', name: 'HORN SIL' }), 0.088, 0.083);
    G.add(tog(env, 'm2.antiskid', M2.antiskidSw, 'ANTISKID', ['OFF', 'ON'], undefined, { initial: 1 }), 0.088, 0.117);
  }

  // ------------------------------------------------------------------ RH tilt panel
  const R = tiltPanel(b, 'm2.tilt.r', TILT.right.y0, TILT.right.y1);
  // LIGHTING (S&D21 §9.4: position, anti-collision strobes + beacon, landing / recognition with Pulselite, taxi, logo, wing inspection).
  bracket(R, 'LIGHTS', 0.006, 0.24);
  R.add(tog(env, 'm2.nav_lt', M2.navLt, 'NAV', ['OFF', 'ON']), 0.022, r1);
  R.add(tog(env, 'm2.anti_coll', M2.antiColl, 'ANTI-COLL', ['OFF', 'BCN', 'ALL']), 0.052, r1);
  R.add(tog(env, 'm2.landing_lt', M2.landingLt, 'LDG/RECOG', ['OFF', 'PULSE', 'ON']), 0.086, r1);
  R.add(tog(env, 'm2.taxi_lt', M2.taxiLt, 'TAXI', ['OFF', 'ON']), 0.118, r1);
  R.add(tog(env, 'm2.logo_lt', M2.logoLt, 'TAIL', ['OFF', 'ON']), 0.145, r1);
  R.add(tog(env, 'm2.wing_insp', M2.wingInspLt, 'WING INSP', ['OFF', 'ON']), 0.175, r1);
  R.add(tog(env, 'm2.pax_safety', M2.paxSafety, 'PASS SAFETY', ['OFF', 'BELT', 'BELT & NS']), 0.214, r1);
  const dims: [string, string, string][] = [
    ['m2.panel_lt', M2.panelLt, 'PANEL'],
    ['m2.pedestal_lt', M2.pedestalLt, 'PED'],
    ['m2.flood_lt', M2.floodLt, 'FLOOD'],
    ['m2.map_lt1', M2.mapLt(1), 'MAP L'],
    ['m2.map_lt2', M2.mapLt(2), 'MAP R'],
  ];
  dims.forEach(([id, v, name], i) => {
    const x = 0.022 + i * 0.031;
    R.add(dimmer(env, id, v, `${name} LIGHTS`), x, r2);
    R.label(name, x, r2 - 0.014, { height: 0.0021 });
  });
  R.add(tog(env, 'm2.cabin_lt', M2.cabinLt, 'CABIN', ['OFF', 'ON']), 0.2, r2);
  // SYSTEM TEST rotary (CJ1+ S&D "rotary test switch"; positions EST).
  bracket(R, 'SYSTEM TEST', 0.248, 0.338);
  R.add(
    new SelectorKnob(env, {
      id: 'm2.test_sel',
      var: M2.testSel,
      label: 'SYSTEM TEST',
      cap: 'bar',
      diameter: 0.017,
      labelHeight: 0.0018,
      positions: [
        { value: TEST_SEL.off, label: 'OFF', angle: -90 },
        { value: TEST_SEL.fire, label: 'FIRE WARN', display: 'FIRE\nWARN', angle: -60 },
        { value: TEST_SEL.annu, label: 'ANNU', angle: -30 },
        { value: TEST_SEL.stall, label: 'STALL WARN', display: 'STALL\nWARN', angle: 0 },
        { value: TEST_SEL.overspeed, label: "O'SPEED", angle: 30 },
        { value: TEST_SEL.gear, label: 'LDG GEAR', display: 'LDG\nGEAR', angle: 60 },
        { value: TEST_SEL.taws, label: 'TAWS', angle: 90 },
      ],
      initial: 0,
    }),
    0.293,
    0.083,
  );
  // CABIN AIR / OXYGEN.
  bracket(R, 'CABIN', 0.346, 0.44);
  R.add(
    new SelectorKnob(env, {
      id: 'm2.pax_oxy',
      var: M2.paxOxy,
      label: 'PASS OXY',
      cap: 'pointer',
      diameter: 0.015,
      labelHeight: 0.0018,
      positions: [
        { value: 0, label: 'CREW ONLY', display: 'CREW\nONLY', angle: -50 },
        { value: 1, label: 'NORM', angle: 0 },
        { value: 2, label: 'MANUAL DROP', display: 'MAN\nDROP', angle: 50 },
      ],
      initial: 1,
      title: 'PASS OXY',
    }),
    0.37,
    0.083,
  );
  R.add(tog(env, 'm2.cabin_fan', M2.cabinFan, 'CAB FAN', ['OFF', 'LOW', 'HIGH']), 0.418, r1);
  R.add(
    new RotaryKnob(env, {
      id: 'm2.air_distrib',
      label: 'AIR DISTRIBUTION',
      cap: 'pointer',
      diameter: 0.014,
      outer: { var: M2.airDistrib, min: 0, max: 1, step: 0.05, initial: 0.3, angleRange: [-120, 120], format: (x) => (x < 0.1 ? 'CABIN' : x > 0.9 ? 'DEFOG' : `${Math.round(x * 100)} % DEFOG`) },
    }),
    0.418,
    r2 + 0.004,
  );
  R.label('CAB   DEFOG', 0.418, r2 + 0.02, { height: 0.0018, weight: 600 });
  // EMER COMM, EVENT marker, CVR controller, flight hour meter, ELT remote switch (S&D15 §10.2.C / §10.3.G / §10.3.V).
  bracket(R, 'COMM / RECORDERS', 0.448, 0.572);
  R.add(
    new GuardedSwitch(env, {
      id: 'm2.emer_comm',
      var: M2.emerComm,
      label: 'EMER COMM (COM 1 121.5)',
      positions: ['NORM', 'EMER'],
      scale: 0.85,
      labels: { name: 'EMER COMM', positions: true, height: 0.0021 },
      guard: { color: 'red', guardedPosition: 0 },
    }),
    0.465,
    r1 + 0.004,
  );
  R.add(new PushButton(env, { id: 'm2.event', var: M2.eventMarker, label: 'EVENT MARKER', style: 'korry', width: 0.013, height: 0.011, mode: 'momentary', segments: [{ text: 'EVENT', color: 'white', var: 'ac.m2.event_marker_lt' }] }), 0.497, r1 - 0.004);
  R.add(new PushButton(env, { id: 'm2.cvr_test', var: M2.cvrTest, label: 'CVR TEST', style: 'korry', width: 0.013, height: 0.011, mode: 'momentary', segments: [{ text: ['CVR', 'TEST'], color: 'green', var: 'ac.m2.cvr_test_lt' }] }), 0.52, r1 - 0.004);
  R.add(tog(env, 'm2.elt', M2.eltSw, 'ELT', ['RESET', 'ARM', 'ON'], [-1, 0, 1], { initial: 1, springs: { 0: 1 } }), 0.553, r1);
  R.label('ELT', 0.553, r1 + 0.02, { height: 0.0019 });
  R.display(displays.get('hobbs') ?? new NullDisplay('hobbs'), 0.51, r2 + 0.004, 0.038, 0.0114, { bezel: { border: 0.003, depth: 0.004 }, display: { boot: false } });
  R.label('HOURS', 0.51, r2 - 0.011, { height: 0.0021 });
}

/** Handles and levers beneath the instrument panel (S&D15 §10.2.E), plus the rain removal levers. */
export function buildUnderPanel(b: CockpitBuilder): void {
  const env = b.env;
  // Knee panel under the LH tilt panel / gear module, left of the pedestal (photograph: red handles below the gear handle).
  const K = b.panel({ name: 'm2.knee.l', center_m: [3.56, -0.32, 0.29], facing: 'aft', tiltDeg: -4, width: 0.3, height: 0.2, origin: 'top-left', screws: { kind: 'phillips', pitch: 0.15 }, material: 'panel' });
  K.add(new TBarHandle(env, { id: 'm2.park_brake', var: M2.parkBrake, label: 'PARKING BRAKE', style: 'tbar', rotate: 'none', legend: 'PARK BRAKE', scale: 0.9 }), 0.225, 0.05);
  K.label('PARKING BRAKE', 0.225, 0.017, { height: 0.0024 });
  K.add(new PushPullKnob(env, { id: 'm2.emer_brake', var: M2.emerBrake, label: 'EMERGENCY BRAKE', style: 'plain', valueIn: 0, valueOut: 1, travel: 0.06, clickToggles: false, legend: 'EMER BRAKE' }), 0.275, 0.05);
  K.label('EMER BRAKE', 0.275, 0.017, { height: 0.0024 });
  K.add(new TBarHandle(env, { id: 'm2.gear_emer', var: M2.gearEmerRelease, label: 'EMERGENCY GEAR RELEASE', style: 'tbar', legend: 'GEAR', material: 'knobRed', scale: 0.9 }), 0.225, 0.13);
  K.label('EMER GEAR RELEASE', 0.225, 0.1, { height: 0.0024 });
  K.add(new TBarHandle(env, { id: 'm2.gear_blowdown', var: M2.gearBlowdown, label: 'GEAR BLOW DOWN', style: 'knob', material: 'knobRed', scale: 0.8 }), 0.275, 0.13);
  K.label('BLOW DOWN', 0.275, 0.1, { height: 0.0024 });
  // Integral control lock (S&D15 §9.1: "below the pilot's panel ... rudder, elevators, ailerons, and throttles").
  K.add(new TBarHandle(env, { id: 'm2.control_lock', var: M2.controlLock, label: 'CONTROL LOCK', style: 'lever', rotate: 'lock', springIn: true, legend: 'CONTROL LOCK', scale: 0.9 }), 0.03, 0.1);
  K.label('CONTROL LOCK', 0.03, 0.06, { height: 0.0024 });
  K.label('PULL - TURN', 0.03, 0.145, { height: 0.002, weight: 600 });
  // Rain removal door levers L / R (outboard, beneath each side of the panel).
  for (const s of [1, 2] as const) {
    const y = s === 1 ? -0.64 : 0.64;
    const P = b.panel({ name: `m2.rain${s}`, center_m: [3.5, y, 0.24], facing: 'aft', tiltDeg: -4, width: 0.07, height: 0.07, origin: 'top-left', screws: false, material: 'panel' });
    P.add(new TBarHandle(env, { id: `m2.rain_door${s}`, var: M2.rainDoor(s), label: `${s === 1 ? 'L' : 'R'} RAIN DOOR`, style: 'ring', scale: 0.8 }), 0.035, 0.04);
    P.label('RAIN DOOR', 0.035, 0.01, { height: 0.0022 });
  }
}
