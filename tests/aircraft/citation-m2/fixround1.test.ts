/**
 * Citation M2 fix round 1 (layout lens): behaviour that came with the layout
 * fixes. Each test fails without its fix.
 *  - GCU 275 (M2-L01): keys / FMS knob / RANGE push + joystick drive the PFD
 *    windows, Direct-To and the inset pointer;
 *  - STBY FLT DISPLAY switch (M2-PROC-05); BATTERY DISCONNECT (PROC-15);
 *    FUEL BOOST OFF (PROC-11); AIR SOURCE BOTH / FRESH AIR (PROC-12);
 *    EMER LTS switch (PROC-16);
 *  - glareshield NORM / REV rotaries and the TOUCH CONTROLS dimmer (L03/L04),
 *    PANELS DAY detent; armrest PTT -> COM TX (L35); gear-handle lamp (L22);
 *  - checklists updated (L18, L26, L29, PROC-*).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadNav, makeM2 } from './helpers';
import { FMS, GPS } from '../../../src/core/vars';
import type { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { M2, PRESS_SRC, TLA } from '../../../src/aircraft/citation-m2/vars';
import { M2_CHECKLISTS } from '../../../src/aircraft/citation-m2/checklists';
import { G3K, G3K_EVENTS, GCU_WINDOW } from '../../../src/avionics/garmin-g3000/vars';
import { M2_SIDE_VARS } from '../../../src/aircraft/citation-m2/cockpit/side/services';
import { buildM2Cockpit } from '../../../src/aircraft/citation-m2/cockpit';

let db: NavDatabaseImpl;
beforeAll(async () => {
  db = await loadNav();
}, 90000);

describe('Citation M2 fix round 1: GCU 275', () => {
  it('FPL / FMS knob / DTO + ENT fly direct to the cursor waypoint; PROC, CLR, COM/NAV, RANGE push, joystick', () => {
    const r = makeM2({ state: 'ready_to_taxi', nav: db });
    const v = r.vars;
    const sys = r.sys.suite.system;
    for (let i = 0; i < 120 && v.get(GPS.valid) < 0.5; i++) r.run(1); // GPS position (direct-to needs it)
    expect(v.get(GPS.valid)).toBe(1);
    const fpl = sys.fpl!;
    expect(fpl.setOrigin('KTEB')).toBe(true);
    for (const id of ['SAX', 'LVZ', 'ETX']) {
      const w = fpl.resolve(id)[0];
      expect(w, id).toBeTruthy();
      fpl.appendEnroute(w);
    }
    expect(fpl.setDestination('KABE')).toBe(true);
    r.run(0.2);
    const active0 = sys.fms!.plans.active.activeLegIndex;
    // FPL key opens the flight plan window; the small FMS knob moves the cursor.
    r.events.emit(G3K_EVENTS.gcuKey(1, 'FPL'));
    expect(v.get(G3K.gcuWindow(1))).toBe(GCU_WINDOW.fpl);
    r.events.emit(G3K_EVENTS.gcuFmsPush(1)); // cursor on (active leg)
    expect(v.get(G3K.gcuCursor(1))).toBeGreaterThanOrEqual(0);
    const legs = sys.fms!.plans.active.legs;
    const target = legs.findIndex((l) => l.fix?.ident === 'ETX');
    expect(target).toBeGreaterThan(0);
    const c0 = v.get(G3K.gcuCursor(1));
    r.events.emit(`${G3K_EVENTS.gcuFmsInner(1)}_inc`, target - c0);
    expect(v.get(G3K.gcuCursor(1))).toBe(target);
    // Direct-To on the cursor waypoint, ENT activates it.
    r.events.emit(G3K_EVENTS.gcuKey(1, 'DTO'));
    expect(v.get(G3K.gcuWindow(1))).toBe(GCU_WINDOW.dto);
    r.events.emit(G3K_EVENTS.gcuKey(1, 'ENT'));
    r.run(0.2);
    expect(v.get(G3K.gcuWindow(1))).toBe(GCU_WINDOW.none);
    expect(v.getString(FMS.nextWptIdent)).toBe('ETX');
    expect(sys.fms!.plans.active.activeLegIndex).not.toBe(active0);
    // PROC window (no approach loaded: ENT does nothing), CLR closes it.
    r.events.emit(G3K_EVENTS.gcuKey(2, 'PROC'));
    expect(v.get(G3K.gcuWindow(2))).toBe(GCU_WINDOW.proc);
    r.events.emit(G3K_EVENTS.gcuKey(2, 'ENT'));
    expect(v.get(G3K.gcuWindow(2))).toBe(GCU_WINDOW.proc);
    r.events.emit(G3K_EVENTS.gcuKey(2, 'CLR'));
    expect(v.get(G3K.gcuWindow(2))).toBe(GCU_WINDOW.none);
    // COM/NAV: the FMS knob tunes the COM1 standby, push swaps.
    const stby0 = sys.comStandby(1);
    const act0 = sys.comActive(1);
    r.events.emit(G3K_EVENTS.gcuKey(1, 'COMNAV'));
    r.events.emit(`${G3K_EVENTS.gcuFmsOuter(1)}_inc`, 1);
    expect(sys.comStandby(1)).toBeCloseTo(stby0 + 1, 3);
    r.events.emit(G3K_EVENTS.gcuFmsPush(1));
    expect(sys.comActive(1)).toBeCloseTo(stby0 + 1, 3);
    expect(sys.comStandby(1)).toBeCloseTo(act0, 3);
    // RANGE turn / push / joystick: inset range and pointer.
    const rng0 = v.get(G3K.pfdMapRange(1));
    r.events.emit(`${G3K_EVENTS.rangeTurn(1)}_inc`, 1);
    expect(v.get(G3K.pfdMapRange(1))).toBeGreaterThan(rng0);
    r.events.emit(G3K_EVENTS.rangePush(1));
    expect(v.get(G3K.insetPan(1))).toBe(1);
    r.events.emit(G3K_EVENTS.gcuJoystick(1), { x: 1, y: 0 });
    expect(sys.insetPointers[1].dx).toBeGreaterThan(0);
    r.events.emit(G3K_EVENTS.rangePush(1));
    expect(v.get(G3K.insetPan(1))).toBe(0);
    // BARO knob on the GCU: existing baro events.
    const b0 = v.get('adc1.baro_inhg', 29.92);
    r.events.emit(`${G3K_EVENTS.baroTurn(1)}_inc`, 1);
    expect(v.get('adc1.baro_inhg')).toBeCloseTo(b0 + 0.01, 3);
  });

  it('the cockpit GCU controls emit the GCU events (RANGE joystick knob, key pads, FMS knob)', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const ck = buildM2Cockpit(r.ctx);
    const ids = ck.build.controls.map((c) => c.id);
    for (const s of [1, 2]) for (const k of ['range', 'clr_ent', 'fms', 'keys', 'baro']) expect(ids).toContain(`m2.gcu${s}.${k}`);
    expect(ids).not.toContain('m2.dcu1.mins');
  });
});

describe('Citation M2 fix round 1: electrical / standby', () => {
  it('STBY FLT DISPLAY: OFF keeps the ESI and its battery off; ON uses the bus, then the battery; TEST runs on the battery', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(1);
    expect(v.get(M2.stbyDispSw)).toBe(1);
    expect(v.get(M2.esiPowered)).toBe(1);
    expect(v.get('ac.m2.esi_on_batt')).toBe(0);
    v.set(M2.stbyDispSw, 2); // TEST
    r.run(0.5);
    expect(v.get(M2.esiPowered)).toBe(1);
    expect(v.get(M2.stbyBattLight)).toBe(1);
    v.set(M2.stbyDispSw, 1);
    r.run(0.5);
    expect(v.get(M2.stbyBattLight)).toBe(0);
    // Shutdown: throttles OFF, avionics and battery off -> ESI on its own battery while ON ...
    for (const i of [1, 2]) v.set(M2.tla(i), TLA.cutoff);
    v.set(M2.avionicsSw, 0);
    r.run(40);
    v.set(M2.battSw, 0);
    for (const i of [1, 2]) v.set(M2.genSw(i), 0);
    r.run(5);
    expect(v.get('elec.emer_powered')).toBe(0);
    expect(v.get(M2.esiPowered)).toBe(1);
    expect(v.get('ac.m2.esi_on_batt')).toBe(1);
    // ... and off with the switch OFF (shutdown flow).
    v.set(M2.stbyDispSw, 0);
    r.run(600);
    expect(v.get(M2.esiPowered)).toBe(0);
    expect(v.get('ac.m2.esi_on_batt')).toBe(0);
  });

  it('BATTERY DISCONNECT: DISC isolates the battery (no voltage with BATT on); NORM restores 24 V; the relay coil drains it slowly', () => {
    const r = makeM2({ state: 'cold_dark' });
    const v = r.vars;
    r.run(1);
    v.set(M2.battDisc, 1);
    v.set(M2.battSw, 1);
    r.run(2);
    expect(v.get('elec.batt_bus_v')).toBeLessThan(5);
    expect(v.get('elec.emer_powered')).toBe(0);
    expect(v.get('elec.batt_amps')).toBeLessThan(-0.2); // coil current out of the battery (discharge sign)
    v.set(M2.battDisc, 0);
    r.run(2);
    expect(v.get('elec.batt_bus_v')).toBeGreaterThanOrEqual(24);
    expect(v.get('elec.emer_powered')).toBe(1);
    // Cockpit preparation items tick in order.
    const prep = M2_CHECKLISTS.find((c) => c.title === 'Cockpit preparation')!;
    const disc = prep.items.filter((i) => i.challenge.startsWith('Battery disconnect'));
    expect(disc.length).toBe(2);
    expect(disc[1].check!(v)).toBe(true);
    expect(prep.items.some((i) => i.challenge === 'STBY FLT DISPLAY switch')).toBe(true);
  });

  it('EMER LTS switch: OFF never lights; ARMED lights on loss of emergency-bus power; states arm it', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const ck = buildM2Cockpit(r.ctx);
    const v = r.vars;
    const svc = ck.systems.find((s) => s.name === 'm2.cabin_services')!;
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        r.run(1 / 60);
        svc.update(1 / 60);
      }
    };
    step(30);
    expect(v.get(M2.emerLtsSw)).toBe(1);
    expect(v.get(M2_SIDE_VARS.emerLights)).toBe(0);
    for (const i of [1, 2]) v.set(M2.tla(i), TLA.cutoff);
    v.set(M2.battSw, 0);
    for (const i of [1, 2]) v.set(M2.genSw(i), 0);
    step(60 * 40);
    expect(v.get('elec.emer_powered')).toBe(0);
    expect(v.get(M2_SIDE_VARS.emerLights)).toBe(1);
    v.set(M2.emerLtsSw, 0);
    step(10);
    expect(v.get(M2_SIDE_VARS.emerLights)).toBe(0);
  });
});

describe('Citation M2 fix round 1: fuel / air source', () => {
  it('FUEL BOOST OFF de-energizes the pump even for an engine start; NORM runs it automatically', () => {
    const r = makeM2({ state: 'cold_dark' });
    const v = r.vars;
    v.set(M2.controlLock, 0);
    v.set(M2.battSw, 1);
    v.set(M2.boostSw(2), -1);
    r.run(2);
    v.set(M2.startBtn(2), 1);
    r.run(0.3);
    v.set(M2.startBtn(2), 0);
    r.run(3);
    expect(v.get('fadec.eng2.start_state')).toBeGreaterThan(0);
    expect(v.get('fuel.boost_r_on')).toBe(0);
    v.set(M2.boostSw(2), 0);
    r.run(0.5);
    expect(v.get('fuel.boost_r_on')).toBe(1);
  });

  it('AIR SOURCE: BOTH is the normal state; FRESH AIR stops the cabin inflow and the cabin depressurizes', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 25000, iasKt: 240, headingTrue: 90 } });
    const v = r.vars;
    r.run(5);
    expect(v.get(M2.pressSource)).toBe(PRESS_SRC.both);
    const dp0 = v.get('press.diff_psi');
    expect(dp0).toBeGreaterThan(5);
    v.set(M2.pressSource, PRESS_SRC.fresh);
    r.run(120);
    expect(v.get('pneu.pack_flow_kgs')).toBeLessThan(0.001);
    expect(v.get('press.diff_psi')).toBeLessThan(dp0 - 2);
    const smoke = M2_CHECKLISTS.find((c) => c.title === 'ENVIRONMENTAL SMOKE OR ODOR')!;
    expect(smoke.items.some((i) => i.response.startsWith('FRESH AIR') && i.check!(v))).toBe(true);
    const bt = M2_CHECKLISTS.find((c) => c.title === 'Before taxi')!;
    expect(bt.items.some((i) => i.challenge === 'Air source select' && i.response === 'BOTH')).toBe(true);
  });
});

describe('Citation M2 fix round 1: glareshield / cockpit logic', () => {
  it('DISPLAY REV PILOT reverts PFD1 (MFD instead when PFD1 has failed); TOUCH CONTROLS dims only the GTCs; PANELS DAY', () => {
    const r = makeM2({ state: 'ready_to_taxi' });
    const v = r.vars;
    r.run(1);
    v.set(G3K.reversionSwitch('pfd1'), 1);
    r.run(0.2);
    expect(v.get(G3K.reversionary('pfd1'))).toBe(1);
    v.set('fail.g3k.pfd1', 1);
    r.run(0.3);
    expect(v.get(G3K.reversionSwitch('mfd'))).toBe(1);
    expect(v.get(G3K.reversionary('mfd'))).toBe(1);
    v.set('fail.g3k.pfd1', 0);
    v.set(G3K.reversionSwitch('pfd1'), 0);
    r.run(0.3);
    // Separate DISPLAYS / TOUCH CONTROLS dimmers.
    v.set(M2.displayDim, 0.5);
    v.set(M2.gtcDim, 0.2);
    r.run(0.1);
    expect(v.get('display.pfd1.brt')).toBeCloseTo(0.5, 3);
    expect(v.get('display.gtc1.brt')).toBeCloseTo(0.2, 3);
    // PANELS dimmed: annunciators DIM; at the DAY stop full bright.
    v.set(M2.panelLt, 0.5);
    r.run(0.5);
    expect(v.get('ac.light.annun')).toBeLessThan(0.6);
    v.set(M2.panelLt, 1);
    r.run(0.5);
    expect(v.get('ac.light.annun')).toBeGreaterThan(0.9);
  });

  it('armrest PTT keys the on-side COM (TX); gear handle lamp lights red with the gear in transit', () => {
    const r = makeM2({ state: 'cruise', air: { altFtMsl: 8000, iasKt: 170, headingTrue: 90 } });
    const v = r.vars;
    r.run(1);
    v.set(M2.ptt(1), 1);
    r.run(0.1);
    expect(v.get(G3K.comTx(1))).toBe(1);
    expect(v.get(G3K.comTx(2))).toBe(0);
    v.set(M2.ptt(1), 0);
    r.run(0.1);
    expect(v.get(G3K.comTx(1))).toBe(0);
    v.set(M2.gearHandle, 1);
    r.run(1);
    expect(v.get('ac.m2.gear_unsafe_lt')).toBe(1);
    r.run(8);
    expect(v.get('ac.m2.gear_unsafe_lt')).toBe(0);
    expect(v.get('gear.green0')).toBe(1);
  });

  it('checklists: throttles OFF (quadrant legend), ignition on the GTC, system tests on the GTC, shutdown switches OFF', () => {
    const all = M2_CHECKLISTS.flatMap((c) => c.items.map((i) => `${i.challenge} | ${i.response}`));
    expect(all.some((s) => s.includes('CUTOFF'))).toBe(false);
    expect(all).toContain('Throttles | OFF');
    expect(all).toContain('Ignition (GTC ENGINE page) | NORM');
    expect(all.some((s) => s.startsWith('System tests (GTC)'))).toBe(true);
    expect(all.some((s) => s.includes('SYSTEM TEST:'))).toBe(false);
    const sd = M2_CHECKLISTS.find((c) => c.title === 'Shutdown')!.items.map((i) => i.challenge);
    expect(sd).toContain('STBY FLT DISPLAY switch');
    expect(sd).toContain('EMERGENCY LIGHTS switch');
    const fire = M2_CHECKLISTS.find((c) => c.title === 'ENGINE FIRE')!;
    expect(fire.items.some((i) => i.response === 'LIFT COVER and PUSH')).toBe(true);
  });
});

describe('Citation M2 fix round 1: ENG FIRE cover', () => {
  it('ENG FIRE is a guarded push button: the first click lifts the cover, the button pushes only with it open', async () => {
    const THREE = await import('three');
    const { GuardedButton } = await import('../../../src/cockpit/controls');
    const r = makeM2({ state: 'ready_to_taxi' });
    const ck = buildM2Cockpit(r.ctx);
    ck.build.root.updateMatrixWorld(true);
    const c = ck.build.controls.find((k) => k.id === 'm2.engfire1')!;
    expect(c instanceof GuardedButton).toBe(true);
    const click = (obj: import('three').Object3D) => {
      const point = new THREE.Vector3();
      obj.getWorldPosition(point);
      const p = { button: 0 as const, shift: false, ctrl: false, alt: false, point, object: obj };
      c.onPointerDown?.(p);
      for (let i = 0; i < 4; i++) c.update?.(0.05);
      c.onPointerUp?.(p);
      for (let i = 0; i < 10; i++) c.update?.(0.05);
    };
    // Every hit target clicked once with the cover closed: only the cover opens.
    const guardHit = c.hitTargets[c.hitTargets.length - 1];
    click(guardHit);
    expect(r.vars.get(M2.engFireBtn(1))).toBe(0);
    // With the cover open, the button pushes (alternate action -> armed).
    for (const t of c.hitTargets) {
      if (r.vars.get(M2.engFireBtn(1)) !== 0) break;
      click(t);
    }
    expect(r.vars.get(M2.engFireBtn(1))).toBe(1);
  });
});
