import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CockpitBuilder } from '../../../src/cockpit/CockpitBuilder';
import type { CockpitControl, ControlPointer } from '../../../src/cockpit/types';
import { DISPLAY_VARS } from '../../../src/cockpit/types';
import { KeyPad } from '../../../src/cockpit/controls';
import { addCdu, addCentreControls, addDisengageLights, addDisplaySelect, addDisplayUnits, addDuBrightness, addEfisPanel, addMcp, addTransferSwitches } from '../../../src/avionics/boeing-737/cockpit';
import { B737_VARS, DU_IDS, DuFormat, NdMode, cduDisplayId } from '../../../src/avionics/boeing-737/vars';
import { drawStats, makeSuite, type SuiteRig } from './helpers';

function ptr(c: CockpitControl, target = c.hitTargets[0]): ControlPointer {
  c.object.updateWorldMatrix(true, true);
  return { button: 0, shift: false, ctrl: false, alt: false, point: target.getWorldPosition(new THREE.Vector3()), object: target };
}

function click(c: CockpitControl): void {
  const p = ptr(c);
  c.onPointerDown?.(p);
  c.onPointerUp?.(p);
}

function deck(t: SuiteRig) {
  const b = new CockpitBuilder({ vars: t.vars, events: t.events }, { palette: 'boeing', eyePosition_m: [0, -0.5, -1.0] });
  const main = b.panel({ name: 'main', center_m: [0.9, 0, -0.7], facing: 'aft', width: 1.6, height: 0.5 });
  const glare = b.panel({ name: 'glare', center_m: [0.8, 0, -0.98], facing: 'aft', width: 1.6, height: 0.12 });
  const ped = b.panel({ name: 'ped', center_m: [0.3, 0, -0.35], facing: 'up', width: 0.5, height: 0.5 });
  addDisplayUnits(main, t.suite);
  addMcp(b, glare, 0, 0, t.suite);
  addEfisPanel(b, glare, -0.5, 0, 1);
  addEfisPanel(b, glare, 0.5, 0, 2);
  addDisengageLights(b, main, -0.62, 0.2, 1);
  addDisplaySelect(b, main, -0.75, -0.18, 1);
  addDuBrightness(b, main, -0.75, -0.22, ['capt_out', 'capt_in']);
  addCentreControls(b, main, 0, -0.18);
  addTransferSwitches(b, main, 0.3, -0.2);
  addCdu(b, ped, -0.1, 0, t.suite, 1);
  addCdu(b, ped, 0.1, 0, t.suite, 2);
  return b.build();
}

describe('737NG suite composition', () => {
  it('creates radios, FMS, FMC, two CDUs, the AFDS and all displays', async () => {
    const t = await makeSuite({}, true);
    const s = t.suite;
    expect(s.radios).not.toBeNull();
    expect(s.fms).not.toBeNull();
    expect(s.fmc).not.toBeNull();
    expect(s.cdus.length).toBe(2);
    expect(s.du.length).toBe(6);
    expect(s.cduDisplays.length).toBe(2);
    expect(s.mcpWindows.length).toBe(6);
    expect(s.systems.map((x) => x.name)).toEqual(['radios', 'fms', 'b737_cds', 'b737_afds']);
    const ids = s.failures().map((f) => f.id);
    expect(ids).toContain('b737.fmc');
    expect(ids).toContain('b737.deu1');
  });

  it('DUs render their formats after power-up', async () => {
    const t = await makeSuite({}, true);
    t.suite.applyState('cruise');
    t.run(0.5);
    const before = drawStats.fillText;
    for (const d of t.suite.du) {
      d.render(3); // past the 2 s boot
      d.render(0.1);
    }
    expect(drawStats.fillText).toBeGreaterThan(before);
    const formats = t.suite.du.map((d) => d.format);
    expect(formats).toEqual([DuFormat.Pfd, DuFormat.Nd, DuFormat.EngPrimary, DuFormat.Blank, DuFormat.Nd, DuFormat.Pfd]);
    for (const nd of [NdMode.App, NdMode.Vor, NdMode.Pln]) {
      t.vars.set(B737_VARS.efisMode(1), nd);
      t.run(0.05);
      t.suite.du[1].render(0.1);
    }
  });

  it('power bindings: DU, CDU screen and radio receivers follow their buses', async () => {
    const t = await makeSuite({ power: { du: { capt_out: 'ac.bus_test' }, cdu1: 'ac.bus_test', nav1: 'ac.bus_test' } }, true);
    t.run(0.1);
    expect(t.vars.get(DISPLAY_VARS.power('b737_du_capt_out'))).toBe(0);
    expect(t.vars.get(DISPLAY_VARS.power(cduDisplayId(1)))).toBe(0);
    expect(t.vars.get(DISPLAY_VARS.power(cduDisplayId(2)))).toBe(1);
    expect(t.vars.get('nav1.powered')).toBe(0);
    expect(t.vars.get('nav2.powered')).toBe(1);
    // Unpowered CDU ignores keys.
    t.suite.cdus[0].key('RTE');
    expect(t.suite.cdus[0].pageId).toBe('ident');
    t.vars.set('ac.bus_test', 1);
    t.run(0.1);
    expect(t.vars.get(DISPLAY_VARS.power('b737_du_capt_out'))).toBe(1);
    expect(t.vars.get('nav1.powered')).toBe(1);
    t.suite.cdus[0].key('RTE');
    expect(t.suite.cdus[0].pageId).toBe('rte');
  });

  it('applyState: cold & dark F/Ds off, takeoff F/Ds on and A/T armed', async () => {
    const t = await makeSuite();
    t.suite.applyState('cold_dark');
    expect(t.vars.get('ap.fd1_on')).toBe(0);
    expect(t.vars.get('ac.at_arm')).toBe(0);
    t.suite.applyState('takeoff');
    expect(t.vars.get('ap.fd1_on')).toBe(1);
    expect(t.vars.get('ap.fd2_on')).toBe(1);
    expect(t.vars.get('ac.at_arm')).toBe(1);
  });
});

describe('737NG cockpit hardware', () => {
  it('builds every panel with working controls', async () => {
    const t = await makeSuite({}, true);
    const build = deck(t);
    expect(build.displays.length).toBe(6 + 6 + 2);
    const ids = new Set(build.controls.map((c) => c.id));
    for (const id of [
      'b737.mcp.cmd_a',
      'b737.mcp.lvlchg',
      'b737.mcp.hdg',
      'b737.mcp.vs',
      'b737.mcp.vs_wheel',
      'b737.mcp.disengage',
      'b737.mcp.fd1',
      'b737.mcp.at_arm',
      'b737.efis1.mins',
      'b737.efis2.range',
      'b737.efis1.terr',
      'b737.asa1.ap',
      'b737.asa1.test',
      'b737.dsp1.main',
      'b737.dsp1.lower',
      'b737.n1set',
      'b737.spdref',
      'b737.ffsw',
      'b737.mfd.eng',
      'b737.xfr.source',
      'b737.cdu1.keys',
      'b737.cdu2.lskL',
      'b737.cdu1.brt',
    ])
      expect(ids.has(id), id).toBe(true);
    for (const d of DU_IDS) expect(build.displays.some((x) => x.display.id === `b737_du_${d}`)).toBe(true);
  });

  it('MCP button, F/D switch and knob drive the AFDS', async () => {
    const t = await makeSuite();
    t.suite.applyState('cold_dark');
    const build = deck(t);
    const byId = (id: string) => build.controls.find((c) => c.id === id)!;
    click(byId('b737.mcp.fd1'));
    expect(t.vars.get('ap.fd1_on')).toBe(1);
    const alt = byId('b737.mcp.alt');
    alt.onWheel?.(5, ptr(alt));
    t.run(0.05);
    expect(t.vars.get('ap.sel_alt_ft')).toBe(500);
    // Heading on the inner knob (shift+wheel = inner channel).
    const hdg = byId('b737.mcp.hdg');
    const p = ptr(hdg);
    p.shift = true;
    hdg.onWheel?.(3, p);
    t.run(0.05);
    expect(t.vars.get('ap.sel_hdg_deg')).toBe(3);
  });

  it('CDU keys drive the CDU (keypad -> event -> page)', async () => {
    const t = await makeSuite({}, true);
    const build = deck(t);
    const kp = build.controls.find((c) => c.id === 'b737.cdu1.keys') as KeyPad;
    kp.press('RTE');
    expect(t.suite.cdus[0].pageId).toBe('rte');
    kp.press('K');
    kp.press('J');
    expect(t.suite.cdus[0].scratch).toBe('KJ');
    // The right CDU is independent.
    expect(t.suite.cdus[1].pageId).toBe('ident');
  });
});

describe('737NG PFD options', () => {
  it('single-cue flight director renders and FMC failure removes LNAV guidance', async () => {
    const t = await makeSuite({ fdDisplay: 'single-cue' }, true);
    t.suite.applyState('cruise');
    t.vars.set('ap.fd_pitch_valid', 1);
    t.vars.set('ap.fd_roll_valid', 1);
    t.run(0.2);
    const pfd = t.suite.du[0];
    pfd.render(3);
    expect(pfd.render(0.1)).toBe(true);
    t.vars.set('fms.lnav_valid', 1);
    t.vars.set('fail.b737.fmc', 1);
    t.run(0.1);
    expect(t.vars.get('fms.lnav_valid')).toBe(0);
    expect(t.vars.get(B737_VARS.cduFailLight(1))).toBe(1);
  });
});
