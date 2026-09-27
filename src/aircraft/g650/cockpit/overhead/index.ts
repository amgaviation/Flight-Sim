/**
 * Gulfstream G650 overhead console (dossier docs/aircraft/g650.md §8, §9.1-9.6; contract in ../context.ts).
 *
 * Three segments following the headliner (layout.ts in this folder; Flickr G650ER overhead description):
 *
 *  FORWARD fascia (facing the crew): ANTI-ICE (L WING / L COWL / R COWL / R WING rotaries OFF-AUTO-ON, LUC
 *    ice "four rotary knobs"), WINDOW HEAT (L / R WSHLD, CABIN WDO, EVS WDO), AIR DATA HEAT (ANTI-ICE HTR 1-4),
 *    PASS SIGNS (SEAT BELT, NO SMOKE), EMER LTS (guarded OFF / ARM / ON), EXTERIOR LIGHTS toggles.
 *  SYSTEMS panel, aft to forward:
 *    OXYGEN (crew supply, PASS OXY shutoff, PASSENGER OXYGEN OFF / AUTO / MAN, bottle pressure readout),
 *    CABIN PRESSURE (AUTO/SEMI + MANUAL pair, FLIGHT / LANDING, guarded DUMP, MAN HOLD), TEMP CONTROL (three
 *    zone COLD-HOT knobs with AUTO/MAN, L / R PACK, guarded RAM AIR), COCKPIT LIGHTS (PANEL, FLOOD, DOME, LAMP
 *    TEST);
 *    EMERGENCY POWER (OFF/ARM + ON), RAT GEN, FLT CTRL BATTERIES (EBHA, UPS),
 *    ELECTRICAL POWER CONTROL (L GEN / APU GEN / EXT PWR / R GEN, L / R BUS TIE, AC/DC RESET, GND SVC BUS,
 *    L / R MAIN TRU, CABIN / GALLEY MASTER, MAIN BATTERIES L / R), FUEL (L / R MAIN and ALT pumps, X-FLOW,
 *    INTER TANK, FUEL RETURN), HYDRAULICS (AUX PUMP and PWR XFR UNIT pairs OFF/ARM + ON), BLEED AIR (L ENG,
 *    APU, R ENG, ISOLATION OPEN / CLOSED pair);
 *    ENGINE FIRE TEST (L / R LOOP A / B, FAULT TEST, bottle DISCH lights), APU CONTROL (MASTER, START, STOP,
 *    guarded FIRE EXT, TEST, RPM / EGT readout), ENGINE START (START MASTER, CRANK MASTER, CONT IGN, L / R ENG),
 *    MFD DISPLAY SWITCHING / DISPLAY SYSTEM CONTROL.
 *  Not here (G650ER photographs): the engine fire handles (lower centre panel) and the RAT handle (pedestal).
 *  BREAKERS (aft): every breaker of the modelled network, by system (breakers.ts).
 *
 * Every control writes the var of the inventory (vars.ts) that the systems read; legends show system state
 * (dark-cockpit philosophy: "most of the lights here are NOT illuminated when everything is operating
 * normally", Flickr G650ER overhead description). Where the dossier lists a lit "ON" for a normal condition
 * the legend is shown only for abnormal / transient states (EST). Legend lamps follow the annunciator power
 * (ESS DC / emergency bus) and the lamp test (`alert.annun_test`, LAMP TEST switchlight).
 *
 * Exact positions, section order and legend colours are EST from G650 / G650ER photographs and the dossier
 * (no G650 panel drawing is public).
 */
import * as THREE from 'three';
import { GuardedButton, GuardedSwitch, PushButton, RotaryKnob, SelectorKnob, ToggleSwitch, AnnunciatorLight } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { placePanel } from '../../../../cockpit/frame';
import { trimBoxGeometry } from '../../../../cockpit/geometry/structure';
import { ALERT } from '../../../../core/vars';
import { G650_VARS as V } from '../../vars';
import { CK, seg, type G650CockpitContext } from '../context';
import { OH_BREAKERS, OH_FORWARD, OH_SYSTEMS, SL, segmentPlacement, type OhSegment } from './layout';
import { section, sl, G650Readout } from './parts';
import { fillCbPanel } from './breakers';
import { addDisplaySwitching } from '../../../../avionics/honeywell-epic/cockpit';

/** Display-side derived lamp vars of the overhead (written each frame; systems never read them). */
export const OH = {
  genFail: (i: 1 | 2) => `ac.g650.ck.oh.gen${i}_fail`,
  extAvail: 'ac.g650.ck.oh.ext_avail',
  battDisch: (s: 'l' | 'r') => `ac.g650.ck.oh.batt_${s}_disch`,
  fcsDisch: (b: 'ebha' | 'ups') => `ac.g650.ck.oh.${b}_disch`,
  pumpFail: (p: string) => `ac.g650.ck.oh.${p}_fail`,
  hfrOn: 'ac.g650.ck.oh.hfr_on',
  galleyShed: 'ac.g650.ck.oh.galley_shed',
  apuReady: 'ac.g650.ck.oh.apu_ready',
  startOn: (i: 1 | 2) => `ac.g650.ck.oh.start${i}_on`,
  probeFail: (n: 1 | 2 | 3 | 4) => `ac.g650.ck.oh.probe${n}_fail`,
  fireFault: 'ac.g650.ck.oh.fire_fault',
  apuPower: 'ac.g650.ck.oh.apu_readout_pwr',
  oxyPower: 'ac.g650.ck.oh.oxy_readout_pwr',
} as const;

/** OFF/ARM + ON pair on one 0/1/2 var: OFF/ARM toggles OFF <-> ARM (from ON: OFF); ON toggles ON <-> ARM. */
const offArm = (c: number): number => (c === 0 ? 1 : 0);
const onArm = (c: number): number => (c === 2 ? 1 : 2);

/** Console box behind a segment (dark trim up to the headliner) and the panel plate. */
function segmentPanel(c: G650CockpitContext, s: OhSegment, material: 'panel' | 'panelDark' = 'panel'): Panel {
  const p = segmentPlacement(s);
  const box = new THREE.Group();
  box.name = `${s.name}.box`;
  placePanel(box, p);
  const g = trimBoxGeometry(p.width + 0.014, p.height + 0.004, 0.05, 0.006);
  const m = new THREE.Mesh(g, c.env.materials.get('panelDark'));
  m.position.z = -0.0032 - 0.025;
  box.add(m);
  c.b.trackGeometry(g);
  c.b.addStructure(box);
  return c.b.panel({ name: s.name, ...p, origin: 'top-left', material, screws: { kind: 'dzus', diameter: 0.0065, inset: 0.007, pitch: 0.3 }, radius: 0.005 });
}

export function buildOverhead(c: G650CockpitContext): void {
  const { env, b, ctx, sys } = c;
  const vars = ctx.vars;

  // ================================================================== FORWARD fascia
  const fw = segmentPanel(c, OH_FORWARD);
  const fwW = OH_FORWARD.width;
  // ---- ANTI-ICE rotaries (LUC ice: OFF / AUTO / ON)
  section(fw, 'ANTI-ICE', 0.012, 0.012, 0.215, 0.078);
  const ice: [string, string, string][] = [
    ['wing_l', 'L WING', V.wingL],
    ['cowl_l', 'L COWL', V.cowlL],
    ['cowl_r', 'R COWL', V.cowlR],
    ['wing_r', 'R WING', V.wingR],
  ];
  ice.forEach(([id, name, v], i) => {
    fw.add(
      new SelectorKnob(env, {
        id: `g650.oh.ice.${id}`,
        var: v,
        label: `${name} ANTI-ICE`,
        cap: 'pointer',
        diameter: 0.014,
        labelHeight: 0.0017,
        positions: [
          { value: 0, label: 'OFF', angle: -55 },
          { value: 1, label: 'AUTO', angle: 0 },
          { value: 2, label: 'ON', angle: 55 },
        ],
        initial: 0,
      }),
      0.038 + i * 0.047,
      0.05,
    );
    fw.label(name, 0.038 + i * 0.047, 0.071, { height: 0.0024 });
  });
  // ---- WINDOW HEAT
  section(fw, 'WINDOW HEAT', 0.222, 0.012, 0.345, 0.078);
  const wdo: [string, string, string][] = [
    ['wshld_l', 'L WSHLD', V.wshldL],
    ['wshld_r', 'R WSHLD', V.wshldR],
    ['cabin_wdo', 'CABIN\nWDO', V.cabinWdo],
    ['evs_wdo', 'EVS\nWDO', V.evsWdo],
  ];
  wdo.forEach(([id, name, v], i) =>
    sl(env, fw, { id: `g650.oh.ice.${id}`, label: `${name.replace('\n', ' ')} HEAT`, var: v, name, segments: [seg.eq('OFF', 'amber', v, 0)] }, 0.243 + i * SL.pitch + 0.001, 0.052),
  );
  // ---- AIR DATA probe heaters (ANTI-ICE HTR 1-4)
  section(fw, 'AIR DATA HEAT', 0.352, 0.012, 0.475, 0.078);
  ([1, 2, 3, 4] as const).forEach((n, i) => {
    const v = V.probe(n);
    sl(env, fw, { id: `g650.oh.ice.probe${n}`, label: `ANTI-ICE HTR AIR DATA ${n}`, var: v, name: `${n}`, segments: [seg.on('FAIL', 'amber', OH.probeFail(n)), seg.eq('OFF', 'amber', v, 0)] }, 0.373 + i * SL.pitch + 0.001, 0.052);
  });
  // ---- PASS SIGNS, EMER LTS
  section(fw, 'PASS SIGNS', 0.482, 0.012, 0.575, 0.078);
  const tog = (id: string, v: string, label: string, name: string, x: number, y: number, p: Panel = fw, positions = ['OFF', 'ON']) =>
    p.add(new ToggleSwitch(env, { id, var: v, label, positions, values: positions.map((_, k) => k), initial: 0, scale: 0.8, labels: { name, positions: true, height: 0.0019 } }), x, y);
  tog('g650.oh.lt.seatbelt', V.seatBelt, 'SEAT BELT sign', 'SEAT BELT', 0.505, 0.048);
  tog('g650.oh.lt.nosmoke', V.noSmoke, 'NO SMOKE sign', 'NO SMOKE', 0.552, 0.048);
  section(fw, 'EMER LTS', 0.582, 0.012, fwW - 0.012, 0.078);
  fw.add(
    new GuardedSwitch(env, {
      id: 'g650.oh.lt.emer',
      var: V.ltEmer,
      label: 'EMER LTS',
      positions: ['OFF', 'ARM', 'ON'],
      values: [0, 1, 2],
      initial: 1,
      scale: 0.8,
      labels: { positions: true, height: 0.0019 },
      // EST: guarded in ARM (dossier §9.6 "ARM guard").
      guard: { color: 'clear', guardedPosition: 1, close: 'returns', hinge: 'top' },
    }),
    0.626,
    0.05,
  );
  // ---- EXTERIOR LIGHTS
  section(fw, 'EXTERIOR LIGHTS', 0.012, 0.088, fwW - 0.012, 0.148);
  const ext: [string, string, string][] = [
    ['nav', 'NAV', V.ltNav],
    ['beacon', 'BEACON', V.ltBeacon],
    ['strobe', 'ANTI-COLL', V.ltStrobe],
    ['ldg_l', 'L LDG', V.ltLdgL],
    ['ldg_r', 'R LDG', V.ltLdgR],
    ['taxi', 'TAXI', V.ltTaxi],
    ['recog', 'RECOG', V.ltRecog],
    ['logo', 'LOGO', V.ltLogo],
    ['wing', 'WING INSP', V.ltWing],
  ];
  const exPitch = (fwW - 0.08) / (ext.length - 1);
  ext.forEach(([id, name, v], i) => tog(`g650.oh.lt.${id}`, v, `${name} LIGHTS`, name, 0.04 + i * exPitch, 0.123));

  // ================================================================== SYSTEMS panel
  const sp = segmentPanel(c, OH_SYSTEMS);
  const W = OH_SYSTEMS.width;

  // ---------------------------------------------------------------- aft band: OXYGEN
  section(sp, 'OXYGEN', 0.01, 0.012, 0.16, 0.135);
  sl(env, sp, { id: 'g650.oh.oxy.crew', label: 'CREW OXYGEN SUPPLY', var: V.crewOxy, name: 'CREW', segments: [seg.on('LOW', 'amber', 'oxy.crew_low'), seg.eq('OFF', 'amber', V.crewOxy, 0)] }, 0.03, 0.05);
  sl(env, sp, { id: 'g650.oh.oxy.pass_shutoff', label: 'PASS OXYGEN SHUTOFF', var: V.paxShutoff, name: 'PASS SPLY', segments: [seg.on('LOW', 'amber', 'oxy.pax_low'), seg.eq('OFF', 'amber', V.paxShutoff, 0)] }, 0.03, 0.105);
  sp.add(
    new SelectorKnob(env, {
      id: 'g650.oh.oxy.pax',
      var: V.paxOxy,
      label: 'PASSENGER OXYGEN',
      cap: 'pointer',
      diameter: 0.015,
      labelHeight: 0.0018,
      positions: [
        { value: 0, label: 'OFF', angle: -55 },
        { value: 1, label: 'AUTO', angle: 0 },
        { value: 2, label: 'MAN', angle: 55 },
      ],
      initial: 1,
    }),
    0.077,
    0.1,
  );
  sp.label('PASSENGER', 0.077, 0.127, { height: 0.0024 });
  const oxyReadout = new G650Readout(
    'g650.oh.oxy_psi',
    vars,
    [
      { label: 'CREW', var: 'oxy.crew_psi', unit: '', step: 10 },
      { label: 'PASS', var: 'oxy.pax_psi', unit: '', step: 10 },
    ],
    OH.oxyPower,
    c.canvas?.(192, 72),
  );
  sp.display(oxyReadout, 0.117, 0.045, 0.056, 0.021, { bezel: { border: 0.003, depth: 0.004, material: 'bezel' }, display: { glass: true, powerVar: OH.oxyPower } });
  sp.label('PSI', 0.117, 0.064, { height: 0.0019 });

  // ---------------------------------------------------------------- CABIN PRESSURE
  section(sp, 'CABIN PRESSURE', 0.165, 0.012, 0.345, 0.135);
  sl(env, sp, { id: 'g650.oh.press.auto_semi', label: 'CABIN PRESSURE AUTO/SEMI', var: V.pressMode, name: 'AUTO/\nSEMI', values: [0, 1, 2], next: (x) => (x === 0 ? 1 : 0), stateNames: ['AUTO', 'SEMI', 'MANUAL'], segments: [seg.on('FAULT', 'amber', 'press.auto_fail'), seg.eq('SEMI', 'green', V.pressMode, 1)] }, 0.185, 0.05);
  sl(env, sp, { id: 'g650.oh.press.manual', label: 'CABIN PRESSURE MANUAL', var: V.pressMode, name: 'MANUAL', values: [0, 1, 2], next: (x) => (x === 2 ? 0 : 2), stateNames: ['AUTO', 'SEMI', 'MANUAL'], segments: [seg.eq('MANUAL', 'amber', V.pressMode, 2)] }, 0.213, 0.05);
  sl(env, sp, { id: 'g650.oh.press.flt_ldg', label: 'FLIGHT / LANDING', var: V.fltLdg, name: 'FLT/\nLDG', stateNames: ['FLIGHT', 'LANDING'], segments: [seg.eq('FLIGHT', 'green', V.fltLdg, 0), seg.eq('LANDING', 'green', V.fltLdg, 1)] }, 0.249, 0.05);
  sp.add(
    new GuardedButton(env, {
      id: 'g650.oh.press.dump',
      var: V.pressDump,
      label: 'CABIN DUMP',
      mode: 'toggle',
      style: 'korry',
      width: SL.size,
      height: SL.size,
      layout: 'stack',
      segments: [seg.on('DUMP', 'amber', V.pressDump)],
      guard: { color: 'red', close: 'blocks' },
    }),
    0.31,
    0.05,
  );
  sp.label('DUMP', 0.31, 0.0325, { height: 0.0024 });
  sp.add(
    new SelectorKnob(env, {
      id: 'g650.oh.press.man_hold',
      var: V.manHold,
      label: 'MAN HOLD (outflow valve)',
      cap: 'bar',
      diameter: 0.016,
      labelHeight: 0.0018,
      positions: [
        { value: -1, label: 'DESC', angle: -50, spring: 1 },
        { value: 0, label: 'HOLD', angle: 0 },
        { value: 1, label: 'CLIMB', angle: 50, spring: 1 },
      ],
      initial: 1,
    }),
    0.255,
    0.103,
  );
  sp.label('MAN HOLD', 0.255, 0.128, { height: 0.0024 });

  // ---------------------------------------------------------------- TEMP CONTROL
  section(sp, 'TEMP CONTROL', 0.35, 0.012, 0.59, 0.135);
  const zones: [1 | 2 | 3, string][] = [
    [1, 'COCKPIT'],
    [2, 'FWD CABIN'],
    [3, 'AFT CABIN'],
  ];
  zones.forEach(([z, name], i) => {
    const x = 0.378 + i * 0.047;
    sp.label(name, x, 0.027, { height: 0.002 });
    sp.add(
      new RotaryKnob(env, {
        id: `g650.oh.ecs.zone${z}`,
        label: `${name} TEMP`,
        cap: 'skirted',
        diameter: 0.016,
        outer: { var: V.zoneTemp(z), min: 16, max: 30, step: 0.5, angleRange: [-135, 135], format: (t) => `${t.toFixed(1)} °C` },
      }),
      x,
      0.054,
    );
    sp.label('C', x - 0.013, 0.068, { height: 0.0019 });
    sp.label('H', x + 0.013, 0.068, { height: 0.0019 });
    sl(env, sp, { id: `g650.oh.ecs.zone${z}_man`, label: `${name} AUTO / MAN`, var: V.zoneMan(z), name: null, stateNames: ['AUTO', 'MAN'], segments: [seg.eq('MAN', 'amber', V.zoneMan(z), 1)] }, x, 0.103);
  });
  sp.label('AUTO/MAN', 0.425, 0.128, { height: 0.0019 });
  sl(env, sp, { id: 'g650.oh.ecs.pack_l', label: 'L PACK', var: V.packL, segments: [seg.on('FAIL', 'amber', 'pneu.pack_l_trip'), seg.eq('OFF', 'amber', V.packL, 0)] }, 0.535, 0.05);
  sl(env, sp, { id: 'g650.oh.ecs.pack_r', label: 'R PACK', var: V.packR, segments: [seg.on('FAIL', 'amber', 'pneu.pack_r_trip'), seg.eq('OFF', 'amber', V.packR, 0)] }, 0.565, 0.05);
  sp.add(
    new GuardedButton(env, {
      id: 'g650.oh.ecs.ram_air',
      var: V.ramAir,
      label: 'RAM AIR',
      mode: 'toggle',
      style: 'korry',
      width: SL.size,
      height: SL.size,
      layout: 'stack',
      segments: [seg.on('RAM', 'amber', V.ramAir)],
      guard: { color: 'black', close: 'blocks' },
    }),
    0.55,
    0.105,
  );
  sp.label('RAM AIR', 0.55, 0.0875, { height: 0.0024 });

  // ---------------------------------------------------------------- COCKPIT LIGHTS
  // MASTER CONTROL (G650 training material): OFF = day; small tick = night setting (annunciators dim, panel
  // backlighting on); full clockwise = annunciators full bright; ORIDE detent beyond = overhead dome and side-
  // console floodlights on (the storm / override function). PANEL and FLOOD are the individual dimmers (EST
  // names; the aircraft has dimming units for "glareshield and console" and "overhead and pedestal").
  section(sp, 'COCKPIT LIGHTS', 0.595, 0.012, W - 0.01, 0.135);
  const dimmer = (id: string, v: string, label: string, x: number, y: number, d: number) => {
    sp.add(new RotaryKnob(env, { id, label, cap: 'dimmer', diameter: d, outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [-135, 135], format: (t) => (t < 0.01 ? 'OFF' : `${Math.round(t * 100)} %`) } }), x, y);
    sp.label(label, x, y - d / 2 - 0.0045, { height: 0.0022 });
    sp.label('OFF', x - d / 2 - 0.004, y + d / 2 + 0.002, { height: 0.0015 });
    sp.label('BRT', x + d / 2 + 0.004, y + d / 2 + 0.002, { height: 0.0015 });
  };
  const mx = 0.628;
  const myc = 0.058;
  sp.add(
    new RotaryKnob(env, {
      id: 'g650.oh.lt.master',
      label: 'COCKPIT LIGHTS MASTER CONTROL (OFF day / night / BRT / ORIDE)',
      cap: 'dimmer',
      diameter: 0.019,
      // 0 OFF .. 1 full bright over 270 deg, ORIDE detent (1.1) a further 30 deg clockwise.
      outer: { var: V.ltMaster, min: 0, max: 1.1, step: 0.05, angleRange: [-135, 165], format: (t) => (t < 0.005 ? 'OFF (day)' : t > 1.05 ? 'ORIDE (dome + console floods)' : t > 0.97 ? 'BRT (annunciators full)' : `NIGHT ${Math.round(t * 100)} %`) },
    }),
    mx,
    myc,
  );
  sp.label('MASTER CONTROL', mx, 0.029, { height: 0.0022, weight: 700 });
  sp.label('OFF', mx - 0.016, myc + 0.012, { height: 0.0015 });
  sp.label('BRT', mx + 0.017, myc + 0.004, { height: 0.0015 });
  sp.label('ORIDE', mx + 0.014, myc + 0.016, { height: 0.0015 });
  {
    // Night-setting tick mark at the knob's 0.15 position (angle clockwise from up, panel y down).
    const a = THREE.MathUtils.degToRad(-135 + (0.15 / 1.1) * 300);
    sp.line(mx + 0.0115 * Math.sin(a), myc - 0.0115 * Math.cos(a), mx + 0.0145 * Math.sin(a), myc - 0.0145 * Math.cos(a), 0.0007);
  }
  dimmer('g650.oh.lt.panel', V.ltPanel, 'PANEL', 0.688, 0.036, 0.012);
  dimmer('g650.oh.lt.flood', V.ltFlood, 'FLOOD', 0.688, 0.078, 0.012);
  tog('g650.oh.lt.dome', V.ltDome, 'DOME LIGHT', 'DOME', 0.622, 0.112, sp);
  sl(env, sp, { id: 'g650.oh.lt.lamp_test', label: 'LAMP TEST (annunciators)', var: ALERT.annunTest, name: 'LAMP TEST', mode: 'momentary', segments: [{ text: 'TEST', color: 'white', whenOn: true }] }, 0.688, 0.116);
  // Annunciator dimming follows the MASTER CONTROL (lighting system output), powered as before.
  env.lighting.setAnnunciatorDimming(V.annunBright, 0.3, false, CK.annunPower);

  // ---------------------------------------------------------------- middle band: EMERGENCY POWER / RAT / FCS BATT
  const my = 0.145;
  section(sp, 'EMER POWER', 0.01, my, 0.14, 0.318);
  sl(env, sp, { id: 'g650.oh.elec.emer_arm', label: 'EMERGENCY POWER OFF/ARM', var: V.emerPwr, name: 'OFF/ARM', values: [0, 1, 2], next: offArm, stateNames: ['OFF', 'ARM', 'ON'], segments: [seg.eq('ARM', 'green', V.emerPwr, 1), seg.eq('OFF', 'amber', V.emerPwr, 0)] }, 0.035, 0.18);
  sl(env, sp, { id: 'g650.oh.elec.emer_on', label: 'EMERGENCY POWER ON', var: V.emerPwr, name: 'ON', values: [0, 1, 2], next: onArm, stateNames: ['OFF', 'ARM', 'ON'], segments: [seg.on('ON', 'amber', V.ebattOn)] }, 0.064, 0.18);
  sl(env, sp, { id: 'g650.oh.elec.rat_gen', label: 'RAT GEN', var: V.ratGen, segments: [seg.on('ON', 'green', 'elec.rat_online'), seg.eq('OFF', 'amber', V.ratGen, 0)] }, 0.112, 0.18);
  // The RAT deploy handle is on the pedestal (G650ER photograph: red "RAT" handle aft of the flap lever;
  // cockpit/pedestal.ts). RAT GEN stays here.
  sp.label('FLT CTRL BATT', 0.075, 0.268, { height: 0.0022, weight: 800 });
  sl(env, sp, { id: 'g650.oh.elec.ebha', label: 'FLT CTRL BATTERY EBHA', var: V.ebhaBatt, name: null, segments: [seg.on('ON', 'amber', OH.fcsDisch('ebha')), seg.eq('OFF', 'amber', V.ebhaBatt, 0)] }, 0.05, 0.295);
  sl(env, sp, { id: 'g650.oh.elec.ups', label: 'FLT CTRL BATTERY UPS', var: V.upsBatt, name: null, segments: [seg.on('ON', 'amber', OH.fcsDisch('ups')), seg.eq('OFF', 'amber', V.upsBatt, 0)] }, 0.1, 0.295);
  sp.label('EBHA', 0.05, 0.3105, { height: 0.0019 });
  sp.label('UPS', 0.1, 0.3105, { height: 0.0019 });

  // ---------------------------------------------------------------- ELECTRICAL POWER CONTROL
  section(sp, 'ELECTRICAL POWER', 0.145, my, 0.33, 0.318);
  const ex = [0.168, 0.21, 0.255, 0.3];
  const ey = [0.177, 0.219, 0.261, 0.302];
  sl(env, sp, { id: 'g650.oh.elec.gen_l', label: 'L GEN', var: V.genL, segments: [seg.on('FAIL', 'amber', OH.genFail(1)), seg.eq('OFF', 'amber', V.genL, 0)] }, ex[0], ey[0]);
  sl(env, sp, { id: 'g650.oh.elec.apu_gen', label: 'APU GEN', var: V.apuGen, segments: [seg.on('ON', 'green', 'elec.apu_gen_online'), seg.eq('OFF', 'amber', V.apuGen, 0)] }, ex[1], ey[0]);
  sl(env, sp, { id: 'g650.oh.elec.ext_pwr', label: 'EXT PWR', var: V.extPwr, segments: [seg.on('AVAIL', 'green', OH.extAvail), seg.on('ON', 'cyan', 'elec.gpu_online')] }, ex[2], ey[0]);
  sl(env, sp, { id: 'g650.oh.elec.gen_r', label: 'R GEN', var: V.genR, segments: [seg.on('FAIL', 'amber', OH.genFail(2)), seg.eq('OFF', 'amber', V.genR, 0)] }, ex[3], ey[0]);
  sl(env, sp, { id: 'g650.oh.elec.bus_tie_l', label: 'L BUS TIE', var: V.busTieL, stateNames: ['ISLN', 'AUTO'], segments: [seg.on('TIED', 'cyan', 'elec.l_btb_closed'), seg.eq('ISLN', 'amber', V.busTieL, 0)] }, ex[0], ey[1]);
  sp.add(new PushButton(env, { id: 'g650.oh.elec.reset', label: 'AC/DC RESET', var: V.elecReset, mode: 'momentary', style: 'round', width: 0.011, engraved: 'RST', engravedHeight: 0.002 }), ex[1], ey[1]);
  sp.label('RESET', ex[1], ey[1] - 0.012, { height: 0.0024 });
  sl(env, sp, { id: 'g650.oh.elec.gsb', label: 'GND SVC BUS', var: V.gsb, name: 'GND SVC', segments: [seg.on('ON', 'cyan', V.gsb)] }, ex[2], ey[1]);
  sl(env, sp, { id: 'g650.oh.elec.bus_tie_r', label: 'R BUS TIE', var: V.busTieR, stateNames: ['ISLN', 'AUTO'], segments: [seg.on('TIED', 'cyan', 'elec.r_btb_closed'), seg.eq('ISLN', 'amber', V.busTieR, 0)] }, ex[3], ey[1]);
  sl(env, sp, { id: 'g650.oh.elec.l_main_tru', label: 'L MAIN TRU', var: V.lMainTru, name: 'L MAIN\nTRU', stateNames: ['R AC', 'NORM'], segments: [seg.eq('R AC', 'amber', V.lMainTru, 0)] }, ex[0], ey[2]);
  sl(env, sp, { id: 'g650.oh.elec.cabin_master', label: 'CABIN MASTER', var: V.cabinMaster, name: 'CABIN', segments: [seg.eq('OFF', 'amber', V.cabinMaster, 0)] }, ex[1], ey[2]);
  sl(env, sp, { id: 'g650.oh.elec.galley_master', label: 'GALLEY MASTER', var: V.galleyMaster, name: 'GALLEY', segments: [seg.on('SHED', 'amber', OH.galleyShed), seg.eq('OFF', 'amber', V.galleyMaster, 0)] }, ex[2], ey[2]);
  sl(env, sp, { id: 'g650.oh.elec.r_main_tru', label: 'R MAIN TRU', var: V.rMainTru, name: 'R MAIN\nTRU', stateNames: ['L AC', 'NORM'], segments: [seg.eq('L AC', 'amber', V.rMainTru, 0)] }, ex[3], ey[2]);
  sl(env, sp, { id: 'g650.oh.elec.batt_l', label: 'MAIN BATTERY LEFT', var: V.battL, name: 'L BATT', segments: [seg.on('ON', 'amber', OH.battDisch('l')), seg.eq('OFF', 'white', V.battL, 0)] }, ex[1], ey[3]);
  sl(env, sp, { id: 'g650.oh.elec.batt_r', label: 'MAIN BATTERY RIGHT', var: V.battR, name: 'R BATT', segments: [seg.on('ON', 'amber', OH.battDisch('r')), seg.eq('OFF', 'white', V.battR, 0)] }, ex[2], ey[3]);
  sp.label('MAIN BATTERIES', (ex[1] + ex[2]) / 2, ey[3] + 0.0125, { height: 0.0019 });

  // ---------------------------------------------------------------- FUEL
  section(sp, 'FUEL', 0.335, my, 0.47, 0.318);
  const pumps: [string, string, string, string][] = [
    ['boost_l', 'L MAIN', V.boostL, 'L MAIN PUMP'],
    ['alt_l', 'L ALT', V.altL, 'L ALT PUMP'],
    ['alt_r', 'R ALT', V.altR, 'R ALT PUMP'],
    ['boost_r', 'R MAIN', V.boostR, 'R MAIN PUMP'],
  ];
  pumps.forEach(([id, name, v, label], i) =>
    sl(env, sp, { id: `g650.oh.fuel.${id}`, label, var: v, name, segments: [seg.on('FAIL', 'amber', OH.pumpFail(id)), seg.eq('OFF', 'amber', v, 0)] }, 0.353 + i * 0.033, 0.183),
  );
  sl(env, sp, { id: 'g650.oh.fuel.xflow', label: 'FUEL X-FLOW', var: V.xflow, name: 'X-FLOW', segments: [seg.on('OPEN', 'cyan', 'fuel.xflow_open')] }, 0.37, 0.24);
  sl(env, sp, { id: 'g650.oh.fuel.intertank', label: 'FUEL INTER TANK', var: V.interTank, name: 'INTER\nTANK', segments: [seg.on('OPEN', 'cyan', V.interTank)] }, 0.4025, 0.24);
  sl(env, sp, { id: 'g650.oh.fuel.return', label: 'FUEL RETURN (heated fuel return)', var: V.fuelReturn, name: 'FUEL\nRETURN', stateNames: ['OFF', 'AUTO'], segments: [seg.on('ON', 'cyan', OH.hfrOn), seg.eq('OFF', 'amber', V.fuelReturn, 0)] }, 0.435, 0.24);
  sp.line(0.345, 0.212, 0.46, 0.212);

  // ---------------------------------------------------------------- HYDRAULICS
  section(sp, 'HYDRAULICS', 0.475, my, 0.57, 0.318);
  sp.label('AUX PUMP', 0.5225, 0.162, { height: 0.0024 });
  sl(env, sp, { id: 'g650.oh.hyd.aux_arm', label: 'AUX PUMP OFF/ARM', var: V.auxPump, name: null, values: [0, 1, 2], next: offArm, stateNames: ['OFF', 'ARM', 'ON'], segments: [seg.eq('ARM', 'green', V.auxPump, 1), seg.eq('OFF', 'amber', V.auxPump, 0)] }, 0.507, 0.183);
  sl(env, sp, { id: 'g650.oh.hyd.aux_on', label: 'AUX PUMP ON', var: V.auxPump, name: null, values: [0, 1, 2], next: onArm, stateNames: ['OFF', 'ARM', 'ON'], segments: [seg.on('ON', 'amber', 'hyd.aux_on')] }, 0.538, 0.183);
  sp.label('OFF/ARM    ON', 0.5225, 0.2, { height: 0.0019 });
  sp.label('PWR XFR UNIT', 0.5225, 0.232, { height: 0.0024 });
  sl(env, sp, { id: 'g650.oh.hyd.ptu_arm', label: 'PWR XFR UNIT OFF/ARM', var: V.ptu, name: null, values: [0, 1, 2], next: offArm, stateNames: ['OFF', 'ARM', 'ON'], segments: [seg.eq('ARM', 'green', V.ptu, 1), seg.eq('OFF', 'amber', V.ptu, 0)] }, 0.507, 0.253);
  sl(env, sp, { id: 'g650.oh.hyd.ptu_on', label: 'PWR XFR UNIT ON', var: V.ptu, name: null, values: [0, 1, 2], next: onArm, stateNames: ['OFF', 'ARM', 'ON'], segments: [seg.on('ON', 'amber', 'hyd.ptu_active')] }, 0.538, 0.253);
  sp.label('OFF/ARM    ON', 0.5225, 0.27, { height: 0.0019 });

  // ---------------------------------------------------------------- BLEED AIR
  section(sp, 'BLEED AIR', 0.575, my, W - 0.01, 0.318);
  sl(env, sp, { id: 'g650.oh.bleed.l', label: 'L ENG BLEED', var: V.bleedL, name: 'L ENG', segments: [seg.on('FAIL', 'amber', 'pneu.bleed_l_trip'), seg.eq('OFF', 'amber', V.bleedL, 0)] }, 0.598, 0.183);
  sl(env, sp, { id: 'g650.oh.bleed.apu', label: 'APU BLEED', var: V.bleedApu, name: 'APU', segments: [seg.on('ON', 'cyan', 'pneu.apu_bleed_valve_open')] }, 0.6425, 0.183);
  sl(env, sp, { id: 'g650.oh.bleed.r', label: 'R ENG BLEED', var: V.bleedR, name: 'R ENG', segments: [seg.on('FAIL', 'amber', 'pneu.bleed_r_trip'), seg.eq('OFF', 'amber', V.bleedR, 0)] }, 0.687, 0.183);
  sp.label('ISOLATION', 0.6425, 0.232, { height: 0.0024 });
  sl(env, sp, { id: 'g650.oh.bleed.iso_open', label: 'ISOLATION OPEN', var: V.isolation, name: null, values: [0, 1, 2], next: (x) => (x === 2 ? 1 : 2), stateNames: ['CLOSED', 'AUTO', 'OPEN'], segments: [seg.on('OPEN', 'cyan', 'pneu.iso_open')] }, 0.627, 0.253);
  sl(env, sp, { id: 'g650.oh.bleed.iso_closed', label: 'ISOLATION CLOSED', var: V.isolation, name: null, values: [0, 1, 2], next: (x) => (x === 0 ? 1 : 0), stateNames: ['CLOSED', 'AUTO', 'OPEN'], segments: [seg.eq('CLOSED', 'amber', V.isolation, 0)] }, 0.658, 0.253);
  sp.label('OPEN   CLOSED', 0.6425, 0.27, { height: 0.0019 });

  // ---------------------------------------------------------------- forward band: fire handles, FIRE TEST, APU, START
  const fy = 0.328;
  // The L / R ENG FIRE handles are on the lower centre instrument panel (G650ER photographs; LUC fire drawings;
  // cockpit/lowerCentre.ts).
  sp.line(0.01, fy, W - 0.01, fy);
  // ---- ENGINE FIRE TEST + bottle discharge lights
  section(sp, 'FIRE TEST', 0.01, fy + 0.006, 0.143, 0.462);
  const tests: [string, string, string, string][] = [
    ['test_la', 'L LOOP A', V.fireTestLA, 'fire.eng1_loopa_fault'],
    ['test_lb', 'L LOOP B', V.fireTestLB, 'fire.eng1_loopb_fault'],
    ['test_ra', 'R LOOP A', V.fireTestRA, 'fire.eng2_loopa_fault'],
    ['test_rb', 'R LOOP B', V.fireTestRB, 'fire.eng2_loopb_fault'],
  ];
  tests.forEach(([id, name, v, fault], i) =>
    sl(env, sp, { id: `g650.oh.fire.${id}`, label: `ENGINE FIRE TEST ${name}`, var: v, name: name.replace(' LOOP ', '\nLOOP '), mode: 'momentary', segments: [{ text: 'TEST', color: 'red', whenOn: true }, seg.on('FAULT', 'amber', fault)] }, 0.027 + i * 0.03, 0.368),
  );
  sl(env, sp, { id: 'g650.oh.fire.fault_test', label: 'FIRE DETECTION FAULT TEST', var: V.fireFaultTest, name: 'FAULT TEST', mode: 'momentary', segments: [seg.on('FAULT', 'amber', OH.fireFault)] }, 0.0765, 0.43);
  const disch = (id: string, name: string, v: string, x: number) => {
    sp.add(new AnnunciatorLight(env, { id, label: name, width: 0.019, height: 0.012, segments: [{ text: ['BOTTLE', 'DISCH'], color: 'amber', var: v }] }), x, 0.432);
  };
  disch('g650.oh.fire.bottle_l', 'LEFT FIRE BOTTLE DISCHARGED', 'fire.bottle_l_discharged', 0.032);
  disch('g650.oh.fire.bottle_r', 'RIGHT FIRE BOTTLE DISCHARGED', 'fire.bottle_r_discharged', 0.121);

  // ---- APU CONTROL (LUC apu)
  section(sp, 'APU', 0.148, fy + 0.006, 0.365, 0.462);
  sl(env, sp, { id: 'g650.oh.apu.master', label: 'APU MASTER', var: V.apuMaster, name: 'MASTER', segments: [seg.on('READY', 'green', OH.apuReady), seg.on('ON', 'cyan', V.apuMaster)] }, 0.17, 0.368);
  sl(env, sp, { id: 'g650.oh.apu.start', label: 'APU START', var: V.apuStart, name: 'START', mode: 'momentary', segments: [seg.on('ON', 'cyan', 'apu.starting')] }, 0.199, 0.368);
  sl(env, sp, { id: 'g650.oh.apu.stop', label: 'APU STOP', var: V.apuStop, name: 'STOP', mode: 'momentary', segments: [seg.on('COOL', 'amber', 'apu.cooldown')] }, 0.228, 0.368);
  sp.add(
    new GuardedButton(env, {
      id: 'g650.oh.apu.fire_ext',
      var: V.apuFireExt,
      label: 'APU FIRE EXT (LEFT bottle)',
      mode: 'momentary',
      style: 'korry',
      width: SL.size,
      height: SL.size,
      layout: 'stack',
      segments: [seg.on('FIRE', 'red', 'fire.apu_warn'), seg.on('DISCH', 'amber', 'fire.bottle_l_discharged')],
      guard: { color: 'red', close: 'free', var: V.apuFireExtGuard },
    }),
    0.28,
    0.37,
  );
  sp.label('FIRE EXT', 0.28, 0.3515, { height: 0.0024 });
  sl(env, sp, { id: 'g650.oh.apu.fire_test', label: 'APU FIRE TEST', var: V.apuFireTest, name: 'TEST', mode: 'momentary', segments: [{ text: 'TEST', color: 'red', whenOn: true }] }, 0.325, 0.368);
  const apuReadout = new G650Readout(
    'g650.oh.apu_readout',
    vars,
    [
      { label: 'RPM %', var: 'apu.n_pct', unit: '', step: 1 },
      { label: 'EGT °C', var: 'apu.egt_c', unit: '', step: 5 },
    ],
    OH.apuPower,
    c.canvas?.(192, 72),
  );
  sp.display(apuReadout, 0.215, 0.428, 0.066, 0.025, { bezel: { border: 0.003, depth: 0.004, material: 'bezel' }, display: { glass: true, powerVar: OH.apuPower } });

  // ---- ENGINE START (LUC powerplant)
  section(sp, 'ENGINE START', 0.37, fy + 0.006, 0.54, 0.462);
  sl(env, sp, { id: 'g650.oh.eng.start_master', label: 'START MASTER', var: V.startMaster, name: 'START\nMASTER', segments: [{ text: 'ON', color: 'cyan', whenOn: true }] }, 0.395, 0.372);
  sl(env, sp, { id: 'g650.oh.eng.crank_master', label: 'CRANK MASTER', var: V.crankMaster, name: 'CRANK\nMASTER', segments: [{ text: 'ON', color: 'cyan', whenOn: true }] }, 0.425, 0.372);
  sl(env, sp, { id: 'g650.oh.eng.cont_ign', label: 'CONT IGN', var: V.contIgn, name: 'CONT\nIGN', segments: [{ text: 'ON', color: 'cyan', whenOn: true }] }, 0.515, 0.372);
  sl(env, sp, { id: 'g650.oh.eng.start_l', label: 'L ENG START', var: V.startL, name: 'L ENG', mode: 'momentary', segments: [seg.on('ON', 'cyan', OH.startOn(1)), seg.on('ABORT', 'amber', 'fadec.eng1.abort')] }, 0.435, 0.43);
  sl(env, sp, { id: 'g650.oh.eng.start_r', label: 'R ENG START', var: V.startR, name: 'R ENG', mode: 'momentary', segments: [seg.on('ON', 'cyan', OH.startOn(2)), seg.on('ABORT', 'amber', 'fadec.eng2.abort')] }, 0.475, 0.43);

  // ---- MFD DISPLAY SWITCHING / DISPLAY SYSTEM CONTROL (G650ER overhead photograph: in the systems panel;
  // Epic helper, G550 OM 2A-31: MFD L / R NORM-PFD, DU 1-4 OFF-NORM).
  section(sp, 'DISPLAY SWITCHING', 0.545, fy + 0.006, W - 0.01, 0.462);
  addDisplaySwitching(b, sp, 0.562, 0.4, 0.0238);
  sp.label('MFD             DISPLAY SYSTEM CONTROL', 0.628, 0.358, { height: 0.0021 });

  // ================================================================== BREAKERS
  const cb = segmentPanel(c, OH_BREAKERS, 'panel');
  fillCbPanel(env, cb, OH_BREAKERS.width, new Map(sys.elec.breakerNames().map((x) => [x.name, x.ratingA])));

  // ================================================================== derived lamp states (display-side only)
  b.onUpdate(() => {
    const g = (n: string) => vars.get(n);
    for (const i of [1, 2] as const) {
      vars.set(OH.genFail(i), g(`eng${i}.running`) && g(i === 1 ? V.genL : V.genR) === 1 && !g(`elec.idg${i}_online`) ? 1 : 0);
      vars.set(OH.startOn(i), g(`fadec.eng${i}.starter_cmd`) || g(V.crankLatch(i)) ? 1 : 0);
    }
    vars.set(OH.extAvail, g(V.gpuAvail) && !g('elec.gpu_online') ? 1 : 0);
    vars.set(OH.battDisch('l'), g(V.battL) === 1 && g('elec.batt_l_amps') < -1 ? 1 : 0);
    vars.set(OH.battDisch('r'), g(V.battR) === 1 && g('elec.batt_r_amps') < -1 ? 1 : 0);
    vars.set(OH.fcsDisch('ebha'), g('elec.ebha_batt_amps') < -1 ? 1 : 0);
    vars.set(OH.fcsDisch('ups'), g('elec.ups_batt_amps') < -1 ? 1 : 0);
    for (const [id, v, tank] of PUMPS) vars.set(OH.pumpFail(id), g(v) >= 1 && !g(`fuel.${id}_on`) && g(`fuel.${tank}_usable_kg`) > 1 ? 1 : 0);
    vars.set(OH.hfrOn, g(V.hfrsOn(1)) || g(V.hfrsOn(2)) ? 1 : 0);
    vars.set(OH.galleyShed, g(V.galleyMaster) === 1 && g('elec.r_main_ac_powered') && !g('elec.galley_powered') ? 1 : 0);
    vars.set(OH.apuReady, g(V.apuMaster) === 1 && g('apu.door_open') && g('apu.state') === 1 ? 1 : 0);
    for (const n of [1, 2, 3, 4] as const) vars.set(OH.probeFail(n), g(V.probeHeatOn(n)) && !g(`elec.probe${n}_powered`) ? 1 : 0);
    vars.set(OH.fireFault, g('fire.eng1_fault') || g('fire.eng2_fault') ? 1 : 0);
    vars.set(OH.apuPower, g('elec.apu_ecu_powered') ? 1 : 0);
    vars.set(OH.oxyPower, g('elec.oxy_panel_powered') ? 1 : 0);
  });
}

const PUMPS: [string, string, string][] = [
  ['boost_l', V.boostL, 'left'],
  ['alt_l', V.altL, 'left'],
  ['boost_r', V.boostR, 'right'],
  ['alt_r', V.altR, 'right'],
];
