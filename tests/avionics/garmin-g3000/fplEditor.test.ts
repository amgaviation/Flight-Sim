import { beforeAll, describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { GPS, NAV } from '../../../src/core/vars';
import { Fms } from '../../../src/nav/fms/Fms';
import type { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { FplEditor } from '../../../src/avionics/garmin-g3000/state/FplEditor';
import { loadDb, makeRig } from './helpers';

let db: NavDatabaseImpl;
beforeAll(async () => {
  db = await loadDb();
}, 90000);

/** Enroute waypoint: prefer navaids / fixes over same-ident airports (HFD VOR vs KHFD). */
function wpt(fpl: FplEditor, id: string) {
  const all = fpl.resolve(id);
  return all.find((w) => w.kind !== 'airport') ?? all[0];
}

function editor(): { vars: SimVars; fms: Fms; fpl: FplEditor } {
  const vars = new SimVars();
  vars.set(GPS.valid, 1);
  vars.set(GPS.lat, 40.85);
  vars.set(GPS.lon, -74.06);
  vars.set(GPS.gs, 150);
  const fms = new Fms({ vars, nav: db }, { style: 'garmin' });
  return { vars, fms, fpl: new FplEditor(fms, db, vars) };
}

describe('FplEditor: building a plan', () => {
  it('origin, destination, enroute waypoints, insert before / after, remove', () => {
    const { fpl } = editor();
    expect(fpl.setOrigin('KTEB')).toBe(true);
    expect(fpl.setDestination('KBOS')).toBe(true);
    expect(fpl.setOrigin('XXXX')).toBe(false);
    for (const id of ['MERIT', 'HFD', 'PUT']) fpl.appendEnroute(wpt(fpl, id));
    const idents = () => fpl.plan.legs.map((l) => l.fix?.ident);
    expect(idents()).toEqual(['KTEB', 'MERIT', 'HFD', 'PUT', 'KBOS']);
    // Insert before HFD and after PUT.
    const hfd = fpl.plan.legs.findIndex((l) => l.fix?.ident === 'HFD');
    fpl.insertWaypoint(hfd, wpt(fpl, 'BDR'));
    const put = fpl.plan.legs.findIndex((l) => l.fix?.ident === 'PUT');
    fpl.insertWaypoint(put, wpt(fpl, 'ORW'), true);
    expect(idents()).toEqual(['KTEB', 'MERIT', 'BDR', 'HFD', 'PUT', 'ORW', 'KBOS']);
    // Never before the origin or after the destination.
    fpl.insertWaypoint(0, wpt(fpl, 'SAX'));
    expect(idents()[0]).toBe('KTEB');
    fpl.deleteLeg(fpl.plan.legs.findIndex((l) => l.fix?.ident === 'SAX'));
    fpl.deleteLeg(fpl.plan.legs.findIndex((l) => l.fix?.ident === 'BDR'));
    expect(idents()).toEqual(['KTEB', 'MERIT', 'HFD', 'PUT', 'ORW', 'KBOS']);
    // A first leg is active once the plan exists.
    expect(fpl.plan.activeLegIndex).toBeGreaterThan(0);
  });

  it('rows: origin, headers, legs, destination; altitude constraints marked crew-entered', () => {
    const { fpl } = editor();
    fpl.setOrigin('KTEB');
    fpl.appendEnroute(wpt(fpl, 'MERIT'));
    fpl.setDestination('KBOS');
    const i = fpl.plan.legs.findIndex((l) => l.fix?.ident === 'MERIT');
    expect(fpl.setAltitudeConstraint(i, 'atOrAbove', 11000)).toBe(true);
    const leg = fpl.plan.legs[i];
    expect(leg.altitude).toEqual({ kind: 'atOrAbove', lowerFt: 11000 });
    expect(leg.userConstraint).toBe(true);
    const rows = fpl.rows();
    expect(rows[0].kind).toBe('origin');
    expect(rows.some((r) => r.kind === 'header' && r.text === 'Enroute')).toBe(true);
    expect(rows[rows.length - 1].kind).toBe('destination');
    fpl.setAltitudeConstraint(i, null);
    expect(fpl.plan.legs[i].altitude).toBeUndefined();
  });

  it('loads an airway from a waypoint to an exit fix', () => {
    const { fpl } = editor();
    fpl.setOrigin('KTEB');
    const entry = wpt(fpl, 'MERIT');
    fpl.appendEnroute(entry);
    fpl.setDestination('KBOS');
    const airways = fpl.airwaysAt('MERIT');
    expect(airways.length).toBeGreaterThan(0);
    const aw = airways[0];
    const exits = fpl.airwayExits(aw, entry);
    expect(exits.length).toBeGreaterThan(1);
    const exit = exits[Math.min(2, exits.length - 1)];
    const i = fpl.plan.legs.findIndex((l) => l.fix?.ident === 'MERIT');
    const before = fpl.plan.legs.length;
    expect(fpl.loadAirway(i, aw, exit)).toBe(true);
    expect(fpl.plan.legs.length).toBeGreaterThan(before);
    expect(fpl.plan.legs.some((l) => l.fix?.ident === exit && l.airway === aw)).toBe(true);
  });

  it('procedures: departure, arrival and an ILS approach (localizer auto-tune callback)', async () => {
    const { fpl } = editor();
    fpl.setOrigin('KTEB');
    fpl.setDestination('KBOS');
    const teb = await fpl.loadProcedures('KTEB');
    const bos = await fpl.loadProcedures('KBOS');
    expect(teb && bos).toBeTruthy();
    if (teb!.sids.length) {
      const sid = teb!.sids[0];
      const rw = sid.runwayTransitions.find((t) => t.name !== 'ALL')?.name;
      expect(fpl.loadDeparture(sid.ident, rw)).toBe(true);
      expect(fpl.plan.sid?.ident).toBe(sid.ident);
    }
    if (bos!.stars.length) {
      expect(fpl.loadArrival(bos!.stars[0].ident)).toBe(true);
      expect(fpl.plan.star?.ident).toBe(bos!.stars[0].ident);
    }
    const ils = bos!.approaches.find((a) => a.approachType === 'ILS')!;
    expect(ils).toBeTruthy();
    let tuned = 0;
    fpl.onApproachLoaded = (p) => (tuned = p.navFrequencyMhz ?? 0);
    expect(fpl.loadApproach('KBOS', ils.ident)).toBe(true);
    expect(fpl.approachIsLoc()).toBe(true);
    expect(tuned).toBeGreaterThan(108);
    expect(fpl.rows().some((r) => r.kind === 'header' && r.text.startsWith('Approach - KBOS'))).toBe(true);
    fpl.removeApproach();
    expect(fpl.plan.approachProcedure).toBeFalsy();
  });

  it('direct-to, activate leg, delete plan', () => {
    const { fpl } = editor();
    fpl.setOrigin('KTEB');
    for (const id of ['MERIT', 'HFD']) fpl.appendEnroute(wpt(fpl, id));
    fpl.setDestination('KBOS');
    const hfd = fpl.plan.legs.findIndex((l) => l.fix?.ident === 'HFD');
    expect(fpl.activateLeg(hfd)).toBe(true);
    expect(fpl.plan.activeLegIndex).toBe(hfd);
    expect(fpl.directTo(wpt(fpl, 'PUT'))).toBe(true);
    const act = fpl.plan.legs[fpl.plan.activeLegIndex];
    expect(act.fix?.ident).toBe('PUT');
    expect(act.type).toBe('DF');
    fpl.deletePlan();
    expect(fpl.plan.legs.length).toBe(0);
    expect(fpl.plan.origin).toBeFalsy();
  });
});

describe('Approach loading through the suite auto-tunes the localizer', () => {
  it('NAV1 / NAV2 active frequency and course follow the ILS', async () => {
    const rig = makeRig(db);
    rig.place(42.2, -71.2, 3000, 40);
    const fpl = rig.suite.system.fpl!;
    fpl.setOrigin('KTEB');
    fpl.setDestination('KBOS');
    const bos = await fpl.loadProcedures('KBOS');
    const ils = bos!.approaches.find((a) => a.approachType === 'ILS')!;
    fpl.loadApproach('KBOS', ils.ident);
    expect(rig.vars.get(NAV.activeFreq(1))).toBeCloseTo(ils.navFrequencyMhz!, 2);
    expect(rig.vars.get(NAV.activeFreq(2))).toBeCloseTo(ils.navFrequencyMhz!, 2);
    expect(rig.vars.get(NAV.obs(1))).toBeGreaterThan(0);
  });
});
