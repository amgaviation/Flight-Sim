/**
 * 737-800 aft overhead panel (P5 aft; dossier §10.11, FCOM 1.30 "Aft
 * overhead panel", FCOM 11.20 IRS, 7.10 engines, 1.20 oxygen, 10.10 / 15.20
 * warning tests, 9.10 LE devices annunciator), laid out as on the SCBG 1:1
 * overhead drawing (0.66 x 0.35 m; coordinates in metres from the top-left
 * corner, top = aft):
 *
 *   left column: ELT (ARM / ON, ELT light), LE DEVICES annunciator (4
 *     Krueger flaps + 8 slats: TRANSIT / EXT / FULL EXT, TEST), PSEU light
 *   2nd column: IRS MODE SELECT UNIT (ISDU window, DSPL SEL, SYS DSPL L/R,
 *     keyboard, GPS light, ALIGN / ON DC / FAULT / DC FAIL lights, L / R mode
 *     selectors OFF-ALIGN-NAV-ATT)
 *   centre: SERVICE INTERPHONE, DOME WHITE (DIM / OFF / BRIGHT)
 *   4th column: observer audio control panel (ACP 3), ENGINE (REVERSER,
 *     ENGINE CONTROL lights, EEC ON / ALTN), CREW OXYGEN pressure and PASS
 *     OXYGEN switch with PASS OXY ON; LEFT / RIGHT / NOSE GEAR greens
 *   right column: FLIGHT RECORDER TEST / NORMAL + OFF, MACH AIRSPEED
 *     WARNING TEST 1 / 2, STALL WARNING TEST 1 / 2
 *   INDEX TO LOCK latches at the lower corners.
 * The DOORS annunciators are on the forward overhead (forward.ts).
 *
 * The ISDU keyboard echoes the keyed digits in the ISDU window and ENT
 * sends the present-position entry to both IRSs (event `irs.pos_entry`,
 * systems/sensors Irs). SCOPE: the keyed latitude / longitude are not
 * parsed; the IRSs take the aircraft position (as the FMC POS INIT entry).
 */
import { AnnunciatorLight, KeyPad, PushButton, RotaryKnob } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { B738, type AcpReceiver } from '../../vars';
import type { B738CockpitContext } from '../context';
import { seg } from '../context';
import { IsduDisplay, ScaleDial, lin, ticks } from './gauges';
import { OZ, Ovhd, indexLock, moduleAbs } from './parts';

export const AFT = { w: 0.66, h: 0.35 } as const;
/** Cockpit-only ISDU entry length (for the display watcher). */
export const ISDU_ENTRY_N = 'ac.b738.ck.isdu_entry_n';

export function buildAftOverhead(c: B738CockpitContext, root: Panel): void {
  const { env, ctx } = c;
  const vars = ctx.vars;
  const L = B738.lt;
  const M = (name: string, x0: number, y0: number, x1: number, y1: number) => moduleAbs(env, root, `b738.aovhd.${name}`, x0, y0, x1, y1);
  const dial = (o: Ovhd, mk: () => ScaleDial, x: number, y: number, size: number) => {
    if (c.headless) return;
    const d = mk();
    o.p.roundInstrument(d, o.X(x), o.Y(y), size, { flange: true });
    c.onDispose(() => d.dispose());
  };

  // Blank plates (unused module positions, as on the aircraft).
  M('blank1', 0.003, 0.03, 0.14, 0.143);
  M('blank2', 0.515, 0.03, 0.658, 0.14);
  M('blank3', 0.515, 0.26, 0.658, 0.29);

  // ============================================================== ELT, LE DEVICES, PSEU (left column)
  {
    const o = M('elt', 0.003, 0.145, 0.14, 0.212);
    const id = (s: string) => `b738.aovhd.elt.${s}`;
    o.label('ELT', 0.07, 0.165, 0.0022);
    o.guarded({ id: id('sw'), label: 'ELT', var: B738.eltSw, positions: ['ON', 'ARM'], values: [1, 0], initial: 1, guard: { color: 'red', guardedPosition: 1 } }, 0.1, 0.185, false, 0.6);
    o.label('ARM', 0.086, 0.172, 0.0016);
    o.label('ON', 0.088, 0.2, 0.0016);
    o.annun(id('lt'), 'ELT', [seg.on('ELT', 'amber', L.elt)], 0.033, 0.188, 0.022, 0.011);
  }
  {
    const o = M('le_dev', 0.003, 0.214, 0.14, 0.29);
    const id = (s: string) => `b738.aovhd.le.${s}`;
    const cx = 0.0715;
    o.label('LE DEVICES', cx, 0.222, 0.0019);
    o.label('FLAPS', cx, 0.229, 0.0014);
    // Devices outboard -> inboard per side along the swept leading edges: Krueger flaps 1-2 / 3-4 inboard, slats
    // 1-4 / 5-8 outboard. Var index (logic.ts): le_dev1..4 = Krueger flaps, 5..12 = slats.
    const flap = (k: number): { text: string[]; color: 'amber' | 'green'; var: string; test: (x: number) => boolean }[] => [
      { text: ['TRANSIT'], color: 'amber', var: `ac.b738.lt.le_dev${k}`, test: (x) => x === 1 },
      { text: ['EXT'], color: 'green', var: `ac.b738.lt.le_dev${k}`, test: (x) => x >= 2 },
    ];
    const slat = (k: number): { text: string[]; color: 'amber' | 'green'; var: string; test: (x: number) => boolean }[] => [
      { text: ['TRANSIT'], color: 'amber', var: `ac.b738.lt.le_dev${k}`, test: (x) => x === 1 },
      { text: ['EXT'], color: 'green', var: `ac.b738.lt.le_dev${k}`, test: (x) => x === 2 },
      { text: ['FULL EXT'], color: 'green', var: `ac.b738.lt.le_dev${k}`, test: (x) => x === 3 },
    ];
    // pos 0 = inboard .. 5 = outboard along the swept leading edge (SCBG: wings drawn sweeping down outboard).
    const at = (side: -1 | 1, pos: number) => [cx + side * (0.017 + pos * 0.0095), 0.238 + pos * 0.0055] as const;
    for (const side of [-1, 1] as const) {
      const base = side < 0 ? 0 : 2;
      for (let f = 0; f < 2; f++) {
        const k = base + f + 1;
        const [x, y] = at(side, side < 0 ? 1 - f : f);
        o.p.add(new AnnunciatorLight(env, { id: id(`flap${k}`), label: `LE FLAP ${k}`, width: 0.009, height: 0.012, segments: flap(k), layout: 'stack' }), o.X(x), o.Y(y));
      }
      for (let s = 0; s < 4; s++) {
        const k = 5 + (side < 0 ? s : 4 + s);
        const [x, y] = at(side, side < 0 ? 5 - s : s + 2);
        o.p.add(new AnnunciatorLight(env, { id: id(`slat${k - 4}`), label: `SLAT ${k - 4}`, width: 0.009, height: 0.015, segments: slat(k), layout: 'stack' }), o.X(x), o.Y(y + 0.012));
      }
    }
    o.label('TRANSIT', cx, 0.248, 0.0013);
    o.label('EXT', cx, 0.255, 0.0013);
    o.label('FULL EXT', cx, 0.262, 0.0013);
    o.label('SLATS', 0.035, 0.282, 0.0014);
    o.label('SLATS', 0.108, 0.282, 0.0014);
    o.button({ id: id('test'), label: 'LE DEVICES TEST', mode: 'momentary', var: B738.leDevTest, width: 0.007, capMaterial: 'plasticBlack' }, cx, 0.273);
    o.label('TEST', cx, 0.282, 0.0014);
  }
  {
    const o = M('pseu', 0.05, 0.3, 0.14, 0.335);
    o.annun('b738.aovhd.pseu', 'PSEU', [seg.on('PSEU', 'amber', L.pseu)], 0.112, 0.318, 0.022, 0.011);
  }

  // ============================================================== IRS mode select unit (x 0.143 .. 0.287)
  {
    const o = M('irs', 0.143, 0.03, 0.288, 0.285);
    const id = (s: string) => `b738.aovhd.irs.${s}`;
    // Keyboard entry buffer (echoed in the ISDU window until ENT / CLR).
    let entry = '';
    const offKey = ctx.events.on('b738.isdu.key', (k) => {
      const key = String(k);
      if (key === 'CLR') entry = '';
      else if (key === 'ENT') entry = '';
      else if (entry.length < 13) entry += key;
      vars.set(ISDU_ENTRY_N, entry.length);
    });
    c.onDispose(offKey);
    if (!c.headless) {
      const d = new IsduDisplay(vars, 'b738_isdu', () => entry);
      o.p.display(d, o.X(0.215), o.Y(0.09), 0.112, 0.02, { bezel: { border: 0.004, depth: 0.004 } });
      c.onDispose(() => d.dispose());
    }
    o.label('IRS DISPLAY', 0.215, 0.077, 0.0017);
    o.selector(
      id('dspl_sel'),
      'IRS DSPL SEL',
      B738.isduSel,
      ['TEST', 'TK/GS', 'PPOS', 'WIND', 'HDG/STS'].map((l, i) => ({ value: i, label: l, angle: -80 + i * 40 })),
      0.174,
      0.13,
      { diameter: 0.011, labelHeight: 0.0013, labelRadius: 0.0125, initial: 2 },
    );
    o.label('DSPL SEL', 0.174, 0.108, 0.0015);
    o.toggle({ id: id('sys_dspl'), label: 'IRS SYS DSPL', var: B738.isduSys, positions: ['L', 'R'], values: [0, 1], initial: 0, orientation: 'horizontal' }, 0.174, 0.168, 'SYS DSPL', 0.55);
    // Keyboard: 1 2(N) 3 / 4(W) 5 6(E) / 7 8(S) 9 / ENT 0 CLR (SCBG: ~0.045 x 0.06 m block).
    o.p.add(
      new KeyPad(env, {
        id: id('keys'),
        label: 'ISDU KEYBOARD',
        singleEvent: 'b738.isdu.key',
        keyWidth: 0.012,
        keyHeight: 0.012,
        gap: 0.003,
        legendHeight: 0.0024,
        zone: OZ,
        rows: [
          [{ id: '1' }, { id: '2', label: 'N\n2' }, { id: '3' }],
          [{ id: '4', label: 'W\n4' }, { id: '5' }, { id: '6', label: 'E\n6' }],
          [{ id: '7' }, { id: '8', label: 'S\n8' }, { id: '9' }],
          [{ id: 'ENT', event: 'irs.pos_entry' }, { id: '0' }, { id: 'CLR' }],
        ],
      }),
      o.X(0.224),
      o.Y(0.117),
    );
    o.annun(id('gps'), 'GPS', [seg.on('GPS', 'amber', 'cas.gps')], 0.215, 0.198, 0.022, 0.01);
    // Status lights and mode selectors per IRS.
    for (const s of [1, 2] as const) {
      const x0 = s === 1 ? 0.17 : 0.235;
      o.annun(id(`align${s}`), `IRS ${s} ALIGN`, [seg.on('ALIGN', 'white', L.irsAlign(s))], x0, 0.224, 0.024, 0.011);
      o.annun(id(`on_dc${s}`), `IRS ${s} ON DC`, [seg.on('ON DC', 'amber', L.irsOnDc(s))], x0 + 0.027, 0.224, 0.024, 0.011);
      o.annun(id(`fault${s}`), `IRS ${s} FAULT`, [seg.on('FAULT', 'amber', L.irsFault(s))], x0, 0.236, 0.024, 0.011);
      o.annun(id(`dc_fail${s}`), `IRS ${s} DC FAIL`, [seg.on('DC FAIL', 'amber', L.irsDcFail(s))], x0 + 0.027, 0.236, 0.024, 0.011);
      o.selector(
        id(`mode${s}`),
        `IRS ${s === 1 ? 'L' : 'R'} MODE`,
        `ac.irs${s}_mode`,
        [
          { value: 0, label: 'OFF', angle: -90, gated: true },
          { value: 1, label: 'ALIGN', angle: -30 },
          { value: 2, label: 'NAV', angle: 30 },
          { value: 3, label: 'ATT', angle: 90, gated: true },
        ],
        s === 1 ? 0.183 : 0.248,
        0.264,
        { diameter: 0.017, cap: 'bar', labelHeight: 0.0015 },
      );
    }
    o.label('L       IRS       R', 0.216, 0.279, 0.0019);
  }

  // ============================================================== centre: SERVICE INTERPHONE, DOME WHITE
  {
    const o = M('svc', 0.292, 0.178, 0.36, 0.225);
    o.labels(['SERVICE', 'INTERPHONE'], 0.326, 0.184, 0.0016);
    o.toggle({ id: 'b738.aovhd.svc_interphone', label: 'SERVICE INTERPHONE', var: B738.svcInterphone, positions: ['OFF', 'ON'], values: [0, 1], initial: 0 }, 0.326, 0.206, false, 0.55);
  }
  {
    const o = M('dome', 0.295, 0.29, 0.36, 0.34);
    o.label('DOME WHITE', 0.328, 0.3, 0.0018);
    o.toggle({ id: 'b738.ovhd.lt.dome', label: 'DOME WHITE', var: B738.domeLt, positions: ['BRIGHT', 'OFF', 'DIM'], values: [2, 0, 1], initial: 1 }, 0.325, 0.322, false, 0.55);
    o.label('DIM', 0.325, 0.308, 0.0015);
    o.label('OFF', 0.345, 0.322, 0.0015);
    o.label('BRIGHT', 0.325, 0.336, 0.0015);
  }

  // ============================================================== observer audio control panel (ACP 3), x 0.365 .. 0.51
  // Same unit as the Captain / F/O ACPs (FCOM 5.10): transmitter selectors (MIC lights), receiver switches
  // (push on / off, turn for volume, lit when on), NAV / ADF / MKR receivers and SPKR, V-B-R filter,
  // ALT-NORM, R/T - I/C push-to-talk (R/T spring-loaded; I/C latched, EST) and MASK-BOOM.
  // SCOPE: no audio routing; the logic publishes the mixer levels and keying (systems/logic.ts ACP_TABLE).
  {
    const o = M('acp3', 0.365, 0.03, 0.511, 0.14);
    const id = (s: string) => `b738.aovhd.acp3.${s}`;
    o.label('MIC SELECTOR', 0.438, 0.034, 0.0015);
    const MICS = ['VHF 1', 'VHF 2', 'VHF 3', 'HF 1', 'HF 2', 'FLT', 'SERV', 'PA'];
    const RX1: AcpReceiver[] = ['vhf1', 'vhf2', 'vhf3', 'hf1', 'hf2', 'flt', 'svc', 'pa'];
    const RX2: [AcpReceiver, string][] = [
      ['nav1', 'NAV 1'],
      ['nav2', 'NAV 2'],
      ['adf1', 'ADF 1'],
      ['adf2', 'ADF 2'],
      ['mkr', 'MKR'],
      ['spkr', 'SPKR'],
    ];
    const pitch = 0.0144;
    const x0 = 0.438 - 3.5 * pitch;
    MICS.forEach((m, k) => {
      o.p.add(
        new PushButton(env, {
          id: id(`mic${k}`),
          label: `ACP 3 MIC ${m}`,
          style: 'korry',
          width: 0.0125,
          height: 0.013,
          mode: 'momentary',
          var: `ac.b738.ck.acp3_mic_btn${k}`,
          zone: OZ,
          onChange: (x) => {
            if (x !== 0) vars.set(B738.acpMic(3), k);
          },
          // Transmitter selector: the MIC legend lights on the selected transmitter (FCOM 5.10).
          segments: [{ text: ['MIC', m], color: 'white', var: B738.acpMic(3), test: (x) => x === k, style: 'legend' }],
        }),
        o.X(x0 + k * pitch),
        o.Y(0.047),
      );
    });
    const rxKnob = (rx: AcpReceiver, name: string, x: number, y: number) => {
      const on = rx === 'spkr' ? null : B738.acpRxOn(3, rx);
      o.p.add(
        new RotaryKnob(env, {
          id: id(`rx_${rx}`),
          label: `ACP 3 ${name} RECEIVER${on ? ' (push on / off, turn volume)' : ' VOLUME'}`,
          cap: 'fluted',
          diameter: 0.009,
          height: 0.008,
          pointer: 'none',
          zone: OZ,
          outer: { var: B738.acpRxVol(3, rx), min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: `${name} VOL`, format: (x) => `${Math.round(x * 100)} %` },
          push: on ? { var: on, mode: 'toggle', label: `${name} ON/OFF` } : undefined,
        }),
        o.X(x),
        o.Y(y),
      );
      // Receiver-on light (white segment above the control).
      if (on) o.annun(id(`rxlt_${rx}`), `ACP 3 ${name} receiver on`, [seg.on('', 'white', on)], x, y - 0.0078, 0.009, 0.0024);
    };
    RX1.forEach((rx, k) => rxKnob(rx, MICS[k], x0 + k * pitch, 0.073));
    RX2.forEach(([rx, name], k) => {
      const x = x0 + k * pitch;
      rxKnob(rx, name, x, 0.097);
      o.label(name, x, 0.106, 0.0011);
    });
    const tg = (key: string, label: string, v: string, positions: string[], values: number[], initial: number, x: number, extra: { springs?: Record<number, number>; orientation?: 'horizontal' } = {}) => {
      o.toggle({ id: id(key), label, var: v, positions, values, initial, ...extra }, x, 0.123, false, 0.45);
    };
    tg('ptt', 'ACP 3 PUSH TO TALK R/T - I/C', B738.acpPtt(3), ['I/C', 'OFF', 'R/T'], [-1, 0, 1], 1, 0.38, { springs: { 2: 1 } });
    tg('mask', 'ACP 3 MASK-BOOM', B738.acpMaskBoom(3), ['BOOM', 'MASK'], [0, 1], 0, 0.402);
    tg('filter', 'ACP 3 FILTER', B738.acpFilter(3), ['V', 'B', 'R'], [-1, 0, 1], 1, 0.44, { orientation: 'horizontal' });
    tg('alt', 'ACP 3 ALT-NORM', B738.acpAltNorm(3), ['NORM', 'ALT'], [0, 1], 0, 0.492);
  }

  // ============================================================== ENGINE (x 0.365 .. 0.51, y 0.142 .. 0.208)
  {
    const o = M('engine', 0.365, 0.142, 0.511, 0.21);
    const id = (s: string) => `b738.aovhd.eng.${s}`;
    o.label('1          ENGINE          2', 0.438, 0.148, 0.0019);
    for (const i of [1, 2] as const) {
      o.annun(id(`reverser${i}`), `REVERSER ${i}`, [seg.on('REVERSER', 'amber', L.reverser(i))], i === 1 ? 0.405 : 0.47, 0.16, 0.026, 0.01);
      o.annun(id(`eng_ctl${i}`), `ENGINE CONTROL ${i}`, [seg.on(['ENGINE', 'CONTROL'], 'amber', L.engineControl(i))], i === 1 ? 0.385 : 0.491, 0.192, 0.024, 0.011);
      o.label('EEC', i === 1 ? 0.42 : 0.455, 0.175, 0.0018);
      o.p.add(
        new PushButton(env, {
          id: id(`eec${i}`),
          label: `EEC ${i}`,
          style: 'korry',
          width: 0.016,
          height: 0.016,
          mode: 'toggle',
          var: B738.eec(i),
          values: [0, 1],
          initial: 1,
          zone: OZ,
          segments: [
            { text: 'ON', color: 'white', var: L.eecOn(i), style: 'legend' }, // FCOM 7.10: ON white, ALTN amber
            { text: 'ALTN', color: 'amber', var: L.eecAltn(i), style: 'legend' },
          ],
          layout: 'stack',
        }),
        o.X(i === 1 ? 0.42 : 0.455),
        o.Y(0.192),
      );
    }
  }

  // ============================================================== CREW OXYGEN / PASS OXYGEN
  {
    const o = M('oxygen', 0.365, 0.212, 0.511, 0.285);
    const id = (s: string) => `b738.aovhd.oxy.${s}`;
    o.labels(['CREW', 'OXYGEN'], 0.405, 0.217, 0.0017);
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_crew_oxy',
        vars,
        powerVar: null,
        scales: [{ angle: lin(0, 2000, -135, 135), ticks: ticks(0, 2000, 200, 400, (v) => String(v / 100)) }],
        needles: [{ var: L.crewOxyPsi }],
        title: ['OXY PRESS', 'PSI x 100'],
        titleY: 168,
      }),
      0.405,
      0.258,
      0.042,
    );
    o.label('PASS OXYGEN', 0.465, 0.217, 0.0017);
    o.guarded({ id: id('pass_oxy'), label: 'PASSENGER OXYGEN', var: B738.passOxy, positions: ['NORMAL', 'ON'], values: [0, 1], initial: 0, guard: { color: 'red', guardedPosition: 0 } }, 0.488, 0.244, false, 0.6);
    o.label('NORMAL', 0.461, 0.233, 0.0015);
    o.label('ON', 0.466, 0.255, 0.0015);
    o.annun(id('pass_oxy_on'), 'PASS OXY ON', [seg.on(['PASS OXY', 'ON'], 'amber', L.passOxyOn)], 0.46, 0.272, 0.024, 0.011);
  }

  // ============================================================== LANDING GEAR indicator lights (aft overhead set)
  // FCOM 14.10: the aft overhead carries a second set of green gear-down lights (lit when the gear is down and
  // locked; no red lights). They show the same sensing as the centre-panel greens (gearGreen: 0 nose, 1 left,
  // 2 right). SCBG: LEFT / RIGHT side by side, NOSE under them.
  {
    const o = M('gear', 0.36, 0.29, 0.415, 0.328);
    const id = (s: string) => `b738.aovhd.gear.${s}`;
    const G: [0 | 1 | 2, string, number, number][] = [
      [1, 'LEFT', 0.374, 0.3],
      [2, 'RIGHT', 0.401, 0.3],
      [0, 'NOSE', 0.387, 0.316],
    ];
    for (const [leg, name, x, y] of G) o.annun(id(`green${leg}`), `${name} GEAR (aft overhead)`, [seg.on([name, 'GEAR'], 'green', L.gearGreen(leg))], x, y, 0.024, 0.012);
  }

  // ============================================================== FLIGHT RECORDER, MACH / STALL warning tests (right column)
  {
    const o = M('fdr', 0.515, 0.142, 0.658, 0.198);
    const id = (s: string) => `b738.aovhd.fdr.${s}`;
    o.label('FLIGHT RECORDER', 0.553, 0.155, 0.0018);
    o.guarded({ id: id('test'), label: 'FLIGHT RECORDER', var: B738.fdrSw, positions: ['NORMAL', 'TEST'], values: [0, 1], initial: 0, orientation: 'horizontal', guard: { color: 'red', guardedPosition: 0 } }, 0.542, 0.184, false, 0.6);
    o.label('TEST    NORMAL', 0.54, 0.169, 0.0015);
    o.annun(id('off'), 'FLIGHT RECORDER OFF', [seg.on('OFF', 'amber', L.fdrOff)], 0.58, 0.184, 0.02, 0.01);
    const tid = (s: string) => `b738.aovhd.test.${s}`;
    o.labels(['MACH', 'AIRSPEED', 'WARNING', 'TEST'], 0.621, 0.146, 0.0014);
    for (const i of [1, 2] as const) {
      o.button({ id: tid(`mach${i}`), label: `MACH AIRSPEED WARNING TEST ${i}`, mode: 'momentary', var: B738.machTest(i), style: 'round', width: 0.01, capMaterial: 'plasticBlack' }, i === 1 ? 0.61 : 0.632, 0.186);
      o.label(`NO ${i}`, i === 1 ? 0.61 : 0.632, 0.176, 0.0013);
    }
  }
  {
    const o = M('warn_test', 0.515, 0.2, 0.658, 0.258);
    const id = (s: string) => `b738.aovhd.test.${s}`;
    o.label('STALL WARNING TEST', 0.586, 0.21, 0.0018);
    for (const i of [1, 2] as const) {
      o.label(`NO. ${i}`, i === 1 ? 0.556 : 0.606, 0.219, 0.0015);
      o.button({ id: id(`stall${i}`), label: `STALL WARNING TEST ${i}`, mode: 'momentary', var: B738.stallTest(i), style: 'round', width: 0.011, capMaterial: 'plasticBlack' }, i === 1 ? 0.556 : 0.606, 0.236);
    }
  }
  // INDEX TO LOCK latches at the lower corners.
  indexLock(env, root, 0.004, 0.31);
  indexLock(env, root, 0.63, 0.31);
}
