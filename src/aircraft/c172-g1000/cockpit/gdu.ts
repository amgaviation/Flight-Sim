/**
 * Garmin GDU 1054B bezels (PFD and MFD) and the GMA 1360 audio panel for the 172S NXi.
 *
 * Every key and knob is built from the G1000 suite's control map (`gduControls` / `gmaControls`,
 * src/avionics/garmin-g1000/controls.ts), so each emits the exact event the G1000 system listens
 * to; only the placement is decided here.
 *
 * Bezel layout (mm from the bezel's upper-left corner): measured on the straight-on photograph
 * Wikimedia Commons "Cessna 172SP G1000 01.jpg" (GDU 1040 bezel, 2.07 px/mm) and the close-up
 * "Cessna 172SP G1000 06.jpg"; the GFC 700 key block (AP|FD, HDG|ALT, NAV|VNV, APR|BC, VS|NOSE UP,
 * FLC|NOSE DN, PG 190-02177-02 Figure 1-2) fills the space between the HDG and ALT knobs as on the
 * GDU 1054B. Bezel 315 x 205 mm, 10.4 in 1024 x 768 active area (211.2 x 158.4 mm) in a 230 x 171 mm
 * black window. GMA key grid measured on the same photograph (rows 14 mm apart, knob and DISPLAY
 * BACKUP below). Knob / key sizes EST from the photographs.
 */
import * as THREE from 'three';
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import type { CockpitDisplay, ControlPointer } from '../../../cockpit/types';
import { COCKPIT_SOUNDS } from '../../../cockpit/types';
import type { CockpitEnv } from '../../../cockpit/env';
import { ControlBase, KeyPad, PushButton, RotaryKnob } from '../../../cockpit/controls';
import { extrude, roundedRectShape, roundedRectPath, cylinderZ, revolve } from '../../../cockpit/geometry/primitives';
import { gduControls, gmaControls, type G1kControl } from '../../../avionics/garmin-g1000/controls';
import type { G1000Resolved } from '../../../avionics/garmin-g1000/config';
import { G1K, G1K_EVENTS, type GduId } from '../../../avionics/garmin-g1000/vars';

export const GDU_MM = { w: 315, h: 205, winX0: 43.5, winY0: 8.2, winW: 230, winH: 171, actW: 211.2, actH: 158.4 };
export const GMA_MM = { w: 34, h: 205 };
/** Bezel depth: controls stand on the bezel face (m). */
const BEZEL_DEPTH = 0.009;

/** GDU control positions (mm from the bezel's upper-left corner), by control id suffix. */
const GDU_POS: Record<string, [number, number]> = {
  nav_vol: [17, 14],
  nav_xfer: [28, 27.5],
  nav: [17, 46],
  hdg: [19, 80],
  'afcs.ap': [10.5, 99],
  'afcs.fd': [26.5, 99],
  'afcs.hdg': [10.5, 112],
  'afcs.alt': [26.5, 112],
  'afcs.nav': [10.5, 125],
  'afcs.vnv': [26.5, 125],
  'afcs.apr': [10.5, 138],
  'afcs.bc': [26.5, 138],
  'afcs.vs': [10.5, 151],
  'afcs.nose_up': [26.5, 151],
  'afcs.flc': [10.5, 164],
  'afcs.nose_dn': [26.5, 164],
  alt: [18, 187],
  com_vol: [297, 14],
  com_xfer: [287, 27.5],
  com: [297, 46],
  crs_baro: [297, 80],
  range: [297, 113],
  'key.dto': [288, 138],
  'key.menu': [304, 138],
  'key.fpl': [288, 150],
  'key.proc': [304, 150],
  'key.clr': [288, 162],
  'key.ent': [304, 162],
  fms: [297, 187],
};

const KEY_LABEL: Record<string, string> = {
  'afcs.ap': 'AP',
  'afcs.fd': 'FD',
  'afcs.hdg': 'HDG',
  'afcs.alt': 'ALT',
  'afcs.nav': 'NAV',
  'afcs.vnv': 'VNV',
  'afcs.apr': 'APR',
  'afcs.bc': 'BC',
  'afcs.vs': 'VS',
  'afcs.nose_up': 'NOSE\nUP',
  'afcs.flc': 'FLC',
  'afcs.nose_dn': 'NOSE\nDN',
  'key.dto': 'D→',
  'key.menu': 'MENU',
  'key.fpl': 'FPL',
  'key.proc': 'PROC',
  'key.clr': 'CLR',
  'key.ent': 'ENT',
  nav_xfer: '↔',
  com_xfer: '↔',
};

/** Printed bezel legends: [text, x mm, y mm, height mm]. */
const GDU_LEGENDS: [string, number, number, number][] = [
  ['VOL', 8, 21.5, 1.8],
  ['PUSH ID', 18, 23.5, 1.5],
  ['NAV', 17, 34, 2.4],
  ['PUSH\n1-2', 17, 58, 1.6],
  ['HDG', 19, 69, 2.4],
  ['PUSH\nHDG SYNC', 19, 91, 1.5],
  ['ALT', 18, 176, 2.4],
  ['VOL', 307, 21.5, 1.8],
  ['PUSH SQ', 297, 23.5, 1.5],
  ['EMERG', 278, 32, 1.4],
  ['COM', 297, 34, 2.4],
  ['PUSH\n1-2', 297, 58, 1.6],
  ['CRS    BARO', 297, 69, 2.2],
  ['PUSH\nCRS CTR', 297, 91, 1.5],
  ['RANGE', 297, 102, 2.2],
  ['PUSH\nPAN', 297, 124, 1.6],
  ['DFLT MAP', 283, 168.5, 1.3],
  ['FMS', 303, 176, 2.4],
  ['PUSH CRSR', 297, 198, 1.4],
];

function posOf(id: string, g: GduId): [number, number] | null {
  const k = id.slice(g.length + 1);
  return GDU_POS[k] ?? null;
}

/** A display stand-in for headless builds (no canvas): keeps the screen mesh and bezel. */
export class NullDisplay implements CockpitDisplay {
  readonly canvas = { width: 4, height: 4 } as unknown as HTMLCanvasElement;
  readonly width = 4;
  readonly height = 4;
  readonly refreshHz = 1;
  constructor(readonly id: string) {}
  render(): boolean {
    return false;
  }
}

/**
 * GDU RANGE knob / map joystick (PG §1.2 "Joystick"): turn = map range, push = PAN (map pointer),
 * deflect = move the pointer. Mouse: wheel or left / right click = range out / in; middle click or
 * Ctrl+click = push; drag = joystick deflection (emits { x, y } -1..1 per drag step, then centres).
 */
export class G1kJoystickKnob extends ControlBase {
  private readonly c: G1kControl;
  private dragging = false;
  private moved = 0;
  private readonly cap = new THREE.Group();
  private tilt = 0;
  private tiltX = 0;
  private tiltY = 0;

  constructor(env: CockpitEnv, c: G1kControl, idPrefix: string) {
    super(env, { id: `${idPrefix}.${c.id}`, label: c.label });
    this.c = c;
    const d = 0.012;
    this.mesh(this.geo('c172g.joy.ring', () => revolve([[d * 0.62, 0.0016], [d * 0.62, 0.0016], [d * 0.9, 0.0012], [d * 0.95, 0], [d * 0.95, 0]], 32)), 'bezel', this.object, true);
    this.object.add(this.cap);
    this.mesh(this.geo('c172g.joy.stem', () => cylinderZ(0.0022, 0.0022, 0, 0.006, 12)), 'steel', this.cap);
    const knob = this.mesh(this.geo('c172g.joy.knob', () => cylinderZ(d / 2, d * 0.46, 0.004, 0.0125, 28)), 'knobKnurled', this.cap);
    knob.name = 'joystick_knob';
    this.addHitBox(d * 1.3, d * 1.3, 0.016, 0, 0, 0.008);
  }

  protected stateText(): string {
    return 'turn = range, push = pan, drag = move pointer';
  }

  onPointerDown(p: ControlPointer): void {
    if (p.button === 1 || p.ctrl) {
      this.emit(this.c.press);
      this.playSound(COCKPIT_SOUNDS.knobPush, 0.5);
      return;
    }
    this.dragging = true;
    this.moved = 0;
  }

  onDrag(dx: number, dy: number): void {
    if (!this.dragging) return;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.moved < 3) return;
    const x = Math.max(-1, Math.min(1, dx / 10));
    const y = Math.max(-1, Math.min(1, dy / 10));
    this.tiltX = x;
    this.tiltY = y;
    this.tilt = 1;
    this.emit(this.c.joystick, { x, y });
  }

  onPointerUp(p: ControlPointer): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.moved < 3) {
      this.emit(p.button === 2 ? this.c.decEvent : this.c.incEvent, 1);
      this.playSound(COCKPIT_SOUNDS.knobDetent, 0.5);
    } else this.emit(this.c.joystick, { x: 0, y: 0 });
    this.tilt = 0;
  }

  onCancel(): void {
    this.dragging = false;
    this.tilt = 0;
  }

  onWheel(delta: number): void {
    if (delta === 0) return;
    this.emit(delta > 0 ? this.c.incEvent : this.c.decEvent, Math.abs(delta));
    this.playSound(COCKPIT_SOUNDS.knobDetent, 0.5);
  }

  override update(dt: number): void {
    const k = 1 - Math.exp(-dt / 0.05);
    const tx = this.tilt ? this.tiltY * 0.25 : 0;
    const ty = this.tilt ? this.tiltX * 0.25 : 0;
    this.cap.rotation.x += (tx - this.cap.rotation.x) * k;
    this.cap.rotation.y += (ty - this.cap.rotation.y) * k;
  }
}

/** Builds one control from the suite's control data. */
function makeControl(env: CockpitEnv, c: G1kControl, zone: string, idPrefix: string, labelKey: string): ControlBase | RotaryKnob | PushButton {
  const id = `${idPrefix}.${c.id}`;
  if (c.kind === 'joystick') return new G1kJoystickKnob(env, c, idPrefix);
  if (c.kind === 'dualKnob') {
    return new RotaryKnob(env, {
      id,
      label: c.label,
      outer: { incEvent: c.incEvent, decEvent: c.decEvent, label: 'outer' },
      inner: { incEvent: c.innerIncEvent, decEvent: c.innerDecEvent, label: 'inner' },
      push: c.press ? { event: c.press, label: 'push' } : undefined,
      diameter: 0.0175,
      height: 0.007,
      innerDiameter: 0.0115,
      innerHeight: 0.009,
      cap: 'ring',
      innerCap: 'knurled',
      pointer: 'none',
      zone,
    });
  }
  if (c.kind === 'knob') {
    const big = c.id.endsWith('.hdg');
    return new RotaryKnob(env, {
      id,
      label: c.label,
      outer: { incEvent: c.incEvent, decEvent: c.decEvent },
      push: c.press ? { event: c.press, label: 'push' } : undefined,
      diameter: big ? 0.0135 : 0.0105,
      height: big ? 0.011 : 0.009,
      cap: 'knurled',
      pointer: 'none',
      zone,
    });
  }
  // Keys.
  const label = KEY_LABEL[labelKey] ?? '';
  const two = label.includes('\n');
  return new PushButton(env, {
    id,
    label: c.label,
    mode: 'momentary',
    style: 'key',
    width: 0.0132,
    height: 0.0088,
    event: c.press,
    releaseEvent: c.release,
    capMaterial: 'plasticBlack',
    engraved: label,
    engravedHeight: two ? 0.0017 : label.length > 3 ? 0.0021 : 0.0026,
    zone,
    // The GDU 1054B AFCS keys carry no annunciator lights: the selected modes show in the PFD's
    // AFCS status box (PG 190-02177-02 §7.2), so the suite's key light vars are not drawn here.
    lightBar: c.lightVar && !labelKey.startsWith('afcs.') ? { var: c.lightVar, color: 'green' } : undefined,
  });
}

/** Black LCD window (the unlit margin of the glass around the active area). */
function windowMargin(b: CockpitBuilder): THREE.BufferGeometry {
  return b.env.geometry.get('c172g.gdu.window', () => {
    const W = GDU_MM.winW / 1000;
    const H = GDU_MM.winH / 1000;
    const s = roundedRectShape(W, H, 0.002);
    s.holes.push(roundedRectPath(GDU_MM.actW / 1000, GDU_MM.actH / 1000, 0.0005));
    return extrude(s, { depth: 0.0004, anchor: 'back0' });
  });
}

/**
 * One GDU: bezel, screen (active area centred in the window), the bezel legends and every key
 * and knob. (x0, y0): the bezel's upper-left corner in the panel's top-left coordinates (m).
 */
export function buildGdu(b: CockpitBuilder, panel: Panel, cfg: G1000Resolved, g: GduId, display: CockpitDisplay, x0: number, y0: number): void {
  const env = b.env;
  const mm = (v: number) => v / 1000;
  const zone = `${g}_keys`;
  b.zone({ id: zone, intensityVar: G1K.keyLight(g), lagS: 0 });
  // Active-area centre within the bezel.
  const acx = GDU_MM.winX0 + GDU_MM.winW / 2;
  const acy = GDU_MM.winY0 + GDU_MM.winH / 2;
  const border: [number, number, number, number] = [
    mm(acx - GDU_MM.actW / 2),
    mm(GDU_MM.w - (acx + GDU_MM.actW / 2)),
    mm(acy - GDU_MM.actH / 2),
    mm(GDU_MM.h - (acy + GDU_MM.actH / 2)),
  ];
  panel.display(display, x0 + mm(acx), y0 + mm(acy), mm(GDU_MM.actW), mm(GDU_MM.actH), {
    bezel: { border, depth: BEZEL_DEPTH, material: 'bezel' },
    display: { boot: false },
  });
  const win = new THREE.Mesh(windowMargin(b), env.materials.get('lcdOff'));
  win.userData.cockpitStatic = true;
  panel.addObject(win, x0 + mm(acx), y0 + mm(acy), { z: BEZEL_DEPTH - 0.0002 });
  // GARMIN logotype and legends (backlit with the keys).
  const lbl = (t: string, xm: number, ym: number, hmm: number, weight = 700) => {
    const l = env.labels.text(t, { height: mm(hmm), weight, zone, color: '#e8e8e4' });
    l.userData.cockpitStatic = true;
    panel.addObject(l, x0 + mm(xm), y0 + mm(ym), { z: BEZEL_DEPTH + 0.0002 });
  };
  lbl('GARMIN', acx, 4.2, 2.6, 800);
  for (const [t, xm, ym, h] of GDU_LEGENDS) {
    if (!cfg.afcs && t.startsWith('ALT')) continue;
    lbl(t, xm, ym, h);
  }
  // Keys and knobs from the suite's control map.
  for (const c of gduControls(cfg, g)) {
    if (/\.sk\d+$/.test(c.id)) continue;
    const pos = posOf(c.id, g);
    if (!pos) continue;
    const ctl = makeControl(env, c, zone, 'c172g', c.id.slice(g.length + 1));
    panel.add(ctl, x0 + mm(pos[0]), y0 + mm(pos[1]), { z: BEZEL_DEPTH });
  }
  // Softkey divider strip above the key row and the two vertical SD card slots in the right bezel beside the
  // COM and CRS/BARO knobs (PG 190-02177-00 Fig 1-2 / Fig 7-1, measured at 5.54 px/mm: strip x 41-274 mm at
  // y 181 mm; slots x 280 mm, y 41-67 and 77-103 mm, ~3 mm wide). Static.
  {
    const strip = new THREE.Mesh(env.geometry.get('c172g.gdu.sk_strip', () => new THREE.BoxGeometry(mm(233), mm(1.1), 0.0006)), env.materials.get('plasticGrey'));
    strip.userData.cockpitStatic = true;
    panel.addObject(strip, x0 + mm(157.5), y0 + mm(181.2), { z: BEZEL_DEPTH + 0.0003 });
    const slotG = env.geometry.get('c172g.gdu.sd_slot', () => extrude(roundedRectShape(mm(3), mm(26), mm(1)), { depth: 0.0005, anchor: 'back0' }));
    for (const yc of [54, 90]) {
      const slot = new THREE.Mesh(slotG, env.materials.get('lcdOff'));
      slot.userData.cockpitStatic = true;
      panel.addObject(slot, x0 + mm(280), y0 + mm(yc), { z: BEZEL_DEPTH });
    }
  }
  // Twelve softkeys under the screen (instanced keypad); each key carries the printed up-triangle
  // (PG Fig 1-2); the function legends are drawn by the display above each key.
  const keyW = 0.012;
  const pitch = 0.018;
  panel.add(
    new KeyPad(env, {
      id: `c172g.${g}.softkeys`,
      label: `${g.toUpperCase()} SOFTKEYS`,
      eventPrefix: `g1k.${g}.sk`,
      rows: [Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), label: '▲' }))],
      legendHeight: 0.0018,
      keyWidth: keyW,
      keyHeight: 0.0068,
      gap: pitch - keyW,
      keyMaterial: 'plasticBlack',
    }),
    x0 + mm(acx) - (11 * pitch + keyW) / 2,
    y0 + mm(186),
    { z: BEZEL_DEPTH },
  );
}

/**
 * GMA 1360 key grid (mm): rows 14 mm apart from y 11, columns at x 9.5 / 24.5 (photograph).
 * SCOPE: the ADF (and DME) receiver keys are fitted on every GMA 1360, but the optional KR 87 ADF (POH
 * Fig 7-2 item 13, "if installed") and DME are not installed in this simulation (their AVN BUS 1 breaker
 * holes carry blank plugs, panel.ts CB_RIGHT): the keys select / deselect the receiver audio and light
 * their annunciators as on an airplane without the receiver, and there is no ADF / DME audio to hear.
 */
const GMA_POS: Record<string, [number, number]> = {
  com1_mic: [9.5, 11],
  com1: [24.5, 11],
  com2_mic: [9.5, 25],
  com2: [24.5, 25],
  aux_mic: [9.5, 39],
  aux: [24.5, 39],
  dme: [9.5, 53],
  nav1: [24.5, 53],
  adf: [9.5, 67],
  nav2: [24.5, 67],
  pilot_ics: [9.5, 84],
  tel: [24.5, 84],
  coplt_ics: [9.5, 98],
  mus1: [24.5, 98],
  pass_ics: [9.5, 112],
  mus2: [24.5, 112],
  spkr: [9.5, 128],
  hi_sens: [24.5, 128],
  mkr: [9.5, 142],
  man_sq: [24.5, 142],
  play: [9.5, 156],
};
const GMA_KEY_TEXT: Record<string, string> = {
  com1_mic: 'COM1\nMIC',
  com1: 'COM1',
  com2_mic: 'COM2\nMIC',
  com2: 'COM2',
  aux_mic: 'AUX\nMIC',
  aux: 'AUX',
  dme: 'DME',
  nav1: 'NAV1',
  adf: 'ADF',
  nav2: 'NAV2',
  pilot_ics: 'PILOT',
  tel: 'TEL',
  coplt_ics: 'COPLT',
  mus1: 'MUS1',
  pass_ics: 'PASS',
  mus2: 'MUS2',
  spkr: 'SPKR\nPA',
  hi_sens: 'HI\nSENS',
  mkr: 'MKR\nMUTE',
  man_sq: 'MAN\nSQ',
  play: 'PLAY',
};

/** GMA 1360 between the displays (POH Fig 7-2 item 7), with DISPLAY BACKUP on its lower face (POH Sec 7). */
export function buildGma(b: CockpitBuilder, panel: Panel, x0: number, y0: number): void {
  const env = b.env;
  const mm = (v: number) => v / 1000;
  const zone = 'gma_keys';
  b.zone({ id: zone, intensityVar: 'ac.c172g.key_light', lagS: 0 });
  const plate = panel.subPanel({ name: 'c172g.gma', x: x0 + mm(GMA_MM.w / 2), y: y0 + mm(GMA_MM.h / 2), width: mm(GMA_MM.w), height: mm(GMA_MM.h), material: 'bezel', screws: false, thickness: BEZEL_DEPTH, radius: 0.003, z: BEZEL_DEPTH });
  void plate;
  const z = BEZEL_DEPTH;
  const lbl = (t: string, xm: number, ym: number, hmm: number) => {
    const l = env.labels.text(t, { height: mm(hmm), weight: 700, zone, color: '#e8e8e4' });
    l.userData.cockpitStatic = true;
    panel.addObject(l, x0 + mm(xm), y0 + mm(ym), { z: z + 0.0002 });
  };
  lbl('CREW', 17, 77.5, 1.4);
  lbl('ICS  ISOLATION', 17, 119.5, 1.2);
  lbl('PILOT      PASS', 17, 164, 1.3);
  lbl('VOL / SQ', 17, 187.5, 1.3);
  lbl('DISPLAY BACKUP', 17, 202, 1.3);
  for (const c of gmaControls()) {
    const key = c.id.slice(4);
    if (c.kind === 'button' && GMA_POS[key]) {
      const [xm, ym] = GMA_POS[key];
      const t = GMA_KEY_TEXT[key] ?? key.toUpperCase();
      panel.add(
        new PushButton(env, {
          id: `c172g.${c.id}`,
          label: c.label,
          mode: 'momentary',
          style: 'key',
          width: 0.0125,
          height: 0.0088,
          event: c.press,
          releaseEvent: c.release,
          capMaterial: 'plasticBlack',
          engraved: t,
          engravedHeight: t.includes('\n') ? 0.0016 : 0.0019,
          zone,
          lightBar: c.lightVar ? { var: c.lightVar, color: 'green' } : undefined,
        }),
        x0 + mm(xm),
        y0 + mm(ym),
        { z },
      );
    } else if (c.id === 'gma.vol') {
      panel.add(
        new RotaryKnob(env, {
          id: 'c172g.gma.vol',
          label: c.label,
          outer: { incEvent: c.incEvent, decEvent: c.decEvent, label: 'CRSR' },
          inner: { incEvent: c.innerIncEvent, decEvent: c.innerDecEvent, label: 'VOL/SQ' },
          push: { event: c.press, label: 'push' },
          diameter: 0.0165,
          height: 0.007,
          innerDiameter: 0.011,
          innerHeight: 0.009,
          cap: 'ring',
          innerCap: 'knurled',
          pointer: 'none',
          zone,
        }),
        x0 + mm(17),
        y0 + mm(176),
        { z },
      );
    } else if (c.id === 'gma.display_backup') {
      // Red push-on / push-off button: the latch is the G1000 var itself (the system reads it every frame).
      panel.add(
        new PushButton(env, {
          id: 'c172g.gma.display_backup',
          label: 'DISPLAY BACKUP',
          mode: 'toggle',
          var: G1K.displayBackup,
          style: 'round',
          width: 0.0105,
          capMaterial: 'knobRed',
        }),
        x0 + mm(17),
        y0 + mm(195),
        { z },
      );
    }
  }
  void G1K_EVENTS;
}
