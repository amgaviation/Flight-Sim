/**
 * Gulfstream G800 overhead panel (Symmetry flight deck), built on the overhead mount (contract in ../context.ts).
 *
 * Arrangement and hardware from the G600 flight-deck photographs (Wikimedia Commons BL7C0705, crops p_strip0-2,
 * p_elec2, p_eng, p_cb) and the G500 overhead (BL7C0670 c_ovhd); the G500 / G600 / G700 / G800 share the Symmetry
 * overhead (BJT500: "three identical Esterline Korry touchscreens replacing ... the gazillion overhead switchlights").
 * Functions of the switchlights from the code450 G700 / G800 system study sheets (electrical: BATTERIES MAIN /
 * FCS, EMERGENCY POWER ON / ARM / OFF, RAT GEN, AC / DC RESET, L / R BUS TIE AUTO; fire: APU FIRE EXT with the
 * FIRE legend next to APU CONTROL MASTER, START / STOP; powerplant: ENGINE START with its ON lamp):
 *
 *  forward strip  : EMERGENCY POWER (ON / ARM / OFF, clear guards), BATTERIES (MAIN L / R; FCS EBHA / UPS under
 *                   clear guards), COCKPIT LIGHTS (large dimmer), ENGINE START (round, ON lamp), APU FIRE EXT
 *                   (red-hatched guard, FIRE legend), APU CONTROL (MASTER, START / STOP), CABIN MASTERS
 *                   (CABIN, GALLEY);
 *  OHPTS 1 / 2    : side by side (Epic `addOhpts`);
 *  centre row     : ELECTRICAL POWER CONTROL (RAT GEN clear-guarded, RESET, L GEN, APU GEN, EXT PWR, R GEN,
 *                   L / R BUS TIE with bus flow lines), OHPTS 3, and the stack DOORS (OPEN clear-guarded, SAFETY)
 *                   | ENGINE CONTROL (L ENG, R ENG) / BLEED AIR (L ENG and R ENG clear-guarded, APU, ISOLATION,
 *                   flow lines) / CABIN PRESSURE CONTROL (FAULT / MANUAL, CABIN ALT DESCEND / HOLD / CLIMB spring
 *                   rotary, "CAUTION MAX ΔP 0.3 PSI TAKEOFF & LANDING");
 *  aft            : two chrome gasper / reading-light assemblies, then the two CB panels (breakers.ts).
 *
 * Legends are partly illegible at photo resolution: small position legends above the forward-strip switchlights are
 * EST from the study-sheet drawings. Every switchlight writes the same var as the matching OHPTS touch key (a touch or
 * a press has the same effect). Functions kept on the OHPTS pages only (no hardware in the photographs): packs, ram
 * air, isolation CLOSED, SEMI landing elevation, dump, start / crank master, continuous ignition, lighting, fire test.
 */
import * as THREE from 'three';
import { GuardedButton, PushButton, RotaryKnob, SelectorKnob } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import type { LegendSegment } from '../../../../cockpit/controls/Annunciator';
import { trimBoxGeometry } from '../../../../cockpit/geometry/structure';
import { addOhpts } from '../../../../avionics/honeywell-epic/cockpit';
import { G800_VARS as V } from '../../vars';
import type { G800CockpitContext } from '../context';
import { OVHD } from './layout';
import { buildOverheadBreakers } from './breakers';

/** Korry switchlight size on the overhead (EST: Esterline Korry 0.75 x 0.68 in caps, as in the photographs). */
const KW = 0.019;
const KH = 0.017;
/** Legend heights (m): engraved control names, group titles (EST ~1/8 in, 9/64 in). */
const NAME_H = 0.0028;
const TITLE_H = 0.0034;

type Seg = LegendSegment;
/** Display-side derived lamp vars (cockpit only, systems never read them). */
const CK = {
  gpuAvail: 'ac.g800.ck.gpu_avail',
  ebhaOn: 'ac.g800.ck.ebha_on',
  upsOn: 'ac.g800.ck.ups_on',
  autostart: 'ac.g800.ck.autostart',
  battLDis: 'ac.g800.ck.batt_l_dis',
  battRDis: 'ac.g800.ck.batt_r_dis',
};
const lit = (text: string | string[], color: Seg['color'], varName: string, test?: (v: number) => boolean): Seg => ({ text, color, var: varName, test });
const isZero = (v: number) => v === 0;

export function buildOverhead(c: G800CockpitContext): void {
  const { b, env, suite } = c;
  const P = OVHD;
  const vars = c.ctx.vars;
  b.onUpdate(() => {
    vars.set(CK.gpuAvail, vars.get('elec.gpu_avail') !== 0 && vars.get('elec.gpu_online') === 0 ? 1 : 0);
    const noAc = vars.get('elec.emer_ac_powered') === 0;
    vars.set(CK.ebhaOn, vars.get(V.fcsBattEbha) !== 0 && noAc && vars.get('elec.emer_dc_powered') !== 0 ? 1 : 0);
    vars.set(CK.upsOn, vars.get(V.fcsBattUps) !== 0 && noAc && vars.get('elec.ups_powered', vars.get('elec.fcc_powered')) !== 0 ? 1 : 0);
    vars.set(CK.autostart, vars.get('fadec.eng1.auto_starter') !== 0 || vars.get('fadec.eng2.auto_starter') !== 0 ? 1 : 0);
    // MAIN battery switchlights light while the battery discharges (powering the ESS DC buses, APU start, AUX pump).
    vars.set(CK.battLDis, vars.get(V.battL) !== 0 && vars.get('elec.batt_l_amps') < -3 ? 1 : 0);
    vars.set(CK.battRDis, vars.get(V.battR) !== 0 && vars.get('elec.batt_r_amps') < -3 ? 1 : 0);
  });

  // Panel paint: Symmetry graphite (EST from the G500 / G600 overhead photographs).
  const paint = env.materials.custom('paint', '#34373b', 0.62);
  const ov = b.panel({ name: 'g800.ovhd', center_m: P.center_m, facing: 'down', tiltDeg: P.tiltDeg, width: P.width, height: P.length, material: paint, screws: false, radius: 0.02 });

  // ---- structure: the overhead console body behind the panel face, closing it up to the curved headliner.
  const bodyMesh = new THREE.Mesh(trimBoxGeometry(P.width + 0.03, P.length + 0.02, P.bodyDepth, 0.012), env.materials.get('panelDark'));
  bodyMesh.name = 'overhead_body';
  b.trackGeometry(bodyMesh.geometry);
  ov.addObject(bodyMesh, 0, 0, { z: -P.bodyDepth / 2 - 0.004 });

  const nameAbove = (panel: Panel, text: string, x: number, y: number, up = 1) => panel.label(text, x, y + up * (KH / 2 + 0.0055), { height: NAME_H, weight: 700 });
  const korry = (panel: Panel, x: number, y: number, o: ConstructorParameters<typeof PushButton>[1], name: string | null, up = 1) => {
    if (name) nameAbove(panel, name, x, y, up);
    return panel.add(new PushButton(env, { style: 'korry', width: KW, height: KH, layout: 'split', ...o }), x, y);
  };
  const guarded = (panel: Panel, x: number, y: number, o: ConstructorParameters<typeof GuardedButton>[1], name: string | null, color: 'clear' | 'red' = 'clear', up = 1) => {
    if (name) nameAbove(panel, name, x, y, up);
    return panel.add(new GuardedButton(env, { style: 'korry', width: KW, height: KH, layout: 'split', name: false, ...o, guard: { color, close: 'free' } }), x, y);
  };

  // =============================================================== forward strip
  {
    const s = P.strip;
    const st = ov.subPanel({ name: 'g800.ovhd_strip', x: 0, y: s.v, width: P.width - 0.03, height: s.h, material: paint, thickness: 0.004, radius: 0.006 });
    const y = -0.006;
    const dx = 0.04;
    const title = (t: string, x: number, w: number) => st.label(t, x, s.h / 2 - 0.007, { height: TITLE_H, weight: 700 });
    const sep = (x: number) => st.line(x, -s.h / 2 + 0.006, x, s.h / 2 - 0.004, 0.0009);
    // EMERGENCY POWER ON / ARM / OFF (code450 G700/G800 electrical: E-batts ON with FWD / AFT lamps, ARM, OFF).
    const ep = -0.265;
    title('EMERGENCY POWER', ep, 0.1);
    const emer: [string, number, number, Seg[]][] = [
      ['ON', 2, ep - 0.03, [lit('FWD', 'amber', V.ebattOn), lit('AFT', 'amber', V.ebattOn)]],
      ['ARM', 1, ep, [lit('ARM', 'white', V.emerPwr, (v) => v === 1)]],
      ['OFF', 0, ep + 0.03, [lit('OFF', 'white', V.emerPwr, isZero)]],
    ];
    for (const [n, val, x, segs] of emer) {
      guarded(st, x, y, { id: `g800.oh.emer_${n.toLowerCase()}`, label: `EMERGENCY POWER ${n}`, var: `ac.g800.ck.emer_btn_${n.toLowerCase()}`, mode: 'momentary', segments: segs, onChange: (x) => void (x !== 0 && vars.set(V.emerPwr, val)) }, n);
    }
    sep(ep + 0.052);
    // BATTERIES: MAIN L / R, FCS EBHA / UPS (clear guards).
    const bt = -0.14;
    title('BATTERIES', bt, 0.14);
    korry(st, bt - 0.045, y, { id: 'g800.oh.batt_l', label: 'MAIN BATT L', var: V.battL, mode: 'toggle', segments: [lit('ON', 'amber', CK.battLDis)] }, 'MAIN L');
    korry(st, bt - 0.015, y, { id: 'g800.oh.batt_r', label: 'MAIN BATT R', var: V.battR, mode: 'toggle', segments: [lit('ON', 'amber', CK.battRDis)] }, 'MAIN R');
    guarded(st, bt + 0.015, y, { id: 'g800.oh.fcs_ebha', label: 'FCS BATT EBHA', var: V.fcsBattEbha, mode: 'toggle', segments: [lit('ON', 'amber', CK.ebhaOn)] }, 'EBHA');
    guarded(st, bt + 0.045, y, { id: 'g800.oh.fcs_ups', label: 'FCS BATT UPS', var: V.fcsBattUps, mode: 'toggle', segments: [lit('ON', 'amber', CK.upsOn)] }, 'UPS');
    sep(bt + 0.067);
    // COCKPIT LIGHTS: one large dimmer (panel backlighting; floods / dome on the OHPTS LIGHTS page).
    const cl = -0.045;
    title('COCKPIT LIGHTS', cl, 0.06);
    st.add(
      new RotaryKnob(env, {
        id: 'g800.oh.ckpt_lts',
        label: 'COCKPIT LIGHTS',
        outer: { var: V.ltPanel, min: 0, max: 1, step: 0.05, angleRange: [-135, 135], label: 'COCKPIT LIGHTS', format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)} %`) },
        cap: 'dimmer',
        diameter: 0.028,
        pointer: 'line',
      }),
      cl,
      y - 0.002,
    );
    sep(cl + 0.035);
    // ENGINE START (round push-button with an ON lamp; AutoStart).
    const es = 0.012;
    title('ENGINE', es, 0.04);
    st.add(
      new PushButton(env, { id: 'g800.oh.eng_start', label: 'ENGINE START', var: V.engStartBtn, mode: 'momentary', style: 'round', width: 0.02, engraved: 'START', engravedHeight: 0.0022, lightBar: { var: CK.autostart, color: 'blue' } }),
      es,
      y - 0.002,
    );
    sep(es + 0.027);
    // APU FIRE EXT (red / black hatched guard), APU CONTROL MASTER + START / STOP.
    const af = 0.063;
    title('APU FIRE EXT', af, 0.05);
    guarded(st, af, y, { id: 'g800.oh.apu_fire_ext', label: 'APU FIRE EXT', var: V.fireApuDisch, mode: 'momentary', layout: 'stack', segments: [lit('FIRE', 'red', 'fire.apu_warn')] }, null, 'red');
    sep(af + 0.025);
    const ac = 0.122;
    title('APU CONTROL', ac, 0.07);
    korry(st, ac - 0.017, y, { id: 'g800.oh.apu_master', label: 'APU MASTER', var: V.apuMaster, mode: 'toggle', segments: [lit('ON', 'white', V.apuMaster), lit('AVAIL', 'green', 'apu.avail')] }, 'MASTER');
    korry(
      st,
      ac + 0.017,
      y,
      {
        id: 'g800.oh.apu_start',
        label: 'APU START / STOP',
        var: V.apuStart,
        mode: 'momentary',
        segments: [lit('START', 'white', 'apu.starting'), lit('FAULT', 'amber', 'apu.fault')],
        // STOP: pressed with the APU running = normal shutdown (cool-down run in the APU model). EST.
        onChange: (x) => void (x !== 0 && vars.get('apu.avail') !== 0 && vars.set(V.apuMaster, 0)),
      },
      'START/STOP',
    );
    sep(ac + 0.044);
    // CABIN MASTERS: CABIN, GALLEY.
    const cm = 0.2;
    title('CABIN MASTERS', cm, 0.07);
    korry(st, cm - 0.017, y, { id: 'g800.oh.cabin_master', label: 'CABIN MASTER', var: V.cabinMaster, mode: 'toggle', segments: [lit('OFF', 'white', V.cabinMaster, isZero)] }, 'CABIN');
    korry(st, cm + 0.017, y, { id: 'g800.oh.galley_master', label: 'GALLEY MASTER', var: V.galleyMaster, mode: 'toggle', segments: [lit('OFF', 'white', V.galleyMaster, isZero)] }, 'GALLEY');
    void dx;
    // Gaspers under the strip (forward lip), EST positions.
    for (const u of [-0.28, 0.28]) addGasper(c, ov, u, s.v + 0.005, 0.016, false);
  }

  // =============================================================== OHPTS 1 / 2 / 3
  if (suite) for (let n = 1; n <= 3; n++) addOhpts(ov, P.ohpts[n - 1][0], P.ohpts[n - 1][1], suite, n);

  // =============================================================== ELECTRICAL POWER CONTROL (left of OHPTS 3)
  {
    const e = P.elec;
    const ep = ov.subPanel({ name: 'g800.ovhd_elec', x: e.u, y: e.v, width: e.w, height: e.h, material: paint, thickness: 0.004, radius: 0.006 });
    ep.label('ELECTRICAL POWER CONTROL', 0, e.h / 2 - 0.012, { height: TITLE_H, weight: 700 });
    ep.line(-e.w / 2 + 0.01, e.h / 2 - 0.004, e.w / 2 - 0.01, e.h / 2 - 0.004, 0.0009);
    const r1 = 0.036;
    const r2 = -0.006;
    const r3 = -0.05;
    guarded(ep, -0.05, r1, { id: 'g800.oh.rat_gen', label: 'RAT GEN', var: V.ratGen, mode: 'toggle', initial: 1, stateNames: ['OFF', 'AUTO'], segments: [lit('OFF', 'amber', V.ratGen, isZero), lit('ON', 'white', 'ac.g800.rat_mode')] }, 'RAT GEN');
    ep.line(0.0, r1 + 0.02, -0.012, r1 - 0.02, 0.0009);
    korry(ep, 0.05, r1, { id: 'g800.oh.elec_reset', label: 'AC / DC RESET', var: V.elecReset, mode: 'momentary', segments: [lit('AC', 'white', V.elecReset), lit('DC', 'white', V.elecReset)] }, 'RESET');
    const gx = [-0.072, -0.024, 0.024, 0.072];
    // Generator switchlights: amber OFF when not on line (pushed out or tripped), green ON on line (code450 G700/G800).
    korry(ep, gx[0], r2, { id: 'g800.oh.gen_l', label: 'L GEN', var: V.genL, mode: 'toggle', segments: [lit('ON', 'green', 'elec.idg1_online'), lit('OFF', 'amber', 'elec.idg1_online', isZero)] }, 'L GEN');
    korry(ep, gx[1], r2, { id: 'g800.oh.apu_gen', label: 'APU GEN', var: V.apuGen, mode: 'toggle', segments: [lit('ON', 'green', 'elec.apu_gen_online'), lit('OFF', 'amber', V.apuGenOffLt)] }, 'APU GEN'); // dark cockpit: OFF only with the APU available and the generator off line
    korry(ep, gx[2], r2, { id: 'g800.oh.gpu', label: 'EXT PWR', var: V.gpu, mode: 'toggle', segments: [lit('AVAIL', 'blue', CK.gpuAvail), lit('ON', 'amber', 'elec.gpu_online')] }, 'EXT PWR');
    korry(ep, gx[3], r2, { id: 'g800.oh.gen_r', label: 'R GEN', var: V.genR, mode: 'toggle', segments: [lit('ON', 'green', 'elec.idg2_online'), lit('OFF', 'amber', 'elec.idg2_online', isZero)] }, 'R GEN');
    // L / R BUS TIE (blue AUTO), names below the switchlights as in the photograph; bus flow lines.
    korry(ep, -0.06, r3, { id: 'g800.oh.bus_tie_l', label: 'L BUS TIE', var: V.busTieL, mode: 'toggle', initial: 1, stateNames: ['OPEN', 'AUTO'], segments: [lit('AUTO', 'blue', V.busTieL), lit('OPEN', 'white', V.busTieL, isZero)] }, 'L BUS TIE', -1);
    korry(ep, 0.06, r3, { id: 'g800.oh.bus_tie_r', label: 'R BUS TIE', var: V.busTieR, mode: 'toggle', initial: 1, stateNames: ['OPEN', 'AUTO'], segments: [lit('AUTO', 'blue', V.busTieR), lit('OPEN', 'white', V.busTieR, isZero)] }, 'R BUS TIE', -1);
    ep.line(-0.06 + KW / 2, r3, 0.06 - KW / 2, r3, 0.0012);
    for (const x of gx) ep.line(x, r2 - KH / 2, x, r3 + (Math.abs(x) > 0.05 ? KH / 2 : 0), 0.0012);
  }

  // =============================================================== DOORS | ENGINE CONTROL / BLEED AIR / CABIN PRESSURE CONTROL
  {
    const k = P.stack;
    const sp = ov.subPanel({ name: 'g800.ovhd_stack', x: k.u, y: k.v, width: k.w, height: k.h, material: paint, thickness: 0.004, radius: 0.006 });
    // DOORS (aft-left) and ENGINE CONTROL (aft-right).
    const yd = 0.088;
    sp.label('DOORS', -0.05, yd + 0.03, { height: TITLE_H, weight: 700 });
    guarded(sp, -0.07, yd, { id: 'g800.oh.door_open', label: 'MAIN DOOR OPEN', var: V.doorOpenCmd, mode: 'toggle', stateNames: ['CLOSE', 'OPEN'], layout: 'stack', segments: [lit('OPEN', 'amber', 'ac.door.main', (x) => x > 0.02)] }, 'OPEN');
    korry(sp, -0.03, yd, { id: 'g800.oh.door_safety', label: 'DOOR SAFETY', var: V.doorSafety, mode: 'toggle', layout: 'stack', segments: [lit('ON', 'amber', V.doorSafety)] }, 'SAFETY');
    sp.line(-0.004, yd - 0.018, 0.004, yd + 0.036, 0.0012);
    sp.label('ENGINE CONTROL', 0.055, yd + 0.03, { height: TITLE_H, weight: 700 });
    for (const [i, x] of [
      [1, 0.035],
      [2, 0.075],
    ] as const) {
      korry(sp, x, yd, { id: `g800.oh.eng_ctl_${i === 1 ? 'l' : 'r'}`, label: `ENGINE CONTROL ${i === 1 ? 'L' : 'R'} ENG`, var: V.engAlt(i), mode: 'toggle', stateNames: ['EPR', 'ALT'], layout: 'stack', segments: [lit('ALT', 'white', V.engAlt(i))] }, i === 1 ? 'L ENG' : 'R ENG');
    }
    sp.line(-k.w / 2 + 0.01, 0.058, k.w / 2 - 0.01, 0.058, 0.0009);
    // BLEED AIR: L / R ENG under clear guards (amber OFF), APU, ISOLATION, flow lines.
    const yb = 0.018;
    sp.label('BLEED AIR', 0, 0.047, { height: TITLE_H, weight: 700 });
    guarded(sp, -0.06, yb, { id: 'g800.oh.bleed_l', label: 'L ENG BLEED', var: V.bleedL, mode: 'toggle', segments: [lit('OFF', 'amber', V.bleedL, isZero), lit('FAIL', 'amber', 'pneu.bleed_l_trip')] }, 'L ENG');
    korry(sp, 0, yb, { id: 'g800.oh.bleed_apu', label: 'APU BLEED', var: V.bleedApu, mode: 'toggle', segments: [lit('ON', 'white', V.bleedApu), lit('OPEN', 'green', 'pneu.apu_bleed_valve_open')] }, 'APU');
    guarded(sp, 0.06, yb, { id: 'g800.oh.bleed_r', label: 'R ENG BLEED', var: V.bleedR, mode: 'toggle', segments: [lit('OFF', 'amber', V.bleedR, isZero), lit('FAIL', 'amber', 'pneu.bleed_r_trip')] }, 'R ENG');
    // ISOLATION: AUTO / OPEN (CLOSED only on the OHPTS ECS page, SCOPE).
    korry(sp, 0, yb - 0.04, { id: 'g800.oh.iso', label: 'ISOLATION', var: V.isoValve, mode: 'toggle', values: [1, 2], initial: 1, stateNames: ['AUTO', 'OPEN'], segments: [lit('OPEN', 'white', 'pneu.iso_open')] }, 'ISOLATION');
    const lw = 0.0012;
    sp.line(-0.06, yb - KH / 2, -0.06, yb - 0.04, lw);
    sp.line(-0.06, yb - 0.04, -KW / 2, yb - 0.04, lw);
    sp.line(0.06, yb - KH / 2, 0.06, yb - 0.04, lw);
    sp.line(0.06, yb - 0.04, KW / 2, yb - 0.04, lw);
    sp.line(0, yb - KH / 2, 0, yb - 0.024, lw);
    sp.line(0, yb - 0.024, 0.06, yb - 0.024, lw);
    sp.line(-k.w / 2 + 0.01, -0.052, k.w / 2 - 0.01, -0.052, 0.0009);
    // CABIN PRESSURE CONTROL: FAULT / MANUAL (AUTO <-> MANUAL), CABIN ALT DESCEND / HOLD / CLIMB (spring to HOLD).
    sp.label('CABIN PRESSURE CONTROL', 0, -0.064, { height: TITLE_H, weight: 700 });
    korry(sp, -0.055, -0.093, { id: 'g800.oh.press_mode', label: 'CABIN PRESSURE FAULT / MANUAL', var: V.pressMode, mode: 'toggle', values: [0, 2], stateNames: ['AUTO', 'MANUAL'], segments: [lit('FAULT', 'amber', 'press.auto_fail'), lit('MANUAL', 'white', V.pressMode, (x) => x === 2)] }, 'FAULT/MANUAL');
    sp.label('CAUTION\nMAX ΔP 0.3 PSI\nTAKEOFF & LANDING', -0.055, -0.113, { height: 0.0021, weight: 700, anchor: 'top' });
    sp.add(
      new SelectorKnob(env, {
        id: 'g800.oh.cabin_alt',
        label: 'CABIN ALT',
        var: V.pressManual,
        positions: [
          { value: -1, label: 'DESCEND', angle: -45, spring: 1 },
          { value: 0, label: 'HOLD', angle: 0 },
          { value: 1, label: 'CLIMB', angle: 45, spring: 1 },
        ],
        initial: 1,
        cap: 'bar',
        diameter: 0.02,
        labelHeight: 0.0024,
        title: 'CABIN ALT',
      }),
      0.045,
      -0.102,
    );
  }

  // =============================================================== gasper / reading-light assemblies
  for (const u of [-P.gasperU, P.gasperU]) addGasper(c, ov, u, P.gasperV, 0.03, true);

  // =============================================================== CB panels (aft)
  buildOverheadBreakers(c, ov, paint);
}

/**
 * Chrome eyeball gasper (and, for the large aft assemblies, a reading-light lens beside it): structure only
 * (SCOPE: air outlets and the reading lights are not modelled; the reading lights share the 'flood' zone look).
 */
function addGasper(c: G800CockpitContext, panel: Panel, u: number, v: number, r: number, reading: boolean): void {
  const { b, env } = c;
  const geo = env.geometry.get(`g800.gasper.${r}`, () => {
    const ring = new THREE.CylinderGeometry(r, r * 1.08, r * 0.35, 28);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, 0, r * 0.17);
    return ring;
  });
  const ball = env.geometry.get(`g800.gasper_ball.${r}`, () => new THREE.SphereGeometry(r * 0.62, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, r * 0.2));
  const g = new THREE.Group();
  const m1 = new THREE.Mesh(geo, env.materials.get('chrome'));
  const m2 = new THREE.Mesh(ball, env.materials.get('chrome'));
  g.add(m1, m2);
  if (reading) {
    const lens = new THREE.Mesh(env.geometry.get('g800.reading_lens', () => new THREE.CircleGeometry(r * 0.55, 20).translate(0, 0, 0.004)), env.materials.get('plasticBlack'));
    lens.position.x = u < 0 ? r * 1.6 : -r * 1.6;
    const bezel = new THREE.Mesh(geo, env.materials.get('chrome'));
    bezel.scale.setScalar(0.7);
    bezel.position.x = lens.position.x;
    g.add(bezel, lens);
  }
  for (const o of g.children) o.userData.cockpitStatic = true;
  panel.addObject(g, u, v);
  void b;
}
