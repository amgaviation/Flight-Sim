/**
 * (Added by global6000.) Global Vision flight-deck variants of the Pro Line
 * Fusion control panels, laid out after the Bombardier Global 6000 Vision
 * cockpit photographs (Wikimedia Commons N835GL and EB190582 crops):
 *
 *  - FCP-5120 (`addFcpVision`), left to right: FD | SPD knob (FMS / MAN) under
 *    the IAS window | HDG, NAV, APPR keys | HDG knob under the HDG window with
 *    B/C and 1/2 BANK below | AP, YD, CPL and the red-bordered EDM | FLC,
 *    ALT, VNAV | ALT knob (FT / M) under the ALT window | VS window, VS key,
 *    DN / UP pitch wheel | BRT knob | FD. Four LCD readout windows (IAS, HDG,
 *    ALT, VS) show the selected targets (`ap.sel_*`); the VS window is blank
 *    unless VS is the active vertical mode. There are no CRS knobs on this
 *    FCP (the CTP sets the course, config `ctpCourseOnPfdPage`) and no A/T
 *    key (AOPA 2012: "as you push the thrust levers ahead for takeoff, the
 *    autothrottles take over automatically"; the `fusion.fcp.at` event
 *    remains for scripted use).
 *  - CTP (`addCtpVision`): NAV SRC [NAV] [FMS], PFD [FULL/HALF] [MAP], RANGE
 *    [-] [+] and the BARO knob (IN / HPA) left of the screen; four line keys
 *    on the left of the screen (L1-L3 = the line select keys, L4 = NEXT
 *    PAGE / line 4); TUNE/MENU, IDENT and 1/2 on the right; BRT/OFF knob top
 *    right, concentric TUNE/DATA knob bottom right.
 *  - MKP (`addMkpVision`): top row MSG, ROUTE, FMS, chart, DEP/ARR, CNCL,
 *    EXEC; letters on the left, digits on the right; bottom CAS, CNS, CHART,
 *    ECL/EXT, arrow cluster, PREV, NEXT; a one-line scratchpad strip along
 *    the top edge.
 *  - CCP (`addCcpVision`): domed palm-rest cursor device (drag = cursor,
 *    left click = ENTER, right click = MENU, wheel = DATA), DSPL SEL < >
 *    keys, ESC, DATA knob at the forward-inboard corner, a PTT button on each
 *    side of the housing.
 *
 * Every key maps onto the existing logic ids / events (logic/mkp.ts,
 * logic/ctp.ts, logic/fcp.ts); mappings without a published key definition
 * are marked EST below. Sizes EST from the photographs against the AFD.
 * `zone` puts the legends in the aircraft's panel back-lighting zone.
 */
import * as THREE from 'three';
import type { CockpitControl } from '../../cockpit/types';
import type { CockpitEnv } from '../../cockpit/env';
import type { CockpitBuilder, Panel } from '../../cockpit/CockpitBuilder';
import { KeyPad, PushButton, RotaryKnob, Thumbwheel } from '../../cockpit/controls';
import type { KeyDef } from '../../cockpit/controls/logic/MiscLogic';
import { CanvasDisplay, type DisplayCanvas } from '../common/CanvasDisplay';
import type { Ctx2D } from '../common/draw/context';
import type { SimVars } from '../../core/SimVars';
import type { EventBus } from '../../core/EventBus';
import { AP } from '../../core/vars';
import { FUSION_EVENTS, FUSION_STRINGS, FUSION_VARS } from './vars';
import { FCP_LIGHTS, type FcpButton } from './logic/fcp';
import { CTP_H, CTP_ROWS } from './displays/ctpDisplay';
import type { FusionSuite } from './suite';

export interface VisionHwOptions {
  /** Back-lighting zone for legends and labels. */
  zone?: string;
  /** Canvas for the readout / scratchpad strips (null = none, e.g. tests without a canvas stub). */
  canvas?: 'dom' | 'offscreen' | DisplayCanvas | null;
  /** CTP: var written by the BRT / OFF knob (0 OFF .. 1 BRT). Default the CTP display's brightness var. */
  brtVar?: string;
}

/** Vision panel sizes (m, EST from the photographs). */
export const VISION_HW = {
  fcp: { w: 0.62, h: 0.08 },
  ctp: { w: 0.22, h: 0.08 },
  ctpScreen: { w: 0.09, h: 0.045 },
  mkp: { w: 0.16, h: 0.13 },
  ccp: { w: 0.15, h: 0.17 },
} as const;

/** FCP readout window ids (suite: power from the FCP binding, brightness from FUSION_VARS.fcpBrt). */
export const FCP_WINDOWS = ['ias', 'hdg', 'alt', 'vs'] as const;
export type FcpWindow = (typeof FCP_WINDOWS)[number];
export const fcpWindowId = (prefix: string, w: FcpWindow) => `${prefix}.fcp_${w}`;
export const mkpScratchId = (prefix: string, s: 1 | 2) => `${prefix}.mkp${s}_scratch`;

// ---------------------------------------------------------------- FCP readouts

/** LCD readout window on the FCP (160 x 44 logical px): caption top-left, value right-aligned. */
export class FcpReadout extends CanvasDisplay {
  constructor(
    private readonly v: SimVars,
    private readonly kind: FcpWindow,
    id: string,
    canvas?: 'dom' | 'offscreen' | DisplayCanvas,
  ) {
    super({ id, width: 160, height: 44, vars: v, canvas, refreshHz: 10, background: '#0b0d0c' });
    this.animating = true;
  }

  text(): string {
    const v = this.v;
    switch (this.kind) {
      case 'ias':
        return v.getBool(AP.speedIsMach) ? `.${Math.round(v.get(AP.selMach) * 1000).toString().padStart(3, '0')}` : String(Math.round(v.get(AP.selSpeed)));
      case 'hdg':
        return String(Math.round(v.get(AP.selHeading, 360)) || 360).padStart(3, '0');
      case 'alt':
        return String(Math.round(v.get(AP.selAltitude) / 100) * 100);
      case 'vs':
        return v.getString(AP.verticalActive) === 'VS' ? String(Math.round(v.get(AP.selVs) / 100) * 100) : '';
    }
  }

  protected draw(ctx: Ctx2D): void {
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8f9690';
    ctx.font = '600 11px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(this.kind === 'ias' ? 'IAS' : this.kind.toUpperCase(), 6, 11);
    ctx.fillStyle = '#e8ece6';
    ctx.font = '600 30px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(this.text(), 154, 26);
  }
}

/** MKP scratchpad strip (one line, 300 x 26 logical px). */
export class MkpScratchpad extends CanvasDisplay {
  constructor(
    private readonly v: SimVars,
    private readonly side: 1 | 2,
    id: string,
    canvas?: 'dom' | 'offscreen' | DisplayCanvas,
  ) {
    super({ id, width: 300, height: 26, vars: v, canvas, refreshHz: 10, background: '#050706' });
    this.animating = true;
  }

  protected draw(ctx: Ctx2D): void {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8ece6';
    ctx.font = '600 18px "Courier New", monospace';
    ctx.fillText(this.v.getString(FUSION_STRINGS.fmsScratch(this.side)), 6, 14);
  }
}

// ---------------------------------------------------------------- FCP

/** Vision FCP lit keys: [button, legend, x, y] (m from the panel's top-left). */
const FCP_VISION_KEYS: readonly [FcpButton, string, number, number][] = [
  ['fd1', 'FD', 0.024, 0.06],
  ['hdg', 'HDG', 0.142, 0.024],
  ['nav', 'NAV', 0.142, 0.043],
  ['appr', 'APPR', 0.142, 0.062],
  ['bc', 'B/C', 0.19, 0.066],
  ['bank', '1/2\nBANK', 0.222, 0.066],
  ['ap', 'AP', 0.282, 0.016],
  ['yd', 'YD', 0.282, 0.032],
  ['edm', 'EDM', 0.282, 0.066],
  ['flc', 'FLC', 0.336, 0.026],
  ['alt', 'ALT', 0.336, 0.045],
  ['vnav', 'VNAV', 0.336, 0.064],
  ['vs', 'VS', 0.452, 0.04],
  ['fd2', 'FD', 0.596, 0.06],
];

export function addFcpVision(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: FusionSuite, o: VisionHwOptions = {}): Panel {
  const env = b.env;
  const z = o.zone;
  const pfx = `${suite.cfg.idPrefix}.fcp`;
  const W = VISION_HW.fcp;
  const p = parent.subPanel({ name: pfx, width: W.w, height: W.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.006 });
  const ev = FUSION_EVENTS.fcp;
  const lbl = (t: string, lx: number, ly: number, h = 0.0022) => p.label(t, lx, ly, { height: h, zone: z });
  // Readout windows.
  const win = (w: FcpWindow, wx: number) => {
    if (o.canvas === null) return;
    p.display(new FcpReadout(env.vars, w, fcpWindowId(suite.cfg.idPrefix, w), o.canvas ?? undefined), wx, 0.013, 0.046, 0.0127, { bezel: false });
  };
  win('ias', 0.082);
  win('hdg', 0.205);
  win('alt', 0.398);
  win('vs', 0.47);
  const knob = (id: string, label: string, kx: number, ky: number, push: string, pushLabel: string): CockpitControl =>
    p.add(
      new RotaryKnob(env, {
        id: `${pfx}.${id}`,
        label,
        cap: 'fluted',
        diameter: 0.017,
        zone: z,
        outer: { incEvent: ev(`${id}_inc`), decEvent: ev(`${id}_dec`), label },
        push: { event: ev(push), label: pushLabel },
      }),
      kx,
      ky,
    );
  // SPD: turn = target, push = FMS / MAN speed source (EST: the knob push carries SPD MAN/FMS on the Vision FCP).
  knob('spd', 'SPD', 0.082, 0.05, 'spd_man', 'FMS / MAN');
  lbl('FMS', 0.058, 0.034);
  lbl('SPD', 0.082, 0.03);
  lbl('MAN', 0.106, 0.034);
  knob('hdg', 'HDG', 0.205, 0.042, 'hdg_push', 'SYNC');
  lbl('HDG', 0.205, 0.027);
  knob('alt', 'ALT', 0.398, 0.048, 'alt_push', 'FT / M (fine)');
  lbl('FT', 0.376, 0.031);
  lbl('ALT', 0.398, 0.029);
  lbl('M', 0.42, 0.031);
  p.add(new Thumbwheel(env, { id: `${pfx}.pitch`, label: 'PITCH wheel (DN / UP)', channel: { incEvent: ev('pitch_inc'), decEvent: ev('pitch_dec'), label: 'PITCH' }, diameter: 0.022, width: 0.009, orientation: 'vertical' }), 0.49, 0.05);
  lbl('DN', 0.49, 0.03);
  lbl('UP', 0.49, 0.074);
  // FCP BRT (FUSION_VARS.fcpBrt: readout windows and key lighting; the suite applies it).
  p.add(
    new RotaryKnob(env, {
      id: `${pfx}.brt`,
      label: 'FCP BRT',
      cap: 'dimmer',
      diameter: 0.011,
      zone: z,
      outer: { var: FUSION_VARS.fcpBrt, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], initial: 1, label: 'BRT', format: (v) => `${Math.round(v * 100)} %` },
    }),
    0.545,
    0.034,
  );
  lbl('BRT', 0.556, 0.02);
  for (const [id, legend, bx, by] of FCP_VISION_KEYS) {
    const light = FCP_LIGHTS[id];
    p.add(
      new PushButton(env, {
        id: id === 'hdg' || id === 'alt' ? `${pfx}.${id}_key` : `${pfx}.${id}`,
        label: id === 'fd1' ? 'FD 1' : id === 'fd2' ? 'FD 2' : legend.replace('\n', ' '),
        style: 'mcp',
        width: 0.014,
        height: 0.011,
        mode: 'momentary',
        event: ev(id),
        engraved: legend,
        engravedHeight: 0.0019,
        zone: z,
        lightBar: light ? { var: light, color: 'green' } : undefined,
      }),
      bx,
      by,
    );
  }
  // CPL with the coupled-side arrows.
  p.add(
    new PushButton(env, {
      id: `${pfx}.cpl`,
      label: 'CPL',
      style: 'mcp',
      width: 0.014,
      height: 0.011,
      mode: 'momentary',
      event: ev('cpl'),
      zone: z,
      layout: 'split',
      segments: [
        { text: '<', color: 'green', var: FUSION_VARS.coupleSide, test: (v) => v !== 2 },
        { text: '>', color: 'green', var: FUSION_VARS.coupleSide, test: (v) => v === 2 },
      ],
    }),
    0.282,
    0.048,
  );
  lbl('CPL', 0.282, 0.0555, 0.0017);
  // Red border round EDM (photo).
  const red = new THREE.Mesh(env.geometry.get('fusion.vision.edm_border', () => new THREE.PlaneGeometry(0.019, 0.016)), env.materials.get('paintRed'));
  red.userData.cockpitStatic = true;
  p.addObject(red, 0.282, 0.066, { z: 0.0003 });
  // Dividers between the groups (engraved).
  for (const dx of [0.118, 0.254, 0.31, 0.43, 0.525]) p.line(dx, 0.006, dx, 0.074, 0.0005, z ?? 'panel');
  return p;
}

// ---------------------------------------------------------------- CTP

export function addCtpVision(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: FusionSuite, side: 1 | 2, o: VisionHwOptions = {}): Panel | null {
  const d = suite.ctp[side - 1];
  if (!d) return null;
  const env = b.env;
  const z = o.zone;
  const pfx = `${suite.cfg.idPrefix}.ctp${side}`;
  const W = VISION_HW.ctp;
  const sc = VISION_HW.ctpScreen;
  const p = parent.subPanel({ name: pfx, width: W.w, height: W.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.006 });
  const sx = 0.078;
  const sy = 0.012;
  p.display(d, sx + sc.w / 2, sy + sc.h / 2, sc.w, sc.h, { bezel: false });
  const lbl = (t: string, lx: number, ly: number, h = 0.002) => p.label(t, lx, ly, { height: h, zone: z });
  // Left block: NAV SRC [NAV][FMS], PFD [FULL/HALF][MAP], RANGE [-][+].
  const block = (rowId: string, caption: string, keys: KeyDef[], ky: number) => {
    const kp = new KeyPad(env, { id: `${pfx}.${rowId}`, label: `CTP ${side} ${caption}`, rows: [keys], singleEvent: FUSION_EVENTS.ctpKey(side), eventPrefix: `${pfx}.f`, keyWidth: 0.015, keyHeight: 0.0085, gap: 0.004, legendHeight: 0.0017, zone: z });
    p.add(kp, 0.012, ky);
    lbl(caption, 0.029, ky - 0.0035, 0.0018);
  };
  block('navsrc', 'NAV SRC', [{ id: 'SRC_NAV', label: 'NAV' }, { id: 'SRC_FMS', label: 'FMS' }], 0.012);
  block('pfd', 'PFD', [{ id: 'PFD_FMT', label: 'FULL/\nHALF' }, { id: 'MAP' }], 0.03);
  block('range', 'RANGE', [{ id: 'RNG-', label: '-' }, { id: 'RNG+', label: '+' }], 0.048);
  p.add(new RotaryKnob(env, { id: `${pfx}.baro`, label: `CTP ${side} BARO`, cap: 'knurled', diameter: 0.014, zone: z, outer: { incEvent: FUSION_EVENTS.ctp(side, 'baro_inc'), decEvent: FUSION_EVENTS.ctp(side, 'baro_dec'), label: 'BARO' }, push: { event: FUSION_EVENTS.ctp(side, 'baro_push'), label: 'STD' } }), 0.03, 0.068);
  lbl('BARO', 0.03, 0.0575, 0.0018);
  lbl('IN', 0.016, 0.059, 0.0016);
  lbl('HPA', 0.045, 0.059, 0.0016);
  // Four line keys left of the screen (L1-L3 -> line select 1-3, L4 -> line select 4).
  const keyH = 0.0055;
  const pitch = ((CTP_ROWS[1] - CTP_ROWS[0]) / CTP_H) * sc.h * 0.75;
  const lsk = new KeyPad(env, {
    id: `${pfx}.lsk1`,
    label: `CTP ${side} line keys`,
    rows: [1, 2, 3, 4].map((k) => [{ id: String(k), label: '', style: 'lsk' }]),
    singleEvent: FUSION_EVENTS.ctpLsk(side),
    eventPrefix: `${pfx}.k`,
    keyWidth: 0.008,
    keyHeight: keyH,
    gap: pitch - keyH,
    zone: z,
  });
  p.add(lsk, sx - 0.014, sy + 0.004);
  // Right keys: TUNE/MENU, IDENT, 1/2 (EST mapping: MENU = radio <-> PFD page, 1/2 = next radio line).
  const rk = new KeyPad(env, {
    id: `${pfx}.fn`,
    label: `CTP ${side} keys`,
    rows: [[{ id: 'MENU', label: 'TUNE/\nMENU' }], [{ id: 'IDENT' }], [{ id: 'SIDE', label: '1/2' }]],
    singleEvent: FUSION_EVENTS.ctpKey(side),
    eventPrefix: `${pfx}.f`,
    keyWidth: 0.015,
    keyHeight: 0.0085,
    gap: 0.0045,
    legendHeight: 0.0016,
    zone: z,
  });
  p.add(rk, sx + sc.w + 0.012, 0.015);
  // BRT / OFF (CTP display brightness, display.<ctp id>.brt through the suite's display vars).
  p.add(
    new RotaryKnob(env, {
      id: `${pfx}.brt`,
      label: `CTP ${side} BRT / OFF`,
      cap: 'dimmer',
      diameter: 0.01,
      zone: z,
      outer: { var: o.brtVar ?? `display.${d.id}.brt`, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], initial: 1, label: 'BRT', format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)} %`) },
    }),
    W.w - 0.012,
    0.012,
  );
  lbl('BRT', W.w - 0.004, 0.005, 0.0016);
  p.add(
    new RotaryKnob(env, {
      id: `${pfx}.tune`,
      label: `CTP ${side} TUNE/DATA`,
      diameter: 0.018,
      zone: z,
      outer: { incEvent: FUSION_EVENTS.ctp(side, 'tune_out_inc'), decEvent: FUSION_EVENTS.ctp(side, 'tune_out_dec'), label: 'TUNE (MHz / 10 deg)' },
      inner: { incEvent: FUSION_EVENTS.ctp(side, 'tune_in_inc'), decEvent: FUSION_EVENTS.ctp(side, 'tune_in_dec'), label: 'TUNE (kHz / 1 deg)' },
      push: { event: FUSION_EVENTS.ctp(side, 'tune_push'), label: 'XFR' },
    }),
    W.w - 0.02,
    0.064,
  );
  lbl('TUNE/DATA', W.w - 0.02, 0.0515, 0.0017);
  return p;
}

// ---------------------------------------------------------------- MKP

const kd = (id: string, label?: string, keys?: string[], extra: Partial<KeyDef> = {}): KeyDef => ({ id, label, keys, ...extra });
const GAP = (w = 1): KeyDef => ({ id: '', spacer: true, w });

/**
 * Vision MKP rows (photo). Ids: letters / digits / DOT / SLASH / PLUSMINUS / SP / CLR / DEL / EXEC / PREV / NEXT /
 * FMS / MSG / DEPARR as logic/mkp.ts; ROUTE -> FPLN; the Vision keys CNCL, CAS, CNS, CHARTWIN, MAPWIN (chart /
 * map icon), UP / DOWN / LEFT / RIGHT and ECL/EXT (CHKSYS) are mapped in MkpLogic (EST functions).
 */
function mkpVisionRows(): KeyDef[][] {
  return [
    [kd('MSG'), kd('FPLN', 'ROUTE'), kd('FMS'), kd('MAPWIN', '\u25a1\u25b8'), kd('DEPARR', 'DEP/\nARR'), GAP(0.6), kd('CNCL'), { ...kd('EXEC'), lightVar: FUSION_VARS.execLight }],
    [kd('A'), kd('B'), kd('C'), kd('D'), kd('E'), kd('F'), kd('G'), kd('1'), kd('2'), kd('3')],
    [kd('H'), kd('I'), kd('J'), kd('K'), kd('L'), kd('M'), kd('N'), kd('4'), kd('5'), kd('6')],
    [kd('O'), kd('P'), kd('Q'), kd('R'), kd('S'), kd('T'), kd('U'), kd('7'), kd('8'), kd('9'), kd('CLR', 'CLR/\nDEL', ['Backspace'])],
    [kd('V'), kd('W'), kd('X'), kd('Y'), kd('Z'), kd('SP', 'SP', [' ']), kd('SLASH', '/', ['/']), kd('DOT', '.', ['.']), kd('0', '\u00d8'), kd('PLUSMINUS', '+/-', ['-', '+']), kd('DEL', 'DEL', ['Delete'])],
    [kd('CAS'), kd('CNS'), GAP(0.5), kd('UP', '\u2191'), GAP(0.5), kd('PREV'), kd('NEXT')],
    [kd('CHARTWIN', 'CHART'), kd('CHKSYS', 'ECL/\nEXT'), kd('LEFT', '\u2190'), kd('DOWN', '\u2193'), kd('RIGHT', '\u2192')],
  ];
}

export function addMkpVision(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: FusionSuite, side: 1 | 2, o: VisionHwOptions = {}): Panel {
  const env = b.env;
  const pfx = `${suite.cfg.idPrefix}.mkp${side}`;
  const W = VISION_HW.mkp;
  const p = parent.subPanel({ name: pfx, width: W.w, height: W.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.008, screws: { kind: 'dzus', diameter: 0.005, inset: 0.005 } });
  if (o.canvas !== null) p.display(new MkpScratchpad(env.vars, side, mkpScratchId(suite.cfg.idPrefix, side), o.canvas ?? undefined), W.w / 2 + 0.01, 0.008, 0.09, 0.0078, { bezel: false });
  p.add(
    new KeyPad(env, {
      id: `${pfx}.keys`,
      label: `MKP ${side}`,
      rows: mkpVisionRows(),
      singleEvent: FUSION_EVENTS.mkpKey(side),
      eventPrefix: `${pfx}.k`,
      keyWidth: 0.0112,
      keyHeight: 0.0098,
      gap: 0.0027,
      legendHeight: 0.0018,
      keyboard: true,
      zone: o.zone,
      lights: [{ text: 'MSG', color: 'white', var: FUSION_VARS.msgLight(side), x: 0.0, y: -0.0055, w: 0.011, h: 0.0035 }],
    }),
    0.006,
    0.018,
  );
  return p;
}

// ---------------------------------------------------------------- CCP

/** CCP palm rest: the domed housing is the cursor device (drag = cursor, click = ENTER, right click = MENU, wheel = DATA). */
export class CcpPalmRest implements CockpitControl {
  readonly id: string;
  readonly object = new THREE.Group();
  readonly hitTargets: THREE.Object3D[] = [];
  readonly pointerLock = true;
  private readonly geoms: THREE.BufferGeometry[] = [];
  private readonly payload = { dx: 0, dy: 0 };
  private dragged = 0;

  constructor(
    env: CockpitEnv,
    id: string,
    private readonly side: 1 | 2,
    private readonly events: EventBus,
    w: number,
    l: number,
    h: number,
  ) {
    this.id = id;
    // Lathe profile scaled to an elongated dome (palm rest), EST shape from the photo.
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.cos(a) * 0.5 + 1e-4, Math.sin(a)));
    }
    const dome = new THREE.LatheGeometry(pts, 28);
    dome.rotateX(Math.PI / 2);
    dome.scale(w, l, h);
    this.geoms.push(dome);
    const m = new THREE.Mesh(dome, env.materials.get('plasticBlack'));
    m.name = `ccpdome:${id}`;
    this.object.add(m);
    this.hitTargets.push(m);
    const skirt = new THREE.CylinderGeometry(0.5, 0.56, 1, 28, 1, true).rotateX(Math.PI / 2);
    skirt.scale(w, l, 0.012).translate(0, 0, -0.006);
    this.geoms.push(skirt);
    const s = new THREE.Mesh(skirt, env.materials.get('plasticGrey'));
    this.object.add(s);
  }

  tooltip(): string {
    return `CCP ${this.side} cursor control (drag: cursor, click: ENTER, right click: MENU, wheel: DATA)`;
  }

  cursor(): string {
    return 'move';
  }

  onPointerDown(): void {
    this.dragged = 0;
  }

  onPointerUp(p: { button: number }): void {
    if (this.dragged > 4) return;
    if (p.button === 2) this.events.emit(FUSION_EVENTS.ccpMenu(this.side));
    else if (p.button === 0) this.events.emit(FUSION_EVENTS.ccpEnter(this.side));
  }

  onDrag(dx: number, dy: number): void {
    this.dragged += Math.abs(dx) + Math.abs(dy);
    this.payload.dx = dx;
    this.payload.dy = dy;
    this.events.emit(FUSION_EVENTS.ccpMove(this.side), this.payload);
  }

  onWheel(delta: number): void {
    this.events.emit(FUSION_EVENTS.ccpData(this.side), delta > 0 ? 1 : -1);
  }

  dispose(): void {
    for (const g of this.geoms) g.dispose();
  }
}

export function addCcpVision(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: FusionSuite, side: 1 | 2, o: VisionHwOptions & { pttVar?: string } = {}): Panel {
  const env = b.env;
  const z = o.zone;
  const pfx = `${suite.cfg.idPrefix}.ccp${side}`;
  const W = VISION_HW.ccp;
  const p = parent.subPanel({ name: pfx, width: W.w, height: W.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.008, screws: { kind: 'dzus', diameter: 0.005, inset: 0.005 } });
  const inb = side === 1 ? 1 : -1; // toward the centreline
  const cx = W.w / 2;
  // DSPL SEL < > (EST: outboard arrow = own PFD display, inboard arrow = upper centre AFD, both = lower centre on a
  // second press cycle through the cursor logic).
  const dsp = new KeyPad(env, {
    id: `${pfx}.dsp`,
    label: `CCP ${side} DSPL SEL`,
    rows: [side === 1 ? [{ id: 'PFD', label: '<' }, { id: 'UPR', label: '>' }] : [{ id: 'UPR', label: '<' }, { id: 'PFD', label: '>' }], [GAP(0.5), { id: 'LWR', label: '∨' }]],
    singleEvent: FUSION_EVENTS.ccpDisplay(side),
    eventPrefix: `${pfx}.d`,
    keyWidth: 0.012,
    keyHeight: 0.009,
    gap: 0.003,
    legendHeight: 0.003,
    zone: z,
  });
  p.add(dsp, cx - dsp.width / 2 + inb * 0.02, 0.014);
  p.label('DSPL SEL', cx + inb * 0.02, 0.0075, { height: 0.0019, zone: z });
  p.add(new PushButton(env, { id: `${pfx}.back`, label: `CCP ${side} ESC`, style: 'key', width: 0.014, height: 0.008, mode: 'momentary', event: FUSION_EVENTS.ccpBack(side), engraved: 'ESC', engravedHeight: 0.0018, zone: z }), cx - inb * 0.035, 0.018);
  p.add(
    new RotaryKnob(env, {
      id: `${pfx}.data`,
      label: `CCP ${side} DATA`,
      diameter: 0.013,
      height: 0.02,
      zone: z,
      outer: { incEvent: FUSION_EVENTS.ccpDataInc(side), decEvent: FUSION_EVENTS.ccpDataDec(side), label: 'DATA (coarse)' },
      inner: { incEvent: FUSION_EVENTS.ccpDataInc(side, true), decEvent: FUSION_EVENTS.ccpDataDec(side, true), label: 'DATA (fine)' },
    }),
    cx + inb * 0.052,
    0.02,
  );
  const palm = new CcpPalmRest(env, `${pfx}.ball`, side, suite.events, 0.085, 0.095, 0.045);
  p.add(palm, cx, 0.1);
  if (o.pttVar) {
    for (const k of [-1, 1] as const) {
      p.add(new PushButton(env, { id: `${pfx}.ptt${k < 0 ? 'l' : 'r'}`, label: `CCP ${side} PTT`, var: o.pttVar, mode: 'momentary', style: 'small', width: 0.008, capMaterial: 'plasticBlack' }), cx + k * 0.058, 0.1);
      p.label('PTT', cx + k * 0.058, 0.09, { height: 0.0016, zone: z });
    }
  }
  return p;
}
