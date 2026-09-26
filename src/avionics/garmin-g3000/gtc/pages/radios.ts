/**
 * NAV/COM screens: COM / NAV / ADF frequency keypads (G3000 PG §4.2 "COM
 * Frequency Tuning", §4.3 "NAV Radio Tuning": type digits, Enter loads the
 * standby, XFER swaps; Find lists nearby / flight plan airport frequencies),
 * Transponder (code keypad 0-7, VFR, STBY / ON / ALT, TA ONLY / TA/RA with
 * TCAS II, IDENT; §4.4) and Audio & Radios (MIC / MON per COM, NAV / DME /
 * ADF / marker audio, speaker, volume; §4.1 "Audio Panel").
 */
import type { Rect } from '../../../common/draw/context';
import { distanceNm } from '../../../../core/geo';
import { GPS, NAV } from '../../../../core/vars';
import { fmtAdf, fmtCom, fmtNav, fmtSquawk } from '../../format';
import { G3K, vn } from '../../vars';
import { XPDR_MODE_LABELS, parseAdfDigits, parseComDigits, parseNavDigits, parseSquawk, VFR_CODE } from '../../state/radios';
import type { GtcController } from '../GtcController';
import { GtcPage } from '../GtcPage';
import { ListSelectPage, NumericKeypadPage, type ListItem } from './keypads';

/** Formats keypad digits as a frequency with `intDigits` before the point ('1182' -> '118.2_'). */
export function formatFreqBuf(buf: string, intDigits: number, fracDigits: number): string {
  const d = buf.replace(/[^0-9]/g, '');
  let s = '';
  for (let i = 0; i < intDigits + fracDigits; i++) {
    if (i === intDigits) s += '.';
    s += d[i] ?? '_';
  }
  return s;
}

/** COM standby tuning keypad with XFER and Find. */
export function comKeypad(gtc: GtcController, r: 1 | 2): NumericKeypadPage {
  const sys = gtc.sys;
  const w833 = (): boolean => sys.vars.get(G3K.comSpacing833) >= 0.5;
  return new NumericKeypadPage(gtc, {
    title: r === 1 ? 'COM1 Standby' : 'COM2 Standby',
    initial: () => fmtCom(sys.comStandby(r), w833()),
    maxDigits: 6,
    format: (b) => formatFreqBuf(b, 3, w833() ? 3 : 2),
    onEnter: (b) => {
      const f = parseComDigits(b, w833());
      if (!Number.isFinite(f)) return false;
      sys.setComStandby(r, f);
      return true;
    },
    extra: [
      { label: 'XFER', value: () => fmtCom(sys.comActive(r), w833()), valueColor: '#00e000', onPress: () => sys.swapCom(r) },
      { label: 'Find', icon: 'nearest', onPress: () => gtc.push(findFreqPage(gtc, 'com', r)) },
    ],
  });
}

export function navKeypad(gtc: GtcController, r: 1 | 2): NumericKeypadPage {
  const sys = gtc.sys;
  const v = sys.vars;
  return new NumericKeypadPage(gtc, {
    title: r === 1 ? 'NAV1 Standby' : 'NAV2 Standby',
    initial: () => fmtNav(v.get(vn(NAV.standbyFreq, r))),
    maxDigits: 5,
    format: (b) => formatFreqBuf(b, 3, 2),
    onEnter: (b) => {
      const f = parseNavDigits(b);
      if (!Number.isFinite(f)) return false;
      sys.setNavStandby(r, f);
      return true;
    },
    extra: [
      { label: 'XFER', value: () => fmtNav(v.get(vn(NAV.activeFreq, r))), valueColor: '#00e000', onPress: () => sys.swapNav(r) },
      { label: 'Find', icon: 'nearest', onPress: () => gtc.push(findFreqPage(gtc, 'nav', r)) },
    ],
  });
}

export function adfKeypad(gtc: GtcController): NumericKeypadPage {
  const sys = gtc.sys;
  const v = sys.vars;
  return new NumericKeypadPage(gtc, {
    title: 'ADF Standby',
    initial: () => fmtAdf(v.get(vn(NAV.adfStandby, 1))),
    maxDigits: 5,
    decimal: true,
    onEnter: (b) => {
      const f = parseAdfDigits(b);
      if (!Number.isFinite(f)) return false;
      sys.setAdfStandby(f);
      return true;
    },
    extra: [{ label: 'XFER', value: () => fmtAdf(v.get(vn(NAV.adfActive, 1))), valueColor: '#00e000', onPress: () => sys.swapAdf() }],
  });
}

/** Find frequency: nearest airports (COM: tower / ground / ATIS...; NAV: VOR / ILS) and flight plan airports. */
export function findFreqPage(gtc: GtcController, kind: 'com' | 'nav', r: 1 | 2): ListSelectPage {
  const sys = gtc.sys;
  let cache: ListItem[] = [];
  let cacheT = -1;
  const items = (): readonly ListItem[] => {
    if (cacheT >= 0 && sys.time - cacheT < 5) return cache;
    cacheT = sys.time;
    const v = sys.vars;
    const lat = v.get(GPS.lat);
    const lon = v.get(GPS.lon);
    const out: ListItem[] = [];
    if (!Number.isFinite(lat)) return (cache = out);
    if (kind === 'com') {
      const plan = sys.fms?.plans.active;
      const aps = [plan?.origin, plan?.destination, ...sys.nav.airportsNear(lat, lon, 40, 8)];
      const seen = new Set<string>();
      for (const a of aps) {
        if (!a || seen.has(a.icao)) continue;
        seen.add(a.icao);
        for (const f of a.frequencies) if (f.mhz >= 118 && f.mhz <= 137) out.push({ label: `${a.icao} ${f.type}`, sub: f.description, value: fmtCom(f.mhz, false) });
      }
    } else {
      const navs = sys.nav.navaidsNear(lat, lon, 80, ['VOR', 'VORDME', 'VORTAC', 'LOC', 'ILS']);
      navs.sort((a, b) => distanceNm(lat, lon, a.lat, a.lon) - distanceNm(lat, lon, b.lat, b.lon));
      for (const n of navs.slice(0, 30)) out.push({ label: `${n.ident} ${n.type}`, sub: `${n.name} ${Math.round(distanceNm(lat, lon, n.lat, n.lon))} NM`, value: fmtNav(n.freq) });
    }
    return (cache = out);
  };
  return new ListSelectPage(
    gtc,
    kind === 'com' ? (r === 1 ? 'Find COM1 Frequency' : 'Find COM2 Frequency') : r === 1 ? 'Find NAV1 Frequency' : 'Find NAV2 Frequency',
    items,
    (_i, it) => {
      const f = Number(it.value);
      if (kind === 'com') sys.setComStandby(r, f);
      else sys.setNavStandby(r, f);
      gtc.back();
    },
    'No frequencies',
  );
}

/** Transponder screen (code keypad + mode buttons). */
export class XpdrPage extends NumericKeypadPage {
  constructor(gtc: GtcController) {
    const sys = gtc.sys;
    const v = sys.vars;
    const tcas = sys.cfg.traffic === 'TCAS2';
    const mode = (m: number, label: string) => ({
      label,
      selected: () => v.get(NAV.xpdrMode) === m,
      annun: () => v.get(NAV.xpdrMode) === m,
      onPress: () => sys.setXpdrMode(m),
    });
    super(gtc, {
      title: 'Transponder',
      initial: () => fmtSquawk(v.get(NAV.xpdrCode)),
      maxDigits: 4,
      digits: '01234567',
      format: (b) => (b + '____').slice(0, 4),
      stayOpen: true,
      onEnter: (b) => {
        const c = parseSquawk(b);
        if (!Number.isFinite(c) || b.length !== 4) return false;
        sys.setSquawk(c);
        return true;
      },
      extra: [
        { label: 'VFR', onPress: () => sys.setSquawk(VFR_CODE) },
        mode(1, 'STBY'),
        tcas ? mode(4, 'TA ONLY') : mode(2, 'ON'),
        tcas ? mode(5, 'TA/RA') : mode(3, 'ALT'),
        { label: 'IDENT', annun: () => v.get(G3K.xpdrIdentS) > 0, onPress: () => sys.ident() },
      ],
    });
  }
}

/** Audio & Radios (GMA 36 audio panel functions on the GTC). */
export class AudioRadiosPage extends GtcPage {
  readonly title = 'Audio & Radios';
  protected build(r: Rect): void {
    const sys = this.sys;
    const v = sys.vars;
    const s = this.gtc.g.side;
    const mic = G3K.micSelect(s);
    const w833 = G3K.comSpacing833;
    const onOff = (name: string) => ({ annun: () => v.get(name) >= 0.5, onPress: () => sys.toggleVar(name) });
    const monOn = (rr: number) => {
      const n = G3K.comMonitor(s, rr);
      return { annun: () => v.get(n) >= 0.5, onPress: () => sys.toggleVar(n), disabled: () => v.get(mic) === rr };
    };
    const nav1 = vn(NAV.activeFreq, 1);
    const nav2 = vn(NAV.activeFreq, 2);
    const cells = [
      { label: 'COM1 MIC', annun: () => v.get(mic) === 1, onPress: () => sys.setMic(s, 1) },
      { label: 'COM1 MON', ...monOn(1) },
      { label: 'COM1', value: () => fmtCom(sys.comActive(1), v.get(w833) >= 0.5), valueColor: '#00e000', onPress: () => this.gtc.push(comKeypad(this.gtc, 1)) },
      { label: 'COM2 MIC', annun: () => v.get(mic) === 2, onPress: () => sys.setMic(s, 2) },
      { label: 'COM2 MON', ...monOn(2) },
      { label: 'COM2', value: () => fmtCom(sys.comActive(2), v.get(w833) >= 0.5), valueColor: '#00e000', onPress: () => this.gtc.push(comKeypad(this.gtc, 2)) },
      { label: 'NAV1', ...onOff(G3K.navAudio(s, 1)), value: () => fmtNav(v.get(nav1)), valueColor: '#00e000' },
      { label: 'NAV2', ...onOff(G3K.navAudio(s, 2)), value: () => fmtNav(v.get(nav2)), valueColor: '#00e000' },
      sys.cfg.radios.dme ? { label: 'DME', ...onOff(G3K.dmeAudio(s)) } : { label: 'DME', disabled: () => true },
      sys.cfg.radios.adf ? { label: 'ADF', ...onOff(G3K.adfAudio(s)), value: () => fmtAdf(v.get(vn(NAV.adfActive, 1))), valueColor: '#00e000' } : { label: 'ADF', disabled: () => true },
      { label: 'Marker Audio', ...onOff(G3K.markerAudio(s)) },
      { label: 'Speaker', ...onOff(G3K.speaker) },
      { label: 'NAV1 Standby', value: () => fmtNav(v.get(vn(NAV.standbyFreq, 1))), onPress: () => this.gtc.push(navKeypad(this.gtc, 1)) },
      { label: 'NAV2 Standby', value: () => fmtNav(v.get(vn(NAV.standbyFreq, 2))), onPress: () => this.gtc.push(navKeypad(this.gtc, 2)) },
      sys.cfg.radios.adf ? { label: 'ADF Standby', value: () => fmtAdf(v.get(vn(NAV.adfStandby, 1))), onPress: () => this.gtc.push(adfKeypad(this.gtc)) } : null,
    ];
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, horizontal ? 5 : 3, horizontal ? 3 : 5, cells, 8);
  }
}

/** Transponder mode label for the CNS bar / NAV-COM home. */
export function xpdrModeLabel(sys: GtcController['sys']): string {
  const v = sys.vars;
  if (v.get(G3K.xpdrIdentS) > 0) return 'IDENT';
  return XPDR_MODE_LABELS[Math.max(0, Math.min(5, v.get(NAV.xpdrMode) | 0))];
}
