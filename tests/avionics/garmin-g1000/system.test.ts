import { beforeAll, describe, expect, it } from 'vitest';
import { ADC, AP, NAV } from '../../../src/core/vars';
import type { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { G1K, G1K_EVENTS, CDI_SOURCE, BRG_SOURCE, PFD_MAP, vn } from '../../../src/avionics/garmin-g1000/vars';
import { SOFTKEY_REVERT_S } from '../../../src/avionics/garmin-g1000/state/softkeys';
import { g1000Controls } from '../../../src/avionics/garmin-g1000/controls';
import { resolveConfig } from '../../../src/avionics/garmin-g1000/config';
import { C172S_NXI } from '../../../src/avionics/garmin-g1000/presets';
import { EisRenderer } from '../../../src/avionics/garmin-g1000/gdu/Eis';
import { loadDb, makeRig, pressSoftkey, softkeyLabels } from './helpers';

let db: NavDatabaseImpl;
beforeAll(async () => {
  db = await loadDb();
}, 90000);

describe('power, boot and reversionary mode', () => {
  it('units boot after power-up; the MFD power-on page needs ENT', () => {
    const rig = makeRig(db, { power: { pfd: 'elec.ess', mfd: 'elec.avn2', gia1: 'elec.ess', gia2: 'elec.avn2', gea: 'elec.ess' }, bootS: { gdu: 10 } });
    const { vars } = rig;
    const sys = rig.suite.system;
    rig.place(40.78, -73.87, 20, 40, 0);
    rig.step(0.5);
    expect(vars.get('display.pfd.power')).toBe(0);
    vars.set('elec.ess', 1);
    rig.step(2);
    expect(sys.units.booting('pfd')).toBe(true);
    expect(vars.get(G1K.unitBooting('pfd'))).toBe(1);
    rig.step(9);
    expect(sys.units.up('pfd')).toBe(true);
    // Only the PFD is up (avionics bus 2 off): it runs reversionary with the EIS (engine start, PG §1.3).
    expect(sys.isReversionary('pfd')).toBe(true);
    vars.set('elec.avn2', 1);
    rig.step(11);
    expect(sys.units.up('mfd')).toBe(true);
    expect(sys.isReversionary('pfd')).toBe(false);
    expect(vars.get(G1K.mfdSplashAck)).toBe(0);
    rig.key('mfd', 'keyEnt');
    expect(vars.get(G1K.mfdSplashAck)).toBe(1);
    expect(sys.mfd.basePage.id).toBe('map_nav');
  });

  it('DISPLAY BACKUP selects reversionary mode on both displays; a failed display reverts automatically', () => {
    const rig = makeRig(db);
    const sys = rig.suite.system;
    rig.place(40.78, -73.87, 3000, 40);
    sys.units.forceBooted();
    rig.step(0.2);
    expect(sys.isReversionary('pfd')).toBe(false);
    rig.events.emit(G1K_EVENTS.displayBackup);
    rig.step(0.1);
    expect(sys.isReversionary('pfd')).toBe(true);
    expect(sys.isReversionary('mfd')).toBe(true);
    expect(sys.formatOf('mfd')).toBe('pfd');
    rig.events.emit(G1K_EVENTS.displayBackup);
    rig.step(0.1);
    expect(sys.isReversionary('mfd')).toBe(false);
    // PFD failure: MFD reversionary, NAV1 / COM1 (IAU 1 wired to the PFD) flagged invalid.
    rig.vars.set('fail.g1k.pfd', 1);
    rig.step(0.2);
    expect(sys.isReversionary('mfd')).toBe(true);
    expect(rig.vars.get(vn(G1K.navValid, 1))).toBe(0);
    expect(rig.vars.get(vn(G1K.comValid, 1))).toBe(0);
    expect(rig.vars.get(vn(G1K.navValid, 2))).toBe(1);
    // Tuning the flagged radio is refused.
    const before = rig.vars.get(vn(NAV.comStandby, 1));
    rig.turn(G1K_EVENTS.comOuter('mfd'), 1);
    expect(rig.vars.get(vn(NAV.comStandby, 1))).toBe(before);
  });
});

describe('PFD softkeys', () => {
  it('top level follows PG Table 1-3 and XPDR mode / code entry works', () => {
    const rig = makeRig(db);
    const sys = rig.suite.system;
    rig.place(40.78, -73.87, 3000, 40);
    sys.units.forceBooted();
    rig.step(0.1);
    const labels = softkeyLabels(rig, 'pfd');
    expect(labels.slice(1)).toEqual(['Map/HSI', 'TFC Map', 'PFD Opt', 'OBS', 'CDI', '', 'XPDR', 'Ident', 'Tmr/Ref', 'Nearest', 'Alerts']);
    pressSoftkey(rig, 'pfd', 'XPDR');
    expect(softkeyLabels(rig, 'pfd').slice(2, 11)).toEqual(['Standby', 'On', 'ALT', '', 'VFR', 'Code', 'Ident', '', 'Back']);
    pressSoftkey(rig, 'pfd', 'ALT');
    expect(rig.vars.get(NAV.xpdrMode)).toBe(3);
    pressSoftkey(rig, 'pfd', 'Code');
    for (const d of ['4', '5', '6', '7']) pressSoftkey(rig, 'pfd', d);
    expect(sys.xpdr.displayCode()).toBe('4567');
    rig.step(5.2);
    expect(rig.vars.get(NAV.xpdrCode)).toBe(4567);
    // Back at the XPDR level once the code is active.
    expect(sys.pfdKeys.pfd.level).toBe('xpdr');
    pressSoftkey(rig, 'pfd', 'VFR');
    expect(rig.vars.get(NAV.xpdrCode)).toBe(1200);
    pressSoftkey(rig, 'pfd', 'VFR');
    expect(rig.vars.get(NAV.xpdrCode)).toBe(4567);
    pressSoftkey(rig, 'pfd', 'Ident');
    expect(rig.vars.get(NAV.xpdrIdent)).toBe(1);
    rig.step(18.5);
    expect(rig.vars.get(NAV.xpdrIdent)).toBe(0);
    // Sub-levels revert to the previous level after 45 s (PG §1.4).
    rig.step(SOFTKEY_REVERT_S + 1);
    expect(sys.pfdKeys.pfd.level).toBe('top');
  });

  it('FMS knob code entry: pairs of digits, ENT activates', () => {
    const rig = makeRig(db);
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.step(0.1);
    pressSoftkey(rig, 'pfd', 'XPDR');
    pressSoftkey(rig, 'pfd', 'Code');
    // 1200 -> 12 +1 -> 13 ; next pair 00 +5 -> 05.
    rig.turn(G1K_EVENTS.fmsInner('pfd'), 1);
    rig.turn(G1K_EVENTS.fmsOuter('pfd'), 1);
    rig.turn(G1K_EVENTS.fmsInner('pfd'), 5);
    rig.key('pfd', 'keyEnt');
    expect(rig.vars.get(NAV.xpdrCode)).toBe(1305);
  });

  it('CDI cycles GPS -> NAV1 -> NAV2 -> GPS and moves the NAV tuning box; bearing pointers cycle', () => {
    const rig = makeRig(db);
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.step(0.1);
    pressSoftkey(rig, 'pfd', 'CDI');
    expect(sys.cdiSource).toBe(CDI_SOURCE.nav1);
    pressSoftkey(rig, 'pfd', 'CDI');
    expect(sys.cdiSource).toBe(CDI_SOURCE.nav2);
    expect(rig.vars.get(G1K.navTuneBox)).toBe(2);
    rig.step(0.1);
    expect(rig.vars.get('ap.nav_source')).toBe(2);
    pressSoftkey(rig, 'pfd', 'CDI');
    expect(sys.cdiSource).toBe(CDI_SOURCE.gps);
    pressSoftkey(rig, 'pfd', 'PFD Opt');
    pressSoftkey(rig, 'pfd', 'Bearing 1');
    expect(rig.vars.get(G1K.brg1Source)).toBe(BRG_SOURCE.nav1);
    pressSoftkey(rig, 'pfd', 'Bearing 1');
    pressSoftkey(rig, 'pfd', 'Bearing 1');
    expect(rig.vars.get(G1K.brg1Source)).toBe(BRG_SOURCE.gps);
    pressSoftkey(rig, 'pfd', 'Bearing 1');
    expect(rig.vars.get(G1K.brg1Source)).toBe(BRG_SOURCE.off);
    // STD Baro sets 29.92 and STD.
    rig.vars.set(ADC.baroSetting(1), 30.12);
    pressSoftkey(rig, 'pfd', 'STD Baro');
    expect(rig.vars.get(ADC.baroSetting(1))).toBeCloseTo(29.92, 2);
    expect(rig.vars.get(ADC.baroStd(1))).toBe(1);
    pressSoftkey(rig, 'pfd', 'Back');
    pressSoftkey(rig, 'pfd', 'Map/HSI');
    pressSoftkey(rig, 'pfd', 'Layout');
    pressSoftkey(rig, 'pfd', 'Inset Map');
    expect(rig.vars.get(G1K.pfdMap)).toBe(PFD_MAP.inset);
  });
});

describe('bezel knobs and radios', () => {
  it('NAV / COM tuning, transfer, EMERG hold, volume readout', () => {
    const rig = makeRig(db);
    const { vars } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.step(0.1);
    vars.set(vn(NAV.comActive, 1), 118.1);
    vars.set(vn(NAV.comStandby, 1), 121.5);
    rig.turn(G1K_EVENTS.comOuter('pfd'), 2);
    rig.turn(G1K_EVENTS.comInner('pfd'), 3);
    expect(vars.get(vn(NAV.comStandby, 1))).toBeCloseTo(123.575, 3);
    rig.key('pfd', 'comXfer');
    rig.key('pfd', 'comXferUp');
    expect(vars.get(vn(NAV.comActive, 1))).toBeCloseTo(123.575, 3);
    expect(vars.get(vn(NAV.comStandby, 1))).toBeCloseTo(118.1, 3);
    // Hold 2 s: 121.500 (PG §1.2 EMERG).
    rig.key('mfd', 'comXfer');
    rig.step(2.2);
    rig.key('mfd', 'comXferUp');
    expect(vars.get(vn(NAV.comActive, 1))).toBeCloseTo(121.5, 3);
    // COM knob push moves the tuning box to COM2.
    rig.key('pfd', 'comPush');
    expect(vars.get(G1K.comTuneBox)).toBe(2);
    rig.turn(G1K_EVENTS.navInner('pfd'), 1);
    expect(vars.get(vn(NAV.standbyFreq, 1))).toBeCloseTo(113.05, 2);
    rig.turn(G1K_EVENTS.navVol('pfd'), 2);
    expect(vars.get(G1K.navVolShowS)).toBeGreaterThan(1.5);
    rig.step(2.1);
    expect(vars.get(G1K.navVolShowS)).toBe(0);
  });

  it('HDG knob, HDG SYNC, ALT knob 1000 / 100 ft with the minimums stop, CRS / baro', () => {
    const rig = makeRig(db);
    const { vars } = rig;
    const sys = rig.suite.system;
    rig.place(40.78, -73.87, 3000, 47);
    sys.units.forceBooted();
    rig.step(0.1);
    vars.set(AP.selHeading, 360);
    rig.turn(G1K_EVENTS.hdg('pfd'), 5);
    expect(vars.get(AP.selHeading)).toBe(5);
    rig.key('pfd', 'hdgPush');
    expect(vars.get(AP.selHeading)).toBe(47);
    vars.set(AP.selAltitude, 3000);
    rig.turn(G1K_EVENTS.altOuter('pfd'), 1);
    rig.turn(G1K_EVENTS.altInner('pfd'), -3);
    expect(vars.get(AP.selAltitude)).toBe(3700);
    sys.refs.mins.setMode(1);
    sys.refs.mins.setValue(3550);
    rig.turn(G1K_EVENTS.altInner('pfd'), -2);
    expect(vars.get(AP.selAltitude)).toBe(3550);
    // CRS knob sets the NAV1 course with NAV1 on the CDI.
    sys.setCdiSource(CDI_SOURCE.nav1);
    vars.set(vn(NAV.obs, 1), 90);
    rig.turn(G1K_EVENTS.crs('pfd'), 10);
    expect(vars.get(vn(NAV.obs, 1))).toBe(100);
    vars.set(ADC.baroSetting(1), 29.92);
    rig.turn(G1K_EVENTS.baro('pfd'), 5);
    expect(vars.get(ADC.baroSetting(1))).toBeCloseTo(29.97, 2);
  });
});

describe('GMA 1360 audio panel', () => {
  it('MIC selection, split COM, SPKR/PA hold, marker mute states, HI SENS, TEL cycle', () => {
    // No marker receiver: the test drives the marker vars directly.
    const rig = makeRig(db, { radiosOptions: { marker: false } });
    const { vars, events } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.step(3); // self test
    const gma = sys.gma;
    expect(gma.up).toBe(true);
    events.emit(G1K_EVENTS.gmaKey('com2_mic'));
    expect(vars.get(G1K.gmaMic)).toBe(2);
    expect(vars.get(G1K.gmaSel('com2'))).toBe(1);
    // Simultaneous COM1 MIC + COM2 MIC = split COM.
    rig.step(1);
    events.emit(G1K_EVENTS.gmaKey('com1_mic'));
    events.emit(G1K_EVENTS.gmaKey('com2_mic'));
    expect(vars.get(G1K.gmaSplitCom)).toBe(1);
    rig.step(1);
    events.emit(G1K_EVENTS.gmaKey('com1_mic'));
    expect(vars.get(G1K.gmaSplitCom)).toBe(0);
    expect(vars.get(G1K.gmaMic)).toBe(1);
    // SPKR/PA: press toggles the speaker, holding 2 s selects PA (no COM transmit).
    events.emit(G1K_EVENTS.gmaKey('spkr'));
    expect(vars.get(G1K.gmaSpeaker)).toBe(1);
    events.emit(G1K_EVENTS.gmaKeyUp('spkr'));
    events.emit(G1K_EVENTS.gmaKey('spkr'));
    rig.step(2.2);
    events.emit(G1K_EVENTS.gmaKeyUp('spkr'));
    expect(vars.get(G1K.gmaPa)).toBe(1);
    expect(vars.get(G1K.gmaSpeaker)).toBe(1);
    expect(gma.mic).toBe(0);
    // Marker: on -> muted while receiving the outer marker -> back on at the next marker.
    vars.set(NAV.markerOuter, 1);
    rig.step(0.1);
    expect(rig.audio.tones.get('marker_outer')).toBe(true);
    events.emit(G1K_EVENTS.gmaKey('mkr'));
    rig.step(0.1);
    expect(vars.get(G1K.gmaMkr)).toBe(2);
    expect(rig.audio.tones.get('marker_outer')).toBe(false);
    vars.set(NAV.markerOuter, 0);
    rig.step(0.1);
    vars.set(NAV.markerMiddle, 1);
    rig.step(0.1);
    expect(vars.get(G1K.gmaMkr)).toBe(1);
    expect(rig.audio.tones.get('marker_middle')).toBe(true);
    events.emit(G1K_EVENTS.gmaKey('hi_sens'));
    expect(vars.get(NAV.markerHiSens)).toBe(1);
    events.emit(G1K_EVENTS.gmaKey('tel'));
    events.emit(G1K_EVENTS.gmaKey('tel'));
    expect(vars.get(G1K.gmaSel('tel'))).toBe(2);
    events.emit(G1K_EVENTS.gmaKey('mus1'));
    events.emit(G1K_EVENTS.gmaKey('mus1'));
    // Only one source may be Bluetooth: MUS1 goes OFF -> WHITE -> OFF.
    expect(vars.get(G1K.gmaSel('mus1'))).toBe(0);
    rig.step(0.1);
    expect(vars.get(G1K.gmaLight('tel'))).toBe(2);
  });

  it('DISPLAY BACKUP light follows the latch; fail-safe keeps COM1 transmit when the GMA is off', () => {
    const rig = makeRig(db, { power: { gma: 'elec.audio' } });
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.vars.set('elec.audio', 0);
    rig.step(0.2);
    rig.events.emit(G1K_EVENTS.ptt, { pressed: true });
    rig.step(0.1);
    expect(rig.vars.get(G1K.comTx(1))).toBe(1);
  });
});

describe('CAS, Alerts softkey and messages', () => {
  it('power-up messages are acknowledged; a new warning flashes Warning with a repeating chime until acknowledged', () => {
    const rig = makeRig(db);
    const { vars } = rig;
    const sys = rig.suite.system;
    vars.set('ac.c172.ann.low_volts', 1);
    sys.units.forceBooted();
    rig.step(0.2);
    expect(sys.alerts.cas.isActive('low_volts')).toBe(true);
    expect(vars.get(G1K.alertsKey)).toBe(0);
    vars.set('ac.c172.ann.oil_press', 1);
    rig.step(0.2);
    expect(vars.get(G1K.alertsKey)).toBe(4);
    expect(rig.audio.tones.get('master_warning')).toBe(true);
    expect(softkeyLabels(rig, 'pfd')[11]).toBe('Warning');
    pressSoftkey(rig, 'pfd', 'Warning');
    rig.step(0.1);
    expect(rig.audio.tones.get('master_warning')).toBe(false);
    expect(vars.get(G1K.alertsKey)).toBe(0);
    // Caution: single chime, Caution key.
    vars.set('ac.c172.ann.low_vacuum', 1);
    rig.step(0.2);
    expect(rig.audio.played).toContain('master_caution');
    expect(softkeyLabels(rig, 'pfd')[11]).toBe('Caution');
    // ESP disabled -> ESP OFF advisory.
    sys.esp!.setEnabled(false);
    pressSoftkey(rig, 'pfd', 'Caution');
    rig.step(0.2);
    expect(sys.alerts.cas.isActive('esp_off')).toBe(true);
    expect(softkeyLabels(rig, 'pfd')[11]).toBe('Advisory');
  });

  it('timer expiry raises TIMER EXPIRD: Message softkey opens the Alerts window', () => {
    const rig = makeRig(db);
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.step(0.1);
    sys.refs.timer.setDirection(true);
    sys.refs.timer.setPreset(3);
    sys.refs.timer.start();
    rig.step(4);
    expect(softkeyLabels(rig, 'pfd')[11]).toBe('Message');
    pressSoftkey(rig, 'pfd', 'Message');
    expect(sys.pfdWindowId).toBe('alerts');
    expect(sys.alerts.messages.list[0].text).toContain('TIMER EXPIRD');
    expect(softkeyLabels(rig, 'pfd')[11]).toBe('Alerts');
  });
});

describe('fuel totalizer and EIS', () => {
  it('GAL USED integrates fuel flow; RST Fuel, GAL REM keys; engine hours with oil pressure', () => {
    const rig = makeRig(db);
    const { vars } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    vars.set('eng1.ff_gph', 9);
    vars.set('eng1.oil_press_psi', 60);
    rig.step(60, 0.1);
    expect(vars.get(G1K.fuelUsedGal)).toBeCloseTo(0.15, 2);
    expect(vars.get(G1K.fuelRemGal)).toBeCloseTo(52.85, 2);
    expect(vars.get(G1K.engineHours)).toBeCloseTo(60 / 3600, 4);
    // MFD softkeys: Engine > System > GAL REM > -10 GAL, 35 GAL; RST Fuel.
    rig.key('mfd', 'keyEnt');
    pressSoftkey(rig, 'mfd', 'Engine');
    pressSoftkey(rig, 'mfd', 'System');
    expect(vars.get(G1K.eisPage)).toBe(2);
    pressSoftkey(rig, 'mfd', 'GAL REM');
    pressSoftkey(rig, 'mfd', '-10 GAL');
    expect(vars.get(G1K.fuelRemGal)).toBeCloseTo(42.85, 2);
    pressSoftkey(rig, 'mfd', '35 GAL');
    expect(vars.get(G1K.fuelRemGal)).toBe(35);
    pressSoftkey(rig, 'mfd', 'Back');
    pressSoftkey(rig, 'mfd', 'RST Fuel');
    expect(vars.get(G1K.fuelRemGal)).toBe(53);
    expect(vars.get(G1K.fuelUsedGal)).toBe(0);
    expect(vars.get(G1K.fuelRemKg)).toBeGreaterThan(0);
  });

  it('an RPM exceedance returns the EIS to the ENGINE page', () => {
    const rig = makeRig(db);
    const { vars } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.step(0.1);
    const eis = new EisRenderer(sys);
    vars.set('eng1.oil_press_psi', 60);
    vars.set('eng1.oil_temp_f', 180);
    vars.set(G1K.eisPage, 1);
    vars.set('eng1.rpm', 2400);
    eis.update(0.1);
    expect(vars.get(G1K.eisPage)).toBe(1);
    vars.set('eng1.rpm', 2800);
    eis.update(0.1);
    expect(vars.get(G1K.eisPage)).toBe(0);
  });
});

describe('MFD pages', () => {
  it('FMS knob page groups, FPL key toggle, CLR hold -> navigation map, checklist overlay, System Setup', () => {
    const rig = makeRig(db, { checklists: [{ title: 'Before Start', phase: 'Normal', items: [{ challenge: 'Brakes', response: 'SET' }] }, { title: 'Engine Fire', phase: 'Emergency', items: [{ challenge: 'Mixture', response: 'IDLE CUTOFF' }] }] });
    const { vars } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.step(0.1);
    rig.key('mfd', 'keyEnt');
    rig.turn(G1K_EVENTS.fmsOuter('mfd'), 2);
    expect(sys.mfd.groups[sys.mfd.group].id).toBe('AUX');
    expect(sys.mfd.groupWindowS).toBeGreaterThan(0);
    rig.turn(G1K_EVENTS.fmsInner('mfd'), 3);
    expect(sys.mfd.basePage.id).toBe('aux_setup');
    rig.step(4);
    expect(sys.mfd.groupWindowS).toBe(0);
    // System Setup 1: COM channel spacing -> 8.33 kHz with the cursor.
    rig.key('mfd', 'fmsPush');
    const f = sys.mfd.setup.form;
    f.activate('com_spacing');
    rig.turn(G1K_EVENTS.fmsInner('mfd'), 1);
    rig.key('mfd', 'keyEnt');
    expect(vars.get(G1K.comSpacing833)).toBe(1);
    // Setup 2: ESP disabled.
    pressSoftkey(rig, 'mfd', 'Setup 2');
    sys.mfd.setup.form.activate('esp');
    rig.turn(G1K_EVENTS.fmsInner('mfd'), 1);
    rig.key('mfd', 'keyEnt');
    expect(vars.get(G1K.espEnabled)).toBe(0);
    rig.key('mfd', 'fmsPush');
    rig.key('mfd', 'keyFpl');
    expect(sys.mfd.basePage.id).toBe('fpl');
    rig.key('mfd', 'keyFpl');
    expect(sys.mfd.basePage.id).toBe('aux_setup');
    rig.key('mfd', 'keyClr');
    rig.step(2.2);
    rig.key('mfd', 'keyClrUp');
    expect(sys.mfd.basePage.id).toBe('map_nav');
    pressSoftkey(rig, 'mfd', 'Checklist');
    expect(sys.mfd.overlay).toBe('checklist');
    rig.key('mfd', 'keyEnt');
    expect(sys.checklists.isChecked(0)).toBe(true);
    pressSoftkey(rig, 'mfd', 'EMER');
    expect(sys.checklists.current?.title).toBe('Engine Fire');
    pressSoftkey(rig, 'mfd', 'Exit');
    expect(sys.mfd.overlay).toBe('none');
  });
});

describe('PFD windows', () => {
  it('Timer/References: V-speed bug on and BARO minimums with the FMS knob', () => {
    const rig = makeRig(db);
    const { vars } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.step(0.1);
    pressSoftkey(rig, 'pfd', 'Tmr/Ref');
    expect(sys.pfdWindowId).toBe('tmrref');
    const f = sys.pfdPages.tmrref.form;
    f.activate('on_VY');
    rig.turn(G1K_EVENTS.fmsInner('pfd'), 1);
    rig.key('pfd', 'keyEnt');
    expect(sys.refs.vspeeds.on('VY')).toBe(true);
    f.activate('mins');
    rig.turn(G1K_EVENTS.fmsInner('pfd'), 1);
    rig.key('pfd', 'keyEnt');
    f.activate('minsft');
    rig.turn(G1K_EVENTS.fmsOuter('pfd'), 0);
    rig.turn(G1K_EVENTS.fmsInner('pfd'), 5);
    rig.key('pfd', 'keyEnt');
    expect(vars.get(vn(AP.minimums, 1))).toBe(250);
    rig.key('pfd', 'keyClr');
    rig.key('pfd', 'keyClr');
    expect(sys.pfdWindowId).toBe(null);
  });

  it('Nearest Airports: ENT on a frequency loads the COM standby', () => {
    const rig = makeRig(db);
    const { vars } = rig;
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.place(40.78, -73.87, 2000, 40);
    rig.step(0.2);
    pressSoftkey(rig, 'pfd', 'Nearest');
    const page = sys.pfdPages.nearest as import('../../../src/avionics/garmin-g1000/state/pages').NearestAirportsPage;
    expect(page.list.length).toBeGreaterThan(3);
    const k = page.list.findIndex((a) => a.com);
    page.form.row = k * 2 + 1;
    rig.key('pfd', 'keyEnt');
    expect(vars.get(vn(NAV.comStandby, 1))).toBeCloseTo(page.list[k].com!.mhz, 3);
  });

  it('Direct-to by identifier with the FMS knob; the flight plan window inserts a waypoint', () => {
    const rig = makeRig(db);
    const sys = rig.suite.system;
    sys.units.forceBooted();
    rig.place(40.78, -73.87, 3000, 40);
    rig.step(0.5);
    rig.key('pfd', 'keyDirect');
    expect(sys.pfdWindowId).toBe('dto');
    const dto = sys.pfdPages.dto as import('../../../src/avionics/garmin-g1000/state/pages').DirectToPage;
    dto.form.activate('ident');
    // Enter 'KHPN' letter by letter: small knob picks the character, large knob moves right.
    const typeIdent = (s: string): void => {
      for (let i = 0; i < s.length; i++) {
        const target = s.charCodeAt(i);
        const cur = dto.form.editing ? dto.form.text.charCodeAt(dto.form.textPos) : NaN;
        const base = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const from = Number.isNaN(cur) || dto.form.text.length <= dto.form.textPos ? -1 : base.indexOf(String.fromCharCode(cur));
        rig.turn(G1K_EVENTS.fmsInner('pfd'), base.indexOf(String.fromCharCode(target)) - from);
        if (i < s.length - 1) rig.turn(G1K_EVENTS.fmsOuter('pfd'), 1);
      }
    };
    typeIdent('KHPN');
    rig.key('pfd', 'keyEnt');
    expect(dto.ident).toBe('KHPN');
    expect(dto.form.field?.id).toBe('crs');
    rig.key('pfd', 'keyEnt');
    rig.key('pfd', 'keyEnt');
    rig.step(1.5);
    expect(rig.vars.getString('fms.next_wpt')).toBe('KHPN');
    expect(sys.pfdWindowId).toBe(null);
    // FPL window: small knob on the empty row starts an entry that appends.
    rig.key('pfd', 'keyFpl');
    const fpl = sys.pfdPages.fpl as import('../../../src/avionics/garmin-g1000/state/pages').FplPage;
    fpl.form.row = fpl.rows.length;
    rig.turn(G1K_EVENTS.fmsInner('pfd'), 11); // 'K'
    expect(fpl.inserting).toBe(fpl.rows.length);
    expect(fpl.insertText).toBe('K');
  });
});

describe('controls map', () => {
  it('lists both GDU 1054B bezels with AFCS keys and the GMA 1360', () => {
    const c = g1000Controls(resolveConfig(C172S_NXI));
    const ids = new Set(c.map((x) => x.id));
    for (const g of ['pfd', 'mfd']) {
      for (const k of ['nav', 'com', 'hdg', 'alt', 'crs_baro', 'range', 'fms', 'key.dto', 'key.menu', 'key.fpl', 'key.proc', 'key.clr', 'key.ent', 'afcs.ap', 'afcs.fd', 'afcs.vnv', 'afcs.nose_up', 'sk12']) expect(ids.has(`${g}.${k}`)).toBe(true);
    }
    expect(ids.has('gma.display_backup')).toBe(true);
    expect(ids.has('gma.mkr')).toBe(true);
    expect(c.find((x) => x.id === 'pfd.afcs.hdg')?.press).toBe('g1k.pfd.key_hdg');
  });
});
