/**
 * Bendix/King NAV II radio stack (POH Fig 7-2 items 16-21 plus the KAP 140), each unit a 6.25 in
 * wide bezel in the rack (stack X 0.26..6.62 in, layout.ts POS.stack). Order top to bottom as in
 * the straight-on photograph of VH-SPQ (172S NAV II, Wikimedia Commons) and N146TC: KMA 28,
 * KLN 94, KX 155A #1, KX 155A #2, KT 76C, KAP 140, KR 87. Face arrangements from the unit
 * figures, checked against the VH-SPQ close-up (~71 px/in):
 *
 *   KMA 28 (1.3 in)   Supplement 20 Fig 1 sheet 1 (item positions scaled from the drawing)
 *   KLN 94 (2.0 in)   Pilot's Guide Figure 3-1; VH-SPQ: RNG rocker right of the screen with the
 *                     small MNU button below it, CRSR top right, the concentric knob bottom right
 *   KX 155A #1 / #2   Supplement 1 Fig 1 sheet 1 (2.0 in each); CHAN / MODE small round buttons
 *   KT 76C (1.55 in)  Supplement 2 Fig 1 sheet 1
 *   KAP 140 (1.65 in) Supplement 15 Fig 3 sheet 1; VH-SPQ: UP / DN a framed vertical rocker right
 *                     of the display, ARM / BARO above the altitude select knob
 *   KR 87 (1.3 in)    Supplement 6 Fig 1 sheet 1
 *
 * Every knob and button is bound to the unit logic (avionics/*): encoders emit the EV.* events,
 * buttons write the KX / KMA / KR / KT / KAP / KLN vars or emit the key events. Button legends
 * and knob index marks are lit by the RADIO LT dimmer (POH Sec 7 "Interior lighting"; zone
 * 'radio'); the displays are self-dimming (photocells).
 */
import * as THREE from 'three';
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import type { CockpitDisplay } from '../../../cockpit/types';
import { AnnunciatorLight, PushButton, RotaryKnob, SelectorKnob, ToggleSwitch } from '../../../cockpit/controls';
import { cylinderZ, roundedBox } from '../../../cockpit/geometry/primitives';
import { EV, KAP, KLN, KMA, KMA_MIC, KR, KT, KX, type KlnKey, type KmaButton } from '../vars';
import { KT_MODE } from '../avionics/kt76c';
import { IN, POS, px, py } from './layout';

const STACK_X = (POS.stack.X0 + POS.stack.X1) / 2;
const UNIT_W = 6.25;
const ZONE = 'radio';

/** Unit bezel tops (Z in) and heights (in), see header. */
export const UNITS = {
  kma28: { z: 0.55, h: 1.3 },
  kln94: { z: 1.95, h: 2.0 },
  kx1: { z: 4.05, h: 2.0 },
  kx2: { z: 6.15, h: 2.0 },
  kt76c: { z: 8.25, h: 1.55 },
  kap140: { z: 9.85, h: 1.65 },
  kr87: { z: 11.55, h: 1.3 },
} as const;

interface Unit {
  p: Panel;
  /** Unit-local metres from inches. */
  x: (xIn: number) => number;
  y: (yIn: number) => number;
}

function unit(b: CockpitBuilder, panel: Panel, name: string, u: { z: number; h: number }): Unit {
  const env = b.env;
  const p = panel.subPanel({
    name: `c172s.${name}`,
    x: px(STACK_X),
    y: py(u.z + u.h / 2),
    z: 0.012,
    width: UNIT_W * IN,
    height: u.h * IN,
    origin: 'top-left',
    material: env.materials.custom('plastic', '#18181a', 0.55),
    thickness: 0.004,
    radius: 0.0015,
    screws: false,
  });
  // Unit case behind the bezel (depth into the rack).
  const box = new THREE.Mesh(env.geometry.get(`c172s.unitcase.${u.h}`, () => roundedBox(6.2 * IN, (u.h - 0.05) * IN, 0.05, 0.002)), env.materials.get('panelDark'));
  box.userData.cockpitStatic = true;
  p.addObject(box, (UNIT_W / 2) * IN, (u.h / 2) * IN, { z: -0.029 });
  return { p, x: (v) => v * IN, y: (v) => v * IN };
}

/** Engraved (radio-lit) white legend on a unit face. */
function legend(u: Unit, text: string, xIn: number, yIn: number, h = 0.0016): void {
  u.p.label(text, u.x(xIn), u.y(yIn), { height: h, zone: ZONE, color: '#e8e8e4' });
}

/** Bendix/King rectangular push button with an engraved legend. */
function bkButton(
  b: CockpitBuilder,
  u: Unit,
  o: { id: string; label: string; text: string; x: number; y: number; w?: number; h?: number; var?: string; mode?: 'momentary' | 'toggle'; event?: string },
): PushButton {
  return u.p.add(
    new PushButton(b.env, {
      id: o.id,
      label: o.label,
      var: o.var,
      mode: o.mode ?? 'momentary',
      event: o.event,
      style: 'key',
      width: (o.w ?? 0.42) * IN,
      height: (o.h ?? 0.22) * IN,
      capMaterial: 'plasticBlack',
      engraved: o.text,
      engravedHeight: 0.0017,
      zone: ZONE,
    }),
    u.x(o.x),
    u.y(o.y),
  );
}

/** Small round Bendix/King push button (KX 155A CHAN / MODE) with its legend beside it. */
function roundKey(b: CockpitBuilder, u: Unit, o: { id: string; label: string; text: string; x: number; y: number; var?: string; event?: string; legendDx?: number }): PushButton {
  const k = u.p.add(
    new PushButton(b.env, { id: o.id, label: o.label, var: o.var, event: o.event, mode: 'momentary', style: 'round', width: 0.17 * IN, capMaterial: 'plasticGrey', engraved: '', zone: ZONE }),
    u.x(o.x),
    u.y(o.y),
  );
  legend(u, o.text, o.x + (o.legendDx ?? 0.33), o.y, 0.0012);
  return k;
}

/** Raised frame around a vertical rocker pair (KLN 94 RNG, KAP 140 UP / DN). */
function rockerFrame(u: Unit, x: number, y: number, w: number, h: number): void {
  const e = env();
  const f = new THREE.Mesh(e.geometry.get(`c172s.rocker_frame.${w}.${h}`, () => roundedBox(w * IN, h * IN, 0.0025, 0.0012, 2)), e.materials.custom('plastic', '#3a3b3e', 0.5));
  f.userData.cockpitStatic = true;
  u.p.addObject(f, u.x(x), u.y(y), { z: 0.0002 });
}

/** Frequency / encoder knob pair (outer + inner) with an optional pull function on the inner knob. */
function dualKnob(
  b: CockpitBuilder,
  u: Unit,
  o: { id: string; label: string; x: number; y: number; outer: [string, string]; inner: [string, string]; pull?: { var: string; label: string }; d?: number },
): RotaryKnob {
  return u.p.add(
    new RotaryKnob(b.env, {
      id: o.id,
      label: o.label,
      outer: { label: o.outer[1], incEvent: `${o.outer[0]}.inc`, decEvent: `${o.outer[0]}.dec` },
      inner: { label: o.inner[1], incEvent: `${o.inner[0]}.inc`, decEvent: `${o.inner[0]}.dec` },
      push: o.pull ? { var: o.pull.var, mode: 'toggle', label: o.pull.label } : undefined,
      cap: 'ring',
      innerCap: 'knurled',
      diameter: (o.d ?? 0.62) * IN,
      material: 'knob',
      zone: ZONE,
    }),
    u.x(o.x),
    u.y(o.y),
  );
}

/** Small volume knob: continuous 0..1 with OFF at the counter-clockwise stop; push/pull function. */
function volKnob(b: CockpitBuilder, u: Unit, o: { id: string; label: string; x: number; y: number; var: string; pull?: { var: string; label: string }; d?: number }): RotaryKnob {
  return u.p.add(
    new RotaryKnob(b.env, {
      id: o.id,
      label: o.label,
      outer: { var: o.var, min: 0, max: 1, step: 0.05, initial: 0.5, angleRange: [-140, 140], format: (v) => (v < 0.02 ? 'OFF' : `${Math.round(v * 100)}%`) },
      push: o.pull ? { var: o.pull.var, mode: 'toggle', label: o.pull.label } : undefined,
      cap: 'knurled',
      diameter: (o.d ?? 0.32) * IN,
      material: 'knob',
      pointer: 'line',
      zone: ZONE,
    }),
    u.x(o.x),
    u.y(o.y),
  );
}

let envRef: CockpitBuilder['env'] | null = null;
const env = (): CockpitBuilder['env'] => envRef!;

function screen(u: Unit, d: CockpitDisplay | undefined, xIn: number, yIn: number, wIn: number, hIn: number): void {
  if (!d) {
    // Headless build: a dark window where the display would be.
    return;
  }
  // No library bezel: the display window is flush in the unit face (a thin dark surround is part of the face plate).
  const surround = new THREE.Mesh(env().geometry.get(`c172s.window.${wIn}.${hIn}`, () => roundedBox((wIn + 0.08) * IN, (hIn + 0.08) * IN, 0.0015, 0.001)), env().materials.custom('gloss', '#050505', 0.25));
  surround.userData.cockpitStatic = true;
  u.p.addObject(surround, u.x(xIn), u.y(yIn), { z: 0.0002 });
  u.p.display(d, u.x(xIn), u.y(yIn), wIn * IN, hIn * IN, { bezel: false, z: 0.0012 });
}

export function buildStack(b: CockpitBuilder, panel: Panel, displays: Map<string, CockpitDisplay>): void {
  envRef = b.env;
  const env = b.env;

  // ---------------------------------------------------------------- KMA 28 audio selector panel
  {
    const u = unit(b, panel, 'kma28', UNITS.kma28);
    // Marker beacon lamps O (blue) / M (amber) / I (white) (item 1).
    const lamps: [string, 'blue' | 'amber' | 'white', string][] = [
      ['O', 'blue', KMA.lampOuter],
      ['M', 'amber', KMA.lampMiddle],
      ['I', 'white', KMA.lampInner],
    ];
    lamps.forEach(([t, c, v], i) =>
      u.p.add(
        new AnnunciatorLight(env, { id: `c172s.kma28.lamp_${t.toLowerCase()}`, label: `Marker ${t === 'O' ? 'OUTER' : t === 'M' ? 'MIDDLE' : 'INNER'} lamp`, segments: [{ text: t, color: c, var: v, test: (x) => x > 0.05 }], width: 0.25 * IN, height: 0.24 * IN }),
        u.x(0.2 + i * 0.3),
        u.y(0.42),
      ),
    );
    // Marker sensitivity HI / LO and T/M (momentary test / mute) (item 2).
    u.p.add(
      new ToggleSwitch(env, { id: 'c172s.kma28.mkr_sens', label: 'MARKER sensitivity HI / LO, T/M (test / mute)', var: KMA.mkrSens, positions: ['T/M', 'LO', 'HI'], values: [-1, 0, 1], initial: 2, springs: { 0: 1 }, scale: 0.45, labels: { positions: false } }),
      u.x(1.17),
      u.y(0.44),
    );
    legend(u, 'HI\nLO\nT/M', 1.42, 0.44, 0.0011);
    // Power / pilot ICS volume knob, PUSH OFF/EMG (item 11); intercom mode ISO / ALL / CREW (item 10).
    u.p.add(
      new RotaryKnob(env, {
        id: 'c172s.kma28.vol',
        label: 'KMA 28 pilot ICS volume / PUSH OFF-EMG',
        outer: { var: KMA.icsVol, min: 0, max: 1, step: 0.05, initial: 0.5, angleRange: [-140, 140], format: (v) => `${Math.round(v * 100)}%` },
        push: { var: KMA.power, mode: 'toggle', label: 'PUSH OFF/EMG' },
        cap: 'knurled',
        diameter: 0.34 * IN,
        material: 'knob',
        pointer: 'line',
        zone: ZONE,
      }),
      u.x(0.42),
      u.y(1.0),
    );
    legend(u, 'PUSH\nOFF/EMG', 0.82, 1.14, 0.0010);
    u.p.add(
      new ToggleSwitch(env, { id: 'c172s.kma28.ics_mode', label: 'Intercom mode ISO / ALL / CREW', var: KMA.icsMode, positions: ['CREW', 'ALL', 'ISO'], values: [-1, 0, 1], initial: 1, scale: 0.45, labels: { positions: false } }),
      u.x(1.17),
      u.y(0.98),
    );
    legend(u, 'ISO\nALL\nCREW', 1.44, 0.98, 0.0011);
    // Receiver audio select buttons with their green annunciators (items 3, 7, 8).
    const rows: [KmaButton, string][][] = [
      [
        ['com1', 'COM 1'],
        ['nav1', 'NAV 1'],
        ['mkr', 'MKR'],
        ['adf', 'ADF'],
        ['dme', 'DME'],
      ],
      [
        ['com2', 'COM 2'],
        ['nav2', 'NAV 2'],
        ['ics', 'ICS'],
        ['aux', 'AUX'],
        ['spr', 'SPR'],
      ],
    ];
    const cols = [1.74, 2.36, 3.3, 3.92, 4.51];
    rows.forEach((row, r) =>
      row.forEach(([id, text], c) => {
        const x = cols[c];
        const y = r === 0 ? 0.47 : 0.9;
        bkButton(b, u, { id: `c172s.kma28.${id}`, label: `KMA 28 ${text} audio select`, text, x, y, w: 0.46, h: 0.25, var: KMA.sel(id), mode: 'toggle' });
        u.p.add(
          new AnnunciatorLight(env, { id: `c172s.kma28.led_${id}`, label: `KMA 28 ${text} annunciator`, segments: [{ text: '', color: 'green', var: KMA.led(id), test: (v) => v > 0.05 }], width: 0.06 * IN, height: 0.1 * IN, bezel: false }),
          u.x(x + 0.29),
          u.y(y),
        );
      }),
    );
    // Photocell (item 9, static) and the mic selector (item 4), transmit indicator (item 6) and swap
    // indicator (item 5, "not available on this installation": dark) below the mic selector (VH-SPQ).
    const cell = new THREE.Mesh(env.geometry.get('c172s.photocell', () => cylinderZ(0.0022, 0.002, 0, 0.001, 16)), env.materials.custom('gloss', '#301a10', 0.2));
    cell.userData.cockpitStatic = true;
    u.p.addObject(cell, u.x(2.87), u.y(0.4), { z: 0.0002 });
    u.p.add(
      new SelectorKnob(env, {
        id: 'c172s.kma28.mic',
        label: 'KMA 28 MIC selector',
        var: KMA.mic,
        positions: [
          { value: KMA_MIC.com3, label: 'COM3', angle: -120 },
          { value: KMA_MIC.com2, label: 'COM2', angle: -75 },
          { value: KMA_MIC.com1, label: 'COM1', angle: -30 },
          { value: KMA_MIC.com12, label: 'COM1/2', angle: 30 },
          { value: KMA_MIC.com21, label: 'COM2/1', angle: 75 },
          { value: KMA_MIC.tel, label: 'TEL', angle: 120 },
        ],
        initial: 2,
        diameter: 0.4 * IN,
        labelRadius: 0.36 * IN,
        labelHeight: 0.0011,
        labelZone: ZONE,
      }),
      u.x(5.72),
      u.y(0.6),
    );
    u.p.add(
      new AnnunciatorLight(env, { id: 'c172s.kma28.tx', label: 'KMA 28 transmit indicator', segments: [{ text: '', color: 'green', var: KMA.txLamp, test: (v) => v > 0.5 }], width: 0.1 * IN, height: 0.1 * IN }),
      u.x(5.25),
      u.y(1.08),
    );
    legend(u, 'Transmit', 5.25, 1.2, 0.0009);
    u.p.add(
      new AnnunciatorLight(env, { id: 'c172s.kma28.swap', label: 'KMA 28 swap indicator (swap not available on this installation)', segments: [{ text: '', color: 'green', var: KMA.swapLamp, test: (v) => v > 0.5 }], width: 0.1 * IN, height: 0.1 * IN }),
      u.x(5.85),
      u.y(1.08),
    );
    legend(u, 'Swap', 5.85, 1.2, 0.0009);
    legend(u, 'KMA 28 TSO', 3.3, 1.2, 0.0011);
    legend(u, 'BENDIX/KING', 2.2, 1.2, 0.0011);
  }

  // ---------------------------------------------------------------- KLN 94 GPS
  {
    const u = unit(b, panel, 'kln94', UNITS.kln94);
    screen(u, displays.get('kln94'), 2.65, 0.88, 3.4, 1.5);
    bkButton(b, u, { id: 'c172s.kln94.proc', label: 'KLN 94 PROC', text: 'PROC', x: 0.45, y: 0.3, event: EV.klnKey('proc') });
    // Data card slot (item 16, static).
    const slot = new THREE.Mesh(env.geometry.get('c172s.kln_slot', () => roundedBox(0.06 * IN, 0.8 * IN, 0.002, 0.0003)), env.materials.get('panelDark'));
    slot.userData.cockpitStatic = true;
    u.p.addObject(slot, u.x(0.14), u.y(0.95), { z: 0.0005 });
    u.p.add(
      new RotaryKnob(env, {
        id: 'c172s.kln94.power',
        label: 'KLN 94 On/Off/Brightness (PUSH ON)',
        outer: { var: KLN.brt, min: 0.1, max: 1, step: 0.05, initial: 0.8, angleRange: [-140, 140], format: (v) => `BRT ${Math.round(v * 100)}%` },
        push: { var: KLN.power, mode: 'toggle', label: 'PUSH ON' },
        cap: 'knurled',
        diameter: 0.3 * IN,
        material: 'knob',
        zone: ZONE,
      }),
      u.x(0.45),
      u.y(1.55),
    );
    legend(u, 'PUSH ON\nBRT', 0.45, 1.85, 0.0009);
    const keys: [KlnKey, string][] = [
      ['msg', 'MSG'],
      ['obs', 'OBS'],
      ['alt', 'ALT'],
      ['nrst', 'NRST'],
      ['dto', 'D→'],
      ['clr', 'CLR'],
      ['ent', 'ENT'],
    ];
    keys.forEach(([k, t], i) => bkButton(b, u, { id: `c172s.kln94.${k}`, label: `KLN 94 ${t}`, text: t, x: 1.12 + i * 0.5, y: 1.8, w: 0.4, h: 0.2, event: EV.klnKey(k) }));
    // RNG: a vertical rocker right of the screen (upper half range up, lower half down), the small
    // round MNU button below it; CRSR top right under the unit legend (VH-SPQ photograph).
    rockerFrame(u, 4.62, 0.53, 0.36, 0.62);
    bkButton(b, u, { id: 'c172s.kln94.rng_up', label: 'KLN 94 RNG (up)', text: '▲', x: 4.62, y: 0.38, w: 0.28, h: 0.26, event: EV.klnKey('rng_up') });
    bkButton(b, u, { id: 'c172s.kln94.rng_dn', label: 'KLN 94 RNG (down)', text: '▼', x: 4.62, y: 0.68, w: 0.28, h: 0.26, event: EV.klnKey('rng_dn') });
    legend(u, 'RNG', 4.62, 0.12, 0.0010);
    u.p.add(
      new PushButton(env, { id: 'c172s.kln94.mnu', label: 'KLN 94 MNU', mode: 'momentary', event: EV.klnKey('mnu'), style: 'round', width: 0.2 * IN, capMaterial: 'plasticGrey', engraved: '', zone: ZONE }),
      u.x(4.62),
      u.y(1.02),
    );
    legend(u, 'MNU', 4.62, 1.22, 0.0009);
    bkButton(b, u, { id: 'c172s.kln94.crsr', label: 'KLN 94 CRSR', text: 'CRSR', x: 5.55, y: 0.45, w: 0.44, h: 0.2, event: EV.klnKey('crsr') });
    dualKnob(b, u, { id: 'c172s.kln94.knob', label: 'KLN 94 right knobs (outer: page type / cursor, inner: page / character, PULL SCAN)', x: 5.62, y: 1.4, outer: [EV.klnOuter, 'OUTER'], inner: [EV.klnInner, 'INNER'], pull: { var: KLN.scan, label: 'PULL SCAN' }, d: 0.56 });
    legend(u, 'KLN 94 TSO\nGPS', 5.55, 0.17, 0.0010);
  }

  // ---------------------------------------------------------------- KX 155A #1 / #2
  for (const n of [1, 2] as const) {
    const u = unit(b, panel, `kx155a_${n}`, n === 1 ? UNITS.kx1 : UNITS.kx2);
    const k = KX(n);
    screen(u, displays.get(`kx155a_${n}`), 3.12, 0.47, 6.1, 0.78);
    legend(u, 'COMM', 0.58, 1.06, 0.0017);
    legend(u, 'STBY', 1.77, 1.06, 0.0013);
    legend(u, 'NAV', 3.86, 1.06, 0.0017);
    legend(u, 'STBY', 5.04, 1.06, 0.0013);
    volKnob(b, u, { id: `c172s.kx155a_${n}.com_vol`, label: `NAV/COM ${n} COMM volume (OFF / PULL TEST)`, x: 0.59, y: 1.39, var: k.comVol, pull: { var: k.comPull, label: 'PULL TEST' } });
    legend(u, 'PULL\nTEST', 0.22, 1.39, 0.0009);
    legend(u, 'OFF', 0.59, 1.78, 0.0010);
    bkButton(b, u, { id: `c172s.kx155a_${n}.com_xfr`, label: `NAV/COM ${n} COMM transfer (hold 2 s: active entry)`, text: '⇄', x: 1.4, y: 1.32, w: 0.34, h: 0.2, var: k.comXfr });
    roundKey(b, u, { id: `c172s.kx155a_${n}.chan`, label: `NAV/COM ${n} CHAN (hold 2 s: program)`, text: 'CHAN', x: 1.25, y: 1.74, var: k.chan });
    dualKnob(b, u, { id: `c172s.kx155a_${n}.com_freq`, label: `NAV/COM ${n} COMM frequency (outer MHz, inner kHz, PULL 25K)`, x: 2.47, y: 1.32, outer: [EV.kxComMhz(n), 'MHz'], inner: [EV.kxComKhz(n), 'kHz'], pull: { var: k.comInnerPull, label: 'PULL 25K' } });
    legend(u, 'PULL 25K', 2.47, 1.86, 0.0010);
    volKnob(b, u, { id: `c172s.kx155a_${n}.nav_vol`, label: `NAV/COM ${n} NAV volume (PULL IDENT)`, x: 3.93, y: 1.39, var: k.navVol, pull: { var: k.navIdent, label: 'PULL IDENT' } });
    legend(u, 'PULL\nIDENT', 3.56, 1.39, 0.0009);
    bkButton(b, u, { id: `c172s.kx155a_${n}.nav_xfr`, label: `NAV/COM ${n} NAV transfer / TIMER (hold 2 s: active entry / timer reset)`, text: '⇄', x: 4.64, y: 1.32, w: 0.34, h: 0.2, var: k.navXfr });
    legend(u, 'TIMER', 4.64, 1.5, 0.0009);
    roundKey(b, u, { id: `c172s.kx155a_${n}.nav_mode`, label: `NAV/COM ${n} NAV MODE (ACT/STBY, CDI, BRG, RAD, TIMER)`, text: 'MODE', x: 4.5, y: 1.74, var: k.navMode });
    dualKnob(b, u, { id: `c172s.kx155a_${n}.nav_freq`, label: `NAV/COM ${n} NAV frequency (outer MHz, inner kHz, PULL OBS)`, x: 5.72, y: 1.32, outer: [EV.kxNavMhz(n), 'MHz'], inner: [EV.kxNavKhz(n), 'kHz'], pull: { var: k.navInnerPull, label: 'PULL OBS' } });
    legend(u, 'PULL OBS', 5.72, 1.86, 0.0010);
    legend(u, 'KX 155A TSO', 5.5, 0.03, 0.0010);
  }

  // ---------------------------------------------------------------- KR 87 ADF
  {
    const u = unit(b, panel, 'kr87', UNITS.kr87);
    screen(u, displays.get('kr87'), 2.18, 0.45, 4.1, 0.72);
    bkButton(b, u, { id: 'c172s.kr87.adf', label: 'KR 87 ADF button (in = ADF, out = ANT)', text: 'ADF', x: 1.32, y: 1.07, var: KR.adf, mode: 'toggle' });
    bkButton(b, u, { id: 'c172s.kr87.bfo', label: 'KR 87 BFO', text: 'BFO', x: 1.93, y: 1.07, var: KR.bfo, mode: 'toggle' });
    bkButton(b, u, { id: 'c172s.kr87.frq', label: 'KR 87 FRQ transfer', text: 'FRQ⇄', x: 2.53, y: 1.07, var: KR.frq });
    bkButton(b, u, { id: 'c172s.kr87.flt_et', label: 'KR 87 FLT/ET', text: 'FLT/ET', x: 3.12, y: 1.07, var: KR.fltEt });
    bkButton(b, u, { id: 'c172s.kr87.set_rst', label: 'KR 87 SET/RST', text: 'SET/RST', x: 3.73, y: 1.07, var: KR.setRst });
    volKnob(b, u, { id: 'c172s.kr87.vol', label: 'KR 87 ON/OFF/VOLUME', x: 4.77, y: 0.95, var: KR.vol, d: 0.26 });
    legend(u, 'VOL', 5.02, 0.84, 0.0010);
    legend(u, 'OFF', 4.62, 1.18, 0.0010);
    dualKnob(b, u, { id: 'c172s.kr87.freq', label: 'KR 87 frequency (outer 100s, inner 10s, pulled 1s)', x: 5.76, y: 0.7, outer: [EV.krOuter, '100 kHz'], inner: [EV.krInner, '10 / 1 kHz'], pull: { var: KR.innerPull, label: 'PULL 1s' } });
    legend(u, 'STBY/\nTIMER', 4.55, 0.55, 0.0010);
    legend(u, 'ADF   KR 87 TSO', 5.3, 0.12, 0.0011);
  }

  // ---------------------------------------------------------------- KT 76C transponder
  {
    const u = unit(b, panel, 'kt76c', UNITS.kt76c);
    bkButton(b, u, { id: 'c172s.kt76c.idt', label: 'KT 76C IDT', text: 'IDT', x: 0.4, y: 0.55, w: 0.38, h: 0.22, var: KT.idt });
    screen(u, displays.get('kt76c'), 2.68, 0.54, 3.78, 0.84);
    u.p.add(
      new SelectorKnob(env, {
        id: 'c172s.kt76c.mode',
        label: 'KT 76C mode selector',
        var: KT.mode,
        positions: [
          { value: KT_MODE.off, label: 'OFF', angle: -150 },
          { value: KT_MODE.sby, label: 'SBY', angle: -90 },
          { value: KT_MODE.tst, label: 'TST', angle: -40 },
          { value: KT_MODE.on, label: 'ON', angle: 5 },
          { value: KT_MODE.alt, label: 'ALT', angle: 55 },
        ],
        initial: 0,
        diameter: 0.42 * IN,
        labelRadius: 0.38 * IN,
        labelHeight: 0.0012,
        labelZone: ZONE,
      }),
      u.x(5.69),
      u.y(0.78),
    );
    legend(u, 'XPDR  KT 76C TSO', 5.2, 0.12, 0.0011);
    for (let d = 0; d <= 7; d++) bkButton(b, u, { id: `c172s.kt76c.key${d}`, label: `KT 76C code key ${d}`, text: String(d), x: 0.38 + d * 0.58, y: 1.36, w: 0.36, h: 0.19, event: EV.ktKey(d) });
    bkButton(b, u, { id: 'c172s.kt76c.clr', label: 'KT 76C CLR', text: 'CLR', x: 5.17, y: 1.36, w: 0.36, h: 0.19, event: EV.ktClr });
    bkButton(b, u, { id: 'c172s.kt76c.vfr', label: 'KT 76C VFR', text: 'VFR', x: 5.89, y: 1.36, w: 0.36, h: 0.19, event: EV.ktVfr });
  }

  // ---------------------------------------------------------------- KAP 140 autopilot with altitude preselect
  {
    const u = unit(b, panel, 'kap140', UNITS.kap140);
    legend(u, 'BENDIX/KING', 0.5, 0.1, 0.0010);
    legend(u, 'KAP 140', 0.4, 0.42, 0.0011);
    screen(u, displays.get('kap140'), 2.55, 0.62, 3.6, 0.83);
    u.p.add(new AnnunciatorLight(env, { id: 'c172s.kap140.p', label: 'KAP 140 red P (pitch axis)', segments: [{ text: 'P', color: 'red', var: KAP.pLamp, test: (v) => v > 0.5 }], width: 0.2 * IN, height: 0.2 * IN }), u.x(0.25), u.y(1.12));
    u.p.add(new AnnunciatorLight(env, { id: 'c172s.kap140.r', label: 'KAP 140 red R (roll axis)', segments: [{ text: 'R', color: 'red', var: KAP.rLamp, test: (v) => v > 0.5 }], width: 0.2 * IN, height: 0.2 * IN }), u.x(0.66), u.y(1.12));
    const btns: ['ap' | 'hdg' | 'nav' | 'apr' | 'rev' | 'alt', string][] = [
      ['ap', 'AP'],
      ['hdg', 'HDG'],
      ['nav', 'NAV'],
      ['apr', 'APR'],
      ['rev', 'REV'],
      ['alt', 'ALT'],
    ];
    const bx = [0.38, 1.6, 2.22, 2.84, 3.46, 4.08]; // VH-SPQ: AP at the left edge, HDG .. ALT under the display
    // AP: momentary var, engage by pressing and holding ~0.25 s, disengage with a press (Supplement 15 Fig 2 item 2).
    btns.forEach(([k, t], i) =>
      bkButton(b, u, {
        id: `c172s.kap140.${k}`,
        label: k === 'ap' ? 'KAP 140 AP (press and hold ~0.25 s to engage; press to disengage)' : `KAP 140 ${t}`,
        text: t,
        x: bx[i],
        y: 1.43,
        w: 0.46,
        h: 0.24,
        ...(k === 'ap' ? { var: KAP.apBtn } : { event: EV.kap(k) }),
      }),
    );
    // UP / DN: a framed vertical rocker pair right of the display (VH-SPQ photograph).
    rockerFrame(u, 4.78, 0.98, 0.46, 0.9);
    bkButton(b, u, { id: 'c172s.kap140.up', label: 'KAP 140 UP (VS +100 fpm / ALT +20 ft; hold = rate)', text: 'UP', x: 4.78, y: 0.76, w: 0.36, h: 0.36, var: KAP.up });
    bkButton(b, u, { id: 'c172s.kap140.dn', label: 'KAP 140 DN (VS -100 fpm / ALT -20 ft; hold = rate)', text: 'DN', x: 4.78, y: 1.2, w: 0.36, h: 0.36, var: KAP.dn });
    bkButton(b, u, { id: 'c172s.kap140.arm', label: 'KAP 140 ARM (altitude arm on / off)', text: 'ARM', x: 5.1, y: 0.24, w: 0.38, h: 0.2, event: EV.kap('arm') });
    bkButton(b, u, { id: 'c172s.kap140.baro', label: 'KAP 140 BARO (hold 2 s: IN HG / HPA)', text: 'BARO', x: 5.7, y: 0.24, w: 0.38, h: 0.2, var: KAP.baro });
    dualKnob(b, u, { id: 'c172s.kap140.alt_sel', label: 'KAP 140 altitude select (outer 1000 ft, inner 100 ft; baro while shown)', x: 5.68, y: 1.02, outer: [EV.kapAltOuter, '1000 FT'], inner: [EV.kapAltInner, '100 FT'], d: 0.5 });
  }
}
