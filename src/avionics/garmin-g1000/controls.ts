/**
 * Hardware controls of the G1000 NXi (Cessna NAV III) as data for the
 * c172-g1000 cockpit builder: every key and knob of both GDU 1054B bezels
 * (identical, PG 190-02177-02 §1.2 Figure 1-2), the GMA 1360 audio panel
 * (Figure 4-2) and the AFCS-related yoke / panel switches, each with its
 * EventBus events (ready for the cockpit `PushButton` `event` /
 * `releaseEvent` and `RotaryKnob` `incEvent` / `decEvent` / `push`
 * options), the annunciator light var and a position on the unit face.
 *
 * Positions are millimetres from the unit's upper-left corner, x right, y
 * down, EST (scaled from the PG figures); unit sizes EST from the GDU 104X
 * / GMA 1360 outline drawings (GDU 1054B bezel about 12.4 x 8.8 in).
 */
import type { G1000Resolved } from './config';
import { AFCS_KEYS } from './state/afcs';
import { GMA_KEYS, type GmaKey } from './state/audio';
import { G1K, G1K_EVENTS, type GduId } from './vars';

export type ControlKind = 'button' | 'knob' | 'dualKnob' | 'joystick' | 'switch';

export interface G1kControl {
  /** Stable id: 'pfd.nav', 'pfd.key.dto', 'pfd.afcs.ap', 'pfd.sk3', 'gma.com1_mic', 'yoke.ap_disc'... */
  id: string;
  /** Unit carrying the control: 'pfd' / 'mfd' (GDU bezel), 'gma', 'yoke', 'panel'. */
  unit: string;
  kind: ControlKind;
  label: string;
  /** Momentary press event (buttons, knob push). */
  press?: string;
  /** Release event (keys with a hold function: COM transfer EMERG, CLR DFLT MAP, SPKR/PA, VOL push). */
  release?: string;
  /** Encoder events (single knob, or the OUTER knob of a dual knob): positive clicks on inc / dec. */
  incEvent?: string;
  decEvent?: string;
  /** Inner knob of a dual concentric knob. */
  innerIncEvent?: string;
  innerDecEvent?: string;
  /** Joystick deflection event, payload { x, y } in -1..1. */
  joystick?: string;
  /** Annunciator light var (1 = lit; GMA: 2 = blue, 0.5 = flash-off phase). */
  lightVar?: string;
  /** Position on the unit face (mm from the upper-left corner), EST. */
  pos: [number, number];
}

/** EST unit sizes (mm): GDU 1054B bezel, GMA 1360 (vertical, between the displays). */
export const UNIT_SIZE_MM = {
  gdu1054: [315, 223] as [number, number],
  gma1360: [58, 223] as [number, number],
};

const inc = (e: string): string => `${e}_inc`;
const dec = (e: string): string => `${e}_dec`;

/** AFCS key grid on the left bezel (PG Figure 1-2): two columns, rows AP|FD, HDG|ALT, NAV|VNV, APR|BC, VS|NOSE UP, FLC|NOSE DN. */
const AFCS_POS: Record<string, [number, number]> = {
  ap: [10, 108],
  fd: [26, 108],
  hdg: [10, 122],
  alt: [26, 122],
  nav: [10, 136],
  vnv: [26, 136],
  apr: [10, 150],
  bc: [26, 150],
  vs: [10, 164],
  nose_up: [26, 164],
  flc: [10, 178],
  nose_dn: [26, 178],
};

/** One GDU 1054B bezel (the GDU 1050 omits the HDG / ALT knobs and the AFCS keys, PG §1.1). */
export function gduControls(cfg: G1000Resolved, g: GduId): G1kControl[] {
  const E = G1K_EVENTS;
  const [w, h] = UNIT_SIZE_MM.gdu1054;
  const rx = w - 18;
  const afcs = cfg.afcs && cfg.bezel[g] === 'GDU1054B';
  const out: G1kControl[] = [
    // ---- left side (NAV, HDG, AFCS, ALT)
    { id: `${g}.nav_vol`, unit: g, kind: 'knob', label: 'NAV VOL / PUSH ID', incEvent: inc(E.navVol(g)), decEvent: dec(E.navVol(g)), press: E.navVolPush(g), pos: [18, 20] },
    { id: `${g}.nav_xfer`, unit: g, kind: 'button', label: 'NAV ↔', press: E.navXfer(g), pos: [18, 38] },
    {
      id: `${g}.nav`,
      unit: g,
      kind: 'dualKnob',
      label: 'NAV (PUSH 1-2)',
      incEvent: inc(E.navOuter(g)),
      decEvent: dec(E.navOuter(g)),
      innerIncEvent: inc(E.navInner(g)),
      innerDecEvent: dec(E.navInner(g)),
      press: E.navPush(g),
      pos: [18, 60],
    },
  ];
  if (cfg.bezel[g] === 'GDU1054B') {
    out.push({ id: `${g}.hdg`, unit: g, kind: 'knob', label: 'HDG (PUSH HDG SYNC)', incEvent: inc(E.hdg(g)), decEvent: dec(E.hdg(g)), press: E.hdgPush(g), pos: [18, 86] });
    if (afcs) {
      for (const k of AFCS_KEYS) {
        out.push({ id: `${g}.afcs.${k.key}`, unit: g, kind: 'button', label: k.label, press: E.afcsKey(g, k.key), lightVar: afcsLight(k.key), pos: AFCS_POS[k.key] ?? [18, 120] });
      }
    }
    out.push({
      id: `${g}.alt`,
      unit: g,
      kind: 'dualKnob',
      label: 'ALT',
      incEvent: inc(E.altOuter(g)),
      decEvent: dec(E.altOuter(g)),
      innerIncEvent: inc(E.altInner(g)),
      innerDecEvent: dec(E.altInner(g)),
      pos: [18, 200],
    });
  }
  out.push(
    // ---- right side (COM, CRS/BARO, RANGE, keys, FMS)
    { id: `${g}.com_vol`, unit: g, kind: 'knob', label: 'COM VOL / PUSH SQ', incEvent: inc(E.comVol(g)), decEvent: dec(E.comVol(g)), press: E.comVolPush(g), pos: [rx, 20] },
    { id: `${g}.com_xfer`, unit: g, kind: 'button', label: 'COM ↔ (HOLD EMERG)', press: E.comXfer(g), release: E.comXferUp(g), pos: [rx, 38] },
    {
      id: `${g}.com`,
      unit: g,
      kind: 'dualKnob',
      label: 'COM (PUSH 1-2)',
      incEvent: inc(E.comOuter(g)),
      decEvent: dec(E.comOuter(g)),
      innerIncEvent: inc(E.comInner(g)),
      innerDecEvent: dec(E.comInner(g)),
      press: E.comPush(g),
      pos: [rx, 60],
    },
    {
      id: `${g}.crs_baro`,
      unit: g,
      kind: 'dualKnob',
      label: 'CRS/BARO (PUSH CRS CTR)',
      // Outer = BARO, inner = CRS (PG Figure 1-2).
      incEvent: inc(E.baro(g)),
      decEvent: dec(E.baro(g)),
      innerIncEvent: inc(E.crs(g)),
      innerDecEvent: dec(E.crs(g)),
      press: E.crsPush(g),
      pos: [rx, 86],
    },
    { id: `${g}.range`, unit: g, kind: 'joystick', label: 'RANGE (PUSH PAN)', incEvent: inc(E.range(g)), decEvent: dec(E.range(g)), press: E.rangePush(g), joystick: E.joystick(g), pos: [rx, 114] },
    { id: `${g}.key.dto`, unit: g, kind: 'button', label: 'D→', press: E.keyDirect(g), pos: [rx - 8, 138] },
    { id: `${g}.key.menu`, unit: g, kind: 'button', label: 'MENU', press: E.keyMenu(g), pos: [rx + 8, 138] },
    { id: `${g}.key.fpl`, unit: g, kind: 'button', label: 'FPL', press: E.keyFpl(g), pos: [rx - 8, 152] },
    { id: `${g}.key.proc`, unit: g, kind: 'button', label: 'PROC', press: E.keyProc(g), pos: [rx + 8, 152] },
    { id: `${g}.key.clr`, unit: g, kind: 'button', label: 'CLR (DFLT MAP)', press: E.keyClr(g), release: E.keyClrUp(g), pos: [rx - 8, 166] },
    { id: `${g}.key.ent`, unit: g, kind: 'button', label: 'ENT', press: E.keyEnt(g), pos: [rx + 8, 166] },
    {
      id: `${g}.fms`,
      unit: g,
      kind: 'dualKnob',
      label: 'FMS (PUSH CRSR)',
      incEvent: inc(E.fmsOuter(g)),
      decEvent: dec(E.fmsOuter(g)),
      innerIncEvent: inc(E.fmsInner(g)),
      innerDecEvent: dec(E.fmsInner(g)),
      press: E.fmsPush(g),
      pos: [rx, 196],
    },
  );
  // ---- 12 softkeys along the lower bezel
  for (let i = 1; i <= 12; i++) out.push({ id: `${g}.sk${i}`, unit: g, kind: 'button', label: `SK${i}`, press: E.softkey(g, i), pos: [44 + ((w - 88) * (i - 0.5)) / 12, h - 8] });
  return out;
}

/** AFCS key annunciator: the shared Afcs `ap.btn_<name>` vars (key lit while its mode is selected). */
function afcsLight(key: string): string | undefined {
  switch (key) {
    case 'ap':
      return 'ap.engaged';
    case 'fd':
      return 'ap.fd1_on';
    case 'vnv':
      return 'ap.btn_vnav';
    case 'nose_up':
    case 'nose_dn':
      return undefined;
    default:
      return `ap.btn_${key}`;
  }
}

/** GMA 1360 key layout (PG Figure 4-2; left column transmit / DME / ADF / intercom, right column receivers). */
const GMA_POS: Record<GmaKey, [number, number]> = {
  com1_mic: [15, 18],
  com1: [43, 18],
  com2_mic: [15, 32],
  com2: [43, 32],
  aux_mic: [15, 46],
  aux: [43, 46],
  dme: [15, 60],
  nav1: [43, 60],
  adf: [15, 74],
  nav2: [43, 74],
  pilot_ics: [15, 92],
  tel: [43, 92],
  coplt_ics: [15, 106],
  mus1: [43, 106],
  pass_ics: [15, 120],
  mus2: [43, 120],
  spkr: [15, 138],
  hi_sens: [43, 138],
  mkr: [15, 152],
  man_sq: [43, 152],
  play: [15, 166],
};

const GMA_LABELS: Record<GmaKey, string> = {
  com1_mic: 'COM1 MIC',
  com2_mic: 'COM2 MIC',
  aux_mic: 'AUX MIC',
  com1: 'COM1',
  com2: 'COM2',
  aux: 'AUX',
  nav1: 'NAV1',
  nav2: 'NAV2',
  dme: 'DME',
  adf: 'ADF',
  tel: 'TEL',
  mus1: 'MUS1',
  mus2: 'MUS2',
  pilot_ics: 'PILOT ICS',
  coplt_ics: 'COPLT ICS',
  pass_ics: 'PASS ICS',
  spkr: 'SPKR/PA',
  mkr: 'MKR/MUTE',
  hi_sens: 'HI SENS',
  man_sq: 'MAN SQ',
  play: 'PLAY',
};

/** GMA 1360 audio panel. */
export function gmaControls(): G1kControl[] {
  const E = G1K_EVENTS;
  const out: G1kControl[] = [];
  for (const k of GMA_KEYS) {
    const hold = k === 'spkr' || k === 'pilot_ics';
    out.push({ id: `gma.${k}`, unit: 'gma', kind: 'button', label: GMA_LABELS[k], press: E.gmaKey(k), release: hold ? E.gmaKeyUp(k) : undefined, lightVar: G1K.gmaLight(k), pos: GMA_POS[k] });
  }
  out.push(
    {
      id: 'gma.vol',
      unit: 'gma',
      kind: 'dualKnob',
      label: 'VOL/SQ (inner) - CRSR (outer)',
      incEvent: inc(E.gmaCrsr),
      decEvent: dec(E.gmaCrsr),
      innerIncEvent: inc(E.gmaVol),
      innerDecEvent: dec(E.gmaVol),
      press: E.gmaVolPush,
      release: E.gmaVolPushUp,
      pos: [29, 186],
    },
    { id: 'gma.display_backup', unit: 'gma', kind: 'button', label: 'DISPLAY BACKUP', press: E.displayBackup, lightVar: G1K.displayBackup, pos: [29, 210] },
  );
  return out;
}

/**
 * AFCS switches outside the GDUs (PG §7.1 "AFCS Controls"): control wheel
 * AP DISC / TRIM INTERRUPT (red), CWS, MET (manual electric trim, ARM + UP/DN
 * split switch: wired by the aircraft's trim system), PTT; GA button on the
 * instrument panel above the throttle. Events go to the shared Afcs.
 */
export function afcsExternalControls(): G1kControl[] {
  return [
    { id: 'yoke.ap_disc', unit: 'yoke', kind: 'button', label: 'AP DISC / TRIM INTR', press: 'ap.disc', release: G1K_EVENTS.apDiscHold, pos: [0, 0] },
    // Momentary: the press payload 1 / release payload 0 is the { pressed } state (Afcs payloadBool, System pressedOf).
    { id: 'yoke.cws', unit: 'yoke', kind: 'button', label: 'CWS', press: 'ap.cws', release: 'ap.cws', pos: [0, 0] },
    { id: 'yoke.ptt', unit: 'yoke', kind: 'button', label: 'PTT', press: G1K_EVENTS.ptt, release: G1K_EVENTS.ptt, pos: [0, 0] },
    { id: 'panel.ga', unit: 'panel', kind: 'button', label: 'GA', press: 'ap.toga', lightVar: 'ap.btn_ga', pos: [0, 0] },
  ];
}

/** Every G1000 control of the installation. */
export function g1000Controls(cfg: G1000Resolved): G1kControl[] {
  return [...gduControls(cfg, 'pfd'), ...gduControls(cfg, 'mfd'), ...gmaControls(), ...afcsExternalControls()];
}
