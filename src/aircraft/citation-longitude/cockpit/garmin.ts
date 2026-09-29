/**
 * Garmin G5000 hardware on the Longitude panels: GDU 1400W bezels with the
 * 12 softkeys, GTC 570 units with their three knobs (map knob / joystick,
 * centre knob, dual concentric knob), the GMC 710 AFCS controller and the
 * two GDU (display) controllers. Every control is bound to the events /
 * vars the suite publishes through `g3000Controls(cfg)`
 * (src/avionics/garmin-g3000/controls.ts), so nothing is hard-coded twice.
 *
 * Unit sizes: UNIT_SIZE_MM (EST, Garmin PG figures). GMC 710 and display
 * controller layouts: measured from the AOPA 2021 Longitude photographs
 * (c_gs21, c_top21); the Longitude has no YD key (OG 4-7: "there is no YD
 * button on the AFCS control panel").
 */
import type { CockpitDisplay } from '../../../cockpit/types';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { AnnunciatorLight, PushButton, RotaryKnob, Thumbwheel } from '../../../cockpit/controls';
import { g3000Controls, resolveConfig, G5000_LONGITUDE_LAYOUT, type G3kControl, type G3000Resolved } from '../../../avionics/garmin-g3000';
import { G3K, G3K_EVENTS, type GcuKeyName } from '../../../avionics/garmin-g3000/vars';
import { LON_GMC_EVENTS } from '../systems/crewControls';
import { lonMaterials, type LonCockpitContext } from './context';
import { GDU, GTC } from './layout';
import { GtcMapKnob, SpdModeRing } from './controls';

export function g5kConfig(c: LonCockpitContext): G3000Resolved {
  return c.suite?.cfg ?? resolveConfig({ ...G5000_LONGITUDE_LAYOUT, aircraftId: 'citation-longitude' });
}

/** Hardware table by id ('gmc.key.ap', 'pfd1.sk3', 'gtc2.upper', 'baro1', 'rev.pfd1', ...). */
export function hardware(c: LonCockpitContext): Map<string, G3kControl> {
  const m = new Map<string, G3kControl>();
  for (const x of g3000Controls(g5kConfig(c))) m.set(x.id, x);
  return m;
}

function need(hw: Map<string, G3kControl>, id: string): G3kControl {
  const x = hw.get(id);
  if (!x) throw new Error(`Longitude cockpit: G5000 control '${id}' not published by the suite`);
  return x;
}

/** A glass screen (display mesh) or, headless, just the dark screen plate and bezel. */
function screen(c: LonCockpitContext, panel: Panel, display: CockpitDisplay | null | undefined, x: number, y: number, w: number, h: number, border: [number, number, number, number]): void {
  if (display) {
    panel.display(display, x, y, w, h, { bezel: { border, depth: 0.01 } });
    return;
  }
  // Headless / unpowered placeholder with the same bezel (no canvas available).
  const placeholder: CockpitDisplay = { id: `placeholder.${panel.name}.${x.toFixed(3)}`, canvas: null as never, width: 1, height: 1, refreshHz: 1, render: () => false };
  panel.display(placeholder, x, y, w, h, { bezel: { border, depth: 0.01 } });
  c.b.displays.pop(); // not a real display
}

/**
 * GDU 1400W at (x, y) = bezel centre on `panel`: 302 x 189 mm screen offset up in a 354 x 237 mm bezel with
 * the 12 softkeys along the lower edge (PG Figure 1-2).
 */
export function addGdu(c: LonCockpitContext, panel: Panel, gdu: 'pfd1' | 'mfd' | 'pfd2', display: CockpitDisplay | null | undefined, x: number, y: number): void {
  const hw = hardware(c);
  const top = 0.012;
  const bottom = GDU.bezelH - GDU.screenH - top;
  const side = (GDU.bezelW - GDU.screenW) / 2;
  const sy = y + GDU.bezelH / 2 - top - GDU.screenH / 2;
  screen(c, panel, display, x, sy, GDU.screenW, GDU.screenH, [side, side, top, bottom]);
  const keyY = y - GDU.bezelH / 2 + bottom / 2;
  for (let i = 1; i <= 12; i++) {
    const k = need(hw, `${gdu}.sk${i}`);
    const kx = x - GDU.bezelW / 2 + k.pos[0] / 1000;
    panel.add(new PushButton(c.env, { id: `lon.g5k.${gdu}.sk${i}`, label: `${gdu.toUpperCase()} SOFTKEY ${i}`, style: 'softkey', event: k.press, width: 0.019, height: 0.009, capMaterial: 'plasticBlack' }), kx, keyY);
  }
}

/**
 * GTC 570 (portrait) at (x, y) = face centre: 7 in screen at the top, three knobs below it (left: map knob with
 * joystick, centre: centre knob, right: dual concentric knob), G5000 CRG "GTC 570 controls".
 */
export function addGtc(c: LonCockpitContext, panel: Panel, gtc: 'gtc1' | 'gtc2' | 'gtc3' | 'gtc4', display: CockpitDisplay | null | undefined, x: number, y: number): void {
  const hw = hardware(c);
  const side = (GTC.faceW - GTC.screenW) / 2;
  const top = GTC.screenTopMm / 1000;
  const bottom = GTC.faceH - GTC.screenH - top;
  const sy = y + GTC.faceH / 2 - top - GTC.screenH / 2;
  screen(c, panel, display, x, sy, GTC.screenW, GTC.screenH, [side, side, top, bottom]);
  const name = gtc.toUpperCase();
  const upper = need(hw, `${gtc}.upper`);
  const lower = need(hw, `${gtc}.lower`);
  const center = need(hw, `${gtc}.center`);
  const px = (mm: number) => x - GTC.faceW / 2 + mm / 1000;
  const py = (mm: number) => y + GTC.faceH / 2 - mm / 1000;
  panel.add(
    new GtcMapKnob(c.env, { id: `lon.g5k.${gtc}.map`, label: `${name} MAP KNOB`, incEvent: lower.incEvent!, decEvent: lower.decEvent!, pushEvent: lower.press, joystickEvent: lower.joystick }),
    px(lower.pos[0]),
    py(lower.pos[1]),
  );
  panel.add(
    new RotaryKnob(c.env, {
      id: `lon.g5k.${gtc}.center`,
      label: `${name} CENTER KNOB`,
      cap: 'knurled',
      diameter: 0.016,
      outer: { incEvent: center.incEvent, decEvent: center.decEvent, label: 'VOL' },
      push: { event: center.press, label: 'PUSH' },
    }),
    px(center.pos[0]),
    py(center.pos[1]),
  );
  // SCOPE: the dual knob's push-and-hold (COM swap, `upper.hold`) needs a long press the knob control does not
  // model; the swap is available on the GTC screen (touch the active COM).
  panel.add(
    new RotaryKnob(c.env, {
      id: `lon.g5k.${gtc}.upper`,
      label: `${name} DUAL KNOB`,
      outer: { incEvent: upper.incEvent, decEvent: upper.decEvent, label: 'OUTER' },
      inner: { incEvent: upper.innerIncEvent, decEvent: upper.innerDecEvent, label: 'INNER' },
      push: { event: upper.press, label: 'PUSH' },
      diameter: 0.021,
    }),
    px(upper.pos[0]),
    py(upper.pos[1]),
  );
}

/**
 * GMC 710 of the Longitude (AOPA 2021 glareshield photograph c_gs21, measured at 0.385 mm/px on a 425 x 75 mm face;
 * x from the left edge, y down from the top). Left to right: FD / L CRS knob (PUSH DIR) | VS key over the NOSE wheel
 * (DN at the top, UP at the bottom) | VNAV, FLC keys over the SPD knob (green SPD light, FMS / MAN ring, PUSH IAS
 * MACH) | AP key over CPL (green arrows either side) | NAV, HDG, APPR over BANK, HDG knob (PUSH SYNC), B/C | ALT key
 * over the ALT knob (PUSH FINE) | FD / R CRS knob (PUSH DIR). No A/T key (A/T arms from the thrust-lever AT paddles)
 * and no SPD key (IAS / MACH is the SPD knob push); no YD key (OG 4-7).
 */
const GMC_W = 0.425;
const GMC_H = 0.075;
const GMC_KEYS_POS: [string, number, number, string?][] = [
  ['fd1', 0.029, 0.012, 'FD'],
  ['vs', 0.081, 0.012, 'VS'],
  ['vnav', 0.118, 0.012, 'VNAV'],
  ['flc', 0.156, 0.012, 'FLC'],
  ['ap', 0.193, 0.012, 'AP'],
  ['xfr', 0.194, 0.035, 'CPL'],
  ['nav', 0.231, 0.012, 'NAV'],
  ['hdg', 0.268, 0.012, 'HDG'],
  ['apr', 0.306, 0.012, 'APPR'],
  ['bank', 0.231, 0.06, 'BANK'],
  ['bc', 0.305, 0.06, 'B/C'],
  ['alt', 0.344, 0.012, 'ALT'],
  ['fd2', 0.397, 0.012, 'FD'],
];
/** Section dividers (engraved lines) of the GMC face, x mm from the left edge (c_gs21). */
const GMC_DIVIDERS = [0.063, 0.1, 0.175, 0.212, 0.325, 0.363];

export function addGmc710(c: LonCockpitContext, panel: Panel, cx: number, cy: number): void {
  const hw = hardware(c);
  const env = c.env;
  const M = lonMaterials(env);
  // Face plate (top-left coordinates, metres), Garmin black.
  const g = panel.subPanel({ name: 'gmc710', x: cx, y: cy, width: GMC_W, height: GMC_H, material: M.unit, screws: false, origin: 'top-left', radius: 0.004 });
  for (const x of GMC_DIVIDERS) g.line(x, 0.004, x, GMC_H - 0.004, 0.0006);
  for (const [key, x, y, text] of GMC_KEYS_POS) {
    const k = need(hw, `gmc.key.${key}`);
    const xfr = key === 'xfr';
    g.add(
      new PushButton(env, {
        id: `lon.g5k.gmc.${key}`,
        label: `GMC ${xfr ? 'CPL' : k.label}${key === 'fd1' ? ' (L)' : key === 'fd2' ? ' (R)' : ''}`,
        style: 'mcp',
        width: 0.017,
        height: 0.0115,
        event: k.press,
        engraved: text ?? k.label,
        engravedHeight: 0.0027,
        capMaterial: 'plasticBlack',
        // Active modes: the key's green bar lights; unlit bars are near black (c_gs21, cold & dark shows no green).
        lightBar: !xfr && k.lightVar ? { var: k.lightVar, color: 'green', unlitTint: 0.03 } : undefined,
      }),
      x,
      y,
    );
    if (xfr) {
      // CPL arrows: green triangle toward the coupled side (c_gs21: lit arrow left of CPL).
      for (const [lv, dx, t] of [
        [k.lightVar, -0.0135, '◄'],
        [k.lightVar2, 0.0135, '►'],
      ] as [string | undefined, number, string][]) {
        if (!lv) continue;
        g.add(new AnnunciatorLight(env, { id: `lon.g5k.gmc.cpl_${dx < 0 ? 'l' : 'r'}`, label: `CPL ARROW ${dx < 0 ? 'L' : 'R'}`, width: 0.006, height: 0.006, unlitTint: 0.03, segments: [{ text: t, color: 'green', var: lv }] }), x + dx, y);
      }
    }
  }
  const knob = (id: string, name: string, x: number, pushText: string, dia = 0.019, cap: 'knurled' | 'fluted' = 'knurled', events?: { inc: string; dec: string; push?: string }) => {
    const k = need(hw, id);
    g.add(
      new RotaryKnob(env, {
        id: `lon.g5k.${id}_knob`,
        label: `${name} KNOB`,
        cap,
        diameter: dia,
        outer: { incEvent: events?.inc ?? k.incEvent, decEvent: events?.dec ?? k.decEvent, label: name },
        push: { event: events?.push ?? k.press, label: pushText },
      }),
      x,
      0.05,
    );
    g.label(name, x, 0.034, { height: 0.0028 });
    g.label(`PUSH ${pushText}`, x, 0.068, { height: 0.0019, weight: 600 });
  };
  knob('gmc.crs1', 'L CRS', 0.031, 'DIR');
  knob('gmc.hdg', 'HDG', 0.268, 'SYNC', 0.02);
  // ALT: single knob, PUSH FINE (systems/crewControls.ts LongitudeGmcAltKnob routes the turns to 1,000 / 100 ft).
  knob('gmc.alt', 'ALT', 0.344, 'FINE', 0.02, 'knurled', { inc: `${LON_GMC_EVENTS.altTurn}_inc`, dec: `${LON_GMC_EVENTS.altTurn}_dec`, push: LON_GMC_EVENTS.altPush });
  knob('gmc.crs2', 'R CRS', 0.396, 'DIR');
  // SPD: knob turns the speed, push toggles IAS / MACH (the suite's SPD key function); FMS / MAN ring around it.
  const spdKey = need(hw, 'gmc.key.spd');
  const spd = need(hw, 'gmc.spd');
  g.add(
    new RotaryKnob(env, {
      id: 'lon.g5k.gmc.spd_knob',
      label: 'SPD KNOB',
      cap: 'knurled',
      diameter: 0.016,
      outer: { incEvent: spd.incEvent, decEvent: spd.decEvent, label: 'SPD' },
      push: { event: spdKey.press, label: 'IAS MACH' },
    }),
    0.138,
    0.052,
  );
  g.add(new SpdModeRing(env, { id: 'lon.g5k.gmc.spd_ring', label: 'SPD FMS / MAN', event: spd.press!, stateVar: G3K.speedFms, diameter: 0.026 }), 0.138, 0.052);
  g.label('SPD', 0.142, 0.03, { height: 0.0028 });
  g.label('FMS', 0.124, 0.038, { height: 0.0021 });
  g.label('MAN', 0.153, 0.038, { height: 0.0021 });
  g.label('PUSH IAS MACH', 0.138, 0.068, { height: 0.0019, weight: 600 });
  // Green SPD light: autothrottle engaged (EST reading of the lit dot in c_gs21).
  g.add(new AnnunciatorLight(env, { id: 'lon.g5k.gmc.spd_lt', label: 'SPD LIGHT (A/T)', width: 0.0045, height: 0.0045, unlitTint: 0.03, segments: [{ text: '', color: 'green', var: G3K.gmcLight('AT') }] }), 0.13, 0.03);
  // NOSE wheel: engraved DN at the top and UP at the bottom with a double arrow (c_gs21); rolling the wheel's top
  // upward (toward DN) commands nose down.
  const nose = need(hw, 'gmc.nose');
  g.add(new Thumbwheel(env, { id: 'lon.g5k.gmc.nose', label: 'NOSE DN / UP WHEEL', orientation: 'vertical', diameter: 0.032, width: 0.011, channel: { incEvent: nose.decEvent, decEvent: nose.incEvent, label: 'NOSE' } }), 0.083, 0.048);
  g.label('DN', 0.096, 0.03, { height: 0.0026 });
  g.label('UP', 0.096, 0.067, { height: 0.0026 });
  g.line(0.096, 0.034, 0.096, 0.063, 0.0005);
}

/**
 * Display controller above each PFD (AOPA 2021 photograph c_top21, 140 x 50 mm black face, GCU 275 layout): RANGE
 * knob (PUSH PAN) | CLR over ENT | PFD knob (PUSH ENT) | -D-> over FPL | COM/NAV over PROC | BARO knob (PUSH STD).
 * Keys and knobs drive the GCU logic (avionics/garmin-g3000/state/Gcu.ts, created in createSystems.ts): PFD inset
 * flight plan / Direct-To / procedures windows, COM standby tuning, inset map range and pan, baro.
 * SCOPE: the minimums (MINS) are set on the GTC PFD page (no MINS knob on the Longitude controller); display
 * reversion is in the GTC / automatic (no reversion switch is visible on the controller; EST).
 */
export function addDisplayController(c: LonCockpitContext, panel: Panel, side: 1 | 2, cx: number, cy: number): void {
  const hw = hardware(c);
  const env = c.env;
  const M = lonMaterials(env);
  const W = 0.14;
  const H = 0.05;
  const g = panel.subPanel({ name: `gdu_ctl${side}`, x: cx, y: cy, width: W, height: H, material: M.unit, screws: { kind: 'hex', diameter: 0.003, inset: 0.004 }, origin: 'top-left', radius: 0.003 });
  const range = need(hw, `range${side}`);
  g.add(
    new GtcMapKnob(env, {
      id: `lon.g5k.dc${side}.range`,
      label: `DISPLAY CONTROLLER ${side} RANGE / PAN`,
      incEvent: range.incEvent!,
      decEvent: range.decEvent!,
      pushEvent: G3K_EVENTS.rangePush(side),
      joystickEvent: G3K_EVENTS.gcuJoystick(side),
      diameter: 0.016,
    }),
    0.021,
    0.028,
  );
  g.label('RANGE', 0.017, 0.012, { height: 0.0022 });
  g.label('PUSH PAN', 0.021, 0.045, { height: 0.0016, weight: 600 });
  const key = (k: GcuKeyName, text: string, x: number, y: number) =>
    g.add(
      new PushButton(env, {
        id: `lon.g5k.dc${side}.${k.toLowerCase()}`,
        label: `DISPLAY CONTROLLER ${side} ${text.replace('\n', ' ')}`,
        style: 'key',
        width: 0.012,
        height: 0.0085,
        event: G3K_EVENTS.gcuKey(side, k),
        engraved: text,
        engravedHeight: 0.0021,
        capMaterial: 'plasticBlack',
      }),
      x,
      y,
    );
  key('CLR', 'CLR', 0.041, 0.011);
  key('ENT', 'ENT', 0.042, 0.039);
  key('DTO', '-D→', 0.08, 0.012);
  key('FPL', 'FPL', 0.08, 0.04);
  key('COMNAV', 'COM NAV', 0.101, 0.013);
  key('PROC', 'PROC', 0.101, 0.04);
  // PFD knob: dual concentric (FMS outer / inner, cursor), push ENT (c_top21 "PFD" / "PUSH ENT").
  g.add(
    new RotaryKnob(env, {
      id: `lon.g5k.dc${side}.pfd`,
      label: `DISPLAY CONTROLLER ${side} PFD KNOB`,
      cap: 'ring',
      innerCap: 'fluted',
      diameter: 0.019,
      outer: { incEvent: `${G3K_EVENTS.gcuFmsOuter(side)}_inc`, decEvent: `${G3K_EVENTS.gcuFmsOuter(side)}_dec`, label: 'OUTER' },
      inner: { incEvent: `${G3K_EVENTS.gcuFmsInner(side)}_inc`, decEvent: `${G3K_EVENTS.gcuFmsInner(side)}_dec`, label: 'INNER' },
      push: { event: G3K_EVENTS.gcuKey(side, 'ENT'), label: 'ENT' },
    }),
    0.06,
    0.028,
  );
  g.label('PFD', 0.06, 0.012, { height: 0.0022 });
  g.label('PUSH ENT', 0.062, 0.045, { height: 0.0016, weight: 600 });
  const baro = need(hw, `baro${side}`);
  g.add(
    new RotaryKnob(env, {
      id: `lon.g5k.baro${side}`,
      label: `BARO ${side}`,
      cap: 'knurled',
      diameter: 0.016,
      outer: { incEvent: baro.incEvent, decEvent: baro.decEvent, label: 'BARO' },
      push: { event: baro.press, label: 'STD' },
    }),
    0.12,
    0.026,
  );
  g.label('BARO', 0.12, 0.011, { height: 0.0022 });
  g.label('PUSH STD', 0.121, 0.045, { height: 0.0016, weight: 600 });
}
