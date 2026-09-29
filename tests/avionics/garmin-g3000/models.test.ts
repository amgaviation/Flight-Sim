import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import {
  ChecklistModel,
  GenericTimer,
  MessageList,
  MinimumsModel,
  ToldModel,
  VSpeedBank,
  WeightFuel,
  tempCompCorrectionFt,
} from '../../../src/avionics/garmin-g3000/state/models';
import { G3K, MINS_MODE } from '../../../src/avionics/garmin-g3000/vars';
import { M2_VSPEEDS } from '../../../src/avionics/garmin-g3000/presets';
import type { PerformanceProvider } from '../../../src/avionics/garmin-g3000/config';

describe('GenericTimer', () => {
  it('counts up, counts down from a preset and continues up after zero', () => {
    const v = new SimVars();
    const t = new GenericTimer(v);
    t.start();
    t.update(10);
    expect(t.seconds).toBeCloseTo(10);
    t.reset();
    expect(t.seconds).toBe(0);
    expect(t.running).toBe(false);
    t.setPreset(5);
    t.setDirection(true);
    expect(t.seconds).toBe(5);
    t.start();
    t.update(3);
    expect(t.seconds).toBeCloseTo(2);
    t.update(4);
    expect(t.countingDown).toBe(false);
    expect(t.seconds).toBeCloseTo(2);
  });
});

describe('VSpeedBank', () => {
  it('values, flags (only with a value), groups, TOLD and defaults', () => {
    const v = new SimVars();
    const b = new VSpeedBank(v, [...M2_VSPEEDS, { id: 'VX', label: 'X', group: 'other' }]);
    expect(b.value('V1')).toBe(100);
    expect(b.on('V1')).toBe(false);
    expect(b.setOn('VX', true)).toBe(false); // no value
    b.set('V1', 104);
    expect(b.source('V1')).toBe('pilot');
    b.setGroup('takeoff', true);
    expect(b.on('V1') && b.on('VR') && b.on('V2')).toBe(true);
    expect(b.on('VREF')).toBe(false);
    b.applyTold({ VREF: 111, VAPP: 116 });
    expect(b.value('VREF')).toBe(111);
    expect(b.on('VREF')).toBe(true);
    expect(b.source('VREF')).toBe('told');
    expect(v.get(G3K.vspeedKt('VREF'))).toBe(111);
    b.restoreDefaults();
    expect(b.value('V1')).toBe(100);
    expect(b.on('V1')).toBe(false);
  });
});

describe('Minimums', () => {
  it('temperature compensation follows the PANS-OPS approximation, only when colder than ISA', () => {
    // 500 ft above a sea-level aerodrome at -20 C: dH = 500 * 35 / 253.15 = 69 ft.
    expect(tempCompCorrectionFt(500, 0, -20)).toBeCloseTo(69.1, 0);
    expect(tempCompCorrectionFt(500, 0, 20)).toBe(0);
  });
  it('publishes the AFCS minimums vars per mode', () => {
    const v = new SimVars();
    const m = new MinimumsModel(v);
    m.set(MINS_MODE.baro, 480);
    expect(v.get('ap.mins1_ft')).toBe(480);
    expect(v.get('ap.mins2_is_ra')).toBe(0);
    m.set(MINS_MODE.radio, 200);
    expect(v.get('ap.mins1_is_ra')).toBe(1);
    m.destElevFt = 0;
    m.setTemp(-20);
    m.set(MINS_MODE.tempComp, 500);
    expect(m.effectiveFt()).toBeCloseTo(569, 0);
    m.reset();
    expect(Number.isNaN(v.get('ap.mins1_ft'))).toBe(true);
  });
});

describe('Checklists and messages', () => {
  it('checks items and moves the cursor', () => {
    const c = new ChecklistModel([{ title: 'A', phase: 'N', items: [{ challenge: 'x', response: 'y' }, { challenge: 'z', response: 'w' }] }]);
    c.toggle();
    expect(c.isChecked(0)).toBe(true);
    expect(c.cursor).toBe(1);
    c.toggle();
    expect(c.complete()).toBe(true);
    c.resetList();
    expect(c.complete()).toBe(false);
  });
  it('messages: unread count, grey when cleared, dropped after being seen', () => {
    const m = new MessageList();
    m.set('a', 'A', true);
    m.set('b', 'B', true);
    expect(m.unread).toBe(2);
    m.markAllRead();
    expect(m.unread).toBe(0);
    m.set('a', 'A', false);
    expect(m.list.find((x) => x.id === 'a')!.active).toBe(false);
    m.markAllRead();
    expect(m.list.find((x) => x.id === 'a')).toBeUndefined();
    m.set('b', 'B', false);
    m.set('b', 'B', true);
    expect(m.unread).toBe(1);
  });
});

describe('Weight and fuel / TOLD', () => {
  it('computes ZFW, gross and landing weight with cautions', () => {
    const v = new SimVars();
    const wf = new WeightFuel(v, { basicOperatingLb: 7000, maxRampLb: 10800, maxTakeoffLb: 10700, maxLandingLb: 9900, maxZeroFuelLb: 8400, paxLb: 200 }, 'fuel.total_kg');
    wf.pax = 4;
    wf.crewStoresLb = 400;
    v.set('fuel.total_kg', 1000);
    expect(wf.zfwLb).toBe(8200);
    expect(wf.grossLb).toBeCloseTo(8200 + 2204.6, 0);
    expect(wf.over('zfw')).toBe(false);
    wf.cargoLb = 300;
    expect(wf.over('zfw')).toBe(true);
    v.set('fms.fuel_dest_kg', 500);
    expect(wf.landingLb).toBeCloseTo(8500 + 1102.3, 0);
    wf.publish();
    expect(v.get(G3K.wfZfwLb)).toBe(8500);
  });
  it('TOLD calls the provider and reports validity', () => {
    const v = new SimVars();
    const prov: PerformanceProvider = {
      takeoffFlaps: ['15'],
      landingFlaps: ['35'],
      takeoff: (i) => ({ vspeeds: { V1: 90 + i.weightLb / 1000, VR: 95, V2: 105 }, n1Pct: 95 }),
      landing: () => null,
    };
    const t = new ToldModel(v, prov);
    t.inputs.takeoff.weightLb = 10000;
    expect(t.computeTakeoff()!.vspeeds.V1).toBe(100);
    expect(v.get(G3K.toldTakeoffValid)).toBe(1);
    expect(t.computeLanding()).toBeNull();
    expect(v.get(G3K.toldLandingValid)).toBe(0);
    const c = ToldModel.components(40, 70, 20);
    expect(c.head).toBeCloseTo(17.32, 1);
    expect(c.cross).toBeCloseTo(10, 1);
  });
});
