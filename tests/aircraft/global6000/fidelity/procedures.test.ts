/**
 * Procedures & checklists audit probes (read-only; pins CURRENT behaviour and
 * logs the numbers quoted in the audit).
 *
 *  1. Every checklist auto-check var is produced by a system or a cockpit control.
 *  2. Every var a checklist item asks the crew to move can be written by a 3D cockpit control.
 *  3. The initial states leave the switches where the checklists do (item-by-item pass/fail per state).
 *  4. Real GX / XRS start logic (FCOM CSP 700-6 17: ENG RUN ON with ENG START AUTO starts the engine).
 */
import { describe, expect, it } from 'vitest';
import type { CockpitControl } from '../../../../src/cockpit/types';
import { AnnunciatorLight } from '../../../../src/cockpit/controls';
import { buildG6kCockpit } from '../../../../src/aircraft/global6000/cockpit';
import { G6K_CHECKLISTS } from '../../../../src/aircraft/global6000/checklists';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { fakeCanvas } from '../../../avionics/collins-fusion/helpers';
import { makeRig } from '../helpers';
import { gestures, recordReads, recordWrites } from '../cockpit-overhead/harness';
import type { InitialState } from '../../../../src/aircraft/types';
import { FUSION_VARS } from '../../../../src/avionics/collins-fusion/vars';

describe('Global 6000 procedures audit', () => {
  it('checklist auto-check vars exist and crew-set vars have a cockpit control', { timeout: 600_000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    const { build } = buildG6kCockpit(r.ctx, r.sys, { canvas: fakeCanvas() });
    build.root.updateMatrixWorld(true);
    // union of vars writable from any control
    const writable = new Set<string>();
    const advance = (c: CockpitControl) => (s: number) => {
      const n = Math.max(1, Math.round(s * 60));
      for (let i = 0; i < n; i++) {
        c.update?.(1 / 60);
        build.update?.(1 / 60);
      }
    };
    for (const c of build.controls) {
      if (c instanceof AnnunciatorLight) continue;
      for (const g of gestures(c)) for (const n of recordWrites(r.vars, () => g(advance(c)))) writable.add(n);
    }
    console.log(`[proc] ${build.controls.length} controls, ${writable.size} writable vars`);
    const doorVars = [...writable].filter((n) => n.startsWith('ac.door.'));
    console.log('[proc] door vars writable from the cockpit:', doorVars.join(',') || 'NONE');

    // vars read by each auto-check, and whether any system / state produces them
    const produced = new Set<string>();
    for (const st of ['cold_dark', 'ready_to_taxi', 'takeoff', 'cruise', 'approach'] as InitialState[]) {
      const rr = makeRig(st, { avionics: true });
      rr.run(2);
      const all = [...rr.vars.keys(), ...rr.vars.stringKeys()];
      for (const n of all) produced.add(n);
      for (const c of G6K_CHECKLISTS) for (const i of c.items) if (i.check) for (const n of recordReads(rr.vars, () => i.check!(rr.vars))) if (rr.vars.has(n)) produced.add(n);
    }
    const lines: string[] = [];
    let noCheck = 0;
    let total = 0;
    for (const c of G6K_CHECKLISTS) {
      for (const i of c.items) {
        total++;
        if (!i.check) {
          noCheck++;
          lines.push(`  NOCHECK ${c.title} | ${i.challenge} - ${i.response}`);
          continue;
        }
        const reads = [...recordReads(r.vars, () => i.check!(r.vars))];
        const missing = reads.filter((n) => !produced.has(n));
        const crew = reads.filter((n) => n.startsWith('ac.') && !writable.has(n));
        if (missing.length || crew.length) lines.push(`  ${c.title} | ${i.challenge}: unproduced [${missing.join(',')}] no-control [${crew.join(',')}]`);
      }
    }
    console.log(`[proc] items ${total}, without auto-check ${noCheck}\n${lines.join('\n')}`);
    expect(doorVars).toEqual([]); // pinned: no cockpit control closes / opens the doors
  });

  it('initial states vs checklists (item by item)', { timeout: 600_000 }, () => {
    const out: string[] = [];
    for (const st of ['cold_dark', 'ready_to_taxi', 'takeoff', 'cruise', 'approach'] as InitialState[]) {
      const r = makeRig(st, { avionics: true, ...(st === 'cruise' ? { air: { altFtMsl: 41000, iasKt: 250 } } : st === 'approach' ? { air: { altFtMsl: 2500, iasKt: 140 } } : {}) });
      r.run(3);
      for (const c of G6K_CHECKLISTS) {
        const fails = c.items.filter((i) => i.check && !i.check(r.vars)).map((i) => i.challenge);
        out.push(`  ${st.padEnd(13)} ${c.title.padEnd(20)} ${fails.length ? 'FAIL: ' + fails.join(' ; ') : 'pass'}`);
      }
      const casList = r.sys.cas.list.filter((e) => e.active).map((e) => `${e.level}:${e.text}`);
      out.push(`  ${st.padEnd(13)} CAS ${casList.join(', ')} | xpdr ${r.vars.get('xpdr.mode')} crewOxy ${r.vars.get(V.crewOxy)} paxDoor ${r.vars.get(V.door('pax'))} cabinPwr ${r.vars.get(V.cabinPwr)} autobrake ${r.vars.get(V.autobrake)} gldArmed ${r.vars.get(V.gldArmed)} baroStd ${r.vars.get('adc1.baro_std')} beacon ${r.vars.get(V.ltBeacon)} taxi ${r.vars.get(V.ltTaxi)} ignition ${r.vars.get(V.ignition)} v1 ${r.vars.get(FUSION_VARS.vspd('v1'))} v2 ${r.vars.get(FUSION_VARS.vspd('v2'))} vref ${r.vars.get(FUSION_VARS.vspd('vref'))} selSpd ${r.vars.get('ap.sel_spd_kt')} ap ${r.vars.get('ap.engaged')} at ${r.vars.get('ap.at_engaged')} vert ${r.vars.getString('ap.vert_active')} lat ${r.vars.getString('ap.lat_active')} armed ${r.vars.getString('ap.vert_armed')}/${r.vars.getString('ap.lat_armed')} ias ${r.vars.get('fdm.ias_kt').toFixed(0)} logo ${r.vars.get(V.ltLogo)} ldgN ${r.vars.get(V.ltLdgNose)}`);
    }
    console.log('[proc] states x checklists\n' + out.join('\n'));
    expect(out.length).toBeGreaterThan(0);
  });

  it('START AUTO + ENGINE RUN ON starts the engine (GX PTG 17-42 auto start); L CRANK dry-motors the left engine', { timeout: 300_000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;
    v.set(V.battMaster, 1);
    for (const d of ['pax', 'emer', 'bag'] as const) v.set(V.door(d), 0);
    v.set(V.apuSw, 1);
    r.run(11);
    v.set(V.apuSw, 2);
    r.run(1.5);
    v.set(V.apuSw, 1);
    r.run(90, () => v.get('elec.apu_gen_online') === 1);
    r.run(5);
    v.set(V.apuBleed, 1);
    v.set(V.xbleed, 1);
    r.run(10);
    expect(v.get(V.engStartSel)).toBe(0); // START selector at AUTO
    v.set(V.engRun(2), 1);
    r.run(70, () => v.get('eng2.running') !== 0);
    console.log('[proc] ENG RUN R ON with START AUTO: running', v.get('eng2.running'), 'N2', v.get('eng2.n2_pct').toFixed(1));
    expect(v.get('eng2.running')).toBe(1);
    // Dry crank (PTG 17-48): ENGINE RUN OFF, START to L CRANK: the starter motors the left engine, no fuel.
    v.set(V.engStartSel, -1);
    let n2 = 0;
    r.run(20, () => {
      n2 = Math.max(n2, v.get('eng1.n2_pct'));
    });
    expect(v.get('fadec.eng1.starter_cmd')).toBeGreaterThan(0);
    expect(n2).toBeGreaterThan(10);
    expect(v.get('eng1.running')).toBe(0);
    expect(v.get('eng1.ff_pph')).toBeLessThan(1);
    v.set(V.engStartSel, 0); // back to AUTO stops the crank
    r.run(2);
    expect(v.get('fadec.eng1.starter_cmd')).toBe(0);
  });

  it('cruise / approach FADEC rating and AFTER TAKEOFF CLB check', () => {
    for (const st of ['cruise', 'approach'] as InitialState[]) {
      const r = makeRig(st, st === 'cruise' ? { air: { altFtMsl: 41000, iasKt: 250 } } : { air: { altFtMsl: 2500, iasKt: 140 } });
      r.run(2);
      console.log('[proc]', st, 'rating', r.vars.getString('fadec.rating'), 'at', r.vars.get('ap.at_engaged'), 'ign', r.vars.get(V.ignition), 'wingAI', r.vars.get(V.wingAi), 'seatbelt', r.vars.get(V.seatBelts), 'gldArmed', r.vars.get(V.gldArmed), 'xpdr', r.vars.get('xpdr.mode'), 'pusher', r.vars.get(V.pusher(1)));
    }
  });
});
