/**
 * Boeing 737-800 flight deck layout (fix round 1, SCBG 1:1 panel / overhead / pedestal drawings): control
 * positions in body axes against the measured drawing positions, and the functions added with the layout
 * fixes (F/O disengage light TEST, UPPER / LOWER DU brightness, FOOT / WINDSHIELD AIR, clock bezel
 * controls, F/O stab trim indicator, HF / SELCAL panels, chart light, window crank).
 * Each assertion fails on the pre-fix layout (e.g. DUs at +/-0.64 / 0.425, display select below the
 * clock, N1 stacked above SPEED, CDUs at +/-0.076, doors on the aft overhead).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../../src/cockpit/types';
import { buildB738Cockpit } from '../../../../src/aircraft/b737-800/cockpit';
import { DU_U, MIP, P9 } from '../../../../src/aircraft/b737-800/cockpit/layout';
import { B738 } from '../../../../src/aircraft/b737-800/vars';
import { B737_VARS, DU_DISPLAY_VARS } from '../../../../src/avionics/boeing-737/vars';
import { B737_HW } from '../../../../src/avionics/boeing-737/cockpit';
import { loadNav, makeB738 } from '../helpers';
import type { NavDatabase } from '../../../../src/nav/types';

let nav: NavDatabase | undefined;

const P = (t: THREE.Object3D, button: 0 | 1 | 2 = 0): ControlPointer => ({ button, shift: false, ctrl: false, alt: false, point: t.getWorldPosition(new THREE.Vector3()), object: t });

function setup(mainOnly = false) {
  const r = makeB738({ state: 'ready_to_taxi', nav });
  const { build } = buildB738Cockpit(r.ctx, r.sys, { headless: true, mainOnly });
  build.root.updateMatrixWorld(true);
  const get = (id: string): CockpitControl => {
    const c = build.controls.find((x) => x.id === id);
    if (!c) throw new Error(`no control ${id}`);
    return c;
  };
  /** Body-axis position (x fwd, y right, z down) of a control (cockpit local = bl(x, y, z) = (y, -z, -x)). */
  const body = (id: string): [number, number, number] => {
    const w = get(id).object.getWorldPosition(new THREE.Vector3());
    const l = build.root.worldToLocal(w.clone());
    return [-l.z, l.x, -l.y];
  };
  const tick = (c: CockpitControl, s: number) => {
    for (let i = 0; i < Math.round(s * 60); i++) {
      c.update?.(1 / 60);
      build.update?.(1 / 60);
    }
  };
  const click = (c: CockpitControl, button: 0 | 1 | 2 = 0, hold = 0.12) => {
    const t = c.hitTargets[0];
    c.onPointerDown?.(P(t, button));
    tick(c, hold);
    c.onPointerUp?.(P(t, button));
    tick(c, 0.4);
  };
  /** Momentary push seen by the systems (held while they run). */
  const press = (c: CockpitControl) => {
    const t = c.hitTargets[0];
    c.onPointerDown?.(P(t));
    tick(c, 0.05);
    r.run(0.1);
    c.onPointerUp?.(P(t));
    tick(c, 0.05);
    r.run(0.1);
  };
  return { r, build, get, body, tick, click, press };
}

/** Body z of a point `v` metres up the MIP face (panel v, measured from the MIP frame centre). */
const mipZ = (v: number) => MIP.center_m[2] - v * Math.cos(((MIP.tiltDeg ?? 15) * Math.PI) / 180);

describe('737-800 layout (SCBG drawings)', () => {
  it('loads the navigation database (the FMC / CDUs need it)', async () => {
    nav = await loadNav();
    expect(nav).toBeDefined();
  });

  it('main panel: DU spacing, upper-strip controls above the DUs, lower-strip knobs below them', () => {
    const { body, build } = setup(true);
    // DU centres from the drawing.
    expect(DU_U.capt_out).toBeCloseTo(-0.504, 3);
    expect(DU_U.capt_in).toBeCloseTo(-0.292, 3);
    expect(DU_U.fo_in).toBeCloseTo(0.291, 3);
    expect(DU_U.fo_out).toBeCloseTo(0.503, 3);
    expect(MIP.width).toBeLessThan(1.5);
    const duTopZ = mipZ(0.083 + B737_HW.du.h / 2 + B737_HW.du.border);
    const duBotZ = mipZ(0.083 - B737_HW.du.h / 2 - B737_HW.du.border);
    // Upper strip (above the DU tops = more negative body z).
    for (const [id, y] of [
      ['b737.dsp1.main', -0.44],
      ['b737.dsp1.lower', -0.37],
      ['b737.asa1.ap', -0.31],
      ['b738.mip1.lights', -0.214],
      ['b738.mip1.below_gs', -0.565],
      ['b737.asa2.ap', 0.27],
      ['b738.mip.autobrake', 0.042],
      ['b737.n1set', -0.054],
    ] as const) {
      const [, by, bz] = body(id);
      expect(bz, id).toBeLessThan(duTopZ);
      expect(Math.abs(by - y), id).toBeLessThan(0.02);
    }
    // F/O display select is mirrored: LOWER DU inboard of MAIN PANEL DUs.
    expect(body('b737.dsp2.lower')[1]).toBeLessThan(body('b737.dsp2.main')[1]);
    // Lower strips (below the DU bottoms).
    for (const id of ['b737.brt.upper', 'b737.brt.lower', 'b737.brt.capt_out', 'b738.mip1.background', 'b738.mip1.afds_flood', 'b738.mip1.foot_air', 'b738.mip.gpws_flap']) {
      expect(body(id)[2], id).toBeGreaterThan(duBotZ);
    }
    // Clock outboard of the PFD with the NWS switch under it.
    expect(body('b738.mip1.chr')[1]).toBeLessThan(-0.62);
    expect(Math.abs(body('b738.mip1.nws')[1] + 0.66)).toBeLessThan(0.01);
    expect(body('b738.mip1.nws')[2]).toBeGreaterThan(body('b738.mip1.reset')[2]);
    // Gear lever right of the upper DU; gear lights NOSE above LEFT / RIGHT.
    expect(Math.abs(body('b738.mip.gear')[1] - 0.161)).toBeLessThan(0.01);
    expect(body('b738.mip.gear_red0')[2]).toBeLessThan(body('b738.mip.gear_red1')[2]);
    expect(body('b738.mip.gear_red1')[2]).toBeCloseTo(body('b738.mip.gear_red2')[2], 4);
    build.dispose?.();
  });

  it('glareshield: MCP / EFIS sizes, N1 and SPEED side by side, masters and six-pack in one row', () => {
    const { body, build } = setup(true);
    expect(B737_HW.mcp.w).toBeCloseTo(0.463, 3);
    expect(B737_HW.efis.w).toBeLessThan(0.13);
    expect(body('b737.mcp.n1')[2]).toBeCloseTo(body('b737.mcp.speed')[2], 4);
    expect(body('b737.mcp.n1')[1]).toBeLessThan(body('b737.mcp.speed')[1]);
    // A/T ARM above the F/D switch.
    expect(body('b737.mcp.at_arm')[2]).toBeLessThan(body('b737.mcp.fd1')[2]);
    // FIRE WARN, MASTER CAUTION, six-pack side by side, outboard -> inboard.
    const fw = body('b738.gs.fire_warn1');
    const mc = body('b738.gs.master_caution1');
    const sp = body('b738.gs.sixpack1_1');
    expect(fw[2]).toBeCloseTo(mc[2], 4);
    expect(fw[1]).toBeLessThan(mc[1]);
    expect(mc[1]).toBeLessThan(sp[1]);
    expect(Math.abs(fw[1] + 0.436)).toBeLessThan(0.01);
    // EFIS directly adjacent to the MCP.
    expect(Math.abs(body('b737.efis1.baro')[1] - body('b737.mcp.crs1')[1])).toBeLessThan(0.07);
    build.dispose?.();
  });

  it('P9 / control stand: CDUs +/-0.176 around the lower DU, both stab trim indicators, HORN CUTOUT on the right', () => {
    const { get, body, build } = setup(true);
    // (The CDU keyboards exist only with canvas displays; P9 carries them at +/-0.176 m, pedestal.ts.)
    expect(P9.width).toBeGreaterThan(0.5);
    for (const s of [1, 2]) {
      const o = (get(`b738.ped.stab_wheel${s}`) as unknown as { o: { indicator?: unknown } }).o;
      expect(o.indicator, `stab trim indicator ${s}`).toBeDefined();
    }
    expect(body('b738.ped.horn_cutout')[1]).toBeGreaterThan(0.03);
    expect(Math.abs(body('b738.ped.tl1')[1] + 0.038)).toBeLessThan(0.005);
    build.dispose?.();
  });

  it('overhead: 0.66 m forward overhead columns, DOORS on the forward overhead, DOME WHITE on the aft overhead', () => {
    const { get, body, build } = setup(false);
    const under = (id: string, panel: string) => {
      let o: THREE.Object3D | null = get(id).object;
      while (o) {
        if (o.name === `panel:${panel}`) return true;
        o = o.parent;
      }
      return false;
    };
    expect(under('b738.aovhd.door.fwd_entry', 'b738.ovhd')).toBe(true);
    expect(under('b738.ovhd.lt.dome', 'b738.aovhd')).toBe(true);
    // Column order across the forward overhead: FLT CONTROL (left) .. BLEED (right) within +/-0.33 m.
    const yFlt = body('b738.ovhd.fltctl.fltctl_a')[1];
    const yBleed = body('b738.ovhd.bleed.bleed2')[1];
    expect(yFlt).toBeGreaterThan(-0.33);
    expect(yBleed).toBeLessThan(0.33);
    // APU EGT module and L WIPER at the bottom of column 2; R WIPER in the narrow centre column.
    expect(Math.abs(body('b738.ovhd.wiper1')[1] - (0.258 - 0.33))).toBeLessThan(0.02);
    expect(Math.abs(body('b738.ovhd.wiper2')[1] - (0.325 - 0.33))).toBeLessThan(0.02);
    build.dispose?.();
  });

  it('P8: fire panel at the forward end, 3-column grid with HF and SELCAL', () => {
    const { body, build } = setup(true);
    expect(body('b738.aft.fire_1')[0]).toBeGreaterThan(body('b738.aft.com1_tfr')[0]);
    expect(body('b738.aft.com1_tfr')[0]).toBeGreaterThan(body('b738.aft.nav1_tfr')[0]);
    expect(body('b738.aft.hf1_mode')[1]).toBeLessThan(-0.1);
    expect(Math.abs(body('b738.aft.selcal0')[1])).toBeLessThan(0.07);
    expect(Math.abs(body('b738.aft.cargo_test')[1])).toBeLessThan(0.07);
    build.dispose?.();
  });
});

describe('737-800 functions added with the layout fixes', () => {
  it('F/O disengage light TEST switch tests the A/P / A/T / FMC lights', () => {
    const { r, get, tick, build } = setup(true);
    const t2 = get('b737.asa2.test');
    t2.onWheel?.(1, P(t2.hitTargets[0]));
    tick(t2, 0.05);
    r.run(0.1);
    expect(r.vars.get(B737_VARS.discLightTest2)).toBe(1);
    expect(r.vars.get(B737_VARS.apDiscLight)).toBe(1);
    expect(r.vars.get(B737_VARS.fmcAlertLight)).toBe(2);
    tick(t2, 0.5);
    r.run(0.1);
    expect(r.vars.get(B737_VARS.discLightTest2)).toBe(0);
    build.dispose?.();
  });

  it('UPPER DU and LOWER DU brightness knobs dim their DUs', () => {
    const { r, get, tick, build } = setup(true);
    for (const du of ['upper', 'lower'] as const) {
      const k = get(`b737.brt.${du}`);
      const v0 = r.vars.get(DU_DISPLAY_VARS.brightness(du), 0.9);
      for (let i = 0; i < 4; i++) k.onWheel?.(-1, P(k.hitTargets[0]));
      tick(k, 0.1);
      expect(r.vars.get(DU_DISPLAY_VARS.brightness(du))).toBeLessThan(v0);
    }
    build.dispose?.();
  });

  it('FOOT AIR / WINDSHIELD AIR pull knobs divert the outlet air', () => {
    const { r, get, click, build } = setup(true);
    for (const s of [1, 2] as const) {
      click(get(`b738.mip${s}.foot_air`));
      click(get(`b738.mip${s}.ws_air`));
      r.run(0.1);
      expect(r.vars.get(B738.footAir(s))).toBe(1);
      expect(r.vars.get(B738.windshieldAir(s))).toBe(1);
      expect(r.vars.get(`ac.b738.fd_air_foot${s}`)).toBeGreaterThan(0);
      expect(r.vars.get(`ac.b738.fd_air_ws${s}`)).toBeGreaterThan(0);
    }
    build.dispose?.();
  });

  it('clock: TIME/DATE cycles UTC / MAN time / date, SET + "+" adjust the MAN hours, RESET zeroes ET, ET HLD stops it', () => {
    const { r, get, press, build } = setup(true);
    const v = r.vars;
    r.run(2);
    expect(v.get(B738.lt.clockEtS(1))).toBeGreaterThan(1);
    press(get('b738.mip1.reset'));
    expect(v.get(B738.lt.clockEtS(1))).toBeLessThan(0.25);
    // ET HLD holds the elapsed time.
    const et = get('b738.mip1.et');
    et.onWheel?.(-1, P(et.hitTargets[0]));
    r.run(0.5);
    const held = v.get(B738.lt.clockEtS(1));
    r.run(1);
    expect(v.get(B738.lt.clockEtS(1))).toBeCloseTo(held, 5);
    expect(v.get(B738.lt.clockEtRun(1))).toBe(0);
    // TIME/DATE: UTC time -> UTC date -> MAN time.
    const td = get('b738.mip1.timedate');
    press(td);
    expect(v.get(B738.lt.clockMode(1))).toBe(1);
    press(td);
    expect(v.get(B738.lt.clockMode(1))).toBe(2);
    // SET (hours field) then + twice: MAN time 2 h ahead.
    press(get('b738.mip1.set'));
    expect(v.get(B738.lt.clockSetField(1))).toBe(1);
    press(get('b738.mip1.plus'));
    press(get('b738.mip1.plus'));
    expect(v.get(B738.lt.clockManOffsetH(1))).toBe(2);
    press(get('b738.mip1.minus'));
    expect(v.get(B738.lt.clockManOffsetH(1))).toBe(1);
    build.dispose?.();
  });

  it('HF panels: mode, frequency and RF SENS drive the HF receiver state; SELCAL lights reset', () => {
    const { r, get, tick, press, build } = setup(true);
    const v = r.vars;
    r.run(0.5);
    expect(v.get('ac.b738.hf1.powered')).toBe(1);
    const khz = get('b738.aft.hf1_khz');
    const f0 = v.get(B738.hfFreqKhz(1));
    khz.onWheel?.(1, P(khz.hitTargets[0]));
    tick(khz, 0.1);
    r.run(0.1);
    expect(v.get(B738.hfFreqKhz(1))).toBe(f0 + 1);
    expect(v.get('ac.b738.hf1.active_mhz')).toBeCloseTo((f0 + 1) / 1000, 6);
    const mode = get('b738.aft.hf1_mode');
    for (let i = 0; i < 3 && v.get(B738.hfMode(1)) !== 0; i++) {
      mode.onWheel?.(-1, P(mode.hitTargets[0]));
      tick(mode, 0.2);
    }
    r.run(0.1);
    expect(v.get(B738.hfMode(1))).toBe(0);
    expect(v.get('ac.b738.hf1.powered')).toBe(0);
    // SELCAL: an HF 1 call lights its light; pushing it resets it.
    r.events.emit('b738.selcal.call', 3);
    r.run(0.05);
    expect(v.get(B738.lt.selcal(3))).toBe(1);
    press(get('b738.aft.selcal3'));
    expect(v.get(B738.lt.selcal(3))).toBe(0);
    build.dispose?.();
  });

  it('side consoles: chart light rheostat and No. 2 window crank (ground only)', () => {
    const { r, get, tick, build } = setup(false);
    const v = r.vars;
    const ch = get('b738.side1.chart_lt');
    for (let i = 0; i < 6; i++) ch.onWheel?.(1, P(ch.hitTargets[0]));
    tick(ch, 0.1);
    r.run(0.5);
    expect(v.get(B738.chartLt(1))).toBeGreaterThan(0.2);
    expect(v.get('ac.light.chart_capt')).toBeGreaterThan(0);
    const cr = get('b738.side2.window_crank');
    for (let i = 0; i < 5; i++) cr.onWheel?.(1, P(cr.hitTargets[0]));
    tick(cr, 0.1);
    r.run(0.2);
    expect(v.get(B738.windowCrank(2))).toBeGreaterThan(0.3);
    expect(v.get('ac.b738.side_window_open2')).toBeGreaterThan(0.3);
    build.dispose?.();
  });
});
