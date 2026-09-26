/**
 * G800 main instrument panel (dossier §9.2):
 *
 *  display band : four Honeywell DU-1310 14-in landscape display units in one row
 *                 (DU1 L PFD, DU2 L MFD, DU3 R MFD, DU4 R PFD; FlightGlobal / Epic suite),
 *                 powered from the elec.du{n}_powered loads (suite power bindings);
 *  panel wings  : the outboard touch-screen controllers TSC 1 (L) and TSC 4 (R), yawed toward
 *                 each pilot (BJT500 "four touchscreen controllers in the forward flight deck,
 *                 one each outboard, and in the pedestal");
 *  knee panels  : left of the pedestal the CAS scroll switch (dossier §9.2: "under DU2");
 *                 right of the pedestal the LANDING GEAR handle (ground lock solenoid, red
 *                 transit light), DN LOCK RELEASE, HORN SILENCE, the gear position lamps and the
 *                 red EMERGENCY GEAR (nitrogen blowdown) T-handle (dossier §9.2, EST placement
 *                 from G500/G600 photographs).
 */
import { AnnunciatorLight, GearHandle, PushButton, TBarHandle } from '../../../cockpit/controls';
import { addCasScrollSwitch, addDisplayUnits, addTsc, EPIC_HW } from '../../../avionics/honeywell-epic/cockpit';
import { G800_VARS as V } from '../vars';
import { CK, type G800CockpitContext } from './context';
import { DU_U, KNEE_PANEL, MAIN_PANEL, OUTBOARD_TSC } from './layout';

export function buildMainPanel(c: G800CockpitContext): void {
  const { b, env, suite } = c;
  const mp = MAIN_PANEL;
  const main = b.panel({ name: 'g800.main', center_m: mp.center_m, facing: 'aft', tiltDeg: mp.tiltDeg, width: mp.width, height: mp.height, material: 'panel', screws: false, radius: 0.01 });
  if (suite) addDisplayUnits(main, suite, DU_U.map((u) => [u, 0] as const));

  // ---- outboard TSCs on the panel wings
  for (const side of [-1, 1] as const) {
    const t = OUTBOARD_TSC;
    const wing = b.panel({
      name: side < 0 ? 'g800.tsc_out_l' : 'g800.tsc_out_r',
      center_m: [t.x, side * t.y, t.z],
      facing: 'aft',
      yawDeg: -side * t.yawDeg,
      tiltDeg: t.tiltDeg,
      width: EPIC_HW.tsc.w + 0.05,
      height: EPIC_HW.tsc.h + 0.06,
      material: 'panel',
      screws: false,
      radius: 0.01,
    });
    if (suite) addTsc(wing, 0, 0.005, suite, side < 0 ? 1 : 4);
    wing.label(side < 0 ? 'TSC 1' : 'TSC 4', 0, -(EPIC_HW.tsc.h / 2 + 0.019), { height: 0.0024 });
  }

  // ---- knee panels either side of the pedestal (origin top-left: x right, y down)
  const kp = KNEE_PANEL;
  const kh = kp.zBottom - kp.zTop;
  const kw = kp.yOut - kp.yIn;
  const knee = (side: -1 | 1) =>
    b.panel({
      name: side < 0 ? 'g800.knee_l' : 'g800.knee_r',
      center_m: [kp.x, side * (kp.yIn + kw / 2), (kp.zTop + kp.zBottom) / 2],
      facing: 'aft',
      tiltDeg: kp.tiltDeg,
      width: kw,
      height: kh,
      origin: 'top-left',
      material: 'panel',
      screws: { kind: 'dzus', diameter: 0.006, inset: 0.008 },
    });
  const left = knee(-1);
  addCasScrollSwitch(b, left, kw / 2, 0.06);
  left.label('CAS SCROLL', kw / 2, 0.024, { height: 0.0027 });

  const right = knee(1);
  // Gear position lamps (NOSE / LEFT / RIGHT): green = down and locked, red = in transit or disagree.
  const lamps: [string, number, number][] = [
    ['NOSE', 0, kw / 2],
    ['LEFT', 1, kw / 2 - 0.028],
    ['RIGHT', 2, kw / 2 + 0.028],
  ];
  for (const [name, i, x] of lamps) {
    right.add(
      new AnnunciatorLight(env, {
        id: `g800.kp.gear_lt_${name.toLowerCase()}`,
        label: `${name} GEAR`,
        width: 0.02,
        height: 0.016,
        layout: 'stack',
        segments: [
          { text: name, color: 'green', var: `gear.green${i}` },
          { text: 'UNLK', color: 'red', var: `gear.red${i}` },
        ],
      }),
      x,
      i === 0 ? 0.02 : 0.04,
    );
  }
  right.add(
    new GearHandle(env, {
      id: 'g800.kp.gear',
      label: 'LANDING GEAR',
      var: V.gearHandle,
      positions: ['DN', 'UP'],
      values: [1, 0],
      initial: 0,
      length: 0.075,
      swingDeg: 28,
      // Ground lock solenoid (LandingGear handleLock; DN LOCK RELEASE overrides it in the system).
      inhibit: (to, _from, vars) => !(to === 1 && vars.get('gear.handle_lock') !== 0),
      lights: [{ var: CK.gearRed, color: 'red' }],
    }),
    kw / 2 - 0.02,
    0.12,
  );
  right.add(
    new PushButton(env, {
      id: 'g800.kp.dn_lock_rel',
      label: 'DN LOCK RELEASE',
      var: V.gearLockRel,
      mode: 'momentary',
      style: 'small',
      width: 0.009,
      capMaterial: 'knobRed',
    }),
    kw - 0.03,
    0.085,
  );
  right.label('DN LOCK\nREL', kw - 0.03, 0.07, { height: 0.0021 });
  right.add(
    new PushButton(env, {
      id: 'g800.kp.horn_silence',
      label: 'GEAR HORN SILENCE',
      mode: 'momentary',
      event: 'gear.horn_silence',
      style: 'round',
      width: 0.011,
      engraved: 'HORN',
      engravedHeight: 0.0018,
    }),
    kw - 0.03,
    0.13,
  );
  right.label('SILENCE', kw - 0.03, 0.143, { height: 0.0021 });
  right.add(
    new TBarHandle(env, {
      id: 'g800.kp.emer_gear',
      label: 'EMERGENCY LANDING GEAR',
      var: V.gearAlt,
      valueIn: 0,
      valueOut: 1,
      style: 'tbar',
      material: 'paintRed',
      pullLength: 0.06,
      legend: 'EMER GEAR',
      scale: 0.9,
    }),
    kw / 2,
    0.205,
  );
  right.label('EMER GEAR - PULL', kw / 2, 0.184, { height: 0.0022 });
}
