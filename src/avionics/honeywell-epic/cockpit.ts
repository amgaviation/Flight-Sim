/**
 * Cockpit hardware of the Epic flight decks, built with the cockpit
 * library (CockpitBuilder / Panel / controls). The aircraft module owns the
 * cockpit geometry and calls these helpers on its own panels:
 *
 *   const main = b.panel({ name: 'main', ... });
 *   addDisplayUnits(main, suite, [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]);
 *   addGuidancePanel(b, glareshield, x, y, suite);
 *   addSmc(b, glareshield, xL, y, suite, 1);          // PlaneView II
 *   addMcdu(b, pedestal, x, y, suite, 1);             // PlaneView II
 *   addTsc(pedestal, x, y, suite, 1);                  // Symmetry
 *   addCcd(b, sideConsole, x, y, suite, 1);
 *
 * Every helper places the unit CENTRED at (x, y) in the parent panel's
 * coordinate convention and returns the created sub-panel (hardware) or
 * screen mesh. Controls emit the suite events (vars.ts EPIC_EVENTS) or
 * write the suite / overhead vars, so every key is functional.
 *
 * Sizes (EST unless noted): DU 14-in landscape LCD (FlightGlobal, "four
 * large 14in LCDs") -> 0.282 x 0.217 m active area at the 1024 x 788 canvas
 * aspect; Honeywell MCDU 5.75 x 9 in bezel (typical ARINC 739 size); SMC,
 * guidance panel, CCD, TSC, overhead touch screen and SFD sizes estimated
 * from cockpit photographs against the known DU size.
 */
import * as THREE from 'three';
import type { EventBus } from '../../core/EventBus';
import type { CockpitControl } from '../../cockpit/types';
import type { CockpitEnv } from '../../cockpit/env';
import type { CockpitBuilder, Panel } from '../../cockpit/CockpitBuilder';
import { GuardedSwitch, KeyPad, PushButton, RotaryKnob, Thumbwheel, ToggleSwitch } from '../../cockpit/controls';
import type { KeyDef } from '../../cockpit/controls/logic/MiscLogic';
import { EPIC_EVENTS, EPIC_VARS } from './vars';
import { GP_LIGHTS, type GpControl } from './logic/guidance';
import { DC_MENU } from './logic/controller';
import { overheadVar, pairedVar, type OverheadPanelDef } from './logic/overhead';
import type { EpicSuite } from './suite';
import type { GpWindowKind } from './displays/gpDisplay';

/** Physical sizes (m). */
export const EPIC_HW = {
  du: { w: 0.282, h: 0.217 },
  gp: { w: 0.76, h: 0.075 },
  gpWindow: { w: 0.056, h: 0.02 },
  smc: { w: 0.19, h: 0.135 },
  smcScreen: { w: 0.12, h: 0.09 },
  mcdu: { w: 0.146, h: 0.228 },
  mcduScreen: { w: 0.1, h: 0.083 },
  ccd: { w: 0.1, h: 0.14 },
  tsc: { w: 0.152, h: 0.091 },
  ohpts: { w: 0.19, h: 0.114 },
  sfd: { w: 0.095, h: 0.083 },
} as const;

// ---------------------------------------------------------------- displays

/** The four DUs (DU1..DU4) centred at the given positions, with bezels. */
export function addDisplayUnits(panel: Panel, suite: EpicSuite, at: readonly (readonly [number, number])[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < suite.du.length && i < at.length; i++) {
    out.push(panel.display(suite.du[i], at[i][0], at[i][1], EPIC_HW.du.w, EPIC_HW.du.h, { bezel: { border: [0.016, 0.016, 0.03, 0.016], material: 'bezel' } }));
  }
  return out;
}

/**
 * Symmetry touch-screen controller `n` (1..4, TSC_POSITIONS order).
 * `portrait` (appended, additive, fix round 1) rotates the active area to the
 * tall portrait orientation of the real units; the suite must be configured
 * with `tscPortrait` so the page layouts match.
 */
export function addTsc(panel: Panel, x: number, y: number, suite: EpicSuite, n: number, portrait = false): THREE.Mesh | null {
  const d = suite.tsc[n - 1];
  if (!d) return null;
  const w = portrait ? EPIC_HW.tsc.h : EPIC_HW.tsc.w;
  const h = portrait ? EPIC_HW.tsc.w : EPIC_HW.tsc.h;
  return panel.display(d, x, y, w, h, { bezel: { border: 0.01, material: 'bezelGloss' } });
}

/** Symmetry overhead panel touch screen `n` (1..3). */
export function addOhpts(panel: Panel, x: number, y: number, suite: EpicSuite, n: number): THREE.Mesh | null {
  const d = suite.ohpts[n - 1];
  if (!d) return null;
  return panel.display(d, x, y, EPIC_HW.ohpts.w, EPIC_HW.ohpts.h, { bezel: { border: 0.01, material: 'bezelGloss' } });
}

/** Symmetry standby flight display (touch) of `side`. */
export function addSfd(panel: Panel, x: number, y: number, suite: EpicSuite, side: 1 | 2): THREE.Mesh | null {
  const d = suite.standby[side - 1];
  if (!d || suite.cfg.variant !== 'symmetry') return null;
  return panel.display(d, x, y, EPIC_HW.sfd.w, EPIC_HW.sfd.h, { bezel: { border: 0.008, material: 'bezelGloss' } });
}

// ---------------------------------------------------------------- guidance panel

const GP_BUTTONS: readonly [GpControl, string, number, number][] = [
  // id, legend, x, y (m from the GP top-left) — EST layout after the G650ER glareshield photograph
  ['fd1', 'FD', 0.1, 0.028],
  ['man', 'MAN', 0.2, 0.024],
  ['flch', 'FLCH', 0.2, 0.052],
  ['hdg_btn', 'HDG', 0.298, 0.024],
  ['nav', 'NAV', 0.326, 0.024],
  ['apr', 'APR', 0.354, 0.024],
  ['bc', 'BC', 0.298, 0.052],
  ['lowbank', 'LO BANK', 0.332, 0.052],
  ['ap', 'AP', 0.392, 0.024],
  ['yd', 'YD', 0.42, 0.024],
  ['at', 'A/T', 0.392, 0.052],
  ['vs_btn', 'VS', 0.532, 0.024],
  ['fpa', 'FPA', 0.532, 0.052],
  ['vnav', 'VNAV', 0.56, 0.024],
  ['alt_btn', 'ALT', 0.676, 0.024],
  ['fd2', 'FD', 0.676, 0.052],
];

/** Guidance panel (G650 FGP / Symmetry GP-700): windows, knobs and lit mode keys. */
export function addGuidancePanel(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: EpicSuite): Panel {
  const env = b.env;
  const gp = parent.subPanel({ name: `${suite.cfg.idPrefix}.gp`, width: EPIC_HW.gp.w, height: EPIC_HW.gp.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.006 });
  const ev = (id: string) => EPIC_EVENTS.gp(id);
  const pfx = `${suite.cfg.idPrefix}.gp`;
  // Windows.
  const win = (k: GpWindowKind): GpWindowKind => k;
  const wins: readonly [GpWindowKind, number][] = [
    [win('speed'), 0.155],
    [win('heading'), 0.252],
    [win('vsfpa'), 0.49],
    [win('altitude'), 0.62],
  ];
  for (const [k, wx] of wins) {
    const d = suite.gpWindows.find((g) => g.kind === k);
    if (d) gp.display(d, wx, 0.017, EPIC_HW.gpWindow.w, EPIC_HW.gpWindow.h, { bezel: false });
  }
  gp.label('SPEED', 0.155, 0.004, { height: 0.0026 });
  gp.label('HEADING', 0.252, 0.004, { height: 0.0026 });
  gp.label('VS / FPA', 0.49, 0.004, { height: 0.0026 });
  gp.label('ALTITUDE', 0.62, 0.004, { height: 0.0026 });
  // Knobs (encoders: click counts to the guidance logic).
  const knob = (id: string, label: string, kx: number, ky: number, push: string | null, pushLabel: string, cap: 'fluted' | 'knurled' = 'fluted', inner?: { id: string; label: string }): CockpitControl =>
    gp.add(
      new RotaryKnob(env, {
        id: `${pfx}.${id}`,
        label,
        cap,
        diameter: 0.017,
        outer: { incEvent: ev(`${id}_inc`), decEvent: ev(`${id}_dec`), label },
        inner: inner ? { incEvent: ev(`${inner.id}_inc`), decEvent: ev(`${inner.id}_dec`), label: inner.label } : undefined,
        push: push ? { event: ev(push), label: pushLabel } : undefined,
      }),
      kx,
      ky,
    );
  knob('baro1', 'BARO 1', 0.024, 0.045, 'baro1_push', 'STD', 'knurled');
  gp.label('BARO', 0.024, 0.02, { height: 0.0026 });
  knob('crs1', 'CRS 1', 0.064, 0.045, 'crs1_push', 'DIRECT');
  gp.label('CRS 1', 0.064, 0.02, { height: 0.0026 });
  knob('spd', 'SPEED', 0.155, 0.052, 'spd_push', 'IAS / MACH');
  knob('hdg', 'HEADING', 0.252, 0.052, 'hdg_push', 'SYNC');
  gp.add(new Thumbwheel(env, { id: `${pfx}.vs`, label: 'VS / FPA wheel', channel: { incEvent: ev('vs_inc'), decEvent: ev('vs_dec'), label: 'VS' }, diameter: 0.02, width: 0.009, orientation: 'vertical' }), 0.49, 0.052);
  knob('alt', 'ALTITUDE', 0.62, 0.052, null, '', 'fluted', { id: 'alt_fine', label: 'ALT 100 FT' });
  knob('crs2', 'CRS 2', 0.7, 0.045, 'crs2_push', 'DIRECT');
  gp.label('CRS 2', 0.7, 0.02, { height: 0.0026 });
  knob('baro2', 'BARO 2', 0.738, 0.045, 'baro2_push', 'STD', 'knurled');
  gp.label('BARO', 0.738, 0.02, { height: 0.0026 });
  // Lit mode keys.
  for (const [id, legend, bx, by] of GP_BUTTONS) {
    const light = GP_LIGHTS[id];
    gp.add(
      new PushButton(env, {
        id: `${pfx}.${id}`,
        label: legend === 'FD' ? (id === 'fd1' ? 'FD 1' : 'FD 2') : legend,
        style: 'mcp',
        mode: 'momentary',
        event: ev(id),
        engraved: legend,
        engravedHeight: 0.0024,
        lightBar: light ? { var: light, color: 'green' } : undefined,
      }),
      bx,
      by,
    );
  }
  // PFD CMD with the coupling arrows (L / R legends lit per coupled side).
  gp.add(
    new PushButton(env, {
      id: `${pfx}.pfdcmd`,
      label: 'PFD CMD',
      style: 'mcp',
      mode: 'momentary',
      event: ev('pfdcmd'),
      layout: 'split',
      segments: [
        { text: '<', color: 'green', var: EPIC_VARS.coupleSide, test: (v) => v !== 2 },
        { text: '>', color: 'green', var: EPIC_VARS.coupleSide, test: (v) => v === 2 },
      ],
    }),
    0.42,
    0.052,
  );
  gp.label('PFD CMD', 0.42, 0.068, { height: 0.0022 });
  return gp;
}

// ---------------------------------------------------------------- SMC (PlaneView II)

/** Standby multifunction controller (display controller + standby instrument) of `side`. */
export function addSmc(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: EpicSuite, side: 1 | 2): Panel | null {
  const d = suite.standby[side - 1];
  if (!d || suite.cfg.variant !== 'planeview2') return null;
  const env = b.env;
  const W = EPIC_HW.smc.w;
  const sc = EPIC_HW.smcScreen;
  const p = parent.subPanel({ name: `${suite.cfg.idPrefix}.smc${side}`, width: W, height: EPIC_HW.smc.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.006 });
  const sx = (W - sc.w) / 2;
  const sy = 0.008;
  p.display(d, W / 2, sy + sc.h / 2, sc.w, sc.h, { bezel: false });
  // Line select keys aligned with the SMC screen rows (y = 72 + 58 k of 360 logical px).
  const lskRows = (first: number): KeyDef[][] => [0, 1, 2, 3, 4].map((k) => [{ id: String(first + k), label: '', style: 'lsk' }]);
  const keyH = 0.008;
  const pitch = (58 / 360) * sc.h;
  const gap = pitch - keyH;
  const lsk = (first: number, lx: number): void => {
    const kp = new KeyPad(env, { id: `${suite.cfg.idPrefix}.smc${side}.lsk${first}`, label: `SMC ${side} line select keys`, rows: lskRows(first), singleEvent: EPIC_EVENTS.dcLsk(side), eventPrefix: `epic.smc${side}.k`, keyWidth: 0.011, keyHeight: keyH, gap });
    p.add(kp, lx - kp.width / 2, sy + (72 / 360) * sc.h - keyH / 2);
  };
  lsk(1, sx - 0.011);
  lsk(6, sx + sc.w + 0.011);
  // Function keys: the display-controller pages (two rows of five), then STBY.
  const fk: KeyDef[][] = [DC_MENU.slice(0, 5).map((id) => ({ id, label: id === 'SYS' ? '1/6-2/3' : id })), DC_MENU.slice(5).map((id) => ({ id, label: id === 'SYS' ? '1/6-2/3' : id }))];
  const fkp = new KeyPad(env, { id: `${suite.cfg.idPrefix}.smc${side}.fn`, label: `SMC ${side} function keys`, rows: fk, singleEvent: EPIC_EVENTS.dcPage(side), eventPrefix: `epic.smc${side}.f`, keyWidth: 0.021, keyHeight: 0.009, gap: 0.0035, legendHeight: 0.0022 });
  p.add(fkp, 0.012, sy + sc.h + 0.007);
  const stby = new KeyPad(env, { id: `${suite.cfg.idPrefix}.smc${side}.stby`, label: `SMC ${side} STBY`, rows: [[{ id: 'STBY' }]], singleEvent: EPIC_EVENTS.dcPage(side), eventPrefix: `epic.smc${side}.s`, keyWidth: 0.018, keyHeight: 0.009, legendHeight: 0.0022 });
  p.add(stby, W - 0.03, sy + sc.h + 0.007);
  // SET knob (range / selected item).
  p.add(new RotaryKnob(env, { id: `${suite.cfg.idPrefix}.smc${side}.set`, label: `SMC ${side} SET`, diameter: 0.014, outer: { incEvent: EPIC_EVENTS.dcSetInc(side), decEvent: EPIC_EVENTS.dcSetDec(side), label: 'SET' } }), W - 0.021, sy + sc.h + 0.03);
  return p;
}

// ---------------------------------------------------------------- MCDU (PlaneView II)

const MCDU_FN: KeyDef[][] = [
  [{ id: 'FPL' }, { id: 'NAV' }, { id: 'PERF' }, { id: 'PROG' }, { id: 'DIR' }],
  [{ id: 'RADIO' }, { id: 'MSG' }, { id: 'DLK' }, { id: 'MENU' }, { id: 'PREV' }, { id: 'NEXT' }],
];
const k = (id: string, label?: string, keys?: string[]): KeyDef => ({ id, label, keys });
const SP = (w = 1): KeyDef => ({ id: '', spacer: true, w });
const MCDU_ALNUM: KeyDef[][] = [
  [k('1'), k('2'), k('3'), SP(0.4), k('A'), k('B'), k('C'), k('D'), k('E')],
  [k('4'), k('5'), k('6'), SP(0.4), k('F'), k('G'), k('H'), k('I'), k('J')],
  [k('7'), k('8'), k('9'), SP(0.4), k('K'), k('L'), k('M'), k('N'), k('O')],
  [k('.'), k('0'), k('+/-', '+/-', ['-', '+']), SP(0.4), k('P'), k('Q'), k('R'), k('S'), k('T')],
  [k('CLR', 'CLR', ['Backspace']), k('DEL', 'DEL', ['Delete']), k('/'), SP(0.4), k('U'), k('V'), k('W'), k('X'), k('Y')],
  [SP(3), SP(0.4), k('Z'), k('SP', 'SP', [' ']), SP(3)],
];

/** Pedestal MCDU `n` (1..3): screen, line select keys, function keys and keyboard. */
export function addMcdu(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: EpicSuite, n: number): Panel | null {
  const d = suite.mcduDisplays[n - 1];
  if (!d) return null;
  const env = b.env;
  const W = EPIC_HW.mcdu.w;
  const sc = EPIC_HW.mcduScreen;
  const p = parent.subPanel({ name: `${suite.cfg.idPrefix}.mcdu${n}`, width: W, height: EPIC_HW.mcdu.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.008 });
  const sy = 0.012;
  p.display(d, W / 2, sy + sc.h / 2, sc.w, sc.h, { bezel: false });
  const ev = EPIC_EVENTS.mcduKey(n);
  const rh = sc.h / 14;
  const lskRows = (side: 'L' | 'R'): KeyDef[][] => [1, 2, 3, 4, 5, 6].map((i) => [{ id: `${side}${i}`, label: '', style: 'lsk' }]);
  const keyH = 0.0075;
  for (const side of ['L', 'R'] as const) {
    const kp = new KeyPad(env, { id: `${suite.cfg.idPrefix}.mcdu${n}.lsk${side}`, label: `MCDU ${n} LSK ${side}`, rows: lskRows(side), singleEvent: ev, eventPrefix: `epic.mcdu${n}.k`, keyWidth: 0.011, keyHeight: keyH, gap: 2 * rh - keyH });
    p.add(kp, side === 'L' ? (W - sc.w) / 2 - 0.016 : (W + sc.w) / 2 + 0.005, sy + 2.55 * rh - keyH / 2);
  }
  const fn = new KeyPad(env, { id: `${suite.cfg.idPrefix}.mcdu${n}.fn`, label: `MCDU ${n} function keys`, rows: MCDU_FN, singleEvent: ev, eventPrefix: `epic.mcdu${n}.f`, keyWidth: 0.0175, keyHeight: 0.009, gap: 0.0028, legendHeight: 0.0022, styleMaterials: { function: 'knobGrey' } });
  p.add(fn, 0.012, sy + sc.h + 0.008);
  const al = new KeyPad(env, {
    id: `${suite.cfg.idPrefix}.mcdu${n}.keys`,
    label: `MCDU ${n} keyboard`,
    rows: MCDU_ALNUM,
    singleEvent: ev,
    eventPrefix: `epic.mcdu${n}.a`,
    keyWidth: 0.0112,
    keyHeight: 0.0098,
    gap: 0.0026,
    keyboard: true,
    lights: [{ text: 'MSG', color: 'white', var: EPIC_VARS.mcduMsgLight(n), x: 0.0, y: -0.006, w: 0.012, h: 0.004 }],
  });
  p.add(al, 0.012, sy + sc.h + 0.04);
  return p;
}

// ---------------------------------------------------------------- CCD

/** CCD touch pad: drag = cursor motion (touch-pad pixels scaled by the cursor gain). */
export class CcdTouchPad implements CockpitControl {
  readonly id: string;
  readonly object = new THREE.Group();
  readonly hitTargets: THREE.Object3D[] = [];
  readonly pointerLock = true;
  private readonly geom: THREE.BufferGeometry;
  private readonly payload = { dx: 0, dy: 0 };

  constructor(
    env: CockpitEnv,
    id: string,
    private readonly side: 1 | 2,
    private readonly events: EventBus,
    w: number,
    h: number,
  ) {
    this.id = id;
    this.geom = new THREE.BoxGeometry(w, h, 0.003);
    const m = new THREE.Mesh(this.geom, env.materials.get('rubber'));
    m.position.z = 0.0015;
    m.name = `ccdpad:${id}`;
    this.object.add(m);
    this.hitTargets.push(m);
  }

  tooltip(): string {
    return `CCD ${this.side} touch pad (drag to move the cursor)`;
  }

  cursor(): string {
    return 'move';
  }

  onDrag(dx: number, dy: number): void {
    // The payload object is reused (listeners read it synchronously).
    this.payload.dx = dx;
    this.payload.dy = dy;
    this.events.emit(EPIC_EVENTS.ccdMove(this.side), this.payload);
  }

  onWheel(delta: number): void {
    this.events.emit(EPIC_EVENTS.ccdData(this.side), delta > 0 ? 1 : -1);
  }

  dispose(): void {
    this.geom.dispose();
  }
}

/** Cursor control device of `side` (armrest): touch pad, ENTER, MENU, DU select keys, DATA SET knob. */
export function addCcd(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: EpicSuite, side: 1 | 2): Panel {
  const env = b.env;
  const W = EPIC_HW.ccd.w;
  const p = parent.subPanel({ name: `${suite.cfg.idPrefix}.ccd${side}`, width: W, height: EPIC_HW.ccd.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.01 });
  const pfx = `${suite.cfg.idPrefix}.ccd${side}`;
  p.add(new CcdTouchPad(env, `${pfx}.pad`, side, suite.events, 0.064, 0.05), W / 2, 0.062);
  p.add(new PushButton(env, { id: `${pfx}.enter`, label: `CCD ${side} ENTER`, style: 'key', width: 0.03, height: 0.012, mode: 'momentary', event: EPIC_EVENTS.ccdEnter(side), engraved: 'ENTER', engravedHeight: 0.0026 }), W / 2 - 0.018, 0.1);
  p.add(new PushButton(env, { id: `${pfx}.menu`, label: `CCD ${side} MENU`, style: 'key', width: 0.03, height: 0.012, mode: 'momentary', event: EPIC_EVENTS.ccdMenu(side), engraved: 'MENU', engravedHeight: 0.0026 }), W / 2 + 0.018, 0.1);
  const dus = new KeyPad(env, {
    id: `${pfx}.du`,
    label: `CCD ${side} display select`,
    rows: [[{ id: '0', label: side === 1 ? 'DU1' : 'DU2' }, { id: '1', label: side === 1 ? 'DU2' : 'DU3' }, { id: '2', label: side === 1 ? 'DU3' : 'DU4' }]],
    singleEvent: EPIC_EVENTS.ccdDu(side),
    eventPrefix: `epic.ccd${side}.k`,
    keyWidth: 0.02,
    keyHeight: 0.009,
    gap: 0.004,
    legendHeight: 0.0024,
  });
  p.add(dus, W / 2 - dus.width / 2, 0.012);
  p.add(
    new RotaryKnob(env, {
      id: `${pfx}.data`,
      label: `CCD ${side} DATA SET`,
      diameter: 0.022,
      outer: { incEvent: EPIC_EVENTS.ccdDataInc(side), decEvent: EPIC_EVENTS.ccdDataDec(side), label: 'DATA (coarse)' },
      inner: { incEvent: EPIC_EVENTS.ccdDataInc(side, true), decEvent: EPIC_EVENTS.ccdDataDec(side, true), label: 'DATA (fine)' },
    }),
    W / 2,
    0.124,
  );
  return p;
}

// ---------------------------------------------------------------- side console / overhead switches

/** CAS scroll switch (spring-loaded UP / DN toggle). */
export function addCasScrollSwitch(b: CockpitBuilder, panel: Panel, x: number, y: number, id = 'epic.cas.scroll'): CockpitControl {
  return panel.add(
    new ToggleSwitch(b.env, {
      id,
      label: 'CAS SCROLL',
      var: 'epic.cas.scroll_sw',
      positions: ['DN', 'NORM', 'UP'],
      values: [-1, 0, 1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      events: { 0: EPIC_EVENTS.casScrollDown, 2: EPIC_EVENTS.casScrollUp },
      labels: { name: 'CAS', positions: true },
    }),
    x,
    y,
  );
}

/**
 * Overhead DISPLAY SYSTEM CONTROL (NORM / OFF per DU) and MFD DISPLAY
 * SWITCHING (NORM / PFD for DU 2 and DU 3) switches (G550 OM 2A-31;
 * G650ER overhead photograph). Laid out in one row starting at (x, y).
 */
export function addDisplaySwitching(b: CockpitBuilder, panel: Panel, x: number, y: number, pitch = 0.03, idPrefix = 'epic'): CockpitControl[] {
  const env = b.env;
  const out: CockpitControl[] = [];
  out.push(panel.add(new ToggleSwitch(env, { id: `${idPrefix}.mfdsw1`, label: 'MFD DISPLAY SWITCHING L', var: EPIC_VARS.mfdSwitch(1), positions: ['NORM', 'PFD'], labels: { name: 'MFD L', positions: true } }), x, y));
  out.push(panel.add(new ToggleSwitch(env, { id: `${idPrefix}.mfdsw2`, label: 'MFD DISPLAY SWITCHING R', var: EPIC_VARS.mfdSwitch(2), positions: ['NORM', 'PFD'], labels: { name: 'MFD R', positions: true } }), x + pitch, y));
  for (let n = 1; n <= 4; n++) {
    out.push(panel.add(new ToggleSwitch(env, { id: `${idPrefix}.dusw${n}`, label: `DISPLAY SYSTEM CONTROL DU ${n}`, var: EPIC_VARS.duSwitch(n), positions: ['OFF', 'NORM'], initial: 1, labels: { name: `DU ${n}`, positions: true } }), x + (n + 1.5) * pitch, y));
  }
  return out;
}

/**
 * PlaneView II hardware overhead panel built from the same definitions the
 * Symmetry overhead touch screens use (logic/overhead.ts), so a G650 switch
 * and a G800 touch key write the same var. Groups are laid out in rows
 * starting at (x, y) (parent panel convention, y downwards for 'top-left'
 * panels); multi-position controls are toggles (positions ordered by value),
 * momentary controls push buttons, continuous controls knobs, guarded
 * controls guarded toggles. Returns the controls created.
 * SCOPE: no annunciator legends in the switches (system status is on the
 * synoptics / CAS).
 */
export function addOverheadSwitches(b: CockpitBuilder, panel: Panel, x: number, y: number, def: OverheadPanelDef, overrides?: Readonly<Record<string, string | null>>, pitch = 0.034, rowH = 0.048, idPrefix = 'epic.ovhd'): CockpitControl[] {
  const env = b.env;
  const out: CockpitControl[] = [];
  const down = panel.origin === 'top-left' ? 1 : -1;
  let row = 0;
  for (const g of def.groups) {
    panel.label(g.title, x + pitch * 1.5, y + down * (row * rowH), { height: 0.0028 });
    let col = 0;
    for (const c of g.controls) {
      const name = overheadVar(c.key, overrides);
      if (!name) continue;
      const cx = x + col * pitch;
      const cy = y + down * (row * rowH + 0.022);
      const id = `${idPrefix}.${c.key}`;
      if (c.stepper) {
        const st = c.stepper;
        out.push(panel.add(new RotaryKnob(env, { id, label: c.label, cap: 'dimmer', diameter: 0.014, outer: { var: name, min: st.min, max: st.max, step: st.step, initial: st.initial, angleRange: [-140, 140], label: c.label, format: (v) => `${v.toFixed(st.decimals)} ${st.unit}` } }), cx, cy));
      } else if (c.momentary) {
        out.push(panel.add(new PushButton(env, { id, label: c.label, var: name, mode: 'momentary', style: 'korry', segments: [{ text: c.label.length > 8 ? c.label.split(' ') : c.label, color: 'white', whenOn: true }] }), cx, cy));
      } else {
        const pos = [...(c.positions ?? [{ value: 0, legend: 'OFF' }, { value: 1, legend: 'ON' }])].sort((a, q) => a.value - q.value);
        const initVal = c.initial ?? pos[0].value;
        // Single WING / COWL switch airframes drive both sides' vars (pairedVar).
        const twin = def.groups.some((q) => q.controls.some((o) => o.key === 'ice.wing_r' || o.key === 'ice.cowl_r')) ? null : pairedVar(c.key, overrides);
        const onChange = twin ? (x: number) => b.env.vars.set(twin, x) : undefined;
        const opts = { id, label: c.label, var: name, onChange, positions: pos.map((q) => q.legend), values: pos.map((q) => q.value), initial: Math.max(0, pos.findIndex((q) => q.value === initVal)), labels: { name: c.label, positions: true, height: 0.0022 } };
        out.push(panel.add(c.guarded ? new GuardedSwitch(env, { ...opts, guard: { color: 'red', guardedPosition: opts.initial } }) : new ToggleSwitch(env, opts), cx, cy));
      }
      col++;
      if (col >= 8) {
        col = 0;
        row++;
      }
    }
    row++;
  }
  return out;
}
