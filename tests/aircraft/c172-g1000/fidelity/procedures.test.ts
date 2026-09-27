/**
 * Procedures & checklists audit probes (read-only audit, 172S G1000 NXi / GFC 700).
 * Executes the POH Sec 4 normal checklists (172SPHBUS-00/-02) step by step from cold & dark with
 * the vars the cockpit controls write, and logs every auto-check result plus the real indication
 * the POH expects. Asserts nothing; the audit report lists the deviations.
 */
import { describe, it } from 'vitest';
import { appendFileSync, mkdirSync } from 'node:fs';
import { makeG1k, cas, type G1kRig } from '../helpers';
import { C172, ANN, MAG, STBY_BATT, FUEL_SEL } from '../../../../src/aircraft/c172s-common/vars';
import { C172G } from '../../../../src/aircraft/c172-g1000/vars';
import { C172G_CHECKLISTS } from '../../../../src/aircraft/c172-g1000/checklists';
import { G1K, G1K_EVENTS } from '../../../../src/avionics/garmin-g1000/vars';
import { ENG, SURF } from '../../../../src/core/vars';

mkdirSync('/tmp/ref/c172g-proc', { recursive: true });
const LOG = '/tmp/ref/c172g-proc/proc.log';
const log = (...a: unknown[]) => appendFileSync(LOG, a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
const g = (r: G1kRig, n: string) => +r.vars.get(n).toFixed(2);

/** Logs each checked item of a checklist (title prefix) and whether its auto-check passes now. */
function evalList(r: G1kRig, title: string, tag: string): void {
  const cl = C172G_CHECKLISTS.find((c) => c.title.startsWith(title));
  if (!cl) return log(tag, 'NO LIST', title);
  const res = cl.items.map((it, i) => (it.check ? `${i + 1}.${it.challenge.trim()}=${it.check(r.vars) ? 'OK' : 'FAIL'}` : null)).filter(Boolean);
  log(tag, title, '::', res.join(' | '));
}
function snap(r: G1kRig, tag: string): void {
  log(
    tag,
    `mbus=${g(r, C172.mBusV)} ebus=${g(r, C172.eBusV)} mbatt=${g(r, C172.mBattA)} sbatt=${g(r, C172.sBattA)} rpm=${g(r, ENG.rpm(1))} oil=${g(r, ENG.oilPressPsi(1))} ff=${g(r, ENG.fuelFlowGph(1))} vac=${g(r, 'ac.vac.suction_inhg')}`,
    `pfdPow=${g(r, 'elec.pfd_powered')} pfdUp=${g(r, G1K.unitUp('pfd'))} mfdUp=${g(r, G1K.unitUp('mfd'))} rev=${g(r, G1K.reversionary('pfd'))} nav1eng=${g(r, 'elec.nav1_eng_powered')} adc1=${g(r, 'adc1.valid')} ahrs1=${g(r, 'ahrs1.valid')}`,
    `ANN oil=${g(r, ANN.oilPress)} lowV=${g(r, ANN.lowVolts)} vac=${g(r, ANN.lowVacuum)} stby=${g(r, ANN.stbyBatt)} lfL=${g(r, ANN.lowFuelL)} lfR=${g(r, ANN.lowFuelR)} fwdFan=${g(r, C172G.fwdFan)} aftFan=${g(r, C172G.aftFan)} lamp=${g(r, C172.stbyTestLamp)}`,
    'CAS',
    cas(r),
  );
}

describe('procedures probes', () => {
  it('N1 cold_dark preset vs POH securing + preflight cabin', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.run(1);
    log('==== N1 cold_dark');
    const keys = ['masterBat', 'masterAlt', 'avionicsBus1', 'avionicsBus2', 'stbyBatt', 'magneto', 'keyIn', 'fuelSelector', 'fuelShutoff', 'mixture', 'throttle', 'parkingBrake', 'controlLock', 'flapLever', 'beacon', 'nav', 'strobe', 'land', 'taxi', 'pitotHeat', 'altStatic', 'cabinHeat', 'cabinAir', 'doorLeft', 'doorRight'] as const;
    log('N1 switches', keys.map((k) => `${k}=${g(r, C172[k])}`).join(' '), 'trim', g(r, C172.trimPosition), 'extPsi', g(r, C172G.extPsi), 'eltRocker', g(r, C172G.eltRocker));
    snap(r, 'N1 cold');
    evalList(r, 'Preflight Inspection — Cabin', 'N1 cold');
    // Preflight cabin items 5-14
    r.vars.set(C172.controlLock, 0);
    r.vars.set(C172.masterBat, 1);
    r.vars.set(C172.masterAlt, 1);
    r.run(0.5);
    snap(r, 'N1 master 0.5s');
    r.run(10);
    snap(r, 'N1 master 10s');
    evalList(r, 'Preflight Inspection — Cabin', 'N1 master on');
    r.vars.set(C172.avionicsBus1, 1);
    r.run(2);
    snap(r, 'N1 avn1 on');
    r.vars.set(C172.avionicsBus1, 0);
    r.vars.set(C172.avionicsBus2, 1);
    r.run(2);
    snap(r, 'N1 avn2 on only');
    r.vars.set(C172.avionicsBus2, 0);
    r.vars.set(C172.pitotHeat, 1);
    r.run(30);
    log('N1 pitot heat 30s', 'pitotHeatA?', g(r, 'elec.load.pitot_heat.amps'), 'pitot temp?', g(r, 'ac.c172.pitot_temp_c'), 'mbatt', g(r, C172.mBattA));
    r.vars.set(C172.pitotHeat, 0);
    r.run(1);
    snap(r, 'N1 after pitot');
    r.vars.set(C172.masterBat, 0);
    r.vars.set(C172.masterAlt, 0);
    r.run(1);
    evalList(r, 'Preflight Inspection — Cabin', 'N1 end');
  });

  it('N2 before start + start with battery', () => {
    const r = makeG1k({ state: 'cold_dark' });
    r.run(1);
    log('==== N2 start');
    r.vars.set(C172.controlLock, 0);
    evalList(r, 'Before Starting Engine', 'N2');
    r.vars.set(C172.throttle, 0.08);
    r.vars.set(C172.mixture, 0);
    // STBY BATT TEST 10 s (Rev 2) / 20 s (-00)
    r.vars.set(C172.stbyBatt, STBY_BATT.test);
    const lamp: number[] = [];
    for (let i = 0; i < 20; i++) {
      r.run(1);
      lamp.push(g(r, C172.stbyTestLamp));
    }
    log('N2 TEST lamp 1..20s', lamp.join(','), 'stby batt v', g(r, 'elec.stby_batt_v'));
    snap(r, 'N2 during TEST');
    r.vars.set(C172.stbyBatt, STBY_BATT.arm);
    r.run(0.5);
    snap(r, 'N2 ARM 0.5s');
    r.run(15);
    snap(r, 'N2 ARM 15s');
    evalList(r, 'Starting Engine (With Battery)', 'N2 after ARM');
    r.vars.set(C172.masterBat, 1);
    r.vars.set(C172.masterAlt, 1);
    r.vars.set(C172.beacon, 1);
    r.run(2);
    snap(r, 'N2 master on');
    r.vars.set(C172.fuelPump, 1);
    r.vars.set(C172.mixture, 1);
    const ff: number[] = [];
    for (let i = 0; i < 5; i++) {
      r.run(1);
      ff.push(g(r, ENG.fuelFlowGph(1)));
    }
    log('N2 prime FF 1..5s', ff.join(','));
    r.vars.set(C172.mixture, 0);
    r.vars.set(C172.fuelPump, 0);
    r.run(1);
    // key must be in
    log('N2 keyIn before', g(r, C172.keyIn));
    r.vars.set(C172G.keyTag, 1);
    r.run(0.2);
    r.vars.set(C172G.keyTag, 0);
    r.run(0.2);
    log('N2 keyIn after tag', g(r, C172.keyIn));
    r.vars.set(C172.magneto, MAG.start);
    let started = 0;
    r.run(10, (t) => {
      if (r.vars.get(ENG.rpm(1)) > 500 && !started) {
        started = t;
        return true;
      }
    });
    log('N2 start rpm', g(r, ENG.rpm(1)), 'starterEng', g(r, C172.starterEngaged), 'started at', started.toFixed(1));
    r.vars.set(C172.mixture, 1);
    r.vars.set(C172.magneto, MAG.both);
    const rpms: number[] = [];
    for (let i = 0; i < 6; i++) {
      r.run(1);
      rpms.push(g(r, ENG.rpm(1)));
    }
    log('N2 after start rpm 1..6s', rpms.join(','), 'mag', g(r, C172.magneto));
    snap(r, 'N2 run 6s');
    r.run(30);
    snap(r, 'N2 run 36s');
    r.vars.set(C172.avionicsBus1, 1);
    r.vars.set(C172.avionicsBus2, 1);
    r.run(20);
    snap(r, 'N2 avionics on 20s');
    evalList(r, 'Starting Engine (With Battery)', 'N2 end');
    // Idle RPM at throttle closed, rich
    r.vars.set(C172.throttle, 0);
    r.run(8);
    log('N2 idle closed throttle rich rpm', g(r, ENG.rpm(1)), 'lowVolts', g(r, ANN.lowVolts), 'mbatt', g(r, C172.mBattA));
    r.vars.set(C172.throttle, 0.1);
    r.run(5);
    log('N2 throttle 0.1 rpm', g(r, ENG.rpm(1)));
  });

  it('N3 before takeoff from ready_to_taxi', () => {
    const r = makeG1k({ state: 'ready_to_taxi' });
    r.run(3);
    log('==== N3 before takeoff');
    const keys = ['masterBat', 'masterAlt', 'avionicsBus1', 'avionicsBus2', 'stbyBatt', 'magneto', 'fuelSelector', 'mixture', 'throttle', 'parkingBrake', 'controlLock', 'flapLever', 'beacon', 'nav', 'strobe', 'land', 'taxi', 'doorLeft', 'doorRight', 'windowLeft', 'cabinPwr12v'] as const;
    log('N3 rtt switches', keys.map((k) => `${k}=${g(r, C172[k])}`).join(' '), 'trim', g(r, C172.trimPosition), 'fd', g(r, 'ap.fd1_on'), 'selAlt', g(r, 'ap.sel_alt_ft'), 'baro1', g(r, 'adc1.baro_inhg'));
    snap(r, 'N3 rtt');
    evalList(r, 'Before Takeoff', 'N3 rtt');
    r.vars.set(C172.mixture, 1);
    // Autopilot engage on the ground
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    log('N3 AP engage on ground', 'eng', g(r, 'ap.engaged'), 'fd', g(r, 'ap.fd1_on'), 'lat', r.vars.getString('ap.lat_active'), 'vert', r.vars.getString('ap.vert_active'));
    // A/P TRIM DISC press (cockpit: momentary var + event)
    r.vars.set(C172G.apDisc, 1);
    r.events.emit('ap.disc');
    r.run(0.3);
    r.vars.set(C172G.apDisc, 0);
    r.run(1);
    log('N3 after DISC', 'eng', g(r, 'ap.engaged'), 'fd', g(r, 'ap.fd1_on'), 'discWarn', g(r, 'ap.disc_warn'));
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'fd'));
    r.run(0.5);
    log('N3 after FD key', 'fd', g(r, 'ap.fd1_on'));
    // Run-up: 1800 rpm
    let thr = 0.1;
    for (let i = 0; i < 40; i++) {
      r.vars.set(C172.throttle, thr);
      r.run(1);
      const rpm = r.vars.get(ENG.rpm(1));
      if (Math.abs(rpm - 1800) < 20) break;
      thr += (1800 - rpm) / 12000;
    }
    r.run(4);
    const base = r.vars.get(ENG.rpm(1));
    r.vars.set(C172.magneto, MAG.right);
    r.run(4);
    const rr = r.vars.get(ENG.rpm(1));
    r.vars.set(C172.magneto, MAG.both);
    r.run(4);
    r.vars.set(C172.magneto, MAG.left);
    r.run(4);
    const ll = r.vars.get(ENG.rpm(1));
    r.vars.set(C172.magneto, MAG.both);
    r.run(4);
    log('N3 runup base', base.toFixed(0), 'R drop', (base - rr).toFixed(0), 'L drop', (base - ll).toFixed(0), 'thr', thr.toFixed(3));
    snap(r, 'N3 1800');
    evalList(r, 'Before Takeoff', 'N3 1800');
    r.vars.set(C172.throttle, 0);
    r.run(6);
    log('N3 idle rpm', g(r, ENG.rpm(1)), 'lowVolts', g(r, ANN.lowVolts));
    r.vars.set(C172.throttle, 0.06);
    r.run(4);
    r.vars.set(C172.flapLever, 1);
    r.vars.set(C172.strobe, 1);
    r.run(8);
    r.vars.set(C172.parkingBrake, 0);
    r.run(0.5);
    evalList(r, 'Before Takeoff', 'N3 end');
    log('N3 flaps', g(r, SURF.flapsDeg));
  });

  it('N4 takeoff preset + shutdown/securing', () => {
    const r = makeG1k({ state: 'takeoff' });
    r.run(3);
    log('==== N4 takeoff preset');
    const keys = ['stbyBatt', 'mixture', 'throttle', 'parkingBrake', 'flapLever', 'beacon', 'nav', 'strobe', 'land', 'taxi', 'fuelSelector', 'fuelPump', 'cabinPwr12v'] as const;
    log('N4 to switches', keys.map((k) => `${k}=${g(r, C172[k])}`).join(' '), 'trim', g(r, C172.trimPosition), 'fd', g(r, 'ap.fd1_on'), 'selAlt', g(r, 'ap.sel_alt_ft'), 'xpdr', r.vars.getString('g1k.xpdr.mode'), g(r, 'g1k.xpdr.mode'));
    evalList(r, 'Before Takeoff', 'N4 takeoff preset');
    // After landing / securing from ready_to_taxi
    const s = makeG1k({ state: 'ready_to_taxi' });
    s.run(3);
    evalList(s, 'After Landing', 'N4 rtt');
    s.vars.set(C172.throttle, 0);
    s.vars.set(C172.avionicsBus1, 0);
    s.vars.set(C172.avionicsBus2, 0);
    s.vars.set(C172.beacon, 0);
    s.vars.set(C172.nav, 0);
    s.vars.set(C172.taxi, 0);
    s.run(1);
    s.vars.set(C172.mixture, 0);
    s.run(12);
    log('N4 after ICO rpm', g(s, ENG.rpm(1)));
    s.vars.set(C172.magneto, MAG.off);
    s.vars.set(C172.masterAlt, 0);
    s.vars.set(C172.masterBat, 0);
    s.run(1);
    snap(s, 'N4 master off, stby still ARM');
    s.run(60);
    snap(s, 'N4 master off 60 s, stby ARM');
    s.vars.set(C172.stbyBatt, STBY_BATT.off);
    s.vars.set(C172G.keyTag, 1);
    s.run(0.2);
    s.vars.set(C172G.keyTag, 0);
    s.vars.set(C172.controlLock, 1);
    s.vars.set(C172.fuelSelector, FUEL_SEL.left);
    s.run(2);
    snap(s, 'N4 secured');
    log('N4 keyIn', g(s, C172.keyIn));
    evalList(s, 'Securing Airplane', 'N4 secured');
  });

  it('E1 electrical abnormal procedures', () => {
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    r.run(4);
    log('==== E1');
    snap(r, 'E1 cruise');
    evalList(r, 'Cruise', 'E1');
    // ALT FIELD CB pull -> LOW VOLTS; POH procedure
    r.vars.set('cb.alt_field', 0);
    r.run(10);
    snap(r, 'E1 alt field CB out');
    evalList(r, 'EMERGENCY — LOW VOLTS', 'E1 alt fld out');
    r.vars.set(C172.masterAlt, 0);
    r.run(1);
    r.vars.set('cb.alt_field', 1);
    r.vars.set(C172.masterAlt, 1);
    r.run(10);
    snap(r, 'E1 after POH reset');
    evalList(r, 'EMERGENCY — LOW VOLTS', 'E1 after reset');
    // ALT only OFF
    r.vars.set(C172.masterAlt, 0);
    r.run(5);
    snap(r, 'E1 ALT only off');
    // Master BAT off with ALT on (interlock?)
    r.vars.set(C172.masterAlt, 1);
    r.vars.set(C172.masterBat, 0);
    r.run(2);
    log('E1 BAT off with ALT on -> masterAlt', g(r, C172.masterAlt), 'mbus', g(r, C172.mBusV));
    r.vars.set(C172.masterBat, 1);
    r.vars.set(C172.masterAlt, 1);
    r.run(3);
    // HIGH VOLTS: failure?
    const fm = (r.sys as unknown as { core: { failures: { list(): { id: string }[] } } }).core.failures;
    log('E1 failure ids', fm.list().map((d) => d.id));
    // Autopilot failure procedure: AP CB pull
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(2);
    r.vars.set('cb.autopilot', 0);
    r.run(3);
    log('E1 AP CB out', 'eng', g(r, 'ap.engaged'), 'cas', cas(r), 'afcs', r.vars.getString(G1K.afcsStatus));
    evalList(r, 'EMERGENCY — Autopilot', 'E1 AP cb');
    r.vars.set('cb.autopilot', 1);
    // ADC/AHRS CB out
    r.vars.set('cb.adc_ahrs_ess', 0);
    r.vars.set('cb.adc_ahrs_avn1', 0);
    r.run(3);
    log('E1 ADC AHRS CBs out', 'adc1', g(r, 'adc1.valid'), 'ahrs1', g(r, 'ahrs1.valid'));
    r.vars.set('cb.adc_ahrs_ess', 1);
    r.vars.set('cb.adc_ahrs_avn1', 1);
    // Electrical fire: STBY OFF, MASTER OFF -> everything off?
    r.vars.set(C172.stbyBatt, STBY_BATT.off);
    r.vars.set(C172.masterBat, 0);
    r.vars.set(C172.masterAlt, 0);
    r.run(3);
    snap(r, 'E1 elec fire: stby+master off');
    log('E1 engine running with all elec off rpm', g(r, ENG.rpm(1)));
    // extinguisher
    r.vars.set(C172G.extTrigger, 1);
    r.run(3);
    r.vars.set(C172G.extTrigger, 0);
    r.run(1);
    log('E1 extinguisher', g(r, C172.extinguisher), 'psi', g(r, C172G.extPsi));
    evalList(r, 'EMERGENCY — Electrical Fire', 'E1');
  });

  it('E2 engine fire / failure / vacuum / CO / icing', () => {
    const r = makeG1k({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    r.run(4);
    log('==== E2');
    r.vars.set(C172.mixture, 0);
    r.vars.set(C172.fuelShutoff, 0);
    r.run(15);
    log('E2 ICO + shutoff rpm', g(r, ENG.rpm(1)), 'ff', g(r, ENG.fuelFlowGph(1)), 'oil', g(r, ENG.oilPressPsi(1)), 'cas', cas(r));
    // restart
    r.vars.set(C172.fuelShutoff, 1);
    r.vars.set(C172.fuelPump, 1);
    r.vars.set(C172.mixture, 1);
    r.run(10);
    log('E2 restart windmill rpm', g(r, ENG.rpm(1)), 'ias', g(r, 'adc1.ias_kt'));
    r.vars.set(C172.fuelPump, 0);
    r.run(3);
    // engine-driven fuel pump failure
    r.vars.set('fail.fuel.edp', 1);
    r.run(5);
    log('E2 EDP fail ff', g(r, ENG.fuelFlowGph(1)), 'rpm', g(r, ENG.rpm(1)));
    r.vars.set(C172.fuelPump, 1);
    r.run(5);
    log('E2 EDP fail pump on ff', g(r, ENG.fuelFlowGph(1)), 'rpm', g(r, ENG.rpm(1)));
    // vacuum failure
    const v = makeG1k({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    v.run(3);
    v.vars.set('fail.vacuum.pump', 1);
    v.vars.set('fail.c172.vacuum_pump', 1);
    v.run(10);
    log('E2 vacuum fail attempt: suction', g(v, 'ac.vac.suction_inhg'), 'ann', g(v, ANN.lowVacuum), 'gyroFlag', g(v, C172G.gyroFlag), 'cas', cas(v));
    // CO
    v.vars.set('fail.c172.muffler_leak', 1);
    v.vars.set(C172.cabinHeat, 1);
    v.run(120);
    log('E2 CO muffler + heat 120s', 'co ann', g(v, ANN.coLvlHigh), 'cas', cas(v));
    v.vars.set(C172.cabinHeat, 0);
    v.vars.set(C172.cabinAir, 1);
    v.vars.set(C172.ventLeft, 1);
    v.vars.set(C172.ventRight, 1);
    v.run(120);
    log('E2 CO after POH steps 120s', 'co ann', g(v, ANN.coLvlHigh));
  });
});
