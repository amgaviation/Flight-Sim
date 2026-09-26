import { describe, expect, it } from 'vitest';
import { rig } from './helpers';
import { B737_VARS } from '../../../src/avionics/boeing-737/vars';

const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const CO = { companyRoutes: { TEBBOS: 'KTEB/24 DIXIE V1 HFD PUT BOS KBOS' } };

/** Loads and activates the TEBBOS company route (KTEB -> KBOS). */
async function activeRoute(r: Awaited<ReturnType<typeof rig>>): Promise<void> {
  r.press('RTE');
  r.enter('TEBBOS', 'L2');
  await wait(120);
  r.step(0.2);
  r.press('R6', 'EXEC');
  r.step(0.3);
}

describe('737NG CDU: scratchpad and page selection', () => {
  it('powers up on IDENT with the model and engine rating; INIT REF from IDENT goes to POS INIT', async () => {
    const r = await rig();
    expect(r.cdu.pageId).toBe('ident');
    const s = r.text();
    expect(s).toContain('IDENT');
    expect(s).toContain('737-800W');
    expect(s).toContain('26K');
    r.press('R6');
    expect(r.cdu.pageId).toBe('pos');
  });

  it('typing, CLR, DEL and +/- follow FCOM scratchpad rules', async () => {
    const r = await rig();
    r.type('ABC');
    expect(r.cdu.scratch).toBe('ABC');
    r.press('CLR');
    expect(r.cdu.scratch).toBe('AB');
    r.press('CLR', 'CLR');
    expect(r.cdu.scratch).toBe('');
    r.press('DEL');
    expect(r.cdu.scratch).toBe('DELETE');
    r.press('CLR');
    expect(r.cdu.scratch).toBe('');
    r.press('+/-');
    expect(r.cdu.scratch).toBe('-');
    r.press('+/-');
    expect(r.cdu.scratch).toBe('+');
  });

  it('an invalid entry shows INVALID ENTRY until CLR, keeping the entry underneath', async () => {
    const r = await rig();
    r.press('INIT_REF', 'L6', 'L3'); // INDEX -> PERF
    expect(r.cdu.pageId).toBe('perfInit');
    r.enter('ABC', 'L5'); // cost index must be numeric
    expect(r.cdu.entryError).toBe('INVALID ENTRY');
    expect(r.screen()[13]).toContain('INVALID ENTRY');
    r.press('CLR');
    expect(r.cdu.entryError).toBe('');
    expect(r.cdu.scratch).toBe('ABC');
  });

  it('each CDU keeps its own page and scratchpad', async () => {
    const r = await rig();
    r.press('RTE');
    r.type('KJFK');
    r.cdu2.key('LEGS');
    expect(r.cdu.pageId).toBe('rte');
    expect(r.cdu2.pageId).toBe('legs');
    expect(r.cdu2.scratch).toBe('');
  });
});

describe('737NG FMC: route entry and the EXEC flow', () => {
  it('RTE: origin / destination / runway, ACTIVATE, EXEC', async () => {
    const r = await rig();
    r.press('RTE');
    r.enter('KTEB', 'L1');
    r.enter('KBOS', 'R1');
    r.enter('24', 'L3');
    expect(r.text()).toContain('ACTIVATE>');
    r.press('NEXT_PAGE');
    r.enter('DIXIE', 'R1');
    r.enter('V1', 'L2');
    r.enter('HFD', 'R2');
    r.press('PREV_PAGE', 'R6');
    expect(r.vars.get(B737_VARS.fmcExecLight)).toBe(1);
    r.press('EXEC');
    r.step(0.5);
    expect(r.vars.get(B737_VARS.fmcExecLight)).toBe(0);
    expect(r.screen()[0]).toContain('ACT RTE 1');
    const legs = r.fmc.plans.active.legs.map((l) => l.fix?.ident);
    expect(legs).toContain('DIXIE');
    expect(legs).toContain('HFD');
    expect(r.fmc.plans.active.destination?.icao).toBe('KBOS');
  });

  it('a modification shows MOD and lights EXEC; ERASE restores the active route', async () => {
    const r = await rig({ companyRoutes: { TEBBOS: 'KTEB/24 DIXIE V1 HFD PUT BOS KBOS' } });
    r.press('RTE');
    r.enter('TEBBOS', 'L2');
    await wait(120);
    r.step(0.2);
    r.press('R6', 'EXEC');
    r.step(0.5);
    const before = r.fmc.plans.active.legs.length;
    r.press('LEGS');
    // Delete the first waypoint line of LEGS page 2 with DEL: modification pending.
    r.press('NEXT_PAGE');
    r.press('DEL', 'L2');
    r.step(0.2);
    expect(r.screen()[0]).toContain('MOD');
    expect(r.vars.get(B737_VARS.fmcExecLight)).toBe(1);
    expect(r.fmc.plans.active.legs.length).toBe(before);
    r.press('L6'); // ERASE
    r.step(0.2);
    expect(r.vars.get(B737_VARS.fmcExecLight)).toBe(0);
    expect(r.screen()[0]).toContain('ACT');
    expect(r.fmc.plans.active.legs.length).toBe(before);
  });

  it('LEGS: direct-to in flight with a MOD route, INTC CRS, EXEC makes it active', async () => {
    const r = await rig({ companyRoutes: { TEBBOS: 'KTEB/24 DIXIE V1 HFD PUT BOS KBOS' } });
    r.press('RTE');
    r.enter('TEBBOS', 'L2');
    await wait(120);
    r.step(0.2);
    r.press('R6', 'EXEC');
    r.vars.set('gear.air_ground', 0);
    r.vars.set('adc1.alt_ft', 12000);
    r.vars.set('adc1.tas_kt', 350);
    r.vars.set('gps.gs_kt', 360);
    r.vars.set('gps.lat_deg', 41.0);
    r.vars.set('gps.lon_deg', -73.55);
    r.step(2);
    r.press('LEGS');
    r.enter('HFD', 'L1');
    expect(r.screen()[0]).toContain('MOD');
    expect(r.text()).toContain('INTC CRS');
    r.press('EXEC');
    r.step(1);
    const p = r.fmc.plans.active;
    expect(p.legs[p.activeLegIndex].fix?.ident).toBe('HFD');
  });
});

describe('737NG FMC: performance pages', () => {
  it('PERF INIT entries are a MOD until EXEC, then feed the FMC outputs', async () => {
    const r = await rig(CO);
    await activeRoute(r);
    r.press('INIT_REF', 'L6', 'L3');
    r.enter('62.5', 'L3');
    r.enter('2.5', 'L4');
    r.enter('45', 'L5');
    r.enter('FL350', 'R1');
    r.step(0.3);
    expect(r.screen()[0]).toContain('MOD PERF INIT');
    expect(r.vars.get(B737_VARS.fmcExecLight)).toBe(1);
    r.press('EXEC');
    r.step(0.3);
    expect(r.vars.get(B737_VARS.fmcExecLight)).toBe(0);
    expect(r.fmc.perf.costIndex).toBe(45);
    expect(r.fmc.perf.crzAltFt).toBe(35000);
    expect(r.vars.get(B737_VARS.fmcCostIndex)).toBe(45);
    expect(r.fmc.zfwKg).toBeCloseTo(62500, -1);
    // GW = ZFW + fuel (8,000 kg in the rig).
    expect(r.fmc.grossWeightKg).toBeCloseTo(70500, -2);
  });

  it('TAKEOFF REF: flaps give QRH speeds, LSK selects them, a CG change deletes them', async () => {
    const r = await rig(CO);
    await activeRoute(r);
    r.press('INIT_REF', 'L6', 'L3');
    r.enter('62.5', 'L3');
    r.enter('2.5', 'L4');
    r.enter('45', 'L5');
    r.enter('FL350', 'R1');
    r.press('EXEC');
    r.press('INIT_REF', 'L6', 'L4'); // INDEX -> TAKEOFF
    expect(r.cdu.pageId).toBe('takeoff');
    r.enter('5', 'L1');
    r.enter('25', 'L3');
    r.step(0.3);
    expect(r.fmc.qrh).not.toBeNull();
    expect(r.text()).toContain('QRH');
    r.press('R1', 'R2', 'R3');
    r.step(0.2);
    expect(r.fmc.v1Sel).toBe(r.fmc.qrh!.v1);
    expect(r.fmc.v2Sel).toBe(r.fmc.qrh!.v2);
    expect(r.vars.get(B737_VARS.fmcV2)).toBe(r.fmc.v2Sel);
    expect(r.text()).toContain('PRE-FLT COMPLETE');
    r.enter('26', 'L3');
    r.step(0.2);
    expect(Number.isNaN(r.fmc.v1Sel)).toBe(true);
    expect(r.text()).toContain('TAKEOFF SPEEDS DELETED');
  });

  it('N1 LIMIT: assumed temperature and derate selection', async () => {
    const r = await rig();
    r.press('N1_LIMIT');
    expect(r.cdu.pageId).toBe('n1');
    r.enter('40', 'L1');
    r.press('L3');
    r.step(0.2);
    expect(r.fmc.toRating).toBe('TO-1');
    expect(r.fmc.selTempC).toBe(40);
    expect(r.text()).toContain('<ACT>');
  });

  it('CLB / CRZ / DES pages show ECON with the cost index', async () => {
    const r = await rig();
    r.press('INIT_REF', 'L6', 'L3');
    r.enter('62.5', 'L3');
    r.enter('45', 'L5');
    r.enter('FL350', 'R1');
    r.press('EXEC');
    r.press('CLB');
    expect(r.screen()[0]).toContain('ECON CLB');
    r.press('CRZ');
    expect(r.screen()[0]).toContain('ECON CRZ');
    r.press('DES');
    expect(r.screen()[0]).toContain('DES');
  });
});

describe('737NG FMC: procedures, hold, fix', () => {
  it('DEP/ARR selects a SID and an approach into the MOD route', async () => {
    const r = await rig({ companyRoutes: { TEBBOS: 'KTEB/24 DIXIE V1 HFD PUT BOS KBOS' } });
    r.press('RTE');
    r.enter('TEBBOS', 'L2');
    await wait(120);
    r.step(0.2);
    r.press('R6', 'EXEC');
    r.press('DEP_ARR', 'L1');
    await wait();
    r.step(0.2);
    r.screen();
    await wait();
    r.step(0.2);
    expect(r.text()).toContain('DEPARTURES');
    r.press('L1');
    await wait();
    r.step(0.2);
    expect(r.text()).toContain('<SEL>');
    r.press('EXEC');
    r.step(0.3);
    expect(r.fmc.plans.active.sid).toBeTruthy();
  });

  it('HOLD at a route fix creates a hold leg after EXEC', async () => {
    const r = await rig({ companyRoutes: { TEBBOS: 'KTEB/24 DIXIE V1 HFD PUT BOS KBOS' } });
    r.press('RTE');
    r.enter('TEBBOS', 'L2');
    await wait(120);
    r.step(0.2);
    r.press('R6', 'EXEC');
    r.press('HOLD');
    r.enter('HFD', 'L6');
    r.step(0.2);
    expect(r.screen()[0]).toContain('HOLD');
    r.press('EXEC');
    r.step(0.3);
    expect(r.fmc.plans.active.legs.some((l) => l.type === 'HM' || l.type === 'HA' || l.type === 'HF')).toBe(true);
  });

  it('FIX INFO accepts a fix and radial / distance', async () => {
    const r = await rig();
    r.press('FIX');
    r.enter('LGA', 'L1');
    r.enter('090', 'L2');
    expect(r.fmc.fixInfo[0]?.ident).toBe('LGA');
    expect(r.text()).toContain('FIX INFO');
    expect(r.text()).toContain('090');
  });

  it('FMC failure blanks the CDUs, lights FAIL and ignores keys', async () => {
    const r = await rig();
    r.vars.set('fail.b737.fmc', 1);
    r.step(0.1);
    expect(r.vars.get(B737_VARS.cduFailLight(1))).toBe(1);
    expect(r.text().trim()).toBe('');
    r.press('RTE');
    expect(r.cdu.pageId).toBe('ident');
  });
});
