/**
 * Citation M2 main instrument panel and centre glareshield panel.
 *
 * S&D15 §10.2 (Oct 2015 Rev A):
 *  A. Centre glareshield panel: LH and RH MASTER CAUTION / MASTER WARNING
 *     lights, LH and RH ENGINE FIRE control switches, reversionary and
 *     dimming controls, flight director / autopilot controller (GMC 710),
 *     electronic standby instrument (ESI-1000), LH and RH display control
 *     units.
 *  B. Instrument panel (left to right): electrical power panel, LH PFD, MFD,
 *     RH PFD (three GDU 1400W, 14.1 in, 1280 x 800).
 * Layout positions within each panel are EST from the S&D Figure III
 * photograph (docs/aircraft/citation-m2.md §9); control names / positions
 * where the M2 documents are silent follow the CJ family (dossier EST).
 * Every control writes the `ac.m2.*` / `g3k.*` vars or emits the G3000 /
 * CAS events that the systems consume (tests/aircraft/citation-m2/cockpit-main).
 */
import * as THREE from 'three';
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import type { CockpitDisplay } from '../../../cockpit/types';
import type { MaterialName } from '../../../cockpit/materials';
import { AnnunciatorLight, KeyPad, PushButton, RotaryKnob, Thumbwheel, ToggleSwitch } from '../../../cockpit/controls';
import { plateGeometry } from '../../../cockpit/geometry/structure';
import { ALERT } from '../../../core/vars';
import { G3K, G3K_EVENTS } from '../../../avionics/garmin-g3000/vars';
import type { GduId } from '../../../avionics/garmin-g3000/vars';
import { M2 } from '../vars';
import { M2_LIMITS } from '../data';
import { GDU, GLARE_PANEL, MAIN } from './layout';
import { ESI_VARS } from './displays';

const inc = (e: string) => `${e}_inc`;
const dec = (e: string) => `${e}_dec`;

/** A display stand-in for headless builds (no canvas): keeps the screen mesh and bezel. */
export class NullDisplay implements CockpitDisplay {
  readonly canvas = { width: 4, height: 4 } as unknown as HTMLCanvasElement;
  readonly width = 4;
  readonly height = 4;
  readonly refreshHz = 1;
  constructor(readonly id: string) {}
  render(): boolean {
    return false;
  }
}

export interface PanelCtx {
  b: CockpitBuilder;
  displays: Map<string, CockpitDisplay>;
}

function disp(c: PanelCtx, id: string): CockpitDisplay {
  return c.displays.get(id) ?? new NullDisplay(id);
}

/** A flat trim plate (static) on a panel. */
function plate(c: PanelCtx, p: Panel, x: number, y: number, w: number, h: number, material: MaterialName = 'bezel', z = 0.0005): THREE.Mesh {
  const env = c.b.env;
  const m = new THREE.Mesh(env.geometry.get(`m2.plate.${w.toFixed(4)}.${h.toFixed(4)}`, () => plateGeometry(w, h, 0.002, 0.003)), env.materials.get(material));
  m.userData.cockpitStatic = true;
  return p.addObject(m, x, y, { z });
}

// =============================================================================== main instrument panel

export function buildMainPanel(c: PanelCtx): void {
  const b = c.b;
  const env = b.env;
  const main = b.panel({
    name: 'm2.main',
    center_m: MAIN.center,
    facing: 'aft',
    tiltDeg: MAIN.tiltDeg,
    width: MAIN.width,
    height: MAIN.height,
    origin: 'top-left',
    screws: false,
    material: 'panel',
  });

  // --- Three GDU 1400W (PFD1, MFD, PFD2) with 12 bezel softkeys each (PG Figure 1-2).
  const [bl, br, bt, bb] = GDU.border;
  const screenCy = GDU.top + bt + GDU.screenH / 2;
  const gdus: [GduId, number][] = [
    ['pfd1', GDU.xPfd1],
    ['mfd', GDU.xMfd],
    ['pfd2', GDU.xPfd2],
  ];
  for (const [id, cx] of gdus) {
    const sx = cx; // bezel borders left / right differ by 0.1 mm
    main.display(disp(c, id), sx, screenCy, GDU.screenW, GDU.screenH, { bezel: { border: [bl, br, bt, bb], depth: 0.012, material: 'bezel' }, display: { boot: false } });
    main.label('GARMIN', sx, GDU.top + 0.0072, { height: 0.0028, weight: 700, color: '#b8bcc2', zone: null });
    // SD card slots (upper: database, lower: terrain/charts, S&D15 §10.3.K / S) on the right bezel.
    for (const dy of [0.05, 0.09]) plate(c, main, sx + GDU.screenW / 2 + 0.0125, GDU.top + dy, 0.004, 0.028, 'plasticBlack', 0.012);
    const keyW = 0.0165;
    const gap = (GDU.screenW - 12 * keyW) / 11;
    main.add(
      new KeyPad(env, {
        id: `m2.${id}.softkeys`,
        label: `${id.toUpperCase()} SOFTKEYS`,
        eventPrefix: `g3k.${id}.sk`,
        rows: [Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), label: '' }))],
        keyWidth: keyW,
        keyHeight: 0.0085,
        gap,
        keyMaterial: 'plasticBlack',
      }),
      sx - GDU.screenW / 2,
      GDU.top + bt + GDU.screenH + 0.0095,
      { z: 0.012 },
    );
  }

  // --- Electrical power panel (LH edge of the instrument panel, S&D15 §10.2.B / §9.4 "LH power switch panel").
  const ep = main.subPanel({ name: 'm2.elec', x: 0.068, y: 0.125, width: 0.118, height: 0.232, origin: 'top-left', material: 'panel', screws: { kind: 'dzus', diameter: 0.007, positions: [[0.008, 0.008], [0.11, 0.008], [0.008, 0.224], [0.11, 0.224]] } });
  ep.label('ELECTRICAL POWER', 0.059, 0.02, { height: 0.0028 });
  ep.line(0.01, 0.028, 0.108, 0.028);
  ep.add(
    new ToggleSwitch(env, {
      id: 'm2.elec.batt',
      var: M2.battSw,
      label: 'BATTERY',
      positions: ['EMER', 'OFF', 'BATT'],
      values: [-1, 0, 1],
      initial: 1,
      leverLock: [2],
      handle: 'lever-lock',
      labels: { name: 'BATTERY', positions: true },
    }),
    0.035,
    0.07,
  );
  ep.add(
    new ToggleSwitch(env, {
      id: 'm2.elec.avionics',
      var: M2.avionicsSw,
      label: 'AVIONICS',
      positions: ['DISPATCH', 'OFF', 'ON'],
      values: [-1, 0, 1],
      initial: 1,
      labels: { name: 'AVIONICS', positions: true },
    }),
    0.085,
    0.07,
  );
  ep.label('GENERATOR', 0.059, 0.118, { height: 0.0026 });
  for (const [i, x] of [
    [1, 0.035],
    [2, 0.085],
  ] as const) {
    ep.add(
      new ToggleSwitch(env, {
        id: `m2.elec.gen${i}`,
        var: M2.genSw(i),
        label: `${i === 1 ? 'L' : 'R'} GEN`,
        positions: ['RESET', 'OFF', 'GEN'],
        values: [-1, 0, 1],
        initial: 1,
        springs: { 0: 1 },
        labels: { name: i === 1 ? 'L' : 'R', positions: true },
      }),
      x,
      0.165,
    );
  }
  ep.label('VOLTS / AMPS ON MFD', 0.059, 0.215, { height: 0.0021, weight: 600 });

  // --- RH edge: placards (TCDS §10 / FPG limitations).
  const rx = 1.295;
  main.placard({ text: 'CITATION M2', height: 0.0042, style: 'engraved' }, rx, 0.03);
  main.placard({ text: `VMO ${M2_LIMITS.vmoKt} KIAS\nMMO ${M2_LIMITS.mmo.toFixed(2)} MI\nABOVE 30,500 FT`, height: 0.0026, style: 'plate', align: 'center' }, rx, 0.075);
  main.placard({ text: `VLO EXT ${M2_LIMITS.vloExtendKt}\nVLO RET ${M2_LIMITS.vloRetractKt}\nVLE ${M2_LIMITS.vleKt} KIAS`, height: 0.0026, style: 'plate', align: 'center' }, rx, 0.125);
  main.placard({ text: `FLAPS 15  ${M2_LIMITS.vfe15Kt}\nFLAPS 35  ${M2_LIMITS.vfe35Kt}\nKIAS`, height: 0.0026, style: 'plate', align: 'center' }, rx, 0.175);
  main.placard({ text: 'NO SMOKING', height: 0.0026, style: 'plate' }, rx, 0.22);
}

// =============================================================================== centre glareshield panel

function gmcKey(env: CockpitBuilder['env'], key: string, label: string): PushButton {
  return new PushButton(env, {
    id: `m2.gmc.key.${key}`,
    label: `GMC ${label}`,
    style: 'key',
    width: 0.0155,
    height: 0.0105,
    event: G3K_EVENTS.gmcKey(key),
    engraved: label,
    engravedHeight: 0.0026,
    lightBar: { var: G3K.gmcLight(key), color: 'green' },
    capMaterial: 'plasticBlack',
  });
}

function encoderKnob(env: CockpitBuilder['env'], id: string, label: string, base: string, push: string | undefined, d: number, cap: 'fluted' | 'knurled' = 'fluted'): RotaryKnob {
  return new RotaryKnob(env, {
    id,
    label,
    cap,
    diameter: d,
    height: 0.012,
    outer: { incEvent: inc(base), decEvent: dec(base), label },
    push: push ? { event: push, label: 'PUSH' } : undefined,
  });
}

export function buildGlareshieldPanel(c: PanelCtx): void {
  const b = c.b;
  const env = b.env;
  const gp = b.panel({
    name: 'm2.glare',
    center_m: GLARE_PANEL.center,
    facing: 'aft',
    tiltDeg: GLARE_PANEL.tiltDeg,
    width: GLARE_PANEL.width,
    height: GLARE_PANEL.height,
    origin: 'top-left',
    screws: false,
    material: 'panel',
  });
  const W = GLARE_PANEL.width;
  const mid = W / 2;

  // --- MASTER WARNING / MASTER CAUTION, outboard on each side (S&D15 §10.2.A; CAS acknowledge, S&D15 §10.3.E).
  for (const side of [1, 2] as const) {
    const x0 = side === 1 ? 0.045 : W - 0.085;
    gp.add(
      new PushButton(env, {
        id: `m2.mw${side}`,
        label: 'MASTER WARNING',
        style: 'korry',
        width: 0.026,
        height: 0.02,
        mode: 'momentary',
        event: 'cas.ack_warning',
        segments: [{ text: ['MASTER', 'WARNING'], color: 'red', var: ALERT.masterWarning, style: 'field' }],
      }),
      x0,
      0.055,
    );
    gp.add(
      new PushButton(env, {
        id: `m2.mc${side}`,
        label: 'MASTER CAUTION',
        style: 'korry',
        width: 0.026,
        height: 0.02,
        mode: 'momentary',
        event: 'cas.ack_caution',
        segments: [{ text: ['MASTER', 'CAUTION'], color: 'amber', var: ALERT.masterCaution, style: 'field' }],
      }),
      x0 + 0.032,
      0.055,
    );
  }

  // --- Display control units (LH above PFD1, RH above PFD2): BARO (push STD), MINS (push mode), RANGE.
  for (const s of [1, 2] as const) {
    const cx = mid + (s === 1 ? -0.365 : 0.365);
    const dcu = gp.subPanel({ name: `m2.dcu${s}`, x: cx, y: 0.052, width: 0.13, height: 0.05, origin: 'top-left', material: 'bezel', screws: false });
    const knobs: [string, string, string, string | undefined, number][] = [
      ['baro', 'BARO', G3K_EVENTS.baroTurn(s), G3K_EVENTS.baroPush(s), 0.025],
      ['mins', 'MINS', G3K_EVENTS.minsTurn(s), G3K_EVENTS.minsPush(s), 0.065],
      ['range', 'RANGE', G3K_EVENTS.rangeTurn(s), undefined, 0.105],
    ];
    for (const [k, lab, base, push, x] of knobs) {
      dcu.add(encoderKnob(env, `m2.dcu${s}.${k}`, `${lab} ${s}`, base, push, 0.017, k === 'baro' ? 'knurled' : 'fluted'), x, 0.029);
      dcu.label(lab, x, 0.0085, { height: 0.0025 });
    }
    dcu.label('PUSH STD', 0.025, 0.046, { height: 0.0018, weight: 600 });
  }

  // --- ESI-1000 standby instrument (L-3 bezel 3 x 4 in, 3.7 in LCD, four bezel buttons), left of the GMC 710.
  {
    const ex = mid - 0.218;
    const esi = gp.subPanel({ name: 'm2.esi', x: ex, y: 0.05, width: 0.0762, height: 0.0985, origin: 'top-left', material: 'bezel', screws: false, z: 0.004 });
    esi.display(disp(c, 'esi'), 0.0381, 0.042, 0.0564, 0.0752 * 0.94, { bezel: false, z: 0.002, display: { boot: false } });
    // Four bezel buttons (S&D15 §10.3.U): momentary vars handled by the ESI controller subsystem (esi.ts).
    ['BARO -', 'BARO +', 'STD', 'BRT'].forEach((lab, i) => {
      esi.add(
        new PushButton(env, { id: `m2.esi.b${i + 1}`, label: `ESI ${lab}`, style: 'small', width: 0.0095, mode: 'momentary', var: ESI_VARS.button(i + 1), capMaterial: 'plasticGrey' }),
        0.012 + i * 0.0174,
        0.089,
      );
    });
  }

  // --- GMC 710 AFCS mode controller (S&D15 §10.3.L), centred. Keys light green when the mode / function is on.
  const gmc = gp.subPanel({ name: 'm2.gmc', x: mid, y: 0.04, width: 0.33, height: 0.056, origin: 'top-left', material: 'bezel', screws: false, z: 0.003 });
  const R1 = 0.017;
  const R2 = 0.04;
  gmc.add(gmcKey(env, 'FD', 'FD'), 0.014, 0.028);
  gmc.add(encoderKnob(env, 'm2.gmc.crs1', 'CRS1', G3K_EVENTS.crsTurn(1), G3K_EVENTS.crsPush(1), 0.019), 0.039, 0.028);
  gmc.label('CRS1', 0.039, 0.0075, { height: 0.0024 });
  gmc.add(encoderKnob(env, 'm2.gmc.hdg', 'HDG', G3K_EVENTS.hdgTurn, G3K_EVENTS.hdgPush, 0.022), 0.069, 0.028);
  gmc.label('HDG', 0.069, 0.0075, { height: 0.0024 });
  const keys: [string, string, number, number][] = [
    ['HDG', 'HDG', 0.096, R1],
    ['APR', 'APR', 0.117, R1],
    ['NAV', 'NAV', 0.096, R2],
    ['BC', 'BC', 0.117, R2],
    ['BANK', 'BANK', 0.139, (R1 + R2) / 2],
    ['AP', 'AP', 0.158, R1],
    ['YD', 'YD', 0.18, R1],
    ['XFR', 'XFR', 0.169, R2],
    ['VS', 'VS', 0.206, R1],
    ['FLC', 'FLC', 0.227, R1],
    ['ALT', 'ALT', 0.206, R2],
    ['VNAV', 'VNV', 0.227, R2],
    ['SPD', 'SPD', 0.248, R2],
  ];
  for (const [k, lab, x, y] of keys) gmc.add(gmcKey(env, k, lab), x, y);
  // XFR coupled-side arrows (G3K lights xfr_l / xfr_r).
  gmc.add(new AnnunciatorLight(env, { id: 'm2.gmc.xfr_l', label: 'XFR LEFT', width: 0.005, height: 0.004, bezel: false, segments: [{ text: '', color: 'green', var: G3K.gmcLight('xfr_l') }] }), 0.158, R2);
  gmc.add(new AnnunciatorLight(env, { id: 'm2.gmc.xfr_r', label: 'XFR RIGHT', width: 0.005, height: 0.004, bezel: false, segments: [{ text: '', color: 'green', var: G3K.gmcLight('xfr_r') }] }), 0.18, R2);
  gmc.add(
    new Thumbwheel(env, {
      id: 'm2.gmc.nose',
      label: 'NOSE UP / DN',
      diameter: 0.03,
      width: 0.01,
      exposure: 0.25,
      orientation: 'vertical',
      // Rolling the top of the wheel away (mouse wheel up) = NOSE DN; toward the pilot = NOSE UP (+ clicks, vars.ts).
      channel: { incEvent: dec(G3K_EVENTS.noseWheel), decEvent: inc(G3K_EVENTS.noseWheel), label: 'NOSE' },
    }),
    0.263,
    0.028,
  );
  gmc.label('DN', 0.263, 0.007, { height: 0.0022 });
  gmc.label('UP', 0.263, 0.052, { height: 0.0022 });
  gmc.add(
    new RotaryKnob(env, {
      id: 'm2.gmc.alt',
      label: 'ALT SEL',
      cap: 'ring',
      innerCap: 'fluted',
      diameter: 0.026,
      outer: { incEvent: inc(G3K_EVENTS.altTurnOuter), decEvent: dec(G3K_EVENTS.altTurnOuter), label: 'ALT 1000' },
      inner: { incEvent: inc(G3K_EVENTS.altTurnInner), decEvent: dec(G3K_EVENTS.altTurnInner), label: 'ALT 100' },
      push: { event: G3K_EVENTS.altPush, label: 'SYNC' },
    }),
    0.29,
    0.028,
  );
  gmc.label('ALT SEL', 0.29, 0.0075, { height: 0.0024 });
  gmc.add(encoderKnob(env, 'm2.gmc.crs2', 'CRS2', G3K_EVENTS.crsTurn(2), G3K_EVENTS.crsPush(2), 0.019), 0.318, 0.028);
  gmc.label('CRS2', 0.318, 0.0075, { height: 0.0024 });

  // --- Lower centre strip: ENG FIRE (L/R) and BOTTLE ARMED switches, display reversion and dimming (S&D15 §10.2.A, §10.3.E).
  const ry = 0.083;
  for (const i of [1, 2] as const) {
    const fx = i === 1 ? mid - 0.145 : mid + 0.145;
    const bx = i === 1 ? mid - 0.115 : mid + 0.115;
    gp.add(
      new PushButton(env, {
        id: `m2.engfire${i}`,
        label: `${i === 1 ? 'L' : 'R'} ENG FIRE`,
        style: 'korry',
        width: 0.024,
        height: 0.018,
        mode: 'toggle',
        var: M2.engFireBtn(i),
        stateNames: ['OUT', 'PUSHED (ARMED)'],
        segments: [{ text: [i === 1 ? 'L ENG' : 'R ENG', 'FIRE'], color: 'red', var: M2.engFireLight(i), style: 'field' }],
      }),
      fx,
      ry,
    );
    gp.add(
      new PushButton(env, {
        id: `m2.bottle${i}`,
        label: `BOTTLE ${i} ARMED`,
        style: 'korry',
        width: 0.022,
        height: 0.018,
        mode: 'momentary',
        var: M2.bottleBtn(i),
        segments: [{ text: ['BOTTLE', `${i} ARMED`, 'PUSH'], color: 'white', var: M2.bottleLight(i) }],
      }),
      bx,
      ry,
    );
  }
  const revs: [GduId, string, number][] = [
    ['pfd1', 'PFD 1', -0.07],
    ['mfd', 'MFD', -0.035],
    ['pfd2', 'PFD 2', 0.035],
  ];
  for (const [id, lab, dx] of revs) {
    gp.add(
      new PushButton(env, {
        id: `m2.rev.${id}`,
        label: `DISPLAY REVERSION ${lab}`,
        style: 'korry',
        width: 0.018,
        height: 0.013,
        mode: 'toggle',
        var: G3K.reversionSwitch(id),
        stateNames: ['NORM', 'REV'],
        segments: [{ text: 'REV', color: 'amber', whenOn: true }],
      }),
      mid + dx,
      ry,
    );
    gp.label(lab, mid + dx, 0.0715, { height: 0.0018, weight: 600 });
  }
  gp.add(
    new RotaryKnob(env, {
      id: 'm2.display_dim',
      label: 'DISPLAY DIM',
      cap: 'dimmer',
      diameter: 0.014,
      outer: { var: M2.displayDim, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], format: (v) => (v <= 0.02 ? 'AUTO' : `${Math.round(v * 100)} %`) },
    }),
    mid + 0.075,
    ry,
  );
  gp.label('DIM', mid + 0.075, 0.0715, { height: 0.0018, weight: 600 });
}

