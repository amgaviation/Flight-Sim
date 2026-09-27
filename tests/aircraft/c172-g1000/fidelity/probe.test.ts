/**
 * Fidelity audit probes (read-only audit, 172S G1000 NXi). Each probe logs the observed behaviour
 * for comparison with POH 172SPHBUS-00 Sec 7 / G1000 CRG 190-00384-12; they assert nothing
 * about the expected real behaviour (the audit report lists the deviations).
 */
import { describe, it } from 'vitest';
import { makeG1k, cas, type G1kRig } from '../helpers';
import type { SimContext } from '../../../../src/core/SimContext';
import { C172, STBY_BATT, MAG } from '../../../../src/aircraft/c172s-common/vars';
import { C172G } from '../../../../src/aircraft/c172-g1000/vars';
import { G1K, G1K_EVENTS } from '../../../../src/avionics/garmin-g1000/vars';

const CRUISE = { altFtMsl: 6000, iasKt: 105 } as const;
import { appendFileSync } from 'node:fs';
const log = (...a: unknown[]) => appendFileSync('/tmp/ref/c172g-audit/probe.log', a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');

function toneSpy() {
  const tones: Record<string, number> = {};
  const plays: string[] = [];
  const audio: SimContext['audio'] = {
    play: (n: string) => void plays.push(n),
    loop: () => ({ setGain: () => undefined, setRate: () => undefined, stop: () => undefined }),
    callout: () => undefined,
    tone: (n: string, on: boolean) => {
      tones[n] = on ? 1 : 0;
    },
  } as unknown as SimContext['audio'];
  return { audio, tones, plays };
}

const g = (r: G1kRig, n: string) => r.vars.get(n);

describe('fidelity probes', () => {
  it('P1 auto AP disconnect: tone / flashing duration', () => {
    const s = toneSpy();
    const r = makeG1k({ state: 'cruise', air: CRUISE, audio: s.audio });
    r.run(4);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(2);
    log('P1 engaged', g(r, 'ap.engaged'));
    r.vars.set('cb.autopilot', 0);
    const samples: string[] = [];
    for (let i = 0; i < 8; i++) {
      r.run(1);
      samples.push(`t${i + 1}: eng=${g(r, 'ap.engaged')} warn=${g(r, 'ap.disc_warn')} auto=${g(r, 'ap.disc_auto')} tone=${s.tones['ap_disconnect']}`);
    }
    log('P1', samples.join(' | '));
    log('P1 afcs status', r.vars.getString(G1K.afcsStatus));
  });

  it('P2 manual AP disconnect via A/P TRIM DISC, then ESP interrupt latch', () => {
    const s = toneSpy();
    const r = makeG1k({ state: 'cruise', air: CRUISE, audio: s.audio });
    r.run(4);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(2);
    // Cockpit button: var + 'ap.disc' on press, no release event.
    r.vars.set(C172G.apDisc, 1);
    r.events.emit('ap.disc');
    r.run(0.2);
    r.vars.set(C172G.apDisc, 0);
    const samples: string[] = [];
    for (let i = 0; i < 7; i++) {
      r.run(1);
      samples.push(`t${i + 1}: warn=${g(r, 'ap.disc_warn')} tone=${s.tones['ap_disconnect']}`);
    }
    log('P2', samples.join(' | '));
    // ESP after release: bank the airplane beyond 45 deg with the AP off.
    const esp = (r.sys.suite as unknown as { system: { esp?: { interrupt?: boolean } } }).system?.esp;
    log('P2 esp interrupt latched after release:', esp ? (esp as unknown as { interrupt: boolean }).interrupt : 'n/a');
    log('P2 esp enabled', g(r, G1K.espEnabled));
    r.vars.set('input.roll', 0.6);
    let maxEsp = 0;
    r.run(8, () => {
      maxEsp = Math.max(maxEsp, g(r, G1K.espEngaged));
    });
    log('P2 bank', g(r, 'fdm.roll_deg').toFixed(1), 'esp engaged max', maxEsp);
  });

  it('P3 LOW VOLTS chime on the ground at low rpm (CRG: aural inhibited on ground)', () => {
    const s = toneSpy();
    const r = makeG1k({ state: 'ready_to_taxi', audio: s.audio });
    r.run(3);
    r.vars.set(C172.land, 1);
    r.vars.set(C172.taxi, 1);
    r.vars.set(C172.pitotHeat, 1);
    r.vars.set(C172.throttle, 0);
    r.run(20);
    log('P3 rpm', g(r, 'eng1.rpm').toFixed(0), 'mbus', g(r, C172.mBusV).toFixed(2), 'cas', cas(r), 'warnTone', s.tones['master_warning'], 'chime var', g(r, G1K.warnChime));
  });

  it('P4 MASTER OFF with STBY BATT ARM in cruise: ESS powered, fans, AFCS, STBY BATT caution', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    r.vars.set(C172.masterAlt, 0);
    r.vars.set(C172.masterBat, 0);
    r.run(15);
    log('P4 pfd', g(r, G1K.unitPowered('pfd')), 'mfd', g(r, G1K.unitPowered('mfd')), 'gia1', g(r, G1K.unitUp('gia1')), 'com1', g(r, 'elec.comm1_powered'), 'adahrs', g(r, 'elec.adc_ahrs_powered'));
    log('P4 ebus', g(r, C172.eBusV).toFixed(2), 'mbus', g(r, C172.mBusV).toFixed(2), 'sbatt', g(r, C172.sBattA).toFixed(2), 'cas', cas(r));
    log('P4 fans fwd/aft', g(r, C172G.fwdFan), g(r, C172G.aftFan), 'ap', g(r, 'ap.engaged'), 'status', r.vars.getString(G1K.afcsStatus), 'reversion pfd', g(r, G1K.reversionary('pfd')));
    log('P4 stby ind light', g(r, 'ac.light.stby_ind'), 'hobbs running? warn_powered', g(r, 'elec.warn_powered'));
    // time to exhaustion
    let t = 0;
    r.run(3600, (tt) => {
      t = tt;
      return g(r, 'elec.pfd_powered') < 0.5;
    });
    log('P4 PFD lasts ~', (t / 60).toFixed(1), 'min on the standby battery; ebus at end', g(r, C172.eBusV).toFixed(1));
  });

  it('P5 STBY BATT OFF: no takeover; TEST lamp', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set(C172.stbyBatt, STBY_BATT.off);
    r.vars.set(C172.masterBat, 0);
    r.run(3);
    log('P5 pfd with STBY OFF and MASTER OFF', g(r, 'elec.pfd_powered'));
    const c = makeG1k({ state: 'cold_dark' });
    c.run(1);
    c.vars.set(C172.stbyBatt, STBY_BATT.test);
    c.run(20);
    log('P5 test lamp after 20 s', g(c, C172.stbyTestLamp), 'stby v', g(c, 'elec.stby_batt_v').toFixed(2), 'ess_v', g(c, 'elec.ess_v').toFixed(2), 'pfd', g(c, 'elec.pfd_powered'));
    c.vars.set(C172.stbyBatt, STBY_BATT.arm);
    c.run(2);
    log('P5 ARM with MASTER OFF on the ground: pfd', g(c, 'elec.pfd_powered'), 'ess', g(c, 'elec.ess_v').toFixed(2));
  });

  it('P6 regulator runaway: ACU trip, HIGH VOLTS, volts colour', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set('fail.elec.alt.regulator', 1);
    let maxV = 0;
    let hv = 0;
    r.run(5, () => {
      maxV = Math.max(maxV, g(r, C172.mBusV));
      hv = Math.max(hv, g(r, 'ac.c172.ann.high_volts'));
    });
    log('P6 max mbus', maxV.toFixed(2), 'high volts seen', hv, 'alt_field cb', g(r, 'cb.alt_field'), 'cas', cas(r));
  });

  it('P7 GA button with AP engaged in cruise', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    log('P7 engaged before GA', g(r, 'ap.engaged'));
    r.vars.set(C172G.ga, 1);
    r.events.emit('ap.toga');
    r.run(0.3);
    r.vars.set(C172G.ga, 0);
    r.run(1);
    log('P7 ap', g(r, 'ap.engaged'), 'lat', r.vars.getString('ap.lat_active'), 'vert', r.vars.getString('ap.vert_active'), 'fd', g(r, 'ap.fd1_on'));
  });

  it('P8 CDI source change with AP in NAV reverts to ROL', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'hdg'));
    r.run(1);
    log('P8 lat', r.vars.getString('ap.lat_active'), 'cdi src', r.vars.getString('nav.cdi_source') || g(r, 'g1k.cdi_source'));
  });

  it('P9 cooling fans need both AVIONICS switches (POH 7-73)', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.vars.set(C172.avionicsBus2, 0);
    r.run(1);
    log('P9 AVN2 OFF: fwd fan', g(r, C172G.fwdFan), 'aft', g(r, C172G.aftFan), 'pfd', g(r, 'elec.pfd_powered'));
    r.vars.set(C172.avionicsBus2, 1);
    r.vars.set(C172.avionicsBus1, 0);
    r.run(1);
    log('P9 AVN1 OFF: fwd fan', g(r, C172G.fwdFan), 'aft', g(r, C172G.aftFan), 'pfd (ESS)', g(r, 'elec.pfd_powered'));
  });

  it('P10 stall horn with all electrical power off', () => {
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 55 } });
    r.vars.set(C172.masterBat, 0);
    r.vars.set(C172.stbyBatt, 0);
    r.vars.set(C172.throttle, 0);
    let horn = 0;
    r.run(15, () => {
      r.vars.set('input.pitch', 0.5);
      horn = Math.max(horn, g(r, C172.stallHorn));
    });
    log('P10 horn with no power', horn, 'ias', g(r, 'adc2.ias_kt').toFixed(0));
  });

  it('P11 start from cold & dark per POH (key, mags, pump prime, master, start)', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.run(1);
    const v = r.vars;
    v.set(C172.controlLock, 0);
    v.set(C172.keyIn, 1);
    v.set(C172.stbyBatt, STBY_BATT.arm);
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    r.run(10);
    log('P11 master on: pfd', g(r, G1K.unitPowered('pfd')), 'ebus', g(r, C172.eBusV).toFixed(1), 'mbus', g(r, C172.mBusV).toFixed(1), 'cas', cas(r), 'sbatt', g(r, C172.sBattA).toFixed(2));
    v.set(C172.mixture, 1);
    v.set(C172.throttle, 0.05);
    v.set(C172.fuelPump, 1);
    r.run(4);
    v.set(C172.fuelPump, 0);
    v.set(C172.mixture, 0);
    v.set(C172.magneto, MAG.start);
    let started = 0;
    r.run(8, (t) => {
      if (g(r, 'eng1.rpm') > 500 && !started) {
        started = t;
        v.set(C172.mixture, 1);
      }
      return false;
    });
    log('P11 started at', started.toFixed(1), 'mags', g(r, C172.magneto));
    v.set(C172.magneto, MAG.both);
    r.run(10);
    log('P11 after start rpm', g(r, 'eng1.rpm').toFixed(0), 'mbatt', g(r, C172.mBattA).toFixed(1), 'sbatt', g(r, C172.sBattA).toFixed(2), 'cas', cas(r), 'alt_field cb', g(r, 'cb.alt_field'));
  });

  it('P12 electric trim speed / AP trim, MET while AP off, trim runaway', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    const t0 = g(r, C172.trimPosition);
    r.vars.set(C172G.met, 1);
    r.run(2);
    r.vars.set(C172G.met, 0);
    log('P12 MET 2 s delta', (g(r, C172.trimPosition) - t0).toFixed(3));
    r.vars.set('fail.trim.pitch.runaway', 1);
    r.run(3);
    log('P12 runaway status', r.vars.getString(G1K.afcsStatus), 'trim', g(r, C172.trimPosition).toFixed(3));
    r.vars.set(C172G.apDisc, 1);
    const t1 = g(r, C172.trimPosition);
    r.run(2);
    log('P12 with A/P TRIM DISC held trim moved', (g(r, C172.trimPosition) - t1).toFixed(3));
  });

  it('P13 flaps with the FLAPS breaker pulled / MASTER off', () => {
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 3000, iasKt: 80 } });
    r.run(1);
    r.vars.set('cb.flaps', 0);
    r.vars.set(C172.flapLever, 2);
    r.run(6);
    log('P13 flaps deg with cb out (should not move; ELEC BUS breakers not pullable)', g(r, 'surf.flaps_deg').toFixed(1));
  });

  it('P14 CO LVL HIGH tone and CO DET', () => {
    const s = toneSpy();
    const r = makeG1k({ state: 'cruise', air: CRUISE, audio: s.audio });
    r.run(2);
    r.vars.set(C172.cabinHeat, 1);
    r.vars.set('fail.c172.muffler_leak', 1);
    r.run(120);
    log('P14 co', g(r, 'ac.c172.co_ppm').toFixed(0), 'cas', cas(r), 'warn tone', s.tones['master_warning']);
  });

  it('P15 pitot heat / ice; windshield fog output; door open in flight', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    const ias0 = g(r, 'adc1.ias_kt');
    r.vars.set(C172.doorLeft, 0);
    r.vars.set(C172.windowLeft, 1);
    r.run(20);
    log('P15 door open ias change', (g(r, 'adc1.ias_kt') - ias0).toFixed(1), 'fog var', g(r, C172.windshieldFog));
  });

  it('P16 DISPLAY BACKUP and MFD failure reversion', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.events.emit(G1K_EVENTS.displayBackup);
    r.run(1);
    log('P16 backup: pfd rev', g(r, G1K.reversionary('pfd')), 'mfd rev', g(r, G1K.reversionary('mfd')));
    r.events.emit(G1K_EVENTS.displayBackup);
    r.run(1);
    r.vars.set('cb.mfd', 0);
    r.run(2);
    log('P16 MFD cb out: pfd rev', g(r, G1K.reversionary('pfd')));
  });

  it('P17 hobbs / ELT / external power', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.run(1);
    r.vars.set(C172.extPower, 1);
    r.run(2);
    log('P17 ext power with BAT off: bus1', g(r, 'elec.bus1_v').toFixed(1));
    r.vars.set(C172.masterBat, 1);
    r.run(2);
    log('P17 ext power with BAT on: bus1', g(r, 'elec.bus1_v').toFixed(1), 'batt amps', g(r, 'elec.batt_amps').toFixed(1));
  });

  it('P18 AP engage limits / MET ARM / AP key when engaged / CWS annunciation', () => {
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 160 } });
    r.run(4);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    log('P18 AP engages at 160 KIAS (limit 150)?', g(r, 'ap.engaged'), 'ias', g(r, 'adc1.ias_kt').toFixed(0));
    r.events.emit('ap.cws', { pressed: true });
    r.run(1);
    log('P18 CWS held: ap.cws', g(r, 'ap.cws'), 'servo pitch', g(r, 'ap.servo_pitch'));
  });
});
