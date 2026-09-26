import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { ADC, AP, FMS, NAV } from '../../../src/core/vars';
import { FcpLogic, EDM_ALT_FT, MAX_SEL_ALT_FT, type ApproachInfo } from '../../../src/avionics/collins-fusion/logic/fcp';
import { DEFAULT_EVENTS, DEFAULT_SENSORS, GLOBAL6000_AIRFRAME } from '../../../src/avionics/collins-fusion/config';
import { FUSION_EVENTS, FUSION_VARS, NavSrc } from '../../../src/avionics/collins-fusion/vars';
import { recordEvents } from './helpers';

function setup(approach: ApproachInfo | null = null) {
  const vars = new SimVars();
  const events = new EventBus();
  const fcp = new FcpLogic(vars, events, { sensors: DEFAULT_SENSORS, events: DEFAULT_EVENTS, airframe: GLOBAL6000_AIRFRAME, approachInfo: () => approach });
  const log = recordEvents(events);
  return { vars, events, fcp, log };
}

describe('Flight control panel (FCP)', () => {
  it('mode keys emit the AFCS events (ap.* prefix)', () => {
    const { events, log } = setup();
    for (const b of ['ap', 'yd', 'hdg', 'flc', 'vs', 'vnav', 'alt', 'bc', 'bank', 'fd1', 'toga']) events.emit(FUSION_EVENTS.fcp(b));
    const names = log.map((e) => e.name).filter((n) => n.startsWith('ap.'));
    expect(names).toEqual(['ap.ap', 'ap.yd', 'ap.hdg', 'ap.flc', 'ap.vs', 'ap.vnav', 'ap.alt', 'ap.bc', 'ap.half_bank', 'ap.fd1', 'ap.toga']);
    events.emit(FUSION_EVENTS.fcp('at'));
    expect(log.some((e) => e.name === 'at.engage')).toBe(true);
  });

  it('knobs: heading wraps, altitude 1000 ft / FINE 100 ft steps within 0-51,000 ft, speed IAS / Mach', () => {
    const { vars, events } = setup();
    vars.set(AP.selHeading, 358);
    events.emit(FUSION_EVENTS.fcp('hdg_inc'), 5);
    expect(vars.get(AP.selHeading)).toBe(3);
    vars.set(AP.selAltitude, 10000);
    events.emit(FUSION_EVENTS.fcp('alt_inc'), 2);
    expect(vars.get(AP.selAltitude)).toBe(12000);
    events.emit(FUSION_EVENTS.fcp('alt_push')); // FINE
    events.emit(FUSION_EVENTS.fcp('alt_dec'), 3);
    expect(vars.get(AP.selAltitude)).toBe(11700);
    events.emit(FUSION_EVENTS.fcp('alt_push'));
    events.emit(FUSION_EVENTS.fcp('alt_inc'), 1);
    expect(vars.get(AP.selAltitude)).toBe(12000); // snaps to the 1000 ft grid
    vars.set(AP.selAltitude, 50500);
    events.emit(FUSION_EVENTS.fcp('alt_inc'), 5);
    expect(vars.get(AP.selAltitude)).toBe(MAX_SEL_ALT_FT);
    vars.set(AP.selSpeed, 250);
    events.emit(FUSION_EVENTS.fcp('spd_inc'), 4);
    expect(vars.get(AP.selSpeed)).toBe(254);
    vars.set(AP.speedIsMach, 1);
    vars.set(AP.selMach, 0.8);
    events.emit(FUSION_EVENTS.fcp('spd_dec'), 2);
    expect(vars.get(AP.selMach)).toBeCloseTo(0.78, 6);
  });

  it('course knobs set the selected receiver OBS; PUSH DCT centres on the station', () => {
    const { vars, events } = setup();
    vars.set(NAV.obs(1), 90);
    events.emit(FUSION_EVENTS.fcp('crs1_inc'), 10);
    expect(vars.get(NAV.obs(1))).toBe(100);
    expect(vars.get(AP.selCourse(1))).toBe(100);
    vars.set(NAV.received(1), 1);
    vars.set(NAV.bearingValid(1), 1);
    vars.set(NAV.bearing(1), 123.4);
    events.emit(FUSION_EVENTS.fcp('crs1_push'));
    expect(vars.get(NAV.obs(1))).toBe(123);
  });

  it('SPD MAN / FMS: FMS targets drive the selected speed', () => {
    const { vars, events, fcp } = setup();
    events.emit(FUSION_EVENTS.fcp('spd_man'));
    expect(vars.get(FUSION_VARS.spdFms)).toBe(1);
    vars.set(FMS.vnavTargetSpeedKt, 280);
    vars.set(FMS.vnavTargetMach, 0);
    fcp.update(0.1);
    expect(vars.get(AP.selSpeed)).toBe(280);
    vars.set(FMS.vnavTargetMach, 0.83);
    fcp.update(0.1);
    expect(vars.get(AP.speedIsMach)).toBe(1);
    expect(vars.get(AP.selMach)).toBeCloseTo(0.83, 6);
    events.emit(FUSION_EVENTS.fcp('spd_inc'), 1); // turning the knob selects MAN
    expect(vars.get(FUSION_VARS.spdFms)).toBe(0);
  });

  it('CPL selects the coupled side; the AFCS nav source follows that PFD', () => {
    const { vars, events, fcp } = setup();
    vars.set(FUSION_VARS.navSource(2), NavSrc.Nav2);
    fcp.update(0);
    expect(vars.get('ap.nav_source')).toBe(0);
    events.emit(FUSION_EVENTS.fcp('cpl'));
    expect(fcp.coupledSide).toBe(2);
    expect(vars.get('ap.nav_source')).toBe(2);
  });

  it('APPR with an FMS source and an ILS in the plan: nav-to-nav transfer to the LOC, then ap.apr', () => {
    const { vars, events, log } = setup({ freqMhz: 110.3, courseMag: 35, ident: 'IBOS' });
    vars.set(FUSION_VARS.navSource(1), NavSrc.Fms);
    events.emit(FUSION_EVENTS.fcp('appr'));
    expect(vars.get(NAV.activeFreq(1))).toBeCloseTo(110.3, 6);
    expect(vars.get(NAV.obs(1))).toBe(35);
    expect(vars.get(AP.selCourse(1))).toBe(35);
    expect(vars.get(FUSION_VARS.navSource(1))).toBe(NavSrc.Nav1);
    expect(vars.get('ap.nav_source')).toBe(1); // the AFCS flies the localizer, not the FMS path
    const i = log.findIndex((e) => e.name === 'ap.apr');
    expect(i).toBeGreaterThanOrEqual(0);
  });

  it('EDM: descent to 15,000 ft with a 90 deg left turn, AP / AT engaged, ends at the level-off', () => {
    const { vars, events, fcp, log } = setup();
    vars.set(ADC.baroAlt(1), 41000);
    vars.set(ADC.heading(1), 100);
    events.emit(FUSION_EVENTS.fcp('edm'));
    expect(vars.get(FUSION_VARS.edm)).toBe(1);
    expect(vars.get(AP.selAltitude)).toBe(EDM_ALT_FT);
    expect(vars.get(AP.selHeading)).toBe(10);
    expect(vars.get(AP.selSpeed)).toBe(330);
    const names = log.map((e) => e.name);
    expect(names).toContain('ap.ap');
    expect(names).toContain('at.engage');
    expect(names).toContain('ap.flc');
    vars.set(AP.engaged, 1);
    vars.setString(AP.verticalActive, 'ALT');
    fcp.update(0.1);
    expect(vars.get(FUSION_VARS.edm)).toBe(0);
    // Not available below the EDM altitude.
    vars.set(ADC.baroAlt(1), 12000);
    events.emit(FUSION_EVENTS.fcp('edm'));
    expect(vars.get(FUSION_VARS.edm)).toBe(0);
  });

  it('unpowered FCP ignores inputs', () => {
    const vars = new SimVars();
    const events = new EventBus();
    new FcpLogic(vars, events, { sensors: DEFAULT_SENSORS, events: DEFAULT_EVENTS, airframe: GLOBAL6000_AIRFRAME, powered: () => false });
    const log = recordEvents(events);
    events.emit(FUSION_EVENTS.fcp('ap'));
    expect(log.some((e) => e.name === 'ap.ap')).toBe(false);
  });
});
