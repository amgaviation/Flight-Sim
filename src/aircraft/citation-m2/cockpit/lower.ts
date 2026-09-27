/**
 * Citation M2 tilt panels, landing gear control module and the handles
 * beneath the instrument panel.
 *
 * S&D15 §10.2.C "Installed on Tilt Panel (left to right)": pressurization
 * controls, ice protection controls, windshield anti-ice controls, fuel
 * controls, manual temp controls, landing gear control module, lighting
 * controls, emergency comm switch, event marker, cockpit voice recorder
 * controller, flight hour meter, ELT remote switch.
 *
 * Layout (M2-L17..L25, EST from photographs pin1, Skies 2017, Jetcraft
 * 525-0851, listing 9525 #24 and S&D21 Fig 3; the M2 documents do not publish
 * the switch faces, so names are EST until confirmed against a legible
 * reference):
 *  - LH tilt panel (one plane with the gear module, joined by a seam; ~30 deg,
 *    ~110 mm band): outboard a red-guarded CABIN DUMP and the AIR SOURCE
 *    SELECT rotary; the two W/S BLEED rotaries (white arc scales) with green
 *    flow lights and the guarded W/S ALCOHOL; the ICE PROTECTION toggles with
 *    green status lights; FUEL BOOST L / R (OFF / NORM / ON); next to the gear
 *    module only the two manual-temperature switches (TEMP CONTROL AUTO / MAN
 *    and the spring-loaded COLD / HOT with position dots).
 *    Functions the G3000 runs (AOPA Mar 2014 / Twin & Turbine: pressurization,
 *    air conditioning, system tests, ignition, interior lights) are on the GTC
 *    Aircraft Systems pages (systems/eis.ts), not duplicated as hardware.
 *  - Gear module: three green lights in a triangle beside the gear handle,
 *    whose translucent knob lights red while the gear is in transit / unsafe
 *    (EST CJ family), the ANTI-SKID switch at the right edge and the AUX GEAR
 *    CONTROL placard.
 *  - RH tilt panel: two rows of toggles (exterior lights, EMER LTS), EMER COMM
 *    (guarded), ELT, EVENT push button, CVR TEST, flight hour meter, green
 *    status lights. The dimmers are on the glareshield DIMMING group.
 *
 * S&D15 §10.2.E "Installed beneath the instrument panel": emergency brake
 * handle, parking brake handle, emergency gear release, control locks, rain
 * removal levers. Photos: the red handles protrude from just below the LH
 * tilt panel / gear module lower edge (no separate knee panel).
 */
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import { AnnunciatorLight, GearHandle, GuardedSwitch, PushButton, PushPullKnob, SelectorKnob, TBarHandle, ToggleSwitch } from '../../../cockpit/controls';
import type { CockpitDisplay } from '../../../cockpit/types';
import { M2, PRESS_SRC } from '../vars';
import { TILT, downFace } from './layout';
import { NullDisplay } from './panels';
import { fittedPlate } from './fit';

type Env = CockpitBuilder['env'];

/** Tilt panel spanning body y0..y1 (invisible frame + plate clipped to the lining). */
function tiltPanel(b: CockpitBuilder, name: string, y0: number, y1: number): Panel {
  const [cx, cz] = downFace(TILT.topX, TILT.topZ, TILT.tiltDeg, TILT.height / 2);
  const cy = (y0 + y1) / 2;
  const p = b.panel({ name, center_m: [cx, cy, cz], facing: 'aft', tiltDeg: TILT.tiltDeg, width: y1 - y0, height: TILT.height, origin: 'top-left', screws: false, invisible: true });
  fittedPlate(b, p, { topX: TILT.topX, topZ: TILT.topZ, tiltDeg: TILT.tiltDeg, height: TILT.height, width: y1 - y0 }, { name, centerY: cy, y0, y1, material: 'panel' });
  return p;
}

const tog = (env: Env, id: string, v: string, name: string, positions: string[], values?: number[], extra: Partial<ConstructorParameters<typeof ToggleSwitch>[1]> = {}) =>
  new ToggleSwitch(env, { id, var: v, label: name, positions, values, labels: { name, positions: true, height: 0.0021 }, scale: 0.75, ...extra });

/** Green status light (LED) beside a tilt-panel switch (M2-L20; EST mapping). */
const green = (env: Env, id: string, label: string, v: string) =>
  new AnnunciatorLight(env, { id, label, width: 0.0045, height: 0.0045, bezel: false, segments: [{ text: '', color: 'green', var: v }] });

function bracket(p: Panel, title: string, x0: number, x1: number): void {
  p.bracket(title, (x0 + x1) / 2, 0.009, x1 - x0, { height: 0.0023 });
}

/** Tilt-panel face tilt/z helpers for the under-panel lip. */
const TILT_BOTTOM = downFace(TILT.topX, TILT.topZ, TILT.tiltDeg, TILT.height);

export function buildTiltPanels(b: CockpitBuilder, displays: Map<string, CockpitDisplay>): void {
  const env = b.env;
  // ------------------------------------------------------------------ LH tilt panel (with the gear module)
  const LY0 = -0.74;
  const LY1 = -0.165;
  const L = tiltPanel(b, 'm2.tilt.l', LY0, LY1);
  const r1 = 0.042;
  const lt = 0.089; // green light row
  // PRESSURIZATION: CABIN DUMP (red guard) and AIR SOURCE SELECT (CJ-family AFM: BOTH normally, FRESH AIR smoke).
  bracket(L, 'PRESSURIZATION', 0.008, 0.08);
  L.add(
    new GuardedSwitch(env, {
      id: 'm2.cabin_dump',
      var: M2.cabinDump,
      label: 'CABIN DUMP',
      positions: ['NORM', 'DUMP'],
      values: [0, 1],
      scale: 0.75,
      labels: { name: 'DUMP', positions: true, height: 0.0021 },
      guard: { color: 'red', guardedPosition: 0, hinge: 'top' },
    }),
    0.022,
    0.05,
  );
  L.add(
    new SelectorKnob(env, {
      id: 'm2.press_source',
      var: M2.pressSource,
      label: 'AIR SOURCE SELECT',
      cap: 'pointer',
      diameter: 0.014,
      labelHeight: 0.0017,
      labelRadius: 0.017,
      positions: [
        { value: PRESS_SRC.off, label: 'OFF', angle: -100 },
        { value: PRESS_SRC.l, label: 'L', angle: -60 },
        { value: PRESS_SRC.both, label: 'BOTH', angle: -20 },
        { value: PRESS_SRC.r, label: 'R', angle: 20 },
        { value: PRESS_SRC.emer, label: 'EMER', angle: 60 },
        { value: PRESS_SRC.fresh, label: 'FRESH AIR', display: 'FRESH\nAIR', angle: 100 },
      ],
      initial: PRESS_SRC.both,
    }),
    0.056,
    0.062,
  );
  L.label('AIR SOURCE', 0.056, 0.024, { height: 0.0018 });
  // WINDSHIELD: L / R W/S BLEED rotary valves OFF / LOW / HI (white arc scales) with green flow lights; ALCOHOL (guarded).
  bracket(L, 'WINDSHIELD', 0.086, 0.19);
  for (const [i, x] of [
    [1, 0.101],
    [2, 0.135],
  ] as const) {
    L.add(
      new SelectorKnob(env, {
        id: `m2.ws_bleed${i}`,
        var: M2.wsBleedSw(i),
        label: `${i === 1 ? 'L' : 'R'} W/S BLEED`,
        cap: 'pointer',
        diameter: 0.013,
        labelHeight: 0.0017,
        labelRadius: 0.0155,
        positions: [
          { value: 0, label: 'OFF', angle: -60 },
          { value: 1, label: 'LOW', angle: 0 },
          { value: 2, label: 'HI', angle: 60 },
        ],
        initial: 0,
      }),
      x,
      0.055,
    );
    L.label(i === 1 ? 'L' : 'R', x, 0.024, { height: 0.0021 });
    L.add(green(env, `m2.ws_bleed${i}_lt`, `${i === 1 ? 'L' : 'R'} W/S BLEED FLOW`, `ac.m2.ws_bleed${i}_lt`), x, lt);
  }
  L.add(
    new GuardedSwitch(env, {
      id: 'm2.ws_alcohol',
      var: M2.wsAlcoholSw,
      label: 'W/S ALCOHOL',
      positions: ['OFF', 'ON'],
      scale: 0.75,
      labels: { name: 'ALCOHOL', positions: true, height: 0.0021 },
      guard: { color: 'black', guardedPosition: 0 },
    }),
    0.171,
    0.05,
  );
  // ICE PROTECTION (S&D15 §9.7) with green status lights (valve open and flow adequate / heaters powered).
  bracket(L, 'ICE PROTECTION', 0.196, 0.338);
  const ice: [string, string, string, string[], number[] | undefined, Partial<ConstructorParameters<typeof ToggleSwitch>[1]>, string | null][] = [
    ['m2.pitot_static', M2.pitotStaticSw, 'P/S HEAT', ['OFF', 'ON'], undefined, {}, 'ac.m2.ps_heat_lt'],
    ['m2.eng_ai1', M2.engAiSw(1), 'ENG L', ['OFF', 'ON'], undefined, {}, 'ac.m2.eai1_lt'],
    ['m2.eng_ai2', M2.engAiSw(2), 'ENG R', ['OFF', 'ON'], undefined, {}, 'ac.m2.eai2_lt'],
    ['m2.wing_ai', M2.wingAiSw, 'WING', ['OFF', 'ON'], undefined, {}, 'ac.m2.wai_lt'],
    ['m2.tail_deice', M2.tailDeiceSw, 'TAIL', ['MAN', 'OFF', 'AUTO'], [-1, 0, 1], { initial: 1, springs: { 0: 1 } }, null],
  ];
  ice.forEach(([id, v, name, pos, vals, extra, lamp], k) => {
    const x = 0.21 + k * 0.0285;
    L.add(tog(env, id, v, name, pos, vals, extra), x, r1);
    if (lamp) L.add(green(env, `${id}_lt`, `${name} ON`, lamp), x, lt);
  });
  // FUEL BOOST L / R: OFF / NORM / ON (CAE differences p.5-30). Transfer: GTC FUEL page (systems/eis.ts).
  bracket(L, 'FUEL BOOST', 0.344, 0.394);
  L.add(tog(env, 'm2.boost1', M2.boostSw(1), 'L', ['OFF', 'NORM', 'ON'], [-1, 0, 1], { initial: 1 }), 0.357, r1);
  L.add(tog(env, 'm2.boost2', M2.boostSw(2), 'R', ['OFF', 'NORM', 'ON'], [-1, 0, 1], { initial: 1 }), 0.382, r1);
  // MANUAL TEMP (S&D15 §10.2.C "Manual Temp Controls"): AUTO / MAN and the spring-loaded COLD / HOT (position dots).
  bracket(L, 'TEMP', 0.4, 0.456);
  L.add(tog(env, 'm2.temp_mode', M2.tempMode, 'CONTROL', ['AUTO', 'MAN']), 0.413, r1);
  L.add(tog(env, 'm2.temp_man', M2.tempManual, 'MANUAL', ['COLD', '•', 'HOT'], [-1, 0, 1], { initial: 1, springs: { 0: 1, 2: 1 } }), 0.442, r1);

  // ------------------------------------------------------------------ Landing gear control module (inboard end of the LH tilt face)
  {
    const gx0 = 0.46; // seam
    L.line(gx0, 0.002, gx0, TILT.height - 0.002, 0.0008, null);
    const G = L.subPanel({ name: 'm2.gear', x: gx0 + 0.0575, y: TILT.height / 2, width: 0.115, height: TILT.height, origin: 'top-left', material: 'panel', screws: false, z: 0.0004 });
    G.label('LANDING GEAR', 0.0575, 0.008, { height: 0.0022 });
    const legs: [string, number, number][] = [
      ['NOSE', 0.026, 0.028],
      ['LH', 0.014, 0.046],
      ['RH', 0.038, 0.046],
    ];
    legs.forEach(([lab, x, y], i) => {
      G.add(new AnnunciatorLight(env, { id: `m2.gear.green${i}`, label: `${lab} GEAR DOWN`, width: 0.011, height: 0.011, segments: [{ text: lab, color: 'green', var: `gear.green${i}`, style: 'field' }] }), x, y);
    });
    G.add(
      new GearHandle(env, {
        id: 'm2.gear.handle',
        var: M2.gearHandle,
        label: 'LANDING GEAR',
        positions: ['DN', 'UP'],
        values: [1, 0],
        initial: 0,
        length: 0.05,
        swingDeg: 26,
        knobScale: 0.85,
        // Translucent knob lit red while the gear is in transit / unsafe (EST: CJ family; lamp test via the gear lights test).
        lights: [{ var: 'ac.m2.gear_unsafe_lt', color: 'red' }],
        // Down-lock solenoid: the handle cannot be raised with weight on wheels (gear.handle_lock).
        inhibit: (to, _from, v) => !(to === 1 && v.get('gear.handle_lock') !== 0),
      }),
      0.066,
      0.05,
    );
    G.add(tog(env, 'm2.antiskid', M2.antiskidSw, 'ANTI-SKID', ['OFF', 'ON'], undefined, { initial: 1 }), 0.103, 0.05);
    // AUX GEAR CONTROL placard (EST wording, CJ-family emergency extension: T-handle, then blow-down).
    G.placard({ text: 'AUX GEAR CONTROL\n1. PULL T-HANDLE\n2. PULL BLOW DOWN\n   IF NOT 3 GREEN', height: 0.0014, style: 'plate', align: 'left' }, 0.078, 0.094);
    // SCOPE / EST: HORN SILENCE location not confirmed by a source; a small push button beside the gear lights.
    G.add(new PushButton(env, { id: 'm2.gear.horn_sil', var: M2.gearHornSilence, label: 'GEAR HORN SILENCE', style: 'round', width: 0.007, mode: 'momentary', engraved: '', name: 'HORN SIL' }), 0.026, 0.075);
  }

  // ------------------------------------------------------------------ RH tilt panel
  const R = tiltPanel(b, 'm2.tilt.r', 0.165, 0.74);
  const rA = 0.04;
  const rB = 0.085;
  // LIGHTS (S&D21 §9.4: position, anti-collision strobes + beacon, landing / recognition with Pulselite, taxi, logo,
  // wing inspection); EMER LTS OFF / ARMED / ON (M2 flows; EST location).
  bracket(R, 'LIGHTS', 0.012, 0.13);
  R.add(tog(env, 'm2.nav_lt', M2.navLt, 'NAV', ['OFF', 'ON']), 0.025, rA);
  R.add(tog(env, 'm2.anti_coll', M2.antiColl, 'ANTI-COLL', ['OFF', 'BCN', 'ALL']), 0.054, rA);
  R.add(tog(env, 'm2.landing_lt', M2.landingLt, 'LDG/RECOG', ['OFF', 'PULSE', 'ON']), 0.086, rA);
  R.add(tog(env, 'm2.taxi_lt', M2.taxiLt, 'TAXI', ['OFF', 'ON']), 0.116, rA);
  R.add(tog(env, 'm2.logo_lt', M2.logoLt, 'TAIL', ['OFF', 'ON']), 0.025, rB);
  R.add(tog(env, 'm2.wing_insp', M2.wingInspLt, 'WING INSP', ['OFF', 'ON']), 0.054, rB);
  R.add(tog(env, 'm2.emer_lts', M2.emerLtsSw, 'EMER LTS', ['OFF', 'ARMED', 'ON'], [0, 1, 2], { initial: 1 }), 0.086, rB);
  // EMER COMM, ELT, EVENT marker, CVR controller, flight hour meter (S&D15 §10.2.C / §10.3.G / §10.3.V).
  bracket(R, 'COMM / RECORDERS', 0.14, 0.29);
  R.add(
    new GuardedSwitch(env, {
      id: 'm2.emer_comm',
      var: M2.emerComm,
      label: 'EMER COMM (COM 1 121.5)',
      positions: ['NORM', 'EMER'],
      scale: 0.75,
      labels: { name: 'EMER COMM', positions: true, height: 0.0021 },
      guard: { color: 'red', guardedPosition: 0 },
    }),
    0.156,
    rA + 0.004,
  );
  R.add(green(env, 'm2.emer_comm_lt', 'EMER COMM SELECTED', 'ac.m2.emer_comm_lt'), 0.172, rA - 0.006);
  R.add(tog(env, 'm2.elt', M2.eltSw, 'ELT', ['RESET', 'ARM', 'ON'], [-1, 0, 1], { initial: 1, springs: { 0: 1 } }), 0.156, rB);
  R.add(green(env, 'm2.elt_lt', 'ELT ACTIVE', 'ac.m2.elt_lt'), 0.172, rB - 0.01);
  R.add(new PushButton(env, { id: 'm2.event', var: M2.eventMarker, label: 'EVENT MARKER', style: 'round', width: 0.01, mode: 'momentary', engraved: '', name: 'EVENT' }), 0.2, rA);
  R.add(green(env, 'm2.event_lt', 'EVENT MARKED', 'ac.m2.event_marker_lt'), 0.2, rA + 0.012);
  R.add(new PushButton(env, { id: 'm2.cvr_test', var: M2.cvrTest, label: 'CVR TEST', style: 'korry', width: 0.013, height: 0.011, mode: 'momentary', segments: [{ text: ['CVR', 'TEST'], color: 'green', var: 'ac.m2.cvr_test_lt' }] }), 0.232, rA);
  R.display(displays.get('hobbs') ?? new NullDisplay('hobbs'), 0.225, rB + 0.004, 0.038, 0.0114, { bezel: { border: 0.003, depth: 0.004 }, display: { boot: false } });
  R.label('HOURS', 0.225, rB - 0.011, { height: 0.0019 });
}

/**
 * Handles beneath the instrument panel (S&D15 §10.2.E): on a narrow lip under the LH tilt panel / gear module
 * (photos: red knob and red T-handle protrude from just below the gear module, open space to the pedals), the
 * control lock below the pilot's panel (S&D15 §9.1), and the rain removal door levers outboard.
 */
export function buildUnderPanel(b: CockpitBuilder): void {
  const env = b.env;
  const [bx, bz] = TILT_BOTTOM;
  // Lip strip hanging from the LH tilt-panel lower edge (EST 40 mm, dark), y -0.62 .. -0.17.
  const K = b.panel({ name: 'm2.lip.l', center_m: [bx + 0.004, -0.395, bz + 0.022], facing: 'aft', tiltDeg: -6, width: 0.45, height: 0.044, origin: 'top-left', screws: false, material: 'panel' });
  // Emergency gear: red AUX GEAR T-handle and the red BLOW DOWN knob below the gear module (y -0.28 .. -0.165).
  K.add(new TBarHandle(env, { id: 'm2.gear_emer', var: M2.gearEmerRelease, label: 'EMERGENCY GEAR RELEASE (AUX GEAR T-HANDLE)', style: 'tbar', legend: 'GEAR', material: 'knobRed', scale: 0.8 }), 0.365, 0.024);
  K.add(new TBarHandle(env, { id: 'm2.gear_blowdown', var: M2.gearBlowdown, label: 'GEAR BLOW DOWN', style: 'knob', material: 'knobRed', scale: 0.75 }), 0.41, 0.024);
  K.label('AUX GEAR', 0.387, 0.006, { height: 0.0019 });
  // Parking and emergency brake handles (EST: left of the gear handles).
  K.add(new TBarHandle(env, { id: 'm2.park_brake', var: M2.parkBrake, label: 'PARKING BRAKE', style: 'tbar', rotate: 'none', legend: 'PARK BRAKE', scale: 0.8 }), 0.29, 0.024);
  K.add(new PushPullKnob(env, { id: 'm2.emer_brake', var: M2.emerBrake, label: 'EMERGENCY BRAKE', style: 'plain', valueIn: 0, valueOut: 1, travel: 0.06, clickToggles: false, legend: 'EMER BRAKE' }), 0.245, 0.024);
  K.label('PARK BRAKE', 0.29, 0.006, { height: 0.0019 });
  K.label('EMER BRAKE', 0.245, 0.006, { height: 0.0019 });
  // Integral control lock (S&D15 §9.1: "below the pilot's panel ... rudder, elevators, ailerons, and throttles").
  K.add(new TBarHandle(env, { id: 'm2.control_lock', var: M2.controlLock, label: 'CONTROL LOCK', style: 'lever', rotate: 'lock', springIn: true, legend: 'CONTROL LOCK', scale: 0.8 }), 0.08, 0.024);
  K.label('CONTROL LOCK  PULL - TURN', 0.08, 0.006, { height: 0.0019 });
  // Rain removal door levers L / R (outboard, beneath each side of the panel).
  for (const s of [1, 2] as const) {
    const y = s === 1 ? -0.66 : 0.66;
    const P = b.panel({ name: `m2.rain${s}`, center_m: [bx + 0.004, y, bz + 0.04], facing: 'aft', tiltDeg: -4, width: 0.07, height: 0.06, origin: 'top-left', screws: false, material: 'panel' });
    P.add(new TBarHandle(env, { id: `m2.rain_door${s}`, var: M2.rainDoor(s), label: `${s === 1 ? 'L' : 'R'} RAIN DOOR`, style: 'ring', scale: 0.8 }), 0.035, 0.036);
    P.label('RAIN DOOR', 0.035, 0.009, { height: 0.0022 });
  }
}
