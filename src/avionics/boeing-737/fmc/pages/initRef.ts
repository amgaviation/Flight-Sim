/**
 * INIT/REF pages: INIT/REF INDEX, IDENT, POS INIT / POS REF / POS SHIFT,
 * PERF INIT / PERF LIMITS, TAKEOFF REF 1/2 & 2/2, APPROACH REF, N1 LIMIT,
 * REF NAV DATA, NAV STATUS and the CDU MENU.
 *
 * Layouts follow the U10.x page figures (b737.org.uk FMC page screenshots:
 * INIT/REF INDEX, IDENT, POS INIT, PERF INIT, TAKEOFF REF 1/2 & 2/2, N1
 * LIMIT, APPROACH REF, POS SHIFT, PERF LIMITS). Field positions are the
 * published ones; the U10.8 additions (TAKEOFF REF QRH speeds, FLAP/SPD,
 * the ground N1 LIMIT layout) follow the FCOM 11.40 descriptions (EST where
 * no figure was available).
 */
import { ADC, GPS, NAV, ENV } from '../../../../core/vars';
import { distanceNm, initialBearing } from '../../../../core/geo';
import { normalizeRunwayIdent } from '../../../../nav/procedures';
import type { Cdu } from '../Cdu';
import { CduColor, type CduScreen } from '../screen';
import { fmtAlt, fmtLatLon, parseAltitude, parseCostIndex, parseLatLon, parseSpeed, parseTempC, parseWeight, parseWind } from '../entry';
import { B738_WEIGHTS } from '../../data/b738';
import { CFM56_7B26_DERATES, type N1Rating } from '../../data/cfm56';
import { APPROACH_FLAPS, TAKEOFF_FLAPS, vref } from '../../data/perf';
import type { TakeoffRating } from '../Fmc';
import {
  INVALID_DELETE,
  INVALID_ENTRY,
  NOT_IN_DATABASE,
  boxes,
  dashes,
  fmtN1,
  fmtTemp,
  fmtTempF,
  fmtThousands,
  fmtWind,
  type CduPage,
  type Lsk,
  type PageId,
} from './common';

const G = { color: CduColor.Green, small: true };
const MAG = CduColor.Magenta;

// ================================================================== INIT/REF INDEX

export const indexPage: CduPage = {
  id: 'index',
  pages: () => 1,
  render(_c, s) {
    s.title('INIT/REF INDEX', 1, 1);
    s.dataL(1, '<IDENT');
    s.dataR(1, 'NAV DATA>');
    s.dataL(2, '<POS');
    s.dataL(3, '<PERF');
    s.dataL(4, '<TAKEOFF');
    s.dataL(5, '<APPROACH');
    s.dataR(6, 'NAV STATUS>');
  },
  lsk(c, k) {
    const map: Record<string, PageId> = { L1: 'ident', R1: 'navData', L2: 'pos', L3: 'perfInit', L4: 'takeoff', L5: 'approach', R6: 'navStatus' };
    const id = map[`${k.side}${k.row}`];
    if (id) c.show(id);
  },
};

// ================================================================== IDENT

/** AIRAC cycle for a date: 28-day cycles from cycle 2001 (2 Jan 2020). */
export function airacCycle(d: Date): { ident: string; start: Date; end: Date } {
  const DAY = 86400000;
  const epoch = Date.UTC(2020, 0, 2);
  const idx = Math.floor((d.getTime() - epoch) / (28 * DAY));
  const start = new Date(epoch + idx * 28 * DAY);
  const end = new Date(start.getTime() + 27 * DAY);
  const y = start.getUTCFullYear();
  // Cycle number within the year: cycles whose start date lies in year y.
  const firstIdx = Math.ceil((Date.UTC(y, 0, 1) - epoch) / (28 * DAY));
  const n = idx - firstIdx + 1;
  return { ident: `${String(y % 100).padStart(2, '0')}${String(n).padStart(2, '0')}`, start, end };
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function ddmmm(d: Date): string {
  return `${MON[d.getUTCMonth()]}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export const identPage: CduPage = {
  id: 'ident',
  pages: () => 1,
  render(c, s) {
    const f = c.fmc;
    s.title('IDENT', 1, 1);
    s.labelL(1, 'MODEL');
    s.dataL(1, f.cfg.model);
    s.labelR(1, 'ENG RATING');
    s.dataR(1, f.cfg.engineRating);
    const now = airacCycle(new Date());
    const next = airacCycle(new Date(now.end.getTime() + 2 * 86400000));
    s.labelL(2, 'NAV DATA');
    s.dataL(2, f.navDataName || `SIM${now.ident}`);
    s.labelR(2, 'ACTIVE');
    s.dataR(2, `${ddmmm(now.start)}${ddmmm(now.end)}/${String(now.end.getUTCFullYear() % 100).padStart(2, '0')}`);
    s.dataR(3, `${ddmmm(next.start)}${ddmmm(next.end)}/${String(next.end.getUTCFullYear() % 100).padStart(2, '0')}`);
    s.labelL(4, 'OP PROGRAM');
    s.dataL(4, `${f.cfg.opProgram} (U10.8A)`);
    s.labelR(5, 'SUPP DATA');
    s.dataL(6, '<INDEX');
    s.dataR(6, 'POS INIT>');
  },
  lsk(c, k) {
    if (k.side === 'L' && k.row === 6) c.show('index');
    else if (k.side === 'R' && k.row === 6) c.show('pos');
  },
};

// ================================================================== POS INIT / POS REF / POS SHIFT

function monthDay(doy: number): string {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let d = Math.max(1, Math.floor(doy));
  let m = 0;
  while (m < 11 && d > days[m]) {
    d -= days[m];
    m++;
  }
  return `${String(m + 1).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
}

function brgDist(c: Cdu, lat: number, lon: number): string {
  const v = c.fmc.vars;
  const la = v.get(GPS.lat);
  const lo = v.get(GPS.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(la)) return '---°/--.-NM';
  const brg = (initialBearing(la, lo, lat, lon) - v.get(GPS.magVar) + 360) % 360;
  const d = distanceNm(la, lo, lat, lon);
  return `${String(Math.round(brg) % 360).padStart(3, '0')}°/${d.toFixed(1)}NM`;
}

export const posPage: CduPage = {
  id: 'pos',
  pages: () => 3,
  render(c, s) {
    const f = c.fmc;
    const v = f.vars;
    const gpsOk = v.getBool(GPS.valid);
    const lat = v.get(GPS.lat);
    const lon = v.get(GPS.lon);
    if (c.sub === 0) {
      s.title('POS INIT', 1, 3);
      s.labelR(1, 'LAST POS');
      s.dataR(1, gpsOk || v.has(GPS.lat) ? fmtLatLon(lat, lon) : fmtLatLon(NaN, NaN));
      s.labelL(2, 'REF AIRPORT');
      const ap = f.refAirport ? f.db.airport(f.refAirport) : undefined;
      s.dataL(2, f.refAirport || dashes(4));
      if (ap) s.dataR(2, fmtLatLon(ap.lat, ap.lon));
      s.labelL(3, 'GATE');
      s.dataL(3, dashes(5));
      s.labelR(4, 'SET IRS POS');
      const need = f.messages.some((m) => m.text === 'ENTER IRS POSITION') || c.state.get('irsNeedPos') === true;
      s.dataR(4, need ? '□□□°□□.□ □□□□°□□.□' : '---°--.- ----°--.-');
      s.labelL(5, 'GMT-MON/DY');
      const utc = f.utcH;
      const hh = Math.floor(utc);
      const mm = (utc - hh) * 60;
      s.dataL(5, `${String(hh).padStart(2, '0')}${mm.toFixed(1).padStart(4, '0')}z ${monthDay(v.get(ENV.dayOfYear, 270))}`);
      s.dashes(11);
      s.dataL(6, '<INDEX');
      s.dataR(6, 'ROUTE>');
      return;
    }
    const a = f.cfg.adiru;
    const bd = c.state.get('posBrgDist') === true;
    const fmt = (la: number, lo: number): string => (bd ? brgDist(c, la, lo) : fmtLatLon(la, lo));
    if (c.sub === 1) {
      s.title('POS REF', 2, 3);
      s.labelL(1, `FMC POS (${gpsOk ? 'GPS L' : 'IRS L'})`);
      s.labelR(1, 'GS');
      s.dataL(1, fmtLatLon(lat, lon));
      s.dataR(1, `${Math.round(v.get(GPS.gs))}KT`);
      const irs = (k: number, idx: number): void => {
        s.labelL(k, `IRS ${idx === a[0] ? 'L' : 'R'}`);
        const ok = v.get(`irs${idx}.nav_valid`) !== 0;
        s.dataL(k, ok ? fmt(v.get(`irs${idx}.lat_deg`), v.get(`irs${idx}.lon_deg`)) : fmtLatLon(NaN, NaN));
        if (ok) s.dataR(k, `${Math.round(v.get(`irs${idx}.gs_kt`))}KT`);
      };
      irs(2, a[0]);
      irs(3, a[1]);
      // SCOPE: one GPS receiver in the simulation feeds both GPS lines.
      s.labelL(4, 'GPS L');
      s.dataL(4, gpsOk ? fmt(lat, lon) : fmtLatLon(NaN, NaN));
      s.labelL(5, 'GPS R');
      s.dataL(5, gpsOk ? fmt(lat, lon) : fmtLatLon(NaN, NaN));
      // SCOPE: no DME-DME / VOR-DME radio position.
      s.labelL(6, 'RADIO');
      s.dataR(6, bd ? 'LAT/LON>' : 'BRG/DIST>');
      return;
    }
    s.title('POS SHIFT', 3, 3);
    const line = (k: number, side: 'L' | 'R', label: string, la: number, lo: number, ok: boolean): void => {
      if (side === 'L') {
        s.labelL(k, label);
        s.dataL(k, ok ? `<${brgDist(c, la, lo)}` : '<---°/--.-NM');
      } else {
        s.labelR(k, label);
        s.dataR(k, ok ? `${brgDist(c, la, lo)}>` : '---°/--.-NM>');
      }
    };
    line(1, 'L', 'IRS L', v.get(`irs${a[0]}.lat_deg`), v.get(`irs${a[0]}.lon_deg`), v.get(`irs${a[0]}.nav_valid`) !== 0);
    line(1, 'R', 'IRS R', v.get(`irs${a[1]}.lat_deg`), v.get(`irs${a[1]}.lon_deg`), v.get(`irs${a[1]}.nav_valid`) !== 0);
    line(2, 'L', 'GPS L', lat, lon, gpsOk);
    line(2, 'R', 'GPS R', lat, lon, gpsOk);
    s.labelL(3, 'RADIO');
    s.dataL(3, '<---°/--.-NM');
    s.center(9, gpsOk ? 'GPS(L)' : 'IRS(L)', { small: true });
    s.dashes(11);
    s.dataL(6, '<INDEX');
  },
  lsk(c, k) {
    const f = c.fmc;
    const v = f.vars;
    if (k.side === 'L' && k.row === 6 && c.sub !== 1) {
      c.show('index');
      return;
    }
    if (c.sub === 0) {
      if (k.side === 'R' && k.row === 6) {
        c.show('rte');
        return;
      }
      if (k.side === 'R' && k.row === 1 && !c.scratch) {
        c.copy(fmtLatLon(v.get(GPS.lat), v.get(GPS.lon)).replace(/[° ]/g, ''));
        return;
      }
      if (k.side === 'L' && k.row === 2) {
        if (c.isDelete) {
          f.refAirport = '';
          c.consume();
          return;
        }
        const id = c.scratch.trim();
        if (!id) return;
        if (!f.db.airport(id)) return c.error(NOT_IN_DATABASE);
        f.refAirport = id;
        c.consume();
        return;
      }
      if (k.side === 'R' && k.row === 2 && !c.scratch) {
        const ap = f.refAirport ? f.db.airport(f.refAirport) : undefined;
        if (ap) c.copy(fmtLatLon(ap.lat, ap.lon).replace(/[° ]/g, ''));
        return;
      }
      if (k.side === 'L' && k.row === 3 && c.scratch) {
        // SCOPE: no gate database.
        c.error(NOT_IN_DATABASE);
        return;
      }
      if (k.side === 'R' && k.row === 4) {
        const p = parseLatLon(c.scratch);
        if (!p) return c.error(INVALID_ENTRY);
        // The IRS compares the entry with its own position (EST 10 nm tolerance before VERIFY POSITION).
        const la = v.get(GPS.lat);
        const lo = v.get(GPS.lon);
        if (Number.isFinite(la) && distanceNm(p.lat, p.lon, la, lo) > 10) return c.error('VERIFY POSITION');
        f.events.emit('irs.pos_entry');
        f.removeMessage('ENTER IRS POSITION');
        c.consume();
        return;
      }
      return;
    }
    if (c.sub === 1) {
      if (k.side === 'R' && k.row === 6) c.state.set('posBrgDist', c.state.get('posBrgDist') !== true);
      else if (k.side === 'L' && k.row >= 1 && k.row <= 5 && !c.scratch) {
        // Copy a sensor position to the scratchpad (e.g. GPS -> SET IRS POS).
        const la = k.row === 1 || k.row >= 4 ? v.get(GPS.lat) : v.get(`irs${f.cfg.adiru[k.row - 2]}.lat_deg`);
        const lo = k.row === 1 || k.row >= 4 ? v.get(GPS.lon) : v.get(`irs${f.cfg.adiru[k.row - 2]}.lon_deg`);
        if (Number.isFinite(la)) c.copy(fmtLatLon(la, lo).replace(/[° ]/g, ''));
      }
    }
    // POS SHIFT: SCOPE: the FMC position is the GPS/IRS blend; shifts are not applied.
  },
};

// ================================================================== PERF INIT / PERF LIMITS

function parseSpeedPair(t: string): { kt: number; mach: number } | null {
  const [a, b] = t.split('/');
  const out = { kt: NaN, mach: NaN };
  for (const part of [a, b]) {
    if (part === undefined || part === '') continue;
    const sp = parseSpeed(part);
    if (!sp) return null;
    if (Number.isFinite(sp.kt)) out.kt = sp.kt;
    if (Number.isFinite(sp.mach)) out.mach = sp.mach;
  }
  if (!Number.isFinite(out.kt) && !Number.isFinite(out.mach)) return null;
  return out;
}

export const perfInitPage: CduPage = {
  id: 'perfInit',
  pages: () => 2,
  render(c, s) {
    const f = c.fmc;
    const u = f.cfg.weightUnit;
    const pd = f.pd;
    const pre = f.perfTitlePrefix();
    if (c.sub === 0) {
      s.title(`${pre}PERF INIT`, 1, 2);
      s.labelL(1, 'GW/CRZ CG');
      const gw = Number.isFinite(f.grossWeightKg) ? fmtThousands(f.grossWeightKg, u) : boxes(5);
      s.dataL(1, `${gw}/${Number.isFinite(f.crzCgPct) ? f.crzCgPct.toFixed(1) : ' 8.0'}%`);
      s.labelR(1, 'TRIP/CRZ ALT');
      const crz = pd.crzAltFt;
      const crzTxt = Number.isFinite(crz) ? fmtAlt(crz, f.transAltFt) : boxes(5);
      const trip = f.tripAltFt;
      s.dataR(1, `${Number.isFinite(trip) ? fmtAlt(trip, f.transAltFt) : '-----'}/${crzTxt}`, { reverse: f.perfMod !== null && f.perfMod.crzAltFt !== f.perf.crzAltFt });
      s.labelL(2, 'PLAN/FUEL');
      s.dataL(2, `${Number.isFinite(f.planFuelKg) ? fmtThousands(f.planFuelKg, u) : '--.-'}/ ${fmtThousands(f.fuelKg, u)}`);
      s.labelR(2, 'CRZ WIND');
      s.dataR(2, fmtWind(f.crzWind.dir, f.crzWind.kt));
      s.labelL(3, 'ZFW');
      s.dataL(3, Number.isFinite(f.zfwKg) ? fmtThousands(f.zfwKg, u) : boxes(5));
      s.labelR(3, 'ISA DEV');
      const isa = Number.isFinite(f.tcOatC) && Number.isFinite(crz) ? f.tcOatC - Math.max(-56.5, 15 - 0.0019812 * crz) : NaN;
      s.dataR(3, `${fmtTempF(isa).replace('+', '')} ${fmtTemp(isa).replace('+', '')}`.replace(/---°F ---°C/, '---°F ---°C'));
      s.labelL(4, 'RESERVES');
      s.dataL(4, Number.isFinite(f.reservesKg) ? fmtThousands(f.reservesKg, u) : boxes(4));
      s.labelR(4, 'T/C OAT');
      s.dataR(4, `${fmtTempF(f.tcOatC)} ${fmtTemp(f.tcOatC)}`);
      s.labelL(5, 'COST INDEX');
      s.dataL(5, Number.isFinite(pd.costIndex) ? String(pd.costIndex) : boxes(4), { reverse: f.perfMod !== null && f.perfMod.costIndex !== f.perf.costIndex });
      s.labelR(5, 'TRANS ALT');
      s.dataR(5, String(f.transAltFt));
      s.dashes(11);
      s.dataL(6, f.perfMod ? '<ERASE' : '<INDEX');
      s.dataR(6, 'N1 LIMIT>');
      return;
    }
    s.title(`${pre}PERF LIMITS`, 2, 2);
    s.labelL(1, 'TIME ERROR TOLERANCE');
    s.dataL(1, ' --- SEC AT RTA WPT', { small: true });
    s.labelL(2, 'MIN SPD');
    s.center(3, '--CLB--', { small: true });
    s.labelR(2, 'MAX SPD');
    const L = f.limits;
    const row = (k: number, l: typeof L.clb, lbl: string): void => {
      if (lbl) s.center(2 * k - 1, lbl, { small: true });
      s.dataL(k, `${l.minKt}/.${Math.round(l.minMach * 1000)}`);
      s.dataR(k, `${l.maxKt}/.${Math.round(l.maxMach * 1000)}`);
    };
    row(2, L.clb, '');
    row(3, L.crz, '--CRZ--');
    row(4, L.des, '--DES--');
    s.dashes(11);
    s.dataL(6, '<INDEX');
  },
  lsk(c, k) {
    const f = c.fmc;
    const u = f.cfg.weightUnit;
    const t = c.scratch;
    if (k.side === 'L' && k.row === 6) {
      if (f.perfMod && c.sub === 0) f.erase();
      else c.show('index');
      return;
    }
    if (c.sub === 1) {
      const which = k.row === 2 ? 'clb' : k.row === 3 ? 'crz' : k.row === 4 ? 'des' : null;
      if (!which || !t) return;
      const p = parseSpeedPair(t);
      if (!p) return c.error(INVALID_ENTRY);
      const l = f.limits[which];
      if (k.side === 'L') {
        if (Number.isFinite(p.kt)) l.minKt = p.kt;
        if (Number.isFinite(p.mach)) l.minMach = p.mach;
      } else {
        if (Number.isFinite(p.kt)) l.maxKt = Math.min(p.kt, 340);
        if (Number.isFinite(p.mach)) l.maxMach = Math.min(p.mach, 0.82);
      }
      c.consume();
      return;
    }
    if (k.side === 'R' && k.row === 6) {
      c.show('n1');
      return;
    }
    if (!t) return;
    if (k.side === 'L' && k.row === 1) {
      // "GW", "GW/CG" or "/CG".
      const [gwS, cgS] = t.split('/');
      if (gwS) {
        const gw = parseWeight(gwS, u);
        if (!Number.isFinite(gw) || gw > B738_WEIGHTS.maxTakeoffKg + 500 || gw - f.fuelKg < B738_WEIGHTS.operatingEmptyKg - 5000) return c.error(INVALID_ENTRY);
        f.zfwKg = gw - f.fuelKg;
        f.invalidateVspeeds();
      }
      if (cgS !== undefined && cgS !== '') {
        const cg = Number(cgS);
        if (!/^\d{1,2}(\.\d)?$/.test(cgS) || cg < 5 || cg > 40) return c.error(INVALID_ENTRY);
        f.crzCgPct = cg;
      }
      c.consume();
    } else if (k.side === 'R' && k.row === 1) {
      const alt = parseAltitude(t.replace(/^\//, ''));
      if (!Number.isFinite(alt) || alt < 1000) return c.error(INVALID_ENTRY);
      if (alt > f.maxAltFt) return c.error(`MAX ALT FL${Math.round(f.maxAltFt / 100)}`);
      f.editPerf((p) => (p.crzAltFt = alt));
      c.consume();
    } else if (k.side === 'L' && k.row === 2) {
      const pf = parseWeight(t.replace(/\/.*$/, ''), u);
      if (!Number.isFinite(pf)) return c.error(INVALID_ENTRY);
      f.planFuelKg = pf;
      c.consume();
    } else if (k.side === 'R' && k.row === 2) {
      if (c.isDelete) {
        f.crzWind = { dir: NaN, kt: NaN };
        return c.consume();
      }
      const w = parseWind(t);
      if (!w) return c.error(INVALID_ENTRY);
      f.crzWind = w;
      c.consume();
    } else if (k.side === 'L' && k.row === 3) {
      const z = parseWeight(t, u);
      if (!Number.isFinite(z) || z > B738_WEIGHTS.maxZeroFuelKg + 500 || z < B738_WEIGHTS.operatingEmptyKg - 5000) return c.error(INVALID_ENTRY);
      f.zfwKg = z;
      f.invalidateVspeeds();
      c.consume();
    } else if (k.side === 'R' && k.row === 3) {
      const d = parseTempC(t);
      if (!Number.isFinite(d)) return c.error(INVALID_ENTRY);
      const crz = f.pd.crzAltFt;
      f.tcOatC = d + Math.max(-56.5, 15 - 0.0019812 * (Number.isFinite(crz) ? crz : 35000));
      c.consume();
    } else if (k.side === 'L' && k.row === 4) {
      const r = parseWeight(t, u);
      if (!Number.isFinite(r) || r > 20000) return c.error(INVALID_ENTRY);
      f.reservesKg = r;
      c.consume();
    } else if (k.side === 'R' && k.row === 4) {
      const o = parseTempC(t);
      if (!Number.isFinite(o)) return c.error(INVALID_ENTRY);
      f.tcOatC = o;
      c.consume();
    } else if (k.side === 'L' && k.row === 5) {
      const ci = parseCostIndex(t);
      if (!Number.isFinite(ci)) return c.error(INVALID_ENTRY);
      f.editPerf((p) => (p.costIndex = ci));
      c.consume();
    } else if (k.side === 'R' && k.row === 5) {
      const a = Number(t);
      if (!/^\d{4,5}$/.test(t) || a < 1000 || a > 45000) return c.error(INVALID_ENTRY);
      f.transAltFt = a;
      c.consume();
    }
  },
};

// ================================================================== TAKEOFF REF

function preflightMissing(c: Cdu): { page: PageId; label: string } | null {
  const f = c.fmc;
  if (f.messages.some((m) => m.text === 'ENTER IRS POSITION')) return { page: 'pos', label: 'POS INIT' };
  if (!f.hasActiveRoute) return { page: 'rte', label: 'ROUTE' };
  if (!Number.isFinite(f.zfwKg) || !Number.isFinite(f.perf.costIndex) || !Number.isFinite(f.perf.crzAltFt) || !Number.isFinite(f.reservesKg)) return { page: 'perfInit', label: 'PERF INIT' };
  return null;
}

export const takeoffPage: CduPage = {
  id: 'takeoff',
  pages: () => 2,
  render(c, s) {
    const f = c.fmc;
    const u = f.cfg.weightUnit;
    if (c.sub === 0) {
      s.title('TAKEOFF REF', 1, 2);
      s.labelL(1, 'FLAPS');
      s.dataL(1, Number.isFinite(f.toFlaps) ? `${f.toFlaps}°` : '□□°');
      const q = f.qrh;
      if (q) s.put(1, 14, 'QRH', { small: true });
      const vrow = (k: number, lbl: string, sel: number, qv: number | undefined): void => {
        s.labelR(k, lbl);
        if (q && qv !== undefined) s.put(2 * k, 14, String(qv), { small: true });
        s.dataR(k, Number.isFinite(sel) ? `${Math.round(sel)}KT` : q ? '---' : boxes(3));
      };
      vrow(1, 'V1', f.v1Sel, q?.v1);
      vrow(2, 'VR', f.vrSel, q?.vr);
      vrow(3, 'V2', f.v2Sel, q?.v2);
      const derate = CFM56_7B26_DERATES[f.toRating];
      const assumed = Number.isFinite(f.selTempC);
      s.labelL(2, f.toRating === 'TO' ? `${derate} N1` : `${derate} DERATE`);
      s.dataL(2, fmtN1(f.n1Limit(f.toRating)).replace('/ ', '/'));
      if (assumed) s.put(3, 12, `${Math.round(f.selTempC)}°`, { small: true });
      s.labelL(3, 'CG');
      s.dataL(3, Number.isFinite(f.toCgPct) ? `${f.toCgPct.toFixed(1)}%` : '□□.□%');
      s.put(5, 8, 'TRIM', { small: true });
      s.put(6, 8, Number.isFinite(f.toTrim) ? f.toTrim.toFixed(2) : '', { small: false });
      const p = f.plan;
      s.labelL(4, 'RUNWAY');
      s.dataL(4, p.departureRunway ? `RW${p.departureRunway}` : dashes(5));
      s.labelL(5, 'GW  /  TOW');
      const gw = f.grossWeightKg;
      s.dataL(5, Number.isFinite(gw) ? `${fmtThousands(gw, u)}/ ${fmtThousands(gw, u)}` : '---.-/---.-');
      const miss = preflightMissing(c);
      const vs = f.vSpeedsSet && Number.isFinite(f.toFlaps);
      s.center(11, miss || !vs ? '-----PRE-FLT STATUS-----' : '----PRE-FLT COMPLETE----', { small: true });
      s.dataL(6, '<INDEX');
      if (miss) s.dataR(6, `${miss.label}>`);
      else s.dataR(6, 'THRUST LIM>');
      return;
    }
    s.title('TAKEOFF REF', 2, 2);
    s.labelL(1, 'RW WIND');
    s.dataL(1, fmtWind(f.rwWind.dir, f.rwWind.kt));
    s.labelR(1, 'ACCEL HT');
    s.dataR(1, `${f.accelHtFt}AGL`);
    s.labelL(2, 'RW SLOPE/HDG');
    const hdg = rwHeadingMag(c);
    s.dataL(2, `${Number.isFinite(f.rwSlopePct) ? `${f.rwSlopePct >= 0 ? 'U' : 'D'}${Math.abs(f.rwSlopePct).toFixed(1)}` : 'U0.0'}/${Number.isFinite(hdg) ? String(Math.round(hdg) % 360).padStart(3, '0') : '---'}°`);
    s.labelR(2, 'EO ACCEL HT');
    s.dataR(2, `${f.eoAccelHtFt}AGL`);
    s.labelL(3, 'RW COND');
    s.put(6, 0, 'DRY', { small: f.rwWet });
    s.put(6, 3, '/', { small: true });
    s.put(6, 4, 'WET', { small: !f.rwWet });
    s.labelR(3, 'THR REDUCTION');
    s.dataR(3, `${f.thrRedFt}AGL`);
    s.labelL(4, 'SEL TEMP  OAT');
    s.dataL(4, `${Number.isFinite(f.selTempC) ? `${Math.round(f.selTempC)}°C` : '--°C'} ${fmtTemp(f.oatC)}`);
    s.dashes(11);
    s.dataL(6, '<INDEX');
  },
  lsk(c, k) {
    const f = c.fmc;
    const t = c.scratch;
    if (k.side === 'L' && k.row === 6) return c.show('index');
    if (c.sub === 0) {
      if (k.side === 'R' && k.row === 6) {
        const miss = preflightMissing(c);
        return c.show(miss ? miss.page : 'n1');
      }
      if (k.side === 'L' && k.row === 1) {
        if (c.isDelete) {
          f.toFlaps = NaN;
          f.invalidateVspeeds();
          return c.consume();
        }
        const fl = Number(t);
        if (!/^\d{1,2}$/.test(t) || !(TAKEOFF_FLAPS as readonly number[]).includes(fl)) return c.error(INVALID_ENTRY);
        f.toFlaps = fl;
        f.invalidateVspeeds();
        return c.consume();
      }
      if (k.side === 'R' && k.row >= 1 && k.row <= 3) {
        const key = (['v1Sel', 'vrSel', 'v2Sel'] as const)[k.row - 1];
        if (c.isDelete) {
          f[key] = NaN;
          return c.consume();
        }
        if (!t) {
          const q = f.qrh;
          if (!q) return;
          f[key] = [q.v1, q.vr, q.v2][k.row - 1];
          f.removeMessage('TAKEOFF SPEEDS DELETED');
          return;
        }
        const n = Number(t.replace(/KT$/, ''));
        if (!/^\d{2,3}$/.test(t.replace(/KT$/, '')) || n < 80 || n > 200) return c.error(INVALID_ENTRY);
        f[key] = n;
        return c.consume();
      }
      if (k.side === 'L' && k.row === 3) {
        if (c.isDelete) {
          f.toCgPct = NaN;
          return c.consume();
        }
        const cg = Number(t);
        if (!/^\d{1,2}(\.\d)?$/.test(t) || cg < 5 || cg > 35) return c.error(INVALID_ENTRY);
        f.toCgPct = cg;
        f.invalidateVspeeds();
        return c.consume();
      }
      if (k.side === 'L' && k.row === 4 && t) {
        const rw = normalizeRunwayIdent(t.replace(/^RW/, ''));
        const o = f.plan.origin;
        if (!o) return c.error(INVALID_ENTRY);
        if (!o.runways.some((r) => normalizeRunwayIdent(r.ident) === rw)) return c.error(NOT_IN_DATABASE);
        f.editPlan((p) => p.setDepartureRunway(rw));
        f.invalidateVspeeds();
        return c.consume();
      }
      return;
    }
    // page 2
    if (k.side === 'L' && k.row === 1) {
      if (c.isDelete) {
        f.rwWind = { dir: NaN, kt: NaN };
        return c.consume();
      }
      const w = parseWind(t);
      if (!w) return c.error(INVALID_ENTRY);
      f.rwWind = w;
      f.invalidateVspeeds();
      return c.consume();
    }
    if (k.side === 'L' && k.row === 2) {
      const m = /^([UD])(\d(\.\d)?)(\/.*)?$/.exec(t);
      if (!m) return c.error(INVALID_ENTRY);
      f.rwSlopePct = Number(m[2]) * (m[1] === 'D' ? -1 : 1);
      return c.consume();
    }
    if (k.side === 'L' && k.row === 3) {
      if (t === 'DRY' || t === 'D') f.rwWet = false;
      else if (t === 'WET' || t === 'W') f.rwWet = true;
      else if (!t) f.rwWet = !f.rwWet;
      else return c.error(INVALID_ENTRY);
      f.invalidateVspeeds();
      return c.consume();
    }
    if (k.side === 'L' && k.row === 4) {
      if (c.isDelete) {
        f.setSelTemp(NaN);
        return c.consume();
      }
      const tc = parseTempC(t);
      if (!Number.isFinite(tc) || !f.setSelTemp(tc)) return c.error(INVALID_ENTRY);
      return c.consume();
    }
    if (k.side === 'R' && k.row >= 1 && k.row <= 3) {
      const n = Number(t.replace(/AGL$/, ''));
      if (!/^\d{3,4}$/.test(t.replace(/AGL$/, '')) || n < 400 || n > 9999) return c.error(INVALID_ENTRY);
      if (k.row === 1) f.accelHtFt = n;
      else if (k.row === 2) f.eoAccelHtFt = n;
      else f.thrRedFt = n;
      return c.consume();
    }
  },
};

function rwHeadingMag(c: Cdu): number {
  const p = c.fmc.plan;
  const o = p.origin;
  if (!o || !p.departureRunway) return NaN;
  const rw = o.runways.find((r) => r.ident === p.departureRunway);
  if (!rw) return NaN;
  return (rw.headingTrue - (o.magVar ?? 0) + 360) % 360;
}

// ================================================================== APPROACH REF

export const approachPage: CduPage = {
  id: 'approach',
  pages: () => 1,
  render(c, s) {
    const f = c.fmc;
    const u = f.cfg.weightUnit;
    s.title('APPROACH REF', 1, 1);
    const gw = Number.isFinite(f.apprGwKg) ? f.apprGwKg : f.grossWeightKg;
    s.labelL(1, 'GROSS WT');
    s.dataL(1, Number.isFinite(gw) ? fmtThousands(gw, u) : boxes(5));
    s.put(1, 13, 'FLAPS', { small: true });
    s.labelR(1, 'VREF');
    APPROACH_FLAPS.forEach((fl, i) => {
      const vr = Number.isFinite(gw) ? vref(gw, fl) : NaN;
      const sel = f.vrefFlaps === fl;
      s.put(2 * (i + 1), 14, `${fl}°`.padStart(3, ' '), { small: false, color: sel ? CduColor.Green : CduColor.White });
      s.dataR(i + 1, Number.isFinite(vr) ? `${vr}KT` : '---KT');
    });
    s.labelL(2, 'GA N1');
    s.dataL(2, fmtN1(f.n1Limit('GA')).replace('/ ', '/'));
    // Runway / ILS of the destination.
    const p = f.fms.plans.active;
    const d = p.destination;
    if (d) {
      const rwId = p.arrivalRunway;
      const rw = rwId ? d.runways.find((r) => r.ident === rwId) : undefined;
      s.labelL(4, `${d.icao}${rwId ?? ''}`);
      if (rw) s.dataL(4, `${Math.round(rw.lengthFt)}FT${Math.round(rw.lengthFt * 0.3048)}M`);
      else s.dataL(4, '-----FT----M');
      const ils = rw?.ils;
      if (ils) {
        s.labelL(5, `${ils.kind ?? 'ILS'}${rwId}`);
        s.dataL(5, `${ils.freqMhz.toFixed(2)} ${ils.ident}`);
        s.labelR(5, 'FRONT CRS');
        const crs = (ils.courseTrue - (ils.declination ?? d.magVar ?? 0) + 360) % 360;
        s.dataR(5, `${String(Math.round(crs) % 360 || 360).padStart(3, '0')}°`);
      }
    }
    s.labelR(4, 'FLAP/SPD');
    s.dataR(4, Number.isFinite(f.vrefSel) ? `${f.vrefFlaps}/${Math.round(f.vrefSel)}` : '--/---');
    s.dashes(11);
    s.dataL(6, '<INDEX');
    s.dataR(6, 'THRUST LIM>');
  },
  lsk(c, k) {
    const f = c.fmc;
    const t = c.scratch;
    if (k.side === 'L' && k.row === 6) return c.show('index');
    if (k.side === 'R' && k.row === 6) return c.show('n1');
    if (k.side === 'L' && k.row === 1) {
      if (c.isDelete) {
        f.apprGwKg = NaN;
        return c.consume();
      }
      const w = parseWeight(t, f.cfg.weightUnit);
      if (!Number.isFinite(w) || w > B738_WEIGHTS.maxTakeoffKg) return c.error(INVALID_ENTRY);
      f.apprGwKg = w;
      return c.consume();
    }
    if (k.side === 'R' && k.row >= 1 && k.row <= 3 && !t) {
      const gw = Number.isFinite(f.apprGwKg) ? f.apprGwKg : f.grossWeightKg;
      const fl = APPROACH_FLAPS[k.row - 1];
      const vr = Number.isFinite(gw) ? vref(gw, fl) : NaN;
      if (Number.isFinite(vr)) c.copy(`${fl}/${vr}`);
      return;
    }
    if (k.side === 'R' && k.row === 4) {
      if (c.isDelete) {
        f.vrefSel = NaN;
        f.vrefFlaps = NaN;
        return c.consume();
      }
      const m = /^(\d{1,2})\/(\d{3})$/.exec(t);
      if (!m) return c.error(INVALID_ENTRY);
      const fl = Number(m[1]);
      const sp = Number(m[2]);
      if (![15, 25, 30, 40].includes(fl) || sp < 100 || sp > 200) return c.error(INVALID_ENTRY);
      f.vrefFlaps = fl;
      f.vrefSel = sp;
      f.removeMessage('APPRCH VREF NOT SELECTED');
      return c.consume();
    }
  },
};

// ================================================================== N1 LIMIT

export const n1Page: CduPage = {
  id: 'n1',
  pages: () => 1,
  render(c, s) {
    const f = c.fmc;
    s.title('N1 LIMIT', 1, 1);
    if (f.ground) {
      s.labelL(1, 'SEL/OAT');
      s.dataL(1, `${Number.isFinite(f.selTempC) ? Math.round(f.selTempC) : '--'}/${fmtTemp(f.oatC)}`);
      const d = CFM56_7B26_DERATES[f.toRating];
      s.labelR(1, `${d} N1`);
      s.dataR(1, fmtN1(f.n1Limit(f.toRating)).replace('%', ''));
      const tos: [TakeoffRating, string][] = [
        ['TO', CFM56_7B26_DERATES.TO],
        ['TO-1', `${CFM56_7B26_DERATES['TO-1']} DERATE`],
        ['TO-2', `${CFM56_7B26_DERATES['TO-2']} DERATE`],
      ];
      tos.forEach(([r, lbl], i) => {
        const k = i + 2;
        s.labelL(k, lbl);
        s.dataL(k, `<${r}`);
        if (f.toRating === r) s.put(2 * k, 7, '<ACT>', G);
        const cr = (['CLB', 'CLB-1', 'CLB-2'] as const)[i];
        s.dataR(k, `${cr}>`);
        if (f.clbRating === cr) s.put(2 * k, 24 - cr.length - 1 - 6, '<SEL>', G);
      });
      s.dashes(11);
      s.dataL(6, '<INDEX');
      s.dataR(6, 'TAKEOFF>');
      return;
    }
    const auto = f.n1Manual === null;
    s.dataL(1, '<AUTO');
    if (auto) s.put(2, 7, '<ACT>', G);
    const rows: [N1Rating, number][] = [
      ['GA', 2],
      ['CON', 3],
      ['CLB', 4],
      ['CRZ', 5],
    ];
    for (const [r, k] of rows) {
      s.dataL(k, `<${r}`);
      if (!auto && f.activeRating === r) s.put(2 * k, r.length + 2, '<ACT>', G);
      s.dataR(k, fmtN1(f.n1Limit(r)));
    }
    s.center(11, '---REDUCED-CLB---', { small: true });
    s.dataL(6, '<CLB-1');
    s.dataR(6, 'CLB-2>');
    // Reduced climb: <ACT> when manually selected, <SEL> for the take-off selection still washing out in AUTO.
    const red = (r: 'CLB-1' | 'CLB-2'): string | null => (!auto && f.activeRating === r ? '<ACT>' : auto && f.clbRating === r && f.activeRating === r ? '<SEL>' : null);
    const m1 = red('CLB-1');
    const m2 = red('CLB-2');
    if (m1) s.put(12, 7, m1, G);
    if (m2) s.put(12, 12, m2, G);
  },
  lsk(c, k) {
    const f = c.fmc;
    if (f.ground) {
      if (k.side === 'L' && k.row === 6) return c.show('index');
      if (k.side === 'R' && k.row === 6) return c.show('takeoff');
      if (k.side === 'L' && k.row === 1) {
        if (c.isDelete) {
          f.setSelTemp(NaN);
          return c.consume();
        }
        const t = parseTempC(c.scratch.replace(/\/.*$/, ''));
        if (!Number.isFinite(t) || !f.setSelTemp(t)) return c.error(INVALID_ENTRY);
        return c.consume();
      }
      if (k.row >= 2 && k.row <= 4) {
        if (k.side === 'L') f.setTakeoffRating((['TO', 'TO-1', 'TO-2'] as const)[k.row - 2]);
        else f.clbRating = (['CLB', 'CLB-1', 'CLB-2'] as const)[k.row - 2];
        f.version++;
      }
      return;
    }
    if (k.side === 'L' && k.row === 1) f.n1Manual = null;
    else if (k.side === 'L' && k.row >= 2 && k.row <= 5) f.n1Manual = (['GA', 'CON', 'CLB', 'CRZ'] as const)[k.row - 2];
    else if (k.row === 6) f.n1Manual = k.side === 'L' ? 'CLB-1' : 'CLB-2';
    f.version++;
  },
};

// ================================================================== REF NAV DATA

export const navDataPage: CduPage = {
  id: 'navData',
  pages: () => 1,
  render(c, s) {
    const f = c.fmc;
    s.title('REF NAV DATA', 1, 1);
    const id = (c.state.get('navDataIdent') as string | undefined) ?? '';
    s.labelL(1, 'IDENT');
    s.dataL(1, id || boxes(5));
    if (id) {
      const v = f.vars;
      const la = v.get(GPS.lat);
      const lo = v.get(GPS.lon);
      const ap = f.db.airport(id);
      const nv = f.db.navaidsByIdent(id).sort((a, b) => distanceNm(la, lo, a.lat, a.lon) - distanceNm(la, lo, b.lat, b.lon))[0];
      const w = f.db.resolve(id, la, lo)[0];
      const lat = ap?.lat ?? nv?.lat ?? w?.lat ?? NaN;
      const lon = ap?.lon ?? nv?.lon ?? w?.lon ?? NaN;
      const ll = fmtLatLon(lat, lon).split(' ');
      s.labelL(2, 'LATITUDE');
      s.dataL(2, ll[0]);
      s.labelR(2, 'LONGITUDE');
      s.dataR(2, ll[1] ?? '');
      if (ap) {
        s.labelL(3, 'ELEVATION');
        s.dataL(3, `${Math.round(ap.elevationFt)}FT`);
        s.labelR(3, 'MAG VAR');
        const mv = ap.magVar ?? 0;
        s.dataR(3, `${mv < 0 ? 'W' : 'E'}${Math.abs(mv).toFixed(0)}°`);
      } else if (nv) {
        s.labelL(3, 'FREQ');
        s.dataL(3, nv.type === 'NDB' || nv.type === 'NDBDME' ? `${Math.round(nv.freq)}` : nv.freq.toFixed(2));
        s.labelR(3, 'MAG VAR');
        s.dataR(3, `${nv.magVar < 0 ? 'W' : 'E'}${Math.abs(nv.magVar).toFixed(0)}°`);
        s.labelL(4, 'ELEVATION');
        s.dataL(4, `${Math.round(nv.elevationFt)}FT`);
        s.labelR(4, 'CLASS');
        s.dataR(4, nv.type);
      }
    }
    s.dashes(11);
    s.dataL(6, '<INDEX');
  },
  lsk(c, k) {
    if (k.side === 'L' && k.row === 6) return c.show('index');
    if (k.side === 'L' && k.row === 1 && c.scratch) {
      const id = c.scratch.trim();
      const v = c.fmc.vars;
      if (c.fmc.db.resolve(id, v.get(GPS.lat), v.get(GPS.lon)).length === 0 && !c.fmc.db.airport(id)) return c.error(NOT_IN_DATABASE);
      c.state.set('navDataIdent', id);
      c.consume();
    }
  },
};

// ================================================================== NAV STATUS

export const navStatusPage: CduPage = {
  id: 'navStatus',
  pages: () => 1,
  render(c, s) {
    const v = c.fmc.vars;
    s.title('NAV STATUS', 1, 1);
    const radio = (k: number, side: 'L' | 'R', r: number): void => {
      const lbl = v.get(NAV.isLoc(r)) !== 0 ? `ILS ${side}` : `VOR ${side}`;
      const id = v.getString(NAV.ident(r));
      const fq = v.get(NAV.activeFreq(r));
      const txt = `${id || '---'} ${fq > 0 ? fq.toFixed(2) : '---.--'}`;
      if (side === 'L') {
        s.labelL(k, lbl);
        s.dataL(k, txt);
      } else {
        s.labelR(k, lbl);
        s.dataR(k, txt);
      }
    };
    radio(1, 'L', 1);
    radio(1, 'R', 2);
    s.labelL(2, 'DME L');
    s.dataL(2, v.get(NAV.dmeValid(1)) !== 0 ? `${v.get(NAV.dmeNm(1)).toFixed(1)}NM` : '---.-');
    s.labelR(2, 'DME R');
    s.dataR(2, v.get(NAV.dmeValid(2)) !== 0 ? `${v.get(NAV.dmeNm(2)).toFixed(1)}NM` : '---.-');
    s.labelL(3, 'GPS');
    s.dataL(3, v.getBool(GPS.valid) ? `NAV  ${Math.round(v.get(GPS.sats, 9))} SATS` : 'FAIL');
    s.labelL(4, 'IRS L');
    const a = c.fmc.cfg.adiru;
    const st = (i: number): string => ['OFF', 'ALIGN', 'NAV', 'ATT', 'FAULT'][Math.round(v.get(`irs${i}.state`, 2))] ?? '---';
    s.dataL(4, st(a[0]));
    s.labelR(4, 'IRS R');
    s.dataR(4, st(a[1]));
    s.dashes(11);
    s.dataL(6, '<INDEX');
  },
  lsk(c, k) {
    if (k.side === 'L' && k.row === 6) c.show('index');
  },
};

// ================================================================== MENU

export const menuPage: CduPage = {
  id: 'menu',
  pages: () => 1,
  render(c, s) {
    s.title('MENU');
    s.dataL(1, '<FMC');
    s.put(2, 6, '<ACT>', G);
    // SCOPE: ACARS / DFDAU / SAT subsystems are not simulated.
    s.labelR(6, 'MENU OPTIONS');
    void c;
  },
  lsk(c, k) {
    if (k.side === 'L' && k.row === 1) c.show('index');
  },
};
