/**
 * MCDU radio and utility pages: RADIO 1/2 and 2/2, MESSAGES, DATALINK,
 * MCDU MENU, STBY ENGINE, BKUP RADIO.
 *
 * G550 OM 2A-23-40 "MCDU Radio Tuning": "RADIO 1/2 page: COM 1 and COM 2,
 * NAV 1 and NAV 2, DME 1 and DME 2, plus transponder code. RADIO 2/2 page:
 * HF 1 and HF 2, ADF 1 and ADF 2, and COM/NAV 3. The current active
 * frequency is displayed in green." code450: "toggling between the RADIO
 * 1/2 and RADIO 2/2 pages with the NEXT or PREV function keys"; COM/NAV3
 * DATA mode ("RADIO -> NEXT -> ... DATA (LSK 2R)").
 * STBY ENGINE / BKUP RADIO pages from the G650ER pedestal photographs
 * (MCDU #1 "STBY ENGINE" digital EPR/N1/TGT/N2/FF; MCDU #3 "BKUP RADIO":
 * COM1, NAV1, "ATC ALT-OFF", "IDENT"); G450: "digital standby engine
 * instruments available via MCDU #1 with battery power only" (code450).
 * Line layout EST. Entry rules: a frequency in the scratchpad goes to the
 * PRESET (standby) field; the active-frequency key swaps active and preset.
 */
import { NAV } from '../../../core/vars';
import { EPIC_VARS } from '../vars';
import type { CduPage, Mcdu } from './mcdu';
import { parseAdfFreq, parseComFreq, parseHfFreq, parseNavFreq, parseSquawk, type LskId } from './cdu';

const XPDR_MODES = ['OFF', 'STBY', 'ON', 'ALT', 'TA ONLY', 'TA/RA'];

function fq(x: number, dec: number): string {
  return x > 0 ? x.toFixed(dec) : '---.--';
}

/** Swap active <-> standby var pair. */
function swap(m: Mcdu, a: string, b: string): void {
  const v = m.vars;
  const x = v.get(a);
  v.set(a, v.get(b));
  v.set(b, x);
  m.invalidate();
}

function enterFreq(m: Mcdu, parse: (s: string) => number, target: string): boolean {
  const t = m.scratch.trim();
  if (!t) return false;
  const f = parse(t);
  if (!Number.isFinite(f)) {
    m.error();
    return true;
  }
  m.take();
  m.vars.set(target, f);
  return true;
}

export const RADIO_PAGE: CduPage = {
  id: 'RADIO',
  refreshS: 0.5,
  pages: () => 2,
  render(m, s, sub) {
    const v = m.vars;
    const sen = m.shared.cfg.sensors;
    s.title = 'RADIO';
    if (sub === 0) {
      s.labelL(1, 'COM1');
      s.dataL(1, fq(v.get(NAV.comActive(1)), 3), 'green');
      s.labelL(2, 'PRESET');
      s.dataL(2, fq(v.get(NAV.comStandby(1)), 3), 'cyan');
      s.labelR(1, 'COM2');
      s.dataR(1, fq(v.get(NAV.comActive(2)), 3), 'green');
      s.labelR(2, 'PRESET');
      s.dataR(2, fq(v.get(NAV.comStandby(2)), 3), 'cyan');
      s.labelL(3, 'NAV1');
      s.dataL(3, fq(v.get(NAV.activeFreq(1)), 2), 'green');
      s.labelL(4, 'PRESET');
      s.dataL(4, fq(v.get(NAV.standbyFreq(1)), 2), 'cyan');
      if (sen.navCount >= 2) {
        s.labelR(3, 'NAV2');
        s.dataR(3, fq(v.get(NAV.activeFreq(2)), 2), 'green');
        s.labelR(4, 'PRESET');
        s.dataR(4, fq(v.get(NAV.standbyFreq(2)), 2), 'cyan');
      }
      s.labelL(5, 'DME1');
      s.dataL(5, v.get(NAV.dmeHold(1)) !== 0 ? 'HOLD' : 'NORM', v.get(NAV.dmeHold(1)) !== 0 ? 'amber' : 'cyan');
      s.labelR(5, 'DME2');
      s.dataR(5, v.get(NAV.dmeHold(2)) !== 0 ? 'HOLD' : 'NORM', v.get(NAV.dmeHold(2)) !== 0 ? 'amber' : 'cyan');
      s.labelL(6, `ATC${v.get(EPIC_VARS.xpdrUnit) === 2 ? '2' : '1'}`);
      s.dataL(6, Math.round(v.get(NAV.xpdrCode)).toString().padStart(4, '0'), 'cyan');
      s.labelR(6, 'TCAS');
      s.dataR(6, XPDR_MODES[v.get(NAV.xpdrMode)] ?? 'STBY', 'cyan');
    } else {
      s.labelL(1, 'HF1');
      s.dataL(1, v.get(EPIC_VARS.hfFreq(1)) > 0 ? (v.get(EPIC_VARS.hfFreq(1)) / 1000).toFixed(3) : '--.---', 'green');
      s.labelR(1, 'HF2');
      s.dataR(1, v.get(EPIC_VARS.hfFreq(2)) > 0 ? (v.get(EPIC_VARS.hfFreq(2)) / 1000).toFixed(3) : '--.---', 'green');
      if (sen.adfCount >= 1) {
        s.labelL(2, 'ADF1');
        s.dataL(2, v.get(NAV.adfActive(1)) > 0 ? v.get(NAV.adfActive(1)).toFixed(1) : '----.-', 'green');
        s.labelL(3, 'PRESET');
        s.dataL(3, v.get(NAV.adfStandby(1)) > 0 ? v.get(NAV.adfStandby(1)).toFixed(1) : '----.-', 'cyan');
      }
      if (sen.adfCount >= 2) {
        s.labelR(2, 'ADF2');
        s.dataR(2, v.get(NAV.adfActive(2)) > 0 ? v.get(NAV.adfActive(2)).toFixed(1) : '----.-', 'green');
        s.labelR(3, 'PRESET');
        s.dataR(3, v.get(NAV.adfStandby(2)) > 0 ? v.get(NAV.adfStandby(2)).toFixed(1) : '----.-', 'cyan');
      }
      if (sen.comCount >= 3) {
        s.labelL(4, 'COM/NAV3');
        s.dataL(4, fq(v.get(NAV.comActive(3)), 3), 'green');
        s.labelL(5, 'PRESET');
        s.dataL(5, fq(v.get(NAV.comStandby(3)), 3), 'cyan');
        s.labelR(4, 'MODE');
        s.dataR(4, v.get(EPIC_VARS.com3Data) !== 0 ? 'DATA' : 'VOICE', 'cyan');
      }
      s.labelR(5, 'XPDR');
      s.dataR(5, v.get(EPIC_VARS.xpdrUnit) === 2 ? 'ATC 2' : 'ATC 1', 'cyan');
    }
  },
  lsk(m, k, sub) {
    const v = m.vars;
    if (sub === 0) {
      switch (k) {
        case 'L1':
          if (!enterFreq(m, parseComFreq, NAV.comActive(1))) swap(m, NAV.comActive(1), NAV.comStandby(1));
          return;
        case 'L2':
          if (!enterFreq(m, parseComFreq, NAV.comStandby(1))) swap(m, NAV.comActive(1), NAV.comStandby(1));
          return;
        case 'R1':
          if (!enterFreq(m, parseComFreq, NAV.comActive(2))) swap(m, NAV.comActive(2), NAV.comStandby(2));
          return;
        case 'R2':
          if (!enterFreq(m, parseComFreq, NAV.comStandby(2))) swap(m, NAV.comActive(2), NAV.comStandby(2));
          return;
        case 'L3':
          if (!enterFreq(m, parseNavFreq, NAV.activeFreq(1))) swap(m, NAV.activeFreq(1), NAV.standbyFreq(1));
          return;
        case 'L4':
          if (!enterFreq(m, parseNavFreq, NAV.standbyFreq(1))) swap(m, NAV.activeFreq(1), NAV.standbyFreq(1));
          return;
        case 'R3':
          if (!enterFreq(m, parseNavFreq, NAV.activeFreq(2))) swap(m, NAV.activeFreq(2), NAV.standbyFreq(2));
          return;
        case 'R4':
          if (!enterFreq(m, parseNavFreq, NAV.standbyFreq(2))) swap(m, NAV.activeFreq(2), NAV.standbyFreq(2));
          return;
        case 'L5':
          v.set(NAV.dmeHold(1), v.get(NAV.dmeHold(1)) !== 0 ? 0 : 1);
          m.invalidate();
          return;
        case 'R5':
          v.set(NAV.dmeHold(2), v.get(NAV.dmeHold(2)) !== 0 ? 0 : 1);
          m.invalidate();
          return;
        case 'L6': {
          const t = m.scratch.trim();
          if (!t) return;
          const c = parseSquawk(t);
          if (!Number.isFinite(c)) return m.error();
          m.take();
          v.set(NAV.xpdrCode, c);
          return;
        }
        case 'R6': {
          // STBY -> ALT -> TA ONLY -> TA/RA -> STBY
          const cur = v.get(NAV.xpdrMode);
          v.set(NAV.xpdrMode, cur === 1 ? 3 : cur === 3 ? 4 : cur === 4 ? 5 : 1);
          m.invalidate();
          return;
        }
      }
      return;
    }
    switch (k) {
      case 'L1':
      case 'R1': {
        const r = k === 'L1' ? 1 : 2;
        enterFreq(m, parseHfFreq, EPIC_VARS.hfFreq(r));
        return;
      }
      case 'L2':
        if (!enterFreq(m, parseAdfFreq, NAV.adfActive(1))) swap(m, NAV.adfActive(1), NAV.adfStandby(1));
        return;
      case 'L3':
        if (!enterFreq(m, parseAdfFreq, NAV.adfStandby(1))) swap(m, NAV.adfActive(1), NAV.adfStandby(1));
        return;
      case 'R2':
        if (!enterFreq(m, parseAdfFreq, NAV.adfActive(2))) swap(m, NAV.adfActive(2), NAV.adfStandby(2));
        return;
      case 'R3':
        if (!enterFreq(m, parseAdfFreq, NAV.adfStandby(2))) swap(m, NAV.adfActive(2), NAV.adfStandby(2));
        return;
      case 'L4':
        if (!enterFreq(m, parseComFreq, NAV.comActive(3))) swap(m, NAV.comActive(3), NAV.comStandby(3));
        return;
      case 'L5':
        if (!enterFreq(m, parseComFreq, NAV.comStandby(3))) swap(m, NAV.comActive(3), NAV.comStandby(3));
        return;
      case 'R4':
        v.set(EPIC_VARS.com3Data, v.get(EPIC_VARS.com3Data) !== 0 ? 0 : 1);
        m.invalidate();
        return;
      case 'R5':
        v.set(EPIC_VARS.xpdrUnit, v.get(EPIC_VARS.xpdrUnit) === 2 ? 1 : 2);
        m.invalidate();
        return;
    }
  },
};

export const MSG_PAGE: CduPage = {
  id: 'MSG',
  refreshS: 0.5,
  render(m, s) {
    s.title = 'MESSAGES';
    const list = m.shared.messages;
    if (!list.length) s.dataC(2, 'NO MESSAGES', 'white', true);
    for (let i = 0; i < Math.min(5, list.length); i++) s.dataL(i + 1, list[i], i === 0 ? 'amber' : 'white');
    s.dataL(6, '<CLEAR ALL', 'white');
  },
  lsk(m, k) {
    const list = m.shared.messages;
    if (k === 'L6') {
      list.length = 0;
      m.shared.version++;
      return;
    }
    const i = Number(k[1]) - 1;
    if (k[0] === 'L' && i < list.length) {
      list.splice(i, 1);
      m.shared.version++;
    }
  },
};

export const DLK_PAGE: CduPage = {
  id: 'DLK',
  refreshS: 0,
  render(_m, s) {
    s.title = 'DATALINK INDEX';
    s.dataL(1, '<ATC', 'white');
    s.dataL(2, '<AOC', 'white');
    s.dataL(3, '<FPL/WINDS', 'white');
    s.dataL(4, '<WEATHER', 'white');
    s.dataC(6, 'SATCOM/VDL NOT CONNECTED', 'amber', true);
  },
  lsk(m) {
    // SCOPE: no datalink service is simulated.
    m.shared.post('DATALINK NOT AVAILABLE');
  },
};

export const MENU_PAGE: CduPage = {
  id: 'MENU',
  refreshS: 0,
  render(_m, s) {
    s.title = 'MCDU MENU';
    s.dataL(1, '<FMS', 'white');
    s.dataL(2, '<STBY ENGINE', 'white');
    s.dataL(3, '<BKUP RADIO', 'white');
    s.dataL(4, '<NAV INDEX', 'white');
    s.dataR(1, 'DATALINK>', 'white');
  },
  lsk(m, k) {
    const map: Partial<Record<LskId, string>> = { L1: 'FPL', L2: 'STBY_ENG', L3: 'BKUP_RADIO', L4: 'NAV_INDEX', R1: 'DLK' };
    const id = map[k];
    if (id) m.show(id);
  },
};

export const STBY_ENGINE_PAGE: CduPage = {
  id: 'STBY_ENG',
  refreshS: 0.5,
  render(m, s) {
    const v = m.vars;
    const e = m.shared.cfg.engines;
    const ev = e.vars;
    s.title = 'STBY ENGINE';
    const row = (k: number, label: string, l: string, r: string, lc: 'green' | 'amber' | 'red' = 'green', rc: 'green' | 'amber' | 'red' = 'green'): void => {
      s.dataL(k, l, lc);
      s.dataC(k, label, 'white', true);
      s.dataR(k, r, rc);
    };
    const epr = (i: number): number => (v.has(ev.epr(i)) ? v.get(ev.epr(i)) : e.eprFromN1(v.get(ev.n1(i))));
    const L = e.limits;
    const tgtC = (x: number): 'green' | 'amber' | 'red' => (x > L.tgtMaxTakeoffC ? 'red' : x > L.tgtMaxContC ? 'amber' : 'green');
    const oilC = (x: number): 'green' | 'amber' | 'red' => (x < L.oilPressMinPsi ? 'red' : x < L.oilPressNormalPsi ? 'amber' : 'green');
    row(1, 'EPR', epr(1).toFixed(2), epr(2).toFixed(2));
    row(2, 'N1', v.get(ev.n1(1)).toFixed(1), v.get(ev.n1(2)).toFixed(1));
    const t1 = v.get(ev.tgt(1));
    const t2 = v.get(ev.tgt(2));
    row(3, 'TGT', Math.round(t1).toString(), Math.round(t2).toString(), tgtC(t1), tgtC(t2));
    row(4, 'N2', v.get(ev.n2(1)).toFixed(1), v.get(ev.n2(2)).toFixed(1));
    row(5, 'FF', Math.round(v.get(ev.ff(1))).toString(), Math.round(v.get(ev.ff(2))).toString());
    const o1 = v.get(ev.oilPress(1));
    const o2 = v.get(ev.oilPress(2));
    row(6, 'OIL P', Math.round(o1).toString(), Math.round(o2).toString(), oilC(o1), oilC(o2));
  },
};

export const BKUP_RADIO_PAGE: CduPage = {
  id: 'BKUP_RADIO',
  refreshS: 0.5,
  render(m, s) {
    const v = m.vars;
    s.title = 'BKUP RADIO';
    s.labelL(1, 'COM1');
    s.dataL(1, fq(v.get(NAV.comActive(1)), 3), 'green');
    s.labelL(2, 'PRESET');
    s.dataL(2, fq(v.get(NAV.comStandby(1)), 3), 'cyan');
    s.labelR(1, 'NAV1');
    s.dataR(1, fq(v.get(NAV.activeFreq(1)), 2), 'green');
    s.labelR(2, 'PRESET');
    s.dataR(2, fq(v.get(NAV.standbyFreq(1)), 2), 'cyan');
    s.labelL(4, 'ATC');
    s.dataL(4, Math.round(v.get(NAV.xpdrCode)).toString().padStart(4, '0'), 'cyan');
    const mode = v.get(NAV.xpdrMode);
    s.dataL(6, mode >= 3 ? 'ATC ALT-ON' : 'ATC ALT-OFF', 'cyan');
    s.dataR(6, 'IDENT', v.get(NAV.xpdrIdent) !== 0 ? 'green' : 'white');
  },
  lsk(m, k) {
    const v = m.vars;
    switch (k) {
      case 'L1':
        if (!enterFreq(m, parseComFreq, NAV.comActive(1))) swap(m, NAV.comActive(1), NAV.comStandby(1));
        return;
      case 'L2':
        if (!enterFreq(m, parseComFreq, NAV.comStandby(1))) swap(m, NAV.comActive(1), NAV.comStandby(1));
        return;
      case 'R1':
        if (!enterFreq(m, parseNavFreq, NAV.activeFreq(1))) swap(m, NAV.activeFreq(1), NAV.standbyFreq(1));
        return;
      case 'R2':
        if (!enterFreq(m, parseNavFreq, NAV.standbyFreq(1))) swap(m, NAV.activeFreq(1), NAV.standbyFreq(1));
        return;
      case 'L4': {
        const t = m.scratch.trim();
        if (!t) return;
        const c = parseSquawk(t);
        if (!Number.isFinite(c)) return m.error();
        m.take();
        v.set(NAV.xpdrCode, c);
        return;
      }
      case 'L6': {
        const mode = v.get(NAV.xpdrMode);
        v.set(NAV.xpdrMode, mode >= 3 ? 2 : 3);
        m.invalidate();
        return;
      }
      case 'R6':
        v.set(NAV.xpdrIdent, 1);
        v.set('epic.xpdr.ident_s', 18); // IDENT lasts ~18 s (EST, typical Mode S transponder)
        m.invalidate();
        return;
    }
  },
};

export const RADIO_PAGES: readonly CduPage[] = [RADIO_PAGE, MSG_PAGE, DLK_PAGE, MENU_PAGE, STBY_ENGINE_PAGE, BKUP_RADIO_PAGE];
