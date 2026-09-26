/**
 * MCDU performance pages: PERF INDEX, PERF INIT (3 pages), VNAV SETUP
 * (climb / cruise / descent), PROGRESS (3 pages), FUEL MGT.
 *
 * code450 "FMS Procedures" / "VNAV": "Select PERF INIT (LSK 1L) then
 * progress through pages entering aircraft type, tail number, speed
 * schedules, fuel reserves, and cruise altitude"; "VNAV does not function
 * until all PERFORMANCE INIT information has been programmed into the MCDU.
 * When any of the PERFORMANCE INIT data is incomplete and VNAV is armed, a
 * PERF-VNAV UNAVAILABLE message is displayed"; RNP: "PERF -> PROGRESS ->
 * RNP (LSK 6L)"; lateral offset on PROGRESS 3. VPATH angles "from 1 to 6
 * deg" (code450 VNAV). FMS TOLD is not installed on the G700/G800 (FAA
 * FSB GVIII-G700 App. 4) and is not modelled.
 * Weights and fuel are shown in lb (Gulfstream convention); the sim's fuel
 * vars are kg (1 kg = 2.20462 lb).
 */
import { ADC, ENG, FMS, FUEL, GPS } from '../../../core/vars';
import type { CduPage, Mcdu } from './mcdu';
import { fmtAlt, fmtEte, fmtTime, parseAltitude, parseSpeedPair, type LskId } from './cdu';

const LB = 2.20462;

function fuelLb(m: Mcdu): number {
  return m.vars.get(FUEL.totalKg) * LB;
}

function totalFf(m: Mcdu): number {
  let ff = 0;
  for (let i = 1; i <= m.shared.cfg.engines.count; i++) ff += m.vars.get(ENG.fuelFlowPph(i));
  return ff;
}

function spdPair(kt: number, mach: number): string {
  const a = Number.isFinite(kt) ? Math.round(kt).toString() : '---';
  const b = Number.isFinite(mach) ? `.${Math.round(mach * 100).toString().padStart(2, '0')}` : '.--';
  return `${a}/${b}`;
}

export const PERF_INDEX_PAGE: CduPage = {
  id: 'PERF_INDEX',
  refreshS: 0,
  render(_m, s) {
    s.title = 'PERF INDEX';
    s.dataL(1, '<PERF INIT', 'white');
    s.dataL(2, '<VNAV SETUP', 'white');
    s.dataL(3, '<PROGRESS', 'white');
    s.dataL(4, '<FUEL MGT', 'white');
    s.dataR(1, 'FLT PLAN>', 'white');
  },
  lsk(m, k) {
    const map: Partial<Record<LskId, string>> = { L1: 'PERF_INIT', L2: 'VNAV', L3: 'PROG', L4: 'FUEL_MGT', R1: 'FPL' };
    const id = map[k];
    if (id) m.show(id);
  },
};

export const PERF_INIT_PAGE: CduPage = {
  id: 'PERF_INIT',
  refreshS: 1,
  pages: () => 3,
  render(m, s, sub) {
    const p = m.shared.perf;
    s.title = 'PERF INIT';
    if (sub === 0) {
      s.labelL(1, 'ACFT TYPE');
      s.dataL(1, p.acftType, 'green');
      s.labelR(1, 'TAIL #');
      s.dataR(1, p.tail, 'cyan');
      s.labelL(2, 'CLIMB');
      s.dataL(2, spdPair(p.climbKt, p.climbMach), 'cyan');
      s.labelL(3, 'CRUISE');
      s.dataL(3, spdPair(p.cruiseKt, p.cruiseMach), 'cyan');
      s.labelL(4, 'DESCENT');
      s.dataL(4, spdPair(p.descentKt, p.descentMach), 'cyan');
      s.labelL(5, 'TRANS ALT');
      s.dataL(5, Math.round(p.transAltFt).toString(), 'cyan');
      s.labelR(2, 'SPD/ALT LIM');
      s.dataR(2, `${p.speedLimitKt}/${Math.round(p.speedLimitAltFt)}`, 'cyan');
      s.labelR(3, 'CRZ ALT');
      s.dataR(3, Number.isFinite(p.cruiseAltFt) ? fmtAlt(p.cruiseAltFt, p.transAltFt) : '□□□□□', Number.isFinite(p.cruiseAltFt) ? 'cyan' : 'amber');
    } else if (sub === 1) {
      const fuel = fuelLb(m);
      s.labelL(1, 'BOW');
      s.dataL(1, Number.isFinite(p.bowLb) ? Math.round(p.bowLb).toString() : '□□□□□', Number.isFinite(p.bowLb) ? 'cyan' : 'amber');
      s.labelL(2, 'FUEL');
      s.dataL(2, Math.round(fuel).toString(), 'green');
      s.labelL(3, 'PASS/CARGO');
      s.dataL(3, Number.isFinite(p.paxCargoLb) ? Math.round(p.paxCargoLb).toString() : '□□□□□', Number.isFinite(p.paxCargoLb) ? 'cyan' : 'amber');
      const zfw = p.bowLb + p.paxCargoLb;
      s.labelL(4, 'ZFW');
      s.dataL(4, Number.isFinite(zfw) ? Math.round(zfw).toString() : '-----', 'green');
      s.labelL(5, 'GROSS WT');
      s.dataL(5, Number.isFinite(zfw) ? Math.round(zfw + fuel).toString() : '-----', 'green');
      s.labelR(1, 'RESERVES');
      s.dataR(1, Math.round(p.reservesLb).toString(), 'cyan');
    } else {
      const ok = Number.isFinite(p.bowLb) && Number.isFinite(p.paxCargoLb) && Number.isFinite(p.cruiseAltFt);
      s.labelL(1, 'CRZ ALT');
      s.dataL(1, Number.isFinite(p.cruiseAltFt) ? fmtAlt(p.cruiseAltFt, p.transAltFt) : '-----', 'green');
      s.labelL(2, 'GROSS WT');
      const gw = p.bowLb + p.paxCargoLb + fuelLb(m);
      s.dataL(2, Number.isFinite(gw) ? Math.round(gw).toString() : '-----', 'green');
      s.dataC(4, p.confirmed ? 'PERF INIT COMPLETE' : ok ? '' : 'INCOMPLETE DATA', p.confirmed ? 'green' : 'amber', true);
      s.dataR(6, 'CONFIRM INIT>', ok ? 'white' : 'grey');
    }
    s.dataL(6, '<PERF INDEX', 'white');
  },
  lsk(m, k, sub) {
    const p = m.shared.perf;
    const t = m.scratch.trim();
    if (k === 'L6') return m.show('PERF_INDEX');
    const done = (): void => {
      m.take();
      m.shared.applyPerf();
    };
    if (sub === 0) {
      if (k === 'R1' && t) {
        p.tail = m.take().slice(0, 7);
        return m.shared.applyPerf();
      }
      if ((k === 'L2' || k === 'L3' || k === 'L4') && t) {
        const s = parseSpeedPair(t);
        if (!s) return m.error();
        if (k === 'L2') {
          if (Number.isFinite(s.kt)) p.climbKt = s.kt;
          if (Number.isFinite(s.mach)) p.climbMach = s.mach;
        } else if (k === 'L3') {
          if (Number.isFinite(s.kt)) p.cruiseKt = s.kt;
          if (Number.isFinite(s.mach)) p.cruiseMach = s.mach;
        } else {
          if (Number.isFinite(s.kt)) p.descentKt = s.kt;
          if (Number.isFinite(s.mach)) p.descentMach = s.mach;
        }
        return done();
      }
      if (k === 'L5' && t) {
        const a = parseAltitude(t);
        if (!(a >= 1000 && a <= 18000)) return m.error();
        p.transAltFt = a;
        return done();
      }
      if (k === 'R2' && t) {
        const [a, b] = t.split('/');
        const kt = Number(a);
        const alt = parseAltitude(b ?? '');
        if (!(kt >= 150 && kt <= 300) || !Number.isFinite(alt)) return m.error();
        p.speedLimitKt = kt;
        p.speedLimitAltFt = alt;
        return done();
      }
      if (k === 'R3' && t) {
        const a = parseAltitude(t);
        if (!(a >= 1000 && a <= 51000)) return m.error();
        p.cruiseAltFt = a;
        return done();
      }
    } else if (sub === 1) {
      const n = Number(t);
      if (k === 'L1' && t) {
        if (!(n > 20000 && n < 80000)) return m.error();
        p.bowLb = n;
        return done();
      }
      if (k === 'L3' && t) {
        if (!(n >= 0 && n < 20000)) return m.error();
        p.paxCargoLb = n;
        return done();
      }
      if (k === 'R1' && t) {
        if (!(n >= 0 && n < 20000)) return m.error();
        p.reservesLb = n;
        return done();
      }
    } else if (k === 'R6') {
      if (!(Number.isFinite(p.bowLb) && Number.isFinite(p.paxCargoLb) && Number.isFinite(p.cruiseAltFt))) return m.error('INCOMPLETE DATA');
      p.confirmed = true;
      m.shared.applyPerf();
    }
  },
};

export const VNAV_PAGE: CduPage = {
  id: 'VNAV',
  refreshS: 1,
  pages: () => 3,
  render(m, s, sub) {
    const p = m.shared.perf;
    const v = m.vars;
    s.title = sub === 0 ? 'VNAV CLIMB' : sub === 1 ? 'VNAV CRUISE' : 'VNAV DESCENT';
    if (sub === 0) {
      s.labelL(1, 'TGT SPEED');
      s.dataL(1, spdPair(p.climbKt, p.climbMach), 'cyan');
      s.labelL(2, 'SPD/ALT LIM');
      s.dataL(2, `${p.speedLimitKt}/${Math.round(p.speedLimitAltFt)}`, 'cyan');
    } else if (sub === 1) {
      s.labelL(1, 'CRZ ALT');
      s.dataL(1, Number.isFinite(p.cruiseAltFt) ? fmtAlt(p.cruiseAltFt, p.transAltFt) : '□□□□□', Number.isFinite(p.cruiseAltFt) ? 'cyan' : 'amber');
      s.labelL(2, 'CRZ SPEED');
      s.dataL(2, spdPair(p.cruiseKt, p.cruiseMach), 'cyan');
    } else {
      s.labelL(1, 'TGT SPEED');
      s.dataL(1, spdPair(p.descentKt, p.descentMach), 'cyan');
      s.labelL(2, 'SPD/ALT LIM');
      s.dataL(2, `${p.speedLimitKt}/${Math.round(p.speedLimitAltFt)}`, 'cyan');
      const plan = m.shared.plan;
      s.labelL(3, 'VPA');
      s.dataL(3, plan ? `${plan.descentFpaDeg.toFixed(1)}°` : '-.-°', 'cyan');
      const tod = v.get(FMS.todDistNm);
      s.labelR(1, 'TOD');
      s.dataR(1, tod > 0 ? `${tod.toFixed(1)}NM` : '----', 'green');
      s.labelR(2, 'VS REQ');
      s.dataR(2, v.get(FMS.vnavValid) !== 0 ? Math.round(v.get(FMS.vsRequiredFpm)).toString() : '----', 'green');
    }
    s.dataL(6, '<PERF INDEX', 'white');
  },
  lsk(m, k, sub) {
    const p = m.shared.perf;
    const t = m.scratch.trim();
    if (k === 'L6') return m.show('PERF_INDEX');
    if (!t) return;
    if (k === 'L1' && sub !== 1) {
      const s = parseSpeedPair(t);
      if (!s) return m.error();
      if (sub === 0) {
        if (Number.isFinite(s.kt)) p.climbKt = s.kt;
        if (Number.isFinite(s.mach)) p.climbMach = s.mach;
      } else {
        if (Number.isFinite(s.kt)) p.descentKt = s.kt;
        if (Number.isFinite(s.mach)) p.descentMach = s.mach;
      }
      m.take();
      m.shared.applyPerf();
    } else if (k === 'L1' && sub === 1) {
      const a = parseAltitude(t);
      if (!(a >= 1000 && a <= 51000)) return m.error();
      p.cruiseAltFt = a;
      m.take();
      m.shared.applyPerf();
    } else if (k === 'L2' && sub === 1) {
      const s = parseSpeedPair(t);
      if (!s) return m.error();
      if (Number.isFinite(s.kt)) p.cruiseKt = s.kt;
      if (Number.isFinite(s.mach)) p.cruiseMach = s.mach;
      m.take();
      m.shared.applyPerf();
    } else if (k === 'L3' && sub === 2) {
      const a = Number(t);
      if (!(a >= 1 && a <= 6)) return m.error();
      m.take();
      m.shared.edit((q) => {
        q.descentFpaDeg = a;
        q.touch();
      });
    }
  },
};

export const PROG_PAGE: CduPage = {
  id: 'PROG',
  refreshS: 1,
  pages: () => 3,
  render(m, s, sub) {
    const v = m.vars;
    const fms = m.shared.fms;
    s.title = 'PROGRESS';
    if (sub === 0) {
      const lbPerKg = LB;
      s.labelL(1, 'TO');
      s.labelC(1, 'DIST');
      s.labelR(1, 'ETE   FUEL');
      const act = Math.max(0, v.get(FMS.activeLegIndex));
      const f1 = fms ? fms.perf.fuelKg[act] : NaN;
      s.dataL(1, v.getString(FMS.nextWptIdent) || '-----', 'magenta');
      s.dataC(1, v.get(FMS.distToWptNm) > 0 ? v.get(FMS.distToWptNm).toFixed(1) : '---', 'green');
      s.dataR(1, `${fmtEte(v.get(FMS.eteToWptS))} ${Number.isFinite(f1) ? Math.round(f1 * lbPerKg) : '----'}`, 'green');
      s.labelL(2, 'NEXT');
      s.dataL(2, v.getString(FMS.afterWptIdent) || '-----', 'green');
      s.labelL(3, 'DEST');
      s.dataL(3, v.getString(FMS.destIdent) || '----', 'green');
      s.dataC(3, v.get(FMS.distToDestNm) > 0 ? Math.round(v.get(FMS.distToDestNm)).toString() : '---', 'green');
      const fd = v.get(FMS.fuelDestKg);
      s.dataR(3, `${fmtEte(v.get(FMS.eteDestS))} ${fd > 0 ? Math.round(fd * lbPerKg) : '----'}`, 'green');
      s.labelR(2, 'ETA DEST');
      s.dataR(2, v.get(FMS.eteDestS) > 0 ? fmtTime(v.get(FMS.etaDestUtcH)) : '--:--', 'green');
      s.labelL(4, 'NAV MODE');
      s.dataL(4, v.getString(FMS.approachMode) || 'ENR', 'green');
      s.labelR(4, 'TOD');
      s.dataR(4, v.get(FMS.todDistNm) > 0 ? `${v.get(FMS.todDistNm).toFixed(0)}NM ${fmtEte(v.get(FMS.todEteS))}` : '----', 'green');
      s.labelL(5, 'VNAV');
      s.dataL(5, v.getString(FMS.vnavPhase) || '---', 'green');
    } else if (sub === 1) {
      const gs = v.get(GPS.gs);
      const tas = v.get(ADC.tas(1));
      const hdg = v.get(ADC.heading(1));
      const trk = v.get(GPS.trackMag);
      // Wind triangle: wind = ground vector - air vector.
      const d = Math.PI / 180;
      const wx = gs * Math.sin(trk * d) - tas * Math.sin(hdg * d);
      const wy = gs * Math.cos(trk * d) - tas * Math.cos(hdg * d);
      const ws = Math.hypot(wx, wy);
      const wdir = (Math.atan2(-wx, -wy) / d + 360) % 360;
      s.labelL(1, 'GS');
      s.dataL(1, Math.round(gs).toString(), 'green');
      s.labelR(1, 'TAS');
      s.dataR(1, Math.round(tas).toString(), 'green');
      s.labelL(2, 'WIND');
      s.dataL(2, tas > 60 ? `${Math.round(wdir).toString().padStart(3, '0')}°/${Math.round(ws)}` : '---°/--', 'green');
      s.labelR(2, 'SAT');
      s.dataR(2, `${Math.round(v.get(ADC.sat(1)))}°C`, 'green');
      s.labelL(3, 'XTK');
      const x = v.get(FMS.xtkNm);
      s.dataL(3, `${x >= 0 ? 'R' : 'L'}${Math.abs(x).toFixed(2)}NM`, 'green');
      s.labelR(3, 'DTK/TRK');
      s.dataR(3, `${Math.round(v.get(FMS.dtkMag)).toString().padStart(3, '0')}/${Math.round(trk).toString().padStart(3, '0')}`, 'green');
      s.labelL(4, 'FUEL FLOW');
      s.dataL(4, Math.round(totalFf(m)).toString(), 'green');
      s.labelR(4, 'FUEL QTY');
      s.dataR(4, Math.round(fuelLb(m)).toString(), 'green');
    } else {
      const rnp = m.shared.perf.rnpNm;
      s.labelL(1, 'RNP');
      s.dataL(1, Number.isFinite(rnp) ? rnp.toFixed(2) : `${v.get(FMS.cdiScaleNm).toFixed(2)} DFLT`, 'cyan');
      s.labelR(1, 'EPU');
      s.dataR(1, v.get(GPS.valid) !== 0 ? v.get(GPS.epuNm).toFixed(2) : '----', 'green');
      s.labelL(2, 'GPS');
      s.dataL(2, v.get(GPS.valid) !== 0 ? (v.get(GPS.sbas) !== 0 ? 'SBAS' : 'NAV') : 'INVALID', v.get(GPS.valid) !== 0 ? 'green' : 'amber');
    }
    s.dataL(6, '<PERF INDEX', 'white');
  },
  lsk(m, k, sub) {
    if (k === 'L6') return m.show('PERF_INDEX');
    if (sub === 2 && k === 'L1') {
      const t = m.scratch.trim();
      if (t === 'DELETE') {
        m.take();
        m.shared.perf.rnpNm = NaN;
        m.invalidate();
        return;
      }
      const x = Number(t);
      if (!(x >= 0.1 && x <= 20)) return m.error();
      m.take();
      m.shared.perf.rnpNm = x;
      m.invalidate();
    }
  },
};

export const FUEL_MGT_PAGE: CduPage = {
  id: 'FUEL_MGT',
  refreshS: 1,
  render(m, s) {
    const v = m.vars;
    const fuel = fuelLb(m);
    const ff = totalFf(m);
    s.title = 'FUEL MGT';
    s.labelL(1, 'FUEL QTY');
    s.dataL(1, Math.round(fuel).toString(), 'green');
    s.labelL(2, 'FUEL FLOW');
    s.dataL(2, Math.round(ff).toString(), 'green');
    s.labelL(3, 'RESERVES');
    s.dataL(3, Math.round(m.shared.perf.reservesLb).toString(), 'cyan');
    const endur = ff > 1 ? (fuel / ff) * 3600 : NaN;
    s.labelR(1, 'ENDURANCE');
    s.dataR(1, fmtEte(endur), 'green');
    s.labelR(2, 'RANGE');
    const gs = v.get(GPS.gs);
    s.dataR(2, Number.isFinite(endur) && gs > 40 ? `${Math.round((gs * endur) / 3600)}NM` : '----', 'green');
    s.labelR(3, 'TO RESERVE');
    const toRes = ff > 1 ? ((fuel - m.shared.perf.reservesLb) / ff) * 3600 : NaN;
    s.dataR(3, fmtEte(toRes), 'green');
    s.dataL(6, '<PERF INDEX', 'white');
  },
  lsk(m, k) {
    if (k === 'L6') m.show('PERF_INDEX');
  },
};

export const PERF_PAGES: readonly CduPage[] = [PERF_INDEX_PAGE, PERF_INIT_PAGE, VNAV_PAGE, PROG_PAGE, FUEL_MGT_PAGE];
