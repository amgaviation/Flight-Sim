/**
 * Bendix/King KMA 28 audio selector panel, intercom and marker beacon receiver
 * (POH 172SPHUS Supplement 20, Figure 1 sheets 1-5).
 *
 *  - Receiver audio: ten latched push buttons COM 1, COM 2, NAV 1, NAV 2, MKR, ADF, DME, AUX,
 *    SPR (speaker) and ICS (crew intercom / music mute), each with a green annunciator
 *    (item 3, 7, 8). The mic selector (item 4) COM 3 / COM 2 / COM 1 / COM 1/2 / COM 2/1 / TEL
 *    selects the transmitter and automatically supplies its receiver audio; the COM LED blinks
 *    while transmitting (item 4). TEL and COM 3 are not installed (Supplement 20: "The
 *    telephone mode is not available on this installation"; no COM 3 in the 172S).
 *  - Marker beacon receiver with O (blue) / M (amber) / I (white) lamps (item 1); HI / LO /
 *    T/M switch (item 2): T/M lights all three lamps and mutes the marker audio until the next
 *    beacon. Photocell dimming of the lamps and button annunciators (item 9).
 *  - Volume / power / EMG knob (item 11): pushed OFF = emergency mode, the pilot's mic and
 *    headset are connected directly to COM 1; audio amplifier off, so system alerts (autopilot
 *    disconnect tone) are not heard and the marker receiver and lamps are inoperative
 *    (Supplement 20 NOTE and Section 2 limitation 1).
 *  - Intercom mode ISO / ALL / CREW (item 10), intercom volume (outer ring of item 11).
 *
 * Power: POH Fig 7-7A legend (2) "all others" (NAV II): the audio panel is on the NAV/COM 2
 * breaker (avionics bus 2).
 *
 * Marker tones (400 / 1300 / 3000 Hz, AIM 1-1-9 / Supplement 20 "Marker facilities") are
 * played through the audio engine's marker tones while MKR is selected and not muted.
 * The NAV 1 / NAV 2 / ADF selections gate the Morse ident audio (receiverAudio.ts).
 * SCOPE: receiver voice audio, the intercom (VOX, isolation, entertainment soft mute) and split
 * COM 1/2 transmission are not synthesised; the selections are tracked and shown.
 */
import type { Subsystem } from '../../types';
import type { AudioApi, SimContext } from '../../../core/SimContext';
import { NAV } from '../../../core/vars';
import { KMA, KMA_BUTTONS, KMA_MIC, ST, type KmaButton } from '../vars';

/** Photocell: annunciator brightness at night (EST, Supplement 20 item 9 automatic dimming). */
const NIGHT_BRIGHTNESS = 0.35;
/** COM LED blink rate while transmitting (EST ~2 Hz). */
const TX_BLINK_HZ = 2;

export class Kma28Logic implements Subsystem {
  readonly name = 'kma28';
  on = false;
  /** Transmitting radio (0 none, 1 COM 1, 2 COM 2). */
  txCom = 0;
  private t = 0;
  private muted = false;
  private lastMkr = 0;
  private readonly tones = { outer: false, middle: false, inner: false };
  private readonly selNames: string[];
  private readonly ledNames: string[];

  constructor(
    private readonly vars: SimContext['vars'],
    private readonly audio: AudioApi | undefined,
    private readonly powerVar: string,
  ) {
    this.selNames = KMA_BUTTONS.map((b) => KMA.sel(b));
    this.ledNames = KMA_BUTTONS.map((b) => KMA.led(b));
  }

  update(dt: number): void {
    const v = this.vars;
    this.t += dt;
    const on = v.get(this.powerVar) > 0.5 && v.get(KMA.power, 1) > 0.5;
    this.on = on;
    v.set(KMA.on, on ? 1 : 0);
    // Intercom (items 10, 11). SCOPE: no intercom audio is synthesised; the pilot's intercom level and
    // whether the pilot hears the intercom (ISO isolates him, Supplement 20 Fig 1 sheet 4) are published.
    v.set('ac.kma28.ics_level', on ? v.get(KMA.icsVol) : 0);
    v.set('ac.kma28.pilot_hears_ics', on && Math.round(v.get(KMA.icsMode)) !== 1 ? 1 : 0);
    // AUX: the AUX AUDIO IN jack on the pedestal (VH-SPQ photograph) feeds the AUX input. SCOPE: no
    // entertainment audio is synthesised; the level the headsets would get is published.
    const auxPlugged = v.get(ST.auxJack) > 0.5;
    v.set(KMA.auxLevel, on && auxPlugged && v.get(KMA.sel('aux')) > 0.5 ? v.get(KMA.icsVol) : 0);
    // Swap indicator (item 5): Supplement 20 "The swap function is not available on this
    // installation", so the lamp stays dark.
    v.set(KMA.swapLamp, 0);
    const ptt = v.get(ST.pttPilot) > 0.5 || v.get(ST.pttHandMic) > 0.5;
    const pttCo = v.get(ST.pttCopilot) > 0.5;
    const mic = Math.round(v.get(KMA.mic, KMA_MIC.com1));
    // Transmitter selection. EMG: pilot straight to COM 1 (item 11). COM 1/2 split: pilot COM 1,
    // copilot COM 2; COM 2/1 the reverse (item 4 "SPLIT MODE"); pilot PTT has priority.
    let tx = 0;
    if (!on) tx = ptt ? 1 : 0;
    else if (ptt || pttCo) {
      if (mic === KMA_MIC.com1) tx = 1;
      else if (mic === KMA_MIC.com2) tx = 2;
      else if (mic === KMA_MIC.com12) tx = ptt ? 1 : 2;
      else if (mic === KMA_MIC.com21) tx = ptt ? 2 : 1;
      else tx = 0; // COM 3 / TEL: not installed
    }
    this.txCom = tx;
    v.set(KMA.txCom, tx);
    v.set(KMA.txLamp, on && tx > 0 ? 1 : 0);

    // Photocell dimming of lamps and annunciators.
    const bright = v.get('env.ambient_light', 1) > 0.35 ? 1 : NIGHT_BRIGHTNESS;
    const blink = Math.floor(this.t * TX_BLINK_HZ * 2) % 2 === 0;
    for (let i = 0; i < KMA_BUTTONS.length; i++) {
      const id: KmaButton = KMA_BUTTONS[i];
      let sel = v.get(this.selNames[i]) > 0.5;
      // The mic selector supplies its COM audio automatically (item 4).
      if (id === 'com1' && (mic === KMA_MIC.com1 || mic === KMA_MIC.com12 || mic === KMA_MIC.com21)) sel = true;
      if (id === 'com2' && (mic === KMA_MIC.com2 || mic === KMA_MIC.com12 || mic === KMA_MIC.com21)) sel = true;
      let lit = on && sel;
      if (lit && ((id === 'com1' && tx === 1) || (id === 'com2' && tx === 2))) lit = blink;
      v.set(this.ledNames[i], lit ? bright : 0);
    }

    // Marker beacon receiver (power, sensitivity, lamps, audio).
    const sens = Math.round(v.get(KMA.mkrSens, 1));
    v.set(NAV.markerPowered, on ? 1 : 0);
    v.set(NAV.markerHiSens, sens === 1 ? 1 : 0);
    const test = on && sens === -1;
    const o = v.get(NAV.markerOuter) > 0.5;
    const m = v.get(NAV.markerMiddle) > 0.5;
    const inn = v.get(NAV.markerInner) > 0.5;
    const any = o || m || inn ? 1 : 0;
    // T/M mutes the audio of the beacon being received; the next beacon is heard again.
    if (test && any) this.muted = true;
    if (!any && this.lastMkr) this.muted = false;
    this.lastMkr = any;
    // Lamps blink with the keyed identifying tone (Supplement 20 "Marker facilities" footnote).
    const kO = Math.floor(this.t * 2 * 2) % 2 === 0; // 2 dashes/s
    const kM = Math.floor(this.t * 3.2) % 2 === 0; // dots and dashes
    const kI = Math.floor(this.t * 6 * 2) % 2 === 0; // 6 dots/s
    v.set(KMA.lampOuter, on && (test || (o && kO)) ? bright : 0);
    v.set(KMA.lampMiddle, on && (test || (m && kM)) ? bright : 0);
    v.set(KMA.lampInner, on && (test || (inn && kI)) ? bright : 0);
    const mkrAudio = on && v.get(KMA.sel('mkr')) > 0.5 && !this.muted && !test;
    this.tone('outer', 'marker_outer', mkrAudio && o);
    this.tone('middle', 'marker_middle', mkrAudio && m);
    this.tone('inner', 'marker_inner', mkrAudio && inn);
  }

  private tone(key: 'outer' | 'middle' | 'inner', id: string, on: boolean): void {
    if (this.tones[key] === on) return;
    this.tones[key] = on;
    this.audio?.tone(id, on);
  }

  reset(): void {
    this.muted = false;
  }

  dispose(): void {
    this.tone('outer', 'marker_outer', false);
    this.tone('middle', 'marker_middle', false);
    this.tone('inner', 'marker_inner', false);
  }
}

/**
 * An AudioApi that drops alert tones and callouts while the KMA 28 is OFF/EMG (Supplement 20:
 * "the audio is disabled preventing installed system alerts (autopilot disconnect tone) from
 * being heard"). Engine/cockpit sounds (play/loop) pass through.
 */
export function gatedAlertAudio(audio: AudioApi | undefined, vars: SimContext['vars']): AudioApi | undefined {
  if (!audio) return undefined;
  const active = new Set<string>();
  const kmaOn = (): boolean => vars.get(KMA.on, 1) > 0.5;
  return {
    play: (id, opts) => audio.play(id, opts),
    loop: (id) => audio.loop(id),
    callout: (text, p) => {
      if (kmaOn()) audio.callout(text, p);
    },
    tone: (id, on) => {
      const eff = on && kmaOn();
      if (eff) active.add(id);
      else active.delete(id);
      audio.tone(id, eff);
    },
  };
}
