/**
 * 737-800 aft overhead panel (P5 aft; dossier §10.11, FCOM 1.30 "Aft
 * overhead panel", FCOM 11.20 IRS, 7.10 engines, 1.20 oxygen, 10.10 / 15.20
 * warning tests, 9.10 LE devices annunciator, 1.40 doors):
 *
 *   IRS MODE SELECT UNIT (ISDU windows, DSPL SEL, SYS DSPL L/R, keyboard,
 *     L / R mode selectors OFF-ALIGN-NAV-ATT, ALIGN / ON DC / FAULT /
 *     DC FAIL lights, GPS light)
 *   LE DEVICES annunciator (4 Krueger flaps + 8 slats: TRANSIT / EXT /
 *     FULL EXT, TEST)
 *   ENGINE: REVERSER, ENGINE CONTROL lights, EEC ON / ALTN switch-lights
 *   OXYGEN: crew oxygen pressure, PASS OXYGEN switch, PASS OXY ON
 *   FLIGHT RECORDER TEST / OFF; MACH AIRSPEED WARNING TEST 1 / 2, STALL
 *     WARNING TEST 1 / 2
 *   DOORS annunciator panel, PSEU light, SERVICE INTERPHONE
 *   Observer audio control panel (ACP 3)
 *
 * The ISDU keyboard echoes the keyed digits in the ISDU window and ENT
 * sends the present-position entry to both IRSs (event `irs.pos_entry`,
 * systems/sensors Irs). SCOPE: the keyed latitude / longitude are not
 * parsed; the IRSs take the aircraft position (as the FMC POS INIT entry).
 * Positions EST from NG photographs.
 */
import { AnnunciatorLight, KeyPad, PushButton, RotaryKnob } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { B738, type Door } from '../../vars';
import type { B738CockpitContext } from '../context';
import { seg } from '../context';
import { IsduDisplay, ScaleDial, lin, ticks } from './gauges';
import { OZ, Ovhd, module } from './parts';

export const AFT = { w: 0.9, h: 0.42 } as const;
/** Cockpit-only ISDU entry length (for the display watcher). */
export const ISDU_ENTRY_N = 'ac.b738.ck.isdu_entry_n';

export function buildAftOverhead(c: B738CockpitContext, root: Panel): void {
  const { env, ctx } = c;
  const vars = ctx.vars;
  const L = B738.lt;
  const mod = (name: string, x0: number, y0: number, w: number, h: number) => new Ovhd(env, module(root, `b738.aovhd.${name}`, x0 + w / 2, y0 + h / 2, w, h));
  const dial = (o: Ovhd, mk: () => ScaleDial, x: number, y: number, size: number) => {
    if (c.headless) return;
    const d = mk();
    o.p.roundInstrument(d, x, y, size, { flange: true });
    c.onDispose(() => d.dispose());
  };

  // ============================================================== IRS mode select unit
  {
    const o = mod('irs', 0.03, 0.02, 0.25, 0.215);
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
      o.p.display(d, 0.09, 0.03, 0.15, 0.028, { bezel: { border: 0.004, depth: 0.004 } });
      c.onDispose(() => d.dispose());
    }
    o.label('IRS DISPLAY', 0.09, 0.009, 0.0019);
    o.selector(
      id('dspl_sel'),
      'IRS DSPL SEL',
      B738.isduSel,
      ['TEST', 'TK/GS', 'PPOS', 'WIND', 'HDG/STS'].map((l, i) => ({ value: i, label: l, angle: -80 + i * 40 })),
      0.2,
      0.034,
      { diameter: 0.013, labelHeight: 0.0015, labelRadius: 0.0135, title: 'DSPL SEL', initial: 2 },
    );
    o.toggle({ id: id('sys_dspl'), label: 'IRS SYS DSPL', var: B738.isduSys, positions: ['L', 'R'], values: [0, 1], initial: 0, orientation: 'horizontal' }, 0.2, 0.076, 'SYS DSPL', 0.7);
    // Keyboard: 1 2(N) 3 / 4(W) 5 6(E) / 7 8(S) 9 / ENT 0 CLR.
    o.p.add(
      new KeyPad(env, {
        id: id('keys'),
        label: 'ISDU KEYBOARD',
        singleEvent: 'b738.isdu.key',
        keyWidth: 0.0105,
        keyHeight: 0.0085,
        gap: 0.0025,
        legendHeight: 0.0022,
        zone: OZ,
        rows: [
          [{ id: '1' }, { id: '2', label: 'N\n2' }, { id: '3' }],
          [{ id: '4', label: 'W\n4' }, { id: '5' }, { id: '6', label: 'E\n6' }],
          [{ id: '7' }, { id: '8', label: 'S\n8' }, { id: '9' }],
          [{ id: 'ENT', event: 'irs.pos_entry' }, { id: '0' }, { id: 'CLR' }],
        ],
      }),
      0.065,
      0.052,
    );
    // Mode selectors and status lights per IRS.
    for (const s of [1, 2] as const) {
      const cx = s === 1 ? 0.04 : 0.21;
      const lx = s === 1 ? 0.105 : 0.145;
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
        cx,
        0.17,
        { diameter: 0.019, cap: 'bar', labelHeight: 0.0018 },
      );
      o.label(s === 1 ? 'L' : 'R', cx, 0.142, 0.0026);
      o.annun(id(`align${s}`), `IRS ${s} ALIGN`, [seg.on('ALIGN', 'white', L.irsAlign(s))], lx, 0.128, 0.022, 0.01);
      o.annun(id(`on_dc${s}`), `IRS ${s} ON DC`, [seg.on('ON DC', 'amber', L.irsOnDc(s))], lx, 0.143, 0.022, 0.01);
      o.annun(id(`fault${s}`), `IRS ${s} FAULT`, [seg.on('FAULT', 'amber', L.irsFault(s))], lx, 0.158, 0.022, 0.01);
      o.annun(id(`dc_fail${s}`), `IRS ${s} DC FAIL`, [seg.on(['DC', 'FAIL'], 'amber', L.irsDcFail(s))], lx, 0.174, 0.022, 0.012);
    }
    o.annun(id('gps'), 'GPS', [seg.on('GPS', 'amber', 'cas.gps')], 0.125, 0.198, 0.02, 0.01);
    o.label('IRS MODE SELECT', 0.125, 0.206, 0.0017);
  }

  // ============================================================== LE DEVICES annunciator
  {
    const o = mod('le_dev', 0.03, 0.243, 0.25, 0.157);
    const id = (s: string) => `b738.aovhd.le.${s}`;
    o.label('LE DEVICES', 0.125, 0.009, 0.0022);
    // Wing leading edges (swept lines) and the fuselage.
    o.line(0.118, 0.03, 0.118, 0.14, 0.001);
    o.line(0.132, 0.03, 0.132, 0.14, 0.001);
    o.line(0.118, 0.07, 0.015, 0.125, 0.0008);
    o.line(0.132, 0.07, 0.235, 0.125, 0.0008);
    // Devices outboard -> inboard per side: slats 1-4 (left) / 5-8 (right) and Krueger flaps 1-2 / 3-4.
    // Var index (logic.ts): le_dev1..4 = Krueger flaps, 5..12 = slats.
    const flap = (k: number): { text: string[]; color: 'amber' | 'green'; var: string; test: (x: number) => boolean }[] => [
      { text: ['TRANSIT'], color: 'amber', var: `ac.b738.lt.le_dev${k}`, test: (x) => x === 1 },
      { text: ['EXT'], color: 'green', var: `ac.b738.lt.le_dev${k}`, test: (x) => x >= 2 },
    ];
    const slat = (k: number): { text: string[]; color: 'amber' | 'green'; var: string; test: (x: number) => boolean }[] => [
      { text: ['TRANSIT'], color: 'amber', var: `ac.b738.lt.le_dev${k}`, test: (x) => x === 1 },
      { text: ['EXT'], color: 'green', var: `ac.b738.lt.le_dev${k}`, test: (x) => x === 2 },
      { text: ['FULL EXT'], color: 'green', var: `ac.b738.lt.le_dev${k}`, test: (x) => x === 3 },
    ];
    const at = (side: -1 | 1, pos: number) => {
      // pos 0 = inboard .. 5 = outboard along the swept leading edge.
      const t = pos / 5;
      return [0.125 + side * (0.02 + t * 0.09), 0.078 + t * 0.047] as const;
    };
    // Left wing: flaps 1, 2 (inboard), slats 1-4; right wing: flaps 3, 4, slats 5-8.
    for (const side of [-1, 1] as const) {
      const base = side < 0 ? 0 : 2;
      for (let f = 0; f < 2; f++) {
        const k = base + f + 1;
        const [x, y] = at(side, f);
        o.p.add(new AnnunciatorLight(env, { id: id(`flap${k}`), label: `LE FLAP ${k}`, width: 0.016, height: 0.016, segments: flap(k), layout: 'stack' }), x, y - 0.02);
      }
      for (let s = 0; s < 4; s++) {
        const k = 5 + (side < 0 ? s : 4 + s);
        const [x, y] = at(side, s + 2);
        o.p.add(new AnnunciatorLight(env, { id: id(`slat${k - 4}`), label: `SLAT ${k - 4}`, width: 0.016, height: 0.02, segments: slat(k), layout: 'stack' }), x, y - 0.02);
      }
    }
    o.label('FLAPS', 0.125, 0.052, 0.0017);
    o.label('SLATS', 0.05, 0.14, 0.0017);
    o.label('SLATS', 0.2, 0.14, 0.0017);
    o.button({ id: id('test'), label: 'LE DEVICES TEST', mode: 'momentary', var: B738.leDevTest, engraved: 'TEST', engravedHeight: 0.0013 }, 0.125, 0.128);
  }

  // ============================================================== ENGINE
  {
    const o = mod('engine', 0.3, 0.02, 0.16, 0.1);
    const id = (s: string) => `b738.aovhd.eng.${s}`;
    o.label('ENGINE', 0.08, 0.008, 0.0022);
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.045 : 0.115;
      o.annun(id(`reverser${i}`), `REVERSER ${i}`, [seg.on('REVERSER', 'amber', L.reverser(i))], x, 0.022, 0.026, 0.01);
      o.annun(id(`eng_ctl${i}`), `ENGINE CONTROL ${i}`, [seg.on(['ENGINE', 'CONTROL'], 'amber', L.engineControl(i))], x, 0.038, 0.026, 0.012);
      o.p.add(
        new PushButton(env, {
          id: id(`eec${i}`),
          label: `EEC ${i}`,
          style: 'korry',
          width: 0.018,
          height: 0.016,
          mode: 'toggle',
          var: B738.eec(i),
          values: [0, 1],
          initial: 1,
          zone: OZ,
          segments: [
            { text: 'ON', color: 'green', var: L.eecOn(i), style: 'legend' },
            { text: 'ALTN', color: 'amber', var: L.eecAltn(i), style: 'legend' },
          ],
          layout: 'stack',
        }),
        x,
        0.066,
      );
      o.label(`EEC ${i}`, x, 0.086, 0.0019);
    }
  }

  // ============================================================== OXYGEN
  {
    const o = mod('oxygen', 0.3, 0.126, 0.16, 0.1);
    const id = (s: string) => `b738.aovhd.oxy.${s}`;
    o.label('OXYGEN', 0.08, 0.008, 0.0022);
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_crew_oxy',
        vars,
        powerVar: null,
        scales: [{ angle: lin(0, 2000, -135, 135), ticks: ticks(0, 2000, 200, 400, (v) => String(v / 100)) }],
        needles: [{ var: L.crewOxyPsi }],
        title: ['CREW OXY', 'PSI x 100'],
        titleY: 168,
      }),
      0.04,
      0.052,
      0.038,
    );
    o.annun(id('pass_oxy_on'), 'PASS OXY ON', [seg.on(['PASS', 'OXY ON'], 'amber', L.passOxyOn)], 0.115, 0.03);
    o.guarded({ id: id('pass_oxy'), label: 'PASSENGER OXYGEN', var: B738.passOxy, positions: ['NORMAL', 'ON'], values: [0, 1], initial: 0, guard: { color: 'red', guardedPosition: 0 } }, 0.115, 0.07, 'PASS OXYGEN', 0.75);
  }

  // ============================================================== FLIGHT RECORDER, warning tests
  {
    const o = mod('fdr', 0.3, 0.232, 0.16, 0.058);
    const id = (s: string) => `b738.aovhd.fdr.${s}`;
    o.label('FLIGHT RECORDER', 0.08, 0.008, 0.0019);
    o.guarded({ id: id('test'), label: 'FLIGHT RECORDER', var: B738.fdrSw, positions: ['NORMAL', 'TEST'], values: [0, 1], initial: 0, guard: { color: 'red', guardedPosition: 0 } }, 0.05, 0.034, false, 0.75);
    o.annun(id('off'), 'FLIGHT RECORDER OFF', [seg.on('OFF', 'amber', L.fdrOff)], 0.115, 0.032, 0.02, 0.011);
  }
  {
    const o = mod('warn_test', 0.3, 0.296, 0.16, 0.104);
    const id = (s: string) => `b738.aovhd.test.${s}`;
    o.labels(['MACH AIRSPEED', 'WARNING TEST'], 0.042, 0.01, 0.0017);
    o.labels(['STALL WARNING', 'TEST'], 0.118, 0.01, 0.0017);
    for (const i of [1, 2] as const) {
      o.button({ id: id(`mach${i}`), label: `MACH AIRSPEED WARNING TEST ${i}`, mode: 'momentary', var: B738.machTest(i), style: 'round', width: 0.011 }, 0.026 + (i - 1) * 0.032, 0.05);
      o.label(String(i), 0.026 + (i - 1) * 0.032, 0.066, 0.002);
      o.button({ id: id(`stall${i}`), label: `STALL WARNING TEST ${i}`, mode: 'momentary', var: B738.stallTest(i), style: 'round', width: 0.011 }, 0.102 + (i - 1) * 0.032, 0.05);
      o.label(String(i), 0.102 + (i - 1) * 0.032, 0.066, 0.002);
    }
  }

  // ============================================================== DOORS, PSEU, SERVICE INTERPHONE
  {
    const o = mod('doors', 0.48, 0.02, 0.17, 0.215);
    const id = (s: string) => `b738.aovhd.door.${s}`;
    o.label('DOORS', 0.085, 0.009, 0.0022);
    // Fuselage outline (nose at the bottom = forward, as the panel is read).
    o.line(0.07, 0.2, 0.07, 0.03, 0.0008);
    o.line(0.1, 0.2, 0.1, 0.03, 0.0008);
    const D: [Door, string[], number, number][] = [
      ['flt_deck', ['FLT DECK'], 0.085, 0.188],
      ['fwd_entry', ['FWD', 'ENTRY'], 0.035, 0.165],
      ['fwd_service', ['FWD', 'SERVICE'], 0.135, 0.165],
      ['equip', ['EQUIP'], 0.085, 0.158],
      ['fwd_cargo', ['FWD', 'CARGO'], 0.085, 0.132],
      ['l_overwing', ['LEFT', 'OVERWING'], 0.035, 0.11],
      ['r_overwing', ['RIGHT', 'OVERWING'], 0.135, 0.11],
      ['aft_cargo', ['AFT', 'CARGO'], 0.085, 0.085],
      ['aft_entry', ['AFT', 'ENTRY'], 0.035, 0.045],
      ['aft_service', ['AFT', 'SERVICE'], 0.135, 0.045],
    ];
    for (const [d, text, x, y] of D) o.annun(id(d), `${text.join(' ')} DOOR`, [seg.on(text, 'amber', L.doorLt(d))], x, y, 0.026, 0.013);
  }
  {
    const o = mod('pseu', 0.48, 0.24, 0.17, 0.07);
    const id = (s: string) => `b738.aovhd.${s}`;
    o.annun(id('pseu'), 'PSEU', [seg.on('PSEU', 'amber', L.pseu)], 0.035, 0.035, 0.022, 0.012);
    o.toggle({ id: id('svc_interphone'), label: 'SERVICE INTERPHONE', var: B738.svcInterphone, positions: ['OFF', 'ON'], values: [0, 1], initial: 0 }, 0.115, 0.04, false, 0.75);
    o.labels(['SERVICE', 'INTERPHONE'], 0.115, 0.009, 0.0017);
  }

  // Blanking plates (unused module positions, as on the aircraft).
  mod('blank1', 0.48, 0.316, 0.17, 0.084);
  mod('blank2', 0.67, 0.156, 0.2, 0.244);

  // ============================================================== observer audio control panel (ACP 3)
  {
    const o = mod('acp3', 0.67, 0.02, 0.2, 0.13);
    const id = (s: string) => `b738.aovhd.acp3.${s}`;
    o.label('AUDIO CONTROL - OBSERVER', 0.1, 0.009, 0.002);
    const MICS = ['VHF 1', 'VHF 2', 'VHF 3', 'HF 1', 'HF 2', 'FLT', 'SERV', 'PA'];
    MICS.forEach((m, k) => {
      o.p.add(
        new PushButton(env, {
          id: id(`mic${k}`),
          label: `ACP 3 MIC ${m}`,
          style: 'korry',
          width: 0.03,
          height: 0.016,
          mode: 'momentary',
          var: `ac.b738.ck.acp3_mic_btn${k}`,
          zone: OZ,
          onChange: (x) => {
            if (x !== 0) vars.set(B738.acpMic(3), k);
          },
          // Transmitter selector: the MIC legend lights on the selected transmitter (FCOM 5.10).
          segments: [{ text: [m, 'MIC'], color: 'white', var: B738.acpMic(3), test: (x) => x === k, style: 'legend' }],
        }),
        0.033 + (k % 4) * 0.045,
        0.032 + Math.floor(k / 4) * 0.024,
      );
    });
    o.p.add(
      new RotaryKnob(env, {
        id: id('mkr'),
        label: 'ACP 3 MKR VOLUME',
        cap: 'fluted',
        diameter: 0.012,
        zone: OZ,
        outer: { var: B738.acpMkrVol(3), min: 0, max: 1, step: 0.05, initial: 0.6, angleRange: [-140, 140], label: 'MKR', format: (x) => `${Math.round(x * 100)} %` },
      }),
      0.04,
      0.104,
    );
    o.label('MKR', 0.04, 0.088, 0.0018);
    o.toggle({ id: id('alt'), label: 'ACP 3 ALT-NORM', var: B738.acpAltNorm(3), positions: ['NORM', 'ALT'], values: [0, 1], initial: 0 }, 0.1, 0.104, 'ALT-NORM', 0.65);
    o.toggle({ id: id('filter'), label: 'ACP 3 FILTER', var: B738.acpFilter(3), positions: ['V', 'B', 'R'], values: [-1, 0, 1], initial: 1 }, 0.155, 0.104, 'FILTER', 0.65);
  }
}

