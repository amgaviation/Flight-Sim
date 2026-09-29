/**
 * Global 6000 (Global Vision) audio control panels ACP 1 / ACP 2 (pedestal,
 * aft of the CCPs, either side of the PARK/EMER BRAKE and SLAT/FLAP levers;
 * photo EB190582 crops e_ped_aft / e_ped_l). Per panel:
 *  - transmitter select keys with a lamp above each column (VHF 1, VHF 2,
 *    VHF 3, HF 1, HF 2, SAT, PA): `V.acpMic(s)`;
 *  - receiver knobs, push / pull and turn (pulled out = the receiver is heard,
 *    turned = its volume; GX PTG 5-6 "As many radios frequencies can be
 *    monitored by pulling out appropriate button"): VHF 1-3, HF 1 / 2, SAT, PA,
 *    NAV 1 / 2, ADF 1 / 2, MKR, DME 1 / 2 (`V.acpSel`, `V.acpVol`);
 *  - ID / BOTH / VOICE filter for the NAV audio (GX PTG 5-6: ID = only the
 *    Morse ident, VOICE = only voice, BOTH), MASK (mask microphone), SPKR
 *    (cockpit speaker volume), R/T - IC (radio / interphone key), MKR HI / LO
 *    sensitivity.
 *
 * This block produces the receiver audio the crew uses on every approach:
 *  - NAV 1 / NAV 2 / ADF 1 / ADF 2 Morse idents (1,020 Hz keyed tone, EST
 *    7 words per minute, repeated every 10 s for VOR / LOC and 8 s for NDBs;
 *    AIM 1-1-3) when that receiver's knob is out on either ACP, with the
 *    filter at ID or BOTH; level = the knob volume x the received signal;
 *  - the marker beacon tones (outer / middle / inner) with MKR pulled out,
 *    and the marker receiver sensitivity from ACP 1 (on-side receiver, EST).
 *
 * SCOPE: no COM / HF / SAT voice audio or transmit keying is synthesised
 * (the transmitter select, MASK, SPKR and R/T - IC are state only; the
 * wheel R/T / IC rocker writes V.pttKeyed); DME 1 / 2 idents are not keyed
 * separately (the co-located VOR ident is heard on NAV).
 * Outputs: `V.acpIdentOut(ch)` (instantaneous keyed gain), `V.acpMkrOut`.
 * No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { AudioApi, SimContext } from '../../../core/SimContext';
import { NAV } from '../../../core/vars';
import { G6K_ACP_CH, G6K_VARS as V } from '../vars';

/** Morse dot length (s): 7 wpm with the PARIS standard (1.2 s / wpm). EST from AIM 1-1-3 "about 7 wpm". */
export const IDENT_DOT_S = 1.2 / 7;
const IDENT_GAIN = 0.25; // EST headset mix level at full volume

/** True while the key is down at time `t` (s) into a Morse `pattern` ('.', '-', ' ' between letters). */
export function morseKeyDown(pattern: string, t: number, dot = IDENT_DOT_S): boolean {
  let at = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charCodeAt(i);
    if (c === 32) {
      at += 2 * dot;
      continue;
    }
    const on = c === 45 ? 3 * dot : dot;
    if (t >= at && t < at + on) return true;
    at += on + dot;
    if (t < at) return false;
  }
  return false;
}

type Loop = ReturnType<AudioApi['loop']>;

interface Channel {
  ch: 'nav1' | 'nav2' | 'adf1' | 'adf2';
  sel: [string, string];
  vol: [string, string];
  morse: string;
  valid: string;
  signal: string;
  isNav: boolean;
  period: number;
  out: string;
  t: number;
  gain: number;
  loop: Loop | null;
}

/** Derived ACP outputs: keyed transmitter (-1 none, else the V.acpMic index), interphone keyed, mic source, speaker. */
export const ACP_OUT = {
  txRadio: 'ac.g6k.acp.tx_radio',
  sel1: 'ac.g6k.acp1.tx_sel',
  sel2: 'ac.g6k.acp2.tx_sel',
  ic: 'ac.g6k.acp.ic_keyed',
  micSrc: (s: 1 | 2) => `ac.g6k.acp${s}.mic_src`,
  spkr: 'ac.g6k.acp.spkr_gain',
} as const;

const MIC_SRC = [ACP_OUT.micSrc(1), ACP_OUT.micSrc(2)];
const ACP_RTIC = [V.acpRtIc(1), V.acpRtIc(2)];
const ACP_MIC = [V.acpMic(1), V.acpMic(2)];

const PTT1 = V.yokePtt(1);
const MASK = [V.acpMask(1), V.acpMask(2)];
const SPKR = [V.acpSpkr(1), V.acpSpkr(2)];
const MKR_HI = [V.acpMkrHi(1), V.acpMkrHi(2)];

/** Per-channel monitored level outputs (`ac.g6k.acp.level_<ch>`). */
const LEVEL = G6K_ACP_CH.map((ch) => ({ out: `ac.g6k.acp.level_${ch}`, sel: [V.acpSel(1, ch), V.acpSel(2, ch)], vol: [V.acpVol(1, ch), V.acpVol(2, ch)] }));

const MKR_TONES = [
  { v: NAV.markerOuter, tone: 'marker_outer' },
  { v: NAV.markerMiddle, tone: 'marker_middle' },
  { v: NAV.markerInner, tone: 'marker_inner' },
] as const;

export class G6kAudioControl implements Subsystem {
  readonly name = 'g6k.acp';
  private readonly ch: Channel[];
  private loopsTried = false;
  private readonly toneOn = [false, false, false];
  private readonly filt: [string, string] = [V.acpFilter(1), V.acpFilter(2)];
  private readonly mkrSel: [string, string] = [V.acpSel(1, 'mkr'), V.acpSel(2, 'mkr')];
  private readonly mkrVol: [string, string] = [V.acpVol(1, 'mkr'), V.acpVol(2, 'mkr')];

  constructor(
    private readonly vars: SimContext['vars'],
    private readonly audio: AudioApi | undefined,
  ) {
    const mk = (ch: Channel['ch'], i: 1 | 2, isNav: boolean): Channel => ({
      ch,
      sel: [V.acpSel(1, ch), V.acpSel(2, ch)],
      vol: [V.acpVol(1, ch), V.acpVol(2, ch)],
      morse: isNav ? NAV.morse(i) : NAV.adfMorse(i),
      valid: isNav ? NAV.received(i) : NAV.adfValid(i),
      signal: isNav ? NAV.signal(i) : NAV.adfSignal(i),
      isNav,
      period: isNav ? 10 : 8,
      out: V.acpIdentOut(ch),
      t: 0,
      gain: 0,
      loop: null,
    });
    this.ch = [mk('nav1', 1, true), mk('nav2', 2, true), mk('adf1', 1, false), mk('adf2', 2, false)];
  }

  update(dt: number): void {
    const v = this.vars;
    if (!this.loopsTried && this.audio) {
      this.loopsTried = true;
      for (const c of this.ch) {
        try {
          c.loop = this.audio.loop('ident.1020');
        } catch {
          c.loop = null;
        }
      }
    }
    // ACP power: DC ESS (ACP 1) / BATT BUS (ACP 2), EST (the audio system is essential).
    const p1 = v.get('elec.dc_ess_powered') !== 0;
    const p2 = v.get('elec.batt_bus_powered') !== 0;
    for (let k = 0; k < this.ch.length; k++) {
      const c = this.ch[k];
      let level = 0;
      for (let s = 0; s < 2; s++) {
        if (!(s === 0 ? p1 : p2) || v.get(c.sel[s]) === 0) continue;
        // ID / BOTH / VOICE: the ident is filtered out at VOICE (NAV receivers; the ADF has no filter, EST).
        if (c.isNav && v.get(this.filt[s]) === 2) continue;
        level = Math.max(level, v.get(c.vol[s]));
      }
      if (v.get(c.valid) === 0) level = 0;
      else level *= Math.max(0, Math.min(1, v.get(c.signal, 1)));
      c.t += dt;
      if (c.t >= c.period) c.t -= c.period;
      const pattern = level > 0 ? v.getString(c.morse) : '';
      const g = pattern && morseKeyDown(pattern, c.t) ? level * IDENT_GAIN : 0;
      v.set(c.out, g);
      if (g !== c.gain) {
        c.gain = g;
        c.loop?.setGain(g);
      }
    }
    // Marker beacon audio and receiver sensitivity (ACP 1 MKR HI / LO, EST on-side receiver).
    let mkr = 0;
    for (let s = 0; s < 2; s++) if ((s === 0 ? p1 : p2) && v.get(this.mkrSel[s]) !== 0) mkr = Math.max(mkr, v.get(this.mkrVol[s]));
    v.set(V.acpMkrOut, mkr);
    v.set(NAV.markerHiSens, v.get(p1 ? MKR_HI[0] : MKR_HI[1], 1) !== 0 ? 1 : 0); // ACP 2 when ACP 1 is unpowered (EST)
    this.keying(p1, p2);
    // Monitored audio level per receiver (knob out x volume, either powered ACP): the state output of the COM / HF /
    // SAT / PA / DME knobs (SCOPE: their voice audio is not synthesised).
    for (let k = 0; k < LEVEL.length; k++) {
      const L = LEVEL[k];
      const a = p1 && v.get(L.sel[0]) !== 0 ? v.get(L.vol[0]) : 0;
      const b = p2 && v.get(L.sel[1]) !== 0 ? v.get(L.vol[1]) : 0;
      v.set(L.out, a > b ? a : b);
    }
    for (let i = 0; i < MKR_TONES.length; i++) {
      const on = mkr > 0.02 && v.get(MKR_TONES[i].v) !== 0;
      if (on !== this.toneOn[i]) {
        this.toneOn[i] = on;
        this.audio?.tone(MKR_TONES[i].tone, on);
      }
    }
  }

  /** Transmit / interphone state (SCOPE: no radio transmit model; the keyed radio is the output). */
  private keying(p1: boolean, p2: boolean): void {
    const v = this.vars;
    // Wheel R/T / IC rocker (vision.ts V.pttKeyed) or the ACP R/T - IC toggle; pilot side (ACP 1) has priority.
    const k1 = v.get(ACP_RTIC[0]);
    const k2 = v.get(ACP_RTIC[1]);
    const wheel = v.get(V.pttKeyed);
    const key = wheel !== 0 ? wheel : k1 !== 0 ? k1 : k2;
    const side = wheel !== 0 ? (v.get(PTT1) !== 0 ? 1 : 2) : k1 !== 0 ? 1 : 2;
    const powered = side === 1 ? p1 : p2;
    const mic = v.get(ACP_MIC[side - 1]);
    v.set(ACP_OUT.txRadio, key > 0 && powered ? mic : -1);
    // Selected transmitter per ACP (the lamp above the key), SCOPE: no radio-transmit model.
    v.set(ACP_OUT.sel1, p1 ? v.get(ACP_MIC[0]) : -1);
    v.set(ACP_OUT.sel2, p2 ? v.get(ACP_MIC[1]) : -1);
    v.set(ACP_OUT.ic, key < 0 && powered ? 1 : 0);
    v.set(MIC_SRC[0], v.get(MASK[0]) !== 0 ? 1 : 0);
    v.set(MIC_SRC[1], v.get(MASK[1]) !== 0 ? 1 : 0);
    v.set(ACP_OUT.spkr, Math.max(p1 ? v.get(SPKR[0]) : 0, p2 ? v.get(SPKR[1]) : 0));
  }

  dispose(): void {
    for (const c of this.ch) c.loop?.stop();
    for (let i = 0; i < MKR_TONES.length; i++) if (this.toneOn[i]) this.audio?.tone(MKR_TONES[i].tone, false);
  }
}
