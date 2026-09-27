/**
 * 737-800 aft electronic panel (P8), front to back (dossier §10.15; FCOM
 * 5.10 Communications, 8.10 Fire protection, 9.10 Flight controls, 11 / 15
 * ATC-TCAS, 16 weather radar):
 *
 *   NAV 1 | NAV 2 control panels (active / standby, TFR, TEST, MHz / kHz)
 *   VHF COM 1 | 2 radio tuning panels (TFR, power, MHz / kHz)
 *   Audio control panels Capt | F/O (transmitter select MIC lights, MKR
 *     receiver volume, ALT-NORM, V/B/R filter)
 *   Fire protection panel: engine 1 / APU / engine 2 fire handles (unlocked
 *     by a fire warning or the override button; pull, rotate to discharge),
 *     OVHT DET 1 / 2 A-NORMAL-B, TEST FAULT/INOP - OVHT/FIRE, EXTINGUISHER
 *     TEST 1 / 2 with the squib lights, BELL CUTOUT, ENG OVERHEAT, WHEEL
 *     WELL, FAULT, APU DET INOP, BOTTLE DISCHARGED lights
 *   ADF 1 | ADF 2 (mode OFF / ANT / ADF, TONE, TFR, frequency)
 *   Cargo fire (DET SELECT, ARM, DISCH, TEST) | weather radar (mode, gain,
 *     tilt, power; SCOPE: no radar returns)
 *   ATC / TCAS panel (mode, ATC 1/2, ALT SOURCE 1/2, ABOVE / NORM / BELOW,
 *     IDENT, code)
 *   Trim panel: AILERON trim (two switches), RUDDER trim knob and indicator,
 *     STAB TRIM OVERRIDE | flight-deck door lock, pedestal PANEL / FLOOD
 *
 * SCOPE: the ACP receiver controls, push-to-talk and MASK-BOOM switches
 * publish mixer levels / keying state only (no audio routing). HF radio
 * control panels, SELCAL and the cabin interphone handset are not built (no
 * HF model: they would be decorative). Module sizes EST (Boeing 146 mm-wide DZUS modules).
 */
import { GuardedButton, GuardedSwitch, PushButton, RotaryKnob, SelectorKnob, TBarHandle } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { NAV } from '../../../core/vars';
import { B738, XPDR_SEL, type AcpReceiver } from '../vars';
import type { B738CockpitContext } from './context';
import { CK, seg } from './context';
import { annunciator, dimmer, toggle } from './common';
import { DialDisplay, LcdDisplay } from './displays';
import { AFT_PED } from './layout';
import { TUNE_EVENTS } from './radioTuning';

const W2 = 0.146; // half-width module
const UL = -0.078;
const UR = 0.078;

export function buildAftPedestal(c: B738CockpitContext): void {
  const { b, env, ctx } = c;
  const vars = ctx.vars;
  const len = AFT_PED.xFwd - AFT_PED.xAft;
  const ped = b.panel({
    name: 'b738.p8',
    center_m: [(AFT_PED.xFwd + AFT_PED.xAft) / 2, 0, AFT_PED.topZ],
    facing: 'up',
    width: AFT_PED.width,
    height: len,
    origin: 'center',
    material: 'panelDark',
    screws: false,
  });
  const mod = (name: string, x: number, y: number, w: number, h: number): Panel =>
    ped.subPanel({ name: `b738.p8.${name}`, x, y, width: w, height: h, origin: 'center', material: 'panel', screws: { kind: 'dzus', diameter: 0.007, positions: [[-w / 2 + 0.006, h / 2 - 0.006], [w / 2 - 0.006, h / 2 - 0.006], [-w / 2 + 0.006, -h / 2 + 0.006], [w / 2 - 0.006, -h / 2 + 0.006]] } });
  const lcd = (p: Panel, id: string, power: string, watch: string[], fields: ConstructorParameters<typeof LcdDisplay>[4], x: number, y: number, w: number, h: number, width = 320) => {
    if (c.headless) return;
    const d = new LcdDisplay(vars, id, power, watch, fields, width);
    p.display(d, x, y, w, h, { bezel: { border: 0.003, depth: 0.003 } });
    c.onDispose(() => d.dispose());
  };
  const knob2 = (p: Panel, id: string, label: string, radio: 'nav' | 'com' | 'adf', n: 1 | 2, x: number, y: number) =>
    p.add(
      new RotaryKnob(env, {
        id,
        label,
        cap: 'ring',
        innerCap: 'fluted',
        diameter: 0.02,
        outer: { incEvent: TUNE_EVENTS.knob(radio, n, 'outer', 'inc'), decEvent: TUNE_EVENTS.knob(radio, n, 'outer', 'dec'), label: radio === 'adf' ? '100 kHz' : 'MHz' },
        inner: { incEvent: TUNE_EVENTS.knob(radio, n, 'inner', 'inc'), decEvent: TUNE_EVENTS.knob(radio, n, 'inner', 'dec'), label: 'kHz' },
      }),
      x,
      y,
    );
  const f2 = (x: number) => x.toFixed(2);
  const f3 = (x: number) => x.toFixed(3);

  // ---------------------------------------------------------------- NAV 1 / 2
  for (const n of [1, 2] as const) {
    const p = mod(`nav${n}`, n === 1 ? UL : UR, 0.328, W2, 0.058);
    p.label(`NAV ${n}`, -0.058, 0.022, { height: 0.0024 });
    lcd(p, `b738_nav${n}_lcd`, NAV.powered(n), [NAV.activeFreq(n), NAV.standbyFreq(n)], [{ text: () => f2(vars.get(NAV.activeFreq(n), 108)), x: 80 }, { text: () => f2(vars.get(NAV.standbyFreq(n), 108)), x: 240 }], -0.012, 0.012, 0.095, 0.019);
    p.add(new PushButton(env, { id: `b738.aft.nav${n}_tfr`, label: `NAV ${n} TFR`, style: 'small', width: 0.01, height: 0.007, mode: 'momentary', var: B738.navXfer(n), engraved: 'TFR', engravedHeight: 0.0015 }), -0.012, -0.012);
    p.add(new PushButton(env, { id: `b738.aft.nav${n}_test`, label: `NAV ${n} TEST`, style: 'small', width: 0.01, height: 0.007, mode: 'momentary', var: B738.navTest(n), engraved: 'TEST', engravedHeight: 0.0015 }), -0.05, -0.012);
    knob2(p, `b738.aft.nav${n}_freq`, `NAV ${n} FREQUENCY`, 'nav', n, 0.052, -0.006);
  }
  // ---------------------------------------------------------------- VHF COM 1 / 2 (radio tuning panels)
  for (const n of [1, 2] as const) {
    const p = mod(`rtp${n}`, n === 1 ? UL : UR, 0.25, W2, 0.09);
    p.label(`VHF ${n}`, -0.058, 0.038, { height: 0.0024 });
    lcd(p, `b738_com${n}_lcd`, `com${n}.powered`, [NAV.comActive(n), NAV.comStandby(n)], [{ text: () => f3(vars.get(NAV.comActive(n), 118)), x: 80, size: 34 }, { text: () => f3(vars.get(NAV.comStandby(n), 118)), x: 240, size: 34 }], 0, 0.022, 0.12, 0.022);
    p.add(new PushButton(env, { id: `b738.aft.com${n}_tfr`, label: `VHF ${n} TFR`, style: 'small', width: 0.012, height: 0.008, mode: 'momentary', var: B738.comXfer(n), engraved: 'TFR', engravedHeight: 0.0015 }), 0, -0.004);
    toggle(env, p, { id: `b738.aft.rtp${n}_pwr`, label: `RADIO TUNING PANEL ${n}`, var: B738.rtpPower(n), positions: ['OFF', 'ON'], values: [0, 1], initial: 1, scale: 0.7 }, -0.05, -0.022, 'PANEL');
    knob2(p, `b738.aft.com${n}_freq`, `VHF ${n} FREQUENCY`, 'com', n, 0.05, -0.022);
  }
  // ---------------------------------------------------------------- audio control panels
  // FCOM 5.10 (737NG ACP): transmitter selectors (MIC lights) across the top, the receiver switch / volume
  // controls under them (push on / off, rotate for volume, lit when on), NAV / ADF / MKR receivers and the
  // SPKR volume, then the V-B-R filter, ALT-NORM, R/T - I/C push-to-talk and MASK - BOOM switches.
  // SCOPE: no audio routing; the logic publishes the mixer levels and the keyed transmitter (systems/logic.ts).
  const MICS = ['VHF 1', 'VHF 2', 'VHF 3', 'HF 1', 'HF 2', 'FLT', 'SERV', 'PA'];
  const RX_ROW1: AcpReceiver[] = ['vhf1', 'vhf2', 'vhf3', 'hf1', 'hf2', 'flt', 'svc', 'pa'];
  const RX_ROW2: [AcpReceiver, string][] = [
    ['nav1', 'NAV 1'],
    ['nav2', 'NAV 2'],
    ['adf1', 'ADF 1'],
    ['adf2', 'ADF 2'],
    ['mkr', 'MKR'],
    ['spkr', 'SPKR'],
  ];
  const pitch = 0.0168;
  const col0 = -3.5 * pitch;
  for (const s of [1, 2] as const) {
    const p = mod(`acp${s}`, s === 1 ? UL : UR, 0.14, W2, 0.115);
    p.label(s === 1 ? 'AUDIO CONTROL - CAPT' : 'AUDIO CONTROL - F/O', 0, 0.052, { height: 0.0019 });
    MICS.forEach((m, k) => {
      p.add(
        new PushButton(env, {
          id: `b738.aft.acp${s}_mic${k}`,
          label: `ACP ${s} MIC ${m}`,
          style: 'korry',
          width: 0.0148,
          height: 0.0125,
          mode: 'momentary',
          var: `ac.b738.ck.acp${s}_mic_btn${k}`,
          onChange: (x) => {
            if (x !== 0) vars.set(B738.acpMic(s), k);
          },
          // Transmitter selector: the MIC legend lights on the selected transmitter (FCOM 5.10).
          segments: [{ text: ['MIC', m], color: 'white', var: B738.acpMic(s), test: (x) => x === k, style: 'legend' }],
        }),
        col0 + k * pitch,
        0.037,
      );
    });
    const rxKnob = (rx: AcpReceiver, name: string, x: number, y: number) => {
      const on = rx === 'spkr' ? null : B738.acpRxOn(s, rx);
      p.add(
        new RotaryKnob(env, {
          id: `b738.aft.acp${s}_rx_${rx}`,
          label: `ACP ${s} ${name} RECEIVER${on ? ' (push on / off, turn volume)' : ' VOLUME'}`,
          cap: 'fluted',
          diameter: 0.0092,
          height: 0.008,
          pointer: 'none',
          outer: { var: B738.acpRxVol(s, rx), min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: `${name} VOL`, format: (x) => `${Math.round(x * 100)} %` },
          push: on ? { var: on, mode: 'toggle', label: `${name} ON/OFF` } : undefined,
        }),
        x,
        y,
      );
      // Receiver-on light (white segment above the control).
      if (on) annunciator(env, p, `b738.aft.acp${s}_rxlt_${rx}`, `ACP ${s} ${name} receiver on`, [seg.on('', 'white', on)], x, y + 0.0078, 0.009, 0.0024);
    };
    RX_ROW1.forEach((rx, k) => rxKnob(rx, MICS[k], col0 + k * pitch, 0.016));
    RX_ROW2.forEach(([rx, name], k) => {
      const x = col0 + k * pitch;
      rxKnob(rx, name, x, -0.012);
      p.label(name, x, -0.0215, { height: 0.0015 });
    });
    toggle(env, p, { id: `b738.aft.acp${s}_filter`, label: `ACP ${s} FILTER`, var: B738.acpFilter(s), positions: ['V', 'B', 'R'], values: [-1, 0, 1], initial: 1, orientation: 'horizontal', scale: 0.55, labels: { name: false, positions: true, height: 0.0015 } }, -0.05, -0.04);
    p.label('FILTER', -0.05, -0.029, { height: 0.0015 });
    toggle(env, p, { id: `b738.aft.acp${s}_alt`, label: `ACP ${s} ALT-NORM`, var: B738.acpAltNorm(s), positions: ['NORM', 'ALT'], values: [0, 1], initial: 0, scale: 0.55, labels: { name: false, positions: true, height: 0.0015 } }, -0.017, -0.04);
    p.label('ALT-NORM', -0.017, -0.029, { height: 0.0015 });
    // Push-to-talk: R/T spring-loaded (keys the selected transmitter), I/C latched (flight interphone). EST: I/C latch per FCOM 5.10 description.
    toggle(env, p, { id: `b738.aft.acp${s}_ptt`, label: `ACP ${s} PUSH TO TALK R/T - I/C`, var: B738.acpPtt(s), positions: ['I/C', 'OFF', 'R/T'], values: [-1, 0, 1], initial: 1, springs: { 2: 1 }, scale: 0.55, labels: { name: false, positions: true, height: 0.0015 } }, 0.017, -0.04);
    p.label('R/T - I/C', 0.017, -0.029, { height: 0.0015 });
    toggle(env, p, { id: `b738.aft.acp${s}_mask`, label: `ACP ${s} MASK-BOOM`, var: B738.acpMaskBoom(s), positions: ['BOOM', 'MASK'], values: [0, 1], initial: 0, scale: 0.55, labels: { name: false, positions: true, height: 0.0015 } }, 0.05, -0.04);
    p.label('MASK-BOOM', 0.05, -0.029, { height: 0.0015 });
  }
  // ---------------------------------------------------------------- fire protection panel
  {
    const p = mod('fire', 0, 0.018, 0.3, 0.13);
    p.label('FIRE PROTECTION', 0, 0.058, { height: 0.0024 });
    const handles: [1 | 2 | 'apu', string, number, string, string, string, string][] = [
      [1, '1', -0.085, 'fire.eng1_warn', B738.fireHandle(1), B738.fireRot(1), B738.lt.fireHandleLt(1)],
      ['apu', 'APU', 0, 'fire.apu_warn', B738.fireHandleApu, B738.fireRotApu, B738.lt.fireHandleApuLt],
      [2, '2', 0.085, 'fire.eng2_warn', B738.fireHandle(2), B738.fireRot(2), B738.lt.fireHandleLt(2)],
    ];
    for (const [h, legend, x, warn, hv, rv, lv] of handles) {
      p.add(
        new TBarHandle(env, {
          id: `b738.aft.fire_${h}`,
          label: h === 'apu' ? 'APU FIRE HANDLE' : `ENGINE ${h} FIRE HANDLE`,
          var: hv,
          rotateVar: rv,
          style: 'fire',
          rotate: 'discharge',
          unlockVar: warn,
          overrideVar: CK.fireOverride(h),
          lightVar: lv,
          legend,
        }),
        x,
        0.004,
      );
      // Fire handle override (manual release of the handle lock, FCOM 8.20).
      p.add(new PushButton(env, { id: `b738.aft.fire_ovrd_${h}`, label: `${h === 'apu' ? 'APU' : `ENG ${h}`} FIRE HANDLE OVERRIDE`, style: 'small', width: 0.006, height: 0.006, mode: 'momentary', var: CK.fireOverride(h), capMaterial: 'plasticBlack' }), x + 0.028, -0.01);
    }
    annunciator(env, p, 'b738.aft.eng1_ovht', 'ENG 1 OVERHEAT', [seg.on(['ENG 1', 'OVERHEAT'], 'amber', B738.lt.engOvht(1))], -0.085, 0.04, 0.03, 0.014);
    annunciator(env, p, 'b738.aft.wheel_well', 'WHEEL WELL', [seg.on(['WHEEL', 'WELL'], 'red', B738.lt.wheelWell)], 0, 0.04, 0.03, 0.014);
    annunciator(env, p, 'b738.aft.eng2_ovht', 'ENG 2 OVERHEAT', [seg.on(['ENG 2', 'OVERHEAT'], 'amber', B738.lt.engOvht(2))], 0.085, 0.04, 0.03, 0.014);
    annunciator(env, p, 'b738.aft.fire_fault', 'FAULT', [seg.on('FAULT', 'amber', B738.lt.fireFault)], -0.128, 0.04, 0.022, 0.012);
    annunciator(env, p, 'b738.aft.apu_det_inop', 'APU DET INOP', [seg.on(['APU DET', 'INOP'], 'amber', B738.lt.apuDetInop)], 0.128, 0.04, 0.022, 0.012);
    for (const [b1, name, x] of [
      ['l', 'L BOTTLE', -0.085],
      ['apu', 'APU BOTTLE', 0],
      ['r', 'R BOTTLE', 0.085],
    ] as const) {
      annunciator(env, p, `b738.aft.bottle_${b1}`, `${name} DISCHARGED`, [seg.on([name, 'DISCHARGED'], 'amber', B738.lt.bottleDischarge(b1))], x, -0.035, 0.034, 0.014);
      annunciator(env, p, `b738.aft.squib_${b1}`, `${name} squib test`, [seg.on('', 'green', B738.lt.squib(b1))], x, -0.052, 0.012, 0.007);
    }
    for (const i of [1, 2] as const)
      toggle(env, p, { id: `b738.aft.ovht_det${i}`, label: `OVHT DET ${i}`, var: B738.ovhtDet(i), positions: ['A', 'NORMAL', 'B'], values: [-1, 0, 1], initial: 1, orientation: 'horizontal', scale: 0.65 }, i === 1 ? -0.125 : 0.125, 0.015, `OVHT DET ${i}`);
    toggle(env, p, { id: 'b738.aft.fire_test', label: 'FIRE TEST', var: B738.fireTest, positions: ['FAULT/INOP', 'OFF', 'OVHT/FIRE'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, orientation: 'horizontal', scale: 0.65 }, -0.125, -0.028, 'TEST');
    toggle(env, p, { id: 'b738.aft.ext_test', label: 'EXTINGUISHER TEST', var: B738.extTest, positions: ['1', 'OFF', '2'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, orientation: 'horizontal', scale: 0.65 }, 0.125, -0.028, 'EXT TEST');
    p.add(new PushButton(env, { id: 'b738.aft.bell_cutout', label: 'BELL CUTOUT', style: 'round', width: 0.01, height: 0.01, mode: 'momentary', var: B738.bellCutout, engraved: 'BELL\nCUTOUT', engravedHeight: 0.0013 }), -0.04, 0.042);
  }
  // ---------------------------------------------------------------- ADF 1 / 2
  for (const n of [1, 2] as const) {
    const p = mod(`adf${n}`, n === 1 ? UL : UR, -0.085, W2, 0.06);
    p.label(`ADF ${n}`, -0.058, 0.024, { height: 0.0024 });
    lcd(p, `b738_adf${n}_lcd`, `elec.adf${n}_powered`, [NAV.adfActive(n), NAV.adfStandby(n)], [{ text: () => vars.get(NAV.adfActive(n), 350).toFixed(0), x: 80 }, { text: () => vars.get(NAV.adfStandby(n), 350).toFixed(0), x: 240 }], -0.012, 0.012, 0.09, 0.018);
    p.add(new PushButton(env, { id: `b738.aft.adf${n}_tfr`, label: `ADF ${n} TFR`, style: 'small', width: 0.01, height: 0.007, mode: 'momentary', var: B738.adfXfer(n), engraved: 'TFR', engravedHeight: 0.0015 }), -0.012, -0.014);
    p.add(
      new SelectorKnob(env, {
        id: `b738.aft.adf${n}_mode`,
        label: `ADF ${n} MODE`,
        var: B738.adfMode(n),
        positions: [
          { value: 0, label: 'OFF' },
          { value: 1, label: 'ANT' },
          { value: 2, label: 'ADF' },
        ],
        initial: 2,
        diameter: 0.012,
        labelHeight: 0.0017,
      }),
      -0.05,
      -0.012,
    );
    toggle(env, p, { id: `b738.aft.adf${n}_tone`, label: `ADF ${n} TONE`, var: B738.adfTone(n), positions: ['OFF', 'TONE'], values: [0, 1], initial: 0, scale: 0.6 }, 0.022, -0.014, 'TONE');
    knob2(p, `b738.aft.adf${n}_freq`, `ADF ${n} FREQUENCY`, 'adf', n, 0.055, -0.008);
  }
  // ---------------------------------------------------------------- cargo fire (left) and weather radar (right)
  {
    const p = mod('cargo', UL, -0.162, W2, 0.075);
    p.label('CARGO FIRE', 0, 0.03, { height: 0.0024 });
    for (const [z, x] of [
      ['fwd', -0.04],
      ['aft', 0.0],
    ] as const) {
      toggle(env, p, { id: `b738.aft.cargo_det_${z}`, label: `CARGO DET SELECT ${z.toUpperCase()}`, var: B738.cargoDetSel(z), positions: ['A', 'ORM', 'B'], values: [-1, 0, 1], initial: 1, orientation: 'horizontal', scale: 0.6 }, x, 0.012, z.toUpperCase());
      p.add(
        new PushButton(env, {
          id: `b738.aft.cargo_arm_${z}`,
          label: `CARGO ${z.toUpperCase()} ARM`,
          style: 'korry',
          width: 0.024,
          height: 0.016,
          mode: 'toggle',
          var: B738.cargoArm(z),
          layout: 'stack',
          segments: [
            { text: z.toUpperCase(), color: 'red', var: B738.lt.cargoFire(z), style: 'legend' },
            { text: 'ARMED', color: 'white', var: B738.lt.cargoExtArmed(z), style: 'legend' },
          ],
        }),
        x,
        -0.017,
      );
    }
    p.add(
      new GuardedButton(env, {
        id: 'b738.aft.cargo_disch',
        label: 'CARGO DISCH',
        style: 'korry',
        width: 0.022,
        height: 0.016,
        mode: 'momentary',
        var: B738.cargoDisch,
        segments: [{ text: 'DISCH', color: 'amber', var: B738.lt.cargoDischarged, style: 'legend' }],
        guard: { color: 'red' },
      }),
      0.042,
      -0.017,
    );
    p.add(new PushButton(env, { id: 'b738.aft.cargo_test', label: 'CARGO FIRE TEST', style: 'round', width: 0.009, height: 0.009, mode: 'momentary', var: B738.cargoTest, engraved: 'TEST', engravedHeight: 0.0014 }), 0.042, 0.014);
  }
  {
    const p = mod('wxr', UR, -0.162, W2, 0.075);
    p.label('WEATHER RADAR', 0, 0.03, { height: 0.0024 });
    p.add(
      new SelectorKnob(env, {
        id: 'b738.aft.wxr_mode',
        label: 'WXR MODE',
        var: B738.wxrMode,
        positions: [
          { value: 0, label: 'WX' },
          { value: 1, label: 'WX+T' },
          { value: 2, label: 'MAP' },
          { value: 3, label: 'TEST' },
        ],
        initial: 0,
        diameter: 0.013,
        labelHeight: 0.0017,
      }),
      -0.045,
      -0.008,
    );
    p.add(new RotaryKnob(env, { id: 'b738.aft.wxr_gain', label: 'WXR GAIN', cap: 'fluted', diameter: 0.012, outer: { var: B738.wxrGain, min: 0, max: 1, step: 0.05, initial: 0.5, angleRange: [-140, 140], label: 'GAIN', format: (x) => `${Math.round(x * 100)} %` } }), 0.005, -0.008);
    p.label('GAIN', 0.005, 0.009, { height: 0.0019 });
    p.add(new RotaryKnob(env, { id: 'b738.aft.wxr_tilt', label: 'WXR TILT', cap: 'fluted', diameter: 0.012, outer: { var: B738.wxrTilt, min: -15, max: 15, step: 0.5, initial: 0, angleRange: [-140, 140], label: 'TILT', format: (x) => `${x >= 0 ? 'UP' : 'DN'} ${Math.abs(x).toFixed(1)}°` } }), 0.042, -0.008);
    p.label('TILT', 0.042, 0.009, { height: 0.0019 });
    toggle(env, p, { id: 'b738.aft.wxr_pwr', label: 'WXR POWER', var: B738.wxrPower, positions: ['OFF', 'ON'], values: [0, 1], initial: 0, scale: 0.6 }, 0.062, 0.018, '');
  }
  // ---------------------------------------------------------------- ATC / TCAS
  {
    const p = mod('atc', 0, -0.255, 0.3, 0.085);
    p.label('ATC / TCAS', -0.12, 0.034, { height: 0.0024 });
    lcd(p, 'b738_xpdr_lcd', 'elec.xpdr_sel_powered', [NAV.xpdrCode], [{ text: () => String(Math.round(vars.get(NAV.xpdrCode, 2000))).padStart(4, '0'), x: 120, size: 44 }], 0, 0.02, 0.06, 0.02, 240);
    const digitKnob = (id: string, a: 1 | 3, x: number) =>
      p.add(
        new RotaryKnob(env, {
          id,
          label: `ATC CODE ${a === 1 ? '1st/2nd' : '3rd/4th'} DIGITS`,
          cap: 'ring',
          innerCap: 'fluted',
          diameter: 0.018,
          outer: { incEvent: TUNE_EVENTS.xpdrDigit(a, 'inc'), decEvent: TUNE_EVENTS.xpdrDigit(a, 'dec'), label: `DIGIT ${a}` },
          inner: { incEvent: TUNE_EVENTS.xpdrDigit((a + 1) as 2 | 4, 'inc'), decEvent: TUNE_EVENTS.xpdrDigit((a + 1) as 2 | 4, 'dec'), label: `DIGIT ${a + 1}` },
        }),
        x,
        -0.015,
      );
    digitKnob('b738.aft.xpdr_code_l', 1, -0.05);
    digitKnob('b738.aft.xpdr_code_r', 3, 0.05);
    p.add(
      new SelectorKnob(env, {
        id: 'b738.aft.xpdr_mode',
        label: 'ATC/TCAS MODE',
        var: B738.xpdrModeSel,
        positions: [
          { value: XPDR_SEL.test, label: 'TEST', spring: 1 },
          { value: XPDR_SEL.stby, label: 'STBY' },
          { value: XPDR_SEL.altOff, label: 'ALT RPTG OFF', display: 'ALT RPTG\nOFF' },
          { value: XPDR_SEL.xpndr, label: 'XPNDR' },
          { value: XPDR_SEL.taOnly, label: 'TA ONLY', display: 'TA\nONLY' },
          { value: XPDR_SEL.taRa, label: 'TA/RA' },
        ],
        initial: 1,
        diameter: 0.016,
        labelHeight: 0.0016,
      }),
      0,
      -0.02,
    );
    p.add(new PushButton(env, { id: 'b738.aft.xpdr_ident', label: 'IDENT', style: 'round', width: 0.011, height: 0.011, mode: 'momentary', var: B738.xpdrIdentBtn, engraved: 'IDENT', engravedHeight: 0.0015 }), 0.1, 0.02);
    toggle(env, p, { id: 'b738.aft.xpdr_atc', label: 'ATC 1/2', var: B738.xpdrAtc, positions: ['1', '2'], values: [1, 2], initial: 0, orientation: 'horizontal', scale: 0.6 }, -0.12, 0.012, 'ATC');
    toggle(env, p, { id: 'b738.aft.xpdr_alt_src', label: 'ALT SOURCE', var: B738.xpdrAltSrc, positions: ['1', '2'], values: [1, 2], initial: 0, orientation: 'horizontal', scale: 0.6 }, -0.12, -0.022, 'ALT SOURCE');
    toggle(env, p, { id: 'b738.aft.tcas_range', label: 'TCAS ABOVE/NORM/BELOW', var: B738.tcasRange, positions: ['BELOW', 'NORM', 'ABOVE'], values: [-1, 0, 1], initial: 1, scale: 0.6 }, 0.12, -0.018, '');
  }
  // ---------------------------------------------------------------- trim panel (left) and door / lights (right)
  {
    const p = mod('trim', UL, -0.328, W2, 0.058);
    for (const n of [1, 2] as const)
      toggle(env, p, { id: `b738.aft.ail_trim${n}`, label: `AILERON TRIM switch ${n}`, var: B738.ailTrim(n), positions: ['L WING DN', '0', 'R WING DN'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, orientation: 'horizontal', scale: 0.7, labels: { name: n === 1 ? 'AILERON' : false, positions: n === 1, height: 0.0016 } }, -0.052 + (n - 1) * 0.022, 0.0);
    // Rudder trim knob (spring-loaded to neutral) and indicator (units).
    p.add(
      new RotaryKnob(env, {
        id: 'b738.aft.rud_trim',
        label: 'RUDDER TRIM',
        cap: 'pointer',
        diameter: 0.018,
        outer: {
          var: B738.rudTrim,
          positions: [
            { value: -1, label: 'NOSE LEFT', spring: 1 },
            { value: 0, label: '0' },
            { value: 1, label: 'NOSE RIGHT', spring: 1 },
          ],
          angles: [-40, 0, 40],
          initial: 1,
          label: 'RUDDER TRIM',
        },
      }),
      0.012,
      -0.014,
    );
    p.label('RUDDER', 0.012, 0.004, { height: 0.0018 });
    if (!c.headless) {
      const rt = new DialDisplay({
        id: 'b738_rud_trim_ind',
        vars,
        powerVar: 'elec.dc_stby_powered',
        angle: (v) => (Math.max(-16, Math.min(16, v)) / 16) * 60,
        ticks: [-16, -12, -8, -4, 0, 4, 8, 12, 16].map((v) => ({ v, label: v % 8 === 0 ? String(Math.abs(v)) : undefined, major: v % 8 === 0 })),
        needles: [{ var: B738.lt.rudderTrimUnits, color: '#f2f2f2' }],
        title: ['RUDDER TRIM', 'NOSE L   NOSE R'],
        titleY: 176,
      });
      p.roundInstrument(rt, 0.038, 0.01, 0.028);
      c.onDispose(() => rt.dispose());
    }
    p.add(
      new GuardedSwitch(env, {
        id: 'b738.aft.stab_trim_ovrd',
        label: 'STAB TRIM OVERRIDE',
        var: B738.stabTrimOvrd,
        positions: ['NORMAL', 'OVERRIDE'],
        values: [0, 1],
        initial: 0,
        labels: { name: 'STAB TRIM', positions: true, height: 0.0016 },
        guard: { color: 'red', guardedPosition: 0 },
      }),
      0.062,
      -0.01,
    );
  }
  {
    const p = mod('door', UR, -0.328, W2, 0.058);
    p.label('FLT DECK DOOR', -0.04, 0.022, { height: 0.0021 });
    p.add(
      new SelectorKnob(env, {
        id: 'b738.aft.fd_door',
        label: 'FLT DECK DOOR LOCK',
        var: B738.fdDoorLock,
        positions: [
          { value: -1, label: 'UNLKD' },
          { value: 0, label: 'AUTO' },
          { value: 1, label: 'DENY', spring: 1 },
        ],
        initial: 1,
        diameter: 0.013,
        labelHeight: 0.0017,
      }),
      -0.04,
      -0.006,
    );
    annunciator(env, p, 'b738.aft.lock_fail', 'LOCK FAIL', [seg.on(['LOCK', 'FAIL'], 'amber', B738.lt.lockFail)], -0.005, 0.008, 0.022, 0.012);
    dimmer(env, p, 'b738.aft.ped_panel', 'PEDESTAL PANEL LIGHTS', B738.pedestalPanelLt, 0.03, -0.012, 'PANEL');
    dimmer(env, p, 'b738.aft.ped_flood', 'PEDESTAL FLOOD', B738.pedestalFlood, 0.058, -0.012, 'FLOOD');
  }
}
