/**
 * Procedures-lens audit (read-only): EXECUTES the normal checklists headlessly
 * against the systems, cold & dark through shutdown, asserting each item's
 * auto-check passes right after the crew action that satisfies it. Also pins
 * preset gaps found by the audit (transponder STBY in flight, QNH not STD at
 * FL410, no V-speeds in the takeoff / approach presets).
 */
import { describe, expect, it } from 'vitest';
import { G6K_CHECKLISTS } from '../../../../src/aircraft/global6000/checklists';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { SURF } from '../../../../src/core/vars';
import { makeRig, posted } from '../helpers';

const list = (title: string) => G6K_CHECKLISTS.find((c) => c.title === title)!;
const failing = (r: ReturnType<typeof makeRig>, title: string) =>
  list(title).items.filter((i) => i.check && !i.check(r.vars)).map((i) => `${i.challenge} - ${i.response}`);

describe('Global 6000 checklist execution (procedures lens)', () => {
  it('cold & dark -> COCKPIT PREPARATION -> BEFORE START -> ENGINE START -> AFTER START -> BEFORE TAKEOFF, every auto-check satisfied by a crew action', { timeout: 600_000 }, () => {
    const r = makeRig('cold_dark');
    const v = r.vars;

    // ---- COCKPIT PREPARATION
    v.set(V.battMasterSel, 2); // BATT MASTER rotary -> ON
    v.set(V.battMaster, 1);
    r.run(2);
    v.set(V.emerLights, 1);
    // Doors: NO cockpit control exists (pinned in procedures.test.ts); the state var is set directly here.
    for (const d of ['pax', 'bag', 'emer'] as const) v.set(V.door(d), 0);
    // APU: rotary RUN -> BIT -> START (spring-loaded back)
    v.set(V.apuSw, 1);
    r.run(12);
    v.set(V.apuSw, 2);
    r.run(1.5);
    v.set(V.apuSw, 1);
    const tApu = r.run(90, () => v.get('apu.avail') === 1 && v.get('elec.apu_gen_online') === 1);
    console.log('[exec] APU avail + gen online after', tApu.toFixed(0), 's');
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 2);
    for (const p of ['1b', '2b', '3b'] as const) v.set(V.hydPump(p), 1);
    v.set(V.hydPump('3a'), 2);
    v.set(V.wshldL, 1);
    v.set(V.wshldR, 1);
    r.run(3);
    console.log('[exec] COCKPIT PREPARATION fails:', failing(r, 'COCKPIT PREPARATION').join(' ; ') || 'none');
    expect(failing(r, 'COCKPIT PREPARATION')).toEqual([]);

    // ---- BEFORE START
    v.set(V.ltBeacon, 1);
    v.set(V.ltNav, 1);
    v.set(V.seatBelts, 1);
    v.set(V.noSmoking, 1);
    v.set(V.apuBleed, 1);
    v.set(V.xbleed, 1);
    r.run(2);
    console.log('[exec] BEFORE START fails:', failing(r, 'BEFORE START').join(' ; ') || 'none');
    expect(failing(r, 'BEFORE START')).toEqual([]);

    // ---- ENGINE START (right, then left; START selector stays AUTO)
    console.log('[exec] duct psi before start:', v.get('pneu.l_duct_psi').toFixed(1), v.get('pneu.r_duct_psi').toFixed(1));
    v.set(V.engRun(2), 1);
    const t2 = r.run(80, () => v.get('eng2.running') === 1);
    v.set(V.engRun(1), 1);
    const t1 = r.run(80, () => v.get('eng1.running') === 1);
    r.run(10);
    console.log('[exec] eng2 start', t2.toFixed(0), 's, eng1 start', t1.toFixed(0), 's, gens',
      [1, 2, 3, 4].map((n) => v.get(`elec.gen${n}_online`)).join(''));
    console.log('[exec] ENGINE START fails:', failing(r, 'ENGINE START').join(' ; ') || 'none');
    expect(failing(r, 'ENGINE START')).toEqual([]);

    // ---- AFTER START
    v.set(V.apuSw, 0);
    v.set(V.nwsArm, 1);
    v.set(V.flapLever, 2); // slats/flaps 6
    r.run(30, () => Math.abs(v.get(SURF.flapsDeg) - 6) < 0.5 && v.get(SURF.slats) > 0.95);
    r.sys.stab.setPosition(7.5); // yoke trim switch action (function lens covers the switch itself)
    r.run(2);
    console.log('[exec] AFTER START fails:', failing(r, 'AFTER START').join(' ; ') || 'none');
    expect(failing(r, 'AFTER START')).toEqual([]);

    // ---- BEFORE TAKEOFF
    v.set(V.ltStrobe, 1);
    v.set(V.ltLdgL, 1);
    v.set(V.ltLdgR, 1);
    v.set(V.ltLdgNose, 1);
    v.set(V.parkBrake, 0);
    r.run(3);
    console.log('[exec] BEFORE TAKEOFF fails:', failing(r, 'BEFORE TAKEOFF').join(' ; ') || 'none');
    console.log('[exec] CAS now:', posted(r).join(', ') || 'none');
    expect(failing(r, 'BEFORE TAKEOFF')).toEqual([]);
  });

  it('ready_to_taxi -> SHUTDOWN checklist, every auto-check satisfied by a crew action', { timeout: 300_000 }, () => {
    const r = makeRig('ready_to_taxi');
    const v = r.vars;
    r.run(2);
    v.set(V.parkBrake, 1);
    v.set(V.tla(1), 0);
    v.set(V.tla(2), 0);
    v.set(V.engRun(1), 0);
    v.set(V.engRun(2), 0);
    r.run(40, () => v.get('eng1.running') === 0 && v.get('eng2.running') === 0);
    v.set(V.ltBeacon, 0);
    for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 0);
    v.set(V.apuSw, 0);
    v.set(V.emerLights, 0);
    v.set(V.battMasterSel, 0);
    v.set(V.battMaster, 0);
    r.run(3);
    console.log('[exec] SHUTDOWN fails:', failing(r, 'SHUTDOWN').join(' ; ') || 'none');
    expect(failing(r, 'SHUTDOWN')).toEqual([]);
  });

  it('preset pins: transponder left in STBY in flight, QNH not STD at FL410, no V-speeds in takeoff / approach presets', () => {
    const cr = makeRig('cruise', { avionics: true, air: { altFtMsl: 41000, iasKt: 250 } });
    cr.run(2);
    // GAP (real: TA/RA in flight, STD above transition): pinned current behaviour.
    expect(cr.vars.get('xpdr.mode')).toBe(1);
    expect(cr.vars.get('adc1.baro_std')).toBe(0);
    const to = makeRig('takeoff', { avionics: true });
    to.run(2);
    expect(to.vars.get('fusion.vspd.v1')).toBe(0); // GAP: takeoff preset has no TOLD / V-speeds
    const ap = makeRig('approach', { avionics: true, air: { altFtMsl: 2500, iasKt: 140 } });
    ap.run(2);
    expect(ap.vars.get('fusion.vspd.vref')).toBe(0); // GAP: approach preset has no VREF
    expect(ap.vars.get('xpdr.mode')).toBe(1);
  });
});
