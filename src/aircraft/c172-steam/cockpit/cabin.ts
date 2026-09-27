/**
 * Cabin shell and cabin controls of the steam 172S (POH 172SPHUS Rev 5 Fig 6-4 cabin
 * dimensions; Sec 7 "Cabin doors, windows and exits", "Interior lighting", "Cabin heating,
 * ventilating and defrosting"):
 *
 *  - floor, side linings, door and rear side windows, windshield with the A-pillars, headliner,
 *    glareshield, firewall / kick panels, front seats and the rear bench (static);
 *  - overhead console (POH Sec 7 "Interior lighting") from the windshield top aft over the rear
 *    seats: the two individually rotatable front flood lights, each with its push switch, the
 *    centre overhead speaker grille and the rear dome light with its push switch;
 *  - windshield defroster outlets at the windshield base with their two sliding-valve knobs
 *    (POH Sec 7 "Cabin heating, ventilating and defrosting");
 *  - wing-root fresh-air vents (pull and rotate) in the upper forward door-post corners;
 *  - cabin door handles (OPEN / CLOSE / LOCK) and the openable storm windows (the lower aft pane of
 *    each door window) with the pane swinging open with the latch;
 *  - magnetic compass on the glareshield centre (Sec 7 "Magnetic compass"), OAT probe through the
 *    windshield, portable fire extinguisher between the front seats (Sec 7 "Portable fire
 *    extinguisher"), the sun visors (swing down / up).
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
import { pillarGeometry } from '../../../cockpit/geometry/structure';
import { cylinderZ, roundedBox, merge } from '../../../cockpit/geometry/primitives';
import { MagneticCompass } from '../../../avionics/analog';
import { sta } from '../../c172s-common/fdm';
import { C172, DOOR } from '../../c172s-common/vars';
import { ST } from '../vars';
import { CABIN, DOOR as DOOR_GEO, DOOR_WINDOW, EYE, FLOOR_H, GLARE, IN, OVERHEAD, PANEL, PANEL_CORNER_IN, PANEL_H, PANEL_W, REAR_WINDOW, SEATS, WINDSHIELD, hz, lerpTable } from './layout';
import { FloodEyeball, SunVisor } from './cabinControls';

/**
 * Glareshield cross-section seen from the seat (cockpit-local x right, y up, origin at the panel's
 * upper edge on the centreline): full width at the top, the lower edge following the panel's upper
 * outline (5.3 in corner radii, POH Fig 7-2) `lip` below it, so the padded brow curves down over the
 * rounded panel corners (VH-SPQ / N146TC photographs). `inset` shrinks the outline (bevel allowance).
 */
function glareshieldShape(inset: number): THREE.Shape {
  const W = PANEL_W / 2 - inset;
  const r = PANEL_CORNER_IN * IN;
  const lip = GLARE.lipIn * IN - inset;
  const top = GLARE.topH - PANEL.topH - inset;
  const s = new THREE.Shape();
  s.moveTo(-W, top);
  s.lineTo(W, top);
  s.lineTo(W, -r - lip);
  s.quadraticCurveTo(W, -lip, W - r, -lip);
  s.lineTo(-W + r, -lip);
  s.quadraticCurveTo(-W, -lip, -W, -r - lip);
  s.closePath();
  return s;
}

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
  /** Windshield fog / frost film (opacity from C172.windshieldFog, cockpit hook). */
  fog: THREE.Mesh;
  /** CO symptom shade around the pilot's eye (opacity from ST.coImpair, cockpit hook). */
  coShade: THREE.Mesh;
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
    // Door trim panel (POH Sec 7 "Cabin doors"; photographs): an upholstered inset proud of the
    // door lining from the forward door edge to the aft edge below the window, with the moulded
    // armrest joined to it along its upper part and a recessed escutcheon for the inside handle at
    // its forward end (FS ~42). EST dimensions from the photographs.
    {
      const inset = new THREE.Mesh(env.geometry.get('c172s.door_trim', () => roundedBox(0.012, 0.5, 0.86, 0.01, 2)), upholstery);
      inset.position.copy(bl(sta(46), side * (hw(46) - 0.008), hz(1.14)));
      b.addStructure(inset, undefined, { occluder: false });
      // Armrest: a wedge-section pad on the trim panel (top flat, lower face sloping into the panel).
      const armGeo = env.geometry.get('c172s.door_armrest', () => {
        const sh = new THREE.Shape();
        sh.moveTo(0, 0);
        sh.lineTo(0.065, 0);
        sh.quadraticCurveTo(0.072, 0, 0.072, -0.008);
        sh.lineTo(0.06, -0.03);
        sh.lineTo(0, -0.07);
        sh.closePath();
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.006, bevelSegments: 2 });
        g.translate(0, 0, -0.17);
        return g;
      });
      const arm = new THREE.Mesh(armGeo, upholstery);
      arm.position.copy(bl(sta(51), side * (hw(51) - 0.014), hz(1.2)));
      // Shape x grows inboard from the trim panel face (mirrored on the right door; double-sided material).
      arm.scale.set(side < 0 ? 1 : -1, 1, 1);
      b.addStructure(arm, undefined, { occluder: false });
      // Recessed handle escutcheon (dark cup) at the forward end of the trim panel.
      const esc = new THREE.Mesh(env.geometry.get('c172s.door_escutcheon', () => roundedBox(0.006, 0.06, 0.1, 0.012, 2)), dark);
      esc.position.copy(bl(sta(43.6), side * (hw(43.6) - 0.012), hz(1.3)));
      b.addStructure(esc, undefined, { occluder: false });
    }
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
    // Padded glareshield: the panel's upper outline extruded from the windshield base aft to the
    // brow (GLARE.browIn aft of the panel face); the bevel of the aft end rolls the brow edge.
    const bt = GLARE.roll; // bevel thickness (fore-aft)
    const bs = GLARE.roll * 0.7; // bevel size (outline growth)
    const depth = sta(WINDSHIELD.baseFs) - GLARE.browX - 2 * bt;
    const g = new THREE.ExtrudeGeometry(glareshieldShape(bs), { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: 4, curveSegments: 10 });
    g.translate(0, 0, -(depth + bt)); // aft face (after the bevel) at z = 0, extending forward
    const m = b.structureMesh(g, 'glareshield');
    m.position.copy(bl(GLARE.browX, 0, hz(PANEL.topH)));
    m.name = 'glareshield';
  }
  // Windshield defroster outlets at the windshield base and their sliding-valve knobs (POH Sec 7
  // "Cabin heating, ventilating and defrosting": "Two knobs control sliding valves in either
  // defroster outlet to permit regulation of defroster airflow"; Inadvertent Icing: "Pull cabin heat
  // control full out and open defroster outlets to obtain maximum windshield defroster airflow").
  // Outlet slots EST 7 in long at
  // y +/-0.33 m; knobs just aft of each outlet on the glareshield top (EST FS 14).
  {
    const slot = env.geometry.get('c172s.defrost_slots', () => {
      const parts: THREE.BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        const p = roundedBox(0.18, 0.004, 0.02, 0.0015, 1);
        const c = bl(sta(WINDSHIELD.baseFs + 0.6), side * 0.33, hz(GLARE.topH + 0.001));
        p.translate(c.x, c.y, c.z);
        parts.push(p);
      }
      const m = merge(parts);
      for (const x of parts) x.dispose();
      return m;
    });
    b.addStructure(new THREE.Mesh(slot, mats.custom('plastic', '#0b0b0c', 0.9)), undefined, { occluder: false });
  }
  for (const side of [-1, 1] as const) {
    const s0 = side < 0 ? 'left' : 'right';
    const dp = b.panel({ name: `c172s.defrost_${s0}`, center_m: [sta(14), side * 0.33, hz(GLARE.topH + 0.002)], facing: 'up', width: 0.04, height: 0.03, origin: 'center', invisible: true });
    dp.add(
      new PushPullKnob(env, {
        id: `c172s.defrost_${s0}`,
        label: `${side < 0 ? 'Left' : 'Right'} windshield DEFROSTER outlet valve (pull open; wheel = partial)`,
        var: side < 0 ? C172.defrostLeft : C172.defrostRight,
        valueIn: 0,
        valueOut: 1,
        style: 'plain',
        travel: 0.02,
        vernierStep: 0.1,
        clickToggles: true,
        material: 'knobGrey',
      }),
      0,
      0,
    );
  }
  // Rear baggage curtain / bulkhead (dark).
  b.structureMesh(quad([sta(108), 0.42, hz(FLOOR_H)], [sta(108), -0.42, hz(FLOOR_H)], [sta(108), -0.4, hz(1.8)], [sta(108), 0.4, hz(1.8)]), dark, undefined, undefined, false);

  // ---------------------------------------------------------------- seats (static)
  for (const side of [-1, 1]) b.seat('ga', [sta(SEATS.frontFs), side * SEATS.y, hz(FLOOR_H)]);
  for (const side of [-1, 1]) b.seat('ga', [sta(SEATS.rearFs + 6), side * 0.2, hz(FLOOR_H)]);

  // ---------------------------------------------------------------- overhead console (flood / dome lights, speaker)
  // The console follows the centre headliner (a straight lining from the windshield top to FS 110).
  const hl = (fs: number): number => roof(WINDSHIELD.topFs) + ((roof(110) - roof(WINDSHIELD.topFs)) * (fs - WINDSHIELD.topFs)) / (110 - WINDSHIELD.topFs);
  const ohFs = (OVERHEAD.fs0 + OVERHEAD.fs1) / 2;
  const ohLen = (OVERHEAD.fs1 - OVERHEAD.fs0) * IN;
  const ohSlopeDeg = (Math.atan2(hl(OVERHEAD.fs0) - hl(OVERHEAD.fs1), ohLen) * 180) / Math.PI;
  const ohDepth = 0.025;
  const oh = b.panel({
    name: 'c172s.overhead',
    center_m: [sta(ohFs), 0, hz(hl(ohFs) - ohDepth)],
    facing: 'down',
    tiltDeg: -ohSlopeDeg, // aft end lower, like the headliner
    width: OVERHEAD.width,
    height: ohLen,
    origin: 'center',
    material: headliner,
    thickness: ohDepth,
    radius: 0.03,
    screws: false,
  });
  /** Console-local v (m, + aft) of a fuselage station. */
  const ohV = (fs: number): number => (fs - ohFs) * IN;
  // POH Sec 7 "Interior lighting": each light has a push switch next to it (steam airplanes).
  const sw = (id: string, label: string, v: string, x: number, y: number, t: string): void => {
    oh.add(new PushButton(env, { id, label, var: v, mode: 'toggle', style: 'round', width: 0.011, capMaterial: 'plasticGrey', engraved: '', zone: null }), x, y);
    oh.label(t, x, y + 0.014, { height: 0.0022, zone: null, color: '#2a2a2a' });
  };
  sw('c172s.flood_left', 'FLOOD LIGHT left (push on/off)', C172.floodLeft, -0.05, ohV(OVERHEAD.floodFs + 2.2), 'FLOOD');
  sw('c172s.flood_right', 'FLOOD LIGHT right (push on/off)', C172.floodRight, 0.05, ohV(OVERHEAD.floodFs + 2.2), 'FLOOD');
  sw('c172s.dome', 'DOME / COURTESY LIGHTS (push on/off)', C172.domeCourtesy, 0.045, ohV(OVERHEAD.domeFs), 'DOME');
  // Front flood lights: rotatable eyeballs (EST 2 cd each) aimed at the panel.
  const lensMat = mats.custom('gloss', '#e8e4d8', 0.3);
  const floodHousing = mats.custom('plastic', '#9d9990', 0.7);
  for (const side of [-1, 1] as const) {
    const light = env.lighting.addFloodLight(
      side < 0 ? 'c172s.flood.l' : 'c172s.flood.r',
      'flood',
      [sta(OVERHEAD.floodFs), side * 0.05, hz(hl(OVERHEAD.floodFs) - ohDepth - 0.015)],
      [sta(PANEL.fs), side * 0.25, hz(PANEL.topH - 0.2)],
      b.root,
      2,
      55,
    );
    oh.add(
      new FloodEyeball(env, {
        id: `c172s.flood_aim_${side < 0 ? 'left' : 'right'}`,
        label: `${side < 0 ? 'Left' : 'Right'} front FLOOD LIGHT (drag to aim)`,
        light,
        lensMaterial: lensMat,
        housingMaterial: floodHousing,
      }),
      side * 0.05,
      ohV(OVERHEAD.floodFs),
    );
  }
  // Centre overhead speaker (POH Sec 7 "Microphone and headset installations": "The overhead
  // speaker is located in the center overhead console"): round perforated grille, EST 3.5 in.
  {
    const grille = new THREE.Mesh(env.geometry.get('c172s.oh_speaker', () => cylinderZ(0.045, 0.045, 0, 0.003, 36)), mats.custom('metal', '#5a5a58', 0.6));
    grille.userData.cockpitStatic = true;
    oh.addObject(grille, 0, ohV(OVERHEAD.speakerFs), { z: 0.0005 });
    const holes = env.geometry.get('c172s.oh_speaker_holes', () => {
      const parts: THREE.BufferGeometry[] = [];
      for (let r = 0.008; r <= 0.036; r += 0.007) {
        const n = Math.round((2 * Math.PI * r) / 0.006);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const h = cylinderZ(0.0012, 0.0012, 0, 0.0006, 6);
          h.translate(r * Math.cos(a), r * Math.sin(a), 0.003);
          parts.push(h);
        }
      }
      const m = merge(parts);
      for (const x of parts) x.dispose();
      return m;
    });
    const hm = new THREE.Mesh(holes, dark);
    hm.userData.cockpitStatic = true;
    oh.addObject(hm, 0, ohV(OVERHEAD.speakerFs), { z: 0.0005 });
  }
  // Rear dome light in the aft end of the console, its push switch beside it.
  {
    const lens = new THREE.Mesh(env.geometry.get('c172s.dome_lens', () => cylinderZ(0.03, 0.026, 0, 0.008, 28)), lensMat);
    lens.userData.cockpitStatic = true;
    oh.addObject(lens, -0.02, ohV(OVERHEAD.domeFs), { z: 0.0005 });
  }
  env.lighting.addDomeLight('c172s.dome', 'dome', [sta(OVERHEAD.domeFs), -0.02, hz(hl(OVERHEAD.domeFs) - ohDepth - 0.012)], b.root, 3);

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
    const hgt = 0.25; // hinge 1.72 m down to the sill (DOOR_WINDOW.h0)
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
    // Latch lever on the lower frame of the storm window (window sill strip, dark).
    const sill = new THREE.Mesh(env.geometry.get('c172s.storm_sill', () => roundedBox(0.012, 0.014, 0.3, 0.003, 1)), mats.get('plasticBlack'));
    sill.position.copy(bl(sta(56), side * (hw(56) - 0.008), hz(DOOR_WINDOW.h0 + 0.004)));
    b.addStructure(sill, undefined, { occluder: false });
    const wp = b.panel({
      name: `c172s.storm_latch_${left ? 'l' : 'r'}`,
      center_m: [sta(56), side * (hw(56) - 0.016), hz(DOOR_WINDOW.h0 + 0.018)],
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
  // Black compass case (VH-SPQ / N146TC photographs); the housing uses the cockpit's own plastic.
  const compassCase = mats.custom('plastic', '#0f0f10', 0.75);
  compassCase.side = THREE.DoubleSide;
  const compass = new MagneticCompass({ id: 'c172s.compass', vars: ctx.vars, lightVar: 'ac.light.glareshield', housingMaterial: compassCase });
  b.place(compass, { center_m: [sta(PANEL.fs - 4), 0, hz(GLARE.topH + 0.045)], facing: 'aft', tiltDeg: 8 });
  {
    const probe = new THREE.Mesh(env.geometry.get('c172s.oat_probe', () => cylinderZ(0.004, 0.003, 0, 0.05, 12)), mats.get('chrome'));
    probe.position.copy(bl(sta(34), -0.3, hz(1.9)));
    probe.rotation.set(-Math.PI / 2, 0, 0);
    b.addStructure(probe, undefined, { occluder: false });
  }
  // Sun visors hinged on the headliner along the windshield top edge (EST 12 x 5.5 in, y +/-0.25 m).
  const visorMat = mats.custom('plastic', '#3b3a36', 0.6);
  visorMat.side = THREE.DoubleSide;
  for (const side of [-1, 1] as const) {
    b.place(
      new SunVisor(env, {
        id: `c172s.visor_${side < 0 ? 'left' : 'right'}`,
        label: `${side < 0 ? 'Left' : 'Right'} SUN VISOR (click: down / up; drag: angle)`,
        var: side < 0 ? ST.visorLeft : ST.visorRight,
        width: 0.3,
        height: 0.14,
        material: visorMat,
      }),
      { center_m: [sta(WINDSHIELD.topFs + 0.8), side * 0.25, hz(hl(WINDSHIELD.topFs + 0.8) - 0.004)], facing: 'down' },
    );
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
  // Windshield fog / frost (C172LateLogic `ac.c172.ws_fog`: the glass below the cabin dew point fogs, the
  // defroster air clears it; POH Sec 3 inadvertent icing / Sec 7 defrosting): a translucent film just inside
  // the windshield, hidden while clear.
  const fogMat = new THREE.MeshBasicMaterial({ color: '#dde2e6', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const fogGeo = quad(
    [sta(WINDSHIELD.baseFs + 0.6), 0.46, hz(WINDSHIELD.baseH + 0.01)],
    [sta(WINDSHIELD.baseFs + 0.6), -0.46, hz(WINDSHIELD.baseH + 0.01)],
    [sta(WINDSHIELD.topFs + 0.6), -0.43, hz(WINDSHIELD.topH - 0.01)],
    [sta(WINDSHIELD.topFs + 0.6), 0.43, hz(WINDSHIELD.topH - 0.01)],
  );
  b.trackGeometry(fogGeo);
  const fog = b.addStructure(new THREE.Mesh(fogGeo, fogMat), undefined, { occluder: false, static: false });
  fog.name = 'windshield_fog';
  fog.userData.cockpitDynamic = true;
  fog.renderOrder = 5;
  fog.visible = false;
  // Carbon monoxide symptoms (no CO detector in the steam airplane): a dark shade round the pilot's eye whose
  // opacity follows ST.coImpair (EST visual cue for the headache / dimming of vision of CO poisoning).
  const shadeGeo = new THREE.SphereGeometry(0.22, 16, 10);
  b.trackGeometry(shadeGeo);
  const coShade = b.addStructure(
    new THREE.Mesh(shadeGeo, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.BackSide })),
    EYE,
    { occluder: false, static: false },
  );
  coShade.name = 'co_shade';
  coShade.userData.cockpitDynamic = true;
  coShade.renderOrder = 999;
  coShade.visible = false;
  // External power receptacle (POH Sec 7: on the left side of the cowl; ground crew item, EST position on the
  // cabin side forward of the door, as in the G1000 variant): toggles the GPU connection (ST.gpuRequest).
  {
    const gp = b.panel({ name: 'c172s.ext_power', center_m: [sta(20), -(hw(20) - 0.02), hz(0.95)], facing: 'left', width: 0.08, height: 0.06, invisible: true });
    gp.add(
      new PushButton(env, {
        id: 'c172s.ext_power',
        label: 'EXTERNAL POWER receptacle (ground crew: GPU connect / disconnect, engine stopped)',
        mode: 'toggle',
        var: ST.gpuRequest,
        style: 'mcp',
        width: 0.05,
        height: 0.035,
        capMaterial: 'paintWhite',
        engraved: 'EXT PWR 28V',
        engravedHeight: 0.004,
        zone: null,
      }),
      0,
      0,
    );
  }
  return { stormLeft: storm[0], stormRight: storm[1], fog, coShade };
}
