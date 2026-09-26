import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { ADC, AP, NAV } from '../../../src/core/vars';
import { CtpLogic, CtpPage, stepAdf, stepCom, stepNav, stepSquawk } from '../../../src/avionics/collins-fusion/logic/ctp';
import { SourceSelector } from '../../../src/avionics/collins-fusion/logic/sources';
import { FusionCas } from '../../../src/avionics/collins-fusion/logic/cas';
import { ChecklistLogic, isNonNormal } from '../../../src/avionics/collins-fusion/logic/checklist';
import { SynopticReadouts } from '../../../src/avionics/collins-fusion/logic/readouts';
import { DEFAULT_SENSORS } from '../../../src/avionics/collins-fusion/config';
import { BrgSrc, FUSION_EVENTS, FUSION_VARS, NavSrc } from '../../../src/avionics/collins-fusion/vars';

function ctpSetup() {
  const vars = new SimVars();
  const events = new EventBus();
  const ctp = new CtpLogic(vars, events, { sensors: DEFAULT_SENSORS });
  return { vars, events, ctp };
}

describe('Control tuning panel (CTP)', () => {
  it('frequency steps: COM 1 MHz / 25 kHz wrapping in 118-136, NAV 50 kHz, ADF, octal squawk', () => {
    expect(stepCom(118.0, -1, false)).toBeCloseTo(136.0, 6);
    expect(stepCom(121.975, 1, true)).toBeCloseTo(121.0, 6);
    expect(stepCom(121.5, 2, true)).toBeCloseTo(121.55, 6);
    expect(stepNav(117.95, 1, true)).toBeCloseTo(117.0, 6);
    expect(stepNav(108.1, -1, false)).toBeCloseTo(117.1, 6);
    expect(stepAdf(1799, 5, false)).toBe(1799);
    expect(stepAdf(350, 3, true)).toBe(353);
    expect(stepSquawk(1277, 1, true)).toBe(1200); // the two digit pairs wrap independently
    expect(stepSquawk(1234, 4, true)).toBe(1240);
    expect(stepSquawk(7700, 1, false)).toBe(0);
    expect(stepSquawk(1200, 1, false)).toBe(1300);
  });

  it('RADIO page: line select + TUNE knob into the standby, second press / push transfers', () => {
    const { vars, events } = ctpSetup();
    const s = 1;
    events.emit(FUSION_EVENTS.ctpKey(s), 'COM');
    events.emit(FUSION_EVENTS.ctp(s, 'tune_out_inc'), 2);
    events.emit(FUSION_EVENTS.ctp(s, 'tune_in_inc'), 1);
    expect(vars.get(NAV.comStandby(1))).toBeCloseTo(120.125, 6);
    const act = vars.get(NAV.comActive(1));
    events.emit(FUSION_EVENTS.ctpLsk(s), 1); // second press on the selected COM line
    expect(vars.get(NAV.comActive(1))).toBeCloseTo(120.125, 6);
    expect(vars.get(NAV.comStandby(1))).toBeCloseTo(act, 6);
    events.emit(FUSION_EVENTS.ctpLsk(s), 2); // NAV line
    events.emit(FUSION_EVENTS.ctp(s, 'tune_in_dec'), 2);
    events.emit(FUSION_EVENTS.ctp(s, 'tune_push'));
    expect(vars.get(NAV.activeFreq(1))).toBeCloseTo(108.4, 6);
    // ATC: code entry with the knob, LSK cycles the mode, IDENT key.
    events.emit(FUSION_EVENTS.ctpLsk(s), 4);
    events.emit(FUSION_EVENTS.ctp(s, 'tune_in_inc'), 3);
    expect(vars.get(NAV.xpdrCode)).toBe(2003);
    events.emit(FUSION_EVENTS.ctpLsk(s), 4);
    expect(vars.get(NAV.xpdrMode)).toBe(3);
    events.emit(FUSION_EVENTS.ctpKey(s), 'IDENT');
    expect(vars.get(NAV.xpdrIdent)).toBe(1);
  });

  it('PFD page: NAV SRC cycle, bearing pointers, SVS, HSI format, baro unit', () => {
    const { vars, events, ctp } = ctpSetup();
    events.emit(FUSION_EVENTS.ctpKey(1), 'PFD');
    expect(ctp.page(1)).toBe(CtpPage.Pfd);
    vars.set(NAV.obs(1), 42);
    events.emit(FUSION_EVENTS.ctpLsk(1), 1);
    expect(vars.get(FUSION_VARS.navSource(1))).toBe(NavSrc.Nav1);
    expect(vars.get(AP.selCourse(1))).toBe(42);
    events.emit(FUSION_EVENTS.ctpLsk(1), 1);
    expect(vars.get(FUSION_VARS.navSource(1))).toBe(NavSrc.Nav2);
    events.emit(FUSION_EVENTS.ctpLsk(1), 1);
    expect(vars.get(FUSION_VARS.navSource(1))).toBe(NavSrc.Fms);
    events.emit(FUSION_EVENTS.ctpLsk(1), 2);
    expect(vars.get(FUSION_VARS.brg(1, 1))).toBe(BrgSrc.Vor);
    events.emit(FUSION_EVENTS.ctpLsk(1), 4);
    expect(vars.get(FUSION_VARS.svs(1))).toBe(0);
    events.emit(FUSION_EVENTS.ctpLsk(1), 5);
    expect(vars.get(FUSION_VARS.hsiRose(1))).toBe(1);
    events.emit(FUSION_EVENTS.ctpKey(1), 'HSI');
    expect(ctp.page(1)).toBe(CtpPage.Hsi);
  });

  it('BARO knob: 0.01 inHg / 1 hPa steps, PUSH STD with preselect; MINS knob and RA / BARO', () => {
    const { vars, events } = ctpSetup();
    vars.set(ADC.baroSetting(1), 29.92);
    events.emit(FUSION_EVENTS.ctp(1, 'baro_dec'), 5);
    expect(vars.get(ADC.baroSetting(1))).toBeCloseTo(29.87, 6);
    events.emit(FUSION_EVENTS.ctp(1, 'baro_push'));
    expect(vars.get(ADC.baroStd(1))).toBe(1);
    events.emit(FUSION_EVENTS.ctp(1, 'baro_inc'), 10); // preselect while STD
    expect(vars.get(FUSION_VARS.baroPreset(1))).toBeCloseTo(29.97, 6);
    events.emit(FUSION_EVENTS.ctp(1, 'baro_push'));
    expect(vars.get(ADC.baroStd(1))).toBe(0);
    expect(vars.get(ADC.baroSetting(1))).toBeCloseTo(29.97, 6);
    vars.set(FUSION_VARS.baroHpa(1), 1);
    events.emit(FUSION_EVENTS.ctp(1, 'baro_inc'), 1);
    expect(vars.get(ADC.baroSetting(1)) * 33.8639).toBeCloseTo(1016, 0);
    events.emit(FUSION_EVENTS.ctp(1, 'mins_inc'), 5);
    expect(vars.get(AP.minimums(1))).toBe(250);
    events.emit(FUSION_EVENTS.ctp(1, 'mins_push'));
    expect(vars.get(AP.minimumsIsRadio(1))).toBe(0);
  });
});

describe('RSP source selection', () => {
  it('ADC NORM / X-SIDE / STBY and ATT IRS 3', () => {
    const vars = new SimVars();
    const src = new SourceSelector(vars, DEFAULT_SENSORS);
    expect(vars.get(FUSION_VARS.adcSrc(1))).toBe(1);
    vars.set(FUSION_VARS.rspAdc(1), 1);
    vars.set(FUSION_VARS.rspAtt(2), 1);
    src.update();
    expect(vars.get(FUSION_VARS.adcSrc(1))).toBe(2);
    expect(vars.get(FUSION_VARS.ahrsSrc(2))).toBe(DEFAULT_SENSORS.thirdAhrs);
    expect(src.sides[1].ahrsReverted).toBe(true);
    vars.set(FUSION_VARS.rspAdc(1), 2);
    src.update();
    expect(vars.get(FUSION_VARS.adcSrc(1))).toBe(DEFAULT_SENSORS.standbyAdc);
  });
});

describe('EICAS CAS list', () => {
  it('orders warnings first, keeps them on scroll, counts hidden messages', () => {
    const vars = new SimVars();
    const cas = new FusionCas(vars);
    cas.rows = 3;
    const m = cas.model;
    m.set('w1', 'ENG FIRE', 'warning', true);
    for (let i = 0; i < 4; i++) m.set(`c${i}`, `CAUTION ${i}`, 'caution', true);
    m.set('s', 'STATUS', 'status', true);
    const v = cas.view();
    expect(v[0].text).toBe('ENG FIRE');
    expect(v).toHaveLength(3);
    expect(cas.hiddenBelowCount).toBe(3);
    cas.scrollBy(10);
    const v2 = cas.view();
    expect(v2[0].text).toBe('ENG FIRE');
    expect(cas.hiddenBelowCount).toBe(0);
    expect(cas.hiddenAbove).toBe(3);
    expect(cas.newestUnacked()?.level).toBe('caution');
    expect(cas.newestLinked({ c2: 'X' })?.id).toBe('c2');
  });
});

describe('Electronic checklist', () => {
  const lists = [
    { title: 'Before Taxi', phase: 'Normal', items: [{ challenge: 'Flaps', response: 'SET', check: (v: SimVars) => v.get('surf.flaps_deg') > 5 }, { challenge: 'Trim', response: 'SET' }] },
    { title: 'Engine Fire', phase: 'Emergency', items: [{ challenge: 'Thrust lever', response: 'IDLE' }] },
  ];

  it('checks open-loop items with ENTER, senses closed-loop items, completes', () => {
    const vars = new SimVars();
    const ecl = new ChecklistLogic(vars, lists);
    expect(ecl.current?.title).toBe('Before Taxi');
    vars.set('surf.flaps_deg', 16);
    ecl.update(0.3);
    expect(ecl.checked[0][0]).toBe(true);
    expect(ecl.cursor).toBe(0);
    ecl.move(1);
    ecl.toggle();
    expect(ecl.isComplete()).toBe(true);
    expect(vars.get(FUSION_VARS.eclComplete)).toBe(1);
    expect(ecl.openTitle('engine fire')).toBe(true);
    expect(isNonNormal(ecl.current!)).toBe(true);
    ecl.resetAll();
    expect(ecl.isComplete(0)).toBe(false);
  });
});

describe('Synoptic readouts', () => {
  it('default bindings follow the systems var names; unwritten vars read NaN; overrides win', () => {
    const vars = new SimVars();
    const ro = new SynopticReadouts(vars, { 'hyd1.psi': 'my.hyd_a * 2' });
    expect(ro.v('gen1.v')).toBeNaN();
    expect(ro.b('gen1.online')).toBeNull();
    vars.set('elec.gen1_v', 115);
    vars.set('elec.gen1_online', 1);
    expect(ro.v('gen1.v')).toBe(115);
    expect(ro.b('gen1.online')).toBe(true);
    vars.set('fuel.tank0_kg', 1000);
    expect(ro.v('fuel.l.lb')).toBeCloseTo(2204.62, 1);
    vars.set('my.hyd_a', 1500);
    expect(ro.v('hyd1.psi')).toBe(3000);
    expect(ro.has('door.pax')).toBe(true);
  });
});
