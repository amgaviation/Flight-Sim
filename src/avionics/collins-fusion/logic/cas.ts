/**
 * Bombardier EICAS crew alerting for the Global Vision EICAS window.
 *
 * Colours (Bombardier convention, Global Express training manuals: "red
 * warning message", amber caution, cyan advisory, "white status message";
 * 14 CFR 25.1322): warning red, caution amber, advisory cyan, status white.
 * Order: warnings, cautions, advisories, status; newest first within a level
 * (CasModel). New warnings and cautions flash (inverse video) until the
 * MASTER WARNING / MASTER CAUTION switch acknowledges them (EST, the CasModel
 * behaviour shared by the other suites). Warnings are never scrolled off
 * (EST, Epic / G1000 rule); the rest of the list scrolls with the MKP CAS
 * keys and a "n MSGS" indicator shows messages hidden below (EST).
 *
 * The EICAS window cannot be reached by the cursor (AIN 2012), so scrolling
 * is done from the MKP (EST key placement).
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { CasModel, type CasLevel, type CasMessage } from '../../common/draw/CasWindow';
import { FUSION_VARS } from '../vars';

export const CAS_COLORS: Readonly<Record<CasLevel, string>> = {
  warning: '#ff2020',
  caution: '#ffb000',
  advisory: '#00f0ff',
  status: '#ffffff',
};

export class FusionCas {
  /** Register as a CasManager sink: `casManager.addSink(suite.cas.model)`. */
  readonly model = new CasModel(['warning', 'caution']);
  /** Rows available for non-warning messages (set by the EICAS window). */
  rows = 14;
  private scroll = 0;
  private readonly visible: CasMessage[] = [];
  private hiddenBelow = 0;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly vars: SimVars,
    events?: EventBus | null,
  ) {
    if (events) {
      // The standard master switches (CasManager also acknowledges its own list).
      this.offs.push(
        events.on('cas.ack_warning', () => this.model.acknowledge('warning')),
        events.on('cas.ack_caution', () => this.model.acknowledge('caution')),
        events.on('cas.ack', () => this.model.acknowledgeAll()),
      );
    }
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  /** Scrolls the non-warning part of the list by `rows` (+ = down). */
  scrollBy(rows: number): void {
    const list = this.model.list;
    const nonWarn = list.length - countLevel(list, 'warning');
    const warn = Math.min(list.length - nonWarn, this.rows);
    const room = Math.max(1, this.rows - warn);
    const max = Math.max(0, nonWarn - room);
    this.scroll = Math.max(0, Math.min(max, this.scroll + rows));
    this.vars.set(FUSION_VARS.casScroll, this.scroll);
  }

  /**
   * Messages to draw this frame (reused array): all warnings, then the
   * scrolled window of the other levels. `hiddenAbove` / `hiddenBelow` give
   * the counts for the scroll indicators.
   */
  view(): readonly CasMessage[] {
    const list = this.model.list;
    const out = this.visible;
    out.length = 0;
    let warn = 0;
    for (const m of list) if (m.level === 'warning' && out.length < this.rows) {
      out.push(m);
      warn++;
    }
    const nonWarn = list.length - countLevel(list, 'warning');
    const room = this.rows - warn;
    // Clamp the scroll offset if the list shrank.
    const max = Math.max(0, nonWarn - Math.max(1, room));
    if (this.scroll > max) this.scroll = max;
    let skipped = 0;
    let shown = 0;
    for (const m of list) {
      if (m.level === 'warning') continue;
      if (skipped < this.scroll) {
        skipped++;
        continue;
      }
      if (shown >= room) break;
      out.push(m);
      shown++;
    }
    this.hiddenBelow = Math.max(0, nonWarn - this.scroll - shown);
    this.vars.set(FUSION_VARS.casHiddenBelow, this.hiddenBelow);
    return out;
  }

  get hiddenAbove(): number {
    return this.scroll;
  }

  get hiddenBelowCount(): number {
    return this.hiddenBelow;
  }

  /** Newest unacknowledged caution / warning (for the CAS-linked checklist). */
  newestUnacked(): CasMessage | null {
    let best: CasMessage | null = null;
    for (const m of this.model.list) {
      if (m.acknowledged || (m.level !== 'warning' && m.level !== 'caution')) continue;
      if (!best || m.seq > best.seq) best = m;
    }
    return best;
  }

  /** Newest active message of the list with a linked checklist, if any. */
  newestLinked(links: Readonly<Record<string, string>>): CasMessage | null {
    let best: CasMessage | null = null;
    for (const m of this.model.list) {
      if (!links[m.id]) continue;
      if (!best || m.seq > best.seq) best = m;
    }
    return best;
  }
}

function countLevel(list: readonly CasMessage[], level: CasLevel): number {
  let n = 0;
  for (const m of list) if (m.level === level) n++;
  return n;
}

/**
 * Published Global Express / Global EICAS message texts (Global Express
 * "Electrical", "Hydraulics", "Fuel System" and "Airplane General" training
 * manuals). Levels are EST (the manuals group them by colour figures that do
 * not survive text extraction); the aircraft module defines the conditions.
 */
export const GLOBAL_CAS_TEXTS: readonly { id: string; text: string; level: CasLevel }[] = [
  { id: 'emer_pwr_only', text: 'EMER PWR ONLY', level: 'caution' },
  { id: 'ac_bus1_fail', text: 'AC BUS 1 FAIL', level: 'caution' },
  { id: 'ac_bus2_fail', text: 'AC BUS 2 FAIL', level: 'caution' },
  { id: 'ac_bus3_fail', text: 'AC BUS 3 FAIL', level: 'caution' },
  { id: 'ac_bus4_fail', text: 'AC BUS 4 FAIL', level: 'caution' },
  { id: 'ac_ess_bus_fail', text: 'AC ESS BUS FAIL', level: 'caution' },
  { id: 'gen1_ovld', text: 'GEN 1 OVLD', level: 'caution' },
  { id: 'gen2_ovld', text: 'GEN 2 OVLD', level: 'caution' },
  { id: 'gen3_ovld', text: 'GEN 3 OVLD', level: 'caution' },
  { id: 'gen4_ovld', text: 'GEN 4 OVLD', level: 'caution' },
  { id: 'elec_sys_fail', text: 'ELEC SYS FAIL', level: 'caution' },
  { id: 'dc_bus1_fail', text: 'DC BUS 1 FAIL', level: 'caution' },
  { id: 'dc_bus2_fail', text: 'DC BUS 2 FAIL', level: 'caution' },
  { id: 'dc_ess_bus_fail', text: 'DC ESS BUS FAIL', level: 'caution' },
  { id: 'batt_bus_fail', text: 'BATT BUS FAIL', level: 'caution' },
  { id: 'dc_emer_bus_fail', text: 'DC EMER BUS FAIL', level: 'caution' },
  { id: 'batt_master_off', text: 'BATT MASTER OFF', level: 'caution' },
  { id: 'apu_batt_fail', text: 'APU BATT FAIL', level: 'caution' },
  { id: 'av_batt_fail', text: 'AV BATT FAIL', level: 'caution' },
  { id: 'gen1_fail', text: 'GEN 1 FAIL', level: 'advisory' },
  { id: 'gen2_fail', text: 'GEN 2 FAIL', level: 'advisory' },
  { id: 'gen3_fail', text: 'GEN 3 FAIL', level: 'advisory' },
  { id: 'gen4_fail', text: 'GEN 4 FAIL', level: 'advisory' },
  { id: 'apu_gen_fail', text: 'APU GEN FAIL', level: 'advisory' },
  { id: 'tru1_fail', text: 'TRU 1 FAIL', level: 'advisory' },
  { id: 'tru2_fail', text: 'TRU 2 FAIL', level: 'advisory' },
  { id: 'ess_tru1_fail', text: 'ESS TRU 1 FAIL', level: 'advisory' },
  { id: 'ess_tru2_fail', text: 'ESS TRU 2 FAIL', level: 'advisory' },
  { id: 'rat_gen_on', text: 'RAT GEN ON', level: 'advisory' },
  { id: 'ext_ac_avail', text: 'EXT AC PWR AVAIL', level: 'status' },
  { id: 'ext_ac_on', text: 'EXT AC PWR ON', level: 'status' },
  { id: 'gen1_off', text: 'GEN 1 OFF', level: 'status' },
  { id: 'gen2_off', text: 'GEN 2 OFF', level: 'status' },
  { id: 'gen3_off', text: 'GEN 3 OFF', level: 'status' },
  { id: 'gen4_off', text: 'GEN 4 OFF', level: 'status' },
  { id: 'apu_gen_off', text: 'APU GEN OFF', level: 'status' },
  { id: 'l_hyd_sov_clsd', text: 'L HYD SOV CLSD', level: 'status' }, // Hydraulics manual: "white status message"
  { id: 'r_hyd_sov_clsd', text: 'R HYD SOV CLSD', level: 'status' },
  { id: 'config_stab_trim', text: 'CONFIG STAB TRIM', level: 'warning' }, // Flight Controls manual: "red warning message"
  { id: 'config_ail_trim', text: 'CONFIG AIL TRIM', level: 'warning' },
  { id: 'config_rud_trim', text: 'CONFIG RUD TRIM', level: 'warning' },
  { id: 'passenger_door', text: 'PASSENGER DOOR', level: 'caution' },
  { id: 'cargo_door', text: 'CARGO DOOR', level: 'caution' },
  { id: 'emer_exit_door', text: 'EMER EXIT DOOR', level: 'caution' },
  { id: 'l_eng_flameout', text: 'L ENG FLAMEOUT', level: 'caution' },
  { id: 'r_eng_flameout', text: 'R ENG FLAMEOUT', level: 'caution' },
];
