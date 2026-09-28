/**
 * Bombardier Global 6000 overhead panel (loaded by cockpit/index.ts through
 * import.meta.glob; contract in cockpit/context.ts).
 *
 * Layout transcribed from the Global Express FCOM overhead drawing
 * (CSP 700-6 01-10-41, GF0110_024; see overhead/layout.ts for the scale and
 * orientation). Aft edge (top of the drawing) to forward edge:
 *
 *   aft      FIRE DISCH handles L ENG / APU / R ENG with bottle 1 / 2 PBAs,
 *            DOME light switch (dossier 12.1 "aft edge"; EST position),
 *            TEMPERATURE COCKPIT / FWD CABIN / AFT CABIN, RECIRC / TRIM AIR /
 *            RAM AIR, AURAL WARNING IAC 1 / IAC 2 MUTED, ELT.
 *   middle   HYDRAULIC (L / R HYD SOV, pumps 1B / 3A / 3B / 2B), FUEL (WING
 *            XFER, AUX PUMP, XFEED SOV, PRI PUMP, AFT XFER, RECIRC), BLEED /
 *            AIR COND (L / R MAN TEMP, PACK CONTROL, L / R PACK, L / R ENG
 *            BLEED, XBLEED, APU BLEED), ANTI-ICE (L COWL, WING, R COWL, WING
 *            XBLEED), PRESSURIZATION (AUTO / MAN, MAN ALT, LDG ELEV, RATE,
 *            EMER DEPRESS, OUTFLOW VALVE 1 / 2 CLOSED, DITCHING), WINDSHIELD
 *            HEAT L / R.
 *   forward  ELECTRICAL (BATT MASTER, EXT AC, EXT DC, GEN 1-4, APU GEN, RAT
 *            GEN), ENGINE (IGNITION, L / R CRANK, L / R START), APU rotary,
 *            EXTERNAL LIGHTS (NAV, BEACON RED/OFF/WHT, STROBE, WING INSP,
 *            LOGO; LANDING L WING, NLG, R WING, TAXI/RECOG), PASS SIGNS (NO
 *            SMKG, SEAT BELTS) and EMER LIGHTS.
 *
 * Switchlights follow the Bombardier dark-cockpit convention (FCOM legends):
 * dark = normal, white OFF / CLOSED / MUTED / MAN / ON status legends, amber
 * FAIL. Every control writes a var that systems/** or createSystems.ts reads
 * (tests/aircraft/global6000/cockpit-overhead/coverage.test.ts). Labels and
 * position legends are backlit by the INTEGRAL OVHD dimmer (zone
 * 'panel_ovhd', systems/lighting.ts `ac.light.panel_ovhd`).
 *
 * Global Vision changes (fix round 1, photos EB190582 crops e_ovhd / e_bleed /
 * e_elec_eng / e_press_lts and N835GL top edge): CABIN SYSTEMS module (CABIN
 * OUTLETS, CABIN POWER) aft left above AURAL WARNING; AUX PRESS (clear guard)
 * between the L / R MAN TEMP HOT / COLD toggles; PACK CONTROL LO / NORM / HIGH
 * (/ MAN, GX PTG 13) rotary; ENGINE START rotary L CRANK / AUTO / R CRANK,
 * IGNITION and MODE L / R N1 / EPR toggles; EMER DC PWR (red guard) and RAT
 * GEN (clear guard) on ELECTRICAL; PRESSURIZATION order AUTO/MAN, MAN ALT,
 * LDG ELEV MAN / FMS + UP / DN, RATE, with EMER DEPRESS (yellow guard) and
 * DITCHING (clear guard); WINDSHIELD HEAT OFF/RESET - ON rotaries; LANDING
 * lights PULSE / OFF / STEADY and TAXI/RECOG WINGTIP / OFF / ON; the pressure
 * differential WARNING placard; one continuous tapered console with carbon
 * side trim and chrome gaspers at the aft corners; forward-edge fitting strip
 * with the READING LIGHT switches (map / reading lights, V.ltMap), two
 * gaspers, the STANDBY COMPASS (pull down to open) and the NO SMOKING sign.
 * The FIRE handles stay on the aft strip of the GX FCOM drawing: the Vision
 * photographs do not show that part of the overhead.
 * SCOPE: the "EMS" position of BATT MASTER and the CVR area microphone are not
 * built. The Global has no windshield wipers (no WIPER control on the FCOM
 * overhead).
 */
import * as THREE from 'three';
import { AnnunciatorLight, GuardedButton, GuardedSwitch, PushButton, RotaryKnob, SelectorKnob, TBarHandle, ToggleSwitch } from '../../../../cockpit/controls';
import type { LegendSegment } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { G6K_LIMITS } from '../../data';
import { G6K_VARS as V } from '../../vars';
import { seg, type G6kCockpitContext } from '../context';
import { MODULES, OVHD, OVHD_FWD_EDGE, px, py, SZ } from './layout';
import { gasper } from '../mainPanel';
import { g6kFinish } from '../finish';
import { CompassCard } from './compass';

/** Backlighting zone of the overhead (INTEGRAL OVHD knob, systems/lighting.ts dimmer 'panel_ovhd'). */
export const OVHD_ZONE = 'panel_ovhd';
const Z = OVHD_ZONE;

/** Cockpit-derived lamp vars for the overhead legends (display-side only; no system reads them). */
export const OH = {
  genFail: (n: 1 | 2 | 3 | 4) => `ac.g6k.ck.oh.gen${n}_fail`,
  apuGenFail: 'ac.g6k.ck.oh.apu_gen_fail',
  ratGenFail: 'ac.g6k.ck.oh.rat_gen_fail',
  xfeedFail: 'ac.g6k.ck.oh.xfeed_fail',
} as const;

type Seg = LegendSegment;

interface Ctx {
  c: G6kCockpitContext;
  p: Panel;
}

/** Group title with an engraved rule under it (FCOM panel captions), at drawing (x, y) pt. */
function title(k: Ctx, text: string, x: number, y: number, w = 60): void {
  k.p.label(text, px(x), py(y), { height: SZ.title, zone: Z, weight: 700 });
  k.p.line(px(x - w / 2), py(y) + 0.0035, px(x + w / 2), py(y) + 0.0035, 0.0004, Z);
}

/** Engraved caption at drawing (x, y) pt. */
function cap(k: Ctx, text: string, x: number, y: number, h = SZ.label): void {
  k.p.label(text, px(x), py(y), { height: h, zone: Z });
}

/** Korry switchlight at drawing (x, y) pt with its name engraved above (aft of) it. */
function pba(k: Ctx, o: { id: string; label: string; v: string; x: number; y: number; segs: Seg[]; name?: string; mode?: 'toggle' | 'momentary'; values?: [number, number] }): PushButton {
  const btn = k.p.add(
    new PushButton(k.c.env, { id: o.id, label: o.label, var: o.v, mode: o.mode ?? 'toggle', values: o.values, style: 'korry', width: SZ.pba, height: SZ.pba, layout: 'stack', segments: o.segs, zone: Z }),
    px(o.x),
    py(o.y),
  );
  if (o.name !== '') cap(k, o.name ?? o.label, o.x, o.y + 6.4);
  return btn;
}

/** Guarded switchlight (red or clear cover) at drawing (x, y) pt. */
function guardedPba(k: Ctx, o: { id: string; label: string; v: string; x: number; y: number; segs: Seg[]; name: string; color?: 'red' | 'clear' | 'black' | 'yellow'; guardVar?: string }): void {
  k.p.add(
    new GuardedButton(k.c.env, {
      id: o.id,
      label: o.label,
      var: o.v,
      mode: 'toggle',
      style: 'korry',
      width: SZ.pba,
      height: SZ.pba,
      layout: 'stack',
      segments: o.segs,
      guard: { color: o.color ?? 'red', hinge: 'top', close: 'free', var: o.guardVar },
    }),
    px(o.x),
    py(o.y),
  );
  cap(k, o.name, o.x, o.y + 7.6);
}

/** Toggle switch at drawing (x, y) pt: positions bottom (forward) -> top (aft) as engraved on the panel. */
function toggle(
  k: Ctx,
  o: { id: string; label: string; v: string; x: number; y: number; positions: string[]; values: number[]; name?: string; springs?: Record<number, number>; initial?: number; lock?: boolean },
): ToggleSwitch {
  const t = k.p.add(
    new ToggleSwitch(k.c.env, {
      id: o.id,
      label: o.label,
      var: o.v,
      positions: o.positions,
      values: o.values,
      initial: o.initial ?? 0,
      springs: o.springs,
      leverLock: o.lock ? true : undefined,
      labels: { positions: true, height: 0.0021, zone: Z },
      scale: SZ.toggle,
    }),
    px(o.x),
    py(o.y),
  );
  if (o.name) cap(k, o.name, o.x, o.y + 11.5);
  return t;
}

/** Pointer rotary selector at drawing (x, y) pt with its position legends round it and the name above. */
function knob(k: Ctx, o: { id: string; label: string; v: string; x: number; y: number; positions: { value: number; label: string; angle: number; spring?: number }[]; name?: string; initial?: number; d?: number }): void {
  k.p.add(
    new SelectorKnob(k.c.env, {
      id: o.id,
      label: o.label,
      var: o.v,
      cap: 'pointer',
      diameter: o.d ?? SZ.knob,
      labelRadius: (o.d ?? SZ.knob) * 1.2,
      labelHeight: 0.0021,
      labelZone: Z,
      positions: o.positions,
      initial: o.initial ?? 0,
    }),
    px(o.x),
    py(o.y),
  );
  if (o.name) cap(k, o.name, o.x, o.y + 13.5);
}

/** Continuous temperature knob (COLD .. HOT) at drawing (x, y) pt. */
function tempKnob(k: Ctx, o: { id: string; label: string; v: string; x: number; y: number; min: number; max: number; step: number; unit: string; name: string }): void {
  k.p.add(
    new RotaryKnob(k.c.env, {
      id: o.id,
      label: o.label,
      cap: 'pointer',
      diameter: SZ.knob,
      zone: Z,
      outer: { var: o.v, min: o.min, max: o.max, step: o.step, angleRange: [-135, 135], label: o.label, format: (x) => (o.unit ? `${x.toFixed(0)} ${o.unit}` : x <= 0.02 ? 'COLD' : x >= 0.98 ? 'HOT' : `${Math.round(x * 100)} %`) },
    }),
    px(o.x),
    py(o.y),
  );
  cap(k, 'COLD', o.x - 6.5, o.y - 7, 0.0019);
  cap(k, 'HOT', o.x + 6.5, o.y - 7, 0.0019);
  cap(k, o.name, o.x, o.y + 9, 0.0023);
}

const OFF_AUTO_ON = [
  { value: 0, label: 'OFF', angle: -60 },
  { value: 1, label: 'AUTO', angle: 0 },
  { value: 2, label: 'ON', angle: 60 },
];

export function buildOverhead(c: G6kCockpitContext): void {
  const { b, env } = c;
  // INTEGRAL OVHD back-lighting (LED edge-lit: no lag). EST gain 1.9: the overhead legends are viewed from ~0.5 m
  // further than the main panel; at 1.4 (main-panel gain) the full-bright night legends were barely legible in the
  // night screenshots.
  b.zone({ id: Z, intensityVar: 'ac.light.panel_ovhd', lagS: 0, gain: 1.9 });
  // Frame panel (no plate): every control is placed in the drawing's coordinates; the two painted modules and their
  // trim boxes up to the headliner follow the FCOM outline (layout.ts MODULES).
  const p = b.panel({
    name: 'overhead',
    center_m: OVHD.center_m,
    facing: 'down',
    tiltDeg: OVHD.tiltDeg,
    width: OVHD.width,
    height: OVHD.height,
    origin: 'top-left',
    invisible: true,
    screws: false,
  });
  // EST: Bombardier dark-grey overhead paint, a shade lighter than the glareshield (photographs).
  const paint = env.materials.custom('paint', 0x42454a, 0.6);
  for (const [name, m] of Object.entries(MODULES)) {
    const w = px(m.x1) - px(m.x0);
    const h = py(m.y1) - py(m.y0);
    const cx = (px(m.x0) + px(m.x1)) / 2;
    const cy = (py(m.y0) + py(m.y1)) / 2;
    p.subPanel({ name: `overhead_${name}`, x: cx, y: cy, z: -0.0008, width: w, height: h, material: paint, radius: 0.01, screws: { kind: 'dzus', diameter: 0.0065, inset: 0.008, pitch: 0.2 } });
    const box = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, h + (name === 'aft' ? 0.0 : 0.02), 0.12), env.materials.get('panelDark'));
    b.trackGeometry(box.geometry);
    box.userData.cockpitStatic = true;
    box.name = `overhead_box_${name}`;
    p.addObject(box, cx, cy, { z: -0.064 });
  }
  const k: Ctx = { c, p };

  // Module divisions (engraved lines between the FCOM panel modules).
  const divider = (x0: number, y0: number, x1: number, y1: number) => p.line(px(x0), py(y0), px(x1), py(y1), 0.0012, null);
  divider(228, 520, 228, 352); // HYDRAULIC / ELECTRICAL | FUEL / ENGINE
  divider(312, 580, 312, 352); // AURAL WARNING, FUEL, ENGINE | TEMPERATURE, BLEED, ANTI-ICE
  divider(415, 520, 415, 352); // BLEED | PRESSURIZATION / LIGHTS
  divider(232, 580, 412, 580); // fire handle strip
  divider(415, 440, 517, 440); // PRESSURIZATION + WINDSHIELD HEAT | EXTERNAL LIGHTS
  divider(132, 432, 228, 432); // HYDRAULIC | ELECTRICAL
  divider(228, 428, 312, 428); // FUEL | ENGINE
  divider(415, 386, 517, 386); // EXTERNAL LIGHTS | PASS SIGNS

  buildConsole(k);
  buildFittings(k);
  buildFire(k);
  buildAft(k);
  buildHydraulic(k);
  buildElectrical(k);
  buildFuel(k);
  buildEngine(k);
  buildAir(k);
  buildPress(k);
  buildLights(k);

  // ---- derived legend vars (display-side; precomputed names, no per-frame allocation)
  const vars = c.ctx.vars;
  const gens = ([1, 2, 3, 4] as const).map((n) => ({
    out: OH.genFail(n),
    tripped: `elec.gen${n}_tripped`,
    fail: `fail.elec.gen${n}`,
    sw: V.gen(n),
    run: n <= 2 ? 'eng1.running' : 'eng2.running',
  }));
  b.onUpdate(() => {
    for (let i = 0; i < gens.length; i++) {
      const g = gens[i];
      vars.set(g.out, (vars.get(g.tripped) !== 0 || vars.get(g.fail) !== 0) && vars.get(g.sw) === 1 && vars.get(g.run) !== 0 ? 1 : 0);
    }
    vars.set(OH.apuGenFail, (vars.get('elec.apu_gen_tripped') !== 0 || vars.get('fail.elec.apu_gen') !== 0) && vars.get(V.apuGen) === 1 && vars.get('apu.avail') !== 0 ? 1 : 0);
    vars.set(OH.ratGenFail, vars.get(V.ratDeployed) !== 0 && vars.get(V.ratGen) === 1 && vars.get('elec.rat_gen_online') === 0 && vars.get(V.ratDrive) > G6K_LIMITS.ratShedKias + 10 ? 1 : 0);
    vars.set(OH.xfeedFail, (vars.get(V.xfeed) === 1) !== (vars.get('fuel.xfeed_open') !== 0) && vars.get('fuel.xfeed_transit') === 0 && vars.get('elec.xfeed_valve_powered') !== 0 ? 1 : 0);
  });
}

/**
 * One continuous tapered console (photo e_ovhd): a carbon-fibre shell behind the painted modules, wider at the
 * forward edge than aft, with chrome gasper eyeballs at the aft corners and the forward fitting strip (EST outline
 * from the photograph; carbon weave not rendered).
 */
function buildConsole(k: Ctx): void {
  const { env } = k.c;
  const fin = g6kFinish(env);
  const shape = new THREE.Shape();
  const pt = (x: number, y: number) => [px(x), -py(y)] as const;
  shape.moveTo(...pt(170, 652));
  shape.lineTo(...pt(476, 652));
  shape.lineTo(...pt(528, 352));
  shape.lineTo(...pt(522, 316));
  shape.lineTo(...pt(126, 316));
  shape.lineTo(...pt(120, 352));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: false });
  g.translate(0, 0, -0.092);
  k.c.b.trackGeometry(g);
  const m = new THREE.Mesh(g, fin.carbon);
  m.userData.cockpitStatic = true;
  m.name = 'overhead_carbon';
  k.p.addObject(m, 0, 0);
  gasper(k.c, k.p, 'ovhd_aft_l', px(192), py(582), 'OVERHEAD AFT LEFT', Z);
  gasper(k.c, k.p, 'ovhd_aft_r', px(452), py(582), 'OVERHEAD AFT RIGHT', Z);
}

/**
 * Forward-edge fitting strip above the windshield (photo N835GL top edge): READING LIGHT switch at each corner (the
 * map / reading lamp beside it, V.ltMap), two gaspers, the STANDBY COMPASS (pull down to open) and the NO SMOKING
 * sign (lit from the PASS SIGNS logic, `ac.light.no_smoking`).
 */
function buildFittings(k: Ctx): void {
  const { env, b } = k.c;
  const y = 334;
  for (const n of [1, 2] as const) {
    const x = n === 1 ? 152 : 497;
    const zone = n === 1 ? 'map_l' : 'map_r';
    // Switch and lamp head straight on the carbon strip (the photo's small plate is part of the strip).
    const x0 = px(x) - 0.025;
    const y0 = py(y) - 0.018;
    k.p.label('READING LIGHT', x0 + 0.025, y0 + 0.006, { height: 0.0019, zone: Z });
    k.p.add(new ToggleSwitch(env, { id: `g6k.ovhd.reading_light${n}`, label: `${n === 1 ? 'PILOT' : 'COPILOT'} READING LIGHT`, var: V.ltMap(n), positions: ['OFF', 'ON'], values: [0, 1], labels: { positions: true, height: 0.0017, zone: Z }, scale: 0.65 }), x0 + 0.018, y0 + 0.022);
    // Lamp head (emissive lens in zone map_l / map_r).
    const lampG = env.geometry.get('g6k.maplamp', () => new THREE.CylinderGeometry(0.009, 0.011, 0.016, 16).rotateX(Math.PI / 2).translate(0, 0, 0.008));
    const lens = (env.materials.custom('gloss', 0xfff4de, 0.3) as THREE.MeshStandardMaterial).clone();
    lens.emissive = new THREE.Color(0xfff1dc);
    env.materials.track(lens);
    env.lighting.registerBacklight(lens, zone, 3);
    const lamp = new THREE.Mesh(lampG, env.materials.get('plasticBlack'));
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.0085, 16).translate(0, 0, 0.0165), lens);
    b.trackGeometry(glass.geometry);
    lamp.add(glass);
    k.p.addObject(lamp, x0 + 0.038, y0 + 0.022, { z: 0.002 });
  }
  gasper(k.c, k.p, 'ovhd_fwd_l', px(222), py(y), 'OVERHEAD FORWARD LEFT', Z);
  gasper(k.c, k.p, 'ovhd_fwd_r', px(427), py(y), 'OVERHEAD FORWARD RIGHT', Z);
  // STANDBY COMPASS: stowed in the strip; the PUSH / PULL cover toggles V.compassOpen; the card hangs below when open.
  k.p.add(
    new PushButton(env, { id: 'g6k.ovhd.compass', label: 'STANDBY COMPASS (pull down to open)', var: V.compassOpen, mode: 'toggle', style: 'key', width: 0.06, height: 0.034, capMaterial: 'plasticBlack', engraved: 'STBY COMPASS', engravedHeight: 0.0026, zone: Z }),
    px(324),
    py(y + 2),
  );
  k.p.placard({ text: 'STANDBY COMPASS\nPULL DOWN TO OPEN', height: 0.0018, style: 'plate', zone: Z }, px(356), py(y + 6));
  const fwdEdge = OVHD_FWD_EDGE();
  const face = b.panel({ name: 'stby_compass', center_m: [fwdEdge[0] - 0.02, 0, fwdEdge[2] + 0.055], facing: 'aft', tiltDeg: -8, width: 0.075, height: 0.04, material: 'plasticBlack', screws: false, radius: 0.008 });
  face.group.userData.cockpitDynamic = true;
  if (k.c.canvas !== null) face.display(new CompassCard(k.c.ctx.vars, k.c.canvas ?? undefined), 0, 0, 0.062, 0.023, { bezel: false });
  // NO SMOKING sign on the aft face of the strip (lit by the pass-sign logic).
  const sign = b.panel({ name: 'no_smoking_sign', center_m: [fwdEdge[0] - 0.004, 0, fwdEdge[2] + 0.012], facing: 'aft', width: 0.11, height: 0.018, material: 'plasticBlack', screws: false, radius: 0.003 });
  sign.add(new AnnunciatorLight(env, { id: 'g6k.ovhd.no_smoking_sign', label: 'NO SMOKING SIGN', width: 0.1, height: 0.013, segments: [seg.on('NO SMOKING', 'white', 'ac.light.no_smoking')] }), 0, 0);
  const vars = k.c.ctx.vars;
  k.c.b.onUpdate(() => {
    face.group.visible = vars.get(V.compassOpen) !== 0;
  });
}

/** FIRE DISCH handles (GXFP / FCOM 01-10-41 item 6): L ENG, APU (centre, further aft), R ENG, each with bottle 1 / 2 PBAs. */
function buildFire(k: Ctx): void {
  const { env } = k.c;
  const zones = [
    { z: 'l' as const, x: 260, y: 604, name: 'L ENG', warn: 'fire.eng1_warn' },
    { z: 'apu' as const, x: 318, y: 621, name: 'APU', warn: 'fire.apu_warn' },
    { z: 'r' as const, x: 374, y: 604, name: 'R ENG', warn: 'fire.eng2_warn' },
  ];
  for (const f of zones) {
    // Handle: pull arms the squibs and closes the fuel, hydraulic and bleed SOVs (systems/environment.ts createFire,
    // logic.ts); the red FIRE lamp in the grip follows the zone warning (and FIRE TEST).
    k.p.add(
      new TBarHandle(env, {
        id: `g6k.ovhd.fire_${f.z}`,
        label: `${f.name} FIRE DISCH HANDLE`,
        var: V.fireHandle(f.z),
        style: 'fire',
        rotate: 'none',
        lightVar: f.warn,
        legend: f.name,
        scale: 0.8,
      }),
      px(f.x),
      py(f.y),
    );
    cap(k, 'DISCH', f.x, f.y + 16);
    cap(k, 'PULL', f.x, f.y - 12);
    // Bottle 1 / 2 discharge PBAs under the DISCH legend (momentary; squib fires only with the handle pulled). The
    // amber legend shows that bottle discharged (FIRE BTL1/2 LO PRESS, GXFP).
    for (const bt of [1, 2] as const) {
      k.p.add(
        new PushButton(env, {
          id: `g6k.ovhd.fire_${f.z}_disch${bt}`,
          label: `${f.name} DISCH ${bt}`,
          var: V.fireDisch(f.z, bt),
          mode: 'momentary',
          style: 'korry',
          width: 0.011,
          height: 0.009,
          layout: 'stack',
          segments: [{ text: String(bt), color: 'amber', var: `fire.bottle${bt}_discharged` }],
          zone: Z,
        }),
        px(f.x + (bt === 1 ? -7 : 7)),
        py(f.y + 10),
      );
    }
  }
}

/** Aft strip: DOME, TEMPERATURE, RECIRC / TRIM AIR / RAM AIR, AURAL WARNING, ELT. */
function buildAft(k: Ctx): void {
  // DOME light (dossier 12.1: aft module; EST position on the fire-handle strip: the Vision photographs show CABIN
  // SYSTEMS where the GX drawing had room for it).
  toggle(k, { id: 'g6k.ovhd.dome', label: 'DOME LIGHT', v: V.ltDome, x: 402, y: 598, positions: ['OFF', 'ON'], values: [0, 1], name: 'DOME' });

  // CABIN SYSTEMS (photo e_ovhd: aft-left module above AURAL WARNING): CABIN OUTLETS and CABIN POWER PBAs.
  title(k, 'CABIN SYSTEMS', 272, 574, 70);
  pba(k, { id: 'g6k.ovhd.cabin_outlets', label: 'CABIN OUTLETS', v: V.cabinOutlets, x: 250, y: 552, segs: [seg.eq('OFF', 'white', V.cabinOutlets, 0)], name: 'CABIN OUTLETS' });
  pba(k, { id: 'g6k.ovhd.cabin_power', label: 'CABIN POWER', v: V.cabinPwr, x: 294, y: 552, segs: [seg.eq('OFF', 'white', V.cabinPwr, 0)], name: 'CABIN POWER' });

  // TEMPERATURE COCKPIT / FWD CABIN / AFT CABIN (16 .. 30 degC, dossier 5.7).
  title(k, 'TEMPERATURE', 362, 568, 80);
  const zones = [
    { z: 1 as const, x: 333, name: 'COCKPIT' },
    { z: 2 as const, x: 362, name: 'FWD CABIN' },
    { z: 3 as const, x: 393, name: 'AFT CABIN' },
  ];
  for (const t of zones) tempKnob(k, { id: `g6k.ovhd.temp${t.z}`, label: `TEMPERATURE ${t.name}`, v: V.zoneTemp(t.z), x: t.x, y: 551, min: 16, max: 30, step: 0.5, unit: 'degC', name: t.name });

  // RECIRC, TRIM AIR (OFF legends, 1 normal) and RAM AIR (guarded, ON legend).
  pba(k, { id: 'g6k.ovhd.recirc', label: 'RECIRC FANS', v: V.recircFan, x: 333, y: 526, segs: [seg.eq('OFF', 'white', V.recircFan, 0)], name: 'RECIRC' });
  pba(k, { id: 'g6k.ovhd.trim_air', label: 'TRIM AIR', v: V.trimAir, x: 362, y: 526, segs: [seg.eq('OFF', 'white', V.trimAir, 0)], name: 'TRIM AIR' });
  guardedPba(k, { id: 'g6k.ovhd.ram_air', label: 'RAM AIR', v: V.ramAir, x: 393, y: 526, segs: [seg.on('ON', 'white', V.ramAir)], name: 'RAM AIR', color: 'clear' });

  // AURAL WARNING: IAC 1 / IAC 2 MUTED (push to mute; createSystems.ts IAC aural gating).
  title(k, 'AURAL WARNING', 272, 524, 50);
  for (const n of [1, 2] as const)
    pba(k, { id: `g6k.ovhd.iac${n}_mute`, label: `AURAL WARNING IAC ${n} MUTED`, v: V.auralMute(n), x: n === 1 ? 262 : 283, y: 512, segs: [seg.on('MUTED', 'white', V.auralMute(n))], name: `IAC ${n}` });
  cap(k, 'PUSH TO MUTE', 272, 501, 0.0021);

  // ELT: ON / ARM-RESET, guarded at ARM (dossier 12.1; FCOM placard text).
  title(k, 'ELT', 195, 514, 40);
  k.p.add(
    new GuardedSwitch(k.c.env, {
      id: 'g6k.ovhd.elt',
      label: 'ELT',
      var: V.elt,
      positions: ['ARM/RESET', 'ON'],
      values: [0, 1],
      initial: 0,
      labels: { positions: true, height: 0.0021, zone: Z },
      scale: SZ.toggle,
      guard: { color: 'red', guardedPosition: 0, close: 'returns' },
    }),
    px(210),
    py(500),
  );
  k.p.label('FOR AVIATION EMER USE ONLY', px(180), py(491), { height: 0.0017, zone: Z });
  k.p.label('UNAUTHORIZED OPERATION PROHIBITED', px(180), py(488), { height: 0.0017, zone: Z });
}

/** HYDRAULIC panels (GXHY): L / R HYD SOV PBAs; pumps 1B / 3B / 2B OFF / AUTO / ON and 3A OFF / ON toggles. */
function buildHydraulic(k: Ctx): void {
  title(k, 'HYDRAULIC', 175, 480, 70);
  pba(k, { id: 'g6k.ovhd.hyd_sov_l', label: 'L HYD SOV', v: V.hydSovL, x: 152, y: 464, segs: [seg.on('CLOSED', 'white', V.hydSovL)], name: 'L HYD SOV' });
  pba(k, { id: 'g6k.ovhd.hyd_sov_r', label: 'R HYD SOV', v: V.hydSovR, x: 200, y: 464, segs: [seg.on('CLOSED', 'white', V.hydSovR)], name: 'R HYD SOV' });
  title(k, 'HYDRAULIC PUMPS', 178, 452, 76);
  const pumps: { p: '1b' | '3a' | '3b' | '2b'; x: number }[] = [
    { p: '1b', x: 148 },
    { p: '3a', x: 170 },
    { p: '3b', x: 192 },
    { p: '2b', x: 214 },
  ];
  for (const q of pumps) {
    const name = q.p.toUpperCase();
    if (q.p === '3a') toggle(k, { id: 'g6k.ovhd.hyd_3a', label: 'HYD PUMP 3A', v: V.hydPump('3a'), x: q.x, y: 438, positions: ['OFF', 'ON'], values: [0, 2], name });
    else toggle(k, { id: `g6k.ovhd.hyd_${q.p}`, label: `HYD PUMP ${name}`, v: V.hydPump(q.p), x: q.x, y: 438, positions: ['AUTO', 'OFF', 'ON'], values: [1, 0, 2], initial: 0, name });
  }
}

/** ELECTRICAL panel (GXEL): BATT MASTER, EXT AC / EXT DC, GEN 1-4, APU GEN, RAT GEN (PUSH OFF / RESET). */
function buildElectrical(k: Ctx): void {
  title(k, 'ELECTRICAL', 175, 428, 70);
  toggle(k, { id: 'g6k.ovhd.batt_master', label: 'BATT MASTER', v: V.battMaster, x: 150, y: 410, positions: ['OFF', 'ON'], values: [0, 1], name: 'BATT MASTER' });
  pba(k, { id: 'g6k.ovhd.ext_ac', label: 'EXT AC', v: V.extAc, x: 186, y: 412, segs: [seg.on('AVAIL', 'green', 'elec.ext_ac_avail'), seg.on('ON', 'white', 'elec.ext_ac_online')], name: 'EXT AC' });
  pba(k, { id: 'g6k.ovhd.ext_dc', label: 'EXT DC', v: V.extDc, x: 207, y: 412, segs: [seg.on('AVAIL', 'green', 'elec.ext_dc_avail'), seg.on('ON', 'white', 'elec.ext_dc_online')], name: 'EXT DC' });
  const gx = [147, 165, 189, 207];
  for (const n of [1, 2, 3, 4] as const)
    pba(k, { id: `g6k.ovhd.gen${n}`, label: `GEN ${n}`, v: V.gen(n), x: gx[n - 1], y: 392, segs: [seg.on('FAIL', 'amber', OH.genFail(n)), seg.eq('OFF', 'white', V.gen(n), 0)], name: `GEN ${n}` });
  cap(k, 'PUSH OFF/RESET', 177, 383, 0.0019);
  // EMER DC PWR (photo e_elec_eng: red-guarded PBA below GEN 1; the DC power emergency override, V.dcEmerOvrd).
  guardedPba(k, { id: 'g6k.ovhd.dc_emer_ovrd', label: 'EMER DC PWR', v: V.dcEmerOvrd, x: 150, y: 370, segs: [seg.on('OVRD', 'amber', V.dcEmerOvrd)], name: 'EMER DC PWR', color: 'red', guardVar: V.dcEmerOvrdGuard });
  pba(k, { id: 'g6k.ovhd.apu_gen', label: 'APU GEN', v: V.apuGen, x: 177, y: 370, segs: [seg.on('FAIL', 'amber', OH.apuGenFail), seg.eq('OFF', 'white', V.apuGen, 0)], name: 'APU GEN' });
  // RAT GEN: clear flip guard (photo e_elec_eng).
  guardedPba(k, { id: 'g6k.ovhd.rat_gen', label: 'RAT GEN', v: V.ratGen, x: 205, y: 370, segs: [seg.on('FAIL', 'amber', OH.ratGenFail), seg.eq('OFF', 'white', V.ratGen, 0)], name: 'RAT GEN', color: 'clear', guardVar: V.ratGenGuard });
}

/** FUEL panel (GXFU): WING XFER, L / R AUX PUMP, XFEED SOV, L / R PRI PUMP, AFT XFER, L / R RECIRC. */
function buildFuel(k: Ctx): void {
  // WING XFER: AUTO / OFF (FCOM) plus the manual L->R / R->L positions (dossier 12.1 values 2 / 3; EST knob angles).
  knob(k, {
    id: 'g6k.ovhd.wing_xfer',
    label: 'WING XFER',
    v: V.wingXfer,
    x: 270,
    y: 478,
    positions: [
      { value: 3, label: 'R>L', angle: -90 },
      { value: 1, label: 'AUTO', angle: 0 },
      { value: 2, label: 'L>R', angle: 90 },
      { value: 0, label: 'OFF', angle: 180 },
    ],
    name: 'WING XFER',
    initial: 1,
  });
  cap(k, 'WING FEED', 241, 492, 0.0019);
  cap(k, 'WING FEED', 297, 492, 0.0019);
  for (const s of ['l', 'r'] as const) {
    const S = s.toUpperCase();
    const x = s === 'l' ? 241 : 297;
    pba(k, { id: `g6k.ovhd.aux_${s}`, label: `${S} AUX PUMP`, v: V.auxPump(s), x, y: 475, segs: [seg.eq('OFF', 'white', V.auxPump(s), 0)], name: 'AUX PUMP' });
    pba(k, { id: `g6k.ovhd.pri_${s}`, label: `${S} PRI PUMP`, v: V.priPumps(s), x, y: 456, segs: [seg.eq('OFF', 'white', V.priPumps(s), 0)], name: 'PRI PUMP' });
    pba(k, { id: `g6k.ovhd.recirc_${s}`, label: `${S} RECIRC`, v: V.recirc(s), x, y: 437, segs: [seg.eq('OFF', 'white', V.recirc(s), 0)], name: `${S} RECIRC` });
  }
  pba(k, { id: 'g6k.ovhd.xfeed', label: 'XFEED SOV', v: V.xfeed, x: 270, y: 458, segs: [seg.on('FAIL', 'amber', OH.xfeedFail), seg.on('OPEN', 'white', 'fuel.xfeed_open')], name: 'XFEED SOV' });
  knob(k, {
    id: 'g6k.ovhd.aft_xfer',
    label: 'AFT XFER',
    v: V.aftXfer,
    x: 270,
    y: 438,
    positions: OFF_AUTO_ON,
    name: '',
    initial: 1,
  });
  cap(k, 'AFT XFER', 270, 448, 0.0023);
}

/**
 * ENGINE panel (photo e_elec_eng; GX PTG 17 "ENGINE START Selector AUTO / L-R CRANK"): START rotary L CRANK / AUTO
 * / R CRANK (auto start = ENGINE RUN ON with START at AUTO, engines.ts), IGNITION PBA (ON = continuous), MODE L / R
 * toggles N1 (up) / EPR (down); APU rotary OFF / RUN / START (spring to RUN).
 */
function buildEngine(k: Ctx): void {
  title(k, 'ENGINE', 270, 422, 50);
  knob(k, {
    id: 'g6k.ovhd.eng_start',
    label: 'ENGINE START',
    v: V.engStartSel,
    x: 246,
    y: 404,
    positions: [
      { value: -1, label: 'L CRANK', angle: -50 },
      { value: 0, label: 'AUTO', angle: 0 },
      { value: 1, label: 'R CRANK', angle: 50 },
    ],
    name: 'START',
    initial: 1,
  });
  pba(k, { id: 'g6k.ovhd.ignition', label: 'IGNITION (continuous)', v: V.ignition, x: 272, y: 405, segs: [seg.on('ON', 'white', V.ignition)], name: 'IGNITION' });
  cap(k, 'MODE', 298, 418, 0.0023);
  for (const i of [1, 2] as const) {
    const S = i === 1 ? 'L' : 'R';
    toggle(k, { id: `g6k.ovhd.eng_mode${i}`, label: `${S} ENGINE MODE N1 / EPR`, v: V.engN1Mode(i), x: i === 1 ? 291 : 305, y: 402, positions: ['EPR', 'N1'], values: [0, 1], name: S });
  }
  knob(k, {
    id: 'g6k.ovhd.apu',
    label: 'APU',
    v: V.apuSw,
    x: 270,
    y: 374,
    positions: [
      { value: 0, label: 'OFF', angle: -60 },
      { value: 1, label: 'RUN', angle: 0 },
      { value: 2, label: 'START', angle: 60, spring: 1 },
    ],
    name: 'APU',
    d: 0.017,
  });
}

/** BLEED / AIR CONDITIONING and ANTI-ICE (IAMS). */
function buildAir(k: Ctx): void {
  // L / R MAN TEMP: spring-loaded HOT (up / aft) / COLD toggles (photo e_bleed) slewing the pack manual outlet demand
  // while PACK CONTROL is at MAN (vision.ts).
  for (const s of ['l', 'r'] as const) {
    const S = s.toUpperCase();
    toggle(k, { id: `g6k.ovhd.man_temp_${s}`, label: `${S} MAN TEMP`, v: V.packManTempSw(s), x: s === 'l' ? 337 : 391, y: 503, positions: ['COLD', '', 'HOT'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, name: `${S} MAN TEMP` });
  }
  // AUX PRESS (clear guard, photo e_bleed; GX PTG 13-24 auxiliary pressurization through the trim air valves).
  guardedPba(k, { id: 'g6k.ovhd.aux_press', label: 'AUX PRESS', v: V.auxPress, x: 364, y: 503, segs: [seg.on('ON', 'white', V.auxPress)], name: 'AUX PRESS', color: 'clear', guardVar: V.auxPressGuard });
  // PACK CONTROL rotary LO / NORM / HIGH (photo) / MAN (GX PTG 13 "PACK CONTROL Selector ... NORM, LO, HIGH, MAN"; the
  // MAN position is hidden under the knob in the photograph, EST angle).
  knob(k, {
    id: 'g6k.ovhd.pack_ctl',
    label: 'PACK CONTROL',
    v: V.packFlowSel,
    x: 364,
    y: 480,
    positions: [
      { value: 0, label: 'LO', angle: -90 },
      { value: 1, label: 'NORM', angle: 0 },
      { value: 2, label: 'HIGH', angle: 90 },
      { value: 3, label: 'MAN', angle: 180 },
    ],
    name: 'PACK CONTROL',
    initial: 1,
  });
  for (const s of ['l', 'r'] as const) {
    const S = s.toUpperCase();
    pba(k, { id: `g6k.ovhd.pack_${s}`, label: `${S} PACK`, v: V.pack(s), x: s === 'l' ? 334 : 395, y: 479, segs: [seg.on('FAIL', 'amber', `pneu.pack_${s}_trip`), seg.eq('OFF', 'white', V.pack(s), 0)], name: `${S} PACK` });
    knob(k, { id: `g6k.ovhd.bleed_${s}`, label: `${S} ENG BLEED`, v: V.engBleed(s), x: s === 'l' ? 332 : 394, y: 452, positions: OFF_AUTO_ON, name: `${S} ENG BLEED`, initial: 1 });
    knob(k, { id: `g6k.ovhd.cowl_${s}`, label: `${S} COWL ANTI-ICE`, v: V.cowlAi(s), x: s === 'l' ? 332 : 394, y: 398, positions: OFF_AUTO_ON, name: `${S} COWL`, initial: 1 });
  }
  knob(k, {
    id: 'g6k.ovhd.xbleed',
    label: 'XBLEED',
    v: V.xbleed,
    x: 363,
    y: 452,
    positions: [
      { value: 0, label: 'CLSD', angle: -60 },
      { value: 1, label: 'AUTO', angle: 0 },
      { value: 2, label: 'OPEN', angle: 60 },
    ],
    name: 'XBLEED',
    initial: 1,
  });
  knob(k, { id: 'g6k.ovhd.apu_bleed', label: 'APU BLEED', v: V.apuBleed, x: 363, y: 426, positions: OFF_AUTO_ON, name: 'APU BLEED', initial: 1 });
  title(k, 'ANTI-ICE', 363, 415, 90);
  knob(k, { id: 'g6k.ovhd.wing_ai', label: 'WING ANTI-ICE', v: V.wingAi, x: 363, y: 398, positions: OFF_AUTO_ON, name: 'WING', initial: 1 });
  knob(k, {
    id: 'g6k.ovhd.wing_xbleed',
    label: 'WING XBLEED',
    v: V.wingXbleed,
    x: 363,
    y: 371,
    positions: [
      { value: 1, label: 'FROM L', angle: -60 },
      { value: 0, label: 'AUTO', angle: 0 },
      { value: 2, label: 'FROM R', angle: 60 },
    ],
    name: 'WING XBLEED',
    initial: 1,
  });
}

/** PRESSURIZATION and WINDSHIELD HEAT. */
function buildPress(k: Ctx): void {
  // Placard above the module (photo e_press_lts, red border).
  k.p.placard({ text: 'WARNING - PRESSURE DIFFERENTIAL SHALL NOT EXCEED\n0.1 PSI DURING TAXI AND 1.0 PSI ON INITIAL LANDING', height: 0.0019, style: 'warning', zone: Z }, px(466), py(532));
  title(k, 'PRESSURIZATION', 466, 514, 60);
  cap(k, 'MAN', 432, 514, 0.0026);
  cap(k, 'AUTO', 504, 514, 0.0026);
  pba(k, { id: 'g6k.ovhd.press_mode', label: 'PRESSURIZATION AUTO/MAN', v: V.pressAutoMan, x: 430, y: 496, values: [0, 2], segs: [seg.eq('MAN', 'white', V.pressAutoMan, 2)], name: 'AUTO/MAN' });
  toggle(k, { id: 'g6k.ovhd.man_alt', label: 'MAN ALT', v: V.pressManAlt, x: 449, y: 495, positions: ['DN', '', 'UP'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, name: 'MAN ALT' });
  // LDG ELEV: MAN / FMS toggle, then the UP / DN slew toggle (photo e_press_lts).
  cap(k, 'LDG ELEV', 473, 507.5, 0.0024);
  toggle(k, { id: 'g6k.ovhd.ldg_elev_fms', label: 'LDG ELEV MAN / FMS', v: V.ldgElevFms, x: 465, y: 495, positions: ['FMS', 'MAN'], values: [1, 0], initial: 0 });
  toggle(k, { id: 'g6k.ovhd.ldg_elev', label: 'LDG ELEV UP / DN', v: V.ldgElevSlew, x: 481, y: 495, positions: ['DN', '', 'UP'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 } });
  toggle(k, { id: 'g6k.ovhd.press_rate', label: 'MAN RATE', v: V.pressManRate, x: 500, y: 495, positions: ['NORM', 'HIGH'], values: [0.5, 1], name: 'RATE' });
  guardedPba(k, { id: 'g6k.ovhd.emer_depress', label: 'EMER DEPRESS', v: V.emerDepress, x: 430, y: 474, segs: [seg.on('ON', 'white', V.emerDepress)], name: 'EMER DEPRESS', color: 'yellow', guardVar: V.emerDepressGuard });
  cap(k, 'OUTFLOW VALVE', 460, 486, 0.0022);
  for (const n of [1, 2] as const)
    pba(k, { id: `g6k.ovhd.ofv${n}`, label: `OUTFLOW VALVE ${n} CLOSED`, v: V.outflowClosed(n), x: n === 1 ? 451 : 469, y: 474, segs: [seg.on('CLOSED', 'white', V.outflowClosed(n))], name: String(n) });
  guardedPba(k, { id: 'g6k.ovhd.ditching', label: 'DITCHING', v: V.ditching, x: 495, y: 474, segs: [seg.on('ON', 'white', V.ditching)], name: 'DITCHING', color: 'clear' });

  title(k, 'WINDSHIELD HEAT', 462, 461, 70);
  // L / R: OFF/RESET - ON rotaries, no lit legend (photo e_press_lts); heat status on the synoptic / CAS.
  for (const s of ['l', 'r'] as const) {
    const v = s === 'l' ? V.wshldL : V.wshldR;
    knob(k, {
      id: `g6k.ovhd.wshld_${s}`,
      label: `${s.toUpperCase()} WINDSHIELD HEAT`,
      v,
      x: s === 'l' ? 448 : 478,
      y: 447,
      positions: [
        { value: 0, label: 'OFF/RESET', angle: -35 },
        { value: 1, label: 'ON', angle: 10 },
      ],
      initial: 1,
    });
    cap(k, s.toUpperCase(), s === 'l' ? 452 : 482, 457, 0.0023);
  }
}

/** EXTERNAL LIGHTS, PASS SIGNS and EMER LIGHTS (GXLT). */
function buildLights(k: Ctx): void {
  title(k, 'EXTERNAL LIGHTS', 466, 434, 90);
  const row1: [string, string, number][] = [
    ['nav', 'NAV', 436],
    ['strobe', 'STROBE', 468],
    ['wing', 'WING INSP', 485],
    ['logo', 'LOGO', 502],
  ];
  const vOf: Record<string, string> = { nav: V.ltNav, strobe: V.ltStrobe, wing: V.ltWing, logo: V.ltLogo, ldg_l: V.ltLdgL, ldg_n: V.ltLdgNose, ldg_r: V.ltLdgR, taxi: V.ltTaxi };
  for (const [id, name, x] of row1) toggle(k, { id: `g6k.ovhd.lt_${id}`, label: `${name} LIGHTS`, v: vOf[id], x, y: 414, positions: ['OFF', 'ON'], values: [0, 1], name });
  toggle(k, { id: 'g6k.ovhd.lt_beacon', label: 'BEACON', v: V.ltBeacon, x: 452, y: 414, positions: ['RED', 'OFF', 'WHT'], values: [1, 0, 2], initial: 1, name: 'BEACON' });
  cap(k, 'LANDING', 452, 406, 0.0023);
  // LANDING L WING / NLG / R WING: PULSE (up) / OFF / STEADY (GX PTG 15-28: PULSE = 45 pulses per minute, L / R wing
  // alternately); TAXI/RECOG: WINGTIP (up) / OFF / ON (PTG 15-28, photo e_press_lts).
  const row2: [string, string, number][] = [
    ['ldg_l', 'L WING', 436],
    ['ldg_n', 'NLG', 452],
    ['ldg_r', 'R WING', 468],
  ];
  for (const [id, name, x] of row2)
    toggle(k, { id: `g6k.ovhd.lt_${id}`, label: `LANDING ${name} LIGHTS`, v: vOf[id], x, y: 391, positions: ['STEADY', 'OFF', 'PULSE'], values: [1, 0, 2], initial: 1 });
  for (const [, name, x] of row2) cap(k, name, x, 400, 0.0021);
  toggle(k, { id: 'g6k.ovhd.lt_taxi', label: 'TAXI/RECOG LIGHTS', v: vOf.taxi, x: 494, y: 391, positions: ['ON', 'OFF', 'WINGTIP'], values: [1, 0, 2], initial: 1, name: 'TAXI/RECOG' });

  title(k, 'PASS SIGNS', 445, 382, 36);
  title(k, 'EMER LIGHTS', 495, 382, 26);
  toggle(k, { id: 'g6k.ovhd.no_smoking', label: 'NO SMOKING', v: V.noSmoking, x: 437, y: 368, positions: ['AUTO', 'OFF', 'ON'], values: [1, 0, 2], initial: 0, name: 'NO SMKG' });
  toggle(k, { id: 'g6k.ovhd.seat_belts', label: 'SEAT BELTS', v: V.seatBelts, x: 454, y: 368, positions: ['AUTO', 'OFF', 'ON'], values: [1, 0, 2], initial: 0, name: 'SEAT BELTS' });
  // EMER LIGHTS: ARM / OFF / ON, guarded at ARM (dossier 12.1): closing the guard returns the switch to ARM.
  k.p.add(
    new GuardedSwitch(k.c.env, {
      id: 'g6k.ovhd.emer_lights',
      label: 'EMER LIGHTS',
      var: V.emerLights,
      positions: ['ARM', 'OFF', 'ON'],
      values: [1, 0, 2],
      initial: 0,
      labels: { positions: true, height: 0.0021, zone: Z },
      scale: SZ.toggle,
      guard: { color: 'red', guardedPosition: 0, close: 'returns' },
    }),
    px(495),
    py(366),
  );
}
