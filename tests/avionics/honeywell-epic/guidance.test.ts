import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { ADC, AP, NAV } from '../../../src/core/vars';
import { AFCS_VARS } from '../../../src/systems/autopilot/vars';
import { VERTICAL_MODES } from '../../../src/systems/autopilot/types';
import { GuidancePanelLogic, GP_CONTROLS } from '../../../src/avionics/honeywell-epic/logic/guidance';
import { DEFAULT_EVENTS, DEFAULT_SENSORS } from '../../../src/avionics/honeywell-epic/config';
import { EPIC_EVENTS, EPIC_VARS, NavSrc } from '../../../src/avionics/honeywell-epic/vars';
import { recordEvents } from './helpers';

function setup(opts: { approach?: { freqMhz: number; courseMag: number } | null; powered?: boolean } = {}) {
  const vars = new SimVars();
  const events = new EventBus();
  let powered = opts.powered ?? true;
  const gp = new GuidancePanelLogic(vars, events, {
    sensors: DEFAULT_SENSORS,
    events: DEFAULT_EVENTS,
    powered: () => powered,
    approachInfo: () => opts.approach ?? null,
  });
  const log = recordEvents(events);
  return { vars, events, gp, log, setPowered: (p: boolean) => (powered = p) };
}

const emitted = (log: { name: string }[], name: string): boolean => log.some((e) => e.name === name);

describe('Guidance panel event map', () => {
  it('maps every mode key to its AFCS / autothrottle event', () => {
    const map: Record<string, string> = {
      fd1: 'ap.fd1',
      fd2: 'ap.fd2',
      ap: 'ap.ap',
      yd: 'ap.yd',
      hdg_btn: 'ap.hdg',
      hdg_push: 'ap.hdg_sync',
      nav: 'ap.nav',
      apr: 'ap.apr',
      bc: 'ap.bc',
      lowbank: 'ap.half_bank',
      flch: 'ap.flc',
      vs_btn: 'ap.vs',
      fpa: 'ap.fpa',
      vnav: 'ap.vnav',
      alt_btn: 'ap.alt',
      at: 'at.engage',
    };
    for (const [ctl, ev] of Object.entries(map)) {
      const t = setup();
      t.events.emit(EPIC_EVENTS.gp(ctl));
      expect(emitted(t.log, ev), `${ctl} -> ${ev}`).toBe(true);
    }
  });

  it('every control of GP_CONTROLS is handled without throwing', () => {
    const t = setup();
    for (const id of Object.keys(GP_CONTROLS)) {
      if (GP_CONTROLS[id as keyof typeof GP_CONTROLS] === 'knob') {
        t.events.emit(EPIC_EVENTS.gp(`${id}_inc`), 1);
        t.events.emit(EPIC_EVENTS.gp(`${id}_dec`), 1);
      } else t.events.emit(EPIC_EVENTS.gp(id));
    }
    t.gp.update(0.1);
  });

  it('knobs change the selected targets', () => {
    const t = setup();
    t.vars.set(AP.selHeading, 90);
    t.events.emit(EPIC_EVENTS.gp('hdg_inc'), 5);
    expect(t.vars.get(AP.selHeading)).toBe(95);
    t.events.emit(EPIC_EVENTS.gp('hdg_dec'), 100);
    expect(t.vars.get(AP.selHeading)).toBe(355);
    t.vars.set(AP.selAltitude, 10000);
    t.events.emit(EPIC_EVENTS.gp('alt_inc'), 2);
    expect(t.vars.get(AP.selAltitude)).toBe(12000);
    t.events.emit(EPIC_EVENTS.gp('alt_fine_dec'), 3);
    expect(t.vars.get(AP.selAltitude)).toBe(11700);
    t.vars.set(AP.selSpeed, 250);
    t.events.emit(EPIC_EVENTS.gp('spd_inc'), 1);
    expect(t.vars.get(AP.selSpeed)).toBe(251);
    // IAS / MACH toggle then Mach steps of 0.01.
    t.vars.set(AP.selMach, 0.8);
    t.events.emit(EPIC_EVENTS.gp('spd_push'));
    const mach = t.vars.get(AP.speedIsMach) !== 0;
    t.events.emit(EPIC_EVENTS.gp('spd_inc'), 1);
    if (mach) expect(t.vars.get(AP.selMach)).toBeCloseTo(0.81, 5);
    // Course 1 sets the on-side receiver OBS and the selected course.
    t.vars.set(NAV.obs(1), 100);
    t.events.emit(EPIC_EVENTS.gp('crs1_inc'), 2);
    expect(t.vars.get(NAV.obs(1))).toBe(102);
    // Baro knob in inHg, push = STD.
    t.vars.set(ADC.baroSetting(1), 29.92);
    t.events.emit(EPIC_EVENTS.gp('baro1_inc'), 3);
    expect(t.vars.get(ADC.baroSetting(1))).toBeCloseTo(29.95, 3);
    t.events.emit(EPIC_EVENTS.gp('baro1_push'));
    expect(t.vars.get(ADC.baroStd(1))).toBe(1);
  });

  it('the VS wheel sends AFCS up/dn steps in VS mode only', () => {
    const t = setup();
    t.vars.set(AFCS_VARS.vertCode, VERTICAL_MODES.indexOf('ALT'));
    t.events.emit(EPIC_EVENTS.gp('vs_inc'), 2);
    expect(emitted(t.log, 'ap.up')).toBe(false);
    t.vars.set(AFCS_VARS.vertCode, VERTICAL_MODES.indexOf('VS'));
    t.events.emit(EPIC_EVENTS.gp('vs_inc'), 2);
    const e = t.log.find((q) => q.name === 'ap.up');
    expect(e?.payload).toEqual({ steps: 2 });
  });

  it('APR with an ILS loaded in the FMS switches the coupled NAV SRC to the on-side NAV receiver (and the AFCS source)', () => {
    const t = setup({ approach: { freqMhz: 109.9, courseMag: 13.4 } });
    expect(t.vars.get(EPIC_VARS.navSrc(1))).toBe(NavSrc.Fms);
    t.events.emit(EPIC_EVENTS.gp('apr'));
    expect(t.vars.get(EPIC_VARS.navSrc(1))).toBe(NavSrc.Nav1);
    expect(t.vars.get(AFCS_VARS.navSource)).toBe(1);
    expect(t.vars.get(NAV.activeFreq(1))).toBeCloseTo(109.9, 3);
    expect(t.vars.get(NAV.obs(1))).toBe(13);
    expect(emitted(t.log, 'ap.apr')).toBe(true);
  });

  it('APR without an ILS keeps the FMS source (RNAV approach)', () => {
    const t = setup({ approach: null });
    t.events.emit(EPIC_EVENTS.gp('apr'));
    expect(t.vars.get(EPIC_VARS.navSrc(1))).toBe(NavSrc.Fms);
    expect(t.vars.get(AFCS_VARS.navSource)).toBe(0);
  });

  it('PFD CMD swaps the coupled side and the AFCS follows that side NAV SRC', () => {
    const t = setup();
    t.vars.set(EPIC_VARS.navSrc(2), NavSrc.Nav2);
    t.events.emit(EPIC_EVENTS.gp('pfdcmd'));
    expect(t.vars.get(EPIC_VARS.coupleSide)).toBe(2);
    expect(t.vars.get(AFCS_VARS.navSource)).toBe(2);
    // A NAV SRC change on the coupled side is followed continuously.
    t.vars.set(EPIC_VARS.navSrc(2), NavSrc.Fms);
    t.gp.update(0.05);
    expect(t.vars.get(AFCS_VARS.navSource)).toBe(0);
  });

  it('VNAV needs the FMS as the coupled navigation source', () => {
    const t = setup();
    t.vars.set(EPIC_VARS.navSrc(1), NavSrc.Nav1);
    t.events.emit(EPIC_EVENTS.gp('vnav'));
    expect(emitted(t.log, 'ap.vnav')).toBe(false);
    t.vars.set(EPIC_VARS.navSrc(1), NavSrc.Fms);
    t.events.emit(EPIC_EVENTS.gp('vnav'));
    expect(emitted(t.log, 'ap.vnav')).toBe(true);
  });

  it('auto-tunes / previews the ILS within 75 nm along the plan and 30 nm direct', () => {
    const t = setup({ approach: { freqMhz: 110.3, courseMag: 222 } });
    t.vars.set('fms.dist_to_dest_nm', 120);
    t.vars.set(EPIC_VARS.destDirectNm, 100);
    t.gp.update(1.1);
    expect(t.vars.get(EPIC_VARS.preview(1))).toBe(0);
    t.vars.set('fms.dist_to_dest_nm', 60);
    t.vars.set(EPIC_VARS.destDirectNm, 25);
    t.gp.update(1.1);
    expect(t.vars.get(EPIC_VARS.preview(1))).toBe(1);
    expect(t.vars.get(NAV.activeFreq(1))).toBeCloseTo(110.3, 3);
    expect(t.vars.get(NAV.activeFreq(2))).toBeCloseTo(110.3, 3);
  });

  it('shows the window texts and blanks them when unpowered (keys dead)', () => {
    const t = setup();
    t.vars.set(AP.selHeading, 5);
    t.vars.set(AP.selAltitude, 41000);
    t.gp.update(0.05);
    expect(t.gp.windows.heading).toBe('005');
    expect(t.gp.windows.altitude).toBe('41000');
    t.setPowered(false);
    t.gp.update(0.05);
    expect(t.gp.windows.heading).toBe('');
    t.log.length = 0;
    t.events.emit(EPIC_EVENTS.gp('ap'));
    expect(emitted(t.log, 'ap.ap')).toBe(false);
  });
});
