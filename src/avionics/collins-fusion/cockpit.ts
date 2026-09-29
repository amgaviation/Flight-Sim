/**
 * Cockpit hardware of the Global Vision Flight Deck, built with the cockpit
 * library (CockpitBuilder / Panel / controls). The aircraft module owns the
 * cockpit geometry and calls these helpers on its own panels:
 *
 *   addAfds(main, suite, [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]);   // T arrangement
 *   addFcp(b, glareshield, x, y, suite);
 *   addCtp(b, glareshield, xL, y, suite, 1);  addCtp(b, glareshield, xR, y, suite, 2);
 *   addIesi(b, main, x, y, suite);
 *   addCcp(b, pedestal, x, y, suite, 1);      addMkp(b, pedestal, x, y, suite, 1);
 *   addRsp(b, sidePanel, x, y, suite, 1);
 *
 * Every helper places the unit CENTRED at (x, y) in the parent panel's
 * convention (the sub-panels use origin 'top-left' internally, as the Epic
 * helpers) and returns the created sub-panel or screen mesh. Controls emit
 * the suite events (vars.ts FUSION_EVENTS) or write the suite vars.
 *
 * Sizes: AFD-6520 15.1-in landscape LCD (Collins syllabus 523-0817473; FSB
 * BD-700-1A10 appendix 6) -> 0.307 x 0.192 m active area at the 16:10 canvas
 * aspect (15.1 in diagonal). FCP, CTP, CCP, MKP, RSP and IESI sizes are EST
 * from Global 6000 cockpit photographs against the AFD size.
 */
import * as THREE from 'three';
import type { EventBus } from '../../core/EventBus';
import type { CockpitControl } from '../../cockpit/types';
import type { CockpitEnv } from '../../cockpit/env';
import type { CockpitBuilder, Panel } from '../../cockpit/CockpitBuilder';
import { KeyPad, PushButton, RotaryKnob, Thumbwheel, ToggleSwitch } from '../../cockpit/controls';
import type { KeyDef } from '../../cockpit/controls/logic/MiscLogic';
import { FUSION_EVENTS, FUSION_VARS } from './vars';
import { FCP_LIGHTS, type FcpButton } from './logic/fcp';
import { CTP_H, CTP_ROWS } from './displays/ctpDisplay';
import type { FusionSuite } from './suite';

/** Physical sizes (m). */
export const FUSION_HW = {
  afd: { w: 0.307, h: 0.192 },
  fcp: { w: 0.62, h: 0.08 },
  ctp: { w: 0.2, h: 0.08 },
  ctpScreen: { w: 0.1, h: 0.05 },
  ccp: { w: 0.11, h: 0.15 },
  mkp: { w: 0.15, h: 0.12 },
  rsp: { w: 0.1, h: 0.06 },
  iesi: { w: 0.085, h: 0.095 },
  iesiScreen: { w: 0.07, h: 0.07 },
} as const;

// ---------------------------------------------------------------- displays

/** The four AFDs (AFD 1..4) centred at the given positions, with bezels. */
export function addAfds(panel: Panel, suite: FusionSuite, at: readonly (readonly [number, number])[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < suite.afd.length && i < at.length; i++) {
    out.push(panel.display(suite.afd[i], at[i][0], at[i][1], FUSION_HW.afd.w, FUSION_HW.afd.h, { bezel: { border: [0.014, 0.014, 0.022, 0.014], material: 'bezel' } }));
  }
  return out;
}

/** Integrated electronic standby instrument with its baro knob (push = STD). */
export function addIesi(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: FusionSuite): Panel {
  const H = FUSION_HW.iesi;
  const p = parent.subPanel({ name: `${suite.cfg.idPrefix}.iesi`, width: H.w, height: H.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.008 });
  p.display(suite.iesi, H.w / 2, 0.004 + FUSION_HW.iesiScreen.h / 2, FUSION_HW.iesiScreen.w, FUSION_HW.iesiScreen.h, { bezel: false });
  p.add(
    new RotaryKnob(b.env, {
      id: `${suite.cfg.idPrefix}.iesi.baro`,
      label: 'IESI BARO',
      diameter: 0.012,
      outer: { incEvent: FUSION_EVENTS.iesi('baro_inc'), decEvent: FUSION_EVENTS.iesi('baro_dec'), label: 'BARO' },
      push: { event: FUSION_EVENTS.iesi('baro_push'), label: 'STD' },
    }),
    H.w - 0.012,
    H.h - 0.011,
  );
  return p;
}

// ---------------------------------------------------------------- FCP

/** FCP lit keys: [button, legend, x, y] in metres from the panel's top-left (EST layout). */
const FCP_KEYS: readonly [FcpButton, string, number, number][] = [
  ['fd1', 'FD', 0.03, 0.05],
  ['nav', 'NAV', 0.1, 0.028],
  ['hdg', 'HDG', 0.1, 0.056],
  ['appr', 'APPR', 0.132, 0.028],
  ['bc', 'B/C', 0.132, 0.056],
  ['bank', 'BANK', 0.164, 0.056],
  ['ap', 'AP', 0.26, 0.028],
  ['yd', 'YD', 0.26, 0.056],
  ['cpl', 'CPL', 0.31, 0.03],
  ['at', 'AT', 0.31, 0.056],
  ['edm', 'EDM', 0.36, 0.028],
  ['spd_man', 'SPD\nMAN/FMS', 0.36, 0.056],
  ['vs', 'VS', 0.43, 0.028],
  ['flc', 'FLC', 0.43, 0.056],
  ['vnav', 'VNAV', 0.462, 0.028],
  ['alt', 'ALT', 0.462, 0.056],
  ['fd2', 'FD', 0.59, 0.05],
];

/** Flight control panel (FCP-5120) on the glareshield: lit mode keys and knobs. */
export function addFcp(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: FusionSuite): Panel {
  const env = b.env;
  const pfx = `${suite.cfg.idPrefix}.fcp`;
  const p = parent.subPanel({ name: pfx, width: FUSION_HW.fcp.w, height: FUSION_HW.fcp.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.006 });
  const ev = FUSION_EVENTS.fcp;
  const knob = (id: string, label: string, kx: number, ky: number, push: string | null, pushLabel: string, cap: 'fluted' | 'knurled' = 'fluted'): CockpitControl =>
    p.add(
      new RotaryKnob(env, {
        id: `${pfx}.${id}`,
        label,
        cap,
        diameter: 0.017,
        outer: { incEvent: ev(`${id}_inc`), decEvent: ev(`${id}_dec`), label },
        push: push ? { event: ev(push), label: pushLabel } : undefined,
      }),
      kx,
      ky,
    );
  knob('crs1', 'CRS 1', 0.064, 0.045, 'crs1_push', 'DIRECT');
  p.label('CRS 1', 0.064, 0.014, { height: 0.0026 });
  knob('hdg', 'HDG', 0.21, 0.045, 'hdg_push', 'SYNC');
  p.label('HDG', 0.21, 0.014, { height: 0.0026 });
  knob('spd', 'SPEED', 0.395, 0.045, 'spd_push', 'IAS / MACH');
  p.label('SPD', 0.395, 0.014, { height: 0.0026 });
  p.add(new Thumbwheel(env, { id: `${pfx}.pitch`, label: 'PITCH wheel', channel: { incEvent: ev('pitch_inc'), decEvent: ev('pitch_dec'), label: 'PITCH' }, diameter: 0.02, width: 0.009, orientation: 'vertical' }), 0.495, 0.045);
  knob('alt', 'ALT', 0.535, 0.045, 'alt_push', 'FINE');
  p.label('ALT', 0.535, 0.014, { height: 0.0026 });
  knob('crs2', 'CRS 2', 0.566 + 0.02, 0.014 + 0.012, 'crs2_push', 'DIRECT');
  for (const [id, legend, bx, by] of FCP_KEYS) {
    if (id === 'cpl') {
      // CPL with the coupled-side arrows lit (Global Express guidance panel heritage).
      p.add(
        new PushButton(env, {
          id: `${pfx}.cpl`,
          label: 'CPL',
          style: 'mcp',
          mode: 'momentary',
          event: ev('cpl'),
          layout: 'split',
          segments: [
            { text: '<', color: 'green', var: FUSION_VARS.coupleSide, test: (v) => v !== 2 },
            { text: '>', color: 'green', var: FUSION_VARS.coupleSide, test: (v) => v === 2 },
          ],
        }),
        bx,
        by,
      );
      p.label('CPL', bx, by - 0.013, { height: 0.0022 });
      continue;
    }
    const light = FCP_LIGHTS[id];
    p.add(
      new PushButton(env, {
        // HDG / ALT keys share their names with the knobs: the keys get a '_key' suffix.
        id: id === 'hdg' || id === 'alt' ? `${pfx}.${id}_key` : `${pfx}.${id}`,
        label: id === 'fd1' ? 'FD 1' : id === 'fd2' ? 'FD 2' : legend.replace('\n', ' '),
        style: 'mcp',
        mode: 'momentary',
        event: ev(id),
        engraved: legend,
        engravedHeight: 0.0022,
        lightBar: light ? { var: light, color: 'green' } : undefined,
      }),
      bx,
      by,
    );
  }
  return p;
}

// ---------------------------------------------------------------- CTP

/** Control tuning panel of `side`: screen, 3 + 3 line keys, function keys, TUNE / BARO / MINS knobs. */
export function addCtp(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: FusionSuite, side: 1 | 2): Panel | null {
  const d = suite.ctp[side - 1];
  if (!d) return null;
  const env = b.env;
  const pfx = `${suite.cfg.idPrefix}.ctp${side}`;
  const W = FUSION_HW.ctp.w;
  const sc = FUSION_HW.ctpScreen;
  const p = parent.subPanel({ name: pfx, width: W, height: FUSION_HW.ctp.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.006 });
  const sx = 0.03;
  const sy = 0.006;
  p.display(d, sx + sc.w / 2, sy + sc.h / 2, sc.w, sc.h, { bezel: false });
  // Line select keys aligned with the screen rows (CTP_ROWS of CTP_H logical px).
  const keyH = 0.0065;
  const rows = (first: number): KeyDef[][] => [0, 1, 2].map((k) => [{ id: String(first + k), label: '', style: 'lsk' }]);
  const pitch = ((CTP_ROWS[1] - CTP_ROWS[0]) / CTP_H) * sc.h;
  const lsk = (first: number, lx: number): void => {
    const kp = new KeyPad(env, { id: `${pfx}.lsk${first}`, label: `CTP ${side} line keys`, rows: rows(first), singleEvent: FUSION_EVENTS.ctpLsk(side), eventPrefix: `${pfx}.k`, keyWidth: 0.01, keyHeight: keyH, gap: pitch - keyH });
    p.add(kp, lx - kp.width / 2, sy + (CTP_ROWS[0] / CTP_H) * sc.h - keyH / 2);
  };
  lsk(1, sx - 0.01);
  lsk(4, sx + sc.w + 0.01);
  // Function keys below the screen.
  const fk: KeyDef[][] = [
    [{ id: 'COM' }, { id: 'NAV' }, { id: 'ADF' }, { id: 'ATC' }, { id: 'DME' }, { id: 'IDENT' }],
    [{ id: 'PFD' }, { id: 'HSI' }, { id: 'NAVSRC', label: 'NAV\nSRC' }, { id: 'BRG1', label: 'BRG 1' }, { id: 'BRG2', label: 'BRG 2' }],
  ];
  p.add(new KeyPad(env, { id: `${pfx}.fn`, label: `CTP ${side} keys`, rows: fk, singleEvent: FUSION_EVENTS.ctpKey(side), eventPrefix: `${pfx}.f`, keyWidth: 0.0135, keyHeight: 0.0075, gap: 0.0022, legendHeight: 0.0018 }), sx - 0.004, sy + sc.h + 0.004);
  const kx = sx + sc.w + 0.036;
  p.add(
    new RotaryKnob(env, {
      id: `${pfx}.tune`,
      label: `CTP ${side} TUNE`,
      diameter: 0.018,
      outer: { incEvent: FUSION_EVENTS.ctp(side, 'tune_out_inc'), decEvent: FUSION_EVENTS.ctp(side, 'tune_out_dec'), label: 'TUNE (MHz)' },
      inner: { incEvent: FUSION_EVENTS.ctp(side, 'tune_in_inc'), decEvent: FUSION_EVENTS.ctp(side, 'tune_in_dec'), label: 'TUNE (kHz)' },
      push: { event: FUSION_EVENTS.ctp(side, 'tune_push'), label: 'XFR' },
    }),
    kx,
    0.022,
  );
  p.add(new RotaryKnob(env, { id: `${pfx}.baro`, label: `CTP ${side} BARO`, cap: 'knurled', diameter: 0.013, outer: { incEvent: FUSION_EVENTS.ctp(side, 'baro_inc'), decEvent: FUSION_EVENTS.ctp(side, 'baro_dec'), label: 'BARO' }, push: { event: FUSION_EVENTS.ctp(side, 'baro_push'), label: 'STD' } }), kx - 0.012, 0.06);
  p.add(new RotaryKnob(env, { id: `${pfx}.mins`, label: `CTP ${side} MINS`, diameter: 0.013, outer: { incEvent: FUSION_EVENTS.ctp(side, 'mins_inc'), decEvent: FUSION_EVENTS.ctp(side, 'mins_dec'), label: 'MINS' }, push: { event: FUSION_EVENTS.ctp(side, 'mins_push'), label: 'RA / BARO' } }), kx + 0.014, 0.06);
  p.label('BARO', kx - 0.012, 0.074, { height: 0.002 });
  p.label('MINS', kx + 0.014, 0.074, { height: 0.002 });
  return p;
}

// ---------------------------------------------------------------- CCP

/** CCP trackball: drag = cursor motion (pointer pixels scaled by the CCP gain). */
export class CcpTrackball implements CockpitControl {
  readonly id: string;
  readonly object = new THREE.Group();
  readonly hitTargets: THREE.Object3D[] = [];
  readonly pointerLock = true;
  private readonly geom: THREE.SphereGeometry;
  private readonly payload = { dx: 0, dy: 0 };

  constructor(
    env: CockpitEnv,
    id: string,
    private readonly side: 1 | 2,
    private readonly events: EventBus,
    diameter: number,
  ) {
    this.id = id;
    this.geom = new THREE.SphereGeometry(diameter / 2, 20, 14);
    const m = new THREE.Mesh(this.geom, env.materials.get('knobGrey'));
    m.position.z = diameter * 0.15;
    m.name = `ccpball:${id}`;
    this.object.add(m);
    this.hitTargets.push(m);
  }

  tooltip(): string {
    return `CCP ${this.side} trackball (drag to move the cursor)`;
  }

  cursor(): string {
    return 'move';
  }

  onDrag(dx: number, dy: number): void {
    this.payload.dx = dx;
    this.payload.dy = dy;
    this.events.emit(FUSION_EVENTS.ccpMove(this.side), this.payload);
  }

  onWheel(delta: number): void {
    this.events.emit(FUSION_EVENTS.ccpData(this.side), delta > 0 ? 1 : -1);
  }

  dispose(): void {
    this.geom.dispose();
  }
}

/** Cursor control panel (CCP-6000) of `side`: trackball, ENTER, MENU, BACK, display select keys, DATA knob. */
export function addCcp(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: FusionSuite, side: 1 | 2): Panel {
  const env = b.env;
  const W = FUSION_HW.ccp.w;
  const pfx = `${suite.cfg.idPrefix}.ccp${side}`;
  const p = parent.subPanel({ name: pfx, width: W, height: FUSION_HW.ccp.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.01 });
  const dsp = new KeyPad(env, {
    id: `${pfx}.dsp`,
    label: `CCP ${side} display select`,
    rows: [[{ id: 'PFD' }, { id: 'UPR' }, { id: 'LWR' }]],
    singleEvent: FUSION_EVENTS.ccpDisplay(side),
    eventPrefix: `${pfx}.d`,
    keyWidth: 0.022,
    keyHeight: 0.009,
    gap: 0.004,
    legendHeight: 0.0024,
  });
  p.add(dsp, W / 2 - dsp.width / 2, 0.01);
  p.add(new CcpTrackball(env, `${pfx}.ball`, side, suite.events, 0.04), W / 2, 0.055);
  const key = (id: string, legend: string, ev: string, kx: number, ky: number): void => {
    p.add(new PushButton(env, { id: `${pfx}.${id}`, label: `CCP ${side} ${legend}`, style: 'key', width: 0.028, height: 0.011, mode: 'momentary', event: ev, engraved: legend, engravedHeight: 0.0024 }), kx, ky);
  };
  key('menu', 'MENU', FUSION_EVENTS.ccpMenu(side), W / 2 - 0.032, 0.095);
  key('enter', 'ENTER', FUSION_EVENTS.ccpEnter(side), W / 2, 0.095);
  key('back', 'BACK', FUSION_EVENTS.ccpBack(side), W / 2 + 0.032, 0.095);
  p.add(
    new RotaryKnob(env, {
      id: `${pfx}.data`,
      label: `CCP ${side} DATA`,
      diameter: 0.022,
      outer: { incEvent: FUSION_EVENTS.ccpDataInc(side), decEvent: FUSION_EVENTS.ccpDataDec(side), label: 'DATA (coarse)' },
      inner: { incEvent: FUSION_EVENTS.ccpDataInc(side, true), decEvent: FUSION_EVENTS.ccpDataDec(side, true), label: 'DATA (fine)' },
    }),
    W / 2,
    0.128,
  );
  return p;
}

// ---------------------------------------------------------------- MKP

const kd = (id: string, label?: string, keys?: string[]): KeyDef => ({ id, label, keys });
const GAP = (w = 1): KeyDef => ({ id: '', spacer: true, w });

/** MKP key rows (EST arrangement; key ids per logic/mkp.ts MKP_KEYS). */
function mkpRows(): KeyDef[][] {
  return [
    [kd('IDX'), kd('FPLN'), kd('LEGS'), kd('DEPARR', 'DEP\nARR'), kd('DIR'), kd('PERF'), kd('PROG'), kd('VNAV')],
    [kd('HOLD'), kd('TUNE'), kd('MSG'), kd('FMS'), kd('CHKSYS', 'CHK\nSYS'), kd('CAS_UP', 'CAS\nUP'), kd('CAS_DN', 'CAS\nDN'), { ...kd('EXEC'), lightVar: FUSION_VARS.execLight }],
    [kd('1'), kd('2'), kd('3'), GAP(0.3), kd('A'), kd('B'), kd('C'), kd('D'), kd('E'), kd('F'), kd('G')],
    [kd('4'), kd('5'), kd('6'), GAP(0.3), kd('H'), kd('I'), kd('J'), kd('K'), kd('L'), kd('M'), kd('N')],
    [kd('7'), kd('8'), kd('9'), GAP(0.3), kd('O'), kd('P'), kd('Q'), kd('R'), kd('S'), kd('T'), kd('U')],
    [kd('DOT', '.', ['.']), kd('0'), kd('PLUSMINUS', '+/-', ['-', '+']), GAP(0.3), kd('V'), kd('W'), kd('X'), kd('Y'), kd('Z'), kd('SP', 'SP', [' ']), kd('SLASH', '/', ['/'])],
    [kd('CLR', 'CLR', ['Backspace']), kd('DEL', 'DEL', ['Delete']), kd('PREV'), kd('NEXT'), GAP(0.3), kd('MEM'), kd('STO')],
  ];
}

/** Multifunction keyboard panel (MKP-6000) of `side` on the pedestal. */
export function addMkp(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: FusionSuite, side: 1 | 2): Panel {
  const env = b.env;
  const pfx = `${suite.cfg.idPrefix}.mkp${side}`;
  const p = parent.subPanel({ name: pfx, width: FUSION_HW.mkp.w, height: FUSION_HW.mkp.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.008 });
  p.add(
    new KeyPad(env, {
      id: `${pfx}.keys`,
      label: `MKP ${side}`,
      rows: mkpRows(),
      singleEvent: FUSION_EVENTS.mkpKey(side),
      eventPrefix: `${pfx}.k`,
      keyWidth: 0.0118,
      keyHeight: 0.0105,
      gap: 0.0024,
      legendHeight: 0.0019,
      keyboard: true,
      lights: [{ text: 'MSG', color: 'white', var: FUSION_VARS.msgLight(side), x: 0.0, y: -0.006, w: 0.012, h: 0.004 }],
    }),
    0.006,
    0.012,
  );
  return p;
}

// ---------------------------------------------------------------- RSP

/** Reversion switch panel of `side`: ADC (NORM / X-SIDE / STBY), ATT-HDG (NORM / IRS 3), DSPL (NORM / REV); AFCS 1 / 2 on the pilot's. */
export function addRsp(b: CockpitBuilder, parent: Panel, x: number, y: number, suite: FusionSuite, side: 1 | 2): Panel {
  const env = b.env;
  const pfx = `${suite.cfg.idPrefix}.rsp${side}`;
  const p = parent.subPanel({ name: pfx, width: FUSION_HW.rsp.w, height: FUSION_HW.rsp.h, x, y, origin: 'top-left', material: 'panelDark', thickness: 0.006 });
  p.add(new ToggleSwitch(env, { id: `${pfx}.adc`, label: `RSP ${side} ADC`, var: FUSION_VARS.rspAdc(side), positions: ['NORM', 'X-SIDE', 'STBY'], values: [0, 1, 2], labels: { name: 'ADC', positions: true } }), 0.018, 0.03);
  p.add(new ToggleSwitch(env, { id: `${pfx}.att`, label: `RSP ${side} ATT/HDG`, var: FUSION_VARS.rspAtt(side), positions: ['NORM', 'IRS 3'], labels: { name: 'ATT/HDG', positions: true } }), 0.042, 0.03);
  p.add(new ToggleSwitch(env, { id: `${pfx}.dspl`, label: `RSP ${side} DSPL`, var: FUSION_VARS.rspDspl(side), positions: ['NORM', 'REV'], labels: { name: 'DSPL', positions: true } }), 0.066, 0.03);
  if (side === 1) p.add(new ToggleSwitch(env, { id: `${pfx}.afcs`, label: 'AFCS 1 / 2', var: FUSION_VARS.rspAfcs, positions: ['1', '2'], values: [1, 2], labels: { name: 'AFCS', positions: true } }), 0.088, 0.03);
  return p;
}
