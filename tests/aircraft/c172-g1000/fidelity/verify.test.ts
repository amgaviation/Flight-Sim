/** Adversarial verification probes (log only). */
import { describe, it } from 'vitest';
import { makeG1k, cas, type G1kRig } from '../helpers';
import type { SimContext } from '../../../../src/core/SimContext';
import { C172, STBY_BATT } from '../../../../src/aircraft/c172s-common/vars';
import { C172G } from '../../../../src/aircraft/c172-g1000/vars';
import { G1K, G1K_EVENTS, CDI_SOURCE } from '../../../../src/avionics/garmin-g1000/vars';
import { appendFileSync } from 'node:fs';
const log = (...a: unknown[]) => appendFileSync('/tmp/ref/c172g-verify/v.log', a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
const CRUISE = { altFtMsl: 6000, iasKt: 105 } as const;
const g = (r: G1kRig, n: string) => r.vars.get(n);
function toneSpy() {
  const tones: Record<string, number> = {};
  const audio = { play: () => undefined, loop: () => ({ setGain: () => undefined, setRate: () => undefined, stop: () => undefined }), callout: () => undefined, tone: (n: string, on: boolean) => { tones[n] = on ? 1 : 0; } } as unknown as SimContext['audio'];
  return { audio, tones };
}
const msgs = (r: G1kRig) => r.sys.suite.system.alerts.messages.list.filter((m) => m.active).map((m) => m.text);

describe('verify', () => {
  for (const st of ['ready_to_taxi', 'takeoff', 'cruise', 'approach'] as const) {
    it('PROC-01 ' + st, () => {
      const r = makeG1k({ state: st, air: st === 'cruise' || st === 'approach' ? CRUISE : undefined });
      const s: string[] = [];
      r.run(0.05); s.push(`t0.05 adc=${g(r, 'adc1.valid')} ahrs=${g(r, 'ahrs1.valid')} pfd=${g(r, G1K.unitUp('pfd'))} mfd=${g(r, G1K.unitUp('mfd'))}`);
      r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap')); r.run(0.3);
      s.push(`ap=${g(r, 'ap.engaged')}`);
      log('PROC01', st, s.join(' '), 'cas', cas(r), 'msgs', msgs(r));
    });
  }
  it('F4 CDI via softkey event path', () => {
    const r = makeG1k({ state: 'approach', air: CRUISE });
    r.run(3);
    log('F4 start cdi', g(r, 'ap.nav_source'), 'lat', r.vars.getString('ap.lat_active'));
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap')); r.run(0.5);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'nav')); r.run(1);
    const a = r.sys.afcs as unknown as { lat: string; latArmed: string };
    log('F4 after NAV', a.lat, a.latArmed, 'src', g(r, 'ap.nav_source'));
    (r.sys.suite.system as unknown as { cycleCdi?: () => void; setCdiSource(n: number): void });
    const sys = r.sys.suite.system as unknown as Record<string, (...x: unknown[]) => void>;
    const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(sys)).filter((k) => /cdi/i.test(k));
    log('F4 cdi methods', keys);
    for (const k of keys) if (/cycle|softkey|press/i.test(k)) { sys[k](); break; }
    r.run(1);
    log('F4 after CDI', a.lat, a.latArmed, 'src', g(r, 'ap.nav_source'));
  });
  it('F3 auto disc ack by A/P TRIM DISC via cockpit semantics', () => {
    const s = toneSpy();
    const r = makeG1k({ state: 'cruise', air: CRUISE, audio: s.audio });
    r.run(4); r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap')); r.run(2);
    r.vars.set('cb.autopilot', 0);
    r.run(15);
    log('F3 15s', 'eng', g(r, 'ap.engaged'), 'warn', g(r, 'ap.disc_warn'), 'auto', g(r, 'ap.disc_auto'), JSON.stringify(s.tones));
    r.vars.set(C172G.apDisc, 1); r.events.emit('ap.disc'); r.run(0.2); r.vars.set(C172G.apDisc, 0); r.events.emit(G1K_EVENTS.apDiscHold, 0); r.run(1);
    log('F3 after ack', 'warn', g(r, 'ap.disc_warn'), JSON.stringify(s.tones));
  });
  it('F1 alternator fail then battery sag', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(3);
    r.vars.set(C172.masterAlt, 0);
    let minPfd = 1;
    for (let i = 0; i < 12; i++) { r.run(300, () => { minPfd = Math.min(minPfd, g(r, G1K.unitUp('pfd'))); }); log('F1 t', (i + 1) * 5, 'min', 'xfeed', g(r, 'elec.xfeed_v').toFixed(2), 'ess', g(r, 'elec.ess_v').toFixed(2), 'rel', g(r, 'ac.c172.stby_release'), 'minPfd', minPfd, 'sb', g(r, 'elec.stby_batt_amps').toFixed(2)); }
  });
});
