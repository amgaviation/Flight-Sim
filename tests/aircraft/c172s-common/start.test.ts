/**
 * Engine start from cold & dark following the POH "Starting Engine (With Battery)"
 * checklist, driving only cockpit control vars, for both electrical variants:
 *  - steam (172SPHUS Rev 5 Sec 4): master ON, beacon ON, aux pump ON + mixture rich
 *    3-5 s (prime), mixture idle cut-off, pump OFF, ignition START, mixture rich when it
 *    fires, oil pressure, avionics ON;
 *  - G1000 (172SPHAUS-03 Sec 4): STBY BATT TEST (green lamp stays lit) then ARM (PFD powered
 *    by the standby battery with the master OFF: E BUS >= 24 V, M BUS <= 1.5 V, S BATT
 *    discharging, STBY BATT annunciator), then the same start; M BATT and S BATT charging
 *    and LOW VOLTS off after the start.
 * Also: the starter current / bus dip picture and the POH run-up magneto check.
 */
import { describe, expect, it } from 'vitest';
import { ENG } from '../../../src/core/vars';
import { ANN, C172, MAG, STBY_BATT } from '../../../src/aircraft/c172s-common/vars';
import { make172, hold, type Rig } from './helpers';

function prime(r: Rig): void {
  const v = r.vars;
  v.set(C172.fuelPump, 1);
  v.set(C172.mixture, 1);
  r.run(4); // "until stable fuel flow is indicated (usually 3 to 5 seconds)"
  v.set(C172.mixture, 0);
  v.set(C172.fuelPump, 0);
}

/** Cranks on START until the engine runs (max 10 s: POH starter duty cycle), advancing the mixture when it fires. */
function crank(r: Rig): { started: boolean; minBusV: number; maxStarterA: number } {
  const v = r.vars;
  let minBusV = 99;
  let maxStarterA = 0;
  v.set(C172.magneto, MAG.start);
  let started = false;
  r.run(10, () => {
    minBusV = Math.min(minBusV, v.get('elec.bus1_v'));
    maxStarterA = Math.max(maxStarterA, v.get('elec.starter_amps'));
    if (v.get(ENG.rpm(1)) > 450) v.set(C172.mixture, 1); // "advance smoothly to RICH when engine starts"
    if (v.get(ENG.running(1)) > 0.5 && v.get(ENG.rpm(1)) > 700) {
      started = true;
      return true;
    }
    return false;
  });
  v.set(C172.magneto, MAG.both); // spring-loaded back to BOTH
  v.set(C172.mixture, 1);
  return { started, minBusV, maxStarterA };
}

describe('Cessna 172S cold & dark engine start (POH Sec 4)', () => {
  it('steam: battery start, alternator on line, vacuum and oil pressure come up', () => {
    const r = make172({ variant: 'steam', state: 'cold_dark' });
    const v = r.vars;
    r.run(1);
    expect(v.get(ENG.running(1))).toBe(0);
    expect(v.get('elec.bus1_powered')).toBe(0);
    // Preflight / before starting engine
    v.set(C172.controlLock, 0);
    v.set(C172.keyIn, 1);
    expect(v.get(C172.fuelShutoff)).toBe(1);
    v.set(C172.throttle, 0.08); // open 1/4 inch
    v.set(C172.mixture, 0);
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    v.set(C172.beacon, 1);
    r.run(1);
    expect(v.get('elec.bus1_v')).toBeGreaterThan(23.5);
    expect(v.get('elec.bus1_v')).toBeLessThan(26);
    // Annunciator panel with the engine stopped: OIL PRESS, L VAC R, VOLTS lit (after the flash period).
    r.run(11);
    expect(v.get(ANN.oilPress)).toBe(1);
    expect(v.get(ANN.vacL)).toBe(1);
    expect(v.get(ANN.vacR)).toBe(1);
    expect(v.get(ANN.lamp('volts'))).toBeGreaterThan(0.5);
    prime(r);
    const s = crank(r);
    expect(s.started).toBe(true);
    // Battery start: ~150-250 A cranking; bus dips well below 24 V but the contactors hold (> 14 V).
    expect(s.maxStarterA).toBeGreaterThan(120);
    expect(s.maxStarterA).toBeLessThan(450);
    expect(s.minBusV).toBeLessThan(22);
    expect(s.minBusV).toBeGreaterThan(14);
    r.run(30);
    expect(v.get(ENG.running(1))).toBe(1);
    // Throttle open 1/4 inch: fast idle.
    expect(v.get(ENG.rpm(1))).toBeGreaterThan(800);
    expect(v.get(ENG.rpm(1))).toBeLessThan(1600);
    // Throttle closed: POH Sec 4 "engine idles (approximately 600 RPM)".
    v.set(C172.throttle, 0);
    r.run(10);
    expect(v.get(ENG.rpm(1))).toBeGreaterThan(520);
    expect(v.get(ENG.rpm(1))).toBeLessThan(720);
    expect(v.get(ENG.oilPressPsi(1))).toBeGreaterThan(20);
    expect(v.get(ANN.oilPress)).toBe(0);
    // Alternator on line; the battery recharges after the start.
    v.set(C172.throttle, 0.17); // ~1000-1200 rpm
    r.run(10);
    expect(v.get('elec.alt_online')).toBe(1);
    expect(v.get('elec.batt_amps')).toBeGreaterThan(0);
    expect(v.get('elec.bus1_v')).toBeGreaterThan(27);
    expect(v.get(ANN.lowVolts)).toBe(0);
    // Two vacuum pumps pull suction into the green arc.
    expect(v.get('ac.vac.suction_inhg')).toBeGreaterThan(4.3);
    expect(v.get(ANN.vacL)).toBe(0);
    expect(v.get(ANN.vacR)).toBe(0);
    // Avionics ON.
    v.set(C172.avionicsBus1, 1);
    v.set(C172.avionicsBus2, 1);
    r.run(1);
    expect(v.get('elec.nav_com1_powered')).toBe(1);
    expect(v.get('elec.autopilot_powered')).toBe(1);
  });

  it('G1000: STBY BATT test and ARM, then the start; both batteries charge', () => {
    const r = make172({ variant: 'g1000', state: 'cold_dark' });
    const v = r.vars;
    r.run(1);
    v.set(C172.controlLock, 0);
    v.set(C172.keyIn, 1);
    v.set(C172.throttle, 0.08);
    v.set(C172.mixture, 0);
    // STBY BATT TEST: hold 20 s, the green TEST lamp must not go off.
    let lampOff = false;
    v.set(C172.stbyBatt, STBY_BATT.test);
    r.run(20, (t) => {
      if (t > 20.5 && v.get(C172.stbyTestLamp) < 0.5) lampOff = true;
    });
    expect(lampOff).toBe(false);
    expect(v.get(C172.stbyTestLamp)).toBe(1);
    v.set(C172.stbyBatt, STBY_BATT.arm);
    r.run(12);
    // With the MASTER still OFF the standby battery powers the ESS bus (PFD on).
    expect(v.get('elec.pfd_powered')).toBe(1);
    expect(v.get(C172.eBusV)).toBeGreaterThanOrEqual(24);
    expect(v.get(C172.mBusV)).toBeLessThanOrEqual(1.5);
    expect(v.get(C172.sBattA)).toBeLessThan(0);
    expect(v.get(ANN.stbyBatt)).toBe(1);
    // Master ON, beacon, prime, start.
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    v.set(C172.beacon, 1);
    r.run(2);
    prime(r);
    const s = crank(r);
    expect(s.started).toBe(true);
    v.set(C172.throttle, 0.17);
    r.run(5);
    // AMPS (M BATT and BATT S) - CHECK charge (positive): the batteries recharge after the start.
    expect(v.get(C172.mBattA)).toBeGreaterThan(0.5);
    expect(v.get(C172.sBattA)).toBeGreaterThan(0);
    r.run(35);
    expect(v.get(ENG.running(1))).toBe(1);
    expect(v.get(ENG.oilPressPsi(1))).toBeGreaterThan(20);
    // LOW VOLTS - not shown.
    expect(v.get(ANN.lowVolts)).toBe(0);
    expect(v.get(ANN.stbyBatt)).toBe(0);
    expect(v.get(C172.mBusV)).toBeGreaterThan(27);
    // Avionics buses and the dual-fed units.
    v.set(C172.avionicsBus1, 1);
    v.set(C172.avionicsBus2, 1);
    r.run(1);
    expect(v.get('elec.mfd_powered')).toBe(1);
    expect(v.get('elec.adc_ahrs_powered')).toBe(1);
    expect(v.get('elec.nav1_eng_powered')).toBe(1);
    // Single vacuum pump for the standby attitude indicator.
    expect(v.get(ANN.lowVacuum)).toBe(0);
  });

  it('run-up at 1800 rpm: magneto drop within POH limits (<= 150 rpm, <= 50 rpm differential)', () => {
    const r = make172({ variant: 'steam', state: 'ready_to_taxi' });
    const v = r.vars;
    v.set(C172.parkingBrake, 1);
    v.set(C172.mixture, 1);
    // Set 1800 rpm with the throttle.
    let thr = 0.3;
    r.run(20, () => {
      thr = Math.max(0, Math.min(1, thr + 0.00004 * (1800 - v.get(ENG.rpm(1)))));
      v.set(C172.throttle, thr);
    });
    r.run(5);
    const both = v.get(ENG.rpm(1));
    expect(both).toBeGreaterThan(1750);
    expect(both).toBeLessThan(1850);
    hold(r, C172.magneto, MAG.right, 6, MAG.both);
    const rDrop = both - v.get(ENG.rpm(1));
    r.run(6);
    hold(r, C172.magneto, MAG.left, 6, MAG.both);
    const lDrop = both - v.get(ENG.rpm(1));
    r.run(6);
    // Re-measure the drops at the end of each hold (the hold() above restores BOTH afterwards).
    v.set(C172.magneto, MAG.right);
    r.run(6);
    const rpmR = v.get(ENG.rpm(1));
    v.set(C172.magneto, MAG.both);
    r.run(6);
    v.set(C172.magneto, MAG.left);
    r.run(6);
    const rpmL = v.get(ENG.rpm(1));
    v.set(C172.magneto, MAG.both);
    r.run(6);
    const dropR = both - rpmR;
    const dropL = both - rpmL;
    void rDrop;
    void lDrop;
    expect(dropR).toBeGreaterThan(20); // an absence of drop means a faulty ground (POH)
    expect(dropL).toBeGreaterThan(20);
    expect(dropR).toBeLessThanOrEqual(150);
    expect(dropL).toBeLessThanOrEqual(150);
    expect(Math.abs(dropR - dropL)).toBeLessThanOrEqual(50);
    // Vacuum in the green at run-up power (POH Sec 4 "Vacuum gage - CHECK").
    expect(v.get('ac.vac.suction_inhg')).toBeGreaterThanOrEqual(4.5);
    expect(v.get('ac.vac.suction_inhg')).toBeLessThanOrEqual(5.5);
    // Parking brake held the run-up.
    expect(v.get('fdm.gs_kt')).toBeLessThan(0.5);
  });
});
