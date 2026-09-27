/**
 * Gulfstream G800 overhead panel (Symmetry flight deck), built on the overhead mount
 * (contract in ../context.ts; the ENGINE / APU FIRE handle strip at the very forward edge is
 * built by the main cockpit, layout.ts FIRE_STRIP, and this panel starts just aft of it).
 *
 * Sources:
 *  - BJT500 (Business Jet Traveler, "Pilot report: Gulfstream G500"): "The overhead panel is
 *    wonderfully clean, with three identical Esterline Korry touchscreens replacing what seems
 *    like the gazillion overhead switchlights, knobs, and buttons on the G450/G550." The three
 *    overhead panel touch screens (OHPTS) are built with the Epic suite helper `addOhpts` and
 *    host the ELEC / FUEL / HYD / ECS / ICE / LIGHTS / ENGINE pages (src/avionics/honeywell-epic
 *    logic/overhead.ts), writing the same `GULFSTREAM_OVERHEAD_VARS` the systems read.
 *  - FlightGlobal, "Analysis: Gulfstream raises super-large bar with G500" (2018; paywalled, the
 *    wording is from the search-engine excerpt, not verified against the full text): the G500 keeps
 *    "only four traditional panels: engine start, electrical power control, bleed air and cabin
 *    pressure control" besides the three OHPTS. They are built here as hardware Korry switchlights
 *    writing the SAME vars as the touch keys (a touch or a switch press has the same effect, as the
 *    Epic suite's `addOverheadSwitches` does for the G650). Legends and positions follow the
 *    GV-family (G450/G550/G650) panels of the same names (code450 checklists: ELECTRIC POWER
 *    CONTROL, ENGINE START with START MASTER / CRANK MASTER, BLEED AIR, CABIN PRESSURE CONTROL
 *    AUTO / SEMI / MANUAL). EST: exact switch arrangement from GVI/GVIII overhead photographs.
 *  - Dossier docs/aircraft/g800.md §9.7: FIRE TEST button and the manual RAT T-handle are
 *    physical overhead items.
 *  - EST (no public G800 drawing): SYSTEM TEST (FIRE TEST + LAMP TEST), EMER LTS guarded switch
 *    and the COCKPIT LIGHTS dimmers (PANEL / FLOOD, DOME, STORM) as hardware on the aft overhead,
 *    as on the GVI (G650ER overhead photograph: SYSTEM TEST, EMERGENCY POWER, FIRE TEST ...).
 *    On the G800 the lamp test is also a touch function; the hardware LAMP TEST writes the
 *    standard `alert.annun_test` var that the CAS manager and every lamp read.
 *
 * Panel convention: facing down, label "up" = aft. Coordinates (x, y) centred: x right (+y body),
 * y toward the tail. The forward end is slightly lower than the aft end.
 */
import * as THREE from 'three';
import { GuardedButton, GuardedSwitch, PushButton, RotaryKnob, SelectorKnob, TBarHandle, ToggleSwitch } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import type { LegendSegment } from '../../../../cockpit/controls/Annunciator';
import { trimBoxGeometry } from '../../../../cockpit/geometry/structure';
import { addOhpts } from '../../../../avionics/honeywell-epic/cockpit';
import { ALERT } from '../../../../core/vars';
import { G800_VARS as V } from '../../vars';
import type { G800CockpitContext } from '../context';
import { OVHD } from './layout';

/** Korry switchlight size on the overhead (EST: Esterline Korry 0.75 x 0.68 in rectangular caps, GV-family overhead). */
const KW = 0.019;
const KH = 0.017;
/** Legend heights (m): engraved control names, position legends and group titles (EST ~1/8 in, 7/64 in, 9/64 in). */
const NAME_H = 0.0032;
const POS_H = 0.0028;
const TITLE_H = 0.0036;

type Seg = LegendSegment;
/** Display-side derived lamp var (cockpit only, systems never read it): GPU connected but not on line. */
const CK_GPU_AVAIL = 'ac.g800.ck.gpu_avail';
const lit = (text: string, color: Seg['color'], varName: string, test?: (v: number) => boolean): Seg => ({ text, color, var: varName, test });
const isZero = (v: number) => v === 0;

export function buildOverhead(c: G800CockpitContext): void {
  const { b, env, suite } = c;
  const P = OVHD;

  const vars = c.ctx.vars;
  b.onUpdate(() => {
    vars.set(CK_GPU_AVAIL, vars.get('elec.gpu_avail') !== 0 && vars.get('elec.gpu_online') === 0 ? 1 : 0);
  });

  // ---- STORM light zone: one white storm flood in the overhead console aimed at the main panel
  // (EST 12 cd LED; written by systems/lighting.ts 'storm' dimmer from the STORM switch below).
  b.zone({ id: 'storm', intensityVar: 'ac.light.storm', lagS: 0, color: 0xffffff });
  env.lighting.addStormLight('storm', 'storm', [P.center_m[0] + 0.3, 0, P.center_m[2] + 0.02], [13.36, 0, -0.35], b.root, 12);

  // Panel paint: Symmetry medium-dark grey (EST from G500/G600 overhead photographs), a shade lighter than the
  // main-panel grey so the downward-facing overhead does not read black under the cabin's bounce light.
  const paint = env.materials.custom('paint', '#4a4d52', 0.62);
  const ov = b.panel({ name: 'g800.ovhd', center_m: P.center_m, facing: 'down', tiltDeg: P.tiltDeg, width: P.width, height: P.length, material: paint, screws: { kind: 'dzus', diameter: 0.007, inset: 0.009, pitch: 0.24 }, radius: 0.012 });

  // ---- structure: the overhead console body behind the panel face, closing it up to the curved headliner
  // (in the panel frame: u across, v along, n toward the crew; the body extends behind the face, -n).
  const bodyMesh = new THREE.Mesh(trimBoxGeometry(P.width + 0.03, P.length + 0.02, P.bodyDepth, 0.01), env.materials.get('panelDark'));
  bodyMesh.name = 'overhead_body';
  b.trackGeometry(bodyMesh.geometry);
  ov.addObject(bodyMesh, 0, 0, { z: -P.bodyDepth / 2 - 0.004 });

  // Engraved names above the switchlights: 3.2 mm white Gothic (EST: GV-family overhead legends ~1/8 in; the
  // control's default 2.6 mm engraving is unreadable at the ~0.9 m eye-to-overhead distance).
  const nameAbove = (panel: Panel, text: string, x: number, y: number) => panel.label(text, x, y + KH / 2 + 0.0062, { height: NAME_H, weight: 700 });
  const korry = (panel: Panel, x: number, y: number, o: ConstructorParameters<typeof PushButton>[1], name: string) => {
    nameAbove(panel, name, x, y);
    return panel.add(new PushButton(env, { style: 'korry', width: KW, height: KH, layout: 'split', ...o }), x, y);
  };

  // =============================================================== row A (forward): ELECTRIC POWER CONTROL + ENGINE START
  {
    const yA = P.rows.a;
    ov.bracket('ELECTRIC POWER CONTROL', -0.105, yA + 0.058, 0.4, { height: TITLE_H });
    const cols = [-0.28, -0.19, -0.1, -0.01, 0.08];
    const r1 = yA + 0.018;
    const r2 = yA - 0.03;
    // GV family: a generator switchlight shows amber OFF whenever its generator is not on line (dark-cockpit legend).
    korry(ov, cols[0], r1, { id: 'g800.oh.gen_l', label: 'L GEN', var: V.genL, mode: 'toggle', segments: [lit('OFF', 'amber', 'elec.idg1_online', isZero), lit('ON', 'white', V.genL)] }, 'L GEN');
    korry(ov, cols[1], r1, { id: 'g800.oh.apu_gen', label: 'APU GEN', var: V.apuGen, mode: 'toggle', segments: [lit('OFF', 'amber', 'elec.apu_gen_online', isZero), lit('ON', 'white', V.apuGen)] }, 'APU GEN');
    korry(ov, cols[2], r1, { id: 'g800.oh.gpu', label: 'GPU', var: V.gpu, mode: 'toggle', segments: [lit('AVAIL', 'white', CK_GPU_AVAIL), lit('ON', 'green', 'elec.gpu_online')] }, 'GPU');
    korry(ov, cols[3], r1, { id: 'g800.oh.gen_r', label: 'R GEN', var: V.genR, mode: 'toggle', segments: [lit('OFF', 'amber', 'elec.idg2_online', isZero), lit('ON', 'white', V.genR)] }, 'R GEN');
    korry(ov, cols[4], r1, { id: 'g800.oh.bus_tie', label: 'BUS TIE', var: V.busTie, mode: 'toggle', initial: 1, stateNames: ['OPEN', 'AUTO'], segments: [lit('OPEN', 'white', V.busTie, isZero), lit('CLOSED', 'white', 'elec.ac_tie_closed')] }, 'BUS TIE');
    korry(ov, cols[0], r2, { id: 'g800.oh.batt_l', label: 'L BATT', var: V.battL, mode: 'toggle', segments: [lit('OFF', 'white', V.battL, isZero), lit('DISCH', 'amber', 'elec.batt_l_amps', (a) => a < -8)] }, 'L BATT');
    korry(ov, cols[1], r2, { id: 'g800.oh.batt_r', label: 'R BATT', var: V.battR, mode: 'toggle', segments: [lit('OFF', 'white', V.battR, isZero), lit('DISCH', 'amber', 'elec.batt_r_amps', (a) => a < -8)] }, 'R BATT');
    // EMER PWR OFF / ARM (SCQ: the emergency batteries connect when an ESS DC bus drops below 20 V).
    ov.add(
      new GuardedButton(env, {
        id: 'g800.oh.emer_pwr',
        label: 'EMER PWR',
        var: V.emerPwr,
        mode: 'toggle',
        style: 'korry',
        width: KW,
        height: KH,
        layout: 'split',
        stateNames: ['OFF', 'ARM'],
        segments: [lit('ON', 'amber', V.ebattOn), lit('ARMED', 'white', V.emerPwr)],
        name: false,
        guard: { color: 'clear', close: 'free' },
      }),
      cols[2],
      r2,
    );
    nameAbove(ov, 'EMER PWR', cols[2], r2);
    korry(ov, cols[3], r2, { id: 'g800.oh.apu_master', label: 'APU MASTER', var: V.apuMaster, mode: 'toggle', segments: [lit('ON', 'white', V.apuMaster), lit('AVAIL', 'green', 'apu.avail')] }, 'APU MASTER');
    korry(ov, cols[4], r2, { id: 'g800.oh.apu_start', label: 'APU START', var: V.apuStart, mode: 'momentary', segments: [lit('START', 'white', 'apu.starting'), lit('FAULT', 'amber', 'apu.fault')] }, 'APU START');
    ov.line(-0.33, yA - 0.058, 0.12, yA - 0.058);

    ov.bracket('ENGINE START', 0.225, yA + 0.058, 0.2, { height: TITLE_H });
    const ec = [0.155, 0.225, 0.295];
    korry(ov, ec[0], r1, { id: 'g800.oh.start_master', label: 'START MASTER', var: V.startMaster, mode: 'toggle', segments: [lit('ON', 'white', V.startMaster)] }, 'START MSTR');
    korry(ov, ec[1], r1, { id: 'g800.oh.crank_master', label: 'CRANK MASTER', var: V.crankMaster, mode: 'toggle', segments: [lit('ON', 'white', V.crankMaster)] }, 'CRANK MSTR');
    korry(ov, ec[2], r1, { id: 'g800.oh.cont_ign', label: 'CONT IGN', var: V.contIgn, mode: 'toggle', segments: [lit('ON', 'white', V.contIgn)] }, 'CONT IGN');
    // START buttons are momentary; the FADEC runs the autostart. Legend: start (ATS) valve open.
    korry(ov, 0.175, r2, { id: 'g800.oh.start_l', label: 'L ENG START', var: V.startL, mode: 'momentary', segments: [lit('VALVE\nOPEN', 'white', 'pneu.ats_l_valve_open'), lit('ABORT', 'amber', 'fadec.eng1.abort')] }, 'L START');
    korry(ov, 0.275, r2, { id: 'g800.oh.start_r', label: 'R ENG START', var: V.startR, mode: 'momentary', segments: [lit('VALVE\nOPEN', 'white', 'pneu.ats_r_valve_open'), lit('ABORT', 'amber', 'fadec.eng2.abort')] }, 'R START');
  }

  // =============================================================== OHPTS row (three touch screens)
  {
    const y = P.rows.ohpts;
    // Recessed dark surround behind the three touch screens (the screens' own bezels come from addOhpts).
    ov.line(-0.325, y + 0.075, 0.325, y + 0.075, 0.0008);
    ov.line(-0.325, y - 0.075, 0.325, y - 0.075, 0.0008);
    if (suite) {
      for (let n = 1; n <= 3; n++) addOhpts(ov, P.ohptsX[n - 1], y, suite, n);
    }
  }

  // =============================================================== row B: BLEED AIR + CABIN PRESSURE CONTROL
  {
    const yB = P.rows.b;
    ov.bracket('BLEED AIR', -0.165, yB + 0.058, 0.3, { height: TITLE_H });
    const r1 = yB + 0.018;
    const r2 = yB - 0.03;
    korry(ov, -0.29, r1, { id: 'g800.oh.bleed_l', label: 'L ENG BLEED', var: V.bleedL, mode: 'toggle', segments: [lit('OFF', 'white', V.bleedL, isZero), lit('FAIL', 'amber', 'pneu.bleed_l_trip')] }, 'L ENG');
    korry(ov, -0.165, r1, { id: 'g800.oh.bleed_apu', label: 'APU BLEED', var: V.bleedApu, mode: 'toggle', segments: [lit('ON', 'white', V.bleedApu), lit('OPEN', 'green', 'pneu.apu_bleed_valve_open')] }, 'APU');
    korry(ov, -0.04, r1, { id: 'g800.oh.bleed_r', label: 'R ENG BLEED', var: V.bleedR, mode: 'toggle', segments: [lit('OFF', 'white', V.bleedR, isZero), lit('FAIL', 'amber', 'pneu.bleed_r_trip')] }, 'R ENG');
    // Isolation valve AUTO / OPEN / CLOSED (dossier §4.4).
    ov.add(
      new SelectorKnob(env, {
        id: 'g800.oh.iso',
        label: 'ISOLATION',
        var: V.isoValve,
        positions: [
          { value: 0, label: 'CLOSED', angle: -40 },
          { value: 1, label: 'AUTO', angle: 0 },
          { value: 2, label: 'OPEN', angle: 40 },
        ],
        initial: 1,
        diameter: 0.016,
        labelHeight: POS_H,
        title: 'ISOLATION',
      }),
      -0.225,
      r2 - 0.002,
    );
    korry(ov, -0.1, r2, { id: 'g800.oh.pack_l', label: 'L PACK', var: V.packL, mode: 'toggle', segments: [lit('OFF', 'white', V.packL, isZero), lit('FAIL', 'amber', 'pneu.pack_l_trip')] }, 'L PACK');
    korry(ov, -0.04, r2, { id: 'g800.oh.pack_r', label: 'R PACK', var: V.packR, mode: 'toggle', segments: [lit('OFF', 'white', V.packR, isZero), lit('FAIL', 'amber', 'pneu.pack_r_trip')] }, 'R PACK');
    ov.add(
      new GuardedButton(env, {
        id: 'g800.oh.ram_air',
        label: 'RAM AIR',
        var: V.ramAir,
        mode: 'toggle',
        style: 'korry',
        width: KW,
        height: KH,
        layout: 'split',
        stateNames: ['CLOSED', 'OPEN'],
        segments: [lit('OPEN', 'white', V.ramAir)],
        name: false,
        guard: { color: 'red', close: 'free' },
      }),
      -0.29,
      r2,
    );
    nameAbove(ov, 'RAM AIR', -0.29, r2);
    ov.line(-0.33, yB - 0.058, 0.0, yB - 0.058);

    ov.bracket('CABIN PRESSURE CONTROL', 0.17, yB + 0.058, 0.3, { height: TITLE_H });
    ov.add(
      new SelectorKnob(env, {
        id: 'g800.oh.press_mode',
        label: 'CABIN PRESS MODE',
        var: V.pressMode,
        positions: [
          { value: 0, label: 'AUTO', angle: -40 },
          { value: 1, label: 'SEMI', angle: 0 },
          { value: 2, label: 'MAN', angle: 40 },
        ],
        initial: 0,
        diameter: 0.016,
        labelHeight: POS_H,
        title: 'MODE',
      }),
      0.06,
      r1 - 0.012,
    );
    ov.add(
      new RotaryKnob(env, {
        id: 'g800.oh.ldg_elev',
        label: 'LDG ELEV',
        outer: { var: V.pressLdgElev, min: -1000, max: 15000, step: 100, accel: { fastStep: 1000 }, label: 'LDG ELEV', format: (v) => `${Math.round(v)} FT` },
        cap: 'knurled',
        diameter: 0.016,
        pointer: 'none',
      }),
      0.14,
      r1 - 0.012,
    );
    ov.label('LDG ELEV', 0.14, r1 - 0.036, { height: NAME_H, weight: 700 });
    ov.add(
      new ToggleSwitch(env, {
        id: 'g800.oh.press_man',
        label: 'MANUAL RATE',
        var: V.pressManual,
        positions: ['DESC', 'HOLD', 'CLIMB'],
        values: [-1, 0, 1],
        initial: 1,
        springs: { 0: 1, 2: 1 },
        labels: { name: 'MAN', positions: true, height: POS_H },
      }),
      0.215,
      r1 - 0.012,
    );
    ov.add(
      new GuardedSwitch(env, {
        id: 'g800.oh.dump',
        label: 'CABIN DUMP',
        var: V.pressDump,
        positions: ['OFF', 'DUMP'],
        guard: { color: 'red', guardedPosition: 0 },
        labels: { name: 'DUMP', positions: false, height: POS_H },
      }),
      0.29,
      r1 - 0.012,
    );
  }

  // =============================================================== row C: SYSTEM TEST, EMER LTS, COCKPIT LIGHTS, RAT
  {
    const yC = P.rows.c;
    ov.bracket('SYSTEM TEST', -0.255, yC + 0.05, 0.13, { height: TITLE_H });
    korry(ov, -0.29, yC + 0.01, { id: 'g800.oh.fire_test', label: 'FIRE TEST', var: V.fireTest, mode: 'momentary', segments: [lit('FIRE\nTEST', 'white', V.fireTest)] }, 'FIRE');
    korry(ov, -0.22, yC + 0.01, { id: 'g800.oh.lamp_test', label: 'LAMP TEST', var: ALERT.annunTest, mode: 'momentary', segments: [lit('LAMP\nTEST', 'white', ALERT.annunTest)] }, 'LAMP');

    // EMER LTS OFF / ARM / ON, guarded in ARM (EST: typical Part 25 emergency lighting switch, 14 CFR 25.812(d)).
    ov.add(
      new GuardedSwitch(env, {
        id: 'g800.oh.emer_lts',
        label: 'EMER LTS',
        var: V.ltEmer,
        positions: ['OFF', 'ARM', 'ON'],
        values: [0, 1, 2],
        initial: 1,
        guard: { color: 'red', guardedPosition: 1 },
        labels: { name: 'EMER LTS', positions: true, height: POS_H },
      }),
      -0.13,
      yC + 0.006,
    );

    ov.bracket('COCKPIT LIGHTS', 0.07, yC + 0.05, 0.28, { height: TITLE_H });
    const dimmer = (id: string, label: string, varName: string, x: number) => {
      ov.add(
        new RotaryKnob(env, {
          id,
          label,
          outer: { var: varName, min: 0, max: 1, step: 0.05, angleRange: [-135, 135], label, format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)} %`) },
          cap: 'dimmer',
          diameter: 0.017,
          pointer: 'line',
        }),
        x,
        yC + 0.006,
      );
      ov.label(label, x, yC - 0.02, { height: NAME_H, weight: 700 });
    };
    dimmer('g800.oh.panel_dim', 'PANEL', V.ltPanel, -0.04);
    dimmer('g800.oh.flood_dim', 'FLOOD', V.ltFlood, 0.03);
    ov.add(new ToggleSwitch(env, { id: 'g800.oh.dome', label: 'DOME', var: V.ltDome, positions: ['OFF', 'ON'], labels: { name: 'DOME', positions: true, height: POS_H } }), 0.1, yC + 0.006);
    ov.add(new ToggleSwitch(env, { id: 'g800.oh.storm', label: 'STORM', var: V.stormLt, positions: ['OFF', 'ON'], labels: { name: 'STORM', positions: true, height: POS_H } }), 0.165, yC + 0.006);

    // RAT manual deploy T-handle (dossier §9.7; SCQ: "manual deployment only (handle/cable)"). Same var as the touch key.
    ov.add(
      new TBarHandle(env, {
        id: 'g800.oh.rat',
        label: 'RAT DEPLOY',
        var: V.ratDeploy,
        valueIn: 0,
        valueOut: 1,
        style: 'tbar',
        material: 'knobRed',
        legend: 'RAT',
        pullLength: 0.04,
        scale: 0.85,
      }),
      0.265,
      yC + 0.004,
    );
    ov.label('RAT - PULL TO DEPLOY', 0.265, yC - 0.036, { height: POS_H });
  }

  // =============================================================== aft: placards
  ov.placard({ text: 'G800  -  OVERHEAD', height: 0.0024, style: 'engraved' }, 0, P.length / 2 - 0.02);
}
