/**
 * 737-800 aft electronic panel (P8), laid out as on the SCBG 1:1 P8 drawing
 * (top view, 2,830 px/m): the fire protection panel at the forward end
 * (immediately aft of the control stand, ~0.27 m wide), then three 146 mm
 * module columns (dossier §10.15; FCOM 5.10 Communications, 8.10 Fire
 * protection, 9.10 Flight controls, 11 / 15 ATC-TCAS, 16 weather radar):
 *
 *   VHF COMM 1      | CARGO FIRE                 | VHF COMM 2
 *   NAV 1           | WEATHER RADAR              | NAV 2
 *   AUDIO CONTROL 1 | SELCAL / ATC-TCAS          | AUDIO CONTROL 2
 *   HF 1            | ADF (ADF 1 and ADF 2)      | HF 2
 *   (blank)         | (blank)                    | (blank)
 *   FLOOD / PANEL   | RUDDER / AILERON TRIM      | STAB TRIM OVERRIDE, CAB DOOR
 *
 * Fire panel: OVHT DET 1 / 2 A-NORMAL-B, TEST FAULT/INOP - OVHT/FIRE, engine
 * 1 / APU / engine 2 fire handles (unlocked by a fire warning or the
 * override button; pull, rotate to discharge), ENG OVERHEAT, WHEEL WELL,
 * FAULT, APU DET INOP, APU / L / R BOTTLE DISCHARGED, BELL CUTOUT, ENGINES
 * EXT TEST 1 / 2 with the squib lights.
 *
 * SCOPE: the ACP receiver controls, push-to-talk and MASK-BOOM switches
 * publish mixer levels / keying state only (no audio routing). HF panels:
 * state only (no HF propagation; `HF_FITTED` = operator option). SELCAL:
 * push-to-reset lights; no ground-station calls are generated. The VHF COMM
 * TEST (self-test segment pattern) and the WXR IDNT / STAB buttons are modelled
 * (vars.ts comTest / wxrIdnt / wxrStab; logic.ts / surveillance.ts consume them).
 * The radio panels keep an active / standby window pair.
 */
import { GuardedButton, GuardedSwitch, PushButton, RotaryKnob, SelectorKnob, TBarHandle } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { NAV } from '../../../core/vars';
import { B738, XPDR_SEL, type AcpReceiver } from '../vars';
import type { B738CockpitContext } from './context';
import { CK, seg } from './context';
import { annunciator, dimmer, toggle } from './common';
import { LcdDisplay, RudderTrimIndicator } from './displays';
import { AFT_PED } from './layout';
import { TUNE_EVENTS } from './radioTuning';

/** HF control panels are an operator option (SCBG drawing shows two); false builds blank plates instead. */
export const HF_FITTED = true;

/** Module column width (Boeing 146 mm DZUS modules) and column centres (u). */
const W2 = 0.146;
const UL = -0.148;
const UR = 0.148;
/** Legend heights (SCBG: titles ~3 mm, legends ~2.5 mm). */
const TH = 0.003;
const LH = 0.0024;

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
  // Row edges (v, forward = +), from the drawing: fire 0.074, then 0.066 / 0.071 / 0.115 / 0.068 / 0.099 / 0.059
  // (side columns); centre column SELCAL 0.038, ATC 0.059, ADF 0.068, blank 0.080, trim 0.096.
  const top = len / 2;
  const rowsSide = [0.074, 0.066, 0.071, 0.115, 0.068, 0.099, 0.059];
  const edgesS: number[] = [top];
  for (const h of rowsSide) edgesS.push(edgesS[edgesS.length - 1] - h);
  const rowS = (i: number) => ({ y: (edgesS[i] + edgesS[i + 1]) / 2, h: edgesS[i] - edgesS[i + 1] - 0.002 });
  const centreRows = [0.074, 0.066, 0.071, 0.038, 0.059, 0.068, 0.08, 0.096];
  const edgesC: number[] = [top];
  for (const h of centreRows) edgesC.push(edgesC[edgesC.length - 1] - h);
  const rowC = (i: number) => ({ y: (edgesC[i] + edgesC[i + 1]) / 2, h: edgesC[i] - edgesC[i + 1] - 0.002 });
  const mod = (name: string, x: number, y: number, w: number, h: number): Panel =>
    ped.subPanel({ name: `b738.p8.${name}`, x, y, width: w, height: h, origin: 'center', material: 'panel', screws: { kind: 'dzus', diameter: 0.007, positions: [[-w / 2 + 0.006, h / 2 - 0.006], [w / 2 - 0.006, h / 2 - 0.006], [-w / 2 + 0.006, -h / 2 + 0.006], [w / 2 - 0.006, -h / 2 + 0.006]] } });
  const lcd = (p: Panel, id: string, power: string, watch: string[], fields: ConstructorParameters<typeof LcdDisplay>[4], x: number, y: number, w: number, h: number, width = 320) => {
    if (c.headless) return;
    const d = new LcdDisplay(vars, id, power, watch, fields, width);
    p.display(d, x, y, w, h, { bezel: { border: 0.003, depth: 0.003 } });
    c.onDispose(() => d.dispose());
  };
  const knob2 = (p: Panel, id: string, label: string, radio: 'nav' | 'com' | 'adf', n: 1 | 2, x: number, y: number, d = 0.018) =>
    p.add(
      new RotaryKnob(env, {
        id,
        label,
        cap: 'ring',
        innerCap: 'fluted',
        diameter: d,
        outer: { incEvent: TUNE_EVENTS.knob(radio, n, 'outer', 'inc'), decEvent: TUNE_EVENTS.knob(radio, n, 'outer', 'dec'), label: radio === 'adf' ? '100 kHz' : 'MHz' },
        inner: { incEvent: TUNE_EVENTS.knob(radio, n, 'inner', 'inc'), decEvent: TUNE_EVENTS.knob(radio, n, 'inner', 'dec'), label: 'kHz' },
      }),
      x,
      y,
    );
  const f2 = (x: number) => x.toFixed(2);
  const f3 = (x: number) => x.toFixed(3);

  // ---------------------------------------------------------------- VHF COMM 1 / 2 (radio tuning panels), row 1
  for (const n of [1, 2] as const) {
    const r = rowS(1);
    const p = mod(`rtp${n}`, n === 1 ? UL : UR, r.y, W2, r.h);
    p.label('V\nH\nF', -0.066, 0.004, { height: 0.0026, lineHeight: 1.1 });
    p.label('C\nO\nM\nM', 0.066, 0.004, { height: 0.0026, lineHeight: 1.1 });
    // TEST held: the panel drives every LCD segment (all-8s pattern; Gables NG RTP TEST button, SCBG P8 drawing).
    const tAct = `ac.b738.rtp${n}_test_active`;
    const fq = (v0: string) => () => (vars.get(tAct) !== 0 ? '888.888' : f3(vars.get(v0, 118)));
    lcd(p, `b738_com${n}_lcd`, `com${n}.powered`, [NAV.comActive(n), NAV.comStandby(n), tAct], [{ text: fq(NAV.comActive(n)), x: 80, size: 34 }, { text: fq(NAV.comStandby(n)), x: 240, size: 34 }], 0, 0.016, 0.112, 0.018);
    p.add(new PushButton(env, { id: `b738.aft.com${n}_tfr`, label: `VHF ${n} TFR`, style: 'small', width: 0.01, height: 0.007, mode: 'momentary', var: B738.comXfer(n), engraved: 'TFR', engravedHeight: 0.0018 }), 0, 0.001);
    toggle(env, p, { id: `b738.aft.rtp${n}_pwr`, label: `RADIO TUNING PANEL ${n}`, var: B738.rtpPower(n), positions: ['OFF', 'ON'], values: [0, 1], initial: 1, scale: 0.6, labels: { name: 'PANEL', positions: true, height: 0.0019 } }, -0.045, -0.014);
    p.add(new PushButton(env, { id: `b738.aft.rtp${n}_test`, label: `VHF COMM ${n} TEST`, style: 'round', width: 0.009, height: 0.009, mode: 'momentary', var: B738.comTest(n), capMaterial: 'plasticBlack' }), -0.02, -0.02);
    p.label('TEST', -0.02, -0.009, { height: LH });
    knob2(p, `b738.aft.com${n}_freq`, `VHF ${n} FREQUENCY`, 'com', n, 0.045, -0.014);
  }
  // ---------------------------------------------------------------- NAV 1 / 2, row 2
  for (const n of [1, 2] as const) {
    const r = rowS(2);
    const p = mod(`nav${n}`, n === 1 ? UL : UR, r.y, W2, r.h);
    p.label('N\nA\nV', -0.066, 0.0, { height: 0.0026, lineHeight: 1.1 });
    p.label('ACTIVE', -0.032, 0.029, { height: LH });
    p.label('STANDBY', 0.032, 0.029, { height: LH });
    lcd(p, `b738_nav${n}_lcd`, NAV.powered(n), [NAV.activeFreq(n), NAV.standbyFreq(n)], [{ text: () => f2(vars.get(NAV.activeFreq(n), 108)), x: 80 }, { text: () => f2(vars.get(NAV.standbyFreq(n), 108)), x: 240 }], 0, 0.015, 0.112, 0.018);
    p.add(new PushButton(env, { id: `b738.aft.nav${n}_tfr`, label: `NAV ${n} TFR`, style: 'small', width: 0.01, height: 0.007, mode: 'momentary', var: B738.navXfer(n), engraved: 'TFR', engravedHeight: 0.0018 }), 0, 0.0);
    p.add(new PushButton(env, { id: `b738.aft.nav${n}_test`, label: `NAV ${n} TEST`, style: 'round', width: 0.011, height: 0.011, mode: 'momentary', var: B738.navTest(n), capMaterial: 'plasticBlack' }), -0.045, -0.016);
    p.label('TEST', -0.045, -0.004, { height: LH });
    knob2(p, `b738.aft.nav${n}_freq`, `NAV ${n} FREQUENCY`, 'nav', n, 0.045, -0.016);
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
    const r = rowS(3);
    const p = mod(`acp${s}`, s === 1 ? UL : UR, r.y, W2, r.h);
    p.label('MIC SELECTOR', 0, 0.051, { height: 0.0022 });
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
  // ---------------------------------------------------------------- fire protection panel (forward end, ~0.273 m wide)
  {
    const r = rowS(0);
    const p = mod('fire', 0, r.y, 0.273, r.h);
    const handles: [1 | 2 | 'apu', string, number, string, string, string, string][] = [
      [1, '1', -0.0675, 'fire.eng1_warn', B738.fireHandle(1), B738.fireRot(1), B738.lt.fireHandleLt(1)],
      ['apu', 'APU', 0.011, 'fire.apu_warn', B738.fireHandleApu, B738.fireRotApu, B738.lt.fireHandleApuLt],
      [2, '2', 0.089, 'fire.eng2_warn', B738.fireHandle(2), B738.fireRot(2), B738.lt.fireHandleLt(2)],
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
        -0.009,
      );
      // Fire handle override (manual release of the handle lock, FCOM 8.20: "button under handle").
      p.add(new PushButton(env, { id: `b738.aft.fire_ovrd_${h}`, label: `${h === 'apu' ? 'APU' : `ENG ${h}`} FIRE HANDLE OVERRIDE`, style: 'small', width: 0.006, height: 0.006, mode: 'momentary', var: CK.fireOverride(h), capMaterial: 'plasticBlack' }), x, -0.032);
      p.label('DISCH', x, 0.022, { height: 0.0019 });
    }
    // OVHT DET 1 / 2 (A - NORMAL - B) with ENG 1 / 2 OVERHEAT under them.
    for (const i of [1, 2] as const) {
      const x = i === 1 ? -0.1035 : 0.055;
      toggle(env, p, { id: `b738.aft.ovht_det${i}`, label: `OVHT DET ${i}`, var: B738.ovhtDet(i), positions: ['A', 'NORMAL', 'B'], values: [-1, 0, 1], initial: 1, orientation: 'horizontal', scale: 0.6, labels: { name: false, positions: false, height: 0.0019 } }, x, 0.019);
      p.label('OVHT DET', x, 0.031, { height: LH });
      p.label('A', x - 0.013, 0.019, { height: 0.0021 });
      p.label('B', x + 0.013, 0.019, { height: 0.0021 });
      p.label('NORMAL', x, 0.008, { height: 0.0019 });
      annunciator(env, p, `b738.aft.eng${i}_ovht`, `ENG ${i} OVERHEAT`, [seg.on([`ENG ${i}`, 'OVERHEAT'], 'amber', B738.lt.engOvht(i))], x + 0.001, -0.002, 0.026, 0.012);
    }
    toggle(env, p, { id: 'b738.aft.fire_test', label: 'FIRE TEST', var: B738.fireTest, positions: ['FAULT/INOP', 'OFF', 'OVHT/FIRE'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, orientation: 'horizontal', scale: 0.6, labels: { name: false, positions: false, height: 0.0019 } }, -0.1, -0.026);
    p.label('TEST', -0.1, -0.015, { height: LH });
    p.label('FAULT\nINOP', -0.121, -0.026, { height: 0.0017, lineHeight: 1.1 });
    p.label('OVHT\nFIRE', -0.08, -0.026, { height: 0.0017, lineHeight: 1.1 });
    // Centre light column: WHEEL WELL, FAULT, APU DET INOP, APU BOTTLE DISCHARGED; BELL CUTOUT beside it.
    annunciator(env, p, 'b738.aft.wheel_well', 'WHEEL WELL', [seg.on(['WHEEL', 'WELL'], 'red', B738.lt.wheelWell)], -0.025, 0.028, 0.024, 0.011);
    annunciator(env, p, 'b738.aft.fire_fault', 'FAULT', [seg.on('FAULT', 'amber', B738.lt.fireFault)], -0.025, 0.011, 0.024, 0.011);
    annunciator(env, p, 'b738.aft.apu_det_inop', 'APU DET INOP', [seg.on(['APU DET', 'INOP'], 'amber', B738.lt.apuDetInop)], -0.025, -0.007, 0.024, 0.011);
    annunciator(env, p, 'b738.aft.bottle_apu', 'APU BOTTLE DISCHARGED', [seg.on(['APU BOTTLE', 'DISCHARGED'], 'amber', B738.lt.bottleDischarge('apu'))], -0.025, -0.025, 0.024, 0.011);
    p.add(new PushButton(env, { id: 'b738.aft.bell_cutout', label: 'BELL CUTOUT', style: 'korry', width: 0.026, height: 0.01, mode: 'momentary', var: B738.bellCutout, engraved: 'BELL CUTOUT', engravedHeight: 0.0019, capMaterial: 'plasticBlack' }), 0.018, 0.03);
    // L / R BOTTLE DISCHARGED and the ENGINES EXT TEST switch with the squib lights (L, R, APU).
    annunciator(env, p, 'b738.aft.bottle_l', 'L BOTTLE DISCHARGED', [seg.on(['L BOTTLE', 'DISCHARGED'], 'amber', B738.lt.bottleDischarge('l'))], 0.096, 0.024, 0.024, 0.011);
    annunciator(env, p, 'b738.aft.bottle_r', 'R BOTTLE DISCHARGED', [seg.on(['R BOTTLE', 'DISCHARGED'], 'amber', B738.lt.bottleDischarge('r'))], 0.124, 0.024, 0.024, 0.011);
    toggle(env, p, { id: 'b738.aft.ext_test', label: 'EXTINGUISHER TEST', var: B738.extTest, positions: ['1', 'OFF', '2'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, orientation: 'horizontal', scale: 0.5, labels: { name: false, positions: true, height: 0.0017 } }, 0.13, 0.002);
    p.label('ENGINES', 0.118, 0.013, { height: 0.0021 });
    for (const [b1, x, y] of [
      ['l', 0.122, -0.014],
      ['r', 0.137, -0.014],
      ['apu', 0.13, -0.027],
    ] as const)
      annunciator(env, p, `b738.aft.squib_${b1}`, `${b1 === 'apu' ? 'APU' : b1.toUpperCase()} squib test`, [seg.on('', 'green', B738.lt.squib(b1))], x, y, 0.01, 0.01);
    p.placard({ text: 'FIRE SWITCHES\n(FUEL SHUTOFF)\nPULL WHEN ILLUMINATED\nLOCK OVERRIDE: PRESS\nBUTTON UNDER HANDLE', height: 0.0014, style: 'inverse' }, 0.052, -0.026);
  }
  // ---------------------------------------------------------------- centre column: cargo fire (row 1), weather radar (row 2)
  {
    const r = rowC(1);
    const p = mod('cargo', 0, r.y, W2, r.h);
    p.label('C\nA\nR\nG\nO', -0.066, 0.0, { height: 0.0022, lineHeight: 1.05 });
    p.label('F\nI\nR\nE', 0.066, 0.0, { height: 0.0022, lineHeight: 1.05 });
    p.label('DET SELECT', -0.005, 0.029, { height: 0.0022 });
    for (const [z, x] of [
      ['fwd', -0.02],
      ['aft', 0.01],
    ] as const) {
      toggle(env, p, { id: `b738.aft.cargo_det_${z}`, label: `CARGO DET SELECT ${z.toUpperCase()}`, var: B738.cargoDetSel(z), positions: ['A', 'NORM', 'B'], values: [-1, 0, 1], initial: 1, orientation: 'horizontal', scale: 0.5, labels: { name: z.toUpperCase(), positions: false, height: 0.0019 } }, x, 0.016);
      p.add(
        new PushButton(env, {
          id: `b738.aft.cargo_arm_${z}`,
          label: `CARGO ${z.toUpperCase()} ARM`,
          style: 'korry',
          width: 0.022,
          height: 0.016,
          mode: 'toggle',
          var: B738.cargoArm(z),
          layout: 'stack',
          segments: [
            { text: 'ARMED', color: 'white', var: B738.lt.cargoExtArmed(z), style: 'legend' },
            { text: z.toUpperCase(), color: 'red', var: B738.lt.cargoFire(z), style: 'legend' },
          ],
        }),
        x,
        -0.013,
      );
    }
    p.label('ARM', -0.005, -0.001, { height: 0.0019 });
    p.add(
      new GuardedButton(env, {
        id: 'b738.aft.cargo_disch',
        label: 'CARGO DISCH',
        style: 'korry',
        width: 0.02,
        height: 0.016,
        mode: 'momentary',
        var: B738.cargoDisch,
        segments: [{ text: 'DISCH', color: 'amber', var: B738.lt.cargoDischarged, style: 'legend' }],
        guard: { color: 'black' },
      }),
      0.043,
      -0.01,
    );
    p.add(new PushButton(env, { id: 'b738.aft.cargo_test', label: 'CARGO FIRE TEST', style: 'round', width: 0.009, height: 0.009, mode: 'momentary', var: B738.cargoTest, capMaterial: 'plasticBlack' }), -0.05, -0.016);
    p.label('TEST', -0.05, -0.005, { height: 0.0019 });
    // DETECTOR FAULT (amber) and the two EXTINGUISHER squib test lights (green), FCOM 8.10 cargo fire panel.
    annunciator(env, p, 'b738.aft.cargo_det_fault', 'CARGO DETECTOR FAULT', [seg.on(['DETECTOR', 'FAULT'], 'amber', B738.lt.cargoDetFault)], 0.043, 0.02, 0.022, 0.011);
    for (const [z, x] of [
      ['fwd', 0.036],
      ['aft', 0.05],
    ] as const)
      annunciator(env, p, `b738.aft.cargo_squib_${z}`, `CARGO EXTINGUISHER ${z.toUpperCase()} squib test`, [seg.on('', 'green', B738.lt.cargoSquib(z))], x, -0.026, 0.008, 0.008);
    p.label('EXTINGUISHER', 0.043, -0.033, { height: 0.0015 });
  }
  {
    const r = rowC(2);
    const p = mod('wxr', 0, r.y, W2, r.h);
    p.label('MODE', 0, 0.03, { height: 0.0022 });
    p.add(
      new SelectorKnob(env, {
        id: 'b738.aft.wxr_mode',
        label: 'WXR MODE',
        var: B738.wxrMode,
        positions: [
          { value: 3, label: 'TEST' },
          { value: 0, label: 'WX' },
          { value: 1, label: 'WX+T' },
          { value: 2, label: 'MAP' },
        ],
        initial: 1,
        diameter: 0.012,
        labelHeight: 0.0019,
      }),
      0,
      0.008,
    );
    p.add(new RotaryKnob(env, { id: 'b738.aft.wxr_gain', label: 'WXR GAIN', cap: 'fluted', diameter: 0.016, outer: { var: B738.wxrGain, min: 0, max: 1, step: 0.05, initial: 0.5, angleRange: [-140, 140], label: 'GAIN', format: (x) => `${Math.round(x * 100)} %` } }), -0.042, -0.006);
    p.label('GAIN', -0.042, -0.02, { height: 0.0021 });
    p.add(new RotaryKnob(env, { id: 'b738.aft.wxr_tilt', label: 'WXR TILT', cap: 'fluted', diameter: 0.016, outer: { var: B738.wxrTilt, min: -15, max: 15, step: 0.5, initial: 0, angleRange: [-140, 140], label: 'TILT', format: (x) => `${x >= 0 ? 'UP' : 'DN'} ${Math.abs(x).toFixed(1)}°` } }), 0.042, -0.006);
    p.label('TILT', 0.042, -0.02, { height: 0.0021 });
    // IDNT (momentary: ground clutter suppressed while held) and STAB (antenna stabilization) buttons of the NG
    // radar controller (SCBG P8 drawing; surveillance.ts consumes wxr.idnt / wxr.stab).
    p.add(new PushButton(env, { id: 'b738.aft.wxr_idnt', label: 'WXR IDNT (hold: ground clutter suppressed)', style: 'small', width: 0.011, height: 0.008, mode: 'momentary', var: B738.wxrIdnt, engraved: 'IDNT', engravedHeight: 0.0017 }), -0.02, -0.026);
    p.add(new PushButton(env, { id: 'b738.aft.wxr_stab', label: 'WXR STAB (antenna stabilization)', style: 'small', width: 0.011, height: 0.008, mode: 'toggle', var: B738.wxrStab, values: [0, 1], initial: 1, engraved: 'STAB', engravedHeight: 0.0017 }), 0.02, -0.026);
    // No radar on/off switch on the NG panel: the radar transmits while WXR is selected on an EFIS control panel
    // (FCOM 11.30); the former power toggle is not fitted.
  }
  // ---------------------------------------------------------------- SELCAL (push-to-reset lights), row 3 centre
  {
    const r = rowC(3);
    const p = mod('selcal', 0, r.y, W2, r.h);
    p.label('SELCAL', 0, 0.013, { height: TH });
    ['VHF 1', 'VHF 2', 'VHF 3', 'HF 1', 'HF 2'].forEach((name, k) => {
      p.add(
        new PushButton(env, {
          id: `b738.aft.selcal${k}`,
          label: `SELCAL ${name} (push to reset)`,
          style: 'korry',
          width: 0.02,
          height: 0.009,
          mode: 'momentary',
          var: B738.selcalReset(k as 0 | 1 | 2 | 3 | 4),
          segments: [{ text: name, color: 'white', var: B738.lt.selcal(k as 0 | 1 | 2 | 3 | 4), style: 'legend' }],
        }),
        -0.05 + k * 0.025,
        0.0,
      );
    });
    p.label('PRESS TO RESET', 0, -0.012, { height: 0.0021 });
  }
  // ---------------------------------------------------------------- ATC / TCAS, row 3 centre
  {
    const r = rowC(4);
    const p = mod('atc', 0, r.y, W2, r.h);
    p.label('ATC 1', -0.01, 0.024, { height: 0.0021 });
    lcd(p, 'b738_xpdr_lcd', 'elec.xpdr_sel_powered', [NAV.xpdrCode], [{ text: () => String(Math.round(vars.get(NAV.xpdrCode, 2000))).padStart(4, '0'), x: 120, size: 44 }], -0.01, 0.012, 0.04, 0.014, 240);
    const digitKnob = (id: string, a: 1 | 3, x: number) =>
      p.add(
        new RotaryKnob(env, {
          id,
          label: `ATC CODE ${a === 1 ? '1st/2nd' : '3rd/4th'} DIGITS`,
          cap: 'ring',
          innerCap: 'fluted',
          diameter: 0.015,
          outer: { incEvent: TUNE_EVENTS.xpdrDigit(a, 'inc'), decEvent: TUNE_EVENTS.xpdrDigit(a, 'dec'), label: `DIGIT ${a}` },
          inner: { incEvent: TUNE_EVENTS.xpdrDigit((a + 1) as 2 | 4, 'inc'), decEvent: TUNE_EVENTS.xpdrDigit((a + 1) as 2 | 4, 'dec'), label: `DIGIT ${a + 1}` },
        }),
        x,
        -0.015,
      );
    digitKnob('b738.aft.xpdr_code_l', 1, -0.033);
    digitKnob('b738.aft.xpdr_code_r', 3, 0.013);
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
        diameter: 0.012,
        labelHeight: 0.0016,
      }),
      0.045,
      0.006,
    );
    p.add(new PushButton(env, { id: 'b738.aft.xpdr_ident', label: 'IDENT', style: 'round', width: 0.008, height: 0.008, mode: 'momentary', var: B738.xpdrIdentBtn, capMaterial: 'plasticBlack' }), -0.01, -0.017);
    p.label('IDENT', -0.01, -0.007, { height: 0.0019 });
    toggle(env, p, { id: 'b738.aft.xpdr_atc', label: 'ATC 1/2', var: B738.xpdrAtc, positions: ['1', '2'], values: [1, 2], initial: 0, orientation: 'horizontal', scale: 0.5, labels: { name: 'XPNDR', positions: true, height: 0.0017 } }, -0.055, 0.012);
    toggle(env, p, { id: 'b738.aft.xpdr_alt_src', label: 'ALT SOURCE', var: B738.xpdrAltSrc, positions: ['1', '2'], values: [1, 2], initial: 0, orientation: 'horizontal', scale: 0.5, labels: { name: 'ALT SOURCE', positions: true, height: 0.0017 } }, -0.055, -0.016);
    toggle(env, p, { id: 'b738.aft.tcas_range', label: 'TCAS ABOVE/NORM/BELOW', var: B738.tcasRange, positions: ['BELOW', 'NORM', 'ABOVE'], values: [-1, 0, 1], initial: 1, scale: 0.5, labels: { name: false, positions: true, height: 0.0016 } }, 0.058, -0.018);
  }
  // ---------------------------------------------------------------- ADF (ADF 1 and ADF 2 on one panel), row 4 centre
  {
    const r = rowC(5);
    const p = mod('adf', 0, r.y, W2, r.h);
    for (const n of [1, 2] as const) {
      const sx = n === 1 ? -1 : 1;
      p.label(`ADF ${n}`, sx * 0.037, 0.029, { height: 0.0024 });
      lcd(p, `b738_adf${n}_lcd`, `elec.adf${n}_powered`, [NAV.adfActive(n), NAV.adfStandby(n)], [{ text: () => vars.get(NAV.adfActive(n), 350).toFixed(1), x: 80 }, { text: () => vars.get(NAV.adfStandby(n), 350).toFixed(1), x: 240 }], sx * 0.037, 0.017, 0.052, 0.013);
      p.add(new PushButton(env, { id: `b738.aft.adf${n}_tfr`, label: `ADF ${n} TFR`, style: 'small', width: 0.008, height: 0.006, mode: 'momentary', var: B738.adfXfer(n), engraved: 'TFR', engravedHeight: 0.0015 }), sx * 0.037, 0.004);
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
          diameter: 0.01,
          labelHeight: 0.0016,
        }),
        sx * 0.019,
        -0.016,
      );
      knob2(p, `b738.aft.adf${n}_freq`, `ADF ${n} FREQUENCY`, 'adf', n, sx * 0.053, -0.014, 0.017);
      toggle(env, p, { id: `b738.aft.adf${n}_tone`, label: `ADF ${n} TONE`, var: B738.adfTone(n), positions: ['OFF', 'TONE'], values: [0, 1], initial: 0, scale: 0.4, labels: { name: false, positions: false, height: 0.0016 } }, sx * 0.006, 0.019);
    }
    p.label('TONE', 0, 0.007, { height: 0.0019 });
  }
  // ---------------------------------------------------------------- HF 1 / 2 (operator option), row 4 sides
  for (const n of [1, 2] as const) {
    const r = rowS(4);
    const p = mod(`hf${n}`, n === 1 ? UL : UR, r.y, W2, r.h);
    if (!HF_FITTED) continue;
    p.label('H\nF', -0.066, 0.0, { height: 0.0026, lineHeight: 1.1 });
    lcd(p, `b738_hf${n}_lcd`, `ac.b738.hf${n}.powered`, [B738.hfFreqKhz(n)], [{ text: () => (vars.get(B738.hfFreqKhz(n), 2000) / 1000).toFixed(3), x: 160, size: 40 }], -0.005, 0.016, 0.045, 0.016, 320);
    p.add(new RotaryKnob(env, { id: `b738.aft.hf${n}_sens`, label: `HF ${n} RF SENS`, cap: 'fluted', diameter: 0.009, outer: { var: B738.hfSens(n), min: 0, max: 1, step: 0.05, initial: 1, angleRange: [-140, 140], label: 'RF SENS', format: (x) => `${Math.round(x * 100)} %` } }), 0.042, 0.019);
    p.label('RF SENS', 0.042, 0.029, { height: 0.0019 });
    // Frequency selectors: left = MHz, right = kHz (2.000 - 29.999 MHz, 1 kHz steps).
    p.add(new RotaryKnob(env, { id: `b738.aft.hf${n}_mhz`, label: `HF ${n} FREQUENCY MHz`, cap: 'fluted', diameter: 0.017, pointer: 'none', outer: { var: B738.hfFreqKhz(n), min: 2000, max: 29999, step: 1000, label: 'MHz', format: (x) => `${(x / 1000).toFixed(3)} MHz` } }), -0.046, -0.012);
    p.add(new RotaryKnob(env, { id: `b738.aft.hf${n}_khz`, label: `HF ${n} FREQUENCY kHz`, cap: 'fluted', diameter: 0.017, pointer: 'none', outer: { var: B738.hfFreqKhz(n), min: 2000, max: 29999, step: 1, accel: { fastStep: 10 }, label: 'kHz', format: (x) => `${(x / 1000).toFixed(3)} MHz` } }), 0.046, -0.012);
    p.add(
      new SelectorKnob(env, {
        id: `b738.aft.hf${n}_mode`,
        label: `HF ${n} MODE`,
        var: B738.hfMode(n),
        positions: [
          { value: 0, label: 'OFF' },
          { value: 1, label: 'USB' },
          { value: 2, label: 'AM' },
        ],
        initial: 1,
        diameter: 0.012,
        labelHeight: 0.0019,
      }),
      0,
      -0.016,
    );
  }
  // ---------------------------------------------------------------- blank modules (row 5)
  mod('blank_l', UL, rowS(5).y, W2, rowS(5).h);
  mod('blank_r', UR, rowS(5).y, W2, rowS(5).h);
  mod('blank_c', 0, rowC(6).y, W2, rowC(6).h);
  // ---------------------------------------------------------------- pedestal FLOOD / PANEL dimmers (aft left)
  {
    const r = rowS(6);
    const p = mod('lights', UL, r.y, W2, r.h);
    for (const [id, name, v, x] of [
      ['ped_flood', 'FLOOD', B738.pedestalFlood, -0.035],
      ['ped_panel', 'PANEL', B738.pedestalPanelLt, 0.035],
    ] as const) {
      dimmer(env, p, `b738.aft.${id}`, name === 'FLOOD' ? 'PEDESTAL FLOOD' : 'PEDESTAL PANEL LIGHTS', v, x, -0.006, undefined, 0.02);
      p.label(name, x, 0.019, { height: TH });
      p.label('BRIGHT', x, 0.0125, { height: 0.0019 });
      p.label('OFF', x - 0.016, -0.019, { height: 0.0019 });
    }
  }
  // ---------------------------------------------------------------- trim panel (aft centre): rudder trim indicator, AILERON, RUDDER knob
  {
    const r = rowC(7);
    const p = mod('trim', 0, r.y, W2, r.h);
    if (!c.headless) {
      // Linear 15-0-15 rudder trim scale across the top of the module (FCOM 9.10; NG pedestal photographs).
      const rt = new RudderTrimIndicator(vars, 'b738_rud_trim_ind');
      p.display(rt, 0, 0.032, 0.1, 0.022, { bezel: { border: 0.003, depth: 0.003 } });
      c.onDispose(() => rt.dispose());
    }
    p.label('AILERON', -0.045, 0.012, { height: 0.0022 });
    for (const n of [1, 2] as const)
      toggle(env, p, { id: `b738.aft.ail_trim${n}`, label: `AILERON TRIM switch ${n}`, var: B738.ailTrim(n), positions: ['L WING DN', '0', 'R WING DN'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, orientation: 'horizontal', scale: 0.6, labels: { name: false, positions: false, height: 0.0016 } }, -0.045, n === 1 ? 0.0 : -0.03);
    p.label('LEFT\nWING\nDOWN', -0.064, -0.015, { height: 0.0016, lineHeight: 1.1 });
    p.label('RIGHT\nWING\nDOWN', -0.026, -0.015, { height: 0.0016, lineHeight: 1.1 });
    // Rudder trim knob (spring-loaded to neutral).
    p.add(
      new RotaryKnob(env, {
        id: 'b738.aft.rud_trim',
        label: 'RUDDER TRIM',
        cap: 'pointer',
        diameter: 0.034,
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
      0.028,
      -0.018,
    );
    p.label('NOSE\nLEFT', 0.004, 0.006, { height: 0.0017, lineHeight: 1.1 });
    p.label('NOSE\nRIGHT', 0.053, 0.006, { height: 0.0017, lineHeight: 1.1 });
  }
  // ---------------------------------------------------------------- STAB TRIM override and CAB DOOR (aft right)
  {
    const r = rowS(6);
    const p = mod('door', UR, r.y, W2, r.h);
    p.label('STAB TRIM', -0.04, 0.02, { height: TH });
    p.add(
      new GuardedSwitch(env, {
        id: 'b738.aft.stab_trim_ovrd',
        label: 'STAB TRIM OVERRIDE',
        var: B738.stabTrimOvrd,
        positions: ['NORMAL', 'OVERRIDE'],
        values: [0, 1],
        initial: 0,
        scale: 0.8,
        labels: { name: false, positions: true, height: 0.0019 },
        guard: { color: 'red', guardedPosition: 0 },
      }),
      -0.045,
      -0.006,
    );
    p.line(0.012, 0.026, 0.012, -0.026);
    p.label('CAB DOOR', 0.042, 0.02, { height: TH });
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
        diameter: 0.011,
        labelHeight: 0.0017,
      }),
      0.03,
      -0.01,
    );
    annunciator(env, p, 'b738.aft.lock_fail', 'LOCK FAIL', [seg.on(['LOCK', 'FAIL'], 'amber', B738.lt.lockFail)], 0.058, -0.004, 0.02, 0.011);
    // AUTO UNLK (amber): emergency access code entered, auto unlock pending (FCOM 1.40 flight deck door).
    annunciator(env, p, 'b738.aft.auto_unlk', 'AUTO UNLK', [seg.on(['AUTO', 'UNLK'], 'amber', B738.lt.autoUnlk)], 0.058, -0.018, 0.02, 0.011);
  }
}
