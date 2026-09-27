/**
 * Procedures audit probes, part 2 (read-only audit): preset settling times, ground AP engage,
 * master interlock, vacuum failure, transponder / lights per preset. Logs only.
 */
import { describe, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { makeG1k, cas, type G1kRig } from '../helpers';
import type { SimContext } from '../../../../src/core/SimContext';
import { C172, ANN } from '../../../../src/aircraft/c172s-common/vars';
import { C172G } from '../../../../src/aircraft/c172-g1000/vars';
import { G1K, G1K_EVENTS } from '../../../../src/avionics/garmin-g1000/vars';
import type { InitialState } from '../../../../src/aircraft/types';

const LOG = '/tmp/ref/c172g-proc/proc2.log';
const log = (...a: unknown[]) => appendFileSync(LOG, a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
const g = (r: G1kRig, n: string) => +r.vars.get(n).toFixed(2);

function toneSpy() {
  const plays: string[] = [];
  const tones: string[] = [];
  const audio: SimContext['audio'] = {
    play: (n: string) => void plays.push(n),
    loop: () => ({ setGain: () => undefined, setRate: () => undefined, stop: () => undefined }),
    callout: (n: string) => void plays.push('callout:' + n),
    tone: (n: string, on: boolean) => void (on && tones.push(n)),
  } as unknown as SimContext['audio'];
  return { audio, plays, tones };
}

describe('procedures probes 2', () => {
  it('P1 preset settle: ADC / AHRS / PFD valid after preset', () => {
    for (const s of ['ready_to_taxi', 'takeoff', 'cruise', 'approach'] as InitialState[]) {
      const r = makeG1k({ state: s, air: s === 'cruise' || s === 'approach' ? { altFtMsl: s === 'cruise' ? 6000 : 2000, iasKt: s === 'cruise' ? 105 : 85 } : undefined });
      const t0: string[] = [];
      for (let i = 0; i < 12; i++) {
        t0.push(`${i}s adc=${g(r, 'adc1.valid')} ahrs=${g(r, 'ahrs1.valid')} pfd=${g(r, G1K.unitUp('pfd'))} mfd=${g(r, G1K.unitUp('mfd'))} gia=${g(r, G1K.unitUp('gia1'))} srv=${g(r, G1K.unitUp('servos'))}`);
        r.run(1);
      }
      log('P1', s, t0.join(' | '));
      log('P1', s, 'CAS', cas(r), 'afcs', r.vars.getString(G1K.afcsStatus), 'xpdr', g(r, 'xpdr.mode'), 'code', g(r, 'xpdr.code'));
      log('P1', s, 'lights', `bcn=${g(r, C172.beacon)} land=${g(r, C172.land)} taxi=${g(r, C172.taxi)} nav=${g(r, C172.nav)} strobe=${g(r, C172.strobe)} pitot=${g(r, C172.pitotHeat)} mix=${g(r, C172.mixture)} flap=${g(r, C172.flapLever)} fuelPump=${g(r, C172.fuelPump)}`, 'ap', g(r, 'ap.engaged'), 'fd', g(r, 'ap.fd1_on'), 'selAlt', g(r, 'ap.sel_alt_ft'), 'hdg', g(r, 'ap.sel_hdg_deg'));
    }
  });

  it('P2 ground AP engage after full settle (POH Before Takeoff 13-16)', () => {
    const s = toneSpy();
    const r = makeG1k({ state: 'ready_to_taxi', audio: s.audio });
    r.run(90);
    log('P2 pre', 'adc', g(r, 'adc1.valid'), 'ahrs', g(r, 'ahrs1.valid'), 'servos', g(r, G1K.unitUp('servos')), 'afcs', r.vars.getString(G1K.afcsStatus), 'plays', s.plays.slice(-5), 'tones', s.tones.slice(-5));
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    log('P2 AP key', 'eng', g(r, 'ap.engaged'), 'fd', g(r, 'ap.fd1_on'), r.vars.getString('ap.lat_active'), r.vars.getString('ap.vert_active'));
    s.plays.length = 0;
    s.tones.length = 0;
    const e0 = r.vars.get('surf.elevator');
    const a0 = r.vars.get('surf.aileron');
    r.vars.set('input.pitch', 1);
    r.vars.set('input.roll', 1);
    r.run(1);
    log('P2 overpower full yoke', 'elev', e0.toFixed(2), '->', g(r, 'surf.elevator'), 'ail', a0.toFixed(2), '->', g(r, 'surf.aileron'), 'eng', g(r, 'ap.engaged'));
    r.vars.set('input.pitch', 0);
    r.vars.set('input.roll', 0);
    r.run(1);
    r.vars.set(C172G.apDisc, 1);
    r.events.emit('ap.disc');
    r.run(0.3);
    r.vars.set(C172G.apDisc, 0);
    r.run(2);
    log('P2 DISC', 'eng', g(r, 'ap.engaged'), 'fd', g(r, 'ap.fd1_on'), 'plays', s.plays, 'tones', s.tones);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'fd'));
    r.run(0.5);
    log('P2 FD key', 'fd', g(r, 'ap.fd1_on'));
  });

  it('P3 master split-rocker interlock via var (as the keyboard/input map writes)', () => {
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    r.run(3);
    r.vars.set(C172.masterBat, 0);
    r.run(2);
    log('P3 BAT off: alt var', g(r, C172.masterAlt), 'mbus', g(r, C172.mBusV), 'altOnline', g(r, 'elec.alt_online'), 'cas', cas(r));
  });

  it('P4 vacuum pump failure / LOW VACUUM procedure', () => {
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    r.run(3);
    r.vars.set('fail.vac.pump1', 1);
    r.run(20);
    log('P4 vac pump fail', 'suction', g(r, 'ac.vac.suction_inhg'), 'ann', g(r, ANN.lowVacuum), 'gyroFlag', g(r, C172G.gyroFlag), 'cas', cas(r));
  });

  it('P5 AP engaged cruise, then AP CB pull (POH AP failure)', () => {
    const s = toneSpy();
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 }, audio: s.audio });
    r.run(30);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(2);
    log('P5 engaged', g(r, 'ap.engaged'));
    r.vars.set('cb.autopilot', 0);
    r.run(3);
    log('P5 CB out', 'eng', g(r, 'ap.engaged'), 'cas', cas(r), 'afcs', r.vars.getString(G1K.afcsStatus), 'tones', s.tones, 'plays', s.plays.slice(-6));
  });

  it('P6 ELT / 12V / pitot heat checks', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(3);
    const before = r.vars.get(C172.mBattA);
    r.vars.set(C172.pitotHeat, 1);
    r.run(2);
    log('P6 pitot heat on: mbatt delta', (r.vars.get(C172.mBattA) - before).toFixed(2), 'keys matching pitot', [...r.vars.keys()].filter((k) => k.includes('pitot')));
  });
});
