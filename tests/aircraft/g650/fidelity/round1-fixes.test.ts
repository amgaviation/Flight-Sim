/**
 * Fix round 1 (LENS layout audit): functional checks for the gaps that added or changed behaviour.
 * Each test fails without its fix:
 *  - G650-L01: SYSTEM TEST block runs the modelled self-tests through logic.ts (pass lamp only while the
 *    tested channel is powered) and the DOOR / DUMP VLV annunciators exist.
 *  - G650-L02: CABIN PRESSURE CONTROL has the LDG ELEV selector writing ac.press.ldg_elev_ft, and the
 *    green readout shows the pressurization vars.
 *  - G650-L32: TEMP DISPLAY row publishes the selected zone's measured temperature.
 *  - G650-L08: BACKUP PITCH is a spring-return thumbwheel writing the momentary trim command.
 *  - G650-L25: the clocks have SEL / CTL buttons cycling UTC -> ET -> CHR with a start-stop-reset chrono.
 *  - G650-L06: the CB segment is two panels (left / right) whose union still matches the network.
 *  - G650-L10: the DUs sit nearly edge-to-edge (inter-DU gap a few cm, bezel 0.314 m).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';
import { CLK } from '../../../../src/aircraft/g650/cockpit/mainPanel';
import { DU_U } from '../../../../src/aircraft/g650/cockpit/layout';
import { EPIC_HW } from '../../../../src/avionics/honeywell-epic/cockpit';
import { G650_CB_GROUPS, G650_CB_GROUPS_L, G650_CB_GROUPS_R } from '../../../../src/aircraft/g650/cockpit/overhead/breakers';
import { cockpitRig } from '../cockpit-main/rig';

describe('G650 fix round 1 (layout audit)', () => {
  let r: Awaited<ReturnType<typeof cockpitRig>>['r'];
  let ck: Awaited<ReturnType<typeof cockpitRig>>['ck'];
  let v: (typeof r)['vars'];
  beforeAll(async () => {
    ({ r, ck } = await cockpitRig('ready_to_taxi', false));
    v = r.vars;
  }, 300000);
  const find = (id: string) => ck.build.controls.find((c) => c.id === id);

  it('L01: SYSTEM TEST keys run the self-tests while held, gated by the tested channel power', () => {
    for (const k of ['stall', 'gpws', 'antiskid', 'ice_det'] as const) {
      expect(find(`g650.oh.systest.${k}`), `switchlight ${k}`).toBeTruthy();
      v.set(V.sysTest(k), 1);
      r.run(0.2);
      expect(v.get(V.sysTestPass(k)), `${k} pass while powered`).toBe(1);
      v.set(V.sysTest(k), 0);
      r.run(0.1);
      expect(v.get(V.sysTestPass(k)), `${k} pass released`).toBe(0);
    }
    // Unpowered test channel: pulling the stall-warning breaker fails its test.
    v.set('cb.stall_warn', 0);
    r.run(0.5);
    v.set(V.sysTest('stall'), 1);
    r.run(0.2);
    expect(v.get(V.sysTestPass('stall'))).toBe(0);
    v.set(V.sysTest('stall'), 0);
    v.set('cb.stall_warn', 1);
    r.run(0.5);
    // DOOR and LDG GEAR DUMP VLV items beside the block.
    expect(find('g650.oh.systest.door')).toBeTruthy();
    expect(find('g650.oh.systest.dump_vlv')).toBeTruthy();
  });

  it('L02: LDG ELEV selector on the cabin pressure controller writes ac.press.ldg_elev_ft', () => {
    const knob = find('g650.oh.press.ldg_elev');
    expect(knob).toBeTruthy();
    v.set(V.ldgElevFt, 0);
    knob?.update?.(0.1); // sync the knob to the var
    knob?.onWheel?.(1, undefined as never);
    const turned = v.get(V.ldgElevFt);
    expect(Math.abs(turned)).toBeGreaterThanOrEqual(50); // one detent moves the entered elevation
    v.set(V.ldgElevFt, -9999); // back to FMS destination for the other tests
  });

  it('L32: TEMP DISPLAY publishes the selected zone temperature', () => {
    r.run(1);
    v.set(V.tempDispSel, 0);
    r.run(0.1);
    expect(v.get(V.tempDispC)).toBeCloseTo(v.get('pneu.cockpit_temp_c'), 3);
    v.set(V.tempDispSel, 2);
    r.run(0.1);
    expect(v.get(V.tempDispC)).toBeCloseTo(v.get('pneu.aft_cabin_temp_c'), 3);
  });

  it('L08: BACKUP PITCH thumbwheel commands momentary trim and springs back to 0', () => {
    const wheel = find('g650.ped.backup_pitch');
    expect(wheel).toBeTruthy();
    wheel?.onWheel?.(1, undefined as never); // roll fwd = NOSE DOWN
    expect(v.get(V.backupPitch)).toBe(-1);
    for (let i = 0; i < 40; i++) {
      wheel?.update?.(1 / 60);
      ck.build.update?.(1 / 60);
    }
    expect(v.get(V.backupPitch)).toBe(0);
  });

  it('L25: clock SEL cycles UTC / ET / CHR and CTL runs the chronograph', () => {
    const step = (s: number) => {
      const n = Math.max(1, Math.round(s * 60));
      for (let i = 0; i < n; i++) ck.build.update?.(1 / 60);
    };
    const press = (name: string) => {
      v.set(name, 1);
      step(0.1);
      v.set(name, 0);
      step(0.1);
    };
    expect(find('g650.mp.clock_l_sel')).toBeTruthy();
    expect(find('g650.mp.clock_l_ctl')).toBeTruthy();
    v.set(CLK.mode('l'), 0);
    press(CLK.sel('l'));
    expect(v.get(CLK.mode('l'))).toBe(1); // ET
    press(CLK.sel('l'));
    expect(v.get(CLK.mode('l'))).toBe(2); // CHR
    const t0 = v.get('env.time_utc_h');
    press(CLK.ctl('l'));
    expect(v.get(CLK.run('l'))).toBe(1);
    v.set('env.time_utc_h', t0 + 30 / 3600); // 30 s later
    press(CLK.ctl('l')); // stop
    expect(v.get(CLK.run('l'))).toBe(0);
    expect(v.get(CLK.accS('l'))).toBeGreaterThan(25);
    press(CLK.ctl('l')); // stopped + non-zero -> reset
    expect(v.get(CLK.accS('l'))).toBe(0);
    press(CLK.sel('l'));
    expect(v.get(CLK.mode('l'))).toBe(0); // back to UTC
  });

  it('L06: the CB segment is split into left / right panels whose union matches the network', () => {
    const flat = (g: typeof G650_CB_GROUPS) => g.flatMap((x) => x.items.map((i) => i[0])).sort();
    const l = flat(G650_CB_GROUPS_L);
    const rr = flat(G650_CB_GROUPS_R);
    expect(l.length + rr.length).toBe(flat(G650_CB_GROUPS).length);
    // No breaker appears on both panels.
    expect(l.filter((n) => rr.includes(n))).toEqual([]);
    // Every breaker of the network is placed (id g650.cb.<name>) exactly once.
    const built = ck.build.controls.filter((c) => c.id.startsWith('g650.cb.')).map((c) => c.id);
    expect(new Set(built).size).toBe(built.length);
    expect(built.length).toBe(l.length + rr.length);
  });

  it('L10: inter-DU gaps are a few cm (near-continuous display band)', () => {
    const bezel = EPIC_HW.du.w + 2 * 0.016;
    for (let i = 0; i < 3; i++) {
      const gap = DU_U[i + 1] - DU_U[i] - bezel;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(0.07);
    }
  });
});
