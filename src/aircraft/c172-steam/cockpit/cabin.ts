/**
 * Cabin shell and cabin controls of the steam 172S (POH 172SPHUS Rev 5 Fig 6-4 cabin
 * dimensions; Sec 7 "Cabin doors, windows and exits", "Interior lighting", "Cabin heating,
 * ventilating and defrosting"):
 *
 *  - floor, side linings, door and rear side windows, windshield with the A-pillars, headliner,
 *    glareshield, firewall / kick panels, front seats and the rear bench (static);
 *  - overhead console with the left / right front flood-light switches and the dome / courtesy
 *    switch (steam: push switches, POH Sec 7); the rear dome light;
 *  - wing-root fresh-air vents (pull and rotate) in the upper forward door-post corners;
 *  - cabin door handles (OPEN / CLOSE / LOCK) and the openable storm windows (the lower aft pane of
 *    each door window) with the pane swinging open with the latch;
 *  - magnetic compass on the glareshield centre (Sec 7 "Magnetic compass"), OAT probe through the
 *    windshield, portable fire extinguisher between the front seats (Sec 7 "Portable fire
 *    extinguisher"), sun visors.
 *
 * SCOPE: the doors themselves do not swing open in the cockpit view (the handle position is the
 * door state: C172.doorLeft/Right drive the cabin draft cue and the checklists); the baggage door
 * is outside the cockpit (its var is set by the state presets).
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import type { SimContext } from '../../../core/SimContext';
import { bl, type BodyVec } from '../../../cockpit/frame';
import { Lever, PushButton, PushPullKnob } from '../../../cockpit/controls';
import { glareshieldGeometry, pillarGeometry } from '../../../cockpit/geometry/structure';
import { cylinderZ, roundedBox } from '../../../cockpit/geometry/primitives';
import { MagneticCompass } from '../../../avionics/analog';
import { sta } from '../../c172s-common/fdm';
import { C172, DOOR } from '../../c172s-common/vars';
import { CABIN, DOOR as DOOR_GEO, DOOR_WINDOW, FLOOR_H, GLARE, IN, OVERHEAD, PANEL, PANEL_H, REAR_WINDOW, SEATS, WINDSHIELD, hz, lerpTable } from './layout';

/** Quad through four body points (metres), counter-clockwise seen from the lit side. */
function quad(a: BodyVec, b: BodyVec, c: BodyVec, d: BodyVec): THREE.BufferGeometry {
  const pa = bl(...a);
  const pb = bl(...b);
  const pc = bl(...c);
  const pd = bl(...d);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, pc.x, pc.y, pc.z, pa.x, pa.y, pa.z, pc.x, pc.y, pc.z, pd.x, pd.y, pd.z], 3));
  g.computeVertexNormals();
  return g;
}

const hw = (fs: number): number => lerpTable(CABIN.halfWidth, fs);
const roof = (fs: number): number => lerpTable(CABIN.roofH, fs);

export interface CabinParts {
  stormLeft: THREE.Object3D;
  stormRight: THREE.Object3D;
}

export function buildCabin(b: CockpitBuilder, ctx: SimContext): CabinParts {
  const env = b.env;
  const mats = env.materials;
  const lining = mats.custom('plastic', '#8d8983', 0.85);
  lining.side = THREE.DoubleSide;
  const upholstery = mats.custom('plastic', '#6f6a63', 0.9);
  upholstery.side = THREE.DoubleSide;
  const headliner = mats.custom('plastic', '#bdb9b1', 0.92);
  headliner.side = THREE.DoubleSide;
  const carpet = mats.get('carpet');
  const dark = mats.custom('plastic', '#1b1b1d', 0.8);
  dark.side = THREE.DoubleSide;
  const glass = mats.get('windowGlass');
  const s = (m: THREE.Mesh): THREE.Mesh => m;

  // ---------------------------------------------------------------- floor, firewall / kick panels
  {
    const f0 = 8;
    const f1 = 72;
    const fw = (fs: number): number => hw(fs) * CABIN.floorRatio;
    s(b.structureMesh(quad([sta(f0), -fw(f0), hz(FLOOR_H)], [sta(f1), -fw(f1), hz(FLOOR_H)], [sta(f1), fw(f1), hz(FLOOR_H)], [sta(f0), fw(f0), hz(FLOOR_H)]), carpet, undefined, undefined, false));
    // Area under the panel down to the firewall (dark), so nothing shows through below the lower panel.
    const lowH = PANEL.topH - PANEL_H;
    b.structureMesh(quad([sta(10), -0.48, hz(FLOOR_H)], [sta(10), 0.48, hz(FLOOR_H)], [sta(10), 0.48, hz(lowH)], [sta(10), -0.48, hz(lowH)]), dark, undefined, undefined, false);
    b.structureMesh(quad([sta(10), -0.48, hz(lowH)], [sta(10), 0.48, hz(lowH)], [sta(PANEL.fs), 0.5, hz(lowH)], [sta(PANEL.fs), -0.5, hz(lowH)]), dark, undefined, undefined, false);
  }

  // ---------------------------------------------------------------- side linings and windows
  for (const side of [-1, 1] as const) {
    const y = (fs: number, inset = 0): number => side * (hw(fs) - inset);
    const wall = (fs0: number, fs1: number, h0: number, h1: number, mat: THREE.Material, inset = 0): void => {
      b.structureMesh(quad([sta(fs0), y(fs0, inset), hz(h0)], [sta(fs1), y(fs1, inset), hz(h0)], [sta(fs1), y(fs1, inset), hz(h1)], [sta(fs0), y(fs0, inset), hz(h1)]), mat, undefined, undefined, false);
    };
    // Kick panel ahead of the door, door lining below the window line, rear lining.
    wall(12, DOOR_GEO.fwdFsBottom, FLOOR_H, 1.46, lining);
    wall(DOOR_GEO.fwdFsBottom, DOOR_GEO.aftFs, FLOOR_H, 1.46, upholstery, 0.01);
    wall(DOOR_GEO.aftFs, 100, FLOOR_H, 1.46, lining);
    // Window line. The door's forward edge runs from FS 26 at the sill to FS 30 at the top (DOOR);
    // the windshield wraps round to it above the glareshield and the door window starts a frame
    // width (EST 1.5 in) aft of it, so the pilot looks out of the door window just aft of the
    // A-pillar (Fig 6-4 and cabin photographs), not at a solid door post.
    const quadSide = (a: [number, number], bq: [number, number], c: [number, number], d: [number, number], mat: THREE.Material): void => {
      b.structureMesh(quad([sta(a[0]), y(a[0]), hz(a[1])], [sta(bq[0]), y(bq[0]), hz(bq[1])], [sta(c[0]), y(c[0]), hz(c[1])], [sta(d[0]), y(d[0]), hz(d[1])]), mat, undefined, undefined, false);
    };
    const doorEdge = (h: number): number => DOOR_GEO.fwdFsBottom + ((DOOR_GEO.fwdFsTop - DOOR_GEO.fwdFsBottom) * (h - DOOR_GEO.sillH)) / (DOOR_GEO.topH - DOOR_GEO.sillH);
    const frame = 1.5; // EST door-frame width, in
    const wsH = WINDSHIELD.baseH;
    const [h0, h1] = [DOOR_WINDOW.h0, DOOR_WINDOW.h1];
    // Cabin side next to the instrument panel, below the windshield base.
    quadSide([14, h0], [doorEdge(h0) + frame, h0], [doorEdge(wsH) + frame, wsH], [14, wsH], lining);
    // Windshield side wrap forward of the door edge (above the glareshield).
    quadSide([14, wsH], [doorEdge(wsH), wsH], [doorEdge(h1), h1], [14, h1], glass as THREE.Material);
    // Door frame strip.
    quadSide([doorEdge(wsH), wsH], [doorEdge(wsH) + frame, wsH], [doorEdge(h1) + frame, h1], [doorEdge(h1), h1], lining);
    // Door window (DOOR_WINDOW.fs1 aft edge).
    quadSide([doorEdge(h0) + frame, h0], [DOOR_WINDOW.fs1, h0], [DOOR_WINDOW.fs1, h1], [doorEdge(h1) + frame, h1], glass as THREE.Material);
    wall(DOOR_WINDOW.fs1, REAR_WINDOW.fs0, 1.46, 1.79, lining);
    wall(REAR_WINDOW.fs0, REAR_WINDOW.fs1, 1.46, 1.79, glass as THREE.Material);
    wall(REAR_WINDOW.fs1, 110, 1.46, 1.79, lining);
    // Upper lining from the window top to the roof corner.
    for (const [fs0, fs1] of [
      [30, 70],
      [70, 110],
    ] as const) {
      b.structureMesh(
        quad([sta(fs0), y(fs0), hz(1.79)], [sta(fs1), y(fs1), hz(1.79)], [sta(fs1), y(fs1, CABIN.cornerR), hz(roof(fs1))], [sta(fs0), y(fs0, CABIN.cornerR), hz(roof(fs0))]),
        headliner,
        undefined,
        undefined,
        false,
      );
    }
    // Armrest on the door (static).
    const arm = new THREE.Mesh(env.geometry.get('c172s.armrest', () => roundedBox(0.05, 0.05, 0.38, 0.012)), upholstery);
    arm.position.copy(bl(sta(48), side * (hw(48) - 0.035), hz(1.12)));
    b.addStructure(arm, undefined, { occluder: false });
    // A-pillar.
    const pts = [bl(sta(WINDSHIELD.pillarBaseFs), side * 0.47, hz(WINDSHIELD.baseH)), bl(sta(28), side * 0.47, hz(1.8)), bl(sta(WINDSHIELD.pillarTopFs), side * 0.44, hz(WINDSHIELD.topH))];
    b.structureMesh(pillarGeometry(pts, 0.045, 0.03), lining, undefined, undefined, true);
  }

  // ---------------------------------------------------------------- windshield, headliner, glareshield
  b.structureMesh(
    quad([sta(WINDSHIELD.baseFs), 0.47, hz(WINDSHIELD.baseH)], [sta(WINDSHIELD.baseFs), -0.47, hz(WINDSHIELD.baseH)], [sta(WINDSHIELD.topFs), -0.44, hz(WINDSHIELD.topH)], [sta(WINDSHIELD.topFs), 0.44, hz(WINDSHIELD.topH)]),
    glass,
    undefined,
    undefined,
    false,
  );
  b.structureMesh(quad([sta(WINDSHIELD.topFs), -0.45, hz(roof(WINDSHIELD.topFs))], [sta(110), -0.4, hz(roof(110))], [sta(110), 0.4, hz(roof(110))], [sta(WINDSHIELD.topFs), 0.45, hz(roof(WINDSHIELD.topFs))]), headliner, undefined, undefined, false);
  {
    const g = glareshieldGeometry(1.0, GLARE.depth, GLARE.drop, 0.03, 0.06);
    const m = b.structureMesh(g, 'glareshield');
    m.position.copy(bl(GLARE.browX, 0, hz(GLARE.topH)));
    m.name = 'glareshield';
  }
  // Rear baggage curtain / bulkhead (dark).
  b.structureMesh(quad([sta(108), 0.42, hz(FLOOR_H)], [sta(108), -0.42, hz(FLOOR_H)], [sta(108), -0.4, hz(1.8)], [sta(108), 0.4, hz(1.8)]), dark, undefined, undefined, false);

  // ---------------------------------------------------------------- seats (static)
  for (const side of [-1, 1]) b.seat('ga', [sta(SEATS.frontFs), side * SEATS.y, hz(FLOOR_H)]);
  for (const side of [-1, 1]) b.seat('ga', [sta(SEATS.rearFs + 6), side * 0.2, hz(FLOOR_H)]);

  // ---------------------------------------------------------------- overhead console (flood / dome switches, vents)
  const ohFs = (OVERHEAD.fs0 + OVERHEAD.fs1) / 2;
  const oh = b.panel({
    name: 'c172s.overhead',
    center_m: [sta(ohFs), 0, hz(roof(ohFs) - 0.025)],
    facing: 'down',
    width: OVERHEAD.width,
    height: (OVERHEAD.fs1 - OVERHEAD.fs0) * IN,
    origin: 'center',
    material: headliner,
    thickness: 0.02,
    radius: 0.02,
    screws: false,
  });
  // POH Sec 7 "Interior lighting": the front flood lights "controlled by push switches" (steam) and the rear dome / courtesy light switch.
  const sw = (id: string, label: string, v: string, x: number, y: number, t: string): void => {
    oh.add(new PushButton(env, { id, label, var: v, mode: 'toggle', style: 'round', width: 0.011, capMaterial: 'plasticGrey', engraved: '', zone: null }), x, y);
    oh.label(t, x, y + 0.014, { height: 0.0022, zone: null, color: '#2a2a2a' });
  };
  sw('c172s.flood_left', 'FLOOD LIGHT left (push on/off)', C172.floodLeft, -0.05, 0.1, 'FLOOD');
  sw('c172s.flood_right', 'FLOOD LIGHT right (push on/off)', C172.floodRight, 0.05, 0.1, 'FLOOD');
  sw('c172s.dome', 'DOME / COURTESY LIGHTS (push on/off)', C172.domeCourtesy, 0, -0.1, 'DOME');
  for (const x of [-0.05, 0.05]) {
    const lens = new THREE.Mesh(env.geometry.get('c172s.flood_lens', () => cylinderZ(0.016, 0.014, 0, 0.006, 24)), mats.custom('gloss', '#e8e4d8', 0.3));
    lens.userData.cockpitStatic = true;
    oh.addObject(lens, x, 0.06);
  }
  // Flood lights on the panel (EST 2 cd each, POH: "flood lights ... in the overhead console").
  env.lighting.addFloodLight('c172s.flood.l', 'flood', [sta(ohFs), -0.05, hz(roof(ohFs) - 0.04)], [sta(PANEL.fs), -0.25, hz(PANEL.topH - 0.2)], b.root, 2, 55);
  env.lighting.addFloodLight('c172s.flood.r', 'flood', [sta(ohFs), 0.05, hz(roof(ohFs) - 0.04)], [sta(PANEL.fs), 0.25, hz(PANEL.topH - 0.2)], b.root, 2, 55);
  env.lighting.addDomeLight('c172s.dome', 'dome', [sta(72), 0, hz(roof(72) - 0.03)], b.root, 3);

  // Wing-root fresh-air vents (pull out, rotate to aim), upper forward corners.
  for (const side of [-1, 1] as const) {
    const vp = b.panel({
      name: `c172s.vent_${side < 0 ? 'l' : 'r'}`,
      center_m: [sta(30), side * (hw(30) - CABIN.cornerR * 0.6), hz(1.86)],
      facing: side < 0 ? 'right' : 'left',
      width: 0.07,
      height: 0.07,
      origin: 'center',
      material: lining,
      thickness: 0.01,
      radius: 0.02,
      screws: false,
    });
    vp.add(
      new PushPullKnob(env, {
        id: `c172s.vent_${side < 0 ? 'left' : 'right'}`,
        label: `${side < 0 ? 'Left' : 'Right'} wing-root air vent (pull open)`,
        var: side < 0 ? C172.ventLeft : C172.ventRight,
        valueIn: 0,
        valueOut: 1,
        style: 'plain',
        travel: 0.03,
        vernierStep: 0.1,
        clickToggles: true,
        material: 'knobGrey',
      }),
      0,
      0,
    );
  }

  // ---------------------------------------------------------------- door handles and storm windows
  const storm: THREE.Object3D[] = [];
  for (const side of [-1, 1] as const) {
    const left = side < 0;
    const dp = b.panel({
      name: `c172s.door_${left ? 'l' : 'r'}`,
      center_m: [sta(46), side * (hw(46) - 0.012), hz(1.3)],
      facing: left ? 'right' : 'left',
      width: 0.3,
      height: 0.24,
      origin: 'center',
      invisible: true,
    });
    dp.add(
      new Lever(env, {
        id: `c172s.door_${left ? 'left' : 'right'}`,
        label: `${left ? 'Pilot' : 'Copilot'} door handle (OPEN / CLOSE / LOCK)`,
        var: left ? C172.doorLeft : C172.doorRight,
        min: 0,
        max: 2,
        initial: DOOR.locked,
        discrete: true,
        detents: [
          { value: DOOR.open, label: 'OPEN' },
          { value: DOOR.closed, label: 'CLOSE' },
          { value: DOOR.locked, label: 'LOCK' },
        ],
        travel: { kind: 'arc', minDeg: -35, maxDeg: 35, pivotDepth: 0.01 },
        armLength: 0.07,
        armWidth: 0.014,
        knob: 'ball',
        knobScale: 0.8,
        slot: false,
        detentLabels: false,
        armMaterial: 'chrome',
        format: (v) => (Math.round(v) === DOOR.open ? 'OPEN' : Math.round(v) === DOOR.closed ? 'CLOSED' : 'LOCKED'),
      }),
      left ? 0.06 : -0.06,
      0,
      { rotDeg: left ? -90 : 90 },
    );
    // Storm window: lower aft pane of the door window, hinged at its top (POH Sec 7: "openable
    // window ... on each door"; 163 KIAS max open, Sec 2). Latch lever at its lower edge.
    const pane = new THREE.Group();
    pane.name = `storm_window_${left ? 'l' : 'r'}`;
    pane.userData.cockpitDynamic = true;
    const w = 0.28;
    const hgt = 0.2;
    const glassM = new THREE.Mesh(env.geometry.get('c172s.storm_glass', () => new THREE.PlaneGeometry(w, hgt)), glass);
    glassM.position.set(0, -hgt / 2, 0);
    pane.add(glassM);
    const frame = new THREE.Mesh(env.geometry.get('c172s.storm_frame', () => roundedBox(w, 0.012, 0.01, 0.003)), mats.get('plasticBlack'));
    frame.position.set(0, -hgt, 0.004);
    pane.add(frame);
    const hinge = bl(sta(56), side * (hw(56) - 0.004), hz(1.72));
    pane.position.copy(hinge);
    pane.rotation.set(0, left ? -Math.PI / 2 : Math.PI / 2, 0);
    b.root.add(pane);
    storm.push(pane);
    const wp = b.panel({
      name: `c172s.storm_latch_${left ? 'l' : 'r'}`,
      center_m: [sta(56), side * (hw(56) - 0.02), hz(1.5)],
      facing: left ? 'right' : 'left',
      width: 0.06,
      height: 0.04,
      origin: 'center',
      invisible: true,
    });
    wp.add(
      new Lever(env, {
        id: `c172s.storm_window_${left ? 'left' : 'right'}`,
        label: `${left ? 'Left' : 'Right'} storm window (latch / open)`,
        var: left ? C172.windowLeft : C172.windowRight,
        min: 0,
        max: 1,
        initial: 0,
        detents: [
          { value: 0, label: 'CLOSED' },
          { value: 1, label: 'OPEN' },
        ],
        travel: { kind: 'arc', minDeg: -25, maxDeg: 25, pivotDepth: 0.01 },
        armLength: 0.035,
        armWidth: 0.01,
        knob: 'ball',
        knobScale: 0.5,
        slot: false,
        detentLabels: false,
        armMaterial: 'chrome',
        format: (v) => (v < 0.05 ? 'CLOSED' : `OPEN ${Math.round(v * 100)}%`),
      }),
      0,
      0,
    );
  }

  // ---------------------------------------------------------------- compass, OAT probe, visors, extinguisher
  const compass = new MagneticCompass({ id: 'c172s.compass', vars: ctx.vars, lightVar: 'ac.light.glareshield' });
  b.place(compass, { center_m: [sta(PANEL.fs - 4), 0, hz(GLARE.topH + 0.045)], facing: 'aft', tiltDeg: 8 });
  {
    const probe = new THREE.Mesh(env.geometry.get('c172s.oat_probe', () => cylinderZ(0.004, 0.003, 0, 0.05, 12)), mats.get('chrome'));
    probe.position.copy(bl(sta(34), -0.3, hz(1.9)));
    probe.rotation.set(-Math.PI / 2, 0, 0);
    b.addStructure(probe, undefined, { occluder: false });
    for (const side of [-1, 1]) {
      const visor = new THREE.Mesh(env.geometry.get('c172s.visor', () => roundedBox(0.3, 0.14, 0.008, 0.02)), mats.custom('plastic', '#3b3a36', 0.6));
      visor.position.copy(bl(sta(38), side * 0.25, hz(1.93)));
      visor.rotation.set(-1.2, 0, 0);
      b.addStructure(visor, undefined, { occluder: false });
    }
  }
  {
    // Portable Halon 1211 extinguisher on the floor between the front seats (POH Sec 7), squeeze lever = discharge.
    const bottle = new THREE.Mesh(env.geometry.get('c172s.ext_bottle', () => cylinderZ(0.035, 0.035, 0, 0.3, 24)), mats.get('paintRed'));
    bottle.position.copy(bl(sta(44), 0, hz(FLOOR_H + 0.3)));
    bottle.rotation.set(Math.PI / 2, 0, 0);
    b.addStructure(bottle, undefined, { occluder: false });
    const ep = b.panel({ name: 'c172s.extinguisher', center_m: [sta(44), 0, hz(FLOOR_H + 0.32)], facing: 'up', width: 0.05, height: 0.05, origin: 'center', invisible: true });
    ep.add(
      new PushButton(env, { id: 'c172s.extinguisher', label: 'Portable fire extinguisher (squeeze to discharge)', var: C172.extinguisher, mode: 'toggle', style: 'mushroom', width: 0.02, capMaterial: 'plasticBlack' }),
      0,
      0,
    );
  }
  return { stormLeft: storm[0], stormRight: storm[1] };
}
