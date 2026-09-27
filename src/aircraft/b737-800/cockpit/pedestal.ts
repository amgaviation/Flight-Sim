/**
 * 737-800 forward electronic panel (P9: the two CDUs side by side) and the
 * control stand (throttle quadrant), FCOM 7.10 / 9.10 / 14.10:
 *
 *  - Thrust levers 1 / 2 (A/T back-drives them) with the TO/GA switches on
 *    the front of the knobs and the A/T disengage switches on the outboard
 *    sides; piggy-back reverse thrust levers, usable only with the thrust
 *    lever at idle and held at the reverse-idle interlock until the sleeves
 *    are deployed (FCOM 7.20).
 *  - Engine start levers IDLE / CUTOFF (lift over the detents).
 *  - SPEED BRAKE lever (left): DOWN / ARMED / FLIGHT DETENT / UP.
 *  - FLAP lever (right): UP 1 2 5 10 15 25 30 40 with gates at 1 and 15.
 *  - Stabilizer trim wheels either side with the stabilizer trim indicator
 *    (0-17 units, take-off green band) on the Captain side; ~162 turns stop
 *    to stop (Boeing maintenance data quoted on PPRuNe "Boeing 737 trim
 *    wheels": 162 turns for 0.2-16.9 units -> ~0.105 units per turn).
 *  - STAB TRIM MAIN ELECT and AUTO PILOT cutout switches (guarded NORMAL).
 *  - Parking brake lever with the PARKING BRAKE light, gear warning HORN
 *    CUTOUT push button.
 * Positions EST from 737NG photographs (layout.ts STAND / P9).
 */
import type * as THREE from 'three';
import { GuardedSwitch, Lever, PushButton, TBarHandle, TrimWheel } from '../../../cockpit/controls';
import { addCdu } from '../../../avionics/boeing-737';
import { INPUT } from '../../../core/vars';
import type { SimVars } from '../../../core/SimVars';
import { B738, SPEEDBRAKE } from '../vars';
import { STAB } from '../data';
import type { B738CockpitContext } from './context';
import { seg } from './context';
import { annunciator } from './common';
import { P9, STAND, standTopZ } from './layout';

/** Stabilizer units per trim wheel revolution (see header). */
export const STAB_UNITS_PER_REV = (16.9 - 0.2) / 162;

export function buildPedestal(c: B738CockpitContext): void {
  const { b, env, sys } = c;
  // ---------------------------------------------------------------- P9: CDUs
  const p9 = b.panel({ name: 'b738.p9', ...P9, origin: 'center', material: 'panelDark', screws: false });
  addCdu(b, p9, -0.076, 0, sys.suite, 1);
  addCdu(b, p9, 0.076, 0, sys.suite, 2);

  // ---------------------------------------------------------------- control stand top
  // Slant length of the sloping top (forward end lower, layout.ts STAND).
  const len = Math.hypot(STAND.xFwd - STAND.xAft, STAND.fwdZ - STAND.aftZ);
  const st = b.panel({
    name: 'b738.stand',
    center_m: [(STAND.xFwd + STAND.xAft) / 2, 0, STAND.topZ],
    facing: 'up',
    tiltDeg: STAND.tiltDeg,
    width: STAND.width,
    height: len,
    origin: 'center',
    material: 'panel',
    screws: { kind: 'dzus', diameter: 0.008, pitch: 0.3 },
  });
  st.label('THRUST', 0, 0.33, { height: 0.003 });

  // Reverse lever interlock tuples (no per-frame allocation).
  const LOCKED: [number, number] = [0, 0];
  const REV_IDLE: [number, number] = [0, 0.14];
  const FREE: [number, number] = [0, 1];
  for (const i of [1, 2] as const) {
    const sg = i === 1 ? -1 : 1;
    const u = sg * 0.036;
    const tl = st.add(
      new Lever(env, {
        id: `b738.ped.tl${i}`,
        label: `THRUST LEVER ${i}`,
        var: B738.tla(i),
        min: 0,
        max: 1,
        detents: [{ value: 0, label: i === 1 ? 'IDLE' : undefined, kind: 'soft' }],
        travel: { kind: 'arc', minDeg: -24, maxDeg: 30, pivotDepth: 0.14 },
        armLength: 0.3,
        armWidth: 0.012,
        knob: 'boeing-thrust',
        slot: { width: 0.016, plateWidth: 0.03 },
        detentLabels: false,
        axis: { var: INPUT.throttle(i) },
        dragPxFull: 280,
        format: (v) => `${Math.round(v * 100)} %`,
      }),
      u,
      0.03,
    );
    tl.handle.userData.cockpitDynamic = true;
    // TO/GA switch on the front of the knob and the A/T disengage switch on its outboard side (FCOM 4.10).
    const toga = new PushButton(env, { id: `b738.ped.toga${i}`, label: `TO/GA (lever ${i})`, style: 'small', width: 0.009, height: 0.007, mode: 'momentary', event: 'ap.toga', capMaterial: 'plasticBlack' });
    mountOnHandle(tl.handle, toga.object, 0, 0.02, 0.3, -Math.PI / 2, 0);
    b.add(toga);
    const atd = new PushButton(env, { id: `b738.ped.at_disc${i}`, label: `A/T DISENGAGE (lever ${i})`, style: 'small', width: 0.008, height: 0.008, mode: 'momentary', event: 'at.disc', capMaterial: 'knobRed' });
    mountOnHandle(tl.handle, atd.object, sg * 0.026, 0, 0.3, 0, (sg * Math.PI) / 2);
    b.add(atd);
    for (const btn of [toga, atd]) for (const h of btn.hitTargets) h.userData.hitPriority = 1;

    // Reverse thrust lever (piggy-back on the thrust lever, lifted up and aft).
    const tlaVar = B738.tla(i);
    const posVar = `eng${i}.reverser_pos`;
    st.add(
      new Lever(env, {
        id: `b738.ped.rev${i}`,
        label: `REVERSE THRUST LEVER ${i}`,
        var: B738.revLever(i),
        min: 0,
        max: 1,
        detents: [{ value: 0.14, label: 'REV IDLE', kind: 'soft' }],
        travel: { kind: 'arc', minDeg: -22, maxDeg: -62, pivotDepth: 0.14 },
        armLength: 0.25,
        armWidth: 0.008,
        knob: 'reverser',
        slot: false,
        detentLabels: false,
        // Mechanical interlocks: thrust lever at idle; held at reverse idle until the sleeves are ~90 % deployed.
        limit: (v: SimVars) => (v.get(tlaVar) > 0.001 ? LOCKED : v.get(posVar) < 0.9 ? REV_IDLE : FREE),
        dragPxFull: 220,
      }),
      u + sg * 0.011,
      0.03,
    ).handle.userData.cockpitDynamic = true;

    // Engine start lever (below / aft of the thrust levers).
    st.add(
      new Lever(env, {
        id: `b738.ped.start${i}`,
        label: `ENGINE ${i} START LEVER`,
        var: B738.startLever(i),
        min: 0,
        max: 1,
        discrete: true,
        detents: [
          { value: 0, label: 'CUTOFF', kind: 'gate' },
          { value: 1, label: 'IDLE', kind: 'gate' },
        ],
        travel: { kind: 'arc', minDeg: -22, maxDeg: 18, pivotDepth: 0.03 },
        armLength: 0.07,
        knob: 'start',
        slot: { width: 0.012, plateWidth: 0.022 },
        detentLabels: i === 2 ? 'right' : false,
        labelHeight: 0.0024,
      }),
      u,
      -0.285,
    );
    st.label(String(i), u, -0.245, { height: 0.004 });
  }
  st.label('START LEVERS', 0, -0.345, { height: 0.0026 });
  st.label('IDLE', -0.075, -0.265, { height: 0.0024 });
  st.label('CUTOFF', -0.075, -0.305, { height: 0.0024 });

  // ---------------------------------------------------------------- speed brake lever (left)
  st.add(
    new Lever(env, {
      id: 'b738.ped.speedbrake',
      label: 'SPEED BRAKE',
      var: B738.speedbrake,
      min: 0,
      max: 1,
      detents: [
        { value: SPEEDBRAKE.down, label: 'DOWN', kind: 'gate', direction: 'increasing' },
        { value: SPEEDBRAKE.armed, label: 'ARMED', kind: 'soft' },
        { value: SPEEDBRAKE.flightDetent, label: 'FLIGHT DETENT', kind: 'gate', direction: 'increasing' },
        { value: SPEEDBRAKE.up, label: 'UP', kind: 'soft' },
      ],
      // DOWN is forward, UP is pulled aft (FCOM 9.10).
      travel: { kind: 'arc', minDeg: 26, maxDeg: -34, pivotDepth: 0.06 },
      armLength: 0.16,
      knob: 'speedbrake',
      slot: { width: 0.014, plateWidth: 0.03 },
      detentLabels: 'left',
      labelHeight: 0.0022,
    }),
    -0.118,
    0.02,
  ).handle.userData.cockpitDynamic = true;
  st.label('SPEED BRAKE', -0.118, 0.16, { height: 0.0026 });

  // ---------------------------------------------------------------- flap lever (right)
  const flapLabels = ['UP', '1', '2', '5', '10', '15', '25', '30', '40'];
  st.add(
    new Lever(env, {
      id: 'b738.ped.flaps',
      label: 'FLAP',
      var: B738.flapLever,
      min: 0,
      max: 8,
      discrete: true,
      // Gates at flaps 1 and 15 (dossier §5 / FCOM 9.10: go-around flap gates).
      detents: flapLabels.map((l, i) => ({ value: i, label: l, kind: i === 1 || i === 5 ? ('gate' as const) : ('soft' as const) })),
      travel: { kind: 'arc', minDeg: 28, maxDeg: -32, pivotDepth: 0.06 },
      armLength: 0.15,
      knob: 'flap',
      slot: { width: 0.014, plateWidth: 0.03 },
      detentLabels: 'right',
      labelHeight: 0.0024,
      format: (v) => flapLabels[Math.round(v)] ?? String(v),
    }),
    0.118,
    0.02,
  ).handle.userData.cockpitDynamic = true;
  st.label('FLAP', 0.118, 0.16, { height: 0.0026 });

  // ---------------------------------------------------------------- stab trim cutouts, horn cutout, parking brake
  for (const [k, name, v, x] of [
    ['main', 'MAIN ELECT', B738.stabCutoutMain, 0.09],
    ['ap', 'AUTO PILOT', B738.stabCutoutAp, 0.135],
  ] as const) {
    st.add(
      new GuardedSwitch(env, {
        id: `b738.ped.stab_cutout_${k}`,
        label: `STAB TRIM ${name}`,
        var: v,
        positions: ['CUTOUT', 'NORMAL'],
        values: [0, 1],
        initial: 1,
        labels: { name: name, positions: true, height: 0.0019 },
        guard: { color: 'red', guardedPosition: 1 },
      }),
      x,
      -0.3,
    );
  }
  st.label('STAB TRIM', 0.1125, -0.26, { height: 0.0024 });
  st.add(new PushButton(env, { id: 'b738.ped.horn_cutout', label: 'GEAR WARNING HORN CUTOUT', style: 'round', width: 0.011, height: 0.011, mode: 'momentary', var: B738.hornCutout, engraved: 'HORN\nCUTOUT', engravedHeight: 0.0014 }), -0.13, -0.17);
  st.add(
    new TBarHandle(env, {
      id: 'b738.ped.park_brake',
      label: 'PARKING BRAKE',
      var: B738.parkBrake,
      style: 'lever',
      pullLength: 0.03,
    }),
    -0.12,
    -0.27,
  );
  annunciator(env, st, 'b738.ped.park_brake_lt', 'PARKING BRAKE', [seg.on(['PARKING', 'BRAKE'], 'red', B738.lt.parkingBrake)], -0.12, -0.325, 0.03, 0.014);

  // ---------------------------------------------------------------- stabilizer trim wheels either side of the stand
  for (const s of [1, 2] as const) {
    const sg = s === 1 ? -1 : 1;
    const mount = b.panel({ name: `b738.stab_wheel${s}`, center_m: [(STAND.xFwd + STAND.xAft) / 2 - 0.02, sg * (STAND.width / 2 + 0.022), standTopZ((STAND.xFwd + STAND.xAft) / 2 - 0.02) + 0.002], facing: 'up', width: 0.04, height: 0.36, invisible: true });
    mount.add(
      new TrimWheel(env, {
        id: `b738.ped.stab_wheel${s}`,
        label: 'STABILIZER TRIM WHEEL',
        var: 'trim.pitch_units',
        min: STAB.minUnits,
        max: STAB.maxUnits,
        perRev: STAB_UNITS_PER_REV,
        diameter: 0.3,
        thickness: 0.032,
        exposure: 0.42,
        spokes: 5,
        stripes: true,
        handle: true,
        holdRevPerS: 2.5,
        indicator:
          s === 1
            ? {
                length: 0.11,
                offset: [-0.035, -0.035, 0.0],
                marks: [0, 2, 4, 6, 8, 10, 12, 14, 16, 17].map((u) => ({ value: u, label: u % 2 === 0 ? String(u) : undefined })),
                band: STAB.greenBand as [number, number],
                increasingUp: false,
              }
            : undefined,
      }),
      0,
      0,
    );
  }
}

/** Attaches a small control object to a lever arm (handle frame: +z along the arm, +y forward). */
function mountOnHandle(handle: THREE.Group, obj: THREE.Object3D, x: number, y: number, z: number, rx: number, ry: number): void {
  obj.position.set(x, y, z);
  obj.rotation.set(rx, ry, 0);
  handle.add(obj);
}
