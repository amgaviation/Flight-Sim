/**
 * Garmin G5000 hardware on the Longitude panels: GDU 1400W bezels with the
 * 12 softkeys, GTC 570 units with their three knobs (map knob / joystick,
 * centre knob, dual concentric knob), the GMC 710 AFCS controller and the
 * two GDU (display) controllers. Every control is bound to the events /
 * vars the suite publishes through `g3000Controls(cfg)`
 * (src/avionics/garmin-g3000/controls.ts), so nothing is hard-coded twice.
 *
 * Unit sizes: UNIT_SIZE_MM (EST, Garmin PG figures). GMC 710 layout: EST
 * from Longitude / Latitude flight-deck photographs (FD at each end, CRS1 /
 * HDG knobs left, lateral keys, AP / XFR centre, vertical keys, SPD knob,
 * NOSE UP/DN wheel, ALT knob, CRS2); the Longitude has no YD key (OG 4-7:
 * "there is no YD button on the AFCS control panel").
 */
import type { CockpitDisplay } from '../../../cockpit/types';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { PushButton, RotaryKnob, Thumbwheel } from '../../../cockpit/controls';
import { g3000Controls, resolveConfig, G5000_LONGITUDE_LAYOUT, type G3kControl, type G3000Resolved } from '../../../avionics/garmin-g3000';
import type { LonCockpitContext } from './context';
import { GDU, GTC } from './layout';
import { GtcMapKnob } from './controls';

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

/** GMC 710 layout (x from the left edge, y from the top of the 425 x 75 mm face; EST from photographs). */
const GMC_W = 0.425;
const GMC_H = 0.075;
const GMC_KEYS_POS: [string, number, number, string?][] = [
  ['fd1', 0.018, 0.038, 'FD'],
  ['hdg', 0.114, 0.024],
  ['nav', 0.138, 0.024],
  ['apr', 0.162, 0.024],
  ['bc', 0.186, 0.024],
  ['bank', 0.114, 0.054],
  ['xfr', 0.212, 0.024],
  ['ap', 0.212, 0.054],
  ['vs', 0.238, 0.024],
  ['flc', 0.262, 0.024],
  ['alt', 0.286, 0.024],
  ['vnav', 0.31, 0.024],
  ['spd', 0.238, 0.054],
  ['at', 0.262, 0.054, 'A/T'],
  ['fd2', 0.407, 0.038, 'FD'],
];

export function addGmc710(c: LonCockpitContext, panel: Panel, cx: number, cy: number): void {
  const hw = hardware(c);
  // Face plate (top-left coordinates, metres).
  const g = panel.subPanel({ name: 'gmc710', x: cx, y: cy, width: GMC_W, height: GMC_H, material: 'bezel', screws: false, origin: 'top-left' });
  const P = (x: number, y: number): [number, number] => [x, y];
  for (const [key, x, y, text] of GMC_KEYS_POS) {
    const k = need(hw, `gmc.key.${key}`);
    const [px, py] = P(x, y);
    g.add(
      new PushButton(c.env, {
        id: `lon.g5k.gmc.${key}`,
        label: `GMC ${k.label}${key === 'fd1' ? ' (L)' : key === 'fd2' ? ' (R)' : ''}`,
        style: 'mcp',
        width: 0.019,
        height: 0.012,
        event: k.press,
        engraved: text ?? k.label,
        engravedHeight: 0.0026,
        capMaterial: 'plasticBlack',
        // GMC 710: green annunciator bar above the legend (XFR: arrow toward the coupled side, left / right).
        lightBar: k.lightVar ? { var: k.lightVar, color: 'green' } : undefined,
        segments: key === 'xfr' && k.lightVar2 ? [{ text: '◄', color: 'green', var: k.lightVar }, { text: '►', color: 'green', var: k.lightVar2 }] : undefined,
        layout: 'split',
      }),
      px,
      py,
    );
  }
  const knob = (id: string, label: string, x: number, y: number, dia = 0.019, cap: 'knurled' | 'fluted' = 'fluted') => {
    const k = need(hw, id);
    const [px, py] = P(x, y);
    g.add(
      new RotaryKnob(c.env, {
        id: `lon.g5k.${id}_knob`,
        label,
        cap,
        diameter: dia,
        outer: { incEvent: k.incEvent, decEvent: k.decEvent, label },
        inner: k.innerIncEvent ? { incEvent: k.innerIncEvent, decEvent: k.innerDecEvent, label: `${label} 100` } : undefined,
        push: k.press ? { event: k.press, label: id === 'gmc.spd' ? 'FMS/MAN' : id === 'gmc.alt' ? 'SYNC' : 'SYNC' } : undefined,
      }),
      px,
      py,
    );
    g.label(label, px, py - 0.017, { height: 0.0026 });
  };
  knob('gmc.crs1', 'CRS1', 0.047, 0.044);
  knob('gmc.hdg', 'HDG', 0.082, 0.044, 0.021);
  knob('gmc.spd', 'SPD', 0.288, 0.058, 0.016);
  knob('gmc.alt', 'ALT SEL', 0.358, 0.044, 0.023, 'knurled');
  knob('gmc.crs2', 'CRS2', 0.386, 0.044, 0.016);
  const nose = need(hw, 'gmc.nose');
  const [nx, ny] = P(0.33, 0.036);
  g.add(new Thumbwheel(c.env, { id: 'lon.g5k.gmc.nose', label: 'NOSE UP / DN', orientation: 'vertical', diameter: 0.03, width: 0.01, channel: { incEvent: nose.incEvent, decEvent: nose.decEvent, label: 'NOSE' } }), nx, ny);
  g.label('UP', nx, ny - 0.024, { height: 0.0026 });
  g.label('DN', nx, ny + 0.023, { height: 0.0026 }); // kept clear of the glareshield lip (label-occlusion test)
}

/**
 * GDU controller above a PFD (OG 2-2 "Two GDU Controllers"; OG 4-5: "the BARO button on the display controller
 * above the PFD"): BARO knob (push STD), RANGE knob, MINS knob (push: OFF / BARO / RA), DISPLAY BACKUP
 * (reversion) switch for the PFD and, on the left unit, the MFD (PG §1.4).
 */
export function addDisplayController(c: LonCockpitContext, panel: Panel, side: 1 | 2, cx: number, cy: number): void {
  const hw = hardware(c);
  const g = panel.subPanel({ name: `gdu_ctl${side}`, x: cx, y: cy, width: 0.2, height: 0.058, material: 'bezel', screws: false });
  const knob = (id: string, label: string, x: number, pushLabel?: string) => {
    const k = need(hw, id);
    g.add(
      new RotaryKnob(c.env, {
        id: `lon.g5k.${id}`,
        label,
        cap: id.startsWith('baro') ? 'knurled' : 'fluted',
        diameter: 0.017,
        outer: { incEvent: k.incEvent, decEvent: k.decEvent, label },
        push: k.press ? { event: k.press, label: pushLabel } : undefined,
      }),
      x,
      -0.006,
    );
    g.label(label, x, 0.02, { height: 0.0026 });
  };
  knob(`mins${side}`, 'MINS', -0.07, 'MODE');
  knob(`baro${side}`, 'BARO', -0.02, 'STD');
  knob(`range${side}`, 'RANGE', 0.03);
  const rev = need(hw, `rev.pfd${side}`);
  const revBtn = (id: string, v: string, label: string, x: number) =>
    g.add(
      new PushButton(c.env, {
        id,
        var: v,
        mode: 'toggle',
        label,
        style: 'small',
        width: 0.011,
        capMaterial: 'plasticBlack',
        segments: [{ text: '', color: 'amber', whenOn: true }],
      }),
      x,
      -0.006,
    );
  revBtn(`lon.g5k.rev.pfd${side}`, rev.var!, `DISPLAY BACKUP PFD ${side}`, 0.07);
  g.label('DSPL', 0.07, 0.02, { height: 0.0026 });
  g.label('BKUP', 0.07, -0.022, { height: 0.0023 });
  if (side === 1) {
    const mrev = need(hw, 'rev.mfd');
    revBtn('lon.g5k.rev.mfd', mrev.var!, 'DISPLAY BACKUP MFD', 0.088);
    g.label('MFD', 0.088, -0.022, { height: 0.0023 });
  }
}
