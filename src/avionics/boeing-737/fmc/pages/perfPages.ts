/**
 * CLB, CRZ, DES (+ DES FORECAST), PROGRESS and FIX INFO pages.
 *
 * Layouts from the b737.org.uk U10.x screenshots (ACT ECON CLB, ACT ECON
 * CRZ, PATH DES, PROGRESS 1/3 and 3/3, FIX INFO). Mode prompts per FCOM
 * 11.31: ECON / MAX RATE / MAX ANGLE climb, ECON / LRC cruise, ECON descent;
 * a speed typed into TGT SPD selects a fixed speed ("SEL" mode, title
 * "280KT" / "M.780"). Mode and cruise-altitude changes are modifications
 * (MOD title, EXEC) once the route is active. DES NOW> is offered in
 * cruise. SCOPE: no RTA, ENG OUT or step-climb prompts.
 */
import { ADC, FMS, GPS, NAV } from '../../../../core/vars';
import type { Cdu } from '../Cdu';
import { CduColor } from '../screen';
import { fmtAlt, fmtLatLon, parseAltitude, parseSpeed, parseWind } from '../entry';
import { crossoverAltFt } from '../../data/perf';
import { abeamPoint, circleCrossing, radialCrossing, type FixCrossing } from '../fixInfo';
import type { ClimbMode, CruiseMode, PerfModData } from '../Fmc';
import { INVALID_ENTRY, NOT_IN_DATABASE, boxes, fmtDist, fmtEta, fmtN1, fmtThousands, type CduPage } from './common';
import { legIdent } from './route';

const MAG = CduColor.Magenta;

// ================================================================== helpers

function spdTitle(kt: number, mach: number, useMach: boolean): string {
  if (useMach && Number.isFinite(mach)) return `M.${Math.round(mach * 1000)}`;
  if (Number.isFinite(kt)) return `${Math.round(kt)}KT`;
  return `M.${Math.round(mach * 1000)}`;
}

/** "280/.780" target speed text (kt / Mach); `machFirst` for the descent (".780/280"). */
function tgtSpd(kt: number, mach: number, altFt: number, machFirst = false): string {
  const x = crossoverAltFt(kt, mach);
  const k = altFt < 10000 ? Math.min(250, kt) : kt;
  if (altFt >= x) return `.${Math.round(mach * 1000)}`;
  return machFirst ? `.${Math.round(mach * 1000)}/${Math.round(k)}` : `${Math.round(k)}/.${Math.round(mach * 1000)}`;
}

function parseTgtSpeed(t: string): { kt: number; mach: number } | null {
  const parts = t.split('/');
  const out = { kt: NaN, mach: NaN };
  for (const p of parts) {
    if (!p) continue;
    const s = parseSpeed(p);
    if (!s) return null;
    if (Number.isFinite(s.kt)) out.kt = s.kt;
    if (Number.isFinite(s.mach)) out.mach = s.mach;
  }
  return Number.isFinite(out.kt) || Number.isFinite(out.mach) ? out : null;
}

function restText(r: PerfModData['clbRest']): string {
  return Number.isFinite(r.kt) ? `${r.kt}/${r.altFt}` : '---/-----';
}

function parseRest(t: string): { kt: number; altFt: number } | null {
  const m = /^(\d{3})\/(\d{3,5}|FL\d{3})$/.exec(t);
  if (!m) return null;
  const kt = Number(m[1]);
  const alt = parseAltitude(m[2]);
  if (kt < 100 || kt > 340 || !Number.isFinite(alt) || alt < 1000 || alt > 30000) return null;
  return { kt, altFt: alt };
}

/** Next leg (from the active one) with an altitude constraint in the given segments. */
function nextConstraint(c: Cdu, climb: boolean): { i: number; ident: string; text: string } | null {
  const f = c.fmc;
  const p = f.fms.plans.active;
  for (let i = Math.max(0, p.activeLegIndex); i < p.legs.length; i++) {
    const l = p.legs[i];
    if (l.type === 'DISCO' || l.segment === 'missed') continue;
    const desSeg = l.segment === 'arrival' || l.segment === 'approach' || l.segment === 'destination';
    if (climb && desSeg) return null;
    if (!climb && !desSeg && !Number.isFinite(l.geom.predictedAltFt)) continue;
    // Altitude-terminated legs (CA / VA / FA) end at an altitude; they are not constraints.
    if (!l.altitude || l.type === 'CA' || l.type === 'VA' || l.type === 'FA') continue;
    const a = l.altitude;
    const trans = climb ? f.transAltFt : f.transLvlFt;
    const at =
      a.kind === 'atOrAbove'
        ? `${fmtAlt(a.lowerFt ?? NaN, trans)}A`
        : a.kind === 'atOrBelow'
          ? `${fmtAlt(a.upperFt ?? NaN, trans)}B`
          : a.kind === 'between'
            ? `${fmtAlt(a.lowerFt ?? NaN, trans)}A${fmtAlt(a.upperFt ?? NaN, trans)}B`
            : fmtAlt(a.lowerFt ?? a.upperFt ?? NaN, trans);
    const sp = l.speed ? `${l.speed.kt}/` : '';
    return { i, ident: legIdent(l), text: `${sp}${at}` };
  }
  return null;
}

function etaDist(c: Cdu, distNm: number): string {
  const f = c.fmc;
  const gs = f.vars.get(GPS.gs);
  const eta = gs > 20 && Number.isFinite(distNm) ? f.utcH + distNm / gs : NaN;
  return `${fmtEta(eta)}/${fmtDist(distNm).padStart(4, ' ')}NM`;
}

function perfPrefix(c: Cdu, phase: 'CLB' | 'CRZ' | 'DES'): string {
  const f = c.fmc;
  if (f.perfMod) return 'MOD ';
  const cur = f.fms.vnav.phase;
  if (!f.hasActiveRoute) return '';
  if (phase === 'CLB' && (cur === 'CLB' || f.ground)) return 'ACT ';
  if (phase === cur || (phase === 'DES' && cur === 'APR')) return 'ACT ';
  return '';
}

// ================================================================== CLB

const CLB_MODES: ClimbMode[] = ['ECON', 'MAX RATE', 'MAX ANGLE'];

export const clbPage: CduPage = {
  id: 'clb',
  pages: () => 1,
  render(c, s) {
    const f = c.fmc;
    const pd = f.pd;
    const alt = f.altFt;
    const mode = pd.clbMode === 'SEL' ? spdTitle(pd.clbSel.kt, pd.clbSel.mach, alt >= crossoverAltFt(f.climbKt, f.climbMach)) : pd.clbMode;
    const pre = perfPrefix(c, 'CLB');
    s.title(`${pre}${mode} CLB`, 1, 1);
    if (pre === 'MOD ') s.put(0, Math.floor((24 - 3 - `${pre}${mode} CLB`.length) / 2), 'MOD', { reverse: true });
    s.labelL(1, 'CRZ ALT');
    s.dataL(1, Number.isFinite(pd.crzAltFt) ? fmtAlt(pd.crzAltFt, f.transAltFt) : boxes(5), { reverse: f.perfMod !== null && f.perfMod.crzAltFt !== f.perf.crzAltFt });
    const nc = nextConstraint(c, true);
    if (nc) {
      s.labelR(1, `AT ${nc.ident}`);
      s.dataR(1, nc.text);
    }
    s.labelL(2, 'TGT SPD');
    const act = pre === 'ACT ';
    s.dataL(2, tgtSpd(f.climbKt, f.climbMach, Math.max(alt, 10000)), { color: act ? MAG : CduColor.White });
    // TO: the constraint waypoint, else T/C.
    if (nc) {
      s.labelR(2, `TO ${nc.ident}`);
      s.dataR(2, etaDist(c, f.distToLeg(f.fms.plans.active, nc.i)));
    } else if (Number.isFinite(f.tocDistNm)) {
      s.labelR(2, 'TO T/C');
      s.dataR(2, etaDist(c, f.tocDistNm));
    }
    s.labelL(3, 'SPD REST');
    s.dataL(3, restText(pd.clbRest));
    const r = f.clbRating;
    s.labelR(4, `${r} N1`);
    s.dataR(4, fmtN1(f.n1Limit(r)));
    s.dashes(9);
    const alts = CLB_MODES.filter((m) => m !== pd.clbMode);
    s.dataL(5, `<${alts[0]}`);
    s.dataL(6, `<${alts[1]}`);
    if (f.perfMod) s.dataR(6, 'ERASE>');
  },
  lsk(c, k) {
    const f = c.fmc;
    const t = c.scratch.trim();
    if (k.side === 'L' && (k.row === 5 || k.row === 6)) {
      const alts = CLB_MODES.filter((m) => m !== f.pd.clbMode);
      const m = alts[k.row - 5];
      f.editPerf((p) => (p.clbMode = m));
      return;
    }
    if (k.side === 'R' && k.row === 6 && f.perfMod) return f.erase();
    if (k.side === 'L' && k.row === 1) return crzAltEntry(c, t);
    if (k.side === 'L' && k.row === 2) {
      const sp = parseTgtSpeed(t);
      if (!sp) return c.error(INVALID_ENTRY);
      f.editPerf((p) => {
        p.clbMode = 'SEL';
        p.clbSel = { kt: Number.isFinite(sp.kt) ? sp.kt : f.climbKt, mach: Number.isFinite(sp.mach) ? sp.mach : f.climbMach };
      });
      return c.consume();
    }
    if (k.side === 'L' && k.row === 3) {
      if (c.isDelete) {
        f.editPerf((p) => (p.clbRest = { kt: NaN, altFt: NaN }));
        return c.consume();
      }
      const r = parseRest(t);
      if (!r) return c.error(INVALID_ENTRY);
      f.editPerf((p) => (p.clbRest = r));
      return c.consume();
    }
  },
};

function crzAltEntry(c: Cdu, t: string): void {
  const f = c.fmc;
  if (!t) return;
  const alt = parseAltitude(t);
  if (!Number.isFinite(alt) || alt < 1000) return c.error(INVALID_ENTRY);
  if (alt > f.maxAltFt) return c.error(`MAX ALT FL${Math.round(f.maxAltFt / 100)}`);
  f.editPerf((p) => (p.crzAltFt = alt));
  c.consume();
}

// ================================================================== CRZ

export const crzPage: CduPage = {
  id: 'crz',
  pages: () => 1,
  render(c, s) {
    const f = c.fmc;
    const pd = f.pd;
    const alt = f.altFt;
    const mode = pd.crzMode === 'SEL' ? spdTitle(pd.crzSel.kt, pd.crzSel.mach, alt >= crossoverAltFt(f.cruiseKt, f.cruiseMach)) : pd.crzMode;
    const pre = perfPrefix(c, 'CRZ');
    let suffix = '';
    if (f.fms.vnav.phase === 'CRZ' && Number.isFinite(pd.crzAltFt) && !f.ground) {
      if (pd.crzAltFt > alt + 500) suffix = ' CLB';
      else if (pd.crzAltFt < alt - 500) suffix = ' DES';
    }
    s.title(`${pre}${mode} CRZ${suffix}`, 1, 1);
    if (pre === 'MOD ') s.put(0, Math.floor((24 - 3 - `${pre}${mode} CRZ${suffix}`.length) / 2), 'MOD', { reverse: true });
    s.labelL(1, 'CRZ ALT');
    s.dataL(1, Number.isFinite(pd.crzAltFt) ? fmtAlt(pd.crzAltFt, f.transAltFt) : boxes(5), { reverse: f.perfMod !== null && f.perfMod.crzAltFt !== f.perf.crzAltFt });
    s.labelR(1, 'OPT/MAX');
    s.dataR(1, `FL${Math.round(f.optAltFt / 100)}/${Math.round(f.maxAltFt / 100)}`);
    s.labelL(2, 'TGT SPD');
    s.dataL(2, tgtSpd(f.cruiseKt, f.cruiseMach, Math.max(alt, Number.isFinite(pd.crzAltFt) ? pd.crzAltFt : 35000)), { color: pre === 'ACT ' ? MAG : CduColor.White });
    const tod = f.vars.get(FMS.todDistNm);
    if (tod > 0) {
      s.labelR(2, 'TO T/D');
      s.dataR(2, etaDist(c, tod));
    }
    // Turbulence penetration N1: EST ~8 points below the cruise N1 limit (typical QRH turbulent air N1 at cruise levels).
    s.labelL(3, 'TURB N1');
    s.dataL(3, fmtN1(f.n1Limit('CRZ') - 8));
    s.labelR(3, 'ACTUAL WIND');
    const w = f.wind;
    s.dataR(3, Number.isFinite(w.dirMag) ? `${String(Math.round(w.dirMag) % 360 || 360).padStart(3, '0')}°/${String(Math.round(w.kt)).padStart(3, ' ')}` : '---°/---');
    const dest = f.fms.plans.active.destination?.icao ?? '----';
    s.labelL(4, `FUEL AT ${dest}`);
    const fd = f.vars.get(FMS.fuelDestKg);
    s.dataL(4, fd > 0 ? fmtThousands(fd, f.cfg.weightUnit) : '--.-');
    s.dashes(9);
    if (pd.crzMode !== 'ECON') s.dataL(5, '<ECON');
    s.dataL(6, pd.crzMode === 'LRC' ? '' : '<LRC');
    if (f.perfMod) s.dataR(6, 'ERASE>');
  },
  lsk(c, k) {
    const f = c.fmc;
    const t = c.scratch.trim();
    if (k.side === 'L' && k.row === 5 && f.pd.crzMode !== 'ECON') {
      f.editPerf((p) => (p.crzMode = 'ECON'));
      return;
    }
    if (k.side === 'L' && k.row === 6 && f.pd.crzMode !== 'LRC') {
      f.editPerf((p) => (p.crzMode = 'LRC' as CruiseMode));
      return;
    }
    if (k.side === 'R' && k.row === 6 && f.perfMod) return f.erase();
    if (k.side === 'L' && k.row === 1) return crzAltEntry(c, t);
    if (k.side === 'L' && k.row === 2) {
      const sp = parseTgtSpeed(t);
      if (!sp) return c.error(INVALID_ENTRY);
      f.editPerf((p) => {
        p.crzMode = 'SEL';
        p.crzSel = { kt: Number.isFinite(sp.kt) ? sp.kt : f.cruiseKt, mach: Number.isFinite(sp.mach) ? sp.mach : f.cruiseMach };
      });
      return c.consume();
    }
  },
};

// ================================================================== DES

export const desPage: CduPage = {
  id: 'des',
  pages: () => 1,
  render(c, s) {
    const f = c.fmc;
    const v = f.vars;
    const pd = f.pd;
    const alt = f.altFt;
    const prof = f.fms.vnav.profile;
    const kind = prof.valid ? 'PATH DES' : 'SPD DES';
    const mode = pd.desMode === 'SEL' ? spdTitle(pd.desSel.kt, pd.desSel.mach, alt >= crossoverAltFt(f.descentKt, f.descentMach)) : 'ECON';
    const pre = perfPrefix(c, 'DES');
    s.title(`${pre}${mode} ${kind}`, 1, 1);
    if (pre === 'MOD ') s.put(0, Math.floor((24 - 3 - `${pre}${mode} ${kind}`.length) / 2), 'MOD', { reverse: true });
    s.labelL(1, 'E/D ALT');
    s.dataL(1, prof.valid && Number.isFinite(prof.eodAltFt) ? fmtAlt(prof.eodAltFt, f.transLvlFt) : '-----');
    const nc = nextConstraint(c, false);
    if (nc) {
      s.labelR(1, `AT ${nc.ident}`);
      s.dataR(1, nc.text);
    }
    s.labelL(2, 'TGT SPD');
    s.dataL(2, tgtSpd(f.descentKt, f.descentMach, Math.max(alt, 10000), true), { color: pre === 'ACT ' ? MAG : CduColor.White });
    const tod = v.get(FMS.todDistNm);
    const phase = f.fms.vnav.phase;
    if ((phase === 'CRZ' || phase === 'CLB') && tod > 0) {
      s.labelR(2, 'TO T/D');
      s.dataR(2, etaDist(c, tod));
    } else if (nc) {
      s.labelR(2, `TO ${nc.ident}`);
      s.dataR(2, etaDist(c, f.distToLeg(f.fms.plans.active, nc.i)));
    }
    s.labelL(3, 'SPD REST');
    s.dataL(3, restText(pd.desRest));
    // WPT/ALT and the vertical bearing to it.
    const wa = f.desWptAlt ?? (nc ? { ident: nc.ident, altFt: constraintAlt(c, nc.i) } : null);
    s.labelR(3, 'WPT/ALT');
    s.dataR(3, wa ? `${wa.ident}/${fmtAlt(wa.altFt, f.transLvlFt)}` : '-----/-----');
    s.put(7, 12, 'FPA', { small: true });
    s.put(7, 16, 'V/B', { small: true });
    s.put(7, 21, 'V/S', { small: true });
    const gs = Math.max(1, v.get(GPS.gs));
    const vs = v.get(ADC.vs(f.cfg.adiru[0]));
    const fpa = (Math.atan2(-vs, gs * 101.27) * 180) / Math.PI;
    let vb = NaN;
    let vsReq = NaN;
    if (wa) {
      const idx = f.fms.plans.active.legs.findIndex((l) => l.fix?.ident === wa.ident);
      const d = idx >= 0 ? f.distToLeg(f.fms.plans.active, idx) : NaN;
      if (Number.isFinite(d) && d > 0.1 && alt > wa.altFt) {
        vb = (Math.atan2(alt - wa.altFt, d * 6076.1) * 180) / Math.PI;
        vsReq = Math.tan((vb * Math.PI) / 180) * gs * 101.27;
      }
    }
    s.put(8, 11, Math.abs(fpa).toFixed(1).padStart(4, ' '), { small: false });
    s.put(8, 15, (Number.isFinite(vb) ? vb.toFixed(1) : '---').padStart(4, ' '), { small: false });
    s.put(8, 20, (Number.isFinite(vsReq) ? String(Math.round(vsReq)) : '---').padStart(4, ' '), { small: false });
    s.dashes(9);
    if (pd.desMode !== 'ECON') s.dataL(5, '<ECON');
    s.dataL(6, '<FORECAST');
    if (f.perfMod) s.dataR(6, 'ERASE>');
    else if (phase === 'CRZ' && !f.ground && f.hasActiveRoute) s.dataR(6, f.desNow ? 'DES NOW' : 'DES NOW>', { color: f.desNow ? CduColor.Green : CduColor.White });
  },
  lsk(c, k) {
    const f = c.fmc;
    const t = c.scratch.trim();
    if (k.side === 'L' && k.row === 5 && f.pd.desMode !== 'ECON') {
      f.editPerf((p) => (p.desMode = 'ECON'));
      return;
    }
    if (k.side === 'L' && k.row === 6) return c.show('desForecast');
    if (k.side === 'R' && k.row === 6) {
      if (f.perfMod) return f.erase();
      if (f.fms.vnav.phase === 'CRZ' && !f.ground) {
        f.desNow = true;
        f.version++;
      }
      return;
    }
    if (k.side === 'L' && k.row === 2) {
      const sp = parseTgtSpeed(t);
      if (!sp) return c.error(INVALID_ENTRY);
      f.editPerf((p) => {
        p.desMode = 'SEL';
        p.desSel = { kt: Number.isFinite(sp.kt) ? Math.min(340, sp.kt) : f.descentKt, mach: Number.isFinite(sp.mach) ? sp.mach : f.descentMach };
      });
      return c.consume();
    }
    if (k.side === 'L' && k.row === 3) {
      if (c.isDelete) {
        f.editPerf((p) => (p.desRest = { kt: NaN, altFt: NaN }));
        return c.consume();
      }
      const r = parseRest(t);
      if (!r) return c.error(INVALID_ENTRY);
      f.editPerf((p) => (p.desRest = r));
      return c.consume();
    }
    if (k.side === 'R' && k.row === 3) {
      if (c.isDelete) {
        f.desWptAlt = null;
        return c.consume();
      }
      const m = /^([A-Z0-9]{2,5})\/(.+)$/.exec(t);
      if (!m) return c.error(INVALID_ENTRY);
      const alt = parseAltitude(m[2]);
      if (!Number.isFinite(alt)) return c.error(INVALID_ENTRY);
      if (!f.fms.plans.active.legs.some((l) => l.fix?.ident === m[1])) return c.error(NOT_IN_DATABASE);
      f.desWptAlt = { ident: m[1], altFt: alt };
      return c.consume();
    }
  },
};

function constraintAlt(c: Cdu, i: number): number {
  const a = c.fmc.fms.plans.active.legs[i]?.altitude;
  if (!a) return NaN;
  return a.kind === 'atOrAbove' ? a.lowerFt ?? NaN : a.kind === 'atOrBelow' ? a.upperFt ?? NaN : a.lowerFt ?? a.upperFt ?? NaN;
}

// ================================================================== DES FORECAST

export const desForecastPage: CduPage = {
  id: 'desForecast',
  pages: () => 1,
  render(c, s) {
    const f = c.fmc;
    s.title('DES FORECASTS', 1, 1);
    s.labelL(1, 'TRANS LVL');
    s.dataL(1, `FL${String(Math.round(f.transLvlFt / 100)).padStart(3, '0')}`);
    s.labelR(1, 'TAI/ON ALT');
    s.dataR(1, '-----');
    s.labelL(2, 'CABIN RATE');
    s.dataL(2, '---FPM', { small: true });
    s.labelL(3, 'ALT');
    s.labelR(3, 'WIND DIR/SPD');
    f.desForecast.forEach((e, i) => {
      const k = i + 3;
      s.dataL(k, Number.isFinite(e.altFt) ? fmtAlt(e.altFt, f.transLvlFt) : '------');
      s.dataR(k, Number.isFinite(e.dir) ? `${String(Math.round(e.dir) % 360).padStart(3, '0')}°/${String(Math.round(e.kt)).padStart(3, ' ')}` : '---°/---');
    });
    s.dashes(11);
    s.dataL(6, '<DES');
  },
  lsk(c, k) {
    const f = c.fmc;
    const t = c.scratch.trim();
    if (k.side === 'L' && k.row === 6) return c.show('des');
    if (k.side === 'L' && k.row === 1) {
      const a = parseAltitude(t);
      if (!Number.isFinite(a) || a < 1000 || a > 30000) return c.error(INVALID_ENTRY);
      f.transLvlFt = a;
      return c.consume();
    }
    if (k.row >= 3 && k.row <= 5) {
      const e = f.desForecast[k.row - 3];
      if (c.isDelete) {
        if (k.side === 'L') e.altFt = NaN;
        else {
          e.dir = NaN;
          e.kt = NaN;
        }
        return c.consume();
      }
      if (k.side === 'L') {
        const a = parseAltitude(t);
        if (!Number.isFinite(a)) return c.error(INVALID_ENTRY);
        e.altFt = a;
      } else {
        const w = parseWind(t);
        if (!w) return c.error(INVALID_ENTRY);
        e.dir = w.dir;
        e.kt = w.kt;
      }
      return c.consume();
    }
  },
};

// ================================================================== PROGRESS

function hhmm(h: number): string {
  if (!Number.isFinite(h)) return '----z';
  const t = ((h % 24) + 24) % 24;
  const hh = Math.floor(t);
  const mm = Math.floor((t - hh) * 60);
  return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}z`;
}

export const progPage: CduPage = {
  id: 'prog',
  pages: () => 3,
  render(c, s) {
    const f = c.fmc;
    const v = f.vars;
    const u = f.cfg.weightUnit;
    const p = f.fms.plans.active;
    const flt = f.flightNumber ? `${f.flightNumber} ` : '';
    if (c.sub === 0) {
      s.title(`${flt}PROGRESS`, 1, 3);
      s.labelL(1, 'FROM');
      s.put(1, 9, 'ALT', { small: true });
      s.put(1, 14, 'ATA', { small: true });
      s.put(1, 20, 'FUEL', { small: true });
      const lp = f.lastPassed;
      if (lp) {
        s.dataL(1, lp.ident);
        s.put(2, 7, fmtAlt(Math.round(lp.altFt / 100) * 100, f.transAltFt).padStart(5, ' '), { small: false });
        s.put(2, 13, hhmm(lp.utcH), { small: false });
        s.dataR(1, fmtThousands(lp.fuelKg, u));
      }
      s.put(3, 9, 'DTG', { small: true });
      s.put(3, 14, 'ETA', { small: true });
      s.put(3, 20, 'FUEL', { small: true });
      const row = (k: number, i: number, color: CduColor): void => {
        const l = p.legs[i];
        if (!l) return;
        s.dataL(k, legIdent(l), { color });
        const d = f.distToLeg(p, i);
        s.put(2 * k, 12 - fmtDist(d).length, fmtDist(d), { small: false });
        s.put(2 * k, 13, hhmm(f.etaLeg(p, i)), { small: false });
        const fu = f.fuelLeg(p, i);
        s.dataR(k, Number.isFinite(fu) ? fmtThousands(fu, u) : '--.-');
      };
      const a = p.activeLegIndex;
      if (a >= 0) {
        row(2, a, MAG);
        let n = a + 1;
        const actFix = p.legs[a]?.fix?.ident;
        while (n < p.legs.length && (p.legs[n].type === 'DISCO' || (p.legs[n].fix?.ident === actFix && p.legs[n].type.startsWith('H')))) n++;
        if (n < p.legs.length) row(3, n, CduColor.White);
        const last = p.lastNonMissedIndex;
        if (last > n) {
          row(4, last, CduColor.White);
          // The destination line shows the airport.
          if (p.destination) s.put(8, 0, `${p.destination.icao}  `.slice(0, 6), { small: false });
        }
      }
      // TO T/C or T/D.
      const tod = v.get(FMS.todDistNm);
      if (Number.isFinite(f.tocDistNm) && f.fms.vnav.phase === 'CLB') {
        s.labelL(5, 'TO T/C');
        s.dataL(5, etaDist(c, f.tocDistNm));
      } else if (tod > 0) {
        s.labelL(5, 'TO T/D');
        s.dataL(5, etaDist(c, tod));
      }
      s.labelR(5, 'FUEL QTY');
      s.dataR(5, fmtThousands(f.fuelKg, u));
      s.labelL(6, 'VOR L');
      s.center(11, v.getBool(GPS.valid) ? 'GPS-L' : 'IRS(L)', { small: true });
      s.labelR(6, 'VOR R');
      const nav = (r: number): string => {
        const fq = v.get(NAV.activeFreq(r));
        return `${v.getString(NAV.ident(r)) || '---'} ${fq > 0 ? fq.toFixed(2) : '---.--'}`;
      };
      s.dataL(6, nav(1), { small: true });
      s.dataR(6, nav(2), { small: true });
      return;
    }
    if (c.sub === 1) {
      s.title(`${flt}PROGRESS`, 2, 3);
      const w = f.wind;
      s.labelL(1, w.headKt >= 0 || !Number.isFinite(w.headKt) ? 'HEADWIND' : 'TAILWIND');
      s.dataL(1, Number.isFinite(w.headKt) ? `${Math.round(Math.abs(w.headKt))}KT` : '---KT');
      s.labelR(1, 'CROSSWIND');
      s.dataR(1, Number.isFinite(w.crossKt) ? `${w.crossKt >= 0 ? 'R' : 'L'} ${Math.round(Math.abs(w.crossKt))}KT` : '---KT');
      s.labelL(2, 'WIND');
      s.dataL(2, Number.isFinite(w.dirMag) ? `${String(Math.round(w.dirMag) % 360 || 360).padStart(3, '0')}°/${String(Math.round(w.kt)).padStart(3, ' ')}` : '---°/---');
      s.labelR(2, 'SAT/ISA DEV');
      const sat = f.oatC;
      const isa = f.isaDevC;
      const sg = (x: number): string => `${x >= 0 ? '+' : '-'}${String(Math.abs(Math.round(x))).padStart(2, '0')}`;
      s.dataR(2, `${sg(sat)}°C/${sg(isa)}°C`);
      s.labelL(3, 'XTK ERROR');
      const xtk = v.get(FMS.xtkNm);
      s.dataL(3, p.activeLegIndex >= 0 ? `${xtk >= 0 ? 'R' : 'L'} ${Math.abs(xtk).toFixed(1)}NM` : '-.-NM');
      s.labelR(3, 'VERT DEV');
      const vd = v.get(FMS.vnavDevFt);
      s.dataR(3, v.get(FMS.vnavValid) !== 0 ? `${Math.round(Math.abs(vd))}${vd >= 0 ? 'HI' : 'LO'}` : '----');
      s.labelL(4, 'TAS');
      s.dataL(4, `${Math.round(v.get(ADC.tas(f.cfg.adiru[0])))}KT`);
      s.labelR(4, 'FUEL USED');
      const fu1 = v.get('ac.eng1.fuel_used_kg');
      const fu2 = v.get('ac.eng2.fuel_used_kg');
      s.dataR(4, `${fmtThousands(fu1, u)} ${fmtThousands(fu2, u)} ${fmtThousands(fu1 + fu2, u)}`);
      s.labelL(5, 'FUEL QTY');
      s.dataL(5, `${fmtThousands(f.fuelKg, u)} TOTALIZER`);
      s.dashes(11);
      return;
    }
    s.title('RNP PROGRESS', 3, 3);
    s.labelL(1, 'RNP/ACTUAL');
    const rnp = f.rnp();
    const anp = v.get('ac.fmc.anp_nm');
    s.dataL(1, `${rnp.toFixed(2)}/${anp.toFixed(2)}NM`, { color: Number.isFinite(f.rnpManual) ? CduColor.White : CduColor.White });
    s.labelR(1, 'XTK ERROR');
    const xtk = v.get(FMS.xtkNm);
    s.dataR(1, `${xtk >= 0 ? 'R' : 'L'}${Math.abs(xtk).toFixed(2)}NM`);
    s.labelL(2, 'RNP/ACTUAL');
    s.dataL(2, ' 400/  30FT', { small: true });
    s.labelR(2, 'VERT DEV');
    const vd = v.get(FMS.vnavDevFt);
    s.dataR(2, v.get(FMS.vnavValid) !== 0 ? `${Math.round(Math.abs(vd))}${vd >= 0 ? 'HI' : 'LO'}` : '----');
    s.labelL(3, 'POS UPDATE');
    s.dataL(3, v.getBool(GPS.valid) ? 'GPS' : 'IRS');
    s.labelL(4, 'FMC POS');
    s.dataL(4, fmtLatLon(v.get(GPS.lat), v.get(GPS.lon)), { small: true });
    s.dashes(11);
  },
  lsk(c, k) {
    const f = c.fmc;
    if (c.sub === 2 && k.side === 'L' && k.row === 1) {
      if (c.isDelete) {
        f.rnpManual = NaN;
        return c.consume();
      }
      const n = Number(c.scratch.trim());
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(c.scratch.trim()) || n < 0.1 || n > 20) return c.error(INVALID_ENTRY);
      f.rnpManual = n;
      return c.consume();
    }
  },
};

// ================================================================== FIX INFO

function crossingText(x: FixCrossing | null, c: Cdu): string {
  if (!x) return '';
  const f = c.fmc;
  const gs = f.vars.get(GPS.gs);
  const eta = gs > 20 ? f.utcH + x.dtgNm / gs : NaN;
  const alt = Number.isFinite(x.altFt) ? fmtAlt(Math.round(x.altFt / 100) * 100, f.transAltFt) : '';
  return `${hhmm(eta)} ${fmtDist(x.dtgNm).padStart(4, ' ')} ${alt}`;
}

export const fixPage: CduPage = {
  id: 'fix',
  pages: () => 2,
  render(c, s) {
    const f = c.fmc;
    const v = f.vars;
    s.title('FIX INFO', c.sub + 1, 2);
    const fx = f.fixInfo[c.sub];
    s.labelL(1, 'FIX');
    s.dataL(1, fx?.ident ?? boxes(5));
    s.put(1, 10, 'RAD/DIS FR', { small: true });
    if (!fx) {
      s.dashes(11);
      return;
    }
    const la = v.get(GPS.lat);
    const lo = v.get(GPS.lon);
    const brg = ((Math.atan2((lo - fx.lon) * Math.cos((fx.lat * Math.PI) / 180), la - fx.lat) * 180) / Math.PI + 360 - fx.magVar) % 360;
    const dist = Math.hypot((lo - fx.lon) * Math.cos((fx.lat * Math.PI) / 180), la - fx.lat) * 60;
    s.put(2, 10, `${String(Math.round(brg) % 360).padStart(3, '0')}/${dist < 10 ? dist.toFixed(1) : Math.round(dist)}`, { small: false });
    s.put(3, 0, ' RAD/DIS  ETA   DTG  ALT', { small: true });
    const plan = f.fms.plans.active;
    const along = f.fms.alongNm;
    const crz = f.perf.crzAltFt;
    for (let r = 0; r < 3; r++) {
      const k = r + 2;
      const rad = fx.radials[r];
      const dis = fx.distancesNm[r];
      if (Number.isFinite(rad)) {
        const x = radialCrossing(plan, fx.lat, fx.lon, fx.magVar, rad, along, crz);
        s.dataL(k, `${String(Math.round(rad)).padStart(3, '0')}/${x ? fmtDist(x.distNm) : '---'}`);
        s.dataR(k, crossingText(x, c), { small: true });
      } else if (Number.isFinite(dis)) {
        const x = circleCrossing(plan, fx.lat, fx.lon, fx.magVar, dis, along, crz);
        s.dataL(k, `${x ? String(Math.round(x.radialMag)).padStart(3, '0') : '---'}/${fmtDist(dis)}`);
        s.dataR(k, crossingText(x, c), { small: true });
      } else s.dataL(k, '---/---');
    }
    s.labelL(5, 'ABEAM');
    if (fx.abeam) {
      const x = abeamPoint(plan, fx.lat, fx.lon, fx.magVar, along, crz);
      if (x) {
        s.dataL(5, `${String(Math.round(x.radialMag)).padStart(3, '0')}/${fmtDist(x.distNm)}`);
        s.dataR(5, crossingText(x, c), { small: true });
      } else s.dataL(5, '---/---');
    } else s.dataL(5, '<ABEAM');
    s.dashes(11);
    s.dataL(6, '<ERASE FIX');
  },
  lsk(c, k) {
    const f = c.fmc;
    const t = c.scratch.trim();
    const i = c.sub;
    if (k.side !== 'L') return;
    if (k.row === 1) {
      if (c.isDelete) {
        f.fixInfo[i] = null;
        return c.consume();
      }
      if (!t) return;
      if (!f.setFix(i, t)) return c.error(NOT_IN_DATABASE);
      return c.consume();
    }
    const fx = f.fixInfo[i];
    if (!fx) return;
    if (k.row === 6) {
      f.fixInfo[i] = null;
      f.version++;
      return;
    }
    if (k.row === 5) {
      fx.abeam = !c.isDelete;
      if (c.isDelete) c.consume();
      return;
    }
    const r = k.row - 2;
    if (c.isDelete) {
      fx.radials[r] = NaN;
      fx.distancesNm[r] = NaN;
      return c.consume();
    }
    const m = /^(\d{1,3})?(?:\/(\d{1,3}(\.\d)?))?$/.exec(t);
    if (!t || !m || (!m[1] && !m[2])) return c.error(INVALID_ENTRY);
    if (m[1] && !m[2]) {
      const rad = Number(m[1]);
      if (rad > 360) return c.error(INVALID_ENTRY);
      fx.radials[r] = rad % 360;
      fx.distancesNm[r] = NaN;
    } else if (m[2]) {
      const d = Number(m[2]);
      if (d <= 0 || d > 700) return c.error(INVALID_ENTRY);
      fx.distancesNm[r] = d;
      fx.radials[r] = NaN;
    }
    f.version++;
    c.consume();
  },
};
