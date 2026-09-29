/**
 * Global 6000 main instrument panel, Global Vision layout (photo N835GL,
 * crops c_centre / c_lwing / c_rwing; EB190582):
 *
 *  - centre band, left to right: AFD 1 (pilot PFD) | left centre column
 *    (IESI at the top, level with the PFD top; TAWS panel G/S, FLAPS,
 *    TERRAIN; AIRSPEED LIMITS placard; CREW LIFE VEST UNDER SEAT) | AFD 2 |
 *    GEAR AND BRAKES column (NOSE STEER, HORN, BTMS OVHT WARN RESET; LDG GEAR
 *    handle with the UP arrow placard; DN LCK RELEASE; AUTOBRAKE; STATIC
 *    GROUND OPERATION placard) | AFD 4 (copilot PFD). The AFD bezels almost
 *    touch the ~90 mm columns (AFD centres -/+0.43 m).
 *  - outboard wings, angled toward each pilot: STALL PUSHER ON / OFF plate
 *    (outboard top), chrome gasper (inboard top, beside the PFD), EMS CDU
 *    below (mounted by the side builder, cockpit/side/index.ts, through
 *    `c.wings`).
 *  - AFD 3 on the steep forward face of the centre pedestal, between the knee
 *    panels (layout.ts PED_FACE).
 *
 * The Vision GEAR AND BRAKES panel has no three-green gear position lights:
 * gear position is on the EICAS (Fusion synoptic / gear indication) and the
 * handle carries its own red in-transit / disagree light (CK.gearRed).
 */
import * as THREE from 'three';
import { GearHandle, PushButton, RotaryKnob, SelectorKnob, ToggleSwitch } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { addIesi, FUSION_HW } from '../../../avionics/collins-fusion';
import { G6K_VARS as V } from '../vars';
import { CK, seg, WING_SLOTS, ZONE, type G6kCockpitContext } from './context';
import { AFD_POS, GEAR_PANEL, IESI_POS, MAIN_PANEL, mainPoint, PED_FACE, TAWS_PANEL } from './layout';
import { g6kFinish } from './finish';

/** Korry-style switchlight (Bombardier PBA) with an engraved name above it. */
export function pba(
  c: G6kCockpitContext,
  panel: Panel,
  o: { id: string; label: string; v: string; x: number; y: number; segments: ReturnType<typeof seg.eq>[]; name?: string; mode?: 'toggle' | 'momentary'; size?: number; nameBelow?: boolean; zone?: string },
): PushButton {
  const s = o.size ?? 0.0165;
  const btn = panel.add(new PushButton(c.env, { id: o.id, label: o.label, var: o.v, mode: o.mode ?? 'toggle', style: 'korry', width: s, height: s, layout: 'stack', segments: o.segments }), o.x, o.y);
  if (o.name !== '') panel.label(o.name ?? o.label, o.x, o.y + (o.nameBelow ? -1 : 1) * (s / 2 + 0.005), { height: 0.0027, zone: o.zone });
  return btn;
}

/** A chrome-ringed gasper eyeball: twist to open (0 closed .. 1 open); var `V.gasper(id)`. */
export function gasper(c: G6kCockpitContext, panel: Panel, id: string, x: number, y: number, label: string, zone?: string): void {
  const { env } = c;
  const ringG = env.geometry.get('g6k.gasper.ring', () => new THREE.TorusGeometry(0.026, 0.0045, 10, 32));
  const cupG = env.geometry.get('g6k.gasper.cup', () => new THREE.CylinderGeometry(0.023, 0.02, 0.012, 24, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.004));
  const ring = new THREE.Mesh(ringG, env.materials.get('chrome'));
  ring.userData.cockpitStatic = true;
  panel.addObject(ring, x, y, { z: 0.003 });
  const cup = new THREE.Mesh(cupG, env.materials.get('steel'));
  cup.userData.cockpitStatic = true;
  panel.addObject(cup, x, y, { z: 0.003 });
  panel.add(
    new RotaryKnob(env, {
      id: `g6k.gasper.${id}`,
      label: `${label} GASPER`,
      cap: 'smooth',
      material: 'aluminium',
      diameter: 0.026,
      height: 0.012,
      pointer: 'none',
      zone,
      // SCOPE: the eyeball does not swivel; twisting opens / closes it (conditioned-air outlet, environment.ts).
      outer: { var: V.gasper(id), min: 0, max: 1, step: 0.25, angleRange: [-90, 90], label: 'GASPER', format: (v) => (v <= 0.01 ? 'CLOSED' : `OPEN ${Math.round(v * 100)} %`) },
    }),
    x,
    y,
  );
}

export function buildMainPanel(c: G6kCockpitContext): Panel {
  const { b, suite } = c;
  const fin = g6kFinish(c.env);
  const M = MAIN_PANEL;
  const B = M.band;
  const vc = (B.v0 + B.v1) / 2;
  const main = b.panel({
    name: 'main',
    center_m: mainPoint(0, vc),
    facing: 'aft',
    tiltDeg: M.tiltDeg,
    width: B.u1 - B.u0,
    height: B.v1 - B.v0,
    material: fin.charcoal,
    radius: 0.012,
    screws: { kind: 'hex', diameter: 0.0035, pitch: 0.3 },
  });
  // Main-band coordinates: (u, v) on the plane -> (u, v - vc) on the band.
  const at = (p: readonly [number, number]): [number, number] => [p[0], p[1] - vc];
  const H = FUSION_HW.afd;
  const bezel = { border: [0.014, 0.014, 0.022, 0.014] as [number, number, number, number], material: 'bezel' as const };
  if (suite) {
    for (const i of [0, 1, 3]) {
      const [x, y] = at(AFD_POS[i]);
      main.display(suite.afd[i], x, y, H.w, H.h, { bezel });
    }
    const [ix, iy] = at(IESI_POS);
    addIesi(b, main, ix, iy, suite);
    main.label('CAGE', ix - 0.022, iy - FUSION_HW.iesi.h / 2 - 0.004, { height: 0.0019, zone: ZONE.centre });
    main.label('BARO', ix + 0.03, iy - FUSION_HW.iesi.h / 2 - 0.004, { height: 0.0019, zone: ZONE.centre });
  }
  buildTaws(c, main, vc);
  buildGearPanel(c, main, vc);
  // AIRSPEED LIMITS placard under the TAWS panel (photo c_centre; values GX AFM placard, Airplane General PTG: VA 254 KIAS
  // at sea level / 96,000 lb, VLO 200, VLE 250, VFE slats out 0 / 6 / 16 / 30 deg flaps 225 / 210 / 210 / 185).
  main.placard(
    {
      text: 'AIRSPEED LIMITS - IAS (KTS)\n\nVA (SEA LEVEL @ 96,000 LB) ..254\nVLO (L/G EXT & RET) ...........200\nVLE (L/G EXTENDED) .............250\n\nVFE (SLATS OUT, 0° FLAPS) ....225\nVFE (SLATS OUT, 6° FLAPS) ....210\nVFE (SLATS OUT, 16° FLAPS) ..210\nVFE (SLATS OUT, 30° FLAPS) ..185',
      height: 0.0019,
      style: 'engraved',
      align: 'left',
      zone: ZONE.centre,
    },
    TAWS_PANEL.u - 0.039,
    TAWS_PANEL.v - TAWS_PANEL.h / 2 - vc - 0.036,
  );
  main.placard({ text: 'CREW LIFE VEST UNDER SEAT', height: 0.0019, style: 'engraved', zone: ZONE.centre }, TAWS_PANEL.u, B.v0 - vc + 0.009);
  buildWings(c, fin);
  buildAfd3Face(c, fin);
  return main;
}

/** TAWS panel (photo c_centre): G/S and FLAPS side by side, TERRAIN below; square unguarded PBAs. */
function buildTaws(c: G6kCockpitContext, main: Panel, vc: number): void {
  const T = TAWS_PANEL;
  const p = main.subPanel({ name: 'taws_panel', x: T.u, y: T.v - vc, width: T.w, height: T.h, origin: 'top-left', material: 'panel', screws: { kind: 'hex', diameter: 0.004, inset: 0.006 } });
  const z = ZONE.centre;
  p.label('TAWS', T.w / 2, 0.006, { height: 0.0028, zone: z });
  p.line(0.008, 0.006, 0.028, 0.006, 0.0005, z);
  p.line(T.w - 0.028, 0.006, T.w - 0.008, 0.006, 0.0005, z);
  // G/S: glideslope alert cancel (momentary; the EGPWS G/S light shows the soft glideslope alert).
  pba(c, p, { id: 'g6k.mp.gs_mute', label: 'TAWS G/S (glideslope cancel)', v: V.gsMute, x: 0.024, y: 0.026, mode: 'momentary', size: 0.015, segments: [seg.on('G/S', 'amber', 'taws.gs_light')], name: 'G/S', zone: z });
  // FLAPS: TAWS flap override (no guard on the Vision panel, photo).
  pba(c, p, { id: 'g6k.mp.flap_ovrd', label: 'TAWS FLAPS (flap override)', v: V.flapOvrd, x: T.w - 0.024, y: 0.026, size: 0.015, segments: [seg.on('OVRD', 'white', V.flapOvrd)], name: 'FLAPS', zone: z });
  // TERRAIN: terrain awareness inhibit.
  pba(c, p, { id: 'g6k.mp.terr_off', label: 'TAWS TERRAIN (inhibit)', v: V.terrOff, x: 0.024, y: 0.056, size: 0.015, segments: [seg.on('OFF', 'white', V.terrOff)], name: 'TERRAIN', zone: z });
}

/**
 * GEAR AND BRAKES column (photo c_centre): NOSE STEER lever-lock toggle (ARMED / OFF), HORN (square PBA), BTMS
 * OVHT WARN RESET (round push button); LDG GEAR handle (brushed-chrome wheel on a dark shaft, UP arrow placard);
 * DN LCK RELEASE red button lower left; AUTOBRAKE OFF / LO / MED / HI; STATIC GROUND OPERATION placard.
 */
function buildGearPanel(c: G6kCockpitContext, main: Panel, vc: number): void {
  const { env } = c;
  const G = GEAR_PANEL;
  const z = ZONE.centre;
  const p = main.subPanel({ name: 'gear_panel', x: G.u, y: G.v - vc, width: G.w, height: G.h, origin: 'top-left', material: 'panel', screws: { kind: 'hex', diameter: 0.004, inset: 0.006, pitch: 0.12 } });
  p.label('GEAR AND BRAKES', G.w / 2, 0.006, { height: 0.0024, zone: z });
  const ry = 0.03;
  // NOSE STEER: round lever-lock toggle ARMED (up) / OFF (photo: a round guarded / lever switch; the FAIL condition is
  // on the CAS, "STEERING INOP").
  p.add(
    new ToggleSwitch(env, {
      id: 'g6k.mp.nose_steer',
      label: 'NOSE STEER',
      var: V.nwsArm,
      positions: ['OFF', 'ARMED'],
      values: [0, 1],
      initial: 1,
      leverLock: true,
      labels: { positions: true, height: 0.0016, zone: z },
      scale: 0.6,
    }),
    0.017,
    ry + 0.002,
  );
  p.label('NOSE', 0.017, ry - 0.016, { height: 0.0018, zone: z });
  p.label('STEER', 0.017, ry - 0.0128, { height: 0.0018, zone: z });
  pba(c, p, { id: 'g6k.mp.horn_mute', label: 'GEAR HORN MUTED', v: V.hornMute, x: G.w / 2, y: ry, size: 0.015, segments: [seg.on('MUTED', 'white', V.hornMuteEff)], name: 'HORN', zone: z });
  p.add(new PushButton(env, { id: 'g6k.mp.btms_reset', label: 'BTMS OVHT WARN RESET', var: V.btmsReset, mode: 'momentary', style: 'round', width: 0.011, segments: [seg.on('', 'red', V.btmsWarn)] }), G.w - 0.017, ry);
  p.label('BTMS OVHT', G.w - 0.017, ry - 0.016, { height: 0.0016, zone: z });
  p.label('WARN RESET', G.w - 0.017, ry - 0.0128, { height: 0.0016, zone: z });
  p.label('LDG GEAR', G.w / 2, ry + 0.016, { height: 0.0022, zone: z });
  // Landing gear handle (wheel knob, 14 CFR 25.781): DN = 1 / UP = 0; the LGECU handle solenoid locks it down on the
  // ground (LandingGear gear.handle_lock; DN LCK RELEASE overrides). Red in-handle light: gear in transit / disagree.
  p.add(
    new GearHandle(env, {
      id: 'g6k.mp.gear',
      var: V.gearHandle,
      label: 'LDG GEAR',
      positions: ['DN', 'UP'],
      values: [1, 0],
      inhibit: (to, _from, v) => !(to === 1 && v.get('gear.handle_lock') !== 0),
      lights: [{ var: CK.gearRed, color: 'red' }],
      length: 0.06,
      knobScale: 0.8,
      knobMaterial: 'chrome',
      armMaterial: 'plasticBlack',
      labels: false,
    }),
    G.w / 2 - 0.004,
    0.1,
  );
  p.label('UP', G.w - 0.016, 0.066, { height: 0.0026, zone: z });
  p.label('↑', G.w - 0.016, 0.075, { height: 0.006, zone: z });
  // DN LCK RELEASE: red round push button lower left of the handle (overrides the handle lock).
  p.add(new PushButton(env, { id: 'g6k.mp.dn_lck_rel', label: 'DN LCK RELEASE', var: V.gearDnLckRel, mode: 'momentary', style: 'round', width: 0.01, capMaterial: 'knobRed' }), 0.016, 0.128);
  p.label('DN LCK', 0.016, 0.114, { height: 0.0016, zone: z });
  p.label('RELEASE', 0.016, 0.1175, { height: 0.0016, zone: z });
  // AUTOBRAKE OFF / LO / MED / HI (photo c_centre; solenoid-held, logic.ts disarms it to OFF).
  p.add(
    new SelectorKnob(env, {
      id: 'g6k.mp.autobrake',
      var: V.autobrake,
      label: 'AUTOBRAKE',
      cap: 'pointer',
      diameter: 0.017,
      labelRadius: 0.018,
      labelHeight: 0.0018,
      labelZone: z,
      positions: [
        { value: 0, label: 'OFF', angle: -40 },
        { value: 1, label: 'LO', angle: 20 },
        { value: 2, label: 'MED', angle: 60 },
        { value: 3, label: 'HI', angle: 100 },
      ],
      initial: 0,
    }),
    G.w / 2,
    0.19,
  );
  p.label('AUTOBRAKE', G.w / 2, 0.164, { height: 0.0019, zone: z });
  p.placard({ text: 'STATIC GROUND OPERATION\nPROHIBITED BETWEEN 66-80% N1', height: 0.0014, style: 'engraved', zone: z }, G.w / 2, 0.232);
  p.placard({ text: 'CREW LIFE VEST UNDER SEAT', height: 0.0017, style: 'engraved', zone: z }, G.w / 2, G.h - 0.009);
}

/**
 * Outboard wings: angled toward each pilot (EST 14 deg), hinged on the band edge. STALL PUSHER plate outboard top,
 * gasper inboard top; the EMS CDU goes below (side builder).
 */
function buildWings(c: G6kCockpitContext, fin: ReturnType<typeof g6kFinish>): void {
  const { b, env } = c;
  const W = MAIN_PANEL.wing;
  const B = MAIN_PANEL.band;
  const t = (MAIN_PANEL.tiltDeg * Math.PI) / 180;
  const vc = (W.v0 + W.v1) / 2;
  const make = (side: -1 | 1): Panel => {
    const yaw = (-side * W.yawDeg * Math.PI) / 180; // normal turned toward the pilot (inboard)
    const hinge = mainPoint(side * B.u1, vc);
    // Wing u axis in body axes: u' = u cos(yaw) - n sin(yaw), u = (0, 1, 0), n = (-cos t, 0, -sin t).
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const uw: [number, number, number] = [sy * Math.cos(t), cy, sy * Math.sin(t)];
    const h = W.w / 2;
    const centre: [number, number, number] = [hinge[0] + side * uw[0] * h, hinge[1] + side * uw[1] * h, hinge[2] + side * uw[2] * h];
    const name = side < 0 ? 'wing_l' : 'wing_r';
    const p = b.panel({ name, center_m: centre, facing: 'aft', tiltDeg: MAIN_PANEL.tiltDeg, yawDeg: (yaw * 180) / Math.PI, width: W.w, height: W.v1 - W.v0, origin: 'top-left', material: fin.charcoal, radius: 0.02, screws: false });
    const zone = side < 0 ? ZONE.left : ZONE.right;
    // x measured from the outboard edge.
    const ox = (d: number) => (side < 0 ? d : W.w - d);
    const S = WING_SLOTS;
    const n = side < 0 ? 1 : 2;
    const who = side < 0 ? 'PILOT' : 'COPILOT';
    const plate = p.subPanel({ name: `${name}_pusher`, x: ox(S.pusher.x), y: S.pusher.y, width: S.pusher.w, height: S.pusher.h, origin: 'top-left', material: 'panelDark', screws: { kind: 'hex', diameter: 0.0035, inset: 0.005 } });
    plate.label('STALL', S.pusher.w / 2, 0.008, { height: 0.0027, zone });
    plate.label('PUSHER', S.pusher.w / 2, 0.014, { height: 0.0022, zone });
    // STALL PUSHER ON / OFF (photo: toggle, ON up).
    plate.add(
      new ToggleSwitch(env, { id: `g6k.side.pusher${n}`, label: `STALL PUSHER (${who})`, var: V.pusher(n), positions: ['OFF', 'ON'], values: [0, 1], initial: 1, labels: { positions: true, height: 0.0019, zone }, scale: 0.75 }),
      S.pusher.w / 2,
      0.036,
    );
    gasper(c, p, side < 0 ? 'wing_l' : 'wing_r', ox(S.gasper.x), S.gasper.y, `${who} PANEL`, zone);
    // Tan leather lip under the wing (photo: the panel surround).
    const lip = new THREE.Mesh(env.geometry.get(`g6k.wing.lip`, () => new THREE.BoxGeometry(W.w + 0.02, 0.028, 0.05)), fin.tan);
    lip.userData.cockpitStatic = true;
    p.addObject(lip, W.w / 2, W.v1 - W.v0 + 0.012, { z: -0.012 });
    return p;
  };
  c.wings = { left: make(-1), right: make(1) };
  // Tan leather lip under the centre band, outboard of the pedestal face (photo).
  for (const side of [-1, 1] as const) {
    const u0 = 0.285;
    const u1 = MAIN_PANEL.band.u1;
    const lipCentre = mainPoint((side * (u0 + u1)) / 2, B.v0 - 0.013, -0.01);
    const m = b.structureMesh(new THREE.BoxGeometry(u1 - u0, 0.028, 0.05), fin.tan, lipCentre, new THREE.Euler(-t, 0, 0), false);
    m.name = `band_lip_${side < 0 ? 'l' : 'r'}`;
  }
}

/** AFD 3 on the steep pedestal forward face (photo N835GL: framed by the pedestal's tan side rails). */
function buildAfd3Face(c: G6kCockpitContext, fin: ReturnType<typeof g6kFinish>): void {
  const { b, suite } = c;
  const F = PED_FACE;
  const back = (F.backDeg * Math.PI) / 180;
  const mid = F.len / 2;
  const centre: [number, number, number] = [F.top[0] - mid * Math.sin(back), 0, F.top[1] + mid * Math.cos(back)];
  // facing 'aft' with the top edge leaning forward (away from the crew) by backDeg.
  const face = b.panel({ name: 'ped_face', center_m: centre, facing: 'aft', tiltDeg: F.backDeg, width: 0.5, height: F.len, origin: 'top-left', material: fin.charcoal, screws: false, radius: 0.006 });
  if (suite) {
    const H = FUSION_HW.afd;
    face.display(suite.afd[2], 0.25, F.afdS, H.w, H.h, { bezel: { border: [0.014, 0.014, 0.022, 0.014], material: 'bezel' } });
  }
}

