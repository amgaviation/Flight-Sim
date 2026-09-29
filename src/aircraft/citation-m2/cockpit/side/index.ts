/**
 * Citation M2 cockpit sidewalls (loaded by cockpit/index.ts through
 * import.meta.glob; contract `M2CockpitPart` in cockpit/index.ts).
 *
 * Per side, on the side console beside the crew member's legs:
 *   - the circuit-breaker panel (S&D15 §9.4 "Left and right circuit breaker
 *     panels are positioned on the cockpit sidewall within easy reach of each
 *     pilot"; breakers.ts), every breaker bound to its `cb.<name>` in the
 *     electrical network (pulling it removes power from that load; the
 *     network trips it on over-current and the button pops out). M2-L37
 *     (S&D21 Fig 3, flyradius, Skies 2017): the panel lies on the inclined
 *     (~45 deg, facing up / inboard) top of the side console and runs from near
 *     the instrument panel aft to the cupholders, dense rows under white group
 *     lines; coloured collars per group (EST colours);
 *   - dual cupholders directly aft of it (S&D15 §11.1 "Dual cupholders for
 *     each crew seat"; flyradius: two per side) and a sidewall map pocket;
 *   - a push-to-talk switch under each crew armrest (AOPA Mar 2014: "Underneath
 *     each pilot armrest, Cessna added a yoke-free push-to-talk switch"),
 *     `ac.m2.ptt<n>`: the G3000 COM field shows TX (systems/logic.ts). EST: on
 *     the inboard face of the outboard armrest's front end so it stays reachable;
 * LH side only:
 *   - the guarded BATTERY DISCONNECT switch NORMAL / DISC (CAE CJ-family
 *     differences p.5-23: "located on the left side of the cockpit, above the
 *     pilot's armrest"), `ac.m2.batt_disc` (systems/electrical.ts relay);
 * RH side only:
 *   - the 110 V AC outlet (S&D15 §9.4 / §11.1) with a plug that switches the
 *     500 W inverter on (outlet.ts) and a green power LED (outlet voltage from
 *     services.ts);
 *   - the cockpit hand fire extinguisher (S&D15 §14 "Fire Extinguisher in
 *     Cockpit"; EST location, stowed in a bracket on the copilot's lower
 *     sidewall).
 * Also appends `M2CabinServices` (services.ts) to the systems list.
 *
 * Audio: the M2 has no audio control panel; the dual GMA 36 remote audio
 * processors are controlled from the GTC 570s (S&D15 §10.3.H), and the hand
 * microphones are on the control columns (flightControls.ts). SCOPE: no
 * headset / mic jacks; transmission is not modelled (TX state only).
 * Cockpit door: none on the M2 (open cockpit, S&D15 Figure IV floorplan).
 *
 * Geometry EST (panel drawings not public): panels 0.56 m long from x 2.92 to
 * 3.48 on a 45 deg console top between the lining and the seat; black panel,
 * white engraved names lit by the PANEL dimmer.
 */
import * as THREE from 'three';
import type { CockpitBuilder, Panel } from '../../../../cockpit/CockpitBuilder';
import { AnnunciatorLight, CircuitBreaker, GuardedSwitch, PushButton } from '../../../../cockpit/controls';
import { bl } from '../../../../cockpit/frame';
import { cylinderZ, merge, roundedBox, transform } from '../../../../cockpit/geometry/primitives';
import { SimVars } from '../../../../core/SimVars';
import { createElectrical } from '../../systems/electrical';
import type { M2CockpitContext } from '../index';
import { M2 } from '../../vars';
import { SEAT } from '../layout';
import { m2CbGroups, ratingText } from './breakers';
import { wallY } from './interior';
import { AcOutletPlug } from './outlet';
import { M2CabinServices, M2_SIDE_VARS } from './services';

/** Circuit-breaker panel on the inclined side-console top (EST): centre x, outer (upper) edge z, slope, length. */
export const CB_PANEL = { x: 3.2, zOuter: 0.1, slopeDeg: 45, width: 0.56, wallGap: 0.012 };
/** Breaker layout: columns per row, pitch (m), row pitch (breaker + its engraved name), group title height. */
const CB = { cols: 20, pitch: 0.026, rowPitch: 0.028, titleH: 0.014, diameter: 0.0095, nameH: 0.0025, titleTextH: 0.0029 };
/** Group collar colours (EST: green / white collars seen on some breakers in the photos). */
const COLLARS = ['#2f8f46', '#d8d8d2', '#2f8f46', '#d8d8d2', '#2f8f46', '#d8d8d2'];

/** Every network breaker (name, rating) from a throw-away instance of the M2 network (setup only). */
function networkBreakers(): { name: string; ratingA: number }[] {
  return createElectrical({ vars: new SimVars() }).breakerNames();
}

export default function buildSidewalls(b: CockpitBuilder, c: M2CockpitContext): void {
  const breakers = networkBreakers();
  for (const side of ['left', 'right'] as const) buildSide(b, side, breakers);
  buildBatteryDisconnect(b);
  for (const n of [1, 2] as const) buildPtt(b, n);
  c.systems.push(new M2CabinServices(c.ctx));
}

/** Guarded BATTERY DISCONNECT on the LH sidewall above the pilot's armrest (CAE p.5-23; EST position). */
function buildBatteryDisconnect(b: CockpitBuilder): void {
  const x = 3.08;
  const z = 0.07;
  const p = b.panel({ name: 'm2.batt_disc', center_m: [x, -(wallY(x, z) - 0.006), z], facing: 'right', width: 0.06, height: 0.07, material: 'panel', radius: 0.005, screws: false });
  p.add(
    new GuardedSwitch(b.env, {
      id: 'm2.side.batt_disc',
      var: M2.battDisc,
      label: 'BATTERY DISCONNECT',
      positions: ['NORMAL', 'DISC'],
      values: [0, 1],
      scale: 0.85,
      labels: { name: false, positions: true, height: 0.0024 },
      guard: { color: 'red', guardedPosition: 0, hinge: 'top' },
    }),
    0,
    -0.004,
  );
  p.label('BATTERY\nDISCONNECT', 0, 0.027, { height: 0.0028 });
}

/** Push-to-talk switch under each crew armrest (AOPA Mar 2014). Seat armrest per cockpit/geometry seatGeometry('bizjet'). */
function buildPtt(b: CockpitBuilder, n: 1 | 2): void {
  const s = n === 1 ? -1 : 1;
  // Outboard armrest: seat local x (W/2 + 0.035) = 0.295, top 0.62 above the seat origin, front end 0.115 aft of it.
  const armY = SEAT.y + 0.295;
  const x = SEAT.x - 0.13;
  const z = SEAT.z - 0.6;
  const p = b.panel({ name: `m2.ptt${n}`, center_m: [x, s * (armY - 0.031), z], normal: [0, -s, 0.35], up: [0, 0, -1], width: 0.03, height: 0.022, material: 'panel', radius: 0.004, screws: false });
  p.add(new PushButton(b.env, { id: `m2.side.ptt${n}`, var: M2.ptt(n), label: `${n === 1 ? 'PILOT' : 'COPILOT'} PUSH TO TALK`, style: 'round', width: 0.011, mode: 'momentary', engraved: '', capMaterial: 'plasticBlack' }), 0, 0.002);
  p.label('PTT', 0, -0.008, { height: 0.0024 });
}

function buildSide(b: CockpitBuilder, side: 'left' | 'right', network: { name: string; ratingA: number }[]): void {
  const env = b.env;
  const mats = env.materials;
  const s = side === 'left' ? -1 : 1;
  const C = CB_PANEL;
  const groups = m2CbGroups(side, network);
  const rows = groups.reduce((n, g) => n + Math.ceil(g.items.length / CB.cols), 0);
  const height = 0.026 + groups.length * CB.titleH + rows * CB.rowPitch + 0.01;
  const t = (C.slopeDeg * Math.PI) / 180;
  // Outer (upper) edge against the lining at zOuter; the face slopes down and inboard at slopeDeg.
  const wallOuter = wallY(C.x, C.zOuter) - C.wallGap;
  const yIn = wallOuter - height * Math.cos(t);
  const zIn = C.zOuter + height * Math.sin(t);
  const cy = s * (wallOuter + yIn) / 2;
  const cz = (C.zOuter + zIn) / 2;
  // Console under the panel: a wedge from the inclined face to the lining (dark grey, as the lower sidewall trim).
  {
    const sh = new THREE.Shape();
    const w = wallOuter - yIn + C.wallGap;
    const h = zIn - C.zOuter;
    // Local x = body y (mirrored per side in the shape itself; ExtrudeGeometry normalises the winding).
    sh.moveTo(0, -0.004);
    sh.lineTo(s * w, h - 0.004);
    sh.lineTo(s * w, -0.22);
    sh.lineTo(0, -0.22);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: C.width + 0.03, bevelEnabled: false });
    g.translate(0, 0, -(C.width + 0.03) / 2);
    const housing = new THREE.Mesh(g, mats.custom('plastic', '#3a3b3d', 0.7));
    b.trackGeometry(g);
    housing.name = `m2.cb_housing_${side}`;
    // Local frame (x right, y up, z aft): shape x -> outboard, y -> up; place at the inboard lower edge.
    b.addStructure(housing, [C.x, s * yIn, zIn]);
  }

  const p = b.panel({
    name: `m2.cb_${side}`,
    center_m: [C.x, cy, cz],
    normal: [0, -s * Math.sin(t), -Math.cos(t)],
    up: [0, s * Math.cos(t), -Math.sin(t)],
    width: C.width,
    height,
    origin: 'top-left',
    material: 'panel',
    radius: 0.006,
    screws: { kind: 'dzus', diameter: 0.0065, inset: 0.008, pitch: 0.2 },
  });
  p.label(side === 'left' ? 'LH CIRCUIT BREAKERS' : 'RH CIRCUIT BREAKERS', C.width / 2, 0.01, { height: 0.0036 });
  buildBreakers(b, p, side, groups, 0.026);

  buildCupholders(b, side);
  if (side === 'right') buildOutlet(b);
  if (side === 'right') buildExtinguisher(b);
}

function buildBreakers(b: CockpitBuilder, p: Panel, side: string, groups: ReturnType<typeof m2CbGroups>, yTop: number): void {
  let yy = yTop;
  const W = CB_PANEL.width;
  const collarGeo = new THREE.RingGeometry(CB.diameter * 0.52, CB.diameter * 0.72, 20);
  b.trackGeometry(collarGeo);
  let gi = 0;
  for (const g of groups) {
    const collarMat = b.env.materials.custom('paint', COLLARS[gi++ % COLLARS.length], 0.5);
    const n = Math.min(CB.cols, g.items.length);
    p.bracket(g.title, W / 2, yy, (n - 1) * CB.pitch + 0.02, { height: CB.titleTextH });
    yy += CB.titleH;
    g.items.forEach((it, i) => {
      const col = i % CB.cols;
      const row = Math.floor(i / CB.cols);
      const inRow = Math.min(CB.cols, g.items.length - row * CB.cols);
      const xs = W / 2 - ((inRow - 1) * CB.pitch) / 2;
      const cb = p.add(
        new CircuitBreaker(b.env, {
          id: `m2.cb.${it.name}`,
          label: `${side === 'left' ? 'LH' : 'RH'} CB ${it.label}`,
          var: `cb.${it.name}`,
          trippedVar: `cb.${it.name}_tripped`,
          rating: ratingText(it.ratingA),
          name: false, // engraved below by the panel (larger than the control's 2.1 mm default, EST ~2.7 mm)
          diameter: CB.diameter,
        }),
        xs + col * CB.pitch,
        yy + 0.004 + row * CB.rowPitch,
      );
      p.label(it.label, xs + col * CB.pitch, yy + 0.004 + row * CB.rowPitch + CB.diameter * 0.75 + 0.0055, { height: CB.nameH });
      // Coloured collar around the breaker (static, merged).
      const collar = new THREE.Mesh(collarGeo, collarMat);
      collar.userData.cockpitStatic = true;
      p.addObject(collar, xs + col * CB.pitch, yy + 0.004 + row * CB.rowPitch, { z: 0.0006 });
      // Draw-call saving (63 breakers): the white band is only visible with the breaker out, so it is
      // hidden (not drawn) while the breaker is in.
      const band = cb.object.getObjectByName('cbWhiteBand');
      if (band) {
        const v = b.env.vars;
        const name = `cb.${it.name}`;
        band.visible = v.get(name, 1) === 0;
        b.onUpdate(() => {
          band.visible = v.get(name, 1) === 0;
        });
      }
    });
    yy += Math.ceil(g.items.length / CB.cols) * CB.rowPitch;
  }
}

/** Dual cupholders on a small ledge aft of the CB panel, and the map pocket below it (static). */
function buildCupholders(b: CockpitBuilder, side: 'left' | 'right'): void {
  const mats = b.env.materials;
  const s = side === 'left' ? -1 : 1;
  // Directly aft of the CB panel on the same console (M2-L37).
  const x = CB_PANEL.x - CB_PANEL.width / 2 - 0.1;
  const z = 0.17;
  const wall = wallY(x, z) - 0.04;
  // Ledge (local frame x right, y up, z aft): 0.075 deep, 0.17 long, top at y 0; two cup wells with chrome rims.
  const ledge = b.structureMesh(roundedBox(0.075, 0.018, 0.17, 0.006).translate(0, -0.009, 0), mats.custom('plastic', '#2e2f31', 0.6), [x, s * (wall - 0.036), z], undefined, false);
  ledge.name = `m2.cupholders_${side}`;
  const rim = new THREE.TorusGeometry(0.034, 0.0025, 8, 32).rotateX(Math.PI / 2);
  const well = new THREE.CircleGeometry(0.032, 28).rotateX(-Math.PI / 2);
  b.trackGeometry(rim, well);
  for (const dz of [-0.042, 0.042]) {
    const at = bl(x - dz, s * (wall - 0.036), z);
    const r = new THREE.Mesh(rim, mats.get('chrome'));
    r.position.copy(at);
    r.position.y += 0.001;
    const w = new THREE.Mesh(well, mats.get('plasticBlack'));
    w.position.copy(at);
    w.position.y += 0.0004;
    b.addStructure(r, undefined, { occluder: false });
    b.addStructure(w, undefined, { occluder: false });
  }
  // Map pocket: an open pouch on the lower sidewall (leather-look), 0.28 x 0.14.
  const zp = 0.36;
  const pocket = b.structureMesh(roundedBox(0.02, 0.14, 0.28, 0.008), mats.get('leather'), [3.05, s * (wallY(3.05, zp) - 0.012), zp], undefined, false);
  pocket.name = `m2.map_pocket_${side}`;
}

/** Copilot sidewall 110 V outlet with its plug and power LED. */
function buildOutlet(b: CockpitBuilder): void {
  const x = 3.0;
  const z = -0.03;
  const p = b.panel({ name: 'm2.ac_outlet', center_m: [x, wallY(x, z) - 0.006, z], facing: 'left', width: 0.06, height: 0.09, material: 'panel', radius: 0.006, screws: false });
  p.add(new AcOutletPlug(b.env, { id: 'm2.side.ac_outlet', label: '110 VAC OUTLET', var: M2_SIDE_VARS.outletPlug }), 0, -0.006);
  p.label('110 VAC 60 Hz', 0, 0.034, { height: 0.0024 });
  p.add(
    new AnnunciatorLight(b.env, {
      id: 'm2.side.ac_outlet_lt',
      label: '110 VAC POWER',
      width: 0.006,
      height: 0.006,
      bezel: false,
      segments: [{ text: '', color: 'green', var: M2_SIDE_VARS.outletV, test: (v) => v > 50 }],
    }),
    0.022,
    0.034,
  );
}

/** Hand fire extinguisher in its bracket (static, EST: ~2.5 lb Halon 1211 bottle, 0.3 m long). */
function buildExtinguisher(b: CockpitBuilder): void {
  const mats = b.env.materials;
  const x = 2.72;
  const z = 0.46;
  const g = new THREE.Group();
  g.name = 'm2.fire_extinguisher';
  const bottle = new THREE.Mesh(cylinderZ(0.04, 0.04, -0.13, 0.12, 24), mats.custom('paint', '#b3141b', 0.35));
  const head = new THREE.Mesh(merge([cylinderZ(0.014, 0.014, 0.12, 0.155, 16), transform(new THREE.BoxGeometry(0.012, 0.05, 0.012), 0, 0.02, 0.15)]), mats.get('steel'));
  const straps = new THREE.Mesh(merge([transform(cylinderZ(0.043, 0.043, -0.08, -0.065, 24), 0, 0, 0), transform(cylinderZ(0.043, 0.043, 0.05, 0.065, 24), 0, 0, 0)]), mats.get('plasticBlack'));
  b.trackGeometry(bottle.geometry, head.geometry, straps.geometry);
  g.add(bottle, head, straps);
  // Horizontal along the fuselage (cylinder axis local z = body -x).
  b.addStructure(g, [x, wallY(x, z) - 0.05, z], { occluder: false });
}
