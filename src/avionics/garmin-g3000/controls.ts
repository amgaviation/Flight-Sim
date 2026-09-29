/**
 * Hardware controls of the G3000 / G5000 flight deck as data, for the
 * cockpit builders of the M2 / Longitude modules: every key, knob, wheel,
 * joystick and switch with its EventBus events (ready for the cockpit
 * `PushButton` `event` and `RotaryKnob` `incEvent` / `decEvent` / `push`
 * options), the annunciator light var and an approximate position on the
 * unit face.
 *
 * Positions are millimetres from the unit's upper-left corner, x right, y
 * down, and are EST (measured from the PG figures: GMC 710 Figure 7-1,
 * GDU bezel Figure 1-2, GTC 570 / 580 Figure 1-12); unit sizes likewise EST.
 */
import type { G3000Resolved, ResolvedGtc } from './config';
import { G3K, G3K_EVENTS, type GduId } from './vars';
import { GMC_KEYS, type GmcKey } from './gmc/Gmc710';

export type ControlKind = 'button' | 'knob' | 'dualKnob' | 'wheel' | 'joystick' | 'switch';

export interface G3kControl {
  /** Stable id: 'gmc.hdg', 'gmc.key.ap', 'pfd1.sk3', 'gtc2.upper', 'rev.pfd1'... */
  id: string;
  /** Unit carrying the control: 'gmc', a GDU id, a GTC id, or 'panel' (baro / reversion). */
  unit: string;
  kind: ControlKind;
  label: string;
  /** Momentary press event (buttons, knob push). */
  press?: string;
  /** Push-and-hold event (GTC dual knob: COM swap). */
  hold?: string;
  /** Encoder events (single knob / wheel, or the OUTER knob of a dual knob): positive clicks on inc / dec. */
  incEvent?: string;
  decEvent?: string;
  /** Inner knob of a dual concentric knob. */
  innerIncEvent?: string;
  innerDecEvent?: string;
  /** Joystick deflection event, payload { x, y } in -1..1. */
  joystick?: string;
  /** Switch var (0/1). */
  var?: string;
  /** Annunciator light var (1 = lit). */
  lightVar?: string;
  /** Second light (XFR right arrow). */
  lightVar2?: string;
  /** Position on the unit face (mm from the upper-left corner), EST. */
  pos: [number, number];
}

/** EST unit sizes (mm): GMC 710 face, GDU 1400W bezel, GTC 570 (portrait) / GTC 580 (landscape). */
export const UNIT_SIZE_MM = {
  gmc710: [330, 70] as [number, number],
  gdu1400: [354, 237] as [number, number],
  gtc570: [150, 215] as [number, number],
  gtc580: [215, 138] as [number, number],
};

const inc = (e: string): string => `${e}_inc`;
const dec = (e: string): string => `${e}_dec`;

/** GMC 710 key positions left to right (EST from PG Figure 7-1). */
const GMC_KEY_POS: Record<GmcKey, [number, number]> = {
  FD1: [18, 50],
  HDG: [70, 22],
  NAV: [92, 22],
  APR: [114, 22],
  BC: [136, 22],
  AP: [150, 50],
  XFR: [165, 22],
  YD: [180, 50],
  BANK: [70, 50],
  VS: [196, 22],
  FLC: [218, 22],
  ALT: [240, 22],
  VNAV: [196, 50],
  SPD: [218, 50],
  AT: [240, 50],
  FD: [18, 22],
  FD2: [312, 50],
};

/** GMC 710 AFCS controller. */
export function gmc710Controls(cfg: G3000Resolved): G3kControl[] {
  const out: G3kControl[] = [];
  for (const k of GMC_KEYS) {
    if (k === 'AT' && !cfg.afcs.autothrottle) continue;
    if ((k === 'FD1' || k === 'FD2') && cfg.variant !== 'g5000') continue;
    const xfr = k === 'XFR';
    out.push({
      id: `gmc.key.${k.toLowerCase()}`,
      unit: 'gmc',
      kind: 'button',
      label: k === 'AT' ? 'A/T' : k,
      press: G3K_EVENTS.gmcKey(k),
      // XFR: left / right arrow lights show the coupled side.
      lightVar: xfr ? G3K.gmcLight('xfr_l') : G3K.gmcLight(k),
      lightVar2: xfr ? G3K.gmcLight('xfr_r') : undefined,
      pos: GMC_KEY_POS[k],
    });
  }
  out.push(
    { id: 'gmc.crs1', unit: 'gmc', kind: 'knob', label: 'CRS1', incEvent: inc(G3K_EVENTS.crsTurn(1)), decEvent: dec(G3K_EVENTS.crsTurn(1)), press: G3K_EVENTS.crsPush(1), pos: [40, 35] },
    { id: 'gmc.hdg', unit: 'gmc', kind: 'knob', label: 'HDG', incEvent: inc(G3K_EVENTS.hdgTurn), decEvent: dec(G3K_EVENTS.hdgTurn), press: G3K_EVENTS.hdgPush, pos: [45, 35] },
    { id: 'gmc.nose', unit: 'gmc', kind: 'wheel', label: 'NOSE UP/DN', incEvent: inc(G3K_EVENTS.noseWheel), decEvent: dec(G3K_EVENTS.noseWheel), pos: [262, 35] },
    { id: 'gmc.alt', unit: 'gmc', kind: 'dualKnob', label: 'ALT SEL', incEvent: inc(G3K_EVENTS.altTurnOuter), decEvent: dec(G3K_EVENTS.altTurnOuter), innerIncEvent: inc(G3K_EVENTS.altTurnInner), innerDecEvent: dec(G3K_EVENTS.altTurnInner), press: G3K_EVENTS.altPush, pos: [285, 35] },
    { id: 'gmc.crs2', unit: 'gmc', kind: 'knob', label: 'CRS2', incEvent: inc(G3K_EVENTS.crsTurn(2)), decEvent: dec(G3K_EVENTS.crsTurn(2)), press: G3K_EVENTS.crsPush(2), pos: [312, 22] },
  );
  if (cfg.afcs.speedKnob) out.push({ id: 'gmc.spd', unit: 'gmc', kind: 'knob', label: 'SPD', incEvent: inc(G3K_EVENTS.spdTurn), decEvent: dec(G3K_EVENTS.spdTurn), press: G3K_EVENTS.spdPush, pos: [230, 58] });
  return out;
}

/** The 12 bezel softkeys below a GDU (PG Figure 1-2: evenly spaced along the lower bezel). */
export function gduControls(gdu: GduId): G3kControl[] {
  const out: G3kControl[] = [];
  const [w, h] = UNIT_SIZE_MM.gdu1400;
  for (let i = 1; i <= 12; i++) out.push({ id: `${gdu}.sk${i}`, unit: gdu, kind: 'button', label: `SK${i}`, press: G3K_EVENTS.softkey(gdu, i), pos: [20 + ((w - 40) * (i - 0.5)) / 12, h - 12] });
  return out;
}

/**
 * GTC hardware: GTC 570 (below the screen, left to right): map knob with
 * joystick (range / push pan), center knob (volume / push squelch), dual
 * concentric knob (push / hold). GTC 580 (right bezel): dual concentric
 * upper knob, three mode softkeys, lower knob.
 */
export function gtcControls(g: ResolvedGtc): G3kControl[] {
  const id = g.id;
  const out: G3kControl[] = [];
  const v = g.model === 'GTC570';
  const [w, h] = v ? UNIT_SIZE_MM.gtc570 : UNIT_SIZE_MM.gtc580;
  out.push({
    id: `${id}.upper`,
    unit: id,
    kind: 'dualKnob',
    label: 'Upper knob',
    incEvent: inc(G3K_EVENTS.gtcUpperOuter(id)),
    decEvent: dec(G3K_EVENTS.gtcUpperOuter(id)),
    innerIncEvent: inc(G3K_EVENTS.gtcUpperInner(id)),
    innerDecEvent: dec(G3K_EVENTS.gtcUpperInner(id)),
    press: G3K_EVENTS.gtcUpperPush(id),
    hold: G3K_EVENTS.gtcUpperHold(id),
    pos: v ? [w - 25, h - 18] : [w - 18, 20],
  });
  out.push({
    id: `${id}.lower`,
    unit: id,
    kind: v ? 'joystick' : 'knob',
    label: v ? 'Map knob' : 'Lower knob',
    incEvent: inc(G3K_EVENTS.gtcLower(id)),
    decEvent: dec(G3K_EVENTS.gtcLower(id)),
    press: G3K_EVENTS.gtcLowerPush(id),
    joystick: v ? G3K_EVENTS.gtcJoystick(id) : undefined,
    pos: v ? [25, h - 18] : [w - 18, h - 20],
  });
  if (v) out.push({ id: `${id}.center`, unit: id, kind: 'knob', label: 'Center knob', incEvent: inc(G3K_EVENTS.gtcCenter(id)), decEvent: dec(G3K_EVENTS.gtcCenter(id)), press: G3K_EVENTS.gtcCenterPush(id), pos: [w / 2, h - 18] });
  else
    g.modes.forEach((m, i) => {
      out.push({ id: `${id}.mode_${m.toLowerCase()}`, unit: id, kind: 'button', label: m === 'NAVCOM' ? 'NAV/COM' : m, press: G3K_EVENTS.gtcModeKey(id, m), pos: [w - 18, 50 + i * 22] });
    });
  return out;
}

/** Baro knobs (one per PFD, push STD) and the display reversion switches. */
export function panelControls(cfg: G3000Resolved): G3kControl[] {
  const out: G3kControl[] = [];
  for (let s = 1; s <= cfg.pfdCount; s++) {
    out.push({ id: `baro${s}`, unit: 'panel', kind: 'knob', label: `BARO ${s}`, incEvent: inc(G3K_EVENTS.baroTurn(s)), decEvent: dec(G3K_EVENTS.baroTurn(s)), press: G3K_EVENTS.baroPush(s), pos: [0, 0] });
    out.push({ id: `mins${s}`, unit: 'panel', kind: 'knob', label: `MINS ${s}`, incEvent: inc(G3K_EVENTS.minsTurn(s)), decEvent: dec(G3K_EVENTS.minsTurn(s)), press: G3K_EVENTS.minsPush(s), pos: [0, 0] });
    out.push({ id: `range${s}`, unit: 'panel', kind: 'knob', label: `RANGE ${s}`, incEvent: inc(G3K_EVENTS.rangeTurn(s)), decEvent: dec(G3K_EVENTS.rangeTurn(s)), pos: [0, 0] });
  }
  // DISPLAY REVERSION switches above PFD1 and the MFD (PG §1.4: "reversionary switch mounted above the display unit").
  out.push({ id: 'rev.pfd1', unit: 'panel', kind: 'switch', label: 'PFD1 REV', var: G3K.reversionSwitch('pfd1'), pos: [0, 0] });
  out.push({ id: 'rev.mfd', unit: 'panel', kind: 'switch', label: 'MFD REV', var: G3K.reversionSwitch('mfd'), pos: [0, 0] });
  if (cfg.pfdCount === 2) out.push({ id: 'rev.pfd2', unit: 'panel', kind: 'switch', label: 'PFD2 REV', var: G3K.reversionSwitch('pfd2'), pos: [0, 0] });
  return out;
}

/** Every hardware control of the installation. */
export function g3000Controls(cfg: G3000Resolved): G3kControl[] {
  const out = gmc710Controls(cfg);
  out.push(...gduControls('pfd1'), ...gduControls('mfd'));
  if (cfg.pfdCount === 2) out.push(...gduControls('pfd2'));
  for (const g of cfg.gtcs) out.push(...gtcControls(g));
  out.push(...panelControls(cfg));
  return out;
}
