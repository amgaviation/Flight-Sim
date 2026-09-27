/**
 * Procedural exterior of the Cessna 172S Skyhawk SP (both variants), livery-neutral white
 * with a blue cheat line.
 *
 * Geometry in body axes (x forward, y right, z down, metres from the FDM datum = the basic
 * empty CG at fuselage station 38.1 in; x = sta(inches), see fdm.ts):
 *  - POH Fig 1-1 three-view: length 27 ft 2 in (8.28 m), height 8 ft 11 in (2.72 m), span
 *    36 ft 1 in with strobes (11.0 m), horizontal tail span 11 ft 4 in (3.45 m), 76 in
 *    propeller with 11.25 in ground clearance, wheelbase 65 in.
 *  - TCDS 3A12: MAC 58.8 in, LEMAC sta 25.9; control surface travel (ailerons 20 up / 15
 *    down, elevator 28 up / 23 down, elevator tab 22 up / 19 down, rudder 16 deg 10 min,
 *    flaps 0-30).
 *  - POH Sec 7: all-metal high wing with struts, integral tanks, single-slot flaps and
 *    Frise-type ailerons on a straight trailing edge; conventional swept fin with dorsal,
 *    ground-adjustable rudder tab, elevator trim tab on the right elevator; tubular
 *    spring-steel main gear and air/oil nose strut with wheel fairings; landing and taxi
 *    lights in the left wing leading edge, flashing beacon on the fin, strobe and nav lights
 *    on the wing tips, white nav light on top of the rudder, courtesy lights under the wings.
 * Planform (EST from the three-view and the 174 sq ft / 58.8 in MAC): constant 64 in chord
 * inboard of BL 100, outer panel tapering to a 44 in tip chord with the trailing edge straight,
 * dihedral 1 deg 44 min, 3 deg washout. Section shapes, window outlines, cowl lines and light
 * positions are EST from photographs.
 *
 * Animated from SimVars in `update(dt)`: propeller (eng1.rpm) with a blur disc at speed,
 * flaps, ailerons, elevators, trim tab, rudder, nosewheel steering, strut compression, wheel
 * spin, cabin doors and storm windows (ac.c172.door_* / window_*), and the exterior lights
 * (light.nav / beacon / strobe / landing / taxi / courtesy from the LightingSystem) with real
 * candela through the world's photometric scale.
 */
import * as THREE from 'three';
import { WORLD_VARS } from '../../world/worldVars';
import type { SimVars } from '../../core/SimVars';
import { ENG, GEAR, SURF } from '../../core/vars';
import { bl } from '../../cockpit/frame';
import { FuselageProfile, loftFuselage, loftWing, type WingSection } from '../_test/loft';
import { GROUND_Z, sta } from './fdm';
import { C172 } from './vars';

const D2R = Math.PI / 180;
const IN = 0.0254;
/** Body z of a height above the ground plane (m). */
const hz = (h: number): number => GROUND_Z - h;

// ============================================================================ planform data

/** Wing root chord line height above ground (m). EST: cabin roof ~1.98 m, wing on top. */
const WING_ROOT_H = 2.08;
const DIHEDRAL = (1 + 44 / 60) * D2R; // 172 wing dihedral 1 deg 44 min (Cessna 172 series data)
/** Straight trailing edge station (in) and root / tip chords (in). */
const TE_STA = 85.5;
const ROOT_CHORD = 64 * IN;
const TIP_CHORD = 44 * IN;
const BREAK_Y = 100 * IN; // end of the constant-chord inner panel (BL 100)
const TIP_Y = 5.36; // tip rib; the tip fairing and strobe reach 5.50 m (36 ft 1 in / 2)
const SEMI_SPAN = 5.5;

function wingSection(y: number, t: number, twistDeg: number): WingSection {
  const chord = y <= BREAK_Y ? ROOT_CHORD : ROOT_CHORD + ((TIP_CHORD - ROOT_CHORD) * (y - BREAK_Y)) / (TIP_Y - BREAK_Y);
  const xTe = sta(TE_STA);
  return { y, xLe: xTe + chord, chord, z: hz(WING_ROOT_H) - y * Math.tan(DIHEDRAL), t, twistDeg };
}
const WING: WingSection[] = [wingSection(0.5, 0.12, 1.5), wingSection(BREAK_Y, 0.12, 0.8), wingSection(TIP_Y, 0.12, -1.5)];

function wingAt(y: number): { xLe: number; chord: number; z: number } {
  const s = wingSection(Math.min(TIP_Y, Math.max(0.5, y)), 0.12, 0);
  return { xLe: s.xLe, chord: s.chord, z: s.z };
}

/** Horizontal tail: span 11 ft 4 in (POH), EST chords/stations; chord plane ~1.22 m above ground. */
const HT_Z = hz(1.22);
const HT_ROOT_LE = sta(206);
const HT_ROOT_CHORD = 1.12;
const HT_TIP_CHORD = 0.72;
const HT_SEMI = (136 * IN) / 2;
const HT_ELEV_FRAC = 0.62; // elevator hinge at 62 % chord (EST)
/** Vertical tail: fin root on the tail cone (~1.36 m), top of the rudder at 8 ft 11 in (POH). */
const VT_ROOT_H = 1.36;
const VT_TOP_H = 2.72;
const VT_ROOT_LE = sta(200);
const VT_ROOT_CHORD = 1.55;
const VT_TIP_CHORD = 0.78;
const VT_SWEEP = 38 * D2R; // EST leading-edge sweep
const VT_RUDDER_FRAC = 0.58;

// ============================================================================ fuselage profile

/** Outer skin stations: [sta in, top h (m above ground), bottom h, half-width (m)]. EST (see header). */
const FUS: [number, number, number, number][] = [
  [-43, 1.25, 1.25, 0.03], // spinner tip region (nose bowl behind the spinner starts at -38)
  [-38, 1.53, 0.93, 0.34],
  [-30, 1.58, 0.8, 0.46],
  [-15, 1.61, 0.68, 0.5],
  [0, 1.62, 0.64, 0.52], // firewall
  [12, 1.66, 0.62, 0.55], // windshield base
  [30, 1.88, 0.61, 0.56],
  [42, 2.02, 0.61, 0.56], // wing leading edge / windshield top (skin meets the wing root lower surface)
  [85, 2.02, 0.62, 0.56],
  [105, 1.93, 0.66, 0.54],
  [130, 1.72, 0.74, 0.47], // rear window (Omni-Vision) aft end
  [160, 1.55, 0.84, 0.37],
  [200, 1.44, 0.96, 0.24],
  [235, 1.38, 1.06, 0.14],
  [262, 1.34, 1.14, 0.05],
];

function profile(): FuselageProfile {
  return new FuselageProfile(
    FUS.map(([s, top, bot, ry]) => {
      const zt = hz(top);
      const zb = hz(bot);
      return { x: sta(s), cz: (zt + zb) / 2, rz: (zb - zt) / 2, ry };
    }),
  );
}

// ============================================================================ builder

interface Movable {
  obj: THREE.Object3D;
  axis: THREE.Vector3;
  base: THREE.Quaternion;
}

interface Lamp {
  m: THREE.MeshBasicMaterial;
  halo: THREE.SpriteMaterial;
  color: THREE.Color;
}

export interface C172ExteriorOptions {
  /** Cheat-line colour (default Cessna-style dark blue). */
  stripe?: number;
  /** LED lamps (G1000 NXi) vs incandescent/halogen (steam). Changes landing-light colour and intensity. */
  ledLights?: boolean;
}

export interface C172Exterior {
  root: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

export function createC172Exterior(vars: SimVars, opts: C172ExteriorOptions = {}): C172Exterior {
  const root = new THREE.Group();
  root.name = 'exterior:c172s';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const std = (color: number, roughness: number, metalness: number, side: THREE.Side = THREE.FrontSide) => track(new THREE.MeshStandardMaterial({ color, roughness, metalness, side }));
  const paint = std(0xf4f5f6, 0.32, 0.05, THREE.DoubleSide);
  const stripe = std(opts.stripe ?? 0x1d3a78, 0.35, 0.1, THREE.DoubleSide);
  const glass = std(0x101820, 0.05, 0.6, THREE.DoubleSide);
  const dark = std(0x202224, 0.6, 0.3, THREE.DoubleSide);
  const tyre = std(0x141414, 0.92, 0);
  const metal = std(0xb8bcc2, 0.3, 0.85);
  const propMat = std(0x2b2d30, 0.5, 0.4, THREE.DoubleSide);
  const tipMat = std(0xf0d020, 0.4, 0.1, THREE.DoubleSide); // yellow/white prop tips (McCauley standard)
  const discMat = track(new THREE.MeshBasicMaterial({ color: 0x33363a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string, parent: THREE.Object3D = root): THREE.Mesh => {
    track(g);
    const me = new THREE.Mesh(g, m);
    me.name = name;
    me.castShadow = true;
    me.receiveShadow = true;
    parent.add(me);
    return me;
  };
  /** A hinged group: pivot at body p0, axis p0 -> p1; the geometry stays in aircraft-local coordinates. */
  const hinged = (g: THREE.BufferGeometry, m: THREE.Material, name: string, p0: [number, number, number], p1: [number, number, number], parent: THREE.Object3D): Movable => {
    const pivot = new THREE.Group();
    pivot.name = `${name}_hinge`;
    const a = bl(...p0);
    pivot.position.copy(a);
    parent.add(pivot);
    const me = mesh(g, m, name, pivot);
    me.position.copy(a).multiplyScalar(-1);
    return { obj: pivot, axis: bl(...p1).sub(a).normalize(), base: pivot.quaternion.clone() };
  };

  const P = profile();
  const TWO_PI = 2 * Math.PI;

  // ---------------------------------------------------------------- fuselage (cabin + tail cone)
  const body = new THREE.Group();
  body.name = 'fuselage';
  root.add(body);
  mesh(loftFuselage(P, sta(262), sta(0), 0, TWO_PI, 90, 40), paint, 'fuselage_skin', body);
  // Cheat line: a slightly proud band on both sides from the cowl to the tail (EST height 0.9-1.0 m).
  for (const side of [1, -1]) {
    const t0 = side > 0 ? 1.42 : -1.72;
    const t1 = side > 0 ? 1.72 : -1.42;
    mesh(loftFuselage(P, sta(255), sta(-30), Math.min(t0, t1), Math.max(t0, t1), 60, 3, { inset: -0.004 }), stripe, side > 0 ? 'stripe_r' : 'stripe_l', body);
  }
  // Windows (dark glass laid on the skin): windshield, door windows, rear side windows, rear window.
  const winStrip = (s0: number, s1: number, th0: number, th1: number, name: string, parent: THREE.Object3D) =>
    // Tessellated like the skin (~2 in per segment) and 1 cm proud so the curved skin never pokes through.
    mesh(loftFuselage(P, sta(s1), sta(s0), th0, th1, Math.max(8, Math.round((s1 - s0) / 2)), 16, { inset: -0.01 }), glass, name, parent);
  const cockpitGlass = new THREE.Group();
  cockpitGlass.name = 'cockpit_glass';
  root.add(cockpitGlass);
  winStrip(13, 42, -0.95, 0.95, 'windshield', cockpitGlass);
  winStrip(58, 96, 0.55, 1.2, 'rear_window_r', body);
  winStrip(58, 96, -1.2, -0.55, 'rear_window_l', body);
  winStrip(100, 128, -0.45, 0.45, 'rear_omni_window', body);

  // ---------------------------------------------------------------- cowling, nose and propeller
  const nose = new THREE.Group();
  nose.name = 'nose';
  nose.userData.visibleFromCockpit = true;
  root.add(nose);
  mesh(loftFuselage(P, sta(0), sta(-38), 0, TWO_PI, 24, 36), paint, 'cowling', nose);
  // Cooling air inlets (two openings in the nose bowl, POH Sec 7) and the air-filter intake below.
  for (const y of [-0.2, 0.2]) {
    const inlet = mesh(track(new THREE.CircleGeometry(0.1, 16)), dark, 'cooling_inlet', nose);
    inlet.position.copy(bl(sta(-38.6), y, hz(1.32)));
    inlet.rotation.y = 0;
  }
  const intake = mesh(track(new THREE.PlaneGeometry(0.18, 0.1)), dark, 'induction_intake', nose);
  intake.position.copy(bl(sta(-35), 0, hz(0.86)));
  intake.rotation.x = 0.4;
  // Exhaust stack under the cowl (right side) and the cowl-flap-less outlet.
  const exhaust = mesh(track(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 10)), metal, 'exhaust', nose);
  exhaust.position.copy(bl(sta(-5), 0.22, hz(0.68)));
  exhaust.rotation.x = Math.PI / 2 - 0.3;

  const thrustZ = hz(11.25 * IN + 38 * IN);
  const propX = sta(-38.2);
  const prop = new THREE.Group();
  prop.name = 'propeller';
  prop.position.copy(bl(propX, 0, thrustZ));
  nose.add(prop);
  // Spinner (EST 13 in diameter).
  const spinnerG = track(new THREE.ConeGeometry(0.165, 0.34, 24, 1, false));
  const spinner = mesh(spinnerG, paint, 'spinner', prop);
  spinner.rotation.x = -Math.PI / 2; // cone axis +y -> forward (-z local)
  spinner.position.z = -0.13;
  // Two blades, 76 in diameter (POH), McCauley 1A170E/JHA7660; EST planform ~6 in max chord.
  const bladeShape = new THREE.Shape();
  const R = 38 * IN;
  bladeShape.moveTo(0.05, -0.05);
  bladeShape.bezierCurveTo(0.25 * R, -0.075, 0.7 * R, -0.07, 0.97 * R, -0.035);
  bladeShape.lineTo(R, 0);
  bladeShape.lineTo(0.97 * R, 0.04);
  bladeShape.bezierCurveTo(0.7 * R, 0.07, 0.25 * R, 0.07, 0.05, 0.05);
  bladeShape.lineTo(0.05, -0.05);
  const bladeG = track(new THREE.ShapeGeometry(bladeShape, 16));
  const blades = new THREE.Group();
  blades.name = 'blades';
  prop.add(blades);
  for (const k of [0, 1]) {
    const b = mesh(bladeG, propMat, `blade${k}`, blades);
    b.rotation.z = k * Math.PI;
    b.rotation.x = 0; // blade in the prop disc plane (x-y local)
    const tip = mesh(track(new THREE.PlaneGeometry(0.1, 0.07)), tipMat, `blade_tip${k}`, b);
    tip.position.set(0.95 * R, 0, 0.001);
    // Blade pitch twist (visual): ~18 deg at 3/4 radius.
    b.rotateOnAxis(new THREE.Vector3(1, 0, 0), (k === 0 ? 1 : -1) * 18 * D2R);
  }
  const disc = mesh(track(new THREE.CircleGeometry(R, 40)), discMat, 'prop_disc', prop);
  disc.castShadow = false;
  disc.receiveShadow = false;

  // ---------------------------------------------------------------- wings, struts, flaps, ailerons
  const wings = new THREE.Group();
  wings.name = 'wings';
  wings.userData.visibleFromCockpit = true;
  root.add(wings);
  const FLAP_Y0 = 0.58;
  const FLAP_Y1 = 2.95;
  const AIL_Y0 = 2.97;
  const AIL_Y1 = 5.2;
  const FLAP_FRAC = 0.7; // flap leading edge at 70 % chord (single-slot flap, EST)
  const AIL_FRAC = 0.76;
  const mov: Record<string, Movable[]> = { flapR: [], flapL: [], ailR: [], ailL: [], elevR: [], elevL: [], tab: [], rudder: [] };
  /** Wing slice between two spanwise stations for a chordwise range (sections interpolated from WING). */
  const slice = (y0: number, y1: number, c0: number, c1: number, mirror: boolean): THREE.BufferGeometry => {
    const secs = [y0, BREAK_Y > y0 && BREAK_Y < y1 ? BREAK_Y : null, y1]
      .filter((y): y is number => y !== null)
      .map((y) => {
        const a = wingAt(y);
        const tw = y <= BREAK_Y ? 1.5 - (0.7 * (y - 0.5)) / (BREAK_Y - 0.5) : 0.8 - (2.3 * (y - BREAK_Y)) / (TIP_Y - BREAK_Y);
        return { y, xLe: a.xLe, chord: a.chord, z: a.z, t: 0.12, twistDeg: tw };
      });
    return loftWing(secs, { mirror, chordRange: [c0, c1] });
  };
  for (const mirror of [false, true]) {
    const s = mirror ? -1 : 1;
    // Fixed wing: full span leading part, plus the trailing edge between the movables (fuselage gap and tip).
    mesh(loftWing(WING, { mirror, chordRange: [0, Math.min(FLAP_FRAC, AIL_FRAC)] }), paint, mirror ? 'wing_l' : 'wing_r', wings);
    mesh(slice(0.5, FLAP_Y0, FLAP_FRAC, 1, mirror), paint, 'wing_root_te', wings);
    mesh(slice(FLAP_Y1, AIL_Y0, FLAP_FRAC, 1, mirror), paint, 'wing_gap_te', wings);
    mesh(slice(AIL_Y1, TIP_Y, AIL_FRAC, 1, mirror), paint, 'wing_tip_te', wings);
    mesh(slice(AIL_Y0, AIL_Y1, FLAP_FRAC, AIL_FRAC, mirror), paint, 'wing_ail_fixed', wings);
    // Wing tip fairing (drooped, with the strobe/nav light).
    const tip = wingAt(TIP_Y);
    const tipCap = mesh(track(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI)), paint, 'wingtip', wings);
    tipCap.scale.set(0.14, 0.09, tip.chord / 2);
    tipCap.position.copy(bl(tip.xLe - tip.chord / 2, s * TIP_Y, tip.z));
    tipCap.rotation.y = mirror ? Math.PI : 0;
    // Flap (hinge line along the flap leading edge, EST) and aileron (hinge at its leading edge).
    const hingePt = (y: number, frac: number): [number, number, number] => {
      const a = wingAt(y);
      return [a.xLe - frac * a.chord, s * y, a.z + 0.02];
    };
    const flap = hinged(slice(FLAP_Y0, FLAP_Y1, FLAP_FRAC, 1, mirror), paint, mirror ? 'flap_l' : 'flap_r', hingePt(FLAP_Y0, FLAP_FRAC), hingePt(FLAP_Y1, FLAP_FRAC), wings);
    (mirror ? mov.flapL : mov.flapR).push(flap);
    const ail = hinged(slice(AIL_Y0, AIL_Y1, AIL_FRAC, 1, mirror), paint, mirror ? 'aileron_l' : 'aileron_r', hingePt(AIL_Y0, AIL_FRAC), hingePt(AIL_Y1, AIL_FRAC), wings);
    (mirror ? mov.ailL : mov.ailR).push(ail);
    // Lift strut: fuselage lower door-post fitting (sta ~25, POH Sec 7) to the wing front spar at BL ~100.
    const wa = wingAt(BREAK_Y + 0.05);
    const p0 = bl(sta(25), s * 0.55, hz(0.72));
    const p1 = bl(wa.xLe - 0.3 * wa.chord, s * (BREAK_Y + 0.05), wa.z + 0.09);
    const len = p0.distanceTo(p1);
    const strutG = track(new THREE.CylinderGeometry(0.035, 0.035, len, 10));
    strutG.scale(1, 1, 2.2); // streamlined (elliptical) section
    const strut = mesh(strutG, paint, mirror ? 'strut_l' : 'strut_r', wings);
    strut.position.copy(p0).add(p1).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
    // Fuel filler cap on the upper wing surface (sta ~48, BL ~ 60 in).
    const cap = mesh(track(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 12)), metal, 'fuel_cap', wings);
    const fc = wingAt(1.55);
    cap.position.copy(bl(fc.xLe - 0.35 * fc.chord, s * 1.55, fc.z - 0.1));
  }
  // Stall warning inlet (left wing leading edge, POH Sec 7): small dark slot.
  const swi = wingAt(1.3);
  const stallInlet = mesh(track(new THREE.PlaneGeometry(0.06, 0.02)), dark, 'stall_warning_inlet', wings);
  stallInlet.position.copy(bl(swi.xLe + 0.005, -1.3, swi.z));
  // Pitot tube under the left wing (POH Sec 7).
  const pw = wingAt(2.1);
  const pitot = mesh(track(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 8)), metal, 'pitot_tube', wings);
  pitot.position.copy(bl(pw.xLe + 0.05, -2.1, pw.z + 0.12));
  pitot.rotation.x = Math.PI / 2;

  // ---------------------------------------------------------------- empennage
  const tail = new THREE.Group();
  tail.name = 'tail';
  tail.userData.visibleFromCockpit = true;
  root.add(tail);
  const htSec = (y: number): WingSection => {
    const f = y / HT_SEMI;
    const chord = HT_ROOT_CHORD + (HT_TIP_CHORD - HT_ROOT_CHORD) * f;
    return { y, xLe: HT_ROOT_LE - 0.1 * f, chord, z: HT_Z, t: 0.09 };
  };
  const HT: WingSection[] = [htSec(0.12), htSec(HT_SEMI)];
  for (const mirror of [false, true]) {
    const s = mirror ? -1 : 1;
    mesh(loftWing(HT, { mirror, chordRange: [0, HT_ELEV_FRAC] }), paint, mirror ? 'stab_l' : 'stab_r', tail);
    const hp = (y: number): [number, number, number] => {
      const sc = htSec(y);
      return [sc.xLe - HT_ELEV_FRAC * sc.chord, s * y, HT_Z];
    };
    const elev = hinged(loftWing(HT, { mirror, chordRange: [HT_ELEV_FRAC, 1] }), paint, mirror ? 'elevator_l' : 'elevator_r', hp(0.12), hp(HT_SEMI), tail);
    (mirror ? mov.elevL : mov.elevR).push(elev);
    if (!mirror) {
      // Elevator trim tab on the right elevator trailing edge (POH Sec 7), inboard, EST 0.6 m span.
      const tabSecs: WingSection[] = [0.3, 0.9].map((y) => {
        const sc = htSec(y);
        return { y, xLe: sc.xLe, chord: sc.chord, z: HT_Z, t: 0.09 };
      });
      const tp = (y: number): [number, number, number] => {
        const sc = htSec(y);
        return [sc.xLe - 0.9 * sc.chord, y, HT_Z];
      };
      const tabG = loftWing(tabSecs, { chordRange: [0.9, 1] });
      // The tab rides on the right elevator: parent it to the elevator pivot group.
      const tab = hinged(tabG, dark, 'elevator_trim_tab', tp(0.3), tp(0.9), elev.obj);
      // Geometry is in aircraft-local coordinates; compensate for the elevator pivot offset.
      tab.obj.position.sub(elev.obj.position);
      mov.tab.push(tab);
    }
  }
  // Vertical fin + dorsal (vertical loft: WingSection.y = height above the root, z = root chord height).
  const VT_H = VT_TOP_H - VT_ROOT_H;
  const vtSec = (hAbove: number): WingSection => {
    const f = hAbove / VT_H;
    const chord = VT_ROOT_CHORD + (VT_TIP_CHORD - VT_ROOT_CHORD) * f;
    return { y: hAbove, xLe: VT_ROOT_LE - hAbove * Math.tan(VT_SWEEP), chord, z: hz(VT_ROOT_H), t: 0.1 };
  };
  const VT: WingSection[] = [vtSec(0), vtSec(VT_H * 0.97)];
  mesh(loftWing(VT, { vertical: true, chordRange: [0, VT_RUDDER_FRAC] }), paint, 'fin', tail);
  const rp = (h: number): [number, number, number] => {
    const sc = vtSec(h);
    return [sc.xLe - VT_RUDDER_FRAC * sc.chord, 0, hz(VT_ROOT_H) - h];
  };
  const rudder = hinged(loftWing(VT, { vertical: true, chordRange: [VT_RUDDER_FRAC, 1] }), paint, 'rudder', rp(0), rp(VT_H * 0.97), tail);
  mov.rudder.push(rudder);
  // Dorsal fin: low swept fairing ahead of the fin (EST).
  const dorsal = loftWing(
    [
      { y: 0, xLe: sta(150), chord: sta(150) - VT_ROOT_LE + 0.3, z: hz(VT_ROOT_H + 0.02), t: 0.05 },
      { y: 0.3, xLe: VT_ROOT_LE - 0.3 * Math.tan(VT_SWEEP), chord: 0.4, z: hz(VT_ROOT_H + 0.02), t: 0.08 },
    ],
    { vertical: true },
  );
  mesh(dorsal, paint, 'dorsal_fin', tail);
  // Rudder ground-adjustable tab at the base of the trailing edge (POH Sec 7): fixed small plate.
  const rtab = mesh(track(new THREE.BoxGeometry(0.004, 0.18, 0.1)), paint, 'rudder_tab', rudder.obj);
  const rtBase = vtSec(0.15);
  rtab.position.copy(bl(rtBase.xLe - rtBase.chord - 0.04, 0, hz(VT_ROOT_H + 0.15))).sub(rudder.obj.position);

  // ---------------------------------------------------------------- landing gear
  const gearGrp = new THREE.Group();
  gearGrp.name = 'gear';
  gearGrp.userData.visibleFromCockpit = false;
  root.add(gearGrp);
  interface Leg {
    index: number;
    strut: THREE.Group;
    steer: THREE.Group;
    wheel: THREE.Object3D;
    radius: number;
    travel: number;
  }
  const legs: Leg[] = [];
  /** Teardrop wheel fairing (three-local: x lateral half-width, y half-height, z half-length, -z forward). */
  const fairingGeometry = (hw: number, hh: number, hl: number): THREE.BufferGeometry => {
    const g = track(new THREE.SphereGeometry(1, 24, 14));
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const taper = z > 0 ? 1 - 0.6 * z : 1; // aft half tapers to a rounded tail
      pos.setXYZ(i, pos.getX(i) * hw * taper, pos.getY(i) * hh * (z > 0 ? 1 - 0.35 * z : 1), z * hl);
    }
    g.computeVertexNormals();
    return g;
  };
  const wheel = (radius: number, width: number, parent: THREE.Object3D): THREE.Object3D => {
    const w = new THREE.Group();
    const tg = track(new THREE.TorusGeometry(radius * 0.72, radius * 0.28, 10, 24));
    tg.rotateY(Math.PI / 2);
    tg.scale(width / (radius * 0.56), 1, 1);
    mesh(tg, tyre, 'tyre', w);
    const hub = mesh(track(new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width * 0.9, 16)), metal, 'hub', w);
    hub.rotation.z = Math.PI / 2;
    parent.add(w);
    return w;
  };
  // Mains: tubular spring-steel legs (POH Sec 7), 6.00-6 tyres (EST 17.5 in), wheel fairings.
  for (const [idx, y] of [
    [1, -1.27],
    [2, 1.27],
  ] as const) {
    const strut = new THREE.Group();
    strut.name = `main_gear_${idx}`;
    gearGrp.add(strut);
    const steer = new THREE.Group();
    strut.add(steer);
    const axle = bl(sta(57.6), y, GROUND_Z - 0.22);
    const hip = bl(sta(57.6) + 0.05, Math.sign(y) * 0.42, hz(0.66));
    const legLen = hip.distanceTo(axle);
    const legG = track(new THREE.CylinderGeometry(0.025, 0.035, legLen, 10));
    const leg = mesh(legG, metal, 'spring_leg', gearGrp);
    leg.position.copy(hip).add(axle).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axle.clone().sub(hip).normalize());
    const w = wheel(0.222, 0.15, steer);
    w.position.copy(axle);
    // Speed fairing (EST ~38 in long, 16 in tall, 9 in wide): blunt nose, tapered tail, the tyre
    // showing ~1.5 in below it.
    const fairing = mesh(fairingGeometry(0.115, 0.2, 0.5), paint, 'wheel_fairing', steer);
    fairing.position.copy(axle).add(new THREE.Vector3(0, 0.03, 0.1));
    legs.push({ index: idx, strut, steer, wheel: w, radius: 0.222, travel: 0.15 });
  }
  // Nose: air/oil strut from the lower cowl, 5.00-5 tyre (EST 15 in), fairing; steerable.
  {
    const strut = new THREE.Group();
    strut.name = 'nose_gear';
    gearGrp.add(strut);
    const steer = new THREE.Group();
    const axleB: [number, number, number] = [sta(-7.4), 0, GROUND_Z - 0.19];
    steer.position.copy(bl(...axleB));
    strut.add(steer);
    const top = bl(sta(-8.5), 0, hz(0.75));
    const oleo = mesh(track(new THREE.CylinderGeometry(0.03, 0.03, top.distanceTo(bl(...axleB)) + 0.05, 10)), metal, 'nose_oleo', strut);
    oleo.position.copy(top).add(bl(...axleB)).multiplyScalar(0.5);
    const w = wheel(0.19, 0.13, steer);
    const fairing = mesh(fairingGeometry(0.1, 0.18, 0.42), paint, 'nose_fairing', steer);
    fairing.position.set(0, 0.03, 0.08);
    legs.push({ index: 0, strut, steer, wheel: w, radius: 0.19, travel: 0.18 });
  }

  // ---------------------------------------------------------------- cabin doors and storm windows
  const doorGrp = new THREE.Group();
  doorGrp.name = 'doors';
  root.add(doorGrp);
  const doors: { pivot: THREE.Group; win: THREE.Group; side: number; doorVar: string; winVar: string; pos: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    const hingeB: [number, number, number] = [sta(14), side * 0.565, hz(1.3)];
    pivot.position.copy(bl(...hingeB));
    doorGrp.add(pivot);
    // Door panel: sta 14-48, sill 0.72 m to the roof (EST).
    const t0 = side > 0 ? 0.42 : -1.95;
    const t1 = side > 0 ? 1.95 : -0.42;
    const g = loftFuselage(P, sta(48), sta(15), Math.min(t0, t1), Math.max(t0, t1), 6, 8, { inset: -0.012 });
    const d = mesh(g, paint, side < 0 ? 'door_l' : 'door_r', pivot);
    d.position.copy(bl(...hingeB)).multiplyScalar(-1);
    // Storm window in the door (hinged at its top edge, swings out).
    const win = new THREE.Group();
    const wHinge: [number, number, number] = [sta(31), side * 0.57, hz(1.82)];
    win.position.copy(bl(...wHinge)).sub(pivot.position);
    pivot.add(win);
    const wg = loftFuselage(P, sta(44), sta(20), side > 0 ? 0.55 : -1.2, side > 0 ? 1.2 : -0.55, 6, 5, { inset: -0.018 });
    const wm = mesh(wg, glass, side < 0 ? 'door_window_l' : 'door_window_r', win);
    wm.position.copy(bl(...wHinge)).multiplyScalar(-1);
    doors.push({ pivot, win, side, doorVar: side < 0 ? C172.doorLeft : C172.doorRight, winVar: side < 0 ? C172.windowLeft : C172.windowRight, pos: 0 });
  }

  // ---------------------------------------------------------------- lights
  const glowTex = (() => {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (!g) return null;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return track(new THREE.CanvasTexture(c));
  })();
  /** `origin`: the parent's aircraft-local position when the parent is a hinge pivot (lamp on a moving surface). */
  const lamp = (color: number, pos: [number, number, number], size: number, parent: THREE.Object3D, halo = 14, origin?: THREE.Vector3): Lamp => {
    const m = track(new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    const me = mesh(track(new THREE.SphereGeometry(size, 10, 8)), m, 'lamp', parent);
    me.castShadow = false;
    me.position.copy(bl(...pos));
    if (origin) me.position.sub(origin);
    const hm = track(new THREE.SpriteMaterial({ color, map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    const sp = new THREE.Sprite(hm);
    sp.scale.setScalar(size * halo);
    sp.position.copy(me.position);
    parent.add(sp);
    return { m, halo: hm, color: new THREE.Color(color) };
  };
  const tipW = wingAt(TIP_Y);
  const navR = lamp(0x10ff50, [tipW.xLe - 0.1, SEMI_SPAN, tipW.z], 0.028, wings);
  const navL = lamp(0xff1a10, [tipW.xLe - 0.1, -SEMI_SPAN, tipW.z], 0.028, wings);
  const strobeR = lamp(0xf4f7ff, [tipW.xLe - 0.22, SEMI_SPAN + 0.01, tipW.z], 0.024, wings, 22);
  const strobeL = lamp(0xf4f7ff, [tipW.xLe - 0.22, -SEMI_SPAN - 0.01, tipW.z], 0.024, wings, 22);
  const rudTop = vtSec(VT_H * 0.97);
  // The white tail position lamp sits on the rudder trailing edge and swings with it.
  const navTail = lamp(0xffffff, [rudTop.xLe - rudTop.chord - 0.02, 0, hz(VT_TOP_H) + 0.05], 0.022, rudder.obj, 14, rudder.obj.position);
  const beacon = lamp(0xff2200, [vtSec(VT_H * 0.97).xLe - 0.2, 0, hz(VT_TOP_H) - 0.02], 0.03, tail, 20);
  // Landing and taxi lights in the left wing leading edge (POH Sec 7), EST at BL 75/85 in.
  const ll = wingAt(1.9);
  const landLamp = lamp(0xfff2d8, [ll.xLe + 0.005, -1.9, ll.z], 0.045, wings, 10);
  const tl = wingAt(2.15);
  const taxiLamp = lamp(0xfff2d8, [tl.xLe + 0.005, -2.15, tl.z], 0.04, wings, 10);
  const courtesyL = lamp(0xfff0d0, [sta(40), -0.85, hz(WING_ROOT_H - 0.1)], 0.02, wings, 6);
  const courtesyR = lamp(0xfff0d0, [sta(40), 0.85, hz(WING_ROOT_H - 0.1)], 0.02, wings, 6);

  const lightsGroup = new THREE.Group();
  lightsGroup.name = 'lights';
  lightsGroup.userData.visibleFromCockpit = true;
  root.add(lightsGroup);
  const spot = (color: number, pos: [number, number, number], target: [number, number, number], angleDeg: number, name: string): THREE.SpotLight => {
    const s = new THREE.SpotLight(color, 0, 700, angleDeg * D2R, 0.45, 2);
    s.name = name;
    s.position.copy(bl(...pos));
    s.target.position.copy(bl(...target));
    lightsGroup.add(s, s.target);
    return s;
  };
  const landSpot = spot(0xfff0dc, [ll.xLe + 0.02, -1.9, ll.z], [80, -1.9, 4.5], 10, 'landing');
  const taxiSpot = spot(0xfff0dc, [tl.xLe + 0.02, -2.15, tl.z], [30, -2.5, 1.9], 26, 'taxi');

  for (const c of root.children) if (c.userData.visibleFromCockpit === undefined) c.userData.visibleFromCockpit = false;

  // ---------------------------------------------------------------- animation
  const tmpQ = new THREE.Quaternion();
  const setHinge = (list: Movable[], angle: number) => {
    for (const m of list) m.obj.quaternion.copy(m.base).multiply(tmpQ.setFromAxisAngle(m.axis, angle));
  };
  const setLamp = (l: Lamp, level: number) => {
    const x = Math.max(0, Math.min(1, level));
    l.m.color.copy(l.color).multiplyScalar(0.06 + 0.94 * x);
    l.halo.opacity = x;
  };
  const compVar = [0, 1, 2].map((i) => GEAR.compression(i));
  const speedVar = [0, 1, 2].map((i) => GEAR.wheelSpeedKt(i));
  const wheelAngle = [0, 0, 0];
  let propAngle = 0;
  const led = opts.ledLights ?? false;

  function update(dt: number): void {
    const v = vars;
    // Propeller: rpm -> rad/s; blur disc fades in above ~500 rpm.
    const rpm = v.get(ENG.rpm(1));
    propAngle = (propAngle + ((rpm * 2 * Math.PI) / 60) * dt) % (2 * Math.PI);
    blades.rotation.z = -propAngle; // clockwise seen from the cockpit
    const blur = Math.max(0, Math.min(1, (rpm - 500) / 900));
    discMat.opacity = 0.35 * blur;
    for (const b of blades.children) b.visible = blur < 0.98 || dt === 0;

    // Flaps (single-slot, 0-30 deg), trailing edge down = positive.
    const flaps = v.get(SURF.flapsDeg) * D2R;
    setHinge(mov.flapR, flaps);
    setHinge(mov.flapL, -flaps);
    // Ailerons (TCDS: 20 up / 15 down); + aileron = right roll (right aileron up).
    const ail = v.get(SURF.aileron);
    const ailDeg = (d: number) => (d >= 0 ? d * 20 : d * 15) * D2R;
    setHinge(mov.ailR, -ailDeg(ail));
    setHinge(mov.ailL, ailDeg(-ail));
    // Elevator (TCDS 28 up / 23 down); + elevator = nose up = trailing edge up.
    const e = v.get(SURF.elevator);
    const eDeg = (e >= 0 ? e * 28 : e * 23) * D2R;
    setHinge(mov.elevR, -eDeg);
    setHinge(mov.elevL, eDeg);
    // Trim tab (TCDS 22 up / 19 down): nose-up trim = tab down.
    const pt = v.get(SURF.pitchTrim);
    setHinge(mov.tab, (pt >= 0 ? pt * 19 : pt * 22) * D2R);
    // Rudder 16 deg 10 min each way; + rudder = yaw right = trailing edge right.
    setHinge(mov.rudder, -v.get(SURF.rudder) * (16 + 10 / 60) * D2R);

    for (const leg of legs) {
      leg.strut.position.y = v.get(compVar[leg.index]) * leg.travel;
      if (leg.index === 0) leg.steer.rotation.y = -v.get(GEAR.steerDeg) * D2R;
      const w = (v.get(speedVar[leg.index]) * 0.514444) / leg.radius;
      wheelAngle[leg.index] = (wheelAngle[leg.index] - w * dt) % (2 * Math.PI);
      leg.wheel.rotation.x = wheelAngle[leg.index];
    }
    for (const d of doors) {
      // Door OPEN (DOOR.open = 0) swings ~65 deg outboard about the forward hinge (EST), 1.5 s.
      const target = v.get(d.doorVar, 2) < 0.5 ? 1 : 0;
      d.pos += Math.max(-dt / 1.5, Math.min(dt / 1.5, target - d.pos));
      d.pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.side * d.pos * 65 * D2R);
      // Storm window swings out about its top hinge, up to ~35 deg (spring-loaded retaining arm).
      d.win.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -d.side * Math.max(0, Math.min(1, v.get(d.winVar))) * 35 * D2R);
    }

    const nav = v.get('light.nav');
    setLamp(navR, nav);
    setLamp(navL, nav);
    setLamp(navTail, nav);
    const st = v.get('light.strobe');
    setLamp(strobeR, st);
    setLamp(strobeL, st);
    setLamp(beacon, v.get('light.beacon'));
    const land = v.get('light.landing');
    const taxi = v.get('light.taxi');
    setLamp(landLamp, land);
    setLamp(taxiLamp, taxi);
    const ct = v.get('light.courtesy');
    setLamp(courtesyL, ct);
    setLamp(courtesyR, ct);
    // EST candela: halogen landing ~150,000 cd / taxi ~40,000 cd; LED (NXi) ~250,000 / ~60,000 cd.
    const k = v.get(WORLD_VARS.renderUnitsPerLux, 3e-5);
    landSpot.intensity = land * (led ? 250_000 : 150_000) * k;
    taxiSpot.intensity = taxi * (led ? 60_000 : 40_000) * k;
  }

  update(0);
  return {
    root,
    update,
    dispose(): void {
      for (const d of disposables) d.dispose();
      root.removeFromParent();
    },
  };
}
