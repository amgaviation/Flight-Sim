/**
 * Global 6000 glareshield front face, Global Vision layout (photo N835GL,
 * crops c_gs_l / c_gs_r), left to right:
 *   EVS knob (MIN - MAX, PUSH/EVS CAL) | HUD knob (DIM - BRT, PUSH/MODE) |
 *   [ROLL SPLRS PLT CONT: not built, see below] | MASTER WARNING/CAUTION |
 *   CTP 1 | FCP-5120 | CTP 2 | MASTER WARNING/CAUTION | [ROLL SPLRS CPLT CONT].
 * One square MASTER WARNING/CAUTION switchlight per side, directly outboard of
 * the CTP, with a two-segment legend (red WARNING over amber CAUTION); a press
 * acknowledges both (CasManager `cas.ack_warning` on press, `cas.ack_caution`
 * on release).
 * HUD (pilot side, optional equipment; GX PTG 15-18 "The heads-up guidance
 * system has a brightness control knob on the glareshield (pilot's side)"):
 * the HUD knob sets the brightness (`V.hudBrt`) and, pushed, cycles the HUD
 * mode (`V.hudModeBtn`); the combiner hangs from the ceiling in front of the
 * pilot and stows up with its PUSH latch (`V.hudStow`); the symbology shows
 * while `V.hudOn` (systems/vision.ts). SCOPE: minimal conformal symbology
 * (horizon line, flight-path marker and boresight); no EVS image.
 * ROLL SPLRS PLT CONT / CPLT CONT (GX PTG 10-48 / 10-49): released / pressed
 * switchlights between the MASTER WARNING/CAUTION and the HUD knob (pilot)
 * and at the copilot's end, split legend amber ROLL SEL over white PLT ROLL
 * (CPLT ROLL); pressing one gives that wheel's roll sensor priority for the
 * MFS roll assist after a roll disconnect (systems/flightControlExtras.ts).
 * The glareshield face is charcoal with a tan-leather lower lip (photo).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PushButton, RotaryKnob } from '../../../cockpit/controls';
import { addCtpVision, addFcpVision } from '../../../avionics/collins-fusion';
import { G6K_EVENTS, G6K_VARS as V } from '../vars';
import { ZONE, type G6kCockpitContext } from './context';
import { EYE_L, GLARE_FACE } from './layout';
import { g6kFinish } from './finish';

/** Horizontal positions (u) on the glareshield face. */
export const GS_X = { ctp: 0.47, mwc: 0.58, roll: 0.632, hud: 0.685, evs: 0.74 };

export function buildGlareshield(c: G6kCockpitContext): void {
  const { b, env, suite } = c;
  const fin = g6kFinish(env);
  const G = GLARE_FACE;
  const face = b.panel({ name: 'glareshield_face', center_m: G.center_m, facing: 'aft', tiltDeg: G.tiltDeg, width: G.width, height: G.height, material: fin.charcoal, screws: false, radius: 0.012 });
  // Tan leather lower lip along the glareshield (photo).
  const lip = new THREE.Mesh(env.geometry.get('g6k.gs.lip', () => new THREE.BoxGeometry(G.width + 0.06, 0.009, 0.022)), fin.tan);
  lip.userData.cockpitStatic = true;
  face.addObject(lip, 0, -G.height / 2 - 0.0045, { z: -0.009 });
  if (suite) {
    addFcpVision(b, face, 0, 0, suite, { zone: ZONE.centre, canvas: c.canvas });
    addCtpVision(b, face, -GS_X.ctp, 0, suite, 1, { zone: ZONE.left, canvas: c.canvas, brtVar: V.ltCtp(1) });
    addCtpVision(b, face, GS_X.ctp, 0, suite, 2, { zone: ZONE.right, canvas: c.canvas, brtVar: V.ltCtp(2) });
  }
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'l' : 'r';
    const S = side < 0 ? 'PILOT' : 'COPILOT';
    const zone = side < 0 ? ZONE.left : ZONE.right;
    face.add(
      new PushButton(env, {
        id: `g6k.gs.mwc_${s}`,
        label: `MASTER WARNING/CAUTION (${S})`,
        mode: 'momentary',
        event: G6K_EVENTS.masterWarning,
        releaseEvent: G6K_EVENTS.masterCaution,
        width: 0.024,
        height: 0.024,
        layout: 'stack',
        // Unlit lens is near-black dark red/amber with no readable legend (photo N835GL c_gs_l; Bombardier
        // dark-cockpit convention) - the default field tint 0.16 read as lit in daylight.
        unlitTint: 0.04,
        segments: [
          { text: 'WARNING', color: 'red', var: 'alert.master_warning', style: 'field' },
          { text: 'CAUTION', color: 'amber', var: 'alert.master_caution', style: 'field' },
        ],
      }),
      side * GS_X.mwc,
      -0.004,
    );
    face.label('MASTER', side * GS_X.mwc, 0.02, { height: 0.0021, zone });
    face.label('WARNING/CAUTION', side * GS_X.mwc, 0.0165, { height: 0.0019, zone });
    // ROLL SPLRS PLT CONT / CPLT CONT (photo c_gs_l / c_gs_r).
    const n = side < 0 ? 1 : 2;
    face.add(
      new PushButton(env, {
        id: `g6k.gs.roll_splr${n}`,
        label: `ROLL SPLRS ${n === 1 ? 'PLT' : 'CPLT'} CONT`,
        var: V.rollSplr(n),
        mode: 'toggle',
        style: 'korry',
        width: 0.019,
        height: 0.019,
        layout: 'stack',
        unlitTint: 0.05, // dark cockpit: legends invisible until lit (photo c_gs_l)
        segments: [
          { text: ['ROLL', 'SEL'], color: 'amber', var: V.rollSelReq },
          { text: [n === 1 ? 'PLT' : 'CPLT', 'ROLL'], color: 'white', var: V.rollPriority, test: (x: number) => x === n },
        ],
      }),
      side * GS_X.roll,
      -0.003,
    );
    face.label('ROLL SPLRS', side * GS_X.roll, 0.0165, { height: 0.0019, zone });
    face.label(n === 1 ? 'PLT CONT' : 'CPLT CONT', side * GS_X.roll, -0.0185, { height: 0.0019, zone });
  }
  // EVS and HUD knobs, pilot's end (photo c_gs_l).
  const zl = ZONE.left;
  face.add(
    new RotaryKnob(env, {
      id: 'g6k.gs.evs',
      label: 'EVS',
      cap: 'knurled',
      diameter: 0.015,
      zone: zl,
      outer: { var: V.evsGain, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: 'EVS', format: (v) => (v <= 0.001 ? 'MIN' : v >= 0.999 ? 'MAX' : `${Math.round(v * 100)} %`) },
      push: { var: V.evsCal, mode: 'momentary', label: 'EVS CAL' },
    }),
    -GS_X.evs,
    0.002,
  );
  face.label('EVS', -GS_X.evs, 0.021, { height: 0.0021, zone: zl });
  face.label('MIN', -GS_X.evs - 0.012, -0.014, { height: 0.0016, zone: zl });
  face.label('MAX', -GS_X.evs + 0.012, -0.014, { height: 0.0016, zone: zl });
  face.label('PUSH/EVS CAL', -GS_X.evs, -0.019, { height: 0.0017, zone: zl });
  face.add(
    new RotaryKnob(env, {
      id: 'g6k.gs.hud',
      label: 'HUD',
      cap: 'knurled',
      diameter: 0.015,
      zone: zl,
      outer: { var: V.hudBrt, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: 'HUD BRT', format: (v) => (v <= 0.02 ? 'DIM (blank)' : v >= 0.999 ? 'BRT' : `${Math.round(v * 100)} %`) },
      push: { var: V.hudModeBtn, mode: 'momentary', label: 'MODE' },
    }),
    -GS_X.hud,
    0.002,
  );
  face.label('HUD', -GS_X.hud, 0.021, { height: 0.0021, zone: zl });
  face.label('DIM', -GS_X.hud - 0.012, -0.014, { height: 0.0016, zone: zl });
  face.label('BRT', -GS_X.hud + 0.012, -0.014, { height: 0.0016, zone: zl });
  face.label('PUSH/MODE', -GS_X.hud, -0.019, { height: 0.0017, zone: zl });
  buildHudCombiner(c);
}

/**
 * HUD combiner (photo N835GL: hanging from the ceiling in front of the pilot, "PUSH" stow latch on the arm).
 * The PUSH latch toggles `V.hudStow` (1 stowed up against the ceiling, 0 deployed in front of the design eye);
 * the glass carries a minimal symbology group lit while `V.hudOn`.
 */
function buildHudCombiner(c: G6kCockpitContext): void {
  const { b, env } = c;
  const vars = c.ctx.vars;
  // Pivot on the ceiling ahead of the pilot (EST from the photo: ~0.3 m ahead of and 0.26 m above the eye).
  const pivot: [number, number, number] = [EYE_L[0] + 0.3, EYE_L[1] + 0.02, EYE_L[2] - 0.26];
  const mount = b.panel({ name: 'hud_mount', center_m: pivot, facing: 'aft', width: 0.06, height: 0.05, material: 'plasticBlack', screws: false, radius: 0.01 });
  mount.add(new PushButton(env, { id: 'g6k.hud.stow', label: 'HUD COMBINER (PUSH: stow / deploy)', var: V.hudStow, mode: 'toggle', style: 'round', width: 0.012, capMaterial: 'plasticBlack', engraved: 'PUSH', engravedHeight: 0.0022 }), 0, 0);
  // Moving arm + glass.
  const arm = new THREE.Group();
  arm.name = 'hud_combiner';
  arm.userData.cockpitDynamic = true;
  const pl = new THREE.Vector3(pivot[1], -pivot[2], -pivot[0]);
  arm.position.copy(pl);
  b.root.add(arm);
  // Arm and glass frame in one mesh.
  const rodG = new THREE.BoxGeometry(0.018, 0.2, 0.018).translate(0, -0.1, 0.01);
  const frameG = new THREE.BoxGeometry(0.31, 0.012, 0.012).translate(0, -0.155, 0.03);
  const rod = new THREE.Mesh(mergeGeometries([rodG, frameG], false)!, env.materials.get('plasticBlack'));
  rodG.dispose();
  frameG.dispose();
  arm.add(rod);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb5a8, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false });
  env.materials.track(glassMat);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), glassMat);
  glass.position.set(0, -0.26, 0.03);
  arm.add(glass);
  // Symbology: horizon line, flight path marker, boresight (emissive green, additive-looking).
  const symMat = new THREE.MeshBasicMaterial({ color: 0x40ff70, transparent: true, opacity: 0.9, depthWrite: false });
  env.materials.track(symMat);
  const sym = new THREE.Group();
  sym.position.set(0, -0.26, 0.031);
  arm.add(sym);
  const horizon = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.0012), symMat);
  const horizonG = new THREE.Group();
  horizonG.add(horizon);
  sym.add(horizonG);
  const fpm = new THREE.Mesh(new THREE.RingGeometry(0.004, 0.0055, 20), symMat);
  sym.add(fpm);
  const bore = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.001), symMat);
  sym.add(bore);
  for (const g of [rod.geometry, glass.geometry, horizon.geometry, fpm.geometry, bore.geometry]) b.trackGeometry(g);
  // Conformal scale EST: 0.2 m glass ~ 24 deg vertical field at ~0.47 m from the eye.
  const mPerDeg = 0.2 / 24;
  let a = vars.get(V.hudStow, 1) ? 1 : 0;
  b.onUpdate((dt) => {
    const target = vars.get(V.hudStow) ? 1 : 0;
    a += (target - a) * Math.min(1, dt * 4);
    arm.rotation.x = -a * 1.45; // stowed: swung up and forward against the ceiling
    const on = vars.get(V.hudOn) !== 0 && a < 0.05;
    sym.visible = on;
    if (!on) return;
    const pitch = vars.get('ahrs1.pitch_deg');
    const roll = vars.get('ahrs1.roll_deg');
    horizonG.rotation.z = (roll * Math.PI) / 180;
    horizonG.position.y = Math.max(-0.09, Math.min(0.09, -pitch * mPerDeg));
    // Flight path angle from the air data (VS / TAS): the marker sits (fpa - pitch) from the boresight.
    const tas = Math.max(40, vars.get('adc1.tas_kt'));
    const fpa = (Math.atan2(vars.get('adc1.vs_fpm') / 6076.12 * 60, tas) * 180) / Math.PI;
    fpm.position.y = Math.max(-0.09, Math.min(0.09, (fpa - pitch) * mPerDeg));
    symMat.opacity = 0.35 + 0.6 * vars.get(V.hudBrt);
  });
}
