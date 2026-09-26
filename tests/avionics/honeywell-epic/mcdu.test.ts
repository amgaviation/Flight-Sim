import { beforeAll, describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { GPS, NAV } from '../../../src/core/vars';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';
import { Fms } from '../../../src/nav/fms/Fms';
import { FmsShared, Mcdu, EPIC_CDU_PAGES, EPIC_KEY_PAGES, parseAltitude, parseComFreq, parseLatLon, parseSpeedPair, parseSquawk } from '../../../src/avionics/honeywell-epic/fms';
import { resolveConfig, BR725_ENGINES, G650_AIRFRAME } from '../../../src/avionics/honeywell-epic/config';
import { EPIC_EVENTS, EPIC_VARS } from '../../../src/avionics/honeywell-epic/vars';

const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
beforeAll(async () => {
  await db.load();
}, 60_000);

function setup() {
  const vars = new SimVars();
  const events = new EventBus();
  vars.set(GPS.valid, 1);
  vars.set(GPS.lat, 40.85);
  vars.set(GPS.lon, -74.06);
  vars.set(GPS.gs, 0);
  const fms = new Fms({ vars, events, nav: db }, { style: 'boeing', engineCount: 2 });
  const shared = new FmsShared(vars, events, fms, db, resolveConfig({ variant: 'planeview2', airframe: G650_AIRFRAME, engines: BR725_ENGINES }));
  const mcdus = [1, 2, 3].map((n) => new Mcdu(n, shared, EPIC_CDU_PAGES, EPIC_KEY_PAGES));
  const step = (s = 0.2) => {
    fms.update(s);
    for (const m of mcdus) m.update(s);
  };
  return { vars, events, fms, shared, mcdus, m: mcdus[0], step };
}

function type(m: Mcdu, s: string): void {
  for (const ch of s) m.key(ch === ' ' ? 'SP' : ch);
}

async function settle(step: () => void, ms = 50): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, ms / 10));
    step();
  }
}

describe('MCDU entry parsing', () => {
  it('parses altitudes, speeds, frequencies, codes and positions', () => {
    expect(parseAltitude('FL350')).toBe(35000);
    expect(parseAltitude('350')).toBe(35000);
    expect(parseAltitude('12500')).toBe(12500);
    expect(parseSpeedPair('250/.80')).toEqual({ kt: 250, mach: 0.8 });
    expect(parseComFreq('11850')).toBeCloseTo(118.5, 3);
    expect(parseComFreq('137.1')).toBeNaN();
    expect(parseSquawk('7700')).toBe(7700);
    expect(parseSquawk('7780')).toBeNaN();
    const p = parseLatLon('N4030.5W07350.2')!;
    expect(p.lat).toBeCloseTo(40.508, 3);
    expect(p.lon).toBeCloseTo(-73.837, 3);
  });
});

describe('MCDU flight plan flow (Honeywell MOD / ACTIVATE)', () => {
  it('origin / destination entry creates a MOD plan that ACTIVATE makes active; CANCEL MOD discards', () => {
    const t = setup();
    t.step();
    expect(t.m.page.id).toBe('FPL');
    type(t.m, 'KTEB');
    t.m.key('L1');
    t.step();
    expect(t.m.screen.title).toBe('MOD FLT PLAN');
    expect(t.vars.get(EPIC_VARS.mcduMod)).toBe(1);
    type(t.m, 'KBOS');
    t.m.key('R1');
    t.step();
    expect(t.m.screen.rowText(2)).toContain('KTEB');
    expect(t.m.screen.rowText(2)).toContain('KBOS');
    // Every MCDU shows the same (shared) MOD plan.
    expect(t.mcdus[2].screen.title).toBe('MOD FLT PLAN');
    t.m.key('R6'); // ACTIVATE>
    t.step();
    expect(t.fms.plans.active.origin?.icao).toBe('KTEB');
    expect(t.fms.plans.active.destination?.icao).toBe('KBOS');
    expect(t.m.screen.title).toBe('ACTIVE FLT PLAN');
    // Insert a waypoint, then cancel the modification.
    type(t.m, 'SAX');
    t.m.key('L2');
    t.step();
    expect(t.shared.modPending).toBe(true);
    t.m.key('L6'); // <CANCEL MOD
    t.step();
    expect(t.shared.modPending).toBe(false);
    expect(t.fms.plans.active.legs.some((l) => l.fix?.ident === 'SAX')).toBe(false);
  });

  it('unknown idents give NOT IN DATABASE in the scratchpad and keep the entry', () => {
    const t = setup();
    type(t.m, 'ZZZZ');
    t.m.key('L1');
    t.step();
    expect(t.m.screen.scratch).toBe('NOT IN DATABASE');
    t.m.key('CLR');
    t.step();
    expect(t.m.screen.scratch).toBe('ZZZZ');
  });

  it('DIR TO a waypoint of the plan from the DIR page', async () => {
    const t = setup();
    await t.fms.loadRoute('KTEB SAX PTW KBOS');
    t.events.emit('fms.exec');
    t.step();
    t.m.key('DIR');
    t.step();
    type(t.m, 'SAX');
    t.m.key('L1');
    t.step();
    expect(t.m.page.id).toBe('FPL');
    expect(t.shared.modPending).toBe(true); // Honeywell: the direct-to is a modification
    expect(t.fms.plans.displayed.activeLeg?.fix?.ident).toBe('SAX');
    expect(t.fms.plans.displayed.activeLeg?.type).toBe('DF');
    t.m.key('R6'); // ACTIVATE>
    t.step();
    expect(t.shared.modPending).toBe(false);
    expect(t.fms.plans.active.activeLeg?.fix?.ident).toBe('SAX');
  });

  it('selects an approach on the ARRIVAL page (procedures load asynchronously)', async () => {
    const t = setup();
    await t.fms.loadRoute('KTEB SAX KBOS');
    t.events.emit('fms.exec');
    t.step();
    t.m.key('FPL');
    t.m.key('L6'); // <DEP/ARR
    t.step();
    expect(t.m.page.id).toBe('DEPARR');
    t.m.key('R1'); // ARRIVE>
    t.step();
    expect(t.m.page.id).toBe('ARRIVE');
    await settle(t.step, 400);
    t.step();
    const procs = t.shared.procedures('KBOS');
    expect(procs && procs.approaches.length).toBeGreaterThan(0);
    t.m.key('L1'); // first approach
    t.step();
    // Transition list (or straight to the flight plan when there is none).
    if (t.m.page.id === 'ARRIVE') t.m.key('L1'); // VECTORS
    t.step();
    expect(t.fms.plans.displayed.approach).not.toBeNull();
    expect(t.shared.modPending).toBe(true);
  });
});

describe('MCDU radio and performance pages', () => {
  it('RADIO page: preset entry, swap, transponder code and mode', () => {
    const t = setup();
    t.m.key('RADIO');
    t.step();
    expect(t.m.screen.title).toBe('RADIO');
    type(t.m, '124.35');
    t.m.key('L2');
    expect(t.vars.get(NAV.comStandby(1))).toBeCloseTo(124.35, 3);
    t.vars.set(NAV.comActive(1), 121.5);
    t.m.key('L1'); // empty scratchpad: swap
    expect(t.vars.get(NAV.comActive(1))).toBeCloseTo(124.35, 3);
    expect(t.vars.get(NAV.comStandby(1))).toBeCloseTo(121.5, 3);
    type(t.m, '4521');
    t.m.key('L6');
    expect(t.vars.get(NAV.xpdrCode)).toBe(4521);
    t.vars.set(NAV.xpdrMode, 1);
    t.m.key('R6');
    expect(t.vars.get(NAV.xpdrMode)).toBe(3);
    // RADIO 2/2 via NEXT: HF 1.
    t.m.key('NEXT');
    type(t.m, '8891');
    t.m.key('L1');
    expect(t.vars.get(EPIC_VARS.hfFreq(1))).toBe(8891);
  });

  it('PERF INIT: speeds, cruise altitude, weights and CONFIRM INIT', () => {
    const t = setup();
    t.m.key('PERF');
    t.step();
    expect(t.m.page.id).toBe('PERF_INDEX');
    t.m.show('PERF_INIT');
    type(t.m, '270/.82');
    t.m.key('L2');
    expect(t.shared.perf.climbKt).toBe(270);
    expect(t.shared.perf.climbMach).toBeCloseTo(0.82, 5);
    type(t.m, 'FL450');
    t.m.key('R3');
    expect(t.shared.perf.cruiseAltFt).toBe(45000);
    t.m.key('NEXT');
    type(t.m, '54000');
    t.m.key('L1');
    type(t.m, '1600');
    t.m.key('L3');
    t.m.key('NEXT');
    t.m.key('R6');
    t.step();
    expect(t.shared.perf.confirmed).toBe(true);
    expect(t.vars.get('epic.fms.perf_init')).toBe(1);
    expect(t.m.screen.text().join('\n')).toContain('PERF INIT COMPLETE');
  });

  it('keys arrive through the suite events and every page renders', () => {
    const t = setup();
    t.events.emit(EPIC_EVENTS.mcduKey(2), 'PROG');
    t.step();
    expect(t.mcdus[1].page.id).toBe('PROG');
    for (const p of EPIC_CDU_PAGES) {
      t.m.show(p.id);
      t.step();
      expect(t.m.screen.title.length, p.id).toBeGreaterThan(0);
    }
  });
});
