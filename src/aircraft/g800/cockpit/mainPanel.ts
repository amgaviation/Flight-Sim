/**
 * G800 main instrument panel (dossier §9.2; G600 BL7C0704 / BL7C0705 photographs):
 *
 *  display band : four Honeywell DU-1310 14-in landscape display units forming one continuous band with ~1 cm between
 *                 bezels (DU1 L PFD, DU2 L MFD, DU3 R MFD, DU4 R PFD; FlightGlobal / Epic suite), powered from the
 *                 elec.du{n}_powered loads (suite power bindings);
 *  outboard     : TSC 1 (L) and TSC 4 (R) directly outboard of DU1 / DU4 on the DU centreline, toed in (BJT500 "four
 *                 touchscreen controllers in the forward flight deck, one each outboard, and in the pedestal");
 *  lower centre : between the DU band and the pedestal TSC wings (crop g6_lowctr): the red lit L / R engine fire handles
 *                 at the ends (white L / R legends), the red lit EMER LDG GEAR handle left of centre, the white
 *                 paddle LANDING GEAR handle with its green down-and-locked lights and LOCK RELEASE right of centre.
 *
 * Fire handles (code450 G700/G800 fire protection study sheets): locked by a 28 VDC solenoid until a fire warning (or
 * the fire test) releases them (ac.g800.fire_{l,r}_unlock); pulled, they close that engine's fuel, bleed and hydraulic
 * shut-offs (ac.g800.fire_{l,r}_handle); rotated while pulled: -1 = DISCH 1 (RIGHT bottle), +1 = DISCH 2 (LEFT bottle),
 * spring back to 0 (ac.g800.fire_{l,r}_rot). The lamp in each handle follows the zone's fire warning. The APU has no
 * handle: guarded APU FIRE EXT switchlight on the forward overhead strip (overhead/index.ts).
 *
 * The CAS is scrolled from the CCD / TSC (Epic events); there is no hardware CAS scroll switch (lower side panels
 * carry only the pull-out tables, shell.ts). HORN SILENCE: no hardware in the photographs - a TSC FLT CTL key
 * (systems/tscApps.ts).
 */
import { AnnunciatorLight, GearHandle, PushButton, TBarHandle } from '../../../cockpit/controls';
import { addDisplayUnits, addTsc, EPIC_HW } from '../../../avionics/honeywell-epic/cockpit';
import { G800_VARS as V } from '../vars';
import { CK, type G800CockpitContext } from './context';
import { DU_U, LOWER_CTR, MAIN_PANEL, OUTBOARD_TSC } from './layout';

export function buildMainPanel(c: G800CockpitContext): void {
  const { b, env, suite } = c;
  const mp = MAIN_PANEL;
  const main = b.panel({ name: 'g800.main', center_m: mp.center_m, facing: 'aft', tiltDeg: mp.tiltDeg, width: mp.width, height: mp.height, material: 'panel', screws: false, radius: 0.01 });
  if (suite) addDisplayUnits(main, suite, DU_U.map((u) => [u, 0] as const));

  // ---- outboard TSCs (toed-in housings directly outboard of DU1 / DU4)
  for (const side of [-1, 1] as const) {
    const t = OUTBOARD_TSC;
    const wing = b.panel({
      name: side < 0 ? 'g800.tsc_out_l' : 'g800.tsc_out_r',
      center_m: [t.x, side * t.y, t.z],
      facing: 'aft',
      yawDeg: -side * t.yawDeg,
      tiltDeg: t.tiltDeg,
      width: EPIC_HW.tsc.w + 0.03,
      height: EPIC_HW.tsc.h + 0.05,
      material: 'panelDark',
      screws: false,
      radius: 0.012,
    });
    if (suite) addTsc(wing, 0, 0.004, suite, side < 0 ? 1 : 4);
  }

  // ---- lower centre panel
  const lc = LOWER_CTR;
  const low = b.panel({ name: 'g800.lower_ctr', center_m: lc.center_m, facing: 'aft', tiltDeg: lc.tiltDeg, width: lc.width, height: lc.height, material: 'panelDark', screws: { kind: 'hex', diameter: 0.004, inset: 0.008, pitch: 0.2 }, radius: 0.01 });
  // Engine fire handles: red lit stalk handles at the ends (TBarHandle 'fire' turned upright), white L / R legends.
  for (const [s, i, u] of [
    ['L', 1, -0.19],
    ['R', 2, 0.19],
  ] as const) {
    const lc2 = s.toLowerCase();
    low.add(
      new TBarHandle(env, {
        id: `g800.fire.${lc2}`,
        label: `${s} ENG FIRE HANDLE`,
        var: i === 1 ? V.fireHandleL : V.fireHandleR,
        valueIn: 0,
        valueOut: 1,
        rotateVar: i === 1 ? V.fireRotL : V.fireRotR,
        style: 'fire',
        rotate: 'discharge',
        unlockVar: `ac.g800.fire_${lc2}_unlock`,
        lightVar: `fire.eng${i}_warn`,
        lightColor: 'red',
        legend: s,
        scale: 0.62,
      }),
      u,
      0.004,
      { rotDeg: 90 },
    );
  }
  // EMER LDG GEAR: red lit handle / placard left of centre (nitrogen blowdown, one shot).
  low.add(
    new TBarHandle(env, {
      id: 'g800.kp.emer_gear',
      label: 'EMER LDG GEAR',
      var: V.gearAlt,
      valueIn: 0,
      valueOut: 1,
      style: 'tbar',
      material: 'paintRed',
      pullLength: 0.05,
      legend: 'EMER LDG GEAR',
      lightVar: CK.annunPower,
      lightColor: 'red',
      scale: 0.75,
    }),
    -0.075,
    0.012,
  );
  // LANDING GEAR: white paddle handle (GearHandle with a small knob), green down-and-locked lights either side, red
  // transit light in the handle; LOCK RELEASE below it.
  low.add(
    new GearHandle(env, {
      id: 'g800.kp.gear',
      label: 'LANDING GEAR',
      var: V.gearHandle,
      positions: ['DN', 'UP'],
      values: [1, 0],
      initial: 0,
      length: 0.05,
      swingDeg: 28,
      knobScale: 0.6,
      labels: false,
      // Ground lock solenoid (LandingGear handleLock; LOCK RELEASE overrides it in the system).
      inhibit: (to, _from, vars) => !(to === 1 && vars.get('gear.handle_lock') !== 0),
      lights: [{ var: CK.gearRed, color: 'red' }],
    }),
    0.1,
    0.002,
  );
  const lamps: [string, number, number, number][] = [
    ['NOSE', 0, 0.1, 0.036],
    ['LEFT', 1, 0.068, 0.02],
    ['RIGHT', 2, 0.132, 0.02],
  ];
  for (const [name, i, x, y] of lamps) {
    low.add(
      new AnnunciatorLight(env, {
        id: `g800.kp.gear_lt_${name.toLowerCase()}`,
        label: `${name} GEAR`,
        width: 0.012,
        height: 0.012,
        layout: 'stack',
        segments: [{ text: '', color: 'green', var: `gear.green${i}` }],
      }),
      x,
      y,
    );
  }
  low.add(
    new PushButton(env, {
      id: 'g800.kp.dn_lock_rel',
      label: 'LOCK RELEASE',
      var: V.gearLockRel,
      mode: 'momentary',
      style: 'small',
      width: 0.009,
      capMaterial: 'knobRed',
    }),
    0.132,
    -0.022,
  );
}
