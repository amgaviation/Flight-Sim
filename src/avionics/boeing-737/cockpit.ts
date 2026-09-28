/**
 * Cockpit hardware of the 737NG avionics, built with the cockpit library
 * (CockpitBuilder / Panel / controls). The aircraft module owns the flight
 * deck geometry and calls these helpers on its own panels:
 *
 *   addDisplayUnits(mainPanel, suite, B737_DU_LAYOUT.map(...));  // six DUs
 *   addMcp(b, glareshield, x, y, suite);                         // Mode Control Panel
 *   addEfisPanel(b, glareshield, xL, y, 1); addEfisPanel(b, glareshield, xR, y, 2);
 *   addDisengageLights(b, mainPanel, x, y, 1);                    // A/P A/T FMC P/RST + TEST
 *   addDisplaySelect(b, mainPanel, x, y, 1);                      // MAIN PANEL DUs / LOWER DU + brightness
 *   addCentreControls(b, mainPanel, x, y);                        // MFD ENG/SYS/C-R, N1 SET, SPD REF, FUEL FLOW
 *   addCdu(b, pedestal, x, y, suite, 1);                          // CDU screen + keyboard
 *   addTransferSwitches(b, overhead, x, y);                       // VHF NAV / IRS / FMC / DISPLAYS SOURCE / CONTROL PANEL
 *
 * Every helper places the unit CENTRED at (x, y) in the parent panel's
 * coordinate convention and returns the created sub-panel. Every control
 * writes a suite var or emits a suite event (vars.ts), so every knob,
 * switch and key works.
 *
 * Sizes (EST from flight deck photographs against the known DU size unless
 * noted): 737NG DUs are 8 x 8 in square flat panels (b737.org.uk "Flight
 * Instruments - NG": "six 8 x 8 inch LCD display units") -> 0.170 m square
 * active area inside a 0.203 m bezel; MCP 0.463 x 0.072 m and EFIS control
 * panel 0.117 x 0.072 m, measured on the Simulation Cockpit Builder Group
 * (SCBG) 1:1 737NG main panel drawing (cm ruler, ~2,840 px/m at full
 * resolution; the MCP and EFIS control positions below are measured on it
 * too); CDU 5.75 x 9 in (0.146 x 0.229 m, ARINC 739 size) with a 0.098 x
 * 0.084 m screen.
 */
import type * as THREE from 'three';
import type { CockpitControl } from '../../cockpit/types';
import type { CockpitBuilder, Panel } from '../../cockpit/CockpitBuilder';
import { AnnunciatorLight, KeyPad, PushButton, RotaryKnob, SelectorKnob, Thumbwheel, ToggleSwitch } from '../../cockpit/controls';
import type { KeyDef } from '../../cockpit/controls/logic/MiscLogic';
import { AFCS_VARS } from '../../systems/autopilot/vars';
import { B737_EVENTS, B737_VARS, DU_DISPLAY_VARS, EFIS_MAP_BUTTONS, LowerDuSel, MainPanelDuSel, ND_RANGES_NM, NdMode, type DuId, type McpButton, type Side } from './vars';
import { BANK_POSITIONS } from './afds/Afds';
import type { B737Suite } from './suite';

/** Physical sizes (m). */
export const B737_HW = {
  du: { w: 0.17, h: 0.17, border: 0.017 },
  // SCBG 1:1 drawing: MCP 0.463 x 0.072 m, EFIS control panels 0.117 x 0.072 m (see header).
  mcp: { w: 0.463, h: 0.072 },
  mcpWindowH: 0.012,
  efis: { w: 0.117, h: 0.072 },
  cdu: { w: 0.146, h: 0.229 },
  cduScreen: { w: 0.098, h: 0.084 },
} as const;

/**
 * DU positions on the main instrument panel (m, centre-origin panel, from
 * the aircraft centreline), measured on the SCBG 1:1 737NG panel drawing:
 * DU centres -0.504 / -0.292 / +0.02 / +0.291 / +0.503 m (0.21 m pitch), the
 * lower DU on the forward electronic panel P9 between the two CDUs (its
 * v here is only nominal: aircraft place it on their own P9 panel).
 */
export const B737_DU_LAYOUT: Readonly<Record<DuId, readonly [number, number]>> = {
  capt_out: [-0.504, 0],
  capt_in: [-0.292, 0],
  upper: [0.02, 0],
  lower: [0, -0.23],
  fo_in: [0.291, 0],
  fo_out: [0.503, 0],
};

// ---------------------------------------------------------------- displays

/** The six DUs at `at` (DU_IDS order, or B737_DU_LAYOUT when omitted), with bezels. */
export function addDisplayUnits(panel: Panel, suite: B737Suite, at?: readonly (readonly [number, number])[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < suite.du.length; i++) {
    const d = suite.du[i];
    const pos = at?.[i] ?? B737_DU_LAYOUT[d.du];
    out.push(panel.display(d, pos[0], pos[1], B737_HW.du.w, B737_HW.du.h, { bezel: { border: B737_HW.du.border, material: 'bezel' } }));
  }
  return out;
}

// ---------------------------------------------------------------- MCP

/**
 * Mode selector buttons (FCOM 4.10 MCP): id, legend, x (m from the MCP left edge), y (m down from the top edge).
 * Positions measured on the SCBG 1:1 drawing (0.463 m MCP): N1 and SPEED side by side in the bottom row left
 * of the IAS/MACH knob, C/O beside the IAS knob, VNAV / LVL CHG, HDG SEL, LNAV / VOR LOC / APP, ALT HLD, V/S,
 * CMD A / B and CWS A / B.
 */
const MCP_BUTTON_LAYOUT: readonly [McpButton, string, number, number][] = [
  ['n1', 'N1', 0.071, 0.059],
  ['speed', 'SPEED', 0.097, 0.059],
  ['co', 'C/O', 0.106, 0.038],
  ['vnav', 'VNAV', 0.159, 0.016],
  ['lvlchg', 'LVL CHG', 0.159, 0.059],
  ['hdgsel', 'HDG SEL', 0.189, 0.059],
  ['lnav', 'LNAV', 0.221, 0.016],
  ['vorloc', 'VOR LOC', 0.221, 0.036],
  ['app', 'APP', 0.221, 0.059],
  ['althld', 'ALT HLD', 0.256, 0.059],
  ['vs', 'V/S', 0.281, 0.059],
  ['cmd_a', 'CMD A', 0.348, 0.013],
  ['cmd_b', 'CMD B', 0.374, 0.013],
  ['cws_a', 'CWS A', 0.348, 0.033],
  ['cws_b', 'CWS B', 0.374, 0.033],
];

/** Options of the cockpit helpers (all optional; defaults keep the previous look). */
export interface B737HwOptions {
  /** Plate material (default 'panelDark'; the 737NG modules are painted in the panel grey). */
  material?: 'panel' | 'panelDark';
}

/**
 * Mode Control Panel: six data windows, CRS / IAS-MACH / HDG (with the bank
 * angle selector ring) / ALT knobs, V/S thumbwheel, mode selector buttons
 * with their light bars, F/D switches with MA lights, A/T ARM switch
 * (magnetically held: the autothrottle releases it by writing the var),
 * CMD / CWS buttons and the A/P DISENGAGE bar.
 */
export function addMcp(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: B737Suite, o: B737HwOptions = {}): Panel {
  const env = b.env;
  const W = B737_HW.mcp.w;
  const p = parent.subPanel({ name: 'b737.mcp', width: W, height: B737_HW.mcp.h, x, y, origin: 'top-left', material: o.material ?? 'panelDark', thickness: 0.008 });
  const winH = B737_HW.mcpWindowH;
  // Windows: centre x per kind (CRS L, IAS/MACH, HDG, ALT, V/S, CRS R), SCBG drawing.
  const winX = [0.04, 0.126, 0.188, 0.256, 0.302, 0.414];
  const titles = ['COURSE', 'IAS/MACH', 'HEADING', 'ALTITUDE', 'VERT SPEED', 'COURSE'];
  for (let i = 0; i < suite.mcpWindows.length; i++) {
    const d = suite.mcpWindows[i];
    p.display(d, winX[i], 0.014, winH * d.aspect, winH, { bezel: false });
    p.label(titles[i], winX[i], 0.0045, { height: 0.0025 });
  }
  const knob = (id: string, label: string, kx: number, ky: number, inc: string, dec: string, push?: { event: string; label: string }): CockpitControl =>
    p.add(new RotaryKnob(env, { id: `b737.mcp.${id}`, label, cap: 'fluted', diameter: 0.017, outer: { incEvent: inc, decEvent: dec, label }, push: push ? { event: push.event, label: push.label } : undefined }), kx, ky);
  // COURSE knobs.
  knob('crs1', 'COURSE L', 0.038, 0.043, B737_EVENTS.mcpCrsInc(1), B737_EVENTS.mcpCrsDec(1));
  knob('crs2', 'COURSE R', 0.414, 0.035, B737_EVENTS.mcpCrsInc(2), B737_EVENTS.mcpCrsDec(2));
  // F/D switches (bottom row) with the MA lights above them (FCOM 4.10: "MA" illuminates on the master F/D side).
  for (const s of [1, 2] as Side[]) {
    const fx = s === 1 ? 0.057 : 0.397;
    p.add(new ToggleSwitch(env, { id: `b737.mcp.fd${s}`, label: s === 1 ? 'F/D L' : 'F/D R', var: `ap.fd${s}_on`, positions: ['OFF', 'ON'], scale: 0.8, labels: { name: 'F/D', positions: true, height: 0.0022 } }), fx, 0.06);
    p.add(new AnnunciatorLight(env, { id: `b737.mcp.ma${s}`, label: `MA ${s}`, width: 0.008, height: 0.006, segments: [{ text: 'MA', color: 'green', var: B737_VARS.mcpMaLight(s) }] }), s === 1 ? 0.058 : 0.397, s === 1 ? 0.043 : 0.038);
  }
  // A/T ARM (solenoid held; the A/T disconnect releases it) in the upper row with its ARM light above it.
  p.add(new ToggleSwitch(env, { id: 'b737.mcp.at_arm', label: 'A/T ARM', var: 'ac.at_arm', positions: ['OFF', 'ARM'], scale: 0.8, labels: { name: false, positions: false, height: 0.0022 } }), 0.082, 0.036);
  p.label('A/T', 0.082, 0.0045, { height: 0.0025 });
  p.add(new AnnunciatorLight(env, { id: 'b737.mcp.at_arm_lt', label: 'A/T ARM light', width: 0.009, height: 0.005, segments: [{ text: 'ARM', color: 'green', var: B737_VARS.mcpLight('at_arm') }] }), 0.082, 0.015);
  p.label('OFF', 0.082, 0.051, { height: 0.0019 });
  // IAS/MACH knob: push = SPD INTV (NG MCP).
  knob('spd', 'IAS/MACH', 0.126, 0.046, B737_EVENTS.mcpSpdInc, B737_EVENTS.mcpSpdDec, { event: B737_EVENTS.mcpSpdIntv, label: 'SPD INTV' });
  // HEADING: inner heading encoder, outer bank angle selector 10..30 deg.
  p.add(
    new RotaryKnob(env, {
      id: 'b737.mcp.hdg',
      label: 'HEADING',
      cap: 'ring',
      innerCap: 'fluted',
      diameter: 0.022,
      outer: { var: AFCS_VARS.bankSelect, positions: BANK_POSITIONS.map((d) => ({ value: d, label: String(d) })), angles: [-60, -30, 0, 30, 60], label: 'BANK ANGLE', initial: 25 },
      inner: { incEvent: B737_EVENTS.mcpHdgInc, decEvent: B737_EVENTS.mcpHdgDec, label: 'HDG' },
    }),
    0.189,
    0.035,
  );
  p.label('BANK', 0.172, 0.026, { height: 0.0019 });
  // ALTITUDE knob: push = ALT INTV.
  knob('alt', 'ALTITUDE', 0.256, 0.034, B737_EVENTS.mcpAltInc, B737_EVENTS.mcpAltDec, { event: B737_EVENTS.mcpAltIntv, label: 'ALT INTV' });
  // V/S thumbwheel (rolling up = DN, as engraved on the MCP).
  p.add(new Thumbwheel(env, { id: 'b737.mcp.vs_wheel', label: 'VERT SPEED wheel', channel: { incEvent: B737_EVENTS.mcpVsUp, decEvent: B737_EVENTS.mcpVsDn, label: 'V/S' }, diameter: 0.02, width: 0.008, orientation: 'vertical' }), 0.311, 0.045);
  p.label('DN', 0.322, 0.03, { height: 0.0022 });
  p.label('UP', 0.322, 0.064, { height: 0.0022 });
  p.label('A/P ENGAGE', 0.361, 0.0045, { height: 0.0025 });
  // Mode selector buttons with light bars. EST: green light bars (NG MCP photographs).
  for (const [id, legend, bx, by] of MCP_BUTTON_LAYOUT) {
    const light = id === 'co' ? undefined : { var: B737_VARS.mcpLight(id), color: 'green' as const };
    const round = id === 'co';
    p.add(
      new PushButton(env, {
        id: `b737.mcp.${id}`,
        label: legend,
        style: round ? 'round' : 'mcp',
        width: round ? 0.008 : 0.015,
        height: round ? 0.008 : 0.01,
        mode: 'momentary',
        event: B737_EVENTS.mcpButton(id),
        engraved: round ? undefined : legend,
        engravedHeight: 0.0021,
        lightBar: light,
      }),
      bx,
      by,
    );
    if (round) p.label('C/O', bx - 0.007, by - 0.008, { height: 0.0021 });
  }
  // DISENGAGE bar (pull down = A/P disengaged and engagement inhibited).
  p.add(new ToggleSwitch(env, { id: 'b737.mcp.disengage', label: 'A/P DISENGAGE bar', var: B737_VARS.mcpDisengageBar, positions: ['DISENGAGE', 'UP'], values: [1, 0], initial: 1, handle: 'paddle', labels: { name: 'DISENGAGE', positions: false, height: 0.0022 } }), 0.362, 0.058);
  return p;
}

// ---------------------------------------------------------------- EFIS control panel

/**
 * EFIS control panel of `side` (FCOM 10.10): MINS, FPV, MTRS, BARO, VOR/ADF, mode, range, map buttons.
 * Layout measured on the SCBG 1:1 drawing (0.117 x 0.072 m panel).
 */
export function addEfisPanel(b: CockpitBuilder, parent: Panel, x: number, y: number, side: Side, o: B737HwOptions = {}): Panel {
  const env = b.env;
  const W = B737_HW.efis.w;
  const s = side;
  const pfx = `b737.efis${s}`;
  const p = parent.subPanel({ name: pfx, width: W, height: B737_HW.efis.h, x, y, origin: 'top-left', material: o.material ?? 'panelDark', thickness: 0.008 });
  // MINS: outer RADIO/BARO, inner set, push RST.
  p.add(
    new RotaryKnob(env, {
      id: `${pfx}.mins`,
      label: 'MINS',
      cap: 'ring',
      diameter: 0.018,
      outer: { var: B737_VARS.efisMinsRef(s), positions: [{ value: 0, label: 'RADIO' }, { value: 1, label: 'BARO' }], angles: [-30, 30], label: 'MINS REF' },
      inner: { incEvent: B737_EVENTS.efisMinsInc(s), decEvent: B737_EVENTS.efisMinsDec(s), label: 'MINS' },
      push: { event: B737_EVENTS.efisMinsRst(s), label: 'RST' },
    }),
    0.022,
    0.02,
  );
  p.label('RADIO', 0.008, 0.009, { height: 0.0019 });
  p.label('BARO', 0.034, 0.006, { height: 0.0019 });
  p.label('MINS', 0.022, 0.0035, { height: 0.0021 });
  p.add(new PushButton(env, { id: `${pfx}.fpv`, label: 'FPV', style: 'round', width: 0.0085, height: 0.0085, mode: 'momentary', event: B737_EVENTS.efisFpv(s) }), 0.049, 0.015);
  p.label('FPV', 0.049, 0.006, { height: 0.0019 });
  p.add(new PushButton(env, { id: `${pfx}.mtrs`, label: 'MTRS', style: 'round', width: 0.0085, height: 0.0085, mode: 'momentary', event: B737_EVENTS.efisMtrs(s) }), 0.066, 0.015);
  p.label('MTRS', 0.066, 0.006, { height: 0.0019 });
  // BARO: outer IN/HPA, inner set, push STD.
  p.add(
    new RotaryKnob(env, {
      id: `${pfx}.baro`,
      label: 'BARO',
      cap: 'ring',
      diameter: 0.018,
      outer: { var: B737_VARS.efisBaroHpa(s), positions: [{ value: 0, label: 'IN' }, { value: 1, label: 'HPA' }], angles: [-30, 30], label: 'BARO UNITS' },
      inner: { incEvent: B737_EVENTS.efisBaroInc(s), decEvent: B737_EVENTS.efisBaroDec(s), label: 'BARO' },
      push: { event: B737_EVENTS.efisBaroStd(s), label: 'STD' },
    }),
    0.095,
    0.02,
  );
  p.label('IN', 0.084, 0.006, { height: 0.0019 });
  p.label('HPA', 0.108, 0.009, { height: 0.0019 });
  p.label('BARO', 0.095, 0.0035, { height: 0.0021 });
  // VOR/ADF switches.
  for (const n of [1, 2] as const) {
    p.add(new ToggleSwitch(env, { id: `${pfx}.vor_adf${n}`, label: `VOR/ADF ${n}`, var: B737_VARS.efisVorAdf(s, n), positions: ['ADF', 'OFF', 'VOR'], values: [-1, 0, 1], initial: 1, scale: 0.65, labels: { name: String(n), positions: true, height: 0.0017 } }), n === 1 ? 0.011 : 0.106, 0.043);
  }
  // Mode selector (push = CTR) and range selector (push = TFC).
  p.add(
    new SelectorKnob(env, {
      id: `${pfx}.mode`,
      label: 'MODE',
      var: B737_VARS.efisMode(s),
      positions: [
        { value: NdMode.App, label: 'APP' },
        { value: NdMode.Vor, label: 'VOR' },
        { value: NdMode.Map, label: 'MAP' },
        { value: NdMode.Pln, label: 'PLN' },
      ],
      initial: 2,
      diameter: 0.014,
      labelHeight: 0.0017,
      push: { event: B737_EVENTS.efisCtr(s), label: 'CTR' },
    }),
    0.042,
    0.044,
  );
  p.add(
    new SelectorKnob(env, {
      id: `${pfx}.range`,
      label: 'RANGE',
      var: B737_VARS.efisRange(s),
      positions: ND_RANGES_NM.map((r, i) => ({ value: i, label: String(r), angle: -105 + i * 30 })),
      initial: 2,
      diameter: 0.014,
      labelHeight: 0.0015,
      push: { event: B737_EVENTS.efisTfc(s), label: 'TFC' },
    }),
    0.075,
    0.044,
  );
  // Map option buttons along the bottom edge (15.8 mm pitch, SCBG drawing).
  const legends: Record<string, string> = { wxr: 'WXR', sta: 'STA', wpt: 'WPT', arpt: 'ARPT', data: 'DATA', pos: 'POS', terr: 'TERR' };
  EFIS_MAP_BUTTONS.forEach((bt, i) => {
    p.add(new PushButton(env, { id: `${pfx}.${bt}`, label: legends[bt], style: 'mcp', mode: 'momentary', event: B737_EVENTS.efisMapButton(s, bt), engraved: legends[bt], engravedHeight: 0.0019, width: 0.0125, height: 0.0085 }), 0.011 + i * 0.0158, 0.064);
  });
  return p;
}

// ---------------------------------------------------------------- disengage lights

/**
 * A/P, A/T and FMC P/RST lights with the disengage light TEST switch (FCOM 4.10 "Autoflight Status
 * Annunciator"). Both pilots' panels have a TEST switch (SCBG P1 / P3 drawing); the F/O switch writes
 * `discLightTest2`, which the AFDS / FMC combine with the Captain's (SCOPE: either switch tests every light).
 */
export function addDisengageLights(b: CockpitBuilder, parent: Panel, x: number, y: number, side: Side, o: B737HwOptions = {}): Panel {
  const env = b.env;
  const pfx = `b737.asa${side}`;
  const p = parent.subPanel({ name: pfx, width: 0.085, height: 0.03, x, y, origin: 'top-left', material: o.material ?? 'panelDark', thickness: 0.004 });
  const light = (id: string, label: string, v: string, ev: string, lx: number): void => {
    // SCOPE: one lens shows red (upper legend) or amber (lower legend) instead of the whole lens changing colour.
    p.add(
      new PushButton(env, {
        id: `${pfx}.${id}`,
        label: `${label} P/RST`,
        style: 'korry',
        width: 0.017,
        height: 0.014,
        mode: 'momentary',
        event: ev,
        segments: [
          { text: label, color: 'red', var: v, test: (x) => x === 1, style: 'field' },
          { text: 'P/RST', color: 'amber', var: v, test: (x) => x === 2, style: 'field' },
        ],
      }),
      lx,
      0.015,
    );
  };
  light('ap', 'A/P', B737_VARS.apDiscLight, B737_EVENTS.apLightPush, 0.012);
  light('at', 'A/T', B737_VARS.atDiscLight, B737_EVENTS.atLightPush, 0.031);
  // FMC light: amber only.
  p.add(
    new PushButton(env, {
      id: `${pfx}.fmc`,
      label: 'FMC P/RST',
      style: 'korry',
      width: 0.017,
      height: 0.014,
      mode: 'momentary',
      event: B737_EVENTS.fmcLightPush,
      segments: [{ text: ['FMC', 'P/RST'], color: 'amber', var: B737_VARS.fmcAlertLight, test: (x) => x !== 0, style: 'field' }],
    }),
    0.05,
    0.015,
  );
  const tv = side === 1 ? B737_VARS.discLightTest : B737_VARS.discLightTest2;
  p.add(new ToggleSwitch(env, { id: `${pfx}.test`, label: 'DISENGAGE LIGHT TEST', var: tv, positions: ['1', 'OFF', '2'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, scale: 0.6, labels: { name: false, positions: true, height: 0.0018 } }), 0.071, 0.013);
  p.label('TEST', 0.071, 0.027, { height: 0.0018 });
  return p;
}

// ---------------------------------------------------------------- display select panel

/** MAIN PANEL DUs and LOWER DU selectors plus the outboard / inboard DU brightness knobs of `side`. */
export function addDisplaySelect(b: CockpitBuilder, parent: Panel, x: number, y: number, side: Side, o: B737HwOptions & { mirror?: boolean } = {}): Panel {
  const env = b.env;
  const pfx = `b737.dsp${side}`;
  const W = o.mirror !== undefined ? 0.123 : 0.11;
  const p = parent.subPanel({ name: pfx, width: W, height: 0.05, x, y, origin: 'top-left', material: o.material ?? 'panelDark', thickness: 0.004 });
  // SCBG drawing: Captain MAIN PANEL DUs outboard (left), LOWER DU inboard; the F/O panel is mirrored (`mirror`).
  const xMain = o.mirror ? W - 0.035 : 0.03;
  const xLower = o.mirror ? 0.035 : o.mirror === false ? W - 0.035 : 0.08;
  p.add(
    new SelectorKnob(env, {
      id: `${pfx}.main`,
      label: 'MAIN PANEL DUs',
      var: B737_VARS.mainPanelDus(side),
      positions: [
        { value: MainPanelDuSel.OutbdPfd, label: 'OUTBD PFD', display: 'OUTBD\nPFD' },
        { value: MainPanelDuSel.Norm, label: 'NORM' },
        { value: MainPanelDuSel.InbdEngPri, label: 'INBD ENG PRI', display: 'ENG\nPRI' },
        { value: MainPanelDuSel.InbdPfd, label: 'INBD PFD', display: 'PFD' },
        { value: MainPanelDuSel.InbdMfd, label: 'INBD MFD', display: 'MFD' },
      ],
      initial: 1,
      diameter: 0.014,
      labelHeight: o.mirror !== undefined ? 0.002 : 0.0016,
      title: 'MAIN PANEL DUs',
    }),
    xMain,
    0.028,
  );
  p.add(
    new SelectorKnob(env, {
      id: `${pfx}.lower`,
      label: 'LOWER DU',
      var: B737_VARS.lowerDu(side),
      positions: [
        { value: LowerDuSel.EngPri, label: 'ENG PRI', display: 'ENG\nPRI' },
        { value: LowerDuSel.Norm, label: 'NORM' },
        { value: LowerDuSel.Nd, label: 'ND' },
      ],
      initial: 1,
      diameter: 0.014,
      labelHeight: o.mirror !== undefined ? 0.002 : 0.0016,
      title: 'LOWER DU',
    }),
    xLower,
    0.028,
  );
  return p;
}

/** Brightness knobs of the given DUs, in a row starting at (x, y) with `pitch` spacing. */
export function addDuBrightness(b: CockpitBuilder, panel: Panel, x: number, y: number, dus: readonly DuId[], pitch = 0.03): CockpitControl[] {
  const names: Record<DuId, string> = { capt_out: 'OUTBD DU', capt_in: 'INBD DU', upper: 'UPPER DU', lower: 'LOWER DU', fo_in: 'INBD DU', fo_out: 'OUTBD DU' };
  return dus.map((d, i) =>
    panel.add(
      new RotaryKnob(b.env, {
        id: `b737.brt.${d}`,
        label: `${names[d]} BRT`,
        cap: 'dimmer',
        diameter: 0.012,
        // Clockwise from OFF (0) to full bright (1); DisplayUnit dims the frame with this var.
        outer: { var: DU_DISPLAY_VARS.brightness(d), min: 0, max: 1, step: 0.05, initial: 0.9, angleRange: [-140, 140], label: names[d], format: (v) => `${Math.round(v * 100)} %` },
      }),
      x + i * pitch,
      y,
    ),
  );
}

// ---------------------------------------------------------------- centre panel

/**
 * Centre panel controls: MFD ENG / SYS / C-R buttons, N1 SET (outer AUTO /
 * BOTH / 1 / 2, inner set), SPD REF (outer AUTO / V1 / VR / WT / VREF / B /
 * SET, inner set) and the FUEL FLOW switch (RESET spring / RATE / USED).
 */
export function addCentreControls(b: CockpitBuilder, parent: Panel, x: number, y: number, o: B737HwOptions & { layout?: 'row' | 'stack' } = {}): Panel {
  const env = b.env;
  // 'stack' (SCBG P2 drawing): N1 SET and SPD REF knobs in the top row, FUEL FLOW switch and the MFD buttons
  // under them. 'row' (default): everything in one row.
  const stack = o.layout === 'stack';
  const p = parent.subPanel({ name: 'b737.ctr', width: stack ? 0.105 : 0.2, height: stack ? 0.075 : 0.05, x, y, origin: 'top-left', material: o.material ?? 'panelDark', thickness: 0.004 });
  const P = stack
    ? { mfdY: 0.058, mfdX: [0.045, 0.063, 0.081], mfdLbl: [0.063, 0.046], n1: [0.02, 0.022], spd: [0.062, 0.022], ff: [0.018, 0.058] }
    : { mfdY: 0.018, mfdX: [0.015, 0.032, 0.049], mfdLbl: [0.03, 0.006], n1: [0.09, 0.025], spd: [0.14, 0.025], ff: [0.182, 0.025] };
  const btn = (id: string, legend: string, ev: string, bx: number): void => {
    p.add(new PushButton(env, { id: `b737.mfd.${id}`, label: `MFD ${legend}`, style: 'korry', width: 0.013, height: 0.011, mode: 'momentary', event: ev, engraved: legend, engravedHeight: 0.0022 }), bx, P.mfdY);
  };
  p.label('MFD', P.mfdLbl[0], P.mfdLbl[1], { height: 0.0022 });
  btn('eng', 'ENG', B737_EVENTS.mfdEng, P.mfdX[0]);
  btn('sys', 'SYS', B737_EVENTS.mfdSys, P.mfdX[1]);
  btn('cr', 'C/R', B737_EVENTS.mfdCr, P.mfdX[2]);
  p.add(
    new RotaryKnob(env, {
      id: 'b737.n1set',
      label: 'N1 SET',
      cap: 'ring',
      diameter: 0.02,
      outer: { var: B737_VARS.n1SetSel, positions: [{ value: 2, label: '1' }, { value: 0, label: 'AUTO' }, { value: 1, label: 'BOTH' }, { value: 3, label: '2' }], angles: [-60, -20, 20, 60], label: 'N1 SET' },
      inner: { incEvent: B737_EVENTS.n1SetInc, decEvent: B737_EVENTS.n1SetDec, label: 'N1' },
    }),
    P.n1[0],
    P.n1[1],
  );
  p.label('N1 SET', P.n1[0], P.n1[1] - 0.016, { height: 0.0022 });
  p.add(
    new RotaryKnob(env, {
      id: 'b737.spdref',
      label: 'SPD REF',
      cap: 'ring',
      diameter: 0.02,
      outer: {
        var: B737_VARS.spdRefSel,
        positions: ['AUTO', 'V1', 'VR', 'WT', 'VREF', 'B', 'SET'].map((l, i) => ({ value: i, label: l })),
        angles: [-90, -60, -30, 0, 30, 60, 90],
        label: 'SPD REF',
      },
      inner: { incEvent: B737_EVENTS.spdRefInc, decEvent: B737_EVENTS.spdRefDec, label: 'SPD' },
    }),
    P.spd[0],
    P.spd[1],
  );
  p.label('SPD REF', P.spd[0], P.spd[1] - 0.016, { height: 0.0022 });
  p.add(new ToggleSwitch(env, { id: 'b737.ffsw', label: 'FUEL FLOW', var: B737_VARS.ffSwitch, positions: ['RESET', 'RATE', 'USED'], values: [-1, 0, 1], initial: 1, springs: { 0: 1 }, scale: 0.8, labels: { name: 'FUEL FLOW', positions: true, height: 0.0018 } }), P.ff[0], P.ff[1]);
  return p;
}

// ---------------------------------------------------------------- CDU

const K = (id: string, label?: string, keys?: string[], style?: string): KeyDef => ({ id, label: label ?? id, keys, style });
const SPC = (w = 1): KeyDef => ({ id: '', spacer: true, w });

/** CDU keyboard rows below the screen (U10 CDU layout, b737.org.uk / FCOM 11.10 CDU picture). */
function cduRows(menuKey: 'menu' | 'dir-intc'): KeyDef[][] {
  return [
    [K('INIT_REF', 'INIT\nREF', undefined, 'fn'), K('RTE', 'RTE', undefined, 'fn'), K('CLB', 'CLB', undefined, 'fn'), K('CRZ', 'CRZ', undefined, 'fn'), K('DES', 'DES', undefined, 'fn'), SPC(1.2)],
    [
      menuKey === 'menu' ? K('MENU', 'MENU', undefined, 'fn') : K('DIR_INTC', 'DIR\nINTC', undefined, 'fn'),
      K('LEGS', 'LEGS', undefined, 'fn'),
      K('DEP_ARR', 'DEP\nARR', undefined, 'fn'),
      K('HOLD', 'HOLD', undefined, 'fn'),
      K('PROG', 'PROG', undefined, 'fn'),
      { id: 'EXEC', label: 'EXEC', w: 1.2, keys: ['Enter'], style: 'fn', lightVar: B737_VARS.fmcExecLight },
    ],
    [K('N1_LIMIT', 'N1\nLIMIT', undefined, 'fn'), K('FIX', 'FIX', undefined, 'fn'), K('A'), K('B'), K('C'), K('D'), K('E')],
    [K('PREV_PAGE', 'PREV\nPAGE', ['PageUp'], 'fn'), K('NEXT_PAGE', 'NEXT\nPAGE', ['PageDown'], 'fn'), K('F'), K('G'), K('H'), K('I'), K('J')],
    [K('1'), K('2'), K('3'), K('K'), K('L'), K('M'), K('N'), K('O')],
    [K('4'), K('5'), K('6'), K('P'), K('Q'), K('R'), K('S'), K('T')],
    [K('7'), K('8'), K('9'), K('U'), K('V'), K('W'), K('X'), K('Y')],
    [K('.', '.', ['.']), K('0'), K('+/-', '+/-', ['-', '+']), K('Z'), K('SP', 'SP', [' ']), K('DEL', 'DEL', ['Delete']), K('/', '/', ['/']), K('CLR', 'CLR', ['Backspace'])],
  ];
}

/** CDU `side` (1 left, 2 right): screen, 12 line select keys, function keys, alpha-numeric keys, annunciators, BRT knob. */
export function addCdu(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: B737Suite, side: Side): Panel | null {
  const d = suite.cduDisplays[side - 1];
  if (!d) return null;
  const env = b.env;
  const W = B737_HW.cdu.w;
  const sc = B737_HW.cduScreen;
  const pfx = `b737.cdu${side}`;
  const p = parent.subPanel({ name: pfx, width: W, height: B737_HW.cdu.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.01 });
  const sy = 0.012;
  p.display(d, W / 2, sy + sc.h / 2, sc.w, sc.h, { bezel: false });
  const ev = B737_EVENTS.cduKey(side);
  const prefix = B737_EVENTS.cduKeyPrefix(side);
  // Line select keys beside screen rows 2, 4 ... 12 (of 14).
  const rh = sc.h / 14;
  const keyH = 0.0065;
  for (const col of ['L', 'R'] as const) {
    const rows: KeyDef[][] = [1, 2, 3, 4, 5, 6].map((i) => [{ id: `${col}${i}`, label: '', style: 'lsk' }]);
    const kp = new KeyPad(env, { id: `${pfx}.lsk${col}`, label: `CDU ${side} LSK ${col}`, rows, singleEvent: ev, eventPrefix: prefix, keyWidth: 0.01, keyHeight: keyH, gap: 2 * rh - keyH });
    p.add(kp, col === 'L' ? (W - sc.w) / 2 - 0.014 : (W + sc.w) / 2 + 0.004, sy + 2.5 * rh - keyH / 2);
  }
  const kb = new KeyPad(env, {
    id: `${pfx}.keys`,
    label: `CDU ${side} keyboard`,
    rows: cduRows(suite.cfg.cduKeys),
    singleEvent: ev,
    eventPrefix: prefix,
    releaseEvents: true,
    keyWidth: 0.0118,
    keyHeight: 0.0098,
    gap: 0.0026,
    legendHeight: 0.0019,
    keyboard: true,
    styleMaterials: { fn: 'knobGrey' },
  });
  p.add(kb, 0.011, sy + sc.h + 0.012);
  // Annunciators: CALL / MSG left, FAIL / OFST right (FCOM 11.10).
  const ann = (id: string, text: string, color: 'white' | 'amber', v: string | null, ax: number, ay: number): void => {
    p.add(new AnnunciatorLight(env, { id: `${pfx}.${id}`, label: `CDU ${side} ${text}`, width: 0.008, height: 0.012, bezel: false, segments: [{ text: text.split(''), color, var: v ?? `${pfx}.${id}_unused` }] }), ax, ay);
  };
  const aY = sy + sc.h + 0.03;
  // SCOPE: no datalink (ACARS) is modelled, so CALL never lights (its var stays 0).
  ann('call', 'CALL', 'white', null, 0.006, aY);
  ann('msg', 'MSG', 'white', B737_VARS.cduMsgLight(side), 0.006, aY + 0.03);
  ann('fail', 'FAIL', 'amber', B737_VARS.cduFailLight(side), W - 0.006, aY);
  ann('ofst', 'OFST', 'white', B737_VARS.cduOfstLight(side), W - 0.006, aY + 0.03);
  // BRT knob (top right of the keyboard).
  p.add(
    new RotaryKnob(env, {
      id: `${pfx}.brt`,
      label: `CDU ${side} BRT`,
      cap: 'dimmer',
      diameter: 0.011,
      outer: { var: B737_VARS.cduBrt(side), min: 0.05, max: 1, step: 0.05, initial: 1, angleRange: [-140, 140], label: 'BRT', format: (v) => `${Math.round(v * 100)} %` },
    }),
    W - 0.02,
    sy + sc.h + 0.017,
  );
  return p;
}

// ---------------------------------------------------------------- instrument transfer switches

/**
 * Forward overhead instrument transfer panel (FCOM 10.10 / 11.10): VHF NAV,
 * IRS, FMC, DISPLAYS SOURCE and DISPLAYS CONTROL PANEL selectors in a row
 * starting at (x, y) with `pitch` spacing.
 */
export function addTransferSwitches(b: CockpitBuilder, panel: Panel, x: number, y: number, pitch = 0.045): CockpitControl[] {
  const env = b.env;
  const sel = (id: string, title: string, v: string, labels: [string, string, string], i: number): CockpitControl =>
    panel.add(
      new SelectorKnob(env, {
        id: `b737.xfr.${id}`,
        label: title,
        var: v,
        positions: [
          { value: -1, label: labels[0], display: labels[0].replace(' ON ', '\nON ') },
          { value: 0, label: labels[1] },
          { value: 1, label: labels[2], display: labels[2].replace(' ON ', '\nON ') },
        ],
        initial: 1,
        diameter: 0.013,
        labelHeight: 0.0016,
        title,
      }),
      x + i * pitch,
      y,
    );
  return [
    sel('vhf_nav', 'VHF NAV', B737_VARS.vhfNavSel, ['BOTH ON 1', 'NORMAL', 'BOTH ON 2'], 0),
    sel('irs', 'IRS', B737_VARS.irsSel, ['BOTH ON L', 'NORMAL', 'BOTH ON R'], 1),
    sel('fmc', 'FMC', B737_VARS.fmcSel, ['BOTH ON L', 'NORMAL', 'BOTH ON R'], 2),
    sel('source', 'DISPLAYS SOURCE', B737_VARS.displaysSource, ['ALL ON 1', 'AUTO', 'ALL ON 2'], 3),
    sel('ctl', 'CONTROL PANEL', B737_VARS.controlPanelSel, ['BOTH ON 1', 'NORMAL', 'BOTH ON 2'], 4),
  ];
}
