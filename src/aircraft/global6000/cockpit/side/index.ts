/**
 * Global 6000 side consoles, side panels and the cockpit circuit-breaker
 * panel (loaded by cockpit/index.ts through import.meta.glob; contract in
 * cockpit/context.ts).
 *
 * Sources: Global Express FCOM CSP 700-6 Vol. 2 01-10-35 .. 01-10-46
 * (flight compartment arrangement, pilot's / copilot's side console and side
 * panel, aft view of the 280 bulkhead) and CSP 700-5000-6 chapter 7 (EMS,
 * CCBP):
 *  - EMS CDU 1 / 2 (emsCdu.ts): on the Global Vision deck they sit in the
 *    outboard wings of the main panel below the STALL PUSHER plates (photo
 *    N835GL, crops c_lwing / c_rwing), not on the sidewall side panels of the
 *    Global Express FCOM drawing; this builder mounts them on `c.wings`
 *    (built by mainPanel.ts with the STALL PUSHER switches and gaspers). The
 *    map / reading lights are the READING LIGHT switches on the overhead
 *    forward edge (overhead/index.ts). The HUD has no cockpit power switch on
 *    the Vision deck (it is powered through its DC BUS 1 breaker; brightness
 *    and mode on the glareshield HUD knob). SCOPE: the clock (the Fusion
 *    displays carry the clock).
 *  - SIDE CONSOLE (horizontal, outboard of the seat; FCOM 01-10-37 / -46):
 *    oxygen mask / regulator stowage box (N / 100 %, RESET / TEST, flow
 *    blinker), headset panel (jacks only), and on the copilot's console the
 *    PASSENGER OXYGEN selector CLOSED / NORMAL / OVERRIDE with its PASS ON /
 *    LOW lamps. The crew oxygen supply valve is placed on the pilot's console
 *    (EST: the FCOM drawings do not show it). The pilot's NOSE STEER handwheel
 *    is built by the main cockpit at the forward end of the left console.
 *    SCOPE: Mach transducer / pitot-static SELECT VALVE, CVR panel and
 *    printer (no systems) are not built.
 *  - CCBP (Cockpit Circuit Breaker Panel, forward face of the 280 bulkhead
 *    behind the pilot; FCOM 01-10-36 item 3, 07-20-1): the thermal breakers of
 *    the modelled loads (cbTable.ts CCBP entries). All other breakers are SSPCs
 *    (EMS CDU) or thermal breakers inside the ACPC / DCPC (not in the
 *    cockpit), exactly as the FCOM describes.
 *  - Cockpit door: the Global flight-deck door is a manual door without an
 *    electric lock control on the flight deck (EST from the FCOM flight
 *    compartment chapter, which lists no door control), so none is built.
 *  - Passenger entry door (fix round P10): the entry door is immediately aft
 *    of the flight deck; a latch handle on the aft bulkhead beside the
 *    doorway stands in for it (writes `ac.door.pax_open`), so the BEFORE
 *    START "Doors - CLOSED" item is performable from the cockpit. SCOPE: no
 *    cabin / airstair model.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AnnunciatorLight, CircuitBreaker, PushButton, RotaryKnob, SelectorKnob, ToggleSwitch } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { trimBoxGeometry } from '../../../../cockpit/geometry/structure';
import { G6K_VARS as V } from '../../vars';
import { seg, WING_SLOTS, type G6kCockpitContext } from '../context';
import { FLOOR_Z, MAIN_PANEL, MOUNTS } from '../layout';
import { X_AFT } from '../shell';
import { CCBP_ENTRIES } from './cbTable';
import { EmsCduUnit, EmsShared, addEmsCduUnit, EMS_UNIT } from './emsCdu';
import { g6kFinish } from '../finish';
import { MaskStowage } from './oxygenMask';

/** Side console top (EST: armrest height, MOUNTS.side*; left console stops short of the NOSE STEER handwheel). */
export const SIDE_CONSOLE = {
  xAft: 10.36,
  xFwdLeft: 11.22, // the NOSE STEER tiller hub is set flush into the forward end of the left console (photo)
  xFwdRight: 11.22,
  topZ: MOUNTS.sideLeft.center_m[2],
  y: Math.abs(MOUNTS.sideLeft.center_m[1]),
  width: 0.24,
};


/** Cockpit Circuit Breaker Panel on the 280 bulkhead behind the pilot (EST size / position from FCOM 01-10-36). */
export const CCBP = { x: X_AFT + 0.012, y: -0.66, z: -0.86, width: 0.3, height: 0.17 };

export function buildSideConsoles(c: G6kCockpitContext): void {
  const { b } = c;
  b.zone({ id: 'panel_cb', intensityVar: 'ac.light.panel_cb', lagS: 0, gain: 1.4 });
  for (const z of ['map_l', 'map_r']) b.zone({ id: z, intensityVar: `ac.light.${z}`, lagS: 0, color: 0xfff1dc, gain: 2 });
  const vars = c.ctx.vars;
  const shared = new EmsShared(vars, c.sys.elec.breakerNames().map((x) => x.name), c.env.audio ?? null);
  // EMS CDU power (07-20-30 / -38): CDU 1 PWR B (BATT BUS); CDU 2 PWR A (APU BATT) / PWR B (BATT BUS).
  const units = [new EmsCduUnit(1, shared, c.ctx.events, 'ac.g6k.ck.ems1_pwr'), new EmsCduUnit(2, shared, c.ctx.events, 'ac.g6k.ck.ems2_pwr')];
  const canvas = c.canvas;
  buildSide(c, 'left');
  buildSide(c, 'right');
  // EMS CDU 1 / 2 in the main-panel wings.
  if (c.wings) {
    addEmsCduUnit(c.env, c.wings.left, 1, WING_SLOTS.ems.x, WING_SLOTS.ems.y, units[0], canvas, vars);
    addEmsCduUnit(c.env, c.wings.right, 2, MAIN_PANEL.wing.w - WING_SLOTS.ems.x - EMS_UNIT.w, WING_SLOTS.ems.y, units[1], canvas, vars);
  }
  buildCcbp(c);

  // ---- Passenger entry door latch handle (fix round P10; see the header note). On the aft bulkhead beside the
  // doorway, copilot side; ac.door.pax_open 1 = open (GXAG door warning: PASSENGER DOOR caution while open).
  const dp = b.panel({ name: 'g6k_pax_door', center_m: [X_AFT + 0.012, 0.46, -1.12], facing: 'fwd', width: 0.09, height: 0.1, origin: 'center', material: 'panelDark', radius: 0.008, screws: false });
  dp.label('PAX DOOR', 0, -0.038, { height: 0.0032, zone: 'panel_cb' });
  dp.add(
    new ToggleSwitch(c.env, {
      id: 'g6k.side.pax_door',
      label: 'PASSENGER DOOR LATCH',
      var: V.door('pax'),
      positions: ['OPEN', 'CLOSED'],
      values: [1, 0],
      labels: { positions: true, height: 0.0024, zone: 'panel_cb' },
      scale: 1.4,
    }),
    0,
    0.01,
  );

  const dim = ['ac.g6k.light.ems1_dim', 'ac.g6k.light.ems2_dim'];
  units[0].partner = units[1];
  units[1].partner = units[0];
  b.onUpdate((dt) => {
    const batt = vars.get('elec.batt_bus_powered') !== 0;
    // BATT MASTER EMS (GX PTG 6-8: "Electrical Management System is in maintenance mode. Batteries supply power to EMS
    // only"): the CDUs run from the battery direct buses with the battery bus isolated.
    const ems = vars.get(V.battMasterSel) === 1;
    vars.set('ac.g6k.ck.ems1_pwr', batt || (ems && vars.get('elec.av_batt_dir_powered') !== 0) ? 1 : 0);
    // GX PTG 6-8: BATT MASTER OFF isolates the batteries - both CDUs dark; the EMS position powers CDU 2 from the APU
    // battery direct bus (like CDU 1 from the AV battery), not the always-hot bus alone.
    vars.set('ac.g6k.ck.ems2_pwr', batt || (ems && vars.get('elec.apu_batt_dir_powered') !== 0) ? 1 : 0);
    // GX PTG 15-6: the L / R DISPLAY knobs also dim the EMS CDUs (times each unit's own BRT keys).
    for (let i = 0; i < units.length; i++) units[i].dim = vars.get(dim[i], 1);
    shared.tick(dt);
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      u.tick(dt);
      vars.set(u.onVar, u.powered && vars.get(u.awakeVar) !== 0 ? 1 : 0);
    }
  });
  // The cockpit build disposes controls and displays; the EMS key subscriptions are released with it.
  c.disposers?.push(() => {
    units.forEach((u) => u.dispose());
    shared.aural.dispose();
  });
}

function buildSide(c: G6kCockpitContext, side: 'left' | 'right'): void {
  const { b, env } = c;
  const S = SIDE_CONSOLE;
  const sgn = side === 'left' ? -1 : 1;
  const n = side === 'left' ? 1 : 2;
  const who = side === 'left' ? 'PILOT' : 'COPILOT';
  const zone = side === 'left' ? 'panel_l' : 'panel_r';

  // ---------------- console body and top plate
  const xFwd = side === 'left' ? S.xFwdLeft : S.xFwdRight;
  const len = xFwd - S.xAft;
  const xc = (xFwd + S.xAft) / 2;
  const bodyH = FLOOR_Z - S.topZ - 0.004;
  // Tan-leather side console (photo EB190582 e_tiller / e_lconsole).
  const fin = g6kFinish(env);
  b.structureMesh(trimBoxGeometry(S.width, bodyH, len, 0.01), fin.tan, [xc, sgn * S.y, S.topZ + 0.004 + bodyH / 2]).name = `console_${side}`;
  const con = b.panel({ name: `side_console_${side}`, center_m: [xc, sgn * S.y, S.topZ], facing: 'up', width: S.width, height: len, origin: 'top-left', material: fin.tan, radius: 0.008, screws: false });
  // Panel frame: x from the outboard (left console) / inboard (right console) edge, y aft from the forward end.
  const inb = (d: number) => (side === 'left' ? S.width - d : d); // x at distance d from the inboard edge

  // ---- headset panel (jacks only; no controls) near the forward end
  const hp = con.subPanel({ name: `g6k.headset_${side}`, x: inb(0.16), y: 0.06, width: 0.1, height: 0.07, origin: 'center', material: 'panelDark', screws: false });
  hp.label('HEADSET PANEL', 0, 0.026, { height: 0.0021, zone });
  const jackG = env.geometry.get('g6k.jack', () => new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 16).rotateX(Math.PI / 2).translate(0, 0, 0.003));
  const jackM = env.materials.get('chrome');
  (['MIC', 'HEADSET', 'HDPH'] as const).forEach((j, i) => {
    const m = new THREE.Mesh(jackG, jackM);
    m.userData.cockpitStatic = true;
    hp.addObject(m, -0.03 + i * 0.03, -0.004);
    hp.label(j, -0.03 + i * 0.03, 0.011, { height: 0.0018, zone });
  });

  // ---- oxygen mask stowage box (recessed under a tan leather lid: the Vision console top is flush leather with
  // the mask out of sight, photo EB190582 e_lconsole) with its regulator selector, RESET / TEST and flow blinker
  const boxY = 0.2;
  con.add(
    new MaskStowage(env, { id: `g6k.side.mask${n}`, label: `${who} OXYGEN MASK`, var: V.oxyMask(n), inboard: side === 'left' ? 1 : -1, size: [0.1, 0.12, 0.05], recess: 0.044, doorMaterial: fin.tan }),
    inb(0.13),
    boxY,
  );
  con.label('OXYGEN MASK', inb(0.13), boxY - 0.075, { height: 0.0024, zone });
  const regY = boxY + 0.1;
  // Regulator controls grouped on one recessed dark plate instead of scattered proud of the leather (photo).
  con.subPanel({ name: `g6k.oxyreg_${side}`, x: inb(0.1225), y: regY + 0.011, width: 0.115, height: 0.075, origin: 'center', z: -0.0008, material: 'panelDark', radius: 0.006, screws: false });
  con.add(
    new ToggleSwitch(env, {
      id: `g6k.side.oxy_mode${n}`,
      label: `${who} MASK REGULATOR N / 100%`,
      var: n === 1 ? V.oxyMaskMode : V.oxyMaskModeR,
      positions: ['N', '100%'],
      values: [0, 1],
      orientation: 'horizontal',
      labels: { positions: true, height: 0.0021, zone },
      scale: 0.75,
    }),
    inb(0.17),
    regY,
  );
  // EMERGENCY push (100 % oxygen, continuous positive pressure; GX PTG 8-7 regulator drawing "EMERGENCY / PUSH").
  con.add(new PushButton(env, { id: `g6k.side.oxy_emer${n}`, label: `${who} MASK EMERGENCY`, var: V.oxyEmer(n), mode: 'toggle', style: 'round', width: 0.01, capMaterial: 'knobRed' }), inb(0.145), regY + 0.02);
  con.label('EMERGENCY', inb(0.145), regY + 0.031, { height: 0.0017, zone });
  con.add(new PushButton(env, { id: `g6k.side.oxy_test${n}`, label: `${who} MASK RESET/TEST`, var: V.oxyTest(n), mode: 'momentary', style: 'round', width: 0.011 }), inb(0.12), regY);
  con.label('RESET/TEST', inb(0.12), regY - 0.012, { height: 0.0019, zone });
  con.add(
    new AnnunciatorLight(env, {
      id: `g6k.side.oxy_flow${n}`,
      label: `${who} OXYGEN FLOW`,
      width: 0.012,
      height: 0.009,
      segments: [seg.on('FLOW', 'green', `oxy.${n === 1 ? 'pilot' : 'copilot'}_flowing`)],
    }),
    inb(0.075),
    regY,
  );

  // OXYGEN SUPPLY LOWER DISCONNECT ON / OFF on each side console (GX PTG 15-10 side-console drawing): that mask's supply.
  con.add(
    new ToggleSwitch(env, {
      id: side === 'left' ? 'g6k.side.crew_oxy' : 'g6k.side.crew_oxy_r',
      label: `${who} OXYGEN SUPPLY LOWER DISCONNECT`,
      var: side === 'left' ? V.crewOxy : V.crewOxyR,
      positions: ['OFF', 'ON'],
      values: [0, 1],
      labels: { positions: true, height: 0.0021, zone },
      scale: 0.8,
    }),
    inb(side === 'left' ? 0.12 : 0.205),
    regY + 0.07,
  );
  con.label('OXYGEN SUPPLY', inb(side === 'left' ? 0.12 : 0.205), regY + 0.047, { height: 0.0019, zone });
  con.label('LOWER DISCONNECT', inb(side === 'left' ? 0.12 : 0.205), regY + 0.051, { height: 0.0017, zone });
  if (side === 'right') {
    // PASSENGER OXYGEN selector (FCOM 01-10-46 item 4): CLOSED / NORMAL / OVERRIDE with PASS ON and LOW lamps.
    const py = regY + 0.075;
    con.add(
      new SelectorKnob(env, {
        id: 'g6k.side.pax_oxy',
        label: 'PASSENGER OXYGEN',
        var: V.paxOxy,
        cap: 'pointer',
        diameter: 0.018,
        labelRadius: 0.023,
        labelHeight: 0.0021,
        labelZone: zone,
        positions: [
          { value: 0, label: 'CLOSED', angle: -60 },
          { value: 1, label: 'NORMAL', angle: 0 },
          { value: 2, label: 'OVERRIDE', angle: 60 },
        ],
        initial: 1,
      }),
      inb(0.1),
      py,
    );
    con.label('PASSENGER OXYGEN', inb(0.1), py - 0.035, { height: 0.0023, zone });
    con.add(new AnnunciatorLight(env, { id: 'g6k.side.pax_on', label: 'PASS OXY ON', width: 0.014, height: 0.01, unlitTint: 0.05, segments: [seg.on(['PASS', 'ON'], 'white', 'oxy.pax_on')] }), inb(0.175), py + 0.012);
    con.add(new AnnunciatorLight(env, { id: 'g6k.side.pax_low', label: 'PASS OXY LOW', width: 0.014, height: 0.01, unlitTint: 0.05, segments: [seg.on('LOW', 'amber', 'oxy.pax_low')] }), inb(0.175), py - 0.004);
  }

  if (side === 'left') {
    // Chrome cup holder just aft of the NOSE STEER hub (photo EB190582 e_tiller: chrome ring set into the leather).
    const ringG = env.geometry.get('g6k.cup.ring', () => new THREE.TorusGeometry(0.036, 0.0035, 10, 32));
    const cupG = env.geometry.get('g6k.cup.cup', () => new THREE.CylinderGeometry(0.034, 0.03, 0.05, 28, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.025));
    const ring = new THREE.Mesh(ringG, env.materials.get('chrome'));
    ring.userData.cockpitStatic = true;
    con.addObject(ring, inb(0.065), 0.135, { z: 0.0015 });
    const cup = new THREE.Mesh(cupG, env.materials.get('steel'));
    cup.userData.cockpitStatic = true;
    con.addObject(cup, inb(0.065), 0.135, { z: 0.0015 });
  }
}

/** CCBP: thermal breakers grouped by bus, with the rating on each collar (07-20-1). */
function buildCcbp(c: G6kCockpitContext): void {
  const { b, env } = c;
  const C = CCBP;
  const p = b.panel({ name: 'ccbp', center_m: [C.x, C.y, C.z], facing: 'fwd', width: C.width, height: C.height, origin: 'top-left', material: 'panel', radius: 0.008, screws: { kind: 'dzus', diameter: 0.0065, inset: 0.008, pitch: 0.2 } });
  const housing = new THREE.Mesh(new THREE.BoxGeometry(C.width + 0.02, C.height + 0.02, 0.05), env.materials.get('panelDark'));
  b.trackGeometry(housing.geometry);
  housing.userData.cockpitStatic = true;
  p.addObject(housing, C.width / 2, C.height / 2, { z: -0.026 });
  p.label('COCKPIT CIRCUIT BREAKER PANEL', C.width / 2, 0.014, { height: 0.0032, zone: 'panel_cb' });
  const rating = new Map(c.sys.elec.breakerNames().map((x) => [x.name, x.ratingA]));
  const groups = new Map<string, typeof CCBP_ENTRIES>();
  for (const e of CCBP_ENTRIES) {
    if (!rating.has(e.id)) continue;
    const g = groups.get(e.bus) ?? [];
    g.push(e);
    groups.set(e.bus, g);
  }
  // Sections A .. H in two rows of four (07-20-1 drawing), one bus per section.
  const cols = 4;
  const secW = (C.width - 0.016) / cols;
  const secH = 0.062;
  let k = 0;
  // SCOPE: only the modelled loads get interactive breakers (cbTable.ts). The real CCBP (FCOM 07-20-1 drawing
  // FGF0720_005) is a dense panel of several dozen thermal breakers in 8 lettered bus sections, so the remaining
  // drawing positions are filled with engraved, non-functional collared dummies (one merged mesh) to keep the
  // panel's density without inventing load names.
  const dummies: THREE.BufferGeometry[] = [];
  const dummyAt = (bx: number, by: number) => {
    const collar = new THREE.CylinderGeometry(0.0062, 0.0062, 0.0022, 18).rotateX(Math.PI / 2).translate(bx, -by, 0.0011);
    const button = new THREE.CylinderGeometry(0.0038, 0.0038, 0.0075, 14).rotateX(Math.PI / 2).translate(bx, -by, 0.0037);
    dummies.push(collar, button);
  };
  for (const [bus, list] of groups) {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const x0 = 0.008 + col * secW;
    const y0 = 0.026 + row * (secH + 0.004);
    p.label(`${'ABCDEFGH'[k]}   ${bus} BUS`, x0 + secW / 2, y0 + 0.004, { height: 0.0024, zone: 'panel_cb' });
    p.line(x0 + 0.004, y0 + 0.009, x0 + secW - 0.004, y0 + 0.009, 0.0004, 'panel_cb');
    for (let i = list.length; i < 6; i++) dummyAt(x0 + 0.014 + (i % 3) * 0.024, y0 + 0.024 + Math.floor(i / 3) * 0.034);
    list.forEach((e, i) => {
      const bx = x0 + 0.014 + (i % 3) * 0.024;
      const by = y0 + 0.024 + Math.floor(i / 3) * 0.034;
      const r = rating.get(e.id)!;
      p.add(
        new CircuitBreaker(env, {
          id: `g6k.cb.${e.id}`,
          label: `CB ${e.name}`,
          var: `cb.${e.id}`,
          trippedVar: `cb.${e.id}_tripped`,
          rating: Number.isInteger(r) ? String(r) : r.toFixed(1),
          diameter: 0.0095,
        }),
        bx,
        by,
      );
      // Two-line engraved name under the breaker.
      const words = e.name.split(' ');
      const half = Math.ceil(words.length / 2);
      p.label(words.slice(0, half).join(' '), bx, by + 0.012, { height: 0.0017, zone: 'panel_cb' });
      if (words.length > 1) p.label(words.slice(half).join(' '), bx, by + 0.0155, { height: 0.0017, zone: 'panel_cb' });
    });
    k++;
  }
  if (dummies.length) {
    const g = mergeGeometries(dummies, false)!;
    for (const d of dummies) d.dispose();
    b.trackGeometry(g);
    const mesh = new THREE.Mesh(g, env.materials.get('plasticBlack'));
    mesh.userData.cockpitStatic = true;
    mesh.name = 'ccbp_dummy_breakers';
    p.addObject(mesh, 0, 0, { z: 0.0005 });
  }
}
