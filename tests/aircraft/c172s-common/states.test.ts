/**
 * Cessna 172S initial-state presets (both electrical variants) and the POH checklists' live
 * checks: every preset puts the switches where the POH checklist for that phase leaves them,
 * with the systems settled (no nuisance annunciations), and the checklist ticks follow the
 * cockpit state through a before-takeoff run-up.
 */
import { describe, expect, it } from 'vitest';
import { ENG, FDM, SURF } from '../../../src/core/vars';
import type { InitialState, Checklist } from '../../../src/aircraft/types';
import { ANN, C172, FUEL_SEL, MAG, STBY_BATT } from '../../../src/aircraft/c172s-common/vars';
import { c172Checklists } from '../../../src/aircraft/c172s-common/checklists';
import { TAKEOFF_TRIM } from '../../../src/aircraft/c172s-common/states';
import { make172, type Rig } from './helpers';

const STATES: InitialState[] = ['cold_dark', 'ready_to_taxi', 'takeoff', 'cruise', 'approach'];

function rigFor(variant: 'steam' | 'g1000', s: InitialState): Rig {
  const air = s === 'cruise' ? { altFtMsl: 6000, iasKt: 100 } : s === 'approach' ? { altFtMsl: 2000, iasKt: 70 } : undefined;
  return make172({ variant, state: s, grossLb: 2400, air });
}

function item(lists: Checklist[], title: string, challenge: string) {
  const l = lists.find((c) => c.title === title);
  if (!l) throw new Error(`no checklist ${title}`);
  const it = l.items.find((i) => i.challenge.trim().startsWith(challenge) && i.check);
  if (!it?.check) throw new Error(`no checked item ${challenge} in ${title}`);
  return it.check;
}

describe('Cessna 172S initial states', () => {
  for (const variant of ['steam', 'g1000'] as const) {
    for (const s of STATES) {
      it(`${variant} ${s}`, () => {
        const r = rigFor(variant, s);
        const v = r.vars;
        r.run(3);
        const g = variant === 'g1000';
        const running = v.get(ENG.running(1)) > 0.5;
        if (s === 'cold_dark') {
          expect(running).toBe(false);
          expect(v.get(C172.magneto)).toBe(MAG.off);
          expect(v.get(C172.keyIn)).toBe(0);
          expect(v.get(C172.controlLock)).toBe(1);
          expect(v.get(C172.parkingBrake)).toBe(1);
          expect(v.get(C172.mixture)).toBe(0);
          expect(v.get('elec.bus1_v')).toBe(0);
          expect(v.get('elec.xfeed_v')).toBe(0);
          if (g) {
            expect(v.get(C172.stbyBatt)).toBe(STBY_BATT.off);
            expect(v.get('elec.ess_v')).toBe(0);
            expect(v.get('elec.pfd_powered')).toBe(0);
          }
          expect(v.get(SURF.flapsDeg)).toBe(0);
          expect(v.get(C172.fuelSelector)).toBe(FUEL_SEL.both);
          expect(v.get(C172.fuelShutoff)).toBe(1);
          // A cold airplane stays cold.
          r.run(10);
          expect(v.get(ENG.running(1))).toBe(0);
          expect(v.get(ENG.rpm(1))).toBeLessThan(1);
          return;
        }
        expect(running).toBe(true);
        expect(v.get(C172.magneto)).toBe(MAG.both);
        expect(v.get(C172.controlLock)).toBe(0);
        expect(v.get('elec.alt_online')).toBe(1);
        expect(v.get('elec.bus1_v')).toBeGreaterThan(27);
        expect(v.get(ENG.oilPressPsi(1))).toBeGreaterThan(20);
        // No nuisance annunciations.
        for (const a of [ANN.oilPress, ANN.lowFuelL, ANN.lowFuelR, ANN.lowVolts, ANN.highVolts]) expect(v.get(a)).toBe(0);
        if (g) {
          expect(v.get(C172.stbyBatt)).toBe(STBY_BATT.arm);
          expect(v.get(ANN.stbyBatt)).toBe(0);
          expect(v.get(ANN.lowVacuum)).toBe(0);
          expect(v.get('elec.pfd_powered')).toBe(1);
          expect(v.get('elec.mfd_powered')).toBe(1);
        } else {
          expect(v.get(ANN.vacL)).toBe(0);
          expect(v.get(ANN.vacR)).toBe(0);
          expect(v.get('elec.nav_com1_powered')).toBe(1);
        }
        expect(v.get('ac.vac.suction_inhg')).toBeGreaterThan(s === 'ready_to_taxi' ? 3.5 : 4.5);
        expect(v.get(C172.beacon)).toBe(1);
        if (s === 'ready_to_taxi') {
          expect(v.get(ENG.rpm(1))).toBeGreaterThan(700);
          expect(v.get(ENG.rpm(1))).toBeLessThan(1300);
          expect(v.get(C172.parkingBrake)).toBe(1);
          expect(v.get(SURF.flapsDeg)).toBe(0);
          expect(v.get(FDM.gs)).toBeLessThan(0.5);
        }
        if (s === 'takeoff') {
          expect(v.get(SURF.flapsDeg)).toBeCloseTo(10, 0);
          expect(v.get(C172.mixture)).toBe(1);
          expect(v.get(C172.parkingBrake)).toBe(0);
          expect(v.get(C172.strobe)).toBe(1);
          expect(v.get(C172.land)).toBe(1);
          expect(v.get(C172.trimPosition)).toBeCloseTo(TAKEOFF_TRIM, 2);
        }
        if (s === 'cruise' || s === 'approach') {
          expect(v.get(FDM.onGround)).toBe(0);
          expect(v.get(SURF.flapsDeg)).toBeCloseTo(s === 'approach' ? 10 : 0, 0);
          expect(Math.abs(v.get(FDM.vs))).toBeLessThan(200);
          expect(Math.abs(v.get(FDM.bank))).toBeLessThan(3);
          if (s === 'cruise') {
            // POH Fig 5-8 envelope: 6000 ft, 100 KCAS lies between 2300 and 2500 rpm.
            expect(v.get(ENG.rpm(1))).toBeGreaterThan(2250);
            expect(v.get(ENG.rpm(1))).toBeLessThan(2550);
            expect(v.get(C172.mixture)).toBeLessThan(0.9); // leaned
          }
        }
      });
    }
  }
});

describe('Cessna 172S checklists', () => {
  it('every live check evaluates in every state for both variants', () => {
    for (const variant of ['steam', 'g1000'] as const) {
      const lists = c172Checklists(variant);
      expect(lists.length).toBeGreaterThan(15);
      for (const s of STATES) {
        const r = rigFor(variant, s);
        r.run(0.5);
        for (const l of lists) {
          expect(l.items.length).toBeGreaterThan(0);
          for (const i of l.items) if (i.check) expect(typeof i.check(r.vars)).toBe('boolean');
        }
      }
    }
  });

  it('cold & dark: the preflight cabin checks read the cockpit (lock installed, parking brake set)', () => {
    const r = rigFor('steam', 'cold_dark');
    const lists = c172Checklists('steam');
    const t = 'Preflight Inspection — Cabin';
    expect(item(lists, t, 'Parking Brake')(r.vars)).toBe(true);
    expect(item(lists, t, 'Control Wheel Lock')(r.vars)).toBe(false);
    r.vars.set(C172.controlLock, 0);
    expect(item(lists, t, 'Control Wheel Lock')(r.vars)).toBe(true);
  });

  for (const variant of ['steam', 'g1000'] as const) {
    it(`${variant}: before-takeoff run-up ticks follow the cockpit`, () => {
      const r = rigFor(variant, 'ready_to_taxi');
      const v = r.vars;
      const lists = c172Checklists(variant);
      const t = 'Before Takeoff';
      r.run(2);
      expect(item(lists, t, 'Parking Brake')(v)).toBe(true);
      expect(item(lists, t, 'Cabin Doors')(v)).toBe(true);
      expect(item(lists, t, 'Flight Controls')(v)).toBe(true);
      expect(item(lists, t, 'Fuel Selector Valve')(v)).toBe(true);
      v.set(C172.mixture, 1);
      expect(item(lists, t, 'Mixture')(v)).toBe(true);
      // Throttle 1800 RPM.
      let thr = 0.3;
      r.run(20, () => {
        thr = Math.max(0, Math.min(1, thr + 0.00004 * (1800 - v.get(ENG.rpm(1)))));
        v.set(C172.throttle, thr);
      });
      expect(item(lists, t, 'Throttle')(v)).toBe(true);
      expect(item(lists, t, g(variant) ? 'VAC Indicator' : 'Vacuum Gage')(v)).toBe(true);
      // Idle check, then brakes released for takeoff.
      v.set(C172.throttle, 0);
      r.run(8);
      const idle = lists.find((c) => c.title === t)!.items.find((i) => i.response.startsWith('CHECK IDLE'))!;
      expect(idle.check!(v)).toBe(true);
      expect(item(lists, t, 'Wing Flaps')(v)).toBe(true);
      expect(item(lists, t, 'Brakes')(v)).toBe(false);
      v.set(C172.parkingBrake, 0);
      expect(item(lists, t, 'Brakes')(v)).toBe(true);
    });
  }
});

function g(variant: string): boolean {
  return variant === 'g1000';
}
