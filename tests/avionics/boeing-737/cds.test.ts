import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { ADC } from '../../../src/core/vars';
import { resolveB737Config } from '../../../src/avionics/boeing-737/config';
import { CdsLogic } from '../../../src/avionics/boeing-737/cds/CdsLogic';
import { EfisPanels } from '../../../src/avionics/boeing-737/cds/EfisPanels';
import { B737_EVENTS, B737_VARS, DU_DISPLAY_VARS, DuFormat, LowerDuSel, MainPanelDuSel, MfdFormat, ND_RANGES_NM, type DuId } from '../../../src/avionics/boeing-737/vars';

function setup(cfg = {}) {
  const vars = new SimVars();
  const events = new EventBus();
  const rc = resolveB737Config(cfg);
  const cds = new CdsLogic({ vars, events }, rc);
  const efis = new EfisPanels({ vars, events }, rc.adiru);
  vars.set('gear.air_ground', 1);
  const step = (n = 3) => {
    for (let i = 0; i < n; i++) {
      efis.update(1 / 60);
      cds.update(1 / 60);
    }
  };
  // Past the power-up automatic secondary display: cancel it like the state presets do.
  step();
  cds.applyState('ready_to_taxi');
  step();
  const fmt = (du: DuId) => vars.get(B737_VARS.duFormat(du)) as DuFormat;
  const side = (du: DuId) => vars.get(B737_VARS.duSide(du));
  return { vars, events, cds, efis, step, fmt, side };
}

describe('737NG CDS display routing', () => {
  it('NORM: PFD outboard, ND inboard, engines upper, lower blank', () => {
    const t = setup();
    expect(t.fmt('capt_out')).toBe(DuFormat.Pfd);
    expect(t.fmt('capt_in')).toBe(DuFormat.Nd);
    expect(t.fmt('upper')).toBe(DuFormat.EngPrimary);
    expect(t.fmt('lower')).toBe(DuFormat.Blank);
    expect(t.fmt('fo_in')).toBe(DuFormat.Nd);
    expect(t.fmt('fo_out')).toBe(DuFormat.Pfd);
    expect(t.side('fo_out')).toBe(2);
  });

  it('first power-up shows the secondary engine display automatically (FCOM 7.10)', () => {
    const vars = new SimVars();
    const cds = new CdsLogic({ vars }, resolveB737Config({}));
    cds.update(1 / 60);
    expect(vars.get(B737_VARS.duFormat('lower'))).toBe(DuFormat.EngSecondary);
    expect(vars.get(B737_VARS.engSecondaryAuto)).toBe(1);
  });

  it('MFD ENG / SYS toggle the lower DU format', () => {
    const t = setup();
    t.events.emit(B737_EVENTS.mfdSys);
    t.step();
    expect(t.fmt('lower')).toBe(DuFormat.Sys);
    t.events.emit(B737_EVENTS.mfdEng);
    t.step();
    expect(t.fmt('lower')).toBe(DuFormat.EngSecondary);
    t.events.emit(B737_EVENTS.mfdEng);
    t.step();
    expect(t.vars.get(B737_VARS.mfdFormat)).toBe(MfdFormat.None);
    expect(t.fmt('lower')).toBe(DuFormat.Blank);
  });

  it('MAIN PANEL DUs selector positions', () => {
    const t = setup();
    t.vars.set(B737_VARS.mainPanelDus(1), MainPanelDuSel.OutbdPfd);
    t.step();
    expect(t.fmt('capt_out')).toBe(DuFormat.Pfd);
    expect(t.fmt('capt_in')).toBe(DuFormat.Blank);
    t.vars.set(B737_VARS.mainPanelDus(1), MainPanelDuSel.InbdPfd);
    t.step();
    expect(t.fmt('capt_out')).toBe(DuFormat.Blank);
    expect(t.fmt('capt_in')).toBe(DuFormat.Pfd);
    t.vars.set(B737_VARS.mainPanelDus(1), MainPanelDuSel.InbdEngPri);
    t.step();
    expect(t.fmt('capt_in')).toBe(DuFormat.EngPrimary);
    expect(t.fmt('upper')).toBe(DuFormat.Blank);
    t.vars.set(B737_VARS.mainPanelDus(1), MainPanelDuSel.InbdMfd);
    t.events.emit(B737_EVENTS.mfdSys);
    t.step();
    expect(t.fmt('capt_in')).toBe(DuFormat.Sys);
    expect(t.fmt('lower')).toBe(DuFormat.Blank);
  });

  it('LOWER DU selector: ND of the selecting side, or primary engines', () => {
    const t = setup();
    t.vars.set(B737_VARS.lowerDu(2), LowerDuSel.Nd);
    t.step();
    expect(t.fmt('lower')).toBe(DuFormat.Nd);
    expect(t.side('lower')).toBe(2);
    t.vars.set(B737_VARS.lowerDu(2), LowerDuSel.EngPri);
    t.step();
    expect(t.fmt('lower')).toBe(DuFormat.EngPrimary);
    expect(t.fmt('upper')).toBe(DuFormat.Blank);
  });

  it('outboard DU failure moves the PFD inboard; upper DU failure moves engines to the lower DU', () => {
    const t = setup();
    t.vars.set('fail.b737.du_capt_out', 1);
    t.step();
    expect(t.fmt('capt_out')).toBe(DuFormat.Blank);
    expect(t.vars.get(DU_DISPLAY_VARS.power('capt_out'))).toBe(0);
    expect(t.fmt('capt_in')).toBe(DuFormat.Pfd);
    t.vars.set('fail.b737.du_upper', 1);
    t.step();
    expect(t.fmt('lower')).toBe(DuFormat.EngPrimary);
    // Secondary wanted with only one centre DU: compact format.
    t.events.emit(B737_EVENTS.mfdEng);
    t.step();
    expect(t.fmt('lower')).toBe(DuFormat.EngCompact);
  });

  it('DEU failure: other DEU drives all DUs, CDS FAULT on the ground, DSPLY SOURCE in the air', () => {
    const t = setup();
    t.vars.set('fail.b737.deu1', 1);
    t.step();
    expect(t.vars.get(B737_VARS.deuFor('capt_out'))).toBe(2);
    expect(t.fmt('capt_out')).toBe(DuFormat.Pfd);
    expect(t.vars.get(B737_VARS.cdsFault)).toBe(1);
    t.vars.set('gear.air_ground', 0);
    t.step();
    expect(t.vars.get(B737_VARS.cdsFault)).toBe(0);
    expect(t.vars.get(B737_VARS.dsplySource)).toBe(1);
  });

  it('DISPLAYS SOURCE ALL ON 1 and transfer switches', () => {
    const t = setup();
    t.vars.set(B737_VARS.displaysSource, -1);
    t.vars.set(B737_VARS.irsSel, 1);
    t.vars.set(B737_VARS.vhfNavSel, -1);
    t.vars.set(B737_VARS.controlPanelSel, 1);
    t.step();
    expect(t.vars.get(B737_VARS.deuFor('fo_out'))).toBe(1);
    expect(t.vars.get(B737_VARS.dsplySource)).toBe(1);
    expect(t.vars.get(B737_VARS.airDataFor(1))).toBe(2);
    expect(t.vars.get(B737_VARS.navRxFor(2))).toBe(1);
    expect(t.vars.get(B737_VARS.efisSourceFor(1))).toBe(2);
  });

  it('secondary engine exceedance pops the secondary display up', () => {
    const t = setup();
    t.vars.set('eng1.running', 1);
    t.vars.set('eng1.oil_press_psi', 40);
    t.vars.set('eng1.oil_temp_c', 150);
    t.step(90);
    expect(t.vars.get(B737_VARS.engSecondaryAuto)).toBe(1);
    expect(t.fmt('lower')).toBe(DuFormat.EngSecondary);
  });
});

describe('737NG EFIS control panel', () => {
  it('mode / range / map buttons, WXR and TERR exclusive', () => {
    const t = setup();
    t.events.emit(B737_EVENTS.efisMapButton(1, 'terr'));
    expect(t.vars.get(B737_VARS.efisMapButton(1, 'terr'))).toBe(1);
    t.events.emit(B737_EVENTS.efisMapButton(1, 'wxr'));
    expect(t.vars.get(B737_VARS.efisMapButton(1, 'wxr'))).toBe(1);
    expect(t.vars.get(B737_VARS.efisMapButton(1, 'terr'))).toBe(0);
    t.vars.set(B737_VARS.efisRange(1), 5);
    t.step();
    expect(t.vars.get(B737_VARS.ndRangeNm(1))).toBe(ND_RANGES_NM[5]);
    t.events.emit(B737_EVENTS.efisCtr(1));
    expect(t.vars.get(B737_VARS.efisCtr(1))).toBe(1);
  });

  it('BARO knob, STD and preselect', () => {
    const t = setup();
    t.vars.set(ADC.baroSetting(1), 29.92);
    t.events.emit(B737_EVENTS.efisBaroInc(1), 5);
    t.step();
    expect(t.vars.get(ADC.baroSetting(1))).toBeCloseTo(29.97, 2);
    t.events.emit(B737_EVENTS.efisBaroStd(1));
    t.step();
    expect(t.vars.get(ADC.baroStd(1))).toBe(1);
    // In STD the knob moves the preselect, not the setting in use.
    t.events.emit(B737_EVENTS.efisBaroInc(1), 3);
    t.step();
    expect(t.vars.get(B737_VARS.efisBaroPresel(1))).toBeGreaterThan(29.97);
    t.events.emit(B737_EVENTS.efisBaroStd(1));
    t.step();
    expect(t.vars.get(ADC.baroStd(1))).toBe(0);
    expect(t.vars.get(ADC.baroSetting(1))).toBeCloseTo(t.vars.get(B737_VARS.efisBaroPresel(1)), 2);
  });

  it('MINS: radio minimums set from blank and written for the TAWS minimums monitor', () => {
    const t = setup();
    expect(t.vars.get(B737_VARS.efisMinsRadioFt(1))).toBe(-1);
    t.events.emit(B737_EVENTS.efisMinsInc(1), 20);
    t.step();
    expect(t.vars.get(B737_VARS.efisMinsRadioFt(1))).toBeGreaterThan(0);
    expect(t.vars.get('ap.mins1_is_ra')).toBe(1);
    expect(t.vars.get('ap.mins1_ft')).toBe(t.vars.get(B737_VARS.efisMinsRadioFt(1)));
  });
});
