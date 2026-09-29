import { describe, it, expect, beforeAll } from 'vitest';
import { SimVars } from '../../src/core/SimVars';
import { EventBus } from '../../src/core/EventBus';
import { FMS } from '../../src/core/vars';
import { destinationPoint, distanceNm } from '../../src/core/geo';
import { Fms, FMS_EVENTS } from '../../src/nav/fms/Fms';
import { FlightPlan, makeLeg } from '../../src/nav/flightplan/FlightPlan';
import { computePlanGeometry } from '../../src/nav/flightplan/geometry';
import { computeDescentProfile, profileAltitudeAt, descentDistanceNm, FT_PER_NM } from '../../src/nav/fms/VnavPath';
import { holdEntryFor } from '../../src/nav/fms/HoldGuidance';
import { approachRampScaleNm, angularLateralScaleNm, glidepathFullScaleFt } from '../../src/nav/fms/ApproachScaling';
import { trackBankCommand } from '../../src/nav/fms/PathGuidance';
import { NavDatabaseImpl } from '../../src/nav/NavDatabase';
import { createFileLoader } from '../../src/nav/data/nodeLoader';
import type { NavDatabase, Waypoint } from '../../src/nav/types';
import { KinematicAircraft } from './sim';

const w = (ident: string, p: { lat: number; lon: number }): Waypoint => ({ ident, lat: p.lat, lon: p.lon, kind: 'fix' });
/** A NavDatabase stub for plans built by hand. */
const noDb = { ready: true, airportsNear: () => [{}], resolve: () => [] } as unknown as NavDatabase;

function setup(style: 'garmin' | 'boeing' = 'garmin') {
  const vars = new SimVars();
  const events = new EventBus();
  const fms = new Fms({ vars, events, nav: noDb }, { style, bankLimitDeg: 25 });
  return { vars, events, fms };
}

/** A -> B (east 30 nm) -> C (045, 25 nm) -> D (135, 25 nm) near 40N 74W. */
function threeLegs() {
  const A = { lat: 40, lon: -74 };
  const B = destinationPoint(A.lat, A.lon, 90, 30);
  const C = destinationPoint(B.lat, B.lon, 45, 25);
  const D = destinationPoint(C.lat, C.lon, 135, 25);
  return { A, B, C, D };
}

function load(fms: Fms, legs: ReturnType<typeof makeLeg>[]) {
  const p = new FlightPlan(fms.plans.style);
  p.legs = legs;
  p.normalize();
  fms.plans.replace(p);
  if (fms.plans.pending) fms.plans.exec();
  return fms.plans.active;
}

describe('LNAV leg sequencing with a simulated aircraft', () => {
  it('captures, flies fly-by turns and sequences a 3-leg route in order', () => {
    const { vars, fms } = setup();
    const { A, B, C, D } = threeLegs();
    load(fms, [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('A', A) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('B', B) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('C', C) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('D', D) }),
    ]);
    const start = destinationPoint(A.lat, A.lon, 180, 3);
    const ac = new KinematicAircraft(vars, { lat: start.lat, lon: start.lon, hdgTrue: 70, gsKt: 180 });
    const seq: { leg: number; t: number; distToPrevFix: number }[] = [];
    let last = -1;
    let maxXtk = 0;
    const fixes = [A, B, C, D];
    const dt = 0.1;
    let suspendedAt = -1;
    for (let t = 0; t < 1800; t += dt) {
      fms.update(dt);
      const leg = vars.get(FMS.activeLegIndex);
      if (leg !== last) {
        const prev = fixes[leg - 1];
        seq.push({ leg, t, distToPrevFix: prev ? distanceNm(ac.lat, ac.lon, prev.lat, prev.lon) : NaN });
        last = leg;
      }
      if (t > 120) maxXtk = Math.max(maxXtk, Math.abs(vars.get(FMS.xtkNm)));
      if (vars.get(FMS.suspended) && suspendedAt < 0) suspendedAt = t;
      ac.step(dt);
    }
    expect(seq.map((s) => s.leg)).toEqual([1, 2, 3]);
    // Fly-by: leg 2 (turn -45 deg at B) and leg 3 (turn +90 deg at C) start before the fix.
    expect(seq[1].distToPrevFix).toBeGreaterThan(0.2);
    expect(seq[1].distToPrevFix).toBeLessThan(2);
    expect(seq[2].distToPrevFix).toBeGreaterThan(seq[1].distToPrevFix);
    expect(maxXtk).toBeLessThan(0.25);
    // After D there is nothing left: LNAV suspends and keeps flying the final course.
    expect(suspendedAt).toBeGreaterThan(0);
    expect(vars.get(FMS.lnavValid)).toBe(1);
    expect(Math.abs(vars.get(FMS.dtkMag) - 135)).toBeLessThan(2);
    expect(vars.get(FMS.toFrom)).toBe(-1);
  });

  it('fly-over waypoints sequence only when passed', () => {
    const { vars, fms } = setup();
    const { A, B, C } = threeLegs();
    load(fms, [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('A', A) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('B', B), flyOver: true }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('C', C) }),
    ]);
    const ac = new KinematicAircraft(vars, { lat: A.lat, lon: A.lon, hdgTrue: 90, gsKt: 180 });
    let dAtSeq = NaN;
    for (let t = 0; t < 900 && Number.isNaN(dAtSeq); t += 0.1) {
      fms.update(0.1);
      if (vars.get(FMS.activeLegIndex) === 2) dAtSeq = distanceNm(ac.lat, ac.lon, B.lat, B.lon);
      ac.step(0.1);
    }
    expect(dAtSeq).toBeLessThan(0.05);
  });

  it('direct-to from present position (event) reaches the fix', () => {
    const { vars, events, fms } = setup();
    const { A, B, C, D } = threeLegs();
    load(fms, [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('A', A) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('B', B) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('C', C) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('D', D) }),
    ]);
    const ac = new KinematicAircraft(vars, { lat: A.lat, lon: A.lon, hdgTrue: 90, gsKt: 200 });
    for (let t = 0; t < 60; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
    }
    events.emit(FMS_EVENTS.directTo, { ident: 'D' });
    fms.update(0.1);
    expect(vars.getString(FMS.legType)).toBe('DF');
    expect(vars.getString(FMS.nextWptIdent)).toBe('D');
    let minD = Infinity;
    for (let t = 0; t < 1200; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
      minD = Math.min(minD, distanceNm(ac.lat, ac.lon, D.lat, D.lon));
    }
    expect(minD).toBeLessThan(0.3);
  });

  it('holds: direct entry, circuits, exit on request', () => {
    const { vars, fms } = setup();
    const { A, B, C } = threeLegs();
    const plan = load(fms, [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('A', A) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('B', B) }),
      makeLeg({ type: 'HM', segment: 'enroute', fix: w('B', B), flyOver: true, turnDirection: 'R', course: 90, holdTimeMin: 1 }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('C', C) }),
    ]);
    // A manual hold continues along the route once exited (no discontinuity).
    expect(plan.legs.some((l) => l.type === 'DISCO')).toBe(false);
    const ac = new KinematicAircraft(vars, { lat: A.lat, lon: A.lon, hdgTrue: 90, gsKt: 180, altFt: 8000 });
    let inHoldT = -1;
    let maxDist = 0;
    for (let t = 0; t < 1500; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
      if (vars.get(FMS.inHold) && inHoldT < 0) inHoldT = t;
      if (inHoldT > 0) maxDist = Math.max(maxDist, distanceNm(ac.lat, ac.lon, B.lat, B.lon));
    }
    expect(vars.getString(FMS.holdEntry)).toBe('DIRECT');
    expect(inHoldT).toBeGreaterThan(0);
    expect(vars.getString(FMS.legType)).toBe('HM');
    // 1-minute legs at 180 kt: 3 nm legs, ~1 nm turn radius -> stays within ~5 nm of the fix.
    expect(maxDist).toBeLessThan(5.5);
    fms.exitHold();
    let exitedT = -1;
    for (let t = 0; t < 600 && exitedT < 0; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
      if (vars.getString(FMS.nextWptIdent) === 'C') exitedT = t;
    }
    expect(exitedT).toBeGreaterThan(0);
  });

  it('hold entry sectors (AIM 5-3-8)', () => {
    expect(holdEntryFor(90, 90, 1)).toBe('DIRECT');
    expect(holdEntryFor(90 + 100, 90, 1)).toBe('DIRECT');
    expect(holdEntryFor(90 + 150, 90, 1)).toBe('TEARDROP');
    expect(holdEntryFor(90 - 100, 90, 1)).toBe('PARALLEL');
    // Left-hand patterns mirror the sectors.
    expect(holdEntryFor(90 - 150, 90, -1)).toBe('TEARDROP');
    expect(holdEntryFor(90 + 100, 90, -1)).toBe('PARALLEL');
  });

  it('suspends at the MAP until the missed approach is activated', () => {
    const { vars, fms } = setup();
    const A = { lat: 40, lon: -74 };
    const FAF = destinationPoint(A.lat, A.lon, 90, 5);
    const RW = destinationPoint(FAF.lat, FAF.lon, 90, 5);
    const X = destinationPoint(RW.lat, RW.lon, 0, 6);
    load(fms, [
      makeLeg({ type: 'IF', segment: 'approach', fix: w('IF', A), altitude: { kind: 'atOrAbove', lowerFt: 3000 } }),
      makeLeg({ type: 'TF', segment: 'approach', fix: w('FAF', FAF), faf: true, altitude: { kind: 'at', lowerFt: 1600, upperFt: 1600 } }),
      makeLeg({ type: 'TF', segment: 'approach', fix: { ...w('RW09', RW), kind: 'runway', elevationFt: 0 }, flyOver: true, map: true, verticalAngleDeg: 3, altitude: { kind: 'at', lowerFt: 50, upperFt: 50 } }),
      makeLeg({ type: 'CA', segment: 'missed', course: 90, altitude: { kind: 'atOrAbove', lowerFt: 800 }, missedStart: true }),
      makeLeg({ type: 'DF', segment: 'missed', fix: w('X', X) }),
    ]);
    const ac = new KinematicAircraft(vars, { lat: A.lat, lon: A.lon, hdgTrue: 90, gsKt: 120, altFt: 1600 });
    let suspended = false;
    for (let t = 0; t < 600 && !suspended; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
      suspended = vars.get(FMS.suspended) === 1;
    }
    expect(suspended).toBe(true);
    expect(vars.getString(FMS.nextWptIdent)).toBe('RW09');
    ac.alt = 60; // at the MAP, just above the runway
    ac.publish();
    fms.activateMissedApproach();
    fms.update(0.1);
    expect(vars.getString(FMS.legType)).toBe('CA');
    expect(vars.get(FMS.missedActive)).toBe(1);
    expect(vars.getString(FMS.approachMode)).toBe('MAPR');
    // Climb through 800 ft: the CA leg sequences to DF X.
    ac.alt = 900;
    for (let t = 0; t < 2; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
    }
    expect(vars.getString(FMS.legType)).toBe('DF');
  });

  it('Boeing: LNAV drops at a route discontinuity', () => {
    const { vars, fms } = setup('boeing');
    const { A, B, C } = threeLegs();
    const p = new FlightPlan('boeing');
    p.legs = [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('A', A) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('B', B) }),
      makeLeg({ type: 'DISCO', segment: 'enroute' }),
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('C', C) }),
    ];
    p.normalize();
    fms.plans.replace(p);
    expect(vars.get(FMS.modPending)).toBe(1);
    fms.plans.exec();
    const ac = new KinematicAircraft(vars, { lat: A.lat, lon: A.lon, hdgTrue: 90, gsKt: 240 });
    let validBefore = 0;
    for (let t = 0; t < 600; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
      if (t < 60) validBefore = vars.get(FMS.lnavValid);
    }
    expect(validBefore).toBe(1);
    expect(vars.get(FMS.suspended)).toBe(1);
    expect(vars.get(FMS.lnavValid)).toBe(0);
  });

  it('heading-to-altitude leg flies the heading and sequences on altitude', () => {
    const { vars, fms } = setup();
    const A = { lat: 40, lon: -74 };
    const X = destinationPoint(A.lat, A.lon, 300, 10);
    load(fms, [
      makeLeg({ type: 'IF', segment: 'origin', fix: { ...w('RW24', A), kind: 'runway' } }),
      makeLeg({ type: 'VA', segment: 'departure', course: 240, altitude: { kind: 'atOrAbove', lowerFt: 1000 } }),
      makeLeg({ type: 'DF', segment: 'departure', fix: w('X', X) }),
    ]);
    const ac = new KinematicAircraft(vars, { lat: A.lat, lon: A.lon, hdgTrue: 200, gsKt: 150, altFt: 100, vsFpm: 1500 });
    for (let t = 0; t < 3; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
    }
    expect(vars.getString(FMS.legType)).toBe('VA');
    expect(vars.getString(FMS.nextWptIdent)).toBe('(1000)');
    expect(vars.get(FMS.lnavBankCmd)).toBeGreaterThan(10); // turning right toward 240
    for (let t = 0; t < 30; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
    }
    expect(Math.abs(ac.hdg - 240)).toBeLessThan(3);
    for (let t = 0; t < 20; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
    }
    expect(ac.alt).toBeGreaterThan(1000);
    expect(vars.getString(FMS.legType)).toBe('DF');
  });

  it('procedure turn (PI) reverses course with the coded turn and intercepts inbound', () => {
    const { vars, fms } = setup();
    // Final approach course 180 (inbound, true), PT fix 10 nm north of the FAF.
    const FAF = { lat: 40, lon: -74 };
    const PT = destinationPoint(FAF.lat, FAF.lon, 0, 10);
    const start = destinationPoint(PT.lat, PT.lon, 180, 3);
    load(fms, [
      makeLeg({ type: 'IF', segment: 'approach', fix: w('PTFIX', start) }),
      makeLeg({ type: 'TF', segment: 'approach', fix: w('KAYSE', PT), flyOver: true }),
      makeLeg({ type: 'PI', segment: 'approach', fix: w('KAYSE', PT), course: 315, turnDirection: 'R', distanceNm: 10 }),
      makeLeg({ type: 'CF', segment: 'approach', fix: w('FAF', FAF), course: 180, faf: true }),
    ]);
    const ac = new KinematicAircraft(vars, { lat: start.lat, lon: start.lon, hdgTrue: 0, gsKt: 120 });
    let maxNorth = 0;
    let turnedRight = false;
    let minFaf = Infinity;
    let xtkAtEnd = NaN;
    for (let t = 0; t < 1200; t += 0.1) {
      fms.update(0.1);
      const hdgBefore = ac.hdg;
      ac.step(0.1);
      // Excursion beyond the PT fix (north side, where the procedure turn is flown).
      if (ac.lat > PT.lat) maxNorth = Math.max(maxNorth, distanceNm(PT.lat, PT.lon, ac.lat, ac.lon));
      if (vars.getString(FMS.legType) === 'CF' && ac.hdg - hdgBefore > 0.1) turnedRight = true;
      const d = distanceNm(ac.lat, ac.lon, FAF.lat, FAF.lon);
      if (d < minFaf) {
        minFaf = d;
        xtkAtEnd = vars.get(FMS.xtkNm);
      }
    }
    expect(turnedRight).toBe(true);
    expect(maxNorth).toBeLessThan(10); // stayed within the PT limit
    expect(minFaf).toBeLessThan(0.3);
    expect(Math.abs(xtkAtEnd)).toBeLessThan(0.2);
  });

  it('RF arc legs are tracked with feed-forward bank', () => {
    const { vars, fms } = setup();
    const C = { lat: 40, lon: -74 };
    const r = 3;
    const P1 = destinationPoint(C.lat, C.lon, 180, r); // arc start (south of centre)
    const P2 = destinationPoint(C.lat, C.lon, 270, r); // arc end (west), clockwise via SW
    const P0 = destinationPoint(P1.lat, P1.lon, 90, 8); // approach from the east on track 270
    load(fms, [
      makeLeg({ type: 'IF', segment: 'approach', fix: w('P0', P0) }),
      makeLeg({ type: 'TF', segment: 'approach', fix: w('P1', P1) }),
      makeLeg({ type: 'RF', segment: 'approach', fix: w('P2', P2), turnDirection: 'R', arcRadiusNm: r, arcCenter: w('CTR', C) }),
      makeLeg({ type: 'TF', segment: 'approach', fix: w('P3', destinationPoint(P2.lat, P2.lon, 0, 8)) }),
    ]);
    const ac = new KinematicAircraft(vars, { lat: P0.lat, lon: P0.lon, hdgTrue: 270, gsKt: 180 });
    let maxArcErr = 0;
    for (let t = 0; t < 600; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1);
      if (vars.getString(FMS.legType) === 'RF') maxArcErr = Math.max(maxArcErr, Math.abs(distanceNm(C.lat, C.lon, ac.lat, ac.lon) - r));
    }
    expect(maxArcErr).toBeGreaterThan(0);
    expect(maxArcErr).toBeLessThan(0.15);
    expect(vars.getString(FMS.nextWptIdent)).toBe('P3');
  });

  it('teardrop and parallel hold entries stay near the pattern', () => {
    for (const [hdg, entry] of [
      [270 + 150, 'TEARDROP'],
      [270 - 110, 'PARALLEL'],
    ] as const) {
      const { vars, fms } = setup();
      const H = { lat: 40, lon: -74 };
      const from = destinationPoint(H.lat, H.lon, hdg + 180, 8);
      load(fms, [
        makeLeg({ type: 'IF', segment: 'enroute', fix: w('FROM', from) }),
        makeLeg({ type: 'TF', segment: 'enroute', fix: w('H', H) }),
        makeLeg({ type: 'HM', segment: 'enroute', fix: w('H', H), flyOver: true, turnDirection: 'R', course: 270, holdTimeMin: 1 }),
      ]);
      const ac = new KinematicAircraft(vars, { lat: from.lat, lon: from.lon, hdgTrue: hdg % 360, gsKt: 150, altFt: 6000 });
      let maxD = 0;
      let circuits = 0;
      let lastPhaseInbound = false;
      for (let t = 0; t < 900; t += 0.1) {
        fms.update(0.1);
        ac.step(0.1);
        if (vars.get(FMS.inHold)) maxD = Math.max(maxD, distanceNm(H.lat, H.lon, ac.lat, ac.lon));
        const inbound = fms.lnav.hold.phase === 'INBOUND';
        if (lastPhaseInbound && !inbound) circuits++;
        lastPhaseInbound = inbound;
      }
      expect(vars.getString(FMS.holdEntry)).toBe(entry);
      expect(circuits).toBeGreaterThanOrEqual(2);
      expect(maxD).toBeLessThan(6);
    }
  });

  it('roll law saturates at the bank limit and honours forced turn direction', () => {
    expect(trackBankCommand(0, 90, 0, 200, 0, 25)).toBe(25);
    expect(trackBankCommand(0, 90, 180, 200, 0, 25)).toBe(-25);
    // 170 deg left would be shorter, but a coded right turn is required.
    expect(trackBankCommand(0, 10, 180, 200, 0, 25, 1)).toBe(25);
    expect(Math.abs(trackBankCommand(0, 90, 90, 200, 0, 25))).toBeLessThan(1e-9);
  });
});

describe('VNAV path', () => {
  const T = Math.tan((3 * Math.PI) / 180) * FT_PER_NM; // ft per nm at 3 deg

  function plan3(bConstraint?: ReturnType<typeof Object>, bDist = 100) {
    const A = { lat: 0, lon: 0 };
    const B = destinationPoint(0, 0, 90, bDist);
    const C = destinationPoint(0, 0, 90, 200);
    const p = new FlightPlan('garmin');
    p.legs = [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('A', A) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('B', B), altitude: bConstraint as never }),
      makeLeg({ type: 'TF', segment: 'arrival', fix: w('C', C), altitude: { kind: 'at', lowerFt: 3000, upperFt: 3000 } }),
    ];
    p.normalize();
    computePlanGeometry(p, { groundSpeedKt: 300, startAltFt: 35000 });
    return p;
  }

  it('TOD from cruise to the last constraint at 3 deg', () => {
    const prof = computeDescentProfile(plan3(), 35000, 3);
    expect(prof.valid).toBe(true);
    expect(prof.todDistNm).toBeCloseTo(200 - 32000 / T, 3);
    expect(descentDistanceNm(32000)).toBeCloseTo(32000 / T, 6);
    expect(profileAltitudeAt(prof, 50)).toBe(35000);
    expect(profileAltitudeAt(prof, 150)).toBeCloseTo(3000 + 50 * T, 3);
    expect(profileAltitudeAt(prof, 250)).toBe(3000);
  });

  it('at-or-below constraint levels the path and moves the TOD earlier', () => {
    const prof = computeDescentProfile(plan3({ kind: 'atOrBelow', upperFt: 10000 }), 35000, 3);
    expect(profileAltitudeAt(prof, 150)).toBeCloseTo(10000, 6);
    expect(profileAltitudeAt(prof, 190)).toBeCloseTo(3000 + 10 * T, 3);
    expect(prof.todDistNm).toBeCloseTo(100 - 25000 / T, 3);
    expect(prof.unableLegIndex).toBe(-1);
  });

  it('at-or-above constraint forces a steeper segment and flags unable beyond 6 deg', () => {
    // 100 nm before C the 3 deg line already passes above 25,000 ft: no effect.
    const easy = computeDescentProfile(plan3({ kind: 'atOrAbove', lowerFt: 25000 }), 35000, 3);
    expect(profileAltitudeAt(easy, 100)).toBeCloseTo(3000 + 100 * T, 3);
    // 20 nm before C it does not: a steeper segment (> 6 deg) is required.
    const p = plan3({ kind: 'atOrAbove', lowerFt: 25000 }, 180);
    const prof = computeDescentProfile(p, 35000, 3);
    expect(profileAltitudeAt(prof, 180)).toBeCloseTo(25000, 6);
    expect(profileAltitudeAt(prof, 190)).toBeCloseTo(14000, 6);
    expect(prof.unableLegIndex).toBe(1);
    expect(prof.todDistNm).toBeCloseTo(180 - 10000 / T, 3);
  });

  it('VNAV guidance: deviation, TOD distance, target altitude and speed limit', () => {
    const { vars, fms } = setup();
    const A = { lat: 0, lon: 0 };
    const B = destinationPoint(0, 0, 90, 100);
    const C = destinationPoint(0, 0, 90, 200);
    const plan = load(fms, [
      makeLeg({ type: 'IF', segment: 'enroute', fix: w('A', A) }),
      makeLeg({ type: 'TF', segment: 'enroute', fix: w('B', B) }),
      makeLeg({ type: 'TF', segment: 'arrival', fix: w('C', C), altitude: { kind: 'at', lowerFt: 3000, upperFt: 3000 }, speed: { kind: 'atOrBelow', kt: 210 } }),
    ]);
    fms.plans.apply((p) => {
      p.cruiseAltFt = 35000;
      p.touch();
    });
    // 20 nm before the TOD at cruise.
    const tod = 200 - 32000 / T;
    const p0 = destinationPoint(0, 0, 90, tod - 20);
    const ac = new KinematicAircraft(vars, { lat: p0.lat, lon: p0.lon, hdgTrue: 90, gsKt: 450, altFt: 35000 });
    fms.update(0.1);
    fms.update(0.1);
    expect(vars.get(FMS.todDistNm)).toBeCloseTo(20, 0);
    expect(vars.getString(FMS.vnavPhase)).toBe('CRZ');
    expect(vars.get(FMS.vnavTargetAltFt)).toBe(3000);
    // On the path, 40 nm past the TOD.
    const p1 = destinationPoint(0, 0, 90, tod + 40);
    ac.lat = p1.lat;
    ac.lon = p1.lon;
    ac.alt = 35000 - 40 * T;
    ac.publish();
    fms.update(0.1);
    fms.update(0.1);
    expect(vars.getString(FMS.vnavPhase)).toBe('DES');
    expect(vars.get(FMS.vnavValid)).toBe(1);
    expect(Math.abs(vars.get(FMS.vnavDevFt))).toBeLessThan(30);
    expect(vars.get(FMS.vsRequiredFpm)).toBeLessThan(-2000);
    // Below 10,000 ft the 250 kt limit applies; the 210 kt constraint caps the target near C.
    ac.alt = 9000;
    ac.publish();
    fms.update(0.1);
    expect(vars.get(FMS.vnavTargetSpeedKt)).toBeLessThanOrEqual(250);
    void plan;
  });
});

describe('GPS approach scaling', () => {
  it('ramps, angular LPV width and vertical full scale', () => {
    expect(approachRampScaleNm(2)).toBeCloseTo(1, 9);
    expect(approachRampScaleNm(1)).toBeCloseTo(0.65, 9);
    expect(approachRampScaleNm(0)).toBeCloseTo(0.3, 9);
    expect(approachRampScaleNm(10)).toBeCloseTo(1, 9);
    expect(angularLateralScaleNm(0, 106.75, 1.5)).toBeCloseTo(106.75 / 1852, 9);
    expect(angularLateralScaleNm(10, 106.75, 1.5)).toBeCloseTo(0.3, 9);
    const mid = angularLateralScaleNm(2, 106.75, 1.5);
    expect(mid).toBeGreaterThan(106.75 / 1852);
    expect(mid).toBeLessThan(0.3);
    expect(glidepathFullScaleFt(100, 3)).toBeCloseTo(45 / 0.3048, 6);
    expect(glidepathFullScaleFt(3 * 6076, 3)).toBeCloseTo(3 * 6076 * Math.tan((0.75 * Math.PI) / 180), 6);
    expect(glidepathFullScaleFt(20 * 6076, 3)).toBeCloseTo(150 / 0.3048, 6);
  });
});

describe('approach mode on a synthetic RNAV approach (real database)', () => {
  const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
  beforeAll(async () => {
    await db.load();
  }, 60000);

  it('LNAV/VNAV with angular scaling and a centred glidepath on final', async () => {
    const vars = new SimVars();
    const fms = new Fms({ vars, nav: db }, { style: 'garmin' });
    const procs = (await db.loadProcedures!('EGLL'))!;
    const appr = procs.approaches.find((p) => p.ident === 'R27L')!;
    const p = new FlightPlan('garmin');
    p.setDestination(db.airport('EGLL')!);
    p.setApproach(appr);
    fms.plans.replace(p);
    const rw = db.runway('EGLL', '27L')!;
    // 3 nm final on the extended centreline, on the 3 deg path (TCH 50 ft).
    const pos = destinationPoint(rw.thresholdLat!, rw.thresholdLon!, rw.headingTrue + 180, 3);
    const alt = rw.elevationFt + 50 + 3 * FT_PER_NM * Math.tan((3 * Math.PI) / 180);
    const ac = new KinematicAircraft(vars, { lat: pos.lat, lon: pos.lon, hdgTrue: rw.headingTrue, gsKt: 140, altFt: alt, magVar: 1 });
    // Fly briefly so the FAF->MAP leg becomes active.
    fms.activateLeg(p.mapIndex);
    for (let t = 0; t < 1; t += 0.1) {
      fms.update(0.1);
      ac.step(0.1, 0);
    }
    expect(vars.getString(FMS.approachMode)).toBe('LNAV/VNAV');
    expect(vars.get(FMS.approachActive)).toBe(1);
    const scale = vars.get(FMS.cdiScaleNm);
    expect(scale).toBeLessThan(0.3);
    expect(scale).toBeGreaterThan(0.05);
    expect(vars.get(FMS.gpValid)).toBe(1);
    expect(Math.abs(vars.get(FMS.gpDev))).toBeLessThan(0.1);
    expect(vars.get(FMS.gpAngleDeg)).toBe(3);
    expect(Math.abs(vars.get(FMS.cdi))).toBeLessThan(0.1);
  });
});
