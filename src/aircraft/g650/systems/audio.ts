/**
 * Gulfstream G650 audio control panels (pilot / copilot side consoles; added with the overhead / side
 * console build). PlaneView II audio system (Honeywell Primus Epic ACPs, LUC electrical: ACPs on the
 * emergency / flight instrument buses, so they work on the emergency batteries).
 *
 * Each ACP has a transmitter (MIC) select - VHF 1, VHF 2, VHF 3, HF 1, HF 2, PA - and receiver volume knobs
 * for VHF 1-3, NAV 1-2, ADF and MKR (EST layout). This subsystem publishes the selected transmitter and the
 * receiver audio levels (volume x ACP power x receiver power) for each side.
 * The yoke MIC / INT rocker (`V.acpPtt`, main cockpit) keys the selected transmitter or the intercom
 * (`V.acpKeyed`).
 * SCOPE: the app synthesises no radio / ident audio, so these outputs are state only (shown on the ACP
 * keys and in tooltips); VHF 3 and the HF radios are not modelled as receivers (they follow the ACP power).
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import { ACP_CHANNELS, G650_VARS as V } from '../vars';

/** Receiver power per channel (NAV/COM 1 on the emergency bus = backup radio, LUC; EST mapping). */
const RX_POWER: Record<(typeof ACP_CHANNELS)[number], string> = {
  vhf1: 'elec.nav1_powered',
  vhf2: 'elec.nav2_powered',
  vhf3: 'elec.acp_powered',
  nav1: 'elec.nav1_powered',
  nav2: 'elec.nav2_powered',
  adf: 'elec.adf_powered',
  mkr: 'elec.nav1_powered',
};

export class G650AudioPanels implements Subsystem {
  readonly name = 'g650.audio_panels';
  private readonly names: { mic: string; tx: string; ptt: string; keyed: string; vol: string[]; rx: string[] }[];

  constructor(private readonly v: SimVars) {
    this.names = ([1, 2] as const).map((n) => ({
      mic: V.acpMic(n),
      tx: V.acpTx(n),
      ptt: V.acpPtt(n),
      keyed: V.acpKeyed(n),
      vol: ACP_CHANNELS.map((ch) => V.acpVol(n, ch)),
      rx: ACP_CHANNELS.map((ch) => V.acpRx(n, ch)),
    }));
  }

  update(): void {
    const v = this.v;
    const pwr = v.get('elec.acp_powered') !== 0;
    for (const s of this.names) {
      const tx = pwr ? v.get(s.mic) : 0;
      v.set(s.tx, tx);
      // Yoke MIC / INT rocker (main cockpit build): MIC keys the ACP-selected transmitter, INT the intercom.
      const ptt = v.get(s.ptt);
      v.set(s.keyed, !pwr ? 0 : ptt > 0 ? tx : ptt < 0 ? -1 : 0);
      for (let i = 0; i < ACP_CHANNELS.length; i++) {
        const rxOn = pwr && v.get(RX_POWER[ACP_CHANNELS[i]]) !== 0;
        v.set(s.rx[i], rxOn ? Math.max(0, Math.min(1, v.get(s.vol[i]))) : 0);
      }
    }
  }
}
